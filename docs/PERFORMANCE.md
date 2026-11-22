# PostgreSQL performance rehearsal

Run the benchmark from the repository on Windows with Node 22 or 24 and PostgreSQL 17 binaries available. The runner starts a fresh PostgreSQL cluster and a production Next.js build on loopback. It generates data inside that cluster and removes the isolated data directory after PostgreSQL stops.

```powershell
npm.cmd run build
$postgresBin = 'C:\Program Files\PostgreSQL\17\bin'
.\scripts\benchmark-postgres-windows.ps1 -PostgresBin $postgresBin -OrderCount 100000 -PaymentCount 10000 -ReportPath "$env:TEMP\coal-performance-100k.json"
.\scripts\benchmark-postgres-windows.ps1 -PostgresBin $postgresBin -OrderCount 500000 -PaymentCount 10000 -ScratchRoot 'D:\' -ReportPath "$env:TEMP\coal-performance-500k.json"
```

Use a scratch volume with space for the benchmark database, indexes, and PostgreSQL write-ahead logs. Use new report filenames for repeat runs. `-AppPort` and `-DatabasePort` let the rehearsal use two unoccupied ports. Run the measurements while the server can use the intended resources without other benchmarks competing for them.

## Workload

The deterministic `integer-series-v1` fixture distributes business dates over the last 1,095 days from the Karachi business date. It creates 4,000 customers and 500 suppliers and mines. It includes frequently used and less frequent parties, active and inactive parties, pending-pricing dispatches, posted orders, voids, cash vouchers, and multiple cheque states including bounced cheques with reversal entries. PostgreSQL validates the same order and journal constraints used by the application.

The runner measures complete authenticated HTTP responses for the 14-day dashboard, all five reports, account workspace, and a filtered second page of Sales Details. It warms each route before measuring one staff session and ten concurrent staff sessions. The production build runs without an external reverse proxy over loopback. Timings include server rendering and full response-body transfer. Browser rendering, caching, and the client network require separate verification on deployment hardware.

The report records p50, p95, sample count, physical database size, fixture load time, Node and PostgreSQL versions, workstation resources, current range, and fixture counts. The broad-date dashboard and sales report and both export formats have separate single-session measurements. The posting samples run the normal order service with 20 dispatches per batch and validate the returned order count. The runner compares the dashboard and sales report totals for the same range, performs the Owner accounting integrity check, and records an `EXPLAIN (ANALYZE, BUFFERS)` plan for the canonical sales summary.

## 100,000-order baseline

The November 21, 2026 rehearsal ran on Windows build `10.0.26300` with an i7-1185G7, 8 logical CPUs, 32 GiB RAM, Node 22.18.0, and PostgreSQL 17.12. Other Windows application checks shared the workstation. The warmed database held 100,000 orders, 10,000 payments, and 210,033 journal entries and occupied 276 MiB. The fixture loaded in 128 seconds. The typical filtered period was November 8–21, 2026 in Karachi. Each route had 10 single-session and 100 ten-session attempts.

| Route                           | One session p95 | Ten sessions p95 | Failed ten-session responses |
| ------------------------------- | --------------: | ---------------: | ---------------------------: |
| Dashboard                       |          2.94 s |                — |                          100 |
| Sales Details search and page 2 |          4.43 s |           8.39 s |                            0 |
| Account                         |          3.87 s |           7.32 s |                           57 |
| Sales Report                    |          2.03 s |          10.46 s |                            0 |
| Customers Report                |          0.66 s |           1.51 s |                            0 |
| Single Customer Report          |          0.90 s |           5.42 s |                            0 |
| Suppliers Report                |          0.73 s |           2.79 s |                            0 |
| Single Supplier Report          |          0.36 s |           2.65 s |                            0 |

Percentiles use successful responses. All single-session attempts succeeded. The all-time dashboard and sales report took 4.10 and 1.75 seconds respectively at p95, while the all-time sales CSV took 1.54 seconds and the 14-day sales PDF took 1.39 seconds. All 110 posting attempts succeeded. Posting p95 was 0.42 seconds at one session and 1.63 seconds at ten.

The dashboard and Sales Report agreed on 1,259 trucks, 49,052.881 tons, Rs. 1,210,939,460.96 sales, Rs. 876,919,447.07 purchases, and Rs. 334,020,013.89 profit. The Owner found zero accounting integrity issues in 3.31 seconds. The signed sales summary used the journal business date index with a bitmap scan and joined the 2,546 matched entries to order revisions. Its warm PostgreSQL execution time was 77 ms.

Dashboard and Account exhausted the connection pool and reached Prisma transaction timeouts under concurrency. The dashboard was changed to compute its selected period, presets, and chart from one signed-journal aggregation and read both outstanding balances from one ledger rollup. Account uses the same balance rollup and queries the dated balance only for the party selected in a receipt or payment form.

