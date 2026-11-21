import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { readEnvironment } from "../config/env";
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
  if (request.get("origin") !== readEnvironment().APP_ORIGIN) {
    throw new Error("Request origin was rejected.");
  }
}

export async function getRequestContext() {
  const request = await headers();
  const deployed = readEnvironment().DEPLOYMENT_ENV === "production";
  const proxyAddress = request.get("x-kc-client-ip");
  const ip =
    deployed && proxyAddress && isIP(proxyAddress) ? proxyAddress : undefined;
  return { requestId: randomUUID(), ip, ipAddress: ip };
}
