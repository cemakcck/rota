"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@/client/authClient";
import { Link, useRouter } from "@/i18n/navigation";
import { Field } from "../Field";
import { btnPrimary, errorText } from "../ui";
import { safeNext } from "./next";

export function SignInForm({ next }: { next?: string }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailed(false);
    const { error } = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (error) setFailed(true);
    else router.push(safeNext(next));
  }

  const query = next ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field id="email" type="email" label={t("email")} required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      <Field id="password" type="password" label={t("password")} required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      {failed && (
        <p role="alert" className={errorText}>
          {t("signInFailed")}
        </p>
      )}
      <button type="submit" className={btnPrimary} disabled={busy}>
        {busy ? t("working") : t("signInSubmit")}
      </button>
      <p className="grid gap-1 text-ink-2">
        <Link href="/reset" className="font-medium text-ink underline">
          {t("forgot")}
        </Link>
        <span>
          {t("noAccount")}{" "}
          <Link href={`/sign-up${query}`} className="font-medium text-ink underline">
            {t("signUpSubmit")}
          </Link>
        </span>
      </p>
    </form>
  );
}
