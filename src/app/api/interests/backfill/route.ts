import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkPermission } from "@/services/authService";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";

const TYPES = ["user", "clearing_account", "bank"] as const;
type AccType = (typeof TYPES)[number];

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseYmd(s: unknown): Date | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

// GET ?type=...            -> Konten des Typs
// GET ?accountId=...       -> Vorschlag von Fälligkeiten (Zeiträume mit negativem Kontostand)
export async function GET(req: NextRequest) {
  const perm = await checkPermission(req as unknown as Request, ResourceType.transactions, AuthorizationType.read_all);
  if (!perm.allowed) return NextResponse.json({ error: "Nicht erlaubt" }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const accountIdStr = sp.get("accountId");

  if (!accountIdStr) {
    const type = sp.get("type") as AccType | null;
    if (!type || !TYPES.includes(type)) return NextResponse.json({ error: "Ungültiger Kontotyp" }, { status: 400 });
    const accounts = await prisma.account.findMany({
      where: { type },
      include: { users: true, clearingAccounts: true, bankAccounts: true },
    });
    const items = accounts
      .map((a) => ({
        accountId: a.id,
        label:
          a.users[0] ? `${a.users[0].first_name} ${a.users[0].last_name}`.trim()
          : a.clearingAccounts[0]?.name || a.bankAccounts[0]?.name || `Konto #${a.id}`,
      }))
      .sort((x, y) => x.label.localeCompare(y.label, "de"));
    return NextResponse.json(items);
  }

  const accountId = Number(accountIdStr);
  if (!Number.isFinite(accountId)) return NextResponse.json({ error: "Ungültige accountId" }, { status: 400 });

  const txs = await prisma.transaction.findMany({
    where: { accountId },
    orderBy: [{ date_valued: "asc" }, { id: "asc" }],
    select: { date_valued: true, accountValueAfter: true },
  });

  // Zeitraum pro Kontostand; mehrere Buchungen am selben Tag -> letzter Stand zählt
  const raw: { from: string; to: string | null; amount: number }[] = [];
  for (let i = 0; i < txs.length; i++) {
    const from = ymd(txs[i].date_valued);
    const to = i + 1 < txs.length ? ymd(txs[i + 1].date_valued) : null;
    if (to !== null && to <= from) continue;
    const bal = Number(txs[i].accountValueAfter);
    raw.push({ from, to, amount: bal < 0 ? Math.round(-bal * 100) / 100 : 0 });
  }
  const merged: typeof raw = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && last.to === r.from && last.amount === r.amount) last.to = r.to;
    else merged.push({ ...r });
  }

  const today = ymd(new Date());
  const existing = await prisma.dues.findMany({ where: { accountId }, select: { dueDate: true, amount: true } });
  const existingKeys = new Set(existing.map((d) => `${ymd(d.dueDate)}|${Number(d.amount).toFixed(2)}`));

  const rows = merged
    .filter((r) => r.amount > 0 && r.from <= today)
    .map((r) => {
      const to = r.to && r.to > today ? null : r.to;
      return { ...r, to, exists: existingKeys.has(`${r.from}|${r.amount.toFixed(2)}`) };
    });
  return NextResponse.json({ rows });
}

