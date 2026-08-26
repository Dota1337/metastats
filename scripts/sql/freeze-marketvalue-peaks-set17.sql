-- Set-17-Peaks einfrieren. Idempotent (on conflict do update), damit ein
-- zweiter Lauf vor dem Bump den Stand nur aktualisiert.
--
-- Cutoff 2026-08-25: letzter Tag, an dem tft-set.json nachweislich auf 17
-- stand. Bewusst NICHT setEndDate aus tft-set.json ("2026-07-28") — das ist
-- stale und wuerfe die ~1,01 Mio August-Zeilen weg.
-- Filter sample_size >= 40: unter 40 Spielen ist der Multiplier systematisch
-- ueberhoeht (avg 1,317 bei 20-39 Spielen gegen 1,029 bei >=100).

with cov as (
  select puuid,
         count(*)              as snapshot_count,
         min(snapshot_date)    as first_snapshot_date,
         max(snapshot_date)    as last_snapshot_date
  from tft_player_marketvalue_snapshots
  where snapshot_date <= date '2026-08-25'
  group by puuid
),
peak as (
  select distinct on (s.puuid)
         s.puuid, s.region, s.game_name, s.tag_line, s.snapshot_date,
         s.tier, s.rank, s.lp, s.ladder_rank,
         s.base_value, s.multiplier, s.final_value, s.sample_size, s.damping
  from tft_player_marketvalue_snapshots s
  where s.snapshot_date <= date '2026-08-25'
    and s.sample_size >= 40
  order by s.puuid, s.final_value desc, s.snapshot_date asc
)
insert into tft_player_marketvalue_peaks (
  puuid, set_number, region, game_name, tag_line, snapshot_date,
  tier, rank, lp, ladder_rank,
  base_value, multiplier, final_value, sample_size, damping,
  low_confidence, snapshot_count, first_snapshot_date, last_snapshot_date
)
select p.puuid, 17, p.region, p.game_name, p.tag_line, p.snapshot_date,
       p.tier, p.rank, p.lp, p.ladder_rank,
       p.base_value, p.multiplier, p.final_value, p.sample_size, p.damping,
       (p.damping < 1), c.snapshot_count, c.first_snapshot_date, c.last_snapshot_date
from peak p
join cov c on c.puuid = p.puuid
on conflict (puuid, set_number) do update set
  region              = excluded.region,
  game_name           = excluded.game_name,
  tag_line            = excluded.tag_line,
  snapshot_date       = excluded.snapshot_date,
  tier                = excluded.tier,
  rank                = excluded.rank,
  lp                  = excluded.lp,
  ladder_rank         = excluded.ladder_rank,
  base_value          = excluded.base_value,
  multiplier          = excluded.multiplier,
  final_value         = excluded.final_value,
  sample_size         = excluded.sample_size,
  damping             = excluded.damping,
  low_confidence      = excluded.low_confidence,
  snapshot_count      = excluded.snapshot_count,
  first_snapshot_date = excluded.first_snapshot_date,
  last_snapshot_date  = excluded.last_snapshot_date,
  frozen_at           = now();
