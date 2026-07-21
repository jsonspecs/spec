// Fixture generator for jsonspecs/spec conformance suite.
// Regenerates fixtures/**/*.json deterministically. Run: node tools/generate-fixtures.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = '1.0.0-rc.3';
const deep = n => n <= 1 ? 1 : { n: deep(n - 1) };

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

function snap(artifacts, opts = {}) {
  const s = { format: 'jsonspecs-snapshot', formatVersion: 2, specVersion: SPEC };
  if (opts.requires) s.requires = opts.requires;
  s.sourceHash = opts.badHash ? '0'.repeat(64) : sha(jcs(artifacts));
  s.artifacts = artifacts;
  if (opts.formatVersion !== undefined) s.formatVersion = opts.formatVersion;
  if (opts.specVersion !== undefined) s.specVersion = opts.specVersion;
  return s;
}
const chk = (id, operator, o = {}) => ({ id, type: 'rule', description: 'fixture rule',
  operator, ...o.x,
  ...(o.field !== undefined ? { field: o.field } : {}), ...(o.fields ? { fields: o.fields } : {}),
  ...(o.value !== undefined ? { value: o.value } : {}), ...(o.value_field ? { value_field: o.value_field } : {}),
  ...(o.flags ? { flags: o.flags } : {}), ...(o.dictionary ? { dictionary: o.dictionary } : {}),
  ...(o.aggregate ? { aggregate: o.aggregate } : {}),
  issue: { level: o.level ?? 'ERROR', code: o.code, message: o.message ?? 'failed', ...(o.meta ? { meta: o.meta } : {}) } });
const pred = (id, operator, o = {}) => ({ id, type: 'rule', description: 'fixture rule',
  operator, ...(o.field !== undefined ? { field: o.field } : {}), ...(o.fields ? { fields: o.fields } : {}),
  ...(o.value !== undefined ? { value: o.value } : {}), ...(o.value_field ? { value_field: o.value_field } : {}),
  ...(o.flags ? { flags: o.flags } : {}), ...(o.dictionary ? { dictionary: o.dictionary } : {}),
  ...(o.aggregate ? { aggregate: o.aggregate } : {}), ...o.x });
const pipe = (id, flow, o = {}) => ({ id, type: 'pipeline', description: 'fixture pipeline',
  entrypoint: o.entrypoint ?? true, strict: o.strict ?? false,
  ...(o.message ? { message: o.message } : {}), ...(o.strictCode ? { strictCode: o.strictCode } : {}), ...o.x, flow });
const issue = (level, code, message, field, ruleId, pipelineId, extra = {}) =>
  ({ kind: 'ISSUE', level, code, message, field, ruleId, pipelineId, ...extra });
const M = 'failed';

const out = [];
function evalFx(dir, name, snapshot, input, expected, operators = []) {
  out.push({ dir, file: name.split('/').pop() + '.json',
    doc: { name, snapshot, operators, input, expected: { ...expected, ruleset: { specVersion: snapshot.specVersion, sourceHash: snapshot.sourceHash } } } });
}
function rejFx(dir, name, snapshot, identifier, operators = []) {
  out.push({ dir, file: name.split('/').pop() + '.json',
    doc: { name, snapshot, operators, expected: { verdict: 'reject', ...(identifier ? { identifier } : {}) } } });
}
const one = (rule, pid = 'checks.main') => [rule, pipe(pid, [{ rule: rule.id }])];
const OKR = { status: 'OK', control: 'CONTINUE', issues: [] };
const ERR = issues => ({ status: 'ERROR', control: 'STOP', issues });

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
rejFx('d04-regex', 'd04/reject-unknown-flag', snap(one(chk('library.r.f', 'matches_regex', { code: 'R6', field: 'a', value: '^a$', flags: 'g' }))));
{
  const arts = [chk('library.r.pp1', 'matches_regex', { code: 'R7', field: 'a', value: '^\\\\d+$' }),
    chk('library.r.pp2', 'matches_regex', { code: 'R8', field: 'a', value: '^\\d+$' }),
    pipe('checks.main', [{ rule: 'library.r.pp1' }, { rule: 'library.r.pp2' }])];
  evalFx('d04-regex', 'd04/preprocessing-collapses-double-backslash', snap(arts), { pipelineId: 'checks.main', payload: { a: '123' } }, OKR);
}
evalFx('d04-regex', 'd04/flag-i-unicode-simple-folding-cyrillic',
  snap(one(chk('library.r.i', 'matches_regex', { code: 'R9', field: 'a', value: '^иван$', flags: 'i' }))),
  { pipelineId: 'checks.main', payload: { a: 'ИВАН' } }, OKR);
