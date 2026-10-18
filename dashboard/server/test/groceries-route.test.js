import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groceriesRoute } from '../groceries-route.js';
import { BadRequest, NotFound } from '../trello-service.js';

var ID = 'a'.repeat(24);
var RESULT = { data: { items: [{ id: ID }], stores: ['Aldi'], categories: ['Dairy'] }, stale: false, at: 1700000000000 };

function fakeTrello(over) {
  var calls = [];
  var t = { calls: calls };
  ['get', 'tick', 'setLow', 'setUsual', 'setCategory', 'setStore', 'add'].forEach(function (k) {
    t[k] = async function () { calls.push([k].concat([].slice.call(arguments))); return RESULT; };
  });
  return Object.assign(t, over || {});
}

async function call(trello, method, path, body) {
  var out = {};
  var res = { writeHead: function (s) { out.status = s; }, end: function (b) { out.body = JSON.parse(b); } };
  var readJSON = async function () {
    if (body instanceof Error) throw body;
    return body === undefined ? {} : body;
  };
  var send = function (r, s, b) { r.writeHead(s); r.end(JSON.stringify(b)); };
  await groceriesRoute({ trello: trello, readJSON: readJSON, send: send })({ method: method }, res, path);
  return out;
}

test('GET returns groceries, stale and updated', async function () {
  var r = await call(fakeTrello(), 'GET', '/api/groceries');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.groceries, RESULT.data);
  assert.equal(r.body.stale, false);
  assert.equal(r.body.updated, new Date(RESULT.at).toISOString());
});

test('503 when trello is not configured', async function () {
  var r = await call(null, 'GET', '/api/groceries');
  assert.equal(r.status, 503);
  assert.deepEqual(r.body, { error: 'trello not configured' });
});

test('POST add passes name, cat, store', async function () {
  var t = fakeTrello();
  var r = await call(t, 'POST', '/api/groceries', { name: 'Milk', cat: 'Dairy', store: 'Aldi' });
  assert.equal(r.status, 200);
  assert.deepEqual(t.calls[0], ['add', { name: 'Milk', cat: 'Dairy', store: 'Aldi' }]);
});

test('POST add rejects missing and over-long names', async function () {
  var t = fakeTrello();
  assert.equal((await call(t, 'POST', '/api/groceries', {})).status, 400);
  assert.equal((await call(t, 'POST', '/api/groceries', { name: 5 })).status, 400);
  assert.equal((await call(t, 'POST', '/api/groceries', { name: 'x'.repeat(201) })).status, 400);
  assert.equal((await call(t, 'POST', '/api/groceries', { name: 'Milk', cat: 3 })).status, 400);
  assert.equal(t.calls.length, 0);
});

test('invalid JSON is 400', async function () {
  var r = await call(fakeTrello(), 'POST', '/api/groceries', new BadRequest('invalid JSON'));
  assert.equal(r.status, 400);
});

test('id must be 24 hex characters', async function () {
  var t = fakeTrello();
  assert.equal((await call(t, 'POST', '/api/groceries/xyz', { done: true })).status, 400);
  assert.equal((await call(t, 'POST', '/api/groceries/' + 'A'.repeat(24), { done: true })).status, 400);
  assert.equal(t.calls.length, 0);
});

test('exactly one of done, low, usual, cat, store', async function () {
  var t = fakeTrello();
  var p = '/api/groceries/' + ID;
  assert.equal((await call(t, 'POST', p, { done: true, low: true })).status, 400);
  assert.equal((await call(t, 'POST', p, {})).status, 400);
  assert.equal((await call(t, 'POST', p, { done: 'yes' })).status, 400);
  assert.equal((await call(t, 'POST', p, { low: 1 })).status, 400);
  assert.equal((await call(t, 'POST', p, { cat: true })).status, 400);
  assert.equal((await call(t, 'POST', p, { store: null })).status, 400);
  assert.equal((await call(t, 'POST', p, { usual: 'true' })).status, 400);
  assert.equal((await call(t, 'POST', p, { usual: 1 })).status, 400);
  assert.equal((await call(t, 'POST', p, { usual: true, done: false })).status, 400);
  var bad = await call(t, 'POST', p, { nope: true });
  assert.match(bad.body.error, /usual/);
  assert.equal(t.calls.length, 0);
});

test('each field dispatches to its write', async function () {
  var t = fakeTrello();
  var p = '/api/groceries/' + ID;
  await call(t, 'POST', p, { done: true });
  await call(t, 'POST', p, { low: false });
  await call(t, 'POST', p, { cat: 'Dairy' });
  await call(t, 'POST', p, { store: '' });
  await call(t, 'POST', p, { usual: true });
  await call(t, 'POST', p, { usual: false });
  assert.deepEqual(t.calls, [['tick', ID, true], ['setLow', ID, false], ['setCategory', ID, 'Dairy'], ['setStore', ID, ''], ['setUsual', ID, true], ['setUsual', ID, false]]);
});

test('other methods are 405', async function () {
  assert.equal((await call(fakeTrello(), 'DELETE', '/api/groceries')).status, 405);
  assert.equal((await call(fakeTrello(), 'GET', '/api/groceries/' + ID)).status, 405);
});

test('service BadRequest is 400, NotFound is 404', async function () {
  var p = '/api/groceries/' + ID;
  assert.equal((await call(fakeTrello({ tick: async function () { throw new BadRequest('nope'); } }), 'POST', p, { done: true })).status, 400);
  assert.equal((await call(fakeTrello({ tick: async function () { throw new NotFound('gone'); } }), 'POST', p, { done: true })).status, 404);
});

test('backend failure is 502 without leaking details', async function () {
  var t = fakeTrello({ get: async function () { throw new Error('GET https://api.trello.com/1?key=SECRET&token=SECRET2 failed'); } });
  var origErr = console.error; console.error = function () {};
  var r;
  try { r = await call(t, 'GET', '/api/groceries'); } finally { console.error = origErr; }
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { error: 'trello unavailable' });
  assert.ok(!JSON.stringify(r.body).includes('SECRET'));
});
