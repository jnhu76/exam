import { Bell } from "lucide-react";
import { AdminIconButton } from "@/components/admin";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const DEMO_NOTIFICATIONS = [
  { title: "考试已发布", description: "《期中考试》已发布", time: "2分钟前" },
  {
    title: "评分完成",
    description: "《单元测验》评分已完成",
    time: "10分钟前",
  },
  {
    title: "系统通知",
    description: "系统将于今晚 23:00 维护",
    time: "1小时前",
  },
];

export function NotificationBell() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div className="relative">
          <AdminIconButton aria-label="通知" size="icon-sm">
            <Bell className="size-4" />
          </AdminIconButton>
          <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-destructive text-[8px] font-bold text-destructive-foreground">
            3
          </span>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>通知</span>
          <span className="text-xs text-muted-foreground font-normal">
            演示数据
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {DEMO_NOTIFICATIONS.map((n, i) => (
          <DropdownMenuItem
            key={i}
            className="flex flex-col items-start gap-0.5 py-2"
          >
            <span className="text-sm font-medium">{n.title}</span>
            <span className="text-xs text-muted-foreground">
              {n.description}
            </span>
            <span className="text-[10px] text-muted-foreground">{n.time}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled
          className="justify-center text-xs text-muted-foreground"
        >
          暂无更多通知
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
