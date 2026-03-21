import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from "@/lib/utils";

interface Skill {
  id: string;
  name: string;
  description?: string;
  type: string;
}

interface SlashCommandMenuProps {
  isOpen: boolean;
  skills: Skill[];
  selectedIndex: number;
  onSelect: (skill: Skill) => void;
  onClose: () => void;
}

export function SlashCommandMenu({ isOpen, skills, selectedIndex, onSelect, onClose }: SlashCommandMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen, selectedIndex]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen || skills.length === 0) return null;

  return (
    <div 
      ref={menuRef}
      className="absolute bottom-full left-0 mb-2 w-full max-w-md overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-100 z-50"
    >
      <div className="max-h-[240px] overflow-y-auto py-1.5 custom-scrollbar">
        {skills.map((skill, index) => (
          <button
            key={skill.id}
            ref={index === selectedIndex ? selectedRef : null}
            onClick={() => onSelect(skill)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors",
              index === selectedIndex ? "bg-zinc-800" : "hover:bg-zinc-900"
            )}
          >
            <span className="font-bold text-blue-400 shrink-0 font-mono">/{skill.name}</span>
            <span className="text-zinc-400 truncate text-xs">{skill.description || t('noDescription')}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
