// Die Fenster der App — einzige Liste. Overwolf liest sie aus
// public/manifest.json (data.windows), Vite baut je Name src/windows/<name>.html,
// ow.ts nimmt den Typ. windows.test.ts haelt alle drei gleich.
//
// main_overlay ist das Hauptfenster als Overlay ueber dem Spiel, nur fuer einen
// Bildschirm bzw. den Anzeigemodus „im Spiel" (dieselbe main.ts, erkennt sich
// an data-window im <body>). Es ersetzt das Desktop-Hauptfenster nicht.
export const WINDOW_NAMES = ['background', 'main', 'main_overlay', 'pinned', 'shop', 'matchup', 'items'] as const;

export type WindowName = typeof WINDOW_NAMES[number];

// Fenster, die nur im Spiel existieren und die das Hintergrundfenster je nach
// Spielzustand oeffnet und schliesst.
export const OVERLAY_NAMES = ['pinned', 'shop', 'matchup', 'items'] as const satisfies readonly WindowName[];
export type OverlayName = typeof OVERLAY_NAMES[number];
