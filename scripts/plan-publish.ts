import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import matter from 'gray-matter';
import {
  readMediaManifest,
  writeMediaManifest,
  type MediaAsset,
  type MediaKind,
  type MediaManifest,
  type MediaUsage,
} from './media-manifest-lib';

type Frontmatter = Record<string, unknown>;
type ContentType = 'post' | 'story' | 'gallery';

type ChangedFile = {
  status: string;
  path: string;
  previousPath?: string;
};

type MarkdownPlan = {
  file: string;
  contentType?: ContentType;
  contentId: string;
  title: string;
  route?: string;
  jsonPath?: string;
  mediaReferences: MediaRewrite[];
};

type MediaRewrite = {
  reference: string;
  canonicalKey: string;
  localPath?: string;
  exists: boolean;
  kind: MediaKind;
  byteSize?: number;
  hash?: {
    algorithm: 'sha256';
    value: string;
  };
  rawBlobPath: string;
  thumbBlobPath?: string;
  posterBlobPath?: string;
  rawUrl?: string;
  thumbUrl?: string;
  posterUrl?: string;
  caption?: string;
  alt?: string;
  role: NonNullable<MediaUsage['role']>;
  manifestAction: 'none' | 'add' | 'reuse-existing' | 'collision';
};

type MediaReference = {
  reference: string;
  caption?: string;
  alt?: string;
  role: NonNullable<MediaUsage['role']>;
};

type Issue = {
  code: string;
  file: string;
  message: string;
};

type PublishWriteResult = {
  markdownFilesChanged: string[];
  manifestAssetsAdded: string[];
  mediaFilesRemoved: string[];
};

type PublishPlanOptions = {
  writeSource: boolean;
  base?: string;
  head?: string;
};

const execFileAsync = promisify(execFile);
const root = process.cwd();
const sourceMediaManifestPath = path.join(root, 'content', 'media', 'index.json');
const reportPath = path.join(root, '.tmp', 'publish-plan-report.json');
const canonicalMediaKey = /^\d{4}\/\d{2}\/\d{2}\/[^/]+\.[A-Za-z0-9]+$/;
const externalReference = /^[a-z][a-z0-9+.-]*:/i;
const args = process.argv.slice(2);
const options = publishPlanOptions();
const writeSource = options.writeSource;

