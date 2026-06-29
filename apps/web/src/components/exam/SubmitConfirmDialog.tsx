import { useTranslation } from "react-i18next";
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

/** Props for the SubmitConfirmDialog component. */
type SubmitConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  totalCount: number;
  answeredCount: number;
  flaggedCount?: number;
  confirmDisabled?: boolean;
};

/**
 * Confirmation dialog shown before exam submission, displaying answer
 * statistics (total, answered, unanswered, flagged) and requiring explicit confirm.
 */
export function SubmitConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  totalCount,
  answeredCount,
  flaggedCount = 0,
  confirmDisabled = false,
}: SubmitConfirmDialogProps) {
  const { t } = useTranslation();
  const unansweredCount = Math.max(totalCount - answeredCount, 0);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("candidateRuntime.submitDialog.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("candidateRuntime.submitDialog.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              {t("candidateRuntime.submitDialog.totalCount")}
            </span>
            <span className="font-medium">{totalCount}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              {t("candidateRuntime.navigator.answered")}
            </span>
            <span className="font-medium">{answeredCount}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              {t("candidateRuntime.navigator.unanswered")}
            </span>
            <span className="font-medium">{unansweredCount}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              {t("candidateRuntime.navigator.flagged")}
            </span>
            <span className="font-medium">{flaggedCount}</span>
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>
            {t("candidateRuntime.submitDialog.continueAnswering")}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={confirmDisabled}>
            {t("candidateRuntime.submitDialog.confirmSubmit")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
