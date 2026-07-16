'use client'

import { useEffect, useRef } from 'react'
import { useTheme } from '@/components/theme/ThemeProvider'

// The signature animated background, v2 (dark-cinematic rebuild, 2026-07-15).
// v1 was tuned so politely for a light default that Clint's verdict was "I
// don't see any changes" -- accurate, the ambient tier was ~26 dots at 10%
// link alpha on off-white. With dark now the brand default (owner decision),
// this version is designed FOR darkness and dampened for the light opt-out,
// instead of the reverse.
//
// The concept is still the product, not decoration: ARGUS is the hundred-eyed
// watchman -- a field of glowing nodes (documents/facts) drifts and links
// when close (what the Retriever/Synthesizer actually do), a slow radar sweep
// crosses the hero tier (the SOC/monitoring half), and on the hero the
// network reaches toward the visitor's cursor (the system noticing you --
// the watchman looking back).
//
// Colors are hardcoded to match globals.css's accent tokens, not read via
// getComputedStyle: canvas draws into its own pixel buffer with no live
// cascade (same tradeoff figures.py made for matplotlib). `useTheme()` picks
// the constant and re-runs the effect the instant the toggle flips.
const ACCENT = { light: '14, 116, 144', dark: '34, 184, 212' } // r,g,b of --color-accent

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
  cursor: boolean
  glow: boolean
  fps: number
}> = {
  // Hero: the showpiece. Dense field, bright links, radar, cursor response,
  // soft glow on every node. Full frame budget.
  hero: {
    density: 7000, maxNodes: 130, linkDist: 170, speed: 0.12,
    nodeAlpha: 0.95, linkAlpha: 0.4, radar: true, cursor: true, glow: true, fps: 60,
  },
  // Ambient: every app page. Clearly present now (v1's core failure), but
  // calmer -- no radar, no cursor chase, throttled framerate since it runs
  // alongside real work.
  ambient: {
    density: 12000, maxNodes: 70, linkDist: 150, speed: 0.06,
    nodeAlpha: 0.8, linkAlpha: 0.26, radar: false, cursor: false, glow: false, fps: 30,
  },
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
    // Glow-on-white has a physical ceiling: the same alphas that sing on the
    // dark base turn to mud on paper. The light opt-out gets a dampened field
    // rather than pretending one tuning fits both.
    const damp = resolvedTheme === 'dark' ? 1 : 0.65
    // createConicGradient isn't universal (older Safari); an unguarded call
    // throws on first frame and would silently kill the whole rAF loop.
    const supportsRadar = tuning.radar && typeof ctx.createConicGradient === 'function'

    let nodes: Node[] = []
    let width = 0
    let height = 0
    let dpr = 1
    let raf = 0
    let radarAngle = 0
    let inView = true
    let tabVisible = document.visibilityState === 'visible'
    let lastFrame = 0
    const frameBudgetMs = tuning.fps >= 60 ? 0 : 1000 / tuning.fps
    // Cursor position in canvas coordinates; null when the pointer is away.
    let mouse: { x: number; y: number } | null = null

    function seed() {
      const area = width * height
      const count = Math.min(tuning.maxNodes, Math.max(10, Math.round(area / tuning.density)))
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * tuning.speed,
        vy: (Math.random() - 0.5) * tuning.speed,
        r: 1.1 + Math.random() * 1.8,
        pulse: Math.random() * Math.PI * 2,
      }))
    }

    function resize() {
      const rect = container!.getBoundingClientRect()
      // Capped: ambient decoration, not photo output -- a 3x backing store on
      // a big monitor multiplies fill cost for an invisible difference.
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

      // Radar sweep first so the network draws over it.
      if (supportsRadar) {
        const cx = width * 0.82
        const cy = height * 0.22
        const radius = Math.max(width, height) * 0.8
        const sweep = ctx!.createConicGradient(radarAngle, cx, cy)
        sweep.addColorStop(0, `rgba(${rgb}, ${(0.22 * damp).toFixed(3)})`)
        sweep.addColorStop(0.06, `rgba(${rgb}, ${(0.07 * damp).toFixed(3)})`)
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

      // Node-to-node links. O(n^2) is fine at <=130 nodes -- the standard
      // constellation technique, not a novel perf risk.
      ctx!.lineWidth = 1
      const linkAlpha = tuning.linkAlpha * damp
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]
          const b = nodes[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < tuning.linkDist) {
            const alpha = (1 - dist / tuning.linkDist) * linkAlpha
            ctx!.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`
            ctx!.beginPath()
            ctx!.moveTo(a.x, a.y)
            ctx!.lineTo(b.x, b.y)
            ctx!.stroke()
          }
        }
      }

      // Cursor links (hero): the field notices the visitor -- nodes near the
      // pointer reach toward it, brighter than node-to-node links.
      if (tuning.cursor && mouse) {
        const reach = tuning.linkDist * 1.35
        ctx!.lineWidth = 1.2
        for (const n of nodes) {
          const dx = n.x - mouse.x
          const dy = n.y - mouse.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < reach) {
            const alpha = (1 - dist / reach) * linkAlpha * 1.8
            ctx!.strokeStyle = `rgba(${rgb}, ${Math.min(alpha, 0.6).toFixed(3)})`
            ctx!.beginPath()
            ctx!.moveTo(n.x, n.y)
            ctx!.lineTo(mouse.x, mouse.y)
            ctx!.stroke()
          }
        }
        ctx!.lineWidth = 1
      }

      // Nodes, with individual glow pulses (documents lighting up as they're
      // read) so the field never looks static even where links are sparse.
      if (tuning.glow) {
        ctx!.save()
        ctx!.shadowBlur = 10
        ctx!.shadowColor = `rgba(${rgb}, 0.8)`
      }
      const nodeAlpha = tuning.nodeAlpha * damp
      for (const n of nodes) {
        const glow = 0.55 + 0.45 * Math.sin(t / 1400 + n.pulse)
        ctx!.beginPath()
        ctx!.fillStyle = `rgba(${rgb}, ${(nodeAlpha * glow).toFixed(3)})`
        ctx!.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx!.fill()
      }
      if (tuning.glow) ctx!.restore()
    }

    function loop(t: number) {
      if (inView && tabVisible && (t - lastFrame >= frameBudgetMs)) {
        lastFrame = t
        drawFrame(t)
      }
      raf = requestAnimationFrame(loop)
    }

    resize()

    if (reduceMotion) {
      // One still frame, no loop -- honors reduced-motion exactly while still
      // giving the page its identity instead of a blank rect.
      drawFrame(0)
    } else {
      raf = requestAnimationFrame(loop)
    }

    const ro = new ResizeObserver(() => resize())
    ro.observe(container)

    // Pause off-screen instances and hidden tabs. Two independent flags (v1
    // collapsed them into one, which could wedge false after tab-hide because
    // the IntersectionObserver never refires without an intersection change).
    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
    })
    io.observe(canvas)
    const onVisibility = () => {
      tabVisible = document.visibilityState === 'visible'
    }
    document.addEventListener('visibilitychange', onVisibility)

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas!.getBoundingClientRect()
      mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const onMouseLeave = () => {
      mouse = null
    }
    if (tuning.cursor && !reduceMotion) {
      window.addEventListener('mousemove', onMouseMove, { passive: true })
      document.documentElement.addEventListener('mouseleave', onMouseLeave)
    }

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('mousemove', onMouseMove)
      document.documentElement.removeEventListener('mouseleave', onMouseLeave)
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
