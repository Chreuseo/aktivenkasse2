export type AdvanceState = "open" | "cancelled" | "accepted" | "rejected";

export function advanceStateLabel(state: AdvanceState): string {
  switch (state) {
    case "open":
      return "Offen";
    case "cancelled":
      return "Abgebrochen";
    case "accepted":
      return "Akzeptiert";
    case "rejected":
      return "Abgelehnt";
    default:
      return String(state);
  }
}

export type AdvanceListItem = {
  id: number;
  date_advance: string; // ISO
  description: string;
  amount: string; // als String vom Server (Decimal)
  clearingAccount: { id: number; name: string } | null;
  attachmentId: number | null;
  state: AdvanceState;
  reviewer: { first_name: string; last_name: string } | null;
  user?: string; // zugeordneter Nutzer (Vollname)
  canCancel: boolean;
  receiptUrl?: string;
};
