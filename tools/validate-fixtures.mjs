// Fixture suite validator. Run: node tools/validate-fixtures.mjs
// Checks structural validity of every fixture file. Does NOT evaluate semantics —
// semantic correctness is established by running implementations against the suite.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPEC_VERSION } from './spec-version.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'fixtures');
const SPEC = SPEC_VERSION;
const SNAPSHOT_VERSION_OVERRIDES = new Map([
  ['d11/reject-unsupported-spec-version', '999.0.0'],
  ['d11/reject-unsupported-minor-version', '1.999.0'],
]);

function jcs(v) {
  if (v === null || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('non-finite'); return JSON.stringify(v); }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(jcs).join(',') + ']';
  const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return '{' + keys.map(k => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}';
}
const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');
const snapshotHash = s => {
  const { sourceHash: _ignored, ...body } = s;
  return sha(jcs(body));
};

function ruleRefs(when, out = []) {
  if (typeof when === 'string') out.push(when);
  else if (when && typeof when === 'object') {
    if (Array.isArray(when.all)) for (const child of when.all) ruleRefs(child, out);
    if (Array.isArray(when.any)) for (const child of when.any) ruleRefs(child, out);
    if ('not' in when) ruleRefs(when.not, out);
  }
  return out;
}

function reachableArtifacts(snapshot) {
  const byId = new Map(Object.entries(snapshot.artifacts));
  const seen = new Set();
  const visit = id => {
    if (seen.has(id)) return;
    seen.add(id);
    const a = byId.get(id);
    if (!a) return;
    if (a.type === 'pipeline' || a.type === 'condition') {
      for (const step of a.steps ?? []) visit(step);
    }
    if (a.type === 'condition') for (const id of ruleRefs(a.when)) visit(id);
    if (a.type === 'rule' && typeof a.dictionary === 'string') visit(a.dictionary);
  };
  for (const id of snapshot.exports) visit(id);
  return seen;
}

const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.json')) files.push(p);
  }
})(FIX);

const errors = [];
const names = new Set();
const STATUSES = new Set(['OK', 'OK_WITH_WARNINGS', 'ERROR', 'EXCEPTION', 'ABORT']);
let evalN = 0, rejN = 0;

