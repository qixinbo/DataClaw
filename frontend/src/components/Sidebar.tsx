import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Menu, LayoutDashboard, Plus, MoreVertical, User, Search, Wrench, Settings, Brain, Trash2, Pencil, Pin, Archive, Database, CheckSquare, Square, ListChecks, RotateCcw } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
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

function Section({
  title,
  count,
  items,
  onSelect,
  onDelete,
  onRename,
  onTogglePinned,
  onToggleArchived,
  onBatchDelete,
  activeKey
}: {
  title: string;
  count: number;
  items: SessionInfo[];
  onSelect: (key: string) => void;
  onDelete: (key: string) => void;
  onRename: (key: string, currentTitle: string) => void;
  onTogglePinned: (key: string, pinned: boolean) => void;
  onToggleArchived: (key: string, archived: boolean) => void;
  onBatchDelete: (keys: string[]) => void;
  activeKey: string | null;
}) {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const toggleSelect = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedKeys(prev => 
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

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
  }, [isSelectionMode]);

  return (
    <div className="px-3 pt-6">
      <div className="flex items-center justify-between mb-2 px-1 group">
        <div className="text-xs font-semibold text-zinc-500 flex items-center gap-1 uppercase tracking-wider">
          {title}
          <span>({count})</span>
        </div>
        <div className="flex items-center gap-1">
          {isSelectionMode ? (
            <>
              <button
                onClick={handleSelectAll}
                title="全选/取消全选"
                className="p-1 hover:bg-zinc-200 rounded text-zinc-500 transition-colors"
              >
                <ListChecks className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleInvertSelection}
                title="反选"
                className="p-1 hover:bg-zinc-200 rounded text-zinc-500 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={selectedKeys.length === 0}
                title="批量删除"
                className={`p-1 rounded transition-colors ${
                  selectedKeys.length > 0 
                    ? "hover:bg-red-100 text-red-500" 
                    : "text-zinc-300 cursor-not-allowed"
                }`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setIsSelectionMode(false)}
                className="text-[10px] font-medium px-1.5 py-0.5 hover:bg-zinc-200 rounded text-zinc-500 transition-colors ml-1"
              >
                取消
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsSelectionMode(true)}
              className="p-1 hover:bg-zinc-200 rounded text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ opacity: count > 0 ? undefined : 0 }}
            >
              <CheckSquare className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="space-y-0.5 mt-2">
        {items.map((item) => {
          const displayTitle = item.metadata?.title || item.key.replace("api:", "");
          const isActive = activeKey === item.key;
          const isSelected = selectedKeys.includes(item.key);
          
          return (
            <div
              key={item.key}
              className={`w-full h-9 px-2 text-left rounded-md text-[14px] flex items-center justify-between group transition-colors cursor-pointer ${
                isActive && !isSelectionMode ? 'bg-zinc-100 text-zinc-900 font-medium' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
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
                      <Square className="h-3.5 w-3.5 text-zinc-300" />
                    )}
                  </span>
                ) : (
                  <span className="w-4 shrink-0 flex items-center justify-center">
                    {item.pinned && <Pin className="h-3.5 w-3.5 text-zinc-500" />}
                  </span>
                )}
                <span className="truncate">{displayTitle}</span>
              </div>
              
              {!isSelectionMode && (
                <DropdownMenu>
                <DropdownMenuTrigger onClick={(e) => e.stopPropagation()} className="h-6 w-6 flex items-center justify-center rounded hover:bg-zinc-200 text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity outline-none">
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
                    <span>重命名</span>
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
                    <span>{item.pinned ? "取消置顶" : "置顶"}</span>
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
                    <span>{item.archived ? "取消归档" : "归档"}</span>
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
                    <span>删除会话</span>
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

function SidebarBody() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  
  // Session management state
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionFilter, setSessionFilter] = useState("");
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [sessionToRename, setSessionToRename] = useState<{key: string, title: string} | null>(null);
  const [newTitle, setNewTitle] = useState("");
  
  // Try to parse active session from URL query
  const queryParams = new URLSearchParams(location.search);
  const activeSessionKey = queryParams.get("session") || "api:default";

  const fetchSessions = async () => {
    try {
      const data = await api.get<SessionInfo[]>("/nanobot/sessions");
      setSessions(data);
    } catch (e) {
      console.error("Failed to fetch sessions", e);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [location.pathname, location.search]);

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

  const handleSelectSession = (key: string) => {
    navigate(`/?session=${encodeURIComponent(key)}`);
  };

  const handleNewThread = async () => {
    const newSessionId = `api:${Date.now()}`;
    try {
      await api.post(`/nanobot/sessions/${encodeURIComponent(newSessionId)}/ensure`, {});
      await fetchSessions();
      window.dispatchEvent(new Event("nanobot:sessions-changed"));
    } catch (e) {
      console.error("Failed to create session", e);
    }
    navigate(`/?session=${encodeURIComponent(newSessionId)}`);
  };

  const handleDeleteSession = async (key: string) => {
    if (!window.confirm("确定要删除这个会话吗？")) return;
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
    if (!window.confirm(`确定要删除选中的 ${keys.length} 个会话吗？`)) return;
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

  return (
    <div className="h-full min-h-0 flex flex-col bg-zinc-50/30 border-r border-zinc-200 relative">
      {/* Header */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-zinc-100">
        <Link to="/" className="flex items-center gap-1.5 text-zinc-700 font-bold text-lg hover:opacity-80 transition-opacity">
          <span className="text-xl leading-none mr-0.5">🦞</span>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-zinc-800 to-zinc-600">
            龙虾问数
          </span>
        </Link>
        <div className="w-8" />
      </div>

      <div className="px-3 pt-4 space-y-2">
        <Button
          variant="secondary"
          className="w-full justify-start h-10 px-3 rounded-lg bg-zinc-200/50 hover:bg-zinc-200 text-zinc-900 font-medium"
          onClick={() => navigate("/dashboard")}
        >
          <LayoutDashboard className="h-4.5 w-4.5 mr-2 text-zinc-600" />
          Dashboard
        </Button>
        
        <Button 
          variant="outline" 
          className="w-full justify-start h-10 px-3 rounded-lg border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 font-medium"
          onClick={handleNewThread}
        >
          <Plus className="h-4 w-4 mr-2" />
          New Thread
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-3 pt-4">
          <div className="relative">
            <Search className="h-4 w-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={sessionFilter}
              onChange={(e) => setSessionFilter(e.target.value)}
              placeholder="过滤会话名称"
              className="pl-9 h-9 border-zinc-200 bg-white"
            />
          </div>
        </div>
        <Section 
          title="THREADS" 
          count={activeSessions.length} 
          items={activeSessions} 
          onSelect={handleSelectSession}
          onDelete={handleDeleteSession}
          onBatchDelete={handleBatchDelete}
          onRename={openRenameDialog}
          onTogglePinned={handleTogglePinned}
          onToggleArchived={handleToggleArchived}
          activeKey={activeSessionKey}
        />
        <Section 
          title="ARCHIVED_THREADS" 
          count={archivedSessions.length} 
          items={archivedSessions} 
          onSelect={handleSelectSession}
          onDelete={handleDeleteSession}
          onBatchDelete={handleBatchDelete}
          onRename={openRenameDialog}
          onTogglePinned={handleTogglePinned}
          onToggleArchived={handleToggleArchived}
          activeKey={activeSessionKey}
        />
      </ScrollArea>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input 
              value={newTitle} 
              onChange={(e) => setNewTitle(e.target.value)} 
              placeholder="输入新的会话标题" 
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRename();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>取消</Button>
            <Button className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={handleRename}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="p-4 border-t border-zinc-200 mt-auto relative" ref={menuRef}>
        <div className="flex items-center justify-between text-zinc-600">
          <button 
            className="flex items-center gap-2 hover:text-zinc-900 transition-colors p-1 rounded-full hover:bg-zinc-100"
            onClick={() => setShowUserMenu(!showUserMenu)}
          >
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 border border-indigo-200 shadow-sm">
              <User className="h-4.5 w-4.5" />
            </div>
            <div className="text-sm font-medium truncate max-w-[100px] text-left">
              {user?.username || 'User'}
            </div>
          </button>
          
          <button className="flex items-center gap-1.5 text-sm hover:text-zinc-900 transition-colors px-2 py-1.5 rounded-md hover:bg-zinc-100">
            <Wrench className="h-4 w-4" />
            技能中心
          </button>
        </div>

        {/* User Settings Popover Menu */}
        {showUserMenu && (
          <div className="absolute bottom-[72px] left-4 w-56 bg-white rounded-xl shadow-xl border border-zinc-200 py-1.5 z-50 overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-3 py-2 border-b border-zinc-100 mb-1">
              <p className="text-sm font-medium text-zinc-900 truncate">{user?.username}</p>
              <p className="text-xs text-zinc-500 truncate">{user?.email}</p>
            </div>
            
            <button 
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 transition-colors"
              onClick={() => {
                navigate("/settings");
                setShowUserMenu(false);
              }}
            >
              <Settings className="h-4 w-4 text-zinc-500" />
              个人设置
            </button>

            {user?.is_admin && (
              <>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 transition-colors"
                  onClick={() => {
                    navigate("/model-configs");
                    setShowUserMenu(false);
                  }}
                >
                  <Brain className="h-4 w-4 text-zinc-500" />
                  模型配置
                </button>

                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 transition-colors"
                  onClick={() => {
                    navigate("/datasources");
                    setShowUserMenu(false);
                  }}
                >
                  <Database className="h-4 w-4 text-zinc-500" />
                  数据源配置
                </button>
                
                <button 
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 transition-colors"
                  onClick={() => {
                    navigate("/users");
                    setShowUserMenu(false);
                  }}
                >
                  <User className="h-4 w-4" />
                  用户管理
                </button>
              </>
            )}
            
            <div className="h-px bg-zinc-100 my-1 mx-2" />
            
            <button 
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
              onClick={handleLogout}
            >
              退出登录
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
          <Button variant="ghost" size="icon" className="md:hidden fixed top-3 left-3 z-50 border border-zinc-200 bg-white">
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
