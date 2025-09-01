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

// TODO: POST, PUT, DELETE für Bankkonten später ergänzen

