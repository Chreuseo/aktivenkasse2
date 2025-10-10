export type BankAccount = {
  id: number;
  name: string;
  owner: string; // Kontoinhaber
  bank: string;
  iban: string;
  balance: number;
  bic?: string | null;
  // Zahlungshinweis-Checkbox
  payment_method?: boolean;
  // Optional im Client verwendbar
  create_girocode?: boolean;
};
