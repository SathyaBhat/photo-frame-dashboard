// Shopping: categorized list (left) + quick-add with usuals (right).
// Mock list (D.groceriesLive false): local only, with quantities. Live list (the Trello board via live.js):
// taps write back through App.groceriesWrite; there is no quantity, and items can be tagged Low.
// Unavailable (the server failed before any live list arrived): no list and no edits until a poll succeeds.
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, store: 'all', query: '', drawer: false, pending: {}, flash: null, renders: 0 };
  var DAY = 24 * 60 * 60 * 1000;
  var tmpId = 0;
  // The catalog guesses use the mock's category names; the board has its own.
  var LIVE_CAT = {
    'Dairy & Eggs': 'Dairy & Refrigerated', 'Meat & Fish': 'Meat & Seafood', 'Bakery': 'Bakery', 'Produce': 'Fruits & Veggies',
    'Pantry': 'Pantry', 'Frozen': 'Pantry', 'Snacks': 'Snacks', 'Household': 'Household'
  };

  function live() { return !!D.groceriesLive; }
  function unavailable() { return !live() && !!D.groceriesOffline; }
  function byId(id) { return D.groceries.filter(function (g) { return g.id === id; })[0]; }
  // The active tab may name a store that is gone (mock ids once the live list arrives): fall back to All.
  function tab() {
    if (V.store !== 'all' && !D.stores.some(function (s) { return s.id === V.store; })) V.store = 'all';
    return V.store;
  }
  function inTab(g) { var t = tab(); return t === 'all' || g.store === t; }
  function recent(g) { var t = Date.parse(g.at); return !isNaN(t) && Date.now() - t < DAY; }
  function open() { return D.groceries.filter(function (g) { return !g.done && inTab(g); }); }
  function done() { return D.groceries.filter(function (g) { return g.done && inTab(g) && (!live() || recent(g)); }); }
  function storeName(id) { var s = D.stores.filter(function (x) { return x.id === id; })[0]; return s ? s.name : id; }
  function catOrder() {
    var order = (D.catOrder[tab()] || D.catOrder.all || []).slice();
    if (order.indexOf('Other') < 0) order.push('Other');
    return order;
  }

  function categorize(name) {
    var n = name.toLowerCase();
    var hit = D.catalog.filter(function (c) { return c[0].toLowerCase() === n; })[0] ||
      D.catalog.filter(function (c) { var a = c[0].toLowerCase(); return a.indexOf(n) > -1 || n.indexOf(a) > -1; })[0] ||
      D.catalog.filter(function (c) { return n.split(/\s+/).some(function (w) { return w.length > 3 && c[0].toLowerCase().indexOf(w) > -1; }); })[0];
    var cat = hit ? hit[1] : 'Other';
    if (live()) return LIVE_CAT[cat] || 'Other';
    return cat;
  }
  function find(name, isDone) {
    return D.groceries.filter(function (g) { return !!g.done === isDone && g.name.toLowerCase() === name.toLowerCase(); })[0];
  }
  // Attribute lookups without building selectors from user data.
  function byData(sel, key, val) { return Array.prototype.filter.call(V.el.querySelectorAll(sel), function (n) { return n.dataset[key] === val; })[0]; }

  function storeTag(g) {
    if (tab() !== 'all' || !g.store) return '';
    // mock: tag only the stores other than the first (the everyday one), as before
    if (!live() && D.stores[0] && g.store === D.stores[0].id) return '';
    return '<span class="s-store">' + App.esc(storeName(g.store)) + '</span>';
  }
  function row(g) {
    var id = App.esc(g.id);
    return '<div class="s-row' + (V.pending[g.id] ? ' is-checking' : '') + (g._tmp ? ' is-saving' : '') + '" data-id="' + id + '">' +
      '<button class="s-hit" data-check="' + id + '">' +
      '<span class="s-box">' + App.icon('check', 22) + '</span>' +
      '<span class="s-name"><b>' + App.esc(g.name) + '</b>' + (g.note ? '<small>' + App.esc(g.note) + '</small>' : '') + '</span>' +
      (live() && g.low ? '<span class="s-low">Low</span>' : '') +
      storeTag(g) +
      '</button>' +
      (live()
        ? '<button class="s-lowbtn' + (g.low ? ' is-on' : '') + '" data-low="' + id + '" aria-pressed="' + !!g.low + '">' + (g.low ? 'Not low' : 'Mark low') + '</button>'
        : '<div class="s-qty"><button data-qty="-1" data-id="' + id + '" aria-label="Less">' + App.icon('minus', 22) + '</button><span class="num">' + g.qty + '</span><button data-qty="1" data-id="' + id + '" aria-label="More">' + App.icon('plus', 22) + '</button></div>') +
      '</div>';
  }

  function listHTML() {
    if (unavailable()) return '<div class="s-empty serif">Can\'t reach the grocery list.<br><i>Trying again…</i></div>';
    var items = open(), order = catOrder();
    items.forEach(function (g) { if (order.indexOf(g.cat) < 0) order.push(g.cat); });
    var groups = order.map(function (cat) { return { cat: cat, items: items.filter(function (g) { return g.cat === cat; }) }; }).filter(function (x) { return x.items.length; });
    var d = done();
    return (items.length ? groups.map(function (gr) {
      return '<div class="s-cat" data-cat="' + App.esc(gr.cat) + '"><div class="s-cat-h"><span class="label">' + App.esc(gr.cat) + '</span><span class="label" data-cat-count>' + gr.items.length + '</span></div>' + gr.items.map(row).join('') + '</div>';
    }).join('') : '<div class="s-empty serif">All stocked up.<br><i>Nothing left to buy.</i></div>') +
      (d.length ? '<div class="s-drawer' + (V.drawer ? ' is-open' : '') + '">' +
        '<button class="s-drawer-h" data-drawer><span>' + App.icon('check', 22) + ' Got it <b class="num">(' + d.length + ')</b></span><span class="label">' + (V.drawer ? 'Hide' : 'Show') + '</span></button>' +
        (V.drawer ? '<div class="s-drawer-list">' + d.map(function (g) {
          return '<button class="s-got" data-revive="' + App.esc(g.id) + '">' + App.esc(g.name) + '<span class="label">Add back</span></button>';
        }).join('') + (live() ? '' : '<button class="btn btn--ghost s-clear" data-clear>Clear ' + d.length + ' checked items</button>') + '</div>' : '') +
        '</div>' : '');
  }

  function suggestHTML() {
    if (unavailable()) return '';
    var q = V.query.trim().toLowerCase();
    if (q) {
      var matches = D.catalog.filter(function (c) { return c[0].toLowerCase().indexOf(q) === 0; })
        .concat(D.catalog.filter(function (c) { var i = c[0].toLowerCase().indexOf(q); return i > 0; })).slice(0, 5);
      var exact = matches.some(function (m) { return m[0].toLowerCase() === q; });
      return '<div class="label">Suggestions</div><div class="s-ac">' + matches.map(function (m) {
        var on = find(m[0], false);
        return '<button class="s-ac-row" data-add="' + App.esc(m[0]) + '"><b>' + App.esc(m[0]) + '</b><span class="label">' + (on ? 'On list' + (live() ? '' : ' · ×' + on.qty) : App.esc(live() ? LIVE_CAT[m[1]] || 'Other' : m[1])) + '</span>' + App.icon('plus', 26) + '</button>';
      }).join('') + (exact ? '' : '<button class="s-ac-row s-ac-row--new" data-add="' + App.esc(V.query.trim()) + '"><b>Add “' + App.esc(V.query.trim()) + '”</b><span class="label">' + App.esc(categorize(V.query)) + '</span>' + App.icon('plus', 26) + '</button>') + '</div>';
    }
    if (!live()) return '<div class="label">Usuals · tap to add</div><div class="s-usuals">' + D.usuals.map(usualTile).join('') + '</div>';
    var u = liveUsuals();
    if (!u.length) return '<div class="label">Usuals · tap to add</div><div class="s-usuals-empty">No usuals yet. Give a card the "Usual" label in Trello (or tell Hermes) and it shows up here.</div>';
    return '<div class="label">Usuals · tap to add</div><div class="s-usuals">' + u.map(liveTile).join('') + '</div>';
  }
  // Live: the cards labelled Usual (To Buy or Stocked), by name. Array sort is stable in Chromium 106.
  function liveUsuals() {
    return D.groceries.filter(function (g) { return g.usual; }).sort(function (a, b) {
      var x = a.name.toLowerCase(), y = b.name.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
  }
  function liveTile(g) {
    var on = !g.done;
    return '<button class="s-tile' + (on ? ' is-on' : '') + '" data-usual="' + App.esc(g.id) + '">' +
      '<b>' + App.esc(g.name) + '</b><span>' + (on ? App.icon('check', 16) + 'On list' : App.esc(g.cat)) + '</span></button>';
  }
  // Mock: a name from D.usuals.
  function usualTile(name) {
    var on = find(name, false), stocked = live() && find(name, true);
    var cat = stocked ? stocked.cat : categorize(name);
    return '<button class="s-tile' + (on ? ' is-on' : '') + '" data-add="' + App.esc(name) + '">' +
      '<b>' + App.esc(name) + '</b><span>' + (on ? App.icon('check', 16) + 'On list' + (!live() && on.qty > 1 ? ' ×' + on.qty : '') : App.esc(cat)) + '</span></button>';
  }

  // ---- granular updates (full list + usuals rebuild costs ~500ms on the wall tablet)
  function swap(old, html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    old.parentNode.replaceChild(tmp.firstChild, old);
  }
  function rowEl(g) { return byData('.s-list .s-row', 'id', g.id); }
  function refreshSuggestFor(g) {
    if (V.query.trim()) return paintSuggest();
    if (live()) {
      var lt = byData('.s-usuals [data-usual]', 'usual', g.id);
      if (lt) swap(lt, liveTile(g));
      return;
    }
    var t = byData('.s-usuals [data-add]', 'add', g.name);
    if (t) swap(t, usualTile(g.name));
  }
  function catCount(cat) {
    var c = byData('.s-cat', 'cat', cat);
    if (!c) return;
    var n = c.querySelectorAll('.s-row').length;
    if (!n) c.parentNode.removeChild(c);
    else c.querySelector('[data-cat-count]').textContent = n;
  }
  function inView(g) { return !g.done && inTab(g); }
  function insertRow(g) {
    var cat = byData('.s-cat', 'cat', g.cat);
    if (!inView(g)) return paintHead();
    if (!cat) return paintList();
    var tmp = document.createElement('div');
    tmp.innerHTML = row(g);
    cat.appendChild(tmp.firstChild);
    catCount(g.cat);
    paintHead();
  }
  function removeRow(g) {
    var r = rowEl(g);
    var drawer = V.el.querySelector('.s-drawer');
    if (!r || !drawer || V.drawer || !open().length) return paintList();
    r.parentNode.removeChild(r);
    catCount(g.cat);
    drawer.querySelector('.num').textContent = '(' + done().length + ')';
    paintHead();
  }
  function flash(g) {
    var r = rowEl(g);
    if (!r) return;
    r.classList.add('is-flash');
    if (r.scrollIntoView) r.scrollIntoView({ block: 'nearest' });
    setTimeout(function () { r.classList.remove('is-flash'); }, 1200);
  }

  function paintList() { tab(); var l = V.el.querySelector('.s-list'); var st = l.scrollTop; l.innerHTML = listHTML(); l.scrollTop = st; paintHead(); }
  function paintSuggest() { V.el.querySelector('.s-suggest').innerHTML = suggestHTML(); }
  function paintInput() {
    var input = V.el.querySelector('.s-input');
    if (!input) return;
    input.disabled = unavailable();
    if (live()) input.maxLength = 120; // the server takes up to 200
    else input.removeAttribute('maxlength');
  }
  function paintHead() {
    var all = D.groceries.filter(function (g) { return !g.done; }), t = tab(), off = unavailable();
    paintInput();
    V.el.querySelector('.s-count').innerHTML = '<span class="num">' + (off ? '–' : open().length) + '</span> to get';
    V.el.querySelector('.s-off').textContent = D.groceriesOffline ? 'Couldn\'t reach Trello' : '';
    V.el.querySelector('.s-stores').innerHTML = off ? '' : [['all', 'All']].concat(D.stores.map(function (s) { return [s.id, s.name]; })).map(function (s) {
      var n = s[0] === 'all' ? all.length : all.filter(function (g) { return g.store === s[0]; }).length;
      return '<button class="' + (t === s[0] ? 'is-on' : '') + '" data-store="' + App.esc(s[0]) + '">' + App.esc(s[1]) + ' <span class="num">' + n + '</span></button>';
    }).join('');
  }
  // Repaint from D.* (live.js may have replaced the list), keeping the input and its focus.
  function repaint() {
    if (!V.el || !V.el.querySelector('.s-list')) return;
    paintList(); paintSuggest();
  }
  function render() {
    V.renders++;
    tab();
    V.el.innerHTML = '<div class="shop">' +
      '<header class="s-head"><div><div class="label">Shared list</div><h1 class="serif">Groceries</h1><div class="s-off" role="status"></div></div><div class="s-count"></div><div class="seg s-stores"></div></header>' +
      '<div class="s-list"></div>' +
      '<aside class="s-side">' +
      '  <div class="s-add">' +
      '    <label class="s-input-wrap">' + App.icon('plus', 30) + '<input class="s-input" placeholder="Add an item…" autocomplete="off" enterkeyhint="done"></label>' +
      '  </div>' +
      '  <div class="s-suggest"></div>' +
      '</aside></div>';
    var input = V.el.querySelector('.s-input');
    input.value = V.query;
    input.addEventListener('input', function () { V.query = input.value; paintSuggest(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && input.value.trim()) { add(input.value); } });
    paintList(); paintSuggest();
  }

  // ---- writes to the board. Serialised, so an undo can't overtake the tick it undoes. Each queued write
  // holds App.groceriesBusy, so a poll can't overwrite the optimistic state before it is sent.
  var queue = Promise.resolve();
  // A throwing repaint/revert/toast must not jam the queue or skip the steps after it.
  function guard(what, fn) {
    try { fn(); } catch (e) { console.warn('HomeHQ groceries ' + what + ' failed:', e && e.message); }
  }
  function write(path, body, revert) {
    App.groceriesBusy++;
    var step = queue.then(function () {
      var before = V.renders, req;
      try {
        req = App.groceriesWrite(path, body);
      } catch (e) {
        req = Promise.reject(e);
      } finally {
        App.groceriesBusy--; // this write's queue hold; App.groceriesWrite holds its own while in flight
      }
      return req.then(function () {
        // Accepted by the server: nothing below may revert it.
        guard('repaint', function () { if (V.renders === before) repaint(); }); // live.js rerenders itself when the reply changed the list
        guard('emit', function () { App.emit('data'); });
      }, function (e) {
        console.warn('HomeHQ groceries write failed:', path, e && e.message);
        if (revert) guard('revert', revert);
        guard('repaint', repaint);
        guard('emit', function () { App.emit('data'); });
        guard('toast', function () { App.toast('Couldn\'t update Trello', { icon: 'x', ms: 4000 }); });
      });
    });
    queue = step.then(null, function (e) { console.warn('HomeHQ groceries queue step failed:', e && e.message); });
  }
  function saving(g) {
    if (!g._tmp) return false;
    App.toast('Still saving <b>' + App.esc(g.name) + '</b>…', { icon: 'cart', ms: 2000 });
    return true;
  }
  function revive(g) {
    g.done = false;
    if (live()) write('groceries/' + g.id, { done: false }, function () { var c = byId(g.id); if (c) c.done = true; });
  }

  function add(name) {
    if (unavailable()) return;
    name = name.trim();
    var g = find(name, false), msg;
    if (g) {
      if (live()) msg = 'Already on the list · <b>' + App.esc(g.name) + '</b>';
      else {
        g.qty++;
        msg = 'Already on the list · now <b>×' + g.qty + '</b> ' + App.esc(g.name);
        var q = rowEl(g);
        q = q && q.querySelector('.s-qty .num');
        if (q) q.textContent = g.qty;
      }
    } else if ((g = find(name, true))) {
      g.qty = 1;
      revive(g);
      msg = 'Added back <b>' + App.esc(g.name) + '</b>';
      paintList();
    } else {
      var cat = D.catalog.filter(function (c) { return c[0].toLowerCase() === name.toLowerCase(); })[0];
      var t = tab();
      g = { name: cat ? cat[0] : name.charAt(0).toUpperCase() + name.slice(1), cat: categorize(name), qty: 1, done: false, note: '' };
      if (live()) {
        g.id = 'tmp' + (++tmpId); g._tmp = true; g.low = false; g.at = new Date().toISOString();
        g.store = t === 'all' ? '' : t;
        var body = { name: g.name };
        if (g.cat !== 'Other' && (D.catOrder.all || []).indexOf(g.cat) > -1) body.cat = g.cat;
        if (g.store) body.store = storeName(g.store);
        write('groceries', body, function () { D.groceries = D.groceries.filter(function (x) { return x !== g; }); });
      } else {
        g.id = D._gid();
        g.store = t === 'all' ? (D.stores[0] ? D.stores[0].id : '') : t;
      }
      D.groceries.push(g);
      msg = 'Added <b>' + App.esc(g.name) + '</b> to ' + App.esc(g.cat);
      insertRow(g);
    }
    var hadQuery = !!V.query.trim();
    V.query = '';
    var input = V.el.querySelector('.s-input');
    if (input) input.value = '';
    if (hadQuery) paintSuggest(); else refreshSuggestFor(g);
    flash(g);
    App.emit('data');
    App.toast(msg, { icon: 'cart', ms: 3000 });
  }

  // The list may be replaced (live polls/replies) while a tick is pending, so look the item up again by id.
  function check(g) {
    var id = g.id, name = g.name, posted = false;
    V.pending[id] = true;
    var r = rowEl(g);
    if (r) r.classList.add('is-checking');
    setTimeout(function () {
      if (!V.pending[id]) return;
      delete V.pending[id];
      var cur = byId(id);
      if (!cur || unavailable()) return paintList(); // gone from the board meanwhile, or the list is unavailable
      cur.done = true;
      if (live()) {
        cur.at = new Date().toISOString();
        posted = true;
        write('groceries/' + id, { done: true }, function () { var c = byId(id); if (c) c.done = false; });
      }
      removeRow(cur);
      refreshSuggestFor(cur);
      App.emit('data');
    }, 1200);
    App.toast('<b>' + App.esc(name) + '</b> checked off', {
      icon: 'check',
      undo: function () {
        if (unavailable()) return;
        var cur = byId(id) || g;
        var wasDone = cur.done;
        delete V.pending[id];
        cur.done = false;
        if (posted) write('groceries/' + id, { done: false }, function () { var c = byId(id); if (c) c.done = true; });
        if (wasDone) paintList();
        else { var el = rowEl(cur); if (el) el.classList.remove('is-checking'); }
        refreshSuggestFor(cur);
        App.emit('data');
      }
    });
  }

  function toggleLow(g) {
    var id = g.id, v = !g.low;
    function set(val) {
      var c = byId(id);
      if (!c) return;
      c.low = val;
      var el = rowEl(c);
      if (el) swap(el, row(c));
    }
    set(v);
    write('groceries/' + id, { low: v }, function () { set(!v); });
  }

  function onClick(e) {
    var t;
    if (unavailable()) return;
    if ((t = e.target.closest('[data-check]'))) {
      var g = byId(t.dataset.check);
      if (g && saving(g)) return;
      if (g && !V.pending[g.id]) check(g);
      else if (g) { delete V.pending[g.id]; t.parentNode.classList.remove('is-checking'); }
      return;
    }
    if ((t = e.target.closest('[data-low]'))) {
      var lg = byId(t.dataset.low);
      if (lg && live() && !saving(lg)) toggleLow(lg);
      return;
    }
    if ((t = e.target.closest('[data-qty]'))) {
      var q = byId(t.dataset.id);
      if (!q) return;
      q.qty = Math.max(1, q.qty + +t.dataset.qty);
      t.parentNode.querySelector('.num').textContent = q.qty;
      refreshSuggestFor(q);
      return;
    }
    if ((t = e.target.closest('[data-usual]'))) {
      var u = byId(t.dataset.usual);
      if (!u || !live()) return paintSuggest();
      if (!u.done) return flash(u); // already on the list
      revive(u); paintList(); refreshSuggestFor(u); flash(u); App.emit('data');
      return App.toast('Added back <b>' + App.esc(u.name) + '</b>', { icon: 'cart', ms: 2500 });
    }
    if ((t = e.target.closest('[data-add]'))) return add(t.dataset.add);
    if ((t = e.target.closest('[data-store]'))) { V.store = t.dataset.store; return paintList(); }
    if ((t = e.target.closest('[data-drawer]'))) { V.drawer = !V.drawer; return paintList(); }
    if ((t = e.target.closest('[data-revive]'))) {
      var r = byId(t.dataset.revive);
      if (!r) return paintList();
      revive(r); paintList(); paintSuggest(); App.emit('data');
      return App.toast('Added back <b>' + App.esc(r.name) + '</b>', { icon: 'cart', ms: 2500 });
    }
    if ((t = e.target.closest('[data-clear]'))) {
      if (live()) return;
      var gone = done();
      D.groceries = D.groceries.filter(function (x) { return gone.indexOf(x) < 0; });
      V.drawer = false;
      paintList();
      App.toast('Cleared ' + gone.length + ' items', {
        icon: 'check', undo: function () { D.groceries = D.groceries.concat(gone); paintList(); }
      });
    }
  }

  App.register('shopping', {
    show: function (el, opts) {
      if (!V.el) { V.el = el; el.addEventListener('click', onClick); }
      // A data refresh repaints in place, so it doesn't close the keyboard mid-word.
      if (opts && opts.rerender && V.el.querySelector('.s-list')) { V.renders++; return repaint(); }
      render();
    }
  });
})();
