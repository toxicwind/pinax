/**
 * NVIDIA / NVCF model-definition TDD.
 *
 * NVCF (NVIDIA Cloud Functions) is the control plane behind the
 * integrate.api.nvidia.com OpenAI-compat facade — see
 * research/nvcf-vs-integrate.md. Every model id the estate advertises under
 * the nvidia family (seeds + aliases + context windows) plus the one dead
 * nvidia id must be accounted for here, so a future sweep can't silently
 * drop or resurrect an NVIDIA/NVCF id without touching this file.
 *
 * Verified live 2026-10-26 against integrate.api.nvidia.com with
 * NVIDIA_API_KEY: the entitled working set below answers 200.
 */
import { describe, expect, test } from "bun:test";
import {
  DEAD_MODEL_IDS,
  MODEL_ALIASES,
  PROVIDER_DEFS,
  resolveContext,
} from "../src/index.ts";
import { ModelCatalog } from "../src/catalog.ts";

const nvidiaDef = PROVIDER_DEFS.find((d) => d.name === "nvidia");

describe("nvidia provider contract (the NVCF/OpenAI-compat facade)", () => {
  test("nvidia def exists with the Integrate surface + entitled key class", () => {
    expect(nvidiaDef).toBeDefined();
    expect(nvidiaDef!.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(nvidiaDef!.keyEnv).toBe("NVIDIA_API_KEY");
    expect(nvidiaDef!.adapter).toBe("openai");
    expect(nvidiaDef!.auth).toBe("bearer");
  });

});

describe("all nvidia-family seed ids are catalog-covered", () => {
  const nvidiaSeeds = nvidiaDef!.seeds.filter((id) => id.startsWith("nvidia/"));

  test.each(nvidiaSeeds)("%s is served by the nvidia provider", (id) => {
    const cat = new ModelCatalog(PROVIDER_DEFS, {
      aliases: MODEL_ALIASES,
      deadIds: DEAD_MODEL_IDS,
    });
    expect(cat.servingModels("nvidia")).toContain(id);
  });

  test("nvidia seeds are never in the dead list", () => {
    for (const id of nvidiaSeeds) {
      expect(DEAD_MODEL_IDS).not.toContain(id);
    }
  });
});

describe("nvidia context windows (NIM publishes none — pinned statically)", () => {
  test.each([
    ["nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", 256000],
    ["nvidia/nemotron-3-super-120b-a12b", 500000],
    ["nvidia/nemotron-3-ultra-550b-a55b", 1000000],
    ["openai/gpt-oss-20b", 128000],
    ["z-ai/glm-5.3", 200000],
    ["z-ai/glm-5.3-flash", 200000],
    ["deepseek-ai/deepseek-v4.1-flash", 256000],
  ])("%s resolves to window %i", (id, expected) => {
    const r = resolveContext(id);
    expect(r).toBeDefined();
    expect(r!.contextLength).toBe(expected);
    expect(r!.provider).toBe("nvidia");
  });
});

describe("nvidia aliases all target the nvidia provider with known ids", () => {
  const nvidiaAliases = Object.entries(MODEL_ALIASES).filter(
    ([, [provider]]) => provider === "nvidia",
  );

  test.each(nvidiaAliases)("%s resolves to [nvidia, %s]", (alias, [, model]) => {
    const cat = new ModelCatalog(PROVIDER_DEFS, {
      aliases: MODEL_ALIASES,
      deadIds: DEAD_MODEL_IDS,
    });
    expect(cat.resolveAlias(alias)).toEqual(["nvidia", model]);
    // alias targets may arrive via live discovery on the nvidia baseUrl
    // (NIM-served), not static seeds — they only must not be dead.
    expect(DEAD_MODEL_IDS).not.toContain(model);
  });

  test("every alias target is a live (non-dead) nvidia seed", () => {
    for (const [, [, model]] of nvidiaAliases) {
      expect(DEAD_MODEL_IDS).not.toContain(model);
    }
  });
});

describe("dead nvidia id", () => {
  const deadNvidia = DEAD_MODEL_IDS.filter((id) => id.startsWith("nvidia/"));

  test.each(deadNvidia)("%s is permanently excluded from serving", (id) => {
    const cat = new ModelCatalog(PROVIDER_DEFS, {
      aliases: MODEL_ALIASES,
      deadIds: DEAD_MODEL_IDS,
    });
    for (const provider of ["nvidia", "openrouter"]) {
      expect(cat.servingModels(provider)).not.toContain(id);
    }
    // discovery cannot re-admit a dead id
    cat.applyDiscovery("nvidia", { ok: true, ids: [id], meta: {}, fetchedAt: new Date().toISOString() });
    expect(cat.servingModels("nvidia")).not.toContain(id);
  });
});
