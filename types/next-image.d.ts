// Bild-Importe (import logo from './x.png') brauchen diese Typen. Lokal liefert
// sie next-env.d.ts, das aber nicht eingecheckt wird — ohne diese Datei schlaegt
// die Typpruefung in der CI fehl (kein next build vor tsc).
/// <reference types="next/image-types/global" />
