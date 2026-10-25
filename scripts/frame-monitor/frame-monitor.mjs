#!/usr/bin/env node
// Frame health monitor and freeze flight recorder. Runs on the dashboard server, next to adb.
//
// 1. Every POLL_S seconds it reads the frame's CPU (per process and per thread), memory, load, temperature and
//    CPU clock over adb, and writes them to InfluxDB (frame_sys, frame_proc, frame_thread).
// 2. When the kiosk runs with DevTools on (am start ... --ez debug true), it attaches over CDP, keeps a Chrome
//    trace in a ring buffer and pings the page every 2 s. When a ping goes unanswered for 3 s it treats the page
//    as frozen: it pauses the debugger every 2 s to sample the JS stack, saves the trace (the seconds before the
//    freeze and its start) to OUT, and writes a "freeze,source=cdp" point. kill -USR1 saves a trace by hand.
//
// Env: FRAME (ip:port, required), INFLUX_URL (default http://127.0.0.1:8181), INFLUX_TOKEN, INFLUX_DB (default
// frame), OUT (default diagnostics/akimart-rk3326/freezes), CDP_PORT (9222), POLL_S (10), TRACE (1; 0 = no ring
// trace, pings and stack samples only), TRACE_SAMPLES (0; 1 adds the V8 sampling profiler to the trace),
// CDP_DIRECT (1 = skip adb and attach to a desktop Chrome already listening on CDP_PORT, for testing).
// Reads only: nothing is installed or changed on the frame.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { line, createInflux } from '../../dashboard/server/influx.js';
import { sections, meminfo, cpuTotal, threads, threadName, cpuPct, procLabel } from './parse.mjs';

var run = promisify(execFile);
var ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
var FRAME = process.env.FRAME;
var DIRECT = process.env.CDP_DIRECT === '1';
if (!FRAME && !DIRECT) { console.error('Set FRAME to the frame\'s adb address (ip:5555)'); process.exit(1); }
var OUT = process.env.OUT || join(ROOT, 'diagnostics/akimart-rk3326/freezes');
var CDP_PORT = +process.env.CDP_PORT || 9222;
var POLL_S = +process.env.POLL_S || 10;
var TRACE = process.env.TRACE !== '0';
var influx = createInflux({ url: process.env.INFLUX_URL || 'http://127.0.0.1:8181', token: process.env.INFLUX_TOKEN, db: process.env.INFLUX_DB || 'frame' });
if (!influx) console.warn('INFLUX_TOKEN not set: metrics are only logged on freezes, not stored');
mkdirSync(OUT, { recursive: true });

// Threads always written, busy or not; any other thread is written only above 2%.
var KEEP = ['main', 'CrRendererMain', 'Compositor', 'Chrome_InProcGp', 'Chrome_ChildIOT', 'RenderThread', 'CrGpuMain'];
var CATS = ['toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame',
  'blink.user_timing', 'v8.execute', 'input', 'latencyInfo', 'loading'];
if (process.env.TRACE_SAMPLES === '1') CATS.push('disabled-by-default-v8.cpu_profiler');

function log() { console.log.apply(console, [new Date().toISOString()].concat([].slice.call(arguments))); }
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function write(lines) { if (influx) influx(lines).catch(function (e) { log('influx:', e.message); }); }

function adb(args, ms) { return run('adb', ['-s', FRAME].concat(args), { timeout: ms || 20000, maxBuffer: 8 << 20 }).then(function (r) { return r.stdout; }); }
function probe(ime) {
  return [
    'echo @mem; cat /proc/meminfo', 'echo @stat; head -n 1 /proc/stat', 'echo @load; cat /proc/loadavg',
    'echo @temp; cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null',
    'echo @freq; cat /sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_cur_freq 2>/dev/null',
    'ps -A -o PID,NAME | while read p n; do case "$n" in com.wesbos.homehq|*sandboxed_process*|system_server|surfaceflinger' + (ime ? '|' + ime : '') +
      ') echo "@proc $p $n"; grep VmRSS /proc/$p/status; cat /proc/$p/task/*/stat 2>/dev/null;; esac; done',
    'echo @sock; grep -o "webview_devtools_remote_[0-9]*" /proc/net/unix'
  ].join('; ');
}

