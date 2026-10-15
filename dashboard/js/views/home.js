// Home / Today: the glanceable overview. Never scrolls.
(function () {
  'use strict';
  var D = window.DATA, V = {};

  function clock() {
    var n = App.now();
    return '<div class="h-time num">' + App.fmt.time(n, false) + '<span class="h-ampm">' + App.fmt.ampm(n) + '</span></div>' +
      '<div class="h-date"><b>' + App.fmt.day(n) + '</b> ' + App.fmt.month(n) + ' ' + n.getDate() + '</div>';
  }

  // 6am-6pm: the next few hours. 6pm-6am: the next five days, starting tomorrow once it's evening.
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function dayKey(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function forecastDays(now) {
    var start = dayKey(now.getHours() >= 18 ? App.addDays(now, 1) : now);
    return (D.weather.days || []).filter(function (d) { return d.day >= start; }).slice(0, 5);
  }

  function weather() {
    var w = App.weatherNow(), now = App.now();
    var days = (now.getHours() >= 18 || now.getHours() < 6) ? forecastDays(now) : [];
    var hours = App.hourly(7);
    var tmin = Math.min.apply(null, hours.map(function (h) { return h.t; }));
    var tmax = Math.max.apply(null, hours.map(function (h) { return h.t; }));
    var strip = days.length
      ? '<div class="h-wx-hours h-wx-hours--days">' + days.map(function (d) {
        var y = +d.day.slice(0, 4), m = +d.day.slice(5, 7) - 1, dd = +d.day.slice(8, 10);
        return '<div class="h-hr' + (d.p >= App.WET_CHANCE ? ' is-wet' : '') + '"><span class="h-hr-l">' + DOW[new Date(y, m, dd).getDay()] + '</span>' +
          '<span class="h-hr-i">' + App.icon(d.c, 22) + '</span><b>' + (d.hi === null ? '–' : d.hi + '°') + '<small>' + (d.lo === null ? '' : d.lo + '°') + '</small></b></div>';
      }).join('') + '</div>'
      : '<div class="h-wx-hours">' + hours.map(function (h) {
        var lift = tmax === tmin ? 0 : Math.round((h.t - tmin) / (tmax - tmin) * 8);
        return '<div class="h-hr' + (h.p >= App.WET_CHANCE ? ' is-wet' : '') + '"><span class="h-hr-l">' + h.label + '</span>' +
          '<span class="h-hr-i" style="transform:translateY(' + -lift + 'px)">' + App.icon(h.c, 22) + '</span><b>' + h.t + '°</b></div>';
      }).join('') + '</div>';
    return '<div class="h-wx-top">' +
      '<span class="h-wx-icon">' + App.icon(w.cond, 60) + '</span>' +
      '<span class="h-wx-temp num">' + w.temp + '°</span>' +
      '<span class="h-wx-meta"><b>' + w.label + '</b><span>H ' + w.hi + '°  L ' + w.lo + '°</span></span>' +
      '</div>' +
      '<div class="h-wx-say"><b>' + w.summary + '.</b> ' + w.advice + '.</div>' + strip;
  }

  function presence() {
    return D.people.map(function (p) {
      var sub = p.home ? 'Home' : (p.eta ? '<b>ETA ' + p.eta + ' min</b>' : p.status);
      return '<div class="h-who' + (p.home ? ' is-home' : '') + '" style="' + App.pstyle(p) + '">' +
        App.avatar(p, 36, p.home ? '' : 'avatar--away') +
        '<span><b>' + p.name + '</b><small>' + sub + '</small></span></div>';
    }).join('');
  }

  function hero() {
    var b = D.battery;
    var usable = Math.max(0, b.soc - b.reserve) / 100 * b.capacityKwh;
    var left = b.soc / 100 * b.capacityKwh;
    var title = b.flowKw < 0 ? 'Powering home' : (b.flowKw > 0 ? 'Charging' : 'On standby');
    var meta = b.flowKw < 0
      ? Math.abs(b.flowKw).toFixed(1) + ' kW out · about ' + left.toFixed(1) + ' kWh / ' + App.fmt.mins(usable / -b.flowKw * 60) + ' left'
      : (b.flowKw > 0 ? b.flowKw.toFixed(1) + ' kW in · full in about ' + App.fmt.mins((100 - b.soc) / 100 * b.capacityKwh / b.flowKw * 60) : 'No power flowing');
    var low = b.soc <= b.reserve + 10;
    var style = low ? '--c:#FF9500;--c-ink:#111111' : '--c:#00A36C;--c-ink:#FFFFFF';
    return '<button class="h-hero" style="' + style + '" data-go="control">' +
      '<div class="h-hero-main">' +
      '  <div class="label label--on">Home battery</div>' +
      '  <div class="h-hero-title serif">' + title + '</div>' +
      '  <div class="h-hero-meta">' + meta + '</div>' +
      '  <div class="h-hero-foot"><span class="h-bat-bar"><i style="width:' + b.soc + '%"></i></span>' +
      '<span class="pill">' + App.icon('bolt', 20) + 'Solar ' + b.solarKw.toFixed(1) + ' kW</span>' +
      '<span class="pill">Home ' + b.homeKw.toFixed(1) + ' kW</span></div>' +
      '</div>' +
      '<div class="h-hero-count num">' + Math.round(b.soc) + '<small>%</small></div></button>';
  }

  function lanes() {
    var now = App.now();
    return D.people.map(function (p) {
      var list = App.timedOn(now, p.id).filter(function (e) { return e.end > now; });
      var shown = list.slice(0, 3), more = list.length - shown.length;
      return '<div class="h-lane" style="' + App.pstyle(p) + '">' +
        '<div class="h-lane-head">' + App.avatar(p, 30) + '<b>' + p.name + '</b></div>' +
        (list.length ? shown.map(function (e) {
          var cur = e.start <= now;
          return '<button class="h-ev' + (cur ? ' is-now' : '') + '" data-ev="' + e.id + '">' +
            '<span class="h-ev-t">' + (cur ? 'Now' : App.fmt.time(e.start, false)) + '</span>' +
            '<span class="h-ev-n">' + App.esc(e.title) + '</span></button>';
        }).join('') : '<div class="h-free serif"><i>Free</i> the rest of the day</div>') +
        (more > 0 ? '<button class="h-more" data-go="calendar">+' + more + ' more</button>' : '') +
        '</div>';
    }).join('');
  }

  function ring(done, total, size) {
    var r = size / 2 - 5, c = 2 * Math.PI * r, f = total ? done / total : 0;
    return '<svg class="ring" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" class="ring-bg"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" class="ring-fg" stroke-dasharray="' + (c * f) + ' ' + c + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>';
  }
  App.ring = ring;

  function chores() {
    var r = App.currentRoutine();
    var who = D.people.map(function (p) { return p.id; }).concat(['any']);
    return '<div class="label">Chores · ' + r.name + '</div><div class="h-rings">' + who.map(function (id) {
      var list = D.chores.filter(function (c) { return c.r === r.id && c.who === id; });
      if (!list.length) return '';
      var done = list.filter(function (c) { return c.done; }).length;
      var p = App.person(id);
      return '<div class="h-ring' + (done === list.length ? ' is-done' : '') + '" style="' + App.pstyle(p) + '">' + ring(done, list.length, 64) +
        '<b class="num">' + (done === list.length ? '✓' : done + '/' + list.length) + '</b><span>' + (id === 'any' ? 'Anyone' : p.name) + '</span></div>';
    }).join('') + '</div>';
  }

  function shopping() {
    var open = D.groceries.filter(function (g) { return !g.done; });
    var recent = open.slice(-3).reverse();
    return '<div class="label">Shopping</div>' +
      '<div class="h-stat"><span class="num">' + open.length + '</span><small>items to get</small></div>' +
      '<ul class="h-recent">' + recent.map(function (g) {
        return '<li><i></i>' + App.esc(g.name) + '</li>';
      }).join('') + '</ul>';
  }

  function status() {
    var lights = D.devices.filter(function (d) { return d.type === 'light' && d.on; }).length;
    if (D.homeLive) {
      return '<div class="label">Home</div>' +
        '<div class="h-st-row">' + App.icon('bulb', 24) + '<b class="num">' + lights + '</b><span>lights on</span></div>' +
        (D.homeOffline ? '<div class="h-st-row is-warn">' + App.icon('bolt', 24) + '<span>Home Assistant offline</span></div>' : '');
    }
    var unlocked = D.devices.filter(function (d) { return d.type === 'lock' && !d.locked; });
    var garage = D.devices.filter(function (d) { return d.type === 'garage'; })[0];
    var secure = !unlocked.length && garage.state === 'closed';
    var secText = secure ? 'All locked' : (garage.state !== 'closed' ? 'Garage open' : unlocked[0].name + ' unlocked');
    return '<div class="label">Home</div>' +
      '<div class="h-st-row">' + App.icon('bulb', 24) + '<b class="num">' + lights + '</b><span>lights on</span></div>' +
      '<div class="h-st-row' + (secure ? '' : ' is-warn') + '">' + App.icon(secure ? 'lock' : 'unlock', 24) + '<span>' + secText + '</span></div>' +
      '<div class="h-st-row">' + App.icon('thermo', 24) + '<b class="num">' + D.climate.current + '°</b><span>inside</span></div>';
  }

  function paint() {
    var el = V.el;
    el.querySelector('.h-clock').innerHTML = clock();
    el.querySelector('.h-weather').innerHTML = weather();
    el.querySelector('.h-presence').innerHTML = presence();
    el.querySelector('.h-hero-slot').innerHTML = hero();
    el.querySelector('.h-lanes').innerHTML = lanes();
    el.querySelector('.h-chores').innerHTML = chores();
    el.querySelector('.h-shop').innerHTML = shopping();
    el.querySelector('.h-status').innerHTML = status();
  }

  function photoCaption(s) {
    var m = App.photoMeta(s.photos[0]);
    V.el.querySelector('.h-photo-cap').innerHTML = '<b>' + (m.onThisDay ? 'On this day · ' : '') + m.kicker + '</b><span>' + App.esc(m.place) + '</span>';
  }

  App.register('home', {
    show: function (el) {
      V.el = el;
      if (!el.firstChild) {
        el.innerHTML = '<div class="home">' +
          '<div class="h-clock" data-go="calendar"></div>' +
          '<div class="h-weather"></div>' +
          '<div class="h-presence"></div>' +
          '<div class="h-main"><div class="h-hero-slot"></div><div class="h-lanes" ></div></div>' +
          '<div class="h-side">' +
          '  <button class="h-photo" data-go="photos"><div class="h-photo-stage"></div><div class="h-photo-cap"></div></button>' +
          '  <button class="h-chores card" data-go="tasks"></button>' +
          '  <div class="h-duo"><button class="h-shop card" data-go="shopping"></button><button class="h-status card" data-go="control"></button></div>' +
          '</div></div>';
        el.addEventListener('click', function (e) {
          var ev = e.target.closest('[data-ev]');
          if (ev) { App.eventSheet(App.findEvent(ev.dataset.ev)); return; }
          var g = e.target.closest('[data-go]');
          if (g) App.go(g.dataset.go);
        });
        V.slides = new App.Slideshow(el.querySelector('.h-photo-stage'), { layout: 'cover', captions: false, interval: 12000, onChange: photoCaption });
      }
      paint();
      V.slides.start();
    },
    resume: function () { V.slides.start(); },
    hide: function () { if (V.slides) V.slides.stop(); }
  });
  // Every minute: just the clock and next-up countdown (cheap, even while hidden). Weather on the hour.
  App.on('minute', function (n) {
    if (!V.el || !V.el.firstChild) return;
    V.el.querySelector('.h-clock').innerHTML = clock();
    if (n.getMinutes() === 0) { V.el.querySelector('.h-weather').innerHTML = weather(); V.el.querySelector('.h-lanes').innerHTML = lanes(); }
  });
  App.on('data', function () { if (App.current === 'home') paint(); });
})();
