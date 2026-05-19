import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import {
  canonicalHashtag,
  categoryLabel as categoryLabelForKey,
  normalizeTaxonomyKey,
  readTaxonomyRules,
} from './taxonomy-rules';

type Frontmatter = Record<string, unknown>;

type Stats = {
  files: number;
  changed: number;
  tagsRemoved: number;
  hashtagFieldsChanged: number;
  categoryFieldsChanged: number;
  tagValuesFolded: number;
  hashtagValuesKept: number;
  categoryValuesKept: number;
  systemValuesRemoved: number;
};

const postsRoot = path.join(process.cwd(), '_posts');
const write = process.argv.includes('--write');
const taxonomyRules = readTaxonomyRules();
const removedTaxonomy = taxonomyRules.removed;

const stats: Stats = {
  files: 0,
  changed: 0,
  tagsRemoved: 0,
  hashtagFieldsChanged: 0,
  categoryFieldsChanged: 0,
  tagValuesFolded: 0,
  hashtagValuesKept: 0,
  categoryValuesKept: 0,
  systemValuesRemoved: 0,
};

async function main() {
  const files = (await fs.readdir(postsRoot)).filter((file) => file.endsWith('.md')).sort();

  for (const file of files) {
    await normalizeFile(file);
  }

  console.log(`${write ? 'Normalized' : 'Would normalize'} taxonomy in ${stats.changed} of ${stats.files} content files.`);
  console.log(`Tag fields removed: ${stats.tagsRemoved}`);
  console.log(`Hashtag fields changed: ${stats.hashtagFieldsChanged}`);
  console.log(`Category fields changed: ${stats.categoryFieldsChanged}`);
  console.log(`Tag values folded into hashtags: ${stats.tagValuesFolded}`);
  console.log(`Existing hashtag values kept: ${stats.hashtagValuesKept}`);
  console.log(`Category values kept: ${stats.categoryValuesKept}`);
  console.log(`System/source taxonomy values removed: ${stats.systemValuesRemoved}`);
}

async function normalizeFile(file: string) {
  stats.files += 1;

  const fullPath = path.join(postsRoot, file);
  const raw = await fs.readFile(fullPath, 'utf8');
  const frontmatter = frontmatterRange(raw);

  if (!frontmatter) {
    return;
  }

  const parsed = matter(raw);
  const currentTags = stringArray(parsed.data.tags);
  const currentHashtags = stringArray(parsed.data.hashtags);
  const currentCategories = stringArray(parsed.data.categories);
  const nextHashtags = normalizeHashtags([...currentHashtags, ...currentTags]);
  const nextCategories = normalizeCategories(currentCategories);

  let yaml = frontmatter.yaml;
  const originalYaml = yaml;

  if (hasField(yaml, 'tags')) {
    yaml = removeField(yaml, 'tags');
    stats.tagsRemoved += 1;
  }

  if (!sameList(currentHashtags, nextHashtags.values) || hasField(yaml, 'hashtags') !== nextHashtags.values.length > 0) {
    yaml = setListField(yaml, 'hashtags', nextHashtags.values, 'summary');
    stats.hashtagFieldsChanged += 1;
  }

  if (!sameList(currentCategories, nextCategories.values) || hasField(yaml, 'categories') !== nextCategories.values.length > 0) {
    yaml = setListField(yaml, 'categories', nextCategories.values, 'images');
    stats.categoryFieldsChanged += 1;
  }

  stats.tagValuesFolded += currentTags.length;
  stats.hashtagValuesKept += nextHashtags.values.length;
  stats.categoryValuesKept += nextCategories.values.length;
  stats.systemValuesRemoved += nextHashtags.removed + nextCategories.removed;

  if (yaml === originalYaml) {
    return;
  }

  stats.changed += 1;

  if (write) {
    const next = `${frontmatter.before}---${frontmatter.newline}${yaml}${frontmatter.newline}---${frontmatter.after}`;
    await fs.writeFile(fullPath, next, 'utf8');
  }
}

function normalizeHashtags(values: string[]) {
  const normalized = new Map<string, string>();
  let removed = 0;

  for (const value of values) {
    const token = normalizeHashtag(value);

    if (!token) {
      continue;
    }

    if (removedTaxonomy.has(token)) {
      removed += 1;
      continue;
    }

    normalized.set(token, token);
  }

  return {
    values: [...normalized.values()].sort((a, b) => a.localeCompare(b)),
    removed,
  };
}

function normalizeCategories(values: string[]) {
  const normalized = new Map<string, string>();
  let removed = 0;

  for (const value of values) {
    const key = normalizeCategoryKey(value);

    if (!key) {
      continue;
    }

    if (removedTaxonomy.has(key)) {
      removed += 1;
      continue;
    }

    const label = categoryLabel(key);
    normalized.set(label.toLowerCase(), label);
  }

  return {
    values: [...normalized.values()].sort((a, b) => a.localeCompare(b)),
    removed,
  };
}

function normalizeHashtag(value: string) {
  return canonicalHashtag(value, taxonomyRules);
}

function normalizeCategoryKey(value: string) {
  return normalizeTaxonomyKey(value);
}

function categoryLabel(key: string) {
  return categoryLabelForKey(key, taxonomyRules);
}

function setListField(yaml: string, key: string, values: string[], anchor?: string) {
  if (values.length === 0) {
    return removeField(yaml, key);
  }

  const formatted = formatList(values);

  if (hasField(yaml, key)) {
    return replaceField(yaml, key, `${key}:${formatted}`);
  }

  return insertField(yaml, key, formatted, anchor);
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

function hasField(yaml: string, key: string) {
  return new RegExp(`^${escapeRegExp(key)}\\s*:`, 'm').test(yaml);
}

function fieldBlock(yaml: string, key: string): [number, number] | undefined {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${escapeRegExp(key)}\\s*:`).test(line));

  if (start === -1) {
    return undefined;
  }

  let end = start + 1;

  while (end < lines.length && !/^[A-Za-z0-9_-]+\s*:/.test(lines[end])) {
    end += 1;
  }

  return [start, end];
}

function removeField(yaml: string, key: string) {
  const lines = yaml.split(/\r?\n/);
  const block = fieldBlock(yaml, key);

  if (!block) {
    return yaml;
  }

  const [start, end] = block;
  lines.splice(start, end - start);
  return trimBlankLines(lines).join('\n');
}

function replaceField(yaml: string, key: string, replacement: string) {
  const lines = yaml.split(/\r?\n/);
  const block = fieldBlock(yaml, key);

  if (!block) {
    return yaml;
  }

  const [start, end] = block;
  lines.splice(start, end - start, ...replacement.split('\n'));
  return trimBlankLines(lines).join('\n');
}

function insertField(yaml: string, key: string, value: string, anchor?: string) {
  const lines = yaml.split(/\r?\n/);
  const fieldLines = `${key}:${value}`.split('\n');
  const index = anchor ? endOfField(lines, anchor) : -1;

  if (index === -1) {
    lines.push(...fieldLines);
  } else {
    lines.splice(index, 0, ...fieldLines);
  }

  return trimBlankLines(lines).join('\n');
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

function trimBlankLines(lines: string[]) {
  while (lines.length > 0 && lines.at(-1)?.trim() === '') {
    lines.pop();
  }

  return lines;
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

function sameList(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function formatList(values: string[]) {
  return `\n${values.map((value) => `  - ${formatScalar(value)}`).join('\n')}`;
}

function formatScalar(value: string) {
  if (/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(value)) {
    return value;
  }

  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
