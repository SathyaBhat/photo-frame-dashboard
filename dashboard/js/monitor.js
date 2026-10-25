// Health monitor (always on): a heartbeat every 10 s with long tasks, heap and DOM size, and a report after
// every freeze with the events that led up to it. The frame server writes both to InfluxDB for Grafana.
// Go and build times also go to the performance timeline, so they show up in DevTools traces.
(function () {
  'use strict';
  var App = window.App;
  var BEAT_MS = 10000, FREEZE_MS = 2000, CRUMBS = 40;
  var PAUSE_MS = 300000;
  var t0 = Date.now(), pausedUntil = 0;
  var crumbs = [], lt = { n: 0, max: 0, sum: 0 }, gapMax = 0, lastLong = { at: 0, ms: 0 };

  function crumb(s) {
    crumbs.push({ at: Date.now(), s: s });
    if (crumbs.length > CRUMBS) crumbs.shift();
  }
  function measure(label, start) {
    try { performance.measure(label, { start: start }); performance.clearMeasures(); } catch (e) { /* old WebView */ }
  }
  function describe(el) {
    if (!el || !el.tagName) return '?';
    var c = typeof el.className === 'string' && el.className.split(' ')[0];
    return el.tagName.toLowerCase() + (c ? '.' + c : '');
  }
  function isField(el) { return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable); }

  function post(body) {
    if (Date.now() < pausedUntil) return;
    // No keepalive: the frame's WebView never frees its 64 KiB keepalive budget, so beats failed after ~65 minutes.
    fetch('api/diag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      // No InfluxDB, or the proxy briefly lost the route during a deploy: pause, never stop for good.
      .then(function (r) { if (r.status === 503 || r.status === 404) pausedUntil = Date.now() + PAUSE_MS; })
      .catch(function () { /* server restarting: the next beat tries again */ });
  }

  // Wrap navigation and every view's build so the crumbs say what ran and for how long.
  var go = App.go;
  App.go = function (name) {
    var s = performance.now();
    go.apply(this, arguments);
    measure('go ' + name, s);
    crumb('go ' + name + ' ' + Math.round(performance.now() - s) + 'ms');
  };
  Object.keys(App.views).forEach(function (k) {
    var view = App.views[k], show = view.show;
    view.show = function (el, opts) {
      var s = performance.now();
      var r = show.apply(this, arguments);
      measure('build ' + k, s);
      crumb('build ' + k + (opts && opts.rerender ? ' (rerender)' : '') + ' ' + Math.round(performance.now() - s) + 'ms');
      return r;
    };
  });
  var sheet = App.sheet;
  App.sheet = function (html, opts) { crumb('sheet ' + ((opts && opts.cls) || '')); return sheet.apply(this, arguments); };

  document.addEventListener('pointerdown', function (e) { crumb('tap ' + describe(e.target)); }, true);
  document.addEventListener('focusin', function (e) { crumb('focus ' + describe(e.target)); });
  document.addEventListener('focusout', function (e) { crumb('blur ' + describe(e.target)); });
  document.addEventListener('visibilitychange', function () { crumb('visibility ' + document.visibilityState); });
  window.addEventListener('resize', function () { crumb('resize ' + innerWidth + 'x' + innerHeight); });
  window.addEventListener('error', function (e) { crumb('error ' + String(e.message).slice(0, 60)); });
  window.addEventListener('unhandledrejection', function (e) { crumb('rejection ' + String(e.reason).slice(0, 60)); });
  App.on('mode', function (m) { crumb('mode ' + m); });
  App.on('data', function () { crumb('data'); });

  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        lt.n++; lt.sum += e.duration;
        if (e.duration > lt.max) lt.max = e.duration;
        if (e.duration >= 200) crumb('long task ' + Math.round(e.duration) + 'ms');
        if (e.duration >= FREEZE_MS) lastLong = { at: Date.now(), ms: e.duration };
      });
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) { /* no long task API: the beat still has the gap */ }

  // A 1 s tick that runs late means the main thread was blocked. Report once it is free again, after the
  // long task entry for the freeze has had a moment to arrive: its duration is exact, the tick's is +-1 s.
  var last = Date.now();
  setInterval(function () {
    var now = Date.now(), late = now - last - 1000;
    last = now;
    if (late > gapMax) gapMax = late;
    if (late < FREEZE_MS || document.visibilityState !== 'visible') return;
    crumb('freeze ' + Math.round(late) + 'ms');
    setTimeout(function () {
      var end = Date.now(), ms = end - lastLong.at < 3000 ? Math.max(late, lastLong.ms) : late;
      post({
        kind: 'freeze', view: App.current, mode: App.mode || 'day', ms: Math.round(ms),
        crumbs: crumbs.map(function (c) { return ((c.at - end) / 1000).toFixed(1) + 's ' + c.s; })
      });
    }, 1000);
  }, 1000);

  setInterval(function () {
    var mem = performance.memory;
    post({
      kind: 'beat', view: App.current, mode: App.mode || 'day', gap: Math.max(0, Math.round(gapMax)),
      ltN: lt.n, ltMax: Math.round(lt.max), ltSum: Math.round(lt.sum),
      heap: mem ? Math.round(mem.usedJSHeapSize / 1048576) : undefined,
      dom: document.getElementsByTagName('*').length, w: innerWidth, h: innerHeight,
      focus: isField(document.activeElement), sheet: App.$('#sheetLayer').classList.contains('is-open'),
      up: Math.round((Date.now() - t0) / 1000), vis: document.visibilityState === 'visible'
    });
    lt = { n: 0, max: 0, sum: 0 }; gapMax = 0;
  }, BEAT_MS);
})();
