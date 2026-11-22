# SQLite handover decision and progress

The client wants a single local database file and an off-machine copy of the business data. Use one Windows host as the writer. The installed app will write to a local `khancoal.db`. Staff on other office PCs can use the same app through their browsers. The database folder stays on the host. A cloud-synced folder can receive closed, encrypted snapshots for recovery. An office internet outage affects backup synchronization while local work can continue.

## Completed

`scripts/backup/sqlite-snapshot.mjs` takes a consistent SQLite snapshot, scrubs credential and session data using the same exclusion list as the PostgreSQL backup, compacts and checks the copy, encrypts it with age, and renames the finished `.db.age` file into the destination folder. The client keeps the private recovery key separately. The destination can be a local backup drive or the client's own sync folder. SQLite can create journal or WAL sidecar files while the database is in use. Each encrypted backup is one standalone file. The SQLite application will require an Owner recovery step after restore because the snapshot excludes authentication records.

On Windows with Node 22.18 and age 1.3.2, the encrypted snapshot restored committed WAL entries at the expected exact balance while the source connection stayed open. The six excluded tables were empty in the restored copy, their synthetic record contents were absent from the file bytes, and the source rows remained intact. A cloud account and scheduled job have yet to be configured or tested. Node 22.18 reports its SQLite API as experimental.

## Application migration

The running application still uses PostgreSQL. Its database access includes PostgreSQL-specific SQL, transaction behavior, and schema constraints. The accounting migration will store currency as integer paisa and weight as integer thousandths of a tonne, checking individual values and aggregate bounds to keep totals exact. The port must cover atomic dispatch and payment writes, reversal and period rules, authentication, reports, and the import of any existing data.

Before switching staff to SQLite, verify balances and report totals against PostgreSQL, test simultaneous staff submissions, and rehearse backup restore on another PC. Keep the PostgreSQL database available through migration and reconciliation. The backup copy is for recovery. Simultaneous cloud editing would require a separate synchronization design.
