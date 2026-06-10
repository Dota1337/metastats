#!/usr/bin/env node
/**
 * One-shot dev-environment setup. Run after `git clone` and re-run after
 * pulling updates to infra/git-hooks/ or infra/claude-agents/:
 *
 *   npm run setup-hooks
 *
 * Installs:
 *   1. Git hooks  infra/git-hooks/* → .git/hooks/*
 *   2. Subagents  infra/claude-agents/*.md → .claude/agents/<filename>.md
 *
 * .claude/ is gitignored (lives per workstation), so subagents need to be
 * installed once per machine. Hooks use copyFile (not symlink) so they
 * work on Windows without dev-mode and survive `git reset --hard`.
 */
import { readdirSync, copyFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
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

console.log('[1/2] Git hooks');
const hookCount = install(
  'infra/git-hooks',
  '.git/hooks',
  f => !f.startsWith('.') && !f.endsWith('.md'),
  // POSIX needs +x for hooks; Windows ignores the mode and runs them via sh anyway.
  to => { try { chmodSync(to, 0o755); } catch { /* windows */ } },
);

console.log('[2/2] Claude subagents');
const agentCount = install(
  'infra/claude-agents',
  '.claude/agents',
  f => f.endsWith('.md'),
);

console.log(`setup-hooks: ${hookCount} hook(s) + ${agentCount} subagent(s) installed.`);
