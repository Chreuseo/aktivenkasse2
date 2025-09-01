import React from "react";
import Link from "next/link";
import "@/app/css/tables.css";
import prisma from "@/lib/prisma";
import { ClearingAccount, Member } from "@/app/types/clearingAccount";

export default async function ClearingAccountsPage() {
  const clearingAccounts = await prisma.clearingAccount.findMany({
    include: {
      responsible: true,
      account: { select: { balance: true } },
      members: { include: { user: true } },
    },
  });

  const accounts: ClearingAccount[] = clearingAccounts.map((ca: any) => ({
    id: ca.id,
    name: ca.name,
    responsible: ca.responsible ? `${ca.responsible.first_name} ${ca.responsible.last_name}` : null,
    responsibleMail: ca.responsible ? ca.responsible.mail : null,
    balance: ca.account?.balance ? Number(ca.account.balance) : 0,
    reimbursementEligible: ca.reimbursementEligible,
    members: (ca.members as any[])
      .map((m: any) => m.user ? { id: m.user.id, name: `${m.user.first_name} ${m.user.last_name}`, mail: m.user.mail } : null)
      .filter(Boolean) as Member[],
  }));

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", padding: "1rem" }}>
      <h2 style={{ marginBottom: "1.2rem" }}>Verrechnungskonten Übersicht</h2>
      <table className="kc-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Verantwortlicher</th>
            <th>Kontostand</th>
            <th>Erstattungsberechtigt</th>
            <th>Mitglieder</th>
            <th>Bearbeiten</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {accounts.length === 0 && (
            <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)" }}>Keine Verrechnungskonten vorhanden</td></tr>
          )}
          {accounts.map((acc: ClearingAccount) => (
            <tr key={acc.id} className="kc-row">
              <td>{acc.name}</td>
              <td>{acc.responsible || <span style={{ color: "var(--muted)" }}>-</span>}</td>
              <td style={{ fontWeight: 600, color: "var(--primary)" }}>{acc.balance.toFixed(2)} €</td>
              <td>{acc.reimbursementEligible ? "Ja" : "Nein"}</td>
              <td>{acc.members.length > 0 ? acc.members.map(m => m.name).join(", ") : <span style={{ color: "var(--muted)" }}>-</span>}</td>
              <td><Link href={`/clearing-accounts/${acc.id}/edit`}><button className="button">Bearbeiten</button></Link></td>
              <td><Link href={`/clearing-accounts/${acc.id}`}><button className="button">Details</button></Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
