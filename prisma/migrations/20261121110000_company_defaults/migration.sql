BEGIN;

WITH initial_profile AS (
    INSERT INTO document_profiles (name, tagline)
    SELECT 'KhanCoalSupplier', 'Coal Supply Management'
    WHERE NOT EXISTS (SELECT 1 FROM company_settings WHERE id = 1)
    RETURNING id
)
INSERT INTO company_settings (id, document_profile_id)
SELECT 1, id FROM initial_profile;

INSERT INTO banks (name, name_key, category)
VALUES ('Cash', 'cash', 'CASH')
ON CONFLICT (name_key) DO NOTHING;

COMMIT;
