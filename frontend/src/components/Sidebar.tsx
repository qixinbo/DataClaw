import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Menu, LayoutDashboard, Plus, MoreVertical, User, Search, Wrench, Settings, Brain } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";

const threadItems = ["我叫", "年龄最大的是谁", "有哪些字段", "文件中有些什么字段"];

function Section({
  title,
  count,
  items,
}: {
  title: string;
  count: number;
  items: string[];
}) {
  return (
    <div className="px-3 pt-6">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="text-xs font-semibold text-zinc-500 flex items-center gap-1 uppercase tracking-wider">
          {title}
          <span>({count})</span>
        </div>
      </div>
      <div className="space-y-0.5 mt-2">
        {items.map((item) => (
          <button
            key={item}
            className="w-full h-9 px-2 text-left rounded-md text-[14px] text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 flex items-center justify-between group transition-colors"
          >
            <span className="truncate pr-2">{item}</span>
            <MoreVertical className="h-4 w-4 text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
      </div>
    </div>
  );
}

function SidebarBody() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="h-full flex flex-col bg-zinc-50/30 border-r border-zinc-200 relative">
      {/* Header */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-zinc-100">
        <Link to="/" className="flex items-center gap-1.5 text-zinc-700 font-bold text-lg hover:opacity-80 transition-opacity">
          <span className="text-xl leading-none mr-0.5">🦞</span>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-zinc-800 to-zinc-600">
            龙虾问数
          </span>
        </Link>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-zinc-600">
            <Search className="h-4.5 w-4.5" />
          </Button>
        </div>
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
          className="w-full justify-start h-10 px-3 rounded-lg border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 shadow-sm font-medium"
          onClick={() => navigate("/")}
        >
          <Plus className="h-4 w-4 mr-2" />
          New Thread
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <Section title="THREADS" count={threadItems.length} items={threadItems} />
      </ScrollArea>

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
