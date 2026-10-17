// Settings: every option the frame itself can change. Saved in localStorage (see settings.js).
(function () {
  'use strict';
  var V = { el: null };
  var S = function () { return App.settings; };

  function hourLabel(h) { return App.fmt.hour(new Date(2000, 0, 1, h)); }
  function secs(n) { return n < 60 ? n + ' s' : n / 60 + ' min'; }

  function seg(key, opts, cur) {
    return '<div class="seg" data-key="' + key + '">' + opts.map(function (o) {
      return '<button data-v="' + o[0] + '" class="' + (String(o[0]) === String(cur) ? 'is-on' : '') + '">' + App.esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function row(name, note, body) {
    return '<div class="st-row"><div class="st-name"><b>' + name + '</b>' + (note ? '<small>' + note + '</small>' : '') + '</div>' + body + '</div>';
  }
  function btns(attr, items) {
    return '<div class="st-btns">' + items.map(function (i) {
      return '<button ' + attr + '="' + i[0] + '"' + (i[2] ? ' class="is-on"' : '') + '>' + App.esc(i[1]) + '</button>';
    }).join('') + '</div>';
  }
  function card(title, rows) { return '<section class="st-card"><div class="label">' + title + '</div>' + rows.join('') + '</section>'; }

  function diagOn() { try { return localStorage.getItem('hq-diag') === '1'; } catch (e) { return false; } }

  function html() {
    var g = S().get;
    return '<div class="settings">' +
      '<header class="st-head"><div><div class="label">This frame</div><h1 class="serif">Settings</h1></div>' +
      '<button class="st-reset" data-reset>Reset to defaults</button></header>' +
      '<div class="st-grid">' +
      card('Idle', [
        row('Back to Today', 'after no touch', seg('idleHome', [30, 60, 120, 300].map(function (n) { return [n, secs(n)]; }), g('idleHome'))),
        row('Photo frame', 'ambient mode after no touch', seg('idleAmbient', [60, 120, 300, 600].map(function (n) { return [n, secs(n)]; }), g('idleAmbient')))
      ]) +
      card('Night', [
        row('Starts', 'dim red clock', seg('nightFrom', [20, 21, 22, 23].map(function (h) { return [h, hourLabel(h)]; }), g('nightFrom'))),
        row('Ends', '', seg('nightTo', [5, 6, 7, 8].map(function (h) { return [h, hourLabel(h)]; }), g('nightTo')))
      ]) +
      card('Photos', [
        row('Time per slide', 'all photo views', seg('slideSecs', [[0, 'Default'], [10, '10 s'], [20, '20 s'], [30, '30 s'], [60, '1 min']], g('slideSecs'))),
        row('Captions', 'Photos page', seg('captions', [[true, 'On'], [false, 'Off']], g('captions')))
      ]) +
      card('Display', [
        row('Clock', '', seg('clock24', [[false, '12-hour'], [true, '24-hour']], g('clock24'))),
        row('Temperature', 'weather only', seg('tempF', [[false, '°C'], [true, '°F']], g('tempF'))),
        row('Diagnostics overlay', 'applies after a reload', seg('diag', [[true, 'On'], [false, 'Off']], diagOn()))
      ]) +
      card('Until reload', [
        row('Time of day', 'demo clock', btns('data-time', [['7:10', '7:10 AM'], ['15:18', '3:18 PM'], ['19:45', '7:45 PM'], ['23:40', '11:40 PM'], ['real', 'Real time']])),
        row('Calendar data', '', seg('cal', [['normal', 'Normal'], ['empty', 'Empty'], ['busy', 'Busy']], App.calMode)),
        row('Mode', '', btns('data-mode', [['ambient', 'Ambient'], ['night', 'Night']]))
      ]) +
      card('Test alerts', [
        btns('data-alert', [['doorbell', 'Doorbell'], ['leak', 'Water leak'], ['garage', 'Garage open'], ['package', 'Package']])
      ]) +
      '</div></div>';
  }

  function paint() { var top = V.el.scrollTop; V.el.innerHTML = html(); V.el.scrollTop = top; }

  function parse(v) { return v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v; }

  function click(e) {
    var b = e.target.closest('button');
    if (!b) return;
    var group = b.closest('[data-key]');
    if (group) {
      var key = group.dataset.key, v = parse(b.dataset.v);
      if (key === 'diag') {
        try { localStorage.setItem('hq-diag', v ? '1' : '0'); } catch (err) { /* ignore */ }
        App.toast('Diagnostics ' + (v ? 'on' : 'off') + ' after the next reload', { icon: 'check' });
      } else if (key === 'cal') { App.calMode = v; App.rerender(); return; }
      else S().set(key, v);
      return paint();
    }
    if (b.hasAttribute('data-reset')) { S().reset(); paint(); App.toast('Settings reset', { icon: 'undo' }); return; }
    if (b.dataset.time) {
      if (b.dataset.time === 'real') App.setTime(null);
      else { var p = b.dataset.time.split(':'); App.setTime(+p[0], +p[1]); }
      return;
    }
    if (b.dataset.mode) return App.setMode(b.dataset.mode);
    if (b.dataset.alert) ({ doorbell: App.doorbell, leak: App.leak, garage: App.garageOpenAlert, package: App.packageNotice })[b.dataset.alert]();
  }

  App.register('settings', {
    show: function (el) {
      if (V.el !== el) { V.el = el; el.addEventListener('click', click); }
      paint();
    }
  });
})();
