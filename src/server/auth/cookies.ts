import { cookies } from "next/headers";
import { isProductionDeployment } from "../config/env";

function names(secure: boolean) {
  return secure
    ? { session: "__Host-kc_session", challenge: "__Secure-kc_challenge" }
    : { session: "kc_session", challenge: "kc_challenge" };
}

export async function readSessionCookie() {
  return (await cookies()).get(names(isProductionDeployment()).session)?.value;
}

export async function readChallengeCookie() {
  return (await cookies()).get(names(isProductionDeployment()).challenge)
    ?.value;
}

export async function setAuthCookie(
  kind: "session" | "challenge",
  token: string,
) {
  const secure = isProductionDeployment();
  const store = await cookies();
  const paths = { session: "/", challenge: "/login" };
  const other = kind === "session" ? "challenge" : "session";
  store.set(names(secure)[kind], token, {
    secure,
    httpOnly: true,
    sameSite: "lax",
    path: paths[kind],
    maxAge: kind === "session" ? 12 * 60 * 60 : 10 * 60,
  });
  store.set(names(secure)[other], "", {
    secure,
    path: paths[other],
    maxAge: 0,
  });
}

export async function clearAuthCookies() {
  const secure = isProductionDeployment();
  const store = await cookies();
  store.set(names(secure).session, "", { secure, path: "/", maxAge: 0 });
  store.set(names(secure).challenge, "", { secure, path: "/login", maxAge: 0 });
}
