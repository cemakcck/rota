"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiFetch } from "@/client/authClient";
import { errorMessage, readError } from "@/client/apiError";
import { useRouter } from "@/i18n/navigation";
import { Field } from "../Field";
import { btnPrimary, errorText } from "../ui";

export function NewTripForm() {
  const t = useTranslations("trips");
  const te = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [days, setDays] = useState("3");
  // The destination search (Task 13) replaces this; until then it is not sent, so the trip's destination stays unset.
  const [destination, setDestination] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    const trimmed = name.trim();
    const count = Number(days);
    if (trimmed.length < 1 || trimmed.length > 60) found.name = t("nameInvalid");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) found.startDate = t("dateInvalid");
    if (!Number.isInteger(count) || count < 1 || count > 30) found.days = t("daysInvalid");
    setErrors(found);
    setFailure("");
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const res = await apiFetch("/api/trips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed, startDate, days: count, locale }),
      });
      if (!res.ok) {
        setFailure(errorMessage(te, await readError(res)));
        return;
      }
      const { id } = (await res.json()) as { id: string };
      router.push(`/t/${id}`);
    } catch {
      setFailure(te("offline"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Field id="trip-name" label={t("name")} error={errors.name} value={name} onChange={(e) => setName(e.target.value)} />
      <Field id="trip-start" type="date" label={t("startDate")} error={errors.startDate} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      <Field id="trip-days" type="number" min={1} max={30} label={t("daysLabel")} error={errors.days} value={days} onChange={(e) => setDays(e.target.value)} />
      <Field id="trip-destination" label={t("destination")} value={destination} onChange={(e) => setDestination(e.target.value)} />
      {failure && (
        <p role="alert" className={errorText}>
          {failure}
        </p>
      )}
      <button type="submit" className={btnPrimary} disabled={busy}>
        {busy ? t("creating") : t("create")}
      </button>
    </form>
  );
}
