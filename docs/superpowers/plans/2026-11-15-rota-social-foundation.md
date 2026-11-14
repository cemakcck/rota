# Rota Social — Block 2: Social Foundation (web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Rota into a social app's foundation on the web: usernames and profiles, follows/friends/blocks, trip visibility with read-only trip pages and Copy, the app navigation (Home · Explore · ＋ · Messages · Profile · bell), notifications over a live socket, reports/admin, search, and the demo world in its own realm.

**Architecture:** All "who can see what" decisions live in one server module (`server/social/access.ts`) used by pages, API routes, the Hocuspocus sync server (now with read-only connections), the new `/live` WebSocket and media routes. Social data are ordinary Postgres rows (Drizzle); trips stay Yjs documents. A `realm` column (`real` | `demo`) separates demo content from real accounts in every query.

**Tech Stack:** as today. No new paid services. Media storage behind an interface: local disk now (R2 in Block 4).

**Spec:** `docs/superpowers/specs/2026-11-15-rota-social-design.md` (§3–§6, §11, §12, §14, §15, §18), extending the planner and UI v2 specs.

**Prerequisite:** feat/ui-v2 Tasks 3–4 complete; this plan continues on the same branch (`feat/ui-v2`) and supersedes UI v2 Tasks 5–6 (app navigation and phone shell are built here; the trip screen keeps its UI v2 phone layout inside the new shell).

## Global Constraints

- Usernames: 3–20 chars, `[a-z0-9._]`, no leading/trailing dot, no `..`, unique case-insensitively, reserved list (`admin, rota, explore, messages, settings, api, t, trips, new, me, help, about, login, sign-in, sign-up, profile, notifications, demo, invite`). Bio ≤ 160 chars. Display name 1–30 (unchanged).
- Trip visibility `private | followers | public`, default `private`; only the owner changes it; a private account's max is `followers` (§18). Followers = the owner's accepted followers.
- Friends = mutual accepted follows. Blocks hide both directions everywhere.
- Realms: `user.realm` ∈ `real | demo`; every social query filters to the viewer's realm; demo visitors see the seeded world + their own sandbox only, never other visitors (§14).
- Read-only sync connections accept no document updates from the client (server drops/close on any update).
- Rate limits (per user via `hit`): follows 200/day, reports 20/day.
- EN + TR identical keys; WCAG 2.2 AA; light theme; UI v2 visual language (Fraunces titles, Inter, warm neutrals).
- Ports: dev 3400 (stopped during builds — Next dev lock breaks integration tests), e2e 3401; never 3000/3100. Kill by PID. Never push. Commit trailers as before.
- Every task: `npm run lint && npm run typecheck && npm test` green; Task 10 also `npm run test:e2e`.

## Review Focus

1. **Visibility × relationship matrix** — private/followers/public × owner/member/follower/friend/stranger/blocked/signed-out × trip page/API/sync/feed-ready queries/profile grid → exactly the spec's answers. → Task 2 `access matrix` test (table-driven).
2. **Realm isolation** — a real user never sees demo content and vice versa; two demo visitors never see each other. → Task 9 tests.
3. **Visibility lowered while someone is viewing live** — their read-only connection is closed with a reason and the page shows "no longer shared". → Task 3 test.
4. **Username races and case** — two sign-ups taking `Ada`/`ada` at once → one wins, the other gets a clear error. → Task 1 test.
5. **Blocking someone who is in your trip / following you / in your notifications** — follows removed, notifications hidden, trip membership unchanged (§5). → Task 2 test.

---

