// User settings: saved in localStorage, applied at startup and whenever one changes.
(function () {
  'use strict';
  var KEY = 'hq-settings';
  var DEFAULTS = {
    idleHome: 60, idleAmbient: 120, // seconds without a touch
    nightFrom: 22, nightTo: 6,      // hours (0-23)
    slideSecs: 0,                   // 0 = each photo view's own default
    captions: true,
    clock24: false, tempF: false
  };
  var vals = {};
  try { vals = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { vals = {}; }

  function get(k) { return vals[k] === undefined ? DEFAULTS[k] : vals[k]; }
  function apply() {
    App.idle.home = get('idleHome');
    App.idle.ambient = Math.max(get('idleAmbient'), get('idleHome') + 30);
  }
  function set(k, v) {
    vals[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(vals)); } catch (e) { /* private mode: keep for this session */ }
    apply();
    App.refreshClock();
    App.emit('data');
  }
  function reset() {
    vals = {};
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    apply();
    App.refreshClock();
    App.emit('data');
  }

  App.settings = { get: get, set: set, reset: reset, DEFAULTS: DEFAULTS };
  // Weather data is Celsius; show Fahrenheit when asked.
  App.temp = function (c) { return get('tempF') ? Math.round(c * 9 / 5 + 32) : c; };
  apply();
})();
