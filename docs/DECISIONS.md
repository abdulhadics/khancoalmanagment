# Architecture decision records

These records capture the choices used for the planning baseline. Amend the corresponding record when a later implementation decision changes the contract.

## ADR 001 Windows-native deployment

**Context.** A single company with up to 10 staff needs a reliable on-premises installation and a small operational footprint.

**Options.** Use a native Next.js process and PostgreSQL service, use IIS integration, or containerize the deployment.

**Decision.** Use native Next.js App Router, TypeScript, PostgreSQL, Prisma, Tailwind CSS, and shadcn/ui components. Run the Node application through NSSM and host HTTPS with Caddy. Bind app and database to loopback. Use Windows Task Scheduler for scheduled work. Use an existing SMTP relay for password reset messages.

**Consequences.** The client manages one application process, PostgreSQL and the HTTPS proxy through Windows tools. The runbook must verify native preflight, service restart and logging, firewall and DNS configuration, and public or local CA trust. Dependency upgrades follow the pinned release's supported Windows runtime.

## ADR 002 Immutable postings and controlled revisions

**Context.** Staff need to fix dispatch and payment errors, and historical records must remain explainable when reports change.

**Options.** Update original financial rows in place with an audit copy, calculate from the latest operational rows, or retain originals with dated compensating entries.

**Decision.** Use an append-only posting journal with exact decimal snapshots and reversal links. Keep current workflow records and immutable order revisions for drill-down and document reprints. Ordinary order corrections reverse the original posting on its original business date and apply the replacement on the corrected business date. Lock both months. Operational metadata-only revisions retain the original posting. Owners control soft deletion and period unlock.

**Consequences.** Report queries must use signed postings and preserve original values for reconciliation. Open-period corrections can change prior reports, and the journal and audit rows explain the change. Voided orders and vouchers keep their reference numbers. Closed periods stay fixed until an audited Owner unlock. Use reviewed corrective and expand-and-contract migrations so updates retain historical source records.

## ADR 003 Numbering period gates and retries

**Context.** Truck batches and payments may be retried or run in parallel. Valid records need continuous visible numbers and locked periods need consistent enforcement.

**Options.** Reserve native database sequence values, derive from the highest number, or lock and update scoped counter rows within the posting transaction.

**Decision.** Reserve and consume contiguous blocks from transactional counter rows. Share a PostgreSQL monthly locking gate across all financial changes and period controls. Persist idempotency keys and result IDs in the same transaction. Use separate counters for orders by year, vouchers, customer codes and supplier codes.

**Consequences.** The lock graph serializes competing writes in a known order. Gaps from failed writes are avoided, while voided numbers remain visible for audit. Prefix and dispatch-date edits preserve issued numbers. Integration tests must race independent connections, including writes against a concurrent month or year lock.

## ADR 004 Operator order entry and sensitive pricing

**Context.** Operators enter and edit same-day dispatches. Purchase rates and profit are restricted. A posted financial order requires a verified purchase rate.

**Options.** Require pricing staff before dispatch entry, fill a default purchase rate, or save pending dispatches for an authorized user to price.

**Decision.** Let Operators save and amend their own current-business-day pending dispatches and their non-financial metadata on their own posted current-day orders in open periods. Owner and Accountant can enter a complete posted order directly or price and post a dispatch. Keep Supplier and Customer quick-add restricted to authorized master-data roles.

**Consequences.** Pending dispatches have numbers and clear status but enter the financial order totals only when priced and posted. UI and response selection must omit buy and profit data from unauthorized contexts, including order detail, error responses and printable slips.

## ADR 005 Cheques advances and adjustments

**Context.** Receipts and payments can exceed current dues. Cheques can clear or bounce after a voucher has been issued. Book balances and cleared bank amounts serve different staff needs.

**Options.** Post cheques only at clearance or post at voucher issuance with a dated bounce reversal. Allocate payments to specific orders or maintain the party's running balance.

**Decision.** Post vouchers on receipt or issue. Track Received, Deposited and Cleared/Bounced events. A bounce posts one dated reversal in an open period. Summarize uncleared cheque value separately. Maintain running balances with an informational FIFO view. A distinct acknowledgement is required for an overpayment, which appears as an advance. Non-cash adjustments affect party balances and stay outside cash movement totals.

