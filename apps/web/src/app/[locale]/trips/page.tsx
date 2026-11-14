import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppPage } from "@/components/Page";
import { MyTrips, NewTripLink } from "@/components/trips/MyTrips";

export default async function TripsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("trips");
  return (
    <AppPage title={t("title")} action={<NewTripLink />} narrow={false}>
      <MyTrips />
    </AppPage>
  );
}
