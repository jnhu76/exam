import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
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
  role: "Admin" | "Teacher" | "Proctor" | "Candidate";
  isActive: boolean;
}
interface Page<T> {
  items: T[];
}
const roleLabels = {
  Admin: "管理员",
  Teacher: "教师",
  Proctor: "监考员",
  Candidate: "候选人",
};

export function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"Admin" | "Teacher" | "Proctor">("Teacher");
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
      user?.role === "Admin" || user?.role === "Proctor"
        ? user.role
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
    if (editing) await api.patch(`/api/users/${editing.id}`, { name, role });
    else await api.post("/api/users", { username, password, name, role });
    setDialogOpen(false);
    await loadUsers();
  }
  async function toggle(user: UserRow) {
    await api.patch(`/api/users/${user.id}`, { isActive: !user.isActive });
    await loadUsers();
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadUsers} />;
  return (
    <div className="space-y-6">
      <PageHeader
        title="用户管理"
        actions={
          <Button onClick={() => open()}>
            <Plus className="size-4" />
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
                  <Badge variant="outline">{roleLabels[user.role]}</Badge>
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
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void toggle(user)}
                    >
                      {user.isActive ? "禁用" : "启用"}
                    </Button>
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
          <div className="space-y-4 py-4">
            {!editing && (
              <>
                <div className="space-y-2">
                  <Label>用户名</Label>
                  <Input
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (fieldErrors.username) setFieldErrors((prev) => ({ ...prev, username: "" }));
                    }}
                  />
                  <FieldError>{fieldErrors.username}</FieldError>
                </div>
                <div className="space-y-2">
                  <Label>初始密码</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: "" }));
                    }}
                  />
                  <FieldError>{fieldErrors.password}</FieldError>
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label>姓名</Label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: "" }));
                }}
              />
              <FieldError>{fieldErrors.name}</FieldError>
            </div>
            <div className="space-y-2">
              <Label>角色</Label>
              <Select
                value={role}
                onValueChange={(value) => setRole(value as typeof role)}
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
            </div>
          </div>
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
