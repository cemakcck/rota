"use client";

import { useTranslations } from "next-intl";
import { authClient, forgetUser } from "@/client/authClient";
import { useRouter } from "@/i18n/navigation";
import { btn, btnSm } from "../ui";

export function SignOutButton() {
  const t = useTranslations("common");
  const router = useRouter();
  async function signOut() {
    try {
      await authClient.signOut();
    } finally {
      // The device no longer remembers who was signed in, even if the server call failed.
      forgetUser();
    }
    router.push("/");
  }
  return (
    <button type="button" className={`${btn} ${btnSm}`} onClick={signOut}>
      {t("signOut")}
    </button>
  );
}
