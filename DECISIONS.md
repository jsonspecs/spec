# JSONSpecs Contract Spec — decision register

Русская версия (первоисточник): [DECISIONS_RU.md](DECISIONS_RU.md). Where the two
disagree, the Russian original wins.

Goal of the contract: any two conformant implementations MUST produce the same
normative result for the same snapshot and payload. Each decision below is a point
where, without explicit pinning, implementations would diverge. Format per decision:
context → options → resolution → cost relative to the prototype (Node) behavior.

Status: all 18 decisions (D1–D18) and addenda [DR-I]–[DR-IV] are **APPROVED** by the
owner. This register is the input for the
specification text (`SPEC.md`) and the conformance fixtures. The closing criterion for
D4, D10, D11 was *minimal total compromise across mainstream backend platforms*
(JVM, Go, .NET, Python, Rust, PHP, Node) — never the convenience of the first Node
implementation. The prototype whose experience produced these decisions is preserved
in `source/`.

---

## D1. Numeric model — APPROVED

**Context.** `equals`, `greater_than`, `field_*_field`, `is_integer`, `COUNT` all rest
on a notion of "number". The prototype implied IEEE 754 binary64 (Node); Java might
parse to `BigDecimal`, Go to `float64` or `json.Number`, and `equals` would diverge at
precision edges.

**Options considered:** (a) IEEE 754 binary64 — matches the prototype, available
everywhere, de-facto JSON; loses precision beyond 2^53 (money in kopecks is safe,
fractional money is not). (b) Arbitrary-precision decimal — exact for money, but
breaking vs the prototype and not native in Go/JS. (c) int64 + binary64 hybrid — worst
of both: int↔float comparison rules would need separate definition.

**Resolution: (a) binary64**, with two normative caveats: integers within
±(2^53 − 1) are exact; numbers outside that range or fractions not representable in
binary64 are outside the determinism guarantee (round-to-nearest-even applies). Numeric
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

## D4. Regex: dialect, flags, preprocessing — APPROVED (three sub-decisions + amendment)

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

## D5. Wildcard traversal and total `issues[]` order — APPROVED

**Context.** "Same result" includes the same order of `issues[]`. Step order is fixed
by `flow`, but `accounts[*].balance` enumerates payload keys — JS preserves insertion
order, Go randomizes maps; without a normative order, conformance comparison is
impossible in principle.

**Resolution (three rules):** (1) `[*]` matches only non-negative-integer index
segments; (2) enumeration ascends numerically, multiple `[*]` order lexicographically
by index tuple, leftmost most significant ("odometer"); (3) `issues[]` order = document
order of steps (DFS through flow, including condition steps and sub-pipelines at their
call site) → wildcard element order within a rule → strict-escalation summaries after
all issues of their pipeline.

**Cost:** zero for arrays (matches observed prototype behavior, including sparse flat
keys like `a[0], a[2], a[5]` — verified empirically); fixtures cover the gap case.

## D6. Canonical serialization for `sourceHash` — APPROVED

**Context.** Implementations verify `sourceHash`, hence must *recompute* it. SHA-256
"over artifacts" without a canonical JSON form is unreproducible: key order, number
representation, and escaping differ between languages.

**Resolution: RFC 8785 (JCS).** Implementations exist for JS/Java/Go; JCS number
serialization aligns with D1 (binary64). Dropping runtime recomputation was rejected
(weakens the snapshot integrity check).

**Cost:** the prototype's `computeSourceHash` was verified byte-identical to an
independent JCS canonicalization on the production snapshot; full equivalence on edge
inputs is closed by fixtures.

## D7. Normative vs informative result surface — APPROVED

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

## D10. Custom and unknown operators — APPROVED (revision 2)

**The approved model: the spec guarantees only itself; custom operators are
implementation-specific, outside the spec.**

The "same result on any runtime" guarantee is issued strictly within
`jsonspecs/spec` version X: a snapshot using only built-in operators MUST produce an
identical normative result on any conformant implementation. Everything above that is
a promise of the individual implementation, documented and tested by it — the spec
does not participate.

