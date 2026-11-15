"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { SOFT_MAX_CHECKLIST, type ChecklistItemView, type ChecklistPatch, type MemberView, type Slot } from "@rota/trip";
import { Avatar } from "../Avatar";
import { btnPrimary, hint, input } from "../ui";
import { CommitInput } from "./CommitInput";
import { Icon } from "./icons";
import { SILENT } from "./DayPlan";

/** What a member can do to the checklist; absent while the user is unknown (read-only). */
export type ChecklistActions = {
  add(text: string): void;
  update(id: string, patch: ChecklistPatch): void;
  move(id: string, to: Slot): void;
  remove(item: ChecklistItemView): void;
};

/** The id of an item's checkbox, where focus goes back to after undoing its delete. */
export const checkFocusId = (id: string) => `check-${id}`;

const ghost = "grid size-8 max-lg:size-11 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-hover aria-disabled:cursor-not-allowed aria-disabled:opacity-40";

function AddItem({ full, onAdd }: { full: boolean; onAdd: (text: string) => void }) {
  const t = useTranslations("trip");
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim()) onAdd(text.trim());
    setText("");
    field.current?.focus();
  }
  return (
    <form onSubmit={submit} noValidate aria-label={t("addItem")} className="mx-3 mt-3 grid gap-1">
      <label htmlFor={id} className="sr-only">
        {t("newItem")}
      </label>
      <div className="flex gap-2">
        <input
          ref={field}
          id={id}
          className={input}
          value={text}
          maxLength={200}
          disabled={full}
          autoComplete="off"
          placeholder={t("addItem")}
          aria-describedby={full ? `${id}-full` : undefined}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className={`${btnPrimary} h-10`} disabled={full}>
          {t("add")}
        </button>
      </div>
      {full && (
        <p id={`${id}-full`} className={hint}>
          <strong className="font-semibold text-ink">{t("checklistFull")}</strong> {t("checklistFullHelp", { max: SOFT_MAX_CHECKLIST })}
        </p>
      )}
    </form>
  );
}

function Item({
  item,
  first,
  last,
  members,
  actions,
  onNudge,
}: {
  item: ChecklistItemView;
  first: boolean;
  last: boolean;
  members: MemberView[];
  actions: ChecklistActions | null;
  onNudge: (by: -1 | 1) => void;
}) {
  const t = useTranslations("trip");
  const text = item.text || t("untitledItem");
  const assignee = members.find((m) => m.id === item.assignee);
  const { setNodeRef: setDragRef, listeners, isDragging } = useDraggable({ id: item.id, disabled: !actions });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: item.id, disabled: !actions });
  return (
    <li
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      className={`flex min-h-[52px] flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 ${isOver && !isDragging ? "bg-hover" : ""} ${isDragging ? "opacity-40" : ""}`}
    >
      {actions && (
        <span aria-hidden="true" className="-ml-1 cursor-grab touch-none rounded p-0.5 text-ink-2 active:cursor-grabbing" {...listeners}>
          <Icon name="grip" size={16} />
        </span>
      )}
      {/* Phones: the box is drawn small, but the whole 44 × 44 px around it toggles it. */}
      <label className="grid shrink-0 place-items-center max-lg:-m-2.5 max-lg:size-11">
        <input
          id={checkFocusId(item.id)}
          type="checkbox"
          className="size-[18px] accent-ink"
          aria-label={text}
          checked={item.done}
          disabled={!actions}
          onChange={(e) => actions?.update(item.id, { done: e.target.checked })}
        />
      </label>
      {actions ? (
        <CommitInput
          aria-label={t("editItem", { text })}
          maxLength={200}
          className={`h-8 max-lg:h-11 min-w-24 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-[14px] hover:border-line focus:border-ink-2 ${item.done ? "text-ink-2 line-through" : ""}`}
          value={item.text}
          onCommit={(next) => next.trim() && actions.update(item.id, { text: next.trim() })}
        />
      ) : (
        <span className={`min-w-0 flex-1 text-[14px] [overflow-wrap:anywhere] ${item.done ? "text-ink-2 line-through" : ""}`}>{text}</span>
      )}
      {assignee && <Avatar name={assignee.name} colour={assignee.colour} size={20} />}
      {actions && (
        <span className="flex items-center gap-0.5">
          <select
            aria-label={t("assignItem", { text })}
            className="h-8 max-lg:h-11 max-w-32 rounded-md border border-line bg-surface px-1 text-[12.5px]"
            value={item.assignee ?? ""}
            onChange={(e) => actions.update(item.id, { assignee: e.target.value || null })}
          >
            <option value="">{t("anyone")}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button type="button" className={ghost} aria-label={t("moveUpFor", { name: text })} aria-disabled={first || undefined} onClick={() => !first && onNudge(-1)}>
            <Icon name="up" />
          </button>
          <button type="button" className={ghost} aria-label={t("moveDownFor", { name: text })} aria-disabled={last || undefined} onClick={() => !last && onNudge(1)}>
            <Icon name="down" />
          </button>
          <button type="button" className={ghost} aria-label={t("deleteFor", { name: text })} onClick={() => actions.remove(item)}>
            <Icon name="trash" />
          </button>
        </span>
      )}
    </li>
  );
}

