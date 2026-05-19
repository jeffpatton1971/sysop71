import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';

type PlannedMediaUpload = {
  contentFile: string;
  reference: string;
  canonicalKey: string;
  localPath?: string;
  exists: boolean;
  kind: 'image' | 'video';
  byteSize?: number;
  hash?: {
    algorithm: 'sha256';
    value: string;
  };
  rawBlobPath: string;
  thumbBlobPath?: string;
  posterBlobPath?: string;
  manifestAction: 'none' | 'add' | 'reuse-existing' | 'collision';
};

type PublishPlanReport = {
  generatedAt: string;
  mode: 'plan' | 'write-source';
  mediaManifest: {
    storage: {
      accountName: string;
      containerName: string;
      baseUrl: string;
      rawPrefix: 'images';
      thumbPrefix: 'thumbs';
    };
  };
  plannedMediaUploads: PlannedMediaUpload[];
  issues: Array<{
    code: string;
    file: string;
    message: string;
  }>;
};

type MediaPublishOptions = {
  reportPath: string;
  resultPath: string;
  derivativeRoot: string;
  write: boolean;
  overwrite: boolean;
  skipDerivatives: boolean;
  concurrency: number;
  maxErrors: number;
  thumbnailWidth: number;
  thumbnailQuality: number;
  posterTimestamp: string;
  cacheControl: string;
  connectionString?: string;
};

type UploadOperation = {
  contentFile: string;
  canonicalKey: string;
  sourcePath: string;
  localPath: string;
  kind: 'raw' | 'thumbnail' | 'poster' | 'thumb-fallback';
  mediaKind: 'image' | 'video';
  blobName: string;
  byteSize?: number;
  hash?: {
    algorithm: 'sha256';
    value: string;
  };
};

type DerivativeStats = {
  generatedThumbnails: number;
  generatedPosters: number;
  fallbackThumbs: number;
};

type PublishStats = {
  uploaded: number;
  skippedExisting: number;
  skippedReuseExisting: number;
  failed: number;
  processed: number;
  derivatives: DerivativeStats;
};

type PublishError = {
  contentFile: string;
  canonicalKey: string;
  localPath: string;
  kind: UploadOperation['kind'];
  blobName: string;
  message: string;
};

const execFileAsync = promisify(execFile);
const root = process.cwd();
const args = process.argv.slice(2);
const defaultCacheControl = 'public, max-age=31536000, immutable';

async function main() {
  const options = publishOptions();
  const report = await readReport(options.reportPath);
  assertReportPublishable(report);
  const skippedReuseExisting = report.plannedMediaUploads.filter(
    (upload) => upload.manifestAction === 'reuse-existing',
  ).length;
  const operations = uploadOperations(report, options);
  const dryDerivativeStats = derivativeStatsForOperations(operations);

  printPlan(report, options, operations, skippedReuseExisting, dryDerivativeStats);

  if (!options.write) {
    printDryRunSample(operations);
    console.log('\nDry run only. Re-run with --write to generate derivatives and upload media blobs.');
    return;
  }

  const derivativeStats = await prepareDerivatives(operations, options);
  const containerClient = await containerClientForReport(report, options);
  await containerClient.createIfNotExists();
  const result = await uploadAll(containerClient, operations, options, derivativeStats);

  result.stats.skippedReuseExisting = skippedReuseExisting;
  await writeResult(options.resultPath, report, options, operations, result.stats, result.errors);

  if (result.errors.length > 0) {
    throw new Error(`Media publish completed with ${result.errors.length.toLocaleString()} failed operations.`);
  }

  console.log('\nMedia publish complete.');
}

