// Settings: every option the frame itself can change. Saved in localStorage (see settings.js).
(function () {
  'use strict';
  var V = { el: null, albums: null, albumsErr: false };
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
  function card(title, rows) { return '<section class="st-card"><div class="label">' + title + '</div>' + rows.join('') + '</section>'; }

  // Album picker: "On this day" first, then the server's albums, newest change first. With nothing picked, the
  // server's default is shown as chosen.
  function albumCard() {
    var cur = S().get('photoAlbum'), a = V.albums;
    if (!a) return '<section class="st-card st-card--wide"><div class="label">Photo album</div><p class="st-note">' + (V.albumsErr ? 'Couldn’t reach the photo library.' : 'Loading albums…') + '</p></section>';
    var on = cur || a.default || 'memories';
    var items = [{ id: 'memories', name: 'On this day', note: 'memories from past years' }].concat(a.albums.map(function (x) {
      return { id: x.id, name: x.name, note: x.count + (x.count === 1 ? ' item' : ' items') };
    }));
    return '<section class="st-card st-card--wide"><div class="label">Photo album</div><div class="st-albums">' + items.map(function (x) {
      return '<button data-album="' + App.esc(x.id) + '"' + (x.id === on ? ' class="is-on"' : '') + '><b>' + App.esc(x.name) + '</b><small>' + App.esc(x.note) + '</small></button>';
    }).join('') + '</div></section>';
  }

  function loadAlbums() {
    App.photoAlbums().then(function (a) { V.albums = a; V.albumsErr = false; }, function () { V.albumsErr = true; }).then(function () {
      if (V.el && V.el.querySelector('.settings')) paint();
    });
  }

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
      albumCard() +
      '</div></div>';
  }

  function paint() {
    var grid = V.el.querySelector('.st-grid'), list = V.el.querySelector('.st-albums');
    var top = grid ? grid.scrollTop : 0, listTop = list ? list.scrollTop : 0;
    V.el.innerHTML = html();
    grid = V.el.querySelector('.st-grid'); list = V.el.querySelector('.st-albums');
    if (grid) grid.scrollTop = top;
    if (list) list.scrollTop = listTop;
  }

  function parse(v) { return v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v; }

  function click(e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.album) {
      if (b.classList.contains('is-on')) return;
      S().set('photoAlbum', b.dataset.album);
      App.toast('Showing ' + App.esc(b.querySelector('b').textContent), { icon: 'photo' });
      return paint();
    }
    var group = b.closest('[data-key]');
    if (group) {
      var key = group.dataset.key, v = parse(b.dataset.v);
      if (key === 'diag') {
        try { localStorage.setItem('hq-diag', v ? '1' : '0'); } catch (err) { /* ignore */ }
        App.toast('Diagnostics ' + (v ? 'on' : 'off') + ' after the next reload', { icon: 'check' });
      } else S().set(key, v);
      return paint();
    }
    if (b.hasAttribute('data-reset')) { S().reset(); paint(); App.toast('Settings reset', { icon: 'undo' }); return; }
  }

  App.register('settings', {
    show: function (el) {
      if (V.el !== el) { V.el = el; el.addEventListener('click', click); }
      paint();
      loadAlbums();
    }
  });
})();
