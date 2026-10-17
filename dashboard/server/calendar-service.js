// Caches the parsed calendar so the frame's polling never turns into one Google fetch per request.
import { buildCalendar } from './calendar-map.js';

// Fetch the feed text. The address is a credential and fetch's own errors quote it (a malformed value
// throws 'Failed to parse URL from "<url>"'), so failures are rethrown without it.
export async function fetchFeed(url) {
  var res;
  try {
    res = await fetch(url, { headers: { 'user-agent': 'photo-frame-dashboard (home use)' }, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw new Error('calendar feed unreachable');
  }
  if (!res.ok) throw new Error('calendar feed -> HTTP ' + res.status);
  return res.text();
}

export function createCalendar({ url, fetchText, ttlMs, clock }) {
  var ttl = ttlMs === undefined ? 5 * 60 * 1000 : ttlMs;
  var nowMs = clock || Date.now;
  var cache = { at: 0, data: null, inflight: null };
  return async function get() {
    if (cache.data && nowMs() - cache.at < ttl) return { data: cache.data, stale: false, at: cache.at };
    try {
      cache.inflight = cache.inflight || fetchText(url).then(function (ics) { return buildCalendar({ ics: ics, now: new Date(nowMs()) }); });
      cache.data = await cache.inflight;
      cache.at = nowMs();
      return { data: cache.data, stale: false, at: cache.at };
    } catch (e) {
      console.error('calendar refresh failed:', e.message);
      if (cache.data) return { data: cache.data, stale: true, at: cache.at };
      throw e;
    } finally {
      cache.inflight = null;
    }
  };
}
