import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'

export const ROOT = process.cwd()
export const POSTS_DIR = path.join(ROOT, '_posts')

export function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((v) => String(v).trim()).filter(Boolean)
  if (typeof value === 'string') {
    const inline = value.trim()
    if (!inline) return []
    if (inline.startsWith('[') && inline.endsWith(']')) {
      return inline
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    }
    return inline.split(',').map((v) => v.trim()).filter(Boolean)
  }
  return []
}

export function slugFromFilename(filename) {
  const base = filename.replace(/\.md$/i, '')
  return base.replace(/^\d{4}-\d{2}-\d{2}-/, '')
}

export function dateFromFilename(filename) {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})-/)
  return match ? match[1] : null
}

export function normalizeHashtags(values) {
  return toArray(values)
    .map((tag) => tag.replace(/^#/, '').toLowerCase().replace(/[^a-z0-9_-]/g, ''))
    .filter(Boolean)
}

export function normalizeFrontmatter(data, filename) {
  const slug = data.slug || slugFromFilename(filename)
  const fallbackDate = dateFromFilename(filename)
  const dateValue = data.date ? String(data.date) : fallbackDate
  const status = data.status || (data.published === false ? 'draft' : 'published')
  const legacySource = data.legacy?.source || 'jekyll'

  const authors = Array.isArray(data.authors)
    ? toArray(data.authors)
    : data.author
      ? [String(data.author)]
      : []

  const normalized = {
    content_type: data.content_type || 'post',
    title: data.title || slug,
    slug,
    post_id: data.post_id || `${fallbackDate || 'undated'}-${slug}`,
    date: dateValue,
    status,
    authors,
    summary: data.summary ? String(data.summary) : '',
    categories: toArray(data.categories),
    hashtags: normalizeHashtags(data.hashtags?.length ? data.hashtags : data.tags),
    people: toArray(data.people),
    locations: toArray(data.locations),
    cover_image: data.cover_image || '',
    images: Array.isArray(data.images) ? data.images : [],
    related: Array.isArray(data.related) ? data.related : [],
    legacy: {
      source: legacySource
    }
  }

  return normalized
}

export function validateNormalizedFrontmatter(data) {
  const errors = []
  const required = ['content_type', 'title', 'slug', 'post_id', 'date', 'status', 'authors', 'summary', 'categories', 'hashtags', 'people', 'locations', 'images', 'related', 'legacy']

  for (const key of required) {
    if (data[key] === undefined) errors.push(`missing required field: ${key}`)
  }

  if (!['post', 'story', 'gallery'].includes(data.content_type)) {
    errors.push(`content_type must be one of post|story|gallery, got ${data.content_type}`)
  }

  if (!['published', 'draft'].includes(data.status)) {
    errors.push(`status must be published|draft, got ${data.status}`)
  }

  const forbidden = ['layout', 'permalink', 'published', 'comments', 'share', 'tags']
  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      errors.push(`jekyll-only field must be removed: ${key}`)
    }
  }

  return errors
}

export async function readPostFiles() {
  const entries = await fs.readdir(POSTS_DIR, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort()
}

export async function loadPost(filename) {
  const fullPath = path.join(POSTS_DIR, filename)
  const raw = await fs.readFile(fullPath, 'utf8')
  const parsed = matter(raw)
  return {
    filename,
    fullPath,
    parsed,
    normalized: normalizeFrontmatter(parsed.data, filename)
  }
}
