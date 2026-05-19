import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { formatDateLabel } from '../archive';
import { ArchiveMetrics } from '../components/ArchiveMetrics';
import { ErrorState, LoadingState } from '../components/LoadingState';
import { pageHref, pageNumber, pageRangeLabel, PaginationNav } from '../components/PaginationNav';
import { fetchSearch } from '../content';
import { useAsyncData } from '../hooks';
import type { SearchContentType, SearchResult } from '../types';

const SEARCH_PAGE_SIZE = 12;

export function SearchPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q')?.trim() ?? '';
  const type = searchType(searchParams.get('type'));
  const currentPage = pageNumber(searchParams.get('page'));
  const state = useAsyncData(
    () =>
      fetchSearch({
        q: query,
        type,
        cursor: (currentPage - 1) * SEARCH_PAGE_SIZE,
        limit: SEARCH_PAGE_SIZE,
      }),
    [query, type, currentPage],
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nextQuery = String(data.get('q') ?? '').trim();
    const nextType = searchType(String(data.get('type') ?? ''));
    const nextParams = new URLSearchParams();

    if (nextQuery) {
      nextParams.set('q', nextQuery);
    }

    if (nextType) {
      nextParams.set('type', nextType);
    }

    const queryString = nextParams.toString();
    navigate(queryString ? `/search?${queryString}` : '/search');
  }

  return (
    <main className="page page--archive page--landing">
      <div className="archive-rail archive-rail--left">
        <section className="search-card" aria-labelledby="search-heading">
          <p className="eyebrow">Search</p>
          <h2 id="search-heading">Archive</h2>
          <form className="search-form" onSubmit={handleSubmit}>
            <label>
              <span>Term</span>
              <input name="q" type="search" defaultValue={query} placeholder="Search" />
            </label>
            <label>
              <span>Type</span>
              <select name="type" defaultValue={type ?? ''}>
                <option value="">All</option>
                <option value="post">Posts</option>
                <option value="story">Stories</option>
                <option value="gallery">Galleries</option>
              </select>
            </label>
            <button type="submit">
              <Search aria-hidden="true" size={17} />
              Search
            </button>
          </form>
        </section>
      </div>

      <section className="archive-main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Search</p>
            <h1>{query ? query : 'Search'}</h1>
          </div>
        </div>

        {state.status === 'loading' ? <LoadingState label="Loading search" /> : null}
        {state.status === 'error' ? <ErrorState error={state.error} /> : null}
        {state.status === 'ready' ? (
          <>
            <SearchResultList query={query} items={state.data.items} />
            {query && state.data.page ? (
              <>
                <p className="archive-count">
                  {pageRangeLabel(state.data.page.cursor, state.data.items.length, state.data.page.total)}
                </p>
                <PaginationNav
                  currentPage={currentPage}
                  totalItems={state.data.page.total}
                  pageSize={state.data.page.limit}
                  buildHref={(page) => pageHref(location.pathname, searchParams, page)}
                  label="Search pages"
                />
              </>
            ) : null}
          </>
        ) : null}
      </section>

      <aside className="archive-rail archive-rail--right">
        <ArchiveMetrics />
      </aside>
    </main>
  );
}

function SearchResultList({ query, items }: { query: string; items: SearchResult[] }) {
  if (!query) {
    return <p className="state-text">No search active.</p>;
  }

  if (items.length === 0) {
    return <p className="state-text">No matching content found.</p>;
  }

  return (
    <div className="taxonomy-result-list">
      {items.map((item) => (
        <Link className="taxonomy-result-card search-result-card" to={item.route} key={`${item.type}-${item.id}`}>
          {item.coverImage ? (
            <img src={item.coverImage.thumbUrl} alt={item.coverImage.alt || item.title} loading="lazy" />
          ) : null}
          <div>
            <time dateTime={item.date}>{formatDateLabel(item.date)}</time>
            <span>{contentTypeLabel(item.type)}</span>
            <h2>{item.title}</h2>
            {item.summary ? <p>{item.summary}</p> : null}
          </div>
        </Link>
      ))}
    </div>
  );
}

function contentTypeLabel(type: SearchContentType) {
  if (type === 'post') {
    return 'Post';
  }

  if (type === 'story') {
    return 'Story';
  }

  return 'Gallery';
}

function searchType(value: string | null): SearchContentType | undefined {
  if (value === 'post' || value === 'story' || value === 'gallery') {
    return value;
  }

  return undefined;
}
