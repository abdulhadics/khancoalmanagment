"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import type { AuthActionState } from "@/components/auth/action-form";
import { auth } from "@/i18n/messages/auth-en";
import {
  beginOwnTotpEnrollment,
  changeOwnPassword,
  completeForcedPasswordChange,
  completeTotpChallenge,
  completeTotpEnrollment,
} from "@/server/auth/challenge-flows";
import {
  clearAuthCookies,
  readChallengeCookie,
  readSessionCookie,
  setAuthCookie,
} from "@/server/auth/cookies";
import { loginWithPassword } from "@/server/auth/login";
import { newPasswordSchema } from "@/server/auth/password";
import {
  completePasswordReset,
  makeSmtpResetSender,
  requestPasswordReset,
} from "@/server/auth/recovery";
import {
  assertActionOrigin,
  getRequestContext,
  requireActor,
} from "@/server/auth/request-context";
import { revokeAllSessions, revokeSession } from "@/server/auth/session";
import { lockAuthUser } from "@/server/auth/tokens";
import { parseAuthEncryptionKey } from "@/server/auth/totp";
import { readEnvironment } from "@/server/config/env";
import { getDatabase } from "@/server/db/client";
import { appendAuditEvent } from "@/server/repositories/audit-log";

const stagePaths = {
  success: "/",
  password_change: "/login/change-password",
  totp_challenge: "/login/verify",
  totp_enrollment: "/login/two-factor",
};

function input(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}

function error(message: string): AuthActionState {
  return { kind: "error", message };
}

async function finish(stage: {
  status: keyof typeof stagePaths;
  token: string;
}) {
  await setAuthCookie(
    stage.status === "success" ? "session" : "challenge",
    stage.token,
  );
  redirect(stagePaths[stage.status]);
}

export async function signIn(
  _state: AuthActionState,
  data: FormData,
): Promise<AuthActionState> {
  await assertActionOrigin();
  let result;
  try {
    result = await loginWithPassword({
      identifier: input(data, "identifier"),
      password: input(data, "password"),
      ...(await getRequestContext()),
    });
  } catch {
    return error(auth.unavailable);
  }
  if (result.status === "invalid") return error(auth.invalid);
  await finish(result);
  return null;
}

function passwordInput(
  data: FormData,
): { error: string } | { newPassword: string } {
  const newPassword = input(data, "newPassword");
  if (newPassword !== input(data, "confirmPassword")) {
    return { error: auth.passwordsDiffer } as const;
  }
  if (!newPasswordSchema.safeParse(newPassword).success) {
    return { error: auth.passwordHelp } as const;
  }
  return { newPassword } as const;
}

export async function forcePasswordChange(
  _state: AuthActionState,
  data: FormData,
): Promise<AuthActionState> {
  await assertActionOrigin();
  const values = passwordInput(data);
  if ("error" in values) return error(values.error);
  const challengeToken = await readChallengeCookie();
  if (!challengeToken) return error(auth.expired);
  const result = await completeForcedPasswordChange(getDatabase(), {
    ...values,
    challengeToken,
    enforceOwnerTotp: readEnvironment().DEPLOYMENT_ENV === "production",
    ...(await getRequestContext()),
  });
  if (!result) return error(auth.expired);
  await finish(result);
  return null;
}

async function submitTotp(
  data: FormData,
  enrolling: boolean,
): Promise<AuthActionState> {
  await assertActionOrigin();
  const challengeToken = await readChallengeCookie();
  const key = readEnvironment().AUTH_ENCRYPTION_KEY;
  if (!challengeToken || !key) return error(auth.invalidCode);
  const encryptionKey = parseAuthEncryptionKey(key);
  const fields = {
    challengeToken,
    encryptionKey,
    code: input(data, "code"),
    ...(await getRequestContext()),
  };
  const complete = enrolling ? completeTotpEnrollment : completeTotpChallenge;
  const result = await complete(getDatabase(), fields);
  if (!result) return error(auth.invalidCode);
  await finish(result);
  return null;
}

export async function verifyTotp(_state: AuthActionState, data: FormData) {
  return submitTotp(data, false);
}

export async function enrollTotp(_state: AuthActionState, data: FormData) {
  return submitTotp(data, true);
}

export async function forgotPassword(
  _state: AuthActionState,
  data: FormData,
): Promise<AuthActionState> {
  await assertActionOrigin();
  const env = readEnvironment();
  const identifier = input(data, "identifier");
  const context = await getRequestContext();
  if (env.SMTP_URL && env.SMTP_FROM) {
    const sendResetEmail = makeSmtpResetSender({
      smtpUrl: env.SMTP_URL,
      from: env.SMTP_FROM,
    });
    after(async () => {
      try {
        await requestPasswordReset(
          getDatabase(),
          { identifier, ...context },
          { origin: env.APP_ORIGIN, sendResetEmail },
        );
      } catch {
        console.error("Password reset delivery failed.");
      }
    });
  }
  return { kind: "success", message: auth.checkEmail };
}

export async function resetPassword(
  _state: AuthActionState,
  data: FormData,
): Promise<AuthActionState> {
  await assertActionOrigin();
  const values = passwordInput(data);
  if ("error" in values) return error(values.error);
  const result = await completePasswordReset(getDatabase(), {
    ...values,
    resetToken: input(data, "token"),
    ...(await getRequestContext()),
  });
  if (!result) return error(auth.expired);
  await clearAuthCookies();
  return { kind: "success", message: auth.resetSuccess };
}

async function signOutDevices(all: boolean) {
  await assertActionOrigin();
  const actor = await requireActor();
  const token = await readSessionCookie();
  const context = await getRequestContext();
  await getDatabase().$transaction(async (tx) => {
    if (all) {
      await lockAuthUser(tx, actor.userId);
      await revokeAllSessions(tx, actor.userId);
    } else {
      await revokeSession(tx, token);
    }
    await appendAuditEvent(tx, {
      actor: { type: "USER", id: actor.userId },
      area: "auth",
      action: all ? "session.revokeAll" : "session.logout",
      outcome: "SUCCESS",
      targetType: "user",
      targetId: actor.userId,
      ...context,
    });
  });
  await clearAuthCookies();
  redirect("/login");
}

export async function signOut() {
  await signOutDevices(false);
}

export async function signOutAll() {
  await signOutDevices(true);
}

export async function updateOwnPassword(
  _state: AuthActionState,
  data: FormData,
): Promise<AuthActionState> {
  await assertActionOrigin();
  const values = passwordInput(data);
  if ("error" in values) return error(values.error);
  const result = await changeOwnPassword(getDatabase(), {
    ...values,
    actor: await requireActor(),
    currentPassword: input(data, "currentPassword"),
    ...(await getRequestContext()),
  });
  if (!result) return error(auth.invalid);
  await setAuthCookie("session", result.token);
  return { kind: "success", message: auth.changeSuccess };
}

export async function beginTotp(
  _state: AuthActionState,
  data: FormData,
): Promise<AuthActionState> {
  await assertActionOrigin();
  if (!readEnvironment().AUTH_ENCRYPTION_KEY) return error(auth.unavailable);
  const result = await beginOwnTotpEnrollment(getDatabase(), {
    actor: await requireActor(),
    currentPassword: input(data, "currentPassword"),
    ...(await getRequestContext()),
  });
  if (!result) return error(auth.authenticatorUnavailable);
  await finish(result);
  return null;
}
