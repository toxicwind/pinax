#!/usr/bin/env bun
/**
 * audit.ts — live model-ID audit for @toxicwind/pinax (race doctrine).
 *
 * Fires every provider probe concurrently with a per-probe fail-fast
 * ceiling (default 2000ms) and ZERO retries — losers are data. Borrows
 * discover() + ModelCatalog from src/, so endpoint shapes, auth styles,
 * quarantine, the dead list, and aliases come from the catalog itself.
 *
 * Reports:
 *  - per-provider probe status + latency (first-class, sorted)
 *  - stale seeds: seeded ids absent from the live listing (miss-1 tier)
 *  - deadIds present in a raw live listing (contract violation)
 *  - alias targets not currently serving
 *  - referenced ids from estate config surfaces, classified
 *
 * Usage: bun scripts/audit.ts [--timeout ms] [--refs file ...]
 * Latency ledger: ~/.cache/shingle/pinax-audit.jsonl (winner-log shape —
 * next runs read it to spot chronic-tail providers).
 */
import { ModelCatalog } from "../src/catalog.ts";
import { mkdirSync } from "node:fs";
import { DEAD_MODEL_IDS, MODEL_ALIASES, PROVIDER_DEFS } from "../src/data.ts";
import { discover } from "../src/discovery.ts";
import type { DiscoveryResult } from "../src/discovery.ts";

const HOME = Bun.env.HOME ?? "";
const CACHE_DIR = `${HOME}/.cache/shingle`;
const LATENCY_LOG = `${CACHE_DIR}/pinax-audit.jsonl`;
const LAST_JSON = `${CACHE_DIR}/pinax-audit-last.json`;

const DEFAULT_REFS = [
  `${HOME}/estate/config/tau/agent/config.yml`,
  `${HOME}/estate/gateway/v1.4.2-fixed.json`,
  `${HOME}/estate/config/tau/extensions/vansrouter.ts`,
];

// --- args ---
let timeoutMs = 2000;
const refFiles: string[] = [];
for (let i = 0; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--timeout") timeoutMs = Number(process.argv[++i]) || timeoutMs;
  else if (a === "--refs") {
    while (i + 1 < process.argv.length && !process.argv[i + 1]?.startsWith("--")) refFiles.push(process.argv[++i]!);
  }
}
if (!refFiles.length) refFiles.push(...DEFAULT_REFS);

// --- secrets for getKey (values never printed) ---
const secrets: Record<string, string> = {};
try {
  for (const line of (await Bun.file(`${HOME}/.secrets`).text()).split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    secrets[m[1]!] = v;
  }
} catch {
  /* no secrets file — keyed providers will report auth failures as data */
}

// --- race: fire all probes concurrently, fail-fast, no retries ---
const catalog = new ModelCatalog(PROVIDER_DEFS, { aliases: MODEL_ALIASES, deadIds: DEAD_MODEL_IDS });

type Probe = { provider: string; adapter: string; ms: number; ok: boolean; skipped: boolean; error: string; live: string[] };

const probes: Probe[] = await Promise.all(
  PROVIDER_DEFS.map(async (def) => {
    const t0 = performance.now();
    const res: DiscoveryResult = await discover(def, {
      timeoutMs,
      getKey: (env) => process.env[env] ?? secrets[env],
    });
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    if (res.ok) catalog.applyDiscovery(def.name, res);
    return {
      provider: def.name,
      adapter: def.adapter,
      ms,
      ok: res.ok,
      skipped: !res.ok && "skipped" in res ? res.skipped === true : false,
      error: res.ok ? "" : res.error,
      live: res.ok ? res.ids : [],
    };
  }),
);

// --- cross-checks against catalog state ---
const deadSet = new Set(DEAD_MODEL_IDS);

// stale seeds: provider discovered OK, seed id missing from its live listing
const staleSeeds: string[] = [];
const seedDrift = new Map<string, number>();
for (const p of probes) {
  if (!p.ok || p.skipped) continue;
  const def = PROVIDER_DEFS.find((d) => d.name === p.provider);
  if (!def?.seeds.length) continue;
  const live = new Set(p.live);
  for (const id of def.seeds) if (!live.has(id)) staleSeeds.push(`${p.provider}\t${id}`);
  const seedSet = new Set(def.seeds);
  let drift = 0;
  for (const id of p.live) if (!seedSet.has(id)) drift++;
  if (drift) seedDrift.set(p.provider, drift);
}

