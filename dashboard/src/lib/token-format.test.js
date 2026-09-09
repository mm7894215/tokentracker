import { describe, expect, it } from "vitest";
import {
  TOKEN_FORMAT_MODES,
  formatTokenCount,
  formatTokenTooltip,
  normalizeTokenFormatMode,
} from "./token-format";

describe("token number formatting", () => {
  it("uses compact K/M/B output by default", () => {
    expect(formatTokenCount(12_345)).toBe("12.3K");
    expect(formatTokenCount(12_345_678)).toBe("12.3M");
    expect(formatTokenCount(12_345_678_901)).toBe("12.3B");
  });

  it("returns grouped exact digits in full mode or forced-full locations", () => {
    expect(formatTokenCount(12_345_678, { mode: TOKEN_FORMAT_MODES.FULL })).toBe("12,345,678");
    expect(formatTokenCount(12_345_678, { forceFull: true })).toBe("12,345,678");
  });

  it("supports Chinese Wan/Yi units mode", () => {
    expect(formatTokenCount(12_345, { mode: TOKEN_FORMAT_MODES.CHINESE })).toBe("1.2万");
    expect(formatTokenCount(12_345_678, { mode: TOKEN_FORMAT_MODES.CHINESE })).toBe("1234.6万");
    expect(formatTokenCount(123_456_789, { mode: TOKEN_FORMAT_MODES.CHINESE })).toBe("1.2亿");
    expect(formatTokenCount(1_234_567_890_123, { mode: TOKEN_FORMAT_MODES.CHINESE })).toBe("1.2万亿");
  });

  it("keeps compact and exact values together in hover text", () => {
    expect(formatTokenTooltip(12_345_678)).toBe("12.3M · 12,345,678");
    expect(formatTokenTooltip(999)).toBe("999");
  });

  it("shows compact Chinese units with the exact number in hover text", () => {
    expect(formatTokenTooltip(12_345, { mode: TOKEN_FORMAT_MODES.CHINESE })).toBe("1.2万 · 12,345");
  });

  it("normalizes unknown persisted values to compact", () => {
    expect(normalizeTokenFormatMode("other")).toBe(TOKEN_FORMAT_MODES.COMPACT);
  });

  it("round-trips every known display mode", () => {
    for (const mode of Object.values(TOKEN_FORMAT_MODES)) {
      expect(normalizeTokenFormatMode(mode)).toBe(mode);
    }
  });
});