evalFx('d04-regex', 'd04/dot-matches-one-code-point',
  snap(one(chk('library.r.dot', 'matches_regex', { code: 'R10', field: 'a', value: '^.$' }))),
  { pipelineId: 'checks.main', payload: { a: '\u{1F600}' } }, OKR);
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
    { status: 'ABORT', control: 'STOP', issues: [], error: { code: 'DANGEROUS_PAYLOAD_KEY', details: { parentPath: 'a', key: 'constructor' } } });
  evalFx('d09-guards', 'd09/payload-too-deep-details-max-depth-only', snap(one(chk('library.g.d', 'not_empty', { code: 'G2', field: 'ok' }))),
    { pipelineId: 'checks.main', payload: { ok: 1, d: deep(256) } },
    { status: 'ABORT', control: 'STOP', issues: [], error: { code: 'PAYLOAD_TOO_DEEP', details: { maxDepth: 256 } } });
  evalFx('d09-guards', 'd09/proto-key-rejected', snap(one(chk('library.g.p', 'not_empty', { code: 'G3', field: 'ok' }))),
    { pipelineId: 'checks.main', payload: JSON.parse('{"x":{"__proto__":1},"ok":1}') },
    { status: 'ABORT', control: 'STOP', issues: [], error: { code: 'DANGEROUS_PAYLOAD_KEY', details: { parentPath: 'x', key: '__proto__' } } });
}

/* ---------------- d10-operators ---------------- */
rejFx('d10-operators', 'd10/reject-unknown-operator-not-declared', snap(one(chk('library.c.u', 'custom_x', { code: 'C1', field: 'a' }))));
rejFx('d10-operators', 'd10/reject-operator-not-found',
  snap(one(chk('library.c.i', 'valid_inn', { code: 'C2', field: 'inn' })), { requires: { operators: ['valid_inn'] } }),
  'OPERATOR_NOT_FOUND', []);

/* ---------------- d11-snapshot ---------------- */
rejFx('d11-snapshot', 'd11/reject-any-filled-paths-alias',
  snap(one({ id: 'library.x.af', type: 'rule', description: 'fixture rule', operator: 'any_filled',
    issue: { level: 'ERROR', code: 'X1', message: M }, paths: ['a', 'b'] })));
rejFx('d11-snapshot', 'd11/reject-required-context-field',
  snap([chk('library.x.r', 'not_empty', { code: 'X2', field: 'a' }),
    { id: 'checks.main', type: 'pipeline', description: 'fixture pipeline', entrypoint: true, strict: false, required_context: ['currentDate'], flow: [{ rule: 'library.x.r' }] }]));
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
    { status: 'EXCEPTION', control: 'STOP',
      issues: [issue('EXCEPTION', 'CTX.CURRENT_DATE.REQUIRED', M, '$context.currentDate', 'library.x.ctx', 'checks.main')] });
}
rejFx('d11-snapshot', 'd11/reject-duplicate-issue-code',
  snap([chk('library.x.d1', 'not_empty', { code: 'DUP', field: 'a' }), chk('library.x.d2', 'not_empty', { code: 'DUP', field: 'b' }),
    pipe('checks.main', [{ rule: 'library.x.d1' }, { rule: 'library.x.d2' }])]));
rejFx('d11-snapshot', 'd11/reject-partial-issue-object',
  snap([{ id: 'library.x.p', type: 'rule', description: 'fixture rule', operator: 'not_empty', field: 'a',
      issue: { code: 'NOPE', message: M } },
    chk('library.x.ok', 'not_empty', { code: 'X6', field: 'a' }), pipe('checks.main', [{ rule: 'library.x.ok' }])]));
