# JSONSpecs Behavior Specification

**Version:** 1.0.0-rc.3 · **Status:** Release Candidate — the `v1.0.0` tag is applied after
cross-implementation comparison on a live stand (see repository README, Release process).

This specification is the canon of runtime behavior for a given version. It states only
expected behavior. The reasoning behind every decision lives in a separate document —
`DECISIONS.md` / `DECISIONS_RU.md` — which in turn refers to the prototype
implementation (`source/`) whose practical experience produced these decisions.

**Notation.** `[D1]`…`[D20]` refer to numbered decisions in `DECISIONS.md`;
`[DR-I]`…`[DR-V]` refer to its addenda. MUST/MUST NOT/SHOULD/MAY per RFC 2119.

---

## 1. Introduction and scope

This specification defines the observable behavior of a JSONSpecs rules runtime:

1. the format of rule artifacts and snapshots;
2. the semantics of built-in operators — what they decide, not how;
3. the format and content of the evaluation result.

Two conformant implementations, given the same snapshot, the same `payload`, and the same
`context`, MUST produce identical normative results (Part III defines the normative
surface) and MUST accept or reject the same set of inputs. For snapshots using
non-built-in operators this guarantee is bounded by §7.1. `[D17]` The text of this
specification is the canon; the fixture suite is a mandatory but not sufficient check
of a conformance claim (§7.3).

This specification does not define APIs, function names, internal representations,
compilation strategies, the moment at which validation occurs, performance characteristics,
or transport-level limits on payload or result size. An implementation MAY compile
snapshots ahead of time, interpret them directly, build any intermediate structure, or
none — these choices are invisible to conformance. `[D12]`

The key words MUST, MUST NOT, SHOULD, MAY are to be interpreted as described in RFC 2119.

Custom operators are outside this specification. The specification defines only the
extension interface (operator result shape, unknown-operator rejection — Part II);
the behavior of any non-built-in operator is a promise of the individual implementation,
not of this specification. `[D10]`

---

## 2. Data model

### 2.1 Values

A *value* is a JSON value: `null`, boolean, number, string, array, or object. There is no
`undefined` in the data model. Where an implementation's host language distinguishes
"absent" from "null", only the JSON-visible distinction is normative: a key that is not
present versus a key whose value is `null`.

All inputs (artifacts, snapshot, payload, context) and the normative result are JSON
documents. Structures that cannot round-trip through JSON serialization (cyclic references,
non-finite numbers, host-specific types) are outside the model; the runtime boundary MUST
reject them (Part II, input validation).

**Maximum depth.** Depth is defined algorithmically: a scalar or an empty container has
depth 1; a non-empty container has depth 1 + the maximum depth of its members. Every
input document — each artifact, the payload, the context — MUST NOT exceed depth
**256**: depth 256 is accepted, 257 is rejected (Part II). `[D9][DR-IV]` The limit is an
*input guard*, not a constraint on the result: a result built from bounded inputs is
bounded by construction plus fixed envelope overhead, and no normative depth limit
applies to it: moving accepted `issue.meta` into the result envelope must not make the
result invalid.

Values that are not JSON documents (host-language cycles, functions, BigInt and the
like) are outside the data model entirely; how an implementation's API boundary treats
them is an adapter concern, out of scope. `[DR-IV]`

**Reserved keys.** The object keys `__proto__`, `prototype`, and `constructor` are
forbidden in payload and context at any depth. This is a contract rule, not a
platform-specific defense: implementations on platforms with no prototype semantics MUST
reject these keys all the same, otherwise identical inputs would produce different
verdicts across implementations. `[D9]`

### 2.2 Numbers

Numbers are interpreted as **IEEE 754 binary64** values. `[D1]`

- Integers in the range ±(2^53 − 1) are represented exactly.
- A JSON number whose mathematical value is not exactly representable in binary64
  (an integer outside the safe range, or a decimal fraction such as `0.1` used in a
  context where its binary64 rounding is observable) is *outside the determinism
  guarantee*: implementations MUST apply round-to-nearest-even, and IEEE 754-conformant
  platforms will agree in practice, but rule authors SHOULD NOT rely on comparisons at
  the edge of binary64 precision.
- `1` and `1.0` denote the same value. `is_integer` accepts any number whose fractional
  part is zero; `1.0` passes, `1.5` fails.

**Numeric strings.** In ordered comparisons (§2.5) a string is *numeric* if and only if it
matches:

```
^[+-]?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$
```

A numeric string is converted to binary64 with round-to-nearest-even. Strings not matching
this grammar are not numbers for comparison purposes, regardless of what a host language's
lenient parser would accept (`" 5"`, `"0x10"`, `"5,0"`, `"Infinity"` are not numeric).

### 2.3 Strings

Strings are sequences of Unicode code points.

**Length.** Wherever this specification measures string length (`length_equals`,
`length_max`), the unit is the **Unicode code point**. `[D2]` A surrogate pair counts
as one. Implementations whose native string length is UTF-16 code units (JavaScript,
Java) MUST count code points explicitly.

Grapheme clusters are never used: their definition depends on the Unicode version and
would make results release-dependent.

### 2.4 Equality

Two values are *equal* when:

- both are `null`; or
- both are booleans with the same value; or
- both are numbers with the same binary64 value (`1 == 1.0`); or
- both are strings with the same sequence of code points.

Values of different types are never equal: `1` ≠ `"1"`, `false` ≠ `0`, `null` ≠ `""`.
There is no coercion. Arrays and objects are never equal to anything under this relation
(equality is defined for scalar comparison in operators; deep structural equality is not
part of the operator model).

### 2.5 Ordered comparison

Ordered comparison (`greater_than`, `less_than`, `field_*_field`) operates on two operands
classified independently:

| Operand | Classification |
| --- | --- |
| JSON number | **number** |
| string matching the numeric grammar (§2.2) | **number** (converted to binary64) |
| string matching `^[0-9]{4}-[0-9]{2}-[0-9]{2}$` that is a valid proleptic Gregorian calendar date | **date** |
| anything else (booleans, `null`, arrays, objects, other strings) | **unclassified** |

Calendar validity includes month range 01–12, day range valid for the month, and leap-year
rules for February; `2026-02-30` and `2026-13-01` are not dates. The year range is
0000–9999. Date ordering is chronological (equivalently: lexicographic over the canonical
`YYYY-MM-DD` string).

A comparison is *determined* only when both operands classify to the **same** kind
(both numbers or both dates). If either operand is unclassified, or the kinds differ, the
comparison is *undetermined*, and the operator returns `FAIL` for present operands.

Note the classification is disjoint by construction: no string is simultaneously numeric
and a date.

### 2.6 Emptiness

A field is *empty* when it is:

- **absent** — its path does not resolve in the flattened payload (§2.7); or
- `null`; or
- `""` (the empty string).

`false`, `0`, `[]`, and `{}` are **not** empty.

