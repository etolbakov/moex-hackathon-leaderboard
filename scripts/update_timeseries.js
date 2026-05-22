#!/usr/bin/env node
// update_timeseries.js — merge a new snapshot into data/timeseries.json
// and update data/snapshots/latest.json.
// Exits with code 0 always; prints "true" to stdout if data changed, "false" if not.
//
// Usage:
//   node scripts/update_timeseries.js /tmp/new_snap.json

'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT      = path.join(__dirname, '..');
const TS_PATH   = path.join(ROOT, 'data', 'timeseries.json');
const LATEST_PATH = path.join(ROOT, 'data', 'snapshots', 'latest.json');

const newSnapPath = process.argv[2];
if (!newSnapPath) { console.error('Usage: update_timeseries.js <new_snap.json>'); process.exit(1); }

const newSnap = JSON.parse(fs.readFileSync(newSnapPath, 'utf8'));
const sid     = newSnap.snapshot_id;

// ─── Load or initialise timeseries ──────────────────────────────────
let ts;
try {
  ts = JSON.parse(fs.readFileSync(TS_PATH, 'utf8'));
} catch {
  ts = { last_updated: '', last_snapshot_id: '', competition: newSnap.competition, snapshots: [], teams: {} };
}

// ─── Already recorded? ──────────────────────────────────────────────
const alreadyHas = ts.snapshots.some(s => s.sid === sid);
if (alreadyHas) {
  process.stdout.write('false\n');
  process.exit(0);
}

// ─── Change detection: compare ranks+capitals vs last snapshot ───────
const lastSnap    = ts.snapshots.length > 0 ? ts.snapshots[ts.snapshots.length - 1] : null;
let   hasChanged  = !lastSnap;   // always changed if first snapshot

if (lastSnap) {
  for (const entry of newSnap.entries) {
    const prevHistory = ts.teams[entry.captain]?.history;
    const prev        = prevHistory?.[prevHistory.length - 1];
    if (!prev || prev.rank !== entry.rank || prev.capital !== entry.capital) {
      hasChanged = true;
      break;
    }
  }
}

if (!hasChanged) {
  process.stdout.write('false\n');
  process.exit(0);
}

// ─── Append new snapshot metadata ────────────────────────────────────
ts.snapshots.push({
  sid,
  timestamp:          newSnap.timestamp,
  label:              newSnap.label,
  total_participants: newSnap.total_participants,
  benchmark_capital:  newSnap.benchmark?.capital ?? null,
});

// ─── Append history for each team ────────────────────────────────────
newSnap.entries.forEach(entry => {
  if (!ts.teams[entry.captain]) {
    ts.teams[entry.captain] = { team: entry.team, history: [] };
  }
  // Update team name in case it changed
  ts.teams[entry.captain].team = entry.team;

  // Avoid duplicates
  if (!ts.teams[entry.captain].history.some(h => h.sid === sid)) {
    ts.teams[entry.captain].history.push({
      sid,
      rank:       entry.rank,
      capital:    entry.capital,
      commission: entry.commission,
      load_pct:   entry.load_pct,
      days:       entry.days,
      trades:     entry.trades,
      turnover:   entry.turnover,
      activity:   entry.activity,
    });
  }
});

ts.last_updated      = newSnap.timestamp;
ts.last_snapshot_id  = sid;

// ─── Write files ─────────────────────────────────────────────────────
fs.writeFileSync(TS_PATH,     JSON.stringify(ts, null, 2));
fs.writeFileSync(LATEST_PATH, JSON.stringify(newSnap, null, 2));

process.stderr.write(`✓ Timeseries updated: ${ts.snapshots.length} snapshots, ${Object.keys(ts.teams).length} teams\n`);
process.stdout.write('true\n');

