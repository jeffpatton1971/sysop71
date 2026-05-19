export function LoadingState({ label = 'Loading archive' }: { label?: string }) {
  return <p className="state-text">{label}</p>;
}

export function ErrorState({ error }: { error: Error }) {
  return (
    <div className="notice" role="alert">
      <strong>Something did not load.</strong>
      <span>{error.message}</span>
    </div>
  );
}

