# KhanCoalSupplier delivery plan

## Project status on 22 November 2026

The project is a Windows-native replacement for the coal dispatch and accounting workspace. PostgreSQL is the live database. The Owner can save business data in one encrypted backup archive and restore it to a fresh database.

| Work | Status | Evidence |
| --- | --- | --- |
| M0–M3 · Foundation, accounts, master data | Implemented | Windows app, PostgreSQL migrations, staff roles, sign-in and two-factor authentication, company settings, customers, suppliers, and mines |
| M4–M6 · Dispatch, payments, ledgers | Implemented | Atomic bulk dispatches, exact pricing, revisions and reversals, receipts, cheque handling, vouchers, and customer and supplier balances |
| M7–M9 · Reports, dashboard, administration | Implemented | Five reports with PDF and CSV, reconciled dashboard totals, period locks, audit log, integrity checks, and a successful encrypted restore drill |
| M10 · Release hardening | In progress | The current Windows build passed lint, type-checking, 73 unit tests, 83 PostgreSQL integration tests, seven Edge workflows, and five staff workflows each in Firefox and WebKit. The local installer preflight and encrypted restore drill passed in earlier runs. |
| M11 · Urdu and Pashto | Queued | Translation, right-to-left layouts, and bilingual print work follow the M10 release gate and require native-speaker review. |

The latest 100,000-order rerun completed 440 measured page requests. Sales Details and Sales Report reached 0.530 and 0.237 seconds at the 95th percentile with ten concurrent sessions. Account and Dashboard still exceed the two-second target at 2.150 and 2.400 seconds. The money module and the three targeted ledger modules reached full coverage in their respective suites. [Performance evidence](PERFORMANCE.md) · [Test evidence](TEST_PLAN.md)

The usability review added focus and screen-reader descriptions for invalid dispatch fields, confirmation before leaving unsaved work through the sidebar, and status and retry feedback for Account balance lookups. Large Sales directories now open a searchable chooser that keeps the selected party when the report changes. The local preview was verified through first sign-in at phone width in Edge, Firefox, and WebKit.

The deployment rehearsal requires an authorized Windows Server or VM with service and Task Scheduler permissions, a test HTTPS hostname, and a test SMTP relay. The rehearsal covers installation, restart, update and rollback, email delivery, and scheduled recovery. [Windows Server runbook](RUNBOOK.md)

Each milestone ends with a runnable repository, passing checks relevant to the implemented work, and a focused commit. The planning package is committed before M0. The final release gate includes evidence from a native Windows Server rehearsal, a real PostgreSQL run, and a backup and restore drill.

## Milestones

| Milestone | Deliverables | Definition of done |
| --- | --- | --- |
| M0 · Foundation | Initialize Next.js App Router, strict TypeScript, Tailwind and shadcn/ui foundations, English messages, responsive shell, environment handling, CI, and Windows-native setup guidance. | Install, lint, type-check, tests, and build run on Windows. The shell uses shared design tokens and English message keys. Any setup view reflects the initial feature availability. |
| M1 · Database | Implement the Prisma model and versioned PostgreSQL migrations, dedicated permissions, audit foundation, immutable posting records, scoped number counters, idempotency storage, and first-Owner CLI seed. | A clean native PostgreSQL database migrates successfully. Integration tests cover constraints, transaction rollbacks, concurrency, audit access, and seed safety. |
| M2 · Access | Build sign-in, sign-out, session expiry and revocation, first-use password change, recovery, user management, role and field enforcement, production Owner TOTP, rate limiting, and response security headers. | A signed-out visitor is routed to login. Each role is tested through the server boundary. Session expiry, role changes, lockout, password reset, and TOTP are covered. The base shell shows authorized navigation only. |
| M3 · Master data | Add company settings, customer and supplier lists and forms, search and filters, opening balances, supplier mines, and party deactivation. | Authorized staff can complete create and update flows. Inactive parties stay in history. Opening balances and mine ownership respect the data model and permissions. |
| M4 · Dispatch | Build bulk entry, keyboard shortcuts, shared fields, quick-add, copy, duplication, live totals, pending pricing, atomic order posting, order editing, soft deletion, date lists, and dispatch slips. | Tests cover a valid batch, row validation, retry, concurrent numbering, edit auditing, open-period corrections, scoped Operator access, and readable slips. |
| M5 · Account | Implement customer receipts, supplier payouts, pending tables, voucher printing, cheque lifecycle, overpayment handling, and banking configuration. | Tests exercise account effects and balances, one reversal on bounce, duplicate-submit safety, role checks, and voucher data and formatting. |
| M6 · Details | Implement Sales Details, Customer Details, and Supplier Details with server-side filtering, sorting, search, pagination, bulk actions, and exports. | Running balances and totals reconcile across pages and filters. Exports and actions obey role and field checks. |
| M7 · Reports | Build all five sales and party reports, report exports, totals and groupings, and the reconciliation checks surfaced in M9. | PDF, print, and CSV agree with ledger and report totals. Automated reconciliation covers opening, period activity, closing, reversals, and date boundaries. |
| M8 · Dashboard | Implement period summaries, KPI cards, chart, party balances, and activity using shared queries with reports. | Cross-view tests confirm the same permitted period yields identical totals. Long amounts fit prominent cards. Empty periods and restricted roles remain legible. |
| M9 · Administration | Implement closing and reopening accounting periods, audit viewer, Owner integrity tools, encrypted backup and restore, Task Scheduler setup, and last-backup status. | Locked periods reject changes. Restore verification exercises a real destination database. Owner actions are audited and backup retention is documented and reproducible. |
| M10 · Release hardening | Run role E2E, financial coverage, dependency and secret checks, accessibility and responsive audits, large-data performance tests, Windows Server deployment and recovery rehearsal, and complete the documentation and traceability matrix. | Every production requirement has code, test or verification evidence, and explicit status. No high or critical dependency advisories remain. Windows service lifecycle, HTTPS, database isolation, backup retention and restore are verified on the target platform. |
| M11 · Localization | Add Urdu and Pashto, RTL layouts, per-user preference, digit options, locale-complete validation and email copy, and print/PDF output with embedded fonts and bilingual choices. | M10 has passed. CI validates locale keys, RTL workspace flows and print output pass, Pashto letters render, and `TRANSLATION_REVIEW.md` identifies text requiring native-speaker approval. |

