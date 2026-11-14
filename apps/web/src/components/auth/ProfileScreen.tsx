"use client";

import { useTranslations } from "next-intl";
import { authClient } from "@/client/authClient";
import { ProfileForm } from "./ProfileForm";

/** The profile form for the signed-in user. */
export function ProfileScreen() {
  const tc = useTranslations("common");
  const { data, isPending } = authClient.useSession();
  if (isPending) return <p role="status">{tc("loading")}</p>;
  if (!data) return null;
  const { name, colour } = data.user as { name: string; colour?: string };
  // `key` restarts the form when the session's user is replaced.
  return <ProfileForm key={`${name}|${colour}`} name={name} colour={colour ?? ""} />;
}
