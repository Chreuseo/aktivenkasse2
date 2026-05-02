import prisma from "@/lib/prisma";
import nodemailer from "nodemailer";
import * as QRCode from "qrcode";
import JSZip from "jszip";

// Minimale Typen, die wir tatsächlich benutzen, statt Prisma-Modelltypen zu importieren
export type DbUserForMail = {
  id: number;
  first_name: string;
  last_name: string;
  mail: string;
  account: { id: number; balance: unknown; interest?: boolean };
};

export type DbClearingForMail = {
  id: number;
  name: string;
  account: { id: number; balance: unknown; interest?: boolean };
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
  attachments?: { filename: string; content: Buffer; cid?: string; contentType?: string }[];
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

function decimalToNumber(value: unknown): number | null {
  // Behandle null/undefined
  if (value == null) return null;
  // Bereits Zahl
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  // String -> parseFloat mit Komma-Support
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    const n = parseFloat(s.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  // Prisma Decimal o.ä. mit toNumber()
  try {
    const anyVal: any = value as any;
    if (anyVal && typeof anyVal.toNumber === "function") {
      const n = anyVal.toNumber();
      return typeof n === "number" && Number.isFinite(n) ? n : null;
    }
  } catch {
    // ignoriere und falle unten zurück
  }
  return null;
}

function formatCurrency(value: number | null): string {
  if (value === null) return "0,00 €";
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

type RelevantTransactionRow = {
  date: string;
  subject: string;
  counterAccount: string;
  amount: string;
  attachmentName: string;
};

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

function sanitizeFilenamePart(input: string): string {
  return (input || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "beleg";
}

function escapeHtml(input: string): string {
  return (input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeMultiLineToHtml(input: string): string {
  // 1) normalize newlines
  const normalized = (input || "").replace(/\r\n?/g, "\n");
  // 2) escape HTML to prevent injection
  const escaped = escapeHtml(normalized.trim());
  // 3) preserve line breaks (including empty lines)
  return escaped.replace(/\n/g, "<br/>");
}

function getMailHtmlStyles(): string {
  return [
    ".mail-note{color:#666;}",
    ".mail-note-small{color:#666;font-size:.95em;}",
    ".mail-duehint{margin-top:6px;color:#444;}",
    ".mail-section-gap{margin-top:10px;}",
    ".mail-giro-wrap{margin:12px 0 20px 0;}",
    ".mail-giro-title{font-weight:600;margin-bottom:6px;}",
    ".mail-giro-image{width:220px;height:220px;border:1px solid #eee;border-radius:4px;}",
    ".mail-tx-wrap{margin-top:14px;}",
    ".mail-tx-title{font-weight:600;margin-bottom:6px;}",
    ".mail-table{border-collapse:collapse;width:100%;font-size:.95em;}",
    ".mail-table th,.mail-table td{padding:6px;border:1px solid #ddd;text-align:left;}",
    ".mail-table .mail-amount{text-align:right;}",
  ].join("\n");
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
      `<div class="mail-giro-wrap">
         <div class="mail-giro-title">GiroCode für ${escapeHtml(b.owner)} (${escapeHtml(b.bank)})</div>
         <img src="cid:${cid}" alt="GiroCode" class="mail-giro-image"/>
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
    lines.push(`<div><strong>Bank:</strong> ${escapeHtml(b.bank)}</div>`);
    lines.push(`<div><strong>Kontoinhaber:</strong> ${escapeHtml(b.owner)}</div>`);
    lines.push(`<div><strong>IBAN:</strong> ${escapeHtml(b.iban)}</div>`);
    if (b.bic) lines.push(`<div><strong>BIC:</strong> ${escapeHtml(b.bic)}</div>`);
    return `<div class="mail-section-gap">${lines.join("")}</div>`;
  });
  return `<div><div>Bitte überweise den Betrag falls negativ auf eines der folgenden Konten:</div>${blocks.join("")}</div>`;
}

export function buildSubject(_input: MailBuildInput): string {
  // Standard-Betreff, kann über buildMail überschrieben werden
  return "Zahlungsaufforderung / Kontoinformation";
}

async function getNextDueDateForAccount(accountId: number): Promise<{ dueDate: Date | null; amount: number | null }> {
  const d = await prisma.dues.findFirst({
    where: { accountId, paid: false },
    orderBy: { dueDate: "asc" },
    select: { dueDate: true, amount: true },
  });
  return { dueDate: d?.dueDate ?? null, amount: decimalToNumber(d?.amount) };
}

function formatDate(d: Date): string {
  try {
    return new Intl.DateTimeFormat("de-DE").format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function inferCounterAccountLabel(acc: any): string {
  if (!acc) return "-";
  if (Array.isArray(acc.users) && acc.users.length > 0) {
    const u = acc.users[0];
    return `${u.first_name} ${u.last_name}`;
  }
  if (Array.isArray(acc.bankAccounts) && acc.bankAccounts.length > 0) {
    const b = acc.bankAccounts[0];
    return b.name || b.bank || "Bankkonto";
  }
  if (Array.isArray(acc.clearingAccounts) && acc.clearingAccounts.length > 0) {
    const c = acc.clearingAccounts[0];
    return c.name || "Verrechnungskonto";
  }
  return "-";
}

async function loadRelevantTransactionsForAccount(accountId: number, selectedTransactionIds: number[]): Promise<RelevantTransactionRow[]> {
  if (!Number.isFinite(accountId)) return [];
  const transactionIds = Array.from(new Set((selectedTransactionIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n))));
  if (!transactionIds.length) return [];

  const rows = await prisma.transaction.findMany({
    where: { id: { in: transactionIds }, accountId },
    include: {
      attachment: true,
      counter_transaction: {
        include: {
          account: { include: { users: true, bankAccounts: true, clearingAccounts: true } },
        },
      },
    },
    orderBy: { date: "desc" },
  });

  return rows.map((tx) => {
    const valuedDate = (tx as any).date_valued ?? tx.date;
    const amountNumber = decimalToNumber((tx as any).amount) ?? 0;
    const counter = tx.counter_transaction ? inferCounterAccountLabel((tx.counter_transaction as any).account) : "-";
    return {
      date: formatDate(valuedDate),
      subject: sanitizeSingleLine((tx as any).description || "-"),
      counterAccount: sanitizeSingleLine(counter),
      amount: formatCurrency(amountNumber),
      attachmentName: tx.attachment?.name ? sanitizeSingleLine(tx.attachment.name) : "kein Beleg",
    };
  });
}

function buildRelevantTransactionsText(rows: RelevantTransactionRow[]): string {
  if (!rows?.length) return "";
  const lines: string[] = [
    "Relevante Transaktionen:",
    "Datum (Wertstellung) | Betreff | Gegenkonto | Betrag | Beleg (Name)",
  ];
  for (const r of rows) {
    lines.push(`${r.date} | ${r.subject} | ${r.counterAccount} | ${r.amount} | ${r.attachmentName}`);
  }
  return lines.join("\n");
}

function buildRelevantTransactionsHtml(rows: RelevantTransactionRow[]): string {
  if (!rows?.length) return "";
  const bodyRows = rows
    .map((r) =>
      `<tr>
        <td>${escapeHtml(r.date)}</td>
        <td>${escapeHtml(r.subject)}</td>
        <td>${escapeHtml(r.counterAccount)}</td>
        <td class="mail-amount">${escapeHtml(r.amount)}</td>
        <td>${escapeHtml(r.attachmentName)}</td>
      </tr>`
    )
    .join("\n");

  return `<div class="mail-tx-wrap">
    <div class="mail-tx-title">Relevante Transaktionen</div>
    <table class="mail-table">
      <thead>
        <tr>
          <th>Datum (Wertstellung)</th>
          <th>Betreff</th>
          <th>Gegenkonto</th>
          <th class="mail-amount">Betrag</th>
          <th>Beleg (Name)</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </div>`;
}

export function buildBodyText(opts: {
  input: MailBuildInput;
  salutation: string;
  closing: string;
  initiatorName: string;
  remark?: string;
  paymentAccounts: DbBankAccountForMail[];
  dueHint?: string | null;
  relevantTransactions?: RelevantTransactionRow[];
}): string {
  const { input, salutation, closing, initiatorName, remark, paymentAccounts, dueHint, relevantTransactions } = opts;
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

  // Insert Hinweis
  if (dueHint) {
    parts.push("");
    parts.push(dueHint);
  }

  if (relevantTransactions && relevantTransactions.length > 0) {
    parts.push("");
    parts.push(buildRelevantTransactionsText(relevantTransactions));
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
  dueHint?: string | null;
  relevantTransactions?: RelevantTransactionRow[];
}): string {
  const { input, salutation, closing, initiatorName, remark, paymentAccounts, giroHtmlSection, dueHint, relevantTransactions } = opts;
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
    parts.push(`<p class="mail-note">Hinweis: Du bekommst diese Mail, weil du als Verantwortlicher für das Konto eingetragen bist.</p>`);
  }

    // Hinweis zu Fälligkeit
    if (dueHint) {
        parts.push(`<p class="mail-duehint">${escapeHtml(dueHint)}</p>`);
    }

    if (remark && remark.trim()) {
        parts.push(`<p>Bemerkung: <strong>${sanitizeMultiLineToHtml(remark)}</strong></p>`);
    }

    const payHtml = buildPaymentInfoHtml(paymentAccounts);
    if (payHtml) {
        parts.push(`<div class="mail-section-gap">${payHtml}</div>`);
    }

    parts.push(`<p>${closing}<br/>${sanitizeSingleLine(initiatorName)}<br/>${corp}</p>`);


    const linkLine = appUrl
        ? `Alle Details zu deinem Aktivenkonto findest du unter <a href="${appUrl}">${appUrl}</a>.`
        : "Alle Details zu deinem Aktivenkonto findest du auf der Aktivenkasse-Seite.";
    parts.push(`<p class="mail-note-small">${linkLine}<br/>Falls du dich noch nie eingeloggt hast, setze beim ersten Login dein Passwort zurück.</p>`);

  if (giroHtmlSection) {
    parts.push(`<div>${giroHtmlSection}</div>`);
  }

  if (relevantTransactions && relevantTransactions.length > 0) {
    parts.push(buildRelevantTransactionsHtml(relevantTransactions));
  }

  return `<style>${getMailHtmlStyles()}</style>\n${parts.join("\n")}`;
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

async function buildReceiptAttachmentsForAccount(accountId: number, zipLabel: string, selectedTransactionIds: number[]): Promise<{ filename: string; content: Buffer; contentType?: string }[] | undefined> {
  if (!selectedTransactionIds?.length) return undefined;
  if (!Number.isFinite(accountId)) return undefined;

  const transactionIds = Array.from(
    new Set(
      selectedTransactionIds
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n))
    )
  );
  if (!transactionIds.length) return undefined;

  const rows = await prisma.transaction.findMany({
    where: {
      id: { in: transactionIds },
      accountId,
      attachmentId: { not: null },
    },
    include: { attachment: true },
    orderBy: { date: "desc" },
  });

  const files = rows
    .filter((tx) => !!tx.attachment)
    .map((tx) => {
      const name = sanitizeFilenamePart(tx.attachment?.name || `beleg_${tx.id}`);
      return {
        filename: `${String(tx.date.toISOString().slice(0, 10))}_${tx.id}_${name}`,
        content: Buffer.from(tx.attachment!.data as unknown as Uint8Array),
        contentType: tx.attachment?.mimeType || undefined,
      };
    });

  if (!files.length) return undefined;
  if (files.length === 1) return files;

  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.filename, file.content);
  }
  const zipContent = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const zipName = `Belege_${sanitizeFilenamePart(zipLabel)}.zip`;
  return [{ filename: zipName, content: zipContent, contentType: "application/zip" }];
}

export async function buildMail(
  input: MailBuildInput,
  remark: string | undefined,
  initiatorName: string,
  initiatorEmail?: string | null,
  subjectOverride?: string | null,
  selectedReceiptTransactionIds?: number[]
): Promise<BuiltMail> {
  const salutation = getEnvMulti(["MAIL_SALUTATION", "mail.salutation"], "Hallo");
  const closing = getEnvMulti(["MAIL_CLOSING", "mail.closing"], "Viele Grüße");
  const paymentAccounts = await getPaymentMethodAccounts();

  const subject = (subjectOverride && subjectOverride.trim()) || buildSubject(input);

  // Due-Hinweis vorbereiten, wenn interest aktiv
  let dueHint: string | null = null;
  let accountId: number | null;
  let interestFlag: boolean;
  if (input.kind === "user") {
    accountId = input.user.account?.id ?? null;
    interestFlag = !!input.user.account?.interest;
  } else {
    accountId = input.clearing.account?.id ?? null;
    interestFlag = !!input.clearing.account?.interest;
  }
  if (interestFlag && accountId) {
    const nextDue = await getNextDueDateForAccount(accountId);
    const interestRate = (process.env.INTEREST_RATE_PERCENT || process.env["interest.rate.percent"] || "0").toString().trim();
    if (nextDue.dueDate && nextDue.amount) {
      const formattedAmount = formatCurrency(nextDue.amount);
      dueHint = `Hinweis: ${formattedAmount} sind fällig am ${formatDate(nextDue.dueDate)}. Danach werden ${interestRate} % p.a. Verzugszinsen berechnet.`;
    }
  }

  const relevantTransactions = accountId
    ? await loadRelevantTransactionsForAccount(accountId, selectedReceiptTransactionIds || [])
    : [];

  // Text-Teil
  const text = buildBodyText({
    input,
    salutation,
    closing,
    initiatorName,
    remark,
    paymentAccounts,
    dueHint,
    relevantTransactions,
  });

  // HTML + GiroCode-Anhänge
  let html: string;
  let attachments: { filename: string; content: Buffer; cid?: string; contentType?: string }[] | undefined;
  const hasGiro = paymentAccounts.some((b) => b.create_girocode);
  if (hasGiro) {
    const { attachments: att, html: giroHtml } = await buildGirocodeAttachments(paymentAccounts);
    attachments = att;
    html = buildBodyHtml({ input, salutation, closing, initiatorName, remark, paymentAccounts, giroHtmlSection: giroHtml, dueHint, relevantTransactions });
  } else {
    html = buildBodyHtml({ input, salutation, closing, initiatorName, remark, paymentAccounts, dueHint, relevantTransactions });
  }

  const to = input.kind === "user" ? input.user.mail : input.clearing.responsible.mail;
  const recipientUserId = input.kind === "user" ? input.user.id : input.clearing.responsible.id;
  const from = buildFromAddress(initiatorName);
  const replyTo = initiatorEmail || undefined;
  const receiptAccountId = input.kind === "user"
    ? Number(input.user.account?.id)
    : Number(input.clearing.account?.id);
  const receiptZipLabel = input.kind === "user"
    ? `${input.user.first_name}_${input.user.last_name}`
    : input.clearing.name;
  if (Number.isFinite(receiptAccountId)) {
    const receiptAttachments = await buildReceiptAttachmentsForAccount(receiptAccountId, receiptZipLabel, selectedReceiptTransactionIds || []);
    if (receiptAttachments?.length) attachments = [...(attachments || []), ...receiptAttachments];
  }

  return { to, subject, text, from, replyTo, recipientUserId, html, attachments };
}

export async function sendMails(
  inputs: MailBuildInput[],
  remark: string | undefined,
  initiatorName: string,
  initiatorEmail?: string | null,
  subjectOverride?: string | null,
  receiptSelectionsByRecipientId?: Record<number, number[]>
): Promise<{ success: number; errors: { to: string; error: string }[] }>{
  const transport = getTransport();
  let success = 0;
  const errors: { to: string; error: string }[] = [];

  for (const inp of inputs) {
    try {
      const recipientId = inp.kind === "user" ? inp.user.id : inp.clearing.id;
      const selectedReceiptIds = receiptSelectionsByRecipientId?.[recipientId] || [];
      const mail = await buildMail(inp, remark, initiatorName, initiatorEmail, subjectOverride || undefined, selectedReceiptIds);
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
