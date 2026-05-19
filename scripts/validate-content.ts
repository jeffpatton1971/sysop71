import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import {
  canonicalHashtag,
  normalizeTaxonomyKey,
  readTaxonomyRules,
} from './taxonomy-rules';

type Frontmatter = Record<string, unknown>;
type Severity = 'error' | 'warning';
type ContentType = 'post' | 'story' | 'gallery';
type TargetContentType = 'post' | 'story' | 'gallery';

type Issue = {
  severity: Severity;
  code: string;
  file: string;
  message: string;
};

type ContentRecord = {
  file: string;
  data: Frontmatter;
  content: string;
  filename: string;
  id: string;
  type?: ContentType;
  targetType?: TargetContentType;
  slug: string;
  route?: string;
  galleryId?: string;
  excluded: boolean;
};

type DateParts = {
  year: string;
  month: string;
  day: string;
};

const root = process.cwd();
const postsRoot = path.join(root, '_posts');
const sourceMediaManifestPath = path.join(root, 'content', 'media', 'index.json');
const reportPath = path.join(root, '.tmp', 'content-validation-report.json');
const strict = process.argv.includes('--strict');
const maxConsoleIssues = numberArg('--max-issues') ?? 25;
const taxonomyRules = readTaxonomyRules(root);

const issues: Issue[] = [];
const recommendations = {
  articleContentType: [] as string[],
  tagsPresent: [] as string[],
  categoriesPresent: [] as string[],
  sourcePresent: [] as string[],
  relatedArticleType: [] as string[],
  legacyGalleryIncludes: [] as string[],
  systemTaxonomyPresent: [] as string[],
  mediaManifestAssets: 0,
};

const removedTaxonomy = taxonomyRules.removed;
const personCategoryAliases = taxonomyRules.people;
const locationCategoryAliases = taxonomyRules.locations;

async function main() {
  const mediaIds = await readMediaIds();
  const records = await readContentRecords();

  validateRecords(records, mediaIds);
  validateRelationships(records);

  const summary = {
    generatedAt: new Date().toISOString(),
    strict,
    files: {
      posts: records.length,
      mediaManifestAssets: recommendations.mediaManifestAssets,
    },
    media: {
      ids: mediaIds?.size ?? 0,
      referenced: uniqueMediaReferences(records).size,
    },
    contentTypes: countBy(records, (record) => record.targetType ?? 'unknown'),
    issues: {
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
    },
    recommendations: {
      articleContentType: recommendationSummary(recommendations.articleContentType),
      tagsPresent: recommendationSummary(recommendations.tagsPresent),
      categoriesPresent: recommendationSummary(recommendations.categoriesPresent),
      sourcePresent: recommendationSummary(recommendations.sourcePresent),
      relatedArticleType: recommendationSummary(recommendations.relatedArticleType),
      legacyGalleryIncludes: recommendationSummary(recommendations.legacyGalleryIncludes),
      systemTaxonomyPresent: recommendationSummary(recommendations.systemTaxonomyPresent),
      mediaManifestAssets: recommendations.mediaManifestAssets,
    },
  };

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify({ ...summary, issueList: issues }, null, 2)}\n`, 'utf8');

  printSummary(summary);

  if (summary.issues.errors > 0) {
    process.exitCode = 1;
  }
}

async function readMediaIds() {
  const manifestIds = await readMediaManifestIds();

  if (!manifestIds) {
    addIssue(
      'error',
      'mediaManifest.missing',
      'content/media/index.json',
      'The media manifest is required. Media assets are now tracked in content/media/index.json.',
    );

    return undefined;
  }

  return manifestIds;
}

async function readMediaManifestIds() {
  let raw = '';

  try {
    raw = await fs.readFile(sourceMediaManifestPath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }

  const parsed = JSON.parse(raw) as {
    assets?: Array<{
      id?: unknown;
      rawUrl?: unknown;
      thumbUrl?: unknown;
    }>;
  };
  const ids = new Set<string>();

  for (const [index, asset] of (parsed.assets ?? []).entries()) {
    const id = textValue(asset.id);
    const file = `content/media/index.json#assets[${index}]`;

    if (!id) {
      addIssue('error', 'mediaManifest.missingId', file, 'Media manifest asset is missing id.');
      continue;
    }

    if (!isCanonicalMediaKey(id)) {
      addIssue('error', 'mediaManifest.nonCanonicalId', file, `Media manifest id "${id}" is not shaped like yyyy/mm/dd/filename.ext.`);
      continue;
    }

    if (ids.has(id)) {
      addIssue('error', 'mediaManifest.duplicateId', file, `Duplicate media manifest id: ${id}`);
    }

    ids.add(id);
  }

  recommendations.mediaManifestAssets = ids.size;
  return ids;
}

