\if :{?backup_role}
\else
  \echo 'Pass -v backup_role=NAME for the existing dedicated backup login.'
  \quit 2
\endif

BEGIN;

GRANT CONNECT ON DATABASE :"DBNAME" TO :"backup_role";
GRANT USAGE ON SCHEMA public TO :"backup_role";

GRANT SELECT ON
  public._prisma_migrations, public.roles, public.users, public.company_settings,
  public.document_profiles, public.banks, public.customers, public.suppliers,
  public.mines, public.orders, public.order_revisions, public.payments,
  public.cheque_events, public.ledger_entries, public.number_sequences,
  public.period_locks, public.audit_logs, public.backups
TO :"backup_role";

-- pg_dump locks the schema objects even when their rows are excluded. PostgreSQL
-- 17 MAINTAIN allows the lock without granting the credential data or DML.
GRANT MAINTAIN ON public.user_credentials, public.sessions, public.auth_challenges,
  public.rate_limit_buckets, public.idempotency_keys TO :"backup_role";

GRANT SELECT ON SEQUENCE public.audit_logs_id_seq, public.cheque_events_id_seq, public.ledger_entries_id_seq
TO :"backup_role";
GRANT INSERT, UPDATE ON public.backups TO :"backup_role";
GRANT INSERT ON public.audit_logs TO :"backup_role";
GRANT USAGE ON SEQUENCE public.audit_logs_id_seq TO :"backup_role";

COMMIT;
