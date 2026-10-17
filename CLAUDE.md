# CLAUDE.md

This fork runs the family dashboard on one Akimart ZN-DP1002 frame (SSA RK3326 board, Android 8.1).
Upstream is `wesbos/photo-frame-dashboard`; the frame's full record is
[docs/akimart-zn-dp1002.md](docs/akimart-zn-dp1002.md). Machine-specific values (frame IP, server
IP, dashboard URL) live in the git-ignored `CLAUDE.local.md`. Never commit them.

## Rules

- The README's "Rules we learned the hard way" apply to anything that touches the frame. Reads are
  fine; ask before every write (installs, `pm`, `settings`, `set-home-activity`, reboots).
- Dashboard edits on this machine need no approval to make and preview. Ask before deploying them.
- `docs/akimart-zn-dp1002.md` is closed to further changes. Record the owner's custom frame changes
  in the blog draft, `diagnostics/akimart-rk3326/blog-draft.md`.
- Upstream PRs come from branches off `origin/main`, never from this fork's `main`. Show the owner the
  diff before pushing or commenting; it is published under their account.
- No IPs, serials, MACs, Wi-Fi details or whole-disk hashes in committed files. `backups/` and
  `diagnostics/` are ignored; keep dumps, SDKs, APKs and build copies there.

## Reaching the frame

- Network ADB is closed at boot. The owner runs `adb tcpip 5555` over USB from another computer
  (a USB-A port; USB-C to USB-C gives no power or data), then `adb connect <frame-ip>:5555` here.
  Any reboot closes it again.
- Root is `su 0 <cmd>`; `su -c` fails on this build.
- Commands are slow over Wi-Fi. Wrap them in `timeout`, avoid `am start -W` (it hung on the kiosk),
  and expect `screencap -p` to take a while.
- Screenshot: `timeout 90 adb exec-out "screencap -p" >| diagnostics/akimart-rk3326/kiosk.png`, then
  read the PNG. Use `>|` because zsh `noclobber` refuses to overwrite.

## How the frame shows the dashboard

- `com.wesbos.homehq` (the kiosk from `dashboard/kiosk`) is the HOME app, so the frame boots into it
  and the floating Frame Home button returns to it. Two-finger hold for 1.5 s → **Open launcher**
  reaches Rootless Pixel Launcher.
- The installed kiosk is built from `diagnostics/kiosk-build/`, a copy of `dashboard/kiosk` with two
  local edits: `DEFAULT_URL` points at the LAN server, and `MainActivity` has an extra `MAIN` +
  `HOME` + `DEFAULT` intent filter. Edit that copy, not `dashboard/kiosk`, which stays upstream's.
- Rebuild the kiosk only when the URL or native code changes:
  `JAVA_HOME=/usr/lib/jvm/java-17-openjdk PATH=$JAVA_HOME/bin:$PATH ANDROID_HOME=$PWD/diagnostics/android-sdk bash diagnostics/kiosk-build/build.sh`,
  then `adb install -r diagnostics/kiosk-build/build/homehq.apk` (same debug key, so it updates in place).
- Web changes need no APK rebuild: deploy them (see "Build, serve, check"), then reload on the frame
  with the two-finger menu → **Reload dashboard**, or `adb shell am force-stop com.wesbos.homehq`
  followed by `adb shell am start -n com.wesbos.homehq/.MainActivity`.

## Dashboard code (`dashboard/`)

Plain JavaScript and CSS bundled by Vite. There is no framework and no build-time data step.

- `js/main.js` imports the modules in order. Each one attaches to the shared `window.App`, so
  keep that order when adding imports.
- `js/data.js` builds `window.DATA`: synchronous **mock** data (people, events, chores, groceries,
  rooms/devices, weather by hour, photos). Dates are relative to today. `App.state` is
  this object, and every view reads from it.
- `js/app.js` is the shell: hash router (`#home`, `#calendar`, …), `App.register(name, view)`,
  `App.rerender()`, the demo clock (`App.now()` and `App.setTime()`), and helpers such as
  `App.esc`, `App.icon` and `App.$`.
- `js/views/<name>.js` registers one view (`show(el, opts)`, optional `hide`, `minutely: true` to
  rebuild each minute), and `css/views/<name>.css` styles it. A new view also needs a rail button
  and a `<section class="view" id="view-<name>">` in `index.html`, plus its CSS `<link>`.
- `css/tokens.css` holds colours, type and spacing. Person colours come from `DATA.people`.
- Match the existing style: ES5-ish `var`/`function` inside IIFEs, HTML built as strings, and every
  piece of user data passed through `App.esc()`.

### Constraints from the frame

- WebView is Chromium 106. `vite.config.js` targets `chrome106` for JS and `chrome61` for CSS on
  purpose: this WebView rejects 4- and 8-digit hex colours. Don't raise either target.
- 1280×800 at 160 dpi, landscape, touch only. Size for a finger, not a mouse.
- RK3326 with about 1 GB of RAM. Avoid heavy animation, large images and big libraries. The first
  kiosk launch took over 2 minutes.
- External requests: Google Fonts (`index.html`) and `picsum.photos` (`js/system.js`) need the
  internet. If the frame's internet is blocked at the router, self-host the fonts under `public/`
  and serve photos from the LAN.

## Replacing mock data with real data

The frame only talks to the dashboard server on the LAN. It needs no Tailscale and no internet.
The server is on the owner's tailnet and LAN, so it does the fetching:

1. Add a small backend on the server that pulls from LAN and tailnet sources (calendars, Home
   Assistant, weather, photos) and returns JSON in the same shape as the matching part of
   `window.DATA`. Keep credentials on the server only, never in `dashboard/`, which is shipped to
   the browser.
2. In the dashboard, fetch that JSON at startup and on an interval, replace the relevant
   `App.state` fields (for example `App.state.events`), then call `App.rerender()`. Keep the field
   names and types the views expect: `Date` objects for `start`/`end`, and `people` as person ids.
3. Swap one section at a time (weather first is easiest), leaving the rest on mock data, and check
   each on the frame before moving on.

## Build, serve, check

```sh
cd dashboard
npm ci                      # once
npx vite --host             # live-reload dev server for desktop testing at 1280x800
npx vite build              # local check; the frame does not load this dist/
```

The frame loads the dashboard from a Dokploy app on the server, under the `/frame/` path (details in
`CLAUDE.local.md`). Dokploy builds `dashboard/docker-compose.yml` from this fork's `main`: the
`Dockerfile` runs `vite build --base /frame/` and serves `dist/` with nginx behind Dokploy's
Traefik. The router hostnames come from the app's `FRAME_LAN_HOST` and `FRAME_TAILNET_HOST`
environment variables in Dokploy, so they stay out of the repo. Pushing the fork's `main` deploys
(ask first). If the URL changes, rebuild the kiosk copy.

After a change: build, reload the kiosk, take a screenshot, and check
`adb logcat -d | grep -E "HomeHQ|chromium"` for load errors or uncaught exceptions. For DevTools,
start the kiosk with `--ez debug true` and use `chrome://inspect` after
`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`.
