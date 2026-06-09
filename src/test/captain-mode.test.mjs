import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const CaptainMode = require("../captain-mode.js");

const participants = [
  { id: "p1", service: "claude", name: "Claude-1" },
  { id: "p2", service: "gemini", name: "Gemini-1" },
];

test("captain mode: first participant is captain", () => {
  assert.equal(CaptainMode.isCaptain(participants[0], participants), true);
  assert.equal(CaptainMode.isCaptain(participants[1], participants), false);
});

test("captain mode: decorates only the captain prompt", () => {
  const prompt = "分析这家公司";
  const out = CaptainMode.decoratePrompt(prompt, participants[0], participants, true);
  assert.match(out, /AI Arena 队长模式/);
  assert.match(out, /没有任何队员发言/);
  assert.match(out, /分析这家公司/);

  const teammate = CaptainMode.decoratePrompt(prompt, participants[1], participants, true);
  assert.equal(teammate, prompt);
});

test("captain mode: disabled mode and single AI do not decorate", () => {
  const prompt = "hello";
  assert.equal(CaptainMode.decoratePrompt(prompt, participants[0], participants, false), prompt);
  assert.equal(CaptainMode.decoratePrompt(prompt, participants[0], [participants[0]], true), prompt);
});

test("captain mode: no duplicate decoration", () => {
  const once = CaptainMode.decoratePrompt("hello", participants[0], participants, true);
  const twice = CaptainMode.decoratePrompt(once, participants[0], participants, true);
  assert.equal(twice, once);
});
