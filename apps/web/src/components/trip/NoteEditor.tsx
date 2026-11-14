"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { yCursorPlugin } from "@tiptap/y-tiptap";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { isMemberColour } from "@rota/trip";
import { CARET_FIELD } from "@/client/presence";

type CaretUser = { name?: unknown; colour?: unknown };
const caretColour = (user: CaretUser) => (isMemberColour(user.colour) ? user.colour : "#57544e");

type State = Record<string, unknown>;

/**
 * The awareness as y-tiptap's caret plugin sees it: its `cursor` is presence's `CARET_FIELD`. The plugin
 * reads remote carets from `cursor` whatever field it is told to write, and presence keeps `cursor`
 * for the map, so the plugin gets this view instead of the awareness itself.
 */
function caretAwareness(awareness: Awareness) {
  const view = (state: State | null) => state && { ...state, cursor: state[CARET_FIELD] ?? null };
  return {
    get clientID() {
      return awareness.clientID;
    },
    getLocalState: () => view(awareness.getLocalState()),
    getStates: () => new Map([...awareness.getStates()].map(([client, state]) => [client, view(state)])),
    setLocalStateField: (field: string, value: unknown) => awareness.setLocalStateField(field === "cursor" ? CARET_FIELD : field, value),
    on: (event: "change", cb: () => void) => awareness.on(event, cb),
    off: (event: "change", cb: () => void) => awareness.off(event, cb),
  };
}

/**
 * Tiptap's CollaborationCaret, keeping presence's shape: carets go in their own awareness field (see
 * caretAwareness), the caret wears the member's `colour`, and the extension does not overwrite `user`
 * (presence publishes it).
 */
const NoteCaret = CollaborationCaret.extend({
  addProseMirrorPlugins() {
    const { awareness } = this.options.provider as { awareness: Awareness };
    return [
      yCursorPlugin(caretAwareness(awareness) as unknown as Awareness, {
        cursorBuilder: (user: CaretUser) => {
          const caret = document.createElement("span");
          caret.className = "note-caret";
          caret.style.borderColor = caretColour(user);
          const label = document.createElement("span");
          label.className = "note-caret-label";
          label.style.borderColor = caretColour(user);
          label.textContent = typeof user.name === "string" ? user.name : "";
          caret.append(label);
          return caret;
        },
        selectionBuilder: (user: CaretUser) => ({ style: `background-color: ${caretColour(user)}33` }),
      }),
    ];
  },
});

/** A note fragment, or null when its place or day is gone (deleted by someone else meanwhile). */
export function noteOrNull(read: () => Y.XmlFragment): Y.XmlFragment | null {
  try {
    return read();
  } catch {
    return null;
  }
}

const inline = (text: Y.XmlText) => (text.toDelta() as { insert: unknown }[]).map((d) => (typeof d.insert === "string" ? d.insert : "")).join("");

/** The note's text, a line per paragraph (list items included), for the collapsed preview. */
function lines(node: Y.XmlFragment | Y.XmlElement | Y.XmlText | Y.XmlHook): string[] {
  if (node instanceof Y.XmlText) return [inline(node)];
  if (node instanceof Y.XmlHook) return [];
  if (node instanceof Y.XmlElement && node.nodeName === "paragraph") return [node.toArray().map((c) => (c instanceof Y.XmlText ? inline(c) : "")).join("")];
  return node.toArray().flatMap(lines);
}

const noteText = (fragment: Y.XmlFragment) =>
  lines(fragment)
    .filter((l) => l.trim() !== "")
    .join("\n");

function useNoteText(fragment: Y.XmlFragment): string {
  return useSyncExternalStore(
    (changed) => {
      fragment.observeDeep(changed);
      return () => fragment.unobserveDeep(changed);
    },
    () => noteText(fragment),
    () => "",
  );
}

const tool = "grid size-7 place-items-center rounded-md text-[13px] text-ink-2 hover:bg-hover aria-pressed:bg-ink aria-pressed:text-white";

