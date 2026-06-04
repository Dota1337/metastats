-- Hotfix: strip un-resolved Liquipedia {{SetName/17}} template from 3 tournament names
-- (proper crawler fix lives in scripts/crawl-tft-tournaments.mjs::unwiki — next
-- weekly crawl will overwrite these anyway, but we don't want users seeing
-- raw wikitext until then).

update tft_tournaments set name = 'Space Gods: AMER Regional Finals'
  where id = 'space-gods-amer-regional-finals';

update tft_tournaments set name = 'Space Gods: EMEA Regional Finals'
  where id = 'space-gods-emea-regional-finals';

update tft_tournaments set name = 'Space Gods: APAC Regional Finals'
  where id = 'space-gods-apac-regional-finals';

select id, name from tft_tournaments where id like 'space-gods-%-regional-finals';
