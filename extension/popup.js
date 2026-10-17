const messageBannerEl = document.getElementById("message-banner");
const refreshConnectionButtonEl = document.getElementById("refresh-connection-button");
const themeSelectEl = document.getElementById("theme-select");
const themeButtonEl = document.getElementById("theme-button");
const boardSpecButtonEl = document.getElementById("board-spec-button");
const advancedToggleEl = document.getElementById("advanced-toggle");
const advancedOptionsEl = document.getElementById("advanced-options");
const themeDescriptionEl = document.getElementById("theme-description");
const themeCardEl = document.getElementById("theme-card");
const themeApplyControlsEl = document.getElementById("theme-apply-controls");
const themeFileActionsScrapeEl = document.getElementById("theme-file-actions-scrape");
const extractCardEl = document.getElementById("extract-card");
const extractButtonEl = document.getElementById("extract-button");
const extractPawButtonEl = document.getElementById("extract-paw-button");
const downloadButtonEl = document.getElementById("download-button");
const downloadButtonScrapeEl = document.getElementById("download-button-scrape");
const uploadButtonEl = document.getElementById("upload-button");
const uploadButtonScrapeEl = document.getElementById("upload-button-scrape");
const saveThemeButtonEl = document.getElementById("save-theme-button");
const saveThemeButtonScrapeEl = document.getElementById("save-theme-button-scrape");
const uploadThemeFileEl = document.getElementById("upload-theme-file");
const deleteThemeButtonEl = document.getElementById("delete-theme-button");
const deleteThemeButtonScrapeEl = document.getElementById("delete-theme-button-scrape");
const themePreviewBackgroundsEl = document.getElementById("theme-preview-backgrounds");
const themePreviewCubeTextEl = document.getElementById("theme-preview-cube-text");
const themePreviewAccentsEl = document.getElementById("theme-preview-accents");
const themePreviewNameEl = document.getElementById("theme-preview-name");
const themePreviewFontsEl = document.getElementById("theme-preview-fonts");
const themePreviewLogoWrapEl = document.getElementById("theme-preview-logo-wrap");
const themePreviewLogoButtonEl = document.getElementById("theme-preview-logo-button");
const themePreviewLogoEl = document.getElementById("theme-preview-logo");
const boardSpecDialogEl = document.getElementById("board-spec-dialog");
const boardSpecContentEl = document.getElementById("board-spec-content");
const boardSpecCopyButtonEl = document.getElementById("board-spec-copy-button");
const boardSpecApplyButtonEl = document.getElementById("board-spec-apply-button");
const themeColorDialogEl = document.getElementById("theme-color-dialog");
const themeColorHexInputEl = document.getElementById("theme-color-hex-input");
const themeColorPickerInputEl = document.getElementById("theme-color-picker-input");
const themeColorApplyButtonEl = document.getElementById("theme-color-apply-button");
const themeColorCancelButtonEl = document.getElementById("theme-color-cancel-button");
const themeLogoDialogEl = document.getElementById("theme-logo-dialog");
const themeLogoUrlInputEl = document.getElementById("theme-logo-url-input");
const themeLogoApplyButtonEl = document.getElementById("theme-logo-apply-button");
const themeLogoCancelButtonEl = document.getElementById("theme-logo-cancel-button");
const colorSchemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
const EXTRACTION_BLUEPRINT_FILE = "themes/workspace-theme_blueprint.json";

const applyOptionInputs = {
  boardProperties: document.getElementById("option-board-properties"),
  canvas: document.getElementById("option-canvas"),
  customColors: document.getElementById("option-custom-colors"),
  typography: document.getElementById("option-typography"),
  chartStyling: document.getElementById("option-chart-styling"),
  chartAxisTitles: document.getElementById("option-chart-axis-titles"),
  cubeViewShell: document.getElementById("option-cube-view-shell"),
  singleCell: document.getElementById("option-single-cell"),
  gridRows: document.getElementById("option-grid-rows"),
  gridColumns: document.getElementById("option-grid-columns"),
  gridData: document.getElementById("option-grid-data"),
  removeConditionalFormatting: document.getElementById("option-remove-conditional-formatting"),
  conditionalFormatting: document.getElementById("option-conditional-formatting"),
  syncTiles: document.getElementById("option-sync-tiles"),
  logo: document.getElementById("option-logo"),
  widgets: document.getElementById("option-widgets"),
  autoAlignRows: document.getElementById("option-auto-align-rows"),
  autoEqualizeHeights: document.getElementById("option-auto-equalize-heights")
};

let themeCatalog = [];
let generatedThemeState = null;
let pawAvailable = false;
let themePreviewLogoRequestId = 0;
let themeDraftState = null;
let pendingSwatchEdit = null;
let pendingLogoEditThemeId = null;

function setThemeColorEditorValue(color) {
  const normalizedColor = normalizeHexColor(color) || "#000000";
  themeColorHexInputEl.value = normalizedColor;
  themeColorPickerInputEl.value = normalizedColor;
}

function getActionIconSet(isDarkMode) {
  const prefix = isDarkMode ? "dark" : "light";
  return {
    16: `assets/icon-${prefix}-16.png`,
    32: `assets/icon-${prefix}-32.png`,
    48: `assets/icon-${prefix}-48.png`,
    128: `assets/icon-${prefix}-128.png`
  };
}

async function syncActionIconTheme() {
  if (!chrome?.action?.setIcon) {
    return;
  }

  try {
    await chrome.action.setIcon({
      path: getActionIconSet(colorSchemeMedia.matches)
    });
  } catch (_error) {
    // Ignore icon update issues inside the popup.
  }
}

function setOutput(message, kind = "info") {
  if (!message) {
    messageBannerEl.hidden = true;
    messageBannerEl.textContent = "";
    messageBannerEl.className = "message-banner";
    return;
  }

  messageBannerEl.hidden = false;
  messageBannerEl.textContent = message;
  messageBannerEl.className = `message-banner${kind === "error" ? " is-error" : kind === "success" ? " is-success" : ""}`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active browser tab was found.");
  }
  return tab;
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  return chrome.tabs.sendMessage(tab.id, message);
}

async function ensureBridgeInActiveTab() {
  const tab = await getActiveTab();
  try {
    await chrome.tabs.sendMessage(tab.id, { action: "ping" });
    return tab;
  } catch (_error) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content-script.js"]
    });
    return tab;
  }
}

async function getGeneratedThemes() {
  const stored = await chrome.storage.local.get("generatedThemes");
  return Array.isArray(stored.generatedThemes) ? stored.generatedThemes : [];
}

async function saveGeneratedTheme(themeRecord) {
  const existing = await getGeneratedThemes();
  const next = [themeRecord, ...existing.filter((item) => item.id !== themeRecord.id)].slice(0, 20);
  await chrome.storage.local.set({ generatedThemes: next });
}

async function deleteGeneratedTheme(themeId) {
  const existing = await getGeneratedThemes();
  await chrome.storage.local.set({
    generatedThemes: existing.filter((item) => item.id !== themeId)
  });
}

function ensureSuccess(response) {
  if (!response || typeof response !== "object") {
    throw new Error("The active page did not return a usable response.");
  }
  if (response?.ok === false) {
    throw new Error(response.error || "The PAW page bridge returned an error.");
  }
  return response;
}

