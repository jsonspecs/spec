import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_PATH = fileURLToPath(import.meta.url);
const ROOT = join(dirname(MODULE_PATH), '..');
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function readSpecVersion(root = ROOT) {
  const text = readFileSync(join(root, 'SPEC.md'), 'utf8');
  const matches = [...text.matchAll(/^\*\*Version:\*\*\s+([^\s]+)\s*$/gm)];
  if (matches.length !== 1) {
    throw new Error(`SPEC.md must contain exactly one canonical Version line; found ${matches.length}`);
  }
  const version = matches[0][1];
  if (!SEMVER.test(version)) throw new Error(`SPEC.md Version is not SemVer 2.0.0: ${version}`);
  return version;
}

export const SPEC_VERSION = readSpecVersion();

if (process.argv[1] && resolve(process.argv[1]) === MODULE_PATH) {
  console.log(SPEC_VERSION);
}
