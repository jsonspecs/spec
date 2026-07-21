# jsonspecs/spec

Behavior specification and conformance suite for JSONSpecs rules runtimes.
Русская версия: [README_RU.md](README_RU.md).

This repository defines **what** a rules runtime does — never **how**. Any
implementation (Node.js, Java, Go, …) that, for the same snapshot, payload, and
context, produces the same normative result and accepts/rejects the same inputs is
conformant. APIs, compilation strategy, internal representations, and performance are
explicitly out of scope.

## Layout

| Path | Role |
| --- | --- |
| [`SPEC.md`](SPEC.md) / [`SPEC_RU.md`](SPEC_RU.md) | **The canon.** Behavior specification for the version tagged on this repository. States only expected behavior; rationale lives in the decision register. |
| [`DECISIONS.md`](DECISIONS.md) / [`DECISIONS_RU.md`](DECISIONS_RU.md) | Decision register D1–D20 + addenda: every design decision with its reasoning, alternatives, and migration cost, referenced from the spec as `[D#]` / `[DR-*]`. |
| [`fixtures/`](fixtures/) | **Normative appendix.** Conformance fixtures; an implementation is conformant iff it passes all of them. See `fixtures/README.md`. |
| [`source/`](source/) | Historical, non-normative: the prototype's specification (`jsonspecs/rules`) and the production-pack audit the decisions refer to. |
| [`tools/`](tools/) | Fixture generator and validator (Node ≥ 20, no dependencies). |

## Consuming this spec as an implementer

1. Implement the behavior in `SPEC.md`. When a statement carries `[D#]`/`[DR-*]`, the
   register explains *why* — read it before assuming the spec is wrong.
2. Build a fixture runner: for each file in `fixtures/**`, feed
   `snapshot` + `input` to your runtime and compare the **normative projection**
   (SPEC.md §7.2) to `expected` with structural JSON equality (§6.1). Rejection
   fixtures must be refused before any evaluation.
3. Declare conformance: implementation + version, supported `specVersion` range, and
   registered non-built-in operator names (§7.1).

Do **not** treat any existing implementation as the reference. The fixtures are the
reference; where an implementation and the fixtures disagree, the implementation is
wrong (or the fixture is — file an issue, the suite is versioned and fixable before
tagging).

## Versioning and release process

- The specification follows **SemVer 2.0.0**. Text and fixtures version together,
  atomically, under one tag: `vMAJOR.MINOR.PATCH[-rc.N]`.
- **Patch**: editorial fixes, fixture additions that pin already-specified behavior.
  **Minor**: backward-compatible behavior additions (new operators, new fields with
  defined absence semantics). **Major**: anything that changes a verdict on an
  existing valid input.
- Current status: **1.0.0-rc.3**. The `v1.0.0` tag is applied after the
  cross-implementation stand comparison (Node v3 vs Java) confirms the suite:

```
git tag v1.0.0-rc.3 && git push origin v1.0.0-rc.3   # release candidate (prerelease)
git tag v1.0.0      && git push origin v1.0.0        # after stand confirmation
```

Pushing a `v*` tag triggers `.github/workflows/release.yml`: fixtures are validated,
a source archive is built, and a GitHub Release is created with generated notes
(tags containing `-rc` are marked prerelease). CI (`ci.yml`) additionally guards that
`fixtures/` and `tools/generate-fixtures.mjs` never diverge.

## Local checks

```
node tools/validate-fixtures.mjs    # structural validity + sourceHash integrity
node tools/generate-fixtures.mjs    # regenerate fixtures (edit the generator, not the JSONs)
```

## Relation to jsonspecs/rules

`jsonspecs/rules` (Node) is the applied prototype this specification grew from; its
documents are preserved verbatim in `source/`. Starting with `@jsonspecs/rules` v3,
the Node implementation claims conformance to this specification like any other
implementation — it holds no special status.
