import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

/** Candidate data used in the enrollment picker list. */
export interface CandidateItem {
  id: string;
  userId: string;
  name: string;
  username: string;
  fields: Record<string, unknown>;
}

/** Props for the EnrollmentPicker component. */
interface EnrollmentPickerProps {
  candidates: CandidateItem[];
  enrolledCandidateIds: Set<string>;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
}

/**
 * Searchable, multi-select candidate picker for exam enrollment.
 * Filters by name/username, supports select-all, and marks already-enrolled candidates.
 */
export function EnrollmentPicker({
  candidates,
  enrolledCandidateIds,
  selectedIds,
  onSelectionChange,
  hasMore,
  onLoadMore,
  isLoadingMore,
}: EnrollmentPickerProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return candidates;
    const q = search.trim().toLowerCase();
    return candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.username.toLowerCase().includes(q),
    );
  }, [candidates, search]);

  const selectable = useMemo(
    () => filtered.filter((c) => !enrolledCandidateIds.has(c.id)),
    [filtered, enrolledCandidateIds],
  );

  const allSelected =
    selectable.length > 0 && selectable.every((c) => selectedIds.has(c.id));

  function handleToggleAll() {
    if (allSelected) {
      const keep = new Set(selectedIds);
      for (const c of selectable) {
        keep.delete(c.id);
      }
      onSelectionChange(keep);
    } else {
      const next = new Set(selectedIds);
      for (const c of selectable) {
        next.add(c.id);
      }
      onSelectionChange(next);
    }
  }

  function handleToggle(candidateId: string) {
    const next = new Set(selectedIds);
    if (next.has(candidateId)) {
      next.delete(candidateId);
    } else {
      next.add(candidateId);
    }
    onSelectionChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder={t("admin.enrollmentPicker.searchPlaceholder")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {filtered.length > 0 && (
        <label className="flex items-center gap-2 px-2 py-1 text-sm border-b">
          <Checkbox
            checked={allSelected}
            onCheckedChange={handleToggleAll}
            aria-label={t("admin.enrollmentPicker.selectAll")}
          />
          <span className="text-muted-foreground">
            {t("admin.enrollmentPicker.selectAll")}
          </span>
        </label>
      )}

      <div className="max-h-64 overflow-y-auto flex flex-col gap-1">
        {filtered.length === 0 ? (
          <p className="type-secondary py-4 text-center">
            {t("admin.enrollmentPicker.empty")}
          </p>
        ) : (
          filtered.map((candidate) => {
            const enrolled = enrolledCandidateIds.has(candidate.id);
            return (
              <label
                key={candidate.id}
                className="flex items-center gap-3 p-2 rounded-md hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={enrolled || selectedIds.has(candidate.id)}
                  disabled={enrolled}
                  onCheckedChange={() => handleToggle(candidate.id)}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {candidate.name}
                  </p>
                  <p className="type-metadata truncate">{candidate.username}</p>
                </div>
                {enrolled && (
                  <span className="type-metadata shrink-0">
                    {t("admin.enrollmentPicker.added")}
                  </span>
                )}
              </label>
            );
          })
        )}
      </div>

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore
              ? t("admin.enrollmentPicker.loading")
              : t("admin.enrollmentPicker.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
