export interface ResolveItem {
  source: "agent" | "derived";
  identity: string;
  destinationSession: string | null;
  qitemId: string | null;
  /** Direct source on the item itself (from /api/review/fleet when present). */
  sourceSession?: string | null;
}

export interface QueueSource {
  sourceSession: string | null;
}

export interface LiveSessionInfo {
  rigName: string;
  logicalId: string;
}

export function isHumanRef(session: string | null): boolean {
  if (!session) return true;
  return /^human(?:-[A-Za-z0-9._-]+)?@(kernel|host)$/.test(session)
    || /^[A-Za-z0-9._:-]+@external$/.test(session);
}

/**
 * Canonical name → live session. `liveSessions` maps the canonical session name
 * (e.g. "dev-deepseek") to { rigName, logicalId }.
 */
export type LiveSessions = Map<string, LiveSessionInfo>;

function canonicalSessionForLogicalId(
  liveSessions: LiveSessions,
  rig: string,
  logicalId: string,
): string | null {
  const matches: string[] = [];
  for (const [session, info] of liveSessions) {
    if (info.rigName === rig && info.logicalId === logicalId) {
      matches.push(session);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Candidate order per (re)review #4 / Her-review 2:
 *   [destinationSession, item.sourceSession, queue.sourceSession, identity-prefix]
 * Each candidate only resolves when it is not a human/external ref AND is a live
 * canonical session. `blockedOn` is deliberately NOT part of seat resolution.
 *
 * Final fallback step (live review M5): when the identity-prefix has the form
 * `<pod>-<member>@<rig>` and no exact match exists, map it to the node with
 * logicalId `<pod>.<member>` in rig `<rig>` and use its canonical live session —
 * only when exactly one such node is live.
 */
export function resolveNeedsYouSession(
  item: ResolveItem,
  queue: QueueSource | null,
  liveSessions: LiveSessions,
): string | null {
  const live = new Set(liveSessions.keys());
  const candidates: Array<string | null> = [item.destinationSession];
  if (item.source === "agent") {
    candidates.push(item.sourceSession ?? null);
    if (queue?.sourceSession) candidates.push(queue.sourceSession);
  }
  const identityPrefix = item.identity.split("|")[0];
  if (identityPrefix) candidates.push(identityPrefix);

  for (const cand of candidates) {
    if (cand && !isHumanRef(cand) && live.has(cand)) return cand;
  }

  // M5: logicalId mapping for seats whose canonical name deviates from member@rig.
  // Slotcontrole #2: try ALL dash positions as the pod↔member boundary.
  // Accept resolution only when exactly one split produces exactly one match.
  if (identityPrefix) {
    const at = identityPrefix.lastIndexOf("@");
    if (at > 0 && at < identityPrefix.length - 1) {
      const name = identityPrefix.slice(0, at);
      const rig = identityPrefix.slice(at + 1);
      let bestMatch: string | null = null;
      for (let idx = 0; idx < name.length; idx++) {
        if (name[idx] !== "-") continue;
        const pod = name.slice(0, idx);
        const member = name.slice(idx + 1);
        if (!pod || !member) continue;
        const resolved = canonicalSessionForLogicalId(liveSessions, rig, `${pod}.${member}`);
        if (resolved) {
          if (bestMatch !== null) return null; // ambiguous — two different splits match
          bestMatch = resolved;
        }
      }
      if (bestMatch) return bestMatch;
    }
  }

  return null;
}