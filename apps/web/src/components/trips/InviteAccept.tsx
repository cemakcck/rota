"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch, authClient } from "@/client/authClient";
import { Link, useRouter } from "@/i18n/navigation";
import { btn, btnPrimary, card } from "../ui";

/** The signed-in or signed-out view of an invite link. */
export function InviteAccept({ token, signedIn }: { token: string; signedIn: boolean }) {
  const t = useTranslations("invite");
  const tl = useTranslations("landing");
  const router = useRouter();
  const [state, setState] = useState<"working" | "invalid" | "failed">("working");

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    (async () => {
      try {
        const res = await apiFetch(`/api/invites/${encodeURIComponent(token)}`, { method: "POST" });
        if (!live) return;
        if (res.ok) return router.push(`/t/${((await res.json()) as { tripId: string }).tripId}`);
        setState(res.status === 404 ? "invalid" : "failed");
      } catch {
        if (live) setState("failed");
      }
    })();
    return () => {
      live = false;
    };
  }, [signedIn, token, router]);

  if (!signedIn) {
    const next = encodeURIComponent(`/invite/${token}`);
    return (
      <div className={`${card} grid gap-4`}>
        <p>{t("signInFirst")}</p>
        <div className="flex gap-2">
          <Link href={`/sign-in?next=${next}`} className={btnPrimary}>
            {tl("signIn")}
          </Link>
          <Link href={`/sign-up?next=${next}`} className={btn}>
            {tl("signUp")}
          </Link>
        </div>
      </div>
    );
  }
  if (state === "working") return <p role="status">{t("working")}</p>;
  return (
    <div role="alert" className={card}>
      <h2 className="text-[16px] font-semibold">{state === "invalid" ? t("invalid") : t("failed")}</h2>
      {state === "invalid" && <p className="mt-1 text-ink-2">{t("invalidHelp")}</p>}
    </div>
  );
}

/** Reads the session, then shows the matching view. */
export function InviteGate({ token }: { token: string }) {
  const tc = useTranslations("common");
  const { data, isPending } = authClient.useSession();
  if (isPending) return <p role="status">{tc("loading")}</p>;
  return <InviteAccept token={token} signedIn={data !== null} />;
}
