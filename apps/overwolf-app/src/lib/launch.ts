// Woher ein Start der App kommt — beim ersten Start steht die Quelle als
// ?source=… in der Adresse des Hintergrundfensters, jeder weitere Start meldet
// sie als origin in overwolf.extensions.onAppLaunchTriggered. Beide laufen
// durch classifyLaunch (launch.test.ts).
//
// 'auto'  = Overwolf startet die App von selbst (mit dem Spiel, nach einem
//           Update, mit Windows) → Hauptfenster nicht nach vorn holen.
// 'click' = jede andere bekannte Quelle (Dock, Store, Tray, Link …) → der
//           Nutzer will das Hauptfenster sehen.
// null    = keine Quelle → bisheriges Verhalten (Hauptfenster nur ohne laufendes TFT).
export type LaunchKind = 'auto' | 'click';

const AUTO = new Set(['gamelaunchevent', 'update', 'startup']);

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
  return AUTO.has(o) ? 'auto' : 'click';
}
