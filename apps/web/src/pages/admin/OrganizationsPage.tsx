import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { LoadingState } from "@/components/shared/LoadingState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { FieldError } from "@/components/shared/FieldError";

interface OrgRow {
  id: string;
  name: string;
  displayName: string;
  slug: string;
}

export function OrganizationsPage() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<OrgRow | null>(null);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const loadOrgs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setOrgs(await api.get<OrgRow[]>("/api/organizations"));
    } catch {
      setError("加载机构列表失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => void loadOrgs(), [loadOrgs]);

  function openDialog(org?: OrgRow) {
    setEditing(org ?? null);
    setName(org?.name ?? "");
    setDisplayName(org?.displayName ?? "");
    setSlug(org?.slug ?? "");
    setFieldErrors({});
    setDialogOpen(true);
  }

  function validate() {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "请输入名称";
    if (!displayName.trim()) errors.displayName = "请输入显示名";
    if (!editing && !slug.trim()) errors.slug = "请输入标识";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/api/organizations/${editing.id}`, {
          name,
          displayName,
        });
      } else {
        await api.post("/api/organizations", { name, displayName, slug });
      }
      setDialogOpen(false);
      await loadOrgs();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await api.delete(`/api/organizations/${id}`);
    await loadOrgs();
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadOrgs} />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="机构管理"
        actions={
          <Button onClick={() => openDialog()} data-testid="create-org-btn">
            <Plus data-icon="inline-start" />
            新增机构
          </Button>
        }
      />
      {orgs.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-8" />}
          title="暂无机构"
          description="还没有创建任何机构。"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>显示名</TableHead>
              <TableHead>标识</TableHead>
              <TableHead className="w-24">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orgs.map((org) => (
              <TableRow key={org.id}>
                <TableCell>{org.name}</TableCell>
                <TableCell>{org.displayName}</TableCell>
                <TableCell>{org.slug}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openDialog(org)}
                      aria-label="编辑机构"
                    >
                      <Pencil />
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="删除机构"
                        >
                          <Trash2 className="text-destructive" />
                        </Button>
                      }
                      title="确认删除"
                      description={`确定删除机构「${org.displayName}」吗？`}
                      destructive
                      onConfirm={() => void remove(org.id)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑机构" : "新增机构"}</DialogTitle>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <Label>名称</Label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (fieldErrors.name)
                    setFieldErrors((prev) => ({ ...prev, name: "" }));
                }}
              />
              <FieldError>{fieldErrors.name}</FieldError>
            </Field>
            <Field>
              <Label>显示名</Label>
              <Input
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  if (fieldErrors.displayName)
                    setFieldErrors((prev) => ({ ...prev, displayName: "" }));
                }}
              />
              <FieldError>{fieldErrors.displayName}</FieldError>
            </Field>
            <Field>
              <Label>标识</Label>
              <Input
                value={slug}
                disabled={!!editing}
                onChange={(e) => {
                  setSlug(e.target.value);
                  if (fieldErrors.slug)
                    setFieldErrors((prev) => ({ ...prev, slug: "" }));
                }}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
