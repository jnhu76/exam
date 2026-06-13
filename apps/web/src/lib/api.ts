import { toast } from "sonner";
import {
  getMessageForLocale,
  isErrorCode,
  type ErrorResponse,
} from "@exam/contracts";

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

let navigateFn: ((path: string) => void) | null = null;

export function setNavigate(fn: (path: string) => void) {
  navigateFn = fn;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type ErrorBody = Partial<ErrorResponse> & {
  message?: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const hasBody = init?.body !== undefined;
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });

    if (!response.ok) {
      let message: string | undefined;
      let serverMessage: string | undefined;
      let code: string | undefined;
      let details: unknown;
      let requestId: string | undefined;
      try {
        const body = (await response.json()) as ErrorBody;
        serverMessage = body.error?.message ?? body.message;
        code = body.error?.code;
        details = body.error?.details;
        requestId = body.error?.requestId;
      } catch {
        // body parse failed; fall through to code/status fallback
      }
      if (code && isErrorCode(code)) {
        message = getMessageForLocale(code);
      } else if (serverMessage) {
        message = serverMessage;
      }
      if (!message) {
        message = `${response.status} Request failed`;
      }
      if (response.status === 401) {
        navigateFn?.("/login");
      }
      throw new ApiError(response.status, message, code, details, requestId);
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
  baseURL: baseUrl,
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
