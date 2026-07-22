# JSONSpecs Contract Spec — decision register

Russian translation: [DECISIONS_RU.md](DECISIONS_RU.md). Where the two disagree,
this English register is normative.

Goal of the contract: any two conformant implementations MUST produce the same
normative result for the same snapshot and payload. Each decision below is a point
where, without explicit pinning, implementations would diverge. Format per decision:
context → options → resolution → cost relative to the prototype (Node) behavior.

Status: all 31 decisions (D1–D31) and addenda [DR-I]–[DR-X] are **APPROVED** by the
owner. This register is the input for the
specification text (`SPEC.md`) and the conformance fixtures. The closing criterion for
D4, D10, D11 was *minimal total compromise across mainstream backend platforms*
(JVM, Go, .NET, Python, Rust, PHP, Node) — never the convenience of the first Node
implementation. The prototype whose experience produced these decisions is preserved
in `source/`.

---

## D1. Numeric model — APPROVED; precision caveat superseded by D23

**Context.** `equals`, `greater_than`, `field_*_field`, `is_integer`, `COUNT` all rest
on a notion of "number". The prototype implied IEEE 754 binary64 (Node); Java might
parse to `BigDecimal`, Go to `float64` or `json.Number`, and `equals` would diverge at
precision edges.

**Options considered:** (a) IEEE 754 binary64 — matches the prototype, available
everywhere, de-facto JSON; loses precision beyond 2^53 (money in kopecks is safe,
fractional money is not). (b) Arbitrary-precision decimal — exact for money, but
breaking vs the prototype and not native in Go/JS. (c) int64 + binary64 hybrid — worst
of both: int↔float comparison rules would need separate definition.

**Original resolution: (a) binary64.** D23 later closed the entire finite-binary64
domain and supersedes the original "outside the determinism guarantee" caveat: every
finite rounded result is normative. Numeric
strings parse via the pinned grammar `^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$` into binary64.
Consequences: `1 == 1.0`, `1 != "1"` — matches the prototype.

**Cost:** zero — the status quo, stated without reference to JavaScript.

## D2. String length unit (`length_equals`, `length_max`) — APPROVED

**Context.** The prototype used `String(field).length` = UTF-16 code units. Go
natively counts bytes or runes; `"Пётр"` is 4 everywhere, but `"👍"` is 2 (UTF-16),
1 (code points) or 4 (UTF-8 bytes) depending on the platform.

**Options:** UTF-16 units (native Node/Java, alien to Go, "why 16?"); **code points**
(least surprising cross-language; equals the analyst's intuition for Cyrillic names
and addresses; native runes in Go); UTF-8 bytes (Cyrillic ×2 — outright dangerous for
banking length rules); grapheme clusters (Unicode-version-dependent →
non-deterministic by design).

**Resolution: Unicode code points.** The divergence from UTF-16 units exists only on
surrogate pairs (emoji, rare CJK), practically absent from banking payloads, so
migration risk is minimal and the definition is cleaner.

**Cost:** formally breaking vs the prototype on strings with surrogate pairs; the Node
implementation counts code points in v3 (owner confirmed this as a cheap price for
multi-platform movement); fixtures cover exactly this case.

## D3. `length_*` over non-strings — APPROVED

**Context.** The prototype applied `String(field)`: `1e21` → `"1e+21"`, `true` →
`"true"`. Reproducing that in Java/Go means carrying ECMAScript `Number::toString`
into the contract.

**Resolution: FAIL for any non-string value.** Checking the length of a number is
almost always a rule-authoring error (want length — store a string; want a range —
use comparisons). The alternative (normative canonical stringification) drags the most
capricious part of JS into the contract.

**Cost:** breaking if existing packs run `length_*` over numeric fields; the
production-pack audit found none (all 18 `length_max` rules target string fields).
See also the Part I addendum: the same strictness extends to the whole string family.

## D4. Regex dialect — APPROVED; flags and preprocessing superseded by D29

The text below records the original rc.1 decision. D29 removes regex flags and the
extra backslash preprocessing from version 1; only the dialect and the two regex
operators remain current.

**Amendment (approved after the production-pack audit):** the built-in operator set
gains the check operator `not_matches_regex` — the same pattern contract and
preprocessing as `matches_regex`, inverted verdict. Cross-language cost is zero (an
inversion of the same RE2 match). Motivation: every lookahead pattern in the
production pack (17 rules) had the shape "matches base format AND NOT the exception" —
a missing negation at the operator level, not a need for regex power. By the same
logic the predicate `not_in_dictionary` is promoted to built-in (negation of
`in_dictionary`). Absence semantics for both were later subsumed by D13 (skip).

**D4.1 Dialect — an RE2-compatible subset.** Market matrix of standard engines:

| Platform | Standard engine | Runs the RE2 subset | Runs full ECMAScript |
| --- | --- | --- | --- |
| Node.js / TS | V8 (ECMAScript) | yes (superset) | yes |
| Java / Kotlin | java.util.regex | yes (superset) | almost, semantic nuances |
| Go | regexp (RE2) | **yes, natively** | **no** — third-party engine only |
| C# / .NET | Regex (+ NonBacktracking since .NET 7) | yes (NonBacktracking ≈ RE2) | almost |
| Python | re | yes (superset) | almost |
| Rust | crate `regex` (de-facto standard) | **yes, natively** | **no** — `fancy-regex` etc. |
| PHP | PCRE2 | yes (superset) | almost |

