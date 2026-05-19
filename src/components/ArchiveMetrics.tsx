import { BookOpen, CalendarDays, Images } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchHomeSummary } from '../content';
import { useAsyncData } from '../hooks';

export function ArchiveMetrics() {
  const state = useAsyncData(fetchHomeSummary, []);

  if (state.status === 'loading') {
    return (
      <Card className="metrics-stack" aria-label="Archive totals">
        <CardContent className="grid gap-3 pt-4">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (state.status === 'error') {
    return null;
  }

  const { counts } = state.data;
  const metrics = [
    { href: '/posts', label: 'posts', value: counts.posts, icon: CalendarDays },
    { href: '/stories', label: 'stories', value: counts.stories, icon: BookOpen },
    { href: '/galleries', label: 'galleries', value: counts.galleries ?? 0, icon: Images },
    { href: '/images', label: 'images', value: counts.images, icon: Images },
  ];

  return (
    <div className="metrics-stack" aria-label="Archive totals">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Archive</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {metrics.map((metric) => {
            const Icon = metric.icon;

            return (
              <Link
                className="group flex min-h-14 items-center gap-3 rounded-lg border border-border/80 bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/45 hover:bg-secondary/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                to={metric.href}
                key={metric.href}
              >
                <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon aria-hidden="true" size={17} />
                </span>
                <span className="grid gap-0.5">
                  <strong className="text-lg leading-none text-foreground">{metric.value.toLocaleString()}</strong>
                  <span className="text-xs font-medium uppercase">{metric.label}</span>
                </span>
              </Link>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
