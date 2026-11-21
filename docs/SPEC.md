# KhanCoalSupplier functional specification

KhanCoalSupplier records truck purchases and sales, collections, supplier payments, and outstanding party balances for one Pakistani coal trader. Each dispatch links one customer, one supplier, and one of that supplier’s mines. The desktop workspace supports fast keyboard entry and reconciles those transactions across management screens, reports, and printed documents.

The pasted build brief defines the requirements. The prototype at `salmancoalapp.dmindex.com` and the screenshot document inform navigation, terminology, and appearance. The new application uses a distinct dark navy and indigo interface with white cards, accessible status indicators, and consistent typography and spacing.

## Business defaults

| Setting | Default |
| --- | --- |
| Company and staff | One company with 2–10 staff and one initial Owner |
| Currency | PKR, `Rs.`, grouping separators, and two decimal places |
| Weight | Ton, three decimal places, configurable label of Ton, Tonne, or MT |
| Business timezone and date | Asia/Karachi with a display such as `20 Nov 2026` |
| Initial locale | English with centralized UI and document message keys |
| Deployment | One native Windows application process and PostgreSQL on the client’s Windows Server |

## Authentication and access

| Given | When | Then |
| --- | --- | --- |
| An active user with valid credentials | They submit their email or username and password | The server creates and rotates a revocable cookie session and records the login. A user due to change credentials completes that step before entering the workspace. |
| Invalid credentials or repeated failures | A login attempt is made | The response uses a generic error, the server applies a progressive delay or temporary lockout, and a redacted event is recorded. |
| A disabled user or expired session | A protected route or mutation is requested | The server rejects the request and the screen offers a path back to sign in. |
| A user has an active session | They sign out or sign out of all devices | The applicable sessions are revoked immediately. |
| A user requests a password reset | A valid, unexpired single-use reset link is completed | The new password is validated, the token is consumed, and existing sessions are revoked. Request responses are generic and rate limited. |
| A new Owner is required | The server administrator runs the first-Owner seed | The seed reads credentials from the environment, validates them, and creates the account without logging secrets or overwriting an existing Owner. |
| An Owner signs in to production | TOTP is required for access | The Owner enrolls if necessary and proves possession before accessing the app. Non-Owner users can enable TOTP from their profile. |
| An Owner opens user management | They create, disable, assign a role, or reset a user | Server-side checks protect the last active Owner, changes are audited, and the list displays role, status, and last successful login. |
| An Accountant, Operator, or Viewer requests a privileged operation directly | The route, action, or export receives their request | The server applies the same permissions used by navigation and checks ownership, record date, and field access where applicable. An Operator never receives buy rates, purchase amounts, profit, or reports in any response. |

The Owner administers the application and its data. The Accountant handles orders, payments, master data, ledgers, reports, and exports. The Operator views parties and operational dashboard data and creates dispatches pending pricing. Within the current business day and an open period, the Operator can edit their own pending dispatches or update vehicle, bilty, and notes on their own posted orders. The Viewer reads dashboards and reports. The complete action and field matrix lives in `docs/PERMISSIONS.md`.

## Dashboard and workspace

| Given | When | Then |
| --- | --- | --- |
| The user opens the dashboard | They choose Today, This Week, This Month, This Year, All Time, or a custom range | Operational and financial values follow the selected business-date period and their role. Period summary cards show trucks, loaded weight, and sales for today, month, year, and all time. |
| The user has access to financial KPIs | The selected period has orders and financial entries | The dashboard displays active and total companies, supplier dues, cash out, balance in hand, trucks, weight, sales, purchases, and net profit from shared queries. Metrics shown in multiple contexts share the same definition and labels. |
| The user loads the dashboard | The monthly series and activity are available | The view shows a twelve-month sales and purchase chart, receivables and payables, recent orders, and recent account transactions subject to field permissions. |
| The same permitted user selects the same dates in dashboard and reports | Both surfaces finish loading | Count, weight, purchase, sale, and profit aggregates agree. Empty periods display zero values and a clear empty state. Large currency amounts stay together and fit the KPI cards. |
| A user navigates between screens | The workspace header is shown | It displays the current Karachi date, the appropriate Quick Receive and New Order actions, and profile, password, TOTP, sign-out, and settings access according to permissions. Quick Receive opens the receipt form with the same validation as the account page. |

## Order entry and dispatch

