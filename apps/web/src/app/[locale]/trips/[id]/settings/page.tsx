import { redirect } from "@/i18n/navigation";

/** Trip settings moved into the trip screen's settings sheet; old links land on the trip. */
export default async function TripSettingsPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  redirect({ href: `/t/${id}`, locale });
}
