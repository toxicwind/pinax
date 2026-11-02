/**
 * Canonical provider data — the single source of truth for the estate.
 *
 * Reconciled 2026-09-30 from:
 * - estate/mesh/router/estate-scripts-router/estate-scripts-router-ts/router_config.ts
 *   (PROVIDERS, PROVIDER_MODELS, CODING, DEAD_MODEL_IDS)
 * - estate/mesh/router/bornite/internal/astmatrix/providers.go
 *   (defaultProviders, codingAlias)
 *
 * CONTRACT:
 * - `seeds` are cold-start data only (served pre-discovery, inert after).
 * - Membership of the live set is owned by discovery, never by this file.
 * - `deadIds` is the permanent EOL tier. Everything else prunes via
 *   quarantine (serve-404 or vanished-from-live-listing x2).
 */
import type { ModelAlias, ProviderDef } from "./types.ts";
export declare const PROVIDER_DEFS: ProviderDef[];
/**
 * MODEL_ALIASES — friendly alias → [provider, model] (UX layer).
 */
export declare const MODEL_ALIASES: Record<string, ModelAlias>;
/**
 * DEAD_MODEL_IDS — permanent EOL tier. Never served, never re-admitted.
 */
export declare const DEAD_MODEL_IDS: string[];
/**
 * Resolve the context window for a model id across all provider contextLengths maps.
 * Returns the first match found (provider order in PROVIDER_DEFS is priority order),
 * or undefined if no provider declares a context length for the model id.
 *
 * This is the estate SSOT for context windows — it replaces the stale bundled
 * models.json values that tau previously fell back to.
 */
export declare type ResolveContextResult = {
  modelId: string;
  contextLength: number;
  provider: string;
};
export declare function resolveContext(modelId: string): ResolveContextResult | undefined;