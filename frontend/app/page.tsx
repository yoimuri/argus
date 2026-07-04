import { redirect } from "next/navigation";

// proxy.ts already redirects unauthenticated visitors to /login before this
// ever runs, its matcher covers every route including root. So if this file
// executes at all, the visitor is already authenticated, send them straight
// to the dashboard instead of bouncing them through login again.
export default function Home() {
  redirect("/dashboard");
}
