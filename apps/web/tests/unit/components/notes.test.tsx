import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { addPlace, initTrip, placeNote, upsertMember } from "@rota/trip";
import { renderIntl } from "./helpers";
import { NoteEditor } from "@/components/trip/NoteEditor";

const open: Awareness[] = [];
afterEach(() => {
  cleanup();
  open.splice(0).forEach((a) => a.destroy());
});

/** Two members' devices on one trip, each update and presence change relayed to the other. */
function twoDevices() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  initTrip(a, { name: "Istanbul", startDate: "2026-11-27", days: 1, locale: "en" }, "seed");
  upsertMember(a, { id: "u1", name: "Ann", colour: "#2563eb" });
  const place = addPlace(a, { name: "Galata Tower", category: "sight", dayId: null }, "u1");
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  a.on("update", (u: Uint8Array, origin: unknown) => origin !== "relay" && Y.applyUpdate(b, u, "relay"));
  b.on("update", (u: Uint8Array, origin: unknown) => origin !== "relay" && Y.applyUpdate(a, u, "relay"));

  const awA = new Awareness(a);
  const awB = new Awareness(b);
  open.push(awA, awB);
  const link = (from: Awareness, to: Awareness) =>
    from.on("update", ({ added, updated, removed }: Record<string, number[]>, origin: unknown) => {
      if (origin !== "relay") applyAwarenessUpdate(to, encodeAwarenessUpdate(from, [...added, ...updated, ...removed]), "relay");
    });
  link(awA, awB);
  link(awB, awA);
  awA.setLocalState({ user: { id: "u1", name: "Ann", colour: "#2563eb" }, editing: null, cursor: null });
  awB.setLocalState({ user: { id: "u2", name: "Deniz", colour: "#ea580c" }, editing: null, cursor: null });
  return { a, b, awA, awB, place };
}

const editorIn = (region: HTMLElement) => (within(region).getByRole("textbox", { name: "Note for Galata Tower" }) as HTMLElement & { editor: Editor }).editor;

describe("notes", () => {
  it("two editors on one fragment converge", async () => {
    const { a, b, awA, awB, place } = twoDevices();
    const ann = renderIntl(<NoteEditor fragment={placeNote(a, place)} awareness={awA} name="Galata Tower" editable onOpenChange={() => undefined} />).container;
    const deniz = renderIntl(<NoteEditor fragment={placeNote(b, place)} awareness={awB} name="Galata Tower" editable onOpenChange={() => undefined} />).container;

    fireEvent.click(within(ann).getByRole("button", { name: "Add a note to Galata Tower" }));
    fireEvent.click(within(deniz).getByRole("button", { name: "Add a note to Galata Tower" }));
    const one = editorIn(ann);
    const two = editorIn(deniz);

    // Both editors are open (focus has not moved yet: autofocus waits a frame) and both type at once.
    act(() => {
      one.commands.insertContent("Go before 11.");
      two.commands.setTextSelection(1);
      two.commands.insertContent("Tickets online. ");
    });
    expect(one.getText()).toBe(two.getText());
    expect(one.getText()).toContain("Go before 11.");
    expect(one.getText()).toContain("Tickets online.");
    // Both wrote into the shared fragment, not a copy.
    expect(placeNote(a, place).toString()).toBe(placeNote(b, place).toString());
    // Formatting arrives too.
    act(() => void one.chain().selectAll().toggleBold().run());
    expect(two.getHTML()).toContain("<strong>");

    // Autofocus lands on Deniz's editor last (one document has one focus), so Ann's collapses. The
    // focused editor publishes its caret in its own presence field; the map cursor is left alone.
    await waitFor(() => expect(within(ann).queryByRole("textbox")).toBeNull());
    await waitFor(() => expect(awB.getLocalState()?.caret).toMatchObject({ anchor: expect.anything(), head: expect.anything() }));
    expect(awB.getLocalState()?.cursor).toBeNull();
    expect(within(ann).getByText("Tickets online. Go before 11.")).toBeTruthy();

    // A caret from Ann's other device shows in Deniz's editor, with her name.
    const paragraph = placeNote(b, place).get(0) as Y.XmlElement;
    const at = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(paragraph.get(0) as Y.XmlText, 3));
    const annPhone = new Awareness(new Y.Doc());
    open.push(annPhone);
    annPhone.setLocalState({ user: { id: "u1", name: "Ann", colour: "#2563eb" }, editing: place, cursor: null, caret: { anchor: at, head: at } });
    act(() => applyAwarenessUpdate(awB, encodeAwarenessUpdate(annPhone, [annPhone.clientID]), "remote"));
    const label = await within(deniz).findByText("Ann");
    expect(label.closest(".note-caret")).toBeTruthy();
  });

  it("re-rendering neither re-subscribes the preview nor reconfigures the open editor", () => {
    const { a, awA, place } = twoDevices();
    const fragment = placeNote(a, place);
    const observe = vi.spyOn(fragment, "observeDeep");
    const note = (n: number) => (
      <div data-n={n}>
        <NoteEditor fragment={fragment} awareness={awA} name="Galata Tower" editable onOpenChange={() => undefined} />
      </div>
    );
    const view = renderIntl(note(0));
    view.rerender(note(1));
    view.rerender(note(2));
    expect(observe).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Add a note to Galata Tower" }));
    const editor = editorIn(view.container);
    const setOptions = vi.spyOn(editor, "setOptions");
    view.rerender(note(3));
    view.rerender(note(4));
    expect(setOptions).not.toHaveBeenCalled();
    expect(editorIn(view.container)).toBe(editor);
  });

  it("collapses to a preview when focus leaves, and is read-only without an editor", async () => {
    const { a, awA, place } = twoDevices();
    const view = renderIntl(
      <div>
        <NoteEditor fragment={placeNote(a, place)} awareness={awA} name="Galata Tower" editable onOpenChange={() => undefined} />
        <button type="button">elsewhere</button>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add a note to Galata Tower" }));
    const editor = editorIn(view.container);
    act(() => void editor.commands.insertContent("Closes at 17:00."));
    fireEvent.focusOut(editor.view.dom, { relatedTarget: screen.getByRole("button", { name: "elsewhere" }) });
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(screen.getByText("Closes at 17:00.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit note for Galata Tower" })).toBeTruthy();

    cleanup();
    renderIntl(<NoteEditor fragment={placeNote(a, place)} awareness={null} name="Galata Tower" editable={false} onOpenChange={() => undefined} />);
    expect(screen.getByText("Closes at 17:00.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
