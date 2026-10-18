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

  // Groceries (the Trello board), via the frame server. Until the first success the mock list stays. Items
  // name their store by name (not label id), so a store's id here is its name. The Shopping view is not
  // yet aware of live data, so items get qty 1 if the server sent none.
  var GROC_MS = 60 * 1000;
  var grocJSON = '';
  D.groceriesLive = false;
  D.groceriesOffline = false;
  App.groceriesBusy = 0; // writes in flight: don't let a poll overwrite the optimistic state

  function applyGroceries(res) {
    var g = res.groceries;
    if (App.groceriesBusy) return;
    var json = JSON.stringify(g);
    var changed = json !== grocJSON || D.groceriesOffline || !D.groceriesLive;
    grocJSON = json;
    D.groceriesOffline = false;
    if (!changed) return;
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
    return getJSON('groceries').then(applyGroceries).catch(function (e) {
      if (e.message === 'HTTP 503') return; // server has no Trello configured: stay on mock
      console.warn('HomeHQ live groceries failed, keeping current list:', e.message);
      if (D.groceriesLive && !D.groceriesOffline) { D.groceriesOffline = true; App.rerender(); }
    });
  }

  // Write to the board. Rejects if the server or Trello refused. The reply carries the fresh list.
  App.groceriesWrite = function (path, body) {
    App.groceriesBusy++;
    return fetch(API + path, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (res) {
        App.groceriesBusy--;
        applyGroceries(res);
      }, function (e) {
        App.groceriesBusy--;
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
