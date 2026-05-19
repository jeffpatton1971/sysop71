import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { formatDateLabel, monthName } from '../archive';
import { ArchiveCalendar, resolveSelection } from '../components/ArchiveCalendar';
import { ArchiveMetrics } from '../components/ArchiveMetrics';
import { ContentTaxonomyFooter } from '../components/ContentTaxonomyFooter';
import { GalleryPeekCarousel } from '../components/GalleryPeekCarousel';
import { ErrorState, LoadingState } from '../components/LoadingState';
import { pageHref, pageNumber, pageRangeLabel, PaginationNav } from '../components/PaginationNav';
import { fetchGalleryDocument, fetchGalleryIndex } from '../content';
import { useAsyncData } from '../hooks';
import type { GallerySummary } from '../types';

type GalleryParams = {
  year?: string;
  month?: string;
  day?: string;
  slug?: string;
};

const GALLERY_PAGE_SIZE = 4;

export function GalleriesPage() {
  const params = useParams<GalleryParams>();

  if (params.slug && params.year && params.month && params.day) {
    return <GalleryDetailPage params={params as Required<GalleryParams>} />;
  }

  return <GalleryArchivePage params={params} />;
}

function GalleryArchivePage({ params }: { params: GalleryParams }) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const source = searchParams.get('source') || undefined;
  const currentPage = pageNumber(searchParams.get('page'));
  const sourceSearch = source ? `?source=${encodeURIComponent(source)}` : '';
  const query = {
    year: params.year,
    month: params.month,
    day: params.day,
    source,
    cursor: (currentPage - 1) * GALLERY_PAGE_SIZE,
    limit: GALLERY_PAGE_SIZE,
  };
  const state = useAsyncData(() => fetchGalleryIndex(query), [
    params.year,
    params.month,
    params.day,
    source,
    currentPage,
  ]);

  if (state.status === 'loading') {
    return <LoadingState label="Loading galleries" />;
  }

  if (state.status === 'error') {
    return <ErrorState error={state.error} />;
  }

  const index = state.data;
  const selection = resolveSelection(index.years, params.year, params.month);

  return (
    <main className="page page--archive page--landing">
      <div className="archive-rail archive-rail--left">
        <ArchiveCalendar
          basePath="/galleries"
          label="Gallery Archive"
          years={index.years}
          selectedYear={selection?.year.year}
          selectedMonth={selection?.month.month}
          selectedDay={params.day}
          search={sourceSearch}
        />
      </div>

      <section className="archive-main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Galleries</p>
            <h1>{pageTitle(params, source)}</h1>
          </div>
        </div>

        <GalleryList galleries={index.galleries} search={sourceSearch} />
        {index.page ? (
          <>
            <p className="archive-count">
              {pageRangeLabel(index.page.cursor, index.galleries.length, index.page.total)}
            </p>
            <PaginationNav
              currentPage={currentPage}
              totalItems={index.page.total}
              pageSize={index.page.limit}
              buildHref={(page) => pageHref(location.pathname, searchParams, page)}
              label="Gallery pages"
            />
          </>
        ) : null}
      </section>

      <aside className="archive-rail archive-rail--right">
        <ArchiveMetrics />
      </aside>
    </main>
  );
}

function GalleryDetailPage({ params }: { params: Required<GalleryParams> }) {
  const [searchParams] = useSearchParams();
  const explicitSource = searchParams.get('source') || undefined;
  const state = useAsyncData(
    async () => {
      const gallery = await fetchGalleryDocument(params.year, params.month, params.day, params.slug);
      const source = explicitSource || gallery.sourceType;
      const index = await fetchGalleryIndex({ limit: 1, source });

      return {
        gallery,
        index,
        sourceSearch: source ? `?source=${encodeURIComponent(source)}` : '',
      };
    },
    [params.year, params.month, params.day, params.slug, explicitSource],
  );

  if (state.status === 'loading') {
    return <LoadingState label="Loading gallery" />;
  }

  if (state.status === 'error') {
    return <ErrorState error={state.error} />;
  }

  const { gallery, index, sourceSearch } = state.data;

  return (
    <main className="page page--archive page--detail">
      <div className="archive-rail archive-rail--left">
        <ArchiveCalendar
          basePath="/galleries"
          label="Gallery Archive"
          years={index.years}
          selectedYear={gallery.year}
          selectedMonth={gallery.month}
          selectedDay={gallery.day}
          search={sourceSearch}
        />
      </div>

      <article className="archive-main gallery-detail">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Gallery</p>
            <h1>{gallery.title}</h1>
            <p>{gallery.imageCount === 1 ? '1 image' : `${gallery.imageCount.toLocaleString()} images`}</p>
          </div>
        </div>

        {gallery.summary ? <p className="gallery-detail__summary">{gallery.summary}</p> : null}
        {gallery.related && gallery.related.length > 0 ? (
          <div className="gallery-detail__related">
            {gallery.related.map((item) =>
              item.route ? (
                <Link key={`${item.type}-${item.id}`} to={item.route}>
                  {item.title || item.id}
                </Link>
              ) : null,
            )}
          </div>
        ) : null}
        <ContentTaxonomyFooter hashtags={gallery.hashtags} categories={gallery.categories} />
        <GalleryPeekCarousel images={gallery.images} title={gallery.title} />
      </article>

      <aside className="archive-rail archive-rail--right">
        <ArchiveMetrics />
      </aside>
    </main>
  );
}

function GalleryList({ galleries, search = '' }: { galleries: GallerySummary[]; search?: string }) {
  if (galleries.length === 0) {
    return <p className="state-text">No galleries found for this date.</p>;
  }

  return (
    <div className="gallery-list">
      {galleries.map((gallery) => (
        <Link className="gallery-card" to={`${gallery.route}${search}`} key={gallery.route}>
          <img src={gallery.coverImage.thumbUrl} alt={gallery.coverImage.alt || gallery.title} loading="lazy" />
          <div>
            <time dateTime={gallery.date}>{formatDateLabel(gallery.date)}</time>
            <h2>{gallery.title}</h2>
            <p>{gallery.imageCount === 1 ? '1 image' : `${gallery.imageCount.toLocaleString()} images`}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}

function pageTitle(params: GalleryParams, source?: string) {
  const label = source ? `${source.charAt(0).toUpperCase()}${source.slice(1)} Galleries` : 'Galleries';

  if (params.year && params.month && params.day) {
    return formatDateLabel(`${params.year}-${params.month}-${params.day}T00:00:00`);
  }

  if (params.year && params.month) {
    return monthName(params.year, params.month);
  }

  if (params.year) {
    return params.year;
  }

  return `All ${label}`;
}
