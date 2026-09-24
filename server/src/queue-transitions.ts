export interface DaemonQueueTransitionFixture {
  transitionId?: number;
  ts?: string;
  state?: string;
  tsCreated?: string;
  actorSession?: string | null;
  transitionNote?: string | null;
  closureReason?: string | null;
}

export interface QueueTransitionFixture {
  at: string;
  fromState: string | null;
  toState: string;
  actor: string | null;
  note: string | null;
}

/**
 * Daemon transitions are chronologically ordered { ts, state, transitionNote, actorSession }.
 * fromState is the previous transition's state (null for the first).
 */
export function mapTransitions(ts: DaemonQueueTransitionFixture[]): QueueTransitionFixture[] {
  let prevState: string | null = null;
  return ts.map((t) => {
    const mapped: QueueTransitionFixture = {
      at: t.ts ?? t.tsCreated ?? "",
      fromState: prevState,
      toState: t.state ?? "",
      actor: t.actorSession ?? null,
      note: t.transitionNote ?? null,
    };
    if (t.state !== undefined) prevState = t.state;
    return mapped;
  });
}