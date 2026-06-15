declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const originalConsoleError = console.error.bind(console);

console.error = (...args: Parameters<typeof console.error>) => {
  if (
    typeof args[0] === "string" &&
    args[0].includes("not configured to support act")
  ) {
    return;
  }
  originalConsoleError(...args);
};

export {};
