import React from "react";
import prisma from "@/lib/prisma";
import "@/app/css/tables.css";
import "@/app/css/infobox.css";
import { Transaction } from "@/app/types/transaction";
import TransactionTable from "@/app/components/TransactionTable";

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

export default async function UserDetailPage({ params }: { params: { id: string } }) {
  const user = await prisma.user.findUnique({
    where: { id: Number(params.id) },
    include: { account: true },
  });
  if (!user) return <div>Nutzer nicht gefunden</div>;

  const accountId = user.accountId;
  const transactionsRaw = await prisma.transaction.findMany({
    where: { accountId },
    orderBy: { date: "desc" },
    include: {
      counter_transaction: {
        include: {
          account: { include: { users: true, bankAccounts: true, clearingAccounts: true } },
        },
      },
      attachment: true,
    },
  });

  const transactions: Transaction[] = transactionsRaw.map((tx: any) => {
    const other = tx.counter_transaction ? inferOtherFromAccount(tx.counter_transaction.account) : null;
    return {
      id: tx.id,
      amount: Number(tx.amount),
      date: (tx.date_valued ?? tx.date).toISOString(),
      description: tx.description,
      reference: tx.reference || undefined,
      other,
      attachmentId: tx.attachmentId || undefined,
      receiptUrl: tx.attachmentId ? `/api/attachments/${tx.attachmentId}/download` : undefined,
    };
  });

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1.2rem" }}>Nutzer-Detailansicht</h2>
      <div className="kc-infobox">
        <div style={{ fontSize: "1.2rem", fontWeight: 600 }}>{user.first_name} {user.last_name}</div>
        <div style={{ color: "var(--muted)", marginBottom: 4 }}>{user.mail}</div>
        <div style={{ fontWeight: 500 }}>Kontostand: <span style={{ color: "var(--primary)", fontWeight: 700 }}>{user.account?.balance !== undefined ? Number(user.account.balance).toFixed(2) : "0.00"} €</span></div>
      </div>
      <h3 style={{ marginBottom: "0.8rem" }}>Transaktionen</h3>
      <TransactionTable transactions={transactions} />
    </div>
  );
}
