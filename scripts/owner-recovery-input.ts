import { newPasswordSchema } from "../src/server/auth/password";

export class OwnerRecoveryError extends Error {}

export async function readRecoveryPassword() {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    text += chunk;
    if (text.length > 1024)
      throw new OwnerRecoveryError("The password is too long.");
  }
  const password = newPasswordSchema.safeParse(text.replace(/\r?\n$/, ""));
  if (!password.success)
    throw new OwnerRecoveryError("Enter a password of 15 to 128 characters.");
  return password.data;
}
