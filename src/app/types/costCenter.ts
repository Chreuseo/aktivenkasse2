export type CostCenter = {
  id: number;
  name: string;
  description?: string;
  earnings_expected: number;
  costs_expected: number;
  earnings_actual?: number;
  costs_actual?: number;
  nextCostCenter?: number;
};

