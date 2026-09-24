import { api } from "./api";

/** Minimal question facts the exam question pickers need (API DTO subset). */
export interface PickerQuestion {
  id: string;
  type: string;
  content: string;
  score: number;
}

interface PaginatedQuestions {
  items: PickerQuestion[];
  totalPages: number;
}

/**
 * Every selectable question, across ALL pages. The list endpoint caps
 * pageSize at 100 and orders oldest-first, so any single request silently
 * hides newer questions — the exam edit page once rendered an empty
 * selected-questions panel for any question past the first (default-sized)
 * page because it fetched the bare list.
 */
export async function fetchAllPickerQuestions(): Promise<PickerQuestion[]> {
  const first = await api.get<PaginatedQuestions>(
    "/api/questions?page=1&pageSize=100",
  );
  const rest = await Promise.all(
    Array.from({ length: Math.max(1, first.totalPages) - 1 }, (_, i) =>
      api.get<PaginatedQuestions>(`/api/questions?page=${i + 2}&pageSize=100`),
    ),
  );
  return [...first.items, ...rest.flatMap((r) => r.items)];
}
