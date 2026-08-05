-- 0027_converge_skipped_migrations.sql
--
-- Forward-only convergence for databases that recorded a later migration and
-- therefore permanently skipped 0004 / 0022 / 0024 because their journal `when`
-- timestamps are older than the max recorded `created_at`.
--
-- See issue #259 / #256. The drizzle-orm@0.45.x pg migrator applies a migration
-- only when `Number(lastDbMigration.created_at) < migration.folderMillis`
-- (pg-core/dialect.cjs). 0022 (when=1785253697471) and 0024 (when=1785621462155)
-- both predate 0023/0025/0026 in real time, so any DB that recorded any of the
-- later rows (max created_at up to 1788100000000) never receives their effects.
-- This migration restores those effects based on what is actually present.
--
-- This migration does NOT edit history: it does not change any prior journal
-- `when`, reorder entries, re-run old SQL, forge rows in
-- drizzle.__drizzle_migrations, drop/recreate, or delete business data. It is a
-- new forward entry whose `when` (1788200000000) is strictly greater than all
-- prior entries, and it repairs authoritative schema/data effects idempotently.
--
-- Effect inventory (what this migration converges):
--   A. 0004 — exam_attempts.grading_status column.
--      The 0004 table manual_grading_entries is NOT a target: it was replaced
--      by attempt_grading_entries (0013) and dropped (0014). The only durable
--      0004 effect is the grading_status column (nullable text, default
--      'auto_graded'), backfilled to 'auto_graded' for legacy rows.
--   B. 0024 — exam_proctor_assignments, exam_proctor_assignment_events, the
--      exams_org_id_unique composite-FK target index, and every CHECK / index
--      / FK named exactly as in 0024. Detected by table presence + exact shape.
--   C. 0022 — exam_attempts_status_pointer_check CHECK plus the interruption
--      episode/event convergence (missing disrupted episodes, stale-pointer
--      resolution, deduplicated outcome events). Detected by the CHECK and by
--      effect-level NOT EXISTS guards so a healthy DB is a pure no-op.
--
-- Fail-closed policy:
--   fully present + exact shape        -> verify, no-op
--   fully absent                       -> create / backfill
--   supported partial                  -> complete only the missing effects
--   incompatible partial (wrong type / nullability / PK / constraint def /
--                          duplicate data blocking a unique index)
--                                      -> RAISE EXCEPTION naming the object
--
-- All checks consult pg_catalog (pg_class / pg_attribute / pg_constraint /
-- pg_indexes / pg_get_constraintdef / pg_get_indexdef) so "effect present" means
-- the authoritative object exists with the authoritative definition, never just
-- to_regclass().

--> statement-breakpoint

-- ============================================================
-- SECTION A: 0004 — exam_attempts.grading_status
-- ============================================================
-- Add the column if absent; validate shape if present (incompatible => fail
-- closed); backfill NULLs either way. NOT NULL is intentionally NOT imposed:
-- 0004 added it nullable-with-default and the authoritative schema keeps it
-- nullable. Existing legitimate rows keep their values.
DO $$
DECLARE
  col_exists boolean;
  col_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'exam_attempts'::regclass
      AND attname = 'grading_status'
      AND NOT attisdropped
  ) INTO col_exists;

  IF NOT col_exists THEN
    ALTER TABLE "exam_attempts" ADD COLUMN "grading_status" text DEFAULT 'auto_graded';
  ELSE
    SELECT (
      a.atttypid = 'text'::regtype
      AND a.attnotnull = false
    ) INTO col_ok
    FROM pg_attribute a
    WHERE a.attrelid = 'exam_attempts'::regclass
      AND a.attname = 'grading_status'
      AND NOT a.attisdropped;

    IF NOT col_ok THEN
      RAISE EXCEPTION '0027-A: exam_attempts.grading_status exists with an incompatible shape (expected: text, nullable) — refusing to overwrite; repair manually'
        USING HINT = 'Inspect: SELECT atttypid::regtype, attnotnull FROM pg_attribute WHERE attrelid=''exam_attempts''::regclass AND attname=''grading_status''';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_attrdef d
      JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      WHERE d.adrelid = 'exam_attempts'::regclass
        AND a.attname = 'grading_status'
        AND pg_get_expr(d.adbin, d.adrelid) = '''auto_graded''::text'
    ) THEN
      RAISE EXCEPTION '0027-A: exam_attempts.grading_status has an unexpected column default — refusing to overwrite; repair manually'
        USING HINT = 'Inspect: SELECT pg_get_expr(adbin, adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE a.attname=''grading_status''';
    END IF;
  END IF;

  -- Backfill any NULLs (no-op when none). Never overwrites a legit value.
  UPDATE "exam_attempts" SET "grading_status" = 'auto_graded' WHERE "grading_status" IS NULL;
END $$;

--> statement-breakpoint

-- ============================================================
-- SECTION B: 0024 — proctor tables + composite-FK target
-- ============================================================

-- B0. exams_org_id_unique: the composite-FK target index on exams. Must exist
-- before exam_proctor_assignments_exam_fk. Verify the authoritative shape if
-- present (UNIQUE btree on exactly organization_id, id) via pg_index columns,
-- which is independent of cosmetic quoting/schema-qualification in
-- pg_get_indexdef.
DO $$
DECLARE
  idx_oid oid;
  idx_unique_ok boolean;
  idx_cols_ok boolean;
  idx_cols_ok_text text;
BEGIN
  SELECT c.oid
  INTO idx_oid
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  WHERE i.indrelid = 'exams'::regclass
    AND c.relname = 'exams_org_id_unique';

  IF idx_oid IS NULL THEN
    CREATE UNIQUE INDEX "exams_org_id_unique" ON "exams" USING btree ("organization_id","id");
  ELSE
    -- Must be unique, btree, valid, non-partial, exactly two key columns
    -- matching the authoritative pair (organization_id, id). A partial or
    -- invalid index of the same name cannot serve a composite FK and is
    -- rejected.
    SELECT i.indisunique
      AND NOT i.indnullsnotdistinct
      AND i.indimmediate
      AND i.indisvalid
      AND i.indisready
      AND i.indislive
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND i.indnatts = 2
      AND i.indnkeyatts = 2
      AND i.indoption::text = '0 0'
      AND am.amname = 'btree'
    INTO idx_unique_ok
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_am am ON am.oid = c.relam
    WHERE i.indexrelid = idx_oid;

    -- pg_index.indkey is an int2vector indexed from 0. Collect the referenced
    -- column names and require the set to be exactly {organization_id, id} in
    -- exactly that order (the composite-FK target order matters).
    SELECT string_agg(a.attname, ',' ORDER BY k.ord)
    INTO idx_cols_ok_text
    FROM pg_index i
    JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
      ON true
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE i.indexrelid = idx_oid;

    idx_cols_ok := (idx_cols_ok_text = 'organization_id,id');

    IF NOT (COALESCE(idx_unique_ok, false) AND idx_cols_ok) THEN
      RAISE EXCEPTION '0027-B0: exams_org_id_unique exists but its shape is incompatible (expected UNIQUE btree on exactly (organization_id, id)) — refusing to drop/recreate; repair manually'
        USING HINT = 'Existing definition: ' || pg_get_indexdef(idx_oid);
    END IF;
  END IF;
