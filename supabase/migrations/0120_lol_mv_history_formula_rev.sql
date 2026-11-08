-- 0120: Stand der Marktwert-Rechnung je Verlaufszeile (08.11.2026)
--
-- Warum: Der Support-Zweig in app/lib/marketvalue.ts griff nie (Rolle heisst
-- UTILITY, geprueft wurde 'SUPPORT'), Supports liefen durch den Schuetzen-Zweig.
-- Ab Rechnungsstand 2 werden sie richtig bewertet; ihr Wert steigt dadurch
-- einmalig. Ohne Kennzeichen hielten Auffaelligkeiten, Wochenveraenderung und
-- Transfer-Vorhersage diesen Sprung fuer eine echte Veraenderung.
-- app/lib/marketvalue-history.ts vergleicht deshalb nur Zeilen mit gleichem
-- Stand (wie split_estimated, Migration 0080).
--
-- null = Ursprungsrechnung. 2 = Rechnung vom 08.11.2026 fuer ALLE Rollen:
-- Support-Zweig fuer UTILITY, ohne Remakes, ohne Autofill-Spiele (der Spiel-Filter
-- bewegt jede Rolle). Vor dem ersten Schreiben so festgelegt — keine Zeile trug
-- je einen Stand (4.054 von 4.054 null, gemessen 08.11.2026).
-- Nur eine neue, leere Spalte ohne Vorgabewert: aendert nur den Katalog.
--
-- Einspielen: node scripts/db-exec.mjs supabase/migrations/0120_lol_mv_history_formula_rev.sql
-- Rueckweg:   alter table public.market_value_history drop column if exists formula_rev;

set lock_timeout = '5s';

alter table public.market_value_history
  add column if not exists formula_rev smallint;

comment on column public.market_value_history.formula_rev is
  'Stand der LoL-Marktwert-Rechnung (null = Ursprung, 2 = Rechnung vom 08.11.2026 fuer alle Rollen: Support-Zweig, ohne Remakes, ohne Autofill). Vergleiche nur innerhalb gleichen Stands.';
