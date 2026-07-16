// Aurora layer (dark cinematic hero, 2026-07-15): two huge blurred accent
// fields drifting on 28s/34s cycles -- the "animated background instead of a
// video" texture under the landing hero, per ui-ux-pro-max's Modern Dark
// Cinema spec (ambient light blobs, slow oscillation). Server component, zero
// JS: the motion is pure CSS keyframes (globals.css .aurora-a/.aurora-b),
// which also makes the reduced-motion story free -- the keyframes are inside
// a no-preference media query, so these become static glows automatically.
// Stays in the validated accent family (cyan at two alphas), no new hues.
export default function AuroraGlow({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none overflow-hidden ${className}`}>
      <div
        className="aurora-a absolute -top-[30%] left-[10%] h-[70%] w-[55%] rounded-full opacity-60"
        style={{
          background: 'radial-gradient(closest-side, rgba(34,184,212,0.16), transparent)',
          filter: 'blur(60px)',
        }}
      />
      <div
        className="aurora-b absolute -bottom-[25%] right-[5%] h-[65%] w-[50%] rounded-full opacity-50"
        style={{
          background: 'radial-gradient(closest-side, rgba(34,184,212,0.11), transparent)',
          filter: 'blur(70px)',
        }}
      />
    </div>
  )
}
