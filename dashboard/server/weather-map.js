// Maps Bureau of Meteorology API responses to the dashboard's DATA.weather shape:
// t/c/p are 24 slots indexed by local hour of day, each holding the next occurrence of that hour.

var CLEAR = { sunny: 1, clear: 1 };
var PARTLY = { mostly_sunny: 1, partly_cloudy: 1 };
var RAIN = { light_shower: 1, shower: 1, heavy_shower: 1, rain: 1, light_rain: 1, storm: 1, tropical_cyclone: 1 };

export function iconFor(descriptor, isNight) {
  if (RAIN[descriptor]) return 'rain';
  if (CLEAR[descriptor]) return isNight ? 'moon' : 'sun';
  if (PARTLY[descriptor]) return isNight ? 'moon' : 'partly';
  return 'cloud';
}

function localParts(date, timeZone) {
  var p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).forEach(function (x) { p[x.type] = x.value; });
  return { day: p.year + '-' + p.month + '-' + p.day, hour: +p.hour };
}

function num(v) { return typeof v === 'number' ? Math.round(v) : null; }

export function buildWeather(input) {
  var tz = input.timezone, now = input.now, obs = input.observations;
  var t = new Array(24), c = new Array(24), p = new Array(24), filled = 0, first = true;
  var nowHour = localParts(now, tz).hour;

  (input.hourly || []).forEach(function (e) {
    var at = new Date(e.time);
    if (+at + 36e5 <= +now) return; // this hour is over
    var h = localParts(at, tz).hour;
    if (t[h] !== undefined) return;
    t[h] = num(e.temp);
    c[h] = iconFor(e.icon_descriptor, !!e.is_night);
    p[h] = e.rain && typeof e.rain.chance === 'number' ? e.rain.chance : 0;
    filled++;
  });
  if (filled < 24) throw new Error('BOM hourly forecast covers only ' + filled + ' of 24 hours');

  if (obs && typeof obs.temp === 'number') t[nowHour] = Math.round(obs.temp);

  var today = localParts(now, tz).day;
  var day = (input.daily || []).filter(function (d) { return localParts(new Date(d.date), tz).day === today; })[0] || {};
  var hi = num(day.temp_max), lo = num(day.temp_min);
  if (hi === null && obs && obs.max_temp) hi = num(obs.max_temp.value);
  if (lo === null && obs && obs.min_temp) lo = num(obs.min_temp.value);
  if (hi === null) hi = Math.max.apply(null, t);
  if (lo === null) lo = Math.min.apply(null, t);

  return {
    hi: hi, lo: lo,
    feels: obs && num(obs.temp_feels_like) !== null ? num(obs.temp_feels_like) : t[nowHour],
    humidity: obs && typeof obs.humidity === 'number' ? obs.humidity : null,
    wind: obs && obs.wind ? obs.wind.speed_kilometre : null,
    text: day.short_text || null,
    t: t, c: c, p: p
  };
}
