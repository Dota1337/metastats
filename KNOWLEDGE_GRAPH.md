# KNOWLEDGE_GRAPH.md
# League of Legends Player Knowledge Graph
# 120 Statistikpunkte für MetaStats Market Value System

---

## Übersicht

Dieser Knowledge Graph definiert 120 Statistikpunkte zur Bewertung von League of Legends Spielern.
Er erweitert das bestehende `marketvalue.ts`-System um tiefere rollenspezifische Metriken,
Teamsynergien, historische Trends und Prognose-Modelle.

### Kategorien

| # | Kategorie | Punkte | IDs |
|---|-----------|--------|-----|
| A | Basis-Identität & Rang | 10 | A01–A10 |
| B | Universelle Kampf-Stats | 12 | B01–B12 |
| C | Farming & Ökonomie | 8 | C01–C08 |
| D | Vision & Map Control | 8 | D01–D08 |
| E | Objektiv-Kontrolle | 8 | E01–E08 |
| F | Rollenspezifisch: TOP | 10 | F01–F10 |
| G | Rollenspezifisch: JUNGLE | 10 | G01–G10 |
| H | Rollenspezifisch: MID | 10 | H01–H10 |
| I | Rollenspezifisch: ADC | 10 | I01–I10 |
| J | Rollenspezifisch: SUPPORT | 10 | J01–J10 |
| K | Teamsynergie & Duo-Performance | 10 | K01–K10 |
| L | Historische Trends | 8 | L01–L08 |
| M | Prognose-Modell & Composite | 6 | M01–M06 |
| **Σ** | | **120** | |

---

## A – Basis-Identität & Rang (A01–A10)

Diese Punkte bilden den **Basiswert** (`getBaseValue`) und den Spieler-Kontext.

| ID | Statistik | Quelle | Beschreibung | Gewichtung im Marktwert |
|----|-----------|--------|--------------|------------------------|
| A01 | **Tier** | Ranked API | IRON → CHALLENGER (0–9) | Primärer Wert-Treiber: bestimmt Preiskategorie |
| A02 | **Division** | Ranked API | IV → I (0–3) | Feinjustierung innerhalb des Tiers |
| A03 | **League Points (LP)** | Ranked API | 0–100+ LP | Linearer Skalierungsfaktor pro Tier |
| A04 | **Ladder Rank** | Ranked API | Platzierung in Challenger/GM | Exponentielle Werterhöhung (Rank 1 = $750k) |
| A05 | **Ranked Wins** | Ranked API | Gesamtanzahl gewonnener Spiele | Volumen-Indikator |
| A06 | **Ranked Losses** | Ranked API | Gesamtanzahl verlorener Spiele | Volumen-Indikator |
| A07 | **Gesamte Winrate** | Berechnet: wins / (wins+losses) | Prozentuale Gewinnrate | ±17.5% Multiplikator bei >60% / <45% |
| A08 | **Primäre Rolle** | `detectPrimaryRole()` | Meistgespielte Rolle über N Matches | Bestimmt rollenspezifische Gewichtung |
| A09 | **Rollen-Flexibilität** | Berechnet | Anzahl Rollen mit >15% Spielanteil | Bonus für Multi-Role-Spieler |
| A10 | **Account-Level** | Summoner API | Spieler-Level | Indikator für Erfahrung / Smurf-Detection |

### Beziehungen (A)
```
A01 ──bestimmt──→ Preiskategorie
A01 + A02 + A03 ──berechnet──→ getBaseValue()
A04 ──überschreibt──→ getBaseValue() für Challenger
A05 + A06 ──berechnet──→ A07 (Winrate)
A08 ──steuert──→ Rollenspezifische Multiplikatoren (F–J)
```

---

## B – Universelle Kampf-Stats (B01–B12)

Gelten für **alle Rollen** und fließen in `calculateMultiplier()` ein.

