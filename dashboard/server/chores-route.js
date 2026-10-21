// /api/chores handler, kept apart from index.js so it can be tested without starting the server.
import { BadRequest, NotFound } from './trello-service.js';

function reply(send, res, r) {
  return send(res, 200, { chores: r.data, stale: r.stale, updated: new Date(r.at).toISOString() });
}

async function edit(trello, id, body) {
  var keys = Object.keys(body || {});
  var k = keys[0], v = body && body[k];
  var ok = keys.length === 1 && ((k === 'done' || k === 'usual') && typeof v === 'boolean' || (k === 'who' || k === 'due') && typeof v === 'string' || k === 'closed' && v === true);
  if (!ok) throw new BadRequest('body needs exactly one of done, usual (boolean), who (string), due (ISO string or empty), closed (true)');
  if (k === 'done') return trello.tickChore(id, v);
  if (k === 'due') return trello.setChoreDue(id, v); // an empty string clears it
  if (k === 'usual') return trello.setChoreUsual(id, v);
  if (k === 'who') return trello.setChoreWho(id, v); // an empty string means either of them
  return trello.removeChore(id);
}

export function choresRoute({ trello, readJSON, send }) {
  return async function (req, res, path) {
    if (!trello) return send(res, 503, { error: 'trello not configured' });
    try {
      if (path === '/api/chores') {
        if (req.method === 'GET') return reply(send, res, await trello.getChores());
        if (req.method === 'POST') {
          var b = await readJSON(req);
          if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequest('invalid body');
          if (typeof b.name !== 'string' || !b.name.trim() || b.name.trim().length > 200) throw new BadRequest('invalid name');
          if (b.who !== undefined && typeof b.who !== 'string') throw new BadRequest('who must be a string');
          return reply(send, res, await trello.addChore({ name: b.name, who: b.who }));
        }
        return send(res, 405, { error: 'method not allowed' });
      }
      var m = /^\/api\/chores\/([^/]*)$/.exec(path);
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
      console.error('chores request failed:', e.message);
      return send(res, 502, { error: 'trello unavailable' });
    }
  };
}
