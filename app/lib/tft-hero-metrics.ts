// Hoehe der TFT-Kopfzone an EINER Stelle.
//
// Warum ein eigenes Modul: `app/tft/loading.tsx` ist der Suspense-Fallback aller
// TFT-Routen und muss dieselbe Hoehe reservieren, die `TftHero` danach rendert.
// Standen die Werte getrennt, springt der Inhalt beim Mounten — genau der
// Sprung, den der Skeleton verhindern soll.
//
// Bewusst ein neutrales .ts-Modul ohne 'use client': `loading.tsx` ist eine
// Server-Component, `TftHero` eine Client-Component. Beide duerfen ein Modul
// ohne Direktive importieren, ohne dass eine Client-Bundle-Kante entsteht
// (gleiches Muster wie app/lib/current-set.ts, app/lib/active-regions.ts).
export const TFT_HERO_HEIGHT = 180;
