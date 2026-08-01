import { describe, expect, it } from "vitest";
import { AuditAction, type AuditActionKey } from "@exam/authz";
import { validateAuditPayload } from "./auditPolicy.js";

const INCIDENT_ID = "incident-1";
const EXAM_ID = "exam-1";
const ATTEMPT_ID = "attempt-1";

describe("auditPolicy — Incident payloads use canonical domain values", () => {
  it("IncidentCreated accepts a canonical type and version 1", () => {
    const out = validateAuditPayload(AuditAction.IncidentCreated, {
      incidentId: INCIDENT_ID,
      examId: EXAM_ID,
      type: "network_interruption",
      version: 1,
    });
    expect(out.type).toBe("network_interruption");
    expect(out.version).toBe(1);
  });

  it("IncidentCreated rejects an arbitrary type string", () => {
    expect(() =>
      validateAuditPayload(AuditAction.IncidentCreated, {
        incidentId: INCIDENT_ID,
        examId: EXAM_ID,
        type: "not_a_real_type",
        version: 1,
      }),
    ).toThrow();
  });

  it("IncidentCreated rejects version 0", () => {
    expect(() =>
      validateAuditPayload(AuditAction.IncidentCreated, {
        incidentId: INCIDENT_ID,
        examId: EXAM_ID,
        type: "other",
        version: 0,
      }),
    ).toThrow();
  });

  it("IncidentCreated rejects a negative version", () => {
    expect(() =>
      validateAuditPayload(AuditAction.IncidentCreated, {
        incidentId: INCIDENT_ID,
        examId: EXAM_ID,
        type: "other",
        version: -1,
      }),
    ).toThrow();
  });

  it("IncidentCreated rejects a non-integer version", () => {
    expect(() =>
      validateAuditPayload(AuditAction.IncidentCreated, {
        incidentId: INCIDENT_ID,
        examId: EXAM_ID,
        type: "other",
        version: 1.5,
      }),
    ).toThrow();
  });

  it("IncidentCreated rejects extra keys (strict object)", () => {
    expect(() =>
      validateAuditPayload(AuditAction.IncidentCreated, {
        incidentId: INCIDENT_ID,
        examId: EXAM_ID,
        type: "other",
        version: 1,
        description: "free text must not leak into audit",
      }),
    ).toThrow();
  });

  it("IncidentSeverityChanged accepts canonical before/after severities", () => {
    const out = validateAuditPayload(AuditAction.IncidentSeverityChanged, {
      incidentId: INCIDENT_ID,
      beforeSeverity: "info",
      afterSeverity: "critical",
      version: 2,
      reasonCode: null,
    });
    expect(out.beforeSeverity).toBe("info");
    expect(out.afterSeverity).toBe("critical");
  });

  it("IncidentSeverityChanged rejects an arbitrary severity", () => {
    expect(() =>
      validateAuditPayload(AuditAction.IncidentSeverityChanged, {
        incidentId: INCIDENT_ID,
        beforeSeverity: "info",
        afterSeverity: "catastrophic",
        version: 2,
        reasonCode: null,
      }),
    ).toThrow();
  });

  it("IncidentActionLinked accepts a canonical action type", () => {
    const out = validateAuditPayload(AuditAction.IncidentActionLinked, {
      incidentId: INCIDENT_ID,
      actionType: "time_grant",
      actionId: "adj-1",
      attemptId: ATTEMPT_ID,
      version: 1,
    });
    expect(out.actionType).toBe("time_grant");
  });

  it("IncidentActionLinked rejects an arbitrary action type", () => {
    expect(() =>
      validateAuditPayload(AuditAction.IncidentActionLinked, {
        incidentId: INCIDENT_ID,
        actionType: "misconduct_mark",
        actionId: "adj-1",
        attemptId: ATTEMPT_ID,
        version: 1,
      }),
    ).toThrow();
  });

  it("IncidentAttemptLinked accepts a canonical relationship type", () => {
    const out = validateAuditPayload(AuditAction.IncidentAttemptLinked, {
      incidentId: INCIDENT_ID,
      attemptId: ATTEMPT_ID,
      relationshipType: "affected",
      version: 1,
    });
    expect(out.relationshipType).toBe("affected");
  });

  it("IncidentAttemptLinked rejects an arbitrary relationship type", () => {
    expect(() =>
      validateAuditPayload(AuditAction.IncidentAttemptLinked, {
        incidentId: INCIDENT_ID,
        attemptId: ATTEMPT_ID,
        relationshipType: "frenemy",
        version: 1,
      }),
    ).toThrow();
  });

  it("every Incident version field is a positive integer (version 0 and negative rejected)", () => {
    // Each incident audit action carries `version`; assert the strict
    // positive-integer rule across all of them with a representative valid
    // payload per action.
    const versions: Array<{
      action: AuditActionKey;
      payload: Record<string, unknown>;
    }> = [
      {
        action: AuditAction.IncidentCreated,
        payload: {
          incidentId: INCIDENT_ID,
          examId: EXAM_ID,
          type: "other",
          version: 1,
        },
      },
      {
        action: AuditAction.IncidentInvestigated,
        payload: { incidentId: INCIDENT_ID, version: 1, reasonCode: null },
      },
      {
        action: AuditAction.IncidentNoteAdded,
        payload: {
          incidentId: INCIDENT_ID,
          noteId: "note-1",
          version: 1,
        },
      },
      {
        action: AuditAction.IncidentSeverityChanged,
        payload: {
          incidentId: INCIDENT_ID,
          beforeSeverity: "info",
          afterSeverity: "major",
          version: 1,
          reasonCode: null,
        },
      },
      {
        action: AuditAction.IncidentResolved,
        payload: { incidentId: INCIDENT_ID, version: 1, reasonCode: null },
      },
      {
        action: AuditAction.IncidentDismissed,
        payload: { incidentId: INCIDENT_ID, version: 1, reasonCode: null },
      },
      {
        action: AuditAction.IncidentActionLinked,
        payload: {
          incidentId: INCIDENT_ID,
          actionType: "force_submit",
          actionId: ATTEMPT_ID,
          attemptId: ATTEMPT_ID,
          version: 1,
        },
      },
      {
        action: AuditAction.IncidentAttemptLinked,
        payload: {
          incidentId: INCIDENT_ID,
          attemptId: ATTEMPT_ID,
          relationshipType: "referenced",
          version: 1,
        },
      },
      {
        action: AuditAction.IncidentInterruptionLinked,
        payload: {
          incidentId: INCIDENT_ID,
          interruptionId: "interruption-1",
          attemptId: ATTEMPT_ID,
          version: 1,
        },
      },
    ];

    for (const { action, payload } of versions) {
      expect(validateAuditPayload(action, payload).version).toBe(1);
      expect(() =>
        validateAuditPayload(action, { ...payload, version: 0 }),
      ).toThrow();
      expect(() =>
        validateAuditPayload(action, { ...payload, version: -1 }),
      ).toThrow();
    }
  });
});
