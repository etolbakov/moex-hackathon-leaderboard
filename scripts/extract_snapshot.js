#!/usr/bin/env node
// extract_snapshot.js — Parse ArenaGo leaderboard HTML → JSON snapshot
// No npm dependencies (Node.js stdlib only).
//
// Usage:
//   node scripts/extract_snapshot.js <file.html>   → stdout JSON
//   curl -sL "https://..." | node scripts/extract_snapshot.js -

'use strict';
const fs     = require('fs');
const crypto = require('crypto');
const { argv } = process;

// ─── Input ─────────────────────────────────────────────────────────
const src = argv[2];
if (!src) { console.error('Usage: extract_snapshot.js <file.html | ->'); process.exit(1); }
const html = src === '-' ? fs.readFileSync('/dev/stdin', 'utf8')
                         : fs.readFileSync(src, 'utf8');

// ─── Helpers ────────────────────────────────────────────────────────
function stripTags(s) { return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function ruNum(s)     { return parseInt(s.replace(/[\s\u00a0%]/g, '')) || 0; }
function decode(s)    { return decodeURIComponent(s.replace(/\+/g, ' ')); }

// ─── Extract tbody rows ─────────────────────────────────────────────
const tbodyM = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
if (!tbodyM) { console.error('ERROR: <tbody> not found'); process.exit(2); }
const tbody = tbodyM[1];

// Split on <tr …> tags — each match is one row
const rowChunks = [];
const rowSplit  = /<tr[^>]*>([\s\S]*?)(?=<tr[^>]*>|$)/g;
let rm;
while ((rm = rowSplit.exec(tbody)) !== null) {
  const chunk = rm[1].trim();
  if (chunk) rowChunks.push(chunk);
}

// ─── Parse each row ─────────────────────────────────────────────────
const entries   = [];
let benchmark   = null;

rowChunks.forEach(rowHtml => {

  // ── IMOEX benchmark row ──
  if (/bi-star-fill/.test(rowHtml)) {
    const capM = rowHtml.match(/text-end fw-bold[^>]*>([\s\S]*?)<\/td>/);
    if (capM) benchmark = { name: 'IMOEX', capital: ruNum(stripTags(capM[1])) };
    return;
  }

  // ── Extract all <td> cells in order ──
  const tdParts = [];
  const tdRe    = /<td([^>]*)>([\s\S]*?)<\/td>/g;
  let tm;
  while ((tm = tdRe.exec(rowHtml)) !== null) {
    tdParts.push({ attr: tm[1], raw: tm[2], text: stripTags(tm[2]) });
  }
  if (tdParts.length < 7) return;

  // ── Rank ──
  const rankCell = tdParts[0];
  let rank;
  const rankSpanM = rankCell.text.match(/\b(\d+)\b/);
  if (rankSpanM) {
    rank = parseInt(rankSpanM[1]);
  } else if (/bi-trophy-fill/.test(rankCell.raw)) {
    const styleM = rankCell.raw.match(/color:([^;'"]+)/);
    const col    = (styleM ? styleM[1] : '').toLowerCase().replace(/\s/g,'');
    rank = col.includes('fbbf24') ? 1 : col.includes('94a3b8') ? 2 : 3;
  } else return;

  // ── Activity dot ──
  const actM = rowHtml.match(/lb-legend-dot[^>]+style="([^"]+)"/);
  let activity = 'ago';
  if (actM) {
    const bg = actM[1].toLowerCase();
    if (bg.includes('22c55e'))      activity = 'today';
    else if (bg.includes('eab308')) activity = 'week';
  }

  // ── Team / Captain from <a href="/trader/...?bot=..."> ──
  const linkM = rowHtml.match(/href="\/trader\/([^?#"]+)(?:\?bot=([^"]*))?"[^>]*>([\s\S]*?)<\/a>/);
  if (!linkM) return;
  const captain = decode(linkM[1]).trim();
  const team    = stripTags(linkM[3]).trim() || decode(linkM[2] || captain);
  if (!captain || !team) return;

  // ── Numeric columns by position (0=rank 1=team 2=captain 3=cap 4=comm 5=load 6=days 7=trades 8=turnover) ──
  const capital    = ruNum(tdParts[3]?.text || '0');
  const commission = ruNum(tdParts[4]?.text || '0');
  const load_pct   = parseInt(tdParts[5]?.text || '0') || 0;   // "49%" → 49
  const days       = ruNum(tdParts[6]?.text || '0');
  const trades     = ruNum(tdParts[7]?.text || '0');
  const turnover   = ruNum(tdParts[8]?.text || '0');

  entries.push({ rank, team, captain, capital, commission, load_pct, days, trades, turnover, activity });
});

if (!entries.length) { console.error('ERROR: no entries parsed'); process.exit(2); }
entries.sort((a, b) => a.rank - b.rank);

// ─── Extract meta from full page ────────────────────────────────────
const timeM        = html.match(/Обновлено:\s*([\d:]+)/);
const updateTime   = timeM ? timeM[1].trim() : '';
const statNumsM    = [...html.matchAll(/lb-stat-num[^>]*>\s*([\d\s]+)\s*</g)];
const totalPart    = statNumsM.length > 0 ? ruNum(statNumsM[0][1]) : entries.length;

// ─── Build snapshot ID ───────────────────────────────────────────────
const now      = new Date();
const dateStr  = now.toISOString().slice(0, 10);
const hhmm     = updateTime ? updateTime.replace(':', '') : now.toISOString().slice(11, 16).replace(':', '');
const snapId   = `${dateStr.replace(/-/g, '')}T${hhmm}`;
const label    = updateTime ? `${dateStr}, ${updateTime}` : now.toISOString().slice(0, 16).replace('T', ', ');

// ─── Output ─────────────────────────────────────────────────────────
const snapshot = {
  snapshot_id:        snapId,
  timestamp:          now.toISOString(),
  label,
  total_participants: totalPart,
  competition:        'moex-ai-agent',
  source:             'github-actions',
  benchmark,
  entries,
};
process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n');

// ─── Hash (written to stderr so workflow can capture separately) ─────
const hash = crypto.createHash('sha256')
  .update(JSON.stringify(entries.map(e => [e.rank, e.captain, e.capital])))
  .digest('hex');
process.stderr.write(`SNAP_HASH=${hash}\nSNAP_ID=${snapId}\n`);

