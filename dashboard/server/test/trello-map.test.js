import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATEGORIES, buildGroceries, resolveIds, listKey } from '../trello-map.js';

function board() { return JSON.parse(readFileSync(new URL('./fixtures/trello-board.json', import.meta.url))); }
var NOW = new Date('2026-10-18T03:00:00Z');
function build(b) { return buildGroceries({ board: b || board(), now: NOW }); }
function byName(r, name) { return r.items.filter(function (i) { return i.name === name; })[0]; }

test('CATEGORIES lists the eight names in display order', function () {
  assert.deepEqual(CATEGORIES, ['Fruits & Veggies', 'Bakery', 'Dairy & Refrigerated', 'Meat & Seafood', 'Pantry', 'Snacks', 'Spices & Seasoning', 'Household']);
});

test('listKey drops leading emoji and whitespace and ignores case', function () {
  assert.equal(listKey('🛒 To Buy'), 'to buy');
  assert.equal(listKey('⚠️ Running Low'), 'running low');
  assert.equal(listKey('  stocked'), 'stocked');
  assert.equal(listKey('Recipes'), 'recipes');
});

test('To Buy cards are not done, Stocked cards are done', function () {
  var r = build();
  assert.equal(byName(r, 'Bananas').done, false);
  assert.equal(byName(r, 'Eggs').done, true);
});

test('item carries id, name and the activity date as ISO', function () {
  var i = byName(build(), 'Bananas');
  assert.match(i.id, /^[0-9a-f]{24}$/);
  assert.equal(i.at, '2026-10-10T08:00:00.000Z');
});

test('Stocked is newest first and capped at 60', function () {
  var b = board(), stocked = b.lists.filter(function (l) { return /stocked/i.test(l.name); })[0].id;
  var r = build(b);
  var done = r.items.filter(function (i) { return i.done; }).map(function (i) { return i.name; });
  assert.deepEqual(done, ['Bread', 'Eggs', 'Cumin']);
  for (var k = 0; k < 70; k++) {
    b.cards.push({ id: ('f' + k).padStart(24, '0'), name: 'Bulk ' + k, desc: '', idList: stocked, idLabels: [], closed: false, dateLastActivity: new Date(Date.UTC(2026, 0, 1, 0, k)).toISOString() });
  }
  var big = build(b).items.filter(function (i) { return i.done; });
  assert.equal(big.length, 60);
  assert.equal(big[0].name, 'Bread');
  for (var j = 1; j < big.length; j++) assert.ok(big[j - 1].at >= big[j].at);
});

test('Low label sets low and is not a category', function () {
  var i = byName(build(), 'Milk 2L');
  assert.equal(i.low, true);
  assert.equal(i.cat, 'Dairy & Refrigerated');
  assert.equal(byName(build(), 'Bananas').low, false);
});

test('Store label sets store, and stores lists each once', function () {
  var r = build();
  assert.equal(byName(r, 'Chicken thighs').store, 'Tong Li');
  assert.equal(byName(r, 'Bananas').store, '');
  assert.deepEqual(r.stores.map(function (s) { return s.name; }).sort(), ['Aldi', 'Tong Li']);
  assert.equal(r.stores.length, 2);
  r.stores.forEach(function (s) { assert.match(s.id, /^[0-9a-f]{24}$/); });
});

test('stray labels are ignored', function () {
  var i = byName(build(), 'Dish soap');
  assert.equal(i.cat, 'Household');
  assert.equal(i.store, '');
  assert.equal(build().stores.some(function (s) { return /birthday/i.test(s.name); }), false);
});

test('unlabelled card is Other', function () {
  assert.equal(byName(build(), 'Batteries AA').cat, 'Other');
});

test('categories echoes CATEGORIES', function () {
  assert.deepEqual(build().categories, CATEGORIES);
});

test('note strips Category, Store and Migrated lines and keeps the rest', function () {
  var r = build();
  assert.equal(byName(r, 'Rice 5kg').note, 'Jasmine, the long grain one');
  assert.equal(byName(r, 'Rice 5kg').cat, 'Pantry');
  assert.equal(byName(r, 'Pasta').note, '');
  assert.equal(byName(r, 'Tinned tomatoes').note, 'Brand matters');
  assert.equal(byName(r, 'Bananas').note, '');
});

test('the Category line does not decide cat', function () {
  var b = board();
  b.cards.forEach(function (c) { if (c.name === 'Pasta') c.idLabels = []; });
  assert.equal(byName(build(b), 'Pasta').cat, 'Other');
});

test('archived cards are dropped', function () {
  var r = build();
  assert.equal(byName(r, 'Old sauce'), undefined);
  assert.equal(byName(r, 'Archived stocked'), undefined);
});

test('Running Low, Need to Stock and Recipes cards never appear', function () {
  var names = build().items.map(function (i) { return i.name; });
  ['Butter', 'Flour', 'Tahini', 'Fish sauce', 'Pad Thai', 'Dal'].forEach(function (n) { assert.ok(names.indexOf(n) < 0, n); });
});

test('names pass through unescaped', function () {
  assert.ok(byName(build(), '<b>Tom & "Jerry"</b> treats'));
});

test('missing To Buy list throws', function () {
  var b = board();
  b.lists = b.lists.filter(function (l) { return !/to buy/i.test(l.name); });
  assert.throws(function () { build(b); }, /no To Buy list/);
});

test('a closed To Buy list counts as missing', function () {
  var b = board();
  b.lists.forEach(function (l) { if (/to buy/i.test(l.name)) l.closed = true; });
  assert.throws(function () { build(b); }, /no To Buy list/);
});

test('resolveIds finds lists and labels by name', function () {
  var b = board(), ids = resolveIds(b);
  assert.equal(ids.toBuy, b.lists[0].id);
  assert.equal(ids.stocked, b.lists[1].id);
  var low = b.labels.filter(function (l) { return l.name === 'Low'; })[0].id;
  assert.equal(ids.labels.Low, low);
  assert.ok(ids.labels['Store: Tong Li']);
  assert.ok(ids.labels['Fruits & Veggies']);
});

test('resolveIds leaves Stocked null when missing', function () {
  var b = board();
  b.lists = b.lists.filter(function (l) { return !/stocked/i.test(l.name); });
  assert.equal(resolveIds(b).stocked, null);
});
