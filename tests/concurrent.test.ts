import { test, expect } from "bun:test";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelCatalog } from "../src/catalog.js";
import { PROVIDER_DEFS, MODEL_ALIASES, DEAD_MODEL_IDS } from "../src/data.js";

function makeCatalog(): ModelCatalog {
  return new ModelCatalog(PROVIDER_DEFS, {
    aliases: MODEL_ALIASES,
    deadIds: DEAD_MODEL_IDS,
  });
}

test("persistence > concurrent saveToFile calls serialize without temp collisions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "providers-concurrent-"));
  const path = join(dir, "catalog.json");
  const cat = makeCatalog();

  // Fire 20 concurrent saves; they must serialize, not collide on temp names.
  await Promise.all(Array.from({ length: 20 }, () => cat.saveToFile(path)));

  // The final file must be valid JSON with the expected shape.
  const raw = await readFile(path, "utf8");
  const doc = JSON.parse(raw);
  expect(doc.version).toBe(2);
  expect(doc.providers).toBeDefined();

  // No temp files may be left behind.
  const entries = await readdir(dir);
  const tmps = entries.filter((e) => e.includes(".tmp."));
  expect(tmps).toEqual([]);

  // The live export must also exist and be valid.
  const livePath = ModelCatalog.liveExportPathFor(path);
  const liveRaw = await readFile(livePath, "utf8");
  const live = JSON.parse(liveRaw);
  expect(live.contract).toBe("estate-pinax/live-catalog/v1");
  const liveEntries = await readdir(dir);
  expect(liveEntries.filter((e) => e.includes(".tmp."))).toEqual([]);
});

test("persistence > concurrent writeLiveCatalog calls do not collide", async () => {
  const dir = await mkdtemp(join(tmpdir(), "providers-live-concurrent-"));
  const path = join(dir, "catalog.live.json");
  const cat = makeCatalog();

  await Promise.all(Array.from({ length: 20 }, () => cat.writeLiveCatalog(path)));

  const raw = await readFile(path, "utf8");
  const doc = JSON.parse(raw);
  expect(doc.contract).toBe("estate-pinax/live-catalog/v1");

  const entries = await readdir(dir);
  expect(entries.filter((e) => e.includes(".tmp."))).toEqual([]);
});
