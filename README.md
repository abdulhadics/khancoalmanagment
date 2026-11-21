# KhanCoalSupplier

KhanCoalSupplier is a coal-supply workspace for recording truck dispatches, customer receipts, supplier payments, and balances in Pakistan. The first milestone provides the Windows development setup, application shell, English message catalog, and continuous integration configuration. Database readiness and business workflows arrive in the subsequent milestones.

## Run locally on Windows

Install Git and Node.js 22.18 or later in the Node.js 22 LTS line, or Node.js 24 LTS. Open PowerShell in the repository folder and run the following commands.

```powershell
npm ci
if (-not (Test-Path -LiteralPath .env.local)) {
  Copy-Item -LiteralPath .env.example -Destination .env.local
}
npm run dev
```

Open [the local app](http://127.0.0.1:3000). Keep `.env.local` on the development machine. Use the documented names in `.env.example` when adding environment configuration.

`GET /healthz` reports whether the application can respond. `GET /readyz` returns HTTP 503 during foundation development because PostgreSQL readiness is pending M1.

## Checks

```powershell
npm run check
```

The check command runs lint, type-check, tests, and the build. To run the production build locally, use `npm run start` after `npm run build`. GitHub Actions runs on Windows Server and verifies the npm lockfile, lint, types, tests, build, dependency advisories, and Git history for leaked secrets.

## Project documentation

- [Functional specification](docs/SPEC.md)
- [Architecture](docs/ARCHITECTURE.md) and [decision records](docs/DECISIONS.md)
- [Data model](docs/DATA_MODEL.md) and [permissions](docs/PERMISSIONS.md)
- [Threat model](docs/THREAT_MODEL.md) and [test plan](docs/TEST_PLAN.md)
- [Delivery milestones](docs/DELIVERY_PLAN.md)