async function main() {
  const mediaManifest = await readMediaManifest(sourceMediaManifestPath);
  const manifestAssetsById = new Map(mediaManifest.assets.map((asset) => [asset.id, asset]));
  const changedFiles = await gitChangedFiles(options);
  const deletedMarkdownFiles = changedFiles
    .filter((file) => /^_posts\/.+\.md$/i.test(file.path) && isDeletedStatus(file.status))
    .map((file) => file.path)
    .sort();
  const markdownFiles = changedFiles
    .filter((file) => /^_posts\/.+\.md$/i.test(file.path) && !isDeletedStatus(file.status))
    .map((file) => file.path)
    .sort();
  const changedLocalMedia = changedFiles
    .filter((file) => isLikelyMediaFile(file.path) && !isDeletedStatus(file.status))
    .map((file) => file.path)
    .sort();
  const markdownPlans: MarkdownPlan[] = [];
  const issues: Issue[] = [];

  for (const file of deletedMarkdownFiles) {
    issues.push({
      code: 'content.deletionRequiresFullPublish',
      file,
      message:
        'Incremental publish cannot safely remove generated JSON for deleted content yet. Restore the file or run a tagged full rebuild/republish after handling the deleted artifact.',
    });
  }

  for (const file of markdownFiles) {
    markdownPlans.push(await planMarkdown(file, mediaManifest, manifestAssetsById, issues));
  }

  issues.push(...collisionIssues(markdownPlans));

  const affectedJson = uniqueSorted(markdownPlans.flatMap((plan) => [plan.jsonPath].filter(Boolean) as string[]));
  const affectedIndexes = affectedIndexPaths(markdownPlans);
  const plannedMediaUploads = markdownPlans.flatMap((plan) =>
    plan.mediaReferences
      .filter((reference) => !isCanonicalReference(reference.reference))
      .map((reference) => ({
        contentFile: plan.file,
        reference: reference.reference,
        canonicalKey: reference.canonicalKey,
        localPath: reference.localPath,
        exists: reference.exists,
        kind: reference.kind,
        byteSize: reference.byteSize,
        hash: reference.hash,
        rawBlobPath: reference.rawBlobPath,
        thumbBlobPath: reference.thumbBlobPath,
        posterBlobPath: reference.posterBlobPath,
        rawUrl: reference.rawUrl,
        thumbUrl: reference.thumbUrl,
        posterUrl: reference.posterUrl,
        manifestAction: reference.manifestAction,
      })),
  );
  const plannedManifestAssets = manifestAssets(markdownPlans, mediaManifest);

  const report = {
    generatedAt: new Date().toISOString(),
    mode: writeSource ? 'write-source' : 'plan',
    changeDetection: {
      mode: changeDetectionMode(options),
      base: options.base,
      head: options.head,
    },
    mediaManifest: {
      path: path.relative(root, sourceMediaManifestPath).replaceAll(path.sep, '/'),
      assets: mediaManifest.assets.length,
      storage: mediaManifest.storage,
    },
    changedFiles,
    changedMarkdown: markdownFiles,
    changedLocalMedia,
    affectedJson,
    affectedIndexes,
    plannedMediaUploads,
    plannedManifestAssets,
    markdownRewrites: plannedMediaUploads.map((upload) => ({
      file: upload.contentFile,
      from: upload.reference,
      to: upload.canonicalKey,
    })),
    issues,
    writeResult: undefined as PublishWriteResult | undefined,
  };

  if (writeSource && issues.length === 0) {
    report.writeResult = await writeSourceChanges(markdownPlans, plannedManifestAssets, mediaManifest);
  }

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  printReport(report);

  if (issues.length > 0) {
    process.exitCode = 1;
  }
}

function publishPlanOptions(): PublishPlanOptions {
  const base =
    optionalArgValue('--base') ||
    optionalText(process.env.PUBLISH_PLAN_BASE) ||
    optionalText(process.env.GITHUB_EVENT_BEFORE);
  const head =
    optionalArgValue('--head') ||
    optionalText(process.env.PUBLISH_PLAN_HEAD) ||
    optionalText(process.env.GITHUB_SHA);

  return {
    writeSource: hasArg('--write-source'),
    base,
    head,
  };
}

async function gitChangedFiles(options: PublishPlanOptions) {
  if (options.base && isZeroSha(options.base)) {
    return gitRootCommitChangedFiles(options.head || 'HEAD');
  }

  if (options.base) {
    return gitDiffChangedFiles(options.base, options.head || 'HEAD');
  }

  const { stdout } = await execFileAsync('git', ['status', '--short', '--porcelain=v1'], { cwd: root });

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line): ChangedFile => {
      const status = line.slice(0, 2);
      const rawPath = line.slice(3);
      const renamedParts = rawPath.includes(' -> ') ? rawPath.split(' -> ') : undefined;
      const renamedPath = renamedParts ? renamedParts.at(-1)! : rawPath;

      return {
        status,
        path: renamedPath.replaceAll('\\', '/'),
        previousPath: renamedParts ? renamedParts[0].replaceAll('\\', '/') : undefined,
      };
    });
}

async function gitDiffChangedFiles(base: string, head: string) {
  const { stdout } = await execFileAsync('git', ['diff', '--name-status', '-M', base, head], { cwd: root });
  return parseNameStatus(stdout);
}

async function gitRootCommitChangedFiles(head: string) {
  const { stdout } = await execFileAsync('git', ['diff-tree', '--no-commit-id', '--name-status', '-r', '--root', head], {
    cwd: root,
  });
  return parseNameStatus(stdout);
}

