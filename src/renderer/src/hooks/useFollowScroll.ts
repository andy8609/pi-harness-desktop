import { useCallback, useRef, useState } from "react";

/**
 * Keep the transcript pinned to the bottom while content streams in, but stop
 * following as soon as the user scrolls up. Ported in spirit from PI-Desktop's
 * follow-scroll behaviour (ADR 0149).
 */
export function useFollowScroll<T extends HTMLElement = HTMLDivElement>() {
  const scrollRef = useRef<T>(null);
  const [following, setFollowing] = useState(true);
  const [showJump, setShowJump] = useState(false);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    setFollowing(atBottom);
    setShowJump(!atBottom);
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setFollowing(true);
    setShowJump(false);
  }, []);

  const scheduleFollowScroll = useCallback(() => {
    if (!following) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [following]);

  return { scrollRef, following, showJump, handleScroll, jumpToLatest, scheduleFollowScroll };
}
