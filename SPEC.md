# JSONSpecs Behavior Specification

**Version:** 1.0.0-rc.2 · **Status:** Release Candidate — the `v1.0.0` tag is applied after
cross-implementation comparison on a live stand (see repository README, Release process).

This specification is the canon of runtime behavior for a given version. It states only
expected behavior. The reasoning behind every decision lives in a separate document —
`DECISIONS.md` / `DECISIONS_RU.md` — which in turn refers to the prototype
implementation (`source/`) whose practical experience produced these decisions.

**Notation.** `[D1]`…`[D14]` refer to numbered decisions in `DECISIONS.md`;
`[DR-I]`, `[DR-II]`, `[DR-III]` refer to its addenda for Parts I–III of the drafting
review. MUST/MUST NOT/SHOULD/MAY per RFC 2119.

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
applies to it (this is what lets a depth-256 `meta` pass through to issues verbatim).

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
comparison is *undetermined*, and the operator fails (check → FAIL, predicate →
UNDEFINED).

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

A *rule* applies one operator to the payload (and possibly context). Operators come in two
roles:

- **check** operators return `OK` or `FAIL`. A `FAIL` produces an issue (Part II).
- **predicate** operators return `TRUE`, `FALSE`, or `UNDEFINED`. Predicates produce no
  issues; they feed `when` expressions and predicate aggregation. Before a `when`
  expression combines leaf results, `UNDEFINED` is converted to `FALSE`.

An operator's behavior is a pure function of: the resolved field value(s), the rule's
parameter fields (`value`, `value_field`, `fields`, `dictionary`, `flags`), the referenced
dictionary contents, and — for `$context.*` — the context. Operators MUST NOT depend on
evaluation order, wall-clock time, locale, or any other ambient state.

**Operator outcome contract.** `[D17]` A check invocation yields exactly one of `OK`,
`FAIL`, `EXCEPTION`; a predicate yields exactly one of `TRUE`, `FALSE`, `UNDEFINED`.
Built-in operators never yield `EXCEPTION`. A custom check operator MAY yield
`EXCEPTION` deliberately ("evaluation impossible"): this produces an issue carrying
the rule's `code`, `message` and `meta`, with `expected`/`actual` omitted, at level
`EXCEPTION` regardless of the rule's declared level, and evaluation stops per §5.6.
That is distinct from a thrown/host failure — `ABORT OPERATOR_FAULT` — and from a
result outside the enum — `ABORT OPERATOR_CONTRACT_VIOLATION` (§6.7). The predicate
enum has no `EXCEPTION`: a predicate deliberately unable to evaluate yields
`UNDEFINED`; anything outside its enum is `OPERATOR_CONTRACT_VIOLATION`.

**Absent-field behavior — two operator classes.** `[D13]`

- **Presence-semantic operators** (`not_empty`, `is_empty`, `not_true`, `any_filled`):
  absence is part of their domain; their behavior on an absent field is defined
  individually in the table below.
- **Value-semantic operators** (all others): they constrain a value *if one is present*.
  When the field is absent, the operator is **not invoked**: the check yields OK and
  produces no issue (a *skip*); the predicate yields UNDEFINED. An implementation SHOULD
  record the skip as a trace event (informative surface; the normative result is
  unaffected). Required-ness is always expressed by a separate presence rule
  (`not_empty` / `any_filled`) — never implied by a value check. This is a deliberate
  design principle of the DSL, not an industry-alignment choice: whether a field is
  mandatory is the analyst's explicit decision, and an *absence* failure is a distinct
  diagnostic from an *operator* failure — it deserves its own rule with its own `code`
  and `message`, authored by the analyst, rather than a generic error fused into every
  value operator. (That this happens to coincide with JSON Schema's separation of
  `pattern`/`enum` from `required` is incidental, not a design driver.)

For `field_*_field` operators, the rule is value-semantic in both operands: if either
the `field` or the `value_field` path is absent, the check is skipped.

