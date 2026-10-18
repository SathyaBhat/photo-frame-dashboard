// Maps a Trello board (GET /boards/:id?lists=open&cards=open&labels=all) to the dashboard's grocery items.
// Lists and labels are found by name. Cards in To Buy and Stocked are used; every other list is ignored.

export var CATEGORIES = ['Fruits & Veggies', 'Bakery', 'Dairy & Refrigerated', 'Meat & Seafood', 'Pantry', 'Snacks', 'Spices & Seasoning', 'Household'];

var STOCKED_CAP = 60;
var STORE_PREFIX = 'Store: ';

// "🛒 To Buy" -> "to buy": drop leading non-letters (emoji, spaces), ignore case.
export function listKey(name) {
  return String(name || '').replace(/^[^A-Za-z]+/, '').trim().toLowerCase();
}

function findList(board, key) {
  var found = (board.lists || []).filter(function (l) { return !l.closed && listKey(l.name) === key; })[0];
  return found ? found.id : null;
}

export function resolveIds(board) {
  var labels = {};
  (board.labels || []).forEach(function (l) { if (l.name) labels[l.name] = l.id; });
  return { toBuy: findList(board, 'to buy'), stocked: findList(board, 'stocked'), labels: labels };
}

// Keeps what a person wrote; drops the lines the old Kanban bot and the migration added.
function noteFrom(desc) {
  return String(desc || '').split(/\r?\n/).filter(function (line) {
    return !/^\s*(Category:|Store:|Migrated from)/i.test(line);
  }).join('\n').trim();
}

function toItem(card, labelsById, done) {
  var cat = 'Other', store = '', low = false;
  (card.idLabels || []).forEach(function (id) {
    var name = labelsById[id];
    if (!name) return;
    if (name === 'Low') low = true;
    else if (name.indexOf(STORE_PREFIX) === 0) store = name.slice(STORE_PREFIX.length).trim();
    else if (CATEGORIES.indexOf(name) >= 0 && cat === 'Other') cat = name;
  });
  return { id: card.id, name: card.name, cat: cat, store: store, low: low, note: noteFrom(card.desc), done: done, at: card.dateLastActivity };
}

export function buildGroceries(input) {
  var board = input.board, ids = resolveIds(board);
  if (!ids.toBuy) throw new Error('no To Buy list');

  var labelsById = {}, stores = [];
  (board.labels || []).forEach(function (l) {
    labelsById[l.id] = l.name;
    if (l.name && l.name.indexOf(STORE_PREFIX) === 0 && l.name.slice(STORE_PREFIX.length).trim()) {
      stores.push({ id: l.id, name: l.name.slice(STORE_PREFIX.length).trim() });
    }
  });

  var open = (board.cards || []).filter(function (c) { return !c.closed; });
  var toBuy = open.filter(function (c) { return c.idList === ids.toBuy; })
    .map(function (c) { return toItem(c, labelsById, false); });
  var stocked = ids.stocked ? open.filter(function (c) { return c.idList === ids.stocked; })
    .map(function (c) { return toItem(c, labelsById, true); })
    .sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; })
    .slice(0, STOCKED_CAP) : [];

  return { items: toBuy.concat(stocked), stores: stores, categories: CATEGORIES.slice() };
}
