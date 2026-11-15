import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Fraunces, Geist_Mono, Inter } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FRIEND_HANDOFF_SCRIPT } from "@/client/friendHandoff";
import { RegisterSw } from "@/client/registerSw";
import { routing } from "@/i18n/routing";
import "../globals.css";

// Inter for the interface, Fraunces for trip and day titles (spec v2 §3).
const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter" });
const fraunces = Fraunces({ subsets: ["latin", "latin-ext"], variable: "--font-fraunces", axes: ["opsz"] });
const geistMono = Geist_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-geist-mono" });

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  return {
    title: t("title"),
    description: t("description"),
    manifest: "/manifest.webmanifest",
    icons: { icon: { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, apple: "/icons/apple-touch-icon.png" },
  };
}

export const viewport: Viewport = { themeColor: "#f5f3ef" };

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} className={`${inter.variable} ${fraunces.variable} ${geistMono.variable}`}>
      <head>
        {/* First thing on the page: a friend window's session must be stored before any request goes out. */}
        <script dangerouslySetInnerHTML={{ __html: FRIEND_HANDOFF_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <RegisterSw />
      </body>
    </html>
  );
}
