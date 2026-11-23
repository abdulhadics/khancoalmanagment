# Test plan

This plan applies to the rebuilt application and its Windows deployment scripts. Evidence comes from synthetic data, a disposable PostgreSQL database, and a designated Windows Server test environment. The hosted reference supplies visual and workflow comparisons.

## Test pyramid

| Layer | Scope | Evidence |
| --- | --- | --- |
| Static checks | TypeScript strict checks, lint and formatting, production build, dependency and license review, secret scan, schema validation and migration checks. | CI check results and build output. |
| Unit and property tests | Decimal parsing and half-up rounding, order validation and numbering format, business calendar, ledger formulas and ordering, role/action policy, export formatting, and translations. | ≥80% coverage on domain and service code and 100% on money and ledger logic. |
| PostgreSQL integration | Real migrations, constraints, transactional services, authorization, audit rows, session states, period locks, queries and concurrency. | Repeatable seeded database runs with deterministic fixtures. |
| Browser and document | Playwright for staff journeys, role-specific navigation, keyboard workflows, print layouts and mobile/tablet use. PDF text/layout checks and manual print review. | Traces for failures, results by supported browser, reviewed document samples. |
| Windows operational | Fresh install, service startup, update, rollback, encrypted scheduled backup, restore and elapsed recovery. | Runbook annotations, timestamps, service logs and reconciliation output. |

Use an isolated test schema or database per parallel worker where needed. Integration jobs start from blank and previous-release databases. Fixtures use reproducible identifiers, event times and data. Tests that exercise the business day freeze time and explicitly select Asia/Karachi. Retain sanitized reports and traces with the run.

## Critical scenarios

| ID | Milestone | Case | Acceptance evidence |
| --- | --- | --- | --- |
| TP-01 | M0, M10 | Environment and build | A clean Windows checkout installs from its lockfile and runs lint, type checking, tests and build. Required configuration fails clearly at startup when absent. The English catalog supplies visible shell labels. |
| TP-02 | M1, M4 | Decimal values and numbering | Known calculations and generated values verify half-up rounding of each buy and sell amount, difference-based profit, 3-decimal weights, range limits and overflow. Concurrent valid submissions receive unique consecutive numbers for their year. Invalid input and failed transactions preserve the number counter. |
| TP-03 | M2 | Login, recovery and session lifecycle | Test first-Owner CLI, first-login password change, email and username login, mandatory production Owner TOTP, optional staff TOTP, logout, logout-all-devices, role changes, disablement and expiry. Recovery works once within its time limit. Failed authentication returns consistent public feedback and respects the configured rate limit. |
| TP-04 | M2–M9 | Permissions and projections | Run policy cases for each role, then assert allow/deny at the normal server entry points with role, resource ownership and business date fixtures. Unauthenticated requests take the sign-in path. Operator dispatch results, dashboard, slip, and page data exclude purchase rates, buy amount and profit. Check report, export, administration and backup access independently. |
| TP-05 | M3 | Settings and master data | Create, edit and deactivate parties. Validate phone, party code, mine and supplier relationship. Verify historical references after deactivation and that posting requires an active party. Verify profile, bank list, unit, document settings and effective prefix changes. |
| TP-06 | M4 | Bulk and edited dispatches | Generate multi-row grids, apply same-supplier/mine and copy helpers, use keyboard flow and quick-add as an authorized role. Preserve form entries on a row error and roll back the complete batch. Repeating a successful request returns its original result. Save Operator dispatch pending pricing and post it once when priced by Accountant or Owner. Test the Operator's scoped posted-order metadata edits and confirm the ledger and financial snapshots are unchanged. Verify duplicate warnings, authorized correction and Owner soft delete with reason. Review the date printout and a dispatch slip. |
| TP-07 | M5 | Receipts, supplier payments and cheques | Verify opening and outstanding amounts, method and bank validation, duplicate prevention, explicit overpayment confirmation, running advance balances and restrictions in locked periods. Post a customer receipt and supplier payment, print both voucher types and exercise receipt/deposit/clear/bounce. A bounced cheque creates one reversal in the designated open period. |
| TP-08 | M6 | Details and ledgers | Use search, filters, stable sorting, pagination, leap dates, All/Orders/Payments, authorized row actions and bulk soft delete. Compare displayed totals to the full filtered set and compare ordered balances across pages. Verify CSV/print labels, escaping, and the required export scope. |
| TP-09 | M7 | Reports and integrity checks | Exercise all five reports, prescribed filters, Sales grouping, single-party reports, summaries, closing banners, empty ranges and document output. Integrity check detects a fixture marked inconsistent by the test setup and reports the discrepancy without mutating accounting data. |
| TP-10 | M8 | Dashboard | Verify preset and custom filters, day/month/year/all-time summary, all business KPIs, chart, receivable/payable balances, recent orders and transactions. Every shared financial figure equals the corresponding report result for identical filters and dataset. Check long PKR amounts at desktop, tablet and phone widths. |
| TP-11 | M9 | Period locks, audit and backup | Lock an accounting period during a write workflow and verify the atomic rejection and unchanged journal. Unlock with a reason and verify audit evidence. Exercise Owner backup status, encrypted artifact, restricted access, retention and stale warning. Verify runtime audit append/read grants and the expected audit events and redactions. |
| TP-12 | M10 | Production-like hardening | Check configured TLS and cookie policy, security headers, allowed origins, validation, safe CSV rendering, neutral errors and sanitized logs/health responses. Review a complete ASVS Level 2 checklist with evidence. Exercise Windows rollback and restore, accessibility and performance. |
| TP-13 | M11 | Localization | Verify complete English, Urdu and Pashto catalogs after M10 passes. Confirm persisted locale, both RTL layouts, Western and alternate digits, Pashto glyphs, font embedding, email, and translated or bilingual slips, vouchers and reports. Record native-speaker review status. |

