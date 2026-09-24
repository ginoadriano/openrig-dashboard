import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { WebSocket } from "ws";
import { resolveNeedsYouSession } from "./needs-you-resolve.js";
import { mapTransitions } from "./queue-transitions.js";
import type { QueueSource, ResolveItem } from "./needs-you-resolve.js";
import type {
  ActionResult,
  DaemonNode,
  DaemonQueueItem,
  DaemonQueueTransition,
  DaemonRig,
  DiscoveredSession,
  NeedsYouAgentItem,
  NeedsYouFleetRollup,
  NeedsYouItem,
  NeedsYouResponse,
  OutputResponse,
  QueueItem,
  QueueItemWithTransitions,
  QueueState,
  QueueTransition,
  Rig,
  RigPosture,
  Seat,
  SeatActivity,
  SeatModel,
  SendRequest,
  SendResponse,
  Snapshot,
} from "./contract.js";

const DAEMON = "http://127.0.0.1:7433";
const POLL_INTERVAL = 3000;
const FETCH_TIMEOUT_MS = 8000;
const TERMINAL_BEARER = process.env.OPENRIG_TERMINAL_BEARER_TOKEN ?? null;
const OPERATOR_SESSION = process.env.DASH_OPERATOR_SESSION ?? "operator-human@kernel";
const MUTATION_ALLOWLIST_ENV = process.env.DASH_MUTATION_ALLOWLIST ?? null;
const MUTATION_ALLOWLIST: Set<string> | null = MUTATION_ALLOWLIST_ENV
  ? new Set(MUTATION_ALLOWLIST_ENV.split(",").map((s) => s.trim()).filter(Boolean))
  : null;
const DAEMON_OPERATOR_BEARER = process.env.OPENRIG_AUTH_BEARER_TOKEN ?? null;

// -- Daemon queue-SSE watcher (fix 7 queue invalidation) ---------------
let queueSseHealthy = false;
let queueSseVersion = 0;
let queueSseWatcherStarted = false;

function startQueueSseWatcher(): void {
  if (queueSseWatcherStarted) return;
  queueSseWatcherStarted = true;

  const connect = async () => {
    try {
      const controller = new AbortController();
      // No 8s timeout: this is a long-lived stream. `daemonFetch` applies its own timeout,
      // so use raw fetch here and rely on the response body ending on daemon down.
      const res = await fetch(`${DAEMON}/api/queue/sse`, {
        headers: daemonHeaders(),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        queueSseHealthy = false;
        queueSseVersion++;
        return;
      }
      queueSseHealthy = true;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data:")) {
            queueSseVersion++;
          }
        }
      }
      queueSseHealthy = false;
      queueSseVersion++;
    } catch {
      queueSseHealthy = false;
      queueSseVersion++;
    }
  };

  const loop = async () => {
    await connect();
    setTimeout(() => void loop(), 5000); // retry when the stream ends
  };
  void loop();
}

// -- Route-parameter allowlists (fix 3) ---------------------------------
const SESSION_PATTERN = /^[A-Za-z0-9._:@=-]{1,200}$/;
const RIG_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const QITEM_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
const SNAPSHOT_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
const DISCOVERY_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
const LOGICAL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

function validParam(value: string, pattern: RegExp): boolean {
  return typeof value === "string" && pattern.test(value);
}

// -- Origin allowlist (fix 2) -------------------------------------------
const DEFAULT_ALLOWED_ORIGINS = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
];
function allowedOrigins(): Set<string> {
  const configured = (process.env.DASH_ALLOWED_ORIGINS ?? "").split(",")
    .map((s) => s.trim()).filter(Boolean);
  const base = configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS;
  return new Set(base);
}

function originAllowed(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const allowed = allowedOrigins();
  if (allowed.has(raw)) return true;
  // Own origin (Server-Name based) — always permitted so curl/SameOrigin work.
  if (raw === `http://127.0.0.1:${PORT}` || raw === `http://localhost:${PORT}`) return true;
  return false;
}

function hostAllowed(hostHeader: string | undefined | null): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.toLowerCase().replace(/^https?:\/\//, "");
  return host === `127.0.0.1:${PORT}` || host === `localhost:${PORT}`
    || host === `[::1]:${PORT}`;
}

function mutationOriginGuard(raw: string | undefined | null): string | null {
  if (!raw) return "missing Origin header";
  if (!originAllowed(raw)) return `Origin '${truncate(raw)}' is not allowed`;
  return null;
}

function truncate(s: string, n = 80): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

function daemonHeaders(): Record<string, string> {
  return { "X-OpenRig-Session": OPERATOR_SESSION };
}

// -- Centralized daemon fetch with timeout (fix 6) ----------------------
async function daemonFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${DAEMON}${path}`, { ...init, signal: controller.signal });
    return res;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (err.name === "AbortError") {
      throw new Error(`daemon timeout after ${timeoutMs}ms: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function errorResult(message: string, detail: unknown = null): ActionResult {
  return { ok: false, message, ...(detail !== null ? { detail } : {}) };
}

function daemonErr(e: unknown): ActionResult {
  const message = e instanceof Error ? e.message : String(e);
  return errorResult(`daemon_unreachable: ${message}`);
}

// -- Activity normalization ---------------------------------------------
function normalizeActivity(
  agentActivity: { state?: string } | null,
): { activity: SeatActivity; reason: string | null } {
  const state = agentActivity?.state;
  if (!state || state === "unknown")
    return { activity: "unknown", reason: state ?? null };
  if (state === "running")
    return { activity: "working", reason: "running" };
  if (state === "idle")
    return { activity: "idle", reason: "idle" };
  if (state === "needs_input")
    return { activity: "needs_input", reason: "needs_input" };
  return { activity: "unknown", reason: state };
}

function isHumanRef(session: string | null): boolean {
  if (!session) return true;
  return /^human(?:-[A-Za-z0-9._-]+)?@(kernel|host)$/.test(session)
    || /^[A-Za-z0-9._:-]+@external$/.test(session);
}

// -- Fleet (live canonical sessions only) -------------------------------
type LiveSession = { rigName: string; logicalId: string };
type FleetData = { rigs: Rig[]; liveSessions: Map<string, LiveSession> };

function nodeIsLive(n: DaemonNode): boolean {
  // A seat is live only when its session/lifecycle actually reports running.
  const status = n.sessionStatus ?? n.lifecycleState ?? null;
  return status === "running";
}

