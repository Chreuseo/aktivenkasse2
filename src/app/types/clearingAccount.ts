export type User = {
    id: number;
    first_name: string;
    last_name: string;
    mail: string;
};

export type Member = {
    id: number;
    name: string;
    mail: string;
};

export type ClearingAccount = {
    id: number;
    name: string;
    responsible: string | null;
    responsibleMail?: string | null;
    balance: number;
    reimbursementEligible: boolean;
    members: Member[];
};
