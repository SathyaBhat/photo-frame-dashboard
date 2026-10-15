// Turns Home Assistant sensor history into fixed-step power series (kW) and kWh totals for the energy page.
// Pure functions only; index.js does the HTTP.

export var STEP_MS = 5 * 60 * 1000;

// History sensors, by series name. Suffixes are appended to HA_BATTERY_PREFIX. All are kW, positive.
// The solar meter is the AC-coupled "meter 2" (the inverter's pv_* sensors stay at 0).
export var SERIES = {
  solar: 'meter_2_power',
  home: 'loads_power',
  discharge: 'bat_discharge_power',
  charge: 'bat_charge_power',
  import: 'grid_consumption_power',
  export: 'feedin_power'
};

// Offset (ms) of a time zone from UTC at an instant.
function offsetMs(ms, tz) {
  var p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = +x.value; });
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

// Local midnight (as UTC ms) at the start of a YYYY-MM-DD day in a time zone.
export function dayStart(day, tz) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  var guess = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  var ms = guess - offsetMs(guess, tz);
  return guess - offsetMs(ms, tz); // second pass settles the offset across a DST change
}

export function localDay(ms, tz) {
  var p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
  return p.year + '-' + p.month + '-' + p.day;
}

// The day after a YYYY-MM-DD string.
export function nextDay(day) {
  var d = new Date(Date.parse(day + 'T00:00:00Z') + 864e5);
  return d.toISOString().slice(0, 10);
}

// history: { seriesName: [[timeMs, value], ...] } in time order, the first entry being the state at (or before) start.
// Sample-and-hold: each bucket takes the last reading at or before its start. Buckets past `end` are dropped.
export function buildEnergy(input) {
  var start = input.start, end = input.end, n = Math.max(0, Math.ceil((end - start) / STEP_MS));
  var out = { start: start, step: STEP_MS, n: n, series: {}, totals: {}, empty: true };
  Object.keys(SERIES).forEach(function (k) {
    var pts = (input.history && input.history[k]) || [], arr = new Array(n), j = 0, last = 0;
    if (pts.length) out.empty = false;
    for (var i = 0; i < n; i++) {
      var t = start + i * STEP_MS;
      while (j < pts.length && pts[j][0] <= t) { last = isFinite(pts[j][1]) ? Math.max(0, pts[j][1]) : last; j++; }
      arr[i] = Math.round(last * 1000) / 1000;
    }
    out.series[k] = arr;
    out.totals[k] = Math.round(arr.reduce(function (a, v) { return a + v; }, 0) * STEP_MS / 36e5 * 10) / 10; // kWh
  });
  return out;
}

// HA history reply (minimal_response, one list per entity) -> { seriesName: [[ms, value], ...] }.
export function parseHistory(reply, prefix) {
  var byId = {};
  (reply || []).forEach(function (list) {
    if (!list.length) return;
    var id = list[0].entity_id;
    byId[id] = list.map(function (x) { return [Date.parse(x.last_changed || x.last_updated), parseFloat(x.state)]; });
  });
  var out = {};
  Object.keys(SERIES).forEach(function (k) { out[k] = byId[prefix + '_' + SERIES[k]] || []; });
  return out;
}
