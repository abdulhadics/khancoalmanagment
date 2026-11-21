\if :{?application_role}
\else
  \echo 'Pass -v application_role=NAME for the existing restricted application login.'
  \quit 2
\endif

BEGIN;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE :"DBNAME" TO :"application_role";
GRANT USAGE ON SCHEMA public TO :"application_role";

GRANT SELECT ON roles TO :"application_role";
GRANT SELECT, INSERT, UPDATE ON
  users, user_credentials, sessions, auth_challenges, rate_limit_buckets,
  company_settings, banks, customers, suppliers, mines, orders, payments,
  number_sequences, period_locks, idempotency_keys, backups
TO :"application_role";
GRANT SELECT, INSERT ON
  document_profiles, order_revisions, cheque_events, ledger_entries, audit_logs
TO :"application_role";
GRANT DELETE ON sessions, auth_challenges, rate_limit_buckets
TO :"application_role";

GRANT USAGE ON SEQUENCE audit_logs_id_seq, ledger_entries_id_seq
TO :"application_role";

COMMIT;