async function readContentRecords() {
  const files = await markdownFiles(postsRoot);
  const records: ContentRecord[] = [];

  for (const file of files) {
    const fullPath = path.join(postsRoot, file);
    const raw = await fs.readFile(fullPath, 'utf8');
    const filename = path.basename(file, '.md');

    if (!hasFrontmatter(raw)) {
      addIssue('error', 'content.missingFrontmatter', `_posts/${file}`, 'Content file is missing YAML frontmatter.');
      continue;
    }

    const parsed = matter(raw);
    const type = contentType(parsed.data);
    const targetType = targetContentType(type);
    const slug = textValue(parsed.data.slug) || slugFromPostFilename(filename);
    const id = textValue(parsed.data.post_id) || textValue(parsed.data.id) || filename;
    const galleryId = textValue(parsed.data.gallery);
    const excluded = parsed.data.exclude_from_archives === true || parsed.data.excludeFromArchives === true;

    records.push({
      file: `_posts/${file}`,
      data: parsed.data,
      content: parsed.content,
      filename,
      id,
      type,
      targetType,
      slug,
      route: routeFor(targetType, parsed.data, slug),
      galleryId,
      excluded,
    });
  }

  return records;
}

function validateRecords(records: ContentRecord[], mediaIds: Set<string> | undefined) {
  const ids = new Map<string, ContentRecord>();
  const routes = new Map<string, ContentRecord>();

  for (const record of records) {
    validateRequiredShape(record);
    validateTargetWarnings(record);
    validateTaxonomy(record);
    validateMediaReferences(record, mediaIds);

    if (record.id) {
      const existing = ids.get(record.id);

      if (existing) {
        addIssue('error', 'content.duplicateId', record.file, `Duplicate content ID "${record.id}" also used by ${existing.file}.`);
      } else {
        ids.set(record.id, record);
      }
    }

    if (record.route) {
      const existing = routes.get(record.route);

      if (existing) {
        addIssue('error', 'content.duplicateRoute', record.file, `Duplicate route "${record.route}" also used by ${existing.file}.`);
      } else {
        routes.set(record.route, record);
      }
    }
  }
}

function validateRequiredShape(record: ContentRecord) {
  const data = record.data;
  const explicitType = explicitContentType(data);

  if (!record.type) {
    addIssue('error', 'content.invalidType', record.file, 'content_type must be one of post, story, or gallery.');
  }

  if (explicitType === 'article') {
    trackRecommendation(recommendations.articleContentType, record.file);
    addIssue('error', 'content.legacyArticleType', record.file, 'Use content_type: post instead of the legacy value article.');
  }

  requireText(record, 'title', 'content.missingTitle');
  requireText(record, 'slug', 'content.missingSlug');
  requireText(record, 'post_id', 'content.missingPostId');
  requireText(record, 'summary', 'content.missingSummary');

  if (!validDate(data.date)) {
    addIssue('error', 'content.invalidDate', record.file, 'date must be present and parseable.');
  }

  const status = textValue(data.status).toLowerCase();
  if (!['draft', 'published', 'archived'].includes(status)) {
    addIssue('error', 'content.invalidStatus', record.file, 'status must be draft, published, or archived.');
  }

  if (stringArray(data.authors).length === 0) {
    addIssue('error', 'content.missingAuthors', record.file, 'authors must contain at least one author.');
  }

  if (record.targetType === 'gallery' && !record.excluded) {
    const imageIds = imageRefs(data);
    const cover = textValue(data.cover_image || data.coverImage || data.coverMedia);

    if (imageIds.length === 0) {
      addIssue('error', 'gallery.missingImages', record.file, 'Gallery content must include an ordered images list.');
    }

    if (!cover) {
      addIssue('error', 'gallery.missingCover', record.file, 'Gallery content must include cover_image.');
    } else if (imageIds.length > 0 && !imageIds.includes(cover)) {
      addIssue('error', 'gallery.coverNotInImages', record.file, `Gallery cover_image "${cover}" is not present in images.`);
    }
  }
}

