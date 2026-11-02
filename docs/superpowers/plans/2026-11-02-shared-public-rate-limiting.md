# Shared public rate limiting implementation plan

1. Add failing unit tests for hashing/privacy, policy/window behavior, failure-open handling, and route short-circuit ordering.
2. Add a failing Laragon MySQL integration test for concurrent increments.
3. Add migration 0013 and the matching Drizzle schema.
4. Implement the minimal shared limiter and generic 429 response.
5. Guard login, signup, and Agent enrollment before request parsing/business services.
6. Add the migration rollback/operations note.
7. Run only targeted rate-limit/auth/enrollment tests, then typecheck, lint, and `git diff --check`.
8. Review the diff for secrets and scope, then commit once as `feat: rate limit public auth endpoints` without pushing or deploying.
