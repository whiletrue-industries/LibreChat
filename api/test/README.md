## Aurora-backed tests

The AdminPrompts Aurora adapter requires a local Postgres for tests:

```bash
docker compose -f ../docker-compose.test.yml up -d test-pg

cd api
TEST_DATABASE_URL=postgresql://test:test@localhost:54330/librechat_test \
  npx jest test/admin.prompts.aurora.spec.js
```

(Container uses port 54330 to avoid colliding with rebuilding-bots's test-pg
on 54329; cleanup with `docker compose -f ../docker-compose.test.yml down`.)