/**
 * The trip's shared checklist (spec §8.5): add, tick, edit, assign, reorder (drag, or the up/down
 * buttons for keyboard and screen readers) and delete, with "n of m done".
 */
export function Checklist({
  items,
  members,
  full,
  actions,
}: {
  items: ChecklistItemView[];
  members: MemberView[];
  full: boolean;
  actions: ChecklistActions | null;
}) {
  const t = useTranslations("trip");
  const headingId = useId();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const done = items.filter((i) => i.done).length;
  const [offscreen] = useState(() => (typeof document === "undefined" ? undefined : document.createElement("div")));

  const nudge = (index: number, by: -1 | 1) => {
    const neighbour = items[index + by];
    if (neighbour && actions) actions.move(items[index].id, by < 0 ? { beforeId: neighbour.id } : { afterId: neighbour.id });
  };
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!actions || !over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    if (from < 0 || to < 0) return;
    actions.move(String(active.id), from < to ? { afterId: String(over.id) } : { beforeId: String(over.id) });
  }

  return (
    <section aria-labelledby={headingId} className="pb-4">
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3.5">
        <h2 id={headingId} className="text-[16px] font-semibold tracking-[-0.01em]">
          {t("checklist")}
        </h2>
        {items.length > 0 && (
          <span className="flex items-center gap-2 font-mono text-[12px] font-medium text-ink-2">
            <span aria-hidden="true" className="h-[5px] w-[72px] overflow-hidden rounded-full bg-line">
              <span className="block h-full bg-ink" style={{ width: `${(done / items.length) * 100}%` }} />
            </span>
            {t("checklistDone", { done, total: items.length })}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="mx-3 rounded-xl border border-dashed border-line px-3 py-4 text-[13px] text-ink-2">{t("checklistEmpty")}</p>
      ) : (
        <DndContext
          accessibility={{ announcements: SILENT, screenReaderInstructions: { draggable: "" }, container: offscreen }}
          sensors={sensors}
          onDragEnd={onDragEnd}
        >
          <ul aria-label={t("checklistItems")} className="mx-3 divide-y divide-line-2 rounded-xl border border-line bg-surface">
            {items.map((item, i) => (
              <Item
                key={item.id}
                item={item}
                first={i === 0}
                last={i === items.length - 1}
                members={members}
                actions={actions}
                onNudge={(by) => nudge(i, by)}
              />
            ))}
          </ul>
        </DndContext>
      )}
      {actions && <AddItem full={full} onAdd={actions.add} />}
    </section>
  );
}
