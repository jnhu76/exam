--
-- PostgreSQL database dump
--

\restrict 8D4cxMp8xLJhp2WrWEuhja5TfxzaBcbzhSYVhNNFeiWonSl8hiIMjHlwqNGfYGA

-- Dumped from database version 18.4 (Debian 18.4-1.pgdg12+1)
-- Dumped by pg_dump version 18.4 (Debian 18.4-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: exam
--

CREATE SCHEMA drizzle;


ALTER SCHEMA drizzle OWNER TO exam;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: exam
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


ALTER TABLE drizzle.__drizzle_migrations OWNER TO exam;

--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: exam
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNER TO exam;

--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: exam
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: attempt_command_receipts; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.attempt_command_receipts (
    id uuid NOT NULL,
    organization_id text NOT NULL,
    attempt_id text NOT NULL,
    operation_id uuid NOT NULL,
    command_type text NOT NULL,
    request_payload jsonb NOT NULL,
    result_payload jsonb NOT NULL,
    outcome text NOT NULL,
    actor_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attempt_command_receipts_command_type_check CHECK ((command_type = ANY (ARRAY['force_submit'::text, 'misconduct_mark'::text]))),
    CONSTRAINT attempt_command_receipts_outcome_check CHECK ((outcome = ANY (ARRAY['applied'::text, 'no_change'::text]))),
    CONSTRAINT attempt_command_receipts_request_payload_check CHECK ((jsonb_typeof(request_payload) = 'object'::text)),
    CONSTRAINT attempt_command_receipts_result_payload_check CHECK ((jsonb_typeof(result_payload) = 'object'::text))
);


ALTER TABLE public.attempt_command_receipts OWNER TO exam;

--
-- Name: attempt_grading_entries; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.attempt_grading_entries (
    id text NOT NULL,
    organization_id text NOT NULL,
    attempt_id text NOT NULL,
    question_id text NOT NULL,
    grading_mode text NOT NULL,
    status text NOT NULL,
    max_score double precision NOT NULL,
    earned_score double precision,
    candidate_answer jsonb,
    standard_answer jsonb,
    correct boolean,
    comment text DEFAULT ''::text NOT NULL,
    graded_by text,
    graded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attempt_grading_entries_earned_score_check CHECK ((earned_score >= (0)::double precision)),
    CONSTRAINT attempt_grading_entries_earned_score_limit_check CHECK ((earned_score <= max_score)),
    CONSTRAINT attempt_grading_entries_max_score_check CHECK ((max_score >= (0)::double precision)),
    CONSTRAINT attempt_grading_entries_mode_check CHECK ((grading_mode = ANY (ARRAY['auto'::text, 'manual'::text]))),
    CONSTRAINT attempt_grading_entries_status_check CHECK ((status = ANY (ARRAY['completed_auto'::text, 'pending_manual'::text, 'completed_manual'::text])))
);


ALTER TABLE public.attempt_grading_entries OWNER TO exam;

--
-- Name: attempt_interruption_events; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.attempt_interruption_events (
    id text NOT NULL,
    organization_id text NOT NULL,
    attempt_id text NOT NULL,
    interruption_id uuid NOT NULL,
    event_type text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    observed_last_activity_at timestamp with time zone,
    detection_source text,
    timeout_seconds integer,
    policy text NOT NULL,
    eligible_seconds integer,
    time_adjustment_id text,
    actor_id text,
    reason_code character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attempt_interruption_events_eligible_seconds_check CHECK (((eligible_seconds IS NULL) OR (eligible_seconds >= 0))),
    CONSTRAINT attempt_interruption_events_policy_check CHECK ((policy = ANY (ARRAY['strict'::text, 'bounded_grace'::text, 'operator_incident'::text]))),
    CONSTRAINT attempt_interruption_events_reason_code_check CHECK ((length(btrim((reason_code)::text)) > 0)),
    CONSTRAINT attempt_interruption_events_shape_check CHECK ((((event_type = 'detected'::text) AND (detection_source IS NOT NULL) AND (time_adjustment_id IS NULL) AND (((detection_source = 'heartbeat_timeout'::text) AND (observed_last_activity_at IS NOT NULL) AND (timeout_seconds IS NOT NULL) AND (timeout_seconds > 0)) OR ((detection_source = 'migration_backfill'::text) AND (timeout_seconds IS NULL) AND ((reason_code)::text = 'migration_backfill_unknown_detected_at'::text)))) OR ((event_type = ANY (ARRAY['restored'::text, 'terminalized'::text])) AND (detection_source IS NULL) AND (timeout_seconds IS NULL) AND (observed_last_activity_at IS NULL)))),
    CONSTRAINT attempt_interruption_events_type_check CHECK ((event_type = ANY (ARRAY['detected'::text, 'restored'::text, 'terminalized'::text])))
);


ALTER TABLE public.attempt_interruption_events OWNER TO exam;

--
-- Name: attempt_interruptions; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.attempt_interruptions (
    id uuid NOT NULL,
    organization_id text NOT NULL,
    attempt_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.attempt_interruptions OWNER TO exam;

--
-- Name: attempt_time_adjustments; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.attempt_time_adjustments (
    id text NOT NULL,
    operation_id uuid NOT NULL,
    organization_id text NOT NULL,
    attempt_id text NOT NULL,
    interruption_id uuid,
    incident_id uuid,
    policy text NOT NULL,
    source text NOT NULL,
    before_deadline timestamp with time zone NOT NULL,
    after_deadline timestamp with time zone NOT NULL,
    added_seconds integer NOT NULL,
    eligible_seconds integer,
    reason_code character varying(100) NOT NULL,
    reason_text text,
    actor_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attempt_time_adjustments_added_seconds_check CHECK ((added_seconds > 0)),
    CONSTRAINT attempt_time_adjustments_deadline_delta_check CHECK ((after_deadline = (before_deadline + ((added_seconds)::double precision * '00:00:01'::interval)))),
    CONSTRAINT attempt_time_adjustments_deadline_order_check CHECK ((after_deadline > before_deadline)),
    CONSTRAINT attempt_time_adjustments_eligible_seconds_check CHECK (((eligible_seconds IS NULL) OR (eligible_seconds >= 0))),
    CONSTRAINT attempt_time_adjustments_policy_check CHECK ((policy = ANY (ARRAY['strict'::text, 'bounded_grace'::text, 'operator_incident'::text]))),
    CONSTRAINT attempt_time_adjustments_reason_code_check CHECK ((length(btrim((reason_code)::text)) > 0)),
    CONSTRAINT attempt_time_adjustments_source_check CHECK ((source = ANY (ARRAY['bounded_grace'::text, 'operator'::text, 'system_incident'::text, 'administrative_correction'::text]))),
    CONSTRAINT attempt_time_adjustments_source_shape_check CHECK ((((source = 'bounded_grace'::text) AND (policy = 'bounded_grace'::text) AND (interruption_id IS NOT NULL) AND (eligible_seconds IS NOT NULL) AND (actor_id IS NULL)) OR ((source = ANY (ARRAY['operator'::text, 'administrative_correction'::text])) AND (actor_id IS NOT NULL) AND (reason_text IS NOT NULL) AND (length(btrim(reason_text)) > 0)) OR (source = 'system_incident'::text)))
);


ALTER TABLE public.attempt_time_adjustments OWNER TO exam;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.audit_logs (
    id text NOT NULL,
    organization_id text NOT NULL,
    actor_id text NOT NULL,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    metadata jsonb NOT NULL,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.audit_logs OWNER TO exam;

--
-- Name: candidate_fields; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.candidate_fields (
    id text NOT NULL,
    organization_id text NOT NULL,
    name text NOT NULL,
    label text NOT NULL,
    field_type text NOT NULL,
    required boolean NOT NULL,
    "unique" boolean NOT NULL,
    sort_order integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.candidate_fields OWNER TO exam;

--
-- Name: candidate_profiles; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.candidate_profiles (
    id text NOT NULL,
    organization_id text NOT NULL,
    user_id text NOT NULL,
    fields jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.candidate_profiles OWNER TO exam;

--
-- Name: client_events; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.client_events (
    id text NOT NULL,
    organization_id text NOT NULL,
    user_id text,
    attempt_id text,
    exam_id text,
    question_id text,
    kind text NOT NULL,
    level text NOT NULL,
    name text NOT NULL,
    route text,
    occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    client_session_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_agent text,
    event_id text
);


ALTER TABLE public.client_events OWNER TO exam;

--
-- Name: courses; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.courses (
    id text NOT NULL,
    organization_id text NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.courses OWNER TO exam;

--
-- Name: email_outbox; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.email_outbox (
    id text NOT NULL,
    organization_id text NOT NULL,
    type text NOT NULL,
    recipient_email text NOT NULL,
    subject text NOT NULL,
    body_text text NOT NULL,
    body_html text,
    status text NOT NULL,
    attempt_count integer CONSTRAINT email_outbox_attempts_not_null NOT NULL,
    max_attempts integer NOT NULL,
    last_error text,
    next_attempt_at timestamp with time zone,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    provider_message_id text,
    dedupe_key text,
    notification_id text,
    recipient_user_id text,
    CONSTRAINT email_outbox_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT email_outbox_dead_must_have_error CHECK (((status <> 'dead'::text) OR (last_error IS NOT NULL))),
    CONSTRAINT email_outbox_max_attempts_check CHECK ((max_attempts >= 1)),
    CONSTRAINT email_outbox_non_processing_no_lock CHECK (((status = 'processing'::text) OR ((locked_at IS NULL) AND (locked_by IS NULL)))),
    CONSTRAINT email_outbox_processing_must_have_lock CHECK (((status <> 'processing'::text) OR ((locked_at IS NOT NULL) AND (locked_by IS NOT NULL)))),
    CONSTRAINT email_outbox_retry_wait_must_have_next CHECK (((status <> 'retry_wait'::text) OR (next_attempt_at IS NOT NULL))),
    CONSTRAINT email_outbox_sent_must_have_sent_at CHECK (((status <> 'sent'::text) OR (sent_at IS NOT NULL))),
    CONSTRAINT email_outbox_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'retry_wait'::text, 'sent'::text, 'dead'::text])))
);


ALTER TABLE public.email_outbox OWNER TO exam;

--
-- Name: exam_admissions; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.exam_admissions (
    id text NOT NULL,
    organization_id text NOT NULL,
    exam_id text NOT NULL,
    candidate_id text NOT NULL,
    joined_at timestamp with time zone NOT NULL,
    admitted_at timestamp with time zone,
    consumed_at timestamp with time zone,
    consumed_attempt_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT exam_admissions_admitted_before_consumed_check CHECK (((consumed_at IS NULL) OR (admitted_at IS NOT NULL))),
    CONSTRAINT exam_admissions_consumed_pair_check CHECK ((((consumed_at IS NULL) AND (consumed_attempt_id IS NULL)) OR ((consumed_at IS NOT NULL) AND (consumed_attempt_id IS NOT NULL))))
);


ALTER TABLE public.exam_admissions OWNER TO exam;

--
-- Name: exam_answer_save_receipts; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.exam_answer_save_receipts (
    organization_id text NOT NULL,
    attempt_id text NOT NULL,
    question_id text NOT NULL,
    client_seq integer NOT NULL,
    answer_identity text,
    legacy_answer jsonb,
    accepted_version integer NOT NULL,
    saved_at timestamp with time zone NOT NULL,
    CONSTRAINT exam_answer_save_receipts_client_seq_check CHECK ((client_seq >= 0)),
    CONSTRAINT exam_answer_save_receipts_identity_repr_check CHECK ((((answer_identity IS NOT NULL) AND (legacy_answer IS NULL)) OR ((answer_identity IS NULL) AND (legacy_answer IS NOT NULL))))
);


ALTER TABLE public.exam_answer_save_receipts OWNER TO exam;

--
-- Name: exam_attempts; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.exam_attempts (
    id text NOT NULL,
    organization_id text NOT NULL,
    exam_id text NOT NULL,
    enrollment_id text NOT NULL,
    candidate_id text NOT NULL,
    attempt_no integer NOT NULL,
    status text NOT NULL,
    question_snapshot jsonb NOT NULL,
    answers jsonb NOT NULL,
    grading_result jsonb,
    total_score double precision,
    passed boolean,
    started_at timestamp with time zone,
    deadline_at timestamp with time zone,
    submitted_at timestamp with time zone,
    graded_at timestamp with time zone,
    last_activity_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    misconduct jsonb,
    grading_status text DEFAULT 'auto_graded'::text,
    submitted_answers jsonb,
    submission_reason text,
    interruption_policy_snapshot_version integer DEFAULT 1 NOT NULL,
    interruption_time_policy_snapshot text DEFAULT 'strict'::text NOT NULL,
    interruption_grace_per_incident_seconds_snapshot integer,
    interruption_grace_per_attempt_seconds_snapshot integer,
    current_interruption_id uuid,
    interrupted_at timestamp with time zone,
    CONSTRAINT exam_attempts_current_interruption_pair_check CHECK ((((current_interruption_id IS NULL) AND (interrupted_at IS NULL)) OR ((current_interruption_id IS NOT NULL) AND (interrupted_at IS NOT NULL)))),
    CONSTRAINT exam_attempts_grading_status_check CHECK ((grading_status = ANY (ARRAY['auto_graded'::text, 'pending_manual'::text, 'fully_graded'::text]))),
    CONSTRAINT exam_attempts_interruption_snapshot_caps_check CHECK ((((interruption_time_policy_snapshot = ANY (ARRAY['strict'::text, 'operator_incident'::text])) AND (interruption_grace_per_incident_seconds_snapshot IS NULL) AND (interruption_grace_per_attempt_seconds_snapshot IS NULL)) OR ((interruption_time_policy_snapshot = 'bounded_grace'::text) AND (interruption_grace_per_incident_seconds_snapshot IS NOT NULL) AND (interruption_grace_per_attempt_seconds_snapshot IS NOT NULL) AND (interruption_grace_per_incident_seconds_snapshot > 0) AND (interruption_grace_per_attempt_seconds_snapshot > 0) AND (interruption_grace_per_incident_seconds_snapshot <= interruption_grace_per_attempt_seconds_snapshot)))),
    CONSTRAINT exam_attempts_interruption_snapshot_policy_check CHECK ((interruption_time_policy_snapshot = ANY (ARRAY['strict'::text, 'bounded_grace'::text, 'operator_incident'::text]))),
    CONSTRAINT exam_attempts_interruption_snapshot_version_check CHECK ((interruption_policy_snapshot_version = 1)),
    CONSTRAINT exam_attempts_status_check CHECK ((status = ANY (ARRAY['not_started'::text, 'queued'::text, 'in_progress'::text, 'disrupted'::text, 'submitted'::text, 'graded'::text, 'voided'::text]))),
    CONSTRAINT exam_attempts_status_pointer_check CHECK ((((status = 'disrupted'::text) AND (current_interruption_id IS NOT NULL) AND (interrupted_at IS NOT NULL)) OR ((status <> 'disrupted'::text) AND (current_interruption_id IS NULL) AND (interrupted_at IS NULL))))
);


ALTER TABLE public.exam_attempts OWNER TO exam;

--
-- Name: exam_enrollments; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.exam_enrollments (
    id text NOT NULL,
    organization_id text NOT NULL,
    exam_id text NOT NULL,
    candidate_id text NOT NULL,
    status text NOT NULL,
    attempt_count integer NOT NULL,
    final_score double precision,
    final_passed boolean,
    final_attempt_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT exam_enrollments_status_check CHECK ((status = ANY (ARRAY['assigned'::text, 'started'::text, 'completed'::text, 'blocked'::text])))
);


ALTER TABLE public.exam_enrollments OWNER TO exam;

--
-- Name: exam_incident_actions; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.exam_incident_actions (
    id uuid NOT NULL,
    organization_id text NOT NULL,
    incident_id uuid NOT NULL,
    action_type text NOT NULL,
    action_id text NOT NULL,
    attempt_id text NOT NULL,
    actor_id text,
    linked_at timestamp with time zone DEFAULT now() NOT NULL,
    operation_id uuid NOT NULL,
    CONSTRAINT exam_incident_actions_action_type_check CHECK ((action_type = ANY (ARRAY['time_grant'::text, 'force_submit'::text])))
);


ALTER TABLE public.exam_incident_actions OWNER TO exam;

--
-- Name: exam_incident_attempts; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.exam_incident_attempts (
    id uuid NOT NULL,
    organization_id text NOT NULL,
    incident_id uuid NOT NULL,
    attempt_id text NOT NULL,
    relationship_type text NOT NULL,
    linked_at timestamp with time zone DEFAULT now() NOT NULL,
    linked_by text NOT NULL,
    operation_id uuid NOT NULL,
    CONSTRAINT exam_incident_attempts_relationship_type_check CHECK ((relationship_type = ANY (ARRAY['affected'::text, 'referenced'::text])))
);


ALTER TABLE public.exam_incident_attempts OWNER TO exam;

--
-- Name: exam_incident_events; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.exam_incident_events (
    id uuid NOT NULL,
    organization_id text NOT NULL,
    incident_id uuid NOT NULL,
    event_sequence bigint NOT NULL,
    event_type text NOT NULL,
    command_type text NOT NULL,
    operation_id uuid NOT NULL,
    actor_id text,
    before_version integer NOT NULL,
    after_version integer NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT exam_incident_events_event_type_check CHECK ((event_type = ANY (ARRAY['incident_created'::text, 'investigation_started'::text, 'note_added'::text, 'severity_changed'::text, 'incident_resolved'::text, 'incident_dismissed'::text, 'action_linked'::text, 'attempt_linked'::text, 'interruption_linked'::text]))),
    CONSTRAINT exam_incident_events_version_check CHECK (((before_version >= 0) AND (after_version >= 0)))
);


ALTER TABLE public.exam_incident_events OWNER TO exam;

--
-- Name: exam_incident_events_event_sequence_seq; Type: SEQUENCE; Schema: public; Owner: exam
--

ALTER TABLE public.exam_incident_events ALTER COLUMN event_sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.exam_incident_events_event_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: exam_incident_interruption_links; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.exam_incident_interruption_links (
    id uuid NOT NULL,
    organization_id text NOT NULL,
    incident_id uuid NOT NULL,
    attempt_id text NOT NULL,
    interruption_id uuid NOT NULL,
    linked_at timestamp with time zone DEFAULT now() NOT NULL,
    linked_by text NOT NULL,
    operation_id uuid NOT NULL
);


ALTER TABLE public.exam_incident_interruption_links OWNER TO exam;

--
-- Name: exam_incidents; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.exam_incidents (
    id uuid NOT NULL,
    organization_id text NOT NULL,
    exam_id text NOT NULL,
    attempt_id text,
    candidate_id text,
    type text NOT NULL,
    severity text DEFAULT 'info'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    occurred_at timestamp with time zone,
    description text NOT NULL,
    resolution_summary text,
    resolved_at timestamp with time zone,
    resolved_by text,
    reported_by text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT exam_incidents_description_check CHECK (((length(btrim(description)) >= 1) AND (length(btrim(description)) <= 1000))),
    CONSTRAINT exam_incidents_resolution_summary_check CHECK (((resolution_summary IS NULL) OR ((length(btrim(resolution_summary)) >= 1) AND (length(btrim(resolution_summary)) <= 1000)))),
    CONSTRAINT exam_incidents_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'minor'::text, 'major'::text, 'critical'::text]))),
    CONSTRAINT exam_incidents_status_check CHECK ((status = ANY (ARRAY['open'::text, 'investigating'::text, 'resolved'::text, 'dismissed'::text]))),
    CONSTRAINT exam_incidents_type_check CHECK ((type = ANY (ARRAY['network_interruption'::text, 'device_failure'::text, 'power_failure'::text, 'candidate_unable_to_continue'::text, 'suspected_misconduct'::text, 'operator_error'::text, 'system_outage'::text, 'environmental_disruption'::text, 'other'::text]))),
    CONSTRAINT exam_incidents_version_check CHECK ((version >= 1))
);


