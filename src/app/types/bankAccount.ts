export type BankAccount = {
  id: number;
  name: string;
  bank: string;
  iban: string;
  balance: number;
  bic?: string | null;
};

