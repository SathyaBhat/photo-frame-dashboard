import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCalendar, DAYS } from '../calendar-map.js';

var ics = readFileSync(new URL('./fixtures/calendar.ics', import.meta.url), 'utf8');
var NOW = new Date('2026-10-17T00:00:00Z');
function summary(list) { return list.map(function (e) { return e.title + ' | ' + e.start + ' | ' + e.end + ' | ' + e.allDay + ' | ' + e.location; }); }

test('lists the next week: recurring, moved, all-day, multi-day, untitled, escaped text', function () {
  assert.equal(DAYS, 7);
  assert.deepEqual(summary(buildCalendar({ ics: ics, now: NOW })), [
    "Kids' <b>party</b> & cake | 2026-10-17T02:00:00.000Z | 2026-10-17T03:00:00.000Z | false | 12 Main St, Acacia Gardens",
    'Pizza, then movies | 2026-10-17T04:00:00.000Z | 2026-10-17T05:00:00.000Z | false | ',
    '(No title) | 2026-10-17T06:00:00.000Z | 2026-10-17T07:00:00.000Z | false | ',
    'Late movie | 2026-10-17T12:30:00.000Z | 2026-10-17T14:30:00.000Z | false | ',
    'Bins | 2026-10-18 | 2026-10-19 | true | ',
    'Garbage night | 2026-10-18 | 2026-10-19 | true | ',
    'Soccer practice (moved) | 2026-10-19T06:00:00.000Z | 2026-10-19T07:30:00.000Z | false | ',
    'Cottage weekend | 2026-10-20 | 2026-10-23 | true | ',
    'Bins | 2026-10-21 | 2026-10-22 | true | ',
    'Soccer practice | 2026-10-22T05:30:00.000Z | 2026-10-22T07:00:00.000Z | false | Lakeshore Fields'
  ]);
});

test('drops cancelled events and the excluded Thursday', function () {
  var titles = buildCalendar({ ics: ics, now: new Date('2026-10-14T00:00:00Z') }).map(function (e) { return e.title + e.start; });
  assert.ok(!titles.some(function (t) { return /Cancelled/.test(t); }));
  assert.ok(!titles.includes('Soccer practice2026-10-15T05:30:00.000Z'));
});

test('keeps an event that is already in progress, drops ones that ended', function () {
  var list = buildCalendar({ ics: ics, now: new Date('2026-10-17T13:00:00Z') });
  assert.equal(list[0].title, 'Late movie');
  assert.ok(!list.some(function (e) { return e.title === '(No title)'; }));
});

test('ids are unique per instance', function () {
  var ids = buildCalendar({ ics: ics, now: NOW }).map(function (e) { return e.id; });
  assert.equal(new Set(ids).size, ids.length);
});

test('days narrows the window', function () {
  var list = buildCalendar({ ics: ics, now: NOW, days: 1 });
  assert.ok(list.every(function (e) { return e.start < '2026-10-18T00:00:00Z' || e.start === '2026-10-18'; }));
  assert.ok(!list.some(function (e) { return e.title === 'Cottage weekend'; }));
});

test('refuses anything that is not an iCal feed', function () {
  assert.throws(function () { buildCalendar({ ics: '<html>Not found</html>', now: NOW }); }, /not an iCal feed/);
  assert.throws(function () { buildCalendar({ ics: '', now: NOW }); }, /not an iCal feed/);
});

test('drops a single cancelled instance of a recurring event', function () {
  var cancelled = readFileSync(new URL('./fixtures/cancelled-instance.ics', import.meta.url), 'utf8');
  var starts = buildCalendar({ ics: cancelled, now: new Date('2026-10-16T00:00:00Z') }).map(function (e) { return e.start; });
  assert.deepEqual(starts, ['2026-10-17T06:00:00.000Z', '2026-10-19T06:00:00.000Z', '2026-10-20T06:00:00.000Z']);
});
