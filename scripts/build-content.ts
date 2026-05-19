import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';
import {
  readMediaManifest,
  type MediaAsset,
  type MediaManifest,
} from './media-manifest-lib';

type Frontmatter = Record<string, unknown>;

type DateParts = {
  year: string;
  month: string;
  day: string;
};

type ContentType = 'article' | 'story' | 'gallery';
type EntryType = Exclude<ContentType, 'gallery'>;
type ContentShape = 'post' | 'story';
type ContentStatus = 'draft' | 'published' | 'archived';

type SiteNavItem = {
  label: string;
  href: string;
  icon?: string;
};

type SiteAuthorLink = {
  label: string;
  href: string;
};

type SiteAuthor = {
  name?: string;
  bio?: string;
  imageUrl?: string;
  links?: SiteAuthorLink[];
};

type SiteBanner = {
  eyebrow?: string;
  title?: string;
  text?: string;
  backgroundImage?: string;
  backgroundPosition?: string;
  backgroundSize?: string;
};

type SiteFooter = {
  brandText?: string;
  text?: string;
  links?: SiteNavItem[];
  copyright?: string;
};

type SiteTheme = {
  fontFamily?: string;
  background?: string;
  text?: string;
  surface?: string;
  surfaceRaised?: string;
  border?: string;
  muted?: string;
  accent?: string;
  accentStrong?: string;
  bannerBackground?: string;
  headerBackground?: string;
  footerBackground?: string;
};

type SiteConfig = {
  key?: string;
  title?: string;
  url?: string;
  nav?: SiteNavItem[];
  author?: SiteAuthor;
  banner?: SiteBanner;
  footer?: SiteFooter;
  theme?: SiteTheme;
};

type SourceCount = {
  source: 'wordpress' | 'instagram' | 'facebook';
  label: string;
  count: number;
  href: string;
};

type TaxonomyContentType = 'post' | 'story' | 'gallery';

type TaxonomyContentRef = {
  id: string;
  type: TaxonomyContentType;
  title: string;
  date: string;
  route: string;
};

type TaxonomyTerm = {
  value: string;
  label: string;
  slug: string;
  count: number;
  href: string;
  items: TaxonomyContentRef[];
};

type EntrySource = {
  type?: string;
  subtype?: string;
  id?: string;
  url?: string;
  caption?: string;
  mediaCount?: number;
  crossPostSource?: string;
};

type ContentLink = {
  type?: ContentType;
  id: string;
  title?: string;
  route?: string;
  rel?: string;
};

type PostSummary = DateParts & {
  siteKey: string;
  id: string;
  type: EntryType;
  title: string;
  date: string;
  status: ContentStatus;
  contentShape: ContentShape;
  slug: string;
  route: string;
  legacyUrl: string;
  authors: string[];
  people: string[];
  summary: string;
  excerpt: string;
  categories: string[];
  tags: string[];
  hashtags: string[];
  handles: string[];
  location?: string;
  locations: string[];
  sourceType?: string;
  source?: EntrySource;
  galleryIds: string[];
  imageIds: string[];
  related: ContentLink[];
  caption?: string;
  coverImageId?: string;
  coverImage?: {
    id: string;
    rawUrl: string;
    thumbUrl: string;
    alt: string;
  };
};

type PostDocument = PostSummary & {
  bodyMarkdown: string;
  bodyHtml: string;
};

type ImageSummary = DateParts & {
  siteKey: string;
  id: string;
  type: 'image';
  kind?: 'image' | 'video';
  title: string;
  date: string;
  route: string;
  rawUrl: string;
  thumbUrl: string;
  caption?: string;
  alt?: string;
  galleryId?: string;
  source?: string;
  sourceFilename?: string;
  postId?: string;
  postRoute?: string;
};

type GallerySummary = DateParts & {
  siteKey: string;
  id: string;
  type: 'gallery';
  title: string;
  date: string;
  status: ContentStatus;
  slug: string;
  route: string;
  legacyUrl?: string;
  authors: string[];
  people: string[];
  summary: string;
  categories: string[];
  tags: string[];
  hashtags: string[];
  locations: string[];
  sourceType?: string;
  source?: EntrySource;
  imageIds: string[];
  imageCount: number;
  coverImageId: string;
  coverImage: {
    id: string;
    rawUrl: string;
    thumbUrl: string;
    alt: string;
  };
  related: ContentLink[];
};

type GalleryDocument = GallerySummary & {
  descriptionMarkdown?: string;
  descriptionHtml?: string;
  images: ImageSummary[];
};

type SearchContentType = 'post' | 'story' | 'gallery';

type SearchIndexItem = DateParts & {
  siteKey: string;
  id: string;
  type: SearchContentType;
  title: string;
  date: string;
  route: string;
  summary: string;
  authors: string[];
  people: string[];
  categories: string[];
  hashtags: string[];
  locations: string[];
  imageCount?: number;
  coverImage?: {
    id: string;
    rawUrl: string;
    thumbUrl: string;
    alt: string;
  };
  searchText: string;
};

type SearchIndex = {
  generatedAt: string;
  items: SearchIndexItem[];
};

type GallerySource = DateParts & {
  siteKey: string;
  id: string;
  type: 'gallery';
  title: string;
  date: string;
  status: ContentStatus;
  slug: string;
  route: string;
  legacyUrl: string;
  authors: string[];
  people: string[];
  summary: string;
  categories: string[];
  tags: string[];
  hashtags: string[];
  locations: string[];
  sourceType?: string;
  source?: EntrySource;
  galleryId: string;
  coverImageId?: string;
  related: ContentLink[];
  descriptionMarkdown?: string;
  descriptionHtml?: string;
};

type ArchiveMonth = {
  month: string;
  count: number;
  href: string;
  days: ArchiveDay[];
};

type ArchiveDay = {
  day: string;
  count: number;
  href: string;
};

type ArchiveYear = {
  year: string;
  count: number;
  href: string;
  months: ArchiveMonth[];
};

