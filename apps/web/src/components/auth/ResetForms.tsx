"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { authClient } from "@/client/authClient";
import { Link } from "@/i18n/navigation";
import { Field } from "../Field";
import { btnPrimary, errorText } from "../ui";

/** Asks for a reset link. The answer is the same whether or not the address has an account. */
export function ResetRequestForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await authClient.requestPasswordReset({ email: email.trim(), redirectTo: `${window.location.origin}/${locale}/reset` }).catch(() => undefined);
    setBusy(false);
    setSent(true);
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <p className="text-ink-2">{t("resetNoToken")}</p>
      <Field id="email" type="email" label={t("email")} required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      {sent && (
        <p role="status" className="font-medium text-ok">
          {t("resetSent")}
        </p>
      )}
      <button type="submit" className={btnPrimary} disabled={busy}>
        {busy ? t("working") : t("resetSubmit")}
      </button>
      <Link href="/sign-in" className="font-medium underline">
        {t("backToSignIn")}
      </Link>
    </form>
  );
}

/** Sets the new password from the emailed link's token. */
export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) return setError(t("passwordInvalid"));
    setBusy(true);
    const { error: failed } = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);
    if (failed) setError(t("resetFailed"));
    else setDone(true);
  }

  if (done) {
    return (
      <div className="grid gap-4">
        <p role="status" className="font-medium text-ok">
          {t("resetDone")}
        </p>
        <Link href="/sign-in" className="font-medium underline">
          {t("signInSubmit")}
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Field
        id="new-password"
        type="password"
        label={t("newPassword")}
        hint={t("passwordHint")}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
      />
      {error && (
        <p role="alert" className={errorText}>
          {error}
        </p>
      )}
      <button type="submit" className={btnPrimary} disabled={busy}>
        {busy ? t("working") : t("newPasswordSubmit")}
      </button>
    </form>
  );
}
