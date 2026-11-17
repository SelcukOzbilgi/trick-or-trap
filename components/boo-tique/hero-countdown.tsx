"use client";

import { useEffect, useState } from "react";
import { HERO_COUNTDOWN_LABEL } from "@/lib/boo-tique/content";
import {
  HERO_COUNTDOWN_SECONDS,
  formatCountdown,
} from "@/lib/boo-tique/countdown";

/**
 * Hero countdown. The server and the first client render both show 04:59:59. After mount it
 * ticks once per second. It keeps no storage, so every reload starts again at 04:59:59.
 */
export function HeroCountdown() {
  const [remaining, setRemaining] = useState(HERO_COUNTDOWN_SECONDS);

  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const text = `${HERO_COUNTDOWN_LABEL} ${formatCountdown(remaining)}`;
  return <p data-testid="home-hero-countdown-restart">{text}</p>;
}