// ------------------------------------------------------------------ device metrics
var prev = null, ime = null, connected = null;
async function ensureAdb() {
  try { if ((await adb(['get-state'], 8000)).trim() === 'device') return true; } catch (e) { /* not connected */ }
  try { await run('adb', ['connect', FRAME], { timeout: 10000 }); return (await adb(['get-state'], 8000)).trim() === 'device'; } catch (e) { return false; }
}

async function poll() {
  var now = Date.now();
  var ok = await ensureAdb();
  if (ok !== connected) { log(ok ? 'adb connected' : 'adb not connected (run adb tcpip 5555 over USB)'); connected = ok; }
  if (!ok) { prev = null; ime = null; cdpClose(); write([line('frame_sys', {}, { adb: 0 }, now)]); return; }
  if (ime === null) ime = ((await adb(['shell', 'settings get secure default_input_method']).catch(function () { return ''; })).trim().split('/')[0]) || '';
  var text = await adb(['shell', probe(ime)]).catch(function (e) { log('probe failed:', e.message); return null; });
  if (text === null) return;
  var cur = { at: now, cpu: null, proc: {}, thread: {} }, lines = [], sys = { adb: 1 }, sock = [];
  sections(text).forEach(function (s) {
    if (s.name === 'mem') { var m = meminfo(s.lines); sys.mem_avail_mb = Math.round(m.MemAvailable / 1024); sys.swap_used_mb = Math.round((m.SwapTotal - m.SwapFree) / 1024); }
    if (s.name === 'stat' && s.lines[0]) cur.cpu = cpuTotal(s.lines[0]);
    if (s.name === 'load' && s.lines[0]) sys.load1 = +s.lines[0].split(' ')[0];
    if (s.name === 'temp') { var t = s.lines.map(Number).filter(isFinite); if (t.length) sys.temp_c = Math.max.apply(null, t) / (Math.max.apply(null, t) > 1000 ? 1000 : 1); }
    if (s.name === 'freq') { var f = s.lines.map(Number).filter(isFinite); if (f.length) sys.freq_mhz = Math.max.apply(null, f) / 1000; }
    if (s.name === 'sock') sock = s.lines;
    if (s.name === 'proc') {
      var pid = +s.args[0], label = procLabel(s.args[1], ime), rss = /VmRSS:\s+(\d+)/.exec(s.lines.join('\n'));
      var ts = threads(s.lines.filter(function (l) { return /^\d+ \(/.test(l); })), sum = 0;
      ts.forEach(function (t) {
        var k = label + '\t' + threadName(t, pid);
        cur.thread[k] = (cur.thread[k] || 0) + t.ticks; sum += t.ticks;
      });
      cur.proc[label] = { ticks: (cur.proc[label] ? cur.proc[label].ticks : 0) + sum, rss: rss ? Math.round(rss[1] / 1024) : undefined, pid: pid };
    }
  });
  if (prev && cur.cpu && prev.cpu) {
    var secs = (now - prev.at) / 1000;
    var dt = cur.cpu.total - prev.cpu.total;
    if (dt > 0) sys.cpu_pct = Math.round((cur.cpu.busy - prev.cpu.busy) / dt * 1000) / 10;
    var pp = {}, cp = {};
    Object.keys(cur.proc).forEach(function (k) { cp[k] = cur.proc[k].ticks; if (prev.proc[k] && prev.proc[k].pid === cur.proc[k].pid) pp[k] = prev.proc[k].ticks; });
    var procPct = cpuPct(pp, cp, secs);
    Object.keys(cur.proc).forEach(function (k) { lines.push(line('frame_proc', { proc: k }, { cpu_pct: procPct[k], rss_mb: cur.proc[k].rss }, now)); });
    var thPct = cpuPct(prev.thread, cur.thread, secs);
    Object.keys(thPct).forEach(function (k) {
      var p = k.split('\t');
      if (KEEP.indexOf(p[1]) > -1 || thPct[k] >= 2) lines.push(line('frame_thread', { proc: p[0], thread: p[1] }, { cpu_pct: thPct[k] }, now));
    });
    var rm = thPct['renderer\tCrRendererMain'];
    if (rm >= 90) log('CrRendererMain at ' + rm + '% of a core');
  }
  lines.push(line('frame_sys', {}, sys, now));
  write(lines);
  prev = cur;
  var kiosk = cur.proc.kiosk;
  if (kiosk && sock.indexOf('webview_devtools_remote_' + kiosk.pid) > -1) { noDebugLogged = false; cdpEnsure(kiosk.pid); return; }
  if (cdp) cdpClose();
  if (!noDebugLogged) { noDebugLogged = true; log('kiosk DevTools socket not found: start it with --ez debug true for the flight recorder'); }
}

// ------------------------------------------------------------------ CDP flight recorder
var cdp = null, cdpPid = null, connecting = false, noDebugLogged = false;

function cdpSession(ws) {
  var id = 0, pending = {}, handlers = {};
  ws.addEventListener('message', function (ev) {
    var m = JSON.parse(ev.data);
    if (m.id && pending[m.id]) { var p = pending[m.id]; delete pending[m.id]; clearTimeout(p.t); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    else if (m.method && handlers[m.method]) handlers[m.method](m.params);
  });
  return {
    ws: ws,
    send: function (method, params, ms) {
      return new Promise(function (resolve, reject) {
        var i = ++id;
        pending[i] = { resolve: resolve, reject: reject, t: setTimeout(function () { delete pending[i]; reject(new Error(method + ' timed out')); }, ms || 15000) };
        ws.send(JSON.stringify({ id: i, method: method, params: params || {} }));
      });
    },
    on: function (ev, fn) { handlers[ev] = fn; }
  };
}

async function cdpEnsure(pid) {
  if ((cdp && cdpPid === pid) || connecting) return;
  connecting = true;
  try {
    cdpClose();
    if (pid !== 'direct') await adb(['forward', 'tcp:' + CDP_PORT, 'localabstract:webview_devtools_remote_' + pid]);
    var pages = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json', { signal: AbortSignal.timeout(10000) })).json();
    var page = pages.filter(function (p) { return p.type === 'page' && p.webSocketDebuggerUrl; })[0];
    if (!page) throw new Error('no page target');
    var ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(function (resolve, reject) { ws.onopen = resolve; ws.onerror = function () { reject(new Error('websocket error')); }; });
    var s = cdpSession(ws);
    ws.addEventListener('close', function () { if (cdp === s) { log('DevTools connection closed'); cdp = null; stopPing(); } });
    cdp = s; cdpPid = pid;
    await s.send('Debugger.enable');
    s.on('Debugger.paused', onPaused);
    s.on('Debugger.resumed', function () { paused = false; });
    if (TRACE) await traceStart();
    startPing();
    log('DevTools attached to ' + page.url + ' (kiosk pid ' + pid + ')' + (TRACE ? ', ring trace on' : ''));
  } catch (e) {
    log('DevTools attach failed:', e.message);
    cdpClose();
  } finally { connecting = false; }
}

function cdpClose() {
  stopPing();
  if (cdp) { try { cdp.ws.close(); } catch (e) { /* already gone */ } }
  cdp = null; cdpPid = null; tracing = false;
}

var tracing = false;
async function traceStart() {
  await cdp.send('Tracing.start', {
    transferMode: 'ReturnAsStream', streamFormat: 'json',
    traceConfig: { recordMode: 'recordContinuously', traceBufferSizeInKb: 32768, includedCategories: CATS }
  });
  tracing = true;
}

// Stop the ring trace and save it. The trace is flushed by the browser side, so this works while the page's
// main thread is still blocked; give it up to 3 minutes in case the renderer has to answer first.
async function traceSave(name) {
  if (!cdp || !tracing) return null;
  var s = cdp;
  tracing = false;
  var done = new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error('trace flush timed out')); }, 180000);
    s.on('Tracing.tracingComplete', function (p) { clearTimeout(t); resolve(p.stream); });
  });
  await s.send('Tracing.end', {}, 180000);
  var handle = await done, chunks = [];
  for (;;) {
    var r = await s.send('IO.read', { handle: handle, size: 1 << 20 }, 60000);
    chunks.push(r.base64Encoded ? Buffer.from(r.data, 'base64') : Buffer.from(r.data));
    if (r.eof) break;
  }
  await s.send('IO.close', { handle: handle }).catch(function () {});
  var file = join(OUT, name + '.json.gz');
  writeFileSync(file, gzipSync(Buffer.concat(chunks)));
  log('trace saved: ' + file);
  return file;
}

