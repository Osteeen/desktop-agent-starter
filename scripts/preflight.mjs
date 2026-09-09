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
// macOS attributes a TCC grant to the process that launched Electron. Run from a terminal that
// holds the grant, the answer is real. Run from an editor, a CI job, or an agent's shell, every
// permission reads as denied no matter what the user has actually granted - and reporting that as
// FAIL sends people to System Settings to re-grant something that was never revoked.
const interactive = Boolean(process.stdout.isTTY || process.env.TERM_PROGRAM || process.env.SSH_TTY);
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
// Ask Electron, which has the real APIs, instead of reading a database that needs Full Disk
// Access. Also exercises the window sensor, whose failure message names the pane it needs.
let perms = null;
if (fs.existsSync(path.join(cwd, 'dist', 'main', 'index.js'))) {
  const out = sh('npx electron . --gate=permissions 2>/dev/null');
  try { perms = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); } catch { /* ignore */ }
}
if (!perms) {
  warn('Permissions', 'could not query Electron. Run: npx electron . --gate=permissions');
} else {
  const granted = perms.screenRecording === 'granted' && perms.accessibility
    && String(perms.windowSensor).startsWith('working');
  if (!interactive && !granted) {
    // Do not send someone to System Settings for a grant they already have.
    warn('Permissions', 'CANNOT BE ASSESSED from this process.\n'
      + '       macOS ties the grant to whatever launched Electron, and that was not an interactive\n'
      + '       terminal here, so everything reads as denied regardless of what you have granted.\n'
      + '       Run this from your own terminal for a real answer. Nothing is wrong.');
  } else {
    perms.screenRecording === 'granted'
      ? ok('Screen Recording', 'granted to the dev Electron binary')
      : bad('Screen Recording', `${perms.screenRecording}. Needed for frames.\n       System Settings > Privacy & Security > Screen Recording > + > node_modules/electron/dist/Electron.app, then relaunch.`);
    perms.accessibility
      ? ok('Accessibility', 'granted - window titles available')
      : bad('Accessibility', `not granted. This is a DIFFERENT pane from Screen Recording, and it is what\n       the window sensor needs. System Settings > Privacy & Security > Accessibility > + >\n       node_modules/electron/dist/Electron.app, then relaunch.`);
    String(perms.windowSensor).startsWith('working')
      ? ok('Window sensor', perms.windowSensor)
      : bad('Window sensor', String(perms.windowSensor));
  }
  if (interactive || perms.inputMonitoring === 'flowing') {
    perms.inputMonitoring === 'flowing'
      ? ok('Input Monitoring', 'events arriving')
      : warn('Input Monitoring', `${perms.inputMonitoring}. No status API exists; it is inferred from whether events arrive.\n       Run the app, click a few times, and check the onboarding screen.`);
  }
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
  const src = fs.statSync(path.join(cwd, 'src', 'main', 'gates', 'recovery-gate.ts')).mtimeMs;
  const ran = Date.parse(r.ranAt ?? '');
  if (!Number.isFinite(ran)) {
    bad('Recovery gate', 'the report has no usable timestamp, so its freshness cannot be established. Regenerate it.');
  } else if (ran < src) {
    bad('Recovery gate', `STALE: the report is older than the gate source. Regenerate it - a report that\n       predates the code it describes is not evidence.`);
  } else {
    const skips = (r.cases ?? []).filter(c => c.status === 'SKIP');
    if (!r.packaged) warn('Recovery gate', 'this report is from a dev process. The packaged app is what you present, so regenerate it from there before Saturday.');
    r.pass ? ok('Recovery gate', `passed${r.packaged ? ' from the packaged app' : ' (dev process only)'}${skips.length ? `, ${skips.length} case(s) NOT TESTED: ${skips.map(c=>c.name).join('; ')}` : ''}`)
           : bad('Recovery gate', 'recorded a failure - open the file');
  }
} else warn('Recovery gate', 'never run - npm run gate:recovery');
const ag = path.join(cwd, 'gates', 'eval', 'eval.dev.result.json');
if (!fs.existsSync(ag)) warn('Prompt eval', 'never run - the one open question. node gates/eval/run.mjs');
else {
  const r = JSON.parse(fs.readFileSync(ag, 'utf8'));
  const su = r.summary ?? {};
  const rows = r.rows ?? [];
  // A summary that disagrees with its own rows is not evidence of anything.
  const inconsistencies = [];
  if (!Array.isArray(r.rows) || rows.length === 0) inconsistencies.push('no result rows');
  if (su.cases !== undefined && rows.length && su.cases !== rows.length) inconsistencies.push(`summary says ${su.cases} cases, ${rows.length} rows present`);
  for (const k of ['pass', 'fail', 'invalid', 'unsupported', 'errored']) {
    const counted = rows.filter(x => x.verdict === k.toUpperCase().replace('ERRORED', 'ERROR')).length;
    if (su[k] !== undefined && su[k] !== counted) inconsistencies.push(`summary.${k}=${su[k]} but ${counted} row(s) say so`);
  }
  if (su.valid === false) inconsistencies.push('the run marked itself invalid');
  const ranAt = Date.parse(su.ranAt ?? r.ranAt ?? '');
  if (!Number.isFinite(ranAt)) inconsistencies.push('no usable timestamp');
  const v = (name) => rows.filter(x => x.verdict === name).length;
  const errored = su.errored ?? rows.filter(x => x.err).length;
  const invalid = su.invalid ?? v('INVALID');
  const unsupported = su.unsupported ?? v('UNSUPPORTED');
  const pct = (n) => `${Math.round((n ?? 0) * 100)}%`;
  // "Beats the baseline" is not "ready to demonstrate". An errored or invalid run measures
  // nothing, and the safety-sensitive cases must pass on their own merits.
  if (inconsistencies.length) {
    bad('Prompt eval', `report is not internally consistent, so it is not evidence: ${inconsistencies.join('; ')}`);
  } else if (errored) {
    bad('Prompt eval', `INVALID RUN: ${errored}/${su.cases ?? rows.length} cases errored, so no accuracy was measured.`);
  } else if (invalid) {
    bad('Prompt eval', `${invalid} answer(s) contained an invented id or citation. Correctness failure regardless of score. Do not report an accuracy.`);
  } else {
    // Codex: matching prose meant a case with a missing or reworded `tests` field silently
    // stopped being safety-sensitive. Use an explicit flag on the fixture instead.
    const safety = rows.filter(x => x.safety === true);
    const safetyFails = safety.filter(x => x.verdict !== 'PASS');
    const beats = (su.modelAccuracy ?? 0) > (su.baselineAccuracy ?? 0);
    if (!beats) bad('Prompt eval', `model ${pct(su.modelAccuracy)} does not beat baseline ${pct(su.baselineAccuracy)}. Revisit the product claim.`);
    else if (safetyFails.length) bad('Prompt eval', `beats baseline (${pct(su.modelAccuracy)} vs ${pct(su.baselineAccuracy)}) but ${safetyFails.length} safety case(s) failed: ${safetyFails.map(x=>x.id).join(', ')}. Not demonstrable.`);
    else if (unsupported) warn('Prompt eval', `${pct(su.modelAccuracy)} vs ${pct(su.baselineAccuracy)}, safety cases pass, but ${unsupported} answer(s) had no supporting evidence.`);
    else ok('Prompt eval', `${pct(su.modelAccuracy)} vs baseline ${pct(su.baselineAccuracy)}, safety cases pass, every match evidenced.`);
  }
}
fs.existsSync(path.join(cwd, 'gates', 'eval', 'fixtures', 'cases.hidden.json'))
  ? ok('Held-out cases', 'written')
  : warn('Held-out cases', 'missing - copy the example file and write ten');