async function fetchFleetData(): Promise<FleetData> {
  const psRes = await daemonFetch("/api/ps");
  if (!psRes.ok) {
    throw new Error(`/api/ps returned ${psRes.status}`);
  }
  const daemonRigs: DaemonRig[] = await psRes.json() as DaemonRig[];

  const rigs: Rig[] = [];
  const liveSessions = new Map<string, LiveSession>();
  for (const dr of daemonRigs) {
    const nodesRes = await daemonFetch(`/api/rigs/${dr.rigId}/nodes?full=true`);
    if (!nodesRes.ok) continue;
    const nodes: DaemonNode[] = await nodesRes.json() as DaemonNode[];

    const seats: Seat[] = nodes.map((n) => {
      const { activity, reason } = normalizeActivity(n.agentActivity);
      const session = n.canonicalSessionName ?? n.logicalId;
      if (nodeIsLive(n) && n.canonicalSessionName && n.canonicalSessionName !== n.logicalId && !isHumanRef(session)) {
        liveSessions.set(session, { rigName: dr.name, logicalId: n.logicalId });
      }
      return {
        logicalId: n.logicalId,
        session,
        runtime: n.runtime ?? null,
        lifecycle: n.lifecycleState ?? null,
        activity,
        hasWork: n.hasAssignedWork ?? false,
        reason,
      };
    });

    rigs.push({
      rigId: dr.rigId,
      name: dr.name,
      status: dr.status ?? "unknown",
      attentionCount: dr.attentionCount ?? 0,
      seats,
    });
  }

  return { rigs, liveSessions };
}

async function fetchFleet(): Promise<Rig[]> {
  const { rigs } = await fetchFleetData();
  return rigs;
}

// -- Needs-you (fix 4) ----------------------------------------------------
async function fetchQueueSources(items: NeedsYouAgentItem[]): Promise<Map<string, QueueSource>> {
  const cache = new Map<string, QueueSource>();
  const missing = items.filter((i) => i.source === "agent" && i.qitemId && !cache.has(i.qitemId));
  await Promise.all(
    missing.map(async (i) => {
      const qid = i.qitemId!;
      try {
        const res = await daemonFetch(`/api/queue/${encodeURIComponent(qid)}`);
        if (res.ok) {
          const q = await res.json() as { sourceSession?: string };
          cache.set(qid, { sourceSession: q.sourceSession ?? null });
          return;
        }
      } catch { /* keep null source — falls back to identity prefix */ }
      cache.set(qid, { sourceSession: null });
    }),
  );
  return cache;
}

async function fetchNeedsYou(
  liveSessions: Map<string, LiveSession>,
  needsInputSessions: Set<string>,
): Promise<{ needsYou: NeedsYouResponse; err: ActionResult | null }> {
  const fleetRes = await daemonFetch("/api/review/fleet");
  if (!fleetRes.ok) {
    return { needsYou: { items: [], unresolved: [] }, err: errorResult(`/api/review/fleet returned ${fleetRes.status}`) };
  }
  const fleet: NeedsYouFleetRollup = await fleetRes.json() as NeedsYouFleetRollup;

  const queueSources = await fetchQueueSources(fleet.needsYou.items);

  const resolved: NeedsYouResponse["items"] = [];
  const unresolved: NeedsYouResponse["unresolved"] = [];
  const seen = new Set<string>();
  const resolvedSessions = new Set<string>();

  for (const item of fleet.needsYou.items) {
    const queue = item.source === "agent" && item.qitemId ? queueSources.get(item.qitemId) ?? null : null;
    const session = resolveNeedsYouSession(item, queue, liveSessions);

    const id = stableId(item);
    if (seen.has(id)) continue;
    seen.add(id);

    const info = session ? liveSessions.get(session) : undefined;
    const base: Omit<NeedsYouItem, "session"> = {
      id,
      kind: kindForItem(item),
      title: item.summary,
      detail: item.derived?.evidence ?? null,
      rigName: info?.rigName ?? null,
      logicalId: info?.logicalId ?? null,
      createdAt: item.ageIso ?? null,
      source: item.source,
    };

    if (session && info) {
      resolved.push({ ...base, session, logicalId: info.logicalId, rigName: info.rigName });
      resolvedSessions.add(session);
    } else {
      unresolved.push(base);
    }
  }

  // M4: seats with activity=needs_input that are not already covered → permission_prompt card.
  for (const session of needsInputSessions) {
    if (resolvedSessions.has(session)) continue;
    const info = liveSessions.get(session);
    if (!info) continue;
    resolved.push({
      id: `permission-prompt:${session}`,
      kind: "permission_prompt",
      title: `${session} needs input`,
      detail: null,
      rigName: info.rigName,
      logicalId: info.logicalId,
      session,
      createdAt: null,
      source: "activity",
    });
  }

  return { needsYou: { items: resolved, unresolved }, err: null };
}

function collectNeedsInputSessions(rigs: Rig[]): Set<string> {
  const out = new Set<string>();
  for (const r of rigs) {
    for (const s of r.seats) {
      if (s.activity === "needs_input" && s.session !== s.logicalId) out.add(s.session);
    }
  }
  return out;
}

function stableId(item: NeedsYouAgentItem): string {
  if (item.qitemId) return `queue:${item.qitemId}`;
  const hash = item.identity.replace(/[^a-zA-Z0-9._:-]/g, "_");
  return `derived:${hash}`;
}

function kindForItem(item: NeedsYouAgentItem): string {
  if (item.source === "derived") return item.derived?.kind ?? "exception";
  return "queue_human";
}

// -- Queue mapping -------------------------------------------------------
function mapQueueItem(d: DaemonQueueItem): QueueItem {
  return {
    qitemId: d.qitemId,
    state: d.state as QueueState,
    priority: d.priority,
    tier: d.tier,
    sourceSession: d.sourceSession,
    destinationSession: d.destinationSession,
    body: d.body,
    tags: d.tags ?? [],
    tsCreated: d.tsCreated,
    tsUpdated: d.tsUpdated,
    blockedOn: d.blockedOn,
    handedOffTo: d.handedOffTo,
    stalled: d.pickup?.state === "stalled-after-claim" ? d.pickup.state : null,
  };
}

// Daemon transitions are chronologically ordered { ts, state, transitionNote, actorSession }.
// See queue-transitions.ts mapTransitions for the mapping + fixture test.
// (kept import re-export for clarity)

function daemonClosureReason(state: string): string | undefined {
  switch (state) {
    case "done": return "no-follow-on";
    case "failed": return "no-follow-on";
    default: return undefined; // canceled/blocked must not carry closureReason (daemon rejects)
  }
}