// Ping the page; an answer that takes over 3 s means its main thread is blocked.
var pingTimer = null, inflight = null, lastOk = 0, freeze = null, paused = false;
function startPing() { stopPing(); lastOk = Date.now(); pingTimer = setInterval(pingTick, 1000); }
function stopPing() { clearInterval(pingTimer); pingTimer = null; inflight = null; paused = false; freeze = null; }

function pingTick() {
  if (!cdp) return;
  var now = Date.now();
  if (inflight && now - inflight.at > 3000 && !freeze) onFreeze(inflight.at);
  if (freeze && now - freeze.lastPause >= 2000 && freeze.samples.length < 30) { freeze.lastPause = now; cdp.send('Debugger.pause', {}, 60000).catch(function () {}); }
  if (freeze && !freeze.saving && now - freeze.start > 8000) saveFreezeTrace();
  if (inflight || now - lastOk < 2000) return;
  var p = inflight = { at: now };
  var s = cdp;
  s.send('Runtime.evaluate', { expression: '1', returnByValue: true }, 600000).then(function () {
    if (inflight === p) inflight = null;
    // While our sampling pause holds the page, V8 still answers from the debugger's loop: not a recovery.
    if (paused) return;
    lastOk = Date.now();
    if (freeze) onResume();
  }).catch(function () { if (inflight === p) inflight = null; });
}

