# Rota Social: Design — a social travel app built around shared trips

**Status:** approved by the owner 2026-11-15 ("deadline can be procrastinated. continue with all") — full scope, Claude's calls included.
**Extends:** `2026-11-14-rota-design.md` (the trip planner) and `2026-11-15-rota-ui-v2-design.md` (the trip screen redesign). Everything there still holds unless this document changes it.

Owner-decided parts are marked **(owner)**; everything else is Claude's call.

---

## 1. Intent

In the owner's words **(owner)**: "people are gonna have their profiles, profile picture, bio, username, and instead of posts… they create trips… they can post pictures from their trips… it's gonna be a traveler Instagram… but not with photos, but with trips. So people are gonna have followers following… connected to their friends and they can DM each other… 'should we do this? Okay, hang on, I'm gonna create this trip in a second'. And then they create the trip, which is the main thing of the app still… The main problem in this is we don't want this to be a planning tool. We want this to be an interactive and collaborative social traveling app."

So:
- **The trip is the post.** Profiles show trips the way Instagram shows photos. Planning together stays the heart of the product.
- **Social glue around it:** follows, a feed, likes and comments, photos on trips, messages — and conversation turns into trips in one tap.
- Web and mobile (Expo) share the design **(owner)**.

**Deadline (owner):** the full scope matters more than the 2026-12-13 date — "deadline can be procrastinated. continue with all". Build everything in §13's order; the cut list below is no longer used.

## 2. Goals, non-goals, anti-goals

**Goals:** profiles; follows (+ friends = mutual follows); trip visibility (private / followers / public) and public trip pages; photos on trips and stops; a home feed with likes, comments, Copy to my trips, Ask to join; messages (1:1, group, and a chat per trip) with "Make this a trip"; in-app notifications (push on mobile); basic search; safety (block, report, private account, delete account); a lively demo.

**Non-goals:** stories, reels, video; algorithmic ranking (feed is chronological); ads; end-to-end encrypted messages (messages are stored on the server and say so in the privacy note); AI moderation; travel stats/world map (later); trending/discovery beyond search (later).

**Anti-goals:**
- **A feed that feels empty.** First visit (demo or new account) must show real-looking activity.
- **Private plans leaking.** Trips are private unless the owner chooses otherwise; nothing is shared automatically; blocked users see nothing of you.
- **Strangers spamming people.** Messages from non-friends land in Requests; public demo content from visitors is never shown to other visitors.
- **Breaking the planner.** Live editing, offline, per-stop times and everything in the earlier specs keep working.

## 3. Navigation

Phone and web share five destinations: **Home** (feed) · **Explore** (search) · **＋** (new trip) · **Messages** · **Profile**, plus a **bell** (notifications) in the header. Phone: bottom tab bar. Web: left sidebar with the same items. Opening any trip goes to the trip screen from the UI v2 redesign, which gains a **Chat** tab next to Plan / Ideas / Checklist, and a **Photos** strip.

The UI v2 plan's Tasks 5 (phone shell) and 6 (polish) are superseded by this navigation (§13).

## 4. Profiles

- **@username:** unique, 3–20 chars, lowercase letters, digits, `.` and `_`, not starting/ending with a dot; reserved names (admin, rota, explore, …) refused; chosen at sign-up (existing accounts are asked once on next sign-in; suggestion from their name).
- Display name (existing), **profile photo** (cropped square, see §7), **bio** (≤ 160 chars), **home city** (optional, geocoded name only).
- **Profile page** `/@username`: photo, name, @username, bio, home city; counts: trips (visible to the viewer), followers, following; buttons: Follow / Following / Requested, Message, ⋯ (Block, Report, Share profile). Below: **grid of trip cards** visible to the viewer.
- **Private account** switch: new followers must be approved; non-followers see the header and counts only.
- **Trip card:** cover photo (or the trip's map snapshot with day-coloured route when no cover), title, city/destination, dates, member avatars, like count, a "Planning" badge while the trip is in the future.

## 5. Following, friends, blocking

- Follow anyone; private accounts → follow **request** (accept/decline in notifications).
- **Friends** = mutual follows. Friends can message without a request and be added to trips/chats directly.
- **Block:** both directions hidden (profiles, trips, comments, feed, search, messages); existing follows removed; blocked users can't join your trips; shared trips are unaffected for other members (Claude's call: a block doesn't remove someone from a trip they're already in — the owner can remove them).
- **Remove follower**, unfollow, and list views for followers/following.

## 6. Trip visibility and public trip pages

