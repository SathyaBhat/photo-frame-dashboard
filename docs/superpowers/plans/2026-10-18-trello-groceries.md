# Grocery list from Trello Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Shopping view and Home tile show the family's real list from the Trello board "Anavrin", and ticking, adding and tagging on the frame write back to Trello.

**Architecture:** `dashboard/server` gains a Trello reader/writer (pure mapping module + cached service + routes), in the style of the calendar and Home Assistant code. The frame fetches `/api/groceries` in `js/live.js`, swaps `D.groceries`/`D.stores`/`D.catOrder`, and the Shopping view posts changes back. A committed dry-run-by-default script migrates the board's lists and labels once.

**Tech Stack:** Node 20+ ESM with `node --test` (no new dependencies; global `fetch`), plain ES5-ish browser JS, Trello REST API.

**Spec:** `docs/superpowers/specs/2026-10-17-trello-groceries-design.md`

## Global Constraints

- Credentials `TRELLO_API_KEY`, `TRELLO_TOKEN`, `TRELLO_BOARD` live in the server environment only; never committed, logged, put in an error message, or sent to the browser. Trello takes them as query parameters, so rethrow errors without the URL.
- Without credentials, `/api/groceries*` answers 503 and the frame keeps its mock list.
- Lists found by name: `To Buy`, `Stocked` (ignore `Recipes`). Category labels, matched by name: Produce, Bakery, Dairy & Refrigerated, Meat & Seafood, Pantry, Snacks, Spices & Seasoning, Household. Low label: `Low`. Store labels: `Store: <name>` (tab shows `<name>`). Any other label is ignored.
- Stocked: the 60 most recently active cards (`dateLastActivity`), newest first; the drawer shows those from the last 24 hours.
- Cache about 30 s; writes invalidate it; stale copy served on failure with `stale: true`.
- Frame: Chromium 106, no 4- or 8-digit hex colours, touch targets at least about 56 px, no heavy animation, `var`/`function` inside IIFEs, all user data through `App.esc()`.
- Server tests: `cd dashboard/server && npm test`. Commit after each task; the owner has asked for a push to the fork's `main` straight after each commit. Pushing `main` deploys the dashboard, so tasks 3 and 5 onward change the live frame only once `TRELLO_*` are set in Dokploy (ask the owner to set them before Task 6 is pushed).

## Review Focus

- A card with no category label: shows under "Other" and is never dropped.
- A card name containing `<`, `&` or quotes: escaped everywhere on the frame.
- Trello returns 429 or the network is down after real data was shown: the last real list stays, the "Couldn't reach Trello" line appears, mock groceries never return.
- The 60-second poll lands while a tick is in flight: the tick is not undone.
- Hermes archives or moves a card the frame is about to tick: no error toast, list refreshes.

---

### Task 1: Mapping module

**Files:**
- Create: `dashboard/server/trello-map.js`
- Create: `dashboard/server/test/fixtures/trello-board.json` (a board: lists To Buy / Stocked / Recipes; labels incl. categories, Low, `Store: Tong Li`, one stray label; cards covering: plain, Low, store, no category, legacy `Category:`/`Migrated from` description lines plus a real note, archived card, name with `<b>&"`, Stocked cards with varied `dateLastActivity`)
- Test: `dashboard/server/test/trello-map.test.js`

**Interfaces:**
- Produces:
  - `export var CATEGORIES: string[]` (the eight names, in display order)
  - `export function buildGroceries({ board, now }): { items: Item[], stores: {id,name}[], categories: string[] }` where `board` is Trello's `GET /boards/:id` JSON with `lists`, `labels`, `cards` expanded and `Item = { id, name, cat, store, low, note, done, at }` (`cat` is a category name or `'Other'`; `store` is the store name or `''`; `done` true for Stocked cards; `at` is `dateLastActivity` ISO). Open cards only (`closed` false). Throws `Error('no To Buy list')` if the list is missing.
  - `export function resolveIds(board): { toBuy, stocked, labels: {name→id} }` for the writer.