function sanitizeName(value) {
  return (value || "Extracted Theme")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  const normalized = value.length === 3
    ? value.split("").map((char) => char + char).join("")
    : value;
  const num = Number.parseInt(normalized, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function mix(hexA, hexB, amount) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return rgbToHex({
    r: Math.round(a.r + (b.r - a.r) * amount),
    g: Math.round(a.g + (b.g - a.g) * amount),
    b: Math.round(a.b + (b.b - a.b) * amount)
  });
}

function getContrastTextColor(backgroundHex, light = "#FFFFFF", dark = "#161616") {
  if (!backgroundHex || backgroundHex === "transparent" || !backgroundHex.startsWith("#")) {
    return dark;
  }

  const { r, g, b } = hexToRgb(backgroundHex);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.53 ? light : dark;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(target, source) {
  Object.entries(source || {}).forEach(([key, value]) => {
    if (isObject(value)) {
      target[key] = deepMerge(isObject(target[key]) ? target[key] : {}, value);
    } else {
      target[key] = value;
    }
  });
  return target;
}

function getPersistedValue(entry) {
  if (isObject(entry) && "value" in entry) {
    return entry.value;
  }
  return entry;
}

function getMdvGenericSection(genericProperties, sectionName) {
  if (!isObject(genericProperties) || !sectionName) {
    return null;
  }
  const sectionValue = getPersistedValue(genericProperties[sectionName]);
  return isObject(sectionValue) ? sectionValue : null;
}

function uniqueColors(values) {
  return [...new Set((values || []).filter((value) => typeof value === "string" && value))];
}

function normalizeHexColor(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const match = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) {
    return null;
  }
  const raw = match[1];
  const expanded = raw.length === 3
    ? raw.split("").map((char) => `${char}${char}`).join("")
    : raw;
  return `#${expanded.toUpperCase()}`;
}

function deriveAuthoringPalette(themeSource) {
  const source = themeSource || {};
  const semantic = source.semantic || {};
  const semanticBackgrounds = semantic.backgrounds || {};
  const semanticAccents = semantic.accents || {};
  const authoring = source.authoringPalette || {};
  const authoringBackgrounds = authoring.backgrounds || {};
  const authoringAccents = Array.isArray(authoring.accents) ? authoring.accents : [];

  const backgroundPrimary = normalizeHexColor(authoringBackgrounds.primary)
    || normalizeHexColor(semanticBackgrounds.tab)
    || normalizeHexColor(semanticBackgrounds.dashboard)
    || normalizeHexColor(semanticBackgrounds.canvas)
    || "#F4F4F4";
  const backgroundSecondary = normalizeHexColor(authoringBackgrounds.secondary)
    || normalizeHexColor(semanticBackgrounds.surface)
    || normalizeHexColor(semanticBackgrounds.surfaceAlt)
    || normalizeHexColor(semanticBackgrounds.data)
    || backgroundPrimary;

  const accentCandidates = uniqueColors(
    [
      ...authoringAccents,
      ...(Array.isArray(semanticAccents.chartSeries) ? semanticAccents.chartSeries : []),
      semanticAccents.primary,
      semanticAccents.secondary,
      semanticAccents.tertiary,
      semanticAccents.interactive
    ]
      .map((color) => normalizeHexColor(color))
      .filter(Boolean)
  );
  const accents = ensureAccentPalette(
    accentCandidates,
    ["#6929C4", "#A56EFF", "#296370", "#A6C8FF", "#00BAA1"],
    [backgroundSecondary]
  );

  return {
    backgrounds: {
      primary: backgroundPrimary,
      secondary: backgroundSecondary
    },
    accents
  };
}

function compileThemeDefinition(themeSource) {
  const source = structuredClone(themeSource || {});
  const authoringPalette = deriveAuthoringPalette(source);
  source.authoringPalette = authoringPalette;
  if (!source.semantic) {
    source.semantic = {};
  }

  const semantic = source.semantic || {};
  const authoringBackgrounds = authoringPalette.backgrounds || {};
  const authoringAccents = authoringPalette.accents || [];
  const backgrounds = semantic.backgrounds || {};
  const neutrals = semantic.neutrals || {};
  const accents = semantic.accents || {};
  const typography = semantic.typography || {};
  const fonts = typography.fonts || {};
  const scale = typography.scale || {};
  const radii = semantic.radii || {};
  const layout = source.layout || {};

  const dashboardBackground = backgrounds.dashboard || backgrounds.tab || backgrounds.canvas || authoringBackgrounds.primary || backgrounds.surface || backgrounds.surfaceAlt || "#F4F4F4";
  const tabBackground = backgrounds.tab || backgrounds.canvas || backgrounds.dashboard || authoringBackgrounds.primary || dashboardBackground;
  const surface = backgrounds.surface || backgrounds.surfaceAlt || backgrounds.data || authoringBackgrounds.secondary || dashboardBackground || "#FFFFFF";
  const surfaceAlt = backgrounds.surfaceAlt || authoringBackgrounds.secondary || surface;
  const dataBackground = backgrounds.data || surface;
  const spacerBackground = backgrounds.spacer || dataBackground;
  const gridBackground = backgrounds.grid || "transparent";
  const syncTileBackground = backgrounds.syncTile || "transparent";
  const shapeBackground = backgrounds.shape || surface;

  const border = neutrals.border || "#E0E0E0";
  const text = neutrals.text || "#161616";
  const mutedText = neutrals.mutedText || "#8D8D8D";
  const headerText = neutrals.headerText || "#525252";
  const appBar = neutrals.appBar || text;
  const ghostBorder = neutrals.ghostBorder || mutedText;
  const defaultZoom = source.properties?.defaultZoom || source.tokens?.canvas?.defaultZoom || "fitWidth";
  const fitPage = layout.fitPage ?? source.tokens?.canvas?.fitPage;
  const layoutPositioning = layout.layoutPositioning || source.tokens?.canvas?.layoutPositioning;

  const primary = accents.primary || authoringAccents[0] || "#6929C4";
  const secondary = accents.secondary || authoringAccents[1] || primary;
  const tertiary = accents.tertiary || authoringAccents[2] || secondary;
  const interactive = accents.interactive || "#0F62FE";
  const highlight = accents.highlight || "#CACACA";
  const selection = accents.selection || "#D0E2FF";
  const negative = accents.negative || "#FF1519";
  const rowHeader = backgrounds.rowHeader || primary;
  const columnHeader = backgrounds.columnHeader || primary;
  const gridTextColor = ensureTextContrast(
    scale.gridCell?.color || text,
    [dataBackground, surface, tabBackground],
    4.5
  );
  const chartSeries = ensureAccentPalette(
    uniqueColors([...(accents.chartSeries || []), ...authoringAccents, primary, secondary, tertiary]),
    [primary, secondary, tertiary],
    [surface]
  );
  const bodyFont = fonts.body || "Poppins-Light";
  const uiFont = fonts.ui || "Poppins-Regular";
  const headingFont = fonts.heading || "Poppins-Bold";
  const gridFont = fonts.grid || bodyFont;
  const rowHeaderFont = fonts.rowHeader || gridFont;

  const cardRadius = radii.card ?? 10;
  const buttonRadius = radii.button ?? 60;
  const textRadius = radii.text ?? 5;
  const shapeRadius = radii.shape ?? 0;
  const rowHeaderContrastText = getContrastTextColor(rowHeader);
  const columnHeaderContrastText = getContrastTextColor(columnHeader);
  const cardFrame = {
    borderColor: "color2",
    borderRadius: cardRadius,
    borderWidth: 1,
    background: "color1",
    boxShadow: "none"
  };

  const customColors = uniqueColors([primary, secondary, tertiary, ...chartSeries]).slice(0, 8);

  const compiled = {
    ...source,
    properties: deepMerge(
      {
        customColors: { colors: customColors }
      },
      source.properties || {}
    ),
    tokens: deepMerge(
      {
        canvas: {
          background: dashboardBackground,
          dashboardBackground,
          tabBackground,
          pageSize: layout.pageSize || source.tokens?.canvas?.pageSize,
          fitPage,
          layoutPositioning,
          defaultZoom,
          appBar
        },
        palette: {
          color1: surface,
          color2: border,
          color3: text,
          color4: mutedText,
          color9: interactive,
          color13: headerText,
          grayShade1: surfaceAlt
        },
        brand: {
          primary,
          secondary,
          tertiary
        },
        charts: {
          series: chartSeries,
          negative,
          defaultPaletteIndex: source.tokens?.charts?.defaultPaletteIndex ?? 0
        },
        typography: {
          fonts: {
            body: bodyFont,
            ui: uiFont,
            heading: headingFont,
            grid: gridFont
          },
          scale: {
            widgetHeading: {
              font: headingFont,
              size: scale.widgetHeading?.size || "14px",
              weight: scale.widgetHeading?.weight || "700",
              color: scale.widgetHeading?.color || text
            },
            body: {
              font: bodyFont,
              size: scale.body?.size || "14px",
              weight: scale.body?.weight || "400",
              color: scale.body?.color || text
            },
            caption: {
              font: scale.caption?.font || bodyFont,
              size: scale.caption?.size || "12px",
              weight: scale.caption?.weight || "400",
              color: scale.caption?.color || headerText
            },
            button: {
              font: scale.button?.font || uiFont,
              size: scale.button?.size || "14px",
              weight: scale.button?.weight || "400"
            },
            selector: {
              font: scale.selector?.font || uiFont,
              size: scale.selector?.size || "16px",
              weight: scale.selector?.weight || "400",
              color: scale.selector?.color || text
            },
            gridCell: {
              font: scale.gridCell?.font || gridFont,
              size: scale.gridCell?.size || "12px",
              weight: scale.gridCell?.weight || "400",
              color: scale.gridCell?.color || text
            },
            kpiValue: {
              font: scale.kpiValue?.font || gridFont,
              size: scale.kpiValue?.size || "20px",
              weight: scale.kpiValue?.weight || "400",
              color: scale.kpiValue?.color || text
            }
          }
        },
        widgets: {
          cubeviewerCard: { ...cardFrame },
          chartCard: { ...cardFrame },
          singleCellCard: { ...cardFrame },
          grid: {
            borderColor: "transparent",
            borderRadius: 0,
            background: gridBackground
          },
          syncTile: {
            borderColor: "transparent",
            borderRadius: 0,
            background: syncTileBackground
          },
          textLabel: {
            borderRadius: 0,
            background: "color1",
            borderColor: "color2"
          },
          textPill: {
            borderRadius: textRadius,
            background: "color1",
            borderColor: "color2"
          },
          shape: {
            fillColor: shapeBackground,
            borderColor: "transparent",
            borderRadius: shapeRadius
          }
        },
        buttons: {
          borderRadius: buttonRadius,
          font: uiFont,
          fontSize: scale.button?.size || "14px",
          variants: {
            primary: { fill: `customColor${primary.replace("#", "")}`, border: "color3", text: "#FFFFFF" },
            secondary: { fill: `customColor${secondary.replace("#", "")}`, border: "color1", text: "#FFFFFF" },
            tertiary: { fill: `customColor${tertiary.replace("#", "")}`, border: "transparent", text: text },
            neutral: { fill: "grayShade1", border: "transparent", text: text },
            ghost: { fill: "transparent", border: "color4", text: text },
            inverse: { fill: "color1", border: "transparent", text: text }
          }
        }
      },
      source.tokens || {}
    ),
    visuals: deepMerge(
      {
        liveByVisId: {
          pasinglecell: {
            fillColor: "color1",
            borderColor: "color2",
            borderRadius: cardRadius,
            showTitle: false
          },
          pacubeviewer: {
            fillColor: "color1",
            borderColor: "color2",
            borderRadius: cardRadius,
            showTitle: true
          },
          paselector: {
            fillColor: "color1",
            borderColor: "color2",
            borderRadius: cardRadius
          }
        },
        mdv: {
          genericProperties: {
            isGridEditable: true
          },
          sections: {
            RowHeader: {
              fillColor: rowHeader,
              highlightFillColor: highlight,
              highlightBorderColor: "transparent",
              selectionFillColor: highlight,
              selectionBorderColor: "color9",
              textColor: rowHeaderContrastText,
              fontFamily: rowHeaderFont,
              textFormat: {},
              showThumb: false,
              "inherit-fill-color": false,
              "inherit-font-family": false,
              "inherit-font-text-styles": false
            },
            ColumnHeader: {
              fillColor: columnHeader,
              highlightFillColor: highlight,
              highlightBorderColor: "transparent",
              selectionFillColor: highlight,
              selectionBorderColor: "color9",
              textColor: columnHeaderContrastText,
              showThumb: false,
              "inherit-fill-color": false,
              "inherit-font-text-color": false,
              "inherit-font-family": false,
              "inherit-font-text-styles": false
            },
            DataCell: {
              fillColor: dataBackground,
              highlightFillColor: "transparent",
              highlightBorderColor: "transparent",
              selectionFillColor: selection,
              selectionBorderColor: "color9",
              textColor: gridTextColor,
              fontFamily: gridFont,
              fontSize: "12",
              applyFontStyleToAll: false,
              applyFontSizeToAll: false,
              applyFontFamilyToAll: false
            },
            Spacer: {
              fillColor: spacerBackground,
              dividers: false
            }
          }
        },
        syncTile: {
          fillColor: syncTileBackground,
          borderColor: "transparent",
          borderRadius: 0
        },
        text: {
          borderRadius: textRadius
        },
        actionButton: {
          borderRadius: buttonRadius
        }
      },
      source.visuals || {}
    )
  };

  return compiled;
}

function normalizePreviewLogoUrl(rawValue) {
  if (typeof rawValue !== "string") {
    return "";
  }

  const value = rawValue.trim();
  if (!value) {
    return "";
  }

  const lowerValue = value.toLowerCase();
  if (lowerValue.startsWith("data:image/svg+xml") || /\.svg(\?|#|$)/i.test(value)) {
    return "";
  }

  if (/^assets\//i.test(value)) {
    return chrome.runtime.getURL(value);
  }

  if (/^(https?:\/\/|data:image\/|blob:|chrome-extension:\/\/)/i.test(value)) {
    return value;
  }

  return "";
}

function sanitizeThemeSource(themeSource) {
  const sanitized = structuredClone(themeSource || {});
  const existingCustomColors = Array.isArray(sanitized.properties?.customColors?.colors)
    ? sanitized.properties.customColors.colors
    : [];
  const fallbackCustomColors = [
    ...(Array.isArray(sanitized.authoringPalette?.accents) ? sanitized.authoringPalette.accents : []),
    sanitized.semantic?.accents?.primary,
    sanitized.semantic?.accents?.secondary,
    sanitized.semantic?.accents?.tertiary,
    ...(Array.isArray(sanitized.semantic?.accents?.chartSeries) ? sanitized.semantic.accents.chartSeries : [])
  ]
    .map((color) => normalizeHexColor(color))
    .filter(Boolean);
  const normalizedExisting = uniqueColors(
    existingCustomColors.map((color) => normalizeHexColor(color)).filter(Boolean)
  );
  const normalizedCustomColors = uniqueColors([
    ...normalizedExisting,
    ...fallbackCustomColors
  ]).slice(0, Math.max(normalizedExisting.length, 8));

  if (normalizedCustomColors.length) {
    sanitized.properties = sanitized.properties || {};
    sanitized.properties.customColors = {
      colors: normalizedCustomColors
    };
  } else if (sanitized.properties?.customColors) {
    delete sanitized.properties.customColors;
    if (!Object.keys(sanitized.properties).length) {
      delete sanitized.properties;
    }
  }

  return sanitized;
}

function resolveBundledThemeAssets(themeSource) {
  const resolved = sanitizeThemeSource(themeSource);
  const logoUrl = normalizePreviewLogoUrl(resolved?.branding?.logo?.url);
  if (resolved?.branding?.logo) {
    if (logoUrl) {
      resolved.branding.logo.url = logoUrl;
    } else {
      delete resolved.branding.logo;
    }
  }
  return resolved;
}

function buildThemeLookup(themeDefinition) {
  const palette = themeDefinition.tokens?.palette || {};
  const brand = themeDefinition.tokens?.brand || {};
  const customColors = themeDefinition.properties?.customColors?.colors || [];
  const lookup = { ...palette, ...brand };

  customColors.forEach((color) => {
    if (typeof color === "string" && color.startsWith("#")) {
      lookup[`customColor${color.slice(1)}`] = color;
    }
  });

  lookup.transparent = "transparent";
  return lookup;
}

const PAW_BASE_THEME_LOOKUPS = {
  carbongrey10: {
    color1: "#FFFFFF",
    color2: "#E0E0E0",
    color3: "#161616",
    color4: "#8D8D8D",
    color5: "#525252",
    color9: "#0F62FE",
    color10: "#0043CE",
    color11: "#A6C8FF",
    color13: "#525252",
    color14: "#CACACA",
    grayShade1: "#F4F4F4"
  },
  carbongrey100: {
    color1: "#262626",
    color2: "#525252",
    color3: "#F4F4F4",
    color4: "#C6C6C6",
    color5: "#E0E0E0",
    color9: "#78A9FF",
    color10: "#A6C8FF",
    color11: "#0F62FE",
    color13: "#C6C6C6",
    color14: "#393939",
    grayShade1: "#161616"
  }
};

function resolvePawBaseThemeColorToken(baseTheme, tokenOrValue) {
  if (!tokenOrValue || typeof tokenOrValue !== "string") {
    return null;
  }

  const normalizedToken = tokenOrValue.trim();
  if (!normalizedToken) {
    return null;
  }

  const lookupKey = String(baseTheme || "carbonGrey10").trim().toLowerCase();
  const lookup = PAW_BASE_THEME_LOOKUPS[lookupKey] || PAW_BASE_THEME_LOOKUPS.carbongrey10;
  return lookup[normalizedToken] || null;
}

function normalizePawSpecColorValue(value, baseTheme) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed === "transparent") {
      return "transparent";
    }

    const directHex = normalizeHexColor(trimmed);
    if (directHex) {
      return directHex;
    }

    const customColorMatch = trimmed.match(/^customColor([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (customColorMatch) {
      return normalizeHexColor(`#${customColorMatch[1]}`);
    }

    const classTokenMatch = trimmed.match(/^(?:fill|border)-(.+)$/i);
    if (classTokenMatch) {
      return normalizePawSpecColorValue(classTokenMatch[1], baseTheme);
    }

    if (/^default$/i.test(trimmed)) {
      return resolvePawBaseThemeColorToken(baseTheme, "grayShade1");
    }

    const baseThemeToken = resolvePawBaseThemeColorToken(baseTheme, trimmed);
    if (baseThemeToken) {
      return baseThemeToken;
    }

    const rgbaMatch = trimmed.match(/^rgba?\(([^)]+)\)$/i);
    if (!rgbaMatch) {
      return null;
    }

    const parts = rgbaMatch[1].split(",").map((part) => part.trim());
    const alpha = parts.length > 3 ? Number.parseFloat(parts[3]) : 1;
    if (Number.isFinite(alpha) && alpha < 0.03) {
      return null;
    }

    const rgb = parts.slice(0, 3).map((part) => Number.parseFloat(part));
    if (rgb.some((component) => Number.isNaN(component))) {
      return null;
    }

    return `#${rgb
      .map((component) => Math.max(0, Math.min(255, Math.round(component))).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()}`;
  }

  if (isObject(value)) {
    return normalizePawSpecColorValue(value.hexValue, baseTheme)
      || normalizePawSpecColorValue(value.id, baseTheme)
      || normalizePawSpecColorValue(value.value, baseTheme)
      || normalizePawSpecColorValue(value.name, baseTheme)
      || null;
  }

  return null;
}

function resolveThemeColor(themeDefinition, tokenOrValue) {
  if (!tokenOrValue || typeof tokenOrValue !== "string") {
    return null;
  }
  if (tokenOrValue === "transparent") {
    return "transparent";
  }
  if (tokenOrValue.startsWith("#")) {
    return tokenOrValue.toUpperCase();
  }

  const lookup = buildThemeLookup(themeDefinition);
  if (lookup[tokenOrValue]) {
    return lookup[tokenOrValue];
  }

  if (tokenOrValue.startsWith("customColor")) {
    const rawHex = tokenOrValue.slice("customColor".length);
    return rawHex ? `#${rawHex.toUpperCase()}` : null;
  }

  return null;
}

function getRelativeLuminance(hex) {
  if (!hex || hex === "transparent" || !hex.startsWith("#")) {
    return 0;
  }

  const { r, g, b } = hexToRgb(hex);
  const transform = (value) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * transform(r) + 0.7152 * transform(g) + 0.0722 * transform(b);
}

function getContrastRatio(colorA, colorB) {
  const luminanceA = getRelativeLuminance(colorA);
  const luminanceB = getRelativeLuminance(colorB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

function getRgbDistance(colorA, colorB) {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  return Math.sqrt(
    ((a.r - b.r) ** 2) +
    ((a.g - b.g) ** 2) +
    ((a.b - b.b) ** 2)
  );
}

function pushDistinctColor(target, color, threshold = 25) {
  if (!color || typeof color !== "string") {
    return false;
  }
  if (target.some((existing) => getRgbDistance(existing, color) < threshold)) {
    return false;
  }
  target.push(color);
  return true;
}

function ensureBackgroundPair(colors, fallbackColors = []) {
  const candidates = [...(colors || []), ...(fallbackColors || [])].filter((color) => typeof color === "string" && color.startsWith("#"));
  const distinct = [];
  candidates.forEach((color) => {
    pushDistinctColor(distinct, color, 12);
  });

  for (let index = 0; index < distinct.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < distinct.length; compareIndex += 1) {
      const first = distinct[index];
      const second = distinct[compareIndex];
      const luminanceDiff = Math.abs(getRelativeLuminance(first) - getRelativeLuminance(second));
      if (luminanceDiff >= 0.03 && luminanceDiff <= 0.35) {
        return [first, second];
      }
    }
  }

  const base = distinct[0] || "#F7F7F7";
  const derived = distinct[1] || (getRelativeLuminance(base) > 0.75 ? mix(base, "#EAEAEA", 0.18) : mix(base, "#FFFFFF", 0.16));
  return [base, derived];
}

function isTooCloseToAny(color, blockedColors = [], threshold = 24) {
  if (!color || !Array.isArray(blockedColors) || !blockedColors.length) {
    return false;
  }
  return blockedColors.some((blocked) =>
    typeof blocked === "string" &&
    blocked.startsWith("#") &&
    getRgbDistance(color, blocked) < threshold
  );
}

function ensureAccentPalette(colors, fallbackColors = [], blockedColors = []) {
  const pool = [...(colors || []), ...(fallbackColors || [])].filter((color) => {
    if (typeof color !== "string" || !color.startsWith("#")) {
      return false;
    }
    const luminance = getRelativeLuminance(color);
    return luminance > 0.02 && luminance < 0.95 && !isTooCloseToAny(color, blockedColors, 24);
  });

  const accents = [];
  pool.forEach((color) => {
    pushDistinctColor(accents, color, 25);
  });

  const seed = accents[0] || fallbackColors[0] || "#6929C4";
  let attempts = 0;
  while (accents.length < 5 && attempts < 24) {
    const base = accents[attempts % Math.max(accents.length, 1)] || seed;
    const candidate = mix(
      base,
      attempts % 2 === 0 ? "#FFFFFF" : "#000000",
      0.14 + ((attempts % 3) * 0.08)
    );
    if (!isTooCloseToAny(candidate, blockedColors, 24)) {
      pushDistinctColor(accents, candidate, 18);
    }
    attempts += 1;
  }

  return accents.slice(0, 8);
}

function ensureTextContrast(color, backgroundColors = [], minRatio = 4.5) {
  const candidate = normalizeHexColor(color);
  const backgrounds = (backgroundColors || [])
    .map((background) => normalizeHexColor(background))
    .filter(Boolean);

  if (!backgrounds.length) {
    return candidate || "#161616";
  }

  const preferredFallback = getContrastTextColor(backgrounds[0], "#FFFFFF", "#161616");
  if (!candidate) {
    return preferredFallback;
  }

  const currentMinimumContrast = Math.min(...backgrounds.map((background) => getContrastRatio(candidate, background)));
  if (currentMinimumContrast >= minRatio) {
    return candidate;
  }

  const weakestBackground = backgrounds
    .map((background) => ({
      background,
      ratio: getContrastRatio(candidate, background)
    }))
    .sort((left, right) => left.ratio - right.ratio)[0]?.background || backgrounds[0];
  const target = getContrastTextColor(weakestBackground, "#FFFFFF", "#161616");

  for (let step = 1; step <= 20; step += 1) {
    const next = mix(candidate, target, step / 20);
    const nextMinimumContrast = Math.min(...backgrounds.map((background) => getContrastRatio(next, background)));
    if (nextMinimumContrast >= minRatio) {
      return next;
    }
  }

  return target;
}

function getApplyOptions() {
  return Object.fromEntries(
    Object.entries(applyOptionInputs).map(([key, input]) => [key, Boolean(input?.checked)])
  );
}

function getDraftStateForThemeId(themeId) {
  if (!themeDraftState || themeDraftState.themeId !== themeId) {
    return null;
  }
  return themeDraftState;
}

function setSaveDraftButtonsVisible(visible) {
  saveThemeButtonEl.hidden = !visible;
  saveThemeButtonScrapeEl.hidden = !visible;
}

function loadThemeSourceForCatalogEntry(themeEntry) {
  if (!themeEntry) {
    throw new Error("Choose a theme first.");
  }

  if (themeEntry.themeDefinition) {
    return Promise.resolve(resolveBundledThemeAssets(themeEntry.themeDefinition));
  }

  return fetch(themeEntry.file)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Unable to load ${themeEntry.file} (${response.status}).`);
      }
      return response.json();
    })
    .then((themeSource) => resolveBundledThemeAssets(themeSource));
}

function ensureThemeDraftState(themeEntry, themeSource) {
  const existingDraft = getDraftStateForThemeId(themeEntry?.id);
  if (existingDraft?.originalThemeSource) {
    return existingDraft;
  }

  themeDraftState = {
    themeId: themeEntry.id,
    sourceThemeName: sanitizeName(themeSource?.name || themeEntry.name || "Theme"),
    originalThemeSource: structuredClone(themeSource),
    paletteOverrides: {
      backgrounds: {},
      cubeText: {},
      accents: {}
    },
    logoOverride: undefined,
    dirty: false
  };
  return themeDraftState;
}

function syncDraftThemeColorArrays(themeSource) {
  const authoringPalette = themeSource.authoringPalette = themeSource.authoringPalette || {};
  authoringPalette.backgrounds = authoringPalette.backgrounds || {};
  authoringPalette.accents = Array.isArray(authoringPalette.accents)
    ? authoringPalette.accents
    : [];

  themeSource.semantic = themeSource.semantic || {};
  themeSource.semantic.backgrounds = themeSource.semantic.backgrounds || {};
  themeSource.semantic.accents = themeSource.semantic.accents || {};
  themeSource.semantic.neutrals = themeSource.semantic.neutrals || {};

  const semanticAccents = themeSource.semantic.accents.chartSeries;
  themeSource.semantic.accents.chartSeries = Array.isArray(semanticAccents)
    ? semanticAccents
    : [];

  themeSource.visuals = themeSource.visuals || {};
  themeSource.visuals.mdv = themeSource.visuals.mdv || {};
  themeSource.visuals.mdv.sections = themeSource.visuals.mdv.sections || {};
  themeSource.visuals.mdv.sections.RowHeader = themeSource.visuals.mdv.sections.RowHeader || {};
  themeSource.visuals.mdv.sections.ColumnHeader = themeSource.visuals.mdv.sections.ColumnHeader || {};
  themeSource.visuals.mdv.sections.DataCell = themeSource.visuals.mdv.sections.DataCell || {};
  themeSource.visuals.singleCell = themeSource.visuals.singleCell || {};
  themeSource.visuals.singleCell.sections = themeSource.visuals.singleCell.sections || {};
  themeSource.visuals.singleCell.sections.DataCell = themeSource.visuals.singleCell.sections.DataCell || {};

  themeSource.properties = themeSource.properties || {};
  const customColors = themeSource.properties.customColors?.colors;
  if (!themeSource.properties.customColors || !Array.isArray(customColors)) {
    themeSource.properties.customColors = {
      colors: Array.isArray(customColors) ? customColors : []
    };
  }
}

function applyDraftPaletteColor(themeSource, group, index, color) {
  if (!themeSource || !color) {
    return;
  }

  syncDraftThemeColorArrays(themeSource);
  const normalizedColor = normalizeHexColor(color);
  if (!normalizedColor) {
    return;
  }

  if (group === "backgrounds") {
    if (index === 0) {
      themeSource.authoringPalette.backgrounds.primary = normalizedColor;
      themeSource.semantic.backgrounds.dashboard = normalizedColor;
      themeSource.semantic.backgrounds.tab = normalizedColor;
      themeSource.semantic.backgrounds.surfaceAlt = normalizedColor;
      return;
    }

    if (index === 1) {
      themeSource.authoringPalette.backgrounds.secondary = normalizedColor;
      themeSource.semantic.backgrounds.surface = normalizedColor;
      themeSource.semantic.backgrounds.data = normalizedColor;
      themeSource.semantic.backgrounds.spacer = normalizedColor;
      themeSource.semantic.backgrounds.shape = normalizedColor;
    }
    return;
  }

  if (group === "cubeText") {
    if (index === 0) {
      themeSource.visuals.mdv.sections.RowHeader.textColor = normalizedColor;
      themeSource.visuals.mdv.sections.ColumnHeader.textColor = normalizedColor;
      themeSource.semantic.neutrals.headerText = normalizedColor;
      return;
    }

    if (index === 1) {
      themeSource.visuals.mdv.sections.DataCell.textColor = normalizedColor;
      themeSource.visuals.singleCell.sections.DataCell.textColor = normalizedColor;
      themeSource.semantic.neutrals.text = normalizedColor;
    }
    return;
  }

  if (group !== "accents") {
    return;
  }

  themeSource.authoringPalette.accents[index] = normalizedColor;
  themeSource.semantic.accents.chartSeries[index] = normalizedColor;
  themeSource.properties.customColors.colors[index] = normalizedColor;

  if (index === 0) {
    themeSource.semantic.accents.primary = normalizedColor;
    themeSource.semantic.accents.interactive = normalizedColor;
  } else if (index === 1) {
    themeSource.semantic.accents.secondary = normalizedColor;
  } else if (index === 2) {
    themeSource.semantic.accents.tertiary = normalizedColor;
  }
}

function buildDraftThemeSource(draftState) {
  if (!draftState?.originalThemeSource) {
    return null;
  }

  const nextThemeSource = structuredClone(draftState.originalThemeSource);
  const backgrounds = draftState.paletteOverrides?.backgrounds || {};
  const cubeText = draftState.paletteOverrides?.cubeText || {};
  const accents = draftState.paletteOverrides?.accents || {};

  Object.entries(backgrounds).forEach(([index, color]) => {
    applyDraftPaletteColor(nextThemeSource, "backgrounds", Number(index), color);
  });
  Object.entries(cubeText).forEach(([index, color]) => {
    applyDraftPaletteColor(nextThemeSource, "cubeText", Number(index), color);
  });
  Object.entries(accents).forEach(([index, color]) => {
    applyDraftPaletteColor(nextThemeSource, "accents", Number(index), color);
  });

  if (draftState.logoOverride !== undefined) {
    const trimmedLogoUrl = typeof draftState.logoOverride === "string"
      ? draftState.logoOverride.trim()
      : "";

    if (trimmedLogoUrl) {
      nextThemeSource.branding = nextThemeSource.branding || {};
      nextThemeSource.branding.logo = {
        ...(nextThemeSource.branding?.logo || {}),
        url: trimmedLogoUrl
      };
    } else if (nextThemeSource.branding?.logo) {
      delete nextThemeSource.branding.logo;
      if (!Object.keys(nextThemeSource.branding).length) {
        delete nextThemeSource.branding;
      }
    }
  }

  return nextThemeSource;
}

function renderSwatches(container, colors, options = {}) {
  const { editable = false, group = "" } = options;
  container.innerHTML = (colors || [])
    .filter(Boolean)
    .slice(0, 5)
    .map((color, index) => editable
      ? `<button class="theme-swatch-button" type="button" data-swatch-group="${group}" data-swatch-index="${index}" data-swatch-color="${color}" aria-label="${getSwatchButtonLabel(group, index)}" title="${getSwatchButtonLabel(group, index)}"><span class="theme-swatch" style="background:${color};"></span></button>`
      : `<span class="theme-swatch" style="background:${color};"></span>`)
    .join("");
}

function getSwatchButtonLabel(group, index) {
  if (group === "backgrounds") {
    return index === 0 ? "Edit primary background" : "Edit secondary background";
  }
  if (group === "cubeText") {
    if (index === 0) {
      return "Edit cubeview header text color";
    }
    return "Edit cubeview data text color";
  }
  if (group === "accents") {
    if (index === 0) {
      return "Edit primary accent";
    }
    if (index === 1) {
      return "Edit secondary accent";
    }
    if (index === 2) {
      return "Edit tertiary accent";
    }
    return `Edit accent color ${index + 1}`;
  }
  return `Edit color ${index + 1}`;
}

function updateThemePreviewLogo(logoUrl) {
  themePreviewLogoRequestId += 1;
  const requestId = themePreviewLogoRequestId;

  themePreviewLogoWrapEl.hidden = true;
  themePreviewLogoEl.removeAttribute("src");

  if (!logoUrl) {
    return;
  }

  const probe = new Image();
  probe.onload = () => {
    if (requestId !== themePreviewLogoRequestId) {
      return;
    }
    themePreviewLogoEl.src = logoUrl;
    themePreviewLogoWrapEl.hidden = false;
  };
  probe.onerror = () => {
    if (requestId !== themePreviewLogoRequestId) {
      return;
    }
    themePreviewLogoWrapEl.hidden = true;
    themePreviewLogoEl.removeAttribute("src");
  };
  probe.src = logoUrl;
}

function renderThemePreview(themeDefinition, selectedTheme) {
  if (!themeDefinition || !selectedTheme) {
    themePreviewBackgroundsEl.innerHTML = "";
    themePreviewCubeTextEl.innerHTML = "";
    themePreviewAccentsEl.innerHTML = "";
    themePreviewNameEl.textContent = "No theme selected";
    themePreviewFontsEl.textContent = "";
    updateThemePreviewLogo("");
    deleteThemeButtonEl.disabled = true;
    deleteThemeButtonScrapeEl.disabled = true;
    setSaveDraftButtonsVisible(false);
    return;
  }

  const authoringPalette = deriveAuthoringPalette(selectedTheme.themeSource || themeDefinition || {});
  // Preserve the authored background slots so both swatches stay editable,
  // even when primary and secondary intentionally use the same color.
  const backgrounds = [
    authoringPalette.backgrounds?.primary
      || resolveThemeColor(themeDefinition, themeDefinition.tokens?.canvas?.tabBackground || themeDefinition.tokens?.canvas?.dashboardBackground || themeDefinition.tokens?.canvas?.background)
      || resolveThemeColor(themeDefinition, themeDefinition.tokens?.palette?.color1),
    authoringPalette.backgrounds?.secondary
      || authoringPalette.backgrounds?.primary
      || resolveThemeColor(themeDefinition, themeDefinition.tokens?.palette?.color1)
  ].map((color) => normalizeHexColor(color)).filter(Boolean).slice(0, 2);
  const accents = uniqueColors([
    ...(Array.isArray(themeDefinition.tokens?.charts?.series) ? themeDefinition.tokens.charts.series : []),
    ...(authoringPalette.accents || []),
    resolveThemeColor(themeDefinition, themeDefinition.tokens?.brand?.primary),
    resolveThemeColor(themeDefinition, themeDefinition.tokens?.brand?.secondary),
    resolveThemeColor(themeDefinition, themeDefinition.tokens?.brand?.tertiary)
  ]);
  const cubeTextColors = [
    resolveThemeColor(themeDefinition, themeDefinition.visuals?.mdv?.sections?.RowHeader?.textColor)
      || resolveThemeColor(themeDefinition, themeDefinition.visuals?.mdv?.sections?.ColumnHeader?.textColor),
    resolveThemeColor(themeDefinition, themeDefinition.visuals?.mdv?.sections?.DataCell?.textColor)
  ].map((color) => normalizeHexColor(color)).filter(Boolean);

  renderSwatches(themePreviewBackgroundsEl, backgrounds, { editable: true, group: "backgrounds" });
  renderSwatches(themePreviewCubeTextEl, cubeTextColors, { editable: true, group: "cubeText" });
  renderSwatches(themePreviewAccentsEl, accents, { editable: true, group: "accents" });

  const fonts = themeDefinition.tokens?.typography?.fonts || {};
  const fontList = [fonts.heading, fonts.body, fonts.grid].filter(Boolean);
  themePreviewNameEl.textContent = selectedTheme.name || themeDefinition.name || "Theme";
  themePreviewFontsEl.textContent = fontList.length ? `Fonts: ${fontList.join(" / ")}` : "Fonts: inherited";
  const logoUrl = normalizePreviewLogoUrl(
    selectedTheme.themeSource?.branding?.logo?.url || themeDefinition?.branding?.logo?.url || ""
  );
  updateThemePreviewLogo(logoUrl);
  deleteThemeButtonEl.disabled = !selectedTheme.generated;
  deleteThemeButtonScrapeEl.disabled = !selectedTheme.generated;
  setSaveDraftButtonsVisible(Boolean(selectedTheme.isDraft || selectedTheme.generated));
}

function buildThemeFromWebExtraction(extracted, baseTheme) {
  const theme = structuredClone(baseTheme);
  const title = sanitizeName(extracted.pageTitle || "Extracted Theme");
  const backgrounds = extracted.colors?.backgrounds || [];
  const textColors = extracted.colors?.text || [];
  const accents = extracted.colors?.accents || [];
  const borders = extracted.colors?.borders || [];
  const compiledBase = compileThemeDefinition(theme);
  const baseFonts = compiledBase.tokens?.typography?.fonts || {};
  const bodyFont = extracted.fonts?.body || baseFonts.body;
  const headingFont = extracted.fonts?.heading || extracted.fonts?.body || baseFonts.heading;
  const uiFont = extracted.fonts?.ui || extracted.fonts?.body || baseFonts.ui;
  const buttonFont = extracted.fonts?.button || uiFont;

  const backgroundPair = ensureBackgroundPair(backgrounds, [
    compiledBase.tokens?.canvas?.tabBackground,
    compiledBase.tokens?.palette?.color1,
    compiledBase.tokens?.canvas?.dashboardBackground,
    compiledBase.tokens?.palette?.grayShade1
  ]);
  const [tabBackground, surface] = backgroundPair;
  const dashboardBackground = tabBackground;
  const border = borders[0] || mix(surface, "#000000", 0.12);
  const textBackgrounds = [surface, tabBackground];
  const text = ensureTextContrast(textColors[0] || "#161616", textBackgrounds, 4.5);
  const muted = ensureTextContrast(textColors[1] || mix(text, "#FFFFFF", 0.35), textBackgrounds, 3.4);
  const headerText = ensureTextContrast(mix(text, "#FFFFFF", 0.2), textBackgrounds, 4);
  const accentPalette = ensureAccentPalette(accents, [
    compiledBase.tokens?.brand?.primary,
    compiledBase.tokens?.brand?.secondary,
    compiledBase.tokens?.brand?.tertiary,
    ...(compiledBase.tokens?.charts?.series || [])
  ], [surface]);
  const primary = accentPalette[0] || compiledBase.tokens?.brand?.primary;
  const secondary = accentPalette[1] || compiledBase.tokens?.brand?.secondary || primary;
  const tertiary = accentPalette[2] || compiledBase.tokens?.brand?.tertiary || secondary;
  const chartSeries = accentPalette.slice(0, 8);

  theme.authoringPalette = {
    backgrounds: {
      primary: tabBackground,
      secondary: surface
    },
    accents: chartSeries
  };

  theme.name = `${title} Theme`;
  theme.generatedFrom = {
    title: extracted.pageTitle || "",
    url: extracted.url || "",
    generatedAt: new Date().toISOString()
  };
  const baseLogo = theme.branding?.logo || {};
  if (extracted.logoUrl) {
    theme.branding = {
      ...(theme.branding || {}),
      logo: {
        url: extracted.logoUrl,
        width: baseLogo.width ?? 220,
        height: baseLogo.height ?? 50,
        top: baseLogo.top ?? 0,
        left: baseLogo.left ?? 0,
        objectFit: baseLogo.objectFit || "contain"
      }
    };
  }

  if (isObject(extracted.chartPaletteByWidgetId)) {
    theme.chartPaletteByWidgetId = structuredClone(extracted.chartPaletteByWidgetId);
  }

  theme.semantic = theme.semantic || {};
  theme.semantic.backgrounds = {
    ...(theme.semantic.backgrounds || {}),
    dashboard: dashboardBackground,
    tab: tabBackground,
    surface,
    surfaceAlt: surface,
    rowHeader: primary,
    columnHeader: primary,
    data: surface,
    spacer: surface,
    grid: "transparent",
    syncTile: "transparent",
    shape: surface
  };
  theme.semantic.neutrals = {
    ...(theme.semantic.neutrals || {}),
    border,
    text,
    mutedText: muted,
    headerText,
    appBar: text,
    ghostBorder: muted
  };
  theme.semantic.accents = {
    ...(theme.semantic.accents || {}),
    primary,
    secondary,
    tertiary,
    interactive: primary,
    highlight: mix(tabBackground, "#000000", 0.18),
    selection: mix(primary, "#FFFFFF", 0.82),
    negative: theme.semantic.accents?.negative || compiledBase.tokens?.charts?.negative || "#FF1519",
    chartSeries: chartSeries.length ? chartSeries : compiledBase.tokens?.charts?.series
  };
  theme.semantic.typography = theme.semantic.typography || {};
  theme.semantic.typography.fonts = {
    ...(theme.semantic.typography.fonts || {}),
    body: bodyFont,
    ui: uiFont,
    heading: headingFont,
    grid: bodyFont,
    rowHeader: compiledBase.semantic?.typography?.fonts?.rowHeader || compiledBase.tokens?.typography?.fonts?.grid || bodyFont
  };
  theme.semantic.typography.scale = {
    ...(theme.semantic.typography.scale || {}),
    widgetHeading: {
      ...(theme.semantic.typography.scale?.widgetHeading || {}),
      color: text
    },
    body: {
      ...(theme.semantic.typography.scale?.body || {}),
      color: text
    },
    caption: {
      ...(theme.semantic.typography.scale?.caption || {}),
      color: muted
    },
    button: {
      ...(theme.semantic.typography.scale?.button || {}),
      font: buttonFont
    },
    selector: {
      ...(theme.semantic.typography.scale?.selector || {}),
      font: uiFont,
      color: text
    },
    gridCell: {
      ...(theme.semantic.typography.scale?.gridCell || {}),
      font: bodyFont,
      color: text
    },
    kpiValue: {
      ...(theme.semantic.typography.scale?.kpiValue || {}),
      font: bodyFont,
      color: text
    }
  };

  return theme;
}

function buildThemeFromPawSpec(spec, context = {}, extractedTheme = null) {
  const extracted = extractedTheme || extractThemeFromPawSpec(spec, context);
  const title = sanitizeName(context.pageTitle || spec?.name || extracted.pageTitle || "PAW Workbook");
  const baseThemeName = typeof spec?.theme === "string" ? spec.theme : "carbonGrey10";
  const backgrounds = extracted.colors?.backgrounds || [];
  const textColors = extracted.colors?.text || [];
  const accents = extracted.colors?.accents || [];
  const borders = extracted.colors?.borders || [];
  const bodyFont = extracted.fonts?.body || "Poppins-Regular";
  const headingFont = extracted.fonts?.heading || bodyFont;
  const uiFont = extracted.fonts?.ui || bodyFont;
  const buttonFont = extracted.fonts?.button || uiFont;

  function normalizeSpecColorLocal(value) {
    return normalizePawSpecColorValue(value, baseThemeName);
  }

  function normalizeSpecFontLocal(value) {
    if (!value || typeof value !== "string") {
      return null;
    }
    return value
      .split(",")
      .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
      .find(Boolean) || null;
  }

  function propertyArrayToMap(properties) {
    if (!Array.isArray(properties)) {
      return {};
    }
    return properties.reduce((accumulator, entry) => {
      if (entry && typeof entry.id === "string") {
        accumulator[entry.id] = structuredClone(entry.value);
      }
      return accumulator;
    }, {});
  }

  function getBackgroundPreferenceScore(color) {
    if (!color || color === "transparent" || !color.startsWith("#")) {
      return -Infinity;
    }
    const { r, g, b } = hexToRgb(color);
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    return (getRelativeLuminance(color) * 1000) - chroma;
  }

  function getPreferredLightCustomColor() {
    const customColors = Array.isArray(spec?.properties?.customColors?.colors)
      ? spec.properties.customColors.colors
        .map((color) => normalizeSpecColorLocal(color))
        .filter((color) => color && color !== "transparent" && color.startsWith("#"))
      : [];

    return uniqueColors(customColors)
      .sort((left, right) => getBackgroundPreferenceScore(right) - getBackgroundPreferenceScore(left))[0] || null;
  }

  function captureCardTheme(feature) {
    if (!feature) {
      return null;
    }
    const next = {};
    const fillColor = normalizeSpecColorLocal(feature.fillColor);
    const borderColor = normalizeSpecColorLocal(feature.borderColor);
    if (fillColor) {
      next.background = fillColor;
    }
    if (borderColor) {
      next.borderColor = borderColor;
    }
    if (feature.borderRadius !== undefined) {
      next.borderRadius = feature.borderRadius;
    }
    if (feature.borderWidth !== undefined) {
      next.borderWidth = feature.borderWidth;
    }
    if (feature.boxShadow !== undefined) {
      next.boxShadow = feature.boxShadow;
    }
    return Object.keys(next).length ? next : null;
  }

  function captureShapeTheme(feature) {
    if (!feature) {
      return null;
    }
    const next = {};
    const fillColor = normalizeSpecColorLocal(feature.fillColor);
    const borderColor = normalizeSpecColorLocal(feature.borderColor);
    if (fillColor) {
      next.fillColor = fillColor;
    }
    if (borderColor) {
      next.borderColor = borderColor;
    }
    if (feature.borderRadius !== undefined) {
      next.borderRadius = feature.borderRadius;
    }
    return Object.keys(next).length ? next : null;
  }

  function captureTextVisual(feature) {
    if (!feature) {
      return null;
    }
    const next = {};
    const fillColor = normalizeSpecColorLocal(feature.fillColor);
    const borderColor = normalizeSpecColorLocal(feature.borderColor);
    if (fillColor) {
      next.fillColor = fillColor;
    }
    if (borderColor) {
      next.borderColor = borderColor;
    }
    if (feature.borderRadius !== undefined) {
      next.borderRadius = feature.borderRadius;
    }
    return Object.keys(next).length ? next : null;
  }

  function captureLiveVisualTheme(wrapper, feature) {
    if (!feature?.visId) {
      return null;
    }
    const next = {};
    const fillColor = normalizeSpecColorLocal(feature.fillColor);
    const borderColor = normalizeSpecColorLocal(feature.borderColor);
    const propertyMap = propertyArrayToMap(feature.properties);
    const globalFormat = wrapper?.features?.PAProperties?.globalFormat;

    if (fillColor) {
      next.fillColor = fillColor;
    }
    if (borderColor) {
      next.borderColor = borderColor;
    }
    if (feature.borderRadius !== undefined) {
      next.borderRadius = feature.borderRadius;
    }
    if (feature.showTitle !== undefined) {
      next.showTitle = feature.visId === "pasinglecell"
        ? false
        : Boolean(feature.showTitle);
    }
    if (isObject(feature.titleHtml)) {
      next.titleHtml = structuredClone(feature.titleHtml);
    }
    if (isObject(feature.responsiveTitle)) {
      next.responsiveTitle = structuredClone(feature.responsiveTitle);
    }
    if (Object.keys(propertyMap).length) {
      next.properties = propertyMap;
    }
    if (isObject(globalFormat)) {
      next.globalFormat = structuredClone(globalFormat);
    }
    return Object.keys(next).length ? next : null;
  }

  function captureMdvSection(sectionValue) {
    if (!isObject(sectionValue)) {
      return null;
    }
    const next = {};
    Object.entries(sectionValue).forEach(([key, value]) => {
      switch (key) {
        case "fillColor":
        case "highlightFillColor":
        case "highlightBorderColor":
        case "selectionFillColor":
        case "selectionBorderColor": {
          const color = normalizeSpecColorLocal(value);
          if (color) {
            next[key] = color;
          }
          break;
        }
        case "color": {
          const color = normalizeSpecColorLocal(value);
          if (color) {
            next.textColor = color;
          }
          break;
        }
        case "font-family": {
          const fontFamily = normalizeSpecFontLocal(value);
          if (fontFamily) {
            next.fontFamily = fontFamily;
          }
          break;
        }
        case "font-size":
          if (value !== undefined && value !== null && value !== "") {
            next.fontSize = String(value);
          }
          break;
        case "text-format":
          next.textFormat = structuredClone(value);
          break;
        default:
          next[key] = structuredClone(value);
          break;
      }
    });
    return Object.keys(next).length ? next : null;
  }

  function captureMdvTheme(innerFeature) {
    const genericProperties = innerFeature?.data?.mdvGridState?.genericProperties;
    if (!isObject(genericProperties)) {
      return null;
    }

    const sectionKeys = new Set(["RowHeader", "ColumnHeader", "DataCell", "Spacer"]);
    const sections = {};
    const genericPatch = {};

    Object.entries(genericProperties).forEach(([key, entry]) => {
      const value = getPersistedValue(entry);
      if (sectionKeys.has(key)) {
        const section = captureMdvSection(value);
        if (section) {
          sections[key] = section;
        }
        return;
      }
      if (key === "isGridEditable") {
        return;
      }
      genericPatch[key] = structuredClone(value);
    });

    const next = {};
    if (Object.keys(genericPatch).length) {
      next.genericProperties = genericPatch;
    }
    if (Object.keys(sections).length) {
      next.sections = sections;
    }
    return Object.keys(next).length ? next : null;
  }

  function getMdvThemeScore(themeValue) {
    if (!isObject(themeValue)) {
      return 0;
    }

    let score = 0;
    Object.values(themeValue.sections || {}).forEach((section) => {
      if (isObject(section)) {
        score += Object.keys(section).length;
      }
    });
    if (isObject(themeValue.genericProperties)) {
      score += Object.keys(themeValue.genericProperties).length;
    }
    return score;
  }

  function getFirstPageBackground(specValue) {
    for (const tab of specValue?.layout?.items || []) {
      const tabBackground = normalizeSpecColorLocal(tab?.style?.background) || normalizeSpecColorLocal(tab?.fillColor);
      if (tabBackground && tabBackground !== "transparent") {
        return tabBackground;
      }
      for (const page of tab.items || []) {
        const background = normalizeSpecColorLocal(page?.style?.background) || normalizeSpecColorLocal(page?.fillColor);
        if (background && background !== "transparent") {
          return background;
        }
      }
    }
    return null;
  }

  const liveByVisId = {};
  let cubeviewerCard = null;
  let chartCard = null;
  let singleCellCard = null;
  let textVisual = null;
  let actionButtonVisual = null;
  let imageVisual = null;
  let shapeTheme = null;
  let mdvTheme = null;
  let singleCellTheme = null;
  let syncTileTheme = null;
  let gridWidgetTheme = null;

  for (const tab of spec?.layout?.items || []) {
    for (const page of tab.items || []) {
      for (const wrapper of page.items || []) {
        const outerFeature = wrapper?.features?.Models_internal || {};
        const innerFeature = wrapper?.items?.[0]?.features?.Models_internal || {};

        if (outerFeature.type === "live" && outerFeature.visId && !liveByVisId[outerFeature.visId]) {
          const visualTheme = captureLiveVisualTheme(wrapper, outerFeature);
          if (visualTheme) {
            liveByVisId[outerFeature.visId] = visualTheme;
          }
        }

        if (!chartCard && typeof outerFeature.visId === "string" && outerFeature.visId.startsWith("com.ibm.vis.")) {
          chartCard = captureCardTheme(outerFeature);
        }
        if (!cubeviewerCard && outerFeature.visId === "pacubeviewer") {
          cubeviewerCard = captureCardTheme(outerFeature);
        }
        if (!singleCellCard && outerFeature.visId === "pasinglecell") {
          singleCellCard = captureCardTheme(outerFeature);
        }
        if (!textVisual && outerFeature.type === "text") {
          textVisual = captureTextVisual(outerFeature);
        }
        if (!actionButtonVisual && outerFeature.type === "actionButton" && outerFeature.borderRadius !== undefined) {
          actionButtonVisual = { borderRadius: outerFeature.borderRadius };
        }
        if (!imageVisual && outerFeature.type === "image" && outerFeature.ObjectFit) {
          imageVisual = { objectFit: outerFeature.ObjectFit };
        }
        if (!shapeTheme && outerFeature.type === "shape") {
          shapeTheme = captureShapeTheme(outerFeature);
        }

        if (innerFeature.type === "tm1mdv" && outerFeature.visId === "pacubeviewer") {
          const candidateMdvTheme = captureMdvTheme(innerFeature);
          if (getMdvThemeScore(candidateMdvTheme) > getMdvThemeScore(mdvTheme)) {
            mdvTheme = candidateMdvTheme;
            gridWidgetTheme = {
              background: normalizeSpecColorLocal(innerFeature.fillColor) || "transparent",
              borderColor: normalizeSpecColorLocal(innerFeature.borderColor) || "transparent",
              borderRadius: 0
            };
          }
        }
        if (innerFeature.type === "tm1mdv" && outerFeature.visId === "pasinglecell") {
          const candidateSingleCellTheme = captureMdvTheme(innerFeature);
          if (getMdvThemeScore(candidateSingleCellTheme) > getMdvThemeScore(singleCellTheme)) {
            singleCellTheme = candidateSingleCellTheme;
          }
        }
        if (innerFeature.type === "tm1mdvSyncTile" && !syncTileTheme) {
          syncTileTheme = {
            fillColor: normalizeSpecColorLocal(innerFeature.fillColor) || "transparent",
            borderColor: normalizeSpecColorLocal(innerFeature.borderColor) || "transparent",
            borderRadius: innerFeature.borderRadius ?? 0
          };
          // Selector bindings and interaction state do not belong in a theme.
        }
      }
    }
  }

  const rowHeaderFill = mdvTheme?.sections?.RowHeader?.fillColor || accents[0] || "#DDE1E6";
  const columnHeaderFill = mdvTheme?.sections?.ColumnHeader?.fillColor || rowHeaderFill;
  const dataFill = mdvTheme?.sections?.DataCell?.fillColor || backgrounds[1] || backgrounds[0] || "#FFFFFF";
  const spacerFill = mdvTheme?.sections?.Spacer?.fillColor || dataFill;
  const baseThemeDashboardBackground = resolvePawBaseThemeColorToken(baseThemeName, "grayShade1");
  const baseThemeSurface = resolvePawBaseThemeColorToken(baseThemeName, "color1");
  const explicitBoardBackground = normalizeSpecColorLocal(spec?.layout?.style?.background)
    || normalizeSpecColorLocal(spec?.layout?.fillColor)
    || getFirstPageBackground(spec);
  const preferredLightCustomColor = getPreferredLightCustomColor();
  const tabBackground = explicitBoardBackground
    || baseThemeDashboardBackground
    || backgrounds[0]
    || preferredLightCustomColor
    || "#F4F4F4";
  const surface = backgrounds.find((color) => color && getRgbDistance(color, tabBackground) >= 12)
    || dataFill
    || baseThemeSurface
    || preferredLightCustomColor
    || "#FFFFFF";
  const textBackgrounds = [dataFill, surface, tabBackground];
  const singleCellText = ensureTextContrast(
    singleCellTheme?.sections?.DataCell?.textColor || null,
    [surface, tabBackground, baseThemeSurface].filter(Boolean),
    3
  );
  const text = ensureTextContrast(
    mdvTheme?.sections?.DataCell?.textColor || textColors[0] || "#161616",
    textBackgrounds,
    4.5
  );
  const muted = ensureTextContrast(textColors[1] || mix(text, "#FFFFFF", 0.35), textBackgrounds, 3.4);
  const headerText = ensureTextContrast(textColors[2] || mix(text, "#FFFFFF", 0.2), textBackgrounds, 4);
  const border = normalizeSpecColorLocal(borders[0]) || mix(surface, "#000000", 0.12);
  const accentPalette = ensureAccentPalette(accents, [rowHeaderFill, columnHeaderFill, border], [surface]);
  const primary = accentPalette[0] || rowHeaderFill;
  const secondary = accentPalette[1] || columnHeaderFill || primary;
  const tertiary = accentPalette[2] || secondary;

  const theme = {
    name: `${title} Theme`,
    baseTheme: baseThemeName,
    generatedFrom: {
      title: context.pageTitle || spec?.name || "",
      url: context.url || "",
      generatedAt: new Date().toISOString()
    },
    authoringPalette: {
      backgrounds: {
        primary: tabBackground,
        secondary: surface
      },
      accents: accentPalette
    },
    layout: {
      pageSize: structuredClone(spec?.layout?.pageSize || { width: 1750, height: 900 }),
      fitPage: spec?.layout?.fitPage ?? false,
      layoutPositioning: spec?.layout?.layoutPositioning || "absolute"
    },
    properties: structuredClone(spec?.properties || {}),
    semantic: {
      backgrounds: {
        dashboard: explicitBoardBackground || tabBackground,
        tab: tabBackground,
        surface,
        surfaceAlt: surface,
        rowHeader: rowHeaderFill,
        columnHeader: columnHeaderFill,
        data: dataFill,
        spacer: spacerFill,
        grid: gridWidgetTheme?.background || "transparent",
        syncTile: syncTileTheme?.fillColor || "transparent",
        shape: shapeTheme?.fillColor || surface
      },
      neutrals: {
        border,
        text,
        mutedText: muted,
        headerText,
        appBar: text,
        ghostBorder: muted
      },
      accents: {
        primary,
        secondary,
        tertiary,
        interactive: primary,
        highlight: mdvTheme?.sections?.RowHeader?.highlightFillColor || mix(tabBackground, "#000000", 0.18),
        selection: mdvTheme?.sections?.DataCell?.selectionFillColor || mix(primary, "#FFFFFF", 0.82),
        negative: "#FF1519",
        chartSeries: accentPalette
      },
      typography: {
        fonts: {
          body: bodyFont,
          ui: uiFont,
          heading: headingFont,
          grid: normalizeSpecFontLocal(mdvTheme?.sections?.DataCell?.fontFamily) || bodyFont,
          rowHeader: normalizeSpecFontLocal(mdvTheme?.sections?.RowHeader?.fontFamily) || bodyFont
        },
        scale: {
          body: {
            color: text,
            size: "14px",
            weight: "400"
          },
          caption: {
            color: headerText,
            size: "12px",
            weight: "400"
          },
          button: {
            font: buttonFont,
            size: "14px",
            weight: "400"
          },
          selector: {
            color: text,
            font: uiFont,
            size: "16px",
            weight: "400"
          },
          gridCell: {
            color: text,
            font: normalizeSpecFontLocal(mdvTheme?.sections?.DataCell?.fontFamily) || bodyFont,
            size: String(mdvTheme?.sections?.DataCell?.fontSize || "12px"),
            weight: "400"
          },
          kpiValue: {
            color: singleCellText || text,
            font: bodyFont,
            size: "20px",
            weight: "400"
          },
          widgetHeading: {
            color: text,
            size: "14px",
            weight: "700"
          }
        }
      }
    },
    visuals: {},
    tokens: {
      widgets: {}
    }
  };

  if (extracted.logoUrl) {
    theme.branding = {
      logo: {
        url: extracted.logoUrl,
        width: 220,
        height: 50,
        top: 0,
        left: 0,
        objectFit: "contain"
      }
    };
  }

  if (isObject(extracted.chartPaletteByWidgetId)) {
    theme.chartPaletteByWidgetId = structuredClone(extracted.chartPaletteByWidgetId);
  }

  if (Object.keys(liveByVisId).length) {
    theme.visuals.liveByVisId = liveByVisId;
  }
  if (mdvTheme) {
    theme.visuals.mdv = mdvTheme;
  }
  if (singleCellTheme) {
    theme.visuals.singleCell = singleCellTheme;
  }
  if (syncTileTheme) {
    theme.visuals.syncTile = syncTileTheme;
  }
  if (textVisual) {
    theme.visuals.text = textVisual;
  }
  if (actionButtonVisual) {
    theme.visuals.actionButton = actionButtonVisual;
  }
  if (imageVisual) {
    theme.visuals.image = imageVisual;
  }

  if (cubeviewerCard) {
    theme.tokens.widgets.cubeviewerCard = cubeviewerCard;
  }
  if (chartCard) {
    theme.tokens.widgets.chartCard = chartCard;
  }
  if (singleCellCard) {
    theme.tokens.widgets.singleCellCard = singleCellCard;
  }
  if (gridWidgetTheme) {
    theme.tokens.widgets.grid = gridWidgetTheme;
  }
  if (shapeTheme) {
    theme.tokens.widgets.shape = shapeTheme;
  }

  if (!Object.keys(theme.tokens.widgets).length) {
    delete theme.tokens;
  }
  if (!Object.keys(theme.visuals).length) {
    delete theme.visuals;
  }

  return theme;
}

function isSvgLikeUrl(value) {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("data:image/svg+xml") || /\.svg(\?|#|$)/i.test(trimmed);
}

async function rasterizeSvgLogoToPngDataUrl(svgUrl) {
  if (!svgUrl || !isSvgLikeUrl(svgUrl)) {
    return svgUrl || null;
  }

  try {
    let svgMarkup = "";
    if (svgUrl.startsWith("data:image/svg+xml")) {
      const commaIndex = svgUrl.indexOf(",");
      if (commaIndex < 0) {
        return svgUrl;
      }
      const metadata = svgUrl.slice(0, commaIndex).toLowerCase();
      const payload = svgUrl.slice(commaIndex + 1);
      svgMarkup = metadata.includes(";base64")
        ? atob(payload)
        : decodeURIComponent(payload);
    } else {
      const response = await fetch(svgUrl, { credentials: "omit" });
      if (!response.ok) {
        return svgUrl;
      }
      svgMarkup = await response.text();
    }

    if (!svgMarkup || !/<svg[\s>]/i.test(svgMarkup)) {
      return svgUrl;
    }

    const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = await new Promise((resolve, reject) => {
        const probe = new Image();
        probe.onload = () => resolve(probe);
        probe.onerror = () => reject(new Error("Unable to rasterize SVG logo."));
        probe.src = objectUrl;
      });

      const width = Math.max(1, Math.min(1024, Math.round(image.naturalWidth || 320)));
      const height = Math.max(1, Math.min(512, Math.round(image.naturalHeight || 120)));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return svgUrl;
      }
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      return canvas.toDataURL("image/png");
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (_error) {
    return svgUrl;
  }
}

async function normalizeExtractedLogoUrl(logoUrl) {
  if (!logoUrl || typeof logoUrl !== "string") {
    return null;
  }

  const trimmed = logoUrl.trim();
  if (!trimmed) {
    return null;
  }

  let normalizedInput = trimmed;
  if (/^assets\//i.test(normalizedInput)) {
    normalizedInput = chrome.runtime.getURL(normalizedInput);
  } else if (!/^(https?:\/\/|data:image\/|blob:|chrome-extension:\/\/)/i.test(normalizedInput)) {
    return null;
  }

  const rasterized = await rasterizeSvgLogoToPngDataUrl(normalizedInput);
  return normalizePreviewLogoUrl(rasterized || normalizedInput);
}

function createGeneratedThemeRecord(themeDefinition, description) {
  return {
    id: `generated-${Date.now()}`,
    name: themeDefinition.name,
    description,
    themeDefinition,
    generatedAt: new Date().toISOString()
  };
}

async function persistGeneratedThemeResult(themeRecord, generatedThemeStateValue) {
  await saveGeneratedTheme(themeRecord);
  await loadThemeCatalog();
  themeSelectEl.value = themeRecord.id;
  await updateSelectedThemeUi();
  generatedThemeState = generatedThemeStateValue;
}

function extractThemeFromPawSpec(spec, context = {}) {
  const baseThemeName = typeof spec?.theme === "string" ? spec.theme : "carbonGrey10";

  function normalizeSpecColor(value) {
    return normalizePawSpecColorValue(value, baseThemeName);
  }

  function normalizeSpecFont(value) {
    if (!value || typeof value !== "string") {
      return null;
    }
    return value
      .split(",")
      .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
      .find(Boolean) || null;
  }

  function addWeighted(counter, value, weight = 1) {
    const normalized = normalizeSpecColor(value);
    if (!normalized || normalized === "transparent") {
      return;
    }
    counter.set(normalized, (counter.get(normalized) || 0) + weight);
  }

  function addWeightedFont(counter, value, weight = 1) {
    const normalized = normalizeSpecFont(value);
    if (!normalized) {
      return;
    }
    counter.set(normalized, (counter.get(normalized) || 0) + weight);
  }

  function topValues(counter, limit = 6) {
    return [...counter.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, limit)
      .map(([value]) => value);
  }

  function getBackgroundPreferenceScore(color) {
    if (!color || color === "transparent" || !color.startsWith("#")) {
      return -Infinity;
    }
    const { r, g, b } = hexToRgb(color);
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    return (getRelativeLuminance(color) * 1000) - chroma;
  }

  function getBackgroundFallbacks(colors) {
    return uniqueColors(colors)
      .filter((color) => color && color !== "transparent" && color.startsWith("#"))
      .sort((left, right) => getBackgroundPreferenceScore(right) - getBackgroundPreferenceScore(left));
  }

  function getFeaturePropertyValue(feature, propertyId) {
    const properties = feature?.properties;
    if (Array.isArray(properties)) {
      return properties.find((entry) => entry?.id === propertyId)?.value;
    }
    if (isObject(properties)) {
      return properties[propertyId];
    }
    return undefined;
  }

  const backgroundColors = new Map();
  const textColors = new Map();
  const accentColors = new Map();
  const borderColors = new Map();
  const bodyFonts = new Map();
  const headingFonts = new Map();
  const uiFonts = new Map();
  const buttonFonts = new Map();
  const chartPaletteByWidgetId = {};
  let detectedLogoUrl = null;

  addWeighted(backgroundColors, spec?.layout?.style?.background, 10);
  addWeighted(backgroundColors, spec?.layout?.fillColor, 12);
  (spec?.layout?.items || []).forEach((tab) => {
    addWeighted(backgroundColors, tab?.style?.background, 5);
    addWeighted(backgroundColors, tab?.fillColor, 6);
    (tab?.items || []).forEach((page) => {
      addWeighted(backgroundColors, page?.style?.background, 4);
      addWeighted(backgroundColors, page?.fillColor, 5);
    });
  });

  const customColors = uniqueColors(
    (Array.isArray(spec?.properties?.customColors?.colors) ? spec.properties.customColors.colors : [])
      .map((color) => normalizeSpecColor(color))
      .filter(Boolean)
  );
  customColors.forEach((color) => addWeighted(accentColors, color, 9));

  (spec?.layout?.items || []).forEach((tab) => {
    (tab?.items || []).forEach((page) => {
      (page?.items || []).forEach((wrapper) => {
        const outerFeature = wrapper?.features?.Models_internal || {};
        const innerFeature = wrapper?.items?.[0]?.features?.Models_internal || {};

        addWeighted(backgroundColors, outerFeature.fillColor, 2);
        addWeighted(borderColors, outerFeature.borderColor, 2);

        if (outerFeature.type === "actionButton") {
          addWeighted(accentColors, outerFeature.fillColor, 5);
          addWeighted(textColors, getFeaturePropertyValue(outerFeature, "buttonTextColor"), 3);
          addWeightedFont(buttonFonts, getFeaturePropertyValue(outerFeature, "buttonFont"), 3);
        }

        if (outerFeature.visId === "pacubeviewer" || outerFeature.visId === "pasinglecell") {
          addWeighted(accentColors, outerFeature.borderColor, 3);
        }

        if (typeof outerFeature.visId === "string" && outerFeature.visId.startsWith("com.ibm.vis.")) {
          const wrapperId = String(wrapper?.id || "").trim();
          const paletteRef = getFeaturePropertyValue(outerFeature, "colorPalette");
          const defaultPaletteIndex = getFeaturePropertyValue(outerFeature, "defaultPaletteIndex");
          if (wrapperId) {
            const normalizedPaletteRef = typeof paletteRef === "string" && paletteRef.trim()
              ? paletteRef.trim()
              : null;
            chartPaletteByWidgetId[wrapperId] = {
              colorPalette: normalizedPaletteRef,
              defaultPaletteIndex: Number.isFinite(Number(defaultPaletteIndex))
                ? Number(defaultPaletteIndex)
                : null
            };
          }
        }

        if (outerFeature.type === "image" && typeof outerFeature.imageLink === "string") {
          const logoCandidate = outerFeature.imageLink.trim();
          const widgetIdentifier = String(outerFeature.id || wrapper?.id || "");
          if (logoCandidate && /theme-logo-/i.test(widgetIdentifier)) {
            detectedLogoUrl = logoCandidate;
          } else if (!detectedLogoUrl && logoCandidate) {
            detectedLogoUrl = logoCandidate;
          }
        }

        addWeighted(backgroundColors, innerFeature.fillColor, 2);
        addWeighted(borderColors, innerFeature.borderColor, 2);

        const genericProperties = innerFeature?.data?.mdvGridState?.genericProperties || {};
        ["RowHeader", "ColumnHeader", "DataCell", "Spacer"].forEach((sectionName) => {
          const section = getMdvGenericSection(genericProperties, sectionName);
          if (!isObject(section)) {
            return;
          }

          const headerSection = sectionName === "RowHeader" || sectionName === "ColumnHeader";
          const fillWeight = headerSection ? 7 : sectionName === "DataCell" ? 10 : 4;
          addWeighted(headerSection ? accentColors : backgroundColors, section.fillColor, fillWeight);
          addWeighted(borderColors, section.selectionBorderColor, 2);
          addWeighted(borderColors, section.highlightBorderColor, 1);
          addWeighted(textColors, section.color, sectionName === "DataCell" ? 6 : headerSection ? 4 : 3);

          const fontFamily = section["font-family"];
          addWeightedFont(uiFonts, fontFamily, headerSection ? 2 : 1);
          if (sectionName === "DataCell") {
            addWeightedFont(bodyFonts, fontFamily, 4);
          }
        });
      });
    });
  });

  const backgroundCandidates = topValues(backgroundColors, 8);
  const accentCandidates = uniqueColors([...topValues(accentColors, 12), ...customColors]);
  const extractedBackgrounds = ensureBackgroundPair(backgroundCandidates, [
    resolvePawBaseThemeColorToken(baseThemeName, "grayShade1"),
    resolvePawBaseThemeColorToken(baseThemeName, "color1"),
    ...getBackgroundFallbacks(customColors)
  ]);
  const extractedAccents = ensureAccentPalette(
    accentCandidates,
    customColors,
    [extractedBackgrounds[1]]
  ).slice(0, 8);
  const extractedTextColors = topValues(textColors, 4);
  const extractedBorderColors = topValues(borderColors, 4);

  const bodyFont = topValues(bodyFonts, 1)[0] || topValues(uiFonts, 1)[0] || null;
  const headingFont = topValues(headingFonts, 1)[0] || topValues(uiFonts, 1)[0] || bodyFont;
  const uiFont = topValues(uiFonts, 1)[0] || bodyFont;
  const buttonFont = topValues(buttonFonts, 1)[0] || uiFont;

  return {
    ok: true,
    pageTitle: context.pageTitle || spec?.name || "PAW Workbook",
    url: context.url || "",
    logoUrl: detectedLogoUrl,
    chartPaletteByWidgetId: Object.keys(chartPaletteByWidgetId).length
      ? chartPaletteByWidgetId
      : undefined,
    colors: {
      backgrounds: extractedBackgrounds,
      text: extractedTextColors.length ? extractedTextColors : ["#161616"],
      accents: extractedAccents,
      borders: extractedBorderColors
    },
    fonts: {
      body: bodyFont,
      heading: headingFont,
      ui: uiFont,
      button: buttonFont
    }
  };
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function extractThemeFromDocumentInPage() {
  function isObjectLocal(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function parseColor(value, minAlpha = 0.03) {
    if (!value || value === "transparent") {
      return null;
    }

    const trimmed = String(value).trim();
    if (trimmed.startsWith("#")) {
      const hex = trimmed.slice(1);
      const normalized = hex.length === 3
        ? hex.split("").map((char) => char + char).join("")
        : hex;
      return `#${normalized.toUpperCase()}`;
    }

    const match = trimmed.match(/^rgba?\(([^)]+)\)$/i);
    if (!match) {
      return null;
    }

    const parts = match[1].split(",").map((part) => part.trim());
    const alpha = parts.length > 3 ? Number.parseFloat(parts[3]) : 1;
    if (Number.isFinite(alpha) && alpha < minAlpha) {
      return null;
    }

    const rgb = parts.slice(0, 3).map((part) => Number.parseFloat(part));
    if (rgb.some((component) => Number.isNaN(component))) {
      return null;
    }

    return `#${rgb.map((component) => Math.max(0, Math.min(255, Math.round(component))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }

  function hexToRgbLocal(hex) {
    const value = hex.replace("#", "");
    const normalized = value.length === 3
      ? value.split("").map((char) => char + char).join("")
      : value;
    const num = Number.parseInt(normalized, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  function getLuminance(hex) {
    const { r, g, b } = hexToRgbLocal(hex);
    const transform = (value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * transform(r) + 0.7152 * transform(g) + 0.0722 * transform(b);
  }

  function getContrast(colorA, colorB) {
    const luminanceA = getLuminance(colorA);
    const luminanceB = getLuminance(colorB);
    const lighter = Math.max(luminanceA, luminanceB);
    const darker = Math.min(luminanceA, luminanceB);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function getDistance(colorA, colorB) {
    const a = hexToRgbLocal(colorA);
    const b = hexToRgbLocal(colorB);
    return Math.sqrt(((a.r - b.r) ** 2) + ((a.g - b.g) ** 2) + ((a.b - b.b) ** 2));
  }

  function normalizeFontFamily(value) {
    if (!value) {
      return null;
    }

    return String(value)
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .find(Boolean) || null;
  }

  function isVisibleElement(element, style) {
    const rect = element.getBoundingClientRect();
    return !!style &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      rect.width > 0 &&
      rect.height > 0;
  }

  function addWeighted(counter, value, weight = 1) {
    if (!value) {
      return;
    }
    counter.set(value, (counter.get(value) || 0) + weight);
  }

  function topValues(counter, limit = 6) {
    return [...counter.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([value]) => value);
  }

  function findPaintedAncestor(element) {
    let current = element;
    let depth = 0;
    while (current && depth < 8) {
      const style = window.getComputedStyle(current);
      const background = parseColor(style.backgroundColor);
      if (background) {
        return background;
      }
      current = current.parentElement;
      depth += 1;
    }
    return parseColor(window.getComputedStyle(document.body).backgroundColor) ||
      parseColor(window.getComputedStyle(document.documentElement).backgroundColor);
  }

  function pushDistinctColor(target, color, threshold = 25) {
    if (!color) {
      return;
    }
    if (target.some((existing) => getDistance(existing, color) < threshold)) {
      return;
    }
    target.push(color);
  }

  function ensureBackgroundPairLocal(colors, fallbackColors = []) {
    const candidates = [...(colors || []), ...(fallbackColors || [])].filter((color) => typeof color === "string" && color.startsWith("#"));
    const distinct = [];
    candidates.forEach((color) => {
      pushDistinctColor(distinct, color, 12);
    });

    for (let index = 0; index < distinct.length; index += 1) {
      for (let compareIndex = index + 1; compareIndex < distinct.length; compareIndex += 1) {
        const first = distinct[index];
        const second = distinct[compareIndex];
        const luminanceDiff = Math.abs(getLuminance(first) - getLuminance(second));
        const contrast = getContrast(first, second);
        if (luminanceDiff >= 0.03 && luminanceDiff <= 0.45 && contrast >= 1.05 && contrast <= 3.5) {
          return [first, second];
        }
      }
    }

    const base = distinct[0] || "#F7F7F7";
    const derived = distinct[1] || (getLuminance(base) > 0.75 ? "#F4EEE6" : "#FFFFFF");
    return [base, derived];
  }

  function isTooCloseToAnyLocal(color, blockedColors = [], threshold = 24) {
    if (!color || !Array.isArray(blockedColors) || !blockedColors.length) {
      return false;
    }
    return blockedColors.some((blocked) =>
      typeof blocked === "string" &&
      blocked.startsWith("#") &&
      getDistance(color, blocked) < threshold
    );
  }

  function ensureAccentPaletteLocal(colors, fallbackColors = [], blockedColors = []) {
    const pool = [...(colors || []), ...(fallbackColors || [])].filter((color) => {
      if (typeof color !== "string" || !color.startsWith("#")) {
        return false;
      }
      const luminance = getLuminance(color);
      return luminance > 0.02 && luminance < 0.95 && !isTooCloseToAnyLocal(color, blockedColors, 24);
    });

    const accents = [];
    pool.forEach((color) => {
      pushDistinctColor(accents, color, 25);
    });

    const deriveTone = (color, toward, amount) => {
      const source = hexToRgbLocal(color);
      const target = hexToRgbLocal(toward);
      const mixChannel = (from, to) => Math.round(from + ((to - from) * amount));
      return `#${[
        mixChannel(source.r, target.r).toString(16).padStart(2, "0"),
        mixChannel(source.g, target.g).toString(16).padStart(2, "0"),
        mixChannel(source.b, target.b).toString(16).padStart(2, "0")
      ].join("").toUpperCase()}`;
    };

    let attempts = 0;
    const seed = accents[0] || fallbackColors[0] || "#6929C4";
    while (accents.length < 5 && attempts < 24) {
      const base = accents[attempts % Math.max(accents.length, 1)] || seed;
      const candidate = deriveTone(
        base,
        attempts % 2 === 0 ? "#FFFFFF" : "#000000",
        0.14 + ((attempts % 3) * 0.08)
      );
      if (!isTooCloseToAnyLocal(candidate, blockedColors, 24)) {
        pushDistinctColor(accents, candidate, 18);
      }
      attempts += 1;
    }

    return accents.slice(0, 8);
  }

  function collectCssVariables() {
    const cssVars = [];
    const rootStyle = window.getComputedStyle(document.documentElement);
    for (const name of rootStyle) {
      if (!name.startsWith("--")) {
        continue;
      }
      const value = rootStyle.getPropertyValue(name);
      const color = parseColor(value, 0.5);
      if (color) {
        cssVars.push({ name: name.toLowerCase(), color });
      }
    }
    return cssVars;
  }

  function extractColorsFromCssValue(value) {
    if (!value || typeof value !== "string") {
      return [];
    }

    const candidates = [];
    const hexMatches = value.match(/#[0-9a-f]{3,8}\b/ig) || [];
    hexMatches.forEach((hex) => {
      const color = parseColor(hex);
      if (color) {
        candidates.push(color);
      }
    });

    const rgbMatches = value.match(/rgba?\([^)]+\)/ig) || [];
    rgbMatches.forEach((rgb) => {
      const color = parseColor(rgb);
      if (color) {
        candidates.push(color);
      }
    });

    return [...new Set(candidates)];
  }

  function collectStylesheetAccentEntries(maxRules = 2400) {
    const entries = new Map();
    let inspected = 0;
    const sheets = [...document.styleSheets].slice(0, 24);

    const boostBySelector = (selector) => {
      let weight = 1;
      if (/brand|primary|accent|identity|theme/.test(selector)) {
        weight += 9;
      }
      if (/link|cta|button|btn|nav|menu|header/.test(selector)) {
        weight += 6;
      }
      if (/active|selected|current/.test(selector)) {
        weight += 4;
      }
      if (/:hover|:focus|:active/.test(selector)) {
        weight += 1;
      }
      return weight;
    };

    const props = [
      "color",
      "background",
      "background-color",
      "border-color",
      "border-top-color",
      "fill",
      "stroke"
    ];

    for (const sheet of sheets) {
      let rules;
      try {
        rules = sheet.cssRules || sheet.rules;
      } catch (_error) {
        continue;
      }
      if (!rules) {
        continue;
      }

      for (const rule of rules) {
        if (inspected >= maxRules) {
          break;
        }
        inspected += 1;
        if (!rule?.style) {
          continue;
        }

        const selector = String(rule.selectorText || "").toLowerCase();
        const selectorWeight = boostBySelector(selector);
        props.forEach((prop) => {
          const raw = rule.style.getPropertyValue
            ? rule.style.getPropertyValue(prop)
            : rule.style[prop];
          extractColorsFromCssValue(raw).forEach((color) => {
            const luminance = getLuminance(color);
            if (luminance <= 0.02 || luminance >= 0.95) {
              return;
            }
            const nextWeight = (entries.get(color) || 0) + selectorWeight;
            entries.set(color, nextWeight);
          });
        });
      }

      if (inspected >= maxRules) {
        break;
      }
    }

    return [...entries.entries()].map(([color, weight]) => ({ color, weight }));
  }

  function findVariableColor(cssVars, candidates) {
    for (const candidate of candidates) {
      const match = cssVars.find((entry) => entry.name === candidate);
      if (match?.color) {
        return match.color;
      }
    }
    return null;
  }

  function isValidBackgroundPair(colorA, colorB) {
    if (!colorA || !colorB) {
      return false;
    }
    const luminanceDiff = Math.abs(getLuminance(colorA) - getLuminance(colorB));
    const contrast = getContrast(colorA, colorB);
    return luminanceDiff >= 0.03 && luminanceDiff <= 0.45 && contrast >= 1.05 && contrast <= 3.5;
  }

  function collectStructuralBackgrounds() {
    const selectors = [
      "body",
      "main",
      "article",
      "section",
      "[class*='card']",
      "header",
      "nav"
    ];
    const weights = new Map();
    selectors.forEach((selector, index) => {
      document.querySelectorAll(selector).forEach((element) => {
        const style = window.getComputedStyle(element);
        if (!isVisibleElement(element, style)) {
          return;
        }
        const background = parseColor(style.backgroundColor) || findPaintedAncestor(element);
        if (!background) {
          return;
        }
        const rect = element.getBoundingClientRect();
        const weight = Math.max(1, Math.round((rect.width * rect.height) / 50000)) + (selectors.length - index);
        addWeighted(weights, background, weight);
      });
    });
    return [...weights.entries()]
      .sort((a, b) => b[1] - a[1])
      .reduce((accumulator, [color, weight]) => {
        const existing = accumulator.find((entry) => getDistance(entry.color, color) < 10);
        if (existing) {
          existing.weight += weight;
        } else {
          accumulator.push({ color, weight });
        }
        return accumulator;
      }, []);
  }

  function pickBackgroundPair(cssVars) {
    const primary = findVariableColor(cssVars, ["--bg-primary", "--bg-default", "--surface-default"]);
    const secondaryCandidates = [
      findVariableColor(cssVars, ["--bg-secondary", "--surface-secondary", "--background-secondary"]),
      findVariableColor(cssVars, ["--bg-tertiary", "--bg-subtle", "--surface-muted", "--bg-base"])
    ].filter(Boolean);

    for (const candidate of secondaryCandidates) {
      if (isValidBackgroundPair(primary, candidate)) {
        return [primary, candidate];
      }
    }

    const structural = collectStructuralBackgrounds()
      .filter((entry) => getLuminance(entry.color) > 0.5)
      .map((entry) => entry.color);
    const structuralPair = ensureBackgroundPairLocal(structural, [primary, ...secondaryCandidates].filter(Boolean));
    return structuralPair.slice(0, 2);
  }

  function scoreAccentVariable(name) {
    if (name.includes("--brand-")) {
      return 700;
    }
    if (name.includes("--color-")) {
      return 600;
    }
    if (name.includes("--text-")) {
      return 500;
    }
    if (name.includes("--bg-") || name.includes("--surface-")) {
      return 420;
    }
    if (name.includes("--border-")) {
      return 320;
    }
    if (name.includes("--fg-")) {
      return 260;
    }
    return 120;
  }

  function allowAccentVariable(name) {
    return !name.startsWith("--sl-") &&
      !name.startsWith("--infographic-") &&
      !name.startsWith("--core-infographic-") &&
      !/(shadow|ring|overlay|dimmed|disabled|hover|pressed|focus)/.test(name);
  }

  function clusterAccentEntries(entries) {
    const clusters = [];
    entries.forEach((entry) => {
      const cluster = clusters.find((candidate) => getDistance(candidate.representative, entry.color) < 25);
      if (cluster) {
        cluster.weight += entry.weight;
        if (entry.weight > cluster.representativeWeight) {
          cluster.representative = entry.color;
          cluster.representativeWeight = entry.weight;
        }
      } else {
        clusters.push({
          representative: entry.color,
          representativeWeight: entry.weight,
          weight: entry.weight
        });
      }
    });
    return clusters
      .sort((a, b) => b.weight - a.weight)
      .map((cluster) => cluster.representative);
  }

  function collectFallbackAccents() {
    const weights = new Map();
    const sampleNodes = [...document.querySelectorAll("body *")].slice(0, 450);
    sampleNodes.forEach((element) => {
      const style = window.getComputedStyle(element);
      if (!isVisibleElement(element, style)) {
        return;
      }

      const tag = element.tagName.toLowerCase();
      const className = typeof element.className === "string" ? element.className.toLowerCase() : "";
      const id = typeof element.id === "string" ? element.id.toLowerCase() : "";
      const role = (element.getAttribute("role") || "").toLowerCase();
      const ariaLabel = (element.getAttribute("aria-label") || "").toLowerCase();
      const text = (element.textContent || "").trim().slice(0, 120).toLowerCase();
      const hintsPrimary = /btn|button|cta|primary|accent|hero|promo|banner|nav|menu|link|action|submit/.test(`${className} ${id} ${role} ${ariaLabel}`);
      const isInteractive = tag === "a" || tag === "button" || role === "button";
      if (!isInteractive && !hintsPrimary) {
        return;
      }

      [style.color, style.backgroundColor, style.borderTopColor || style.borderColor].forEach((value) => {
        const color = parseColor(value);
        if (!color) {
          return;
        }
        const luminance = getLuminance(color);
        if (luminance <= 0.02 || luminance >= 0.95) {
          return;
        }
        addWeighted(weights, color, hintsPrimary ? 6 : 4);
      });
    });
    return topValues(weights, 8);
  }

  function getAbsoluteUrl(url) {
    if (!url) {
      return null;
    }
    try {
      return new URL(url, window.location.href).href;
    } catch (_error) {
      return null;
    }
  }

  function getUrlFromBackgroundImage(value) {
    if (!value || value === "none") {
      return null;
    }
    const match = String(value).match(/url\((['"]?)(.*?)\1\)/i);
    if (!match?.[2]) {
      return null;
    }
    return getAbsoluteUrl(match[2]);
  }

  function detectLogoUrl() {
    function toLogoCandidate(url) {
      const resolved = getAbsoluteUrl(url);
      if (!resolved) {
        return null;
      }
      if (resolved.startsWith("data:image/")) {
        return resolved;
      }
      if (resolved.startsWith("data:")) {
        return null;
      }
      return resolved;
    }

    function pushLogoCandidate(target, value) {
      const candidate = toLogoCandidate(value);
      if (candidate && !target.includes(candidate)) {
        target.push(candidate);
      }
    }

    function findLogoFromStructuredData() {
      const scripts = [...document.querySelectorAll("script[type='application/ld+json']")].slice(0, 30);
      const queue = [];
      const candidates = [];

      scripts.forEach((script) => {
        const text = script.textContent || "";
        if (!text.trim()) {
          return;
        }
        try {
          const parsed = JSON.parse(text);
          queue.push(parsed);
        } catch (_error) {
          // Ignore malformed JSON-LD blocks.
        }
      });

      while (queue.length) {
        const node = queue.shift();
        if (!node) {
          continue;
        }

        if (Array.isArray(node)) {
          queue.push(...node);
          continue;
        }

        if (!isObjectLocal(node)) {
          continue;
        }

        const typeValue = node["@type"];
        const typeList = Array.isArray(typeValue) ? typeValue : [typeValue];
        const typeText = typeList.filter(Boolean).map((entry) => String(entry).toLowerCase()).join(" ");
        const isOrgLike = /organization|brand|corporation|localbusiness|website/.test(typeText);
        if (isOrgLike) {
          const logoCandidate = node.logo || node.image;
          if (typeof logoCandidate === "string") {
            pushLogoCandidate(candidates, logoCandidate);
          } else if (isObjectLocal(logoCandidate)) {
            pushLogoCandidate(candidates, logoCandidate.url || logoCandidate.contentUrl || logoCandidate["@id"]);
          }
        }

        Object.values(node).forEach((value) => {
          if (value && (Array.isArray(value) || isObjectLocal(value))) {
            queue.push(value);
          }
        });
      }

      return candidates;
    }

    function findHeadLogoHints() {
      const candidates = [];
      const selectors = [
        "link[rel='image_src']",
        "link[itemprop='logo']",
        "meta[property='og:logo']",
        "meta[name='logo']",
        "meta[itemprop='logo']"
      ];
      selectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((node) => {
          const value = node.getAttribute("href")
            || node.getAttribute("content")
            || node.getAttribute("src");
          pushLogoCandidate(candidates, value);
        });
      });
      return candidates;
    }

    function findHeaderLogoHint() {
      const candidates = [];
      const directLogoImages = document.querySelectorAll(
        "header [id*='logo'] img, header [class*='logo'] img, nav [id*='logo'] img, nav [class*='logo'] img, [role='banner'] [id*='logo'] img, [role='banner'] [class*='logo'] img"
      );
      directLogoImages.forEach((image) => {
        pushLogoCandidate(
          candidates,
          image.currentSrc || image.getAttribute("src") || image.getAttribute("data-src") || image.getAttribute("srcset")
        );
      });

      const inlineLogoSvgs = document.querySelectorAll(
        "header [id*='logo'] svg, header [class*='logo'] svg, nav [id*='logo'] svg, nav [class*='logo'] svg, [role='banner'] [id*='logo'] svg, [role='banner'] [class*='logo'] svg"
      );
      inlineLogoSvgs.forEach((inlineLogoSvg) => {
        const serializer = new XMLSerializer();
        const svgMarkup = serializer.serializeToString(inlineLogoSvg);
        if (svgMarkup && /<svg/i.test(svgMarkup)) {
          pushLogoCandidate(candidates, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`);
        }
      });

      return candidates;
    }

    const preferredCandidates = [
      ...findHeaderLogoHint(),
      ...findHeadLogoHints(),
      ...findLogoFromStructuredData()
    ];
    if (preferredCandidates.length) {
      return preferredCandidates[0];
    }

    const scoreByUrl = new Map();
    const viewportArea = Math.max(window.innerWidth * window.innerHeight, 1);
    const socialPattern = /facebook|instagram|linkedin|twitter|x\.com|youtube|tiktok|pinterest|whatsapp|wechat|snapchat/;
    const noisePattern = /sprite|avatar|icon|badge|thumbnail|flag|language|country|cookie|consent|search|menu|hamburger/;
    const logoPattern = /logo|brand|wordmark|site[- ]?logo/;

    function scoreCandidate(url, descriptor, rect, context = {}) {
      if (!url || url.startsWith("data:")) {
        return;
      }
      const d = String(descriptor || "").toLowerCase();
      const area = rect.width * rect.height;
      const aspectRatio = rect.width / Math.max(rect.height, 1);
      const topBias = rect.top >= -20 && rect.top <= 260;
      const areaRatio = area / viewportArea;
      const homeLink = context.homeLink === true;
      const inHeader = context.inHeader === true;
      const inFooter = context.inFooter === true;

      let score = 0;
      if (logoPattern.test(d) || /logo|wordmark|brand/.test(url.toLowerCase())) {
        score += 180;
      }
      if (homeLink) {
        score += 140;
      }
      if (inHeader) {
        score += 110;
      }
      if (topBias) {
        score += 55;
      }
      if (rect.width >= 70 && rect.width <= 460 && rect.height >= 20 && rect.height <= 140) {
        score += 45;
      }
      if (aspectRatio >= 1.2 && aspectRatio <= 9) {
        score += 35;
      }
      if (url.startsWith(window.location.origin)) {
        score += 25;
      }
      if (/\.svg(\?|#|$)/i.test(url)) {
        score += 22;
      }
      if (areaRatio > 0.22 || rect.width > (window.innerWidth * 0.72) || rect.height > 240) {
        score -= 170;
      }
      if (inFooter) {
        score -= 120;
      }
      if (socialPattern.test(d) || socialPattern.test(url.toLowerCase())) {
        score -= 190;
      }
      if (noisePattern.test(d) || noisePattern.test(url.toLowerCase())) {
        score -= 140;
      }
      if (!d.trim() && !inHeader) {
        score -= 25;
      }

      if (score <= 0) {
        return;
      }
      const current = scoreByUrl.get(url);
      if (!current || score > current) {
        scoreByUrl.set(url, score);
      }
    }

    const images = [...document.querySelectorAll("img[src], img[srcset], img[data-src]")].slice(0, 260);
    images.forEach((image) => {
      const src = image.currentSrc || image.getAttribute("src") || image.getAttribute("data-src") || image.getAttribute("srcset");
      const url = toLogoCandidate(src);
      if (!url) {
        return;
      }

      const style = window.getComputedStyle(image);
      if (!isVisibleElement(image, style)) {
        return;
      }

      const rect = image.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 14) {
        return;
      }

      const alt = (image.getAttribute("alt") || "").toLowerCase();
      const ariaLabel = (image.getAttribute("aria-label") || "").toLowerCase();
      const className = typeof image.className === "string" ? image.className.toLowerCase() : "";
      const id = typeof image.id === "string" ? image.id.toLowerCase() : "";
      const title = (image.getAttribute("title") || "").toLowerCase();
      const descriptor = `${alt} ${ariaLabel} ${className} ${id} ${title}`;
      const headerParent = image.closest("header, nav, [role='banner'], [class*='header'], [class*='nav']");
      const footerParent = image.closest("footer, [role='contentinfo'], [class*='footer']");
      const parentLink = image.closest("a[href]");
      const href = parentLink?.getAttribute("href") || "";
      const homeLink = /^\/($|\?)/.test(href) ||
        href === window.location.origin ||
        href === `${window.location.origin}/` ||
        href === "#";

      scoreCandidate(url, descriptor, rect, {
        inHeader: Boolean(headerParent),
        inFooter: Boolean(footerParent),
        homeLink
      });
    });

    const backgroundNodes = [...document.querySelectorAll("header, nav, [role='banner'], [class*='logo'], [class*='brand']")].slice(0, 140);
    backgroundNodes.forEach((node) => {
      const style = window.getComputedStyle(node);
      if (!isVisibleElement(node, style)) {
        return;
      }
      const url = toLogoCandidate(getUrlFromBackgroundImage(style.backgroundImage));
      if (!url) {
        return;
      }

      const rect = node.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 14) {
        return;
      }

      const className = typeof node.className === "string" ? node.className.toLowerCase() : "";
      const id = typeof node.id === "string" ? node.id.toLowerCase() : "";
      const ariaLabel = (node.getAttribute("aria-label") || "").toLowerCase();
      const title = (node.getAttribute("title") || "").toLowerCase();
      const descriptor = `${className} ${id} ${ariaLabel} ${title}`;
      const footerParent = node.closest("footer, [role='contentinfo'], [class*='footer']");
      const parentLink = node.closest("a[href]");
      const href = parentLink?.getAttribute("href") || "";
      const homeLink = /^\/($|\?)/.test(href) ||
        href === window.location.origin ||
        href === `${window.location.origin}/` ||
        href === "#";

      scoreCandidate(url, descriptor, rect, {
        inHeader: true,
        inFooter: Boolean(footerParent),
        homeLink
      });
    });

    const bestImage = [...scoreByUrl.entries()]
      .sort((left, right) => right[1] - left[1])[0];
    if (bestImage?.[0]) {
      return bestImage[0];
    }

    const headerImage = document.querySelector("header img[src], nav img[src], [role='banner'] img[src]");
    if (headerImage) {
      const fallbackUrl = toLogoCandidate(headerImage.currentSrc || headerImage.getAttribute("src") || headerImage.getAttribute("data-src"));
      if (fallbackUrl) {
        return fallbackUrl;
      }
    }

    const iconHref = document.querySelector("link[rel='apple-touch-icon'], link[rel='icon'], link[rel='shortcut icon']")?.getAttribute("href");
    return toLogoCandidate(iconHref);
  }

  const bodyStyle = window.getComputedStyle(document.body);
  const bodyFonts = new Map();
  const headingFonts = new Map();
  const uiFonts = new Map();
  const buttonFonts = new Map();
  const textColors = new Map();
  const borderColors = new Map();

  addWeighted(bodyFonts, normalizeFontFamily(bodyStyle.fontFamily), 3);
  addWeighted(textColors, parseColor(bodyStyle.color), 3);
  addWeighted(borderColors, parseColor(bodyStyle.borderTopColor || bodyStyle.borderColor), 1);

  const cssVars = collectCssVariables();
  const backgroundPair = pickBackgroundPair(cssVars);

  const accentWeights = new Map();
  cssVars.forEach(({ name, color }) => {
    if (!allowAccentVariable(name)) {
      return;
    }
    const luminance = getLuminance(color);
    if (luminance <= 0.02 || luminance >= 0.95) {
      return;
    }
    addWeighted(accentWeights, color, scoreAccentVariable(name));
  });
  collectStylesheetAccentEntries().forEach(({ color, weight }) => {
    addWeighted(accentWeights, color, weight);
  });

  const sampleNodes = [...document.querySelectorAll("body *")].slice(0, 450);
  sampleNodes.forEach((element) => {
    const style = window.getComputedStyle(element);
    if (!isVisibleElement(element, style)) {
      return;
    }

    addWeighted(textColors, parseColor(style.color), 1);
    addWeighted(borderColors, parseColor(style.borderTopColor || style.borderColor), 1);
    addWeighted(uiFonts, normalizeFontFamily(style.fontFamily), 1);

    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag) || element.getAttribute("role") === "heading") {
      addWeighted(headingFonts, normalizeFontFamily(style.fontFamily), 2);
    }
    if (tag === "button" || tag === "a" || (element.getAttribute("role") || "").toLowerCase() === "button") {
      addWeighted(buttonFonts, normalizeFontFamily(style.fontFamily), 2);
    }
  });

  const clusteredAccents = clusterAccentEntries(
    [...accentWeights.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([color, weight]) => ({ color, weight }))
  );
  const accentPalette = ensureAccentPaletteLocal(clusteredAccents, collectFallbackAccents(), [backgroundPair[1]]);

  return {
    ok: true,
    pageTitle: document.title || "",
    url: window.location.href,
    logoUrl: (() => {
      try {
        return detectLogoUrl();
      } catch (_error) {
        return null;
      }
    })(),
    colors: {
      backgrounds: backgroundPair,
      text: topValues(textColors, 4),
      accents: accentPalette,
      borders: topValues(borderColors, 4)
    },
    fonts: {
      body: topValues(bodyFonts, 1)[0] || null,
      heading: topValues(headingFonts, 1)[0] || null,
      ui: topValues(uiFonts, 1)[0] || null,
      button: topValues(buttonFonts, 1)[0] || null
    }
  };
}