// POST { accountId, items: [{ from, to|null, amount }] } -> legt Fälligkeiten an
export async function POST(req: NextRequest) {
  const perm = await checkPermission(req as unknown as Request, ResourceType.transactions, AuthorizationType.write_all);
  if (!perm.allowed) return NextResponse.json({ error: "Nicht erlaubt" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const accountId = Number(body?.accountId);
  if (!Number.isFinite(accountId) || !Array.isArray(body?.items)) {
    return NextResponse.json({ error: "accountId und items erforderlich" }, { status: 400 });
  }
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { id: true } });
  if (!account) return NextResponse.json({ error: "Konto nicht gefunden" }, { status: 404 });

  const data: { accountId: number; amount: string; dueDate: Date; paid: boolean; paidAt: Date | null }[] = [];
  const today = parseYmd(ymd(new Date()))!;
  for (const it of body.items) {
    const from = parseYmd(it?.from);
    const requestedTo = it?.to ? parseYmd(it.to) : null;
    const amount = Number(it?.amount);
    if (
      !from ||
      (it?.to && !requestedTo) ||
      from > today ||
      (requestedTo && requestedTo <= from) ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return NextResponse.json({ error: "Ungültiger Eintrag" }, { status: 400 });
    }
    const to = requestedTo && requestedTo <= today ? requestedTo : null;
    data.push({ accountId, amount: amount.toFixed(2), dueDate: from, paid: !!to, paidAt: to });
  }
  if (!data.length) return NextResponse.json({ created: 0 });

  const res = await prisma.$transaction(async (p) => {
    const existing = await p.dues.findMany({
      where: { accountId },
      select: { id: true, amount: true, dueDate: true, paid: true, paidAt: true, interestBilled: true },
    });
    type Interval = { start: Date; end: Date | null };
    const dayStart = (date: Date) => {
      const day = new Date(date);
      day.setHours(0, 0, 0, 0);
      return day;
    };
    const overlaps = (a: Interval, b: Interval) =>
      (!a.end || b.start < a.end) && (!b.end || a.start < b.end);
    const earlierEnd = (a: Date | null, b: Date | null) =>
      a && b ? (a < b ? a : b) : a ?? b;
    const subtract = (interval: Interval, cuts: Interval[]): Interval[] => {
      let cursor: Date | null = interval.start;
      const fragments: Interval[] = [];
      const orderedCuts = cuts
        .filter((cut) => overlaps(interval, cut))
        .sort((a, b) => a.start.getTime() - b.start.getTime());

      for (const cut of orderedCuts) {
        if (!cursor) break;
        if (cut.start > cursor) {
          const end = earlierEnd(interval.end, cut.start);
          if (end && end > cursor) fragments.push({ start: cursor, end });
        }
        if (!cut.end) {
          cursor = null;
          break;
        }
        if (cut.end > cursor) cursor = cut.end;
        if (interval.end && cursor >= interval.end) {
          cursor = null;
          break;
        }
      }
      if (cursor && (!interval.end || cursor < interval.end)) {
        fragments.push({ start: cursor, end: interval.end });
      }
      return fragments;
    };

    const existingIntervals = existing.map((due) => ({
      due,
      interval: {
        start: dayStart(due.dueDate),
        end: due.paid && due.paidAt ? dayStart(due.paidAt) : null,
      },
    }));
    const itemIntervals = data.map((item) => ({
      item,
      interval: { start: dayStart(item.dueDate), end: item.paidAt ? dayStart(item.paidAt) : null },
    }));
    const additions: typeof data = [];
    const incomingIntervals = itemIntervals.map(({ interval }) => interval);

    for (const { due, interval } of existingIntervals) {
      if (!incomingIntervals.some((itemInterval) => overlaps(interval, itemInterval))) continue;

      if (!due.interestBilled) {
        const fragments = subtract(interval, incomingIntervals);
        for (const fragment of fragments) {
          additions.push({
            accountId,
            amount: Number(due.amount).toFixed(2),
            dueDate: fragment.start,
            paid: due.paid || !!fragment.end,
            paidAt: fragment.end,
          });
        }
      }

      const overlappingEnds = incomingIntervals
        .filter((itemInterval) => overlaps(interval, itemInterval))
        .map((itemInterval) => earlierEnd(interval.end, itemInterval.end))
        .filter((end): end is Date => !!end)
        .sort((a, b) => b.getTime() - a.getTime());
      await p.dues.update({
        where: { id: due.id },
        data: {
          paid: true,
          paidAt: overlappingEnds[0] ?? today,
          interestBilled: true,
        },
      });
    }

    const occupied = [
      ...existingIntervals.map(({ interval }) => interval),
      ...additions.map(({ dueDate, paidAt }) => ({
        start: dueDate,
        end: paidAt,
      })),
    ];
    for (const { item, interval } of itemIntervals) {
      for (const fragment of subtract(interval, occupied)) {
        additions.push({
          ...item,
          dueDate: fragment.start,
          paid: !!fragment.end,
          paidAt: fragment.end,
        });
        occupied.push(fragment);
      }
    }

    const created = additions.length ? await p.dues.createMany({ data: additions }) : { count: 0 };
    return created;
  });
  return NextResponse.json({ created: res.count });
}
