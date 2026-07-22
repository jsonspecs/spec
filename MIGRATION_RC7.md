# Migrating from 1.0.0-rc.6 to 1.0.0-rc.7

Русская версия: [MIGRATION_RC7_RU.md](MIGRATION_RC7_RU.md).

RC.7 is a portability erratum for exact array-index tokens in paths. It adds no DSL
field, operator, snapshot shape, result field, or new business behavior. It makes the
already unbounded path grammar executable consistently when an index exceeds a host
language's safe integer range.

## Required package changes

1. Set the snapshot `specVersion` to `1.0.0-rc.7`.
2. Rebuild the complete snapshot and recalculate `ruleset.sourceHash`. An RC.6 snapshot
   is not an RC.7 snapshot even when its authoring sources are unchanged.
3. Run all 309 RC.7 conformance fixtures, including every fixture in
   `fixtures/d31-wildcard/`.
4. Pin implementations and vendored conformance corpora to the final RC.7 commit or the
   `v1.0.0-rc.7` tag. Do not identify the 309-fixture corpus as RC.6.

## Exact index contract

The digits of an exact path index are syntax, not a JSON number. They are not converted
to binary64 and have no implementation-sized upper bound. Range checks must use the
exact non-negative integer value, and a synthesized concrete issue path must retain the
same decimal token:

```text
items[*][9007199254740993].sku
→ items[0][9007199254740993].sku
```

Converting the token through JavaScript `Number`, Java `double`, or any bounded integer
that cannot represent it exactly is non-conforming. An implementation may use an
arbitrary-precision integer or compare the canonical decimal token with the array length
without numeric rounding.

## Release identity

The published `v1.0.0-rc.6` tag remains fixed on its original 308-fixture corpus. RC.7
contains 309 fixtures: 220 evaluation and 89 rejection. The added fixture is
`d31/large-exact-index-after-wildcard-preserves-concrete-path`.

Whether one runtime accepts both RC.6 and RC.7 snapshots is implementation policy. The
specification defines no fallback or automatic version substitution.