for (const p of files) {
  const rel = relative(ROOT, p);
  let fx;
  try { fx = JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { errors.push(`${rel}: invalid JSON: ${e.message}`); continue; }
  const err = m => errors.push(`${rel}: ${m}`);

  if (typeof fx.name !== 'string' || !fx.name) err('missing name');
  else if (names.has(fx.name)) err(`duplicate name ${fx.name}`);
  else names.add(fx.name);
  if (!Array.isArray(fx.operators)) err('operators must be an array');
  if (!fx.expected || typeof fx.expected !== 'object') { err('missing expected'); continue; }

  const rejection = fx.expected.verdict === 'reject';
  if (rejection) {
    const expectedKeys = new Set(['verdict', 'identifier']);
    for (const key of Object.keys(fx.expected))
      if (!expectedKeys.has(key)) err(`rejection expected has unknown field ${key}`);
    if ('identifier' in fx.expected && fx.expected.identifier !== 'OPERATOR_NOT_FOUND')
      err(`bad rejection identifier ${fx.expected.identifier}`);
  }
  if (typeof fx.snapshotText === 'string') {
    if (!rejection) err('snapshotText is only valid in rejection fixtures');
    if (fx.snapshot !== undefined) err('snapshotText fixture must not also contain snapshot');
    if (fx.input !== undefined) err('rejection fixture must not have input');
    rejN++;
    continue;
  }
  if (!fx.snapshot || typeof fx.snapshot !== 'object') { err('missing snapshot'); continue; }

  const expectedSnapshotVersion = SNAPSHOT_VERSION_OVERRIDES.get(fx.name) ?? SPEC;
  if (fx.snapshot.specVersion !== expectedSnapshotVersion) {
    err(`snapshot.specVersion must be ${expectedSnapshotVersion}`);
  }
  if (SNAPSHOT_VERSION_OVERRIDES.has(fx.name) && !rejection) {
    err('snapshot version override is permitted only for a rejection fixture');
  }

  // sourceHash integrity holds for ALL fixtures except the one that tests hash mismatch itself:
  // otherwise a rejection fixture could pass for the wrong reason (accidentally broken hash).
  const hashExempt = new Set([
    'd06/reject-source-hash-mismatch',
    'd10/unknown-operator-with-bad-hash-has-no-operator-identifier',
    'd23/reject-snapshot-number-overflow',
  ]);
  if (!hashExempt.has(fx.name)) {
    try {
      const h = snapshotHash(fx.snapshot);
      if (fx.snapshot.sourceHash !== h) err(`sourceHash mismatch: ${fx.snapshot.sourceHash} != ${h}`);
    } catch (e) { err(`cannot compute sourceHash: ${e.message}`); }
  }
  if (rejection) {
    rejN++;
    if (fx.input !== undefined) err('rejection fixture must not have input');
    continue; // rejection snapshots are invalid by design — no further envelope checks
  }
  evalN++;
  const s = fx.snapshot;
  if (s.format !== 'jsonspecs-snapshot') err('bad snapshot.format');
  if (s.formatVersion !== 2) err('bad snapshot.formatVersion');
  if (!s.artifacts || typeof s.artifacts !== 'object' || Array.isArray(s.artifacts)) err('snapshot.artifacts must be an object');
  if (!Array.isArray(s.exports) || s.exports.length === 0) err('snapshot.exports must be a non-empty array');
  else {
    const byId = new Map(Object.entries(s.artifacts));
    if (new Set(s.exports).size !== s.exports.length) err('snapshot.exports must be unique');
    if (s.exports.some((id, i) => i > 0 && s.exports[i - 1] >= id)) err('snapshot.exports must be strictly UTF-16 sorted');
    for (const id of s.exports) if (byId.get(id)?.type !== 'pipeline') err(`export ${id} is not a pipeline`);
    const reachable = reachableArtifacts(s);
    const all = new Set(Object.keys(s.artifacts));
    if (reachable.size !== all.size || [...all].some(id => !reachable.has(id)))
      err(`artifact closure mismatch: reachable ${reachable.size}, artifacts ${all.size}`);
  }
  for (const [id, a] of Object.entries(s.artifacts)) {
    if ('id' in a) err(`artifact ${id} repeats its id`);
    if ('description' in a) err(`artifact ${id} has legacy description`);
    if (a.type === 'pipeline' && 'entrypoint' in a) err(`pipeline ${id} has legacy entrypoint`);
    if ((a.type === 'pipeline' || a.type === 'condition') && (!Array.isArray(a.steps) || a.steps.some(step => typeof step !== 'string')))
      err(`artifact ${id} steps must be string references`);
  }
  if (!fx.input || typeof fx.input !== 'object') err('missing input');
  // input.payload type is the tested runtime's business (INVALID_PAYLOAD fixtures carry
  // null/arrays deliberately) — the validator checks presence only.
  else {
    if (!('payload' in fx.input)) err('input.payload must be present');
    if (fx.name !== 'sem/abort-invalid-pipeline-id-missing' && !('pipelineId' in fx.input))
      err('input.pipelineId must be present');
  }
  const e = fx.expected;
  const expectedKeys = new Set(['status', 'issues', 'ruleset', 'error']);
  for (const key of Object.keys(e)) if (!expectedKeys.has(key)) err(`expected result has unknown field ${key}`);
  if (!STATUSES.has(e.status)) err(`bad expected.status ${e.status}`);
  if ('control' in e) err('expected.control is not part of the normative result');
  if ('trace' in e || 'engineVersion' in e) err('trace/engineVersion are not part of the normative result');
  if (!Array.isArray(e.issues)) err('expected.issues must be an array');
  if (e.status === 'ABORT') {
    if (!e.error || typeof e.error.code !== 'string' || typeof e.error.details !== 'object') err('ABORT needs error.code + error.details');
    if (e.issues && e.issues.length) err('ABORT must have empty issues');
    if (e.error) for (const key of Object.keys(e.error))
      if (!['code', 'details', 'message'].includes(key)) err(`expected.error has unknown field ${key}`);
  } else if (e.error !== undefined) err('error only on ABORT');
  if (!e.ruleset || e.ruleset.sourceHash !== s.sourceHash || e.ruleset.specVersion !== s.specVersion)
    err('expected.ruleset must echo snapshot specVersion + sourceHash');
  else if (Object.keys(e.ruleset).sort().join(',') !== 'sourceHash,specVersion')
    err('expected.ruleset must be closed');
  for (const [i, is] of (e.issues || []).entries()) {
    for (const k of ['level', 'code', 'message', 'ruleId', 'pipelineId'])
      if (is[k] === undefined) err(`issues[${i}] missing ${k}`);
    if ('kind' in is || 'stepId' in is) err(`issues[${i}] has a removed field`);
    if (!('field' in is)) err(`issues[${i}] missing field (may be null, not absent)`);
    for (const key of Object.keys(is))
      if (!['level', 'code', 'message', 'field', 'ruleId', 'pipelineId', 'expected', 'actual', 'details', 'meta'].includes(key))
        err(`issues[${i}] has unknown field ${key}`);
  }
}

const BUILT_INS = [
  'not_empty', 'is_empty', 'not_true', 'any_filled', 'is_boolean', 'is_string',
  'is_number', 'is_integer', 'equals', 'not_equals', 'contains', 'matches_regex',
  'not_matches_regex', 'greater_than', 'less_than', 'length_equals', 'length_max',
  'field_equals_field', 'field_not_equals_field', 'field_greater_than_field',
  'field_less_than_field', 'field_greater_or_equal_than_field',
  'field_less_or_equal_than_field', 'in_dictionary', 'not_in_dictionary',
];
const NO_SKIP = new Set(['not_empty', 'is_empty', 'not_true', 'any_filled']);
for (const operator of BUILT_INS) {
  for (const outcome of ['pass', 'fail', ...(!NO_SKIP.has(operator) ? ['skip'] : [])]) {
    const name = `operators/${operator}-${outcome}`;
    if (!names.has(name)) errors.push(`missing built-in coverage fixture ${name}`);
  }
}

for (const name of [
  'd04/dollar-is-absolute-end-not-before-final-newline',
  'd04/dot-matches-line-separator',
  'd04/reject-class-escape-as-left-range-endpoint',
  'd04/reject-class-escape-as-right-range-endpoint',
  'd04/nested-counted-repeat-factor-at-1000-is-accepted',
  'd04/reject-nested-counted-repeat-factor-over-1000',
  'd04/expanded-atom-count-at-10000-is-accepted',
  'd04/reject-expanded-atom-count-over-10000',
  'd04/reject-zero-repeat-does-not-erase-expanded-atom-cost',
  'd04/empty-pattern-matches-empty-substring-of-nonempty-string',
  'd04/absolute-empty-string-anchors-do-not-match-nonempty-string',
  'd04/empty-complemented-class-is-valid-and-never-matches',
  'd08/object-operands-remain-structural-json-in-result',
  'd20/any-pass-still-evaluates-later-throw',
  'd20/all-fail-still-evaluates-later-throw',
  'd20/each-exception-materializes-all-current-rule-issues-before-stop',
  'd24/custom-operator-without-field-uses-null-issue-field',
  'd10/unknown-operator-with-bad-hash-has-no-operator-identifier',
  'd09/dangerous-key-selection-uses-code-point-order-not-utf16',
  'd10/unknown-operator-contract-specific-shape-still-not-found',
  'd10/unknown-operator-with-empty-input-name-has-no-operator-identifier',
  'd27/custom-standard-field-absence-skips-before-invocation',
  'd24/reject-empty-operator-name',
  'd22/abort-discards-previous-business-issues',
  'd23/snapshot-negative-zero-is-normalized-before-hashing-and-expected',
  'd23/snapshot-unsafe-integer-is-converted-before-hashing-and-expected',
]) if (!names.has(name)) errors.push(`missing RC.5 erratum fixture ${name}`);

for (const name of [
  'd31/required-child-all-each-reports-absent',
  'd31/required-child-all-summary-counts-absent',
  'd31/is-empty-passes-on-absent-candidate',
  'd31/not-true-passes-on-absent-candidate',
  'd31/any-pass-emits-no-absent-partial-issue',
  'd31/any-all-fail-reports-absent-and-null-in-order',
  'd31/count-mixes-pass-fail-and-two-kinds-of-skip',
  'd31/value-operator-absent-candidate-counts-as-skip',
  'd31/value-operator-all-absent-is-all-skip-not-on-empty',
  'd31/empty-parent-array-uses-on-empty',
  'd31/missing-prefix-before-first-wildcard-uses-on-empty',
  'd31/null-parent-before-wildcard-uses-on-empty',
  'd31/scalar-parent-before-wildcard-uses-on-empty',
  'd31/object-parent-before-wildcard-uses-on-empty',
  'd31/missing-segment-between-wildcards-creates-no-inner-branch',
  'd31/missing-inner-array-does-not-hide-other-branches',
  'd31/missing-suffix-after-final-wildcard-preserves-candidate',
  'd31/null-scalar-and-empty-object-elements-preserve-absent-suffix',
  'd31/terminal-wildcard-keeps-flat-leaf-model',
  'd31/absent-candidate-order-is-numeric-two-before-ten',
  'd31/nested-absent-candidates-follow-index-tuple-order',
  'd31/adjacent-wildcards-preserve-candidates-and-order',
  'd31/numeric-object-key-is-not-an-exact-array-index',
  'd31/out-of-range-exact-index-before-wildcard-ends-branch',
  'd31/out-of-range-exact-index-after-final-wildcard-is-absent',
  'd31/large-exact-index-after-wildcard-preserves-concrete-path',
  'd31/reject-wildcard-in-context-field',
  'd31/any-pass-still-evaluates-late-invalid-result',
]) if (!names.has(name)) errors.push(`missing mandatory D31 fixture ${name}`);

for (const name of SNAPSHOT_VERSION_OVERRIDES.keys()) {
  if (!names.has(name)) errors.push(`missing explicit snapshot-version rejection fixture ${name}`);
}

if (errors.length) {
  console.error(`FAIL: ${errors.length} problem(s)`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log(`OK: ${files.length} fixtures (${evalN} evaluation, ${rejN} rejection), all valid`);
