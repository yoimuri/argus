'use client'

import { useEffect, useRef } from 'react'
import { useTheme } from '@/components/theme/ThemeProvider'

// The signature animated background, v4 (two CHARACTERS, 2026-07-17).
//
// WHY v4: v3 made the network visible and split the themes by PARAMETERS
// (color, speed, link length). Clint's verdict was exactly right -- "light mode
// is just a re-colored network, not really serious vs relaxed." Turning knobs
// on the SAME visual machine can only ever make the same personality louder or
// quieter. Personality lives in BEHAVIOR -- how things move and connect -- not
// in color. So v4 gives the two themes genuinely different behavior:
//
//   DARK = "THE WATCHTOWER" (serious / surveillance). A system actively
//     watching data. STRAIGHT sharp links (circuit-like); a slow radar sweep
//     that, as it passes, snaps a faint TARGETING BRACKET onto a sparse subset
//     of nodes (lock-on -- the system identifying); and the occasional soft
//     DATA PULSE racing along a link (data being traced). Restrained on
//     purpose (Clint: "not too trying to steal the spotlight where
//     functionality should still be king") -- these are hero-only and subtle.
//
//   LIGHT = "THE READING ROOM" (relaxed / organic). Ideas gently finding each
//     other. CURVED soft links (bezier arcs, not rigid wire); every node
//     FLOATS on its own slow bob (like dust in a sunbeam); and the whole field
//     BREATHES -- a slow collective swell. No radar, no lock-on, nothing hunted.
//
// Same concept root (connected documents/facts), OPPOSITE temperament -- one
// scans and locks, the other drifts and breathes. That is a real personality
// fork, not a recolor, and it gives the theme toggle a reason to exist.
//
// Colors are hardcoded to match globals.css's accent tokens (canvas draws into
// its own pixel buffer with no live cascade). useTheme() picks the constants and
// re-runs the effect the instant the toggle flips; `theme` pins it for the
// permanently-dark brand surfaces (landing/login).
const ACCENT = { light: '45, 130, 150', dark: '34, 184, 212' } // r,g,b network base
// A second tint on a fraction of nodes / the lock-on + pulses so the field
// reads as living data. Light leans gentle teal-green; dark leans bright cyan.
const ACCENT_HI = { light: '90, 160, 165', dark: '103, 232, 249' }

// Per-theme personality. `character` selects the whole behavior set; the
// multipliers fine-tune within it.
//   character : 'watch' (dark surveillance) | 'drift' (light organic)
//   speedMul  : drift briskness (light slower/calmer)
//   linkMul   : link opacity scale
//   nodeMul   : node opacity scale
//   distMul   : link-distance scale (light > 1 = looser web)
//   rMul      : node-radius scale (light rounder/softer)
//   damp      : overall alpha scale
//   curved    : bezier-arc links (drift) vs straight (watch)
//   radar/lockOn/pulses : the dark WATCH signature behaviors (hero-only)
//   bob/breathe         : the light DRIFT signature behaviors (all tiers)
type Character = 'watch' | 'drift'
interface Persona {
  character: Character
  speedMul: number
  linkMul: number
  nodeMul: number
  distMul: number
  rMul: number
  damp: number
  curved: boolean
  radar: boolean
  lockOn: boolean
  pulses: boolean
  bob: boolean
  breathe: boolean
}
const PERSONALITY: Record<'light' | 'dark', Persona> = {
  dark: {
    character: 'watch',
    speedMul: 1, linkMul: 1, nodeMul: 1, distMul: 1, rMul: 1, damp: 1,
    curved: false, radar: true, lockOn: true, pulses: true, bob: false, breathe: false,
  },
  light: {
    character: 'drift',
    speedMul: 0.55, linkMul: 0.9, nodeMul: 0.95, distMul: 1.18, rMul: 1.25, damp: 0.95,
    curved: true, radar: false, lockOn: false, pulses: false, bob: true, breathe: true,
  },
}

export type BackgroundIntensity = 'hero' | 'app' | 'ambient'

interface Node {
  x: number // drift base position
  y: number
  vx: number
  vy: number
  rx: number // render position (drift base + float bob); links + nodes use this
  ry: number
  r: number
  pulse: number // glow phase offset so nodes don't pulse in lockstep
  hot: boolean // a fraction carry the brighter tint
  bobPhase: number // float-bob phase (drift character)
  bobAmp: number // float-bob amplitude px
  lockT: number // lock-on bracket decay timer 0..1 (watch character)
  trackable: boolean // only a sparse subset ever gets a lock-on bracket
}

// A data pulse: a bright dot travelling a→b along a currently-linked pair.
interface Pulse {
  a: number
  b: number
  t: number
  speed: number
}