ALTER TABLE public.exam_incidents OWNER TO exam;

--
-- Name: exam_policy_profiles; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.exam_policy_profiles (
    id text NOT NULL,
    organization_id text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    duration_minutes integer,
    latest_start_offset_minutes integer,
    min_submit_after_start_minutes integer,
    retake_policy text NOT NULL,
    max_attempts integer NOT NULL,
    score_strategy text NOT NULL,
    result_publication_mode text NOT NULL,
    interruption_time_policy text DEFAULT 'strict'::text NOT NULL,
    interruption_grace_per_incident_seconds integer,
    interruption_grace_per_attempt_seconds integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    timing_mode text DEFAULT 'timed_window'::text NOT NULL,
    CONSTRAINT exam_policy_profiles_duration_minutes_positive_check CHECK ((duration_minutes > 0)),
    CONSTRAINT exam_policy_profiles_interruption_policy_caps_check CHECK ((((interruption_time_policy = ANY (ARRAY['strict'::text, 'operator_incident'::text])) AND (interruption_grace_per_incident_seconds IS NULL) AND (interruption_grace_per_attempt_seconds IS NULL)) OR ((interruption_time_policy = 'bounded_grace'::text) AND (interruption_grace_per_incident_seconds IS NOT NULL) AND (interruption_grace_per_attempt_seconds IS NOT NULL) AND (interruption_grace_per_incident_seconds > 0) AND (interruption_grace_per_attempt_seconds > 0) AND (interruption_grace_per_incident_seconds <= interruption_grace_per_attempt_seconds)))),
    CONSTRAINT exam_policy_profiles_interruption_time_policy_check CHECK ((interruption_time_policy = ANY (ARRAY['strict'::text, 'bounded_grace'::text, 'operator_incident'::text]))),
    CONSTRAINT exam_policy_profiles_latest_start_offset_minutes_check CHECK ((latest_start_offset_minutes >= 0)),
    CONSTRAINT exam_policy_profiles_min_submit_after_start_minutes_check CHECK ((min_submit_after_start_minutes >= 0)),
    CONSTRAINT exam_policy_profiles_retake_policy_check CHECK ((retake_policy = ANY (ARRAY['unlimited'::text, 'max_attempts'::text, 'pass_then_stop'::text]))),
    CONSTRAINT exam_policy_profiles_score_strategy_check CHECK ((score_strategy = ANY (ARRAY['highest'::text, 'latest'::text, 'first'::text]))),
    CONSTRAINT exam_policy_profiles_timing_mode_check CHECK ((timing_mode = ANY (ARRAY['timed_window'::text, 'deadline'::text, 'untimed'::text])))
);