function publishOptions(): MediaPublishOptions {
  const reportPath = path.resolve(root, argValue('--report') || '.tmp/publish-plan-report.json');
  const resultPath = path.resolve(root, argValue('--result') || '.tmp/publish-media-result.json');
  const derivativeRoot = path.resolve(root, process.env.MEDIA_DERIVATIVE_ROOT || '.tmp/media-derivatives');
  const concurrency = numberArg('--concurrency', 8);
  const maxErrors = numberArg('--max-errors', 20);
  const thumbnailWidth = envNumber('MEDIA_THUMBNAIL_WIDTH', 960);
  const thumbnailQuality = envNumber('MEDIA_THUMBNAIL_QUALITY', 82);

  if (concurrency < 1 || concurrency > 64) {
    throw new Error('--concurrency must be between 1 and 64.');
  }

  if (maxErrors < 1) {
    throw new Error('--max-errors must be at least 1.');
  }

  if (thumbnailWidth < 64 || thumbnailWidth > 4096) {
    throw new Error('MEDIA_THUMBNAIL_WIDTH must be between 64 and 4096.');
  }

  if (thumbnailQuality < 1 || thumbnailQuality > 100) {
    throw new Error('MEDIA_THUMBNAIL_QUALITY must be between 1 and 100.');
  }

  return {
    reportPath,
    resultPath,
    derivativeRoot,
    write: hasArg('--write'),
    overwrite: hasArg('--overwrite'),
    skipDerivatives: hasArg('--skip-derivatives') || hasArg('--skip-thumb-fallbacks'),
    concurrency,
    maxErrors,
    thumbnailWidth,
    thumbnailQuality,
    posterTimestamp: process.env.MEDIA_POSTER_TIMESTAMP || '00:00:01',
    cacheControl: process.env.MEDIA_STORAGE_CACHE_CONTROL || defaultCacheControl,
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING?.trim(),
  };
}

async function readReport(reportPath: string): Promise<PublishPlanReport> {
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as PublishPlanReport;

  if (!report.mediaManifest?.storage) {
    throw new Error(`Publish plan ${reportPath} does not include media manifest storage settings.`);
  }

  if (!Array.isArray(report.plannedMediaUploads)) {
    throw new Error(`Publish plan ${reportPath} does not include plannedMediaUploads.`);
  }

  return report;
}

function assertReportPublishable(report: PublishPlanReport) {
  if (report.issues.length > 0) {
    throw new Error(
      `Publish plan has ${report.issues.length.toLocaleString()} issue(s). Run npm run publish:plan and fix them before publishing media.`,
    );
  }

  const missingLocalFiles = report.plannedMediaUploads.filter(
    (upload) => upload.manifestAction === 'add' && (!upload.localPath || !upload.exists),
  );

  if (missingLocalFiles.length > 0) {
    throw new Error(
      `Publish plan includes ${missingLocalFiles.length.toLocaleString()} upload(s) without local files.`,
    );
  }
}

function uploadOperations(report: PublishPlanReport, options: MediaPublishOptions) {
  const operations: UploadOperation[] = [];

  for (const upload of report.plannedMediaUploads) {
    if (upload.manifestAction !== 'add') {
      continue;
    }

    if (!upload.localPath) {
      continue;
    }

    operations.push({
      contentFile: upload.contentFile,
      canonicalKey: upload.canonicalKey,
      sourcePath: upload.localPath,
      localPath: upload.localPath,
      kind: 'raw',
      mediaKind: upload.kind,
      blobName: upload.rawBlobPath,
      byteSize: upload.byteSize,
      hash: upload.hash,
    });

    if (options.skipDerivatives && upload.kind === 'image' && upload.thumbBlobPath) {
      operations.push({
        contentFile: upload.contentFile,
        canonicalKey: upload.canonicalKey,
        sourcePath: upload.localPath,
        localPath: upload.localPath,
        kind: 'thumb-fallback',
        mediaKind: upload.kind,
        blobName: upload.thumbBlobPath,
        byteSize: upload.byteSize,
        hash: upload.hash,
      });
    } else if (upload.kind === 'image' && upload.thumbBlobPath) {
      operations.push({
        contentFile: upload.contentFile,
        canonicalKey: upload.canonicalKey,
        sourcePath: upload.localPath,
        localPath: derivativePath(options.derivativeRoot, upload.thumbBlobPath),
        kind: 'thumbnail',
        mediaKind: upload.kind,
        blobName: upload.thumbBlobPath,
      });
    } else if (!options.skipDerivatives && upload.kind === 'video' && upload.posterBlobPath) {
      operations.push({
        contentFile: upload.contentFile,
        canonicalKey: upload.canonicalKey,
        sourcePath: upload.localPath,
        localPath: derivativePath(options.derivativeRoot, upload.posterBlobPath),
        kind: 'poster',
        mediaKind: upload.kind,
        blobName: upload.posterBlobPath,
      });
    }
  }

  return operations.sort((a, b) => a.blobName.localeCompare(b.blobName));
}

