/**
 * Off counter-evidence (W2.1 §5 constraint 1): importing this package must
 * have NO module-level side effects — the prototype patch exists only after
 * an explicit {@link installOtelDbTelemetry} call, and the @exam/db
 * observation seam stays null unless a consumer registers one. A process
 * that never installs (the default-Off deployment — the API runtime loads
 * the module only behind the telemetry-enabled gate) runs the stock
 * postgres.js prototype.
 *
 * This file runs in its own vitest worker (file isolation) precisely so its
 * "not installed yet" window is real.
 */
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { getTransactionSeam } from "@exam/db/observation";
import { isOtelDbTelemetryInstalled, installOtelDbTelemetry } from "./index.js";
import { isStatementSeamPatched } from "./driverStatementSeam.js";

/** The native Query.prototype.then of a FRESH postgres instance. */
function nativeThen(): unknown {
  const probe = postgres("postgres://127.0.0.1:1/none");
  const marker = probe.unsafe("select 1");
  const then = Object.getPrototypeOf(marker).then;
  probe.end({ timeout: 0 });
  return then;
}

describe("Off / no-install has no side effects", () => {
  it("importing the module alone does not patch Query.prototype nor register the seam", () => {
    expect(isOtelDbTelemetryInstalled()).toBe(false);
    expect(isStatementSeamPatched()).toBe(false);
    expect(getTransactionSeam()).toBeNull();

    // the module is imported by this file — and the prototype is still the
    // native one of a fresh postgres copy (same module instance, same class)
    const probe = postgres("postgres://127.0.0.1:1/none");
    const then = Object.getPrototypeOf(probe.unsafe("select 1")).then;
    probe.end({ timeout: 0 });
    expect(then).toBe(nativeThen());
  });

  it("install is the only thing that patches (and stays a single decision)", () => {
    const handle = installOtelDbTelemetry();
    expect(isStatementSeamPatched()).toBe(true);
    expect(isOtelDbTelemetryInstalled()).toBe(true);
    expect(installOtelDbTelemetry()).toBe(handle);
  });
});
