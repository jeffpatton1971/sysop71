import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import useEmblaCarousel from 'embla-carousel-react';
import { formatDateLabel, monthName } from '../archive';
import { ArchiveCalendar, resolveSelection } from '../components/ArchiveCalendar';
import { ArchiveMetrics } from '../components/ArchiveMetrics';
import { ImageGrid } from '../components/ImageGrid';
import { ErrorState, LoadingState } from '../components/LoadingState';
import { pageHref, pageNumber, PaginationNav } from '../components/PaginationNav';
import { fetchImageIndex } from '../content';
import { useAsyncData } from '../hooks';
import type { ImageGroup } from '../types';

type ImageParams = {
  year?: string;
  month?: string;
  day?: string;
  imageId?: string;
};

const IMAGE_GROUP_PAGE_SIZE = 1;

export function ImagesPage() {
  const params = useParams<ImageParams>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const currentGroupPage = pageNumber(searchParams.get('page'));
  const query = imageQuery(params);
  const state = useAsyncData(() => fetchImageIndex(query), [
    params.year,
    params.month,
    params.day,
    params.imageId,
  ]);

  if (state.status === 'loading') {
    return <LoadingState label="Loading images" />;
  }

  if (state.status === 'error') {
    return <ErrorState error={state.error} />;
  }

  const index = state.data;
  const calendarSelection = resolveSelection(index.years, params.year, params.month);
  const scopedImages = index.images;
  const selectedImage = scopedImages.find((image) => imageMatchesRouteParam(image.id, params.imageId));
  const shouldShowImages = Boolean(params.day);
  const shouldShowRootGroups = !params.year;
  const shouldShowYearGroups = Boolean(params.year && !params.month);
  const shouldShowMonthGroups = Boolean(params.year && params.month && !params.day);
  const groups = displayGroups(index.groups ?? [], index.groupBy);
  const rootGroups = shouldShowRootGroups ? groups : [];
  const yearGroups = shouldShowYearGroups ? groups : [];
  const monthGroups = shouldShowMonthGroups ? groups : [];
  const totalCount = index.page?.total ?? sumGroups(groups) ?? scopedImages.length;
  const pageClassName = selectedImage ? 'page page--archive page--detail' : 'page page--archive page--landing';

  return (
    <main className={pageClassName}>
      <div className="archive-rail archive-rail--left">
        <ArchiveCalendar
          basePath="/images"
          label="Image Archive"
          years={index.years}
          selectedYear={calendarSelection?.year.year}
          selectedMonth={calendarSelection?.month.month}
          selectedDay={params.day}
        />
      </div>

      <section className="archive-main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Images</p>
            <h1>{pageTitle(params, totalCount)}</h1>
          </div>
        </div>

        {!shouldShowImages && !shouldShowRootGroups && !shouldShowYearGroups && !shouldShowMonthGroups ? (
          <div className="archive-summary">
            <strong>{scopedImages.length.toLocaleString()}</strong>
            <span>{scopedImages.length === 1 ? 'image' : 'images'}</span>
          </div>
        ) : null}

        {shouldShowRootGroups ? (
          <PaginatedImageGroups
            groups={rootGroups}
            groupBy={index.groupBy}
            currentPage={currentGroupPage}
            buildHref={(page) => pageHref(location.pathname, searchParams, page)}
            emptyText="No images found."
            previewLimit={12}
          />
        ) : null}

        {shouldShowYearGroups ? (
          <PaginatedImageGroups
            groups={yearGroups}
            groupBy={index.groupBy}
            currentPage={currentGroupPage}
            buildHref={(page) => pageHref(location.pathname, searchParams, page)}
            emptyText="No images found for this year."
            previewLimit={12}
          />
        ) : null}

        {shouldShowMonthGroups ? (
          <PaginatedImageGroups
            groups={monthGroups}
            groupBy={index.groupBy}
            currentPage={currentGroupPage}
            buildHref={(page) => pageHref(location.pathname, searchParams, page)}
            emptyText="No images found for this month."
          />
        ) : null}

        {selectedImage ? (
          <section className="image-viewer">
            <img src={selectedImage.rawUrl} alt={selectedImage.title} />
          </section>
        ) : null}

        {shouldShowImages ? (
          <ImageGrid images={scopedImages} selectedId={selectedImage?.id} />
        ) : null}
        {index.page && index.page.total > scopedImages.length ? (
          <p className="archive-count">
            Showing {scopedImages.length.toLocaleString()} of {index.page.total.toLocaleString()}
          </p>
        ) : null}
      </section>

      <aside className="archive-rail archive-rail--right">
        <ArchiveMetrics />
      </aside>
    </main>
  );
}

