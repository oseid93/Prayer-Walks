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
- `server/routes.ts` - All API endpoints
- `server/storage.ts` - Database storage layer
- `shared/schema.ts` - Drizzle schema definitions

### Database Tables
- `users` - User accounts
- `groups` - Walking groups with unique join codes
- `group_memberships` - User-group relationships
- `walking_sessions` - Walking session records with distance/duration
- `route_points` - GPS coordinates recorded during sessions

### Dependencies
- react-native-maps@1.18.0
- expo-location
- express-session, connect-pg-simple, bcrypt
- drizzle-orm, pg
- @tanstack/react-query
