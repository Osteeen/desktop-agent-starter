#!/usr/bin/env node
// Pre-flight: everything that must be true before you start building, and again
// before you record. Checks the environment only - it knows nothing about the product.
//   node scripts/preflight.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const rows = [];
const ok   = (n, d) => rows.push({ s: 'PASS', n, d });
const bad  = (n, d) => rows.push({ s: 'FAIL', n, d });
const warn = (n, d) => rows.push({ s: 'WARN', n, d });
const sh = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim(); } catch { return null; } };

// --- toolchain ---
const node = process.versions.node.split('.')[0];
Number(node) >= 20 ? ok('Node', `v${process.versions.node}`) : bad('Node', `v${process.versions.node} - need 20+`);
sh('xcode-select -p') ? ok('Xcode command line tools', sh('xcode-select -p')) : bad('Xcode command line tools', 'run: xcode-select --install');

// --- the project path trap ---
const cwd = process.cwd();
/[&()' ]/.test(cwd)
  ? warn('Project path', `contains characters the packager rejects: ${cwd}\n       On build day, fork into a plain path such as ~/dev/my-agent`)
  : ok('Project path', cwd);

// --- the safe-rename addon ---
try {
  const { supported, renameExcl } = require(path.join(cwd, 'lib', 'safe-rename.cjs'));
  if (!supported()) bad('safe-rename addon', 'built but reports unsupported platform');
  else {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'));
    const a = path.join(d, 'a'), b = path.join(d, 'b');
    fs.writeFileSync(a, 'x'); fs.writeFileSync(b, 'y');
    const collision = renameExcl(a, b);
    const clean = renameExcl(a, path.join(d, 'c'));
    (collision.ok === false && collision.code === 'EEXIST' && clean.ok === true)
      ? ok('safe-rename addon', 'refuses collisions, moves cleanly')
      : bad('safe-rename addon', `unexpected: ${JSON.stringify(collision)} / ${JSON.stringify(clean)}`);
    fs.rmSync(d, { recursive: true, force: true });
  }
} catch (e) { bad('safe-rename addon', `${e.message} - run: npm run build:native`); }

// --- compiled output ---
fs.existsSync(path.join(cwd, 'dist', 'main', 'index.js'))
  ? ok('TypeScript build', 'dist/ present')
  : warn('TypeScript build', 'dist/ missing - run: npm run build:ts');

// --- permissions, the thing that hangs you if wrong ---
const devApp = path.join(cwd, 'node_modules', 'electron', 'dist', 'Electron.app');
fs.existsSync(devApp) ? ok('Dev Electron binary', devApp) : bad('Dev Electron binary', 'run: npm install');
const tcc = sh(`sqlite3 "${os.homedir()}/Library/Application Support/com.apple.TCC/TCC.db" "select service,client,auth_value from access" 2>/dev/null`);
if (tcc === null) {
  warn('Screen Recording grant', 'cannot read the permissions database without Full Disk Access.\n       Check by hand: System Settings > Privacy & Security > Screen Recording > "Electron" is on.');
} else {
  /ScreenCapture\|[^|]*[Ee]lectron[^|]*\|2/.test(tcc)
    ? ok('Screen Recording grant', 'granted to Electron')
    : bad('Screen Recording grant', 'not granted to the dev Electron binary.\n       Launch it once, then enable it in System Settings > Privacy & Security > Screen Recording.');
}

// --- API key ---
sh('security find-generic-password -a "$USER" -s agent-starter-openai -w')
  ? ok('API key in Keychain', 'present')
  : warn('API key in Keychain', 'run: bash scripts/set-api-key.sh');
process.env.OPENAI_API_KEY
  ? ok('API key in this shell', 'exported')
  : warn('API key in this shell', 'add the export line to ~/.zshrc and open a new terminal');
if (process.env.OPENAI_API_KEY) {
  // /v1/models is free and does not consume credit, so it separates "key is bad"
  // from "account has no credit" - a 401 is the key, a 429 is the balance.
  const code = sh(`curl -s -o /dev/null -w '%{http_code}' https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"`);
  if (code === '200') ok('API key works', 'authenticated (this check is free)');
  else if (code === '401') bad('API key works', 'HTTP 401 - the key is rejected as invalid. Not a credit problem. Generate a new key.');
  else if (code === '429') warn('API key works', 'HTTP 429 - key is valid but the account is out of credit.');
  else warn('API key works', `HTTP ${code ?? 'no response'} - could not reach the API`);
}

// --- evidence so far ---
const rg = path.join(cwd, 'gates', 'recovery-gate.result.json');
if (fs.existsSync(rg)) {
  const r = JSON.parse(fs.readFileSync(rg, 'utf8'));
  r.pass ? ok('Recovery gate', `passed${r.packaged ? ' from the packaged app' : ' (dev process only)'}`)
         : bad('Recovery gate', 'recorded a failure - open the file');
} else warn('Recovery gate', 'never run - npm run gate:recovery');
const ag = path.join(cwd, 'gates', 'eval', 'eval.dev.result.json');
if (!fs.existsSync(ag)) warn('Prompt eval', 'never run - node gates/eval/run.mjs');
else {
  const r = JSON.parse(fs.readFileSync(ag, 'utf8'));
  const errs = (r.rows ?? []).filter(x => x.err).length;
  if (errs) bad('Prompt eval', `last run: every case errored (${errs}/${r.summary.cases}). Not a real result.`);
  else if (r.summary.modelAccuracy > r.summary.baselineAccuracy)
    ok('Prompt eval', `model ${Math.round(r.summary.modelAccuracy*100)}% vs baseline ${Math.round(r.summary.baselineAccuracy*100)}%`);
  else bad('Prompt eval', `model ${Math.round(r.summary.modelAccuracy*100)}% does not beat baseline ${Math.round(r.summary.baselineAccuracy*100)}%`);
}
fs.existsSync(path.join(cwd, 'gates', 'eval', 'fixtures', 'cases.hidden.json'))
  ? ok('Held-out cases', 'written')
  : warn('Held-out cases', 'missing - copy the example and write your own');

// --- machine headroom ---
const load = Number(os.loadavg()[0].toFixed(2));
load < os.cpus().length ? ok('Machine load', `${load} over ${os.cpus().length} cores`) : warn('Machine load', `${load} is high for ${os.cpus().length} cores`);
const free = Number(sh("df -g / | tail -1 | awk '{print $4}'") || 0);
free > 10 ? ok('Free disk', `${free} GB`) : warn('Free disk', `${free} GB - packaging needs a few`);

// --- report ---
const pad = Math.max(...rows.map(r => r.n.length));
console.log('\nPRE-FLIGHT\n');
for (const r of rows) console.log(`  ${r.s.padEnd(5)} ${r.n.padEnd(pad)}  ${r.d}`);
const f = rows.filter(r => r.s === 'FAIL').length, w = rows.filter(r => r.s === 'WARN').length;
console.log(`\n  ${rows.length - f - w} pass, ${w} warn, ${f} fail\n`);
console.log(f ? '  Fix the failures before building.\n' : '  Nothing blocking.\n');
process.exit(f ? 1 : 0);
