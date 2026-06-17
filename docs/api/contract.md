# API Contract

## Source of truth

The canonical API contract is generated from **runtime Fastify/Zod route schemas**.

Each route declares its request validation (`params`, `querystring`, `body`) and
response serialization (`response`) as Zod schemas in the route options. These
schemas are the single source of truth: they validate incoming requests at
runtime, constrain outgoing responses, and feed the generated OpenAPI spec.

**Generated OpenAPI** (`/api/docs/json`) is the canonical machine-readable
artifact. It is derived from the same Zod route schemas via
`fastify-type-provider-zod`'s `jsonSchemaTransform`.

Hand-written documentation (including `docs/api/reference.md`) is
**human-readable guidance** and may lag behind the generated OpenAPI. If this
document or any hand-written doc conflicts with generated OpenAPI or route
schemas, **generated OpenAPI / route schemas win**.

## Runtime-first policy

### Request validation

`params`, `querystring`, and `body` schemas are **runtime validators**.

- Malformed path params, query strings, or request bodies return
  `400 VALIDATION_ERROR` before the handler runs.
- The Zod type-provider extracts structured field-level error details.
- Client branching must use `error.code`, not `error.message`.

### Response serialization

`response` schemas are **runtime serialization contracts**.

- The Zod serializer compiler constrains every declared status code to its
  declared schema.
- Response fields **not declared** in the response schema are not part of the
  public API contract and may be stripped or cause a serialization failure.
- If a handler returns a payload that does not match the declared response
  schema, Fastify catches the mismatch and returns `500 INTERNAL_ERROR`.

### Tests

Tests should assert the **runtime contract** — the shapes declared in route
schemas and the error codes/structures returned by `buildErrorResponse` /
`buildValidationErrorResponse`. Do not assert undocumented legacy behavior.

## Error response contract

All standardized API errors use a single envelope:

```json
{
  "error": {
    "code": "RESOURCE_CONFLICT",
    "message": "Human readable message",
    "requestId": "req-...",
    "details": {}
  }
}
```

**Required fields:**

| Field              | Type     | Description                                |
| ------------------ | -------- | ------------------------------------------ |
| `error.code`       | `string` | Stable public `ErrorCode` (see below)      |
| `error.message`    | `string` | Human-readable, locale-defaulted message   |
| `error.requestId`  | `string` | Fastify request id (for support correlation)|

**Optional fields:**

| Field            | Type      | Description                                           |
| ---------------- | --------- | ----------------------------------------------------- |
| `error.details`  | `unknown` | Structured context — shape varies by `error.code`     |

## ErrorCode policy

`error.code` is a **stable public `ErrorCode`** defined in
`packages/contracts/src/messageRegistry.ts`. Client code should branch on
`error.code`, never on `error.message`.

**Rules:**

- Domain-specific reasons go into `error.details.reason`, not into a new
  top-level `error.code`.
- Do not invent route-local public error codes casually — prefer adding a new
  `ErrorCode` to the central registry if the condition is reusable.
- Do not use the human-readable `message` field for client-side branching.

**Example — structured details:**

```json
{
  "error": {
    "code": "RESOURCE_CONFLICT",
    "message": "Exam is not finished yet",
    "requestId": "req-a1b2c3",
    "details": {
      "reason": "EXAM_NOT_FINISHED"
    }
  }
}
```

**Example — validation error with field details:**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request parameters invalid",
    "requestId": "req-d4e5f6",
    "details": {
      "fields": [
        {
          "field": "email",
          "code": "INVALID_STRING",
          "message": "Invalid email"
        }
      ]
    }
  }
}
```

## Status boundary

| Case                                               | Status |
| -------------------------------------------------- | -----: |
| Malformed params / body / querystring              |    400 |
| Unauthenticated                                    |    401 |
| Authenticated but forbidden                        |    403 |
| Valid-shaped, missing resource                      |    404 |
| Valid-shaped, domain / resource conflict            |    409 |
| Internal failure or response serialization failure  |    500 |

## OpenAPI coverage policy

- All business API routes should appear in generated OpenAPI.
- Routes returning standardized error responses should declare
  `ErrorResponseSchema` for those status codes in their `response` schema.
- If a route returns a legacy ad-hoc error body but does **not** declare
  `ErrorResponseSchema`, it is not serializer-bound for that status — Fastify
  will not apply the error response serializer. This is safe from a serialization
  mismatch perspective, but remains a documentation and consistency gap.

## Serializer-bound vs legacy paths

| Path            | Declaration                                  | Behavior                                                    |
| --------------- | -------------------------------------------- | ----------------------------------------------------------- |
| Serializer-bound| Route declares `ErrorResponseSchema` for status | Actual response must match the envelope. OpenAPI documents the error. |
| Legacy non-bound| Route does **not** declare that error status | Fastify will not serialize that error through the Zod compiler. No mismatch, but undocumented. |

Serializer-bound is the target state. Legacy non-bound paths should be tracked
as cleanup debt and converted incrementally.

## Known follow-ups

The following items are intentionally left out of this document's scope:

- Add missing `ErrorResponseSchema` declarations for `question.ts` error
  responses (400, 404).
- Add missing `ErrorResponseSchema` declarations for `exam.ts` error
  responses (400, 404, 409).
- Clean up `course.ts` legacy ad-hoc error envelopes (no `requestId`, no
  standardized code).
- Eventually regenerate or rewrite `docs/api/reference.md` from generated
  OpenAPI.
- Future API reference / settings UI should consume generated OpenAPI, not the
  hand-written reference.
- Adopt `apps/api/src/openapi/routeMeta.ts` — replace inline `cookieAuth` /
  `idParamsSchema` / `x-role` definitions across route files with imports
  from this shared module to reduce duplication.
