# Changelog

All notable changes to the specification are documented here.
The specification follows SemVer 2.0.0 (see README, Versioning).

## [1.0.0-rc.7] — 2026-07-22

Exact-index portability erratum following the immutable RC.6 release (DR-XI).

- Clarified that exact path index tokens have no implementation-sized upper bound,
  are not binary64 numbers, and must be range-checked without rounding.
- Required synthesized concrete issue paths to preserve the exact authored decimal
  index token.
- Added the D31 vector for `items[*][9007199254740993].sku` and made it mandatory in
  the fixture validator.
- Kept `v1.0.0-rc.6` fixed on its original 308-fixture corpus. RC.7 changes
  `specVersion`, so every snapshot and `sourceHash` must be rebuilt.
- Fixtures: 308 → **309** (220 evaluation, 89 rejection).

## [1.0.0-rc.6] — 2026-07-22

Structural wildcard candidates for required child fields (D31).

- Changed `[*]` population construction from existing flat-map leaves to real indices
  of the normative nested payload arrays.
- Preserved one absent structural candidate after the final wildcard when its exact
  suffix is missing or impassable; absence before a later wildcard still creates no
  branch because no real next index can be determined.
- Pinned type-safe traversal: keys address only own JSON-object members and exact indices
  address only in-range JSON-array elements. Numeric object keys are not array indices.
- Kept the §2.7 terminal leaf model: scalars, `null`, and empty containers are present;
  non-empty terminal containers remain absent and are not exposed to operators.
- Applied existing D13 absence semantics and D20 aggregation to the new candidate list.
  `matched` includes absent candidates, value-operator absence contributes to `skipped`,
  and all-`SKIP` remains distinct from `onEmpty`.
- Added concrete `EACH` issue paths for missing child fields, nested-array and impassable
  path vectors, terminal-wildcard vectors, exact-token type boundaries, numeric ordering,
  and aggregate fault preservation.
- Added wildcard-absence vectors for `is_empty` and `not_true`, plus adjacent
  `matrix[*][*]` traversal.
- Made `SPEC.md` the single suite-version source for generation, validation, the Java
  hash vector, and release-tag verification.
- Recorded D31 as the sole scope-limited exception to the pre-1.0 design moratorium.
- No operator, DSL field, snapshot shape, result field, or `formatVersion` was added.
- Fixtures: 281 → **308** (219 evaluation, 89 rejection).

## [1.0.0-rc.5] — 2026-07-21

Final executable-format simplification, portable operator invocation boundary, and
semantic-closure errata (D26–D30 and addenda [DR-VII]–[DR-X]).

- Changed `artifacts` from an array with repeated ids to an object keyed by id.
- Unified pipeline and condition steps as exact id strings; removed typed step objects
  and `stepId`.
- Removed `requires.operators`; custom dependencies are derived from reachable rules.
- Simplified dictionary references to id strings and entries to unique scalars.
- Added closed, core-resolved custom-operator `inputs`; `params` remains constants only.
  Operators receive neither raw payload/context nor a resolver.
- Made I-JSON the raw transport boundary: duplicate members and lone surrogates are
  rejected before lossy parsing.
- Defined `sourceHash` as SHA-256 over JCS of the whole snapshot with only
  `sourceHash` omitted; pinned unsigned UTF-16 ordering and removed snapshot `meta`.
  Authored `rule.issue.meta` remains hashed and normatively passed through.
- Removed unproven version-1 features: pipeline `strict`, aggregate `MIN`/`MAX`, regex
  flags, and the prototype's extra backslash preprocessing.
- Reduced the normative result by removing `control`, issue `kind`, `stepId`, trace,
  and engine version. Comparison operators remain explicit DSL verbs.
- Clarified named-input and standard-operand absence, exact conformance-operator schemas,
  unambiguous operator registration, numeric-string comparisons, portable regex
  anchors/dot/classes, exhaustive aggregation, atomic `EACH` issues, technical `ABORT`
  issue disposal, `OPERATOR_NOT_FOUND` precedence, and closed result objects.
- Added a separate cross-runtime operator-pack profile with shared golden vectors and
  deployment provenance, without coupling it to snapshot hashing.
- The 2026-07-22 portability errata add finite-name operator contracts, non-empty
  configured `inputs` names, explicit character-class range endpoints, and portable
  regex compilation budgets for nested repeats and expanded atoms.
- Fixture-runner comparison now requires absence of a rejection `identifier` to be
  asserted and compares JSON data independently of host prototypes and classes.
- Clarified that §2.2 number conversion precedes JCS hashing and that issue `expected`
  contains the converted snapshot value. Added zero-width regex boundary vectors and
  acceptance coverage for a complemented character class whose resulting set is empty.
- Fixtures: 163 → **281** (193 evaluation, 88 rejection), including raw I-JSON,
  UTF-16/JCS, absent-vs-null operator inputs, regex portability, aggregate fault/order,
  rejection precedence, and a complete built-in operator outcome matrix.

## [1.0.0-rc.4] — 2026-07-21

Executable-bundle simplification and cross-runtime semantic closure (D21–D25 and
addendum [DR-VI]).

