import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

type Frontmatter = Record<string, unknown>;

type PlannedMediaUpload = {
  contentFile: string;
  reference: string;
  canonicalKey: string;
  localPath?: string;
  exists: boolean;
  kind: 'image' | 'video';
  manifestAction: 'none' | 'add' | 'reuse-existing' | 'collision';
};

type PublishPlanReport = {
  generatedAt: string;
  mode: 'plan' | 'write-source';
  plannedMediaUploads: PlannedMediaUpload[];
  markdownRewrites?: Array<{
    file: string;
    from: string;
    to: string;
  }>;
  issues: Array<{
    code: string;
    file: string;
    message: string;
  }>;
};

type MediaPublishResult = {
  generatedAt: string;
  reportGeneratedAt?: string;
  operationCount: number;
  stats: {
    failed: number;
    processed: number;
  };
  errors: Array<{
    contentFile: string;
    canonicalKey: string;
    localPath: string;
    kind: 'raw' | 'thumbnail' | 'poster' | 'thumb-fallback';
    blobName: string;
    message: string;
  }>;
  operations?: Array<{
    contentFile: string;
    canonicalKey: string;
    localPath: string;
    sourcePath: string;
    kind: 'raw' | 'thumbnail' | 'poster' | 'thumb-fallback';
    blobName: string;
  }>;
};

type CleanupCandidate = {
  localPath: string;
  absolutePath: string;
  contentFiles: string[];
  canonicalKeys: string[];
  references: string[];
  manifestActions: Array<'add' | 'reuse-existing'>;
  exists: boolean;
};

type CleanupIssue = {
  code: string;
  file?: string;
  localPath?: string;
  message: string;
};

type CleanupOptions = {
  reportPath: string;
  mediaResultPath: string;
  resultPath: string;
  write: boolean;
  skipUploadCheck: boolean;
};

const root = process.cwd();
const args = process.argv.slice(2);
const mediaExtension = /\.(avif|gif|jpe?g|m4v|mov|mp4|png|webp)$/i;

async function main() {
  const options = cleanupOptions();
  const report = await readReport(options.reportPath);
  const mediaResult = await readMediaResult(options.mediaResultPath);
  const issues: CleanupIssue[] = [];

  if (report.issues.length > 0) {
    issues.push({
      code: 'plan.hasIssues',
      message: `Publish plan has ${report.issues.length.toLocaleString()} issue(s). Cleanup will not delete local media.`,
    });
  }

  const candidates = await cleanupCandidates(report, mediaResult, options, issues);

  printPlan(options, candidates, issues);

  const deleted: string[] = [];
  const skipped: string[] = [];

  if (options.write && issues.length === 0) {
    for (const candidate of candidates) {
      if (!candidate.exists) {
        skipped.push(candidate.localPath);
        continue;
      }

      await unlink(candidate.absolutePath);
      deleted.push(candidate.localPath);
    }
  }

  await writeResult(options, report, candidates, deleted, skipped, issues);

  if (!options.write) {
    console.log('\nDry run only. Re-run with npm run publish:cleanup-media:write to delete local draft media.');
  }

  if (issues.length > 0) {
    process.exitCode = 1;
  }
}

function cleanupOptions(): CleanupOptions {
  return {
    reportPath: path.resolve(root, argValue('--report') || '.tmp/publish-plan-report.json'),
    mediaResultPath: path.resolve(root, argValue('--media-result') || '.tmp/publish-media-result.json'),
    resultPath: path.resolve(root, argValue('--result') || '.tmp/publish-cleanup-media-result.json'),
    write: hasArg('--write'),
    skipUploadCheck: hasArg('--skip-upload-check'),
  };
}

async function readReport(reportPath: string): Promise<PublishPlanReport> {
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as PublishPlanReport;

  if (!Array.isArray(report.plannedMediaUploads)) {
    throw new Error(`Publish plan ${reportPath} does not include plannedMediaUploads.`);
  }

  return report;
}

async function readMediaResult(mediaResultPath: string): Promise<MediaPublishResult | undefined> {
  if (!existsSync(mediaResultPath)) {
    return undefined;
  }

  return JSON.parse(await readFile(mediaResultPath, 'utf8')) as MediaPublishResult;
}