| ID | Statistik | Formel | Benchmarks | Multiplikator-Effekt |
|----|-----------|--------|------------|---------------------|
| B01 | **Kills / Spiel** | Σ kills / N | 4–8 je nach Rolle | Teil von KDA |
| B02 | **Deaths / Spiel** | Σ deaths / N | <4 gut, >6 schlecht | Nenner von KDA |
| B03 | **Assists / Spiel** | Σ assists / N | 5–18 je nach Rolle | Teil von KDA |
| B04 | **KDA-Ratio** | (K+A) / max(D,1) | >4.0 elite, <1.5 schwach | Bis zu ±17.5% |
| B05 | **Kill Participation %** | (K+A) / Team-Kills | >65% = hoher Teamfight-Wert | Teamplay-Indikator |
| B06 | **Solo Kills / Spiel** | Direkte 1v1-Kills | >1.5 = Lane-Dominant | Skill-Expression |
| B07 | **Damage Dealt / Minute** | Σ damageDealt / Σ duration | 700–950+ je nach Rolle | Bis zu +17.5% |
| B08 | **Damage Taken / Minute** | Aus erweiterten Stats | Tank-Relevanz | Rollenkontextuell |
| B09 | **Damage Share %** | Player-DMG / Team-DMG | 25–35% je nach Rolle | Carry-Potential |
| B10 | **First Blood Rate** | FB-Kill oder -Assist | >30% = aggressiv | +8% Multiplikator |
| B11 | **First Blood Victim Rate** | FB-Opfer | >30% = riskant | −5% Multiplikator |
| B12 | **Multi-Kill-Frequenz** | Doubles, Triples, Quadras, Pentas / N | Selten = hoch bewertet | Highlight-Metrik |

### Beziehungen (B)
```
B01 + B02 + B03 ──berechnet──→ B04 (KDA)
B01 + B03 ──berechnet──→ B05 (Kill Participation)
B07 ──verglichen mit──→ Rollen-Benchmark (F/G/H/I/J)
B10 ←─korreliert─→ B11 (inverser Zusammenhang)
B04 ──fließt ein──→ calculateMultiplier() für alle Rollen
```

---

## C – Farming & Ökonomie (C01–C08)

| ID | Statistik | Formel | Benchmarks | Rollen-Relevanz |
|----|-----------|--------|------------|----------------|
| C01 | **CS / Minute** | Σ cs / Σ (duration/60) | >8.0 elite, <5.0 schwach | TOP, MID, ADC primär |
| C02 | **CS @ 10 min** | Aus Timeline-Daten | >80 = gut | Lane-Phase-Indikator |
| C03 | **CS @ 15 min** | Aus Timeline-Daten | >130 = gut | Mid-Game-Transition |
| C04 | **CS-Differenz @ 15** | Eigene CS − Gegner-CS | >+10 = Lane-Dominanz | Relativer Skill-Indikator |
| C05 | **Gold / Minute** | Aus erweiterten Stats | >400 = gut | Ökonomische Effizienz |
| C06 | **Gold Share %** | Player-Gold / Team-Gold | 20–28% je nach Rolle | Ressourcen-Nutzung |
| C07 | **Gold-Differenz @ 15** | Eigenes Gold − Gegner-Gold | >+500 = Lane-Vorteil | Early-Game-Wertung |
| C08 | **Damage / Gold Ratio** | Damage-Dealt / Gold-Earned | >1.0 = effizient | Gold-Effizienz |

### Beziehungen (C)
```
C01 ──fließt ein──→ calculateMultiplier() (±10%)
C02 + C03 ──Trend──→ C04 (CS-Differenz)
C05 ──korreliert──→ C06 (Gold Share)
C05 + B07 ──berechnet──→ C08 (Damage/Gold Effizienz)
C01 ──Gewichtung abhängig von──→ A08 (Primäre Rolle)
```

---

## D – Vision & Map Control (D01–D08)

| ID | Statistik | Formel | Benchmarks | Rollen-Relevanz |
|----|-----------|--------|------------|----------------|
| D01 | **Vision Score / Spiel** | Σ visionScore / N | >45 SUP, >25 JGL, >20 MID | Bis zu +17.5% (SUP) |
| D02 | **Wards Placed / Spiel** | Σ wardsPlaced / N | >25 SUP, >15 JGL | Bis zu +10% |
| D03 | **Control Wards Placed** | Aus erweiterten Stats | >3/Spiel = gut | Map-Awareness |
| D04 | **Wards Destroyed** | Aus erweiterten Stats | Vision-Denial | Counter-Vision |
| D05 | **Vision Score / Minute** | visionScore / (duration/60) | >1.5 = sehr gut | Zeitnormiert |
| D06 | **Ward-Uptime %** | Geschätzt aus Place/Destroy-Ratio | Längere Ward-Lebensdauer = besser | Strategische Platzierung |
| D07 | **Scuttle-Control-Rate** | Scuttle Crab Secures | JGL-relevant | River-Control |
| D08 | **Vision-Dominanz-Score** | Composite: D01–D07 gewichtet | Gesamtbild Map Control | Synergie-Indikator |

