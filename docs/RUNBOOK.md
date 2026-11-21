# KhanCoalSupplier Windows Server runbook

## First installation

1. On the authorized Windows Server, open **Settings → System → About** and record the Windows Server version, CPU, RAM, and available disk space. Set up a private deployment folder such as `D:\KhanCoal`. Restrict modification of the source, releases, and configuration to Administrators and SYSTEM. Keep the protected configuration and archive folders off shared drives.
2. Install Node.js 22 LTS (22.18 or newer) or 24 LTS, Git for Windows, and PostgreSQL 17 for Windows. Obtain the Windows x64 releases of NSSM (2.24-101 or later), Caddy, and age from their official sources. Verify installer signatures or published checksums and put the executables in administrator-managed folders. [Node.js](https://nodejs.org/en/download) · [PostgreSQL](https://www.postgresql.org/download/windows/) · [NSSM](https://nssm.cc/download) · [Caddy](https://github.com/caddyserver/caddy/releases) · [age](https://github.com/FiloSottile/age/releases)
3. Open **Services** and verify the PostgreSQL service is running automatically. Set `listen_addresses = '127.0.0.1'` in the installation's `postgresql.conf`. Allow only loopback SCRAM connections for the three application logins in `pg_hba.conf`. Set distinct passwords in a private `psql` session with `\password`. Create the database under the migration login. Verify that all three roles have the expected attributes with `\du`.

   ```sql
   CREATE ROLE khancoal_migrate LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
   CREATE ROLE khancoal_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
   CREATE ROLE khancoal_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
   CREATE DATABASE khancoal OWNER khancoal_migrate;
   REVOKE CONNECT ON DATABASE khancoal FROM PUBLIC;
   ```

4. In the **DNS manager**, create the app's DNS record. Use a public DNS name and route TCP 80 and 443 to Caddy for public certificate issuance. For a LAN-only app, use an internal DNS name and the `-LanOnly` installer option. The installer enables its firewall rule on Domain and Private profiles by default. Pass `-FirewallProfile` to select the approved profile for the server. Confirm that no inbound firewall rules expose PostgreSQL or the Node port.
5. In the protected configuration folder, create a UTF-8 `app.env` using the keys below. Percent-encode database credentials in URLs and generate the authentication key once using `node -p "require('node:crypto').randomBytes(32).toString('base64url')"` in a private session. Set the SMTP sender and a TLS-capable mail relay. Store the app database login in this file. Create a separate UTF-8 `migration.env` with `MIGRATION_DATABASE_URL` for the migration login and keep it accessible to Administrators and SYSTEM.

   ```dotenv
   DEPLOYMENT_ENV=production
   APP_ORIGIN=https://coal.example.com
   APP_PORT=3000
   DATABASE_URL=postgresql://khancoal_app:PERCENT_ENCODED_PASSWORD@127.0.0.1:5432/khancoal
   AUTH_ENCRYPTION_KEY=REPLACE_WITH_GENERATED_KEY
   SMTP_URL=smtps://RELAY_CREDENTIALS@RELAY_HOST:465
   SMTP_FROM=dispatch@example.com
   KHANCOAL_BACKUP_CONFIG=D:/KhanCoal/protected/backup.json
   ```

6. Open the deployment checkout in Windows PowerShell. Stage the reviewed Git revision and run the migration against the new database. Use `-SkipPull` for a local checkout whose reviewed revision is already available. The stage command prints its release folder, which the installer uses.

   ```powershell
   .\scripts\deploy.ps1 -DeploymentDirectory 'D:\KhanCoal' -StageOnly
   Push-Location 'D:\KhanCoal\releases\REVIEWED_COMMIT'
   node.exe '--env-file=D:\KhanCoal\protected\migration.env' 'node_modules/prisma/build/index.js' migrate deploy
   Pop-Location
   ```

7. As the migration login, apply `scripts/grant-database-access.sql` and `scripts/grant-backup-access.sql` to `khancoal` using `psql -v ON_ERROR_STOP=1`. The first script takes `-v application_role=khancoal_app`. The second takes `-v backup_role=khancoal_backup`. Use the [backup instructions](BACKUP_RESTORE.md) to create the encryption identity, protected backup login password file, and backup configuration.
8. In **Windows PowerShell (Administrator)**, run the installer with the approved service and executable paths. The service uses the staged release. Caddy forwards only to the app's loopback port. For a LAN-only site, append `-LanOnly` and distribute the archive-safe Caddy root certificate from `D:\KhanCoal\caddy\caddy\pki\authorities\local\root.crt` to trusted client root stores using your policy. Verify the certificate fingerprint out of band.

   ```powershell
   .\scripts\install.ps1 -DeploymentDirectory 'D:\KhanCoal' -ReleaseDirectory 'D:\KhanCoal\releases\REVIEWED_COMMIT' `
     -AppConfigFile 'D:\KhanCoal\protected\app.env' -SiteName 'coal.example.com' `
     -NssmPath 'C:\Tools\nssm.exe' -CaddyPath 'C:\Tools\caddy.exe' `
     -PostgresBin 'C:\Program Files\PostgreSQL\17\bin'
   ```

9. The installer grants the application service read access to the app configuration and release files and write access to its own logs. Grant `NT SERVICE\KhanCoalSupplier` read access to the backup JSON and backup password file and modify access to the encrypted archive folder and optional mirror for manual Owner downloads. Grant the scheduled backup identity the corresponding access for scheduled runs. Review **Security → Advanced** on each folder using the backup access rules. Keep the private age identity under the restore operator's separate access.
10. From the staged release, provide the Owner identity and a temporary password through a private terminal, then seed with `node.exe '--env-file=D:\KhanCoal\protected\app.env' --import tsx scripts/seed-owner.ts`. Clear the password from the environment. Sign in over HTTPS, set a new password, and enroll TOTP. Exercise password recovery through the real SMTP relay using an agreed test mailbox.
11. Register the daily job using `scripts/register-backup-task.ps1`. Run it once from **Task Scheduler**, confirm a successful archive in **Settings → Database backups**, and rehearse recovery into a new isolated database. Verify both services are set to **Automatic**, verify readiness after a reboot, and check that an authorized staff device can reach the HTTPS hostname. Capture service status, the firewall result, TLS validity, successful SMTP delivery, and the recovery record in change notes. [Task Scheduler](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/register-scheduledtask) · [Caddy on Windows](https://caddyserver.com/docs/running#windows-service) · [NSSM service settings](https://nssm.cc/usage)

## Updates and rollback

1. Confirm the current release is healthy and the working branch has the approved upstream. Schedule the service restart. Review migrations for compatibility with the prior build and retain that build on disk.
2. Run `deploy.ps1` from the checkout as an administrator. Pass `-DeploymentDirectory`, `-AppConfigFile`, `-MigrationConfigFile`, `-BackupConfigFile`, and `-NssmPath` using the installation paths. The script stages the commit, installs locked dependencies, runs checks, stops the app, creates an encrypted backup, applies migrations, and starts the new release. It checks both local probes and switches back to the prior build if activation fails. Database schema changes remain applied, so use an expand-and-contract migration across separate releases when removing or changing fields.
3. Verify sign-in, one known historical dispatch, and an agreed report balance. Inspect logs in `D:\KhanCoal\logs`. Retain the pre-deployment archive and trusted checksum with the release change record. Archive and prune rotated logs under the organization's approved retention policy.
4. For a manual application rollback to a schema-compatible release, stop the app service, use `nssm.exe set KhanCoalSupplier AppDirectory D:\KhanCoal\releases\PRIOR_COMMIT`, and start it. Verify readiness and signed-in access. Recover data into a new database first if there is a database failure. Reconcile writes after the backup timestamp before any production cutover.

## Operations and incidents

- **App fails to start.** In **Services**, verify PostgreSQL and the app service. Check `output.log` and `error.log` under `logs\app`. `http://127.0.0.1:3000/healthz` should return 200. `/readyz` should return 200 when the database is accessible. Match user-reported request IDs against logs. Keep logs out of public support threads.
- **TLS fails.** Review `logs\proxy`, the hostname, the Windows network profile, and the TCP 80 and 443 rules. On the LAN, verify the client trusts the correct Caddy CA. Test from an authorized client with browser certificate checks enabled.
- **Backup fails or is stale.** Check the latest successful backup date, the Task Scheduler result, available disk space, and the protected backup settings. Keep the latest working archive and key accessible to the restore operator. Follow the [backup and recovery procedure](BACKUP_RESTORE.md) for an isolated restore, integrity verification, and Owner recovery.
- **Rotate credentials.** Update PostgreSQL or SMTP credentials in the relevant protected configuration and restart the affected service. Keep the backup private identity available for earlier archives when changing the age recipient.
- **Rotate the authenticator encryption key.** Schedule a maintenance window and rehearse Owner recovery from an encrypted backup. Keep the old key in the secret store while a trusted maintainer prepares re-encryption of stored authenticator seeds or a coordinated staff re-enrollment. Start the app with the new key after applying that change and verify a fresh production Owner sign-in before retiring the old key.
- **Suspected account compromise.** Disable the account in **Staff accounts**, review the audit entries, preserve protected copies of relevant logs, and rotate compromised credentials. The organization decides retention and disclosure obligations.

## Rehearsal record

The development workstation ran Windows 11 Enterprise, Node.js 22.18.0, and PostgreSQL 17.12. Windows PowerShell staged a clean release from Git, installed locked dependencies, ran its checks, produced a production build, and reused the finished release on a second staging run. The installer preflight validated the app configuration, NSSM, and the Caddy 2.11.9 reverse-proxy configuration with its internal CA option. The encrypted backup and Owner recovery drill passed on a disposable database.

Use the authorized Windows Server and its deployment account for the service startup, restart and rollback exercises, the firewall and HTTPS tests from a staff device, SMTP delivery, and scheduled backup registration. The development account received Access Denied when registering a disposable scheduled task.