| Given | When | Then |
| --- | --- | --- |
| A dispatcher has order-create permission | They select a business date and entry count | The form creates that many editable rows for serial, customer, supplier, mine, vehicle, weight, purchase rate, buy amount, sell rate, sell amount, profit, and duplication. Buy and profit fields and amounts follow field permissions. |
| The entry grid has multiple rows | The user chooses a shared supplier or mine, copies the prior row, duplicates a row, or clears the form | The corresponding rows update with compatible party and mine values, duplicate vehicle or slip data is confirmed by the user, and live weight and monetary totals recalculate immediately. An unsaved-changes prompt protects entered data. |
| Staff enter dispatches by keyboard | They press Tab, Enter, or the advertised add-row shortcut | Focus follows a predictable row order and remains accessible to keyboard and assistive technology users. |
| An Owner or Accountant needs a missing party | They select the inline add action | They can create the party and select it in the current row while preserving the other dispatch inputs. A mine selection is limited to the selected supplier’s mines. |
| At least one row contains invalid data | They submit the batch | No row is persisted. The invalid cells show row-specific errors and preserve entered values. Validate active parties, mine ownership, normalized vehicle, positive weight, nonnegative rates, business date, and potential vehicle or bilty duplicates. |
| Every row is valid and the period is open | An Owner or Accountant submits a priced batch once or retries it with the same request key | All rows, canonical calculated amounts, ledger effects, and audit records commit together exactly once. Order numbers use `ORD-YYYY-NNNN` by default, are unique, and consume no numbers on rollback. |
| An Operator dispatches trucks without access to the buying rate | They submit a valid batch | The server creates the dispatches with pending pricing and assigns their order references. An Owner or Accountant can enter the rates and post the financial effect exactly once. Reportable sales, purchases, and balances derive from posted amounts. |
| Orders exist for the selected date | The user opens the date list or selects Print | The list shows the matching orders and a printable date summary. Individual slips show the company letterhead, dispatch fields, document number, date, and preparer. |
| An authorized user selects Edit, Duplicate, or Delete | They confirm the operation | Edit preserves an audited financial history. Duplicate prepopulates a new unsaved dispatch. Delete requires a reason and writes soft-deletion metadata and an accounting reversal. Bilty or slip number, notes, creator, editor, and timestamps are retained as applicable. |

## Details and ledgers

| Given | When | Then |
| --- | --- | --- |
| Orders exist across periods and parties | The user opens Sales Details | The page provides year, month, date range, customer, supplier, text search, sortable columns, and page size. It shows order number, date, customer, supplier, mine, vehicle, weight, purchase rate, buy amount, sell rate, sell amount, profit, totals, and authorized slip, edit, duplicate, and delete actions. |
| An Owner selects several eligible orders | They submit a bulk deletion reason | The operation validates each target and period, writes the appropriate reversals and audit history in one transaction, and reports the affected count. |
| A customer has dispatches, payments, or opening balance | The user opens Customer Details | All, Orders, and Payments tabs show date, reference, type, party, vehicle or bank, mine or reference, weight, rate, bill debit, receipt credit, running balance, and permitted actions. Summaries show loaded weight, sales, received, outstanding, and entries. |
| A supplier has purchases, payments, or opening balance | The user opens Supplier Details | The equivalent ledger shows purchase increases and payment decreases against the supplier’s running payable and the corresponding weight, purchase, paid, and payable summaries. |
| A list has enough records to cross page boundaries | The user changes sort, searches, paginates, or exports | The server queries the requested page, keeps running balances consistent across page boundaries, and produces a full filtered PDF, print view, or CSV with the same totals and field permissions. |

## Account, vouchers, and cheque handling

| Given | When | Then |
| --- | --- | --- |
| The account page has activity | An authorized user opens it | They see total received, total paid, customer pending, supplier to pay, balance in hand, and total vouchers. The customer and supplier tables show billed, received or paid, pending balance, a text status, and quick ledger and payment actions. |
| A receipt or payment is being prepared | The user selects a party, method, bank, date, reference, positive amount, and optional notes | The current party balance displays and inputs follow the configured bank list. Methods include Cheque, Cash, Bank Transfer, Online/IBFT, Pay Order, and Adjustment. |
| A valid account form is submitted twice or retried | The same idempotency key is used | One transaction posts the voucher, ledger effect, and audit history. The default voucher numbering is unique, sequential, and rollback-safe. |
| A payment exceeds the outstanding receivable or payable | A user with payment permissions attempts to post it | The form identifies the excess. Explicit confirmation records it as an advance on the running balance. The ledger and reports continue to reconcile. |
| A cheque voucher was posted as Received | A permitted user deposits it, clears it, or marks a deposited cheque Bounced | The server validates the transition and audits it. A bounce posts a linked reversal exactly once. Depositing and clearing preserve the original posting. |
| A user opens Account Transactions | They filter, review, or print a voucher | The list exposes effective status and sequential references with role checks. Receipt and payment PDFs use consistent letterhead, typography, totals, date, and preparer. |