// --- machine headroom ---
const load = Number(os.loadavg()[0].toFixed(2));
load < os.cpus().length ? ok('Machine load', `${load} over ${os.cpus().length} cores`) : warn('Machine load', `${load} is high for ${os.cpus().length} cores`);
const free = Number(sh("df -g / | tail -1 | awk '{print $4}'") || 0);
free > 10 ? ok('Free disk', `${free} GB`) : warn('Free disk', `${free} GB - packaging needs a few`);

// --- report ---
const pad = Math.max(...rows.map(r => r.n.length));
console.log('\nPRE-FLIGHT\n');
console.log(interactive
  ? '  Interactive terminal detected, so the permission results below are real.\n'
  : '  NOT an interactive terminal. macOS ties permission grants to whatever launched Electron,\n  so permission checks are skipped here rather than reported as failures. Everything else is valid.\n');
for (const r of rows) console.log(`  ${r.s.padEnd(5)} ${r.n.padEnd(pad)}  ${r.d}`);
const f = rows.filter(r => r.s === 'FAIL').length, w = rows.filter(r => r.s === 'WARN').length;
console.log(`\n  ${rows.length - f - w} pass, ${w} warn, ${f} fail\n`);
console.log(f ? '  Fix the failures before building.\n' : '  Nothing blocking.\n');
process.exit(f ? 1 : 0);