const TAU = Math.PI * 2

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
  // Hero: the showpiece, but ATMOSPHERE not spotlight (Clint: "transparency
  // shouldn't be too high... not taking the spotlight too much, especially on
  // landing"). A rich-but-recessive field the headline clearly wins over,
  // paired with a deeper center scrim in page.tsx. The dark WATCH signature
  // behaviors (radar/lock-on/pulses) live only here.
  hero: {
    density: 7000, maxNodes: 135, linkDist: 170, speed: 0.14,
    nodeAlpha: 0.82, linkAlpha: 0.42, linkFloor: 0.22, nodeR: [1.2, 2.9],
    glowBlur: 14, radar: true, radarAlpha: 0.32, cursor: true, fps: 60,
  },
  // App: inner pages. Clearly a designed background, calmer than the hero and
  // WITHOUT the watch signature (no radar/lock-on/pulses) -- functionality is
  // king where real work happens. Light's drift character (curved/bob/breathe)
  // still applies here, so the dashboard in light feels genuinely relaxed.
  app: {
    density: 9000, maxNodes: 95, linkDist: 165, speed: 0.075,
    nodeAlpha: 0.85, linkAlpha: 0.45, linkFloor: 0.28, nodeR: [1.1, 2.4],
    glowBlur: 9, radar: false, radarAlpha: 0, cursor: false, fps: 40,
  },
  // Ambient: the quietest tier -- a hint of the field, no signature behaviors.
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
      their canvases must ignore the html-level theme too. */
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
    // Implemented the SAFE way -- a single scoped flag, NOT the global
    // `window.matchMedia = ...` mock some guides push (that stub answers "false"
    // to EVERY query and drops addEventListener, which would break the theme
    // system's own prefers-color-scheme reads). We only stop obeying
    // reduced-motion for THIS canvas. Guardrail: the field is deliberately
    // gentle (slow drift, shallow pulse, no flashing) so "always on" is never a
    // seizure/vestibular hazard. renderStatic() stays as a fallback.
    const FORCE_MOTION = true
    const reduceMotion = FORCE_MOTION
      ? false
      : window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const tuning = TUNING[intensity]
    const persona = PERSONALITY[resolvedTheme]
    const rgb = ACCENT[resolvedTheme]
    const rgbHi = ACCENT_HI[resolvedTheme]
    const damp = persona.damp
    const linkDist = tuning.linkDist * persona.distMul
    const speedMul = persona.speedMul

    // The WATCH signature behaviors are hero-only AND dark-only (persona flags).
    // createConicGradient isn't universal (older Safari) -- an unguarded call
    // throws on the first frame and would kill the rAF loop.
    const isHero = intensity === 'hero'
    const doRadar =
      isHero && persona.radar && typeof ctx.createConicGradient === 'function'
    const doLock = isHero && persona.lockOn
    const doPulse = isHero && persona.pulses

    let nodes: Node[] = []
    let pulses: Pulse[] = []
    let pulseCooldown = 60 // frames until the first pulse may spawn
    let width = 0
    let height = 0
    let dpr = 1
    let raf = 0
    let radarAngle = 0
    let inView = true
    let tabVisible = document.visibilityState === 'visible'
    let lastFrame = 0
    const frameBudgetMs = tuning.fps >= 60 ? 0 : 1000 / tuning.fps
    let mouse: { x: number; y: number } | null = null

    function seed() {
      const area = width * height
      const count = Math.min(tuning.maxNodes, Math.max(12, Math.round(area / tuning.density)))
      const [rMin, rMax] = tuning.nodeR
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * tuning.speed * speedMul,
        vy: (Math.random() - 0.5) * tuning.speed * speedMul,
        rx: 0,
        ry: 0,
        r: (rMin + Math.random() * (rMax - rMin)) * persona.rMul,
        pulse: Math.random() * TAU,
        hot: Math.random() < 0.28,
        bobPhase: Math.random() * TAU,
        bobAmp: 3 + Math.random() * 6, // 3-9px gentle float
        lockT: 0,
        trackable: Math.random() < 0.3, // only ~30% ever lock-on (restraint)
      }))
      pulses = []
    }

    function resize() {
      const rect = container!.getBoundingClientRect()
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

    // Radar sweep (dark watch). Also ARMS lock-on: as the bright edge passes a
    // trackable node's angle, that node's bracket timer is set to 1.
    function drawRadar(cx: number, cy: number) {
      const radius = Math.max(width, height) * 0.9
      const sweep = ctx!.createConicGradient(radarAngle, cx, cy)
      sweep.addColorStop(0, `rgba(${rgb}, ${(tuning.radarAlpha * damp).toFixed(3)})`)
      sweep.addColorStop(0.05, `rgba(${rgb}, ${(tuning.radarAlpha * 0.35 * damp).toFixed(3)})`)
      sweep.addColorStop(0.14, 'rgba(0,0,0,0)')
      sweep.addColorStop(1, 'rgba(0,0,0,0)')
      ctx!.save()
      ctx!.beginPath()
      ctx!.arc(cx, cy, radius, 0, TAU)
      ctx!.fillStyle = sweep
      ctx!.fill()
      ctx!.restore()
      radarAngle = (radarAngle + 0.004) % TAU
    }

    // A small targeting bracket around a node, alpha driven by its lock timer.
    // Corners only (a reticle, not a filled box) so it reads as "identified,"
    // subtle. rgbHi so it's a highlight; capped low so it never shouts.
    function drawLockBracket(n: Node) {
      const a = n.lockT * 0.5 * damp // subtle ceiling
      if (a <= 0.01) return
      const s = n.r + 6 + (1 - n.lockT) * 4 // contracts slightly as it locks
      const arm = s * 0.5
      const x = n.rx
      const y = n.ry
      ctx!.strokeStyle = `rgba(${rgbHi}, ${a.toFixed(3)})`
      ctx!.lineWidth = 1
      ctx!.beginPath()
      // top-left
      ctx!.moveTo(x - s, y - s + arm); ctx!.lineTo(x - s, y - s); ctx!.lineTo(x - s + arm, y - s)
      // top-right
      ctx!.moveTo(x + s - arm, y - s); ctx!.lineTo(x + s, y - s); ctx!.lineTo(x + s, y - s + arm)
      // bottom-right
      ctx!.moveTo(x + s, y + s - arm); ctx!.lineTo(x + s, y + s); ctx!.lineTo(x + s - arm, y + s)
      // bottom-left
      ctx!.moveTo(x - s + arm, y + s); ctx!.lineTo(x - s, y + s); ctx!.lineTo(x - s, y + s - arm)
      ctx!.stroke()
    }

    function spawnPulse() {
      // Pick a random node that has at least one neighbour within linkDist, then
      // send a pulse to that neighbour. Data being traced through the network.
      const start = Math.floor(Math.random() * nodes.length)
      const a = nodes[start]
      if (!a) return
      const candidates: number[] = []
      for (let k = 0; k < nodes.length; k++) {
        if (k === start) continue
        const b = nodes[k]
        const dx = a.rx - b.rx
        const dy = a.ry - b.ry
        if (dx * dx + dy * dy < linkDist * linkDist) candidates.push(k)
      }
      if (!candidates.length) return
      const b = candidates[Math.floor(Math.random() * candidates.length)]
      pulses.push({ a: start, b, t: 0, speed: 0.012 + Math.random() * 0.01 })
    }

    function drawPulses() {
      if (pulseCooldown > 0) pulseCooldown--
      // Spawn sparingly and cap concurrency -- atmosphere, not a light show.
      if (pulseCooldown === 0 && pulses.length < 4) {
        spawnPulse()
        pulseCooldown = 70 + Math.floor(Math.random() * 60)
      }
      ctx!.save()
      ctx!.shadowBlur = 8
      ctx!.shadowColor = `rgba(${rgbHi}, 0.8)`
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i]
        p.t += p.speed
        const a = nodes[p.a]
        const b = nodes[p.b]
        if (!a || !b || p.t >= 1) { pulses.splice(i, 1); continue }
        const x = a.rx + (b.rx - a.rx) * p.t
        const y = a.ry + (b.ry - a.ry) * p.t
        // fade in and out over the trip so it never pops
        const edge = Math.sin(p.t * Math.PI)
        ctx!.beginPath()
        ctx!.fillStyle = `rgba(${rgbHi}, ${(0.85 * edge * damp).toFixed(3)})`
        ctx!.arc(x, y, 1.8, 0, TAU)
        ctx!.fill()
      }
      ctx!.restore()
    }

    function drawFrame(t: number) {
      ctx!.clearRect(0, 0, width, height)

      const cx = width * 0.82
      const cy = height * 0.2
      if (doRadar) drawRadar(cx, cy)

      // Update drift + compute render positions (rx/ry). In the DRIFT character
      // each node floats on its own slow bob; in WATCH rx/ry == x/y.
      const bob = persona.bob && !reduceMotion
      for (const n of nodes) {
        n.x += n.vx
        n.y += n.vy
        if (n.x < -20) n.x = width + 20
        if (n.x > width + 20) n.x = -20
        if (n.y < -20) n.y = height + 20
        if (n.y > height + 20) n.y = -20
        if (bob) {
          n.rx = n.x + Math.sin(t * 0.0006 + n.bobPhase) * n.bobAmp
          n.ry = n.y + Math.cos(t * 0.00052 + n.bobPhase) * n.bobAmp
        } else {
          n.rx = n.x
          n.ry = n.y
        }
      }

      // Lock-on arming (watch): when the sweep's bright edge (radarAngle) passes
      // a trackable node's angle, arm its bracket. The lockT<0.05 guard makes it
      // fire once per pass, then decay.
      if (doLock) {
        for (const n of nodes) {
          if (!n.trackable) continue
          const ang = Math.atan2(n.ry - cy, n.rx - cx)
          let da = radarAngle - ang
          da -= Math.floor(da / TAU) * TAU // normalize [0, TAU)
          if (da < 0.08 && n.lockT < 0.05) n.lockT = 1
          if (n.lockT > 0) n.lockT *= 0.97 // slow decay
        }
      }

      // Links. WATCH = straight sharp wire; DRIFT = curved bezier arcs. Both
      // keep the v3 visibility floor (a drawn link never fades to 0).
      ctx!.lineWidth = persona.curved ? 1.25 : 1.1
      const linkAlpha = tuning.linkAlpha * damp * persona.linkMul
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]
          const b = nodes[j]
          const dx = a.rx - b.rx
          const dy = a.ry - b.ry
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < linkDist) {
            const prox = 1 - dist / linkDist
            const scale = tuning.linkFloor + (1 - tuning.linkFloor) * prox
            ctx!.strokeStyle = `rgba(${rgb}, ${(scale * linkAlpha).toFixed(3)})`
            ctx!.beginPath()
            ctx!.moveTo(a.rx, a.ry)
            if (persona.curved) {
              // Bow the link out perpendicular to its midpoint -- a soft arc, not
              // rigid wire. Alternate the bow direction so the web looks woven.
              const mx = (a.rx + b.rx) / 2
              const my = (a.ry + b.ry) / 2
              const px = -dy
              const py = dx
              const plen = Math.hypot(px, py) || 1
              const bow = dist * 0.14 * (((i + j) & 1) ? 1 : -1)
              ctx!.quadraticCurveTo(mx + (px / plen) * bow, my + (py / plen) * bow, b.rx, b.ry)
            } else {
              ctx!.lineTo(b.rx, b.ry)
            }
            ctx!.stroke()
          }
        }
      }

      // Cursor links (hero/dark): the field reaches toward the visitor.
      if (tuning.cursor && mouse) {
        const reach = linkDist * 1.4
        ctx!.lineWidth = 1.4
        for (const n of nodes) {
          const dx = n.rx - mouse.x
          const dy = n.ry - mouse.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < reach) {
            const alpha = (1 - dist / reach) * linkAlpha * 2
            ctx!.strokeStyle = `rgba(${rgbHi}, ${Math.min(alpha, 0.75).toFixed(3)})`
            ctx!.beginPath()
            ctx!.moveTo(n.rx, n.ry)
            ctx!.lineTo(mouse.x, mouse.y)
            ctx!.stroke()
          }
        }
        ctx!.lineWidth = persona.curved ? 1.25 : 1.1
      }

      // Data pulses (watch) draw over the links they trace.
      if (doPulse && !reduceMotion) drawPulses()

      // Nodes. DRIFT adds a slow collective BREATHE (whole field swells softly);
      // WATCH keeps a sharper individual pulse.
      const breath = persona.breathe ? 1 + Math.sin(t * 0.0004) * 0.06 : 1
      const glowOn = tuning.glowBlur > 0
      if (glowOn) {
        ctx!.save()
        ctx!.shadowBlur = tuning.glowBlur
      }
      const nodeAlpha = tuning.nodeAlpha * damp * persona.nodeMul * breath
      for (const n of nodes) {
        const pulse =
          persona.character === 'drift'
            ? 0.72 + 0.28 * Math.sin(t / 1700 + n.pulse) // gentle breathing glow
            : 0.6 + 0.4 * Math.sin(t / 1300 + n.pulse) // sharper sensor pulse
        const col = n.hot ? rgbHi : rgb
        const a = Math.min(nodeAlpha * pulse, 1)
        if (glowOn) ctx!.shadowColor = `rgba(${col}, ${(a * 0.9).toFixed(3)})`
        ctx!.beginPath()
        ctx!.fillStyle = `rgba(${col}, ${a.toFixed(3)})`
        ctx!.arc(n.rx, n.ry, n.r * breath, 0, TAU)
        ctx!.fill()
      }
      if (glowOn) ctx!.restore()

      // Lock-on brackets last, over everything, but subtle (watch).
      if (doLock) {
        for (const n of nodes) if (n.trackable && n.lockT > 0) drawLockBracket(n)
      }
    }

    // Static render for reduced-motion (fallback while FORCE_MOTION is on): draw
    // once at a flattering phase; re-seed defensively if the canvas had no area.
    function renderStatic() {
      if (width < 2 || height < 2) return
      if (nodes.length === 0) seed()
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
      renderStatic()
    } else {
      raf = requestAnimationFrame(loop)
    }

    const ro = new ResizeObserver(() => {
      resize()
      if (reduceMotion) renderStatic()
    })
    ro.observe(container)

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
