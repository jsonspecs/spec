# Changelog

All notable changes to the specification are documented here.
The specification follows SemVer 2.0.0 (see README, Versioning).

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