// -- Origin + Host guard middleware (fix 2, M1) ---------------------------
app.use("*", async (c, next) => {
  const method = c.req.method;
  const origin = c.req.header("Origin");
  const host = c.req.header("Host");
  // M1: DNS-rebinding guard first — every request (incl. GET/SSE/WS) must have
  // an allowed Host. The Vite proxy sends Host: 127.0.0.1:7500 (changeOrigin).
  if (!hostAllowed(host)) {
    return c.json({ error: `Host '${truncate(host ?? "")}' is not allowed` }, 403);
  }
  const isWsUpgrade = (c.req.header("Upgrade") ?? "").toLowerCase() === "websocket";
  if ((method === "GET" || method === "HEAD") && !isWsUpgrade) {
    // Plain reads: if an Origin is present it must be allowed; absence is fine (curl etc.)
    if (origin && !originAllowed(origin)) {
      return c.json({ error: `Origin '${truncate(origin)}' is not allowed` }, 403);
    }
    return next();
  }
  // Mutations (POST/PUT/DELETE) and WS upgrades: require a present + allowed Origin.
  const gate = mutationOriginGuard(origin);
  if (gate) return c.json({ error: gate }, 403);
  return next();
});

// -- Endpoints ------------------------------------------------------------

app.get("/dash/fleet", async (c) => {
  try {
    const rigs = await fetchFleet();
    return c.json(rigs);
  } catch (e) {
    return c.json({ error: daemonErr(e).message }, 502);
  }
});

app.get("/dash/needs-you", async (c) => {
  try {
    const { rigs, liveSessions } = await fetchFleetData();
    const needsInput = collectNeedsInputSessions(rigs);
    const { needsYou, err } = await fetchNeedsYou(liveSessions, needsInput);
    if (err) return c.json({ error: err.message }, 502);
    return c.json(needsYou);
  } catch (e) {
    return c.json({ error: daemonErr(e).message }, 502);
  }
});

app.get("/dash/seats/:session/output", async (c) => {
  const session = c.req.param("session");
  if (!validParam(session, SESSION_PATTERN)) return c.json({ error: "invalid session parameter" }, 400);
  const linesRaw = c.req.query("lines") ?? "200";
  const lines = Number.parseInt(linesRaw, 10);
  if (Number.isNaN(lines) || lines < 1 || lines > 2000) return c.json({ error: "invalid lines parameter" }, 400);

  try {
    const res = await daemonFetch(`/api/transport/capture`, {
      method: "POST",
      headers: { ...daemonHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ session, lines }),
    });
    if (!res.ok) {
      return c.json({ error: `daemon_error: ${res.status}` }, res.status as any);
    }
    const data = await res.json() as { content?: string; sessionName?: string };
    return c.json({ text: data.content ?? "" } satisfies OutputResponse);
  } catch (e) {
    return c.json({ error: daemonErr(e).message }, 502);
  }
});

app.post("/dash/seats/:session/send", async (c) => {
  const session = c.req.param("session");
  if (!validParam(session, SESSION_PATTERN)) return c.json({ ok: false, error: "invalid session parameter" } satisfies SendResponse, 400);
  let body: SendRequest;
  try {
    body = await c.req.json() as SendRequest;
  } catch {
    return c.json({ ok: false, error: "invalid_json" } satisfies SendResponse, 400);
  }
  if (typeof body.text !== "string" || body.text.length === 0) {
    return c.json({ ok: false, error: "text_required" } satisfies SendResponse, 400);
  }

  try {
    const res = await daemonFetch(`/api/transport/send`, {
      method: "POST",
      headers: { ...daemonHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ session, text: body.text }),
    });
    const data = await res.json() as { ok?: boolean; warning?: string; error?: string };
    if (!res.ok || data.ok === false) {
      return c.json({
        ok: false,
        error: data.error ?? `http_${res.status}`,
      } satisfies SendResponse, (res.ok ? 200 : res.status) as any);
    }
    return c.json({ ok: true, warning: data.warning } satisfies SendResponse);
  } catch (e) {
    return c.json({ ok: false, error: daemonErr(e).message } satisfies SendResponse, 502);
  }
});

// -- Terminal WebSocket proxy (fix 5) ------------------------------------
const MAX_EARLY_FRAMES = 32;
const MAX_EARLY_BYTES = 256 * 1024;

app.get(
  "/dash/terminal/:session",
  upgradeWebSocket((c) => {
    const sessionRaw = c.req.param("session") ?? "";
    const targetUrl = (session: string): string => `ws://127.0.0.1:7433/api/terminal/${session}`;
    if (!validParam(sessionRaw, SESSION_PATTERN)) {
      // Invalid session: no upstream, close immediately.
      return { onOpen(_e, ctx) { ctx.close(1008, "invalid_session"); }, onMessage() {}, onClose() {} };
    }

    let daemonWs: WebSocket | null = null;
    let closed = false;
    let clientCtx: { close: (code: number, reason: string) => void } | null = null;
    const early: string[] = [];
    let earlyBytes = 0;
    let daemonOpen = false;

    // Close BOTH sides; forwards the upstream code+reason to the client (M2).
    const closeClient = (code: number, reason: string) => {
      try { clientCtx?.close(code, reason); } catch { /* noop */ }
    };

    const cleanup = (code?: number, reason?: string) => {
      if (closed) return;
      closed = true;
      if (code !== undefined && reason !== undefined) closeClient(code, reason);
      try { daemonWs?.close(); } catch { /* noop */ }
      daemonWs = null;
    };

    const queueOrFlush = (frame: string, overLimit: () => void): "accepted" | "over-limit" | "open" => {
      if (daemonOpen && daemonWs) {
        daemonWs.send(frame);
        return "open";
      }
      const bytes = Buffer.byteLength(frame, "utf8");
      if (early.length >= MAX_EARLY_FRAMES || earlyBytes + bytes > MAX_EARLY_BYTES) {
        // Over daemon limits: close client with 1009 (not silent drop).
        overLimit();
        return "over-limit";
      }
      early.push(frame);
      earlyBytes += bytes;
      return "accepted";
    };

    const isAllowedFrame = (parsed: unknown): parsed is Record<string, unknown> => {
      if (typeof parsed !== "object" || parsed === null) return false;
      const o = parsed as Record<string, unknown>;
      if (!["text", "keys", "scroll"].includes(String(o.type))) return false;
      if (o.type === "text" && typeof (o as { text?: unknown }).text !== "string") return false;
      if (o.type === "keys" && Array.isArray(o.keys) && (o.keys as unknown[]).every((k) => typeof k === "string")) return true;
      if (o.type === "keys") return false;
      if (o.type === "scroll") {
        const off = (o as { offset?: unknown }).offset;
        return typeof off === "number" && Number.isInteger(off) && off >= 0;
      }
      return true;
    };

    return {
      onOpen(_event, ctx) {
        clientCtx = ctx;
        const headers: Record<string, string> = {};
        if (TERMINAL_BEARER) headers["Authorization"] = `Bearer ${TERMINAL_BEARER}`;

        daemonWs = new WebSocket(targetUrl(sessionRaw), { headers });

        // Register close/error BEFORE open so an early failure propagates (M2).
        daemonWs.on("error", () => {
          if (!closed) cleanup(1011, "upstream_error");
        });
        daemonWs.on("close", (code, reason) => {
          daemonOpen = false;
          if (!closed) cleanup(code ?? 1006, reason?.toString() ?? "upstream_closed");
        });
        daemonWs.on("open", () => {
          daemonOpen = true;
          for (const f of early) {
            try { daemonWs!.send(f); } catch { break; }
          }
          early.length = 0;
          earlyBytes = 0;
          daemonWs!.on("message", (data: Buffer | string) => {
            if (closed) return;
            try { ctx.send(data.toString()); } catch { cleanup(); }
          });
        });
      },

      onMessage(event, ctx) {
        if (closed) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data as string);
        } catch {
          cleanup(1007, "invalid_frame");
          return;
        }
        if (!isAllowedFrame(parsed)) {
          cleanup(1008, "frame_not_allowed");
          return;
        }
        try {
          queueOrFlush(JSON.stringify(parsed), () => cleanup(1009, "early_frame_limit"));
        } catch {
          cleanup(1011, "proxy_error");
        }
      },

      onClose() {
        cleanup();
      },
    };
  }),
);