## Reconciliation and race tests

- Seed customer receivables and supplier payables with opening amounts and date-ordered sales, purchases, receipts, payments, adjustments and reversals. Opening plus period activity must equal closing for every party and group, including same-day events and periods with no activity.
- Cross-check summary values against the individual report, ledger and dashboard. Verify cash balance using cash-in and cash-out rules across cheque states. Validate that drafts do not affect financial balances.
- Generate constrained collections of decimal weights/rates, postings, paid amounts and cancellations. Independently compute minor-unit totals and compare them with the persisted/query results. Include rounding boundaries, overpayments and high totals.
- Repeat and parallelize valid batches and payments against PostgreSQL. Test one invalid row, duplicate submission keys with the same or changed payload, a fault within a transaction, and a write concurrent with a period lock. Check state, audit events, voucher and order numbering and balances after commit or rollback.
- Compare the same report across a period boundary in UTC and Asia/Karachi. Assert consistent boundaries for week, month, year and custom ranges, using leap day and year-end fixtures.

## Performance, accessibility and recovery

Run a seeded test at 100,000+ orders and a headroom run at 500,000 orders and 10,000 payments. Distribute dates across several years, combine frequent and infrequent parties, and include active and inactive parties, pending dispatches, voids and different cheque states. Report generator seed and record counts, server and database versions, Windows host resources and cache state. Measure list/search/pagination, posting, dashboard and all five reports. Measure typical page p95 against the two-second target at 1 and 10 staff sessions. Record broad date range and export timings separately, review query plans and verify all totals with the same large fixture.

Verify WCAG 2.1 AA through automated checks and manual keyboard, visible focus, dialog, screen reader, zoom/reflow and contrast testing. Cover desktop, tablet and phone. Report checks for the latest two Chrome, Edge, Firefox and Safari versions. Run native Safari verification on an available Apple platform in addition to Playwright WebKit.

The accessibility browser spec scans 28 desktop screens, six phone-width screens and two open dialogs with the axe-core WCAG 2.0 and 2.1 A and AA rules. It also checks horizontal reflow at 390 px, the skip link and keyboard opening, Escape and focus restoration for mobile navigation and Quick Receive. Run it against the local test environment with `npm run test:e2e:prepared -- tests/e2e/accessibility.spec.ts`.

Set `PLAYWRIGHT_BROWSER` to `chromium`, `firefox` or `webkit`. Chromium defaults to the installed Edge channel. Set `PLAYWRIGHT_CHROMIUM_CHANNEL=chrome` to use installed Chrome. Set `PLAYWRIGHT_APP_PORT` to override the default loopback port 3147. The native database test harness provisions a fresh database for each run when `RUN_BROWSER_TESTS=1`.