ALTER TABLE public.exam_policy_profiles OWNER TO exam;

--
-- Name: exam_proctor_assignment_events; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.exam_proctor_assignment_events (
    id uuid NOT NULL,
    organization_id text NOT NULL,
    assignment_id text NOT NULL,
    command_type text NOT NULL,
    operation_id uuid NOT NULL,
    canonical_payload jsonb NOT NULL,
    outcome text NOT NULL,
    actor_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT exam_proctor_assignment_events_command_type_check CHECK ((command_type = ANY (ARRAY['assign'::text, 'revoke'::text]))),
    CONSTRAINT exam_proctor_assignment_events_outcome_check CHECK ((outcome = ANY (ARRAY['applied'::text, 'no_change'::text])))
);


ALTER TABLE public.exam_proctor_assignment_events OWNER TO exam;

--
-- Name: exam_proctor_assignments; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.exam_proctor_assignments (
    id text NOT NULL,
    organization_id text NOT NULL,
    exam_id text NOT NULL,
    proctor_user_id text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    assigned_by text NOT NULL,
    assigned_at timestamp with time zone NOT NULL,
    revoked_by text,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT exam_proctor_assignments_revocation_shape_check CHECK ((((status = 'active'::text) AND (revoked_at IS NULL) AND (revoked_by IS NULL)) OR ((status = 'revoked'::text) AND (revoked_at IS NOT NULL) AND (revoked_by IS NOT NULL)))),
    CONSTRAINT exam_proctor_assignments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text])))
);


ALTER TABLE public.exam_proctor_assignments OWNER TO exam;

--
-- Name: exams; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.exams (
    id text NOT NULL,
    organization_id text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    course_id text NOT NULL,
    status text NOT NULL,
    timing_mode text NOT NULL,
    duration_minutes integer,
    open_at timestamp with time zone NOT NULL,
    close_at timestamp with time zone,
    passing_score double precision NOT NULL,
    total_score double precision NOT NULL,
    question_selection_mode text NOT NULL,
    question_ids jsonb NOT NULL,
    question_snapshot jsonb NOT NULL,
    control_flags jsonb NOT NULL,
    retake_policy text NOT NULL,
    score_strategy text NOT NULL,
    max_attempts integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    latest_start_offset_minutes integer,
    min_submit_after_start_minutes integer,
    result_publication_mode text DEFAULT 'immediate'::text NOT NULL,
    results_published_at timestamp with time zone,
    interruption_time_policy text DEFAULT 'strict'::text NOT NULL,
    interruption_grace_per_incident_seconds integer,
    interruption_grace_per_attempt_seconds integer,
    sync_started_at timestamp with time zone,
    CONSTRAINT exams_interruption_policy_caps_check CHECK ((((interruption_time_policy = ANY (ARRAY['strict'::text, 'operator_incident'::text])) AND (interruption_grace_per_incident_seconds IS NULL) AND (interruption_grace_per_attempt_seconds IS NULL)) OR ((interruption_time_policy = 'bounded_grace'::text) AND (interruption_grace_per_incident_seconds IS NOT NULL) AND (interruption_grace_per_attempt_seconds IS NOT NULL) AND (interruption_grace_per_incident_seconds > 0) AND (interruption_grace_per_attempt_seconds > 0) AND (interruption_grace_per_incident_seconds <= interruption_grace_per_attempt_seconds)))),
    CONSTRAINT exams_interruption_time_policy_check CHECK ((interruption_time_policy = ANY (ARRAY['strict'::text, 'bounded_grace'::text, 'operator_incident'::text]))),
    CONSTRAINT exams_latest_start_offset_minutes_check CHECK ((latest_start_offset_minutes >= 0)),
    CONSTRAINT exams_min_submit_after_start_minutes_check CHECK ((min_submit_after_start_minutes >= 0)),
    CONSTRAINT exams_passing_score_max_check CHECK ((passing_score <= total_score)),
    CONSTRAINT exams_passing_score_min_check CHECK ((passing_score >= (0)::double precision)),
    CONSTRAINT exams_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'open'::text, 'closed'::text, 'canceled'::text, 'archived'::text]))),
    CONSTRAINT exams_total_score_positive_check CHECK ((total_score > (0)::double precision))
);


