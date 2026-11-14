import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppPage } from "@/components/Page";
import { TripSettingsScreen } from "@/components/trip/TripSettingsScreen";

/** Hosts the trip settings panel until the trip screen's header menu (Task 10) does. */
export default async function TripSettingsPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("settings");
  return (
    <AppPage title={t("title")} narrow={false}>
      <TripSettingsScreen tripId={id} />
    </AppPage>
  );
}
