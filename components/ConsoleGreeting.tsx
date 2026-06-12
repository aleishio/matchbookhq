"use client";

import { useEffect } from "react";

export function ConsoleGreeting() {
  useEffect(() => {
    console.clear();
    const greeting = window.setTimeout(() => {
      console.log(
        "%cHello there. Nice try. Bonus tip: the useful stuff is on the page, not in the console logs.",
        "color:#ff4000;font-weight:700;font-size:14px;"
      );
    }, 0);

    return () => window.clearTimeout(greeting);
  }, []);

  return null;
}
