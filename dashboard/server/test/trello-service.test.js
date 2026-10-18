import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrello, NotFound, BadRequest } from '../trello-service.js';
import { BadRequest as HaBadRequest } from '../ha-map.js';

function clock(t) { var c = function () { return c.t; }; c.t = t; return c; }
var T0 = Date.parse('2026-10-18T00:00:00Z');

function makeBoard() {
  return {
    id: 'bfull',
    lists: [{ id: 'lbuy', name: '🛒 To Buy' }, { id: 'lstock', name: 'Stocked' }],
    labels: [{ id: 'lab-prod', name: 'Fruits & Veggies' }, { id: 'lab-low', name: 'Low' }, { id: 'lab-s1', name: 'Store: Aldi' }],
    cards: [
      { id: 'c1', name: 'Milk', idList: 'lbuy', idLabels: ['lab-prod', 'lab-low'], desc: '', dateLastActivity: '2026-10-17T00:00:00Z' },
      { id: 'c2', name: 'Rice', idList: 'lstock', idLabels: [], desc: '', dateLastActivity: '2026-10-16T00:00:00Z' }
    ]
  };
}

// A fake fetchJSON recording calls; reads answer with the board, label creation with a new id.
function fake(opts) {
  opts = opts || {};
  var f = function (method, path, query) {
    f.calls.push({ method: method, path: path, query: query });
    if (opts.fail && opts.fail(method, path)) return Promise.reject(opts.error || new Error('down'));
    if (method === 'GET') return Promise.resolve(JSON.parse(JSON.stringify(f.board)));
    if (path === '/labels') return Promise.resolve({ id: 'new-' + query.name });
    return Promise.resolve({ id: 'card-new' });
  };
  f.calls = []; f.board = opts.board || makeBoard();
  f.writes = function () { return f.calls.filter(function (c) { return c.method !== 'GET'; }); };
  f.reads = function () { return f.calls.filter(function (c) { return c.method === 'GET'; }); };
  return f;
}

test('reads the board in one call and caches until the ttl passes', async function () {
  var f = fake(), c = clock(T0);
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, ttlMs: 1000, clock: c });
  var a = await t.get();
  assert.equal(a.stale, false);
  assert.equal(a.data.items.length, 2);
  assert.deepEqual(f.calls[0], { method: 'GET', path: '/boards/b1', query: { lists: 'open', cards: 'open', labels: 'all' } });
  c.t += 500; await t.get();
  assert.equal(f.reads().length, 1);
  c.t += 600; await t.get();
  assert.equal(f.reads().length, 2);
});

test('shares one in-flight read between concurrent callers', async function () {
  var calls = 0, f = fake();
  var slow = function (m, p, q) { calls++; return new Promise(function (r) { setTimeout(r, 20); }).then(function () { return f(m, p, q); }); };
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: slow, clock: clock(T0) });
  await Promise.all([t.get(), t.get(), t.get()]);
  assert.equal(calls, 1);
});

test('serves the last good copy as stale when a later read fails', async function () {
  var fail = false, c = clock(T0);
  var f = fake({ fail: function () { return fail; } });
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, ttlMs: 1000, clock: c });
  var good = await t.get();
  fail = true; c.t += 2000;
  var later = await t.get();
  assert.equal(later.stale, true);
  assert.deepEqual(later.data, good.data);
  assert.equal(later.at, good.at);
});

test('rejects when the first read fails, then recovers', async function () {
  var fail = true;
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: fake({ fail: function () { return fail; } }), clock: clock(T0) });
  await assert.rejects(t.get(), /down/);
  fail = false;
  assert.equal((await t.get()).stale, false);
});

test('the default fetchJSON never leaks the key, token or url in an error', async function () {
  var real = globalThis.fetch;
  try {
    globalThis.fetch = async function (url) { throw new Error('Failed to parse ' + url + ' key=KEY123 token=TOK456'); };
    var t = createTrello({ key: 'KEY123', token: 'TOK456', board: 'b1', clock: clock(T0) });
    await assert.rejects(t.get(), function (e) { return !/KEY123|TOK456|trello\.com/.test(e.message) && /trello unreachable/.test(e.message); });
    globalThis.fetch = async function () { return { ok: false, status: 401, json: async function () { return {}; } }; };
    await assert.rejects(t.get(), function (e) { return e.message === 'trello -> HTTP 401'; });
  } finally { globalThis.fetch = real; }
});

