import { readFileSync } from 'node:fs';
import path from 'node:path';

export type TaxonomyRules = {
  schemaVersion?: string;
  removed: Set<string>;
  hashtags: Map<string, string>;
  categories: Map<string, string>;
  people: Map<string, string>;
  locations: Map<string, string>;
};

type TaxonomyRulesFile = {
  schemaVersion?: string;
  removed?: unknown;
  hashtags?: unknown;
  categories?: unknown;
  people?: unknown;
  locations?: unknown;
};

const defaultRulesFile: Required<TaxonomyRulesFile> = {
  schemaVersion: '2026-05-16',
  removed: ['wordpress', 'instagram', 'facebook', 'gallery', 'album'],
  hashtags: {
    beeakfast: 'breakfast',
    breakfsst: 'breakfast',
    brekfast: 'breakfast',
    candelightconcert: 'candlelightconcert',
    cicgars: 'cigars',
    covidvacccine: 'covidvaccine',
    happythanksgivng: 'happythanksgiving',
    newbeginings: 'newbeginnings',
    tradtions: 'traditions',
  },
  categories: {
    birthdays: 'Birthday',
    'july 4th': 'July 4th',
    'july fourth': 'July 4th',
    'fourth of july': 'July 4th',
    '4th of july': 'July 4th',
    'new year': 'New Year',
    'new years': 'New Year',
    "new year's": 'New Year',
    'new years day': 'New Year',
    "new year's day": 'New Year',
    'field-day': 'Field Day',
    'field day': 'Field Day',
    'field-trips': 'Field Trips',
    'field trips': 'Field Trips',
    'first-grade': 'First Grade',
    'first grade': 'First Grade',
    'last-day': 'Last Day',
    'last day': 'Last Day',
  },
  people: {
    nathan: 'Nathan',
    natalie: 'Natalie',
    sarah: 'Sarah',
    grandma: 'Grandma',
    grandpa: 'Grandpa',
  },
  locations: {
    'cair paravel': 'Cair Paravel Latin School',
    'cair paravel latin school': 'Cair Paravel Latin School',
    cpls: 'Cair Paravel Latin School',
    'crown center': 'Crown Center',
    'crown-center': 'Crown Center',
  },
};

export function readTaxonomyRules(root = process.cwd()): TaxonomyRules {
  const filePath = path.join(root, 'content', 'taxonomy.aliases.json');
  let data = defaultRulesFile;

  try {
    data = {
      ...defaultRulesFile,
      ...(JSON.parse(readFileSync(filePath, 'utf8')) as TaxonomyRulesFile),
    };
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  return {
    schemaVersion: textValue(data.schemaVersion),
    removed: new Set(arrayValues(data.removed).map(normalizeTaxonomyKey)),
    hashtags: ruleMap(data.hashtags, normalizeHashtagKey),
    categories: ruleMap(data.categories, normalizeTaxonomyKey),
    people: ruleMap(data.people, normalizeTaxonomyKey),
    locations: ruleMap(data.locations, normalizeTaxonomyKey),
  };
}

export function normalizeTaxonomyKey(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeHashtagKey(value: string) {
  return value.normalize('NFKC').trim().replace(/^#+/, '').replace(/\s+/g, '').toLowerCase();
}

export function canonicalHashtag(value: string, rules: TaxonomyRules) {
  const normalized = normalizeHashtagKey(value);
  return rules.hashtags.get(normalized) ?? normalized;
}

export function categoryLabel(key: string, rules: TaxonomyRules) {
  const alias = rules.categories.get(key);

  if (alias) {
    return alias;
  }

  return key
    .split(' ')
    .map((word) =>
      word
        .split('-')
        .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
        .join('-'),
    )
    .join(' ');
}

function ruleMap(value: unknown, normalizeKey: (value: string) => string) {
  const map = new Map<string, string>();

  if (!value || typeof value !== 'object' || value instanceof Date || Array.isArray(value)) {
    return map;
  }

  for (const [key, label] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    const normalizedLabel = textValue(label);

    if (normalizedKey && normalizedLabel) {
      map.set(normalizedKey, normalizedLabel);
    }
  }

  return map;
}

function arrayValues(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => textValue(item)).filter(Boolean);
}

function textValue(value: unknown) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function isMissingFileError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
