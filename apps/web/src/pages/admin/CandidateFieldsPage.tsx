import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { LoadingState } from "@/components/shared/LoadingState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Pencil,
  Plus,
  Tags,
  Trash2,
} from "lucide-react";

interface Field {
  id: string;
  name: string;
  label: string;
  fieldType: "text" | "number" | "select";
  required: boolean;
  unique: boolean;
  sortOrder: number;
}

export function CandidateFieldsPage() {
  const [fields, setFields] = useState<Field[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Field | null>(null);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<Field["fieldType"]>("text");
  const [required, setRequired] = useState(false);
  const [unique, setUnique] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setFields(
        (await api.get<Field[]>("/api/candidate-fields")).sort(
          (a, b) => a.sortOrder - b.sortOrder,
        ),
      );
    } catch {
      setError("加载字段配置失败");
    } finally {
      setIsLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);
  function dialog(field?: Field) {
    setEditing(field ?? null);
    setName(field?.name ?? "");
    setLabel(field?.label ?? "");
    setFieldType(field?.fieldType ?? "text");
    setRequired(field?.required ?? false);
    setUnique(field?.unique ?? false);
    setOpen(true);
  }
  async function save() {
    if (!name.trim() || !label.trim()) return;
    const data = {
      label,
      fieldType,
      required,
      unique,
      sortOrder: editing?.sortOrder ?? fields.length,
    };
    if (editing) await api.patch(`/api/candidate-fields/${editing.id}`, data);
    else await api.post("/api/candidate-fields", { ...data, name });
    setOpen(false);
    await load();
  }
  async function remove(id: string) {
    await api.delete(`/api/candidate-fields/${id}`);
    await load();
  }
  async function move(field: Field, offset: number) {
    const index = fields.findIndex((item) => item.id === field.id);
    const other = fields[index + offset];
    if (!other) return;
    await Promise.all([
      api.patch(`/api/candidate-fields/${field.id}`, {
        sortOrder: other.sortOrder,
      }),
      api.patch(`/api/candidate-fields/${other.id}`, {
        sortOrder: field.sortOrder,
      }),
    ]);
    await load();
  }
  async function drop(target: Field) {
    const source = fields.find((field) => field.id === draggingId);
    setDraggingId(null);
    if (!source || source.id === target.id) return;
    await Promise.all([
      api.patch(`/api/candidate-fields/${source.id}`, {
        sortOrder: target.sortOrder,
      }),
      api.patch(`/api/candidate-fields/${target.id}`, {
        sortOrder: source.sortOrder,
      }),
    ]);
    await load();
  }
  async function download() {
    const { headers } = await api.get<{ headers: string[] }>(
      "/api/candidate-fields/template",
    );
    const blob = new Blob(["\uFEFF" + headers.join(",") + "\n"], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "候选人导入模板.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  return (
    <div className="space-y-6">
      <PageHeader
        title="考生字段配置"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void download()}>
              <Download className="size-4" />
              下载模板
            </Button>
            <Button onClick={() => dialog()}>
              <Plus className="size-4" />
              添加字段
            </Button>
          </div>
        }
      />
      {fields.length === 0 ? (
        <EmptyState
          icon={<Tags className="size-8" />}
          title="暂无候选人字段"
          description="请先配置唯一身份字段和需要采集的信息。"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>字段名</TableHead>
              <TableHead>标签</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>必填</TableHead>
              <TableHead>唯一</TableHead>
              <TableHead>排序</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field, index) => (
              <TableRow
                key={field.id}
                draggable
                onDragStart={() => setDraggingId(field.id)}
                onDragEnd={() => setDraggingId(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => void drop(field)}
              >
                <TableCell>{field.name}</TableCell>
                <TableCell>{field.label}</TableCell>
                <TableCell>{field.fieldType}</TableCell>
                <TableCell>{field.required ? "是" : "否"}</TableCell>
                <TableCell>{field.unique ? "是" : "否"}</TableCell>
                <TableCell>{field.sortOrder}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={index === 0}
                      onClick={() => void move(field, -1)}
                      aria-label="上移"
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={index === fields.length - 1}
                      onClick={() => void move(field, 1)}
                      aria-label="下移"
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => dialog(field)}
                      aria-label="编辑字段"
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="删除字段"
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      }
                      title="确认删除"
                      description={`确定删除字段「${field.label}」吗？`}
                      destructive
                      onConfirm={() => void remove(field.id)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑字段" : "添加字段"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {!editing && (
              <div className="space-y-2">
                <Label>字段名</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            )}
            <div className="space-y-2">
              <Label>标签</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>类型</Label>
              <Select
                value={fieldType}
                onValueChange={(value) =>
                  setFieldType(value as Field["fieldType"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">文本</SelectItem>
                  <SelectItem value="number">数字</SelectItem>
                  <SelectItem value="select">选项</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex gap-2">
              <Checkbox
                checked={required}
                onCheckedChange={(value) => setRequired(value === true)}
              />
              必填
            </label>
            <label className="flex gap-2">
              <Checkbox
                checked={unique}
                onCheckedChange={(value) => setUnique(value === true)}
              />
              唯一身份标识
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void save()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
