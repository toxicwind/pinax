/**
 * Live discovery: fetch a provider's /models listing through its adapter.
 *
 * Rules (borrowed: litellm-vscode-chat, opencode-litellm):
 * - Fetch failures (network, non-2xx, malformed body) are reported, never
 *   cached, never acted on — the catalog keeps serving last-known-good.
 * - A well-formed EMPTY listing is a valid zero-model result.
 * - Non-fetch adapters (static/none) resolve deterministically and count as
 *   successful discoveries.
 * - The fetch implementation and key source are injectable for tests.
 */
import { adapterFor, AdapterParseError } from "./adapters.ts";
import type { DiscoveredModels, ProviderDef } from "./types.ts";

export type DiscoveryResult =
  | {
      ok: true;
      ids: string[];
      meta: Record<string, unknown>;
      fetchedAt: string;
    }
  | { ok: false; error: string; status?: number; skipped?: boolean };

export interface DiscoverOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Defaults to process.env lookup. */
  getKey?: (env: string) => string | undefined;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function defaultGetKey(env: string): string | undefined {
  try {
    return process.env[env];
  } catch {
    return undefined;
  }
}

export async function discover(
  def: ProviderDef,
  opts: DiscoverOptions = {},
): Promise<DiscoveryResult> {
  const adapter = adapterFor(def.adapter);

  if (def.enabled === false)
    return { ok: false, error: `provider "${def.name}" disabled`, skipped: true };

  if (!adapter.needsFetch) {
    let parsed: DiscoveredModels;
    try {
      parsed = adapter.parse(undefined, def);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
    return {
      ok: true,
      ids: parsed.ids,
      meta: { ...(parsed.meta ?? {}), fetchedAt: new Date().toISOString() },
      fetchedAt: new Date().toISOString(),
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
  let res: Response;
  try {
    res = await fetchImpl(req.url, {
      headers: req.headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `fetch failed: ${msg}` };
  }

  if (!res.ok) {
    // Drain a bounded prefix for diagnostics; never treat the body as data.
    let hint = "";
    try {
      hint = (await res.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      error: `HTTP ${res.status} from ${def.name}/models${hint ? `: ${hint}` : ""}`,
      status: res.status,
    };
  }

  let body: unknown;
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
      meta: { ...(parsed.meta ?? {}), httpStatus: res.status, fetchedAt },
      fetchedAt,
    };
  } catch (err) {
    const msg =
      err instanceof AdapterParseError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return { ok: false, error: `parse failed for ${def.name}/models: ${msg}`, status: res.status };
  }
}
