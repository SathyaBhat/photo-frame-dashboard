// Reads the grocery board through a short cache and writes card changes back to Trello.
import { buildGroceries, buildChores, resolveIds, isUsualName, CATEGORIES, USUAL } from './trello-map.js';
import { BadRequest } from './ha-map.js';

export { BadRequest };
export class NotFound extends Error {}

var API = 'https://api.trello.com/1';
var STORE_PREFIX = 'Store: ';

// Credentials travel as query params and fetch's own errors can quote the URL, so every failure is
// rethrown with a fixed message.
export function defaultFetchJSON(key, token) {
  return async function (method, path, query) {
    var params = new URLSearchParams(query || {});
    params.set('key', key);
    params.set('token', token);
    var res;
    try {
      res = await fetch(API + path + '?' + params.toString(), { method: method, headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    } catch (e) {
      throw new Error('trello unreachable');
    }
    if (res.status === 404) throw new NotFound('trello -> HTTP 404');
    if (!res.ok) throw new Error('trello -> HTTP ' + res.status);
    try {
      return await res.json();
    } catch (e) {
      throw new Error('trello sent an unreadable response');
    }
  };
}

function checkCategory(cat) {
  if (CATEGORIES.indexOf(cat) < 0) throw new BadRequest('unknown category');
}

function checkStore(store) {
  if (typeof store !== 'string' || store.length > 40 || /[\u0000-\u001f\u007f]/.test(store)) throw new BadRequest('invalid store');
}

export function createTrello({ key, token, board, fetchJSON, ttlMs, clock, hideMembers }) {
  var ttl = ttlMs === undefined ? 30 * 1000 : ttlMs;
  var nowMs = clock || Date.now;
  var api = fetchJSON || defaultFetchJSON(key, token);
  var cache = { at: 0, data: null, raw: null, inflight: null };
  var gen = 0;
  var creating = {};

  async function get() {
    if (cache.data && nowMs() - cache.at < ttl) return { data: cache.data, raw: cache.raw, stale: false, at: cache.at };
    // A write bumps gen; a read begun before it is never joined by, or cached for, later callers.
    var mine = cache.inflight && cache.inflight.gen === gen ? cache.inflight : null;
    if (!mine) {
      mine = { gen: gen, promise: api('GET', '/boards/' + board, { lists: 'open', cards: 'open', labels: 'all', members: 'all', member_fields: 'fullName' })
        .then(function (raw) { return { raw: raw, data: buildGroceries({ board: raw, now: new Date(nowMs()) }) }; }) };
      cache.inflight = mine;
    }
    try {
      var got = await mine.promise;
      if (mine.gen === gen) {
        cache.raw = got.raw; cache.data = got.data; cache.at = nowMs();
        return { data: cache.data, raw: got.raw, stale: false, at: cache.at };
      }
      return { data: got.data, raw: got.raw, stale: false, at: nowMs() };
    } catch (e) {
      console.error('trello refresh failed:', e.message);
      if (cache.data) return { data: cache.data, raw: cache.raw, stale: true, at: cache.at };
      throw e;
    } finally {
      if (cache.inflight === mine) cache.inflight = null;
    }
  }

  function invalidate() { gen++; cache.at = 0; }

  // The last board read, fetched if there is none yet.
  async function current() {
    if (!cache.raw) await get();
    return cache.raw;
  }

  // One POST /labels per missing name, however many writes ask at once.
  async function labelId(raw, name) {
    var ids = resolveIds(raw);
    if (ids.labels[name]) return ids.labels[name];
    if (!creating[name]) {
      creating[name] = api('POST', '/labels', { name: name, color: 'null', idBoard: raw.id })
        .then(function (made) { delete creating[name]; return made.id; }, function (e) { delete creating[name]; throw e; });
    }
    var id = await creating[name];
    if (!resolveIds(raw).labels[name]) raw.labels = (raw.labels || []).concat([{ id: id, name: name }]);
    return id;
  }

  function labelNames(raw) {
    var byId = {};
    (raw.labels || []).forEach(function (l) { byId[l.id] = l.name || ''; });
    return byId;
  }

  // Runs a write against the card as last read. A card Trello no longer has is not an error.
  async function write(id, fn) {
    var raw = await current();
    var card = (raw.cards || []).filter(function (c) { return c.id === id; })[0];
    try {
      if (card) await fn(raw, card);
    } catch (e) {
      if (!(e instanceof NotFound)) throw e;
    } finally {
      invalidate();
    }
    return get();
  }

  // Detach the card's labels matching test, except keepId.
  async function detach(card, raw, test, keepId) {
    var names = labelNames(raw);
    var drop = (card.idLabels || []).filter(function (l) { return l !== keepId && test(names[l] || ''); });
    for (var i = 0; i < drop.length; i++) await api('DELETE', '/cards/' + card.id + '/idLabels/' + drop[i], {});
  }

  function has(card, id) { return (card.idLabels || []).indexOf(id) >= 0; }

  function isCategory(n) { return CATEGORIES.indexOf(n) >= 0; }
  function isStore(n) { return n.indexOf(STORE_PREFIX) === 0; }

  // Add or remove one flag label (Low, Usual); a no-op when the card already matches.
  function toggle(id, name, on) {
    return write(id, async function (raw, card) {
      var existing = resolveIds(raw).labels[name];
      if (on) {
        if (existing && has(card, existing)) return;
        await api('POST', '/cards/' + id + '/idLabels', { value: await labelId(raw, name) });
      } else if (existing && has(card, existing)) {
        await api('DELETE', '/cards/' + id + '/idLabels/' + existing, {});
      }
    });
  }

  // Usual may be named Usual or Usuals (any case): any alias on the card counts, and off removes them all.
  async function setUsualCard(id, raw, card, on) {
    var aliases = (raw.labels || []).filter(function (l) { return isUsualName(l.name); });
    var onCard = aliases.filter(function (l) { return has(card, l.id); });
    if (on) {
      if (onCard.length) return;
      var pick = aliases.filter(function (l) { return l.name === USUAL; })[0] || aliases[0];
      await api('POST', '/cards/' + id + '/idLabels', { value: pick ? pick.id : await labelId(raw, USUAL) });
      return;
    }
    for (var i = 0; i < onCard.length; i++) {
      try {
        await api('DELETE', '/cards/' + id + '/idLabels/' + onCard[i].id, {});
      } catch (e) {
        if (!(e instanceof NotFound)) throw e;
      }
    }
  }
  function setUsualLabel(id, on) {
    return write(id, function (raw, card) { return setUsualCard(id, raw, card, on); });
  }

  async function setOnly(id, test, name) {
    return write(id, async function (raw, card) {
      var existing = name && resolveIds(raw).labels[name];
      await detach(card, raw, test, existing || null);
      if (!name || (existing && has(card, existing))) return;
      var lid = await labelId(raw, name);
      await api('POST', '/cards/' + id + '/idLabels', { value: lid });
    });
  }

  // ---- chores: cards in the Chores / Chores done lists, assigned through the card's members.
  function isMember(raw, id) { return (raw.members || []).some(function (m) { return m.id === id; }); }

  async function getChores() {
    var r = await get();
    return { data: buildChores(r.raw, hideMembers), stale: r.stale, at: r.at };
  }

  async function writeChore(id, fn) {
    await write(id, fn);
    return getChores();
  }

  return {
    get: get,

    getChores: getChores,

    tickChore: function (id, done) {
      return writeChore(id, async function (raw, card) {
        var ids = resolveIds(raw);
        var target = done ? ids.choresDone : ids.chores;
        if (!target) throw new Error(done ? 'no Chores done list' : 'no Chores list');
        if (card.idList !== target) await api('PUT', '/cards/' + id, { idList: target, pos: 'top' });
      });
    },

    setChoreUsual: function (id, usual) {
      return writeChore(id, async function (raw, card) { await setUsualCard(id, raw, card, usual); });
    },

    // who is a board member's id, or '' for either of them: the card ends up with exactly that member.
    setChoreWho: async function (id, who) {
      if (typeof who !== 'string') throw new BadRequest('invalid member');
      if (who) {
        var raw0 = await current();
        if (!isMember(raw0, who)) throw new BadRequest('unknown member');
      }
      return writeChore(id, async function (raw, card) {
        var mine = card.idMembers || [];
        for (var i = 0; i < mine.length; i++) {
          if (mine[i] === who) continue;
          try {
            await api('DELETE', '/cards/' + id + '/idMembers/' + mine[i], {});
          } catch (e) {
            if (!(e instanceof NotFound)) throw e; // already off the card
          }
        }
        if (who && mine.indexOf(who) < 0) await api('POST', '/cards/' + id + '/idMembers', { value: who });
      });
    },

    // due is an ISO timestamp, or '' to clear it. A date change also reopens the due-complete flag.
    setChoreDue: async function (id, due) {
      if (typeof due !== 'string' || (due && isNaN(Date.parse(due)))) throw new BadRequest('invalid due');
      return writeChore(id, async function () {
        await api('PUT', '/cards/' + id, { due: due ? new Date(due).toISOString() : 'null', dueComplete: false });
      });
    },

    removeChore: function (id) {
      return writeChore(id, async function () { await api('PUT', '/cards/' + id, { closed: true }); });
    },

    addChore: async function (input) {
      var name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name || name.length > 200) throw new BadRequest('invalid name');
      var who = input.who || '';
      var raw = await current();
      if (who && !isMember(raw, who)) throw new BadRequest('unknown member');
      var list = resolveIds(raw).chores;
      if (!list) throw new Error('no Chores list');
      var query = { idList: list, name: name, pos: 'top' };
      if (who) query.idMembers = who;
      try {
        await api('POST', '/cards', query);
      } finally {
        invalidate();
      }
      return getChores();
    },

    tick: function (id, done) {
      return write(id, async function (raw, card) {
        var ids = resolveIds(raw);
        var target = done ? ids.stocked : ids.toBuy;
        if (!target) throw new Error(done ? 'no Stocked list' : 'no To Buy list');
        if (card.idList !== target) await api('PUT', '/cards/' + id, { idList: target, pos: 'top' });
        // Bought: it is no longer running low. Un-ticking leaves the labels as they are.
        var low = ids.labels['Low'];
        if (!done || !low || !has(card, low)) return;
        try {
          await api('DELETE', '/cards/' + id + '/idLabels/' + low, {});
        } catch (e) {
          if (!(e instanceof NotFound)) throw e;
        }
      });
    },

    setLow: function (id, low) { return toggle(id, 'Low', low); },

    // Usual is independent of the list a card is in and of Low.
    setUsual: function (id, usual) { return setUsualLabel(id, usual); },

    setCategory: async function (id, cat) {
      checkCategory(cat);
      return setOnly(id, isCategory, cat);
    },

    setStore: async function (id, store) {
      checkStore(store);
      store = store.trim();
      return setOnly(id, isStore, store ? STORE_PREFIX + store : '');
    },

    add: async function (input) {
      var name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name || name.length > 200) throw new BadRequest('invalid name');
      if (input.cat) checkCategory(input.cat);
      var store = input.store || '';
      checkStore(store);
      store = store.trim();
      var raw = await current();
      var toBuy = resolveIds(raw).toBuy;
      if (!toBuy) throw new Error('no To Buy list');
      var labels = [];
      if (input.cat) labels.push(await labelId(raw, input.cat));
      if (store) labels.push(await labelId(raw, STORE_PREFIX + store));
      var query = { idList: toBuy, name: name, pos: 'top' };
      if (labels.length) query.idLabels = labels.join(',');
      try {
        await api('POST', '/cards', query);
      } finally {
        invalidate();
      }
      return get();
    }
  };
}
