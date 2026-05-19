import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

type Frontmatter = Record<string, unknown>;
type ContentType = 'post' | 'story' | 'gallery';

const postsRoot = path.join(process.cwd(), '_posts');
const defaultAuthor = 'Jeff Patton';
const dryRun = process.argv.includes('--dry-run');

type Stats = {
  files: number;
  changed: number;
  contentTypes: Record<ContentType, number>;
  added: Record<string, number>;
};

const stats: Stats = {
  files: 0,
  changed: 0,
  contentTypes: {
    post: 0,
    story: 0,
    gallery: 0,
  },
  added: {
    content_type: 0,
    slug: 0,
    post_id: 0,
    status: 0,
    authors: 0,
    summary: 0,
  },
};

async function main() {
  const files = (await fs.readdir(postsRoot)).filter((file) => file.endsWith('.md')).sort();

  for (const file of files) {
    await normalizeFile(file);
  }

  console.log(
    `${dryRun ? 'Would normalize' : 'Normalized'} ${stats.changed} of ${stats.files} post frontmatter files.`,
  );
  console.log(`Content types: ${JSON.stringify(stats.contentTypes)}`);
  console.log(`Added or corrected fields: ${JSON.stringify(stats.added)}`);
}

async function normalizeFile(file: string) {
  stats.files += 1;

  const fullPath = path.join(postsRoot, file);
  const raw = await fs.readFile(fullPath, 'utf8');
  const frontmatter = frontmatterRange(raw);

  if (!frontmatter) {
    console.warn(`Skipping ${file}: missing frontmatter`);
    return;
  }

  const parsed = matter(raw);
  const filename = path.basename(file, '.md');
  const slug = slugFromPostFilename(filename);
  const source = sourceType(parsed.data);
  const type = classifyContentType(source, parsed.data);
  const status = statusFromPublished(parsed.data);
  const authors = authorsFromFrontmatter(parsed.data);
  const summary = summaryFromPost(parsed.data, parsed.content, type);
  stats.contentTypes[type] += 1;

  let yaml = frontmatter.yaml;
  const originalYaml = yaml;

  yaml = ensureField(yaml, 'content_type', formatScalar(type), 'title');
  yaml = ensureField(yaml, 'slug', formatScalar(slug), 'content_type');
  yaml = ensurePostId(yaml, parsed.data, filename);
  yaml = ensureField(yaml, 'status', formatScalar(status), 'published');
  yaml = ensureField(yaml, 'authors', formatList(authors), 'author');
  yaml = ensureField(yaml, 'summary', formatScalar(summary), 'authors');

  if (yaml === originalYaml) {
    return;
  }

  const next = `${frontmatter.before}---${frontmatter.newline}${yaml}${frontmatter.newline}---${frontmatter.after}`;
  stats.changed += 1;

  if (!dryRun) {
    await fs.writeFile(fullPath, next, 'utf8');
  }
}

function frontmatterRange(raw: string) {
  const firstLineEnd = raw.indexOf('\n');
  const newline = firstLineEnd !== -1 && raw.slice(0, firstLineEnd + 1).endsWith('\r\n') ? '\r\n' : '\n';
  const match = /^(\uFEFF?)---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*)$/.exec(raw);

  if (!match) {
    return undefined;
  }

  return {
    before: match[1],
    yaml: match[2],
    after: match[3],
    newline,
  };
}

function ensureField(yaml: string, key: string, value: string, anchor?: string) {
  if (hasNonEmptyField(yaml, key)) {
    return yaml;
  }

  stats.added[key] += 1;
  return insertField(yaml, key, value, anchor);
}

function ensurePostId(yaml: string, data: Frontmatter, filename: string) {
  const existing = textValue(data.post_id);

  if (existing) {
    return yaml;
  }

  const value = textValue(data.id) || filename;
  stats.added.post_id += 1;

  if (hasField(yaml, 'post_id')) {
    return replaceField(yaml, 'post_id', `post_id: ${formatScalar(value)}`);
  }

  return insertField(yaml, 'post_id', formatScalar(value), 'slug');
}

function hasField(yaml: string, key: string) {
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:`, 'm');
  return pattern.test(yaml);
}

function hasNonEmptyField(yaml: string, key: string) {
  const block = fieldBlock(yaml, key);

  if (!block) {
    return false;
  }

  const [, firstLine, nested] = block;
  return firstLine.replace(new RegExp(`^${escapeRegExp(key)}\\s*:\\s*`), '').trim().length > 0 || nested.trim().length > 0;
}

function fieldBlock(yaml: string, key: string): [number, string, string] | undefined {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${escapeRegExp(key)}\\s*:`).test(line));

  if (start === -1) {
    return undefined;
  }

  let end = start + 1;

  while (end < lines.length && !/^[A-Za-z0-9_-]+\s*:/.test(lines[end])) {
    end += 1;
  }

  return [start, lines[start], lines.slice(start + 1, end).join('\n')];
}

