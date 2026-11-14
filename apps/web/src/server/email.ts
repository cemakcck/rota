import { Resend } from "resend";

export type EmailMessage = { to: string; subject: string; text: string; html: string };

const FROM = process.env.EMAIL_FROM ?? "Rota <onboarding@resend.dev>";

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
