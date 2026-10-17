# Follow-ups

## Family agenda (deferred from the final review, 2026-10-17)

Plan: `docs/superpowers/plans/2026-10-17-family-agenda.md`. Most useful first.

- [ ] **Stale calendar data never expires.** `calendar-service.js` serves the last good list with `stale: true`
      forever. If the secret iCal address is reset and Google starts returning 404, the frame's list shrinks
      over a week to "Nothing coming up" with no sign anything is wrong. Add a maximum stale age (say 24 h,
      then answer 502) and/or a small "calendar offline" marker on the frame.
- [ ] **Agenda only redraws on the hour.** `home.js` repaints `.h-agenda` on `data` events, when the view is
      shown, and at minute 0. A 4:30 to 4:50 event shows "4:30 PM" instead of "Now" and stays after it ends
      until 5:00. Repaint the agenda in the existing `minute` handler.
- [ ] **"+N more" can be clipped.** With two day sections (for example all-day items today, then events
      tomorrow) the panel needs about 316 px against its 304 px. Cap rows by sections, or shrink
      `.h-more` / the row height when there are two labels. Needs a look on the frame.
- [ ] **Calendar-map tests depend on the timezone.** Two tests fail under `TZ=Pacific/Kiritimati` because the
      sort key for an all-day event is server-local midnight. Pin `TZ` in the test script or stop asserting
      cross-type ordering.
- [ ] **Unescaped event ids in the Calendar view.** `calendar.js` writes `data-ev="' + e.id + '"` in several
      places (home.js already uses `App.esc`). A UID containing `"` would break the attribute.
- [ ] **Dead fallback in `calendar-map.js`.** `i.end ||` never runs because node-ical always fills `end`; a
      timed event with no DTEND gets zero length, not the intended 1 h. Fix the code or the comment.

## Known limits (accepted in the spec)

- The Calendar view (day, week, month) only has the next 7 days once real data loads: nothing earlier.
- The commit `a15e178` still contains the dashboard hostname in the plan (scrubbed since). History was not rewritten.
