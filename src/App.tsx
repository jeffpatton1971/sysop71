import { BookOpen, ExternalLink, Home, Images, Library, Newspaper, Search, type LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { fetchHomeSummary } from './content';
import { useAsyncData } from './hooks';
import { HomePage } from './pages/HomePage';
import { GalleriesPage } from './pages/GalleriesPage';
import { ImagesPage } from './pages/ImagesPage';
import { LegacyPostRedirect } from './pages/LegacyPostRedirect';
import { NotFoundPage } from './pages/NotFoundPage';
import { PostDetailPage, StoryDetailPage } from './pages/PostDetailPage';
import { PostsPage, StoriesPage } from './pages/PostsPage';
import { SearchPage } from './pages/SearchPage';
import { TaxonomyTermPage } from './pages/TaxonomyTermPage';
import type { SiteInfo, SiteNavItem, SiteTheme } from './types';
import { TooltipProvider } from '@/components/ui/tooltip';

const defaultSite: SiteInfo = {
  title: 'sysop71.com',
  nav: [
    { href: '/', label: 'Home', icon: 'home' },
    { href: '/posts', label: 'Posts', icon: 'posts' },
    { href: '/stories', label: 'Stories', icon: 'stories' },
    { href: '/galleries', label: 'Galleries', icon: 'galleries' },
    { href: '/images', label: 'Images', icon: 'images' },
    { href: '/search', label: 'Search', icon: 'search' },
  ],
  footer: {
    brandText: 'sysop71.com',
  },
};

const iconMap: Record<string, LucideIcon> = {
  home: Home,
  posts: Newspaper,
  stories: BookOpen,
  galleries: Images,
  images: Images,
  search: Search,
  library: Library,
  external: ExternalLink,
};

const fallbackNav = [
  { href: '/posts', label: 'Posts', icon: 'posts' },
  { href: '/stories', label: 'Stories', icon: 'stories' },
  { href: '/galleries', label: 'Galleries', icon: 'galleries' },
  { href: '/images', label: 'Images', icon: 'images' },
  { href: '/search', label: 'Search', icon: 'search' },
];

export function App() {
  const state = useAsyncData(fetchHomeSummary, []);
  const site = state.status === 'ready' ? state.data.site ?? defaultSite : defaultSite;
  const nav = primaryNav(site);
  const footer = site.footer ?? {};
  const footerLinks = footer.links && footer.links.length > 0 ? footer.links : nav;

  return (
    <TooltipProvider>
      <div className="app-shell" style={themeStyle(site.theme)}>
        <header className="site-header">
          <NavLink to="/" className="brand" aria-label={`${site.title} home`}>
            <Library aria-hidden="true" size={24} />
            <span>{site.title}</span>
          </NavLink>
          <nav aria-label="Primary navigation">
            {nav.map((item) => (
              <SiteNavLink item={item} key={item.href} />
            ))}
          </nav>
        </header>

        <div className="app-content">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/posts" element={<PostsPage />} />
            <Route path="/posts/:year" element={<PostsPage />} />
            <Route path="/posts/:year/:month" element={<PostsPage />} />
            <Route path="/posts/:year/:month/:day" element={<PostsPage />} />
            <Route path="/posts/:year/:month/:day/:slug" element={<PostDetailPage />} />
            <Route path="/stories" element={<StoriesPage />} />
            <Route path="/stories/:year" element={<StoriesPage />} />
            <Route path="/stories/:year/:month" element={<StoriesPage />} />
            <Route path="/stories/:year/:month/:day" element={<StoriesPage />} />
            <Route path="/stories/:year/:month/:day/:slug" element={<StoryDetailPage />} />
            <Route path="/galleries" element={<GalleriesPage />} />
            <Route path="/galleries/:year" element={<GalleriesPage />} />
            <Route path="/galleries/:year/:month" element={<GalleriesPage />} />
            <Route path="/galleries/:year/:month/:day" element={<GalleriesPage />} />
            <Route path="/galleries/:year/:month/:day/:slug" element={<GalleriesPage />} />
            <Route path="/blog/:year/:month/:day/:slug" element={<LegacyPostRedirect />} />
            <Route path="/images" element={<ImagesPage />} />
            <Route path="/images/:year" element={<ImagesPage />} />
            <Route path="/images/:year/:month" element={<ImagesPage />} />
            <Route path="/images/:year/:month/:day" element={<ImagesPage />} />
            <Route path="/images/:year/:month/:day/:imageId" element={<ImagesPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/hashtags/:slug" element={<TaxonomyTermPage family="hashtags" eyebrow="Hashtag" />} />
            <Route path="/categories/:slug" element={<TaxonomyTermPage family="categories" eyebrow="Category" />} />
            <Route path="/people/:slug" element={<TaxonomyTermPage family="people" eyebrow="Person" />} />
            <Route path="/locations/:slug" element={<TaxonomyTermPage family="locations" eyebrow="Location" />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </div>

        <footer className="site-footer">
          <NavLink to="/" className="site-footer__brand">
            {footer.brandText || site.title}
          </NavLink>
          {footer.text ? <p>{footer.text}</p> : null}
          <nav aria-label="Footer navigation">
            {footerLinks.map((item) => (
              <SiteTextLink item={item} key={item.href} />
            ))}
          </nav>
          {footer.copyright ? <p className="site-footer__copyright">{footer.copyright}</p> : null}
        </footer>
      </div>
    </TooltipProvider>
  );
}

function primaryNav(site: SiteInfo) {
  const nav = site.nav ?? fallbackNav;
  return nav.length > 0 ? nav : fallbackNav;
}

function SiteNavLink({ item }: { item: SiteNavItem }) {
  const Icon = iconMap[item.icon ?? navIcon(item.href)] ?? Library;

  if (isExternalHref(item.href)) {
    return (
      <a href={item.href} target="_blank" rel="noreferrer">
        <ExternalLink aria-hidden="true" size={17} />
        {item.label}
      </a>
    );
  }

  return (
    <NavLink to={item.href}>
      <Icon aria-hidden="true" size={17} />
      {item.label}
    </NavLink>
  );
}

function SiteTextLink({ item }: { item: SiteNavItem }) {
  if (isExternalHref(item.href)) {
    return (
      <a href={item.href} target="_blank" rel="noreferrer">
        {item.label}
      </a>
    );
  }

  return <NavLink to={item.href}>{item.label}</NavLink>;
}

function navIcon(href: string) {
  if (href.startsWith('/posts')) {
    return 'posts';
  }

  if (href.startsWith('/stories')) {
    return 'stories';
  }

  if (href.startsWith('/galleries')) {
    return 'galleries';
  }

  if (href.startsWith('/images')) {
    return 'images';
  }

  if (href.startsWith('/search')) {
    return 'search';
  }

  return 'library';
}

function isExternalHref(href: string) {
  return /^https?:\/\//i.test(href);
}

function themeStyle(theme: SiteTheme | undefined): CSSProperties {
  if (!theme) {
    return {};
  }

  return {
    '--site-font-family': theme.fontFamily,
    '--mm-bg': theme.background,
    '--mm-text': theme.text,
    '--mm-surface': theme.surface,
    '--mm-surface-raised': theme.surfaceRaised,
    '--mm-border': theme.border,
    '--mm-muted': theme.muted,
    '--mm-accent': theme.accent,
    '--mm-accent-strong': theme.accentStrong,
    '--site-banner-background': theme.bannerBackground,
    '--site-header-background': theme.headerBackground,
    '--site-footer-background': theme.footerBackground,
  } as CSSProperties;
}