Install the Firefox and WebKit builds pinned by the repo's Playwright version. The same browser cache setting must be present when running their tests.

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = 'D:\KhanCoal-QA-Browsers'
npm.cmd exec -- playwright install firefox webkit
```

With synthetic data on Windows Server, verify that one service starts after reboot and recovers from process failure. Run the scheduled encrypted backup and observe retention settings. Restore a copy in a designated test database, verify the identity/recovery runbook, compare counts and financial results and record measured RPO and RTO against 24 hours and 4 hours. Verify the update and rollback paths using previous and current builds.

At each milestone record commands, exit status, test summaries and known gaps. At release, map every accepted requirement to code and test evidence. Record planned, passing, failing or explicitly deferred results and the evidence reference.

## Local test evidence

The 23 November Windows build passed lint, type-checking, the production build, 77 unit tests, and 85 native PostgreSQL integration tests. The Windows encrypted backup and restore drill reconciled the test payment, preserved the primary file on a simulated mirror failure, and verified the scheduled mirror against an isolated destination.

The browser checks ran on Windows 11 Enterprise build 26300 with PostgreSQL 17.12 and Playwright 1.65.1.

| Browser | Build tested | Result |
| --- | --- | --- |
| Microsoft Edge 158.0.4370.33 | `e167301` | Six workflows passed, including 36 accessibility scans and mobile keyboard checks. |
| Google Chrome 156.0.8078.74 | `e167301` | Six workflows passed, including 36 accessibility scans and mobile keyboard checks. |
| Microsoft Edge 158.0.4370.33 | 22 November HCI build | Seven workflows passed, including the 36 accessibility scans, the Sales chooser scan, and the dispatch and balance recovery checks. |
| Playwright Firefox 159.0 | 22 November HCI build | Five staff workflows passed across the Sales chooser, role access, company setup, dispatch, and payments. |
| Playwright WebKit 27.2 | 22 November HCI build | The same five staff workflows passed on Windows. |
| Edge 158.0, Firefox 159.0, and Playwright WebKit 27.2 | Local preview | First sign-in and mandatory password-change screen passed at 390 px without horizontal overflow. |

Combined V8 coverage for `src/domain` and `src/server`, merged by source location, was 85.30% of statements, 87.70% of lines, and 76.55% of branches. The money module reached 100% on all four V8 measures. The PostgreSQL suite reached 100% of statements, branches, and functions in the party ledger, cash movement, and party balance rollup modules.

On 23 November, Edge, Playwright Firefox, and Playwright WebKit each passed all seven workflows against isolated PostgreSQL databases. The suite covered desktop and mobile accessibility, period reopening and audit filtering, Sales lookup, Viewer access, opening balances, dispatch, payments, and voucher PDFs. The WebKit regression check confirmed keyboard focus reaches the skip navigation link.

The usability checks cover opening and closing the large Sales party chooser by keyboard, preserving its selection across navigation, retaining an unsaved dispatch when the user cancels navigation, moving focus to an invalid dispatch field, and recovering from an interrupted balance lookup before saving a payment. Automated accessibility scans and keyboard tests complement the manual screen-reader and native Safari checks required for release.

## 23 November Vercel verification

The public service returned HTTP 200 on `/healthz` and HTTP 503 on `/readyz`. Sign-in rendered the retry panel. The Vercel response confirmed that the function moved from Washington to Singapore to match Neon. An isolated Vercel-mode smoke test with the other settings populated confirmed that a missing SMTP URL and sender leave the app unready and report only the safe field names in private logs. Verify hosted database access, Owner sign-in, and actual mail delivery after those settings are saved and the deployment is rebuilt.

## 23 November full regression on 6314cce

The production build, lint, and type checks passed. All 77 unit tests, 85 PostgreSQL integration tests, and 21 browser workflows passed. The browser runs used Edge, Playwright Firefox, and Playwright WebKit at desktop and mobile widths. Signed-out checks redirected normal workspace, export and print requests to sign-in. The backup download rejected both an unauthenticated same-origin POST and a cross-origin POST.

The encrypted restore drill reconciled PKR 168.74 and verified preservation of the primary archive after a simulated mirror upload failure. The dependency audit reported zero known vulnerabilities, and the redacted Git history scan reported zero leaks.

With 100,000 synthetic orders, 10,000 payments, and 210,033 journal entries, all 440 typical page requests and 55 dispatch posting batches succeeded. The dashboard reached 1.529 seconds p95 with ten sessions. Account reached 2.112 seconds p95 with ten sessions, above the two-second target. The accounting integrity scan returned zero findings. The prior 500,000-order timeout findings still require a fix and a capacity rerun.
