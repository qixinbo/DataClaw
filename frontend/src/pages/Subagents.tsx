import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Loader2, Bot, Plus, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { subagentApi, type Subagent } from "@/api/subagents";
import { useProjectStore } from "@/store/projectStore";
import { api } from "@/lib/api";

interface ModelConfig {
  id: string;
  name: string;
  model: string;
  provider: string;
}

export function Subagents() {
  const { t } = useTranslation();
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const { currentProject } = useProjectStore();
  
  // Use projectId from route, or fallback to currentProject
  const projectId = routeProjectId || currentProject?.id?.toString();

  const [subagents, setSubagents] = useState<Subagent[]>([]);
  const [availableModels, setAvailableModels] = useState<ModelConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSubagent, setEditingSubagent] = useState<Subagent | null>(null);
  const [newSubagent, setNewSubagent] = useState<Partial<Subagent>>({ 
    name: '', 
    description: '', 
    model: '', 
    instructions: '', 
    status: 'active' 
  });

  const fetchInitialData = async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
        const [subagentsData, modelsData] = await Promise.all([
          subagentApi.list(projectId),
          api.get<ModelConfig[]>('/api/v1/llm')
        ]);
        setSubagents(subagentsData || []);
        setAvailableModels(modelsData || []);
    } catch (error) {
        console.error("Failed to fetch initial data", error);
    } finally {
        setIsLoading(false);
    }
  };

  useEffect(() => {
    if (projectId) {
      fetchInitialData();
    }
  }, [projectId]);

  const getModelDisplay = (value?: string) => {
    if (!value) return '-';
    const matched = availableModels.find((m) => m.id === value || m.model === value);
    if (!matched) return value;
    const label = matched.name || matched.model;
    return `${label} (${matched.provider})`;
  };

  const handleSaveSubagent = async () => {
    if (!projectId) return;
    if (newSubagent.name && newSubagent.model) {
      try {
          if (editingSubagent && editingSubagent.id) {
              await subagentApi.update(projectId, editingSubagent.id, newSubagent);
          } else {
              const payload = {
                ...newSubagent,
                instructions: newSubagent.instructions || ''
              };
              await subagentApi.create(projectId, payload);
          }
          await fetchInitialData();
          setNewSubagent({ name: '', description: '', model: '', instructions: '', status: 'active' });
          setEditingSubagent(null);
          setIsDialogOpen(false);
      } catch (error) {
          console.error("Failed to save subagent", error);
          alert(t('saveFailed'));
      }
    } else {
      alert(t('fillRequiredFields'));
    }
  };

  const handleEditSubagent = (subagent: Subagent) => {
    const matched = availableModels.find((m) => m.id === subagent.model || m.model === subagent.model);
    setEditingSubagent(subagent);
    setNewSubagent({
      ...subagent,
      model: matched?.id || subagent.model
    });
    setIsDialogOpen(true);
  };

  const handleDeleteSubagent = async (id: string) => {
    if (!projectId) return;
    if (!window.confirm(t('confirmDeleteSubagent'))) return;
    try {
        await subagentApi.delete(projectId, id);
        setSubagents(subagents.filter(s => s.id !== id));
    } catch (error) {
        console.error("Failed to delete subagent", error);
    }
  };

  if (!projectId) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-4">
        <Bot className="h-12 w-12 text-zinc-200" />
        <p>{t('selectProjectToManageSubagents', 'Please select a project to manage subagents')}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      <div className="border-b border-zinc-100 px-8 pt-5 pb-5 bg-white shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
            <Bot className="h-6 w-6 text-indigo-500" />{t('subagentManagement', 'Subagent Management')}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">{t('manageSubagentsDesc', 'Manage subagents for this project')}</p>
        </div>
        <Button 
          className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
          onClick={() => {
            setEditingSubagent(null);
            setNewSubagent({ name: '', description: '', model: '', instructions: '', status: 'active' });
            setIsDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />{t('addSubagent', 'Add Subagent')}
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-8 bg-zinc-50/30">
        <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden min-w-[800px] lg:min-w-0">
          <Table className="table-fixed w-full">
            <TableHeader className="bg-zinc-50/50">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[25%] font-semibold text-zinc-700 py-3 px-4 text-sm">{t('name')}</TableHead>
                <TableHead className="w-[25%] font-semibold text-zinc-700 py-3 px-4 text-sm">{t('modelName', 'Model')}</TableHead>
                <TableHead className="w-[35%] font-semibold text-zinc-700 py-3 px-4 text-sm">{t('description')}</TableHead>
                <TableHead className="w-[15%] font-semibold text-zinc-700 py-3 px-4 text-sm text-right">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-24 text-center">
                    <div className="flex items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {subagents.map((subagent) => (
                    <TableRow key={subagent.id} className="group hover:bg-zinc-50/50 transition-colors border-zinc-100">
                      <TableCell className="py-4 px-4 overflow-hidden">
                        <h3 className="font-bold text-zinc-900 text-sm md:text-base truncate flex-1" title={subagent.name}>
                          {subagent.name}
                        </h3>
                      </TableCell>
                      <TableCell className="py-4 px-4 text-zinc-600 text-sm truncate" title={getModelDisplay(subagent.model)}>
                        {getModelDisplay(subagent.model)}
                      </TableCell>
                      <TableCell className="py-4 px-4 text-zinc-500 text-sm truncate" title={subagent.description}>
                        {subagent.description || '-'}
                      </TableCell>
                      <TableCell className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all shrink-0"
                            onClick={() => handleEditSubagent(subagent)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-all shrink-0"
                            onClick={() => handleDeleteSubagent(subagent.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {subagents.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-24 text-center">
                        <div className="flex flex-col items-center gap-3 text-zinc-400">
                          <div className="p-4 bg-zinc-50 rounded-2xl">
                            <Bot className="h-10 w-10 opacity-20" />
                          </div>
                          <p className="text-sm">{t('noSubagents', 'No subagents configured')}</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
              setEditingSubagent(null);
              setNewSubagent({ name: '', description: '', model: '', instructions: '', status: 'active' });
          }
      }}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col rounded-2xl p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="text-xl font-bold text-zinc-900">
              {editingSubagent ? t('editSubagent', 'Edit Subagent') : t('addSubagent', 'Add Subagent')}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-2">
            <div className="grid gap-5">
              <div className="grid gap-1.5">
                <Label htmlFor="name" className="text-zinc-600 font-medium text-sm">{t('name')} *</Label>
                <Input 
                  id="name" 
                  placeholder={t('subagentName', 'Subagent Name')}
                  value={newSubagent.name || ''} 
                  onChange={(e) => setNewSubagent({...newSubagent, name: e.target.value})}
                  className="rounded-lg border-zinc-200 h-10" 
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="model" className="text-zinc-600 font-medium text-sm">{t('modelName', 'Model')} *</Label>
                <Select 
                  value={newSubagent.model || ''} 
                  onValueChange={(v) => setNewSubagent({...newSubagent, model: v || undefined})}
                >
                  <SelectTrigger className="w-full h-10 border-zinc-200 rounded-lg">
                    <SelectValue placeholder={t('selectModel', 'Select a model')}>
                      {newSubagent.model ? getModelDisplay(newSubagent.model) : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {availableModels.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name || m.model} <span className="text-xs text-zinc-400 ml-1">({m.provider})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="description" className="text-zinc-600 font-medium text-sm">{t('description')}</Label>
                <Textarea 
                  id="description" 
                  placeholder={t('descriptionOptional')}
                  value={newSubagent.description || ''} 
                  onChange={(e) => setNewSubagent({...newSubagent, description: e.target.value})}
                  className="rounded-lg border-zinc-200 min-h-[80px] py-2 text-sm" 
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="instructions" className="text-zinc-600 font-medium text-sm">{t('instructions', 'System Instructions')}</Label>
                <Textarea 
                  id="instructions" 
                  value={newSubagent.instructions || ''} 
                  onChange={(e) => setNewSubagent({...newSubagent, instructions: e.target.value})}
                  className="rounded-lg border-zinc-200 font-mono text-xs min-h-[160px] py-3 bg-zinc-50" 
                  placeholder={t('systemInstructionsPlaceholder', 'You are a helpful AI assistant...')}
                />
              </div>
            </div>
          </div>
          <DialogFooter className="p-6 pt-2">
            <Button onClick={handleSaveSubagent} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-6 h-10 w-full">
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
