# Windows backup and restore

The backup is one encrypted `.dump.age` file. It contains the PostgreSQL schema, migrations, business records, staff identities, and audit history. The dump excludes password and two-factor data, sessions, authentication challenges, throttle records, retry keys, and earlier backup job rows. PostgreSQL cluster roles and deployment configuration stay in separately managed recovery material. Configure the Windows server for Pakistan Standard Time and schedule the job every day to target a recovery point within 24 hours.

## Set up daily backups

1. Install the PostgreSQL tools for the running server major version and the native age release. Verify the downloaded distribution before installing it. Generate an age identity on the Owner's separate recovery device with `age-keygen -o <private-identity-file>`. Save the public recipient and keep two protected copies of the private identity away from the app and backup directories. [PostgreSQL `pg_dump`](https://www.postgresql.org/docs/17/app-pgdump.html) · [age releases](https://github.com/FiloSottile/age/releases)
2. Create a dedicated PostgreSQL login with a generated password and no administrative privileges. Connect as the migration owner to the application database and apply `scripts/grant-backup-access.sql` with `psql -v ON_ERROR_STOP=1 -v backup_role=khancoal_backup`. PostgreSQL 17 `MAINTAIN` on the excluded tables allows `pg_dump` to lock their schemas without reading their records. Review the exact grants alongside future schema changes. [Backup database grants](../scripts/grant-backup-access.sql) · [PostgreSQL lock privileges](https://www.postgresql.org/docs/17/sql-lock.html)
3. Copy the example JSON to a protected absolute path outside the checkout. Set the loopback PostgreSQL address, archive folder, PostgreSQL and age paths, and the age public recipient. Keep the backup login password in the named UTF-8 `pgpass.conf` with an entry matching the configured database and login. Restrict the JSON and password file with NTFS ACLs. Give only the maintenance and app service accounts read access. Give those accounts archive write access and keep archive folders outside web-served directories. Use an optional secondary folder on a separate drive or an authorized network share. [Example backup configuration](../scripts/backup/config.example.json) · [PostgreSQL password file](https://www.postgresql.org/docs/17/libpq-pgpass.html)
4. Set `KHANCOAL_BACKUP_CONFIG` for the app service to the same protected JSON path. Run the commands below from the deployed checkout. Use `-RunAsUser` to register a local-only S4U task or `-Credential (Get-Credential)` for a configured Windows account that can access a network mirror. Give the task account permission to log on as a batch job and access Node.js, the deployed script, the protected files, and the configured archive folders. Use the server's normal script signing and execution policy.
5. Start the registered task once in Task Scheduler and check its completion and the Owner's backup status. A manual Owner download uses the same encrypted archive format. Record the SHA-256 of recovery copies in the Owner's protected recovery inventory when you export or move them off the server. A verified mirror file has the same digest as the primary archive.

```powershell
.\scripts\backup.ps1 -ConfigPath 'D:\KhanCoal\protected\backup.json'
.\scripts\register-backup-task.ps1 -ConfigPath 'D:\KhanCoal\protected\backup.json' -RunAsUser 'SERVER\KhanCoalBackup'
```

Keep the latest archive for each of the 30 most recent successful backup days and the latest archive for each of the 12 most recent successful backup months. The selections can overlap. Keep extra archives from the last 48 hours so staff can finish a manual download. Retention only applies to files with the app's archive naming pattern in the configured folders. Backup jobs serialize across the app and Scheduler. A busy invocation exits with code `2`. If the optional mirror is offline, the primary backup can succeed and the audit event records the failed mirror. Check that the mirror receives new archives after reconnecting it.

## Off-host cloud copy

For the hosted production setup, use a client-owned private Cloudflare R2 Standard bucket. Keep public access disabled. Configure an R2 rclone remote under the backup service account using an object read/write key restricted to that bucket. Protect the rclone config with NTFS permissions. Keep the age private recovery identity outside the server and bucket. [R2 credentials](https://developers.cloudflare.com/r2/get-started/s3/) · [Configure rclone](https://developers.cloudflare.com/r2/examples/rclone/)

Add the optional `objectMirror` block to the protected backup JSON. It can coexist with the local mirror. `remotePath` includes the rclone remote, bucket, and an archive prefix.

```json
{
  "objectMirror": {
    "executable": "C:\\Program Files\\rclone\\rclone.exe",
    "configFile": "D:\\KhanCoal\\protected\\rclone.conf",
    "remotePath": "khancoal-r2:khancoal-backups/daily"
  }
}
```

Register the schedule with `-Credential (Get-Credential)` for the limited network-enabled backup account. Owner downloads use the local archive. The scheduled worker uploads the encrypted file without replacing existing content, downloads it for a SHA-256 comparison, and records the result in the backup audit event. A cloud failure leaves the verified local archive available and sets task exit code `3`. Monitor the `objectMirror` audit field and rerun the scheduled task after resolving a failed upload.

Apply a 30-day bucket lock and a 90-day expiry to `daily/` as the initial retention policy, subject to the client's record retention requirements. Configure usage alerts and monitor actual archive sizes and storage. The R2 Standard free allowance is 10 GB-month. At 90 retained daily snapshots, average compressed archive size determines whether usage remains within that allowance. [Pricing](https://developers.cloudflare.com/r2/pricing/) · [Bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/) · [Object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)

For acceptance, run the scheduled task and obtain its latest `succeeded` object mirror audit result. Download that object from a second machine, verify its SHA-256 against the protected backup audit record, and use the restore procedure below on an isolated database.

The Windows round-trip test exercised the scheduled upload and checksum path using rclone against an isolated local destination. It also verified that an upload failure preserves the primary archive and returns exit code `3`. The live R2 bucket and target Windows schedule still require a deployment rehearsal. Set `TEST_RCLONE_EXECUTABLE` to an absolute rclone path to include this check in the Windows recovery drill.

## Restore an archived database

1. Save the existing database and keep the application pointed at its original database until recovery verification is complete. Provision an empty PostgreSQL database with a new name from `template0`. Give ownership to a separate migration login with no superuser, role creation, database creation, or elevated role membership. Prepare a protected recovery JSON with that database and login and a password file matching the new database. Only `host`, `port`, `database`, `user`, `postgresBin`, `ageExecutable`, `passwordFile`, and optional `timeoutSeconds` are used for recovery.
2. Pick an archive you trust and obtain its expected SHA-256 independently from the recovery inventory or original protected backup metadata. The separate private age identity authorizes decryption. The independently recorded digest identifies the exact archive selected by the Owner. Use a private scratch folder with ACLs for the restore account. Allow disk space for one encrypted working copy and the restored database.
3. Run the restore command. It checks the database is empty, verifies the archive digest, and streams verified encrypted content through age into `pg_restore` using a transaction. Record the emitted elapsed time, migration count, voucher and order counts, and exact customer and supplier journal totals. Compare these with the expected recovery point. Reconcile sampled party balances and cash against known ledger records. On any failure, keep the target out of service and provision a fresh recovery database for a new attempt.
4. Apply any approved migrations the recovered version needs and recreate the restricted database grants. Point `DATABASE_URL` in the recovery shell to the verified restored database and run `recover-restored-owner.ps1`. Use an existing active Owner username. Sign in with the temporary password, change it, and enroll two-factor authentication. Use staff management to issue temporary passwords to restored staff and have them enroll two-factor authentication. Existing account identifiers and audit attribution remain available.
5. Start the application against the verified recovery database, check readiness and an Owner sign-in, and test representative reports before switching users to the restored service. Update the scheduled job and app backup configuration for the recovered database, then take a new backup. Record the recovered transaction cutoff and total elapsed service recovery time. The service restoration target is four hours.

```powershell
.\scripts\restore.ps1 -ConfigPath 'D:\KhanCoal\protected\recovery.json' `
    -TargetDatabase 'khancoal_recovery' -ArchivePath 'D:\KhanCoal\archives\<archive-id>.dump.age' `
    -ExpectedSha256 '<trusted-sha256>' -IdentityPath 'E:\Recovery\owner-age-identity.txt' `
    -PrivateScratchDirectory 'D:\KhanCoal\protected\recovery-scratch'

.\scripts\recover-restored-owner.ps1 -TargetDatabase 'khancoal_recovery' -Username '<owner-username>'
```

## Repeat the Windows drill

Run a synthetic end-to-end drill using the unpacked Windows PostgreSQL and age binaries. The script creates its own loopback PostgreSQL cluster, restricted roles, databases, and ephemeral encryption identity. It verifies concurrent-job refusal, encrypted backup and mirror, a live Owner's download stream, migration and credential exclusions, exact ledger totals, refusal of an occupied restore target, and recovery of the original Owner identity.

```powershell
.\scripts\test-backup-restore-windows.ps1 -PostgresBin 'C:\Tools\pgsql\bin' -AgeBin 'C:\Tools\age'
```

The Windows workstation drill with PostgreSQL 17.12 and age 1.3.2 restored one payment and two journal entries totaling PKR 168.74. The restore phase took 1.876 seconds. The workstation account lacked Scheduler registration privileges. Record task execution and full cutover timing under the deployment account in the Windows Server rehearsal.
