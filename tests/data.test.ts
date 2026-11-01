import { describe, expect, test } from "bun:test";
import { ModelCatalog } from "../src/catalog.ts";
import { DEAD_MODEL_IDS, MODEL_ALIASES, PROVIDER_DEFS } from "../src/data.ts";

describe("reconciled provider data", () => {
  test("provider names are unique", () => {
    const names = PROVIDER_DEFS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every alias targets a known provider", () => {
    const known = new Set(PROVIDER_DEFS.map((d) => d.name));
    for (const [alias, [provider]] of Object.entries(MODEL_ALIASES)) {
      expect(known.has(provider)).toBe(true);
    }
  });

  test("deadIds has no duplicates", () => {
    expect(new Set(DEAD_MODEL_IDS).size).toBe(DEAD_MODEL_IDS.length);
  });

  test("cold-start serving never includes a dead id", () => {
    const cat = new ModelCatalog(PROVIDER_DEFS, {
      aliases: MODEL_ALIASES,
      deadIds: DEAD_MODEL_IDS,
    });
    for (const d of PROVIDER_DEFS) {
      for (const id of cat.servingModels(d.name)) {
        expect(DEAD_MODEL_IDS).not.toContain(id);
      }
    }
  });

  test("known-dead groq ids are filtered at cold start", () => {
    const cat = new ModelCatalog(PROVIDER_DEFS, {
      aliases: MODEL_ALIASES,
      deadIds: DEAD_MODEL_IDS,
    });
    const ids = cat.servingModels("groq");
    // gpt-oss-120b is dead on groq (filtered); gpt-oss-20b is live (served).
    expect(ids).not.toContain("openai/gpt-oss-120b");
    expect(ids).toContain("openai/gpt-oss-20b");
    expect(ids).not.toContain("llama-3.3-70b-versatile");
    expect(ids).not.toContain("qwen/qwen3-32b");
  });

  test("models url composes without a doubled /v1", () => {
    const cat = new ModelCatalog(PROVIDER_DEFS, {
      aliases: MODEL_ALIASES,
      deadIds: DEAD_MODEL_IDS,
    });
    expect(cat.modelsUrl("openai")).toBe("https://api.openai.com/v1/models");
  });
});
