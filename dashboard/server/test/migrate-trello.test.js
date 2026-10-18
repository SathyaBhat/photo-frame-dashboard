import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planMigration } from '../scripts/migrate-trello.mjs';

var fixture = JSON.parse(readFileSync(new URL('./fixtures/trello-board.json', import.meta.url), 'utf8'));
function clone(x) { return JSON.parse(JSON.stringify(x)); }

var MAPPING = [
  ['Produce', 'Fruits & Veggies'], ['Produce & Fresh', 'Fruits & Veggies'], ['Bread & Bakery', 'Bakery'],
  ['Dairy & Refrigerated', 'Dairy & Refrigerated'], ['Meat', 'Meat & Seafood'], ['Meat & Seafood', 'Meat & Seafood'],
  ['Pantry', 'Pantry'], ['Snacks', 'Snacks'], ['Snacks & Pantry', 'Snacks'], ['Spices', 'Spices & Seasoning'],
  ['Spices & Seasoning', 'Spices & Seasoning'], ['Household', 'Household']
];

// A board with no labels on cards, so every mapped category needs an addLabel.
function boardWith(cards) {
  var b = clone(fixture);
  b.lists = b.lists.filter(function (l) { return !/running low|need to stock/i.test(l.name); });
  b.cards = cards.map(function (c, i) {
    return Object.assign({ id: 'card' + i, idList: 'a10000000000000000000001', closed: false, idLabels: [], desc: '' }, c);
  });
  return b;
}

test('every Category: line maps to its label', function () {
  MAPPING.forEach(function (row) {
    var plan = planMigration(boardWith([{ name: 'X', desc: 'Category: ' + row[0] }]));
    assert.deepEqual(plan.steps.filter(function (s) { return s.op === 'addLabel'; }),
      [{ op: 'addLabel', id: 'card0', name: 'X', label: row[1] }], row[0]);
    assert.deepEqual(plan.warnings, []);
  });
});

test('Category: matching ignores case and padding', function () {
  var plan = planMigration(boardWith([{ name: 'X', desc: 'note\n  category:   bread & bakery  ' }]));
  assert.equal(plan.steps[0].label, 'Bakery');
});

test('unknown or missing category gives no label and a warning with the card name only', function () {
  var plan = planMigration(boardWith([{ name: 'Mystery', desc: 'Category: Gadgets' }, { name: 'Blank' }]));
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.warnings.length, 2);
  assert.ok(plan.warnings[0].indexOf('Mystery') >= 0);
  assert.ok(plan.warnings[1].indexOf('Blank') >= 0);
});

test('Running Low cards move to To Buy and get Low; the list is archived', function () {
  var plan = planMigration(fixture);
  var butter = 'c30000000000000000000033';
  assert.ok(plan.steps.some(function (s) { return s.op === 'moveCard' && s.id === butter && s.toList === 'a10000000000000000000001'; }));
  assert.ok(plan.steps.some(function (s) { return s.op === 'addLabel' && s.id === butter && s.label === 'Low'; }));
  assert.ok(plan.steps.some(function (s) { return s.op === 'archiveList' && s.id === 'a10000000000000000000003'; }));
});

test('Need to Stock cards move and get the Store: label from their Store: line', function () {
  var plan = planMigration(fixture);
  var tahini = 'c30000000000000000000035';
  assert.ok(plan.steps.some(function (s) { return s.op === 'moveCard' && s.id === tahini; }));
  assert.ok(plan.steps.some(function (s) { return s.op === 'addLabel' && s.id === tahini && s.label === 'Store: Blacktown Tong Li'; }));
  assert.ok(plan.steps.some(function (s) { return s.op === 'createLabel' && s.name === 'Store: Blacktown Tong Li'; }));
  assert.ok(plan.steps.some(function (s) { return s.op === 'archiveList' && s.id === 'a10000000000000000000004'; }));
});

