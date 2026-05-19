import type {
  ApiPage,
  GalleryDocument,
  GalleryIndex,
  GallerySummary,
  HomeSummary,
  ImageGroup,
  ImageIndex,
  ImageSummary,
  PostDocument,
  PostIndex,
  PostSummary,
  SearchResponse,
  TaxonomyFamily,
  TaxonomyTerm,
} from './types';
import siteConfig from '../content/site.config.json';

export type ArchiveQuery = {
  year?: string;
  month?: string;
  day?: string;
  source?: string;
  cursor?: number;
  limit?: number;
};

export type ImageArchiveQuery = ArchiveQuery & {
  groupBy?: 'year' | 'month' | 'day';
  galleryIds?: string[];
  imageIds?: string[];
};

type ApiListResponse<T> = {
  generatedAt: string;
  years: PostIndex['years'];
  items: T[];
  page: ApiPage;
};

type ApiImageListResponse = {
  generatedAt: string;
  years: ImageIndex['years'];
  items?: ImageSummary[];
  groups?: ImageGroup[];
  groupBy?: 'year' | 'month' | 'day';
  page?: ApiPage;
};

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const apiSiteId = (import.meta.env.VITE_API_SITE_ID || siteConfig.key || '').trim().toLowerCase();

export function apiUrl(path: string) {
  if (!apiSiteId) {
    throw new Error('A site id is required for shared API routes. Set VITE_API_SITE_ID or content/site.config.json key.');
  }

  const cleanPath = path.replace(/^\/+/, '');
  const sitePath = `${apiSiteId}/${cleanPath}`;

  return `${apiBaseUrl}/api/${sitePath}`;
}

export function fetchJson<T>(path: string): Promise<T> {
  const url = apiUrl(path);

  return fetch(url).then((response) => {
    if (!response.ok) {
      throw new Error(`Unable to load ${url}: ${response.status}`);
    }

    return response.json() as Promise<T>;
  });
}

export function fetchPostIndex(query: ArchiveQuery = {}) {
  return fetchJson<ApiListResponse<PostSummary>>(`posts${queryString({ limit: 48, ...query })}`).then(toPostIndex);
}

export function fetchHomeSummary() {
  return fetchJson<HomeSummary>('home');
}

export function fetchStoryIndex(query: ArchiveQuery = {}) {
  return fetchJson<ApiListResponse<PostSummary>>(`stories${queryString({ limit: 48, ...query })}`).then(toPostIndex);
}

export function fetchEntryIndex(query: ArchiveQuery = {}) {
  return fetchJson<ApiListResponse<PostSummary>>(`entries${queryString({ limit: 48, ...query })}`).then(toPostIndex);
}

export function fetchGalleryIndex(query: ArchiveQuery = {}) {
  return fetchJson<ApiListResponse<GallerySummary>>(`galleries${queryString({ limit: 48, ...query })}`).then(
    (response): GalleryIndex => ({
      generatedAt: response.generatedAt,
      galleries: response.items,
      years: response.years,
      page: response.page,
    }),
  );
}

export function fetchImageIndex(query: ImageArchiveQuery = {}) {
  return fetchJson<ApiImageListResponse>(`images${queryString({ limit: 48, ...query })}`).then((response) => ({
    generatedAt: response.generatedAt,
    images: response.items ?? [],
    groups: response.groups,
    groupBy: response.groupBy,
    page: response.page,
    years: response.years,
  }));
}

export function fetchImagesForGalleries(galleryIds: string[]) {
  if (galleryIds.length === 0) {
    return Promise.resolve<ImageIndex>({
      generatedAt: new Date(0).toISOString(),
      images: [],
      years: [],
    });
  }

  return fetchImageIndex({ galleryIds, limit: 1000 });
}

export function fetchImagesForEntry(imageIds: string[], galleryIds: string[]) {
  if (imageIds.length === 0 && galleryIds.length === 0) {
    return Promise.resolve<ImageIndex>({
      generatedAt: new Date(0).toISOString(),
      images: [],
      years: [],
    });
  }

  return fetchImageIndex({ imageIds, galleryIds, limit: 1000 });
}

export function fetchPostDocument(year: string, month: string, day: string, slug: string) {
  return fetchJson<PostDocument>(`posts/${year}/${month}/${day}/${slug}`);
}

export function fetchStoryDocument(year: string, month: string, day: string, slug: string) {
  return fetchJson<PostDocument>(`stories/${year}/${month}/${day}/${slug}`);
}

export function fetchGalleryDocument(year: string, month: string, day: string, slug: string) {
  return fetchJson<GalleryDocument>(`galleries/${year}/${month}/${day}/${slug}`);
}

export function fetchTaxonomyTerm(family: TaxonomyFamily, slug: string) {
  return fetchJson<TaxonomyTerm>(`taxonomy/${family}/${slug}`);
}

export function fetchSearch(query: { q?: string; type?: string; cursor?: number; limit?: number }) {
  return fetchJson<SearchResponse>(`search${queryString({ limit: 12, ...query })}`);
}

function toPostIndex(response: ApiListResponse<PostSummary>): PostIndex {
  return {
    generatedAt: response.generatedAt,
    posts: response.items,
    years: response.years,
    page: response.page,
  };
}

function queryString(
  query: ArchiveQuery & {
    groupBy?: string;
    galleryIds?: string[];
    imageIds?: string[];
    q?: string;
    type?: string;
  },
) {
  const params = new URLSearchParams();

  if (query.q) {
    params.set('q', query.q);
  }

  if (query.year) {
    params.set('year', query.year);
  }

  if (query.month) {
    params.set('month', query.month);
  }

  if (query.day) {
    params.set('day', query.day);
  }

  if (query.source) {
    params.set('source', query.source);
  }

  if (query.type) {
    params.set('type', query.type);
  }

  if (query.cursor !== undefined) {
    params.set('cursor', String(query.cursor));
  }

  if (query.limit !== undefined) {
    params.set('limit', String(query.limit));
  }

  if (query.groupBy) {
    params.set('groupBy', query.groupBy);
  }

  if (query.galleryIds && query.galleryIds.length > 0) {
    params.set('galleryId', query.galleryIds.join(','));
  }

  if (query.imageIds && query.imageIds.length > 0) {
    params.set('imageId', query.imageIds.join(','));
  }

  const text = params.toString();
  return text ? `?${text}` : '';
}
