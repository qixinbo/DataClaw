import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Terminal, Loader2, FolderOpen, Eye, ShieldCheck, AlertCircle, Wand2, Upload, Plus, RefreshCw, HeartPulse } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { a2aApi, type A2ARemoteAgent, type A2ATask, type A2AArtifact, renderPart, renderParts, getArtifactPreview, groupTasksByContextId } from "@/api/a2a";
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

interface A2ARemoteAgentForm {
  name: string;
  base_url: string;
  auth_scheme: "none" | "bearer";
  auth_token: string;
}

const SOURCE_LOCAL_IMPORT = "local_import";
const SOURCE_SYSTEM_BUILTIN = "system_builtin";
const SOURCE_BACKEND_GENERATED = "backend_generated";
const SOURCE_UPLOADED_FILE = "uploaded_file";

const STATUS_SAFE = "safe";
const STATUS_LOW_RISK = "low_risk";

const normalizeSkillSource = (value?: string): string => {
  if (!value) return SOURCE_LOCAL_IMPORT;
  if (value === SOURCE_LOCAL_IMPORT || value === "本地导入" || value === "Local Import") return SOURCE_LOCAL_IMPORT;
  if (value === SOURCE_SYSTEM_BUILTIN || value === "系统内置" || value === "System Built-in") return SOURCE_SYSTEM_BUILTIN;
  if (value === SOURCE_BACKEND_GENERATED || value === "后台生成" || value === "Backend Generated") return SOURCE_BACKEND_GENERATED;
  if (value === SOURCE_UPLOADED_FILE || value === "文件上传" || value === "File Upload") return SOURCE_UPLOADED_FILE;
  return value;
};

