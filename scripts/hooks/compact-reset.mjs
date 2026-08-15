#!/usr/bin/env node
// PreCompact-Hook: Freigabe loeschen.
//
// Gemessen: 20 Compacts in 6 Sessions, 14 davon in einer einzigen. Nach einem
// Compact ist der Plan, auf den sich die Freigabe bezog, nicht mehr im
// Kontext — der Assistant weiss dann nicht mehr, wofuer er freigegeben wurde,
// arbeitet aber mit offenem Gate weiter. Genau da entstehen die Aenderungen,
// die der User hinterher korrigieren muss.
import { readInput, clearApproval } from './lib/state.mjs';

const input = readInput();
if (input.session_id) clearApproval(input.session_id, 'Compact — Plan ist nicht mehr im Kontext');
process.stdout.write(JSON.stringify({ suppressOutput: true }));
process.exit(0);