### 2.7 Paths, flattening, and field resolution

**Path syntax.** A field reference is a dot-notation path over the flat payload map:

```
order.amount
accounts[0].balance
accounts[*].balance          ← wildcard, §3.6
$context.currentDate         ← context access
```

**Normative input form.** `[D15]` The payload and the context are ordinary nested JSON
objects. The flat path → value map below is an **internal projection** that defines
path resolution — it is not an input format: accepting pre-flattened input is an
implementation adapter outside this contract. So that every leaf has exactly one
unambiguous path, object keys in payload and context MUST NOT be empty and MUST NOT
contain `.`, `[` or `]` — such keys are unaddressable, and the input is rejected
(Part II, `INVALID_PAYLOAD_KEY` / `INVALID_CONTEXT_KEY`).

**Flattening (internal projection).** Normatively defined as follows:

- A nested object key `k` under prefix `p` produces paths `p.k…`; an array element at
  index `i` under prefix `p` produces paths `p[i]…`.
- **Leaves** are: scalars (`null`, boolean, number, string), the empty object `{}`, and
  the empty array `[]`. A leaf's path maps to its value.
- A **non-empty container does not itself appear** in the flat map — only its
  descendants' paths do. Given `{"a": [1]}`, the flat map is `{"a[0]": 1}`; the path `a`
  is *absent*. Given `{"a": []}`, the flat map is `{"a": []}` and `a` resolves to the
  value `[]` (which is non-empty per §2.6).

**Resolution.** Resolving path `f` against the flat map yields either
*(present, value)* or *absent*. There is no partial resolution and no prototype-chain
or default-value fallback.

**Path grammar.** `[DR-IV]` A field reference MUST match:

```ebnf
path      = [ "$context." ] , segment , { "." , segment } ;
segment   = key , { index } ;
key       = key-char , { key-char } ;                  (* non-empty *)
key-char  = ? any code point except "." "[" "]" ? ;
index     = "[" , ( "0" | nz-digit , { digit } ) , "]"  (* no leading zeros *)
          | "[*]" ;
```

Paths violating the grammar (empty segments, `a..b`, leading-zero indexes like
`a[01]`) make the artifact invalid. `[*]` is permitted only where §3.6 allows it;
`value_field` and `$context.*` paths MUST NOT contain `[*]`.

**Context access.** Paths with the reserved prefix `$context.` resolve against the
`context` input instead of the payload, with the same resolution semantics. Wildcards are
not permitted inside `$context.*` paths (artifact rejection). The prefix is reserved:
a payload key literally named `$context` has no special meaning and is unreachable via
`$context.*` paths.

The legacy mechanism of passing context inside the payload under a `__context` key does
**not** exist in this specification: `__context` is an ordinary payload key with no
special semantics. `[D11]`

---

## 3. Operator semantics

### 3.1 Operator model

A *rule* applies one operator to payload and, possibly, context. A rule has no
`check` or `predicate` role: it is one business condition whose consequences are
determined by its use site (§5.3–§5.4). `[D19]`

The normative operator outcome is exactly one of `PASS`, `FAIL`, `SKIP`:

- `PASS` — the condition is satisfied;
- `FAIL` — the condition is not satisfied;
- `SKIP` — the condition is semantically not applicable to this input.

A returned value outside this closed enum, including the string `EXCEPTION`, causes
`ABORT OPERATOR_CONTRACT_VIOLATION`. A thrown exception or host panic causes
`ABORT OPERATOR_FAULT`. The reaction is independent of whether the rule is invoked
from a step or from `when`. A business stop is expressed only by a rule `FAIL` with
`issue.level: "EXCEPTION"`; an operator neither selects a level nor creates an issue.
`[D17][D19]`

Operator behavior is a pure function of resolved field values, rule parameters
(`value`, `value_field`, `fields`, `dictionary`, `flags`), referenced dictionary
contents, and context. Operators MUST NOT depend on the use site, evaluation order,
wall-clock time, locale, or any other ambient state.

**Absent-field behavior.** `[D13][D19]`

- **Presence semantics** (`not_empty`, `is_empty`, `not_true`, `any_filled`):
  absence is in their domain; the outcome is listed below.
- **Value semantics** (all others): when a required operand is absent, the operator
  is not invoked and the rule receives `SKIP`. This applies to both operands of
  `field_*_field`.

`SKIP` has no effect in a rule step and maps to `false` in `when`. Requiredness is
therefore always expressed by a separate presence rule. An implementation SHOULD
record `SKIP` in trace, but trace cannot change the normative result.

**String-strict operators** `[D3][DR-I]`: `contains`, `matches_regex`, and
`not_matches_regex` require a string; a present non-string produces `FAIL`. Host
stringification is never applied.

### 3.2 Built-in operators

Every operator in this table is allowed both in a rule step and in `when`. The
"Absent" column gives the rule outcome when the path does not resolve. All
comparisons use §2.4 and §2.5 without other coercion.

| Operator | Parameters | PASS when | Absent |
| --- | --- | --- | --- |
| `not_empty` | — | field is not empty (§2.6) | FAIL |
| `is_empty` | — | field is empty (§2.6) | PASS |
| `not_true` | — | value is anything except boolean `true` | PASS |
| `any_filled` | `fields: path[]` | at least one listed field is not empty; `field` is unused | absence = empty; FAIL when all are empty |
| `is_boolean` | — | value is a boolean | SKIP |
| `is_string` | — | value is a string | SKIP |
| `is_number` | — | value is a number | SKIP |
| `is_integer` | — | value is a number with zero fractional part | SKIP |
| `equals` | `value` | value equals `value` (§2.4) | SKIP |
| `not_equals` | `value` | value does not equal `value` | SKIP |
| `contains` | `value: string` | value contains `value` as a substring | SKIP |
| `matches_regex` | `value: pattern`, `flags?` | string contains a pattern match (§3.4) | SKIP |
| `not_matches_regex` | `value: pattern`, `flags?` | string contains no pattern match | SKIP |
| `greater_than` | `value: number \| date-string` | comparison is determined and field > value | SKIP |
| `less_than` | `value: number \| date-string` | comparison is determined and field < value | SKIP |
| `length_equals` | `value: number` | string has exactly `value` code points; non-string → FAIL | SKIP |
| `length_max` | `value: number` | string has at most `value` code points; non-string → FAIL | SKIP |
| `field_equals_field` | `value_field: path` | both fields are present and equal | SKIP if either is absent |
| `field_not_equals_field` | `value_field: path` | both are present and unequal | SKIP if either is absent |
| `field_greater_than_field` | `value_field: path` | both present, determined, field > value_field | SKIP if either is absent |
| `field_less_than_field` | `value_field: path` | both present, determined, field < value_field | SKIP if either is absent |
| `field_greater_or_equal_than_field` | `value_field: path` | both present, determined, field ≥ value_field | SKIP if either is absent |
| `field_less_or_equal_than_field` | `value_field: path` | both present, determined, field ≤ value_field | SKIP if either is absent |
| `in_dictionary` | `dictionary: {type:"static", id}` | value matches an entry (§3.5) | SKIP |
| `not_in_dictionary` | `dictionary: {type:"static", id}` | value matches no entry (§3.5) | SKIP |