const root = process.cwd();
const publicRoot = path.join(root, 'public');
const outputRoot = path.join(publicRoot, 'content');
const postsRoot = path.join(root, '_posts');
const siteConfigPath = path.join(root, 'content', 'site.config.json');
const sourceMediaManifestPath = path.join(root, 'content', 'media', 'index.json');
const publishPlanPath = path.join(root, '.tmp', 'publish-plan-report.json');
const siteKey = cleanSiteKey(process.env.CONTENT_SITE_KEY || process.env.SITE_KEY || siteConfigKeyFromDisk());
const defaultSiteTitle = 'sysop71.com';
const incremental = process.argv.includes('--incremental') || process.argv.includes('--from-plan');
let incrementalWritePaths: Set<string> | undefined;
let writtenJsonFiles = 0;
let skippedJsonFiles = 0;

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

const sanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    'img',
    'figure',
    'figcaption',
    'h1',
    'h2',
    'h3',
    'h4',
  ]),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'loading'],
  },
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', {
      rel: 'noopener noreferrer',
    }),
  },
};

async function main() {
  ensureGeneratedContentPath();

  if (incremental) {
    incrementalWritePaths = await readIncrementalWritePaths();
  } else {
    await rm(outputRoot, { recursive: true, force: true });
  }

  await mkdir(outputRoot, { recursive: true });

  const siteConfig = await readSiteConfig();
  const siteTitle = siteTitleValue(siteConfig);
  const { posts, gallerySources } = await buildPosts();
  const mediaManifest = await loadMediaManifest(siteTitle);
  const images = await buildImages(posts, mediaManifest);
  applyEntryImages(posts, images);
  const galleries = await buildGalleries(posts, images, gallerySources);
  const blogPosts = posts.filter((post) => post.type === 'article');
  const stories = posts.filter((post) => post.type === 'story');
  const gallerySummaries = galleries.map(gallerySummary);
  const sourceCounts = archiveSourceCounts(blogPosts, stories, galleries);
  resolveContentLinks(posts, gallerySummaries);
  await rewriteEntryDocuments(posts);
  await rewriteEntrySummaries(posts);

  await writeJson('site.json', {
    generatedAt: new Date().toISOString(),
    key: siteKey,
    title: siteTitle,
    url: optionalText(process.env.CONTENT_SITE_URL || process.env.SITE_URL || siteConfig.url),
    nav: siteNav(siteConfig),
    author: siteAuthor(siteConfig),
    banner: siteBanner(siteConfig, siteTitle),
    footer: siteFooter(siteConfig),
    theme: siteTheme(siteConfig),
    entries: posts.length + galleries.length,
    posts: blogPosts.length,
    stories: stories.length,
    galleries: galleries.length,
    images: images.length,
    sourceCounts,
  });

  await writeJson('home.json', {
    generatedAt: new Date().toISOString(),
    counts: {
      posts: blogPosts.length,
      stories: stories.length,
      galleries: galleries.length,
      images: images.length,
    },
    recentEntries: recentHomeEntries(blogPosts, stories, gallerySummaries, 5),
    recentPosts: blogPosts.slice(0, 5),
    recentStories: stories.slice(0, 5),
    recentGalleries: gallerySummaries.slice(0, 5),
    recentImages: images.slice(0, 10),
    sourceCounts,
  });

  await writeJson('taxonomy.json', buildTaxonomy([...blogPosts, ...stories], gallerySummaries));
  await writeJson('search/index.json', buildSearchIndex(posts, galleries));

  console.log(`Generated ${posts.length} entries, ${galleries.length} galleries, and ${images.length} images.`);

  if (incremental) {
    console.log(
      `Incremental JSON write: wrote ${writtenJsonFiles.toLocaleString()} file(s), skipped ${skippedJsonFiles.toLocaleString()} file(s).`,
    );
  }
}

function ensureGeneratedContentPath() {
  const resolvedOutput = path.resolve(outputRoot);
  const resolvedPublic = path.resolve(publicRoot);

  if (!resolvedOutput.startsWith(`${resolvedPublic}${path.sep}`)) {
    throw new Error(`Refusing to clean output path outside public/: ${resolvedOutput}`);
  }
}

