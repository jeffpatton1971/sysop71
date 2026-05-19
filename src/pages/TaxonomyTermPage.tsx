import { Link, useParams } from 'react-router-dom';
import { formatDateLabel } from '../archive';
import { ArchiveMetrics } from '../components/ArchiveMetrics';
import { ErrorState, LoadingState } from '../components/LoadingState';
import { fetchTaxonomyTerm } from '../content';
import { useAsyncData } from '../hooks';
import type { TaxonomyContentRef, TaxonomyFamily } from '../types';

type TaxonomyTermPageProps = {
  family: TaxonomyFamily;
  eyebrow: string;
};

export function TaxonomyTermPage({ family, eyebrow }: TaxonomyTermPageProps) {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? '';
  const state = useAsyncData(() => fetchTaxonomyTerm(family, slug), [family, slug]);

  if (state.status === 'loading') {
    return <LoadingState label={`Loading ${eyebrow.toLowerCase()}`} />;
  }

  if (state.status === 'error') {
    return <ErrorState error={state.error} />;
  }

  const term = state.data;

  return (
    <main className="page page--archive page--landing">
      <div className="archive-rail archive-rail--left">
        <section className="taxonomy-card" aria-labelledby="taxonomy-heading">
          <p className="eyebrow">{eyebrow}</p>
          <h2 id="taxonomy-heading">{term.label}</h2>
          <p>{term.count === 1 ? '1 item' : `${term.count.toLocaleString()} items`}</p>
        </section>
      </div>

      <section className="archive-main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h1>{term.label}</h1>
          </div>
        </div>

        <TaxonomyResultList items={term.items} />
      </section>

      <aside className="archive-rail archive-rail--right">
        <ArchiveMetrics />
      </aside>
    </main>
  );
}

function TaxonomyResultList({ items }: { items: TaxonomyContentRef[] }) {
  if (items.length === 0) {
    return <p className="state-text">No matching content found.</p>;
  }

  return (
    <div className="taxonomy-result-list">
      {items.map((item) => (
        <Link className="taxonomy-result-card" to={item.route} key={`${item.type}-${item.id}`}>
          <time dateTime={item.date}>{formatDateLabel(item.date)}</time>
          <span>{contentTypeLabel(item.type)}</span>
          <h2>{item.title}</h2>
        </Link>
      ))}
    </div>
  );
}

function contentTypeLabel(type: TaxonomyContentRef['type']) {
  if (type === 'post') {
    return 'Post';
  }

  if (type === 'story') {
    return 'Story';
  }

  return 'Gallery';
}
