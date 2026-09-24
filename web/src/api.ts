import {
  mockDiscovered,
  mockFleet,
  mockNeedsYou,
  mockOutput,
  mockPostures,
  mockQueue,
  mockSnapshots,
} from './mock/fixtures'
import type {
  ActionResult,
  DiscoveredSession,
  NeedsYouResponse,
  QueueDetail,
  QueueItem,
  QueueState,
  Rig,
  RigPosture,
  SeatModel,
  Snapshot,
} from './types'

const mockMode = import.meta.env.VITE_MOCK === '1'

async function dashboardFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const body: unknown = await response.json().catch(() => null)
  const message =
    body && typeof body === 'object' && 'error' in body
      ? String(body.error)
      : body && typeof body === 'object' && 'message' in body
        ? String(body.message)
        : `Request failed (${response.status})`
  if (!response.ok || (body && typeof body === 'object' && 'error' in body)) throw new Error(message)
  return body as T
}

export async function getFleet(): Promise<Rig[]> {
  return mockMode ? mockFleet : dashboardFetch<Rig[]>('/dash/fleet')
}

export async function getNeedsYou(): Promise<NeedsYouResponse> {
  return mockMode ? mockNeedsYou : dashboardFetch<NeedsYouResponse>('/dash/needs-you')
}

export async function getSeatOutput(session: string): Promise<string> {
  if (mockMode) return `${mockOutput}\nSeat: ${session}\n`
  const data = await dashboardFetch<{ text: string }>(
    `/dash/seats/${encodeURIComponent(session)}/output?lines=200`,
  )
  return data.text
}

