# Needs-You: Card-to-Session Mapping — Discovery Report

## 1. How "needs you" items arise

There are **two independent paths** that produce needs-you items:

### Path A: Daemon-side — `/api/review/rig`

The `domain/review/compose.js` module (`daemon/dist`) constructs a `needsYou` block with two source types:

| source     | Meaning                                    | fields present                        |
|------------|--------------------------------------------|---------------------------------------|
| `agent`    | Queue items requiring human action         | `qitemId`, `destinationSession`, etc. |
| `derived`  | Computed exceptions (stuck, overdue, etc.) | `qitemId` is `null`; `destinationSession` is `null` |

The `agent` items come from the queue's attention list — items where `destinationSession` matches `isHumanSeatSessionRef()` (`/^human(?:-[A-Za-z0-9._-]+)?@(kernel|host)$/` or `/^[A-Za-z0-9._:-]+@external$/`).

The `derived` items are computed from `queue + ps`: a seat that has held a queue item without meaningful transition past a threshold (default 120 min) becomes a "stuck" exception.

### Path B: UI-side polling — `/api/ps` → `/api/rigs/*/nodes?full=true`

The UI (`index-BVW54ItO.js`) has a `$Se` polling function that runs every 10 seconds:
1. `GET /api/ps` → list all pods/rigs
2. For each rig: `GET /api/rigs/{rigId}/nodes?full=true`
3. Filters nodes where `agentActivity` + `terminalActive` → `state === "needs_input"`
4. Creates a **synthetic** card (`DSe`) with `kind: "action-required"`

These synthetic cards carry `sessionName` from the node's `canonicalSessionName`.

### Three feed filter levels (UI)

- `all-activity` — everything
- `highlights` — needs-you + approvals + ships + progress
- `needs-you` — action items only

---

## 2. Session resolution in the UI (root cause of "No session resolved")

### The resolution function `Nje(e, t, n)`:

```js
// e = card kind, t = source session, n = destination session
function Nje(e, t, n) {
  return e === "action-required" || e === "approval"
    ? t      // uses sourceSession instead!
    : n ?? t;
}
```

Wait — correction from source: it returns `t` (sourceSession) for action-required/approval cards. The `n ?? t` fallback means: prefer destination, fall back to source.

Actually, let me re-read:

```js
const M = Nje(e.kind, E, N);
// E = b?.source ?? e.authorSession (source session)
// N = b?.destination (destination session)
// For "action-required" or "approval": M = E (source session)
// For all other kinds: M = N ?? E (destination, fallback source)
```

Wait, let me re-check the actual code from the explorer output:

```js
function Nje(e, t, n) {
  return e === "action-required" || e === "approval" ? t : n ?? t;
}
```

So:
- For **action-required**: returns `t` (which is `sourceSession`)
- For **approval**: returns `t` (which is `sourceSession`)
- For **everything else**: returns `n ?? t` (destination, fallback source)

But the explorer also showed this from the calling code:

```js
const b = Rje(e, t);           // Extract qitemId, source, destination, state from card
const E = (b?.source) ?? e.authorSession;  // source session
const N = b?.destination;      // destination session
const k = (N != null && N.startsWith("human")) ? N : "human@host";  // destination for actions
const M = Nje(e.kind, E, N);   // THE RESOLVED SESSION
```

### The live terminal button `hje({cardId, sessionName})`:

```js
function hje({ cardId: e, sessionName: t }) {
  if (!t)
    return /* disabled button with title: "No session resolved for this card" */;
  // ... enabled button, dispatches CustomEvent("openrig:topology-terminal-preview", ...)
}
```

If the resolved `M` is falsy (`null`/`undefined`/`""`), the button renders disabled with the error message.

### Why it fails — three scenarios:

