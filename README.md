# 🪹 mimetite — `@toxicwind/mimetite`

**Master provider catalog for the estate.** One source of truth for every LLM
provider's wire facts (base URL, key env var, endpoint-shape adapter, seeds,
dead ids, aliases) — and the logic that turns those facts into the **live
serving set** every router and agent perches on. TS consumers import the
package; Go/Rust/Python/Tau/Kappa consumers read **generated artifacts**, never
hand-maintained copies.

> Every flock comes home to mimetite — where the birds settle, perch, and rest.

## What it is

- **Single source of truth** for provider definitions — base URL, key env var,
  endpoint-shape adapter, cold-start seeds, context windows, dead ids.
- **Live discovery** is the source of truth for membership: fetch `/models`
  across all known endpoint shapes, keep the _last successful_ listing.
- **Auto-quarantine** removes dead or vanished models automatically — never
  served, always observable, re-admitted on re-listing.
- **`provider → modelProvider → model` hierarchy** — one vendor (rhodochrosite) can
  serve through several distinct backends (rhodochrosite, chalcopyrite, secure-NIM),
  each with its own URL/key/adapter. Dupes across modelProviders are valid and
  keyed by path, never deduped.
- **Generated artifacts** for consumers that can't import TS: `providers.go`,
  `providers.rs`, `providers.json`, `tau-models.yml`, kappa config.

## Why it exists

Every consumer used to hand-maintain its own provider→model list. Live discovery
could only _add_ — nothing ever removed a dead id. Result: 4 of 6 groq ids
404'd in production until a human noticed. Mimetite makes the **live listing the
source of truth** and demotes curation to cold-start seeds. One mimetite; nobody
keeps a private nest. When a provider kills a model, the whole estate learns
within two refreshes — no human in the loop.

The rule: **if it names a provider or a model id, it reads the mimetite.**
Hand-maintained provider/model inventories are a bug — file it as one.

## The serving contract

Membership is derived, never curated. `ModelCatalog.servingModels(provider)`
is computed from the last successful discovery, minus quarantine, minus the
dead list. The semantics (enforced in `src/catalog.ts`):

1. **Cold start**: `seeds` serve until the provider's first successful
   discovery; afterwards seeds go **inert** (they may still inform stable
   ordering, never membership).
2. **Failed refresh changes nothing**: miss counters move only on _successful_
   refreshes; a failure keeps serving last-known-good (stale-serve).
3. **Two-refresh prune** (`PRUNE_AFTER_MISSES = 2`): an id missing from the
   live listing is not dropped immediately — it accrues a miss per consecutive
   successful refresh; at 2 it enters **quarantine** and stops serving.
   Re-listing re-admits automatically. Quarantine is observable, never silent.
4. **Serve-time 404** → immediate quarantine (`serve-404`); re-listing re-admits.
5. **Dead list** (`DEAD_MODEL_IDS`) is the permanent hand-managed EOL tier.
   Never served, never re-admitted by discovery.
6. **Well-formed empty listing** = zero models, a valid result — never fall
   back to stale data.
7. **Overlays** are router-local runtime ids (e.g. the dynamic local-role
   models). Served always, never pruned by discovery, never persisted — but
   still subject to quarantine and the dead list.

## Model source & where ids come from

Every serving model carries a `ModelSource` — `live | seed | overlay |
quarantined | dead | unknown` — surfaced on `/v1/models` and `/status`. You can
always tell _why_ an id is visible: it's either discovery-listed, a cold-start
seed (pre-discovery only), a runtime overlay, or quarantined/dead (and thus not
served).

## Layout

