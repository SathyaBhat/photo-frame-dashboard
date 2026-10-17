# Family agenda Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-person schedule lanes on the Today view with one Family agenda fed by the family's shared Google Calendar.

**Architecture:** The server fetches the calendar's secret iCal feed, expands recurring events with `node-ical`, and serves the next 7 days at `GET /api/calendar` (5-minute cache, stale fallback). The dashboard polls it like weather and Home Assistant, turns the result into `Date`-based events for every person (so existing views treat them as "Family"), and the home panel shows the next day that has events.

**Tech Stack:** Node 22 (ESM, `node --test`), `node-ical` 0.27, plain ES5-style browser JS, Vite 8, Dokploy/Traefik.

**Spec:** `docs/superpowers/specs/2026-10-17-family-agenda-design.md`

## Global Constraints

- `GCAL_ICS_URL` is a credential: only in the Dokploy app environment. Never commit it, never log it, never send it to the browser, and never put it in an error message.
- Without `GCAL_ICS_URL` the route answers 503 and the frame keeps its mock events.
- `dashboard/vite.config.js` targets stay `chrome106` (JS) and `chrome61` (CSS). No 4- or 8-digit hex colours in CSS.
- Dashboard code style: ES5-ish `var`/`function` inside IIFEs, HTML built as strings, every piece of user data through `App.esc()`.
- Frame: 1280×800 touch, about 1 GB RAM. Rows at least 52 px tall. No animation, no new browser libraries.
- Server code style: ESM, `var`, small pure functions (see `weather-map.js`), tests in `dashboard/server/test/*.test.js`.
- No IPs, serials, MACs, Wi-Fi details or hostnames in committed files.
- The owner's standing rule: push `origin main` right after every commit (this deploys). Every commit below must leave the deployed app working. Do not touch `docs/akimart-zn-dp1002.md`, `dashboard/kiosk`, or anything on the frame.

## Review Focus

- A 200 response that is not an iCal feed (an HTML page): must fail loudly (502 / stale copy), not show "Nothing coming up". Tested in Task 1.
- A feed with an untitled event, escaped commas, and `<b>`/`&` in the title or location: no crash; text passes through verbatim and the dashboard escapes it. Tested in Tasks 1 and 3.
- All-day events when the server's timezone differs from the frame's: dates must not shift by a day. Task 1 runs the same tests under three `TZ` values.
- An event already in progress (started before now, ends after): still listed. Tested in Task 1 and shown as "Now" in Task 3.
- Google down after a good fetch: serve the last good list with `stale: true`; down on the very first fetch: error, and the frame keeps its mock events. Tested in Task 2.
- Known limit, not tested: the Calendar view (month/week) only has the next 7 days and nothing earlier once real data loads. The spec accepts this; tell the owner.

## File Structure

| File | Responsibility |
|---|---|
| `dashboard/server/calendar-map.js` (new) | Pure `buildCalendar({ ics, now, days })`: iCal text to the event list. |
| `dashboard/server/calendar-service.js` (new) | `createCalendar({ url, fetchText, ttlMs, clock })`: cache, one in-flight fetch, stale fallback. |
| `dashboard/server/test/calendar-map.test.js`, `calendar-service.test.js`, `test/fixtures/calendar.ics` (new) | Tests and fixture. |
| `dashboard/server/index.js` | Wire `GCAL_ICS_URL` and the `/api/calendar` route. |
| `dashboard/server/package.json`, `package-lock.json`, `Dockerfile` | `node-ical` dependency and `npm ci` in the image. |
| `dashboard/docker-compose.yml` | Pass `GCAL_ICS_URL` to `api`. |
| `dashboard/js/views/home.js`, `css/views/home.css` | `agenda()` replaces `lanes()`. |
| `dashboard/js/views/ambient.js`, `dashboard/js/views/calendar.js` | Tolerate events that belong to the whole family; keep locally added events. |
| `dashboard/js/live.js` | Poll `/api/calendar` and replace `D.events`. |

