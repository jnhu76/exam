import { toast } from "sonner";

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

let navigateFn: ((path: string) => void) | null = null;

export function setNavigate(fn: (path: string) => void) {
  navigateFn = fn;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    if (response.status === 401) {
      navigateFn?.("/login");
      throw new ApiError(401, "401 Unauthorized");
    }

    if (!response.ok) {
      throw new ApiError(response.status, `${response.status} Request failed`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    toast.error("网络连接失败，请稍后重试");
    throw new ApiError(0, "Network request failed");
  }
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
  post<T, TBody = unknown>(path: string, body?: TBody): Promise<T> {
    return request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  patch<T, TBody = unknown>(path: string, body?: TBody): Promise<T> {
    return request<T>(path, {
      method: "PATCH",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE" });
  },
};