export async function sendSeatMessage(
  session: string,
  text: string,
): Promise<{ ok: boolean; warning?: string; error?: string }> {
  if (mockMode) return { ok: true }
  return dashboardFetch(`/dash/seats/${encodeURIComponent(session)}/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

export function isMockMode() {
  return mockMode
}

export function subscribeToInvalidations(
  onInvalidate: (scope: 'fleet' | 'needs-you' | 'queue') => void,
  onError: (message: string) => void,
): () => void {
  if (mockMode) {
    const timer = window.setInterval(() => onInvalidate('fleet'), 30_000)
    return () => window.clearInterval(timer)
  }
  const source = new EventSource('/dash/events')
  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as { scope?: 'fleet' | 'needs-you' | 'queue' }
      if (payload.scope === 'fleet' || payload.scope === 'needs-you' || payload.scope === 'queue')
        onInvalidate(payload.scope)
      else onError('Connection interrupted; reconnecting…')
    } catch {
      onError('Connection interrupted; reconnecting…')
    }
  }
  source.onerror = () => onError('Connection interrupted; reconnecting…')
  return () => source.close()
}

export interface QueueFilters {
  rig?: string
  session?: string
  state?: string[]
  activeOnly?: boolean
  limit?: number
}

export async function getQueue(filters: QueueFilters = {}): Promise<{ items: QueueItem[] }> {
  if (mockMode) {
    const items = mockQueue.filter((item) => {
      const matchesRig = !filters.rig || item.destinationSession.endsWith(`@${filters.rig}`)
      const matchesSession = !filters.session || item.destinationSession === filters.session
      const matchesState = !filters.state?.length || filters.state.includes(item.state)
      return matchesRig && matchesSession && matchesState
    })
    return { items: items.slice(0, filters.limit ?? items.length) }
  }
  const params = new URLSearchParams()
  if (filters.rig) params.set('rig', filters.rig)
  if (filters.session) params.set('session', filters.session)
  if (filters.state?.length) params.set('state', filters.state.join(','))
  if (filters.activeOnly) params.set('activeOnly', '1')
  if (filters.limit) params.set('limit', String(filters.limit))
  return dashboardFetch<{ items: QueueItem[] }>(`/dash/queue?${params}`)
}

export async function getQueueDetail(qitemId: string): Promise<QueueDetail> {
  if (mockMode) {
    const item = mockQueue.find((candidate) => candidate.qitemId === qitemId)
    if (!item) throw new Error('Task not found')
    return item
  }
  return dashboardFetch<QueueDetail>(`/dash/queue/${encodeURIComponent(qitemId)}`)
}

export async function createQueue(input: {
  destinationSession: string
  body: string
  priority?: string
  tags?: string[]
  summary?: string
  evidenceRef?: string
}): Promise<QueueItem> {
  if (mockMode) {
    const humanDestination =
      /^human(?:-[^@]+)?@(kernel|host)$/.test(input.destinationSession) ||
      input.destinationSession.endsWith('@external')
    if (humanDestination && (!input.summary?.trim() || !input.evidenceRef?.trim()))
      throw new Error('summary and evidenceRef are required for human-routed tasks')
    const now = new Date().toISOString()
    const item: QueueDetail = {
      qitemId: `qitem-mock-${Date.now()}`,
      state: 'pending',
      priority: input.priority ?? null,
      tier: null,
      sourceSession: 'operator@dashboard',
      destinationSession: input.destinationSession,
      body: input.body,
      summary: input.summary ?? null,
      evidenceRef: input.evidenceRef ?? null,
      tags: input.tags ?? [],
      tsCreated: now,
      tsUpdated: now,
      blockedOn: null,
      handedOffTo: null,
      stalled: null,
      transitions: [
        { at: now, fromState: null, toState: 'pending', actor: 'operator', note: 'Created from dashboard' },
      ],
    }
    mockQueue.unshift(item)
    return item
  }
  return dashboardFetch<QueueItem>('/dash/queue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function updateQueue(
  qitemId: string,
  input: { state: QueueState; note?: string },
): Promise<QueueItem> {
  if (mockMode) {
    const item = await getQueueDetail(qitemId)
    const previous = item.state
    const now = new Date().toISOString()
    item.state = input.state
    item.tsUpdated = now
    item.transitions.unshift({
      at: now,
      fromState: previous,
      toState: input.state,
      actor: 'operator',
      note: input.note ?? null,
    })
    return item
  }
  return dashboardFetch<QueueItem>(`/dash/queue/${encodeURIComponent(qitemId)}/update`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function handoffQueue(
  qitemId: string,
  input: { toSession: string; note?: string },
): Promise<QueueItem> {
  if (mockMode) {
    const item = await getQueueDetail(qitemId)
    const now = new Date().toISOString()
    const previous = item.state
    item.destinationSession = input.toSession
    item.handedOffTo = input.toSession
    item.state = 'handed-off'
    item.tsUpdated = now
    item.transitions.unshift({
      at: now,
      fromState: previous,
      toState: 'handed-off',
      actor: 'operator',
      note: input.note ?? null,
    })
    return item
  }
  return dashboardFetch<QueueItem>(`/dash/queue/${encodeURIComponent(qitemId)}/handoff`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

async function action(path: string, body?: unknown): Promise<ActionResult> {
  if (mockMode) return { ok: true, message: `Mock action completed: ${path}`, detail: body }
  return dashboardFetch<ActionResult>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
export const rigAction = (rigId: string, verb: 'up' | 'down' | 'archive' | 'unarchive', body?: unknown) =>
  action(`/dash/rigs/${encodeURIComponent(rigId)}/${verb}`, body)
export const createRig = (source: string) => action('/dash/rigs/up', { source })
export const seatAction = (session: string, verb: 'launch' | 'stop', body?: unknown) =>
  action(`/dash/seats/${encodeURIComponent(session)}/${verb}`, body)
export async function getSnapshots(rigId: string): Promise<Snapshot[]> {
  return mockMode
    ? (mockSnapshots[rigId] ?? [])
    : dashboardFetch<Snapshot[]>(`/dash/rigs/${encodeURIComponent(rigId)}/snapshots`)
}
export async function createSnapshot(rigId: string): Promise<ActionResult> {
  if (mockMode) {
    ;(mockSnapshots[rigId] ??= []).unshift({
      id: `snap-${Date.now()}`,
      createdAt: new Date().toISOString(),
      kind: 'manual',
      label: 'Dashboard snapshot',
    })
    return { ok: true, message: 'Snapshot created' }
  }
  return action(`/dash/rigs/${encodeURIComponent(rigId)}/snapshots`)
}
export const restoreSnapshot = (snapshotId: string, confirm: string) =>
  action(`/dash/snapshots/${encodeURIComponent(snapshotId)}/restore`, { confirm })
export async function getPosture(rigId: string): Promise<RigPosture> {
  if (mockMode) return mockPostures[rigId] ?? { scope: rigId, effective: {}, editable: false }
  return dashboardFetch<RigPosture>(`/dash/rigs/${encodeURIComponent(rigId)}/posture`)
}
export async function savePosture(
  rigId: string,
  mode: string,
  record: Record<string, unknown>,
): Promise<ActionResult> {
  if (mockMode) {
    mockPostures[rigId] = { ...(await getPosture(rigId)), effective: { mode, ...record } }
    return { ok: true, message: 'Posture saved' }
  }
  return dashboardFetch<ActionResult>(`/dash/rigs/${encodeURIComponent(rigId)}/posture`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, record }),
  })
}
export async function getSeatModel(session: string): Promise<SeatModel> {
  return mockMode
    ? {
        current: session.includes('codex') ? 'gpt-5.6-codex' : 'sonnet',
        available: ['gpt-5.6-codex', 'gpt-5.6-mini', 'sonnet'],
      }
    : dashboardFetch<SeatModel>(`/dash/seats/${encodeURIComponent(session)}/model`)
}
export const setSeatModel = (session: string, model: string) =>
  action(`/dash/seats/${encodeURIComponent(session)}/model`, { model })
export async function scanSessions(): Promise<DiscoveredSession[]> {
  return mockMode
    ? mockDiscovered
    : dashboardFetch<DiscoveredSession[]>('/dash/discovery/scan', { method: 'POST' })
}
export const bindSession = (id: string, rigId: string, logicalId: string) =>
  action(`/dash/discovery/${encodeURIComponent(id)}/bind`, { rigId, logicalId })