### Beziehungen (D)
```
D01 + D02 ──vorhanden in──→ calculateMultiplier() (SUP, JGL, MID)
D03 + D04 ──berechnet──→ D08 (Vision-Dominanz)
D05 ──normalisiert──→ D01 nach Spiellänge
D07 ──exklusiv für──→ JUNGLE (G-Kategorie)
D08 ──Composite aus──→ D01–D07
```

---

## E – Objektiv-Kontrolle (E01–E08)

| ID | Statistik | Formel | Benchmarks | Rollen-Relevanz |
|----|-----------|--------|------------|----------------|
| E01 | **Dragon Kills / Spiel** | Σ dragonKills / N | >1.5 = objektiv-stark | +10% JGL |
| E02 | **Baron Kills / Spiel** | Σ baronKills / N | >0.5 = gut | +10% JGL |
| E03 | **Turret Kills / Spiel** | Σ turretKills / N | >2 = push-stark | +10% TOP |
| E04 | **Rift Herald Secures** | Aus erweiterten Stats | >0.5 = gut | JGL/TOP |
| E05 | **Inhibitor Kills / Spiel** | Aus Match-Daten | Game-Closing-Potenzial | Alle Rollen |
| E06 | **Objektiv-Kombiscore** | E01 + E02 gewichtet | >2.0 JGL-Bonus | +6% bei hohem Score |
| E07 | **Elder Dragon Secures** | Aus erweiterten Stats | Late-Game-Entscheidend | Clutch-Faktor |
| E08 | **Objektiv-Steal-Rate** | Smite-Steals / Contests | JGL-spezifisch | Highlight-Metrik |

### Beziehungen (E)
```
E01 + E02 ──berechnet──→ E06 (Kombi-Score)
E06 ──fließt ein──→ calculateMultiplier() (JGL: +6%, SUP: +10%)
E03 ──fließt ein──→ calculateMultiplier() (TOP: +10%)
E04 ──korreliert──→ Early-Game-Dominanz (C07)
E08 ──exklusiv für──→ JUNGLE
```

---

## F – Rollenspezifisch: TOP (F01–F10)

| ID | Statistik | Beschreibung | Benchmark | Multiplikator-Effekt |
|----|-----------|--------------|-----------|---------------------|
| F01 | **CS/Min (TOP-Kontext)** | Farming-Effizienz als Toplaner | >8.0 elite | +10% |
| F02 | **Damage/Min (TOP-Kontext)** | Schadensoutput Toplane | >800 elite | +10% |
| F03 | **Turret Kills** | Turm-Zerstörung / Split-Push | >2 pro Spiel | +10% |
| F04 | **KDA (TOP-Kontext)** | Kill-Death-Assist-Ratio | >3.0 | +10% |
| F05 | **Isolated Death Rate** | Tode ohne Team in der Nähe | <15% = diszipliniert | Negativ-Indikator |
| F06 | **TP-Play Effectiveness** | Teleport-Einsatz in Teamfights | Schwer messbar, Proxy | Team-Impact |
| F07 | **Lane-Freeze-Index** | CS-Diff @ 10 ohne Roaming | >+10 CS = Lane-Kontrolle | Skill-Expression |
| F08 | **1v1 Solokill-Rate** | Solo Kills im Laning | >1.0 / Spiel | Dominanz-Signal |
| F09 | **Split-Push-Effizienz** | Turrets + CS wenn allein auf Sidelane | Situationsabhängig | Macro-Skill |
| F10 | **TOP Composite Score** | Gewichteter Durchschnitt F01–F09 | Normiert 0–100 | Gesamtwertung TOP |

### Beziehungen (F)
```
A08 = "TOP" ──aktiviert──→ F01–F10
F01 ←─ C01 (CS/Min), F02 ←─ B07 (DMG/Min), F03 ←─ E03, F04 ←─ B04
F05 ──inverse Korrelation──→ K05 (Team-Proximity)
F08 ←─ B06 (Solo Kills)
F10 = weighted_avg(F01–F09)
```