ALTER TABLE public.exams OWNER TO exam;

--
-- Name: grader_exam_assignments; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.grader_exam_assignments (
    id text NOT NULL,
    organization_id text NOT NULL,
    grader_user_id text NOT NULL,
    exam_id text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    assigned_by text NOT NULL,
    assigned_at timestamp with time zone NOT NULL,
    revoked_by text,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grader_exam_assignments_revocation_shape_check CHECK ((((status = 'active'::text) AND (revoked_at IS NULL) AND (revoked_by IS NULL)) OR ((status = 'revoked'::text) AND (revoked_at IS NOT NULL) AND (revoked_by IS NOT NULL)))),
    CONSTRAINT grader_exam_assignments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text])))
);


ALTER TABLE public.grader_exam_assignments OWNER TO exam;

--
-- Name: import_job_logs; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.import_job_logs (
    id text NOT NULL,
    organization_id text NOT NULL,
    type text NOT NULL,
    status text NOT NULL,
    total integer NOT NULL,
    created_count integer NOT NULL,
    updated_count integer NOT NULL,
    errors integer NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    errors_detail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.import_job_logs OWNER TO exam;

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.notifications (
    id text NOT NULL,
    organization_id text NOT NULL,
    recipient_user_id text NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    action_path text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    dedupe_key text
);


ALTER TABLE public.notifications OWNER TO exam;

--
-- Name: organization_settings; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.organization_settings (
    id text NOT NULL,
    organization_id text NOT NULL,
    product_name text,
    product_subtitle text,
    footer_text text,
    organization_display_name text,
    timezone text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.organization_settings OWNER TO exam;

--
-- Name: organizations; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.organizations (
    id text NOT NULL,
    name text NOT NULL,
    display_name text NOT NULL,
    slug text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.organizations OWNER TO exam;

--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.password_reset_tokens (
    id text NOT NULL,
    organization_id text NOT NULL,
    user_id text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT password_reset_tokens_token_hash_shape_check CHECK ((char_length(token_hash) = 64))
);


ALTER TABLE public.password_reset_tokens OWNER TO exam;

--
-- Name: questions; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.questions (
    id text NOT NULL,
    organization_id text NOT NULL,
    course_id text NOT NULL,
    type text NOT NULL,
    content text NOT NULL,
    options jsonb NOT NULL,
    standard_answer jsonb,
    attachments jsonb NOT NULL,
    score double precision NOT NULL,
    difficulty integer NOT NULL,
    tags jsonb NOT NULL,
    grading_rule jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    rubric text,
    content_document jsonb,
    answer_mode text,
    CONSTRAINT questions_answer_mode_check CHECK ((answer_mode = ANY (ARRAY['plain'::text, 'rich'::text])))
);


ALTER TABLE public.questions OWNER TO exam;

--
-- Name: staff_invitations; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.staff_invitations (
    id text NOT NULL,
    organization_id text NOT NULL,
    email text NOT NULL,
    role text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_invitations_consumed_not_revoked_check CHECK ((NOT ((consumed_at IS NOT NULL) AND (revoked_at IS NOT NULL)))),
    CONSTRAINT staff_invitations_email_normalized_check CHECK ((email = lower(email))),
    CONSTRAINT staff_invitations_role_check CHECK ((role = ANY (ARRAY['Admin'::text, 'Teacher'::text, 'Proctor'::text, 'Grader'::text, 'Maintainer'::text]))),
    CONSTRAINT staff_invitations_token_hash_shape_check CHECK ((char_length(token_hash) = 64))
);


ALTER TABLE public.staff_invitations OWNER TO exam;

--
-- Name: teacher_course_assignments; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.teacher_course_assignments (
    id text NOT NULL,
    organization_id text NOT NULL,
    teacher_user_id text NOT NULL,
    course_id text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    assigned_by text NOT NULL,
    assigned_at timestamp with time zone NOT NULL,
    revoked_by text,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teacher_course_assignments_revocation_shape_check CHECK ((((status = 'active'::text) AND (revoked_at IS NULL) AND (revoked_by IS NULL)) OR ((status = 'revoked'::text) AND (revoked_at IS NOT NULL) AND (revoked_by IS NOT NULL)))),
    CONSTRAINT teacher_course_assignments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text])))
);


ALTER TABLE public.teacher_course_assignments OWNER TO exam;

--
-- Name: user_role_assignments; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.user_role_assignments (
    id text NOT NULL,
    organization_id text NOT NULL,
    user_id text NOT NULL,
    role text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_role_assignments_role_check CHECK ((role = ANY (ARRAY['Admin'::text, 'Teacher'::text, 'Proctor'::text, 'Grader'::text, 'Candidate'::text, 'Maintainer'::text])))
);


ALTER TABLE public.user_role_assignments OWNER TO exam;

