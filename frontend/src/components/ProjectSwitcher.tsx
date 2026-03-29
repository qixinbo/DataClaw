import { useEffect, useState } from 'react';
import { ChevronDown, Plus, Folder, Check } from 'lucide-react';
import { useProjectStore } from '@/store/projectStore';
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

interface ModelConfig {
  id: string;
  name: string;
  model: string;
  provider: string;
  is_active: boolean;
}

export function ProjectSwitcher() {
  const { t } = useTranslation();
  const { projects, currentProject, fetchProjects, setCurrentProject, addProject } = useProjectStore();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Model Selection State
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [modelOpen, setModelOpen] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const data = await api.get<ModelConfig[]>("/api/v1/llm");
        setModels(data);
        const active = data.find(m => m.is_active);
        if (active) {
          setSelectedModelId(active.id);
        } else if (data.length > 0) {
          setSelectedModelId(data[0].id);
        }
      } catch (e) {
        console.error("Failed to fetch models", e);
      }
    };
    fetchModels();
  }, []);

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
    <div className="flex items-center gap-2 bg-transparent h-10">
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
                <Folder className="h-4 w-4 mr-2 text-muted-foreground" />
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

      <div className="h-4 w-px bg-border mx-1" />

      <Popover open={modelOpen} onOpenChange={setModelOpen}>
        <PopoverTrigger className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors group">
          <span className="font-semibold text-[14px]">
            {selectedModelId ? (models.find(m => m.id === selectedModelId)?.name || models.find(m => m.id === selectedModelId)?.model || 'DataClaw') : 'DataClaw'}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50 group-hover:opacity-100 transition-colors" />
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start">
          <Command>
            <CommandInput placeholder={t('searchModel')} />
            <CommandList className="max-h-[300px]">
              <CommandEmpty>{t('modelNotFound')}</CommandEmpty>
              <CommandGroup heading={t('availableModels')}>
                {models.map((model) => (
                  <CommandItem
                    key={model.id}
                    onSelect={() => {
                      setSelectedModelId(model.id);
                      setModelOpen(false);
                      // Fire custom event to notify ChatInterface if needed
                      window.dispatchEvent(new CustomEvent("nanobot:model-changed", { detail: model.id }));
                    }}
                    className="flex items-center gap-2 py-2.5 cursor-pointer"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{model.name || model.model}</span>
                      <span className="text-xs text-muted-foreground">{model.provider}</span>
                    </div>
                    <Check
                      className={cn(
                        "ml-auto h-4 w-4",
                        selectedModelId === model.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

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
