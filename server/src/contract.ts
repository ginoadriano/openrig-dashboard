export type SeatActivity = "working" | "idle" | "needs_input" | "unknown";

export interface Seat {
  logicalId: string;
  session: string;
  runtime: string | null;
  lifecycle: string | null;
  activity: SeatActivity;
  hasWork: boolean;
  reason: string | null;
}

export interface Rig {
  rigId: string;
  name: string;
  status: string;
  attentionCount: number;
  seats: Seat[];
}

export interface NeedsYouItem {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  rigName: string | null;
  logicalId: string | null;
  session: string;
  createdAt: string | null;
  source: string;
}

export interface NeedsYouResponse {
  items: NeedsYouItem[];
  unresolved: Omit<NeedsYouItem, "session">[];
}

export interface OutputResponse {
  text: string;
}

export interface SendRequest {
  text: string;
}

export interface SendResponse {
  ok: boolean;
  warning?: string;
  error?: string;
}

export type QueueState =
  | "pending" | "in-progress" | "blocked" | "done"
  | "handed-off" | "failed" | "canceled"
  | (string & {});

export interface QueueItem {
  qitemId: string;
  state: QueueState;
  priority: string | null;
  tier: string | null;
  sourceSession: string;
  destinationSession: string;
  body: string;
  tags: string[];
  tsCreated: string;
  tsUpdated: string;
  blockedOn: string | null;
  handedOffTo: string | null;
  stalled: string | null;
}

export interface QueueTransition {
  at: string;
  fromState: string | null;
  toState: string;
  actor: string | null;
  note: string | null;
}

export interface QueueItemWithTransitions extends QueueItem {
  transitions: QueueTransition[];
}

export interface DaemonNode {
  logicalId: string;
  canonicalSessionName: string | null;
  runtime: string | null;
  lifecycleState: string | null;
  agentActivity: { state?: string } | null;
  terminalActive: boolean;
  hasAssignedWork: boolean;
  assignedWorkCount?: number;
  sessionStatus?: string;
  rigName?: string;
}

export interface DaemonRig {
  rigId: string;
  name: string;
  rigName?: string;
  status: string;
  lifecycleState?: string;
  attentionCount: number;
  nodeCount?: number;
  runningCount?: number;
}

export interface NeedsYouAgentItem {
  source: "agent" | "derived";
  identity: string;
  summary: string;
  qitemId: string | null;
  destinationSession: string | null;
  sourceSession?: string | null;
  derived: { kind: string; evidence: string; threshold: string } | null;
  leg?: string;
  where?: string;
  ageIso?: string | null;
  priority?: string | null;
  tier?: string | null;
}

export interface NeedsYouFleetRollup {
  needsYou: { items: NeedsYouAgentItem[] };
  hosts?: Array<{ hostId: string; topLine?: string }>;
}

export interface DaemonQueueItem {
  qitemId: string;
  state: string;
  priority: string | null;
  tier: string | null;
  sourceSession: string;
  destinationSession: string;
  body: string;
  tags: string[] | null;
  tsCreated: string;
  tsUpdated: string;
  blockedOn: string | null;
  handedOffTo: string | null;
  pickup?: { state?: string };
  [key: string]: unknown;
}

export interface DaemonQueueTransition {
  transitionId?: number;
  ts?: string;                 // daemon timestamp of the transition
  state?: string;              // daemon state this transition led to
  tsCreated?: string;
  actorSession?: string | null;
  actor?: string | null;
  transitionNote?: string | null;
  note?: string | null;
  closureReason?: string | null;
  closureTarget?: string | null;
}

// -- Wave 3: Rig-beheer ------------------------------------------------

export interface ActionResult {
  ok: boolean;
  message: string;
  detail?: unknown;
}

export interface Snapshot {
  id: string;
  createdAt: string;
  kind: string | null;
  label: string | null;
}

export interface DiscoveredSession {
  id: string;
  session: string;
  runtime: string | null;
  cwd: string | null;
  boundTo: string | null;
}

export interface SeatModel {
  current: string | null;
  available: string[];
}

export interface RigPosture {
  scope: string;
  effective: Record<string, unknown>;
  editable: boolean;
}

export interface ConfirmPayload {
  confirm: string;
}