**String-strict operators** `[D3][DR-I]`: the operators `contains`,
`matches_regex`, and `not_matches_regex` require the field value to be a string; any
non-string value (including numbers) is `FAIL` / `FALSE`. Host-language stringification
never occurs. Migration note: rules matching numeric-typed payload fields (e.g. an
integrator sending INN as a JSON number) change verdict from pass to FAIL; this surfaces
a payload typing error rather than hiding it.

### 3.2 Check operators

The built-in check operator set. The "Absent" column shows behavior when the field does
not resolve (§2.7): presence-semantic operators define it individually; value-semantic
operators show **skip** (OK, no issue, no invocation — §3.1). All comparisons use §2.4
equality and §2.5 ordered comparison; no coercion ever occurs beyond the numeric-string
and date classification of §2.5.

| Operator | Parameters | OK when | Absent |
| --- | --- | --- | --- |
| `not_empty` | — | field is not empty (§2.6) | FAIL |
| `is_empty` | — | field is empty (§2.6) | OK |
| `not_true` | — | value is anything except the boolean `true` | OK |
| `any_filled` | `fields: path[]` | at least one listed field is not empty (§2.6); `field` is not used | absent = empty; FAIL when all listed fields are empty |
| `is_boolean` | — | value is a boolean | skip |
| `is_string` | — | value is a string | skip |
| `is_number` | — | value is a number | skip |
| `is_integer` | — | value is a number with zero fractional part | skip |
| `equals` | `value` | value equals `value` (§2.4) | skip |
| `not_equals` | `value` | value does not equal `value` (§2.4) | skip |
| `contains` | `value: string` | value is a string containing `value` as a substring (code-point sequence containment; empty `value` is contained in every string) | skip |
| `matches_regex` | `value: pattern`, `flags?` | value is a string containing a match of the pattern (§3.4; search semantics — unanchored unless the pattern anchors itself) | skip |
| `not_matches_regex` | `value: pattern`, `flags?` | value is a string containing **no** match of the pattern | skip |
| `greater_than` | `value: number \| date-string` | comparison determined (§2.5) and field > value | skip |
| `less_than` | `value: number \| date-string` | determined and field < value | skip |
| `length_equals` | `value: number` | value is a string of exactly `value` code points (§2.3); non-string → FAIL `[D2][D3]` | skip |
| `length_max` | `value: number` | value is a string of at most `value` code points; non-string → FAIL `[D2][D3]` | skip |
| `field_equals_field` | `value_field: path` | both fields present and equal (§2.4) | skip if either absent |
| `field_not_equals_field` | `value_field: path` | both present and not equal | skip if either absent |
| `field_greater_than_field` | `value_field: path` | both present, comparison determined, field > other; undetermined → FAIL | skip if either absent |
| `field_less_than_field` | `value_field: path` | both present, determined, field < other | skip if either absent |
| `field_greater_or_equal_than_field` | `value_field: path` | both present, determined, field ≥ other | skip if either absent |
| `field_less_or_equal_than_field` | `value_field: path` | both present, determined, field ≤ other | skip if either absent |
| `in_dictionary` | `dictionary: {type:"static", id}` | value matches a dictionary entry (§3.5) | skip |
| `not_in_dictionary` | `dictionary: {type:"static", id}` | value matches **no** dictionary entry (§3.5) | skip |

Notes.

- `any_filled` takes `fields[]`; the legacy alias `paths[]` does not exist in this
  specification. `[D11]`
- `not_true`: `OK` for absent, `null`, `""`, `false`, `0`, `"true"`, objects — everything
  except the boolean `true`. Only strict boolean `true` is `FAIL`. It is
  presence-semantic by design (a prohibition that holds vacuously).
- For `greater_than`/`less_than`, `value` in the artifact is classified by the same §2.5
  rules as the payload operand (a JSON number, or a string that is numeric or a valid
  date).
- The idiom "field is required *and* must satisfy X" is two rules: a `not_empty` check
  and the value check. An absent field then produces exactly one issue (the presence
  one) instead of a cascade. `[D13]`

### 3.3 Predicate operators