## Verification and commits

1. Verify each feature through its normal user or operator entry point and check its failure cases and permission boundaries.
2. Run lint, type-check, the relevant test suite, and production build before the milestone commit. Add the real PostgreSQL integration suite from M1 onward and expand Playwright flows as modules become available.
3. Record platform details, test commands, coverage for money and ledger logic, and reproducible results for migration, loading, recovery, and security exercises.
4. Commit with a descriptive Conventional Commit and report the delivered behavior and verification in two or three lines.
5. Update the requirements traceability matrix with requirement, implementation, evidence, and any documented deferral. Follow up on native-speaker approval before enabling reviewed localized text at rollout.

Common development checks run with Node and PowerShell on Windows. CI may add cross-browser and database jobs provided they preserve native Windows execution as the deployment path. Live database connections and production credentials are supplied during deployment.

## Risks and dependencies

| Risk or dependency | Handling |
| --- | --- |
| Dispatch staff need to enter trucks while purchase values stay confidential | Support pending pricing, with a clear handoff to Accountant or Owner and one posting action. Enforce the same visibility across source data, activity, reports, and slips. |
| Concurrent edits, repeat submits, and changes to historical dispatches can affect balances | Use transactional number counters and idempotency, append posting corrections, and enforce business-date locks at every authorized mutation. |
| Live business history and reference data may require migration | Build and test against synthetic data. A migration of live records requires an authorized export, reconciliation of opening balances, and rollout approval. |
| A single host has shared failure and recovery exposure | Install the app and database as recoverable services. Use scheduled encrypted backups and an optional second destination. Rehearse the documented recovery point of no more than 24 hours and recovery time of no more than four hours. |
| A Windows firewall, DNS, or certificate dependency can delay rollout | Document an HTTPS setup for both public DNS and local-network certificates. Confirm host access and scope before production deployment. |
| Password-reset email requires working delivery | Use configured SMTP at deployment and test delivery to a designated test address. Keep password resets auditable and include an Owner-managed recovery procedure. |
| Reporting over 500,000 orders can exceed the latency target on client hardware | Profile generated data, review execution plans and pagination, and record the database and host specifications with p95 results. |
| PDF browsers and fonts may render RTL forms differently | Select licensed embedded fonts, render samples in all three locales, and inspect mixed numeric and RTL fields before M11 release. |

## Rollout inputs

- Obtain the company profile and letterhead assets, owner identity, initial staff list, bank and payment configuration, SMTP access, and certificate setup details before first deployment.
- Confirm the business treatment of advances, cheque timing, the operating week, and opening balances with the Owner before loading production data. Development follows the assumptions in `docs/SPEC.md` and `docs/DECISIONS.md`.
- Use the client’s authorized Windows Server or a comparable Windows Server for the deployment and recovery rehearsal. Record any difference from the final target that affects verification.
- Obtain native-speaker review of translated UI and print output at the localization sign-off.
