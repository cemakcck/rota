# Tripify UX round: Design

**Status:** approved by the owner 2026-11-15 ("For the UX improvements, we are going to do those"), from Claude's hands-on review of the running app.
**Extends:** the planner spec (2026-11-14), UI v2 (2026-11-15) and social design (2026-11-15). Everything there still holds.
**Name (owner):** the app is now **Tripify** (was Rota) — "the name of the app is tripify".

Owner's goal: "many ux improvements for easy usability and full access".

## 1. Adding a place
- Search results panel is wider than the input (≈ 360 px min), each result shows category icon, name, short address and distance from the day's last stop (or the destination).
- Hovering/arrow-keying a result shows a temporary preview pin on the map (no map jump unless the result is off-screen).
- The add step's **Time** becomes a picker: the suggested time as the default chip, −30 / +30 minute buttons, a "No set time" option, and a time input that uses the device's native time picker on touch (`<input type="time">`) and a typeable HH:MM field on desktop; invalid input handled as today.
- **Stay** becomes chips: 15 min · 30 min · 1 h · 1 h 30 · 2 h · 3 h · Custom… (custom = minutes field, 0–1440 in 5 steps). Default from the category.
- **Category** is shown in the step (suggested from the search result) and can be changed there.
- After adding: the search clears, the list scrolls to the new stop, highlights it for ~2 s (no animation under reduced motion), and a toast says "Added to Day 1 at 16:00" with **Undo**.

## 2. Reading the day
- Map pins show a short name label next to the number (truncated ~18 chars; labels hide when they would overlap or at low zoom). Selected pin's label always shows.
- Hovering a row highlights its pin and vice versa; selecting either selects both. Clicking empty map closes the details panel.
- **Day title:** each day gets an editable title (`day.title`, ≤ 40 chars) shown in the day header and the rail ("Karaköy & Galata"); placeholder "Add a title". The rail summary uses the title, falling back to "N stops". Seed days get titles.
- **Day note** moves to the top of the day plan under the header, editable in place (collapsed to 2 lines with "more").
- **Shift day:** a day-header action "Shift times" → −60/−30/−15/+15/+30/+60 min: moves every set time in the day in one undoable step (never past 00:00 / 23:59; stops that would cross are clamped and the user is told).

## 3. Days and people
- Rail days: drag to reorder (keyboard: ⋯ menu Move up/Move down); ⋯ menu also Rename (title) and Delete day (places go to Ideas, with Undo).
- New shared-doc op `moveDay(doc, dayId, toIndex, origin)`; dates follow the new order (day N = start date + N−1).
- Header member avatars open the members panel (who's here, roles, invite). A trip with only its owner shows an **Invite friends** button in the header.
- **Undo toasts** for every removing or moving action: delete stop, delete day, move to another day, move to Ideas, dismiss suggestion, accept suggestion, shift day, clear a time. One shared toast component, 6 s, focusable, keyboard Undo (Ctrl/Cmd+Z still works).
- Undo/redo header buttons get visible labels on wide screens ("Undo" / "Redo") and tooltips.

## 4. First-time help
- A 3-step tour the first time a user opens any trip (remembered per user on the device and server-side flag): ① "These are your days" (rail) ② "Add a place — pick a time before it goes in" (search) ③ "Invite friends to plan together" (Share). Skippable, keyboard operable, focus-managed, reduced-motion safe; "Show tips again" in settings.
- Empty states: empty day → "Add your first stop" with category quick-search buttons (Food, Sight, Café, Museum) that open the search prefilled ("cafe near <destination>"); empty Ideas → explains suggestions and votes; empty checklist → "Add things to pack or book".

## 5. Full access
- Every action reachable by keyboard; a **`?` shortcuts sheet** (dialog) listing shortcuts (Alt+↑/↓ reorder, Ctrl/Cmd+Z/Shift+Z, `/` focus search, `[`/`]` previous/next day, Esc close panel).
- "Skip to plan" link; visible focus rings on every interactive element (2 px, ≥ 3:1).
- Touch targets ≥ 44×44 px on phones.
- Screen-reader pass with VoiceOver and NVDA following a written checklist (`docs/a11y-checklist.md`), fixing what it finds; axe scans on the editable trip screen (details open, add step open, tour open) at 1280×800 and 390×844.
- The e2e suite, red since the redesign, is brought back to green for the trip screen.

## 6. Phone trip layout
Moved here from the social plan's Task 4 (owner wants usability now): compact trip header with day chips (Day 1 · Day 2 · … · All), bottom trip tabs Plan · Map · Ideas · Checklist, floating ＋ that focuses the search, the Map tab's pulled-up pin card (number, name, arrive · stay · walk, Google Maps, Details), weather in the day title line, retire `map/BottomSheet.tsx` and the interim List/Map toggle, `inert` on app content under the phone details sheet, resizing keeps view and selection. (The app-level social navigation still comes in the social plan.)

## 7. Brand rename to Tripify
All user-visible names (UI, page titles, manifest name/short_name, emails, README, landing, offline page, demo copy) say **Tripify**; logo wordmark "tripify". Internal package names (`@rota/*`), database names and the GitHub repo name stay for now (renaming the repo is an outward action — ask the owner separately).

## Non-goals
New features beyond the above; the social navigation (social plan); the AI planner (next design).
