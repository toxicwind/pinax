/**
 * Code generation: the package is the single source of truth; non-TS
 * consumers get GENERATED artifacts, never hand-maintained copies.
 *
 * - generated/providers.json — canonical data artifact (Python scripts, docs).
 * - generated/providers.go  — drop-in data file for herd (Go cannot import TS).
 * - generated/providers.rs  — drop-in data module for flock (Rust cannot import TS).
 * - generated/providers.kappa.json — canonical catalog for the kappa agent (Go+TS);
 *   same catalog shape as providers.json, tagged for kappa so a future kappa
 *   import (or kappa json config) can reference it.
 *
 * All are checked in. `bun run build` regenerates them; the sync test
 * regenerates into a temp dir and diffs byte-for-byte, so a stale artifact
 * fails the build. The generated files carry a DO-NOT-EDIT header.
 *
 * Timestamps are deterministic (SOURCE_DATE_EPOCH pinned by scripts/build.ts
 * to the source-of-truth commit), so rebuilds with unchanged data produce
 * byte-identical output and a clean working tree.
 */
import type { ModelAlias, ProviderDef } from "./types.ts";

export interface CodegenInput {
  defs: ProviderDef[];
  aliases: Record<string, ModelAlias>;
  deadIds: string[];
  /** Free-form provenance, e.g. git sha of the source. */
  provenance?: string;
}

/**
 * Deterministic codegen timestamp. Honors SOURCE_DATE_EPOCH (reproducible-builds
 * standard). scripts/build.ts pins it to the last commit touching src/data.ts,
 * so a rebuild with unchanged data is byte-identical and the tree stays clean.
 */
export function codegenTimestamp(): string {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/.test(epoch.trim())) {
    return new Date(Number(epoch.trim()) * 1000).toISOString();
  }
  return new Date().toISOString();
}

function jsonEscaped(s: string): string {
  return JSON.stringify(s);
}

function goStringSlice(
  ids: string[],
  elementIndent = "\t\t",
  closeIndent = "\t",
): string {
  if (ids.length === 0) return "[]string{}";
  return `[]string{\n${ids.map((id) => `${elementIndent}${jsonEscaped(id)},`).join("\n")}\n${closeIndent}}`;
}

function goStringMap(m: Record<string, string>): string {
  const keys = Object.keys(m).sort();
  if (keys.length === 0) return "map[string]string{}";
  return `map[string]string{\n${keys.map((k) => `\t\t${jsonEscaped(k)}: ${jsonEscaped(m[k])},`).join("\n")}\n\t}`;
}

function goAliasMap(m: Record<string, ModelAlias>): string {
  const keys = Object.keys(m).sort();
  if (keys.length === 0) return "map[string][2]string{}";
  // gofmt aligns map values: colon directly after the key, padding after the
  // colon. Emit gofmt-clean so the artifact needs no post-processing.
  const width = Math.max(...keys.map((k) => jsonEscaped(k).length));
  return `map[string][2]string{\n${keys
    .map(
      (k) =>
        `\t${jsonEscaped(k)}:${" ".repeat(width - jsonEscaped(k).length + 1)}{${jsonEscaped(m[k][0])}, ${jsonEscaped(m[k][1])}},`,
    )
    .join("\n")}\n}`;
}

/** Ordered key pool for a provider. keyEnv is first; keyEnvAlt may hold a
 *  comma-separated list of additional vars (the "N keys" model — the old
 *  two-key cap was an artifact of keyEnvAlt being a single scalar). */
function keyEnvsOf(d: { keyEnv?: string; keyEnvAlt?: string }): string[] {
  const out: string[] = [];
  if (d.keyEnv) out.push(d.keyEnv);
  for (const v of (d.keyEnvAlt ?? "").split(",")) {
    const t = v.trim();
    if (t) out.push(t);
  }
  return out;
}

