import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';

type CopyOperation = {
  imageId: string;
  galleryFile: string;
  kind: 'raw' | 'thumb';
  sourceUrl: string;
  targetUrl: string;
  targetAccountName: string;
  targetContainerName: string;
  targetBlobName: string;
  targetMatchesSource: boolean;
};

type Manifest = {
  generatedAt: string;
  siteKey: string;
  target: {
    accountName: string;
    containerName: string;
    baseUrl: string;
  };
  counts: {
    copyOperations: number;
    targetCollisions: number;
    targetCaseInsensitiveCollisions: number;
  };
  copyOperations: CopyOperation[];
};

type MigrationOptions = {
  manifestPath: string;
  resultPath: string;
  write: boolean;
  overwrite: boolean;
  includeVideoThumbs: boolean;
  concurrency: number;
  maxErrors: number;
  offset: number;
  limit?: number;
  kind?: 'raw' | 'thumb';
  connectionString?: string;
};

type MigrationStats = {
  copied: number;
  skippedExisting: number;
  skippedSameTarget: number;
  failed: number;
  processed: number;
};

type MigrationError = {
  imageId: string;
  galleryFile: string;
  kind: 'raw' | 'thumb';
  sourceUrl: string;
  targetUrl: string;
  message: string;
};

const root = process.cwd();
const args = process.argv.slice(2);

async function main() {
  const options = migrationOptions();
  const manifest = await loadManifest(options.manifestPath);
  assertSafeManifest(manifest);
  const operations = scopedOperations(manifest.copyOperations, options);

  printPlan(manifest, options, operations);

  if (!options.write) {
    printDryRunSample(operations);
    console.log('\nDry run only. Re-run with --write to copy blobs.');
    return;
  }

  const result = await migrateOperations(operations, options);
  await writeResult(options.resultPath, manifest, options, operations.length, result.stats, result.errors);

  if (result.errors.length > 0) {
    throw new Error(`Migration completed with ${result.errors.length.toLocaleString()} failed operations.`);
  }

  console.log('\nMigration complete.');
}

function migrationOptions(): MigrationOptions {
  const manifestPath = path.resolve(root, argValue('--manifest') || '.tmp/image-storage-migration-manifest.json');
  const resultPath = path.resolve(root, argValue('--result') || '.tmp/image-storage-migration-result.json');
  const concurrency = numberArg('--concurrency', 8);
  const maxErrors = numberArg('--max-errors', 20);
  const offset = numberArg('--offset', 0);
  const limit = optionalNumberArg('--limit');
  const kind = optionalKindArg('--kind');

  if (concurrency < 1 || concurrency > 64) {
    throw new Error('--concurrency must be between 1 and 64.');
  }

  if (maxErrors < 1) {
    throw new Error('--max-errors must be at least 1.');
  }

  if (offset < 0) {
    throw new Error('--offset must be zero or greater.');
  }

  if (limit !== undefined && limit < 1) {
    throw new Error('--limit must be at least 1 when provided.');
  }

  return {
    manifestPath,
    resultPath,
    write: hasArg('--write'),
    overwrite: hasArg('--overwrite'),
    includeVideoThumbs: hasArg('--include-video-thumbs'),
    concurrency,
    maxErrors,
    offset,
    limit,
    kind,
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING?.trim(),
  };
}

async function loadManifest(manifestPath: string): Promise<Manifest> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;

  if (!Array.isArray(manifest.copyOperations)) {
    throw new Error(`Manifest ${manifestPath} does not include copyOperations.`);
  }

  return manifest;
}

function assertSafeManifest(manifest: Manifest) {
  if (manifest.counts.targetCollisions > 0 || manifest.counts.targetCaseInsensitiveCollisions > 0) {
    throw new Error(
      `Manifest has target collisions. exact=${manifest.counts.targetCollisions} caseInsensitive=${manifest.counts.targetCaseInsensitiveCollisions}`,
    );
  }

  if (manifest.counts.copyOperations !== manifest.copyOperations.length) {
    throw new Error(
      `Manifest operation count mismatch. counts.copyOperations=${manifest.counts.copyOperations} actual=${manifest.copyOperations.length}`,
    );
  }
}

