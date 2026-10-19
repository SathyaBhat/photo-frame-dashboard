# Chores from Trello: design

## Intent

The Tasks ("Chores") screen has no data source: `chores` in `dashboard/js/data.js` is `[]`, so the lanes
are empty and nobody can add or remove a chore. The household is two adults, no kids. Their chores
vary in frequency (mowing, weeding, watering, indoor plant care, laundry, vacuuming; bins every week).
The owner wants to manage them the way groceries are managed: a list, a quick-add box, and tiles for
the regular ones, backed by Trello.

## Goals

- Chores live as cards on the existing grocery Trello board, in a list named **Chores**.
- The Chores screen works like Shopping: open chores on the left, "Add a chore…" box and Usuals
  tiles on the right, a "Done" drawer for ticked chores.
- Add, tick, un-tick (add back), assign and remove chores from the frame or the iPad. Changes made
  in Trello appear on the screen at the next poll.
- Each chore can be assigned to one of the two board members, or to nobody ("either").

## Non-goals

- No automatic scheduling or recurrence. A ticked chore stays done until someone taps its Usuals
  tile (or "Add back") again. Bins every week is just a usual that gets tapped weekly.
- No due dates, quantities, notes editing, categories or stores for chores.
- The old morning / after-school / evening routines and the stars/week data are dropped (they were
  built for kids).

## Anti-goals

- Don't break groceries. Shared Trello code must keep working the same for `/api/groceries`.
- No credentials in `dashboard/`; Trello is only ever called by the server.

## Constraints

- Frame constraints in `CLAUDE.md` apply: Chromium 106, 1280×800 touch, ~1 GB RAM, ES5-ish `var`/
  `function` style, HTML built as strings, all user data through `App.esc()`.
- A new server module must be added to the `COPY` line in `dashboard/server/Dockerfile`, or the api
  container crash-loops.
- The Trello key, token and board id already exist in the server environment. Reuse them.

## Decisions (the owner's)

- Trello: **same board** as groceries, a list named **Chores**. Matching is by name, ignoring case and
  leading emoji, as `listKey()` does for groceries.
- Done chores: a second list, **Chores done** (the name is the designer's call, see below). Ticking
  moves the card there; adding back moves it to Chores.
- Regular chores: the existing **Usual** label (any of `Usual`/`Usuals`, any case) marks a chore
  as a usual and gives it a tile, like groceries.
- Assignment: the Trello card **members** (`idMembers`). No labels. A card with no member is "either".
  Both owners are members of the board.
- The look and behaviour follow `dashboard/js/views/shopping.js` as closely as is sensible.
- Added from the Add box: a new chore goes to **Chores**, unassigned, with no category.

## Designer's calls (check these)

- The done list is named `Chores done`. If it doesn't exist on the board, ticking can't work; the
  server answers with an error rather than creating lists. (The owner creates the two lists.)
- The assign button cycles: nobody → member 1 → member 2 → nobody. Members are shown by first name
  (Trello `fullName`, first word), ordered by Trello's member order.
- Open chores are grouped by assignee: one group per member, then "Either". Empty groups are hidden.
- The Done drawer shows chores ticked in the last 24 h, as groceries do. Usuals always keep a tile.
- Removing a chore = archiving the card in Trello (`closed: true`) from a "Remove" action on the row.
  The server never deletes cards. A usual that is removed also loses its tile.
- Home screen: the "Chores · <routine>" ring card is replaced by a plain count of open chores per
  person (and "either"), linking to the Chores screen. It needs no routines.
- The Tasks view keeps its rail button and `#tasks` route; its file is rewritten.

- Usual tiles follow groceries exactly: a tile stands for the usual card by name (one tile per
  lower-cased name; the open card if there is one, else the done one). Tapping it when the chore is
  already open only flashes the row ("Already on the list"); otherwise it moves the done card back to
  Chores. Typing a name that matches a done card revives that card instead of creating a duplicate.
  Done usuals stay in Chores done for good; only non-usual done cards age out of the drawer.
- `at` is the card's `dateLastActivity`, as for groceries; the Done drawer window uses it.
- A card with several members, or members who aren't board members, shows under the first known
  board member (else "Either"). Cycling the assign button sets exactly the chosen member and removes
  the others on that card.
- Missing lists: `GET /api/chores` with no Chores list answers 502 (so the screen shows "Can't reach");
  with no Chores done list it still works but ticking answers an error. If several lists match a name,
  the first by board order wins. No list is ever created by the server.
- The existing grocery test pins the board-read query; it is updated with `members` in the same change.
- Home: `App.currentRoutine`, `D.routines`, `D.chores` routine fields and the stars/week data are
  removed along with the ring card; nothing else reads them.

## Server

- `GET /api/chores` returns `{ chores: { items, members }, stale, updated }`:
  `items` are `{ id, name, who (member id or ''), usual, done, at }`; `members` are `{ id, name }`.
- `POST /api/chores` adds `{ name, who? }` to the Chores list.
- `POST /api/chores/:id` edits exactly one field: `done` (boolean, moves between the two lists),
  `usual` (boolean, Usual label), `who` (member id string, `''` = nobody), or `closed: true` (archive).
- Same safety rules as groceries: 24-hex ids, 400 on bad bodies, 404 for a vanished card, 503 when
  Trello isn't configured, 502 when Trello is down, fixed error messages (no URLs/keys).
- The board read adds `members=all` (or `members=all&member_fields=fullName`) so chores and
  groceries share one cached read. The grocery mapper ignores the extra data.

## Client

- `live.js` polls `api/chores` like groceries (same interval, same busy-counter and optimistic-write
  pattern) and fills `D.chores` / `D.members`. Until the first success the view shows an empty list
  with the same "Can't reach" state as groceries; there is no mock chore list any more.
- The Tasks view is rewritten on the Shopping pattern. Granular DOM updates, as in Shopping, where
  a full repaint is slow on the frame.

## Left to the builder

- File layout on the server (one `chores-*` module or shared helpers), test layout (follow
  `dashboard/server/test/`), CSS details, copy for empty/offline states.
- Whether `members` display order or name collisions need extra handling.