The conclusion is unambiguous: the RE2 subset is the only option under which **no**
mainstream backend language needs a non-standard engine. Bonus: linear-time execution
closes ReDoS constructively; the prototype's heuristic ReDoS linter becomes
unnecessary. Normative whitelist: literals, `[]` classes and negations, `|`, anchors
`^ $`, quantifiers `* + ? {n} {n,} {n,m}`, groups `(...)` `(?:...)`, escape classes
`\d \w \s \D \W \S` with **ASCII semantics** (`\d` = `[0-9]`; Rust must compensate
its Unicode default with `(?-u)` or transpilation — one line of code). Excluded:
backreferences, lookaround, named groups, `\b` (word-boundary semantics diverge
between engines — ASCII in RE2/JS, Unicode in Rust; anchored validation patterns do
not need it; adding it later is backward-compatible, removing is not). Conformance
mechanics: a normative subset grammar (EBNF in SPEC.md §3.4.2) plus valid/invalid
pattern fixtures; a subset validator is ~200 lines in any language; out-of-subset
patterns make the snapshot invalid.

**D4.2 Flag `i` — Unicode simple case folding, culture-invariant.** Matches native
RE2 (Go/Rust) and ECMAScript in `u` mode (Node compiles with `u`); Java —
`CASE_INSENSITIVE | UNICODE_CASE`; .NET — mandatory `CultureInvariant` (otherwise the
Turkish locale silently breaks `i`/`I`). ASCII-only folding was rejected: it silently
breaks case-insensitivity on Cyrillic patterns — the worst kind of surprise for a
banking context.

