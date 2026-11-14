import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useProductDateTime } from "@/contexts/DateTimeContext";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { AppIcon } from "@/components/shared/AppIcon";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DataTableShell } from "@/components/shared/DataTableShell";
import { DataViewFooter } from "@/components/shared/DataViewFooter";
import { DataTablePagination } from "@/components/shared/DataTablePagination";
import { DataToolbar, ToolbarFilter } from "@/components/shared/DataToolbar";
import { MobileRecordList } from "@/components/shared/MobileRecordList";
import {
  DesktopDataTable,
  type DataViewColumnDef,
} from "@/components/shared/DesktopDataTable";
import {
  RowActions,
  type RowActionDeclaration,
} from "@/components/shared/RowActions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PageContainer } from "@/components/shared/PageContainer";
import { ClipboardList, Eye, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { canCreateExam, canDeleteExam } from "@/lib/capabilities";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { deleteDisabledReasonKey } from "@/lib/examDisabledReasons";
import { getStatusMeta } from "@/lib/statusMeta";
import { statusLabelKey } from "@/lib/statusMetaUtils";
import { parsePageParam, resolveClampTarget } from "@/lib/listQueryState";
import { listReturnState } from "@/lib/listReturnNavigation";
import { ExamStatusEnum, type ExamStatus } from "@exam/contracts";
import type { DeleteDisabledReasonCode } from "@exam/contracts";

/** Exam-list page size — real pagination reaches every exam (#785). */
const EXAMS_PAGE_SIZE = 20;

/** Row shape returned by the exams list API. */
interface ExamRow {
  id: string;
  title: string;
  status: string;
  openAt: string;
  closeAt: string;
  durationMinutes: number;
  passingScore: number;
  totalScore: number;
  questionIds: string[];
  participantCount: number;
  canDelete: boolean;
  deleteDisabledReasonCode: DeleteDisabledReasonCode | null;
  /** Legacy natural-language sibling — compatibility fallback only (D0.8). */
  deleteDisabledReason: string | null;
}

/** Generic paginated API response wrapper. */
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Select value for "no status filter" (the parameter-less default). */
const STATUS_ALL = "all";

function isExamStatus(value: string): value is ExamStatus {
  return (ExamStatusEnum.options as readonly string[]).includes(value);
}

/**
 * The canonical parameter list for this page, or null when it already is
 * canonical. Unmanaged parameters pass through untouched; a repeated managed
 * parameter keeps its FIRST value. The `status` vocabulary is the enum the
 * control can express, so a value the control cannot display is dropped rather
 * than forwarded — and `status=all` is the parameter-less default, never a
 * written value.
 */
function canonicalizeExamParams(
  params: URLSearchParams,
): URLSearchParams | null {
  const next = new URLSearchParams();
  const emitted = new Set<string>();
  for (const [key, value] of params) {
    if (key !== "page" && key !== "status") {
      next.append(key, value);
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    if (key === "page") {
      const page = parsePageParam(value);
      if (page !== 1) next.set("page", String(page));
    } else if (isExamStatus(value)) {
      next.set("status", value);
    }
  }
  return next.toString() === params.toString() ? null : next;
}

/** Writes the `page` parameter, keeping the default (page 1) out of the URL. */
function writePageParam(params: URLSearchParams, page: number): void {
  if (page <= 1) params.delete("page");
  else params.set("page", String(page));
}

/**
 * Admin page for listing, viewing, and deleting exams. Server-side
 * pagination plus an optional status filter (#785): every authorized exam is
 * reachable by paging, the total comes from the response, and a stale
 * response can never overwrite a newer query's data.
 *
 * The URL is the single authority for the submitted query state (#784 stage
 * A): `status` and `page` derive from it, a status change replaces the entry
 * (it is a new query) and a page change pushes one (Back walks the pages the
 * user visited). #785's correctness mechanisms — the request generation
 * guard, the B11 single-jump recovery from an emptied page and the B12
 * "never present stale rows as the new query's result" gate — are unchanged;
 * only where their inputs come from has moved.
 */
export function ExamPage() {
  const { t } = useTranslation();
  const { formatDateRange } = useProductDateTime();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [total, setTotal] = useState(0);
  // The failure and the request key it belongs to. A failure is only ever
  // presented for the query that produced it: switching to another query must
  // not keep showing the previous query's error.
  const [loadFailure, setLoadFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  // Latest-request guard: rapid filter/page flips fire overlapping exams
  // requests; a stale response resolving last must not overwrite the table
  // (same contract as UsersPage/QuestionPage).
  const examsGenRef = useRef(0);
  // B12: the query whose response is currently rendered. Until it equals the
  // submitted query, the list body shows the pending state — old rows are never
  // presented as the new query's result. Stored as its parts, not as a joined
  // string: the status filter and the page are compared separately, and neither
  // may be recovered by parsing a key.
  const loadedQueryRef = useRef<{
    page: number;
    status: "all" | ExamStatus;
  } | null>(null);
  // The latest OBSERVED parameter set: every write this page makes updates it
  // in the same synchronous block, so writes can never be based on a stale
  // render-time snapshot. Seeded with the mount URL.
  const latestParams = useRef<URLSearchParams | null>(null);
  if (latestParams.current === null) {
    latestParams.current = new URLSearchParams(searchParams);
  }

  const page = parsePageParam(searchParams.get("page"));
  const statusRaw = searchParams.get("status") ?? "";
  const statusFilter: "all" | ExamStatus = isExamStatus(statusRaw)
    ? statusRaw
    : STATUS_ALL;
  const queryKey = `${page}|${statusFilter}`;
  const mayCreateExam = user ? canCreateExam(user) : false;
  const mayDeleteExam = user ? canDeleteExam(user) : false;

  const baseParams = useCallback(
    () => new URLSearchParams(latestParams.current as URLSearchParams),
    [],
  );

  const writeParams = useCallback(
    (next: URLSearchParams, options?: { push?: boolean }) => {
      const current = latestParams.current as URLSearchParams;
      if (current.toString() === next.toString()) return;
      latestParams.current = new URLSearchParams(next);
      setSearchParams(next, { replace: !options?.push });
    },
    [setSearchParams],
  );

  useEffect(() => {
    latestParams.current = new URLSearchParams(searchParams);
  }, [searchParams]);

  // Canonicalization replaces the entry: an illegal value is a correction, not
  // a page the user can navigate back to. Idempotent by construction.
  useEffect(() => {
    const canonical = canonicalizeExamParams(searchParams);
    if (canonical) writeParams(canonical);
  }, [searchParams, writeParams]);

  /**
   * Tooltip explanation why deletion is blocked. The machine
   * DisabledReasonCode is authoritative (D0.8); the legacy natural-language
   * wire field only covers unknown future codes.
   */
  function deleteDisabledReasonPresentation(exam: ExamRow): string {
    const code = exam.deleteDisabledReasonCode;
    if (code) {
      const key = deleteDisabledReasonKey(code);
      if (key) return t(key);
    }
    return exam.deleteDisabledReason ?? t("admin.exams.deleteDisabled");
  }

  const loadExams = useCallback(async () => {
    const generation = ++examsGenRef.current;
    const isStale = () => generation !== examsGenRef.current;
    const requestedKey = queryKey;
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(EXAMS_PAGE_SIZE),
      });
      if (statusFilter !== STATUS_ALL) params.set("statuses", statusFilter);
      const data = await api.get<PaginatedResponse<ExamRow>>(
        `/api/exams?${params.toString()}`,
      );
      if (isStale()) return;
      // B11: an empty page while records exist elsewhere is an out-of-range
      // page (e.g. after a deletion). Never commit it — it would render a
      // fake "no exams" state. Jump straight to the last valid page in one
      // step, in the URL (replace), and stay pending until its rows land.
      // The response-derived write lives inside the non-stale branch only.
      const clampTarget = resolveClampTarget({
        itemCount: data.items.length,
        total: data.total,
        page,
        pageSize: EXAMS_PAGE_SIZE,
      });
      if (clampTarget !== null) {
        const next = baseParams();
        writePageParam(next, clampTarget);
        writeParams(next);
        return;
      }
      setExams(data.items);
      setTotal(data.total);
      setLoadFailure(null);
      loadedQueryRef.current = { page, status: statusFilter };
    } catch {
      if (isStale()) return;
      setLoadFailure({
        key: requestedKey,
        message: t("admin.exams.loadFailed"),
      });
    }
  }, [baseParams, page, queryKey, statusFilter, t, writeParams]);

  useEffect(() => {
    void loadExams();
  }, [loadExams]);

  // The current loader, for refetches that outlive the render they started in
  // (a delete's confirmation lands after the user may have moved on).
  const loadExamsRef = useRef(loadExams);
  useEffect(() => {
    loadExamsRef.current = loadExams;
  }, [loadExams]);

  /** A filter change is a new query: it resets to the first page (B06). */
  function handleStatusFilterChange(value: string) {
    const next = baseParams();
    if (value === STATUS_ALL) next.delete("status");
    else next.set("status", value);
    next.delete("page");
    writeParams(next);
  }

  function handlePageChange(nextPage: number) {
    if (nextPage === page) return;
    const next = baseParams();
    writePageParam(next, nextPage);
    // Page changes PUSH: Back walks the pages the user actually visited.
    writeParams(next, { push: true });
  }

  async function handleDelete(id: string) {
    try {
      await api.delete(`/api/exams/${id}`);
      toast.success(t("admin.exams.toast.deleted"));
      // If this page became empty, loadExams jumps to the last valid page
      // (B11) instead of committing the empty response.
      //
      // The refetch goes through the ref: the delete resolves into the query the
      // user is on NOW, not the one that was rendered when they clicked. The
      // render-time closure would issue a request for an obsolete key, and the
      // generation guard would then discard the current query's own response.
      await loadExamsRef.current();
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, t, t("admin.exams.toast.deleteFailed")),
      );
    }
  }

  // A failure is shown only for the query that produced it.
  const error =
    loadFailure !== null && loadFailure.key === queryKey
      ? loadFailure.message
      : null;

  if (error)
    return (
      <ErrorState
        message={error}
        onRetry={() => {
          // Retry is a new attempt, not a re-render of the failure: releasing
          // the failed key puts the page back into its in-flight state so the
          // user sees the request they just asked for.
          setLoadFailure(null);
          void loadExamsRef.current();
        }}
      />
    );

  const toolbar = (
    <DataToolbar aria-label={t("admin.exams.toolbarLabel")}>
      <ToolbarFilter size="narrow">
        <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
          <SelectTrigger aria-label={t("admin.exams.statusFilterLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={STATUS_ALL}>
              {t("admin.exams.statusAll")}
            </SelectItem>
            {ExamStatusEnum.options.map((status) => (
              <SelectItem key={status} value={status}>
                {t(statusLabelKey(getStatusMeta(status).labelKey))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ToolbarFilter>
    </DataToolbar>
  );

  // Never-loaded: keep the bare initial loader. In-flight query change
  // (B11/B12): the single shell keeps its toolbar/footer mounted, but the
  // list body shows the pending state — stale rows and fake empty states
  // are never rendered while a newer query has not landed.
  if (loadedQueryRef.current === null) return <LoadingState />;
  const loadedQuery = loadedQueryRef.current;
  const pending =
    loadedQuery.page !== page || loadedQuery.status !== statusFilter;
  // The query IDENTITY of the rendered result — everything but the page. A
  // page turn keeps the previous page's count meaningful (the footer belongs
  // to the page being requested); a status change does not, because the old
  // count describes a different result set entirely.
  const identityPending = loadedQuery.status !== statusFilter;

  /** The one shell composition for this page: the footer authority is
   * declared once; pending and loaded states only vary body and mobile. */
  function renderShell(body: ReactNode, mobile?: ReactNode) {
    return (
      <DataTableShell
        title={t("admin.exams.listTitle")}
        description={t("admin.exams.listDescription")}
        toolbar={toolbar}
        footer={
          // While a NEW status query is pending, the previous query's count
          // must not produce page numbers that do not exist for the new one
          // (OD3): the footer states the pending fact and offers no
          // navigation. A page turn within the same query keeps the real
          // footer — its count still describes this result set.
          identityPending ? (
            <DataViewFooter
              summary={t("common.table.pendingSummary")}
              navigation={
                <DataTablePagination
                  page={1}
                  pageSize={EXAMS_PAGE_SIZE}
                  total={0}
                  onPageChange={handlePageChange}
                />
              }
            />
          ) : (
            <DataViewFooter
              range={{ page, pageSize: EXAMS_PAGE_SIZE, total }}
              navigation={
                <DataTablePagination
                  page={page}
                  pageSize={EXAMS_PAGE_SIZE}
                  total={total}
                  onPageChange={handlePageChange}
                />
              }
            />
          )
        }
        mobile={mobile}
      >
        {body}
      </DataTableShell>
    );
  }

  // Single-source column declarations (issue 457): desktop table and mobile
  // cards render from the same array. The time window joins the meta line —
  // without the override it would be dropped (date-range defaults to low),
  // losing the exam's availability window on mobile.
  const columns: DataViewColumnDef<ExamRow>[] = [
    {
      id: "title",
      meta: { role: "primary-text" },
      header: t("admin.exams.columns.title"),
      cell: ({ row }) => row.original.title,
    },
    {
      id: "status",
      meta: { role: "status" },
      header: t("admin.exams.columns.status"),
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "timeWindow",
      meta: { role: "date-range", priority: "normal" },
      header: t("admin.exams.columns.timeWindow"),
      cell: ({ row }) => (
        <span className="type-secondary">
          {formatDateRange(row.original.openAt, row.original.closeAt)}
        </span>
      ),
    },
    {
      id: "duration",
      meta: { role: "duration" },
      header: t("admin.exams.columns.duration"),
      cell: ({ row }) =>
        t("admin.exams.duration", { min: row.original.durationMinutes }),
    },
    {
      id: "questionCount",
      meta: { role: "number" },
      header: t("admin.exams.columns.questionCount"),
      cell: ({ row }) => row.original.questionIds.length,
    },
    {
      id: "participantCount",
      meta: { role: "number" },
      header: t("admin.exams.columns.participants"),
      cell: ({ row }) => row.original.participantCount,
    },
    {
      id: "passingScore",
      meta: { role: "score" },
      header: t("admin.exams.columns.passingScore"),
      cell: ({ row }) =>
        t("admin.exams.columns.passingScoreValue", {
          score: row.original.passingScore,
          total: row.original.totalScore,
        }),
    },
    {
      id: "actions",
      meta: { role: "actions" },
      header: t("admin.exams.columns.actions"),
      cell: ({ row }) => {
        const exam = row.original;
        return (
          <RowActions
            row={exam}
            // F-07 (#971): compose the entity name so every icon control and
            // kebab trigger announces WHICH row it acts on.
            entityName={exam.title}
            actions={[
              {
                id: "view",
                label: t("admin.exams.viewDetail"),
                icon: Eye,
                onSelect: () =>
                  void navigate(`/admin/exams/${exam.id}`, {
                    state: listReturnState(location),
                  }),
              },
              ...(mayDeleteExam
                ? ([
                    {
                      id: "delete",
                      label: t("admin.exams.deleteLabel"),
                      icon: Trash2,
                      tone: "destructive",
                      disabled: exam.canDelete
                        ? false
                        : {
                            reason: deleteDisabledReasonPresentation(exam),
                          },
                      confirm: {
                        title: t("admin.exams.confirmDelete"),
                        description: t("admin.exams.confirmDeleteDescription", {
                          title: exam.title,
                        }),
                        destructive: true,
                      },
                      onSelect: () => void handleDelete(exam.id),
                    },
                  ] as RowActionDeclaration<typeof exam>[])
                : []),
            ]}
          />
        );
      },
    },
  ];

  const hasStatusFilter = statusFilter !== STATUS_ALL;

  return (
    <TooltipProvider>
      <PageContainer role="admin-dense" className="flex flex-col gap-6">
        <PageHeader
          title={t("admin.exams.title")}
          actions={
            mayCreateExam ? (
              <Button
                onClick={() =>
                  void navigate("/admin/exams/new", {
                    state: listReturnState(location),
                  })
                }
              >
                <AppIcon icon={Plus} size="inline" />
                {t("admin.exams.createBtn")}
              </Button>
            ) : undefined
          }
        />

        {pending ? (
          renderShell(<LoadingState />)
        ) : exams.length === 0 && !hasStatusFilter ? (
          <EmptyState
            icon={<AppIcon icon={ClipboardList} size="state" />}
            title={t("admin.exams.empty")}
            description={t("admin.exams.emptyDescription")}
          />
        ) : exams.length === 0 && hasStatusFilter ? (
          <EmptyState
            icon={<AppIcon icon={ClipboardList} size="state" />}
            title={t("admin.exams.noMatch")}
            description={t("admin.exams.noMatchDescription")}
            action={
              <Button
                variant="outline"
                onClick={() => handleStatusFilterChange(STATUS_ALL)}
              >
                {t("admin.exams.clearFilterLabel")}
              </Button>
            }
          />
        ) : (
          renderShell(
            <DesktopDataTable
              columns={columns}
              data={exams}
              getRowId={(e) => e.id}
            />,
            <MobileRecordList
              columns={columns}
              rows={exams}
              getRowId={(e) => e.id}
            />,
          )
        )}
      </PageContainer>
    </TooltipProvider>
  );
}
