import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, getInsforgeAnonKeyMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  getInsforgeAnonKeyMock: vi.fn(() => "anon-key"),
}));

vi.mock("@insforge/sdk", () => ({
  createClient: createClientMock,
}));

vi.mock("../insforge-config", () => ({
  getInsforgeAnonKey: getInsforgeAnonKeyMock,
}));

import { getPublicVisibility, setPublicVisibility } from "../api";

function makeJwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url").replace(/=/g, "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.sig`;
}

function makeClient({
  settingsData = null,
  publicViewData = null,
  currentUserId = null,
  upsertError = null,
} = {}) {
  const settingsRead = {
    select: vi.fn(() => settingsRead),
    eq: vi.fn(() => settingsRead),
    maybeSingle: vi.fn(async () => ({ data: settingsData, error: null })),
    upsert: vi.fn(async () => ({ error: upsertError })),
  };

  const publicViewsRead = {
    select: vi.fn(() => publicViewsRead),
    eq: vi.fn(() => publicViewsRead),
    is: vi.fn(() => publicViewsRead),
    maybeSingle: vi.fn(async () => ({ data: publicViewData, error: null })),
  };

  return {
    auth: {
      getCurrentUser: vi.fn(async () => ({
        data: currentUserId ? { user: { id: currentUserId } } : { user: null },
        error: null,
      })),
    },
    database: {
      from: vi.fn((table: string) => {
        if (table === "tokentracker_user_settings") return settingsRead;
        if (table === "tokentracker_public_views") return publicViewsRead;
        throw new Error(`Unexpected table: ${table}`);
      }),
    },
    __settingsRead: settingsRead,
    __publicViewsRead: publicViewsRead,
  };
}

describe("public visibility API", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    getInsforgeAnonKeyMock.mockClear();
  });

  it("returns local fallback when baseUrl is not remote", async () => {
    await expect(getPublicVisibility({ baseUrl: "", accessToken: "token" })).resolves.toEqual({
      enabled: false,
      updated_at: null,
      share_token: null,
    });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("reads visibility directly from tables using jwt sub", async () => {
    const client = makeClient({
      settingsData: { leaderboard_public: true, updated_at: "2026-03-28T16:00:00.000Z" },
      publicViewData: { token_hash: "pv1-token", updated_at: "2026-03-28T16:01:00.000Z" },
    });
    createClientMock.mockReturnValue(client);

    const accessToken = makeJwt({ sub: "user-123" });
    await expect(
      getPublicVisibility({ baseUrl: "https://example.insforge.app", accessToken }),
    ).resolves.toEqual({
      enabled: true,
      updated_at: "2026-03-28T16:00:00.000Z",
      share_token: "pv1-token",
    });

    expect(createClientMock).toHaveBeenCalledWith({
      baseUrl: "https://example.insforge.app",
      edgeFunctionToken: accessToken,
      anonKey: "anon-key",
      headers: { apikey: "anon-key" },
    });
    expect(client.__settingsRead.eq).toHaveBeenCalledWith("user_id", "user-123");
    expect(client.__publicViewsRead.eq).toHaveBeenCalledWith("user_id", "user-123");
    expect(client.auth.getCurrentUser).not.toHaveBeenCalled();
  });

  it("falls back to getCurrentUser when token is opaque", async () => {
    const client = makeClient({
      settingsData: { leaderboard_public: false, updated_at: null },
      publicViewData: null,
      currentUserId: "user-from-auth",
    });
    createClientMock.mockReturnValue(client);

    await expect(
      getPublicVisibility({ baseUrl: "https://example.insforge.app", accessToken: "opaque-token" }),
    ).resolves.toEqual({
      enabled: false,
      updated_at: null,
      share_token: null,
    });

    expect(client.auth.getCurrentUser).toHaveBeenCalledTimes(1);
    expect(client.__settingsRead.eq).toHaveBeenCalledWith("user_id", "user-from-auth");
  });

  it("upserts visibility directly into tokentracker_user_settings", async () => {
    const client = makeClient({
      publicViewData: { token_hash: "existing-share-token", updated_at: "2026-03-28T16:05:00.000Z" },
    });
    createClientMock.mockReturnValue(client);

    const accessToken = makeJwt({ sub: "writer-1" });
    const result = await setPublicVisibility({
      baseUrl: "https://example.insforge.app",
      accessToken,
      enabled: true,
    });

    expect(client.__settingsRead.upsert).toHaveBeenCalledTimes(1);
    expect(client.__settingsRead.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "writer-1",
        leaderboard_public: true,
      }),
      { onConflict: "user_id" },
    );
    expect(result).toEqual(
      expect.objectContaining({
        enabled: true,
        share_token: "existing-share-token",
      }),
    );
    expect(typeof result.updated_at).toBe("string");
  });
});
