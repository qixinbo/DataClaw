import { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pencil, Trash2, Plus, Users as UsersIcon, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

interface User {
  id: number;
  username: string;
  email: string;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
}

export function Users() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
    is_active: true,
    is_admin: false,
  });
  const [error, setError] = useState("");

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      const data = await api.get<User[]>("/api/v1/users");
      setUsers(data);
    } catch (err) {
      console.error("Failed to fetch users", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleOpenDialog = (user?: User) => {
    setError("");
    if (user) {
      setEditingUser(user);
      setFormData({
        username: user.username,
        email: user.email,
        password: "", // Don't show password
        is_active: user.is_active,
        is_admin: user.is_admin,
      });
    } else {
      setEditingUser(null);
      setFormData({
        username: "",
        email: "",
        password: "",
        is_active: true,
        is_admin: false,
      });
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    try {
      if (editingUser) {
        // Update
        await api.put(`/api/v1/users/${editingUser.id}`, {
          username: formData.username,
          email: formData.email,
          is_active: formData.is_active,
          is_admin: formData.is_admin,
        });
      } else {
        // Create
        if (!formData.password) {
          setError(t('newUserMustHavePassword'));
          return;
        }
        await api.post("/api/v1/users", formData);
      }
      setIsDialogOpen(false);
      fetchUsers();
    } catch (err: any) {
      setError(err.message || t('anErrorOccurred'));
    }
  };

  const handleDelete = async (id: number) => {
    if (window.confirm(t('confirmDeleteUser'))) {
      try {
        await api.delete(`/api/v1/users/${id}`);
        fetchUsers();
      } catch (err) {
        console.error("Failed to delete user", err);
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-muted/50/30 overflow-hidden">
      <div className="h-14 px-6 flex items-center justify-between border-b border-border bg-background">
        <div className="flex items-center gap-2 text-foreground/80 font-medium">
          <UsersIcon className="h-5 w-5 text-indigo-500" />
          用户管理
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-8 bg-indigo-600 hover:bg-indigo-700 text-primary-foreground rounded-md px-3" onClick={() => handleOpenDialog()}>
            <Plus className="h-4 w-4" />
            添加用户
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>{editingUser ? t('editUser') : t('addNewUser')}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                {error && <div className="text-red-500 text-sm">{error}</div>}
                <div className="grid gap-2">
                  <Label htmlFor="username">{t('username')}</Label>
                  <Input
                    id="username"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email">{t('email')}</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                  />
                </div>
                {!editingUser && (
                  <div className="grid gap-2">
                    <Label htmlFor="password">{t('password')}</Label>
                    <Input
                      id="password"
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      required
                    />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <Label htmlFor="is_active">{t('activeStatus')}</Label>
                  <Switch
                    id="is_active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="is_admin">{t('adminPrivileges')}</Label>
                  <Switch
                    id="is_admin"
                    checked={formData.is_admin}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_admin: checked })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  {t('cancel')}
                </Button>
                <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-primary-foreground">
                  {t('save')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex-1 p-6 overflow-auto">
        <div className="bg-background rounded-xl border border-border shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('id')}</TableHead>
                  <TableHead>{t('username')}</TableHead>
                  <TableHead>{t('email')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead>{t('role')}</TableHead>
                  <TableHead>{t('createdAt')}</TableHead>
                  <TableHead className="text-right">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                      暂无用户数据
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.id}</TableCell>
                      <TableCell>{user.username}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${user.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
                          {user.is_active ? t('normal') : t('disabled')}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${user.is_admin ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                          {user.is_admin ? t('admin') : t('regularUser')}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(user.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-indigo-600"
                          onClick={() => handleOpenDialog(user)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-red-600"
                          onClick={() => handleDelete(user.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}