test('Stocked cards are labelled but not moved; Recipes, To Buy and Stocked are never archived', function () {
  var b = clone(fixture);
  b.cards.push({ id: 'st1', idList: 'a10000000000000000000002', closed: false, idLabels: [], name: 'Salt', desc: 'Category: Spices' });
  var plan = planMigration(b);
  assert.ok(plan.steps.some(function (s) { return s.op === 'addLabel' && s.id === 'st1' && s.label === 'Spices & Seasoning'; }));
  assert.ok(!plan.steps.some(function (s) { return s.op === 'moveCard' && s.id === 'st1'; }));
  var archived = plan.steps.filter(function (s) { return s.op === 'archiveList'; }).map(function (s) { return s.id; }).sort();
  assert.deepEqual(archived, ['a10000000000000000000003', 'a10000000000000000000004']);
});

test('labels are created first and once; a card that has the label is skipped', function () {
  var plan = planMigration(boardWith([
    { name: 'A', desc: 'Category: Pantry' }, { name: 'B', desc: 'Category: Pantry' },
    { name: 'C', desc: 'Category: Pantry', idLabels: ['b20000000000000000000010'] }
  ]));
  assert.deepEqual(plan.steps.map(function (s) { return s.op; }), ['addLabel', 'addLabel']);
  var b = boardWith([{ name: 'A', desc: 'Category: Pantry' }]);
  b.labels = b.labels.filter(function (l) { return l.name !== 'Pantry'; });
  var p = planMigration(b);
  assert.deepEqual(p.steps.map(function (s) { return s.op; }), ['createLabel', 'addLabel']);
});

test('an already-migrated board plans nothing', function () {
  var b = clone(fixture);
  b.lists = b.lists.filter(function (l) { return /to buy|stocked|recipes/i.test(l.name); });
  b.cards = b.cards.filter(function (c) { return c.idList !== 'a10000000000000000000003' && c.idList !== 'a10000000000000000000004'; });
  b.cards.forEach(function (c) { if (c.name === 'Rice 5kg') c.idLabels.push('b20000000000000000000011'); });
  assert.deepEqual(planMigration(b).steps, []);
});

// Resume states after a partial --apply: adds come before moves, archives last.
function ops(plan) { return plan.steps.map(function (s) { return s.op; }); }

test('plan order is create labels, adds, moves, archives', function () {
  var order = { createLabel: 0, addLabel: 1, moveCard: 2, archiveList: 3 };
  var o = ops(planMigration(fixture)).map(function (x) { return order[x]; });
  assert.deepEqual(o, o.slice().sort());
});

test('labels added, moves pending: only the moves and archives remain', function () {
  var b = clone(fixture);
  var low = 'b20000000000000000000014';
  b.cards = b.cards.filter(function (c) { return c.idList !== 'a10000000000000000000004'; });
  b.lists = b.lists.filter(function (l) { return l.id !== 'a10000000000000000000004'; });
  b.cards.forEach(function (c) {
    if (c.idList === 'a10000000000000000000003') c.idLabels = (c.idLabels || []).concat([low]);
    if (c.name === 'Rice 5kg') c.idLabels.push('b20000000000000000000011');
  });
  var p = planMigration(b);
  assert.deepEqual(ops(p), ['moveCard', 'moveCard', 'archiveList']);
  assert.deepEqual(p.steps.filter(function (s) { return s.op === 'moveCard'; }).map(function (s) { return s.id; }).sort(),
    ['c30000000000000000000033', 'c30000000000000000000034']);
});

test('adds and moves done, archive pending: only the archive remains', function () {
  var b = clone(fixture);
  b.cards.forEach(function (c) {
    if (c.idList === 'a10000000000000000000003' || c.idList === 'a10000000000000000000004') c.idList = 'a10000000000000000000001';
    if (c.name === 'Rice 5kg') c.idLabels.push('b20000000000000000000011');
  });
  var p = planMigration(b);
  assert.deepEqual(p.steps.map(function (s) { return s.op + ':' + s.id; }).sort(),
    ['archiveList:a10000000000000000000003', 'archiveList:a10000000000000000000004']);
});

