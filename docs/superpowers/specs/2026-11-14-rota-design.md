# Rota: Design — a group trip planner, web and mobile, edited together live and offline

**Status:** draft for owner review, 2026-11-14 (revision 2, after the owner described the product in their own words). Once the owner approves it, the whole document is approved, Claude's calls included.
**Repo:** `~/Personal/rota` (new, from scratch). GitHub `cemakcck/rota` once the owner asks for a push.

Owner-decided parts are marked **(owner)**; everything else is **Claude's call** and is marked where it matters.

---

## 1. Intent

The portfolio shows three sides of the owner's skills, one per app **(owner)**:

- **Lodos**: a management system (full backend, staff and guest sides).
- **Clinic (Lindenya)**: booking that stays correct under concurrency.
- **Rota**: **a real product on web and mobile**: accounts, shared trips, maps and routes, real-time collaboration and offline sync.

In the owner's words **(owner)**: everyone has an account; people create trips, name them, and invite others. Inside a trip the map opens on that trip; everyone can add places and categorise them (drinks, food, museum, gym, …); places come from the map (search a restaurant, pick it). Trips have days with an order ("first we go there, then there"); the map pins the places and shows the routes. Every place can be opened in Google Maps. There is a web app **and a mobile app**. The owner is open to more features and accepted Claude's five ideas (§8) **(owner)**.

Audience: recruiters and prospective freelance clients, usually alone, giving it two minutes; and the owner's own friends, who should find it genuinely useful.

**Deadline (owner):** both the web app and the mobile app done by about **2026-12-13**. The web app comes first; the mobile app second **(owner)**.

## 2. Scope

**Web app (phase 1):**
1. Accounts, sign-in, profiles (§3).
2. Trips: create, name, invite, members, leave/remove/delete (§4).
3. Places: add from map search, map tap, or by hand; categories and tags (§5).
4. Days and order, map pins, routes and travel times (§6).
5. Google Maps links: per place and per day (§7).
6. Extras **(owner accepted)**: day timeline, opening-hours warnings, whole day in Google Maps, weather per day, shared checklist (§8).
7. Editing together live, presence, offline (§9, §10).
8. Demo mode (§11).

**Mobile app (phase 2, same deadline):** §13.

