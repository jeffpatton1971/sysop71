import { useEffect, useState } from 'react';

type AsyncState<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'ready'; data: T; error?: undefined }
  | { status: 'error'; data?: undefined; error: Error };

export function useAsyncData<T>(loader: () => Promise<T>, keys: unknown[]) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });

    loader()
      .then((data) => {
        if (active) {
          setState({ status: 'ready', data });
        }
      })
      .catch((error: Error) => {
        if (active) {
          setState({ status: 'error', error });
        }
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, keys);

  return state;
}

