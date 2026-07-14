// Token-coloured skeleton block with a shimmer sweep (Sprint 4.7). Replaces the
// scattered `animate-pulse bg-hairline` spans with one primitive that respects
// reduced-motion (the shimmer keyframe in globals.css is inside a
// prefers-reduced-motion: no-preference guard, so it goes static automatically).
export default function Skeleton({ className = '' }: { className?: string }) {
  return <span className={'skeleton block rounded-md ' + className} aria-hidden />
}