async function buildPosts() {
  const files = await markdownFiles(postsRoot);
  const posts: PostDocument[] = [];
  const gallerySources: GallerySource[] = [];

  for (const file of files) {
    const fullPath = path.join(postsRoot, file);
    const raw = await readFile(fullPath, 'utf8');
    const parsed = matter(raw);
    const filename = path.basename(file, '.md');
    const parts = partsFromFilename(filename) ?? partsFromFrontmatter(parsed.data);

    if (!parts) {
      console.warn(`Skipping post without date parts: ${file}`);
      continue;
    }

    const filenameSlug = slugFromPostFilename(filename);
    const slug = textValue(parsed.data.slug) || filenameSlug;
    const galleryIds = galleryIncludes(parsed.content, parsed.data);
    const directImageIds = imageReferences(parsed.data);
    const cleanMarkdown = removeJekyllIncludes(parsed.content);
    const bodyHtml = sanitizeHtml(markdown.render(cleanMarkdown), sanitizeOptions);
    const date = normalizedDate(parsed.data.date, parts);
    const title = textValue(parsed.data.title) || titleFromSlug(slug);
    const id = textValue(parsed.data.post_id) || textValue(parsed.data.id) || filenameSlug;
    const source = entrySource(parsed.data);
    const type = classifySourceContentType(source.type, parsed.data);
    const summary = textValue(parsed.data.summary) || textValue(parsed.data.excerpt) || excerptFromMarkdown(cleanMarkdown);

    if (excludeFromArchives(parsed.data, title, galleryIds)) {
      continue;
    }

    if (type === 'gallery') {
      const galleryId = textValue(parsed.data.gallery) || id;
      const gallerySlug = textValue(parsed.data.slug) || slugFromGalleryId(galleryId) || slug;

      gallerySources.push({
        siteKey,
        id,
        type,
        title,
        date,
        status: contentStatus(parsed.data),
        slug: gallerySlug,
        route: `/galleries/${parts.year}/${parts.month}/${parts.day}/${gallerySlug}`,
        legacyUrl: `/blog/${parts.year}/${parts.month}/${parts.day}/${filenameSlug}.html`,
        authors: authors(parsed.data),
        people: stringArray(parsed.data.people),
        summary: summary || `${title} gallery`,
        categories: stringArray(parsed.data.categories),
        tags: stringArray(parsed.data.tags),
        hashtags: stringArray(parsed.data.hashtags),
        locations: locations(parsed.data),
        sourceType: source.type,
        source: Object.keys(source).length > 0 ? source : undefined,
        galleryId,
        coverImageId: textValue(parsed.data.cover_image || parsed.data.coverImageId),
        related: relatedLinks(parsed.data),
        descriptionMarkdown: cleanMarkdown || undefined,
        descriptionHtml: bodyHtml.trim() ? bodyHtml : undefined,
        ...parts,
      });
      continue;
    }

    const contentShape = type === 'article' ? 'post' : 'story';
    const basePath = type === 'article' ? '/posts' : '/stories';
    const route = `${basePath}/${parts.year}/${parts.month}/${parts.day}/${slug}`;
    const legacyUrl = `/blog/${parts.year}/${parts.month}/${parts.day}/${filenameSlug}.html`;
    const excerpt = excerptFromMarkdown(cleanMarkdown);

    const document: PostDocument = {
      siteKey,
      id,
      type,
      title,
      date,
      status: contentStatus(parsed.data),
      contentShape,
      slug,
      route,
      legacyUrl,
      authors: authors(parsed.data),
      people: stringArray(parsed.data.people),
      summary,
      excerpt,
      categories: stringArray(parsed.data.categories),
      tags: stringArray(parsed.data.tags),
      hashtags: stringArray(parsed.data.hashtags),
      handles: stringArray(parsed.data.handles),
      location: locations(parsed.data)[0],
      locations: locations(parsed.data),
      sourceType: source.type,
      source: Object.keys(source).length > 0 ? source : undefined,
      galleryIds,
      imageIds: directImageIds,
      related: relatedLinks(parsed.data),
      caption: type === 'story' ? source.caption || summary : undefined,
      coverImageId: optionalText(parsed.data.cover_image || parsed.data.coverImage || parsed.data.coverImageId),
      bodyMarkdown: cleanMarkdown,
      bodyHtml,
      ...parts,
    };

    posts.push(document);
  }

  posts.sort((a, b) => b.date.localeCompare(a.date));
  gallerySources.sort((a, b) => b.date.localeCompare(a.date));
  return { posts, gallerySources };
}

async function rewriteEntryDocuments(posts: PostDocument[]) {
  for (const post of posts) {
    const folder = post.type === 'article' ? 'posts' : 'stories';
    await writeJson(`${folder}/${post.year}/${post.month}/${post.day}/${post.slug}.json`, post);
  }
}

async function rewriteEntrySummaries(posts: PostDocument[]) {
  const summaries = posts.map(entrySummary);
  const blogPosts = summaries.filter((post) => post.type === 'article');
  const stories = summaries.filter((post) => post.type === 'story');

  await writeJson('posts/index.json', {
    generatedAt: new Date().toISOString(),
    posts: blogPosts,
    years: archiveYears(blogPosts, '/posts'),
  });

  await writeJson('stories/index.json', {
    generatedAt: new Date().toISOString(),
    posts: stories,
    years: archiveYears(stories, '/stories'),
  });

  await writeJson('entries/index.json', {
    generatedAt: new Date().toISOString(),
    posts: summaries,
    years: archiveYears(summaries, '/entries'),
    shapes: {
      posts: blogPosts.length,
      stories: stories.length,
    },
  });
}

function entrySummary(post: PostDocument): PostSummary {
  const { bodyHtml: _bodyHtml, bodyMarkdown: _bodyMarkdown, ...summary } = post;
  return summary;
}

async function loadMediaManifest(siteTitle: string) {
  try {
    return await readMediaManifest(sourceMediaManifestPath);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(
        [
          'content/media/index.json is required for the React/API build.',
          'Media assets are now tracked by content/media/index.json and updated by the publish pipeline.',
          `Site: ${siteTitle}`,
        ].join(' '),
      );
    }

    throw error;
  }
}

async function buildImages(posts: PostSummary[], mediaManifest: MediaManifest) {
  const postRoutesById = new Map(posts.map((post) => [post.id, post.route]));
  const images = mediaManifest.assets.map((asset) => mediaAssetToImageSummary(asset, postRoutesById));

  images.sort((a, b) => b.date.localeCompare(a.date));

  await writeJson('media/index.json', mediaManifest);

  await writeJson('images/index.json', {
    generatedAt: new Date().toISOString(),
    images,
    years: archiveYears(images, '/images'),
  });

  return images;
}

function mediaAssetToImageSummary(asset: MediaAsset, postRoutesById: Map<string, string>): ImageSummary {
  const postId = asset.legacy?.postId;

  return {
    siteKey,
    id: asset.id,
    type: 'image',
    kind: asset.kind,
    title: asset.title || titleFromSlug(asset.id),
    date: asset.date,
    route: `/images/${asset.year}/${asset.month}/${asset.day}/${encodeURIComponent(asset.filename)}`,
    rawUrl: asset.rawUrl,
    thumbUrl: asset.thumbUrl || asset.posterUrl || asset.rawUrl,
    caption: asset.caption,
    alt: asset.alt || asset.caption || asset.title || asset.filename,
    galleryId: asset.legacy?.galleryId,
    source: asset.legacy?.source,
    sourceFilename: asset.legacy?.sourceFilename || asset.filename,
    postId,
    postRoute: postId ? postRoutesById.get(postId) : undefined,
    year: asset.year,
    month: asset.month,
    day: asset.day,
  };
}

