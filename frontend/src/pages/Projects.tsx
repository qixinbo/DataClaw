import React, { useEffect, useState } from 'react';
import { Plus, Folder, Pencil, Trash2, Loader2, Database } from 'lucide-react';
import { useProjectStore, type Project } from '@/store/projectStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useNavigate } from 'react-router-dom';

export function Projects() {
  const { projects, loading, fetchProjects, addProject, updateProject, deleteProject, setCurrentProject } = useProjectStore();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleCreate = async () => {
    if (!formData.name.trim()) return;
    setIsSubmitting(true);
    try {
      await addProject(formData.name, formData.description);
      setFormData({ name: '', description: '' });
      setIsCreateDialogOpen(false);
    } catch (error) {
      console.error('Failed to create project:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingProject || !formData.name.trim()) return;
    setIsSubmitting(true);
    try {
      await updateProject(editingProject.id, formData.name, formData.description);
      setEditingProject(null);
      setFormData({ name: '', description: '' });
      setIsEditDialogOpen(false);
    } catch (error) {
      console.error('Failed to update project:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this project? All associated data sources will be deleted.')) return;
    try {
      await deleteProject(id);
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  const openEditDialog = (project: Project) => {
    setEditingProject(project);
    setFormData({ name: project.name, description: project.description || '' });
    setIsEditDialogOpen(true);
  };

  const goToDataSources = (project: Project) => {
    setCurrentProject(project);
    navigate('/datasources');
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-50/30 overflow-hidden">
      <div className="h-14 px-6 flex items-center justify-between border-b border-zinc-100 bg-white">
        <div className="flex items-center gap-2 text-zinc-700 font-medium">
          <Folder className="h-5 w-5 text-blue-500" />
          项目管理
        </div>
        <Button onClick={() => {
          setFormData({ name: '', description: '' });
          setIsCreateDialogOpen(true);
        }} size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          新建项目
        </Button>
      </div>

      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-5xl mx-auto space-y-6">
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader>
              <CardTitle>项目列表</CardTitle>
              <CardDescription>管理您的项目，不同项目拥有独立的数据源</CardDescription>
            </CardHeader>
            <CardContent>
              {loading && projects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
                  <Loader2 className="h-8 w-8 animate-spin mb-4" />
                  <p>加载中...</p>
                </div>
              ) : projects.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed rounded-lg border-zinc-100">
                  <Folder className="h-12 w-12 text-zinc-200 mx-auto mb-4" />
                  <p className="text-zinc-500">暂无项目，请先创建一个</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>名称</TableHead>
                      <TableHead>描述</TableHead>
                      <TableHead>创建时间</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projects.map((project) => (
                      <TableRow key={project.id}>
                        <TableCell className="font-medium">{project.name}</TableCell>
                        <TableCell className="text-zinc-500 max-w-xs truncate">
                          {project.description || '-'}
                        </TableCell>
                        <TableCell className="text-zinc-500">
                          {new Date(project.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => goToDataSources(project)}
                              title="管理数据源"
                            >
                              <Database className="h-4 w-4 text-emerald-500" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => openEditDialog(project)}
                              title="编辑项目"
                            >
                              <Pencil className="h-4 w-4 text-blue-500" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => handleDelete(project.id)}
                              title="删除项目"
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">项目名称</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="输入项目名称"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">描述 (可选)</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="输入项目描述"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={isSubmitting || !formData.name.trim()}>
              {isSubmitting ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑项目</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">项目名称</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="输入项目名称"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-description">描述 (可选)</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="输入项目描述"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>取消</Button>
            <Button onClick={handleUpdate} disabled={isSubmitting || !formData.name.trim()}>
              {isSubmitting ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
