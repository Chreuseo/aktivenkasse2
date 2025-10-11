// Zins-Berechnungsservice mit Overlap-Logik pro Account
// - Es werden nur ganze Tage berücksichtigt (floor)
// - Bei überlappenden Dues eines Accounts zählt pro Tag nur der maximale Betrag
// - Für Accounts mit interest=false werden Beiträge (Tage/Zinsen) 0 gesetzt

export type DueWithAccount = {
  id: number;
  accountId: number;
  amount: number; // Decimal als Number
  dueDate: Date;
  paid: boolean;
  paidAt: Date | null;
  interestBilled: boolean;
  account: { interest: boolean };
};

export type DueContribution = { days: number; interest: number };

export type InterestComputationResult = {
  perDue: Map<number, DueContribution>;
  perAccount: Map<number, { interest: number }>;
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysBetween(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeInterestContributions(dues: DueWithAccount[], today: Date, ratePercent: number): InterestComputationResult {
  const perDue = new Map<number, DueContribution>();
  const perAccount = new Map<number, { interest: number }>();

  // init per-due to zero
  for (const d of dues) perDue.set(d.id, { days: 0, interest: 0 });

  const groups = new Map<number, DueWithAccount[]>();
  for (const d of dues) {
    if (!groups.has(d.accountId)) groups.set(d.accountId, []);
    groups.get(d.accountId)!.push(d);
  }

  for (const [accountId, list] of groups.entries()) {
    const interestEnabled = !!list[0]?.account?.interest;
    if (!interestEnabled) {
      perAccount.set(accountId, { interest: 0 });
      continue;
    }

    // Build intervals: for unbilled dues (list given should already be filtered), interval = [dueDate, end)
    type Interval = { id: number; start: Date; end: Date; amount: number; dueDate: Date };
    const intervals: Interval[] = list.map((d) => ({
      id: d.id,
      start: startOfDay(d.dueDate),
      end: startOfDay(d.paid ? (d.paidAt || today) : today),
      amount: Number(d.amount),
      dueDate: d.dueDate,
    })).filter((iv) => iv.end.getTime() > iv.start.getTime());

    if (intervals.length === 0) {
      perAccount.set(accountId, { interest: 0 });
      continue;
    }

    // Collect boundaries
    const boundsSet = new Set<number>();
    for (const iv of intervals) {
      boundsSet.add(iv.start.getTime());
      boundsSet.add(iv.end.getTime());
    }
    const bounds = Array.from(boundsSet.values()).sort((a, b) => a - b);

    let accInterest = 0;

    for (let i = 0; i < bounds.length - 1; i++) {
      const segStart = new Date(bounds[i]);
      const segEnd = new Date(bounds[i + 1]);
      const segDays = daysBetween(segStart, segEnd);
      if (segDays <= 0) continue;

      // Active intervals covering segStart
      const act = intervals.filter((iv) => iv.start.getTime() <= segStart.getTime() && iv.end.getTime() > segStart.getTime());
      if (!act.length) continue;

      // pick max by amount; tie-breaker: earliest dueDate, then smallest id
      act.sort((a, b) => {
        if (b.amount !== a.amount) return b.amount - a.amount;
        const da = a.dueDate.getTime();
        const db = b.dueDate.getTime();
        if (da !== db) return da - db;
        return a.id - b.id;
      });
      const top = act[0];

      const segInterest = (top.amount * (ratePercent / 100) * (segDays / 365));
      const prev = perDue.get(top.id)!;
      perDue.set(top.id, { days: prev.days + segDays, interest: round2(prev.interest + segInterest) });
      accInterest += segInterest;
    }

    perAccount.set(accountId, { interest: round2(accInterest) });
  }

  return { perDue, perAccount };
}

