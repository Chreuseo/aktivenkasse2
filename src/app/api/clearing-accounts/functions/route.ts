import { NextResponse, NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/services/authService";
import { AuthorizationType, ResourceType } from "@/app/types/authorization";
import { extractUserFromAuthHeader } from "@/lib/serverUtils";
import { createPairedTransactions, createTransactionWithBalance } from "@/services/transactionService";

function roundAwayFromZeroCents(n: number): number {
  if (!isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  const v = Math.ceil(Math.abs(n) * 100 - 1e-9) / 100; // numeric guard
  return sign * v;
}

type PostBody = {
  clearingAccountId: number;
  viaType: "members" | "budget";
  amount: number;
  budgetPlanId?: number;
  costCenterId?: number;
};

export async function GET(req: NextRequest) {
  // permission: read_all on clearing_accounts
  const perm = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.read_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für read_all auf clearing_accounts" }, { status: 403 });
  }

  const clearingAccounts = await prisma.clearingAccount.findMany({
    include: {
      responsible: true,
      account: { select: { balance: true } },
      members: { include: { user: true } },
    },
    orderBy: { id: "asc" },
  });

  const result = clearingAccounts.map(ca => ({
    id: ca.id,
    name: ca.name,
    responsible: ca.responsible ? `${ca.responsible.first_name} ${ca.responsible.last_name}` : null,
    balance: ca.account?.balance ? Number(ca.account.balance) : 0,
    reimbursementEligible: ca.reimbursementEligible,
    members: ca.members
      .map(m => m.user ? { id: m.user.id, name: `${m.user.first_name} ${m.user.last_name}`, mail: m.user.mail } : null)
      .filter((x): x is { id: number; name: string; mail: string } => Boolean(x)),
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  // We operate on transactions, require write_all on transactions
  const perm = await checkPermission(req, ResourceType.transactions, AuthorizationType.write_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für write_all auf transactions" }, { status: 403 });
  }

  let bodyUnknown: unknown;
  try {
    bodyUnknown = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige JSON-Daten" }, { status: 400 });
  }

  const { clearingAccountId, viaType, amount, budgetPlanId, costCenterId } = bodyUnknown as PostBody;
  if (!Number.isFinite(clearingAccountId)) {
    return NextResponse.json({ error: "clearingAccountId fehlt oder ungültig" }, { status: 400 });
  }
  if (!viaType || !["members", "budget"].includes(viaType)) {
    return NextResponse.json({ error: "viaType muss 'members' oder 'budget' sein" }, { status: 400 });
  }
  const amt = Number(amount);
  if (!isFinite(amt) || amt === 0) {
    return NextResponse.json({ error: "Betrag muss eine von 0 verschiedene Zahl sein" }, { status: 400 });
  }

  const rawHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const { userId } = extractUserFromAuthHeader((rawHeader ?? undefined) as string | undefined);
  if (!userId) {
    return NextResponse.json({ error: "Keine UserId im Token" }, { status: 403 });
  }
  const currentUser = !isNaN(Number(userId))
    ? await prisma.user.findUnique({ where: { id: Number(userId) } })
    : await prisma.user.findUnique({ where: { keycloak_id: String(userId) } });
  if (!currentUser) {
    return NextResponse.json({ error: "Benutzer nicht gefunden" }, { status: 403 });
  }

  const clearing = await prisma.clearingAccount.findUnique({
    where: { id: Number(clearingAccountId) },
    include: { account: true, members: { include: { user: { include: { account: true } } } } },
  });
  if (!clearing || !clearing.account) {
    return NextResponse.json({ error: "Verrechnungskonto nicht gefunden" }, { status: 404 });
  }

  // Budget mode validations
  if (viaType === "budget") {
    if (!budgetPlanId || !costCenterId) {
      return NextResponse.json({ error: "Budgetplan und Kostenstelle sind erforderlich" }, { status: 400 });
    }
    const plan = await prisma.budgetPlan.findUnique({ where: { id: Number(budgetPlanId) }, select: { id: true, state: true } });
    if (!plan) return NextResponse.json({ error: "Budgetplan nicht gefunden" }, { status: 404 });
    if (plan.state !== "active") return NextResponse.json({ error: "Budgetplan ist nicht aktiv" }, { status: 409 });
    const cc = await prisma.costCenter.findUnique({ where: { id: Number(costCenterId) } });
    if (!cc) return NextResponse.json({ error: "Kostenstelle nicht gefunden" }, { status: 404 });
    if (cc.budget_planId !== Number(budgetPlanId)) {
      return NextResponse.json({ error: "Kostenstelle gehört nicht zum Budgetplan" }, { status: 400 });
    }
  }

  try {
    const result = await prisma.$transaction(async (p) => {
      const caAccount = await p.account.findUnique({ where: { id: clearing.accountId } });
      if (!caAccount) throw new Error("Verrechnungskonto-Account fehlt");
      let caBalance = Number(caAccount.balance);

      if (viaType === "members") {
        if (!clearing.members || clearing.members.length === 0) {
          return NextResponse.json({ error: "Keine Mitglieder vorhanden" }, { status: 400 });
        }
        const perPerson = roundAwayFromZeroCents(amt);
        const action = perPerson >= 0 ? "Auszahlung" : "Einzug";
        const desc = `${action} Verrechnungskonto ${clearing.name}`;

        for (const m of clearing.members) {
          if (!m.user || !m.user.account) continue;
          const userAcc = await p.account.findUnique({ where: { id: m.user.accountId } });
          if (!userAcc) continue;

          const deltaClearing = perPerson >= 0 ? -Math.abs(perPerson) : Math.abs(perPerson);
          const deltaUser = -deltaClearing; // opposite sign

          // Paartransaktion: user <-> clearing
          await createPairedTransactions(p as any, {
            account1Id: m.user.accountId,
            amount1: deltaUser,
            account2Id: clearing.accountId,
            amount2: deltaClearing,
            description: desc,
            createdById: currentUser.id,
            reference: undefined,
            dateValued: undefined,
            attachmentId: null,
          });

          // lokalen Saldo fortschreiben (Service hat DB bereits aktualisiert)
          caBalance += deltaClearing;
        }
        return { ok: true, action: action, newBalance: caBalance };
      } else {
        // via budget cost center: single-sided transaction on clearing account
        const action = amt >= 0 ? "Auszahlung" : "Einzug"; // positive decreases clearing, negative increases
        const desc = `Ausgleich Verrechnungskonto ${clearing.name}`;
        const delta = amt >= 0 ? -Math.abs(amt) : Math.abs(amt);
        await createTransactionWithBalance(p as any, {
          accountId: clearing.accountId,
          amount: delta,
          description: desc,
          createdById: currentUser.id,
          reference: undefined,
          dateValued: undefined,
          attachmentId: null,
          costCenterId: Number(costCenterId),
        });
        const newBalance = caBalance + delta;
        return { ok: true, action: action, newBalance };
      }
    });

    // If result is NextResponse (e.g., validation during transaction), unwrap
    if (result instanceof NextResponse) return result;
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    console.error("Fehler beim Ausführen der Funktion", e);
    return NextResponse.json({ error: "Fehler bei der Verbuchung" }, { status: 500 });
  }
}