function applyEntryImages(posts: PostSummary[], images: ImageSummary[]) {
  const imagesById = new Map(images.map((image) => [image.id, image]));
  const imagesByGallery = new Map<string, ImageSummary[]>();

  for (const image of images) {
    if (!image.galleryId) {
      continue;
    }

    if (!imagesByGallery.has(image.galleryId)) {
      imagesByGallery.set(image.galleryId, []);
    }

    imagesByGallery.get(image.galleryId)!.push(image);
  }

  for (const post of posts) {
    const directImages = post.imageIds.map((imageId) => imagesById.get(imageId)).filter(Boolean) as ImageSummary[];
    const galleryImages = post.galleryIds.flatMap((galleryId) => imagesByGallery.get(galleryId) ?? []);
    const relatedImages = uniqueImages([...directImages, ...galleryImages]);
    const cover = imagesById.get(post.coverImageId ?? '') ?? relatedImages[0];
    post.imageIds = relatedImages.map((image) => image.id);

    if (cover) {
      post.coverImage = {
        id: cover.id,
        rawUrl: cover.rawUrl,
        thumbUrl: cover.thumbUrl,
        alt: cover.alt || cover.title,
      };
    }
  }
}

function uniqueImages(images: ImageSummary[]) {
  const seen = new Set<string>();

  return images.filter((image) => {
    if (seen.has(image.id)) {
      return false;
    }

    seen.add(image.id);
    return true;
  });
}

async function buildGalleries(posts: PostDocument[], images: ImageSummary[], gallerySources: GallerySource[]) {
  const groupedImages = imagesByGallery(images);
  const postsByGallery = postsByGalleryId(posts);
  const gallerySourcesById = new Map(gallerySources.map((source) => [source.galleryId, source]));
  const galleries: GalleryDocument[] = [];

  for (const [galleryId, galleryImages] of groupedImages) {
    if (excludeGalleryFromArchives(galleryId)) {
      continue;
    }

    const gallerySource = gallerySourcesById.get(galleryId);
    const relatedPosts = postsByGallery.get(galleryId) ?? [];
    const primaryPost = relatedPosts[0];
    const cover =
      galleryImages.find((image) => image.id === gallerySource?.coverImageId) ??
      galleryImages.find((image) => image.id === textValue(primaryPost?.coverImage?.id)) ??
      galleryImages[0];
    const date = gallerySource?.date || primaryPost?.date || cover.date;
    const parts = gallerySource
      ? {
          year: gallerySource.year,
          month: gallerySource.month,
          day: gallerySource.day,
        }
      : partsFromDate(date) ?? {
      year: cover.year,
      month: cover.month,
      day: cover.day,
    };
    const slug = gallerySource?.slug || slugFromGalleryId(galleryId);
    const route = gallerySource?.route || `/galleries/${parts.year}/${parts.month}/${parts.day}/${slug}`;
    const summary =
      gallerySource?.summary || primaryPost?.summary || primaryPost?.excerpt || `${galleryImages.length.toLocaleString()} images`;
    const source = gallerySource?.source || primaryPost?.source;

    galleries.push({
      siteKey,
      id: galleryId,
      type: 'gallery',
      title: gallerySource?.title || primaryPost?.title || titleFromSlug(slug),
      date,
      status: gallerySource?.status || primaryPost?.status || 'published',
      slug,
      route,
      legacyUrl: gallerySource?.legacyUrl || primaryPost?.legacyUrl,
      authors: gallerySource?.authors ?? primaryPost?.authors ?? [],
      people: gallerySource?.people ?? primaryPost?.people ?? [],
      summary,
      categories: gallerySource?.categories ?? primaryPost?.categories ?? [],
      tags: gallerySource?.tags ?? primaryPost?.tags ?? [],
      hashtags: gallerySource?.hashtags ?? primaryPost?.hashtags ?? [],
      locations: gallerySource?.locations ?? primaryPost?.locations ?? [],
      sourceType: gallerySource?.sourceType || primaryPost?.sourceType || galleryImages[0]?.source,
      source,
      imageIds: galleryImages.map((image) => image.id),
      imageCount: galleryImages.length,
      coverImageId: cover.id,
      coverImage: {
        id: cover.id,
        rawUrl: cover.rawUrl,
        thumbUrl: cover.thumbUrl,
        alt: cover.alt || cover.title,
      },
      related: [
        ...(gallerySource?.related ?? []),
        ...relatedPosts.map((post) => ({
        type: post.type,
        id: post.id,
        title: post.title,
        route: post.route,
        rel: 'uses-gallery',
        })),
      ],
      descriptionMarkdown: gallerySource?.descriptionMarkdown || primaryPost?.bodyMarkdown,
      descriptionHtml: gallerySource?.descriptionHtml || primaryPost?.bodyHtml,
      images: galleryImages,
      ...parts,
    });
  }

  galleries.sort((a, b) => b.date.localeCompare(a.date));

  await writeJson('galleries/index.json', {
    generatedAt: new Date().toISOString(),
    galleries: galleries.map(gallerySummary),
    years: archiveYears(galleries, '/galleries'),
  });

  for (const gallery of galleries) {
    await writeJson(`galleries/${gallery.year}/${gallery.month}/${gallery.day}/${gallery.slug}.json`, gallery);
  }

  return galleries;
}

