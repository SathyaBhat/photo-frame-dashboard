// Minimal InfluxDB 3 line-protocol writer. Optional: without a URL, token and database createInflux returns null.
// The token is a credential: never log it or put it in an error.

function escKey(s) { return String(s).replace(/[,= \\]/g, '\\$&').replace(/\n/g, ' '); }
function escStr(s) { return '"' + String(s).replace(/["\\]/g, '\\$&').replace(/\n/g, ' ') + '"'; }

// One line of line protocol. Numbers are always written as floats so a field never changes type.
// Empty tags and missing or non-finite fields are left out; a line with no fields is ''.
export function line(measurement, tags, fields, ms) {
  var t = Object.keys(tags || {}).sort().filter(function (k) { return tags[k] !== undefined && tags[k] !== null && tags[k] !== ''; })
    .map(function (k) { return ',' + escKey(k) + '=' + escKey(tags[k]); }).join('');
  var f = Object.keys(fields).filter(function (k) {
    var v = fields[k];
    return typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number' && isFinite(v);
  }).map(function (k) {
    var v = fields[k];
    return escKey(k) + '=' + (typeof v === 'string' ? escStr(v) : String(v));
  }).join(',');
  return f ? escKey(measurement) + t + ' ' + f + ' ' + Math.round(ms) : '';
}

export function createInflux({ url, token, db, fetchImpl }) {
  if (!url || !token || !db) return null;
  var doFetch = fetchImpl || fetch;
  var endpoint = url.replace(/\/+$/, '') + '/api/v3/write_lp?db=' + encodeURIComponent(db) + '&precision=millisecond';
  return async function write(lines) {
    var body = lines.filter(Boolean).join('\n');
    if (!body) return;
    var res = await doFetch(endpoint, {
      method: 'POST', body: body,
      headers: { authorization: 'Bearer ' + token, 'content-type': 'text/plain; charset=utf-8' },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) throw new Error('influx write -> HTTP ' + res.status);
  };
}