## 100,000-order replay after optimization

The replay used the same Windows workstation, software versions, seed, business dates, and row counts with less background test activity. The compact fixture occupied 233 MiB and loaded in 48 seconds. Each route had five single-session and fifty ten-session attempts. All 440 timed page responses succeeded. Each sample covers the complete loopback HTTP response.

| Route                           | One session p95 | Ten sessions p95 |
| ------------------------------- | --------------: | ---------------: |
| Dashboard                       |         0.480 s |          2.342 s |
| Sales Details search and page 2 |         0.627 s |          3.670 s |
| Account                         |         0.610 s |          3.071 s |
| Sales Report                    |         0.304 s |          4.289 s |
| Customers Report                |         0.183 s |          1.241 s |
| Single Customer Report          |         0.259 s |          1.647 s |
| Suppliers Report                |         0.185 s |          0.978 s |
| Single Supplier Report          |         0.098 s |          0.638 s |

In three samples each, p95 was 0.520 seconds for the all-time dashboard, 0.436 seconds for the all-time sales report, 0.444 seconds for the all-time sales CSV, and 0.431 seconds for the 14-day sales PDF. All 55 posting attempts succeeded at p95 of 0.221 seconds with one session and 1.328 seconds with ten. The selected dashboard and sales report totals matched the baseline figures exactly and the integrity scan again found zero issues in 0.989 seconds.

The replay met the two-second target for all single-session pages. Dashboard, Sales Details, Account, and Sales Report exceeded it with ten concurrent sessions. Resolving those tail latencies and measuring the 500,000-order and 10,000-payment workload on the target Windows Server remain release acceptance tasks.

## 22 November local follow-up

The Windows rerun used 100,000 orders, 10,000 payments, five single-session requests per page, and fifty requests per page at ten concurrent sessions. All 440 measured page responses succeeded. The dashboard and Sales Report reconciled exactly, and the accounting integrity scan returned zero findings.

| Page | Previous ten-session p95 | Current ten-session p95 |
| --- | ---: | ---: |
| Sales Details | 3.670 s | 0.530 s |
| Sales Report | 4.289 s | 0.237 s |
| Account | 3.071 s | 2.150 s |
| Dashboard | 2.342 s | 2.400 s |

The Sales screens now search large party directories on demand. On this fixture the Sales Details response rendered 17 select options and the Sales Report rendered 22. Those counts include the standalone month, page size, and grouping controls. Account reuses one ledger balance snapshot and sorts amounts numerically. Dashboard's date rollup reads revision weights for sales entries only. Account and Dashboard still exceed two seconds at ten sessions, and capacity testing on the deployment host remains open.

## 22 November local 500,000-order run

The same production build ran on a Windows 11 development workstation with an i7-1185G7, eight logical CPUs, 32 GiB of RAM, Node 22.18.0, and PostgreSQL 17.12. The isolated database held 500,000 orders, 10,000 payments, and 1,006,829 journal entries. Typical date-filtered pages requested the 14 days ending 22 November 2026, with five requests per page at one session and fifty at ten sessions.

| Page | Single-session p95 | Single-session errors | Ten-session p95 | Ten-session errors |
| --- | ---: | ---: | ---: | ---: |
| Dashboard | — | 5/5 | — | 50/50 |
| Sales Details search and page 2 | 1.146 s | 0/5 | 3.974 s | 0/50 |
| Account | 3.840 s | 0/5 | — | 50/50 |
| Sales Report | 0.320 s | 0/5 | 1.486 s | 0/50 |
| Customers Report | 1.485 s | 0/5 | 5.054 s | 36/50 |
| Single Customer Report | 1.573 s | 0/5 | 4.225 s | 0/50 |
| Suppliers Report | 1.543 s | 0/5 | 5.625 s | 43/50 |
| Single Supplier Report | 0.591 s | 0/5 | 1.988 s | 0/50 |

Percentiles use successful requests. There were 184 HTTP 500 responses from 440 typical requests and three more from the all-time Dashboard. Logs showed transactions expiring against Prisma's five-second limit. Account returned about 1.26 MB of HTML with 4,311 select options. The all-time Sales Report, all-time Sales CSV, and 14-day Sales PDF each succeeded in all three requests. Posting twenty dispatches succeeded in all 55 attempts, with a ten-session p95 of 2.085 seconds.

The separate Dashboard-to-Sales accounting comparison matched exactly and the integrity scan returned zero findings. Release work remains on the report queries and large party lists, followed by a capacity rerun on the deployment host. The runner now retains the JSON report when a measured operation or verification fails and exits with an error after writing it.