function onFreeze(since) {
  freeze = { start: since, lastPause: 0, samples: [], saving: null, name: 'freeze-' + stamp() };
  log('page frozen (no answer since ' + new Date(since).toISOString() + ')');
}

function frameText(f) {
  var url = (f.url || '').replace(/^.*\//, '');
  return (f.functionName || '(anonymous)') + ' ' + url + ':' + (f.location.lineNumber + 1) + ':' + (f.location.columnNumber + 1);
}

function onPaused(p) {
  var s = cdp;
  paused = true;
  if (freeze && p.reason !== 'exception') {
    freeze.samples.push({ t: Date.now() - freeze.start, reason: p.reason, frames: (p.callFrames || []).slice(0, 15).map(frameText) });
  }
  if (s) s.send('Debugger.resume').catch(function () {});
}

function saveFreezeTrace() {
  if (!freeze || freeze.saving) return;
  var f = freeze;
  f.saving = TRACE ? traceSave(f.name).catch(function (e) { log('trace save failed:', e.message); return null; }) : Promise.resolve(null);
}

async function onResume() {
  var f = freeze, ms = Date.now() - f.start;
  freeze = null;
  saveFreezeTrace();
  var file = await f.saving;
  var top = f.samples.length ? f.samples[0].frames.slice(0, 4).join(' < ') : '';
  var txt = 'Freeze ' + new Date(f.start).toISOString() + ', ' + Math.round(ms / 100) / 10 + ' s\n\n' + (f.samples.map(function (smp) {
    return '+' + (smp.t / 1000).toFixed(1) + 's (' + smp.reason + ')\n  ' + smp.frames.join('\n  ');
  }).join('\n\n') || 'No stack samples (blocked outside JS, or the pause never landed).') + '\n';
  writeFileSync(join(OUT, f.name + '.stacks.txt'), txt);
  log('page answered again after ' + Math.round(ms / 100) / 10 + ' s; ' + f.samples.length + ' stack samples' + (top ? ', top: ' + top : ''));
  write([line('freeze', { source: 'cdp' }, { ms: ms, samples: f.samples.length, stack: top, trace: file ? file.replace(/^.*\//, '') : '' }, f.start)]);
  if (TRACE && cdp && !tracing) traceStart().catch(function (e) { log('trace restart failed:', e.message); });
}

process.on('SIGUSR1', function () {
  if (!cdp) return log('USR1: DevTools not attached, nothing to save');
  if (!TRACE) return log('USR1: ring trace is off (TRACE=0)');
  traceSave('manual-' + stamp()).then(function () { return traceStart(); }).catch(function (e) { log('manual save failed:', e.message); });
});

log('frame monitor for ' + (DIRECT ? 'Chrome on port ' + CDP_PORT : FRAME) + ', every ' + POLL_S + ' s, traces to ' + OUT);
async function loop() {
  if (DIRECT) cdpEnsure('direct');
  else try { await poll(); } catch (e) { log('poll error:', e.message); }
  setTimeout(loop, POLL_S * 1000);
}
loop();
