import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkSection } from "./NetworkSection.jsx";

const hookMock = vi.hoisted(() => ({
  available: true,
  loading: false,
  config: {
    mode: "manual",
    protocol: "http",
    host: "",
    port: "",
    effective: "none",
  },
  save: vi.fn(),
  testConnection: vi.fn(),
}));

vi.mock("../../lib/copy", () => ({
  copy: (key) => key,
}));

describe("NetworkSection", () => {
  beforeEach(() => {
    hookMock.available = true;
    hookMock.config = {
      mode: "manual",
      protocol: "http",
      host: "",
      port: "",
      effective: "none",
      applyError: null,
    };
    hookMock.save.mockReset();
    hookMock.testConnection.mockReset();
  });

  it("does not save in manual mode when host and port fail validation", async () => {
    const user = userEvent.setup();
    render(<NetworkSection proxySettings={hookMock} />);

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "settings.network.save" }));
    });

    expect(hookMock.save).not.toHaveBeenCalled();
    expect(screen.getByText("settings.network.error.host")).toBeInTheDocument();
    expect(screen.getByText("settings.network.error.port")).toBeInTheDocument();
  });

  it("does not save when the host includes a protocol prefix", async () => {
    const user = userEvent.setup();
    hookMock.config = {
      mode: "manual",
      protocol: "http",
      host: "http://127.0.0.1",
      port: "7890",
      effective: "none",
    };
    render(<NetworkSection proxySettings={hookMock} />);

    await act(async () => {
      await user.click(screen.getByRole("button", { name: "settings.network.save" }));
    });

    expect(hookMock.save).not.toHaveBeenCalled();
    expect(screen.getByText("settings.network.error.host")).toBeInTheDocument();
  });

  it("surfaces a last-apply failure from the local API", () => {
    hookMock.config = {
      mode: "manual",
      protocol: "socks5",
      host: "127.0.0.1",
      port: "7890",
      effective: "manual",
      applyError: "bad url",
    };
    render(<NetworkSection proxySettings={hookMock} />);
    expect(screen.getByRole("alert")).toHaveTextContent("settings.network.apply_error");
  });
});
