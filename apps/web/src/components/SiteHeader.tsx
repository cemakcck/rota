import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { SignOutButton } from "./auth/SignOutButton";

/** The header of signed-in pages outside the trip screen. */
export function SiteHeader() {
  const t = useTranslations("common");
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-8">
        <Link href="/trips" className="text-[17px] font-semibold tracking-tight">
          Rota
        </Link>
        <nav aria-label="Rota" className="flex items-center gap-3">
          <Link href="/trips" className="font-medium hover:underline">
            {t("myTrips")}
          </Link>
          <Link href="/profile" className="font-medium hover:underline">
            {t("profile")}
          </Link>
          <SignOutButton />
        </nav>
      </div>
    </header>
  );
}