// deadIds that a live listing still serves = contract violation
const deadContradictions: string[] = [];
for (const p of probes) {
  for (const id of p.live) if (deadSet.has(id)) deadContradictions.push(`${p.provider}\t${id}`);
}

// alias targets not currently serving
const aliasIssues: string[] = [];
for (const [alias, [prov, model]] of Object.entries(MODEL_ALIASES)) {
  if (!prov || !model) continue;
  const serving = catalog.servingModels(prov);
  if (!serving.includes(model)) aliasIssues.push(`${alias}\t->\t${prov}/${model}\t(${catalog.modelSource(prov, model)})`);
}

// referenced ids from config surfaces
const ID_RE = /[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*/g;
const SKIP_PREFIX = ["http", "https", "node_modules", "@oh-my-pi", "@earendil-works", "github.com", "raw.githubusercontent", "opencode.ai", "huggingface.co"];
const referenced = new Set<string>();
for (const file of refFiles) {
  let text = "";
  try {
    text = await Bun.file(file).text();
  } catch {
    continue;
  }
  for (const m of text.matchAll(ID_RE)) {
    const id = m[0];
    if (SKIP_PREFIX.some((s) => id.startsWith(s) || id.includes(s))) continue;
    referenced.add(id);
  }
}

function classify(id: string): string {
  if (deadSet.has(id)) return "DEAD";
  for (const def of PROVIDER_DEFS) {
    const source = catalog.modelSource(def.name, id);
    if (source === "live" || source === "seed" || source === "overlay") return source.toUpperCase();
  }
  const slash = id.indexOf("/");
  if (slash > 0) {
    const prov = id.slice(0, slash);
    const rest = id.slice(slash + 1);
    const source = catalog.modelSource(prov, rest);
    if (source === "live" || source === "seed" || source === "overlay") return `${source.toUpperCase()}(${prov})`;
  }
  if (id in MODEL_ALIASES) return "ALIAS";
  return "FICTIONAL";
}

const refLines = [...referenced].sort().map((id) => `${id}\t${classify(id)}`);

// --- latency ledger (winner-log shape) ---
mkdirSync(CACHE_DIR, { recursive: true });
const ledgerLine = JSON.stringify({
  ts: new Date().toISOString(),
  timeoutMs,
  providers: Object.fromEntries(probes.map((p) => [p.provider, { ms: p.ms, ok: p.ok }])),
});
await Bun.write(LATENCY_LOG, (await Bun.file(LATENCY_LOG).text().catch(() => "")) + ledgerLine + "\n");

// --- report ---
const out: string[] = [];
out.push("PROVIDER\tADAPTER\tMS\tSTATUS\tLIVE_N");
for (const p of [...probes].sort((a, b) => b.ms - a.ms)) {
  const status = p.ok ? (p.skipped ? "SKIP" : "OK") : p.error.includes("timeout") ? "TIMEOUT" : p.error.slice(0, 40);
  out.push(`${p.provider}\t${p.adapter}\t${p.ms}\t${status}\t${p.live.length}`);
}
const okN = probes.filter((p) => p.ok && !p.skipped).length;
out.push("", `== probes: ${okN}/${probes.length} live listings fetched within ${timeoutMs}ms (fail-fast, no retries)`);
out.push(`== stale seeds (seeded, missing from live listing — miss-1, still serving): ${staleSeeds.length}`);
out.push(...staleSeeds.map((l) => `  ${l}`));
out.push(`== seed drift (live ids beyond seeds, per provider): ${[...seedDrift].map(([k, v]) => `${k}+${v}`).join(" ") || "none"}`);
out.push(`== deadIds served by a live listing (CONTRADICTION): ${deadContradictions.length}`);
out.push(...deadContradictions.map((l) => `  ${l}`));
out.push(`== alias targets not serving: ${aliasIssues.length}`);
out.push(...aliasIssues.map((l) => `  ${l}`));
out.push(`== referenced ids in estate config surfaces (${refFiles.length} files):`);
out.push(...refLines.map((l) => `  ${l}`));
const report = out.join("\n") + "\n";
await Bun.write(LAST_JSON, JSON.stringify({ probes, staleSeeds, deadContradictions, aliasIssues, refLines }, null, 2));
console.log(report);
