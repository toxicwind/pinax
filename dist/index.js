// @bun
// src/adapters.ts
class AdapterParseError extends Error {
  adapter;
  constructor(adapter, msg) {
    super(`[${adapter}] ${msg}`);
    this.name = "AdapterParseError";
    this.adapter = adapter;
  }
}
function authHeaders(auth, key, def) {
  const headers = { ...def.extraHeaders ?? {} };
  let query = "";
  const style = auth ?? (key ? "bearer" : "none");
  if (style === "bearer" && key)
    headers["authorization"] = `Bearer ${key}`;
  else if (style === "x-api-key" && key)
    headers[def.headerName ?? "x-api-key"] = key;
  else if (style === "query-key" && key)
    query = `?${encodeURIComponent(def.queryParam ?? "key")}=${encodeURIComponent(key)}`;
  return { headers, query };
}
function idsFromDataArray(adapter, body) {
  if (typeof body !== "object" || body === null)
    throw new AdapterParseError(adapter, "body is not an object");
  const data = body.data;
  if (!Array.isArray(data))
    throw new AdapterParseError(adapter, 'missing "data" array');
  const ids = [];
  for (const item of data) {
    if (typeof item === "object" && item !== null) {
      const id = item.id;
      if (typeof id === "string" && id.length > 0)
        ids.push(id);
    }
  }
  return ids;
}
var openaiAdapter = {
  id: "openai",
  needsFetch: true,
  defaultPath: "/models",
  buildRequest(def, key) {
    const path = def.modelsPath ?? this.defaultPath;
    const { headers, query } = authHeaders(def.auth, key, def);
    return { url: `${def.baseUrl}${path}${query}`, headers };
  },
  parse(body) {
    return { ids: idsFromDataArray("openai", body), meta: { adapter: "openai" } };
  }
};
var mistralAdapter = {
  id: "mistral",
  needsFetch: true,
  defaultPath: "/v1/models",
  buildRequest(def, key) {
    const path = def.modelsPath ?? this.defaultPath;
    const { headers, query } = authHeaders(def.auth, key, def);
    return { url: `${def.baseUrl}${path}${query}`, headers };
  },
  parse(body) {
    if (typeof body === "object" && body !== null && body.object !== undefined && body.object !== "list")
      throw new AdapterParseError("mistral", 'unexpected "object" discriminator');
    return { ids: idsFromDataArray("mistral", body), meta: { adapter: "mistral" } };
  }
};
var googleV1betaAdapter = {
  id: "google-v1beta",
  needsFetch: true,
  defaultPath: "/v1beta/models",
  buildRequest(def, key) {
    const path = def.modelsPath ?? this.defaultPath;
    const withQuery = {
      ...def,
      auth: def.auth ?? "query-key",
      queryParam: def.queryParam ?? "key"
    };
    const { headers, query } = authHeaders(withQuery.auth, key, withQuery);
    return { url: `${def.baseUrl}${path}${query}`, headers };
  },
  parse(body) {
    if (typeof body !== "object" || body === null)
      throw new AdapterParseError("google-v1beta", "body is not an object");
    const models = body.models;
    if (!Array.isArray(models))
      throw new AdapterParseError("google-v1beta", 'missing "models" array');
    const ids = [];
    for (const m of models) {
      if (typeof m === "object" && m !== null) {
        const name = m.name;
        if (typeof name === "string" && name.length > 0)
          ids.push(name.startsWith("models/") ? name.slice("models/".length) : name);
      }
    }
    return { ids, meta: { adapter: "google-v1beta" } };
  }
};
var staticAdapter = {
  id: "static",
  needsFetch: false,
  defaultPath: "",
  buildRequest() {
    throw new AdapterParseError("static", "static adapter never fetches");
  },
  parse(_body, def) {
    return {
      ids: [...def.staticModels ?? []],
      meta: { adapter: "static" }
    };
  }
};
var noneAdapter = {
  id: "none",
  needsFetch: false,
  defaultPath: "",
  buildRequest() {
    throw new AdapterParseError("none", "none adapter never fetches");
  },
  parse(_body, def) {
    return {
      ids: [],
      meta: { adapter: "none", reason: def.noModelsReason ?? "no /models endpoint" }
    };
  }
};
var ADAPTERS = {
  openai: openaiAdapter,
  mistral: mistralAdapter,
  "google-v1beta": googleV1betaAdapter,
  static: staticAdapter,
  none: noneAdapter
};
function adapterFor(id) {
  const a = ADAPTERS[id];
  if (!a)
    throw new AdapterParseError(id, `unknown adapter "${id}"`);
  return a;
}
// src/discovery.ts
var DEFAULT_TIMEOUT_MS = 15000;
function defaultGetKey(env) {
  try {
    return process.env[env];
  } catch {
    return;
  }
}
async function discover(def, opts = {}) {
  const adapter = adapterFor(def.adapter);
  if (def.enabled === false)
    return { ok: false, error: `provider "${def.name}" disabled`, skipped: true };
  if (!adapter.needsFetch) {
    let parsed;
    try {
      parsed = adapter.parse(undefined, def);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
    return {
      ok: true,
      ids: parsed.ids,
      meta: { ...parsed.meta ?? {}, fetchedAt: new Date().toISOString() },
      fetchedAt: new Date().toISOString()
    };
  }
  const getKey = opts.getKey ?? defaultGetKey;
  const key = getKey(def.keyEnv);
  let req;
  try {
    req = adapter.buildRequest(def, key);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let res;
  try {
    res = await fetchImpl(req.url, {
      headers: req.headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `fetch failed: ${msg}` };
  }
  if (!res.ok) {
    let hint = "";
    try {
      hint = (await res.text()).slice(0, 200);
    } catch {}
    return {
      ok: false,
      error: `HTTP ${res.status} from ${def.name}/models${hint ? `: ${hint}` : ""}`,
      status: res.status
    };
  }
  let body;
  try {
    body = await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `invalid JSON from ${def.name}/models: ${msg}`, status: res.status };
  }
  try {
    const parsed = adapter.parse(body, def);
    const fetchedAt = new Date().toISOString();
    return {
      ok: true,
      ids: parsed.ids,
      meta: { ...parsed.meta ?? {}, httpStatus: res.status, fetchedAt },
      fetchedAt
    };
  } catch (err) {
    const msg = err instanceof AdapterParseError ? err.message : err instanceof Error ? err.message : String(err);
    return { ok: false, error: `parse failed for ${def.name}/models: ${msg}`, status: res.status };
  }
}
// src/catalog.ts
import { readFileSync } from "fs";
var PRUNE_AFTER_MISSES = 2;
function nowIso() {
  return new Date().toISOString();
}

class ModelCatalog {
  defs = new Map;
  states = new Map;
  aliases;
  deadIds;
  overlays = new Map;
  saveChain = Promise.resolve();
  tmpCounter = 0;
  constructor(defs, opts = {}) {
    this.aliases = { ...opts.aliases ?? {} };
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
        miss: new Map,
        quarantine: new Map
      });
    }
  }
  providerNames() {
    return [...this.defs.keys()];
  }
  getDef(name) {
    return this.defs.get(name);
  }
  resolveAlias(alias) {
    const pair = this.aliases[alias];
    if (!pair)
      return;
    if (this.deadIds.has(pair[1]))
      return;
    return pair;
  }
  setOverlay(provider, ids) {
    this.overlays.set(provider, new Set((ids ?? []).filter((id) => typeof id === "string" && id.length > 0)));
  }
  servingModels(provider) {
    const st = this.states.get(provider);
    if (!st)
      return [];
    if (st.def.enabled === false)
      return [];
    const overlay = [...this.overlays.get(provider) ?? []].filter((id) => !st.quarantine.has(id) && !this.deadIds.has(id));
    if (!st.everDiscovered) {
      const seeds = st.def.seeds.filter((id) => !st.quarantine.has(id) && !this.deadIds.has(id));
      return [...new Set([...seeds, ...overlay])];
    }
    return [...new Set([...st.serving, ...overlay])];
  }
  modelsUrl(name) {
    const def = this.defs.get(name);
    if (!def)
      return "";
    const base = def.baseUrl.replace(/\/+$/, "");
    return base + (def.modelsPath ?? adapterFor(def.adapter).defaultPath);
  }
  liveIds(name) {
    return [...this.states.get(name)?.live ?? []];
  }
  allServing() {
    const out = [];
    for (const name of this.providerNames()) {
      for (const id of this.servingModels(name)) {
        out.push({ provider: name, id, source: this.modelSource(name, id) });
      }
    }
    return out;
  }
  modelSource(provider, id) {
    const st = this.states.get(provider);
    if (!st)
      return "unknown";
    if (this.deadIds.has(id))
      return "dead";
    if (st.quarantine.has(id))
      return "quarantined";
    if (this.overlays.get(provider)?.has(id))
      return "overlay";
    if (!st.everDiscovered)
      return st.def.seeds.includes(id) ? "seed" : "unknown";
    return st.serving.includes(id) ? "live" : "unknown";
  }
  quarantineList(provider) {
    const out = [];
    for (const [name, st] of this.states) {
      if (provider && name !== provider)
        continue;
      for (const [id, q] of st.quarantine)
        out.push({ id, provider: name, reason: q.reason, since: q.since });
    }
    return out;
  }
  isQuarantined(provider, id) {
    return this.states.get(provider)?.quarantine.has(id) ?? false;
  }
  applyDiscovery(provider, result) {
    const st = this.states.get(provider);
    if (!st)
      throw new Error(`unknown provider "${provider}"`);
    if (!result.ok) {
      st.lastError = `${nowIso()}: ${result.error}`;
      return;
    }
    const liveSet = new Set(result.ids);
    const prevLive = new Set(st.live);
    const candidates = new Set([...prevLive, ...st.miss.keys()]);
    for (const id of candidates) {
      if (liveSet.has(id))
        continue;
      const n = (st.miss.get(id) ?? 0) + 1;
      if (n >= PRUNE_AFTER_MISSES) {
        st.miss.delete(id);
        st.quarantine.set(id, {
          reason: "vanished-from-live-listing",
          since: nowIso()
        });
      } else {
        st.miss.set(id, n);
      }
    }
    for (const id of liveSet) {
      st.miss.delete(id);
      if (st.quarantine.has(id))
        st.quarantine.delete(id);
    }
    st.live = [...liveSet];
    st.everDiscovered = true;
    st.lastOk = result.fetchedAt;
    st.lastError = undefined;
    this.recomputeServing(st);
  }
  recomputeServing(st) {
    if (!st.everDiscovered) {
      st.serving = [];
      return;
    }
    const serving = new Set(st.live);
    for (const [id, n] of st.miss)
      if (n < PRUNE_AFTER_MISSES)
        serving.add(id);
    st.serving = [...serving].filter((id) => !st.quarantine.has(id) && !this.deadIds.has(id));
  }
  noteServe404(provider, id) {
    const st = this.states.get(provider);
    if (!st)
      return;
    if (this.deadIds.has(id))
      return;
    if (!st.quarantine.has(id))
      st.quarantine.set(id, { reason: "serve-404", since: nowIso() });
    st.serving = st.serving.filter((x) => x !== id);
  }
  noteDead(id) {
    this.deadIds.add(id);
    for (const st of this.states.values()) {
      st.quarantine.set(id, { reason: "dead-list", since: nowIso() });
      st.serving = st.serving.filter((x) => x !== id);
    }
  }
  deadList() {
    return [...this.deadIds];
  }
  orderedServing(provider) {
    const st = this.states.get(provider);
    if (!st)
      return [];
    const serving = this.servingModels(provider);
    const rank = new Map(st.def.seeds.map((id, i) => [id, i]));
    return [...serving].sort((a, b) => {
      const ra = rank.get(a) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b) ?? Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
  }
  toJSON() {
    const providers = {};
    for (const [name, st] of this.states) {
      const miss = {};
      for (const [id, n] of st.miss)
        miss[id] = n;
      const quarantine = {};
      for (const [id, q] of st.quarantine)
        quarantine[id] = { ...q };
      providers[name] = {
        live: [...st.live],
        everDiscovered: st.everDiscovered,
        miss,
        quarantine,
        ...st.lastOk ? { lastOk: st.lastOk } : {},
        ...st.lastError ? { lastError: st.lastError } : {}
      };
    }
    return { version: 2, providers, updatedAt: nowIso() };
  }
  loadJSON(raw) {
    if (typeof raw !== "object" || raw === null)
      return;
    const obj = raw;
    if (obj["version"] === 2 && typeof obj["providers"] === "object" && obj["providers"] !== null) {
      const providers = obj["providers"];
      for (const [name, p] of Object.entries(providers)) {
        const st = this.states.get(name);
        if (!st || typeof p !== "object" || p === null)
          continue;
        st.live = Array.isArray(p.live) ? p.live.filter((x) => typeof x === "string") : [];
        st.everDiscovered = p.everDiscovered === true;
        st.miss = new Map(Object.entries(p.miss ?? {}).filter((e) => typeof e[1] === "number"));
        st.quarantine = new Map;
        for (const [id, q] of Object.entries(p.quarantine ?? {})) {
          if (q && typeof q.reason === "string" && typeof q.since === "string")
            st.quarantine.set(id, { reason: q.reason, since: q.since });
        }
        if (typeof p.lastOk === "string")
          st.lastOk = p.lastOk;
        if (typeof p.lastError === "string")
          st.lastError = p.lastError;
        this.recomputeServing(st);
      }
      return;
    }
    if (typeof obj["live"] === "object" && obj["live"] !== null) {
      const live = obj["live"];
      for (const [name, ids] of Object.entries(live)) {
        const st = this.states.get(name);
        if (!st || !Array.isArray(ids))
          continue;
        const clean = ids.filter((x) => typeof x === "string");
        st.live = clean;
        st.everDiscovered = true;
        st.serving = clean.filter((id) => !this.deadIds.has(id));
      }
    }
  }
  liveCatalogJson() {
    const providers = {};
    for (const [name, st] of this.states) {
      if (st.def.enabled === false)
        continue;
      providers[name] = {
        serving: this.servingModels(name),
        quarantined: [...st.quarantine.keys()].sort(),
        discovered: st.everDiscovered
      };
    }
    return {
      contract: "estate-pinax/live-catalog/v1",
      generatedAt: nowIso(),
      generator: "@toxicwind/pinax ModelCatalog \u2014 DO NOT EDIT BY HAND",
      deadIds: [...this.deadIds].sort(),
      providers
    };
  }
  static liveExportPathFor(statePath) {
    return statePath.endsWith(".json") ? statePath.slice(0, -5) + ".live.json" : statePath + ".live.json";
  }
  async saveToFile(path) {
    const run = this.saveChain.then(() => this.saveToFileInner(path));
    this.saveChain = run.catch(() => {});
    return run;
  }
  async saveToFileInner(path) {
    const data = JSON.stringify(this.toJSON(), null, 2) + `
`;
    await ModelCatalog.atomicWriteFile(path, data, () => `pstate-${this.nextTmpId()}`);
    await this.writeLiveCatalogInner(ModelCatalog.liveExportPathFor(path));
  }
  async writeLiveCatalog(path) {
    const run = this.saveChain.then(() => this.writeLiveCatalogInner(path));
    this.saveChain = run.catch(() => {});
    return run;
  }
  async writeLiveCatalogInner(path) {
    const data = JSON.stringify(this.liveCatalogJson(), null, 2) + `
`;
    await ModelCatalog.atomicWriteFile(path, data, () => `live-${this.nextTmpId()}`);
  }
  nextTmpId() {
    this.tmpCounter += 1;
    return `${process.pid}.${this.tmpCounter}.${Date.now()}`;
  }
  static async atomicWriteFile(path, data, tmpSuffix) {
    const { promises: fs } = await import("fs");
    const { dirname } = await import("path");
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
      const dir = await fs.open(dirname(path), "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }
  async loadFromFile(path) {
    try {
      const text = await Bun.file(path).text();
      this.loadJSON(JSON.parse(text));
      return true;
    } catch {
      return false;
    }
  }
  loadFromFileSync(path) {
    try {
      this.loadJSON(JSON.parse(readFileSync(path, "utf8")));
      return true;
    } catch {
      return false;
    }
  }
}
// src/data.ts
var PROVIDER_DEFS = [
  {
    name: "kimi-auto",
    displayName: "kimi-auto shim",
    baseUrl: "http://127.0.0.1:25153/v1",
    keyEnv: "KIMI_AUTO_SHIM_KEY",
    auth: "none",
    adapter: "static",
    staticModels: ["kimi-auto"],
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ],
    routerLocal: true
  },
  {
    name: "moonshot",
    displayName: "Moonshot AI",
    baseUrl: "https://api.moonshot.ai/v1",
    keyEnv: "MOONSHOT_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "moonshot-v1-8k",
      "moonshot-v1-32k",
      "moonshot-v1-128k",
      "kimi-k2-instruct"
    ]
  },
  {
    name: "omniroute",
    displayName: "OmniRoute (local gateway)",
    baseUrl: "http://127.0.0.1:20130/v1",
    keyEnv: "OMNIROUTE_GATEWAY_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ],
    contextLengths: {
      "cohere/north-mini-code:free": 128000,
      "google/gemma-4-26b-a4b-it:free": 1e6,
      "google/gemma-4-31b-it:free": 1e6,
      "inclusionai/ling-3.0-flash-fin:free": 256000,
      "inclusionai/ling-3.0-flash:free": 256000,
      "nvidia/nemotron-3-nano-30b-a3b:free": 256000,
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": 256000,
      "nvidia/nemotron-3-super-120b-a12b:free": 500000,
      "nvidia/nemotron-3-ultra-550b-a55b:free": 1e6,
      "nvidia/nemotron-nano-12b-v2-vl:free": 256000,
      "nvidia/nemotron-nano-9b-v2:free": 256000,
      "poolside/laguna-s-2.1:free": 256000,
      "poolside/laguna-xs-2.1:free": 256000
    }
  },
  {
    name: "nvidia",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    keyEnv: "NVIDIA_API_KEY",
    keyEnvAlt: "NVIDIA_API_KEYS,NIM_PROXY_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ],
    contextLengths: {
      "deepseek-ai/deepseek-v4.1-flash": 256000,
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": 256000,
      "nvidia/nemotron-3-super-120b-a12b": 500000,
      "nvidia/nemotron-3-ultra-550b-a55b": 1e6,
      "openai/gpt-oss-20b": 128000,
      "z-ai/glm-5.3": 200000,
      "z-ai/glm-5.3-flash": 200000
    }
  },
  {
    name: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ],
    contextLengths: {
      "llama-3.3-70b-versatile": 128000,
      "meta-llama/llama-4-scout-17b-16e-instruct": 1e6,
      "openai/gpt-oss-120b": 128000,
      "openai/gpt-oss-20b": 128000,
      "qwen/qwen3-32b": 128000,
      "qwen/qwen3.6-27b": 128000
    }
  },
  {
    name: "bitdeer",
    displayName: "Bitdeer AI",
    baseUrl: "https://api-inference.bitdeer.ai/v1",
    keyEnv: "BITDEER_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    keyEnv: "CEREBRAS_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ],
    contextLengths: {
      "mistral-large-latest": 256000,
      "mistral-medium-latest": 128000,
      "mistral-small-latest": 128000
    }
  },
  {
    name: "openai",
    baseUrl: "https://api.openai.com/v1",
    keyEnv: "OPENAI_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ],
    contextLengths: {
      "claude-fable-5": 500000,
      "claude-opus-5-5": 1e6,
      "claude-sonnet-5": 1e6,
      "claude-opus-4-5-20251101": 200000,
      "claude-sonnet-4-5-20250929": 200000
    }
  },
  {
    name: "deepseek",
    baseUrl: "https://api.deepseek.com",
    keyEnv: "DEEPSEEK_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ],
    contextLengths: {
      "deepseek-v4-flash": 256000,
      "deepseek-v4-pro": 256000,
      "deepseek-v3.2-chat": 256000
    }
  },
  {
    name: "freeinference",
    displayName: "FreeInference",
    baseUrl: "https://freeinference.org/v1",
    keyEnv: "FREEINFERENCE_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "glm-5.3-flash",
      "minimax-m3",
      "qwen3.6-35b",
      "diffusiongemma",
      "deepseek-v4-flash"
    ],
    contextLengths: {
      "glm-5.3-flash": 1e6,
      "minimax-m3": 1e6,
      "qwen3.6-35b": 262000,
      diffusiongemma: 262000,
      "deepseek-v4-flash": 1e6
    }
  },
  {
    name: "wandb",
    displayName: "W&B Inference",
    baseUrl: "https://api.inference.wandb.ai/v1",
    keyEnv: "WANDB_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ],
    contextLengths: {
      "grok-4.5": 2000000,
      "grok-4.6": 2000000
    }
  },
  {
    name: "together",
    baseUrl: "https://api.together.xyz/v1",
    keyEnv: "TOGETHER_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ],
    contextLengths: {
      "accounts/fireworks/models/glm-5.2-fast": 200000,
      "kimi-k2.7-code": 256000
    }
  },
  {
    name: "deepinfra",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    keyEnv: "DEEPINFRA_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ],
    contextLengths: {
      "kimi-k2.6": 256000,
      "kimi-k2.7-code": 256000,
      "kimi-k2-thinking": 256000
    }
  },
  {
    name: "sambanova",
    displayName: "SambaNova",
    baseUrl: "https://api.sambanova.ai/v1",
    keyEnv: "SAMBANOVA_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "siliconflow",
    baseUrl: "https://api.siliconflow.com/v1",
    keyEnv: "SILICONFLOW_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "novita",
    baseUrl: "https://api.novita.ai/openai/v1",
    keyEnv: "NOVITA_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "venice",
    baseUrl: "https://api.venice.ai/api/v1",
    keyEnv: "VENICE_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "aimlapi",
    baseUrl: "https://api.aimlapi.com/v1",
    keyEnv: "AIMLAPI_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "baseten",
    baseUrl: "https://inference.baseten.co/v1",
    keyEnv: "BASETEN_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "zai",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    keyEnv: "ZAI_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "zen",
    baseUrl: "https://opencode.ai/zen/v1",
    keyEnv: "OPENCODE_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "synthetic",
    baseUrl: "https://api.synthetic.new/openai/v1",
    keyEnv: "SYNTHETIC_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "wafer-serverless",
    baseUrl: "https://pass.wafer.ai/v1",
    keyEnv: "WAFER_SERVERLESS_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "qianfan",
    baseUrl: "https://qianfan.baidubce.com/v2",
    keyEnv: "QIANFAN_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "gmi-cloud",
    baseUrl: "https://api.gmi-serving.com/v1",
    keyEnv: "GMI_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "sakana",
    displayName: "Sakana AI",
    baseUrl: "https://api.sakana.ai/v1",
    keyEnv: "SAKANA_API_KEY",
    keyEnvAlt: "FUGU_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "abliteration",
    displayName: "Abliteration",
    baseUrl: "https://api.abliteration.ai/v1",
    keyEnv: "ABLITERATION_API_KEY",
    keyEnvAlt: "ABLIT_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "chutes",
    displayName: "Chutes",
    baseUrl: "https://inference.chutes.ai/v1",
    keyEnv: "CHUTES_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "bedrock-mantle",
    displayName: "Bedrock Mantle",
    baseUrl: "https://bedrock-mantle.{region}.api.aws/openai/v1",
    keyEnv: "AWS_BEARER_TOKEN_BEDROCK",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "ollama-cloud",
    displayName: "Ollama Cloud",
    baseUrl: "https://ollama.com/v1",
    keyEnv: "OLLAMA_CLOUD_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "cohere",
    displayName: "Cohere",
    baseUrl: "https://api.cohere.com/compatibility/v1",
    keyEnv: "COHERE_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "commandcode",
    displayName: "Command Code",
    baseUrl: "https://api.commandcode.ai/provider/v1",
    keyEnv: "COMMAND_CODE_API_KEY",
    keyEnvAlt: "COMMANDCODE_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "singularityapi-dev",
    displayName: "SingularityAPI",
    baseUrl: "https://api.singularityapi.dev/v1",
    keyEnv: "SINGULARITYAPI_DEV_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "hetzner",
    displayName: "Hetzner Inference",
    baseUrl: "https://inference.hetzner.com/api/v1",
    keyEnv: "HETZNER_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ],
    contextLengths: {
      "hyperbolic/llama-3.1-70b": 128000
    }
  },
  {
    name: "google",
    displayName: "Google (EAP interactions)",
    baseUrl: "http://127.0.0.1:25109/gemini-eap-interactions",
    keyEnv: "",
    auth: "none",
    adapter: "static",
    staticModels: [
      "models/gemini-flash-tool-retrieval",
      "models/gemini-3.8-flash",
      "models/gemini-3.7-flash",
      "models/gemini-3.6-flash",
      "models/gemini-3.5-flash",
      "models/gemini-3.1-pro-preview",
      "models/gemini-3-flash-preview",
      "models/gemini-2.5-flash"
    ],
    seeds: [],
    contextLengths: {
      "models/gemini-flash-tool-retrieval": 1e6,
      "models/gemini-3.8-flash": 1e6,
      "models/gemini-3.7-flash": 1e6,
      "models/gemini-3.6-flash": 1e6,
      "models/gemini-3.5-flash": 1e6,
      "models/gemini-3.1-pro-preview": 1e6,
      "models/gemini-3-flash-preview": 1e6,
      "models/gemini-2.5-flash": 1e6
    }
  },
  {
    name: "github",
    displayName: "GitHub Models",
    baseUrl: "https://models.github.ai/inference",
    keyEnv: "GITHUB_TOKEN",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "parasail",
    displayName: "Parasail",
    baseUrl: "https://api.parasail.io/v1",
    keyEnv: "PARASAIL_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ],
    contextLengths: {
      "perplexity/sonar": 200000
    }
  },
  {
    name: "dashscope",
    displayName: "Alibaba DashScope",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    keyEnv: "DASHSCOPE_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "sference",
    displayName: "sference",
    baseUrl: "https://api.sference.com/v1",
    keyEnv: "SFERENCE_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "minara",
    displayName: "Minara Cloud",
    baseUrl: "https://api.minara.ai/v1",
    keyEnv: "MINARA_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "cometapi",
    displayName: "CometAPI",
    baseUrl: "https://api.cometapi.com/v1",
    keyEnv: "COMETAPI_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "gpuai",
    displayName: "GPU.ai",
    baseUrl: "https://api.gpu.ai/v1",
    keyEnv: "GPUAI_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "inferbase",
    displayName: "Inferbase",
    baseUrl: "https://api.inferbase.ai/v1",
    keyEnv: "INFERBASE_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "onde",
    displayName: "Onde Cloud",
    baseUrl: "https://cloud.ondeinference.com/v1",
    keyEnv: "ONDE_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "inferen",
    displayName: "Inferen",
    baseUrl: "https://inferen.dev/v1",
    keyEnv: "INFEREN_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  },
  {
    name: "inception",
    displayName: "Inception Labs",
    baseUrl: "https://api.inceptionlabs.ai/v1",
    keyEnv: "INCEPTION_API_KEY",
    auth: "bearer",
    adapter: "openai",
    seeds: [
      "google/diffusiongemma-26b-a4b-it",
      "meta/llama-3.2-11b-vision-instruct",
      "meta/muse-glimmer-30b",
      "nvidia/ising-calibration-1.5-31b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-parse-2.0",
      "nvidia/riva-translate-4b-instruct-v1.1",
      "nvidia/riva-translate-4b-instruct-v2",
      "openai/gpt-oss-20b",
      "poolside/laguna-xs-2.1",
      "z-ai/glm-5.3-flash"
    ]
  }
];
var MODEL_ALIASES = {
  "nemotron-nano": ["nvidia", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"],
  "nim-nemotron-super": ["nvidia", "nvidia/nemotron-3-super-120b-a12b"],
  "nim-nemotron-omni": [
    "nvidia",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
  ],
  "nim-nemotron-nano": [
    "nvidia",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
  ],
  "nim-llama-3.1-70b": ["nvidia", "meta/llama-3.1-70b-instruct"],
  "nim-qwen3.5-397b": ["nvidia", "qwen/qwen3.5-397b-a17b"],
  "nim-qwen3.5-122b": ["nvidia", "qwen/qwen3.5-122b-a10b"],
  "nim-deepseek-v4-flash": ["nvidia", "deepseek-ai/deepseek-v4-flash"],
  "nim-deepseek-v4-pro": ["nvidia", "deepseek-ai/deepseek-v4-pro"],
  "nim-mistral-large-3": [
    "nvidia",
    "mistralai/mistral-large-3-675b-instruct-2512"
  ],
  "nim-gemma4-31b": ["nvidia", "google/gemma-4-31b-it"],
  "nim-glm5.2": ["nvidia", "z-ai/glm-5.2"],
  "nim-inkling": ["nvidia", "thinkingmachines/inkling"],
  "gemini-eap": ["google", "models/gemini-flash-tool-retrieval"],
  "gemini-3.8-flash": ["google", "models/gemini-3.8-flash"],
  "gemini-3.7-flash": ["google", "models/gemini-3.7-flash"],
  "gemini-3.6-flash": ["google", "models/gemini-3.6-flash"],
  "gemini-3.5-flash": ["google", "models/gemini-3.5-flash"],
  "gemini-3.1-pro": ["google", "models/gemini-3.1-pro-preview"],
  "gemini-3-flash": ["google", "models/gemini-3-flash-preview"],
  "gemini-2.5-flash": ["google", "models/gemini-2.5-flash"],
  "groq-llama-3.3-70b": ["groq", "llama-3.3-70b-versatile"],
  "groq-qwen3-32b": ["groq", "qwen/qwen3-32b"],
  "groq-qwen3.6-27b": ["groq", "qwen/qwen3.6-27b"],
  "groq-gpt-oss-120b": ["groq", "openai/gpt-oss-120b"],
  "groq-gpt-oss-20b": ["groq", "openai/gpt-oss-20b"],
  "groq-llama-4-scout": ["groq", "meta-llama/llama-4-scout-17b-16e-instruct"]
};
var DEAD_MODEL_IDS = [
  "moonshotai/kimi-k2-instruct",
  "meta/llama-3.1-8b-instruct",
  "meta-llama/llama-3.1-8b-instruct",
  "meta/llama-3.3-70b-instruct",
  "meta-llama/llama-3.3-70b-instruct",
  "meta-llama/llama-3.3-70b-instruct:free",
  "tencent/hy3:free",
  "poolside/laguna-m.1:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "qwen/qwen3-coder:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "openai/gpt-oss-20b:free",
  "llama-3.3-70b-versatile",
  "qwen/qwen3-32b",
  "qwen/qwen3.6-27b",
  "meta-llama/llama-4-scout-17b-16e-instruct"
];
// src/auto-loader.ts
var KNOWN_ENDPOINTS = {
  moonshot: "https://api.moonshot.ai/v1"
};
function keyEnvFor(id) {
  return `${id.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase()}_API_KEY`;
}
function displayNameFor(id) {
  return id.split(/[-_]+/).map((w) => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}
function synthesizeProviderDef(id, endpoint) {
  const baseUrl = endpoint ?? KNOWN_ENDPOINTS[id] ?? "";
  return {
    name: id,
    displayName: displayNameFor(id),
    baseUrl,
    keyEnv: keyEnvFor(id),
    auth: "bearer",
    adapter: "openai",
    seeds: [],
    autoGenerated: true
  };
}
function loadProviderDefs(staticDefs, opts = {}) {
  const byName = new Map;
  for (const d of staticDefs)
    byName.set(d.name, d);
  for (const d of opts.dropIns ?? [])
    byName.set(d.name, d);
  const synthesized = [];
  const endpoints = { ...KNOWN_ENDPOINTS, ...opts.endpoints ?? {} };
  const notify = opts.onSynthesize ?? ((id, def) => console.warn(`[pinax] provider "${id}" has no curated PROVIDER_DEFS entry \u2014 ` + `auto-synthesized best-effort def (keyEnv ${def.keyEnv}). ` + `Promote it to estate/mesh/catalog/src/data.ts to silence this.`));
  for (const id of opts.requiredIds ?? []) {
    if (!byName.has(id)) {
      const def = synthesizeProviderDef(id, endpoints[id]);
      byName.set(id, def);
      synthesized.push(id);
      notify(id, def);
    }
  }
  return { defs: [...byName.values()], synthesized, byName };
}
function loadCatalogProviderDefs(opts = {}) {
  return loadProviderDefs(PROVIDER_DEFS, opts);
}
async function loadDropInDefs(dir) {
  const { readdir, readFile } = await import("fs/promises");
  const { join } = await import("path");
  let files;
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(await readFile(join(dir, f), "utf8"));
      const defs = Array.isArray(raw) ? raw : raw.providers ?? [raw];
      for (const d of defs) {
        if (d && typeof d.name === "string")
          out.push(d);
      }
    } catch {}
  }
  return out;
}
// src/codegen.ts
function codegenTimestamp() {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/.test(epoch.trim())) {
    return new Date(Number(epoch.trim()) * 1000).toISOString();
  }
  return new Date().toISOString();
}
function jsonEscaped(s) {
  return JSON.stringify(s);
}
function goStringSlice(ids, elementIndent = "\t\t", closeIndent = "\t") {
  if (ids.length === 0)
    return "[]string{}";
  return `[]string{
${ids.map((id) => `${elementIndent}${jsonEscaped(id)},`).join(`
`)}
${closeIndent}}`;
}
function goAliasMap(m) {
  const keys = Object.keys(m).sort();
  if (keys.length === 0)
    return "map[string][2]string{}";
  const width = Math.max(...keys.map((k) => jsonEscaped(k).length));
  return `map[string][2]string{
${keys.map((k) => `	${jsonEscaped(k)}:${" ".repeat(width - jsonEscaped(k).length + 1)}{${jsonEscaped(m[k][0])}, ${jsonEscaped(m[k][1])}},`).join(`
`)}
}`;
}
function keyEnvsOf(d) {
  const out = [];
  if (d.keyEnv)
    out.push(d.keyEnv);
  for (const v of (d.keyEnvAlt ?? "").split(",")) {
    const t = v.trim();
    if (t)
      out.push(t);
  }
  return out;
}
function buildProvidersJson(input) {
  const doc = {
    $schema: "estate-pinax/v1",
    generatedAt: codegenTimestamp(),
    generator: "@toxicwind/pinax codegen \u2014 DO NOT EDIT BY HAND",
    ...input.provenance ? { provenance: input.provenance } : {},
    adapters: ["openai", "google-v1beta", "mistral", "static", "none"],
    providers: input.defs.map((d) => ({
      name: d.name,
      ...d.displayName ? { displayName: d.displayName } : {},
      baseUrl: d.baseUrl,
      keyEnv: d.keyEnv,
      ...d.keyEnvAlt ? { keyEnvAlt: d.keyEnvAlt } : {},
      keyEnvs: keyEnvsOf(d),
      adapter: d.adapter,
      ...d.modelsPath ? { modelsPath: d.modelsPath } : {},
      ...d.auth ? { auth: d.auth } : {},
      ...d.headerName ? { headerName: d.headerName } : {},
      ...d.queryParam ? { queryParam: d.queryParam } : {},
      ...d.extraHeaders ? { extraHeaders: d.extraHeaders } : {},
      ...d.staticModels ? { staticModels: d.staticModels } : {},
      ...d.noModelsReason ? { noModelsReason: d.noModelsReason } : {},
      ...d.enabled === false ? { enabled: false } : {},
      ...d.routerLocal ? { routerLocal: true } : {}
    })),
    seeds: Object.fromEntries(input.defs.map((d) => [d.name, d.seeds])),
    seedsContract: "Cold-start only: served while a provider has never had a successful discovery; inert afterwards. Never hand-edit model membership here \u2014 discovery owns it.",
    aliases: input.aliases,
    deadIds: [...input.deadIds].sort(),
    deadIdsContract: "Permanent hand-managed tier (EOL notices). Never served, never re-admitted by discovery."
  };
  return JSON.stringify(doc, null, 2) + `
`;
}
function buildProvidersKappaJson(input) {
  const generatedAt = codegenTimestamp();
  const provenance = input.provenance ? input.provenance : "unknown";
  const providerMap = {};
  for (const d of input.defs) {
    if (d.enabled === false || d.routerLocal || d.name === "herd") {
      continue;
    }
    const models = {};
    const modelIds = d.staticModels && d.staticModels.length > 0 ? d.staticModels : d.seeds && d.seeds.length > 0 ? d.seeds : [];
    for (const id of modelIds) {
      models[id] = {
        name: id,
        limit: {
          context: d.contextLengths?.[id] ?? 128000,
          output: 8192
        }
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
        apiKey
      },
      models
    };
  }
  const doc = {
    $schema: "https://app.kappa.ai/config.json",
    contract: "estate-pinax/kappa-catalog/v1",
    generator: "@toxicwind/pinax codegen \u2014 kappa target (full profile) \u2014 DO NOT EDIT BY HAND",
    provenance,
    generatedAt,
    deadIds: [...input.deadIds].sort(),
    aliases: input.aliases,
    seeds: Object.fromEntries(input.defs.map((d) => [d.name, d.seeds])),
    provider: providerMap,
    providers: input.defs.map((d) => ({
      name: d.name,
      ...d.displayName ? { displayName: d.displayName } : {},
      baseUrl: d.baseUrl,
      keyEnv: d.keyEnv,
      ...d.keyEnvAlt ? { keyEnvAlt: d.keyEnvAlt } : {},
      keyEnvs: keyEnvsOf(d),
      adapter: d.adapter,
      ...d.modelsPath ? { modelsPath: d.modelsPath } : {},
      ...d.auth ? { auth: d.auth } : {},
      ...d.headerName ? { headerName: d.headerName } : {},
      ...d.queryParam ? { queryParam: d.queryParam } : {},
      ...d.extraHeaders ? { extraHeaders: d.extraHeaders } : {},
      ...d.staticModels ? { staticModels: d.staticModels } : {},
      ...d.noModelsReason ? { noModelsReason: d.noModelsReason } : {},
      ...d.enabled === false ? { enabled: false } : {},
      ...d.routerLocal ? { routerLocal: true } : {}
    }))
  };
  return JSON.stringify(doc, null, 2) + `
`;
}
function buildInstalledKappaJson(input, env = process.env) {
  const present = (name) => {
    if (!name)
      return false;
    const v = env[name];
    return typeof v === "string" && v.trim().length > 0;
  };
  const defs = input.defs.filter((d) => {
    if (d.enabled === false || d.routerLocal)
      return false;
    if (d.name === "flock" || d.name === "herd" || d.name === "hodos" || d.auth === "none") {
      return true;
    }
    const pool = keyEnvsOf(d);
    if (pool.length === 0)
      return true;
    return pool.some(present);
  });
  const full = JSON.parse(buildProvidersKappaJson({ ...input, defs }));
  full.generator = "@toxicwind/pinax codegen \u2014 kappa target (installed profile) \u2014 DO NOT EDIT BY HAND";
  return JSON.stringify(full, null, 2) + `
`;
}
function buildProvidersGo(input) {
  const generatedAt = codegenTimestamp();
  const defStructs = input.defs.map((d) => {
    const fields = [
      `		Name:           ${jsonEscaped(d.name)},`,
      `		BaseURL:        ${jsonEscaped(d.baseUrl)},`,
      `		KeyEnv:         ${jsonEscaped(d.keyEnv)},`,
      `		KeyEnvAlt:      ${jsonEscaped(d.keyEnvAlt ?? "")},`,
      `		Adapter:        ${jsonEscaped(d.adapter)},`,
      `		Auth:           ${jsonEscaped(d.auth ?? "")},`,
      `		HeaderName:     ${jsonEscaped(d.headerName ?? "")},`,
      `		QueryParam:     ${jsonEscaped(d.queryParam ?? "")},`,
      `		ModelsPath:     ${jsonEscaped(d.modelsPath ?? "")},`,
      `		NoModelsReason: ${jsonEscaped(d.noModelsReason ?? "")},`,
      `		NoAuth:         ${d.auth === "none" ? "true" : "false"},`,
      `		RouterLocal:    ${d.routerLocal ? "true" : "false"},`,
      `		Enabled:        ${d.enabled === false ? "false" : "true"},`
    ];
    return `	{
${fields.join(`
`)}
	},`;
  }).join(`
`);
  const seedsGo = input.defs.map((d) => `	${jsonEscaped(d.name)}: ${goStringSlice(d.seeds)},`).join(`
`);
  const staticGo = input.defs.filter((d) => d.adapter === "static").map((d) => `	${jsonEscaped(d.name)}: ${goStringSlice(d.staticModels ?? [])},`).join(`
`);
  const provenance = input.provenance ? input.provenance : "unknown";
  return `// Code generated by @toxicwind/pinax \u2014 DO NOT EDIT BY HAND.
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
// membership \u2014 never add live models here. Seeds may name dead IDs; the
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
function rustStrSlice(ids) {
  if (ids.length === 0)
    return "&[]";
  return `&[${ids.map(jsonEscaped).join(", ")}]`;
}
function rustCtxLengths(m) {
  const entries = Object.keys(m).sort().map((k) => `(${jsonEscaped(k)}, ${Math.floor(m[k])}u64)`);
  return `&[${entries.join(", ")}]`;
}
function buildProvidersRust(input) {
  const generatedAt = codegenTimestamp();
  const provenance = input.provenance ? input.provenance : "unknown";
  const defs = input.defs.map((d) => {
    const fields = [
      `name: ${jsonEscaped(d.name)},`,
      `display_name: ${jsonEscaped(d.displayName ?? d.name)},`,
      `base_url: ${jsonEscaped(d.baseUrl)},`,
      `key_env: ${jsonEscaped(d.keyEnv)},`,
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
      `context_lengths: ${rustCtxLengths(d.contextLengths ?? {})},`
    ];
    return `    PinaxProvider {
${fields.map((f) => `        ${f}`).join(`
`)}
    },`;
  }).join(`
`);
  const deadIds = [...input.deadIds].sort();
  const aliases = Object.keys(input.aliases).sort().map((k) => `    (${jsonEscaped(k)}, ${jsonEscaped(input.aliases[k][0])}, ${jsonEscaped(input.aliases[k][1])}),`).join(`
`);
  return `// Code generated by @toxicwind/pinax \u2014 DO NOT EDIT BY HAND.
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
    /// Cold-start seeds ONLY. May name dead IDs \u2014 filter PINAX_DEAD_IDS.
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
function buildInstalledTauYaml(input, env) {
  const present = (name) => {
    if (!name)
      return false;
    const v = env[name];
    return typeof v === "string" && v.trim().length > 0;
  };
  const defs = input.defs.filter((d) => {
    if (d.enabled === false || d.routerLocal)
      return false;
    if (d.name === "flock" || d.name === "herd" || d.auth === "none")
      return true;
    const pool = keyEnvsOf(d);
    if (pool.length === 0)
      return true;
    return pool.some(present);
  });
  return buildProvidersTauYaml({ ...input, defs });
}
function buildProvidersTauYaml(input) {
  const generatedAt = codegenTimestamp();
  const provenance = input.provenance ? input.provenance : "unknown";
  const lines = [
    "# Code generated by @toxicwind/pinax for Tau \u2014 DO NOT EDIT BY HAND.",
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
    "      type: openai-models-list"
  ];
  for (const d of input.defs) {
    if (d.enabled === false || d.routerLocal || d.name === "herd" || d.name === "herd") {
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
      lines.push(`    models:`);
      for (const id of d.staticModels) {
        const ctx = d.contextLengths?.[id];
        lines.push(`      - id: ${id}`);
        if (ctx)
          lines.push(`        contextWindow: ${ctx}`);
      }
    }
  }
  return lines.join(`
`) + `
`;
}
async function emitAll(outDir, input) {
  const { promises: fs } = await import("fs");
  const { join } = await import("path");
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
export {
  ADAPTERS,
  AdapterParseError,
  DEAD_MODEL_IDS,
  KNOWN_ENDPOINTS,
  MODEL_ALIASES,
  ModelCatalog,
  PROVIDER_DEFS,
  PRUNE_AFTER_MISSES,
  adapterFor,
  buildInstalledKappaJson,
  buildInstalledTauYaml,
  buildProvidersGo,
  buildProvidersJson,
  buildProvidersKappaJson,
  buildProvidersRust,
  buildProvidersTauYaml,
  discover,
  displayNameFor,
  emitAll,
  keyEnvFor,
  loadCatalogProviderDefs,
  loadDropInDefs,
  loadProviderDefs,
  synthesizeProviderDef
};