function validateTargetWarnings(record: ContentRecord) {
  const data = record.data;
  const file = record.file;

  if (stringArray(data.tags).length > 0) {
    trackRecommendation(recommendations.tagsPresent, file);
    maybeStrictIssue('contract.tagsPresent', file, 'Fold topical tags into hashtags and move import/system tags to legacy metadata.');
  }

  if (stringArray(data.categories).length > 0) {
    trackRecommendation(recommendations.categoriesPresent, file);
  }

  if (data.source !== undefined) {
    trackRecommendation(recommendations.sourcePresent, file);
  }

  const galleryIncludes = legacyGalleryIncludes(record.content);

  if (galleryIncludes.length > 0) {
    trackRecommendation(recommendations.legacyGalleryIncludes, file);

    if (record.type === 'post' || record.type === 'story') {
      addIssue(
        'error',
        'contract.legacyGalleryInclude',
        file,
        'Posts and stories should reference galleries through frontmatter instead of Jekyll gallery includes.',
      );
    }
  }
}

function validateTaxonomy(record: ContentRecord) {
  const fields = ['tags', 'hashtags', 'categories'] as const;

  for (const field of fields) {
    const values = stringArray(record.data[field]);
    const seen = new Set<string>();

    for (const value of values) {
      const normalized = field === 'categories' ? normalizeCategoryKey(value) : normalizeHashtag(value);

      if (!normalized) {
        continue;
      }

      if (field === 'hashtags' && value !== normalized) {
        addIssue(
          'error',
          'taxonomy.hashtagNotNormalized',
          record.file,
          `Hashtag "${value}" must be lowercase, have no leading #, and contain no spaces.`,
        );
      }

      if (removedTaxonomy.has(normalized)) {
        trackRecommendation(recommendations.systemTaxonomyPresent, record.file);
        addIssue('error', 'taxonomy.systemValue', record.file, `${field} contains source/import value "${value}".`);
      }

      if (field === 'categories' && personCategoryAliases.has(normalized)) {
        addIssue('error', 'taxonomy.personCategory', record.file, `Category "${value}" should be moved to people.`);
      }

      if (field === 'categories' && locationCategoryAliases.has(normalized)) {
        addIssue('error', 'taxonomy.locationCategory', record.file, `Category "${value}" should be moved to locations.`);
      }

      if (seen.has(normalized)) {
        addIssue('error', 'taxonomy.duplicateValue', record.file, `${field} contains duplicate value "${value}" after normalization.`);
      }

      seen.add(normalized);
    }
  }

  validateUniqueList(record, 'people');
  validateUniqueList(record, 'locations');
}

function validateUniqueList(record: ContentRecord, field: 'people' | 'locations') {
  const seen = new Set<string>();

  for (const value of stringArray(record.data[field])) {
    const normalized = normalizeCategoryKey(value);

    if (seen.has(normalized)) {
      addIssue('error', `taxonomy.duplicate${field[0].toUpperCase()}${field.slice(1)}`, record.file, `${field} contains duplicate value "${value}".`);
    }

    seen.add(normalized);
  }
}

function validateMediaReferences(record: ContentRecord, mediaIds: Set<string> | undefined) {
  const refs = new Set<string>();
  const cover = textValue(record.data.cover_image || record.data.coverImage || record.data.coverImageId);

  if (cover) {
    refs.add(cover);
  }

  for (const id of imageRefs(record.data)) {
    refs.add(id);
  }

  for (const ref of markdownImageRefs(record.content)) {
    refs.add(ref);
  }

  for (const ref of refs) {
    if (isExternalMediaReference(ref) || ref.startsWith('/')) {
      addIssue(
        'error',
        'media.externalReference',
        record.file,
        `Media reference "${ref}" should use a canonical media key, not a URL or absolute path.`,
      );
      continue;
    }

    if (!isCanonicalMediaKey(ref)) {
      addIssue('error', 'media.nonCanonicalReference', record.file, `Media reference "${ref}" is not shaped like yyyy/mm/dd/filename.ext.`);
      continue;
    }

    if (mediaIds && !mediaIds.has(ref)) {
      addIssue('error', 'media.missingReference', record.file, `Media reference "${ref}" was not found in the media index.`);
    }
  }
}

