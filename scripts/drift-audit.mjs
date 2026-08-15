#!/usr/bin/env node
/**
 * Compliance-Report gegen die eigenen Transcripts: `npm run drift-audit`.
 * Laeuft ausserdem automatisch einmal pro Woche beim SessionStart.
 *
 * Ohne Messung ist nicht feststellbar, ob die Disziplin-Hooks wirken oder ob
 * sie nur dastehen. Der Report vergleicht deshalb gegen eine feste Baseline —
 * gemessen am 2026-08-15 ueber die damals 6 groessten Sessions, VOR der
 * Installation der Hooks.
 *
 * Gelesen werden die JSONL-Transcripts unter
 * ~/.claude/projects/<projekt-slug>/. Die liegen nur lokal; auf einem Rechner
 * ohne Historie gibt der Report schlicht nichts aus.
 */
import fs from 'node:fs';
import path from 'node:path';

// Baseline 2026-08-15, 6 Sessions / 176 Antworten / 216 Writes / 94 User-Msgs.
const BASELINE = { p50: 1, p90: 17, ueber8: 26, ueber20: 6, writesVorAgent: 3, compacts: 20 };

const home = process.env.USERPROFILE || process.env.HOME || '';
const slug = (process.env.CLAUDE_PROJECT_DIR || process.cwd()).replace(/[:\\/]/g, '-');
const dir = path.join(home, '.claude', 'projects', slug);

if (!fs.existsSync(dir)) {
  console.log(`drift-audit: keine Transcripts unter ${dir}.`);
  process.exit(0);
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))
  .map(f => ({ f, p: path.join(dir, f), s: fs.statSync(path.join(dir, f)) }))
  .filter(x => x.s.size > 200_000)
  .sort((a, b) => b.s.mtimeMs - a.s.mtimeMs)
  .slice(0, 6);

if (!files.length) {
  console.log('drift-audit: keine Session gross genug fuer eine Auswertung.');
  process.exit(0);
}

const WRITE = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const glob = { turns: 0, lines: [], writes: 0, agents: 0, writesBeforeAgent: 0, compacts: 0, userMsgs: 0, codePrefix: 0 };

for (const { f, p } of files) {
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  let turns = 0, writes = 0, agents = 0, seenAgent = false, wBefore = 0, compacts = 0, um = 0, cp = 0;
  const lens = [];
  for (const raw of lines) {
    let o; try { o = JSON.parse(raw); } catch { continue; }
    if (o.isCompactSummary || o.subtype === 'compact_boundary') compacts++;
    const c = o.message?.content;
    if (o.type === 'user' && typeof c === 'string') {
      um++; if (/^\s*code:/i.test(c)) cp++;
    } else if (o.type === 'user' && Array.isArray(c)) {
      const t = c.filter(b => b.type === 'text').map(b => b.text).join('\n');
      if (t) { um++; if (/^\s*code:/i.test(t)) cp++; }
    }
    if (o.type !== 'assistant' || !Array.isArray(c)) continue;
    for (const b of c) {
      if (b.type === 'text' && b.text?.trim()) { turns++; lens.push(b.text.trim().split('\n').length); }
      if (b.type === 'tool_use') {
        if (WRITE.has(b.name)) { writes++; if (!seenAgent) wBefore++; }
        if (b.name === 'Task' || b.name === 'Agent') { agents++; seenAgent = true; }
      }
    }
  }
  lens.sort((a, b) => a - b);
  const q = r => (lens.length ? lens[Math.floor(lens.length * r)] : 0);
  console.log(`${f.slice(0, 8)}  antworten=${String(turns).padStart(4)} zeilen p50=${String(q(.5)).padStart(3)} p90=${String(q(.9)).padStart(3)} max=${String(lens.at(-1) ?? 0).padStart(4)}  >8z=${String(lens.filter(x => x > 8).length).padStart(4)}  >20z=${String(lens.filter(x => x > 20).length).padStart(3)}  writes=${String(writes).padStart(3)} agents=${String(agents).padStart(2)} writes_vor_1._agent=${String(wBefore).padStart(3)}  compacts=${compacts}  usermsgs=${um} code:=${cp}`);
  glob.turns += turns; glob.lines.push(...lens); glob.writes += writes; glob.agents += agents;
  glob.writesBeforeAgent += wBefore; glob.compacts += compacts; glob.userMsgs += um; glob.codePrefix += cp;
}

glob.lines.sort((a, b) => a - b);
const gq = r => glob.lines[Math.floor(glob.lines.length * r)];
const pct = n => Math.round((100 * n) / glob.lines.length);
const ueber8 = pct(glob.lines.filter(x => x > 8).length);
const ueber20 = pct(glob.lines.filter(x => x > 20).length);
const d = (now, base) => `${now} (Baseline ${base}, ${now === base ? 'unveraendert' : now < base ? 'besser' : 'schlechter'})`;

console.log(`\nGESAMT (${files.length} Sessions): antworten=${glob.turns}  p50=${gq(.5)} p75=${gq(.75)} p90=${gq(.9)} p99=${gq(.99)} max=${glob.lines.at(-1)}`);
console.log(`  Antworten >8 Zeilen:  ${d(`${ueber8}%`, `${BASELINE.ueber8}%`)}`);
console.log(`  Antworten >20 Zeilen: ${d(`${ueber20}%`, `${BASELINE.ueber20}%`)}`);
console.log(`  Writes vor dem 1. Agent-Call: ${d(glob.writesBeforeAgent, BASELINE.writesVorAgent)}`);
console.log(`  writes=${glob.writes}  agent-calls=${glob.agents}  compacts=${glob.compacts}  user-msgs=${glob.userMsgs}  davon "Code:"=${glob.codePrefix}`);