**Cut order if time runs short (Claude's call):** scripted friend (§11) → offline map tiles → weather → opening-hours warnings → landing animation → QR code → live map cursors → Google sign-in. **Never cut:** accounts and invites, map search, categories, days/order/routes, Google Maps links, the day timeline, live editing, offline editing with the sync indicator, merge tests, English + Turkish, accessibility, the mobile app's core (§13.2).

**Non-goals:** bookings and prices, expense splitting (Lodos shows money), chat threads, public trip listings or social feeds, AI suggestions, turn-by-turn navigation (Google Maps does that), photos/uploads, App Store or Google Play listings (§13.3).

**Anti-goals:**
- **Lost or duplicated work.** Two people moving the same place at once never produce two copies or lose it; an offline edit never silently vanishes.
- **A demo that needs signing up or a second person.** One click puts a visitor in a lived-in trip; one more shows collaboration.
- **One visitor seeing another's trips.** Access is by membership, checked on the server for pages, API and sync.
- **Sync that only works on localhost.** It must work through Railway's proxy, on phones, on flaky connections.

## 3. Accounts

- **Better Auth** (as in the clinic): **email + password** sign-up and sign-in; email verification **not** required (Claude's call: friction kills demos; invites by email still work); password reset by email. **Google sign-in** if time allows (in the cut list).
- Profile: display name (1–30 chars) and avatar colour (one of 8 member colours); shown everywhere instead of the email.
- Sessions: cookies on the web; bearer tokens for the mobile app and for "friend" windows (§11).
- Email via **Resend** free tier (as in the clinic); without an API key, emails are written to the server log so local development needs nothing.

## 4. Trips and members

- **Create:** name (required, 1–60 chars), start date, number of days (1–30), optional destination (a geocoded place that centres the map and drives weather).
- **My trips** page: trips I'm in, upcoming first then past, with name, dates, members' avatars, and an "offline copy" badge when stored on this device.
- **Roles:** **owner** (creator) and **member**. Every member edits content, including the trip's name and dates (Claude's call: groups share the work). Only the owner removes members, manages invites, hands over ownership and deletes the trip. A member can leave.
- **Invites (Claude's call, both):**
  - **Invite link:** the owner creates it; anyone signed in who opens it joins. The owner can turn it off or regenerate it. Shown with a QR code.
  - **Invite by email:** the owner enters an email. If that person has an account, they're added and emailed; if not, they're emailed a sign-up link carrying a single-use invite token (only its hash is stored) and join when they sign up, or sign in, through that link; a plain sign-up with the same address does not join (addresses are not verified). Pending invites are listed and cancellable.
- **Delete trip:** owner only, with confirmation. Members' devices then show "This trip was deleted by its owner" and offer to remove the local copy. **Removed member:** their device shows "You were removed from this trip" and drops the local copy after confirmation. In both cases edits made offline after the removal are discarded **with that message shown**, never silently.
- **Access control:** the database's `trip_members` is the source of truth. Pages, API routes and the sync server all check membership. The shared trip document mirrors member names and colours for display only.

## 5. Places, categories and tags

- **Add a place** three ways:
  1. **Search** (Photon, OpenStreetMap data): "restaurants Karaköy", a name, or an address; results biased to the map's current view; pick one to add it with name, coordinates, address and OSM id.
  2. **Tap the map** (long-press on touch, right-click on desktop): name prefilled from reverse geocoding.
  3. **By hand:** a name without coordinates (listed, not pinned).
- Added to a chosen day or to **Ideas** (unscheduled), or as a **suggestion** for votes (§5.1).
- **Category** **(owner: categories such as drinks, food, museum, gym)**, one per place, fixed list with icons (Claude's call): **food, drinks, café, museum, sight, nightlife, shopping, nature, gym, stay, other**. Search results get a suggested category from OSM tags; the user can change it.
- **Tags:** up to 5 free-text tags per place (max 24 chars), e.g. "rooftop", "must-see". Filter the map and list by category and tag.
- Each place also has a note (collaborative text), a stay duration (§8.1), and votes.

### 5.1 Suggestions and votes
A place added as a suggestion goes to **Suggestions**; members vote up or down once (changeable); sorted by score then newest. Anyone can accept it (into a day or Ideas) or dismiss it (restorable). No automatic thresholds.

## 6. Days, order, map and routes

- A trip has **days** (dated from the start date); each day holds places **in order** **(owner)**. Drag to reorder or move between days and Ideas, with a keyboard/button alternative ("Move to…", up/down). Removing a day moves its places to Ideas, never deletes them.
- **Map** **(owner)**: opens on the trip (fit to its places, else the destination, else Istanbul). Pins numbered per day in the day's colour; the selected day's **route** drawn along roads/paths between consecutive stops; Ideas pins grey; tapping a pin selects the place in the list and vice versa.
- **Travel times** between consecutive stops ("12 min walk") and a day total; each day is **walk** or **drive**. From the FOSSGIS OSRM servers through our cached, rate-limited proxy; when unavailable or offline, a straight-line estimate marked "≈" and a straight route line.
- Layout: desktop = list left, map right. Phone web = full-screen map with a draggable bottom sheet holding the list, plus a list-only toggle.

## 7. Google Maps links (owner)

- **Every place:** "Open in Google Maps" (external, new tab) → `https://www.google.com/maps/search/?api=1&query=<lat>,<lng>`; places without coordinates use `query=<name>`.
- **Every day** (idea 3, owner accepted): "Open day in Google Maps" → `https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=…&travelmode=walking|driving` with the day's stops in order. A day with more than **9** waypoints is split into consecutive links ("Part 1 of 2", sharing the boundary stop).

## 8. Extras (owner accepted all five)

### 8.1 Day timeline
Each day has a **start time** (default 09:00). Each place has a **stay duration**, defaulting by category (food 75 min, drinks 60, café 45, museum 120, sight 45, nightlife 120, shopping 60, nature 90, gym 60, stay 0, other 60) and editable. The list shows estimated arrival times ("around 11:20") = start + stays + travel legs. Times are local wall-clock strings, never instants.

### 8.2 Opening-hours warnings
For places with an OSM id, fetch OpenStreetMap's `opening_hours` tag (Overpass API, through our cached proxy) and evaluate it at the estimated arrival on that date. Warnings: "Closed on Mondays", "Opens at 10:00 — you arrive around 09:30", "Closes at 17:00 — you arrive around 16:50". No data → no warning (never "might be closed"). Holidays beyond what the tag says are out of scope.

### 8.3 Whole day in Google Maps
See §7.

### 8.4 Weather per day
For days within the forecast range, the day's forecast (icon, high/low, rain chance) at the trip's destination (else the centroid of its places), from **Open-Meteo** (free, no key) through our cached proxy. Further-out days show "Forecast from <date>".

### 8.5 Shared checklist
One checklist per trip (packing, tickets, to-dos): add, tick, reorder, delete, optionally assign to a member. Lives in the shared trip document, so it is live and offline like everything else.

## 9. Editing together live

- One **Yjs** document per trip, synced by **Hocuspocus** (WebSocket at `/sync`) and persisted to Postgres. Every member's edits merge without conflicts; edits appear for others within about a second.
- **Ordering by fractional indexes** stored on each place (`dayId` + `order`), not array moves: concurrent moves of the same place resolve to one winner and never duplicate it. This is the README's headline engineering decision, proven by tests that show the naive approach duplicating.
- **Presence:** avatars of who's in the trip now; the place someone is editing outlined in their colour; their caret in notes; **live cursors on the map** (positioned by latitude/longitude).
- **Undo/redo per person:** your undo never reverts a friend's edit.
- Remote structural changes announced politely to screen readers ("Deniz moved Galata Tower to Day 2").

## 10. Offline

- **Web:** installable PWA; app shell, My trips and visited trip pages cached by a service worker; every trip opened on the device stored in IndexedDB; edits apply locally and sync on reconnect; header shows **"Synced" / "Syncing…" / "Offline — N changes waiting"**. Map tiles viewed online are cached best-effort ("map may be incomplete offline"). Search, travel times (falls back to "≈"), weather and opening hours need a connection.
- **Limits never eat offline work:** the server never refuses a member's update for size. Soft caps (2 MB document, 200 places, 100 checklist items) are enforced in the interface ("This trip is full").
- First open of a trip while offline: "Connect once to download this trip".
- **"Simulate offline"** switch in demo mode (§11) so a visitor can see it without devtools.

## 11. Demo mode

- Landing page: pitch, a short looping animation of two windows editing (static under reduced motion), **"Try the demo"**, "Sign up", "Sign in".
- **"Try the demo"** creates a private **demo account** for this visitor (flagged demo, a random friendly name they can change) with a seeded trip **"Istanbul long weekend"**: 3 days, ~12 places across Karaköy, Balat, Kadıköy and the Bosphorus with categories, tags, notes and stay durations, a checklist, two suggestions with votes, and two friends **Deniz** and **Selin** (demo accounts created with it, members of the trip). The visitor is signed in at once.
- **"Try it with a friend"** opens the same trip in a second window (or side by side on wide screens) **signed in as Deniz**, using a bearer token kept in that window's `sessionStorage`, so one browser can be two people.
- **Scripted friend (cut first):** about 10 s after a demo trip first opens, Selin joins through the real sync path (a server-side client), moves her cursor on the map, adds a note, votes, ticks a checklist item, and leaves. Once per demo trip.
- Demo banner with "Simulate offline" and "Try it with a friend". Demo accounts and their trips are deleted after **7 days** without activity; real accounts are never auto-deleted.

## 12. Server, storage, limits

- **One Node process, one port**: a custom server hosts Next.js and Hocuspocus. One Docker container on **Railway**; **Neon free Postgres** **(owner: total hosting about $5/month)**. Neon sleeps when idle, so all DB access retries connection errors on cold start. Resend free tier for email. No paid APIs.
- **Tables (Claude's call):** Better Auth's tables (plus `is_demo`, `colour`, `last_active_at` on users); `trips` (id, name, start date, days count, destination, owner, created/updated, is_demo, friend_ran_at); `trip_members` (trip, user, role, joined_at); `trip_invites` (trip, kind link|email, token hash or email, created_by, created_at, revoked_at); `trip_documents` (trip, Yjs state bytea, updated_at, size_bytes); `rate_limits`.
- Trip ids: 128-bit random, base62, 22 chars (unguessable; access is still by membership).
- **Free services through our proxies, cached and rate-limited:** Photon search, FOSSGIS OSRM routing, Overpass opening hours, Open-Meteo weather; OpenFreeMap tiles load directly. Per-IP limits: search 60/min, routing 120/min, opening hours 60/min, weather 60/min; at most 1 upstream request per second per service; descriptive User-Agent; OpenStreetMap attribution on the map.
- **Other limits:** sign-ups and demo starts 20 per IP per day; 50 trips per user; 20 members per trip; 50 concurrent connections per trip; WebSocket messages over 1 MB close the connection. IPs stored only as HMAC hashes.
- **Cleanup:** an hourly timer deletes demo accounts and their trips after 7 days without activity.

## 13. Mobile app (phase 2, owner: done by the deadline)

### 13.1 What it is
A real **iOS and Android app built with Expo (React Native)**, sharing the trip logic with the web app. Same account, same trips, live with the web: an edit on the phone appears on the laptop at once and vice versa.

### 13.2 What it does (core, not cut)
Sign in / sign up / try the demo; My trips; create a trip; join by invite link (`rota://invite/<token>` and the https link); the trip screen: map with pins and routes, day list with drag reorder, add places by search or long-press on the map, categories and tags, notes, timeline and travel times, Google Maps links (opening the Google Maps app if installed), suggestions and votes, checklist, presence avatars; offline editing with the same sync indicator. Weather and opening-hours warnings when online. Live map cursors, the scripted friend and "Try it with a friend" are web-only.

### 13.3 How it's shared and distributed (Claude's call)
- npm workspaces monorepo: `apps/web`, `apps/mobile`, `packages/trip` (document model, ordering, view, timeline, travel estimates, Google Maps links, opening-hours evaluation; no DOM or React Native imports).
- Maps on mobile: MapLibre React Native with the same OpenFreeMap style. Offline storage: the Yjs state persisted on the device (SQLite) instead of IndexedDB. Auth: Better Auth's Expo integration with bearer tokens in secure storage.
- **Distribution without paid store accounts:** an **Android APK** built with Expo's free EAS tier, downloadable from the README/portfolio; **iOS** shown through a recorded simulator video and screenshots, plus instructions to run it locally. TestFlight or the App Store needs the paid Apple Developer Program ($99/year) and is out of scope unless the owner decides otherwise.

## 14. Accessibility and polish

WCAG 2.2 AA on web (every drag has a keyboard/button alternative; the list is the accessible source of truth for the map; reduced motion respected) and platform accessibility labels on mobile. Light theme only. English and Turkish on both apps, with a test that the message files have identical keys. Visual direction: calm, map-forward, product-grade, member colours as the accent; a design reference page is produced early and shown to the owner, while sync, data and offline work proceed without waiting for it.

## 15. Testing

- **Shared package:** merge tests (concurrent moves → one copy; move + delete; concurrent note edits; long offline merges), timeline arithmetic, opening-hours evaluation, Google Maps link building (including the 9-waypoint split), undo per member.
- **Server integration (real Postgres):** auth, membership checks on API and sync (non-member refused, removed member disconnected), invites (link; email for existing and future accounts), persistence, rate limits, proxies with mocked upstreams.
- **Web end-to-end (Playwright):** two signed-in users edit one trip and see each other within 2 s; offline convergence (`setOffline` and the Simulate offline switch); demo flow; invite flow; axe scans.
- **Mobile:** unit tests for screens (React Native Testing Library); one end-to-end smoke flow on Android (Maestro) if time allows, otherwise run by hand before release.
- Tests run with a non-Istanbul `TZ`.

## 16. Deliverables

- Web: one Docker container for Railway (Dockerfile, `railway.json`, `.env.example`), CI on GitHub Actions.
- Mobile: Expo project, EAS build config, Android APK, iOS simulator video.
- README in the style of the other two apps, covering both apps: screenshots and a two-window GIF, "Try this", "What it does", "Engineering decisions" (CRDT; fractional-index moves; offline queue and indicator; membership-checked sync; limits that never eat offline work; one-port server; rate-limited proxies to free services; Neon cold-start retry; one shared package for web and mobile), architecture diagram, running locally, deploy steps, credits (OpenStreetMap contributors, OpenFreeMap, Photon/komoot, FOSSGIS OSRM, Open-Meteo).
- Going live (accounts, secrets, domain) is a separate step done with the owner, as with Lodos and the clinic.

## 17. Left to the builder

Component structure, palette and typography within §14, exact copy in both languages, category icons, the bottom-sheet behaviour, the fractional-index library, mobile navigation structure, and test file layout.
