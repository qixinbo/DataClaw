import { create } from 'zustand';
import { api } from '@/lib/api';

export interface Project {
  id: number;
  name: string;
  description?: string;
  owner_id: number;
  created_at: string;
  updated_at: string;
}

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  loading: boolean;
  error: string | null;
  fetchProjects: () => Promise<void>;
  setCurrentProject: (project: Project) => void;
  addProject: (name: string, description?: string) => Promise<Project>;
  updateProject: (id: number, name: string, description?: string) => Promise<Project>;
  deleteProject: (id: number) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: JSON.parse(localStorage.getItem('currentProject') || 'null'),
  loading: false,
  error: null,
  
  fetchProjects: async () => {
    set({ loading: true, error: null });
    try {
      const projects = await api.get<Project[]>('/api/v1/projects');
      set({ projects, loading: false });
      
      // Set current project if not set or not in list
      const current = get().currentProject;
      if (projects.length > 0) {
        if (!current || !projects.find((p: Project) => p.id === current.id)) {
          get().setCurrentProject(projects[0]);
        }
      } else {
        set({ currentProject: null });
        localStorage.removeItem('currentProject');
      }
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },
  
  setCurrentProject: (project: Project) => {
    localStorage.setItem('currentProject', JSON.stringify(project));
    set({ currentProject: project });
  },
  
  addProject: async (name: string, description?: string) => {
    try {
      const newProject = await api.post<Project>('/api/v1/projects', { name, description });
      set((state) => ({ projects: [...state.projects, newProject] }));
      if (!get().currentProject) {
        get().setCurrentProject(newProject);
      }
      return newProject;
    } catch (error: any) {
      throw new Error(error.message || 'Failed to create project');
    }
  },
  
  updateProject: async (id: number, name: string, description?: string) => {
    try {
      const updatedProject = await api.put<Project>(`/api/v1/projects/${id}`, { name, description });
      set((state) => ({
        projects: state.projects.map((p) => (p.id === id ? updatedProject : p)),
        currentProject: state.currentProject?.id === id ? updatedProject : state.currentProject,
      }));
      if (get().currentProject?.id === id) {
        localStorage.setItem('currentProject', JSON.stringify(updatedProject));
      }
      return updatedProject;
    } catch (error: any) {
      throw new Error(error.message || 'Failed to update project');
    }
  },
  
  deleteProject: async (id: number) => {
    try {
      await api.delete(`/api/v1/projects/${id}`);
      set((state) => {
        const projects = state.projects.filter((p) => p.id !== id);
        let currentProject = state.currentProject;
        if (currentProject?.id === id) {
          currentProject = projects.length > 0 ? projects[0] : null;
          if (currentProject) {
            localStorage.setItem('currentProject', JSON.stringify(currentProject));
          } else {
            localStorage.removeItem('currentProject');
          }
        }
        return { projects, currentProject };
      });
    } catch (error: any) {
      throw new Error(error.message || 'Failed to delete project');
    }
  },
}));
