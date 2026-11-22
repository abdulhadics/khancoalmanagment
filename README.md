# KhanCoalSupplier

KhanCoalSupplier is a coal-supply workspace for recording truck dispatches, customer receipts, supplier payments, and balances in Pakistan. It includes a dashboard, staff access, customer and supplier ledgers, bulk dispatch entry, payment vouchers, five sales and party reports, and Owner administration.

## Run locally on Windows

Install Git and Node.js 22.18 or later in the Node.js 22 LTS line, or Node.js 24 LTS. Open PowerShell in the repository folder and run the following commands.

```powershell
npm.cmd ci
if (-not (Test-Path -LiteralPath .env.local)) {
  Copy-Item -LiteralPath .env.example -Destination .env.local
}
npm.cmd run dev
```

Open [the local app](http://127.0.0.1:3000). Keep `.env.local` on the development machine. Use the documented names in `.env.example` when adding environment configuration.

`GET /healthz` reports whether the application can respond. `GET /readyz` returns HTTP 200 when the database connection can query the migrated role catalog and HTTP 503 otherwise.

## Connect PostgreSQL

Use [PostgreSQL for Windows](https://www.postgresql.org/download/windows/). Create a development database and its login in PostgreSQL. Set `DATABASE_URL` in `.env.local` using the PostgreSQL connection string for that login. URL-encode special characters in the username or password. Run the migrations before opening the workspace.

```powershell
npm.cmd run db:migrate
```

For the first Owner, provide `OWNER_EMAIL`, `OWNER_USERNAME`, `OWNER_DISPLAY_NAME`, and `OWNER_PASSWORD` in the seed command's process environment, using a secret prompt or environment injection for the password. Run `npm.cmd run db:seed-owner` and clear the password from the process environment afterward. Use a unique temporary password. The CLI seeds an account that requires a password change on first login. It preserves the account's existing credentials on subsequent runs.

Production uses a separate `MIGRATION_DATABASE_URL` for schema changes and a restricted `DATABASE_URL` for application access. After migrating, connect `psql` to the application database as the schema owner and apply the grants with `-v ON_ERROR_STOP=1 -v application_role=khancoal_app -f scripts/grant-database-access.sql`. Replace `khancoal_app` with the name of the existing application login. Keep database credentials outside Git.

Production sign-in requires an HTTPS `APP_ORIGIN`, a 32-byte base64url `AUTH_ENCRYPTION_KEY`, and `SMTP_URL` and `SMTP_FROM` for recovery email. The first Owner changes the temporary password and enrolls an authenticator before accessing the production workspace. Keep the key available across app restarts. On Windows Server, terminate TLS at the local reverse proxy, preserve the public Host, and set `X-KC-Client-IP` to the actual client address at the proxy so audit and throttle records can use it.

## Deploy the web app on Vercel

1. Provision a managed PostgreSQL database reachable from Vercel. Apply `npm run db:migrate` from a trusted machine with `MIGRATION_DATABASE_URL` set, grant the restricted application login using the SQL above, and seed the first Owner with `npm run db:seed-owner` using that login's `DATABASE_URL`. Keep the migration connection and Owner bootstrap credentials in the maintenance environment.
2. [Import the GitHub repository](https://vercel.com/docs/git/vercel-for-github) and select Next.js, the repository root, and Node.js 22.x or 24.x. Use `npm ci` for installation and `npm run build` for the build. Installation generates the Prisma client. Enable automatic exposure of [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables) for the platform client IP header handling.
3. In the Vercel Production environment, set the variables below. Use a separate database and encryption key for a Preview deployment that staff can sign in to. Give each environment its own `APP_ORIGIN` matching the hostname used in the browser.

| Variable              | Value                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEPLOYMENT_ENV`      | `production`                                                                                                                                                               |
| `APP_ORIGIN`          | The chosen HTTPS address without a path, such as `https://your-project.vercel.app`                                                                                         |
| `DATABASE_URL`        | The TLS PostgreSQL connection string for the restricted application login. Use a provider pooler that supports PostgreSQL connection options and interactive transactions. |
| `AUTH_ENCRYPTION_KEY` | A stable secret generated with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`                                                       |
| `SMTP_URL`            | An external SMTP relay, such as an `smtps://` URL on port 465. URL-encode relay credentials.                                                                               |
| `SMTP_FROM`           | The verified sender address provided by the relay                                                                                                                          |

4. Deploy and verify `/readyz` returns HTTP 200. Sign in at `APP_ORIGIN`, change the temporary password, and enroll an authenticator. Test password reset, a PDF export, and a representative dispatch and payment before inviting staff.

The in-app encrypted backup download and backup scheduler require the Windows Server setup. On Vercel, configure managed PostgreSQL backups and verify a restore in a separate database. Review the [capacity results](docs/PERFORMANCE.md#22-november-local-500000-order-run) before using the hosted app for live operations.

## Checks

```powershell
npm.cmd run check
```

The check command runs lint, type-check, tests, and the build. To run the production build locally, use `npm run start` after `npm run build`. GitHub Actions runs on Windows Server and verifies the npm lockfile, lint, types, tests, build, dependency advisories, and Git history for leaked secrets.

Run the native PostgreSQL integration checks with `./scripts/test-postgres-windows.ps1`. Pass `-PostgresBin` to reuse an existing PostgreSQL binary directory. To use an already running local test cluster, set `TEST_ADMIN_DATABASE_URL` to its `postgres` maintenance database and run `npm.cmd run test:integration`. The harness creates, migrates, and removes a fresh test database for each run.

Set `RUN_BROWSER_TESTS=1` after `npm.cmd run build` to include the Edge sign-in and staff-access workflow in the same isolated database run.

Use `npm.cmd test -- --coverage` for unit coverage. Set `RUN_INTEGRATION_COVERAGE=1` before running the native PostgreSQL checks to collect integration coverage. The reports are written to `coverage/unit` and `coverage/integration`.

## Project documentation

- [Functional specification](docs/SPEC.md)
- [Architecture](docs/ARCHITECTURE.md) and [decision records](docs/DECISIONS.md)
- [Data model](docs/DATA_MODEL.md) and [permissions](docs/PERMISSIONS.md)
- [Threat model](docs/THREAT_MODEL.md) and [test plan](docs/TEST_PLAN.md)
- [Security controls](docs/SECURITY.md) and [user guide](docs/USER_GUIDE.md)
- [Windows Server runbook](docs/RUNBOOK.md) and [backup and recovery](docs/BACKUP_RESTORE.md)
- [HTTP routes and service boundaries](docs/API.md), [security checklist](docs/SECURITY_CHECKLIST.md), and [performance rehearsal](docs/PERFORMANCE.md)
- [Delivery milestones](docs/DELIVERY_PLAN.md)
- [Requirements traceability](docs/TRACEABILITY.md)
- [Roadmap](docs/ROADMAP.md)
