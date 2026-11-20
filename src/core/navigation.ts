import { useEffect, useState } from "react"

/**
 * Hash routing: `#/projects?open=Name`. The path picks the screen (src/modules/registry.ts),
 * the query asks that screen to open one item (a project or skill sheet, an app card).
 * The hash is the only state, so a screen can also be opened from the command palette.
 */
export interface Route {
  path: string
  params: URLSearchParams
}

export function readRoute(hash = window.location.hash): Route {
  const raw = hash.replace(/^#/, "")
  const at = raw.indexOf("?")
  return {
    path: at < 0 ? raw : raw.slice(0, at),
    params: new URLSearchParams(at < 0 ? "" : raw.slice(at + 1)),
  }
}

/** Hash URL of a screen, with optional query parameters. */
export function routeHref(
  path: string,
  params?: Record<string, string>
): string {
  const query = new URLSearchParams(params).toString()
  return `#${path}${query ? `?${query}` : ""}`
}

/** Goes to a screen, replacing the query when none is given. */
export function navigate(path: string, params?: Record<string, string>): void {
  window.location.hash = routeHref(path, params).slice(1)
}

/** The current route, re-rendering the caller on hashchange. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => readRoute())
  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])
  return route
}
