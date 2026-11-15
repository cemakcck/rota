# Trip screen accessibility checklist

A walk through the trip screen's flows with a keyboard and a screen reader: what to do, what should
happen, and the results. It covers spec §5 of the UX round (`docs/superpowers/specs/2026-11-15-tripify-ux-round-design.md`).
The target is WCAG 2.2 AA, plus 44 × 44 px touch targets on phones (below 1024 px).

- **Keyboard** and **Tree** results were recorded on 2026-11-15, on Linux, with Chromium (Playwright) against
  the dev server on port 3410 and a demo trip.
  - **Keyboard** means keys only: Tab, Shift+Tab, Enter, Space, the arrow keys, Escape and the shortcuts.
  - **Tree** means the roles, names and states checked in the accessibility tree: by the unit tests (Testing
    Library queries by role and name) and by an axe-core run of each state in the browser.
- **VoiceOver** (macOS and iOS) and **NVDA** need macOS, iOS or Windows. Those columns are **to run by owner**.

## Before you start

1. Open a trip you can edit, or press "Try the demo" on the home page. Sign in again, or clear the tips
   (Trip settings → "Show tips again"), when the first-time tour should show.
2. Screen readers:
   - **VoiceOver, macOS:** Safari, Cmd+F5 to start. VO means Ctrl+Option.
     - Turn Quick Nav off (Left+Right arrows together), or the single-key shortcuts below will not reach the page.
   - **VoiceOver, iOS:** Safari. Settings → Accessibility → VoiceOver.
     - Swipe right or left moves to the next or previous item. Double-tap activates. The rotor (two-finger turn) picks Headings, Form controls or Landmarks.
   - **NVDA, Windows:** Firefox or Chrome. NVDA+Space switches between browse mode and focus mode. NVDA is Insert, or Caps Lock in the laptop layout.
     - In browse mode NVDA takes ?, /, [ and ] for itself: press NVDA+Space (focus mode) or NVDA+F2 (pass the next key) first.
3. The single-key shortcuts (?, /, [ and ]) can be turned off in the shortcuts sheet: press ?, or
   "Keyboard shortcuts" in the skip links. The setting is remembered on the device. Turn them off if
   they get in the way of the screen reader or of voice control (WCAG 2.1.4).

## Shortcuts

