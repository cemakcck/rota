import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { ACTION_TOAST_MS, ActionToastProvider, useActionToast, type ActionToastInput } from "@/components/trip/ActionToast";
import { renderIntl } from "./helpers";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Buttons that show the given toasts. */
function Shows({ toasts }: { toasts: ActionToastInput[] }) {
  const toast = useActionToast();
  return (
    <>
      {toasts.map((t, i) => (
        <button key={i} type="button" onClick={() => toast.show(t)}>
          {`show ${i}`}
        </button>
      ))}
      <button type="button" onClick={toast.dismiss}>
        dismiss
      </button>
      <span data-testid="current" data-message={toast.current?.message ?? ""} />
    </>
  );
}

const render = (toasts: ActionToastInput[]) =>
  renderIntl(
    <ActionToastProvider>
      <Shows toasts={toasts} />
    </ActionToastProvider>,
  );

describe("ActionToast", () => {
  it("shows a message with Undo for 6 s, said politely, one at a time", () => {
    vi.useFakeTimers();
    const undoA = vi.fn();
    const undoB = vi.fn();
    render([
      { message: "A deleted.", undoLabel: "Undo deleting A", onUndo: undoA },
      { message: "B moved to Day 2.", undoLabel: "Undo moving B", onUndo: undoB },
    ]);
    expect(ACTION_TOAST_MS).toBe(6000);
    const live = screen.getByRole("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("");

    screen.getByRole("button", { name: "show 0" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "show 0" }));
    expect(live.textContent).toBe("A deleted.");
    // Not focused unless asked: the action's own focus wins.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "show 0" }));

    // A second one replaces the first.
    fireEvent.click(screen.getByRole("button", { name: "show 1" }));
    expect(screen.queryByText("A deleted.")).toBeNull();
    expect(live.textContent).toBe("B moved to Day 2.");
    expect(screen.getAllByRole("button", { name: /^Undo/ })).toHaveLength(1);

    act(() => vi.advanceTimersByTime(5900));
    expect(screen.getByText("B moved to Day 2.")).toBeTruthy();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText("B moved to Day 2.")).toBeNull();
    expect(undoA).not.toHaveBeenCalled();
    expect(undoB).not.toHaveBeenCalled();
  });

  it("Undo runs the callback and closes; Escape closes; the timer pauses while hovered", () => {
    vi.useFakeTimers();
    const onUndo = vi.fn();
    render([{ message: "Added to Day 1 at 16:00", undoLabel: "Undo adding Pera", onUndo }]);

    fireEvent.click(screen.getByRole("button", { name: "show 0" }));
    const toast = screen.getByText("Added to Day 1 at 16:00").closest("[data-action-toast]")!;
    fireEvent.mouseEnter(toast);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText("Added to Day 1 at 16:00")).toBeTruthy();
    fireEvent.mouseLeave(toast);

    const undo = screen.getByRole("button", { name: "Undo adding Pera" });
    expect(undo.textContent).toBe("Undo");
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Added to Day 1 at 16:00")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "show 0" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Undo adding Pera" }), { key: "Escape" });
    expect(screen.queryByText("Added to Day 1 at 16:00")).toBeNull();
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("can take focus (when what it acted on is gone) and can be dismissed by its owner", () => {
    render([{ message: "A deleted.", undoLabel: "Undo deleting A", onUndo: () => undefined, focus: true }]);
    fireEvent.click(screen.getByRole("button", { name: "show 0" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Undo deleting A" }));
    expect(screen.getByTestId("current").dataset.message).toBe("A deleted.");
    fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
    expect(screen.queryByText("A deleted.")).toBeNull();
    expect(screen.getByTestId("current").dataset.message).toBe("");
  });

  it("without an Undo it is just a message", () => {
    render([{ message: "Times shifted." }]);
    fireEvent.click(screen.getByRole("button", { name: "show 0" }));
    expect(screen.getByRole("status").textContent).toBe("Times shifted.");
    expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();
  });

  it("stays while it holds focus, even focus put there by script (focus: true), and resumes once focus leaves", () => {
    vi.useFakeTimers();
    // As after a pointer click in a browser: the scripted focus is not :focus-visible.
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
      return selector === ":focus-visible" ? false : matches.call(this, selector);
    });
    render([{ message: "Day 2 deleted.", undoLabel: "Undo deleting Day 2", onUndo: () => undefined, focus: true }]);
    fireEvent.click(screen.getByRole("button", { name: "show 0" }));
    const undo = screen.getByRole("button", { name: "Undo deleting Day 2" });
    expect(document.activeElement).toBe(undo);
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.getByText("Day 2 deleted.")).toBeTruthy();
    // Focus moves out: the 6 s start again.
    act(() => screen.getByRole("button", { name: "dismiss" }).focus());
    act(() => vi.advanceTimersByTime(5900));
    expect(screen.getByText("Day 2 deleted.")).toBeTruthy();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText("Day 2 deleted.")).toBeNull();
  });

  it("closing while it holds focus sends focus where the toast says, else to the screen's fallback, never to the page", () => {
    renderIntl(
      <ActionToastProvider fallbackFocus={() => document.getElementById("fallback")}>
        <Shows
          toasts={[
            { message: "A deleted.", undoLabel: "Undo deleting A", onUndo: () => undefined, focus: true, returnFocus: () => document.getElementById("near") },
            { message: "B deleted.", undoLabel: "Undo deleting B", onUndo: () => undefined, focus: true },
          ]}
        />
        <button id="near" type="button">
          near
        </button>
        <input id="fallback" aria-label="search" />
      </ActionToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "show 0" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Undo deleting A" }), { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "near" }));

    fireEvent.click(screen.getByRole("button", { name: "show 1" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Undo deleting B" }));
    fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
    // (The click focused "dismiss" in a browser; here focus was still in the toast.)
    expect(document.activeElement).not.toBe(document.body);

    fireEvent.click(screen.getByRole("button", { name: "show 1" }));
    act(() => screen.getByRole("button", { name: "Undo deleting B" }).focus());
    fireEvent.keyDown(screen.getByRole("button", { name: "Undo deleting B" }), { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "search" }));
  });
});
