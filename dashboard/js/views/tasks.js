// Chores: the Chores lists on the Trello board (live.js), laid out like Shopping. Open chores are grouped by
// assignee (a Trello card member; nobody = "Either"), the usuals are tiles that put a done chore back, and
// ticked chores wait in a Done drawer. Writes go through App.choresWrite; there is no mock list.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, query: '', drawer: false, popup: null, renders: 0 };
  var DAY = 24 * 60 * 60 * 1000;
  var tmpId = 0;

  function live() { return !!D.choresLive; }
  function byId(id) { return D.chores.filter(function (c) { return c.id === id; })[0]; }
  function byData(sel, key, val) { return Array.prototype.filter.call(V.el.querySelectorAll(sel), function (n) { return n.dataset[key] === val; })[0]; }
  function open() { return D.chores.filter(function (c) { return !c.done; }); }
  function recent(c) { var t = Date.parse(c.at); return !isNaN(t) && Date.now() - t < DAY; }
  function gotIt() { return D.chores.filter(function (c) { return c.done && !c.usual && recent(c); }); }
  function find(name, isDone) {
    return D.chores.filter(function (c) { return !!c.done === isDone && c.name.toLowerCase() === name.toLowerCase(); })[0];
  }
  function memberName(id) {
    var m = D.members.filter(function (x) { return x.id === id; })[0];
    return m ? m.name : 'Either';
  }
  // The card already open under this usual's name (the usual itself, or another card), if any.
  function openFor(c) { return c.done ? find(c.name, false) : c; }
  // One tile per name (lower-cased): the open card if there is one, else a done one.
  function usuals() {
    var seen = {}, out = [];
    D.chores.filter(function (c) { return c.usual; }).sort(function (a, b) {
      var x = a.name.toLowerCase(), y = b.name.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    }).forEach(function (c) {
      var k = c.name.toLowerCase();
      if (!(k in seen)) { seen[k] = out.length; out.push(c); } else if (out[seen[k]].done && !c.done) out[seen[k]] = c;
    });
    return out;
  }

  // "Today", "Tomorrow", else "Fri 24 Oct"; empty without a due date or once it is marked complete.
  function dueText(c) {
    var t = Date.parse(c.due);
    if (c.dueComplete || isNaN(t)) return '';
    var d = new Date(t), now = App.now();
    var days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / DAY);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function dueTime(c) { var t = c.dueComplete ? NaN : Date.parse(c.due); return isNaN(t) ? null : t; }
  // No date first, then the closest due first; same-date chores keep their list order.
  function byDue(items) {
    return items.map(function (c, i) { return { c: c, i: i, t: dueTime(c) }; }).sort(function (a, b) {
      if (a.t === b.t) return a.i - b.i;
      if (a.t === null) return -1;
      if (b.t === null) return 1;
      return a.t - b.t || a.i - b.i;
    }).map(function (x) { return x.c; });
  }

  function row(c) {
    var id = App.esc(c.id), due = dueText(c);
    return '<div class="s-row' + (c._tmp ? ' is-saving' : '') + '" data-id="' + id + '">' +
      '<button class="s-hit" data-check="' + id + '"><span class="s-box">' + App.icon('check', 22) + '</span>' +
      '<span class="s-name"><b>' + App.esc(c.name) + '</b>' + (due ? '<small>' + App.esc(due) + '</small>' : '') + '</span></button>' +
      '<button class="s-lowbtn c-assign' + (c.who ? ' is-on' : '') + '" data-assign="' + id + '">' + App.esc(memberName(c.who)) + '</button>' +
      '<button class="c-due' + (due ? ' is-on' : '') + '" data-due="' + id + '" aria-label="Set due date">' + App.icon('calendar', 24) + '</button>' +
      '<button class="c-remove" data-remove="' + id + '" aria-label="Remove">' + App.icon('x', 24) + '</button>' +
      '</div>';
  }

  function listHTML() {
    if (!live()) {
      return '<div class="s-empty serif">' + (D.choresOffline ? 'Can\'t reach the chore list.<br><i>Trying again…</i>' : 'No chore list yet.') + '</div>';
    }
    var items = open();
    var groups = D.members.map(function (m) { return { name: m.name, items: byDue(items.filter(function (c) { return c.who === m.id; })) }; });
    var known = {};
    D.members.forEach(function (m) { known[m.id] = true; });
    groups.push({ name: 'Either', items: byDue(items.filter(function (c) { return !known[c.who]; })) });
    groups = groups.filter(function (g) { return g.items.length; });
    var d = gotIt();
    return (items.length ? groups.map(function (g) {
      return '<div class="s-cat"><div class="s-cat-h"><span class="label">' + App.esc(g.name) + '</span><span class="label">' + g.items.length + '</span></div>' + g.items.map(row).join('') + '</div>';
    }).join('') : '<div class="s-empty serif">All done.<br><i>Nothing left to do.</i></div>') +
      (d.length ? '<div class="s-drawer' + (V.drawer ? ' is-open' : '') + '">' +
        '<button class="s-drawer-h" data-drawer><span>' + App.icon('check', 22) + ' Done <b class="num">(' + d.length + ')</b></span><span class="label">' + (V.drawer ? 'Hide' : 'Show') + '</span></button>' +
        (V.drawer ? '<div class="s-drawer-list">' + d.map(function (c) {
          return '<button class="s-got" data-revive="' + App.esc(c.id) + '">' + App.esc(c.name) + '<span class="label">Add back</span></button>';
        }).join('') + '</div>' : '') + '</div>' : '');
  }

  function tile(c) {
    var on = !!openFor(c);
    return '<button class="s-tile' + (on ? ' is-on' : '') + '" data-usual="' + App.esc(c.id) + '">' +
      '<b>' + App.esc(c.name) + '</b><span>' + (on ? App.icon('check', 16) + 'On list' : 'Add') + '</span></button>';
  }

  function suggestHTML() {
    if (!live()) return '';
    var q = V.query.trim(), ql = q.toLowerCase();
    if (ql) {
      var matches = usuals().filter(function (c) { return c.name.toLowerCase().indexOf(ql) > -1; }).slice(0, 5);
      var exact = D.chores.some(function (c) { return c.name.toLowerCase() === ql; });
      return '<div class="label">Suggestions</div><div class="s-ac">' + matches.map(function (c) {
        return '<button class="s-ac-row" data-add="' + App.esc(c.name) + '"><b>' + App.esc(c.name) + '</b><span class="label">' + (openFor(c) ? 'On list' : '') + '</span>' + App.icon('plus', 26) + '</button>';
      }).join('') + (exact && !matches.length ? '<button class="s-ac-row" data-add="' + App.esc(q) + '"><b>' + App.esc(q) + '</b><span class="label">' + (find(q, false) ? 'On list' : '') + '</span>' + App.icon('plus', 26) + '</button>' : '') +
        (exact ? '' : '<button class="s-ac-row s-ac-row--new" data-add="' + App.esc(q) + '"><b>Add “' + App.esc(q) + '”</b>' + App.icon('plus', 26) + '</button>') + '</div>';
    }
    var u = usuals();
    if (!u.length) return '<div class="label">Usuals · tap to add</div><div class="s-usuals-empty">No usuals yet. Give a chore card the "Usual" label in Trello and it shows up here.</div>';
    return '<div class="label">Usuals · tap to add</div><div class="s-usuals">' + u.map(tile).join('') + '</div>';
  }

  function paintHead() {
    var off = !live();
    V.el.querySelector('.s-count').innerHTML = '<span class="num">' + (off ? '–' : open().length) + '</span> to do';
    V.el.querySelector('.s-off').textContent = D.choresOffline ? 'Couldn\'t reach Trello' : '';
    var input = V.el.querySelector('.s-input');
    if (input) { input.disabled = off; if (live()) input.maxLength = 120; }
  }
  function paintList() { var l = V.el.querySelector('.s-list'); var st = l.scrollTop; closePop(); l.innerHTML = listHTML(); l.scrollTop = st; paintHead(); }
  function paintSuggest() { V.el.querySelector('.s-suggest').innerHTML = suggestHTML(); }
  // Background refresh: keep the assign or due popup open if its chore is still there.
  function repaint() {
    if (!V.el || !V.el.querySelector('.s-list')) return;
    var pid = V.popup, due = V.kind === 'due', cal = V.cal;
    paintList(); paintSuggest();
    V.cal = cal;
    var c = pid && byId(pid), b = c && (due ? byData('.s-list [data-due]', 'due', pid) : byData('.s-list [data-assign]', 'assign', pid));
    if (c && b) (due ? openDuePop : openPop)(b, c);
  }
  function flash(c) {
    var r = byData('.s-list .s-row', 'id', c.id);
    if (!r) return;
    r.classList.add('is-flash');
    if (r.scrollIntoView) r.scrollIntoView({ block: 'nearest' });
    setTimeout(function () { r.classList.remove('is-flash'); }, 1200);
  }

  function render() {
    V.el.innerHTML = '<div class="shop">' +
      '<header class="s-head"><div><div class="label">Shared list</div><h1 class="serif">Chores</h1><div class="s-off" role="status"></div></div><div class="s-count"></div></header>' +
      '<div class="s-list"></div>' +
      '<aside class="s-side"><div class="s-add">' +
      '<label class="s-input-wrap">' + App.icon('plus', 30) + '<input class="s-input" placeholder="Add a chore…" autocomplete="off" enterkeyhint="done"></label>' +
      '</div><div class="s-suggest"></div></aside></div>';
    var input = V.el.querySelector('.s-input');
    input.value = V.query;
    input.addEventListener('input', function () { V.query = input.value; paintSuggest(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && input.value.trim()) add(input.value); });
    paintList(); paintSuggest();
  }

  // ---- assign popup: one at a time, anchored under the row's button
  function closePop() {
    V.popup = null; V.cal = null;
    var p = V.el && V.el.querySelector('.c-pop');
    if (p) p.parentNode.removeChild(p);
  }
  // Under the button: right-aligned with it, or centred on it. The stage is scaled to fit the screen, so
  // getBoundingClientRect() is in screen pixels while top/left are in stage pixels: divide by the scale.
  function place(p, btn, centre) {
    var b = btn.getBoundingClientRect(), host = V.el.getBoundingClientRect();
    var k = host.width / V.el.offsetWidth || 1, hw = V.el.offsetWidth, hh = V.el.offsetHeight;
    var w = p.offsetWidth, h = p.offsetHeight;
    var top = (b.bottom - host.top) / k + 6;
    if (top + h > hh) top = Math.max(0, (b.top - host.top) / k - h - 6);
    var left = centre ? (b.left + b.width / 2 - host.left) / k - w / 2 : (b.right - host.left) / k - w;
    p.style.top = top + 'px';
    p.style.left = Math.max(0, Math.min(left, hw - w)) + 'px';
  }
  function openPop(btn, c) {
    closePop();
    V.popup = c.id; V.kind = 'who';
    var opts = D.members.map(function (m) { return [m.id, m.name]; }).concat([['', 'Either']]);
    var p = document.createElement('div');
    p.className = 'c-pop';
    p.innerHTML = opts.map(function (o) {
      return '<button class="c-pop-opt' + (o[0] === c.who || (!o[0] && !c.who) ? ' is-on' : '') + '" data-who="' + App.esc(o[0]) + '" data-for="' + App.esc(c.id) + '">' + App.esc(o[1]) + '</button>';
    }).join('');
    V.el.appendChild(p);
    place(p, btn, false);
  }

  // ---- due popup: quick dates, a native date picker, or no date
  function dayISO(offset) {
    var n = App.now();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset, 12).toISOString();
  }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // A month grid (Monday first) in place of the native date picker, which closes itself on the iPad and is untested on the frame.
  function calHTML(c) {
    var y = V.cal.y, m = V.cal.m, now = App.now();
    var lead = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
    var cur = dueTime(c) !== null ? new Date(dueTime(c)) : null;
    var cells = '<span class="c-cal-dow">Mon</span><span class="c-cal-dow">Tue</span><span class="c-cal-dow">Wed</span><span class="c-cal-dow">Thu</span><span class="c-cal-dow">Fri</span><span class="c-cal-dow">Sat</span><span class="c-cal-dow">Sun</span>';
    for (var i = 0; i < lead; i++) cells += '<span></span>';
    for (var d = 1; d <= days; d++) {
      var today = y === now.getFullYear() && m === now.getMonth() && d === now.getDate();
      var on = cur && y === cur.getFullYear() && m === cur.getMonth() && d === cur.getDate();
      cells += '<button class="c-cal-day' + (today ? ' is-today' : '') + (on ? ' is-on' : '') + '" data-setdue="' + new Date(y, m, d, 12).toISOString() + '" data-for="' + App.esc(c.id) + '">' + d + '</button>';
    }
    return '<div class="c-cal-head"><button class="c-cal-nav" data-cal="prev" aria-label="Previous month">' + App.icon('left', 24) + '</button>' +
      '<b>' + MONTHS[m] + ' ' + y + '</b><button class="c-cal-nav" data-cal="next" aria-label="Next month">' + App.icon('right', 24) + '</button></div>' +
      '<div class="c-cal-grid">' + cells + '</div>';
  }
  function openDuePop(btn, c) {
    var cal = V.cal;
    closePop();
    V.popup = c.id; V.kind = 'due'; V.cal = cal;
    var id = App.esc(c.id);
    var opts = [['Today', dayISO(0)], ['Tomorrow', dayISO(1)], ['Next week', dayISO(7)]];
    var p = document.createElement('div');
    p.className = 'c-pop' + (cal ? ' c-pop--cal' : '');
    p.innerHTML = cal ? calHTML(c) : opts.map(function (o) {
      return '<button class="c-pop-opt" data-setdue="' + o[1] + '" data-for="' + id + '">' + o[0] + '</button>';
    }).join('') +
      '<button class="c-pop-opt" data-cal="open" data-for="' + id + '">Pick a date</button>' +
      (dueTime(c) !== null ? '<button class="c-pop-opt" data-setdue="" data-for="' + id + '">No date</button>' : '');
    V.el.appendChild(p);
    place(p, btn, true);
  }
  function calStep(id, step) {
    var c = byId(id), btn = c && byData('.s-list [data-due]', 'due', id);
    if (!c || !btn) return;
    var base = V.cal || (function () { var d = dueTime(c) !== null ? new Date(dueTime(c)) : App.now(); return { y: d.getFullYear(), m: d.getMonth() }; })();
    var d = new Date(base.y, base.m + step, 1);
    V.cal = { y: d.getFullYear(), m: d.getMonth() };
    openDuePop(btn, c);
  }

  // ---- writes. Serialised, so an undo can't overtake the tick it undoes; each queued write holds App.choresBusy so a
  // poll can't overwrite the optimistic state before it is sent.
  var queue = Promise.resolve();
  function guard(what, fn) {
    try { fn(); } catch (e) { console.warn('HomeHQ chores ' + what + ' failed:', e && e.message); }
  }
  function write(path, body, revert) {
    App.choresBusy++;
    var step = queue.then(function () {
      var req, before = V.renders;
      try {
        req = App.choresWrite(path, body);
      } catch (e) {
        req = Promise.reject(e);
      } finally {
        App.choresBusy--;
      }
      return req.then(function () {
        guard('repaint', function () { if (V.renders === before) repaint(); }); // live.js rerenders itself when the reply changed the list
        guard('emit', function () { App.emit('data'); });
      }, function (e) {
        console.warn('HomeHQ chores write failed:', path, e && e.message);
        if (revert) guard('revert', revert);
        guard('repaint', repaint);
        guard('emit', function () { App.emit('data'); });
        guard('toast', function () { App.toast('Couldn\'t update Trello', { icon: 'x', ms: 4000 }); });
      });
    });
    queue = step.then(null, function (e) { console.warn('HomeHQ chores queue step failed:', e && e.message); });
  }
  function saving(c) {
    if (!c._tmp) return false;
    App.toast('Still saving <b>' + App.esc(c.name) + '</b>…', { icon: 'cart', ms: 2000 });
    return true;
  }
  function setDone(c, done) {
    var was = c.done, id = c.id;
    c.done = done;
    if (done) c.at = new Date().toISOString();
    write('chores/' + id, { done: done }, function () { var cur = byId(id); if (cur) cur.done = was; });
  }

  function add(name) {
    if (!live()) return;
    name = name.trim();
    var c = find(name, false), msg;
    if (c) {
      msg = 'Already on the list · <b>' + App.esc(c.name) + '</b>';
    } else if ((c = find(name, true))) {
      if (saving(c)) return;
      setDone(c, false);
      msg = 'Added back <b>' + App.esc(c.name) + '</b>';
    } else {
      c = { id: 'tmp' + (++tmpId), _tmp: true, name: name.charAt(0).toUpperCase() + name.slice(1), who: '', usual: false, done: false, at: new Date().toISOString() };
      D.chores.push(c);
      var made = c;
      write('chores', { name: c.name }, function () { D.chores = D.chores.filter(function (x) { return x !== made; }); });
      msg = 'Added <b>' + App.esc(c.name) + '</b>';
    }
    V.query = '';
    var input = V.el.querySelector('.s-input');
    if (input) input.value = '';
    paintList(); paintSuggest();
    flash(c);
    App.emit('data');
    App.toast(msg, { icon: 'cart', ms: 3000 });
  }

  function check(c) {
    if (saving(c)) return;
    var id = c.id;
    setDone(c, true);
    paintList(); paintSuggest();
    App.emit('data');
    App.toast('<b>' + App.esc(c.name) + '</b> done', {
      icon: 'check',
      undo: function () {
        var cur = byId(id) || c;
        if (!live()) return;
        setDone(cur, false);
        paintList(); paintSuggest();
        App.emit('data');
      }
    });
  }

  function assign(c, who) {
    if (saving(c)) return;
    var was = c.who, id = c.id;
    c.who = who;
    write('chores/' + id, { who: who }, function () { var cur = byId(id); if (cur) cur.who = was; });
    paintList();
    App.emit('data');
  }

  function setDue(c, due) {
    if (saving(c)) return;
    var was = { due: c.due, dueComplete: c.dueComplete }, id = c.id;
    c.due = due;
    c.dueComplete = false;
    write('chores/' + id, { due: due }, function () { var cur = byId(id); if (cur) { cur.due = was.due; cur.dueComplete = was.dueComplete; } });
    paintList();
    App.emit('data');
  }

  function remove(c) {
    if (saving(c)) return;
    var id = c.id, name = c.name;
    D.chores = D.chores.filter(function (x) { return x !== c; });
    write('chores/' + id, { closed: true }, function () { if (!byId(id)) D.chores.push(c); });
    paintList(); paintSuggest();
    App.emit('data');
    App.toast('Removed <b>' + App.esc(name) + '</b>', { icon: 'x', ms: 3000 });
  }

  function onClick(e) {
    var t;
    if (V.popup && !e.target.closest('.c-pop') && !e.target.closest('[data-assign]') && !e.target.closest('[data-due]')) closePop();
    if (!live()) return;
    if ((t = e.target.closest('[data-cal]'))) {
      var id = t.dataset.for || V.popup;
      if (t.dataset.cal === 'open') V.cal = null;
      return calStep(id, t.dataset.cal === 'prev' ? -1 : t.dataset.cal === 'next' ? 1 : 0);
    }
    if ((t = e.target.closest('[data-setdue]'))) {
      var dc = byId(t.dataset.for);
      closePop();
      if (dc) setDue(dc, t.dataset.setdue);
      return;
    }
    if ((t = e.target.closest('[data-due]'))) {
      var uc = byId(t.dataset.due);
      if (V.popup === t.dataset.due) return closePop();
      if (uc && !saving(uc)) openDuePop(t, uc);
      return;
    }
    if ((t = e.target.closest('[data-who]'))) {
      var pc = byId(t.dataset.for);
      closePop();
      if (pc) assign(pc, t.dataset.who);
      return;
    }
    if ((t = e.target.closest('[data-assign]'))) {
      var ac = byId(t.dataset.assign);
      if (V.popup === t.dataset.assign) return closePop();
      if (ac && !saving(ac)) openPop(t, ac);
      return;
    }
    if ((t = e.target.closest('[data-check]'))) { var cc = byId(t.dataset.check); if (cc) check(cc); return; }
    if ((t = e.target.closest('[data-remove]'))) { var rc = byId(t.dataset.remove); if (rc) remove(rc); return; }
    if ((t = e.target.closest('[data-usual]'))) {
      var u = byId(t.dataset.usual);
      if (!u) return paintSuggest();
      var on = openFor(u);
      if (on) { // already on the list: feedback only
        flash(on);
        return App.toast('Already on the list · <b>' + App.esc(on.name) + '</b>', { icon: 'cart', ms: 2500 });
      }
      if (saving(u)) return;
      setDone(u, false);
      paintList(); paintSuggest(); flash(u);
      App.emit('data');
      return App.toast('Added back <b>' + App.esc(u.name) + '</b>', { icon: 'cart', ms: 2500 });
    }
    if ((t = e.target.closest('[data-add]'))) return add(t.dataset.add);
    if ((t = e.target.closest('[data-drawer]'))) { V.drawer = !V.drawer; return paintList(); }
    if ((t = e.target.closest('[data-revive]'))) {
      var r = byId(t.dataset.revive);
      if (!r || saving(r)) return;
      setDone(r, false);
      paintList(); paintSuggest(); App.emit('data');
      return App.toast('Added back <b>' + App.esc(r.name) + '</b>', { icon: 'cart', ms: 2500 });
    }
  }

  App.register('tasks', {
    show: function (el, opts) {
      if (!V.el) {
        V.el = el;
        el.addEventListener('click', onClick);
      }
      // A data refresh repaints in place, so it doesn't close the keyboard mid-word.
      if (opts && opts.rerender && V.el.querySelector('.s-list')) { V.renders++; return repaint(); }
      render();
    },
    hide: function () { if (V.el) closePop(); }
  });
})();
