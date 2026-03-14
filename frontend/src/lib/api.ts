const API_BASE_URL = ''; // Relative path because of proxy

interface RequestOptions extends RequestInit {
  headers?: Record<string, string>;
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const token = localStorage.getItem('token');
  
  const defaultHeaders = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };

  const config: RequestInit = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  };

  try {
    const response = await fetch(`${API_BASE_URL}${url}`, config);

    if (!response.ok) {
      if (response.status === 401) {
        // Handle unauthorized (e.g., redirect to login or clear store)
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        // You might want to trigger a custom event or use window.location here
      }
      
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || errorData.message || `API Error: ${response.statusText}`);
    }

    // Handle empty responses (e.g. 204 No Content)
    if (response.status === 204) {
      return {} as T;
    }

    return await response.json();
  } catch (error) {
    console.error('API Request Failed:', error);
    throw error;
  }
}

export const api = {
  get: <T>(url: string, options?: RequestOptions) => request<T>(url, { ...options, method: 'GET' }),
  post: <T>(url: string, data: any, options?: RequestOptions) => 
    request<T>(url, { ...options, method: 'POST', body: JSON.stringify(data) }),
  put: <T>(url: string, data: any, options?: RequestOptions) => 
    request<T>(url, { ...options, method: 'PUT', body: JSON.stringify(data) }),
  delete: <T>(url: string, options?: RequestOptions) => request<T>(url, { ...options, method: 'DELETE' }),
  patch: <T>(url: string, data: any, options?: RequestOptions) => 
    request<T>(url, { ...options, method: 'PATCH', body: JSON.stringify(data) }),
};
