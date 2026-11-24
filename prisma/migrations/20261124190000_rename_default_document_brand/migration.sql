BEGIN;

WITH old_profile AS (
    SELECT profile.*
    FROM company_settings AS company
    JOIN document_profiles AS profile ON profile.id = company.document_profile_id
    WHERE company.id = 1 AND profile.name = 'KhanCoalSupplier'
    FOR UPDATE OF company
), renamed_profile AS (
    INSERT INTO document_profiles (
        name, tagline, address, phone, email, logo_bytes, logo_media_type,
        currency_symbol, weight_unit, date_format, number_format, footer
    )
    SELECT 'Faisal Coal Dealer', profile.tagline, profile.address, profile.phone,
           profile.email, profile.logo_bytes, profile.logo_media_type,
           profile.currency_symbol, profile.weight_unit, profile.date_format,
           profile.number_format, profile.footer
    FROM old_profile AS profile
    RETURNING id
)
UPDATE company_settings
SET document_profile_id = renamed_profile.id,
    updated_at = GREATEST(company_settings.updated_at + INTERVAL '1 millisecond', now())
FROM renamed_profile
WHERE company_settings.id = 1;

COMMIT;
