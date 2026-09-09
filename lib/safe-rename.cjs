// Thin loader for the safe_rename N-API addon. Works from plain Node and from Electron main.
// Inside an asar archive, Electron redirects .node requires to app.asar.unpacked automatically.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
let addon = null;
function load() {
  if (addon) return addon;
  const candidates = [
    path.join(__dirname, '..', 'build', 'Release', 'safe_rename.node'),
    path.join(__dirname, '..', 'build', 'Debug', 'safe_rename.node'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) { addon = require(c); return addon; }
  }
  throw new Error('safe_rename.node is not built. Run: npm run build:native');
}
/**
 * Single-syscall rename that fails with EEXIST if dst exists. Never overwrites. Same volume only.
 * Does NOT check source identity - stat before, verify by inode after; a mismatch is an incident.
 * @param {string} src @param {string} dst
 * @returns {{ok:true} | {ok:false, code:string, errno:number, message:string}}
 */
function renameExcl(src, dst) { return load().renameExcl(src, dst); }
/** @returns {boolean} whether the platform primitive exists at all */
function supported() { return load().supported(); }
module.exports = { renameExcl, supported };
