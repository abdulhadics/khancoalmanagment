-- CreateTable
CREATE TABLE "roles" (
    "code" TEXT NOT NULL PRIMARY KEY
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role_code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "locale" TEXT NOT NULL DEFAULT 'ENGLISH',
    "last_login_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "roles" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_credentials" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "password_hash" TEXT NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "totp_secret_encrypted" BLOB,
    "totp_key_id" TEXT,
    "last_totp_step" BIGINT,
    "recovery_code_digests" JSONB NOT NULL DEFAULT [],
    CONSTRAINT "user_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token_digest" TEXT NOT NULL,
    "issued_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME NOT NULL,
    "revoked_at" DATETIME,
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "auth_challenges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "token_digest" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME NOT NULL,
    "consumed_at" DATETIME,
    CONSTRAINT "auth_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "scope" TEXT NOT NULL,
    "identifier_digest" TEXT NOT NULL,
    "window_start" DATETIME NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" DATETIME NOT NULL,

    PRIMARY KEY ("scope", "identifier_digest", "window_start")
);

-- CreateTable
CREATE TABLE "company_settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "document_profile_id" TEXT NOT NULL,
    "order_prefix" TEXT NOT NULL DEFAULT 'ORD',
    "voucher_prefix" TEXT NOT NULL DEFAULT 'VCH',
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "company_settings_document_profile_id_fkey" FOREIGN KEY ("document_profile_id") REFERENCES "document_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "logo_bytes" BLOB,
    "logo_media_type" TEXT,
    "currency_symbol" TEXT NOT NULL DEFAULT 'Rs.',
    "weight_unit" TEXT NOT NULL DEFAULT 'TON',
    "date_format" TEXT NOT NULL DEFAULT 'dd MMM yyyy',
    "number_format" TEXT NOT NULL DEFAULT 'en-PK',
    "footer" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "banks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "industry" TEXT,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "city" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "credit_limit" BIGINT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customers_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "city" TEXT,
    "region" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "suppliers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "suppliers_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "mines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplier_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "code_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mines_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_no" TEXT NOT NULL,
    "number_year" INTEGER NOT NULL,
    "ordinal" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_PRICING',
    "current_revision_no" INTEGER,
    "business_date" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "mine_id" TEXT NOT NULL,
    "vehicle_no" TEXT NOT NULL,
    "bilty_no" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "deleted_by_id" TEXT,
    "deleted_at" DATETIME,
    "delete_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "orders_supplier_id_mine_id_fkey" FOREIGN KEY ("supplier_id", "mine_id") REFERENCES "mines" ("supplier_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "orders_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "orders_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "orders_id_current_revision_no_fkey" FOREIGN KEY ("id", "current_revision_no") REFERENCES "order_revisions" ("order_id", "revision_no") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "order_revisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_id" TEXT NOT NULL,
    "revision_no" INTEGER NOT NULL,
    "business_date" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "mine_id" TEXT NOT NULL,
    "vehicle_no" TEXT NOT NULL,
    "bilty_no" TEXT,
    "notes" TEXT,
    "weight" BIGINT NOT NULL,
    "purchase_rate" BIGINT,
    "sell_rate" BIGINT,
    "buy_amount" BIGINT,
    "sell_amount" BIGINT,
    "profit" BIGINT,
    "document_profile_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_revisions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "order_revisions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "order_revisions_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "order_revisions_supplier_id_mine_id_fkey" FOREIGN KEY ("supplier_id", "mine_id") REFERENCES "mines" ("supplier_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "order_revisions_document_profile_id_fkey" FOREIGN KEY ("document_profile_id") REFERENCES "document_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "order_revisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "voucher_no" TEXT NOT NULL,
    "ordinal" BIGINT NOT NULL,
    "business_date" TEXT NOT NULL,
    "customer_id" TEXT,
    "supplier_id" TEXT,
    "direction" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "bank_id" TEXT,
    "bank_name" TEXT,
    "reference_no" TEXT,
    "amount" BIGINT NOT NULL,
    "notes" TEXT,
    "document_profile_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "voided_by_id" TEXT,
    "voided_at" DATETIME,
    "void_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payments_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "banks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payments_document_profile_id_fkey" FOREIGN KEY ("document_profile_id") REFERENCES "document_profiles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payments_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cheque_events" (
    "id" BIGINT NOT NULL PRIMARY KEY,
    "payment_id" TEXT NOT NULL,
    "previous" TEXT NOT NULL,
    "resulting" TEXT NOT NULL,
    "business_date" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cheque_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cheque_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" BIGINT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "business_date" TEXT NOT NULL,
    "customer_id" TEXT,
    "supplier_id" TEXT,
    "order_revision_id" TEXT,
    "payment_id" TEXT,
    "amount" BIGINT NOT NULL,
    "reverses_id" BIGINT,
    "actor_id" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ledger_entries_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ledger_entries_order_revision_id_fkey" FOREIGN KEY ("order_revision_id") REFERENCES "order_revisions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ledger_entries_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ledger_entries_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "ledger_entries" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ledger_entries_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "kind" TEXT NOT NULL,
    "scope" INTEGER NOT NULL,
    "next_ordinal" BIGINT NOT NULL DEFAULT 1,

    PRIMARY KEY ("kind", "scope")
);

