# SQLite handover decision and progress

The client wants a single local database file and an off-machine copy of the business data. Use one Windows host as the writer. The installed app will write to a local `khancoal.db`. Staff on other office PCs can use the same app through their browsers. The database folder stays on the host. A cloud-synced folder can receive closed, encrypted snapshots for recovery. An office internet outage affects backup synchronization while local work can continue.

## Completed

`scripts/backup/sqlite-snapshot.mjs` takes a consistent SQLite snapshot, scrubs credential and session data using the same exclusion list as the PostgreSQL backup, compacts and checks the copy, encrypts it with age, and renames the finished `.db.age` file into the destination folder. The client keeps the private recovery key separately. The destination can be a local backup drive or the client's own sync folder. SQLite can create journal or WAL sidecar files while the database is in use. Each encrypted backup is one standalone file. The SQLite application will require an Owner recovery step after restore because the snapshot excludes authentication records.

On Windows with Node 22.18 and age 1.3.2, the encrypted snapshot restored committed WAL entries at the expected exact balance while the source connection stayed open. The six excluded tables were empty in the restored copy, their synthetic record contents were absent from the file bytes, and the source rows remained intact. A cloud account and scheduled job have yet to be configured or tested. Node 22.18 reports its SQLite API as experimental.

## Application migration

The running application still uses PostgreSQL. Its database access includes PostgreSQL-specific SQL, transaction behavior, and schema constraints. The SQLite schema and import command now copy an isolated, read-only PostgreSQL snapshot to a new `.db` file. The import stores currency as integer paisa and weight as integer thousandths of a tonne. It checks row counts, exact financial column totals, foreign keys, and SQLite integrity before publishing the file. Existing destination files are protected from replacement. The source is left intact.

The import preserves staff identities, settings, dispatch and payment history, journals, and audit records. It omits credentials and temporary authentication data. The initial schema adds append-only and ledger-source guards. The offline Owner recovery command prepares an audited temporary password for an existing active Owner in a verified SQLite-format copy with no existing credentials or sessions. App sign-in, atomic dispatch and payment writes, period rules, and report readers still need SQLite implementation and tests.

A read-only rehearsal against the Windows localhost preview published one SQLite file in a separate private profile folder. The source remained online and continued to pass readiness checks. This preview held settings, a customer ledger entry, and audit history. An encrypted archive of the SQLite copy was restored in a separate local folder, and its existing Owner recovered audited temporary access. Synthetic integration data exercises the monetary boundary, destination collision, and Owner recovery guards separately.

To rehearse an import, set `MIGRATION_SOURCE_DATABASE_URL` privately to the PostgreSQL source, create a protected local folder, and run the command below from the checkout. Use a new filename on a local filesystem that supports hard links, such as NTFS. The database is published only after verification. The command prints copied row counts and excluded table names. Keep this local database outside Git and outside the cloud-sync folder.

```powershell
node.exe scripts/import-postgres-to-sqlite.mjs 'D:\KhanCoal\data\khancoal-rehearsal.db'
```

Use the Owner recovery command on an offline imported or restored copy. Run these commands in PowerShell 7 so the password can be entered without echoing it. Supply the existing active Owner's username for that copy.

```powershell
$temporary = Read-Host 'Temporary Owner password' -MaskInput
$temporary | node.exe --import tsx scripts/recover-sqlite-owner.ts 'D:\KhanCoal\data\khancoal-rehearsal.db' 'owner'
Remove-Variable temporary
```

Before switching staff to SQLite, verify per-party ledger balances and report totals against PostgreSQL, test simultaneous staff submissions, and rehearse backup restore on another PC. Keep the PostgreSQL database available through migration and reconciliation. The cloud backup copy is for recovery. Simultaneous cloud editing would require a separate synchronization design.
