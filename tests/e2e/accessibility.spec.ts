import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  parseBusinessDate,
  todayBusinessDate,
} from "../../src/domain/business-date";
import { createPayment } from "../../src/server/account/payments";
import { hashPassword } from "../../src/server/auth/password";
import { getSession, issueSession } from "../../src/server/auth/session";
import { makePrisma } from "../../src/server/db/connect";
import { createOrders } from "../../src/server/orders/create";

const wcag21AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function prepareWorkspace() {
  const id = randomUUID().slice(0, 8);
  const username = `a11y-${id}`;
  const password = randomBytes(24).toString("base64url");
  const database = makePrisma(process.env.INTEGRATION_DATABASE_URL!);
  try {
    const staff = await database.user.create({
      data: {
        username,
        email: `${username}@example.test`,
        displayName: "Accessibility test Owner",
        roleCode: "OWNER",
        credential: {
          create: {
            passwordHash: await hashPassword(password),
            mustChangePassword: false,
          },
        },
      },
      select: { id: true },
    });
    const token = await database.$transaction((tx) =>
      issueSession(tx, staff.id),
    );
    const actor = await getSession(token, database);
    if (!actor)
      throw new Error("Could not start the accessibility fixture session.");
    const shared = { createdById: staff.id, updatedById: staff.id };
    const [customer, supplier, bank] = await Promise.all([
      database.customer.create({
        data: {
          ...shared,
          name: `Test Foundry ${id}`,
          nameKey: `test foundry ${id}`,
          code: `AC-${id}`,
        },
        select: { id: true },
      }),
      database.supplier.create({
        data: {
          ...shared,
          name: `Test Colliery ${id}`,
          nameKey: `test colliery ${id}`,
          code: `AS-${id}`,
          mines: {
            create: {
              code: "A1",
              codeKey: "a1",
              name: "Test mine",
              isDefault: true,
            },
          },
        },
        select: { id: true, mines: { select: { id: true } } },
      }),
      database.bank.create({
        data: {
          name: `Test Cash ${id}`,
          nameKey: `test cash ${id}`,
          category: "CASH",
        },
        select: { id: true },
      }),
    ]);
    const previousDay = parseBusinessDate(todayBusinessDate());
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    const businessDate = previousDay.toISOString().slice(0, 10);
    const context = { requestId: randomUUID() };
    const { orderIds } = await createOrders(database, actor, context, {
      key: randomUUID(),
      businessDate,
      rows: [
        {
          customerId: customer.id,
          supplierId: supplier.id,
          mineId: supplier.mines[0].id,
          vehicleNo: `AA-${id.slice(0, 5)}`,
          weight: "10.125",
          purchaseRate: "300.00",
          sellRate: "380.00",
        },
      ],
    });
    await createPayment(database, actor, context, {
      key: randomUUID(),
      direction: "IN",
      partyId: customer.id,
      method: "CASH",
      bankId: bank.id,
      businessDate,
      amount: "100.00",
    });
    return {
      username,
      password,
      customerId: customer.id,
      supplierId: supplier.id,
      orderId: orderIds[0],
      businessDate,
    };
  } finally {
    await database.$disconnect();
  }
}

async function visit(page: Page, location: string) {
  const response = await page.goto(location);
  expect(response?.ok(), location).toBe(true);
  expect(new URL(page.url()).pathname).toBe(location.split("?")[0]);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toHaveCount(0);
}

test("desktop modules and mobile controls meet automated WCAG 2.1 AA checks", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const fixture = await prepareWorkspace();
  const violations: { surface: string; rule: string; targets: unknown[] }[] =
    [];
  async function scan(surface: string, scanPage = page) {
    await test.step(surface, async () => {
      const result = await new AxeBuilder({ page: scanPage })
        .withTags(wcag21AA)
        .analyze();
      for (const violation of result.violations) {
        violations.push({
          surface,
          rule: violation.id,
          targets: violation.nodes.map((node) => node.target),
        });
      }
    });
  }

  const desktopViewport = { width: 1440, height: 900 };
  for (const [location, surface] of [
    ["/forgot-password", "password recovery"],
    ["/login", "sign in"],
  ]) {
    const publicPage = await page.context().newPage();
    try {
      await publicPage.setViewportSize(desktopViewport);
      await visit(publicPage, location);
      await scan(surface, publicPage);
    } finally {
      await publicPage.close();
    }
  }

  await page.setViewportSize(desktopViewport);
  await visit(page, "/login");
  await page.getByLabel("Email or username").fill(fixture.username);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();

  const customer = `partyId=${fixture.customerId}`;
  const supplier = `partyId=${fixture.supplierId}`;
  const desktop = [
    "/?period=all",
    `/orders?date=${fixture.businessDate}`,
    `/orders/${fixture.orderId}/edit`,
    "/details/sales",
    `/details/customers?${customer}`,
    `/details/suppliers?${supplier}`,
    "/account",
    "/reports/sales",
    "/reports/customers",
    `/reports/customer?${customer}`,
    "/reports/suppliers",
    `/reports/supplier?${supplier}`,
    "/customers",
    "/customers/new",
    `/customers/${fixture.customerId}`,
    "/suppliers",
    "/suppliers/new",
    `/suppliers/${fixture.supplierId}`,
    "/profile",
    "/settings",
    "/settings/users",
    "/settings/users/new",
    "/admin/periods",
    "/admin/audit",
    "/admin/integrity?run=1",
    "/admin/backups",
  ];
  for (const location of desktop) {
    await visit(page, location);
    await scan(location);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  for (const location of [
    "/",
    "/orders",
    "/details/sales",
    "/account",
    "/reports/sales",
    "/settings",
  ]) {
    await visit(page, location);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      location,
    ).toBeLessThanOrEqual(390);
    await scan(`mobile ${location}`);
  }
  await visit(page, "/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeFocused();

  const navigation = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  await navigation.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Main navigation" });
  await expect(drawer).toBeVisible();
  await scan("mobile navigation drawer");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(navigation).toBeFocused();

  const quickReceive = page.getByRole("button", {
    name: "Quick receive",
    exact: true,
  });
  await quickReceive.focus();
  await page.keyboard.press("Enter");
  const receipt = page.getByRole("dialog", { name: "Quick receive" });
  await expect(receipt).toBeVisible();
  await expect(
    receipt.getByRole("combobox", { name: "Customer", exact: true }),
  ).toBeVisible();
  await scan("mobile Quick Receive");
  await page.keyboard.press("Escape");
  await expect(receipt).toBeHidden();
  await expect(quickReceive).toBeFocused();

  expect(violations).toEqual([]);
});
