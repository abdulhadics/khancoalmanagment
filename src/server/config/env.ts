import { z } from "zod";

function urlWithScheme(value: string, schemes: readonly string[]) {
  try {
    const url = new URL(value);
    return schemes.includes(url.protocol) &&
      value.toLowerCase().startsWith(`${url.protocol}//`) &&
      url.hostname
      ? url
      : null;
  } catch {
    return null;
  }
}

const appOrigin = z.string().transform((value, context) => {
  const url = urlWithScheme(value, ["http:", "https:"]);
  if (
    !url ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    value.includes("?") ||
    value.includes("#")
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Use an HTTP or HTTPS origin with no credentials, path, query, or fragment.",
    });
    return z.NEVER;
  }
  return url.origin;
});

const databaseUrl = z.string().refine(
  (value) => {
    const url = urlWithScheme(value, ["postgres:", "postgresql:"]);
    return url !== null && url.pathname.length > 1 && !value.includes("#");
  },
  { message: "Use a PostgreSQL URL with a database name." },
);

const environment = z
  .object({
    DEPLOYMENT_ENV: z
      .enum(["development", "production"])
      .default("development"),
    APP_ORIGIN: appOrigin.optional(),
    APP_PORT: z
      .string()
      .regex(/^\d+$/, "Use a whole-number port.")
      .transform(Number)
      .pipe(z.number().int().min(1).max(65535))
      .default(3000),
    DATABASE_URL: databaseUrl.optional(),
  })
  .superRefine((value, context) => {
    if (value.DEPLOYMENT_ENV === "development") {
      return;
    }
    if (!value.APP_ORIGIN?.startsWith("https://")) {
      context.addIssue({
        code: "custom",
        path: ["APP_ORIGIN"],
        message: "Production requires an HTTPS origin.",
      });
    }
    if (!value.DATABASE_URL) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "Production requires a PostgreSQL URL.",
      });
    }
  });

export function readEnvironment(
  values: Readonly<Record<string, string | undefined>> = process.env,
) {
  const parsed = environment.safeParse(values);
  if (!parsed.success) {
    const messages = parsed.error.issues.map(
      ({ path, message }) => `${path.join(".")}. ${message}`,
    );
    throw new Error(`Invalid environment configuration. ${messages.join(" ")}`);
  }
  return {
    ...parsed.data,
    APP_ORIGIN:
      parsed.data.APP_ORIGIN ?? `http://127.0.0.1:${parsed.data.APP_PORT}`,
  };
}
