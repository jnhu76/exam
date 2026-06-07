import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FileUpload } from "./FileUpload";

export interface ImportPreviewRow {
  row: number;
  status: "create" | "update" | "error";
  message: string;
}

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
  const hasErrors = preview.some((row) => row.status === "error");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{instructions}</p>
          {warning && <p className="text-sm text-warning">{warning}</p>}
          <FileUpload onText={onCsvChange} />
          <Textarea
            rows={8}
            value={csv}
            onChange={(e) => onCsvChange(e.target.value)}
          />
          {preview.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-md border p-3 text-sm space-y-0.5">
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
                  第 {row.row} 行：
                  {row.status === "create"
                    ? "新增"
                    : row.status === "update"
                      ? "更新"
                      : "错误"}{" "}
                  - {row.message}
                </p>
              ))}
            </div>
          )}
          {summary && <p className="text-sm">{summary}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button
            disabled={preview.length === 0 || hasErrors}
            onClick={onConfirm}
          >
            确认导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