- Replaced scopes and relative resolution with globally unique opaque ids and exact
  references. Retained reusable condition artifacts.
- Added mandatory direct `exports: [pipelineId, ...]`; removed pipeline `entrypoint`
  and default selection. Every evaluation now supplies an explicit exported `pipelineId`.
- Required the final snapshot to contain exactly the transitive closure of its exports;
  the control-flow DAG now combines pipeline and condition nodes.
- Removed artifact `description` from the executable graph; authoring metadata belongs
  outside artifacts or in `snapshot.meta`.
- Made `when` evaluation left-to-right and short-circuiting. Defined MIN/MAX as raw
  extremum selection followed by exactly one operator invocation.
- Closed the numeric model to finite IEEE 754 binary64, including normative rounding
  and structured payload/context overflow errors.
- Added custom-operator `params` with compile-time registered closed schemas and closed
  every nested core object shape.
- Expanded `sourceHash` to the order-independent projection of `requires`, direct
  `exports`, and artifacts sorted by id.
- Fixtures: 128 → **163** (109 evaluation, 54 rejection), including the five RC.4
  decision groups and `conformance.rule.params`.

## [1.0.0-rc.3] — 2026-07-21

Final pre-1.0 architectural unification (D19–D20 and addendum [DR-V]).

- Removed rule `role: check|predicate`; every operator now has one site-independent
  outcome contract: `PASS|FAIL|SKIP`.
- Added optional closed `rule.issue: {level, code, message, meta?}`. Rule steps require
  it; `when` accepts every rule and always ignores it.
- Removed returned business `EXCEPTION`: out-of-enum returns, including `EXCEPTION`,
  are `OPERATOR_CONTRACT_VIOLATION`; thrown failures are `OPERATOR_FAULT` at either site.
- Unified wildcard aggregation: explicit `ALL|ANY|COUNT|MIN|MAX`, separate
  `issueMode: EACH|SUMMARY`, structural `onEmpty`, and effective populations that
  exclude `SKIP`.
- Group details now distinguish `matched`, `evaluated`, `skipped`, `passed`, and
  `failed`; COUNT no longer counts skipped elements as passed.
- Replaced role-specific test operators with `conformance.rule.throw`,
  `conformance.rule.invalid_result`, and `conformance.rule.tri`.
- Fixtures: 113 → **128** (94 evaluation, 34 rejection), including D19 reuse and the
  D20 aggregation boundary.
- Declared rc.3 the final architecture change before `1.0.0`; subsequent RC changes
  are errata only.

## [1.0.0-rc.2] — 2026-07-21

External review round (see decision register D15–D18 and addendum [DR-IV]).

- **D15**: normative input is nested JSON only; the flat map is an internal
  projection; unaddressable keys (empty, containing `.` `[` `]`) are rejected.
  Symmetric ABORT codes: `INVALID_PAYLOAD`/`INVALID_CONTEXT`,
  `DANGEROUS_*_KEY`/`INVALID_*_KEY` with `{parentPath, key}` details,
  `PAYLOAD_TOO_DEEP`/`CONTEXT_TOO_DEEP`; pinned validation order.
- **D16**: regex linearity restated as a property of the language (RE2 subset), not
  of every execution; informative security note.
- **D17**: custom-operator conformance boundary; operator outcome contract incl.
  returned `EXCEPTION`; reserved `conformance.*` test operators.
- **D18**: Unicode 16.0.0 CaseFolding.txt (statuses C+S) pinned for flag `i`.
- [DR-IV]: algorithmic depth (256 accepted / 257 rejected; no result depth limit),
  path grammar EBNF, schema pinnings (aggregate/wildcard, `summaryIssue` default,
  integer constraints, dictionary entry types), longest-prefix scopes + orphan
  rejection, MUST version-range acceptance, MIN/MAX tie-break, canon-over-fixtures
  priority, RC version threaded end-to-end.
- Fixtures: 80 → **113** (84 evaluation, 29 rejection); flat payloads rewritten to
  nested; new sets: input types, invalid keys, depth bounds, case folding,
  conformance operators, path grammar, JCS edges, MIN tie-break.
- Tooling/release gate: full tree diff against the generator, hash integrity for
  rejection fixtures, ABORT-fixture payload presence-only validation, tag/main and
  CHANGELOG checks in release, actions pinned by SHA.

## [1.0.0-rc.1] — 2026-07-21

Initial release candidate.

- `SPEC.md` / `SPEC_RU.md` — behavior specification 1.0.0: data model, operator
  semantics, artifact formats (`formatVersion: 2`), evaluation semantics, result
  contract, conformance.
- `DECISIONS.md` / `DECISIONS_RU.md` — decision register D1–D14 with Part I–III addenda.
- `fixtures/` — 79 conformance fixtures (57 evaluation, 22 rejection) covering D1–D14
  and core semantics.
- `source/` — prototype documents (jsonspecs/rules) and the production-pack audit that
  informed the decisions.
- CI validation and tag-driven release workflow.

The `v1.0.0` tag is applied after cross-implementation comparison
(Node v3 vs Java) on a live stand confirms the fixtures.
