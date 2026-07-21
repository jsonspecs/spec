// Fixture suite validator. Run: node tools/validate-fixtures.mjs
// Checks structural validity of every fixture file. Does NOT evaluate semantics —
// semantic correctness is established by running implementations against the suite.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'fixtures');

function jcs(v) {
  if (v === null || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('non-finite'); return JSON.stringify(v); }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(jcs).join(',') + ']';
  const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return '{' + keys.map(k => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}';
}
const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');

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
  if (!fx.snapshot || typeof fx.snapshot !== 'object') { err('missing snapshot'); continue; }
  if (!fx.expected || typeof fx.expected !== 'object') { err('missing expected'); continue; }

  const rejection = fx.expected.verdict === 'reject';
  // sourceHash integrity holds for ALL fixtures except the one that tests hash mismatch itself:
  // otherwise a rejection fixture could pass for the wrong reason (accidentally broken hash).
  if (fx.name !== 'd06/reject-source-hash-mismatch' && Array.isArray(fx.snapshot.artifacts)) {
    const h = sha(jcs(fx.snapshot.artifacts));
    if (fx.snapshot.sourceHash !== h) err(`sourceHash mismatch: ${fx.snapshot.sourceHash} != ${h}`);
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
  if (typeof s.specVersion !== 'string') err('bad snapshot.specVersion');
  if (!Array.isArray(s.artifacts)) err('snapshot.artifacts must be an array');
  if (!fx.input || typeof fx.input !== 'object') err('missing input');
  // input.payload type is the tested runtime's business (INVALID_PAYLOAD fixtures carry
  // null/arrays deliberately) — the validator checks presence only.
  else if (!('payload' in fx.input)) err('input.payload must be present');
  const e = fx.expected;
  if (!STATUSES.has(e.status)) err(`bad expected.status ${e.status}`);
  if (e.control !== 'CONTINUE' && e.control !== 'STOP') err(`bad expected.control ${e.control}`);
  if (!Array.isArray(e.issues)) err('expected.issues must be an array');
  if (e.status === 'ABORT') {
    if (!e.error || typeof e.error.code !== 'string' || typeof e.error.details !== 'object') err('ABORT needs error.code + error.details');
    if (e.issues && e.issues.length) err('ABORT must have empty issues');
  } else if (e.error !== undefined) err('error only on ABORT');
  if (!e.ruleset || e.ruleset.sourceHash !== s.sourceHash || e.ruleset.specVersion !== s.specVersion)
    err('expected.ruleset must echo snapshot specVersion + sourceHash');
  for (const [i, is] of (e.issues || []).entries()) {
    for (const k of ['kind', 'level', 'code', 'message', 'ruleId', 'pipelineId'])
      if (is[k] === undefined) err(`issues[${i}] missing ${k}`);
    if (!('field' in is)) err(`issues[${i}] missing field (may be null, not absent)`);
  }
}

if (errors.length) {
  console.error(`FAIL: ${errors.length} problem(s)`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log(`OK: ${files.length} fixtures (${evalN} evaluation, ${rejN} rejection), all valid`);
