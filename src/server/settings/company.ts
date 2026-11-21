import { z } from "zod";

import {
  documentDateFormats,
  documentNumberFormats,
  formatDocumentDate,
} from "@/domain/document-format";
import { requirePermission } from "@/domain/permissions";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { BankCategory, WeightUnit } from "@/generated/prisma/enums";
import {
  requireLivePermission,
  type LivePrincipal,
} from "@/server/auth/live-principal";
import { appendAuditEvent } from "@/server/repositories/audit-log";
import { normalizeCompanyLogo } from "./logo";

type SettingsErrorCode =
  "invalid" | "logo" | "missing" | "stale" | "duplicateBank";

export class SettingsError extends Error {
  constructor(
    readonly code: SettingsErrorCode,
    readonly fields: readonly string[] = [],
  ) {
    super(code);
    this.name = "SettingsError";
  }
}

type ChangeContext = { requestId: string; ipAddress?: string };
const permission = "settings.manage";
const optionalText = (limit: number) =>
  z
    .string()
    .trim()
    .max(limit)
    .transform((value) => value || null);
const prefix = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,16}$/);
const companyCommand = z.object({
  version: z.iso.datetime(),
  name: z.string().trim().min(1).max(160),
  tagline: optionalText(250),
  address: optionalText(500),
  phone: optionalText(40),
  email: z
    .union([z.literal(""), z.email().max(254)])
    .transform((value) => value || null),
  currencySymbol: z.string().trim().min(1).max(12),
  weightUnit: z.enum(WeightUnit),
  dateFormat: z.enum(documentDateFormats),
  numberFormat: z.enum(documentNumberFormats),
  footer: optionalText(500),
  orderPrefix: prefix,
  voucherPrefix: prefix,
  logo: z.union([z.literal("keep"), z.literal("remove"), z.instanceof(File)]),
});

const bankName = z
  .string()
  .max(320)
  .transform((name) => name.normalize("NFKC").trim().replace(/\s+/gu, " "))
  .pipe(z.string().min(1).max(80));

const bankFields = {
  name: bankName,
  category: z.enum(BankCategory),
};

const bankCommand = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), ...bankFields }),
  z.object({
    operation: z.literal("edit"),
    id: z.uuid(),
    version: z.iso.datetime(),
    ...bankFields,
  }),
  z.object({
    operation: z.literal("status"),
    id: z.uuid(),
    version: z.iso.datetime(),
    isActive: z.boolean(),
  }),
]);

const companyFields = {
  id: true,
  orderPrefix: true,
  voucherPrefix: true,
  updatedAt: true,
  documentProfile: {
    select: {
      id: true,
      name: true,
      tagline: true,
      address: true,
      phone: true,
      email: true,
      currencySymbol: true,
      weightUnit: true,
      dateFormat: true,
      numberFormat: true,
      footer: true,
      logoBytes: true,
      logoMediaType: true,
    },
  },
} satisfies Prisma.CompanySettingsSelect;

const bankSelection = {
  id: true,
  name: true,
  category: true,
  isActive: true,
  updatedAt: true,
} satisfies Prisma.BankSelect;

export async function readCompanySettings(
  database: PrismaClient,
  actor: LivePrincipal,
) {
  requirePermission(actor, permission);
  return database.$transaction(async (tx) => {
    await requireLivePermission(tx, actor, permission);
    const company = await tx.companySettings.findUnique({
      where: { id: 1 },
      select: companyFields,
    });
    if (!company) throw new SettingsError("missing");
    const banks = await tx.bank.findMany({
      orderBy: [{ isActive: "desc" }, { nameKey: "asc" }, { id: "asc" }],
      select: bankSelection,
    });
    return { company, banks };
  });
}

export async function readDocumentDisplayPreferences(
  database: Pick<Prisma.TransactionClient, "companySettings">,
) {
  const company = await database.companySettings.findUnique({
    where: { id: 1 },
    select: {
      documentProfile: {
        select: {
          currencySymbol: true,
          weightUnit: true,
          dateFormat: true,
          numberFormat: true,
        },
      },
    },
  });
  return (
    company?.documentProfile ?? {
      currencySymbol: "Rs.",
      weightUnit: WeightUnit.TON,
      dateFormat: "dd MMM yyyy",
      numberFormat: "en-PK",
    }
  );
}

export async function readWorkspaceDate(
  database: PrismaClient,
  instant = new Date(),
) {
  const { dateFormat } = await readDocumentDisplayPreferences(database);
  return formatDocumentDate(instant, dateFormat);
}