-- CreateTable
CREATE TABLE "period_locks" (
    "month" TEXT NOT NULL PRIMARY KEY,
    "is_month_locked" BOOLEAN NOT NULL DEFAULT false,
    "is_year_locked" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_id" TEXT,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "period_locks_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "actor_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_digest" TEXT NOT NULL,
    "response" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME NOT NULL,

    PRIMARY KEY ("actor_id", "operation", "key"),
    CONSTRAINT "idempotency_keys_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGINT NOT NULL PRIMARY KEY,
    "actor_id" TEXT,
    "actor_type" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "occurred_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" TEXT NOT NULL,
    "ip_address" TEXT,
    "outcome" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "backups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "actor_id" TEXT,
    "state" TEXT NOT NULL DEFAULT 'RUNNING',
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" DATETIME,
    "byte_count" BIGINT,
    "archive_hash" TEXT,
    "archive_id" TEXT,
    "failure_code" TEXT,
    CONSTRAINT "backups_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_code_is_active_idx" ON "users"("role_code", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_digest_key" ON "sessions"("token_digest");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_challenges_token_digest_key" ON "auth_challenges"("token_digest");

-- CreateIndex
CREATE INDEX "auth_challenges_user_id_purpose_expires_at_idx" ON "auth_challenges"("user_id", "purpose", "expires_at");

-- CreateIndex
CREATE INDEX "auth_challenges_expires_at_idx" ON "auth_challenges"("expires_at");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_expires_at_idx" ON "rate_limit_buckets"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "banks_name_key_key" ON "banks"("name_key");

-- CreateIndex
CREATE INDEX "banks_is_active_name_key_id_idx" ON "banks"("is_active", "name_key", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");

-- CreateIndex
CREATE INDEX "customers_is_active_name_key_id_idx" ON "customers"("is_active", "name_key", "id");

-- CreateIndex
CREATE INDEX "customers_name_key_id_idx" ON "customers"("name_key", "id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE INDEX "suppliers_is_active_name_key_id_idx" ON "suppliers"("is_active", "name_key", "id");

-- CreateIndex
CREATE INDEX "suppliers_name_key_id_idx" ON "suppliers"("name_key", "id");

-- CreateIndex
CREATE INDEX "mines_supplier_id_is_active_code_key_idx" ON "mines"("supplier_id", "is_active", "code_key");

-- CreateIndex
CREATE UNIQUE INDEX "mines_supplier_id_id_key" ON "mines"("supplier_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "mines_supplier_id_code_key_key" ON "mines"("supplier_id", "code_key");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_no_key" ON "orders"("order_no");

-- CreateIndex
CREATE INDEX "orders_status_business_date_id_idx" ON "orders"("status", "business_date", "id");

-- CreateIndex
CREATE INDEX "orders_business_date_id_idx" ON "orders"("business_date", "id");

-- CreateIndex
CREATE INDEX "orders_customer_id_business_date_id_idx" ON "orders"("customer_id", "business_date", "id");

-- CreateIndex
CREATE INDEX "orders_supplier_id_business_date_id_idx" ON "orders"("supplier_id", "business_date", "id");

-- CreateIndex
CREATE INDEX "orders_mine_id_business_date_id_idx" ON "orders"("mine_id", "business_date", "id");

-- CreateIndex
CREATE INDEX "orders_vehicle_no_business_date_idx" ON "orders"("vehicle_no", "business_date");

-- CreateIndex
CREATE INDEX "orders_created_by_id_business_date_id_idx" ON "orders"("created_by_id", "business_date", "id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_year_ordinal_key" ON "orders"("number_year", "ordinal");

-- CreateIndex
CREATE INDEX "order_revisions_business_date_id_idx" ON "order_revisions"("business_date", "id");

-- CreateIndex
CREATE INDEX "order_revisions_customer_id_business_date_id_idx" ON "order_revisions"("customer_id", "business_date", "id");

-- CreateIndex
CREATE INDEX "order_revisions_supplier_id_business_date_id_idx" ON "order_revisions"("supplier_id", "business_date", "id");

-- CreateIndex
CREATE INDEX "order_revisions_mine_id_business_date_id_idx" ON "order_revisions"("mine_id", "business_date", "id");

-- CreateIndex
CREATE UNIQUE INDEX "order_revisions_order_id_revision_no_key" ON "order_revisions"("order_id", "revision_no");

-- CreateIndex
CREATE UNIQUE INDEX "payments_voucher_no_key" ON "payments"("voucher_no");

-- CreateIndex
CREATE UNIQUE INDEX "payments_ordinal_key" ON "payments"("ordinal");

-- CreateIndex
CREATE INDEX "payments_direction_business_date_id_idx" ON "payments"("direction", "business_date", "id");

-- CreateIndex
CREATE INDEX "payments_customer_id_business_date_id_idx" ON "payments"("customer_id", "business_date", "id");

-- CreateIndex
CREATE INDEX "payments_supplier_id_business_date_id_idx" ON "payments"("supplier_id", "business_date", "id");

-- CreateIndex
CREATE INDEX "payments_status_business_date_id_idx" ON "payments"("status", "business_date", "id");

-- CreateIndex
CREATE INDEX "payments_business_date_id_idx" ON "payments"("business_date", "id");

-- CreateIndex
CREATE INDEX "cheque_events_payment_id_id_idx" ON "cheque_events"("payment_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_reverses_id_key" ON "ledger_entries"("reverses_id");

-- CreateIndex
CREATE INDEX "ledger_entries_customer_id_business_date_id_idx" ON "ledger_entries"("customer_id", "business_date", "id");

-- CreateIndex
CREATE INDEX "ledger_entries_supplier_id_business_date_id_idx" ON "ledger_entries"("supplier_id", "business_date", "id");

-- CreateIndex
CREATE INDEX "ledger_entries_business_date_kind_id_idx" ON "ledger_entries"("business_date", "kind", "id");

-- CreateIndex
CREATE INDEX "ledger_entries_order_revision_id_idx" ON "ledger_entries"("order_revision_id");

-- CreateIndex
CREATE INDEX "ledger_entries_payment_id_idx" ON "ledger_entries"("payment_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_occurred_at_id_idx" ON "audit_logs"("occurred_at", "id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_occurred_at_id_idx" ON "audit_logs"("actor_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "audit_logs_action_occurred_at_id_idx" ON "audit_logs"("action", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_occurred_at_id_idx" ON "audit_logs"("target_type", "target_id", "occurred_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "backups_archive_id_key" ON "backups"("archive_id");

-- CreateIndex
CREATE INDEX "backups_state_completed_at_id_idx" ON "backups"("state", "completed_at", "id");
