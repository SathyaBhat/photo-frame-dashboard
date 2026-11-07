import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPhotos, buildAlbumPhotos, placeOf, validDay, validId, createPhotos, NotFound } from '../photos-service.js';
import { photosRoute } from '../photos-route.js';

function id(n) { return '00000000-0000-4000-8000-' + String(n).padStart(12, '0'); }
function asset(n, over) {
  return Object.assign({ id: id(n), type: 'IMAGE', width: 4032, height: 3024, localDateTime: '2021-11-02T08:49:15+00:00', isFavorite: false, isArchived: false, isTrashed: false, visibility: 'timeline' }, over || {});
}
function memory(assets, over) { return Object.assign({ type: 'on_this_day', data: { year: 2021 }, assets: assets }, over || {}); }
function clock(t) { var c = function () { return c.t; }; c.t = t; return c; }

test('maps memory assets to slideshow photos', function () {
  var out = buildPhotos([memory([asset(1), asset(2, { width: 3024, height: 4032, isFavorite: true, localDateTime: '2019-11-02T23:30:00+00:00' })])], { [id(1)]: 'Roșu, Ilfov' });
  assert.deepEqual(out, [
    { id: id(1), o: 'l', date: '2021-11-02', place: 'Roșu, Ilfov', fav: false, tag: 'year-2021' },
    { id: id(2), o: 'p', date: '2019-11-02', place: '', fav: true, tag: 'year-2019' }
  ]);
});

test('drops videos, archived, hidden, trashed, duplicates and bad ids', function () {
  var out = buildPhotos([
    memory([asset(1), asset(2, { type: 'VIDEO' }), asset(3, { isArchived: true }), asset(4, { visibility: 'hidden' }), asset(5, { isTrashed: true }), asset(6, { id: '../x' }), asset(7, { localDateTime: 'nope' })]),
    memory([asset(1)]),
    memory([asset(8)], { type: 'something_else' })
  ]);
  assert.deepEqual(out.map(function (p) { return p.id; }), [id(1)]);
});

test('caps the list at 200 photos', function () {
  var many = [];
  for (var i = 0; i < 250; i++) many.push(asset(i));
  assert.equal(buildPhotos([memory(many)]).length, 200);
});

test('place is city plus state, or country without a state', function () {
  assert.equal(placeOf({ city: 'North Sydney', state: 'New South Wales', country: 'Australia' }), 'North Sydney, New South Wales');
  assert.equal(placeOf({ city: 'Helsinki', state: null, country: 'Finland' }), 'Helsinki, Finland');
  assert.equal(placeOf({ city: 'Singapore', state: 'Singapore' }), 'Singapore');
  assert.equal(placeOf({}), '');
  assert.equal(placeOf(null), '');
});

test('validates days and ids', function () {
  assert.ok(validDay('2026-11-02'));
  assert.ok(!validDay('2026-02-30'));
  assert.ok(!validDay('2026-11-02&x=1'));
  assert.ok(validId(id(1)));
  assert.ok(!validId('../../users'));
});

// A fake Immich: memories for one day, assets with exif, thumbnails as small bodies.
function fakeImmich(opts) {
  opts = opts || {};
  var f = async function (path) {
    f.calls.push(path);
    if (opts.fail) throw new Error('down');
    var m = /^\/memories\?for=(.*)$/.exec(path);
    if (m) return { json: async function () { return f.memories[m[1]] || []; } };
    m = /^\/assets\/([^/]+)$/.exec(path);
    if (m) return { json: async function () { if (opts.noPlace) throw new Error('bad'); return { exifInfo: { city: 'City ' + m[1].slice(-1), state: 'State' } }; } };
    m = /^\/assets\/([^/]+)\/thumbnail\?size=(.*)$/.exec(path);
    if (m) return { headers: new Headers({ 'content-type': 'image/jpeg' }), body: null, size: m[2] };
    throw new Error('unexpected ' + path);
  };
  f.calls = [];
  f.memories = { '2026-11-02': [memory([asset(1), asset(2)])] };
  return f;
}

test('fetches memories once per ttl and caches place lookups', async function () {
  var api = fakeImmich(), c = clock(0);
  var p = createPhotos({ request: api, ttlMs: 1000, clock: c });
  var a = await p.get('2026-11-02');
  assert.deepEqual(a.data.map(function (x) { return x.place; }), ['City 1, State', 'City 2, State']);
  await p.get('2026-11-02');
  assert.equal(api.calls.length, 3);
  c.t += 2000;
  await p.get('2026-11-02');
  assert.deepEqual(api.calls.slice(3), ['/memories?for=2026-11-02']); // places came from the cache
});

test('a failed place lookup leaves the place empty', async function () {
  var p = createPhotos({ request: fakeImmich({ noPlace: true }) });
  var a = await p.get('2026-11-02');
  assert.deepEqual(a.data.map(function (x) { return x.place; }), ['', '']);
});