function imagesByGallery(images: ImageSummary[]) {
  const galleries = new Map<string, ImageSummary[]>();

  for (const image of images) {
    if (!image.galleryId) {
      continue;
    }

    if (!galleries.has(image.galleryId)) {
      galleries.set(image.galleryId, []);
    }

    galleries.get(image.galleryId)!.push(image);
  }

  for (const galleryImages of galleries.values()) {
    galleryImages.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }

  return new Map([...galleries.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function postsByGalleryId(posts: PostDocument[]) {
  const galleries = new Map<string, PostDocument[]>();

  for (const post of posts) {
    for (const galleryId of post.galleryIds) {
      if (!galleries.has(galleryId)) {
        galleries.set(galleryId, []);
      }

      galleries.get(galleryId)!.push(post);
    }
  }

  for (const relatedPosts of galleries.values()) {
    relatedPosts.sort((a, b) => b.date.localeCompare(a.date));
  }

  return galleries;
}

function excludeGalleryFromArchives(galleryId: string) {
  return /mobile[-\s]*uploads?/i.test(galleryId);
}

function gallerySummary(gallery: GalleryDocument): GallerySummary {
  const {
    descriptionMarkdown: _descriptionMarkdown,
    descriptionHtml: _descriptionHtml,
    images: _images,
    ...summary
  } = gallery;

  return summary;
}

function resolveContentLinks(posts: PostDocument[], galleries: GallerySummary[]) {
  const postsById = new Map(posts.map((post) => [post.id, post]));
  const galleriesById = new Map(galleries.map((gallery) => [gallery.id, gallery]));

  for (const post of posts) {
    post.related = post.related.map((link) => {
      const type = contentLinkType(link.type);
      const linkedPost = type !== 'gallery' ? postsById.get(link.id) : undefined;
      const linkedGallery = type === 'gallery' ? galleriesById.get(link.id) : undefined;
      const target = linkedGallery ?? linkedPost;

      if (!target) {
        return link;
      }

      return {
        ...link,
        type: linkedGallery ? 'gallery' : linkedPost?.type,
        title: link.title || target.title,
        route: link.route || target.route,
      };
    });
  }
}

function archiveSourceCounts(
  articles: PostSummary[],
  stories: PostSummary[],
  galleries: GallerySummary[],
): SourceCount[] {
  return [
    {
      source: 'wordpress',
      label: 'WordPress',
      count: articles.filter((item) => sourceMatches(item.sourceType, 'wordpress')).length,
      href: '/posts?source=wordpress',
    },
    {
      source: 'instagram',
      label: 'Instagram',
      count: stories.filter((item) => sourceMatches(item.sourceType, 'instagram')).length,
      href: '/stories?source=instagram',
    },
    {
      source: 'facebook',
      label: 'Facebook',
      count: galleries.filter((item) => sourceMatches(item.sourceType, 'facebook')).length,
      href: '/galleries?source=facebook',
    },
  ];
}

function buildTaxonomy(entries: PostSummary[], galleries: GallerySummary[]) {
  const hashtags = new Map<string, TaxonomyTerm>();
  const categories = new Map<string, TaxonomyTerm>();
  const people = new Map<string, TaxonomyTerm>();
  const locations = new Map<string, TaxonomyTerm>();

  for (const entry of entries) {
    const ref = taxonomyRef(entry);

    for (const hashtag of entry.hashtags) {
      addTaxonomyTerm(hashtags, {
        value: normalizeHashtag(hashtag),
        label: `#${normalizeHashtag(hashtag)}`,
        hrefBase: '/hashtags',
        ref,
      });
    }

    for (const category of entry.categories) {
      addTaxonomyTerm(categories, {
        value: category,
        label: category,
        hrefBase: '/categories',
        ref,
      });
    }

    for (const person of entry.people) {
      addTaxonomyTerm(people, {
        value: person,
        label: person,
        hrefBase: '/people',
        ref,
      });
    }

    for (const location of entry.locations) {
      addTaxonomyTerm(locations, {
        value: location,
        label: location,
        hrefBase: '/locations',
        ref,
      });
    }
  }

  for (const gallery of galleries) {
    const ref = taxonomyRef(gallery);

    for (const hashtag of gallery.hashtags) {
      addTaxonomyTerm(hashtags, {
        value: normalizeHashtag(hashtag),
        label: `#${normalizeHashtag(hashtag)}`,
        hrefBase: '/hashtags',
        ref,
      });
    }

    for (const category of gallery.categories) {
      addTaxonomyTerm(categories, {
        value: category,
        label: category,
        hrefBase: '/categories',
        ref,
      });
    }

    for (const person of gallery.people) {
      addTaxonomyTerm(people, {
        value: person,
        label: person,
        hrefBase: '/people',
        ref,
      });
    }

    for (const location of gallery.locations) {
      addTaxonomyTerm(locations, {
        value: location,
        label: location,
        hrefBase: '/locations',
        ref,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    hashtags: sortedTaxonomyTerms(hashtags),
    categories: sortedTaxonomyTerms(categories),
    people: sortedTaxonomyTerms(people),
    locations: sortedTaxonomyTerms(locations),
  };
}

function addTaxonomyTerm(
  terms: Map<string, TaxonomyTerm>,
  {
    value,
    label,
    hrefBase,
    ref,
  }: {
    value: string;
    label: string;
    hrefBase: string;
    ref: TaxonomyContentRef;
  },
) {
  if (!value) {
    return;
  }

  const slug = taxonomySlug(value);
  const existing =
    terms.get(slug) ??
    ({
      value,
      label,
      slug,
      count: 0,
      href: `${hrefBase}/${encodeURIComponent(slug)}`,
      items: [],
    } satisfies TaxonomyTerm);

  if (!existing.items.some((item) => item.id === ref.id && item.type === ref.type)) {
    existing.items.push(ref);
    existing.count += 1;
  }

  terms.set(slug, existing);
}

function sortedTaxonomyTerms(terms: Map<string, TaxonomyTerm>) {
  return [...terms.values()]
    .map((term) => ({
      ...term,
      items: term.items.sort((a, b) => b.date.localeCompare(a.date)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function taxonomyRef(item: PostSummary | GallerySummary): TaxonomyContentRef {
  return {
    id: item.id,
    type: item.type === 'article' ? 'post' : item.type,
    title: item.title,
    date: item.date,
    route: item.route,
  };
}

function taxonomySlug(value: string) {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeHashtag(value: string) {
  return value.normalize('NFKC').trim().replace(/^#+/, '').replace(/\s+/g, '').toLowerCase();
}

function recentHomeEntries(
  posts: PostSummary[],
  stories: PostSummary[],
  galleries: GallerySummary[],
  limit: number,
) {
  return [...posts.slice(0, limit), ...stories.slice(0, limit), ...galleries.slice(0, limit)]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

function buildSearchIndex(entries: PostDocument[], galleries: GalleryDocument[]): SearchIndex {
  return {
    generatedAt: new Date().toISOString(),
    items: [
      ...entries.map(entrySearchItem),
      ...galleries.map(gallerySearchItem),
    ].sort((a, b) => b.date.localeCompare(a.date)),
  };
}

function entrySearchItem(entry: PostDocument): SearchIndexItem {
  const type: SearchContentType = entry.type === 'article' ? 'post' : 'story';
  const summary = entry.summary || entry.excerpt || '';

  return {
    siteKey,
    id: entry.id,
    type,
    title: entry.title,
    date: entry.date,
    route: entry.route,
    summary,
    authors: entry.authors,
    people: entry.people,
    categories: entry.categories,
    hashtags: entry.hashtags.map(normalizeHashtag),
    locations: entry.locations,
    imageCount: entry.imageIds.length,
    coverImage: entry.coverImage,
    searchText: searchableText([
      entry.title,
      summary,
      entry.excerpt,
      entry.bodyMarkdown,
      entry.authors,
      entry.people,
      entry.categories,
      entry.hashtags,
      entry.locations,
      entry.date,
    ]),
    year: entry.year,
    month: entry.month,
    day: entry.day,
  };
}

function gallerySearchItem(gallery: GalleryDocument): SearchIndexItem {
  const summary = gallery.summary || gallery.descriptionMarkdown || `${gallery.imageCount.toLocaleString()} images`;

  return {
    siteKey,
    id: gallery.id,
    type: 'gallery',
    title: gallery.title,
    date: gallery.date,
    route: gallery.route,
    summary,
    authors: gallery.authors,
    people: gallery.people,
    categories: gallery.categories,
    hashtags: gallery.hashtags.map(normalizeHashtag),
    locations: gallery.locations,
    imageCount: gallery.imageCount,
    coverImage: gallery.coverImage,
    searchText: searchableText([
      gallery.title,
      summary,
      gallery.descriptionMarkdown,
      gallery.authors,
      gallery.people,
      gallery.categories,
      gallery.hashtags,
      gallery.locations,
      gallery.date,
    ]),
    year: gallery.year,
    month: gallery.month,
    day: gallery.day,
  };
}

function searchableText(values: Array<string | string[] | undefined>) {
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => (value ?? '').replace(/<[^>]*>/g, ' '))
    .join(' ')
    .normalize('NFKC')
    .replace(/^#+|\B#/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function markdownFiles(directory: string) {
  const files = await readdir(directory);
  return files.filter((file) => file.endsWith('.md')).sort();
}

async function writeJson(relativePath: string, value: unknown) {
  const normalizedPath = relativePath.replaceAll('\\', '/');

  if (incrementalWritePaths && !incrementalWritePaths.has(normalizedPath)) {
    skippedJsonFiles += 1;
    return;
  }

  const fullPath = path.join(outputRoot, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  writtenJsonFiles += 1;
}

async function readIncrementalWritePaths() {
  const raw = await readFile(publishPlanPath, 'utf8');
  const report = JSON.parse(raw) as {
    issues?: unknown[];
    affectedJson?: string[];
    affectedIndexes?: string[];
  };

  if ((report.issues?.length ?? 0) > 0) {
    throw new Error(`Publish plan has ${report.issues!.length} issue(s). Run npm run publish:plan and fix them before incremental build.`);
  }

  const paths = [...(report.affectedJson ?? []), ...(report.affectedIndexes ?? [])]
    .map((item) => item.replaceAll('\\', '/').replace(/^\/+/, ''))
    .filter(Boolean);

  return new Set(paths);
}

function archiveYears(items: DateParts[], basePath: string): ArchiveYear[] {
  const years = new Map<string, Map<string, Map<string, number>>>();

  for (const item of items) {
    if (!years.has(item.year)) {
      years.set(item.year, new Map());
    }

    const months = years.get(item.year)!;
    if (!months.has(item.month)) {
      months.set(item.month, new Map());
    }

    const days = months.get(item.month)!;
    days.set(item.day, (days.get(item.day) ?? 0) + 1);
  }

  return [...years.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, months]) => {
      const monthList = [...months.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([month, days]) => {
          const dayList = [...days.entries()]
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([day, count]) => ({
              day,
              count,
              href: `${basePath}/${year}/${month}/${day}`,
            }));

          return {
            month,
            count: sum(dayList.map((day) => day.count)),
            href: `${basePath}/${year}/${month}`,
            days: dayList,
          };
        });

      return {
        year,
        count: sum(monthList.map((month) => month.count)),
        href: `${basePath}/${year}`,
        months: monthList,
      };
    });
}

function partsFromFilename(filename: string): DateParts | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})-/.exec(filename);

  if (!match) {
    return undefined;
  }

  return {
    year: match[1],
    month: match[2],
    day: match[3],
  };
}

function partsFromFrontmatter(data: Frontmatter): DateParts | undefined {
  const year = numberText(data.year);
  const month = numberText(data.month);
  const day = numberText(data.day);

  if (year && month && day) {
    return {
      year,
      month,
      day,
    };
  }

  const date = textValue(data.date) || textValue(data.taken_at);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);

  if (!match) {
    return undefined;
  }

  return {
    year: match[1],
    month: match[2],
    day: match[3],
  };
}

function partsFromDate(value: string): DateParts | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);

  if (!match) {
    return undefined;
  }

  return {
    year: match[1],
    month: match[2],
    day: match[3],
  };
}

function slugFromPostFilename(filename: string) {
  return filename.replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

function slugFromGalleryId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function galleryIncludes(content: string, data: Frontmatter) {
  const ids = new Set<string>();
  const frontmatterGallery = textValue(data.gallery);

  if (frontmatterGallery) {
    ids.add(frontmatterGallery);
  }

  for (const match of content.matchAll(/{%\s*include\s+gallery\.html\s+gallery="([^"]+)"\s*%}/g)) {
    ids.add(match[1]);
  }

  return [...ids];
}

function imageReferences(data: Frontmatter) {
  const values = data.images ?? data.image_ids ?? data.imageIds;

  if (typeof values === 'string') {
    return values
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim();
      }

      if (!item || typeof item !== 'object' || item instanceof Date) {
        return '';
      }

      return textValue((item as Frontmatter).id || (item as Frontmatter).file || (item as Frontmatter).filename);
    })
    .filter(Boolean);
}

function removeJekyllIncludes(content: string) {
  return content.replace(/{%\s*include\s+[^%]+%}/g, '').trim();
}

function normalizedDate(value: unknown, fallback: DateParts) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString();
  }

  const text = textValue(value);

  if (text) {
    const normalized = normalizeDateText(text);
    const parsed = new Date(normalized);

    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString();
    }

    return normalized.length === 10 ? `${normalized}T00:00:00` : normalized;
  }

  return `${fallback.year}-${fallback.month}-${fallback.day}T00:00:00`;
}

function normalizeDateText(value: string) {
  return value
    .trim()
    .replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T')
    .replace(/T(\d{2}:\d{2}:\d{2})\s+([+-]\d{2})(\d{2})$/, 'T$1$2:$3')
    .replace(/T(\d{2}:\d{2}:\d{2})\s+([+-]\d{2}:\d{2})$/, 'T$1$2');
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

function entrySource(data: Frontmatter): EntrySource {
  const source = data.source;

  if (!source || typeof source !== 'object') {
    return {};
  }

  const sourceData = source as Frontmatter;
  const mediaCount = numberValue(sourceData.media_count);

  return compactObject({
    type: textValue(sourceData.type),
    subtype: textValue(sourceData.subtype),
    id: textValue(sourceData.id),
    url: textValue(sourceData.url),
    caption: textValue(sourceData.caption),
    mediaCount,
    crossPostSource: textValue(sourceData.cross_post_source),
  });
}

function imageSource(value: unknown) {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'object' && !(value instanceof Date)) {
    const data = value as Frontmatter;
    return textValue(data.type) || undefined;
  }

  return textValue(value) || undefined;
}

function canonicalImageFilename(data: Frontmatter, fallbackFile: string) {
  return (
    filenameFromUrl(textValue(data.raw_url)) ||
    textValue(data.source_filename) ||
    filenameFromUrl(textValue(data.thumb_url)) ||
    path.basename(fallbackFile, '.md')
  );
}

function canonicalImageId(parts: DateParts, filename: string) {
  return `${parts.year}/${parts.month}/${parts.day}/${filename}`;
}

function canonicalAssetUrl(currentRawUrl: unknown, prefix: 'images' | 'thumbs', parts: DateParts, filename: string) {
  const current = textValue(currentRawUrl);

  if (!current) {
    return '';
  }

  try {
    const url = new URL(current);
    const [container] = url.pathname.split('/').filter(Boolean);

    if (!container) {
      return current;
    }

    url.pathname = `/${encodePath([container, prefix, parts.year, parts.month, parts.day, filename])}`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return current;
  }
}

function filenameFromUrl(value: string) {
  if (!value) {
    return '';
  }

  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname).split('/').filter(Boolean).at(-1) ?? '';
  } catch {
    return value.split('/').filter(Boolean).at(-1) ?? '';
  }
}

