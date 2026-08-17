/**
 * Data access: one configurable base URL, two interchangeable sources.
 *
 * `snapshot` (default) reads the committed `snapshot.json`, so the dashboard
 * runs with no backend process. `api` reads the live FastAPI endpoints. Both
 * resolve to the identical {@link Analytics} shape, so no component knows or
 * cares which one is in use.
 *
 * Configuration, in order of precedence:
 *   1. `?source=api|snapshot` in the URL (handy for demos)
 *   2. `VITE_DATA_SOURCE` / `VITE_API_BASE_URL` in `.env`
 *   3. Defaults: snapshot, `http://localhost:8000`
 */

import type { Analytics, DataSource, Snapshot } from './types'

const DEFAULT_API_BASE_URL = 'http://localhost:8000'

/** Endpoint paths, in the order they appear in the snapshot. */
const ROUTES = {
  health: '/health',
  holdings: '/holdings',
  summary: '/portfolio/summary',
  history: '/portfolio/history',
  returns: '/portfolio/returns',
  risk: '/portfolio/risk',
  montecarlo: '/portfolio/montecarlo',
} as const

export interface DataConfig {
  source: DataSource
  apiBaseUrl: string
  snapshotUrl: string
}

function readSourceOverride(): DataSource | null {
  if (typeof window === 'undefined') return null
  const requested = new URLSearchParams(window.location.search).get('source')
  return requested === 'api' || requested === 'snapshot' ? requested : null
}

/** Resolve the active configuration from URL params and build-time env. */
export function resolveConfig(): DataConfig {
  const envSource = import.meta.env.VITE_DATA_SOURCE as DataSource | undefined
  const source = readSourceOverride() ?? (envSource === 'api' ? 'api' : 'snapshot')

  return {
    source,
    apiBaseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? DEFAULT_API_BASE_URL,
    // BASE_URL keeps this correct when the app is served from a sub-path.
    snapshotUrl: `${import.meta.env.BASE_URL}snapshot.json`,
  }
}

/** Fetch JSON, turning any non-2xx or transport failure into a clear Error. */
async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new Error(`Could not reach ${url}. Is the backend running?`, { cause })
  }

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

/** Load every payload from the live API, in parallel. */
async function loadFromApi(baseUrl: string, signal?: AbortSignal): Promise<Analytics> {
  const base = baseUrl.replace(/\/$/, '')
  const [health, holdings, summary, history, returns, risk, montecarlo] = await Promise.all([
    fetchJson<Analytics['health']>(`${base}${ROUTES.health}`, signal),
    fetchJson<Analytics['holdings']>(`${base}${ROUTES.holdings}`, signal),
    fetchJson<Analytics['summary']>(`${base}${ROUTES.summary}`, signal),
    fetchJson<Analytics['history']>(`${base}${ROUTES.history}`, signal),
    fetchJson<Analytics['returns']>(`${base}${ROUTES.returns}`, signal),
    fetchJson<Analytics['risk']>(`${base}${ROUTES.risk}`, signal),
    fetchJson<Analytics['montecarlo']>(`${base}${ROUTES.montecarlo}`, signal),
  ])
  return { health, holdings, summary, history, returns, risk, montecarlo }
}

/** Load every payload from the committed snapshot. */
async function loadFromSnapshot(url: string, signal?: AbortSignal): Promise<Analytics> {
  const snapshot = await fetchJson<Snapshot>(url, signal)
  const endpoints = snapshot?.endpoints

  if (!endpoints?.[ROUTES.summary]) {
    throw new Error(
      `${url} is not a valid snapshot. Regenerate it with backend/generate_snapshot.py.`,
    )
  }

  return {
    health: endpoints[ROUTES.health],
    holdings: endpoints[ROUTES.holdings],
    summary: endpoints[ROUTES.summary],
    history: endpoints[ROUTES.history],
    returns: endpoints[ROUTES.returns],
    risk: endpoints[ROUTES.risk],
    montecarlo: endpoints[ROUTES.montecarlo],
  }
}

/** Load the full analytics set from whichever source is configured. */
export function loadAnalytics(config: DataConfig, signal?: AbortSignal): Promise<Analytics> {
  return config.source === 'api'
    ? loadFromApi(config.apiBaseUrl, signal)
    : loadFromSnapshot(config.snapshotUrl, signal)
}