function replaceField(yaml: string, key: string, replacement: string) {
  const lines = yaml.split(/\r?\n/);
  const block = fieldBlock(yaml, key);

  if (!block) {
    return yaml;
  }

  const [start] = block;
  let end = start + 1;

  while (end < lines.length && !/^[A-Za-z0-9_-]+\s*:/.test(lines[end])) {
    end += 1;
  }

  lines.splice(start, end - start, replacement);
  return lines.join('\n');
}

function insertField(yaml: string, key: string, value: string, anchor?: string) {
  const lines = yaml.split(/\r?\n/);
  const separator = value.startsWith('\n') ? '' : ' ';
  const fieldLines = `${key}:${separator}${value}`.split('\n');
  const index = anchor ? endOfField(lines, anchor) : -1;

  if (index === -1) {
    lines.push(...fieldLines);
  } else {
    lines.splice(index, 0, ...fieldLines);
  }

  return lines.join('\n');
}

function endOfField(lines: string[], key: string) {
  const start = lines.findIndex((line) => new RegExp(`^${escapeRegExp(key)}\\s*:`).test(line));

  if (start === -1) {
    return -1;
  }

  let end = start + 1;

  while (end < lines.length && !/^[A-Za-z0-9_-]+\s*:/.test(lines[end])) {
    end += 1;
  }

  return end;
}

function sourceType(data: Frontmatter) {
  const source = data.source;

  if (source && typeof source === 'object' && !(source instanceof Date)) {
    return textValue((source as Frontmatter).type).toLowerCase();
  }

  return textValue(source).toLowerCase();
}

function classifyContentType(source: string, data: Frontmatter): ContentType {
  const explicitType = textValue(data.content_type || data.contentType || data.type).toLowerCase();

  if (explicitType === 'article' || explicitType === 'post') {
    return 'post';
  }

  if (explicitType === 'story') {
    return 'story';
  }

  if (explicitType === 'gallery') {
    return 'gallery';
  }

  if (
    source === 'facebook' &&
    textValue((data.source as Frontmatter | undefined)?.subtype).toLowerCase() === 'album'
  ) {
    return 'gallery';
  }

  if (source === 'wordpress' || stringArray(data.tags).includes('wordpress')) {
    return 'post';
  }

  return 'story';
}

function statusFromPublished(data: Frontmatter) {
  const explicit = textValue(data.status).toLowerCase();

  if (explicit === 'draft' || explicit === 'archived') {
    return explicit;
  }

  if (data.published === false || textValue(data.published).toLowerCase() === 'false') {
    return 'draft';
  }

  return 'published';
}

function authorsFromFrontmatter(data: Frontmatter) {
  const explicit = stringArray(data.authors);

  if (explicit.length > 0) {
    return explicit;
  }

  const author = textValue(data.author);
  return [author || defaultAuthor];
}

function summaryFromPost(data: Frontmatter, content: string, type: ContentType) {
  const explicit = textValue(data.summary) || textValue(data.excerpt);

  if (explicit) {
    return cleanSummary(explicit);
  }

  const source = data.source;

  if (source && typeof source === 'object' && !(source instanceof Date)) {
    const sourceData = source as Frontmatter;
    const caption = textValue(sourceData.caption);

    if (caption) {
      return cleanSummary(caption);
    }
  }

  if (type === 'gallery') {
    const album = data.album;
    const albumTitle =
      album && typeof album === 'object' && !(album instanceof Date) ? textValue((album as Frontmatter).title) : '';
    return `${albumTitle || textValue(data.title) || 'Imported album'} Facebook album.`;
  }

  return cleanSummary(excerptFromMarkdown(content) || textValue(data.title) || 'Untitled');
}

function slugFromPostFilename(filename: string) {
  return filename.replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

function excerptFromMarkdown(content: string) {
  return content
    .replace(/{%[^%]+%}/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]+]\([^)]*\)/g, (match) => match.replace(/^\[|\]\([^)]*\)$/g, ''))
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function stringArray(value: unknown) {
  if (typeof value === 'string') {
    return value.trim() ? [value.trim()] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => textValue(item)).filter(Boolean);
}

function textValue(value: unknown) {
  if (value === undefined || value === null) {
    return '';
  }

  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString();
  }

  return String(value).trim();
}

function formatList(values: string[]) {
  return `\n${values.map((value) => `  - ${formatScalar(value)}`).join('\n')}`;
}

function formatScalar(value: string) {
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(value)) {
    return value;
  }

  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function cleanSummary(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
