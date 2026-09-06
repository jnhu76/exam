import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FileUpload } from "./FileUpload";

/** A single row in the import preview list, showing its status and message. */
export interface ImportPreviewRow {
  row: number;
  status: "create" | "update" | "error";
  message: string;
}

/**
 * Multi-step import dialog that accepts CSV text via file upload or paste,
 * shows a parsed preview with per-row status, and confirms the import action.
 */
export function ImportWizard({
  open,
  onOpenChange,
  title,
  instructions,
  csv,
  onCsvChange,
  preview,
  summary,
  warning,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  instructions: string;
  csv: string;
  onCsvChange: (csv: string) => void;
  preview: ImportPreviewRow[];
  summary?: string;
  warning?: string;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const hasErrors = preview.some((row) => row.status === "error");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{instructions}</DialogDescription>
        </DialogHeader>
        <div data-slot="dialog-body" className="flex flex-col gap-3">
          {warning && <p className="text-sm text-warning">{warning}</p>}
          <FileUpload onText={onCsvChange} />
          <Textarea
            rows={8}
            value={csv}
            onChange={(e) => onCsvChange(e.target.value)}
          />
          {preview.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-md border p-3 text-sm flex flex-col gap-0.5">
              {preview.map((row) => (
                <p
                  key={row.row}
                  className={
                    row.status === "error"
                      ? "text-destructive"
                      : row.status === "update"
                        ? "text-warning"
                        : "text-success"
                  }
                >
                  {t("admin.importWizard.rowPrefix", { row: row.row })}
                  {row.status === "create"
                    ? t("admin.importWizard.statusCreate")
                    : row.status === "update"
                      ? t("admin.importWizard.statusUpdate")
                      : t("admin.importWizard.statusError")}{" "}
                  - {row.message}
                </p>
              ))}
            </div>
          )}
          {summary && <p className="text-sm">{summary}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("admin.importWizard.close")}
          </Button>
          <Button
            disabled={preview.length === 0 || hasErrors}
            onClick={onConfirm}
          >
            {t("admin.importWizard.confirmImport")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