### Task 1: Usernames, profile fields, realms
**Files:** `apps/web/src/server/db/schema.ts` (+ migration), `server/social/username.ts`, `server/auth.ts` (sign-up requires username; update-user validates bio/home city/username), `app/api/profile/route.ts`, `app/api/usernames/[name]/route.ts` (availability check), `components/auth/SignUpForm.tsx`, a one-time "choose your username" page for existing accounts, `server/demo.ts` (demo users get realm `demo` and generated usernames).
**Interfaces:** columns `user.username` (unique index on lower(username)), `bio`, `home_city`, `avatar_key`, `is_private` (bool, default false), `realm` (default 'real'); `normaliseUsername`, `validateUsername(name) → ok | reason`, `suggestUsername(displayName, taken)`.
**Tests:** username rules table; reserved names; case-insensitive uniqueness incl. concurrent sign-ups; availability endpoint; existing user without username is redirected to choose one; demo users get realm demo + unique usernames.
**Commit:** `feat(social): usernames, profile fields and realms`.

### Task 2: Follows, friends, blocks and the access module
**Files:** schema (`follows`, `blocks`), `server/social/access.ts`, `server/social/follows.ts`, `server/social/blocks.ts`, routes `app/api/users/[username]/follow`, `…/block`, `app/api/follows/requests/...` (accept/decline), `app/api/followers/[userId]` (remove).
**Interfaces:** `relation(viewerId | null, targetId) → { self, following, followedBy, requested, friends, blockedEither }`; `canViewTrip(viewer, trip) → boolean`, `canViewProfileDetails(viewer, user)`, `visibleTripFilter(viewer)` (SQL condition reused by lists/feed); follow on private account → pending; accept/decline; block removes follows both ways.
**Tests:** the **access matrix** (table-driven, all combinations in Review Focus 1); follow/unfollow/requests; friends = mutual; block hides profile details, trips, follows removed, trip membership kept; rate limit 200 follows/day.
**Commit:** `feat(social): follows, friends, blocks and one access module`.

### Task 3: Trip visibility, read-only trip pages, Copy to my trips
**Files:** schema (`trips.visibility`, `copied_from_trip_id`, `copies_count`, `cover_key`, `join_requests_enabled`), `app/api/trips/[id]/visibility`, `server/sync.ts` (read-only connections for viewers allowed by `canViewTrip`; drop/close on any update from them; close with reason `unshared` when visibility is lowered or a block happens), trip page server check (members → editor; viewers → read-only; signed-out allowed for public), read-only mode through the UI v2 trip screen (no edit controls, no checklist/suggestions/trip chat), `server/trips/copy.ts` + `app/api/trips/[id]/copy`, visibility control in trip settings (owner).
**Tests:** visibility set/limits (private account capped); viewer gets read-only sync, any update from it is rejected and the doc unchanged; lowering visibility closes viewers with `unshared` and the page shows "no longer shared"; signed-out public view works, followers-only needs a follower; Copy creates a private trip with days/places/notes/times, no members/votes/checklist, increments copies_count, shows "copied from".
**Commit:** `feat(social): trip visibility, read-only pages and copy`.

### Task 4: App navigation shell
**Files:** `components/app/AppShell.tsx` (web left sidebar: Home, Explore, ＋ New trip, Messages, Profile, bell; phone bottom tabs with the same + bell in the header), `app/[locale]/(app)/layout.tsx`, `app/[locale]/home/page.tsx` (empty state "Find people to follow" + suggestions; real feed comes in Block 3), `app/[locale]/messages/page.tsx` (placeholder "Messages are coming"), routing of `/trips` into Profile's "Your trips" tab; the trip screen renders inside the shell (desktop: sidebar collapses to icons on the trip screen to keep room for rail · list · map; phone: the trip screen keeps its own UI v2 tabs and hides the app tabs, with a back button).
**Tests:** shell items and active state per route; collapsed sidebar on the trip screen; phone tabs and back from a trip; landing (signed-out) unchanged; axe on shell.
**Commit:** `feat(social): app navigation shell`.

