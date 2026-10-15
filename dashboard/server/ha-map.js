// Maps Home Assistant states + the area of each entity to the dashboard's DATA.rooms/devices/scenes/media shapes.
// Pure functions only; index.js does the HTTP.

var SEGMENT = /_segment_\d+$/;
var NOISY_SWITCH = /auto_update|music_mode|dreamview/;

export class BadRequest extends Error {}

function domain(id) { return id.split('.')[0]; }
function attr(s, k) { return s.attributes && s.attributes[k] != null ? s.attributes[k] : null; }
function name(s) { return attr(s, 'friendly_name') || s.entity_id; }

// areas: { entity_id: { id, name } }. hide: array of entity ids.
export function buildHome(input) {
  var states = input.states || [], areas = input.areas || {}, hide = input.hide || [];
  var devices = [], roomsSeen = {}, roomOrder = [], seenNames = {};

  states.forEach(function (s) {
    var d = domain(s.entity_id), area = areas[s.entity_id];
    if ((d !== 'light' && d !== 'switch') || !area || hide.indexOf(s.entity_id) >= 0) return;
    if (d === 'light' && SEGMENT.test(s.entity_id)) return;
    if (d === 'switch' && NOISY_SWITCH.test(s.entity_id)) return;
    var nm = name(s), key = area.id + '|' + nm;
    seenNames[key] = (seenNames[key] || 0) + 1;
    if (seenNames[key] > 1) nm += ' (' + seenNames[key] + ')';
    var on = s.state === 'on';
    var dev = { id: s.entity_id, room: area.id, type: d, name: nm, on: on };
    if (d === 'light') {
      var b = attr(s, 'brightness');
      dev.level = on ? (b == null ? 100 : Math.max(1, Math.round(b / 255 * 100))) : 100;
    }
    if (s.state === 'unavailable') { dev.offline = true; dev.on = false; }
    devices.push(dev);
    if (!roomsSeen[area.id]) { roomsSeen[area.id] = true; roomOrder.push({ id: area.id, name: area.name }); }
  });

  var scenes = states.filter(function (s) { return domain(s.entity_id) === 'scene'; })
    .map(function (s) { return { id: s.entity_id, name: name(s), icon: 'bolt', live: true }; });

  var players = states.filter(function (s) { return domain(s.entity_id) === 'media_player'; });
  var pick = players.filter(function (s) { return s.state === 'playing'; })[0] ||
    players.filter(function (s) { return s.state === 'paused'; })[0] ||
    players.filter(function (s) { return areas[s.entity_id]; })[0];
  var media = null;
  if (pick) {
    var vol = attr(pick, 'volume_level');
    media = {
      id: pick.entity_id,
      room: areas[pick.entity_id] ? areas[pick.entity_id].name : name(pick),
      title: attr(pick, 'media_title') || name(pick),
      artist: attr(pick, 'media_artist') || '',
      playing: pick.state === 'playing',
      volume: vol == null ? null : Math.round(vol * 100)
    };
  }
  return { rooms: roomOrder, devices: devices, scenes: scenes, media: media };
}

function numState(states, id) {
  var s = states.filter(function (x) { return x.entity_id === id; })[0];
  var v = s ? parseFloat(s.state) : NaN;
  return isFinite(v) ? v : null;
}

// Inverter sensors share a prefix (e.g. "sensor.<serial>"), kept in config so no serial is committed.
// Returns the DATA.battery shape, or null if the state of charge is missing.
export function buildBattery(states, prefix, capacityKwh, reserve) {
  if (!prefix) return null;
  var soc = numState(states, prefix + '_soc');
  if (soc === null) return null;
  var get = function (k) { return numState(states, prefix + '_' + k) || 0; };
  var round = function (n) { return Math.round(n * 100) / 100; };
  return {
    soc: Math.round(soc), reserve: reserve, capacityKwh: capacityKwh,
    flowKw: round(get('bat_charge_power') - get('bat_discharge_power')), // negative = discharging
    solarKw: round(get('pv_power')), homeKw: round(get('loads_power'))
  };
}

// Turns a validated request into an HA service call. Only ids in the current discovery result are accepted.
export function buildCommand(kind, id, body, home) {
  body = body || {};
  var ok;
  if (kind === 'device') {
    ok = home.devices.filter(function (d) { return d.id === id; })[0];
    if (!ok) throw new BadRequest('unknown device');
    if (ok.offline) throw new BadRequest('device offline');
    if (typeof body.on !== 'boolean') throw new BadRequest('on must be boolean');
    if (!body.on) return { domain: ok.type, service: 'turn_off', data: { entity_id: id } };
    var data = { entity_id: id };
    if (body.level !== undefined) {
      if (ok.type !== 'light' || !Number.isInteger(body.level) || body.level < 1 || body.level > 100) throw new BadRequest('level must be an integer 1-100 on a light');
      data.brightness_pct = body.level;
    }
    return { domain: ok.type, service: 'turn_on', data: data };
  }
  if (kind === 'scene') {
    if (!home.scenes.some(function (s) { return s.id === id; })) throw new BadRequest('unknown scene');
    return { domain: 'scene', service: 'turn_on', data: { entity_id: id } };
  }
  if (kind === 'media') {
    if (!home.media || home.media.id !== id) throw new BadRequest('unknown media player');
    if (typeof body.playing !== 'boolean') throw new BadRequest('playing must be boolean');
    return { domain: 'media_player', service: body.playing === home.media.playing ? null : 'media_play_pause', data: { entity_id: id } };
  }
  throw new BadRequest('unknown kind');
}