**D4.3 The `\\` → `\` preprocessing pass — kept, pinned normatively (option b).**
Through the market-cost lens: the pass is one `replace` line in any language —
cross-language cost zero. Removing it (option a) means migrating every artifact
written in the `^\\d{6}$` style with a risk of silently changing pattern semantics.
The production pack confirmed the decision on live data: both escaping styles coexist
(17 rules single-escaped, 3 double-escaped relying on the pass).

## D5. Wildcard traversal and total `issues[]` order — APPROVED; match-set definition superseded by D31, ordering retained

**Context.** "Same result" includes the same order of `issues[]`. Step order is fixed
by `flow`, but `accounts[*].balance` enumerates payload keys — JS preserves insertion
order, Go randomizes maps; without a normative order, conformance comparison is
impossible in principle.

**Historical resolution (three rules):** (1) `[*]` matched only non-negative-integer
index segments in the flat projection; D31 replaces this match-set rule with structural
candidates derived from real nested arrays. (2) Enumeration ascends numerically, multiple `[*]` order lexicographically
by index tuple, leftmost most significant ("odometer"); (3) `issues[]` order = document
order of steps (DFS through flow, including condition steps and sub-pipelines at their
call site) → wildcard element order within a rule → strict-escalation summaries after
all issues of their pipeline.

**Historical cost:** zero for arrays under the original flat-key behavior. D31 changes
the population but retains the numeric tuple ordering established here.

## D6. Canonical serialization for `sourceHash` — APPROVED; hash input superseded by D28

**Context.** Implementations verify `sourceHash`, hence must *recompute* it. SHA-256
"over artifacts" without a canonical JSON form is unreproducible: key order, number
representation, and escaping differ between languages.

**Resolution: RFC 8785 (JCS).** Implementations exist for JS/Java/Go; JCS number
serialization aligns with D1 (binary64). Dropping runtime recomputation was rejected
(weakens the snapshot integrity check).

**Cost:** the prototype's `computeSourceHash` was verified byte-identical to an
independent JCS canonicalization on the production snapshot; full equivalence on edge
inputs is closed by fixtures.

## D7. Normative vs informative result surface — APPROVED; result fields refined by D28/D30

D30 removes `control`, `kind`, trace, and engine version from the specified result;
D28 removes snapshot metadata. The following is retained as historical rationale.

**Normative (equality required):** `status`, `control`; `issues[]` — composition,
order (D5), all fields including `message` (authored data passthrough, not
implementation text); `ABORT`: `error.code` and `error.details` (`error.message` is
informative free text); `ruleset.sourceHash` and meta passthrough; and the snapshot
validation *verdict* — conformant implementations MUST reject the same set of inputs.

**Informative (structural contract, no value equality):** `trace` in its entirety
(`at` timestamps are non-deterministic by design); `ruleset.engineVersion`;
rejection-diagnostic texts and granularity.

## D8. Representing "no value" in the result — APPROVED

The normative result is pure JSON; "no value" = **the key is omitted**, never `null` —
with the single deliberate exception of `field: null` on issues not attributable to
one field. `actual` for an absent payload field: the key is omitted.

## D9. Protective rejections as contract — APPROVED

**Context.** Reserved keys (`__proto__`, `prototype`, `constructor`), depth 256. On
Go/Java prototype pollution does not exist — a tempting "optimization" would make the
same payload `ABORT` on Node and `OK` on Go, breaking result equality on flat ground.

**Resolution:** all protective rejections are **MUST for every implementation**,
framed as "keys reserved by the contract", not as a platform defense. ABORT codes are
a closed normative enum (SPEC.md §6.7).

## D10. Custom and unknown operators — APPROVED; registry boundary refined by D26/D27

**The approved model: the spec guarantees only itself; custom operators are
implementation-specific, outside the spec.**

The "same result on any runtime" guarantee is issued strictly within
`jsonspecs/spec` version X: a snapshot using only built-in operators MUST produce an
identical normative result on any conformant implementation. Everything above that is
a promise of the individual implementation, documented and tested by it — the spec
does not participate.

What the spec still defines (the extension interface, nothing more): the result shape
of any operator (`PASS|FAIL|SKIP`) and the
runtime's reaction to its violation; the unknown-operator rule — a snapshot
referencing an operator absent from the implementation's registry is **rejected
before any evaluation**, normative identifier `OPERATOR_NOT_FOUND` (determinism
argument: under a runtime model the verdict would depend on *which* pipeline was run;
reject-before-execution yields one verdict per snapshot, without which the "rejected
inputs set" of D7 is undefinable).
The original design used `requires.operators: string[]` — names only, no versions (there is no separate
operator-spec layer to version). D26 removes that duplicate list and derives the set
from reachable rules; D27 pins the resolved invocation boundary and operator schema.

An implementation author encountering someone else's custom operator chooses freely:
implement it, or honestly return `OPERATOR_NOT_FOUND`. The original decision rejected a
separate cross-runtime operator-pack conformance layer because two runtimes for one
business process appeared unlikely. That premise was later invalidated by the concrete
Node/Java implementation plan. The core still cannot define custom business semantics,
but [DR-VIII] adds a separate operator-pack profile for deployments that claim
cross-runtime equivalence.

## D11. Legacy surfaces — APPROVED: cut along the `formatVersion` boundary

**The contract describes only `formatVersion: 2`; legacy lives in the
`formatVersion: 1` zone, which is entirely outside the contract.**

Minimal-market-compromise logic: every legacy surface included in the contract is
mandatory code in *every* new implementation in *every* language, forever. No Java,
Go, or C# implementation has historical users of `__context` — forcing them to carry
that ballast for compatibility only Node needs is exactly the compromise to avoid.
The `formatVersion` boundary makes the cut clean: `paths[]` (alias of `fields[]` in
`any_filled`) and the special meaning of `payload.__context` do not exist in fv2
(closed schemas reject the former; the latter is an ordinary payload key). Old
runtime signatures are outside the contract entirely — the contract defines no API
(D12).

**Scope clarification: context itself does not leave the contract.** The normative
evaluation input is the tuple `(snapshot, pipelineId?, payload, context?)`: context is
an explicit separate parameter, and `$context.*` paths in rules remain fully
normative. What is cut is only the transport duplicate — the legacy channel of
passing context *inside the payload* under a magic `__context` key. Removing it
strengthens the "engine = pure function" property: payload becomes data only, with no
keys that change evaluation semantics.

Migration fv1 → fv2 is mechanical (`paths` → `fields`; context moves to the call-side
parameter) and belongs to a CLI migrator. The cost is paid once by existing Node
consumers, not permanently by the entire future market of implementations.

**[DR-II]** Approved alongside in Part II of the drafting review: closed artifact
schemas (unknown fields reject the snapshot); as revised by D19, a rule step targeting
a rule without `issue` is invalid; `specVersion` replaces `engine.minVersion` in the snapshot (the snapshot pins
the behavior contract, never an implementation version); `PIPELINE_NOT_FOUND` details
carry only the requested id (no `availablePipelines` — enumerating the ruleset to the
caller is tooling's job); nested strict summaries append inner-to-outer.

## D12. What the contract does not describe at all — APPROVED

Explicit out-of-scope, to prevent later disputes: APIs (function names, signatures,
prepared objects); the moment of validation (load / compile / lazy — only "invalid
input is never evaluated" is normative); compiler phases and diagnostic grouping;
performance and resource limits beyond the normative ones; transport-side truncation;
trace content.

## D13. Absent-field semantics: presence- vs value-operators — APPROVED

**Approved (owner-initiated, generalized to the whole operator family):** whether a
field is required is always a separate, analyst-authored rule; value operators never
imply it.

- **Presence-semantic operators** (absence is part of their domain): `not_empty`
  (absent → FAIL), `is_empty` (absent → PASS), `not_true` (absent → PASS), `any_filled`
  (absent = empty).
- **Value-semantic operators** (everything else, including `is_*` type checks,
  comparisons, regex, dictionaries, and both operands of `field_*_field`): on an
  absent field the operator is **not invoked** and the rule receives `SKIP`. At a
  rule step it produces nothing; in `when` it maps to `false`. Skip is recorded in
  trace (informative, D7).

**Rationale (a DSL design principle, not industry alignment):** whether a field is
mandatory is the analyst's explicit decision, and an *absence* failure is a distinct
diagnostic from an *operator* failure — it deserves its own rule with its own `code`
and `message`, authored by the analyst, rather than a generic error fused into every
value operator. The coincidence with JSON Schema's separation of `pattern`/`enum`
from `required` is incidental, not motivating. Production-pack audit: 127 value
checks; all 12 rules on fields without a paired presence check were already wrapped
in `*_if_present` condition guards — pack verdicts do not change, and those guards
become removable boilerplate (~12 conditions + predicates). This supersedes the
earlier D4-amendment wording of "absent → FAIL" for `not_matches_regex` /
`not_in_dictionary`: both are value-semantic, skip.

## D14. `required_context` removed from the DSL — APPROVED

The pipeline field `required_context` does not exist in the contract (fv2; closed
schemas reject it). This is D13 applied to context: runtime-context completeness is
the analyst's explicit decision, expressed as ordinary rules on `$context.*` paths
(e.g. `not_empty` on `$context.currentDate` with the level, `code`, and `message` the
analyst chooses — typically the first step of an entrypoint flow). Expressiveness
grows: `required_context` could only "EXCEPTION and stop"; a rule can be any level.

Cascading consequences: the sub-pipeline question ("whose required_context is
enforced?") disappears — there is nothing to enforce; so does runtime code generation
from key names (`CTX.<KEY>.REQUIRED` in the prototype) — there are no generated codes,
the analyst writes their own. Important D13 interaction: value checks with an absent
`$context.*` operand skip, so a context-dependent scenario MUST guard it explicitly
if absence is an error. Production-pack migration: 6 entrypoint pipelines with
`required_context: ["currentDate"]` → one shared `not_empty $context.currentDate`
rule (EXCEPTION, authored code) as the first step of each flow. Consumers matching
`CTX.*.REQUIRED` codes migrate to the authored code — part of the v3 major migration.

---

## [DR-III] Addendum: Part III approvals (result contract) — APPROVED

- **`expected` for `field_*_field`** = the resolved value of `value_field` (the
  prototype omitted it, leaving the consumer blind to the comparand). D13 consequence:
  an issue implies both operands were present, so the comparand is always defined.
- **Group-verdict summary issues**: runtime facts go into a `details` object — not
  into `meta` (author-owned in full), and not under the name `aggregate` (the key
  names the role — normative machine-readable detail of the issue — not the source,
  and deliberately mirrors `error.details`). Consumer discriminator: `details.mode`.
  Per-mode shapes are normative; MIN/MAX point `field` at the concrete extremum
  element.
- **`rule.issue.meta` passes through to issues verbatim**; the runtime never writes into it
  (the prototype did not pass it through at all, contrary to its own spec text).
- **ABORT details**: `PAYLOAD_TOO_DEEP` → `{"maxDepth": 256}` with no path in any
  normative surface (which path trips first depends on traversal order);
  `DANGEROUS_PAYLOAD_KEY` with several reserved keys reports the lexicographically
  smallest path (determinism of details).
- **`ruleset.specVersion`** — a normative echo of the behavior contract in the
  result; `engineVersion` is informative.
- **Two failure channels**: snapshot rejection (verdict normative, form not; the one
  normative identifier is `OPERATOR_NOT_FOUND`) and evaluation ABORT (closed code
  enum). Conformance is relative to equal registered operator sets; unconditional for
  built-in-only snapshots.

---

## [DR-I] Addendum: Part I approvals (data model / operators) — APPROVED

- **D3 extended to the string family** (`contains`, `matches_regex`,
  `not_matches_regex`): a non-string value → FAIL; host stringification never
  happens. Same motive as D3: the prototype coerced via `String()` (the number `123`
  passed `^\d+$`), which would drag ECMAScript number formatting into the contract.
- **MIN/MAX over non-comparables**: if elements do not classify to one kind (§2.5),
  the extremum is undetermined → FAIL with a summary issue. What cannot be compared
  is not compared.
- **`onEmpty`** is unified by D20 to `PASS|FAIL|SKIP`; legacy
  `TRUE|FALSE|UNDEFINED` values are invalid.
- **Erratum rc.1: `onEmpty: "ERROR"` removed.** The option promised an ABORT that
  the closed §6.7 enum has no code for; it is also redundant — a hard stop composes
  from `onEmpty: "FAIL"` + `issue.level: "EXCEPTION"` with the analyst's own diagnostics,
  and it was the only place where rule content would produce an anonymous abort,
  breaking the two-channel failure model. Zero production-pack usage.

In the spec these items are referenced as `[DR-I]`; Part II and Part III blocks as
`[DR-II]` and `[DR-III]` respectively.


---

## D15. Normative input — nested JSON only — APPROVED

**Context (external rc.1 review, blocker).** The fv1 dual input form (nested OR flat
payload) is ambiguous: `{"a.b": 1, "a": {"b": 2}}` — which value does path `a.b` get?
Defining escaping, mode detection, and collision handling would bloat the contract.

**Approved:** the normative fv2 input is plain nested JSON only; the flat map is an
internal projection defining path resolution; accepting flat input is an
implementation adapter outside the contract. Keys that break addressing — the empty
key `""` and keys containing `.` `[` `]` — are rejected. Symmetric codes:
`INVALID_PAYLOAD`/`INVALID_CONTEXT` (non-object, `details: {"expected":"object"}`),
`DANGEROUS_*_KEY`/`INVALID_*_KEY` (`details: {parentPath, key}`; parentPath from the
container root, root = `""`), `PAYLOAD_TOO_DEEP`/`CONTEXT_TOO_DEEP`. Check order:
container type → key scan (top-down, never descending into a violating subtree —
ancestors of a visible violation are always clean, so parentPath is well-formed;
precedence: dangerous payload → dangerous context → invalid payload → invalid
context; within a class the lexicographically smallest `(parentPath, key)` pair) →
depth.

**Consequences:** all fixtures with flat payloads were rewritten to nested form;
flat-payload integrations migrate through an adapter. The rc.2 consequence that
wildcard populations remain sparse when a child field is absent is superseded by D31:
real array elements now create structural candidates even when their terminal field is
absent.

## D16. Regex linearity — a property of the language, not of execution — APPROVED

**Context (external rc.1 review, blocker).** "Patterns of the subset execute in
linear time" was wrong: the grammar admits `(a+)+$`, which backtracking engines (V8,
java.util.regex) execute super-linearly.

**Approved:** normatively, "the language is implementable by a linear-time automaton"
(a subset of RE2), plus an informative security note (SHOULD use an automaton engine
or equivalent mitigations) without mandating any library [D12]. For the Node v3
implementation (roadmap, not spec): the dependency `re2` (the npm package is named
`re2`); its adequacy is PROVEN by running the full regex fixture set, including
folding (re2 may ship a different Unicode version than the pinned one — compensation
is mandatory), with the exact dependency version pinned and a banking-grade native
module supply procedure (npm mirror, SBOM, verified binaries or source builds). A
service timeout is defense-in-depth only: synchronous code is truly interruptible
only via a worker/separate process.

## D17. Custom-operator conformance boundary + outcome contract — APPROVED

**Refines D10 and §7.1, as revised by D19.** Equal operator names do not imply equal
semantics: cross-implementation result equality is guaranteed only for snapshots using
built-ins exclusively. The shared extension contract is strictly `PASS|FAIL|SKIP`.
A returned `EXCEPTION` is outside the enum and causes
`ABORT OPERATOR_CONTRACT_VIOLATION`; a thrown exception causes
`ABORT OPERATOR_FAULT`. The reaction is site-independent. Business level
`EXCEPTION` belongs to `rule.issue`, never to the operator. Portable testing uses
`conformance.rule.throw`, `conformance.rule.invalid_result`, and
`conformance.rule.tri`, registered only by conformance runners.

## D18. Unicode pinning for case folding — superseded by D29

This decision governed the now-removed regex `i` flag. It is retained only as the
historical reason the flag was expensive to carry across runtimes.

Flag `i` — Unicode simple case folding per **Unicode 16.0.0**, normative reference to
the immutable file <https://www.unicode.org/Public/16.0.0/ucd/CaseFolding.txt>,
statuses `C` and `S` only (`F` and `T` unused). Equivalence is symmetric and
transitive: points are equivalent iff their foldings are equal (never a
one-directional substitution). Reference facts for fixtures: `и`≡`И`, `K`(U+212A)≡`k`,
`ſ`≡`s`, `Σ`≡`σ`≡`ς`, `ß`≡`ẞ`(U+1E9E), `ß`≢`SS` (full folding excluded), Turkish
`İ`/`ı` fold to themselves and match neither ASCII `i` nor `I`. No table hash needed:
the version plus the immutable link suffice. An implementation whose engine ships a
different Unicode version MUST compensate; adequacy is confirmed by executing the
fixtures, not by assuming compatibility.

---

## [DR-IV] Addendum: external review round rc.1 → rc.2 — APPROVED

Beyond D15–D18, approved as a batch: the algorithmic depth definition (scalar and
empty container = 1; container = 1 + max of children; 256 accepted, 257 rejected; the
limit is an input guard, there is NO normative result depth limit — resolving the
deep-`meta` passthrough paradox); non-JSON host values are an adapter concern; a
formal path EBNF (non-empty segments, no leading-zero indexes, `[*]` only where
allowed, no wildcards in `value_field` / `$context.*`); `aggregate` without a
wildcard in `field` → invalid; the former `summaryIssue` decision is superseded by
D20; `length_*`/`COUNT.value` are non-negative integers; dictionary entry
`code`/`value` are scalars; ownership under overlapping pipeline ids — the longest
prefix; orphan scopes → invalid; `specVersion` acceptance is MUST across the whole
declared range (SHOULD dropped); MIN/MAX tie-break — the first element in enumeration
order; canon priority: text > fixtures, contradictions → erratum + suite version; the
conformance "iff" weakened to "necessary but not sufficient"; the RC version is
threaded end-to-end (`1.0.0-rc.N` in the spec, the generator, fixture snapshots and
`ruleset.specVersion`; the switch to `1.0.0` is one dedicated commit+tag).
Release gate: fixture generation into a temp dir + full tree diff (git diff is blind
to untracked files), the validator checks ABORT fixtures only for the *presence* of
`input.payload` (its type is the runtime's business), hash verification extended to
rejection fixtures (except hash-mismatch), the release checks the tag against the
CHANGELOG and the commit's membership in main, actions pinned by SHA.

---

## D19. One rule model without check/predicate roles — APPROVED

**Approved for rc.3.** The `role` field is removed. An operator always returns one
site-independent `PASS|FAIL|SKIP` outcome, making a rule one reusable business
condition. A rule step maps `FAIL` to an issue; `when` maps `PASS` to `true` and
`FAIL`/`SKIP` to `false`, and never creates issues.

Diagnostics are one optional closed object: `issue: {level, code, message, meta?}`.
It never affects logic. A rule with `issue.level: EXCEPTION` is valid in `when`; a
rule without `issue` is valid as a condition; only a rule step targeting such a rule
is rejected. `meta` moves inside `issue`, and code uniqueness applies among rules
with `issue`.

Returned operator `EXCEPTION` is removed: dynamic business escalation violated
analyst ownership of levels. Any value outside `PASS|FAIL|SKIP`, including
`EXCEPTION`, causes `OPERATOR_CONTRACT_VIOLATION`; a thrown technical failure causes
`OPERATOR_FAULT`. This supersedes the role-specific portions of D10/D13/D17.

## D20. Unified wildcard aggregation and effective population — APPROVED; population refined by D31, MIN/MAX removed by D29

**Approved for rc.3.** Logical aggregation is separate from reporting:
The rc.3 model had `mode = ALL|ANY|COUNT|MIN|MAX`; D29 removes `MIN`/`MAX` from
version 1. `issueMode = EACH|SUMMARY` exists only for
`ALL`/`ANY`. It is required for those modes when `issue` exists and forbidden when
it does not. `COUNT`/`MIN`/`MAX` always summarize on failure. Legacy logical `EACH`
and `summaryIssue` are removed.

A wildcard requires explicit `aggregate`, and aggregate is forbidden without one.
`value_field` contains no wildcard. `onEmpty = PASS|FAIL|SKIP`, default `SKIP`, and
applies only to an empty structural population. D31 defines that population as
structural candidates derived from real array indices, including candidates whose
terminal field is absent. `SKIP` elements are excluded from the effective population;
structural candidates that all skip produce aggregate `SKIP` regardless of `onEmpty`.

Group details distinguish `matched`, `evaluated`, `skipped`, `passed`, and `failed`.
The COUNT change is acknowledged as semantic: skipped check elements could previously
count as passed; now they do not participate. `conformance.rule.tri` portably tests
mixed populations.

## [DR-V] Addendum: unification rc.2 → rc.3 — APPROVED

rc.3 was intended to be the final architectural redesign before `1.0.0`. Review of
the production beneficiaries corpus and database-backed authoring requirements exposed
remaining authoring/runtime coupling and semantic ambiguities. That process decision is
superseded by the explicitly approved rc.4 package D21–D25 below. Scalar
`greater_or_equal`/`less_or_equal` remain backlog candidates without an assigned
decision number.

## D21. Exact ids, explicit exports, and a closed executable bundle — APPROVED

**Approved for rc.4.** Artifact ids are opaque globally unique strings. Every reference
is an exact id; scopes, visibility, relative expansion, orphan scopes, longest-prefix
ownership, and special `library.*` semantics are removed. Imports, aliases, folders, and
taxonomy belong to authoring/build tooling.

Artifact `description` is removed because it is non-executable authoring metadata. The
pipeline `entrypoint` flag and default pipeline selection are removed; every call supplies
`pipelineId`. The snapshot instead carries a mandatory non-empty `exports` list of
pipeline ids: it is the bundle's public API and the root set for reachability,
not a default-selection mechanism. Missing/ill-typed ids produce
`INVALID_PIPELINE_ID`; unknown or non-exported ids produce `PIPELINE_NOT_FOUND`.

The transitive closure from exports MUST equal the artifact set exactly. Source projects
may retain unused files, but production snapshots do not. The closure follows steps,
condition `when` leaves, and normative dictionary references. The control-flow DAG is
also corrected to include both pipeline and condition nodes, closing the latent
condition→condition and pipeline→condition→pipeline cycle hole.

The separate condition artifact is intentionally retained. The production corpus has 96
conditions, 40 reused by more than one caller, and control paths reaching pipeline plus
three nested condition artifacts. Inlining would optimize the runtime schema at the cost
of authoring deeply nested JSON control trees, contrary to the DSL's purpose.

## D22. Deterministic guard short-circuit — APPROVED; extrema portion superseded by D29

**Approved for rc.4.** `when` evaluates recursively, left-to-right, with mandatory
short-circuit: `all` stops at first false and `any` at first true. This is observable when
a later custom operator throws, so exhaustive evaluation is not conformant. Fixtures pin
`any(PASS, throw)`, `all(FAIL, throw)`, and their non-short-circuit counterparts.

The rc.4 extrema decision stated that `MIN`/`MAX` select the raw structural extremum before operator evaluation, then invoke the
operator exactly once. Classification failure or mixed kinds fail before invocation; the
first normative-order element breaks ties; the chosen result, including `SKIP`, becomes
the aggregate result. Effective-population evaluation remains exclusive to
`ALL`/`ANY`/`COUNT`. D29 removes both modes from version 1, so this paragraph is
historical only.

## D23. Closed finite-binary64 number domain — APPROVED

**Approved for rc.4.** Every JSON number token is converted using IEEE 754 binary64
round-to-nearest, ties-to-even. Every finite result is accepted; overflow to infinity is
rejected, underflow follows binary64, and negative zero is normalized to positive zero.
The former "outside the determinism guarantee" caveat is removed: `0.1` is accepted and
`9007199254740993` rounds to `9007199254740992` normatively. Payload/context overflow
uses `INVALID_PAYLOAD_NUMBER`/`INVALID_CONTEXT_NUMBER` with the lexicographically
smallest path. A numeric-looking string is numeric for ordered comparison only when its
conversion is finite; `"1e400"` is valid JSON text but unclassified for ordering.

## D24. Closed nested schemas and custom-operator `params` — APPROVED; refined by D26-D28

**Approved for rc.4.** The snapshot envelope, `requires`, `exports`, `aggregate`, static
dictionary references, object dictionary entries, `when` objects, and steps are explicitly
closed. The rc.4 design retained `snapshot.meta`; D28 removes it. D26 removes
`requires` and object dictionary references; D27 adds named resolved `inputs`.

Operator-specific top-level rule fields are forbidden. A custom rule uses one `params`
JSON object and its registered operator supplies a closed compile-time schema plus its
accepted standard operand fields. Core rejects schema mismatches before execution and
passes accepted params verbatim. Registration API and schema language are implementation
details, but a cross-runtime operator pack must publish equivalent machine-readable
schemas. Strings in params do not create artifact-graph edges; dictionary dependencies
use the normative `dictionary` field.

## D25. Order-independent hash of the executable bundle — superseded by D28

**Historical rc.4 decision; superseded in full by D28.** `sourceHash` was SHA-256
over JCS of `{requires, exports, artifacts}` after sorting operator names, exported
pipeline ids, and artifacts by id. Missing `requires` projects to an empty operator list.
Nested semantic arrays (`flow`, `steps`, `when`, dictionary entries) retain order. This
makes database row order irrelevant while ensuring public API and operator requirements
are authenticated by the same integrity identifier as the executable graph. `meta`
remains excluded.

## [DR-VI] Addendum: executable bundle simplification rc.3 → rc.4 — APPROVED

rc.4 is the final pre-1.0 architectural candidate. The release gate MUST prove the new
closure, combined-DAG, short-circuit, extrema, binary64, nested-schema, params-schema, and
hash rules with both positive and rejection fixtures, and MUST be demonstrated red by an
intentional violation before tagging. Further pre-1.0 changes are limited to errata found
while implementing Node and Java against this exact candidate.

## D26. Map-shaped artifacts and one exact step form — APPROVED

**Approved for rc.5; supersedes the array/id and typed-step portions of D11, D21, and
D25.** `artifacts` is an object keyed by globally unique artifact id; artifact values
have no repeated `id`. Pipeline and condition both use `steps`, and each step is one
exact id string whose target type is read from the artifact. `stepId` is removed.

`requires.operators` is removed because the required custom set is derived from
reachable rule operator names minus built-ins. A missing derived operator still produces
the normative `OPERATOR_NOT_FOUND` rejection. Dictionary references become exact id
strings and dictionary entries are unique scalars only. These changes eliminate data
that duplicated information already present in the closed graph.

## D27. Core-resolved operator inputs and constant params — APPROVED

**Approved for rc.5; refines D10, D17, D19, and D24.** Every operator registers one
closed compile-time contract for accepted standard operands, named `inputs`, and
constant `params`. `inputs` maps operator-declared names to core path strings. Core
validates and resolves all paths before invocation and never passes the whole payload,
context, or a resolver API to an operator.

At runtime an absent resolved path is an absent invocation key, while a present JSON
`null` is a present key with value `null`. Named `inputs` are scalar non-wildcard
paths; the exact abstract invocation record is pinned in §3.1. The operator result remains exactly
`PASS|FAIL|SKIP`; throw/panic is `OPERATOR_FAULT`, never a fourth outcome. For custom
issues, `actual` comes from the resolved primary field and `expected` from `value` or
resolved `value_field`, with absent operands omitted. Operators cannot author runtime
diagnostic fields.

RC.5 errata clarify that required `inputs` names are compile-time configuration
requirements, not runtime presence requirements. Missing resolved named inputs are
delivered as omitted map members and never trigger core-level `SKIP`. The automatic
absence rule applies to every configured standard `field`/`value_field` operand of a
custom operator, whether its configuration is required or optional; a custom operator
observes absence only through `inputs`. Compile-time operand type constraints describe
the authored configuration, not the runtime values resolved from paths. `fields` remains
private to the built-in `any_filled`, and `value`/`value_field` are mutually exclusive.
The registry binds each non-empty name exactly once, and built-in names cannot be
shadowed by custom packages.

## D28. I-JSON boundary, whole-snapshot JCS hash, and no snapshot meta — APPROVED

**Approved for rc.5; supersedes D6 and D25.** Text adapters reject duplicate object
member names and unpaired surrogates before an ordinary lossy parse. JCS ordering is
unsigned UTF-16 code-unit order, exactly RFC 8785; U+10000 sorts before U+E000.

`sourceHash` is SHA-256 over JCS of the complete snapshot with only `sourceHash`
removed. `exports` is required to arrive unique and strictly sorted in JCS string order;
verification rejects unsorted input instead of normalizing it. Snapshot-level `meta` is
removed because unhashed normative passthrough allowed equal hashes to produce unequal
results. Authored `rule.issue.meta` remains open, hashed inside its artifact, and passed
through normatively.

## D29. Remove unproven version-1 features — APPROVED

**Approved for rc.5; supersedes the affected parts of D4, D18, D20, and D22.** Version
1 removes pipeline `strict`, aggregate `MIN`/`MAX`, and regex `flags`; none occurs in the
reviewed production corpora and each carries disproportionate cross-runtime semantics.
They may return in a later compatible spec extension after a concrete use case and
portable vectors exist. `ALL`, `ANY`, and `COUNT` remain.

Regex patterns are interpreted exactly after I-JSON decoding. The prototype's extra
backslash-collapse pass is removed and legacy patterns are normalized once by migration.
Comparison operators remain explicit DSL verbs; implementations may share an internal
comparison primitive without replacing readable operators by `compare + params`.

## D30. Minimal normative result — APPROVED

**Approved for rc.5; refines D7 and D8.** `control` is removed because it is fully
derived from `status`; constant issue `kind` is removed; `stepId` disappears with object
steps. Trace and engine version are implementation API concerns, not fields of the core
result. `ruleset` contains only normative `specVersion` and `sourceHash`.

## D31. Structural wildcard candidates for required child fields — APPROVED

**Context.** Under the rc.5 flat-map match rule, `items[*].sku` enumerated only leaves
that already existed. For `{"items":[{}, {"sku":"A"}]}`, the first element vanished
from the population, so `not_empty + ALL` incorrectly passed. `onEmpty` could not help
because the population was not globally empty. This prevented an ordinary rule from
expressing that every real array element must contain a child field.

**Options considered:** (a) keep sparse matching and require validation outside the
rules layer; (b) add a dedicated operator such as `each_has`, a new wildcard form, or a
new aggregate field; (c) keep the DSL unchanged and derive the wildcard population from
real nested-array structure before resolving each concrete terminal path.

**Approved for rc.6: option (c).** Every `[*]` enumerates only real indices of the
corresponding array in the normative nested payload. Exact key tokens address only own
JSON-object members; exact index tokens address only in-range JSON-array elements. A
numeric string key of an object is never an array index.

An absent or impassable exact segment before a later wildcard ends that branch because
the next real index cannot be synthesized. Once all wildcard indices are known, an
absent or impassable exact suffix preserves one absent structural candidate with its
fully synthesized concrete path. The terminal candidate is classified through the
existing §2.7 leaf projection: scalars, `null`, and empty containers are present;
non-empty containers at the terminal path are absent. Candidate formation is independent
of the operator, and D13 then determines how absence becomes `PASS`, `FAIL`, or `SKIP`.

D31 supersedes the flat-map match-set portion of D5 and the sparse-child consequence of
D15. D5's numeric odometer ordering remains. D20's structural population is now the D31
candidate list; `onEmpty`, all-`SKIP`, counters, exhaustive evaluation, and issue modes
are unchanged and apply to that list. Wildcards in `$context.*` remain forbidden.

**Cost and migration.** This is an intentional breaking semantic change without a new
DSL field, operator, snapshot shape, or `formatVersion`. Snapshots rebuild with
`specVersion: "1.0.0-rc.6"`, which also changes `sourceHash`; the Node implementation
moves to its next major version. Required-child rules use ordinary absence-observing
operators such as `not_empty` with `EACH`. A terminal `items[*]` still does not expose
non-empty object or array values to operators, so it is not a general collection-size
check.

## [DR-VII] Addendum: final format review rc.4 → rc.5 — APPROVED

rc.5 is an intentional final format redesign, not rc.4 polishing. Its release gate MUST
cover the map artifact shape, string steps, derived custom operators, core-resolved
inputs, absent-vs-null invocation semantics, I-JSON pre-parse rejection, unsigned UTF-16
JCS ordering across Node and Java, whole-snapshot hashing, removed legacy fields, and
the retained hashed `rule.issue.meta`. After rc.5, pre-1.0 changes are errata only.

## [DR-VIII] Addendum: RC.5 semantic closure errata — APPROVED

Implementation review of RC.5 exposed requirements that existed in intent but were not
executable or unambiguous. The RC.5 edition therefore pins, without changing its format:

- exact custom-operator operand schemas and absent named-input invocation;
- no-operand schemas for `conformance.rule.throw`/`invalid_result` and exhaustive
  aggregate probes through `conformance.rule.tri`;
- `numeric-string` operands for scalar ordered comparisons;
- escaped-only literal hyphens, absolute anchors, and dot semantics excluding only LF;
- exhaustive left-to-right aggregate evaluation, atomic `EACH` issue materialization,
  and the `COUNT + onEmpty` details shape;
- technical `ABORT` discards previously accumulated business issues, while
  `EXCEPTION` preserves them;
- `OPERATOR_NOT_FOUND` only after all validation that does not require the missing
  operator's unavailable contract succeeds;
- closed result, issue, error, and ruleset objects; and
- a separate versioned cross-runtime operator-pack profile with a supported core-version
  range, shared golden vectors, and algorithm-tagged deployment provenance.

These are errata because each resolves a contradiction or makes an already approved
boundary testable. Scalar `greater_or_equal`/`less_or_equal` remain unapproved backlog
features and are not added by this edition.

## [DR-IX] Addendum: RC.5 portability and fixture-runner closure — APPROVED

Reviewing the RC.5 implementation exposed four remaining portability gaps. This
edition closes them without changing the snapshot or result format:

- The original per-quantifier and pattern-length limits did not bound compilation
  expansion. For example, a backend may reject `(a{40}){30}` despite accepting each
  individual quantifier. The grammar now adds a maximum nested counted-repeat factor
  of 1000 and an expanded-atom budget of 10000. A conforming adapter must accept every
  pattern inside the grammar and all four limits, independently of lower backend
  program-size or compilation-memory limits. The factor catches narrow nested repeats
  such as the example above; the atom budget separately catches wide groups repeated
  1000 times. A budget of 10000 still permits ten authored atoms at the maximum repeat.
- A character-class escape is a complete item, never a range endpoint. Explicit
  rejection vectors cover both `\d-z` and `0-\d`; an implementation must validate the
  portable grammar before delegating to a more permissive host engine.
- A closed operator contract means finite, explicitly enumerated names at the operator
  configuration, `inputs`, and immediate `params` levels. Configured `inputs` names are
  globally non-empty, including when the operator itself is unavailable. Dynamic name
  families would otherwise give Java, Go, and Node adapters different validation
  surfaces.
- Rejection expectations are closed, so an absent `identifier` must be asserted rather
  than ignored. Evaluation fixtures compare the JSON data model, not host prototypes,
  classes, map implementations, or property iteration order.

These are semantic errata: they make the accepted language, rejection precedence, and
fixture comparison executable across runtimes; they add no DSL fields or result data.

## [DR-X] Addendum: numeric representation wording and regex boundary vectors — APPROVED

An external review identified wording that could be mistaken for additional freedom at
the snapshot boundary. This edition clarifies existing behavior without changing the
snapshot or result format:

- The mandatory §2.2 conversion of every snapshot number to binary64, including `-0`
  normalization, occurs before JCS serialization. The statement that no other
  normalization occurs excludes only additional JSONSpecs-specific transformations;
  it does not bypass §2.2.
- A rule's literal `value` in an issue is the parsed snapshot value after recursive
  §2.2 conversion, not the authored numeric token. Therefore an authored
  `9007199254740993` is represented in `expected` as `9007199254740992`.
- The existing search and absolute-anchor semantics imply that an empty pattern matches
  every string and `^$` matches only the empty string. Dedicated vectors now pin both
  cases.
- Character-class items form a union and leading `^` complements that union over Unicode
  scalar values. The result is allowed to be empty. A dedicated vector requires
  `^[^\D\d]$` to compile successfully and fail for every one-code-point subject instead
  of turning a backend rendering limitation into snapshot rejection.

The aggregate rule is unchanged. §3.6.2 already requires exhaustive aggregate
evaluation and makes any later operator fault abort the evaluation; §5.4 separately
defines short-circuiting guards. Existing vectors cover both boundaries.
