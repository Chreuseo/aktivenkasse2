export type TickItem = {
  id: string;
  price: string; // decimal string (e.g. "1.50")
};

export type TickRow = {
  qtyByItemId?: Record<string, number | string | undefined>;
};

export function normalizeDecimalString(input: string): string {
  // Allow both comma and dot as decimal separator.
  return (input ?? "").trim().replace(",", ".");
}

export function parsePriceToCents(price: string): number | null {
  const norm = normalizeDecimalString(price);
  if (!norm) return null;
  const num = Number(norm);
  if (!Number.isFinite(num)) return null;
  if (num <= 0) return null;
  // Round to cents.
  return Math.round(num * 100);
}

export function parseQty(qty: unknown): number {
  if (qty === null || qty === undefined || qty === "") return 0;
  const n = typeof qty === "number" ? qty : Number(String(qty));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

export function calcRowAmountCents(row: TickRow, items: TickItem[]): number {
  const qtyByItemId = row.qtyByItemId ?? {};
  let total = 0;
  for (const item of items) {
    const priceCents = parsePriceToCents(item.price) ?? 0;
    const qty = parseQty((qtyByItemId as any)[item.id]);
    total += priceCents * qty;
  }
  return total;
}

export function centsToAmountString(cents: number): string {
  const safe = Number.isFinite(cents) ? cents : 0;
  return (safe / 100).toFixed(2);
}

export function ensureQtyKeys<T extends TickRow>(rows: T[], items: TickItem[]): T[] {
  const ids = items.map(i => i.id);
  return rows.map(r => {
    const next: Record<string, number> = {};
    const existing = r.qtyByItemId ?? {};
    for (const id of ids) {
      next[id] = parseQty((existing as any)[id]);
    }
    return { ...(r as any), qtyByItemId: next };
  });
}

