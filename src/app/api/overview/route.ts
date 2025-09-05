import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Hilfsfunktion zum sicheren Number-Parse (Decimal -> number)
function toNumberSafely(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return isFinite(n) ? n : 0;
}

export async function GET() {
  try {
    // Bankkonten inkl. zugehörigem Account (für Saldo)
    const bankAccounts = await prisma.bankAccount.findMany({
      include: { account: { select: { id: true, balance: true } } },
      orderBy: { name: "asc" },
    });

    const bankAccountsDto = bankAccounts.map((b) => ({
      id: b.id,
      name: b.name,
      bank: b.bank,
      iban: b.iban,
      balance: String(b.account?.balance ?? 0),
    }));

    const bankTotal = bankAccounts.reduce((acc, b) => acc + toNumberSafely(b.account?.balance), 0);

    // Verrechnungskonten inkl. Account (für Saldo) und reimbursementEligible
    const clearingAccounts = await prisma.clearingAccount.findMany({
      include: { account: { select: { id: true, balance: true } } },
      orderBy: { name: "asc" },
    });

    const clearingAccountsDto = clearingAccounts.map((c) => ({
      id: c.id,
      name: c.name,
      reimbursementEligible: c.reimbursementEligible,
      balance: String(c.account?.balance ?? 0),
    }));

    const clearingTotal = clearingAccounts.reduce((acc, c) => acc + toNumberSafely(c.account?.balance), 0);

    // Nutzerkennzahlen aus offenen Vorgängen (Advances)
    // Annahme:
    //  - amount > 0 => Verbindlichkeit (wir schulden dem Nutzer)
    //  - amount < 0 => offene Forderung (Nutzer schuldet uns)
    //  - nur state == 'open'
    const advances = await prisma.advances.findMany({
      where: { state: "open" },
      select: { amount: true },
    });

    const amounts = advances.map((a) => toNumberSafely(a.amount));

    const userLiabilitiesList = amounts.filter((x) => x > 0);
    const userReceivablesList = amounts.filter((x) => x < 0).map((x) => Math.abs(x));

    const userLiabilities = {
      sum: String(userLiabilitiesList.reduce((a, b) => a + b, 0)),
      count: userLiabilitiesList.length,
      max: String(userLiabilitiesList.length ? Math.max(...userLiabilitiesList) : 0),
    };

    const userReceivables = {
      sum: String(userReceivablesList.reduce((a, b) => a + b, 0)),
      count: userReceivablesList.length,
      max: String(userReceivablesList.length ? Math.max(...userReceivablesList) : 0),
    };

    // Vermögensstände
    const clearingEligibleNegative = clearingAccounts
      .filter((c) => c.reimbursementEligible && toNumberSafely(c.account?.balance) < 0)
      .reduce((acc, c) => acc + Math.abs(toNumberSafely(c.account?.balance)), 0);

    const clearingEligiblePositive = clearingAccounts
      .filter((c) => c.reimbursementEligible && toNumberSafely(c.account?.balance) > 0)
      .reduce((acc, c) => acc + toNumberSafely(c.account?.balance), 0);

    const assetsFinal = bankTotal + userReceivablesList.reduce((a, b) => a + b, 0) + clearingEligibleNegative;
    const liabilitiesFinal = userLiabilitiesList.reduce((a, b) => a + b, 0) + clearingEligiblePositive;
    const netFinal = assetsFinal - liabilitiesFinal;

    return NextResponse.json({
      bankAccounts: bankAccountsDto,
      bankTotal: String(bankTotal),
      clearingAccounts: clearingAccountsDto,
      clearingTotal: String(clearingTotal),
      users: {
        liabilities: userLiabilities,
        receivables: userReceivables,
      },
      totals: {
        assets: String(assetsFinal),
        liabilities: String(liabilitiesFinal),
        net: String(netFinal),
      },
    });
  } catch (err: unknown) {
    console.error("/api/overview error", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
