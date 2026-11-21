# Security threat model

The scope is the rebuilt single-company application on a Windows Server. The model covers the application, database, backups, delivery pipeline, and dependencies used by the release. The prototype provides a reference for the rebuild.

## Assets and entry points

| Asset | Protection goal | Entry points or trust boundary |
| --- | --- | --- |
| Staff identity, sessions and recovery factors | Only active staff with valid credentials receive authorized access. Recovery carries short-lived, single-use authority. | Browser to HTTPS proxy and app. Reset notification to configured mail relay and recipient. |
| Orders, rates, balances, vouchers and period locks | Accurate, reproducible history with traceable corrections and unique numbering. | Browser to app through validated actions. App to PostgreSQL through role-limited connections. |
| Party contacts, commercial rates and generated documents | Information available only within the role and record scope. | Lists, reports, dashboard, page data, CSV and PDF routes, and printing to staff-managed devices. |
| Audit history and logs | Event evidence retains actor, time and changed state with limited personal data. | App to append-only audit tables. Host logs and backup/restore records to authorized maintainers. |
| Deployment keys, credentials and backups | Keys are held separately from backup data. Restore can recover a verified, authorized state. | Deployment identity to Windows service and database. Task Scheduler to encrypted storage. Restore operator to designated database. |
| App artifacts, migrations and availability | Reviewed, reproducible builds and recoverable outages. | GitHub Actions to source, dependencies and PostgreSQL. Release operator to Windows service, proxy and database. Minimal liveness and readiness probes. |

Roles and revocation are evaluated by the app against PostgreSQL. The reverse proxy terminates TLS and is the only network entry point to the app. Database traffic stays on the designated server boundary. OS identities for installation, migration, normal app operation and scheduled backup have separate duties and scoped access.

## STRIDE risks and controls

| ID | STRIDE | Risk | Planned controls and verification |
| --- | --- | --- | --- |
| TM-01 | Spoofing | A session represents a disabled user or someone other than its authenticated holder. | Argon2id password hashes, production Owner TOTP, first-login password change, neutral failure responses, durable rate limits, secure cookies, rotation, timeouts and revocation. Verify authentication and recovery states in integration tests. |
| TM-02 | Spoofing | A reset token, enrollment secret or recovery credential remains valid beyond its intended use. | Random reset tokens stored as digests with single use and short expiry. Bind reset links to the configured origin. Invalidate outstanding recovery tokens and sessions on successful reset. Protect factor seed and recovery material at rest through dedicated application keys or digests as appropriate. Verify lifecycle and redaction. |
| TM-03 | Tampering | Retried or concurrent writes duplicate rows, consume numbers without posting, or leave ledgers inconsistent. | Validate each row, recompute money server-side, serialize counters with the transaction, enforce unique constraints and idempotency, recalculate through the shared ledger layer, and make reversals append-only. Verify rollback and concurrent legitimate submissions against real PostgreSQL. |
| TM-04 | Tampering | An outdated form changes a closed period or posts against a deactivated party. | Recheck period lock and party state inside the posting transaction. Validate dates and revisions, preserve posted snapshots and apply corrections through reversal. Verify actor and period rules across order, voucher and cheque workflows. |
| TM-05 | Repudiation | Financial edits, role changes, backup or export activity lack attributable evidence. | Couple state changes and audit records in one transaction. Record actor, time, request ID, trusted source IP, and narrowly scoped before/after data. Restrict the runtime identity to appending prioritized audit events, and restrict read access to Owner. Verify denied audit update/delete and redaction. |
| TM-06 | Information disclosure | Sensitive rates, profit, contacts or financial history reach a role outside its scope. | Scope queries and construct role-specific responses before serialization. Apply the permissions matrix to all data reads and documents. Prevent shared caching of private responses. Verify Operator page data, dispatch slips, dashboards and errors omit restricted values. |
| TM-07 | Information disclosure | Tokens, credentials, audit details or transaction data escape through logs, probes, files or backups. | Redact structured logs and user errors, return minimal probe status, store deployment secrets externally, restrict backup directories, encrypt artifacts and keep decryption keys separately. Verify representative logs, backup restore, headers and response metadata. |
| TM-08 | Denial of service | Expensive exports, repeated authentication operations, or disk and database faults make the service unavailable. | Bound inputs and output sizes, use pagination and query indexes, cap export concurrency and time, rate-limit login/reset/export, rotate logs, retain backups on schedule, report stale backups, and monitor readiness. Record the performance and recovery drills. |
| TM-09 | Elevation of privilege | A user accesses an action or record reserved for a different role. | Deny by default at the service boundary. Check role and record ownership on every request, including PDF/CSV and background work on a user's behalf. Revoke sessions on role changes. Restore uses an OS maintenance identity. Verify the role matrix on the local test app. |
| TM-10 | Tampering | Request data crosses validation or document-rendering boundaries in a dangerous format. | Validate all inputs, use parameterized Prisma queries, encode user text for its output context, guard same-origin mutations, apply explicit browser security headers, and neutralize spreadsheet formula interpretation in CSV cells. Limit and validate uploaded logo images. Verify parser behavior, allowed origins, headers and rendered data. |
| TM-11 | Tampering | A deployment includes unreviewed dependencies, migrations or secrets. | Use lockfile-based installs, audited dependencies and licenses, secret scanning, CI migration and build gates, least-privilege service accounts and explicit environment configuration. Review passing CI results and deployment logs. |
| TM-12 | Denial of service and tampering | Reboot, storage loss, or a failed backup or restore ends in lost or partially recovered data. | Rotate encrypted backups with separate recovery key custody. Check backup exit status and artifact availability. Restore into a designated recovery database before acceptance. Verify the Windows service restart and measure RPO and RTO in a restore drill. |

## Standards and acceptance evidence

Use the OWASP ASVS 5.0.0 Level 2 verification target. The table maps controls to the chapters to review. The release security checklist will record applicable requirement IDs, evidence and status at the individual requirement level. [ASVS 5.0.0](https://asvs.owasp.org/downloads/)

| Area | ASVS 5.0.0 chapters | OWASP Top 10 2025 | Verification |
| --- | --- | --- | --- |
| Authentication, recovery and sessions | V6, V7, V11 | A04, A07 | TM-01, TM-02 |
| Access, browser controls and record scope | V3, V4, V8, V14 | A01, A02 | TM-06, TM-09, TM-10 |
| Validation, files and transaction integrity | V1, V2, V5, V15 | A05, A06, A08, A10 | TM-03, TM-04, TM-10 |
| Proxy, environment, release and recovery configuration | V11, V12, V13, V14, V15 | A02, A03, A04, A08, A10 | TM-07, TM-08, TM-11, TM-12 |
| Logging, audit, errors and health | V16 | A09, A10 | TM-05, TM-07, TM-08, TM-12 |

Risk identifiers use the [OWASP Top 10 2025 list](https://top10.owasp.org/2025/). See the [test plan](TEST_PLAN.md) for planned evidence. This planning document records design controls. Verification status is pending implementation.

## Operational risks to review before rollout

- The production Windows host is a single point of interruption. The Owner and server maintainer verify an independently recoverable backup copy and key availability during the restore drill.
- Windows administrators and database superusers can access or change protected data. Limit who has these roles and retain recovery and maintenance records with the backups.
- A recipient can retain exported files and printed documents after their account is disabled. The client defines handling and retention expectations before rollout.
- The client supplies a trusted SMTP relay for recovery, staff addresses, certificates, and contact and financial retention requirements. Record configuration and ownership in the runbook.
- Review this model when a permission, new file format, integration, or deployment boundary changes.
