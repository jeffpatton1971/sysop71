import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import {
  normalizeTaxonomyKey,
  readTaxonomyRules,
} from './taxonomy-rules';

type Frontmatter = Record<string, unknown>;

type Stats = {
  files: number;
  changed: number;
  peopleFieldsChanged: number;
  locationsFieldsChanged: number;
  categoryFieldsChanged: number;
  peopleAdded: number;
  locationsAdded: number;
};

const postsRoot = path.join(process.cwd(), '_posts');
const write = process.argv.includes('--write');
const taxonomyRules = readTaxonomyRules();
const personCategoryAliases = taxonomyRules.people;
const locationCategoryAliases = taxonomyRules.locations;

const stats: Stats = {
  files: 0,
  changed: 0,
  peopleFieldsChanged: 0,
  locationsFieldsChanged: 0,
  categoryFieldsChanged: 0,
  peopleAdded: 0,
  locationsAdded: 0,
};

async function main() {
  const files = (await fs.readdir(postsRoot)).filter((file) => file.endsWith('.md')).sort();

  for (const file of files) {
    await normalizeFile(file);
  }

  console.log(`${write ? 'Normalized' : 'Would normalize'} people/locations in ${stats.changed} of ${stats.files} content files.`);
  console.log(`People fields changed: ${stats.peopleFieldsChanged}`);
  console.log(`Locations fields changed: ${stats.locationsFieldsChanged}`);
  console.log(`Category fields changed: ${stats.categoryFieldsChanged}`);
  console.log(`People values added: ${stats.peopleAdded}`);
  console.log(`Location values added: ${stats.locationsAdded}`);
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
  const currentCategories = stringArray(parsed.data.categories);
  const currentPeople = stringArray(parsed.data.people);
  const currentLocations = stringArray(parsed.data.locations);
  const legacyLocation = locationValue(parsed.data.location);
  const people = new Map(currentPeople.map((value) => [normalizeKey(value), value]));
  const locations = new Map(currentLocations.map((value) => [normalizeKey(value), value]));
  const categories: string[] = [];
  let addedPeople = 0;
  let addedLocations = 0;

  if (legacyLocation) {
    locations.set(normalizeKey(legacyLocation), legacyLocation);
  }

  for (const category of currentCategories) {
    const key = normalizeKey(category);
    const person = personCategoryAliases.get(key);
    const location = locationCategoryAliases.get(key);

    if (person) {
      if (!people.has(normalizeKey(person))) {
        addedPeople += 1;
      }
      people.set(normalizeKey(person), person);
      continue;
    }

    if (location) {
      if (!locations.has(normalizeKey(location))) {
        addedLocations += 1;
      }
      locations.set(normalizeKey(location), location);
      continue;
    }

    categories.push(category);
  }

  const nextPeople = [...people.values()].sort((a, b) => a.localeCompare(b));
  const nextLocations = [...locations.values()].sort((a, b) => a.localeCompare(b));
  const nextCategories = uniqueSorted(categories);

  let yaml = frontmatter.yaml;
  const originalYaml = yaml;

  if (!sameList(currentPeople, nextPeople)) {
    yaml = setListField(yaml, 'people', nextPeople, 'authors');
    stats.peopleFieldsChanged += 1;
  }

  if (!sameList(currentLocations, nextLocations)) {
    yaml = setListField(yaml, 'locations', nextLocations, 'people');
    stats.locationsFieldsChanged += 1;
  }

  if (!sameList(currentCategories, nextCategories)) {
    yaml = setListField(yaml, 'categories', nextCategories, 'locations');
    stats.categoryFieldsChanged += 1;
  }

  if (yaml !== originalYaml && hasEmptyField(yaml, 'location')) {
    yaml = removeField(yaml, 'location');
  }

  if (yaml === originalYaml) {
    return;
  }

  stats.changed += 1;
  stats.peopleAdded += addedPeople;
  stats.locationsAdded += addedLocations;

  if (write) {
    const next = `${frontmatter.before}---${frontmatter.newline}${yaml}${frontmatter.newline}---${frontmatter.after}`;
    await fs.writeFile(fullPath, next, 'utf8');
  }
}

function locationValue(value: unknown) {
  if (!value) {
    return '';
  }

  if (typeof value === 'object' && !(value instanceof Date)) {
    const data = value as Frontmatter;
    return textValue(data.name) || textValue(data.title) || textValue(data.location);
  }

  return textValue(value);
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

function hasEmptyField(yaml: string, key: string) {
  const block = fieldBlock(yaml, key);

  if (!block) {
    return false;
  }

  const lines = yaml.split(/\r?\n/).slice(block[0], block[1]);
  return lines.join('\n').replace(new RegExp(`^${escapeRegExp(key)}\\s*:\\s*`), '').trim() === '';
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

function uniqueSorted(values: string[]) {
  return [...new Map(values.map((value) => [normalizeKey(value), value])).values()].sort((a, b) => a.localeCompare(b));
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

function normalizeKey(value: string) {
  return normalizeTaxonomyKey(value);
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