function validateRelationships(records: ContentRecord[]) {
  const contentIds = new Set(records.map((record) => record.id).filter(Boolean));
  const galleryIds = new Set(
    records
      .filter((record) => record.targetType === 'gallery')
      .flatMap((record) => [record.id, record.galleryId])
      .filter(Boolean),
  );

  for (const record of records) {
    for (const link of relatedLinks(record.data)) {
      const type = contentLinkType(link.type);

      if (link.type === 'article') {
        trackRecommendation(recommendations.relatedArticleType, record.file);
        addIssue('error', 'related.legacyArticleType', record.file, 'Use related.type: post instead of article.');
      }

      if (type === 'gallery') {
        if (!galleryIds.has(link.id)) {
          addIssue('error', 'related.missingGallery', record.file, `Related gallery "${link.id}" does not exist.`);
        }
        continue;
      }

      if (type === 'post' || type === 'story' || !type) {
        if (!contentIds.has(link.id)) {
          addIssue('error', 'related.missingContent', record.file, `Related content "${link.id}" does not exist.`);
        }
      }
    }
  }
}

function requireText(record: ContentRecord, key: string, code: string) {
  if (!textValue(record.data[key])) {
    addIssue('error', code, record.file, `${key} is required.`);
  }
}

function contentType(data: Frontmatter): ContentType | undefined {
  const explicit = explicitContentType(data);

  if (explicit === 'post' || explicit === 'story' || explicit === 'gallery') {
    return explicit;
  }

  return undefined;
}

function explicitContentType(data: Frontmatter) {
  return textValue(data.content_type || data.contentType || data.type).toLowerCase();
}

function targetContentType(type: ContentType | undefined): TargetContentType | undefined {
  return type;
}

function routeFor(type: TargetContentType | undefined, data: Frontmatter, slug: string) {
  if (!type || !slug) {
    return undefined;
  }

  const parts = partsFromDate(data.date);

  if (!parts) {
    return undefined;
  }

  return `/${type === 'post' ? 'posts' : `${type}s`}/${parts.year}/${parts.month}/${parts.day}/${slug}`;
}

function relatedLinks(data: Frontmatter) {
  const related = data.related;

  if (typeof related === 'string') {
    return related.trim() ? [{ id: related.trim() }] : [];
  }

  if (!Array.isArray(related)) {
    return [];
  }

  return related
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim() ? { id: item.trim() } : undefined;
      }

      if (!item || typeof item !== 'object' || item instanceof Date) {
        return undefined;
      }

      const value = item as Frontmatter;
      const id = textValue(value.id || value.post_id || value.slug || value.route);

      if (!id) {
        return undefined;
      }

      return {
        type: textValue(value.type),
        id,
      };
    })
    .filter(Boolean) as Array<{ type?: string; id: string }>;
}

function contentLinkType(value: string | undefined): TargetContentType | undefined {
  const type = textValue(value).toLowerCase();

  if (type === 'article' || type === 'post') {
    return 'post';
  }

  if (type === 'story' || type === 'gallery') {
    return type;
  }

  return undefined;
}

function imageRefs(data: Frontmatter) {
  const refs: string[] = [];

  for (const value of [data.images, data.imageIds, data.image_ids]) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          refs.push(item);
        } else if (item && typeof item === 'object' && !(item instanceof Date)) {
          refs.push(textValue((item as Frontmatter).id));
        }
      }
    } else if (typeof value === 'string') {
      refs.push(...value.split(',').map((item) => item.trim()));
    }
  }

  return refs.filter(Boolean);
}

function markdownImageRefs(content: string) {
  const refs: string[] = [];

  for (const match of content.matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const ref = match[1].trim();

    if (ref) {
      refs.push(ref);
    }
  }

  return refs;
}