async function cleanupCandidates(
  report: PublishPlanReport,
  mediaResult: MediaPublishResult | undefined,
  options: CleanupOptions,
  issues: CleanupIssue[],
) {
  const candidatesByPath = new Map<string, CleanupCandidate>();

  for (const upload of report.plannedMediaUploads) {
    if (upload.manifestAction !== 'add' && upload.manifestAction !== 'reuse-existing') {
      continue;
    }

    if (!upload.localPath || isCanonicalMediaKey(upload.reference)) {
      continue;
    }

    const absolutePath = safeAbsolutePath(upload.localPath, issues);

    if (!absolutePath) {
      continue;
    }

    if (!mediaExtension.test(upload.localPath)) {
      issues.push({
        code: 'cleanup.notMediaFile',
        localPath: upload.localPath,
        message: `Refusing to delete non-media file ${upload.localPath}.`,
      });
      continue;
    }

    let candidate = candidatesByPath.get(upload.localPath);

    if (!candidate) {
      candidate = {
        localPath: upload.localPath,
        absolutePath,
        contentFiles: [],
        canonicalKeys: [],
        references: [],
        manifestActions: [],
        exists: existsSync(absolutePath),
      };
      candidatesByPath.set(upload.localPath, candidate);
    }

    candidate.contentFiles = uniqueSorted([...candidate.contentFiles, upload.contentFile]);
    candidate.canonicalKeys = uniqueSorted([...candidate.canonicalKeys, upload.canonicalKey]);
    candidate.references = uniqueSorted([...candidate.references, upload.reference]);
    candidate.manifestActions = uniqueSorted([...candidate.manifestActions, upload.manifestAction]);
  }

  const candidates = [...candidatesByPath.values()].sort((a, b) => a.localPath.localeCompare(b.localPath));

  for (const candidate of candidates) {
    await verifySourceRewritten(candidate, issues);
    verifyUploadCompleted(candidate, mediaResult, options, issues);
  }

  return candidates;
}

async function verifySourceRewritten(candidate: CleanupCandidate, issues: CleanupIssue[]) {
  for (const file of candidate.contentFiles) {
    const fullPath = path.resolve(root, file);

    if (!isPathInsideRoot(fullPath) || !existsSync(fullPath)) {
      issues.push({
        code: 'cleanup.missingContentFile',
        file,
        localPath: candidate.localPath,
        message: `Cannot verify source rewrite because ${file} is missing.`,
      });
      continue;
    }

    const source = await readFile(fullPath, 'utf8');
    const parsed = matter(source);
    const mediaReferences = mediaRefs(parsed.data, parsed.content);

    for (const reference of candidate.references) {
      if (mediaReferences.includes(reference)) {
        issues.push({
          code: 'cleanup.sourceStillReferencesLocalMedia',
          file,
          localPath: candidate.localPath,
          message: `${file} still references local media "${reference}". Run npm run publish:prepare before cleanup.`,
        });
      }
    }

    if (!candidate.canonicalKeys.some((canonicalKey) => mediaReferences.includes(canonicalKey))) {
      issues.push({
        code: 'cleanup.sourceMissingCanonicalMedia',
        file,
        localPath: candidate.localPath,
        message: `${file} does not appear to reference the canonical media key for ${candidate.localPath}.`,
      });
    }
  }
}

function verifyUploadCompleted(
  candidate: CleanupCandidate,
  mediaResult: MediaPublishResult | undefined,
  options: CleanupOptions,
  issues: CleanupIssue[],
) {
  if (candidate.manifestActions.every((action) => action === 'reuse-existing')) {
    return;
  }

  if (options.skipUploadCheck) {
    return;
  }

  if (!mediaResult) {
    issues.push({
      code: 'cleanup.missingMediaPublishResult',
      localPath: candidate.localPath,
      message: `Cannot verify upload for ${candidate.localPath} because .tmp/publish-media-result.json is missing.`,
    });
    return;
  }

  if (mediaResult.stats.failed > 0 || mediaResult.errors.length > 0) {
    issues.push({
      code: 'cleanup.mediaPublishFailed',
      localPath: candidate.localPath,
      message: `Media publish result has failures. Cleanup will not delete ${candidate.localPath}.`,
    });
    return;
  }

  const rawOperations = mediaResult.operations?.filter((operation) => operation.kind === 'raw') ?? [];
  const hasPublishedRaw = candidate.canonicalKeys.some((canonicalKey) =>
    rawOperations.some((operation) => operation.canonicalKey === canonicalKey && operation.sourcePath === candidate.localPath),
  );

  if (!hasPublishedRaw) {
    issues.push({
      code: 'cleanup.rawUploadNotVerified',
      localPath: candidate.localPath,
      message: `Could not verify a successful raw upload for ${candidate.localPath}.`,
    });
  }
}

