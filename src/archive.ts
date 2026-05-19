import type { ArchiveMonth, ArchiveYear, ImageSummary, PostSummary } from './types';

export type DateParams = {
  year?: string;
  month?: string;
  day?: string;
};

export function filterByDate<T extends DateParams>(items: T[], params: DateParams) {
  return items.filter((item) => {
    if (params.year && item.year !== params.year) {
      return false;
    }

    if (params.month && item.month !== params.month) {
      return false;
    }

    if (params.day && item.day !== params.day) {
      return false;
    }

    return true;
  });
}

export function selectedYear(years: ArchiveYear[], year?: string) {
  return years.find((item) => item.year === year);
}

export function selectedMonth(year?: ArchiveYear, month?: string) {
  return year?.months.find((item) => item.month === month);
}

export function daysForSelection(year?: ArchiveYear, month?: ArchiveMonth) {
  if (month) {
    return month.days;
  }

  return year?.months.flatMap((item) => item.days) ?? [];
}

export function postsForGallery(posts: PostSummary[], galleryIds: string[]) {
  const ids = new Set(galleryIds);
  return posts.filter((post) => post.galleryIds.some((galleryId) => ids.has(galleryId)));
}

export function imagesForPost(images: ImageSummary[], galleryIds: string[]) {
  const ids = new Set(galleryIds);
  return images.filter((image) => image.galleryId && ids.has(image.galleryId));
}

export function formatDateLabel(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function monthName(year: string, month: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${year}-${month}-01T00:00:00`));
}
