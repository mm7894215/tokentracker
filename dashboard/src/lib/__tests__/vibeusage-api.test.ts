import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("../insforge-client", () => ({
  createInsforgeClient: vi.fn(() => ({
    getHttpClient: () => http,
  })),
  createInsforgeAuthClient: vi.fn(() => ({ auth: {} })),
}));

vi.mock("../auth-token", () => ({
  normalizeAccessToken: vi.fn((token: any) =>
    typeof token === "string" && token.trim() ? token.trim() : null,
  ),
  resolveAuthAccessToken: vi.fn(async (token: any) => token),
}));

vi.mock("../mock-data", () => ({
  isMockEnabled: vi.fn(() => false),
  getMockUsageSummary: vi.fn(),
  getMockLeaderboard: vi.fn(),
}));

let api: typeof import("../vibeusage-api");

beforeAll(async () => {
  vi.stubGlobal("fetch", fetchMock);
  api = await import("../vibeusage-api");
});

beforeEach(() => {
  http.get.mockReset();
  http.post.mockReset();
  fetchMock.mockReset();
  http.get.mockResolvedValue({ data: {} });
});

describe("getUsageSummary", () => {
  const baseArgs = {
    baseUrl: "https://example.com",
    accessToken: "token",
    from: "2026-01-01",
    to: "2026-01-02",
  };

  it("omits rolling by default", async () => {
    await api.getUsageSummary(baseArgs);
    const [, options] = http.get.mock.calls[0];
    expect(options?.params?.rolling).toBeUndefined();
  });

  it("includes rolling when enabled", async () => {
    await api.getUsageSummary({ ...baseArgs, rolling: true });
    const [, options] = http.get.mock.calls[0];
    expect(options?.params?.rolling).toBe("1");
  });
});

describe("error normalization", () => {
  it("uses the InsForgeError `error` field when message is empty", async () => {
    http.get.mockRejectedValueOnce({
      name: "InsForgeError",
      message: "",
      error: "Missing bearer token",
      statusCode: 401,
    });

    await expect(
      api.probeBackend({ baseUrl: "https://example.com", accessToken: null }),
    ).rejects.toMatchObject({
      message: "Missing bearer token",
      status: 401,
      statusCode: 401,
    });
  });
});

describe("triggerLocalSync", () => {
  it("posts to the local sync endpoint", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn(async () => ({ ok: true, code: 0 })),
    });

    await expect(api.triggerLocalSync()).resolves.toMatchObject({ ok: true, code: 0 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/functions/vibeusage-local-sync",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
  });

  it("surfaces the backend error message when local sync fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: vi.fn(async () => ({ ok: false, error: "sync failed" })),
    });

    await expect(api.triggerLocalSync()).rejects.toMatchObject({
      message: "sync failed",
      status: 500,
      statusCode: 500,
    });
  });
});
