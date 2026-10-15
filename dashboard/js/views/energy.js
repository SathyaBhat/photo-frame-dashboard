// Energy: live solar/battery/grid/home numbers and a power-flow chart (rolling 24 h, or a past day).
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, day: null, data: null, error: false, loading: false, at: 0, timer: null, sel: null };
  var W = 1150, H = 300, PL = 46, PB = 26, PT = 8, STALE_MS = 60 * 1000;
  // Stack order above zero, then below zero. Colours follow Home Assistant's energy dashboard.
  var UP = [['solar', 'Solar', '#F5A400'], ['discharge', 'Battery out', '#8E5CF7'], ['import', 'Grid in', '#3B6FFF']];
  var DOWN = [['charge', 'Battery in', '#B38BFF'], ['export', 'Grid out', '#2BB3A3']];

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

  function layers(e, defs, sign) {
    var acc = new Array(e.n), prev = new Array(e.n), out = [], i;
    for (i = 0; i < e.n; i++) { acc[i] = 0; }
    defs.forEach(function (d) {
      for (i = 0; i < e.n; i++) prev[i] = acc[i];
      for (i = 0; i < e.n; i++) acc[i] += e.series[d[0]][i] * sign;
      out.push({ def: d, lo: prev.slice(), hi: acc.slice() });
    });
    return { layers: out, top: acc };
  }

  function chart(e) {
    var up = layers(e, UP, 1), down = layers(e, DOWN, -1), i;
    var maxUp = Math.max.apply(null, up.top.concat(e.series.home)), maxDown = -Math.min.apply(null, down.top.concat([0]));
    var yMax = niceMax(maxUp), yMin = maxDown > 0.05 ? niceMax(maxDown) : 0;
    var iw = W - PL, ih = H - PB - PT;
    function x(i) { return PL + (e.n > 1 ? i / (e.n - 1) : 0) * iw; }
    function y(v) { return PT + (yMax - v) / (yMax + yMin) * ih; }
    function area(l) {
      var top = '', bot = '';
      for (i = 0; i < e.n; i++) top += (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(l.hi[i]).toFixed(1);
      for (i = e.n - 1; i >= 0; i--) bot += 'L' + x(i).toFixed(1) + ',' + y(l.lo[i]).toFixed(1);
      return '<path d="' + top + bot + 'Z" fill="' + l.def[2] + '"/>';
    }
    var home = '';
    for (i = 0; i < e.n; i++) home += (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(e.series.home[i]).toFixed(1);

    var grid = '', ticks = [yMax, yMax / 2, 0].concat(yMin ? [-yMin / 2, -yMin] : []);
    ticks.forEach(function (t) {
      grid += '<line x1="' + PL + '" x2="' + W + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" class="' + (t === 0 ? 'en-zero' : 'en-grid') + '"/>' +
        '<text x="' + (PL - 8) + '" y="' + (y(t) + 5).toFixed(1) + '" class="en-tick" text-anchor="end">' + (Math.abs(t) < 1 && t ? Math.abs(t).toFixed(1) : Math.abs(t)) + '</text>';
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
      up.layers.concat(down.layers).map(area).join('') +
      '<path d="' + home + '" class="en-home"/>' +
      '<line class="en-cursor" x1="0" x2="0" y1="' + PT + '" y2="' + (H - PB) + '"/>' +
      '<rect class="en-hit" x="' + PL + '" y="0" width="' + iw + '" height="' + H + '"/></svg>';
  }

  function readout(e, i) {
    var t = new Date(e.start + i * e.step);
    var when = new Intl.DateTimeFormat('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: e.zone }).format(t);
    var s = e.series;
    return '<b>' + when + '</b>' + UP.concat(DOWN).map(function (d) {
      return '<span><i style="background:' + d[2] + '"></i>' + d[1] + ' <b class="num">' + kw(s[d[0]][i]) + '</b> kW</span>';
    }).join('') + '<span><i class="en-home-key"></i>Home <b class="num">' + kw(s.home[i]) + '</b> kW</span>';
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
      tile('#3B6FFF', 'Grid', kw(Math.abs(grid)), grid > 0.05 ? 'importing' : grid < -0.05 ? 'exporting' : 'idle');
  }

  function totals(e) {
    var t = e.totals;
    return [['Solar made', t.solar], ['Home used', t.home], ['To grid', t.export], ['From grid', t.import], ['Battery in', t.charge], ['Battery out', t.discharge]].map(function (x) {
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
          if (ev.target.closest('[data-prev]')) {
            var today = V.data ? V.data.today : dayStr(Date.now());
            go(shiftDay(V.day || today, -1));
          } else if (ev.target.closest('[data-next]')) {
            var nx = shiftDay(V.day, 1), t = V.data ? V.data.today : dayStr(Date.now());
            go(nx >= t ? null : nx);
          } else if (ev.target.closest('[data-now]')) go(null);
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