function encodePath(parts: string[]) {
  return parts.map((part) => encodeURIComponent(part)).join('/');
}

function isVideoFilename(value: string) {
  return /\.(mp4|mov|m4v|webm)$/i.test(value);
}

function excludeFromArchives(data: Frontmatter, title: string, galleryIds: string[]) {
  if (data.exclude_from_archives === true || data.excludeFromArchives === true) {
    return true;
  }

  const text = [
    title,
    textValue(data.post_id),
    ...galleryIds,
    albumTitle(data),
  ].join(' ');

  return textValue((data.source as Frontmatter | undefined)?.type).toLowerCase() === 'facebook' &&
    textValue((data.source as Frontmatter | undefined)?.subtype).toLowerCase() === 'album' &&
    /mobile[-\s]*uploads?/i.test(text);
}

function albumTitle(data: Frontmatter) {
  const album = data.album;

  if (!album || typeof album !== 'object' || album instanceof Date) {
    return '';
  }

  return textValue((album as Frontmatter).title);
}

function classifySourceContentType(source: string | undefined, data: Frontmatter): ContentType {
  const explicitType = textValue(data.content_type || data.contentType || data.type).toLowerCase();

  if (explicitType === 'article' || explicitType === 'post') {
    return 'article';
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
    return 'article';
  }

  return 'story';
}

