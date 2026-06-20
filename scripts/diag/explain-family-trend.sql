explain analyze select day::date as day, sum(games)::bigint, sum(sum_placement)::bigint, sum(top4)::bigint, sum(top1)::bigint
from tft_daily_comp_stats
where region = any(array['euw1','kr','na1','eun1','br1','jp1'])
  and bucket = any(array['master','master_plus','grandmaster','challenger','diamond'])
  and cluster_key = any(array['TFT17_Astronaut@2_TFT17_Gnar*2','TFT17_Astronaut@2_TFT17_Gnar*3','TFT17_Astronaut@3_TFT17_Gnar*3','TFT17_Astronaut@3_TFT17_Gnar*3#TFT17_Bard','TFT17_Astronaut@4_TFT17_Gnar*3'])
  and day > current_date - 14
group by day::date
order by day asc;