---

## G – Rollenspezifisch: JUNGLE (G01–G10)

| ID | Statistik | Beschreibung | Benchmark | Multiplikator-Effekt |
|----|-----------|--------------|-----------|---------------------|
| G01 | **KDA (JGL-Kontext)** | KDA als Jungler | >4.0 elite | +17.5% |
| G02 | **Dragon Kills** | Drachen-Kontrolle | >1.5 / Spiel | +10% |
| G03 | **Baron Kills** | Baron-Kontrolle | >0.5 / Spiel | +10% |
| G04 | **Objektiv-Kombiscore** | Dragons + Barons gewichtet | >2.0 | +6% |
| G05 | **Vision Score (JGL)** | Map-Awareness als Jungler | >25 | +6% |
| G06 | **Gank Success Rate** | Kills/Assists nach Lane-Visit | >50% = effektiv | Early-Game-Impact |
| G07 | **Counter-Jungle-Index** | Gegner-Jungle-CS gestohlen | Schwer direkt messbar | Aggression |
| G08 | **Pathing-Effizienz** | CS/Min relativ zu Objective-Secures | Balancierter Score | Macro-Skill |
| G09 | **First-Blood-Involvement** | FB als Jungler (Gank) | >40% = dominant | Aus B10 |
| G10 | **JGL Composite Score** | Gewichteter Durchschnitt G01–G09 | Normiert 0–100 | Gesamtwertung JGL |

### Beziehungen (G)
```
A08 = "JUNGLE" ──aktiviert──→ G01–G10
G01 ←─ B04, G02 ←─ E01, G03 ←─ E02, G04 ←─ E06, G05 ←─ D01
G06 ──korreliert──→ B10 (First Blood Rate)
G08 ──balanciert──→ G02/G03 vs. C01 (Farming vs. Ganking)
G10 = weighted_avg(G01–G09)
```

---

## H – Rollenspezifisch: MID (H01–H10)

| ID | Statistik | Beschreibung | Benchmark | Multiplikator-Effekt |
|----|-----------|--------------|-----------|---------------------|
| H01 | **KDA (MID-Kontext)** | KDA als Midlaner | >4.0 elite | +17.5% |
| H02 | **CS/Min (MID-Kontext)** | Farming-Effizienz Midlane | >8.0 elite | +10% |
| H03 | **Damage/Min (MID-Kontext)** | Schadensoutput Midlane | >900 elite | +17.5% |
| H04 | **Vision Score (MID)** | Map-Awareness als Midlaner | >20 | +6% |
| H05 | **Roaming-Impact** | Kill-Participation außerhalb Midlane | >30% pre-15 = hoch | Side-Lane-Einfluss |
| H06 | **Lane-Prio-Index** | CS-Lead + Push-Speed @ 10 min | Zeigt Lane-Priorität | Macro-Enabler |
| H07 | **Skill-Shot Accuracy** | Proxy: Damage/Kill-Ratio bei Mage-Champs | Schwer direkt messbar | Mechanik-Indikator |
| H08 | **Assassination-Rate** | Solo-Kills auf Carries | Assassin-spezifisch | Sub-Rollen-Differenzierung |
| H09 | **Teamfight-Entry-Timing** | Damage in ersten 5s eines Teamfights | Proxy über Damage-Spikes | Engagement-Qualität |
| H10 | **MID Composite Score** | Gewichteter Durchschnitt H01–H09 | Normiert 0–100 | Gesamtwertung MID |

### Beziehungen (H)
```
A08 = "MIDDLE" ──aktiviert──→ H01–H10
H01 ←─ B04, H02 ←─ C01, H03 ←─ B07, H04 ←─ D01
H05 ──korreliert──→ B05 (Kill Participation)
H06 ──ermöglicht──→ G06 (JGL Gank Success via Prio)
H10 = weighted_avg(H01–H09)
```

---

## I – Rollenspezifisch: ADC (I01–I10)

