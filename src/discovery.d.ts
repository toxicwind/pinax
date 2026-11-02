import type { ProviderDef } from "./types.ts";
export type DiscoveryResult = {
    ok: true;
    ids: string[];
    meta: Record<string, unknown>;
    fetchedAt: string;
} | {
    ok: false;
    error: string;
    status?: number;
    skipped?: boolean;
};
export interface DiscoverOptions {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    /** Defaults to process.env lookup. */
    getKey?: (env: string) => string | undefined;
}
export declare function discover(def: ProviderDef, opts?: DiscoverOptions): Promise<DiscoveryResult>;
