import { useCallback, useEffect, useState } from "react";
import { isLocalDashboardHost } from "../lib/host-mode";

const CONFIG_PATH = "/functions/tokentracker-opencode-go-config";

async function authHeaders() {
  const { getLocalApiAuthHeaders } = await import("../lib/local-api-auth");
  return getLocalApiAuthHeaders();
}

async function readConfig() {
  const res = await fetch(CONFIG_PATH, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

/**
 * Local-dashboard hook for the OpenCode Go persisted config stored in
 * ~/.tokentracker/tracker/config.json (opencodeGo.apiKey etc.).
 *
 * Only available on a local dashboard host; on the public site the endpoint
 * does not exist and `available` stays false.
 */
export function useOpencodeGoConfig() {
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState({
    hasApiKey: false,
    hasAuthCookie: false,
    hasWorkspaceId: false,
    apiKeyMasked: null,
    authCookieMasked: null,
    workspaceId: "",
  });

  useEffect(() => {
    if (!isLocalDashboardHost()) {
      setAvailable(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await readConfig();
        if (cancelled) return;
        if (!data || typeof data.hasApiKey !== "boolean") {
          setAvailable(false);
          setLoading(false);
          return;
        }
        setConfig(data);
        setAvailable(true);
        setLoading(false);
      } catch {
        if (!cancelled) {
          setAvailable(false);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next) => {
    const headers = await authHeaders();
    const res = await fetch(CONFIG_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      cache: "no-store",
      body: JSON.stringify(next),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    // Re-read to get masked values
    const fresh = await readConfig().catch(() => null);
    if (fresh) setConfig(fresh);
    return data;
  }, []);

  const clear = useCallback(async () => {
    const headers = await authHeaders();
    const res = await fetch(CONFIG_PATH, {
      method: "DELETE",
      headers: { Accept: "application/json", ...headers },
      cache: "no-store",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    const fresh = await readConfig().catch(() => null);
    if (fresh) setConfig(fresh);
    return true;
  }, []);

  const refresh = useCallback(async () => {
    const data = await readConfig();
    if (data) setConfig(data);
    return data;
  }, []);

  return { available, loading, config, save, clear, refresh };
}
