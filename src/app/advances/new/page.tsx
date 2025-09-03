import prisma from "@/lib/prisma";
import NewAdvanceForm from "./NewAdvanceForm";

export default async function NewAdvancePage() {
  const accounts = await prisma.clearingAccount.findMany({ select: { id: true, name: true } });
  return <NewAdvanceForm accounts={accounts.map(a => ({ id: a.id, name: a.name }))} />;
}
