# Threat Model

## Project Overview

StreetCover is a publicly deployed Expo/React Native application backed by an Express and PostgreSQL API. Users create accounts, authenticate with server-side sessions, record GPS walking sessions, store route points and session notes, and collaborate inside churches, branches, and teams with member/admin role boundaries.

Production-relevant code lives primarily in `server/`, `shared/`, `app/`, `lib/`, and the Expo static build served by the Express process. The mobile client is untrusted; every authorization decision must be enforced by the API.

## Assets

- **User accounts and active sessions** — usernames, optional email addresses, password hashes, password-reset state, and session cookies. Compromise enables account takeover and lateral access to private activity data.
- **Location history and session content** — walking sessions, route points, coverage views, priority areas, and session notes. This is sensitive behavioral and location data that can expose routines, membership, and physical presence.
- **Organization membership and admin privileges** — church, branch, and team memberships plus role assignments and approval queues. Integrity matters because these records gate access to member lists, stats, approvals, and shared coverage data.
- **Application secrets and infrastructure credentials** — `DATABASE_URL`, `SESSION_SECRET`, SMTP credentials, and any deployment-managed secrets. Exposure can compromise the entire application.

## Trust Boundaries

- **Mobile/web client to Express API** — all request bodies, params, headers, and cookies arrive from an untrusted client. Authn/authz and input validation must happen server-side.
- **Express API to PostgreSQL** — the server has broad read/write access to application data. Any injection or missing ownership check at the API layer can become full data compromise or tampering.
- **Public unauthenticated to authenticated boundary** — registration, login, forgot-password, reset-password, landing page, and static assets are public; most application data routes are authenticated.
- **Authenticated member to admin boundary** — church, branch, and team admins can view member lists, approve joins, manage roles, and manage priority areas. These boundaries must be enforced independently of client UI state.
- **Production to dev-only boundary** — Expo development helpers, localhost CORS allowances, and mock/dev assets are out of scope unless production reachability is demonstrated. Assume `NODE_ENV=production` in production.

## Scan Anchors

- **Production entry points:** `server/index.ts`, `server/routes.ts`, `server/storage.ts`
- **Highest-risk areas:** auth/session flows in `server/routes.ts`; password reset logic and token storage; session and route-point ownership checks; shared coverage/stats queries that aggregate by `userId`; role resolution helpers for churches/branches/teams
- **Public surfaces:** `/api/auth/register`, `/api/auth/login`, `/api/auth/forgot-password`, `/api/auth/reset-password`, `/`, `/manifest`, static assets
- **Authenticated/admin surfaces:** all `/api/churches/*`, `/api/branches/*`, `/api/teams/*`, `/api/sessions*`, `/api/coverage`, priority-area routes, approval routes
- **Usually dev-only:** localhost CORS handling and Expo dev startup paths unless production code makes them reachable

## Threat Categories

### Spoofing

Attackers can target session cookies, password reset flows, and login endpoints to impersonate users. The application must require an unpredictable production-only session secret, securely scoped session cookies, and strong anti-bruteforce controls around login and password recovery.

### Tampering

Authenticated users can submit session data, route points, notes, role changes, approval actions, and group-management requests. The API must ensure every state-changing endpoint verifies that the acting user owns the target record or holds the correct admin role, and it must reject client attempts to modify another user’s sessions or org state.

### Information Disclosure

The application stores sensitive location history, membership rosters, and optional email addresses. API responses, logs, and error handling must not disclose other users’ route data, session details, reset material, or internal identifiers beyond what each authenticated user is authorized to see.

Walking coverage and leaderboard features are especially sensitive because `walking_sessions` are user-owned rather than organization-owned. Shared org views must not expose unrelated historical routes, live session movement, or session identifiers that can be reused against other endpoints.

### Denial of Service

Public auth endpoints and authenticated write-heavy routes can be abused to exhaust CPU, storage, or email capacity. Login, password reset, and other high-value endpoints must have meaningful throttling and abuse controls proportionate to their impact.

### Elevation of Privilege

Role hierarchy across churches, branches, and teams introduces multiple opportunities for broken access control. The system must enforce admin/member boundaries server-side on every privileged endpoint and prevent attackers from forging sessions, bypassing ownership checks, or escalating privileges via predictable identifiers or weak secrets.
