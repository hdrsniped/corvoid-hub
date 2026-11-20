import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { errorMessage } from "./errors"

export interface Loaded<T> {
  data: T | undefined
  error: string | null
  loading: boolean
  /** Runs the loader again. Shows the previous data until the new result arrives. */
  reload: () => void
}

/**
 * Runs an async loader on mount and whenever `deps` change or `reload` is called.
 * A failure is kept in `error` and also shown as a toast.
 */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []): Loaded<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    loader()
      .then((value) => {
        if (cancelled) return
        setData(value)
        setError(null)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const message = errorMessage(e)
        setError(message)
        toast.error(message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // The loader is re-created on each render; callers list what should trigger a reload in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps])

  const reload = useCallback(() => {
    setLoading(true)
    setTick((t) => t + 1)
  }, [])
  return { data, error, loading, reload }
}
