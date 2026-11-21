import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { cpus, release, totalmem } from "node:os";
import { setTimeout } from "node:timers/promises";

import { parseBusinessDate, todayBusinessDate } from "@/domain/business-date";
import { getSession, issueSession } from "@/server/auth/session";
import { hashPassword } from "@/server/auth/password";
import { readDashboard } from "@/server/dashboard/workspace";
import { makePrisma } from "@/server/db/connect";
import { createOrders } from "@/server/orders/create";
import { readAccountingIntegrity } from "@/server/reporting/reconciliation";
import {
  signedSalesFacts,
  summedSalesMeasures,
} from "@/server/reporting/sales-facts";
import { readSalesReportPage } from "@/server/reporting/sales-report";

type Staff = {
  token: string;
  principal: NonNullable<Awaited<ReturnType<typeof getSession>>>;
};

type Route = {
  name: string;
  path: string;
  heading?: string;
  contentType?: string;
};

function sandboxDatabase() {
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(database.protocol, "postgresql:");
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.pathname, "/khancoal_benchmark_test");
  assert.equal(process.env.DEPLOYMENT_ENV, "development");
  return makePrisma(database.toString());
}

type Database = ReturnType<typeof sandboxDatabase>;

async function makeStaff(database: Database): Promise<Staff[]> {
  const passwordHash = await hashPassword(
    randomBytes(32).toString("base64url"),
  );
  const staff: Staff[] = [];
  for (let index = 0; index < 10; index++) {
    const username = `benchmark-staff-${index}`;
    const user = await database.user.create({
      data: {
        username,
        email: `${username}@example.test`,
        displayName: `Benchmark Staff ${index}`,
        roleCode: index === 0 ? "OWNER" : "ACCOUNTANT",
        credential: { create: { passwordHash, mustChangePassword: false } },
      },
      select: { id: true },
    });
    const token = await database.$transaction((tx) =>
      issueSession(tx, user.id),
    );
    const principal = await getSession(token, database);
    assert.ok(principal);
    staff.push({ token, principal });
  }
  return staff;
}

async function timed<T>(work: () => Promise<T>) {
  const started = performance.now();
  const result = await work();
  return { milliseconds: performance.now() - started, result };
}

function distribution(samples: readonly number[]) {
  const ordered = [...samples].sort((left, right) => left - right);
  const percentile = (position: number) =>
    ordered.length
      ? Math.round(ordered[Math.ceil(ordered.length * position) - 1])
      : null;
  return { count: ordered.length, p50: percentile(0.5), p95: percentile(0.95) };
}

function failureLabel(error: unknown) {
  if (!(error instanceof Error)) return "Unknown benchmark failure";
  return `${error.name}: ${error.message.trim().split("\n")[0]}`;
}

async function measure(
  rounds: number,
  staff: Staff[],
  work: (user: Staff) => Promise<unknown>,
) {
  const samples: number[] = [];
  const failures: string[] = [];
  for (let round = 0; round < rounds; round++) {
    const results = await Promise.allSettled(
      staff.map((user) => timed(() => work(user))),
    );
    for (const result of results) {
      if (result.status === "fulfilled")
        samples.push(result.value.milliseconds);
      else failures.push(failureLabel(result.reason));
    }
  }
  return {
    ...distribution(samples),
    failed: failures.length,
    errors: [...new Set(failures)],
  };
}

async function visit(origin: string, route: Route, { token }: Staff) {
  const response = await fetch(`${origin}${route.path}`, {
    headers: { cookie: `kc_session=${token}` },
    redirect: "manual",
    signal: AbortSignal.timeout(90_000),
  });
  assert.equal(
    response.status,
    200,
    `${route.name} returned ${response.status}`,
  );
  assert.ok(
    response.headers
      .get("content-type")
      ?.startsWith(route.contentType ?? "text/html"),
    `${route.name} returned a different document type`,
  );
  if (route.heading) {
    const html = await response.text();
    assert.ok(
      html.includes(`<h1>${route.heading}</h1>`),
      `${route.name} heading missing`,
    );
  } else {
    assert.ok(
      (await response.arrayBuffer()).byteLength,
      `${route.name} is empty`,
    );
  }
}