function nextVersion(previous: Date) {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

function requireCurrentVersion(current: Date, expected: string) {
  if (current.toISOString() !== expected) throw new SettingsError("stale");
}

export async function updateCompanySettings(
  database: PrismaClient,
  actor: LivePrincipal,
  context: ChangeContext,
  input: unknown,
) {
  requirePermission(actor, permission);
  const parsed = companyCommand.safeParse(input);
  if (!parsed.success) {
    throw new SettingsError(
      "invalid",
      parsed.error.issues.map(({ path }) => String(path[0])),
    );
  }
  const { version, orderPrefix, voucherPrefix, logo, ...profileFields } =
    parsed.data;
  const uploaded =
    logo instanceof File ? await normalizeCompanyLogo(logo) : null;
  if (logo instanceof File && !uploaded)
    throw new SettingsError("logo", ["logo"]);

  return database.$transaction(async (tx) => {
    await requireLivePermission(tx, actor, permission);
    await tx.$queryRaw`SELECT id FROM company_settings WHERE id = 1 FOR UPDATE`;
    const current = await tx.companySettings.findUnique({
      where: { id: 1 },
      select: companyFields,
    });
    if (!current) throw new SettingsError("missing");
    requireCurrentVersion(current.updatedAt, version);
    const previous = current.documentProfile;
    const profileChanged =
      Object.entries(profileFields).some(
        ([field, value]) =>
          previous[field as keyof typeof profileFields] !== value,
      ) ||
      (logo === "remove" && previous.logoBytes !== null) ||
      (uploaded !== null &&
        (!previous.logoBytes ||
          !Buffer.from(previous.logoBytes).equals(uploaded.logoBytes)));

    if (
      !profileChanged &&
      current.orderPrefix === orderPrefix &&
      current.voucherPrefix === voucherPrefix
    ) {
      return current;
    }
    const profile = profileChanged
      ? await tx.documentProfile.create({
          data: {
            ...profileFields,
            logoBytes:
              uploaded?.logoBytes ??
              (logo === "remove" ? null : previous.logoBytes),
            logoMediaType:
              uploaded?.logoMediaType ??
              (logo === "remove" ? null : previous.logoMediaType),
          },
          select: { id: true },
        })
      : previous;
    const updated = await tx.companySettings.update({
      where: { id: 1 },
      data: {
        orderPrefix,
        voucherPrefix,
        documentProfileId: profile.id,
        updatedAt: nextVersion(current.updatedAt),
      },
      select: companyFields,
    });
    await appendAuditEvent(tx, {
      actor: { type: "USER", id: actor.userId },
      area: "settings",
      action: "company.update",
      targetType: "company_settings",
      targetId: String(current.id),
      ...context,
      outcome: "SUCCESS",
      before: {
        profileId: previous.id,
        orderPrefix: current.orderPrefix,
        voucherPrefix: current.voucherPrefix,
      },
      after: { profileId: profile.id, orderPrefix, voucherPrefix },
    });
    return updated;
  });
}

export async function mutateBank(
  database: PrismaClient,
  actor: LivePrincipal,
  context: ChangeContext,
  input: unknown,
) {
  requirePermission(actor, permission);
  const parsed = bankCommand.safeParse(input);
  if (!parsed.success) {
    throw new SettingsError(
      "invalid",
      parsed.error.issues.map(({ path }) => String(path[0])),
    );
  }
  const command = parsed.data;

  try {
    return await database.$transaction(async (tx) => {
      await requireLivePermission(tx, actor, permission);
      let previous: Prisma.BankGetPayload<{
        select: typeof bankSelection;
      }> | null = null;
      if (command.operation !== "create") {
        await tx.$queryRaw`SELECT id FROM banks WHERE id = ${command.id}::uuid FOR UPDATE`;
        previous = await tx.bank.findUnique({
          where: { id: command.id },
          select: bankSelection,
        });
        if (!previous) throw new SettingsError("missing");
        requireCurrentVersion(previous.updatedAt, command.version);
        if (
          (command.operation === "edit" &&
            command.name === previous.name &&
            command.category === previous.category) ||
          (command.operation === "status" &&
            command.isActive === previous.isActive)
        )
          return previous;
      }

      const namedAccount =
        command.operation === "status"
          ? null
          : {
              name: command.name,
              nameKey: command.name.toLowerCase(),
              category: command.category,
            };
      const current = previous
        ? await tx.bank.update({
            where: { id: previous.id },
            data: {
              ...(command.operation === "status"
                ? { isActive: command.isActive }
                : namedAccount),
              updatedAt: nextVersion(previous.updatedAt),
            },
            select: bankSelection,
          })
        : await tx.bank.create({ data: namedAccount!, select: bankSelection });

      await appendAuditEvent(tx, {
        actor: { type: "USER", id: actor.userId },
        area: "settings",
        action: `bank.${command.operation}`,
        targetType: "bank",
        targetId: current.id,
        ...context,
        outcome: "SUCCESS",
        before: previous
          ? {
              name: previous.name,
              category: previous.category,
              isActive: previous.isActive,
            }
          : undefined,
        after: {
          name: current.name,
          category: current.category,
          isActive: current.isActive,
        },
      });
      return current;
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    ) {
      throw new SettingsError("duplicateBank", ["name"]);
    }
    throw error;
  }
}
