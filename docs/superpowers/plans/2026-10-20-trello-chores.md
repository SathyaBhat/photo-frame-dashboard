# Chores from Trello Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chores live as cards in a Trello "Chores" list on the grocery board, managed from a Shopping-style Chores screen (add, tick, assign via popup, usuals tiles, remove).

**Architecture:** The server's existing `createTrello` (one cached board read, serialised writes) gains chore methods and a new `chores-route.js` mounted at `/api/chores`, mirroring groceries. `live.js` polls `api/chores` into `D.chores`/`D.members` with the same busy-counter and optimistic-write pattern; the Tasks view is rewritten on the Shopping view's pattern.

**Tech Stack:** Node 22 ESM server with `node --test`; plain ES5-style JS in the browser, bundled by Vite (Chromium 106).

**Spec:** `docs/superpowers/specs/2026-10-19-trello-chores-design.md`

## Global Constraints

- Server tests: `cd dashboard/server && npm test`. Client has no test runner: verify with `cd dashboard && npx vite build` and the Review Focus manual checks.
- Client style: ES5-ish `var`/`function` in IIFEs, HTML built as strings, all user data through `App.esc()`. Vite targets `chrome106` (JS) and `chrome61` (CSS): no 4- or 8-digit hex colours.
- Touch targets sized for a finger on a 1280×800 screen; ~1 GB RAM, so granular DOM updates, no heavy animation.
- Trello credentials stay on the server. Errors use fixed messages (no URLs/keys).
- A new server module must be added to the `COPY` line in `dashboard/server/Dockerfile`.
- List names are matched with `listKey()` (ignore case and leading non-letters): `chores`, `chores done`. The server never creates lists.
- Usual label = `isUsualName()` (`Usual`/`Usuals`, any case). Assignment = Trello `idMembers` only; no labels. Remove = archive the card.
- Commit after each task, then `git push origin main` (the owner wants a push after every commit), except Tasks 4 and 5, which are pushed with Task 6 so the deployed client is never half-converted.

## Review Focus

- Card with no `idMembers`, several members, or a non-board member: shows under first known board member, else "Either"; picking in the popup leaves exactly the chosen member (Task 1, Task 2 tests).
- Board has no "Chores" list: `GET /api/chores` gives 502 ("Can't reach" on the screen); no "Chores done": ticking errors, list still reads (Task 2 tests).
- Typing a name that matches a done chore revives it rather than duplicating (Task 2 test, Task 5 manual check).
- Tapping a usual tile whose chore is already open only flashes the row (Task 5 manual check).
- A poll answering across a write must not overwrite the optimistic state (Task 4, reuse the grocery gen/busy pattern; manual check on the iPad).

---

### Task 1: Board mapping — `buildChores`

**Files:**
- Modify: `dashboard/server/trello-map.js`
- Modify: `dashboard/server/trello-service.js` (board-read query only)
- Test: `dashboard/server/test/trello-map.test.js`, `dashboard/server/test/trello-service.test.js`

**Interfaces:**
- Produces: `export function buildChores(board): { items: ChoreItem[], members: {id, name}[] }` where `ChoreItem = { id, name, who: string, usual: boolean, done: boolean, at: string }`. `who` is the first of the card's `idMembers` that is a board member, else `''`. Member `name` is the first word of `fullName` (a one-word `fullName` is used whole). Throws `Error('no Chores list')` when no open list matches `chores`. Items = cards in Chores (`done:false`) plus cards in `chores done` (`done:true`, newest first by `dateLastActivity`, capped at 60 with usuals kept). Archived cards (`closed`) are skipped. Missing `chores done` list is not an error.
- Produces: `resolveIds(board)` additionally returns `chores` and `choresDone` list ids (null if missing).
- Board read query becomes `{ lists: 'open', cards: 'open', labels: 'all', members: 'all', member_fields: 'fullName' }`.

