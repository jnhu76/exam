-- RBAC-M10-E: assignment authority flip data-integrity migration.
--
-- Establishes the ≤1 active-primary-per-(org,user) invariant at the DB level
-- (partial unique index) AND normalizes any pre-existing data that would
-- violate it, so the runtime resolver (apps/api/src/authz/assignmentAuthority.ts)
-- can trust the active assignment set as the single human authority source.
--
-- Normalization MUST run BEFORE the partial unique index is created, and in
-- this strict order:
--   1. dedupe multiple active primaries (keep one, demote the rest);
--   2. promote an existing ACTIVE assignment for zero-primary users (ONLY
--      active rows — users with only inactive assignments stay un-authorized
--      on purpose; inactive is an explicit revocation, not a gap to fill);
--   3. insert a primary assignment only for users with NO assignment row at
--      all (the genuinely-orphaned case — e.g. users created via the
--      pre-flip candidate/bootstrap paths that never wrote an assignment);
--   4. re-sync users.role (compatibility cache) to the final primary role;
--   5. create the partial unique index (the DB backstop).
--
-- All steps are idempotent (NOT EXISTS / rn > 1 guards) so re-running against
-- already-normalized data is a no-op.

-- 1. Deduplicate multiple active primaries.
WITH ranked_primaries AS (
  SELECT
    ura.id,
    ROW_NUMBER() OVER (
      PARTITION BY ura.organization_id, ura.user_id
      ORDER BY
        (ura.role = u.role) DESC,
        ura.created_at ASC,
        ura.id ASC
    ) AS rn
  FROM "user_role_assignments" ura
  JOIN "users" u
    ON u."id" = ura."user_id"
   AND u."organization_id" = ura."organization_id"
  WHERE ura."is_primary" = true
    AND ura."is_active" = true
)
UPDATE "user_role_assignments"
SET "is_primary" = false, "updated_at" = now()
WHERE "id" IN (SELECT "id" FROM ranked_primaries WHERE rn > 1);

-- 2. Promote an existing ACTIVE assignment for zero-primary users.
WITH ranked_active AS (
  SELECT
    ura.id,
    ROW_NUMBER() OVER (
      PARTITION BY ura.organization_id, ura.user_id
      ORDER BY
        (ura.role = u.role) DESC,
        ura.created_at ASC,
        ura.id ASC
    ) AS rn
  FROM "user_role_assignments" ura
  JOIN "users" u
    ON u."id" = ura."user_id"
   AND u."organization_id" = ura."organization_id"
  WHERE ura."is_active" = true
    AND NOT EXISTS (
      SELECT 1
      FROM "user_role_assignments" p
      WHERE p."organization_id" = ura."organization_id"
        AND p."user_id" = ura."user_id"
        AND p."is_primary" = true
        AND p."is_active" = true
    )
)
UPDATE "user_role_assignments"
SET "is_primary" = true, "updated_at" = now()
WHERE "id" IN (SELECT "id" FROM ranked_active WHERE rn = 1);

-- 3. Insert only for users with NO assignment row at all (the orphaned case).
INSERT INTO "user_role_assignments"
  ("id", "organization_id", "user_id", "role", "is_primary", "is_active", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  u."organization_id",
  u."id",
  u."role",
  true,
  true,
  now(),
  now()
FROM "users" u
WHERE NOT EXISTS (
  SELECT 1
  FROM "user_role_assignments" ura
  WHERE ura."organization_id" = u."organization_id"
    AND ura."user_id" = u."id"
);

-- 4. Re-sync users.role compatibility cache to the final primary role.
UPDATE "users" u
SET "role" = ura."role", "updated_at" = now()
FROM "user_role_assignments" ura
WHERE ura."organization_id" = u."organization_id"
  AND ura."user_id" = u."id"
  AND ura."is_primary" = true
  AND ura."is_active" = true
  AND u."role" <> ura."role";

-- 5. The DB-level backstop the runtime resolver also fail-closes on.
CREATE UNIQUE INDEX "user_role_assignments_active_primary_unique" ON "user_role_assignments" USING btree ("organization_id","user_id") WHERE is_primary = true AND is_active = true;
