import { Resend } from "resend";

export type EmailMessage = { to: string; subject: string; text: string; html: string };

const FROM = process.env.EMAIL_FROM ?? "Tripify <onboarding@resend.dev>";

/** Sends through Resend when RESEND_API_KEY is set; otherwise logs the message (local dev, tests). */
export async function sendEmail({ to, subject, text, html }: EmailMessage): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(`[email] to=${to} subject=${subject}\n${text}`);
    return;
  }
  const { error } = await new Resend(key).emails.send({ from: FROM, to, subject, text, html });
  if (error) throw new Error(`Resend rejected the email: ${error.message}`);
}

// ---- Messages (en / tr) ---------------------------------------------------------------------

export type EmailLocale = "en" | "tr";
export const emailLocale = (value: string | undefined | null): EmailLocale => (value === "tr" ? "tr" : "en");

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** "Ann invited you to Lisbon": `newUser` links to sign-up, otherwise straight to the trip. */
export function inviteMessage(opts: { locale: EmailLocale; to: string; tripName: string; inviter: string; url: string; newUser: boolean }): EmailMessage {
  const { locale, to, tripName, inviter, url, newUser } = opts;
  const copy =
    locale === "tr"
      ? {
          subject: `${inviter} sizi Tripify'da “${tripName}” gezisine davet etti`,
          intro: (who: string, trip: string) => `${who}, “${trip}” gezisini Tripify'da birlikte planlamanız için sizi davet etti.`,
          action: newUser ? "Katılmak için hesabınızı oluşturun" : "Geziyi açın",
        }
      : {
          subject: `${inviter} invited you to “${tripName}” on Tripify`,
          intro: (who: string, trip: string) => `${who} invited you to plan “${trip}” together on Tripify.`,
          action: newUser ? "Create your account to join" : "Open the trip",
        };
  return {
    to,
    subject: copy.subject,
    text: `${copy.intro(inviter, tripName)}\n\n${copy.action}: ${url}`,
    html: `<p>${copy.intro(escapeHtml(inviter), escapeHtml(tripName))}</p><p><a href="${escapeHtml(url)}">${copy.action}</a></p>`,
  };
}

/** The reset link's language follows the reset page that asked for it (its callbackURL's /en or /tr). */
export function resetPasswordMessage(to: string, url: string): EmailMessage {
  let locale: EmailLocale = "en";
  try {
    const callback = new URL(url).searchParams.get("callbackURL");
    if (callback) locale = emailLocale(new URL(callback, url).pathname.split("/")[1]);
  } catch {
    // An odd URL keeps English.
  }
  const copy =
    locale === "tr"
      ? { subject: "Tripify şifrenizi sıfırlayın", action: "Şifrenizi sıfırlayın", ignore: "Bunu siz istemediyseniz bu e-postayı yok sayın." }
      : { subject: "Reset your Tripify password", action: "Reset your password", ignore: "If you did not ask for this, ignore this email." };
  return {
    to,
    subject: copy.subject,
    text: `${copy.action}: ${url}\n\n${copy.ignore}`,
    html: `<p><a href="${escapeHtml(url)}">${copy.action}</a></p><p>${copy.ignore}</p>`,
  };
}