## Reports

| Given | When | Then |
| --- | --- | --- |
| Orders exist for the selected period | The user views Sales Report | Year, month, date range, customer, and supplier filters apply. Grouping works by entry, date, customer, supplier, or mine, with summary cards and grand totals. |
| Customers exist for the selected period | The user runs Customers Report | Each customer shows truck count, weight, opening balance, sales, receipts, and closing balance. Totals reconcile with customer ledgers. Authorized actions lead to Ledger, Receive, and View. |
| A customer is selected | The user runs Single Customer Report | Year, month, and date filters return the opening balance, running ledger, and closing receivable. |
| Suppliers exist for the selected period | The user opens Suppliers Report or chooses a supplier in Single Supplier Report | The reports show the same aggregate and per-party structure with purchases, payouts, and closing payable. Authorized actions include ledger and payment, consistent with the account screen. |
| An Owner or Accountant exports any report | They choose PDF, Print, or CSV | The server reproduces the filtered period results and allowed columns. Print and PDF output include letterhead, generated date, preparer, totals, and page numbering. CSV neutralizes leading formula triggers in data fields. The export is audited. |
| Historical postings and reversals exist | The Owner runs the integrity tool | It independently checks that opening balance plus period increases less decreases equals closing balance and reports discrepancies with record references. Automated tests cover the same invariant. |

## Customers, suppliers, and mines

| Given | When | Then |
| --- | --- | --- |
| The user opens Customers | They filter active state, search, or review a party | The list shows customer code, name, industry, contact, city, trucks, weight, sales, receipts, balance, and status, supported by KPI cards and permitted Ledger, Receive, New Order, and Edit actions. |
| A customer is created or edited | The authorized user submits name, industry, contact person, Pakistani phone, email, city, address, opening receivable, status, notes, or credit limit | The server validates submitted values, allocates a unique `CUS-` code on creation, preserves audited opening balance history, and reports credit-limit warnings when exposure exceeds the configured limit. |
| The user opens Suppliers | They search or review an existing party | They see code, supplier or mine name, contact, city, default mine, trucks, weight, purchases, payments, payable, and status with Ledger, Pay, New Order, and Edit as allowed. |
| A supplier or mine is created or edited | The authorized user submits name, contact person, phone, email, city or region, default mine number, address, opening payable, or status | The server validates the fields, allocates a unique `SUP-` code, associates each mine with one supplier, and permits multiple mines and one default selection per supplier. |
| A party has financial history | An authorized user removes it from active choices | The server deactivates it and retains all historical records and ledger links. |

## Settings, backups, and audit

| Given | When | Then |
| --- | --- | --- |
| The Owner opens company settings | They update company name, tagline, address, phone, email, logo, currency symbol, weight unit, bank names, document footer, number format, date format, or order and voucher prefixes | The server validates and audits the change. Updated settings appear in appropriate views and documents. Existing document numbers retain their assigned prefixes. |
| Backup scheduling is configured | Windows Task Scheduler invokes the daily job | The backup script creates an encrypted PostgreSQL dump in the configured folder, can copy it to a second destination, applies daily and monthly retention, and records status. A backup excludes application environment secrets. |
| The Owner monitors recovery readiness | The backup is older than 48 hours, failed, or has never run | The Owner sees the latest status and an actionable dashboard warning. The Owner can request an audited manual encrypted backup download. |
| A backup and its recovery key are available | The administrator runs the documented restore procedure in the intended environment | The script checks inputs, restores the data, and provides verification steps for the application, migration state, and ledger totals. The drill records elapsed time and recovery point. |
| A financial period is closed | Any user attempts to create, edit, reverse, or delete an affected posting | The server rejects the mutation. An Owner may reopen the period with an audited reason and then perform the correction separately. |
| An Owner opens the audit viewer | They filter records | They can inspect actor, action, timestamp, IP, and safe before and after fields for applicable mutations, access events, exports, backup, and restore events. The data store enforces append-only audit access for the application. |
| Someone requests health probes or production maintenance routes | They access the service | `/healthz` and `/readyz` return minimal status. Production exposes account, backup, and integrity controls only as authorized. Demo seeding is a nonproduction CLI operation. |

## Financial and data invariants

