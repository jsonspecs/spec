// Fixture generator for jsonspecs/spec conformance suite.
// Regenerates fixtures/**/*.json deterministically. Run: node tools/generate-fixtures.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = '1.0.0-rc.5';
const deep = n => n <= 1 ? 1 : { n: deep(n - 1) };
const jsonDepth = value => {
  if (value === null || typeof value !== 'object') return 1;
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.length === 0 ? 1 : 1 + Math.max(...children.map(jsonDepth));
};
const EXPORTED = Symbol('exported');

// RFC 8785 (JCS) canonicalization — sufficient for fixture content
export function jcs(v) {
  if (v === null || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('non-finite'); return JSON.stringify(v); }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(jcs).join(',') + ']';
  const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return '{' + keys.map(k => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}';
}
const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');
function rehash(snapshot) {
  const { sourceHash: _ignored, ...body } = snapshot;
  snapshot.sourceHash = sha(jcs(body));
  return snapshot;
}

function snap(artifacts, opts = {}) {
  const s = { format: 'jsonspecs-snapshot', formatVersion: 2, specVersion: SPEC };
  if (opts.formatVersion !== undefined) s.formatVersion = opts.formatVersion;
  if (opts.specVersion !== undefined) s.specVersion = opts.specVersion;
  let exported = opts.exports ?? artifacts
    .filter(a => a.type === 'pipeline' && a[EXPORTED] !== false)
    .map(a => a.id);
  if (opts.sortExports !== false && Array.isArray(exported)) exported = [...exported].sort();
  s.exports = exported;
  const stepRef = step => {
    if (typeof step === 'string') return step;
    if (!step || typeof step !== 'object') return step;
    const keys = Object.keys(step);
    if (keys.length !== 1) return step;
    return step.rule ?? step.condition ?? step.pipeline ?? step;
  };
  const normalized = new Map();
  for (const artifact of artifacts) {
    const { id, ...value } = artifact;
    if (value.type === 'pipeline' || value.type === 'condition') {
      if (Array.isArray(value.flow)) {
        value.steps = value.flow.map(stepRef);
        delete value.flow;
      } else if (Array.isArray(value.steps)) value.steps = value.steps.map(stepRef);
    }
    if (value.type === 'rule' && value.dictionary && typeof value.dictionary === 'object') {
      const keys = Object.keys(value.dictionary);
      if (keys.length === 2 && value.dictionary.type === 'static' && typeof value.dictionary.id === 'string')
        value.dictionary = value.dictionary.id;
    }
    normalized.set(id, value);
  }
  s.artifacts = Object.fromEntries([...normalized].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  s.sourceHash = opts.badHash ? '0'.repeat(64) : sha(jcs(s));
  return s;
}
const chk = (id, operator, o = {}) => ({ id, type: 'rule',
  operator, ...o.x,
  ...(o.field !== undefined ? { field: o.field } : {}), ...(o.fields ? { fields: o.fields } : {}),
  ...(o.value !== undefined ? { value: o.value } : {}), ...(o.value_field ? { value_field: o.value_field } : {}),
  ...(o.inputs ? { inputs: o.inputs } : {}),
  ...(o.flags ? { flags: o.flags } : {}), ...(o.dictionary ? { dictionary: o.dictionary } : {}),
  ...(o.params ? { params: o.params } : {}),
  ...(o.aggregate ? { aggregate: o.aggregate } : {}),
  issue: { level: o.level ?? 'ERROR', code: o.code, message: o.message ?? 'failed', ...(o.meta ? { meta: o.meta } : {}) } });
const pred = (id, operator, o = {}) => ({ id, type: 'rule',
  operator, ...(o.field !== undefined ? { field: o.field } : {}), ...(o.fields ? { fields: o.fields } : {}),
  ...(o.value !== undefined ? { value: o.value } : {}), ...(o.value_field ? { value_field: o.value_field } : {}),
  ...(o.inputs ? { inputs: o.inputs } : {}),
  ...(o.flags ? { flags: o.flags } : {}), ...(o.dictionary ? { dictionary: o.dictionary } : {}),
  ...(o.params ? { params: o.params } : {}),
  ...(o.aggregate ? { aggregate: o.aggregate } : {}), ...o.x });
const pipe = (id, steps, o = {}) => ({ id, type: 'pipeline', [EXPORTED]: o.exported ?? true,
  ...o.x, steps: steps.map(step => typeof step === 'string' ? step : step.rule ?? step.condition ?? step.pipeline ?? step) });
const issue = (level, code, message, field, ruleId, pipelineId, extra = {}) =>
  ({ level, code, message, field, ruleId, pipelineId, ...extra });
const M = 'failed';

const out = [];
function evalFx(dir, name, snapshot, input, expected, operators = [], options = {}) {
  const normalizedInput = input && typeof input === 'object' && !Array.isArray(input)
    && !Object.hasOwn(input, 'pipelineId') && !options.keepMissingPipelineId
    ? { pipelineId: 'checks.main', ...input }
    : input;
  out.push({ dir, file: name.split('/').pop() + '.json',
    doc: { name, snapshot, operators, input: normalizedInput, expected: { ...expected, ruleset: { specVersion: snapshot.specVersion, sourceHash: snapshot.sourceHash } } } });
}
function rejFx(dir, name, snapshot, identifier, operators = []) {
  out.push({ dir, file: name.split('/').pop() + '.json',
    doc: { name, snapshot, operators, expected: { verdict: 'reject', ...(identifier ? { identifier } : {}) } } });
}
function rawSnapshotFx(dir, name, snapshotText, identifier) {
  out.push({ dir, file: name.split('/').pop() + '.json',
    doc: { name, snapshotText, operators: [],
      expected: { verdict: 'reject', ...(identifier ? { identifier } : {}) } } });
}
function raw(name, replacements) {
  const fixture = out.findLast(f => f.doc.name === name);
  if (!fixture) throw new Error(`unknown fixture ${name}`);
  fixture.rawReplacements = replacements;
}
const one = (rule, pid = 'checks.main') => [rule, pipe(pid, [rule.id])];
const OKR = { status: 'OK', issues: [] };
const ERR = issues => ({ status: 'ERROR', issues });

/* ---------------- d01-numbers ---------------- */
{
  const r = chk('library.n.eq', 'equals', { code: 'N1', field: 'a', value: 1 });
  evalFx('d01-numbers', 'd01/equals-int-vs-float-equal', snap(one(r)), { pipelineId: 'checks.main', payload: { a: 1.0 } }, OKR);
  evalFx('d01-numbers', 'd01/equals-number-vs-numeric-string-not-equal', snap(one(r)), { pipelineId: 'checks.main', payload: { a: '1' } },
    ERR([issue('ERROR', 'N1', M, 'a', 'library.n.eq', 'checks.main', { expected: 1, actual: '1' })]));
}
{
  const r = chk('library.n.gt', 'greater_than', { code: 'N2', field: 'a', value: '10' });
  evalFx('d01-numbers', 'd01/greater-than-numeric-strings', snap(one(r)), { pipelineId: 'checks.main', payload: { a: '9.5' } },
    ERR([issue('ERROR', 'N2', M, 'a', 'library.n.gt', 'checks.main', { expected: '10', actual: '9.5' })]));
}
{
  const r = chk('library.n.gt2', 'greater_than', { code: 'N3', field: 'a', value: 10 });
  evalFx('d01-numbers', 'd01/non-numeric-string-undetermined-fails', snap(one(r)), { pipelineId: 'checks.main', payload: { a: '10 ' } },
    ERR([issue('ERROR', 'N3', M, 'a', 'library.n.gt2', 'checks.main', { expected: 10, actual: '10 ' })]));
}
{
  const r = chk('library.n.lt', 'less_than', { code: 'N4', field: 'a', value: '2026-12-31' });
  evalFx('d01-numbers', 'd01/date-comparison-chronological', snap(one(r)), { pipelineId: 'checks.main', payload: { a: '2026-07-21' } }, OKR);
}
{
  const r = chk('library.n.gt3', 'greater_than', { code: 'N5', field: 'a', value: '2026-01-01' });
  evalFx('d01-numbers', 'd01/invalid-calendar-date-undetermined-fails', snap(one(r)), { pipelineId: 'checks.main', payload: { a: '2026-02-30' } },
    ERR([issue('ERROR', 'N5', M, 'a', 'library.n.gt3', 'checks.main', { expected: '2026-01-01', actual: '2026-02-30' })]));
}

/* ---------------- d02-length ---------------- */
{
  const arts = [chk('library.l.max', 'length_max', { code: 'L1', field: 'emoji', value: 1 }),
    chk('library.l.eq', 'length_equals', { code: 'L2', field: 'name', value: 4 }),
    pipe('checks.main', [{ rule: 'library.l.max' }, { rule: 'library.l.eq' }])];
  evalFx('d02-length', 'd02/code-points-surrogate-and-cyrillic', snap(arts),
    { pipelineId: 'checks.main', payload: { emoji: '\u{1F600}', name: 'Пётр' } }, OKR);
}
{
  const r = chk('library.l.max2', 'length_max', { code: 'L3', field: 'name', value: 3 });
  evalFx('d02-length', 'd02/length-max-exceeded-issue-shape', snap(one(r)), { pipelineId: 'checks.main', payload: { name: 'Пётр' } },
    ERR([issue('ERROR', 'L3', M, 'name', 'library.l.max2', 'checks.main', { expected: 3, actual: 'Пётр' })]));
}

/* ---------------- d03-string-strict ---------------- */
{
  const r = chk('library.s.rx', 'matches_regex', { code: 'S1', field: 'a', value: '^\\d+$' });
  evalFx('d03-string-strict', 'd03/matches-regex-on-number-fails', snap(one(r)), { pipelineId: 'checks.main', payload: { a: 123 } },
    ERR([issue('ERROR', 'S1', M, 'a', 'library.s.rx', 'checks.main', { expected: '^\\d+$', actual: 123 })]));
}
{
  const r = chk('library.s.len', 'length_max', { code: 'S2', field: 'a', value: 3 });
  evalFx('d03-string-strict', 'd03/length-on-number-fails', snap(one(r)), { pipelineId: 'checks.main', payload: { a: 12 } },
    ERR([issue('ERROR', 'S2', M, 'a', 'library.s.len', 'checks.main', { expected: 3, actual: 12 })]));
}
{
  const r = chk('library.s.ct', 'contains', { code: 'S3', field: 'a', value: 'ru' });
  evalFx('d03-string-strict', 'd03/contains-on-boolean-fails', snap(one(r)), { pipelineId: 'checks.main', payload: { a: true } },
    ERR([issue('ERROR', 'S3', M, 'a', 'library.s.ct', 'checks.main', { expected: 'ru', actual: true })]));
}

/* ---------------- d04-regex ---------------- */
rejFx('d04-regex', 'd04/reject-lookahead', snap(one(chk('library.r.a', 'matches_regex', { code: 'R1', field: 'a', value: '^(?!x).*$' }))));
rejFx('d04-regex', 'd04/reject-backreference', snap(one(chk('library.r.b', 'matches_regex', { code: 'R2', field: 'a', value: '^(a)\\1$' }))));
rejFx('d04-regex', 'd04/reject-word-boundary', snap(one(chk('library.r.c', 'matches_regex', { code: 'R3', field: 'a', value: '\\bfoo' }))));
rejFx('d04-regex', 'd04/reject-quantifier-over-1000', snap(one(chk('library.r.d', 'matches_regex', { code: 'R4', field: 'a', value: 'a{1001}' }))));
rejFx('d04-regex', 'd04/reject-pattern-over-1024-codepoints', snap(one(chk('library.r.e', 'matches_regex', { code: 'R5', field: 'a', value: '^' + 'a'.repeat(1030) + '$' }))));
rejFx('d04-regex', 'd04/reject-legacy-flags-field', snap(one(chk('library.r.f', 'matches_regex', { code: 'R6', field: 'a', value: '^a$', flags: 'i' }))));
{
  const r = chk('library.r.exact', 'matches_regex', { code: 'R7', field: 'a', value: '^\\\\d+$' });
  evalFx('d04-regex', 'd04/decoded-pattern-is-used-without-backslash-collapse', snap(one(r)),
    { pipelineId: 'checks.main', payload: { a: '123' } },
    ERR([issue('ERROR', 'R7', M, 'a', r.id, 'checks.main', { expected: '^\\\\d+$', actual: '123' })]));
}
evalFx('d04-regex', 'd04/dot-matches-one-code-point',
  snap(one(chk('library.r.dot', 'matches_regex', { code: 'R10', field: 'a', value: '^.$' }))),
  { pipelineId: 'checks.main', payload: { a: '\u{1F600}' } }, OKR);
{
  const r = chk('library.r.anchor', 'matches_regex', { code: 'R14', field: 'a', value: 'a$' });
  evalFx('d04-regex', 'd04/dollar-is-absolute-end-not-before-final-newline', snap(one(r)),
    { pipelineId: 'checks.main', payload: { a: 'a\n' } },
    ERR([issue('ERROR', 'R14', M, 'a', r.id, 'checks.main', { expected: 'a$', actual: 'a\n' })]));
}
{
  const r = chk('library.r.dot-lines', 'matches_regex', { code: 'R15', field: 'a', value: '^.$' });
  evalFx('d04-regex', 'd04/dot-excludes-only-line-feed', snap(one(r)),
    { pipelineId: 'checks.main', payload: { a: '\n' } },
    ERR([issue('ERROR', 'R15', M, 'a', r.id, 'checks.main', { expected: '^.$', actual: '\n' })]));
  for (const [name, value] of [['carriage-return', '\r'], ['line-separator', '\u2028'], ['paragraph-separator', '\u2029']]) {
    evalFx('d04-regex', `d04/dot-matches-${name}`, snap(one(r)),
      { pipelineId: 'checks.main', payload: { a: value } }, OKR);
  }
}
rejFx('d04-regex', 'd04/reject-unescaped-hyphen-at-class-edge',
  snap(one(chk('library.r.hyphen.bad', 'matches_regex', { code: 'R16', field: 'a', value: '^[-a]$' }))));
evalFx('d04-regex', 'd04/escaped-hyphen-in-class-is-literal',
  snap(one(chk('library.r.hyphen.ok', 'matches_regex', { code: 'R17', field: 'a', value: '^[\\-a]$' }))),
  { pipelineId: 'checks.main', payload: { a: '-' } }, OKR);
{
  const r = chk('library.r.d2', 'matches_regex', { code: 'R11', field: 'a', value: '^\\d+$' });
  evalFx('d04-regex', 'd04/digit-class-is-ascii-only', snap(one(r)), { pipelineId: 'checks.main', payload: { a: '\u0663' } },
    ERR([issue('ERROR', 'R11', M, 'a', 'library.r.d2', 'checks.main', { expected: '^\\d+$', actual: '\u0663' })]));
}
evalFx('d04-regex', 'd04/unanchored-search-semantics',
  snap(one(chk('library.r.s', 'matches_regex', { code: 'R12', field: 'a', value: '\\d' }))),
  { pipelineId: 'checks.main', payload: { a: 'ab7cd' } }, OKR);
{
  const r = chk('library.r.nm', 'not_matches_regex', { code: 'R13', field: 'a', value: 'USA|США' });
  evalFx('d04-regex', 'd04/not-matches-regex-ok', snap(one(r)), { pipelineId: 'checks.main', payload: { a: 'город Москва' } }, OKR);
  evalFx('d04-regex', 'd04/not-matches-regex-fail-shape', snap(one(r)), { pipelineId: 'checks.main', payload: { a: 'г. USA' } },
    ERR([issue('ERROR', 'R13', M, 'a', 'library.r.nm', 'checks.main', { expected: 'USA|США', actual: 'г. USA' })]));
}

/* ---------------- d05-order ---------------- */
{
  const r = chk('library.o.each', 'greater_than', { code: 'O1', field: 'x[*].v', value: 10,
    aggregate: { mode: 'ALL', issueMode: 'EACH' } });
  evalFx('d05-order', 'd05/wildcard-gaps-ascending-numeric', snap(one(r)),
    { pipelineId: 'checks.main', payload: { x: [{ v: 2 }, {}, { v: 3 }, {}, {}, { v: 1 }] } },
    ERR([issue('ERROR', 'O1', M, 'x[0].v', 'library.o.each', 'checks.main', { expected: 10, actual: 2 }),
         issue('ERROR', 'O1', M, 'x[2].v', 'library.o.each', 'checks.main', { expected: 10, actual: 3 }),
         issue('ERROR', 'O1', M, 'x[5].v', 'library.o.each', 'checks.main', { expected: 10, actual: 1 })]));
}
{
  const r = chk('library.o.odo', 'greater_than', { code: 'O2', field: 'm[*].n[*].v', value: 10,
    aggregate: { mode: 'ALL', issueMode: 'EACH' } });
  evalFx('d05-order', 'd05/odometer-order-two-wildcards', snap(one(r)),
    { pipelineId: 'checks.main', payload: { m: [{ n: [{ v: 1 }, { v: 2 }] }, { n: [{ v: 3 }] }] } },
    ERR([issue('ERROR', 'O2', M, 'm[0].n[0].v', 'library.o.odo', 'checks.main', { expected: 10, actual: 1 }),
         issue('ERROR', 'O2', M, 'm[0].n[1].v', 'library.o.odo', 'checks.main', { expected: 10, actual: 2 }),
         issue('ERROR', 'O2', M, 'm[1].n[0].v', 'library.o.odo', 'checks.main', { expected: 10, actual: 3 })]));
}

/* ---------------- d06-hash ---------------- */
rejFx('d06-hash', 'd06/reject-source-hash-mismatch', snap(one(chk('library.h.r', 'not_empty', { code: 'H1', field: 'a' })), { badHash: true }));

/* ---------------- d08-representation ---------------- */
{
  const r = chk('library.p.req', 'not_empty', { code: 'P1', field: 'a' });
  evalFx('d08-representation', 'd08/absent-field-no-actual-key', snap(one(r)), { pipelineId: 'checks.main', payload: {} },
    ERR([issue('ERROR', 'P1', M, 'a', 'library.p.req', 'checks.main')]));
}
{
  const arts = [chk('library.p.n', 'not_empty', { code: 'P2', field: 'a' }),
    chk('library.p.e', 'not_empty', { code: 'P3', field: 'b' }),
    pipe('checks.main', [{ rule: 'library.p.n' }, { rule: 'library.p.e' }])];
  evalFx('d08-representation', 'd08/present-empty-actual-null-and-empty-string', snap(arts),
    { pipelineId: 'checks.main', payload: { a: null, b: '' } },
    ERR([issue('ERROR', 'P2', M, 'a', 'library.p.n', 'checks.main', { actual: null }),
         issue('ERROR', 'P3', M, 'b', 'library.p.e', 'checks.main', { actual: '' })]));
}
{
  const r = chk('library.p.any', 'any_filled', { code: 'P4', fields: ['phone', 'email'] });
  evalFx('d08-representation', 'd08/any-filled-field-null-no-expected-actual', snap(one(r)),
    { pipelineId: 'checks.main', payload: { other: 1 } },
    ERR([issue('ERROR', 'P4', M, null, 'library.p.any', 'checks.main')]));
}
{
  const arts = [chk('library.p.ec', 'not_empty', { code: 'P5', field: 'a' }),
    chk('library.p.cc', 'not_empty', { code: 'P6', field: 'b' }),
    pipe('checks.main', [{ rule: 'library.p.ec' }, { rule: 'library.p.cc' }])];
  evalFx('d08-representation', 'd08/empty-container-is-leaf-nonempty-container-is-absent', snap(arts),
    { pipelineId: 'checks.main', payload: { a: [], b: [1] } },
    ERR([issue('ERROR', 'P6', M, 'b', 'library.p.cc', 'checks.main')]));
}

/* ---------------- d09-guards ---------------- */
{
  const r = chk('library.g.r', 'not_empty', { code: 'G1', field: 'ok' });
  evalFx('d09-guards', 'd09/dangerous-key-lexicographically-smallest-path',
    snap(one(r)),
    { pipelineId: 'checks.main', payload: JSON.parse('{"z":{"constructor":1},"a":{"constructor":2},"ok":1}') },
    { status: 'ABORT', issues: [], error: { code: 'DANGEROUS_PAYLOAD_KEY', details: { parentPath: 'a', key: 'constructor' } } });
  evalFx('d09-guards', 'd09/dangerous-key-selection-uses-code-point-order-not-utf16',
    snap(one(r)),
    { pipelineId: 'checks.main', payload: JSON.parse('{"\ud800\udc00":{"constructor":1},"\ue000":{"constructor":2},"ok":1}') },
    { status: 'ABORT', issues: [], error: { code: 'DANGEROUS_PAYLOAD_KEY', details: { parentPath: '\ue000', key: 'constructor' } } });
  evalFx('d09-guards', 'd09/payload-too-deep-details-max-depth-only', snap(one(chk('library.g.d', 'not_empty', { code: 'G2', field: 'ok' }))),
    { pipelineId: 'checks.main', payload: { ok: 1, d: deep(256) } },
    { status: 'ABORT', issues: [], error: { code: 'PAYLOAD_TOO_DEEP', details: { maxDepth: 256 } } });
  evalFx('d09-guards', 'd09/proto-key-rejected', snap(one(chk('library.g.p', 'not_empty', { code: 'G3', field: 'ok' }))),
    { pipelineId: 'checks.main', payload: JSON.parse('{"x":{"__proto__":1},"ok":1}') },
    { status: 'ABORT', issues: [], error: { code: 'DANGEROUS_PAYLOAD_KEY', details: { parentPath: 'x', key: '__proto__' } } });
}

/* ---------------- d10-operators ---------------- */
rejFx('d10-operators', 'd10/reject-derived-custom-operator-not-found',
  snap(one(chk('library.c.u', 'custom_x', { code: 'C1', field: 'a' }))), 'OPERATOR_NOT_FOUND');
rejFx('d10-operators', 'd10/unknown-operator-contract-specific-shape-still-not-found',
  snap(one(chk('library.c.unknown-shape', 'custom_x', { code: 'C1S', field: 'a',
    inputs: { unknownName: 'b' }, params: { unknownSetting: true } }))), 'OPERATOR_NOT_FOUND');
{
  const badHash = snap(one(chk('library.c.bad-hash', 'custom_x', { code: 'C2', field: 'a' })), { badHash: true });
  rejFx('d10-operators', 'd10/unknown-operator-with-bad-hash-has-no-operator-identifier', badHash);
}
rejFx('d10-operators', 'd10/unknown-operator-with-broken-reference-has-no-operator-identifier',
  snap([chk('library.c.bad-ref', 'custom_x', { code: 'C3', field: 'a' }), pipe('checks.main', ['missing.rule'])]));

/* ---------------- d11-snapshot ---------------- */
rejFx('d11-snapshot', 'd11/reject-any-filled-paths-alias',
  snap(one({ id: 'library.x.af', type: 'rule', operator: 'any_filled',
    issue: { level: 'ERROR', code: 'X1', message: M }, paths: ['a', 'b'] })));
rejFx('d11-snapshot', 'd11/reject-required-context-field',
  snap([chk('library.x.r', 'not_empty', { code: 'X2', field: 'a' }),
    { id: 'checks.main', type: 'pipeline', required_context: ['currentDate'], steps: ['library.x.r'] }]));
rejFx('d11-snapshot', 'd11/reject-unknown-artifact-field',
  snap(one({ ...chk('library.x.u', 'not_empty', { code: 'X3', field: 'a' }), note: 'oops' })));
rejFx('d11-snapshot', 'd11/reject-format-version-1',
  snap(one(chk('library.x.f', 'not_empty', { code: 'X4', field: 'a' })), { formatVersion: 1 }));
rejFx('d11-snapshot', 'd11/reject-unsupported-spec-version',
  snap(one(chk('library.x.s', 'not_empty', { code: 'X5', field: 'a' })), { specVersion: '999.0.0' }));
{
  const r = chk('library.x.ctx', 'not_empty', { code: 'CTX.CURRENT_DATE.REQUIRED', field: '$context.currentDate', level: 'EXCEPTION' });
  evalFx('d11-snapshot', 'd11/payload-context-key-has-no-special-meaning', snap(one(r)),
    { pipelineId: 'checks.main', payload: { __context: { currentDate: '2026-01-01' } } },
    { status: 'EXCEPTION',
      issues: [issue('EXCEPTION', 'CTX.CURRENT_DATE.REQUIRED', M, '$context.currentDate', 'library.x.ctx', 'checks.main')] });
}
rejFx('d11-snapshot', 'd11/reject-duplicate-issue-code',
  snap([chk('library.x.d1', 'not_empty', { code: 'DUP', field: 'a' }), chk('library.x.d2', 'not_empty', { code: 'DUP', field: 'b' }),
    pipe('checks.main', [{ rule: 'library.x.d1' }, { rule: 'library.x.d2' }])]));
rejFx('d11-snapshot', 'd11/reject-partial-issue-object',
  snap([{ id: 'library.x.p', type: 'rule', operator: 'not_empty', field: 'a',
      issue: { code: 'NOPE', message: M } },
    chk('library.x.ok', 'not_empty', { code: 'X6', field: 'a' }), pipe('checks.main', [{ rule: 'library.x.ok' }])]));
rejFx('d11-snapshot', 'd11/reject-legacy-rule-role',
  snap(one({ ...chk('library.x.role', 'not_empty', { code: 'X6R', field: 'a' }), role: 'check' })));
rejFx('d11-snapshot', 'd11/reject-rule-step-without-issue',
  snap([pred('library.x.pp', 'not_empty', { field: 'a' }), pipe('checks.main', [{ rule: 'library.x.pp' }])]));
rejFx('d11-snapshot', 'd11/reject-pipeline-cycle',
  snap([chk('library.x.c2', 'not_empty', { code: 'X8', field: 'a' }),
    pipe('checks.a', [{ pipeline: 'checks.b' }]), pipe('checks.b', [{ pipeline: 'checks.a' }], { exported: false })]));
rejFx('d11-snapshot', 'd11/reject-unresolved-exact-pipeline-reference',
  snap([chk('library.x.c3', 'not_empty', { code: 'X9', field: 'a' }),
    pipe('checks.main', [{ pipeline: 'inner' }]), pipe('checks.inner', [{ rule: 'library.x.c3' }], { exported: false })]));
rejFx('d11-snapshot', 'd11/reject-dictionary-null-entry',
  snap([{ id: 'library.dict.bad', type: 'dictionary', entries: ['X', null] },
    chk('library.x.di', 'in_dictionary', { code: 'X10', field: 'a', dictionary: { type: 'static', id: 'library.dict.bad' } }),
    pipe('checks.main', [{ rule: 'library.x.di' }])]));
rejFx('d11-snapshot', 'd11/reject-legacy-on-empty-value',
  snap(one(chk('library.x.oe', 'greater_than', { code: 'X11', field: 'x[*].v', value: 1,
    aggregate: { mode: 'ALL', issueMode: 'EACH', onEmpty: 'TRUE' } }))));

/* ---------------- d13-absence ---------------- */
evalFx('d13-absence', 'd13/value-check-skips-on-absent',
  snap(one(chk('library.a.eq', 'equals', { code: 'A1', field: 'a', value: 5 }))),
  { pipelineId: 'checks.main', payload: {} }, OKR);
{
  const arts = [chk('library.a.req', 'not_empty', { code: 'A2', field: 'inn' }),
    chk('library.a.fmt', 'matches_regex', { code: 'A3', field: 'inn', value: '^\\d{12}$' }),
    pipe('checks.main', [{ rule: 'library.a.req' }, { rule: 'library.a.fmt' }])];
  evalFx('d13-absence', 'd13/required-idiom-single-issue-on-absent', snap(arts),
    { pipelineId: 'checks.main', payload: {} },
    ERR([issue('ERROR', 'A2', M, 'inn', 'library.a.req', 'checks.main')]));
}
evalFx('d13-absence', 'd13/not-true-vacuous-on-string-true',
  snap(one(chk('library.a.nt', 'not_true', { code: 'A4', field: 'f' }))),
  { pipelineId: 'checks.main', payload: { f: 'true' } }, OKR);
{
  const r = chk('library.a.nt2', 'not_true', { code: 'A5', field: 'f' });
  evalFx('d13-absence', 'd13/not-true-fails-only-on-boolean-true', snap(one(r)),
    { pipelineId: 'checks.main', payload: { f: true } },
    ERR([issue('ERROR', 'A5', M, 'f', 'library.a.nt2', 'checks.main', { actual: true })]));
}
evalFx('d13-absence', 'd13/field-op-skips-if-either-operand-absent',
  snap(one(chk('library.a.fef', 'field_equals_field', { code: 'A6', field: 'a', value_field: 'b' }))),
  { pipelineId: 'checks.main', payload: { a: 1 } }, OKR);
{
  const arts = [chk('library.a.cg', 'not_empty', { code: 'A7', field: '$context.currentDate', level: 'EXCEPTION' }),
    chk('library.a.cd', 'field_less_or_equal_than_field', { code: 'A8', field: 'doc.issueDate', value_field: '$context.currentDate' }),
    pipe('checks.main', [{ rule: 'library.a.cg' }, { rule: 'library.a.cd' }])];
  evalFx('d13-absence', 'd13/context-guard-idiom-and-comparand-in-expected', snap(arts),
    { pipelineId: 'checks.main', payload: { doc: { issueDate: '2027-01-01' } }, context: { currentDate: '2026-07-21' } },
    ERR([issue('ERROR', 'A8', M, 'doc.issueDate', 'library.a.cd', 'checks.main', { expected: '2026-07-21', actual: '2027-01-01' })]));
  evalFx('d13-absence', 'd13/context-dependent-check-skips-without-guard',
    snap(one(chk('library.a.cd2', 'field_less_or_equal_than_field', { code: 'A9', field: 'doc.issueDate', value_field: '$context.currentDate' }))),
    { pipelineId: 'checks.main', payload: { doc: { issueDate: '2027-01-01' } }, context: {} }, OKR);
}

/* ---------------- semantics ---------------- */
{
  const arts = [pred('library.se.p1', 'not_empty', { field: 'trigger' }),
    chk('library.se.c1', 'not_empty', { code: 'SE1', field: 'a' }),
    { id: 'library.cond.g', type: 'condition', when: 'library.se.p1', steps: [{ rule: 'library.se.c1' }] },
    pipe('checks.main', [{ condition: 'library.cond.g' }])];
  evalFx('semantics', 'sem/condition-guard-undefined-collapses-false', snap(arts),
    { pipelineId: 'checks.main', payload: {} }, OKR);
  evalFx('semantics', 'sem/condition-guard-true-runs-steps', snap(arts),
    { pipelineId: 'checks.main', payload: { trigger: 'x' } },
    ERR([issue('ERROR', 'SE1', M, 'a', 'library.se.c1', 'checks.main')]));
}
{
  const arts = [pred('library.se.pa', 'equals', { field: 'type', value: 'FL' }),
    pred('library.se.pb', 'equals', { field: 'resident', value: true }),
    chk('library.se.c2', 'not_empty', { code: 'SE2', field: 'passport' }),
    { id: 'library.cond.w', type: 'condition',
      when: { all: ['library.se.pa', { not: 'library.se.pb' }] }, steps: [{ rule: 'library.se.c2' }] },
    pipe('checks.main', [{ condition: 'library.cond.w' }])];
  evalFx('semantics', 'sem/when-all-not-composition', snap(arts),
    { pipelineId: 'checks.main', payload: { type: 'FL', resident: false } },
    ERR([issue('ERROR', 'SE2', M, 'passport', 'library.se.c2', 'checks.main')]));
}
{
  const arts = [chk('library.se.x', 'not_empty', { code: 'SE5', field: 'a', level: 'EXCEPTION' }),
    chk('library.se.after', 'not_empty', { code: 'SE6', field: 'b' }),
    pipe('checks.inner', [{ rule: 'library.se.x' }], { exported: false }),
    pipe('checks.main', [{ pipeline: 'checks.inner' }, { rule: 'library.se.after' }])];
  evalFx('semantics', 'sem/exception-in-subpipeline-stops-everything', snap(arts),
    { pipelineId: 'checks.main', payload: {} },
    { status: 'EXCEPTION',
      issues: [issue('EXCEPTION', 'SE5', M, 'a', 'library.se.x', 'checks.inner')] });
}
{
  const arts = [chk('library.se.w', 'not_empty', { code: 'SE7', field: 'a', level: 'WARNING' }),
    pipe('checks.main', [{ rule: 'library.se.w' }])];
  evalFx('semantics', 'sem/warning-only-status', snap(arts), { pipelineId: 'checks.main', payload: {} },
    { status: 'OK_WITH_WARNINGS',
      issues: [issue('WARNING', 'SE7', M, 'a', 'library.se.w', 'checks.main')] });
}
{
  const arts = [chk('library.se.w2', 'not_empty', { code: 'SE8', field: 'a', level: 'WARNING' }),
    chk('library.se.e3', 'not_empty', { code: 'SE9', field: 'b' }),
    pipe('checks.main', [{ rule: 'library.se.w2' }, { rule: 'library.se.e3' }])];
  evalFx('semantics', 'sem/mixed-levels-strongest-wins-order-kept', snap(arts), { pipelineId: 'checks.main', payload: {} },
    ERR([issue('WARNING', 'SE8', M, 'a', 'library.se.w2', 'checks.main'),
         issue('ERROR', 'SE9', M, 'b', 'library.se.e3', 'checks.main')]));
}
{
  const dict = { id: 'library.dict.countries', type: 'dictionary', entries: ['RU', 'Россия'] };
  const arts = [dict,
    chk('library.se.di1', 'in_dictionary', { code: 'SE10', field: 'a', dictionary: 'library.dict.countries' }),
    chk('library.se.di2', 'in_dictionary', { code: 'SE11', field: 'b', dictionary: 'library.dict.countries' }),
    pipe('checks.main', [{ rule: 'library.se.di1' }, { rule: 'library.se.di2' }])];
  evalFx('semantics', 'sem/dictionary-scalar-entry', snap(arts),
    { pipelineId: 'checks.main', payload: { a: 'Россия', b: 'DE' } },
    ERR([issue('ERROR', 'SE11', M, 'b', 'library.se.di2', 'checks.main',
      { expected: 'library.dict.countries', actual: 'DE' })]));
}
{
  const dict = { id: 'library.dict.blocked', type: 'dictionary', entries: ['RU'] };
  const arts = [dict,
    chk('library.se.ni', 'not_in_dictionary', { code: 'SE12', field: 'a', dictionary: 'library.dict.blocked' }),
    pipe('checks.main', [{ rule: 'library.se.ni' }])];
  evalFx('semantics', 'sem/not-in-dictionary-ok', snap(arts), { pipelineId: 'checks.main', payload: { a: 'DE' } }, OKR);
  evalFx('semantics', 'sem/not-in-dictionary-fail-shape', snap(arts), { pipelineId: 'checks.main', payload: { a: 'RU' } },
    ERR([issue('ERROR', 'SE12', M, 'a', 'library.se.ni', 'checks.main',
      { expected: 'library.dict.blocked', actual: 'RU' })]));
}
{
  const r = chk('library.se.all', 'greater_than', { code: 'SE13', field: 'x[*].v', value: 10,
    aggregate: { mode: 'ALL', issueMode: 'SUMMARY' } });
  evalFx('semantics', 'sem/aggregate-all-summary-details-shape', snap(one(r)),
    { pipelineId: 'checks.main', payload: { x: [{ v: 1 }, { v: 2 }] } },
    ERR([issue('ERROR', 'SE13', M, 'x[*].v', 'library.se.all', 'checks.main',
      { details: { mode: 'ALL', matched: 2, evaluated: 2, skipped: 0, passed: 0, failed: 2 } })]));
}
{
  const r = chk('library.se.cnt', 'greater_than', { code: 'SE14', field: 'x[*].v', value: 10, aggregate: { mode: 'COUNT', op: '>=', value: 2 } });
  evalFx('semantics', 'sem/aggregate-count-details-shape', snap(one(r)),
    { pipelineId: 'checks.main', payload: { x: [{ v: 11 }, { v: 2 }, { v: 3 }] } },
    ERR([issue('ERROR', 'SE14', M, 'x[*].v', 'library.se.cnt', 'checks.main',
      { details: { mode: 'COUNT', op: '>=', value: 2, matched: 3, evaluated: 3, skipped: 0, passed: 1, failed: 2 } })]));
}
evalFx('semantics', 'sem/aggregate-on-empty-default-skip',
  snap(one(chk('library.se.oe1', 'greater_than', { code: 'SE16', field: 'x[*].v', value: 10,
    aggregate: { mode: 'ALL', issueMode: 'EACH' } }))),
  { pipelineId: 'checks.main', payload: {} }, OKR);
{
  const r = chk('library.se.oe2', 'greater_than', { code: 'SE17', field: 'x[*].v', value: 10,
    aggregate: { mode: 'ALL', issueMode: 'EACH', onEmpty: 'FAIL' } });
  evalFx('semantics', 'sem/aggregate-on-empty-fail-summary', snap(one(r)),
    { pipelineId: 'checks.main', payload: {} },
    ERR([issue('ERROR', 'SE17', M, 'x[*].v', 'library.se.oe2', 'checks.main',
      { details: { mode: 'ALL', matched: 0, evaluated: 0, skipped: 0, passed: 0, failed: 0 } })]));
}
{
  const r = chk('library.se.hs', 'greater_than', { code: 'SE24', field: 'x[*].v', value: 10, level: 'EXCEPTION',
    aggregate: { mode: 'ALL', issueMode: 'EACH', onEmpty: 'FAIL' } });
  evalFx('semantics', 'sem/on-empty-fail-with-exception-level-composes-hard-stop', snap(one(r)),
    { pipelineId: 'checks.main', payload: {} },
    { status: 'EXCEPTION',
      issues: [issue('EXCEPTION', 'SE24', M, 'x[*].v', 'library.se.hs', 'checks.main',
        { details: { mode: 'ALL', matched: 0, evaluated: 0, skipped: 0, passed: 0, failed: 0 } })] });
}
{
  const r = chk('library.se.meta', 'not_empty', { code: 'SE18', field: 'a', meta: { ui: 'form1', docLink: 'https://intra/reg/17' } });
  evalFx('semantics', 'sem/author-meta-passthrough-verbatim', snap(one(r)),
    { pipelineId: 'checks.main', payload: {} },
    ERR([issue('ERROR', 'SE18', M, 'a', 'library.se.meta', 'checks.main',
      { meta: { ui: 'form1', docLink: 'https://intra/reg/17' } })]));
}
{
  const arts = [chk('library.se.ab', 'not_empty', { code: 'SE19', field: 'a' }), pipe('checks.main', [{ rule: 'library.se.ab' }])];
  evalFx('semantics', 'sem/abort-pipeline-not-found', snap(arts),
    { pipelineId: 'checks.nope', payload: { a: 1 } },
    { status: 'ABORT', issues: [], error: { code: 'PIPELINE_NOT_FOUND', details: { pipelineId: 'checks.nope' } } });
}
{
  const arts = [chk('library.se.ab2', 'not_empty', { code: 'SE20', field: 'a' }),
    pipe('checks.one', [{ rule: 'library.se.ab2' }]), pipe('checks.two', [{ rule: 'library.se.ab2' }])];
  evalFx('semantics', 'sem/abort-invalid-pipeline-id-missing', snap(arts),
    { payload: { a: 1 } },
    { status: 'ABORT', issues: [], error: { code: 'INVALID_PIPELINE_ID', details: { expected: 'non-empty string' } } },
    [], { keepMissingPipelineId: true });
}
{
  const arts = [chk('library.se.def', 'not_empty', { code: 'SE21', field: 'a' }), pipe('checks.main', [{ rule: 'library.se.def' }])];
  evalFx('semantics', 'sem/explicit-exported-pipeline-selection', snap(arts),
    { pipelineId: 'checks.main', payload: { a: 1 } }, OKR);
}
{
  const arts = [chk('library.se.sub', 'not_empty', { code: 'SE22', field: 'a' }),
    pipe('checks.inner', [{ rule: 'library.se.sub' }], { exported: false }),
    pipe('checks.main', [{ pipeline: 'checks.inner' }])];
  evalFx('semantics', 'sem/subpipeline-issue-attribution', snap(arts), { pipelineId: 'checks.main', payload: {} },
    ERR([issue('ERROR', 'SE22', M, 'a', 'library.se.sub', 'checks.inner')]));
  evalFx('semantics', 'sem/internal-pipeline-cannot-be-selected-directly', snap(arts),
    { pipelineId: 'checks.inner', payload: {} },
    { status: 'ABORT', issues: [], error: { code: 'PIPELINE_NOT_FOUND', details: { pipelineId: 'checks.inner' } } });
}
/* ---------------- rc.2: input types, invalid keys, depth bounds (D15, DR-IV) ---------------- */
{
  const base = () => snap(one(chk('library.i.r', 'not_empty', { code: 'I1', field: 'ok' })));
  const AB = (code, details) => ({ status: 'ABORT', issues: [], error: { code, details } });
  evalFx('d09-guards', 'd09/invalid-payload-null', base(), { pipelineId: 'checks.main', payload: null }, AB('INVALID_PAYLOAD', { expected: 'object' }));
  evalFx('d09-guards', 'd09/invalid-payload-array', base(), { pipelineId: 'checks.main', payload: [1, 2] }, AB('INVALID_PAYLOAD', { expected: 'object' }));
  evalFx('d09-guards', 'd09/invalid-context-string', base(), { pipelineId: 'checks.main', payload: { ok: 1 }, context: 'oops' }, AB('INVALID_CONTEXT', { expected: 'object' }));
  evalFx('d09-guards', 'd09/invalid-key-dot-at-root', base(), { pipelineId: 'checks.main', payload: { 'a.b': 1, ok: 1 } }, AB('INVALID_PAYLOAD_KEY', { parentPath: '', key: 'a.b' }));
  evalFx('d09-guards', 'd09/invalid-key-empty', base(), { pipelineId: 'checks.main', payload: { '': 1, ok: 1 } }, AB('INVALID_PAYLOAD_KEY', { parentPath: '', key: '' }));
  evalFx('d09-guards', 'd09/invalid-key-bracket-nested', base(), { pipelineId: 'checks.main', payload: { x: { 'a[0]': 1 }, ok: 1 } }, AB('INVALID_PAYLOAD_KEY', { parentPath: 'x', key: 'a[0]' }));
  evalFx('d09-guards', 'd09/dangerous-context-key', base(), { pipelineId: 'checks.main', payload: { ok: 1 }, context: JSON.parse('{"c":{"constructor":1}}') }, AB('DANGEROUS_CONTEXT_KEY', { parentPath: 'c', key: 'constructor' }));
  evalFx('d09-guards', 'd09/invalid-context-key', base(), { pipelineId: 'checks.main', payload: { ok: 1 }, context: { 'k.k': 1 } }, AB('INVALID_CONTEXT_KEY', { parentPath: '', key: 'k.k' }));
  evalFx('d09-guards', 'd09/invalid-key-hides-dangerous-subtree', base(), { pipelineId: 'checks.main', payload: JSON.parse('{"a.b":{"__proto__":1},"ok":1}') }, AB('INVALID_PAYLOAD_KEY', { parentPath: '', key: 'a.b' }));
  evalFx('d09-guards', 'd09/dangerous-precedes-invalid-when-both-visible', base(), { pipelineId: 'checks.main', payload: JSON.parse('{"z.z":1,"a":{"__proto__":1},"ok":1}') }, AB('DANGEROUS_PAYLOAD_KEY', { parentPath: 'a', key: '__proto__' }));
  evalFx('d09-guards', 'd09/depth-256-accepted', base(), { pipelineId: 'checks.main', payload: { ok: 1, d: deep(255) } }, OKR);
  evalFx('d09-guards', 'd09/context-too-deep', base(), { pipelineId: 'checks.main', payload: { ok: 1 }, context: { d: deep(256) } }, AB('CONTEXT_TOO_DEEP', { maxDepth: 256 }));
}

/* ---------------- rc.2: snapshot-level additions (DR-IV) ---------------- */
{
  const make = depth => {
    const s = snap(one(chk('library.x.deep', 'not_empty', { code: 'X12', field: 'a', meta: deep(depth - 4) })));
    if (jsonDepth(s) !== depth) throw new Error(`snapshot depth ${jsonDepth(s)} != ${depth}`);
    return s;
  };
  evalFx('d11-snapshot', 'd11/snapshot-depth-256-accepted', make(256),
    { pipelineId: 'checks.main', payload: { a: 1 } }, OKR);
  rejFx('d11-snapshot', 'd11/reject-snapshot-depth-257', make(257));
}
rejFx('d11-snapshot', 'd11/reject-unsupported-minor-version',
  snap(one(chk('library.x.mv', 'not_empty', { code: 'X13', field: 'a' })), { specVersion: '1.999.0' }));
rejFx('d11-snapshot', 'd11/reject-aggregate-without-wildcard',
  snap(one(chk('library.x.aw', 'greater_than', { code: 'X14', field: 'a', value: 1,
    aggregate: { mode: 'ALL', issueMode: 'EACH' } }))));
rejFx('d11-snapshot', 'd11/reject-unreachable-artifact',
  snap([chk('library.x.ok2', 'not_empty', { code: 'X15', field: 'a' }),
    { id: 'ghost.rule', type: 'rule', operator: 'not_empty', field: 'a',
      issue: { level: 'ERROR', code: 'X16', message: M } },
    pipe('checks.main', [{ rule: 'library.x.ok2' }])]));
rejFx('d11-snapshot', 'd11/reject-path-empty-segment',
  snap(one(chk('library.x.p1', 'not_empty', { code: 'X17', field: 'a..b' }))));
rejFx('d11-snapshot', 'd11/reject-path-leading-zero-index',
  snap(one(chk('library.x.p2', 'greater_than', { code: 'X18', field: 'a[01].v', value: 1 }))));
rejFx('d11-snapshot', 'd11/reject-value-field-wildcard',
  snap(one(chk('library.x.p3', 'field_equals_field', { code: 'X19', field: 'a', value_field: 'b[*].v' }))));
{
  const arts = [{ id: 'library.j.edge', type: 'rule',
    operator: 'equals', field: 'a', value: 1e21,
    issue: { level: 'ERROR', code: 'J1', message: 'JCS edge: "Пётр"\t\\backslash' } },
    pipe('checks.main', [{ rule: 'library.j.edge' }])];
  evalFx('d06-hash', 'd06/jcs-canonicalization-edge-values', snap(arts),
    { pipelineId: 'checks.main', payload: { a: 1e21 } }, OKR);
}

/* ---------------- rc.3: unified rule sites and reserved operators (D19) ---------------- */
{
  const hard = chk('library.d19.reusable', 'not_empty', { code: 'D19.1', field: 'trigger', level: 'EXCEPTION' });
  const target = chk('library.d19.target', 'not_empty', { code: 'D19.2', field: 'required' });
  const arts = [hard, target,
    { id: 'library.d19.condition', type: 'condition',
      when: 'library.d19.reusable', steps: [{ rule: 'library.d19.target' }] },
    pipe('checks.guard', [{ condition: 'library.d19.condition' }]),
    pipe('checks.hard', [{ rule: 'library.d19.reusable' }])];
  evalFx('d19-unified-rules', 'd19/issue-bearing-rule-is-silent-in-when', snap(arts),
    { pipelineId: 'checks.guard', payload: {} }, OKR);
  evalFx('d19-unified-rules', 'd19/same-rule-creates-exception-issue-in-step', snap(arts),
    { pipelineId: 'checks.hard', payload: {} },
    { status: 'EXCEPTION',
      issues: [issue('EXCEPTION', 'D19.1', M, 'trigger', 'library.d19.reusable', 'checks.hard')] });
}
{
  const noIssue = pred('library.d19.noissue', 'length_equals', { field: 'kind', value: 2 });
  const target = chk('library.d19.hit', 'not_empty', { code: 'D19.3', field: 'required' });
  const arts = [noIssue, target,
    { id: 'library.d19.noissue.condition', type: 'condition',
      when: 'library.d19.noissue', steps: [{ rule: 'library.d19.hit' }] },
    pipe('checks.main', [{ condition: 'library.d19.noissue.condition' }])];
  evalFx('d19-unified-rules', 'd19/rule-without-issue-is-valid-in-when', snap(arts),
    { pipelineId: 'checks.main', payload: { kind: 'AB' } },
    ERR([issue('ERROR', 'D19.3', M, 'required', 'library.d19.hit', 'checks.main')]));
}
{
  const any = pred('library.d19.any', 'any_filled', { fields: ['email', 'phone'] });
  const nt = pred('library.d19.nottrue', 'not_true', { field: 'blocked' });
  const target = chk('library.d19.allowed', 'not_empty', { code: 'D19.4', field: 'required' });
  const arts = [any, nt, target,
    { id: 'library.d19.formerly-blocked', type: 'condition',
      when: { all: [any.id, nt.id] }, steps: [{ rule: target.id }] },
    pipe('checks.main', [{ condition: 'library.d19.formerly-blocked' }])];
  evalFx('d19-unified-rules', 'd19/all-builtins-are-usable-in-when', snap(arts),
    { pipelineId: 'checks.main', payload: { email: 'x@example.test' } },
    ERR([issue('ERROR', 'D19.4', M, 'required', target.id, 'checks.main')]));
}
{
  const runFault = (name, op, site, code) => {
    const r = site === 'step' ? chk('library.co.r', op, { code: 'CO1' }) : pred('library.co.r', op);
    const artifacts = site === 'step'
      ? one(r)
      : [r, chk('library.co.after', 'not_empty', { code: 'CO2', field: 'b' }),
          { id: 'library.co.cond', type: 'condition', when: r.id, steps: [{ rule: 'library.co.after' }] },
          pipe('checks.main', [{ condition: 'library.co.cond' }])];
    evalFx('d10-operators', name, snap(artifacts),
      { pipelineId: 'checks.main', payload: {} },
      { status: 'ABORT', issues: [], error: { code, details: { ruleId: r.id, operator: op } } }, [op]);
  };
  runFault('d10/conformance-rule-throw-in-step-operator-fault', 'conformance.rule.throw', 'step', 'OPERATOR_FAULT');
  runFault('d10/conformance-rule-throw-in-when-operator-fault', 'conformance.rule.throw', 'when', 'OPERATOR_FAULT');
  runFault('d10/conformance-rule-invalid-result-in-step-contract-violation', 'conformance.rule.invalid_result', 'step', 'OPERATOR_CONTRACT_VIOLATION');
  runFault('d10/conformance-rule-invalid-result-in-when-contract-violation', 'conformance.rule.invalid_result', 'when', 'OPERATOR_CONTRACT_VIOLATION');
}

/* ---------------- rc.3: unified wildcard aggregation (D20) ---------------- */
{
  const op = 'conformance.rule.tri';
  const tri = (id, aggregate, code) => chk(id, op, { code, field: 'items[*].result', aggregate });
  const payload = { items: [{ result: 'PASS' }, { result: 'SKIP' }, { result: 'FAIL' }] };

  const eachAll = tri('library.d20.all.each', { mode: 'ALL', issueMode: 'EACH' }, 'D20.1');
  evalFx('d20-aggregation', 'd20/all-each-ignores-skip-and-reports-failures',
    snap(one(eachAll)), { pipelineId: 'checks.main', payload },
    ERR([issue('ERROR', 'D20.1', M, 'items[2].result', eachAll.id, 'checks.main', { actual: 'FAIL' })]), [op]);

  const anyPass = tri('library.d20.any.pass', { mode: 'ANY', issueMode: 'EACH' }, 'D20.2');
  evalFx('d20-aggregation', 'd20/any-each-pass-emits-no-partial-issues',
    snap(one(anyPass)), { pipelineId: 'checks.main', payload }, OKR, [op]);

  const anyFail = tri('library.d20.any.fail', { mode: 'ANY', issueMode: 'EACH' }, 'D20.2F');
  evalFx('d20-aggregation', 'd20/any-each-reports-fails-only-when-none-pass',
    snap(one(anyFail)),
    { pipelineId: 'checks.main', payload: { items: [{ result: 'SKIP' }, { result: 'FAIL' }] } },
    ERR([issue('ERROR', 'D20.2F', M, 'items[1].result', anyFail.id, 'checks.main', { actual: 'FAIL' })]), [op]);

  const allSummary = tri('library.d20.all.summary', { mode: 'ALL', issueMode: 'SUMMARY' }, 'D20.3');
  evalFx('d20-aggregation', 'd20/all-summary-exposes-effective-population',
    snap(one(allSummary)), { pipelineId: 'checks.main', payload },
    ERR([issue('ERROR', 'D20.3', M, 'items[*].result', allSummary.id, 'checks.main',
      { details: { mode: 'ALL', matched: 3, evaluated: 2, skipped: 1, passed: 1, failed: 1 } })]), [op]);

  const count = tri('library.d20.count', { mode: 'COUNT', op: '>=', value: 2 }, 'D20.4');
  evalFx('d20-aggregation', 'd20/count-excludes-skip-from-population',
    snap(one(count)), { pipelineId: 'checks.main', payload },
    ERR([issue('ERROR', 'D20.4', M, 'items[*].result', count.id, 'checks.main',
      { details: { mode: 'COUNT', op: '>=', value: 2, matched: 3, evaluated: 2, skipped: 1, passed: 1, failed: 1 } })]), [op]);

  const allSkip = tri('library.d20.skip', { mode: 'ALL', issueMode: 'SUMMARY', onEmpty: 'FAIL' }, 'D20.5');
  evalFx('d20-aggregation', 'd20/all-skip-propagates-skip-not-on-empty-fail',
    snap(one(allSkip)),
    { pipelineId: 'checks.main', payload: { items: [{ result: 'SKIP' }, { result: 'SKIP' }] } }, OKR, [op]);

  const empty = tri('library.d20.empty', { mode: 'ANY', issueMode: 'SUMMARY', onEmpty: 'FAIL' }, 'D20.6');
  evalFx('d20-aggregation', 'd20/structural-empty-applies-on-empty-fail',
    snap(one(empty)), { pipelineId: 'checks.main', payload: {} },
    ERR([issue('ERROR', 'D20.6', M, 'items[*].result', empty.id, 'checks.main',
      { details: { mode: 'ANY', matched: 0, evaluated: 0, skipped: 0, passed: 0, failed: 0 } })]), [op]);

  const countEmpty = tri('library.d20.count-empty', { mode: 'COUNT', op: '>=', value: 1, onEmpty: 'FAIL' }, 'D20.7');
  evalFx('d20-aggregation', 'd20/count-on-empty-fail-omits-op-and-value-details',
    snap(one(countEmpty)), { pipelineId: 'checks.main', payload: {} },
    ERR([issue('ERROR', 'D20.7', M, 'items[*].result', countEmpty.id, 'checks.main',
      { details: { mode: 'COUNT', matched: 0, evaluated: 0, skipped: 0, passed: 0, failed: 0 } })]), [op]);

  for (const [name, mode, values] of [
    ['any-pass-still-evaluates-later-throw', 'ANY', ['PASS', 'THROW']],
    ['all-fail-still-evaluates-later-throw', 'ALL', ['FAIL', 'THROW']],
    ['count-still-evaluates-later-throw', 'COUNT', ['PASS', 'THROW']],
  ]) {
    const aggregate = mode === 'COUNT'
      ? { mode, op: '>=', value: 1 }
      : { mode, issueMode: 'SUMMARY' };
    const r = tri(`library.d20.${name}`, aggregate, `D20.${name}`);
    evalFx('d20-aggregation', `d20/${name}`, snap(one(r)),
      { pipelineId: 'checks.main', payload: { items: values.map(result => ({ result })) } },
      { status: 'ABORT', issues: [], error: { code: 'OPERATOR_FAULT', details: { ruleId: r.id, operator: op } } }, [op]);
  }

  const atomic = tri('library.d20.exception-each', { mode: 'ALL', issueMode: 'EACH' }, 'D20.8');
  atomic.issue.level = 'EXCEPTION';
  const after = chk('library.d20.after-exception', 'not_empty', { code: 'D20.9', field: 'required' });
  evalFx('d20-aggregation', 'd20/each-exception-materializes-all-current-rule-issues-before-stop',
    snap([atomic, after, pipe('checks.main', [atomic.id, after.id])]),
    { pipelineId: 'checks.main', payload: { items: [{ result: 'FAIL' }, { result: 'FAIL' }] } },
    { status: 'EXCEPTION', issues: [
      issue('EXCEPTION', 'D20.8', M, 'items[0].result', atomic.id, 'checks.main', { actual: 'FAIL' }),
      issue('EXCEPTION', 'D20.8', M, 'items[1].result', atomic.id, 'checks.main', { actual: 'FAIL' }),
    ] }, [op]);
}

rejFx('d11-snapshot', 'd11/reject-wildcard-without-aggregate',
  snap(one(chk('library.d20.bad1', 'greater_than', { code: 'D20.X1', field: 'x[*].v', value: 1 }))));
rejFx('d11-snapshot', 'd11/reject-all-with-issue-without-issue-mode',
  snap(one(chk('library.d20.bad2', 'greater_than', { code: 'D20.X2', field: 'x[*].v', value: 1, aggregate: { mode: 'ALL' } }))));
rejFx('d11-snapshot', 'd11/reject-issue-mode-without-issue',
  snap([pred('library.d20.bad3', 'greater_than', { field: 'x[*].v', value: 1, aggregate: { mode: 'ALL', issueMode: 'EACH' } }),
    chk('library.d20.ok', 'not_empty', { code: 'D20.X3', field: 'a' }), pipe('checks.main', [{ rule: 'library.d20.ok' }])]));
rejFx('d11-snapshot', 'd11/reject-issue-mode-on-count',
  snap(one(chk('library.d20.bad4', 'greater_than', { code: 'D20.X4', field: 'x[*].v', value: 1,
    aggregate: { mode: 'COUNT', op: '>=', value: 1, issueMode: 'SUMMARY' } }))));
rejFx('d11-snapshot', 'd11/reject-legacy-each-aggregate-mode',
  snap(one(chk('library.d20.bad5', 'greater_than', { code: 'D20.X5', field: 'x[*].v', value: 1,
    aggregate: { mode: 'EACH', issueMode: 'EACH' } }))));

/* ---------------- rc.4: exact ids, exports, closure, and closed schemas (D21, D24) ---------------- */
{
  const r = chk('rule', 'not_empty', { code: 'D21.1', field: 'a' });
  evalFx('d21-bundle', 'd21/opaque-ids-resolve-by-exact-equality',
    snap([r, pipe('pipeline', [{ rule: 'rule' }])]),
    { pipelineId: 'pipeline', payload: { a: 1 } }, OKR);
}
{
  const s = snap(one(chk('library.d21.missing', 'not_empty', { code: 'D21.X1', field: 'a' })));
  delete s.exports;
  rejFx('d21-bundle', 'd21/reject-missing-exports', rehash(s));
}
rejFx('d21-bundle', 'd21/reject-empty-exports',
  snap(one(chk('library.d21.empty', 'not_empty', { code: 'D21.X2', field: 'a' })), { exports: [] }));
{
  const s = snap(one(chk('library.d21.object', 'not_empty', { code: 'D21.X2O', field: 'a' })));
  s.exports = { pipelines: ['checks.main'] };
  rejFx('d21-bundle', 'd21/reject-legacy-exports-object', rehash(s));
}
rejFx('d21-bundle', 'd21/reject-duplicate-export',
  snap(one(chk('library.d21.dup', 'not_empty', { code: 'D21.X3', field: 'a' })),
    { exports: ['checks.main', 'checks.main'] }));
rejFx('d21-bundle', 'd21/reject-export-of-non-pipeline',
  snap(one(chk('library.d21.rule-export', 'not_empty', { code: 'D21.X4', field: 'a' })),
    { exports: ['library.d21.rule-export'] }));
rejFx('d21-bundle', 'd21/reject-export-of-missing-id',
  snap(one(chk('library.d21.missing-export', 'not_empty', { code: 'D21.X5', field: 'a' })),
    { exports: ['checks.nope'] }));
rejFx('d21-bundle', 'd21/reject-legacy-artifact-description',
  snap(one({ ...chk('library.d21.desc', 'not_empty', { code: 'D21.X6', field: 'a' }), description: 'authoring only' })));
rejFx('d21-bundle', 'd21/reject-legacy-pipeline-entrypoint',
  snap([chk('library.d21.ep', 'not_empty', { code: 'D21.X7', field: 'a' }),
    pipe('checks.main', [{ rule: 'library.d21.ep' }], { x: { entrypoint: true } })]));
{
  const p = pred('library.d21.guard', 'equals', { field: 'go', value: true });
  const hit = chk('library.d21.hit', 'not_empty', { code: 'D21.X8', field: 'a' });
  const c1 = { id: 'c1', type: 'condition', when: p.id, steps: [{ condition: 'c2' }] };
  const c2 = { id: 'c2', type: 'condition', when: p.id, steps: [{ condition: 'c1' }] };
  rejFx('d21-bundle', 'd21/reject-condition-cycle',
    snap([p, hit, c1, c2, pipe('checks.main', [{ condition: 'c1' }, { rule: hit.id }])]));
}
{
  const p = pred('library.d21.mixed.guard', 'equals', { field: 'go', value: true });
  const c = { id: 'mixed.condition', type: 'condition', when: p.id, steps: [{ pipeline: 'checks.main' }] };
  rejFx('d21-bundle', 'd21/reject-mixed-pipeline-condition-cycle',
    snap([p, c, pipe('checks.main', [{ condition: c.id }])]));
}
{
  const s = snap(one(chk('library.d24.envelope', 'not_empty', { code: 'D24.X1', field: 'a' })));
  s.unknown = true;
  rejFx('d24-closed-schemas', 'd24/reject-unknown-snapshot-field', rehash(s));
}
{
  const op = 'conformance.rule.params';
  const r = chk('library.d24.params', op, { code: 'D24.1', params: { outcome: 'PASS' } });
  evalFx('d24-closed-schemas', 'd24/custom-params-schema-valid-and-delivered',
    snap(one(r)),
    { pipelineId: 'checks.main', payload: {} }, OKR, [op]);
  rejFx('d24-closed-schemas', 'd24/reject-custom-params-schema-mismatch',
    snap(one(chk('library.d24.params.bad', op, { code: 'D24.X2', params: { result: 'PASS' } }))), undefined, [op]);

  const fail = chk('library.d24.params.fail', op, { code: 'D24.2', params: { outcome: 'FAIL' } });
  evalFx('d24-closed-schemas', 'd24/custom-operator-without-field-uses-null-issue-field',
    snap(one(fail)), { pipelineId: 'checks.main', payload: {} },
    ERR([issue('ERROR', 'D24.2', M, null, fail.id, 'checks.main')]), [op]);

  rejFx('d24-closed-schemas', 'd24/reject-standard-field-not-accepted-by-params-operator',
    snap(one(chk('library.d24.params.field', op, { code: 'D24.X2F', field: 'a', params: { outcome: 'PASS' } }))),
    undefined, [op]);
  rejFx('d24-closed-schemas', 'd24/reject-fields-on-custom-operator',
    snap(one(chk('library.d24.params.fields', op, { code: 'D24.X2FS', fields: ['a'], params: { outcome: 'PASS' } }))),
    undefined, [op]);
}
rejFx('d24-closed-schemas', 'd24/reject-value-and-value-field-together',
  snap(one(chk('library.d24.both-values', 'equals', {
    code: 'D24.X2V', field: 'a', value: 1, value_field: 'b'
  }))));
rejFx('d24-closed-schemas', 'd24/reject-operand-on-throw-conformance-operator',
  snap(one(chk('library.d24.throw-field', 'conformance.rule.throw', { code: 'D24.X2T', field: 'a' }))),
  undefined, ['conformance.rule.throw']);
rejFx('d24-closed-schemas', 'd24/reject-missing-field-on-tri-conformance-operator',
  snap(one(chk('library.d24.tri-no-field', 'conformance.rule.tri', { code: 'D24.X2TR' }))),
  undefined, ['conformance.rule.tri']);
rejFx('d24-closed-schemas', 'd24/reject-params-on-built-in',
  snap(one(chk('library.d24.builtin', 'not_empty', { code: 'D24.X3', field: 'a', params: { outcome: 'PASS' } }))));
rejFx('d24-closed-schemas', 'd24/reject-empty-operator-name',
  snap(one(chk('library.d24.empty-operator', '', { code: 'D24.X3E', field: 'a' }))));
{
  const op = 'conformance.rule.params';
  const s = snap(one(chk('library.d24.requires', op, { code: 'D24.X4', params: { outcome: 'PASS' } })));
  s.requires = { operators: [op] };
  rejFx('d24-closed-schemas', 'd24/reject-legacy-requires-field', rehash(s), undefined, [op]);
}
rejFx('d24-closed-schemas', 'd24/reject-unknown-aggregate-field',
  snap(one(chk('library.d24.aggregate', 'greater_than', { code: 'D24.X5', field: 'x[*].v', value: 1,
    aggregate: { mode: 'ALL', issueMode: 'EACH', unknown: true } }))));
{
  const d = { id: 'dictionary', type: 'dictionary', entries: ['X'] };
  const r = chk('library.d24.dictref', 'in_dictionary', { code: 'D24.X6', field: 'a',
    dictionary: { type: 'static', id: d.id, unknown: true } });
  rejFx('d24-closed-schemas', 'd24/reject-unknown-dictionary-reference-field', snap([d, r, pipe('checks.main', [{ rule: r.id }])]));
}
{
  const d = { id: 'dictionary', type: 'dictionary', entries: [{ code: 'X', unknown: true }] };
  const r = chk('library.d24.dictentry', 'in_dictionary', { code: 'D24.X7', field: 'a', dictionary: { type: 'static', id: d.id } });
  rejFx('d24-closed-schemas', 'd24/reject-unknown-dictionary-entry-field', snap([d, r, pipe('checks.main', [{ rule: r.id }])]));
}
{
  const p = pred('library.d24.when.p', 'equals', { field: 'go', value: true });
  const hit = chk('library.d24.when.hit', 'not_empty', { code: 'D24.X8', field: 'a' });
  const c = { id: 'condition', type: 'condition', when: { all: [p.id], unknown: true }, steps: [{ rule: hit.id }] };
  rejFx('d24-closed-schemas', 'd24/reject-unknown-when-field', snap([p, hit, c, pipe('checks.main', [{ condition: c.id }])]));
}
{
  const r = chk('library.d24.step', 'not_empty', { code: 'D24.X9', field: 'a' });
  const s = snap([r, pipe('checks.main', [r.id])]);
  s.artifacts['checks.main'].steps = [{ rule: r.id, unknown: true }];
  rejFx('d24-closed-schemas', 'd24/reject-unknown-step-field', rehash(s));
}

/* ---------------- rc.4: mandatory short-circuit evaluation (D22) ---------------- */
{
  const run = (name, kind, firstPass, shouldAbort) => {
    const first = pred(`library.d22.${name}.first`, 'equals', { field: 'first', value: true });
    const throwing = pred(`library.d22.${name}.throw`, 'conformance.rule.throw');
    const target = chk(`library.d22.${name}.target`, 'not_empty', { code: `D22.${name}`, field: 'required' });
    const condition = { id: `condition.${name}`, type: 'condition', when: { [kind]: [first.id, throwing.id] }, steps: [{ rule: target.id }] };
    const snapshot = snap([first, throwing, target, condition, pipe('checks.main', [{ condition: condition.id }])]);
    const expected = shouldAbort
      ? { status: 'ABORT', issues: [], error: { code: 'OPERATOR_FAULT', details: { ruleId: throwing.id, operator: 'conformance.rule.throw' } } }
      : OKR;
    evalFx('d22-evaluation', `d22/${name}`, snapshot,
      { pipelineId: 'checks.main', payload: { first: firstPass, required: 'ok' } }, expected,
      ['conformance.rule.throw']);
  };
  run('any-pass-does-not-evaluate-throw', 'any', true, false);
  run('all-fail-does-not-evaluate-throw', 'all', false, false);
  run('any-fail-evaluates-throw', 'any', false, true);
  run('all-pass-evaluates-throw', 'all', true, true);
}
{
  const first = chk('library.d22.issue-before-abort', 'not_empty', { code: 'D22.ABORT.1', field: 'missing' });
  const throwing = chk('library.d22.throw-after-issue', 'conformance.rule.throw', { code: 'D22.ABORT.2' });
  evalFx('d22-evaluation', 'd22/abort-discards-previous-business-issues',
    snap([first, throwing, pipe('checks.main', [first.id, throwing.id])]),
    { pipelineId: 'checks.main', payload: {} },
    { status: 'ABORT', issues: [], error: { code: 'OPERATOR_FAULT',
      details: { ruleId: throwing.id, operator: 'conformance.rule.throw' } } },
    ['conformance.rule.throw']);
}
/* ---------------- rc.4: finite binary64 model (D23) ---------------- */
evalFx('d23-binary64', 'd23/decimal-fraction-is-accepted',
  snap(one(chk('library.d23.fraction', 'equals', { code: 'D23.1', field: 'a', value: 0.1 }))),
  { pipelineId: 'checks.main', payload: { a: 0.1 } }, OKR);
{
  const name = 'd23/unsafe-integer-token-rounds-to-binary64';
  evalFx('d23-binary64', name,
    snap(one(chk('library.d23.round', 'equals', { code: 'D23.2', field: 'a', value: 9007199254740992 }))),
    { pipelineId: 'checks.main', payload: { a: '__RAW_UNSAFE_INTEGER__' } }, OKR);
  raw(name, [['__RAW_UNSAFE_INTEGER__', '9007199254740993']]);
}
{
  const r = chk('library.d23.string', 'greater_than', { code: 'D23.3', field: 'a', value: 0 });
  evalFx('d23-binary64', 'd23/overflowing-numeric-string-is-unclassified', snap(one(r)),
    { pipelineId: 'checks.main', payload: { a: '1e400' } },
    ERR([issue('ERROR', 'D23.3', M, 'a', r.id, 'checks.main', { expected: 0, actual: '1e400' })]));
}
{
  const name = 'd23/payload-overflow-aborts';
  evalFx('d23-binary64', name,
    snap(one(chk('library.d23.payload', 'not_empty', { code: 'D23.4', field: 'a' }))),
    { pipelineId: 'checks.main', payload: { a: '__RAW_PAYLOAD_OVERFLOW__' } },
    { status: 'ABORT', issues: [], error: { code: 'INVALID_PAYLOAD_NUMBER', details: { path: 'a' } } });
  raw(name, [['__RAW_PAYLOAD_OVERFLOW__', '1e400']]);
}
{
  const name = 'd23/context-overflow-aborts';
  evalFx('d23-binary64', name,
    snap(one(chk('library.d23.context', 'not_empty', { code: 'D23.5', field: 'a' }))),
    { pipelineId: 'checks.main', payload: { a: 1 }, context: { rate: '__RAW_CONTEXT_OVERFLOW__' } },
    { status: 'ABORT', issues: [], error: { code: 'INVALID_CONTEXT_NUMBER', details: { path: 'rate' } } });
  raw(name, [['__RAW_CONTEXT_OVERFLOW__', '-1e400']]);
}
{
  const name = 'd23/reject-snapshot-number-overflow';
  rejFx('d23-binary64', name,
    snap(one(chk('library.d23.snapshot', 'equals', { code: 'D23.X1', field: 'a', value: '__RAW_SNAPSHOT_OVERFLOW__' }))));
  raw(name, [['__RAW_SNAPSHOT_OVERFLOW__', '1e400']]);
}

/* ---------------- rc.5: compact format and invocation boundary (D26-D30) ---------------- */
{
  const s = snap(one(chk('library.d26.array', 'not_empty', { code: 'D26.X1', field: 'a' })));
  s.artifacts = Object.entries(s.artifacts).map(([id, artifact]) => ({ id, ...artifact }));
  rejFx('d26-format', 'd26/reject-legacy-artifacts-array', rehash(s));
}
{
  const s = snap(one(chk('library.d26.id', 'not_empty', { code: 'D26.X2', field: 'a' })));
  s.artifacts['library.d26.id'].id = 'library.d26.id';
  rejFx('d26-format', 'd26/reject-repeated-id-in-artifact-value', rehash(s));
}
{
  const r = chk('library.d26.object-step', 'not_empty', { code: 'D26.X3', field: 'a' });
  const s = snap(one(r));
  s.artifacts['checks.main'].steps = [{ rule: r.id }];
  rejFx('d26-format', 'd26/reject-legacy-object-step', rehash(s));
}
{
  const r = chk('library.d26.step-id', 'not_empty', { code: 'D26.X4', field: 'a' });
  const s = snap(one(r));
  s.artifacts['checks.main'].steps = [{ rule: r.id, stepId: 'legacy' }];
  rejFx('d26-format', 'd26/reject-legacy-step-id', rehash(s));
}
{
  const r = chk('library.d26.flow', 'not_empty', { code: 'D26.X5', field: 'a' });
  const s = snap(one(r));
  delete s.artifacts['checks.main'].steps;
  s.artifacts['checks.main'].flow = [r.id];
  rejFx('d26-format', 'd26/reject-legacy-pipeline-flow', rehash(s));
}
{
  const s = snap(one(chk('library.d29.strict', 'not_empty', { code: 'D29.X1', field: 'a' })));
  s.artifacts['checks.main'].strict = false;
  rejFx('d29-removed', 'd29/reject-legacy-pipeline-strict', rehash(s));
}
rejFx('d29-removed', 'd29/reject-legacy-min-aggregate',
  snap(one(chk('library.d29.min', 'greater_than', { code: 'D29.X2', field: 'x[*].v', value: 1,
    aggregate: { mode: 'MIN' } }))));
rejFx('d29-removed', 'd29/reject-legacy-max-aggregate',
  snap(one(chk('library.d29.max', 'greater_than', { code: 'D29.X3', field: 'x[*].v', value: 1,
    aggregate: { mode: 'MAX' } }))));
rejFx('d26-format', 'd26/reject-duplicate-dictionary-scalar',
  snap([{ id: 'dictionary', type: 'dictionary', entries: ['RU', 'RU'] },
    chk('library.d26.dictionary', 'in_dictionary', { code: 'D26.X6', field: 'country', dictionary: 'dictionary' }),
    pipe('checks.main', ['library.d26.dictionary'])]));
rejFx('d02-length', 'd02/reject-negative-length',
  snap(one(chk('library.length.negative', 'length_max', { code: 'L.X1', field: 'a', value: -1 }))));
rejFx('d02-length', 'd02/reject-fractional-length',
  snap(one(chk('library.length.fraction', 'length_equals', { code: 'L.X2', field: 'a', value: 1.5 }))));

{
  const op = 'conformance.rule.inputs';
  const valid = chk('library.d27.inputs', op, { code: 'D27.1',
    inputs: { missing: 'absent.path', nullValue: 'presentNull' } });
  evalFx('d27-inputs', 'd27/missing-path-omits-key-null-path-preserves-null',
    snap(one(valid)), { pipelineId: 'checks.main', payload: { presentNull: null } }, OKR, [op]);
  rejFx('d27-inputs', 'd27/reject-missing-required-input-name',
    snap(one(chk('library.d27.missing-name', op, { code: 'D27.X1', inputs: { missing: 'absent.path' } }))),
    undefined, [op]);
  rejFx('d27-inputs', 'd27/reject-unknown-input-name',
    snap(one(chk('library.d27.unknown-name', op, { code: 'D27.X2',
      inputs: { missing: 'absent.path', nullValue: 'presentNull', extra: 'x' } }))), undefined, [op]);
  rejFx('d27-inputs', 'd27/reject-invalid-input-path',
    snap(one(chk('library.d27.bad-path', op, { code: 'D27.X3',
      inputs: { missing: 'a..b', nullValue: 'presentNull' } }))), undefined, [op]);
  rejFx('d27-inputs', 'd27/reject-wildcard-input-path',
    snap(one(chk('library.d27.wildcard', op, { code: 'D27.X4',
      inputs: { missing: 'items[*].value', nullValue: 'presentNull' } }))), undefined, [op]);
}

{
  const op = 'conformance.rule.tri';
  const r = chk('library.d27.standard-absence', op, { code: 'D27.2', field: 'absent' });
  evalFx('d27-inputs', 'd27/custom-standard-field-absence-skips-before-invocation',
    snap(one(r)), { pipelineId: 'checks.main', payload: {} }, OKR, [op]);
}

{
  const s = snap(one(chk('library.d28.meta', 'not_empty', { code: 'D28.X1', field: 'a' })));
  s.meta = { projectId: 'legacy' };
  rejFx('d28-hash', 'd28/reject-snapshot-meta', rehash(s));
}
{
  const r = chk('library.d28.issue-meta', 'not_empty', { code: 'D28.1', field: 'a', meta: { owner: 'risk' } });
  const withMeta = snap(one(r));
  const withoutMeta = snap(one(chk('library.d28.issue-meta', 'not_empty', { code: 'D28.1', field: 'a' })));
  if (withMeta.sourceHash === withoutMeta.sourceHash) throw new Error('issue.meta did not affect sourceHash');
  evalFx('d28-hash', 'd28/issue-meta-is-hashed-and-passed-through', withMeta,
    { pipelineId: 'checks.main', payload: {} },
    ERR([issue('ERROR', 'D28.1', M, 'a', r.id, 'checks.main', { meta: { owner: 'risk' } })]));
}
{
  const astral = '\u{10000}';
  const bmp = '\uE000';
  const r = chk('shared.rule', 'not_empty', { code: 'D28.2', field: 'a' });
  const arts = [r, pipe(astral, [r.id]), pipe(bmp, [r.id])];
  const valid = snap(arts);
  if (valid.exports[0] !== astral || valid.exports[1] !== bmp) throw new Error('UTF-16 export order is wrong');
  evalFx('d28-hash', 'd28/jcs-utf16-orders-u10000-before-ue000', valid,
    { pipelineId: astral, payload: { a: 1 } }, OKR);
  rejFx('d28-hash', 'd28/reject-unsorted-exports',
    snap(arts, { exports: [bmp, astral], sortExports: false }));
}

{
  const valid = snap(one(chk('library.d28.duplicate', 'not_empty', { code: 'D28.X2', field: 'a' })));
  const text = JSON.stringify(valid).replace(
    '{"format":"jsonspecs-snapshot",',
    '{"format":"jsonspecs-snapshot","format":"jsonspecs-snapshot",');
  rawSnapshotFx('d28-hash', 'd28/reject-duplicate-json-member', text);
}
{
  const validExceptUnicode = snap(one(chk('library.d28.surrogate', 'not_empty', {
    code: 'D28.X3', field: 'a', message: '\uD800'
  })));
  rawSnapshotFx('d28-hash', 'd28/reject-lone-surrogate', JSON.stringify(validExceptUnicode));
}

/* ---------------- complete built-in operator outcome matrix ---------------- */
{
  const cases = [
    { op: 'not_empty', pass: { a: 'x' }, fail: {}, failExtra: {} },
    { op: 'is_empty', pass: {}, fail: { a: 0 }, failExtra: { actual: 0 } },
    { op: 'not_true', pass: { a: false }, fail: { a: true }, failExtra: { actual: true } },
    { op: 'any_filled', rule: { fields: ['a', 'b'] }, pass: { b: 'x' }, fail: {}, field: null, failExtra: {} },
    { op: 'is_boolean', pass: { a: true }, fail: { a: 1 }, skip: true, failExtra: { actual: 1 } },
    { op: 'is_string', pass: { a: 'x' }, fail: { a: 1 }, skip: true, failExtra: { actual: 1 } },
    { op: 'is_number', pass: { a: 1 }, fail: { a: '1' }, skip: true, failExtra: { actual: '1' } },
    { op: 'is_integer', pass: { a: 1 }, fail: { a: 1.5 }, skip: true, failExtra: { actual: 1.5 } },
    { op: 'equals', rule: { value: 1 }, pass: { a: 1 }, fail: { a: 2 }, skip: true, failExtra: { expected: 1, actual: 2 } },
    { op: 'not_equals', rule: { value: 1 }, pass: { a: 2 }, fail: { a: 1 }, skip: true, failExtra: { expected: 1, actual: 1 } },
    { op: 'contains', rule: { value: 'x' }, pass: { a: 'ax' }, fail: { a: 'ay' }, skip: true, failExtra: { expected: 'x', actual: 'ay' } },
    { op: 'matches_regex', rule: { value: '^x$' }, pass: { a: 'x' }, fail: { a: 'y' }, skip: true, failExtra: { expected: '^x$', actual: 'y' } },
    { op: 'not_matches_regex', rule: { value: '^x$' }, pass: { a: 'y' }, fail: { a: 'x' }, skip: true, failExtra: { expected: '^x$', actual: 'x' } },
    { op: 'greater_than', rule: { value: 1 }, pass: { a: 2 }, fail: { a: 1 }, skip: true, failExtra: { expected: 1, actual: 1 } },
    { op: 'less_than', rule: { value: 1 }, pass: { a: 0 }, fail: { a: 1 }, skip: true, failExtra: { expected: 1, actual: 1 } },
    { op: 'length_equals', rule: { value: 2 }, pass: { a: 'ab' }, fail: { a: 'a' }, skip: true, failExtra: { expected: 2, actual: 'a' } },
    { op: 'length_max', rule: { value: 2 }, pass: { a: 'ab' }, fail: { a: 'abc' }, skip: true, failExtra: { expected: 2, actual: 'abc' } },
    { op: 'field_equals_field', rule: { value_field: 'b' }, pass: { a: 1, b: 1 }, fail: { a: 1, b: 2 }, skip: true, failExtra: { expected: 2, actual: 1 } },
    { op: 'field_not_equals_field', rule: { value_field: 'b' }, pass: { a: 1, b: 2 }, fail: { a: 1, b: 1 }, skip: true, failExtra: { expected: 1, actual: 1 } },
    { op: 'field_greater_than_field', rule: { value_field: 'b' }, pass: { a: 2, b: 1 }, fail: { a: 1, b: 2 }, skip: true, failExtra: { expected: 2, actual: 1 } },
    { op: 'field_less_than_field', rule: { value_field: 'b' }, pass: { a: 1, b: 2 }, fail: { a: 2, b: 1 }, skip: true, failExtra: { expected: 1, actual: 2 } },
    { op: 'field_greater_or_equal_than_field', rule: { value_field: 'b' }, pass: { a: 1, b: 1 }, fail: { a: 0, b: 1 }, skip: true, failExtra: { expected: 1, actual: 0 } },
    { op: 'field_less_or_equal_than_field', rule: { value_field: 'b' }, pass: { a: 1, b: 1 }, fail: { a: 2, b: 1 }, skip: true, failExtra: { expected: 1, actual: 2 } },
    { op: 'in_dictionary', rule: { dictionary: 'matrix.dictionary' }, dictionary: true, pass: { a: 'A' }, fail: { a: 'B' }, skip: true, failExtra: { expected: 'matrix.dictionary', actual: 'B' } },
    { op: 'not_in_dictionary', rule: { dictionary: 'matrix.dictionary' }, dictionary: true, pass: { a: 'B' }, fail: { a: 'A' }, skip: true, failExtra: { expected: 'matrix.dictionary', actual: 'A' } },
  ];

  for (const c of cases) {
    const code = `BUILTIN.${c.op}`;
    const ruleOptions = { code, ...(c.op === 'any_filled' ? {} : { field: 'a' }), ...(c.rule ?? {}) };
    const makeSnapshot = () => {
      const r = chk(`builtin.${c.op}`, c.op, ruleOptions);
      const artifacts = c.dictionary
        ? [{ id: 'matrix.dictionary', type: 'dictionary', entries: ['A'] }, r, pipe('checks.main', [r.id])]
        : one(r);
      return { r, snapshot: snap(artifacts) };
    };

    {
      const { snapshot } = makeSnapshot();
      evalFx('operators', `operators/${c.op}-pass`, snapshot,
        { pipelineId: 'checks.main', payload: c.pass }, OKR);
    }
    {
      const { r, snapshot } = makeSnapshot();
      evalFx('operators', `operators/${c.op}-fail`, snapshot,
        { pipelineId: 'checks.main', payload: c.fail },
        ERR([issue('ERROR', code, M, c.field === null ? null : 'a', r.id, 'checks.main', c.failExtra)]));
    }
    if (c.skip) {
      const { snapshot } = makeSnapshot();
      evalFx('operators', `operators/${c.op}-skip`, snapshot,
        { pipelineId: 'checks.main', payload: {} }, OKR);
    }
  }
}

/* ---------------- rc.5: whole-snapshot sourceHash (D28) ---------------- */
{
  const r = chk('library.d25.rule', 'not_empty', { code: 'D25.1', field: 'a' });
  const p = pipe('checks.main', [{ rule: r.id }]);
  const a = snap([r, p]);
  const b = snap([p, r]);
  if (a.sourceHash !== b.sourceHash) throw new Error('artifact order changed sourceHash');
  evalFx('d28-hash', 'd28/artifact-authoring-order-a', a, { pipelineId: 'checks.main', payload: { a: 1 } }, OKR);
  evalFx('d28-hash', 'd28/artifact-authoring-order-b-same-map-and-hash', b, { pipelineId: 'checks.main', payload: { a: 1 } }, OKR);
}

/* ---------------- write ---------------- */
function cleanGeneratedJson(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) cleanGeneratedJson(path);
    else if (entry.endsWith('.json')) unlinkSync(path);
  }
}

cleanGeneratedJson(join(ROOT, 'fixtures'));
let n = 0;
for (const f of out) {
  const dir = join(ROOT, 'fixtures', f.dir);
  mkdirSync(dir, { recursive: true });
  let json = JSON.stringify(f.doc, null, 2) + '\n';
  for (const [sentinel, token] of f.rawReplacements ?? []) {
    const quoted = JSON.stringify(sentinel);
    if (!json.includes(quoted)) throw new Error(`${f.doc.name}: raw sentinel ${sentinel} not found`);
    json = json.replaceAll(quoted, token);
  }
  writeFileSync(join(dir, f.file), json);
  n++;
}
console.log(`wrote ${n} fixtures`);
