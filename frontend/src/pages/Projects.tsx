import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
    if (!window.confirm(t('confirmDeleteProject'))) return;
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
    <div className="flex-1 flex flex-col h-full bg-muted/50/30 overflow-hidden">
      <div className="h-14 px-6 flex items-center justify-between border-b border-border bg-background">
        <div className="flex items-center gap-2 text-foreground/80 font-medium">
          <Folder className="h-5 w-5 text-blue-500" />{t('projectManagement')}</div>
        <Button onClick={() => {
          setFormData({ name: '', description: '' });
          setIsCreateDialogOpen(true);
        }} size="sm" className="gap-2">
          <Plus className="h-4 w-4" />{t('newProject')}</Button>
      </div>

      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-5xl mx-auto space-y-6">
          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle>{t('projectList')}</CardTitle>
              <CardDescription>{t('manageProjectsDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              {loading && projects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin mb-4" />
                  <p>{t('loading')}</p>
                </div>
              ) : projects.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed rounded-lg border-border">
                  <Folder className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                  <p className="text-muted-foreground">{t('noProjectsCreateOne')}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('name')}</TableHead>
                      <TableHead>{t('description')}</TableHead>
                      <TableHead>{t('createdAt')}</TableHead>
                      <TableHead className="text-right">{t('actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projects.map((project) => (
                      <TableRow key={project.id}>
                        <TableCell className="font-medium">{project.name}</TableCell>
                        <TableCell className="text-muted-foreground max-w-xs truncate">
                          {project.description || '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(project.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => goToDataSources(project)}
                              title={t('manageDataSources')}
                            >
                              <Database className="h-4 w-4 text-emerald-500" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => openEditDialog(project)}
                              title={t('editProject')}
                            >
                              <Pencil className="h-4 w-4 text-blue-500" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => handleDelete(project.id)}
                              title={t('deleteProject')}
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
            <DialogTitle>{t('newProject')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">{t('projectName')}</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t('enterProjectName')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">{t('descriptionOptional')}</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder={t('enterProjectDescription')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>{t('cancel')}</Button>
            <Button onClick={handleCreate} disabled={isSubmitting || !formData.name.trim()}>
              {isSubmitting ? t('creating') : t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('editProject')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">{t('projectName')}</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t('enterProjectName')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-description">{t('descriptionOptional')}</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder={t('enterProjectDescription')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>{t('cancel')}</Button>
            <Button onClick={handleUpdate} disabled={isSubmitting || !formData.name.trim()}>
              {isSubmitting ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
