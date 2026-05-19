import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type DateParts = {
  year: string;
  month: string;
  day: string;
};

export type MediaKind = 'image' | 'video';

export type MediaUsage = {
  contentType: 'post' | 'story' | 'gallery';
  id: string;
  route?: string;
  role?: 'cover' | 'inline' | 'gallery-item' | 'story-media';
};

export type MediaAsset = DateParts & {
  siteKey: string;
  id: string;
  kind: MediaKind;
  date: string;
  filename: string;
  title?: string;
  caption?: string;
  alt?: string;
  rawUrl: string;
  thumbUrl?: string;
  posterUrl?: string;
  contentType?: string;
  byteSize?: number;
  hash?: {
    algorithm: 'sha256';
    value: string;
  };
  people?: string[];
  locations?: string[];
  usedBy?: MediaUsage[];
  legacy?: {
    galleryMarkdownId?: string;
    source?: 'wordpress' | 'instagram' | 'facebook' | 'legacy';
    sourceFilename?: string;
    sourceUrl?: string;
    postId?: string;
    galleryId?: string;
  };
};

export type MediaManifest = {
  schemaVersion: '2026-05-15';
  generatedAt: string;
  site: {
    key: string;
    title?: string;
  };
  storage: {
    accountName: string;
    containerName: string;
    baseUrl: string;
    rawPrefix: 'images';
    thumbPrefix: 'thumbs';
  };
  assets: MediaAsset[];
};

export async function readMediaManifest(manifestPath: string) {
  return JSON.parse(await readFile(manifestPath, 'utf8')) as MediaManifest;
}

export async function writeMediaManifest(manifestPath: string, manifest: MediaManifest) {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
