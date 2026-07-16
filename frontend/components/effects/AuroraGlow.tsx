// Aurora layer (dark cinematic hero, 2026-07-15): two huge blurred accent
// fields drifting on 28s/34s cycles -- the "animated background instead of a
// video" texture under the landing hero, per ui-ux-pro-max's Modern Dark
// Cinema spec (ambient light blobs, slow oscillation). Server component, zero
// JS: the motion is pure CSS keyframes (globals.css .aurora-a/.aurora-b),
// which also makes the reduced-motion story free -- the keyframes are inside
// a no-preference media query, so these become static glows automatically.
// Stays in the validated accent family (cyan at two alphas), no new hues.
export default function AuroraGlow({ className = '' }: { className?: string }) {
  // No filter: blur() here on purpose (2026-07-16): a radial-gradient is
  // already inherently soft, and large blur() filters are GPU-rasterized --
  // one of the first things to silently vanish on a broken/blocklisted
  // graphics driver (the exact environment where Clint saw a black void
  // while the same build painted fine in software rendering). Pure gradients
  // survive every rendering path.
  return (
    <div aria-hidden className={`pointer-events-none overflow-hidden ${className}`}>
      <div
        className="aurora-a absolute -top-[35%] left-[5%] h-[85%] w-[65%] rounded-full opacity-70"
        style={{
          background: 'radial-gradient(closest-side, rgba(34,184,212,0.15), rgba(34,184,212,0.05) 55%, transparent 75%)',
        }}
      />
      <div
        className="aurora-b absolute -bottom-[30%] right-[0%] h-[80%] w-[60%] rounded-full opacity-60"
        style={{
          background: 'radial-gradient(closest-side, rgba(34,184,212,0.10), rgba(34,184,212,0.04) 55%, transparent 75%)',
        }}
      />
    </div>
  )
}
