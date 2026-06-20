// Markdown-Section-Splitter mit Code-Block-Stripping + Topic-Tag-Inferenz.
// data-skeptic-Verdict 2026-06-20: Code-Blocks verwässern Embedding-Qualität,
// Tabellen sind keine Prosa, deutsche + englische Texte mischen sich.

import { createHash } from 'node:crypto';

// Heuristik: H2 default. H3 wenn parent-H2-Block >150 Zeilen.
const HARD_SPLIT_THRESHOLD_LINES = 150;

// Topic-Tag-Inferenz aus File-Pfad + Content. Cluster-Skew-Mitigation.
const TOPIC_PATTERNS = [
  { pattern: /tft|comp|champion|trait|augment|cluster|aggregat/i, tag: 'tft' },
  { pattern: /hetzner|systemd|crawler|cron|deploy|infra|vercel|supabase/i, tag: 'infra' },
  { pattern: /multi.?review|spec|plan|workflow|feedback|memory/i, tag: 'workflow' },
  { pattern: /next\.?js|react|typescript|api.route|component|css|tsx/i, tag: 'coding' },
];

function inferTopicTag(filePath, content) {
  const haystack = `${filePath} ${content.slice(0, 500)}`;
  for (const { pattern, tag } of TOPIC_PATTERNS) {
    if (pattern.test(haystack)) return tag;
  }
  return 'general';
}

// Section-Type aus File-Name-Prefix.
function inferSectionType(filePath) {
  const name = filePath.split(/[/\\]/).pop() || '';
  if (name.startsWith('feedback_')) return 'feedback';
  if (name.startsWith('reference_')) return 'reference';
  if (name.startsWith('project_')) return 'project';
  return 'system';
}

// Parse YAML-Frontmatter (`---` block am Anfang). Liefert { frontmatter, body }.
function parseFrontmatter(markdown) {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/.exec(markdown);
  if (!m) return { frontmatter: null, body: markdown };
  const yaml = m[1];
  const body = m[2];
  // Sehr leichter YAML-Parser — nur Key: Value Zeilen + Strings.
  const frontmatter = {};
  for (const line of yaml.split('\n')) {
    const kv = /^([\w_]+):\s*(.+?)\s*$/.exec(line);
    if (kv) {
      let val = kv[2];
      // Quoted strings raus
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // Numeric
      if (/^-?\d+$/.test(val)) val = Number(val);
      frontmatter[kv[1]] = val;
    }
  }
  return { frontmatter, body };
}

// Markdown-Cleanup für Embedding: Code-Blocks raus, Tabellen flatten, HTML-Tags raus.
function cleanForEmbedding(content) {
  let out = content;
  // ```code-blocks``` komplett raus (verwässert Embedding-Raum mit Code-Identifiern)
  out = out.replace(/```[\s\S]*?```/g, ' ');
  // `inline-code` behalten ohne Backticks (das ist meist Variable/File-Name, semantisch relevant)
  out = out.replace(/`([^`]+)`/g, '$1');
  // Tabellen flatten: `| col1 | col2 |` → `col1 col2`
  out = out.replace(/\|/g, ' ');
  // Markdown-Link-Syntax raus, Text behalten: [text](url) → text
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // HTML-Tags raus
  out = out.replace(/<[^>]+>/g, ' ');
  // Mehrfach-Whitespace zusammenfassen
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

// Hauptfunktion: Markdown → Array<{ section_title, content, content_hash, ... }>
export function splitSections(markdown, filePath) {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const sectionType = inferSectionType(filePath);

  // Erste Split: H2 (## ) Blöcke
  const h2Blocks = splitByHeading(body, 2);

  // Wenn nur 1 H2-Block (= kein H2-Heading im File): ganze Memory als 1 Section
  if (h2Blocks.length === 1 && !h2Blocks[0].title) {
    const content = body;
    const cleaned = cleanForEmbedding(content);
    return [{
      section_title: null,
      content,
      content_for_embedding: cleaned,
      content_hash: hashContent(content),
      section_type: sectionType,
      topic_tag: inferTopicTag(filePath, content),
      set_version: frontmatter?.set_version ?? null,
      stale_after_days: frontmatter?.stale_after_days ?? null,
      frontmatter_meta: frontmatter ? JSON.stringify(frontmatter) : null,
    }];
  }

  // Hard-Split bei H2-Blöcken >150 Zeilen auf H3.
  const sections = [];
  for (const h2 of h2Blocks) {
    const lineCount = h2.content.split('\n').length;
    if (lineCount > HARD_SPLIT_THRESHOLD_LINES) {
      const h3Blocks = splitByHeading(h2.content, 3);
      for (const h3 of h3Blocks) {
        const fullTitle = h3.title
          ? `${h2.title || ''} / ${h3.title}`.trim().replace(/^\//, '').trim()
          : (h2.title || null);
        sections.push(buildSection(fullTitle, h3.content, filePath, frontmatter, sectionType));
      }
    } else {
      sections.push(buildSection(h2.title, h2.content, filePath, frontmatter, sectionType));
    }
  }

  return sections;
}

function buildSection(title, content, filePath, frontmatter, sectionType) {
  const cleaned = cleanForEmbedding(content);
  return {
    section_title: title,
    content,
    content_for_embedding: cleaned,
    content_hash: hashContent(content),
    section_type: sectionType,
    topic_tag: inferTopicTag(filePath, content),
    set_version: frontmatter?.set_version ?? null,
    stale_after_days: frontmatter?.stale_after_days ?? null,
    frontmatter_meta: frontmatter ? JSON.stringify(frontmatter) : null,
  };
}

// Split body by Markdown-Heading of given level (2 = H2 `## `, 3 = H3 `### `).
function splitByHeading(body, level) {
  const prefix = '#'.repeat(level) + ' ';
  const lines = body.split('\n');
  const blocks = [];
  let current = { title: null, content: '' };
  for (const line of lines) {
    if (line.startsWith(prefix) && !line.startsWith(prefix.replace(' ', '#'))) {
      // New heading — close current, start new
      if (current.content.trim() || current.title) {
        blocks.push({ title: current.title, content: current.content.trim() });
      }
      current = { title: line.slice(prefix.length).trim(), content: '' };
    } else {
      current.content += line + '\n';
    }
  }
  if (current.content.trim() || current.title) {
    blocks.push({ title: current.title, content: current.content.trim() });
  }
  return blocks.length > 0 ? blocks : [{ title: null, content: body.trim() }];
}

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}