### Task 5: Profiles, avatars, followers lists, private accounts
**Files:** `app/[locale]/@[username]/page.tsx` (or `/u/[username]` with a rewrite from `/@username` — builder's choice, document it), `components/profile/{ProfileHeader,TripGrid,TripCard,FollowButton,FollowList,EditProfile}.tsx`, `server/media/store.ts` (interface `put/get/delete` with a disk implementation under `MEDIA_DIR`), `app/api/media/avatar` (upload: square crop client-side, WebP ≤ 400 px, ≤ 300 KB), `app/media/[...key]/route.ts` (serves with caching; avatars public within realm).
**Behaviour:** spec §4: header, counts, buttons (Follow/Following/Requested, Message → placeholder until Block 5, ⋯ Block/Report/Share), grid of trip cards visible to the viewer (cover or a mini route map drawn from coordinates as SVG), followers/following lists, edit profile (photo, name, username, bio, home city, private switch).
**Tests:** profile shows only trips the viewer may see; private account hides grid/lists from non-followers; follow button states; avatar upload validates type/size and is served; edit username re-validates; trip card fallback map renders without network.
**Commit:** `feat(social): profiles, avatars and follow lists`.

### Task 6: Notifications and the /live socket
**Files:** `server/live.ts` (WebSocket at `/live` on the same server: authenticates with cookie or bearer like `/sync`; per-user channels; `publish(userId, event)`), `server.ts` (mount), schema `notifications`, `server/social/notify.ts`, `app/api/notifications` (list, mark read), `components/app/Bell.tsx`, `app/[locale]/notifications/page.tsx`, `client/live.ts` (reconnecting client, events → React).
**Events now:** new follower, follow request, request accepted, trip invite, someone copied your trip (likes/comments/messages added in later blocks).
**Tests:** `/live` auth (cookie/bearer/refused), publish reaches only that user, reconnect; notification rows created for each event, hidden when the actor is blocked or in another realm; bell count updates live; accept/decline follow requests from the list.
**Commit:** `feat(social): notifications over a live socket`.

### Task 7: Reports and admin
**Files:** schema `reports`, `app/api/reports`, `components/common/ReportDialog.tsx` (user, trip, comment-ready, message-ready), `app/[locale]/admin/page.tsx` (only `ADMIN_USER_IDS`), actions dismiss / delete content / suspend account (`user.suspended_at` blocks sign-in and hides the account).
**Tests:** report creation + rate limit 20/day; admin page forbidden to others; suspend hides profile/trips and blocks sign-in; delete trip via admin tombstones it like an owner delete.
**Commit:** `feat(social): reports and admin`.

### Task 8: Explore search
**Files:** `app/api/search` (people by username/name prefix + trigram-ish ILIKE; public trips by title/destination), `app/[locale]/explore/page.tsx`.
**Tests:** finds people and public trips; never returns private/followers trips to strangers, blocked users, other-realm content; paging; Turkish characters (ı/İ case folding) match.
**Commit:** `feat(social): explore search`.

### Task 9: Demo world
**Files:** `scripts/seed-demo-world.ts` (idempotent: ~8 travellers in realm demo with illustrative SVG avatars generated in code, bios, home cities, 2–4 trips each across cities with real coordinates, mixed visibility, follows between them, likes/comments-ready), `server/demo.ts` (visitor follows 5 seeded travellers; Deniz/Selin get profiles), sandbox rules (visitor-created social data visible only to that visitor + seeded world; cleanup removes it), run the seed at container start if missing.
**Tests:** seed is idempotent; a demo visitor sees seeded travellers and their visible trips, never another visitor's profile/trips; a real user sees none of the demo realm; cleanup removes the visitor's follows and notifications.
**Commit:** `feat(social): demo travel world`.

### Task 10: E2E, accessibility and docs
**Files:** e2e specs: sign up with username → follow a user → their public trip appears on the profile → copy it → it opens as yours; private account follow request accept; block hides profile; visibility lowered while viewing; demo lands with suggestions; update existing e2e specs for the new shell and UI v2 trip screen (restores everything ruled red in UI v2 ruling U2); axe on Home, Explore, Profile, Notifications, Admin, trip read-only view (1280×800 and 390×844); README "What it does" + screenshots.
**Checks:** `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build`.
**Commit:** `test(social): end-to-end and accessibility for the social foundation`.
