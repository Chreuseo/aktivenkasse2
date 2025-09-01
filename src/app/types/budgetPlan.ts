export type BudgetPlan = {
  id: number;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  state: string;
  firstCostCenter?: number;
};

export type BudgetPlanFormData = {
  name: string;
  description?: string;
  state: string;
};
