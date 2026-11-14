"use client";

import { useState, type InputHTMLAttributes } from "react";

type Props = { value: string; onCommit: (value: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange">;

/**
 * An input for a shared value that saves on Enter or when left, never per keystroke. While the person
 * is typing, their draft is shown even if the value changes elsewhere; otherwise (including focused but
 * untouched) the field shows the current value, so focusing it never reverts someone else's change.
 * The element is never remounted, so focus stays put through saves.
 */
export function CommitInput({ value, onCommit, onBlur, onKeyDown, ...props }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <input
      {...props}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        commit();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        onKeyDown?.(e);
      }}
    />
  );
}
