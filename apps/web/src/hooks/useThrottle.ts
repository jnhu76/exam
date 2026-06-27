import { useCallback, useRef } from "react";

export function useThrottle<T extends (...args: never[]) => void>(
  fn: T,
  delay = 500,
) {
  const lastExec = useRef(0);

  return useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      if (now - lastExec.current > delay) {
        fn(...args);
        lastExec.current = now;
      }
    },
    [fn, delay],
  );
}
