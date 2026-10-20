// Chores: the Chores lists on the Trello board (live.js), laid out like Shopping. Open chores are grouped by
// assignee (a Trello card member; nobody = "Either"), the usuals are tiles that put a done chore back, and
// ticked chores wait in a Got-it drawer. Writes go through App.choresWrite; there is no mock list.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, query: '', drawer: false, popup: null };
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

  function row(c) {
    var id = App.esc(c.id);
    return '<div class="s-row' + (c._tmp ? ' is-saving' : '') + '" data-id="' + id + '">' +
      '<button class="s-hit" data-check="' + id + '"><span class="s-box">' + App.icon('check', 22) + '</span>' +
      '<span class="s-name"><b>' + App.esc(c.name) + '</b></span></button>' +
      '<button class="s-lowbtn c-assign' + (c.who ? ' is-on' : '') + '" data-assign="' + id + '">' + App.esc(memberName(c.who)) + '</button>' +
      '<button class="c-remove" data-remove="' + id + '" aria-label="Remove">' + App.icon('x', 24) + '</button>' +
      '</div>';
  }

  function listHTML() {
    if (!live()) {
      return '<div class="s-empty serif">' + (D.choresOffline ? 'Can\'t reach the chore list.<br><i>Trying again…</i>' : 'No chore list yet.') + '</div>';
    }
    var items = open();
    var groups = D.members.map(function (m) { return { name: m.name, items: items.filter(function (c) { return c.who === m.id; }) }; });
    var known = {};
    D.members.forEach(function (m) { known[m.id] = true; });
    groups.push({ name: 'Either', items: items.filter(function (c) { return !known[c.who]; }) });
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
  function repaint() { if (V.el && V.el.querySelector('.s-list')) { paintList(); paintSuggest(); } }
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
    V.popup = null;
    var p = V.el && V.el.querySelector('.c-pop');
    if (p) p.parentNode.removeChild(p);
  }
  function openPop(btn, c) {
    closePop();
    V.popup = c.id;
    var opts = D.members.map(function (m) { return [m.id, m.name]; }).concat([['', 'Either']]);
    var p = document.createElement('div');
    p.className = 'c-pop';
    p.innerHTML = opts.map(function (o) {
      return '<button class="c-pop-opt' + (o[0] === c.who || (!o[0] && !c.who) ? ' is-on' : '') + '" data-who="' + App.esc(o[0]) + '" data-for="' + App.esc(c.id) + '">' + App.esc(o[1]) + '</button>';
    }).join('');
    V.el.appendChild(p);
    var b = btn.getBoundingClientRect(), host = V.el.getBoundingClientRect();
    var h = p.offsetHeight, top = b.bottom - host.top + 6;
    if (top + h > host.height) top = Math.max(0, b.top - host.top - h - 6);
    p.style.top = top + 'px';
    p.style.left = Math.max(0, Math.min(b.right - host.left - p.offsetWidth, host.width - p.offsetWidth)) + 'px';
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
      var req;
      try {
        req = App.choresWrite(path, body);
      } catch (e) {
        req = Promise.reject(e);
      } finally {
        App.choresBusy--;
      }
      return req.then(function () {
        guard('repaint', repaint);
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
    if (was === who) return;
    c.who = who;
    write('chores/' + id, { who: who }, function () { var cur = byId(id); if (cur) cur.who = was; });
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
    if (V.popup && !e.target.closest('.c-pop') && !e.target.closest('[data-assign]')) closePop();
    if (!live()) return;
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
      if (!V.el) { V.el = el; el.addEventListener('click', onClick); }
      // A data refresh repaints in place, so it doesn't close the keyboard mid-word.
      if (opts && opts.rerender && V.el.querySelector('.s-list')) return repaint();
      render();
    },
    hide: function () { if (V.el) closePop(); }
  });
})();
