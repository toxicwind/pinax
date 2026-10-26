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

export const PROVIDER_DEFS: ProviderDef[] = [
  // 2026-10-13: `herd` deleted per Chris's order. Local herd models
  // (llama-swap :25100) are not ready; the catalog must not advertise
  // them. Working chain: cuttinggate :25200 -> flock :25193 -> vans.
  // 2026-10-09: `nim-local` deleted. It declared baseUrl 127.0.0.1:8000/v1,
  // which violated the estate port SSOT (all 25xxx, config/ports.env) and
  // contributed ZERO models to the live fleet (verified: 0 nim-local-prefixed
  // ids in the 2999 served by omniroute:20130). The listener was the
  // `nim-proxy` docker container (ghcr.io/miztertea/nim-proxy), which was
  // measured to be a pure pass-through: 80 model ids, 80 identical to
  // integrate.api.nvidia.com, zero unique on either side, identical
  // created/id/object/owned_by fields. The `nvidia` entry below already
  // covers this upstream; a second key adds no reachable model.
  {
    name: "kimi-auto",
    displayName: "kimi-auto shim",
    // 2026-10-02: :25105 is mesh-front/prometheus, not kimi-auto -- the kimi-auto alias-shim is :25153 (200 on /v1/models).
    // 2026-10-09 (verified): the shim currently serves NOTHING. herd lists 52
    // models and none of the six targets in its chain exist any more
    // (openrouter-free/*, hf-free/*, nim-kimi/* all gone), so every completion
    // returns 404 "no router for requested model". Zero free Kimi remains
    // upstream: OpenRouter lists 9 Kimi variants, all priced
    // (0.00000045..0.0000006 $/tok) with no `:free` suffix on any of them.
    // Kept registered (not deleted) so the pitchfork daemon and the
    // herd.d/kimi-auto.yaml fragment remain the single source of truth; this
    // comment is the record of why it cannot serve.
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
      "z-ai/glm-5.3-flash",
    ],
    routerLocal: true,
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
      "kimi-k2-instruct",
    ],
  },
  {
    name: "omniroute",
    displayName: "OmniRoute (local gateway)",
    // 2026-10-09: :20130 is OmniRoute (config/ports.env OMNIROUTE_PORT) --
    // the multi-provider aggregator with its own dashboard at
    // https://estate.tailc9ac71.ts.net:8443. Distinct from VansRouter (:20128);
    // both are registered so neither shadows the other. Gateway auth uses a
    // key minted in the dashboard (API Keys -> estate-gateway), not the
    // per-provider upstream keys that live inside its DB.
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
      "z-ai/glm-5.3-flash",
    ],
    contextLengths: {
      "cohere/north-mini-code:free": 128000,
      "google/gemma-4-26b-a4b-it:free": 1000000,
      "google/gemma-4-31b-it:free": 1000000,
      "inclusionai/ling-3.0-flash-fin:free": 256000,
      "inclusionai/ling-3.0-flash:free": 256000,
      "nvidia/nemotron-3-nano-30b-a3b:free": 256000,
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": 256000,
      "nvidia/nemotron-3-super-120b-a12b:free": 500000,
      "nvidia/nemotron-3-ultra-550b-a55b:free": 1000000,
      "nvidia/nemotron-nano-12b-v2-vl:free": 256000,
      "nvidia/nemotron-nano-9b-v2:free": 256000,
      "poolside/laguna-s-2.1:free": 256000,
      "poolside/laguna-xs-2.1:free": 256000
    },
  },
  {
    name: "nvidia",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    keyEnv: "NVIDIA_API_KEY",
    // N-key pool: comma-separated. NVIDIA_API_KEYS is the multi-key var;
    // NIM_PROXY_API_KEY is the retired nim-proxy container's key, which was
    // measured 5/5 on completions vs the estate cloud key's 3/5 (5 head-to-head
    // trials, 2026-10-09) — same 80-model upstream reachable through either.
    keyEnvAlt: "NVIDIA_API_KEYS,NIM_PROXY_API_KEY",
    auth: "bearer",
    adapter: "openai",
    // Seeds are the entitlement-verified working set (2026-10-03
    // audit of integrate.api.nvidia.com: 81 catalog models probed
    // across all account keys, 7 return real completions). The
    // removed seeds are entitlement-gated (404 "Function not found
    // for account") or dead/hanging on every key.
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
      "z-ai/glm-5.3-flash",
    ],
    contextLengths: {
      "deepseek-ai/deepseek-v4.1-flash": 256000,
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": 256000,
      "nvidia/nemotron-3-super-120b-a12b": 500000,
      "nvidia/nemotron-3-ultra-550b-a55b": 1000000,
      "openai/gpt-oss-20b": 128000,
      "z-ai/glm-5.3": 200000,
      "z-ai/glm-5.3-flash": 200000
    },
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
      "z-ai/glm-5.3-flash",
    ],
    contextLengths: {
      "llama-3.3-70b-versatile": 128000,
      "meta-llama/llama-4-scout-17b-16e-instruct": 1000000,
      "openai/gpt-oss-120b": 128000,
      "openai/gpt-oss-20b": 128000,
      "qwen/qwen3-32b": 128000,
      "qwen/qwen3.6-27b": 128000
    },
  },
  {
    name: "bitdeer",
    displayName: "Bitdeer AI",
    baseUrl: "https://api-inference.bitdeer.ai/v1",
    keyEnv: "BITDEER_API_KEY",
    auth: "bearer",
    adapter: "openai",
    // /v1/models 401s without a key (verified live 2026-09-30) — real endpoint.
    // Seeds from Bitdeer's own docs (developers.bitdeer.ai) + community spot
    // checks. Catalog: GLM, Kimi, Qwen, MiniMax, Nemotron, DeepSeek, MiMo.
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
      "z-ai/glm-5.3-flash",
    ],
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
      "z-ai/glm-5.3-flash",
    ],
    contextLengths: {
      "mistral-large-latest": 256000,
      "mistral-medium-latest": 128000,
      "mistral-small-latest": 128000
    },
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
      "z-ai/glm-5.3-flash",
    ],
    contextLengths: {
      "claude-fable-5": 500000,
      "claude-opus-5-5": 1000000,
      "claude-sonnet-5": 1000000,
      "claude-opus-4-5-20251101": 200000,
      "claude-sonnet-4-5-20250929": 200000
    },
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
      "z-ai/glm-5.3-flash",
    ],
    contextLengths: {
      "deepseek-v4-flash": 256000,
      "deepseek-v4-pro": 256000,
      "deepseek-v3.2-chat": 256000
    },
  },
  {
    name: "freeinference",
    displayName: "FreeInference",
    baseUrl: "https://freeinference.org/v1",
    keyEnv: "FREEINFERENCE_API_KEY",
    auth: "bearer",
    adapter: "openai",
    // Verified live 2026-10-13: keyed GET /v1/models returns these 6;
    // chat completions 200 on qwen3.6-35b. bge-m3 is embeddings-only
    // so it stays out of chat seeds.
    seeds: [
      "glm-5.3-flash",
      "minimax-m3",
      "qwen3.6-35b",
      "diffusiongemma",
      "deepseek-v4-flash",
    ],
    contextLengths: {
      "glm-5.3-flash": 1000000,
      "minimax-m3": 1000000,
      "qwen3.6-35b": 262000,
      "diffusiongemma": 262000,
      "deepseek-v4-flash": 1000000,
    },
  },
  {
    name: "wandb",
    displayName: "W&B Inference",
    baseUrl: "https://api.inference.wandb.ai/v1",
    keyEnv: "WANDB_API_KEY",
    auth: "bearer",
    adapter: "openai",
    // /v1/models 401s without a key (verified live 2026-09-30) — serverless
    // inference, $100/mo free-credit tier per free-llm-api-hub. Seeds empty.
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
      "z-ai/glm-5.3-flash",
    ],
    contextLengths: {
      "grok-4.5": 2000000,
      "grok-4.6": 2000000
    },
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
      "z-ai/glm-5.3-flash",
    ],
    contextLengths: {
      "accounts/fireworks/models/glm-5.2-fast": 200000,
      "kimi-k2.7-code": 256000
    },
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
      "z-ai/glm-5.3-flash",
    ],
    contextLengths: {
      "kimi-k2.6": 256000,
      "kimi-k2.7-code": 256000,
      "kimi-k2-thinking": 256000
    },
  },
  {
    name: "sambanova",
    displayName: "SambaNova",
    baseUrl: "https://api.sambanova.ai/v1",
    keyEnv: "SAMBANOVA_API_KEY",
    auth: "bearer",
    adapter: "openai",
    // /v1/models lists WITHOUT a key (verified live 2026-09-30); completions
    // need a key. Seeds are the live no-auth listing.
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
      "z-ai/glm-5.3-flash",
    ],
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
      "z-ai/glm-5.3-flash",
    ],
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
      "z-ai/glm-5.3-flash",
    ],
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
      "z-ai/glm-5.3-flash",
    ],
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
      "z-ai/glm-5.3-flash",
    ],
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
      "z-ai/glm-5.3-flash",
    ],
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
      "z-ai/glm-5.3-flash",
    ],
  },
  {
    // OpenCode Zen free tier (opencode.ai/zen/v1). Client-identity headers
    // (opencode UA + x-opencode-*) are injected by the strategy layer;
    // see cuttinggate/src/strategy/router_strategy.ts and
    // estate-scripts-router-ts/router_strategy.ts. Anonymous quota is gated on
    // those headers; Chris-provided OPENCODE_API_KEY via secrets.
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
      "z-ai/glm-5.3-flash",
    ],
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
      "z-ai/glm-5.3-flash",
    ],
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
      "z-ai/glm-5.3-flash",
    ],
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
      "z-ai/glm-5.3-flash",
    ],
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
      "z-ai/glm-5.3-flash",
    ],
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
      "z-ai/glm-5.3-flash",
    ],
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
      "z-ai/glm-5.3-flash",
    ],
  },
  {
    name: "chutes",
    displayName: "Chutes",
    baseUrl: "https://inference.chutes.ai/v1",
    keyEnv: "CHUTES_API_KEY",
    auth: "bearer",
    adapter: "openai",
    // /v1/models 401s without a key (verified live 2026-09-30) — decentralized
    // GPU compute (Bittensor), OpenAI-compatible. Seeds empty until keyed.
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
      "z-ai/glm-5.3-flash",
    ],
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
      "z-ai/glm-5.3-flash",
    ],
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
      "z-ai/glm-5.3-flash",
    ],
  },
  {
    name: "cohere",
    displayName: "Cohere",
    baseUrl: "https://api.cohere.com/compatibility/v1",
    keyEnv: "COHERE_API_KEY",
    auth: "bearer",
    adapter: "openai",
    // /compatibility/v1/models 401s without a key (verified live 2026-09-30).
    // Command model IDs are Cohere's stable OpenAI-compat slugs.
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
      "z-ai/glm-5.3-flash",
    ],
  },
  {
    name: "commandcode",
    displayName: "Command Code",
    // 2026-10-02: /provider/models 404s; /provider/v1/models 200s with 85-model open listing.
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
      "z-ai/glm-5.3-flash",
    ],
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
      "z-ai/glm-5.3-flash",
    ],
  },
  {
    name: "hetzner",
    displayName: "Hetzner Inference",
    baseUrl: "https://inference.hetzner.com/api/v1",
    keyEnv: "HETZNER_API_KEY",
    auth: "bearer",
    adapter: "openai",
    // /api/v1/models 401s without a key (verified live 2026-09-30) — free
    // experimental endpoint (announced 2026-07-24, experiments.hetzner.com).
    // Model list unknowable without a key; seeds empty per cold-start contract.
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
      "z-ai/glm-5.3-flash",
    ],
    contextLengths: {
      "hyperbolic/llama-3.1-70b": 128000
    },
  },
  {
    name: "google",
    displayName: "Google (EAP interactions)",
    // keypool injects one of the six gen-lang-client-0111199472 EAP keys per
    // request and rewrites OpenAI bodies onto the Interactions API, so there is
    // no client credential and no /models endpoint to read. auth "none" +
    // staticModels is the honest shape; the previous keyEnv: GOOGLE_API_KEY
    // named a secret that no longer exists and 401'd every request.
    // Restored 2026-10-16: cut by accident in 63689c5; the flock overlay's
    // EAP entry (and :25109 keypool sidecar) still depend on it.
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
      "models/gemini-2.5-flash",
    ],
    seeds: [],
    contextLengths: {
      "models/gemini-flash-tool-retrieval": 1000000,
      "models/gemini-3.8-flash": 1000000,
      "models/gemini-3.7-flash": 1000000,
      "models/gemini-3.6-flash": 1000000,
      "models/gemini-3.5-flash": 1000000,
      "models/gemini-3.1-pro-preview": 1000000,
      "models/gemini-3-flash-preview": 1000000,
      "models/gemini-2.5-flash": 1000000,
    },
  },
  {
    name: "github",
    displayName: "GitHub Models",
    // 2026-10-02: models.inference.ai.azure.com is DNS-dead; GitHub Models moved to models.github.ai.
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
      "z-ai/glm-5.3-flash",
    ],
  },
  {
    name: "parasail",
    displayName: "Parasail",
    baseUrl: "https://api.parasail.io/v1",
    keyEnv: "PARASAIL_API_KEY",
    auth: "bearer",
    adapter: "openai",
    // /v1/models 401s without a key (verified live 2026-09-30) — serverless
    // GPU deployments, OpenAI-compatible. Seeds empty until keyed.
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
      "z-ai/glm-5.3-flash",
    ],
    contextLengths: {
      "perplexity/sonar": 200000
    },
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
      "z-ai/glm-5.3-flash",
    ],
  },
  {
    name: "sference",
    displayName: "sference",
    baseUrl: "https://api.sference.com/v1",
    keyEnv: "SFERENCE_API_KEY",
    auth: "bearer",
    adapter: "openai",
    // /v1/models lists WITHOUT a key (verified live 2026-10-02); EU-hosted,
    // three latency tiers. Seeds are the live no-auth listing.
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
      "z-ai/glm-5.3-flash",
    ],
  },
  {
    name: "minara",
    displayName: "Minara Cloud",
    baseUrl: "https://api.minara.ai/v1",
    keyEnv: "MINARA_API_KEY",
    auth: "bearer",
    adapter: "openai",
    // /v1/models lists WITHOUT a key (verified live 2026-10-02, 125 models);
    // aggregator-style gateway with gateway-side failover.
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
      "z-ai/glm-5.3-flash",
    ],
  },
  {
    name: "cometapi",
    displayName: "CometAPI",
    baseUrl: "https://api.cometapi.com/v1",
    keyEnv: "COMETAPI_API_KEY",
    auth: "bearer",
    adapter: "openai",
    // /v1/models 401s without a key (verified live 2026-10-02); 500+ models
    // claimed. Seeds empty until keyed.
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
      "z-ai/glm-5.3-flash",
    ],
  },
  {
    name: "gpuai",
    displayName: "GPU.ai",
    baseUrl: "https://api.gpu.ai/v1",
    keyEnv: "GPUAI_API_KEY",
    auth: "bearer",
    adapter: "openai",
    // /v1/models 401s without a key (verified live 2026-10-02); multimodal
    // serverless (chat+image+video+embeddings). Seeds empty until keyed.
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
      "z-ai/glm-5.3-flash",
    ],
  },
  {
    name: "inferbase",
    displayName: "Inferbase",
    baseUrl: "https://api.inferbase.ai/v1",
    keyEnv: "INFERBASE_API_KEY",
    auth: "bearer",
    adapter: "openai",
    // /v1/models lists WITHOUT a key (verified live 2026-10-02, 137 models);
    // AI gateway with LLM routing. Seeds are flagship chat IDs from the live listing.
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
      "z-ai/glm-5.3-flash",
    ],
  },
  {
    name: "onde",
    displayName: "Onde Cloud",
    baseUrl: "https://cloud.ondeinference.com/v1",
    keyEnv: "ONDE_API_KEY",
    auth: "bearer",
    adapter: "openai",
    // /v1/models lists WITHOUT a key (verified live 2026-10-02, 15 proprietary onde-* models).
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
      "z-ai/glm-5.3-flash",
    ],
  },
  {
    name: "inferen",
    displayName: "Inferen",
    baseUrl: "https://inferen.dev/v1",
    keyEnv: "INFEREN_API_KEY",
    auth: "bearer",
    adapter: "openai",
    // /v1/models 401s without a key (verified live 2026-10-02). Seeds empty until keyed.
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
      "z-ai/glm-5.3-flash",
    ],
  },
  {
    name: "inception",
    displayName: "Inception Labs",
    baseUrl: "https://api.inceptionlabs.ai/v1",
    keyEnv: "INCEPTION_API_KEY",
    auth: "bearer",
    adapter: "openai",
    // Catch-up flagged by sweep-2: predates the window but verified alive 2026-10-02;
    // /v1/models lists WITHOUT a key (mercury-2, mercury-2.5).
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
      "z-ai/glm-5.3-flash",
    ],
  },
];

