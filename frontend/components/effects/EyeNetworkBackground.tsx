'use client'

import { useEffect, useRef } from 'react'
import { useTheme } from '@/components/theme/ThemeProvider'

// The signature animated background, v3 (visibility rebuild, 2026-07-17).
//
// WHY v3: v2 deployed correctly and ran on the live site -- but a live-render
// audit measured the hero canvas at avg alpha 19/255 (~7%). 319k pixels were
// being painted at a whisper, so Clint's verdict "same old simple color / NO
// CHANGES" was ACCURATE design feedback, not a bug report: the network was
// there and technically invisible. The failure was link alpha fading linearly
// to ~0 with distance (most links rendered near-transparent) plus alphas tuned
// for politeness. v3 fixes the actual defect: bright links with a visibility
// FLOOR (a link is either clearly drawn or not drawn), larger glowing nodes,
// and three intensity tiers so each surface gets the right loudness --
//   hero    : the public showcase, unmistakable in one second (Clint: "big and
//             cinematic, like Valorant's landing")
//   app     : inner app pages -- present and designed, but calm enough not to
//             fight working content (Clint: "tame but still appealing to
//             non-tech users, not too flashy everywhere")
//   ambient : the quietest fallback (kept for any surface that wants a hint)
//
// The concept is still the product: ARGUS is the hundred-eyed watchman -- a
// field of glowing nodes (documents/facts) drifts and links when close (what
// the Retriever/Synthesizer do), a radar sweep crosses the hero (the SOC half),
// and on the hero the network reaches toward the cursor (the watchman looking
// back).
//
// TWO PERSONALITIES (Clint, 2026-07-17 -- gives the theme toggle a reason to
// exist beyond eye comfort):
//   DARK  = SERIOUS. The SOC/watchman mood: tight, sharp, taut links, a tense
//           radar sweep, brisk drift. "The system is watching."
//   LIGHT = RELAXED. Same node-network MOTIF, opposite temperament: softer
//           warmer nodes, slow loose drift, more breathing room between links,
//           no radar. Airy and human. "The system is at ease."
// This is NOT a damped copy of the dark field (v2/v3's mistake) -- the light
// theme reshapes the tuning through PERSONALITY below, so it has its own feel.
//
// Colors are hardcoded to match globals.css's accent tokens (canvas draws into
// its own pixel buffer with no live cascade). useTheme() picks the constants and
// re-runs the effect the instant the toggle flips; `theme` pins it for the
// permanently-dark brand surfaces (landing/login).
//
// Light network color: a SOFTER, slightly warmer teal than the token accent
// (#0e7490 is a bit clinical for the "relaxed" mood) -- lines read as calm
// pencil strokes on paper, not sharp cyan wire. Dark keeps the bright cyan.
const ACCENT = { light: '45, 130, 150', dark: '34, 184, 212' } // r,g,b network base
// A second tint on a fraction of nodes so the field reads as living data, not
// one flat color. Light leans gentle teal-green (relaxed); dark leans bright.
const ACCENT_HI = { light: '90, 160, 165', dark: '103, 232, 249' }

// Per-theme personality: multipliers/overrides applied on top of the intensity
// TUNING so each theme feels different, not just lighter/darker.
//   speedMul  : how briskly nodes drift (light = slower, calmer)
//   linkMul   : link opacity scale (light lines are quiet on white)
//   nodeMul   : node opacity scale
//   distMul   : link-distance scale (light > 1 = looser, more open web)
//   rMul      : node-radius scale (light = a touch larger/rounder/softer)
//   radar     : whether the radar sweep runs at all (light = never; too tense)
//   damp      : legacy overall alpha scale kept for fine control
const PERSONALITY = {
  dark:  { speedMul: 1,    linkMul: 1,    nodeMul: 1,    distMul: 1,    rMul: 1,   radar: true,  damp: 1 },
  light: { speedMul: 0.6,  linkMul: 0.85, nodeMul: 0.9,  distMul: 1.18, rMul: 1.2, radar: false, damp: 0.9 },
} as const

