import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "../../src/server/auth/password";
import { makePrisma } from "../../src/server/db/connect";

async function signIn(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email or username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
}

test("Owner can reopen a period and inspect administration pages on mobile", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const key = randomUUID().slice(0, 8);
  const owner = `browser-admin-${key}`;
  const viewer = `browser-admin-viewer-${key}`;
  const password = randomBytes(24).toString("base64url");
  const passwordHash = await hashPassword(password);
  const database = makePrisma(process.env.INTEGRATION_DATABASE_URL!);
  try {
    for (const [username, roleCode] of [
      [owner, "OWNER"],
      [viewer, "VIEWER"],
    ] as const) {
      await database.user.create({
        data: {
          username,
          email: `${username}@example.test`,
          displayName: `Administration ${roleCode}`,
          roleCode,
          credential: { create: { passwordHash, mustChangePassword: false } },
        },
      });
    }
  } finally {
    await database.$disconnect();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, owner, password);
  await page.goto("/settings");
  const administration = page.getByRole("region", {
    name: "Administration",
    exact: true,
  });
  await administration
    .getByRole("link", { name: "Accounting periods" })
    .click();
  await page.getByRole("spinbutton", { name: "Year" }).fill("1994");
  await page.getByRole("button", { name: "View year" }).click();
  const january = page.getByRole("row", { name: /January/ });
  const januaryMonthLock = january.getByRole("cell").nth(0);
  await expect(januaryMonthLock).toHaveText("Open");
  await page
    .getByRole("combobox", { name: "Period", exact: true })
    .selectOption("01");
  await page
    .getByRole("combobox", { name: "Action", exact: true })
    .selectOption("lock");
  await page
    .getByRole("textbox", { name: "Reason" })
    .fill("January review complete");
  await page.getByRole("button", { name: "Save period change" }).click();
  await expect(januaryMonthLock).toHaveText("Locked");
  await page
    .getByRole("combobox", { name: "Action", exact: true })
    .selectOption("unlock");
  await page
    .getByRole("textbox", { name: "Reason" })
    .fill("Review a new receipt");
  await page.getByRole("button", { name: "Save period change" }).click();
  await expect(januaryMonthLock).toHaveText("Open");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  await page.goto("/admin/audit");
  await page
    .getByRole("textbox", { name: "Action", exact: true })
    .fill("period.unlock");
  await page.getByRole("button", { name: "Filter events" }).click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("action") === "period.unlock",
  );
  const event = page.getByRole("row").filter({ hasText: "1994-01" });
  await expect(event).toHaveCount(1);
  await expect(event).toContainText("period.unlock");
  await event.getByText("Event details", { exact: true }).click();
  await expect(
    event.getByText("Review a new receipt", { exact: true }),
  ).toBeVisible();

  await page.goto("/admin/integrity");
  await page.getByRole("button", { name: "Run integrity check" }).click();
  await expect(
    page.getByRole("heading", { name: "Party ledger reconciliation" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  await page.goto("/admin/backups");
  await expect(
    page.getByRole("heading", { name: "Database backups" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The Windows backup configuration is missing or unavailable.",
    ),
  ).toBeVisible();

  const viewerPage = await browser.newPage();
  try {
    await signIn(viewerPage, viewer, password);
    for (const path of [
      "/admin/periods",
      "/admin/audit",
      "/admin/integrity",
      "/admin/backups",
    ]) {
      await viewerPage.goto(path);
      await expect(
        viewerPage.getByRole("heading", { name: "Page not found" }),
      ).toBeVisible();
    }
  } finally {
    await viewerPage.close();
  }
});
