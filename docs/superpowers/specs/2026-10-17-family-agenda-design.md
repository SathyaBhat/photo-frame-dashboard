# Family agenda from the shared Google Calendar

## Goal

Replace the per-person schedule lanes on the Today (home) view, under the battery card, with a
single **Family agenda** of upcoming events from the family's shared Google Calendar. The lanes
split the day by person, so most columns said "Free" and the panel carried little information.

## Decisions

- **Source:** the calendar's secret iCal address, fetched by the server only. No OAuth and no
  Google Cloud project.
- **Credential:** `GCAL_ICS_URL`, set in the Dokploy app environment. Never committed, never sent
  to the browser.
- **One shared calendar:** events are not tied to a person, so the agenda has no per-person
  colours. Per-person attribution (for example by title prefix) is out of scope.
- **Fallback:** without `GCAL_ICS_URL` the server answers 503 and the frame keeps its mock events,
  the same way Home Assistant is optional today.

## Server (`dashboard/server`)

- `calendar-map.js`, in the style of `weather-map.js`: a pure function from `{ ics, now, days }` to
  the event list, so it is testable without the network. It parses the .ics with `node-ical`,
  which expands recurring events (RRULE, EXDATE, overridden instances) and handles `VTIMEZONE`.
  This is the server's first runtime dependency, so the `Dockerfile` needs an `npm ci` step.
- Output: events from now to about 7 days ahead, as
  `[{ id, title, start, end, allDay, location }]` with ISO 8601 strings, sorted by start.
  Cancelled instances are dropped. Events that already ended are dropped.
- `index.js`: `GET /api/calendar` with a cache of about 5 minutes and one in-flight fetch at a
  time. If Google fails, it serves the last good copy with `stale: true`; with no copy it answers
  an error. The response shape matches the other routes (`{ data, stale, at }`).
- `docker-compose.yml`: `GCAL_ICS_URL=${GCAL_ICS_URL:-}` under `api`.
- Tests (`server/test/calendar-map.test.js`, `node --test`) with a small fixture .ics: a weekly
  recurring event, an all-day event, a cancelled instance, an event that spans midnight, and a
  non-local timezone. Plus a route test for the stale fallback and the 503 when unconfigured.

## Dashboard (`dashboard/`)

- `js/live.js`: fetch `/api/calendar` at startup and every few minutes, using the existing
  helper and offline handling. Convert ISO strings to `Date` objects (`start`, `end`), set
  `App.state.events`, and call `App.rerender()`. Keep the field names the views expect.
- `js/views/home.js`: `lanes()` becomes `agenda()`.
  - All-day events for today are pinned at the top.
  - Timed events that have not ended follow, sorted by start. The one in progress shows "Now" and
    keeps the `is-now` highlight.
  - Show up to about 5 rows, then a **+N more** button that goes to Calendar.
  - When nothing is left today, show a **Tomorrow** section; if that is empty too, the next few
    days with events; if there are none, "Nothing coming up".
  - Tapping a row opens the existing event sheet.
- `css/views/home.css`: replace the lane styles with agenda rows. Rows are at least about 56 px
  tall. Use the existing tokens and no 4- or 8-digit hex colours (the frame's WebView rejects
  them).
- Calendar view and event sheet: check that nothing assumes `event.people` is populated or that
  every event has a person colour, and add a neutral fallback where it does. No redesign.

## Constraints from the frame

- Chromium 106 WebView, targets unchanged. 1280×800 touch. About 1 GB RAM, so the payload is a few
  dozen small objects and there is no animation.
- The frame talks only to the LAN server.

## Testing and rollout

- Server: `npm test` in `dashboard/server`.
- Dashboard: `npx vite build`, then a desktop preview at 1280×800 with the demo clock at a busy
  afternoon, an evening with nothing left, and a day with an all-day event.
- On the frame: reload the kiosk, take a screenshot, and check `adb logcat` for errors. Frame
  writes still need the owner's approval.
- `GCAL_ICS_URL` must be set in the Dokploy app environment before the real data appears.

## Out of scope

Two-way editing, multiple calendars, per-person attribution, and notifications.
