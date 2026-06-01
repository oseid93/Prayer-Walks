---
name: npm overrides & Expo dependency vulns
description: Patching transitive npm vulns in this Expo+Express repo without drifting the tree, and which vulns are unfixable without an Expo SDK major upgrade
---

# Patching transitive dependency vulnerabilities here

Transitive vulns are fixed via the `overrides` block in `package.json`. Editing the
`overrides` section by hand is the sanctioned exception to "never edit package.json";
never hand-edit `dependencies`/`devDependencies` (use the package-management tool) and
never change the Expo/React-Native major.

## The big trap: don't clean-reinstall to satisfy an override
A version-keyed override key (e.g. `"brace-expansion@1.1.12": "1.1.15"`) only applies
on a CLEAN install (`rm -rf node_modules package-lock.json` + reinstall); npm skips it
on an incremental install. **But a clean reinstall re-floats every `^`/`~` range and
drifts the whole tree** (seen here: 304 packages, babel 7.28→7.29, expo-asset
12.0.12→12.0.13). That drift also **silently breaks patch-package patches** pinned to an
exact version — the `expo-asset+12.0.12.patch` stopped applying once expo-asset floated
to 12.0.13, which broke the Metro web bundle.
**Rule:** never accept whole-tree drift to fix a non-exploitable dev-tooling vuln.
**Recovery:** restore the committed lockfile with `git show HEAD:package-lock.json >
package-lock.json` (read-only, allowed — unlike `git checkout`/`restore` which are
blocked), then run an incremental install to reconcile only the changed package.json
subtrees. Confirm patches re-applied (grep a sentinel line in the patched file).

## What works on an incremental install (no drift)
- Global string overrides: `"qs"`, `"postcss"`, `"tmp"`, `"follow-redirects"`,
  `"@xmldom/xmldom"`, `"yaml@2.8.2"`, and nested `"@esbuild-kit/core-utils": {"esbuild": ...}`.
- Direct-dep bumps via the package tool: drizzle-orm (SQLi), nodemailer, ws — stable APIs.
- Removing an unused dep prunes its sole-source vulns: dropping `@expo/ngrok` (tunnel
  mode, unused — workflow runs `--localhost`) removed the only `uuid@3.4.0`.
- **brace-expansion is NOT worth fixing here:** it needs per-major version-keyed
  overrides (1.x and 2.x export `module.exports=fn` for minimatch@3; 5.x exports named
  `.expand` for minimatch@10) AND a clean reinstall. Not exploitable (build-time glob
  parsing of trusted patterns). Leave it.

## Overriding a transitive can delete a CLI binary the build relies on
The deployment `build` step runs `server:build` = `esbuild server/index.ts ...`, which
needs `node_modules/.bin/esbuild`. That bin only existed because esbuild was a *hoisted
transitive* dep. Bumping esbuild via the `@esbuild-kit/core-utils` override changed
dedup/hoisting so no esbuild hoisted to the top-level `.bin`, and the production build
died with `sh: 1: esbuild: not found` (dev was unaffected — tsx has its own esbuild).
**Rule:** if an npm *script* invokes a tool by bare name, that tool must be a *direct*
dependency, never a transitive one — overrides/dedup can move or remove it. Fix here:
add `esbuild` (^0.25.x, the patched line) to `dependencies` so the bin is guaranteed
and the version stays non-vulnerable.
**Why it bit late:** only the Cloud Run production build (fresh install + `--minify`
server bundle) exercises `server:build`; the dev workflow uses `tsx` directly, so the
break was invisible until publish.

## @xmldom/xmldom must be pinned at ^0.8.x as a DIRECT dep, not an override
`@expo/plist` (used during `expo prebuild` / Expo Launch iOS build) calls
`DOMParser.parseFromString(xml)` with no mimeType argument. In @xmldom/xmldom 0.9.x,
the mimeType became strictly required and throws `the provided mimeType "undefined" is
not valid.` — crashing `npx expo prebuild --platform ios` during the App Store build.
**Fix:** Add `@xmldom/xmldom@^0.8.13` as a DIRECT dependency (not an override).
**Why not override:** EAS Expo Launch uses `npm ci` (not `npm install`). An override
change in package.json without a matching lockfile entry makes `npm ci` abort with
"Missing: @xmldom/xmldom@X.X.X from lock file". Installing as a direct dep via the
package tool runs `npm install` and reconciles the lockfile in one step. Remove any
override entry for @xmldom/xmldom — direct dep takes precedence and is simpler.
All HIGH CVEs (CVE-2022-37616, CVE-2022-39353) were fixed in 0.8.6 — 0.8.13 is safe.

## Remaining audit moderates are Expo SDK 54 tooling — need expo@56 (out of scope)
Leftover `npm audit` moderates are all the Expo build/dev chain: @expo/cli,
@expo/config(-plugins), @expo/metro-config, @expo/prebuild-config, expo, expo-asset,
expo-constants, expo-linking, expo-router, expo-splash-screen, xcode, brace-expansion,
and `uuid@7.0.3` (from xcode). npm's only fix is `expo@56` (major SDK upgrade).
**Why unfixable:** project rules forbid changing the Expo SDK major (Expo Go compat is
pinned), so `npm audit` zero is not achievable in scope. These run at build/prebuild/dev
time on trusted config — not in the shipped bundle, not reachable by app users. Do not
force uuid→v11: it breaks the v3/v7 CJS API in xcode.

## Verification checklist after dependency surgery here
1. `npm audit` HIGH count is 0; note remaining moderates are the Expo chain above.
2. Patched files still patched (grep sentinel; e.g. `manifestBaseUrl?.startsWith` in
   `node_modules/expo-asset/build/AssetSources.js`).
3. `Start Backend` logs: "Migrations completed successfully" + port 5000; curl `/`→200,
   bad `/api/auth/login`→401.
4. `Start Frontend`: Metro starts with no "invalid package.json"/"Web Bundling failed".
5. Lockfile drift vs HEAD is limited to the intended security subtrees only.