```
src/
  types.ts      core types (ProviderDef, ModelProviderDef, adapters, quarantine)
  adapters.ts   one parser per /models wire shape (openai, google-v1beta, mistral, static, none)
  discovery.ts  fetch + parse with timeout; failures never cached, never acted on
  catalog.ts    ModelCatalog — serving sets, miss/prune, quarantine, overlays,
                live-catalog export (contract estate-mimetite/live-catalog/v1)
  data.ts       THE source of truth: provider defs, seeds, aliases, dead ids
  codegen.ts    emits generated/providers.{json,go,rs}, tau-models.yml, kappa-models.json
  auto-loader.ts  providers.d/ drop-in merger + auto-synthesis for uncovered ids
  index.ts      public surface
providers.d/    drop-in `*.json` provider definitions (no data.ts edit required)
scripts/build.ts  `bun run build` — regenerates generated/ + syncs installed slices
generated/
  providers.json       canonical JSON artifact (Python consumers), $schema estate-mimetite/v1
  providers.go         drop-in Go data file for bornite (package astmatrix)
  providers.rs         drop-in Rust data module for rhodochrosite (MIMETITE_* constants)
  tau-models.yml       canonical YAML model catalog for Tau
  kappa-models.json    canonical Kappa provider config (full profile)
  providers.kappa.json compatibility JSON artifact for Kappa tooling
tests/          tests — adapters, catalog, codegen, concurrency, auto-loader, data
```

<!-- FACTS:START -->

> **Live facts** (auto-generated by `bun run facts` from `src/data.ts` & the test
> corpus — edit the code, never this block; `tests/facts.test.ts` fails if it
> drifts).

