export type SeatActivity = 'working' | 'idle' | 'needs_input' | 'unknown'

export interface Seat {
  logicalId: string
  session: string
  runtime: string | null
  lifecycle: string | null
  activity: SeatActivity
  hasWork: boolean
  reason: string | null
}

export interface Rig {
  rigId: string
  name: string
  status: string
  attentionCount: number
  seats: Seat[]
}

export interface NeedsYouItem {
  id: string
  kind: string
  title: string
  detail: string | null
  rigName: string | null
  logicalId: string | null
  session: string
  createdAt: string | null
  source: string
}

export type UnresolvedNeedsYouItem = Omit<NeedsYouItem, 'session'>

export interface NeedsYouResponse {
  items: NeedsYouItem[]
  unresolved: UnresolvedNeedsYouItem[]
}

export type QueueState =
  'pending' | 'in-progress' | 'blocked' | 'done' | 'handed-off' | 'failed' | 'canceled' | (string & {})

export interface QueueItem {
  qitemId: string
  state: QueueState
  priority: string | null
  tier: string | null
  sourceSession: string
  destinationSession: string
  body: string
  tags: string[]
  tsCreated: string
  tsUpdated: string
  blockedOn: string | null
  handedOffTo: string | null
  stalled: string | null
}

export interface QueueTransition {
  at: string | null
  fromState: string | null
  toState: string | null
  actor: string | null
  note: string | null
}

export interface QueueDetail extends QueueItem {
  transitions: QueueTransition[]
}

export interface ActionResult {
  ok: boolean
  message: string
  detail?: unknown
}
export interface Snapshot {
  id: string
  createdAt: string
  kind: string | null
  label: string | null
}
export interface DiscoveredSession {
  id: string
  session: string
  runtime: string | null
  cwd: string | null
  boundTo: string | null
}
export interface SeatModel {
  current: string | null
  available: string[]
}
export interface RigPosture {
  scope: string
  effective: Record<string, unknown>
  editable: boolean
}