async function waitForServer(origin: string, server: ReturnType<typeof spawn>) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) break;
    try {
      const response = await fetch(`${origin}/healthz`, {
        signal: AbortSignal.timeout(1_000),
      });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      // The process is still starting.
    }
    await setTimeout(250);
  }
  throw new Error("The benchmark's local Next.js server did not start.");
}

async function benchmark(port: number, rounds: number, fixtureLoadMs: number) {
  const database = sandboxDatabase();
  const origin = `http://127.0.0.1:${port}`;
  const serverArgs = createRequire(import.meta.url).resolve(
    "next/dist/bin/next",
  );
  const server = spawn(
    process.execPath,
    [serverArgs, "start", "-H", "127.0.0.1", "-p", String(port)],
    {
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, APP_PORT: String(port), APP_ORIGIN: origin },
    },
  );
  try {
    await waitForServer(origin, server);
    console.log("Benchmark HTTP listener is ready.");
    await database.$connect();
    const staff = await makeStaff(database);
    console.log("Created ten benchmark staff sessions.");
    const [
      customer,
      supplier,
      orderCounts,
      paymentCount,
      journalCount,
      [postgres],
    ] = await Promise.all([
      database.customer.findUniqueOrThrow({ where: { code: "C-BENCH-1" } }),
      database.supplier.findUniqueOrThrow({
        where: { code: "S-BENCH-1" },
        include: { mines: { select: { id: true } } },
      }),
      database.order.groupBy({ by: ["status"], _count: true }),
      database.payment.count(),
      database.ledgerEntry.count(),
      database.$queryRaw<{ server: string; databaseBytes: string }[]>`
          SELECT current_setting('server_version') AS server,
            pg_database_size(current_database())::text AS "databaseBytes"`,
    ]);
    console.log("Reading the benchmark fixture and starting measurements.");
    const [owner] = staff;
    const to = todayBusinessDate();
    const beginning = parseBusinessDate(to);
    beginning.setUTCDate(beginning.getUTCDate() - 13);
    const from = beginning.toISOString().slice(0, 10);
    const dates = `from=${from}&to=${to}`;
    const routes: Route[] = [
      {
        name: "Dashboard",
        path: `/?period=custom&${dates}`,
        heading: "Dashboard",
      },
      {
        name: "Sales Details search and page 2",
        path: `/details/sales?${dates}&q=bench-&page=2&sort=weight`,
        heading: "Sales Details",
      },
      { name: "Account", path: "/account", heading: "Account" },
      {
        name: "Sales Report",
        path: `/reports/sales?${dates}&groupBy=date`,
        heading: "Sales Report",
      },
      {
        name: "Customers Report",
        path: `/reports/customers?${dates}&page=2`,
        heading: "Customers Report",
      },
      {
        name: "Single Customer Report",
        path: `/reports/customer?partyId=${customer.id}&${dates}`,
        heading: "Single Customer Report",
      },
      {
        name: "Suppliers Report",
        path: `/reports/suppliers?${dates}&page=2`,
        heading: "Suppliers Report",
      },
      {
        name: "Single Supplier Report",
        path: `/reports/supplier?partyId=${supplier.id}&${dates}`,
        heading: "Single Supplier Report",
      },
    ];
    const typical = [];
    for (const route of routes) {
      try {
        await visit(origin, route, owner);
      } catch (error) {
        console.warn(`Warmup for ${route.name} failed: ${failureLabel(error)}`);
      }
      typical.push({
        name: route.name,
        one: await measure(rounds, [owner], (user) =>
          visit(origin, route, user),
        ),
        ten: await measure(rounds, staff, (user) => visit(origin, route, user)),
      });
      const { one, ten } = typical[typical.length - 1];
      console.log(`Measured ${route.name}`, { one, ten });
    }

    const broadRoutes: Route[] = [
      {
        name: "All-time Dashboard",
        path: "/?period=all",
        heading: "Dashboard",
      },
      {
        name: "All-time Sales Report by date",
        path: "/reports/sales?groupBy=date",
        heading: "Sales Report",
      },
      {
        name: "All-time Sales CSV by date",
        path: "/reports/sales/export?format=csv&groupBy=date",
        contentType: "text/csv",
      },
      {
        name: "14-day Sales Report PDF",
        path: `/reports/sales/export?format=pdf&groupBy=date&${dates}`,
        contentType: "application/pdf",
      },
    ];
    const broad = [];
    for (const route of broadRoutes) {
      broad.push({
        name: route.name,
        ...(await measure(3, [owner], (user) => visit(origin, route, user))),
      });
    }

    const [dashboard, sales] = await Promise.all([
      readDashboard(database, owner.principal, { period: "custom", from, to }),
      readSalesReportPage(database, owner.principal, {
        groupBy: "date",
        from,
        to,
      }),
    ]);
    assert.equal(dashboard.scope, "financial");
    assert.deepEqual(dashboard.totals, sales.totals);
    const integrity = await timed(() =>
      readAccountingIntegrity(database, owner.principal),
    );
    assert.deepEqual(integrity.result.findings, []);

    const [plan] = await database.$queryRaw<
      {
        "QUERY PLAN": [
          { Plan: object; "Planning Time": number; "Execution Time": number },
        ];
      }[]
    >`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT ${summedSalesMeasures} FROM (${signedSalesFacts({ from, to })}) AS facts
    `;

    async function post(staff: Staff) {
      const key = randomUUID();
      const result = await createOrders(
        database,
        staff.principal,
        { requestId: key },
        {
          key,
          businessDate: to,
          rows: Array.from({ length: 20 }, (_, index) => ({
            customerId: customer.id,
            supplierId: supplier.id,
            mineId: supplier.mines[0].id,
            vehicleNo: `${key.slice(0, 13)}-${index + 1}`,
            weight: "24.125",
            purchaseRate: "17200.00",
            sellRate: "24100.00",
          })),
        },
      );
      assert.equal(result.orderIds.length, 20);
    }
    const posting = {
      one: await measure(rounds, [owner], post),
      ten: await measure(rounds, staff, post),
    };

    const description = {
      measuredAt: new Date().toISOString(),
      platform: {
        os: process.platform,
        release: release(),
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        ramGiB: Math.round(totalmem() / 2 ** 30),
        node: process.version,
        ...postgres,
      },
      dataset: {
        orders: orderCounts,
        paymentCount,
        journalCount,
        seed: "integer-series-v1",
        fixtureLoadMs,
        from,
        to,
      },
      methodology:
        "Warm local HTTP response including complete HTML or export body. Posting invokes the normal order service. Durations in milliseconds.",
      typical,
      broad,
      posting,
      verification: {
        salesTotals: sales.totals,
        integrityFindings: integrity.result.total,
        integrityMs: Math.round(integrity.milliseconds),
        salesQueryPlan: plan["QUERY PLAN"][0],
      },
    };
    const report = JSON.stringify(description, null, 2);
    if (process.env.BENCHMARK_REPORT_PATH) {
      await writeFile(process.env.BENCHMARK_REPORT_PATH, `${report}\n`, {
        flag: "wx",
      });
    } else {
      console.log(report);
    }
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const stopped = once(server, "exit", {
        signal: AbortSignal.timeout(10_000),
      });
      server.kill();
      await stopped;
    }
    await database.$disconnect();
  }
}

const [port, rounds, fixtureLoadMs] = process.argv.slice(2).map(Number);
assert.ok(Number.isSafeInteger(port) && port >= 1024 && port <= 65535);
assert.ok(Number.isSafeInteger(rounds) && rounds >= 1 && rounds <= 30);
assert.ok(Number.isSafeInteger(fixtureLoadMs) && fixtureLoadMs >= 0);
await benchmark(port, rounds, fixtureLoadMs);
