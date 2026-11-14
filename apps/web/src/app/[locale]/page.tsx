import { useTranslations } from "next-intl";

export default function HomePage() {
  const t = useTranslations("home");
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-neutral-600">{t("tagline")}</p>
    </main>
  );
}
