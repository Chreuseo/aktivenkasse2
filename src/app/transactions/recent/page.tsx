import React from "react";
import prisma from "@/lib/prisma";
import "@/app/css/tables.css";
import { Transaction } from "@/app/types/transaction";
import GeneralTransactionTable from "@/app/components/GeneralTransactionTable";

function inferOtherFromAccount(acc: any): Transaction["other"] {
  if (!acc) return null;
  if (acc.users && acc.users.length > 0) {
    const u = acc.users[0];
    return { type: "user", name: `${u.first_name} ${u.last_name}`, mail: u.mail };
  }
  if (acc.bankAccounts && acc.bankAccounts.length > 0) {
    const b = acc.bankAccounts[0];
    return { type: "bank", name: b.name, bank: b.bank, iban: b.iban };
  }
  if (acc.clearingAccounts && acc.clearingAccounts.length > 0) {
    const c = acc.clearingAccounts[0];
    return { type: "clearing_account", name: c.name };
  }
  return null;
}

export default async function RecentTransactionsPage() {
  const txsRaw = await prisma.transaction.findMany({
    orderBy: { date: "desc" },
    take: 20,
    include: {
      account: { include: { users: true, bankAccounts: true, clearingAccounts: true } },
      counter_transaction: { include: { account: { include: { users: true, bankAccounts: true, clearingAccounts: true } } } },
      attachment: true,
      costCenter: { include: { budget_plan: true } },
    } as any,
  });

  const transactions: Transaction[] = txsRaw.map((tx: any) => {
    const main = tx.account ? inferOtherFromAccount(tx.account) : null;
    const other = tx.counter_transaction ? inferOtherFromAccount(tx.counter_transaction.account) : null;
    const costCenterLabel = tx.costCenter && tx.costCenter.budget_plan ? `${tx.costCenter.budget_plan.name} - ${tx.costCenter.name}` : undefined;
    return {
      id: tx.id,
      amount: Number(tx.amount),
      date: (tx.date ?? tx.date_valued ?? new Date()).toISOString(),
      description: tx.description,
      reference: tx.reference || undefined,
      other,
      main,
      attachmentId: tx.attachmentId || undefined,
      receiptUrl: tx.attachmentId ? `/api/transactions/${tx.id}/receipt` : undefined,
      costCenterLabel,
    };
  });

  return (
    <div style={{ maxWidth: 1000, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1rem" }}>Letzte 20 Buchungen (nach Erstellungsdatum)</h2>
      <GeneralTransactionTable transactions={transactions} />
    </div>
  );
}
