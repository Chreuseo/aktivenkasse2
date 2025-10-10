import prisma from "@/lib/prisma";
import nodemailer from "nodemailer";
import * as QRCode from "qrcode";

// Minimale Typen, die wir tatsächlich benutzen, statt Prisma-Modelltypen zu importieren
export type DbUserForMail = {
  id: number;
  first_name: string;
  last_name: string;
  mail: string;
  account: { balance: unknown };
};

export type DbClearingForMail = {
  name: string;
  account: { balance: unknown };
  responsible: { id: number; first_name: string; last_name: string; mail: string };
};

export type BuildUserInput = {
  kind: "user";
  user: DbUserForMail;
};

export type BuildClearingInput = {
  kind: "clearing";
  clearing: DbClearingForMail;
};

export type MailBuildInput = BuildUserInput | BuildClearingInput;

export type BuiltMail = {
  to: string;
  subject: string;
  text: string;
  from: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; cid: string; contentType?: string }[];
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
      mail.html ? "\n[HTML content present]" : "",
      mail.attachments?.length ? `\nAttachments: ${mail.attachments.length}` : "",
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
      html: mail.html,
      attachments: mail.attachments,
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

// Minimale Bankkonto-Typen für Mails
type DbBankAccountForMail = { bank: string; owner: string; iban: string; bic: string | null; create_girocode: boolean };

export async function getPaymentMethodAccounts(): Promise<DbBankAccountForMail[]> {
  const rows = await prisma.bankAccount.findMany({ where: { payment_method: true }, select: { bank: true, owner: true, iban: true, bic: true, create_girocode: true } });
  return rows as DbBankAccountForMail[];
}

function getCorporationName(): string {
  return getEnvMulti(["CUSTOM_CORPORATION", "custom.corporation"], "Aktivenkasse");
}

function getAppUrl(): string | null {
  const url = getEnvMulti(["NEXTAUTH_URL", "nextauth.url"], "");
  return url || null;
}

function sanitizeSingleLine(input: string): string {
  return (input || "").replace(/[\r\n]+/g, " ").trim();
}

function buildEpcGirocodeString(b: DbBankAccountForMail, opts?: { remittance?: string; amountEur?: number | null }): string {
  const name = sanitizeSingleLine(b.owner).slice(0, 70);
  const iban = sanitizeSingleLine(b.iban).replace(/\s+/g, "");
  const bic = sanitizeSingleLine(b.bic || "");
  // Amount optional
  const amount = (opts?.amountEur && opts.amountEur > 0) ? `EUR${opts.amountEur.toFixed(2)}` : "";
  const rem = sanitizeSingleLine(opts?.remittance || "Aktivenkasse").slice(0, 140);
  // EPC QR (GiroCode) Format
  // BCD\n001\n1\nSCT\nBIC\nNAME\nIBAN\nAMOUNT\n\nREMI\n
  const lines = [
    "BCD",
    "001",
    "1",
    "SCT",
    bic,
    name,
    iban,
    amount,
    "", // Purpose unused
    rem,
    "" // Info
  ];
  return lines.join("\n");
}

async function buildGirocodeAttachments(paymentAccounts: DbBankAccountForMail[]): Promise<{ attachments: { filename: string; content: Buffer; cid: string; contentType: string }[]; html: string }>{
  const attachments: { filename: string; content: Buffer; cid: string; contentType: string }[] = [];
  const htmlBlocks: string[] = [];
  const candidates = paymentAccounts.filter((b) => b.create_girocode);
  for (const b of candidates) {
    const epc = buildEpcGirocodeString(b);
    const png = await QRCode.toBuffer(epc, { type: "png", errorCorrectionLevel: "M", margin: 2, scale: 6 });
    const cid = `girocode-${b.iban.replace(/\s+/g, "").slice(-8)}@aktivenkasse`;
    attachments.push({ filename: `GiroCode_${b.owner}_${b.iban.slice(-6)}.png`, content: png, cid, contentType: "image/png" });
    htmlBlocks.push(
      `<div style="margin:12px 0 20px 0;">
         <div style="font-weight:600;margin-bottom:6px;">GiroCode für ${b.owner} (${b.bank})</div>
         <img src="cid:${cid}" alt="GiroCode" style="width:220px;height:220px;border:1px solid #eee;border-radius:4px;"/>
       </div>`
    );
  }
  return { attachments, html: htmlBlocks.join("\n") };
}

