# Tripify UX Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the trip screen easy to use and fully accessible, and rename the app to Tripify.

**Architecture:** UI work on the existing UI v2 components, plus two shared-doc additions in `packages/trip` (`day.title`, `moveDay`, `shiftDayTimes`). One shared toast-with-Undo component used by every removing/moving action.

**Spec:** `docs/superpowers/specs/2026-11-15-tripify-ux-round-design.md` (extends the planner, UI v2 and social specs). Visual language: UI v2 mockup `docs/design-reference/rota-trip-v2.html`.

## Global Constraints
- No behaviour regressions; per-stop time rules (UI v2 §2b and rulings F1/F2) unchanged.
- packages/trip: every mutation one `doc.transact` with origin = user id; fractional ordering; readTrip never throws; TZ-independent HH:MM.
- EN + TR identical keys; WCAG 2.2 AA; reduced motion; light theme.
- Ports: dev 3400 is the owner's preview (separate worktree ~/Personal/rota-preview — do not touch it); use 3410 for checks and stop by PID; never 3000/3100. Never push. Commit trailers as before.
- Every task: `npm run lint && npm run typecheck && npm test` green; Task 6 also `npm run test:e2e`.

## Review Focus
1. Shift day crossing midnight / 00:00 → clamped and announced, one undo step.
2. Reordering days while another member edits a stop on one of them → converges, no lost places.
3. Tour on a trip opened offline / in a friend window / read-only → doesn't block or crash; skippable by keyboard.
4. Undo toast after a remote change touched the same place → undo only reverts the user's own action.
5. Phone ↔ desktop resize with a panel, the add step or the tour open → state kept.

---

### Task 1: Add-place flow
**Files:** `components/trip/{SearchBar,PlaceSearch,TimeStayFields}.tsx`, new `TimePicker.tsx`, `StayChips.tsx`, `UndoToast` → generalised `ActionToast.tsx` (+ provider), map preview pin in `map/TripMap.tsx`/`engine.ts`.
**Tests (first):** results show icon, name, address, distance; arrow/hover shows a preview pin and leaving removes it; time picker: suggested default, ±30, "No set time", native time input on touch, invalid handled; stay chips + custom; category changeable in the step; after add: search cleared, new row focused/highlighted, toast "Added to Day N at HH:MM" with Undo that removes it.
**Commit:** `feat(ux): clearer add-place flow with time picker and undo`.

### Task 2: Reading the day
**Files:** packages/trip (`day.title` in schema/doc/view/seed; `shiftDayTimes(doc, dayId, minutes, origin) → { clamped: string[] }`), map labels + hover/selection sync, `DayPlan` header (title, note at top, Shift times menu), Rail summary.
**Tests (first):** day title set/read/seeded, rail uses it; note at top editable; shiftDayTimes moves all set times, untimed untouched, clamps at 00:00/23:59 and reports, one undo step; Shift times menu announces result; row hover highlights pin (event/prop level), pin hover highlights row; empty-map click closes details; pin labels present with truncation.
**Commit:** `feat(ux): day titles, notes on top, shift times, linked pins`.

### Task 3: Days and people
**Files:** packages/trip `moveDay(doc, dayId, toIndex, origin)`; `Rail.tsx` (drag days, ⋯ menu Move up/down/Rename/Delete), `TripHeader.tsx` (avatars → members panel, Invite friends CTA, labelled undo/redo), `ActionToast` wired to delete stop/day, move day/Ideas, dismiss/accept suggestion, shift day, clear time.
**Tests (first):** moveDay reorders and dates follow, concurrent moveDay + place edit converge; rail drag + keyboard menu; delete day → places to Ideas + Undo; avatars open members; owner-only trip shows Invite friends; each listed action shows a toast and Undo reverts only the user's own change after a remote edit.
**Commit:** `feat(ux): manage days in the rail, people in the header, undo everywhere`.

### Task 4: First-time help and empty states
**Files:** `components/trip/Tour.tsx` (3 steps, focus-managed, Esc/Skip), per-user seen flag (`user.tips_seen_at` column + device fallback), settings "Show tips again", empty states in DayPlan/IdeasView/Checklist with category quick-search.
**Tests (first):** tour shows once, Skip/Esc/keyboard, remembered across reload, not shown read-only/friend window until they edit, reduced motion; empty day quick-search opens prefilled search; empty Ideas/checklist copy.
**Commit:** `feat(ux): first-time tour and helpful empty states`.

### Task 5: Phone trip layout
**Files:** per spec §6 — `PhoneTripShell.tsx`, `PinCard.tsx`, remove `map/BottomSheet.tsx` and the List/Map toggle, `inert` under the phone details sheet.
**Tests (first):** chips + tabs keep the selected day; FAB focuses search; pin card with Google Maps + Details; weather shown on phone; resize keeps view, selection, open panel/add step/tour; inert applied while the phone sheet is open.
**Commit:** `feat(ux): phone trip layout with tabs and pin card`.

### Task 6: Full access and e2e back to green
**Files:** `ShortcutsDialog.tsx` (`?`), shortcuts (`/`, `[`, `]`, Esc), skip link, focus-ring pass, touch-target pass, `docs/a11y-checklist.md` (VoiceOver + NVDA steps and results; fix what fails), update every e2e spec for the UI v2 trip screen + this round (add flow with time, inline time edit, details panel, drag within/onto rail, deep links, shift times, tour skip), axe on editable trip screen states at 1280×800 and 390×844.
**Tests (first):** shortcuts dialog and each shortcut; skip link; e2e as listed.
**Checks:** `npm run lint && npm run typecheck && npm test && npm run test:e2e`.
**Commit:** `feat(ux): full keyboard access and a green end-to-end suite`.

### Task 7: Rename to Tripify
**Files:** messages (EN/TR), page titles/metadata, manifest, logo wordmark, emails, landing, offline.html, demo copy, README (title, intro, screenshots captions), docs references in user-facing text. Not: package names, DB names, repo name.
**Tests (first):** a test that no user-visible message contains "Rota" (scan messages + key static files), manifest name "Tripify".
**Commit:** `chore(brand): the app is now Tripify`.