`any_filled` accepts only `fields[]`; the legacy `paths[]` alias does not exist.
The "required and satisfies X" idiom remains two rules: one presence rule and one
value rule. `[D11][D13]`

### 3.3 Outcome interpretation

| Outcome | Rule step | `when` leaf |
| --- | --- | --- |
| `PASS` | produces nothing | `true` |
| `FAIL` | creates an issue from `rule.issue` | `false`, no issue |
| `SKIP` | produces nothing | `false` |

The `issue` object does not participate in logical evaluation. A rule with
`issue.level: "EXCEPTION"` MAY therefore be used in `when`; it remains an ordinary,
side-effect-free condition at that site. `[D19]`

### 3.4 Regular expressions

`[D4]` This section defines the complete pattern language. It is a portable subset chosen
so that every mainstream backend platform can execute it with its standard regex engine
(it is a strict subset of RE2, of ECMAScript-with-`u`, of `java.util.regex`, and of .NET
non-backtracking mode). The language is implementable by a linear-time
automaton (it is a subset of RE2) — a property of the *language*, not of every
execution: backtracking engines may execute some subset patterns (e.g. `(a+)+$`)
super-linearly. `[D16]` *Security note (informative):* implementations SHOULD execute
patterns with an automaton-based engine or apply equivalent mitigations; the choice is
out of contract scope `[D12]`.

#### 3.4.1 Preprocessing

Before parsing, exactly one replacement pass is applied to the pattern string: each pair
of consecutive backslashes `\\` is replaced by a single backslash `\`. The pass is not
iterative. `[D4.3]` (Consequence: at the JSON-source level, both `"^\\d+$"` and
`"^\\\\d+$"` denote the pattern `^\d+$`.)

#### 3.4.2 Grammar

After preprocessing, the pattern MUST conform to:

```ebnf
pattern      = alternation ;
alternation  = concat , { "|" , concat } ;
concat       = { element } ;
element      = anchor | quantified ;
anchor       = "^" | "$" ;
quantified   = atom , [ quantifier ] ;
quantifier   = ( "*" | "+" | "?" | counted ) ;            (* no lazy/possessive modifiers *)
counted      = "{" , int , [ "," , [ int ] ] , "}" ;      (* {n} {n,} {n,m}, n ≤ m *)
atom         = literal | "." | escape | class | group ;
group        = "(" , [ "?:" ] , alternation , ")" ;
class        = "[" , [ "^" ] , class-item , { class-item } , "]" ;
class-item   = class-atom , [ "-" , class-atom ]          (* range: left ≤ right *)
             | class-escape ;
class-atom   = class-literal | escaped-meta | char-escape ;
escape       = escaped-meta | char-escape | class-escape ;
escaped-meta = "\" , ( "\" | "." | "*" | "+" | "?" | "(" | ")" | "[" | "]"
                     | "{" | "}" | "|" | "^" | "$" | "/" | "-" ) ;
