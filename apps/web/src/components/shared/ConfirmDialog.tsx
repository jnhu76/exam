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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * Generic confirmation dialog built on AlertDialog, with a trigger element,
 * title, description, and customizable confirm/cancel labels and styling.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const resolvedConfirmLabel = confirmLabel ?? t("common.confirm");
  const resolvedCancelLabel = cancelLabel ?? t("common.cancel");
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>
            {resolvedCancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              type="button"
              variant={destructive ? "destructive" : "default"}
              data-variant={destructive ? "destructive" : "default"}
              disabled={confirmDisabled}
              onClick={onConfirm}
            >
              {resolvedConfirmLabel}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
