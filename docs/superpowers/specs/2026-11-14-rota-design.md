# Rota: Design — a group trip planner you edit together, even offline

**Status:** draft for owner review, 2026-11-14. Once the owner approves it, the whole document is approved, Claude's calls included.
**Repo:** `~/Personal/rota` (new, from scratch). GitHub `cemakcck/rota` once the owner asks for a push.

The owner picked Rota from three pitches (Shortlist, Sarsıntı, Rota) and asked for concrete pitches instead of questions. Almost everything below the pitch is therefore **Claude's call**; the owner-decided parts are marked **(owner)**. Read the calls with that in mind.

---

## 1. Intent

The portfolio shows three sides of the owner's skills, one per app **(owner)**:

- **Lodos**: a management system (full backend, staff and guest sides).
- **Clinic (Lindenya)**: booking that stays correct under concurrency (Postgres exclusion constraint, holds, exactly-once reminders).
- **Rota**: **real-time collaboration and offline-first sync**, with a polished, product-grade interface.

The pitch the owner accepted **(owner)**: a trip planner a group of friends edits together live, like Google Docs for a trip. Two windows show each other's cursors and edits instantly; a phone with no signal keeps editing, and on reconnect nothing is lost and nobody overwrites anybody. That is the Figma/Notion/Linear class of problem, and the demo must make it visible in seconds.

Audience: recruiters and prospective freelance clients, usually alone, usually on a laptop, giving it under two minutes. The owner prefers full-stack/frontend work, so this app is where the interface craft shows.

**Deadline:** deployable by about **2026-12-13** **(owner)**, alongside the other apps.

## 2. Scope

**In (the pitch, owner-accepted):**

1. **Plan together** (§4): a trip has days; days hold places in order; places and days have notes. Live presence: who is here, their cursors, edits appearing as they type.
2. **Map and itinerary** (§5): places on a map; drag a place into a day or reorder within a day; travel times between consecutive stops update.
3. **Votes** (§6): anyone suggests a place; everyone votes it up or down.
4. **Works offline** (§7): installable on a phone (PWA); editing with no signal; sync on return; a visible "synced / N changes waiting" indicator.
5. **Demo mode** (§8): "Try it with a friend" opens a second window already in the trip.