char-escape  = "\n" | "\r" | "\t" ;
class-escape = "\d" | "\D" | "\w" | "\W" | "\s" | "\S" ;
int          = digit , { digit } ;                        (* value ≤ 1000 *)
```

`literal` is any code point except the metacharacters `\ . * + ? ( ) [ ] { } | ^ $`.
`class-literal` is any code point except `\ ] -` (a literal `-` is written first, last,
or escaped; a literal `^` inside a class anywhere except the first position).

**Explicitly excluded** (their presence makes the pattern, and hence the snapshot,
invalid): backreferences, lookahead/lookbehind `(?= (?! (?<= (?<!`, named groups
`(?<name>`, word boundaries `\b \B`, inline flags `(?i)`, hex/unicode escapes
`\xHH \uHHHH \x{…}` (Unicode characters are written literally or escaped at the JSON
string level, which already provides `\uXXXX`), POSIX classes `[:alpha:]`, nested
classes, octal escapes, and any escape not listed in the grammar.

**Normative limits** (protect against divergent engine-internal limits): every `int` in a
quantifier MUST be ≤ 1000; the preprocessed pattern MUST be ≤ 1024 code points. Patterns
violating the grammar or the limits make the artifact invalid — this is an artifact
rejection, not a runtime error.

#### 3.4.3 Matching semantics

- The subject is a sequence of Unicode code points; `.` matches any single code point
  except U+000A LINE FEED. (JavaScript implementations MUST compile with the `u` flag to
  obtain code-point semantics.)
- `\d` = `[0-9]`, `\w` = `[0-9A-Za-z_]`, `\s` = `[ \t\n\r\f\v]`, uppercase forms are
  their complements. **ASCII semantics regardless of platform defaults** — engines whose
  defaults are Unicode-aware (e.g. Rust `regex`) MUST compensate. `[D4.1]`
- Matching is a **search**: the pattern matches if any substring (including the empty
  substring) matches. Authors anchor with `^`/`$` explicitly.
- Flags: only `i`, `m`, `s`, each at most once, in any order; any other flag string makes
  the artifact invalid.
  - `i` — case-insensitive via **Unicode simple case folding**, culture-invariant,
    pinned to **Unicode 16.0.0**: the normative mapping is
    <https://www.unicode.org/Public/16.0.0/ucd/CaseFolding.txt>, statuses `C` and `S`
    only (`F` and `T` entries are not used). Equivalence is symmetric and transitive —
    two code points are equivalent iff their simple foldings are equal, never a
    one-directional substitution. Consequences: `и` ≡ `И`; `K` (U+212A) ≡ `k`;
    `ſ` ≡ `s`; `Σ` ≡ `σ` ≡ `ς`; `ß` ≡ `ẞ` (U+1E9E) but `ß` ≢ `SS` (full folding
    excluded); Turkish `İ`/`ı` fold to themselves and match neither ASCII `i` nor `I`;
    Turkish-locale behavior MUST NOT leak in. Implementations whose engine ships a
    different Unicode version MUST compensate. `[D4.2][D18]`
  - `m` — `^`/`$` additionally match after/before U+000A.
  - `s` — `.` also matches U+000A.

### 3.5 Dictionaries

A dictionary is a named list of `entries`. A payload value *matches* an entry when:

| Entry form | Matches when |
| --- | --- |
| scalar (string, number, or boolean; `null` entries make the artifact invalid) | value equals the entry (§2.4) |
| object with `code` and/or `value` fields | value equals `entry.code` **or** equals `entry.value` (whichever fields are present are both eligible) |
| object with neither field | never matches (artifact SHOULD be rejected by schema; if present, it is a non-match) |

Matching is §2.4 equality — strict, no coercion; the payload value's type must match the
entry's type. `in_dictionary` is `PASS` when any entry matches; `not_in_dictionary` is
`PASS` when the field is present and no entry matches. `dictionary.type` MUST be
`"static"`.

### 3.6 Wildcards and aggregation

#### 3.6.1 Wildcard resolution and enumeration order `[D5]`

A `field` path may contain `[*]` segments. Each segment matches non-negative integer
indices at that position in the internal flat map. Resolution returns concrete paths
present after flattening the normative nested JSON input.

Indices are ordered numerically ascending; gaps are allowed. Multiple wildcard
segments are ordered lexicographically by their index tuple, left segment first
(odometer order). This order controls per-element issues and `MIN`/`MAX` tie-breaks.

#### 3.6.2 Aggregation `[D20]`

A rule whose `field` contains `[*]` MUST have `aggregate` with an explicit `mode`.
`aggregate` on a non-wildcard field is invalid. `value_field` MUST NOT contain a
wildcard; aligned comparison of two wildcard paths is not defined in version 1.

| Field | Constraint |
| --- | --- |
| `mode` | required: `ALL`, `ANY`, `COUNT`, `MIN`, or `MAX` |
| `onEmpty` | `PASS`, `FAIL`, or `SKIP`; default `SKIP` |
| `issueMode` | `EACH` or `SUMMARY`; only for `ALL`/`ANY`; required when the rule has `issue`, forbidden otherwise |
| `op`, `value` | `COUNT` only; `op` ∈ `== != > >= < <=`, default `>=`; non-negative integer `value` required |

`issueMode` is forbidden for `COUNT`, `MIN`, and `MAX`: their failure always creates
one summary issue. Legacy `EACH` is not a `mode` value.

**Population and `SKIP`.** Evaluation proceeds as follows:

1. Resolve the wildcard to a structural match list.
2. If the list is empty, take the outcome from `onEmpty`.
3. Evaluate each match. Exclude `SKIP` from the effective population. `matched` is
   structural size, `evaluated` is `PASS`+`FAIL`, and `skipped` is `SKIP` count.
4. If structural matches existed but all outcomes were `SKIP`, the whole rule is
   `SKIP`, regardless of `onEmpty`.
5. Otherwise evaluate the aggregate over the effective population.

Thus `onEmpty` means no structural matches, not no computable outcomes.

| mode | PASS when |
| --- | --- |
| `ALL` | every evaluated element is `PASS` |
| `ANY` | at least one evaluated element is `PASS` |
| `COUNT` | the number of `PASS` outcomes satisfies `op value` |
| `MIN` | the operator is `PASS` on the minimum value |
| `MAX` | the operator is `PASS` on the maximum value |

`MIN`/`MAX` use §2.5. An unclassified value or mixed comparison kinds cause `FAIL`;
ties select the first element in normative order. An operator `SKIP` on the chosen
extremum propagates as aggregate `SKIP`.

Issues are possible only for final aggregate `FAIL`: `ALL + EACH` reports each
`FAIL`; `ANY + EACH` reports each `FAIL` only when no element passed;
`ALL/ANY + SUMMARY`, `COUNT`, `MIN`, `MAX`, and `onEmpty: "FAIL"` produce one
summary issue. `SKIP` elements never produce issues, and a successful `ANY` emits no
partial issues.

## 4. Artifact formats

### 4.1 Common artifact rules

An artifact is a JSON object. Every artifact, regardless of type, MUST have:

| Field | Type | Constraint |
| --- | --- | --- |
| `id` | string | non-empty; unique across the snapshot |
| `type` | string | one of `"rule"`, `"condition"`, `"pipeline"`, `"dictionary"` |
| `description` | string | non-empty |

A snapshot containing an artifact violating these rules, or two artifacts sharing an
`id`, is **invalid** (§4.10). Unknown top-level fields on an artifact make it invalid
(closed schemas; this keeps typos loud and reserves the namespace for future spec
versions). `[DR-II]`

### 4.2 Identifiers, scopes, visibility

| Artifact id form | Visible from |
| --- | --- |
| `library.*` | anywhere: any pipeline, condition, or other library artifact |
| `{pipelineId}.*` | only the pipeline `{pipelineId}` and its conditions |
| any pipeline, by full `id` | any other pipeline's `flow` |
| any dictionary, by `id` | any rule (dictionaries are globally addressable) |

Nested pipelines do not inherit visibility: `a.b.rule_x` is visible from pipeline `a.b`,
not from pipeline `a`. When pipeline ids overlap as prefixes, an artifact belongs to
the **longest** pipeline id that prefixes it. Every non-pipeline artifact id MUST be
either `library.*` or prefixed (followed by `.`) by the id of a pipeline present in
the snapshot; an orphan scope makes the snapshot invalid. `[DR-IV]`

The *scope* of a pipeline is its own `id`. The *scope* of a condition is inferred from
its `id`: the prefix up to (not including) the last `.`. A condition `id` containing no
`.` is invalid.

### 4.3 Reference resolution

A reference string `r` in a step or `when` expression resolves as:

| Form of `r` | Resolution |
| --- | --- |
| starts with `library.` | absolute — used as-is |
| contains `.` | absolute — used as-is |
| contains no `.` | scoped — expanded to `{scope}.{r}` |

A reference that resolves to no artifact, to an artifact of the wrong type for its
position, or to an artifact not visible from the referencing scope (§4.2), makes the
snapshot invalid.

### 4.4 Artifact: `rule`

Fields in addition to §4.1:

| Field | Required | Constraint |
| --- | --- | --- |
| `operator` | yes | built-in (§3.2) or declared in `requires.operators` (§4.9) |
| `field` | per operator | §2.7 path; unused by `any_filled` |
| `fields` | `any_filled` only | non-empty path array |
| `value`, `value_field`, `flags`, `dictionary` | per operator | Part I; `value_field` contains no `[*]` |
| `aggregate` | when `field` contains `[*]` | §3.6; forbidden without wildcard |
| `issue` | optional | issue description for `FAIL` at a rule step |

The closed `issue` object has this shape:

```json
{
  "level": "WARNING | ERROR | EXCEPTION",
  "code": "non-empty string",
  "message": "non-empty string",
  "meta": { "optional": "any JSON object" }
}
```

`level`, `code`, and `message` are required together. `code` is unique among all
rules with `issue` in the snapshot. Optional `meta` is passed through to issues and
never affects evaluation. Top-level rule fields `role`, `level`, `code`, `message`,
and `meta` do not exist in fv2. `[D19]`

A rule without `issue` is a complete condition and MAY be used in `when`. A rule
step MUST reference a rule with `issue`, otherwise the snapshot is invalid. A rule
with `issue` MAY be used both in steps and in `when`; `when` ignores `issue`.

### 4.5 Artifact: `condition`

| Field | Required | Constraint |
| --- | --- | --- |
| `when` | yes | when expression |
| `steps` | yes | non-empty step array (§4.8) |

A when expression is one of:

```text
"rule_ref"
{ "all": [ <when-expression>, … ] }
{ "any": [ <when-expression>, … ] }
{ "not": <when-expression> }
```

`all`/`any` arrays MUST be non-empty. Every leaf references any valid `rule`;
presence and level of `rule.issue` are irrelevant. A reference to a condition,
pipeline, or dictionary makes the snapshot invalid. Semantics are in §5.4. `[D19]`

### 4.6 Artifact: `pipeline`

| Field | Required | Constraint |
| --- | --- | --- |
| `entrypoint` | yes | boolean, explicit |
| `strict` | yes | boolean, explicit |
| `flow` | yes | non-empty array of steps (§4.8) |
| `message` | when `strict: true` | non-empty string; the message of the strict summary issue |
| `strictCode` | optional, only with `strict: true` | non-empty string; default `"STRICT_PIPELINE_FAILED"` |

`entrypoint: true` marks the pipeline as an intended entry point and enables default
selection (§5.1); it does **not** restrict invocation — any pipeline is invocable by its
full `id`. `strict` semantics are defined in §5.7. `message` or `strictCode` present on
a non-strict pipeline is invalid.

**No context-requirement field.** `[D14]` Pipelines declare no `required_context` (an
unknown field under closed schemas). Whether the runtime context is complete
is the analyst's explicit decision, expressed as ordinary rules on `$context.*` paths —
e.g. a `not_empty` rule on `$context.currentDate` with the `issue` object chosen by
the analyst — placed where the analyst wants the guarantee (typically
first in an entrypoint's `flow`). Note the interaction with skip semantics `[D13]`:
value checks against an absent `$context.*` operand are skipped, so a scenario that
depends on context MUST guard it explicitly if absence should be an error.

**DAG.** The directed graph whose edges are `{ "pipeline": … }` steps MUST be acyclic.
A cycle makes the snapshot invalid. (Rule and condition references cannot form cycles by
construction: conditions reference only rules and conditions/rules cannot reference
pipelines except through pipeline steps — see §4.8.)

### 4.7 Artifact: `dictionary`

| Field | Required | Constraint |
| --- | --- | --- |
| `entries` | yes | non-empty array |

Each entry is a scalar (string, number, boolean — `null` is invalid) or an object with
at least one of `code`, `value`, each of which MUST itself be a scalar (string, number
or boolean) `[DR-IV]`. Matching semantics: §3.5.

### 4.8 Steps

A step is an object with exactly one of `rule`, `condition`, or `pipeline`, plus
optional non-empty `stepId`, which is passed through to issues and trace.

| Key | Must reference | Resolution |
| --- | --- | --- |
| `rule` | a `rule` artifact with `issue` | §4.3; scoped references allowed |
| `condition` | a `condition` artifact | §4.3; scoped references allowed |
| `pipeline` | a `pipeline` artifact | absolute `id` only |

A rule step referencing a rule without `issue` makes the snapshot invalid: the
runtime would lack normative data for a `FAIL` issue. `[D19][DR-II]`

### 4.9 Snapshot format (`formatVersion: 2`)

A snapshot is the unit of distribution and the unit of conformance. `[D11]`

```json
{
  "format": "jsonspecs-snapshot",
  "formatVersion": 2,
  "specVersion": "1.0.0-rc.3",
  "sourceHash": "<64 lowercase hex chars>",
  "requires": { "operators": ["valid_inn"] },
  "artifacts": [ … ],
  "meta": {
    "projectId": "…",
    "projectTitle": "…",
    "description": "…",
    "rulesetVersion": "…"
  }
}
```

| Field | Required | Constraint |
| --- | --- | --- |
| `format` | yes | exactly `"jsonspecs-snapshot"` |
| `formatVersion` | yes | exactly `2` (integer) |
| `specVersion` | yes | full SemVer 2.0.0 version of this specification the snapshot targets (prereleases included: an rc-suite pins rc versions) |
| `sourceHash` | yes | SHA-256, lowercase hex, over the RFC 8785 (JCS) canonicalization of the `artifacts` array `[D6]` |
| `requires.operators` | optional | non-empty array of unique non-built-in operator names used by the artifacts `[D10]` |
| `artifacts` | yes | array of artifacts; order is significant only through `sourceHash` |
| `meta` | optional | free-form project metadata; `projectId` and `rulesetVersion`, when present, are carried into the result's `ruleset` (Part III) |

**Version acceptance.** An implementation declares the exact range of `specVersion`
values it supports and MUST reject any snapshot whose `specVersion` falls outside that
declaration — anything weaker lets two implementations accept different snapshot sets,
defeating the purpose. Prerelease identifiers compare by SemVer precedence. `[DR-IV]` The snapshot pins the behavior contract (`specVersion`), never an implementation
version. Implementations MAY read implementation-specific hints from `meta` but MUST
NOT base acceptance on them. `[DR-II]`

**Operator closure.** Every `operator` named by a rule artifact MUST be either a
built-in (Part I §3) or listed in `requires.operators`. A rule naming an operator that
is neither is invalid. An implementation that does not provide every operator listed in
`requires.operators` MUST reject the snapshot before any evaluation, with
`OPERATOR_NOT_FOUND` (Part III). `[D10]`

### 4.10 The rejection set

A conformant implementation MUST reject — refuse to evaluate any pipeline of — a
snapshot exhibiting any of the following. *When* rejection happens (load, prepare,
first call) is unobservable and unconstrained `[D12]`; *that* it happens before any
evaluation is normative.

1. Snapshot envelope violations: wrong `format`/`formatVersion`, malformed or
   unsupported `specVersion`, missing/malformed `sourceHash`, `sourceHash` not matching
   the recomputed JCS hash of `artifacts`.
2. Any artifact violating §4.1 (including duplicate `id`), or its type-specific schema
   (§4.4–§4.8), including regex patterns outside the §3.4 grammar or limits, invalid
   `flags`, and invalid `aggregate`, `issueMode`, or `onEmpty` combinations.
3. Duplicate `issue.code` among rules with `issue`.
4. Any unresolved, wrong-typed, or invisible reference (§4.3), including `when` leaves
   that are not rules, rule steps targeting rules without `issue`, and pipeline steps
   with scoped references.
5. A cycle in the pipeline call graph.
6. An operator name that is neither built-in nor declared in `requires.operators`; or a
   declared required operator the implementation does not provide (`OPERATOR_NOT_FOUND`).
7. Any artifact exceeding the maximum JSON depth (§2.1).

Two conformant implementations MUST agree on membership in this set for every input.
Diagnostic *texts* and *granularity* for rejected snapshots are informative; the verdict
is normative. `[D7]`

---

## 5. Evaluation semantics

### 5.1 Evaluation input and input validation

Evaluation is a pure function of the tuple:

```
(snapshot, pipelineId?, payload, context?)
```

Input validation proceeds in the following normative order; the first failure determines
the outcome (an `ABORT` result, Part III), so implementations agree on *which* error is
reported when several apply:

1. **Pipeline selection.** If `pipelineId` is given, it MUST name a pipeline artifact —
   otherwise `ABORT` with `PIPELINE_NOT_FOUND`, `details: { "pipelineId": "<given>" }`.
   If omitted, exactly one pipeline with `entrypoint: true` MUST exist — otherwise
   `ABORT` with `PIPELINE_ID_REQUIRED`,
   `details: { "entrypointCount": <n> }`. `details` carry only the requested id — enumerating the
   available pipelines to the caller is diagnostic tooling's job, not the runtime
   error's. `[D7][DR-II]`
2. **Container types.** `payload` MUST be a JSON object — otherwise `ABORT` with
   `INVALID_PAYLOAD`, `details: {"expected": "object"}` (this covers `null`, arrays,
   scalars). `context`, when present, MUST be a JSON object — otherwise
   `INVALID_CONTEXT`, same details. Payload is checked before context.
3. **Key scan.** `[D15]` A key is *dangerous* if it is a reserved key (§2.1); a key is
   *invalid* if it is empty (`""`) or contains `.`, `[` or `]`. The scan is top-down
   and does not enter the subtree under a dangerous or invalid key — a violation is
   *visible* only when all its ancestor keys are clean, so its `parentPath` is always
   a well-formed dot path (root = `""`). Among visible violations the precedence is:
   dangerous in payload, dangerous in context, invalid in payload, invalid in
   context; within a class, the lexicographically smallest `(parentPath, key)` pair
   (code-point order, `parentPath` first). Codes: `DANGEROUS_PAYLOAD_KEY`,
   `DANGEROUS_CONTEXT_KEY`, `INVALID_PAYLOAD_KEY`, `INVALID_CONTEXT_KEY`; details:
   `{"parentPath": "…", "key": "…"}`.
4. **Depth.** §2.1 depth of payload ≤ 256 — otherwise `PAYLOAD_TOO_DEEP`,
   `details: {"maxDepth": 256}`; likewise context — `CONTEXT_TOO_DEEP`.

All input-validation failures are `ABORT` (the evaluation could not be performed).
There is no separate required-context phase `[D14]`: context completeness is checked by
ordinary rules, inside the flow, like everything else. Payload flattening (§2.7) is not
a validation step: any JSON object is flattenable.

### 5.2 Execution order

The selected pipeline's `flow` executes sequentially. A `condition` step whose guard is
true executes its `steps` sequentially in place; a `pipeline` step executes the
referenced pipeline's `flow` in place. The resulting order of rule evaluations is the
depth-first, left-to-right traversal of the step tree — *document order*. Issues appear
in the result in document order; within one rule evaluation, per-element issues follow
wildcard enumeration order (§3.6.1); strict summary issues follow §5.7. `[D5]`

Implementations MUST NOT reorder, parallelize, or deduplicate observable effects in any
way that changes the normative result. (Internal parallelism is permitted if the result
is indistinguishable.)

### 5.3 Rule steps

A rule step evaluates its rule per Part I. `PASS` and `SKIP` have no normative
effect. `FAIL` creates an issue from `rule.issue` and runtime facts: concrete
`field`, `ruleId`, immediately enclosing `pipelineId`, optional `stepId`,
`expected`/`actual`, and group `details` per Part III. `[D19]`

The created issue level controls flow per §5.6. An operator cannot change the rule's
level, code, or message.

### 5.4 Condition steps

A `when` leaf evaluates a rule and maps `PASS` to `true`, and `FAIL`/`SKIP` to
`false`. `all`, `any`, and `not` combine those booleans.

`when` never creates issues and ignores `rule.issue`, including
`level: "EXCEPTION"`. Short-circuit versus exhaustive evaluation is therefore not
observable in the normative result; trace MAY differ. A thrown operator exception or
contract violation still causes site-independent `ABORT` (§3.1, §6.7).
`[D7][D12][D19]`

When the guard is true, its steps execute in place; otherwise the condition is a no-op.

### 5.5 Pipeline steps

A pipeline step executes the referenced pipeline's `flow` in place. Issues produced
inside it carry the *inner* pipeline's id as `pipelineId`. The inner pipeline's
`strict` applies to its own execution subtree (§5.7); its `entrypoint` flag has no
effect when it is invoked as a step.

### 5.6 Levels

| `level` | Issue | Effect on flow | Contribution to `status` |
| --- | --- | --- | --- |
| `WARNING` | created | none | `OK_WITH_WARNINGS` if nothing stronger |
| `ERROR` | created | none — evaluation continues | `ERROR` |
| `EXCEPTION` | created | **entire evaluation stops immediately** — including all outer pipelines' remaining steps | `EXCEPTION` |

Accumulated issues are always preserved. The `status`/`control` matrix and the `ABORT`
status are defined in Part III.

### 5.7 Strict pipelines

For a pipeline with `strict: true`, when its execution subtree terminates — whether by
running to completion or by an `EXCEPTION` stop inside it — and at least one issue with
`level` `ERROR` or `EXCEPTION` was produced *within that subtree* (its own rules,
conditions, and sub-pipelines included), one summary issue is appended after all issues
of the subtree:

```json
{
  "kind": "ISSUE",
  "level": "EXCEPTION",
  "code": "<strictCode or STRICT_PIPELINE_FAILED>",
  "message": "<pipeline.message>",
  "field": null,
  "ruleId": "pipeline:<pipelineId>",
  "pipelineId": "<pipelineId>"
}
```

and the entire evaluation stops (as with any `EXCEPTION`). Individual rules inside a
strict pipeline keep their declared levels — only the group outcome escalates. Nested
strict pipelines each apply the rule to their own subtree; the innermost triggering
strict pipeline appends its summary first, and the stop propagates outward (outer strict
pipelines that also qualify append their summaries in inner-to-outer order).

Strict summary codes are runtime-generated and are therefore outside the rule
`code` uniqueness rule (§4.4); authors SHOULD nevertheless avoid collisions between
`strictCode` values and rule codes, as consumers distinguish issues by `code`.

---

## 6. Result contract

### 6.1 Result envelope and JSON representation

The result of an evaluation is a JSON object:

```json
{
  "status": "OK | OK_WITH_WARNINGS | ERROR | EXCEPTION | ABORT",
  "control": "CONTINUE | STOP",
  "issues": [ … ],
  "ruleset": { … },
  "error": { … },
  "trace": [ … ]
}
```

`error` is present exactly when `status` is `ABORT` (and `issues` is then empty).
`trace` is optional and entirely informative (§6.9).

**Representation rules.** `[D8]` The result is pure JSON. "No value" is expressed by
**omitting the key**, never by `null` — with the single deliberate exception of
`"field": null` on issues that are not attributable to one field (§6.3). Normative
equality between results is **structural JSON equality**: array element order matters;
object key order does not; numbers compare as binary64 values (`1` equals `1.0`);
serialization details (whitespace, escaping style, key order on the wire) are not part
of conformance.

### 6.2 Status and control

| `status` | Meaning | `control` |
| --- | --- | --- |
| `OK` | no issues | `CONTINUE` |
| `OK_WITH_WARNINGS` | only `WARNING` issues | `CONTINUE` |
| `ERROR` | at least one `ERROR` issue, no `EXCEPTION` | `STOP` |
| `EXCEPTION` | at least one `EXCEPTION` issue (§5.6, §5.7) | `STOP` |
| `ABORT` | evaluation could not be performed (§6.7) | `STOP` |

`status` is fully determined by the strongest issue level present (or by abortion);
`control` is fully determined by `status`. Both fields exist because consumers routinely
branch on the go/no-go bit without interpreting statuses.

### 6.3 Issues

Every issue is an object with the following fields; the "When present" column is
normative — a field that the column excludes MUST be omitted:

| Field | Type | When present |
| --- | --- | --- |
| `kind` | `"ISSUE"` | always |
| `level` | `WARNING \| ERROR \| EXCEPTION` | always |
| `code` | string | always — authored (`rule.code`, `strictCode`) |
| `message` | string | always — authored (`rule.message`, `pipeline.message`); normative as data passthrough `[D7]` |
| `field` | string or `null` | always; the concrete resolved path for field-scoped issues (for wildcard elements, the concrete matched path such as `x[2].v`); the pattern (`x[*].v`) for aggregate summary issues; `null` for issues not attributable to one field (`any_filled`, strict summaries) |
| `ruleId` | string | always; the rule's `id`, or `pipeline:<pipelineId>` for strict summaries |
| `pipelineId` | string | always; the immediately enclosing pipeline (§5.5) |
| `stepId` | string | only when the producing step declares one |
| `expected` | value | per §6.4 |
| `actual` | value | per §6.4; omitted when there is no single actual value |
| `details` | object | group-verdict summary issues only (§6.5); normative machine-readable facts of the issue, mirroring `error.details` on `ABORT` (§6.7) — one contract-wide pattern: `code` identifies the class, `details` carries the class-specific facts |
| `meta` | object | when `rule.issue` declares `meta` (§6.6) |

Issue order in `issues[]` is normative: document order of rule evaluations (§5.2),
wildcard enumeration order within a rule (§3.6.1), strict summaries per §5.7.

### 6.4 `expected` and `actual`

| Operator class | `expected` | `actual` |
| --- | --- | --- |
| value comparisons (`equals`, `not_equals`, `contains`, `matches_regex`, `not_matches_regex`, `greater_than`, `less_than`, `length_*`) | the rule's `value` verbatim | the resolved field value |
| type checks (`is_boolean`, `is_string`, `is_number`, `is_integer`) | omitted | the resolved field value |
| `not_empty` | omitted | omitted when absent; the value (`null` or `""`) when present-but-empty — represented as the JSON value, i.e. `"actual": null` is legal here as an actual *value*, distinct from key omission |
| `is_empty`, `not_true` | omitted | the resolved field value |
| dictionary operators | the rule's `dictionary` object verbatim (`{"type":"static","id":…}`) | the resolved field value |
| `field_*_field` | the resolved **value** of `value_field` `[DR-III]` | the resolved `field` value |
| `any_filled` | omitted | omitted |

Because payload flattening admits only scalar and empty-container leaves (§2.7),
`expected`/`actual` values are always shallow; no truncation or transport normalization
of these values is defined or permitted.

### 6.5 Group-verdict summary issues

A summary issue is created on final `FAIL` for `ALL/ANY + SUMMARY`, `COUNT`,
`MIN`/`MAX`, or `onEmpty: "FAIL"`. `[D20]`

| Producer | `details` | `expected` / `actual` |
| --- | --- | --- |
| `ALL`/`ANY`, `issueMode: "SUMMARY"` | `{"mode":"ALL|ANY","matched":<m>,"evaluated":<e>,"skipped":<s>,"passed":<p>,"failed":<f>}` | omitted / omitted |
| `COUNT` failure | `{"mode":"COUNT","op":"…","value":<v>,"matched":<m>,"evaluated":<e>,"skipped":<s>,"passed":<p>,"failed":<f>}` | omitted / omitted |
| `MIN`/`MAX` failure | `{"mode":"MIN|MAX"}` | per §6.4; `field` is the concrete extremum path and `actual` its value |
| `onEmpty: "FAIL"` | `{"mode":"<mode>","matched":0,"evaluated":0,"skipped":0,"passed":0,"failed":0}` | omitted / omitted |

`matched` is structural wildcard match count, `evaluated` is `PASS`+`FAIL`,
`skipped` is `SKIP`, and `passed`/`failed` partition the effective population.
Always `matched = evaluated + skipped` and `evaluated = passed + failed`.

For an undetermined `MIN`/`MAX` extremum, `field` is the wildcard pattern and
`expected`/`actual` are omitted. Per-element `EACH` issues are ordinary §6.3–§6.4
issues and never carry `details`.

### 6.6 `meta` passthrough

When `rule.issue` declares `meta`, every issue produced by that rule carries it
verbatim. The runtime MUST NOT rewrite it; runtime facts live in `details` or nowhere.
The entire `issue` object, including `meta`, is ignored at a `when` site. `[DR-III][D19]`

### 6.7 `ABORT` and the two failure channels

There are two distinct failure channels; conflating them is a conformance error:

**Channel A — snapshot rejection (§4.10).** The snapshot is refused before any
evaluation. The *verdict* is normative; the reporting form (diagnostics list, thrown
error, exit code) is implementation-defined. One rejection cause has a normative
identifier because it is environment-dependent: `OPERATOR_NOT_FOUND` — the snapshot's
`requires.operators` names an operator the implementation does not provide. `[D10]`

**Channel B — evaluation `ABORT`.** The tuple was accepted for evaluation, but the
evaluation could not be performed. The result carries:

```json
"error": { "code": "…", "message": "…", "details": { … } }
```

`code` and `details` are normative; `message` is informative free text. `[D7]`
The normative code enum and the exact `details` shape per code:

| `code` | When | `details` |
| --- | --- | --- |
| `PIPELINE_NOT_FOUND` | §5.1 step 1 | `{"pipelineId": "<requested>"}` |
| `PIPELINE_ID_REQUIRED` | §5.1 step 1 | `{"entrypointCount": <n>}` |
| `INVALID_PAYLOAD` | §5.1 step 2 | `{"expected": "object"}` `[DR-IV]` |
| `INVALID_CONTEXT` | §5.1 step 2 | `{"expected": "object"}` `[DR-IV]` |
| `DANGEROUS_PAYLOAD_KEY` / `DANGEROUS_CONTEXT_KEY` | §5.1 step 3 | `{"parentPath": "…", "key": "…"}` — the smallest visible `(parentPath, key)` per §5.1; determinism under any traversal order `[DR-III][D15]` |
| `INVALID_PAYLOAD_KEY` / `INVALID_CONTEXT_KEY` | §5.1 step 3 | `{"parentPath": "…", "key": "…"}` — same selection rule `[D15]` |
| `PAYLOAD_TOO_DEEP` / `CONTEXT_TOO_DEEP` | §5.1 step 4 | `{"maxDepth": 256}` — and nothing else: *which* path first exceeds the limit depends on traversal order, so no path appears in any normative surface (the informative `message` MAY carry one) `[DR-III]` |
| `OPERATOR_FAULT` | an operator implementation threw/panicked during evaluation | `{"ruleId": "…", "operator": "…"}` |
| `OPERATOR_CONTRACT_VIOLATION` | an operator returned a value outside its declared result shape (Part I §3.1) | `{"ruleId": "…", "operator": "…"}` |

The enum is closed for this spec version: implementations MUST NOT emit other codes in
Channel B. Built-in operators never trigger the two `OPERATOR_*` codes; they are
exercised portably through the reserved conformance operators of §7.3.

### 6.8 `ruleset` provenance

```json
"ruleset": {
  "specVersion": "1.0.0-rc.3",
  "sourceHash": "…",
  "projectId": "…",
  "rulesetVersion": "…",
  "engineVersion": "…"
}
```

| Field | Presence | Surface |
| --- | --- | --- |
| `specVersion` | always — echoed from the snapshot | normative `[DR-III]` |
| `sourceHash` | always — echoed from the snapshot | normative |
| `projectId`, `rulesetVersion` | when present in `snapshot.meta` | normative passthrough |
| `engineVersion` | optional | **informative** — implementation identifier, excluded from conformance comparison `[D7]` |

### 6.9 Trace

`trace` is wholly informative. `[D7]` An implementation MAY omit it, produce it in any
granularity, or make it optional per call. When produced, it SHOULD be an array of event
objects with at least `type` and artifact identifiers, and SHOULD record value-semantic
skips (`[D13]`) and condition guard outcomes — but no conformance comparison ever reads
it, and timestamps (`at`) make byte-comparison meaningless by design. Trace content MUST
NOT be the only carrier of any normative fact.

---

## 7. Conformance

### 7.1 Conformance claims

A conformance claim names: the implementation and version; the supported `specVersion`
range (§4.9); and the set of non-built-in operator names the deployment provides.
Cross-implementation equality of the normative result is guaranteed **only for
snapshots that use built-in operators exclusively**. `[D17]` Equal operator *names* do
not imply equal *semantics*: for snapshots with custom operators, what is common
across implementations is only the extension contract (§3.1 outcome contract, §6.7
`OPERATOR_*` reactions — both portably testable via the §7.3 conformance operators)
and the parametrization of the rejection set (§4.10) through `requires.operators` —
the same snapshot may legitimately be accepted by a deployment providing `valid_inn`
and rejected (`OPERATOR_NOT_FOUND`) by one that does not. The business behavior of a
custom operator is the promise of its package, not of this specification. For
snapshots using only built-in operators, conformance is unconditional. `[D10]`

### 7.2 The normative projection

Conformance compares the *normative projection* of behavior:

1. the snapshot verdict: accepted or rejected (§4.10), plus the `OPERATOR_NOT_FOUND`
   identifier where applicable;
2. for accepted snapshots and each evaluation tuple: `status`, `control`, `issues[]`
   in full (every field of §6.3, in order), `error.code` + `error.details`, and
   `ruleset` minus `engineVersion`.

Excluded from comparison: `trace`, `engineVersion`, `error.message`, rejection
diagnostic texts and granularity, and anything an implementation emits outside the
result object. Comparison is structural (§6.1).

### 7.3 Conformance fixtures

The `fixtures/` tree of the `jsonspecs/spec` repository is a **normative appendix**:
text and fixtures version together, atomically, under one tag. Two fixture kinds:

```json
// evaluation fixture
{
  "name": "d2/length-surrogate-pair-counts-as-one",
  "snapshot": { … },
  "operators": ["…"],            // registered set for this fixture, default []
  "input": { "pipelineId": "p", "payload": { … }, "context": { … } },
  "expected": {
    "status": "…", "control": "…",
    "issues": [ … ],
    "ruleset": { "specVersion": "…", "sourceHash": "…" }
  }
}

// rejection fixture
{
  "name": "regex/lookahead-rejected",
  "snapshot": { … },
  "operators": [],
  "expected": { "verdict": "reject", "identifier": "OPERATOR_NOT_FOUND"? }
}
```

A runner executes every fixture against the implementation and compares the normative
projection structurally. Passing the complete suite of version X is a **necessary
condition** of a conformance claim for X — not a sufficient one: the suite samples the
behavior space, the text defines it. `[DR-IV]` If a fixture contradicts the text, the
text prevails; the fixture is corrected through an erratum and a new suite version —
fixtures never silently redefine the text. Fixtures are organized by the decision or
section they pin; every decision D1–D20 MUST be covered by at least one fixture.

**Reserved conformance operators.** `[DR-IV]` The following operator names are
reserved. They are registered **only by conformance runners** as part of the test
harness — never by production runtimes — and each implementation adapts them to its
own registration API. Their pinned behavior when invoked:

| Name | Behavior | Expected reaction |
| --- | --- | --- |
| `conformance.rule.throw` | throws a host exception | `ABORT OPERATOR_FAULT` at either site |
| `conformance.rule.invalid_result` | returns `EXCEPTION`, outside the enum | `ABORT OPERATOR_CONTRACT_VIOLATION` at either site |
| `conformance.rule.tri` | maps values `"PASS"`, `"SKIP"`, `"FAIL"` to the same-named outcomes | §3.1 outcome; used for mixed aggregate populations |

### 7.4 Requirements summary

A conformant implementation:

- MUST accept and reject exactly the §4.10 set, relative to its registered operators;
- MUST produce an identical normative projection for every evaluation tuple;
- MUST pass the complete fixture suite of the claimed spec version;
- MUST NOT require any input, flag, or mode beyond the evaluation tuple to achieve the
  above (conformance is the default behavior, not an opt-in);
- MAY do anything not observable through the normative projection: compile or
  interpret, cache, parallelize, produce any trace, expose any API. `[D12]`

### 7.5 Out of scope

Restating the boundary in one place: APIs and function signatures; the moment of
validation; compilation strategy and diagnostics beyond the verdict; performance and
resource limits above the normative ones (§2.1, §3.4.2); transport-level truncation of
results; custom operator behavior `[D10]`; trace content; and legacy surfaces of the
prototype (`engine.minVersion`, `paths[]`, `payload.__context`, `required_context`)
`[D11][D14]`.

---