function Toolbar({ editor }: { editor: Editor }) {
  const t = useTranslations("trip");
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({ bold: e.isActive("bold"), italic: e.isActive("italic"), bulletList: e.isActive("bulletList") }),
  });
  const button = (key: keyof typeof active, label: string, run: () => void, face: ReactNode) => (
    <button
      type="button"
      className={tool}
      aria-label={label}
      aria-pressed={active[key]}
      // Keeps focus (and the selection) in the editor.
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {face}
    </button>
  );
  return (
    <div role="toolbar" aria-label={t("formatting")} className="flex gap-0.5 border-b border-line-2 px-1 py-0.5">
      {button("bold", t("bold"), () => editor.chain().focus().toggleBold().run(), <b aria-hidden="true">B</b>)}
      {button("italic", t("italic"), () => editor.chain().focus().toggleItalic().run(), <i aria-hidden="true">I</i>)}
      {button("bulletList", t("bulletList"), () => editor.chain().focus().toggleBulletList().run(), <span aria-hidden="true">•</span>)}
    </div>
  );
}

/** The open editor, bound to the shared fragment. Mounted only while open, so collapsed notes cost nothing. */
function OpenEditor({ fragment, awareness, label, onClose }: { fragment: Y.XmlFragment; awareness: Awareness | null; label: string; onClose(): void }) {
  const editor = useEditor({
    extensions: [
      // Collaboration brings its own undo (per fragment, only this person's typing).
      StarterKit.configure({
        undoRedo: false,
        heading: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        orderedList: false,
        strike: false,
        underline: false,
        link: false,
        hardBreak: false,
      }),
      Collaboration.configure({ fragment }),
      ...(awareness ? [NoteCaret.configure({ provider: { awareness } })] : []),
    ],
    autofocus: "end",
    editorProps: {
      attributes: { role: "textbox", "aria-multiline": "true", "aria-label": label, class: "note-editor min-h-16 px-2.5 py-2 outline-none" },
    },
  });
  if (!editor) return null;
  return (
    <div
      className="rounded-lg border border-ink-2 bg-surface focus-within:shadow-[0_0_0_1px_var(--color-ink)]"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

/**
 * A place's or day's note, written together: paragraphs, bold, italic and bullet lists, with others'
 * carets in their colour. Collapsed it is a quiet preview; it opens on "Add a note"/"Edit note" (or a
 * click on the preview) and collapses again when focus leaves it or on Escape.
 */
export function NoteEditor({
  fragment,
  awareness,
  name,
  editable,
  onOpenChange,
}: {
  fragment: Y.XmlFragment;
  awareness: Awareness | null;
  /** What the note is about ("Galata Tower", "Day 2"), for its labels. */
  name: string;
  editable: boolean;
  onOpenChange(open: boolean): void;
}) {
  const t = useTranslations("trip");
  const text = useNoteText(fragment);
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange(next);
  };
  const close = (refocus: boolean) => {
    change(false);
    if (refocus) requestAnimationFrame(() => toggle.current?.focus());
  };

  if (open && editable)
    return (
      <div
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close(false);
        }}
      >
        <OpenEditor fragment={fragment} awareness={awareness} label={t("noteFor", { name })} onClose={() => close(true)} />
      </div>
    );
  if (!text && !editable) return null;
  return (
    <div className="grid justify-items-start gap-1">
      {text && (
        <p
          className="line-clamp-3 whitespace-pre-line border-l-2 border-line pl-2.5 text-[13px] leading-normal text-ink-2 [overflow-wrap:anywhere]"
          onClick={editable ? () => change(true) : undefined}
        >
          {text}
        </p>
      )}
      {editable && (
        <button
          ref={toggle}
          type="button"
          className="rounded-md px-1 text-[12.5px] font-medium text-ink-2 underline-offset-2 hover:underline"
          aria-label={text ? t("editNoteFor", { name }) : t("addNoteFor", { name })}
          onClick={() => change(true)}
        >
          {text ? t("editNote") : t("addNote")}
        </button>
      )}
    </div>
  );
}
