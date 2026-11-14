"use client";

import { useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { btn, btnDanger, errorText, input, label } from "./ui";

/**
 * A confirm step in a Radix dialog (focus trap, Escape, labelled). With `requireText` the confirm
 * button stays disabled until the person types exactly that text. `onConfirm` returns an error message
 * to keep the dialog open with it, or nothing to close.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  requireText,
  requireLabel,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<string | void>;
  requireText?: string;
  requireLabel?: string;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true);
    setError("");
    const problem = await onConfirm();
    setBusy(false);
    if (problem) setError(problem);
    else setOpen(false);
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setTyped("");
          setError("");
        }
      }}
    >
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-5 shadow-3">
          <Dialog.Title className="text-[16px] font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-ink-2">{description}</Dialog.Description>
          {requireText !== undefined && (
            <div className="mt-4">
              <label htmlFor="confirm-text" className={label}>
                {requireLabel}
              </label>
              <input id="confirm-text" className={input} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </div>
          )}
          {error && (
            <p role="alert" className={errorText}>
              {error}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button type="button" className={btn}>
                {t("cancel")}
              </button>
            </Dialog.Close>
            <button type="button" className={btnDanger} disabled={busy || (requireText !== undefined && typed !== requireText)} onClick={confirm}>
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
