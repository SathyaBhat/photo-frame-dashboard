// /api/groceries handler, kept apart from index.js so it can be tested without starting the server.
import { BadRequest, NotFound } from './trello-service.js';

var FIELDS = { done: 'boolean', low: 'boolean', cat: 'string', store: 'string' };

function reply(send, res, r) {
  return send(res, 200, { groceries: r.data, stale: r.stale, updated: new Date(r.at).toISOString() });
}

async function edit(trello, id, body) {
  var keys = Object.keys(body || {});
  if (keys.length !== 1 || !FIELDS[keys[0]] || typeof body[keys[0]] !== FIELDS[keys[0]]) throw new BadRequest('body needs exactly one of done, low (boolean), cat, store (string)');
  var k = keys[0], v = body[k];
  if (k === 'done') return trello.tick(id, v);
  if (k === 'low') return trello.setLow(id, v);
  if (k === 'cat') return trello.setCategory(id, v);
  return trello.setStore(id, v); // an empty string removes the store label
}

export function groceriesRoute({ trello, readJSON, send }) {
  return async function (req, res, path) {
    if (!trello) return send(res, 503, { error: 'trello not configured' });
    try {
      if (path === '/api/groceries') {
        if (req.method === 'GET') return reply(send, res, await trello.get());
        if (req.method === 'POST') {
          var b = await readJSON(req);
          if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequest('invalid body');
          if (typeof b.name !== 'string' || !b.name.trim() || b.name.trim().length > 200) throw new BadRequest('invalid name');
          if ((b.cat !== undefined && typeof b.cat !== 'string') || (b.store !== undefined && typeof b.store !== 'string')) throw new BadRequest('cat and store must be strings');
          return reply(send, res, await trello.add({ name: b.name, cat: b.cat, store: b.store }));
        }
        return send(res, 405, { error: 'method not allowed' });
      }
      var m = /^\/api\/groceries\/([^/]*)$/.exec(path);
      if (m && req.method === 'POST') {
        if (!/^[0-9a-f]{24}$/.test(m[1])) throw new BadRequest('invalid id');
        var body = await readJSON(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequest('invalid body');
        return reply(send, res, await edit(trello, m[1], body));
      }
      return send(res, 405, { error: 'method not allowed' });
    } catch (e) {
      if (e instanceof BadRequest) return send(res, 400, { error: e.message });
      if (e instanceof NotFound) return send(res, 404, { error: 'not found' });
      console.error('groceries request failed:', e.message);
      return send(res, 502, { error: 'trello unavailable' });
    }
  };
}
