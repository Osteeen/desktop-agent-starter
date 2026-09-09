import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('C2/C4: descriptor cleanup survives parent swap; marker and nested symlinks stay safe', () => {
  const output = execFileSync('python3', [fileURLToPath(new URL('./support/staging-cases.py', import.meta.url))], { encoding: 'utf8' });
  assert.equal(output.trim().split('\n').map(JSON.parse).filter(row => row.passed).length, 4);
});
