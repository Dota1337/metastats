# Spec: Inkrementelle Marktwert-Pipeline

**Stand 2026-08-02 · Status: WARTE AUF FREIGABE**

Ziel (User-Vorgabe wörtlich): „Wir müssen nicht bereits geladene Daten
überschreiben, sondern herausfinden, welche Daten vorhanden sind und dann nur
die neuen pro Tag aktualisieren."

---

## 1. Ist-Zustand (heute verifiziert)

| Fakt | Wert |
|---|---|
| D2+ Grundgesamtheit | 52.091 über 15 Regionen |
| Spieler mit neuen Matches in 24h | **1327** (Untergrenze, Pipeline lief kaum) |
| Snapshots/Tag zuletzt | 6-8, an guten Tagen 2036 |
| Zeit pro Spieler | ~2,2 s |
| Match-Cache | 39 GB / 17,1 Mio Rows / nur Set 17 |
| Riot-Limiter im Driver | 180 req/10,5 s = 17,1 req/s (geteilter Bucket mit refresh-api) |

Ablauf heute: `loadIterationTargets` liest pro Spieler den **letzten Snapshot**
(tier/rank/lp/ladder_rank, also einen Tag alt) → Pass 1 holt pro Spieler Matches
von Riot → `buildPopulation` → Pass 2 rechnet und schreibt.

**Jeder der 52.091 Spieler kostet eine Riot-Call-Kette — auch wenn er nicht
gespielt hat.** Das ist die Verschwendung.

---

## 2. Der entscheidende fachliche Punkt

**„Nicht gespielt" heißt NICHT „Wert unverändert."**

`multiplier = 1 + 0.65·tanh(SkillScore)`, und `SkillScore` besteht aus
z-Scores `z = (M − median) / MAD`, berechnet **gegen die Population der Region**.

Spielt ein Spieler nicht, bleibt sein eigenes `M` gleich — aber `median` und
`MAD` verschieben sich, weil andere gespielt haben. Sein Marktwert ändert sich
also trotzdem, nur eben rein durch die Bewegung der anderen.

Ein simples „Inaktive überspringen" wäre daher fachlich falsch und würde über
Tage driften. Die Trennung muss anders verlaufen:

- **Riot-Calls** (teuer, rate-limitiert) → nur für Aktive
- **Neuberechnung** (billig, reine Mathematik) → für alle

---

## 3. Alternativen für die Roh-Metriken der Inaktiven

Pass 2 braucht pro Spieler die Roh-Metriken. Woher für Inaktive?

| | Ansatz | Vorteil | Nachteil |
|---|---|---|---|
| **A** | Inaktive überspringen, alten Snapshot mit neuem Datum fortschreiben | Billigst, keine Leserei | **Fachlich falsch** (s.o.), Drift akkumuliert |
| **B** | Roh-Metriken pro Lauf neu aus dem Match-Cache extrahieren | Immer korrekt, keine neue Spalte | 52.000 × `listSeasonMatches` gegen 39 GB — die DB-Last bleibt, nur die Riot-Last fällt weg. Ersparnis ungewiss |
| **C** | Roh-Metriken **persistieren** und für Inaktive wiederverwenden | Inaktive kosten nur noch Mathematik (ms). Struktur existiert bereits als `tft_mv_inflight_raw` (`raw_metrics` jsonb) | Neue dauerhafte Tabelle statt ephemerer; Schema-Migration; Invalidierung bei Set-Wechsel nötig |

**Empfehlung: C.** `tft_mv_inflight_raw` hat exakt die richtige Form
(`puuid, region, day, set_number, raw_metrics jsonb`) und ist heute nur
ephemer — sie wird pro Tag aufgeräumt. Sie dauerhaft zu führen (eine Zeile pro
Spieler, überschrieben bei Aktivität) macht aus Pass 2 eine reine Rechnung über
vorhandene Daten. Genau das, was der User beschreibt.

B ist der ehrliche Fallback, falls C sich als zu invasiv erweist — er ist
korrekt, spart aber möglicherweise weniger als erhofft, weil unklar ist, wie
viel der 2,2 s/Spieler auf Riot und wie viel auf die DB entfällt.
**Diese Messung ist Vorbedingung** (siehe Testplan T0).

---

## 4. Aktivitätserkennung

Statt pro Spieler zu fragen: **Liga-Einträge gebündelt pro Region** holen
(`/tft/league/v1/entries/{tier}/{division}` paginiert + Apex-Endpoints).
Verifiziert: die Einträge liefern `puuid`, `wins`, `losses`.

- ~15 Aufrufe pro Region statt 10.876
- `games = wins + losses` gegen den gespeicherten Vortageswert vergleichen
- Differenz > 0 → Aktiv → Pass 1 (Riot) + Roh-Metriken neu
- Differenz = 0 → Inaktiv → gespeicherte Roh-Metriken wiederverwenden

**Migration:** Spalte `games_played int` auf
`tft_player_marketvalue_snapshots`. Beim ersten Lauf ist sie NULL → alle
gelten als aktiv → ein voller Durchlauf, danach greift die Inkrementalität.

