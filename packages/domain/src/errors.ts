export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 500,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 400);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, "NOT_FOUND", 404);
  }
}

export class InvalidStateTransitionError extends AppError {
  constructor(message: string) {
    super(message, "INVALID_STATE_TRANSITION", 409);
  }
}

export class PermissionDeniedError extends AppError {
  constructor(message = "Permission denied") {
    super(message, "PERMISSION_DENIED", 403);
  }
}

export class TenantAccessDeniedError extends AppError {
  constructor(message = "Tenant access denied") {
    super(message, "TENANT_ACCESS_DENIED", 403);
  }
}

export class AttemptAlreadyStartedError extends AppError {
  constructor(message = "Attempt already started") {
    super(message, "ATTEMPT_ALREADY_STARTED", 409);
  }
}

export class AttemptClosedError extends AppError {
  constructor(message = "Attempt is closed") {
    super(message, "ATTEMPT_CLOSED", 409);
  }
}

export class AnswerVersionConflictError extends AppError {
  constructor(message = "Answer version conflict") {
    super(message, "ANSWER_VERSION_CONFLICT", 409);
  }
}

export class ExamNotOpenError extends AppError {
  constructor(message = "Exam is not open") {
    super(message, "EXAM_NOT_OPEN", 409);
  }
}

export class AttemptDeadlineExceededError extends AppError {
  constructor(message = "Attempt deadline exceeded") {
    super(message, "ATTEMPT_DEADLINE_EXCEEDED", 409);
  }
}

/** @deprecated Use AttemptDeadlineExceededError */
export const ExamTimeExpiredError = AttemptDeadlineExceededError;

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "CONFLICT", 409);
  }
}
