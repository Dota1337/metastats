// Macht aus einer CommunityDragon-Beschreibung (Faehigkeit, Item, Augment)
// lesbaren Text. Fuer Set 18 liefert CDragon keine Werte je Stern; die
// Platzhalter (@Var@, %i:scaleAD%, {{TFT_Keyword_X}}) und die schon beim
// Abruf geleerten Reste ("for seconds", "% AD") werden deshalb entfernt,
// nie durch erfundene Zahlen ersetzt. Satzteile, die ohne ihre Zahl keinen
// Sinn mehr ergeben, werden neutral umformuliert ("Periodically", "a delay").
// Geprueft gegen alle Texte im Bundle (tft-desc-format.test.mjs).

const ICONS: Record<string, string> = {
  scaleHealth: 'Health', scaleAS: 'AS', scaleAD: 'AD', scaleAP: 'AP',
  scaleArmor: 'Armor', scaleMR: 'MR', scaleMana: 'Mana', scaleCrit: 'Crit',
  scaleDodge: 'Dodge', scaleHeal: 'Heal', scaleShield: 'Shield',
  scaleHPRegen: 'HP Regen',
};

// Marken fuer Symbol und fehlenden Wert, damit die Satzreparatur sie sieht.
const I = '\u0001';
const M = '\u0002';
const r = (src: string, flags = 'g') =>
  new RegExp(src.replace(/M/g, M).replace(/ICON/g, `${I}\\w+${I}`), flags);

export function formatTftDesc(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = String(raw);
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  s = s.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '');
  // Schluesselwort-Verweise: Wort einsetzen, ausser es steht direkt davor schon.
  // Hinter einem Satzende ist der Verweis nur ein Link auf die Erklaerung: weg.
  s = s.replace(/\{\{([A-Za-z0-9]+(?:_[A-Za-z0-9]+)*)\}\}/g, (_f, inner: string, off: number, whole: string) => {
    const before = whole.slice(Math.max(0, off - 40), off);
    if (/(^|[.!?:\n。！？：])\s*$/.test(before)) return '';
    const label = (inner.split('_').pop() || '').replace(/([a-z])([A-Z])/g, '$1 $2');
    return before.toLowerCase().includes(label.toLowerCase()) ? '' : label;
  });
  s = s.replace(/\{[A-Za-z][\w.]*\}/g, '');
  s = s.replace(/%i:(\w+)%/g, `${I}$1${I}`);
  // Fehlende Werte als Marke; ein %, vor dem keine Zahl steht, ist ein schon
  // beim Abruf entfernter Wert ("15 %" in de/fr bleibt).
  s = s.replace(/@[^@\s]+@%?/g, M);
  s = s.replace(/(\d[\s\u00a0\u202f]?)?%/g, (m, num) => (num ? m : M));
  // Symbole direkt hinter einem fehlenden Wert gehoeren zum Wert
  s = s.replace(r('M(?:\\s*\\(\\s*ICON\\s*\\)|\\s*ICON)+'), M);
  s = s.replace(r('M(?:\\s*[+/]\\s*M)+'), M);
  // Satzteile, die ohne ihre Zahl keinen Sinn ergeben
  s = s.replace(r('(^|[.!?:]\\s+|\\n)(?:For|Within|Over)\\s+(?:M\\s*)?seconds?,\\s*(\\p{L})', 'gu'), (_f, pre: string, ch: string) => pre + ch.toUpperCase());
  s = s.replace(r('\\b(Every|every)\\s+(?:M\\s*seconds?|seconds)\\b'), (_f, w: string) => (w === 'Every' ? 'Periodically' : 'periodically'));
  s = s.replace(r('\\b(After|after)\\s+(?:M\\s*seconds?|seconds)\\b'), (_f, w: string) => `${w} a delay`);
  s = s.replace(r('\\b(reduced|increased|reducing|increasing|healing|heals?|healed)\\s+(?:by|to|up to|for)\\s+M(?:\\s*(?:seconds?|hexes|hex)\\b)?'), '$1');
  s = s.replace(r('\\s+(?:that\\s+)?lasts?\\s+(?:M\\s*)?seconds?\\b'), '');
  s = s.replace(r('\\s*\\b(?:for|over|within|after|in)\\s+(?:M\\s*)?(?:seconds?|hexes|hex)\\b(?!\\s+radius)', 'gi'), '');
  s = s.replace(r('\\s*M\\s+times\\b'), '');
  s = s.replace(r('M\\s*hex(?:es)?\\s+(?=\\p{L})', 'giu'), '');
  s = s.replace(r('\\s*\\+\\s*M(?=\\s+(?:for each|per)\\b)'), ' plus more');
  s = s.replace(r('\\s*\\+\\s*M'), '');
  s = s.replace(r('[^.\\n]*M(?:st|nd|rd|th)\\b[^.\\n]*\\.?'), '');
  // Klammern, die nur noch Wert + Symbol enthielten
  s = s.replace(/\(([^()]*)\)/g, (m, inner: string) => {
    if (!inner.includes(M)) return m;
    const words = inner.split(M).join(' ').replace(/[:/+]/g, ' ').trim().split(/\s+/).filter(Boolean);
    return words.length <= 2 ? '' : m;
  });
  s = s.replace(r('\\s+\\b(?:by|for|of|to|up to|with|at)\\s*M(?=\\s*(?:[.,;)\\n]|$))', 'gi'), '');
  s = s.split(M).join('');
  s = s.replace(new RegExp(`${I}(\\w+)${I}`, 'g'), (_f, icon: string) => ICONS[icon] || '');
  // Zaehler-Anzeigen aus dem Spiel ("(Current: )", "Reward:") ohne ihren Wert
  s = s.replace(/\(\s*[^()]{0,30}:\s*\)/g, '');
  const lines = s.split('\n').map(l => l
    .replace(/[ \t]+/g, ' ')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([,.)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/(^|[^.])([.!?])(?:[,;]+[.!?]?)+/g, '$1$2')
    .replace(/([.!?。)）])(?:\s*[^.:!?。：()（）\n]{1,30}[:：])+\s*$/u, '$1')
    .replace(/^[,.;:]\s*/, '')
    .trim());
  return lines.filter(l => l && !/^[^.:]{0,40}:$/.test(l)).join('\n').trim();
}