**Scenario 1 — Human-addressed queue item** (`destinationSession` = `human@kernel`)
- `N` = `"human@kernel"`, `E` = source agent session
- `Nje("action-required", E, "human@kernel")` → returns `E` (the source/agent session)
- If `E` is a valid agent session (e.g. `dev-owner@first-project`), the button works
- If `E` is also a human ref or missing (e.g. the item was created by a human), `M` could be `human@kernel` which is not a tmux session — the terminal dispatch will fail

**Scenario 2 — Derived/stuck exception** (`qitemId` = `null`, `destinationSession` = `null`)
- `N` = `null`, `E` = probably `null` or the operator human session
- `Nje("action-required", null, null)` → returns `null`
- Button shows "No session resolved"

**Scenario 3 — Activity-grade needs-input** (synthetic card from `DSe`)
- `DSe` sets `body: e.sessionName` (from the polling data's `canonicalSessionName`)
- The extracting code tries to interpret `body` as a session name
- If `body` is falsy, resolution fails

---

## 3. Key data sources and their session fields

### `/api/queue/list` (QueueItem)

| field               | content                         | example                                      |
|---------------------|---------------------------------|----------------------------------------------|
| `qitemId`           | Unique queue row ID             | `qitem-20260924120632-8accaf37`              |
| `sourceSession`     | Who created/sent the item       | `dev-owner@first-project`                    |
| `destinationSession`| Who must act on it              | `human@kernel` or `dev-codexdev@dashboard-team` |
| `blockedOn`         | Session blocking progress       | `human@kernel` or `null`                     |
| `state`             | pending / in-progress / done    | `pending`                                    |

**Critical**: `destinationSession` may be:
- A real agent session (`dev-codexdev@dashboard-team`) ✓
- A virtual human ref (`human@kernel`, `human@host`) ✗ — no terminal
- A virtual external ref (`mike@external`) ✗ — no terminal
- `null` (for derived exceptions) ✗ — no terminal

### `/api/rigs/*/nodes?full=true` (Node state)

| field                  | content              | example                          |
|------------------------|----------------------|----------------------------------|
| `logicalId`            | pod.member           | `dev.codexdev`                   |
| `canonicalSessionName` | session@rig          | `dev-codexdev@dashboard-team`    |
| `agentActivity`        | Activity probe data  | `{ state: "needs_input", ... }`  |
| `terminalActive`       | Terminal focus state | boolean                          |
| `runtime`              | Agent runtime        | `codex`                          |
| `status`               | running / down       | `running`                        |

This is the **authoritative source** for session name ↔ logical ID mapping.

### `/api/mission-control/destinations`

| field       | content                                   | example                             |
|-------------|-------------------------------------------|-------------------------------------|
| `sessionName`| The canonical session name                | `dev-codexdev@dashboard-team`       |
| `logicalId` | Pod member identifier                     | `dev.codexdev`                      |
| `rigName`   | Rig name                                  | `dashboard-team`                    |
| `runtime`   | Agent runtime                             | `codex`                             |
| `status`    | running / down                            | `running`                           |
| `label`     | Human-readable `logicalId@rigName`        | `dev.codexdev@dashboard-team`       |
| `source`    | Where the entry came from (`topology`/`queue`/`fallback`) | `topology` |

This is the **complete live roster** of sessions the daemon knows about. Every running agent seat appears here.

### `/api/review/rig` (NeedsYou)

| field               | content                               | example                              |
|---------------------|---------------------------------------|--------------------------------------|
| `source`            | `"agent"` or `"derived"`             | `"derived"`                          |
| `qitemId`           | Queue item ID (`null` for derived)    | `null`                               |
| `destinationSession`| Session that must act (`null` for derived) | `null`                          |
| `derived.kind`      | `"stuck"` or other exception type     | `"stuck"`                            |
| `identity`          | Unique key for the needs-you item     | `dev-owner@first-project\|too-long-in-state\|...` |

---

## 4. Why "No session resolved" occurs

The **live terminal** button calls `hje(cardId, resolvedSession)` where `resolvedSession` is derived from `Nje()`.

| Condition                                                    | `M` (resolved session) | Button state           |
|--------------------------------------------------------------|------------------------|------------------------|
| Agent-addressed queue item (e.g. `dev-codexdev@…`)           | Agent session name     | ✅ Enabled             |
| Human-addressed queue item, created by an agent               | Agent's session name   | ✅ Enabled             |
| Human-addressed queue item, created by human (or no source)  | `human@kernel` or null | ❌ Disabled            |
| Derived/stuck exception (`destinationSession` = null)        | null                   | ❌ "No session resolved" |

The **specific scenarios** from the current daemon instance:
- `/api/review/rig` returns one `derived` needs-you item for `dev-owner@first-project` (stuck, no destinationSession). The UI would try to resolve a session, fail, and show "No session resolved".
- The synthetic `needs-input` cards from polling could also fail if the node's `canonicalSessionName` is null (this happens for my own seat `dev-deepseek` — runtime is `null`).

---

## 5. Proposal: reliable card→session mapping

### Problem statement

The UI currently uses a heuristic (`Nje`) that picks either `sourceSession` or `destinationSession` from a queue item. Neither field is guaranteed to be a real, terminal-addressable agent session. When the `sessionName` prop is falsy or points to a virtual human address, the live terminal button fails.

### Proposed approach

**Option A — Push: daemon augments attention/needs-you items with a `liveTerminalSession` field**

The daemon knows the topology. When constructing attention items or the `/api/review/rig` response, it can cross-reference `destinationSession` against the known sessions from its topology/sessions table:
- If the destination matches a known agent session → use that as `liveTerminalSession`
- If the destination is a human ref (`human@kernel`) → look up the `blockedOn` or the item's chain to find the originating agent session
- If the item is derived → attach the session from the exception data

This would be the cleanest solution since the daemon has all the context.

**Option B — Pull: UI cross-references against `/api/mission-control/destinations`**

The UI already calls `/api/ps` + node detail. It could:
1. Maintain a map of known agent sessions from destinations
2. After `Nje` resolves a session name, validate it against this map
3. If the resolved name is a human ref or doesn't exist in the map, fall back:
   - For action-required cards: search queue item `blockedOn` or `sourceSession` against the map
   - For derived items: extract the seat name from `identity` field (e.g. `dev-owner@first-project|...`) and cross-reference against the map

**Option C — Hybrid: add `resolvedSession` to the queue item itself**

When creating queue items, the daemon could store both `destinationSession` (routing address) and `resolvedSession` (the actual tmux-attachable session name). This adds redundancy but is explicit.

### Recommended: Option A (daemon push) + Option B (UI fallback)

- **Daemon change** (low effort): In `/api/review/rig`'s `compose.js`, add a `liveTerminalSession` field to each needs-you item, resolved from the topology session table. For agent items: use `destinationSession` if it's a real agent, otherwise trace to the originating seat. For derived: use the stuck seat's `sessionName`.
- **UI change** (low effort): Before passing `M` to `hje`, validate against the known destinations map. If invalid, show a more specific message (e.g., "This card is addressed to a human — route it to an agent to open a terminal").

### Current state assessment

For the dashboard-team rig specifically:
- `dev-codexdev@dashboard-team` → ✅ resolves (Codex runtime, known session)
- `dev-reviewer@dashboard-team` → ✅ resolves (Codex runtime, known session)
- `dev-deepseek` → ⚠️ runtime is `null` in destinations (OpenCode), canonicalSessionName may work
- Derived stuck exceptions → ❌ no session, will show "No session resolved"
- Human-addressed items → ❌ unless source is an agent session

### Open question

For our own dashboard: do we want to replicate OpenRig's feed/attention UI, or build a different abstraction on top of the daemon API? If we build our own, we control the card→session mapping from the start — the question is which endpoints we consume and how we render them.