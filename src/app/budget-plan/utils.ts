// Gemeinsame Typen und Hilfsfunktionen für BudgetPlan und CostCenter
import type { BudgetPlan } from "@/app/types/budgetPlan";
import type { CostCenter } from "@/app/types/costCenter";

// Typdefinitionen ausgelagert nach types/budgetPlan.ts und types/costCenter.ts
export type { BudgetPlan } from "@/app/types/budgetPlan";
export type { CostCenter } from "@/app/types/costCenter";

export function getSortedCostCenters(plan: BudgetPlan | null, costCenters: CostCenter[]): CostCenter[] {
  if (!plan || !costCenters.length) return costCenters;
  const map = new Map<number, CostCenter>();
  costCenters.forEach(cc => map.set(cc.id, cc));
  const sorted: CostCenter[] = [];
  let currentId = plan.firstCostCenter;
  let visited = new Set<number>();
  while (currentId && map.has(currentId) && !visited.has(currentId)) {
    const cc = map.get(currentId)!;
    sorted.push(cc);
    visited.add(currentId);
    currentId = cc.nextCostCenter;
  }
  // Füge alle nicht verketteten am Ende hinzu
  costCenters.forEach(cc => {
    if (!visited.has(cc.id)) sorted.push(cc);
  });
  return sorted;
}
