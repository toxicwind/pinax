/**
 * Canonical provider data — the single source of truth for the estate.
 *
 * Reconciled 2026-09-30 from:
 * - estate/mesh/router/estate-scripts-router/estate-scripts-router-ts/router_config.ts
 *   (PROVIDERS, PROVIDER_MODELS, CODING, DEAD_MODEL_IDS)
 * - estate/mesh/router/herd/internal/astmatrix/providers.go
 *   (defaultProviders, codingAlias)
 *
 * Reconciliation notes (newer audit wins on conflict):
 * - openrouter seeds: TS 2026-09-21 sweep (4 verified) ∪ herd 2026-07-28
 *   list minus openai/gpt-oss-20b:free (delisted 2026-09-21 → deadIds).
 * - nvidia seeds: TS 12 (superset of herd's minus meta/llama-3.3-70b-instruct,
 *   EOL 2026-08-26 → deadIds). Herd gains nemotron-3-nano-omni-30b-a3b-reasoning.
 * - groq seeds: identical in both (6); the 4 verified-dead 2026-09-30 stay
 *   in seeds but are filtered by deadIds everywhere (cold start included).
 * - herd seeds: the canonical stable role names. The TS router
 *   overlays its runtime LOCAL_ROLES (best-models.json) at catalog build;
 *   herd serves these names directly.
 * - mistral: baseUrl WITHOUT the /v1 segment; the mistral adapter appends
 *   /v1/models via the default modelsPath. (The old `${base}/models`
 *   composition would have produced /v1/models correctly only by accident
 *   of the hardcoded base; the package composes it explicitly.)
 * - google: configured against the v1beta/openai compat endpoint, so the
 *   adapter is "openai". The native "google-v1beta" adapter exists for
 *   providers that stop using /openai.
 * - kimi-auto: static ["kimi-auto"] — the shim's virtual model is the whole
 *   list (adapter "none" would wrongly demote the seed after one refresh).
 * - nim-local / kimi-auto are TS-router-local concepts (local proxy + shim);
 *   marked routerLocal: true — herd and other consumers skip them by flag,
 *   no name denylist.
 * - keyEnvAlt for nvidia is NVIDIA_API_KEYS (TS multi-key pool, the live
 *   semantic). Herd previously used NVIDIA_NIM_API_KEY as its alt.
 * - aliases: union of TS CODING + herd codingAlias, restricted to pairs
 *   whose provider is one of the 9 core defs. Excluded: strategy
 *   directives (auto/fcm/free → null, router-local), runtime-dynamic
 *   local-role aliases (router-local overlays), aliases pointing at
 *   deadIds (nim-llama-3.3-70b, gpt-oss-20b — removed by the TS 2026-09-21
 *   sweep), and extended-registry aliases (opencode, xai-*, mimo-auto,
 *   perplexity-sonar, together-llama-3.3 — they belong to herd's registry
 *   layer, which stays in registry.go).
 * - Conflict resolutions (newer TS audit wins): nemotron-nano and
 *   nim-nemotron-nano point at the nvidia reasoning model, not the
 *   openrouter :free form.
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
 *
 * Union of estate-scripts-router-ts CODING and herd codingAlias (see header for
 * the exclusion rules). Strategy directives and runtime-dynamic local-role
 * aliases stay router-local overlays.
 */
export declare const MODEL_ALIASES: Record<string, ModelAlias>;
/**
 * DEAD_MODEL_IDS — permanent EOL tier. Never served, never re-admitted.
 *
 * - NVIDIA 410-retired (EOL dates from the retirement notices, 2026-09-21).
 * - OpenRouter-delisted (verified against the public /models list 2026-09-21).
 * - Groq 404-verified (live re-verification 2026-09-30).
 */
export declare const DEAD_MODEL_IDS: string[];
