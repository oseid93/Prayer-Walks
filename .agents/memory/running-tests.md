---
name: Running unit tests in this Expo repo
description: How to run the BDD/TDD test suite given there is no npm test script
---

# Running unit tests

There is **no test runner installed and no `test` script** in package.json, and
package.json must not be edited (Expo constraint). Tests use Node's built-in
runner with the already-present `tsx` loader:

```
node --import tsx --test lib/__tests__/*.test.ts
```

**Why:** installing jest/ts-jest into an Expo SDK 54 project is heavy and risks
dependency drift; `node:test` + `tsx` runs TypeScript with zero new deps.

**How to apply:** keep pure, testable logic in dependency-free modules (e.g.
`lib/tracking-math.ts`) that import nothing from React/expo-location, so tests
run in plain Node. Tests live in `lib/__tests__/*.test.ts`.
