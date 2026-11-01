# providers.d — drop-in provider definitions

Drop a `*.json` file here to register a provider WITHOUT editing
`src/data.ts`. Each file holds either a single ProviderDef or
`{ "providers": ProviderDef[] }`.

Precedence (see `src/auto-loader.ts`):
1. curated `PROVIDER_DEFS` in `src/data.ts` — never overwritten;
2. drop-ins from this directory — override curated entries;
3. auto-synthesis — fills any required id still uncovered.

Example (`acme.json`):
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
