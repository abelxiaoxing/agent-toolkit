import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getPlaywrightBrowserRoots, isPlaywrightChromiumInstalled } from "./runtime.js";

describe("getPlaywrightBrowserRoots", () => {
  const skillDir = "/tmp/dev-browser";

  it("uses the hermetic local browser directory when PLAYWRIGHT_BROWSERS_PATH is 0", () => {
    expect(
      getPlaywrightBrowserRoots({
        skillDir,
        platform: "win32",
        env: { PLAYWRIGHT_BROWSERS_PATH: "0" },
      })
    ).toEqual([join(skillDir, "node_modules", "playwright-core", ".local-browsers")]);
  });

  it("prefers LOCALAPPDATA on Windows before USERPROFILE fallback", () => {
    expect(
      getPlaywrightBrowserRoots({
        skillDir,
        platform: "win32",
        env: {
          LOCALAPPDATA: "C:\\Users\\Alice\\AppData\\Local",
          USERPROFILE: "C:\\Users\\Alice",
        },
      })
    ).toEqual([join("C:\\Users\\Alice\\AppData\\Local", "ms-playwright")]);
  });

  it("falls back to USERPROFILE when LOCALAPPDATA is unavailable", () => {
    expect(
      getPlaywrightBrowserRoots({
        skillDir,
        platform: "win32",
        env: { USERPROFILE: "C:\\Users\\Alice" },
      })
    ).toEqual([join("C:\\Users\\Alice", "AppData", "Local", "ms-playwright")]);
  });
});

describe("isPlaywrightChromiumInstalled", () => {
  const skillDir = "/tmp/dev-browser";

  it("detects chromium in the hermetic local browser directory", () => {
    const hermeticRoot = join(skillDir, "node_modules", "playwright-core", ".local-browsers");

    expect(
      isPlaywrightChromiumInstalled({
        skillDir,
        platform: "win32",
        env: { PLAYWRIGHT_BROWSERS_PATH: "0" },
        exists: (path) => path === hermeticRoot,
        readDir: () => ["chromium-1162"],
      })
    ).toBe(true);
  });
});
