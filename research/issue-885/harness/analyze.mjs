/**
 * Derive #885 evidence inputs from the MEASURED + COUNTERFACTUAL raw results.
 *
 * The replay evidence is keyed by fault EPISODE, not by the first throw in the
 * whole experiment. Times are actual fake-clock milliseconds; injection and
 * removal are recorded when the fault switch changes, and event times are the
 * pino emission times (not the enclosing observation step).
 *
 * Usage: node research/issue-885/harness/analyze.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = path.resolve(HERE, "../results/experiments.json");
const OUT_PATH = path.resolve(HERE, "../results/analysis.json");
const raw = JSON.parse(readFileSync(RESULTS_PATH, "utf8"));
const T0 = raw.t0;
const loops = ["heartbeat", "deadline_scanner"];

function settledAt(step, loop) {
  return loop === "heartbeat" ? step.hbSettledAtMs : step.dlSettledAtMs;
}

function threw(step, loop) {
  return loop === "heartbeat" ? step.hbThrew : step.dlThrew;
}

function cleanSettled(step, loop) {
  return loop === "heartbeat" ? step.hbCleanSettled : step.dlCleanSettled;
}

function eventElapsed(event) {
  return event.elapsedMs;
}

function inWindow(event, start, end) {
  return (
    eventElapsed(event) >= start && (end === null || eventElapsed(event) < end)
  );
}

function firstOrNull(items, key) {
  return items.length === 0 ? null : key(items[0]);
}

function episodeEvidence(result, episode, active) {
  const start = episode.injectedAtElapsedMs;
  const end = episode.removedAtElapsedMs;
  const events = result.asBuilt.operabilityEvents.filter(
    (event) => event.event === "operability.tick_failure",
  );
  const perLoop = {};
  for (const loop of loops) {
    const alertActiveAtStart = active[loop];
    const loopEvents = events.filter((event) => event.component === loop);
    const failing = loopEvents
      .filter(
        (event) => event.state === "failing" && inWindow(event, start, end),
      )
      .sort((a, b) => eventElapsed(a) - eventElapsed(b));
    if (failing.length > 0) active[loop] = true;
    if (episode.removalReason === "restart") active[loop] = false;
    const recovered =
      // A recovery belongs to this episode if an alert was already active at
      // its start (E9's cause changed without a recovered transition) or this
      // episode raised one. A recovery must not be pulled from an unrelated
      // later episode.
      active[loop] && episode.removalReason === "clean" && end !== null
        ? loopEvents
            .filter(
              (event) =>
                event.state === "recovered" && eventElapsed(event) >= end,
            )
            .sort((a, b) => eventElapsed(a) - eventElapsed(b))
        : [];
    if (recovered.length > 0) active[loop] = false;
    const throwSettles = result.steps
      .filter(
        (step) =>
          threw(step, loop) &&
          settledAt(step, loop) !== null &&
          settledAt(step, loop) - T0 >= start &&
          (end === null || settledAt(step, loop) - T0 < end),
      )
      .map((step) => ({
        elapsedMs: settledAt(step, loop) - T0,
        phase: step.phase,
      }))
      .sort((a, b) => a.elapsedMs - b.elapsedMs);
    const cleanSettles =
      end === null
        ? []
        : result.steps
            .filter(
              (step) =>
                cleanSettled(step, loop) &&
                settledAt(step, loop) !== null &&
                settledAt(step, loop) - T0 >= end,
            )
            .map((step) => ({
              elapsedMs: settledAt(step, loop) - T0,
              phase: step.phase,
            }))
            .sort((a, b) => a.elapsedMs - b.elapsedMs);
    const firstThrowSettle = firstOrNull(throwSettles, (x) => x.elapsedMs);
    const firstCleanSettle = firstOrNull(cleanSettles, (x) => x.elapsedMs);
    const firstFailing = firstOrNull(failing, eventElapsed);
    const firstRecovered = firstOrNull(recovered, eventElapsed);
    perLoop[loop] = {
      alertActiveAtEpisodeStart: alertActiveAtStart,
      failingRaisedInEpisode: failing.length > 0,
      activeAlertAfterEpisode: active[loop],
      firstThrowSettleElapsedMs: firstThrowSettle,
      firstFailingEventElapsedMs: firstFailing,
      injectionToFailingMs: firstFailing === null ? null : firstFailing - start,
      firstThrowSettleToFailingMs:
        firstFailing === null || firstThrowSettle === null
          ? null
          : firstFailing - firstThrowSettle,
      firstNoThrowSettleAfterRemovalElapsedMs: firstCleanSettle,
      firstRecoveryEventElapsedMs: firstRecovered,
      removalToRecoveryMs:
        firstRecovered === null || end === null ? null : firstRecovered - end,
      firstNoThrowSettleToRecoveryMs:
        firstRecovered === null || firstCleanSettle === null
          ? null
          : firstRecovered - firstCleanSettle,
      monitorReads:
        end === null
          ? result.steps
              .flatMap((step) => step.monitorReads)
              .filter((read) => read.loop === loop && read.elapsedMs >= start)
          : result.steps
              .flatMap((step) => step.monitorReads)
              .filter(
                (read) =>
                  read.loop === loop &&
                  read.elapsedMs >= start &&
                  read.elapsedMs < end,
              ),
    };
  }
  return {
    index: episode.index,
    processEpoch: episode.processEpoch,
    injectedAtElapsedMs: start,
    removedAtElapsedMs: end,
    removalReason: episode.removalReason,
    faults: episode.faults,
    loops: perLoop,
  };
}

const rows = raw.results.map((result) => {
  const events = result.asBuilt.operabilityEvents;
  return {
    id: result.scenario.id,
    ex: result.scenario.ex,
    loops: result.scenario.loops,
    phases: result.phases,
    episodes: (() => {
      const active = { heartbeat: false, deadline_scanner: false };
      return result.faultEpisodes.map((episode) =>
        episodeEvidence(result, episode, active),
      );
    })(),
    asBuilt: {
      totalErrorLines: result.asBuilt.totalErrorLines,
      throwTicks: result.asBuilt.totalThrowTicks,
      businessFailureTicks: result.asBuilt.totalBusinessFailureTicks,
      cleanTicks: result.asBuilt.totalCleanTicks,
      settledTicks: result.asBuilt.totalSettledTicks,
      startedTicks: result.asBuilt.totalStartedTicks,
      maxConsecutiveFailedTicks: result.asBuilt.maxConsecutiveFailedTicks,
      stalls: result.asBuilt.stallStatesSeen,
      events: events.map((event) => ({
        event: event.event,
        component: event.component,
        state: event.state,
        level: event.level,
        timeMs: event.timeMs,
        elapsedMs: event.elapsedMs,
        observedAtStepElapsedMs: event.observedAtStepElapsedMs,
      })),
      tickFailureEvents: events.filter(
        (event) => event.event === "operability.tick_failure",
      ).length,
      readinessFailureEvents: result.asBuilt.readinessFailureEvents,
      readinessRecoveryEvents: result.asBuilt.readinessRecoveryEvents,
      businessFailureEvents: result.asBuilt.businessFailureEvents,
      backgroundLoopEvents: result.asBuilt.backgroundLoopEvents,
    },
  };
});

mkdirSync(path.dirname(OUT_PATH), { recursive: true });
writeFileSync(
  OUT_PATH,
  JSON.stringify(
    {
      baselineSha: raw.baselineSha,
      subjectSha: raw.subjectSha,
      subjectDirty: raw.subjectDirty,
      instrument: raw.instrument,
      generatedAt: raw.generatedAt,
      timeOrigin: "elapsedMs from T0 on the controlled fake clock",
      rows,
    },
    null,
    2,
  ),
);

for (const row of rows) {
  const tick = row.asBuilt.tickFailureEvents;
  const episodeText =
    row.episodes.length === 0
      ? "-"
      : row.episodes
          .map((episode) => {
            const hb = episode.loops.heartbeat;
            const dl = episode.loops.deadline_scanner;
            return (
              `ep${episode.index}[${episode.injectedAtElapsedMs}->${episode.removedAtElapsedMs ?? "open"}` +
              `,${episode.removalReason}] ` +
              `hb(inj->fail=${hb.injectionToFailingMs},throwSettle->fail=${hb.firstThrowSettleToFailingMs},` +
              `remove->rec=${hb.removalToRecoveryMs},cleanSettle->rec=${hb.firstNoThrowSettleToRecoveryMs}) ` +
              `dl(inj->fail=${dl.injectionToFailingMs},throwSettle->fail=${dl.firstThrowSettleToFailingMs},` +
              `remove->rec=${dl.removalToRecoveryMs},cleanSettle->rec=${dl.firstNoThrowSettleToRecoveryMs})`
            );
          })
          .join(" | ");
  console.log(
    `${row.id.padEnd(48)} tick_failure=${tick} ` +
      `episodes=${row.episodes.length} ${episodeText}`,
  );
}
