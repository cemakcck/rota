import type { ReactElement, ReactNode } from "react";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import tr from "../../../messages/tr.json";

/** Renders inside the app's message provider; `rerender` keeps the provider. */
export function renderIntl(ui: ReactElement, locale: "en" | "tr" = "en") {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : tr} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
  return render(ui, { wrapper });
}

/** A fetch stub answering by "METHOD /path"; unknown requests fail the test loudly. */
export function stubFetch(routes: Record<string, (body: unknown) => { status?: number; body?: unknown } | Response>) {
  const calls: { key: string; body: unknown }[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${typeof input === "string" ? input : String(input)}`;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ key, body });
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected request ${key}`);
    const out = handler(body);
    if (out instanceof Response) return out;
    return new Response(out.body === undefined ? null : JSON.stringify(out.body), { status: out.status ?? 200 });
  };
  return { fn, calls };
}
