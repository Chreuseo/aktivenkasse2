import prisma from './prisma';

export enum clearing_account_roles {
    none = 'none',
    member = 'member',
    responsible = 'responsible',
}

export async function getClearingAccountRole(clearingAccountId: number, keycloakId: string): Promise<clearing_account_roles> {
    // Hole Nutzer per keycloak_id inklusive Rollen
    const user = await prisma.user.findUnique({
        where: { keycloak_id: keycloakId },
        select: { id: true, roles: { select: { name: true } } },
    });

    if (!user) return clearing_account_roles.none;

    // Prüfe, ob der Nutzer als Verantwortlicher eingetragen ist
    const clearing = await prisma.clearingAccount.findUnique({
        where: { id: clearingAccountId },
        select: { responsibleId: true },
    });

    if (clearing && clearing.responsibleId === user.id) return clearing_account_roles.responsible;

    // Prüfe, ob der Nutzer Mitglied des Clearing-Accounts ist
    const member = await prisma.clearingAccountMember.findUnique({
        where: { clearingAccountId_userId: { clearingAccountId, userId: user.id } },
        select: { userId: true },
    });

    if (member) return clearing_account_roles.member;

    return clearing_account_roles.none;
}