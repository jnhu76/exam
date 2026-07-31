import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
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

const LISTBOX_ID = "course-search-listbox";

function optionId(courseId: string) {
  return `course-option-${courseId}`;
}

/**
 * A searchable course selector that combines a local list (initial load) with
 * remote search (GET /api/courses?search=...). In edit mode, if the selected
 * courseId is not in the local list, QuestionEditPage fetches it separately.
 *
 * Keyboard interaction follows the WAI-ARIA combobox/listbox pattern:
 * ArrowDown/ArrowUp move the active option, Home/End jump to first/last,
 * Enter selects, Escape closes without selecting.
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
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const focusTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Request sequencing: only the latest search response may update state, so a
  // slow stale response cannot overwrite a newer one (race under fast typing).
  const searchSeq = useRef(0);

  // Sync local results when the initial courses prop changes.
  useEffect(() => {
    setResults(initialCourses);
  }, [initialCourses]);

  // Clear both pending timers on unmount so callbacks never run after teardown.
  useEffect(() => {
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
      if (focusTimeout.current) clearTimeout(focusTimeout.current);
    };
  }, []);

  // Derive the selected course label directly from initialCourses — independent
  // of the current results list, which no longer contains initialCourses by
  // default during a remote search.
  const selectedLabel = initialCourses.find((c) => c.id === value)?.name ?? "";

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

  /** Select a course, close the popover, and reset search state. */
  const selectCourse = useCallback(
    (courseId: string) => {
      onChange(courseId);
      setOpen(false);
      setSearch("");
    },
    [onChange],
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

  /** Fetch courses matching the search term. */
  const doSearch = useCallback(
    async (term: string) => {
      // Invalidate any older in-flight request before the early-return branch.
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
        if (seq !== searchSeq.current) return; // a newer search superseded this
        setResults(res.items);
        // The contract caps a page at SEARCH_PAGE_SIZE; if more matched, the
        // rest are unreachable through this control. Surface it rather than
        // silently hiding courses beyond the cap.
        setTruncated(res.total > res.items.length);
      } catch {
        if (seq !== searchSeq.current) return;
        // Silently fall back to the initial list on network error.
        setResults(initialCourses);
        setTruncated(false);
      } finally {
        if (seq === searchSeq.current) setLoading(false);
      }
    },
    [initialCourses],
  );

  /** Debounced search on input change. */
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const term = e.target.value;
      setSearch(term);
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
      // When the term is cleared, immediately invalidate any in-flight search
      // so a stale response cannot overwrite the restored initial state.
      if (!term.trim()) {
        searchSeq.current++;
      }
      searchTimeout.current = setTimeout(() => {
        doSearch(term);
      }, 300);
    },
    [doSearch],
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
          if (active) selectCourse(active.id);
          break;
        }
        case "Escape":
          e.preventDefault();
          setOpen(false);
          setSearch("");
          break;
      }
    },
    [open, activeIndex, results, moveActive, selectCourse],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-label={t("admin.forms.question.course")}
          aria-expanded={open}
          aria-controls={LISTBOX_ID}
          aria-activedescendant={
            activeIndex >= 0 && activeIndex < results.length
              ? optionId(results[activeIndex]!.id)
              : undefined
          }
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
            value={search}
            onChange={handleSearchChange}
            onKeyDown={handleInputKeyDown}
            placeholder={t("admin.forms.question.courseSearchPlaceholder")}
            className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
        <div
          ref={listRef}
          id={LISTBOX_ID}
          role="listbox"
          aria-label={t("admin.forms.question.course")}
          className="max-h-[300px] overflow-y-auto"
        >
          {loading && results.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {t("admin.forms.question.courseSearching")}
            </div>
          )}
          {!loading && results.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
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
                onClick={() => selectCourse(c.id)}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
              >
                <AppIcon
                  icon={Check}
                  size="inline"
                  className={isSelected ? "opacity-100" : "opacity-0"}
                />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-xs text-muted-foreground">{c.code}</span>
              </div>
            );
          })}
        </div>
        {truncated && (
          <div
            role="status"
            className="border-t px-3 py-2 text-xs text-muted-foreground"
          >
            {t("admin.forms.question.courseTruncatedHint")}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
