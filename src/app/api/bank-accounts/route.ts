import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

export async function GET(req: Request) {
  // Berechtigungsprüfung: read_all für bank_accounts
  const perm = await checkPermission(req, ResourceType.bank_accounts, AuthorizationType.read_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für read_all auf bank_accounts" }, { status: 403 });
  }

  try {
    const bankAccounts = await prisma.bankAccount.findMany({
      include: {
        account: {
          select: { balance: true }
        }
      }
    });
    // Nur relevante Felder zurückgeben
    const result = bankAccounts.map(acc => ({
      id: acc.id,
      name: acc.name,
      bank: acc.bank,
      iban: acc.iban,
      balance: acc.account?.balance ? Number(acc.account.balance) : 0
    }));
    return NextResponse.json(result);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Fehler beim Laden der Bankkonten", detail: error?.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // Berechtigungsprüfung: write_all für bank_accounts
  const perm = await checkPermission(req, ResourceType.bank_accounts, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für write_all auf bank_accounts" }, { status: 403 });
  }

  let data;
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige JSON-Daten" }, { status: 400 });
  }

  const { name, bank, iban, bic } = data;
  if (!name || !bank || !iban) {
    return NextResponse.json({ error: "Name, Bank und IBAN sind Pflichtfelder" }, { status: 400 });
  }

  // IBAN muss eindeutig sein
  const existing = await prisma.bankAccount.findUnique({ where: { iban } });
  if (existing) {
    return NextResponse.json({ error: "IBAN existiert bereits" }, { status: 409 });
  }

  try {
    // Account für das Bankkonto anlegen
    const account = await prisma.account.create({
      data: {
        balance: 0,
        interest: false,
        type: "bank"
      }
    });
    // Bankkonto anlegen
    const bankAccount = await prisma.bankAccount.create({
      data: {
        name,
        bank,
        iban,
        bic: bic || null,
        accountId: account.id
      }
    });
    return NextResponse.json({
      id: bankAccount.id,
      name: bankAccount.name,
      bank: bankAccount.bank,
      iban: bankAccount.iban,
      bic: bankAccount.bic,
      balance: 0
    }, { status: 201 });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Fehler beim Anlegen des Bankkontos", detail: error?.message }, { status: 500 });
  }
}

// TODO: PUT, DELETE für Bankkonten später ergänzen