function labelFor(name, category) {
  var plan = planMigration(boardWith([{ name: name, desc: 'Category: ' + category }]));
  var adds = plan.steps.filter(function (s) { return s.op === 'addLabel'; });
  assert.equal(adds.length, 1, name);
  return adds[0].label;
}

test('fruit names are not overridden and stay in Fruits & Veggies; other names keep their category', function () {
  assert.equal(labelFor('Hass Avocado', 'Produce'), 'Fruits & Veggies');
  assert.equal(labelFor('Lemon Juice', 'Pantry'), 'Pantry');
  assert.equal(labelFor('Snacking Carrots 1kg', 'Snacks'), 'Snacks');
});

test('name overrides: drinks and mixes go to Pantry, Sodastream gas stays Household', function () {
  assert.equal(labelFor("Cottee's Cordial Orange Zero Sugar 1L", 'Snacks'), 'Pantry');
  assert.equal(labelFor('Sodastream Pepsi Max Soda Mix 440ml', 'Household'), 'Pantry');
  assert.equal(labelFor('Pepsi Max Vanilla 440ml', 'Snacks'), 'Pantry');
  assert.equal(labelFor('Sodastream Mix / Orange Cordial', 'Household'), 'Pantry');
  assert.equal(labelFor('Sodastream Gas Cylinder', 'Household'), 'Household');
});

test('name overrides never change a label already on the card', function () {
  var b = boardWith([{ name: 'Lemon', desc: '', idLabels: [] }]);
  assert.deepEqual(planMigration(b).steps, []);
});

test('cards without a Category: line use the owner fallback table', function () {
  [['Coffee Beans 1kg (Giovanni Carlo Smooth)', 'Pantry'], ['Spicy Italian Sausage', 'Meat & Seafood'],
    ['Huang Fei Hong Spicy Peanuts', 'Snacks'], ['Lime Juice', 'Pantry'], ['Low GI White Loaf 330g', 'Bakery'],
    ['Haidilao Spicy Cumin BBQ Seasoning 40g', 'Spices & Seasoning']].forEach(function (row) {
    var plan = planMigration(boardWith([{ name: ' ' + row[0].toUpperCase() + ' ', desc: 'just a note' }]));
    assert.deepEqual(plan.steps.filter(function (s) { return s.op === 'addLabel'; }).map(function (s) { return s.label; }), [row[1]], row[0]);
    assert.deepEqual(plan.warnings, []);
  });
});

test('the fallback table never beats a Category: line or an existing label', function () {
  assert.equal(labelFor('Lime Juice', 'Snacks'), 'Snacks');
  var plan = planMigration(boardWith([{ name: 'Lime Juice', desc: 'Category: Gadgets' }]));
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.warnings.length, 1);
  var b = boardWith([{ name: 'Lime Juice', idLabels: ['lab-bakery'] }]);
  b.labels.push({ id: 'lab-bakery', name: 'Bakery' });
  assert.deepEqual(planMigration(b), { steps: [], warnings: [] });
});

test('fallback cards in Running Low get the category before the move and Low', function () {
  var b = clone(fixture);
  var run = b.lists.filter(function (l) { return /running low/i.test(l.name); })[0];
  b.cards = [{ id: 'z1', name: 'Lime Juice', idList: run.id, closed: false, idLabels: [], desc: '' }];
  var ops = planMigration(b).steps.map(function (s) { return s.op + ':' + (s.label || s.name); });
  assert.ok(ops.indexOf('addLabel:Pantry') >= 0 && ops.indexOf('addLabel:Pantry') < ops.indexOf('moveCard:Lime Juice'), ops.join('|'));
  assert.ok(ops.indexOf('addLabel:Low') >= 0);
});
