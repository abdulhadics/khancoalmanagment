# Roles and permissions

The application uses one role per active staff account. The server checks the action, target record, current account state, and applicable business rules before reading or changing data. Pages, Server Actions, Route Handlers, PDF generation, and export paths use the same policy. A permission omitted from the policy is denied.

## Role matrix

| Action | Owner | Accountant | Operator | Viewer |
| --- | --- | --- | --- | --- |
| Sign in, manage own password and 2FA, sign out, revoke own sessions | Yes | Yes | Yes | Yes |
| View dashboard | Full and backup status | Financial | Dispatch summary | Financial |
| View parties and mines | Full | Full | Dispatch directory | Report filters and results |
| Create, edit, deactivate or quick-add parties and mines | Yes | Yes | — | — |
| Set or adjust opening balances | Yes | — | — | — |
| View orders | All | All | Own orders dated today, with dispatch fields only | Read-only report rows |
| Create orders, including bulk entry and duplication | Yes | Yes | Today, with dispatch fields only | — |
| Edit a pending-pricing dispatch | Yes | Yes | Own order dated today, with dispatch fields only | — |
| Price, post or correct an open-period order | Yes | Yes | — | — |
| Edit vehicle, bilty or notes on a posted order in an open period | Yes | Yes | Own order dated today | — |
| Print dispatch slip | Yes | Yes | Own order dated today, dispatch fields only | — |
| Soft-delete or bulk-delete orders with a reason | Yes | — | — | — |
| View Sales, Customer and Supplier Details and running ledgers | Yes | Yes | — | — |
| View account balances, transactions and vouchers | Yes | Yes | — | — |
| Record receipts or payments and advance cheque status | Yes | Yes | — | — |
| Reverse an erroneous payment with a reason | Yes | — | — | — |
| View the five reports | Yes | Yes | — | Read-only |
| Use report/ledger CSV, print or PDF export and voucher PDFs | Yes | Yes | — | — |
| Change company, bank and document settings | Yes | — | — | — |
| Create, disable and reset staff accounts, assign roles and view last login | Yes | — | — | — |
| View audit trail or run the integrity check | Yes | — | — | — |
| Lock or unlock accounting periods with a reason | Yes | — | — | — |
| Create or download an encrypted database backup | Yes | — | — | — |

The date in an Operator scope is the current Asia/Karachi business date, determined by the server at the time of the operation. Ownership is the authenticated creator recorded on the order. The Operator cannot change the actor or date to expand this scope. A source order must also be in scope before the server will duplicate it. A period lock blocks writes for all roles. The Owner can unlock a period through an explicit action with a recorded reason.

## Field access

- Operator party fields are limited to dispatch identities and active mines. Financial balances, opening balances, credit limits, cash transactions, purchase rates and amounts, and profit are omitted from responses, page data, validation feedback, dashboards, and documents. The dispatch dashboard uses truck and weight figures from the permitted order scope.
- Operator order forms exclude purchase rates and calculated purchase amounts and profit. Operator submissions create pending-pricing dispatches. Accountant or Owner supplies purchase rates and posts the order. Pending dispatches contribute no financial entries. Once posted, Operator edits are limited to vehicle number, bilty and notes and use an audited update. See [the functional specification](SPEC.md) for the posting rules.
- Viewer has the financial fields visible on authorized dashboards and reports, with no operational actions, audit details, backup metadata, or business-data export routes.
- Documents and exports have their own action checks and reuse the same field and record scope as their underlying data. Quick actions inside each screen follow the permission of the destination operation.

## Session and maintenance boundaries

Login, token recovery, and minimal health probes are the public entry points. A first-login password change or production Owner TOTP enrollment uses a limited session with access to the relevant setup flow. Disabled accounts and revoked, idle-expired, or absolute-expired sessions are denied. Account disablement, password reset, and role change revoke existing sessions. The last active Owner must remain available for administration.

Backup restoration uses the Windows runbook and OS-level maintenance credentials. Scheduled backups use a Windows task identity with restricted database and folder access. The production application exposes no data-reset or demo-seed actions. The local demo CLI requires a development or staging target.

Permission tests cover the matrix, record ownership and business date, hidden fields, role changes and session revocation, locked periods, and each authorized print or export path. See the [test plan](TEST_PLAN.md).
