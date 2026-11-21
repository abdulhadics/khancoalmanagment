import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "../../src/server/auth/password";
import { makePrisma } from "../../src/server/db/connect";

const ownerPassword = randomBytes(24).toString("base64url");
const ownerPermanent = randomBytes(24).toString("base64url");
const viewerPassword = randomBytes(24).toString("base64url");
const viewerPermanent = randomBytes(24).toString("base64url");

async function logIn(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email or username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function changeTemporaryPassword(page: Page, password: string) {
  await expect(page).toHaveURL(/\/login\/change-password$/);
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
}

async function createBrowserOwner(
  username: string,
  password: string,
  mustChangePassword: boolean,
) {
  const db = makePrisma(process.env.INTEGRATION_DATABASE_URL!);
  try {
    await db.user.create({
      data: {
        displayName: "Browser Test Owner",
        username,
        email: `${username}@example.test`,
        roleCode: "OWNER",
        credential: {
          create: {
            passwordHash: await hashPassword(password),
            mustChangePassword,
          },
        },
      },
    });
  } finally {
    await db.$disconnect();
  }
}

test("Owner creates a Viewer whose access is restricted and revoked when disabled", async ({
  page,
  browser,
}) => {
  await createBrowserOwner("browser-owner", ownerPassword, true);
  await page.goto("/settings/users");
  await expect(page).toHaveURL(/\/login$/);
  await logIn(page, "browser-owner", ownerPassword);
  await changeTemporaryPassword(page, ownerPermanent);
  await page.goto("/settings/users/new");
  await page.getByLabel("Full name").fill("Browser Test Viewer");
  await page.getByLabel("Email address").fill("browser-viewer@example.test");
  await page.getByLabel("Username").fill("browser-viewer");
  await page
    .getByRole("combobox", { name: "Role", exact: true })
    .selectOption("VIEWER");
  await page.getByLabel("Temporary password").fill(viewerPassword);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toHaveText("Staff account created.");
  await page.getByRole("link", { name: "Staff accounts", exact: true }).click();
  const viewerRow = page.getByRole("row", { name: /Browser Test Viewer/ });
  await expect(viewerRow).toBeVisible();

  const viewer = await browser.newPage();
  try {
    await logIn(viewer, "browser-viewer", viewerPassword);
    await changeTemporaryPassword(viewer, viewerPermanent);
    const nav = viewer.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("button", { name: "Reports" })).toBeVisible();
    await expect(
      nav.getByRole("link", { name: "Account", exact: true }),
    ).toHaveCount(0);
    await viewer.goto("/account");
    await expect(
      viewer.getByText("Page not found", { exact: true }),
    ).toBeVisible();
    await viewer.goto("/settings/users");
    await expect(
      viewer.getByText("Page not found", { exact: true }),
    ).toBeVisible();

    await viewerRow.getByRole("link", { name: "Manage" }).click();
    await page
      .getByRole("combobox", { name: "Status", exact: true })
      .selectOption("disabled");
    await page.getByRole("button", { name: "Save access" }).click();
    await expect(page.getByText("Account access saved.")).toBeVisible();
    await viewer.goto("/");
    await expect(viewer).toHaveURL(/\/login$/);
  } finally {
    await viewer.close();
  }

  await page.goto("/");
  await page.locator("summary").click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("Owner records opening balances and configures company settings", async ({
  page,
}) => {
  const password = randomBytes(24).toString("base64url");
  await createBrowserOwner("browser-master-owner", password, false);
  await logIn(page, "browser-master-owner", password);
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();

  await page.goto("/customers/new");
  await page
    .getByRole("textbox", { name: "Customer name", exact: true })
    .fill("Browser Foundry");
  await page
    .getByRole("textbox", { name: "Opening receivable", exact: true })
    .fill("1500.25");
  await page
    .getByRole("button", { name: "Create customer", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Customer saved.");
  await page.goto("/customers");
  const customer = page.getByRole("row", { name: /Browser Foundry/ });
  await expect(customer).toContainText(/1,500\.25/);

  await page.goto("/suppliers/new");
  await page
    .getByRole("textbox", { name: "Supplier", exact: true })
    .fill("Browser Colliery");
  await page
    .getByRole("textbox", { name: "Mine number", exact: true })
    .fill("QA-15");
  await page
    .getByRole("textbox", { name: "Mine name", exact: true })
    .fill("Browser Shaft");
  await page
    .getByRole("textbox", { name: "Opening payable (Rs.)", exact: true })
    .fill("4000.50");
  await page
    .getByRole("button", { name: "Create supplier", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Browser Colliery", exact: true }),
  ).toBeVisible();
  await page.goto("/suppliers");
  const supplier = page.getByRole("row", { name: /Browser Colliery/ });
  await expect(supplier).toContainText(/4,000\.50/);
  await expect(supplier).toContainText(/QA-15/);

  await page.goto("/settings");
  await page
    .getByRole("textbox", { name: "Company name", exact: true })
    .fill("Browser Coal Supplier");
  await page
    .getByRole("combobox", { name: "Date format", exact: true })
    .selectOption("yyyy-MM-dd");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    page.getByText("Company settings saved.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".workspace-date")).toHaveText(/\d{4}-\d{2}-\d{2}/);
  await expect(
    page.getByRole("combobox", { name: "Date format", exact: true }),
  ).toHaveValue("yyyy-MM-dd");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: test.info().outputPath("settings-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("settings-mobile.png"),
    fullPage: true,
  });
});
