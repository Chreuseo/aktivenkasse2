import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ResourceType, AuthorizationType } from "@/app/types/authorization";
import { checkPermission } from "@/services/authService";

export async function GET(req: Request) {
  const perm = await checkPermission(req, ResourceType.clearing_accounts, AuthorizationType.read_all);
  if (!perm.allowed) {
    return NextResponse.json({ error: "Keine Berechtigung für read_all auf clearing_accounts" }, { status: 403 });
  }

  try {
    const items = await prisma.clearingAccount.findMany({
      select: { id: true, name: true, accountId: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(items);
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: "Fehler beim Laden der Verrechnungskonten", detail: e?.message }, { status: 500 });
  }
}

