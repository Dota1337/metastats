#!/usr/bin/env node
/**
 * One-shot dev-environment setup. Run after `git clone` and re-run after
 * pulling updates to infra/git-hooks/ or infra/claude-agents/:
 *
 *   npm run setup-hooks
 *
 * Installs:
 *   1. Git hooks     infra/git-hooks/* → .git/hooks/*
 *   2. Subagents     infra/claude-agents/*.md → .claude/agents/<filename>.md
 *   3. Claude hooks  infra/claude-settings/hooks.json → .claude/settings.json (merge)
 *
 * .claude/ is gitignored (lives per workstation), so subagents need to be
 * installed once per machine. Hooks use copyFile (not symlink) so they
 * work on Windows without dev-mode and survive `git reset --hard`.
 */
import { readdirSync, copyFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function install(srcDir, dstDir, filterFn, postProcess) {
  if (!existsSync(srcDir)) { console.warn(`  (skip) ${srcDir} missing`); return 0; }
  if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });
  let count = 0;
  for (const f of readdirSync(srcDir)) {
    if (!filterFn(f)) continue;
    const from = join(srcDir, f);
    const to = join(dstDir, f);
    copyFileSync(from, to);
    if (postProcess) postProcess(to);
    console.log(`  installed ${from} → ${to}`);
    count++;
  }
  return count;
}

if (!existsSync('.git')) { console.error('Not a git working tree — .git/ missing.'); process.exit(1); }

console.log('[1/3] Git hooks');
const hookCount = install(
  'infra/git-hooks',
  '.git/hooks',
  f => !f.startsWith('.') && !f.endsWith('.md'),
  // POSIX needs +x for hooks; Windows ignores the mode and runs them via sh anyway.
  to => { try { chmodSync(to, 0o755); } catch { /* windows */ } },
);

console.log('[2/3] Claude subagents');
const agentCount = install(
  'infra/claude-agents',
  '.claude/agents',
  f => f.endsWith('.md'),
);

console.log('[3/3] Claude hooks');
const claudeHookCount = installClaudeHooks();

console.log(`setup-hooks: ${hookCount} git hook(s) + ${agentCount} subagent(s) + ${claudeHookCount} claude hook(s) installed.`);

/**
 * Merges infra/claude-settings/hooks.json into .claude/settings.json.
 *
 * Merge instead of overwrite: settings.json may carry unrelated user config
 * (and on this machine it is a symlink into a synced folder). We only touch
 * entries whose command mentions agentdb — ours — and leave everything else
 * untouched. Re-running is therefore idempotent rather than duplicating.
 */
function installClaudeHooks() {
  const src = 'infra/claude-settings/hooks.json';
  if (!existsSync(src)) { console.warn(`  (skip) ${src} missing`); return 0; }

  const managed = JSON.parse(readFileSync(src, 'utf8')).hooks || {};
  const dst = join('.claude', 'settings.json');
  if (!existsSync('.claude')) mkdirSync('.claude', { recursive: true });

  let settings = {};
  if (existsSync(dst)) {
    try { settings = JSON.parse(readFileSync(dst, 'utf8')); }
    catch { console.warn(`  (warn) ${dst} is not valid JSON — starting fresh`); }
  }
  settings.hooks ||= {};

  const isOurs = (entry) => JSON.stringify(entry).includes('agentdb');

  let count = 0;
  for (const [event, entries] of Object.entries(managed)) {
    const existing = (settings.hooks[event] || []).filter(e => !isOurs(e));
    settings.hooks[event] = [...existing, ...entries];
    count += entries.length;
    console.log(`  installed ${event} → ${dst}`);
  }

  writeFileSync(dst, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return count;
}
