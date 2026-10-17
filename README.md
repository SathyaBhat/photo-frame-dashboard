# Family dashboard on an Akimart photo frame

A fork of [wesbos/photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard), which
shows how to take over a cheap Android photo frame and run a family dashboard full screen. This
fork runs that dashboard on one **Akimart ZN-DP1002** (SSA RK3326 board, Android 8.1) with real
weather, Home Assistant and solar data from a small server on the home network.

Upstream's video, device research and per-frame notes are still here. See
[Upstream research](#upstream-research).

## What is in this fork

| Path | What it is |
| --- | --- |
| [`dashboard/`](dashboard) | The dashboard: plain JavaScript and CSS bundled by Vite, sized for 1280×800 touch. |
| [`dashboard/server/`](dashboard/server) | A small Node API that fetches weather, Home Assistant and energy data, so credentials stay off the frame. |
| [`dashboard/kiosk/`](dashboard/kiosk) | Upstream's full-screen WebView app that shows the dashboard. This fork builds a local copy with its own URL. |
| [`docs/akimart-zn-dp1002.md`](docs/akimart-zn-dp1002.md) | The record of how this frame was set up. |
| [`CLAUDE.md`](CLAUDE.md) | Working notes for agents on this fork: how to reach the frame, build and deploy. |

### The dashboard

Pages, picked from the rail on the left:

- **Today:** clock, weather, what is next, chores and a photo tile.
- **Calendar**, **Chores** and **Shopping**: still mock data.
- **Photos:** a slideshow with captions.
- **Home:** rooms, devices, scenes and media from Home Assistant.
- **Energy:** live solar, battery, grid and home power, a 24-hour flow chart and day-by-day history.
- **Settings:** idle timeouts, night hours, photo slide time and captions, 12/24-hour clock,
  °C/°F and the diagnostics overlay, saved on the frame. It also holds the demo clock, calendar
  data, mode and alert tests, which last until the page reloads.

After a quiet spell the frame goes back to Today, then to a full-screen photo frame (a dim red
clock at night). Hold two fingers still for 1.5 s for the kiosk menu (launcher, Android settings,
reload).

Run it on a desktop:

```sh
cd dashboard
npm ci
npx vite --host        # live reload, best at 1280x800
npx vite build         # local check
```

The WebView on the frame is Chromium 106, so `vite.config.js` targets `chrome106` for JavaScript
and `chrome61` for CSS. Do not raise either.

### Server and real data

Weather comes from the Bureau of Meteorology's unofficial API, and the Home and Energy pages from
Home Assistant. Each source falls back to mock data if the server is unreachable. Settings are
environment variables on the `api` service in
[`dashboard/docker-compose.yml`](dashboard/docker-compose.yml):

| Variable | Needed | Meaning |
| --- | --- | --- |
| `BOM_LOCATION` | yes | BOM geohash for the weather location. |
| `HA_URL`, `HA_TOKEN` | no | Home Assistant address and access token. Without them the Home page stays mock. |
| `HA_HIDE` | no | Comma-separated entities to hide. |
| `HA_BATTERY_PREFIX` | no | Shared entity prefix of the inverter's sensors, for the Energy page. |
| `HA_BATTERY_KWH`, `HA_BATTERY_RESERVE` | no | Battery size (default 10) and reserve percentage (default 10). |

### Deploy

`dashboard/docker-compose.yml` builds the dashboard (`vite build --base /frame/`, served by nginx)
and the API. It is written for Dokploy with Traefik, under the `/frame/` path. The router
hostnames come from `FRAME_LAN_HOST` and `FRAME_TAILNET_HOST` in the app's environment, so none are
committed. Pushing this fork's `main` deploys it. The frame only talks to the server on the local
network.

### The frame

[`docs/akimart-zn-dp1002.md`](docs/akimart-zn-dp1002.md) records how this unit was identified and set
up: vendor apps disabled, the kiosk as the HOME app so the frame boots into the dashboard, and a
floating Home button. Check `ro.build.fingerprint` first: another Akimart ZN-DP1002 has a different
board (RK3126, Android 6) and needs a different guide.

## Upstream research

The sections below are upstream's, kept because the rules apply to any frame work here. Frames
other than this one are not tested in this fork. See the upstream [device index](docs/devices.md)
and [community builds](docs/community-builds.md) for other hardware.

## For agents: start here

You are probably helping someone with a similar device plugged into a Mac over USB. Read this
section, then follow the links for the phase you are in. Do not run anything from a device
section unless the identity checks match exactly.

### Rules we learned the hard way

1. **Ask the owner before every write.** Reads are fine. Writing flash, a partition, `/system`,
   or sending a RAM payload to the SoC needs explicit approval for that specific action.
2. **No writes before a verified backup**: exact byte count, SHA-256, gzip readback, a check for
   `0xCC` filler, and independent re-reads of a few partitions that match.
3. **Don't trust `OKAY`.** Fastboot reported a successful boot write on the Skylight that never
   took effect. Verify writes by reading them back and checking the result on the device.
4. **Stop at the first mismatch** in a hash, model string, offset or size. Report it rather than
   working around it.
5. **One change at a time, undo recorded first.** Keep `.bak` copies next to edited files.
6. **Pin downloads by SHA-256** from official sources (vendor archives, F-Droid, LineageOS, GitHub releases).
7. **Keep dumps private.** They contain Wi-Fi passwords, tokens, serials, MAC addresses and
   copyrighted firmware. Use the ignored `backups/` and `diagnostics/` folders. Leave unique
   identifiers out of anything you commit.
8. **Write notes as you go.** Keep a per-device file in `docs/`, like the ones in the
   [device index](docs/devices.md), with
   observations kept separate from guesses.

### Check for updates, and send back what you find

Many people are working on these frames at the same time. New hardware variants, fixes and
routes arrive as issues and pull requests, often before they are merged. Your local copy may be
out of date.

**Check before you start, and again before each write and at the start of each new session:**

```sh
git fetch origin && git log --oneline HEAD..origin/main   # new commits on main
gh issue list --repo wesbos/photo-frame-dashboard --state all --limit 30
gh pr list --repo wesbos/photo-frame-dashboard --state all --limit 30
gh pr view <number> --repo wesbos/photo-frame-dashboard   # read anything about your device
gh pr diff <number> --repo wesbos/photo-frame-dashboard
```

Without `gh`, use <https://github.com/wesbos/photo-frame-dashboard/issues> and
<https://github.com/wesbos/photo-frame-dashboard/pulls>. Read open PRs about your device, not only
merged docs. If newer information contradicts these docs, tell the owner and follow the newer
information only after its checks pass on your unit. Unmerged PRs are less reviewed, so treat their
scripts with extra care.

**Send a pull request when you learn something new** about a device that is already documented or
about a new one. Examples: a new board or firmware string, a different boot image hash, a cable or
port that does or does not work, a step that failed, a better route, or a correction. Failed
attempts are useful too.

1. Check open issues and PRs first. If one already covers your finding, comment there instead.
2. Create a branch, and add your observations to the device doc in `docs/`. For a new device,
   create `docs/<device>.md`. Keep observations separate from guesses, and say which host OS and
   which unit you used.
3. Remove private data: serials, MAC addresses, Wi-Fi details, eMMC CIDs, tokens, whole-disk
   hashes, dumps and vendor APKs. Firmware strings and boot image hashes are fine.
4. Show the owner the diff, because the PR is published under their GitHub account. Then open it
   with `gh pr create --repo wesbos/photo-frame-dashboard`.

For a PF1007L, include the [report template](docs/pf1007l-start-here.md#report-your-unit).

### Phase map

| Phase                        | What to read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1. Identify** the hardware | USB IDs (Rockchip is VID `2207`), `adb shell getprop`, chip query in loader mode. See the hardware tables in [biuframe.md](docs/biuframe.md#hardware-and-ports) and [hardware-research.md](docs/hardware-research.md).                                                                                                                                                                                                                                                                                                                                                                           |
| **2. Get ADB**               | Try in this order: **(1) over USB** (`adb devices`; accept any "Allow USB debugging" prompt on the screen), **(2) over the network** (`adb connect <ip>:5555`), **(3) only then** a vendor-app trick or a boot patch. The PF1007L boot patch is written from an SD card, see [pf1007l-start-here.md](docs/pf1007l-start-here.md#test-sequence). Ideally no one needs (3). For a vendor-app trick, decompile the vendor app (jadx) and look for hidden tap counters and code dialogs: [app-analysis.md](docs/app-analysis.md). Gestures that did _not_ work are in [research-log.md](docs/research-log.md#ui-attempts-that-did-not-work).                                                                                                                                                                                                                                                                       |
| **3. Loader mode**           | Skylight: hold Volume − while connecting power. BIUFRAME: reset button at power-on (unconfirmed). Building `rkdeveloptool` on Apple silicon: [research-log.md](docs/research-log.md#loader-mode--successful).                                                                                                                                                                                                                                                                                                                                                                                    |
| **4. Back up**               | If loader reads past 32 MiB return `0xCC` filler, they are not a backup: [loader-research.md](docs/loader-research.md). Patched helper and full capture: `scripts/patch-usb-reader.py`, `scripts/load-usb-reader.py`, `scripts/probe-reader.py`, `scripts/backup-flash.py`, `scripts/inspect-backup.py`. With root, back up over ADB instead: `scripts/biuframe-setup.sh backup`.                                                                                                                                                                                                                |
| **5. Root**                  | First check for a shipped `su` (`adb shell su -c id`). On Android 10+ user builds, try the debug-ramdisk route: [debug-ramdisk-research.md](docs/debug-ramdisk-research.md), `scripts/build-debug-boot.py`. Fastboot write failures: [ram-boot-research.md](docs/ram-boot-research.md).                                                                                                                                                                                                                                                                                                          |
| **6. Make it useful**        | Launcher: [android-launcher.md](docs/android-launcher.md). Old Android (6.x) with a browser, WebView swap, CA roots, swap, nav bar and disabling vendor apps: [biuframe-setup-guide.md](docs/biuframe-setup-guide.md). Kiosk app and launcher database edits: [biuframe.md](docs/biuframe.md#custom-webview-kiosk-app-2026-09-30). A working example of a kiosk app and dashboard is in [`dashboard/`](dashboard). Build with `dashboard/kiosk/build.sh` (macOS/Linux) or `dashboard/kiosk/build.ps1` (Windows), change `DEFAULT_URL` in `MainActivity.java` to your own URL, and target the device's WebView version (see `dashboard/vite.config.js`). |
| **7. Networking**            | USB reverse tethering with gnirehtet: [usb-internet-sharing.md](docs/usb-internet-sharing.md). An app that requires Wi-Fi specifically: [onboarding-network-gate.md](docs/onboarding-network-gate.md). Dead onboard Wi-Fi and a USB dongle: [usb-wifi-dongle.md](docs/usb-wifi-dongle.md).                                                                                                                                                                                                                                                                                                       |
| **8. Vendor updates**        | Connecting the stock app to the internet can auto-install APK updates: [app-updates.md](docs/app-updates.md). Disable vendor updaters (FOTA etc.) before going online.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **9. Security hand-off**     | Tell the owner what they now have: [biuframe-setup-guide.md](docs/biuframe-setup-guide.md#read-this-first).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Other docs

- Skylight Wi-Fi investigation: [live-diagnostics.md](docs/live-diagnostics.md),
  [native-wifi-root-tests.md](docs/native-wifi-root-tests.md),
  [wifi-firmware-candidate.md](docs/wifi-firmware-candidate.md),
  [recovery-wifi-diagnostics.md](docs/recovery-wifi-diagnostics.md),
  [device-test-wifi.md](docs/device-test-wifi.md), [static-iw.md](docs/static-iw.md)
- Skylight boot and recovery: [boot-analysis.md](docs/boot-analysis.md),
  [recovery-analysis.md](docs/recovery-analysis.md)
- Replacing Android: [android-replacement.md](docs/android-replacement.md),
  [android14-dsu.md](docs/android14-dsu.md) (Android 14 GSI trial through DSU)
- [external-networking.md](docs/external-networking.md)

## Privacy

`backups/`, `diagnostics/`, `log/`, loader query output and machine-local settings are excluded by
`.gitignore`. They hold full flash dumps, decompiled vendor code, signing keys, and the unit's
identifiers. Do not commit them, and do not publish dumps or vendor APKs.
