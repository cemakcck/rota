import type { ReactNode } from "react";
import { SiteHeader } from "./SiteHeader";
import { card } from "./ui";

/** A page with the signed-in header and a centred column. */
export function AppPage({ title, action, children, narrow = true }: { title: string; action?: ReactNode; children: ReactNode; narrow?: boolean }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className={`mx-auto px-4 py-8 sm:px-8 ${narrow ? "max-w-xl" : "max-w-3xl"}`}>
        <div className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
          {action}
        </div>
        {children}
      </main>
    </>
  );
}

/** The centred card of the signed-out pages (sign in, sign up, reset). */
export function AuthPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main id="main" className="mx-auto grid min-h-screen max-w-md content-center px-4 py-10">
      <p className="mb-6 text-[18px] font-semibold tracking-tight">Tripify</p>
      <div className={card}>
        <h1 className="mb-5 text-[22px] font-semibold tracking-tight">{title}</h1>
        {children}
      </div>
    </main>
  );
}
