import { getTranslations, setRequestLocale } from "next-intl/server";
import { ProfileScreen } from "@/components/auth/ProfileScreen";
import { AppPage } from "@/components/Page";

export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("profile");
  return (
    <AppPage title={t("title")}>
      <ProfileScreen />
    </AppPage>
  );
}
