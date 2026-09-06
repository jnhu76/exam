import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AppIcon } from "@/components/shared/AppIcon";

/** Props for TagFilterSelect. */
type TagFilterSelectProps = {
  /** Complete tag vocabulary offered for selection. */
  tags: string[];
  /** Currently selected tags. The server AND-combines multiple tags. */
  selected: string[];
  /** Called with the next selection after any toggle or clear. */
  onChange: (next: string[]) => void;
  /** Accessible name for the trigger button. */
  "aria-label"?: string;
};

/**
 * Structured multi-select tag filter (issue 182).
 *
 * Replaces the former free-text tag Input so the page's only free-text
 * search is the main content search. The vocabulary comes from
 * GET /api/questions/tags (org-scoped, distinct) — never derived from the
 * paginated list rows. Multiple selected tags keep the server's AND
 * semantics; the panel footer states this so the behavior is not a guess.
 *
 * The trigger fills its container (the toolbar-scoped semantic tier owns the
 * width — see ToolbarFilter) and shows a "+N" overflow instead of every
 * selected tag, so changing the selection cannot shift toolbar layout.
 */
export function TagFilterSelect({
  tags,
  selected,
  onChange,
  ...aria
}: TagFilterSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((tag) => tag.toLowerCase().includes(q));
  }, [tags, query]);

  function toggle(tag: string) {
    onChange(
      selected.includes(tag)
        ? selected.filter((s) => s !== tag)
        : [...selected, tag],
    );
  }

  const triggerLabel =
    selected.length === 0
      ? t("admin.questions.tagFilterPlaceholder" as never)
      : selected.length === 1
        ? selected[0]
        : `${selected[0]} +${selected.length - 1}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-full max-w-full justify-between gap-1 font-normal"
          data-slot="tag-filter-trigger"
          {...aria}
        >
          <span className="truncate" data-slot="tag-filter-value">
            {triggerLabel}
          </span>
          <AppIcon icon={ChevronsUpDown} size="inline" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-0"
        aria-label={t("admin.questions.tagFilterLabel" as never)}
      >
        <div className="border-b p-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(
              "admin.questions.tagFilterSearchPlaceholder" as never,
            )}
            aria-label={t("admin.questions.tagFilterSearchLabel" as never)}
            className="h-8"
          />
        </div>
        <div
          data-slot="tag-filter-options"
          role="group"
          aria-label={t("admin.questions.tagFilterLabel" as never)}
          className="max-h-56 overflow-y-auto p-1"
        >
          {filtered.length === 0 ? (
            <p className="type-secondary px-2 py-3">
              {t("admin.questions.tagFilterEmpty" as never)}
            </p>
          ) : (
            filtered.map((tag) => (
              <label
                key={tag}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              >
                <Checkbox
                  checked={selected.includes(tag)}
                  onCheckedChange={() => toggle(tag)}
                />
                <span className="truncate">{tag}</span>
              </label>
            ))
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t p-2">
          <span className="type-secondary truncate">
            {t("admin.questions.tagFilterAndHint" as never)}
          </span>
          {selected.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange([])}
              data-slot="tag-filter-clear"
            >
              {t("admin.questions.tagFilterClear" as never)}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
