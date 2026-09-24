import { test } from "node:test";
import { strict as assert } from "node:assert";
import { resolveNeedsYouSession } from "../src/needs-you-resolve.js";
import type { LiveSessions } from "../src/needs-you-resolve.js";

const live: LiveSessions = new Map([
  ["dev-check@first-project", { rigName: "first-project", logicalId: "dev.check" }],
  ["dev-owner@first-project", { rigName: "first-project", logicalId: "dev.owner" }],
  ["dev-deepseek", { rigName: "dashboard-team", logicalId: "dev.deepseek" }],
]);

test("human-destination + live queue source -> resolves to source", () => {
  const session = resolveNeedsYouSession(
    {
      source: "agent",
      identity: "qitem-whatever|created",
      destinationSession: "human@kernel",
      qitemId: "qitem-123",
    },
    { sourceSession: "dev-check@first-project" },
    live,
  );
  assert.equal(session, "dev-check@first-project");
});

test("derived stuck-item -> identity-prefix (live)", () => {
  const session = resolveNeedsYouSession(
    {
      source: "derived",
      identity: "dev-owner@first-project|too-long-in-state|2026-09-24T11:00:00",
      destinationSession: null,
      qitemId: null,
    },
    null,
    live,
  );
  assert.equal(session, "dev-owner@first-project");
});

test("stopped seat (not in live set) -> unresolved (null)", () => {
  const session = resolveNeedsYouSession(
    {
      source: "agent",
      identity: "qitem-zz|created",
      destinationSession: "dev-stopped@first-project",
      qitemId: "qitem-zz",
    },
    { sourceSession: "dev-stopped-owner@first-project" },
    live,
  );
  assert.equal(session, null);
});

test("human destination + human source -> null even if prefix matches nothing", () => {
  const session = resolveNeedsYouSession(
    {
      source: "agent",
      identity: "human@host",
      destinationSession: "human@kernel",
      qitemId: null,
    },
    null,
    live,
  );
  assert.equal(session, null);
});

test("direct item.sourceSession without qitemId -> resolves to it", () => {
  const session = resolveNeedsYouSession(
    {
      source: "agent",
      identity: "qitem-without-id",
      destinationSession: "human@kernel",
      qitemId: null,
      sourceSession: "dev-check@first-project",
    },
    null,
    live,
  );
  assert.equal(session, "dev-check@first-project");
});

test("queue.sourceSession is fallback after item.sourceSession", () => {
  const session = resolveNeedsYouSession(
    {
      source: "agent",
      identity: "qitem-fallback",
      destinationSession: null,
      qitemId: "qitem-fallback",
      sourceSession: "dev-check@first-project",
    },
    { sourceSession: "dev-owner@first-project" },
    live,
  );
  assert.equal(session, "dev-check@first-project");
});

// M5: canonical name deviates from member@rig. The live session is "dev-deepseek",
// the identity uses "dev-deepseek@dashboard-team". LogicalId mapping must resolve.
test("M5: identity pod-member@rig resolves via logicalId to canonical live session", () => {
  const session = resolveNeedsYouSession(
    {
      source: "derived",
      identity: "dev-deepseek@dashboard-team|too-long-in-state|2026-09-24T11:00:00",
      destinationSession: null,
      qitemId: null,
    },
    null,
    live,
  );
  assert.equal(session, "dev-deepseek");
});

// M5 ambiguity: two live nodes with the same logicalId in the same rig → no resolution.
test("M5: ambiguous logicalId match -> no resolution", () => {
  const ambiguous: LiveSessions = new Map([
    ["t-alpha", { rigName: "dashtest", logicalId: "t.alpha" }],
    ["other-t-alpha", { rigName: "dashtest", logicalId: "t.alpha" }],
  ]);
  const session = resolveNeedsYouSession(
    {
      source: "derived",
      identity: "t-alpha@dashtest|too-long-in-state|2026-09-24T11:00:00",
      destinationSession: null,
      qitemId: null,
    },
    null,
    ambiguous,
  );
  assert.equal(session, null);
});
// M5: dash in member resolves correctly.
test("M5: dash in member resolves correctly", () => {
  const live2: LiveSessions = new Map([
    ["dashed-session", { rigName: "testrig", logicalId: "dev.code-x" }],
  ]);
  const session = resolveNeedsYouSession(
    {
      source: "derived",
      identity: "dev-code-x@testrig|stuck|2026-09-24T11:00:00",
      destinationSession: null,
      qitemId: null,
    },
    null,
    live2,
  );
  assert.equal(session, "dashed-session");
});

// M5: two different splits both match → ambiguous → null.
test("M5: ambiguous dash position -> no resolution", () => {
  const live2: LiveSessions = new Map([
    ["s1", { rigName: "testrig", logicalId: "abc.def-ghi" }],
    ["s2", { rigName: "testrig", logicalId: "abc-def.ghi" }],
  ]);
  const session = resolveNeedsYouSession(
    {
      source: "derived",
      identity: "abc-def-ghi@testrig|stuck",
      destinationSession: null,
      qitemId: null,
    },
    null,
    live2,
  );
  assert.equal(session, null);
});
