// Woher ein Start der App kommt — beim ersten Start steht die Quelle als
// ?source=… in der Adresse des Hintergrundfensters, jeder weitere Start meldet
// sie als origin in overwolf.extensions.onAppLaunchTriggered. Beide laufen
// durch classifyLaunch (launch.test.ts).
//
// 'auto'    = Overwolf startet die App von selbst (mit Spiel oder Client, nach
//             einem Update, mit Windows, nach einem Absturz) → Hauptfenster
//             nicht nach vorn holen. relaunch gehoert dazu: so meldet sich ein
//             Neustart mitten in der Partie (Log 08.10. 18:48, 09.10. 21:07).
// 'click'   = der Nutzer hat die App bewusst geoeffnet → Hauptfenster zeigen.
// 'unknown' = Herkunft nicht in den Listen → nur ohne Spiel zeigen, ohne Fokus.
// null      = keine Quelle.
//
// Beide Listen sind erlaubte Listen: eine neue Herkunft landet als 'unknown'
// im Log und wird erst nach Messung eingetragen.
//
// commandline = Desktop-/Startmenue-Verknuepfung (OverwolfLauncher.exe -launchapp
// <uid> -from-desktop, tools/install-shortcuts.ps1); Overwolf-Trace 04.10./09.10.:
// „SecondInstanceWithArguments … -from-desktop“ → „caller: commandline“.
export type LaunchKind = 'auto' | 'click' | 'unknown';

const AUTO = new Set(['gamelaunchevent', 'update', 'startup', 'relaunch']);
const CLICK = new Set([
  'dock', 'tray', 'storeapi', 'odk', 'commandline', 'urlscheme', 'after-install',
  'overwolfstartlaunchevent',
]);

export function launchSource(href: string): string | null {
  try {
    return new URL(href).searchParams.get('source') || null;
  } catch {
    return null;
  }
}

export function classifyLaunch(origin: string | null | undefined): LaunchKind | null {
  const o = (origin ?? '').trim().toLowerCase();
  if (!o) return null;
  if (AUTO.has(o)) return 'auto';
  return CLICK.has(o) ? 'click' : 'unknown';
}
