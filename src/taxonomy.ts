import type { TaxonomyFamily } from './types';

export function taxonomyHref(family: TaxonomyFamily, value: string) {
  return `/${family}/${encodeURIComponent(taxonomySlug(value))}`;
}

export function taxonomySlug(value: string) {
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

export function hashtagLabel(value: string) {
  return `#${stripPrefix(value, '#')}`;
}

export function stripPrefix(value: string, prefix: string) {
  return value.startsWith(prefix) ? value.slice(1) : value;
}