test('serves the last good list as stale when Immich goes down, rejects with nothing cached', async function () {
  var api = fakeImmich(), c = clock(0);
  var p = createPhotos({ request: api, ttlMs: 1000, clock: c });
  var good = await p.get('2026-11-02');
  api.calls.length = 0;
  var down = createPhotos({ request: fakeImmich({ fail: true }) });
  await assert.rejects(down.get('2026-11-02'), /down/);
  c.t += 2000;
  var orig = api.memories;
  api.memories = null; // memories lookup now throws
  var later = await p.get('2026-11-02');
  assert.equal(later.stale, true);
  assert.deepEqual(later.data, good.data);
  api.memories = orig;
});

test('the image proxy only serves photos it has handed out', async function () {
  var api = fakeImmich();
  var p = createPhotos({ request: api });
  await assert.rejects(p.image(id(1)), NotFound); // nothing listed yet
  await p.get('2026-11-02');
  assert.equal((await p.image(id(1))).size, 'preview');
  assert.equal((await p.image(id(1), 'thumbnail')).size, 'thumbnail');
  assert.equal((await p.image(id(1), 'original')).size, 'preview');
  await assert.rejects(p.image(id(9)), NotFound);
  await assert.rejects(p.image('../x'), NotFound);
});

async function call(photos, method, url) {
  var out = { headers: {} };
  var res = {
    writeHead: function (s, h) { out.status = s; Object.assign(out.headers, h); },
    end: function (b) { if (b) out.body = JSON.parse(b); },
    on: function () {}
  };
  var send = function (r, s, b) { r.writeHead(s); r.end(JSON.stringify(b)); };
  var u = new URL(url, 'http://x');
  await photosRoute({ photos: photos, send: send })({ method: method }, res, u.pathname, u.searchParams);
  return out;
}

test('route: 503 without Immich, 400 on a bad day, photos for a good one', async function () {
  assert.equal((await call(null, 'GET', '/api/photos')).status, 503);
  var p = createPhotos({ request: fakeImmich() });
  assert.equal((await call(p, 'GET', '/api/photos?day=2026-13-01')).status, 400);
  assert.equal((await call(p, 'POST', '/api/photos')).status, 405);
  var r = await call(p, 'GET', '/api/photos?day=2026-11-02');
  assert.equal(r.status, 200);
  assert.equal(r.body.photos.length, 2);
  assert.equal(r.body.day, '2026-11-02');
  assert.equal(r.body.stale, false);
});

test('route: 502 when Immich is down, 404 for an unknown image, image headers for a known one', async function () {
  assert.equal((await call(createPhotos({ request: fakeImmich({ fail: true }) }), 'GET', '/api/photos?day=2026-11-02')).status, 502);
  var p = createPhotos({ request: fakeImmich() });
  assert.equal((await call(p, 'GET', '/api/photos/' + id(1))).status, 404);
  await p.get('2026-11-02');
  var r = await call(p, 'GET', '/api/photos/' + id(1));
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'image/jpeg');
  assert.match(r.headers['cache-control'], /max-age=86400/);
});

test('a day without memories gets the most recent earlier day that has some', async function () {
  var api = fakeImmich();
  var p = createPhotos({ request: api });
  var r = await p.get('2026-11-05');
  assert.equal(r.from, '2026-11-02');
  assert.equal(r.data.length, 2);
  assert.deepEqual(api.calls.filter(function (c) { return /^\/memories/.test(c); }), ['/memories?for=2026-11-05', '/memories?for=2026-11-04', '/memories?for=2026-11-03', '/memories?for=2026-11-02']);
  assert.equal((await p.get('2026-11-02')).from, '2026-11-02');
});

test('looks back at most a week, then answers an empty list', async function () {
  var api = fakeImmich();
  var p = createPhotos({ request: api });
  var r = await p.get('2026-11-10'); // 11-02 is 8 days back
  assert.deepEqual(r.data, []);
  assert.equal(r.from, null);
  assert.equal(api.calls.length, 8);
});

test('after a restart the image proxy rebuilds the day it is told about', async function () {
  var api = fakeImmich();
  var fresh = createPhotos({ request: api }); // nothing cached, as after a deploy
  assert.equal((await fresh.image(id(1), undefined, '2026-11-02')).size, 'preview');
  await assert.rejects(fresh.image(id(9), undefined, '2026-11-02'), NotFound);
  await assert.rejects(createPhotos({ request: fakeImmich() }).image(id(1), undefined, 'bad'), NotFound);
});

test('route: reports which day the photos are from, and passes the day to the image proxy', async function () {
  var p = createPhotos({ request: fakeImmich() });
  var r = await call(p, 'GET', '/api/photos?day=2026-11-04');
  assert.equal(r.body.day, '2026-11-04');
  assert.equal(r.body.from, '2026-11-02');
  var fresh = createPhotos({ request: fakeImmich() });
  assert.equal((await call(fresh, 'GET', '/api/photos/' + id(1) + '?day=2026-11-04&size=thumbnail')).status, 200);
});

