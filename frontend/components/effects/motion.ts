'use client'

import { useSyncExternalStore } from 'react'

// Motion switch (2026-11-15). Motion is ON for everyone by default, whatever the
// OS reduced-motion setting says (Clint's "same design for everyone" call). A
// visitor who doesn't want it flips the MotionSwitch, which saves the choice
// under MOTION_KEY and puts MOTION_OFF_CLASS on <html>. The root layout's
// before-paint script re-applies the class on every load, so a saved "off"
// never flashes motion first. CSS (globals.css) and JS animations both read
// that one class.
export const MOTION_KEY = 'argus-motion'
export const MOTION_OFF_CLASS = 'motion-off'

export function motionIsOff(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains(MOTION_OFF_CLASS)
}

// Calls `onChange` whenever the class list on <html> changes.
function subscribe(onChange: () => void) {
  const watch = new MutationObserver(onChange)
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => watch.disconnect()
}

// Live version for components: re-renders when the switch flips the class.
// The server always says "on" (it can't see the browser's saved choice); React
// swaps in the real value right after hydration without a mismatch error.
export function useMotionOff(): boolean {
  return useSyncExternalStore(subscribe, motionIsOff, () => false)
}
