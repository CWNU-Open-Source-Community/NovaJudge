# Immutable database adoption snapshots

- `public.prisma`: public master `45b66446e90fc5b5564a80300fcd98396d816a7d`.
- `internal.prisma`: private master `33af663c39187246736ea0c7a685f063d42f8abf`.
- `unified.prisma` records the unified schema at `3dc89bc24db4d0dc5320bb865042c2f4d5b93111`.

These are reference schemas for recognizing existing installations, not
alternate application schemas. Do not edit them when adding new features.
Only `prisma/schema.prisma` and new active migrations evolve.
