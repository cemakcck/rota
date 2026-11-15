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
