# Migrating from 1.0.0-rc.5 to 1.0.0-rc.6

Русская версия: [MIGRATION_RC6_RU.md](MIGRATION_RC6_RU.md).

RC.6 changes wildcard traversal semantics. It does not add or remove any DSL field.
The change is intentionally incompatible for rules that use `[*]`: the same rule and
input may now produce a different result when an array element lacks the exact suffix
after the final wildcard.

## Required package changes

1. Set the snapshot `specVersion` to `1.0.0-rc.6`.
2. Rebuild the complete snapshot and recalculate `ruleset.sourceHash`. A snapshot built
   for RC.5 is not an RC.6 snapshot even when its authoring sources are unchanged.
3. Run the complete RC.6 conformance suite. In particular, run every fixture in
   `fixtures/d31-wildcard/`.
4. Re-run package samples whose rules contain `[*]` and review the changed findings,
   counters, concrete issue paths, and aggregate statuses.

Whether one runtime release accepts both RC.5 and RC.6 snapshots is an implementation
policy. The RC.6 behavior specification does not require RC.5 compatibility or define
fallback behavior between specification versions.

## What changed

In RC.5, wildcard matches were derived from existing leaves in the flat path projection.
Consequently, `order.items[*].sku` could omit an array element that had no `sku` member.

In RC.6, every real array index reached by `[*]` creates a structural candidate. After
the final wildcard, an absent or impassable exact suffix is preserved as one absent
candidate with a concrete path:

```text
order.items[0].sku = absent
order.items[1].sku = "BKS-0987"
```

Before the final wildcard, an absent or impassable exact segment terminates only that
branch because there is no array from which the later wildcard can enumerate candidates.
See `SPEC.md` §3.6.1 and decision D31.

Exact path segments remain type-sensitive:

- a key segment traverses only an own member of a JSON object;
- an index segment traverses only an in-range element of a JSON array;
- an object member named `"0"` is not array index `[0]`;
- an out-of-range array index is absent.

## Required child field

The following rule now checks `sku` for every existing element of `order.items`:

```json
{
  "type": "rule",
  "operator": "not_empty",
  "field": "order.items[*].sku",
  "aggregate": {
    "mode": "ALL",
    "issueMode": "EACH",
    "onEmpty": "FAIL"
  },
  "issue": {
    "level": "ERROR",
    "code": "ORDER.ITEM.SKU.REQUIRED",
    "message": "Specify the item SKU"
  }
}
```

For an element without `sku`, `not_empty` returns `FAIL`, and `EACH` emits an issue whose
`field` is the synthesized concrete path, such as `order.items[0].sku`.

An empty, absent, non-array, or otherwise impassable collection yields no structural
candidates. `onEmpty` controls that case. It is distinct from a present array element
whose required child is absent.

## Value operators and counters

An absent structural candidate is still subject to the operator's ordinary absence
semantics. A value operator such as `equals` returns `SKIP` for that candidate. Therefore:

- candidates exist, so `onEmpty` does not apply;
- if every candidate returns `SKIP`, the aggregate result is `SKIP`;
- `matched` counts all structural candidates;
- `evaluated` counts only `PASS` plus `FAIL`;
- `skipped` counts `SKIP` results.

Use a presence operator such as `not_empty` when absence itself must fail. Do not expect
a value operator or `onEmpty` to turn an absent child into `FAIL`.

## Terminal wildcard warning

A path ending in a wildcard, for example `order.items[*]`, still applies the flat-leaf
classification from `SPEC.md` §2.7 after structural candidates have been formed. A
non-empty object or array is not itself a leaf operand. Review such rules separately;
RC.6 does not redefine them as whole-element checks.

## Conformance-only operator

The reserved operator `conformance.rule.tri` and its `"INVALID"` input are only for
conformance fixtures. `"INVALID"` makes the operator return an out-of-contract value so
that runtimes can prove that later wildcard candidates are still evaluated. It is not a
business-rule feature and must not be exposed as one.