/** Canonical JSON artifact for non-TS consumers (Python research scripts). */
export function buildProvidersJson(input: CodegenInput): string {
  const doc = {
    $schema: "estate-pinax/v1",
    generatedAt: codegenTimestamp(),
    generator: "@toxicwind/pinax codegen — DO NOT EDIT BY HAND",
    ...(input.provenance ? { provenance: input.provenance } : {}),
    adapters: ["openai", "google-v1beta", "mistral", "static", "none"],
    providers: input.defs.map((d) => ({
      name: d.name,
      ...(d.displayName ? { displayName: d.displayName } : {}),
      baseUrl: d.baseUrl,
      keyEnv: d.keyEnv,
      ...(d.keyEnvAlt ? { keyEnvAlt: d.keyEnvAlt } : {}),
      keyEnvs: keyEnvsOf(d),
      adapter: d.adapter,
      ...(d.modelsPath ? { modelsPath: d.modelsPath } : {}),
      ...(d.auth ? { auth: d.auth } : {}),
      ...(d.headerName ? { headerName: d.headerName } : {}),
      ...(d.queryParam ? { queryParam: d.queryParam } : {}),
      ...(d.extraHeaders ? { extraHeaders: d.extraHeaders } : {}),
      ...(d.staticModels ? { staticModels: d.staticModels } : {}),
      ...(d.noModelsReason ? { noModelsReason: d.noModelsReason } : {}),
      ...(d.enabled === false ? { enabled: false } : {}),
      ...(d.routerLocal ? { routerLocal: true } : {}),
    })),
    // Seeds are cold-start data only; the JSON documents that contract.
    seeds: Object.fromEntries(input.defs.map((d) => [d.name, d.seeds])),
    seedsContract:
      "Cold-start only: served while a provider has never had a successful discovery; inert afterwards. Never hand-edit model membership here — discovery owns it.",
    aliases: input.aliases,
    deadIds: [...input.deadIds].sort(),
    deadIdsContract:
      "Permanent hand-managed tier (EOL notices). Never served, never re-admitted by discovery.",
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

/**
 * Canonical JSON artifact for the Kappa agent (both full catalog and config-ready).
 * Profile 1: Full catalog containing all enabled providers in Pinax.
 */
export function buildProvidersKappaJson(input: CodegenInput): string {
  const generatedAt = codegenTimestamp();
  const provenance = input.provenance ? input.provenance : "unknown";

  const providerMap: Record<string, Record<string, unknown>> = {};

  for (const d of input.defs) {
    if (d.enabled === false || d.routerLocal || d.name === "herd") {
      continue;
    }
    const models: Record<
      string,
      { name: string; limit: { context: number; output: number } }
    > = {};
    const modelIds =
      d.staticModels && d.staticModels.length > 0
        ? d.staticModels
        : d.seeds && d.seeds.length > 0
          ? d.seeds
          : [];

    for (const id of modelIds) {
      models[id] = {
        name: id,
        limit: {
          context: d.contextLengths?.[id] ?? 128000,
          output: 8192,
        },
      };
    }

    let apiKey = "none";
    if (d.name === "flock") {
      apiKey = "!cat /home/toxic/.tau/flock.key";
    } else if (d.name === "hodos") {
      apiKey = "herd-local";
    } else if (d.auth !== "none" && d.keyEnv) {
      apiKey = `{env:${d.keyEnv}}`;
    }

    providerMap[d.name] = {
      npm: "@ai-sdk/openai-compatible",
      name: d.displayName ?? d.name,
      options: {
        baseURL: d.baseUrl,
        apiKey,
      },
      models,
    };
  }

  const doc = {
    $schema: "https://app.kappa.ai/config.json",
    contract: "estate-pinax/kappa-catalog/v1",
    generator:
      "@toxicwind/pinax codegen — kappa target (full profile) — DO NOT EDIT BY HAND",
    provenance,
    generatedAt,
    deadIds: [...input.deadIds].sort(),
    aliases: input.aliases,
    seeds: Object.fromEntries(input.defs.map((d) => [d.name, d.seeds])),
    provider: providerMap,
    providers: input.defs.map((d) => ({
      name: d.name,
      ...(d.displayName ? { displayName: d.displayName } : {}),
      baseUrl: d.baseUrl,
      keyEnv: d.keyEnv,
      ...(d.keyEnvAlt ? { keyEnvAlt: d.keyEnvAlt } : {}),
      keyEnvs: keyEnvsOf(d),
      adapter: d.adapter,
      ...(d.modelsPath ? { modelsPath: d.modelsPath } : {}),
      ...(d.auth ? { auth: d.auth } : {}),
      ...(d.headerName ? { headerName: d.headerName } : {}),
      ...(d.queryParam ? { queryParam: d.queryParam } : {}),
      ...(d.extraHeaders ? { extraHeaders: d.extraHeaders } : {}),
      ...(d.staticModels ? { staticModels: d.staticModels } : {}),
      ...(d.noModelsReason ? { noModelsReason: d.noModelsReason } : {}),
      ...(d.enabled === false ? { enabled: false } : {}),
      ...(d.routerLocal ? { routerLocal: true } : {}),
    })),
  };

  return JSON.stringify(doc, null, 2) + "\n";
}

/**
 * Kappa install slice: local routers and unkeyed static catalogs stay.
 * A provider with a keyEnv is omitted unless that variable (or keyEnvAlt)
 * is non-empty in env.
 * Profile 2: Installed slice for live Kappa consumption (~/.config/kappa/kappa-models.json).
 */
export function buildInstalledKappaJson(
  input: CodegenInput,
  env: Record<string, string | undefined> = process.env,
): string {
  const present = (name?: string) => {
    if (!name) return false;
    const v = env[name];
    return typeof v === "string" && v.trim().length > 0;
  };
  const defs = input.defs.filter((d) => {
    if (d.enabled === false || d.routerLocal) return false;
    if (
      d.name === "flock" ||
      d.name === "herd" ||
      d.name === "hodos" ||
      d.auth === "none"
    ) {
      return true;
    }
    const pool = keyEnvsOf(d);
    if (pool.length === 0) return true;
    return pool.some(present);
  });
  const full = JSON.parse(
    buildProvidersKappaJson({ ...input, defs }),
  ) as Record<string, unknown>;
  full.generator =
    "@toxicwind/pinax codegen — kappa target (installed profile) — DO NOT EDIT BY HAND";
  return JSON.stringify(full, null, 2) + "\n";
}

/**
 * Generated Go data file for herd. Package name and exported symbols are
 * chosen to be a drop-in data replacement for herd's hardcoded tables; herd's
 * own merge/selection LOGIC stays hand-written and reads these tables.
 *
 * The type is CatalogProviderDef (not ProviderDef) — herd's registry.go
 * already declares ProviderDef for the extended 9Router registry.
 */
export function buildProvidersGo(input: CodegenInput): string {
  const generatedAt = codegenTimestamp();
  const defStructs = input.defs
    .map((d) => {
      const fields = [
        `\t\tName:           ${jsonEscaped(d.name)},`,
        `\t\tBaseURL:        ${jsonEscaped(d.baseUrl)},`,
        `\t\tKeyEnv:         ${jsonEscaped(d.keyEnv)},`,
        `\t\tKeyEnvAlt:      ${jsonEscaped(d.keyEnvAlt ?? "")},`,
        `\t\tAdapter:        ${jsonEscaped(d.adapter)},`,
        `\t\tAuth:           ${jsonEscaped(d.auth ?? "")},`,
        `\t\tHeaderName:     ${jsonEscaped(d.headerName ?? "")},`,
        `\t\tQueryParam:     ${jsonEscaped(d.queryParam ?? "")},`,
        `\t\tModelsPath:     ${jsonEscaped(d.modelsPath ?? "")},`,
        `\t\tNoModelsReason: ${jsonEscaped(d.noModelsReason ?? "")},`,
        `\t\tNoAuth:         ${d.auth === "none" ? "true" : "false"},`,
        `\t\tRouterLocal:    ${d.routerLocal ? "true" : "false"},`,
        `\t\tEnabled:        ${d.enabled === false ? "false" : "true"},`,
      ];
      return `\t{\n${fields.join("\n")}\n\t},`;
    })
    .join("\n");

  // gofmt does not column-align map entries whose values are composite
  // literals (seeds/static): emit keys unpadded.
  const seedsGo = input.defs
    .map((d) => `\t${jsonEscaped(d.name)}: ${goStringSlice(d.seeds)},`)
    .join("\n");

  const staticGo = input.defs
    .filter((d) => d.adapter === "static")
    .map(
      (d) =>
        `\t${jsonEscaped(d.name)}: ${goStringSlice(d.staticModels ?? [])},`,
    )
    .join("\n");

  const provenance = input.provenance ? input.provenance : "unknown";

  return `// Code generated by @toxicwind/pinax — DO NOT EDIT BY HAND.
// Regenerate with: bun run build  (in packages/providers)
// Source of truth: packages/providers/src/data.ts
// Generated at: ${generatedAt}

package astmatrix

// CatalogProvenance identifies the package revision this file was generated
// from (litellm-style provenance carried into the artifact).
const CatalogProvenance = ${jsonEscaped(provenance)}

// CatalogProviderDef mirrors the catalog's provider definition (data only).
// Named to avoid colliding with registry.go's ProviderDef (extended registry).
type CatalogProviderDef struct {
	Name           string
	BaseURL        string
	KeyEnv         string
	KeyEnvAlt      string
	Adapter        string // openai | google-v1beta | mistral | static | none
	Auth           string // bearer | x-api-key | query-key | none
	HeaderName     string // auth === "x-api-key"
	QueryParam     string // auth === "query-key"
	ModelsPath     string
	NoModelsReason string
	NoAuth         bool // auth === "none": no API key needed
	RouterLocal    bool // TS-router-local concept; herd skips these
	Enabled        bool
}

// ProviderCatalogDefs is the canonical provider table.
var ProviderCatalogDefs = []CatalogProviderDef{
${defStructs}
}

// ProviderCatalogSeeds: cold-start seeds ONLY. Served while a provider has
// never had a successful discovery; inert afterwards. Discovery owns
// membership — never add live models here. Seeds may name dead IDs; the
// catalog filters deadIds everywhere (cold start included).
var ProviderCatalogSeeds = map[string][]string{
${seedsGo}
}

// ProviderCatalogStaticModels: adapter "static" providers carry their list
// in the definition (no /models endpoint to discover).
var ProviderCatalogStaticModels = map[string][]string{
${staticGo}
}

// ProviderCatalogAliases: friendly alias -> [provider, model] (UX layer).
var ProviderCatalogAliases = ${goAliasMap(input.aliases)}

// ProviderCatalogDeadIDs: permanent hand-managed tier (EOL notices).
// Never served, never re-admitted by discovery.
var ProviderCatalogDeadIDs = ${goStringSlice([...input.deadIds].sort(), "\t", "")}
`;
}

/**
 * Render a TS string list as a Rust `&[&str]` literal. JSON string escaping
 * is valid inside Rust string literals for the ASCII data this catalog
 * carries (URLs, env var names, model ids).
 */
function rustStrSlice(ids: string[]): string {
  if (ids.length === 0) return "&[]";
  return `&[${ids.map(jsonEscaped).join(", ")}]`;
}

/**
 * Generated Rust data module for flock. Rust cannot import TS, so the
 * provider wire data ships as a checked-in generated module — the same
 * pattern as providers.go for herd (Go).
 *
 * The module is DATA ONLY: flock's hand-written providers.rs keeps every
 * operational type and all routing logic, and builds its ProviderDefs from
 * this table merged with flock's local overlay (elo/weight/free-tier/
 * model-map/display-name tuning). The wire fields here (base URLs, key env
 * vars, adapters, seeds) are never hand-edited.
 *
 * Seeds are emitted raw — they may name dead IDs. The consumer filters
 * PINAX_DEAD_IDS, per the catalog contract ("the catalog filters deadIds
 * everywhere (cold start included)").
 */
/** Render a Record<string, number> as a Rust slice of (&str, u64) tuples. */
function rustCtxLengths(m: Record<string, number>): string {
  const entries = Object.keys(m)
    .sort()
    .map((k) => `(${jsonEscaped(k)}, ${Math.floor(m[k])}u64)`);
  return `&[${entries.join(", ")}]`;
}

export function buildProvidersRust(input: CodegenInput): string {
  const generatedAt = codegenTimestamp();
  const provenance = input.provenance ? input.provenance : "unknown";

  const defs = input.defs
    .map((d) => {
      const fields = [
        `name: ${jsonEscaped(d.name)},`,
        `display_name: ${jsonEscaped(d.displayName ?? d.name)},`,
        `base_url: ${jsonEscaped(d.baseUrl)},`,
        `key_env: ${jsonEscaped(d.keyEnv)},`,
        // The Rust flock-proxy consumer reads this as one scalar var name.
        // Emit only the first pool member so the field stays valid while the
        // Rust side is being retired in favour of the Bun/TS flocksync port,
        // which reads the full `keyEnvs` pool.
        `key_env_alt: ${jsonEscaped((d.keyEnvAlt ?? "").split(",")[0].trim())},`,
        `adapter: ${jsonEscaped(d.adapter)},`,
        `auth: ${jsonEscaped(d.auth ?? "")},`,
        `header_name: ${jsonEscaped(d.headerName ?? "")},`,
        `query_param: ${jsonEscaped(d.queryParam ?? "")},`,
        `models_path: ${jsonEscaped(d.modelsPath ?? "")},`,
        `router_local: ${d.routerLocal ? "true" : "false"},`,
        `enabled: ${d.enabled === false ? "false" : "true"},`,
        `seeds: ${rustStrSlice(d.seeds)},`,
        `static_models: ${rustStrSlice(d.staticModels ?? [])},`,
        `context_lengths: ${rustCtxLengths(d.contextLengths ?? {})},`,
      ];
      return `    PinaxProvider {\n${fields.map((f) => `        ${f}`).join("\n")}\n    },`;
    })
    .join("\n");

  const deadIds = [...input.deadIds].sort();
  const aliases = Object.keys(input.aliases)
    .sort()
    .map(
      (k) =>
        `    (${jsonEscaped(k)}, ${jsonEscaped(input.aliases[k][0])}, ${jsonEscaped(input.aliases[k][1])}),`,
    )
    .join("\n");

  return `// Code generated by @toxicwind/pinax — DO NOT EDIT BY HAND.
// Regenerate with: bun run build  (in mesh/catalog)
// Source of truth: mesh/catalog/src/data.ts
// Generated at: ${generatedAt}

/// Provenance of the Pinax catalog revision this module was generated from.
pub const PINAX_PROVENANCE: &str = ${jsonEscaped(provenance)};

/// One provider's wire data, generated from the Pinax catalog.
/// Flock builds its operational ProviderDefs from this table merged with
/// flock's hand-maintained overlay (elo/weight/free-tier/model-map); the
/// wire fields here (base URLs, key env vars, adapters, seeds) are never
/// hand-edited.
pub struct PinaxProvider {
    /// Canonical provider key, e.g. "groq".
    pub name: &'static str,
    pub display_name: &'static str,
    /// Base URL the adapter appends its models path to.
    pub base_url: &'static str,
    /// Env var holding the API key. Never the key itself.
    pub key_env: &'static str,
    /// Alternate env var (multi-key pools).
    pub key_env_alt: &'static str,
    /// Endpoint-shape adapter: openai | google-v1beta | mistral | static | none.
    pub adapter: &'static str,
    /// Auth style: bearer | x-api-key | query-key | none.
    pub auth: &'static str,
    /// Header name for auth == "x-api-key".
    pub header_name: &'static str,
    /// Query param name for auth == "query-key".
    pub query_param: &'static str,
    /// Path appended to base_url. Defaults per adapter ("openai" -> "/models").
    pub models_path: &'static str,
    /// TS-router-local concept (local proxies/shims); flock skips these.
    pub router_local: bool,
    /// Disabled providers are never fetched and never served.
    pub enabled: bool,
    /// Cold-start seeds ONLY. May name dead IDs — filter PINAX_DEAD_IDS.
    pub seeds: &'static [&'static str],
    /// Adapter "static": the model list, carried in the definition.
    pub static_models: &'static [&'static str],
    /// Declared context windows per model ID (tokens). Absent = undeclared.
    pub context_lengths: &'static [(&'static str, u64)],
}

/// The canonical provider table, generated from the Pinax catalog.
pub const PINAX_PROVIDERS: &[PinaxProvider] = &[
${defs}
];

/// Permanent EOL tier (hand-managed). Never served, never re-admitted:
/// filter these out of seeds and live listings alike.
pub const PINAX_DEAD_IDS: &[&str] = ${rustStrSlice(deadIds)};

/// Friendly alias -> (provider, canonical model id) (UX layer).
pub const PINAX_ALIASES: &[(&str, &str, &str)] = &[
${aliases}
];

// Backwards-compatibility aliases for legacy consumers.
pub type RoostProvider = PinaxProvider;
pub const ROOST_PROVENANCE: &str = PINAX_PROVENANCE;
pub const ROOST_PROVIDERS: &[PinaxProvider] = PINAX_PROVIDERS;
pub const ROOST_DEAD_IDS: &[&str] = PINAX_DEAD_IDS;
pub const ROOST_ALIASES: &[(&str, &str, &str)] = PINAX_ALIASES;
`;
}

/** Tau install slice: local routers and unkeyed static catalogs stay.
 *  A provider with a keyEnv is omitted unless that variable (or keyEnvAlt)
 *  is non-empty in env. The checked-in generated/ artifact stays the full
 *  catalog; only the files Tau reads are filtered. */
export function buildInstalledTauYaml(
  input: CodegenInput,
  env: Record<string, string | undefined>,
): string {
  const present = (name?: string) => {
    if (!name) return false;
    const v = env[name];
    return typeof v === "string" && v.trim().length > 0;
  };
  const defs = input.defs.filter((d) => {
    if (d.enabled === false || d.routerLocal) return false;
    if (d.name === "flock" || d.name === "herd" || d.auth === "none")
      return true;
    const pool = keyEnvsOf(d);
    if (pool.length === 0) return true;
    return pool.some(present);
  });
  return buildProvidersTauYaml({ ...input, defs });
}

/** Canonical YAML artifact for Tau (~/.tau/models.yml). */
export function buildProvidersTauYaml(input: CodegenInput): string {
  const generatedAt = codegenTimestamp();
  const provenance = input.provenance ? input.provenance : "unknown";

  const lines: string[] = [
    "# Code generated by @toxicwind/pinax for Tau — DO NOT EDIT BY HAND.",
    "# Regenerate with: bun run build  (in mesh/catalog)",
    "# Source of truth: mesh/catalog/src/data.ts",
    `# Generated at: ${generatedAt}`,
    `# Provenance: ${provenance}`,
    "",
    "discovery:",
    "  type: openai-models-list",
    "  ollama: true",
    "  lm-studio: true",
    "  llama.cpp: true",
    "",
    "providers:",
    "  flock:",
    "    baseUrl: http://127.0.0.1:25193/v1",
    "    api: openai-completions",
    '    apiKey: "!cat /home/toxic/.tau/flock.key"',
    "    discovery:",
    "      type: openai-models-list",
  ];

  for (const d of input.defs) {
    if (
      d.enabled === false ||
      d.routerLocal ||
      d.name === "herd" ||
      d.name === "herd"
    ) {
      continue;
    }
    lines.push(`  ${d.name}:`);
    lines.push(`    baseUrl: ${d.baseUrl}`);
    lines.push(`    api: openai-completions`);
    if (d.auth === "none") {
      lines.push(`    auth: none`);
    } else if (d.keyEnv) {
      lines.push(`    apiKey: ${d.keyEnv}`);
    }
    if (d.adapter !== "none" && d.adapter !== "static") {
      lines.push(`    discovery:`);
      lines.push(`      type: openai-models-list`);
    } else if (d.staticModels && d.staticModels.length > 0) {
      // Tau has no "static" discovery type, so a provider with a carried model
      // list must spell it out as explicit `models:` entries or it surfaces
      // with zero selectable models.
      lines.push(`    models:`);
      for (const id of d.staticModels) {
        const ctx = d.contextLengths?.[id];
        lines.push(`      - id: ${id}`);
        if (ctx) lines.push(`        contextWindow: ${ctx}`);
      }
    }
  }

  return lines.join("\n") + "\n";
}

/** Emit all artifacts into outDir. Returns the written paths. */
export async function emitAll(
  outDir: string,
  input: CodegenInput,
): Promise<{
  jsonPath: string;
  goPath: string;
  rustPath: string;
  tauPath: string;
  kappaPath: string;
}> {
  const { promises: fs } = await import("node:fs");
  const { join } = await import("node:path");
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, "providers.json");
  const goPath = join(outDir, "providers.go");
  const rustPath = join(outDir, "providers.rs");
  const tauPath = join(outDir, "tau-models.yml");
  const kappaPath = join(outDir, "providers.kappa.json");
  const kappaModelsPath = join(outDir, "kappa-models.json");
  await fs.writeFile(jsonPath, buildProvidersJson(input), "utf8");
  await fs.writeFile(goPath, buildProvidersGo(input), "utf8");
  await fs.writeFile(rustPath, buildProvidersRust(input), "utf8");
  await fs.writeFile(tauPath, buildProvidersTauYaml(input), "utf8");
  const kappaContent = buildProvidersKappaJson(input);
  await fs.writeFile(kappaPath, kappaContent, "utf8");
  await fs.writeFile(kappaModelsPath, kappaContent, "utf8");
  return { jsonPath, goPath, rustPath, tauPath, kappaPath };
}
