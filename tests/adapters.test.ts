/**
 * Adapter shape tests: every /models endpoint form the estate speaks.
 * Fixtures mirror the real wire formats; a provider that changes shape
 * should break exactly one adapter's tests.
 */
import { describe, expect, test } from "bun:test";
import { adapterFor, AdapterParseError, ADAPTERS } from "../src/adapters.ts";
import type { ProviderDef } from "../src/types.ts";

function def(over: Partial<ProviderDef> = {}): ProviderDef {
  return {
    name: "test",
    baseUrl: "https://example.com",
    keyEnv: "TEST_KEY",
    adapter: "openai",
    seeds: [],
    ...over,
  };
}

describe("openai adapter", () => {
  const a = adapterFor("openai");
  test("parses { data: [{ id }] }", () => {
    const out = a.parse(
      { data: [{ id: "gpt-x", object: "model" }, { id: "gpt-y" }] },
      def(),
    );
    expect(out.ids).toEqual(["gpt-x", "gpt-y"]);
  });
  test("well-formed empty data array is zero models, not an error", () => {
    expect(a.parse({ data: [] }, def()).ids).toEqual([]);
  });
  test("missing data array throws", () => {
    expect(() => a.parse({ models: [] }, def())).toThrow(AdapterParseError);
  });
  test("non-object body throws", () => {
    expect(() => a.parse(null, def())).toThrow(AdapterParseError);
  });
  test("skips entries without string ids", () => {
    const out = a.parse({ data: [{ id: "ok" }, { nope: 1 }, { id: 42 }] }, def());
    expect(out.ids).toEqual(["ok"]);
  });
  test("buildRequest uses bearer auth and /models by default", () => {
    const req = a.buildRequest(def(), "sekret");
    expect(req.url).toBe("https://example.com/models");
    expect(req.headers["authorization"]).toBe("Bearer sekret");
  });
  test("buildRequest honors modelsPath override", () => {
    const req = a.buildRequest(def({ modelsPath: "/v1/models" }), "k");
    expect(req.url).toBe("https://example.com/v1/models");
  });
});

describe("mistral adapter", () => {
  const a = adapterFor("mistral");
  test("parses native mistral list shape", () => {
    const out = a.parse(
      {
        object: "list",
        data: [
          { id: "mistral-large-latest", object: "model", created: 1, owned_by: "mistralai" },
          { id: "open-mistral-7b", object: "model", created: 2, owned_by: "mistralai" },
        ],
      },
      def({ adapter: "mistral" }),
    );
    expect(out.ids).toEqual(["mistral-large-latest", "open-mistral-7b"]);
  });
  test("wrong object discriminator throws", () => {
    expect(() =>
      a.parse({ object: "error", data: [] }, def({ adapter: "mistral" })),
    ).toThrow(AdapterParseError);
  });
  test("empty list is valid", () => {
    expect(a.parse({ object: "list", data: [] }, def({ adapter: "mistral" })).ids).toEqual([]);
  });
  test("defaults to /v1/models path", () => {
    const req = a.buildRequest(def({ adapter: "mistral" }), "k");
    expect(req.url).toBe("https://example.com/v1/models");
  });
});

describe("google-v1beta adapter", () => {
  const a = adapterFor("google-v1beta");
  test("parses { models: [{ name: 'models/...' }] } and strips prefix", () => {
    const out = a.parse(
      {
        models: [
          { name: "models/gemini-2.0-flash", displayName: "Gemini 2.0 Flash" },
          { name: "models/gemini-1.5-pro" },
          { name: "already-bare" },
        ],
      },
      def({ adapter: "google-v1beta" }),
    );
    expect(out.ids).toEqual(["gemini-2.0-flash", "gemini-1.5-pro", "already-bare"]);
  });
  test("missing models array throws", () => {
    expect(() => a.parse({ data: [] }, def({ adapter: "google-v1beta" })).ids).toThrow(
      AdapterParseError,
    );
  });
  test("buildRequest puts the key in ?key= by default", () => {
    const req = a.buildRequest(def({ adapter: "google-v1beta" }), "GKEY");
    expect(req.url).toBe("https://example.com/v1beta/models?key=GKEY");
    expect(req.headers["authorization"]).toBeUndefined();
  });
  test("buildRequest honors x-api-key header style", () => {
    const req = a.buildRequest(
      def({ adapter: "google-v1beta", auth: "x-api-key", headerName: "x-goog-api-key" }),
      "GKEY",
    );
    expect(req.url).toBe("https://example.com/v1beta/models");
    expect(req.headers["x-goog-api-key"]).toBe("GKEY");
  });
});

describe("static adapter", () => {
  const a = adapterFor("static");
  test("returns the definition's static models without fetching", () => {
    expect(a.needsFetch).toBe(false);
    const out = a.parse(
      undefined,
      def({ adapter: "static", staticModels: ["role-a", "role-b"] }),
    );
    expect(out.ids).toEqual(["role-a", "role-b"]);
  });
});

describe("none adapter", () => {
  const a = adapterFor("none");
  test("declared no-models endpoint resolves to zero models", () => {
    expect(a.needsFetch).toBe(false);
    const out = a.parse(
      undefined,
      def({ adapter: "none", noModelsReason: "no /models endpoint" }),
    );
    expect(out.ids).toEqual([]);
    expect(out.meta?.["reason"]).toBe("no /models endpoint");
  });
});

describe("adapter registry", () => {
  test("every AdapterId has an adapter", () => {
    for (const id of ["openai", "google-v1beta", "mistral", "static", "none"] as const)
      expect(ADAPTERS[id].id).toBe(id);
  });
  test("unknown adapter id throws", () => {
    expect(() => adapterFor("weird" as never)).toThrow(AdapterParseError);
  });
});
