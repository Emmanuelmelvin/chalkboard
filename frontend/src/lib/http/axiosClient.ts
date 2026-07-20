export interface AxiosRequestConfig<TBody = unknown> {
  headers?: Record<string, string>;
  data?: TBody;
}

export interface AxiosResponse<TData> {
  data: TData;
  status: number;
  statusText: string;
}

class AxiosHttpError extends Error {
  response?: AxiosResponse<unknown>;

  constructor(message: string, response?: AxiosResponse<unknown>) {
    super(message);
    this.name = 'AxiosHttpError';
    this.response = response;
  }
}

function request<TData, TBody = unknown>(method: string, url: string, config: AxiosRequestConfig<TBody> = {}): Promise<AxiosResponse<TData>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    Object.entries(config.headers ?? {}).forEach(([key, value]) => xhr.setRequestHeader(key, value));

    xhr.onload = () => {
      const data = xhr.responseText ? JSON.parse(xhr.responseText) as TData : (undefined as TData);
      const response = { data, status: xhr.status, statusText: xhr.statusText };
      if (xhr.status >= 200 && xhr.status < 300) resolve(response);
      else reject(new AxiosHttpError(xhr.statusText || `Request failed with ${xhr.status}`, response));
    };
    xhr.onerror = () => reject(new AxiosHttpError('Network request failed'));
    xhr.send(config.data === undefined ? undefined : JSON.stringify(config.data));
  });
}

export const axios = {
  get: <TData>(url: string, config?: AxiosRequestConfig) => request<TData>('GET', url, config),
  post: <TData, TBody = unknown>(url: string, data?: TBody, config?: AxiosRequestConfig<TBody>) => request<TData, TBody>('POST', url, { ...config, data }),
  patch: <TData, TBody = unknown>(url: string, data?: TBody, config?: AxiosRequestConfig<TBody>) => request<TData, TBody>('PATCH', url, { ...config, data }),
};

export default axios;
