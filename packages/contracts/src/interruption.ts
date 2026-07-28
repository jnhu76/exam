import { z } from "zod";

const POSTGRES_INTEGER_MAX = 2_147_483_647;

export const InterruptionTimePolicySchema = z.enum([
  "strict",
  "bounded_grace",
  "operator_incident",
]);

export const InterruptionEventTypeSchema = z.enum([
  "detected",
  "restored",
  "terminalized",
]);

export const InterruptionDetectionSourceSchema = z.enum([
  "heartbeat_timeout",
  "migration_backfill",
]);

export const TimeAdjustmentSourceSchema = z.enum([
  "bounded_grace",
  "operator",
  "system_incident",
  "administrative_correction",
]);

const PositivePostgresIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(POSTGRES_INTEGER_MAX);

const PolicyConfigurationShape = z.object({
  policy: InterruptionTimePolicySchema,
  perIncidentCapSeconds: PositivePostgresIntegerSchema.nullable(),
  perAttemptAggregateCapSeconds: PositivePostgresIntegerSchema.nullable(),
});

type PolicyConfiguration = z.infer<typeof PolicyConfigurationShape>;

function validatePolicyCaps(
  value: PolicyConfiguration,
  ctx: z.RefinementCtx,
): void {
  const hasIncidentCap = value.perIncidentCapSeconds !== null;
  const hasAggregateCap = value.perAttemptAggregateCapSeconds !== null;

  if (value.policy !== "bounded_grace") {
    if (hasIncidentCap || hasAggregateCap) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "strict and operator_incident policies require null caps",
      });
    }
    return;
  }

  if (
    value.perIncidentCapSeconds === null ||
    value.perAttemptAggregateCapSeconds === null
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "bounded_grace requires both caps",
    });
    return;
  }

  if (value.perIncidentCapSeconds > value.perAttemptAggregateCapSeconds) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["perIncidentCapSeconds"],
      message: "per-incident cap cannot exceed the aggregate cap",
    });
  }
}

export const InterruptionPolicyConfigurationSchema =
  PolicyConfigurationShape.superRefine(validatePolicyCaps);

const InterruptionPolicyConfigurationInputSchema = z
  .object({
    policy: InterruptionTimePolicySchema.default("strict"),
    perIncidentCapSeconds:
      PositivePostgresIntegerSchema.nullable().default(null),
    perAttemptAggregateCapSeconds:
      PositivePostgresIntegerSchema.nullable().default(null),
  })
  .superRefine(validatePolicyCaps);

export function normalizeInterruptionPolicyConfiguration(
  input: z.input<typeof InterruptionPolicyConfigurationInputSchema>,
): PolicyConfiguration {
  return InterruptionPolicyConfigurationInputSchema.parse(input);
}

export const AttemptTimingPolicySnapshotSchema =
  PolicyConfigurationShape.extend({
    schemaVersion: z.literal(1),
  }).superRefine(validatePolicyCaps);

export type InterruptionPolicyConfiguration = z.infer<
  typeof InterruptionPolicyConfigurationSchema
>;
export type AttemptTimingPolicySnapshot = z.infer<
  typeof AttemptTimingPolicySnapshotSchema
>;
