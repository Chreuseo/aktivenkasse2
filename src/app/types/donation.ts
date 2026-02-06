export type DonationTypeUi = 'financial' | 'material' | 'waiver';

export interface DonationRow {
  id: number;
  date: string; // ISO
  description: string;
  type: DonationTypeUi;
  amount: number;
  transactionId?: number | null;
  userName?: string;
  processorName?: string;
}

export interface DonationCreateCandidate {
  transactionId: number;
  userId: number;
  userName: string;
  date: string; // ISO
  amount: number;
  balance: number;
  description: string;
}

export interface DonationCreateRequestRow {
  transactionId: number;
  description: string;
  type: DonationTypeUi;
}

export interface DonationCreateRequest {
  rows: DonationCreateRequestRow[];
}
