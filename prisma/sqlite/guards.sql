PRAGMA user_version = 1;
PRAGMA application_id = 0x4B48434C;

CREATE UNIQUE INDEX mines_one_default_per_supplier ON mines (supplier_id) WHERE is_default;
CREATE UNIQUE INDEX orders_active_bilty_key ON orders (supplier_id, business_date, bilty_no)
  WHERE bilty_no IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX ledger_one_original_per_order_revision_side ON ledger_entries (kind, order_revision_id)
  WHERE order_revision_id IS NOT NULL AND reverses_id IS NULL;
CREATE UNIQUE INDEX ledger_one_original_per_payment ON ledger_entries (payment_id)
  WHERE payment_id IS NOT NULL AND reverses_id IS NULL;
CREATE UNIQUE INDEX ledger_one_customer_opening ON ledger_entries (customer_id)
  WHERE kind = 'CUSTOMER_OPENING' AND reverses_id IS NULL;
CREATE UNIQUE INDEX ledger_one_supplier_opening ON ledger_entries (supplier_id)
  WHERE kind = 'SUPPLIER_OPENING' AND reverses_id IS NULL;

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'Audit history is append-only'); END;
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'Audit history is append-only'); END;
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'Ledger history is append-only'); END;
CREATE TRIGGER ledger_entries_no_delete BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'Ledger history is append-only'); END;
CREATE TRIGGER order_revisions_no_update BEFORE UPDATE ON order_revisions BEGIN SELECT RAISE(ABORT, 'Dispatch revisions are append-only'); END;
CREATE TRIGGER order_revisions_no_delete BEFORE DELETE ON order_revisions BEGIN SELECT RAISE(ABORT, 'Dispatch revisions are append-only'); END;
CREATE TRIGGER cheque_events_no_update BEFORE UPDATE ON cheque_events BEGIN SELECT RAISE(ABORT, 'Cheque events are append-only'); END;
CREATE TRIGGER cheque_events_no_delete BEFORE DELETE ON cheque_events BEGIN SELECT RAISE(ABORT, 'Cheque events are append-only'); END;
CREATE TRIGGER document_profiles_no_update BEFORE UPDATE ON document_profiles BEGIN SELECT RAISE(ABORT, 'Document profiles are append-only'); END;
CREATE TRIGGER document_profiles_no_delete BEFORE DELETE ON document_profiles BEGIN SELECT RAISE(ABORT, 'Document profiles are append-only'); END;
CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders BEGIN SELECT RAISE(ABORT, 'Use the dispatch void operation'); END;
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT, 'Use the payment void operation'); END;

CREATE TRIGGER ledger_validate_amount BEFORE INSERT ON ledger_entries
WHEN typeof(NEW.amount) <> 'integer'
  OR abs(NEW.amount) >= 100000000000000
BEGIN
  SELECT RAISE(ABORT, 'Ledger amount must be an exact integer within the supported range');
END;

CREATE TRIGGER ledger_validate_source BEFORE INSERT ON ledger_entries
WHEN CASE
  WHEN NEW.reverses_id IS NOT NULL THEN NOT EXISTS (
    SELECT 1 FROM ledger_entries AS original WHERE original.id = NEW.reverses_id
      AND original.reverses_id IS NULL AND NEW.amount = -original.amount
      AND NEW.kind = original.kind AND NEW.customer_id IS original.customer_id
      AND NEW.supplier_id IS original.supplier_id AND NEW.order_revision_id IS original.order_revision_id
      AND NEW.payment_id IS original.payment_id AND length(trim(coalesce(NEW.reason, ''))) > 0
  )
  WHEN NEW.kind IN ('ORDER_SALE', 'ORDER_PURCHASE') THEN NEW.payment_id IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM order_revisions AS revision WHERE revision.id = NEW.order_revision_id
      AND NEW.business_date = revision.business_date AND revision.purchase_rate IS NOT NULL
      AND ((NEW.kind = 'ORDER_SALE' AND NEW.customer_id = revision.customer_id
          AND NEW.supplier_id IS NULL AND NEW.amount = revision.sell_amount)
        OR (NEW.kind = 'ORDER_PURCHASE' AND NEW.supplier_id = revision.supplier_id
          AND NEW.customer_id IS NULL AND NEW.amount = revision.buy_amount))
  )
  WHEN NEW.kind IN ('CUSTOMER_RECEIPT', 'SUPPLIER_PAYMENT') THEN NEW.order_revision_id IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM payments AS voucher WHERE voucher.id = NEW.payment_id
      AND NEW.business_date = voucher.business_date AND NEW.amount = -voucher.amount
      AND NEW.customer_id IS voucher.customer_id AND NEW.supplier_id IS voucher.supplier_id
      AND ((NEW.kind = 'CUSTOMER_RECEIPT' AND voucher.direction = 'IN')
        OR (NEW.kind = 'SUPPLIER_PAYMENT' AND voucher.direction = 'OUT'))
  )
  WHEN NEW.kind IN ('CUSTOMER_OPENING', 'CUSTOMER_ADJUSTMENT', 'SUPPLIER_OPENING', 'SUPPLIER_ADJUSTMENT') THEN
    NEW.order_revision_id IS NOT NULL OR NEW.payment_id IS NOT NULL OR NEW.amount = 0
      OR (NEW.kind LIKE 'CUSTOMER_%' AND (NEW.customer_id IS NULL OR NEW.supplier_id IS NOT NULL))
      OR (NEW.kind LIKE 'SUPPLIER_%' AND (NEW.supplier_id IS NULL OR NEW.customer_id IS NOT NULL))
      OR (NEW.kind IN ('CUSTOMER_ADJUSTMENT', 'SUPPLIER_ADJUSTMENT') AND length(trim(coalesce(NEW.reason, ''))) = 0)
  ELSE 1
END
BEGIN
  SELECT RAISE(ABORT, 'Ledger posting must match its source and party');
END;
