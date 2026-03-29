import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Terminal, Loader2, FolderOpen, Eye, ShieldCheck, AlertCircle, Wand2, Upload, Plus, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";
import { useMcpHealthStore } from "@/store/mcpHealthStore";
import { useRef } from 'react';

interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  type: string;
  project_id?: number;
  source: string;
  installation_time: string;
  status: string;
  file_path?: string;
  is_builtin?: boolean;
}

interface MCPServer {
  id?: string;
  project_id?: number;
  name: string;
  type: 'stdio' | 'sse' | 'streamableHttp';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  status?: string;
}

const dedupeSkillsById = (skills: Skill[]): Skill[] => {
  const map = new Map<string, Skill>();
  for (const skill of skills) {
    const id = (skill.id || "").trim();
    if (!id || map.has(id)) continue;
    map.set(id, skill);
  }
  return Array.from(map.values());
};

export function Skills() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'skills' | 'mcp'>('skills');

  // Skills state
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [newSkill, setNewSkill] = useState<Partial<Skill>>({ type: 'python', content: '', source: t('localImport'), status: t('safe') });
  
  // MCP state
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [isMcpLoading, setIsMcpLoading] = useState(false);
  const [isMcpDialogOpen, setIsMcpDialogOpen] = useState(false);
  const [editingMcp, setEditingMcp] = useState<MCPServer | null>(null);
  const [newMcp, setNewMcp] = useState<Partial<MCPServer>>({ type: 'stdio' });
  const [mcpArgsStr, setMcpArgsStr] = useState('');
  const [mcpEnvStr, setMcpEnvStr] = useState('');
  const [mcpHeadersStr, setMcpHeadersStr] = useState('');
  const [isRefreshingMcpHealth, setIsRefreshingMcpHealth] = useState(false);

  const { currentProject } = useProjectStore();
  const { hasMcpError, refresh: refreshMcpHealth } = useMcpHealthStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchSkills = async () => {
      if (!currentProject) return;
      setIsLoading(true);
      try {
          const data = await api.get<Skill[]>(`/api/v1/skills?project_id=${currentProject.id}`);
          setSkills(dedupeSkillsById(data || []));
      } catch (error) {
          console.error("Failed to fetch skills", error);
      } finally {
          setIsLoading(false);
      }
    };

    const fetchMcpServers = async () => {
      if (!currentProject) return;
      setIsMcpLoading(true);
      try {
          const data = await api.get<MCPServer[]>(`/api/v1/mcp?project_id=${currentProject.id}`);
          setMcpServers(data);
      } catch (error) {
          console.error("Failed to fetch MCP servers", error);
      } finally {
          setIsMcpLoading(false);
      }
    };

    if (currentProject) {
      void refreshMcpHealth(currentProject.id);
      if (activeTab === 'skills') {
        void fetchSkills();
      } else {
        void fetchMcpServers();
      }
    }
  }, [currentProject?.id, activeTab, refreshMcpHealth]);

  const fetchSkills = async () => {
    if (!currentProject) return;
    setIsLoading(true);
    try {
        const data = await api.get<Skill[]>(`/api/v1/skills?project_id=${currentProject.id}`);
        setSkills(dedupeSkillsById(data || []));
    } catch (error) {
        console.error("Failed to fetch skills", error);
    } finally {
        setIsLoading(false);
    }
  };

  const fetchMcpServers = async () => {
    if (!currentProject) return;
    setIsMcpLoading(true);
    try {
        const data = await api.get<MCPServer[]>(`/api/v1/mcp?project_id=${currentProject.id}`);
        setMcpServers(data);
        void refreshMcpHealth(currentProject.id);
    } catch (error) {
        console.error("Failed to fetch MCP servers", error);
    } finally {
        setIsMcpLoading(false);
    }
  };

  const handleRefreshMcpHealth = async () => {
    if (!currentProject) return;
    setIsRefreshingMcpHealth(true);
    try {
      await refreshMcpHealth(currentProject.id);
      if (activeTab === 'mcp') {
        await fetchMcpServers();
      }
    } finally {
      setIsRefreshingMcpHealth(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !currentProject) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('project_id', currentProject.id.toString());

    setIsLoading(true);
    try {
      await api.post('/api/v1/skills/upload', formData);
      await fetchSkills();
    } catch (error: unknown) {
      console.error("Failed to upload skill", error);
      const err = error as { response?: { data?: { detail?: string } }, message?: string };
      const errorMessage = err.response?.data?.detail || err.message || t('unknownError');
      alert(t('uploadFailed') + ': ' + errorMessage);
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAddSkill = async () => {
    if (!currentProject) return;
    if (newSkill.name && newSkill.description && newSkill.content) {
      try {
          if (editingSkill) {
              await api.put<Skill>(`/api/v1/skills/${encodeURIComponent(editingSkill.id)}?project_id=${currentProject.id}`, {
                  ...newSkill,
                  project_id: currentProject.id
              });
          } else {
              const skillToCreate = {
                  ...newSkill,
                  id: Date.now().toString(),
                  project_id: currentProject.id
              };
              await api.post<Skill>('/api/v1/skills', skillToCreate);
          }
          await fetchSkills();
          setNewSkill({ type: 'python', content: '', source: t('localImport'), status: t('safe') });
          setEditingSkill(null);
          setIsDialogOpen(false);
      } catch (error) {
          console.error("Failed to save skill", error);
      }
    }
  };

  const handleEditSkill = (skill: Skill) => {
    setEditingSkill(skill);
    setNewSkill(skill);
    setIsDialogOpen(true);
  };

  const handleDeleteSkill = async (id: string) => {
    if (!currentProject) return;
    if (!window.confirm(t('confirmDeleteSkill'))) return;
    try {
        await api.delete(`/api/v1/skills/${encodeURIComponent(id)}?project_id=${currentProject.id}`);
        setSkills(skills.filter(s => s.id !== id));
    } catch (error) {
        console.error("Failed to delete skill", error);
    }
  };

  const handleAddMcpServer = async () => {
    if (!currentProject) return;
    try {
      const payload: Partial<MCPServer> = {
        name: newMcp.name,
        type: newMcp.type,
        project_id: currentProject.id
      };

      if (newMcp.type === 'stdio') {
        payload.command = newMcp.command;
        try {
          payload.args = mcpArgsStr ? JSON.parse(mcpArgsStr) : [];
        } catch {
          alert("Args must be a valid JSON array");
          return;
        }
        try {
          payload.env = mcpEnvStr ? JSON.parse(mcpEnvStr) : {};
        } catch {
          alert("Env must be a valid JSON object");
          return;
        }
      } else {
        payload.url = newMcp.url;
        try {
          payload.headers = mcpHeadersStr ? JSON.parse(mcpHeadersStr) : {};
        } catch {
          alert("Headers must be a valid JSON object");
          return;
        }
      }

      if (editingMcp && editingMcp.id) {
        await api.put(`/api/v1/mcp/${editingMcp.id}?project_id=${currentProject.id}`, payload);
      } else {
        await api.post(`/api/v1/mcp`, payload);
      }
      
      await fetchMcpServers();
      setIsMcpDialogOpen(false);
      setEditingMcp(null);
      setNewMcp({ type: 'stdio' });
      setMcpArgsStr('');
      setMcpEnvStr('');
      setMcpHeadersStr('');
    } catch (error: unknown) {
      console.error("Failed to save MCP server", error);
      const err = error as { response?: { data?: { detail?: string } }, message?: string };
      alert(t('saveFailed') + (err.response?.data?.detail || err.message));
    }
  };

  const handleEditMcpServer = (mcp: MCPServer) => {
    setEditingMcp(mcp);
    setNewMcp(mcp);
    setMcpArgsStr(mcp.args ? JSON.stringify(mcp.args, null, 2) : '');
    setMcpEnvStr(mcp.env ? JSON.stringify(mcp.env, null, 2) : '');
    setMcpHeadersStr(mcp.headers ? JSON.stringify(mcp.headers, null, 2) : '');
    setIsMcpDialogOpen(true);
  };

  const handleDeleteMcpServer = async (id: string) => {
    if (!currentProject) return;
    if (!window.confirm(t('confirmDeleteMcpServer'))) return;
    try {
        await api.delete(`/api/v1/mcp/${id}?project_id=${currentProject.id}`);
        setMcpServers(mcpServers.filter(s => s.id !== id));
    } catch (error) {
        console.error("Failed to delete MCP server", error);
    }
  };

  if (!currentProject) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-4">
        <FolderOpen className="h-12 w-12 text-muted-foreground/30" />
        <p>{t('selectProjectToManageSkills')}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      <div className="h-14 px-6 flex items-center justify-between border-b border-border bg-background">
        <div className="flex items-center gap-2 text-foreground/80 font-medium">
          <Wand2 className="h-5 w-5 text-indigo-500" />
          {t('skillsRepository')}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-muted/50 rounded-lg p-1">
            <button 
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${activeTab === 'skills' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground/80'}`}
              onClick={() => setActiveTab('skills')}
            >
              {t('skills')}
            </button>
            <button 
              className={`relative px-3 py-1 text-sm font-medium rounded-md transition-colors ${activeTab === 'mcp' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground/80'}`}
              onClick={() => setActiveTab('mcp')}
            >
              {t('mcpConfig')}
              {hasMcpError && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" title="MCP Server Error" />
              )}
            </button>
          </div>
          {activeTab === 'skills' ? (
            <>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
                accept=".md,.zip,.tar.gz,.tgz"
              />
              <Button 
                className="h-9 bg-[#ff4d29] hover:bg-[#ff4d29]/90 text-white gap-2 rounded-md px-3"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" />{t('uploadSkill')}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                className="h-9 gap-2 rounded-md px-3"
                onClick={handleRefreshMcpHealth}
                disabled={isRefreshingMcpHealth}
              >
                {isRefreshingMcpHealth ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {t('refresh')}
              </Button>
              <Button 
                className="h-9 bg-[#ff4d29] hover:bg-[#ff4d29]/90 text-white gap-2 rounded-md px-3"
                onClick={() => setIsMcpDialogOpen(true)}
              >
                <Plus className="h-4 w-4" />{t('addMcpServer')}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-8 bg-muted/50/30">
        {activeTab === 'skills' ? (
          <div className="bg-background rounded-xl border border-border shadow-sm overflow-hidden min-w-[800px] lg:min-w-0">
          <Table className="table-fixed w-full">
            <TableHeader className="bg-muted/50/50">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[40%] font-semibold text-foreground/80 py-3 px-4 text-sm">{t('name')}</TableHead>
                <TableHead className="w-[15%] font-semibold text-foreground/80 py-3 px-4 text-sm">{t('source')}</TableHead>
                <TableHead className="w-[15%] font-semibold text-foreground/80 py-3 px-4 text-sm text-center">{t('installationTime')}</TableHead>
                <TableHead className="w-[15%] font-semibold text-foreground/80 py-3 px-4 text-sm text-center">{t('status')}</TableHead>
                <TableHead className="w-[15%] font-semibold text-foreground/80 py-3 px-4 text-sm text-right">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-24 text-center">
                    <div className="flex items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {skills.map((skill, index) => (
                    <TableRow key={`${skill.id}_${index}`} className="group hover:bg-muted/50/50 transition-colors border-border">
                      <TableCell className="py-4 px-4 overflow-hidden">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600 mt-0.5 shrink-0">
                            <Terminal className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-foreground text-sm md:text-base truncate flex-1" title={skill.name}>{skill.name}</h3>
                              {skill.type === 'agentskill' && (
                                <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded uppercase tracking-wider shrink-0">
                                  Agent
                                </span>
                              )}
                            </div>
                            <p 
                              className="text-muted-foreground text-xs leading-relaxed truncate cursor-help"
                              title={skill.description}
                            >
                              {skill.description}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-4 px-4 text-muted-foreground text-sm">
                        <div className="truncate" title={skill.source}>{skill.source}</div>
                      </TableCell>
                      <TableCell className="py-4 px-4 text-muted-foreground text-center text-xs">
                        <div className="truncate">{skill.installation_time}</div>
                      </TableCell>
                      <TableCell className="py-4 px-4 text-center">
                        <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] md:text-xs font-medium whitespace-nowrap ${
                          skill.status === t('safe') 
                          ? 'bg-green-50 text-green-700 border border-green-100' 
                          : 'bg-amber-50 text-amber-700 border border-amber-100'
                        }`}>
                          {skill.status === t('safe') ? (
                            <ShieldCheck className="h-3 w-3" />
                          ) : (
                            <AlertCircle className="h-3 w-3" />
                          )}
                          {skill.status}
                        </div>
                      </TableCell>
                      <TableCell className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-muted-foreground hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all shrink-0"
                            onClick={() => handleEditSkill(skill)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {!skill.is_builtin ? (
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 rounded-md transition-all shrink-0"
                              onClick={() => handleDeleteSkill(skill.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : (
                            <div className="h-8 w-8 shrink-0" />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {skills.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-24 text-center">
                        <div className="flex flex-col items-center gap-3 text-muted-foreground">
                          <div className="p-4 bg-muted/50 rounded-2xl">
                            <Terminal className="h-10 w-10 opacity-20" />
                          </div>
                          <p className="text-sm">{t('noSkillsInProjectClickImport')}</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              )}
            </TableBody>
          </Table>
        </div>
        ) : (
          <div className="bg-background rounded-xl border border-border shadow-sm overflow-hidden min-w-[800px] lg:min-w-0">
            <Table className="table-fixed w-full">
              <TableHeader className="bg-muted/50/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[25%] font-semibold text-foreground/80 py-3 px-4 text-sm">{t('mcpServerName')}</TableHead>
                  <TableHead className="w-[15%] font-semibold text-foreground/80 py-3 px-4 text-sm">{t('transport')}</TableHead>
                  <TableHead className="w-[30%] font-semibold text-foreground/80 py-3 px-4 text-sm">{t('content')}</TableHead>
                  <TableHead className="w-[15%] font-semibold text-foreground/80 py-3 px-4 text-sm">{t('status')}</TableHead>
                  <TableHead className="w-[15%] font-semibold text-foreground/80 py-3 px-4 text-sm text-right">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isMcpLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-24 text-center">
                      <div className="flex items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {mcpServers.map((mcp) => (
                      <TableRow key={mcp.id} className="group hover:bg-muted/50/50 transition-colors border-border">
                        <TableCell className="py-4 px-4 overflow-hidden">
                          <h3 className="font-bold text-foreground text-sm md:text-base truncate flex-1" title={mcp.name}>{mcp.name}</h3>
                        </TableCell>
                        <TableCell className="py-4 px-4 text-muted-foreground text-sm">
                          {mcp.type}
                        </TableCell>
                        <TableCell className="py-4 px-4 text-muted-foreground text-sm truncate" title={mcp.type === 'stdio' ? mcp.command : mcp.url}>
                          {mcp.type === 'stdio' ? mcp.command : mcp.url}
                        </TableCell>
                        <TableCell className="py-4 px-4 text-muted-foreground text-sm truncate">
                          <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] md:text-xs font-medium whitespace-nowrap ${
                            mcp.status === 'connected' 
                            ? 'bg-green-50 text-green-700 border border-green-100' 
                            : mcp.status.startsWith('error')
                            ? 'bg-red-50 text-red-700 border border-red-100'
                            : 'bg-muted/50 text-foreground/80 border border-border'
                          }`}
                          title={mcp.status}
                          >
                            {mcp.status === 'connected' ? (
                              <ShieldCheck className="h-3 w-3" />
                            ) : (
                              <AlertCircle className="h-3 w-3" />
                            )}
                            <span className="truncate max-w-[150px]">{mcp.status}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-4 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-muted-foreground hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all shrink-0"
                              onClick={() => handleEditMcpServer(mcp)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 rounded-md transition-all shrink-0"
                              onClick={() => handleDeleteMcpServer(mcp.id!)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {mcpServers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-24 text-center">
                          <div className="flex flex-col items-center gap-3 text-muted-foreground">
                            <div className="p-4 bg-muted/50 rounded-2xl">
                              <Terminal className="h-10 w-10 opacity-20" />
                            </div>
                            <p className="text-sm">{t('noMcpServers')}</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
              setEditingSkill(null);
              setNewSkill({ type: 'python', content: '', source: t('localImport'), status: t('safe') });
          }
      }}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col rounded-2xl p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="text-xl font-bold text-foreground">{editingSkill ? t('viewOrEditSkill') : t('addNewSkill')}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-2">
            <div className="grid gap-5">
              <div className="grid gap-1.5">
                <Label htmlFor="name" className="text-muted-foreground font-medium text-sm">{t('name')}</Label>
                <Input 
                  id="name" 
                  placeholder={t('skillName')}
                  value={newSkill.name || ''} 
                  onChange={(e) => setNewSkill({...newSkill, name: e.target.value})}
                  className="rounded-lg border-border h-10" 
                  disabled={editingSkill?.is_builtin}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="type" className="text-muted-foreground font-medium text-sm">{t('type')}</Label>
                  <Select 
                      value={newSkill.type} 
                      onValueChange={(val) => { if (val) setNewSkill({...newSkill, type: val}) }}
                      disabled={editingSkill?.is_builtin}
                  >
                      <SelectTrigger className="rounded-lg border-border h-10">
                          <SelectValue placeholder={t('selectType')} />
                      </SelectTrigger>
                      <SelectContent className="rounded-lg">
                          <SelectItem value="python">Python</SelectItem>
                          <SelectItem value="sql">SQL</SelectItem>
                          <SelectItem value="api">API</SelectItem>
                      </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="status" className="text-muted-foreground font-medium text-sm">{t('status')}</Label>
                  <Select 
                      value={newSkill.status} 
                      onValueChange={(val) => { if (val) setNewSkill({...newSkill, status: val}) }}
                      disabled={editingSkill?.is_builtin}
                  >
                      <SelectTrigger className="rounded-lg border-border h-10">
                          <SelectValue placeholder={t('selectStatus')} />
                      </SelectTrigger>
                      <SelectContent className="rounded-lg">
                          <SelectItem value={t('safe')}>{t('safe')}</SelectItem>
                          <SelectItem value={t('lowRisk')}>{t('lowRisk')}</SelectItem>
                      </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="description" className="text-muted-foreground font-medium text-sm">{t('description')}</Label>
                <Textarea 
                  id="description" 
                  placeholder={t('brieflyDescribeSkillFunction')}
                  value={newSkill.description || ''} 
                  onChange={(e) => setNewSkill({...newSkill, description: e.target.value})}
                  className="rounded-lg border-border min-h-[80px] py-2 text-sm" 
                  disabled={editingSkill?.is_builtin}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="content" className="text-muted-foreground font-medium text-sm">{t('content')}</Label>
                <Textarea 
                  id="content" 
                  value={newSkill.content || ''} 
                  onChange={(e) => setNewSkill({...newSkill, content: e.target.value})}
                  className="rounded-lg border-border font-mono text-xs min-h-[160px] py-3 bg-muted/50" 
                  placeholder={t('pythonSqlApiContentPlaceholder')}
                  disabled={editingSkill?.is_builtin}
                />
              </div>
            </div>
          </div>
          <DialogFooter className="p-6 pt-2">
            {!editingSkill?.is_builtin && (
              <Button onClick={handleAddSkill} className="bg-indigo-600 hover:bg-indigo-700 text-primary-foreground rounded-lg px-6 h-10 w-full">{t('saveSkill')}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isMcpDialogOpen} onOpenChange={(open) => {
          setIsMcpDialogOpen(open);
          if (!open) {
              setEditingMcp(null);
              setNewMcp({ type: 'stdio' });
              setMcpArgsStr('');
              setMcpEnvStr('');
              setMcpHeadersStr('');
          }
      }}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col rounded-2xl p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="text-xl font-bold text-foreground">{editingMcp ? t('editMcpServer') : t('addMcpServer')}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-2">
            <div className="grid gap-5">
              <div className="grid gap-1.5">
                <Label htmlFor="mcp-name" className="text-muted-foreground font-medium text-sm">{t('name')}</Label>
                <Input 
                  id="mcp-name" 
                  placeholder={t('mcpServerName')}
                  value={newMcp.name || ''} 
                  onChange={(e) => setNewMcp({...newMcp, name: e.target.value})}
                  className="rounded-lg border-border h-10" 
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="transport" className="text-muted-foreground font-medium text-sm">{t('transport')}</Label>
                <Select 
                    value={newMcp.type} 
                    onValueChange={(val) => { if (val) setNewMcp({...newMcp, type: val as 'stdio' | 'sse' | 'streamableHttp'}) }}
                >
                    <SelectTrigger className="rounded-lg border-border h-10">
                        <SelectValue placeholder={t('transport')} />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg">
                        <SelectItem value="stdio">stdio</SelectItem>
                        <SelectItem value="sse">sse</SelectItem>
                        <SelectItem value="streamableHttp">streamableHttp</SelectItem>
                    </SelectContent>
                </Select>
              </div>

              {newMcp.type === 'stdio' ? (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="command" className="text-muted-foreground font-medium text-sm">{t('command')}</Label>
                    <Input 
                      id="command" 
                      placeholder="e.g. npx, python"
                      value={newMcp.command || ''} 
                      onChange={(e) => setNewMcp({...newMcp, command: e.target.value})}
                      className="rounded-lg border-border h-10" 
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="args" className="text-muted-foreground font-medium text-sm">{t('args')}</Label>
                    <Textarea 
                      id="args" 
                      value={mcpArgsStr} 
                      onChange={(e) => setMcpArgsStr(e.target.value)}
                      className="rounded-lg border-border font-mono text-xs min-h-[80px] py-3 bg-muted/50" 
                      placeholder='e.g. ["-y", "@modelcontextprotocol/server-everything"]'
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="env" className="text-muted-foreground font-medium text-sm">{t('env')}</Label>
                    <Textarea 
                      id="env" 
                      value={mcpEnvStr} 
                      onChange={(e) => setMcpEnvStr(e.target.value)}
                      className="rounded-lg border-border font-mono text-xs min-h-[80px] py-3 bg-muted/50" 
                      placeholder='e.g. {"FOO": "bar"}'
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="url" className="text-muted-foreground font-medium text-sm">{t('url')}</Label>
                    <Input 
                      id="url" 
                      placeholder="e.g. http://localhost:8000/sse"
                      value={newMcp.url || ''} 
                      onChange={(e) => setNewMcp({...newMcp, url: e.target.value})}
                      className="rounded-lg border-border h-10" 
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="headers" className="text-muted-foreground font-medium text-sm">{t('headers')}</Label>
                    <Textarea 
                      id="headers" 
                      value={mcpHeadersStr} 
                      onChange={(e) => setMcpHeadersStr(e.target.value)}
                      className="rounded-lg border-border font-mono text-xs min-h-[80px] py-3 bg-muted/50" 
                      placeholder='e.g. {"Authorization": "Bearer token"}'
                    />
                  </div>
                </>
              )}
            </div>
          </div>
          <DialogFooter className="p-6 pt-2">
            <Button onClick={handleAddMcpServer} className="bg-indigo-600 hover:bg-indigo-700 text-primary-foreground rounded-lg px-6 h-10 w-full">{t('saveMcpServer')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