- Consumes: nothing.

- [ ] **Step 1: Write failing tests** in `trello-map.test.js`: To Buy cards map to `done:false`; Stocked to `done:true`, capped at 60 newest-first; `Low` label sets `low`; `Store: Tong Li` sets `store:'Tong Li'` and `stores` lists it once; stray labels ignored; unlabelled card → `cat:'Other'`; description note strips `Category:`, `Store:` and `Migrated from ...` lines and keeps the remaining text; archived cards dropped; Recipes cards never appear; missing To Buy list throws; `<b>&"` names pass through unescaped (escaping is the view's job).
- [ ] **Step 2: Run** `npm test -- test/trello-map.test.js`; expect FAIL (module missing).
- [ ] **Step 3: Implement** `trello-map.js` per the interface.
- [ ] **Step 4: Run tests;** expect PASS.
- [ ] **Step 5: Commit** `Server: map the Trello board to grocery items`.

### Task 2: Trello service (cache and writes)

**Files:**
- Create: `dashboard/server/trello-service.js`
- Test: `dashboard/server/test/trello-service.test.js`

**Interfaces:**
- Consumes: `buildGroceries`, `resolveIds`, `CATEGORIES` from Task 1.
- Produces:
  - `export function createTrello({ key, token, board, fetchJSON, ttlMs, clock })` returning `{ get(): Promise<{data, stale, at}>, tick(id, done), setLow(id, low), setCategory(id, cat), setStore(id, store), add({name, cat, store}) }`. `fetchJSON(method, path, query)` is injectable; the default wraps `fetch` to `https://api.trello.com/1`, appends key and token, and rethrows failures as `Error('trello -> HTTP <status>')` or `Error('trello unreachable')` without the URL. Every write resolves with the fresh `get()` result after invalidating the cache.
  - `export class NotFound extends Error` for a card Trello says is gone (HTTP 404); writes catch it, refresh, and resolve normally (idempotent). Validation failures (unknown category, store name over 40 chars or containing control characters) throw `BadRequest` from a shared export `export class BadRequest extends Error`.
- Read is one `GET /boards/:id?lists=open&cards=open&labels=all` call. Missing labels are created on first use (`POST /labels`). `tick` moves the card with `PUT /cards/:id` (`idList`, `pos: 'top'`). Ticking a card already in the target list is a no-op success.

- [ ] **Step 1: Write failing tests** with a fake `fetchJSON` recording calls: caches until ttl; one in-flight read shared; stale copy served when a later read fails; first-read failure rejects; error messages never contain the key or token (fake throws with them in the message → the default wrapper path is tested by stubbing global `fetch`); `tick` of a To Buy card issues one `PUT` to the Stocked list id then refetches; ticking an already-Stocked card issues no PUT; 404 on write resolves; `add` creates a missing category label then the card with `idLabels`; `setLow(id,false)` removes the label; `add` with category `Nope` throws `BadRequest`.
- [ ] **Step 2: Run;** expect FAIL.
- [ ] **Step 3: Implement** `createTrello` and the default `fetchJSON`.
- [ ] **Step 4: Run tests;** expect PASS.
- [ ] **Step 5: Commit** `Server: Trello reader and writer with cache`.

### Task 3: Routes and compose

**Files:**
- Modify: `dashboard/server/index.js` (env vars near the top; routes next to `/api/calendar` and `homeRoute`; startup log line)
- Modify: `dashboard/docker-compose.yml` (`TRELLO_API_KEY`, `TRELLO_TOKEN`, `TRELLO_BOARD`, all `${…:-}` under `api`)
- Test: `dashboard/server/test/groceries-route.test.js`

**Interfaces:**
- Consumes: `createTrello`, `BadRequest` (Task 2).
- Produces (JSON, `cache-control: no-store`):
  - `GET /api/groceries` → `{ groceries: { items, stores, categories }, stale, updated }`
  - `POST /api/groceries` body `{ name, cat?, store? }` → same shape as GET
  - `POST /api/groceries/:id` body with one of `{ done: boolean }`, `{ low: boolean }`, `{ cat: string }`, `{ store: string }` → same shape
  - 503 `{error:'trello not configured'}` without credentials; 400 on validation or invalid JSON; 502 `{error:'trello unavailable'}` on failure with no cached copy. `:id` must match `/^[0-9a-f]{24}$/`.
- Extract the route handler as `export function groceriesRoute(trello)` in a new `dashboard/server/groceries-route.js` so it is testable without starting the server; `index.js` wires it. Reuse `readJSON`/`send` by moving them into that module's arguments rather than duplicating.

- [ ] **Step 1: Write failing tests** calling the handler with a fake `trello` and fake req/res: GET 200 shape; 503 when `trello` is null; POST add validates a missing/over-long name (400); `:id` not 24-hex (400); body with two of the fields (400); unknown route method (405); backend throws → 502 with no credentials in the body.
- [ ] **Step 2: Run;** expect FAIL.
- [ ] **Step 3: Implement** the module, wire `index.js` and compose, extend the startup log with `trello on|off`.
- [ ] **Step 4: Run** the full `npm test`; expect PASS.
- [ ] **Step 5: Commit** `Server: /api/groceries routes`.

### Task 4: Board migration script

**Files:**
- Create: `dashboard/server/scripts/migrate-trello.mjs`
- Test: `dashboard/server/test/migrate-trello.test.js` (the pure planning function against the Task 1 fixture)

**Interfaces:**
- Produces: `export function planMigration(board): Step[]` (pure; steps like `{op:'createLabel',name}`, `{op:'moveCard',id,toList,label?}`, `{op:'addLabel',id,label}`, `{op:'archiveList',id}`), and a CLI: reads `TRELLO_*` from the environment, prints the plan, writes only with `--apply`.
- Category mapping (exact): Produce, Produce & Fresh → Produce; Bread & Bakery → Bakery; Dairy & Refrigerated → Dairy & Refrigerated; Meat, Meat & Seafood → Meat & Seafood; Pantry → Pantry; Snacks, Snacks & Pantry → Snacks; Spices, Spices & Seasoning → Spices & Seasoning; Household → Household. Running Low cards move to To Buy with `Low`; Need to Stock cards move to To Buy and get `Store: <Store: line>` when present. Descriptions are left alone. Idempotent: a second run plans nothing.

- [ ] **Step 1: Write failing tests:** every mapping row; Running Low gets `Low`; Need to Stock gets the store label; a card with an unknown `Category:` gets no label and is reported in a `warnings` array; running `planMigration` on an already-migrated board returns `[]`.
- [ ] **Step 2: Run;** expect FAIL.
- [ ] **Step 3: Implement** planning and the CLI applier.
- [ ] **Step 4: Run tests;** expect PASS.
- [ ] **Step 5: Commit** `Server: dry-run migration for the Trello board`.
- [ ] **Step 6: Dry run for the owner:** `set -a; source ~/.secrets; set +a; TRELLO_BOARD=R6QbjglY node scripts/migrate-trello.mjs`. Show the owner the output. Do **not** pass `--apply` until they approve.
- [ ] **Step 7: After approval,** run with `--apply`, then re-run without it and expect an empty plan.

### Task 5: Frame reads the real list

**Files:**
- Modify: `dashboard/js/live.js` (new `loadGroceries`, interval 60 s, `App.groceriesBusy` counter like `App.homeBusy`)
- Modify: `dashboard/js/data.js` (default `stores`, `catOrder` stay as the mock fallback; add `D.groceriesLive = false`, `D.groceriesOffline = false`)
- Modify: `dashboard/js/views/home.js` (`shopping()` already counts `!g.done`; confirm it works with the live items)

**Interfaces:**
- Consumes: `GET api/groceries` (Task 3).
- Produces: after the first success `D.groceries` = `res.groceries.items` (fields `id,name,cat,store,low,note,done,at`), `D.stores` = `[{id:name,name}]`, `D.catOrder = { all: categories.concat(['Other']), <storeId>: same }`, `D.groceriesLive = true`; on any later failure `D.groceriesOffline = true` and the last list stays; 503 at startup keeps mock. Also `App.groceriesWrite(path, body): Promise` (POST, applies the reply, rejects on failure) used by Task 6. Applying skips while `App.groceriesBusy > 0`, then emits `data` and calls `App.rerender()` only if the JSON changed.

- [ ] **Step 1: Implement** the loader mirroring `loadHome`/`applyHome`.
- [ ] **Step 2: Verify** with `npx vite --host` against a locally running server (`cd server && set -a; source ~/.secrets; set +a; TRELLO_BOARD=R6QbjglY BOM_LOCATION=r652455 node index.js`): the Home tile count matches To Buy on the board. Stop the server and expect the last list to stay.
- [ ] **Step 3: Commit** `Dashboard: load groceries from the Trello board`.

### Task 6: Shopping view writes back

**Files:**
- Modify: `dashboard/js/views/shopping.js`
- Modify: `dashboard/css/views/shopping.css` (Low tag, stale line)

**Interfaces:**
- Consumes: `App.groceriesWrite` and `D.groceriesLive`/`D.groceriesOffline` (Task 5).
- Behaviour when `D.groceriesLive`: ± quantity buttons are not rendered; each row shows a **Low** tag when `g.low` and a 56 px tap target to toggle it (`{low}`); check-off posts `{done:true}` after the existing 1.2 s pending delay with the existing undo toast (undo posts `{done:false}`); drawer lists items with `done` and `at` in the last 24 hours and *Add back* posts `{done:false}`; add posts `{name, cat, store}` with `store` = the active tab (none on All); *Clear checked* is hidden for live data. Store tabs come from `D.stores`. A "Couldn't reach Trello" line appears under the header when `D.groceriesOffline`. A failed write shows a toast and the next poll restores truth. Mock behaviour (qty, local clear) is unchanged when not live.
- Usuals tiles come from the Stocked items' names (newest first, up to 12) when live.

- [ ] **Step 1: Implement** the view changes keeping the granular DOM updates; every name/note through `App.esc()`.
- [ ] **Step 2: Verify locally** against a throwaway test board or after the Task 4 migration: tick, undo, add, Low toggle, store tab add; each shows on the Trello board. Confirm a card named `<b>&"x"` renders as text.
- [ ] **Step 3: Commit** `Shopping: tick, add and tag against the Trello board`.
- [ ] **Step 4: Ask the owner** to add `TRELLO_API_KEY`, `TRELLO_TOKEN`, `TRELLO_BOARD=R6QbjglY` to the Dokploy app environment, then push (pushing deploys) and check the frame: reload via the two-finger menu or the documented `am force-stop`/`am start` (ask before touching the frame), screenshot, `adb logcat -d | grep -E "HomeHQ|chromium"`.

### Task 7: Prompt for Hermes

**Files:**
- Create: `docs/hermes-trello-prompt.md`

- [ ] **Step 1: Write the prompt** against the finished board: board name and id; the lists and what each means; the exact label names (categories, `Low`, `Store: <name>`); add = card in To Buy with one category label (+ `Low` when "running low", + store label when a store is named); "bought/purchased" = move to Stocked; "ran out/low" on a Stocked item = move back to To Buy with `Low`; quantities go in the name; one card per item, no duplicates (check To Buy first); never create other labels or lists; Recipes untouched; use the `TRELLO_*` credentials. No secrets in the file.
- [ ] **Step 2: Commit** `Docs: prompt for Hermes to manage the grocery board`.
- [ ] **Step 3: Give the owner the prompt text** to paste into Hermes.