async function checkPawAvailability() {
  try {
    await ensureBridgeInActiveTab();
    const response = ensureSuccess(await sendToActiveTab({ action: "ping" }));
    if (response?.available) {
      pawAvailable = true;
      themeButtonEl.disabled = false;
      extractPawButtonEl.disabled = false;
      boardSpecButtonEl.disabled = false;
      boardSpecButtonEl.hidden = false;
      themeCardEl.hidden = false;
      themeApplyControlsEl.hidden = false;
      themeFileActionsScrapeEl.hidden = true;
      extractCardEl.hidden = true;
      return true;
    }

    pawAvailable = false;
    themeButtonEl.disabled = true;
    extractPawButtonEl.disabled = true;
    boardSpecButtonEl.disabled = true;
    boardSpecButtonEl.hidden = true;
    themeCardEl.hidden = false;
    themeApplyControlsEl.hidden = true;
    themeFileActionsScrapeEl.hidden = false;
    extractCardEl.hidden = false;
    return false;
  } catch (error) {
    pawAvailable = false;
    themeButtonEl.disabled = true;
    extractPawButtonEl.disabled = true;
    boardSpecButtonEl.disabled = true;
    boardSpecButtonEl.hidden = true;
    themeCardEl.hidden = false;
    themeApplyControlsEl.hidden = true;
    themeFileActionsScrapeEl.hidden = false;
    extractCardEl.hidden = false;
    return false;
  }
}

