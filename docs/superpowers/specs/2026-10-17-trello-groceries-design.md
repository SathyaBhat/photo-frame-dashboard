# Grocery list from Trello

## Goal

Replace the mock grocery list on the Shopping view with the family's real list, which lives on a
Trello board ("Anavrin"). The frame shows what needs buying, lets the owner tick items off, add
items and tag them, and every change lands on the Trello board.

The board is also managed by Hermes, an agent the owner talks to ("add milk", "I bought the
chicken"). Hermes used to keep the list in markdown files; Trello is now the single source of
truth. The frame is a second way into the same list, so the board must stay simple enough for
Hermes to manage reliably. A prompt telling Hermes how to manage the board is a deliverable of
this work, written after the frame side works.

## Decisions

- **Source of truth:** the Trello board. The server talks to Trello; the frame only talks to the
  server. `TRELLO_API_KEY`, `TRELLO_TOKEN` and `TRELLO_BOARD` (`R6QbjglY`) are set in the Dokploy
  app environment, never committed and never sent to the browser. The token already has
  read/write access and does not expire.
- **Fallback:** without Trello credentials the routes answer 503 and the frame keeps its mock list,
  the same way calendar and Home Assistant are optional.
- **Lists collapse.** To Buy, Running Low and Need to Stock merge into one list, **To Buy**.
  **Stocked** stays and means "in the house". **Recipes** stays and the frame ignores it.
- **Tags are Trello labels.** Each card carries:
  - one **category** label (Fruits & Veggies, Bakery, Dairy & Refrigerated, Meat & Seafood, Pantry,
    Snacks, Spices & Seasoning, Household);
  - zero or one **store** label (for example "Tong Li"), which drives the store tabs;
  - optionally the **Low** label, which replaces the old Running Low list. The frame shows it as a
    small tag on the row;
  - optionally the **Usual** label: something the household buys regularly. Those cards, in To Buy
    or Stocked, are the Shopping view's usuals tiles.
- **Frame actions write back to Trello:**
  - tick off: move the card from To Buy to Stocked;
  - add: create a card in To Buy with a category label (the frame's existing catalog guess, or
    "Other" = no category label) and the active store tab's label;
  - tag: add or remove the Low label, change category or store label (the API can also add or remove
    Usual; the frame's tiles only read it).
  - Un-tick (the "Got it" drawer's *Add back*) moves the card back to To Buy.
- **Quantity:** Trello has no quantity, so it stays in the card name where the owner already puts
  it ("Mandarins 2kg", "Dark Choc Block (x2)"). The frame's ± quantity buttons go away for Trello
  cards.
- **Notes:** the card description is the note shown under the name, minus the legacy
  `Category:` / `Migrated from ...` lines.
- **Latency:** the frame updates its screen immediately and writes to Trello in the background. A
  failed write is shown in a toast and the change is reverted on the next refresh.
- **Freshness:** the server caches the board for about 30 seconds so Hermes' changes show up
  quickly without the frame's polling becoming one Trello call per request. Frame writes
  invalidate the cache.

## Details settled during review (the writer's calls)

- **Telling labels apart:** the eight category names, `Low` and `Usual` are fixed and matched by name.
  Store labels are the ones named `Store: <name>` (the tab shows `<name>`). Any other label is
  ignored, so a stray label never becomes a tab. Hermes must use these exact names.
- **Finding lists and labels:** by name (`To Buy`, `Stocked`) on startup and on each refresh. If
  `To Buy` is missing the route answers 503 with a clear log line; a missing label is created on
  first use.
- **Store tabs:** `All` stays, plus one tab per store label in use. A card without a store label
  shows only on `All`. Adding from `All` creates a card with no store label; adding from a store
  tab gives it that store's label. `catOrder` is the same for every tab.
- **Stocked:** the server returns every Stocked card labelled `Usual` plus the most recently active
  others (Trello's `dateLastActivity`) up to 60 in all (more only when usuals alone exceed 60),
  newest first; a usual is never dropped by the cap. The "Got it" drawer shows the ones moved in
  the last 24 hours. Everything in the drawer can be added back.
- **Usuals:** the tiles are the cards labelled `Usual`, in To Buy or Stocked, sorted by name, one
  tile per name (ignoring case; the open card wins). A tile shows "On list" when any card of that
  name is in To Buy, and a tap then only gives feedback; tapping a Stocked one moves that card
  back to To Buy with its labels (no new card). With no usuals the panel says how to add one.
  `Usual` is independent of the list a card is in and of `Low`; the owner or Hermes sets it in
  Trello. Hermes moves a Stocked card back rather than creating a second one with the same name.
- **Fields Trello can't supply:** `qty` is dropped for Trello cards (the quantity is in the name).
  The mock list, with its quantity buttons, is only used when the server answers 503 at startup
  because Trello is not configured.
- **Offline or stale:** once real data has been shown, the frame keeps the last real list on any
  failure and never falls back to mock. A small "Couldn't reach Trello" line appears under the
  header when the response is `stale` or a request fails, and clears on the next good refresh.
- **Concurrent edits (Hermes and the frame):** writes are idempotent. Ticking a card already in
  Stocked, or tagging one that already has the tag, is a success. A 404 (card archived) is silent
  and triggers a refresh.
- **Reads:** one `GET /boards/:id` call with `cards`, `labels` and `lists` expanded. Frame writes
  invalidate the cache and the next read refetches; at one frame this is far below Trello's
  100 requests per 10 seconds.
- **Migration:** a committed script, `dashboard/server/scripts/migrate-trello.mjs`, that reads
  `TRELLO_*` from the environment (locally from `~/.secrets`), defaults to a dry run that prints
  what it would do, and only writes with `--apply`. Store labels are named `Store: <name as
  written, trimmed>`; cards with no `Store:` line get none. Running Low cards keep whatever store
  they have (none today).

## One-off board migration

Run once, with the owner shown the plan first (dry run output) and approving before it writes:

1. Create the category labels and the Low label.
2. Move cards from Running Low into To Buy and add Low to them; move Need to Stock into To Buy and
   create a store label from its `Store:` line.
3. Label every card in To Buy and Stocked from its `Category:` line, using this mapping:
   Produce, Produce & Fresh → Fruits & Veggies; Bread & Bakery → Bakery; Dairy & Refrigerated → Dairy &
   Refrigerated; Meat, Meat & Seafood → Meat & Seafood; Pantry → Pantry; Snacks, Snacks & Pantry →
   Snacks; Spices, Spices & Seasoning → Spices & Seasoning; Household → Household. Then names matching cordial, Pepsi or a Sodastream
   mix/syrup/flavour move to Pantry (Sodastream gas stays Household).
4. Archive the now-empty lists. Leave the `Category:` lines in descriptions for now so Hermes
   keeps working until it has the new prompt; the frame ignores them.

## Server (`dashboard/server`)

- `trello-map.js`, in the style of `weather-map.js`: pure functions from Trello's JSON (lists,
  labels, cards) to the frame's item shape
  `{ id, name, cat, store, low, usual, note, done }`, plus the reverse for writes. Testable without the
  network.
- `trello-service.js`: the cached reader (same stale-copy behaviour as `calendar-service.js`) and
  the write calls. Credentials are query parameters on Trello's API, so errors are rethrown
  without the URL, as `fetchFeed` does.
- Routes, following the Home Assistant command route's pattern:
  - `GET /api/groceries` → `{ data: { items, stores, categories }, stale, at }`, with items from
    To Buy and a bounded number from Stocked (for the drawer and the usuals).
  - `POST /api/groceries` add; `POST /api/groceries/:id` with exactly one of `{ done }`, `{ low }`,
    `{ usual }`, `{ cat }` or `{ store }`. Validate input; ids are checked against the board's own cards.
- `docker-compose.yml`: `TRELLO_API_KEY`, `TRELLO_TOKEN`, `TRELLO_BOARD`, all `:-` optional.
- Tests with fixture JSON: mapping, legacy description cleanup, unlabelled cards, and the 503 and
  stale paths.

## Dashboard (`dashboard/`)

- `js/live.js`: fetch `/api/groceries` at startup and every minute, replace
  `App.state.groceries`, `stores` and `catOrder`, and rerender the Shopping view and the Home
  tile. Skip the replace while a write is in flight, so a poll cannot undo a tap.
- `js/views/shopping.js`: keep the layout and the granular DOM updates. Store tabs come from
  the store labels; categories from the category labels; a **Low** tag on rows and a long-press or
  second tap target to toggle it that is at least about 56 px. Check, add and tag call the new
  routes. The usuals tiles are the cards labelled `Usual`.
- `js/views/home.js`: the Shopping tile already counts open items; it should count To Buy.
- Constraints as for every view: no 4- or 8-digit hex colours, touch-sized targets, no heavy
  animation, Chromium 106.

## Out of scope

Recipes; quantities as numbers; Trello webhooks (polling is enough); Hermes itself, apart from
the prompt; the "Asian shopping" reference photo (a local file path on Hermes' machine).

## Order of work

1. Server reader and mapping, with the frame still on mock data.
2. Board migration (after the owner approves the dry run).
3. Frame reads the real list.
4. Frame writes: tick, add, tag.
5. The Hermes prompt, written against the finished board.
