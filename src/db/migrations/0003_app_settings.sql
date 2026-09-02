-- Server-held configuration an admin can change without a redeploy.
-- One row per setting; the value is an encrypted JSON blob (see
-- src/lib/crypto/secret-box.ts), so a database dump never exposes a credential.
CREATE TABLE app_settings (
  setting_key VARCHAR(64) NOT NULL,
  value_encrypted TEXT NOT NULL,
  updated_by CHAR(36) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (setting_key)
);