test('the default fetchJSON sends credentials as query params and maps 404 to NotFound', async function () {
  var real = globalThis.fetch, seen;
  try {
    globalThis.fetch = async function (url, init) { seen = { url: String(url), method: init.method }; return { ok: false, status: 404, json: async function () { return {}; } }; };
    var t = createTrello({ key: 'KEY123', token: 'TOK456', board: 'b1', clock: clock(T0) });
    await assert.rejects(t.get(), function (e) { return e instanceof NotFound && !/KEY123|TOK456/.test(e.message); });
    assert.match(seen.url, /^https:\/\/api\.trello\.com\/1\/boards\/b1\?/);
    assert.match(seen.url, /key=KEY123/);
    assert.match(seen.url, /token=TOK456/);
    assert.equal(seen.method, 'GET');
  } finally { globalThis.fetch = real; }
});

test('BadRequest is the one from ha-map', function () {
  assert.equal(BadRequest, HaBadRequest);
});

test('tick of a To Buy card issues one PUT to Stocked, then refetches', async function () {
  var f = fake();
  f.board.cards[0].idLabels = ['lab-prod'];
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, clock: clock(T0) });
  await t.get();
  var res = await t.tick('c1', true);
  assert.deepEqual(f.writes(), [{ method: 'PUT', path: '/cards/c1', query: { idList: 'lstock', pos: 'top' } }]);
  assert.equal(f.reads().length, 2);
  assert.ok(res.data && res.stale === false);
});

test('tick done:true of a card labelled Low moves it and removes Low with exactly one DELETE', async function () {
  var f = fake();
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, clock: clock(T0) });
  await t.get();
  await t.tick('c1', true);
  assert.deepEqual(f.writes(), [
    { method: 'PUT', path: '/cards/c1', query: { idList: 'lstock', pos: 'top' } },
    { method: 'DELETE', path: '/cards/c1/idLabels/lab-low', query: {} }
  ]);
});

test('tick done:true of an already-Stocked card that still has Low removes Low without a move', async function () {
  var f = fake();
  f.board.cards[1].idLabels = ['lab-low'];
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, clock: clock(T0) });
  await t.tick('c2', true);
  assert.deepEqual(f.writes(), [{ method: 'DELETE', path: '/cards/c2/idLabels/lab-low', query: {} }]);
});

test('tick done:false leaves the Low label alone', async function () {
  var f = fake();
  f.board.cards[1].idLabels = ['lab-low'];
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, clock: clock(T0) });
  await t.tick('c2', false);
  assert.deepEqual(f.writes(), [{ method: 'PUT', path: '/cards/c2', query: { idList: 'lbuy', pos: 'top' } }]);
});

test('a 404 on the Low DELETE during a tick is not an error', async function () {
  var f = fake({ fail: function (m) { return m === 'DELETE'; }, error: new NotFound('trello -> HTTP 404') });
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, clock: clock(T0) });
  var res = await t.tick('c1', true);
  assert.ok(res.data);
  assert.equal(f.writes().length, 2);
});

test('tick done:false moves a Stocked card back to To Buy', async function () {
  var f = fake();
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, clock: clock(T0) });
  await t.tick('c2', false);
  assert.deepEqual(f.writes(), [{ method: 'PUT', path: '/cards/c2', query: { idList: 'lbuy', pos: 'top' } }]);
});

test('ticking an already-Stocked card issues no PUT', async function () {
  var f = fake();
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, clock: clock(T0) });
  await t.get();
  var res = await t.tick('c2', true);
  assert.equal(f.writes().length, 0);
  assert.ok(res.data);
});

test('a 404 on write resolves with a fresh read', async function () {
  var f = fake({ fail: function (m) { return m === 'PUT'; }, error: new NotFound('trello -> HTTP 404') });
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, clock: clock(T0) });
  await t.get();
  var res = await t.tick('c1', true);
  assert.equal(f.reads().length, 2);
  assert.ok(res.data);
});

test('a card unknown to the board is a no-op that resolves', async function () {
  var f = fake();
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, clock: clock(T0) });
  await t.tick('gone', true);
  assert.equal(f.writes().length, 0);
});

test('other write errors propagate', async function () {
  var f = fake({ fail: function (m) { return m === 'PUT'; } });
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, clock: clock(T0) });
  await assert.rejects(t.tick('c1', true), /down/);
});

test('add creates a missing category label, then the card with idLabels', async function () {
  var f = fake();
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, clock: clock(T0) });
  await t.add({ name: 'Bread', cat: 'Bakery', store: 'Aldi' });
  var w = f.writes();
  assert.deepEqual(w[0], { method: 'POST', path: '/labels', query: { name: 'Bakery', color: 'null', idBoard: 'bfull' } });
  assert.equal(w[1].method, 'POST');
  assert.equal(w[1].path, '/cards');
  assert.equal(w[1].query.idList, 'lbuy');
  assert.equal(w[1].query.name, 'Bread');
  assert.equal(w[1].query.idLabels, 'new-Bakery,lab-s1');
  assert.equal(w.length, 2);
});

