import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { BottomSheet } from "@/components/map/BottomSheet";
import { renderIntl } from "./helpers";

afterEach(cleanup);

describe("BottomSheet", () => {
  it("bottom sheet handle cycles snap points with Enter and announces it", () => {
    renderIntl(
      <BottomSheet>
        <button type="button">Galata Tower</button>
      </BottomSheet>,
    );
    const handle = screen.getByRole("button", { name: "Resize the list" });
    const sheet = handle.closest("[data-snap]")!;
    const status = screen.getByRole("status");
    expect(sheet.getAttribute("data-snap")).toBe("half");

    fireEvent.keyDown(handle, { key: "Enter" });
    expect(sheet.getAttribute("data-snap")).toBe("full");
    expect(status.textContent).toBe("List fully open");

    fireEvent.keyDown(handle, { key: "Enter" });
    expect(sheet.getAttribute("data-snap")).toBe("peek");
    expect(status.textContent).toBe("List minimised");

    fireEvent.keyDown(handle, { key: "Enter" });
    expect(sheet.getAttribute("data-snap")).toBe("half");
    expect(status.textContent).toBe("List half open");

    // Arrow keys step up and down without wrapping.
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(sheet.getAttribute("data-snap")).toBe("peek");
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(sheet.getAttribute("data-snap")).toBe("half");

    // Tabbing into a minimised list opens it, so focus is never hidden under the map.
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    act(() => screen.getByRole("button", { name: "Galata Tower" }).focus());
    expect(sheet.getAttribute("data-snap")).toBe("half");
  });
});
