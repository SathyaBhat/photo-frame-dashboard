// node --test scripts/frame-monitor/parse.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sections, meminfo, cpuTotal, threads, threadName, cpuPct, procLabel } from './parse.mjs';

test('sections groups lines under @ headers and keeps their arguments', function () {
  var s = sections('@mem\r\nMemTotal:  1000 kB\n\n@proc 812 com.wesbos.homehq\nVmRSS:\t 2048 kB\n');
  assert.equal(s.length, 2);
  assert.deepEqual(s[1], { name: 'proc', args: ['812', 'com.wesbos.homehq'], lines: ['VmRSS:\t 2048 kB'] });
  assert.deepEqual(s[0].lines, ['MemTotal:  1000 kB']);
});

test('meminfo reads kB values', function () {
  assert.deepEqual(meminfo(['MemAvailable:   204800 kB', 'SwapFree: 1 kB', 'junk']), { MemAvailable: 204800, SwapFree: 1 });
});

test('cpuTotal counts idle and iowait as not busy', function () {
  assert.deepEqual(cpuTotal('cpu  100 0 50 800 50 0 0 0 0 0'), { busy: 150, total: 1000 });
});

test('threads parses comm with spaces and sums utime and stime', function () {
  var l = '901 (Chrome Child) S 812 812 0 0 -1 1077952576 3 0 0 0 250 30 0 0 20 0 30 0 1 0 0';
  assert.deepEqual(threads([l, 'garbage']), [{ tid: 901, comm: 'Chrome Child', ticks: 280 }]);
});

test('threadName folds numbers and calls the process main thread main', function () {
  assert.equal(threadName({ tid: 812, comm: 'com.wesbos.home' }, 812), 'main');
  assert.equal(threadName({ tid: 900, comm: 'Binder:812_3' }, 812), 'Binder:#_#');
});

test('cpuPct gives % of one core and skips new or restarted keys', function () {
  assert.deepEqual(cpuPct({ a: 100, b: 500 }, { a: 1100, b: 10, c: 5 }, 10), { a: 100 });
});

test('procLabel names the kiosk, renderer and keyboard', function () {
  assert.equal(procLabel('com.wesbos.homehq'), 'kiosk');
  assert.equal(procLabel('com.android.webview:sandboxed_process0'), 'renderer');
  assert.equal(procLabel('com.android.inputmethod.latin', 'com.android.inputmethod.latin'), 'ime');
  assert.equal(procLabel('system_server', ''), 'system_server');
});
