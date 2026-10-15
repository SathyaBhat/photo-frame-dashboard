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
    setInterval(loadHome, HOME_MS);
    setInterval(loadWeather, WEATHER_MS);
    setInterval(checkVersion, 60 * 1000);
  });
  // Once a new build is known, retry every few seconds until the screen has been idle.
  setInterval(function () { if (newBuild) checkVersion(); }, 5000);
})();
