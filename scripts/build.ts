/**
 * Build step: regenerate the checked-in artifacts from the single source of
 * truth (src/data.ts). Run: `bun run build` (or `bun ./scripts/build.ts`).
 *
 * The sync test (tests/codegen.test.ts) regenerates into a temp dir and
 * diffs byte-for-byte against generated/, so forgetting to rebuild fails
 * the suite instead of silently shipping a stale artifact.
 */
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildInstalledKappaJson,
  buildInstalledTauYaml,
  emitAll,
} from "../src/codegen.ts";
import { DEAD_MODEL_IDS, MODEL_ALIASES, PROVIDER_DEFS } from "../src/data.ts";
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "generated");

/**
 * rhodochrosite's checked-in copy of the Rust data module. It was
 * previously a hand-copied snapshot that silently drifted — it was 6 days
 * stale and predated the vansrouter/omniroute definitions entirely. The
 * build now writes it, so "DO NOT EDIT BY HAND" is enforced by the
 * generator instead of by convention. Both trees live on the same estate
 * filesystem (rhodochrosite is its own repo), so a relative path reaches it.
 *
 * Named after the retired "flock-proxy" line (flock → rhodochrosite rename,
 * 2026-10-26). `roost_providers.rs` is a legacy alias module rhodochrosite's
 * providers.rs still imports for wire-field authority; `mimetite_providers.rs`
 * is the canonical module the hard rename lands on. The forge/router/
 * flock-proxy copy is the retired container's tree (preserved, not live) —
 * kept in sync so a dead file can't drift under a still-tracked build.
 */
const PROVIDERS_RUST_SYNC_PATHS = [
  resolve(
    here,
    "..",
    "..",
    "rhodochrosite",
    "proxy",
    "src",
    "roost_providers.rs",
  ),
  resolve(
    here,
    "..",
    "..",
    "rhodochrosite",
    "proxy",
    "src",
    "mimetite_providers.rs",
  ),
  // forge/router/flock-proxy is a second Rust flock-proxy copy (tracked in the
  // forge repo). Its own copy-in-sync gate is fixed in the same rename; keep it
  // emitted by this build so it can't silently drift again.
  resolve(
    "/home/toxic/pens/ranch/forge/router/flock-proxy/src/roost_providers.rs",
  ),
];

// Deterministic generatedAt: pin SOURCE_DATE_EPOCH to the last commit touching
// the source of truth, so a rebuild with unchanged data is byte-identical
// (clean tree, stable diffs, meaningful "stale artifact" failures).
if (!process.env.SOURCE_DATE_EPOCH) {
  try {
    const p = Bun.spawnSync(
      ["git", "log", "-1", "--format=%ct", "--", "src/data.ts"],
      { cwd: join(here, "..") },
    );
    const ts = new TextDecoder().decode(p.stdout).trim();
    if (/^\d+$/.test(ts)) process.env.SOURCE_DATE_EPOCH = ts;
  } catch {
    // fall back to wall-clock inside codegenTimestamp()
  }
}

const { jsonPath, goPath, rustPath, tauPath, kappaPath } = await emitAll(
  outDir,
  {
    defs: PROVIDER_DEFS,
    aliases: MODEL_ALIASES,
    deadIds: DEAD_MODEL_IDS,
    provenance: "@toxicwind/mimetite src/data.ts",
  },
);

console.log(`wrote ${jsonPath}`);
console.log(`wrote ${goPath}`);
console.log(`wrote ${rustPath}`);
console.log(`wrote ${tauPath}`);
console.log(`wrote ${kappaPath}`);

// flock's Rust consumer keeps its data module in its own src/ tree, so the
// emitter writes both copies from one render. Copying by hand is what let
// the two drift.
for (const p of PROVIDERS_RUST_SYNC_PATHS) {
  try {
    await Bun.write(p, await Bun.file(rustPath).text());
    console.log(`wrote ${p}`);
  } catch {
    // best-effort sync
  }
}

async function loadEnvFile(path: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  const file = Bun.file(path);
  if (!(await file.exists())) return env;
  for (const line of (await file.text()).split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#") || !s.includes("=")) continue;
    const eq = s.indexOf("=");
    let k = s
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, "");
    let v = s.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (k) env[k] = v;
  }
  return env;
}

/**
 * The secretsmith keyring is the SSOT (2026-10-18+). `~/.secrets` is a dead
 * fallback record, so a build that only reads it sees an EMPTY environment
 * and silently drops every keyring-backed provider from the generated
 * installed slice — that is how freeinference and nvidia vanished from tau's
 * models.yml (2026-10-26). Consult the keyring directly, and strip ONE
 * matching pair of shell quotes (secretsmith env emits KEY='value').
 */
