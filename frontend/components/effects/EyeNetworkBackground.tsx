'use client'

import { useEffect, useRef } from 'react'
import { useTheme } from '@/components/theme/ThemeProvider'

// The signature animated background (Sprint 4.7 visual pass, 2026-07-15).
// Clint's brief: an animated presence like a game landing page's video
// background, but drawn instead of filmed, and present through the app, not
// just the landing page. The concept isn't decoration bolted onto the brand --
// it's the brand: ARGUS is the hundred-eyed watchman, and this product turns
// scattered documents into connected findings while a security layer keeps
// watch. So the canvas draws exactly that: a field of nodes (documents/facts)
// that slowly drift and link when close enough (synthesis, the Retriever/
// Synthesizer's actual job), and on the hero tier only, a slow rotating
// radar sweep (the SOC/monitoring half of the product). Same idea, two
// honest intensities -- not two different concepts for "landing" vs "app".
//
// Colors are hardcoded to match globals.css's accent tokens, not read via
// getComputedStyle: canvas draws in its own pixel buffer with no live
// cascade, so a CSS var can't reach it without a per-frame DOM read. This is
// the SAME tradeoff figures.py already made for matplotlib chart exports --
// precedent in this codebase, not a new pattern. `useTheme()` (already
// wraps the whole app in the root layout) picks which constant applies, and
// updates reactively the instant the toggle flips.
const ACCENT = { light: '14, 116, 144', dark: '34, 184, 212' } // r, g, b of --color-accent

export type BackgroundIntensity = 'hero' | 'ambient'

interface Node {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  pulse: number // phase offset so nodes don't glow in lockstep
}

const TUNING: Record<BackgroundIntensity, {
  density: number // px^2 of canvas area per node, lower = denser
  maxNodes: number
  linkDist: number
  speed: number
  nodeAlpha: number
  linkAlpha: number
  radar: boolean
}> = {
  hero: { density: 9000, maxNodes: 90, linkDist: 150, speed: 0.10, nodeAlpha: 0.85, linkAlpha: 0.22, radar: true },
  ambient: { density: 22000, maxNodes: 26, linkDist: 130, speed: 0.045, nodeAlpha: 0.5, linkAlpha: 0.1, radar: false },
}

export default function EyeNetworkBackground({
  intensity = 'ambient',
  className = '',
}: {
  intensity?: BackgroundIntensity
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    const canvas = canvasRef.current
    const container = canvas?.parentElement
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const tuning = TUNING[intensity]
    const rgb = ACCENT[resolvedTheme]
    // createConicGradient isn't universal (older Safari); an unguarded call
    // throws on first frame and would silently kill the whole animation loop
    // (nothing catches it inside rAF). Checked once, not per-frame.
    const supportsRadar = tuning.radar && typeof ctx.createConicGradient === 'function'

    let nodes: Node[] = []
    let width = 0
    let height = 0
    let dpr = 1
    let raf = 0
    let radarAngle = 0
    let visible = true
    let lastFrame = 0
    // Ambient tier throttles to ~24fps (still smooth for a slow drift, a
    // third of the main-thread cost of 60fps) since it runs on every
    // dashboard page concurrently with real app work; hero gets the full
    // 60fps budget since it's the one showpiece instance on the landing page.
    const frameBudgetMs = intensity === 'ambient' ? 1000 / 24 : 0

    function seed() {
      const area = width * height
      const count = Math.min(tuning.maxNodes, Math.max(8, Math.round(area / tuning.density)))
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * tuning.speed,
        vy: (Math.random() - 0.5) * tuning.speed,
        r: 1 + Math.random() * 1.6,
        pulse: Math.random() * Math.PI * 2,
      }))
    }

    function resize() {
      const rect = container!.getBoundingClientRect()
      // Capped at 1.75x: this is an ambient decoration, not photo output --
      // a full 3x/4x backing store on a large monitor would multiply the
      // per-frame fill cost for a difference nobody will consciously see.
      dpr = Math.min(window.devicePixelRatio || 1, 1.75)
      width = Math.max(1, Math.round(rect.width))
      height = Math.max(1, Math.round(rect.height))
      canvas!.width = width * dpr
      canvas!.height = height * dpr
      canvas!.style.width = `${width}px`
      canvas!.style.height = `${height}px`
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      seed()
    }

    function drawFrame(t: number) {
      ctx!.clearRect(0, 0, width, height)

      // Radar sweep first (hero only), so the node network draws on top of it.
      if (supportsRadar) {
        const cx = width * 0.82
        const cy = height * 0.22
        const radius = Math.max(width, height) * 0.75
        const sweep = ctx!.createConicGradient(radarAngle, cx, cy)
        sweep.addColorStop(0, `rgba(${rgb}, 0.16)`)
        sweep.addColorStop(0.06, `rgba(${rgb}, 0.05)`)
        sweep.addColorStop(0.16, 'rgba(0,0,0,0)')
        sweep.addColorStop(1, 'rgba(0,0,0,0)')
        ctx!.save()
        ctx!.beginPath()
        ctx!.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx!.fillStyle = sweep
        ctx!.fill()
        ctx!.restore()
        radarAngle += 0.0035
      }

      // Drift + wrap.
      for (const n of nodes) {
        n.x += n.vx
        n.y += n.vy
        if (n.x < -20) n.x = width + 20
        if (n.x > width + 20) n.x = -20
        if (n.y < -20) n.y = height + 20
        if (n.y > height + 20) n.y = -20
      }

      // Links: O(n^2) is fine at these node counts (<=90); this is the same
      // "constellation network" technique used across countless hero
      // backgrounds, not a novel performance risk.
      ctx!.lineWidth = 1
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]
          const b = nodes[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < tuning.linkDist) {
            const alpha = (1 - dist / tuning.linkDist) * tuning.linkAlpha
            ctx!.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`
            ctx!.beginPath()
            ctx!.moveTo(a.x, a.y)
            ctx!.lineTo(b.x, b.y)
            ctx!.stroke()
          }
        }
      }

      // Nodes, with a slow individual glow pulse (documents "lighting up" as
      // they're read) so the field never looks static even where links are sparse.
      for (const n of nodes) {
        const glow = 0.55 + 0.45 * Math.sin(t / 1400 + n.pulse)
        ctx!.beginPath()
        ctx!.fillStyle = `rgba(${rgb}, ${(tuning.nodeAlpha * glow).toFixed(3)})`
        ctx!.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx!.fill()
      }
    }

    function loop(t: number) {
      if (!visible) {
        raf = requestAnimationFrame(loop)
        return
      }
      if (t - lastFrame >= frameBudgetMs) {
        lastFrame = t
        drawFrame(t)
      }
      raf = requestAnimationFrame(loop)
    }

    resize()

    if (reduceMotion) {
      // One still frame, no rAF loop at all -- honors reduced-motion exactly
      // (no oscillation, no sweep), while still giving the page its visual
      // identity instead of a blank rect.
      drawFrame(0)
    } else {
      raf = requestAnimationFrame(loop)
    }

    const ro = new ResizeObserver(() => resize())
    ro.observe(container)

    // Pause off-screen instances entirely (the ambient tier is mounted on
    // every dashboard page; only the one actually in view should ever spend a
    // frame budget) and on a hidden tab.
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
    })
    io.observe(canvas)
    const onVisibility = () => {
      visible = document.visibilityState === 'visible' && visible
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intensity, resolvedTheme])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none block ${className}`}
    />
  )
}
