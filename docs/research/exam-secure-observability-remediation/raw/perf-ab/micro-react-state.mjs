#!/usr/bin/env node
/**
 * Temporary correlation-state allocation microbenchmark (TASK-CONTRACT §6.1
 * "临时关联状态的额外分配").
 *
 * The integration adds exactly ONE extra useState slot to TakeExamPage
 * (`saveRejectionRequestId`) + one same-site setState on the rejection
 * branch. This measures, with the repo's actual React:
 *   1. per-render cost of one extra useState slot (renderToString, 12 vs 13
 *      slots — TakeExamPage-scale state count), and
 *   2. that two setStates issued at the same site produce ONE re-render
 *      (React automatic batching), i.e. the extra dispatch adds no render.
 *
 * Runs against integration-final's react@19.2.6 + react-dom (identical
 * version resolved in the baseline worktree — dependencies unchanged by the
 * four PRs; verified by diff of apps/web/package.json).
 */
import { createRequire } from "node:module";
const require = createRequire("/home/hoo/Source/exam-gap-worktrees/integration-final/apps/web/package.json");
const React = require("react");
const { renderToString } = require("react-dom/server");
const { performance } = require("node:perf_hooks");

function makeComponent(nSlots) {
  return function Comp() {
    const states = [];
    for (let i = 0; i < nSlots; i++) states.push(React.useState(i));
    // mimic TakeExamPage rejection branch shape: latest state read into a
    // conditional span
    const last = states[states.length - 1][0];
    return React.createElement("p", null, "x", last % 2 === 0 ? React.createElement("span", null, String(last)) : null);
  };
}
const Comp12 = makeComponent(12);
const Comp13 = makeComponent(13);

function bench(Comp, iters) {
  const t0 = performance.now();
  let sink = 0;
  for (let i = 0; i < iters; i++) sink += renderToString(React.createElement(Comp)).length;
  return ((performance.now() - t0) * 1e6) / iters;
}
function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

for (let i = 0; i < 3000; i++) { renderToString(React.createElement(Comp12)); renderToString(React.createElement(Comp13)); }
const ITERS = 30000, REPS = 5;
const r12 = [], r13 = [];
for (let r = 0; r < REPS; r++) { r12.push(bench(Comp12, ITERS)); r13.push(bench(Comp13, ITERS)); }

// batching witness: count renders triggered by 1 vs 2 setState at same site
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("/home/hoo/Source/exam-gap-worktrees/integration-final/apps/web/node_modules/jsdom");
const dom = new JSDOM("<div id=app></div>");
const g = dom.window.globalThis;
global.window = dom.window; global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true, writable: true });

function batchingCase(nSetStates) {
  return new Promise((resolve) => {
    let renders = 0;
    let setters = [];
    function C() {
      const s1 = React.useState(null);
      const s2 = React.useState(null);
      setters = [s1[1], s2[1]];
      renders++;
      return React.createElement("p", null, `${String(s1[0])}${String(s2[0])}`);
    }
    const root = createRoot(document.getElementById("app"));
    root.render(React.createElement(C));
    setTimeout(() => {
      const n0 = renders;
      for (let i = 0; i < nSetStates; i++) setters[i]("v" + i);
      setTimeout(() => {
        const delta = renders - n0;
        root.unmount();
        resolve(delta);
      }, 50);
    }, 50);
  });
}
const rendersOne = await batchingCase(1);
const rendersTwo = await batchingCase(2);

console.log(JSON.stringify({
  react: React.version,
  render12SlotsNsPerRender: Number(median(r12).toFixed(0)),
  render13SlotsNsPerRender: Number(median(r13).toFixed(0)),
  oneExtraUseStateSlotDeltaNs: Number((median(r13) - median(r12)).toFixed(0)),
  rendersAfterOneSetState: rendersOne,
  rendersAfterTwoSameSiteSetStates: rendersTwo,
  note: "extra dispatch is batched: two same-site setStates => same render count as one",
}, null, 2));
