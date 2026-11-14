import { getTranslations, setRequestLocale } from "next-intl/server";
import { ResetPasswordForm, ResetRequestForm } from "@/components/auth/ResetForms";
import { AuthPage } from "@/components/Page";

/** Without a token: ask for a link. With the emailed link's token: choose a new password. */
export default async function ResetPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");
  const { token } = await searchParams;
  return token ? (
    <AuthPage title={t("newPasswordTitle")}>
      <ResetPasswordForm token={token} />
    </AuthPage>
  ) : (
    <AuthPage title={t("resetTitle")}>
      <ResetRequestForm />
    </AuthPage>
  );
}
