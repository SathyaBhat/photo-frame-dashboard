// Tiny LAN API for the photo frame. Credentials and upstream fetching live here, never in the browser.
import { createServer } from 'node:http';
import { buildWeather } from './weather-map.js';

var BOM = 'https://api.weather.bom.gov.au/v1';
var TTL = 15 * 60 * 1000;
var PORT = +process.env.PORT || 8080;
// A BOM geohash (search returns 7 characters, forecasts want 6). Set per deployment, not committed.
var GEOHASH = (process.env.BOM_LOCATION || '').slice(0, 6);
if (!GEOHASH) { console.error('Set BOM_LOCATION to a BOM geohash (find one: https://api.weather.bom.gov.au/v1/locations?search=<suburb>)'); process.exit(1); }

async function bom(path, optional) {
  try {
    var res = await fetch(BOM + path, { headers: { 'user-agent': 'photo-frame-dashboard (home use)' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('BOM ' + path + ' -> HTTP ' + res.status);
    return (await res.json()).data;
  } catch (e) {
    if (optional) return null;
    throw e;
  }
}

var location; // timezone rarely changes; fetch once
async function fetchWeather() {
  if (!location) location = await bom('/locations/' + GEOHASH);
  var base = '/locations/' + GEOHASH;
  var parts = await Promise.all([bom(base + '/forecasts/hourly'), bom(base + '/forecasts/daily', true), bom(base + '/observations', true)]);
  return buildWeather({ hourly: parts[0], daily: parts[1], observations: parts[2], timezone: location.timezone, now: new Date() });
}

var cache = { at: 0, data: null, inflight: null };
async function weather() {
  if (cache.data && Date.now() - cache.at < TTL) return { data: cache.data, stale: false, at: cache.at };
  try {
    cache.inflight = cache.inflight || fetchWeather();
    cache.data = await cache.inflight;
    cache.at = Date.now();
    return { data: cache.data, stale: false, at: cache.at };
  } catch (e) {
    console.error('weather refresh failed:', e.message);
    if (cache.data) return { data: cache.data, stale: true, at: cache.at };
    throw e;
  } finally {
    cache.inflight = null;
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

createServer(async function (req, res) {
  var path = new URL(req.url, 'http://x').pathname;
  if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
  if (path === '/api/health') return send(res, 200, { ok: true });
  if (path === '/api/weather') {
    try {
      var w = await weather();
      return send(res, 200, { weather: w.data, stale: w.stale, updated: new Date(w.at).toISOString() });
    } catch (e) {
      return send(res, 502, { error: 'weather unavailable' });
    }
  }
  send(res, 404, { error: 'not found' });
}).listen(PORT, function () { console.log('frame-server listening on ' + PORT + ', BOM ' + GEOHASH); });
