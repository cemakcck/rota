"use client";

import { useTranslations } from "next-intl";
import { apiFetch } from "@/client/authClient";
import { errorMessage, readError } from "@/client/apiError";
import { forgetTrip } from "@/client/myTrips";
import { useRouter } from "@/i18n/navigation";
import { Avatar } from "../Avatar";
import { ConfirmDialog } from "../ConfirmDialog";
import { btn, btnSm } from "../ui";

export type TripMember = { id: string; name: string; colour: string; role: "owner" | "member" };

/** Who is on the trip. The owner transfers or removes others; everyone else can leave. */
export function MembersPanel({
  tripId,
  members,
  userId,
  onChanged,
}: {
  tripId: string;
  members: TripMember[];
  userId: string;
  onChanged: () => void;
}) {
  const t = useTranslations("members");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const router = useRouter();
  const isOwner = members.find((m) => m.id === userId)?.role === "owner";

  /** Runs an API call; an error message keeps the dialog open. */
  async function call(path: string, method: string): Promise<string | void> {
    try {
      const res = await apiFetch(`/api/trips/${tripId}/members/${path}`, { method });
      if (!res.ok) return errorMessage(te, await readError(res));
    } catch {
      return te("offline");
    }
  }

  async function leave() {
    const problem = await call(userId, "DELETE");
    if (problem) return problem;
    await forgetTrip(tripId, userId).catch(() => undefined);
    router.push("/trips");
  }

  const button = (text: string, aria?: string) => (
    <button type="button" className={`${btn} ${btnSm}`} aria-label={aria}>
      {text}
    </button>
  );

  return (
    <section aria-labelledby="members-title">
      <h3 id="members-title" className="mb-3 text-[15px] font-semibold">
        {t("title")}
      </h3>
      <ul aria-label={t("list")} className="grid gap-2">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2.5">
            <Avatar name={m.name} colour={m.colour} />
            <div className="min-w-0 flex-1">
              <span className="font-medium">{m.name}</span>
              {m.id === userId && <span className="text-ink-2"> ({tc("you")})</span>}
              <span className="ml-2 inline-flex h-5 items-center rounded-md bg-line-2 px-2 text-[11.5px] font-medium text-ink-2">
                {m.role === "owner" ? tc("owner") : tc("member")}
              </span>
            </div>
            {isOwner && m.id !== userId && (
              <div className="flex gap-1.5">
                <ConfirmDialog
                  trigger={button(t("transfer"), t("transferFor", { name: m.name }))}
                  title={t("transferTitle", { name: m.name })}
                  description={t("transferText")}
                  confirmLabel={t("transferConfirm")}
                  onConfirm={async () => {
                    const problem = await call(`${m.id}/owner`, "POST");
                    if (!problem) onChanged();
                    return problem;
                  }}
                />
                <ConfirmDialog
                  trigger={button(t("remove"), t("removeFor", { name: m.name }))}
                  title={t("removeTitle", { name: m.name })}
                  description={t("removeText")}
                  confirmLabel={t("removeConfirm")}
                  onConfirm={async () => {
                    const problem = await call(m.id, "DELETE");
                    if (!problem) onChanged();
                    return problem;
                  }}
                />
              </div>
            )}
            {!isOwner && m.id === userId && (
              <ConfirmDialog
                trigger={button(t("leave"))}
                title={t("leaveTitle")}
                description={t("leaveText")}
                confirmLabel={t("leaveConfirm")}
                onConfirm={leave}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
