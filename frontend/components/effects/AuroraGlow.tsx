// Aurora layer (dark cinematic hero) -- v2 visibility pass (2026-07-17).
//
// These are the large drifting light-fields behind the node network: the
// "animated background instead of a video" texture Clint asked for. v1 sat at
// 0.10-0.15 opacity and, like the canvas, read as nothing on the live site.
// This pass brightens them and adds a third central bloom so the hero has real
// depth -- a light source the network is silhouetted against -- not a flat
// near-black rectangle. Still pure cyan (the validated accent family), still
// zero-JS CSS keyframes (globals.css .aurora-a/.aurora-b), so reduced-motion
// degrades to static glows for free.
//
// No filter: blur() on purpose: a radial-gradient is already inherently soft,
// and large blur() filters are GPU-rasterized -- one of the first things to
// silently vanish on a broken/blocklisted driver. Pure gradients survive every
// rendering path.
export default function AuroraGlow({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none overflow-hidden ${className}`}>
      {/* Top-left field */}
      <div
        className="aurora-a absolute -top-[30%] left-[0%] h-[90%] w-[70%] rounded-full opacity-90"
        style={{
          background:
            'radial-gradient(closest-side, rgba(34,184,212,0.30), rgba(34,184,212,0.10) 55%, transparent 76%)',
        }}
      />
      {/* Bottom-right field, brighter cyan tint */}
      <div
        className="aurora-b absolute -bottom-[25%] right-[-5%] h-[85%] w-[65%] rounded-full opacity-80"
        style={{
          background:
            'radial-gradient(closest-side, rgba(103,232,249,0.22), rgba(34,184,212,0.08) 55%, transparent 76%)',
        }}
      />
      {/* Central bloom -- a soft light the headline sits in front of, giving the
          hero a focal glow instead of even darkness. Drifts on the slower cycle. */}
      <div
        className="aurora-b absolute left-1/2 top-[15%] h-[70%] w-[55%] -translate-x-1/2 rounded-full opacity-70"
        style={{
          background:
            'radial-gradient(closest-side, rgba(34,184,212,0.16), transparent 70%)',
        }}
      />
    </div>
  )
}
