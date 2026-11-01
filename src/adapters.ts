/**
 * Endpoint-shape adapters: one parser per /models wire format.
 *
 * A new odd provider gets a new adapter here — provider-specific branches
 * never leak into routing or catalog logic. Each adapter is total on its
 * input contract and throws AdapterParseError on malformed bodies so the
 * discovery layer can record a clean failure (never served, never cached).
 */
import type {
  AdapterId,
  AuthStyle,
  DiscoveredModels,
  ProviderDef,
} from "./types.ts";

export class AdapterParseError extends Error {
  readonly adapter: AdapterId;
  constructor(adapter: AdapterId, msg: string) {
    super(`[${adapter}] ${msg}`);
    this.name = "AdapterParseError";
    this.adapter = adapter;
  }
}

export interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
}

export interface ModelsAdapter {
  id: AdapterId;
  /** False for adapters that carry their list in the definition (no HTTP). */
  needsFetch: boolean;
  /** Default models path appended to baseUrl when the def omits modelsPath. */
  defaultPath: string;
  buildRequest(def: ProviderDef, key: string | undefined): BuiltRequest;
  /** Parse a decoded JSON body into model ids. Throws AdapterParseError. */
  parse(body: unknown, def: ProviderDef): DiscoveredModels;
}

function authHeaders(
  auth: AuthStyle | undefined,
  key: string | undefined,
  def: ProviderDef,
): { headers: Record<string, string>; query: string } {
  const headers: Record<string, string> = { ...(def.extraHeaders ?? {}) };
  let query = "";
  const style: AuthStyle = auth ?? (key ? "bearer" : "none");
  if (style === "bearer" && key) headers["authorization"] = `Bearer ${key}`;
  else if (style === "x-api-key" && key)
    headers[def.headerName ?? "x-api-key"] = key;
  else if (style === "query-key" && key)
    query = `?${encodeURIComponent(def.queryParam ?? "key")}=${encodeURIComponent(key)}`;
  return { headers, query };
}

function idsFromDataArray(adapter: AdapterId, body: unknown): string[] {
  if (typeof body !== "object" || body === null)
    throw new AdapterParseError(adapter, "body is not an object");
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data))
    throw new AdapterParseError(adapter, 'missing "data" array');
  const ids: string[] = [];
  for (const item of data) {
    if (typeof item === "object" && item !== null) {
      const id = (item as { id?: unknown }).id;
      if (typeof id === "string" && id.length > 0) ids.push(id);
    }
  }
  return ids;
}

const openaiAdapter: ModelsAdapter = {
  id: "openai",
  needsFetch: true,
  defaultPath: "/models",
  buildRequest(def, key) {
    const path = def.modelsPath ?? this.defaultPath;
    const { headers, query } = authHeaders(def.auth, key, def);
    return { url: `${def.baseUrl}${path}${query}`, headers };
  },
  parse(body) {
    // { data: [{ id, ... }] } — a well-formed EMPTY data array is a valid
    // zero-model listing, not an error (never fall back to stale data).
    return { ids: idsFromDataArray("openai", body), meta: { adapter: "openai" } };
  },
};

const mistralAdapter: ModelsAdapter = {
  id: "mistral",
  needsFetch: true,
  defaultPath: "/v1/models",
  buildRequest(def, key) {
    const path = def.modelsPath ?? this.defaultPath;
    const { headers, query } = authHeaders(def.auth, key, def);
    return { url: `${def.baseUrl}${path}${query}`, headers };
  },
  parse(body) {
    // Native Mistral shape today: { object: "list", data: [{ id, ... }] }.
    // Pinned as its own adapter so a future divergence is a one-parser fix.
    if (
      typeof body === "object" &&
      body !== null &&
      (body as { object?: unknown }).object !== undefined &&
      (body as { object?: unknown }).object !== "list"
    )
      throw new AdapterParseError("mistral", 'unexpected "object" discriminator');
    return { ids: idsFromDataArray("mistral", body), meta: { adapter: "mistral" } };
  },
};

const googleV1betaAdapter: ModelsAdapter = {
  id: "google-v1beta",
  needsFetch: true,
  defaultPath: "/v1beta/models",
  buildRequest(def, key) {
    const path = def.modelsPath ?? this.defaultPath;
    // Google native auth: API key as ?key= query param (or x-goog-api-key).
    const withQuery = {
      ...def,
      auth: def.auth ?? ("query-key" as AuthStyle),
      queryParam: def.queryParam ?? "key",
    };
    const { headers, query } = authHeaders(withQuery.auth, key, withQuery);
    return { url: `${def.baseUrl}${path}${query}`, headers };
  },
  parse(body) {
    // { models: [{ name: "models/gemini-...", ... }] }
    if (typeof body !== "object" || body === null)
      throw new AdapterParseError("google-v1beta", "body is not an object");
    const models = (body as { models?: unknown }).models;
    if (!Array.isArray(models))
      throw new AdapterParseError("google-v1beta", 'missing "models" array');
    const ids: string[] = [];
    for (const m of models) {
      if (typeof m === "object" && m !== null) {
        const name = (m as { name?: unknown }).name;
        if (typeof name === "string" && name.length > 0)
          ids.push(name.startsWith("models/") ? name.slice("models/".length) : name);
      }
    }
    return { ids, meta: { adapter: "google-v1beta" } };
  },
};

const staticAdapter: ModelsAdapter = {
  id: "static",
  needsFetch: false,
  defaultPath: "",
  buildRequest() {
    throw new AdapterParseError("static", "static adapter never fetches");
  },
  parse(_body, def) {
    // Deterministic: counts as a successful discovery so seeds go inert.
    return {
      ids: [...(def.staticModels ?? [])],
      meta: { adapter: "static" },
    };
  },
};

const noneAdapter: ModelsAdapter = {
  id: "none",
  needsFetch: false,
  defaultPath: "",
  buildRequest() {
    throw new AdapterParseError("none", "none adapter never fetches");
  },
  parse(_body, def) {
    // Declared no /models endpoint: success with zero models (expected-
    // failure declaration — one info line at discovery, no error noise).
    return {
      ids: [],
      meta: { adapter: "none", reason: def.noModelsReason ?? "no /models endpoint" },
    };
  },
};

export const ADAPTERS: Record<AdapterId, ModelsAdapter> = {
  openai: openaiAdapter,
  mistral: mistralAdapter,
  "google-v1beta": googleV1betaAdapter,
  static: staticAdapter,
  none: noneAdapter,
};

export function adapterFor(id: AdapterId): ModelsAdapter {
  const a = ADAPTERS[id];
  if (!a) throw new AdapterParseError(id, `unknown adapter "${id}"`);
  return a;
}
