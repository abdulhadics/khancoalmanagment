import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { readOwnerBootstrapInput } from "../../src/server/auth/seed-first-owner";

describe("first Owner configuration", () => {
  it("requires explicit credentials and an identity", () => {
    expect(() => readOwnerBootstrapInput({})).toThrow(
      /OWNER_EMAIL, OWNER_USERNAME, OWNER_DISPLAY_NAME, OWNER_PASSWORD/,
    );
  });

  it("normalizes the login identity and preserves the supplied password", () => {
    const password = ` ${randomBytes(24).toString("hex")} `;
    const input = readOwnerBootstrapInput({
      OWNER_EMAIL: " Owner@Example.test ",
      OWNER_USERNAME: " Coal.Owner ",
      OWNER_DISPLAY_NAME: " Coal Company Owner ",
      OWNER_PASSWORD: password,
    });

    expect(input).toEqual({
      email: "owner@example.test",
      username: "coal.owner",
      displayName: "Coal Company Owner",
      password,
    });
  });

  it("reports the variable name without exposing invalid password input", () => {
    const shortPassword = randomBytes(4).toString("hex");
    const load = () =>
      readOwnerBootstrapInput({
        OWNER_EMAIL: "owner@example.test",
        OWNER_USERNAME: "coal.owner",
        OWNER_DISPLAY_NAME: "Coal Company Owner",
        OWNER_PASSWORD: shortPassword,
      });
    expect(load).toThrow(/OWNER_PASSWORD/);
    expect(load).not.toThrow(shortPassword);
  });
});
