import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignInForm } from "@/components/auth/SignInForm";
import { AuthPage } from "@/components/Page";

export default async function SignInPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");
  const { next } = await searchParams;
  return (
    <AuthPage title={t("signInTitle")}>
      <SignInForm next={next} />
    </AuthPage>
  );
}
