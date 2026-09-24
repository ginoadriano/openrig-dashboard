# API contract — web and server

This document gives the API between the web interface (`web/`) and the dashboard server (`server/`).

## 1. General rules

- The web interface sends requests **only** to the dashboard server. It never sends requests to the daemon (`:7433`).
- All paths start with `/dash`. During development, Vite sends `/dash` (also WebSockets) to `http://127.0.0.1:7500`.
- The types are defined in `server/src/contract.ts`. The web interface uses a copy in `web/src/types.ts`. Keep the two files identical.
- Always URL-encode the `:session` parameter (`@` becomes `%40`).
- The server sets the sender identity (`X-OpenRig-Session`) for each change. The web interface never sends a sender identity.

### 1.1 Errors

- A read error or a queue error has the shape `{ error: string, message?: string }`.
  `error` is a code. `message` is a readable explanation, often from the daemon.
- A management action always returns an `ActionResult` (see section 5).
- The web interface shows `message` when it is available. Otherwise it shows `error`.

### 1.2 Request refusal

| Status | Cause |
|---|---|
| 400 | An identifier or a query parameter is not valid. The server does not send the request to the daemon. |
| 403 | The `Host` header is unknown, or the `Origin` header is missing or unknown for a change or a WebSocket upgrade. Or the rig is not in `DASH_MUTATION_ALLOWLIST`. |
| 502 / 504 | The daemon sent an error, or it did not reply in 8 seconds. |

## 2. Fleet and Needs you

```ts
type SeatActivity = "working" | "idle" | "needs_input" | "unknown";

interface Seat {
  logicalId: string;          // for example "dev.codexdev"
  session: string;            // tmux session name, for example "dev-codexdev@dashboard-team"
  runtime: string | null;     // "claude-code", "codex", "terminal", ... or null
  lifecycle: string | null;   // lifecycle state of the node, as the daemon gives it
  activity: SeatActivity;     // "unknown" when the daemon does not know. Never "idle" by assumption.
  hasWork: boolean;
  reason: string | null;      // raw daemon reason, for a tooltip
}

interface Rig {
  rigId: string;              // ULID
  name: string;
  status: string;
  attentionCount: number;
  seats: Seat[];
}

interface NeedsYouItem {
  id: string;                 // stable across refreshes
  kind: string;               // "queue_human", "stuck", "permission_prompt", ...
  title: string;
  detail: string | null;
  rigName: string | null;
  logicalId: string | null;
  session: string;            // always a live tmux session
  createdAt: string | null;   // ISO 8601
  source: string;             // the daemon source of the item
}
```

| Method | Path | Response |
|---|---|---|
| GET | `/dash/fleet` | `Rig[]` |
| GET | `/dash/needs-you` | `{ items: NeedsYouItem[], unresolved: Omit<NeedsYouItem, "session">[] }` |
| GET | `/dash/events` | Server-sent events: `data: {"type":"invalidate","scope":"fleet" \| "needs-you" \| "queue"}`. Get the data of that scope again. |

For the resolution sequence of the Needs you session, see `SCOPE.md`, section 3.1.

## 3. Seats: output, message and terminal

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/dash/seats/:session/output?lines=200` | — | `{ text: string }` (recent screen output) |
| POST | `/dash/seats/:session/send` | `{ text: string }` | `{ ok: true, warning?: string }` or `{ ok: false, error: string }` |
| WS | `/dash/terminal/:session` | see below | see below |

### 3.1 Terminal WebSocket

- **Server to client:** raw terminal text with ANSI codes. Give it directly to a terminal emulator (xterm.js).
- **Client to server:** JSON text frames. The server accepts only these three types:
  ```json
  {"type":"text","text":"hello"}
  {"type":"keys","keys":["Enter"]}
  {"type":"scroll","offset":30}
  ```
  `offset` is the number of lines above the live bottom. Use `0` to go back to live.
- There is **no resize frame**. Many viewers share one tmux pane. The client scales the view with CSS only.
- **Early frames:** the server keeps a maximum of 32 frames or 256 KiB until the daemon connection is open.
  If the client sends more, the server closes the client with code `1009`.
- **Close codes:** when the daemon closes, the server closes the client with the same code and reason
  (for example `1008 session not found`). A frame that is not valid closes the client with `1007` or `1008`.
  The web interface shows the reason. It connects again only after `1006` or `1011`.

## 4. Queue

```ts
type QueueState = "pending" | "in-progress" | "blocked" | "done" | "handed-off" | "failed" | "canceled"
                | (string & {});       // show an unknown state; do not fail

