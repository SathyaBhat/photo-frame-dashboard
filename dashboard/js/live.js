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
    setInterval(loadWeather, WEATHER_MS);
    setInterval(checkVersion, 60 * 1000);
  });
  // Once a new build is known, retry every few seconds until the screen has been idle.
  setInterval(function () { if (newBuild) checkVersion(); }, 5000);
})();