| ID | Statistik | Beschreibung | Benchmark | Multiplikator-Effekt |
|----|-----------|--------------|-----------|---------------------|
| I01 | **CS/Min (ADC-Kontext)** | Farming-Effizienz als ADC | >8.0 elite | +10% |
| I02 | **Damage/Min (ADC-Kontext)** | Schadensoutput ADC | >950 elite | +17.5% |
| I03 | **KDA (ADC-Kontext)** | KDA als ADC | >4.0 elite | +17.5% |
| I04 | **Damage Share %** | Anteil am Team-Schaden | >30% = Carry | Primär-Carry-Signal |
| I05 | **Deaths Pre-15** | Tode in der Lane-Phase | <1.5 = sicher | Überlebens-Skill |
| I06 | **Kiting-Effizienz** | Proxy: DMG-Dealt vs. DMG-Taken Ratio | >2.5 = gutes Positioning | Mechanik-Indikator |
| I07 | **Teamfight-Damage-Share** | % des Schadens in Teamfights | >35% = Carry-Performance | Late-Game-Impact |
| I08 | **Penta/Quadra-Kill-Rate** | Multi-Kills als ADC | Selten = hoch bewertet | Highlight / Carry |
| I09 | **Duo-Synergie-Score** | Performance mit vs. ohne Support-Duo | Vergleich Solo/Duo | Aus K-Kategorie |
| I10 | **ADC Composite Score** | Gewichteter Durchschnitt I01–I09 | Normiert 0–100 | Gesamtwertung ADC |

### Beziehungen (I)
```
A08 = "BOTTOM" ──aktiviert──→ I01–I10
I01 ←─ C01, I02 ←─ B07, I03 ←─ B04, I04 ←─ B09
I06 ──berechnet aus──→ B07 / B08 (DMG Dealt vs. Taken)
I09 ←─ K01 (Duo-Winrate-Differenz)
I10 = weighted_avg(I01–I09)
```

---

## J – Rollenspezifisch: SUPPORT (J01–J10)

| ID | Statistik | Beschreibung | Benchmark | Multiplikator-Effekt |
|----|-----------|--------------|-----------|---------------------|
| J01 | **Assists / Spiel** | Assist-Frequenz | >18 elite | +17.5% |
| J02 | **Vision Score (SUP)** | Vision als Support | >45 elite | +17.5% |
| J03 | **Wards Placed (SUP)** | Ward-Frequenz | >25 | +10% |
| J04 | **Objektiv-Assist-Score** | Dragon + Baron Assists | >0.5 combined | +10% |
| J05 | **Heal/Shield Given** | Aus erweiterten Stats | Champion-abhängig | Enchanter-Metrik |
| J06 | **CC-Score / Spiel** | Crowd-Control-Dauer | >30s = Engage-Support | Engage-vs-Enchanter |
| J07 | **ADC-Proximity-Rate** | % der Zeit in ADC-Nähe Laning | Roaming vs. Peeling Balance | Playstyle-Indikator |
| J08 | **Roaming-Success-Rate** | Kills/Assists nach Roam | >50% = effektiv | Map-Pressure |
| J09 | **Death-Ward-Trade** | Tode mit anschließendem Vision-Gain | Situationsabhängig | Opfer-Effizienz |
| J10 | **SUP Composite Score** | Gewichteter Durchschnitt J01–J09 | Normiert 0–100 | Gesamtwertung SUP |

### Beziehungen (J)
```
A08 = "SUPPORT" ──aktiviert──→ J01–J10
J01 ←─ B03, J02 ←─ D01, J03 ←─ D02, J04 ←─ E06
J05 ──Sub-Rollen──→ Enchanter vs. Engage-Tank
J07 ──inverse Korrelation──→ J08 (Roaming vs. Lane)
J10 = weighted_avg(J01–J09)
```

---

## K – Teamsynergie & Duo-Performance (K01–K10)

| ID | Statistik | Beschreibung | Berechnung |
|----|-----------|--------------|------------|
| K01 | **Duo-Winrate-Differenz** | Winrate mit Duo vs. Solo | Δ WR = WR_duo − WR_solo |
| K02 | **Kill Participation Delta** | KP-Veränderung im Duo | KP_duo − KP_solo |
| K03 | **Synergie-Score BOT** | ADC+SUP gemeinsame Performance | Composite aus KDA, Vision, WR im Duo |
| K04 | **JGL-MID-Synergie** | Jungle-Mid Zusammenspiel | Gemeinsame Objektiv-Secures + Roaming-Kills |
| K05 | **Team-Proximity-Index** | Durchschnittliche Nähe zu Teammates | Aus Positionsdaten (wenn verfügbar) |
| K06 | **Teamfight-Teilnahme** | % Teamfights teilgenommen | Kills+Assists in Multi-Player-Fights / Total Fights |
| K07 | **Comeback-Rate** | Spiele gewonnen aus Rückstand | gameWonFromBehind / N → +7% bei >30% |
| K08 | **Surrender-Rate** | Spiele durch Surrender verloren | surrendered / N → −8% bei >40% |
| K09 | **Carry-vs-Teamplay-Index** | Solo-Carry-Anteil vs. Team-Anteil | Solo Kills / Total Kills vs. Assists / Total KP |
| K10 | **Kommunikations-Proxy** | Ping-Nutzung / Shot-Calling (geschätzt) | Proxy: Warding nach Pings, Objektiv-Timing |

