import { useEffect, useState } from "react";

/**
 * Return `value` delayed by `delayMs`, collapsing rapid changes so expensive
 * effects (e.g. IPC search) fire only after typing settles. The latest value
 * always wins; the pending timer is cleared on every change and on unmount.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
