import { useEffect, useRef } from "react";

export function useAdaptiveHeight(bottomOffset = 80) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const height = window.innerHeight - rect.top - bottomOffset;
      if (height > 0) {
        el.style.height = `${height}px`;
        el.style.overflowY = "auto";
      }
    };

    update();

    let resizeTimer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(update, 100);
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(resizeTimer);
    };
  }, [bottomOffset]);

  return ref;
}
