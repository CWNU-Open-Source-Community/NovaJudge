# Archived pre-unification SQL

These scripts record changes from the earlier public and private editions.
They are outside Prisma's active migrations directory and must not be executed
as an upgrade sequence. In particular, the historical external-login removal
script drops data still used by private deployments.

Use `npm run db:deploy` instead. It recognizes the immutable schema snapshots
in `../legacy-schemas`, records the baseline for a matching existing database,
then applies the additive migrations in `../migrations`.

Keep existing `_prisma_migrations` records. Do not delete history or reset an
existing database to adopt the unified edition. See `docs/DEPLOYMENT.md`.