// -- SSE /dash/events (fix 6, 7) ----------------------------------------
app.get("/dash/events", (c) => {
  return streamSSE(c, async (stream) => {
    let prevFleet = "";
    let prevNeeds = "";
    let prevQueue = "";
    let prevQueueSse = -1;
    let inFlight = false;
    let closed = false;

    const flush = async () => {
      if (inFlight || closed) return;
      inFlight = true;
      try {
        const { rigs, liveSessions } = await fetchFleetData();
        const fHash = JSON.stringify(rigs.map((r) => [
          r.rigId,
          r.seats.map((s) => [s.logicalId, s.activity, s.lifecycle, s.hasWork, s.session]),
        ]));
        if (fHash !== prevFleet) {
          prevFleet = fHash;
          await stream.writeSSE({ data: JSON.stringify({ type: "invalidate", scope: "fleet" }) });
        }

        const needsInput = collectNeedsInputSessions(rigs);
        const { needsYou, err } = await fetchNeedsYou(liveSessions, needsInput);
        if (!err) {
          const nHash = JSON.stringify([
            needsYou.items.map((i) => [i.id, i.session, i.title, i.kind, i.detail, i.source]),
            needsYou.unresolved.map((i) => [i.id, i.title, i.kind, i.detail, i.source]),
          ]);
          if (nHash !== prevNeeds) {
            prevNeeds = nHash;
            await stream.writeSSE({ data: JSON.stringify({ type: "invalidate", scope: "needs-you" }) });
          }
        }

        // Queue invalidation: prefer the daemon queue-SSE watcher; fall back to a
        // complete list of active items when the watcher is not healthy.
        if (queueSseHealthy && queueSseVersion !== prevQueueSse) {
          prevQueueSse = queueSseVersion;
          await stream.writeSSE({ data: JSON.stringify({ type: "invalidate", scope: "queue" }) });
        } else if (!queueSseHealthy) {
          const qRes = await daemonFetch(`/api/queue/list?activeOnly=1&limit=1000`);
          if (qRes.ok) {
            const qData = await qRes.json() as DaemonQueueItem[];
            const qHash = JSON.stringify(
              qData
                .filter((q) => q.state !== "done" && q.state !== "canceled")
                .map((q) => [q.qitemId, q.state, q.tsUpdated, q.sourceSession, q.destinationSession]),
            );
            if (qHash !== prevQueue) {
              prevQueue = qHash;
              await stream.writeSSE({ data: JSON.stringify({ type: "invalidate", scope: "queue" }) });
            }
          }
        }
      } catch {
        // daemon down — wait for next tick
      } finally {
        inFlight = false;
      }
    };

    const timer = setInterval(flush, POLL_INTERVAL);
    stream.onAbort(() => {
      closed = true;
      clearInterval(timer);
    });
    await flush();
    await new Promise(() => {});
  });
});

// -- Wave 2: Queue endpoints ----------------------------------------------

const KNOWN_QUEUE_STATES = new Set([
  "pending", "in-progress", "blocked", "done",
  "handed-off", "failed", "canceled", "denied",
]);

app.get("/dash/queue", async (c) => {
  try {
    const params = new URLSearchParams();
    const rig = c.req.query("rig");
    const sessionFilter = c.req.query("session");
    const state = c.req.query("state");
    const activeOnly = c.req.query("activeOnly");
    const limit = c.req.query("limit");

    // m3: strict query-param validation.
    if (rig !== undefined && !validParam(rig, /^[A-Za-z0-9._:-]{1,100}$/))
      return c.json({ error: "invalid rig parameter" }, 400);
    if (sessionFilter !== undefined && !validParam(sessionFilter, SESSION_PATTERN))
      return c.json({ error: "invalid session parameter" }, 400);
    if (state !== undefined) {
      for (const s of state.split(",")) {
        if (!KNOWN_QUEUE_STATES.has(s)) return c.json({ error: `invalid state '${s}'` }, 400);
      }
    }
    if (activeOnly !== undefined && activeOnly !== "1" && activeOnly !== "0")
      return c.json({ error: "invalid activeOnly (use 0 or 1)" }, 400);
    let parsedLimit: number | null = null;
    if (limit !== undefined) {
      parsedLimit = Number.parseInt(limit, 10);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000)
        return c.json({ error: "invalid limit (1-1000)" }, 400);
    }

    // Fetch the fleet roster once for rig filtering (m4): filter by sessions that
    // actually belong to the rig, not by the `@rig` suffix (seats like `dev-deepseek`).
    let rosterSessions: Set<string> | null = null;
    let resolvedRigName: string | null = null;
    if (rig !== undefined) {
      const { rigs } = await fetchFleetData();
      const match = rigs.find((r) => r.rigId === rig || r.name === rig);
      if (!match) return c.json({ error: `rig '${truncate(rig)}' not found in fleet` }, 404);
      resolvedRigName = match.name;
      rosterSessions = new Set<string>();
      for (const s of match.seats) {
        rosterSessions.add(s.session);
        // Also include the `pod-member` logical identity so queue items addressed
        // with a host-suffixed form still match when seats differ.
        rosterSessions.add(s.logicalId);
      }
    }

    if (sessionFilter) params.set("destinationSession", sessionFilter);
    if (state) params.set("state", state);
    if (activeOnly) params.set("activeOnly", activeOnly);
    if (parsedLimit !== null) params.set("limit", String(parsedLimit));

    const qs = params.toString();
    const res = await daemonFetch(`/api/queue/list${qs ? `?${qs}` : ""}`);
    if (!res.ok) {
      return c.json({ error: `daemon_error: ${res.status}` }, res.status as any);
    }
    const data = await res.json() as DaemonQueueItem[];

    let items = data.map(mapQueueItem);
    if (rosterSessions && resolvedRigName) {
      // Apply the rig filter client-side against the fleet roster.
      const touchesRig = (q: QueueItem) =>
        (q.sourceSession && rosterSessions!.has(q.sourceSession))
        || (q.destinationSession && rosterSessions!.has(q.destinationSession))
        || (q.sourceSession?.endsWith(`@${resolvedRigName}`))
        || (q.destinationSession?.endsWith(`@${resolvedRigName}`));
      items = items.filter(touchesRig);
    }

    return c.json({ items });
  } catch (e) {
    return c.json({ error: daemonErr(e).message }, 502);
  }
});