function PaginatedImageGroups({
  groups,
  groupBy,
  currentPage,
  buildHref,
  emptyText,
  previewLimit,
}: {
  groups: ImageGroup[];
  groupBy: 'year' | 'month' | 'day' | undefined;
  currentPage: number;
  buildHref: (page: number) => string;
  emptyText: string;
  previewLimit?: number;
}) {
  const page = imageGroupPage(groups, currentPage);

  return (
    <>
      <ImageGroups groups={page.groups} emptyText={emptyText} previewLimit={previewLimit} />
      {groups.length > IMAGE_GROUP_PAGE_SIZE ? (
        <>
          <p className="archive-count">{imageGroupRangeLabel(groups, page.start, page.groups.length, groupBy)}</p>
          <PaginationNav
            currentPage={page.currentPage}
            totalItems={groups.length}
            pageSize={IMAGE_GROUP_PAGE_SIZE}
            buildHref={buildHref}
            pageLabel={(pageNumber) => imageGroupPageLabel(groups, pageNumber, groupBy)}
            label="Image group pages"
          />
        </>
      ) : null}
    </>
  );
}

function ImageGroups({
  groups,
  emptyText,
  previewLimit,
}: {
  groups: ImageGroup[];
  emptyText: string;
  previewLimit?: number;
}) {
  if (groups.length === 0) {
    return <p className="state-text">{emptyText}</p>;
  }

  return (
    <div className="image-groups">
      {groups.map((group) => (
        <ImageGroupCarousel group={group} previewLimit={previewLimit} key={group.key} />
      ))}
    </div>
  );
}