**Consequences.** Later cheque events can change the current payable/receivable while locked-period totals retain the earlier posted state. Staff-facing help defines balance in hand as net recorded cash/bank movements inclusive of issued cheque vouchers, with an uncleared breakdown. Specific-to-order allocation is deferred under the optional scope.

## ADR 006 Encrypted backup and restore

**Context.** The business requires a daily encrypted backup with a 24-hour recovery-point target and a 4-hour recovery-time target. An archive must exclude application secrets.

**Options.** Export plaintext SQL, encrypt to a server-held shared password, or encrypt a PostgreSQL custom archive to an offline-held private key.

**Decision.** Use a Windows scheduled PowerShell command, `pg_dump` custom format, and an age public recipient. Keep the age private recovery identity separately under Owner control. Store only successfully finalized encrypted archives in the retained directories. Exclude credential, session, challenge, and rate-limit data from the archive. Retain user identity and audit attribution. Use 30 daily and 12 monthly archives as the initial retention bounds. Keep an optional encrypted copy on a separate drive.

**Consequences.** A restore uses authorized access to the separately held recovery key and restores into a fresh database for verification. Re-create Owner credentials through audited recovery, then reset staff passwords and re-enroll factors. Staff sessions end on restore. The Owner can download an authorized completed encrypted archive. The timed recovery drill measures encryption, restore, reconciliation and service cutover. [PostgreSQL custom archives](https://www.postgresql.org/docs/18/app-pgdump.html) · [age recipient encryption](https://github.com/FiloSottile/age/blob/main/doc/age.1.ronn)

## ADR 007 Accounting basis and locale

**Context.** PKR currency, metric weights and Asia/Karachi business dates need a consistent storage and presentation contract.

**Options.** Use JavaScript numbers and locale-formatted dates at boundaries, store integer minor units, or use PostgreSQL numeric types and decimal arithmetic with explicit date semantics.

**Decision.** Use database NUMERIC and a decimal library with one half-up rounding rule. Store business dates as DATE and timestamps as instants. Keep PKR with two decimals and a metric-tonne basis with three decimals. Unit preferences affect the display label. Route interface and document text through typed message catalogs from M0, with Urdu and Pashto translations deferred to M11.

**Consequences.** Browser payloads preserve exact decimal strings and ISO dates. APIs remain locale-independent while the interface and exports choose formatting per locale. Operating staff verify Urdu and Pashto translations and printed examples before rollout.

## ADR 008 Authentication state and private exports

**Context.** A single-server deployment needs real-time session revocation, shared authorization across entry points, and bounded abuse handling.

**Options.** Use a stateless bearer token, add an independent auth/cache service, or use short-lived credentials and PostgreSQL-backed sessions.

**Decision.** Use Argon2id hashes, opaque session cookies, persisted session digests, PostgreSQL rate limits, short-lived reset challenges, and TOTP. Protect documents and CSVs through the same data-scope rules as their interactive views. PDFs run in the native Node service. CSV sanitization treats user-entered labels and references as text.

**Consequences.** The application depends on database availability for each protected request. Account disablement and permission changes take effect when the live database denies the session. Owners enroll TOTP before gaining full production access. Integration tests must cover cookie security, direct access to exports and object IDs, and field-level disclosure by role.

## ADR 009 Export size and data representation

**Context.** Staff can export document views from the same Windows app process that handles dispatch and account writes. The order database can grow beyond the size of a practical printed register.

**Options.** Generate the full result in memory, stream unbounded exports, or bound each request and prompt staff to refine its filters.

**Decision.** Bound Details exports to 1,000 PDF rows and 10,000 CSV rows. Return a filter-refinement error when more rows match. Exports reuse the screen filters across all matching pages and keep exact totals. CSV uses UTF-8, ISO business dates, exact decimals, and formula safeguards for text cells. PDF uses the company date and number formatting.

**Consequences.** Staff can export larger histories in date ranges. The app can validate row count before allocating the complete PDF or CSV, and the resulting document represents the full accepted range.
