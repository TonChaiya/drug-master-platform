# Shared public endpoint rate limiting

## Scope

Add a persistent fixed-window limiter only to login, signup, and Agent enrollment. Policies are 15/5 minutes, 5/30 minutes, and 10/10 minutes per client IP respectively.

## Design

- Store one row per `(scope, client_key_hash, window_start)` in MySQL/TiDB.
- Derive `client_key_hash` with HMAC-SHA-256 using the existing `SESSION_SECRET`; never persist or log the raw IP.
- Prefer Vercel's `x-vercel-forwarded-for`, then `x-forwarded-for`, then `x-real-ip`. Missing IPs share an opaque `unknown` bucket.
- Increment with `INSERT ... ON DUPLICATE KEY UPDATE request_count = request_count + 1`, then read the count in the same transaction while the row lock is held. This avoids process-local state and concurrent over-admission.
- Run the limiter before parsing request bodies or entering authentication, signup, or enrollment services.
- Return a generic 429 response with `Retry-After`. If the limiter database operation fails, log only `security.rate_limit_unavailable` plus the scope/error class and allow the request to continue.
- Keep cleanup operational: expired fixed-window rows may be deleted by a later maintenance task; the expiry index makes that bounded without adding a scheduler now.

## Schema

Migration `0013_shared_rate_limits.sql` creates `rate_limit_buckets` with a composite primary key over scope, HMAC client key, and window start, plus an expiry index. No foreign keys or business identifiers are stored.

## Safety

Blocked requests return before all business services, so login does not verify passwords, signup cannot write facility/user/audit rows, and Agent enrollment cannot consume its token. Local concurrency verification uses only a dedicated Laragon MySQL database and never loads `.env.local`.
