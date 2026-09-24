import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mapTransitions } from "../src/queue-transitions.js";

// Real daemon shape from GET /api/queue/:qitemId/transitions (live sample).
const daemonSample = [
  {
    transitionId: 49,
    qitemId: "qitem-20260924140210-49fa9923",
    ts: "2026-09-24T14:02:10.596Z",
    state: "pending",
    transitionNote: "created",
    actorSession: "operator-human@kernel",
    closureReason: null,
  },
  {
    transitionId: 50,
    qitemId: "qitem-20260924140210-49fa9923",
    ts: "2026-09-24T14:02:11.663Z",
    state: "handed-off",
    transitionNote: "handoff final",
    actorSession: "operator-human@kernel",
    closureReason: "handed_off_to",
  },
];

test("maps daemon transition fields correctly (at/toState/actor/note)", () => {
  const mapped = mapTransitions(daemonSample);
  assert.equal(mapped.length, 2);
  assert.equal(mapped[0].at, "2026-09-24T14:02:10.596Z");
  assert.equal(mapped[0].toState, "pending");
  assert.equal(mapped[0].fromState, null); // first → prev null
  assert.equal(mapped[0].actor, "operator-human@kernel");
  assert.equal(mapped[0].note, "created");

  assert.equal(mapped[1].at, "2026-09-24T14:02:11.663Z");
  assert.equal(mapped[1].toState, "handed-off");
  assert.equal(mapped[1].fromState, "pending"); // previous transition's state
  assert.equal(mapped[1].note, "handoff final");
});

test("empty transitions produce empty array", () => {
  assert.deepEqual(mapTransitions([]), []);
});