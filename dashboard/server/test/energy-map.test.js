import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnergy, parseHistory, dayStart, localDay, nextDay, STEP_MS } from '../energy-map.js';

test('dayStart finds local midnight, including across DST', function () {
  assert.equal(new Date(dayStart('2026-10-14', 'Australia/Sydney')).toISOString(), '2026-10-13T13:00:00.000Z'); // AEDT, UTC+11
  assert.equal(new Date(dayStart('2026-06-01', 'Australia/Sydney')).toISOString(), '2026-05-31T14:00:00.000Z'); // AEST, UTC+10
  assert.equal(new Date(dayStart('2026-10-04', 'Australia/Sydney')).toISOString(), '2026-10-03T14:00:00.000Z'); // DST starts that day
  assert.equal(dayStart('nope', 'Australia/Sydney'), null);
});

test('localDay and nextDay', function () {
  assert.equal(localDay(Date.parse('2026-10-14T20:00:00Z'), 'Australia/Sydney'), '2026-10-15');
  assert.equal(nextDay('2026-10-31'), '2026-11-01');
  assert.equal(nextDay('2026-12-31'), '2027-01-01');
});

test('buildEnergy holds the last reading per 5-minute bucket and totals kWh', function () {
  var s = 0, h = { solar: [[s - 1000, 2], [s + 7 * 60000, 4]], home: [[s, 1]] };
  var e = buildEnergy({ start: s, end: s + 4 * STEP_MS, history: h });
  assert.equal(e.n, 4);
  assert.deepEqual(e.series.solar, [2, 2, 4, 4]);
  assert.deepEqual(e.series.home, [1, 1, 1, 1]);
  assert.deepEqual(e.series.charge, [0, 0, 0, 0]);
  assert.equal(e.totals.home, 0.3); // 1 kW for 20 min
  assert.equal(e.empty, false);
});

test('buildEnergy ignores bad readings and negatives, and flags no data', function () {
  var h = { solar: [[0, 3], [STEP_MS, NaN], [2 * STEP_MS, -0.004]] };
  assert.deepEqual(buildEnergy({ start: 0, end: 3 * STEP_MS, history: h }).series.solar, [3, 3, 0]);
  var none = buildEnergy({ start: 0, end: 2 * STEP_MS, history: {} });
  assert.equal(none.empty, true);
  assert.equal(buildEnergy({ start: 5, end: 5, history: {} }).n, 0);
});

test('parseHistory maps entity ids back to series', function () {
  var reply = [[{ entity_id: 'sensor.inv_meter_2_power', state: '1.5', last_changed: '2026-10-15T00:00:00+00:00' }, { state: '2', last_changed: '2026-10-15T00:10:00+00:00' }], []];
  var h = parseHistory(reply, 'sensor.inv');
  assert.deepEqual(h.solar, [[Date.parse('2026-10-15T00:00:00Z'), 1.5], [Date.parse('2026-10-15T00:10:00Z'), 2]]);
  assert.deepEqual(h.home, []);
});
