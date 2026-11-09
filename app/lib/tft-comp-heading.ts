// Name einer Comp, wie ihn die Ueberschrift der Comp-Seite zeigt (CompCard,
// h1): Trait des Schluessels plus die an den Items erkannten Carries
// (tft-comp-roles), nicht der Carry aus dem Schluessel. EINE Regel fuer h1 und
// Seitentitel — bis 09.11.2026 nannte der Titel den Schluessel-Carry
// („Verteidiger · Rengar“), die Ueberschrift derselben Seite „Verteidiger ·
// Cassiopeia“.
import { tftLabel, tftTraitDisplayName, type TftAssetsBundle } from './tft-cdragon';
import { parseClusterKey } from './tft-cluster';
import { componentCheckFromItems, computeRoles, namedCarries, type RoleUnit } from './tft-comp-roles';
import type { Lang } from './lang-path';

export interface HeadingComp {
  clusterKey: string;
  games: number;
  typicalUnits: readonly RoleUnit[] | null | undefined;
}

/** Teile der Ueberschrift: Schluessel-Teile, Rollen und die genannten Carries. */
export function compHeading(comp: HeadingComp, assets: TftAssetsBundle | null) {
  const parts = parseClusterKey(comp.clusterKey);
  const isComponent = componentCheckFromItems(assets?.items);
  const roles = computeRoles(comp.typicalUnits, comp.games, { set: assets?.set, isComponent, keyCarry: parts?.carry });
  const named = namedCarries(roles, parts?.carry);
  return { parts, isComponent, roles, named };
}

/** Anzeigename eines Carrys in der Ueberschrift. */
export function compCarryLabel(assets: TftAssetsBundle | null, cid: string, lang: Lang): string {
  return tftLabel(assets?.champions[cid], lang) || cid.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');
}

/**
 * Text der Ueberschrift ohne Abzeichen (3★, Augment): „Trait · C1 & C2“.
 * null, wenn der Schluessel keine Comp-Kennung ist.
 */
export function compHeadingText(comp: HeadingComp, assets: TftAssetsBundle | null, lang: Lang): string | null {
  const { parts, named } = compHeading(comp, assets);
  if (!parts) return null;
  const trait = tftTraitDisplayName(assets, parts.trait, lang);
  return named.length > 0 ? `${trait} · ${named.map(cid => compCarryLabel(assets, cid, lang)).join(' & ')}` : trait;
}