function derivativePath(derivativeRoot: string, blobName: string) {
  return path.relative(root, path.join(derivativeRoot, blobName)).replaceAll(path.sep, '/');
}

function printPlan(
  report: PublishPlanReport,
  options: MediaPublishOptions,
  operations: UploadOperation[],
  skippedReuseExisting: number,
  derivativeStats: DerivativeStats,
) {
  console.log('Media publish');
  console.log(`Report: ${path.relative(root, options.reportPath)}`);
  console.log(`Report generated: ${report.generatedAt}`);
  console.log(`Report mode: ${report.mode}`);
  console.log(`Target: ${report.mediaManifest.storage.baseUrl}`);
  console.log(`Mode: ${options.write ? 'write' : 'dry-run'}`);
  console.log(`Overwrite existing blobs: ${options.overwrite ? 'yes' : 'no'}`);
  console.log(`Derivative generation: ${options.skipDerivatives ? 'no' : 'yes'}`);
  console.log(`Derivative root: ${path.relative(root, options.derivativeRoot)}`);
  console.log(`Thumbnail width: ${options.thumbnailWidth}`);
  console.log(`Poster timestamp: ${options.posterTimestamp}`);
  console.log(`Concurrency: ${options.concurrency}`);
  console.log(`Planned media references: ${report.plannedMediaUploads.length.toLocaleString()}`);
  console.log(`Upload operations: ${operations.length.toLocaleString()}`);
  console.log(`Thumbnails to generate: ${derivativeStats.generatedThumbnails.toLocaleString()}`);
  console.log(`Video posters to generate: ${derivativeStats.generatedPosters.toLocaleString()}`);
  console.log(`Fallback thumbnail uploads: ${derivativeStats.fallbackThumbs.toLocaleString()}`);
  console.log(`Reuse-existing media references: ${skippedReuseExisting.toLocaleString()}`);
  console.log(`Cache-Control: ${options.cacheControl}`);
}

function printDryRunSample(operations: UploadOperation[]) {
  if (operations.length === 0) {
    console.log('\nNo media upload operations are currently planned.');
    return;
  }

  console.log('\nFirst media upload operations:');

  for (const operation of operations.slice(0, 12)) {
    const source = operation.kind === 'raw' || operation.kind === 'thumb-fallback'
      ? operation.localPath
      : `${operation.sourcePath} -> ${operation.localPath}`;

    console.log(`- ${operation.kind}: ${source} -> ${operation.blobName}`);
  }

  if (operations.length > 12) {
    console.log(`...and ${(operations.length - 12).toLocaleString()} more.`);
  }
}

async function prepareDerivatives(operations: UploadOperation[], options: MediaPublishOptions) {
  const stats = derivativeStatsForOperations(operations);

  for (const operation of operations) {
    if (operation.kind === 'thumbnail') {
      await generateThumbnail(operation, options);
    } else if (operation.kind === 'poster') {
      await generatePoster(operation, options);
    }
  }

  for (const operation of operations) {
    if (operation.kind !== 'thumbnail' && operation.kind !== 'poster') {
      continue;
    }

    const details = await fileDetails(path.resolve(root, operation.localPath));
    operation.byteSize = details.byteSize;
    operation.hash = details.hash;
  }

  return stats;
}

async function generateThumbnail(operation: UploadOperation, options: MediaPublishOptions) {
  const sourcePath = path.resolve(root, operation.sourcePath);
  const outputPath = path.resolve(root, operation.localPath);
  await mkdir(path.dirname(outputPath), { recursive: true });

  const image = sharp(sourcePath, { animated: false, failOn: 'none' })
    .rotate()
    .resize({
      width: options.thumbnailWidth,
      withoutEnlargement: true,
    });

  switch (path.extname(operation.blobName).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      await image.jpeg({ quality: options.thumbnailQuality, mozjpeg: true }).toFile(outputPath);
      break;
    case '.png':
      await image.png({ compressionLevel: 9, palette: true }).toFile(outputPath);
      break;
    case '.webp':
      await image.webp({ quality: options.thumbnailQuality }).toFile(outputPath);
      break;
    case '.avif':
      await image.avif({ quality: options.thumbnailQuality }).toFile(outputPath);
      break;
    case '.gif':
      await image.gif({ effort: 7 }).toFile(outputPath);
      break;
    default:
      await image.toFile(outputPath);
      break;
  }
}

