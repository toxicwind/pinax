/**
 * Endpoint-shape adapters: one parser per /models wire format.
 *
 * A new odd provider gets a new adapter here — provider-specific branches
 * never leak into routing or catalog logic. Each adapter is total on its
 * input contract and throws AdapterParseError on malformed bodies so the
 * discovery layer can record a clean failure (never served, never cached).
 */
import type { AdapterId, DiscoveredModels, ProviderDef } from "./types.ts";
export declare class AdapterParseError extends Error {
    readonly adapter: AdapterId;
    constructor(adapter: AdapterId, msg: string);
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
export declare const ADAPTERS: Record<AdapterId, ModelsAdapter>;
export declare function adapterFor(id: AdapterId): ModelsAdapter;
