import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

export async function GET(req: Request) {
  const perm = await checkPermission(req, ResourceType.bank_accounts, AuthorizationType.read_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für read_all auf bank_accounts" }, { status: 403 });
  }

  try {
    const items = await prisma.bankAccount.findMany({
      select: {
        id: true,
        name: true,
        bank: true,
        iban: true,
        accountId: true,
        account: { select: { balance: true } },
      },
      orderBy: { name: "asc" },
    });

    // Shape in { id, name, bank, iban, accountId, balance }
    const mapped = items.map((it) => ({
      id: it.id,
      name: it.name,
      bank: it.bank,
      iban: it.iban,
      accountId: it.accountId,
      // Prisma Decimal -> number für Client-Formatierung
      balance: it.account ? Number(it.account.balance) : 0,
    }));

    return NextResponse.json(mapped);
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: "Fehler beim Laden der Bankkonten", detail: e?.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // write_all auf bank_accounts erforderlich
  const perm = await checkPermission(req, ResourceType.bank_accounts, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für write_all auf bank_accounts" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch (e: any) {
    return NextResponse.json({ error: "Ungültige JSON-Daten" }, { status: 400 });
  }

  const { name, bank, iban, bic, payment_method } = body || {};
  if (!name || !bank || !iban) {
    return NextResponse.json({ error: "Pflichtfelder fehlen", fields: { name: !!name, bank: !!bank, iban: !!iban } }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (p) => {
      // Konto für das Bankkonto anlegen (Typ: bank, Startsaldo 0)
      const account = await p.account.create({
        data: { balance: 0, interest: true, type: "bank" },
      });

      // BankAccount-Datensatz anlegen und mit Account verknüpfen
      const bankAccount = await p.bankAccount.create({
        data: {
          name: String(name),
          bank: String(bank),
          iban: String(iban),
          ...(bic ? { bic: String(bic) } : {}),
          payment_method: Boolean(payment_method),
          account: { connect: { id: account.id } },
        },
        select: { id: true, name: true, bank: true, iban: true, bic: true, payment_method: true, accountId: true },
      });

      return bankAccount;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (e: any) {
    // Möglicher Unique-Verstoß bei IBAN etc.
    const msg = e?.code === "P2002" ? "IBAN bereits vorhanden" : "Fehler beim Anlegen des Bankkontos";
    console.error("POST /api/bank-accounts failed", e);
    return NextResponse.json({ error: msg, detail: e?.message }, { status: 400 });
  }
}
