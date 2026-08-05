-- Familien-Coverage der MetaTFT-Guides als RPC.
--
-- Warum eine Funktion und nicht zweimal SQL: die Zahl wird ab jetzt an zwei
-- Stellen gebraucht — vom Verifier (`npm run verify:coverage`, per pg) und vom
-- Laufzeit-Vertrag (`metatft-comps/familien-abdeckung`, per PostgREST von der
-- Box aus). PostgREST kann kein GROUP BY mit regexp_replace, und zwei Kopien
-- derselben Aggregation driften garantiert auseinander. Die Funktion ist die
-- einzige Definition; beide Aufrufer lesen daraus.
--
-- Die Normalisierung folgt dem User-Override vom 2026-06-21: `<trait>__<carry>`
-- ist die kanonische Familien-Granularität, Level UND Augment sind
-- wegkonsolidiert. Sie passiert VOR dem GROUP BY — sonst zählt jede Familie
-- einmal pro Trait-Level und der Top-N-Schnitt trifft Level-Varianten statt
-- Familien (der Bug, der die Coverage bis 2026-08-05 auf 74,4 % statt 70,0 %
-- auswies).
--
-- OUT-Namen sind bewusst `family_key`/`total_games` und nicht `family`/`games`:
-- ein OUT-Parameter namens `games` würde im Funktionskörper mit der
-- gleichnamigen Tabellenspalte kollidieren.

CREATE OR REPLACE FUNCTION public.get_metatft_family_coverage(
  p_days int DEFAULT 7,
  p_set  int DEFAULT 17,
  p_top  int DEFAULT 50
)
RETURNS TABLE (family_key text, total_games int)
LANGUAGE sql
STABLE
AS $$
  SELECT
    regexp_replace(
      regexp_replace(cluster_key, '(\*\d|~[A-Za-z]+|#.+)', '', 'g'),
      '@\d+_', '__'
    ),
    SUM(games)::int
  FROM tft_daily_comp_stats
  WHERE day >= current_date - p_days
    AND set_number = p_set
    AND bucket IN ('master', 'grandmaster', 'challenger')
  GROUP BY 1
  HAVING SUM(games) >= 100
  ORDER BY 2 DESC
  LIMIT p_top;
$$;

-- Internes Ops-RPC: nur der Service-Role-Key darf es aufrufen, nicht der
-- öffentliche anon-Key aus dem Browser.
REVOKE ALL ON FUNCTION public.get_metatft_family_coverage(int, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_metatft_family_coverage(int, int, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_metatft_family_coverage(int, int, int) TO service_role;
