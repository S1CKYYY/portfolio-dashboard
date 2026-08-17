/**
 * Loads the analytics payloads once on mount and exposes a reload action.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { loadAnalytics, resolveConfig, type DataConfig } from './api'
import type { Analytics } from './types'

export interface AnalyticsState {
  data: Analytics | null
  error: Error | null
  loading: boolean
  config: DataConfig
  reload: () => void
}

export function useAnalytics(): AnalyticsState {
  const config = useMemo(resolveConfig, [])
  const [data, setData] = useState<Analytics | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)

  // Guards against a slow in-flight request resolving after a newer one.
  const requestId = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    const id = ++requestId.current

    setLoading(true)
    setError(null)

    loadAnalytics(config, controller.signal)
      .then((payload) => {
        if (id !== requestId.current) return
        setData(payload)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || id !== requestId.current) return
        setError(cause instanceof Error ? cause : new Error(String(cause)))
        setLoading(false)
      })

    return () => controller.abort()
  }, [config, attempt])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  return { data, error, loading, config, reload }
}
