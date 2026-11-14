import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppPage } from "@/components/Page";
import { NewTripForm } from "@/components/trips/NewTripForm";

export default async function NewTripPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("trips");
  return (
    <AppPage title={t("newTitle")}>
      <NewTripForm />
    </AppPage>
  );
}
