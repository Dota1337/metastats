#!/usr/bin/env node
// PreCompact-Hook. Seit 2026-08-16 bewusst ein No-Op.
//
// Bis dahin loeschte dieser Hook die Plan-Freigabe, Begruendung: nach dem
// Compact ist der Plan nicht mehr im Kontext, der Assistant weiss also nicht
// mehr, wofuer er freigegeben wurde. Der Grund ist weggefallen —
// post-compact.mjs spielt den Plan wieder ein, und session-start.mjs
// (source="compact", feuert VOR PostCompact) entscheidet dort ueber den
// Freigabe-Zustand. Zwei Stellen, die dasselbe loeschen, waren ohnehin eine
// zu viel.
//
// Warum die Datei trotzdem bleibt und nicht aus hooks.json fliegt:
// scripts/check-discipline-hooks.mjs verlangt das PreCompact-Event als
// Pflicht-Event. Und hier ist die Stelle, an der ein kuenftiger Eingriff VOR
// dem Compact haengen wuerde.
//
// Nicht wieder zum Loescher machen: den Schalter dafuer gibt es in
// lib/state.mjs (APPROVAL_SURVIVES_COMPACT).
import { readInput } from './lib/state.mjs';

readInput();
process.stdout.write(JSON.stringify({ suppressOutput: true }));
process.exit(0);
