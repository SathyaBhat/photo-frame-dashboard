import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWeather, iconFor } from '../weather-map.js';

function fx(name) { return JSON.parse(readFileSync(new URL('./fixtures/' + name + '.json', import.meta.url))).data; }

var input = function () {
  return {
    hourly: fx('hourly'), daily: fx('daily'), observations: fx('observations'),
    timezone: 'Australia/Sydney',
    now: new Date('2026-10-14T09:31:00Z') // 8:31 PM in Sydney (AEDT)
  };
};

test('iconFor maps BOM descriptors to the dashboard icon set', function () {
  assert.equal(iconFor('sunny', false), 'sun');
  assert.equal(iconFor('sunny', true), 'moon');
  assert.equal(iconFor('clear', true), 'moon');
  assert.equal(iconFor('mostly_sunny', false), 'partly');
  assert.equal(iconFor('mostly_sunny', true), 'moon');
  assert.equal(iconFor('partly_cloudy', false), 'partly');
  assert.equal(iconFor('cloudy', false), 'cloud');
  assert.equal(iconFor('fog', true), 'cloud');
  assert.equal(iconFor('shower', false), 'rain');
  assert.equal(iconFor('light_shower', true), 'rain');
  assert.equal(iconFor('storm', false), 'rain');
  assert.equal(iconFor('something_new', false), 'cloud');
});

test('buildWeather returns the DATA.weather shape: 24 hour-of-day slots', function () {
  var w = buildWeather(input());
  ['t', 'c', 'p'].forEach(function (k) {
    assert.equal(w[k].length, 24, k);
    w[k].forEach(function (v, i) { assert.notEqual(v, undefined, k + '[' + i + ']'); assert.notEqual(v, null, k + '[' + i + ']'); });
  });
  w.t.forEach(function (v) { assert.ok(Number.isInteger(v)); });
  w.p.forEach(function (v) { assert.ok(v >= 0 && v <= 100); });
  var icons = ['sun', 'moon', 'partly', 'cloud', 'rain'];
  w.c.forEach(function (v) { assert.ok(icons.indexOf(v) > -1, v); });
});

test('slot for the current local hour uses the live observation', function () {
  var w = buildWeather(input());
  assert.equal(w.t[20], Math.round(fx('observations').temp)); // 12.5 -> 13
});

test('other slots are the next occurrence of that hour of day', function () {
  var inp = input(), w = buildWeather(inp);
  // 9 PM local is the next hourly entry after 8 PM
  var entry = inp.hourly.filter(function (h) { return h.time === '2026-10-14T10:00:00Z'; })[0];
  assert.equal(w.t[21], Math.round(entry.temp));
  // 7 AM local has already passed today, so it is tomorrow's 7 AM (2026-10-14T20:00:00Z)
  var tomorrow = inp.hourly.filter(function (h) { return h.time === '2026-10-14T20:00:00Z'; })[0];
  assert.equal(w.t[7], Math.round(tomorrow.temp));
  assert.equal(w.p[7], tomorrow.rain.chance);
});

test('summary fields come from the observation and daily forecast', function () {
  var w = buildWeather(input()), o = fx('observations');
  assert.equal(w.feels, Math.round(o.temp_feels_like));
  assert.equal(w.humidity, o.humidity);
  assert.equal(w.wind, o.wind.speed_kilometre);
  assert.equal(w.hi, 19);  // today's daily temp_max
  assert.equal(w.lo, 12);  // daily temp_min for today is null, so the observed minimum 12.4 is used
});

test('hi/lo fall back to hourly extremes without observations or daily min', function () {
  var inp = input(); inp.observations = null; inp.daily = [];
  var w = buildWeather(inp);
  assert.equal(w.hi, Math.max.apply(null, w.t));
  assert.equal(w.lo, Math.min.apply(null, w.t));
  assert.equal(w.feels, w.t[20]);
});

test('fewer than 24 hours of forecast is an error, not a half-filled array', function () {
  var inp = input(); inp.hourly = inp.hourly.slice(0, 5);
  assert.throws(function () { buildWeather(inp); }, /hourly/);
});

test("text is BOM's short forecast for today, or null when there is no daily entry", function () {
  assert.equal(buildWeather(input()).text, 'Mostly clear.');
  var inp = input(); inp.daily = null;
  assert.equal(buildWeather(inp).text, null);
});

test('days lists each forecast day by local date, skipping entries without a forecast', function () {
  var w = buildWeather(input()), daily = fx('daily');
  var usable = daily.filter(function (d) { return d.icon_descriptor; });
  assert.equal(w.days.length, usable.length);
  assert.equal(w.days[0].day, '2026-10-14'); // 13:00Z the day before is already the 14th in Sydney
  assert.equal(w.days[0].hi, 19);
  assert.equal(w.days[0].lo, null);          // BOM leaves today's minimum null in the evening
  assert.equal(w.days[0].c, iconFor(usable[0].icon_descriptor, false));
  assert.equal(w.days[0].p, usable[0].rain.chance);
});

test('days is empty without a daily forecast', function () {
  var inp = input(); inp.daily = null;
  assert.deepEqual(buildWeather(inp).days, []);
});
