"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiFetch, authClient } from "@/client/authClient";
import { Field } from "../Field";
import { btnPrimary, errorText } from "../ui";
import { ColourPicker } from "./ColourPicker";

/** Name and colour. The server updates the account and every trip's member mirror (PATCH /api/profile). */
export function ProfileForm({ name: initialName, colour: initialColour }: { name: string; colour: string }) {
  const t = useTranslations("auth");
  const tp = useTranslations("profile");
  const tc = useTranslations("common");
  const [name, setName] = useState(initialName);
  const [colour, setColour] = useState(initialColour);
  const [nameError, setNameError] = useState("");
  const [status, setStatus] = useState<"idle" | "saved" | "failed">("idle");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    setStatus("idle");
    if (trimmed.length < 1 || trimmed.length > 30) return setNameError(t("nameInvalid"));
    setNameError("");
    setBusy(true);
    const res = await apiFetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed, colour }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setStatus("saved");
      void authClient.getSession({ fetchOptions: { cache: "no-store" } });
    } else setStatus("failed");
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Field id="name" label={t("name")} hint={t("nameHint")} error={nameError} value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
      <ColourPicker value={colour} onChange={setColour} />
      {status === "saved" && (
        <p role="status" className="font-medium text-ok">
          {tp("saved")}
        </p>
      )}
      {status === "failed" && (
        <p role="alert" className={errorText}>
          {tp("failed")}
        </p>
      )}
      <button type="submit" className={btnPrimary} disabled={busy}>
        {busy ? t("working") : tc("save")}
      </button>
    </form>
  );
}