--
-- Name: users; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.users (
    id text NOT NULL,
    organization_id text NOT NULL,
    username text NOT NULL,
    password_hash text NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    is_active boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    email text,
    auth_epoch integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.users OWNER TO exam;

--
-- Name: worker_heartbeats; Type: TABLE; Schema: public; Owner: exam
--

CREATE TABLE public.worker_heartbeats (
    id text NOT NULL,
    worker_name text NOT NULL,
    worker_instance_id text NOT NULL,
    last_poll_at timestamp with time zone NOT NULL,
    last_success_at timestamp with time zone,
    last_error_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.worker_heartbeats OWNER TO exam;

--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: exam
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: exam
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: attempt_command_receipts attempt_command_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_command_receipts
    ADD CONSTRAINT attempt_command_receipts_pkey PRIMARY KEY (id);


--
-- Name: attempt_grading_entries attempt_grading_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_grading_entries
    ADD CONSTRAINT attempt_grading_entries_pkey PRIMARY KEY (id);


--
-- Name: attempt_interruption_events attempt_interruption_events_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_interruption_events
    ADD CONSTRAINT attempt_interruption_events_pkey PRIMARY KEY (id);


--
-- Name: attempt_interruptions attempt_interruptions_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_interruptions
    ADD CONSTRAINT attempt_interruptions_pkey PRIMARY KEY (id);


--
-- Name: attempt_time_adjustments attempt_time_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_time_adjustments
    ADD CONSTRAINT attempt_time_adjustments_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: candidate_fields candidate_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.candidate_fields
    ADD CONSTRAINT candidate_fields_pkey PRIMARY KEY (id);


--
-- Name: candidate_profiles candidate_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.candidate_profiles
    ADD CONSTRAINT candidate_profiles_pkey PRIMARY KEY (id);


--
-- Name: client_events client_events_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.client_events
    ADD CONSTRAINT client_events_pkey PRIMARY KEY (id);


--
-- Name: courses courses_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (id);


--
-- Name: email_outbox email_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.email_outbox
    ADD CONSTRAINT email_outbox_pkey PRIMARY KEY (id);


--
-- Name: exam_admissions exam_admissions_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_admissions
    ADD CONSTRAINT exam_admissions_pkey PRIMARY KEY (id);


--
-- Name: exam_answer_save_receipts exam_answer_save_receipts_pk; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_answer_save_receipts
    ADD CONSTRAINT exam_answer_save_receipts_pk PRIMARY KEY (organization_id, attempt_id, question_id, client_seq);


--
-- Name: exam_attempts exam_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_attempts
    ADD CONSTRAINT exam_attempts_pkey PRIMARY KEY (id);


--
-- Name: exam_enrollments exam_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_enrollments
    ADD CONSTRAINT exam_enrollments_pkey PRIMARY KEY (id);


--
-- Name: exam_incident_actions exam_incident_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incident_actions
    ADD CONSTRAINT exam_incident_actions_pkey PRIMARY KEY (id);


--
-- Name: exam_incident_attempts exam_incident_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incident_attempts
    ADD CONSTRAINT exam_incident_attempts_pkey PRIMARY KEY (id);


--
-- Name: exam_incident_events exam_incident_events_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incident_events
    ADD CONSTRAINT exam_incident_events_pkey PRIMARY KEY (id);


--
-- Name: exam_incident_interruption_links exam_incident_interruption_links_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incident_interruption_links
    ADD CONSTRAINT exam_incident_interruption_links_pkey PRIMARY KEY (id);


--
-- Name: exam_incidents exam_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incidents
    ADD CONSTRAINT exam_incidents_pkey PRIMARY KEY (id);


--
-- Name: exam_policy_profiles exam_policy_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_policy_profiles
    ADD CONSTRAINT exam_policy_profiles_pkey PRIMARY KEY (id);


--
-- Name: exam_proctor_assignment_events exam_proctor_assignment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_proctor_assignment_events
    ADD CONSTRAINT exam_proctor_assignment_events_pkey PRIMARY KEY (id);


--
-- Name: exam_proctor_assignments exam_proctor_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_proctor_assignments
    ADD CONSTRAINT exam_proctor_assignments_pkey PRIMARY KEY (id);


--
-- Name: exams exams_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_pkey PRIMARY KEY (id);


--
-- Name: grader_exam_assignments grader_exam_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.grader_exam_assignments
    ADD CONSTRAINT grader_exam_assignments_pkey PRIMARY KEY (id);


--
-- Name: import_job_logs import_job_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.import_job_logs
    ADD CONSTRAINT import_job_logs_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: organization_settings organization_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.organization_settings
    ADD CONSTRAINT organization_settings_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: questions questions_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_pkey PRIMARY KEY (id);


--
-- Name: staff_invitations staff_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.staff_invitations
    ADD CONSTRAINT staff_invitations_pkey PRIMARY KEY (id);


--
-- Name: teacher_course_assignments teacher_course_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.teacher_course_assignments
    ADD CONSTRAINT teacher_course_assignments_pkey PRIMARY KEY (id);


--
-- Name: user_role_assignments user_role_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.user_role_assignments
    ADD CONSTRAINT user_role_assignments_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: worker_heartbeats worker_heartbeats_instance_uk; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.worker_heartbeats
    ADD CONSTRAINT worker_heartbeats_instance_uk UNIQUE (worker_instance_id);


--
-- Name: worker_heartbeats worker_heartbeats_pkey; Type: CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.worker_heartbeats
    ADD CONSTRAINT worker_heartbeats_pkey PRIMARY KEY (id);


--
-- Name: attempt_command_receipts_org_attempt_command_created_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX attempt_command_receipts_org_attempt_command_created_idx ON public.attempt_command_receipts USING btree (organization_id, attempt_id, command_type, created_at, id);


--
-- Name: attempt_command_receipts_org_attempt_created_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX attempt_command_receipts_org_attempt_created_idx ON public.attempt_command_receipts USING btree (organization_id, attempt_id, created_at, id);


--
-- Name: attempt_command_receipts_org_operation_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX attempt_command_receipts_org_operation_unique ON public.attempt_command_receipts USING btree (organization_id, operation_id);


--
-- Name: attempt_grading_entries_attempt_question_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX attempt_grading_entries_attempt_question_unique ON public.attempt_grading_entries USING btree (attempt_id, question_id);


--
-- Name: attempt_grading_entries_queue_index; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX attempt_grading_entries_queue_index ON public.attempt_grading_entries USING btree (organization_id, status);


--
-- Name: attempt_interruption_events_detected_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX attempt_interruption_events_detected_unique ON public.attempt_interruption_events USING btree (interruption_id) WHERE (event_type = 'detected'::text);


--
-- Name: attempt_interruption_events_org_attempt_created_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX attempt_interruption_events_org_attempt_created_idx ON public.attempt_interruption_events USING btree (organization_id, attempt_id, created_at);


--
-- Name: attempt_interruption_events_outcome_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX attempt_interruption_events_outcome_unique ON public.attempt_interruption_events USING btree (interruption_id) WHERE (event_type = ANY (ARRAY['restored'::text, 'terminalized'::text]));


--
-- Name: attempt_interruptions_org_attempt_id_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX attempt_interruptions_org_attempt_id_unique ON public.attempt_interruptions USING btree (organization_id, attempt_id, id);


--
-- Name: attempt_time_adjustments_bounded_interruption_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX attempt_time_adjustments_bounded_interruption_unique ON public.attempt_time_adjustments USING btree (interruption_id) WHERE (source = 'bounded_grace'::text);


--
-- Name: attempt_time_adjustments_org_attempt_created_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX attempt_time_adjustments_org_attempt_created_idx ON public.attempt_time_adjustments USING btree (organization_id, attempt_id, created_at);


--
-- Name: attempt_time_adjustments_org_operation_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX attempt_time_adjustments_org_operation_unique ON public.attempt_time_adjustments USING btree (organization_id, operation_id);


--
-- Name: audit_logs_org_created_at_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX audit_logs_org_created_at_idx ON public.audit_logs USING btree (organization_id, created_at);


--
-- Name: candidate_fields_org_name_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX candidate_fields_org_name_unique ON public.candidate_fields USING btree (organization_id, name);


--
-- Name: candidate_profiles_org_user_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX candidate_profiles_org_user_unique ON public.candidate_profiles USING btree (organization_id, user_id);


--
-- Name: client_events_org_attempt_received_at_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX client_events_org_attempt_received_at_idx ON public.client_events USING btree (organization_id, attempt_id, received_at);


--
-- Name: client_events_org_exam_received_at_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX client_events_org_exam_received_at_idx ON public.client_events USING btree (organization_id, exam_id, received_at);


--
-- Name: client_events_org_kind_received_at_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX client_events_org_kind_received_at_idx ON public.client_events USING btree (organization_id, kind, received_at);


--
-- Name: client_events_org_name_received_at_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX client_events_org_name_received_at_idx ON public.client_events USING btree (organization_id, name, received_at);


--
-- Name: client_events_org_received_at_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX client_events_org_received_at_idx ON public.client_events USING btree (organization_id, received_at);


--
-- Name: client_events_org_user_event_id_uidx; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX client_events_org_user_event_id_uidx ON public.client_events USING btree (organization_id, user_id, event_id);


--
-- Name: courses_org_code_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX courses_org_code_unique ON public.courses USING btree (organization_id, code);


--
-- Name: courses_org_id_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX courses_org_id_unique ON public.courses USING btree (organization_id, id);


--
-- Name: email_outbox_org_created_at_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX email_outbox_org_created_at_idx ON public.email_outbox USING btree (organization_id, created_at);


--
-- Name: email_outbox_org_dedupe_key_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX email_outbox_org_dedupe_key_unique ON public.email_outbox USING btree (organization_id, dedupe_key) WHERE (dedupe_key IS NOT NULL);


--
-- Name: email_outbox_org_status_locked_at_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX email_outbox_org_status_locked_at_idx ON public.email_outbox USING btree (organization_id, status, locked_at);


--
-- Name: email_outbox_org_status_retry_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX email_outbox_org_status_retry_idx ON public.email_outbox USING btree (organization_id, status, next_attempt_at);


--
-- Name: exam_admissions_org_exam_candidate_active_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX exam_admissions_org_exam_candidate_active_unique ON public.exam_admissions USING btree (organization_id, exam_id, candidate_id) WHERE (consumed_at IS NULL);


--
-- Name: exam_admissions_org_exam_created_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX exam_admissions_org_exam_created_idx ON public.exam_admissions USING btree (organization_id, exam_id, joined_at, id);


--
-- Name: exam_admissions_org_exam_joined_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX exam_admissions_org_exam_joined_idx ON public.exam_admissions USING btree (organization_id, exam_id, joined_at, id) WHERE (consumed_at IS NULL);


--
-- Name: exam_attempts_org_enrollment_attempt_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX exam_attempts_org_enrollment_attempt_unique ON public.exam_attempts USING btree (organization_id, enrollment_id, attempt_no);


--
-- Name: exam_attempts_org_exam_status_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX exam_attempts_org_exam_status_idx ON public.exam_attempts USING btree (organization_id, exam_id, status);


--
-- Name: exam_attempts_org_id_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX exam_attempts_org_id_unique ON public.exam_attempts USING btree (organization_id, id);


--
-- Name: exam_enrollments_org_exam_candidate_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX exam_enrollments_org_exam_candidate_unique ON public.exam_enrollments USING btree (organization_id, exam_id, candidate_id);


--
-- Name: exam_incident_actions_incident_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX exam_incident_actions_incident_idx ON public.exam_incident_actions USING btree (incident_id);


--
-- Name: exam_incident_actions_org_action_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX exam_incident_actions_org_action_unique ON public.exam_incident_actions USING btree (organization_id, action_type, action_id);


--
-- Name: exam_incident_actions_org_operation_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX exam_incident_actions_org_operation_idx ON public.exam_incident_actions USING btree (organization_id, operation_id);


--
-- Name: exam_incident_attempts_incident_attempt_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX exam_incident_attempts_incident_attempt_unique ON public.exam_incident_attempts USING btree (incident_id, attempt_id);


--
-- Name: exam_incident_attempts_org_operation_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX exam_incident_attempts_org_operation_idx ON public.exam_incident_attempts USING btree (organization_id, operation_id);


--
-- Name: exam_incident_events_incident_sequence_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX exam_incident_events_incident_sequence_idx ON public.exam_incident_events USING btree (incident_id, event_sequence);


--
-- Name: exam_incident_events_org_operation_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX exam_incident_events_org_operation_unique ON public.exam_incident_events USING btree (organization_id, operation_id);


--
-- Name: exam_incident_interruption_links_incident_interruption_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX exam_incident_interruption_links_incident_interruption_unique ON public.exam_incident_interruption_links USING btree (incident_id, interruption_id);


--
-- Name: exam_incident_interruption_links_org_operation_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX exam_incident_interruption_links_org_operation_idx ON public.exam_incident_interruption_links USING btree (organization_id, operation_id);


--
-- Name: exam_incidents_active_status_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX exam_incidents_active_status_idx ON public.exam_incidents USING btree (organization_id, status) WHERE (status = ANY (ARRAY['open'::text, 'investigating'::text]));


--
-- Name: exam_incidents_org_attempt_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX exam_incidents_org_attempt_idx ON public.exam_incidents USING btree (organization_id, attempt_id);


--
-- Name: exam_incidents_org_created_at_id_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX exam_incidents_org_created_at_id_idx ON public.exam_incidents USING btree (organization_id, created_at, id);


--
-- Name: exam_incidents_org_exam_status_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX exam_incidents_org_exam_status_idx ON public.exam_incidents USING btree (organization_id, exam_id, status);


--
-- Name: exam_incidents_org_id_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX exam_incidents_org_id_unique ON public.exam_incidents USING btree (organization_id, id);


--
-- Name: exam_policy_profiles_org_name_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX exam_policy_profiles_org_name_unique ON public.exam_policy_profiles USING btree (organization_id, name);


--
-- Name: exam_proctor_assignment_events_assignment_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX exam_proctor_assignment_events_assignment_idx ON public.exam_proctor_assignment_events USING btree (organization_id, assignment_id, created_at);


--
-- Name: exam_proctor_assignment_events_org_operation_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX exam_proctor_assignment_events_org_operation_unique ON public.exam_proctor_assignment_events USING btree (organization_id, operation_id);


--
-- Name: exam_proctor_assignments_active_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX exam_proctor_assignments_active_unique ON public.exam_proctor_assignments USING btree (organization_id, exam_id, proctor_user_id) WHERE (status = 'active'::text);


--
-- Name: exam_proctor_assignments_org_exam_status_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX exam_proctor_assignments_org_exam_status_idx ON public.exam_proctor_assignments USING btree (organization_id, exam_id, status);


--
-- Name: exam_proctor_assignments_org_id_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX exam_proctor_assignments_org_id_unique ON public.exam_proctor_assignments USING btree (organization_id, id);


--
-- Name: exam_proctor_assignments_org_proctor_status_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX exam_proctor_assignments_org_proctor_status_idx ON public.exam_proctor_assignments USING btree (organization_id, proctor_user_id, status);


--
-- Name: exam_proctor_assignments_revoke_target_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX exam_proctor_assignments_revoke_target_idx ON public.exam_proctor_assignments USING btree (organization_id, exam_id, proctor_user_id, status, revoked_at DESC, id DESC);


--
-- Name: exams_org_id_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX exams_org_id_unique ON public.exams USING btree (organization_id, id);


--
-- Name: grader_exam_assignments_active_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX grader_exam_assignments_active_unique ON public.grader_exam_assignments USING btree (organization_id, grader_user_id, exam_id) WHERE (status = 'active'::text);


--
-- Name: grader_exam_assignments_org_exam_status_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX grader_exam_assignments_org_exam_status_idx ON public.grader_exam_assignments USING btree (organization_id, exam_id, status);


--
-- Name: grader_exam_assignments_org_grader_status_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX grader_exam_assignments_org_grader_status_idx ON public.grader_exam_assignments USING btree (organization_id, grader_user_id, status);


--
-- Name: grader_exam_assignments_org_id_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX grader_exam_assignments_org_id_unique ON public.grader_exam_assignments USING btree (organization_id, id);


--
-- Name: import_job_logs_org_created_at_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX import_job_logs_org_created_at_idx ON public.import_job_logs USING btree (organization_id, created_at);


--
-- Name: notifications_org_recipient_created_at_id_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX notifications_org_recipient_created_at_id_idx ON public.notifications USING btree (organization_id, recipient_user_id, created_at, id);


--
-- Name: notifications_org_recipient_dedupe_key_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX notifications_org_recipient_dedupe_key_unique ON public.notifications USING btree (organization_id, recipient_user_id, dedupe_key) WHERE (dedupe_key IS NOT NULL);


--
-- Name: notifications_org_recipient_read_at_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX notifications_org_recipient_read_at_idx ON public.notifications USING btree (organization_id, recipient_user_id, read_at);


--
-- Name: organization_settings_org_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX organization_settings_org_unique ON public.organization_settings USING btree (organization_id);


--
-- Name: organizations_slug_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX organizations_slug_unique ON public.organizations USING btree (slug);


--
-- Name: password_reset_tokens_token_hash_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX password_reset_tokens_token_hash_unique ON public.password_reset_tokens USING btree (token_hash);


--
-- Name: password_reset_tokens_user_created_at_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX password_reset_tokens_user_created_at_idx ON public.password_reset_tokens USING btree (user_id, created_at);


--
-- Name: password_reset_tokens_user_open_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX password_reset_tokens_user_open_unique ON public.password_reset_tokens USING btree (user_id) WHERE (consumed_at IS NULL);


--
-- Name: questions_org_course_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX questions_org_course_idx ON public.questions USING btree (organization_id, course_id);


--
-- Name: staff_invitations_org_created_at_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX staff_invitations_org_created_at_idx ON public.staff_invitations USING btree (organization_id, created_at, id);


--
-- Name: staff_invitations_org_email_open_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX staff_invitations_org_email_open_unique ON public.staff_invitations USING btree (organization_id, email) WHERE ((consumed_at IS NULL) AND (revoked_at IS NULL));


--
-- Name: staff_invitations_token_hash_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX staff_invitations_token_hash_unique ON public.staff_invitations USING btree (token_hash);


--
-- Name: teacher_course_assignments_active_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX teacher_course_assignments_active_unique ON public.teacher_course_assignments USING btree (organization_id, teacher_user_id, course_id) WHERE (status = 'active'::text);


--
-- Name: teacher_course_assignments_org_course_status_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX teacher_course_assignments_org_course_status_idx ON public.teacher_course_assignments USING btree (organization_id, course_id, status);


--
-- Name: teacher_course_assignments_org_id_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX teacher_course_assignments_org_id_unique ON public.teacher_course_assignments USING btree (organization_id, id);


--
-- Name: teacher_course_assignments_org_teacher_status_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX teacher_course_assignments_org_teacher_status_idx ON public.teacher_course_assignments USING btree (organization_id, teacher_user_id, status);


--
-- Name: user_role_assignments_active_primary_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX user_role_assignments_active_primary_unique ON public.user_role_assignments USING btree (organization_id, user_id) WHERE ((is_primary = true) AND (is_active = true));


--
-- Name: user_role_assignments_org_user_role_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX user_role_assignments_org_user_role_unique ON public.user_role_assignments USING btree (organization_id, user_id, role);


--
-- Name: users_org_id_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX users_org_id_unique ON public.users USING btree (organization_id, id);


--
-- Name: users_org_username_unique; Type: INDEX; Schema: public; Owner: exam
--

CREATE UNIQUE INDEX users_org_username_unique ON public.users USING btree (organization_id, username);


--
-- Name: worker_heartbeats_last_poll_at_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX worker_heartbeats_last_poll_at_idx ON public.worker_heartbeats USING btree (worker_name, last_poll_at);


--
-- Name: worker_heartbeats_name_instance_idx; Type: INDEX; Schema: public; Owner: exam
--

CREATE INDEX worker_heartbeats_name_instance_idx ON public.worker_heartbeats USING btree (worker_name, worker_instance_id);


--
-- Name: attempt_command_receipts attempt_command_receipts_actor_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_command_receipts
    ADD CONSTRAINT attempt_command_receipts_actor_fk FOREIGN KEY (organization_id, actor_id) REFERENCES public.users(organization_id, id);


--
-- Name: attempt_command_receipts attempt_command_receipts_org_attempt_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_command_receipts
    ADD CONSTRAINT attempt_command_receipts_org_attempt_fk FOREIGN KEY (organization_id, attempt_id) REFERENCES public.exam_attempts(organization_id, id);


--
-- Name: attempt_command_receipts attempt_command_receipts_org_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_command_receipts
    ADD CONSTRAINT attempt_command_receipts_org_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: attempt_grading_entries attempt_grading_entries_attempt_id_exam_attempts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_grading_entries
    ADD CONSTRAINT attempt_grading_entries_attempt_id_exam_attempts_id_fk FOREIGN KEY (attempt_id) REFERENCES public.exam_attempts(id);


--
-- Name: attempt_grading_entries attempt_grading_entries_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_grading_entries
    ADD CONSTRAINT attempt_grading_entries_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: attempt_interruption_events attempt_interruption_events_actor_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_interruption_events
    ADD CONSTRAINT attempt_interruption_events_actor_id_users_id_fk FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: attempt_interruption_events attempt_interruption_events_adjustment_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_interruption_events
    ADD CONSTRAINT attempt_interruption_events_adjustment_fk FOREIGN KEY (time_adjustment_id) REFERENCES public.attempt_time_adjustments(id);


--
-- Name: attempt_interruption_events attempt_interruption_events_attempt_id_exam_attempts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_interruption_events
    ADD CONSTRAINT attempt_interruption_events_attempt_id_exam_attempts_id_fk FOREIGN KEY (attempt_id) REFERENCES public.exam_attempts(id);


--
-- Name: attempt_interruption_events attempt_interruption_events_org_interruption_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_interruption_events
    ADD CONSTRAINT attempt_interruption_events_org_interruption_fk FOREIGN KEY (organization_id, attempt_id, interruption_id) REFERENCES public.attempt_interruptions(organization_id, attempt_id, id);


--
-- Name: attempt_interruption_events attempt_interruption_events_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_interruption_events
    ADD CONSTRAINT attempt_interruption_events_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: attempt_interruptions attempt_interruptions_attempt_id_exam_attempts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_interruptions
    ADD CONSTRAINT attempt_interruptions_attempt_id_exam_attempts_id_fk FOREIGN KEY (attempt_id) REFERENCES public.exam_attempts(id);


--
-- Name: attempt_interruptions attempt_interruptions_org_attempt_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_interruptions
    ADD CONSTRAINT attempt_interruptions_org_attempt_fk FOREIGN KEY (organization_id, attempt_id) REFERENCES public.exam_attempts(organization_id, id);


--
-- Name: attempt_interruptions attempt_interruptions_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_interruptions
    ADD CONSTRAINT attempt_interruptions_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: attempt_time_adjustments attempt_time_adjustments_actor_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_time_adjustments
    ADD CONSTRAINT attempt_time_adjustments_actor_id_users_id_fk FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: attempt_time_adjustments attempt_time_adjustments_attempt_id_exam_attempts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_time_adjustments
    ADD CONSTRAINT attempt_time_adjustments_attempt_id_exam_attempts_id_fk FOREIGN KEY (attempt_id) REFERENCES public.exam_attempts(id);


--
-- Name: attempt_time_adjustments attempt_time_adjustments_org_attempt_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_time_adjustments
    ADD CONSTRAINT attempt_time_adjustments_org_attempt_fk FOREIGN KEY (organization_id, attempt_id) REFERENCES public.exam_attempts(organization_id, id);


--
-- Name: attempt_time_adjustments attempt_time_adjustments_org_interruption_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_time_adjustments
    ADD CONSTRAINT attempt_time_adjustments_org_interruption_fk FOREIGN KEY (organization_id, attempt_id, interruption_id) REFERENCES public.attempt_interruptions(organization_id, attempt_id, id);


--
-- Name: attempt_time_adjustments attempt_time_adjustments_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.attempt_time_adjustments
    ADD CONSTRAINT attempt_time_adjustments_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: audit_logs audit_logs_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: candidate_fields candidate_fields_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.candidate_fields
    ADD CONSTRAINT candidate_fields_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: candidate_profiles candidate_profiles_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.candidate_profiles
    ADD CONSTRAINT candidate_profiles_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: candidate_profiles candidate_profiles_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.candidate_profiles
    ADD CONSTRAINT candidate_profiles_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: client_events client_events_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.client_events
    ADD CONSTRAINT client_events_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: courses courses_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: email_outbox email_outbox_notification_id_notifications_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.email_outbox
    ADD CONSTRAINT email_outbox_notification_id_notifications_id_fk FOREIGN KEY (notification_id) REFERENCES public.notifications(id);


--
-- Name: email_outbox email_outbox_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.email_outbox
    ADD CONSTRAINT email_outbox_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: email_outbox email_outbox_recipient_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.email_outbox
    ADD CONSTRAINT email_outbox_recipient_user_id_users_id_fk FOREIGN KEY (recipient_user_id) REFERENCES public.users(id);


--
-- Name: exam_admissions exam_admissions_candidate_id_candidate_profiles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_admissions
    ADD CONSTRAINT exam_admissions_candidate_id_candidate_profiles_id_fk FOREIGN KEY (candidate_id) REFERENCES public.candidate_profiles(id);


--
-- Name: exam_admissions exam_admissions_exam_id_exams_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_admissions
    ADD CONSTRAINT exam_admissions_exam_id_exams_id_fk FOREIGN KEY (exam_id) REFERENCES public.exams(id);


--
-- Name: exam_admissions exam_admissions_org_attempt_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_admissions
    ADD CONSTRAINT exam_admissions_org_attempt_fk FOREIGN KEY (organization_id, consumed_attempt_id) REFERENCES public.exam_attempts(organization_id, id);


--
-- Name: exam_admissions exam_admissions_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_admissions
    ADD CONSTRAINT exam_admissions_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: exam_answer_save_receipts exam_answer_save_receipts_org_attempt_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_answer_save_receipts
    ADD CONSTRAINT exam_answer_save_receipts_org_attempt_fk FOREIGN KEY (organization_id, attempt_id) REFERENCES public.exam_attempts(organization_id, id) ON DELETE CASCADE;


--
-- Name: exam_attempts exam_attempts_candidate_id_candidate_profiles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_attempts
    ADD CONSTRAINT exam_attempts_candidate_id_candidate_profiles_id_fk FOREIGN KEY (candidate_id) REFERENCES public.candidate_profiles(id);


--
-- Name: exam_attempts exam_attempts_current_interruption_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_attempts
    ADD CONSTRAINT exam_attempts_current_interruption_fk FOREIGN KEY (organization_id, id, current_interruption_id) REFERENCES public.attempt_interruptions(organization_id, attempt_id, id);


--
-- Name: exam_attempts exam_attempts_enrollment_id_exam_enrollments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_attempts
    ADD CONSTRAINT exam_attempts_enrollment_id_exam_enrollments_id_fk FOREIGN KEY (enrollment_id) REFERENCES public.exam_enrollments(id);


--
-- Name: exam_attempts exam_attempts_exam_id_exams_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_attempts
    ADD CONSTRAINT exam_attempts_exam_id_exams_id_fk FOREIGN KEY (exam_id) REFERENCES public.exams(id);


--
-- Name: exam_attempts exam_attempts_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_attempts
    ADD CONSTRAINT exam_attempts_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: exam_enrollments exam_enrollments_candidate_id_candidate_profiles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_enrollments
    ADD CONSTRAINT exam_enrollments_candidate_id_candidate_profiles_id_fk FOREIGN KEY (candidate_id) REFERENCES public.candidate_profiles(id);


--
-- Name: exam_enrollments exam_enrollments_exam_id_exams_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_enrollments
    ADD CONSTRAINT exam_enrollments_exam_id_exams_id_fk FOREIGN KEY (exam_id) REFERENCES public.exams(id);


--
-- Name: exam_enrollments exam_enrollments_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_enrollments
    ADD CONSTRAINT exam_enrollments_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: exam_incident_actions exam_incident_actions_attempt_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incident_actions
    ADD CONSTRAINT exam_incident_actions_attempt_fk FOREIGN KEY (organization_id, attempt_id) REFERENCES public.exam_attempts(organization_id, id);


--
-- Name: exam_incident_actions exam_incident_actions_incident_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incident_actions
    ADD CONSTRAINT exam_incident_actions_incident_fk FOREIGN KEY (organization_id, incident_id) REFERENCES public.exam_incidents(organization_id, id);


--
-- Name: exam_incident_actions exam_incident_actions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incident_actions
    ADD CONSTRAINT exam_incident_actions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: exam_incident_attempts exam_incident_attempts_attempt_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incident_attempts
    ADD CONSTRAINT exam_incident_attempts_attempt_fk FOREIGN KEY (organization_id, attempt_id) REFERENCES public.exam_attempts(organization_id, id);


--
-- Name: exam_incident_attempts exam_incident_attempts_incident_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incident_attempts
    ADD CONSTRAINT exam_incident_attempts_incident_fk FOREIGN KEY (organization_id, incident_id) REFERENCES public.exam_incidents(organization_id, id);


--
-- Name: exam_incident_attempts exam_incident_attempts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incident_attempts
    ADD CONSTRAINT exam_incident_attempts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: exam_incident_events exam_incident_events_incident_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incident_events
    ADD CONSTRAINT exam_incident_events_incident_fk FOREIGN KEY (organization_id, incident_id) REFERENCES public.exam_incidents(organization_id, id);


--
-- Name: exam_incident_events exam_incident_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incident_events
    ADD CONSTRAINT exam_incident_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: exam_incident_interruption_links exam_incident_interruption_links_incident_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incident_interruption_links
    ADD CONSTRAINT exam_incident_interruption_links_incident_fk FOREIGN KEY (organization_id, incident_id) REFERENCES public.exam_incidents(organization_id, id);


--
-- Name: exam_incident_interruption_links exam_incident_interruption_links_interruption_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incident_interruption_links
    ADD CONSTRAINT exam_incident_interruption_links_interruption_fk FOREIGN KEY (organization_id, attempt_id, interruption_id) REFERENCES public.attempt_interruptions(organization_id, attempt_id, id);


--
-- Name: exam_incident_interruption_links exam_incident_interruption_links_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incident_interruption_links
    ADD CONSTRAINT exam_incident_interruption_links_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: exam_incidents exam_incidents_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incidents
    ADD CONSTRAINT exam_incidents_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.candidate_profiles(id);


--
-- Name: exam_incidents exam_incidents_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incidents
    ADD CONSTRAINT exam_incidents_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(id);


--
-- Name: exam_incidents exam_incidents_org_attempt_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incidents
    ADD CONSTRAINT exam_incidents_org_attempt_fk FOREIGN KEY (organization_id, attempt_id) REFERENCES public.exam_attempts(organization_id, id);


--
-- Name: exam_incidents exam_incidents_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_incidents
    ADD CONSTRAINT exam_incidents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: exam_policy_profiles exam_policy_profiles_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_policy_profiles
    ADD CONSTRAINT exam_policy_profiles_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: exam_proctor_assignment_events exam_proctor_assignment_events_actor_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_proctor_assignment_events
    ADD CONSTRAINT exam_proctor_assignment_events_actor_fk FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: exam_proctor_assignment_events exam_proctor_assignment_events_assignment_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_proctor_assignment_events
    ADD CONSTRAINT exam_proctor_assignment_events_assignment_fk FOREIGN KEY (organization_id, assignment_id) REFERENCES public.exam_proctor_assignments(organization_id, id);


--
-- Name: exam_proctor_assignment_events exam_proctor_assignment_events_org_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_proctor_assignment_events
    ADD CONSTRAINT exam_proctor_assignment_events_org_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: exam_proctor_assignments exam_proctor_assignments_assigned_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_proctor_assignments
    ADD CONSTRAINT exam_proctor_assignments_assigned_by_fk FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: exam_proctor_assignments exam_proctor_assignments_exam_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_proctor_assignments
    ADD CONSTRAINT exam_proctor_assignments_exam_fk FOREIGN KEY (organization_id, exam_id) REFERENCES public.exams(organization_id, id);


--
-- Name: exam_proctor_assignments exam_proctor_assignments_org_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_proctor_assignments
    ADD CONSTRAINT exam_proctor_assignments_org_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: exam_proctor_assignments exam_proctor_assignments_proctor_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_proctor_assignments
    ADD CONSTRAINT exam_proctor_assignments_proctor_user_fk FOREIGN KEY (proctor_user_id) REFERENCES public.users(id);


--
-- Name: exam_proctor_assignments exam_proctor_assignments_revoked_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exam_proctor_assignments
    ADD CONSTRAINT exam_proctor_assignments_revoked_by_fk FOREIGN KEY (revoked_by) REFERENCES public.users(id);


--
-- Name: exams exams_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id);


--
-- Name: exams exams_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: grader_exam_assignments grader_exam_assignments_assigned_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.grader_exam_assignments
    ADD CONSTRAINT grader_exam_assignments_assigned_by_fk FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: grader_exam_assignments grader_exam_assignments_exam_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.grader_exam_assignments
    ADD CONSTRAINT grader_exam_assignments_exam_fk FOREIGN KEY (organization_id, exam_id) REFERENCES public.exams(organization_id, id);


--
-- Name: grader_exam_assignments grader_exam_assignments_grader_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.grader_exam_assignments
    ADD CONSTRAINT grader_exam_assignments_grader_user_fk FOREIGN KEY (grader_user_id) REFERENCES public.users(id);


--
-- Name: grader_exam_assignments grader_exam_assignments_org_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.grader_exam_assignments
    ADD CONSTRAINT grader_exam_assignments_org_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: grader_exam_assignments grader_exam_assignments_revoked_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.grader_exam_assignments
    ADD CONSTRAINT grader_exam_assignments_revoked_by_fk FOREIGN KEY (revoked_by) REFERENCES public.users(id);


--
-- Name: import_job_logs import_job_logs_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.import_job_logs
    ADD CONSTRAINT import_job_logs_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: notifications notifications_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: notifications notifications_recipient_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_recipient_user_id_users_id_fk FOREIGN KEY (recipient_user_id) REFERENCES public.users(id);


--
-- Name: organization_settings organization_settings_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.organization_settings
    ADD CONSTRAINT organization_settings_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: password_reset_tokens password_reset_tokens_org_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_org_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: password_reset_tokens password_reset_tokens_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: questions questions_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id);


