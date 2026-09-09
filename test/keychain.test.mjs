import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

test('C14: store failures and exact-byte readback, including same-length mismatch', { skip: process.platform !== 'darwin' }, () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  const temp = fs.mkdtempSync(path.join(root, 'build/keychain-test-'));
  try {
    fs.copyFileSync(path.join(root, 'test/support/keychain-cases.swift'), path.join(temp, 'main.swift'));
    execFileSync('/usr/bin/swiftc', ['-module-cache-path', path.join(temp, 'modules'), '-DKEYCHAIN_HELPER_TEST',
      path.join(root, 'scripts/store-api-key.swift'), path.join(temp, 'main.swift'), '-o', path.join(temp, 'cases')], { stdio: 'pipe' });
    const output = execFileSync(path.join(temp, 'cases'), { encoding: 'utf8' });
    assert.match(output, /48 passed/);
    assert.equal(output.includes('sk-'), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