**Cut order if time runs short:** votes go first **(owner-accepted)**. After that (Claude's call), in this order: the scripted friend (§8), offline map tiles, the landing-page animation, the QR code in the share dialog, live cursors on the map (presence avatars and the editing outline stay). Never cut: editing together, offline editing and the sync indicator, the map with travel times, merge tests, English + Turkish, accessibility. The build order follows the same priority: the shared document, merge tests and sync first, then offline, then the map, then everything else, so scope can be dropped at any checkpoint without losing the core.

**Non-goals (Claude's call):**
- Accounts, passwords, email sign-up. Identity is a display name and colour per device.
- Bookings, prices, budgets, expense splitting (Lodos already shows money).
- Chat or comments threads (notes cover it).
- Native mobile apps (the PWA is the mobile story).
- Public trip listings, search across trips, sharing to social media.
- Real-time voice/video, AI suggestions.
- Turn-by-turn directions; travel time is an estimate between consecutive stops only.

**Anti-goals:**
- **Lost or duplicated work.** Two people moving the same place at the same time must never produce two copies of it or lose it. An offline edit must never silently vanish.
- **A demo that needs a second person.** A lone visitor must see collaboration without inviting anyone.
- **A demo that a stranger can vandalise.** One visitor's trip is never visible to another unless they share the link.
- **Sync that only works on localhost.** It must work through Railway's proxy, on a phone, on flaky connections.

## 3. How it gets made (Claude's call)

- **Next.js 16** (App Router) + **TypeScript** + **Tailwind CSS 4**, matching the clinic. Radix primitives only for tricky widgets (dialogs, menus).
- **Yjs** for the shared trip document (a CRDT: concurrent edits merge without a server deciding). **y-indexeddb** keeps a full local copy in the browser, which is what makes offline editing work.
- **Hocuspocus** (MIT, the Yjs WebSocket server from the Tiptap team) relays edits and awareness (presence), and persists documents to **PostgreSQL 17** through its database extension. Drizzle ORM for the small amount of relational data (§9).
- **One Node process, one port:** a custom server hosts the Next.js request handler and Hocuspocus on the WebSocket upgrade path `/sync`. One Docker container on **Railway** next to Lodos. The database is **Neon's free Postgres tier** **(owner: keep the total hosting bill at about $5/month)**; it sleeps when idle, so the first request after a quiet spell can take a second or two, and the app must tolerate that (connection retry on cold start, sync clients keep working locally meanwhile). No paid APIs.
- **Map:** **MapLibre GL JS** with **OpenFreeMap** tiles (free, no key). **Place search:** **Photon** (komoot's public geocoder, OpenStreetMap data), called through our own server route with caching and a per-IP limit. **Travel times:** the public **OSRM** demo server (walking and driving), called through our server with caching and a hard per-IP and global rate limit; when OSRM is unavailable or over the limit, show a straight-line estimate labelled "≈". Both are free services with fair-use policies; the server route is what keeps us inside them.
- **Languages:** English and Turkish (next-intl), like the clinic, with a test that both message files have identical keys.
- **Quality bar** (same as the other apps): Vitest unit and integration tests, Playwright end-to-end with **two browser contexts** and **offline simulation**, axe accessibility scans (WCAG 2.2 AA), GitHub Actions CI, a recruiter-ready README with screenshots and an "engineering decisions" section.

## 4. Plan together

### 4.1 The trip document
One Yjs document per trip. Shape (Claude's call):

- `meta` (Y.Map): `title`, `startDate`, `days` count, `createdAt`.
- `places` (Y.Map of placeId → Y.Map): `name`, `lat`, `lng`, `osmId` (if from search), `category` (food, sight, stay, other), `dayId` (or `null` = unplanned/"Ideas"), `order` (fractional index string), `note` (Y.Text), `addedBy` (member id), `status` (`planned` | `suggested` | `dismissed`), `votes` (Y.Map of memberId → +1/−1).
- `days` (Y.Map of dayId → Y.Map): `index`, `note` (Y.Text), `travelMode` (walk | drive).
- `members` (Y.Map of memberId → Y.Map): `name`, `colour`, `joinedAt`.

**Ordering uses fractional indexes, not Y.Array moves (Claude's call; this is the README's headline decision).** Yjs arrays have no "move", so a move is delete + insert, and two people moving the same place concurrently produce two copies. Storing each place's `dayId` + `order` as fields on the place makes a move a single field write: concurrent moves resolve to one winner (last writer wins on that place), never a duplicate. Two places landing on the same order key are tie-broken by placeId. Write this up in the README the way the clinic explains its exclusion constraint, with tests that reproduce the duplicate with the naive approach and show it cannot happen here.

### 4.2 Editing
- Add a place (from search, from a map long-press/right-click, or a free-text "custom place" without coordinates, which shows in the list but not on the map).
- Rename, recategorise, delete (with an "Undo" toast), move between days and Ideas, reorder within a day (drag with mouse/touch, plus keyboard: a "Move to…" menu and up/down buttons, as in the clinic's keyboard reschedule dialog).
- Notes per place and per day are collaborative text (Y.Text) with remote carets in the other person's colour.
- Trip title and dates editable; adding/removing days (removing a day moves its places to Ideas, never deletes them).
- **Undo/redo per person** (Yjs UndoManager scoped to the local member's changes): your undo never reverts a friend's edit.

### 4.3 Presence
- Avatars of who is in the trip now (Yjs awareness), with their colour and "editing <place>" when focused.
- **Live cursors on the map**, positioned by latitude/longitude so they line up across different window sizes and zoom levels; hidden when the other person's cursor is off the map.
- The place someone is editing gets an outline in their colour in the itinerary.
- Members who left show as "last seen" in a trip members list.

### 4.4 Identity (Claude's call)
On first open of a trip on a device, a small "What should friends call you?" prompt with a suggested colour. Stored in localStorage as a random member id + name + colour, and registered in the trip's `members` map. No accounts. Anyone with the trip link can edit; the link is the key (§9).

## 5. Map and itinerary

- **Layout:** desktop is itinerary panel on the left (days as sections, Ideas at the bottom) and the map on the right. Phone is a full-screen map with a draggable bottom sheet holding the itinerary, with a toggle to a list-only view.
- Pins are numbered per day in the day's colour; the selected day's route is drawn as a line between consecutive stops.
- **Travel times** between consecutive stops in a day ("12 min walk"), per the day's walk/drive mode; a day total. Computed in the browser of whoever is viewing (never stored in the doc), via our cached server route (§3). Offline: straight-line "≈" estimate.
- Clicking a pin selects the place in the list and vice versa.
- Map tiles viewed while online are cached by the service worker for offline viewing (best-effort; the app says "map may be incomplete offline").

## 6. Votes

- A place added with "Suggest" (instead of "Add to day") goes to a **Suggestions** list with status `suggested`.
- Each member votes up or down once (changeable); the list sorts by score, ties by newest.
- Anyone can **accept** (moves it to a day or Ideas, status `planned`) or **dismiss** (hidden under "Dismissed", restorable). No automatic acceptance thresholds (Claude's call: groups argue; the app shouldn't decide for them).
- Votes are per member id, so one device can't vote twice.

## 7. Works offline

- **PWA:** web app manifest, icons, installable on Android and iOS; a service worker caches the app shell and the trip page so it opens with no signal.
- **Local first:** every trip opened on the device is kept in IndexedDB (y-indexeddb). Edits apply locally at once and sync when the connection returns; Hocuspocus reconnects with backoff.
- **Sync indicator** in the header: "Synced", "Offline — 3 changes waiting", "Syncing…". It counts local updates not yet acknowledged by the server.
- **Opening a trip link for the first time while offline** shows a clear "Connect once to download this trip" message.
- A "My trips" home page lists trips stored on this device (title, dates, last opened), with "Remove from this device".
- **Demo toggle:** a "Simulate offline" switch in the demo banner (§8) disconnects the provider without devtools, so a recruiter can try the conflict story in two windows.

## 8. Demo mode

- **Landing page** (`/`): one-line pitch, a looping short video/animated screenshot of two windows editing, and a big **"Start a demo trip"** button. Plus "New empty trip" for real use.
- **"Start a demo trip"** creates a fresh private copy of a seeded trip: **"Istanbul long weekend"**, 3 days, ~12 places across Karaköy, Balat, Kadıköy and the Bosphorus, notes, two suggestions with votes, and two pre-existing friends ("Deniz", "Selin") in the members list.
- **"Try it with a friend"** button in the demo banner opens the same trip in a new window (or a split-screen on wide screens: Claude's call, decided at build time) under a second identity, so one visitor sees both sides.
- **Scripted friend (Claude's call, cheap and memorable):** about 10 seconds after a demo trip opens, a server-side "Deniz" joins via awareness, moves her cursor on the map, adds a note and casts a vote, then leaves. It uses the same sync path as a real client (a headless Yjs client on the server), so it proves the plumbing instead of faking it. Runs once per demo trip.
- Demo banner text: "This is a demo. Trips you create are private to their link and deleted after 30 days without edits."

## 9. Server, storage, limits

- **Trip ids** are 128-bit random, base62 in the URL (`/t/<id>`). Knowing the id is the only access control; there are no listings. A "Share" dialog copies the link and shows a QR code.
- **Postgres tables:** `trips` (id, title snapshot for the "My trips" page, created_at, last_edited_at, size_bytes), and Hocuspocus's document store (trip id → Yjs state as `bytea`, compacted on store). Drizzle for migrations.
- **Limits** (protect the free hosting): trip creation 20 per IP per day; document size cap 2 MB and max 200 places per trip, both enforced **in the interface** (§9.1);  max 50 concurrent connections per trip; WebSocket message size cap; geocoding 60 per IP per minute; routing 120 per IP per minute and a global ceiling under OSRM's policy. IPs stored only as HMAC hashes (as in the clinic).
- **Validation:** full schema validation of CRDT updates is out of scope; the client ignores malformed places rather than crashing. The server only refuses traffic no copy of this app produces (a single message over 1 MB, unknown top-level types), and closes that connection.
- **Cleanup:** an hourly timer inside the app process deletes trips with no edits for 30 days (no separate cron service).
- **Health:** `/api/health` for Railway.

### 9.1 When limits meet offline edits (Claude's call)
The anti-goal "an offline edit never silently vanishes" wins over the limits:
- **The server never refuses an update from a normal client.** Refusing one would leave that device permanently out of step with everyone else. The 2 MB and 200-place caps are soft: the interface stops offering "Add place" and shows "This trip is full" once the synced document reaches either cap. A burst of offline edits that overshoots the cap is accepted.
- **A trip deleted by the cleanup is restored** if a device that still holds a copy reconnects: the server recreates it from that device's state. The banner's "deleted after 30 days" wording becomes "removed from our server after 30 days without edits; copies on your devices still work and come back online when opened".
- The "changes waiting" counter therefore always reaches zero once a connection holds.

## 10. Accessibility and polish

- WCAG 2.2 AA: every drag has a keyboard and button alternative; map pins are mirrored by the itinerary list (the list is the accessible source of truth); live remote changes announced politely only for structural changes ("Deniz moved Galata Tower to Day 2"), never per keystroke.
- Respects `prefers-reduced-motion`.
- Light theme required; dark theme optional (Claude's call: light only unless time allows).
- Visual direction left to the builder within this brief: calm, map-forward, product-grade, with member colours as the main accent. A design reference page (like Lodos's `docs/design-reference`) is produced in the first days and shown to the owner, but **the sync, merge and offline work does not wait for it**; only the visual styling of the trip screen does.

## 11. Testing (the parts that prove the claims)

- **Merge tests** (unit, pure Yjs, no network): two docs, concurrent moves of the same place → exactly one copy; concurrent move + delete → deleted; concurrent edits to one note → both kept; offline doc with 50 edits merges with a doc that changed meanwhile; undo only reverts your own edits.
- **Server integration:** persistence round-trip through Postgres; reconnect after server restart; size cap and rate limits.
- **End-to-end (Playwright):** two contexts edit the same trip and see each other within 2 s; context A goes offline (`setOffline`), both edit the same day, A reconnects, both converge to the same itinerary; the demo flow from landing page to "Try it with a friend"; the scripted friend appears; PWA works offline after first load; axe scans of landing, trip (desktop + phone viewport) and share dialog.
- Tests run with a non-Istanbul `TZ` (dates are local-date strings, not instants).

## 12. Deliverables

- Working app, deployable to Railway as one container (Dockerfile, `railway.json`, README deploy steps), with `.env.example`. Going live is a separate step done with the owner (accounts, secrets, domain), as with Lodos and the clinic; the build delivers a container that is ready to deploy.
- README in the style of the other two: live demo link placeholder, screenshots/GIF of two windows, "What it does", "Engineering decisions" (CRDT choice, fractional-index moves, offline queue and indicator, one-port server, rate-limited proxies to free map services), architecture diagram, how to run locally.
- CI on GitHub Actions.

## 13. Left to the builder

Component structure, colour palette and typography within §10, exact copy wording (both languages), whether "Try it with a friend" is a new window or a split-screen, how the bottom sheet behaves on phone, the fractional-index library (or a small own implementation), and test file layout.