async function refreshConnectionStatus() {
  refreshConnectionButtonEl.disabled = true;
  try {
    const available = await checkPawAvailability();
    setOutput(
      available
        ? "PAW located on the active tab."
        : "PAW was not found on the active tab.",
      available ? "success" : "info"
    );
  } catch (error) {
    setOutput(`Locate PAW failed: ${error.message}`, "error");
  } finally {
    refreshConnectionButtonEl.disabled = false;
  }
}

async function loadThemeCatalog() {
  const response = await fetch("themes/index.json");
  const bundledThemes = await response.json();
  const generatedThemes = await getGeneratedThemes();
  const previousSelection = themeSelectEl.value;

  themeCatalog = [
    ...generatedThemes.map((theme) => ({
      id: theme.id,
      name: theme.name,
      description: theme.description || "Generated from a webpage and saved in extension storage.",
      generated: true,
      themeDefinition: theme.themeDefinition,
      themeSource: theme.themeDefinition
    })),
    ...bundledThemes
  ];

  themeSelectEl.innerHTML = "";
  themeCatalog.forEach((theme, index) => {
    const option = document.createElement("option");
    option.value = theme.id;
    option.textContent = theme.generated ? `${theme.name} (Saved)` : theme.name;
    option.selected = index === 0;
    themeSelectEl.appendChild(option);
  });

  if (previousSelection && themeCatalog.some((theme) => theme.id === previousSelection)) {
    themeSelectEl.value = previousSelection;
  } else if (themeCatalog[0]) {
    themeSelectEl.value = themeCatalog[0].id;
  }

  await updateSelectedThemeUi();
}

