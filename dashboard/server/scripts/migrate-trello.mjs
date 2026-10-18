// One-off migration of the Grocery Kanban board to the labels-and-two-lists layout.
// Dry run by default; writes only with --apply. Usage (from dashboard/server):
//   TRELLO_API_KEY=... TRELLO_TOKEN=... TRELLO_BOARD=<id> node scripts/migrate-trello.mjs [--apply]
import { pathToFileURL } from 'node:url';
import { listKey, resolveIds, CATEGORIES } from '../trello-map.js';
import { defaultFetchJSON } from '../trello-service.js';

var STORE_PREFIX = 'Store: ';

// Old Category: values (lower case) -> label.
var MAPPING = {
  'produce': 'Produce', 'produce & fresh': 'Produce',
  'bread & bakery': 'Bakery',
  'dairy & refrigerated': 'Dairy & Refrigerated',
  'meat': 'Meat & Seafood', 'meat & seafood': 'Meat & Seafood',
  'pantry': 'Pantry',
  'snacks': 'Snacks', 'snacks & pantry': 'Snacks',
  'spices': 'Spices & Seasoning', 'spices & seasoning': 'Spices & Seasoning',
  'household': 'Household'
};

function descLine(desc, field) {
  var re = new RegExp('^\\s*' + field + ':(.*)$', 'i');
  var lines = String(desc || '').split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var m = re.exec(lines[i]);
    if (m) return m[1].trim();
  }
  return '';
}

function findListByKey(board, key) {
  return (board.lists || []).filter(function (l) { return !l.closed && listKey(l.name) === key; })[0] || null;
}

export function planMigration(board) {
  var ids = resolveIds(board);
  var haveLabel = {}, idByName = ids.labels;
  Object.keys(idByName).forEach(function (n) { haveLabel[n] = true; });
  var running = findListByKey(board, 'running low'), need = findListByKey(board, 'need to stock');
  var toBuy = findListByKey(board, 'to buy'), stocked = findListByKey(board, 'stocked');

  var wanted = [];       // label names to create, in first-use order
  var moves = [], adds = [], warnings = [];

  function want(name) { if (!haveLabel[name] && wanted.indexOf(name) < 0) wanted.push(name); }
  function hasLabel(card, name) { return !!idByName[name] && (card.idLabels || []).indexOf(idByName[name]) >= 0; }
  function addIfMissing(card, name) {
    if (hasLabel(card, name)) return;
    want(name);
    adds.push({ op: 'addLabel', id: card.id, name: card.name, label: name });
  }

  var open = (board.cards || []).filter(function (c) { return !c.closed; });
  var unmovable = false;
  [toBuy, stocked, running, need].forEach(function (list) {
    if (!list) return;
    open.filter(function (c) { return c.idList === list.id; }).forEach(function (card) {
      var raw = descLine(card.desc, 'Category');
      var cat = MAPPING[raw.toLowerCase()];
      if (cat) addIfMissing(card, cat);
      else if (!(card.idLabels || []).some(function (id) { return CATEGORIES.some(function (c) { return idByName[c] === id; }); })) {
        warnings.push('"' + card.name + '": ' + (raw ? 'unknown Category line, no category label' : 'no Category line, no category label'));
      }
      if (list === running || list === need) {
        if (toBuy) moves.push({ op: 'moveCard', id: card.id, name: card.name, toList: toBuy.id });
        else unmovable = true;
      }
      if (list === running) addIfMissing(card, 'Low');
      if (list === need) {
        var store = descLine(card.desc, 'Store');
        if (store) addIfMissing(card, STORE_PREFIX + store);
      }
    });
  });

  var archives = [];
  if (toBuy && !unmovable) {
    [running, need].forEach(function (l) { if (l) archives.push({ op: 'archiveList', id: l.id, name: l.name }); });
  }
  var steps = wanted.map(function (n) { return { op: 'createLabel', name: n }; })
    .concat(adds, moves, archives);
  return { steps: steps, warnings: warnings };
}

function describe(s) {
  if (s.op === 'createLabel') return 'create label "' + s.name + '"';
  if (s.op === 'moveCard') return 'move "' + s.name + '" to To Buy';
  if (s.op === 'addLabel') return 'label "' + s.name + '" with "' + s.label + '"';
  return 'archive list "' + s.name + '"';
}

async function apply(steps, board, api) {
  var labelIds = Object.assign({}, resolveIds(board).labels);
  for (var i = 0; i < steps.length; i++) {
    var s = steps[i];
    console.log('[' + (i + 1) + '/' + steps.length + '] ' + describe(s));
    try {
      if (s.op === 'createLabel') {
        var made = await api('POST', '/labels', { name: s.name, color: 'null', idBoard: board.id });
        labelIds[s.name] = made.id;
      } else if (s.op === 'moveCard') {
        await api('PUT', '/cards/' + s.id, { idList: s.toList, pos: 'top' });
      } else if (s.op === 'addLabel') {
        await api('POST', '/cards/' + s.id + '/idLabels', { value: labelIds[s.label] });
      } else {
        await api('PUT', '/lists/' + s.id + '/closed', { value: 'true' });
      }
    } catch (e) {
      throw new Error('step ' + (i + 1) + ' failed (' + describe(s) + '): ' + e.message + '. Re-run to see what is left.');
    }
  }
}

async function main() {
  var env = process.env, doApply = process.argv.indexOf('--apply') >= 0;
  if (!env.TRELLO_API_KEY || !env.TRELLO_TOKEN || !env.TRELLO_BOARD) {
    console.error('Set TRELLO_API_KEY, TRELLO_TOKEN and TRELLO_BOARD.');
    process.exit(2);
  }
  var api = defaultFetchJSON(env.TRELLO_API_KEY, env.TRELLO_TOKEN);
  var board = await api('GET', '/boards/' + encodeURIComponent(env.TRELLO_BOARD), { lists: 'open', cards: 'open', labels: 'all' });
  var plan = planMigration(board);

  var titles = { createLabel: 'Create labels', addLabel: 'Add labels', moveCard: 'Move cards', archiveList: 'Archive lists' };
  Object.keys(titles).forEach(function (op) {
    var group = plan.steps.filter(function (s) { return s.op === op; });
    if (!group.length) return;
    console.log('\n' + titles[op] + ' (' + group.length + ')');
    group.forEach(function (s) {
      console.log('  ' + (op === 'createLabel' ? s.name : op === 'archiveList' ? s.name : op === 'moveCard' ? s.name : s.name + ' -> ' + s.label));
    });
  });
  if (plan.warnings.length) {
    console.log('\nWarnings (' + plan.warnings.length + ')');
    plan.warnings.forEach(function (w) { console.log('  ' + w); });
  }
  console.log('\n' + plan.steps.length + ' step(s) planned, ' + plan.warnings.length + ' warning(s).');
  if (!doApply) {
    console.log(plan.steps.length ? 'Dry run: nothing written. Re-run with --apply to write.' : 'Nothing to do.');
    return;
  }
  if (!plan.steps.length) return;
  console.log('');
  await apply(plan.steps, board, api);
  console.log('Done. Re-run without --apply to confirm the plan is empty.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(function (e) { console.error(e.message); process.exit(1); });
}