rejFx('d11-snapshot', 'd11/reject-legacy-rule-role',
  snap(one({ ...chk('library.x.role', 'not_empty', { code: 'X6R', field: 'a' }), role: 'check' })));
rejFx('d11-snapshot', 'd11/reject-rule-step-without-issue',
  snap([pred('library.x.pp', 'not_empty', { field: 'a' }), pipe('checks.main', [{ rule: 'library.x.pp' }])]));
rejFx('d11-snapshot', 'd11/reject-pipeline-cycle',
  snap([chk('library.x.c2', 'not_empty', { code: 'X8', field: 'a' }),
    pipe('checks.a', [{ pipeline: 'checks.b' }]), pipe('checks.b', [{ pipeline: 'checks.a' }], { entrypoint: false })]));
rejFx('d11-snapshot', 'd11/reject-scoped-pipeline-reference',
  snap([chk('library.x.c3', 'not_empty', { code: 'X9', field: 'a' }),
    pipe('checks.main', [{ pipeline: 'inner' }]), pipe('checks.inner', [{ rule: 'library.x.c3' }], { entrypoint: false })]));
rejFx('d11-snapshot', 'd11/reject-dictionary-null-entry',
  snap([{ id: 'library.dict.bad', type: 'dictionary', description: 'fixture dictionary', entries: ['X', null] },
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
    { id: 'library.cond.g', type: 'condition', description: 'fixture condition', when: 'library.se.p1', steps: [{ rule: 'library.se.c1' }] },
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
    { id: 'library.cond.w', type: 'condition', description: 'fixture condition',
      when: { all: ['library.se.pa', { not: 'library.se.pb' }] }, steps: [{ rule: 'library.se.c2' }] },
    pipe('checks.main', [{ condition: 'library.cond.w' }])];
  evalFx('semantics', 'sem/when-all-not-composition', snap(arts),
    { pipelineId: 'checks.main', payload: { type: 'FL', resident: false } },
    ERR([issue('ERROR', 'SE2', M, 'passport', 'library.se.c2', 'checks.main')]));
}
{
  const arts = [chk('library.se.e1', 'not_empty', { code: 'SE3', field: 'a' }),
    pipe('checks.main', [{ rule: 'library.se.e1' }], { strict: true, message: 'Block failed', strictCode: 'BLK' })];
  evalFx('semantics', 'sem/strict-summary-shape-and-order', snap(arts),
    { pipelineId: 'checks.main', payload: {} },
    { status: 'EXCEPTION', control: 'STOP',
      issues: [issue('ERROR', 'SE3', M, 'a', 'library.se.e1', 'checks.main'),
        issue('EXCEPTION', 'BLK', 'Block failed', null, 'pipeline:checks.main', 'checks.main')] });
}
{
  const arts = [chk('library.se.e2', 'not_empty', { code: 'SE4', field: 'a' }),
    pipe('checks.inner', [{ rule: 'library.se.e2' }], { entrypoint: false }),
    pipe('checks.outer', [{ pipeline: 'checks.inner' }], { strict: true, message: 'Outer failed', strictCode: 'OUT' })];
  evalFx('semantics', 'sem/strict-counts-subpipeline-issues', snap(arts),
    { pipelineId: 'checks.outer', payload: {} },
    { status: 'EXCEPTION', control: 'STOP',
      issues: [issue('ERROR', 'SE4', M, 'a', 'library.se.e2', 'checks.inner'),
        issue('EXCEPTION', 'OUT', 'Outer failed', null, 'pipeline:checks.outer', 'checks.outer')] });
}
{
  const arts = [chk('library.se.x', 'not_empty', { code: 'SE5', field: 'a', level: 'EXCEPTION' }),
    chk('library.se.after', 'not_empty', { code: 'SE6', field: 'b' }),
    pipe('checks.inner', [{ rule: 'library.se.x' }], { entrypoint: false }),
    pipe('checks.main', [{ pipeline: 'checks.inner' }, { rule: 'library.se.after' }])];
  evalFx('semantics', 'sem/exception-in-subpipeline-stops-everything', snap(arts),
    { pipelineId: 'checks.main', payload: {} },
    { status: 'EXCEPTION', control: 'STOP',
      issues: [issue('EXCEPTION', 'SE5', M, 'a', 'library.se.x', 'checks.inner')] });
}
{
  const arts = [chk('library.se.w', 'not_empty', { code: 'SE7', field: 'a', level: 'WARNING' }),
    pipe('checks.main', [{ rule: 'library.se.w' }])];
  evalFx('semantics', 'sem/warning-only-status', snap(arts), { pipelineId: 'checks.main', payload: {} },
    { status: 'OK_WITH_WARNINGS', control: 'CONTINUE',
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
  const dict = { id: 'library.dict.countries', type: 'dictionary', description: 'fixture dictionary', entries: [{ code: 'RU', value: 'Россия' }] };
  const arts = [dict,
    chk('library.se.di1', 'in_dictionary', { code: 'SE10', field: 'a', dictionary: { type: 'static', id: 'library.dict.countries' } }),
    chk('library.se.di2', 'in_dictionary', { code: 'SE11', field: 'b', dictionary: { type: 'static', id: 'library.dict.countries' } }),
    pipe('checks.main', [{ rule: 'library.se.di1' }, { rule: 'library.se.di2' }])];
  evalFx('semantics', 'sem/dictionary-object-entry-code-or-value', snap(arts),
    { pipelineId: 'checks.main', payload: { a: 'Россия', b: 'DE' } },
    ERR([issue('ERROR', 'SE11', M, 'b', 'library.se.di2', 'checks.main',
      { expected: { type: 'static', id: 'library.dict.countries' }, actual: 'DE' })]));
}
{
  const dict = { id: 'library.dict.blocked', type: 'dictionary', description: 'fixture dictionary', entries: ['RU'] };
  const arts = [dict,
    chk('library.se.ni', 'not_in_dictionary', { code: 'SE12', field: 'a', dictionary: { type: 'static', id: 'library.dict.blocked' } }),
    pipe('checks.main', [{ rule: 'library.se.ni' }])];
  evalFx('semantics', 'sem/not-in-dictionary-ok', snap(arts), { pipelineId: 'checks.main', payload: { a: 'DE' } }, OKR);
  evalFx('semantics', 'sem/not-in-dictionary-fail-shape', snap(arts), { pipelineId: 'checks.main', payload: { a: 'RU' } },
    ERR([issue('ERROR', 'SE12', M, 'a', 'library.se.ni', 'checks.main',
      { expected: { type: 'static', id: 'library.dict.blocked' }, actual: 'RU' })]));
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
{
  const r = chk('library.se.min', 'greater_than', { code: 'SE15', field: 'x[*].v', value: 10, aggregate: { mode: 'MIN' } });
  evalFx('semantics', 'sem/aggregate-min-extremum-concrete-field', snap(one(r)),
    { pipelineId: 'checks.main', payload: { x: [{ v: 5 }, { v: 20 }] } },
    ERR([issue('ERROR', 'SE15', M, 'x[0].v', 'library.se.min', 'checks.main',
      { expected: 10, actual: 5, details: { mode: 'MIN' } })]));
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
    { status: 'EXCEPTION', control: 'STOP',
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
    { status: 'ABORT', control: 'STOP', issues: [], error: { code: 'PIPELINE_NOT_FOUND', details: { pipelineId: 'checks.nope' } } });
}
{
  const arts = [chk('library.se.ab2', 'not_empty', { code: 'SE20', field: 'a' }),
    pipe('checks.one', [{ rule: 'library.se.ab2' }]), pipe('checks.two', [{ rule: 'library.se.ab2' }])];
  evalFx('semantics', 'sem/abort-pipeline-id-required-two-entrypoints', snap(arts),
    { payload: { a: 1 } },
    { status: 'ABORT', control: 'STOP', issues: [], error: { code: 'PIPELINE_ID_REQUIRED', details: { entrypointCount: 2 } } });
}
{
  const arts = [chk('library.se.def', 'not_empty', { code: 'SE21', field: 'a' }), pipe('checks.main', [{ rule: 'library.se.def' }])];
  evalFx('semantics', 'sem/entrypoint-default-selection', snap(arts), { payload: { a: 1 } }, OKR);
}
{
  const arts = [chk('library.se.sub', 'not_empty', { code: 'SE22', field: 'a' }),
    pipe('checks.inner', [{ rule: 'library.se.sub' }], { entrypoint: false }),
    pipe('checks.main', [{ pipeline: 'checks.inner' }])];
  evalFx('semantics', 'sem/subpipeline-issue-attribution', snap(arts), { pipelineId: 'checks.main', payload: {} },
    ERR([issue('ERROR', 'SE22', M, 'a', 'library.se.sub', 'checks.inner')]));
}
{
  const arts = [chk('library.se.sid', 'not_empty', { code: 'SE23', field: 'a' }),
    pipe('checks.main', [{ rule: 'library.se.sid', stepId: 'step-1' }])];
  evalFx('semantics', 'sem/step-id-passthrough', snap(arts), { pipelineId: 'checks.main', payload: {} },
    ERR([issue('ERROR', 'SE23', M, 'a', 'library.se.sid', 'checks.main', { stepId: 'step-1' })]));
}


/* ---------------- rc.2: input types, invalid keys, depth bounds (D15, DR-IV) ---------------- */
{
  const base = () => snap(one(chk('library.i.r', 'not_empty', { code: 'I1', field: 'ok' })));
  const AB = (code, details) => ({ status: 'ABORT', control: 'STOP', issues: [], error: { code, details } });
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
rejFx('d11-snapshot', 'd11/reject-artifact-too-deep',
  snap(one(chk('library.x.deep', 'not_empty', { code: 'X12', field: 'a', meta: deep(256) }))));
rejFx('d11-snapshot', 'd11/reject-unsupported-minor-version',
  snap(one(chk('library.x.mv', 'not_empty', { code: 'X13', field: 'a' })), { specVersion: '1.999.0' }));
rejFx('d11-snapshot', 'd11/reject-aggregate-without-wildcard',
  snap(one(chk('library.x.aw', 'greater_than', { code: 'X14', field: 'a', value: 1,
    aggregate: { mode: 'ALL', issueMode: 'EACH' } }))));
rejFx('d11-snapshot', 'd11/reject-orphan-scope',
  snap([chk('library.x.ok2', 'not_empty', { code: 'X15', field: 'a' }),
    { id: 'ghost.rule', type: 'rule', description: 'fixture rule', operator: 'not_empty', field: 'a',
      issue: { level: 'ERROR', code: 'X16', message: M } },
    pipe('checks.main', [{ rule: 'library.x.ok2' }])]));
rejFx('d11-snapshot', 'd11/reject-path-empty-segment',
  snap(one(chk('library.x.p1', 'not_empty', { code: 'X17', field: 'a..b' }))));
rejFx('d11-snapshot', 'd11/reject-path-leading-zero-index',
  snap(one(chk('library.x.p2', 'greater_than', { code: 'X18', field: 'a[01].v', value: 1 }))));
rejFx('d11-snapshot', 'd11/reject-value-field-wildcard',
  snap(one(chk('library.x.p3', 'field_equals_field', { code: 'X19', field: 'a', value_field: 'b[*].v' }))));
{
  const arts = [{ id: 'library.j.edge', type: 'rule', description: 'JCS edge: "Пётр"\t\\backslash',
    operator: 'equals', field: 'a', value: 1e21, issue: { level: 'ERROR', code: 'J1', message: M } },
    pipe('checks.main', [{ rule: 'library.j.edge' }])];
  evalFx('d06-hash', 'd06/jcs-canonicalization-edge-values', snap(arts),
    { pipelineId: 'checks.main', payload: { a: 1e21 } }, OKR);
}

/* ---------------- rc.2: case folding set (D18) ---------------- */
{
  const F = (nm, pat, subj, ok, code, rid) => {
    const r = chk(rid, 'matches_regex', { code, field: 'a', value: pat, flags: 'i' });
    evalFx('d04-regex', nm, snap(one(r)), { pipelineId: 'checks.main', payload: { a: subj } },
      ok ? OKR : ERR([issue('ERROR', code, M, 'a', rid, 'checks.main', { expected: pat, actual: subj })]));
  };
  F('d04/folding-kelvin-sign-equals-k', '^k$', '\u212A', true, 'F1', 'library.f.k');
  F('d04/folding-long-s-equals-s', '^s$', '\u017F', true, 'F2', 'library.f.s');
  F('d04/folding-final-sigma-equals-sigma', '^Σ$', 'ς', true, 'F3', 'library.f.sg');
  F('d04/folding-eszett-equals-capital-eszett', '^ß$', '\u1E9E', true, 'F4', 'library.f.e1');
  F('d04/folding-eszett-not-equals-ss', '^ss$', 'ß', false, 'F5', 'library.f.e2');
  F('d04/folding-turkish-dotted-capital-i-no-match', '^i$', '\u0130', false, 'F6', 'library.f.t1');
  F('d04/folding-turkish-dotless-i-no-match', '^i$', '\u0131', false, 'F7', 'library.f.t2');
}

/* ---------------- rc.2: MIN tie-break (DR-IV) ---------------- */
{
  const r = chk('library.se.tie', 'greater_than', { code: 'SE25', field: 'x[*].v', value: 10, aggregate: { mode: 'MIN' } });
  evalFx('semantics', 'sem/aggregate-min-tie-break-first-in-order', snap(one(r)),
    { pipelineId: 'checks.main', payload: { x: [{ v: 5 }, { v: 5 }, { v: 20 }] } },
    ERR([issue('ERROR', 'SE25', M, 'x[0].v', 'library.se.tie', 'checks.main',
      { expected: 10, actual: 5, details: { mode: 'MIN' } })]));
}

/* ---------------- rc.3: unified rule sites and reserved operators (D19) ---------------- */
{
  const hard = chk('library.d19.reusable', 'not_empty', { code: 'D19.1', field: 'trigger', level: 'EXCEPTION' });
  const target = chk('library.d19.target', 'not_empty', { code: 'D19.2', field: 'required' });
  const arts = [hard, target,
    { id: 'library.d19.condition', type: 'condition', description: 'fixture condition',
      when: 'library.d19.reusable', steps: [{ rule: 'library.d19.target' }] },
    pipe('checks.guard', [{ condition: 'library.d19.condition' }]),
    pipe('checks.hard', [{ rule: 'library.d19.reusable' }], { entrypoint: false })];
  evalFx('d19-unified-rules', 'd19/issue-bearing-rule-is-silent-in-when', snap(arts),
    { pipelineId: 'checks.guard', payload: {} }, OKR);
  evalFx('d19-unified-rules', 'd19/same-rule-creates-exception-issue-in-step', snap(arts),
    { pipelineId: 'checks.hard', payload: {} },
    { status: 'EXCEPTION', control: 'STOP',
      issues: [issue('EXCEPTION', 'D19.1', M, 'trigger', 'library.d19.reusable', 'checks.hard')] });
}
{
  const noIssue = pred('library.d19.noissue', 'length_equals', { field: 'kind', value: 2 });
  const target = chk('library.d19.hit', 'not_empty', { code: 'D19.3', field: 'required' });
  const arts = [noIssue, target,
    { id: 'library.d19.noissue.condition', type: 'condition', description: 'fixture condition',
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
    { id: 'library.d19.formerly-blocked', type: 'condition', description: 'fixture condition',
      when: { all: [any.id, nt.id] }, steps: [{ rule: target.id }] },
    pipe('checks.main', [{ condition: 'library.d19.formerly-blocked' }])];
  evalFx('d19-unified-rules', 'd19/all-builtins-are-usable-in-when', snap(arts),
    { pipelineId: 'checks.main', payload: { email: 'x@example.test' } },
    ERR([issue('ERROR', 'D19.4', M, 'required', target.id, 'checks.main')]));
}
{
  const runFault = (name, op, site, code) => {
    const r = site === 'step' ? chk('library.co.r', op, { code: 'CO1', field: 'a' }) : pred('library.co.r', op, { field: 'a' });
    const artifacts = site === 'step'
      ? one(r)
      : [r, chk('library.co.after', 'not_empty', { code: 'CO2', field: 'b' }),
          { id: 'library.co.cond', type: 'condition', description: 'fixture condition', when: r.id, steps: [{ rule: 'library.co.after' }] },
          pipe('checks.main', [{ condition: 'library.co.cond' }])];
    evalFx('d10-operators', name, snap(artifacts, { requires: { operators: [op] } }),
      { pipelineId: 'checks.main', payload: { a: 1 } },
      { status: 'ABORT', control: 'STOP', issues: [], error: { code, details: { ruleId: r.id, operator: op } } }, [op]);
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
    snap(one(eachAll), { requires: { operators: [op] } }), { pipelineId: 'checks.main', payload },
    ERR([issue('ERROR', 'D20.1', M, 'items[2].result', eachAll.id, 'checks.main')]), [op]);

  const anyPass = tri('library.d20.any.pass', { mode: 'ANY', issueMode: 'EACH' }, 'D20.2');
  evalFx('d20-aggregation', 'd20/any-each-pass-emits-no-partial-issues',
    snap(one(anyPass), { requires: { operators: [op] } }), { pipelineId: 'checks.main', payload }, OKR, [op]);

  const anyFail = tri('library.d20.any.fail', { mode: 'ANY', issueMode: 'EACH' }, 'D20.2F');
  evalFx('d20-aggregation', 'd20/any-each-reports-fails-only-when-none-pass',
    snap(one(anyFail), { requires: { operators: [op] } }),
    { pipelineId: 'checks.main', payload: { items: [{ result: 'SKIP' }, { result: 'FAIL' }] } },
    ERR([issue('ERROR', 'D20.2F', M, 'items[1].result', anyFail.id, 'checks.main')]), [op]);

  const allSummary = tri('library.d20.all.summary', { mode: 'ALL', issueMode: 'SUMMARY' }, 'D20.3');
  evalFx('d20-aggregation', 'd20/all-summary-exposes-effective-population',
    snap(one(allSummary), { requires: { operators: [op] } }), { pipelineId: 'checks.main', payload },
    ERR([issue('ERROR', 'D20.3', M, 'items[*].result', allSummary.id, 'checks.main',
      { details: { mode: 'ALL', matched: 3, evaluated: 2, skipped: 1, passed: 1, failed: 1 } })]), [op]);

  const count = tri('library.d20.count', { mode: 'COUNT', op: '>=', value: 2 }, 'D20.4');
  evalFx('d20-aggregation', 'd20/count-excludes-skip-from-population',
    snap(one(count), { requires: { operators: [op] } }), { pipelineId: 'checks.main', payload },
    ERR([issue('ERROR', 'D20.4', M, 'items[*].result', count.id, 'checks.main',
      { details: { mode: 'COUNT', op: '>=', value: 2, matched: 3, evaluated: 2, skipped: 1, passed: 1, failed: 1 } })]), [op]);

  const allSkip = tri('library.d20.skip', { mode: 'ALL', issueMode: 'SUMMARY', onEmpty: 'FAIL' }, 'D20.5');
  evalFx('d20-aggregation', 'd20/all-skip-propagates-skip-not-on-empty-fail',
    snap(one(allSkip), { requires: { operators: [op] } }),
    { pipelineId: 'checks.main', payload: { items: [{ result: 'SKIP' }, { result: 'SKIP' }] } }, OKR, [op]);

  const empty = tri('library.d20.empty', { mode: 'ANY', issueMode: 'SUMMARY', onEmpty: 'FAIL' }, 'D20.6');
  evalFx('d20-aggregation', 'd20/structural-empty-applies-on-empty-fail',
    snap(one(empty), { requires: { operators: [op] } }), { pipelineId: 'checks.main', payload: {} },
    ERR([issue('ERROR', 'D20.6', M, 'items[*].result', empty.id, 'checks.main',
      { details: { mode: 'ANY', matched: 0, evaluated: 0, skipped: 0, passed: 0, failed: 0 } })]), [op]);
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
  writeFileSync(join(dir, f.file), JSON.stringify(f.doc, null, 2) + '\n');
  n++;
}
console.log(`wrote ${n} fixtures`);
