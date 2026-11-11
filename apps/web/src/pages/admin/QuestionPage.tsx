import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  UNSAFE_NavigationContext,
  useLocation,
  useNavigate,
  useSearchParams,
  type Location,
  type Navigator,
} from "react-router";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { DataToolbar, ToolbarFilter } from "@/components/shared/DataToolbar";
import { DataViewSearch } from "@/components/shared/DataViewSearch";
import { RowActions } from "@/components/shared/RowActions";
import { DataTablePagination } from "@/components/shared/DataTablePagination";
import { DataViewFooter } from "@/components/shared/DataViewFooter";
import {
  DataWorkbench,
  DataWorkbenchToolbar,
} from "@/components/shared/DataWorkbench";
import {
  DesktopDataTable,
  type DataViewColumnDef,
} from "@/components/shared/DesktopDataTable";
import { DataTableOverflowText } from "@/components/shared/DataTableContract";
import { MobileRecordList } from "@/components/shared/MobileRecordList";
import { AppIcon } from "@/components/shared/AppIcon";
import { TagFilterSelect } from "@/components/shared/TagFilterSelect";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TagBadge } from "@/components/shared/TagBadge";
import { PageContainer } from "@/components/shared/PageContainer";
import { getTypeLabel, isQuestionType, TYPE_VARIANT } from "@/lib/constants";
import { parsePageParam, resolveClampTarget } from "@/lib/listQueryState";
import { listReturnState } from "@/lib/listReturnNavigation";
import {
  FileUp,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";

/** A question record for the admin question list table. */
interface QuestionRow {
  id: string;
  courseId: string;
  type: string;
  content: string;
  score: number;
  difficulty: number;
  tags: string[];
}

/** A course record used for course name lookup in the question table. */
interface CourseRow {
  id: string;
  name: string;
  code: string;
}

/** Generic paginated API response wrapper. */
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const PAGE_SIZE = 20;

/** Select value for "no filter" — the parameter-less default of every control. */
const ALL = "all";

const DIFFICULTY_VALUES = ["1", "2", "3", "4", "5"];

/** URL parameters this page owns; every other parameter is passed through. */
const MANAGED_PARAMS = [
  "page",
  "courseId",
  "type",
  "difficulty",
  "tags",
  "search",
] as const;

type ManagedParam = (typeof MANAGED_PARAMS)[number];

function isManagedParam(key: string): key is ManagedParam {
  return (MANAGED_PARAMS as readonly string[]).includes(key);
}

/** Canonical tag selection: trimmed, de-duplicated, sorted. */
function normalizeTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const token of raw.split(",")) {
    const tag = token.trim();
    if (tag) seen.add(tag);
  }
  // Default (UTF-16 code unit) sort on purpose: the canonical form must be the
  // same string on every client, so it cannot depend on the locale.
  return [...seen].sort();
}

/**
 * The canonical value of a managed parameter, or null when the parameter must
 * be absent. This is the ONE place the page decides what a URL value means;
 * both the request builder and the canonical rewrite read it.
 */
function canonicalParamValue(key: ManagedParam, raw: string): string | null {
  switch (key) {
    case "page": {
      const page = parsePageParam(raw);
      // "1" is the default and is never written; every illegal form means the
      // same thing and is dropped rather than forwarded to the API.
      return page === 1 ? null : String(page);
    }
    case "courseId":
      // Legality is DECIDED BY DISPLAYABILITY (the resolution probe), not by a
      // client-side uuid pattern: the server accepts ids this regex would not.
      return raw === "" ? null : raw;
    case "type":
      return isQuestionType(raw) ? raw : null;
    case "difficulty":
      return DIFFICULTY_VALUES.includes(raw) ? raw : null;
    case "tags": {
      const tags = normalizeTags(raw);
      return tags.length === 0 ? null : tags.join(",");
    }
    case "search":
      return raw.trim() === "" ? null : raw.trim();
  }
}

/**
 * The canonical parameter list for `params`, or null when it already is
 * canonical. Unmanaged parameters are preserved untouched; a repeated managed
 * parameter keeps its FIRST value and drops the rest. Idempotent by
 * construction: the canonical form maps to itself, so the rewrite cannot loop.
 */
