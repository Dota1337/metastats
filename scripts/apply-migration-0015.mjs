/**
 * One-shot migration applier for 0015_tft_pro_player_history.sql.
 * Reads DATABASE_URL from .env.local, applies the SQL, verifies columns.
 */
import fs from 'node:fs';
import pg from 'pg';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  if (!line.includes('=') || line.startsWith('#')) continue;
  const i = line.indexOf('=');
  const k = line.slice(0, i).trim();
  const v = line.slice(i + 1).trim();
  if (!process.env[k]) process.env[k] = v;
}

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL missing'); process.exit(1); }

// Manual parse because the password contains '#' which Node's URL parser
// interprets as a fragment delimiter, breaking pg-connection-string.
const m = url.match(/^postgres(?:ql)?:\/\/([^:]+):(.+)@([^:/]+):(\d+)\/(.+)$/);
if (!m) { console.error('DATABASE_URL parse failed'); process.exit(1); }
const [, user, password, host, port, database] = m;

const sql = fs.readFileSync('supabase/migrations/0015_tft_pro_player_history.sql', 'utf8');

const client = new pg.Client({
  user, password, host, port: Number(port), database,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
console.log('connected.');
await client.query(sql);
console.log('migration applied.');
const r = await client.query(
  "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='tft_pro_players' AND column_name IN ('total_earnings_usd','image_url','tournament_results') ORDER BY column_name"
);
console.log('columns:', r.rows);
await client.end();
