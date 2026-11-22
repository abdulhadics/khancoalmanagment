# HTTP and server actions

KhanCoalSupplier serves its browser application and document routes from the configured HTTPS origin. Financial requests use the signed-in staff session and the current database role. The server applies record scope before reading document fields. Protected documents use `Cache-Control: private, no-store`.

## Health checks

| Method and path | Response                                                                                                                        | Access          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `GET /healthz`  | `200` with `{"status":"ok"}` while the app can respond                                                                          | Unauthenticated |
| `GET /readyz`   | `200` with `{"status":"ready"}` when the app can query the migrated role catalog. `503` with `{"status":"not_ready"}` otherwise | Unauthenticated |

Health responses use `Cache-Control: no-store`. The app also writes a structured probe event with timing and process-local totals to the Windows service log. Diagnostics reset when the process restarts. Monitor readiness separately from liveness so a database outage remains visible.

## PDFs, CSVs and backups

| Method and path                 | Inputs                                                                                                         | Staff access                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `GET /orders/print`             | Required `date` in `YYYY-MM-DD`                                                                                | Owner, Accountant, and Operator within their dispatch scope |
| `GET /orders/{id}/slip`         | Order UUID                                                                                                     | Owner, Accountant, and Operator within their dispatch scope |
| `GET /account/vouchers/{id}`    | Voucher UUID                                                                                                   | Owner and Accountant                                        |
| `GET /details/{section}/export` | `section` of `sales`, `customers`, or `suppliers`. Required `format` of `pdf` or `csv`                         | Owner and Accountant                                        |
| `GET /reports/{section}/export` | `section` of `sales`, `customers`, `customer`, `suppliers`, or `supplier`. Required `format` of `pdf` or `csv` | Owner and Accountant                                        |
| `POST /admin/backups/download`  | Same-origin form submission with the current session                                                           | Owner                                                       |

PDFs use `application/pdf` with inline disposition so the browser can print them. CSVs use `text/csv; charset=utf-8; header=present` with attachment disposition. The backup route creates and streams one encrypted `.dump.age` attachment. It returns `403` for an origin mismatch, `404` outside Owner scope, and `303` to the backup page when the job is busy, unconfigured, or failed. [Backup and restore](BACKUP_RESTORE.md)

Document requests from a signed-out session redirect to sign-in. Missing or unauthorized documents return `404`. A malformed date, filter, or format may return `400`. Exceeding document bounds returns `422`. Requests exceeding the print/export rate limit return `429` with `Retry-After: 300`. Each successful authorized export is audited.

## Export fields

All report and details exports accept `year`, `month`, `from`, and `to`. Months are `1` through `12`, and dates use `YYYY-MM-DD`. Explicit dates intersect the selected year or month. The selected ending business date is inclusive in Pakistan Standard Time. Party balances run through the current business date when the report omits an ending date.

| Export                                                | Additional fields                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sales details                                         | `customerId`, `supplierId`, `q`, `sort`, and `direction` (`asc` or `desc`). Sort keys include `orderNo`, `businessDate`, `customer`, `supplier`, `mine`, `vehicleNo`, `weight`, `purchaseRate`, `buyAmount`, `sellRate`, `sellAmount`, and `profit` |
| Sales report                                          | `customerId`, `supplierId`, and `groupBy` (`entry`, `date`, `customer`, `supplier`, or `mine`)                                                                                                                                                      |
| Aggregate customer and supplier reports               | `q` for party search                                                                                                                                                                                                                                |
| Customer and supplier ledgers or single-party reports | Required `partyId` UUID. Optional `q`, `tab` (`all`, `orders`, `payments`), and `sort` (`date-asc`, `date-desc`, `amount-asc`, `amount-desc`)                                                                                                       |

Exports cover the selected filters across pages and ignore `page` and `pageSize`. PDFs accept up to 1,000 result rows and CSVs accept up to 10,000. Narrow filters after an export exceeds its limit. Ledger balances include the full signed movement for the party before tab or search display filters.

## Sales party lookup

`GET /reports/party-options?kind=customer|supplier&q=...` searches party names and codes for signed-in staff with report access. It returns up to 20 options and a flag indicating whether more matches exist. Inactive parties remain available for historical reporting. Responses use `Cache-Control: private, no-store`.

## Browser mutations

The browser submits form mutations through Next.js Server Actions. Their generated action identifiers are build-specific. The actions check the expected origin and validate input on the server. Protected actions resolve live session and role permissions again before mutation. Order batches and payment writes support retry-safe request identifiers. Record scope and period locks are checked inside the financial transaction.

| Area                           | Actions                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Authentication and profile     | Sign in, forced password change, TOTP enrollment and verification, password reset, password change, sign out and revoke sessions |
| Customers, suppliers and mines | Create or update masters, manage mines, and apply authorized opening-balance changes                                             |
| Dispatch                       | Submit an order batch, edit dispatch, add a party inline, and void selected orders as Owner                                      |
| Accounts                       | Record a receipt or payment, verify dated balance, advance cheque state, and void a voucher as Owner                             |
| Settings and administration    | Save company and bank settings, manage staff, and close or reopen accounting periods                                             |

The app assigns a fresh `X-Request-ID` for each matched request. Provide it when investigating a failed browser operation. App request logs use allowlisted methods and route labels. Cookie values, form values, query strings, and individual record identifiers stay out of these records. The authenticated audit viewer can correlate authorized activity by Request ID. [Roles and scopes](PERMISSIONS.md)
