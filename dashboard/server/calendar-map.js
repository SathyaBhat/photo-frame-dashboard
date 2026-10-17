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
