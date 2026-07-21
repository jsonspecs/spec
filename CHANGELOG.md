# Changelog

All notable changes to the specification are documented here.
The specification follows SemVer 2.0.0 (see README, Versioning).

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
