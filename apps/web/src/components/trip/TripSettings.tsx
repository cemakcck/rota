"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/client/authClient";
import { errorMessage, readError } from "@/client/apiError";
import { forgetTrip } from "@/client/myTrips";
import { useRouter } from "@/i18n/navigation";
import { ConfirmDialog } from "../ConfirmDialog";
import { Field } from "../Field";
import { btnDanger, btnPrimary, card, errorText } from "../ui";
import { InvitePanel } from "./InvitePanel";
import { MembersPanel, type TripMember } from "./MembersPanel";

export type TripMeta = { id: string; name: string; startDate: string; days: number };

/**
 * The trip settings: details, members, invites (owner) and deleting the trip (owner). Standalone and
 * prop-driven: the trip screen's settings sheet hosts it (TripSettingsScreen loads it).
 */
export function TripSettings({
  trip,
  members,
  userId,
  locale,
  onChanged,
}: {
  trip: TripMeta;
  members: TripMember[];
  userId: string;
  locale: string;
  onChanged: () => void;
}) {
  const t = useTranslations("settings");
  const te = useTranslations("errors");
  const router = useRouter();
  const isOwner = members.find((m) => m.id === userId)?.role === "owner";
  const [name, setName] = useState(trip.name);
  const [startDate, setStartDate] = useState(trip.startDate);
  const [days, setDays] = useState(String(trip.days));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    const trimmed = name.trim();
    const count = Number(days);
    if (trimmed.length < 1 || trimmed.length > 60) found.name = t("nameInvalid");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) found.startDate = t("dateInvalid");
    if (!Number.isInteger(count) || count < 1 || count > 30) found.days = t("daysInvalid");
    setErrors(found);
    setStatus("");
    setFailure("");
    if (Object.keys(found).length > 0) return;
    const patch: Record<string, unknown> = {};
    if (trimmed !== trip.name) patch.name = trimmed;
    if (startDate !== trip.startDate) patch.startDate = startDate;
    if (count !== trip.days) patch.days = count;
    if (Object.keys(patch).length === 0) return setStatus(t("saved"));
    setBusy(true);
    try {
      const res = await apiFetch(`/api/trips/${trip.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      if (!res.ok) setFailure(errorMessage(te, await readError(res)));
      else {
        setStatus(t("saved"));
        onChanged();
      }
    } catch {
      setFailure(te("offline"));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTrip(): Promise<string | void> {
    try {
      const res = await apiFetch(`/api/trips/${trip.id}`, { method: "DELETE" });
      if (!res.ok) return errorMessage(te, await readError(res));
    } catch {
      return te("offline");
    }
    await forgetTrip(trip.id, userId).catch(() => undefined);
    router.push("/trips");
  }

  return (
    <div className="grid gap-6">
      <form onSubmit={save} noValidate className={`${card} grid gap-4`} aria-labelledby="details-title">
        <h3 id="details-title" className="text-[15px] font-semibold">
          {t("details")}
        </h3>
        <Field id="settings-name" label={t("name")} error={errors.name} value={name} onChange={(e) => setName(e.target.value)} />
        <Field id="settings-start" type="date" label={t("startDate")} error={errors.startDate} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <Field id="settings-days" type="number" min={1} max={30} label={t("days")} error={errors.days} value={days} onChange={(e) => setDays(e.target.value)} />
        <div aria-live="polite">{status && <p role="status" className="font-medium text-ok">{status}</p>}</div>
        {failure && (
          <p role="alert" className={errorText}>
            {failure}
          </p>
        )}
        <div>
          <button type="submit" className={btnPrimary} disabled={busy}>
            {t("save")}
          </button>
        </div>
      </form>

      <div className={card}>
        <MembersPanel tripId={trip.id} members={members} userId={userId} onChanged={onChanged} />
      </div>

      {isOwner && (
        <>
          <div className={card}>
            <InvitePanel tripId={trip.id} locale={locale} onMembersChanged={onChanged} />
          </div>
          <div className={`${card} grid gap-3`}>
            <h3 className="text-[15px] font-semibold">{t("dangerTitle")}</h3>
            <p className="text-ink-2">{t("dangerText")}</p>
            <div>
              <ConfirmDialog
                trigger={
                  <button type="button" className={btnDanger}>
                    {t("delete")}
                  </button>
                }
                title={t("deleteConfirmTitle", { name: trip.name })}
                description={t("deleteConfirmText")}
                confirmLabel={t("deleteConfirm")}
                requireText={trip.name}
                requireLabel={t("deleteTypeLabel")}
                onConfirm={deleteTrip}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