app.get("/dash/queue/:qitemId", async (c) => {
  const qitemId = c.req.param("qitemId");
  if (!validParam(qitemId, QITEM_PATTERN)) return c.json({ error: "invalid qitemId parameter" }, 400);

  try {
    const itemRes = await daemonFetch(`/api/queue/${encodeURIComponent(qitemId)}`);
    if (!itemRes.ok) {
      return c.json({ error: `daemon_error: ${itemRes.status}` }, itemRes.status as any);
    }
    const transRes = await daemonFetch(`/api/queue/${encodeURIComponent(qitemId)}/transitions`);
    const item = await itemRes.json() as DaemonQueueItem;
    const transitions: DaemonQueueTransition[] = transRes.ok ? (await transRes.json() as DaemonQueueTransition[]) : [];

    return c.json({
      ...mapQueueItem(item),
      transitions: mapTransitions(transitions),
    } satisfies QueueItemWithTransitions);
  } catch (e) {
    return c.json({ error: daemonErr(e).message }, 502);
  }
});

app.post("/dash/queue", async (c) => {
  let body: { destinationSession: string; body: string; priority?: string; tags?: string[]; summary?: string; evidenceRef?: string };
  try {
    body = await c.req.json() as typeof body;
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  if (typeof body.destinationSession !== "string" || !validParam(body.destinationSession, SESSION_PATTERN))
    return c.json({ error: "invalid destinationSession" }, 400);
  if (typeof body.body !== "string" || body.body.length === 0)
    return c.json({ error: "body is required" }, 400);
  if (body.summary !== undefined && typeof body.summary !== "string")
    return c.json({ error: "invalid summary (must be a string)" }, 400);
  if (body.evidenceRef !== undefined && typeof body.evidenceRef !== "string")
    return c.json({ error: "invalid evidenceRef (must be a string)" }, 400);

  try {
    const daemonBody: Record<string, unknown> = {
      destinationSession: body.destinationSession,
      body: body.body,
      priority: body.priority ?? "routine",
      tags: Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === "string") : [],
      ...(body.summary !== undefined ? { summary: body.summary } : {}),
      ...(body.evidenceRef !== undefined ? { evidenceRef: body.evidenceRef } : {}),
    };
    const res = await daemonFetch(`/api/queue/create`, {
      method: "POST",
      headers: { ...daemonHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(daemonBody),
    });
    const data = await res.json() as DaemonQueueItem | { error?: string };
    if (!res.ok || (data as { error?: string }).error) {
      return c.json({ error: (data as { error?: string }).error ?? `http_${res.status}` }, (res.ok ? 200 : res.status) as any);
    }
    return c.json(mapQueueItem(data as DaemonQueueItem), 201);
  } catch (e) {
    return c.json({ error: daemonErr(e).message }, 502);
  }
});

app.post("/dash/queue/:qitemId/update", async (c) => {
  const qitemId = c.req.param("qitemId");
  if (!validParam(qitemId, QITEM_PATTERN)) return c.json({ error: "invalid qitemId parameter" }, 400);
  let body: { state: string; note?: string };
  try {
    body = await c.req.json() as typeof body;
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  if (typeof body.state !== "string" || !body.state) return c.json({ error: "state is required" }, 400);

  try {
    const daemonBody: Record<string, unknown> = { state: body.state, transitionNote: body.note ?? null };
    const closureReason = daemonClosureReason(body.state);
    if (closureReason) daemonBody.closureReason = closureReason;

    const res = await daemonFetch(`/api/queue/${encodeURIComponent(qitemId)}/update`, {
      method: "POST",
      headers: { ...daemonHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(daemonBody),
    });
    const data = await res.json() as DaemonQueueItem | { error?: string };
    if (!res.ok || (data as { error?: string }).error) {
      return c.json({ error: (data as { error?: string }).error ?? `http_${res.status}` }, (res.ok ? 200 : res.status) as any);
    }
    return c.json(mapQueueItem(data as DaemonQueueItem));
  } catch (e) {
    return c.json({ error: daemonErr(e).message }, 502);
  }
});

app.post("/dash/queue/:qitemId/handoff", async (c) => {
  const qitemId = c.req.param("qitemId");
  if (!validParam(qitemId, QITEM_PATTERN)) return c.json({ error: "invalid qitemId parameter" }, 400);
  let body: { toSession: string; note?: string };
  try {
    body = await c.req.json() as typeof body;
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  if (typeof body.toSession !== "string" || !validParam(body.toSession, SESSION_PATTERN))
    return c.json({ error: "invalid toSession" }, 400);

  try {
    const res = await daemonFetch(`/api/queue/${encodeURIComponent(qitemId)}/handoff`, {
      method: "POST",
      headers: { ...daemonHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ toSession: body.toSession, transitionNote: body.note ?? null }),
    });
    const raw = await res.json() as Record<string, unknown>;
    if (!res.ok || raw.error) {
      return c.json({ error: (raw.error as string) ?? `http_${res.status}` }, (res.ok ? 200 : res.status) as any);
    }
    const created = raw.created as DaemonQueueItem | undefined;
    return c.json(mapQueueItem(created ?? (raw as DaemonQueueItem)));
  } catch (e) {
    return c.json({ error: daemonErr(e).message }, 502);
  }
});

// -- Wave 3: Rig-beheer ----------------------------------------------------

function checkConfirm(confirm: unknown, expected: string): string | null {
  if (typeof confirm !== "string" || confirm !== expected)
    return "confirm does not match the required rig/session name";
  return null;
}

async function fetchRigNameById(rigId: string): Promise<string | null> {
  try {
    const res = await daemonFetch(`/api/rigs/${encodeURIComponent(rigId)}`);
    if (!res.ok) return null;
    const rig = await res.json() as { rig?: { name?: string }; name?: string };
    return rig.rig?.name ?? rig.name ?? null;
  } catch { return null; }
}

async function fetchSessionSeatInfo(session: string): Promise<{ rigId: string; rigName: string; seat: Seat } | null> {
  const { rigs, liveSessions } = await fetchFleetData();
  const matches: Array<{ rigId: string; rigName: string; seat: Seat }> = [];
  for (const r of rigs) {
    for (const s of r.seats) {
      if (s.session === session) matches.push({ rigId: r.rigId, rigName: r.name, seat: s });
    }
  }
  if (matches.length === 0) return null;
  // Prefer a running (live) node when duplicate session names exist across rigs (m2).
  const liveMatch = matches.find((m) => liveSessions.has(m.seat.session));
  return liveMatch ?? matches[0];
}

// Central ActionResult normalizer for wave-3 mutations (fix 9).
async function proxyMutation(
  c: { json: (body: unknown, status?: number) => unknown },
  method: string,
  path: string,
  daemonBody: Record<string, unknown>,
  message: string,
): Promise<Response> {
  try {
    const res = await daemonFetch(path, {
      method,
      headers: { ...daemonHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(daemonBody),
    });
    const raw = await res.json().catch(() => null);
    if (!res.ok) {
      const rawErr = raw as { error?: unknown; message?: unknown };
      const msg = typeof rawErr?.message === "string"
        ? rawErr.message
        : rawErr?.error !== undefined
          ? `daemon error ${res.status}`
          : `daemon returned ${res.status}`;
      return c.json(errorResult(msg, raw), res.status as any) as unknown as Response;
    }
    return c.json({ ok: true, message, detail: raw }) as unknown as Response;
  } catch (e) {
    return c.json(daemonErr(e), 502) as unknown as Response;
  }
}

app.post("/dash/rigs/up", async (c) => {
  let body: { source: string };
  try { body = await c.req.json() as typeof body; } catch { return c.json(errorResult("invalid_json"), 400); }
  if (typeof body.source !== "string" || !body.source) return c.json(errorResult("source is required"), 400);
  // m8: only absolute spec paths are accepted; parse YAML top-level `name`; no echo on reject.
  const sourceName = await resolveSourceRigName(body.source);
  if (sourceName === null) {
    const denied = assertDashtest(body.source, true);
    return c.json(errorResult(denied ?? "unable to validate spec source: absolute .yaml path required"), 403);
  }
  const denied = assertDashtest(sourceName);
  if (denied) return c.json(errorResult(denied), 403);
  return proxyMutation(c, "POST", `/api/up`, { sourceRef: body.source }, `Rig started from '${body.source}'`);
});

function assertDashtest(raw: unknown, allowlistOnly = false): string | null {
  const name = typeof raw === "string" ? raw : "";
  if (!name) return "rig name required for mutation guard";
  if (allowlistOnly && name.startsWith("/")) return "absolute spec path allowed only through allowlist name check";
  if (MUTATION_ALLOWLIST === null) return null; // no allowlist → no restriction
  if (MUTATION_ALLOWLIST.has(name)) return null;
  return `mutations are only allowed on rig(s) in DASH_MUTATION_ALLOWLIST (${MUTATION_ALLOWLIST_ENV}) — got '${truncate(name)}'`;
}

async function resolveSourceRigName(source: string): Promise<string | null> {
  // m8: only absolute paths; relative/`.`/library names are rejected.
  if (typeof source !== "string" || !source.startsWith("/")) return null;
  if (!/\.ya?ml$/i.test(source)) return null;
  const fs = await import("node:fs");
  try {
    const text = fs.readFileSync(source, "utf8");
    // Top-level YAML `name:` only (no indentation). Single-line scalar.
    for (const line of text.split("\n")) {
      if (/^name\s*:\s*/.test(line)) {
        const value = line.replace(/^name\s*:\s*/, "").trim().replace(/^["']|["']$/g, "");
        if (/^[A-Za-z0-9._-]+$/.test(value)) return value;
        return null;
      }
    }
    return null;
  } catch { return null; }
}

app.post("/dash/rigs/:rigId/up", async (c) => {
  const rigId = c.req.param("rigId");
  if (!validParam(rigId, RIG_ID_PATTERN)) return c.json(errorResult("invalid rigId"), 400);
  const rigName = await fetchRigNameById(rigId);
  if (!rigName) return c.json(errorResult(`rig ${rigId} not found`), 404);
  const denied = assertDashtest(rigName);
  if (denied) return c.json(errorResult(denied), 403);
  return proxyMutation(c, "POST", `/api/rigs/${encodeURIComponent(rigId)}/up`, {}, `Rig '${rigName}' started`);
});

app.post("/dash/rigs/:rigId/down", async (c) => {
  const rigId = c.req.param("rigId");
  if (!validParam(rigId, RIG_ID_PATTERN)) return c.json(errorResult("invalid rigId"), 400);
  const rigName = await fetchRigNameById(rigId);
  if (!rigName) return c.json(errorResult(`rig ${rigId} not found`), 404);
  let body: { confirm: string };
  try { body = await c.req.json() as typeof body; } catch { return c.json(errorResult("invalid_json"), 400); }
  const confirmErr = checkConfirm(body.confirm, rigName);
  if (confirmErr) return c.json(errorResult(confirmErr), 400);
  const denied = assertDashtest(rigName);
  if (denied) return c.json(errorResult(denied), 403);
  return proxyMutation(c, "POST", `/api/down`, { rigId }, `Rig '${rigName}' stopped`);
});

app.post("/dash/rigs/:rigId/archive", async (c) => {
  const rigId = c.req.param("rigId");
  if (!validParam(rigId, RIG_ID_PATTERN)) return c.json(errorResult("invalid rigId"), 400);
  const rigName = await fetchRigNameById(rigId);
  if (!rigName) return c.json(errorResult(`rig ${rigId} not found`), 404);
  const denied = assertDashtest(rigName);
  if (denied) return c.json(errorResult(denied), 403);
  return proxyMutation(c, "POST", `/api/rigs/${encodeURIComponent(rigId)}/archive`, { force: false }, `Rig '${rigName}' archived`);
});

app.post("/dash/rigs/:rigId/unarchive", async (c) => {
  const rigId = c.req.param("rigId");
  if (!validParam(rigId, RIG_ID_PATTERN)) return c.json(errorResult("invalid rigId"), 400);
  const rigName = await fetchRigNameById(rigId);
  if (!rigName) return c.json(errorResult(`rig ${rigId} not found`), 404);
  const denied = assertDashtest(rigName);
  if (denied) return c.json(errorResult(denied), 403);
  return proxyMutation(c, "POST", `/api/rigs/${encodeURIComponent(rigId)}/unarchive`, {}, `Rig '${rigName}' unarchived`);
});

function mapSnapshot(raw: Record<string, unknown>): Snapshot {
  const data = (raw.data ?? {}) as Record<string, unknown>;
  const rigData = (data.rig ?? {}) as Record<string, unknown>;
  const createdAt = (raw.createdAt ?? raw.created_at ?? rigData.updatedAt ?? rigData.createdAt) as string | null;
  return {
    id: raw.id as string,
    createdAt: createdAt ?? String(new Date()),
    kind: (raw.kind as string) ?? null,
    label: (raw.label as string) ?? (raw.status as string) ?? null,
  };
}

app.get("/dash/rigs/:rigId/snapshots", async (c) => {
  const rigId = c.req.param("rigId");
  if (!validParam(rigId, RIG_ID_PATTERN)) return c.json({ error: "invalid rigId" }, 400);
  try {
    const res = await daemonFetch(`/api/rigs/${encodeURIComponent(rigId)}/snapshots`);
    if (!res.ok) return c.json({ error: `daemon_error: ${res.status}` }, res.status as any);
    const raw = await res.json() as unknown[];
    return c.json(raw.map((s) => mapSnapshot(s as Record<string, unknown>)));
  } catch (e) {
    return c.json({ error: daemonErr(e).message }, 502);
  }
});

app.post("/dash/rigs/:rigId/snapshots", async (c) => {
  const rigId = c.req.param("rigId");
  if (!validParam(rigId, RIG_ID_PATTERN)) return c.json(errorResult("invalid rigId"), 400);
  const rigName = await fetchRigNameById(rigId);
  if (!rigName) return c.json(errorResult(`rig ${rigId} not found`), 404);
  const denied = assertDashtest(rigName);
  if (denied) return c.json(errorResult(denied), 403);
  try {
    const res = await daemonFetch(`/api/rigs/${encodeURIComponent(rigId)}/snapshots`, {
      method: "POST",
      headers: { ...daemonHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "manual" }),
    });
    const raw = await res.json().catch(() => null);
    if (!res.ok) {
      return c.json(errorResult(`daemon returned ${res.status}`, raw), res.status as any);
    }
    return c.json({ ok: true, message: `Snapshot created for '${rigName}'`, detail: raw });
  } catch (e) {
    return c.json(daemonErr(e), 502);
  }
});

// Restore: real daemon route is POST /api/rigs/:rigId/restore/:snapshotId
// (restoreRoutes mounted at /api/rigs/:rigId/restore in server.js:382). (fix 11)
app.post("/dash/snapshots/:snapshotId/restore", async (c) => {
  const snapshotId = c.req.param("snapshotId");
  if (!validParam(snapshotId, SNAPSHOT_PATTERN)) return c.json(errorResult("invalid snapshotId"), 400);
  let body: { confirm: string };
  try { body = await c.req.json() as typeof body; } catch { return c.json(errorResult("invalid_json"), 400); }
  if (typeof body.confirm !== "string" || !body.confirm) return c.json(errorResult("confirm (rig name) is required"), 400);
  const denied = assertDashtest(body.confirm);
  if (denied) return c.json(errorResult(denied), 403);
  try {
    const psRes = await daemonFetch(`/api/ps`);
    const daemonRigs = await psRes.json() as DaemonRig[];
    const candidates = daemonRigs.filter((r) => r.name === body.confirm);
    if (candidates.length === 0) return c.json(errorResult(`rig '${body.confirm}' not found`), 404);

    let rigId: string | null = null;
    for (const rig of candidates) {
      const snapRes = await daemonFetch(`/api/rigs/${encodeURIComponent(rig.rigId)}/snapshots`);
      if (!snapRes.ok) continue;
      const snaps = await snapRes.json() as Array<{ id: string }>;
      if (snaps.some((s) => s.id === snapshotId)) { rigId = rig.rigId; break; }
    }
    if (!rigId) return c.json(errorResult(`snapshot ${snapshotId} not found on rig '${body.confirm}'`), 404);

    const res = await daemonFetch(`/api/rigs/${encodeURIComponent(rigId)}/restore/${encodeURIComponent(snapshotId)}`, {
      method: "POST",
      headers: { ...daemonHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const raw = await res.json().catch(() => null);
    if (!res.ok) {
      return c.json(errorResult(`daemon returned ${res.status}: ${JSON.stringify(raw)}`, raw), res.status as any);
    }
    return c.json({ ok: true, message: `Snapshot ${snapshotId} restore started on '${body.confirm}'`, detail: raw });
  } catch (e) {
    return c.json(daemonErr(e), 502);
  }
});

app.post("/dash/seats/:session/launch", async (c) => {
  const session = c.req.param("session");
  if (!validParam(session, SESSION_PATTERN)) return c.json(errorResult("invalid session parameter"), 400);
  const info = await fetchSessionSeatInfo(session);
  if (!info) return c.json(errorResult(`session ${session} not found`), 404);
  const denied = assertDashtest(info.rigName);
  if (denied) return c.json(errorResult(denied), 403);
  let body: { fresh?: boolean; stop?: boolean; reason?: string } = {};
  try { body = (await c.req.json()) as typeof body; } catch { /* empty body OK */ }
  return proxyMutation(c, "POST", `/api/seat/launch/${encodeURIComponent(session)}`, {
    reason: body.reason ?? "dashboard launch",
    fresh: body.fresh ?? false,
    stop: body.stop ?? false,
  }, `Seat '${session}' launched`);
});

app.post("/dash/seats/:session/stop", async (c) => {
  const session = c.req.param("session");
  if (!validParam(session, SESSION_PATTERN)) return c.json(errorResult("invalid session parameter"), 400);
  const info = await fetchSessionSeatInfo(session);
  if (!info) return c.json(errorResult(`session ${session} not found`), 404);
  let body: { confirm: string };
  try { body = await c.req.json() as typeof body; } catch { return c.json(errorResult("invalid_json"), 400); }
  const confirmErr = checkConfirm(body.confirm, session);
  if (confirmErr) return c.json(errorResult(confirmErr), 400);
  const denied = assertDashtest(info.rigName);
  if (denied) return c.json(errorResult(denied), 403);
  return proxyMutation(c, "POST", `/api/seat/stop/${encodeURIComponent(session)}`, { reason: "dashboard stop" }, `Seat '${session}' stopped`);
});

app.get("/dash/seats/:session/model", async (c) => {
  const session = c.req.param("session");
  if (!validParam(session, SESSION_PATTERN)) return c.json({ error: "invalid session parameter" }, 400);
  try {
    const info = await fetchSessionSeatInfo(session);
    if (!info) return c.json({ error: "session not found" }, 404);
    const res = await daemonFetch(`/api/rigs/${encodeURIComponent(info.rigId)}/nodes/${encodeURIComponent(info.seat.logicalId)}`);
    const current = res.ok ? ((await res.json()) as { model?: string }).model ?? null : null;
    return c.json({ current, available: [] } satisfies SeatModel);
  } catch (e) {
    return c.json({ error: daemonErr(e).message }, 502);
  }
});

app.post("/dash/seats/:session/model", async (c) => {
  const session = c.req.param("session");
  if (!validParam(session, SESSION_PATTERN)) return c.json(errorResult("invalid session parameter"), 400);
  const info = await fetchSessionSeatInfo(session);
  if (!info) return c.json(errorResult(`session ${session} not found`), 404);
  const denied = assertDashtest(info.rigName);
  if (denied) return c.json(errorResult(denied), 403);
  let body: { model: string };
  try { body = await c.req.json() as typeof body; } catch { return c.json(errorResult("invalid_json"), 400); }
  if (typeof body.model !== "string" || !body.model) return c.json(errorResult("model is required"), 400);
  return proxyMutation(c, "POST", `/api/seat/set-model/${encodeURIComponent(session)}`, {
    model: body.model, reason: "dashboard set-model",
  }, `Model for '${session}' set to '${body.model}'`);
});

// Posture (fix 8): contractual PUT body is { mode, record }. Web is being updated
// to match; GET propagates daemon non-OK.
app.get("/dash/rigs/:rigId/posture", async (c) => {
  const rigId = c.req.param("rigId");
  if (!validParam(rigId, RIG_ID_PATTERN)) return c.json({ error: "invalid rigId" }, 400);
  try {
    const res = await daemonFetch(`/api/rig-mode/effective?rig=${encodeURIComponent(rigId)}`);
    if (!res.ok) {
      return c.json({ error: `daemon_error: ${res.status}` }, res.status as any);
    }
    const raw = await res.json() as Record<string, unknown>;
    const binding = raw.effective as Record<string, unknown> | null;
    return c.json({
      scope: "rig",
      effective: binding ?? {},
      editable: DAEMON_OPERATOR_BEARER !== null,
      ...(DAEMON_OPERATOR_BEARER === null
        ? { editorNote: "requires operator token: set OPENRIG_AUTH_BEARER_TOKEN on the dashboard server" }
        : {}),
    } satisfies RigPosture & { editorNote?: string });
  } catch (e) {
    return c.json({ error: daemonErr(e).message }, 502);
  }
});

app.put("/dash/rigs/:rigId/posture", async (c) => {
  const rigId = c.req.param("rigId");
  if (!validParam(rigId, RIG_ID_PATTERN)) return c.json(errorResult("invalid rigId"), 400);
  const rigName = await fetchRigNameById(rigId);
  if (!rigName) return c.json(errorResult(`rig ${rigId} not found`), 404);
  const denied = assertDashtest(rigName);
  if (denied) return c.json(errorResult(denied), 403);
  if (!DAEMON_OPERATOR_BEARER)
    return c.json(errorResult("requires operator token: set OPENRIG_AUTH_BEARER_TOKEN on the dashboard server"), 403);
  let body: { mode: string; record: Record<string, unknown> };
  try { body = await c.req.json() as typeof body; } catch { return c.json(errorResult("invalid_json"), 400); }
  if (typeof body.mode !== "string" || !body.mode) return c.json(errorResult("mode is required"), 400);
  if (typeof body.record !== "object" || body.record === null || Array.isArray(body.record))
    return c.json(errorResult("record object is required"), 400);
  try {
    const headers = { ...daemonHeaders(), "Content-Type": "application/json", Authorization: `Bearer ${DAEMON_OPERATOR_BEARER}` };
    const res = await daemonFetch(`/api/rig-mode/bindings/rig/${encodeURIComponent(rigId)}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ mode: body.mode, record: body.record }),
    });
    const raw = await res.json().catch(() => null);
    if (!res.ok) {
      return c.json(errorResult(`daemon returned ${res.status}: ${JSON.stringify(raw)}`, raw), res.status as any);
    }
    return c.json({ ok: true, message: `Posture for '${rigName}' set to '${body.mode}'`, detail: raw });
  } catch (e) {
    return c.json(daemonErr(e), 502);
  }
});

app.post("/dash/discovery/scan", async (c) => {
  try {
    const res = await daemonFetch(`/api/discovery/scan`, {
      method: "POST",
      headers: { ...daemonHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      return c.json({ error: `daemon_error: ${res.status}` }, res.status as any);
    }
    const raw = await res.json() as { sessions?: Array<Record<string, unknown>> } | null;
    const sessions = raw?.sessions ?? [];
    const mapped: DiscoveredSession[] = sessions.map((s: Record<string, unknown>) => ({
      id: String(s.id ?? ""),
      session: String(s.tmuxSession ?? s.session ?? ""),
      runtime: (s.runtimeHint as string) ?? null,
      cwd: (s.cwd as string) ?? null,
      boundTo: (s.claimedNodeId as string) ?? null,
    }));
    return c.json(mapped);
  } catch (e) {
    return c.json({ error: daemonErr(e).message }, 502);
  }
});

app.post("/dash/discovery/:id/bind", async (c) => {
  const discId = c.req.param("id");
  if (!validParam(discId, DISCOVERY_PATTERN)) return c.json(errorResult("invalid discovery id"), 400);
  let body: { rigId: string; logicalId?: string; podNamespace?: string; memberName?: string };
  try { body = await c.req.json() as typeof body; } catch { return c.json(errorResult("invalid_json"), 400); }
  if (typeof body.rigId !== "string" || !validParam(body.rigId, RIG_ID_PATTERN))
    return c.json(errorResult("invalid rigId"), 400);
  const hasNode = typeof body.logicalId === "string" && validParam(body.logicalId, LOGICAL_ID_PATTERN);
  const hasPod = typeof body.podNamespace === "string" && typeof body.memberName === "string"
    && validParam(body.podNamespace, /^[A-Za-z0-9._:-]{1,100}$/)
    && validParam(body.memberName, LOGICAL_ID_PATTERN);
  if (!hasNode && !hasPod) return c.json(errorResult("specify logicalId (existing node) or podNamespace + memberName (create in pod)"), 400);
  if (hasNode && hasPod) return c.json(errorResult("specify either logicalId or podNamespace+memberName, not both"), 400);

  const rigName = await fetchRigNameById(body.rigId);
  if (!rigName) return c.json(errorResult(`rig ${body.rigId} not found`), 404);
  const denied = assertDashtest(rigName);
  if (denied) return c.json(errorResult(denied), 403);
  return proxyMutation(c, "POST", `/api/discovery/${encodeURIComponent(discId)}/bind`, {
    rigId: body.rigId,
    ...(hasNode ? { logicalId: body.logicalId } : {}),
    ...(hasPod ? { podNamespace: body.podNamespace, memberName: body.memberName } : {}),
  }, `Discovered session bound to rig '${rigName}'`);
});

// -- Start ----------------------------------------------------------------
// Fix 1: bind explicitly to 127.0.0.1 and log the actual host.
const PORT = Number(process.env.PORT ?? 7500);
startQueueSseWatcher();
const server = serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => {
  const addr = typeof info.address === "string" ? info.address : JSON.stringify(info.address ?? {});
  console.log(`dashboard server listening on http://127.0.0.1:${info.port} (bound addr: ${addr})`);
});

injectWebSocket(server);