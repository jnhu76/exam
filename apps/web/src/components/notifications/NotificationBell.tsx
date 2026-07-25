import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react";
import type { NotificationDTO, PaginatedResponse } from "@exam/contracts";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { InlineErrorBanner } from "@/components/shared/InlineErrorBanner";

// P5-N1-I3 — Candidate NotificationBell + panel (V1).
//
// Authority: P5-N1-R0 §20 (frozen UI surface: bell + small panel).
//
// Behavior:
//   - unread badge from /api/notifications/unread-count, refreshed on auth
//     app start + after every read operation + on a bounded poll interval
//   - panel lists result_published notifications (title/body/createdAt),
//     with loading (Skeleton) / empty / error (InlineErrorBanner) states
//   - click a notification: mark one read, refresh count, navigate to the
//     authoritative /exam/:attemptId/result page
//   - "mark all read" button calls /read-all and refreshes count
//   - NO WebSocket/SSE/browser push; bounded setInterval polling only
//     (mirrors ProctorDashboardPage.tsx)

/** Polling interval for the unread badge (ms). Bounded; not real-time. */
const POLL_INTERVAL_MS = 60_000;

/** Page size for the panel list. */
const PANEL_PAGE_SIZE = 20;

/** Response shape for GET /notifications. */
type NotificationListResponse = PaginatedResponse<NotificationDTO>;

/** Response shape for GET /notifications/unread-count. */
interface UnreadCountResponse {
  count: number;
}

/**
 * Bell icon + unread badge + popover panel for the candidate Inbox.
 *
 * Mounts in the ExamLayout header. Self-contained: owns its own polling,
 * list state, and read actions. Navigation delegates to react-router.
 */
export function NotificationBell() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [list, setList] = useState<NotificationDTO[]>([]);
  const [listTotal, setListTotal] = useState<number>(0);
  const [isLoadingList, setIsLoadingList] = useState<boolean>(false);
  const [listError, setListError] = useState<string | null>(null);
  const [open, setOpen] = useState<boolean>(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      const result = await api.get<UnreadCountResponse>(
        "/api/notifications/unread-count",
      );
      setUnreadCount(result.count);
    } catch {
      // Count failures are non-fatal: the badge silently stays at its last
      // value. The panel's own error state surfaces persistent failures.
    }
  }, []);

  const loadList = useCallback(async () => {
    setIsLoadingList(true);
    setListError(null);
    try {
      const result = await api.get<NotificationListResponse>(
        `/api/notifications?page=1&pageSize=${PANEL_PAGE_SIZE}`,
      );
      setList(result.items);
      setListTotal(result.total);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : t("notifications.errors.loadFailed");
      setListError(message);
    } finally {
      setIsLoadingList(false);
    }
  }, [t]);

  // Load unread count on mount + poll on a bounded interval.
  useEffect(() => {
    void refreshCount();
    intervalRef.current = setInterval(() => {
      void refreshCount();
    }, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshCount]);

  // Load the list when the panel opens.
  useEffect(() => {
    if (open) void loadList();
  }, [open, loadList]);

  const handleOpenNotification = useCallback(
    async (notification: NotificationDTO) => {
      // Mark one read (idempotent server-side; ignore errors so a transient
      // failure does not block navigation).
      try {
        await api.post(`/api/notifications/${notification.id}/read`);
      } catch {
        // Non-fatal: the user can still navigate; the row will be marked on
        // the next open.
      }
      // Optimistically decrement + refresh.
      setUnreadCount((c) => Math.max(0, c - 1));
      setList((items) =>
        items.map((n) =>
          n.id === notification.id
            ? { ...n, readAt: new Date().toISOString() }
            : n,
        ),
      );
      void refreshCount();
      // Navigate to the authoritative result page if actionable.
      if (notification.actionPath) {
        setOpen(false);
        navigate(notification.actionPath);
      }
    },
    [navigate, refreshCount],
  );

  const handleMarkAllRead = useCallback(async () => {
    try {
      await api.post("/api/notifications/read-all");
      setList((items) =>
        items.map((n) =>
          n.readAt ? n : { ...n, readAt: new Date().toISOString() },
        ),
      );
      setUnreadCount(0);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : t("notifications.errors.markAllFailed");
      setListError(message);
    }
  }, [t]);

  const hasUnread = unreadCount > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative"
          aria-label={t("notifications.bell")}
          data-testid="notification-bell"
        >
          <Bell className="size-4" />
          {hasUnread && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-4 min-w-4 px-1 text-[10px]"
              data-testid="notification-unread-badge"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0"
        data-testid="notification-panel"
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">
            {t("notifications.panelTitle")}
          </span>
          {hasUnread && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void handleMarkAllRead()}
              data-testid="notification-mark-all-read"
            >
              {t("notifications.markAllRead")}
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {isLoadingList ? (
            <div className="space-y-2 p-3" data-testid="notification-loading">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : listError ? (
            <div className="p-3">
              <InlineErrorBanner>{listError}</InlineErrorBanner>
            </div>
          ) : list.length === 0 ? (
            <div
              className="p-6 text-center text-sm text-muted-foreground"
              data-testid="notification-empty"
            >
              {t("notifications.empty")}
            </div>
          ) : (
            <ul className="divide-y" data-testid="notification-list">
              {list.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void handleOpenNotification(n)}
                    className="flex w-full flex-col items-start gap-1 px-3 py-2 text-left hover:bg-accent"
                    data-testid={`notification-item-${n.id}`}
                  >
                    <span
                      className={
                        n.readAt
                          ? "text-sm font-medium text-muted-foreground"
                          : "text-sm font-medium"
                      }
                    >
                      {n.title}
                    </span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {n.body}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
              {listTotal > list.length && (
                <li className="px-3 py-2 text-center text-xs text-muted-foreground">
                  {t("notifications.more", { count: listTotal - list.length })}
                </li>
              )}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