function buildPaymentInfoText(bas: DbBankAccountForMail[]): string {
  if (!bas?.length) return "";
  const blocks = bas.map((b) => {
    const lines = [
      `Bank: ${b.bank}`,
      `Kontoinhaber: ${b.owner}`,
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

function buildPaymentInfoHtml(bas: DbBankAccountForMail[]): string {
  if (!bas?.length) return "";
  const blocks = bas.map((b) => {
    const lines: string[] = [];
    lines.push(`<div><strong>Bank:</strong> ${b.bank}</div>`);
    lines.push(`<div><strong>Kontoinhaber:</strong> ${b.owner}</div>`);
    lines.push(`<div><strong>IBAN:</strong> ${b.iban}</div>`);
    if (b.bic) lines.push(`<div><strong>BIC:</strong> ${b.bic}</div>`);
    return `<div style="margin-bottom:10px;">${lines.join("")}</div>`;
  });
  return `<div><div>Bitte überweise den Betrag falls negativ auf eines der folgenden Konten:</div><div style="height:8px"></div>${blocks.join("")}</div>`;
}

export function buildSubject(_input: MailBuildInput): string {
  // Standard-Betreff, kann über buildMail überschrieben werden
  return "Zahlungsaufforderung / Kontoinformation";
}

export function buildBodyText(opts: {
  input: MailBuildInput;
  salutation: string;
  closing: string;
  initiatorName: string;
  remark?: string;
  paymentAccounts: DbBankAccountForMail[];
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
  const linkLine = appUrl ? `Alle Details zu deinem Aktivenkonto findest du unter ${appUrl}.` :
    "Alle Details zu deinem Aktivenkonto findest du auf der Aktivenkasse-Seite.";
  parts.push("");
  parts.push(linkLine);
  parts.push("Falls du dich noch nie eingeloggt hast, setze beim ersten Login dein Passwort zurück.");

  return parts.join("\n");
}

function buildBodyHtml(opts: {
  input: MailBuildInput;
  salutation: string;
  closing: string;
  initiatorName: string;
  remark?: string;
  paymentAccounts: DbBankAccountForMail[];
  giroHtmlSection?: string;
}): string {
  const { input, salutation, closing, initiatorName, remark, paymentAccounts, giroHtmlSection } = opts;
  const corp = getCorporationName();
  const appUrl = getAppUrl();
  const parts: string[] = [];

  if (input.kind === "user") {
    const u = input.user;
    const balance = formatCurrency(decimalToNumber(u.account.balance));
    parts.push(`<p>${salutation} ${u.first_name} ${u.last_name},</p>`);
    parts.push(`<p>Dein aktueller Kontostand beträgt: <strong>${balance}</strong>.</p>`);
  } else {
    const c = input.clearing;
    const balance = formatCurrency(decimalToNumber(c.account.balance));
    parts.push(`<p>${salutation} ${c.responsible.first_name} ${c.responsible.last_name},</p>`);
    parts.push(`<p>Der Kontostand für das Verrechnungskonto "${c.name}": aktuell <strong>${balance}</strong>.</p>`);
    parts.push(`<p style="color:#666;">Hinweis: Du bekommst diese Mail, weil du als Verantwortlicher für das Konto eingetragen bist.</p>`);
  }

  if (remark && remark.trim()) {
    parts.push(`<p>Bemerkung: <strong>${sanitizeSingleLine(remark)}</strong></p>`);
  }

  const payHtml = buildPaymentInfoHtml(paymentAccounts);
  if (payHtml) {
    parts.push(`<div style="margin-top:10px;">${payHtml}</div>`);
  }

  if (giroHtmlSection) {
    parts.push(`<div style="margin-top:6px;">${giroHtmlSection}</div>`);
  }

  parts.push(`<p>${closing}<br/>${sanitizeSingleLine(initiatorName)}<br/>${corp}</p>`);

  const linkLine = appUrl
    ? `Alle Details zu deinem Aktivenkonto findest du unter <a href="${appUrl}">${appUrl}</a>.`
    : "Alle Details zu deinem Aktivenkonto findest du auf der Aktivenkasse-Seite.";
  parts.push(`<p style="color:#666; font-size:0.95em;">${linkLine}<br/>Falls du dich noch nie eingeloggt hast, setze beim ersten Login dein Passwort zurück.</p>`);

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
    ? `Alle Details zu deinem Aktivenkonto findest du unter ${appUrl}.`
    : "Alle Details zu deinem Aktivenkonto findest du auf der Aktivenkasse-Seite.";
  lines.push("", linkLine, "Falls du dich noch nie eingeloggt hast, setze beim ersten Login dein Passwort zurück.");
  return lines.join("\n");
}

export async function buildMail(
  input: MailBuildInput,
  remark: string | undefined,
  initiatorName: string,
  initiatorEmail?: string | null,
  subjectOverride?: string | null
): Promise<BuiltMail> {
  const salutation = getEnvMulti(["MAIL_SALUTATION", "mail.salutation"], "Hallo");
  const closing = getEnvMulti(["MAIL_CLOSING", "mail.closing"], "Viele Grüße");
  const paymentAccounts = await getPaymentMethodAccounts();

  const subject = (subjectOverride && subjectOverride.trim()) || buildSubject(input);

  // Text-Teil immer erzeugen
  const text = buildBodyText({
    input,
    salutation,
    closing,
    initiatorName,
    remark,
    paymentAccounts,
  });

  // HTML + GiroCode-Anhänge (nur wenn mindestens ein Konto create_girocode=true hat)
  let html: string | undefined = undefined;
  let attachments: { filename: string; content: Buffer; cid: string; contentType?: string }[] | undefined = undefined;
  const hasGiro = paymentAccounts.some((b) => b.create_girocode);
  if (hasGiro) {
    const { attachments: att, html: giroHtml } = await buildGirocodeAttachments(paymentAccounts);
    attachments = att;
    html = buildBodyHtml({ input, salutation, closing, initiatorName, remark, paymentAccounts, giroHtmlSection: giroHtml });
  } else {
    // Auch ohne GiroCodes liefern wir eine simple HTML-Variante
    html = buildBodyHtml({ input, salutation, closing, initiatorName, remark, paymentAccounts });
  }

  const to = input.kind === "user" ? input.user.mail : input.clearing.responsible.mail;
  const recipientUserId = input.kind === "user" ? input.user.id : input.clearing.responsible.id;
  const from = buildFromAddress(initiatorName);
  const replyTo = initiatorEmail || undefined;
  return { to, subject, text, from, replyTo, recipientUserId, html, attachments };
}

export async function sendMails(
  inputs: MailBuildInput[],
  remark: string | undefined,
  initiatorName: string,
  initiatorEmail?: string | null,
  subjectOverride?: string | null
): Promise<{ success: number; errors: { to: string; error: string }[] }>{
  const transport = getTransport();
  let success = 0;
  const errors: { to: string; error: string }[] = [];

  for (const inp of inputs) {
    try {
      const mail = await buildMail(inp, remark, initiatorName, initiatorEmail, subjectOverride || undefined);
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
