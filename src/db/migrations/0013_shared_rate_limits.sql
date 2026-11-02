CREATE TABLE rate_limit_buckets (
  scope VARCHAR(48) NOT NULL,
  client_key_hash CHAR(64) NOT NULL,
  window_start DATETIME(3) NOT NULL,
  request_count INT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (scope, client_key_hash, window_start),
  KEY idx_rate_limit_buckets_expiry (expires_at)
);