### Beziehungen (K)
```
K01 ──beeinflusst──→ I09 (ADC Duo-Synergie)
K03 ──Composite aus──→ I-Serie + J-Serie (im Duo)
K04 ──Composite aus──→ G-Serie + H-Serie (im Duo)
K07 ──vorhanden in──→ calculateMultiplier() (+7%)
K08 ──vorhanden in──→ calculateMultiplier() (−8%)
K09 ──klassifiziert──→ Spielertyp (Carry vs. Facilitator)
```

---

## L – Historische Trends (L01–L08)

| ID | Statistik | Beschreibung | Zeitfenster |
|----|-----------|--------------|-------------|
| L01 | **LP-Trend (7 Tage)** | LP-Veränderung letzte 7 Tage | Wöchentlich |
| L02 | **LP-Trend (30 Tage)** | LP-Veränderung letzte 30 Tage | Monatlich |
| L03 | **Winrate-Trend** | Gleitender Durchschnitt WR (letzte 20 Spiele vs. Gesamt) | Rolling Window |
| L04 | **KDA-Trend** | KDA-Veränderung über letzte 30 Spiele | Spielbasiert |
| L05 | **Rollen-Migration** | Rollenwechsel über die letzten 3 Monate | Quartalsweise |
| L06 | **Champion-Pool-Evolution** | Neue Champions im Pool / Veränderte Pickrate | Monatlich |
| L07 | **Peak-Rank-Differenz** | Aktueller Rang vs. Höchster Rang diese Season | Season-basiert |
| L08 | **Tilt-Indikator** | Lose-Streaks mit steigender Death-Rate | Echtzeit (letzte 5–10 Spiele) |

### Beziehungen (L)
```
L01 + L02 ──Gradient──→ M02 (Marktwert-Trend-Prognose)
L03 ──Early-Warning──→ L08 (Tilt-Detection)
L04 ──validiert──→ L03 (wenn KDA sinkt + WR sinkt = realer Trend)
L05 ──beeinflusst──→ A09 (Rollen-Flexibilität)
L07 ──Kontext für──→ M01 (Ist Spieler im Aufstieg oder Abstieg?)
L08 ──negativ──→ M06 (Risiko-Score)
```

---

## M – Prognose-Modell & Composite (M01–M06)

| ID | Statistik | Beschreibung | Modell |
|----|-----------|--------------|--------|
| M01 | **Marktwert (aktuell)** | `calculateMarketValue()` Output | base × multiplier |
| M02 | **Marktwert-Trend** | Projizierter Wert in 30 Tagen | Linearer Trend aus L01/L02 + aktuellem Multiplier |
| M03 | **Marktwert-Volatilität** | Standardabweichung des Werts über letzte 10 Berechnungen | σ(MV_history) |
| M04 | **Rollen-Composite-Score** | Score der Primärrolle (F10/G10/H10/I10/J10) | 0–100 normiert |
| M05 | **Gesamt-Spieler-Rating** | Gewichteter Composite aller Kategorien | Σ(w_i × Score_i) für A–L |
| M06 | **Risiko-Score** | Wahrscheinlichkeit eines Wert-Verfalls | Basierend auf L07, L08, K08 |

### Beziehungen (M)
```
M01 = getBaseValue(A01–A04) × calculateMultiplier(B–E + F/G/H/I/J)
M02 = M01 × (1 + trend_coefficient(L01, L02))
M03 = stddev(M01_t-1, M01_t-2, ... M01_t-10)
M04 = {F10|G10|H10|I10|J10} basierend auf A08
M05 = 0.40×M01 + 0.25×M04 + 0.15×K_composite + 0.10×L_composite + 0.10×D08
M06 = f(L07, L08, K08, M03)  // höherer Wert = höheres Risiko
```