| Fact | Value |
| --- | --- |
| provider defs | 48 |
| enabled providers | 48 |
| modelProvider carriers | 1 (rhodochrosite) |
| serving backends | 3 modelProviders, 50 distinct serve-paths |
| model aliases | 24 |
| dead model ids | 16 |
| endpoint adapters | 5 (openai, mistral, google-v1beta, static, none) |
| tests | 101 across tests/*.test.ts |

<!-- FACTS:END -->

## Adding a provider

1. Add a `ProviderDef` to `src/data.ts` (pick the adapter matching its
   `/models` shape; add `seeds` for cold start) — **or** drop a `*.json` into
   `providers.d/` to register it without touching `data.ts`.
2. `bun run build` — regenerates `generated/` and syncs the installed slices.
3. `bun test` — the sync test fails if you forgot step 2 (byte-for-byte diff).
4. Copy `generated/providers.go` over bornite's
   `internal/astmatrix/providers_generated.go` (the test tells you the exact
   path when it's stale).

## Drop-in providers (`providers.d/`)

Drop a `*.json` file to register a provider **without editing `src/data.ts`**.
Each file holds either a single `ProviderDef` or `{ "providers": ProviderDef[] }`.
Precedence (see `src/auto-loader.ts`):

1. curated `PROVIDER_DEFS` in `src/data.ts` — never overwritten;
2. drop-ins from this directory — override curated entries;
3. auto-synthesis — fills any required id still uncovered (known public
   endpoint when available, `keyEnv` by convention, marked `autoGenerated`).

```json
{
  "name": "acme",
  "displayName": "Acme AI",
  "baseUrl": "https://api.acme.ai/v1",
  "keyEnv": "ACME_API_KEY",
  "auth": "bearer",
  "adapter": "openai",
  "seeds": []
}
```

Load with `loadDropInDefs(dir)` + `loadProviderDefs(defs, { dropIns })`.

## Adding an endpoint shape

New odd provider = new adapter in `src/adapters.ts` (+ fixture tests in
`tests/adapters.test.ts`). Provider-specific branches never leak into routing
or catalog logic. Each adapter is total on its input contract and throws
`AdapterParseError` on malformed bodies so discovery records a clean failure
(never served, never cached).

## `provider → modelProvider → model` (first-class hierarchy)

A top-level **provider** (rhodochrosite, freeinference, google, groq) is a vendor or
gateway. It can serve a model set through **one or more distinct serving
backends** — a **modelProvider** (e.g. rhodochrosite owns `chalcopyrite`
:25200 and `secure-nim`; the :25193 gateway itself is the provider's own
discovery surface). Each modelProvider carries its own
`baseUrl`/`keyEnv`/`adapter` and its own model list — and a provider without
`modelProviders` resolves at the implicit legacy flat backend (unchanged
behavior).

- **Dupes are VALID.** The same model id in two modelProviders is _not_
  deduped; it is disambiguated by the path `provider.modelProvider.model`.
- `ModelCatalog.allServingByModelProvider()` returns every
  `{ provider, modelProvider, id, source }` row, dupes intact.
- Generated artifacts expose the layer: kappa gets disambiguated provider-map
  keys (`rhodochrosite.chalcopyrite`, …); tau models.yml emits three-tier
  provider ids (`rhodochrosite`, `rhodochrosite.chalcopyrite`,
  `rhodochrosite.secure-nim`) and drops the deprecated flat block for
  providers that own modelProviders (renamed from the retired `flock` id,
  2026-10-26).

## Persistence

`ModelCatalog.saveToFile()` writes atomically (unique same-dir temp file +
fsync + rename + dir fsync) and re-emits the live-catalog export so it can
never go stale relative to the state file. Concurrent saves are chained, never
interleaved. `loadFromFile()`/`loadJSON()` understand both the v2 shape and the
legacy router `.state/live-models.json` v1 shape (`{ live, meta }`); a stale
persisted serving array can never resurrect a dead id (serving is re-derived
from loaded live + miss tolerance + quarantine + dead list).

The **live-catalog export** (`{state}.live.json`, contract
`estate-mimetite/live-catalog/v1`) is pure data: derived serving sets, quarantine
lists, discovery flags. Non-TS consumers read it verbatim; membership logic
lives only in the TS package.

## Code generation & determinism

`bun run build` regenerates all `generated/` artifacts from `src/data.ts` and
syncs the installed slices to Tau and Kappa. Artifacts are **byte-identical on
rebuild with unchanged data** (`SOURCE_DATE_EPOCH` is pinned to the last commit
touching `src/data.ts`), so stale-artifact drift is a test failure, and the Flock
Rust consumer copy is written from a single render — no hand-copy drift.

`build.ts` also syncs the Flock Rust data module to
`../rhodochrosite/proxy/src/{roost,mimetite}_providers.rs` and the Flock-proxy copy, and
best-effort syncs `~/.tau/models.yml` / `~/.config/kappa/kappa-models.json` /
their estate mirrors (skipped gracefully when the estate paths don't exist).

## Developing

```bash
bun test          # 87 tests — adapters, catalog, codegen, concurrency, auto-loader, data
bun run build     # regenerate generated/ from src/data.ts + sync installed slices
bun run typecheck # bunx tsc --noEmit (requires bun-types present)
```

`scripts/mise-build.sh` submits the canonical build+test (`bun run build &&
bun test`) through mise; eligible task artifacts restore through mbx-cache.

## Consumers

| Consumer                    | How it consumes                                                                                                           | Status                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **tau** (`toxicwind/tau`)   | reads `tau-models.yml`                                                                                                    | provider authority for the coding-agent engine             |
| **bornite** (Go)            | `internal/astmatrix/providers.go` — generated, checked in, never hand-edited; reads the live-catalog export for live sets | Provenance `@toxicwind/mimetite`                           |
| **flock** (Rust)            | `proxy/src/mimetite_providers.rs` — generated data module, synced by build                                                | wire data only; flock keeps its operational overlay        |
| **kappa** (Go+TS)           | `generated/kappa-models.json` (full) + installed slice                                                                    | two profiles: canonical catalog + env-filtered live config |
| **Python research scripts** | `generated/providers.json` (canonical) + `*.live.json` (derived)                                                          | stable schemas `estate-mimetite/v1` / `live-catalog/v1`    |

## Research & deep-dives

- [`research/nvcf-vs-integrate.md`](research/nvcf-vs-integrate.md) — entitlement
  truth: Integrate is a thin OpenAI-compat facade over the NVCF function plane;
  `/v1/models` is a lying catalog, entitlement is per-UUID (live-probed 2026-10-25).
- [`bench-radar/rhodochrosite-vs-freeinference.md`](bench-radar/rhodochrosite-vs-freeinference.md) —
  live route reality through the rhodochrosite merged router vs the freeinference
  provider it fronts (555 models / 14 flocks, live-probed 2026-10-25).