What the spec still defines (the extension interface, nothing more): the result shape
of any operator (`OK|FAIL|EXCEPTION` / `TRUE|FALSE|UNDEFINED|EXCEPTION`) and the
runtime's reaction to its violation; the unknown-operator rule — a snapshot
referencing an operator absent from the implementation's registry is **rejected
before any evaluation**, normative identifier `OPERATOR_NOT_FOUND` (determinism
argument: under a runtime model the verdict would depend on *which* pipeline was run;
reject-before-execution yields one verdict per snapshot, without which the "rejected
inputs set" of D7 is undefinable); the optional snapshot field
`requires.operators: string[]` — names only, no versions (there is no separate
operator-spec layer to version) — letting an implementation reject a non-portable
snapshot from one field without walking the artifacts.

An implementation author encountering someone else's custom operator chooses freely:
implement it, or honestly return `OPERATOR_NOT_FOUND`. An intermediate layer
("operator packs as separate conformance units with their own specs and versions")
was **deliberately rejected**: two runtimes for one business process is an unlikely
scenario in practice, and the layer would tie implementers' hands without delivering
value. Consequence for production packs: the quality of their custom-operator
documentation is the pack's and its consumers' responsibility; the spec and the
conformance suite do not check it.

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
schemas (unknown fields reject the snapshot); a rule step referencing a predicate is
invalid; `specVersion` replaces `engine.minVersion` in the snapshot (the snapshot pins
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
  (absent → FAIL), `is_empty` (absent → OK), `not_true` (absent → OK), `any_filled`
  (absent = empty).
- **Value-semantic operators** (everything else, including `is_*` type checks,
  comparisons, regex, dictionaries, and both operands of `field_*_field`): on an
  absent field the operator is **not invoked** — the check yields OK with no issue
  (*skip*), the predicate yields UNDEFINED. The skip is recorded in trace
  (informative, D7); the normative result is untouched.

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
- **Rule `meta` passes through to issues verbatim**; the runtime never writes into it
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
  `not_matches_regex`): a non-string value → FAIL/FALSE; host stringification never
  happens. Same motive as D3: the prototype coerced via `String()` (the number `123`
  passed `^\d+$`), which would drag ECMAScript number formatting into the contract.
- **MIN/MAX over non-comparables**: if elements do not classify to one kind (§2.5),
  the extremum is undetermined → FAIL with a summary issue. What cannot be compared
  is not compared.
- **Cross-role `onEmpty` values** (`TRUE`/`FALSE` on a check, `PASS`/`FAIL` on a
  predicate) — the artifact is invalid; there is no silent coercion.
- **Erratum rc.1: `onEmpty: "ERROR"` removed.** The option promised an ABORT that
  the closed §6.7 enum has no code for; it is also redundant — a hard stop composes
  from `onEmpty: "FAIL"` + `level: "EXCEPTION"` with the analyst's own diagnostics,
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

**Consequences:** sparse wildcard matches REMAIN (a gap arises from an absent child
field: `{"x":[{"v":1},{},{"v":2}]}` → `x[0].v`, `x[2].v`) — the D5 ordering rule does
not simplify; all fixtures with flat payloads were rewritten to nested form;
flat-payload integrations migrate through an adapter / the Node v3 CLI.

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

**Refines D10 and §7.1.** Equal operator names do not imply equal semantics:
cross-implementation equality of the result is guaranteed only for snapshots using
built-in operators exclusively. For custom operators, what is shared is the extension
contract: a check returns exactly `OK|FAIL|EXCEPTION`, a predicate exactly
`TRUE|FALSE|UNDEFINED` (the predicate enum has NO `EXCEPTION` — a predicate's "cannot
evaluate" is `UNDEFINED`; this resolves an ambiguity in the earlier D10 wording). A
check operator returning `EXCEPTION` is a deliberate "evaluation impossible" outcome:
an issue with the rule's authored `code`/`message`/`meta`, no `expected`/`actual`,
level `EXCEPTION` overriding the declared level, stop per §5.6. A thrown failure →
`ABORT OPERATOR_FAULT`; an out-of-enum result → `ABORT OPERATOR_CONTRACT_VIOLATION`.
Portable testability — the reserved operators `conformance.check.throw` /
`.invalid_result` / `.exception`, `conformance.predicate.throw` /
`.invalid_result`, registered ONLY by conformance runners (the production runtime is
unchanged — no conflict with §7.4 "conformance without modes"). Business semantics of
a custom operator are its package's responsibility.

## D18. Unicode pinning for case folding — APPROVED

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
wildcard in `field` → invalid; `summaryIssue` defaults to `false`, valid only with
`ALL`; `length_*`/`COUNT.value` are non-negative integers; dictionary entry
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