---

### Task 1: Calendar mapper

**Files:**
- Create: `dashboard/server/calendar-map.js`
- Create: `dashboard/server/test/fixtures/calendar.ics`
- Create: `dashboard/server/test/calendar-map.test.js`
- Modify: `dashboard/server/package.json`, `dashboard/server/package-lock.json` (via npm)

**Interfaces:**
- Produces: `buildCalendar({ ics: string, now?: Date, days?: number }) -> Array<{ id: string, title: string, start: string, end: string, allDay: boolean, location: string }>`. Timed events: `start`/`end` are ISO 8601 UTC strings. All-day events: `start`/`end` are `YYYY-MM-DD` calendar dates, `end` exclusive. Sorted by start; at equal start, all-day first, then by title. Throws `Error('not an iCal feed')` if `ics` has no `BEGIN:VCALENDAR`. Also exports `DAYS = 7`.

- [ ] **Step 1: Install the dependency**

```bash
cd dashboard/server && npm install node-ical@^0.27.3
```

Expected: `package.json` gains `"dependencies": { "node-ical": "^0.27.3" }` and a `package-lock.json` appears. Do not commit `node_modules` (already ignored).

- [ ] **Step 2: Write the fixture** `dashboard/server/test/fixtures/calendar.ics`

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VTIMEZONE
TZID:Australia/Sydney
BEGIN:DAYLIGHT
TZOFFSETFROM:+1000
TZOFFSETTO:+1100
TZNAME:AEDT
DTSTART:19701004T020000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+1100
TZOFFSETTO:+1000
TZNAME:AEST
DTSTART:19700405T030000
RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:weekly@test
DTSTART;TZID=Australia/Sydney:20261012T163000
DTEND;TZID=Australia/Sydney:20261012T180000
RRULE:FREQ=WEEKLY;BYDAY=MO,TH
EXDATE;TZID=Australia/Sydney:20261015T163000
SUMMARY:Soccer practice
LOCATION:Lakeshore Fields
END:VEVENT
BEGIN:VEVENT
UID:weekly@test
RECURRENCE-ID;TZID=Australia/Sydney:20261019T163000
DTSTART;TZID=Australia/Sydney:20261019T170000
DTEND;TZID=Australia/Sydney:20261019T183000
SUMMARY:Soccer practice (moved)
END:VEVENT
BEGIN:VEVENT
UID:allday@test
DTSTART;VALUE=DATE:20261018
DTEND;VALUE=DATE:20261019
SUMMARY:Garbage night
END:VEVENT
BEGIN:VEVENT
UID:multi@test
DTSTART;VALUE=DATE:20261020
DTEND;VALUE=DATE:20261023
SUMMARY:Cottage weekend
END:VEVENT
BEGIN:VEVENT
UID:cancel@test
DTSTART:20261017T230000Z
DTEND:20261018T000000Z
STATUS:CANCELLED
SUMMARY:Cancelled thing
END:VEVENT
BEGIN:VEVENT
UID:midnight@test
DTSTART;TZID=Australia/Sydney:20261017T233000
DTEND;TZID=Australia/Sydney:20261018T013000
SUMMARY:Late movie
END:VEVENT
BEGIN:VEVENT
UID:notitle@test
DTSTART:20261017T060000Z
DTEND:20261017T070000Z
END:VEVENT
BEGIN:VEVENT
UID:bins@test
DTSTART;VALUE=DATE:20261014
DTEND;VALUE=DATE:20261015
RRULE:FREQ=WEEKLY;BYDAY=WE,SU
SUMMARY:Bins
END:VEVENT
BEGIN:VEVENT
UID:html@test
DTSTART:20261017T020000Z
DTEND:20261017T030000Z
SUMMARY:Kids' <b>party</b> & cake
LOCATION:12 Main St\, Acacia Gardens
END:VEVENT
BEGIN:VEVENT
UID:comma@test
DTSTART:20261017T040000Z
DTEND:20261017T050000Z
SUMMARY:Pizza\, then movies
END:VEVENT
END:VCALENDAR
```

- [ ] **Step 3: Write the failing tests** `dashboard/server/test/calendar-map.test.js`

```js
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
```

- [ ] **Step 4: Run to see it fail**

Run: `cd dashboard/server && node --test test/calendar-map.test.js`
Expected: FAIL, `Cannot find module '../calendar-map.js'`.

- [ ] **Step 5: Write the implementation** `dashboard/server/calendar-map.js`

```js
// Turns the shared Google Calendar's secret iCal feed into the next few days of events for the frame.
import ical from 'node-ical';

