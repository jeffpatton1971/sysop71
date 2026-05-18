import { describe, it, expect } from 'vitest'
import { normalizeFrontmatter } from '../scripts/content-utils.mjs'

describe('normalizeFrontmatter', () => {
  it('converts tags into hashtags and strips jekyll keys from normalized output', () => {
    const normalized = normalizeFrontmatter(
      {
        title: 'Example',
        date: '2026-05-18',
        tags: ['Overwatch2', '#PatchNotes'],
        categories: 'Gaming, Updates',
        published: false,
        layout: 'post'
      },
      '2026-05-18-example.md'
    )

    expect(normalized.hashtags).toEqual(['overwatch2', 'patchnotes'])
    expect(normalized.status).toBe('draft')
    expect(normalized.categories).toEqual(['Gaming', 'Updates'])
    expect(normalized).not.toHaveProperty('layout')
  })
})
