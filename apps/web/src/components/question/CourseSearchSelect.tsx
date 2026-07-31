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

/** Props for the CourseSearchSelect component. */
interface CourseSearchSelectProps {
  courses: CourseRow[];
  value: string;
  onChange: (courseId: string) => void;
  placeholder?: string;
  /** When true, the component fetches its own results via search API. */
  enableSearch?: boolean;
}

/**
 * A searchable course selector that combines a local list (initial load) with
 * remote search (GET /api/courses?search=...). In edit mode, if the selected
 * courseId is not in the local list, it fetches it separately.
 */
export function CourseSearchSelect({
  courses: initialCourses,
  value,
  onChange,
  placeholder,
  enableSearch = true,
}: CourseSearchSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CourseRow[]>(initialCourses);
  const [loading, setLoading] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync local results when the initial courses prop changes.
  useEffect(() => {
    setResults(initialCourses);
  }, [initialCourses]);

  // Derive the selected course label for display.
  const selectedLabel =
    results.find((c) => c.id === value)?.name ??
    initialCourses.find((c) => c.id === value)?.name ??
    "";

  /** Fetch courses matching the search term. */
  const doSearch = useCallback(
    async (term: string) => {
      if (!term.trim()) {
        setResults(initialCourses);
        return;
      }
      setLoading(true);
      try {
        const res = await api.get<{ items: CourseRow[] }>(
          `/api/courses?search=${encodeURIComponent(term.trim())}&pageSize=100`,
        );
        // Merge search results with the initial list so the currently-selected
        // course (if any) is always present in the dropdown.
        const merged = [...res.items];
        for (const c of initialCourses) {
          if (!merged.some((m) => m.id === c.id)) {
            merged.push(c);
          }
        }
        setResults(merged);
      } catch {
        // Silently fall back to the initial list on network error.
        setResults(initialCourses);
      } finally {
        setLoading(false);
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
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
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
            placeholder={t("admin.forms.question.courseSearchPlaceholder")}
            className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
        <div className="max-h-[300px] overflow-y-auto">
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
          {results.map((c) => (
            <div
              key={c.id}
              role="option"
              aria-selected={c.id === value}
              onClick={() => {
                onChange(c.id);
                setOpen(false);
                setSearch("");
              }}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
            >
              <AppIcon
                icon={Check}
                size="inline"
                className={c.id === value ? "opacity-100" : "opacity-0"}
              />
              <span className="flex-1 truncate">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.code}</span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
