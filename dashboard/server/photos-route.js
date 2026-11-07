// /api/photos handlers, kept apart from index.js so they can be tested without starting the server.
import { Readable } from 'node:stream';
import { NotFound, MEMORIES, validDay, validId } from './photos-service.js';

// album: empty for the server's default, MEMORIES, or an album id. Anything else is refused.
function validAlbum(a) { return !a || a === MEMORIES || validId(a); }

function today() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function photosRoute({ photos, send }) {
  return async function (req, res, path, query) {
    if (!photos) return send(res, 503, { error: 'immich not configured' });
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    if (path === '/api/photos/albums') {
      try {
        return send(res, 200, await photos.albums());
      } catch (e) {
        return send(res, 502, { error: 'immich unavailable' });
      }
    }
    var album = query.get('album') || '';
    if (!validAlbum(album)) return send(res, 400, { error: 'album must be an album id or ' + MEMORIES });
    if (path === '/api/photos') {
      // The frame sends its own date, so "on this day" follows the frame's clock, not the server's.
      var day = query.get('day') || today();
      if (!validDay(day)) return send(res, 400, { error: 'day must be YYYY-MM-DD' });
      try {
        var r = await photos.get(day, album);
        return send(res, 200, { photos: r.data, day: day, from: r.from, album: r.album, stale: r.stale, updated: new Date(r.at).toISOString() });
      } catch (e) {
        return send(res, 502, { error: 'immich unavailable' });
      }
    }
    var id = path.slice('/api/photos/'.length);
    var up;
    try {
      up = await photos.image(id, query.get('size'), query.get('day'), album);
    } catch (e) {
      if (e instanceof NotFound) return send(res, 404, { error: 'not found' });
      console.error('photo image failed:', e.message);
      return send(res, 502, { error: 'immich unavailable' });
    }
    res.writeHead(200, {
      'content-type': up.headers.get('content-type') || 'image/jpeg',
      // A photo's preview never changes, and the frame shows the same few dozen all day.
      'cache-control': 'private, max-age=86400'
    });
    if (!up.body) return res.end();
    var body = Readable.fromWeb(up.body);
    body.on('error', function () { res.destroy(); });
    res.on('close', function () { body.destroy(); });
    body.pipe(res);
  };
}
