import test from "node:test";
import assert from "node:assert/strict";
import { applyState, connectConvergentDocs, createCrdtDoc, stateFromDoc } from "./crdt.js";

test("two offline Yjs clients converge distinct entity edits", () => {
  const left = createCrdtDoc();
  const right = createCrdtDoc();
  applyState(left.entities, { tasks: [{ id: "a", title: "left", tags: [] }], projects: [], areas: [], headings: [] });
  applyState(right.entities, { tasks: [{ id: "b", title: "right", tags: [] }], projects: [], areas: [], headings: [] });
  const disconnect = connectConvergentDocs(left, right);
  assert.deepEqual(stateFromDoc(left.entities).tasks.map(task => task.id).sort(), ["a", "b"]);
  assert.deepEqual(stateFromDoc(right.entities).tasks.map(task => task.id).sort(), ["a", "b"]);
  applyState(left.entities, { tasks: [{ id: "a", title: "left edited", tags: [] }, { id: "b", title: "right", tags: [] }], projects: [], areas: [], headings: [] });
  assert.equal(stateFromDoc(right.entities).tasks.find(task => task.id === "a").title, "left edited");
  disconnect();
});