function scopedOperations(copyOperations: CopyOperation[], options: MigrationOptions) {
  const kindFiltered = options.kind
    ? copyOperations.filter((operation) => operation.kind === options.kind)
    : copyOperations;
  const filtered = options.includeVideoThumbs
    ? kindFiltered
    : kindFiltered.filter((operation) => !isVideoThumbnailOperation(operation));
  const end = options.limit === undefined ? undefined : options.offset + options.limit;

  return filtered.slice(options.offset, end);
}

function printPlan(manifest: Manifest, options: MigrationOptions, operations: CopyOperation[]) {
  console.log('Image storage blob migration');
  console.log(`Manifest: ${path.relative(root, options.manifestPath)}`);
  console.log(`Generated: ${manifest.generatedAt}`);
  console.log(`Site: ${manifest.siteKey}`);
  console.log(`Target: ${manifest.target.baseUrl}`);
  console.log(`Mode: ${options.write ? 'write' : 'dry-run'}`);
  console.log(`Overwrite existing targets: ${options.overwrite ? 'yes' : 'no'}`);
  console.log(`Concurrency: ${options.concurrency}`);
  console.log(`Operations in scope: ${operations.length.toLocaleString()} / ${manifest.copyOperations.length.toLocaleString()}`);

  const skippedVideoThumbs = skippedVideoThumbnailOperationCount(manifest.copyOperations, options);

  if (skippedVideoThumbs > 0) {
    console.log(`Video thumbnail operations skipped: ${skippedVideoThumbs.toLocaleString()}`);
  }

  if (options.kind) {
    console.log(`Kind filter: ${options.kind}`);
  }

  if (options.offset > 0 || options.limit !== undefined) {
    console.log(
      `Batch window: offset=${options.offset.toLocaleString()} limit=${options.limit?.toLocaleString() ?? 'none'}`,
    );
  }
}

function printDryRunSample(operations: CopyOperation[]) {
  console.log('\nFirst copy operations:');

  for (const operation of operations.slice(0, 10)) {
    console.log(`- ${operation.kind}: ${operation.sourceUrl} -> ${operation.targetUrl}`);
  }

  if (operations.length > 10) {
    console.log(`...and ${(operations.length - 10).toLocaleString()} more.`);
  }
}

