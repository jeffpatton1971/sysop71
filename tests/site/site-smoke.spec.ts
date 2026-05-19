import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const contentRoot = path.resolve(process.cwd(), 'public/content');

test.beforeEach(async ({ page }) => {
  await mockContentApi(page);
});

test('home page renders configured shell and recent content', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('link', { name: /sysop71.com home/i })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: /Search/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent Updates' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent Images' })).toBeVisible();
});

test('posts archive renders paged post cards', async ({ page }) => {
  await page.goto('/posts');

  await expect(page.getByRole('heading', { name: 'All Posts' })).toBeVisible();
  await expect(page.locator('.article-card').first()).toBeVisible();
  await expect(page.getByText(/Showing 1-4 of/)).toBeVisible();
});

test('search page returns clickable cross-type results', async ({ page }) => {
  await page.goto('/search');

  await page.getByRole('searchbox', { name: 'Term' }).fill('minecraft');
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(page).toHaveURL(/\/search\?q=minecraft/);
  await expect(page.getByRole('heading', { name: 'minecraft', exact: true })).toBeVisible();
  await expect(page.locator('.search-result-card').first()).toBeVisible();
  await expect(page.getByText(/Showing 1-/)).toBeVisible();
});

async function mockContentApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const pathParts = url.pathname.replace(/^\/api\/+/, '').split('/').filter(Boolean);
    const apiPath = pathParts[0] === 'sysop71' ? pathParts.slice(1).join('/') : pathParts.join('/');

    if (apiPath === 'home') {
      const [home, site] = await Promise.all([readContentJson('home.json'), readContentJson('site.json')]);
      await fulfillJson(route, {
        ...home,
        site,
        sourceCounts: home.sourceCounts ?? site.sourceCounts,
      });
      return;
    }

    if (apiPath === 'posts') {
      const index = await readContentJson('posts/index.json');
      await fulfillJson(route, pagedIndex(index, url));
      return;
    }

    if (apiPath === 'search') {
      const index = await readContentJson('search/index.json');
      await fulfillJson(route, searchResponse(index, url));
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ error: 'not_found', detail: apiPath }),
    });
  });
}

async function readContentJson(relativePath: string) {
  return JSON.parse(await readFile(path.join(contentRoot, relativePath), 'utf8'));
}

function pagedIndex(index: { generatedAt: string; posts: unknown[]; years: unknown[] }, url: URL) {
  const cursor = nonNegativeInteger(url.searchParams.get('cursor')) ?? 0;
  const limit = nonNegativeInteger(url.searchParams.get('limit')) ?? 4;
  const items = index.posts.slice(cursor, cursor + limit);

  return {
    generatedAt: index.generatedAt,
    years: index.years,
    items,
    page: pageInfo(cursor, limit, index.posts.length),
  };
}

function searchResponse(index: { generatedAt: string; items: SearchFixtureItem[] }, url: URL) {
  const query = url.searchParams.get('q')?.trim() ?? '';
  const terms = searchTerms(query);
  const type = url.searchParams.get('type');
  const cursor = nonNegativeInteger(url.searchParams.get('cursor')) ?? 0;
  const limit = nonNegativeInteger(url.searchParams.get('limit')) ?? 12;
  const matches =
    terms.length === 0
      ? []
      : index.items
          .filter((item) => !type || item.type === type)
          .filter((item) => terms.every((term) => (item.searchText ?? '').includes(term)))
          .map(({ searchText: _searchText, ...item }) => ({
            ...item,
            score: 1,
            matchedTerms: terms,
          }));

  return {
    generatedAt: index.generatedAt,
    query,
    terms,
    filters: {
      type: type || undefined,
    },
    items: matches.slice(cursor, cursor + limit),
    page: pageInfo(cursor, limit, matches.length),
  };
}

async function fulfillJson(route: Route, value: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(value),
  });
}

function pageInfo(cursor: number, limit: number, total: number) {
  const nextCursor = cursor + limit < total ? cursor + limit : undefined;

  return {
    cursor,
    limit,
    total,
    nextCursor,
  };
}

function searchTerms(query: string) {
  return [
    ...new Set(
      query
        .normalize('NFKC')
        .replace(/^#+|\B#/g, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        .split(' ')
        .filter((term) => term.length >= 2),
    ),
  ];
}

function nonNegativeInteger(value: string | null) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

type SearchFixtureItem = {
  type: string;
  searchText?: string;
};
