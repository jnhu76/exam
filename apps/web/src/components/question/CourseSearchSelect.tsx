import { useState, useRef, useCallback, useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useDataViewTextCommit } from "@/hooks/useDataViewTextCommit";
import { Check, ChevronDown, Search } from "lucide-react";
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
 * the pending commit — Enter activates the highlighted option and blur inside
 * the popover is not a commit action.
 *
 * INVARIANT: only the most recently issued query (latest seq) may update
 * results, truncation, loading, or failure fallback. Typing a new term,
 * clearing, closing, selecting, and an initial-list (scope) change all
 * invalidate in-flight queries immediately, and a scope change also cancels a
 * pending debounced commit, so neither a stale response nor a stale term can
 * land inside a newer scope or query.
 *
 * Keyboard interaction follows the WAI-ARIA combobox/listbox pattern:
 * ArrowDown/ArrowUp move the active option, Home/End jump to first/last,
 * Enter selects, Escape closes without selecting. Keys while an IME
 * composition is active belong to the IME and never reach navigation.
 */
export function CourseSearchSelect({
  courses: initialCourses,
  value,
  onChange,
  placeholder,
}: CourseSearchSelectProps) {
  const { t } = useTranslation();
  const generatedId = useId();
  const listboxId = `course-search-listbox-${generatedId}`;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CourseRow[]>(initialCourses);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [selectedCourse, setSelectedCourse] = useState<CourseRow | null>(null);
  const focusTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Query ownership token: see the INVARIANT in the component docstring.
  const searchSeq = useRef(0);

  // The commit hook cancels its own timer on unmount; only the popover focus
  // delay needs manual teardown.
  useEffect(() => {
    return () => {
      if (focusTimeout.current) clearTimeout(focusTimeout.current);
    };
  }, []);

  // Derive the selected course label: prefer the cached selected course (which
  // may come from a remote search), then fall back to initialCourses.
  const selectedLabel =
    selectedCourse?.id === value
      ? selectedCourse.name
      : (initialCourses.find((c) => c.id === value)?.name ?? "");

  // Reset the active index when the result set changes, the popover opens or
  // closes, or a new value is selected.
  useEffect(() => {
    setActiveIndex(-1);
  }, [results, open, value]);

  // Scroll the active option into view when it changes.
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const el = listRef.current.querySelector(
        `[data-active="true"]`,
      ) as HTMLElement | null;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

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
    setActiveIndex(-1);
    setOpen(false);
  }, [commit]);

  /** Select a course, cache it for label display, and close. */
  const selectCourse = useCallback(
    (course: CourseRow) => {
      setSelectedCourse(course);
      onChange(course.id);
      commit.clear();
      setActiveIndex(-1);
      setOpen(false);
    },
    [onChange, commit],
  );

  /** Move the active index clamped to [0, results.length). */
  const moveActive = useCallback(
    (delta: number) => {
      setActiveIndex((prev) => {
        const next = prev + delta;
        return Math.max(0, Math.min(next, results.length - 1));
      });
    },
    [results.length],
  );

  /** Route input through the shared commit owner. An empty term is a
   * deliberate clear: it commits "" immediately (no debounce wait). A
   * non-empty term schedules the debounced commit AND invalidates in-flight
   * queries right away, so an older response can never land inside this
   * term's debounce window. */
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const term = e.target.value;
      if (!term.trim()) {
        commit.clear();
        return;
      }
      searchSeq.current += 1;
      commit.change(term);
    },
    [commit],
  );

  // Focus the search input when the popover opens.
  useEffect(() => {
    if (open && inputRef.current) {
      // Small delay to let the popover animation complete.
      focusTimeout.current = setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  /** Handle keyboard events on the search input (combobox). */
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // IME composition: Enter confirms the composition and Escape cancels it
      // — these keys belong to the IME, not to list navigation. keyCode 229
      // is the legacy composition marker.
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      if (!open) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          moveActive(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          moveActive(-1);
          break;
        case "Home":
          e.preventDefault();
          setActiveIndex(results.length > 0 ? 0 : -1);
          break;
        case "End":
          e.preventDefault();
          setActiveIndex(results.length > 0 ? results.length - 1 : -1);
          break;
        case "Enter": {
          e.preventDefault();
          const active = results[activeIndex];
          if (active) selectCourse(active);
          break;
        }
        case "Escape":
          e.preventDefault();
          closeAndReset();
          break;
      }
    },
    [open, activeIndex, results, moveActive, selectCourse, closeAndReset],
  );

  function optionId(courseId: string) {
    return `${listboxId}-option-${courseId}`;
  }

  const activeDescendant =
    activeIndex >= 0 && activeIndex < results.length
      ? optionId(results[activeIndex]!.id)
      : undefined;

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
      >
        <div className="flex items-center border-b px-3">
          <AppIcon
            icon={Search}
            size="inline"
            className="mr-2 shrink-0 opacity-50"
          />
          <Input
            ref={inputRef}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={activeDescendant}
            value={search}
            onChange={handleSearchChange}
            onKeyDown={handleInputKeyDown}
            placeholder={t("admin.forms.question.courseSearchPlaceholder")}
            className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={t("admin.forms.question.course")}
          className="max-h-[300px] overflow-y-auto"
        >
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
          {results.map((c, i) => {
            const isActive = i === activeIndex;
            const isSelected = c.id === value;
            return (
              <div
                key={c.id}
                id={optionId(c.id)}
                role="option"
                aria-selected={isSelected}
                data-active={isActive}
                onClick={() => selectCourse(c)}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground aria-selected:bg-accent aria-selected:text-accent-foreground data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
              >
                <AppIcon
                  icon={Check}
                  size="inline"
                  className={isSelected ? "opacity-100" : "opacity-0"}
                />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="type-metadata">{c.code}</span>
              </div>
            );
          })}
        </div>
        {truncated && (
          <div role="status" className="border-t px-3 py-2 type-metadata">
            {t("admin.forms.question.courseTruncatedHint")}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