---

## Globaler Abhängigkeitsgraph

```
                    ┌──────────────┐
                    │   A: Basis   │
                    │  Identität   │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
      ┌──────────┐  ┌──────────┐  ┌──────────┐
      │ B: Kampf │  │ C: Farm  │  │ D: Vision│
      └────┬─────┘  └────┬─────┘  └────┬─────┘
           │              │              │
           └──────┬───────┴──────┬───────┘
                  ▼              ▼
           ┌──────────┐  ┌──────────────────────────────┐
           │E: Objekt.│  │ F/G/H/I/J: Rollenspezifisch  │
           └────┬─────┘  └──────────────┬───────────────┘
                │                       │
                └───────────┬───────────┘
                            ▼
                    ┌──────────────┐
                    │ K: Synergie  │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ L: Trends    │
                    └──────┬───────┘
                           │
                           ▼
                  ┌────────────────┐
                  │ M: Prognose &  │
                  │   Composite    │
                  └────────────────┘
```

---

## Gewichtungsmatrix für Marktwert

Die finale Marktwertberechnung kombiniert die Kategorien mit folgenden Gewichten:

| Kategorie | Gewicht | Begründung |
|-----------|---------|------------|
| A (Basis-Rang) | 50% | Tier/LP bestimmt den Grundwert (`getBaseValue`) |
| B (Kampf) | 12% | KDA und Damage sind universelle Skill-Indikatoren |
| C (Farming) | 5% | CS ist rollensensitiv, aber grundlegend |
| D (Vision) | 5% | Besonders für SUP/JGL relevant |
| E (Objektive) | 5% | Macro-Game-Indikator |
| F–J (Rolle) | 10% | Rollenspezifische Tiefenanalyse |
| K (Synergie) | 5% | Team-Kompatibilität |
| L (Trends) | 5% | Momentum und Stabilität |
| M (Prognose) | 3% | Zukunftsorientierte Adjustierung |

---

## Mapping zu bestehendem Code (`marketvalue.ts`)

| Code-Element | Knowledge Graph IDs |
|---|---|
| `MatchData.kills/deaths/assists` | B01, B02, B03 → B04 |
| `MatchData.win` | A07 |
| `MatchData.cs` | C01 |
| `MatchData.damageDealt` | B07 |
| `MatchData.visionScore` | D01 |
| `MatchData.wardsPlaced` | D02 |
| `MatchData.firstBloodKill/Assist` | B10 |
| `MatchData.firstBloodVictim` | B11 |
| `MatchData.dragonKills` | E01 |
| `MatchData.baronKills` | E02 |
| `MatchData.turretKills` | E03 |
| `MatchData.gameWonFromBehind` | K07 |
| `MatchData.surrendered` | K08 |
| `RankedData.tier/rank/lp` | A01, A02, A03 |
| `getBaseValue()` | A01–A04 → M01 |
| `detectPrimaryRole()` | A08 |
| `calculateMultiplier()` | B–E + F/G/H/I/J → M01 |

### Noch nicht implementierte Stats (Erweiterungspotenzial)

Die folgenden Stats aus dem Knowledge Graph sind **nicht** in der aktuellen `marketvalue.ts` abgebildet
und erfordern zusätzliche Riot-API-Daten oder berechnete Felder:

- **C02–C04**: Timeline-Daten (CS @ 10/15, CS-Diff) → `match-v5/timeline` Endpoint
- **C05–C08**: Gold-Metriken → erweiterte Match-Daten
- **B05, B06, B08, B09, B12**: Kill Participation, Solo Kills, Damage Taken, Multi-Kills
- **D03–D07**: Control Wards, Wards Destroyed, Scuttle → erweiterte Match-Daten
- **E04, E05, E07, E08**: Herald, Inhibitors, Elder Dragon, Steals
- **F05–F09, G06–G08, H05–H09, I04–I08, J05–J09**: Tiefe rollenspezifische Metriken
- **K01–K06, K09–K10**: Duo/Synergie-Daten → erfordert Spielerverknüpfung
- **L01–L08**: Historische Daten → erfordert Zeitreihen-Speicherung (Supabase)
- **M02–M06**: Prognose-Modelle → erfordert historische Marktwert-Snapshots
