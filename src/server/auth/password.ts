import { hash } from "@node-rs/argon2";
import { z } from "zod";

export const newPasswordSchema = z.string().refine(
  (password) => {
    if (password.length > 256) return false;
    const characters = Array.from(password).length;
    return characters >= 15 && characters <= 128 && /\S/u.test(password);
  },
  {
    message: "Use 15 to 128 characters and include a non-whitespace character.",
  },
);

export function hashPassword(password: string): Promise<string> {
  // The pinned library uses Argon2id and generates a fresh salt by default.
  return hash(password, {
    memoryCost: 19 * 1024,
    timeCost: 2,
    parallelism: 1,
  });
}