function parseNameStatus(stdout: string): ChangedFile[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line): ChangedFile => {
      const parts = line.split('\t');
      const status = parts[0];

      if ((status.startsWith('R') || status.startsWith('C')) && parts.length >= 3) {
        return {
          status,
          previousPath: parts[1].replaceAll('\\', '/'),
          path: parts[2].replaceAll('\\', '/'),
        };
      }

      return {
        status,
        path: (parts[1] || '').replaceAll('\\', '/'),
      };
    })
    .filter((file) => file.path);
}

async function planMarkdown(
  file: string,
  mediaManifest: MediaManifest,
  manifestAssetsById: Map<string, MediaAsset>,
  issues: Issue[],
): Promise<MarkdownPlan> {
  const fullPath = path.join(root, file);
  const raw = await fs.readFile(fullPath, 'utf8');
  const parsed = matter(raw);
  const contentType = contentTypeFromFrontmatter(parsed.data);
  const parts = dateParts(parsed.data.date);
  const slug = textValue(parsed.data.slug) || slugFromPostFilename(path.basename(file, '.md'));
  const contentId = textValue(parsed.data.post_id || parsed.data.id) || path.basename(file, '.md');
  const title = textValue(parsed.data.title) || titleFromSlug(slug);
  const route = contentType && parts ? routeFor(contentType, parts, slug) : undefined;
  const jsonPath = route ? `${route.replace(/^\//, '')}.json` : undefined;

  if (!contentType) {
    issues.push({
      code: 'content.invalidType',
      file,
      message: 'Cannot plan publish for content without content_type post, story, or gallery.',
    });
  }

  if (!parts) {
    issues.push({
      code: 'content.invalidDate',
      file,
      message: 'Cannot plan canonical media keys without a parseable date.',
    });
  }

  const mediaReferences: MediaRewrite[] = [];

  if (parts) {
    for (const reference of mediaRefs(parsed.data, parsed.content)) {
      mediaReferences.push(
        await planMediaReference(file, reference, parts, mediaManifest, manifestAssetsById, issues),
      );
    }
  }

  return {
    file,
    contentType,
    contentId,
    title,
    route,
    jsonPath,
    mediaReferences,
  };
}

async function planMediaReference(
  file: string,
  mediaReference: MediaReference,
  parts: DateParts,
  mediaManifest: MediaManifest,
  manifestAssetsById: Map<string, MediaAsset>,
  issues: Issue[],
): Promise<MediaRewrite> {
  const { reference } = mediaReference;
  const filename = path.basename(reference);
  const canonicalKey = isCanonicalReference(reference)
    ? reference
    : `${parts.year}/${parts.month}/${parts.day}/${filename}`;
  const kind = mediaKind(canonicalKey);
  const rawBlobPath = `${mediaManifest.storage.rawPrefix}/${canonicalKey}`;
  const thumbBlobPath = kind === 'video' ? undefined : `${mediaManifest.storage.thumbPrefix}/${canonicalKey}`;
  const posterCanonicalKey = kind === 'video' ? videoPosterKey(canonicalKey) : undefined;
  const posterBlobPath = posterCanonicalKey ? `${mediaManifest.storage.thumbPrefix}/${posterCanonicalKey}` : undefined;
  const rawUrl = assetUrl(mediaManifest, 'images', canonicalKey);
  const thumbUrl = kind === 'video' ? undefined : assetUrl(mediaManifest, 'thumbs', canonicalKey);
  const posterUrl = posterCanonicalKey ? assetUrl(mediaManifest, 'thumbs', posterCanonicalKey) : undefined;

  if (isCanonicalReference(reference)) {
    return {
      reference,
      canonicalKey,
      exists: true,
      kind,
      rawBlobPath,
      thumbBlobPath,
      posterBlobPath,
      rawUrl,
      thumbUrl,
      posterUrl,
      caption: mediaReference.caption,
      alt: mediaReference.alt,
      role: mediaReference.role,
      manifestAction: 'none',
    };
  }

  if (externalReference.test(reference) || reference.startsWith('/')) {
    issues.push({
      code: 'media.unpublishableReference',
      file,
      message: `Media reference "${reference}" is not a local draft file or canonical media key.`,
    });

    return {
      reference,
      canonicalKey,
      exists: false,
      kind,
      rawBlobPath,
      thumbBlobPath,
      posterBlobPath,
      rawUrl,
      thumbUrl,
      posterUrl,
      caption: mediaReference.caption,
      alt: mediaReference.alt,
      role: mediaReference.role,
      manifestAction: 'collision',
    };
  }

  const localPath = path.resolve(root, path.dirname(file), reference);
  const exists = fileExists(localPath);

  const localMedia = exists ? await localMediaDetails(localPath) : undefined;
  const existingAsset = manifestAssetsById.get(canonicalKey);
  let manifestAction: MediaRewrite['manifestAction'] = 'add';

  if (!exists) {
    issues.push({
      code: 'media.missingLocalFile',
      file,
      message: `Local media reference "${reference}" was not found at ${path.relative(root, localPath)}.`,
    });
    manifestAction = 'collision';
  } else if (existingAsset?.hash && localMedia?.hash.value === existingAsset.hash.value) {
    manifestAction = 'reuse-existing';
  } else if (existingAsset) {
    issues.push({
      code: 'media.manifestCollision',
      file,
      message: `Canonical media key "${canonicalKey}" already exists in content/media/index.json.`,
    });
    manifestAction = 'collision';
  }

  return {
    reference,
    canonicalKey,
    localPath: path.relative(root, localPath).replaceAll(path.sep, '/'),
    exists,
    kind,
    byteSize: localMedia?.byteSize,
    hash: localMedia?.hash,
    rawBlobPath,
    thumbBlobPath,
    posterBlobPath,
    rawUrl,
    thumbUrl,
    posterUrl,
    caption: mediaReference.caption,
    alt: mediaReference.alt,
    role: mediaReference.role,
    manifestAction,
  };
}

