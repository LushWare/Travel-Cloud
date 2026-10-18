import { useLayoutEffect, useRef } from 'react';
import type { WheelEvent } from 'react';

export default function useLenisScrollContainment() {
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const updateScrollability = () => {
      const nextIsScrollable = element.scrollHeight > element.clientHeight;
      element.toggleAttribute('data-lenis-prevent', nextIsScrollable);
    };

    updateScrollability();

    const mutationObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(updateScrollability);
    mutationObserver?.observe(element, { childList: true, subtree: true, characterData: true });

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateScrollability);
    resizeObserver?.observe(element);
    window.addEventListener('resize', updateScrollability);

    return () => {
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateScrollability);
    };
  }, []);

  const handleWheelCapture = (event: WheelEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const canScrollInDirection = event.deltaY < 0
      ? element.scrollTop > 0
      : event.deltaY > 0 && element.scrollTop + element.clientHeight < element.scrollHeight - 1;

    element.toggleAttribute('data-lenis-prevent', canScrollInDirection);
  };

  return { scrollRef, handleWheelCapture };
}