# Behavior specification and conformance suite for JSONSpecs rules runtimes

Русская версия: [README_RU.md](README_RU.md).

This repository defines **what** a rules runtime does — never **how**. For snapshots
using only built-in operators, any implementation (Node.js, Java, Go, …) that produces
the same normative result for the same inputs and accepts/rejects the same snapshots is
conformant. End-to-end equality for custom operators additionally requires the
cross-runtime operator-pack profile in `SPEC.md` §7.1. APIs, compilation strategy,
internal representations, and performance are explicitly out of scope.

## Layout

| Path                                                                  | Role                                                                                                                                                           |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`SPEC.md`](SPEC.md)                                                  | **The canon.** Normative behavior specification for the version tagged on this repository.                                                                     |
| [`SPEC_RU.md`](SPEC_RU.md)                                            | Full Russian translation with matching structure; `SPEC.md` prevails if the texts diverge.                                                                     |
| [`DECISIONS.md`](DECISIONS.md) / [`DECISIONS_RU.md`](DECISIONS_RU.md) | Decision register D1–D31 + addenda: every design decision with its reasoning, alternatives, and migration cost, referenced from the spec as `[D#]` / `[DR-*]`. |
| [`MIGRATION_RC6.md`](MIGRATION_RC6.md) / [`MIGRATION_RC6_RU.md`](MIGRATION_RC6_RU.md) | Required package changes and semantic differences when moving from RC.5 to RC.6. |
| [`fixtures/`](fixtures/)                                              | **Normative appendix.** Conformance fixtures; passing all of them is necessary but not sufficient for conformance. See `fixtures/README.md`.                   |
| [`source/`](source/)                                                  | Historical, non-normative: the prototype's specification (`jsonspecs/rules`) and the production-pack audit the decisions refer to.                             |
| [`tools/`](tools/)                                                    | Fixture generator and validator (Node ≥ 20, no dependencies).                                                                                                  |

## Consuming this spec as an implementer

1. Implement the behavior in `SPEC.md`. When a statement carries `[D#]`/`[DR-*]`, the
   register explains _why_ — read it before assuming the spec is wrong.
2. Build a fixture runner: for each file in `fixtures/**`, feed
   `snapshot` + `input` to your runtime and compare the **normative projection**
   (SPEC.md §7.2) to `expected` with structural JSON equality (§6.1). Rejection
   fixtures must be refused before any evaluation; an absent rejection `identifier`
   must be checked as absence, not ignored. Compare JSON data rather than host object
   prototypes, classes, map implementations, or property iteration order.
3. Declare conformance: implementation + version, supported `specVersion` range, and
   registered non-built-in operator names (§7.1).

Do **not** treat any existing implementation as the reference. The English `SPEC.md`
is the canon; fixtures are its executable normative appendix. A contradiction is fixed
as a spec erratum plus a versioned fixture update, never by silently following an
implementation.

## Versioning and release process

- The specification follows **SemVer 2.0.0**. Text and fixtures version together,
  atomically, under one tag: `vMAJOR.MINOR.PATCH[-rc.N]`.
- **Patch**: editorial fixes, fixture additions that pin already-specified behavior.
  **Minor**: backward-compatible behavior additions (new operators, new fields with
  defined absence semantics). **Major**: anything that changes a verdict on an
  existing valid input.
- Current status: **1.0.0-rc.6**. The `v1.0.0` tag is applied after the
  cross-implementation stand comparison (Node v3 vs Java) confirms the suite:

```
git tag v1.0.0-rc.6 && git push origin v1.0.0-rc.6   # release candidate (prerelease)
git tag v1.0.0      && git push origin v1.0.0        # after stand confirmation
```

Pushing a `v*` tag triggers `.github/workflows/release.yml`: fixtures are validated,
a source archive is built, and a GitHub Release is created with generated notes
(tags containing `-rc` are marked prerelease). CI (`ci.yml`) additionally guards that
`fixtures/` and `tools/generate-fixtures.mjs` never diverge.

## Local checks

```
node tools/validate-fixtures.mjs    # structural validity + sourceHash integrity
node tools/validate-doc-parity.mjs  # English/Russian SPEC structure parity
node tools/generate-fixtures.mjs    # regenerate fixtures (edit the generator, not the JSONs)
java tools/JcsUtf16Check.java       # independent Java hash/order vector
```

## Relation to jsonspecs/rules

`jsonspecs/rules` (Node) is the applied prototype this specification grew from; its
documents are preserved verbatim in `source/`. Starting with `@jsonspecs/rules` v3,
the Node implementation claims conformance to this specification like any other
implementation — it holds no special status. Rules v3 targets RC.5; Rules v4 is the
first Node release intended to target RC.6.
