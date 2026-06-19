import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
  reload: () => void;
}

/**
 * Run an async producer on mount, whenever `deps` change, and on demand via
 * `reload()`. A monotonically increasing sequence guards against stale results
 * resolving out of order or after unmount.
 */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[] = [],
): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(() => {
    const current = ++seq.current;
    setLoading(true);
    setError(undefined);
    fnRef.current().then(
      (result) => {
        if (!mounted.current || current !== seq.current) return;
        setData(result);
        setLoading(false);
      },
      (err: unknown) => {
        if (!mounted.current || current !== seq.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload: run };
}
