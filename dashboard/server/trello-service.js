// Reads the grocery board through a short cache and writes card changes back to Trello.
import { buildGroceries, resolveIds, CATEGORIES } from './trello-map.js';
import { BadRequest } from './ha-map.js';

export { BadRequest };
export class NotFound extends Error {}

var API = 'https://api.trello.com/1';
var STORE_PREFIX = 'Store: ';

// Credentials travel as query params and fetch's own errors can quote the URL, so every failure is
// rethrown with a fixed message.
function defaultFetchJSON(key, token) {
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

export function createTrello({ key, token, board, fetchJSON, ttlMs, clock }) {
  var ttl = ttlMs === undefined ? 30 * 1000 : ttlMs;
  var nowMs = clock || Date.now;
  var api = fetchJSON || defaultFetchJSON(key, token);
  var cache = { at: 0, data: null, raw: null, inflight: null };

  async function get() {
    if (cache.data && nowMs() - cache.at < ttl) return { data: cache.data, stale: false, at: cache.at };
    try {
      cache.inflight = cache.inflight || api('GET', '/boards/' + board, { lists: 'open', cards: 'open', labels: 'all' })
        .then(function (raw) { return { raw: raw, data: buildGroceries({ board: raw, now: new Date(nowMs()) }) }; });
      var got = await cache.inflight;
      cache.raw = got.raw; cache.data = got.data; cache.at = nowMs();
      return { data: cache.data, stale: false, at: cache.at };
    } catch (e) {
      console.error('trello refresh failed:', e.message);
      if (cache.data) return { data: cache.data, stale: true, at: cache.at };
      throw e;
    } finally {
      cache.inflight = null;
    }
  }

  // The last board read, fetched if there is none yet.
  async function current() {
    if (!cache.raw) await get();
    return cache.raw;
  }

  async function labelId(raw, name) {
    var ids = resolveIds(raw);
    if (ids.labels[name]) return ids.labels[name];
    var made = await api('POST', '/labels', { name: name, color: 'null', idBoard: raw.id });
    raw.labels = (raw.labels || []).concat([{ id: made.id, name: name }]);
    return made.id;
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
    }
    cache.at = 0;
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

  async function setOnly(id, test, name) {
    return write(id, async function (raw, card) {
      var existing = name && resolveIds(raw).labels[name];
      await detach(card, raw, test, existing || null);
      if (!name || (existing && has(card, existing))) return;
      var lid = await labelId(raw, name);
      await api('POST', '/cards/' + id + '/idLabels', { value: lid });
    });
  }

  return {
    get: get,

    tick: function (id, done) {
      return write(id, async function (raw, card) {
        var ids = resolveIds(raw);
        var target = done ? ids.stocked : ids.toBuy;
        if (!target) throw new Error(done ? 'no Stocked list' : 'no To Buy list');
        if (card.idList === target) return;
        await api('PUT', '/cards/' + id, { idList: target, pos: 'top' });
      });
    },

    setLow: function (id, low) {
      return write(id, async function (raw, card) {
        var existing = resolveIds(raw).labels['Low'];
        if (low) {
          if (existing && has(card, existing)) return;
          await api('POST', '/cards/' + id + '/idLabels', { value: await labelId(raw, 'Low') });
        } else if (existing && has(card, existing)) {
          await api('DELETE', '/cards/' + id + '/idLabels/' + existing, {});
        }
      });
    },

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
      await api('POST', '/cards', query);
      cache.at = 0;
      return get();
    }
  };
}