| Keys | Does |
| --- | --- |
| ? | Opens the shortcuts sheet. |
| / | Focuses the search (on a phone's Map tab, the Plan tab comes first). |
| [ / ] | Shows the previous or next day, the same as the rail and the chips (`?view=day&day=<id>`). From Ideas, the checklist or the whole trip, ] goes to the first day and [ to the last. A status message says which day is shown. |
| Alt+↑ / Alt+↓ | On a stop's name: moves the stop up or down. |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z | Undoes or redoes your last trip edit. Inside a field, the field's own undo works instead. |
| Esc | Closes the details panel. Open popovers, menus, dialogs and fields handle Escape first. |

None of them fire while you type in an input, textarea or contenteditable, or while a dialog is open
(the phone's details sheet counts as a dialog). Ctrl or Cmd chords are left to the browser.

## Results

✅ means it passed. "Owner" means it is to run by owner.

| # | Flow | Keyboard | Tree | VoiceOver macOS | VoiceOver iOS | NVDA |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Skip link and landmarks | ✅ | ✅ | Owner | Owner | Owner |
| 2 | Shortcuts sheet | ✅ | ✅ | Owner | Owner | Owner |
| 3 | Add a place with a time | ✅ | ✅ | Owner | Owner | Owner |
| 4 | Edit a time inline | ✅ | ✅ | Owner | Owner | Owner |
| 5 | Reorder | ✅ | ✅ | Owner | Owner | Owner |
| 6 | Move to a day | ✅ | ✅ | Owner | Owner | Owner |
| 7 | Details panel | ✅ | ✅ | Owner | Owner | Owner |
| 8 | Shift times | ✅ | ✅ | Owner | Owner | Owner |
| 9 | Day menu | ✅ | ✅ | Owner | Owner | Owner |
| 10 | Days with [ and ] | ✅ | ✅ | Owner | Owner | Owner |
| 11 | First-time tour | ✅ | ✅ | Owner | Owner | Owner |
| 12 | Toasts and Undo | ✅ (after fixes 1 and 2) | ✅ | Owner | Owner | Owner |
| 13 | Phone tabs and pin card | ✅ (390 × 844) | ✅ | Owner | Owner | Owner |

When you run a column, replace "Owner" with ✅ or ❌, and add a line under the flow saying what you heard and anything that went wrong.

### 1. Skip link and landmarks

1. Load the trip and press Tab once.
   - Expected: "Skip to plan, link" appears at the top left and is announced.
2. Press Enter.
   - Expected: focus goes to the plan ("Plan, main"). The next Tab reaches the day's title field.
3. Go back to the top. Tab twice reaches "Keyboard shortcuts, button", and Enter opens the sheet.
4. List the landmarks. Use VO+U then Landmarks (macOS), the rotor's Landmarks (iOS), or D or the
   elements list, NVDA+F7 (NVDA).
   - Expected: banner (header); navigation "Trip" (rail) or "Days" (phone chips); main "Plan"; region "Map";
     and on phones, navigation "Trip views" (tabs).
   - The map canvas is a separate region, "Interactive map: arrow keys move it, + and − zoom".
5. On a phone, on the Map tab, activate "Skip to plan".
   - Expected: the Plan tab shows and the plan has focus.

**Recorded:**
- Keyboard: the skip link is the first Tab stop, it is 44 px tall and visible when focused, and Enter focuses `#main`.
- Tree: axe found no duplicate landmark labels, once the map canvas got its own label (fix 4).

### 2. Shortcuts sheet

1. Focus anything outside a field and press ?.
   - Expected: the dialog "Keyboard shortcuts" opens, with its description.
2. Read it.
   - Expected: each row reads as an action, then its keys in words. For example: "Redo, Control plus Shift plus Z" and "Move the stop up or down (on its name), Alt plus up arrow or down arrow". The key caps are hidden from screen readers.
3. Tab to "Single-key shortcuts, switch, on" and press Space.
   - Expected: it now reads "off". ?, / and [ no longer do anything.
4. Press Escape.
   - Expected: the dialog closes and focus goes back where it was.

**Recorded:** keyboard ✅. Focus returns to the element that was focused before. Tree ✅. Unit tests cover the switch, its storage and the keys going quiet.

### 3. Add a place with a time

1. Press / (or Tab to "Add a place to Day 1…").
   - Expected: "Add a place to Day 1…, combo box".
2. Type "Pera". Results are announced as a count, and ↓ moves through the options.
3. Press Enter on a result.
   - Expected: the step opens with focus on the Time field. It has a suggested time, −30 and +30 buttons, the "Suggested" and "No set time" chips, and the stay chips.
4. Type 16:30 and press Enter.
   - Expected: a status says "Added to Day 1 at 16:30", and focus moves to the new stop's name.

**Screen readers:**
- **NVDA:** the search, the Time field and the stay field are form fields: NVDA switches to focus mode by itself when you Tab into them. If you arrow into them in browse mode, press Enter (or NVDA+Space) first, so ↓ moves through the results and Enter adds. Press / only in focus mode (or NVDA+F2, then /).
- **VoiceOver, macOS:** with Quick Nav off, typing and ↓ reach the combo box. VO+Space on a result chooses it.
- **VoiceOver, iOS:** double-tap the search to open the keyboard and type. Swipe right to the results ("… , 1 of 8"), double-tap one. The step's Time field takes focus: double-tap it to type (on iOS it is a time picker; turn the wheels by swiping up or down), then swipe right to "Add to Day 1" and double-tap.

**Recorded:**
- Keyboard ✅ at 1280 × 800 and at 390 × 844.
- Fix 1 was needed: focus did not move to the new stop in the real app.
- Tree: the step has no axe violations.

### 4. Edit a time inline

1. Tab to a stop's time. It is read as "Change the time for Galata Tower, now 10:15", or "Set a time for …, estimated 14:22".
2. Press Enter.
   - Expected: a text field "Time for Galata Tower" opens.
3. Type 08:15 and press Enter.
   - Expected: the time is saved and focus is back on the time button.
4. Try again with "25:99" and press Enter.
   - Expected: an alert says the time is not valid, and the field stays open.
5. Press Escape.
   - Expected: the edit is cancelled.

**Screen readers:**
- **NVDA:** the time is a button: in browse mode press Enter on it. The field that opens takes focus and NVDA switches to focus mode; if it says "edit" but typing does nothing, press NVDA+Space. Enter saves and focus returns to the button (NVDA goes back to browse mode by itself).
- **VoiceOver, macOS:** VO+Space on the time opens the field; type, then Return.
- **VoiceOver, iOS:** the time sits at the right end of the row. Swipe right from the stop's name until VoiceOver says "Change the time for …, button", then double-tap. The keyboard opens on "Time for …": type the time and tap Return (or double-tap Done). On phones the button is 44 px tall: a tap on the stay below the time opens it too.

**Recorded:** keyboard ✅. Tree ✅ (unit tests).

### 5. Reorder

1. Focus a stop's name. It announces its Alt+↑/↓ shortcut (`aria-keyshortcuts`).
2. Press Alt+↓.
   - Expected: "Karaköy Güllüoğlu now at 12:25, position 2 of 5" is announced, and focus stays on the stop.
3. Press Ctrl+Z (Cmd+Z on a Mac).
   - Expected: the move is undone.
4. Without a keyboard: open the details and use "Move … up" / "Move … down" (WCAG 2.5.7).

**Recorded:** keyboard ✅. The status text matches. Tree ✅.

### 6. Move to a day

1. Open a stop's details (Enter on its name) and Tab to "Move … to…".
2. Press Enter.
   - Expected: the dialog "Move Galata Tower" opens, with a radio group of days and Ideas. The current list is marked "(now)".
3. Press ↓ to choose Day 2, then Enter.
   - Expected: "… moved to Day 2 at 08:15, position 1 of 5" is announced. The view follows the place, and focus goes back to the Move button.

**Recorded:** keyboard ✅. Tree ✅.

### 7. Details panel

1. On a stop's name, press Enter.
   - Expected: "Details for Galata Tower" is announced and takes focus. On wide screens it is a region; on phones it is a modal dialog whose Tab order wraps.
2. Tab through it.
   - Expected, in order: category chip ("1 · Day 1 · Food, change category"), Name, Close, Arrive, Stay, tags, note, "Open in Google Maps", Move up, Move down, Move to…, Delete.
3. Press Escape.
   - Expected: the panel closes and focus is back on the stop's name.
4. Open it again, Shift+Tab back into the list, and press Escape.
   - Expected: the panel closes and focus stays where it is.

**Screen readers:**
- **NVDA:** the panel is a region on wide screens: browse mode reads it, and D (landmarks) or NVDA+F7 reaches "Details for …". Its fields (Name, Arrive, Stay, tags) need focus mode: NVDA switches when you Tab into them. In focus mode NVDA may take the first Escape to go back to browse mode; if the panel stays open, press Escape again (or NVDA+F2, then Escape).
- **VoiceOver, macOS:** VO+Shift+↓ interacts with the panel; Escape closes it.
- **VoiceOver, iOS:** on phones the panel is a full-screen dialog: swipe right through it; VoiceOver stays inside. Close it with "Close" (top right) or the two-finger scrub (Z shape), which acts as Escape. Focus returns to the stop.

**Recorded:**
- Keyboard ✅, both at 1280 and 390.
- Tree ✅. The category chip's name now starts with what it shows (fix 5).

### 8. Shift times

1. Tab to "Shift times" on the day and press Enter.
   - Expected: the "Shift the times of Day 1" group opens.
2. Tab to "−60 min, earlier" and press Enter.
   - Expected: the toast "Shifted 4 stops by −60 min." is announced, with Undo.
3. On a day without set times, the button reads as unavailable and explains why ("dimmed", with its description).

**Recorded:** keyboard ✅. Tree ✅.

### 9. Day menu

1. Tab to "Day 1 options" (⋯) and press Enter.
   - Expected: a group with Move up, Move down, Rename and Delete day.
2. Choose Move down.
   - Expected: "Karaköy & Galata is now Day 2, Sat, Nov 28" is announced with Undo, and focus stays in the menu.
3. Press Escape.
   - Expected: the menu closes and focus is on ⋯.
4. Delete a day.
   - Expected: focus moves to the toast's Undo. Undo brings the day back and focuses it on the rail.

**Recorded:** keyboard ✅ (open, Tab in, Escape back to ⋯). Tree ✅.

### 10. Days with [ and ]

1. Focus the plan and press ].
   - Expected: Day 2 shows, the address changes to `?view=day&day=…`, and "Day 2 · Sat, Nov 28" is announced.
2. Press [ to go back.
   - Expected: at the first day, [ does nothing.
3. Press ] while focus is on a stop of the day.
   - Expected: focus goes to the plan, not to the page.

**Recorded:** keyboard ✅, at 1280 and on the phone chips at 390. Tree ✅.

### 11. First-time tour

1. Open a trip with the tips reset.
   - Expected: the dialog "These are your days, Step 1 of 3" opens. Its target is outlined.
2. Tab to Next and press Enter. Step 2 is announced.
3. Press Escape (or "Skip tour").
   - Expected: the tour ends, does not come back, and focus returns.

**Recorded:** keyboard ✅. Tree: axe found no violations with the tour open, at 1280 × 800 and at 390 × 844.

### 12. Toasts and Undo

1. Add, move or shift something.
   - Expected: the toast's message is announced politely. Its Undo is named for the action, for example "Undo adding Pera Museum".
2. Delete a stop from its details.
   - Expected: focus moves to "Undo deleting …". Enter restores the stop and focuses it.
3. On a phone, delete from the details sheet.
   - Expected: the sheet closes, and focus lands on Undo, not on the plan.
4. Hovering or focusing the toast keeps it open. Escape closes it.

**Recorded:**
- Keyboard ✅ after fixes 1 and 2.
- The Undo button's focus ring is white on the dark toast (fix 3).
- Tree ✅.

### 13. Phone tabs and pin card (390 × 844)

1. The bottom navigation "Trip views" has Plan, Map, Ideas and Checklist. The current one has `aria-current`.
2. Select a stop: open its details, then press Escape. Then activate Map.
   - Expected: the pin card region, named after the place, shows its arrival, stay and travel, with "Open in Google Maps", Details and Close.
3. Activate Details.
   - Expected: the details sheet opens as a modal dialog. Escape returns focus to Details.
4. Press / on the Map tab.
   - Expected: the Plan tab shows, with the search focused.

**Recorded:** keyboard ✅. Tree ✅. On phones, every control measured was at least 44 × 44 px in each state (see "Touch targets").

## Focus rings

Every interactive element has a 2 px ring at least 3:1 against what is around it:

- By default, the ring is 2 px of ink (#1c1917), 2 px outside the element. That is 17:1 on paper and on white. The rule is in CSS `@layer base`, so Tailwind utilities can change it or turn it off.
- On the dark toast the Undo ring is white: computed `outline: solid 2px rgb(255, 255, 255)`, on the toast's `rgb(28, 25, 23)`, 17.5:1.
- The search input and the note editor do not draw a ring themselves (`outline-none`); their box draws one 2 px ink ring. Computed: input `outline-style: none`, box `solid 2px rgb(28, 25, 23)`. Exactly one ring each.

**Checked (2026-11-15, after review fix round 1):**
- Tab went through the trip screen at 1280 × 800 (plain, details, Checklist) and at 390 × 844 (plain, details, Ideas, Checklist, the Map tab). At each stop the check read the computed outline of the element and up to three ancestors: its width, its contrast against the background around it, whether an overflowing parent cut it off, and whether more than one ring showed. 0 problems.
- The same walk on the home page, sign-in, sign-up, My trips (EN and TR) and profile, at 1280 and 390: 0 problems.
- The toast Undo was checked separately (focus moves to it after a delete), with the values above.

An earlier version of this checklist said the toast ring was white when it was not: the global rule was unlayered CSS and beat the Tailwind utility, so the ring stayed ink on the ink toast (about 1:1). The same cascade gave the search input and the note editor two rings. Moving the rule into `@layer base` fixed both.

Fixed along the way (fix 3):
- **Global ring in `@layer base`** (see above): the toast's white ring and the boxes' own rings now apply.
- **Search box:** its 1 px border change did not count as a ring. The box now draws the ring, and the input none.
- **Note editor:** it had only a 1 px shadow; the box now draws a 2 px ring, and the editable text none.
- **Map:** the canvas's ring was cut off by its box, and maplibre's zoom buttons had no outline, only a blurred blue shadow. Both now have inset 2 px ink rings, and so do the map credits.
- **Phone day chips:** a chip half off the strip kept its ring cut off. A chip that gets focus now scrolls fully into the strip.
- **Plan's bottom edge:** the last controls in the plan were cut off. The plan now has scroll padding, and on phones it keeps focused items clear of the floating ＋ (WCAG 2.4.11).

## Touch targets (phones)

**Checked:** at 390 × 844 with touch, every visible, operable control was measured in 18 states:
- plain, details, the Map tab with the pin card, Ideas, Checklist
- day menu, Filter, Shift times, Move to…, People, Settings, the shortcuts sheet
- search results, toast, inline time, note, the add step, the Ideas add step

After the fixes, nothing was smaller than 44 × 44 px. This includes what Task 5's review left: the day header controls (Walk/Drive, Shift times, Google Maps, the title), the stop rows' name and time, and the search input with its Filter button.

A bounding box is not a tap area, though. The stop row's name and time buttons get their 44 px from negative margins, so they overlap the line below them, and that line was painted on top: taps on the bottom 12 px went to the text and opened the details. The buttons now sit above it (`relative z-[1]` on phones). Checked with `document.elementFromPoint` 1 px inside the top and bottom edges, at the left (7 px in, past the rounded corner), middle and right:
- Before: name bottom-left hit the sub-line (`span[place-sub]`); time bottom middle and right hit the stay text.
- After: every probe hits the button itself.
- A tap on the stay text now opens the time field (checked with a touch tap), not the details.

The map's pins are not counted: the list offers the same actions.

## Fixes from these checks

1. **Focus did not move to the stop just added.** Focus on the new row, and on a row restored by Undo, was set before the row existed: the real app renders a local edit a frame later, which the unit tests' synchronous fake hid. It now waits for the row (`trip/focus.ts`, `onceRendered`).
2. **On a phone, deleting from the details sheet sent focus to the plan, not to Undo.** The toast arrived while the sheet still held it. It now takes focus once the sheet has gone, if focus was left with nowhere to be.
3. **Focus rings:** see "Focus rings" above.
4. **Two landmarks were both called "Map":** the map section and maplibre's canvas region. The canvas now has its own name.
5. **Label in name (WCAG 2.5.3):** the rail's "Ideas & votes" and "Checklist" were named "…, 2" and "…, 3 of 5 done" while showing "2" and "3/5". The details' category chip was named "Change category, now Food" while showing "1 · Day 1 · Food". Each name now starts with what is shown.
6. **The stops' list had children that are not list items** (the travel lines, `role="none"`). The travel line is now hidden from screen readers. The next stop reads the travel first, so the list still counts only its stops.
7. **Single-key shortcuts can be turned off** (WCAG 2.1.4).

## Not covered here

- Real VoiceOver and NVDA output: the owner runs the columns above.
- Automated axe scans and Playwright size checks in the e2e suite come in Task 6b.
