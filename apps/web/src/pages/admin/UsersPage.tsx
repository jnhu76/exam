import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { LoadingState } from "@/components/shared/LoadingState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
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
import { Pencil, Plus, Users } from "lucide-react";
import { FieldError } from "@/components/shared/FieldError";
import { RowActions } from "@/components/shared/RowActions";
import { DEFAULT_PASSWORD_POLICY } from "@exam/contracts";

interface UserRow {
  id: string;
  username: string;
  name: string;
  role: "Admin" | "Candidate";
  isActive: boolean;
}
interface Page<T> {
  items: T[];
}
const roleLabels: Record<string, string> = {
  Admin: "管理员",
  Candidate: "候选人",
};

type EditableRole = "Admin";
const EDITABLE_ROLES: EditableRole[] = ["Admin"];

export function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<EditableRole>("Admin");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setUsers(
        (await api.get<Page<UserRow>>("/api/users")).items.filter(
          (user) => user.role !== "Candidate",
        ),
      );
    } catch {
      setError("加载用户列表失败");
    } finally {
      setIsLoading(false);
    }
  }, []);
  useEffect(() => void loadUsers(), [loadUsers]);

  function open(user?: UserRow) {
    setEditing(user ?? null);
    setUsername(user?.username ?? "");
    setPassword("");
    setName(user?.name ?? "");
    setRole(
      user && (EDITABLE_ROLES as readonly string[]).includes(user.role)
        ? (user.role as EditableRole)
        : "Admin",
    );
    setFieldErrors({});
    setDialogOpen(true);
  }

  function validate() {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "请输入姓名";
    if (!editing) {
      if (!username.trim()) errors.username = "请输入用户名";
      if (password.length < DEFAULT_PASSWORD_POLICY.minLength)
        errors.password = `密码至少 ${DEFAULT_PASSWORD_POLICY.minLength} 位`;
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function save() {
    if (saving || !validate()) return;
    setSaving(true);
    try {
      if (editing) {
        const payload: { name: string; role?: EditableRole } = { name };
        payload.role = role;
        await api.patch(`/api/users/${editing.id}`, payload);
      } else {
        await api.post("/api/users", { username, password, name, role });
      }
      setDialogOpen(false);
      await loadUsers();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "保存失败，请稍后重试"));
    } finally {
      setSaving(false);
    }
  }
  async function toggle(user: UserRow) {
    if (togglingId) return;
    setTogglingId(user.id);
    try {
      await api.patch(`/api/users/${user.id}`, { isActive: !user.isActive });
      await loadUsers();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "操作失败，请稍后重试"));
    } finally {
      setTogglingId(null);
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadUsers} />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="用户管理"
        actions={
          <Button onClick={() => open()}>
            <Plus data-icon="inline-start" />
            新增用户
          </Button>
        }
      />
      {users.length === 0 ? (
        <EmptyState
          icon={<Users className="size-8" />}
          title="暂无用户"
          description="还没有创建任何管理用户。"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户名</TableHead>
              <TableHead>姓名</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>{user.username}</TableCell>
                <TableCell>{user.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {roleLabels[user.role] ?? user.role}
                  </Badge>
                </TableCell>
                <TableCell>{user.isActive ? "启用" : "禁用"}</TableCell>
                <TableCell>
                  <RowActions>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => open(user)}
                      aria-label="编辑用户"
                    >
                      <Pencil />
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={togglingId !== null}
                        >
                          {togglingId === user.id
                            ? "处理中..."
                            : user.isActive
                              ? "禁用"
                              : "启用"}
                        </Button>
                      }
                      title={user.isActive ? "确认禁用" : "确认启用"}
                      description={`确定要${user.isActive ? "禁用" : "启用"}用户「${user.name}」吗？`}
                      destructive={user.isActive}
                      onConfirm={() => void toggle(user)}
                    />
                  </RowActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑用户" : "新增用户"}</DialogTitle>
          </DialogHeader>
          <FieldGroup className="py-4">
            {!editing && (
              <>
                <Field>
                  <Label>用户名</Label>
                  <Input
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (fieldErrors.username)
                        setFieldErrors((prev) => ({ ...prev, username: "" }));
                    }}
                  />
                  <FieldError>{fieldErrors.username}</FieldError>
                </Field>
                <Field>
                  <Label>初始密码</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldErrors.password)
                        setFieldErrors((prev) => ({ ...prev, password: "" }));
                    }}
                  />
                  <FieldError>{fieldErrors.password}</FieldError>
                </Field>
              </>
            )}
            <Field>
              <Label>姓名</Label>
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
              <Label>角色</Label>
              <Select
                value={role}
                onValueChange={(value) => setRole(value as EditableRole)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Admin">管理员</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              取消
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
