import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="page compact-page">
      <p className="eyebrow">404</p>
      <h1>That page is not in the archive yet.</h1>
      <p>The React prototype has routes for posts and images while we shape the migration.</p>
      <Link className="row-action" to="/">
        Return home
      </Link>
    </main>
  );
}

