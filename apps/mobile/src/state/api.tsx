import { useMemo } from "react";
import { createApiClient, type ApiClient } from "@/src/api/client";
import { API_BASE_URL, API_TIMEOUT_MS } from "@/src/api/config";
import { useSession } from "./session";
import { useWorkspace } from "./workspace";

/** A client bound to the current token and workspace. */
export function useApi(): ApiClient {
  const { token, signOut } = useSession();
  const { workspace } = useWorkspace();

  return useMemo(
    () =>
      createApiClient({
        baseUrl: API_BASE_URL,
        workspace,
        getToken: () => token,
        onUnauthorized: () => {
          void signOut();
        },
        timeoutMs: API_TIMEOUT_MS,
      }),
    [token, workspace, signOut]
  );
}

/** Short, human error text. Never leaks a token or a request body. */
export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong";
}