function contentStatus(data: Frontmatter): ContentStatus {
  const explicit = textValue(data.status).toLowerCase();

  if (explicit === 'draft' || explicit === 'archived') {
    return explicit;
  }

  if (data.published === false || textValue(data.published).toLowerCase() === 'false') {
    return 'draft';
  }

  return 'published';
}

function authors(data: Frontmatter) {
  const values = stringArray(data.authors);

  if (values.length > 0) {
    return values;
  }

  const author = textValue(data.author);
  return author ? [author] : [];
}

function relatedLinks(data: Frontmatter): ContentLink[] {
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

      return compactObject({
        type: contentLinkType(value.type),
        id,
        title: textValue(value.title),
        route: textValue(value.route || value.href || value.url),
        rel: textValue(value.rel),
      });
    })
    .filter(Boolean) as ContentLink[];
}

function contentLinkType(value: unknown): ContentType | undefined {
  const type = textValue(value).toLowerCase();

  if (type === 'article' || type === 'story' || type === 'gallery') {
    return type;
  }

  if (type === 'post') {
    return 'article';
  }

  return undefined;
}

function sourceMatches(sourceType: string | undefined, source: string) {
  return sourceType?.toLowerCase() === source;
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

function uniqueStrings(values: string[]) {
  return [...new Map(values.map((value) => [value.trim().toLowerCase(), value.trim()])).values()].filter(Boolean);
}

function locations(data: Frontmatter) {
  const values = [...stringArray(data.locations)];
  const legacy = locationText(data.location);

  if (legacy) {
    values.push(legacy);
  }

  return uniqueStrings(values);
}

function locationText(value: unknown) {
  if (!value) {
    return '';
  }

  if (Array.isArray(value)) {
    return textValue(value[0]);
  }

  if (typeof value === 'object' && !(value instanceof Date)) {
    const data = value as Frontmatter;
    return textValue(data.name) || textValue(data.title) || textValue(data.location);
  }

  return textValue(value);
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const text = textValue(value);

  if (!text) {
    return undefined;
  }

  const parsed = Number(text);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== ''),
  ) as T;
}

