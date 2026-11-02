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
 * flock's checked-in copy of the Rust data module. It was previously a
 * hand-copied snapshot that silently drifted — it was 6 days stale and
 * predated the vansrouter/omniroute definitions entirely. The build now
 * writes it, so "DO NOT EDIT BY HAND" is enforced by the generator
 * instead of by convention. Both trees live on the same estate
 * filesystem (hodos is its own repo), so a relative path reaches it.
 */
const FLOCK_RUST_PATHS = [
  resolve(here, "..", "..", "hodos", "proxy", "src", "roost_providers.rs"),
  resolve(here, "..", "..", "hodos", "proxy", "src", "pinax_providers.rs"),
  // forge/router/flock-proxy is a second Rust flock-proxy copy (tracked in the
  // forge repo). Its own copy-in-sync gate is fixed in the same rename; keep it
  // emitted by this build so it can't silently drift again.
  resolve(
    here,
    "..",
    "..",
    "forge",
    "router",
    "flock-proxy",
    "src",
    "roost_providers.rs",
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
    provenance: "@toxicwind/pinax src/data.ts",
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
for (const p of FLOCK_RUST_PATHS) {
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

const installedEnv = {
  ...(await loadEnvFile("/home/toxic/.tau/.env")),
  ...(await loadEnvFile("/home/toxic/.secrets")),
};
const installed = buildInstalledTauYaml(
  {
    defs: PROVIDER_DEFS,
    aliases: MODEL_ALIASES,
    deadIds: DEAD_MODEL_IDS,
    provenance: "@toxicwind/pinax src/data.ts",
  },
  installedEnv,
);
// Estate live-sync: best-effort only. On CI (or any box without the
// estate paths) the parent dirs don't exist and Bun.write would throw
// ENOENT — the build must not fail for that. The generated/ artifacts
// (checked in) are the CI contract; these two writes are the live-box sync.
for (const p of [
  "/home/toxic/.tau/models.yml",
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
    provenance: "@toxicwind/pinax src/data.ts",
  },
  installedEnv,
);
for (const p of [
  "/home/toxic/.config/kappa/kappa-models.json",
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
