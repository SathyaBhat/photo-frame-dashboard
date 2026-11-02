// Immich "On this day" memories for the slideshow, plus a proxy for their images so the API key stays here.
// Only photos this service has handed out can be fetched through the proxy, not the rest of the library.

export class NotFound extends Error {}

var MAX_PHOTOS = 200;
var LOOKUPS = 4; // concurrent asset lookups for place names
var LOOKBACK = 7; // days to look back for memories when a day has none

export function addDays(day, n) {
  var d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function validDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  var d = new Date(day + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === day;
}

export function validId(id) {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
}

export function placeOf(exif) {
  if (!exif) return '';
  var parts = [exif.city, exif.state || exif.country].filter(function (x) { return typeof x === 'string' && x.trim(); });
  if (parts.length === 2 && parts[0] === parts[1]) parts.pop();
  return parts.join(', ');
}

// Memories -> the slideshow's photo shape. Images only, nothing archived, hidden or trashed.
// localDateTime is the wall-clock time where the photo was taken, so its date part is the photo's day.
export function buildPhotos(memories, places) {
  var out = [], seen = {};
  (memories || []).forEach(function (m) {
    if (m.type !== 'on_this_day' || m.isTrashed) return;
    (m.assets || []).forEach(function (a) {
      if (!a || !validId(a.id) || seen[a.id] || a.type !== 'IMAGE' || a.isTrashed || a.isArchived) return;
      if (a.visibility && a.visibility !== 'timeline') return;
      var date = String(a.localDateTime || a.fileCreatedAt || '').slice(0, 10);
      if (!validDay(date)) return;
      seen[a.id] = true;
      out.push({
        id: a.id,
        o: a.height > a.width ? 'p' : 'l',
        date: date,
        place: (places && places[a.id]) || '',
        fav: !!a.isFavorite,
        tag: 'year-' + date.slice(0, 4)
      });
    });
  });
  return out.slice(0, MAX_PHOTOS);
}

// The key can show up in errors fetch quotes, so failures are rethrown with fixed messages.
export function defaultRequest(url, key) {
  return async function (path, timeoutMs) {
    var res;
    try {
      res = await fetch(url + '/api' + path, { headers: { 'x-api-key': key, accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs || 15000) });
    } catch (e) {
      throw new Error('immich unreachable');
    }
    if (res.status === 400 || res.status === 404) throw new NotFound('immich -> HTTP ' + res.status);
    if (!res.ok) throw new Error('immich -> HTTP ' + res.status);
    return res;
  };
}

export function createPhotos({ url, key, request, ttlMs, clock }) {
  var ttl = ttlMs === undefined ? 60 * 60 * 1000 : ttlMs;
  var nowMs = clock || Date.now;
  var api = request || defaultRequest(url, key);
  var days = {};   // day -> { at, data, inflight }
  var places = {}; // asset id -> place name; a photo's place doesn't change
  var placeCount = 0;

  async function json(path) {
    var res = await api(path);
    try { return await res.json(); } catch (e) { throw new Error('immich sent an unreadable response'); }
  }

  async function lookUpPlaces(ids) {
    var todo = ids.filter(function (id) { return !(id in places); });
    if (placeCount + todo.length > 5000) { places = {}; placeCount = 0; todo = ids; }
    var i = 0;
    async function worker() {
      while (i < todo.length) {
        var id = todo[i++];
        try {
          places[id] = placeOf((await json('/assets/' + id)).exifInfo);
        } catch (e) {
          continue; // no place for this one; try again on the next refresh
        }
        placeCount++;
      }
    }
    var workers = [];
    for (var n = 0; n < LOOKUPS; n++) workers.push(worker());
    await Promise.all(workers);
    return places;
  }

  // The day's memories, or if it has none, those of the most recent day before it that has some (up to LOOKBACK days).
  async function fetchDay(day) {
    for (var i = 0; i <= LOOKBACK; i++) {
      var d = addDays(day, -i);
      var memories = await json('/memories?for=' + d);
      if (!Array.isArray(memories)) throw new Error('immich sent an unexpected response');
      var ids = buildPhotos(memories).map(function (p) { return p.id; });
      if (ids.length) return { photos: buildPhotos(memories, await lookUpPlaces(ids)), from: d };
    }
    return { photos: [], from: null };
  }

  async function get(day) {
    var c = days[day];
    if (c && c.data && nowMs() - c.at < ttl) return { data: c.data, from: c.from, stale: false, at: c.at };
    if (!c) {
      // Only a few days are ever asked for (today, maybe a demo date): drop the rest.
      var keys = Object.keys(days);
      if (keys.length >= 3) keys.forEach(function (k) { if (!days[k].inflight) delete days[k]; });
      c = days[day] = { at: 0, data: null, from: null, inflight: null };
    }
    try {
      c.inflight = c.inflight || fetchDay(day);
      var got = await c.inflight;
      c.data = got.photos;
      c.from = got.from;
      c.at = nowMs();
      return { data: c.data, from: c.from, stale: false, at: c.at };
    } catch (e) {
      console.error('photos refresh failed:', e.message);
      if (c.data) return { data: c.data, from: c.from, stale: true, at: c.at };
      throw e;
    } finally {
      c.inflight = null;
    }
  }

  function known(id) {
    return Object.keys(days).some(function (k) {
      return days[k].data && days[k].data.some(function (p) { return p.id === id; });
    });
  }

  // preview is about 1440 px on the long side (JPEG), thumbnail about 250 px (WebP).
  // The frame sends the day its list is for: after a server restart the cache is empty, so that day's list is
  // fetched again before the photo is checked, instead of refusing photos the frame is still showing.
  async function image(id, size, day) {
    if (!validId(id)) throw new NotFound('unknown photo');
    if (!known(id) && validDay(day)) { try { await get(day); } catch (e) { /* answered below */ } }
    if (!known(id)) throw new NotFound('unknown photo');
    return api('/assets/' + id + '/thumbnail?size=' + (size === 'thumbnail' ? 'thumbnail' : 'preview'), 20000);
  }

  return { get: get, image: image };
}
