#!/usr/bin/env python3
"""Writes the Grafana dashboard JSON for scripts/frame-monitor (usage: make-dashboard.py <out.json>)."""
import json, sys

DS = {'type': 'influxdb', 'uid': 'frame-influx'}
FRAME = "client = 'frame' AND $__timeFilter(time)"
panels, y = [], 0

def target(sql, ref='A', fmt='time_series'):
    return {'refId': ref, 'datasource': DS, 'rawQuery': True, 'editorMode': 'code', 'format': fmt, 'rawSql': sql}

def add(title, kind, sql, h=8, w=24, desc='', fmt='time_series', transforms=None, overrides=None, unit=None, options=None, custom=None):
    global y
    x = 0 if not panels or panels[-1]['gridPos']['x'] + panels[-1]['gridPos']['w'] + w > 24 or panels[-1]['gridPos']['y'] != y else panels[-1]['gridPos']['x'] + panels[-1]['gridPos']['w']
    if x == 0 and panels: y = panels[-1]['gridPos']['y'] + panels[-1]['gridPos']['h']
    p = {'id': len(panels) + 1, 'type': kind, 'title': title, 'description': desc, 'datasource': DS,
         'gridPos': {'x': x, 'y': y, 'w': w, 'h': h},
         'targets': [target(s, chr(65 + i), fmt) for i, s in enumerate(sql if isinstance(sql, list) else [sql])],
         'fieldConfig': {'defaults': {'custom': custom or {}}, 'overrides': overrides or []},
         'options': options or {}, 'transformations': transforms or []}
    if unit: p['fieldConfig']['defaults']['unit'] = unit
    panels.append(p)

def right_axis(name, unit=None):
    props = [{'id': 'custom.axisPlacement', 'value': 'right'}]
    if unit: props.append({'id': 'unit', 'value': unit})
    return {'matcher': {'id': 'byName', 'options': name}, 'properties': props}

partition = lambda field: [{'id': 'partitionByValues', 'options': {'fields': [field], 'keepFields': False}}]

add('Freezes seen by the page', 'table',
    "SELECT time, \"view\", ms, crumbs FROM freeze WHERE source = 'page' AND " + FRAME + " ORDER BY time DESC",
    h=9, fmt='table', desc='A 1 s tick that ran 2 s or more late. crumbs: the last 40 events before it, newest last, in seconds before the report.',
    overrides=[{'matcher': {'id': 'byName', 'options': 'ms'}, 'properties': [{'id': 'unit', 'value': 'ms'}, {'id': 'custom.width', 'value': 90}]},
               {'matcher': {'id': 'byName', 'options': 'view'}, 'properties': [{'id': 'custom.width', 'value': 100}]},
               {'matcher': {'id': 'byName', 'options': 'time'}, 'properties': [{'id': 'custom.width', 'value': 170}]}],
    options={'cellHeight': 'sm', 'showHeader': True}, custom={'cellOptions': {'type': 'auto', 'wrapText': True}, 'inspect': True})

add('Main thread blocked (page)', 'timeseries',
    "SELECT $__dateBin(time) AS time, max(gap_ms) AS \"tick delay\", max(longtask_max_ms) AS \"longest task\" FROM page WHERE " + FRAME + " GROUP BY 1 ORDER BY 1",
    w=12, unit='ms', desc='Per 10 s heartbeat: how late the 1 s tick ran, and the longest task.', custom={'drawStyle': 'bars', 'fillOpacity': 60})
add('Keyboard and viewport (page)', 'timeseries',
    "SELECT $__dateBin(time) AS time, min(inner_h) AS \"viewport height\", max(CAST(input_focus AS INT)) AS \"input focused\" FROM page WHERE " + FRAME + " GROUP BY 1 ORDER BY 1",
    w=12, desc='The viewport shrinks from 800 when the on-screen keyboard is up.', overrides=[right_axis('input focused')],
    custom={'drawStyle': 'line', 'lineInterpolation': 'stepAfter'})

add('View on screen (page)', 'state-timeline', "SELECT time, \"view\" FROM page WHERE " + FRAME + " ORDER BY time",
    h=5, options={'showValue': 'auto', 'mergeValues': True, 'rowHeight': 0.8})

add('JS heap and DOM size (page)', 'timeseries',
    "SELECT $__dateBin(time) AS time, max(heap_mb) AS \"heap\", max(dom_nodes) AS \"DOM nodes\" FROM page WHERE " + FRAME + " GROUP BY 1 ORDER BY 1",
    w=12, overrides=[right_axis('DOM nodes', 'short'), {'matcher': {'id': 'byName', 'options': 'heap'}, 'properties': [{'id': 'unit', 'value': 'decmbytes'}]}])

add('Renderer threads, % of one core (adb)', 'timeseries',
    "SELECT $__dateBin(time) AS time, thread, max(cpu_pct) AS cpu FROM frame_thread WHERE proc = 'renderer' AND $__timeFilter(time) GROUP BY 1, 2 ORDER BY 1",
    w=12, unit='percent', transforms=partition('thread'), desc='CrRendererMain at 100% is the page main thread stuck. Needs scripts/frame-monitor running.')

add('Processes, % of one core (adb)', 'timeseries',
    "SELECT $__dateBin(time) AS time, proc, max(cpu_pct) AS cpu FROM frame_proc WHERE $__timeFilter(time) GROUP BY 1, 2 ORDER BY 1",
    w=12, unit='percent', transforms=partition('proc'), desc='ime is the on-screen keyboard app.')
add('Memory (adb)', 'timeseries',
    "SELECT $__dateBin(time) AS time, min(mem_avail_mb) AS \"available\", max(swap_used_mb) AS \"swap used\" FROM frame_sys WHERE $__timeFilter(time) GROUP BY 1 ORDER BY 1",
    w=12, unit='decmbytes')

add('CPU, clock and temperature (adb)', 'timeseries',
    "SELECT $__dateBin(time) AS time, max(cpu_pct) AS \"CPU busy %\", max(freq_mhz) AS \"clock MHz\", max(temp_c) AS \"temp C\", max(adb) AS \"adb up\" FROM frame_sys WHERE $__timeFilter(time) GROUP BY 1 ORDER BY 1",
    w=12, overrides=[right_axis('clock MHz')])
add('Freezes caught by the DevTools recorder', 'table',
    "SELECT time, ms, samples, stack, trace FROM freeze WHERE source = 'cdp' AND $__timeFilter(time) ORDER BY time DESC",
    w=12, fmt='table', unit=None, desc='Trace and stacks files are in diagnostics/akimart-rk3326/freezes/ on the server.',
    overrides=[{'matcher': {'id': 'byName', 'options': 'ms'}, 'properties': [{'id': 'unit', 'value': 'ms'}]}],
    custom={'cellOptions': {'type': 'auto', 'wrapText': True}, 'inspect': True})

dash = {
    'uid': 'frame-health', 'title': 'Photo frame health', 'tags': ['frame'], 'timezone': 'browser', 'refresh': '30s',
    'time': {'from': 'now-6h', 'to': 'now'}, 'schemaVersion': 41, 'panels': panels,
    'annotations': {'list': [{
        'name': 'Freezes', 'enable': True, 'iconColor': 'red', 'datasource': DS,
        'target': target("SELECT time, concat(source, ' freeze ', CAST(ms AS BIGINT), ' ms on ', \"view\") AS text FROM freeze WHERE $__timeFilter(time) ORDER BY time", fmt='table')}]}}
json.dump({'dashboard': dash, 'overwrite': True}, open(sys.argv[1], 'w'), indent=1)
