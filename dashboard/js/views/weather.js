// Weather: the next 24 hours as a swipeable strip, and the forecast days below. Reached from the Today weather.
(function () {
  'use strict';
  var D = window.DATA, V = { el: null };
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var LABELS = { sun: 'Sunny', moon: 'Clear', partly: 'Partly cloudy', cloud: 'Overcast', rain: 'Rain' };

  function dayKey(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function parseDay(s) { return new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); }
  function degrees(v) { return v === null || v === undefined ? '–' : App.temp(v) + '°'; }

  function hours() {
    var now = App.now(), list = App.hourly(24);
    return list.map(function (h, i) {
      var tag = i === 0 ? 'Today' : (h.h === 0 ? DOW[App.addDays(now, 1).getDay()] : '');
      return '<div class="wx-hr' + (h.p >= App.WET_CHANCE ? ' is-wet' : '') + (tag && i ? ' is-day' : '') + '">' +
        '<small class="wx-hr-tag">' + tag + '</small>' +
        '<span class="wx-hr-l">' + h.label + '</span>' +
        '<span class="wx-hr-i">' + App.icon(h.c, 40) + '</span>' +
        '<b class="num">' + App.temp(h.t) + '°</b>' +
        '<span class="wx-hr-p">' + (h.p > 0 ? h.p + '%' : '') + '</span></div>';
    }).join('');
  }

  function days() {
    var now = App.now(), today = dayKey(now), tomorrow = dayKey(App.addDays(now, 1));
    var list = (D.weather.days || []).filter(function (d) { return d.day >= today; });
    if (!list.length) return '<div class="wx-empty">No daily forecast yet.</div>';
    var lo = Math.min.apply(null, list.map(function (d) { return d.lo === null ? d.hi : d.lo; }));
    var hi = Math.max.apply(null, list.map(function (d) { return d.hi === null ? d.lo : d.hi; }));
    var span = Math.max(1, hi - lo);
    return list.map(function (d) {
      var name = d.day === today ? 'Today' : d.day === tomorrow ? 'Tomorrow' : DOW[parseDay(d.day).getDay()];
      var a = d.lo === null ? d.hi : d.lo, b = d.hi === null ? d.lo : d.hi;
      var left = Math.round((a - lo) / span * 100), width = Math.max(4, Math.round((b - a) / span * 100));
      return '<div class="wx-day' + (d.p >= App.WET_CHANCE ? ' is-wet' : '') + '">' +
        '<b class="wx-day-n">' + name + '</b>' +
        '<span class="wx-day-i">' + App.icon(d.c, 34) + '</span>' +
        '<span class="wx-day-p">' + (d.p > 0 ? d.p + '%' : '') + '</span>' +
        '<span class="wx-day-lo num">' + degrees(d.lo) + '</span>' +
        '<span class="wx-bar"><i style="left:' + left + '%;width:' + width + '%"></i></span>' +
        '<span class="wx-day-hi num">' + degrees(d.hi) + '</span></div>';
    }).join('');
  }

  function paint() {
    var w = App.weatherNow(), W = D.weather;
    var keep = V.el.querySelector('.wx-hours'), keepDays = V.el.querySelector('.wx-days');
    var x = keep ? keep.scrollLeft : 0, y = keepDays ? keepDays.scrollTop : 0;
    var stats = [];
    if (W.feels !== null && W.feels !== undefined) stats.push('Feels ' + degrees(W.feels));
    if (W.humidity !== null && W.humidity !== undefined) stats.push('Humidity ' + W.humidity + '%');
    if (W.wind !== null && W.wind !== undefined) stats.push('Wind ' + W.wind + ' km/h');
    V.el.innerHTML = '<div class="weather">' +
      '<header class="wx-top"><div><div class="label">Forecast</div><h1 class="serif">Weather</h1></div>' +
      '<div class="wx-now"><span class="wx-now-i">' + App.icon(w.cond, 64) + '</span>' +
      '<span class="wx-now-t num">' + degrees(w.temp) + '</span>' +
      '<span class="wx-now-m"><b>' + w.label + '</b><span>H ' + degrees(w.hi) + '  L ' + degrees(w.lo) + '</span></span></div></header>' +
      '<div class="wx-say"><b>' + App.esc(w.summary) + '.</b> ' + App.esc(w.advice) + '.' +
      (stats.length ? '<small>' + stats.join(' · ') + '</small>' : '') + '</div>' +
      '<div class="label">Next 24 hours</div><div class="wx-hours">' + hours() + '</div>' +
      '<div class="label">Coming days</div><div class="wx-days">' + days() + '</div></div>';
    V.el.querySelector('.wx-hours').scrollLeft = x;
    V.el.querySelector('.wx-days').scrollTop = y;
  }

  App.register('weather', {
    show: function (el) { V.el = el; paint(); }
  });
})();
