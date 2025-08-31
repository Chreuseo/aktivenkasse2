import React from "react";
import prisma from "@/lib/prisma";
import "@/app/css/tables.css";
import "@/app/css/infobox.css";

// Typ für Transaktionen
interface Transaction {
  id: number;
  amount: number;
  date: string;
  description: string;
  reference?: string;
  other?: {
    type: "user" | "bank" | "help_account";
    name: string;
    mail?: string;
    bank?: string;
    iban?: string;
  } | null;
}

export default async function UserDetailPage({ params }: { params: { id: string } }) {
  const user = await prisma.user.findUnique({
    where: { id: Number(params.id) },
    include: { account: true },
  });
  if (!user) return <div>Nutzer nicht gefunden</div>;

  const accountId = user.accountId;
  const transactionsRaw = await prisma.transaction.findMany({
    where: {
      OR: [
        { accountId1: accountId },
        { accountId2: accountId },
      ],
    },
    orderBy: { date: "desc" },
    include: {
      account1: {
        include: {
          users: true,
          bankAccounts: true,
          helpAccounts: true,
        },
      },
      account2: {
        include: {
          users: true,
          bankAccounts: true,
          helpAccounts: true,
        },
      },
    },
  });

  // @ts-ignore
    const transactions: Transaction[] = transactionsRaw.map(tx => {
    let isMain = tx.accountId1 === accountId;
    let amount = isMain ? (tx.account1Negative ? -Number(tx.amount) : Number(tx.amount)) : (tx.account2Negative ? -Number(tx.amount) : Number(tx.amount));
    let otherAccount = isMain ? tx.account2 : tx.account1;
    let otherType = otherAccount?.type;
    let otherDetails = null;
    if (otherAccount) {
      if (otherType === "user" && otherAccount.users?.length) {
        otherDetails = {
          type: "user",
          name: otherAccount.users[0].first_name + " " + otherAccount.users[0].last_name,
          mail: otherAccount.users[0].mail,
        };
      } else if (otherType === "bank" && otherAccount.bankAccounts?.length) {
        otherDetails = {
          type: "bank",
          name: otherAccount.bankAccounts[0].name,
          bank: otherAccount.bankAccounts[0].bank,
          iban: otherAccount.bankAccounts[0].iban,
        };
      } else if (otherType === "help_account" && otherAccount.helpAccounts?.length) {
        otherDetails = {
          type: "help_account",
          name: otherAccount.helpAccounts[0].name,
        };
      }
    }
    return {
      id: tx.id,
      amount,
      date: tx.date.toISOString(),
      description: tx.description,
      reference: tx.reference || undefined,
      other: otherDetails,
    };
  });

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1.2rem" }}>Nutzer-Detailansicht</h2>
      <div className="kc-infobox">
        <div style={{ fontSize: "1.2rem", fontWeight: 600 }}>{user.first_name} {user.last_name}</div>
        <div style={{ color: "var(--muted)", marginBottom: 4 }}>{user.mail}</div>
        <div style={{ fontWeight: 500 }}>Kontostand: <span style={{ color: "var(--primary)", fontWeight: 700 }}>{user.account?.balance !== undefined ? user.account.balance.toFixed(2) : "0.00"} €</span></div>
      </div>
      <h3 style={{ marginBottom: "0.8rem" }}>Transaktionen</h3>
      <table className="kc-table">
        <thead>
          <tr>
            <th>Betrag</th>
            <th>Datum</th>
            <th>Beschreibung</th>
            <th>Referenz</th>
            <th>Gegenkonto</th>
          </tr>
        </thead>
        <tbody>
          {transactions.length === 0 && (
            <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)" }}>Keine Transaktionen vorhanden</td></tr>
          )}
          {transactions.map((tx: Transaction) => (
            <tr key={tx.id} className="kc-row">
              <td style={{ color: tx.amount < 0 ? "#e11d48" : "#059669", fontWeight: 600 }}>{tx.amount.toFixed(2)} €</td>
              <td>{new Date(tx.date).toLocaleDateString()}</td>
              <td>{tx.description}</td>
              <td>{tx.reference || "-"}</td>
              <td>
                {tx.other ? (
                  <span>
                    {tx.other.type === "user" && `Nutzer: ${tx.other.name}`}
                    {tx.other.type === "bank" && `Bankkonto: ${tx.other.name} (${tx.other.bank})`}
                    {tx.other.type === "help_account" && `Hilfskonto: ${tx.other.name}`}
                  </span>
                ) : <span style={{ color: "var(--muted)" }}>-</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