Available as predicates: `not_empty`, `is_empty`, `is_boolean`, `is_string`, `is_number`,
`is_integer`, `equals`, `not_equals`, `contains`, `matches_regex`, `not_matches_regex`,
`greater_than`, `less_than`, all six `field_*_field` operators, `in_dictionary`,
`not_in_dictionary`.

**Not available as predicates:** `any_filled`, `length_equals`, `length_max`, `not_true`.
A rule with `role: "predicate"` and one of these operators is rejected.

Result mapping: where the check table says OK the predicate returns `TRUE`; where it says
FAIL for a *present* field the predicate returns `FALSE`. On an **absent** field:
value-semantic predicates return `UNDEFINED` (§3.1); `is_empty` returns `TRUE`;
`not_empty` returns `FALSE`. `UNDEFINED` is converted to `FALSE` at the
`when`-expression leaf (Part II) and counts as not-`TRUE` in predicate aggregation
(§3.6).

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
entry's type. `in_dictionary` is OK/TRUE when any entry matches; `not_in_dictionary` is
OK/TRUE when the field is present and no entry matches. `dictionary.type` MUST be
`"static"`.

### 3.6 Wildcards and aggregation

#### 3.6.1 Wildcard resolution and enumeration order `[D5]`

A `field` path may contain `[*]` segments. A `[*]` segment matches exactly the
**non-negative integer** index segments at that position in the flat map; nothing else.
Resolution produces the list of concrete paths present in the flat map.

Enumeration order is normative:

1. indices are ordered as **numbers, ascending** (`a[2]` before `a[10]`; insertion order
   of the flat map is irrelevant; gaps are permitted — `a[0], a[2], a[5]` enumerate in
   that order);
2. with multiple `[*]` segments, tuples of indices are ordered lexicographically with the
   **leftmost segment most significant** ("odometer" order):
   `[0][0], [0][1], [1][0], [1][2], …`

This order determines the order of per-element issues in the result and the element order
observed by aggregation.

#### 3.6.2 Aggregation

Without an `aggregate` object, defaults apply: check → `EACH`, predicate → `ANY`.

`aggregate` fields: `mode`, `onEmpty`, `summaryIssue` (check + `ALL` only), `op` and
`value` (`COUNT` only; `op` ∈ `== != > >= < <=`, default `>=`; `value` required).

**Check modes.** The base operator is applied to each element; an element *passes* when
the operator yields OK.

| mode | Semantics |
| --- | --- |
| `EACH` (default) | one issue per failing element, in enumeration order |
| `ALL` | all elements must pass; `summaryIssue: false` → one issue per failing element; `summaryIssue: true` → exactly one summary issue if any element fails |
| `COUNT` | let *k* = number of passing elements; OK iff *k* `op` `value`; on failure, one summary issue |
| `MIN` | apply the base operator once, to the minimum element value | 
| `MAX` | same, to the maximum element value |

For `MIN`/`MAX` the extremum is taken under §2.5 ordered comparison; if several
elements attain the extremum, the **first in enumeration order** (§3.6.1) is selected
`[DR-IV]`. If any element is unclassified or the elements do not all classify to the
same kind, the extremum is undetermined and the rule FAILs (one summary issue): what
cannot be compared is not compared. `[DR-I]`

**Predicate modes.**

| mode | Semantics |
| --- | --- |
| `ANY` (default) | TRUE iff at least one element yields TRUE |
| `ALL` | TRUE iff every element yields TRUE |
| `COUNT` | TRUE iff the number of TRUE elements satisfies `op value` |

`UNDEFINED` element results count as not-TRUE. `MIN`/`MAX` with `role: "predicate"` make
the artifact invalid.

**`onEmpty`** — behavior when the wildcard resolves to zero elements:

| onEmpty | check | predicate |
| --- | --- | --- |
| default | `PASS` | `UNDEFINED` |
| `PASS` | rule passes, no issue | — (invalid for predicate) |
| `FAIL` | rule fails, issue created | — (invalid) |
| `TRUE` | — (invalid for check) | `TRUE` |
| `FALSE` | — (invalid) | `FALSE` |
| `UNDEFINED` | treated as `PASS` | `UNDEFINED` |

