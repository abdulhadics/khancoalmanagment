import { notFound } from "next/navigation";
import { can } from "@/domain/permissions";
import { requireActor } from "@/server/auth/request-context";

export async function requireStaffManager() {
  const actor = await requireActor();
  if (!can(actor.roleCode, "staff.manage")) notFound();
  return actor;
}
