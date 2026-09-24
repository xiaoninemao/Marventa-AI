import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as flush } from "node:timers/promises";
import { createCreationPresence, type CreationPresenceState } from "./creation_presence.ts";
import type { CreationPresenceMember } from "../types/content_generator.ts";

const member: CreationPresenceMember = {
  id: "viewer", username: "viewer", nickname: "Viewer", avatar_url: "",
};

test("presence joins once, renews every ten seconds, and releases its visit on stop", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: Array<{ client: string; signal: AbortSignal }> = [];
  const leaves: string[] = [];
  const updates: CreationPresenceState[] = [];
  const connection = createCreationPresence({
    heartbeat: async (client, signal) => { calls.push({ client, signal }); return [member]; },
    leave: async (client) => { leaves.push(client); },
    onUpdate: (state) => updates.push(state),
    onLeaveError: (error) => assert.fail(String(error)),
    createClientId: () => "visit-one",
  });
  context.after(() => connection.stop());
  connection.start();
  connection.start();
  await flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(updates.at(-1), { members: [member], loading: false, error: null });
  context.mock.timers.tick(10_000);
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].client, "visit-one");
  connection.stop();
  connection.stop();
  assert.deepEqual(leaves, ["visit-one"]);
  assert.equal(calls[0].signal.aborted, true);
  context.mock.timers.tick(60_000);
  await flush();
  assert.equal(calls.length, 2);
});

test("a reopened page gets a fresh lease and ignores late responses from its previous visit", async (context) => {
  const updates: CreationPresenceState[] = [];
  const leaves: string[] = [];
  const pending: Array<(members: CreationPresenceMember[]) => void> = [];
  let serial = 0;
  const connection = createCreationPresence({
    heartbeat: () => new Promise((resolve) => pending.push(resolve)),
    leave: async (client) => { leaves.push(client); },
    onUpdate: (state) => updates.push(state),
    onLeaveError: (error) => assert.fail(String(error)),
    createClientId: () => `visit-${++serial}`,
  });
  context.after(() => connection.stop());
  connection.start();
  connection.stop();
  connection.start();
  pending[1]([member]);
  await flush();
  const count = updates.length;
  pending[0]([{ ...member, id: "stale" }]);
  await flush();
  assert.equal(updates.length, count);
  assert.deepEqual(updates.at(-1)?.members, [member]);
  connection.stop();
  assert.deepEqual(leaves, ["visit-1", "visit-2"]);
});

test("failed heartbeats surface errors, clear stale members, and recover on the next heartbeat", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const updates: CreationPresenceState[] = [];
  const leaveErrors: unknown[] = [];
  let attempts = 0;
  const connection = createCreationPresence({
    heartbeat: async () => {
      if (++attempts === 2) throw new Error("Connection unavailable");
      return [member];
    },
    leave: async () => { throw new Error("Release failed"); },
    onUpdate: (state) => updates.push(state),
    onLeaveError: (error) => leaveErrors.push(error),
    createClientId: () => "retry-visit",
  });
  context.after(() => connection.stop());
  connection.start();
  await flush();
  context.mock.timers.tick(10_000);
  await flush();
  assert.deepEqual(updates.at(-1), { members: [], loading: false, error: "Connection unavailable" });
  context.mock.timers.tick(10_000);
  await flush();
  assert.deepEqual(updates.at(-1), { members: [member], loading: false, error: null });
  connection.stop();
  await flush();
  assert.equal(leaveErrors.length, 1);
});

test("a slow heartbeat never overlaps another request or publishes after cleanup", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const updates: CreationPresenceState[] = [];
  let attempts = 0;
  let rejectRequest: (error: Error) => void = () => assert.fail("No request started");
  const connection = createCreationPresence({
    heartbeat: () => {
      attempts++;
      return new Promise((_resolve, reject) => { rejectRequest = reject; });
    },
    leave: async () => {},
    onUpdate: (state) => updates.push(state),
    onLeaveError: (error) => assert.fail(String(error)),
    createClientId: () => "slow-visit",
  });
  context.after(() => connection.stop());
  connection.start();
  context.mock.timers.tick(60_000);
  assert.equal(attempts, 1);
  const count = updates.length;
  connection.stop();
  rejectRequest(new Error("Request aborted"));
  await flush();
  assert.equal(updates.length, count);
  assert.equal(attempts, 1);
});

test("returning to a tab refreshes immediately without overlapping a heartbeat", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0;
  const connection = createCreationPresence({
    heartbeat: async () => { attempts++; return [member]; },
    leave: async () => {},
    onUpdate: () => {},
    onLeaveError: (error) => assert.fail(String(error)),
    createClientId: () => "visible-again",
  });
  context.after(() => connection.stop());
  connection.start();
  connection.refresh();
  assert.equal(attempts, 1);
  await flush();
  context.mock.timers.tick(4000);
  connection.refresh();
  connection.refresh();
  assert.equal(attempts, 2);
  await flush();
  context.mock.timers.tick(6000);
  assert.equal(attempts, 2);
  context.mock.timers.tick(4000);
  await flush();
  assert.equal(attempts, 3);
});