There is no abort-on-empty option: a hard stop composes from `onEmpty: "FAIL"` on a
rule with `level: "EXCEPTION"` — the analyst's own `code` and `message` instead of an
anonymous abort. `[DR-I]`

Cross-role `onEmpty` values (`TRUE`/`FALSE` on a check, `PASS`/`FAIL` on a predicate)
make the artifact invalid; they are never silently coerced. `[DR-I]`

---

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

Common fields beyond §4.1:

| Field | Required | Constraint |
| --- | --- | --- |
| `role` | yes | `"check"` or `"predicate"` |
| `operator` | yes | name of a built-in operator (Part I §3) or an operator declared in `requires.operators` (§4.9) |
| `field` | per operator | dot-notation path (§2.7); not used by `any_filled` |
| `fields` | `any_filled` only | non-empty array of paths |
| `value`, `value_field`, `flags`, `dictionary` | per operator | as defined in Part I §3 |
| `aggregate` | optional | §3.6; valid only when `field` contains `[*]` — `aggregate` on a non-wildcard field is invalid; `summaryIssue` defaults to `false` and is valid only with `mode: "ALL"` `[DR-IV]` |
| `meta` | optional | any JSON object; passed through to issues and trace; never affects evaluation |

**Check rules** (`role: "check"`) additionally require:

| Field | Constraint |
| --- | --- |
| `level` | `"WARNING"`, `"ERROR"`, or `"EXCEPTION"` |
| `code` | non-empty string; unique among all check rules in the snapshot |
| `message` | non-empty string |

**Predicate rules** (`role: "predicate"`) MUST NOT have `level`, `code`, or `message`;
their presence makes the artifact invalid. A predicate rule using an operator not
available in the predicate role (Part I §3.3) is invalid. `aggregate.mode` of `MIN` or
`MAX` on a predicate rule is invalid. `length_equals`/`length_max` `value` and
`COUNT` `value` MUST be non-negative integers. `[DR-IV]`

### 4.5 Artifact: `condition`

| Field | Required | Constraint |
| --- | --- | --- |
| `when` | yes | a *when-expression*, see below |
| `steps` | yes | non-empty array of steps (§4.8) |

A **when-expression** is one of:

```
"pred_ref"
{ "all": [ <when-expression>, … ] }
{ "any": [ <when-expression>, … ] }
{ "not": <when-expression> }
```

`all`/`any` arrays MUST be non-empty. Leaves are references to rules with
`role: "predicate"`; a leaf referencing a check rule, a condition, or a pipeline is
invalid. Nesting is unrestricted in form but bounded by the global depth limit (§2.1).