async function generatePoster(operation: UploadOperation, options: MediaPublishOptions) {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static did not provide an ffmpeg binary path.');
  }

  const sourcePath = path.resolve(root, operation.sourcePath);
  const outputPath = path.resolve(root, operation.localPath);
  await mkdir(path.dirname(outputPath), { recursive: true });

  await execFileAsync(ffmpegPath, [
    '-y',
    '-ss',
    options.posterTimestamp,
    '-i',
    sourcePath,
    '-frames:v',
    '1',
    '-vf',
    `scale=${options.thumbnailWidth}:-2:force_original_aspect_ratio=decrease`,
    '-q:v',
    '3',
    outputPath,
  ]);
}

function derivativeStatsForOperations(operations: UploadOperation[]): DerivativeStats {
  return {
    generatedThumbnails: operations.filter((operation) => operation.kind === 'thumbnail').length,
    generatedPosters: operations.filter((operation) => operation.kind === 'poster').length,
    fallbackThumbs: operations.filter((operation) => operation.kind === 'thumb-fallback').length,
  };
}

async function containerClientForReport(report: PublishPlanReport, options: MediaPublishOptions) {
  const target = report.mediaManifest.storage;
  const connectionAccount = accountNameFromConnectionString(options.connectionString)?.toLowerCase();

  if (connectionAccount && connectionAccount !== target.accountName.toLowerCase()) {
    throw new Error(
      `AZURE_STORAGE_CONNECTION_STRING targets ${connectionAccount}, but the publish plan targets ${target.accountName}.`,
    );
  }

  const serviceClient = options.connectionString
    ? BlobServiceClient.fromConnectionString(options.connectionString)
    : new BlobServiceClient(`https://${target.accountName}.blob.core.windows.net`, new DefaultAzureCredential());

  return serviceClient.getContainerClient(target.containerName);
}

async function uploadAll(
  containerClient: ContainerClient,
  operations: UploadOperation[],
  options: MediaPublishOptions,
  derivativeStats: DerivativeStats,
) {
  const stats: PublishStats = {
    uploaded: 0,
    skippedExisting: 0,
    skippedReuseExisting: 0,
    failed: 0,
    processed: 0,
    derivatives: derivativeStats,
  };
  const errors: PublishError[] = [];
  const startedAt = Date.now();
  let nextIndex = 0;
  let stopForErrors = false;

  async function worker() {
    while (!stopForErrors) {
      const operation = operations[nextIndex];
      nextIndex += 1;

      if (!operation) {
        return;
      }

      try {
        await uploadOperation(containerClient, operation, options);
        stats.uploaded += 1;
      } catch (error) {
        if (error instanceof SkipExistingError) {
          stats.skippedExisting += 1;
        } else {
          stats.failed += 1;
          errors.push({
            contentFile: operation.contentFile,
            canonicalKey: operation.canonicalKey,
            localPath: operation.localPath,
            kind: operation.kind,
            blobName: operation.blobName,
            message: errorMessage(error),
          });

          if (stats.failed >= options.maxErrors) {
            stopForErrors = true;
          }
        }
      } finally {
        stats.processed += 1;
        printProgress(stats, operations.length, startedAt);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(options.concurrency, operations.length) }, worker));

  if (stopForErrors) {
    console.log(`\nStopped after reaching --max-errors=${options.maxErrors}.`);
  }

  return {
    stats,
    errors,
  };
}

