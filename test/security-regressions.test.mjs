import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load, clock } from './support/ts-harness.mjs';

// Keep the normal npm test command usable; isolate VM module mocks in a child process.
if (!vm.SourceTextModule) {
  test('sensor security regressions', () => {
    execFileSync(process.execPath, ['--experimental-vm-modules', '--test', fileURLToPath(import.meta.url)], { stdio: 'pipe' });
  });
} else {
  const electron = (getSources, permission) => ({
    desktopCapturer: { getSources },
    screen: { getPrimaryDisplay: () => ({ size: { width: 100, height: 100 } }) },
    systemPreferences: { getMediaAccessStatus: permission },
  });
  for (const first of ['capture', 'prompt']) {
    test(`C11a: ${first} first shares one uncancellable request and permanent latch`, async () => {
      const time = clock();
      let permission = first === 'capture' ? 'granted' : 'denied';
      let calls = 0;
      const capture = await load('src/main/capture.ts', time.globals, {
        electron: electron(() => { calls++; return new Promise(() => {}); }, () => permission),
      });
      const prompts = [];
      if (first === 'capture') {
        capture.startCapture();
        await time.advance(600);
        permission = 'denied';
        prompts.push(capture.requestScreenPermission());
      } else {
        prompts.push(capture.requestScreenPermission(), capture.requestScreenPermission());
        permission = 'granted';
        capture.startCapture();
        await time.advance(600);
      }
      assert.equal(calls, 1);
      await time.advance(10_000);
      assert.equal((await Promise.all(prompts)).every(result => typeof result.status === 'string'), true);
      permission = 'granted';
      assert.equal(capture.startCapture().started, false);
      permission = 'denied';
      assert.equal((await capture.requestScreenPermission()).prompted, false);
      await time.advance(10_000);
      assert.equal(calls, 1);
      assert.deepEqual(time.errors, []);
    });
  }
  test('C11a: shared rejection is handled by every caller and ordinary errors can retry', async () => {
    const time = clock();
    let rejectRequest, calls = 0, permission = 'denied';
    const capture = await load('src/main/capture.ts', time.globals, {
      electron: electron(() => { calls++; return new Promise((_, reject) => { rejectRequest = reject; }); }, () => permission),
    });
    const prompts = [capture.requestScreenPermission(), capture.requestScreenPermission()];
    permission = 'granted';
    capture.startCapture();
    await time.advance(600);
    rejectRequest(new Error('controlled failure'));
    await Promise.all(prompts);
    assert.equal(calls, 1);
    await time.advance(500);
    assert.equal(calls, 2);
    capture.stopCapture();
    rejectRequest(new Error('controlled failure'));
    await time.advance(500);
    assert.deepEqual(time.errors, []);
  });
  for (const packaged of [false, true]) {
    test(`C8c/C10: ${packaged ? 'packaged' : 'checkout'} adapter, no subprocess after timeout and restart`, async () => {
      const time = clock();
      let calls = 0;
      const entry = packaged ? '/test/app.asar/node_modules/get-windows/index.js' : '/test/node_modules/get-windows/index.js';
      const adapter = packaged ? 'file:///test/app.asar.unpacked/node_modules/get-windows/lib/macos.js' : 'file:///test/node_modules/get-windows/lib/macos.js';
      const sensor = await load('src/main/sensors/windows.ts', { ...time.globals, __filename: '/test/windows.cjs' }, {
        'node:events': { EventEmitter }, 'node:path': path, 'node:url': { pathToFileURL },
        'node:module': { createRequire: () => ({ resolve: () => entry }) },
        [adapter]: { activeWindow: () => { calls++; return new Promise(() => {}); } },
      });
      sensor.front.on('error', () => {});
      assert.equal(await sensor.startWindowSensor(), true);
      await time.advance(30_000);
      assert.equal(calls, 1);
      assert.equal(time.intervals, 0);
      for (let attempt = 0; attempt < 3; attempt++) {
        sensor.stopWindowSensor();
        assert.equal(await sensor.startWindowSensor(), false);
        await time.advance(4000);
      }
      assert.equal(calls, 1);
      assert.deepEqual(time.errors, []);
    });
  }
  test('C3: Command remains mandatory; folder navigation survives', async () => {
    const hook = new EventEmitter();
    hook.start = () => {};
    const names = ['Z', 'Q', 'W', 'S', 'C', 'X', 'V', 'N', 'O', 'Backspace', 'Delete', 'F', 'G', 'ArrowUp', 'A', '1', 'Enter'];
    const keys = Object.fromEntries(names.map((name, index) => [name, index]));
    const sensor = await load('src/main/sensors/input.ts', {}, {
      'node:events': { EventEmitter }, '../permissions.js': { noteInputEvent() {} },
      'uiohook-napi': { uIOhook: hook, UiohookKey: keys },
    });
    const emitted = [];
    sensor.input.on('combo', event => emitted.push(event.combo));
    assert.equal(await sensor.startInputSensor(), true);
    for (const name of names) for (let mask = 0; mask < 16; mask++) {
      const before = emitted.length;
      hook.emit('keydown', { keycode: keys[name], metaKey: !!(mask & 8), ctrlKey: !!(mask & 4), altKey: !!(mask & 2), shiftKey: !!(mask & 1) });
      assert.equal(emitted.length - before, (mask & 8) && names.indexOf(name) < 14 ? 1 : 0);
    }
    assert.equal(emitted.length, 112);
    assert.ok(emitted.includes('Cmd+Shift+G'));
    assert.ok(emitted.includes('Cmd+ArrowUp'));
  });
}
