import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Menu, LayoutDashboard, Plus, MoreVertical, User, Search, Settings, Brain, Trash2, Pencil, Pin, Archive, Database, CheckSquare, Square, ListChecks, RotateCcw, Wand2, Folder, Globe, Bot, Mic, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/store/authStore";
import { useProjectStore } from "@/store/projectStore";
import { useDashboardStore } from "@/store/dashboardStore";
import { api } from "@/lib/api";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface SessionInfo {
  key: string;
  created_at: string;
  updated_at: string;
  alias?: string | null;
  pinned?: boolean;
  archived?: boolean;
  metadata?: {
    title?: string;
  };
}

function SectionHeader({
  title,
  count,
  isSelectionMode,
  setIsSelectionMode,
  selectedKeys,
  setSelectedKeys,
  items,
  onBatchDelete
}: {
  title: string;
  count: number;
  isSelectionMode: boolean;
  setIsSelectionMode: (val: boolean) => void;
  selectedKeys: string[];
  setSelectedKeys: (val: string[] | ((prev: string[]) => string[])) => void;
  items: SessionInfo[];
  onBatchDelete: (keys: string[]) => void;
}) {
  const { t } = useTranslation();

  const handleSelectAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedKeys.length === items.length && items.length > 0) {
      setSelectedKeys([]);
    } else {
      setSelectedKeys(items.map(item => item.key));
    }
  };

  const handleInvertSelection = (e: React.MouseEvent) => {
    e.stopPropagation();
    const allKeys = items.map(item => item.key);
    setSelectedKeys(allKeys.filter(key => !selectedKeys.includes(key)));
  };

  const handleBatchDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedKeys.length === 0) return;
    onBatchDelete(selectedKeys);
    setSelectedKeys([]);
    setIsSelectionMode(false);
  };

  useEffect(() => {
    if (!isSelectionMode) {
      setSelectedKeys([]);
    }
  }, [isSelectionMode, setSelectedKeys]);

  return (
    <div className="px-3 pt-4 pb-1">
      <div className="flex items-center justify-between px-1 group">
        <div className="text-[14px] font-semibold text-muted-foreground flex items-center gap-1">
          {title}
          <span>({count})</span>
        </div>
        <div className="flex items-center gap-1">
          {isSelectionMode ? (
            <>
              <button
                onClick={handleSelectAll}
                title={t('selectAllOrCancel')}
                className="p-1 hover:bg-muted/80 rounded text-muted-foreground transition-colors"
              >
                <ListChecks className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleInvertSelection}
                title={t('invertSelection')}
                className="p-1 hover:bg-muted/80 rounded text-muted-foreground transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={selectedKeys.length === 0}
                title={t('batchDelete')}
                className={`p-1 rounded transition-colors ${
                  selectedKeys.length > 0 
                    ? "hover:bg-red-100 text-red-500" 
                    : "text-muted-foreground/50 cursor-not-allowed"
                }`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setIsSelectionMode(false)}
                className="text-[10px] font-medium px-1.5 py-0.5 hover:bg-muted/80 rounded text-muted-foreground transition-colors ml-1"
              >
                {t('cancel')}
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsSelectionMode(true)}
              className="p-1 hover:bg-muted/80 rounded text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ opacity: count > 0 ? undefined : 0 }}
            >
              <CheckSquare className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  items,
  onSelect,
  onDelete,
  onRename,
  onTogglePinned,
  onToggleArchived,
  activeKey,
  isSelectionMode,
  selectedKeys,
  setSelectedKeys
}: {
  items: SessionInfo[];
  onSelect: (key: string) => void;
  onDelete: (key: string) => void;
  onRename: (key: string, currentTitle: string) => void;
  onTogglePinned: (key: string, pinned: boolean) => void;
  onToggleArchived: (key: string, archived: boolean) => void;
  activeKey: string | null;
  isSelectionMode: boolean;
  selectedKeys: string[];
  setSelectedKeys: (val: string[] | ((prev: string[]) => string[])) => void;
}) {
  const { t } = useTranslation();

  const toggleSelect = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedKeys(prev => 
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  return (
    <div className="px-3 pb-2">
      <div className="space-y-0 mt-1">
        {items.map((item) => {
          const displayTitle = item.metadata?.title || item.key.replace("api:", "");
          const isActive = activeKey === item.key;
          const isSelected = selectedKeys.includes(item.key);
          
          return (
            <div
              key={item.key}
              className={`w-full h-8 px-2 text-left rounded-md text-[14px] flex items-center justify-between group transition-colors cursor-pointer ${
                isActive && !isSelectionMode ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              } ${isSelected ? 'bg-indigo-50/50 text-indigo-700' : ''}`}
                onClick={(e) => isSelectionMode ? toggleSelect(item.key, e) : onSelect(item.key)}
              >
              <div className="truncate pr-2 flex-1 flex items-center gap-1.5 min-w-0">
                {isSelectionMode ? (
                  <span 
                    className="w-4 shrink-0 flex items-center justify-center"
                    onClick={(e) => toggleSelect(item.key, e)}
                  >
                    {isSelected ? (
                      <CheckSquare className="h-3.5 w-3.5 text-indigo-600" />
                    ) : (
                      <Square className="h-3.5 w-3.5 text-muted-foreground/50" />
                    )}
                  </span>
                ) : (
                  <span className="w-4 shrink-0 flex items-center justify-center">
                    {item.pinned && <Pin className="h-3.5 w-3.5 text-muted-foreground" />}
                  </span>
                )}
                <span className="truncate">{displayTitle}</span>
              </div>
              
              {!isSelectionMode && (
                <DropdownMenu>
                <DropdownMenuTrigger onClick={(e) => e.stopPropagation()} className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted/80 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity outline-none">
                  <MoreVertical className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-32">
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onRename(item.key, displayTitle);
                    }}
                    onSelect={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onRename(item.key, displayTitle);
                    }}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    <span>{t('rename')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onTogglePinned(item.key, !!item.pinned);
                    }}
                    onSelect={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onTogglePinned(item.key, !!item.pinned);
                    }}
                  >
                    <Pin className="mr-2 h-4 w-4" />
                    <span>{item.pinned ? t('unpin') : t('pin')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onToggleArchived(item.key, !!item.archived);
                    }}
                    onSelect={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onToggleArchived(item.key, !!item.archived);
                    }}
                  >
                    <Archive className="mr-2 h-4 w-4" />
                    <span>{item.archived ? t('unarchive') : t('archive')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onDelete(item.key);
                    }}
                    onSelect={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onDelete(item.key);
                    }}
                    className="text-red-600 focus:text-red-600 focus:bg-red-50"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    <span>{t('deleteSession')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DashboardSection({
  title,
  count,
  items,
  onSelect,
  onDelete,
  onRename,
  onCreate,
  activeId
}: {
  title: string;
  count: number;
  items: {id: string, name: string}[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, currentName: string) => void;
  onCreate: () => void;
  activeId: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="px-3 pt-4">
      <div className="flex items-center justify-between mb-1.5 px-1 group">
        <div className="text-[14px] font-semibold text-muted-foreground flex items-center gap-1">
          {title}
          <span>({count})</span>
        </div>
        <button
          onClick={onCreate}
          className="text-[10px] font-medium px-1.5 py-0.5 hover:bg-muted/80 rounded text-muted-foreground transition-colors opacity-0 group-hover:opacity-100 flex items-center gap-0.5"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('new')}
        </button>
      </div>
      <div className="space-y-0 mt-1">
        {items.map((item) => {
          const isActive = activeId === item.id;
          return (
            <div
              key={item.id}
              className={`w-full h-8 px-2 text-left rounded-md text-[14px] flex items-center justify-between group transition-colors cursor-pointer ${
                isActive ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              }`}
                onClick={() => onSelect(item.id)}
              >
              <div className="truncate pr-2 flex-1 flex items-center gap-1.5 min-w-0">
                <span className="w-4 shrink-0 flex items-center justify-center">
                  <LayoutDashboard className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
                <span className="truncate">{item.name}</span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger onClick={(e) => e.stopPropagation()} className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted/80 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity outline-none">
                  <MoreVertical className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-32">
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onRename(item.id, item.name);
                    }}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    <span>{t('rename')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onDelete(item.id);
                    }}
                    className="text-red-600 focus:text-red-600 focus:bg-red-50"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    <span>{t('delete')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
    </div>
  );
}

function SidebarBody() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { currentProject } = useProjectStore();
  const { dashboards, activeDashboardId, loadDashboards, createDashboard, deleteDashboard, renameDashboard, setActiveDashboard } = useDashboardStore();
  const { t, i18n } = useTranslation();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [whisperUrlDraft, setWhisperUrlDraft] = useState("");
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const [voiceTestStatus, setVoiceTestStatus] = useState<"success" | "error" | null>(null);
  const [voiceTestMessage, setVoiceTestMessage] = useState("");
  
  // Session management state
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionFilter, setSessionFilter] = useState("");
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [sessionToRename, setSessionToRename] = useState<{key: string, title: string} | null>(null);
  const [newTitle, setNewTitle] = useState("");

  const [activeSelectionMode, setActiveSelectionMode] = useState(false);
  const [activeSelectedKeys, setActiveSelectedKeys] = useState<string[]>([]);
  const [archivedSelectionMode, setArchivedSelectionMode] = useState(false);
  const [archivedSelectedKeys, setArchivedSelectedKeys] = useState<string[]>([]);

  const [dashboardRenameDialogOpen, setDashboardRenameDialogOpen] = useState(false);
  const [dashboardToRename, setDashboardToRename] = useState<{id: string, name: string} | null>(null);
  const [newDashboardName, setNewDashboardName] = useState("");

  // Try to parse active session from URL query
  const queryParams = new URLSearchParams(location.search);
  const activeSessionKey = queryParams.get("session") || "api:default";

  useEffect(() => {
    if (currentProject) {
      loadDashboards(currentProject.id);
    }
  }, [currentProject, loadDashboards]);

  const fetchSessions = async () => {
    try {
      const url = currentProject 
        ? `/nanobot/sessions?project_id=${currentProject.id}`
        : "/nanobot/sessions";
      const data = await api.get<SessionInfo[]>(url);
      setSessions(data);
    } catch (e) {
      console.error("Failed to fetch sessions", e);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [location.pathname, location.search, currentProject?.id]);

  useEffect(() => {
    const onFocus = () => fetchSessions();
    const onSessionsChanged = () => fetchSessions();
    window.addEventListener("focus", onFocus);
    window.addEventListener("nanobot:sessions-changed", onSessionsChanged);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("nanobot:sessions-changed", onSessionsChanged);
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const openVoiceSettings = () => {
    const saved = (localStorage.getItem("whisper_url") || "").trim();
    setWhisperUrlDraft(saved);
    setVoiceTestStatus(null);
    setVoiceTestMessage("");
    setVoiceSettingsOpen(true);
  };

  const handleSaveVoiceSettings = () => {
    const normalized = whisperUrlDraft.trim();
    if (!normalized) {
      alert(t('voiceServerRequired', '请填写语音识别服务地址'));
      return;
    }
    localStorage.setItem("whisper_url", normalized);
    setVoiceSettingsOpen(false);
  };

  const handleTestVoiceConnection = async () => {
    const normalized = whisperUrlDraft.trim();
    if (!normalized) {
      alert(t('voiceServerRequired', '请填写语音识别服务地址'));
      return;
    }
    setIsTestingVoice(true);
    setVoiceTestStatus(null);
    setVoiceTestMessage("");
    try {
      const response = await fetch(`${normalized.replace(/\/$/, "")}/health`, {
        method: "GET",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      setVoiceTestStatus("success");
      setVoiceTestMessage(t('voiceConnectionSuccess', '连接成功'));
    } catch (error: any) {
      setVoiceTestStatus("error");
      setVoiceTestMessage(`${t('voiceConnectionFailed', '连接失败')}: ${error?.message || t('unknownError', '未知错误')}`);
    } finally {
      setIsTestingVoice(false);
    }
  };

  const handleSelectSession = (key: string) => {
    navigate(`/?session=${encodeURIComponent(key)}`);
  };

  const handleNewThread = async () => {
    const newSessionId = `api:${Date.now()}`;
    try {
      const payload = currentProject ? { project_id: currentProject.id } : {};
      await api.post(`/nanobot/sessions/${encodeURIComponent(newSessionId)}/ensure`, payload);
      await fetchSessions();
      window.dispatchEvent(new Event("nanobot:sessions-changed"));
    } catch (e) {
      console.error("Failed to create session", e);
    }
    navigate(`/?session=${encodeURIComponent(newSessionId)}`);
  };

  const handleDeleteSession = async (key: string) => {
    if (!window.confirm(t('confirmDeleteSession'))) return;
    try {
      await api.delete(`/nanobot/sessions/${encodeURIComponent(key)}`);
      if (activeSessionKey === key) {
        navigate("/");
      }
      fetchSessions();
      window.dispatchEvent(new Event("nanobot:sessions-changed"));
    } catch (e) {
      console.error("Failed to delete session", e);
    }
  };

  const handleBatchDelete = async (keys: string[]) => {
    if (!window.confirm(t('confirmBatchDeleteSessions', { count: keys.length }))) return;
    try {
      await api.post("/nanobot/sessions/batch-delete", { session_ids: keys });
      if (keys.includes(activeSessionKey)) {
        navigate("/");
      }
      fetchSessions();
      window.dispatchEvent(new Event("nanobot:sessions-changed"));
    } catch (e) {
      console.error("Failed to batch delete sessions", e);
    }
  };

  const openRenameDialog = (key: string, currentTitle: string) => {
    setSessionToRename({ key, title: currentTitle });
    setNewTitle(currentTitle);
    setRenameDialogOpen(true);
  };

  const handleRename = async () => {
    if (!sessionToRename || !newTitle.trim()) return;
    try {
      const nextTitle = newTitle.trim();
      await api.put(`/nanobot/sessions/${encodeURIComponent(sessionToRename.key)}`, { title: nextTitle });
      setSessions((prev) =>
        prev.map((item) =>
          item.key === sessionToRename.key
            ? { ...item, alias: nextTitle, metadata: { ...(item.metadata || {}), title: nextTitle } }
            : item
        )
      );
      setRenameDialogOpen(false);
      fetchSessions();
      window.dispatchEvent(new Event("nanobot:sessions-changed"));
    } catch (e) {
      console.error("Failed to rename session", e);
    }
  };

  const handleTogglePinned = async (key: string, pinned: boolean) => {
    const nextPinned = !pinned;
    try {
      await api.put(`/nanobot/sessions/${encodeURIComponent(key)}`, { pinned: nextPinned });
      setSessions((prev) =>
        prev
          .map((item) => (item.key === key ? { ...item, pinned: nextPinned } : item))
          .sort((a, b) => {
            const ap = a.pinned ? 1 : 0;
            const bp = b.pinned ? 1 : 0;
            if (bp !== ap) return bp - ap;
            const aa = a.archived ? 1 : 0;
            const ba = b.archived ? 1 : 0;
            if (aa !== ba) return aa - ba;
            return (b.updated_at || "").localeCompare(a.updated_at || "");
          })
      );
      window.dispatchEvent(new Event("nanobot:sessions-changed"));
    } catch (e) {
      console.error("Failed to toggle pinned", e);
    }
  };

  const handleToggleArchived = async (key: string, archived: boolean) => {
    const nextArchived = !archived;
    try {
      await api.put(`/nanobot/sessions/${encodeURIComponent(key)}`, { archived: nextArchived });
      setSessions((prev) =>
        prev
          .map((item) => (item.key === key ? { ...item, archived: nextArchived } : item))
          .sort((a, b) => {
            const ap = a.pinned ? 1 : 0;
            const bp = b.pinned ? 1 : 0;
            if (bp !== ap) return bp - ap;
            const aa = a.archived ? 1 : 0;
            const ba = b.archived ? 1 : 0;
            if (aa !== ba) return aa - ba;
            return (b.updated_at || "").localeCompare(a.updated_at || "");
          })
      );
      window.dispatchEvent(new Event("nanobot:sessions-changed"));
    } catch (e) {
      console.error("Failed to toggle archived", e);
    }
  };

  const normalizedFilter = sessionFilter.trim().toLowerCase();
  const activeSessions = sessions.filter((item) => {
    if (item.archived) return false;
    if (!normalizedFilter) return true;
    const title = (item.metadata?.title || item.key.replace("api:", "")).toLowerCase();
    return title.includes(normalizedFilter);
  });
  const archivedSessions = sessions.filter((item) => {
    if (!item.archived) return false;
    if (!normalizedFilter) return true;
    const title = (item.metadata?.title || item.key.replace("api:", "")).toLowerCase();
    return title.includes(normalizedFilter);
  });

  const handleCreateDashboard = () => {
    if (!currentProject) return;
    if (dashboards.length >= 3) {
      alert(t('dashboardLimitReached') || "You can only create up to 3 dashboards.");
      return;
    }
    createDashboard(t('newDashboardNameDefault'), currentProject.id);
    navigate(`/dashboard`);
  };

  const handleSelectDashboard = (id: string) => {
    setActiveDashboard(id);
    navigate(`/dashboard`);
  };

  const openDashboardRenameDialog = (id: string, name: string) => {
    setDashboardToRename({ id, name });
    setNewDashboardName(name);
    setDashboardRenameDialogOpen(true);
  };

  const handleDashboardRename = () => {
    if (!currentProject || !dashboardToRename || !newDashboardName.trim()) return;
    renameDashboard(dashboardToRename.id, newDashboardName.trim(), currentProject.id);
    setDashboardRenameDialogOpen(false);
  };

  const handleDashboardDelete = (id: string) => {
    if (!currentProject) return;
    if (!window.confirm(t('confirmDeleteDashboard'))) return;
    deleteDashboard(id, currentProject.id);
  };

  const filteredDashboards = dashboards.filter((d) => {
    if (!normalizedFilter) return true;
    return d.name.toLowerCase().includes(normalizedFilter);
  });

  return (
    <div className="h-full min-h-0 flex flex-col bg-muted/50/30 border-r border-border relative">
      {/* Header */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-border">
        <Link to="/" className="flex items-center gap-1.5 text-foreground/80 font-bold text-lg hover:opacity-80 transition-opacity">
          <span className="text-xl leading-none mr-0.5">🦞</span>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-foreground to-muted-foreground">
            {t('lobsterDataQA')}
          </span>
        </Link>
        <div className="w-8" />
      </div>

      <div className="flex-none">
        <DashboardSection
          title={t('dashboards') || 'Dashboards'}
          count={filteredDashboards.length}
          items={filteredDashboards.map(d => ({ id: d.id, name: d.name }))}
          onSelect={handleSelectDashboard}
          onDelete={handleDashboardDelete}
          onRename={openDashboardRenameDialog}
          onCreate={handleCreateDashboard}
          activeId={location.pathname === "/dashboard" ? activeDashboardId : null}
        />
        
        <div className="px-3 pt-4 mb-2">
          <Button 
            variant="outline" 
            className="w-full justify-start h-10 px-3 rounded-lg border-border bg-background hover:bg-muted/50 text-muted-foreground font-medium text-[14px]"
            onClick={handleNewThread}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('newThread')}
          </Button>
        </div>

        <div className="px-3 pt-2">
          <div className="relative">
            <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={sessionFilter}
              onChange={(e) => setSessionFilter(e.target.value)}
              placeholder={t('filterSessionName')}
              className="pl-9 h-9 border-border bg-background text-[14px]"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col mt-2">
        <div className="flex-1 min-h-0 flex flex-col">
          <SectionHeader
            title={t('threads')}
            count={activeSessions.length}
            isSelectionMode={activeSelectionMode}
            setIsSelectionMode={setActiveSelectionMode}
            selectedKeys={activeSelectedKeys}
            setSelectedKeys={setActiveSelectedKeys}
            items={activeSessions}
            onBatchDelete={handleBatchDelete}
          />
          <ScrollArea className="flex-1 min-h-0">
            <Section 
              items={activeSessions} 
              onSelect={handleSelectSession}
              onDelete={handleDeleteSession}
              onRename={openRenameDialog}
              onTogglePinned={handleTogglePinned}
              onToggleArchived={handleToggleArchived}
              activeKey={activeSessionKey}
              isSelectionMode={activeSelectionMode}
              selectedKeys={activeSelectedKeys}
              setSelectedKeys={setActiveSelectedKeys}
            />
          </ScrollArea>
        </div>
        
        {archivedSessions.length > 0 && (
          <div className="h-[35%] min-h-[150px] shrink-0 border-t border-border bg-muted/50/50 flex flex-col">
            <SectionHeader
              title={t('archivedThreads')}
              count={archivedSessions.length}
              isSelectionMode={archivedSelectionMode}
              setIsSelectionMode={setArchivedSelectionMode}
              selectedKeys={archivedSelectedKeys}
              setSelectedKeys={setArchivedSelectedKeys}
              items={archivedSessions}
              onBatchDelete={handleBatchDelete}
            />
            <ScrollArea className="flex-1 min-h-0">
              <Section 
                items={archivedSessions} 
                onSelect={handleSelectSession}
                onDelete={handleDeleteSession}
                onRename={openRenameDialog}
                onTogglePinned={handleTogglePinned}
                onToggleArchived={handleToggleArchived}
                activeKey={activeSessionKey}
                isSelectionMode={archivedSelectionMode}
                selectedKeys={archivedSelectedKeys}
                setSelectedKeys={setArchivedSelectedKeys}
              />
            </ScrollArea>
          </div>
        )}
      </div>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('renameSession')}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input 
              value={newTitle} 
              onChange={(e) => setNewTitle(e.target.value)} 
              placeholder={t('enterNewSessionTitle')} 
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRename();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>{t('cancel')}</Button>
            <Button className="bg-indigo-600 hover:bg-indigo-700 text-primary-foreground" onClick={handleRename}>{t('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dashboardRenameDialogOpen} onOpenChange={setDashboardRenameDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('renameDashboard')}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input 
              value={newDashboardName} 
              onChange={(e) => setNewDashboardName(e.target.value)} 
              placeholder={t('enterNewDashboardName')} 
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleDashboardRename();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDashboardRenameDialogOpen(false)}>{t('cancel')}</Button>
            <Button className="bg-indigo-600 hover:bg-indigo-700 text-primary-foreground" onClick={handleDashboardRename}>{t('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={voiceSettingsOpen} onOpenChange={setVoiceSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('voiceSettings', '语音输入配置')}</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <Input
              value={whisperUrlDraft}
              onChange={(e) => setWhisperUrlDraft(e.target.value)}
              placeholder="http://localhost:8001"
            />
            <p className="text-xs text-muted-foreground">
              {t('voiceSettingsHint', '请输入语音识别服务地址，例如：http://localhost:8001')}
            </p>
            {voiceTestStatus && (
              <div className={`flex items-center gap-2 text-xs ${voiceTestStatus === "success" ? "text-emerald-600" : "text-red-600"}`}>
                {voiceTestStatus === "success" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                <span>{voiceTestMessage}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiceSettingsOpen(false)}>{t('cancel')}</Button>
            <Button variant="outline" onClick={handleTestVoiceConnection} disabled={isTestingVoice}>
              {isTestingVoice ? <Loader2 className="h-4 w-4 animate-spin" /> : t('testConnection', '测试连接')}
            </Button>
            <Button className="bg-indigo-600 hover:bg-indigo-700 text-primary-foreground" onClick={handleSaveVoiceSettings}>{t('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="p-4 border-t border-border mt-auto relative" ref={menuRef}>
        <div className="flex items-center justify-between text-muted-foreground">
          <button 
            className="flex items-center gap-2 hover:text-foreground transition-colors p-1 rounded-full hover:bg-muted"
            onClick={() => setShowUserMenu(!showUserMenu)}
          >
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 border border-indigo-200 shadow-sm">
              <User className="h-4.5 w-4.5" />
            </div>
            <div className="text-sm font-medium truncate max-w-[100px] text-left">
              {user?.username || t('defaultUser')}
            </div>
          </button>
          
          <button 
            className="flex items-center gap-1.5 text-sm hover:text-foreground transition-colors px-2 py-1.5 rounded-md hover:bg-muted"
            onClick={() => navigate("/skills")}
          >
            <Wand2 className="h-4 w-4" />
            {t('skillCenter')}
          </button>
        </div>

        {/* User Settings Popover Menu */}
        {showUserMenu && (
          <div className="absolute bottom-[72px] left-4 w-56 bg-background rounded-xl shadow-xl border border-border py-1.5 z-50 overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-3 py-2 border-b border-border mb-1">
              <p className="text-sm font-medium text-foreground truncate">{user?.username}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
            
            <button 
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground/80 hover:bg-muted transition-colors"
              onClick={() => {
                navigate("/projects");
                setShowUserMenu(false);
              }}
            >
              <Folder className="h-4 w-4 text-muted-foreground" />
              {t('projectManagement')}
            </button>

            <button 
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground/80 hover:bg-muted transition-colors"
              onClick={() => {
                if (currentProject?.id) {
                  navigate(`/projects/${currentProject.id}/subagents`);
                } else {
                  navigate("/projects");
                }
                setShowUserMenu(false);
              }}
            >
              <Bot className="h-4 w-4 text-muted-foreground" />
              {t('subagents', 'Subagents')}
            </button>

            <button 
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground/80 hover:bg-muted transition-colors"
              onClick={() => {
                navigate("/datasources");
                setShowUserMenu(false);
              }}
            >
              <Database className="h-4 w-4 text-muted-foreground" />
              {t('dataSourceManagement')}
            </button>

            <button 
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground/80 hover:bg-muted transition-colors"
              onClick={() => {
                navigate("/knowledge-bases");
                setShowUserMenu(false);
              }}
            >
              <Database className="h-4 w-4 text-muted-foreground" />
              {t('knowledgeBaseManagement', 'Knowledge Bases')}
            </button>

            <button 
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground/80 hover:bg-muted transition-colors"
              onClick={() => {
                navigate("/settings");
                setShowUserMenu(false);
              }}
            >
              <Settings className="h-4 w-4 text-muted-foreground" />
              {t('personalSettings')}
            </button>

            <button 
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground/80 hover:bg-muted transition-colors"
              onClick={() => {
                openVoiceSettings();
                setShowUserMenu(false);
              }}
            >
              <Mic className="h-4 w-4 text-muted-foreground" />
              {t('voiceSettings', '语音输入配置')}
            </button>

            {user?.is_admin && (
              <>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground/80 hover:bg-muted transition-colors"
                  onClick={() => {
                    navigate("/model-configs");
                    setShowUserMenu(false);
                  }}
                >
                  <Brain className="h-4 w-4 text-muted-foreground" />
                  {t('modelConfig')}
                </button>
                
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground/80 hover:bg-muted transition-colors"
                  onClick={() => {
                    navigate("/embedding-models");
                    setShowUserMenu(false);
                  }}
                >
                  <Brain className="h-4 w-4 text-muted-foreground" />
                  {t('embeddingModelConfig', 'Embedding Models')}
                </button>
                
                <button 
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground/80 hover:bg-muted transition-colors"
                  onClick={() => {
                    navigate("/users");
                    setShowUserMenu(false);
                  }}
                >
                  <User className="h-4 w-4" />
                  {t('userManagement')}
                </button>
              </>
            )}
            
            <div className="h-px bg-muted my-1 mx-2" />
            
            <button 
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground/80 hover:bg-muted transition-colors"
              onClick={() => {
                i18n.changeLanguage(i18n.language === 'zh' ? 'en' : 'zh');
                setShowUserMenu(false);
              }}
            >
              <Globe className="h-4 w-4 text-muted-foreground" />
              {i18n.language === 'zh' ? 'English' : '中文'}
            </button>
            
            <button 
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
              onClick={handleLogout}
            >
              {t('logout')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Sidebar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger render={
          <Button variant="ghost" size="icon" className="md:hidden fixed top-3 left-3 z-50 border border-border bg-background">
            <Menu className="h-5 w-5" />
          </Button>
        } />
        <SheetContent side="left" className="w-[280px] p-0">
          <SidebarBody />
        </SheetContent>
      </Sheet>

      <div className="hidden md:flex w-[280px] h-screen shrink-0">
        <SidebarBody />
      </div>
    </>
  );
}
