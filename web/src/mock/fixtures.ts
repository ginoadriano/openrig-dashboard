import type { DiscoveredSession, NeedsYouResponse, QueueDetail, Rig, RigPosture, Snapshot } from '../types'

export const mockFleet: Rig[] = [
  {
    rigId: '01M39SA1DASHBOARDTEAM',
    name: 'dashboard-team',
    status: 'running',
    attentionCount: 2,
    seats: [
      {
        logicalId: 'orch.lead',
        session: 'orch-lead@dashboard-team',
        runtime: 'claude-code',
        lifecycle: 'run',
        activity: 'working',
        hasWork: true,
        reason: 'Reviewing Wave 1',
      },
      {
        logicalId: 'dev.codexdev',
        session: 'dev-codexdev@dashboard-team',
        runtime: 'codex',
        lifecycle: 'run',
        activity: 'idle',
        hasWork: true,
        reason: null,
      },
      {
        logicalId: 'dev.reviewer',
        session: 'dev-reviewer@dashboard-team',
        runtime: 'codex',
        lifecycle: 'att',
        activity: 'needs_input',
        hasWork: true,
        reason: 'Needs review assignment',
      },
    ],
  },
  {
    rigId: '01M39SA1FIRSTPROJECT',
    name: 'first-project',
    status: 'partial',
    attentionCount: 1,
    seats: [
      {
        logicalId: 'pm.lead',
        session: 'pm-lead@first-project',
        runtime: 'claude-code',
        lifecycle: 'run',
        activity: 'idle',
        hasWork: false,
        reason: null,
      },
      {
        logicalId: 'ops.watch',
        session: 'ops-watch@first-project',
        runtime: 'codex',
        lifecycle: 'att',
        activity: 'unknown',
        hasWork: true,
        reason: 'Daemon has no fresh activity sample',
      },
    ],
  },
]

export const mockNeedsYou: NeedsYouResponse = {
  items: [
    {
      id: 'queue-review',
      kind: 'queue_human',
      title: 'Review the Wave 1 UI',
      detail: 'An independent review is waiting before the wave can close.',
      rigName: 'dashboard-team',
      logicalId: 'dev.reviewer',
      session: 'dev-reviewer@dashboard-team',
      createdAt: '2026-09-24T13:18:00.000Z',
      source: 'queue',
    },
    {
      id: 'prompt-orch',
      kind: 'permission_prompt',
      title: 'Orchestrator is waiting',
      detail: 'The implementation boundary needs a decision.',
      rigName: 'dashboard-team',
      logicalId: 'orch.lead',
      session: 'orch-lead@dashboard-team',
      createdAt: '2026-09-24T13:24:00.000Z',
      source: 'activity',
    },
  ],
  unresolved: [
    {
      id: 'unresolved-host',
      kind: 'blocked',
      title: 'Remote host needs attention',
      detail: 'The daemon reported a blocked item but could not resolve it to a local tmux session.',
      rigName: 'first-project',
      logicalId: null,
      createdAt: '2026-09-24T13:09:00.000Z',
      source: 'queue',
    },
  ],
}

export const mockOutput = `OpenRig dashboard mock terminal\n\nThis view uses fixture data because VITE_MOCK=1.\nUse the Terminal tab to exercise xterm rendering.\n`

export const mockQueue: QueueDetail[] = [
  {
    qitemId: 'qitem-wave-2',
    state: 'in-progress',
    priority: 'urgent',
    tier: 'P1',
    sourceSession: 'orch-lead@dashboard-team',
    destinationSession: 'dev-codexdev@dashboard-team',
    body: 'Build the Wave 2 queue interface\n\nKeep the dashboard client offline-capable and match the server contract.',
    tags: ['wave-2', 'frontend'],
    tsCreated: '2026-09-24T11:42:00.000Z',
    tsUpdated: '2026-09-24T13:22:00.000Z',
    blockedOn: null,
    handedOffTo: null,
    stalled: null,
    transitions: [
      {
        at: '2026-09-24T11:42:00.000Z',
        fromState: null,
        toState: 'pending',
        actor: 'orch.lead',
        note: 'Wave 2 assigned',
      },
      {
        at: '2026-09-24T11:54:00.000Z',
        fromState: 'pending',
        toState: 'in-progress',
        actor: 'dev.codexdev',
        note: 'Started implementation',
      },
    ],
  },
  {
    qitemId: 'qitem-review',
    state: 'blocked',
    priority: 'routine',
    tier: 'P2',
    sourceSession: 'orch-lead@dashboard-team',
    destinationSession: 'dev-reviewer@dashboard-team',
    body: 'Review Wave 1 before closure\n\nCheck the terminal and fallback paths against the contract.',
    tags: ['review', 'wave-1'],
    tsCreated: '2026-09-24T10:08:00.000Z',
    tsUpdated: '2026-09-24T12:51:00.000Z',
    blockedOn: 'awaiting implementation handoff',
    handedOffTo: null,
    stalled: 'pickup overdue',
    transitions: [
      { at: '2026-09-24T10:08:00.000Z', fromState: null, toState: 'pending', actor: 'orch.lead', note: null },
      {
        at: '2026-09-24T12:51:00.000Z',
        fromState: 'pending',
        toState: 'blocked',
        actor: 'system',
        note: 'Waiting for handoff',
      },
    ],
  },
  {
    qitemId: 'qitem-orientation',
    state: 'pending',
    priority: 'routine',
    tier: 'P3',
    sourceSession: 'pm-lead@first-project',
    destinationSession: 'ops-watch@first-project',
    body: 'Confirm host orientation\n\nReport whether the remote host has a fresh daemon receipt.',
    tags: ['operations'],
    tsCreated: '2026-09-24T13:05:00.000Z',
    tsUpdated: '2026-09-24T13:05:00.000Z',
    blockedOn: null,
    handedOffTo: null,
    stalled: null,
    transitions: [
      { at: '2026-09-24T13:05:00.000Z', fromState: null, toState: 'pending', actor: 'pm.lead', note: null },
    ],
  },
]

export const mockSnapshots: Record<string, Snapshot[]> = {
  '01M39SA1DASHBOARDTEAM': [
    {
      id: 'snap-dashboard-01',
      createdAt: '2026-09-24T12:00:00.000Z',
      kind: 'manual',
      label: 'Before Wave 2',
    },
  ],
  '01M39SA1FIRSTPROJECT': [],
}
export const mockPostures: Record<string, RigPosture> = {
  '01M39SA1DASHBOARDTEAM': {
    scope: 'dashboard-team',
    editable: true,
    effective: { mode: 'operator', permissions: 'workspace-write', autoRestore: false },
  },
  '01M39SA1FIRSTPROJECT': {
    scope: 'first-project',
    editable: false,
    effective: { mode: 'observe', permissions: 'read-only' },
  },
}
export const mockDiscovered: DiscoveredSession[] = [
  { id: 'scan-1', session: 'scratch-agent', runtime: 'codex', cwd: '/tmp/demo', boundTo: null },
  { id: 'scan-2', session: 'external-review', runtime: 'claude-code', cwd: '/mnt/c/review', boundTo: null },
]
