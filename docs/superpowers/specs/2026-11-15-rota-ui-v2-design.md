# Rota UI v2: Design — one day at a time, details on demand

**Status:** approved by the owner 2026-11-15 ("its ok" on the mockup).
**Extends:** `docs/superpowers/specs/2026-11-14-rota-design.md`. Every feature, rule and limit there still holds; this changes how the trip screen is laid out and navigated, not what it does.
**Visual reference (binding for layout, hierarchy and feel):** `docs/design-reference/rota-trip-v2.html` (desktop 1280 px, phone Plan tab, phone Map tab). The older `rota-trip.html` is superseded.

## 1. Why
The owner tried the built app and found it "too plain and hard to navigate and use". Observed problems (Claude's review of the running demo):
- The left panel opens with a form (name, day select, Add, Suggest, hint, 7 category buttons, tag select) before any plan is visible.
- Each place card carries ~10 controls (drag, stay input, edit note, Google Maps, edit, up, down, move, delete, tags); 2–3 places fit on screen.
- Day choice lives on the map while the list scrolls through all days, so they can disagree.
- The street map is busy; thin pins and route get lost.
- Demo banner and weather take a full strip.

## 2. The new structure (owner-approved via mockup)
**Desktop (≥ 1024 px): three columns** — rail (≈ 208 px) · day plan (≈ 400 px) · map (rest).
- **Header:** logo, trip name (Fraunces serif, editable), "dates · N days · N places", a compact weather strip (one chip per trip day within forecast range), sync pill, member avatars (presence), **Share** (opens the invite panel), settings (opens trip settings/members as today).
- **Rail:** one entry per day — colour swatch, "Day N · Fri 27", and a one-line summary (Claude's call: the day note's first line, shortened, plus "· N stops"; just "N stops" when there's no note); selected day highlighted. "+ Add a day". Divider. **Ideas & votes** (count = ideas + suggestions), **Checklist** (done/total), **Whole trip on map**. The demo controls (Try it with a friend, Side by side when wide, Simulate offline) move into a small "Demo trip" box at the bottom of the rail; friend windows show "You're Deniz in this window" there.
- **Day plan column:** day header (big serif "Day 1 · Friday", day colour dot) with chips: start time (editable), walk/drive toggle + total travel, estimated end time, "Open day in Google Maps ↗" (split parts as today). Then **one search bar** "Add a place to Day N…" with a small **Filter** button (category + tag filters in a popover). Then the stops as **one-line rows** with **travel connectors** between them.
- **Stop row:** number in the day colour · category emoji/icon · name · one muted sub-line (category label · tags or "1 note") · right-aligned arrival time and stay length · opening-hours warning as a small amber line under the sub-line when present. Presence: a peer editing it outlines the row in their colour with a name tag. Nothing else on the row. Click/Enter opens details; drag to reorder; keyboard reorder with Alt+↑/↓ on a focused row (announced). Dropping a row on a rail day moves it to that day; dropping on "Ideas" unschedules it.
- **Details panel:** clicking a stop (row or pin) opens a card that slides over the left edge of the map (≈ 340 px): category chip with number and day, name (editable), "Added by X", tiles for Arrive / Stay (select) / From previous stop / Opening hours (+ warning), tags (add/remove), collaborative note, **Open in Google Maps ↗**, **Move to…**, **Delete** (with the existing Undo toast). Close with ✕ or Escape; focus returns to the row.
- **Ideas & votes view** (replaces the list column when selected): Ideas (unscheduled places) as rows with "Add to day…"; Suggestions with vote buttons, Accept/Dismiss; Dismissed disclosure. Same search bar, adding to Ideas or as Suggestion.
- **Checklist view:** the existing checklist, in the list column.
- **Whole trip on map:** list column shows all days collapsed (day headers with their rows), map shows every day's pins and routes.
- **Map:** muted basemap (OpenFreeMap **positron** style, `https://tiles.openfreemap.org/styles/positron`), larger teardrop pins (≈ 34 px) in the day colour with the stop number, selected pin larger with a halo, route ≈ 6 px in the day colour; Ideas pins small grey. Hovering a pin shows a small name card. The map always follows the selected view (day → that day's pins/route fitted; Ideas → idea pins; all → everything). Live cursors, right-click/long-press "Add a place here" stay.
- **Search results** (combobox) each offer **Add to Day N** (default, Enter), **Ideas**, **Suggest**. The current separate form, day select, Suggest button and category button row go away.

**Phone (< 1024 px):**
- Compact header: trip name, avatars (or sync pill on the Map tab), and **day chips** (Day 1 · Day 2 · Day 3 · All) under it.
- **Bottom tab bar:** Plan · Map · Ideas · Checklist. Settings/share/demo controls in a header "⋯" menu.
- **Plan tab:** day title + weather + stop count, search bar, the same one-line rows and connectors, a floating "＋ Add place" button that focuses the search.
- **Map tab:** full-screen map for the selected day; tapping a pin pulls up a small card (number, name, arrive · stay · walk) with Google Maps and Details; Details opens the details panel as a full-height sheet.
- The current draggable BottomSheet is retired.

## 2b. Times you set yourself (owner, 2026-11-15)
Owner feedback after trying it: "I have to be able to change the times of the events… before it gets added to the day, I should decide the hour myself. And 9 AM cannot be the default start, because maybe my day will start at 7 AM."
- **Every stop can have a time you set** (`time: "HH:MM"`, the time you arrive / it starts) besides its stay length. It is shown bold on the row and editable on the row (click the time) and in the details panel.
- **Adding a place asks for the time first:** after picking a search result (or typing a name), a small step shows a time field before it's added — prefilled with a suggestion (the previous stop's end + travel; empty if the day has no timed stop yet) — plus the stay length (category default). "Add" puts it in the day at that time. Leaving the time empty adds it untimed (Claude's call: allowed, so quick adding still works).
- **No default 9:00 day start.** The day's separate "start time" setting is removed; a day starts at its first stop's time. Untimed stops after a timed one show an **estimate** ("≈ 11:20", muted) = previous stop's arrival + stay + travel; untimed stops before any timed stop show no time ("Set a time").
- **Order follows time** (Claude's call, calendar-like): setting or changing a time moves the stop to its chronological place among timed stops; untimed stops keep their position relative to their neighbours. Dragging a stop to a new position re-times it to the suggested time for that slot if it had a time, and leaves it untimed if it didn't.
- **Conflicts are flagged, never blocked:** if a set time is earlier than you can get there (previous stop's end + travel), the row and details show "You'd arrive ≈ 20 min late (from Galata Tower)". Opening-hours warnings use set or estimated times.
- Data: `place.time` added to the shared document (null = untimed); `day.startTime` is no longer read (existing values migrate: on first load a day's startTime becomes its first stop's time if that stop has none — Claude's call; then the field is ignored). The demo seed sets real times on its stops (e.g. 08:30 breakfast, 10:15 museum, 13:00 lunch) so the demo shows set and estimated times side by side.

## 3. Visual language (Claude's calls, from the mockup)
- Warm neutral background (#f5f3ef), white cards with 1 px #e7e5e4 borders and 12 px radius, ink #1c1917, muted #57534e.
- **Fraunces** (serif) for trip and day titles; Inter for everything else (next/font).
- Day colours stay as today (navy, crimson, forest, …); member colours unchanged.
- Category shown as an emoji-style glyph in rows (🍴 food, 🍸 drinks, ☕ café, 🏛 museum, 📷 sight, 🌙 nightlife, 🛍 shopping, 🌳 nature, 🏋 gym, 🛏 stay, 📍 other) with an accessible text label.
- Calm motion (panel slide 150 ms), none under reduced motion. Light theme only.

## 4. Unchanged / constraints
- All features, data model, sync, offline, per-user storage, demo, invites, limits, i18n (EN + TR, identical keys; remove keys that are no longer used), WCAG 2.2 AA (every drag has a keyboard alternative; the list is the accessible source of truth for the map), and the test suites (update unit/e2e/a11y tests to the new UI; keep their coverage of behaviour).
- Selected view is reflected in the URL (`?view=day&day=<id>` / `ideas` / `checklist` / `all`) so reloads and shared links land in the same place; default = the first day (or today's day if the trip is in progress).
- No new paid services. Ports: dev 3400, e2e 3401; never 3000/3100.

## 5. Non-goals
Dark theme; place photos; new features; the mobile (Expo) app (it will follow this layout later); landing/My trips redesign beyond matching header typography and colours (Claude's call: give My trips and the landing the same fonts/colours so the app feels like one product, no structural change).