async function loadSelectedThemeDefinition() {
  const selected = themeCatalog.find((theme) => theme.id === themeSelectEl.value);
  if (!selected) {
    throw new Error("Choose a theme first.");
  }

  const draft = getDraftStateForThemeId(selected.id);
  const themeSource = draft?.originalThemeSource
    ? resolveBundledThemeAssets(buildDraftThemeSource(draft))
    : await loadThemeSourceForCatalogEntry(selected);
  return {
    themeCatalogEntry: selected,
    themeSource,
    themeDefinition: compileThemeDefinition(themeSource),
    isDraft: Boolean(draft?.dirty)
  };
}

async function loadExtractionBlueprintThemeSource() {
  const response = await fetch(EXTRACTION_BLUEPRINT_FILE);
  if (!response.ok) {
    throw new Error(`Unable to load extraction blueprint (${response.status}).`);
  }
  const themeSource = resolveBundledThemeAssets(await response.json());
  return themeSource;
}

async function readUploadedThemeFile() {
  const [file] = uploadThemeFileEl.files || [];
  if (!file) {
    throw new Error("Choose a theme JSON file first.");
  }

  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`The selected theme file is not valid JSON: ${error.message}`);
  }

  return {
    file,
    themeSource: parsed
  };
}

async function updateSelectedThemeUi() {
  const selected = themeCatalog.find((theme) => theme.id === themeSelectEl.value);
  themeDescriptionEl.textContent = selected?.description || "";
  downloadButtonEl.disabled = !selected;
  downloadButtonScrapeEl.disabled = !selected;
  deleteThemeButtonScrapeEl.disabled = !selected || !selected.generated;

  if (!selected) {
    renderThemePreview(null, null);
    return;
  }

  try {
    const { themeSource, themeDefinition, isDraft } = await loadSelectedThemeDefinition();
    renderThemePreview(themeDefinition, { ...selected, themeSource, isDraft });
  } catch (error) {
    renderThemePreview(null, null);
    themeDescriptionEl.textContent = `Preview unavailable: ${error.message}`;
  }
}

