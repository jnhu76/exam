import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { FieldGroup, Field } from "@/components/shared/FieldGroup";
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

interface UserRow {
  id: string;
  username: string;
  name: string;
  role: "SuperAdmin" | "Admin" | "Teacher" | "Proctor" | "Candidate";
  isActive: boolean;
}
interface Page<T> {
  items: T[];
}
const roleLabels: Record<string, string> = {
  SuperAdmin: "超级管理员",
  Admin: "管理员",
  Teacher: "教师",
  Proctor: "监考员",
  Candidate: "候选人",
};

type EditableRole = "Admin" | "Teacher" | "Proctor";
const EDITABLE_ROLES: EditableRole[] = ["Admin", "Teacher", "Proctor"];

export function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<EditableRole>("Teacher");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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
        : "Teacher",
    );
    setFieldErrors({});
    setDialogOpen(true);
  }

  function validate() {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "请输入姓名";
    if (!editing) {
      if (!username.trim()) errors.username = "请输入用户名";
      if (password.length < 6) errors.password = "密码至少6位";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function save() {
    if (!validate()) return;
    try {
      if (editing) {
        const payload: { name: string; role?: EditableRole } = { name };
        if (editing.role !== "SuperAdmin") payload.role = role;
        await api.patch(`/api/users/${editing.id}`, payload);
      } else {
        await api.post("/api/users", { username, password, name, role });
      }
      setDialogOpen(false);
      await loadUsers();
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存失败";
      toast.error(message);
    }
  }
  async function toggle(user: UserRow) {
    try {
      await api.patch(`/api/users/${user.id}`, { isActive: !user.isActive });
      await loadUsers();
    } catch (err) {
      const message = err instanceof Error ? err.message : "操作失败";
      toast.error(message);
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
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => open(user)}
                      aria-label="编辑用户"
                    >
                      <Pencil />
                    </Button>
                    {user.role !== "SuperAdmin" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void toggle(user)}
                      >
                        {user.isActive ? "禁用" : "启用"}
                      </Button>
                    )}
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
              {editing?.role === "SuperAdmin" ? (
                <div className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
                  超级管理员（不可修改）
                </div>
              ) : (
                <Select
                  value={role}
                  onValueChange={(value) => setRole(value as EditableRole)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Admin">管理员</SelectItem>
                    <SelectItem value="Teacher">教师</SelectItem>
                    <SelectItem value="Proctor">监考员</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void save()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