function cleanSiteKey(value: string | undefined) {
  const key = value?.trim().toLowerCase();

  if (!key || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(key)) {
    throw new Error(`Invalid CONTENT_SITE_KEY: ${value}`);
  }

  return key;
}

function siteConfigKeyFromDisk() {
  try {
    const config = JSON.parse(readFileSync(siteConfigPath, 'utf8')) as SiteConfig;
    return config.key;
  } catch {
    return undefined;
  }
}

async function readSiteConfig(): Promise<SiteConfig> {
  try {
    return JSON.parse(await readFile(siteConfigPath, 'utf8')) as SiteConfig;
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }

    throw error;
  }
}

function siteTitleValue(config: SiteConfig) {
  return process.env.CONTENT_SITE_TITLE || process.env.SITE_TITLE || config.title || defaultSiteTitle;
}

function siteNav(config: SiteConfig): SiteNavItem[] {
  const nav = jsonArray<SiteNavItem>(process.env.CONTENT_SITE_NAV_JSON) ?? config.nav ?? defaultNav();
  const cleanNav = nav.filter((item) => item.label && item.href);

  return cleanNav.length > 0 ? cleanNav : defaultNav();
}

function defaultNav(): SiteNavItem[] {
  return [
    { label: 'Home', href: '/' },
    { label: 'Posts', href: '/posts' },
    { label: 'Stories', href: '/stories' },
    { label: 'Galleries', href: '/galleries' },
    { label: 'Images', href: '/images' },
    { label: 'Search', href: '/search' },
  ];
}

function siteAuthor(config: SiteConfig): SiteAuthor | undefined {
  const parsed = jsonObject<SiteAuthor>(process.env.CONTENT_SITE_AUTHOR_JSON);

  if (parsed && hasAuthorContent(parsed)) {
    return cleanAuthor(parsed);
  }

  if (config.author && hasAuthorContent(config.author)) {
    return cleanAuthor(config.author);
  }

  const envAuthor = cleanAuthor({
    name: process.env.CONTENT_SITE_AUTHOR_NAME,
    bio: process.env.CONTENT_SITE_AUTHOR_BIO,
    imageUrl: process.env.CONTENT_SITE_AUTHOR_IMAGE_URL,
    links: jsonArray<SiteAuthorLink>(process.env.CONTENT_SITE_AUTHOR_LINKS_JSON),
  });

  return hasAuthorContent(envAuthor) ? envAuthor : undefined;
}

function siteBanner(config: SiteConfig, siteTitle: string): SiteBanner | undefined {
  const hasBannerConfig = Boolean(config.banner);
  const hasBannerEnv = [
    process.env.CONTENT_SITE_BANNER_EYEBROW,
    process.env.CONTENT_SITE_BANNER_TITLE,
    process.env.CONTENT_SITE_BANNER_TEXT,
    process.env.CONTENT_SITE_BANNER_IMAGE,
    process.env.CONTENT_SITE_BANNER_POSITION,
    process.env.CONTENT_SITE_BANNER_SIZE,
  ].some((value) => Boolean(value?.trim()));

  if (!hasBannerConfig && !hasBannerEnv) {
    return undefined;
  }

  const banner = {
    eyebrow: optionalText(process.env.CONTENT_SITE_BANNER_EYEBROW || config.banner?.eyebrow),
    title: optionalText(process.env.CONTENT_SITE_BANNER_TITLE || config.banner?.title) || siteTitle,
    text: optionalText(process.env.CONTENT_SITE_BANNER_TEXT || config.banner?.text),
    backgroundImage: optionalText(process.env.CONTENT_SITE_BANNER_IMAGE || config.banner?.backgroundImage),
    backgroundPosition: optionalText(process.env.CONTENT_SITE_BANNER_POSITION || config.banner?.backgroundPosition),
    backgroundSize: optionalText(process.env.CONTENT_SITE_BANNER_SIZE || config.banner?.backgroundSize),
  };

  return banner;
}

function hasAuthorContent(author: SiteAuthor | undefined) {
  return Boolean(
    author?.name?.trim() ||
      author?.bio?.trim() ||
      (author?.links && author.links.length > 0),
  );
}

function cleanAuthor(author: SiteAuthor): SiteAuthor {
  return {
    name: optionalText(author.name),
    bio: optionalText(author.bio),
    imageUrl: optionalText(author.imageUrl),
    links: author.links?.filter((link) => link.label?.trim() && link.href?.trim()),
  };
}

function siteFooter(config: SiteConfig): SiteFooter {
  const links = jsonArray<SiteNavItem>(process.env.CONTENT_SITE_FOOTER_LINKS_JSON) ?? config.footer?.links;

  return {
    brandText: process.env.CONTENT_SITE_FOOTER_BRAND || config.footer?.brandText || siteTitleValue(config),
    text: process.env.CONTENT_SITE_FOOTER_TEXT || config.footer?.text,
    links: links && links.length > 0 ? links : siteNav(config).filter((item) => item.href !== '/'),
    copyright: process.env.CONTENT_SITE_FOOTER_COPYRIGHT || config.footer?.copyright,
  };
}

function siteTheme(config: SiteConfig): SiteTheme {
  const parsed = jsonObject<SiteTheme>(process.env.CONTENT_SITE_THEME_JSON);

  return {
    ...(config.theme ?? {}),
    ...(parsed ?? {}),
  };
}

function optionalText(value: unknown) {
  const text = textValue(value);
  return text || undefined;
}

function isMissingFileError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function jsonObject<T>(value: string | undefined) {
  if (!value?.trim()) {
    return undefined;
  }

  const parsed = JSON.parse(value) as T;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
}

function jsonArray<T>(value: string | undefined) {
  if (!value?.trim()) {
    return undefined;
  }

  const parsed = JSON.parse(value) as T[];
  return Array.isArray(parsed) ? parsed : undefined;
}

function numberText(value: unknown) {
  if (typeof value === 'number') {
    return String(value).padStart(2, '0');
  }

  const text = textValue(value);
  return text ? text.padStart(2, '0') : '';
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

function titleFromSlug(slug: string) {
  return slug
    .replace(/^\d{6}-/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
