"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { isMemberColour } from "@rota/trip";
import { authClient } from "@/client/authClient";
import { Link, useRouter } from "@/i18n/navigation";
import { Field } from "../Field";
import { btnPrimary, errorText } from "../ui";
import { ColourPicker } from "./ColourPicker";
import { safeNext } from "./next";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignUpForm({ email: initialEmail = "", next }: { email?: string; next?: string }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [colour, setColour] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    const found: Record<string, string> = {};
    if (trimmed.length < 1 || trimmed.length > 30) found.name = t("nameInvalid");
    if (!EMAIL.test(email.trim())) found.email = t("emailInvalid");
    if (password.length < 8) found.password = t("passwordInvalid");
    if (!isMemberColour(colour)) found.colour = t("colourInvalid");
    setErrors(found);
    setFailed(false);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    // `colour` is one of the app's additional user fields (server/auth.ts).
    const { error } = await authClient.signUp.email({ name: trimmed, email: email.trim(), password, colour } as Parameters<typeof authClient.signUp.email>[0]);
    setBusy(false);
    if (error) setFailed(true);
    else router.push(safeNext(next));
  }

  const query = next ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Field id="name" label={t("name")} hint={t("nameHint")} error={errors.name} value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
      <Field id="email" type="email" label={t("email")} error={errors.email} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      <Field
        id="password"
        type="password"
        label={t("password")}
        hint={t("passwordHint")}
        error={errors.password}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
      />
      <ColourPicker value={colour} onChange={setColour} error={errors.colour} />
      {failed && (
        <p role="alert" className={errorText}>
          {t("signUpFailed")}
        </p>
      )}
      <button type="submit" className={btnPrimary} disabled={busy}>
        {busy ? t("working") : t("signUpSubmit")}
      </button>
      <p className="text-ink-2">
        {t("haveAccount")}{" "}
        <Link href={`/sign-in${query}`} className="font-medium text-ink underline">
          {t("signInSubmit")}
        </Link>
      </p>
    </form>
  );
}
