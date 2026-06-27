# StreetCover

A mobile street coverage tracking app built with Expo (React Native) and Express. Users can track walking routes via GPS, visualize their coverage as a heat map, see live session stats (timer + distance), and join groups to compare coverage.

## Architecture

### Frontend (Expo / React Native)
- **Framework**: Expo SDK 54 with Expo Router (file-based routing)
- **State**: React Query for server state, React Context for auth and tracking
- **Map**: react-native-maps v1.18.0 (pinned for Expo Go compatibility)
- **Location**: expo-location for GPS tracking

### Backend (Express / TypeScript)
- **Server**: Express on port 5000
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: express-session with connect-pg-simple, bcrypt for password hashing

### Key Files
- `app/(tabs)/index.tsx` - Main map screen with tracking controls and heat map
- `app/(tabs)/history.tsx` - Walking session history with stats
- `app/(tabs)/groups.tsx` - Group management (create/join)
- `app/auth.tsx` - Login/register screen
- `lib/tracking-context.tsx` - GPS tracking, timer, distance calculation
- `lib/auth-context.tsx` - Authentication state
- `lib/coverage-utils.ts` - Heat map segment building, formatting helpers
- `lib/tracking-math.ts` - Pure GPS math: distance/bearing, movement gate, speed-based GPS-spike rejection (anti-derailment), background-point merge, session finalize
- `server/routes.ts` - All API endpoints
- `server/storage.ts` - Database storage layer
- `shared/schema.ts` - Drizzle schema definitions

### Key Components
- `components/TutorialModal.tsx` - 7-slide onboarding carousel (AsyncStorage persistence)
- `components/OnboardingModal.tsx` - Post-registration group join modal
- `server/email.ts` - Nodemailer email utility with graceful SMTP fallback

### Database Tables
- `users` - User accounts (includes optional `email` column)
- `password_reset_tokens` - Password reset codes (UUID id, 1hr expiry)
- `groups` - Walking groups with unique join codes
- `group_memberships` - User-group relationships
- `churches` - Top-level church organizations with join codes
- `church_memberships` - User-church relationships
- `branches` - Sub-groups within churches (includes `status` 'active'|'pending' for creation approval)
- `branch_memberships` - User-branch relationships with `status` ('active'|'pending')
- `teams` - Sub-groups within branches (includes `status` 'active'|'pending' for creation approval)
- `team_memberships` - User-team relationships with `status` ('active'|'pending')
- `walking_sessions` - Walking session records with distance/duration
- `route_points` - GPS coordinates recorded during sessions
- `priority_areas` - Admin-drawn priority zones per branch

### Admin Features
- **Date-filtered stats** (church-detail, branch-detail, team-detail): Admins see filter pills (Last 7 Days / Last 30 Days / Custom date range). Stats query uses `?from=&to=` params.
- **Join approval flow**: Joining a branch or team creates a `pending` membership. Branch/team admins see "Join Requests" panel with approve (✓) / reject (✗) buttons. Only `active` members appear in stats and member lists.
- **Sub-group creation approval flow**: Any church member can request a new branch (any branch member can request a new team), but non-admin requests are saved with `status='pending'` and no membership row is inserted. Parent admins see a "Branch Requests" / "Team Requests" panel above the regular list. Approving flips status to `active` and inserts the requester as the new sub-group's admin. Rejecting deletes the pending row. Endpoints: `GET/DELETE /api/churches/:id/branch-creation-requests[/:branchId]`, `POST /api/churches/:id/branch-creation-requests/:branchId/approve` (and matching `/api/branches/:id/team-creation-requests/...`). `getBranchesByChurch` / `getTeamsByBranch` filter to `status='active'`, hiding pending sub-groups from the public list.
- **Effective role hierarchy**: A user can be a direct member of **multiple branches** per church (unique constraint is `branch_memberships(user_id, branch_id)`). Church admins are *implicitly* admins of every branch in their church (and team in those branches), and branch admins are implicitly admins of every team in the branch. The server resolves this via `effectiveBranchRole` and `effectiveTeamRole` helpers in `server/routes.ts`, used by all admin/member guards on `/api/branches/:id/*` and `/api/teams/:id/*` routes (except the `DELETE .../leave` routes, which still require direct membership). The list endpoints `GET /api/churches/:id/branches` and `GET /api/branches/:id/teams` also report the effective role so the UI shows correct admin badges/controls. Stats deduplication: branch/team stats count all walks by their members; church-level stats go through `groupMemberships` (one row per church member) so a user's walks are never double-counted at the church level even if they belong to multiple branches.
- **Pending request notifications**: `GET /api/my-pending-requests` returns `{ total, branches: [{branchId, name, count}], teams: [{teamId, name, count}] }` aggregated across every branch/team the user admins. The Profile tab in the bottom tab bar shows a red badge with the total count, and per-card red bell badges appear on the user's branch/team admin cards in `app/(tabs)/groups.tsx`. The summary query is invalidated after approve/reject and after a new join request.

### Auth / Password Recovery
- `POST /api/auth/register` - Accepts optional `email` field
- `POST /api/auth/forgot-password` - Sends 6-digit code to email (SMTP or console fallback)
- `POST /api/auth/reset-password` - Validates code, updates hashed password
- SMTP env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- Auth screen modes: login → register → forgot → reset (all in `app/auth.tsx`)

### Dependencies
- react-native-maps@1.18.0
- expo-location
- express-session, connect-pg-simple, bcrypt, nodemailer
- drizzle-orm, pg
- @tanstack/react-query
