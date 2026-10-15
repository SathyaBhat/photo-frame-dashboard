# Home Assistant data and control on the frame

## Intent

Replace the mock home-control data (rooms, devices, scenes, media) with the owner's real Home
Assistant (HA), and let taps on the frame control it. The frame only talks to the dashboard
server on the LAN; the server holds the HA credentials and does all HA calls.

Agreed with the owner:

- Full control, not read-only.
- Devices are auto-discovered from HA areas, with filters (below) to keep the screen usable.
- Mock sections HA cannot supply (thermostat, cameras, locks, blinds, garage, the mock scenes)
  are hidden once live data loads. A fake lock state on a real display is misleading.
- Builds on the existing server (`dashboard/server`) and `js/live.js`, which already serve
  BOM weather.

## What HA provides (checked read-only)

HA exposes lights, switches, media players and scenes, grouped into areas. It has no `lock`,
`cover`, `climate` or `camera` entities. Raw discovery is noisy: most lights are LED strip
segments (`*_segment_<n>`), several switches are vendor toggles (auto-update, music mode,
DreamView), names can repeat inside one area, and some entities have no area or are
`unavailable`.

## Backend (`dashboard/server`)

### Configuration (Dokploy environment only, never committed)

- `HA_URL`: base URL reachable from the server container.
- `HA_TOKEN`: long-lived access token. Server-side only.
- `HA_HIDE`: optional comma list of entity ids to hide.

### `ha-map.js` (pure, unit tested)

Input: HA states and the area registry. Output, in the shape the views already use:
`{ rooms, devices, scenes, media }`.

- **Rooms:** HA areas that contain at least one visible device. Entities with no area are
  skipped.
- **Lights:** every `light.*` in an area except ids matching `_segment_<n>$` and `HA_HIDE`.
  `{ id: entity_id, room, type: 'light', name, on, level }`, where `level` is brightness
  converted from 0-255 to 0-100 (100 when on and the light has no brightness).
- **Switches:** `switch.*` in an area except ids containing `auto_update`, `music_mode` or
  `dreamview`, and `HA_HIDE`. `{ type: 'switch', on }`.
- **Names:** duplicate names within one room get a numeric suffix (`Office`, `Office (2)`).
- **Unavailable:** state `unavailable` maps to `offline: true`. Such devices render greyed and
  cannot be toggled.
- **Scenes:** every `scene.*`, as `{ id: entity_id, name, icon: 'bolt', live: true }`.
- **Media:** the first `media_player.*` that is playing or paused, else the first one in an
  area, else `null`. `{ room, title, artist, playing, volume }`.

### Routes

- `GET /api/home` returns the mapped data, cached about 5 seconds, with `stale` and `updated`
  like `/api/weather`.
- `POST /api/device/:id` with `{ on, level }` calls `light.turn_on` (with `brightness_pct`),
  `light.turn_off`, `switch.turn_on` or `switch.turn_off`.
- `POST /api/scene/:id` calls `scene.turn_on`.
- `POST /api/media/:id` with `{ playing }` calls `media_player.media_play_pause`.
- After a write the cache is invalidated and the new state is returned.

### Safety

- Writes are accepted only for ids present in the current discovery result. The service cannot
  be used to call arbitrary HA services or reach entities that are filtered out.
- Request bodies are validated (types and ranges); anything else is a 400.
- The API has no login, matching the dashboard itself: anyone on the LAN or tailnet who knows
  the URL could toggle devices. That is acceptable for lights, outlets, scenes and media. If
  locks or garage doors are ever added, add authentication first.

## Frontend

- `js/live.js` polls `api/home` every 10 seconds and again right after any write, replaces
  `D.rooms`, `D.devices`, `D.scenes` and `D.media`, and calls `App.rerender()`.
- On the first successful load it sets `D.climate = null` and `D.cameras = []`. Guards are
  added in `control.js` (summary, climate card, camera row, lock/garage summary), `home.js`
  ("inside" temperature, lock and garage status) and `system.js` (doorbell camera demo).
- `App.setDevice` keeps its optimistic flip, then POSTs. On failure it reverts and shows the
  existing "Couldn't reach" toast. The next poll reconciles. The mock `flaky` simulation
  applies to mock devices only.
- New UI: a `switch` tile (tap to toggle), live scene buttons that call `/api/scene`, and
  media play/pause wired to `/api/media`.
- Until the first successful load, the mock home screen shows exactly as today. After that, if
  HA becomes unreachable the last real data stays and the control view shows an "offline"
  marker.

## Constraints kept

Chromium 106 and chrome61 CSS targets unchanged; no new dependencies in the browser; the HA
token and URL stay out of `dashboard/` and the repo; style stays ES5-ish `var`/`function`
with `App.esc()` on any HA-provided text (names are user data).

## Testing

- Unit tests (`node --test`) for `ha-map.js` and the command builder, using a synthetic
  fixture with generic names so no personal device names enter the public repo.
- A read-only smoke run of the service against the real HA.
- A real write test (toggle one light) only with the owner's say-so.
- Build locally, then, after approval, deploy and check the frame with a screenshot and
  logcat.

## Out of scope

Climate, cameras, locks, blinds and garage (no HA entities); calendar and the other mock
sections; colour control and per-segment lights; authentication.
