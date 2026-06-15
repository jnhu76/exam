import type { ReactNode } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

type ConfirmActionDialogProps = {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
};

export function ConfirmActionDialog({
  trigger,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  destructive = false,
  disabled = false,
  onConfirm,
  onCancel,
}: ConfirmActionDialogProps) {
  return (
    <ConfirmDialog
      trigger={trigger}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      destructive={destructive}
      confirmDisabled={disabled}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
