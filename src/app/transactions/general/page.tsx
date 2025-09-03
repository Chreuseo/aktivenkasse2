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

export default async function GeneralTransactionsPage() {
  // Finde alle Transaktionen ohne Gegenkonto (weder referenziert noch referenzierend)
  const txsRaw = await prisma.transaction.findMany({
    where: {
      counter_transactionId: null,
      counter_transactions: { none: {} },
    },
    orderBy: { date: "desc" },
    include: {
      account: { include: { users: true, bankAccounts: true, clearingAccounts: true } },
      attachment: true,
    } as any,
  });

  const transactions: Transaction[] = txsRaw.map((tx: any) => {
    const main = tx.account ? inferOtherFromAccount(tx.account) : null;
    return {
      id: tx.id,
      // Beträge aus Sicht der Kasse negiert anzeigen
      amount: -Number(tx.amount),
      date: (tx.date ?? tx.date_valued ?? new Date()).toISOString(),
      description: tx.description,
      reference: tx.reference || undefined,
      other: null, // kein Gegenkonto vorhanden
      main,
      attachmentId: tx.attachmentId || undefined,
      receiptUrl: tx.attachmentId ? `/api/transactions/${tx.id}/receipt` : undefined,
    };
  });

  return (
    <div style={{ maxWidth: 1000, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1rem" }}>Alle Buchungen ohne Gegenkonto (Beträge negiert)</h2>
      <GeneralTransactionTable transactions={transactions} />
    </div>
  );
}