function collisionIssues(markdownPlans: MarkdownPlan[]) {
  const seen = new Map<string, MediaRewrite>();
  const issues: Issue[] = [];

  for (const plan of markdownPlans) {
    for (const reference of plan.mediaReferences) {
      if (isCanonicalReference(reference.reference)) {
        continue;
      }

      const existing = seen.get(reference.canonicalKey);

      if (existing && existing.localPath !== reference.localPath) {
        issues.push({
          code: 'media.canonicalCollision',
          file: plan.file,
          message: `Multiple local media files would publish to ${reference.canonicalKey}.`,
        });
      }

      seen.set(reference.canonicalKey, reference);
    }
  }

  return issues;
}

function affectedIndexPaths(markdownPlans: MarkdownPlan[]) {
  if (markdownPlans.length === 0) {
    return [];
  }

  const indexes = new Set(['home.json', 'site.json', 'search/index.json', 'taxonomy.json']);

  for (const plan of markdownPlans) {
    if (plan.contentType === 'post') {
      indexes.add('posts/index.json');
    }

    if (plan.contentType === 'story') {
      indexes.add('stories/index.json');
    }

    if (plan.contentType === 'gallery') {
      indexes.add('galleries/index.json');
    }

    if (plan.mediaReferences.some((reference) => !isCanonicalReference(reference.reference))) {
      indexes.add('media/index.json');
      indexes.add('images/index.json');
    }
  }

  return [...indexes].sort((a, b) => a.localeCompare(b));
}

