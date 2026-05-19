import { Navigate, useParams } from 'react-router-dom';
import { ErrorState, LoadingState } from '../components/LoadingState';
import { fetchEntryIndex, fetchGalleryIndex } from '../content';
import { useAsyncData } from '../hooks';

type LegacyParams = {
  year: string;
  month: string;
  day: string;
  slug: string;
};

export function LegacyPostRedirect() {
  const params = useParams<LegacyParams>();
  const slug = params.slug?.replace(/\.html$/, '');
  const state = useAsyncData(
    async () => {
      const query = {
        year: params.year,
        month: params.month,
        day: params.day,
        limit: 2000,
      };
      const [entries, galleries] = await Promise.all([fetchEntryIndex(query), fetchGalleryIndex(query)]);
      return { entries, galleries };
    },
    [params.year, params.month, params.day],
  );

  if (!params.year || !params.month || !params.day || !slug) {
    return <Navigate to="/posts" replace />;
  }

  if (state.status === 'loading') {
    return <LoadingState label="Finding legacy post" />;
  }

  if (state.status === 'error') {
    return <ErrorState error={state.error} />;
  }

  const match = state.data.entries.posts.find(
    (post) =>
      post.year === params.year &&
      post.month === params.month &&
      post.day === params.day &&
      post.slug === slug,
  );
  const galleryMatch = state.data.galleries.galleries.find(
    (gallery) => gallery.legacyUrl?.endsWith(`/${slug}.html`) || gallery.slug === slug,
  );

  return (
    <Navigate
      to={match?.route ?? galleryMatch?.route ?? `/posts/${params.year}/${params.month}/${params.day}/${slug}`}
      replace
    />
  );
}
