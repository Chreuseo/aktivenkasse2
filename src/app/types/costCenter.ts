export type CostCenter = {
  id: number;
  name: string;
  description?: string;
  /** Ob für diese Kostenstelle Zuwendungsbescheide ausgestellt werden (DB: CostCenter.is_donation). */
  is_donation?: boolean;
  earnings_expected: number;
  costs_expected: number;
  earnings_actual?: number;
  costs_actual?: number;
  nextCostCenter?: number;
};
