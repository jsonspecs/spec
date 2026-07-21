# Conformance fixtures

This tree is a **normative appendix** of the specification (SPEC.md §7.3): the spec
text and the fixtures version together, atomically, under one tag. Passing every
fixture of a version is a necessary condition of a conformance claim — not a
sufficient one; the SPEC text is the canon (SPEC.md §7.3).

## Format

Evaluation fixture — run the input against the snapshot, compare the normative
projection (SPEC.md §7.2) structurally:

```json
{
  "name": "d13/value-check-skips-on-absent",
  "snapshot": { "format": "jsonspecs-snapshot", "formatVersion": 2, "...": "..." },
  "operators": [],
  "input": { "pipelineId": "checks.main", "payload": {}, "context": {} },
  "expected": { "status": "OK", "control": "CONTINUE", "issues": [], "ruleset": { "...": "..." } }
}
```

Rejection fixture — the snapshot MUST be refused before any evaluation:

```json
{ "name": "d04/reject-lookahead", "snapshot": { "...": "..." }, "operators": [],
  "expected": { "verdict": "reject" } }
```

`operators` is the set of registered non-built-in operator names for the fixture
(conformance is relative to equal operator sets — SPEC.md §7.1). `identifier` in a
rejection `expected` is present only where the spec makes the rejection cause itself
normative (`OPERATOR_NOT_FOUND`).

Comparison is **structural JSON equality** (SPEC.md §6.1): array order matters, object
key order does not, absent key ≠ key with `null`, numbers compare as binary64 values.

## Layout

Directories map to decisions (`DECISIONS.md`) and semantic areas:
`d01-numbers`, `d02-length`, `d03-string-strict`, `d04-regex`, `d05-order`,
`d06-hash`, `d08-representation`, `d09-guards`, `d10-operators`, `d11-snapshot`,
`d13-absence`, `d19-unified-rules`, `d20-aggregation`, `semantics`.

The reserved test-only operators `conformance.rule.throw`,
`conformance.rule.invalid_result`, and `conformance.rule.tri` are registered by the
fixture runner only. `tri` maps input strings `PASS`, `SKIP`, and `FAIL` to the
same-named outcomes so mixed aggregate populations can be tested portably. They are
not production operators.

## Maintenance

Fixtures are generated: edit `tools/generate-fixtures.mjs`, run it, commit both.
CI fails if the tree and the generator diverge. `tools/validate-fixtures.mjs` checks
structure and `sourceHash` integrity (JCS/RFC 8785 + SHA-256) of every snapshot —
including rejection fixtures, so each rejects for its intended reason (the single
exception is `d06/reject-source-hash-mismatch`, whose broken hash *is* the test).
For ABORT fixtures the validator checks only the presence of `input.payload`: its
type is deliberately wrong in `INVALID_PAYLOAD`/`INVALID_CONTEXT` fixtures and is
the tested runtime's business.

---

Дерево — **нормативное приложение** спеки (§7.3): текст и фикстуры версионируются
одним тегом. Прохождение всех фикстур версии — необходимое, но не достаточное условие
декларации конформанса; канон — текст спеки (SPEC.md §7.3). Сравнение — структурное равенство JSON нормативной проекции
(§7.2). Фикстуры генерируются из `tools/generate-fixtures.mjs`; правки — в генераторе.