function mediaRefs(data: Frontmatter, content: string) {
  const refs = new Map<string, MediaReference>();
  const cover = textValue(data.cover_image || data.coverImage || data.coverImageId);

  if (cover) {
    refs.set(cover, { reference: cover, role: 'cover' });
  }

  for (const value of [data.images, data.imageIds, data.image_ids]) {
    if (typeof value === 'string') {
      for (const item of value.split(',')) {
        const ref = item.trim();

        if (ref) {
          mergeMediaReference(refs, { reference: ref, role: 'inline' });
        }
      }
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          mergeMediaReference(refs, { reference: item, role: 'inline' });
        } else if (item && typeof item === 'object' && !(item instanceof Date)) {
          const image = item as Frontmatter;
          const ref = textValue(image.id || image.file || image.filename);

          if (ref) {
            mergeMediaReference(refs, {
              reference: ref,
              caption: textValue(image.caption),
              alt: textValue(image.alt),
              role: 'inline',
            });
          }
        }
      }
    }
  }

  for (const match of content.matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    mergeMediaReference(refs, {
      reference: match[1].trim(),
      alt: match[0].replace(/^!\[([^\]]*)].*$/, '$1'),
      role: 'inline',
    });
  }

  return [...refs.values()].filter((ref) => ref.reference);
}

function mergeMediaReference(refs: Map<string, MediaReference>, next: MediaReference) {
  const current = refs.get(next.reference);

  if (!current) {
    refs.set(next.reference, next);
    return;
  }

  refs.set(next.reference, {
    ...current,
    caption: current.caption || next.caption,
    alt: current.alt || next.alt,
    role: current.role === 'cover' ? current.role : next.role,
  });
}

function manifestAssets(markdownPlans: MarkdownPlan[], mediaManifest: MediaManifest) {
  const assets = new Map<string, MediaAsset>();

  for (const plan of markdownPlans) {
    for (const reference of plan.mediaReferences) {
      if (reference.manifestAction !== 'add') {
        continue;
      }

      if (!reference.hash || !reference.byteSize) {
        continue;
      }

      const parts = partsFromCanonicalKey(reference.canonicalKey);

      if (!parts) {
        continue;
      }

      const usage = plan.contentType
        ? {
            contentType: plan.contentType,
            id: plan.contentId,
            route: plan.route,
            role: usageRole(plan.contentType, reference.role),
          }
        : undefined;

      assets.set(reference.canonicalKey, {
        siteKey: mediaManifest.site.key,
        id: reference.canonicalKey,
        kind: reference.kind,
        date: `${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`,
        filename: path.basename(reference.canonicalKey),
        title: plan.title,
        caption: reference.caption || undefined,
        alt: reference.alt || reference.caption || plan.title,
        rawUrl: reference.rawUrl || '',
        thumbUrl: reference.thumbUrl,
        posterUrl: reference.posterUrl,
        contentType: contentTypeForFilename(reference.canonicalKey),
        byteSize: reference.byteSize,
        hash: reference.hash,
        people: [],
        locations: [],
        usedBy: usage ? [usage] : [],
        ...parts,
      });
    }
  }

  return [...assets.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function writeSourceChanges(
  markdownPlans: MarkdownPlan[],
  plannedManifestAssets: MediaAsset[],
  mediaManifest: MediaManifest,
): Promise<PublishWriteResult> {
  const markdownFilesChanged: string[] = [];

  for (const plan of markdownPlans) {
    const rewrites = plan.mediaReferences.filter(
      (reference) =>
        !isCanonicalReference(reference.reference) &&
        (reference.manifestAction === 'add' || reference.manifestAction === 'reuse-existing'),
    );

    if (rewrites.length === 0) {
      continue;
    }

    const fullPath = path.join(root, plan.file);
    const current = await fs.readFile(fullPath, 'utf8');
    let next = current;

    for (const rewrite of rewrites) {
      next = replaceAllLiteral(next, rewrite.reference, rewrite.canonicalKey);
    }

    if (next !== current) {
      await fs.writeFile(fullPath, next, 'utf8');
      markdownFilesChanged.push(plan.file);
    }
  }

  const manifestAssetsAdded: string[] = [];

  if (plannedManifestAssets.length > 0) {
    const assetsById = new Map(mediaManifest.assets.map((asset) => [asset.id, asset]));

    for (const asset of plannedManifestAssets) {
      if (!assetsById.has(asset.id)) {
        assetsById.set(asset.id, asset);
        manifestAssetsAdded.push(asset.id);
      }
    }

    await writeMediaManifest(sourceMediaManifestPath, {
      ...mediaManifest,
      generatedAt: new Date().toISOString(),
      assets: [...assetsById.values()].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)),
    });
  }

  return {
    markdownFilesChanged,
    manifestAssetsAdded,
    mediaFilesRemoved: [],
  };
}