function safeAbsolutePath(localPath: string, issues: CleanupIssue[]) {
  const absolutePath = path.resolve(root, localPath);

  if (!isPathInsideRoot(absolutePath)) {
    issues.push({
      code: 'cleanup.pathOutsideRepo',
      localPath,
      message: `Refusing to delete path outside the repository: ${localPath}.`,
    });
    return undefined;
  }

  return absolutePath;
}

function printPlan(options: CleanupOptions, candidates: CleanupCandidate[], issues: CleanupIssue[]) {
  console.log('Published media cleanup');
  console.log(`Report: ${path.relative(root, options.reportPath)}`);
  console.log(`Media result: ${path.relative(root, options.mediaResultPath)}`);
  console.log(`Mode: ${options.write ? 'write' : 'dry-run'}`);
  console.log(`Upload verification: ${options.skipUploadCheck ? 'skipped' : 'required'}`);
  console.log(`Cleanup candidates: ${candidates.length.toLocaleString()}`);
  console.log(`Existing local files: ${candidates.filter((candidate) => candidate.exists).length.toLocaleString()}`);
  console.log(`Issues: ${issues.length.toLocaleString()}`);

  printList(
    'Cleanup candidates',
    candidates.map((candidate) => `${candidate.localPath} -> ${candidate.canonicalKeys.join(', ')}`),
  );

  if (issues.length > 0) {
    printList(
      'Issues',
      issues.map((issue) => `${issue.code}${issue.file ? ` ${issue.file}` : ''}: ${issue.message}`),
      20,
    );
  }
}

async function writeResult(
  options: CleanupOptions,
  report: PublishPlanReport,
  candidates: CleanupCandidate[],
  deleted: string[],
  skipped: string[],
  issues: CleanupIssue[],
) {
  await mkdir(path.dirname(options.resultPath), { recursive: true });

  const result = {
    generatedAt: new Date().toISOString(),
    reportGeneratedAt: report.generatedAt,
    mode: options.write ? 'write' : 'dry-run',
    candidates: candidates.map((candidate) => ({
      localPath: candidate.localPath,
      contentFiles: candidate.contentFiles,
      canonicalKeys: candidate.canonicalKeys,
      references: candidate.references,
      manifestActions: candidate.manifestActions,
      exists: candidate.exists,
    })),
    deleted,
    skipped,
    issues,
  };

  await writeFile(options.resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`\nWrote result: ${path.relative(root, options.resultPath)}`);
}

function isCanonicalMediaKey(value: string) {
  return /^\d{4}\/\d{2}\/\d{2}\/[^/]+\.[A-Za-z0-9]+$/.test(value);
}

function mediaRefs(data: Frontmatter, content: string) {
  const refs = new Set<string>();
  const cover = textValue(data.cover_image || data.coverImage || data.coverImageId);

  if (cover) {
    refs.add(cover);
  }

  for (const value of [data.images, data.imageIds, data.image_ids]) {
    if (typeof value === 'string') {
      for (const item of value.split(',')) {
        const ref = item.trim();

        if (ref) {
          refs.add(ref);
        }
      }
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          refs.add(item);
        } else if (item && typeof item === 'object' && !(item instanceof Date)) {
          const image = item as Frontmatter;
          const ref = textValue(image.id || image.file || image.filename);

          if (ref) {
            refs.add(ref);
          }
        }
      }
    }
  }

  for (const match of content.matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    refs.add(match[1].trim());
  }

  return [...refs].filter(Boolean);
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

function isPathInsideRoot(absolutePath: string) {
  const relative = path.relative(root, absolutePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function hasArg(name: string) {
  return args.includes(name);
}

function argValue(name: string) {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function uniqueSorted<T extends string>(values: T[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
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
