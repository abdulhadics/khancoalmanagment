# Application security

## Deployment boundaries

Next.js listens on loopback. The Windows reverse proxy terminates HTTPS, preserves the configured public host, and overwrites `X-KC-Client-IP` with the connection's client address. The application checks each browser mutation against `APP_ORIGIN`. PostgreSQL uses a restricted application login and a separate migration login. Database grants and authentication secrets are configured during deployment.

The application validates HTTPS, PostgreSQL, an authenticator encryption key, and SMTP settings at production startup. The recovery-mail transport requires TLS. Keep the TOTP encryption key stable between releases and restrict access to the Windows service identity. The key authenticates encrypted authenticator seeds. Losing the key requires controlled re-enrollment.

## Account lifecycle

Bootstrap creates the first Owner from process environment input and stores an Argon2id password hash. The first session requires a password change. An Owner must also enroll a TOTP authenticator in production. Optional staff TOTP enrollment verifies the existing password and an authenticator code. Accepted TOTP time steps are recorded so a previously used code is rejected.

Authentication generates separate random login challenge, session, and reset tokens. PostgreSQL stores their digests. Sessions have 30-minute idle and 12-hour absolute limits. Cookies use HttpOnly and SameSite=Lax. Production uses Secure cookies with protected names. Staff status and role changes, password resets, and signed-in password changes revoke affected sessions. Reset links expire after 20 minutes and can be redeemed once. The login and reset flows use PostgreSQL-backed throttling and generic responses.

## Authorization and audit

See the [role matrix](PERMISSIONS.md) and [threat model](THREAT_MODEL.md). Authentication checks the current user, credential, and session on protected requests. Staff mutations also recheck the session and role inside the database transaction. The staff management service keeps at least one active Owner and records administrative changes with the same commit as the mutation.

Audit records identify the actor and request, record the outcome, and capture selected before and after fields for mutations. Redaction excludes credentials, tokens, and personal contact fields. PostgreSQL rejects audit mutations, and the restricted app login can read and append audit records. Staff access to the audit review screen is planned with the administrative tools.

## Verification

- Unit tests cover deployment configuration, role policy, and TOTP vectors and tamper rejection.
- Native PostgreSQL integration tests cover login expiry and throttling, staff authorization and revocation, password changes, TOTP replay prevention, and reset token lifetime and single-use redemption.
- The Edge workflow checks first-use sign-in, staff creation, permitted navigation, restricted pages, and session revocation.
- Windows Server TLS and service rehearsal, production SMTP delivery, data retention sign-off, backup recovery verification, and final ASVS evidence remain release gates.
