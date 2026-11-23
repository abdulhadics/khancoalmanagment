import { isIP } from "node:net";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { isVercelDeployment, readEnvironment } from "../config/env";
import {
  internalRequestIdHeader,
  requestIdFromHeader,
} from "../observability/requests";
import { readSessionCookie } from "./cookies";
import { getSession } from "./session";

export const getCurrentActor = cache(async () => {
  const token = await readSessionCookie();
  return token ? getSession(token) : null;
});

export async function requireActor() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");
  return actor;
}

export async function assertActionOrigin() {
  const request = await headers();
  const origin = request.get("origin");
  if (!origin) return;

  const configuredOrigin = readEnvironment().APP_ORIGIN;
  if (configuredOrigin && origin === configuredOrigin) return;

  const host = request.get("x-forwarded-host") ?? request.get("host");
  const proto = request.get("x-forwarded-proto") ?? "https";
  if (
    host &&
    (origin === `${proto}://${host}` ||
      origin === `https://${host}` ||
      origin === `http://${host}`)
  ) {
    return;
  }

  throw new Error("Request origin was rejected.");
}

export async function getRequestContext() {
  const request = await headers();
  const deployed = readEnvironment().DEPLOYMENT_ENV === "production";
  const proxyAddress = request.get(
    isVercelDeployment() ? "x-vercel-forwarded-for" : "x-kc-client-ip",
  );
  const ip =
    deployed && proxyAddress && isIP(proxyAddress) ? proxyAddress : undefined;
  return {
    requestId: requestIdFromHeader(request.get(internalRequestIdHeader)),
    ip,
    ipAddress: ip,
  };
}
