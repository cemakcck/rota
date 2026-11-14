"use client";

import { useEffect, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import type { PlaceView } from "@rota/trip";
import { btn, btnPrimary, btnSm } from "../ui";
import type { ListId } from "./plan";

export type ListChoice = { id: ListId; label: string };

/**
 * The keyboard and screen reader alternative to dragging a place to another day or Ideas: pick a list,
 * the place goes to its end. The caller unmounts it when the place disappears (deleted by someone else).
 */
export function MoveDialog({
  place,
  current,
  lists,
  onMove,
  onClose,
}: {
  place: PlaceView;
  current: ListId;
  lists: ListChoice[];
  onMove: (to: ListId) => void;
  onClose: () => void;
}) {
  const t = useTranslations("trip");
  const tc = useTranslations("common");
  const [choice, setChoice] = useState<ListId>(current);
  const name = place.name || t("unnamed");
  const key = (id: ListId) => id ?? "ideas";

  // When the dialog goes away and its trigger went with it (the place was deleted elsewhere), focus
  // moves to the plan instead of being lost.
  useEffect(
    () => () => {
      requestAnimationFrame(() => {
        if (!document.activeElement || document.activeElement === document.body) document.getElementById("main")?.focus();
      });
    },
    [],
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    onMove(choice);
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-3"
          // Focus goes back to the place's own button, which the caller focuses after the move.
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="text-[16px] font-semibold [overflow-wrap:anywhere]">{t("moveTitle", { name })}</Dialog.Title>
          <Dialog.Description className="mt-1 text-ink-2">{t("moveHelp")}</Dialog.Description>
          <form onSubmit={submit} className="mt-4">
            <fieldset className="grid gap-1.5">
              <legend className="sr-only">{t("moveTitle", { name })}</legend>
              {lists.map((list) => (
                <label
                  key={key(list.id)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-3 py-2 has-[:checked]:border-ink has-[:checked]:shadow-[0_0_0_1px_var(--color-ink)]"
                >
                  <input type="radio" name="move-to" checked={choice === list.id} onChange={() => setChoice(list.id)} className="accent-ink" />
                  {list.id === current ? t("current", { list: list.label }) : list.label}
                </label>
              ))}
            </fieldset>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button type="button" className={`${btn} ${btnSm}`}>
                  {tc("cancel")}
                </button>
              </Dialog.Close>
              <button type="submit" className={`${btnPrimary} ${btnSm}`}>
                {t("moveSubmit")}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