async function ensurePawReady(failureMessage) {
  const available = await checkPawAvailability();
  if (!available) {
    setOutput(failureMessage, "error");
    return false;
  }
  return true;
}

async function applyTheme() {
  if (!await ensurePawReady("Theme application failed: open a PAW board before applying a workspace theme.")) {
    return;
  }

  themeButtonEl.disabled = true;
  try {
    setOutput("Loading selected theme...");
    const { themeCatalogEntry, themeDefinition } = await loadSelectedThemeDefinition();
    const applyOptions = getApplyOptions();
    const response = ensureSuccess(await sendToActiveTab({
      action: "applyTheme",
      themeDefinition,
      themeId: themeCatalogEntry.id,
      applyOptions
    }));
    const paletteActionLabel = response.reusedPalette ? "Reused" : "Created";
    const paletteWarningNote = response.paletteWarning
      ? ` ${response.paletteWarning}`
      : "";
    const paletteNote = applyOptions.chartStyling === false && response.chartCount
      ? " Chart styling and palette assignments preserved."
      : response.appliedChartPaletteHints && response.chartCount
      ? ` Reused ${response.chartPaletteHintCount || response.chartCount} chart palette mapping${(response.chartPaletteHintCount || response.chartCount) === 1 ? "" : "s"} from the extracted PAW workbook.`
      : response.createdPaletteName && response.chartCount
      ? ` ${paletteActionLabel} palette "${response.createdPaletteName}" for ${response.chartCount} chart${response.chartCount === 1 ? "" : "s"}.${paletteWarningNote}`
      : response.paletteWarning && response.chartCount
        ? ` Updated ${response.chartCount} chart${response.chartCount === 1 ? "" : "s"} without creating a custom palette. ${response.paletteWarning}`
        : response.chartCount
          ? ` Updated ${response.chartCount} chart${response.chartCount === 1 ? "" : "s"}.`
          : " No chart visualizations were found on this board.";
    const conditionalFormatNote = response.conditionalFormattingCount
      ? ` Added ${response.conditionalFormattingCount} conditional format definition${response.conditionalFormattingCount === 1 ? "" : "s"} (${response.conditionalFormattingReferences || 0} references).`
      : "";
    const removedConditionalFormatNote = response.removedConditionalFormattingCount
      ? ` Removed ${response.removedConditionalFormattingCount} conditional format definition${response.removedConditionalFormattingCount === 1 ? "" : "s"} (${response.removedConditionalFormattingReferences || 0} references).`
      : "";
    const generatedChartTitleNote = response.generatedChartTitleCount
      ? ` Generated ${response.generatedChartTitleCount} chart title${response.generatedChartTitleCount === 1 ? "" : "s"} from axis bindings.`
      : "";
    const equalizedHeightsNote = response.equalizedHeightCount
      ? ` Equalized heights on ${response.equalizedHeightCount} widget${response.equalizedHeightCount === 1 ? "" : "s"}.`
      : "";
    setOutput(`Applied "${response.theme}" to ${response.widgetCount} widgets.${paletteNote}${removedConditionalFormatNote}${conditionalFormatNote}${generatedChartTitleNote}${equalizedHeightsNote}`, "success");
  } catch (error) {
    setOutput(`Theme application failed: ${error.message}`, "error");
  } finally {
    themeButtonEl.disabled = false;
  }
}

