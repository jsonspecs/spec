// Checks that the full Russian translation follows the canonical SPEC structure.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPEC_VERSION } from './spec-version.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(join(root, name), 'utf8');
const en = read('SPEC.md');
const ru = read('SPEC_RU.md');
const decisionsEn = read('DECISIONS.md');
const decisionsRu = read('DECISIONS_RU.md');
const migrationPairs = [
  {
    label: 'RC.6', enName: 'MIGRATION_RC6.md', ruName: 'MIGRATION_RC6_RU.md',
    tokens: ['1.0.0-rc.5', '1.0.0-rc.6', 'D31', 'sourceHash', 'items[*]',
      'conformance.rule.tri', '"INVALID"'],
  },
  {
    label: 'RC.7', enName: 'MIGRATION_RC7.md', ruName: 'MIGRATION_RC7_RU.md',
    tokens: ['1.0.0-rc.6', '1.0.0-rc.7', 'sourceHash', '9007199254740993',
      'd31/large-exact-index-after-wildcard-preserves-concrete-path'],
  },
].map(pair => ({ ...pair, en: read(pair.enName), ru: read(pair.ruName) }));
const markdownDocs = new Map([
  ['SPEC.md', en],
  ['SPEC_RU.md', ru],
  ['DECISIONS.md', decisionsEn],
  ['DECISIONS_RU.md', decisionsRu],
  ['README.md', read('README.md')],
  ['README_RU.md', read('README_RU.md')],
  ...migrationPairs.flatMap(pair => [[pair.enName, pair.en], [pair.ruName, pair.ru]]),
  ['CHANGELOG.md', read('CHANGELOG.md')],
  ['fixtures/README.md', read('fixtures/README.md')],
]);

function outline(text) {
  return [...text.matchAll(/^(#{2,4})\s+([0-9]+(?:\.[0-9]+)*)\.?\s+/gm)]
    .map(([, marks, number]) => `${marks.length}:${number}`);
}

const errors = [];

function unescapedPipeCount(line) {
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '|') continue;
    let slashes = 0;
    for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) slashes++;
    if (slashes % 2 === 0) count++;
  }
  return count;
}

function hasUnescapedPipeInCodeSpan(line) {
  let inCode = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '`') inCode = !inCode;
    if (line[i] !== '|' || !inCode) continue;
    let slashes = 0;
    for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) slashes++;
    if (slashes % 2 === 0) return true;
  }
  return false;
}

function tableShapes(text) {
  const shapes = [];
  let inFence = false;
  let current = null;
  const finish = () => {
    if (current) shapes.push(current);
    current = null;
  };
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimStart();
    if (line.startsWith('```')) {
      finish();
      inFence = !inFence;
      continue;
    }
    if (inFence || !line.startsWith('|')) {
      finish();
      continue;
    }
    const columns = unescapedPipeCount(line) - 1;
    if (!current) current = { columns, rows: 0 };
    current.rows++;
  }
  finish();
  return shapes;
}

for (const [name, text] of markdownDocs) {
  let inFence = false;
  let tablePipes = null;
  for (const [index, rawLine] of text.split('\n').entries()) {
    const line = rawLine.trimStart();
    if (line.startsWith('```')) {
      inFence = !inFence;
      tablePipes = null;
      continue;
    }
    if (inFence || !line.startsWith('|')) {
      tablePipes = null;
      continue;
    }
    const pipes = unescapedPipeCount(line);
    if (pipes < 3) errors.push(`${name}:${index + 1} malformed Markdown table row`);
    if (hasUnescapedPipeInCodeSpan(line)) {
      errors.push(`${name}:${index + 1} unescaped pipe inside a Markdown table code span`);
    }
    if (tablePipes === null) tablePipes = pipes;
    else if (pipes !== tablePipes) {
      errors.push(`${name}:${index + 1} Markdown table has ${pipes - 1} cells; expected ${tablePipes - 1}`);
    }
  }
}

if (JSON.stringify(tableShapes(en)) !== JSON.stringify(tableShapes(ru))) {
  errors.push('English/Russian Markdown table shapes differ');
}

const enOutline = outline(en);
const ruOutline = outline(ru);
if (JSON.stringify(enOutline) !== JSON.stringify(ruOutline)) {
  errors.push(`section outline differs\nEN: ${enOutline.join(' ')}\nRU: ${ruOutline.join(' ')}`);
}

const decisionIds = text => [...text.matchAll(/^## (D[0-9]+|\[DR-[IVX]+\])/gm)]
  .map(([, id]) => id);
const enDecisionIds = decisionIds(decisionsEn);
const ruDecisionIds = decisionIds(decisionsRu);
if (JSON.stringify(enDecisionIds) !== JSON.stringify(ruDecisionIds)) {
  errors.push(`decision register differs\nEN: ${enDecisionIds.join(' ')}\nRU: ${ruDecisionIds.join(' ')}`);
}

const enVersion = en.match(/^\*\*Version:\*\*\s+([^\s·]+)/m)?.[1];
const ruVersion = ru.match(/^\*\*Версия:\*\*\s+([^\s·]+)/m)?.[1];
if (!enVersion || enVersion !== ruVersion) errors.push(`version differs: EN=${enVersion} RU=${ruVersion}`);
if (enVersion !== SPEC_VERSION) errors.push(`canonical version differs: parser=${SPEC_VERSION} SPEC=${enVersion}`);

const count = (text, pattern) => [...text.matchAll(pattern)].length;
for (const [label, pattern] of [
  ['fenced code delimiters', /^```/gm],
  ['table rows', /^\|/gm],
  ['numbered list items', /^[0-9]+\./gm],
  ['MUST', /\bMUST\b/g],
  ['MUST NOT', /\bMUST NOT\b/g],
  ['SHOULD', /\bSHOULD\b/g],
  ['MAY', /\bMAY\b/g],
]) {
  const enCount = count(en, pattern);
  const ruCount = count(ru, pattern);
  if (enCount !== ruCount) errors.push(`${label} count differs: EN=${enCount} RU=${ruCount}`);
}

for (const token of ['OPERATOR_NOT_FOUND', 'conformance.rule.tri', 'sourceHash', 'DR-X', 'DR-XI', 'D31']) {
  if (!ru.includes(token)) errors.push(`SPEC_RU.md does not contain required token ${token}`);
}

function headingLevels(text) {
  return [...text.matchAll(/^(#{1,6})\s+/gm)].map(([, marks]) => marks.length);
}

for (const migration of migrationPairs) {
  if (JSON.stringify(headingLevels(migration.en)) !== JSON.stringify(headingLevels(migration.ru))) {
    errors.push(`${migration.label} migration guide heading structure differs`);
  }

  for (const [label, pattern] of [
    ['fenced code delimiters', /^```/gm],
    ['numbered list items', /^[0-9]+\./gm],
    ['bullet list items', /^- /gm],
  ]) {
    const enCount = count(migration.en, pattern);
    const ruCount = count(migration.ru, pattern);
    if (enCount !== ruCount) {
      errors.push(`${migration.label} migration guide ${label} count differs: EN=${enCount} RU=${ruCount}`);
    }
  }

  for (const token of migration.tokens) {
    if (!migration.en.includes(token)) errors.push(`${migration.enName} does not contain ${token}`);
    if (!migration.ru.includes(token)) errors.push(`${migration.ruName} does not contain ${token}`);
  }
}

if (errors.length) {
  console.error(`FAIL: SPEC translation parity (${errors.length} problem(s))`);
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log(`OK: SPEC_RU.md matches ${enOutline.length} numbered sections of SPEC.md (${enVersion}); migration guide structures match`);
