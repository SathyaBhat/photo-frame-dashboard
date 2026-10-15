import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHome, buildBattery, buildCommand, BadRequest } from '../ha-map.js';

function st(id, state, attributes) { return { entity_id: id, state: state, attributes: attributes || {} }; }
var A = { id: 'kitchen', name: 'Kitchen' }, B = { id: 'den', name: 'Den' };

function fixture() {
  return {
    states: [
      st('light.pendant', 'on', { friendly_name: 'Pendant', brightness: 128 }),
      st('light.pendant_two', 'off', { friendly_name: 'Pendant' }),
      st('light.strip', 'on', { friendly_name: 'Strip' }),
      st('light.strip_segment_3', 'on', { friendly_name: 'Strip segment 3' }),
      st('light.orphan', 'on', { friendly_name: 'Orphan' }),
      st('light.lamp', 'unavailable', { friendly_name: 'Lamp' }),
      st('light.hidden', 'on', { friendly_name: 'Hidden' }),
      st('switch.plug', 'on', { friendly_name: 'Plug' }),
      st('switch.plug_auto_update', 'on', { friendly_name: 'Auto update' }),
      st('scene.relax', 'unknown', { friendly_name: 'Relax' }),
      st('media_player.tv', 'idle', { friendly_name: 'TV' }),
      st('media_player.speaker', 'playing', { friendly_name: 'Speaker', media_title: 'Song', media_artist: 'Band', volume_level: 0.35 })
    ],
    areas: {
      'light.pendant': A, 'light.pendant_two': A, 'light.strip': B, 'light.strip_segment_3': B, 'light.lamp': B, 'light.hidden': B,
      'switch.plug': B, 'switch.plug_auto_update': B, 'media_player.tv': A, 'media_player.speaker': B
    },
    hide: ['light.hidden']
  };
}

test('buildHome keeps visible lights and switches in areas', function () {
  var h = buildHome(fixture());
  assert.deepEqual(h.devices.map(function (d) { return d.id; }), ['light.pendant', 'light.pendant_two', 'light.strip', 'light.lamp', 'switch.plug']);
  assert.deepEqual(h.rooms, [A, B]);
});

test('brightness converts to 0-100 and defaults to 100', function () {
  var h = buildHome(fixture()), by = function (id) { return h.devices.filter(function (d) { return d.id === id; })[0]; };
  assert.equal(by('light.pendant').level, 50);
  assert.equal(by('light.strip').level, 100);
  assert.equal(by('switch.plug').level, undefined);
});

test('duplicate names in a room get a suffix', function () {
  var h = buildHome(fixture());
  assert.deepEqual(h.devices.slice(0, 2).map(function (d) { return d.name; }), ['Pendant', 'Pendant (2)']);
});

test('unavailable devices are offline and off', function () {
  var lamp = buildHome(fixture()).devices.filter(function (d) { return d.id === 'light.lamp'; })[0];
  assert.equal(lamp.offline, true);
  assert.equal(lamp.on, false);
});

test('scenes and media', function () {
  var h = buildHome(fixture());
  assert.deepEqual(h.scenes, [{ id: 'scene.relax', name: 'Relax', icon: 'bolt', live: true }]);
  assert.deepEqual(h.media, { id: 'media_player.speaker', room: 'Den', title: 'Song', artist: 'Band', playing: true, volume: 35 });
  var f = fixture(); f.states.pop();
  assert.equal(buildHome(f).media.id, 'media_player.tv');
  assert.equal(buildHome({ states: [] }).media, null);
});

test('buildCommand maps writes and rejects anything not discovered', function () {
  var h = buildHome(fixture());
  assert.deepEqual(buildCommand('device', 'light.pendant', { on: true, level: 40 }, h), { domain: 'light', service: 'turn_on', data: { entity_id: 'light.pendant', brightness_pct: 40 } });
  assert.deepEqual(buildCommand('device', 'switch.plug', { on: false }, h), { domain: 'switch', service: 'turn_off', data: { entity_id: 'switch.plug' } });
  assert.deepEqual(buildCommand('scene', 'scene.relax', {}, h).service, 'turn_on');
  assert.equal(buildCommand('media', 'media_player.speaker', { playing: false }, h).service, 'media_play_pause');
  assert.equal(buildCommand('media', 'media_player.speaker', { playing: true }, h).service, null);
  [
    ['device', 'light.hidden', { on: true }], ['device', 'light.strip_segment_3', { on: true }], ['device', 'lock.front', { on: true }],
    ['device', 'light.lamp', { on: true }], ['device', 'light.pendant', {}], ['device', 'light.pendant', { on: true, level: 0 }],
    ['device', 'light.pendant', { on: true, level: 101 }], ['device', 'switch.plug', { on: true, level: 50 }],
    ['scene', 'light.pendant', {}], ['media', 'media_player.tv', { playing: true }], ['nope', 'x', {}]
  ].forEach(function (c) {
    assert.throws(function () { buildCommand(c[0], c[1], c[2], h); }, BadRequest, c.join(' '));
  });
});

test('buildBattery maps inverter sensors, discharging is negative', function () {
  var states = [st('sensor.inv_soc', '33'), st('sensor.inv_pv_power', '0.0'), st('sensor.inv_loads_power', '0.873'),
    st('sensor.inv_bat_charge_power', '0.0'), st('sensor.inv_bat_discharge_power', '0.869')];
  assert.deepEqual(buildBattery(states, 'sensor.inv', 10, 15), { soc: 33, reserve: 15, capacityKwh: 10, flowKw: -0.87, solarKw: 0, homeKw: 0.87, gridKw: 0 });
  assert.equal(buildBattery(states, '', 10, 15), null);
  assert.equal(buildBattery([st('sensor.inv_soc', 'unavailable')], 'sensor.inv', 10, 15), null);
});

test('buildBattery reads solar from meter 2 (AC-coupled), never negative', function () {
  var states = [st('sensor.inv_soc', '50'), st('sensor.inv_pv_power', '0'), st('sensor.inv_meter_2_power', '5.026')];
  assert.equal(buildBattery(states, 'sensor.inv', 10, 15).solarKw, 5.03);
  states[2] = st('sensor.inv_meter_2_power', '-0.004');
  assert.equal(buildBattery(states, 'sensor.inv', 10, 15).solarKw, 0);
  assert.equal(buildBattery([st('sensor.inv_soc', '50')], 'sensor.inv', 10, 15).solarKw, 0);
});
