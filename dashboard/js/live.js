// Live data: pulls real values from the frame server and swaps them into the mock DATA.
// Each source falls back to the mock if the server is unreachable.
(function () {
  var App = window.App, D = window.DATA;
  var API = 'api/';
  var WEATHER_MS = 15 * 60 * 1000;

  function getJSON(path) {
    return fetch(API + path, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function loadWeather() {
    return getJSON('weather').then(function (res) {
      D.weather = res.weather;
      App.emit('data');
      App.rerender();
    }).catch(function (e) {
      console.warn('HomeHQ live weather failed, keeping current data:', e.message);
    });
  }

  // The shared Google Calendar, via the frame server. Events belong to the whole family, so they list every
  // person: the views then show them as "Family". Until the first success the mock events stay.
  var CAL_MS = 5 * 60 * 1000;
  var calJSON = '';

  function localDay(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); } // all-day values are dates, not instants

  function toEvent(e) {
    return {
      id: e.id, title: e.title, allDay: e.allDay, live: true, loc: e.location || undefined,
      start: e.allDay ? localDay(e.start) : new Date(e.start),
      end: e.allDay ? localDay(e.end) : new Date(e.end),
      people: D.people.map(function (p) { return p.id; })
    };
  }

  function loadCalendar() {
    return getJSON('calendar').then(function (res) {
      var json = JSON.stringify(res.events);
      if (json === calJSON) return;
      calJSON = json;
      // Keep anything added by hand in the Calendar view; the rest (mock or earlier real events) is replaced.
      D.events = D.events.filter(function (e) { return e.local; }).concat(res.events.map(toEvent));
      App.emit('data');
      App.rerender();
    }).catch(function (e) {
      if (e.message === 'HTTP 503') return; // server has no calendar configured: stay on mock
      console.warn('HomeHQ live calendar failed, keeping current data:', e.message);
    });
  }

  // Home Assistant, via the frame server. Until the first success the mock home stays; after that the real
  // rooms/devices/scenes/media replace it and the mock-only sections (climate, cameras, locks, garage) go away.
  var HOME_MS = 10 * 1000;
  var homeJSON = '';
  D.homeLive = false;
  D.homeOffline = false;
  App.homeBusy = 0; // writes in flight: don't let a poll overwrite the optimistic state

  function applyHome(h) {
    var json = JSON.stringify(h);
    var changed = json !== homeJSON || D.homeOffline;
    homeJSON = json;
    D.homeOffline = false;
    if (!changed && D.homeLive) return;
    D.rooms = h.rooms; D.devices = h.devices; D.scenes = h.scenes; D.media = h.media;
    if (h.battery) D.battery = h.battery;
    D.climate = null; D.cameras = []; D.homeLive = true;
    App.emit('data');
    App.rerender();
  }

  function loadHome() {
    if (App.homeBusy) return Promise.resolve();
    return getJSON('home').then(function (res) { if (!App.homeBusy) applyHome(res.home); }).catch(function (e) {
      if (e.message === 'HTTP 503') return; // server has no Home Assistant configured: stay on mock
      console.warn('HomeHQ live home failed, keeping current data:', e.message);
      if (D.homeLive && !D.homeOffline) { D.homeOffline = true; App.rerender(); }
    });
  }

  // Write to Home Assistant. Rejects if the server or HA refused. The reply carries fresh state,
  // which is applied straight away.
  App.homeWrite = function (path, body) {
    App.homeBusy++;
    return fetch(API + path, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (res) {
        App.homeBusy--;
        applyHome(res.home);
      }, function (e) {
        App.homeBusy--;
        throw e;
      });
  };

  // Groceries (the Trello board), via the frame server. A 503 before the first success means the server has
  // no Trello configured, so the mock list stays. Any other failure before the first success sets
  // D.groceriesOffline with D.groceriesLive still false: the views then hide the mock list and allow no edits
  // until a poll succeeds. Items name their store by name (not label id), so a store's id here is its name.
  // Items get qty 1 if the server sent none.
  var GROC_MS = 60 * 1000;
  var GROC_WRITE_MS = 30 * 1000;
  var grocJSON = '';
  var grocGen = 0; // bumped when a write starts and ends: a poll answered across a write is discarded
  D.groceriesLive = false;
  D.groceriesOffline = false;
  App.groceriesBusy = 0; // writes in flight: don't let a poll overwrite the optimistic state

  function setGroceriesOffline(off) {
    if (D.groceriesOffline === off) return;
    D.groceriesOffline = off;
    App.emit('data');
    App.rerender();
  }

  function applyGroceries(res) {
    var g = res.groceries;
    if (App.groceriesBusy) return;
    var json = JSON.stringify(g);
    var changed = json !== grocJSON || !D.groceriesLive;
    grocJSON = json;
    // stale: the server could not reach Trello and sent its last copy. Show it, but flag it offline.
    var off = !!res.stale;
    if (!changed) { setGroceriesOffline(off); return; }
    D.groceriesOffline = off;
    var order = g.categories.concat(['Other']);
    D.groceries = g.items.map(function (i) { if (i.qty == null) i.qty = 1; return i; });
    D.stores = g.stores.map(function (s) { return { id: s.name, name: s.name }; });
    D.catOrder = { all: order.slice() };
    D.stores.forEach(function (s) { D.catOrder[s.id] = order.slice(); });
    D.groceriesLive = true;
    App.emit('data');
    App.rerender();
  }

  function loadGroceries() {
    if (App.groceriesBusy) return Promise.resolve();
    var gen = grocGen;
    return getJSON('groceries').then(function (res) {
      if (gen === grocGen) applyGroceries(res);
    }).catch(function (e) {
      if (gen !== grocGen) return; // a write settled meanwhile; its reply is the fresher word
      // 503 before the first success: server has no Trello configured, stay on mock
      if (e.message === 'HTTP 503' && !D.groceriesLive) { setGroceriesOffline(false); return; }
      console.warn('HomeHQ live groceries failed:', e.message);
      setGroceriesOffline(true);
    });
  }

  function writeSignal() {
    return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(GROC_WRITE_MS) : undefined;
  }

  // Write to the board. Rejects if the server or Trello refused, or after 30 s without an answer (which also
  // flags the list offline). The reply carries the fresh list.
  App.groceriesWrite = function (path, body) {
    var held = true;
    function release() { if (held) { held = false; App.groceriesBusy--; grocGen++; } }
    App.groceriesBusy++;
    grocGen++;
    var req;
    try {
      req = fetch(API + path, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal: writeSignal() });
    } catch (e) {
      req = Promise.reject(e);
    }
    return req.then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (res) {
      release();
      // The server accepted the write: a failure to show the reply must not look like a failed write.
      try { applyGroceries(res); } catch (e) { console.warn('HomeHQ groceries reply not applied:', e && e.message); }
    }, function (e) {
      release();
      if (e && e.name === 'TimeoutError') {
        try { setGroceriesOffline(true); } catch (x) { console.warn('HomeHQ groceries offline repaint failed:', x && x.message); }
      }
      throw e;
    });
  };

  // Deploy detection: version.json is rewritten on every build. When it differs from the id this
  // page was built with, reload, but only once nobody has touched the screen for a while.
  var BUILD = typeof __BUILD_ID__ === 'undefined' ? null : __BUILD_ID__;
  var newBuild = false;
  function checkVersion() {
    if (!BUILD) return; // dev server
    if (newBuild) { if (App.idleSeconds() >= 30) location.reload(); return; }
    fetch('version.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (v) {
      if (v.build && v.build !== BUILD) { newBuild = true; checkVersion(); }
    }).catch(function () { /* server restarting mid-deploy: try again next minute */ });
  }

  App.on('ready', function () {
    loadWeather();
    loadHome();
    loadCalendar();
    loadGroceries();
    setInterval(loadGroceries, GROC_MS);
    setInterval(loadHome, HOME_MS);
    setInterval(loadCalendar, CAL_MS);
    setInterval(loadWeather, WEATHER_MS);
    setInterval(checkVersion, 60 * 1000);
  });
  // Once a new build is known, retry every few seconds until the screen has been idle.
  setInterval(function () { if (newBuild) checkVersion(); }, 5000);
})();
