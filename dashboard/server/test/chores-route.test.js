import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choresRoute } from '../chores-route.js';
import { BadRequest, NotFound } from '../trello-service.js';

var ID = 'a'.repeat(24);
var RESULT = { data: { items: [{ id: ID }], members: [{ id: 'm1', name: 'Sat' }] }, stale: false, at: 1700000000000 };

function fakeTrello(over) {
  var calls = [];
  var t = { calls: calls };
  ['getChores', 'tickChore', 'setChoreUsual', 'setChoreWho', 'removeChore', 'addChore'].forEach(function (k) {
    t[k] = async function () { calls.push([k].concat([].slice.call(arguments))); return RESULT; };
  });
  return Object.assign(t, over || {});
}

async function call(trello, method, path, body) {
  var out = {};
  var res = { writeHead: function (s) { out.status = s; }, end: function (b) { out.body = JSON.parse(b); } };
  var readJSON = async function () { return body === undefined ? {} : body; };
  var send = function (r, s, b) { r.writeHead(s); r.end(JSON.stringify(b)); };
  await choresRoute({ trello: trello, readJSON: readJSON, send: send })({ method: method }, res, path);
  return out;
}

test('GET returns chores, stale and updated', async function () {
  var r = await call(fakeTrello(), 'GET', '/api/chores');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.chores, RESULT.data);
  assert.equal(r.body.stale, false);
  assert.equal(r.body.updated, new Date(RESULT.at).toISOString());
});

test('503 when trello is not configured', async function () {
  assert.equal((await call(null, 'GET', '/api/chores')).status, 503);
});

test('POST adds a chore with name and who', async function () {
  var t = fakeTrello();
  var r = await call(t, 'POST', '/api/chores', { name: 'Mow', who: 'm1' });
  assert.equal(r.status, 200);
  assert.deepEqual(t.calls, [['addChore', { name: 'Mow', who: 'm1' }]]);
});

test('POST add rejects a missing name and a non-string who', async function () {
  assert.equal((await call(fakeTrello(), 'POST', '/api/chores', {})).status, 400);
  assert.equal((await call(fakeTrello(), 'POST', '/api/chores', { name: 'x', who: 5 })).status, 400);
  assert.equal((await call(fakeTrello(), 'POST', '/api/chores', [])).status, 400);
});

test('each edit field goes to its method', async function () {
  var cases = [
    [{ done: true }, ['tickChore', ID, true]],
    [{ usual: false }, ['setChoreUsual', ID, false]],
    [{ who: 'm1' }, ['setChoreWho', ID, 'm1']],
    [{ who: '' }, ['setChoreWho', ID, '']],
    [{ closed: true }, ['removeChore', ID]]
  ];
  for (var i = 0; i < cases.length; i++) {
    var t = fakeTrello();
    var r = await call(t, 'POST', '/api/chores/' + ID, cases[i][0]);
    assert.equal(r.status, 200);
    assert.deepEqual(t.calls, [cases[i][1]]);
  }
});

test('bad edits are 400', async function () {
  var bodies = [{ closed: false }, { done: true, usual: true }, {}, { done: 'yes' }, { who: 1 }, { nope: true }, null];
  for (var i = 0; i < bodies.length; i++) {
    assert.equal((await call(fakeTrello(), 'POST', '/api/chores/' + ID, bodies[i])).status, 400);
  }
  assert.equal((await call(fakeTrello(), 'POST', '/api/chores/not-an-id', { done: true })).status, 400);
});

test('other methods and paths are 405', async function () {
  assert.equal((await call(fakeTrello(), 'DELETE', '/api/chores')).status, 405);
  assert.equal((await call(fakeTrello(), 'GET', '/api/chores/' + ID)).status, 405);
  assert.equal((await call(fakeTrello(), 'POST', '/api/chores/a/b', {})).status, 405);
});

test('service errors map to 400, 404 and a fixed 502', async function () {
  var r = await call(fakeTrello({ getChores: async function () { throw new BadRequest('unknown member'); } }), 'GET', '/api/chores');
  assert.deepEqual([r.status, r.body.error], [400, 'unknown member']);
  r = await call(fakeTrello({ removeChore: async function () { throw new NotFound('x'); } }), 'POST', '/api/chores/' + ID, { closed: true });
  assert.equal(r.status, 404);
  r = await call(fakeTrello({ getChores: async function () { throw new Error('secret key=abc'); } }), 'GET', '/api/chores');
  assert.deepEqual([r.status, r.body], [502, { error: 'trello unavailable' }]);
});
