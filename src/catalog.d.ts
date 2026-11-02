/**
 * ModelCatalog — the unified live model catalog.
 *
 * Serving semantics (the whole point of this package):
 *
 * - LIVE DISCOVERY IS THE SOURCE OF TRUTH. `servingModels()` is derived from
 *   the last successful discovery listing, minus quarantine, minus the dead
 *   list. The curated seed list is served ONLY before a provider's first
 *   successful discovery; afterwards seeds go inert (they may still inform
 *   stable ordering, never membership).
 * - FAILED REFRESH CHANGES NOTHING. Miss counters move only on successful
 *   refreshes; failures keep serving last-known-good (stale-serve).
 * - TWO-REFRESH PRUNE. An id missing from the live listing is not dropped
 *   immediately: it accrues a miss per consecutive successful refresh. At
 *   PRUNE_AFTER_MISSES (2) it enters quarantine and stops being served.
 *   Re-listing re-admits it automatically. Quarantine is observable, never
 *   silent.
 * - SERVE-TIME 404 quarantines immediately. A later re-listing re-admits.
 * - DEAD LIST is the permanent hand-managed tier (EOL notices). Never
 *   served, never re-admitted by discovery.
 * - OVERLAYS are router-local runtime ids (e.g. the TS router's dynamic
 *   local-role models from best-models.json). They serve always, are never
 *   pruned by discovery, never persisted, and still respect quarantine and
 *   the dead list. Overlays let consumers inject dynamic membership without
 *   reintroducing provider->models hardcoding.
 *
 * Persistence is atomic (temp file + fsync + rename) and backwards-compatible
 * with the old router `.state/live-models.json` shape ({ live, meta }).
 */
import type { LiveCatalogJson, ModelAlias, ModelSource, PersistedCatalog, ProviderDef, QuarantineEntry } from "./types.ts";
import type { DiscoveryResult } from "./discovery.ts";
/** Consecutive successful-refresh misses before quarantine. */
export declare const PRUNE_AFTER_MISSES = 2;
export declare class ModelCatalog {
    private readonly defs;
    private readonly states;
    private readonly aliases;
    private readonly deadIds;
    /**
     * Router-local runtime overlays: provider -> ids. Served always, never
     * pruned by discovery, never persisted. Still subject to quarantine and
     * the dead list.
     */
    private readonly overlays;
    /**
     * Write serialization: concurrent saveToFile/writeLiveCatalog calls are
     * chained so two async saves never interleave temp files or renames.
     */
    private saveChain;
    /** Monotonic counter for unique temp file names within this process. */
    private tmpCounter;
    constructor(defs: ProviderDef[], opts?: {
        aliases?: Record<string, ModelAlias>;
        deadIds?: string[];
    });
    providerNames(): string[];
    getDef(name: string): ProviderDef | undefined;
    /** Friendly alias resolution (UX layer). Returns the [provider, model] pair. */
    resolveAlias(alias: string): ModelAlias | undefined;
    /**
     * Set the router-local runtime overlay for a provider. Replaces any
     * previous overlay. Overlay ids serve always and are never pruned by
     * discovery; they are not persisted (re-derive them at startup).
     */
    setOverlay(provider: string, ids: string[]): void;
    /** The serving set for a provider — what routers may route to. */
    servingModels(provider: string): string[];
    /** Compose the provider's models-list URL (base + adapter modelsPath). */
    modelsUrl(name: string): string;
    /** Last successful live listing (raw discovery output, pre-prune). */
    liveIds(name: string): string[];
    /** All serving models across providers: { provider, id, source }. */
    allServing(): {
        provider: string;
        id: string;
        source: ModelSource;
    }[];
    modelSource(provider: string, id: string): ModelSource;
    quarantineList(provider?: string): QuarantineEntry[];
    isQuarantined(provider: string, id: string): boolean;
    /**
     * Apply a discovery result. Only successful results mutate state; failures
     * are recorded as lastError and leave the serving set untouched.
     */
    applyDiscovery(provider: string, result: DiscoveryResult): void;
    /**
     * Serving = current live listing PLUS ids still inside their miss
     * tolerance (missing once keeps serving until PRUNE_AFTER_MISSES
     * consecutive successful refreshes confirm the removal), minus quarantine
     * and the dead list.
     */
    private recomputeServing;
    /** Serve-time 404: quarantine immediately, drop from the serving set. */
    noteServe404(provider: string, id: string): void;
    /** Hand-managed permanent tier (EOL notices). Never served, never re-admitted. */
    noteDead(id: string): void;
    deadList(): string[];
    /** Stable ordering hint: curated seed order first, then live discovery order. */
    orderedServing(provider: string): string[];
    toJSON(): PersistedCatalog;
    /** Load persisted state. Unknown shape -> empty catalog state, never throws. */
    loadJSON(raw: unknown): void;
    /**
     * Live catalog export — the ANSWER for non-TS consumers (Go herd, Python).
     *
     * This is pure data, not logic: the derived serving sets, quarantine lists,
     * and discovery flags. Consumers read this file to learn what to serve;
     * they must not recompute membership themselves. The TS package remains
     * the only place the catalog logic exists.
     *
     * Contract: estate-pinax/live-catalog/v1
     */
    liveCatalogJson(): LiveCatalogJson;
    /** Sibling path for the live-catalog export next to a state file path. */
    static liveExportPathFor(statePath: string): string;
    /** Atomic persist: same-dir temp file + fsync + rename + dir fsync. */
    saveToFile(path: string): Promise<void>;
    private saveToFileInner;
    /** Write the live-catalog export (the ANSWER) atomically. */
    writeLiveCatalog(path: string): Promise<void>;
    private writeLiveCatalogInner;
    private nextTmpId;
    /**
     * Atomic file write: unique same-dir temp file + fsync + rename + dir fsync.
     * The temp name is unique per call (never just the pid) so concurrent
     * writers in one process cannot collide. Temp file is removed if the write
     * fails before the rename.
     */
    private static atomicWriteFile;
    loadFromFile(path: string): Promise<boolean>;
    /** Synchronous load for entry points that must not top-level-await. */
    loadFromFileSync(path: string): boolean;
}
