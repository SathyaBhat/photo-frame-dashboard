// Maps a Trello board (GET /boards/:id?lists=open&cards=open&labels=all) to the dashboard's grocery items.
// Lists and labels are found by name. Cards in To Buy and Stocked are used; every other list is ignored.

export var CATEGORIES = ['Fruits & Veggies', 'Bakery', 'Dairy & Refrigerated', 'Meat & Seafood', 'Pantry', 'Snacks', 'Spices & Seasoning', 'Household'];

var STOCKED_CAP = 60;
var STORE_PREFIX = 'Store: ';
export var USUAL = 'Usual';

// The usual label may be named Usual or Usuals, any case, with stray spaces around it.
export function isUsualName(name) {
  var n = String(name || '').trim().toLowerCase();
  return n === 'usual' || n === 'usuals';
}

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
  return {
    toBuy: findList(board, 'to buy'), stocked: findList(board, 'stocked'), labels: labels,
    chores: findList(board, 'chores'), choresDone: findList(board, 'chores done')
  };
}

// Keeps what a person wrote; drops the lines the old Kanban bot and the migration added.
function noteFrom(desc) {
  return String(desc || '').split(/\r?\n/).filter(function (line) {
    return !/^\s*(Category:|Store:|Migrated from)/i.test(line);
  }).join('\n').trim();
}

function toItem(card, labelsById, done) {
  var cat = 'Other', store = '', low = false, usual = false;
  (card.idLabels || []).forEach(function (id) {
    var name = labelsById[id];
    if (!name) return;
    if (name === 'Low') low = true;
    else if (isUsualName(name)) usual = true;
    else if (name.indexOf(STORE_PREFIX) === 0) store = name.slice(STORE_PREFIX.length).trim();
    else if (CATEGORIES.indexOf(name) >= 0 && cat === 'Other') cat = name;
  });
  return { id: card.id, name: card.name, cat: cat, store: store, low: low, usual: usual, note: noteFrom(card.desc), done: done, at: card.dateLastActivity };
}

// Newest first, at most STOCKED_CAP, except that every usual stays (usuals count toward the cap first).
function capStocked(sorted) {
  var room = STOCKED_CAP - sorted.filter(function (i) { return i.usual; }).length;
  return sorted.filter(function (i) { return i.usual || room-- > 0; });
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
  var stocked = ids.stocked ? capStocked(open.filter(function (c) { return c.idList === ids.stocked; })
    .map(function (c) { return toItem(c, labelsById, true); })
    .sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; })) : [];

  return { items: toBuy.concat(stocked), stores: stores, categories: CATEGORIES.slice() };
}

// Chores: cards in the Chores list are open, cards in Chores done are done. The assignee is the first of the
// card's members that belongs to the board; a card nobody (known) is on is for either of them.
export function buildChores(board) {
  var ids = resolveIds(board);
  if (!ids.chores) throw new Error('no Chores list');
  var members = (board.members || []).map(function (m) {
    var full = String(m.fullName || '').trim();
    return { id: m.id, name: full.split(/\s+/)[0] || full };
  });
  var known = {};
  members.forEach(function (m) { known[m.id] = true; });
  var labelsById = {};
  (board.labels || []).forEach(function (l) { labelsById[l.id] = l.name; });

  function toChore(card, done) {
    var who = (card.idMembers || []).filter(function (id) { return known[id]; })[0] || '';
    var usual = (card.idLabels || []).some(function (id) { return isUsualName(labelsById[id]); });
    return { id: card.id, name: card.name, who: who, usual: usual, done: done, at: card.dateLastActivity };
  }

  var open = (board.cards || []).filter(function (c) { return !c.closed; });
  var todo = open.filter(function (c) { return c.idList === ids.chores; }).map(function (c) { return toChore(c, false); });
  var done = ids.choresDone ? capStocked(open.filter(function (c) { return c.idList === ids.choresDone; })
    .map(function (c) { return toChore(c, true); })
    .sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; })) : [];
  return { items: todo.concat(done), members: members };
}
