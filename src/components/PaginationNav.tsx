import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

type PaginationNavProps = {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  buildHref: (page: number) => string;
  pageLabel?: (page: number) => string;
  label?: string;
};

type PageToken = number | 'gap';

export function PaginationNav({
  currentPage,
  totalItems,
  pageSize,
  buildHref,
  pageLabel = (page) => String(page),
  label = 'Pagination',
}: PaginationNavProps) {
  const totalPages = Math.ceil(totalItems / pageSize);

  if (totalPages <= 1) {
    return null;
  }

  const activePage = clamp(currentPage, 1, totalPages);
  const tokens = pageTokens(activePage, totalPages);

  return (
    <nav className="pagination-nav" aria-label={label}>
      {activePage > 1 ? (
        <Link className="pagination-nav__control" to={buildHref(activePage - 1)} aria-label="Previous page">
          <ChevronLeft aria-hidden="true" size={17} />
        </Link>
      ) : (
        <span className="pagination-nav__control pagination-nav__control--disabled" aria-hidden="true">
          <ChevronLeft aria-hidden="true" size={17} />
        </span>
      )}

      <div className="pagination-nav__pages">
        {tokens.map((token, index) =>
          token === 'gap' ? (
            <span className="pagination-nav__gap" aria-hidden="true" key={`gap-${index}`}>
              ...
            </span>
          ) : (
            <Link
              className="pagination-nav__page"
              to={buildHref(token)}
              aria-current={token === activePage ? 'page' : undefined}
              key={token}
            >
              {pageLabel(token)}
            </Link>
          ),
        )}
      </div>

      {activePage < totalPages ? (
        <Link className="pagination-nav__control" to={buildHref(activePage + 1)} aria-label="Next page">
          <ChevronRight aria-hidden="true" size={17} />
        </Link>
      ) : (
        <span className="pagination-nav__control pagination-nav__control--disabled" aria-hidden="true">
          <ChevronRight aria-hidden="true" size={17} />
        </span>
      )}
    </nav>
  );
}

export function pageNumber(value: string | null | undefined) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return 1;
  }

  return parsed;
}

export function pageHref(pathname: string, searchParams: URLSearchParams, page: number) {
  const nextParams = new URLSearchParams(searchParams);

  if (page <= 1) {
    nextParams.delete('page');
  } else {
    nextParams.set('page', String(page));
  }

  const query = nextParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function pageRangeLabel(cursor: number, shown: number, total: number) {
  if (total === 0 || shown === 0) {
    return `Showing 0 of ${total.toLocaleString()}`;
  }

  const start = cursor + 1;
  const end = cursor + shown;
  return `Showing ${start.toLocaleString()}-${end.toLocaleString()} of ${total.toLocaleString()}`;
}

function pageTokens(currentPage: number, totalPages: number): PageToken[] {
  const visible = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const pages = [...visible].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const tokens: PageToken[] = [];

  for (const page of pages) {
    const previous = tokens[tokens.length - 1];

    if (typeof previous === 'number' && page - previous > 1) {
      tokens.push('gap');
    }

    tokens.push(page);
  }

  return tokens;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
