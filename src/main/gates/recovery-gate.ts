import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
type RenameResult = { ok: true } | { ok: false; code: string; errno: number; message: string };
const safe = require(path.join(__dirname, '..', '..', '..', 'lib', 'safe-rename.cjs')) as { renameExcl: (a: string, b: string) => RenameResult; supported: () => boolean };

export interface GateCase { name: string; status: 'PASS' | 'FAIL' | 'SKIP'; detail: string }
/** SKIP means not run or not tested. It is never evidence of a pass. */
export interface GateReport { gate: 'recovery'; ranAt: string; packaged: boolean; execPath: string; cases: GateCase[]; pass: boolean }

const ino = (p: string) => fs.lstatSync(p).ino;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-gate-'));

/** Runs the recovery gate against the primitive as loaded by THIS process (packaged or not). Never touches anything outside temp dirs. */
export function runRecoveryGate(packaged: boolean, execPath: string): GateReport {
  const cases: GateCase[] = [];
  const add = (name: string, status: GateCase['status'], detail: string) => cases.push({ name, status, detail });

  try {
    add('primitive available', safe.supported() ? 'PASS' : 'FAIL', `supported() = ${safe.supported()}`);
  } catch (e) { add('primitive available', 'FAIL', String(e)); }

  try { // 1. successful no-overwrite move preserves identity
    const d = tmp(); const a = path.join(d, 'a.txt'); const b = path.join(d, 'b.txt');
    fs.writeFileSync(a, 'A'); const i = ino(a);
    const r = safe.renameExcl(a, b);
    const good = r.ok && !fs.existsSync(a) && ino(b) === i;
    add('move succeeds and inode is preserved', good ? 'PASS' : 'FAIL', JSON.stringify(r));
  } catch (e) { add('move succeeds and inode is preserved', 'FAIL', String(e)); }

  try { // 2. destination collision refused, nothing changed
    const d = tmp(); const a = path.join(d, 'a.txt'); const b = path.join(d, 'b.txt');
    fs.writeFileSync(a, 'A'); fs.writeFileSync(b, 'B'); const ia = ino(a), ib = ino(b);
    const r = safe.renameExcl(a, b);
    const good = !r.ok && r.code === 'EEXIST' && fs.readFileSync(a, 'utf8') === 'A' && fs.readFileSync(b, 'utf8') === 'B' && ino(a) === ia && ino(b) === ib;
    add('destination collision refused with nothing changed', good ? 'PASS' : 'FAIL', JSON.stringify(r));
  } catch (e) { add('destination collision refused with nothing changed', 'FAIL', String(e)); }

  try { // 3. cross-volume refused
    const rootDev = fs.statSync('/').dev;
    const vols = fs.existsSync('/Volumes') ? fs.readdirSync('/Volumes').map(v => path.join('/Volumes', v)) : [];
    const other = vols.find(v => { try { fs.accessSync(v, fs.constants.W_OK); return fs.statSync(v).dev !== rootDev; } catch { return false; } });
    if (!other) add('cross-volume move refused (EXDEV)', 'SKIP', 'no second writable volume mounted - plug in an external drive to run this case');
    else {
      const d = tmp(); const a = path.join(d, 'a.txt'); fs.writeFileSync(a, 'A');
      const dst = path.join(other, `recovery-gate-${process.pid}.txt`);
      const r = safe.renameExcl(a, dst);
      const good = !r.ok && r.code === 'EXDEV' && fs.existsSync(a) && !fs.existsSync(dst);
      add('cross-volume move refused (EXDEV)', good ? 'PASS' : 'FAIL', JSON.stringify(r));
    }
  } catch (e) { add('cross-volume move refused (EXDEV)', 'FAIL', String(e)); }

  try { // 4. source identity change is detectable after the fact - reported as incident, no rollback
    const d = tmp(); const a = path.join(d, 'a.txt'); const b = path.join(d, 'b.txt');
    fs.writeFileSync(a, 'original'); const expected = ino(a);
    fs.unlinkSync(a); fs.writeFileSync(a, 'replacement');   // the race, simulated between precondition and call
    const r = safe.renameExcl(a, b);
    const mismatch = r.ok && ino(b) !== expected;
    const untouched = fs.readFileSync(b, 'utf8') === 'replacement' && !fs.existsSync(a);
    add('source-identity change detected by post-check; treated as incident, no rollback', mismatch && untouched ? 'PASS' : 'FAIL',
      `expected ino ${expected}, found ${fs.existsSync(b) ? ino(b) : 'none'}; result ${JSON.stringify(r)}`);
  } catch (e) { add('source-identity change detected by post-check; treated as incident, no rollback', 'FAIL', String(e)); }

  try { // 5. directory / symlink sources are the caller's precondition; the primitive itself renames them - document it
    const d = tmp(); const link = path.join(d, 'link'); const target = path.join(d, 'target.txt'); const dst = path.join(d, 'moved');
    fs.writeFileSync(target, 'T'); fs.symlinkSync(target, link);
    const r = safe.renameExcl(link, dst);
    const movedLinkNotTarget = r.ok && fs.lstatSync(dst).isSymbolicLink() && fs.existsSync(target);
    add('symlink source: primitive renames the link itself (caller must lstat and refuse)', movedLinkNotTarget ? 'PASS' : 'FAIL', JSON.stringify(r));
  } catch (e) { add('symlink source: primitive renames the link itself (caller must lstat and refuse)', 'FAIL', String(e)); }

  // Codex was right: this was an assertion dressed as a test result. It is a reasoned
  // expectation from the syscall's semantics, and it has never been experimentally
  // interrupted. Reporting it as PASS inflated the evidence.
  add('interruption safety', 'SKIP', 'NOT TESTED. Expected safe because the move is one syscall with no intermediate state, but no interruption experiment has been run. Do not present this as verified.');

  const pass = cases.every(c => c.status !== 'FAIL');
  return { gate: 'recovery', ranAt: new Date().toISOString(), packaged, execPath, cases, pass };
}
export function formatReport(r: GateReport): string {
  const lines = [`recovery gate - ${r.packaged ? 'PACKAGED app' : 'dev process'} - ${r.execPath}`, ''];
  for (const c of r.cases) lines.push(`${c.status.padEnd(4)} ${c.name}\n      ${c.detail}`);
  lines.push('', r.pass ? 'RESULT: PASS' : 'RESULT: FAIL');
  return lines.join('\n');
}
