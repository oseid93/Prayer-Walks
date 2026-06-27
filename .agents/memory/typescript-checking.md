---
name: Full-project type-checking gotchas (tsc)
description: Two non-obvious reasons `npx tsc --noEmit` floods with errors in this Expo + Express 5 repo, and the accepted fixes.
---

`npx tsc --noEmit` is NOT run by metro/tsx/esbuild, so type errors are latent — the app and tests can be green while tsc reports many errors. When asked to "catch all errors", run tsc and expect these two repo-specific sources:

1. **Express 5 params/query are `string | string[]`.** In Express 5, `req.params.*` and `req.query.*` are typed `string | string[]` (not plain `string`), so passing them into `string` params (storage calls, `.trim()`, etc.) triggers TS2345 floods. Fix at the SOURCE: member access → `(req.params.x as string)`; destructures → `const { ... } = req.params as Record<string, string>`. These are type-only; path-segment params are always strings at runtime. (Query reads were already cast `as string` in this file — follow that convention.)

2. **Platform-split components don't resolve without `moduleSuffixes`.** Components like `MapScreen`/`SessionDetail` exist only as `.native.tsx` + `.web.tsx` (no base file). Metro resolves these at runtime, but tsc does NOT unless `tsconfig.json` sets `"moduleSuffixes": [".native", ".ios", ".android", ".web", ""]`. Without it, every `@/components/Foo` import errors TS2307.

**Why it matters:** these are the two things that make a "clean" build report 100+ tsc errors. Knowing them turns a confusing investigation into a 3-line fix.
**Tradeoff of moduleSuffixes:** tsc type-checks the `.native` variant first, so cross-platform `.web` contract drift at import sites is less strictly checked — acceptable here, not a functional defect.
