import { Buffer } from "node:buffer";
import { z } from "zod";
import type {
  FastifyInstance,
  FastifyRequest,
  FastifyBaseLogger,
} from "fastify";
import type { RequestContext } from "@exam/domain";
import type {
  Database,
  TenantContext,
  TransactionDatabase,
} from "@exam/db/src/types.js";
import { createAuditLogWriter } from "@exam/db/src/repository/auditLogRepo.js";
import { assertAuditAction, type AuditActionKey } from "@exam/authz";
import {
  AUDIT_IP_ADDRESS_MAX_LENGTH,
  AUDIT_METADATA_MAX_BYTES,
  AUDIT_REQUEST_ID_MAX_LENGTH,
  AUDIT_TARGET_ID_MAX_LENGTH,
  AUDIT_TARGET_TYPE_MAX_LENGTH,
  AUDIT_USER_AGENT_MAX_LENGTH,
  assertActiveAuditAction,
  assertAuditDurability,
  validateAuditPayload,
  type ActiveAuditActionForDurability,
} from "./auditPolicy.js";

export interface AuditTarget<Action extends AuditActionKey = AuditActionKey> {
  action: Action;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

export interface SystemAuditContext {
  tenant: TenantContext | RequestContext;
  correlationId?: string;
}

const boundedTargetType = z.string().min(1).max(AUDIT_TARGET_TYPE_MAX_LENGTH);
const boundedTargetId = z.string().min(1).max(AUDIT_TARGET_ID_MAX_LENGTH);

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : value.slice(0, maximum);
}

function validateMetadataSize(metadata: Record<string, unknown>): void {
  const serialized = JSON.stringify(metadata);
  if (Buffer.byteLength(serialized, "utf8") > AUDIT_METADATA_MAX_BYTES) {
    throw new Error(
      `Audit metadata exceeds ${AUDIT_METADATA_MAX_BYTES} serialized bytes`,
    );
  }
}

function validatedTarget<Action extends AuditActionKey>(
  target: AuditTarget<Action>,
): AuditTarget<Action> & { metadata: Record<string, unknown> } {
  assertAuditAction(target.action);
  assertActiveAuditAction(target.action);
  const metadata = validateAuditPayload(target.action, target.metadata ?? {});
  boundedTargetType.parse(target.targetType);
  boundedTargetId.parse(target.targetId);
  return { ...target, metadata };
}

function requestEvent<Action extends AuditActionKey>(
  request: FastifyRequest,
  ctx: RequestContext,
  target: AuditTarget<Action>,
) {
  const checked = validatedTarget(target);
  const metadata: Record<string, unknown> = {
    ...checked.metadata,
    requestId: truncate(String(request.id), AUDIT_REQUEST_ID_MAX_LENGTH),
  };
  if (
    ctx.targetOrganizationId &&
    ctx.targetOrganizationId !== ctx.organizationId
  ) {
    metadata.actorOrganizationId = truncate(
      ctx.organizationId,
      AUDIT_TARGET_ID_MAX_LENGTH,
    );
  }
  validateMetadataSize(metadata);
  const rawUserAgent = request.headers["user-agent"];
  return {
    actorId: truncate(ctx.actorId, AUDIT_TARGET_ID_MAX_LENGTH),
    action: checked.action,
    targetType: checked.targetType,
    targetId: checked.targetId,
    metadata,
    ipAddress: truncate(request.ip, AUDIT_IP_ADDRESS_MAX_LENGTH),
    ...(rawUserAgent
      ? { userAgent: truncate(rawUserAgent, AUDIT_USER_AGENT_MAX_LENGTH) }
      : {}),
  };
}

function systemEvent<Action extends AuditActionKey>(
  context: SystemAuditContext,
  target: AuditTarget<Action>,
) {
  const checked = validatedTarget(target);
  const metadata = {
    ...checked.metadata,
    ...(context.correlationId
      ? {
          requestId: truncate(
            context.correlationId,
            AUDIT_REQUEST_ID_MAX_LENGTH,
          ),
        }
      : {}),
  };
  validateMetadataSize(metadata);
  return {
    actorId: truncate(context.tenant.actorId, AUDIT_TARGET_ID_MAX_LENGTH),
    action: checked.action,
    targetType: checked.targetType,
    targetId: checked.targetId,
    metadata,
  };
}

export async function recordAtomicHttpAudit(
  tx: TransactionDatabase,
  request: FastifyRequest,
  ctx: RequestContext,
  target: AuditTarget<ActiveAuditActionForDurability<"atomic">>,
): Promise<void> {
  assertAuditDurability(target.action, "atomic");
  await createAuditLogWriter<AuditActionKey>(tx).insert(
    ctx,
    requestEvent(request, ctx, target),
  );
}

export async function recordAtomicSystemAudit(
  tx: TransactionDatabase,
  context: SystemAuditContext,
  target: AuditTarget<ActiveAuditActionForDurability<"atomic">>,
): Promise<void> {
  assertAuditDurability(target.action, "atomic");
  await createAuditLogWriter<AuditActionKey>(tx).insert(
    context.tenant,
    systemEvent(context, target),
  );
}

export async function recordSensitiveReadAudit(
  db: Database,
  request: FastifyRequest,
  ctx: RequestContext,
  target: AuditTarget<
    ActiveAuditActionForDurability<"synchronous_sensitive_read">
  >,
): Promise<void> {
  assertAuditDurability(target.action, "synchronous_sensitive_read");
  await createAuditLogWriter<AuditActionKey>(db).insert(
    ctx,
    requestEvent(request, ctx, target),
  );
}

function logBestEffortFailure(
  logger: FastifyBaseLogger,
  ctx: RequestContext,
  target: AuditTarget<ActiveAuditActionForDurability<"best_effort">>,
  error: unknown,
): void {
  logger.error(
    {
      err: error,
      actorId: ctx.actorId,
      action: target.action,
      targetType: target.targetType,
      targetId: truncate(target.targetId, AUDIT_TARGET_ID_MAX_LENGTH),
    },
    "Failed to record best-effort audit observation",
  );
}

export function recordBestEffortAudit(
  fastify: FastifyInstance,
  request: FastifyRequest,
  ctx: RequestContext,
  target: AuditTarget<ActiveAuditActionForDurability<"best_effort">>,
): void {
  const snapshot = {
    ...target,
    metadata: { ...(target.metadata ?? {}) },
  };
  fastify.auditWrites.schedule(
    async () => {
      assertAuditDurability(snapshot.action, "best_effort");
      await createAuditLogWriter<AuditActionKey>(fastify.db).insert(
        ctx,
        requestEvent(request, ctx, snapshot),
      );
    },
    (error) => logBestEffortFailure(fastify.log, ctx, snapshot, error),
  );
}
