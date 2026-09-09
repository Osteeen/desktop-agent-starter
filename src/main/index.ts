import { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { createOverlayWindow, createEdgeWindow, createOnboardingWindow, setOverlayInteractive } from './windows.js';
import { handle } from './ipc.js';
import { permissionStatus, openPermissionPane, promptAccessibility } from './permissions.js';
import { startCapture, stopCapture, freeze, captureStats, screenPermission } from './capture.js';
import { startInputSensor, input } from './sensors/input.js';
import { startWindowSensor, front } from './sensors/windows.js';
import { runRecoveryGate, formatReport } from './gates/recovery-gate.js';
import type { PermissionPane } from '../shared/channels.js';

const args = process.argv.slice(1);
const gateArg = args.find(a => a.startsWith('--gate='))?.split('=')[1];
const outArg = args.find(a => a.startsWith('--out='))?.split('=')[1];

let tray: Tray | null = null;
let overlay: BrowserWindow | null = null;
let edge: BrowserWindow | null = null;
let onboarding: BrowserWindow | null = null;
let overlayOpen = false;

function toggleOverlay(): void {
  if (!overlay) return;
  overlayOpen = !overlayOpen;
  if (overlayOpen) setOverlayInteractive(overlay, true);
  else { overlay.setIgnoreMouseEvents(true, { forward: true }); overlay.hide(); }
}

function buildTray(): void {
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'assets', 'iconTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip(app.getName());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Toggle overlay (Opt+Cmd+Z)', click: toggleOverlay },
    { label: 'Permissions…', click: () => { if (onboarding && !onboarding.isDestroyed()) onboarding.focus(); else onboarding = createOnboardingWindow(); } },
    { type: 'separator' },
    { label: 'Run recovery gate', click: async () => {
        const r = runRecoveryGate(app.isPackaged, process.execPath);
        const out = path.join(app.getPath('userData'), 'gates'); fs.mkdirSync(out, { recursive: true });
        fs.writeFileSync(path.join(out, 'recovery-gate.result.json'), JSON.stringify(r, null, 2));
        await dialog.showMessageBox({ message: r.pass ? 'Recovery gate: PASS' : 'Recovery gate: FAIL', detail: formatReport(r) + `\n\nWritten to ${out}` });
      } },
    { label: 'Capture stats', click: async () => { await dialog.showMessageBox({ message: 'Capture', detail: JSON.stringify(captureStats(), null, 2) }); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

function registerIpc(): void {
  handle('permissions:status', () => permissionStatus());
  handle<[PermissionPane]>('permissions:open', (_e, pane) => { openPermissionPane(pane); if (pane === 'Accessibility') promptAccessibility(); return true; });
  handle<[boolean]>('overlay:set-interactive', (_e, on) => { if (overlay) setOverlayInteractive(overlay, on); return true; });
  handle('overlay:hide', () => { if (overlay) { overlayOpen = false; overlay.setIgnoreMouseEvents(true, { forward: true }); overlay.hide(); } return true; });
  handle('edge:activated', () => { if (!overlayOpen) toggleOverlay(); return true; });
  handle('app:info', () => ({ name: app.getName(), version: app.getVersion(), packaged: app.isPackaged, electron: process.versions.electron, node: process.versions.node }));
}

async function main(): Promise<void> {
  if (gateArg === 'recovery') {                // headless gate run: no windows, prints and exits
    const r = runRecoveryGate(app.isPackaged, process.execPath);
    const text = formatReport(r);
    process.stdout.write(text + '\n');
    const outDir = outArg ?? path.join(app.getPath('userData'), 'gates');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'recovery-gate.result.json'), JSON.stringify(r, null, 2));
    process.stdout.write(`written: ${path.join(outDir, 'recovery-gate.result.json')}\n`);
    app.exit(r.pass ? 0 : 1); return;
  }
  if (gateArg === 'capture') {                 // measures capture + sensors running together
    if (process.platform === 'darwin') app.dock?.hide();
    const seconds = Number(args.find(a => a.startsWith('--seconds='))?.split('=')[1] ?? 30);
    const perm = screenPermission();
    process.stdout.write(`screen permission: ${perm}\n`);
    if (perm !== 'granted') {
      process.stdout.write(
        'REFUSING TO RUN. Screen Recording is not granted to this build.\n' +
        'Grant it first, from a normal launch, and answer the dialog before running this gate.\n' +
        'Running the capture loop while the permission dialog is open hangs the machine.\n');
      app.exit(2); return;
    }
    let clicks = 0, combos = 0, fronts = 0;
    input.on('click', () => clicks++); input.on('combo', () => combos++); front.on('change', () => fronts++);
    const inputOk = await startInputSensor();
    const windowOk = await startWindowSensor();
    const cap = startCapture();
    if (!cap.started) { process.stdout.write(`capture did not start: ${cap.reason}\n`); app.exit(2); return; }
    const t0 = Date.now(); const u0 = process.cpuUsage();
    await new Promise(r => setTimeout(r, seconds * 1000));
    const u = process.cpuUsage(u0); const elapsedUs = (Date.now() - t0) * 1000;
    const cpuPercent = ((u.user + u.system) / elapsedUs) * 100;
    const stats = captureStats();
    const report = {
      gate: 'capture', packaged: app.isPackaged, seconds,
      screenPermission: screenPermission(),
      inputSensorStarted: inputOk, windowSensorStarted: windowOk,
      framesInRing: stats.frames, expectedFrames: seconds * 3,
      ringMB: +(stats.bytes / 1048576).toFixed(1),
      avgFrameKB: stats.frames ? +(stats.bytes / stats.frames / 1024).toFixed(0) : 0,
      grabs: stats.grabs, captureErrors: stats.errors, lastCaptureError: stats.lastError,
      grabMsMedian: stats.grabMsMedian,
      clickEvents: clicks, comboEvents: combos, windowChanges: fronts,
      cpuPercent: +cpuPercent.toFixed(1),
      rssMB: +(process.memoryUsage().rss / 1048576).toFixed(0),
      ranAt: new Date().toISOString(),
    };
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    const outDir = outArg ?? path.join(app.getPath('userData'), 'gates');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'capture-gate.result.json'), JSON.stringify(report, null, 2));
    process.stdout.write(`written: ${path.join(outDir, 'capture-gate.result.json')}\n`);
    stopCapture(); app.exit(0); return;
  }
  if (process.platform === 'darwin') app.dock?.hide();
  registerIpc();
  buildTray();
  overlay = createOverlayWindow();
  edge = createEdgeWindow();
  globalShortcut.register('Alt+CommandOrControl+Z', toggleOverlay);
  input.on('error', (e) => console.warn('[input sensor]', String(e)));
  front.on('error', (e) => console.warn('[window sensor]', String(e)));
  void startInputSensor();
  void startWindowSensor();
  // Sensor events are emitted, not stored: the starter has no journal. A product subscribes here.
  input.on('combo', (e) => { if (process.env.STARTER_DEBUG) console.log('[combo]', e.combo); });
  front.on('change', (e) => { if (process.env.STARTER_DEBUG) console.log('[front]', e.appName, '-', e.title); });
  const st = permissionStatus();
  if (st.screen !== 'granted' || !st.accessibility) {
    // Show onboarding and do NOT start capture. Starting it while a permission dialog is
    // open queues blocked TCC checks against WindowServer and hangs the machine.
    onboarding = createOnboardingWindow();
  } else {
    const r = startCapture();
    if (!r.started) console.warn('[capture]', r.reason);
  }
  // Expose freeze() for products; exercised by the tray "Capture stats" item and the capture gate.
  void freeze;
}

app.whenReady().then(main);
app.on('will-quit', () => { globalShortcut.unregisterAll(); stopCapture(); });
app.on('window-all-closed', () => { /* tray app: keep running */ });