Semantics are defined in §5.4.

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
e.g. a `not_empty` check on `$context.currentDate` with the level, `code`, and
`message` the analyst chooses — placed where the analyst wants the guarantee (typically
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

A step is an object with exactly one of the keys `rule`, `condition`, `pipeline`, plus
an optional `stepId` (non-empty string; passed through to issues and trace, never
affects evaluation). Any other key, or more than one of the three, is invalid.

| Key | Must reference | Resolution |
| --- | --- | --- |
| `rule` | artifact with `type: "rule"` and `role: "check"` | §4.3, scoped refs allowed |
| `condition` | artifact with `type: "condition"` | §4.3, scoped refs allowed |
| `pipeline` | artifact with `type: "pipeline"` | absolute `id` only; scoped refs invalid |

A rule step referencing a predicate rule is **invalid**: a no-op step in a validation
scenario is almost certainly an authoring error, and "valid but meaningless" is a poor
contract. `[DR-II]`

### 4.9 Snapshot format (`formatVersion: 2`)

A snapshot is the unit of distribution and the unit of conformance. `[D11]`

```json
{
  "format": "jsonspecs-snapshot",
  "formatVersion": 2,
  "specVersion": "1.0.0-rc.2",
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
   `flags`, invalid `aggregate` combinations, and cross-role `onEmpty` values.
3. Duplicate `code` among check rules.
4. Any unresolved, wrong-typed, or invisible reference (§4.3), including `when` leaves
   that are not predicate rules and pipeline steps with scoped references.
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

A rule step evaluates its check rule against the payload per Part I §3 (including
skip-on-absent `[D13]` and aggregation). Each failure produces an issue carrying: the
rule's `level`, `code`, `message`, `meta`; the concrete `field` (for wildcards, the
concrete matched path, not the pattern; for summary issues, the pattern); `ruleId`; the
immediately enclosing pipeline's id as `pipelineId`; `stepId` when the step declares
one; `expected`/`actual` per Part III. A skip produces nothing normative.

### 5.4 Condition steps

The `when` expression evaluates over a three-valued predicate layer collapsed to
booleans at the leaves:

1. A leaf evaluates its predicate rule per Part I §3 (aggregation included), yielding
   `TRUE`, `FALSE`, or `UNDEFINED`; `UNDEFINED` collapses to `FALSE` at the leaf.
2. `all` is the conjunction, `any` the disjunction, `not` the negation of the collapsed
   boolean results.

Predicates produce no issues and have no observable side effects, therefore evaluation
strategy (short-circuit or exhaustive, in any order) is unobservable in the normative
result and unconstrained; trace MAY differ between implementations. `[D7][D12]`

If the guard is true, the condition's `steps` execute in place (§5.2); otherwise the
step is a no-op.

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

Strict summary codes are runtime-generated and are therefore outside the check-rule
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
| `meta` | object | when the rule declares `meta` (§6.6) |

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

`[DR-III]` A summary issue (produced by `ALL` with `summaryIssue: true`, by a failing `COUNT`, by
`MIN`/`MAX`, or by `onEmpty: "FAIL"`) carries `field` = the wildcard pattern and a
`details` object:

| Producer | `details` | `expected` / `actual` |
| --- | --- | --- |
| `ALL`, `summaryIssue: true` | `{"mode":"ALL","total":<n>,"failed":<k>}` | omitted / omitted |
| `COUNT` failure | `{"mode":"COUNT","op":"…","value":<v>,"total":<n>,"passed":<k>}` | omitted / omitted |
| `MIN` / `MAX` failure | `{"mode":"MIN"\|"MAX"}` | per §6.4 for the base operator; `field` is the **concrete path of the extremum element**, not the pattern; `actual` = the extremum value. If the extremum is undetermined (Part I §3.6.2), `field` is the pattern and `expected`/`actual` are omitted |
| `onEmpty: "FAIL"` | `{"mode":"<effective mode>","total":0}` | omitted / omitted |

The consumer rule is one sentence: **`details.mode` present ⇒ a group verdict, read
`details`; otherwise an ordinary value issue, read `expected`/`actual`.** Per-element
issues (`EACH`, or `ALL` with `summaryIssue: false`) are ordinary §6.3/§6.4 issues and
never carry `details`.

### 6.6 `meta` passthrough

When a rule declares `meta`, every issue produced by that rule carries `meta` **verbatim
as authored**. The runtime MUST NOT add, remove, or rewrite keys inside it; runtime
facts live in `details` (§6.5) or nowhere. `[DR-III]`

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
  "specVersion": "1.0.0-rc.2",
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
section they pin; every decision D1–D18 MUST be covered by at least one fixture.

**Reserved conformance operators.** `[DR-IV]` The following operator names are
reserved. They are registered **only by conformance runners** as part of the test
harness — never by production runtimes — and each implementation adapts them to its
own registration API. Their pinned behavior when invoked:

| Name | Role | Behavior | Expected reaction |
| --- | --- | --- | --- |
| `conformance.check.throw` | check | raises a host failure | `ABORT OPERATOR_FAULT` |
| `conformance.check.invalid_result` | check | returns a value outside the enum | `ABORT OPERATOR_CONTRACT_VIOLATION` |
| `conformance.check.exception` | check | returns `EXCEPTION` | `EXCEPTION` issue per §3.1, evaluation stops |
| `conformance.predicate.throw` | predicate | raises a host failure | `ABORT OPERATOR_FAULT` |
| `conformance.predicate.invalid_result` | predicate | returns a value outside the enum | `ABORT OPERATOR_CONTRACT_VIOLATION` |

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
