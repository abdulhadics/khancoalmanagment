import { NextResponse } from "next/server";
import { can, PermissionDenied } from "@/domain/permissions";
import {
  BackupDownloadError,
  createBackupDownload,
} from "@/server/admin/backups";
import {
  getCurrentActor,
  getRequestContext,
} from "@/server/auth/request-context";
import { readEnvironment } from "@/server/config/env";
import { getDatabase } from "@/server/db/client";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { APP_ORIGIN } = readEnvironment();
  if (request.headers.get("origin") !== APP_ORIGIN) {
    return new Response(null, { status: 403 });
  }
  const actor = await getCurrentActor();
  if (!actor || !can(actor.roleCode, "admin.backups")) {
    return new Response(null, { status: 404 });
  }
  try {
    const archive = await createBackupDownload(
      getDatabase(),
      actor,
      await getRequestContext(),
    );
    return new Response(archive.stream, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${archive.name}"`,
        "Content-Length": String(archive.size),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof PermissionDenied)
      return new Response(null, { status: 404 });
    if (!(error instanceof BackupDownloadError)) throw error;
    return NextResponse.redirect(
      new URL(`/admin/backups?download=${error.code}`, APP_ORIGIN),
      303,
    );
  }
}
