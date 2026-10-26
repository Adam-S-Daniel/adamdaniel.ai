#!/usr/bin/env node
// Behavior check for the GHA-bench post's weights and Model labels (#4114), run by
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
// Separate desktop and phone starts also check compact phone labels, viewport
// changes, and every slider rerender against the generated Model cell strings.
//
// Prints one "FAIL ..." line per problem; exit 1 on any, 0 when clean.
"use strict";

const vm = require("node:vm");

const { inputs, script } = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
const failures = [];
const fail = (msg) => failures.push(msg);
let labelChecks = 0;
let sliderProbes = 0;

function checkWidget(initialPhone) {
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
  const phoneListeners = [];
  const phone = {
    matches: initialPhone,
    addEventListener(type, fn) {
      if (type === "change") phoneListeners.push(fn);
    },
  };
  const context = {
    document,
    window: {
      addEventListener() {},
      matchMedia(query) {
        if (query !== "(max-width: 540px)") fail(`unexpected phone breakpoint: ${query}`);
        return phone;
      },
    },
  };
  context.window.document = document;

  try {
    vm.runInNewContext(script, context, { filename: "bws-widget-inline.js", timeout: 2000 });
  } catch (err) {
    fail(`the widget script threw while loading: ${err.message}`);
    return;
  }

  function total() {
    const sum = sliders.reduce((acc, el) => acc + Number.parseFloat(el.value), 0);
    return Math.round(sum * 1000) / 1000;
  }

  function shownTotal() {
    // The percentage <span> beside each slider is `<slider id>-pct`.
    const parts = sliders.map((el) =>
      Number.parseFloat(document.getElementById(`${el.id}-pct`).textContent)
    );
    return Math.round(parts.reduce((a, b) => a + b, 0) * 1000) / 1000;
  }

  const modelLabels = [
    ["opus 4.7 1m med", "opus-4.7·1m·med"],
    ["opus 4.7 200k med", "opus-4.7·200k·med"],
    ["sonnet 46 1m med", "sonnet-46·1m·med"],
    ["opus 46 200k", "opus-46·200k"],
    ["opus 4.7 1m hi", "opus-4.7·1m·hi"],
    ["sonnet 46 200k", "sonnet-46·200k"],
    ["opus 4.7 1m xhi", "opus-4.7·1m·xhi"],
    ["haiku 45 200k", "haiku-45·200k"],
  ];
  function checkModels(stage) {
    labelChecks += 1;
    // Compare runtime output cells directly; never inspect JavaScript code shape.
    const html = document.getElementById("bws-tbody").innerHTML;
    for (const [full, compact] of modelLabels) {
      const label = phone.matches ? compact : full;
      const other = phone.matches ? full : compact;
      if (!html.includes(`<td>${label}</td>`)) {
        fail(`${stage}: the Model column is missing ${label}`);
      }
      if (html.includes(`<td>${other}</td>`)) {
        fail(`${stage}: the Model column still shows ${other}`);
      }
    }
  }
  function setPhone(matches) {
    phone.matches = matches;
    for (const fn of phoneListeners) fn({ matches });
  }

  if (sliders.length === 0) fail("no range inputs found for the widget");
  if (sliders.length !== 0) {
    checkModels(initialPhone ? "initial phone render" : "initial desktop render");
    if (initialPhone) {
      setPhone(false);
      checkModels("initial phone switches to desktop");
    }
    setPhone(true);
    checkModels("switch to phone");
    for (const slider of sliders) {
      const probes = [
        ["Home", slider.min],
        ["End", slider.max],
        ["33.3", 33.3],
        ["66.7", 66.7],
        ["0.5", slider.min + 0.5],
      ];
      for (const [label, target] of probes) {
        sliderProbes += 1;
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
        checkModels(`${label} on ${slider.id} at phone width`);
        if (t !== 100) fail(`${label} on ${slider.id}: the sliders total ${t}, not 100`);
        else if (s !== 100) {
          fail(`${label} on ${slider.id}: the printed percentages total ${s}, not 100`);
        }
        for (const el of sliders) {
          const v = Number.parseFloat(el.value);
          if (v < el.min || v > el.max) {
            fail(`${label} on ${slider.id}: ${el.id} is ${v}, outside ${el.min}-${el.max}`);
          }
        }
      }
    }
    setPhone(false);
    checkModels("switch back to desktop");
  }
}

checkWidget(false);
checkWidget(true);

for (const line of failures) console.log(`FAIL ${line}`);
console.log(
  `${failures.length === 0 ? "ok" : "FAIL"}: ${sliderProbes} slider probes, ` +
    `${labelChecks} label checks`
);
process.exit(failures.length === 0 ? 0 : 1);
