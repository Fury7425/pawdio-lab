export const DEVICE_UI_STORAGE_KEY = "pawdio-lab-device-ui-v1";

export const APPEARANCE_MODES = ["Dark", "Light", "System"] as const;
export type AppearanceMode = (typeof APPEARANCE_MODES)[number];

export const ACCENT_COLORS = ["Blue", "Teal", "Greyscale", "Purple"] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];

export const DEFAULT_APPEARANCE_MODE: AppearanceMode = "Dark";
export const DEFAULT_ACCENT_COLOR: AccentColor = "Blue";
export const DEFAULT_INPUT_BIT_DEPTH = "Auto";
const APPEARANCE_SYNC_EVENT = "pawdio-lab-appearance-sync";

export type DeviceUiPrefs = {
  appearanceMode: AppearanceMode;
  accentColor: AccentColor;
  inputBitDepth: string;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function normalizeAppearanceMode(value: unknown): AppearanceMode {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "dark") {
      return "Dark";
    }
    if (normalized === "light") {
      return "Light";
    }
    if (normalized === "system") {
      return "System";
    }
  }
  if (value === "Dark" || value === "Light" || value === "System") {
    return value;
  }
  return DEFAULT_APPEARANCE_MODE;
}

export function normalizeAccentColor(value: unknown): AccentColor {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "blue") {
      return "Blue";
    }
    if (normalized === "teal") {
      return "Teal";
    }
    if (normalized === "greyscale" || normalized === "grayscale") {
      return "Greyscale";
    }
    if (normalized === "purple") {
      return "Purple";
    }
  }
  if (
    value === "Blue" ||
    value === "Teal" ||
    value === "Greyscale" ||
    value === "Purple"
  ) {
    return value;
  }
  return DEFAULT_ACCENT_COLOR;
}

function normalizeInputBitDepth(value: unknown): string {
  if (value === "Auto" || value === "16" || value === "24" || value === "32") {
    return value;
  }
  return DEFAULT_INPUT_BIT_DEPTH;
}

export function readDeviceUiPrefs(): DeviceUiPrefs | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(DEVICE_UI_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    const record = toRecord(parsed);
    if (!record) {
      return null;
    }

    return {
      appearanceMode: normalizeAppearanceMode(record.appearanceMode),
      accentColor: normalizeAccentColor(record.accentColor),
      inputBitDepth: normalizeInputBitDepth(record.inputBitDepth),
    };
  } catch {
    return null;
  }
}

export function persistDeviceUiPrefs(prefs: DeviceUiPrefs): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(DEVICE_UI_STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(new Event(APPEARANCE_SYNC_EVENT));
  } catch {
    // ignore storage write failures
  }
}

function resolveThemeMode(mode: AppearanceMode): "dark" | "light" {
  if (mode === "Dark") {
    return "dark";
  }
  if (mode === "Light") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function toThemeAccent(
  accentColor: AccentColor,
): "blue" | "teal" | "greyscale" | "purple" {
  if (accentColor === "Teal") {
    return "teal";
  }
  if (accentColor === "Greyscale") {
    return "greyscale";
  }
  if (accentColor === "Purple") {
    return "purple";
  }
  return "blue";
}

export function applyAppearanceTheme(
  appearanceModeValue: unknown,
  accentColorValue: unknown,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const appearanceMode = normalizeAppearanceMode(appearanceModeValue);
  const accentColor = normalizeAccentColor(accentColorValue);
  const root = document.documentElement;

  const applyResolvedTheme = () => {
    const resolved = resolveThemeMode(appearanceMode);
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
  };

  root.dataset.appearanceMode = appearanceMode.toLowerCase();
  root.dataset.accent = toThemeAccent(accentColor);
  applyResolvedTheme();

  if (appearanceMode !== "System") {
    return () => undefined;
  }

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemThemeChange = () => {
    applyResolvedTheme();
  };

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", onSystemThemeChange);
    return () => mediaQuery.removeEventListener("change", onSystemThemeChange);
  }

  mediaQuery.addListener(onSystemThemeChange);
  return () => mediaQuery.removeListener(onSystemThemeChange);
}

export function startAppearanceThemeSync(): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  let cleanupTheme = (() => {
    const stored = readDeviceUiPrefs();
    return applyAppearanceTheme(stored?.appearanceMode, stored?.accentColor);
  })();

  const refreshThemeFromStorage = () => {
    cleanupTheme();
    const stored = readDeviceUiPrefs();
    cleanupTheme = applyAppearanceTheme(
      stored?.appearanceMode,
      stored?.accentColor,
    );
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== DEVICE_UI_STORAGE_KEY) {
      return;
    }
    refreshThemeFromStorage();
  };

  window.addEventListener(APPEARANCE_SYNC_EVENT, refreshThemeFromStorage);
  window.addEventListener("storage", onStorage);

  return () => {
    cleanupTheme();
    window.removeEventListener(APPEARANCE_SYNC_EVENT, refreshThemeFromStorage);
    window.removeEventListener("storage", onStorage);
  };
}
