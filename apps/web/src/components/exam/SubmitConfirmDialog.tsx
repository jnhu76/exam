import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type SubmitConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  totalCount: number;
  answeredCount: number;
  flaggedCount?: number;
  confirmDisabled?: boolean;
};

export function SubmitConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  totalCount,
  answeredCount,
  flaggedCount = 0,
  confirmDisabled = false,
}: SubmitConfirmDialogProps) {
  const unansweredCount = Math.max(totalCount - answeredCount, 0);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认交卷</AlertDialogTitle>
          <AlertDialogDescription>
            交卷后将不能继续修改答案，请确认当前作答情况。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">题目总数</span>
            <span className="font-medium">{totalCount}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">已作答</span>
            <span className="font-medium">{answeredCount}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">未作答</span>
            <span className="font-medium">{unansweredCount}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">已标记</span>
            <span className="font-medium">{flaggedCount}</span>
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>继续作答</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={confirmDisabled}>
            确认交卷
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
