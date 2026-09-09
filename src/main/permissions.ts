import { systemPreferences, shell } from 'electron';
import type { PermissionPane, PermissionStatus } from '../shared/channels.js';
let lastInputEventAt = 0;
export function noteInputEvent(): void { lastInputEventAt = Date.now(); }
export function permissionStatus(): PermissionStatus {
  const screen = process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted';
  const accessibility = process.platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(false) : true;
  // There is no API for Input Monitoring; the only signal is whether the hook delivers events.
  const inputMonitoring = lastInputEventAt === 0 ? 'unknown' : (Date.now() - lastInputEventAt < 15_000 ? 'flowing' : 'silent');
  return { screen, accessibility, inputMonitoring };
}
export function openPermissionPane(pane: PermissionPane): void {
  const ok: PermissionPane[] = ['ScreenCapture', 'Accessibility', 'ListenEvent'];
  if (!ok.includes(pane)) return;
  void shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?Privacy_${pane}`);
}
export function promptAccessibility(): void { if (process.platform === 'darwin') systemPreferences.isTrustedAccessibilityClient(true); }