async function showBoardSpecDialog() {
  if (!await ensurePawReady("Board spec is only available on a PAW board.")) {
    return;
  }

  boardSpecButtonEl.disabled = true;
  boardSpecContentEl.value = "Loading...";
  boardSpecCopyButtonEl.disabled = true;
  boardSpecApplyButtonEl.disabled = true;
  boardSpecDialogEl.showModal();

  try {
    const response = ensureSuccess(await sendToActiveTab({ action: "getBoardSpec" }));
    boardSpecContentEl.value = JSON.stringify(response.spec, null, 2);
    boardSpecCopyButtonEl.disabled = false;
    boardSpecApplyButtonEl.disabled = false;
  } catch (error) {
    boardSpecContentEl.value = `Unable to load board spec.\n\n${error.message}`;
  } finally {
    boardSpecButtonEl.disabled = false;
  }
}

async function copyBoardSpecToClipboard() {
  const specText = boardSpecContentEl.value || "";
  if (!specText.trim()) {
    setOutput("There is no board spec to copy.", "error");
    return;
  }

  boardSpecCopyButtonEl.disabled = true;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(specText);
    } else {
      boardSpecContentEl.focus();
      boardSpecContentEl.select();
      document.execCommand("copy");
    }
    setOutput("Board spec copied to clipboard.", "success");
  } catch (error) {
    setOutput(`Copy failed: ${error.message}`, "error");
  } finally {
    boardSpecCopyButtonEl.disabled = false;
  }
}

async function applyBoardSpecFromDialog() {
  if (!await ensurePawReady("Board spec apply failed: open a PAW board before updating the full spec.")) {
    return;
  }

  let parsedSpec;
  try {
    parsedSpec = JSON.parse(boardSpecContentEl.value);
  } catch (error) {
    setOutput(`Board spec JSON is invalid: ${error.message}`, "error");
    return;
  }

  boardSpecApplyButtonEl.disabled = true;
  try {
    const response = ensureSuccess(await sendToActiveTab({
      action: "applyBoardSpec",
      workbookSpec: parsedSpec
    }));
    setOutput(`Applied full board spec${response.workbookName ? ` for "${response.workbookName}"` : ""}.`, "success");
  } catch (error) {
    setOutput(`Board spec apply failed: ${error.message}`, "error");
  } finally {
    boardSpecApplyButtonEl.disabled = false;
  }
}

function toggleAdvancedOptions() {
  const willShow = advancedOptionsEl.hidden;
  advancedOptionsEl.hidden = !willShow;
  advancedToggleEl.textContent = willShow ? "Hide advanced options" : "Show advanced options";
  advancedToggleEl.setAttribute("aria-expanded", String(willShow));
}

async function runPawThemeExtractionPipeline() {
  const [tab, boardResponse] = await Promise.all([
    getActiveTab(),
    sendToActiveTab({ action: "getBoardSpec" })
  ]);
  const response = ensureSuccess(boardResponse);
  const workbookSpec = response.spec || {};
  const context = {
    pageTitle: workbookSpec.name || tab.title || "PAW Workbook",
    url: tab.url || ""
  };
  const extraction = extractThemeFromPawSpec(workbookSpec, context);
  const generatedTheme = buildThemeFromPawSpec(workbookSpec, context, extraction);

  if (generatedTheme?.branding?.logo?.url) {
    const normalizedLogoUrl = await normalizeExtractedLogoUrl(generatedTheme.branding.logo.url);
    if (normalizedLogoUrl) {
      generatedTheme.branding.logo.url = normalizedLogoUrl;
    } else {
      delete generatedTheme.branding;
    }
  }

  const workbookName = sanitizeName(workbookSpec.name || extraction.pageTitle || "PAW Workbook");
  const themeRecord = createGeneratedThemeRecord(
    generatedTheme,
    `Generated from PAW workbook ${workbookName}`
  );

  return {
    themeRecord,
    generatedThemeStateValue: {
      sourceMode: "paw",
      filename: `${sanitizeName(generatedTheme.name)}.json`,
      theme: generatedTheme,
      extraction: {
        ...extraction,
        logoUrl: generatedTheme?.branding?.logo?.url || null
      }
    },
    successMessage: `Saved "${generatedTheme.name}" from the current PAW book.`
  };
}

