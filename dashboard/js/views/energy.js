// Energy: live solar/battery/grid/home numbers and a power-flow chart (rolling 24 h, or a past day).
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, day: null, data: null, error: false, loading: false, at: 0, timer: null, sel: null, focus: null };
  var W = 1150, H = 300, PL = 46, PB = 26, PT = 8, STALE_MS = 60 * 1000;
  // Every series is drawn from zero on one positive axis (they overlap rather than stack).
  // Charging and discharge never happen together, and neither do grid in and out.
  var SERIES = [
    ['solar', 'Solar', '#F5A400', true], ['charge', 'Charging', '#00A36C', true], ['discharge', 'Discharge', '#8E5CF7', true],
    ['import', 'Grid in', '#E5261E', false], ['export', 'Grid out', '#2F6BFF', false]
  ];

  function kw(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  function kwh(v) { return v >= 100 ? Math.round(v) : v.toFixed(1); }
  function dayStr(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function shiftDay(s, n) { return dayStr(Date.parse(s + 'T00:00:00Z') + n * 864e5); }
  function dayLabel(s) {
    return new Date(Date.parse(s + 'T00:00:00Z')).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  // ------------------------------------------------------------ data
  function load(force) {
    if (V.loading || (!force && V.data && Date.now() - V.at < STALE_MS && V.data.day === V.day)) return;
    V.loading = true;
    var want = V.day;
    fetch('api/energy' + (want ? '?day=' + want : ''), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (res) {
      if (want !== V.day) return; // the user moved on while this was loading
      V.data = res.energy; V.at = Date.now(); V.error = false; V.sel = null;
    }).catch(function (e) {
      console.warn('HomeHQ energy history failed:', e.message);
      if (want === V.day) V.error = true;
    }).then(function () {
      V.loading = false;
      if (want !== V.day) load(true);
      paintChart();
    });
  }

  // ------------------------------------------------------------ chart
  function niceMax(v) {
    var steps = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 30, 50];
    for (var i = 0; i < steps.length; i++) if (v <= steps[i]) return steps[i];
    return Math.ceil(v / 10) * 10;
  }

  function chart(e) {
    var i, all = [].concat.apply([], SERIES.map(function (d) { return e.series[d[0]]; }).concat([e.series.home]));
    var yMax = niceMax(Math.max.apply(null, all));
    var iw = W - PL, ih = H - PB - PT;
    function x(i) { return PL + (e.n > 1 ? i / (e.n - 1) : 0) * iw; }
    function y(v) { return PT + (yMax - v) / yMax * ih; }
    function line(arr) {
      var d = '';
      for (i = 0; i < e.n; i++) d += (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(arr[i]).toFixed(1);
      return d;
    }
    function dim(key) { return V.focus && V.focus !== key ? ' class="en-dim"' : ''; }
    function layer(d) {
      var top = line(e.series[d[0]]);
      var fill = d[3] ? '<path d="' + top + 'L' + x(e.n - 1).toFixed(1) + ',' + y(0).toFixed(1) + 'L' + x(0).toFixed(1) + ',' + y(0).toFixed(1) + 'Z" fill="' + d[2] + '" fill-opacity=".35"/>' : '';
      return '<g' + dim(d[0]) + '>' + fill + '<path d="' + top + '" fill="none" stroke="' + d[2] + '" stroke-width="2.5" stroke-linejoin="round"/></g>';
    }
    var home = line(e.series.home);

    var grid = '', ticks = [yMax, yMax / 2, 0];
    ticks.forEach(function (t) {
      grid += '<line x1="' + PL + '" x2="' + W + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" class="' + (t === 0 ? 'en-zero' : 'en-grid') + '"/>' +
        '<text x="' + (PL - 8) + '" y="' + (y(t) + 5).toFixed(1) + '" class="en-tick" text-anchor="end">' + t + '</text>';
    });
    // Hour labels every 3 hours, in the house's time zone.
    var fmt = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', hour12: true, timeZone: e.zone });
    var hrs = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: e.zone });
    var end = e.start + e.n * e.step, xl = '';
    for (var t = Math.ceil(e.start / 36e5) * 36e5; t < end; t += 36e5) {
      if (+hrs.format(new Date(t)) % 3) continue;
      var tx = x((t - e.start) / e.step);
      xl += '<line x1="' + tx.toFixed(1) + '" x2="' + tx.toFixed(1) + '" y1="' + PT + '" y2="' + (H - PB) + '" class="en-grid"/>' +
        '<text x="' + tx.toFixed(1) + '" y="' + (H - 6) + '" class="en-tick" text-anchor="middle">' + fmt.format(new Date(t)).replace(' ', '') + '</text>';
    }
    return '<svg class="en-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + xl + grid +
      SERIES.map(layer).join('') +
      '<path d="' + home + '" class="en-home' + (V.focus && V.focus !== 'home' ? ' en-dim' : '') + '"/>' +
      '<line class="en-cursor" x1="0" x2="0" y1="' + PT + '" y2="' + (H - PB) + '"/>' +
      '<rect class="en-hit" x="' + PL + '" y="0" width="' + iw + '" height="' + H + '"/></svg>';
  }

  function readout(e, i) {
    var t = new Date(e.start + i * e.step);
    var when = new Intl.DateTimeFormat('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: e.zone }).format(t);
    var s = e.series;
    function item(key, name, color, val, cls) {
      return '<button class="en-key' + (V.focus === key ? ' is-focus' : V.focus ? ' is-dim' : '') + '" data-series="' + key + '"><i class="' + (cls || '') + '" style="background:' + color + '"></i>' + name + ' <b class="num">' + kw(val) + '</b> kW</button>';
    }
    return '<b>' + when + '</b>' + SERIES.map(function (d) { return item(d[0], d[1], d[2], s[d[0]][i]); }).join('') + item('home', 'Home', '#111111', s.home[i], 'en-home-key');
  }

  function setCursor(i) {
    var e = V.data;
    if (!e || !e.n) return;
    i = Math.max(0, Math.min(e.n - 1, i));
    V.sel = i;
    var svg = V.el.querySelector('.en-svg'), cur = svg && svg.querySelector('.en-cursor');
    if (cur) {
      var cx = PL + (e.n > 1 ? i / (e.n - 1) : 0) * (W - PL);
      cur.setAttribute('x1', cx); cur.setAttribute('x2', cx); cur.style.display = 'block';
    }
    V.el.querySelector('.en-readout').innerHTML = readout(e, i);
  }

  function bindChart() {
    var hit = V.el.querySelector('.en-hit'), svg = V.el.querySelector('.en-svg');
    if (!hit) return;
    function at(ev) {
      var r = svg.getBoundingClientRect(), fx = (ev.clientX - r.left) / r.width * W;
      setCursor(Math.round((fx - PL) / (W - PL) * (V.data.n - 1)));
    }
    var down = false;
    svg.addEventListener('pointerdown', function (ev) { down = true; try { svg.setPointerCapture(ev.pointerId); } catch (err) {} at(ev); });
    svg.addEventListener('pointermove', function (ev) { if (down) at(ev); });
    svg.addEventListener('pointerup', function () { down = false; });
    svg.addEventListener('pointercancel', function () { down = false; });
  }

  // ------------------------------------------------------------ paint
  function tiles() {
    var b = D.battery || {};
    var flow = b.flowKw || 0, grid = b.gridKw || 0;
    function tile(color, label, value, sub) {
      return '<div class="en-tile" style="--c:' + color + '"><span class="label">' + label + '</span><b class="num">' + value + '<small> kW</small></b><small>' + sub + '</small></div>';
    }
    return tile('#F5A400', 'Solar', kw(b.solarKw || 0), 'generating') +
      tile('#111111', 'Home', kw(b.homeKw || 0), 'using') +
      tile('#8E5CF7', 'Battery', kw(Math.abs(flow)), Math.round(b.soc || 0) + '% · ' + (flow > 0.05 ? 'charging' : flow < -0.05 ? 'discharging' : 'idle')) +
      tile('#2F6BFF', 'Grid', kw(Math.abs(grid)), grid > 0.05 ? 'importing' : grid < -0.05 ? 'exporting' : 'idle');
  }

  function totals(e) {
    var t = e.totals;
    return [['Solar made', t.solar], ['Home used', t.home], ['To grid', t.export], ['From grid', t.import], ['Charging', t.charge], ['Discharge', t.discharge]].map(function (x) {
      return '<div><span class="label">' + x[0] + '</span><b class="num">' + kwh(x[1]) + '<small> kWh</small></b></div>';
    }).join('');
  }

  function paintTiles() { if (V.el) V.el.querySelector('.en-tiles').innerHTML = tiles(); }

  function paintChart() {
    if (!V.el) return;
    var box = V.el.querySelector('.en-chart'), tot = V.el.querySelector('.en-totals'), ro = V.el.querySelector('.en-readout'), e = V.data;
    V.el.querySelector('.en-day').textContent = V.day ? dayLabel(V.day) : 'Last 24 hours';
    V.el.querySelector('[data-next]').disabled = !V.day;
    V.el.querySelector('[data-now]').classList.toggle('is-on', !V.day);
    if (!e || e.day !== V.day) {
      box.innerHTML = '<div class="en-msg">' + (V.error ? 'Couldn’t load history · tap to retry' : 'Loading…') + '</div>';
      tot.innerHTML = ''; ro.innerHTML = '';
      return;
    }
    if (e.empty) {
      box.innerHTML = '<div class="en-msg">No history for this day</div>';
      tot.innerHTML = ''; ro.innerHTML = '';
      return;
    }
    box.innerHTML = chart(e);
    tot.innerHTML = totals(e);
    bindChart();
    setCursor(V.sel == null ? e.n - 1 : V.sel);
  }

  function go(day) { V.day = day; V.sel = null; V.error = false; paintChart(); load(true); }

  App.register('energy', {
    show: function (el) {
      if (!V.el) {
        V.el = el;
        el.innerHTML = '<div class="energy">' +
          '<header class="en-top"><div><div class="label">Solar · battery · grid</div><h1 class="serif">Energy</h1></div>' +
          '<div class="en-nav"><button class="icon-btn" data-prev aria-label="Previous day">' + App.icon('left', 26) + '</button>' +
          '<span class="en-day"></span>' +
          '<button class="icon-btn" data-next aria-label="Next day">' + App.icon('right', 26) + '</button>' +
          '<button class="btn en-now" data-now>Last 24 h</button></div></header>' +
          '<div class="en-tiles"></div>' +
          '<div class="en-card"><div class="en-chart"></div><div class="en-readout"></div></div>' +
          '<div class="en-totals"></div></div>';
        el.addEventListener('click', function (ev) {
          var b;
          if (ev.target.closest('[data-prev]')) {
            var today = V.data ? V.data.today : dayStr(Date.now());
            go(shiftDay(V.day || today, -1));
          } else if (ev.target.closest('[data-next]')) {
            var nx = shiftDay(V.day, 1), t = V.data ? V.data.today : dayStr(Date.now());
            go(nx >= t ? null : nx);
          } else if (ev.target.closest('[data-now]')) go(null);
          else if ((b = ev.target.closest('[data-series]'))) { V.focus = V.focus === b.dataset.series ? null : b.dataset.series; paintChart(); }
          else if (V.error && ev.target.closest('.en-chart')) load(true);
        });
      }
      paintTiles();
      paintChart();
      // Only fetch while the page is on screen: hidden views get rebuilt in the background.
      if (App.current === 'energy') { load(false); clearInterval(V.timer); V.timer = setInterval(function () { load(false); }, STALE_MS); }
    },
    resume: function () { paintTiles(); load(false); clearInterval(V.timer); V.timer = setInterval(function () { load(false); }, STALE_MS); },
    hide: function () { clearInterval(V.timer); }
  });
})();
