-- SEC-028: Migrate Store Admin passwords from reversible AES-256-CBC encryption
-- to one-way bcrypt hashing.
--
-- Strategy: add password_hash column alongside password_encrypted.
-- The application writes bcrypt hashes on every generatePassword() call going
-- forward. Login accepts either column (bcrypt preferred, AES fallback).
-- getPassword() can only show the password at generation time; existing
-- AES-encrypted passwords are shown one last time when tenants next call
-- getPassword, then they receive a prompt to regenerate so a bcrypt hash
-- replaces the AES value. password_encrypted is kept until all rows migrate.

ALTER TABLE store_admin_credentials
    ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Index for future cleanup query (to find rows still on legacy AES)
CREATE INDEX IF NOT EXISTS idx_store_admin_creds_has_hash
    ON store_admin_credentials (store_id)
    WHERE password_hash IS NOT NULL;