export type BackgroundIntensity = 'hero' | 'app' | 'ambient'

interface Node {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  pulse: number // phase offset so nodes don't glow in lockstep
  hot: boolean // a fraction glow with the brighter tint
}

const TUNING: Record<BackgroundIntensity, {
  density: number // px^2 of canvas area per node, lower = denser
  maxNodes: number
  linkDist: number
  speed: number
  nodeAlpha: number
  linkAlpha: number // link alpha at CLOSEST range (falls to linkFloor at max range, not to 0)
  linkFloor: number // minimum multiplier a drawn link keeps -- kills the fade-to-invisible defect
  nodeR: [number, number] // node radius range
  glowBlur: number // shadowBlur px; 0 = no glow
  radar: boolean
  radarAlpha: number
  cursor: boolean
  fps: number
}> = {
  // Hero: the showpiece, but ATMOSPHERE not spotlight (Clint, 2026-07-17: "the
  // transparency shouldn't be too high so it's not taking the spotlight too
  // much, especially on landing"). Dialed back from the earlier loud pass
  // (nodeAlpha 1 / linkAlpha 0.7) to a rich-but-recessive field the headline
  // clearly wins over -- paired with a deeper center scrim in page.tsx. Still
  // well above the old 7% faint failure; the radial scrim carves the calm
  // pocket where the text sits.
  hero: {
    density: 7000, maxNodes: 135, linkDist: 170, speed: 0.14,
    nodeAlpha: 0.82, linkAlpha: 0.42, linkFloor: 0.22, nodeR: [1.2, 2.9],
    glowBlur: 14, radar: true, radarAlpha: 0.34, cursor: true, fps: 60,
  },
  // App: inner pages. Clearly a designed background, calmer than the hero --
  // fewer nodes, softer links, a gentle glow, no radar/cursor chase, throttled
  // framerate since it runs alongside real work.
  app: {
    density: 9000, maxNodes: 95, linkDist: 165, speed: 0.075,
    nodeAlpha: 0.85, linkAlpha: 0.45, linkFloor: 0.28, nodeR: [1.1, 2.4],
    glowBlur: 9, radar: false, radarAlpha: 0, cursor: false, fps: 40,
  },
  // Ambient: the quietest tier -- a hint of the same field. Kept for any
  // surface that wants presence without drawing the eye at all.
  ambient: {
    density: 12000, maxNodes: 70, linkDist: 150, speed: 0.06,
    nodeAlpha: 0.7, linkAlpha: 0.32, linkFloor: 0.3, nodeR: [1, 2],
    glowBlur: 0, radar: false, radarAlpha: 0, cursor: false, fps: 30,
  },
}

