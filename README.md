# KhanCoalSupplier

KhanCoalSupplier is a coal-supply workspace for recording truck dispatches, customer receipts, supplier payments, and balances in Pakistan. This version includes staff access, customer and supplier records, company and bank settings, dated opening balances, and bulk dispatch entry with PDF slips.

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

Production sign-in requires an HTTPS `APP_ORIGIN`, a 32-byte base64url `AUTH_ENCRYPTION_KEY`, and `SMTP_URL` and `SMTP_FROM` for recovery email. The first Owner changes the temporary password and enrolls an authenticator before accessing the production workspace. Keep the key available across app restarts. Terminate TLS at the local reverse proxy, preserve the public Host, and set `X-KC-Client-IP` to the actual client address at the proxy so audit and throttle records can use it.

## Checks

```powershell
npm.cmd run check
```

The check command runs lint, type-check, tests, and the build. To run the production build locally, use `npm run start` after `npm run build`. GitHub Actions runs on Windows Server and verifies the npm lockfile, lint, types, tests, build, dependency advisories, and Git history for leaked secrets.

Run the native PostgreSQL integration checks with `./scripts/test-postgres-windows.ps1`. Pass `-PostgresBin` to reuse an existing PostgreSQL binary directory. To use an already running local test cluster, set `TEST_ADMIN_DATABASE_URL` to its `postgres` maintenance database and run `npm.cmd run test:integration`. The harness creates, migrates, and removes a fresh test database for each run.

Set `RUN_BROWSER_TESTS=1` after `npm.cmd run build` to include the Edge sign-in and staff-access workflow in the same isolated database run.

## Project documentation

- [Functional specification](docs/SPEC.md)
- [Architecture](docs/ARCHITECTURE.md) and [decision records](docs/DECISIONS.md)
- [Data model](docs/DATA_MODEL.md) and [permissions](docs/PERMISSIONS.md)
- [Threat model](docs/THREAT_MODEL.md) and [test plan](docs/TEST_PLAN.md)
- [Security controls](docs/SECURITY.md) and [user guide](docs/USER_GUIDE.md)
- [Delivery milestones](docs/DELIVERY_PLAN.md)
