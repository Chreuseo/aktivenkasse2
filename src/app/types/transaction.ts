export type Transaction = {
    id: number;
    amount: number;
    date: string;
    description: string;
    reference?: string;
    processed?: boolean;
    other?: {
        type: "user" | "bank" | "clearing_account";
        name: string;
        mail?: string;
        bank?: string;
        iban?: string;
    } | null;
    main?: {
        type: "user" | "bank" | "clearing_account";
        name: string;
        mail?: string;
        bank?: string;
        iban?: string;
    } | null;
    attachmentId?: number; // ID des Belegs
    receiptUrl?: string; // URL zum Download des Belegs
    costCenterLabel?: string; // Anzeigeformat: "Budgetplan - Kostenstelle"
    bulkId?: number; // ID der zugehörigen Sammeltransaktion (falls vorhanden)
    // Neu: IDs für Filterung
    costCenterId?: number;
    budgetPlanId?: number;
};
