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
import type {
  LiveCatalogJson,
  ModelAlias,
  ModelSource,
  PersistedCatalog,
  PersistedProviderState,
  ProviderDef,
  QuarantineEntry,
  QuarantineReason,
} from "./types.ts";
import type { DiscoveryResult } from "./discovery.ts";
import { adapterFor } from "./adapters.ts";
import { readFileSync } from "node:fs";

/** Consecutive successful-refresh misses before quarantine. */
export const PRUNE_AFTER_MISSES = 2;

interface RuntimeState {
  def: ProviderDef;
  live: string[];
  serving: string[];
  everDiscovered: boolean;
  miss: Map<string, number>;
  quarantine: Map<string, { reason: QuarantineReason; since: string }>;
  lastOk?: string;
  lastError?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class ModelCatalog {
  private readonly defs = new Map<string, ProviderDef>();
  private readonly states = new Map<string, RuntimeState>();
  private readonly aliases: Record<string, ModelAlias>;
  private readonly deadIds: Set<string>;
  /**
   * Router-local runtime overlays: provider -> ids. Served always, never
   * pruned by discovery, never persisted. Still subject to quarantine and
   * the dead list.
   */
  private readonly overlays = new Map<string, Set<string>>();
  /**
   * Write serialization: concurrent saveToFile/writeLiveCatalog calls are
   * chained so two async saves never interleave temp files or renames.
   */
  private saveChain: Promise<void> = Promise.resolve();
  /** Monotonic counter for unique temp file names within this process. */
  private tmpCounter = 0;

  constructor(
    defs: ProviderDef[],
    opts: { aliases?: Record<string, ModelAlias>; deadIds?: string[] } = {},
  ) {
    this.aliases = { ...(opts.aliases ?? {}) };
    this.deadIds = new Set(opts.deadIds ?? []);
    for (const def of defs) {
      if (this.defs.has(def.name))
        throw new Error(`duplicate provider definition: "${def.name}"`);
      this.defs.set(def.name, def);
      this.states.set(def.name, {
        def,
        live: [],
        serving: [],
        everDiscovered: false,
        miss: new Map(),
        quarantine: new Map(),
      });
    }
  }

  providerNames(): string[] {
    return [...this.defs.keys()];
  }

  getDef(name: string): ProviderDef | undefined {
    return this.defs.get(name);
  }

  /** Friendly alias resolution (UX layer). Returns the [provider, model] pair. */
  resolveAlias(alias: string): ModelAlias | undefined {
    const pair = this.aliases[alias];
    if (!pair) return undefined;
    // A permanently dead target is never routable — refuse it here so no
    // consumer can route through a dead alias. (Transient quarantine is left
    // to the router, which re-admits on re-listing.)
    if (this.deadIds.has(pair[1])) return undefined;
    return pair;
  }

  /**
   * Set the router-local runtime overlay for a provider. Replaces any
   * previous overlay. Overlay ids serve always and are never pruned by
   * discovery; they are not persisted (re-derive them at startup).
   */
  setOverlay(provider: string, ids: string[]): void {
    this.overlays.set(
      provider,
      new Set(
        (ids ?? []).filter((id) => typeof id === "string" && id.length > 0),
      ),
    );
  }

  /** The serving set for a provider — what routers may route to. */
  servingModels(provider: string): string[] {
    const st = this.states.get(provider);
    if (!st) return [];
    if (st.def.enabled === false) return [];
    const overlay = [...(this.overlays.get(provider) ?? [])].filter(
      (id) => !st.quarantine.has(id) && !this.deadIds.has(id),
    );
    if (!st.everDiscovered) {
      // Cold start: seeds serve, minus quarantine and the dead list.
      const seeds = st.def.seeds.filter(
        (id) => !st.quarantine.has(id) && !this.deadIds.has(id),
      );
      return [...new Set([...seeds, ...overlay])];
    }
    return [...new Set([...st.serving, ...overlay])];
  }

  /** Compose the provider's models-list URL (base + adapter modelsPath). */
  modelsUrl(name: string): string {
    const def = this.defs.get(name);
    if (!def) return "";
    const base = def.baseUrl.replace(/\/+$/, "");
    return base + (def.modelsPath ?? adapterFor(def.adapter).defaultPath);
  }

  /** Last successful live listing (raw discovery output, pre-prune). */
  liveIds(name: string): string[] {
    return [...(this.states.get(name)?.live ?? [])];
  }

  /** All serving models across providers: { provider, id, source }. */
  allServing(): { provider: string; id: string; source: ModelSource }[] {
    const out: { provider: string; id: string; source: ModelSource }[] = [];
    for (const name of this.providerNames()) {
      for (const id of this.servingModels(name)) {
        out.push({ provider: name, id, source: this.modelSource(name, id) });
      }
    }
    return out;
  }

  modelSource(provider: string, id: string): ModelSource {
    const st = this.states.get(provider);
    if (!st) return "unknown";
    if (this.deadIds.has(id)) return "dead";
    if (st.quarantine.has(id)) return "quarantined";
    if (this.overlays.get(provider)?.has(id)) return "overlay";
    if (!st.everDiscovered) return st.def.seeds.includes(id) ? "seed" : "unknown";
    return st.serving.includes(id) ? "live" : "unknown";
  }

  quarantineList(provider?: string): QuarantineEntry[] {
    const out: QuarantineEntry[] = [];
    for (const [name, st] of this.states) {
      if (provider && name !== provider) continue;
      for (const [id, q] of st.quarantine)
        out.push({ id, provider: name, reason: q.reason, since: q.since });
    }
    return out;
  }

  isQuarantined(provider: string, id: string): boolean {
    return this.states.get(provider)?.quarantine.has(id) ?? false;
  }

  /**
   * Apply a discovery result. Only successful results mutate state; failures
   * are recorded as lastError and leave the serving set untouched.
   */
  applyDiscovery(provider: string, result: DiscoveryResult): void {
    const st = this.states.get(provider);
    if (!st) throw new Error(`unknown provider "${provider}"`);
    if (!result.ok) {
      st.lastError = `${nowIso()}: ${result.error}`;
      return;
    }

    const liveSet = new Set(result.ids);
    const prevLive = new Set(st.live);

    // Miss accounting runs against the previous live set UNION the current
    // miss table: an id missing once leaves the live set but must still
    // accrue its second miss on the next successful refresh.
    const candidates = new Set([...prevLive, ...st.miss.keys()]);
    for (const id of candidates) {
      if (liveSet.has(id)) continue;
      const n = (st.miss.get(id) ?? 0) + 1;
      if (n >= PRUNE_AFTER_MISSES) {
        st.miss.delete(id);
        st.quarantine.set(id, {
          reason: "vanished-from-live-listing",
          since: nowIso(),
        });
      } else {
        st.miss.set(id, n);
      }
    }
    // Re-admission: anything the provider lists again leaves quarantine
    // (except the permanent dead tier, which discovery can never clear).
    for (const id of liveSet) {
      st.miss.delete(id);
      if (st.quarantine.has(id)) st.quarantine.delete(id);
    }

    st.live = [...liveSet];
    st.everDiscovered = true;
    st.lastOk = result.fetchedAt;
    st.lastError = undefined;
    this.recomputeServing(st);
  }

  /**
   * Serving = current live listing PLUS ids still inside their miss
   * tolerance (missing once keeps serving until PRUNE_AFTER_MISSES
   * consecutive successful refreshes confirm the removal), minus quarantine
   * and the dead list.
   */
  private recomputeServing(st: RuntimeState): void {
    if (!st.everDiscovered) {
      st.serving = [];
      return;
    }
    const serving = new Set(st.live);
    for (const [id, n] of st.miss)
      if (n < PRUNE_AFTER_MISSES) serving.add(id);
    st.serving = [...serving].filter(
      (id) => !st.quarantine.has(id) && !this.deadIds.has(id),
    );
  }

  /** Serve-time 404: quarantine immediately, drop from the serving set. */
  noteServe404(provider: string, id: string): void {
    const st = this.states.get(provider);
    if (!st) return;
    if (this.deadIds.has(id)) return;
    if (!st.quarantine.has(id))
      st.quarantine.set(id, { reason: "serve-404", since: nowIso() });
    st.serving = st.serving.filter((x) => x !== id);
  }

  /** Hand-managed permanent tier (EOL notices). Never served, never re-admitted. */
  noteDead(id: string): void {
    this.deadIds.add(id);
    for (const st of this.states.values()) {
      st.quarantine.set(id, { reason: "dead-list", since: nowIso() });
      st.serving = st.serving.filter((x) => x !== id);
    }
  }

  deadList(): string[] {
    return [...this.deadIds];
  }

  /** Stable ordering hint: curated seed order first, then live discovery order. */
  orderedServing(provider: string): string[] {
    const st = this.states.get(provider);
    if (!st) return [];
    const serving = this.servingModels(provider);
    const rank = new Map(st.def.seeds.map((id, i) => [id, i]));
    return [...serving].sort((a, b) => {
      const ra = rank.get(a) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b) ?? Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
  }

  // ------------------------------------------------------------------
  // Persistence (atomic; backwards-compatible with the v1 shape)
  // ------------------------------------------------------------------

  toJSON(): PersistedCatalog {
    const providers: Record<string, PersistedProviderState> = {};
    for (const [name, st] of this.states) {
      const miss: Record<string, number> = {};
      for (const [id, n] of st.miss) miss[id] = n;
      const quarantine: Record<string, { reason: QuarantineReason; since: string }> = {};
      for (const [id, q] of st.quarantine) quarantine[id] = { ...q };
      providers[name] = {
        live: [...st.live],
        everDiscovered: st.everDiscovered,
        miss,
        quarantine,
        ...(st.lastOk ? { lastOk: st.lastOk } : {}),
        ...(st.lastError ? { lastError: st.lastError } : {}),
      };
    }
    return { version: 2, providers, updatedAt: nowIso() };
  }

  /** Load persisted state. Unknown shape -> empty catalog state, never throws. */
  loadJSON(raw: unknown): void {
    if (typeof raw !== "object" || raw === null) return;
    const obj = raw as Record<string, unknown>;
    if (obj["version"] === 2 && typeof obj["providers"] === "object" && obj["providers"] !== null) {
      const providers = obj["providers"] as Record<string, PersistedProviderState>;
      for (const [name, p] of Object.entries(providers)) {
        const st = this.states.get(name);
        if (!st || typeof p !== "object" || p === null) continue;
        st.live = Array.isArray(p.live) ? p.live.filter((x) => typeof x === "string") : [];
        st.everDiscovered = p.everDiscovered === true;
        st.miss = new Map(
          Object.entries(p.miss ?? {}).filter(
            (e): e is [string, number] => typeof e[1] === "number",
          ),
        );
        st.quarantine = new Map();
        for (const [id, q] of Object.entries(p.quarantine ?? {})) {
          if (q && typeof q.reason === "string" && typeof q.since === "string")
            st.quarantine.set(id, { reason: q.reason as QuarantineReason, since: q.since });
        }
        if (typeof p.lastOk === "string") st.lastOk = p.lastOk;
        if (typeof p.lastError === "string") st.lastError = p.lastError;
        // Re-derive serving from loaded live + miss tolerance + quarantine +
        // dead list so a stale persisted serving array can never resurrect a
        // dead id.
        this.recomputeServing(st);
      }
      return;
    }
    // v1 migration: { live: { provider: [...] }, meta: {...}, updatedAt }.
    // Any provider with a persisted live listing had a successful discovery.
    if (typeof obj["live"] === "object" && obj["live"] !== null) {
      const live = obj["live"] as Record<string, unknown>;
      for (const [name, ids] of Object.entries(live)) {
        const st = this.states.get(name);
        if (!st || !Array.isArray(ids)) continue;
        const clean = ids.filter((x): x is string => typeof x === "string");
        st.live = clean;
        st.everDiscovered = true;
        st.serving = clean.filter((id) => !this.deadIds.has(id));
      }
    }
  }

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
  liveCatalogJson(): LiveCatalogJson {
    const providers: LiveCatalogJson["providers"] = {};
    for (const [name, st] of this.states) {
      if (st.def.enabled === false) continue;
      providers[name] = {
        serving: this.servingModels(name),
        quarantined: [...st.quarantine.keys()].sort(),
        discovered: st.everDiscovered,
      };
    }
    return {
      contract: "estate-pinax/live-catalog/v1",
      generatedAt: nowIso(),
      generator: "@toxicwind/pinax ModelCatalog — DO NOT EDIT BY HAND",
      deadIds: [...this.deadIds].sort(),
      providers,
    };
  }

  /** Sibling path for the live-catalog export next to a state file path. */
  static liveExportPathFor(statePath: string): string {
    return statePath.endsWith(".json")
      ? statePath.slice(0, -5) + ".live.json"
      : statePath + ".live.json";
  }

  /** Atomic persist: same-dir temp file + fsync + rename + dir fsync. */
  async saveToFile(path: string): Promise<void> {
    // Serialize: concurrent saves chain so temp files and renames never
    // interleave, even when two async callers save at once.
    const run = this.saveChain.then(() => this.saveToFileInner(path));
    // Keep the chain alive even if a save fails; the caller still sees the error.
    this.saveChain = run.catch(() => {});
    return run;
  }

  private async saveToFileInner(path: string): Promise<void> {
    const data = JSON.stringify(this.toJSON(), null, 2) + "\n";
    await ModelCatalog.atomicWriteFile(path, data, () => `pstate-${this.nextTmpId()}`);
    // The live catalog export is the contract for non-TS consumers (Go herd
    // reads this file for the serving sets). Written on every state save so
    // it can never go stale relative to the state file.
    await this.writeLiveCatalogInner(ModelCatalog.liveExportPathFor(path));
  }

  /** Write the live-catalog export (the ANSWER) atomically. */
  async writeLiveCatalog(path: string): Promise<void> {
    const run = this.saveChain.then(() => this.writeLiveCatalogInner(path));
    this.saveChain = run.catch(() => {});
    return run;
  }

  private async writeLiveCatalogInner(path: string): Promise<void> {
    const data = JSON.stringify(this.liveCatalogJson(), null, 2) + "\n";
    await ModelCatalog.atomicWriteFile(path, data, () => `live-${this.nextTmpId()}`);
  }

  private nextTmpId(): string {
    this.tmpCounter += 1;
    return `${process.pid}.${this.tmpCounter}.${Date.now()}`;
  }

  /**
   * Atomic file write: unique same-dir temp file + fsync + rename + dir fsync.
   * The temp name is unique per call (never just the pid) so concurrent
   * writers in one process cannot collide. Temp file is removed if the write
   * fails before the rename.
   */
  private static async atomicWriteFile(
    path: string,
    data: string,
    tmpSuffix: () => string,
  ): Promise<void> {
    const { promises: fs } = await import("node:fs");
    const { dirname } = await import("node:path");
    await fs.mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp.${tmpSuffix()}`;
    try {
      await fs.writeFile(tmp, data, "utf8");
      const handle = await fs.open(tmp, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(tmp, path);
      // Fsync the directory so the rename itself survives a crash.
      const dir = await fs.open(dirname(path), "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } catch (err) {
      // Best-effort cleanup: never leave a stale temp file behind.
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }

  async loadFromFile(path: string): Promise<boolean> {
    try {
      const text = await Bun.file(path).text();
      this.loadJSON(JSON.parse(text));
      return true;
    } catch {
      return false;
    }
  }

  /** Synchronous load for entry points that must not top-level-await. */
  loadFromFileSync(path: string): boolean {
    try {
      this.loadJSON(JSON.parse(readFileSync(path, "utf8")));
      return true;
    } catch {
      return false;
    }
  }
}