async function uploadOperation(
  containerClient: ContainerClient,
  operation: UploadOperation,
  options: MediaPublishOptions,
) {
  const fullPath = path.resolve(root, operation.localPath);
  const blob = containerClient.getBlockBlobClient(operation.blobName);

  if (!options.overwrite && (await blob.exists())) {
    const properties = await blob.getProperties();
    const existingHash = properties.metadata?.sha256;

    if (existingHash && operation.hash?.value && existingHash.toLowerCase() === operation.hash.value.toLowerCase()) {
      throw new SkipExistingError();
    }

    if (operation.kind !== 'raw') {
      throw new SkipExistingError();
    }

    throw new Error(
      `Target blob already exists without a matching sha256 metadata value: ${operation.blobName}. Re-run with --overwrite only if this replacement is intentional.`,
    );
  }

  await blob.uploadFile(fullPath, {
    blobHTTPHeaders: {
      blobContentType: contentType(operation.blobName),
      blobCacheControl: options.cacheControl,
    },
    metadata: compactMetadata({
      sha256: operation.hash?.value,
      sitekey: siteKeyFromBlobClient(containerClient),
      mediakey: operation.canonicalKey,
      publishkind: operation.kind,
    }),
  });
}

async function writeResult(
  resultPath: string,
  report: PublishPlanReport,
  options: MediaPublishOptions,
  operations: UploadOperation[],
  stats: PublishStats,
  errors: PublishError[],
) {
  await mkdir(path.dirname(resultPath), { recursive: true });

  const result = {
    generatedAt: new Date().toISOString(),
    reportGeneratedAt: report.generatedAt,
    target: report.mediaManifest.storage,
    operationCount: operations.length,
    operations: operations.map((operation) => ({
      contentFile: operation.contentFile,
      canonicalKey: operation.canonicalKey,
      localPath: operation.localPath,
      sourcePath: operation.sourcePath,
      kind: operation.kind,
      blobName: operation.blobName,
    })),
    options: {
      overwrite: options.overwrite,
      skipDerivatives: options.skipDerivatives,
      derivativeRoot: path.relative(root, options.derivativeRoot),
      thumbnailWidth: options.thumbnailWidth,
      thumbnailQuality: options.thumbnailQuality,
      posterTimestamp: options.posterTimestamp,
      concurrency: options.concurrency,
      cacheControl: options.cacheControl,
    },
    stats,
    errors,
  };

  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`\nWrote result: ${path.relative(root, resultPath)}`);
}

async function fileDetails(fullPath: string) {
  const [contents, details] = await Promise.all([readFile(fullPath), stat(fullPath)]);

  return {
    byteSize: details.size,
    hash: {
      algorithm: 'sha256' as const,
      value: createHash('sha256').update(contents).digest('hex'),
    },
  };
}

function printProgress(stats: PublishStats, total: number, startedAt: number) {
  if (total === 0) {
    return;
  }

  if (stats.processed % 25 !== 0 && stats.processed !== total) {
    return;
  }

  console.log(
    `Processed ${stats.processed.toLocaleString()} / ${total.toLocaleString()} uploaded=${stats.uploaded.toLocaleString()} skippedExisting=${stats.skippedExisting.toLocaleString()} failed=${stats.failed.toLocaleString()} elapsed=${formatDuration(
      Date.now() - startedAt,
    )}`,
  );
}

function contentType(value: string) {
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

function compactMetadata(values: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value && /^[\x20-\x7E]+$/.test(value)),
  ) as Record<string, string>;
}

function siteKeyFromBlobClient(containerClient: ContainerClient) {
  return containerClient.containerName;
}

function hasArg(name: string) {
  return args.includes(name);
}

function argValue(name: string) {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function numberArg(name: string, defaultValue: number) {
  const value = argValue(name);

  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number.`);
  }

  return parsed;
}

function envNumber(name: string, defaultValue: number) {
  const value = process.env[name];

  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number.`);
  }

  return parsed;
}

function accountNameFromConnectionString(connectionString: string | undefined) {
  return /(?:^|;)AccountName=([^;]+)/.exec(connectionString || '')?.[1];
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function commandErrorMessage(error: unknown) {
  const message = errorMessage(error);

  if (message.includes('ChainedTokenCredential authentication failed')) {
    return [
      'Azure storage authentication failed before any media uploads ran.',
      'Set AZURE_STORAGE_CONNECTION_STRING, or authenticate with Azure CLI / PowerShell before running a write publish.',
      'Examples:',
      '  $env:AZURE_STORAGE_CONNECTION_STRING = "<storage connection string>"',
      '  npm run publish:media',
      '  Connect-AzAccount',
      '  npm run publish:media',
    ].join('\n');
  }

  return message;
}

class SkipExistingError extends Error {}

main().catch((error) => {
  console.error(commandErrorMessage(error));
  process.exitCode = 1;
});