const normalizeSkillStatus = (value?: string): string => {
  if (!value) return STATUS_SAFE;
  if (value === STATUS_SAFE || value === "安全" || value === "Safe") return STATUS_SAFE;
  if (value === STATUS_LOW_RISK || value === "低风险" || value === "Low Risk") return STATUS_LOW_RISK;
  return value;
};

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
  const [activeTab, setActiveTab] = useState<'skills' | 'mcp' | 'a2a'>('skills');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  // Skills state
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [newSkill, setNewSkill] = useState<Partial<Skill>>({ type: 'python', content: '', source: SOURCE_LOCAL_IMPORT, status: STATUS_SAFE });
  
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

  const [a2aAgents, setA2aAgents] = useState<A2ARemoteAgent[]>([]);
  const [a2aTasks, setA2aTasks] = useState<A2ATask[]>([]);
  const [a2aTaskStateFilter, setA2aTaskStateFilter] = useState<string>('all');
  const [isA2aLoading, setIsA2aLoading] = useState(false);
  const [isA2aDialogOpen, setIsA2aDialogOpen] = useState(false);
  const [editingA2aAgent, setEditingA2aAgent] = useState<A2ARemoteAgent | null>(null);
  const [a2aForm, setA2aForm] = useState<A2ARemoteAgentForm>({
    name: '',
    base_url: '',
    auth_scheme: 'none',
    auth_token: '',
  });
  const [isA2aRefreshingHealth, setIsA2aRefreshingHealth] = useState(false);
  const [selectedA2aAgent, setSelectedA2aAgent] = useState<A2ARemoteAgent | null>(null);
  const [selectedTask, setSelectedTask] = useState<A2ATask | null>(null);
  const [taskArtifactPreview, setTaskArtifactPreview] = useState<{ type: string; content: string } | null>(null);
  const [contextIdFilter, setContextIdFilter] = useState<string>('all');
  const [groupedByContextId, setGroupedByContextId] = useState<Map<string, A2ATask[]>>(new Map());

  const { currentProject } = useProjectStore();
  const { hasMcpError, refresh: refreshMcpHealth } = useMcpHealthStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const getSourceLabel = (source: string): string => {
    if (source === 'all') return t('allSources');
    if (source === SOURCE_SYSTEM_BUILTIN) return t('systemBuiltin');
    if (source === SOURCE_BACKEND_GENERATED) return t('backendGenerated');
    if (source === SOURCE_UPLOADED_FILE) return t('uploadedFile');
    if (source === SOURCE_LOCAL_IMPORT) return t('localImport');
    return source;
  };

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

    const fetchA2aData = async () => {
      if (!currentProject) return;
      setIsA2aLoading(true);
      try {
        const [agents, tasks] = await Promise.all([
          a2aApi.listRemoteAgents(currentProject.id),
          a2aApi.listTasks(currentProject.id, a2aTaskStateFilter),
        ]);
        setA2aAgents(agents || []);
        setA2aTasks(tasks || []);
      } catch (error) {
        console.error("Failed to fetch A2A data", error);
      } finally {
        setIsA2aLoading(false);
      }
    };

    if (currentProject) {
      void refreshMcpHealth(currentProject.id);
      if (activeTab === 'skills') {
        void fetchSkills();
      } else if (activeTab === 'mcp') {
        void fetchMcpServers();
      } else {
        void fetchA2aData();
      }
    }
  }, [currentProject, currentProject?.id, activeTab, refreshMcpHealth, a2aTaskStateFilter]);

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

  // Get unique sources for the filter dropdown
  const uniqueSources = Array.from(new Set(skills.map(s => normalizeSkillSource(s.source)))).filter(Boolean);

  // Filtered skills
  const filteredSkills = sourceFilter === 'all'
    ? skills
    : skills.filter(skill => normalizeSkillSource(skill.source) === sourceFilter);

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

  const fetchA2aData = async () => {
    if (!currentProject) return;
    setIsA2aLoading(true);
    try {
      const [agents, tasks] = await Promise.all([
        a2aApi.listRemoteAgents(currentProject.id),
        a2aApi.listTasks(currentProject.id, a2aTaskStateFilter),
      ]);
      setA2aAgents(agents || []);
      setA2aTasks(tasks || []);
      setGroupedByContextId(groupTasksByContextId(tasks || []));
    } catch (error) {
      console.error("Failed to fetch A2A data", error);
    } finally {
      setIsA2aLoading(false);
    }
  };

  const handlePreviewArtifact = (artifact: A2AArtifact) => {
    const preview = getArtifactPreview(artifact);
    setTaskArtifactPreview(preview);
  };

  const handleTaskClick = (task: A2ATask) => {
    setSelectedTask(task);
    if (task.artifacts && task.artifacts.length > 0) {
      const preview = getArtifactPreview(task.artifacts[0]);
      setTaskArtifactPreview(preview);
    } else {
      setTaskArtifactPreview(null);
    }
  };

  const handleAgentCardClick = (agent: A2ARemoteAgent) => {
    setSelectedA2aAgent(agent);
  };

  const handleRefreshA2aHealth = async () => {
    if (!currentProject || a2aAgents.length === 0) return;
    setIsA2aRefreshingHealth(true);
    try {
      await Promise.all(a2aAgents.map((agent) => a2aApi.healthCheckRemoteAgent(agent.id)));
      await fetchA2aData();
    } finally {
      setIsA2aRefreshingHealth(false);
    }
  };

  const handleOpenCreateA2a = () => {
    setEditingA2aAgent(null);
    setA2aForm({
      name: '',
      base_url: '',
      auth_scheme: 'none',
      auth_token: '',
    });
    setIsA2aDialogOpen(true);
  };

  const handleOpenEditA2a = (agent: A2ARemoteAgent) => {
    setEditingA2aAgent(agent);
    setA2aForm({
      name: agent.name,
      base_url: agent.base_url,
      auth_scheme: agent.auth_scheme,
      auth_token: '',
    });
    setIsA2aDialogOpen(true);
  };

  const handleSaveA2aAgent = async () => {
    if (!currentProject) return;
    if (!a2aForm.name.trim() || !a2aForm.base_url.trim()) return;
    const payload = {
      name: a2aForm.name.trim(),
      base_url: a2aForm.base_url.trim(),
      auth_scheme: a2aForm.auth_scheme,
      ...(a2aForm.auth_scheme === 'bearer' && a2aForm.auth_token.trim() ? { auth_token: a2aForm.auth_token.trim() } : {}),
    };
    try {
      if (editingA2aAgent) {
        await a2aApi.updateRemoteAgent(editingA2aAgent.id, payload);
      } else {
        await a2aApi.createRemoteAgent({
          project_id: currentProject.id,
          ...payload,
        });
      }
      setIsA2aDialogOpen(false);
      await fetchA2aData();
    } catch (error) {
      console.error("Failed to save A2A agent", error);
    }
  };

  const handleDeleteA2aAgent = async (agentId: number) => {
    if (!window.confirm(t('confirmDeleteA2aAgent'))) return;
    try {
      await a2aApi.deleteRemoteAgent(agentId);
      await fetchA2aData();
    } catch (error) {
      console.error("Failed to delete A2A agent", error);
    }
  };

  const handleRefreshA2aCard = async (agentId: number) => {
    try {
      await a2aApi.refreshRemoteAgentCard(agentId);
      await fetchA2aData();
    } catch (error) {
      console.error("Failed to refresh A2A card", error);
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
          setNewSkill({ type: 'python', content: '', source: SOURCE_LOCAL_IMPORT, status: STATUS_SAFE });
          setEditingSkill(null);
          setIsDialogOpen(false);
      } catch (error) {
          console.error("Failed to save skill", error);
      }
    }
  };

  const handleEditSkill = (skill: Skill) => {
    setEditingSkill(skill);
    setNewSkill({
      ...skill,
      source: normalizeSkillSource(skill.source),
      status: normalizeSkillStatus(skill.status),
    });
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
            <button
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${activeTab === 'a2a' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground/80'}`}
              onClick={() => setActiveTab('a2a')}
            >
              {t('a2aConfig')}
            </button>
          </div>
          {activeTab === 'skills' ? (
            <>
                {uniqueSources.length > 0 && (
                  <Select value={sourceFilter} onValueChange={(val) => { if (val) setSourceFilter(val); }}>
                    <SelectTrigger className="w-[140px] h-9">
                      <SelectValue placeholder={t('filterBySource')}>
                        {getSourceLabel(sourceFilter)}
                      </SelectValue>
                    </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('allSources')}</SelectItem>
                    {uniqueSources.map(source => (
                      <SelectItem key={source} value={source}>
                        {getSourceLabel(source)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
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
                disabled={isLoading}
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {isLoading ? t('uploading', '上传中...') : t('uploadSkill')}
              </Button>
            </>
          ) : activeTab === 'mcp' ? (
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
          ) : (
            <>
              <Select value={a2aTaskStateFilter} onValueChange={(val) => { if (val) setA2aTaskStateFilter(val); }}>
                <SelectTrigger className="w-[150px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allStates')}</SelectItem>
                  <SelectItem value="SUBMITTED">SUBMITTED</SelectItem>
                  <SelectItem value="WORKING">WORKING</SelectItem>
                  <SelectItem value="COMPLETED">COMPLETED</SelectItem>
                  <SelectItem value="FAILED">FAILED</SelectItem>
                  <SelectItem value="CANCELED">CANCELED</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                className="h-9 gap-2 rounded-md px-3"
                onClick={handleRefreshA2aHealth}
                disabled={isA2aRefreshingHealth || a2aAgents.length === 0}
              >
                {isA2aRefreshingHealth ? <Loader2 className="h-4 w-4 animate-spin" /> : <HeartPulse className="h-4 w-4" />}
                {t('refreshHealth')}
              </Button>
              <Button
                variant="outline"
                className="h-9 gap-2 rounded-md px-3"
                onClick={() => void fetchA2aData()}
              >
                <RefreshCw className="h-4 w-4" />
                {t('refresh')}
              </Button>
              <Select value={contextIdFilter} onValueChange={(val) => { if (val) setContextIdFilter(val); }}>
                <SelectTrigger className="w-[180px] h-9">
                  <SelectValue placeholder={t('filterByContext')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allContexts')}</SelectItem>
                  {Array.from(groupedByContextId.keys()).filter(k => k !== 'no-context').map(contextId => (
                    <SelectItem key={contextId} value={contextId}>{contextId.slice(0, 16)}...</SelectItem>
                  ))}
                  {groupedByContextId.has('no-context') && (
                    <SelectItem value="no-context">{t('noContext')}</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <Button
                className="h-9 bg-[#ff4d29] hover:bg-[#ff4d29]/90 text-white gap-2 rounded-md px-3"
                onClick={handleOpenCreateA2a}
              >
                <Plus className="h-4 w-4" />{t('addA2aAgent')}
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
                  {filteredSkills.map((skill, index) => (
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
                        <div className="truncate" title={skill.source}>
                          {normalizeSkillSource(skill.source) === SOURCE_SYSTEM_BUILTIN ? t('systemBuiltin') :
                           normalizeSkillSource(skill.source) === SOURCE_BACKEND_GENERATED ? t('backendGenerated') :
                           normalizeSkillSource(skill.source) === SOURCE_UPLOADED_FILE ? t('uploadedFile') :
                           normalizeSkillSource(skill.source) === SOURCE_LOCAL_IMPORT ? t('localImport') :
                           skill.source}
                        </div>
                      </TableCell>
                      <TableCell className="py-4 px-4 text-muted-foreground text-center text-xs">
                        <div className="truncate">{skill.installation_time}</div>
                      </TableCell>
                      <TableCell className="py-4 px-4 text-center">
                        <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] md:text-xs font-medium whitespace-nowrap ${
                          normalizeSkillStatus(skill.status) === STATUS_SAFE
                          ? 'bg-green-50 text-green-700 border border-green-100' 
                          : 'bg-amber-50 text-amber-700 border border-amber-100'
                        }`}>
                          {normalizeSkillStatus(skill.status) === STATUS_SAFE ? (
                            <ShieldCheck className="h-3 w-3" />
                          ) : (
                            <AlertCircle className="h-3 w-3" />
                          )}
                          {normalizeSkillStatus(skill.status) === STATUS_SAFE
                            ? t('safe')
                            : normalizeSkillStatus(skill.status) === STATUS_LOW_RISK
                              ? t('lowRisk')
                              : skill.status}
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
                  {filteredSkills.length === 0 && (
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
        ) : activeTab === 'mcp' ? (
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
                            !mcp.status || mcp.status === 'connected' 
                            ? 'bg-green-50 text-green-700 border border-green-100' 
                            : mcp.status.startsWith('error')
                            ? 'bg-rose-50 text-rose-700 border border-rose-100'
                            : 'bg-amber-50 text-amber-700 border border-amber-100'
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
        ) : (
          <div className="space-y-4">
            <div className="bg-background rounded-xl border border-border shadow-sm overflow-hidden min-w-[800px] lg:min-w-0">
              <div className="px-4 py-3 border-b border-border text-sm font-semibold text-foreground/80">
                {t('a2aAgentManagement')}
              </div>
              <Table className="table-fixed w-full">
                <TableHeader className="bg-muted/50/50">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[20%] font-semibold text-foreground/80 py-3 px-4 text-sm">{t('name')}</TableHead>
                    <TableHead className="w-[24%] font-semibold text-foreground/80 py-3 px-4 text-sm">{t('url')}</TableHead>
                    <TableHead className="w-[10%] font-semibold text-foreground/80 py-3 px-4 text-sm">{t('protocol')}</TableHead>
                    <TableHead className="w-[16%] font-semibold text-foreground/80 py-3 px-4 text-sm">{t('capabilities')}</TableHead>
                    <TableHead className="w-[15%] font-semibold text-foreground/80 py-3 px-4 text-sm">{t('healthStatus')}</TableHead>
                    <TableHead className="w-[15%] font-semibold text-foreground/80 py-3 px-4 text-sm text-right">{t('actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isA2aLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-20 text-center">
                        <Loader2 className="h-8 w-8 animate-spin text-indigo-500 mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : a2aAgents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-16 text-center text-muted-foreground">{t('noA2aAgents')}</TableCell>
                    </TableRow>
                  ) : (
                    a2aAgents.map((agent) => (
                      <TableRow key={agent.id} className="group hover:bg-muted/50/50 transition-colors border-border cursor-pointer" onClick={() => handleAgentCardClick(agent)}>
                        <TableCell className="py-4 px-4 text-sm font-medium">{agent.name}</TableCell>
                        <TableCell className="py-4 px-4 text-sm text-muted-foreground truncate" title={agent.base_url}>{agent.base_url}</TableCell>
                        <TableCell className="py-4 px-4 text-sm text-muted-foreground">{agent.protocol_version || '-'}</TableCell>
                        <TableCell className="py-4 px-4 text-sm text-muted-foreground truncate" title={agent.capabilities.join(', ')}>{agent.capabilities.join(', ') || '-'}</TableCell>
                        <TableCell className="py-4 px-4">
                          <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] md:text-xs font-medium whitespace-nowrap ${agent.healthy ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
                            {agent.healthy ? <ShieldCheck className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                            {agent.healthy ? t('healthy') : t('unhealthy')}
                            <span className="opacity-70">#{agent.failure_count}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-4 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all shrink-0" onClick={() => void handleRefreshA2aCard(agent.id)}>
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all shrink-0" onClick={() => handleOpenEditA2a(agent)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 rounded-md transition-all shrink-0" onClick={() => void handleDeleteA2aAgent(agent.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="bg-background rounded-xl border border-border shadow-sm overflow-hidden min-w-[800px] lg:min-w-0">
              <div className="px-4 py-3 border-b border-border text-sm font-semibold text-foreground/80">
                {t('a2aTaskObservability')}
              </div>
              <Table className="table-fixed w-full">
                <TableHeader className="bg-muted/50/50">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[16%] font-semibold text-foreground/80 py-3 px-4 text-sm">{t('taskId')}</TableHead>
                    <TableHead className="w-[12%] font-semibold text-foreground/80 py-3 px-4 text-sm">{t('contextId')}</TableHead>
                    <TableHead className="w-[10%] font-semibold text-foreground/80 py-3 px-4 text-sm">{t('taskSource')}</TableHead>
                    <TableHead className="w-[10%] font-semibold text-foreground/80 py-3 px-4 text-sm">{t('status')}</TableHead>
                    <TableHead className="w-[32%] font-semibold text-foreground/80 py-3 px-4 text-sm">{t('content')}</TableHead>
                    <TableHead className="w-[20%] font-semibold text-foreground/80 py-3 px-4 text-sm">{t('time')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isA2aLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-16 text-center">
                        <Loader2 className="h-8 w-8 animate-spin text-indigo-500 mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : a2aTasks.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-14 text-center text-muted-foreground">{t('noA2aTasks')}</TableCell>
                    </TableRow>
                  ) : (
                    a2aTasks.map((task) => (
                      <TableRow key={task.id} className="group hover:bg-muted/50/50 transition-colors border-border cursor-pointer" onClick={() => handleTaskClick(task)}>
                        <TableCell className="py-4 px-4 text-xs font-mono truncate" title={task.id}>{task.id}</TableCell>
                        <TableCell className="py-4 px-4 text-xs font-mono truncate text-muted-foreground" title={task.context_id || ''}>{task.context_id ? task.context_id.slice(0, 12) + '...' : '-'}</TableCell>
                        <TableCell className="py-4 px-4 text-sm text-muted-foreground">{task.source}</TableCell>
                        <TableCell className="py-4 px-4 text-sm">{task.state}</TableCell>
                        <TableCell className="py-4 px-4 text-xs text-muted-foreground">
                          <div className="line-clamp-2" title={task.error_message || task.output_text || task.input_text || (task.input_parts ? renderParts(task.input_parts) : '')}>
                            {task.error_message || task.output_text || task.input_text || (task.input_parts ? renderParts(task.input_parts) : '')}
                          </div>
                          {task.artifacts && task.artifacts.length > 0 && (
                            <div className="mt-1 text-[10px] text-indigo-600">
                              {task.artifacts.length} artifact(s)
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="py-4 px-4 text-xs text-muted-foreground">{task.updated_at}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
              setEditingSkill(null);
              setNewSkill({ type: 'python', content: '', source: SOURCE_LOCAL_IMPORT, status: STATUS_SAFE });
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
                      value={normalizeSkillStatus(newSkill.status)}
                      onValueChange={(val) => { if (val) setNewSkill({...newSkill, status: val}) }}
                      disabled={editingSkill?.is_builtin}
                  >
                      <SelectTrigger className="rounded-lg border-border h-10">
                          <SelectValue placeholder={t('selectStatus')} />
                      </SelectTrigger>
                      <SelectContent className="rounded-lg">
                          <SelectItem value={STATUS_SAFE}>{t('safe')}</SelectItem>
                          <SelectItem value={STATUS_LOW_RISK}>{t('lowRisk')}</SelectItem>
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

      <Dialog open={isA2aDialogOpen} onOpenChange={(open) => {
          setIsA2aDialogOpen(open);
          if (!open) {
            setEditingA2aAgent(null);
            setA2aForm({
              name: '',
              base_url: '',
              auth_scheme: 'none',
              auth_token: '',
            });
          }
      }}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col rounded-2xl p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="text-xl font-bold text-foreground">{editingA2aAgent ? t('editA2aAgent') : t('addA2aAgent')}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-2">
            <div className="grid gap-5">
              <div className="grid gap-1.5">
                <Label htmlFor="a2a-name" className="text-muted-foreground font-medium text-sm">{t('name')}</Label>
                <Input
                  id="a2a-name"
                  placeholder={t('a2aAgentName')}
                  value={a2aForm.name}
                  onChange={(e) => setA2aForm({ ...a2aForm, name: e.target.value })}
                  className="rounded-lg border-border h-10"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="a2a-url" className="text-muted-foreground font-medium text-sm">{t('baseUrl')}</Label>
                <Input
                  id="a2a-url"
                  placeholder="https://example-agent.com"
                  value={a2aForm.base_url}
                  onChange={(e) => setA2aForm({ ...a2aForm, base_url: e.target.value })}
                  className="rounded-lg border-border h-10"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="a2a-auth-scheme" className="text-muted-foreground font-medium text-sm">{t('authScheme')}</Label>
                <Select value={a2aForm.auth_scheme} onValueChange={(val) => { if (val) setA2aForm({ ...a2aForm, auth_scheme: val as "none" | "bearer" }); }}>
                  <SelectTrigger className="rounded-lg border-border h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg">
                    <SelectItem value="none">none</SelectItem>
                    <SelectItem value="bearer">bearer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {a2aForm.auth_scheme === 'bearer' ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="a2a-auth-token" className="text-muted-foreground font-medium text-sm">{t('authToken')}</Label>
                  <Input
                    id="a2a-auth-token"
                    placeholder={editingA2aAgent ? t('leaveEmptyToKeepUnchanged') : t('enterApiKey')}
                    value={a2aForm.auth_token}
                    onChange={(e) => setA2aForm({ ...a2aForm, auth_token: e.target.value })}
                    className="rounded-lg border-border h-10"
                  />
                </div>
              ) : null}
            </div>
          </div>
          <DialogFooter className="p-6 pt-2">
            <Button onClick={handleSaveA2aAgent} className="bg-indigo-600 hover:bg-indigo-700 text-primary-foreground rounded-lg px-6 h-10 w-full">{t('saveA2aAgent')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedA2aAgent} onOpenChange={(open) => { if (!open) setSelectedA2aAgent(null); }}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col rounded-2xl p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="text-xl font-bold text-foreground">{selectedA2aAgent?.name} - Agent Card</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-2">
            {selectedA2aAgent?.agent_card ? (
              <div className="grid gap-4">
                {selectedA2aAgent.agent_card.description && (
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">{t('description')}</Label>
                    <p className="text-sm text-foreground">{selectedA2aAgent.agent_card.description}</p>
                  </div>
                )}
                {selectedA2aAgent.agent_card.url && (
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">URL</Label>
                    <a href={selectedA2aAgent.agent_card.url} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 hover:underline">{selectedA2aAgent.agent_card.url}</a>
                  </div>
                )}
                {selectedA2aAgent.agent_card.provider && (
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">{t('provider')}</Label>
                    <div className="text-sm text-foreground">
                      {selectedA2aAgent.agent_card.provider.organization && <span>{selectedA2aAgent.agent_card.provider.organization}</span>}
                      {selectedA2aAgent.agent_card.provider.url && <span> - <a href={selectedA2aAgent.agent_card.provider.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">{selectedA2aAgent.agent_card.provider.url}</a></span>}
                    </div>
                  </div>
                )}
                {selectedA2aAgent.agent_card.skills && selectedA2aAgent.agent_card.skills.length > 0 && (
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">{t('skills')}</Label>
                    <div className="space-y-2">
                      {selectedA2aAgent.agent_card.skills.map((skill, idx) => (
                        <div key={idx} className="p-3 bg-muted/50 rounded-lg">
                          <div className="font-medium text-sm">{skill.name}</div>
                          {skill.description && <p className="text-xs text-muted-foreground mt-1">{skill.description}</p>}
                          {skill.tags && skill.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {skill.tags.map((tag, i) => (
                                <span key={i} className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] rounded-full">{tag}</span>
                              ))}
                            </div>
                          )}
                          {skill.inputModes && skill.inputModes.length > 0 && (
                            <div className="mt-1 text-xs text-muted-foreground">Input: {skill.inputModes.join(', ')}</div>
                          )}
                          {skill.outputModes && skill.outputModes.length > 0 && (
                            <div className="mt-1 text-xs text-muted-foreground">Output: {skill.outputModes.join(', ')}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {selectedA2aAgent.agent_card.supportedInterfaces && selectedA2aAgent.agent_card.supportedInterfaces.length > 0 && (
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">{t('supportedInterfaces')}</Label>
                    <div className="space-y-1">
                      {selectedA2aAgent.agent_card.supportedInterfaces.map((iface, idx) => (
                        <div key={idx} className="p-2 bg-muted/50 rounded text-xs">
                          <span className="font-medium">{iface.type}</span>
                          {iface.url && <span className="text-muted-foreground ml-2">{iface.url}</span>}
                          {iface.protocolVersion && <span className="text-muted-foreground ml-2">v{iface.protocolVersion}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {selectedA2aAgent.agent_card.defaultInputModes && selectedA2aAgent.agent_card.defaultInputModes.length > 0 && (
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">{t('defaultInputModes')}</Label>
                    <div className="flex flex-wrap gap-1">
                      {selectedA2aAgent.agent_card.defaultInputModes.map((mode, idx) => (
                        <span key={idx} className="px-2 py-0.5 bg-muted rounded text-xs">{mode}</span>
                      ))}
                    </div>
                  </div>
                )}
                {selectedA2aAgent.agent_card.defaultOutputModes && selectedA2aAgent.agent_card.defaultOutputModes.length > 0 && (
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">{t('defaultOutputModes')}</Label>
                    <div className="flex flex-wrap gap-1">
                      {selectedA2aAgent.agent_card.defaultOutputModes.map((mode, idx) => (
                        <span key={idx} className="px-2 py-0.5 bg-muted rounded text-xs">{mode}</span>
                      ))}
                    </div>
                  </div>
                )}
                {selectedA2aAgent.agent_card.iconUrl && (
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">{t('iconUrl')}</Label>
                    <img src={selectedA2aAgent.agent_card.iconUrl} alt="Agent Icon" className="h-16 w-16 rounded-lg object-contain" />
                  </div>
                )}
                {selectedA2aAgent.agent_card.documentationUrl && (
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">{t('documentationUrl')}</Label>
                    <a href={selectedA2aAgent.agent_card.documentationUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 hover:underline">{selectedA2aAgent.agent_card.documentationUrl}</a>
                  </div>
                )}
                {selectedA2aAgent.agent_card.security && selectedA2aAgent.agent_card.security.length > 0 && (
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">{t('security')}</Label>
                    <div className="text-xs text-muted-foreground font-mono bg-muted/50 p-2 rounded">
                      {JSON.stringify(selectedA2aAgent.agent_card.security, null, 2)}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>{t('noAgentCardAvailable')}</p>
                <p className="text-xs mt-2">{t('tryRefreshingCard')}</p>
              </div>
            )}
          </div>
          <DialogFooter className="p-6 pt-2">
            <Button variant="outline" onClick={() => setSelectedA2aAgent(null)}>{t('close')}</Button>
            {selectedA2aAgent && (
              <Button onClick={() => void handleRefreshA2aCard(selectedA2aAgent.id)} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                {t('refreshCard')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedTask} onOpenChange={(open) => { if (!open) { setSelectedTask(null); setTaskArtifactPreview(null); } }}>
        <DialogContent className="sm:max-w-[900px] max-h-[90vh] flex flex-col rounded-2xl p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="text-xl font-bold text-foreground">{t('taskDetails')}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-2">
            {selectedTask && (
              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">Task ID</Label>
                    <p className="text-sm font-mono break-all">{selectedTask.id}</p>
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">Context ID</Label>
                    <p className="text-sm font-mono break-all">{selectedTask.context_id || '-'}</p>
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">State</Label>
                    <p className="text-sm">{selectedTask.state}</p>
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">Source</Label>
                    <p className="text-sm">{selectedTask.source}</p>
                  </div>
                </div>

                {selectedTask.input_parts && selectedTask.input_parts.length > 0 && (
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">{t('inputParts')}</Label>
                    <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                      {selectedTask.input_parts.map((part, idx) => (
                        <div key={idx} className="text-sm">
                          {part.kind === 'text' && <p className="whitespace-pre-wrap">{part.text}</p>}
                          {part.kind === 'url' && <a href={part.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">{part.url}</a>}
                          {part.kind === 'file' && (
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">[{part.filename || 'file'}]</span>
                              {part.mediaType?.startsWith('image/') && <span className="text-xs text-muted-foreground">({part.mediaType})</span>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedTask.output_parts && selectedTask.output_parts.length > 0 && (
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">{t('outputParts')}</Label>
                    <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                      {selectedTask.output_parts.map((part, idx) => (
                        <div key={idx} className="text-sm">
                          {part.kind === 'text' && <p className="whitespace-pre-wrap">{part.text}</p>}
                          {part.kind === 'url' && <a href={part.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">{part.url}</a>}
                          {part.kind === 'file' && (
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">[{part.filename || 'file'}]</span>
                              {part.mediaType?.startsWith('image/') && <span className="text-xs text-muted-foreground">({part.mediaType})</span>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedTask.artifacts && selectedTask.artifacts.length > 0 && (
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">{t('artifacts')} ({selectedTask.artifacts.length})</Label>
                    <div className="space-y-2">
                      {selectedTask.artifacts.map((artifact, idx) => (
                        <div key={idx} className="border border-border rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-medium text-sm">
                              {artifact.name || `Artifact ${idx + 1}`}
                            </div>
                            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => handlePreviewArtifact(artifact)}>
                              <Eye className="h-3 w-3" />
                              {t('preview')}
                            </Button>
                          </div>
                          {artifact.description && (
                            <p className="text-xs text-muted-foreground mb-2">{artifact.description}</p>
                          )}
                          <div className="text-xs text-muted-foreground">
                            {artifact.parts.length} part(s)
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {taskArtifactPreview && (
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">{t('artifactPreview')}</Label>
                    <div className="border border-border rounded-lg p-3 bg-muted/50">
                      {taskArtifactPreview.type === 'text' && (
                        <pre className="text-xs whitespace-pre-wrap break-all max-h-[300px] overflow-auto">{taskArtifactPreview.content}</pre>
                      )}
                      {taskArtifactPreview.type === 'image' && (
                        <img src={taskArtifactPreview.content} alt="Artifact Preview" className="max-w-full max-h-[300px] rounded-lg object-contain" />
                      )}
                      {taskArtifactPreview.type === 'html' && (
                        <div className="text-xs text-muted-foreground italic">[HTML Preview - rendered separately]</div>
                      )}
                      {taskArtifactPreview.type === 'json' && (
                        <pre className="text-xs whitespace-pre-wrap break-all max-h-[300px] overflow-auto">{taskArtifactPreview.content}</pre>
                      )}
                      {taskArtifactPreview.type === 'unknown' && (
                        <p className="text-xs text-muted-foreground">{taskArtifactPreview.content}</p>
                      )}
                    </div>
                  </div>
                )}

                {selectedTask.error_message && (
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">{t('errorMessage')}</Label>
                    <div className="bg-rose-50 border border-rose-100 rounded-lg p-3 text-sm text-rose-700">
                      {selectedTask.error_message}
                    </div>
                  </div>
                )}

                {selectedTask.history && selectedTask.history.length > 0 && (
                  <div className="grid gap-1.5">
                    <Label className="text-muted-foreground font-medium text-sm">{t('messageHistory')} ({selectedTask.history.length})</Label>
                    <div className="space-y-2 max-h-[300px] overflow-auto">
                      {selectedTask.history.map((msg, idx) => (
                        <div key={idx} className={`p-3 rounded-lg ${msg.role === 'user' ? 'bg-blue-50 border border-blue-100' : 'bg-green-50 border border-green-100'}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium">{msg.role}</span>
                            {msg.messageId && <span className="text-[10px] text-muted-foreground font-mono">{msg.messageId.slice(0, 8)}...</span>}
                          </div>
                          <div className="text-xs">
                            {msg.parts.map((part, pIdx) => (
                              <div key={pIdx}>{renderPart(part)}</div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="p-6 pt-2">
            <Button variant="outline" onClick={() => { setSelectedTask(null); setTaskArtifactPreview(null); }}>{t('close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
