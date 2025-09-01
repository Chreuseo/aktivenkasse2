export enum ResourceType {
  budget_plan = "budget_plan", // vorher: household
  userAuth = "userAuth",
  clearing_accounts = "clearing_accounts",
  bank_accounts = "bank_accounts",
  transactions = "transactions",
}

export enum AuthorizationType {
  none = "none",
  read_own = "read_own",
  read_all = "read_all",
  write_all = "write_all",
}