interface QueueItem {
  qitemId: string;
  state: QueueState;
  priority: string | null;             // for example "routine", "urgent"
  tier: string | null;
  sourceSession: string;
  destinationSession: string;
  body: string;                        // can have many lines; the first line is the title in a list
  tags: string[];
  tsCreated: string;                   // ISO 8601
  tsUpdated: string;
  blockedOn: string | null;
  handedOffTo: string | null;
  stalled: string | null;              // daemon pickup state when the item is stalled, otherwise null
}

interface QueueTransition {
  at: string;                          // ISO 8601
  fromState: string | null;            // null for the first transition
  toState: string;
  actor: string | null;
  note: string | null;
}
```

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/dash/queue?rig=&session=&state=a,b&activeOnly=1&limit=` | — | `{ items: QueueItem[] }`, newest first |
| GET | `/dash/queue/:qitemId` | — | `QueueItem & { transitions: QueueTransition[] }` |
| POST | `/dash/queue` | `{ destinationSession, body, priority?, tags?, summary?, evidenceRef? }` | `QueueItem` or an error |
| POST | `/dash/queue/:qitemId/update` | `{ state, note? }` | `QueueItem` or an error |
| POST | `/dash/queue/:qitemId/handoff` | `{ toSession, note? }` | `QueueItem` or an error |

Rules:

- The `rig` filter uses the seats of the rig in the fleet. The server applies the filter before the `limit`.
- A task to a human address (`human@kernel`, `human-…@host`, `…@external`) must have `summary` and `evidenceRef`.
  Otherwise the daemon refuses it (`human_route_fields_required`).
- The server refuses a destination (create) or a target (handoff) whose tmux session has no `@<rig>` part.
  The daemon accepts such a task but cannot wake the seat. The error message tells the operator to use Chat
  or to bind the seat again with a name `<name>@<rig>`.
- To cancel an item, send `{ "state": "canceled" }` without a closure reason.

## 5. Rig management

Each management action returns an `ActionResult`:

```ts
interface ActionResult { ok: boolean; message: string; detail?: unknown }   // detail = raw daemon response

interface Snapshot { id: string; createdAt: string; kind: string | null; label: string | null }
interface DiscoveredSession { id: string; session: string; runtime: string | null; cwd: string | null; boundTo: string | null }
interface SeatModel { current: string | null; available: string[] }         // "available" can be empty: then use free text
interface RigPosture { scope: string; effective: Record<string, unknown>; editable: boolean }
```

| Method | Path | Request | Function |
|---|---|---|---|
| POST | `/dash/rigs/up` | `{ source }` | Start a rig from a spec file. `source` must be an absolute path. |
| POST | `/dash/rigs/:rigId/up` | — | Start a stopped rig again. |
| POST | `/dash/rigs/:rigId/down` | `{ confirm: rigName }` | Stop a rig. **Destructive.** |
| POST | `/dash/rigs/:rigId/archive`, `/unarchive` | — | Archive or unarchive a rig. |
| GET | `/dash/rigs/:rigId/snapshots` | — | `Snapshot[]` |
| POST | `/dash/rigs/:rigId/snapshots` | — | Make a snapshot. |
| POST | `/dash/snapshots/:snapshotId/restore` | `{ confirm: rigName }` | Restore a snapshot. **Destructive.** The rig must be stopped. |
| POST | `/dash/seats/:session/launch` | `{ fresh?, stop?, reason? }` | Launch a seat. |
| POST | `/dash/seats/:session/stop` | `{ confirm: session }` | Stop a seat. **Destructive.** |
| GET | `/dash/seats/:session/model` | — | `SeatModel` |
| POST | `/dash/seats/:session/model` | `{ model }` | Change the model. In OpenRig 0.5.14 the change is not kept after a restart. |
| GET | `/dash/rigs/:rigId/posture` | — | `RigPosture` |
| PUT | `/dash/rigs/:rigId/posture` | `{ mode: string, record: Record<string, unknown> }` | Change the posture. Requires `OPENRIG_AUTH_BEARER_TOKEN`. |
| POST | `/dash/discovery/scan` | — | `DiscoveredSession[]` |
| POST | `/dash/discovery/:id/bind` | `{ rigId, logicalId }` | Bind a discovered tmux session to a rig. |

Rules for destructive actions:

- The web interface enables the confirm button only after the operator types the exact name.
- The server compares `confirm` with the name again. If they are not identical, it refuses with 400.
  The error message does not repeat the typed value.
- If `DASH_MUTATION_ALLOWLIST` is set and the rig is not in it, the server refuses with 403.
