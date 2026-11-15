import { afterEach, describe, expect, it, vi } from "vitest";
import { onceRendered } from "@/components/trip/focus";

const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));
afterEach(() => document.body.replaceChildren());

describe("onceRendered", () => {
  it("runs on the next frame when the element is there", async () => {
    const el = Object.assign(document.createElement("button"), { id: "x" });
    document.body.append(el);
    const then = vi.fn();
    onceRendered("x", then);
    expect(then).not.toHaveBeenCalled();
    await frame();
    expect(then).toHaveBeenCalledWith(el);
  });

  it("waits for an element rendered a few frames later (a local edit reaches the screen on a frame)", async () => {
    const then = vi.fn();
    onceRendered("late", then);
    await frame();
    await frame();
    expect(then).not.toHaveBeenCalled();
    const el = Object.assign(document.createElement("button"), { id: "late" });
    document.body.append(el);
    await frame();
    await frame();
    expect(then).toHaveBeenCalledTimes(1);
    expect(then).toHaveBeenCalledWith(el);
  });

  it("gives up after a while", async () => {
    const then = vi.fn();
    onceRendered("never", then, 3);
    for (let i = 0; i < 5; i++) await frame();
    const el = Object.assign(document.createElement("button"), { id: "never" });
    document.body.append(el);
    await frame();
    expect(then).not.toHaveBeenCalled();
  });
});