export var DAYS = 7;
var DAY_MS = 864e5;
// All-day values are midnight in the server's zone, which may differ from the frame's. Keep all-day events a
// day and a half past their end so the dashboard, which knows its own zone, decides when they are over.
var SLACK_MS = 36 * 3600e3;

function pad(n) { return (n < 10 ? '0' : '') + n; }
// An all-day value is local midnight in the server's zone: local getters give its calendar date back.
function dateOnly(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
// node-ical gives { params, val } instead of a string when a property has parameters.
function text(v) { return (v && typeof v === 'object' ? v.val : v) || ''; }

export function buildCalendar({ ics, now, days }) {
  if (!/BEGIN:VCALENDAR/.test(ics)) throw new Error('not an iCal feed');
  now = now || new Date();
  var to = new Date(+now + (days || DAYS) * DAY_MS);
  var from = new Date(+now - SLACK_MS);
  var data = ical.sync.parseICS(ics);
  var found = [];
  Object.keys(data).forEach(function (k) {
    var ev = data[k];
    if (ev.type !== 'VEVENT' || ev.status === 'CANCELLED') return;
    var list = ev.rrule ? ical.expandRecurringEvent(ev, { from: from, to: to, expandOngoing: true }) : [ev];
    list.forEach(function (i) {
      if (!i.start || i.status === 'CANCELLED') return;
      var allDay = !!(i.isFullDay || i.start.dateOnly);
      var end = i.end || new Date(+i.start + (allDay ? DAY_MS : 3600e3));
      if (+i.start >= +to || +end <= +now - (allDay ? SLACK_MS : 0)) return;
      var src = i.event || i; // expanded instances point back at their series for uid and location
      var uid = i.uid || src.uid || text(i.summary);
      var start = allDay ? dateOnly(i.start) : i.start.toISOString();
      found.push({
        t: +i.start,
        event: {
          id: uid + '@' + start,
          title: text(i.summary).trim() || '(No title)',
          start: start,
          end: allDay ? dateOnly(end) : end.toISOString(),
          allDay: allDay,
          location: text(i.location || src.location).trim()
        }
      });
    });
  });
  found.sort(function (a, b) { return a.t - b.t || b.event.allDay - a.event.allDay || (a.event.title < b.event.title ? -1 : 1); });
  return found.map(function (f) { return f.event; });
}
```

- [ ] **Step 6: Run to see it pass, under three timezones**

Run:
```bash
cd dashboard/server
for tz in UTC Australia/Sydney America/Los_Angeles; do TZ=$tz node --test test/calendar-map.test.js 2>&1 | grep -E "^# (pass|fail)"; done
```
Expected: `# pass 6` and `# fail 0` for all three.

- [ ] **Step 7: Full server suite, commit, push**

```bash
cd dashboard/server && npm test 2>&1 | grep -E "^# (pass|fail)"
cd ../.. && git add dashboard/server/calendar-map.js dashboard/server/test dashboard/server/package.json dashboard/server/package-lock.json
git commit -m "Server: map the shared iCal feed to the next week of events

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin main
```
Expected: `# fail 0`. The push deploys; nothing imports the new module yet, so the running app is unchanged.

---

### Task 2: Calendar service, route, image and compose

**Files:**
- Create: `dashboard/server/calendar-service.js`
- Create: `dashboard/server/test/calendar-service.test.js`
- Modify: `dashboard/server/index.js` (imports at the top, the env block near line 13, a fetch helper, the route near line 190, the startup log on the last line)
- Modify: `dashboard/server/Dockerfile`
- Modify: `dashboard/docker-compose.yml` (the `api` service `environment`)

**Interfaces:**
- Consumes: `buildCalendar({ ics, now, days })` from Task 1.
- Produces: `createCalendar({ url: string, fetchText: (url) => Promise<string>, ttlMs?: number, clock?: () => number }) -> () => Promise<{ data: Event[], stale: boolean, at: number }>`. Rejects only when there has never been a successful fetch. `GET /api/calendar` answers `200 { events, stale, updated }`, `503 { error: 'calendar not configured' }`, or `502 { error: 'calendar unavailable' }`.

- [ ] **Step 1: Write the failing tests** `dashboard/server/test/calendar-service.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCalendar } from '../calendar-service.js';

var ics = readFileSync(new URL('./fixtures/calendar.ics', import.meta.url), 'utf8');
// A clock inside the fixture's week, so the events are in the window.
function clock(t) { var c = function () { return c.t; }; c.t = t; return c; }
var T0 = Date.parse('2026-10-17T00:00:00Z');

test('fetches once and serves the cache until the ttl passes', async function () {
  var calls = 0, c = clock(T0);
  var get = createCalendar({ url: 'u', ttlMs: 1000, clock: c, fetchText: async function () { calls++; return ics; } });
  var a = await get();
  assert.equal(a.stale, false);
  assert.ok(a.data.length > 5);
  c.t += 500; await get();
  assert.equal(calls, 1);
  c.t += 600; await get();
  assert.equal(calls, 2);
});

test('shares one in-flight fetch between concurrent callers', async function () {
  var calls = 0;
  var get = createCalendar({ url: 'u', clock: clock(T0), fetchText: async function () { calls++; await new Promise(function (r) { setTimeout(r, 20); }); return ics; } });
  await Promise.all([get(), get(), get()]);
  assert.equal(calls, 1);
});

test('serves the last good list as stale when a later fetch fails', async function () {
  var fail = false, c = clock(T0);
  var get = createCalendar({ url: 'u', ttlMs: 1000, clock: c, fetchText: async function () { if (fail) throw new Error('down'); return ics; } });
  var good = await get();
  fail = true; c.t += 2000;
  var later = await get();
  assert.equal(later.stale, true);
  assert.deepEqual(later.data, good.data);
  assert.equal(later.at, good.at);
});

test('a feed that is not iCal counts as a failure', async function () {
  var get = createCalendar({ url: 'u', clock: clock(T0), fetchText: async function () { return '<html>sign in</html>'; } });
  await assert.rejects(get(), /not an iCal feed/);
});

test('rejects when the very first fetch fails, then recovers', async function () {
  var fail = true;
  var get = createCalendar({ url: 'u', clock: clock(T0), fetchText: async function () { if (fail) throw new Error('down'); return ics; } });
  await assert.rejects(get(), /down/);
  fail = false;
  assert.equal((await get()).stale, false);
});

test('the url is passed to fetchText and never appears in a thrown error', async function () {
  var seen;
  var get = createCalendar({ url: 'https://secret.example/abc', clock: clock(T0), fetchText: async function (u) { seen = u; return 'nope'; } });
  await assert.rejects(get(), function (e) { return !/secret\.example/.test(e.message); });
  assert.equal(seen, 'https://secret.example/abc');
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd dashboard/server && node --test test/calendar-service.test.js`
Expected: FAIL, `Cannot find module '../calendar-service.js'`.

- [ ] **Step 3: Write the service** `dashboard/server/calendar-service.js`

```js
// Caches the parsed calendar so the frame's polling never turns into one Google fetch per request.
import { buildCalendar } from './calendar-map.js';

export function createCalendar({ url, fetchText, ttlMs, clock }) {
  var ttl = ttlMs === undefined ? 5 * 60 * 1000 : ttlMs;
  var nowMs = clock || Date.now;
  var cache = { at: 0, data: null, inflight: null };
  return async function get() {
    if (cache.data && nowMs() - cache.at < ttl) return { data: cache.data, stale: false, at: cache.at };
    try {
      cache.inflight = cache.inflight || fetchText(url).then(function (ics) { return buildCalendar({ ics: ics, now: new Date(nowMs()) }); });
      cache.data = await cache.inflight;
      cache.at = nowMs();
      return { data: cache.data, stale: false, at: cache.at };
    } catch (e) {
      console.error('calendar refresh failed:', e.message);
      if (cache.data) return { data: cache.data, stale: true, at: cache.at };
      throw e;
    } finally {
      cache.inflight = null;
    }
  };
}
```

- [ ] **Step 4: Run to see it pass**

Run: `cd dashboard/server && node --test test/calendar-service.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# pass 6`, `# fail 0`.

- [ ] **Step 5: Wire the route** in `dashboard/server/index.js`

Add the import beside the others (line 4–6):

```js
import { createCalendar } from './calendar-service.js';
```

Add after the `HOME_TTL` line (line 21), before the `if (!GEOHASH)` check:

```js
// The shared Google Calendar's secret iCal address. Optional: without it /api/calendar answers 503 and the frame keeps its mock events.
// The address is a credential: never log it or put it in an error.
var GCAL_ICS_URL = process.env.GCAL_ICS_URL || '';
```

Add after the `bom()` function (before `var location;`):

```js
async function fetchIcs(url) {
  var res = await fetch(url, { headers: { 'user-agent': 'photo-frame-dashboard (home use)' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('calendar feed -> HTTP ' + res.status);
  return res.text();
}
var calendar = GCAL_ICS_URL ? createCalendar({ url: GCAL_ICS_URL, fetchText: fetchIcs }) : null;
```

Add in the request handler right after the `/api/health` line:

```js
  if (path === '/api/calendar') {
    if (!calendar) return send(res, 503, { error: 'calendar not configured' });
    try {
      var c = await calendar();
      return send(res, 200, { events: c.data, stale: c.stale, updated: new Date(c.at).toISOString() });
    } catch (e) {
      return send(res, 502, { error: 'calendar unavailable' });
    }
  }
```

Change the final startup log to append the calendar state:

```js
}).listen(PORT, function () { console.log('frame-server listening on ' + PORT + ', BOM ' + GEOHASH + ', HA ' + (HA_URL && HA_TOKEN ? 'on' : 'off') + ', calendar ' + (GCAL_ICS_URL ? 'on' : 'off')); });
```

- [ ] **Step 6: Image and compose**

Replace `dashboard/server/Dockerfile` with:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.js weather-map.js ha-map.js energy-map.js calendar-map.js calendar-service.js ./
USER node
EXPOSE 8080
CMD ["node", "index.js"]
```

In `dashboard/docker-compose.yml`, under the `api` service `environment`, after the `HA_BATTERY_RESERVE` line add:

```yaml
      # Shared Google Calendar's secret iCal address (optional). Without it the frame keeps its mock events.
      - GCAL_ICS_URL=${GCAL_ICS_URL:-}
```

- [ ] **Step 7: Check the image builds and the route behaves**

```bash
cd dashboard/server && docker build -t frame-api-test . 2>&1 | tail -3
(BOM_LOCATION=r652455 PORT=8099 node index.js &) ; sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8099/api/calendar   # 503 without GCAL_ICS_URL
pkill -f "node index.js"
```
Expected: the build succeeds, and `503`. If Docker is not available here, say so and skip the build; Dokploy's build is then the first check.

- [ ] **Step 8: Full suite, commit, push, check the deploy**

```bash
cd dashboard/server && npm test 2>&1 | grep -E "^# (pass|fail)"
cd ../.. && git add dashboard/server dashboard/docker-compose.yml
git commit -m "Server: /api/calendar from the shared iCal feed

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin main
```
Then follow the memory rule: check the Dokploy deploy (webhook sometimes does not fire; use the `compose.deploy` call in `CLAUDE.local.md`), and when it is up run `curl -s <dashboard URL from CLAUDE.local.md>/api/calendar | head -c 600`. Expected: JSON with `events` (real titles) and `stale: false`. Report the titles' count only; do not paste the owner's calendar into commits or docs.

---

### Task 3: Family agenda panel

**Files:**
- Modify: `dashboard/js/views/home.js` (replace `lanes()` at lines 76–92; the markup at line 167; `paint()` line 148; the minute handler line 191)
- Modify: `dashboard/css/views/home.css` (replace the lane rules, lines 67–82)
- Modify: `dashboard/js/views/ambient.js:21`
- Modify: `dashboard/js/views/calendar.js` (event sheet people row near line 262; added events near line 331)

**Interfaces:**
- Consumes: the existing `D.events` shape (`id`, `title`, `start`/`end` as `Date`, `allDay`, `people`, optional `loc`) and helpers `App.allDayOn`, `App.timedOn`, `App.evColor`, `App.pstyle`, `App.fmt.rel`, `App.fmt.time`, `App.esc`.
- Produces: events may carry `live: true` (from Task 4) and `local: true` (added by hand in the Calendar view). `agenda()` renders into `.h-agenda`.

This task runs on the mock data, so it needs no server.

- [ ] **Step 1: Replace `lanes()` with `agenda()`** in `home.js`

```js
  var AGENDA_MAX = 5;

  // What is still to come on `day`: all-day events first, then timed events that have not ended.
  function remaining(day, now) {
    return App.allDayOn(day).concat(App.timedOn(day).filter(function (e) { return e.end > now; }));
  }

  // The next day with anything on it (today first), as one list for the whole family.
  function agenda() {
    var now = App.now(), today = App.dayStart(now), day, list = [], i;
    for (i = 0; i < 7; i++) {
      day = App.addDays(today, i);
      list = remaining(day, now);
      if (list.length) break;
    }
    if (!list.length) return '<div class="h-free serif">Nothing <i>coming up</i></div>';
    var shown = list.slice(0, AGENDA_MAX), more = list.length - shown.length;
    return '<div class="label">' + App.fmt.rel(day) + '</div>' + shown.map(function (e) {
      var cur = !e.allDay && e.start <= now;
      return '<button class="h-ag' + (cur ? ' is-now' : '') + '" style="' + App.pstyle(App.evColor(e)) + '" data-ev="' + App.esc(e.id) + '">' +
        '<span class="h-ag-t">' + (e.allDay ? 'All day' : cur ? 'Now' : App.fmt.time(e.start, false)) + '</span>' +
        '<span class="h-ag-n">' + App.esc(e.title) + '</span>' +
        (e.loc ? '<span class="h-ag-l">' + App.esc(e.loc) + '</span>' : '') + '</button>';
    }).join('') + (more > 0 ? '<button class="h-more" data-go="calendar">+' + more + ' more</button>' : '');
  }
```

Then rename the remaining uses: the markup `<div class="h-lanes" ></div>` becomes `<div class="h-agenda"></div>`; in `paint()` use `el.querySelector('.h-agenda').innerHTML = agenda();`; in the minute handler use `V.el.querySelector('.h-agenda').innerHTML = agenda();`. Run `grep -n "lanes\|h-lane" dashboard/js/views/home.js` and confirm nothing is left.

- [ ] **Step 2: Style it.** In `home.css` delete the `.h-lanes`, `.h-lane`, `.h-lane-head`, `.h-ev*` rules (lines 67–80) and keep `.h-free` and `.h-more`. Add:

```css
.h-agenda { display: flex; flex-direction: column; gap: 6px; min-height: 0; overflow: hidden; }
.h-ag {
  width: 100%; min-width: 0; overflow: hidden;
  display: flex; align-items: center; gap: 14px;
  min-height: 52px; padding: 6px 14px; border-radius: 12px;
  background: rgb(var(--c-rgb) / .12); border-left: 6px solid var(--c); text-align: left;
}
.h-ag-t { flex: none; width: 74px; font-size: 18px; font-weight: 800; font-stretch: 70%; font-variant-numeric: tabular-nums; color: var(--ink-2); }
.h-ag-n { flex: 1; min-width: 0; font-size: 20px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.h-ag-l { flex: none; max-width: 38%; font-size: 16px; color: var(--mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.h-ag.is-now { background: var(--c); color: var(--c-ink); }
.h-ag.is-now .h-ag-t, .h-ag.is-now .h-ag-l { color: inherit; text-transform: uppercase; letter-spacing: .08em; }
```

The `.h-more` rule uses `margin-top: auto`; keep it so the button sits at the bottom of the panel.

- [ ] **Step 3: Make other views tolerate family-wide real events**

`js/views/ambient.js:21`: replace `' · ' + App.person(first.people[0]).name` with `' · ' + App.evColor(first).name` (`evColor` returns the Family colour object, named "Family", for events that include everyone).

`js/views/calendar.js`, in `App.eventSheet`: wrap the people row so it is skipped for real events. Change the line beginning `'<div class="evs-row">' + App.icon('person', 28) ...` and its closing `'</div></div>' +` into `(e.live ? '' : <that whole expression>) +`. The result must keep the same output for mock events.

`js/views/calendar.js` near line 331: add `local: true` to the event object created by the "save" handler: `var e = { id: D._eid(), title: title, people: who, start: start, end: ..., local: true };`.

- [ ] **Step 4: Build and look at it**

```bash
cd dashboard && npx vite build 2>&1 | tail -4
npx vite --host &   # desktop preview, http://localhost:5173/ at 1280x800
```
Open `#home`. Check, using the demo clock (`App.setTime('HH:MM')` in the console, or the existing demo controls):
1. Mid-afternoon: today's rows listed, an in-progress event shows **Now** with the filled style, all-day events show **All day** at the top, and a **+N more** button appears when over 5.
2. 23:30 with the mock data: the label changes to **Tomorrow** and lists tomorrow's events.
3. Tap a row: the event sheet opens. Tap **+N more**: Calendar opens.
4. The panel does not overflow into the side column or below the screen at 1280×800. If it does, lower `AGENDA_MAX` until it fits, and say what you set.
5. Titles with `<` or `&` are shown as text (use the browser console to push one into `DATA.events` and rerender).

If a headless Chrome is available, save a screenshot under `diagnostics/akimart-rk3326/` (git-ignored); otherwise describe what you saw.

- [ ] **Step 5: Commit and push**

```bash
git add dashboard/js dashboard/css
git commit -m "Home: family agenda replaces the per-person lanes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 4: Load the real calendar

**Files:**
- Modify: `dashboard/js/live.js` (new loader after `loadWeather`; hook into the `ready` handler near line 90)

**Interfaces:**
- Consumes: `GET api/calendar -> { events: [{ id, title, start, end, allDay, location }], stale, updated }` from Task 2; `D.events` entries marked `local: true` (Task 3).
- Produces: `D.events` replaced with `Date`-based events: `{ id, title, allDay, live: true, loc?, start: Date, end: Date, people: <every person id> }`. Local-time midnight for all-day dates.

- [ ] **Step 1: Add the loader** to `live.js`, after `loadWeather`:

```js
  // The shared Google Calendar, via the frame server. Events belong to the whole family, so they list every
  // person: the views then show them as "Family". Until the first success the mock events stay.
  var CAL_MS = 5 * 60 * 1000;
  var calJSON = '';

  function localDay(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); } // all-day values are dates, not instants

  function toEvent(e) {
    return {
      id: e.id, title: e.title, allDay: e.allDay, live: true, loc: e.location || undefined,
      start: e.allDay ? localDay(e.start) : new Date(e.start),
      end: e.allDay ? localDay(e.end) : new Date(e.end),
      people: D.people.map(function (p) { return p.id; })
    };
  }

  function loadCalendar() {
    return getJSON('calendar').then(function (res) {
      var json = JSON.stringify(res.events);
      if (json === calJSON) return;
      calJSON = json;
      // Keep anything added by hand in the Calendar view; the rest (mock or earlier real events) is replaced.
      D.events = D.events.filter(function (e) { return e.local; }).concat(res.events.map(toEvent));
      App.emit('data');
      App.rerender();
    }).catch(function (e) {
      if (e.message === 'HTTP 503') return; // server has no calendar configured: stay on mock
      console.warn('HomeHQ live calendar failed, keeping current data:', e.message);
    });
  }
```

In the `App.on('ready', ...)` block add `loadCalendar();` after `loadHome();` and `setInterval(loadCalendar, CAL_MS);` after the `loadWeather` interval.

- [ ] **Step 2: Try it end to end on this machine**

Serve the fixture as a fake "Google" and point the server at it. The fixture's dates are in the week of 2026-10-17, which is today in this environment.

```bash
cd dashboard/server/test/fixtures && python3 -m http.server 8098 >/dev/null 2>&1 &
cd ../.. && BOM_LOCATION=r652455 GCAL_ICS_URL=http://localhost:8098/calendar.ics PORT=8080 node index.js &
cd .. && npx vite --host &
```
Open `http://localhost:5173/#home` and check:
1. The agenda shows the fixture's events (for example "Kids' <b>party</b> & cake" as plain text, "Pizza, then movies", "Bins" under **All day**), not the mock ones.
2. Tapping an event opens the sheet with the title, time and location, and no "people" row.
3. Calendar view: day, week and month load without errors in the console, and the real events appear in the family style.
4. Stop the python server; wait one poll (or lower `CAL_MS` temporarily to test, then put it back): the list stays and the console shows no uncaught errors.
5. Restart `node index.js` without `GCAL_ICS_URL`, reload: the mock events return and nothing errors (503 path).
Then stop all three background processes.

- [ ] **Step 3: Build and commit**

```bash
cd dashboard && npx vite build 2>&1 | tail -3
cd .. && git add dashboard/js/live.js
git commit -m "Dashboard: load events from the shared calendar

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 4: Check the deployed app**

Check the deploy as in Task 2 (the `version.json` build id changes), then `curl -s <dashboard URL from CLAUDE.local.md>/api/calendar | head -c 300`. Stop here and tell the owner: it is live on the server, and the frame picks it up by itself (the dashboard reloads when it sees the new build and the screen is idle). Do not reboot, install or change anything on the frame without asking. Offer a screenshot via the `CLAUDE.md` command if the owner wants one.

---

## Self-review

- **Spec coverage:** mapper and `node-ical` (Task 1); route, cache, stale fallback, 503, compose env, `npm ci` (Task 2); `live.js` fetch/interval/`Date` conversion/`App.rerender()` (Task 4); agenda with all-day pinned, Now, +N more, Tomorrow/next-days/"Nothing coming up", tap-for-sheet, CSS (Task 3); Calendar-view and ambient tolerance (Task 3); tests and fixture cases including recurring, all-day, cancelled, midnight-spanning and non-local timezone (Task 1).
- **Deviation from the spec, deliberately:** caching lives in `calendar-service.js` (not in `index.js`) so the stale and 503-adjacent behaviour is unit-testable; `index.js` stays a thin route. The 503 itself is checked by the manual run in Task 2 Step 7 because `index.js` starts a server on import.
- **Names:** `buildCalendar`, `createCalendar`, `agenda`, `remaining`, `.h-agenda`, `.h-ag*`, `toEvent`, `localDay`, `loadCalendar`, `live`, `local` are used consistently across tasks.
