import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagLines, diagRoute } from '../diag-route.js';
import { line, createInflux } from '../influx.js';

var NOW = 1700000000000;

async function call(influx, method, body) {
  var out = {};
  var res = { writeHead: function (s) { out.status = s; }, end: function (b) { out.body = JSON.parse(b); } };
  var readJSON = async function () { return body; };
  var send = function (r, s, b) { r.writeHead(s); r.end(JSON.stringify(b)); };
  await diagRoute({ influx: influx, readJSON: readJSON, send: send })({ method: method }, res);
  return out;
}

test('line escapes tags and strings, writes numbers as floats and skips missing values', function () {
  assert.equal(line('m', { a: 'x y', b: '', c: undefined }, { n: 3, s: 'say "hi"\nok', bad: NaN, gone: undefined, ok: true }, NOW),
    'm,a=x\\ y n=3,s="say \\"hi\\" ok",ok=true 1700000000000');
  assert.equal(line('m', {}, { bad: NaN }, NOW), '');
});

test('a beat maps to one page line with tags for view and mode', function () {
  var l = diagLines({ kind: 'beat', view: 'calendar', mode: 'day', gap: 120, ltN: 2, ltMax: 300, ltSum: 420, heap: 18, dom: 2400, w: 1280, h: 800, focus: false, sheet: true, up: 600, vis: true }, NOW);
  assert.deepEqual(l, ['page,mode=day,view=calendar gap_ms=120,longtask_n=2,longtask_max_ms=300,longtask_sum_ms=420,heap_mb=18,dom_nodes=2400,' +
    'inner_w=1280,inner_h=800,uptime_s=600,input_focus=false,sheet_open=true,visible=true 1700000000000']);
});

test('unknown view names and bad numbers are not trusted', function () {
  var l = diagLines({ kind: 'beat', view: 'a b,c', gap: -1, dom: 'lots', heap: 5 }, NOW)[0];
  assert.match(l, /^page,mode=other,view=other heap_mb=5 /);
});

test('a freeze is timestamped at its start and carries the crumbs', function () {
  var l = diagLines({ kind: 'freeze', view: 'tasks', mode: 'day', ms: 4000, crumbs: ['-5.0s go tasks 80ms', 7, '-0.1s focus input'] }, NOW)[0];
  assert.equal(l, 'freeze,mode=day,source=page,view=tasks ms=4000,crumbs="-5.0s go tasks 80ms | -0.1s focus input" ' + (NOW - 4000));
});

test('route writes lines and answers 200', async function () {
  var written = [];
  var r = await call(async function (lines) { written.push(lines); }, 'POST', { kind: 'beat', view: 'home', gap: 1 });
  assert.equal(r.status, 200);
  assert.equal(written.length, 1);
});

test('route: 503 without influx, 400 on a bad body, 405 on GET, 502 when the write fails', async function () {
  assert.equal((await call(null, 'POST', { kind: 'beat', gap: 1 })).status, 503);
  assert.equal((await call(async function () {}, 'POST', { kind: 'nope' })).status, 400);
  assert.equal((await call(async function () {}, 'GET')).status, 405);
  var orig = console.error; console.error = function () {};
  try {
    assert.equal((await call(async function () { throw new Error('down'); }, 'POST', { kind: 'beat', gap: 1 })).status, 502);
  } finally { console.error = orig; }
});

test('createInflux posts line protocol with the token and is null when unconfigured', async function () {
  assert.equal(createInflux({ url: 'http://i', token: '', db: 'frame' }), null);
  var seen;
  var w = createInflux({ url: 'http://i:8181/', token: 't0k', db: 'frame', fetchImpl: async function (u, o) { seen = { u: u, o: o }; return { ok: true }; } });
  await w(['a x=1 1', '']);
  assert.equal(seen.u, 'http://i:8181/api/v3/write_lp?db=frame&precision=millisecond');
  assert.equal(seen.o.headers.authorization, 'Bearer t0k');
  assert.equal(seen.o.body, 'a x=1 1');
});
