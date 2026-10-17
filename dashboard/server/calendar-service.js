// Caches the parsed calendar so the frame's polling never turns into one Google fetch per request.
import { buildCalendar } from './calendar-map.js';

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