function legacyGalleryIncludes(content: string) {
  return [...content.matchAll(/{%\s*include\s+gallery\.html\s+gallery="([^"]+)"\s*%}/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function uniqueMediaReferences(records: ContentRecord[]) {
  const refs = new Set<string>();

  for (const record of records) {
    const cover = textValue(record.data.cover_image || record.data.coverImage || record.data.coverImageId);

    if (cover) {
      refs.add(cover);
    }

    for (const ref of imageRefs(record.data)) {
      refs.add(ref);
    }

    for (const ref of markdownImageRefs(record.content)) {
      refs.add(ref);
    }
  }

  return refs;
}

function validDate(value: unknown) {
  return partsFromDate(value) !== undefined;
}

function partsFromDate(value: unknown): DateParts | undefined {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return {
      year: String(value.getFullYear()).padStart(4, '0'),
      month: String(value.getMonth() + 1).padStart(2, '0'),
      day: String(value.getDate()).padStart(2, '0'),
    };
  }

  const text = textValue(value);

  if (!text) {
    return undefined;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);

  if (!match) {
    return undefined;
  }

  const normalized = text
    .replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/, '$1T$2')
    .replace(/\s+([+-]\d{2})(\d{2})$/, '$1:$2');
  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.valueOf())) {
    return undefined;
  }

  return {
    year: match[1],
    month: match[2],
    day: match[3],
  };
}

function isMissingFileError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function isCanonicalMediaKey(value: string) {
  return /^\d{4}\/\d{2}\/\d{2}\/[^/]+\.[A-Za-z0-9]+$/.test(value);
}

function isExternalMediaReference(value: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function normalizeHashtag(value: string) {
  return canonicalHashtag(value, taxonomyRules);
}

function normalizeCategoryKey(value: string) {
  return normalizeTaxonomyKey(value);
}

async function markdownFiles(directory: string) {
  try {
    return (await fs.readdir(directory)).filter((file) => file.endsWith('.md')).sort();
  } catch {
    return [];
  }
}

function hasFrontmatter(raw: string) {
  return /^---\r?\n[\s\S]*?\r?\n---/.test(raw);
}

function slugFromPostFilename(filename: string) {
  return filename.replace(/^\d{4}-\d{2}-\d{2}-/, '');
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

function addIssue(severity: Severity, code: string, file: string, message: string) {
  issues.push({ severity, code, file, message });
}

function maybeStrictIssue(code: string, file: string, message: string) {
  if (strict) {
    addIssue('error', code, file, message);
  }
}

function trackRecommendation(list: string[], file: string) {
  list.push(file);
}

function recommendationSummary(files: string[]) {
  return {
    count: files.length,
    examples: files.slice(0, 10),
  };
}

function countBy<T>(items: T[], key: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function numberArg(name: string) {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));

  if (!raw) {
    return undefined;
  }

  const value = Number(raw.slice(name.length + 1));
  return Number.isFinite(value) ? value : undefined;
}

function printSummary(summary: {
  files: { posts: number; mediaManifestAssets: number };
  media: { ids: number; referenced?: number };
  contentTypes: Record<string, number>;
  issues: { errors: number; warnings: number };
  recommendations: Record<string, { count: number; examples: string[] } | number>;
}) {
  console.log('Content validation');
  console.log(`Posts: ${summary.files.posts}`);
  console.log(`Media manifest assets: ${summary.files.mediaManifestAssets}`);
  console.log(`Media IDs: ${summary.media.ids}`);
  if (summary.media.referenced !== undefined) {
    console.log(`Referenced media IDs: ${summary.media.referenced}`);
  }
  console.log(`Content types: ${JSON.stringify(summary.contentTypes)}`);
  console.log(`Errors: ${summary.issues.errors}`);
  console.log(`Warnings: ${summary.issues.warnings}`);
  console.log(`Report: ${path.relative(root, reportPath)}`);

  if (issues.length > 0) {
    console.log('');
    console.log(`First ${Math.min(maxConsoleIssues, issues.length)} issue(s):`);
    for (const issue of issues.slice(0, maxConsoleIssues)) {
      console.log(`- ${issue.severity.toUpperCase()} ${issue.code} ${issue.file}: ${issue.message}`);
    }
  }

  console.log('');
  console.log('Target-contract cleanup counts:');
  for (const [key, value] of Object.entries(summary.recommendations)) {
    if (typeof value === 'number') {
      console.log(`- ${key}: ${value}`);
    } else {
      console.log(`- ${key}: ${value.count}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
