import axios from 'axios';

const API_BASE_URL = '/api/v1/projects';

// Add interceptor to include token
const axiosInstance = axios.create();
axiosInstance.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export interface Subagent {
  id: string;
  name: string;
  description: string;
  model: string;
  instructions: string;
  status: string;
  projectId: string;
  createdAt?: string;
}

export const subagentApi = {
  list: async (projectId: string) => {
    const response = await axiosInstance.get<Subagent[]>(`${API_BASE_URL}/${projectId}/subagents`);
    return response.data;
  },
  
  get: async (projectId: string, id: string) => {
    const response = await axiosInstance.get<Subagent>(`${API_BASE_URL}/${projectId}/subagents/${id}`);
    return response.data;
  },

  create: async (projectId: string, data: Partial<Subagent>) => {
    const response = await axiosInstance.post<Subagent>(`${API_BASE_URL}/${projectId}/subagents`, data);
    return response.data;
  },

  update: async (_projectId: string, id: string, data: Partial<Subagent>) => {
    const response = await axiosInstance.put<Subagent>(`/api/v1/subagents/${id}`, data);
    return response.data;
  },

  delete: async (_projectId: string, id: string) => {
    const response = await axiosInstance.delete(`/api/v1/subagents/${id}`);
    return response.data;
  }
};