test('add creates a missing store label named "Store: <name>"', async function () {
  var f = fake();
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, clock: clock(T0) });
  await t.add({ name: 'Eggs', cat: 'Fruits & Veggies', store: 'Costco' });
  assert.equal(f.writes()[0].query.name, 'Store: Costco');
  assert.equal(f.writes()[1].query.idLabels, 'lab-prod,new-Store: Costco');
});

test('setLow(id,false) removes the label; setLow(id,true) when set is a no-op', async function () {
  var f = fake();
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, clock: clock(T0) });
  await t.setLow('c1', true);
  assert.equal(f.writes().length, 0);
  await t.setLow('c1', false);
  assert.deepEqual(f.writes(), [{ method: 'DELETE', path: '/cards/c1/idLabels/lab-low', query: {} }]);
});

test('setLow(id,true) adds the label', async function () {
  var f = fake();
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, clock: clock(T0) });
  await t.setLow('c2', true);
  assert.deepEqual(f.writes(), [{ method: 'POST', path: '/cards/c2/idLabels', query: { value: 'lab-low' } }]);
});

test('setCategory swaps the category label', async function () {
  var f = fake();
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, clock: clock(T0) });
  await t.setCategory('c1', 'Pantry');
  var w = f.writes();
  assert.deepEqual(w.map(function (x) { return x.method + ' ' + x.path; }), ['DELETE /cards/c1/idLabels/lab-prod', 'POST /labels', 'POST /cards/c1/idLabels']);
  assert.equal(w[2].query.value, 'new-Pantry');
});

test('setStore replaces the store label; empty clears it', async function () {
  var f = fake();
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, clock: clock(T0) });
  f.board.cards[0].idLabels.push('lab-s1');
  await t.setStore('c1', '');
  assert.deepEqual(f.writes(), [{ method: 'DELETE', path: '/cards/c1/idLabels/lab-s1', query: {} }]);
});

test('validation failures throw BadRequest before any call', async function () {
  var f = fake();
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, clock: clock(T0) });
  await assert.rejects(t.add({ name: 'X', cat: 'Nope', store: '' }), BadRequest);
  await assert.rejects(t.setCategory('c1', 'Nope'), BadRequest);
  await assert.rejects(t.setStore('c1', new Array(42).join('a')), BadRequest);
  await assert.rejects(t.setStore('c1', 'bad\nname'), BadRequest);
  await assert.rejects(t.add({ name: '  ', cat: 'Fruits & Veggies' }), BadRequest);
  assert.equal(f.calls.length, 0);
});

test('two concurrent adds with the same missing label create it once', async function () {
  var f = fake();
  var slow = function (m, p, q) { return new Promise(function (r) { setTimeout(r, 10); }).then(function () { return f(m, p, q); }); };
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: slow, clock: clock(T0) });
  await t.get();
  await Promise.all([t.add({ name: 'A', cat: 'Bakery' }), t.add({ name: 'B', cat: 'Bakery' })]);
  var posts = f.writes().filter(function (c) { return c.path === '/labels'; });
  assert.equal(posts.length, 1);
  assert.equal(f.writes().filter(function (c) { return c.path === '/cards'; }).length, 2);
});

test('a read begun before a write is neither joined by nor cached after it', async function () {
  var f = fake(), c = clock(T0), release, hold = false;
  var fx = function (m, p, q) {
    if (m === 'GET' && hold) {
      hold = false;
      var snap = JSON.parse(JSON.stringify(f.board));
      return new Promise(function (r) { release = function () { r(snap); }; });
    }
    if (m === 'PUT') f.board.cards[0].idList = 'lstock';
    return f(m, p, q);
  };
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: fx, ttlMs: 1000, clock: c });
  await t.get();
  c.t += 2000; hold = true;
  var old = t.get();
  var res = await t.tick('c1', true);
  assert.equal(res.data.items.filter(function (i) { return i.id === 'c1'; })[0].done, true);
  release(); await old;
  var next = await t.get();
  assert.equal(next.data.items.filter(function (i) { return i.id === 'c1'; })[0].done, true);
});

test('a failed multi-step write still invalidates the cache', async function () {
  var f = fake({ fail: function (m, p) { return p === '/labels'; } });
  var t = createTrello({ key: 'k', token: 't', board: 'b1', fetchJSON: f, clock: clock(T0) });
  await t.get();
  await assert.rejects(t.setCategory('c1', 'Pantry'), /down/);
  await t.get();
  assert.equal(f.reads().length, 2);
});
