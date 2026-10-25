// Parsers for the frame's /proc and /sys output (scripts/frame-monitor/frame-monitor.mjs).

// The shell probe prints "@name args" headers; group the lines under each one.
export function sections(text) {
  var out = [], cur = null;
  text.split('\n').forEach(function (l) {
    l = l.replace(/\r$/, '');
    if (l[0] === '@') { var p = l.slice(1).split(' '); cur = { name: p[0], args: p.slice(1), lines: [] }; out.push(cur); }
    else if (cur && l) cur.lines.push(l);
  });
  return out;
}

export function meminfo(lines) {
  var kb = {};
  lines.forEach(function (l) { var m = /^(\w+):\s+(\d+)/.exec(l); if (m) kb[m[1]] = +m[2]; });
  return kb;
}

// First line of /proc/stat -> { busy, total } in clock ticks, summed over all cores.
export function cpuTotal(line) {
  var v = line.trim().split(/\s+/).slice(1).map(Number);
  var idle = v[3] + (v[4] || 0);
  var total = v.reduce(function (a, b) { return a + b; }, 0);
  return { busy: total - idle, total: total };
}

// /proc/<pid>/task/<tid>/stat lines -> [{ tid, comm, ticks }]. comm may hold spaces, so split after the last ')'.
export function threads(lines) {
  return lines.map(function (l) {
    var a = l.indexOf('('), b = l.lastIndexOf(')');
    if (a < 0 || b < a) return null;
    var rest = l.slice(b + 2).split(' ');
    return { tid: +l.slice(0, a), comm: l.slice(a + 1, b), ticks: +rest[11] + +rest[12] };
  }).filter(function (t) { return t && isFinite(t.ticks); });
}

// Thread names with numbers folded ("Binder:812_3" -> "Binder:#_#") so the series count stays small.
export function threadName(t, pid) { return t.tid === pid ? 'main' : t.comm.replace(/\d+/g, '#'); }

// CPU % of one core per key between two { key: ticks } snapshots taken secs apart (100 ticks a second).
export function cpuPct(prev, cur, secs, hz) {
  var out = {};
  Object.keys(cur).forEach(function (k) {
    if (prev[k] === undefined || cur[k] < prev[k]) return;
    out[k] = Math.round((cur[k] - prev[k]) / ((hz || 100) * secs) * 1000) / 10;
  });
  return out;
}

export function procLabel(name, ime) {
  if (name === 'com.wesbos.homehq') return 'kiosk';
  if (/sandboxed_process/.test(name)) return 'renderer';
  if (ime && name === ime) return 'ime';
  return name;
}