**Nebeneffekt, möglicherweise wichtiger als die Ersparnis:** Rang und LP kommen
dann **frisch** aus den Liga-Einträgen statt aus dem Vortages-Snapshot. Das ist
vermutlich die Ursache des beobachteten Einbruchs (Testspieler: base 2965 →
1000 bei unverändertem Multiplier — 1000 ist exakt der Master-Nullpunkt).
`ladder_rank` (Top-30-Challenger) bleibt wie bisher erhalten, da die
Liga-Einträge ihn nicht liefern.

**Aufsteiger:** Mit gebündelten Einträgen werden Spieler ohne Snapshot erstmals
sichtbar. Das ist gewollt und macht den wöchentlichen Discovery-Lauf
mittelfristig überflüssig — ihr Erstfill ist aber teuer (volle Saison-Historie).
Vorschlag: pro Lauf auf N Neuzugänge deckeln, Rest am Folgetag.

---

## 5. Riot-Budget

| | heute | nachher |
|---|---|---|
| Liga-Calls | 0 (Rang aus Snapshot) | ~15 × 15 Regionen = 225 |
| Match-Ketten | 52.091 | ~1.300-5.000 (nur Aktive) |

Bei 17,1 req/s und ~4 Calls je aktiver Spieler landet man im Bereich von
20-30 Minuten statt >31 Stunden. Der geteilte Bucket mit `refresh-api` bleibt
ein offenes Risiko (kombiniert bis 34 req/s gegen ~20/s Method-Limit) — das ist
**unabhängig** von diesem Umbau und gehört separat gelöst.

---

## 6. Testplan (Pflicht — nichts wird ohne diese Nachweise gemeldet)

| ID | Test | Negativfall |
|---|---|---|
| **T0** | Messen: Anteil Riot- vs. DB-Zeit pro Spieler (Instrumentierung, eine Region, 200 Spieler) | Wenn DB dominiert, ist C nötig statt B — Entscheidung hängt daran |
| **T1** | Liga-Einträge einer Region abrufen, `puuid/wins/losses` gegen 10 bekannte Spieler prüfen | Fehlende Felder → Mapping über summonerId nötig |
| **T2** | Aktivitätserkennung isoliert: Spieler mit bekanntem Spielzähler künstlich auf +0 und +3 setzen, Klassifikation prüfen | NULL-Vortageswert muss „aktiv" ergeben, nicht „inaktiv" |
| **T3** | Population-Äquivalenz: voller Lauf vs. inkrementeller Lauf über dieselbe Kohorte, `pop.medians` vergleichen | Abweichung > 1 % Median / 2 % MAD → Roh-Metrik-Wiederverwendung ist fehlerhaft |
| **T4** | Migration vorwärts + rückwärts auf einer Kopie | Spalte darf bestehende Upserts nicht brechen |
| **T5** | Abbruch mitten im Lauf (SIGTERM), danach Resume | Keine doppelten Snapshots, keine zweite Population (bekannter offener Fund) |
| **T6** | Ein Spieler mit 0 Spielen über 3 Tage: ändert sich sein Wert plausibel mit der Population? | Konstanter Wert = Alternative A eingeschlichen |

---

## 7. Rollback

1. Feature-Flag `MV_INCREMENTAL=false` → alter Pfad, kein Deploy nötig
2. Spalte `games_played` bleibt (additiv, stört den alten Pfad nicht)
3. Persistierte Roh-Metriken bleiben liegen und werden ignoriert

---

## 8. Aufwand (realistisch, reine Edit-Zeit)

| Block | Minuten |
|---|---|
| T0-Messung + Auswertung | 30 |
| Liga-Entries-Bulk-Fetch + Aktivitätsdiff | 60 |
| Migration + Roh-Metrik-Persistenz | 45 |
| Pass-2-Entkopplung | 45 |
| Tests T1-T6 | 60 |
| **Summe** | **~4 h** |

---

## 9. Memory-Konflikte

- `reference_marketvalue_daily_pipeline.md` beschreibt `tft_mv_inflight_raw` als
  **ephemer** („Cleanup nach Region-Done + stale-day-Sweep"). Alternative C
  ändert das zu dauerhaft → Memory muss nach Umsetzung aktualisiert werden.
- `reference_hetzner_supabase_db_split.md`: die Tabelle ist **Hetzner-lokal**,
  nicht auf Supabase. Bleibt so — kein Spiegel nötig.
- `reference_marketvalue_skill_score_spec.md`: die Formel selbst wird **nicht**
  angefasst. Nur woher die Eingangsdaten kommen ändert sich.
- Offene Funde aus dem Review vom 2026-08-01, die hier hineinspielen und
  **getrennt** behandelt werden sollten: Pass 2 rechnet nach Abbruch gegen eine
  zweite Population, Watchdog wertet eine einzige Row als „Region frisch",
  Regionen-Reihenfolge ist fix.

---

## WARTE AUF FREIGABE

Offene Entscheidung für den User: **B oder C** (Abschnitt 3). T0 liefert die
Datengrundlage dafür — ich würde T0 zuerst fahren und die Entscheidung danach
treffen, statt sie jetzt zu raten.
