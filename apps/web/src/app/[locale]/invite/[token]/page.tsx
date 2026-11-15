import { setRequestLocale } from "next-intl/server";
import { AuthPage } from "@/components/Page";
import { InviteGate } from "@/components/trips/InviteAccept";

export default async function InvitePage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  return (
    <AuthPage title="Tripify">
      <InviteGate token={token} />
    </AuthPage>
  );
}
