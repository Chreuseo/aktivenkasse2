import prisma from "@/lib/prisma";
import { User, Account, ClearingAccount, BankAccount } from "@prisma/client";
import nodemailer from "nodemailer";

export type BuildUserInput = {
  kind: "user";
  user: User & { account: Account };
};

export type BuildClearingInput = {
  kind: "clearing";
  clearing: ClearingAccount & { account: Account; responsible: User };
};

export type MailBuildInput = BuildUserInput | BuildClearingInput;

export type BuiltMail = {
  to: string;
  subject: string;
  text: string;
  from: string;
  replyTo?: string;
  recipientUserId?: number | null;
};

export interface MailTransport {
  send(mail: BuiltMail): Promise<void>;
}

export class ConsoleTransport implements MailTransport {
  async send(mail: BuiltMail): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(
      "[ConsoleTransport] To:",
      mail.to,
      "Subject:",
      mail.subject,
      "\nFrom:",
      mail.from,
      mail.replyTo ? `\nReply-To: ${mail.replyTo}` : "",
      "\nrecipientUserId:", mail.recipientUserId,
      "\n\n" + mail.text
    );
  }
}

export class DbTransport implements MailTransport {
  async send(mail: BuiltMail): Promise<void> {
    await prisma.mail.create({
      data: {
        subject: mail.subject,
        body: mail.text,
        addressedTo: mail.to,
        userId: mail.recipientUserId ?? undefined,
      },
    });
  }
}

export class SmtpTransport implements MailTransport {
  private transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  } as any);

  async send(mail: BuiltMail): Promise<void> {
    if (!process.env.SMTP_HOST) {
      throw new Error("SMTP_HOST nicht gesetzt");
    }
    await this.transporter.sendMail({
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      replyTo: mail.replyTo,
    });
  }
}

export class CompositeTransport implements MailTransport {
  private smtp = new SmtpTransport();
  private db = new DbTransport();

  async send(mail: BuiltMail): Promise<void> {
    let smtpErr: any = null;
    try {
      await this.smtp.send(mail);
      await this.db.send(mail);

    } catch (e) {
      smtpErr = e;
    }
    if (smtpErr) throw smtpErr;
  }
}

export function getTransport(): MailTransport {
  const mode = (process.env.MAIL_TRANSPORT || "smtp+db").toLowerCase();
  switch (mode) {
    case "smtp+db":
      return new CompositeTransport();
    case "smtp":
      return new SmtpTransport();
    case "console":
      return new ConsoleTransport();
    case "db":
    default:
      return new DbTransport();
  }
}

function getEnvMulti(keys: string[], fallback = ""): string {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim().length) return String(v);
  }
  return fallback;
}

function decimalToNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof (v as any).toNumber === "function") return (v as any).toNumber();
  const s = String(v);
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function formatCurrency(value: number): string {
  try {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} €`;
  }
}

export async function getPaymentMethodAccounts(): Promise<BankAccount[]> {
  return prisma.bankAccount.findMany({ where: { payment_method: true } });
}

function getCorporationName(): string {
  return getEnvMulti(["CUSTOM_CORPORATION", "custom.corporation"], "Aktivenkasse");
}

function getAppUrl(): string | null {
  const url = getEnvMulti(["NEXTAUTH_URL", "nextauth.url"], "");
  return url || null;
}

function buildPaymentInfoText(bas: BankAccount[]): string {
  if (!bas?.length) return "";
  const corp = getCorporationName();
  const blocks = bas.map((b) => {
    const lines = [
      `Bank: ${b.bank}`,
      `Kontoinhaber: ${corp}`,
      `IBAN: ${b.iban}`,
    ];
    if (b.bic) lines.push(`BIC: ${b.bic}`);
    return lines.join("\n");
  });
  return [
    "Bitte überweise den Betrag falls negativ auf eines der folgenden Konten:",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

export function buildSubject(_input: MailBuildInput): string {
  return "Zahlungsaufforderung Kontoinformation";
}

export function buildBodyText(opts: {
  input: MailBuildInput;
  salutation: string;
  closing: string;
  initiatorName: string;
  remark?: string;
  paymentAccounts: BankAccount[];
}): string {
  const { input, salutation, closing, initiatorName, remark, paymentAccounts } = opts;
  const payText = buildPaymentInfoText(paymentAccounts);
  const corp = getCorporationName();
  const appUrl = getAppUrl();

  const parts: string[] = [];

  if (input.kind === "user") {
    const u = input.user;
    const balance = formatCurrency(decimalToNumber(u.account.balance));
    parts.push(`${salutation} ${u.first_name} ${u.last_name},`);
    parts.push("");
    parts.push(`Dein aktueller Kontostand beträgt: ${balance}.`);
  } else {
    const c = input.clearing;
    const balance = formatCurrency(decimalToNumber(c.account.balance));
    parts.push(`${salutation} ${c.responsible.first_name} ${c.responsible.last_name},`);
    parts.push("");
    parts.push(`Der Kontostand für das Verrechnungskonto "${c.name}": aktuell ${balance}.`);
    parts.push(
      "Hinweis: Du bekommst diese Mail, weil du als Verantwortlicher für das Konto eingetragen bist."
    );
  }

  if (remark && remark.trim()) {
    parts.push("");
    parts.push(`Bemerkung: **${remark.trim()}**`);
  }

  if (payText) {
    parts.push("");
    parts.push(payText);
  }

  parts.push("");
  parts.push(closing);
  parts.push(initiatorName);
  parts.push(corp);

  // Footer mit Link und Hinweis zum Passwort-Reset
  const linkLine = appUrl ? `Alle Details zu deinem Aktivenkonto findest du unter ${appUrl}` :
    "Alle Details zu deinem Aktivenkonto findest du auf der Aktivenkasse-Seite.";
  parts.push("");
  parts.push(linkLine);
  parts.push("Falls du dich noch nie eingeloggt warst, setze beim Login dein Passwort zurück.");

  return parts.join("\n");
}

function buildFromAddress(initiatorName: string): string {
  const org = getEnvMulti(["Mail_from", "MAIL_FROM", "mail.from"], "Aktivenkasse");
  const senderAddr = getEnvMulti([
    "MAIL_SENDER_ADDRESS",
    "Mail_sender_adress",
    "MAIL_SENDER_ADRESS",
    "mail.sender.address",
  ], "noreply@example.org");
  return `${org} im Auftrag von ${initiatorName} <${senderAddr}>`;
}

function applyStandardClosingAndFooter(text: string, initiatorName: string): string {
  const closing = getEnvMulti(["MAIL_CLOSING", "mail.closing"], "Viele Grüße");
  const corp = getCorporationName();
  const appUrl = getAppUrl();
  const lines: string[] = [];
  lines.push(text);
  lines.push("", closing, initiatorName, corp);
  const linkLine = appUrl
    ? `Alle Details zu deinem Aktivenkonto findest du unter ${appUrl}`
    : "Alle Details zu deinem Aktivenkonto findest du auf der Aktivenkasse-Seite.";
  lines.push("", linkLine, "Falls du dich noch nie eingeloggt warst, setze beim Login dein Passwort zurück.");
  return lines.join("\n");
}

export async function buildMail(
  input: MailBuildInput,
  remark: string | undefined,
  initiatorName: string,
  initiatorEmail?: string | null
): Promise<BuiltMail> {
  const salutation = getEnvMulti(["MAIL_SALUTATION", "mail.salutation"], "Hallo");
  const closing = getEnvMulti(["MAIL_CLOSING", "mail.closing"], "Viele Grüße");
  const paymentAccounts = await getPaymentMethodAccounts();

  const subject = buildSubject(input);
  const text = buildBodyText({
    input,
    salutation,
    closing,
    initiatorName,
    remark,
    paymentAccounts,
  });

  const to = input.kind === "user" ? input.user.mail : input.clearing.responsible.mail;
  const recipientUserId = input.kind === "user" ? input.user.id : input.clearing.responsible.id;
  const from = buildFromAddress(initiatorName);
  const replyTo = initiatorEmail || undefined;
  return { to, subject, text, from, replyTo, recipientUserId };
}

export async function sendMails(
  inputs: MailBuildInput[],
  remark: string | undefined,
  initiatorName: string,
  initiatorEmail?: string | null
): Promise<{ success: number; errors: { to: string; error: string }[] }>{
  const transport = getTransport();
  let success = 0;
  const errors: { to: string; error: string }[] = [];

  for (const inp of inputs) {
    try {
      const mail = await buildMail(inp, remark, initiatorName, initiatorEmail);
      await transport.send(mail);
      success += 1;
    } catch (e: any) {
      const to = inp.kind === "user" ? inp.user.mail : inp.clearing.responsible.mail;
      errors.push({ to, error: e?.message || "Unbekannter Fehler" });
    }
  }

  return { success, errors };
}

// Neue Helper-Funktion für einfache Textmails (z.B. Auslagen-Benachrichtigungen)
export async function sendPlainMail(params: {
  to: string;
  subject: string;
  text: string;
  initiatorName: string;
  initiatorEmail?: string | null;
  recipientUserId?: number | null;
}): Promise<void> {
  const { to, subject, text, initiatorName, initiatorEmail, recipientUserId } = params;
  const from = buildFromAddress(initiatorName);
  const replyTo = initiatorEmail || undefined;
  const transport = getTransport();
  const textWithFooter = applyStandardClosingAndFooter(text, initiatorName);
  await transport.send({ to, subject, text: textWithFooter, from, replyTo, recipientUserId });
}
