-- 0057: letzte Anon-Grants aus der Sicherheitswelle C5 nachziehen
--
-- `tft_pro_validation_log` hat eine Policy `service_role full`, die auf PUBLIC
-- zielt und erst im USING-Ausdruck auf service_role einschraenkt. Fuer den
-- Waechter aus 0056 sieht das aus wie "eine SELECT-Policy trifft anon" — er
-- kann einen USING-Ausdruck nicht auswerten. Real bekommt anon 0 Zeilen
-- (geprueft), es ist also kein Abfluss.
--
-- Statt den Fund dauerhaft auf eine Ausnahmeliste zu setzen — wo er auch dann
-- stumm bliebe, wenn jemand spaeter den USING-Ausdruck lockert — nehmen wir der
-- Rolle das Recht ganz. Die Tabelle ist ein reines Innenleben des Pro-Crawls;
-- kein Lesepfad der Website beruehrt sie, und service_role umgeht RLS ohnehin.
--
-- Danach ist `matches` (Owner-Policy je angemeldetem Nutzer) der einzige
-- gewollte Rest — die einzige Ausnahme im Vertrag `sicherheit/anon-lockout`.

revoke select on public.tft_pro_validation_log from anon, authenticated;

notify pgrst, 'reload schema';
