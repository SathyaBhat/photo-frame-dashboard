// Tiny LAN API for the photo frame. Credentials and upstream fetching live here, never in the browser.
import { createServer } from 'node:http';
import { buildWeather } from './weather-map.js';
import { buildEnergy, parseHistory, dayStart, localDay, nextDay } from './energy-map.js';
import { buildHome, buildBattery, buildCommand, BadRequest } from './ha-map.js';
import { createCalendar, fetchFeed } from './calendar-service.js';
import { createTrello } from './trello-service.js';
import { groceriesRoute } from './groceries-route.js';

var BOM = 'https://api.weather.bom.gov.au/v1';
var TTL = 15 * 60 * 1000;
var PORT = +process.env.PORT || 8080;
// A BOM geohash (search returns 7 characters, forecasts want 6). Set per deployment, not committed.
var GEOHASH = (process.env.BOM_LOCATION || '').slice(0, 6);
// Home Assistant is optional: without HA_URL and HA_TOKEN the /api/home routes answer 503 and the frame keeps its mock home.
var HA_URL = (process.env.HA_URL || '').replace(/\/+$/, '');
var HA_TOKEN = process.env.HA_TOKEN || '';
var HA_HIDE = (process.env.HA_HIDE || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
// Optional solar/battery sensors: HA_BATTERY_PREFIX is the shared entity prefix of the inverter's sensors.
var HA_BATTERY_PREFIX = process.env.HA_BATTERY_PREFIX || '';
var HA_BATTERY_KWH = +process.env.HA_BATTERY_KWH || 10;
var HA_BATTERY_RESERVE = process.env.HA_BATTERY_RESERVE === undefined ? 10 : +process.env.HA_BATTERY_RESERVE;
var HOME_TTL = 5000;
// The shared Google Calendar's secret iCal address. Optional: without it /api/calendar answers 503 and the frame keeps its mock events.
// The address is a credential: never log it or put it in an error.
var GCAL_ICS_URL = process.env.GCAL_ICS_URL || '';
// Trello board for the grocery list. Optional: without all three, /api/groceries answers 503 and the frame keeps its mock list.
// The key and token are credentials: never log them or put them in an error.
var TRELLO_KEY = process.env.TRELLO_API_KEY || '';
var TRELLO_TOKEN = process.env.TRELLO_TOKEN || '';
var TRELLO_BOARD = process.env.TRELLO_BOARD || '';
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

var calendar = GCAL_ICS_URL ? createCalendar({ url: GCAL_ICS_URL, fetchText: fetchFeed }) : null;
var trello = TRELLO_KEY && TRELLO_TOKEN && TRELLO_BOARD ? createTrello({ key: TRELLO_KEY, token: TRELLO_TOKEN, board: TRELLO_BOARD }) : null;

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

// Entity -> area, via a template because the REST API has no area registry.
var AREA_TEMPLATE = "{% set ns = namespace(o={}) %}{% for s in states if s.domain in ['light','switch','media_player'] %}" +
  "{% set a = area_id(s.entity_id) %}{% if a %}{% set ns.o = dict(ns.o, **{s.entity_id: {'id': a, 'name': area_name(a)}}) %}{% endif %}{% endfor %}{{ ns.o | tojson }}";

async function ha(path, body) {
  var res = await fetch(HA_URL + '/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + HA_TOKEN, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error('HA ' + path + ' -> HTTP ' + res.status);
  return res;
}

async function fetchHome() {
  var parts = await Promise.all([ha('states').then(function (r) { return r.json(); }), ha('template', { template: AREA_TEMPLATE }).then(function (r) { return r.json(); })]);
  var home = buildHome({ states: parts[0], areas: parts[1], hide: HA_HIDE });
  home.battery = buildBattery(parts[0], HA_BATTERY_PREFIX, HA_BATTERY_KWH, HA_BATTERY_RESERVE);
  return home;
}

var homeCache = { at: 0, data: null, inflight: null };
async function home(fresh) {
  if (!fresh && homeCache.data && Date.now() - homeCache.at < HOME_TTL) return { data: homeCache.data, stale: false, at: homeCache.at };
  try {
    homeCache.inflight = homeCache.inflight || fetchHome();
    homeCache.data = await homeCache.inflight;
    homeCache.at = Date.now();
    return { data: homeCache.data, stale: false, at: homeCache.at };
  } catch (e) {
    console.error('home refresh failed:', e.message);
    if (homeCache.data) return { data: homeCache.data, stale: true, at: homeCache.at };
    throw e;
  } finally {
    homeCache.inflight = null;
  }
}

// Energy history for the solar/battery page: a rolling 24 hours, or one local calendar day (?day=YYYY-MM-DD).
var haZone;
var energyCache = {};
async function energy(day) {
  if (!HA_BATTERY_PREFIX) throw new BadRequest('no battery configured');
  if (!haZone) haZone = (await (await ha('config')).json()).time_zone;
  var now = Date.now(), today = localDay(now, haZone), start, end;
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new BadRequest('day must be YYYY-MM-DD');
  if (day && day < today) {
    start = dayStart(day, haZone);
    end = dayStart(nextDay(day), haZone);
  } else { // no day, today, or the future: the last 24 hours
    day = null;
    end = Math.floor(now / 300000) * 300000; start = end - 864e5;
  }
  var key = day || 'now', hit = energyCache[key];
  if (hit && now - hit.at < (day ? 10 * 60000 : 60000)) return hit.data;
  var ids = ['meter_2_power', 'loads_power', 'bat_discharge_power', 'bat_charge_power', 'grid_consumption_power', 'feedin_power']
    .map(function (k) { return HA_BATTERY_PREFIX + '_' + k; }).join(',');
  var res = await ha('history/period/' + new Date(start).toISOString() + '?end_time=' + new Date(end).toISOString() + '&filter_entity_id=' + ids + '&minimal_response&no_attributes');
  var data = buildEnergy({ start: start, end: end, history: parseHistory(await res.json(), HA_BATTERY_PREFIX) });
  data.zone = haZone; data.today = today; data.day = day;
  if (Object.keys(energyCache).length > 20) energyCache = {};
  energyCache[key] = { at: now, data: data };
  return data;
}

function readJSON(req) {
  return new Promise(function (resolve, reject) {
    var buf = '';
    req.on('data', function (c) { buf += c; if (buf.length > 4096) { reject(new BadRequest('body too large')); req.destroy(); } });
    req.on('end', function () { try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(new BadRequest('invalid JSON')); } });
    req.on('error', reject);
  });
}

function expect(data, kind, id, cmd, body) {
  var out = JSON.parse(JSON.stringify(data));
  if (kind === 'device') out.devices.forEach(function (d) {
    if (d.id !== id) return;
    d.on = cmd.service === 'turn_on';
    if (d.type === 'light' && body.level) d.level = body.level;
  });
  if (kind === 'media' && out.media && out.media.id === id) out.media.playing = body.playing;
  return out;
}

async function homeRoute(req, res, path) {
  if (!HA_URL || !HA_TOKEN) return send(res, 503, { error: 'home assistant not configured' });
  try {
    if (req.method === 'GET' && path === '/api/home') {
      var h = await home(false);
      return send(res, 200, { home: h.data, stale: h.stale, updated: new Date(h.at).toISOString() });
    }
    var m = /^\/api\/(device|scene|media)\/([a-z_]+\.[a-z0-9_]+)$/.exec(path);
    if (req.method === 'POST' && m) {
      var body = await readJSON(req);
      var cmd = buildCommand(m[1], m[2], body, (await home(false)).data);
      if (cmd.service) await ha('services/' + cmd.domain + '/' + cmd.service, cmd.data);
      await new Promise(function (r) { setTimeout(r, 300); }); // let HA settle before re-reading
      var after = await home(true);
      // Many integrations report the new state a moment late: show what was asked for; the next poll reconciles.
      after.data = expect(after.data, m[1], m[2], cmd, body);
      return send(res, 200, { home: after.data, stale: after.stale, updated: new Date(after.at).toISOString() });
    }
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    if (e instanceof BadRequest) return send(res, 400, { error: e.message });
    console.error('home request failed:', e.message);
    return send(res, 502, { error: 'home assistant unavailable' });
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

var groceries = groceriesRoute({ trello: trello, readJSON: readJSON, send: send });

createServer(async function (req, res) {
  var path = new URL(req.url, 'http://x').pathname;
  if (path === '/api/energy' && req.method === 'GET') {
    if (!HA_URL || !HA_TOKEN) return send(res, 503, { error: 'home assistant not configured' });
    try {
      return send(res, 200, { energy: await energy(new URL(req.url, 'http://x').searchParams.get('day')) });
    } catch (e) {
      if (e instanceof BadRequest) return send(res, 400, { error: e.message });
      console.error('energy request failed:', e.message);
      return send(res, 502, { error: 'home assistant unavailable' });
    }
  }
  if (path === '/api/home' || /^\/api\/(device|scene|media)\//.test(path)) return homeRoute(req, res, path);
  if (path === '/api/groceries' || path.indexOf('/api/groceries/') === 0) return groceries(req, res, path);
  if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
  if (path === '/api/health') return send(res, 200, { ok: true });
  if (path === '/api/calendar') {
    if (!calendar) return send(res, 503, { error: 'calendar not configured' });
    try {
      var c = await calendar();
      return send(res, 200, { events: c.data, stale: c.stale, updated: new Date(c.at).toISOString() });
    } catch (e) {
      return send(res, 502, { error: 'calendar unavailable' });
    }
  }
  if (path === '/api/weather') {
    try {
      var w = await weather();
      return send(res, 200, { weather: w.data, stale: w.stale, updated: new Date(w.at).toISOString() });
    } catch (e) {
      return send(res, 502, { error: 'weather unavailable' });
    }
  }
  send(res, 404, { error: 'not found' });
}).listen(PORT, function () { console.log('frame-server listening on ' + PORT + ', BOM ' + GEOHASH + ', HA ' + (HA_URL && HA_TOKEN ? 'on' : 'off') + ', calendar ' + (GCAL_ICS_URL ? 'on' : 'off') + ', trello ' + (trello ? 'on' : 'off')); });