--
-- Name: questions questions_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: staff_invitations staff_invitations_created_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.staff_invitations
    ADD CONSTRAINT staff_invitations_created_by_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: staff_invitations staff_invitations_org_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.staff_invitations
    ADD CONSTRAINT staff_invitations_org_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: teacher_course_assignments teacher_course_assignments_assigned_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.teacher_course_assignments
    ADD CONSTRAINT teacher_course_assignments_assigned_by_fk FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: teacher_course_assignments teacher_course_assignments_course_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.teacher_course_assignments
    ADD CONSTRAINT teacher_course_assignments_course_fk FOREIGN KEY (organization_id, course_id) REFERENCES public.courses(organization_id, id);


--
-- Name: teacher_course_assignments teacher_course_assignments_org_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.teacher_course_assignments
    ADD CONSTRAINT teacher_course_assignments_org_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: teacher_course_assignments teacher_course_assignments_revoked_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.teacher_course_assignments
    ADD CONSTRAINT teacher_course_assignments_revoked_by_fk FOREIGN KEY (revoked_by) REFERENCES public.users(id);


--
-- Name: teacher_course_assignments teacher_course_assignments_teacher_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.teacher_course_assignments
    ADD CONSTRAINT teacher_course_assignments_teacher_user_fk FOREIGN KEY (teacher_user_id) REFERENCES public.users(id);


--
-- Name: user_role_assignments user_role_assignments_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.user_role_assignments
    ADD CONSTRAINT user_role_assignments_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: user_role_assignments user_role_assignments_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.user_role_assignments
    ADD CONSTRAINT user_role_assignments_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: exam
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- PostgreSQL database dump complete
--

\unrestrict 8D4cxMp8xLJhp2WrWEuhja5TfxzaBcbzhSYVhNNFeiWonSl8hiIMjHlwqNGfYGA

