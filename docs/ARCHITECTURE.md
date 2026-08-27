# AVTODROM Architecture

## Current source of truth

- Production entrypoint: `api/index.js`
- Production frontend currently served by `api/index.js` from root `index.html`.
- Backend application entrypoint: `backend/src/server.js`
- Database access: `backend/src/db.js`
- Supabase/PostgreSQL is the system of record.

## Rules for cleanup

1. Do not add runtime HTML/JavaScript repair or script injection layers.
2. Do not keep multiple `safe`, `fixed`, `final`, or `v3` implementations for the same endpoint after the endpoint has been audited and consolidated.
3. Authentication and authorization must be server-side; browser storage is UI state only.
4. Database migrations belong in explicit migration files, not in request handlers or application startup.
5. Every tenant-owned record must be protected by server-side ownership checks and, where applicable, database RLS.
6. Session state and billing calculations must use server timestamps as the source of truth.
7. API response contracts must be stable and JSON-based.
8. Destructive schema/file changes require verification against current runtime references first.

## Target modular backend layout

```text
backend/src/
  app.js
  server.js
  db.js
  middleware/
  routes/
  controllers/
  services/
  repositories/
  validators/
  utils/
```

The application should remain a modular monolith unless there is a proven production need for separate services.

## Core domain model

```text
Driving School
  -> Group
     -> Student

Instructor
  -> Vehicle assignment data

Student / Instructor / Vehicle / School / Group
  -> Session

Session
  -> Payment / Report / History
```

## Cleanup policy

Before deleting a legacy file, verify:

- no Vercel route references it;
- no import references it;
- no frontend endpoint calls depend on it;
- no scheduled job/workflow depends on it;
- the replacement path has been tested.

Until that verification is complete, keep the file on the repository but do not add new dependencies to it.