END $$;

--> statement-breakpoint

-- B1. exam_proctor_assignments: validate-or-create, then ensure indexes/FKs.
DO $$
DECLARE
  present boolean;
  col_ok boolean;
  status_def text;
  revocation_def text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname = 'exam_proctor_assignments' AND c.relkind = 'r'
  ) INTO present;

  IF present THEN
    -- Validate exact column shape. count(*) = 11 makes this set-equality: a
    -- table missing (or adding) a column fails even if every remaining column
    -- is in the allow-list. bool_and then checks type + nullability of each.
    SELECT count(*) = 11
      AND bool_and(
        (a.attname, a.atttypid::regtype::text, a.attnotnull) IN (
          ('id', 'text', true),
          ('organization_id', 'text', true),
          ('exam_id', 'text', true),
          ('proctor_user_id', 'text', true),
          ('status', 'text', true),
          ('assigned_by', 'text', true),
          ('assigned_at', 'timestamp with time zone', true),
          ('revoked_by', 'text', false),
          ('revoked_at', 'timestamp with time zone', false),
          ('created_at', 'timestamp with time zone', true),
          ('updated_at', 'timestamp with time zone', true)
        )
      ) INTO col_ok
    FROM pg_attribute a
    WHERE a.attrelid = 'exam_proctor_assignments'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped;
    IF NOT COALESCE(col_ok, false) THEN
      RAISE EXCEPTION '0027-B1: exam_proctor_assignments exists with an incompatible column shape — refusing to drop/recreate; repair manually';
    END IF;
    RETURN;
  END IF;

  CREATE TABLE "exam_proctor_assignments" (
    "id" text PRIMARY KEY NOT NULL,
    "organization_id" text NOT NULL,
    "exam_id" text NOT NULL,
    "proctor_user_id" text NOT NULL,
    "status" text DEFAULT 'active' NOT NULL,
    "assigned_by" text NOT NULL,
    "assigned_at" timestamp with time zone NOT NULL,
    "revoked_by" text,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "exam_proctor_assignments_status_check" CHECK ("exam_proctor_assignments"."status" IN ('active', 'revoked')),
    CONSTRAINT "exam_proctor_assignments_revocation_shape_check" CHECK (
      (
        "exam_proctor_assignments"."status" = 'active'
        AND "exam_proctor_assignments"."revoked_at" IS NULL
        AND "exam_proctor_assignments"."revoked_by" IS NULL
      )
      OR
      (
        "exam_proctor_assignments"."status" = 'revoked'
        AND "exam_proctor_assignments"."revoked_at" IS NOT NULL
        AND "exam_proctor_assignments"."revoked_by" IS NOT NULL
      )
    )
  );
END $$;

--> statement-breakpoint

