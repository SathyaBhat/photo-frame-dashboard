# Frame monitor

Tracks down the frame's freezes. Two parts write to the same InfluxDB 3 database (`frame`), charted in Grafana:

| Measurement | From | What |
| --- | --- | --- |
| `page` | `dashboard/js/monitor.js` via `/api/diag` | every 10 s: view, mode, longest tick delay, long tasks, JS heap, DOM nodes, viewport size, input focus, sheet open |
| `freeze` (`source=page`) | same | after a freeze: its length and the last 40 events (taps, focus, resizes, view builds, long tasks) |
| `frame_sys` | `frame-monitor.mjs` over adb | memory available, swap used, CPU %, load, temperature, top CPU clock, adb up |
| `frame_proc`, `frame_thread` | same | CPU % of one core for the kiosk, renderer, keyboard (`ime`), `system_server` and `surfaceflinger`, and their busy threads (`CrRendererMain` is the page's main thread) |
| `freeze` (`source=cdp`) | same, when the kiosk runs with DevTools on | freeze length, top of the JS stack and the name of the saved trace |

The flight recorder needs the kiosk started with DevTools on:
`adb shell am start -n com.wesbos.homehq/.MainActivity --ez debug true`. On each freeze it writes
`diagnostics/akimart-rk3326/freezes/freeze-<time>.json.gz` (open in https://ui.perfetto.dev or the DevTools
Performance panel) and `freeze-<time>.stacks.txt` (JS stacks sampled every 2 s). Stacks point into the
minified bundle; build the same commit with `npx vite build --base /frame/ --sourcemap` to map them back.
`kill -USR1 <pid>` saves what the ring buffer holds (the last few minutes when the page is quiet) by hand.
Don't record a Performance profile in DevTools while it runs: only one trace can run at a time.

## Run

```sh
cat > ~/.config/frame-monitor.env <<'EOF'
FRAME=<frame-ip>:5555
INFLUX_TOKEN=<token with write access to the frame database>
EOF
cp scripts/frame-monitor/frame-monitor.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now frame-monitor
journalctl --user -u frame-monitor -f
```

The api container needs `INFLUX_HOST=http://influxdb:8181`, `INFLUX_TOKEN` and `INFLUX_DB=frame` in the Dokploy
environment; without them `/api/diag` answers 503 and the page stops sending.

Test without the frame: `CDP_DIRECT=1 CDP_PORT=<port>` attaches to a desktop Chrome started with
`--remote-debugging-port=<port>`. Parser tests: `node --test scripts/frame-monitor/parse.test.mjs`.