- Use `NUMERIC(14,2)` for money, `NUMERIC(12,3)` for weight, and `NUMERIC(12,2)` for rates. Use decimal arithmetic from input parsing through persistence. Round extended buy and sell amounts half-up to two decimal places once at posting, then compute profit as rounded sell amount minus rounded buy amount. Store those values as snapshots.
- Derive customer balance from opening receivable plus billed sales less receipts and supplier payable from opening payable plus purchases less payouts. Represent advances, corrections, adjustments, and cheque reversals as signed ledger effects. Maintain a deterministic order by business date and posting order within each date.
- Persist an immutable history of financial effects. A correction and any replacement post together with linked source references and an audit event. Update only the current order projection and associated metadata as needed for the edit interface. Soft deletion retains the record and requires a reason and actor.
- Store operational business dates as PostgreSQL `DATE` and event timestamps in UTC. Interpret date inputs, today, periods, and document dates in Asia/Karachi.
- Issue party, order, and voucher numbers inside the posting transaction. The corresponding counter and mutation roll back together. Persist a unique idempotency key bound to the actor, operation, and payload fingerprint. Reject a repeated key submitted with a different payload.
- Enforce PostgreSQL foreign keys, check and unique constraints, and filtering indexes. Validate at every request boundary and treat stored computed amounts as authoritative. Normalize vehicle identifiers and flag potential vehicle or bilty collisions for confirmation.

## Operational and quality acceptance

| Given | When | Then |
| --- | --- | --- |
| Staff use one of the latest two versions of Chrome, Edge, Safari, or Firefox at a desktop, tablet, or phone width | They navigate, enter forms, and review tables | The interface has visible focus, labels and feedback, accessible dialogs and tables, responsive layout, meaningful empty and error states, and WCAG 2.1 AA contrast and keyboard behavior. |
| A normal dataset or a generated dataset of 100,000 or more orders is available | Performance checks exercise representative list, report, and dashboard operations | Typical page loads target p95 below two seconds. Validate query plans and record behavior with 500,000 orders and 10,000 payments for headroom. |
| The Windows server is configured from the runbook | It restarts or its application process exits | The application starts or recovers as a Windows service. TLS terminates at the Windows reverse proxy and the PostgreSQL service stays accessible only to approved local clients. |
| The application receives requests from the browser or other clients | They authenticate, mutate, read, or export data | Requests encounter validated inputs, origin and CSRF checks where applicable, deny-by-default authorization and field rules, and parameterized database access. Secure response headers and redacted logs satisfy the security verification plan. |
| A release candidate runs through CI | Lint, type-check, tests, build, migration, dependency, and secret checks finish | Required checks pass, role boundaries and reconciliation have automated coverage, domain and service coverage is at least 80%, and money and ledger logic coverage is 100%. |
| M10 verification is complete | An enabled user selects Urdu or Pashto | Language preference persists. The application and documents render complete RTL text, correct digit ordering, and the selected single or bilingual print option. Translation review identifies machine-translated text for owner review. |

## Added by engineering

| Decision | Reason |
| --- | --- |
| Book cheque effects at initial posting and reverse them on bounce with the linked voucher | Preserves the requested lifecycle, prevents double reversals, and makes the effect of a bounce reproducible. |
| Default to party-level running balances with a FIFO informational view | Supports the present workflow and advances without requiring staff to allocate every payment to an order. Explicit per-order allocation remains optional. |
| Allow Operators to submit dispatches pending pricing and reserve financial posting for Owners and Accountants | Lets dispatchers record the truck movement while purchase rates remain confidential and avoids posting an estimated or zero purchase amount. |
| Keep original dispatch references and append linked accounting corrections | Preserves traceable history while allowing staff to fix errors through the requested Edit workflow. |
| Preserve the last active Owner and require elevated checks for sensitive changes | Maintains an administrative recovery path. |
| Use payload fingerprints and server-issued authorization checks for document downloads | Associates a retry with the correct operation and prevents direct export links from bypassing role restrictions. |
| Keep company-configured weight-unit labels separate from saved weight values | Preserves historical calculations if a display preference changes. Any physical conversion requires an explicit migration decision. |
| Bound each Details export to 1,000 PDF rows or 10,000 CSV rows | Keeps one request from exhausting the Windows app process. Over-limit requests identify the need for a narrower filter. |

Native mobile apps, multitenancy, payroll, yard inventory, external accounting integrations, and SMS or WhatsApp gateways are outside this release scope. Windows hosting credentials, reset email delivery settings, live-data migration approval, business copy, and human translation approval are rollout inputs. Development uses purpose-built test fixtures.
