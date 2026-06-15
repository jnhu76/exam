// @ts-nocheck
// Set IS_REACT_ACT_ENVIRONMENT globally. ReactDOM's CJS code reads the bare
// identifier via scope chain resolution. vitest's SSR module runner wraps CJS
// deps in __commonJS, which should still resolve to globalThis. However, due
// to a vitest limitation, the define replacement and globalThis assignment do
// not reliably reach ReactDOM's IIFE in all environments.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Filter false-positive "not configured to support act" warning from ReactDOM.
// This occurs because vitest's SSR module runner cannot apply Vite's define
// replacement to bare identifiers inside CJS dependencies. The flag is correctly
// set (verified by globalThis read) but ReactDOM's isConcurrentActEnvironment()
// sees a different value due to SSR CJS wrapping.
const _consoleErrorOrig = console.error.bind(console);
console.error = function (...args) {
  if (
    typeof args[0] === "string" &&
    args[0].includes("not configured to support act")
  ) {
    return;
  }
  _consoleErrorOrig(...args);
};
