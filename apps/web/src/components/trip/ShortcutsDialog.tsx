"use client";

import { Fragment, useCallback, useId, useState, useSyncExternalStore, type MouseEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { btn, btnSm } from "../ui";

/** Where this device remembers that single-key shortcuts are off ("off"); on otherwise. */
export const CHARACTER_KEYS_STORAGE = "rota.characterKeys";
const CHANGED = "rota:character-keys";

function readCharacterKeys(): boolean {
  try {
    return localStorage.getItem(CHARACTER_KEYS_STORAGE) !== "off";
  } catch {
    return true;
  }
}
function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Whether the single-key shortcuts (?, /, [ and ]) are on, and a setter this device remembers. They can
 * be turned off because they would otherwise fire on a speech command or a screen reader's quick keys
 * (WCAG 2.1.4); shortcuts with Ctrl, Cmd or Alt, and Escape, are not affected.
 */
export function useCharacterKeys(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, readCharacterKeys, () => true);
  const set = useCallback((next: boolean) => {
    try {
      if (next) localStorage.removeItem(CHARACTER_KEYS_STORAGE);
      else localStorage.setItem(CHARACTER_KEYS_STORAGE, "off");
    } catch {
      // Storage unavailable (a private window): nothing is remembered, and the shortcuts stay as they were.
    }
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return [on, set];
}

type Key = { label: string; spoken: string };
/** One shortcut: its alternatives (shown "a / b"), each a chord of keys (shown "Ctrl + Z"). */
type Row = { label: string; keys: Key[][] };

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/** A shortcut's keys: drawn as key caps, read as words ("Control plus Shift plus Z"). */
function Keys({ keys }: { keys: Key[][] }) {
  const t = useTranslations("shortcuts");
  const spoken = keys.map((chord) => chord.map((k) => k.spoken).join(` ${t("plus")} `)).join(` ${t("or")} `);
  const cap = "inline-grid h-6 min-w-6 place-items-center rounded-md border border-line border-b-2 bg-paper px-1.5 font-sans text-[12px] font-semibold text-ink";
  return (
    <>
      <span className="sr-only">{spoken}</span>
      <span aria-hidden="true" className="flex flex-wrap items-center justify-end gap-1 text-[12px] text-ink-2">
        {keys.map((chord, i) => (
          <Fragment key={i}>
            {i > 0 && <span>/</span>}
            {chord.map((k, j) => (
              <Fragment key={j}>
                {j > 0 && <span>+</span>}
                <kbd className={cap}>{k.label}</kbd>
              </Fragment>
            ))}
          </Fragment>
        ))}
      </span>
    </>
  );
}

/**
 * The keyboard shortcuts sheet (spec §5): opened with ? or the skip links' "Keyboard shortcuts", it
 * lists every shortcut of the trip screen and holds the switch for the single-key ones. A modal dialog;
 * Escape or Close closes it and focus goes back where it was.
 */
export function ShortcutsDialog({ onClose, characterKeys, onCharacterKeys }: { onClose(): void; characterKeys: boolean; onCharacterKeys(on: boolean): void }) {
  const t = useTranslations("shortcuts");
  const tt = useTranslations("trip");
  const id = useId();
  const mac = isMac();
  // Where focus goes back to: where it was when the sheet opened, else the plan.
  const [from] = useState(() => (typeof document === "undefined" ? null : document.activeElement));
  const close = () => {
    onClose();
    requestAnimationFrame(() => {
      const back = from instanceof HTMLElement && from !== document.body && from.isConnected ? from : document.getElementById("main");
      back?.focus();
    });
  };
  const key = (label: string, spoken = label): Key => ({ label, spoken });
  const k = {
    mod: mac ? key("⌘", t("keys.cmd")) : key("Ctrl", t("keys.ctrl")),
    alt: mac ? key("⌥", t("keys.option")) : key("Alt", t("keys.alt")),
    shift: key("Shift", t("keys.shift")),
  };
  const rows: Row[] = [
    { label: t("show"), keys: [[key("?", t("keys.question"))]] },
    { label: t("search"), keys: [[key("/", t("keys.slash"))]] },
    { label: t("previousDay"), keys: [[key("[", t("keys.leftBracket"))]] },
    { label: t("nextDay"), keys: [[key("]", t("keys.rightBracket"))]] },
    { label: t("reorder"), keys: [[k.alt, key("↑", t("keys.up"))], [key("↓", t("keys.down"))]] },
    { label: t("undo"), keys: [[k.mod, key("Z")]] },
    { label: t("redo"), keys: [[k.mod, k.shift, key("Z")]] },
    { label: t("closePanel"), keys: [[key("Esc", t("keys.escape"))]] },
  ];
  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-3">
          <Dialog.Title className="text-[16px] font-semibold">{t("title")}</Dialog.Title>
          <Dialog.Description className="mt-1 text-ink-2">{t("intro")}</Dialog.Description>
          <dl className="mt-4 grid gap-2.5">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3">
                <dt className="min-w-0">{row.label}</dt>
                <dd className="shrink-0">
                  <Keys keys={row.keys} />
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 grid gap-1 border-t border-line pt-4">
            <button
              type="button"
              role="switch"
              aria-checked={characterKeys}
              aria-describedby={`${id}-help`}
              onClick={() => onCharacterKeys(!characterKeys)}
              className="inline-flex min-h-11 items-center gap-2 justify-self-start rounded-lg font-medium text-ink hover:bg-hover lg:min-h-8"
            >
              <span aria-hidden="true" className={`relative h-5 w-9 shrink-0 rounded-full border ${characterKeys ? "border-ink bg-ink" : "border-ink-2 bg-surface"}`}>
                <span className={`absolute top-0.5 size-3.5 rounded-full motion-safe:transition-[left] ${characterKeys ? "left-[18px] bg-white" : "left-0.5 bg-ink-2"}`} />
              </span>
              {t("characterKeys")}
            </button>
            <p id={`${id}-help`} className="text-[12.5px] text-ink-2">
              {t("characterKeysHelp")}
            </p>
          </div>
          <div className="mt-5 flex justify-end">
            <Dialog.Close asChild>
              <button type="button" className={`${btn} ${btnSm} max-lg:!h-11`}>
                {tt("close")}
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The trip screen's skip links, first in the tab order and shown when focused: "Skip to plan" (WCAG 2.4.1)
 * and "Keyboard shortcuts", the way to the shortcuts sheet that needs no single-key shortcut.
 */
export function SkipLinks({ onPlan, onShortcuts }: { onPlan(): void; onShortcuts(): void }) {
  const t = useTranslations("shortcuts");
  const look =
    "sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[60] focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-lg focus:border focus:border-ink focus:bg-surface focus:px-4 focus:text-[14px] focus:font-semibold focus:text-ink focus:shadow-2";
  return (
    <>
      <a
        href="#main"
        className={look}
        onClick={(e: MouseEvent) => {
          // Focus, not the address: the plan's `#main` takes it (and on the phone's Map tab, the Plan tab shows first).
          e.preventDefault();
          onPlan();
        }}
      >
        {t("skipToPlan")}
      </a>
      <button type="button" className={look} onClick={onShortcuts}>
        {t("open")}
      </button>
    </>
  );
}
