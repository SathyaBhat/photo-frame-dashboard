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
          '<span class="h-hr-i">' + App.icon(d.c, 22) + '</span><b>' + (d.hi === null ? '–' : App.temp(d.hi) + '°') + '<small>' + (d.lo === null ? '' : App.temp(d.lo) + '°') + '</small></b></div>';
      }).join('') + '</div>'
      : '<div class="h-wx-hours">' + hours.map(function (h) {
        var lift = tmax === tmin ? 0 : Math.round((h.t - tmin) / (tmax - tmin) * 8);
        return '<div class="h-hr' + (h.p >= App.WET_CHANCE ? ' is-wet' : '') + '"><span class="h-hr-l">' + h.label + '</span>' +
          '<span class="h-hr-i" style="transform:translateY(' + -lift + 'px)">' + App.icon(h.c, 22) + '</span><b>' + h.t + '°</b></div>';
      }).join('') + '</div>';
    return '<div class="h-wx-top">' +
      '<span class="h-wx-icon">' + App.icon(w.cond, 60) + '</span>' +
      '<span class="h-wx-temp num">' + App.temp(w.temp) + '°</span>' +
      '<span class="h-wx-meta"><b>' + w.label + '</b><span>H ' + App.temp(w.hi) + '°  L ' + App.temp(w.lo) + '°</span></span>' +
      '</div>' +
      '<div class="h-wx-say"><b>' + w.summary + '.</b> ' + w.advice + '.</div>' + strip;
  }

  function presence() {
    return D.people.map(function (p) {
      var sub = App.esc(p.status || (p.home ? 'Home' : 'Away'));
      return '<div class="h-who' + (p.home ? ' is-home' : '') + '" style="' + App.pstyle(p) + '">' +
        App.avatar(p, 48, p.home ? '' : 'avatar--away') +
        '<span><b>' + p.name + '</b><small>' + sub + '</small></span></div>';
    }).join('');
  }

  function hero() {
    var b = D.battery;
    if (!b) return '';
    var usable = Math.max(0, b.soc - b.reserve) / 100 * b.capacityKwh;
    var left = b.soc / 100 * b.capacityKwh;
    var title = b.flowKw < 0 ? 'Powering home' : (b.flowKw > 0 ? 'Charging' : 'On standby');
    var meta = b.flowKw < 0
      ? Math.abs(b.flowKw).toFixed(1) + ' kW out · about ' + left.toFixed(1) + ' kWh / ' + App.fmt.mins(usable / -b.flowKw * 60) + ' left'
      : (b.flowKw > 0 ? b.flowKw.toFixed(1) + ' kW in · full in about ' + App.fmt.mins((100 - b.soc) / 100 * b.capacityKwh / b.flowKw * 60) : 'No power flowing');
    var low = b.soc <= b.reserve + 10;
    var style = low ? '--c:#FF9500;--c-ink:#111111' : '--c:#00A36C;--c-ink:#FFFFFF';
    return '<button class="h-hero" style="' + style + '" data-go="energy">' +
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

  var AGENDA_MAX = 4; // the panel is 304 px tall: a label, four 52 px rows and the "more" button

  // What is still to come on `day`: all-day events first, then timed events that have not ended.
  function remaining(day, now) {
    return App.allDayOn(day).concat(App.timedOn(day).filter(function (e) { return e.end > now; }));
  }

  // The family's upcoming events. Starts today; carries on to the next days while the days so far
  // have only all-day events left, and stops at the first day with timed events still to come.
  function agenda() {
    var now = App.now(), today = App.dayStart(now), groups = [], seen = {}, total = 0, i;
    for (i = 0; i < 7 && total < AGENDA_MAX; i++) {
      var day = App.addDays(today, i), list = remaining(day, now).filter(function (e) { return !seen[e.id]; }); // a multi-day event is listed once
      if (!list.length) continue;
      list.forEach(function (e) { seen[e.id] = true; });
      groups.push({ day: day, list: list });
      total += list.length;
      if (list.some(function (e) { return !e.allDay; })) break;
    }
    if (!groups.length) return '<div class="h-free serif">Nothing <i>coming up</i></div>';
    var room = AGENDA_MAX, html = '';
    groups.forEach(function (g) {
      var shown = g.list.slice(0, Math.max(room, 0));
      room -= shown.length;
      if (!shown.length) return;
      html += '<div class="label">' + App.fmt.rel(g.day) + '</div>' + shown.map(function (e) {
        var cur = !e.allDay && e.start <= now;
        return '<button class="h-ag' + (cur ? ' is-now' : '') + '" style="' + App.pstyle(App.evColor(e)) + '" data-ev="' + App.esc(e.id) + '">' +
          '<span class="h-ag-t">' + (e.allDay ? 'All day' : cur ? 'Now' : App.fmt.time(e.start)) + '</span>' +
          '<span class="h-ag-n">' + App.esc(e.title) + '</span>' +
          (e.loc ? '<span class="h-ag-l">' + App.esc(e.loc) + '</span>' : '') + '</button>';
      }).join('');
    });
    var more = groups.reduce(function (n, g) { return n + g.list.length; }, 0) - AGENDA_MAX;
    return html + (more > 0 ? '<button class="h-more" data-go="calendar">+' + more + ' more</button>' : '');
  }

  // Open chores per person (then Either), from the Chores lists on the Trello board.
  function chores() {
    if (!D.choresLive) {
      return '<div class="label">Chores</div><div class="h-stat"><span class="num">–</span><small>to do</small></div>' +
        '<p class="h-shop-off">' + (D.choresOffline ? 'Can\'t reach the chore list. Trying again…' : 'No chore list yet.') + '</p>';
    }
    var open = D.chores.filter(function (c) { return !c.done; });
    var known = {};
    D.members.forEach(function (m) { known[m.id] = true; });
    var rows = D.members.map(function (m) {
      return { name: m.name, n: open.filter(function (c) { return c.who === m.id; }).length };
    }).concat([{ name: 'Either', n: open.filter(function (c) { return !known[c.who]; }).length }]);
    return '<div class="label">Chores</div><div class="h-counts">' + rows.filter(function (r) { return r.n; }).map(function (r) {
      return '<div class="h-count"><b class="num">' + r.n + '</b><span>' + App.esc(r.name) + '</span></div>';
    }).join('') + (open.length ? '' : '<div class="h-count"><b class="num">✓</b><span>All done</span></div>') + '</div>';
  }

  function shopping() {
    if (!D.groceriesLive && D.groceriesOffline) {
      return '<div class="label">Shopping</div>' +
        '<div class="h-stat"><span class="num">–</span><small>items to get</small></div>' +
        '<p class="h-shop-off">Can\'t reach the grocery list. Trying again…</p>';
    }
    var open = D.groceries.filter(function (g) { return !g.done; });
    // live cards arrive newest first; the mock list appends new items at the end
    var recent = D.groceriesLive ? open.slice(0, 3) : open.slice(-3).reverse();
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
    el.querySelector('.h-agenda').innerHTML = agenda();
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
          '<button class="h-weather" data-go="weather"></button>' +
          '<div class="h-presence"></div>' +
          '<div class="h-main"><div class="h-hero-slot"></div><div class="h-agenda"></div></div>' +
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
    if (n.getMinutes() === 0) { V.el.querySelector('.h-weather').innerHTML = weather(); V.el.querySelector('.h-agenda').innerHTML = agenda(); }
  });
  App.on('data', function () { if (App.current === 'home') paint(); });
})();