// A fake Immich with albums: /search/random answers an album's assets, /albums lists owned and shared albums.
function fakeAlbums(byAlbum, lists) {
  var f = async function (path, timeoutMs, body) {
    f.calls.push({ path: path, body: body });
    if (f.fail) throw new Error('down');
    if (path === '/search/random') return { json: async function () { return byAlbum[body.albumIds[0]] || []; } };
    if (path === '/albums') return { json: async function () { return lists.owned; } };
    if (path === '/albums?shared=true') return { json: async function () { return lists.shared; } };
    if (/\/thumbnail\?/.test(path)) return { headers: new Headers({ 'content-type': 'image/jpeg' }), body: null };
    throw new Error('unexpected ' + path);
  };
  f.calls = [];
  return f;
}
var A = id(91), B = id(92);

test('album photos take their place from exif, skip what memories skip, and come sorted by id', function () {
  var out = buildAlbumPhotos([
    asset(4, { width: 3024, height: 4032 }), asset(1, { exifInfo: { city: 'Canacona', state: 'Goa' } }),
    asset(2, { type: 'VIDEO' }), asset(3, { isArchived: true }), asset(1)
  ]);
  assert.deepEqual(out.map(function (p) { return [p.id, p.place, p.o]; }), [[id(1), 'Canacona, Goa', 'l'], [id(4), '', 'p']]);
});

test('the default album replaces memories, in one request of at most 200', async function () {
  var api = fakeAlbums({ [A]: [asset(2), asset(1)] }, {});
  var p = createPhotos({ request: api, album: A });
  var r = await p.get('2026-11-02');
  assert.deepEqual(r.data.map(function (x) { return x.id; }), [id(1), id(2)]);
  assert.equal(r.album, A);
  assert.deepEqual(api.calls.map(function (c) { return c.path; }), ['/search/random']);
  assert.deepEqual(api.calls[0].body, { albumIds: [A], type: 'IMAGE', withExif: true, size: 200 });
  await p.get('2026-11-03'); // same album on another day: cached
  assert.equal(api.calls.length, 1);
});

test('the frame can ask for another album, or for memories, instead of the default', async function () {
  var api = fakeAlbums({ [A]: [asset(1)], [B]: [asset(5)] }, {});
  var p = createPhotos({ request: api, album: A });
  assert.deepEqual((await p.get('2026-11-02', B)).data.map(function (x) { return x.id; }), [id(5)]);
  var mem = fakeImmich();
  var q = createPhotos({ request: mem, album: A });
  var r = await q.get('2026-11-02', 'memories');
  assert.equal(r.album, null);
  assert.equal(r.from, '2026-11-02');
});

test('after a restart the image proxy rebuilds the album it is told about', async function () {
  var fresh = createPhotos({ request: fakeAlbums({ [A]: [asset(1)], [B]: [asset(5)] }, {}) });
  await fresh.image(id(5), undefined, '2026-11-02', B);
  await assert.rejects(fresh.image(id(1), undefined, '2026-11-02', B), NotFound); // in A, not in B
});

test('albums: owned and shared, without empty ones or duplicates, last changed first, cached', async function () {
  var api = fakeAlbums({}, {
    owned: [
      { id: A, albumName: 'Frame', assetCount: 50, lastModifiedAssetTimestamp: '2026-11-06T00:00:00Z' },
      { id: id(93), albumName: 'Empty', assetCount: 0 },
      { id: 'bad', albumName: 'Bad', assetCount: 3 }
    ],
    shared: [
      { id: B, albumName: '  ', assetCount: 9, lastModifiedAssetTimestamp: '2026-11-07T00:00:00Z' },
      { id: A, albumName: 'Frame', assetCount: 50 }
    ]
  });
  var c = clock(0);
  var p = createPhotos({ request: api, album: A, clock: c });
  var r = await p.albums();
  assert.deepEqual(r, { albums: [{ id: B, name: 'Untitled', count: 9 }, { id: A, name: 'Frame', count: 50 }], default: A });
  await p.albums();
  assert.equal(api.calls.length, 2);
  c.t += 11 * 60 * 1000;
  api.fail = true;
  assert.deepEqual((await p.albums()).albums.length, 2); // Immich down: last good list
  await assert.rejects(createPhotos({ request: api }).albums(), /down/);
});

test('route: albums list, album query checked and passed through', async function () {
  var api = fakeAlbums({ [A]: [asset(1)], [B]: [asset(5)] }, { owned: [{ id: A, albumName: 'Frame', assetCount: 1 }], shared: [] });
  var p = createPhotos({ request: api, album: A });
  var l = await call(p, 'GET', '/api/photos/albums');
  assert.equal(l.status, 200);
  assert.deepEqual(l.body, { albums: [{ id: A, name: 'Frame', count: 1 }], default: A });
  assert.equal((await call(p, 'GET', '/api/photos?album=../x')).status, 400);
  var r = await call(p, 'GET', '/api/photos?day=2026-11-02&album=' + B);
  assert.equal(r.body.album, B);
  assert.equal(r.body.photos[0].id, id(5));
  var fresh = createPhotos({ request: fakeAlbums({ [B]: [asset(5)] }, {}), album: A });
  assert.equal((await call(fresh, 'GET', '/api/photos/' + id(5) + '?day=2026-11-02&album=' + B)).status, 200);
  api.fail = true;
  assert.equal((await call(createPhotos({ request: api }), 'GET', '/api/photos/albums')).status, 502);
});
