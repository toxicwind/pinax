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
export declare function codegenTimestamp(): string;
/** Canonical JSON artifact for non-TS consumers (Python research scripts). */
export declare function buildProvidersJson(input: CodegenInput): string;
/**
 * Canonical JSON artifact for the Kappa agent (both full catalog and config-ready).
 * Profile 1: Full catalog containing all enabled providers in Pinax.
 */
export declare function buildProvidersKappaJson(input: CodegenInput): string;
/**
 * Kappa install slice: local routers and unkeyed static catalogs stay.
 * A provider with a keyEnv is omitted unless that variable (or keyEnvAlt)
 * is non-empty in env.
 * Profile 2: Installed slice for live Kappa consumption (~/.config/kappa/kappa-models.json).
 */
export declare function buildInstalledKappaJson(input: CodegenInput, env?: Record<string, string | undefined>): string;
/**
 * Generated Go data file for herd. Package name and exported symbols are
 * chosen to be a drop-in data replacement for herd's hardcoded tables; herd's
 * own merge/selection LOGIC stays hand-written and reads these tables.
 *
 * The type is CatalogProviderDef (not ProviderDef) — herd's registry.go
 * already declares ProviderDef for the extended 9Router registry.
 */
export declare function buildProvidersGo(input: CodegenInput): string;
export declare function buildProvidersRust(input: CodegenInput): string;
/** Tau install slice: local routers and unkeyed static catalogs stay.
 *  A provider with a keyEnv is omitted unless that variable (or keyEnvAlt)
 *  is non-empty in env. The checked-in generated/ artifact stays the full
 *  catalog; only the files Tau reads are filtered. */
export declare function buildInstalledTauYaml(input: CodegenInput, env: Record<string, string | undefined>): string;
/** Canonical YAML artifact for Tau (~/.tau/models.yml). */
export declare function buildProvidersTauYaml(input: CodegenInput): string;
/** Emit all artifacts into outDir. Returns the written paths. */
export declare function emitAll(outDir: string, input: CodegenInput): Promise<{
    jsonPath: string;
    goPath: string;
    rustPath: string;
    tauPath: string;
    kappaPath: string;
}>;
