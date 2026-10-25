// /api/diag: the frame's heartbeats and freeze reports (from js/monitor.js), written to InfluxDB for Grafana.
// Kept apart from index.js so it can be tested without starting the server.
import { line } from './influx.js';
import { BadRequest } from './ha-map.js';

// Body key -> InfluxDB field for the numeric parts of a heartbeat.
var BEAT_NUM = { gap: 'gap_ms', ltN: 'longtask_n', ltMax: 'longtask_max_ms', ltSum: 'longtask_sum_ms', heap: 'heap_mb', dom: 'dom_nodes', w: 'inner_w', h: 'inner_h', up: 'uptime_s' };
var BEAT_BOOL = { focus: 'input_focus', sheet: 'sheet_open', vis: 'visible' };

function name(v) { return typeof v === 'string' && /^[a-z0-9_-]{1,24}$/i.test(v) ? v : 'other'; }
function num(v) { return typeof v === 'number' && isFinite(v) && v >= 0 && v < 1e9 ? v : undefined; }

export function diagLines(body, now) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequest('invalid body');
  var tags = { view: name(body.view), mode: name(body.mode) };
  if (body.kind === 'beat') {
    var f = {};
    Object.keys(BEAT_NUM).forEach(function (k) { f[BEAT_NUM[k]] = num(body[k]); });
    Object.keys(BEAT_BOOL).forEach(function (k) { if (typeof body[k] === 'boolean') f[BEAT_BOOL[k]] = body[k]; });
    var l = line('page', tags, f, now);
    if (!l) throw new BadRequest('beat has no fields');
    return [l];
  }
  if (body.kind === 'freeze') {
    var ms = num(body.ms);
    if (ms === undefined) throw new BadRequest('freeze needs ms');
    var crumbs = Array.isArray(body.crumbs) ? body.crumbs.filter(function (c) { return typeof c === 'string'; }).slice(-40) : [];
    tags.source = 'page';
    // The freeze ended just before the report was sent, so it started ms earlier.
    return [line('freeze', tags, { ms: ms, crumbs: crumbs.map(function (c) { return c.slice(0, 100); }).join(' | ') }, now - ms)];
  }
  throw new BadRequest('kind must be beat or freeze');
}

export function diagRoute({ influx, readJSON, send }) {
  var failing = false;
  return async function (req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    if (!influx) return send(res, 503, { error: 'influx not configured' });
    try {
      var lines = diagLines(await readJSON(req, 8192), Date.now());
      await influx(lines);
      if (failing) { failing = false; console.log('influx writes recovered'); }
      return send(res, 200, { ok: true });
    } catch (e) {
      if (e instanceof BadRequest) return send(res, 400, { error: e.message });
      if (!failing) { failing = true; console.error('diag write failed:', e.message); } // once per outage, not every beat
      return send(res, 502, { error: 'influx unavailable' });
    }
  };
}