-- B1a. Exact defaults, PK, and CHECKs for exam_proctor_assignments.
DO $$
DECLARE
  actual_default text;
  pk_ok boolean;
  invalid_check text;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid, false)
  INTO actual_default
  FROM pg_attrdef d
  JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
  WHERE d.adrelid='exam_proctor_assignments'::regclass AND a.attname='status';
  IF actual_default IS NULL THEN
    ALTER TABLE "exam_proctor_assignments" ALTER COLUMN "status" SET DEFAULT 'active';
  ELSIF actual_default != '''active''::text' THEN
    RAISE EXCEPTION '0027-B1a: exam_proctor_assignments.status default is incompatible (expected ''active'')';
  END IF;

  SELECT pg_get_expr(d.adbin, d.adrelid, false)
  INTO actual_default
  FROM pg_attrdef d
  JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
  WHERE d.adrelid='exam_proctor_assignments'::regclass AND a.attname='created_at';
  IF actual_default IS NULL THEN
    ALTER TABLE "exam_proctor_assignments" ALTER COLUMN "created_at" SET DEFAULT now();
  ELSIF actual_default != 'now()' THEN
    RAISE EXCEPTION '0027-B1a: exam_proctor_assignments.created_at default is incompatible (expected now())';
  END IF;

  SELECT pg_get_expr(d.adbin, d.adrelid, false)
  INTO actual_default
  FROM pg_attrdef d
  JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
  WHERE d.adrelid='exam_proctor_assignments'::regclass AND a.attname='updated_at';
  IF actual_default IS NULL THEN
    ALTER TABLE "exam_proctor_assignments" ALTER COLUMN "updated_at" SET DEFAULT now();
  ELSIF actual_default != 'now()' THEN
    RAISE EXCEPTION '0027-B1a: exam_proctor_assignments.updated_at default is incompatible (expected now())';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
    WHERE d.adrelid='exam_proctor_assignments'::regclass
      AND a.attname NOT IN ('status', 'created_at', 'updated_at')
  ) THEN
    RAISE EXCEPTION '0027-B1a: exam_proctor_assignments has an unexpected column default';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='exam_proctor_assignments'::regclass
      AND conname='exam_proctor_assignments_pkey'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid='exam_proctor_assignments'::regclass AND contype='p'
    ) THEN
      RAISE EXCEPTION '0027-B1a: exam_proctor_assignments has a non-authoritative primary key';
    END IF;
    ALTER TABLE "exam_proctor_assignments"
      ADD CONSTRAINT "exam_proctor_assignments_pkey" PRIMARY KEY ("id");
  END IF;

  SELECT c.contype='p'
    AND c.conenforced
    AND c.convalidated
    AND NOT c.condeferrable
    AND NOT c.condeferred
    AND ARRAY(
      SELECT a.attname::text
      FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
      ORDER BY k.ord
    ) = ARRAY['id']::text[]
    AND i.indisprimary AND i.indisunique
    AND NOT i.indnullsnotdistinct AND i.indimmediate
    AND i.indisvalid
    AND i.indisready AND i.indislive
    AND i.indnatts=1 AND i.indnkeyatts=1
    AND i.indpred IS NULL AND i.indexprs IS NULL
    AND i.indoption::text='0'
    AND am.amname='btree'
  INTO pk_ok
  FROM pg_constraint c
  LEFT JOIN pg_index i ON i.indexrelid=c.conindid
  LEFT JOIN pg_class ic ON ic.oid=i.indexrelid
  LEFT JOIN pg_am am ON am.oid=ic.relam
  WHERE c.conrelid='exam_proctor_assignments'::regclass
    AND c.conname='exam_proctor_assignments_pkey';
  IF NOT COALESCE(pk_ok, false) THEN
    RAISE EXCEPTION '0027-B1a: exam_proctor_assignments_pkey is incompatible';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='exam_proctor_assignments'::regclass
      AND conname='exam_proctor_assignments_status_check'
  ) THEN
    ALTER TABLE "exam_proctor_assignments"
      ADD CONSTRAINT "exam_proctor_assignments_status_check"
      CHECK ("status" IN ('active', 'revoked'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='exam_proctor_assignments'::regclass
      AND conname='exam_proctor_assignments_revocation_shape_check'
  ) THEN
    ALTER TABLE "exam_proctor_assignments"
      ADD CONSTRAINT "exam_proctor_assignments_revocation_shape_check" CHECK (
        ("status"='active' AND "revoked_at" IS NULL AND "revoked_by" IS NULL)
        OR
        ("status"='revoked' AND "revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL)
      );
  END IF;

  ALTER TABLE "exam_proctor_assignments"
    ADD CONSTRAINT "_0027_expected_assignments_status_check"
      CHECK ("status" IN ('active', 'revoked')) NOT VALID,
    ADD CONSTRAINT "_0027_expected_assignments_revocation_check" CHECK (
      ("status"='active' AND "revoked_at" IS NULL AND "revoked_by" IS NULL)
      OR
      ("status"='revoked' AND "revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL)
    ) NOT VALID;

  SELECT names.actual_name
  INTO invalid_check
  FROM (VALUES
    ('exam_proctor_assignments_status_check', '_0027_expected_assignments_status_check'),
    ('exam_proctor_assignments_revocation_shape_check', '_0027_expected_assignments_revocation_check')
  ) AS names(actual_name, expected_name)
  JOIN pg_constraint actual
    ON actual.conrelid='exam_proctor_assignments'::regclass
   AND actual.conname=names.actual_name
  JOIN pg_constraint expected
    ON expected.conrelid='exam_proctor_assignments'::regclass
   AND expected.conname=names.expected_name
  WHERE actual.contype!='c'
    OR NOT actual.conenforced
    OR actual.conbin!=expected.conbin
    OR actual.connoinherit
  LIMIT 1;
  IF invalid_check IS NOT NULL THEN
    RAISE EXCEPTION '0027-B1a: % is incompatible', invalid_check;
  END IF;

  ALTER TABLE "exam_proctor_assignments"
    DROP CONSTRAINT "_0027_expected_assignments_status_check",
    DROP CONSTRAINT "_0027_expected_assignments_revocation_check";
  ALTER TABLE "exam_proctor_assignments" VALIDATE CONSTRAINT "exam_proctor_assignments_status_check";
  ALTER TABLE "exam_proctor_assignments" VALIDATE CONSTRAINT "exam_proctor_assignments_revocation_shape_check";
END $$;

--> statement-breakpoint

-- B2. Add missing assignment indexes/FKs. Exact definitions are verified in B5.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND tablename='exam_proctor_assignments' AND indexname='exam_proctor_assignments_org_id_unique') THEN
    CREATE UNIQUE INDEX "exam_proctor_assignments_org_id_unique" ON "exam_proctor_assignments" USING btree ("organization_id","id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND tablename='exam_proctor_assignments' AND indexname='exam_proctor_assignments_active_unique') THEN
    CREATE UNIQUE INDEX "exam_proctor_assignments_active_unique" ON "exam_proctor_assignments" USING btree ("organization_id","exam_id","proctor_user_id") WHERE "exam_proctor_assignments"."status" = 'active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND tablename='exam_proctor_assignments' AND indexname='exam_proctor_assignments_org_exam_status_idx') THEN
    CREATE INDEX "exam_proctor_assignments_org_exam_status_idx" ON "exam_proctor_assignments" USING btree ("organization_id","exam_id","status");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND tablename='exam_proctor_assignments' AND indexname='exam_proctor_assignments_org_proctor_status_idx') THEN
    CREATE INDEX "exam_proctor_assignments_org_proctor_status_idx" ON "exam_proctor_assignments" USING btree ("organization_id","proctor_user_id","status");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND tablename='exam_proctor_assignments' AND indexname='exam_proctor_assignments_revoke_target_idx') THEN
    CREATE INDEX "exam_proctor_assignments_revoke_target_idx" ON "exam_proctor_assignments" USING btree ("organization_id","exam_id","proctor_user_id","status","revoked_at" DESC,"id" DESC);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='exam_proctor_assignments'::regclass AND conname='exam_proctor_assignments_org_fk') THEN
    ALTER TABLE "exam_proctor_assignments" ADD CONSTRAINT "exam_proctor_assignments_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='exam_proctor_assignments'::regclass AND conname='exam_proctor_assignments_proctor_user_fk') THEN
    ALTER TABLE "exam_proctor_assignments" ADD CONSTRAINT "exam_proctor_assignments_proctor_user_fk" FOREIGN KEY ("proctor_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='exam_proctor_assignments'::regclass AND conname='exam_proctor_assignments_assigned_by_fk') THEN
    ALTER TABLE "exam_proctor_assignments" ADD CONSTRAINT "exam_proctor_assignments_assigned_by_fk" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='exam_proctor_assignments'::regclass AND conname='exam_proctor_assignments_revoked_by_fk') THEN
    ALTER TABLE "exam_proctor_assignments" ADD CONSTRAINT "exam_proctor_assignments_revoked_by_fk" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='exam_proctor_assignments'::regclass AND conname='exam_proctor_assignments_exam_fk') THEN
    ALTER TABLE "exam_proctor_assignments" ADD CONSTRAINT "exam_proctor_assignments_exam_fk" FOREIGN KEY ("organization_id","exam_id") REFERENCES "exams"("organization_id","id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

-- B3. exam_proctor_assignment_events: validate-or-create.
DO $$
DECLARE
  present boolean;
  col_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname = 'exam_proctor_assignment_events' AND c.relkind = 'r'
  ) INTO present;

  IF present THEN
    -- Validate exact column shape. count(*) = 9 makes this set-equality (see
    -- B1 for the rationale).
    SELECT count(*) = 9
      AND bool_and(
        (a.attname, a.atttypid::regtype::text, a.attnotnull) IN (
          ('id', 'uuid', true),
          ('organization_id', 'text', true),
          ('assignment_id', 'text', true),
          ('command_type', 'text', true),
          ('operation_id', 'uuid', true),
          ('canonical_payload', 'jsonb', true),
          ('outcome', 'text', true),
          ('actor_id', 'text', true),
          ('created_at', 'timestamp with time zone', true)
        )
      ) INTO col_ok
    FROM pg_attribute a
    WHERE a.attrelid = 'exam_proctor_assignment_events'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped;
    IF NOT COALESCE(col_ok, false) THEN
      RAISE EXCEPTION '0027-B3: exam_proctor_assignment_events exists with an incompatible column shape — refusing to drop/recreate; repair manually';
    END IF;
    RETURN;
  END IF;

  CREATE TABLE "exam_proctor_assignment_events" (
    "id" uuid PRIMARY KEY NOT NULL,
    "organization_id" text NOT NULL,
    "assignment_id" text NOT NULL,
    "command_type" text NOT NULL,
    "operation_id" uuid NOT NULL,
    "canonical_payload" jsonb NOT NULL,
    "outcome" text NOT NULL,
    "actor_id" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "exam_proctor_assignment_events_command_type_check" CHECK ("exam_proctor_assignment_events"."command_type" IN ('assign', 'revoke')),
    CONSTRAINT "exam_proctor_assignment_events_outcome_check" CHECK ("exam_proctor_assignment_events"."outcome" IN ('applied', 'no_change'))
  );
END $$;

--> statement-breakpoint

-- B3a. Exact defaults, PK, and CHECKs for exam_proctor_assignment_events.
DO $$
DECLARE
  actual_default text;
  pk_ok boolean;
  invalid_check text;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid, false)
  INTO actual_default
  FROM pg_attrdef d
  JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
  WHERE d.adrelid='exam_proctor_assignment_events'::regclass AND a.attname='created_at';
  IF actual_default IS NULL THEN
    ALTER TABLE "exam_proctor_assignment_events" ALTER COLUMN "created_at" SET DEFAULT now();
  ELSIF actual_default != 'now()' THEN
    RAISE EXCEPTION '0027-B3a: exam_proctor_assignment_events.created_at default is incompatible (expected now())';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
    WHERE d.adrelid='exam_proctor_assignment_events'::regclass
      AND a.attname != 'created_at'
  ) THEN
    RAISE EXCEPTION '0027-B3a: exam_proctor_assignment_events has an unexpected column default';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='exam_proctor_assignment_events'::regclass
      AND conname='exam_proctor_assignment_events_pkey'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid='exam_proctor_assignment_events'::regclass AND contype='p'
    ) THEN
      RAISE EXCEPTION '0027-B3a: exam_proctor_assignment_events has a non-authoritative primary key';
    END IF;
    ALTER TABLE "exam_proctor_assignment_events"
      ADD CONSTRAINT "exam_proctor_assignment_events_pkey" PRIMARY KEY ("id");
  END IF;

  SELECT c.contype='p'
    AND c.conenforced
    AND c.convalidated
    AND NOT c.condeferrable
    AND NOT c.condeferred
    AND ARRAY(
      SELECT a.attname::text
      FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
      ORDER BY k.ord
    ) = ARRAY['id']::text[]
    AND i.indisprimary AND i.indisunique
    AND NOT i.indnullsnotdistinct AND i.indimmediate
    AND i.indisvalid
    AND i.indisready AND i.indislive
    AND i.indnatts=1 AND i.indnkeyatts=1
    AND i.indpred IS NULL AND i.indexprs IS NULL
    AND i.indoption::text='0'
    AND am.amname='btree'
  INTO pk_ok
  FROM pg_constraint c
  LEFT JOIN pg_index i ON i.indexrelid=c.conindid
  LEFT JOIN pg_class ic ON ic.oid=i.indexrelid
  LEFT JOIN pg_am am ON am.oid=ic.relam
  WHERE c.conrelid='exam_proctor_assignment_events'::regclass
    AND c.conname='exam_proctor_assignment_events_pkey';
  IF NOT COALESCE(pk_ok, false) THEN
    RAISE EXCEPTION '0027-B3a: exam_proctor_assignment_events_pkey is incompatible';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='exam_proctor_assignment_events'::regclass
      AND conname='exam_proctor_assignment_events_command_type_check'
  ) THEN
    ALTER TABLE "exam_proctor_assignment_events"
      ADD CONSTRAINT "exam_proctor_assignment_events_command_type_check"
      CHECK ("command_type" IN ('assign', 'revoke'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='exam_proctor_assignment_events'::regclass
      AND conname='exam_proctor_assignment_events_outcome_check'
  ) THEN
    ALTER TABLE "exam_proctor_assignment_events"
      ADD CONSTRAINT "exam_proctor_assignment_events_outcome_check"
      CHECK ("outcome" IN ('applied', 'no_change'));
  END IF;

  ALTER TABLE "exam_proctor_assignment_events"
    ADD CONSTRAINT "_0027_expected_events_command_type_check"
      CHECK ("command_type" IN ('assign', 'revoke')) NOT VALID,
    ADD CONSTRAINT "_0027_expected_events_outcome_check"
      CHECK ("outcome" IN ('applied', 'no_change')) NOT VALID;

  SELECT names.actual_name
  INTO invalid_check
  FROM (VALUES
    ('exam_proctor_assignment_events_command_type_check', '_0027_expected_events_command_type_check'),
    ('exam_proctor_assignment_events_outcome_check', '_0027_expected_events_outcome_check')
  ) AS names(actual_name, expected_name)
  JOIN pg_constraint actual
    ON actual.conrelid='exam_proctor_assignment_events'::regclass
   AND actual.conname=names.actual_name
  JOIN pg_constraint expected
    ON expected.conrelid='exam_proctor_assignment_events'::regclass
   AND expected.conname=names.expected_name
  WHERE actual.contype!='c'
    OR NOT actual.conenforced
    OR actual.conbin!=expected.conbin
    OR actual.connoinherit
  LIMIT 1;
  IF invalid_check IS NOT NULL THEN
    RAISE EXCEPTION '0027-B3a: % is incompatible', invalid_check;
  END IF;

  ALTER TABLE "exam_proctor_assignment_events"
    DROP CONSTRAINT "_0027_expected_events_command_type_check",
    DROP CONSTRAINT "_0027_expected_events_outcome_check";
  ALTER TABLE "exam_proctor_assignment_events" VALIDATE CONSTRAINT "exam_proctor_assignment_events_command_type_check";
  ALTER TABLE "exam_proctor_assignment_events" VALIDATE CONSTRAINT "exam_proctor_assignment_events_outcome_check";
END $$;

--> statement-breakpoint

-- B4. Add missing event indexes/FKs. Requires
-- exam_proctor_assignments + its org_id_unique index (created in B1/B2, or
-- already present-and-validated here).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND tablename='exam_proctor_assignment_events' AND indexname='exam_proctor_assignment_events_org_operation_unique') THEN
    CREATE UNIQUE INDEX "exam_proctor_assignment_events_org_operation_unique" ON "exam_proctor_assignment_events" USING btree ("organization_id","operation_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND tablename='exam_proctor_assignment_events' AND indexname='exam_proctor_assignment_events_assignment_idx') THEN
    CREATE INDEX "exam_proctor_assignment_events_assignment_idx" ON "exam_proctor_assignment_events" USING btree ("organization_id","assignment_id","created_at");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='exam_proctor_assignment_events'::regclass AND conname='exam_proctor_assignment_events_org_fk') THEN
    ALTER TABLE "exam_proctor_assignment_events" ADD CONSTRAINT "exam_proctor_assignment_events_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='exam_proctor_assignment_events'::regclass AND conname='exam_proctor_assignment_events_actor_fk') THEN
    ALTER TABLE "exam_proctor_assignment_events" ADD CONSTRAINT "exam_proctor_assignment_events_actor_fk" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='exam_proctor_assignment_events'::regclass AND conname='exam_proctor_assignment_events_assignment_fk') THEN
    ALTER TABLE "exam_proctor_assignment_events" ADD CONSTRAINT "exam_proctor_assignment_events_assignment_fk" FOREIGN KEY ("organization_id","assignment_id") REFERENCES "exam_proctor_assignments"("organization_id","id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

--> statement-breakpoint

-- B5. Validate the exact catalog shape of all seven secondary indexes and all
-- eight foreign keys. Compatible NOT VALID FKs are validated in place.
DO $$
DECLARE
  spec record;
  actual record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('exam_proctor_assignments', 'exam_proctor_assignments_org_id_unique', true, ARRAY['organization_id','id']::text[], '0 0', NULL::text),
      ('exam_proctor_assignments', 'exam_proctor_assignments_active_unique', true, ARRAY['organization_id','exam_id','proctor_user_id']::text[], '0 0 0', '(status = ''active''::text)'),
      ('exam_proctor_assignments', 'exam_proctor_assignments_org_exam_status_idx', false, ARRAY['organization_id','exam_id','status']::text[], '0 0 0', NULL::text),
      ('exam_proctor_assignments', 'exam_proctor_assignments_org_proctor_status_idx', false, ARRAY['organization_id','proctor_user_id','status']::text[], '0 0 0', NULL::text),
      ('exam_proctor_assignments', 'exam_proctor_assignments_revoke_target_idx', false, ARRAY['organization_id','exam_id','proctor_user_id','status','revoked_at','id']::text[], '0 0 0 0 3 3', NULL::text),
      ('exam_proctor_assignment_events', 'exam_proctor_assignment_events_org_operation_unique', true, ARRAY['organization_id','operation_id']::text[], '0 0', NULL::text),
      ('exam_proctor_assignment_events', 'exam_proctor_assignment_events_assignment_idx', false, ARRAY['organization_id','assignment_id','created_at']::text[], '0 0 0', NULL::text)
    ) AS expected(table_name, index_name, is_unique, key_defs, index_options, predicate)
  LOOP
    SELECT
      ic.oid AS index_oid,
      i.indisunique,
      i.indisprimary,
      i.indisexclusion,
      i.indnullsnotdistinct,
      i.indimmediate,
      i.indisvalid,
      i.indisready,
      i.indislive,
      i.indnatts,
      i.indnkeyatts,
      i.indoption::text AS index_options,
      i.indexprs,
      pg_get_expr(i.indpred, i.indrelid, false) AS predicate,
      am.amname,
      ARRAY(
        SELECT pg_get_indexdef(i.indexrelid, key_position, false)
        FROM generate_series(1, i.indnkeyatts) AS positions(key_position)
      ) AS key_defs
    INTO actual
    FROM pg_index i
    JOIN pg_class ic ON ic.oid=i.indexrelid
    JOIN pg_namespace n ON n.oid=ic.relnamespace
    JOIN pg_am am ON am.oid=ic.relam
    WHERE i.indrelid=to_regclass(spec.table_name)
      AND n.nspname=current_schema()
      AND ic.relname=spec.index_name;

    IF actual.index_oid IS NULL
      OR actual.indisunique IS DISTINCT FROM spec.is_unique
      OR actual.indisprimary
      OR actual.indisexclusion
      OR actual.indnullsnotdistinct
      OR NOT actual.indimmediate
      OR NOT actual.indisvalid
      OR NOT actual.indisready
      OR NOT actual.indislive
      OR actual.indnatts != cardinality(spec.key_defs)
      OR actual.indnkeyatts != cardinality(spec.key_defs)
      OR actual.index_options IS DISTINCT FROM spec.index_options
      OR actual.indexprs IS NOT NULL
      OR actual.predicate IS DISTINCT FROM spec.predicate
      OR actual.amname IS DISTINCT FROM 'btree'
      OR actual.key_defs IS DISTINCT FROM spec.key_defs
    THEN
      RAISE EXCEPTION '0027-B5: % is incompatible with the authoritative 0024 index definition', spec.index_name
        USING DETAIL = format(
          'actual unique=%s primary=%s exclusion=%s valid=%s ready=%s live=%s natts=%s nkeyatts=%s options=%s predicate=%s am=%s keys=%s; expected unique=%s options=%s predicate=%s keys=%s',
          actual.indisunique, actual.indisprimary, actual.indisexclusion,
          actual.indisvalid, actual.indisready, actual.indislive,
          actual.indnatts, actual.indnkeyatts, actual.index_options,
          actual.predicate, actual.amname, actual.key_defs,
          spec.is_unique, spec.index_options, spec.predicate, spec.key_defs
        );
    END IF;
  END LOOP;

  FOR spec IN
    SELECT * FROM (VALUES
      ('exam_proctor_assignments', 'exam_proctor_assignments_org_fk', ARRAY['organization_id']::text[], 'organizations', ARRAY['id']::text[]),
      ('exam_proctor_assignments', 'exam_proctor_assignments_proctor_user_fk', ARRAY['proctor_user_id']::text[], 'users', ARRAY['id']::text[]),
      ('exam_proctor_assignments', 'exam_proctor_assignments_assigned_by_fk', ARRAY['assigned_by']::text[], 'users', ARRAY['id']::text[]),
      ('exam_proctor_assignments', 'exam_proctor_assignments_revoked_by_fk', ARRAY['revoked_by']::text[], 'users', ARRAY['id']::text[]),
      ('exam_proctor_assignments', 'exam_proctor_assignments_exam_fk', ARRAY['organization_id','exam_id']::text[], 'exams', ARRAY['organization_id','id']::text[]),
      ('exam_proctor_assignment_events', 'exam_proctor_assignment_events_org_fk', ARRAY['organization_id']::text[], 'organizations', ARRAY['id']::text[]),
      ('exam_proctor_assignment_events', 'exam_proctor_assignment_events_actor_fk', ARRAY['actor_id']::text[], 'users', ARRAY['id']::text[]),
      ('exam_proctor_assignment_events', 'exam_proctor_assignment_events_assignment_fk', ARRAY['organization_id','assignment_id']::text[], 'exam_proctor_assignments', ARRAY['organization_id','id']::text[])
    ) AS expected(table_name, constraint_name, source_columns, target_table, target_columns)
  LOOP
    SELECT
      c.oid AS constraint_oid,
      c.contype,
      c.conenforced,
      c.convalidated,
      c.condeferrable,
      c.condeferred,
      c.confrelid,
      c.confupdtype,
      c.confdeltype,
      c.confmatchtype,
      ARRAY(
        SELECT a.attname::text
        FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
        ORDER BY k.ord
      ) AS source_columns,
      ARRAY(
        SELECT a.attname::text
        FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum
        ORDER BY k.ord
      ) AS target_columns
    INTO actual
    FROM pg_constraint c
    WHERE c.conrelid=to_regclass(spec.table_name)
      AND c.conname=spec.constraint_name;

    IF actual.constraint_oid IS NULL
      OR actual.contype IS DISTINCT FROM 'f'
      OR NOT actual.conenforced
      OR actual.condeferrable
      OR actual.condeferred
      OR actual.confrelid IS DISTINCT FROM to_regclass(spec.target_table)
      OR actual.confupdtype IS DISTINCT FROM 'a'
      OR actual.confdeltype IS DISTINCT FROM 'a'
      OR actual.confmatchtype IS DISTINCT FROM 's'
      OR actual.source_columns IS DISTINCT FROM spec.source_columns
      OR actual.target_columns IS DISTINCT FROM spec.target_columns
    THEN
      RAISE EXCEPTION '0027-B5: % is incompatible with the authoritative 0024 foreign-key definition', spec.constraint_name;
    END IF;

    IF NOT actual.convalidated THEN
      EXECUTE format(
        'ALTER TABLE %I VALIDATE CONSTRAINT %I',
        spec.table_name,
        spec.constraint_name
      );
    END IF;
  END LOOP;
END $$;

--> statement-breakpoint

-- ============================================================
-- SECTION C: 0022 — interruption convergence + status/pointer CHECK
-- ============================================================
-- 0022's durable effects are:
--   C1. fail-closed validation of corrupt interruption states.
--   C2. every disrupted attempt has exactly one authoritative episode with
--       exactly one 'detected' event.
--   C3. every non-disrupted attempt with a stale pointer has exactly one
--       outcome ('restored' / 'terminalized') event, then a NULL pointer.
--   C4. the exam_attempts_status_pointer_check CHECK exists with the exact
--       definition.
-- Prerequisite: 0021 interruption tables + exam_attempts interruption columns
-- must already exist (0021 when > 0022 when, so a DB that skipped 0022 always
-- has 0021). If they are missing, fail closed.

-- C0. Prerequisite presence gate.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname = 'attempt_interruptions' AND c.relkind = 'r'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname = 'attempt_interruption_events' AND c.relkind = 'r'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'exam_attempts'::regclass
      AND attname = 'current_interruption_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '0027-C0: 0021 interruption prerequisites (attempt_interruptions, attempt_interruption_events, exam_attempts.current_interruption_id) are missing — 0022 convergence cannot run; run the full 0021 migration first'
      USING HINT = 'This DB skipped 0022 but is also missing 0021 effects, which is unsupported by this convergence migration';
  END IF;
END $$;

--> statement-breakpoint

-- C1. Re-run the 0022 P1 validation. On a DB that skipped 0022, the bad shapes
-- it forbids cannot exist (0021 left pointers consistent and 0022 was the only
-- thing that could create the bad shapes), so these are no-ops. On a DB with a
-- *partial* 0022 apply they catch corruption and fail closed instead of
-- creating duplicate episodes/events.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "exam_attempts"
    WHERE "status" IN ('not_started', 'queued')
      AND "current_interruption_id" IS NOT NULL
  ) THEN
    RAISE EXCEPTION '0027-C1a: not_started/queued attempts with interruption pointer found'
      USING HINT = 'Run manual cleanup before applying migration 0027';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "exam_attempts" a
    WHERE a."status" = 'disrupted'
      AND a."current_interruption_id" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM "attempt_interruption_events" e
        WHERE e."interruption_id" = a."current_interruption_id"
          AND e."event_type" IN ('restored', 'terminalized')
      )
  ) THEN
    RAISE EXCEPTION '0027-C1b: disrupted attempts with existing outcome event found'
      USING HINT = 'Run manual cleanup before applying migration 0027';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "exam_attempts" a
    WHERE a."current_interruption_id" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "attempt_interruptions" p WHERE p."id" = a."current_interruption_id"
      )
  ) THEN
    RAISE EXCEPTION '0027-C1c: interruption pointer without parent episode found'
      USING HINT = 'Run manual cleanup before applying migration 0027';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "exam_attempts" a
    JOIN "attempt_interruptions" p ON p."id" = a."current_interruption_id"
    WHERE a."current_interruption_id" IS NOT NULL AND p."attempt_id" != a."id"
  ) THEN
    RAISE EXCEPTION '0027-C1d: interruption episode attempt_id mismatch found'
      USING HINT = 'Run manual cleanup before applying migration 0027';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "exam_attempts" a
    WHERE a."current_interruption_id" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "attempt_interruption_events" e
        WHERE e."interruption_id" = a."current_interruption_id" AND e."event_type" = 'detected'
      )
  ) THEN
    RAISE EXCEPTION '0027-C1e: interruption pointer without detected event found'
      USING HINT = 'Run manual cleanup before applying migration 0027';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "exam_attempts" a
    JOIN "attempt_interruption_events" e ON e."interruption_id" = a."current_interruption_id" AND e."event_type" = 'detected'
    WHERE a."current_interruption_id" IS NOT NULL AND e."attempt_id" != a."id"
  ) THEN
    RAISE EXCEPTION '0027-C1f: detected event attempt_id mismatch found'
      USING HINT = 'Run manual cleanup before applying migration 0027';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "exam_attempts" a
    JOIN "attempt_interruption_events" e ON e."interruption_id" = a."current_interruption_id" AND e."event_type" = 'detected'
    WHERE a."current_interruption_id" IS NOT NULL AND a."interrupted_at" IS DISTINCT FROM e."occurred_at"
  ) THEN
    RAISE EXCEPTION '0027-C1h: interrupted_at mismatch with detected event occurred_at found'
      USING HINT = 'Run manual cleanup before applying migration 0027';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "attempt_interruption_events"
    WHERE "event_type" = 'detected'
    GROUP BY "interruption_id" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION '0027-C1i: multiple detected events for same interruption found'
      USING HINT = 'Run manual cleanup before applying migration 0027';
  END IF;
END $$;

--> statement-breakpoint

-- C2. Reuse exactly one legal open episode for a disrupted attempt with a NULL
-- pointer. Create a new episode only when none exists; multiple or malformed
-- open episodes are incompatible and fail closed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "exam_attempts" a
    JOIN "attempt_interruptions" p ON p."attempt_id"=a."id"
    WHERE a."status"='disrupted'
      AND a."current_interruption_id" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "attempt_interruption_events" outcome
        WHERE outcome."interruption_id"=p."id"
          AND outcome."event_type" IN ('restored', 'terminalized')
      )
    GROUP BY a."id", p."id", a."organization_id", p."organization_id"
    HAVING p."organization_id" != a."organization_id"
      OR count(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM "attempt_interruption_events" detected
          WHERE detected."interruption_id"=p."id"
            AND detected."event_type"='detected'
            AND detected."attempt_id"=a."id"
            AND detected."organization_id"=a."organization_id"
        )
      ) != 1
      OR (
        SELECT count(*)
        FROM "attempt_interruption_events" detected
        WHERE detected."interruption_id"=p."id"
          AND detected."event_type"='detected'
      ) != 1
  ) THEN
    RAISE EXCEPTION '0027-C2: malformed open interruption episode exists for a disrupted attempt with a NULL pointer';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "exam_attempts" a
    JOIN "attempt_interruptions" p
      ON p."attempt_id"=a."id" AND p."organization_id"=a."organization_id"
    JOIN "attempt_interruption_events" detected
      ON detected."interruption_id"=p."id"
     AND detected."event_type"='detected'
     AND detected."attempt_id"=a."id"
     AND detected."organization_id"=a."organization_id"
    WHERE a."status"='disrupted'
      AND a."current_interruption_id" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "attempt_interruption_events" outcome
        WHERE outcome."interruption_id"=p."id"
          AND outcome."event_type" IN ('restored', 'terminalized')
      )
    GROUP BY a."id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '0027-C2: multiple legal open interruption episodes exist for a disrupted attempt with a NULL pointer';
  END IF;
END $$;

--> statement-breakpoint

CREATE TEMPORARY TABLE "_2027_missing_disrupted" (
  "attempt_id" text PRIMARY KEY,
  "interruption_id" uuid NOT NULL,
  "detected_at" timestamp with time zone NOT NULL,
  "reused" boolean NOT NULL
) ON COMMIT DROP;

--> statement-breakpoint

INSERT INTO "_2027_missing_disrupted" ("attempt_id", "interruption_id", "detected_at", "reused")
SELECT a."id", p."id", detected."occurred_at", true
FROM "exam_attempts" a
JOIN "attempt_interruptions" p
  ON p."attempt_id"=a."id" AND p."organization_id"=a."organization_id"
JOIN "attempt_interruption_events" detected
  ON detected."interruption_id"=p."id"
 AND detected."event_type"='detected'
 AND detected."attempt_id"=a."id"
 AND detected."organization_id"=a."organization_id"
WHERE a."status"='disrupted'
  AND a."current_interruption_id" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "attempt_interruption_events" outcome
    WHERE outcome."interruption_id"=p."id"
      AND outcome."event_type" IN ('restored', 'terminalized')
  );

--> statement-breakpoint

INSERT INTO "_2027_missing_disrupted" ("attempt_id", "interruption_id", "detected_at", "reused")
SELECT a."id", gen_random_uuid(), transaction_timestamp(), false
FROM "exam_attempts" a
WHERE a."status"='disrupted'
  AND a."current_interruption_id" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "_2027_missing_disrupted" mapped
    WHERE mapped."attempt_id"=a."id"
  );

--> statement-breakpoint

INSERT INTO "attempt_interruptions" ("id", "organization_id", "attempt_id", "created_at")
SELECT m."interruption_id", a."organization_id", a."id", m."detected_at"
FROM "_2027_missing_disrupted" m
JOIN "exam_attempts" a ON a."id" = m."attempt_id"
WHERE NOT m."reused"
AND NOT EXISTS (
  SELECT 1 FROM "attempt_interruptions" p
  WHERE p."attempt_id" = a."id" AND p."id" = m."interruption_id"
);

--> statement-breakpoint

INSERT INTO "attempt_interruption_events" (
  "id", "organization_id", "attempt_id", "interruption_id",
  "event_type", "occurred_at", "observed_last_activity_at",
  "detection_source", "timeout_seconds", "policy",
  "eligible_seconds", "time_adjustment_id", "actor_id",
  "reason_code", "created_at"
)
SELECT
  gen_random_uuid()::text, a."organization_id", a."id", m."interruption_id",
  'detected', m."detected_at", a."last_activity_at",
  'migration_backfill', NULL, COALESCE(a."interruption_time_policy_snapshot", 'strict'),
  NULL, NULL, NULL, 'migration_backfill_unknown_detected_at', m."detected_at"
FROM "_2027_missing_disrupted" m
JOIN "exam_attempts" a ON a."id" = m."attempt_id"
WHERE NOT m."reused"
AND NOT EXISTS (
  SELECT 1 FROM "attempt_interruption_events" e
  WHERE e."interruption_id" = m."interruption_id" AND e."event_type" = 'detected'
);

--> statement-breakpoint

UPDATE "exam_attempts" a
SET "current_interruption_id" = m."interruption_id", "interrupted_at" = m."detected_at"
FROM "_2027_missing_disrupted" m
WHERE a."id" = m."attempt_id" AND a."current_interruption_id" IS NULL;

--> statement-breakpoint

-- C3. Resolve stale pointers on non-disrupted attempts (0022 P3). Outcome-event
-- inserts are effect-level NOT EXISTS, so re-runs do not duplicate. The pointer
-- clear in C4 is idempotent.
INSERT INTO "attempt_interruption_events" (
  "id", "organization_id", "attempt_id", "interruption_id",
  "event_type", "occurred_at", "observed_last_activity_at",
  "detection_source", "timeout_seconds", "policy",
  "eligible_seconds", "time_adjustment_id", "actor_id",
  "reason_code", "created_at"
)
SELECT
  gen_random_uuid()::text, a."organization_id", a."id", a."current_interruption_id",
  'restored', transaction_timestamp(), NULL,
  NULL, NULL, COALESCE(a."interruption_time_policy_snapshot", 'strict'),
  NULL, NULL, NULL, 'migration_stale_pointer_resolved', transaction_timestamp()
FROM "exam_attempts" a
WHERE a."status" = 'in_progress' AND a."current_interruption_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "attempt_interruption_events" e
    WHERE e."interruption_id" = a."current_interruption_id"
      AND e."event_type" IN ('restored', 'terminalized')
  );

--> statement-breakpoint

INSERT INTO "attempt_interruption_events" (
  "id", "organization_id", "attempt_id", "interruption_id",
  "event_type", "occurred_at", "observed_last_activity_at",
  "detection_source", "timeout_seconds", "policy",
  "eligible_seconds", "time_adjustment_id", "actor_id",
  "reason_code", "created_at"
)
SELECT
  gen_random_uuid()::text, a."organization_id", a."id", a."current_interruption_id",
  'terminalized', transaction_timestamp(), NULL,
  NULL, NULL, COALESCE(a."interruption_time_policy_snapshot", 'strict'),
  NULL, NULL, NULL, 'migration_stale_pointer_resolved', transaction_timestamp()
FROM "exam_attempts" a
WHERE a."status" IN ('submitted', 'grading', 'graded', 'voided')
  AND a."current_interruption_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "attempt_interruption_events" e
    WHERE e."interruption_id" = a."current_interruption_id"
      AND e."event_type" IN ('restored', 'terminalized')
  );

--> statement-breakpoint

-- C4. Clear all stale pointers on non-disrupted attempts (idempotent).
UPDATE "exam_attempts"
SET "current_interruption_id" = NULL, "interrupted_at" = NULL
WHERE "status" != 'disrupted' AND "current_interruption_id" IS NOT NULL;

--> statement-breakpoint

-- C5. Install the status/pointer CHECK with the exact 0022 definition. Compare
-- PostgreSQL's canonical expression tree against a temporary authoritative
-- CHECK on the same table, then validate a compatible NOT VALID constraint.
DO $$
DECLARE
  shape_ok boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid='exam_attempts'::regclass
      AND c.conname='exam_attempts_status_pointer_check'
  ) THEN
    ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_status_pointer_check" CHECK (
        ("exam_attempts"."status" = 'disrupted' AND "exam_attempts"."current_interruption_id" IS NOT NULL AND "exam_attempts"."interrupted_at" IS NOT NULL)
        OR
        ("exam_attempts"."status" != 'disrupted' AND "exam_attempts"."current_interruption_id" IS NULL AND "exam_attempts"."interrupted_at" IS NULL)
      );
  END IF;

  ALTER TABLE "exam_attempts"
    ADD CONSTRAINT "_0027_expected_status_pointer_check" CHECK (
      ("status"='disrupted' AND "current_interruption_id" IS NOT NULL AND "interrupted_at" IS NOT NULL)
      OR
      ("status"!='disrupted' AND "current_interruption_id" IS NULL AND "interrupted_at" IS NULL)
    ) NOT VALID;

  SELECT actual.contype='c'
    AND actual.conenforced
    AND actual.conbin=expected.conbin
    AND NOT actual.connoinherit
  INTO shape_ok
  FROM pg_constraint actual
  JOIN pg_constraint expected
    ON expected.conrelid=actual.conrelid
   AND expected.conname='_0027_expected_status_pointer_check'
  WHERE actual.conrelid='exam_attempts'::regclass
    AND actual.conname='exam_attempts_status_pointer_check';
  IF NOT COALESCE(shape_ok, false) THEN
    RAISE EXCEPTION '0027-C5: exam_attempts_status_pointer_check is incompatible with the authoritative 0022 expression';
  END IF;

  ALTER TABLE "exam_attempts" DROP CONSTRAINT "_0027_expected_status_pointer_check";
  ALTER TABLE "exam_attempts" VALIDATE CONSTRAINT "exam_attempts_status_pointer_check";
END $$;

--> statement-breakpoint

-- ============================================================
-- POSTCONDITIONS (run inside the same transaction before commit)
-- ============================================================
-- If any fails, the whole migration transaction rolls back (the migrator wraps
-- all statements in one transaction), so a partial convergence can never be
-- recorded as applied.
DO $$
DECLARE
  grading_status_ok boolean;
  proctor_tables_ok boolean;
  proctor_defaults_ok boolean;
  proctor_constraints_ok boolean;
  proctor_indexes_ok boolean;
  status_pointer_check_ok boolean;
  no_orphan_disrupted boolean;
  no_stale_pointer boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'exam_attempts'::regclass
      AND attname = 'grading_status' AND NOT attisdropped
      AND atttypid = 'text'::regtype AND attnotnull = false
  ) INTO grading_status_ok;

  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname='exam_proctor_assignments' AND c.relkind='r'
  ) AND EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname='exam_proctor_assignment_events' AND c.relkind='r'
  ) INTO proctor_tables_ok;

  SELECT count(*)=4 AND bool_and(
    (table_name, column_name, default_expr) IN (
      ('exam_proctor_assignments', 'status', '''active''::text'),
      ('exam_proctor_assignments', 'created_at', 'now()'),
      ('exam_proctor_assignments', 'updated_at', 'now()'),
      ('exam_proctor_assignment_events', 'created_at', 'now()')
    )
  )
  INTO proctor_defaults_ok
  FROM (
    SELECT d.adrelid::regclass::text AS table_name,
      a.attname AS column_name,
      pg_get_expr(d.adbin, d.adrelid, false) AS default_expr
    FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
    WHERE d.adrelid IN (
      'exam_proctor_assignments'::regclass,
      'exam_proctor_assignment_events'::regclass
    )
  ) defaults;

  SELECT count(*)=14
    AND count(*) FILTER (WHERE contype='p')=2
    AND count(*) FILTER (WHERE contype='c')=4
    AND count(*) FILTER (WHERE contype='f')=8
    AND bool_and(conenforced AND convalidated)
  INTO proctor_constraints_ok
  FROM pg_constraint
  WHERE conrelid IN (
    'exam_proctor_assignments'::regclass,
    'exam_proctor_assignment_events'::regclass
  )
  AND conname IN (
    'exam_proctor_assignments_pkey',
    'exam_proctor_assignments_status_check',
    'exam_proctor_assignments_revocation_shape_check',
    'exam_proctor_assignments_org_fk',
    'exam_proctor_assignments_proctor_user_fk',
    'exam_proctor_assignments_assigned_by_fk',
    'exam_proctor_assignments_revoked_by_fk',
    'exam_proctor_assignments_exam_fk',
    'exam_proctor_assignment_events_pkey',
    'exam_proctor_assignment_events_command_type_check',
    'exam_proctor_assignment_events_outcome_check',
    'exam_proctor_assignment_events_org_fk',
    'exam_proctor_assignment_events_actor_fk',
    'exam_proctor_assignment_events_assignment_fk'
  );

  SELECT count(*)=9
    AND bool_and(i.indisvalid AND i.indisready AND i.indislive)
    AND count(*) FILTER (WHERE i.indisprimary)=2
    AND count(*) FILTER (WHERE i.indisunique)=5
  INTO proctor_indexes_ok
  FROM pg_index i
  JOIN pg_class c ON c.oid=i.indexrelid
  WHERE i.indrelid IN (
    'exam_proctor_assignments'::regclass,
    'exam_proctor_assignment_events'::regclass
  )
  AND c.relname IN (
    'exam_proctor_assignments_pkey',
    'exam_proctor_assignments_org_id_unique',
    'exam_proctor_assignments_active_unique',
    'exam_proctor_assignments_org_exam_status_idx',
    'exam_proctor_assignments_org_proctor_status_idx',
    'exam_proctor_assignments_revoke_target_idx',
    'exam_proctor_assignment_events_pkey',
    'exam_proctor_assignment_events_org_operation_unique',
    'exam_proctor_assignment_events_assignment_idx'
  );

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='exam_attempts'::regclass
      AND conname='exam_attempts_status_pointer_check'
      AND contype='c' AND conenforced AND convalidated
  ) INTO status_pointer_check_ok;

  SELECT NOT EXISTS (
    SELECT 1 FROM "exam_attempts"
    WHERE "status" = 'disrupted'
      AND ("current_interruption_id" IS NULL OR "interrupted_at" IS NULL)
  ) INTO no_orphan_disrupted;

  SELECT NOT EXISTS (
    SELECT 1 FROM "exam_attempts"
    WHERE "status" != 'disrupted' AND "current_interruption_id" IS NOT NULL
  ) INTO no_stale_pointer;

  IF NOT grading_status_ok THEN
    RAISE EXCEPTION '0027-POST: grading_status postcondition failed';
  END IF;
  IF NOT proctor_tables_ok THEN
    RAISE EXCEPTION '0027-POST: proctor tables postcondition failed';
  END IF;
  IF NOT proctor_defaults_ok THEN
    RAISE EXCEPTION '0027-POST: proctor defaults postcondition failed';
  END IF;
  IF NOT proctor_constraints_ok THEN
    RAISE EXCEPTION '0027-POST: proctor constraints postcondition failed';
  END IF;
  IF NOT proctor_indexes_ok THEN
    RAISE EXCEPTION '0027-POST: proctor indexes postcondition failed';
  END IF;
  IF NOT status_pointer_check_ok THEN
    RAISE EXCEPTION '0027-POST: status_pointer_check postcondition failed';
  END IF;
  IF NOT no_orphan_disrupted THEN
    RAISE EXCEPTION '0027-POST: orphan disrupted attempt postcondition failed';
  END IF;
  IF NOT no_stale_pointer THEN
    RAISE EXCEPTION '0027-POST: stale pointer postcondition failed';
  END IF;
END $$;