async function migrateOperations(operations: CopyOperation[], options: MigrationOptions) {
  const containerClients = await containerClientsForOperations(operations, options);
  const stats: MigrationStats = {
    copied: 0,
    skippedExisting: 0,
    skippedSameTarget: 0,
    failed: 0,
    processed: 0,
  };
  const errors: MigrationError[] = [];
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
        await migrateOperation(operation, containerClients, options);
        stats.copied += operation.targetMatchesSource ? 0 : 1;
      } catch (error) {
        if (error instanceof SkipExistingError) {
          stats.skippedExisting += 1;
        } else if (error instanceof SkipSameTargetError) {
          stats.skippedSameTarget += 1;
        } else {
          stats.failed += 1;
          errors.push({
            imageId: operation.imageId,
            galleryFile: operation.galleryFile,
            kind: operation.kind,
            sourceUrl: operation.sourceUrl,
            targetUrl: operation.targetUrl,
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

async function migrateOperation(
  operation: CopyOperation,
  containerClients: Map<string, ContainerClient>,
  options: MigrationOptions,
) {
  if (operation.targetMatchesSource) {
    throw new SkipSameTargetError();
  }

  const containerClient = containerClients.get(containerKey(operation.targetAccountName, operation.targetContainerName));

  if (!containerClient) {
    throw new Error(`Missing target container client for ${operation.targetAccountName}/${operation.targetContainerName}.`);
  }

  const blobClient = containerClient.getBlobClient(operation.targetBlobName);

  if (!options.overwrite && (await blobClient.exists())) {
    throw new SkipExistingError();
  }

  await blobClient.syncCopyFromURL(operation.sourceUrl);
}

async function containerClientsForOperations(operations: CopyOperation[], options: MigrationOptions) {
  const targets = uniqueTargets(operations);
  const clients = new Map<string, ContainerClient>();
  const connectionAccount = accountNameFromConnectionString(options.connectionString)?.toLowerCase();

  for (const target of targets) {
    if (connectionAccount && connectionAccount !== target.accountName.toLowerCase()) {
      throw new Error(
        `AZURE_STORAGE_CONNECTION_STRING targets ${connectionAccount}, but manifest targets ${target.accountName}.`,
      );
    }

    const serviceClient = options.connectionString
      ? BlobServiceClient.fromConnectionString(options.connectionString)
      : new BlobServiceClient(`https://${target.accountName}.blob.core.windows.net`, new DefaultAzureCredential());
    const containerClient = serviceClient.getContainerClient(target.containerName);

    await containerClient.createIfNotExists();
    clients.set(containerKey(target.accountName, target.containerName), containerClient);
  }

  return clients;
}

function uniqueTargets(operations: CopyOperation[]) {
  const targets = new Map<string, { accountName: string; containerName: string }>();

  for (const operation of operations) {
    targets.set(containerKey(operation.targetAccountName, operation.targetContainerName), {
      accountName: operation.targetAccountName,
      containerName: operation.targetContainerName,
    });
  }

  return [...targets.values()];
}

function printProgress(stats: MigrationStats, total: number, startedAt: number) {
  if (stats.processed % 100 !== 0 && stats.processed !== total) {
    return;
  }

  console.log(
    `Processed ${stats.processed.toLocaleString()} / ${total.toLocaleString()} copied=${stats.copied.toLocaleString()} skippedExisting=${stats.skippedExisting.toLocaleString()} failed=${stats.failed.toLocaleString()} elapsed=${formatDuration(
      Date.now() - startedAt,
    )}`,
  );
}

async function writeResult(
  resultPath: string,
  manifest: Manifest,
  options: MigrationOptions,
  operationCount: number,
  stats: MigrationStats,
  errors: MigrationError[],
) {
  await mkdir(path.dirname(resultPath), { recursive: true });
  const result = {
    generatedAt: new Date().toISOString(),
    manifestGeneratedAt: manifest.generatedAt,
    siteKey: manifest.siteKey,
    target: manifest.target,
    operationCount,
    options: {
      overwrite: options.overwrite,
      includeVideoThumbs: options.includeVideoThumbs,
      concurrency: options.concurrency,
      offset: options.offset,
      limit: options.limit,
      kind: options.kind,
    },
    stats,
    errors,
  };

  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`\nWrote result: ${path.relative(root, resultPath)}`);
}

function containerKey(accountName: string, containerName: string) {
  return `${accountName.toLowerCase()}/${containerName.toLowerCase()}`;
}

function hasArg(name: string) {
  return args.includes(name);
}

function argValue(name: string) {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function numberArg(name: string, defaultValue: number) {
  const value = optionalNumberArg(name);
  return value ?? defaultValue;
}

function optionalNumberArg(name: string) {
  const value = argValue(name);

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number.`);
  }

  return parsed;
}

function optionalKindArg(name: string) {
  const value = argValue(name);

  if (value === undefined) {
    return undefined;
  }

  if (value !== 'raw' && value !== 'thumb') {
    throw new Error(`${name} must be raw or thumb.`);
  }

  return value;
}

function skippedVideoThumbnailOperationCount(copyOperations: CopyOperation[], options: MigrationOptions) {
  if (options.includeVideoThumbs || options.kind === 'raw') {
    return 0;
  }

  return copyOperations.filter(isVideoThumbnailOperation).length;
}

function isVideoThumbnailOperation(operation: CopyOperation) {
  return operation.kind === 'thumb' && isVideoFilename(operation.sourceUrl);
}

function isVideoFilename(value: string) {
  return ['.mp4', '.mov', '.m4v', '.webm'].includes(path.extname(value.split(/[?#]/)[0]).toLowerCase());
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
      'Azure storage authentication failed before any copy operations ran.',
      'Set AZURE_STORAGE_CONNECTION_STRING, or authenticate with Azure CLI / PowerShell before running a write migration.',
      'Examples:',
      '  $env:AZURE_STORAGE_CONNECTION_STRING = "<storage connection string>"',
      '  npm run assets:migrate:write -- --limit=20',
      '  Connect-AzAccount',
      '  npm run assets:migrate:write -- --limit=20',
    ].join('\n');
  }

  return message;
}

class SkipExistingError extends Error {}
class SkipSameTargetError extends Error {}

main().catch((error) => {
  console.error(commandErrorMessage(error));
  process.exitCode = 1;
});