- Each trip has **visibility**: **Private** (members only; default), **Followers** (the owner's followers can view), **Public** (anyone, also signed-out visitors via link). Only the owner changes it; members see the current setting.
- **Trip page for non-members:** read-only — cover and photos, title, dates, members, the day plan and map (UI v2 layout, no edit controls), likes and comments, **Copy to my trips**, and **Ask to join** (followers/public, only while the trip's end date is in the future). Notes are shown; the checklist, suggestions/votes and trip chat are members-only.
- Read-only viewers load the trip through the same live document read-only (no writes accepted from non-members) so they see edits live (Claude's call: reuse the sync server with a read-only connection mode; the server rejects every update from a read-only connection).
- **Copy to my trips:** creates a new private trip owned by the copier with the same days, places (name, coordinates, category, tags, stay, set times) and day notes; no members, votes, checklist, photos or comments; remembers "copied from <trip> by @user" (shown on the copy and counted on the original as "N copies").
- **Ask to join:** sends the owner a request with an optional message; the owner accepts (requester becomes a member) or declines. Owners can turn requests off per trip.

## 7. Photos

- Attach photos to a **trip** (cover + gallery) and to **any stop**; members add, the uploader or owner deletes; up to 20 per stop, 200 per trip.
- The phone/browser resizes before upload: longest side 1600 px, WebP (JPEG fallback), quality ~0.8, EXIF location stripped (privacy), plus a 400 px thumbnail.
- Storage: **Cloudflare R2** free tier (10 GB, no egress fees) via presigned PUT URLs issued by our server after checking membership and limits; served through our own `/media/<key>` route (checks the trip's visibility for private trips) with long cache headers. Local development and tests use a disk folder instead of R2 (same interface).
- Limits: 1 MB per uploaded image after resizing (server-enforced via signed content-length), 500 photos per user, demo visitors 20.
- On the trip page: a photo strip under the header; on a stop: a small gallery in its details panel; tapping opens a full-screen viewer (swipe on phone, arrows on web).

## 8. Home feed

- **Chronological** list of activity from people you follow (and your own), newest first, paged (20 per page, infinite scroll).
- Activity types (one card each): **started planning** a trip (when it first becomes visible to you), **trip update** (a visible trip got new places/photos — batched: at most one card per trip per 6 hours, "Deniz added 4 places to *Lisbon*"), **trip finished** (end date passed, with its photos), **new photos** (batched like updates), **copied a trip**, **joined a trip**.
- Card: who · what · trip card (cover/map, title, dates, members) · ❤ like · 💬 comment count · **Copy** · **Ask to join** (where allowed) · time ago. Tapping opens the trip page.
- Only trips the viewer may see appear; blocked users never.
- Empty state for new accounts: "Find people to follow" with suggestions (demo travellers in the demo; people you share trips with otherwise).

## 9. Likes and comments

- Like a trip (one per user, toggle). Comment on a trip (≤ 500 chars, plain text, mentions `@username` linkified and notified). Delete own comments; trip owner can delete any comment on the trip; report.
- Comment threads: flat list with replies one level deep (Claude's call).

## 10. Messages

- **Chats:** 1:1, **group** (up to 20, named), and **trip chat** (one per trip; members = trip members, updates as members change).
- Messages: text (≤ 2,000 chars), photos (same pipeline), **cards** — a trip, a day of a trip, or a place (from search or a trip) — rendered as tappable cards. Read receipts per chat ("seen by"), typing indicator, unread badges.
- **Make this a trip** (in 1:1 and group chats): opens New trip prefilled with the chat members as invitees (friends are added directly; non-friends get an invite) and posts the new trip card into the chat. Any place card in the chat has "Add to a trip…".
- **Requests:** a first message from someone who isn't a friend goes to Requests (accept → normal chat; delete; block).
- Live delivery over a **second WebSocket path** on the same server, `/live`, one per signed-in client, carrying chat messages, typing, read receipts and notifications (Claude's call: keep trip-document sync on Hocuspocus `/sync`; social events are ordinary rows and pushes, not CRDTs). Messages are rows in Postgres.
- **Offline:** messages written offline are queued on the device (per user) and sent on reconnect; each has a client-generated id so retries never duplicate. The last 50 messages per chat are cached for offline reading.

## 11. Notifications

- In-app list (bell with unread count): new follower, follow request/accepted, like, comment, mention, reply, trip invite, ask-to-join request/answer, someone copied your trip, message (grouped per chat). Mark read; tap goes to the thing.
- **Mobile push** via Expo push notifications (free) for messages, invites, requests and mentions; per-type toggles in settings. Web: no browser push (Claude's call; keeps scope down).

## 12. Explore (v1) and safety

- **Explore v1:** one search box: people (username, name) and public trips (title, destination/city); results paged. Discovery/trending later.
- **Report** a user, trip, comment or message (reason + optional text). **Admin page** for accounts listed in `ADMIN_USER_IDS`: open reports, view item, dismiss, delete content, suspend account.
- **Delete account:** removes profile, follows, likes, comments, messages (shown as "deleted user" in others' chats), photos they uploaded, and trips they own (members are told; ownership can be handed over first).
- Rate limits (per user + per IP): follows 200/day, comments 100/hour, messages 60/minute, new chats with non-friends 20/day, reports 20/day, photo uploads 100/day.

## 13. Order of work (what lands first)

Given the deadline, build in this order; each block ends deployable:
1. **Finish UI v2 Tasks 3–4** (in progress: details panel, ideas/checklist views, calmer map). UI v2 Tasks 5–6 are replaced by block 2.
2. **Social foundation (web):** usernames + profiles + profile photos, follows/friends/blocks, trip visibility + read-only trip pages + Copy, the new navigation (Home/Explore/＋/Messages/Profile + bell), notifications list, report/admin, the social demo world.
3. **Feed + likes + comments + Ask to join.**
4. **Photos** on trips and stops (R2).
5. **Messages:** trip chat, 1:1 and group chats, cards, Make this a trip, requests, offline queue.
6. **Mobile app (Expo)** covering all of the above + push notifications.
7. Polish, screenshots, README.

**If time runs short, cut in this order:** group chats (keep trip chat + 1:1) → Ask to join → typing indicators/read receipts → comment replies → mentions → photo gallery on stops (keep trip cover + trip photos) → push notifications on mobile. Never cut: profiles, follows, visibility/public pages, feed with likes/comments, trip chat + DMs with Make this a trip, block/report, the demo world.

## 14. Demo world

- "Try the demo" keeps working (visitor account + Istanbul trip with Deniz and Selin) and adds a **seeded travel world**: ~8 made-up travellers with photos (generated/illustrative, no real people's photos), bios, public and followers-only trips in several cities, likes, comments, and an existing group chat "Weekend plans" with Deniz and Selin where the visitor can try Make this a trip.
- **Realms (Claude's call):** demo visitors and the seeded travellers live in a "demo" realm; real accounts in the "real" realm. Queries never cross realms: real users never see demo content and demo visitors never see real users. Within the demo realm, a visitor sees the seeded world and their own sandbox (their trips, their Deniz/Selin), never other visitors' content. Seeded travellers are created once by a seed script and are read-only (visitors can like/comment/follow them; those interactions are visible only to that visitor).
- Demo cleanup (7 days idle) removes the visitor's interactions with the seeded world too.

## 15. Data (Claude's calls)

New tables (Drizzle): `user` gains `username` (unique, case-insensitive), `bio`, `avatar_key`, `home_city`, `is_private`, `realm`; `follows` (follower, followee, status accepted/pending, created_at); `blocks`; `trips` gains `visibility`, `cover_key`, `copied_from_trip_id`, `join_requests_enabled`, `copies_count`; `trip_join_requests`; `trip_likes`; `comments` (trip, author, parent, body, created, deleted); `photos` (key, trip, place id nullable, uploader, width, height, created); `chats` (kind dm/group/trip, trip id, name); `chat_members` (chat, user, last_read_at, muted); `messages` (client id unique per sender, chat, sender, body, kind text/photo/card, card payload json, created, deleted); `activities` (actor, kind, trip, payload, created — feed source, batched); `notifications`; `reports`; `push_tokens`. All access checks (membership, visibility, blocks, realm) live in one server module and are reused by pages, API, `/live` and `/media`.

## 16. Testing and quality bar

Same as before: unit + integration (real Postgres) + Playwright e2e + axe, EN + TR, WCAG 2.2 AA. Key integration tests: visibility matrix (private/followers/public × member/follower/friend/stranger/blocked/signed-out × page/API/sync/media), realm isolation, block hiding everywhere, message idempotency on retry, offline message queue, feed batching, rate limits. E2E: two users follow each other → one creates a public trip → the other sees it in the feed, likes, comments, copies it; a chat "Make this a trip" flow; demo world lands lively.

## 18. Settled after the builder check (Claude's calls)
- **Private accounts and public trips:** a private account can't make trips Public; its maximum is Followers (the Public option is disabled with a hint). Turning an account private lowers its Public trips to Followers. No leaks, one rule.
- **"Followers" visibility means the owner's followers.** A member's profile grid shows trips they belong to only when the viewer can see that trip under its own visibility.
- **Lowering visibility hides, never deletes:** likes, comments and feed cards stay stored but every read filters by the trip's current visibility, so people who lost access no longer see them; pending join requests are declined; copies already made stay with their copiers (they are the copier's trips).
- **Group chats contain friends only.** You can create a group with, or add, only people you're friends with, so "Make this a trip" in a group adds everyone directly. In a 1:1 Request chat, Make this a trip is available only after the request is accepted.
- **Infrastructure:** `/live` runs in the same Railway container as `/sync` (one Node process). Photo storage uses a local disk folder in development and tests; R2 needs a free Cloudflare account and bucket, and push needs a free Expo account — both are set up with the owner at deploy time (like Railway/Neon), and the app works without them (photos fall back to local disk only where a disk exists; push is simply off).

## 17. Left to the builder

Visual details within the UI v2 language, exact copy (both languages), feed card layout variants, emoji/icon choices, photo viewer interactions, admin page layout, and test file layout.