- [ ] **Step 1: Write failing tests** in `trello-map.test.js`: `buildChores maps open and done cards` (two members `Sat Bhat`, `Jo Bhat` → names `Sat`, `Jo`; a card assigned to Jo gives `who === jo.id`; a usual-labelled card gives `usual: true`; a Chores-done card gives `done: true`), `buildChores: unknown or multiple members` (card with `['stranger', jo.id, sat.id]` → `who === jo.id`; card with only `['stranger']` → `''`), `buildChores throws without a Chores list`, `buildChores tolerates a missing Chores done list`, `buildChores keeps usuals when capping done cards` (70 done cards, 2 usual and old → 60 items done, both usuals present). Update the pinned query in the `reads the board in one call` test in `trello-service.test.js` to the new query.
- [ ] **Step 2: Run** `cd dashboard/server && npm test` → the new tests FAIL (`buildChores` not exported; query mismatch).
- [ ] **Step 3: Implement `buildChores(board)` and the `resolveIds` additions** in `trello-map.js`, reusing `findList`, `isUsualName` and the `STOCKED_CAP` constant/`capStocked` approach (make `capStocked` accept the cap or reuse as is). Change the query in `trello-service.js` `get()`.
- [ ] **Step 4: Run** `npm test` → all PASS (grocery tests unchanged apart from the query).
- [ ] **Step 5: Commit** `git add dashboard/server && git commit -m "Server: map the Trello Chores lists"` then `git push origin main`.

---

### Task 2: Service — chore reads and writes

**Files:**
- Modify: `dashboard/server/trello-service.js`
- Test: `dashboard/server/test/trello-service.test.js`

**Interfaces:**
- Consumes: `buildChores`, `resolveIds` (Task 1); existing closure helpers `write`, `get`, `current`, `api`, `invalidate`, `has`, `setUsualLabel`.
- Produces on the object returned by `createTrello`:
  - `getChores(): Promise<{ data: {items, members}, stale: boolean, at: number }>` — runs `get()` for the shared cached read/stale handling, then `buildChores` on the cached raw board. If `get()` itself throws (board unreachable, no To Buy list), rethrow. Missing Chores list → throws `Error('no Chores list')`.
  - `tickChore(id: string, done: boolean)` — moves the card to `choresDone` (done) or `chores` (not done), `pos: 'top'`; missing target list → `Error('no Chores done list')` / `Error('no Chores list')`.
  - `setChoreUsual(id: string, usual: boolean)` — delegates to `setUsualLabel`.
  - `setChoreWho(id: string, who: string)` — `''` removes all of the card's members; a board member id sets exactly that member (DELETE the others with `/cards/:id/idMembers/:memberId`, POST `/cards/:id/idMembers` `{ value: who }` if not already on); an id that is not a board member → `BadRequest('unknown member')`.
  - `removeChore(id: string)` — `PUT /cards/:id { closed: true }`.
  - `addChore({ name, who? })` — validates name like `add` (trimmed, 1–200 chars → `BadRequest('invalid name')`), `who` must be a board member id or empty; revive-by-name is the client's job. `POST /cards { idList: chores, name, pos: 'top', idMembers? }`. Missing Chores list → `Error('no Chores list')`.
  - All return the fresh `getChores()` result after the write (as groceries do via `write`/`get`; chore writes call `invalidate()` in a `finally`).

