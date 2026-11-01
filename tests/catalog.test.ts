/**
 * Catalog tests: the prune/quarantine contract that fixes the hardcoded-list
 * disease. Every rule here is a regression test for the groq incident (4 of 6
 * curated ids 404'd in production because live discovery could only ADD).
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelCatalog, PRUNE_AFTER_MISSES } from "../src/catalog.ts";
import type { DiscoveryResult } from "../src/discovery.ts";
import type { ProviderDef } from "../src/types.ts";

function def(over: Partial<ProviderDef> = {}): ProviderDef {
  return {
    name: "groq",
    baseUrl: "https://api.groq.com/openai",
    keyEnv: "GROQ_API_KEY",
    adapter: "openai",
    seeds: ["seed-a", "seed-b", "seed-c"],
    ...over,
  };
}

function ok(ids: string[]): DiscoveryResult {
  return { ok: true, ids, meta: {}, fetchedAt: new Date().toISOString() };
}
function fail(error = "boom"): DiscoveryResult {
  return { ok: false, error };
}

function catalog(over: Partial<ProviderDef> = {}) {
  return new ModelCatalog([def(over)], {
    aliases: { "alias-a": ["groq", "live-a"] },
    deadIds: ["dead-1"],
  });
}

describe("cold start and seed demotion", () => {
  test("seeds serve before first discovery, tagged as seed", () => {
    const c = catalog();
    expect(c.servingModels("groq")).toEqual(["seed-a", "seed-b", "seed-c"]);
    expect(c.modelSource("groq", "seed-a")).toBe("seed");
  });
  test("first successful discovery makes seeds inert; live owns membership", () => {
    const c = catalog();
    c.applyDiscovery("groq", ok(["live-a", "live-b"]));
    expect(c.servingModels("groq")).toEqual(["live-a", "live-b"]);
    expect(c.modelSource("groq", "seed-a")).toBe("unknown");
    expect(c.modelSource("groq", "live-a")).toBe("live");
  });
  test("well-formed empty listing serves zero models — seeds do not come back", () => {
    const c = catalog();
    c.applyDiscovery("groq", ok([]));
    expect(c.servingModels("groq")).toEqual([]);
    expect(c.allServing()).toEqual([]);
  });
  test("disabled provider serves nothing", () => {
    const c = catalog({ enabled: false });
    expect(c.servingModels("groq")).toEqual([]);
  });
});

describe("stale-serve on failure", () => {
  test("failed refresh leaves the serving set untouched", () => {
    const c = catalog();
    c.applyDiscovery("groq", ok(["live-a", "live-b"]));
    c.applyDiscovery("groq", fail("HTTP 500"));
    expect(c.servingModels("groq")).toEqual(["live-a", "live-b"]);
  });
  test("failed refresh does not move miss counters", () => {
    const c = catalog();
    c.applyDiscovery("groq", ok(["live-a", "live-b"]));
    c.applyDiscovery("groq", ok(["live-a"])); // miss 1 for live-b
    c.applyDiscovery("groq", fail("timeout")); // failure: counter frozen
    c.applyDiscovery("groq", ok(["live-a"])); // miss 2 -> quarantine
    expect(c.isQuarantined("groq", "live-b")).toBe(true);
    // but if the failure had counted, live-b would already be gone here —
    // prove the counter needed BOTH successful refreshes:
    const c2 = catalog();
    c2.applyDiscovery("groq", ok(["live-a", "live-b"]));
    c2.applyDiscovery("groq", fail("timeout"));
    c2.applyDiscovery("groq", ok(["live-a"])); // only miss 1
    expect(c2.isQuarantined("groq", "live-b")).toBe(false);
    expect(c2.servingModels("groq")).toContain("live-b");
  });
});

describe("two-refresh prune", () => {
  test(`missing once keeps serving; missing ${PRUNE_AFTER_MISSES}x quarantines`, () => {
    const c = catalog();
    c.applyDiscovery("groq", ok(["live-a", "live-b"]));
    c.applyDiscovery("groq", ok(["live-a"]));
    expect(c.servingModels("groq")).toEqual(["live-a", "live-b"]);
    expect(c.isQuarantined("groq", "live-b")).toBe(false);
    c.applyDiscovery("groq", ok(["live-a"]));
    expect(c.servingModels("groq")).toEqual(["live-a"]);
    expect(c.isQuarantined("groq", "live-b")).toBe(true);
    expect(c.modelSource("groq", "live-b")).toBe("quarantined");
    const q = c.quarantineList("groq");
    expect(q.find((e) => e.id === "live-b")?.reason).toBe("vanished-from-live-listing");
  });
  test("re-listing re-admits a vanished model automatically", () => {
    const c = catalog();
    c.applyDiscovery("groq", ok(["live-a", "live-b"]));
    c.applyDiscovery("groq", ok(["live-a"]));
    c.applyDiscovery("groq", ok(["live-a"]));
    expect(c.isQuarantined("groq", "live-b")).toBe(true);
    c.applyDiscovery("groq", ok(["live-a", "live-b"]));
    expect(c.isQuarantined("groq", "live-b")).toBe(false);
    expect(c.servingModels("groq")).toContain("live-b");
  });
});

describe("serve-time 404", () => {
  test("noteServe404 quarantines immediately and drops from serving", () => {
    const c = catalog();
    c.applyDiscovery("groq", ok(["live-a", "live-b"]));
    c.noteServe404("groq", "live-b");
    expect(c.servingModels("groq")).toEqual(["live-a"]);
    expect(c.isQuarantined("groq", "live-b")).toBe(true);
    expect(c.quarantineList("groq").find((e) => e.id === "live-b")?.reason).toBe("serve-404");
  });
  test("a 404'd model re-listed by the provider is re-admitted", () => {
    const c = catalog();
    c.applyDiscovery("groq", ok(["live-a", "live-b"]));
    c.noteServe404("groq", "live-b");
    c.applyDiscovery("groq", ok(["live-a", "live-b"]));
    expect(c.isQuarantined("groq", "live-b")).toBe(false);
    expect(c.servingModels("groq")).toContain("live-b");
  });
  test("serve-404 on a cold-start seed quarantines the seed", () => {
    const c = catalog();
    c.noteServe404("groq", "seed-a");
    expect(c.servingModels("groq")).toEqual(["seed-b", "seed-c"]);
  });
});

describe("dead list", () => {
  test("dead ids are never served even when live lists them", () => {
    const c = catalog();
    c.applyDiscovery("groq", ok(["live-a", "dead-1"]));
    expect(c.servingModels("groq")).toEqual(["live-a"]);
    expect(c.modelSource("groq", "dead-1")).toBe("dead");
  });
  test("discovery cannot re-admit a dead id", () => {
    const c = catalog();
    c.applyDiscovery("groq", ok(["dead-1"]));
    c.applyDiscovery("groq", ok(["dead-1"]));
    expect(c.servingModels("groq")).not.toContain("dead-1");
  });
  test("noteDead quarantines across providers immediately", () => {
    const c = catalog();
    c.applyDiscovery("groq", ok(["live-a"]));
    c.noteDead("live-a");
    expect(c.servingModels("groq")).toEqual([]);
    expect(c.deadList()).toContain("live-a");
  });
});

describe("aliases", () => {
  test("resolveAlias maps friendly names to [provider, model] pairs", () => {
    const c = catalog();
    expect(c.resolveAlias("alias-a")).toEqual(["groq", "live-a"]);
    expect(c.resolveAlias("nope")).toBeUndefined();
  });
  test("orderedServing puts seed-order first as a stable hint", () => {
    const c = new ModelCatalog(
      [def({ seeds: ["live-b", "live-a", "live-c"] })],
      {},
    );
    c.applyDiscovery("groq", ok(["live-c", "live-a", "live-b", "live-z"]));
    expect(c.orderedServing("groq")).toEqual(["live-b", "live-a", "live-c", "live-z"]);
  });
});

describe("persistence", () => {
  test("save/load round-trips quarantine, misses and discovery state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prov-"));
    try {
      const path = join(dir, "catalog.json");
      const c = catalog();
      c.applyDiscovery("groq", ok(["live-a", "live-b"]));
      c.applyDiscovery("groq", ok(["live-a"])); // miss 1
      c.noteServe404("groq", "live-a");
      await c.saveToFile(path);

      const c2 = catalog();
      expect(await c2.loadFromFile(path)).toBe(true);
      expect(c2.servingModels("groq")).toEqual(["live-b"]);
      expect(c2.isQuarantined("groq", "live-a")).toBe(true);
      // one more successful miss refresh -> live-b quarantined (miss was 1)
      c2.applyDiscovery("groq", ok([]));
      expect(c2.isQuarantined("groq", "live-b")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("v1 shape { live } migrates: persisted live implies discovered", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prov-"));
    try {
      const path = join(dir, "live-models.json");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        path,
        JSON.stringify({
          live: { groq: ["old-a", "dead-1"] },
          meta: { groq: {} },
          updatedAt: "2026-01-01T00:00:00Z",
        }),
      );
      const c = catalog();
      expect(await c.loadFromFile(path)).toBe(true);
      // dead-1 filtered on load; seeds stay inert because live existed
      expect(c.servingModels("groq")).toEqual(["old-a"]);
      expect(c.modelSource("groq", "old-a")).toBe("live");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("saveToFile also writes the live-catalog export for non-TS consumers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prov-"));
    try {
      const path = join(dir, "catalog.json");
      const c = catalog();
      c.applyDiscovery("groq", ok(["live-a", "live-b"]));
      c.noteServe404("groq", "live-a");
      await c.saveToFile(path);

      const livePath = join(dir, "catalog.live.json");
      const { readFile } = await import("node:fs/promises");
      const live = JSON.parse(await readFile(livePath, "utf8"));
      expect(live.contract).toBe("estate-pinax/live-catalog/v1");
      expect(live.providers["groq"].serving).toEqual(["live-b"]);
      expect(live.providers["groq"].quarantined).toEqual(["live-a"]);
      expect(live.providers["groq"].discovered).toBe(true);
      expect(Array.isArray(live.deadIds)).toBe(true);
      expect(typeof live.generatedAt).toBe("string");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("missing file loads as empty without throwing", async () => {
    const c = catalog();
    expect(await c.loadFromFile(join(tmpdir(), "prov-nope-12345.json"))).toBe(false);
    expect(c.servingModels("groq")).toEqual(["seed-a", "seed-b", "seed-c"]);
  });
  test("unknown provider discovery throws", () => {
    const c = catalog();
    expect(() => c.applyDiscovery("nope", ok(["x"]))).toThrow();
  });
});

describe("overlays (router-local runtime ids)", () => {
  test("overlay ids serve alongside seeds, tagged as overlay", () => {
    const c = catalog();
    c.setOverlay("groq", ["dyn-a", "dyn-b"]);
    expect(c.servingModels("groq")).toEqual([
      "seed-a",
      "seed-b",
      "seed-c",
      "dyn-a",
      "dyn-b",
    ]);
    expect(c.modelSource("groq", "dyn-a")).toBe("overlay");
    expect(c.modelSource("groq", "seed-a")).toBe("seed");
  });
  test("overlay ids serve after discovery and are never pruned", () => {
    const c = catalog();
    c.setOverlay("groq", ["dyn-a"]);
    c.applyDiscovery("groq", ok(["live-a"]));
    c.applyDiscovery("groq", ok(["live-b"]));
    c.applyDiscovery("groq", ok(["live-b"]));
    // live-a pruned after two misses; the overlay id survives everything
    expect(c.servingModels("groq")).toEqual(["live-b", "dyn-a"]);
    expect(c.modelSource("groq", "dyn-a")).toBe("overlay");
  });
  test("overlay still respects quarantine and the dead list", () => {
    const c = catalog();
    c.setOverlay("groq", ["dyn-a", "dead-1"]);
    c.noteServe404("groq", "dyn-a");
    expect(c.servingModels("groq")).toEqual(["seed-a", "seed-b", "seed-c"]);
    expect(c.modelSource("groq", "dyn-a")).toBe("quarantined");
  });
  test("setOverlay replaces the previous overlay", () => {
    const c = catalog();
    c.setOverlay("groq", ["dyn-a"]);
    c.setOverlay("groq", ["dyn-b"]);
    expect(c.servingModels("groq")).toContain("dyn-b");
    expect(c.servingModels("groq")).not.toContain("dyn-a");
  });
});

describe("alias resolution safety", () => {
  test("alias to a dead target refuses to resolve", () => {
    const c = new ModelCatalog([def()], {
      aliases: { "bad-alias": ["groq", "dead-1"] },
      deadIds: ["dead-1"],
    });
    expect(c.resolveAlias("bad-alias")).toBeUndefined();
  });
  test("alias to a live target still resolves", () => {
    const c = catalog();
    expect(c.resolveAlias("alias-a")).toEqual(["groq", "live-a"]);
  });
  test("unknown alias resolves to undefined", () => {
    expect(catalog().resolveAlias("nope")).toBeUndefined();
  });
});
