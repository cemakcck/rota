import type { InputHTMLAttributes } from "react";
import { errorText, hint as hintClass, input, label as labelClass } from "./ui";

/** A labelled input whose hint and error are wired with aria-describedby. */
export function Field({
  id,
  label,
  hint,
  error,
  ...props
}: { id: string; label: string; hint?: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input id={id} className={input} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...props} />
      {hint && (
        <p id={`${id}-hint`} className={hintClass}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className={errorText}>
          {error}
        </p>
      )}
    </div>
  );
}
