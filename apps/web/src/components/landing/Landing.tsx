"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { btn, btnPrimary, errorText } from "../ui";
import { SyncAnimation } from "./SyncAnimation";

export const GITHUB_URL = "https://github.com/cemakcck/rota";

export function Landing({ locale }: { locale: "en" | "tr" }) {
  const t = useTranslations("landing");
  const tc = useTranslations("common");
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "limited" | "failed">("idle");

  async function tryDemo() {
    setState("busy");
    try {
      const res = await fetch("/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale }) });
      if (res.status === 429) return setState("limited");
      if (!res.ok) return setState("failed");
      const { tripId } = (await res.json()) as { tripId: string };
      router.push(`/t/${tripId}`);
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 sm:px-8">
      <header className="flex h-16 items-center justify-between">
        <span className="text-[18px] font-semibold tracking-tight">Tripify</span>
        <nav className="flex items-center gap-2" aria-label="Tripify">
          <Link href="/sign-in" className={btn}>
            {t("signIn")}
          </Link>
          <Link href="/sign-up" className={btn}>
            {t("signUp")}
          </Link>
        </nav>
      </header>

      <main id="main" className="grid flex-1 items-center gap-10 py-10 md:grid-cols-2">
        <div>
          <h1 className="text-[36px] font-semibold leading-[1.05] tracking-tight sm:text-[48px]">{t("headline")}</h1>
          <p className="mt-4 max-w-md text-[16px] text-ink-2">{t("pitch")}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" className={`${btnPrimary} !h-11 !px-5 !text-[14px]`} onClick={tryDemo} disabled={state === "busy"}>
              {state === "busy" ? t("tryDemoBusy") : t("tryDemo")}
            </button>
            <Link href="/sign-up" className={`${btn} !h-11 !px-5 !text-[14px]`}>
              {t("signUp")}
            </Link>
          </div>
          {state === "limited" && (
            <p role="alert" className={errorText}>
              {t("demoLimited")}{" "}
              <Link href="/sign-up" className="underline">
                {t("signUp")}
              </Link>
            </p>
          )}
          {state === "failed" && (
            <p role="alert" className={errorText}>
              {t("demoFailed")}
            </p>
          )}
        </div>
        <SyncAnimation />
      </main>

      <footer className="py-6 text-ink-2">
        <a href={GITHUB_URL} className="font-medium underline" rel="noreferrer">
          {tc("github")}
        </a>
      </footer>
    </div>
  );
}
