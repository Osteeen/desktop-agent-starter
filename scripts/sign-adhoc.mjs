import { execSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const dir = path.join(process.env.RELEASE_DIR || path.join(os.homedir(), 'dev', 'desktop-agent-release'), 'mac-arm64');
const app = fs.existsSync(dir) ? fs.readdirSync(dir).find(f => f.endsWith('.app')) : null;
if (!app) { console.error(`no .app in ${dir} - run electron-builder first`); process.exit(1); }
const appPath = path.join(dir, app);
let ids = '';
try { ids = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' }); } catch {}
const dev = ids.split('\n').find(l => l.includes('Apple Development'));
if (dev) {
  console.log('A development signing identity exists:\n  ' + dev.trim() + '\n  Set mac.identity in electron-builder.yml to it for permission grants that survive rebuilds.');
}
// No shell. An app named  Demo$(touch PWNED).app  executed that command when this string was
// interpolated into a shell invocation. Arguments go to the binary directly.
execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
console.log(`ad-hoc signed: ${appPath}\nNote: ad-hoc signatures change per build, so macOS may re-prompt for Screen Recording after each rebuild.`);