async function runWebThemeExtractionPipeline() {
  const tab = await getActiveTab();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractThemeFromDocumentInPage
  });
  const extractionResult = results?.[0];
  if (!extractionResult || !("result" in extractionResult)) {
    throw new Error("Theme extraction returned no result from the active page.");
  }

  const extraction = ensureSuccess(extractionResult.result);
  extraction.logoUrl = await normalizeExtractedLogoUrl(extraction.logoUrl);

  const blueprintThemeSource = await loadExtractionBlueprintThemeSource();
  const generatedTheme = buildThemeFromWebExtraction(extraction, blueprintThemeSource);
  const themeRecord = createGeneratedThemeRecord(
    generatedTheme,
    `Generated from ${extraction.pageTitle || extraction.url || "webpage"}`
  );

  return {
    themeRecord,
    generatedThemeStateValue: {
      sourceMode: "web",
      filename: `${sanitizeName(generatedTheme.name)}.json`,
      theme: generatedTheme,
      extraction
    },
    successMessage: `Saved "${generatedTheme.name}" to the Theme Library. Open a PAW page to apply it.`
  };
}

async function extractPawThemeDraft() {
  if (!await ensurePawReady("PAW extraction failed: open a PAW board before extracting formatting.")) {
    return;
  }

  extractPawButtonEl.disabled = true;
  try {
    setOutput("Extracting formatting from the current PAW book...");
    const result = await runPawThemeExtractionPipeline();
    await persistGeneratedThemeResult(result.themeRecord, result.generatedThemeStateValue);
    setOutput(result.successMessage, "success");
  } catch (error) {
    setOutput(`PAW extraction failed: ${error.message}`, "error");
  } finally {
    extractPawButtonEl.disabled = false;
  }
}

async function extractWebThemeDraft() {
  extractButtonEl.disabled = true;
  try {
    setOutput("Extracting colors and fonts from the current webpage...");
    const result = await runWebThemeExtractionPipeline();
    await persistGeneratedThemeResult(result.themeRecord, result.generatedThemeStateValue);
    setOutput(result.successMessage, "success");
  } catch (error) {
    setOutput(`Web extraction failed: ${error.message}`, "error");
  } finally {
    extractButtonEl.disabled = false;
  }
}

async function deleteSelectedTheme() {
  const selected = themeCatalog.find((theme) => theme.id === themeSelectEl.value);
  if (!selected?.generated) {
    setOutput("Only saved generated themes can be deleted.", "error");
    return;
  }

  deleteThemeButtonEl.disabled = true;
  deleteThemeButtonScrapeEl.disabled = true;
  try {
    await deleteGeneratedTheme(selected.id);
    if (generatedThemeState?.theme?.name === selected.name) {
      generatedThemeState = null;
    }
    await loadThemeCatalog();
    setOutput(`Deleted saved theme "${selected.name}".`, "success");
  } catch (error) {
    setOutput(`Delete failed: ${error.message}`, "error");
  } finally {
    deleteThemeButtonEl.disabled = false;
    deleteThemeButtonScrapeEl.disabled = false;
    updateSelectedThemeUi().catch(() => {});
  }
}

async function downloadSelectedTheme() {
  try {
    const { themeCatalogEntry, themeSource } = await loadSelectedThemeDefinition();
    const filename = `${sanitizeName(themeSource.name || themeCatalogEntry.name || "Theme")}.json`;
    downloadTextFile(filename, JSON.stringify(themeSource, null, 2));
    setOutput(`Downloaded ${filename}`, "success");
  } catch (error) {
    setOutput(`Download failed: ${error.message}`, "error");
  }
}

async function uploadTheme() {
  uploadButtonEl.disabled = true;
  uploadButtonScrapeEl.disabled = true;
  try {
    const { file, themeSource } = await readUploadedThemeFile();
    const themeName = sanitizeName(themeSource.name || file.name.replace(/\.json$/i, "") || "Uploaded Theme");
    themeSource.name = themeName;

    const themeRecord = {
      id: `uploaded-${Date.now()}`,
      name: themeName,
      description: `Uploaded from ${file.name}`,
      themeDefinition: themeSource,
      generatedAt: new Date().toISOString(),
      generated: true
    };

    await saveGeneratedTheme(themeRecord);
    await loadThemeCatalog();
    themeSelectEl.value = themeRecord.id;
    await updateSelectedThemeUi();
    setOutput(`Uploaded "${themeName}" to the Theme Library.`, "success");
  } catch (error) {
    setOutput(`Upload failed: ${error.message}`, "error");
  } finally {
    uploadButtonEl.disabled = false;
    uploadButtonScrapeEl.disabled = false;
    uploadThemeFileEl.value = "";
  }
}

function openUploadThemePicker() {
  uploadThemeFileEl.click();
}

async function beginThemeSwatchEdit(target) {
  const swatchButton = target?.closest?.("[data-swatch-group][data-swatch-index][data-swatch-color]");
  if (!swatchButton) {
    return;
  }

  const selected = themeCatalog.find((theme) => theme.id === themeSelectEl.value);
  if (!selected) {
    return;
  }

  try {
    ensureThemeDraftState(selected, await loadThemeSourceForCatalogEntry(selected));
    pendingSwatchEdit = {
      themeId: selected.id,
      group: swatchButton.dataset.swatchGroup,
      index: Number.parseInt(swatchButton.dataset.swatchIndex || "0", 10)
    };

    const currentColor = normalizeHexColor(swatchButton.dataset.swatchColor) || "#000000";
    themeColorHexInputEl.setCustomValidity("");
    setThemeColorEditorValue(currentColor);
    themeColorDialogEl.showModal();
    window.setTimeout(() => {
      themeColorHexInputEl.focus();
      themeColorHexInputEl.select();
    }, 0);
  } catch (error) {
    setOutput(`Theme edit failed: ${error.message}`, "error");
  }
}

async function beginThemeLogoEdit() {
  const selected = themeCatalog.find((theme) => theme.id === themeSelectEl.value);
  if (!selected) {
    return;
  }

  try {
    const draft = ensureThemeDraftState(selected, await loadThemeSourceForCatalogEntry(selected));
    pendingLogoEditThemeId = selected.id;
    themeLogoUrlInputEl.value = typeof draft.logoOverride === "string"
      ? draft.logoOverride
      : draft.originalThemeSource?.branding?.logo?.url || "";
    themeLogoDialogEl.showModal();
    window.setTimeout(() => {
      themeLogoUrlInputEl.focus();
      themeLogoUrlInputEl.select();
    }, 0);
  } catch (error) {
    setOutput(`Theme edit failed: ${error.message}`, "error");
  }
}

async function applyThemeSwatchEdit() {
  if (!pendingSwatchEdit) {
    return;
  }

  const draft = getDraftStateForThemeId(pendingSwatchEdit.themeId);
  const nextColor = normalizeHexColor(themeColorHexInputEl.value || themeColorPickerInputEl.value);
  if (!draft?.originalThemeSource) {
    pendingSwatchEdit = null;
    themeColorDialogEl.close();
    return;
  }
  if (!nextColor) {
    themeColorHexInputEl.setCustomValidity("Enter a HEX color such as #123456 or #ABC.");
    themeColorHexInputEl.reportValidity();
    return;
  }
  themeColorHexInputEl.setCustomValidity("");

  draft.paletteOverrides = draft.paletteOverrides || { backgrounds: {}, cubeText: {}, accents: {} };
  draft.paletteOverrides[pendingSwatchEdit.group] = draft.paletteOverrides[pendingSwatchEdit.group] || {};
  draft.paletteOverrides[pendingSwatchEdit.group][pendingSwatchEdit.index] = nextColor;
  draft.dirty = true;
  pendingSwatchEdit = null;
  themeColorDialogEl.close();
  await updateSelectedThemeUi();
}

async function applyThemeLogoEdit() {
  if (!pendingLogoEditThemeId) {
    return;
  }

  const draft = getDraftStateForThemeId(pendingLogoEditThemeId);
  if (!draft?.originalThemeSource) {
    pendingLogoEditThemeId = null;
    return;
  }

  const trimmedValue = (themeLogoUrlInputEl.value || "").trim();
  if (trimmedValue) {
    const normalizedLogoUrl = await normalizeExtractedLogoUrl(trimmedValue);
    if (!normalizedLogoUrl) {
      setOutput("Logo URL is invalid. Paste a direct image URL.", "error");
      return;
    }
    draft.logoOverride = normalizedLogoUrl;
  } else {
    draft.logoOverride = "";
  }

  draft.dirty = true;
  pendingLogoEditThemeId = null;
  themeLogoDialogEl.close();
  await updateSelectedThemeUi();
}

async function saveThemeDraftAsCopy() {
  const selected = themeCatalog.find((theme) => theme.id === themeSelectEl.value);
  const draft = selected ? getDraftStateForThemeId(selected.id) : null;
  if (!selected) {
    setOutput("Choose a theme first.", "info");
    return;
  }

  let savedTheme = null;
  if (draft?.dirty && draft.originalThemeSource) {
    savedTheme = buildDraftThemeSource(draft);
  } else if (selected.generated) {
    const { themeSource } = await loadSelectedThemeDefinition();
    savedTheme = structuredClone(themeSource);
  }

  if (!savedTheme) {
    setOutput("There are no palette edits to save.", "info");
    return;
  }

  savedTheme = sanitizeThemeSource(savedTheme);
  let themeRecord;
  let savedThemeId;
  let successMessage;

  if (selected.generated) {
    const preservedName = sanitizeName(selected.name || savedTheme.name || "Theme");
    savedTheme.name = preservedName;
    themeRecord = {
      id: selected.id,
      name: preservedName,
      description: selected.description || "Saved theme",
      themeDefinition: savedTheme,
      generatedAt: new Date().toISOString(),
      generated: true
    };
    savedThemeId = selected.id;
    successMessage = `Updated "${preservedName}".`;
  } else {
    const baseName = sanitizeName(draft?.sourceThemeName || selected.name || savedTheme.name || "Theme")
      .replace(/^My\s+/i, "");
    const savedThemeName = sanitizeName(`My ${baseName}`);
    savedTheme.name = savedThemeName;
    themeRecord = {
      id: `generated-${Date.now()}`,
      name: savedThemeName,
      description: `Customized from ${selected.name || baseName}`,
      themeDefinition: savedTheme,
      generatedAt: new Date().toISOString()
    };
    savedThemeId = themeRecord.id;
    successMessage = `Saved "${savedThemeName}" to the Theme Library.`;
  }

  await saveGeneratedTheme(themeRecord);
  themeDraftState = null;
  await loadThemeCatalog();
  themeSelectEl.value = savedThemeId;
  await updateSelectedThemeUi();
  setOutput(successMessage, "success");
}

themeSelectEl.addEventListener("change", () => {
  themeDraftState = null;
  pendingSwatchEdit = null;
  updateSelectedThemeUi().catch((error) => {
    setOutput(`Theme preview failed: ${error.message}`, "error");
  });
});
refreshConnectionButtonEl.addEventListener("click", refreshConnectionStatus);
themeButtonEl.addEventListener("click", applyTheme);
boardSpecButtonEl.addEventListener("click", showBoardSpecDialog);
boardSpecCopyButtonEl.addEventListener("click", () => {
  copyBoardSpecToClipboard().catch((error) => {
    setOutput(`Copy failed: ${error.message}`, "error");
  });
});
boardSpecApplyButtonEl.addEventListener("click", () => {
  applyBoardSpecFromDialog().catch((error) => {
    setOutput(`Board spec apply failed: ${error.message}`, "error");
  });
});
advancedToggleEl.addEventListener("click", toggleAdvancedOptions);
extractButtonEl.addEventListener("click", extractWebThemeDraft);
extractPawButtonEl.addEventListener("click", extractPawThemeDraft);
deleteThemeButtonEl.addEventListener("click", deleteSelectedTheme);
deleteThemeButtonScrapeEl.addEventListener("click", deleteSelectedTheme);
downloadButtonEl.addEventListener("click", () => {
  downloadSelectedTheme().catch((error) => {
    setOutput(`Download failed: ${error.message}`, "error");
  });
});
downloadButtonScrapeEl.addEventListener("click", () => {
  downloadSelectedTheme().catch((error) => {
    setOutput(`Download failed: ${error.message}`, "error");
  });
});
uploadButtonEl.addEventListener("click", openUploadThemePicker);
uploadButtonScrapeEl.addEventListener("click", openUploadThemePicker);
saveThemeButtonEl.addEventListener("click", () => {
  saveThemeDraftAsCopy().catch((error) => {
    setOutput(`Save failed: ${error.message}`, "error");
  });
});
saveThemeButtonScrapeEl.addEventListener("click", () => {
  saveThemeDraftAsCopy().catch((error) => {
    setOutput(`Save failed: ${error.message}`, "error");
  });
});
uploadThemeFileEl.addEventListener("change", () => {
  if (!uploadThemeFileEl.files?.length) {
    return;
  }
  uploadTheme().catch((error) => {
    setOutput(`Upload failed: ${error.message}`, "error");
  });
});
themePreviewBackgroundsEl.addEventListener("click", (event) => {
  beginThemeSwatchEdit(event.target).catch((error) => {
    setOutput(`Theme edit failed: ${error.message}`, "error");
  });
});
themePreviewAccentsEl.addEventListener("click", (event) => {
  beginThemeSwatchEdit(event.target).catch((error) => {
    setOutput(`Theme edit failed: ${error.message}`, "error");
  });
});
themePreviewCubeTextEl.addEventListener("click", (event) => {
  beginThemeSwatchEdit(event.target).catch((error) => {
    setOutput(`Theme edit failed: ${error.message}`, "error");
  });
});
themePreviewLogoButtonEl.addEventListener("click", () => {
  beginThemeLogoEdit().catch((error) => {
    setOutput(`Theme edit failed: ${error.message}`, "error");
  });
});
themeColorHexInputEl.addEventListener("input", () => {
  themeColorHexInputEl.setCustomValidity("");
  const normalizedColor = normalizeHexColor(themeColorHexInputEl.value);
  if (!normalizedColor) {
    return;
  }
  themeColorPickerInputEl.value = normalizedColor;
});
themeColorHexInputEl.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  applyThemeSwatchEdit().catch((error) => {
    setOutput(`Theme edit failed: ${error.message}`, "error");
  });
});
themeColorPickerInputEl.addEventListener("input", () => {
  themeColorHexInputEl.setCustomValidity("");
  setThemeColorEditorValue(themeColorPickerInputEl.value);
});
themeColorApplyButtonEl.addEventListener("click", () => {
  applyThemeSwatchEdit().catch((error) => {
    setOutput(`Theme edit failed: ${error.message}`, "error");
  });
});
themeColorCancelButtonEl.addEventListener("click", () => {
  pendingSwatchEdit = null;
  themeColorDialogEl.close();
});
themeColorDialogEl.addEventListener("close", () => {
  if (themeColorDialogEl.returnValue !== "apply") {
    pendingSwatchEdit = null;
  }
});
themeLogoUrlInputEl.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  applyThemeLogoEdit().catch((error) => {
    setOutput(`Theme edit failed: ${error.message}`, "error");
  });
});
themeLogoApplyButtonEl.addEventListener("click", () => {
  applyThemeLogoEdit().catch((error) => {
    setOutput(`Theme edit failed: ${error.message}`, "error");
  });
});
themeLogoCancelButtonEl.addEventListener("click", () => {
  pendingLogoEditThemeId = null;
  themeLogoDialogEl.close();
});
themeLogoDialogEl.addEventListener("close", () => {
  if (themeLogoDialogEl.returnValue !== "apply") {
    pendingLogoEditThemeId = null;
  }
});

themePreviewLogoEl.addEventListener("error", () => {
  themePreviewLogoWrapEl.hidden = true;
  themePreviewLogoEl.removeAttribute("src");
});

syncActionIconTheme().catch(() => {});
if (typeof colorSchemeMedia.addEventListener === "function") {
  colorSchemeMedia.addEventListener("change", () => {
    syncActionIconTheme().catch(() => {});
  });
} else if (typeof colorSchemeMedia.addListener === "function") {
  colorSchemeMedia.addListener(() => {
    syncActionIconTheme().catch(() => {});
  });
}

Promise.all([loadThemeCatalog(), checkPawAvailability()])
  .then(() => {
    setOutput("");
  })
  .catch((error) => {
    setOutput(`Startup failed: ${error.message}`, "error");
  });
