import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
} from "@/components/ui/command";
import { useDataViewTextCommit } from "@/hooks/useDataViewTextCommit";
import { Check, ChevronDown } from "lucide-react";
import { AppIcon } from "@/components/shared/AppIcon";

/** A single course row from the API. */
interface CourseRow {
  id: string;
  name: string;
  code: string;
}

/** Course list response shape (the route returns total/totalPages too). */
interface CourseListResponse {
  items: CourseRow[];
  total: number;
  totalPages: number;
}

/** Props for the CourseSearchSelect component. */
interface CourseSearchSelectProps {
  courses: CourseRow[];
  value: string;
  onChange: (courseId: string) => void;
  placeholder?: string;
}

/** The contract caps pageSize at 100 (PaginationParamsSchema.max(100)). */
const SEARCH_PAGE_SIZE = 100;

/**
 * A searchable course selector that combines a local list (initial load) with
 * remote search (GET /api/courses?search=...). In edit mode, if the selected
 * courseId is not in the local list, QuestionEditPage fetches it separately.
 *
 * The text-commit choreography (draft → debounce → clear) is owned once by
 * `hooks/useDataViewTextCommit` (docs/standards/ui-system.md §Toolbar filters);
 * this component owns only what a committed term MEANS: the remote query and
 * its query ownership. Unlike the toolbar search, blur and Enter do NOT flush
 * the pending commit — Enter activates the highlighted option (owned by cmdk)
 * and blur inside the popover is not a commit action.
 *
 * INVARIANT: only the most recently issued query (latest seq) may update
 * results, truncation, loading, or failure fallback. Typing a new term,
 * clearing, closing, selecting, and an initial-list (scope) change all
 * invalidate in-flight queries immediately, and a scope change also cancels a
 * pending debounced commit, so neither a stale response nor a stale term can
 * land inside a newer scope or query.
 *
 * The server decides hits and their order: with `shouldFilter={false}` cmdk
 * renders the results verbatim (no client-side literal matching) and owns the
 * combobox keyboard interaction (active item, Arrow/Home/End navigation,
 * Enter-to-select, IME composition guard, scrolling, and the
 * input/listbox/option ARIA wiring). The form value is written only on an
 * explicit selection (click or Enter).
 */
export function CourseSearchSelect({
  courses: initialCourses,
  value,
  onChange,
  placeholder,
}: CourseSearchSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CourseRow[]>(initialCourses);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<CourseRow | null>(null);
  // Query ownership token: see the INVARIANT in the component docstring.
  const searchSeq = useRef(0);

  // Derive the selected course label: prefer the cached selected course (which
  // may come from a remote search), then fall back to initialCourses.
  const selectedLabel =
    selectedCourse?.id === value
      ? selectedCourse.name
      : (initialCourses.find((c) => c.id === value)?.name ?? "");

  /** Fetch courses matching the search term; see the ownership INVARIANT. */
  const doSearch = useCallback(
    async (term: string) => {
      const seq = ++searchSeq.current;
      if (!term.trim()) {
        setResults(initialCourses);
        setTruncated(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await api.get<CourseListResponse>(
          `/api/courses?search=${encodeURIComponent(term.trim())}&pageSize=${SEARCH_PAGE_SIZE}`,
        );
        if (seq !== searchSeq.current) return;
        setResults(res.items);
        // The contract caps a page at SEARCH_PAGE_SIZE; if more matched, the
        // rest are unreachable through this control. Surface it rather than
        // silently hiding courses beyond the cap.
        setTruncated(res.total > res.items.length);
      } catch {
        if (seq !== searchSeq.current) return;
        // Fall back to the initial list on network error.
        setResults(initialCourses);
        setTruncated(false);
      } finally {
        if (seq === searchSeq.current) setLoading(false);
      }
    },
    [initialCourses],
  );

  const commit = useDataViewTextCommit({
    value: search,
    onChange: setSearch,
    onCommit: doSearch,
  });

  // A new initial list is a scope change (e.g. the edit page finishing its
  // course load): a term typed against the old list must never be sent, and
  // searches already issued under it must never land. clear() is the same
  // reset path as close/select: it cancels a pending debounced commit and
  // commits "" through doSearch, which bumps the seq token and repopulates
  // results/truncation/loading from the new initialCourses (an invalidated
  // response skips its own finally cleanup, so loading must not wait on it).
  // doSearch is rebuilt whenever initialCourses changes, so commit.clear
  // changes with the scope; keying on it runs exactly on a scope change
  // (and mount), never on a keystroke.
  useEffect(() => {
    commit.clear();
  }, [initialCourses, commit.clear]);

  /** Close and restore the pre-search state. commit.clear() cancels a pending
   * debounced commit and, via doSearch(""), invalidates in-flight queries. */
  const closeAndReset = useCallback(() => {
    commit.clear();
    setOpen(false);
  }, [commit]);

  /** Select a course, cache it for label display, and close. */
  const selectCourse = useCallback(
    (course: CourseRow) => {
      setSelectedCourse(course);
      onChange(course.id);
      commit.clear();
      setOpen(false);
    },
    [onChange, commit],
  );

  /** Route input through the shared commit owner. An empty term is a
   * deliberate clear: it commits "" immediately (no debounce wait). A
   * non-empty term schedules the debounced commit AND invalidates in-flight
   * queries right away, so an older response can never land inside this
   * term's debounce window. */
  const handleSearchChange = useCallback(
    (term: string) => {
      if (!term.trim()) {
        commit.clear();
        return;
      }
      searchSeq.current += 1;
      commit.change(term);
    },
    [commit],
  );

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeAndReset();
        else setOpen(true);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={t("admin.forms.question.course")}
          className="w-full justify-between font-normal"
        >
          {selectedLabel ||
            placeholder ||
            t("admin.forms.question.coursePlaceholder")}
          <AppIcon
            icon={ChevronDown}
            size="inline"
            className="ml-2 shrink-0 opacity-50"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        onEscapeKeyDown={(e) => {
          // Escape during an IME composition cancels the candidate panel —
          // the key belongs to the IME, so keep the popover open (Radix hands
          // the native KeyboardEvent here). cmdk applies the same guard to
          // its own navigation keys.
          if (e.isComposing || e.keyCode === 229) {
            e.preventDefault();
          }
        }}
      >
        <Command shouldFilter={false} label={t("admin.forms.question.course")}>
          <CommandInput
            value={search}
            onValueChange={handleSearchChange}
            placeholder={t("admin.forms.question.courseSearchPlaceholder")}
          />
          <CommandList label={t("admin.forms.question.course")}>
            {loading && results.length === 0 && (
              <div className="py-6 text-center type-secondary">
                {t("admin.forms.question.courseSearching")}
              </div>
            )}
            {!loading && results.length === 0 && (
              <div className="py-6 text-center type-secondary">
                {t("admin.forms.question.courseNoResults")}
              </div>
            )}
            {results.map((c) => {
              const isSelected = c.id === value;
              return (
                <CommandItem
                  key={c.id}
                  value={c.id}
                  onSelect={() => selectCourse(c)}
                  className="cursor-pointer px-3 py-2"
                >
                  <AppIcon
                    icon={Check}
                    size="inline"
                    className={isSelected ? "opacity-100" : "opacity-0"}
                  />
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="type-metadata">{c.code}</span>
                </CommandItem>
              );
            })}
          </CommandList>
          {truncated && (
            <div role="status" className="border-t px-3 py-2 type-metadata">
              {t("admin.forms.question.courseTruncatedHint")}
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
