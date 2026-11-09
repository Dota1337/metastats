// Fuer welche Besucher Next den Seitenkopf (Titel, canonical, Beschreibung)
// abwartet, statt ihn nachzustreamen (next.config.ts → htmlLimitedBots).
//
// Next liefert Titel und canonical normalen Besuchern nachgestreamt — sie
// landen dann im <body>. Fuer seine Bot-Liste wartet es. Googlebot fehlt in
// dieser Liste (Next zaehlt ihn zu den Bots, die JavaScript ausfuehren); am
// 09.11.2026 bekam Googlebot auf /champions/Ahri und /tft/player/… Titel und
// canonical im <body>, das Pruefwerkzeug der Search Console (Google-
// InspectionTool, in der Liste) aber im <head> — der Fehler war dort nicht zu
// sehen. Google wertet ein canonical im <body> nicht.
//
// Ein eigener Wert ERSETZT Nexts Liste (docs htmlLimitedBots.md), deshalb
// Nexts Liste + Googlebot statt nur Googlebot.
import { HTML_LIMITED_BOT_UA_RE } from 'next/dist/shared/lib/router/utils/html-bots';

export const HTML_LIMITED_BOTS = new RegExp(`${HTML_LIMITED_BOT_UA_RE.source}|Googlebot`, 'i');
