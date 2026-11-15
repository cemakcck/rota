/**
 * Runs `then` with the element of this id on the next frame it is rendered in, waiting up to `frames`
 * frames. A local edit reaches the screen a frame later (useTrip reads the trip once per frame), so a row
 * just added, or restored by Undo, is not there yet on the frame after its action.
 */
export function onceRendered(id: string, then: (el: HTMLElement) => void, frames = 10): void {
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (el) then(el);
    else if (frames > 1) onceRendered(id, then, frames - 1);
  });
}

/** Whether focus can land on `el` and be seen there: in the page, not inert, not hidden (display:none, a hidden tab). */
function canTakeFocus(el: HTMLElement): boolean {
  return el.isConnected && !el.closest("[inert]") && (el.checkVisibility?.() ?? true);
}

/** Focuses the first of `candidates` that can take focus, and returns it (null when none could). */
export function focusFirst(candidates: (HTMLElement | null | undefined)[]): HTMLElement | null {
  for (const el of candidates) {
    if (!el || !canTakeFocus(el)) continue;
    el.focus();
    if (document.activeElement === el) return el;
  }
  return null;
}
