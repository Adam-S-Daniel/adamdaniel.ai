#!/usr/bin/env node
// Behavior check for the GHA-bench post's weight sliders (issue #4114), run by
// scripts/verify-build-artifacts.rb against the BUILT post. The verifier reads
// the page's HTML (the range inputs and the inline <script>) and sends them
// here as JSON on stdin: {"inputs": [{id, min, max, step, value}], "script": "..."}.
//
// The script runs in a bare `vm` context with a tiny fake DOM. The one browser
// behavior that matters is modeled on purpose: a range input snaps any value
// assigned to it to its min/max/step grid. That snapping is what once left
// four sliders at 33.5 + 33.5 + 33.5 + 0 = 100.5%. Every slider is then sent
// to its minimum, its maximum and a few awkward middle values, and after each
// move the four weights, and the percentages printed beside them, must total
// exactly 100.
//
// Prints one "FAIL ..." line per problem; exit 1 on any, 0 when clean.
"use strict";

const vm = require("node:vm");

const { inputs, script } = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
const failures = [];
const fail = (msg) => failures.push(msg);

const genericElement = () => ({
  textContent: "",
  innerHTML: "",
  scrollWidth: 0,
  clientWidth: 0,
  scrollLeft: 0,
  classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  addEventListener() {},
  get parentNode() {
    return genericElement();
  },
});

const elements = new Map();
const listeners = new Map();
const sliders = [];

for (const spec of inputs) {
  const min = Number.parseFloat(spec.min ?? "0");
  const max = Number.parseFloat(spec.max ?? "100");
  const step = Number.parseFloat(spec.step ?? "1") || 1;
  const snap = (raw) => {
    const n = Number.parseFloat(raw);
    if (Number.isNaN(n)) return String(min);
    const clamped = Math.min(max, Math.max(min, n));
    return String(min + Math.round((clamped - min) / step) * step);
  };
  let value = snap(spec.value ?? String(min));
  const el = {
    ...genericElement(),
    id: spec.id,
    min,
    max,
    get step() {
      return String(step);
    },
    get value() {
      return value;
    },
    set value(v) {
      value = snap(v);
    },
    addEventListener(type, fn) {
      if (!listeners.has(spec.id)) listeners.set(spec.id, {});
      (listeners.get(spec.id)[type] ||= []).push(fn);
    },
  };
  elements.set(spec.id, el);
  sliders.push(el);
}

const document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, genericElement());
    return elements.get(id);
  },
};
const context = { document, window: { addEventListener() {} } };
context.window.document = document;

try {
  vm.runInNewContext(script, context, { filename: "bws-widget-inline.js", timeout: 2000 });
} catch (err) {
  fail(`the widget script threw while loading: ${err.message}`);
}

function total() {
  const sum = sliders.reduce((acc, el) => acc + Number.parseFloat(el.value), 0);
  return Math.round(sum * 1000) / 1000;
}

function shownTotal() {
  // The percentage <span> beside each slider is `<slider id>-pct`.
  const parts = sliders.map((el) => Number.parseFloat(document.getElementById(`${el.id}-pct`).textContent));
  return Math.round(parts.reduce((a, b) => a + b, 0) * 1000) / 1000;
}

if (sliders.length === 0) fail("no range inputs found for the widget");
if (failures.length === 0) {
  for (const slider of sliders) {
    const probes = [
      ["Home", slider.min],
      ["End", slider.max],
      ["33.3", 33.3],
      ["66.7", 66.7],
      ["0.5", slider.min + 0.5],
    ];
    for (const [label, target] of probes) {
      slider.value = target;
      const handlers = (listeners.get(slider.id) || {}).input || [];
      if (handlers.length === 0) fail(`${slider.id} has no input listener`);
      try {
        for (const fn of handlers) fn.call(slider, { target: slider });
      } catch (err) {
        fail(`${label} on ${slider.id}: the handler threw: ${err.message}`);
        continue;
      }
      const t = total();
      const s = shownTotal();
      if (t !== 100) fail(`${label} on ${slider.id}: the sliders total ${t}, not 100`);
      else if (s !== 100) fail(`${label} on ${slider.id}: the printed percentages total ${s}, not 100`);
      for (const el of sliders) {
        const v = Number.parseFloat(el.value);
        if (v < el.min || v > el.max) fail(`${label} on ${slider.id}: ${el.id} is ${v}, outside ${el.min}-${el.max}`);
      }
    }
  }
}

for (const line of failures) console.log(`FAIL ${line}`);
console.log(`${failures.length === 0 ? "ok" : "FAIL"}: ${sliders.length} sliders probed`);
process.exit(failures.length === 0 ? 0 : 1);
