import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCalendar } from '../calendar-service.js';

var ics = readFileSync(new URL('./fixtures/calendar.ics', import.meta.url), 'utf8');
// A clock inside the fixture's week, so the events are in the window.
function clock(t) { var c = function () { return c.t; }; c.t = t; return c; }
var T0 = Date.parse('2026-10-17T00:00:00Z');

test('fetches once and serves the cache until the ttl passes', async function () {
  var calls = 0, c = clock(T0);
  var get = createCalendar({ url: 'u', ttlMs: 1000, clock: c, fetchText: async function () { calls++; return ics; } });
  var a = await get();
  assert.equal(a.stale, false);
  assert.ok(a.data.length > 5);
  c.t += 500; await get();
  assert.equal(calls, 1);
  c.t += 600; await get();
  assert.equal(calls, 2);
});

test('shares one in-flight fetch between concurrent callers', async function () {
  var calls = 0;
  var get = createCalendar({ url: 'u', clock: clock(T0), fetchText: async function () { calls++; await new Promise(function (r) { setTimeout(r, 20); }); return ics; } });
  await Promise.all([get(), get(), get()]);
  assert.equal(calls, 1);
});

test('serves the last good list as stale when a later fetch fails', async function () {
  var fail = false, c = clock(T0);
  var get = createCalendar({ url: 'u', ttlMs: 1000, clock: c, fetchText: async function () { if (fail) throw new Error('down'); return ics; } });
  var good = await get();
  fail = true; c.t += 2000;
  var later = await get();
  assert.equal(later.stale, true);
  assert.deepEqual(later.data, good.data);
  assert.equal(later.at, good.at);
});

test('a feed that is not iCal counts as a failure', async function () {
  var get = createCalendar({ url: 'u', clock: clock(T0), fetchText: async function () { return '<html>sign in</html>'; } });
  await assert.rejects(get(), /not an iCal feed/);
});

test('rejects when the very first fetch fails, then recovers', async function () {
  var fail = true;
  var get = createCalendar({ url: 'u', clock: clock(T0), fetchText: async function () { if (fail) throw new Error('down'); return ics; } });
  await assert.rejects(get(), /down/);
  fail = false;
  assert.equal((await get()).stale, false);
});

test('the url is passed to fetchText and never appears in a thrown error', async function () {
  var seen;
  var get = createCalendar({ url: 'https://secret.example/abc', clock: clock(T0), fetchText: async function (u) { seen = u; return 'nope'; } });
  await assert.rejects(get(), function (e) { return !/secret\.example/.test(e.message); });
  assert.equal(seen, 'https://secret.example/abc');
});
