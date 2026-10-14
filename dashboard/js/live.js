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

  App.on('ready', function () {
    loadWeather();
    setInterval(loadWeather, WEATHER_MS);
  });
})();