function ImageGroupCarousel({ group, previewLimit }: { group: ImageGroup; previewLimit?: number }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'center',
    containScroll: false,
    dragFree: false,
    loop: group.images.length > 2,
    skipSnaps: false,
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const previewImages = previewLimit ? group.images.slice(0, previewLimit) : group.images;
  const remainingCount = group.count - previewImages.length;

  const updateSelection = useCallback(() => {
    setSelectedIndex(emblaApi?.selectedScrollSnap() ?? 0);
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) {
      return;
    }

    updateSelection();
    emblaApi.on('select', updateSelection);
    emblaApi.on('reInit', updateSelection);

    return () => {
      emblaApi.off('select', updateSelection);
      emblaApi.off('reInit', updateSelection);
    };
  }, [emblaApi, updateSelection]);

  return (
    <section className="image-group">
      <div className="image-group__header">
        <div>
          <Link to={group.href}>{group.label}</Link>
          <span>{group.count === 1 ? '1 image' : `${group.count.toLocaleString()} images`}</span>
        </div>
        <div className="image-group__controls">
          <button type="button" title={`Previous ${group.label} images`} onClick={() => emblaApi?.scrollPrev()}>
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <button type="button" title={`Next ${group.label} images`} onClick={() => emblaApi?.scrollNext()}>
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </div>
      </div>
      <div className="image-group__viewport" ref={emblaRef}>
        <div className="image-group__track">
          {previewImages.map((image, index) => (
            <div className={slideClass(index, selectedIndex)} key={image.id}>
              <Link className="image-group__slide-link" to={image.route} title={image.title}>
                <img src={image.thumbUrl} alt={image.title} loading="lazy" />
              </Link>
            </div>
          ))}
          {remainingCount > 0 ? (
            <div className={slideClass(previewImages.length, selectedIndex)}>
              <Link className="image-group__more" to={group.href}>
                +{remainingCount.toLocaleString()}
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function slideClass(index: number, selectedIndex: number) {
  const distance = Math.abs(index - selectedIndex);

  if (distance === 0) {
    return 'image-group__slide image-group__slide--active';
  }

  if (distance === 1) {
    return index < selectedIndex
      ? 'image-group__slide image-group__slide--near image-group__slide--before'
      : 'image-group__slide image-group__slide--near image-group__slide--after';
  }

  return 'image-group__slide image-group__slide--far';
}

function pageTitle(params: ImageParams, count: number) {
  if (params.year && params.month && params.day) {
    const date = formatDateLabel(`${params.year}-${params.month}-${params.day}T00:00:00`);
    return params.imageId ? date : `${date} (${count})`;
  }

  if (params.year && params.month) {
    return `${monthName(params.year, params.month)} (${count})`;
  }

  if (params.year) {
    return `${params.year} (${count})`;
  }

  return `All Images (${count})`;
}

function imageQuery(params: ImageParams) {
  if (!params.year) {
    return { groupBy: 'year' as const };
  }

  if (!params.month) {
    return { year: params.year, groupBy: 'month' as const };
  }

  if (!params.day) {
    return { year: params.year, month: params.month, groupBy: 'day' as const };
  }

  return {
    year: params.year,
    month: params.month,
    day: params.day,
    limit: 10000,
  };
}

function displayGroups(groups: ImageGroup[], groupBy: 'year' | 'month' | 'day' | undefined) {
  return groups.map((group) => {
    if (groupBy === 'month') {
      const [year, month] = group.key.split('-');
      return { ...group, label: monthName(year, month) };
    }

    if (groupBy === 'day') {
      return { ...group, label: formatDateLabel(`${group.key}T00:00:00`) };
    }

    return group;
  });
}

function sumGroups(groups: ImageGroup[]) {
  if (groups.length === 0) {
    return undefined;
  }

  return groups.reduce((total, group) => total + group.count, 0);
}

function imageGroupPage(groups: ImageGroup[], requestedPage: number) {
  const totalPages = Math.max(1, Math.ceil(groups.length / IMAGE_GROUP_PAGE_SIZE));
  const currentPage = Math.min(Math.max(requestedPage, 1), totalPages);
  const start = (currentPage - 1) * IMAGE_GROUP_PAGE_SIZE;

  return {
    currentPage,
    start,
    groups: groups.slice(start, start + IMAGE_GROUP_PAGE_SIZE),
  };
}

function imageGroupPageLabel(groups: ImageGroup[], page: number, groupBy: 'year' | 'month' | 'day' | undefined) {
  const start = (page - 1) * IMAGE_GROUP_PAGE_SIZE;
  const pageGroups = groups.slice(start, start + IMAGE_GROUP_PAGE_SIZE);

  if (pageGroups.length === 0) {
    return String(page);
  }

  return imageGroupLabelRange(pageGroups[0], pageGroups[pageGroups.length - 1], groupBy);
}

function imageGroupRangeLabel(
  groups: ImageGroup[],
  start: number,
  shown: number,
  groupBy: 'year' | 'month' | 'day' | undefined,
) {
  if (shown === 0 || groups.length === 0) {
    return `Showing 0 of ${groups.length.toLocaleString()} ${imageGroupKind(groupBy)}`;
  }

  const first = groups[start];
  const last = groups[start + shown - 1];
  return `Showing ${imageGroupLabelRange(first, last, groupBy)} of ${groups.length.toLocaleString()} ${imageGroupKind(
    groupBy,
  )}`;
}

function imageGroupLabelRange(first: ImageGroup, last: ImageGroup, groupBy: 'year' | 'month' | 'day' | undefined) {
  const firstLabel = compactGroupLabel(first, groupBy);
  const lastLabel = compactGroupLabel(last, groupBy);

  if (firstLabel === lastLabel) {
    return firstLabel;
  }

  return `${firstLabel}-${lastLabel}`;
}

function compactGroupLabel(group: ImageGroup, groupBy: 'year' | 'month' | 'day' | undefined) {
  if (groupBy === 'month') {
    const [, month] = group.key.split('-');
    return shortMonthName(month);
  }

  if (groupBy === 'day') {
    return group.key.split('-').at(-1)?.replace(/^0/, '') ?? group.label;
  }

  return group.label;
}

function shortMonthName(month: string) {
  const date = new Date(2000, Number(month) - 1, 1);
  return new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date);
}

function imageGroupKind(groupBy: 'year' | 'month' | 'day' | undefined) {
  if (groupBy === 'month') {
    return 'month groups';
  }

  if (groupBy === 'day') {
    return 'day groups';
  }

  return 'year groups';
}

function imageMatchesRouteParam(imageId: string, routeParam: string | undefined) {
  if (!routeParam) {
    return false;
  }

  return imageId === routeParam || imageId.split('/').at(-1) === routeParam;
}