- [ ] **Step 1: Write failing tests** (extend `makeBoard()` with `chores`/`chores done` lists, `members: [{id:'m-sat', fullName:'Sat Bhat'}, {id:'m-jo', fullName:'Jo Bhat'}]`, and a few chore cards; the `fake()` helper's non-GET answer is fine): `getChores returns chores and members`; `tickChore moves the card between the two lists` (assert one `PUT /cards/<id>` with `idList` and `pos: 'top'`); `tickChore without a Chores done list errors`; `setChoreWho swaps members` (card on `m-sat` → DELETE `/cards/c/idMembers/m-sat` and POST `/cards/c/idMembers` value `m-jo`); `setChoreWho '' clears all members`; `setChoreWho rejects a non-member` (BadRequest); `setChoreUsual adds then removes the Usual label`; `removeChore archives`; `addChore posts to the Chores list with the member`; `addChore rejects bad names and non-members`; `getChores throws when the board has no Chores list`; `chore writes invalidate the cache` (a read after a write re-fetches).
- [ ] **Step 2: Run** `npm test` → new tests FAIL.
- [ ] **Step 3: Implement the methods** above inside `createTrello`, reusing `write` so a vanished card is not an error.
- [ ] **Step 4: Run** `npm test` → all PASS.
- [ ] **Step 5: Commit** "Server: chore reads and writes on the Trello board"; push.

---

### Task 3: Route — `/api/chores`

**Files:**
- Create: `dashboard/server/chores-route.js`
- Modify: `dashboard/server/index.js` (import, mount before the generic 405 line, exactly like groceries), `dashboard/server/Dockerfile` (add `chores-route.js` to the `COPY` line)
- Test: `dashboard/server/test/chores-route.test.js`

**Interfaces:**
- Consumes: Task 2 methods; `BadRequest`, `NotFound` from `trello-service.js`.
- Produces: `export function choresRoute({ trello, readJSON, send })` returning `async (req, res, path) => void`. Responses: `GET /api/chores` → `200 { chores: {items, members}, stale, updated }`; `POST /api/chores` body `{ name, who? }` → same shape; `POST /api/chores/:id` body with exactly one of `done` (boolean), `usual` (boolean), `who` (string), `closed` (must be `true`) → same shape. Status codes: 503 when `trello` is null; 400 `BadRequest` (bad id not 24-hex, bad body, bad field); 404 `NotFound`; 405 for other methods/paths; 502 `{ error: 'trello unavailable' }` for any other error. Copy the structure of `groceries-route.js`.

- [ ] **Step 1: Write failing tests** in `chores-route.test.js` copying the harness from `groceries-route.test.js` (fake trello with `getChores, tickChore, setChoreUsual, setChoreWho, removeChore, addChore`): GET shape; 503 without trello; POST add passes `{name, who}`; each edit field dispatches to the right method with the right args; `closed: false` → 400; two fields → 400; bad id → 400; unknown path/method → 405; `BadRequest` → 400; `NotFound` → 404; other error → 502 with the fixed message.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement `chores-route.js`, mount it in `index.js` (`path === '/api/chores' || path.indexOf('/api/chores/') === 0`), update the Dockerfile `COPY` line.**
- [ ] **Step 4: Run** `npm test` → PASS; `node --check dashboard/server/index.js`.
- [ ] **Step 5: Commit** "Server: /api/chores route"; push. (The push redeploys the api container; `/api/chores` answers 502 "unavailable" until the lists exist, which they do.)
- [ ] **Step 6: Verify live** once Dokploy has redeployed: `curl -s http://wraeclast/frame/api/chores | head -c 400` shows `{"chores":{"items":[...],"members":[{"id":...,"name":...}]` with both members. If it is 502, read `docker logs frame-api` and fix before going on.

---

### Task 4: Client data — live polling and writes

**Files:**
- Modify: `dashboard/js/live.js`, `dashboard/js/data.js`, `dashboard/js/app.js`

**Interfaces:**
- Consumes: Task 3 API.
- Produces (on `window.DATA` / `App`): `D.chores: {id, name, who, usual, done, at}[]`, `D.members: {id, name}[]`, `D.choresLive: boolean`, `D.choresOffline: boolean`, `App.choresBusy: number`, `App.choresWrite(path: string, body: object): Promise<void>` (same contract as `App.groceriesWrite`: rejects on non-2xx/timeout, applies the reply, bumps/releases the gen counter). Removed: `D.routines`, `D.stars`, `D.week`, `App.currentRoutine`, routine fields on chores.

- [ ] **Step 1: In `data.js`** replace the routines/chores/stars/week block with `var chores = []; var members = [];` and export `chores`, `members`; remove `routines`, `stars`, `week` from the exported object. In `app.js` remove `App.currentRoutine`.
- [ ] **Step 2: In `live.js`** add a chores section after groceries, copying the groceries pattern: `loadChores` (`getJSON('chores')`, poll every 60 s alongside groceries in the `ready` handler), `applyChores(res)` (skips while `App.choresBusy`, JSON-compares to skip no-op repaints, sets `D.chores`, `D.members`, `D.choresLive = true`, `D.choresOffline = !!res.stale`, `App.emit('data')`, `App.rerender()`), `setChoresOffline`, its own `choresGen`, and `App.choresWrite`. Unlike groceries there is no mock fallback: before the first success `D.choresLive` is false and `D.choresOffline` is true after the first failure; a 503 (Trello unconfigured) leaves the view showing "Chores aren't set up".
- [ ] **Step 3: Verify** `cd dashboard && npx vite build` succeeds. (The Tasks and Home views still read the old fields and are fixed in Tasks 5 and 6; do not deploy between.)
- [ ] **Step 4: Commit** "Chores: live data from the server"; do NOT push yet (the old views would break). Continue to Task 5 on the same branch state.

---

### Task 5: Tasks view rewrite

**Files:**
- Modify (rewrite): `dashboard/js/views/tasks.js`, `dashboard/css/views/tasks.css`

**Interfaces:**
- Consumes: `D.chores`, `D.members`, `D.choresLive/Offline`, `App.choresWrite`, `App.choresBusy` (Task 4); helper patterns from `dashboard/js/views/shopping.js` (`write()` queue with `guard`, `swap`, `byData`, `flash`, optimistic updates with revert, `saving()` for `_tmp` ids, toast with undo).
- Produces: `App.register('tasks', { show })` as before (`#tasks`, rail button unchanged).

Behaviour (all from the spec):
- Left: open chores grouped by assignee: one `.c-group` per member in `D.members` order, then "Either"; empty groups hidden. Rows: finger-sized tick button (`data-check`), name, an assign button (`data-assign`) showing the assignee's first name or "Either", and a remove button (`data-remove`).
- Header: "Chores", count of open chores, same offline text as Shopping.
- "Done" drawer: done non-usual chores from the last 24 h (by `at`), tap to add back; usual chores never appear in the drawer, only as tiles.
- Right side: "Add a chore…" input (Enter or tap "Add") and Usuals tiles: one tile per lower-cased name among `usual` chores, preferring the open card, else the done one; tile shows "On list" when open. Typing filters/suggests matching usuals like Shopping.
- Adding a name that matches a done chore revives it (`done:false` write) instead of creating a card; a name matching an open chore only flashes it with an "Already on the list" toast.
- Assign popup: tapping `data-assign` opens a small absolutely-positioned popup (one per view, closed by a second tap on the button, a tap elsewhere, or picking) listing each member and "Either" with the current one marked; picking sends `{ who: memberId }` (`''` for Either) and updates the row optimistically with revert on failure.
- Remove: the row disappears at once and `{ closed: true }` is sent immediately (revert on failure); toast "Removed <name>", no undo.
- New chores use temp ids (`tmpN`, `_tmp: true`) until the reply replaces the list, exactly as Shopping does.

- [ ] **Step 1: Rewrite `tasks.js`** per the above, following `shopping.js`'s structure and the "Match the existing style" rule in `CLAUDE.md`. Interactions that must be guarded: `App.choresBusy` increments while writes are queued; the view repaints from `D.chores` on `show(el, {rerender:true})`.
- [ ] **Step 2: Rewrite `tasks.css`** with `c-` prefixed classes; reuse the shopping look (card colours from `tokens.css`, 60 px+ tap targets, `text-align: center` on button labels).
- [ ] **Step 3: Verify build:** `cd dashboard && npx vite build` succeeds.
- [ ] **Step 4: Manual check with the dev server** (`npx vite --host`; point `API` is relative so use the real server by proxying — if the dev server has no proxy, temporarily test by deploying in Task 7): the screen renders groups, popup opens/closes, add/tick/remove call `api/chores` (watch the Network tab).
- [ ] **Step 5: Commit** "Chores: Shopping-style Tasks view with assignee popup"; do NOT push yet.

---

### Task 6: Home screen chore card

**Files:**
- Modify: `dashboard/js/views/home.js` (function `chores()`), `dashboard/css/views/home.css` (only if the old ring styles become unused)

**Interfaces:**
- Consumes: `D.chores`, `D.members`, `D.choresLive`, `D.choresOffline`.
- Produces: the `.h-chores` button (still `data-go="tasks"`) now shows `<div class="label">Chores</div>` and, per member then "Either", the number of open chores and the name (first name). Offline/unconfigured: "–" and "Can't reach the chore list" in the same style as the shopping card's offline text. All names through `App.esc()`.

- [ ] **Step 1: Rewrite `chores()`** in `home.js` and remove the ring helper usage for chores only if nothing else uses `App.ring`.
- [ ] **Step 2: Verify:** `cd dashboard && npx vite build`; grep shows no remaining reference to `currentRoutine`, `D.routines`, `D.stars`, `D.week` anywhere in `dashboard/js`.
- [ ] **Step 3: Commit** "Home: open chores per person"; `git push origin main` (this is the first push that carries the client, now consistent).

---

### Task 7: Deploy and verify on the real devices

- [ ] **Step 1:** Wait for the Dokploy build (or redeploy with the `compose.deploy` command in `CLAUDE.local.md`), confirm `curl -s http://wraeclast/frame/version.json` changes.
- [ ] **Step 2:** Run the Review Focus manual checks on the iPad (`https://…/frame/`) and the frame (reload per `CLAUDE.md`; the frame reload and `adb` steps need the owner's approval for any write beyond reload): add a chore, assign each of you and Either via the popup, tick it, add it back from the drawer, mark one `Usual` in Trello and see its tile, tap an already-open usual (flash only), type a done chore's name (revives), remove one (archived in Trello), assign a second member to a card in Trello and see it fall under the first known member.
- [ ] **Step 3:** `adb logcat -d | grep -E "HomeHQ|chromium"` on the frame shows no uncaught errors (ask before connecting if ADB is closed).
- [ ] **Step 4:** Report the results to the owner, including anything that did not work.
