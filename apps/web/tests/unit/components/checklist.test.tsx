import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { addChecklistItem, SOFT_MAX_CHECKLIST, updateChecklistItem } from "@rota/trip";
import { renderIntl } from "./helpers";
import { fake, newTrip, refresh, remoteEdit, useFakeTrip } from "./tripHarness";

vi.mock("@/client/sync/useTrip", async (original) => ({ ...(await original<object>()), useTrip: () => useFakeTrip() }));
vi.mock("@/client/authClient", () => ({
  useUserId: () => fake.userId,
  useUserState: () => ({ userId: fake.userId, signedOut: false }),
  apiFetch: (...a: Parameters<typeof fetch>) => fetch(...a),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { TripScreen } from "@/components/trip/TripScreen";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const checklistEntry = () => within(screen.getByRole("navigation", { name: "Trip" })).getByRole("button", { name: /^Checklist/ });
const openChecklist = () => {
  fireEvent.click(checklistEntry());
  return screen.getByRole("main", { name: "Checklist" });
};
const texts = () => fake.view.checklist.map((i) => i.text);
const items = (panel: HTMLElement) => within(within(panel).getByRole("list", { name: "Checklist items" })).getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"));

describe("checklist", () => {
  it("checklist add, tick, assign and reorder by keyboard", () => {
    newTrip();
    renderIntl(<TripScreen tripId="t1" />);
    const panel = openChecklist();
    expect(checklistEntry().getAttribute("aria-current")).toBe("true");

    const form = within(panel).getByRole("form", { name: "Add an item" });
    for (const text of ["Passports", " Istanbulkart ", "Walking shoes"]) {
      fireEvent.change(within(form).getByLabelText("New item"), { target: { value: text } });
      fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    }
    // Blank items are not added.
    fireEvent.change(within(form).getByLabelText("New item"), { target: { value: "   " } });
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    expect(texts()).toEqual(["Passports", "Istanbulkart", "Walking shoes"]);
    expect(items(panel)).toEqual(["Passports", "Istanbulkart", "Walking shoes"]);

    fireEvent.click(within(panel).getByRole("checkbox", { name: "Istanbulkart" }));
    expect(fake.view.checklist[1].done).toBe(true);
    expect((within(panel).getByRole("checkbox", { name: "Istanbulkart" }) as HTMLInputElement).checked).toBe(true);

    fireEvent.change(within(panel).getByRole("combobox", { name: "Who does Passports" }), { target: { value: "u2" } });
    expect(fake.view.checklist[0].assignee).toBe("u2");
    expect(within(panel).getByRole("combobox", { name: "Who does Passports" })).toHaveProperty("value", "u2");

    const text = within(panel).getByRole("textbox", { name: "Edit Walking shoes" });
    fireEvent.change(text, { target: { value: "Comfortable shoes" } });
    fireEvent.keyDown(text, { key: "Enter" });
    expect(texts()[2]).toBe("Comfortable shoes");

    const up = within(panel).getByRole("button", { name: "Move Comfortable shoes up" });
    up.focus();
    fireEvent.click(up);
    fireEvent.click(up);
    expect(texts()).toEqual(["Comfortable shoes", "Passports", "Istanbulkart"]);
    expect(up.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(up);
    fireEvent.click(within(panel).getByRole("button", { name: "Move Passports down" }));
    expect(texts()).toEqual(["Comfortable shoes", "Istanbulkart", "Passports"]);
    expect(items(panel)).toEqual(["Comfortable shoes", "Istanbulkart", "Passports"]);

    fireEvent.click(within(panel).getByRole("button", { name: "Delete Istanbulkart" }));
    expect(texts()).toEqual(["Comfortable shoes", "Passports"]);
    fireEvent.click(screen.getByRole("button", { name: "Undo deleting Istanbulkart" }));
    expect(texts()).toEqual(["Comfortable shoes", "Istanbulkart", "Passports"]);
    expect(fake.view.checklist[1].done).toBe(true);
  });

  it("checklist shows n of m done", () => {
    const { doc } = newTrip();
    const ids = ["Passports", "Istanbulkart", "Shoes", "Adapter", "Sunscreen"].map((t) => addChecklistItem(doc, t, "u1"));
    updateChecklistItem(doc, ids[0], { done: true }, "u1");
    renderIntl(<TripScreen tripId="t1" />);
    expect(checklistEntry().textContent).toContain("1/5");
    const panel = openChecklist();
    expect(within(panel).getByText("1 of 5 done")).toBeTruthy();

    remoteEdit("u2", (d, origin) => updateChecklistItem(d, ids[3], { done: true, assignee: "u2" }, origin));
    expect(within(panel).getByText("2 of 5 done")).toBeTruthy();
    expect(within(within(panel).getByRole("checkbox", { name: "Adapter" }).closest("li")!).getByRole("img", { name: "Deniz" })).toBeTruthy();

    // A full checklist cannot take more.
    for (let i = 5; i < SOFT_MAX_CHECKLIST; i++) addChecklistItem(doc, `Item ${i}`, "u1");
    refresh();
    expect(within(panel).getByRole("button", { name: "Add" })).toHaveProperty("disabled", true);
    expect(within(panel).getByText(/The checklist is full/)).toBeTruthy();
  });

  it("is read-only while the user is unknown", () => {
    const { doc } = newTrip();
    addChecklistItem(doc, "Passports", "u1");
    fake.userId = null;
    renderIntl(<TripScreen tripId="t1" />);
    const panel = openChecklist();
    expect(within(panel).getByRole("checkbox", { name: "Passports" })).toHaveProperty("disabled", true);
    expect(within(panel).queryByRole("form")).toBeNull();
    expect(within(panel).queryByRole("button")).toBeNull();
  });
});
