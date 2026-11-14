import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { AuthPage } from "@/components/Page";

export default async function SignUpPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ email?: string; next?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");
  const { email, next } = await searchParams;
  return (
    <AuthPage title={t("signUpTitle")}>
      <SignUpForm email={typeof email === "string" ? email : undefined} next={next} />
    </AuthPage>
  );
}