function canonicalizeParams(params: URLSearchParams): URLSearchParams | null {
  const next = new URLSearchParams();
  const emitted = new Set<string>();
  for (const [key, value] of params) {
    if (!isManagedParam(key)) {
      next.append(key, value);
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    const canonical = canonicalParamValue(key, value);
    if (canonical !== null) next.set(key, canonical);
  }
  return next.toString() === params.toString() ? null : next;
}

/** Writes the `page` parameter, keeping the default (page 1) out of the URL. */
function writePageParam(params: URLSearchParams, page: number): void {
  if (page <= 1) params.delete("page");
  else params.set("page", String(page));
}

/**
 * Admin question management page with server-side search, filtering by course,
 * type, difficulty, and tags, plus pagination.
 *
 * The URL is the single authority for the SUBMITTED query state (filters,
 * search term, page): refreshing, deep-linking and Back/Forward all restore the
 * same query, and returning from an edit/create/import child restores it too
 * (#784 stage A). The only local query-adjacent state is the search DRAFT,
 * which is not applied until the debounced commit lands in the URL.
 *
 * DesktopDataTable is the TanStack headless engine with a role-based column
 * contract; the derived MobileRecordList renders the same column declarations
 * below lg (docs/architecture/frontend.md). Search is SERVER-SIDE over the full
 * dataset (debounced); the workbench shell stays mounted across
 * loading/empty/error transitions — only the table body swaps, so there is no
 * layout jitter.
 */
export function QuestionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  // The declarative routers put the live history instance in the navigation
  // context as `navigator`; the published `Navigator` type narrows it to the
  // mutation surface, but the runtime object is a full history, so widen it
  // once here to read `location` — the only channel that reflects a committed
  // navigation synchronously, before React renders it.
  const history = useContext(UNSAFE_NavigationContext)
    .navigator as Navigator & {
    location: Location;
  };

  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [tagVocabulary, setTagVocabulary] = useState<string[]>([]);
  // Courses resolved from a deep-linked courseId that the loaded options do not
  // contain. Kept separate from `courses` so a list refresh cannot drop the
  // display of the filter the user is looking at.
  const [resolvedCourses, setResolvedCourses] = useState<CourseRow[]>([]);
  // The courseId whose displayability could NOT be established because the
  // probe failed transiently (network/5xx). The user's filter is preserved and
  // the page offers retry — a transient failure must never be presented as
  // "no such course" and never silently drop the parameter.
  //
  // Keyed by the id, not a bare flag: the outcome belongs to one identity, so
  // navigating to a URL that no longer carries it must not keep reporting it.
  const [courseProbeFailedId, setCourseProbeFailedId] = useState<string | null>(
    null,
  );
  const [courseProbeAttempt, setCourseProbeAttempt] = useState(0);
  // The latest-request guard (unchanged contract): multi-select tag changes and
  // rapid page/filter flips fire overlapping requests; a response whose
  // generation is no longer current must not mutate rows, total, error, or the
  // URL.
  const requestGenerationRef = useRef(0);
  // The settlement record behind the render gate. `idKey` is the RENDER key of
  // the rows currently on screen (the filter identity of the last SUCCESSFUL
  // response); `reqKey` is the exact request the last response — success or
  // failure — answered. They are deliberately different key spaces: the gate
  // compares render keys, a failure is attributed to one request.
  const [loadState, setLoadState] = useState<{
    idKey: string | null;
    reqKey: string | null;
    status: "loaded" | "failed";
  }>({ idKey: null, reqKey: null, status: "loaded" });
  // True while the single-jump recovery for an out-of-range page is in flight.
  // The page turn window keeps the previous slice visible; a recovery refetch
  // must not, because its rows belong to a page the URL no longer names.
  const [clamping, setClamping] = useState(false);
  // The height the settled rows last occupied, so a pending body can reserve
  // it. A pending body may render neither the previous identity's rows nor an
  // empty state, which leaves the table's single short placeholder row — a
  // collapse from ~1374px to ~170px that makes the page scrollbar flicker on
  // every filter change.
  const listBoxRef = useRef<HTMLDivElement | null>(null);
  const [reservedListHeight, setReservedListHeight] = useState<number | null>(
    null,
  );
  // Search is split into two states to prevent stale/overlapping responses:
  //   - searchInput: the live text in the field (updated every keystroke)
  //   - the URL `search` parameter: the term actually queried, written only by
  //     the debounced commit from DataViewSearch. Typing therefore does NOT
  //     fire a request per keystroke — only the debounced commit does.
  const [searchInput, setSearchInput] = useState(
    () => searchParams.get("search") ?? "",
  );
  // The last search term this page saw committed in the URL. A draft that has
  // moved past it is an in-progress input and wins until its own commit lands.
  const lastCommittedSearch = useRef(searchInput);
  // The LATEST OBSERVED parameter set. Every write this page makes updates it in
  // the same synchronous block, so a difference between it and the rendered
  // searchParams can only mean an EXTERNAL navigation (Back/Forward, a link) —
  // which cancels an unlanded debounce commit instead of letting it overwrite
  // the entry the user just navigated to. Seeded with the mount URL so the
  // first write never has to wait for an effect.
  const latestParams = useRef<URLSearchParams | null>(null);
  if (latestParams.current === null) {
    latestParams.current = new URLSearchParams(searchParams);
  }
  // The history entry this page last observed or wrote. Every page-side signal
  // — render props, refs updated by render or by effects — still describes the
  // PREVIOUS entry between a committed external navigation (Back/Forward, a
  // link) and the flush of the render/effect chain that would cancel a pending
  // draft. The debounce deadline can expire inside that gap (#953), so the
  // commit boundary must compare against the history instance itself, and it
  // must key on the ENTRY (location.key), not on the parameter string: two
  // entries may carry identical params. Updated exactly where latestParams is,
  // so "the params I know" and "the entry I am on" can never disagree.
  const observedEntryKey = useRef<string | null>(null);
  if (observedEntryKey.current === null) {
    observedEntryKey.current = location.key;
  }

  const courseId = searchParams.get("courseId") ?? "";
  const typeRaw = searchParams.get("type") ?? "";
  const difficultyRaw = searchParams.get("difficulty") ?? "";
  const tagsRaw = searchParams.get("tags") ?? "";
  const searchRaw = searchParams.get("search") ?? "";
  const pageRaw = searchParams.get("page") ?? "";

  const queryState = useMemo(() => {
    const type = canonicalParamValue("type", typeRaw) ?? "";
    const difficulty = canonicalParamValue("difficulty", difficultyRaw) ?? "";
    const tags = normalizeTags(tagsRaw);
    const search = canonicalParamValue("search", searchRaw) ?? "";
    return {
      courseId: canonicalParamValue("courseId", courseId) ?? "",
      type,
      difficulty,
      tags,
      search,
      page: parsePageParam(pageRaw),
    };
    // Only the raw parameter values matter, so a re-render with an equal URL
    // (which is what a canonical rewrite produces) keeps this object identical
    // and cannot re-trigger the list request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, typeRaw, difficultyRaw, tagsRaw, searchRaw, pageRaw]);

  const { page, type: filterType, difficulty: filterDifficulty } = queryState;
  const search = queryState.search;
  const tags = queryState.tags;
  /** The canonical tag parameter. Deps and requests key on this string, not on
   * the freshly built array, so a raw-only URL change (a canonicalization)
   * cannot fire a second identical request. */
  const tagsKey = tags.join(",");

  /** The filter IDENTITY: everything except the page. */
  const filterKey = useMemo(
    () =>
      JSON.stringify([
        queryState.courseId,
        queryState.type,
        queryState.difficulty,
        queryState.tags,
        queryState.search,
      ]),
    [queryState],
  );
  /** The request key: one key per (identity, page) pair. */
  const requestKey = useMemo(
    () => JSON.stringify([filterKey, page]),
    [filterKey, page],
  );
  /** The gate compares RENDER keys — the identity projection of a request. */
  const renderKey = filterKey;

  const courseOptions = useMemo(
    () => [...courses, ...resolvedCourses],
    [courses, resolvedCourses],
  );
  const courseKnown =
    queryState.courseId === "" ||
    courseOptions.some(
      (c) => c.id.toLowerCase() === queryState.courseId.toLowerCase(),
    );
  const courseProbeFailed =
    courseProbeFailedId !== null && courseProbeFailedId === queryState.courseId;
  const courseResolving =
    queryState.courseId !== "" && !courseKnown && !courseProbeFailed;

  const courseMap = useMemo(
    () => new Map(courseOptions.map((c) => [c.id, c.name])),
    [courseOptions],
  );

  /**
   * The parameter set every write starts from. Reading the ref (not the
   * rendered `searchParams`) is what makes the write atomic across two commits
   * landing in the same task: both would otherwise apply against the same
   * render-time base and the first would be silently dropped.
   */
  const baseParams = useCallback(
    () => new URLSearchParams(latestParams.current as URLSearchParams),
    [],
  );

  /**
   * Commits a full parameter set to the URL.
   *
   * The ref is updated in the same synchronous block as the write, so the
   * external-navigation detector only ever fires for writes this page did not
   * make. An identical write is a no-op — no redundant history entry.
   */
  const writeParams = useCallback(
    (next: URLSearchParams, options?: { push?: boolean }) => {
      const current = latestParams.current as URLSearchParams;
      if (current.toString() === next.toString()) return;
      latestParams.current = new URLSearchParams(next);
      setSearchParams(next, { replace: !options?.push });
      // The write lands on the history instance synchronously and the pushed
      // or replaced entry gets its own key: observe it now, so this page's own
      // write is never mistaken for a foreign navigation by the commit
      // boundary in handleSearchCommit.
      observedEntryKey.current = history.location.key;
    },
    [setSearchParams, history],
  );

  useEffect(() => {
    const observed = new URLSearchParams(searchParams);
    if (
      latestParams.current !== null &&
      (latestParams.current.toString() !== observed.toString() ||
        observedEntryKey.current !== location.key)
    ) {
      // External navigation: the query the user navigated to wins over any
      // draft that has not landed yet. Resetting the field also cancels the
      // pending debounced commit (useDataViewTextCommit cancels when the value
      // moves away from the term it is about to commit). Foreignness keys on
      // the ENTRY, not only on the params: a Back to an entry carrying the
      // same committed query is still a navigation away from the entry the
      // draft belongs to. Page-authored writes are never foreign — writeParams
      // re-observes both the params and the key in the same synchronous block.
      const committed = observed.get("search") ?? "";
      setSearchInput(committed);
      lastCommittedSearch.current = committed;
    }
    latestParams.current = observed;
    observedEntryKey.current = location.key;
  }, [searchParams, location]);

  /**
   * Folds the URL onto the server's spelling of a course id.
   *
   * uuid comparison is case-insensitive on both zod and Postgres, so an
   * uppercase link is legitimate input the server honours — but the Select's
   * option values come from the server, so an unfolded id would leave an
   * APPLIED filter rendering as the placeholder. Canonicalizing (replace) keeps
   * one authority and makes the applied value displayable and undoable.
   */
  useEffect(() => {
    if (isInitialLoading || queryState.courseId === "") return;
    const match = courseOptions.find(
      (c) => c.id.toLowerCase() === queryState.courseId.toLowerCase(),
    );
    if (match === undefined || match.id === queryState.courseId) return;
    const next = baseParams();
    next.set("courseId", match.id);
    writeParams(next);
  }, [
    baseParams,
    courseOptions,
    isInitialLoading,
    queryState.courseId,
    writeParams,
  ]);

  // Canonicalization is a visible correction, so it REPLACES the entry: an
  // illegal value must not become a page the user can navigate back to.
  useEffect(() => {
    const canonical = canonicalizeParams(searchParams);
    if (canonical) writeParams(canonical);
  }, [searchParams, writeParams]);

  // URL -> draft, one direction only, and only while the user has not typed
  // past the last committed value (Back/Forward, a shared link). A draft that
  // has moved ahead is an in-progress input and wins until its own commit
  // lands — otherwise an unrelated URL write would reset what the user typed.
  useEffect(() => {
    if (searchInput === lastCommittedSearch.current) setSearchInput(search);
    lastCommittedSearch.current = search;
  }, [search, searchInput]);

  const loadCourses = useCallback(async () => {
    try {
      const cData = await api.get<PaginatedResponse<CourseRow>>("/api/courses");
      setCourses(cData.items);
    } catch {
      // courses are optional context — table can still render
    }
  }, []);

  const loadTagVocabulary = useCallback(async () => {
    try {
      const data = await api.get<{ tags: string[] }>("/api/questions/tags");
      setTagVocabulary(data.tags);
    } catch {
      // vocabulary is optional context — the filter still renders (empty)
    }
  }, []);

  /**
   * Resolves a courseId the loaded options do not contain, so an applied filter
   * is always displayable and always undoable.
   *
   * Scope: only for ids that are NOT already options — the common path costs no
   * request. A deterministic "no such course" (404/400: deleted, out of the
   * caller's scope, malformed) drops the parameter and rewrites the URL; a
   * transient failure keeps the user's intent and routes to the retry path.
   */
  useEffect(() => {
    // The loaded options are the first half of "is this id already known?", so
    // the probe must not start before they land — otherwise every deep link
    // carrying an ordinary courseId would probe it needlessly.
    if (isInitialLoading) return;
    if (queryState.courseId === "" || courseKnown) return;
    let canceled = false;
    const id = queryState.courseId;
    void (async () => {
      try {
        const course = await api.get<CourseRow>(
          `/api/courses/${encodeURIComponent(id)}`,
        );
        if (canceled) return;
        setResolvedCourses((prev) =>
          prev.some((c) => c.id === course.id) ? prev : [...prev, course],
        );
      } catch (err) {
        if (canceled) return;
        if (
          err instanceof ApiError &&
          (err.status === 404 || err.status === 400)
        ) {
          const next = baseParams();
          next.delete("courseId");
          writeParams(next);
        } else {
          setCourseProbeFailedId(id);
        }
      }
    })();
    return () => {
      canceled = true;
    };
  }, [
    isInitialLoading,
    queryState.courseId,
    courseKnown,
    courseProbeAttempt,
    baseParams,
    writeParams,
  ]);

  const loadQuestions = useCallback(async () => {
    const generation = ++requestGenerationRef.current;
    const isStale = () => generation !== requestGenerationRef.current;
    const identity = filterKey;
    const requestedPage = page;
    const requestedKey = requestKey;
    try {
      const params = new URLSearchParams();
      params.set("page", String(requestedPage));
      params.set("pageSize", String(PAGE_SIZE));
      if (queryState.courseId !== "")
        params.set("courseId", queryState.courseId);
      if (filterType !== "") params.set("type", filterType);
      if (filterDifficulty !== "") params.set("difficulty", filterDifficulty);
      if (tagsKey !== "") params.set("tags", tagsKey);
      if (search !== "") params.set("search", search);
      const qData = await api.get<PaginatedResponse<QuestionRow>>(
        `/api/questions?${params.toString()}`,
      );
      if (isStale()) return;
      // Out-of-range recovery runs only in the non-stale branch: a late
      // response must never rewrite the URL the user is now looking at.
      const clampTarget = resolveClampTarget({
        itemCount: qData.items.length,
        total: qData.total,
        page: requestedPage,
        pageSize: PAGE_SIZE,
      });
      if (clampTarget !== null) {
        setClamping(true);
        const next = baseParams();
        writePageParam(next, clampTarget);
        writeParams(next);
        return;
      }
      setQuestions(qData.items);
      setTotal(qData.total);
      setClamping(false);
      setLoadState({ idKey: identity, reqKey: requestedKey, status: "loaded" });
    } catch {
      if (isStale()) return;
      setClamping(false);
      // A failure records WHICH request failed but never claims the identity:
      // nothing of this query is on screen, so a first-load failure must be
      // classified as "no rows to keep" (page-level), not as a same-identity
      // page turn that can keep the shell.
      setLoadState((prev) => ({
        idKey: prev.idKey,
        reqKey: requestedKey,
        status: "failed",
      }));
    }
  }, [
    baseParams,
    filterDifficulty,
    filterKey,
    filterType,
    page,
    queryState.courseId,
    requestKey,
    search,
    tagsKey,
    writeParams,
  ]);

  useEffect(() => {
    let canceledFlag = false;
    async function init() {
      await Promise.all([loadCourses(), loadTagVocabulary()]);
      if (!canceledFlag) setIsInitialLoading(false);
    }
    void init();
    return () => {
      canceledFlag = true;
    };
    // initial mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isInitialLoading) return;
    // An unresolved identity must not be queried: if the probe ends up dropping
    // the course, the request would have been for a filter the URL no longer
    // carries.
    if (courseResolving || courseProbeFailed) return;
    void loadQuestions();
  }, [loadQuestions, isInitialLoading, courseResolving, courseProbeFailed]);

  // The current loader, for refetches that outlive the render they started in
  // (a delete's confirmation lands after the user may have moved on).
  const loadQuestionsRef = useRef(loadQuestions);
  useEffect(() => {
    loadQuestionsRef.current = loadQuestions;
  }, [loadQuestions]);

  async function handleDelete(id: string) {
    try {
      await api.delete(`/api/questions/${id}`);
      // A deleted question may have been the last user of a tag — refresh
      // the vocabulary so the filter never offers stale options.
      //
      // The list refetch goes through the ref: the delete resolves into the
      // query the user is on NOW, not the one that was rendered when they
      // clicked. The render-time closure would issue a request for an obsolete
      // key, and the generation guard would then discard the current query's
      // own response — leaving the URL on one query and the body on another.
      await Promise.all([loadQuestionsRef.current(), loadTagVocabulary()]);
    } catch {
      toast.error(t("admin.questions.toast.deleteFailed"));
    }
  }

  /** Applies a filter patch and returns to page 1 (a filter change is a new query). */
  function commitFilters(patch: {
    courseId?: string;
    type?: string;
    difficulty?: string;
    tags?: string[];
    search?: string;
  }) {
    const next = baseParams();
    if (patch.courseId !== undefined) {
      if (patch.courseId === "") next.delete("courseId");
      else next.set("courseId", patch.courseId);
    }
    if (patch.type !== undefined) {
      if (patch.type === "") next.delete("type");
      else next.set("type", patch.type);
    }
    if (patch.difficulty !== undefined) {
      if (patch.difficulty === "") next.delete("difficulty");
      else next.set("difficulty", patch.difficulty);
    }
    if (patch.tags !== undefined) {
      if (patch.tags.length === 0) next.delete("tags");
      else next.set("tags", normalizeTags(patch.tags.join(",")).join(","));
    }
    if (patch.search !== undefined) {
      const term = patch.search.trim();
      if (term === "") next.delete("search");
      else next.set("search", term);
    }
    next.delete("page");
    // The user is issuing a new query; a recovery window that belonged to the
    // previous navigation must not keep the list pending.
    setClamping(false);
    writeParams(next);
  }

  function clearFilters() {
    setSearchInput("");
    lastCommittedSearch.current = "";
    setClamping(false);
    writeParams(new URLSearchParams());
  }

  function handlePageChange(nextPage: number) {
    if (nextPage === page) return;
    setClamping(false);
    const next = baseParams();
    writePageParam(next, nextPage);
    // Page changes PUSH: Back walks the pages the user actually visited.
    writeParams(next, { push: true });
  }

  // Immediate input change: update ONLY the displayed value. No server query —
  // the request key is derived from the URL, so typing never fires a request.
  function handleSearchChange(term: string) {
    setSearchInput(term);
  }

  // Debounced commit: the settled term becomes the queried one and the page
  // returns to 1. This is the only path that commits `search`.
  function handleSearchCommit(term: string) {
    // INVARIANT: a draft may only commit on the history entry it was typed on.
    // The deadline can expire between a committed external navigation and the
    // cancel chain flushing; committing then would write the departed draft
    // onto the entry the user navigated TO (URL, reload query and all). The
    // live entry key is the synchronous authority here — reject the draft at
    // this boundary unless the page is still on the entry it last observed or
    // wrote. Page-authored writes never trip this: writeParams re-observes the
    // key in the same synchronous block.
    if (history.location.key !== observedEntryKey.current) return;
    commitFilters({ search: term });
  }

  const hasActiveFilter =
    queryState.courseId !== "" ||
    filterType !== "" ||
    filterDifficulty !== "" ||
    tags.length > 0 ||
    search !== "";

  // A failure belongs to exactly one request: `reqKey` says which. A failure of
  // the CURRENT request key is this query's; anything else is already superseded.
  const failed =
    loadState.status === "failed" && loadState.reqKey === requestKey;
  // Same-identity failures (a page turn within the loaded filter) keep the
  // shell and render the existing body error row. Cross-identity failures have
  // no rows to show — the old identity's rows must not survive the change — so
  // they take over the page.
  const sameIdentityFailure =
    failed && loadState.idKey !== null && loadState.idKey === renderKey;
  const loadFailedMessage = failed ? t("admin.common.loadFailed") : null;
  const pending =
    !failed && (loadState.idKey !== renderKey || clamping || courseResolving);
  const isTableLoading =
    !failed && (loadState.reqKey !== requestKey || courseResolving);
  const isEmpty = !isTableLoading && questions.length === 0;

  // Re-measure after every settled render. While pending the rows are gone, so
  // the last measurement is the one to reserve — that is what keeps the region
  // from collapsing for the duration of the request.
  useEffect(() => {
    if (pending) return;
    const box = listBoxRef.current;
    if (box) setReservedListHeight(box.offsetHeight);
  }, [pending, questions, total]);

  if (isInitialLoading) return <LoadingState />;
  if (courseProbeFailed)
    return (
      <ErrorState
        message={t("admin.questions.courseResolveFailed")}
        onRetry={() => {
          setCourseProbeFailedId(null);
          setCourseProbeAttempt((attempt) => attempt + 1);
        }}
      />
    );
  if (loadFailedMessage && !sameIdentityFailure)
    return (
      <ErrorState
        message={loadFailedMessage}
        onRetry={() => {
          // Retry is a new attempt, not a re-render of the failure: releasing
          // the failed key puts the page back into its in-flight state so the
          // user sees the request they just asked for.
          setLoadState((prev) => ({
            idKey: prev.idKey,
            reqKey: null,
            status: "loaded",
          }));
          void loadQuestionsRef.current();
        }}
      />
    );

  const columns: DataViewColumnDef<QuestionRow>[] = [
    {
      id: "type",
      meta: { role: "type", priority: "high" },
      header: t("admin.questions.columns.type" as never),
      cell: ({ row }) => (
        <Badge variant={TYPE_VARIANT[row.original.type] ?? "default"}>
          {getTypeLabel(row.original.type, t) ?? row.original.type}
        </Badge>
      ),
    },
    {
      id: "content",
      meta: { role: "long-text", overflow: "truncate", priority: "high" },
      header: t("admin.questions.columns.content" as never),
      cell: ({ row }) => (
        <DataTableOverflowText mode="truncate" value={row.original.content} />
      ),
    },
    {
      id: "course",
      meta: { role: "secondary-text" },
      header: t("admin.questions.columns.course" as never),
      cell: ({ row }) => courseMap.get(row.original.courseId) ?? "-",
    },
    {
      id: "score",
      // priority "normal": the card shows score as a labeled meta line, not a
      // bare header-cluster value (issue 457 audit; role "score" defaults high).
      meta: { role: "score", priority: "normal" },
      header: t("admin.questions.columns.score" as never),
      cell: ({ row }) => row.original.score,
    },
    {
      id: "difficulty",
      meta: { role: "number" },
      header: t("admin.questions.columns.difficulty" as never),
      cell: ({ row }) => row.original.difficulty,
    },
    {
      id: "tags",
      meta: { role: "tag-list" },
      header: t("admin.questions.columns.tags" as never),
      cell: ({ row }) => {
        const rowTags = row.original.tags;
        const maxVisible = 3;
        const visible = rowTags.slice(0, maxVisible);
        const overflow = rowTags.length - visible.length;
        return (
          <div
            className="flex flex-wrap gap-1"
            title={rowTags.length > 0 ? rowTags.join(", ") : undefined}
          >
            {visible.map((tag) => (
              <TagBadge key={tag} variant="compact-table">
                {tag}
              </TagBadge>
            ))}
            {overflow > 0 && (
              <span
                data-slot="tag-overflow"
                aria-label={t("common.moreTags", { count: overflow })}
              >
                +{overflow}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "actions",
      meta: { role: "actions" },
      header: t("admin.questions.columns.actions" as never),
      cell: ({ row }) => (
        <RowActions
          row={row.original}
          actions={[
            {
              id: "edit",
              label: t("admin.questions.editLabel" as never),
              icon: Pencil,
              onSelect: () =>
                void navigate(`/admin/questions/${row.original.id}/edit`, {
                  state: listReturnState(location),
                }),
            },
            {
              id: "delete",
              label: t("admin.questions.deleteLabel" as never),
              icon: Trash2,
              tone: "destructive",
              confirm: {
                title: t("admin.questions.confirmDelete" as never),
                description: t(
                  "admin.questions.confirmDeleteDescription" as never,
                ),
                destructive: true,
              },
              onSelect: () => void handleDelete(row.original.id),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <PageContainer role="admin-dense" className="flex flex-col gap-6">
      <PageHeader
        title={t("admin.questions.title" as never)}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                void navigate("/admin/questions/import", {
                  state: listReturnState(location),
                })
              }
            >
              <AppIcon icon={FileUp} size="inline" />
              {t("admin.questions.importBtn" as never)}
            </Button>
            <Button
              onClick={() =>
                void navigate("/admin/questions/new", {
                  state: listReturnState(location),
                })
              }
            >
              <AppIcon icon={Plus} size="inline" />
              {t("admin.questions.createBtn" as never)}
            </Button>
          </div>
        }
      />

      <DataWorkbench
        toolbar={
          <DataWorkbenchToolbar>
            <DataToolbar
              aria-label={t("admin.questions.filterToolbar" as never)}
              search={
                <DataViewSearch
                  aria-label={t("admin.questions.searchLabel" as never)}
                  placeholder={t("admin.questions.searchPlaceholder" as never)}
                  value={searchInput}
                  onChange={handleSearchChange}
                  onSearch={handleSearchCommit}
                  loading={isTableLoading}
                />
              }
              actions={
                <>
                  {/* Loading indicator: always rendered so its show/hide does
                      not reflow the actions cluster (which would shift the
                      search box position in the toolbar). Visibility toggles. */}
                  <span
                    className={`inline-flex min-w-[5.5rem] items-center gap-2 type-secondary ${
                      isTableLoading ? "visible" : "invisible"
                    }`}
                    aria-live="polite"
                    aria-hidden={!isTableLoading}
                  >
                    <AppIcon
                      icon={LoaderCircle}
                      size="inline"
                      className="animate-spin"
                    />
                    {t("common.loading" as never)}
                  </span>
                  {hasActiveFilter && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearFilters}
                      aria-label={t("admin.common.clearFilter" as never)}
                    >
                      <AppIcon icon={RotateCcw} size="inline" />
                      {t("admin.questions.clearFilter" as never)}
                    </Button>
                  )}
                </>
              }
            >
              <Select
                value={queryState.courseId === "" ? ALL : queryState.courseId}
                onValueChange={(value) =>
                  commitFilters({ courseId: value === ALL ? "" : value })
                }
              >
                <ToolbarFilter size="wide">
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t("admin.questions.filterCourse" as never)}
                    />
                  </SelectTrigger>
                </ToolbarFilter>
                <SelectContent>
                  <SelectItem value={ALL}>
                    {t("admin.questions.filterAllCourses" as never)}
                  </SelectItem>
                  {courseOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filterType === "" ? ALL : filterType}
                onValueChange={(value) =>
                  commitFilters({ type: value === ALL ? "" : value })
                }
              >
                <ToolbarFilter size="narrow">
                  <SelectTrigger
                    aria-label={t("admin.questions.filterType" as never)}
                  >
                    <SelectValue
                      placeholder={t("admin.questions.filterType" as never)}
                    />
                  </SelectTrigger>
                </ToolbarFilter>
                <SelectContent>
                  <SelectItem value={ALL}>
                    {t("admin.questions.filterAllTypes" as never)}
                  </SelectItem>
                  <SelectItem value="single_choice">
                    {t("admin.questions.questionTypes.single_choice" as never)}
                  </SelectItem>
                  <SelectItem value="multiple_choice">
                    {t(
                      "admin.questions.questionTypes.multiple_choice" as never,
                    )}
                  </SelectItem>
                  <SelectItem value="fill_blank">
                    {t("admin.questions.questionTypes.fill_blank" as never)}
                  </SelectItem>
                  <SelectItem value="true_false">
                    {t("admin.questions.questionTypes.true_false" as never)}
                  </SelectItem>
                  <SelectItem value="text_response">
                    {t("admin.questions.questionTypes.text_response" as never)}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filterDifficulty === "" ? ALL : filterDifficulty}
                onValueChange={(value) =>
                  commitFilters({ difficulty: value === ALL ? "" : value })
                }
              >
                <ToolbarFilter size="narrow">
                  <SelectTrigger
                    aria-label={t("admin.questions.filterDifficulty" as never)}
                  >
                    <SelectValue
                      placeholder={t(
                        "admin.questions.filterDifficulty" as never,
                      )}
                    />
                  </SelectTrigger>
                </ToolbarFilter>
                <SelectContent>
                  <SelectItem value={ALL}>
                    {t("admin.questions.filterAllDifficulties" as never)}
                  </SelectItem>
                  {DIFFICULTY_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t("admin.questions.difficultyLabel" as never, {
                        value: Number(value),
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <ToolbarFilter size="wide">
                <TagFilterSelect
                  tags={tagVocabulary}
                  selected={tags}
                  onChange={(next) => commitFilters({ tags: next })}
                  aria-label={t("admin.questions.tagFilterLabel" as never)}
                />
              </ToolbarFilter>
            </DataToolbar>
          </DataWorkbenchToolbar>
        }
        footer={
          pending ? (
            <DataViewFooter
              variant="continuous"
              summary={t("common.table.pendingSummary" as never)}
              navigation={
                <DataTablePagination
                  page={1}
                  pageSize={PAGE_SIZE}
                  total={0}
                  onPageChange={handlePageChange}
                />
              }
            />
          ) : (
            <DataViewFooter
              variant="continuous"
              range={{ page, pageSize: PAGE_SIZE, total }}
              navigation={
                <DataTablePagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={total}
                  onPageChange={handlePageChange}
                />
              }
            />
          )
        }
        desktopTable={
          <div
            ref={listBoxRef}
            // Reserve the settled height while pending: the body shows the
            // table's short placeholder (the previous identity's rows are not
            // this query's result), and without the reservation the list region
            // collapses for the whole request.
            style={
              pending && reservedListHeight !== null
                ? { minHeight: reservedListHeight }
                : undefined
            }
          >
            <DesktopDataTable
              columns={columns}
              data={pending ? [] : questions}
              rowCount={total}
              page={page}
              pageSize={PAGE_SIZE}
              getRowId={(q) => q.id}
              loading={isTableLoading}
              empty={isEmpty}
              error={sameIdentityFailure ? loadFailedMessage : null}
              emptyTitle={
                hasActiveFilter
                  ? t("admin.questions.noMatch" as never)
                  : t("admin.questions.empty" as never)
              }
              emptyDescription={
                hasActiveFilter
                  ? t("admin.questions.noMatchDescription" as never)
                  : t("admin.questions.emptyDescription" as never)
              }
            />
          </div>
        }
        mobileList={
          pending ? (
            <LoadingState />
          ) : (
            <MobileRecordList
              columns={columns}
              rows={questions}
              getRowId={(q) => q.id}
              loading={isTableLoading}
              empty={isEmpty}
              error={sameIdentityFailure ? loadFailedMessage : null}
              emptyTitle={
                hasActiveFilter
                  ? t("admin.questions.noMatch" as never)
                  : t("admin.questions.empty" as never)
              }
              emptyDescription={
                hasActiveFilter
                  ? t("admin.questions.noMatchDescription" as never)
                  : t("admin.questions.emptyDescription" as never)
              }
            />
          )
        }
      />
    </PageContainer>
  );
}
