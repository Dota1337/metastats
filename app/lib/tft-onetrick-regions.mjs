// Einzige Quelle der Onetricks-Regionsliste. Die Seite bietet genau diese
// Regionen an, und der Cache-Warmer waermt genau diese — vorher standen hier
// zwei Listen, und die fuenf Regionen, die nur in der Seite standen (oc1, la1,
// la2, tr1, ru), trafen jedes Mal den kalten 12-20-s-Pfad.
//
// Bewusst .mjs: die Seite (TSX) und der Warmer (Node-Skript) muessen dieselbe
// Datei lesen koennen. `as const` gibt es in JS nicht, der JSDoc-Cast leistet
// dasselbe und haelt den Literal-Union-Typ fuer `type Region` intakt.
export const ONETRICK_REGIONS = /** @type {const} */ ([
  'euw1', 'kr', 'na1', 'eun1', 'br1', 'jp1', 'oc1', 'la1', 'la2', 'tr1', 'ru',
]);