function replaceAllLiteral(value: string, search: string, replacement: string) {
  return value.split(search).join(replacement);
}

function partsFromCanonicalKey(value: string): DateParts | undefined {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})\//.exec(value);

  if (!match) {
    return undefined;
  }

  return {
    year: match[1],
    month: match[2],
    day: match[3],
  };
}

function usageRole(contentType: ContentType, role: NonNullable<MediaUsage['role']>) {
  if (role === 'cover') {
    return role;
  }

  if (contentType === 'gallery') {
    return 'gallery-item';
  }

  if (contentType === 'story') {
    return 'story-media';
  }

  return role;
}

type DateParts = {
  year: string;
  month: string;
  day: string;
};

function dateParts(value: unknown): DateParts | undefined {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return {
      year: String(value.getFullYear()).padStart(4, '0'),
      month: String(value.getMonth() + 1).padStart(2, '0'),
      day: String(value.getDate()).padStart(2, '0'),
    };
  }

  const text = textValue(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);

  if (!match) {
    return undefined;
  }

  return {
    year: match[1],
    month: match[2],
    day: match[3],
  };
}

async function localMediaDetails(localPath: string) {
  const [contents, details] = await Promise.all([
    fs.readFile(localPath),
    fs.stat(localPath),
  ]);

  return {
    byteSize: details.size,
    hash: {
      algorithm: 'sha256' as const,
      value: createHash('sha256').update(contents).digest('hex'),
    },
  };
}

function contentTypeFromFrontmatter(data: Frontmatter): ContentType | undefined {
  const value = textValue(data.content_type || data.contentType || data.type).toLowerCase();

  if (value === 'post' || value === 'story' || value === 'gallery') {
    return value;
  }

  return undefined;
}

function routeFor(contentType: ContentType, parts: DateParts, slug: string) {
  const folder = contentType === 'post' ? 'posts' : `${contentType}s`;
  return `/${folder}/${parts.year}/${parts.month}/${parts.day}/${slug}`;
}

function isCanonicalReference(value: string) {
  return canonicalMediaKey.test(value);
}

function isLikelyMediaFile(file: string) {
  return /\.(avif|gif|jpe?g|m4v|mov|mp4|png|webp)$/i.test(file);
}

function mediaKind(value: string): MediaKind {
  return /\.(mp4|mov|m4v|webm)$/i.test(value) ? 'video' : 'image';
}

function videoPosterKey(value: string) {
  const extension = path.extname(value);
  return `${value.slice(0, -extension.length)}.jpg`;
}

function assetUrl(mediaManifest: MediaManifest, prefix: 'images' | 'thumbs', canonicalKey: string) {
  const storagePrefix = prefix === 'images' ? mediaManifest.storage.rawPrefix : mediaManifest.storage.thumbPrefix;
  return `${mediaManifest.storage.baseUrl.replace(/\/?$/, '/')}${storagePrefix}/${encodePath(canonicalKey.split('/'))}`;
}

function encodePath(parts: string[]) {
  return parts.map((part) => encodeURIComponent(part)).join('/');
}