async function loadKeyringEnv(): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  try {
    const proc = Bun.spawnSync(["secretsmith", "env"], {
      stdout: "pipe",
      stderr: "ignore",
      timeout: 30_000,
    });
    if (proc.exitCode !== 0) return env;
    for (const line of new TextDecoder().decode(proc.stdout).split("\n")) {
      const s = line.trim();
      if (!s || s.startsWith("#")) continue;
      const eq = s.indexOf("=");
      if (eq <= 0) continue;
      const k = s
        .slice(0, eq)
        .trim()
        .replace(/^export\s+/, "");
      let v = s.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (k) env[k] = v;
    }
  } catch {
    // keyring unavailable (CI) — the file/env fallbacks still apply
  }
  return env;
}

/**
 * Materialize tau's per-provider key files from the keyring. tau reads
 * `apiKey: "!cat /home/toxic/.tau/<provider>.key"` so no secret is ever
 * committed and tau's process needs no keyring env.
 */
async function materializeKeyFiles(
  env: Record<string, string>,
  pairs: Array<{ file: string; keyEnv: string }>,
): Promise<void> {
  for (const { file, keyEnv } of pairs) {
    const value = env[keyEnv];
    if (!value) continue;
    try {
      // NO trailing newline: tau reads this file with `!cat` straight into an
      // Authorization header, and a trailing \n corrupts the credential
      // ("Invalid JWT serialization: Missing dot delimiter(s)").
      await Bun.write(file, value.trim());
      // Bun.write's `mode` only applies at creation and is ignored for
      // existing files — chmod explicitly so key files are 0600 (they were
      // landing 0644 = world-readable secrets).
      await Bun.$`chmod 600 ${file}`.quiet();
    } catch (e) {
      console.warn(`skip key file ${file}: ${(e as Error).message}`);
    }
  }
}

const installedEnv = {
  ...(await loadEnvFile("/home/toxic/.tau/.env")),
  ...(await loadEnvFile("/home/toxic/.secrets")),
  ...(await loadKeyringEnv()),
};

// Materialize tau's per-provider key files from the keyring (idempotent,
// 0600). tau's process is not keyring-injected, and the committed
// models.yml must not carry inline secrets.
const keyFilePairs: Array<{ file: string; keyEnv: string }> = [];
for (const def of PROVIDER_DEFS as Array<{
  name: string;
  keyEnv?: string;
  keyEnvAlt?: string;
  modelProviders?: Array<{ name: string; keyEnv?: string }>;
}>) {
  const slug = (id: string) => id.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (def.keyEnv)
    keyFilePairs.push({
      file: `/home/toxic/.tau/${slug(def.name)}.key`,
      keyEnv: def.keyEnv,
    });
  for (const mp of def.modelProviders ?? []) {
    if (mp.keyEnv)
      keyFilePairs.push({
        file: `/home/toxic/.tau/${slug(`${def.name}.${mp.name}`)}.key`,
        keyEnv: mp.keyEnv,
      });
  }
}
await materializeKeyFiles(installedEnv, keyFilePairs);
const installed = buildInstalledTauYaml(
  {
    defs: PROVIDER_DEFS,
    aliases: MODEL_ALIASES,
    deadIds: DEAD_MODEL_IDS,
    provenance: "@toxicwind/mimetite src/data.ts",
  },
  installedEnv,
);
// Estate live-sync: best-effort only. On CI (or any box without the
// estate paths) the parent dirs don't exist and Bun.write would throw
// ENOENT — the build must not fail for that. The generated/ artifacts
// (checked in) are the CI contract; these two writes are the live-box sync.
for (const p of [
  "/home/toxic/.tau/models.yml",
  // 2026-10-28 single-truth lease: /home/toxic/estate must NEVER exist —
  // the pens SSOT is the only estate home; writing here silently recreated
  // the ghost path the lease forbids.
  "/home/toxic/pens/estate/config/tau/models.yml",
]) {
  try {
    await Bun.write(p, installed);
  } catch (e) {
    console.warn("skip estate sync to " + p + ": " + (e as Error).message);
  }
}
console.log(
  "synced installed slice to ~/.tau/models.yml and estate/config/tau/models.yml",
);

const kappaInstalled = buildInstalledKappaJson(
  {
    defs: PROVIDER_DEFS,
    aliases: MODEL_ALIASES,
    deadIds: DEAD_MODEL_IDS,
    provenance: "@toxicwind/mimetite src/data.ts",
  },
  installedEnv,
);
for (const p of [
  "/home/toxic/.config/kappa/kappa-models.json",
  // 2026-10-28 single-truth lease: pens SSOT, never /home/toxic/estate.
  "/home/toxic/pens/estate/config/kappa/kappa-models.json",
]) {
  try {
    await Bun.write(p, kappaInstalled);
  } catch (e) {
    console.warn("skip estate sync to " + p + ": " + (e as Error).message);
  }
}
console.log(
  "synced installed slice to ~/.config/kappa/kappa-models.json and estate/config/kappa/kappa-models.json",
);