/**
 * MODEL_ALIASES — friendly alias → [provider, model] (UX layer).
 *
 * Union of estate-scripts-router-ts CODING and herd codingAlias (see header for
 * the exclusion rules). Strategy directives and runtime-dynamic local-role
 * aliases stay router-local overlays.
 */
export const MODEL_ALIASES: Record<string, ModelAlias> = {
  "nemotron-nano": ["nvidia", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"],
  "nim-nemotron-super": ["nvidia", "nvidia/nemotron-3-super-120b-a12b"],
  "nim-nemotron-omni": [
    "nvidia",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  ],
  "nim-nemotron-nano": [
    "nvidia",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  ],
  "nim-llama-3.1-70b": ["nvidia", "meta/llama-3.1-70b-instruct"],
  "nim-qwen3.5-397b": ["nvidia", "qwen/qwen3.5-397b-a17b"],
  "nim-qwen3.5-122b": ["nvidia", "qwen/qwen3.5-122b-a10b"],
  "nim-deepseek-v4-flash": ["nvidia", "deepseek-ai/deepseek-v4-flash"],
  "nim-deepseek-v4-pro": ["nvidia", "deepseek-ai/deepseek-v4-pro"],
  "nim-mistral-large-3": [
    "nvidia",
    "mistralai/mistral-large-3-675b-instruct-2512",
  ],
  "nim-gemma4-31b": ["nvidia", "google/gemma-4-31b-it"],
  "nim-glm5.2": ["nvidia", "z-ai/glm-5.2"],
  "nim-inkling": ["nvidia", "thinkingmachines/inkling"],
  // google routes to the EAP interactions pool; gemini-2.0-flash,
  // gemini-2.5-flash-lite and gemma-4-31b-it are NOT in that project's model
  // list (verified 2026-10-02 against GET /v1beta/models) and were dropped.
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
  "groq-llama-4-scout": ["groq", "meta-llama/llama-4-scout-17b-16e-instruct"],
};

/**
 * DEAD_MODEL_IDS — permanent EOL tier. Never served, never re-admitted.
 *
 * - NVIDIA 410-retired (EOL dates from the retirement notices, 2026-09-21).
 * - OpenRouter-delisted (verified against the public /models list 2026-09-21).
 * - Groq 404-verified (live re-verification 2026-09-30).
 */
export const DEAD_MODEL_IDS: string[] = [
  // NVIDIA-retired (410).
  "moonshotai/kimi-k2-instruct", // EOL 2026-05-12
  "meta/llama-3.1-8b-instruct", // EOL 2026-08-26
  "meta-llama/llama-3.1-8b-instruct", // EOL 2026-08-26 (openrouter form)
  "meta/llama-3.3-70b-instruct", // EOL 2026-08-26
  "meta-llama/llama-3.3-70b-instruct", // EOL 2026-08-26 (openrouter form)
  "meta-llama/llama-3.3-70b-instruct:free", // EOL 2026-08-26 (:free form)
  // OpenRouter-delisted (2026-09-21).
  "tencent/hy3:free",
  "poolside/laguna-m.1:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "qwen/qwen3-coder:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "openai/gpt-oss-20b:free",
  // Groq 404-verified (2026-09-30).
  "llama-3.3-70b-versatile",
  "qwen/qwen3-32b",
  "qwen/qwen3.6-27b",
  "meta-llama/llama-4-scout-17b-16e-instruct",
];
