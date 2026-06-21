---
name: Lockfile Replit registry URLs
description: package-lock.json resolved URLs point to package-firewall.replit.local after npm installs inside Replit, breaking Expo Launch builds.
---

# Lockfile Replit registry URLs

## The rule
After any `npm install` / `npm ci` run inside Replit, `package-lock.json` will contain `resolved` fields pointing to `http://package-firewall.replit.local/npm/…` instead of `https://registry.npmjs.org/…`. This is Replit's supply-chain firewall proxy.

**Why it matters:** Expo Launch builds run on Expo's external servers which cannot reach `package-firewall.replit.local`. The build fails with `ENOTFOUND package-firewall.replit.local` during `npm ci`.

**Why:** Replit injects the internal proxy into the npm environment for security scanning. npm writes the URL it actually fetched from into the lockfile, so the proxy address leaks into the committed lockfile.

## How to apply
Whenever an Expo Launch build fails with `ENOTFOUND package-firewall.replit.local`, run:

```bash
sed -i 's|http://package-firewall.replit.local/npm/|https://registry.npmjs.org/|g' package-lock.json
```

Then commit the fixed lockfile and re-publish. This can recur after any new `npm install` inside Replit.

Check the count first with:
```bash
grep -c "package-firewall.replit.local" package-lock.json
```
