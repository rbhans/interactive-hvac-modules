"use client";

import { useEffect, useState, type RefObject } from "react";

export function useMediaQuery(query: string, initial = false) {
  const [match, setMatch] = useState(initial);
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatch(mq.matches);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

export const useReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");

/** True while any part of the element is on screen. */
export function useInView(ref: RefObject<Element | null>) {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

export function usePageVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

/** Resolved color scheme: an explicit data-theme on <html> wins over the system setting. */
export function useDarkScheme() {
  const system = useMediaQuery("(prefers-color-scheme: dark)");
  const [forced, setForced] = useState<string | null>(null);
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setForced(el.getAttribute("data-theme"));
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return forced ? forced === "dark" : system;
}
