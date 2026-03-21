import { useEffect, useState } from 'react';
import { ChevronDown, Plus, Folder } from 'lucide-react';
import { useProjectStore } from '@/store/projectStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ProjectSwitcher() {
  const { projects, currentProject, fetchProjects, setCurrentProject, addProject } = useProjectStore();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    setIsSubmitting(true);
    try {
      await addProject(newProjectName);
      setNewProjectName('');
      setIsCreateDialogOpen(false);
    } catch (error) {
      console.error('Failed to create project:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-background h-12">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex h-8 items-center gap-1 rounded-md px-2 font-semibold hover:bg-accent hover:text-accent-foreground outline-none transition-colors">
          <Folder className="h-4 w-4 mr-1 text-blue-500" />
          {currentProject?.name || 'Select Project'}
          <ChevronDown className="h-4 w-4 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex items-center justify-between">
              PROJECTS
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-5 w-5" 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsCreateDialogOpen(true);
                }}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
          <div className="max-h-64 overflow-y-auto">
            {projects.map((project) => (
              <DropdownMenuItem
                key={project.id}
                onClick={() => {
                  setCurrentProject(project);
                }}
                className={currentProject?.id === project.id ? 'bg-accent' : ''}
              >
                <Folder className="h-4 w-4 mr-2 text-zinc-400" />
                {project.name}
              </DropdownMenuItem>
            ))}
            {projects.length === 0 && (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                No projects found
              </div>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Project Name</Label>
              <Input
                id="name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Enter project name"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateProject} disabled={isSubmitting || !newProjectName.trim()}>
              {isSubmitting ? 'Creating...' : 'Create Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
