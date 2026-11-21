export const recoveryEmail = {
  subject: "Reset your KhanCoalSupplier password",
  text: (resetUrl: string, validMinutes: number) =>
    [
      "Use this link to reset your KhanCoalSupplier password.",
      "",
      resetUrl,
      "",
      `The link expires in ${validMinutes} minutes and can be used once.`,
      "If you did not request a password reset, you can ignore this message.",
    ].join("\n"),
};
