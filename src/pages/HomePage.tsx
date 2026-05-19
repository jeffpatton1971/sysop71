import { ExternalLink, Globe } from 'lucide-react';
import type { CSSProperties } from 'react';
import { fetchHomeSummary } from '../content';
import { useAsyncData } from '../hooks';
import { ArchiveMetrics } from '../components/ArchiveMetrics';
import { ErrorState, LoadingState } from '../components/LoadingState';
import { ImageGrid } from '../components/ImageGrid';
import { EntrySummaryList } from '../components/PostList';
import type { SiteBanner } from '../types';

export function HomePage() {
  const state = useAsyncData(fetchHomeSummary, []);

  if (state.status === 'loading') {
    return <LoadingState />;
  }

  if (state.status === 'error') {
    return <ErrorState error={state.error} />;
  }

  const summary = state.data;
  const site = summary.site ?? { title: 'sysop71.com' };
  const author = site.author;
  const banner = site.banner;
  const recentUpdates = summary.recentEntries.slice(0, 5);
  const recentImages = summary.recentImages.slice(0, 10);

  return (
    <main className="home-layout page--landing">
      {banner ? (
        <section className="home-banner" aria-labelledby="home-title" style={bannerStyle(banner)}>
          <div className="home-banner__inner">
            {banner.eyebrow ? <p className="eyebrow">{banner.eyebrow}</p> : null}
            <h1 id="home-title">{banner.title || site.title}</h1>
            {banner.text ? <p>{banner.text}</p> : null}
          </div>
        </section>
      ) : null}

      <section className="page page--archive page--home home-body" aria-label="Archive overview">
        <aside className="archive-rail archive-rail--left">
          {hasAuthorContent(author) ? (
            <section className="author-card" aria-label="Author information">
              {author?.imageUrl ? <img src={author.imageUrl} alt={author.name || ''} /> : null}
              <div>
                <p className="eyebrow">Author</p>
                {author?.name ? <h2>{author.name}</h2> : null}
                {author?.bio ? <p>{author.bio}</p> : null}
              </div>
              {author?.links && author.links.length > 0 ? (
                <nav aria-label="Author links">
                  {author.links.map((link, index) => (
                    <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
                      {index === 0 ? (
                        <Globe aria-hidden="true" size={16} />
                      ) : (
                        <ExternalLink aria-hidden="true" size={16} />
                      )}
                      {link.label}
                    </a>
                  ))}
                </nav>
              ) : null}
            </section>
          ) : null}
        </aside>

        <section className="archive-main">
          <section className="split">
            <div>
              <div className="section-heading">
                <h2>Recent Updates</h2>
              </div>
              <EntrySummaryList entries={recentUpdates} />
            </div>
            <div>
              <div className="section-heading">
                <h2>Recent Images</h2>
              </div>
              <ImageGrid images={recentImages} />
            </div>
          </section>
        </section>

        <aside className="archive-rail archive-rail--right">
          <ArchiveMetrics />
        </aside>
      </section>
    </main>
  );
}

function bannerStyle(banner: SiteBanner): CSSProperties {
  if (!banner.backgroundImage) {
    return {};
  }

  return {
    backgroundImage: `linear-gradient(90deg, rgba(29, 32, 39, 0.78), rgba(29, 32, 39, 0.22)), url("${banner.backgroundImage}")`,
    backgroundPosition: banner.backgroundPosition || 'center',
    backgroundSize: banner.backgroundSize || 'cover',
  };
}

function hasAuthorContent(author: { name?: string; bio?: string; imageUrl?: string; links?: unknown[] } | undefined) {
  return Boolean(author?.name || author?.bio || (author?.links && author.links.length > 0));
}
