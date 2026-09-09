import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { renameExcl, supported } = require('../lib/safe-rename.cjs');

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'safe-rename-')); }
function ino(p) { return fs.lstatSync(p).ino; }

test('primitive is available on this platform', () => {
  assert.equal(supported(), process.platform === 'darwin');
});

test('renames when destination is absent, preserving inode', () => {
  const d = tmpdir(); const a = path.join(d, 'a.txt'); const b = path.join(d, 'b.txt');
  fs.writeFileSync(a, 'hello'); const inoA = ino(a);
  const r = renameExcl(a, b);
  assert.deepEqual(r, { ok: true });
  assert.equal(fs.existsSync(a), false);
  assert.equal(ino(b), inoA);
  assert.equal(fs.readFileSync(b, 'utf8'), 'hello');
});

test('refuses with EEXIST when destination exists, changing nothing', () => {
  const d = tmpdir(); const a = path.join(d, 'a.txt'); const b = path.join(d, 'b.txt');
  fs.writeFileSync(a, 'A'); fs.writeFileSync(b, 'B');
  const inoA = ino(a), inoB = ino(b);
  const r = renameExcl(a, b);
  assert.equal(r.ok, false); assert.equal(r.code, 'EEXIST');
  assert.equal(fs.readFileSync(a, 'utf8'), 'A'); assert.equal(fs.readFileSync(b, 'utf8'), 'B');
  assert.equal(ino(a), inoA); assert.equal(ino(b), inoB);
});

test('refuses with EEXIST when destination is an existing directory', () => {
  const d = tmpdir(); const a = path.join(d, 'a.txt'); const dir = path.join(d, 'dir');
  fs.writeFileSync(a, 'A'); fs.mkdirSync(dir);
  const r = renameExcl(a, dir);
  assert.equal(r.ok, false); assert.ok(['EEXIST', 'EISDIR'].includes(r.code), r.code);
  assert.equal(fs.readFileSync(a, 'utf8'), 'A');
});

test('reports ENOENT for a missing source', () => {
  const d = tmpdir();
  const r = renameExcl(path.join(d, 'missing'), path.join(d, 'x'));
  assert.equal(r.ok, false); assert.equal(r.code, 'ENOENT');
});

test('the primitive does not verify source identity - the caller must (documented)', () => {
  const d = tmpdir(); const a = path.join(d, 'a.txt'); const b = path.join(d, 'b.txt');
  fs.writeFileSync(a, 'original'); const expected = ino(a);
  // Simulate a replacement at the source path between the caller's stat and the rename.
  fs.unlinkSync(a); fs.writeFileSync(a, 'replacement');
  const r = renameExcl(a, b);
  assert.deepEqual(r, { ok: true });
  // Post-check by inode catches it: this is the "incident" path, never a success.
  assert.notEqual(ino(b), expected);
});

test('refuses a path containing a NUL byte instead of silently truncating it', () => {
  const d = tmpdir(); const a = path.join(d, 'a.txt');
  fs.writeFileSync(a, 'A');
  const r = renameExcl(a, path.join(d, 'safe\u0000HIDDEN'));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'EINVAL');
  // Nothing was created under the truncated name, and the source is untouched.
  assert.equal(fs.existsSync(path.join(d, 'safe')), false);
  assert.equal(fs.existsSync(a), true);
});

test('refuses an empty path', () => {
  const d = tmpdir(); const a = path.join(d, 'a.txt');
  fs.writeFileSync(a, 'A');
  assert.equal(renameExcl(a, '').code, 'EINVAL');
  assert.equal(renameExcl('', a).code, 'EINVAL');
});

test('cross-volume rename is refused with EXDEV (skipped if no second writable volume)', (t) => {
  const vols = fs.existsSync('/Volumes') ? fs.readdirSync('/Volumes').map(v => path.join('/Volumes', v)) : [];
  const rootDev = fs.statSync('/').dev;
  const other = vols.find(v => { try { const s = fs.statSync(v); fs.accessSync(v, fs.constants.W_OK); return s.dev !== rootDev; } catch { return false; } });
  if (!other) { t.skip('no second writable volume mounted; run with an external drive for EXDEV'); return; }
  const d = tmpdir(); const a = path.join(d, 'a.txt'); fs.writeFileSync(a, 'A');
  const dst = path.join(other, `safe-rename-xdev-${process.pid}.txt`);
  const r = renameExcl(a, dst);
  assert.equal(r.ok, false); assert.equal(r.code, 'EXDEV');
  assert.equal(fs.existsSync(a), true); assert.equal(fs.existsSync(dst), false);
});