export default function EyeNetworkBackground({
  intensity = 'ambient',
  className = '',
  theme,
}: {
  intensity?: BackgroundIntensity
  className?: string
  /** Pin the palette regardless of the app toggle. The landing/login are
      permanently cinematic (their subtree carries data-theme="dark"), so
      their canvases must ignore the html-level theme too -- otherwise a
      light-pref visitor gets the damped light tuning on a dark stage. */
  theme?: 'light' | 'dark'
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { resolvedTheme: appTheme } = useTheme()
  const resolvedTheme = theme ?? appTheme

  useEffect(() => {
    const canvas = canvasRef.current
    const container = canvas?.parentElement
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Motion policy (Clint's decision, 2026-07-17): the animation plays for
    // EVERYONE, the same design regardless of the OS reduced-motion setting.
    // Rationale he reached: the site should look identical for all users, and a
    // reduced-motion visitor seeing a different/static version = seeing a
    // lesser page. So we do NOT gate on prefers-reduced-motion here.
    //
    // Implemented the SAFE way -- a single scoped flag, NOT the global
    // `window.matchMedia = ...` mock that some guides suggest (that stub reports
    // "false" for EVERY query and drops addEventListener, which would break the
    // theme system's own (prefers-color-scheme) reads and throw where we call
    // mql.addEventListener). We only stop obeying reduced-motion for THIS
    // canvas; everything else still respects the user's real preferences.
    //
    // The one guardrail kept for forcing motion on people who asked it off: the
    // field is deliberately GENTLE -- slow drift, shallow slow pulse, no
    // flashing/strobing -- so "always on" never becomes a seizure/vestibular
    // hazard, only ambient movement.
    const FORCE_MOTION = true
    const reduceMotion = FORCE_MOTION
      ? false
      : window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const tuning = TUNING[intensity]
    const persona = PERSONALITY[resolvedTheme]
    const rgb = ACCENT[resolvedTheme]
    const rgbHi = ACCENT_HI[resolvedTheme]
    // Overall alpha scale. Glow-on-white has a physical ceiling (the same alphas
    // that sing on the dark base turn to mud on paper), so the relaxed light
    // personality carries its own damp -- but the whole point of PERSONALITY is
    // that light is a DIFFERENT field, not just a quieter one.
    const damp = persona.damp
    // Effective tuning after the theme personality reshapes it.
    const linkDist = tuning.linkDist * persona.distMul
    const speedMul = persona.speedMul
    // createConicGradient isn't universal (older Safari); an unguarded call
    // throws on first frame and would silently kill the whole rAF loop. Light
    // never runs the radar at all (persona.radar=false) -- it's too tense for
    // the relaxed mood; the dark "serious" field keeps it.
    const supportsRadar =
      tuning.radar && persona.radar && typeof ctx.createConicGradient === 'function'

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
      const count = Math.min(tuning.maxNodes, Math.max(12, Math.round(area / tuning.density)))
      const [rMin, rMax] = tuning.nodeR
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        // speedMul: light drifts slower (relaxed), dark brisker (serious).
        vx: (Math.random() - 0.5) * tuning.speed * speedMul,
        vy: (Math.random() - 0.5) * tuning.speed * speedMul,
        // rMul: light nodes a touch larger/rounder/softer.
        r: (rMin + Math.random() * (rMax - rMin)) * persona.rMul,
        pulse: Math.random() * Math.PI * 2,
        hot: Math.random() < 0.28, // ~a quarter carry the brighter tint
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

      // Radar sweep first so the network draws over it. Brighter in v3 --
      // meant to be seen glinting across the hero, not guessed at.
      if (supportsRadar) {
        const cx = width * 0.82
        const cy = height * 0.2
        const radius = Math.max(width, height) * 0.9
        const sweep = ctx!.createConicGradient(radarAngle, cx, cy)
        sweep.addColorStop(0, `rgba(${rgb}, ${(tuning.radarAlpha * damp).toFixed(3)})`)
        sweep.addColorStop(0.05, `rgba(${rgb}, ${(tuning.radarAlpha * 0.35 * damp).toFixed(3)})`)
        sweep.addColorStop(0.14, 'rgba(0,0,0,0)')
        sweep.addColorStop(1, 'rgba(0,0,0,0)')
        ctx!.save()
        ctx!.beginPath()
        ctx!.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx!.fillStyle = sweep
        ctx!.fill()
        ctx!.restore()
        radarAngle += 0.004
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

      // Node-to-node links. O(n^2) is fine at <=150 nodes -- the standard
      // constellation technique. THE v3 FIX: proximity scales the alpha
      // between linkFloor and 1, never to 0. A link that's drawn at all stays
      // visible; that single change is what lifts the field out of the 7%
      // whisper that read as "no animation".
      // Light links are a hair thicker so they read as soft pencil strokes on
      // paper rather than thin sharp wire (part of the "relaxed" feel).
      ctx!.lineWidth = resolvedTheme === 'light' ? 1.25 : 1.1
      const linkAlpha = tuning.linkAlpha * damp * persona.linkMul
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]
          const b = nodes[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < linkDist) {
            const prox = 1 - dist / linkDist // 1 = touching, 0 = at max range
            const scale = tuning.linkFloor + (1 - tuning.linkFloor) * prox
            const alpha = scale * linkAlpha
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
        const reach = linkDist * 1.4
        ctx!.lineWidth = 1.4
        for (const n of nodes) {
          const dx = n.x - mouse.x
          const dy = n.y - mouse.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < reach) {
            const alpha = (1 - dist / reach) * linkAlpha * 2
            ctx!.strokeStyle = `rgba(${rgbHi}, ${Math.min(alpha, 0.75).toFixed(3)})`
            ctx!.beginPath()
            ctx!.moveTo(n.x, n.y)
            ctx!.lineTo(mouse.x, mouse.y)
            ctx!.stroke()
          }
        }
        ctx!.lineWidth = 1.1
      }

      // Nodes, with individual glow pulses (documents lighting up as they're
      // read) so the field never looks static even where links are sparse. A
      // fraction wear the brighter tint. Glow via shadowBlur when the tier
      // asks for it -- this is most of the hero's "cinematic" read.
      const glowOn = tuning.glowBlur > 0
      if (glowOn) {
        ctx!.save()
        ctx!.shadowBlur = tuning.glowBlur
      }
      const nodeAlpha = tuning.nodeAlpha * damp * persona.nodeMul
      for (const n of nodes) {
        // Light pulses more gently (shallower swing) -- the relaxed field
        // breathes rather than blinks; dark keeps the sharper serious pulse.
        const pulse =
          resolvedTheme === 'light'
            ? 0.72 + 0.28 * Math.sin(t / 1700 + n.pulse)
            : 0.6 + 0.4 * Math.sin(t / 1300 + n.pulse)
        const col = n.hot ? rgbHi : rgb
        const a = Math.min(nodeAlpha * pulse, 1)
        if (glowOn) ctx!.shadowColor = `rgba(${col}, ${(a * 0.9).toFixed(3)})`
        ctx!.beginPath()
        ctx!.fillStyle = `rgba(${col}, ${a.toFixed(3)})`
        ctx!.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx!.fill()
      }
      if (glowOn) ctx!.restore()
    }

    // Static render for reduced-motion: draw the network once at a flattering
    // fixed phase (t chosen so the sine pulse sits near its bright peak, not a
    // dim trough). Re-seeds defensively if the canvas had no area when first
    // seeded, so a late layout (0-height-then-real-height hero) still fills.
    function renderStatic() {
      if (width < 2 || height < 2) return
      if (nodes.length === 0) seed()
      // t = 700 -> sin(700/1300 + phase) lands most nodes near full brightness.
      drawFrame(700)
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
      // Reduced motion: draw the full network as a STATIC frame (no rAF loop) --
      // "no motion" must not mean "no design"; a visitor with the OS
      // reduced-motion setting on still gets the constellation, just still.
      //
      // THE 2026-07-17 BUG (found live): this used to call drawFrame(0) exactly
      // once, right after resize(). On the hero, the flex/min-h-[92vh] container
      // often has ZERO height at that first tick, so seed() made nodes into a
      // 0-area canvas and the one static frame painted nothing -- a permanently
      // blank canvas for EVERYONE whose OS reports reduced motion (every browser
      // on that machine, which is why it read as "no changes anywhere"). The fix
      // is to redraw the static frame whenever layout settles, via the same
      // ResizeObserver the animated path uses -- so once the hero has real
      // height, the network appears.
      renderStatic()
    } else {
      raf = requestAnimationFrame(loop)
    }

    const ro = new ResizeObserver(() => {
      resize()
      // In the static (reduced-motion) case there is no loop to repaint after a
      // re-seed, so the observer must do it. Without this the canvas stays blank
      // until an animation frame that never comes.
      if (reduceMotion) renderStatic()
    })
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