function contentTypeForFilename(value: string) {
  const extension = path.extname(value).toLowerCase();

  switch (extension) {
    case '.avif':
      return 'image/avif';
    case '.gif':
      return 'image/gif';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.m4v':
      return 'video/x-m4v';
    case '.mov':
      return 'video/quicktime';
    case '.mp4':
      return 'video/mp4';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function titleFromSlug(value: string) {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function slugFromPostFilename(filename: string) {
  return filename.replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
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

function fileExists(file: string) {
  return existsSync(file);
}

function isDeletedStatus(status: string) {
  return status.trim().startsWith('D');
}

function changeDetectionMode(options: PublishPlanOptions) {
  if (options.base && isZeroSha(options.base)) {
    return 'root-diff';
  }

  if (options.base) {
    return 'commit-range';
  }

  return 'working-tree';
}

function isZeroSha(value: string) {
  return /^0+$/.test(value);
}

function optionalArgValue(name: string) {
  const direct = args.find((arg) => arg.startsWith(`${name}=`));

  if (direct) {
    return optionalText(direct.slice(name.length + 1));
  }

  const index = args.indexOf(name);
  return index >= 0 ? optionalText(args[index + 1]) : undefined;
}

function hasArg(name: string) {
  return args.includes(name);
}

function optionalText(value: string | undefined) {
  return value?.trim() || undefined;
}

function printReport(report: {
  mode: string;
  changeDetection?: {
    mode: string;
    base?: string;
    head?: string;
  };
  changedFiles: ChangedFile[];
  changedMarkdown: string[];
  changedLocalMedia: string[];
  affectedJson: string[];
  affectedIndexes: string[];
  plannedMediaUploads: Array<{
    contentFile: string;
    reference: string;
    canonicalKey: string;
    exists: boolean;
    manifestAction: MediaRewrite['manifestAction'];
  }>;
  plannedManifestAssets: MediaAsset[];
  markdownRewrites: Array<{ file: string; from: string; to: string }>;
  issues: Issue[];
  writeResult?: PublishWriteResult;
}) {
  console.log('Publish plan');
  console.log(`Mode: ${report.mode}`);
  if (report.changeDetection) {
    console.log(`Change detection: ${report.changeDetection.mode}`);
    if (report.changeDetection.base) {
      console.log(`Base: ${report.changeDetection.base}`);
    }
    if (report.changeDetection.head) {
      console.log(`Head: ${report.changeDetection.head}`);
    }
  }
  console.log(`Changed files: ${report.changedFiles.length}`);
  console.log(`Changed content Markdown: ${report.changedMarkdown.length}`);
  console.log(`Changed local media files: ${report.changedLocalMedia.length}`);
  console.log(`Affected content JSON: ${report.affectedJson.length}`);
  console.log(`Affected indexes: ${report.affectedIndexes.length}`);
  console.log(`Planned media uploads: ${report.plannedMediaUploads.length}`);
  console.log(`Planned manifest assets: ${report.plannedManifestAssets.length}`);
  console.log(`Markdown rewrites: ${report.markdownRewrites.length}`);
  console.log(`Issues: ${report.issues.length}`);
  if (report.writeResult) {
    console.log(`Markdown files changed: ${report.writeResult.markdownFilesChanged.length}`);
    console.log(`Manifest assets added: ${report.writeResult.manifestAssetsAdded.length}`);
    console.log(`Media files removed: ${report.writeResult.mediaFilesRemoved.length}`);
  }
  console.log(`Report: ${path.relative(root, reportPath)}`);

  printList('Changed content Markdown', report.changedMarkdown);
  printList('Changed local media files', report.changedLocalMedia);
  printList('Affected content JSON', report.affectedJson);
  printList('Affected indexes', report.affectedIndexes);
  printList(
    'Planned media uploads',
    report.plannedMediaUploads.map((upload) => `${upload.reference} -> ${upload.canonicalKey} (${upload.manifestAction})`),
  );
  printList('Planned manifest assets', report.plannedManifestAssets.map((asset) => asset.id));

  if (report.writeResult) {
    printList('Written Markdown files', report.writeResult.markdownFilesChanged);
    printList('Written manifest assets', report.writeResult.manifestAssetsAdded);
  }

  if (report.issues.length > 0) {
    printList(
      'Issues',
      report.issues.map((issue) => `${issue.code} ${issue.file}: ${issue.message}`),
      20,
    );
  }
}

function printList(label: string, values: string[], max = 12) {
  if (values.length === 0) {
    return;
  }

  console.log('');
  console.log(`${label}:`);

  for (const value of values.slice(0, max)) {
    console.log(`- ${value}`);
  }

  if (values.length > max) {
    console.log(`...and ${(values.length - max).toLocaleString()} more.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
