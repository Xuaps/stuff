import test from "node:test";
import assert from "node:assert/strict";
import { parseCapture } from "../app/parse.js";

const chrono = {
  parse(input) {
    const match = /\bfriday(?:\s+5pm)?\b/i.exec(input);
    return match ? [{ index: match.index, text: match[0], start: { date: () => new Date(2024, 5, 7, 17) } }] : [];
  },
};

test("extracts a natural date and removes it from the title", () => {
  assert.deepEqual(parseCapture("call dentist friday 5pm", { chrono }), {
    title: "call dentist",
    when: "2024-06-07",
    tags: [],
    projectName: null,
    deadline: null,
  });
});

test("extracts tags and projects inline", () => {
  assert.deepEqual(parseCapture("review #health [[Personal]]"), {
    title: "review",
    when: "inbox",
    tags: ["health"],
    projectName: "Personal",
    deadline: null,
  });
});

test("extracts a deadline and combined capture syntax", () => {
  assert.deepEqual(parseCapture("call dentist friday 5pm #health [[Dentist]] !2024-06-01", { chrono }), {
    title: "call dentist",
    when: "2024-06-07",
    tags: ["health"],
    projectName: "Dentist",
    deadline: "2024-06-01",
  });
});

test("passes through a plain title", () => {
  assert.deepEqual(parseCapture("Buy milk"), {
    title: "Buy milk",
    when: "inbox",
    tags: [],
    projectName: null,
    deadline: null,
  });
});
