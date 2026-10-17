(function installPawWorkbookPageBridge() {
  const REQUEST_PREFIX = "PAW_WORKBOOK_EXTENSION_REQUEST";
  const RESPONSE_PREFIX = "PAW_WORKBOOK_EXTENSION_RESPONSE";

  if (window.__pawWorkbookExtensionPageBridgeInstalled) {
    return;
  }
  window.__pawWorkbookExtensionPageBridgeInstalled = true;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }

  function deepMerge(target, source) {
    Object.entries(source).forEach(([key, value]) => {
      if (isObject(value)) {
        target[key] = deepMerge(isObject(target[key]) ? target[key] : {}, value);
      } else {
        target[key] = value;
      }
    });
    return target;
  }

  function uniqueColors(values) {
    return [...new Set((values || []).filter((value) => typeof value === "string" && value))];
  }

  function isOptionEnabled(applyOptions, key) {
    return applyOptions?.[key] !== false;
  }

  function getDashboardApi() {
    if (typeof window.__getDashboardAPI !== "function") {
      throw new Error("window.__getDashboardAPI() is not available on this page.");
    }

    const api = window.__getDashboardAPI();
    if (!api) {
      throw new Error("The PAW dashboard API returned an empty object.");
    }

    return api;
  }

  function normalizeWorkbookSpec(input) {
    if (isObject(input?.content)) {
      return clone(input.content);
    }
    if (isObject(input)) {
      return clone(input);
    }
    throw new Error("Workbook JSON must be an object or an asset envelope with a content object.");
  }

  function normalizeColor(value) {
    if (!value || value === "transparent") {
      return null;
    }

    const trimmed = String(value).trim();
    if (trimmed.startsWith("#")) {
      const hex = trimmed.slice(1);
      if (hex.length === 3) {
        return `#${hex.split("").map((char) => char + char).join("").toUpperCase()}`;
      }
      return `#${hex.toUpperCase()}`;
    }

    const match = trimmed.match(/^rgba?\(([^)]+)\)$/i);
    if (!match) {
      return null;
    }

    const parts = match[1].split(",").map((part) => part.trim());
    const alpha = parts.length > 3 ? Number.parseFloat(parts[3]) : 1;
    if (Number.isFinite(alpha) && alpha <= 0.03) {
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

  function rgbToHsl({ r, g, b }) {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    let hue = 0;
    let saturation = 0;
    const lightness = (max + min) / 2;

    if (max !== min) {
      const delta = max - min;
      saturation = lightness > 0.5
        ? delta / (2 - max - min)
        : delta / (max + min);

      switch (max) {
        case red:
          hue = ((green - blue) / delta + (green < blue ? 6 : 0)) / 6;
          break;
        case green:
          hue = ((blue - red) / delta + 2) / 6;
          break;
        default:
          hue = ((red - green) / delta + 4) / 6;
          break;
      }
    }

    return { h: hue, s: saturation, l: lightness };
  }

  function getColorMeta(color) {
    if (!color || color === "transparent") {
      return null;
    }
    const hsl = rgbToHsl(hexToRgbLocal(color));
    return {
      color,
      ...hsl,
      vivid: hsl.s >= 0.18 && hsl.l >= 0.12 && hsl.l <= 0.9,
      neutral: hsl.s < 0.12,
      nearWhite: hsl.l > 0.92,
      nearBlack: hsl.l < 0.12
    };
  }

  function addWeighted(counter, value, weight = 1) {
    if (!value) {
      return;
    }
    counter.set(value, (counter.get(value) || 0) + weight);
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

  function incrementCounter(counter, value) {
    if (!value) {
      return;
    }
    counter.set(value, (counter.get(value) || 0) + 1);
  }

  function topValues(counter, limit = 6) {
    return [...counter.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([value]) => value);
  }

  function topAccentValues(counter, limit = 7) {
    return [...counter.entries()]
      .map(([value, score]) => {
        const meta = getColorMeta(value);
        if (!meta) {
          return null;
        }
        let boostedScore = score;
        if (meta.vivid) {
          boostedScore += 4 + meta.s * 10;
        }
        if (meta.neutral) {
          boostedScore -= 6;
        }
        if (meta.nearWhite || meta.nearBlack) {
          boostedScore -= 8;
        }
        return { value, score: boostedScore, meta };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .reduce((picked, entry) => {
        const isDistinct = !picked.some((existing) => Math.abs(existing.meta.h - entry.meta.h) < 0.025 && Math.abs(existing.meta.l - entry.meta.l) < 0.08);
        if (isDistinct || picked.length < 2) {
          picked.push(entry);
        }
        return picked;
      }, [])
      .slice(0, limit)
      .map((entry) => entry.value);
  }

  function findPaintedAncestor(element) {
    let current = element;
    let depth = 0;
    while (current && depth < 8) {
      if (current.nodeType !== 1) {
        break;
      }
      const style = window.getComputedStyle(current);
      const background = normalizeColor(style.backgroundColor);
      if (background && background !== "transparent") {
        return { element: current, style, background };
      }
      current = current.parentElement;
      depth += 1;
    }

    const bodyBackground = normalizeColor(window.getComputedStyle(document.body).backgroundColor);
    if (bodyBackground) {
      return {
        element: document.body,
        style: window.getComputedStyle(document.body),
        background: bodyBackground
      };
    }

    const htmlBackground = normalizeColor(window.getComputedStyle(document.documentElement).backgroundColor);
    if (htmlBackground) {
      return {
        element: document.documentElement,
        style: window.getComputedStyle(document.documentElement),
        background: htmlBackground
      };
    }

    return null;
  }

  function sampleViewport(backgroundColors, textColors, borderColors, accentColors, uiFonts) {
    const columns = 8;
    const rows = 6;
    const width = Math.max(window.innerWidth, 1);
    const height = Math.max(window.innerHeight, 1);

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = Math.min(width - 1, Math.round(((column + 0.5) / columns) * width));
        const y = Math.min(height - 1, Math.round(((row + 0.5) / rows) * height));
        const element = document.elementFromPoint(x, y);
        if (!element) {
          continue;
        }

        const style = window.getComputedStyle(element);
        const color = normalizeColor(style.color);
        const border = normalizeColor(style.borderTopColor || style.borderColor);
        const fontFamily = normalizeFontFamily(style.fontFamily);
        const painted = findPaintedAncestor(element);
        const background = painted?.background || normalizeColor(style.backgroundColor);
        const backgroundMeta = getColorMeta(background);
        const colorMeta = getColorMeta(color);
        const borderMeta = getColorMeta(border);
        const tag = element.tagName.toLowerCase();
        const role = (element.getAttribute("role") || "").toLowerCase();
        const className = typeof element.className === "string" ? element.className.toLowerCase() : "";
        const id = typeof element.id === "string" ? element.id.toLowerCase() : "";
        const ariaLabel = (element.getAttribute("aria-label") || "").toLowerCase();
        const text = (element.textContent || "").trim().slice(0, 120).toLowerCase();
        const isInteractive = tag === "a" || tag === "button" || role === "button";
        const hintsPrimary = /btn|button|cta|primary|accent|hero|promo|banner|nav|menu|link|action|submit/.test(`${className} ${id} ${role} ${ariaLabel}`);

        addWeighted(backgroundColors, background, 6);
        addWeighted(textColors, color, 3);
        addWeighted(borderColors, border, 2);
        addWeighted(uiFonts, fontFamily, 2);

        if (backgroundMeta?.nearBlack) {
          addWeighted(backgroundColors, background, 8);
        }

        if (isInteractive || hintsPrimary || /contact|demo|start|free|book|talk|buy|learn/.test(text)) {
          if (backgroundMeta?.vivid) {
            addWeighted(accentColors, background, 8);
          }
          if (colorMeta?.vivid) {
            addWeighted(accentColors, color, 6);
          }
          if (borderMeta?.vivid) {
            addWeighted(accentColors, border, 4);
          }
        }
      }
    }
  }

  function extractThemeFromDocument() {
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

    function pushDistinctColor(target, color, threshold = 25) {
      if (!color) {
        return;
      }
      if (target.some((existing) => getDistance(existing, color) < threshold)) {
        return;
      }
      target.push(color);
    }

    function ensurePair(colors, fallback = []) {
      const distinct = [];
      [...colors, ...fallback].forEach((color) => {
        if (typeof color === "string" && color.startsWith("#")) {
          pushDistinctColor(distinct, color, 12);
        }
      });
      for (let index = 0; index < distinct.length; index += 1) {
        for (let compareIndex = index + 1; compareIndex < distinct.length; compareIndex += 1) {
          const first = distinct[index];
          const second = distinct[compareIndex];
          const diff = Math.abs(getLuminance(first) - getLuminance(second));
          if (diff >= 0.03 && diff <= 0.35) {
            return [first, second];
          }
        }
      }
      const base = distinct[0] || "#F7F7F7";
      const derived = distinct[1] || (getLuminance(base) > 0.75 ? "#F4EEE6" : "#FFFFFF");
      return [base, derived];
    }

    function isTooCloseToAny(color, blockedColors = [], threshold = 24) {
      if (!color || !Array.isArray(blockedColors) || !blockedColors.length) {
        return false;
      }
      return blockedColors.some((blocked) =>
        typeof blocked === "string" &&
        blocked.startsWith("#") &&
        getDistance(color, blocked) < threshold
      );
    }

    function ensureAccents(colors, fallback = [], blockedColors = []) {
      function deriveTone(color, toward, amount) {
        const source = hexToRgbLocal(color);
        const target = hexToRgbLocal(toward);
        const mixChannel = (from, to) => Math.round(from + ((to - from) * amount));
        return `#${[
          mixChannel(source.r, target.r).toString(16).padStart(2, "0"),
          mixChannel(source.g, target.g).toString(16).padStart(2, "0"),
          mixChannel(source.b, target.b).toString(16).padStart(2, "0")
        ].join("").toUpperCase()}`;
      }

      const accents = [];
      [...colors, ...fallback].forEach((color) => {
        if (!color || !color.startsWith("#")) {
          return;
        }
        const luminance = getLuminance(color);
        if (luminance <= 0.02 || luminance >= 0.95) {
          return;
        }
        if (isTooCloseToAny(color, blockedColors, 24)) {
          return;
        }
        pushDistinctColor(accents, color, 25);
      });
      let attempts = 0;
      while (accents.length < 5 && attempts < 24) {
        const base = accents[attempts % Math.max(accents.length, 1)] || "#6929C4";
        const candidate = deriveTone(
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

    function findVariableColor(cssVars, candidates) {
      for (const candidate of candidates) {
        const match = cssVars.find((entry) => entry.name === candidate);
        if (match?.color) {
          return match.color;
        }
      }
      return null;
    }

    function allowAccentVariable(name) {
      return !name.startsWith("--sl-") &&
        !name.startsWith("--infographic-") &&
        !name.startsWith("--core-infographic-") &&
        !/(shadow|ring|overlay|dimmed|disabled|hover|pressed|focus)/.test(name);
    }

    function scoreAccentVariable(name) {
      if (name.includes("--brand-")) return 700;
      if (name.includes("--color-")) return 600;
      if (name.includes("--text-")) return 500;
      if (name.includes("--bg-") || name.includes("--surface-")) return 420;
      if (name.includes("--border-")) return 320;
      if (name.includes("--fg-")) return 260;
      return 120;
    }

    const rootStyle = window.getComputedStyle(document.documentElement);
    const cssVars = [];
    for (const name of rootStyle) {
      if (!name.startsWith("--")) {
        continue;
      }
      const color = normalizeColor(rootStyle.getPropertyValue(name));
      if (color) {
        cssVars.push({ name: name.toLowerCase(), color });
      }
    }

    const primaryBg = findVariableColor(cssVars, ["--bg-primary", "--bg-default", "--surface-default"]);
    const secondaryBg = findVariableColor(cssVars, ["--bg-secondary", "--surface-secondary", "--background-secondary"]);
    const tertiaryBg = findVariableColor(cssVars, ["--bg-tertiary", "--bg-subtle", "--surface-muted", "--bg-base"]);
    let backgrounds = [];
    if (primaryBg && secondaryBg) {
      const diff = Math.abs(getLuminance(primaryBg) - getLuminance(secondaryBg));
      const contrast = getContrast(primaryBg, secondaryBg);
      if (diff >= 0.03 && diff <= 0.45 && contrast >= 1.05 && contrast <= 3.5) {
        backgrounds = [primaryBg, secondaryBg];
      }
    }
    if (!backgrounds.length && primaryBg && tertiaryBg) {
      const diff = Math.abs(getLuminance(primaryBg) - getLuminance(tertiaryBg));
      const contrast = getContrast(primaryBg, tertiaryBg);
      if (diff >= 0.03 && diff <= 0.45 && contrast >= 1.05 && contrast <= 3.5) {
        backgrounds = [primaryBg, tertiaryBg];
      }
    }

    const structuralWeights = new Map();
    ["body", "main", "article", "section", "[class*='card']", "header", "nav"].forEach((selector, index) => {
      document.querySelectorAll(selector).forEach((element) => {
        const style = window.getComputedStyle(element);
        if (!isVisibleElement(element, style)) {
          return;
        }
        const background = normalizeColor(style.backgroundColor) || findPaintedAncestor(element)?.background;
        if (!background) {
          return;
        }
        const rect = element.getBoundingClientRect();
        addWeighted(structuralWeights, background, Math.max(1, Math.round((rect.width * rect.height) / 50000)) + (7 - index));
      });
    });

    if (!backgrounds.length) {
      backgrounds = ensurePair(
        [...structuralWeights.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([color]) => color)
          .filter((color) => getLuminance(color) > 0.5),
        [primaryBg, tertiaryBg].filter(Boolean)
      );
    }

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

    const textColors = new Map();
    const borderColors = new Map();
    const bodyFonts = new Map();
    const headingFonts = new Map();
    const uiFonts = new Map();
    const buttonFonts = new Map();
    const sampleNodes = [...document.querySelectorAll("body *")].slice(0, 450);
    addWeighted(bodyFonts, normalizeFontFamily(window.getComputedStyle(document.body).fontFamily), 3);

    sampleNodes.forEach((element) => {
      const style = window.getComputedStyle(element);
      if (!isVisibleElement(element, style)) {
        return;
      }

      addWeighted(textColors, normalizeColor(style.color), 1);
      addWeighted(borderColors, normalizeColor(style.borderTopColor || style.borderColor), 1);
      addWeighted(uiFonts, normalizeFontFamily(style.fontFamily), 1);

      const tag = element.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag) || element.getAttribute("role") === "heading") {
        addWeighted(headingFonts, normalizeFontFamily(style.fontFamily), 2);
      }
      if (tag === "button" || tag === "a" || (element.getAttribute("role") || "").toLowerCase() === "button") {
        addWeighted(buttonFonts, normalizeFontFamily(style.fontFamily), 2);
        [style.color, style.backgroundColor, style.borderTopColor || style.borderColor].forEach((value) => {
          const color = normalizeColor(value);
          if (!color) {
            return;
          }
          const luminance = getLuminance(color);
          if (luminance <= 0.02 || luminance >= 0.95) {
            return;
          }
          addWeighted(accentWeights, color, 6);
        });
      }
    });

    const accentPalette = ensureAccents(
      [...accentWeights.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color),
      topValues(textColors, 2),
      [backgrounds[1]]
    );

    return {
      ok: true,
      pageTitle: document.title || "",
      url: window.location.href,
      colors: {
        backgrounds,
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

  function ensureCustomColors(spec) {
    spec.properties = spec.properties || {};
    spec.properties.customColors = spec.properties.customColors || { colors: [] };
    spec.properties.customColors.colors = spec.properties.customColors.colors || [];
    return spec.properties.customColors.colors;
  }

  function buildThemeColorLookup(themeDefinition) {
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

  function getThemeColorHex(themeDefinition, tokenOrValue) {
    if (!tokenOrValue || typeof tokenOrValue !== "string") {
      return null;
    }
    if (tokenOrValue === "transparent") {
      return "transparent";
    }
    if (tokenOrValue.startsWith("#")) {
      return tokenOrValue;
    }

    const lookup = buildThemeColorLookup(themeDefinition);
    if (lookup[tokenOrValue]) {
      return lookup[tokenOrValue];
    }

    if (tokenOrValue.startsWith("customColor")) {
      const rawHex = tokenOrValue.slice("customColor".length);
      return rawHex ? `#${rawHex}` : null;
    }

    return null;
  }

  function ensureColorRegistered(spec, colorValue) {
    if (!colorValue || colorValue === "transparent" || !colorValue.startsWith("#")) {
      return;
    }

    const colors = ensureCustomColors(spec);
    if (!colors.includes(colorValue)) {
      colors.push(colorValue);
    }
  }

  function resolveColorReference(spec, themeDefinition, tokenOrValue) {
    if (!tokenOrValue || typeof tokenOrValue !== "string") {
      return tokenOrValue;
    }
    if (tokenOrValue === "transparent") {
      return "transparent";
    }
    if (tokenOrValue.startsWith("color") || tokenOrValue.startsWith("customColor")) {
      const hex = getThemeColorHex(themeDefinition, tokenOrValue);
      ensureColorRegistered(spec, hex);
      return tokenOrValue;
    }
    if (tokenOrValue.startsWith("#")) {
      ensureColorRegistered(spec, tokenOrValue);
      return `customColor${tokenOrValue.slice(1)}`;
    }

    const hex = getThemeColorHex(themeDefinition, tokenOrValue);
    if (hex === "transparent") {
      return "transparent";
    }
    if (hex && hex.startsWith("#")) {
      ensureColorRegistered(spec, hex);
      return `customColor${hex.slice(1)}`;
    }

    return tokenOrValue;
  }

  function resolveCustomColorReference(spec, themeDefinition, tokenOrValue) {
    if (!tokenOrValue || typeof tokenOrValue !== "string") {
      return tokenOrValue;
    }
    if (tokenOrValue === "transparent") {
      return "transparent";
    }
    if (tokenOrValue.startsWith("customColor")) {
      const hex = getThemeColorHex(themeDefinition, tokenOrValue);
      ensureColorRegistered(spec, hex);
      return tokenOrValue;
    }

    const hex = getThemeColorHex(themeDefinition, tokenOrValue);
    if (hex === "transparent") {
      return "transparent";
    }
    if (hex && hex.startsWith("#")) {
      ensureColorRegistered(spec, hex);
      return `customColor${hex.slice(1)}`;
    }

    return resolveColorReference(spec, themeDefinition, tokenOrValue);
  }

  function buildColorDefinition(spec, themeDefinition, tokenOrValue) {
    const reference = resolveColorReference(spec, themeDefinition, tokenOrValue);
    if (!reference) {
      return null;
    }
    if (reference === "transparent") {
      return {
        name: "transparent",
        hexValue: "transparent",
        id: "transparent",
        label: "No color",
        type: "ColorCode",
        value: "transparent"
      };
    }

    const hexValue = getThemeColorHex(themeDefinition, reference) || getThemeColorHex(themeDefinition, tokenOrValue) || reference;
    if (reference.startsWith("color")) {
      return {
        name: reference,
        hexValue,
        id: reference,
        label: reference,
        type: "Class",
        value: `fill-${reference}`
      };
    }

    return {
      hidden: true,
      name: reference,
      hexValue,
      id: reference,
      label: hexValue,
      type: "ColorCode",
      value: `fill-${reference}`
    };
  }

  function upsertFeaturePropertyArray(feature, propertyMap) {
    if (!propertyMap || !isObject(propertyMap)) {
      return;
    }

    feature.properties = Array.isArray(feature.properties) ? feature.properties : [];

    Object.entries(propertyMap).forEach(([id, value]) => {
      const existing = feature.properties.find((entry) => entry.id === id);
      if (existing) {
        existing.value = clone(value);
      } else {
        feature.properties.push({ id, value: clone(value) });
      }
    });
  }

  function removeFeatureProperties(feature, propertyIds) {
    if (!Array.isArray(feature?.properties) || !Array.isArray(propertyIds) || !propertyIds.length) {
      return;
    }

    const removalSet = new Set(propertyIds);
    feature.properties = feature.properties.filter((entry) => !removalSet.has(entry.id));
  }

  function isChartVisual(visId) {
    return typeof visId === "string" && visId.startsWith("com.ibm.vis.");
  }

  function mergeVisualThemes(...layers) {
    const merged = {};
    let hasTheme = false;

    layers.forEach((layer) => {
      if (!isObject(layer)) {
        return;
      }
      deepMerge(merged, clone(layer));
      hasTheme = true;
    });

    return hasTheme ? merged : null;
  }

  function getVisualThemeForVisId(themeDefinition, visId) {
    const legacyTheme = themeDefinition.visuals?.liveByVisId?.[visId];
    if (!isChartVisual(visId)) {
      return legacyTheme || null;
    }

    const chartsTheme = themeDefinition.visuals?.charts || {};
    const normalizedVisId = String(visId || "").toLowerCase();
    const chartDefaults = chartsTheme.defaults;
    const familyDefaults = normalizedVisId.includes("pie")
      ? chartsTheme.pieDefaults
      : chartsTheme.cartesianDefaults;
    const chartSpecific = chartsTheme.byVisId?.[visId];

    return mergeVisualThemes(chartDefaults, familyDefaults, legacyTheme, chartSpecific);
  }

  function getProfileField(source, keys) {
    for (const key of keys) {
      const value = source?.[key];
      if (typeof value === "string" && value) {
        return value;
      }
    }
    return null;
  }

  function parseProfileInfoFromCustomizationPath(pathValue) {
    if (typeof pathValue !== "string") {
      return null;
    }

    const match = pathValue.match(/^\/customizations\/([^/]+)\//i);
    if (!match) {
      return null;
    }

    const profileToken = decodeURIComponent(match[1] || "");
    const [accountid, tid, userid] = profileToken.split(":");
    if (!accountid || !tid || !userid) {
      return null;
    }

    return { accountid, tid, userid };
  }

  async function getCurrentProfileInfo(api) {
    const profile = typeof api.getCurrentProfile === "function"
      ? await Promise.resolve(api.getCurrentProfile())
      : null;
    const candidates = [
      profile,
      profile?.tenantInfo,
      profile?.user,
      profile?.user?.tenantInfo,
      profile?.identity,
      window?.tenantInfo,
      window?.glassAppContext?.tenantInfo,
      window?.glassAppContext?.user
    ].filter(Boolean);

    for (const candidate of candidates) {
      const accountid = getProfileField(candidate, ["accountid", "accountId"]);
      const tid = getProfileField(candidate, ["tid", "tenantId"]);
      const userid = getProfileField(candidate, ["userid", "userId", "id"]);
      if (accountid && tid && userid) {
        return { accountid, tid, userid };
      }
    }

    // Fallback: infer profile tuple from existing custom palette paths.
    try {
      const paletteAssets = await queryPaletteAssets(encodeURIComponent("type eq 'palette'"));
      if (Array.isArray(paletteAssets)) {
        for (const asset of paletteAssets) {
          const inferred = parseProfileInfoFromCustomizationPath(asset?.path);
          if (inferred) {
            return inferred;
          }
        }
      }

      // Some environments reject filtered catalog queries; try unfiltered.
      const allAssets = await queryPaletteAssets();
      if (Array.isArray(allAssets)) {
        for (const asset of allAssets) {
          const inferred = parseProfileInfoFromCustomizationPath(asset?.path);
          if (inferred) {
            return inferred;
          }
        }
      }
    } catch (error) {
      // Keep final null return below when profile inference fails.
    }

    return null;
  }

  function countChartVisualizations(spec) {
    let count = 0;
    iterateWidgets(spec, (wrapper) => {
      const outerFeature = (wrapper.features || {}).Models_internal;
      if (outerFeature && isChartVisual(outerFeature.visId)) {
        count += 1;
      }
    });
    return count;
  }

  function buildPaletteFills(themeDefinition) {
    const series = uniqueColors(
      (Array.isArray(themeDefinition?.tokens?.charts?.series)
        ? themeDefinition.tokens.charts.series
        : [])
        .filter((value) => typeof value === "string" && value.startsWith("#"))
    );

    if (series.length >= 5) {
      return series.slice(0, 8);
    }

    const fallbackAccents = uniqueColors(
      [
        ...(Array.isArray(themeDefinition?.authoringPalette?.accents) ? themeDefinition.authoringPalette.accents : []),
        ...(Array.isArray(themeDefinition?.semantic?.accents?.chartSeries) ? themeDefinition.semantic.accents.chartSeries : []),
        themeDefinition?.semantic?.accents?.primary,
        themeDefinition?.semantic?.accents?.secondary,
        themeDefinition?.semantic?.accents?.tertiary
      ].filter((value) => typeof value === "string" && value.startsWith("#"))
    );

    return uniqueColors([...series, ...fallbackAccents]).slice(0, 8);
  }

  function buildPaletteAssetName(themeDefinition) {
    const baseName = String(themeDefinition?.name || "Workspace Theme")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return `${baseName} Palette`;
  }

  function buildPaletteAssetPath(profileInfo, paletteName) {
    return `/customizations/${profileInfo.accountid}:${profileInfo.tid}:${profileInfo.userid}/${paletteName}`;
  }

  function buildPalettePermission(userid) {
    return {
      inherit: false,
      add_permissions: [
        {
          users: [userid],
          teams: [],
          permissions: ["list", "open", "write", "manage", "secure"]
        },
        {
          users: [],
          teams: ["EVERYONE"],
          permissions: ["list", "open"]
        }
      ]
    };
  }

  async function getPaletteService(api) {
    const serviceLookups = [
      () => api?.glassContext?.getSvc ? api.glassContext.getSvc(".Palette") : null,
      () => api?.glassContext?.getSvc ? api.glassContext.getSvc("Palette") : null,
      () => typeof api.getGlassSvc === "function" ? api.getGlassSvc(".Palette") : null,
      () => typeof api.getGlassSvc === "function" ? api.getGlassSvc("Palette") : null,
      () => typeof api.getServiceWhenReady === "function" ? api.getServiceWhenReady(".Palette") : null,
      () => typeof api.getServiceWhenReady === "function" ? api.getServiceWhenReady("Palette") : null,
      () => typeof api.getService === "function" ? api.getService(".Palette") : null,
      () => typeof api.getService === "function" ? api.getService("Palette") : null,
      () => window?.glassContext?.getSvc ? window.glassContext.getSvc(".Palette") : null,
      () => window?.glassContext?.getSvc ? window.glassContext.getSvc("Palette") : null,
      () => window?.glassAppContext?.getSvc ? window.glassAppContext.getSvc(".Palette") : null,
      () => window?.glassAppContext?.getSvc ? window.glassAppContext.getSvc("Palette") : null
    ];

    for (const lookup of serviceLookups) {
      try {
        const service = await Promise.resolve(lookup());
        if (service && typeof service.createPalette === "function") {
          return service;
        }
      } catch (error) {
        // Try the next lookup path.
      }
    }

    return null;
  }

  function normalizeCreatedPaletteResult(result, paletteName, fills) {
    if (!result) {
      return null;
    }
    if (typeof result === "string") {
      return {
        id: result,
        name: paletteName,
        fills,
        reused: false
      };
    }
    if (typeof result.id === "string") {
      return {
        id: result.id,
        name: result.name || result.label || paletteName,
        fills,
        reused: false
      };
    }
    if (typeof result.paletteId === "string") {
      return {
        id: result.paletteId,
        name: result.name || result.label || paletteName,
        fills,
        reused: false
      };
    }
    if (typeof result.assetId === "string") {
      return {
        id: result.assetId,
        name: result.name || result.label || paletteName,
        fills,
        reused: false
      };
    }
    return null;
  }

  async function queryPaletteAssets(filter) {
    const query = filter
      ? `/pacontent/v1/Assets?$filter=${filter}&$expand=content&$top=500`
      : "/pacontent/v1/Assets?$expand=content&$top=500";

    const allAssets = [];
    let nextUrl = query;
    let pageCount = 0;

    while (nextUrl && pageCount < 10) {
      const response = await fetch(nextUrl, {
        method: "GET",
        credentials: "same-origin"
      });

      if (!response.ok) {
        return null;
      }

      const payload = await response.json().catch(() => null);
      const pageAssets = Array.isArray(payload?.value)
        ? payload.value
        : Array.isArray(payload)
          ? payload
          : [];
      allAssets.push(...pageAssets);

      const nextLink = payload?.["@odata.nextLink"] || payload?.nextLink || payload?.next || null;
      if (!nextLink || typeof nextLink !== "string") {
        nextUrl = null;
      } else {
        nextUrl = nextLink.startsWith("http")
          ? nextLink
          : nextLink.startsWith("/")
            ? nextLink
            : `/${nextLink}`;
      }
      pageCount += 1;
    }

    return allAssets;
  }

  async function findExistingPaletteAsset(api, paletteName) {
    const normalizedName = String(paletteName || "").trim();
    const normalizedLowerName = normalizedName.toLowerCase();
    const profileInfo = await getCurrentProfileInfo(api);
    if (profileInfo) {
      const palettePath = buildPaletteAssetPath(profileInfo, normalizedName);
      const pathFilter = encodeURIComponent(`type eq 'palette' and path eq '${palettePath.replace(/'/g, "''")}'`);
      const assets = await queryPaletteAssets(pathFilter);
      const asset = Array.isArray(assets)
        ? assets.find((entry) => entry?.id && entry?.path === palettePath)
        : null;
      if (asset) {
        return {
          id: asset.id,
          name: asset.name || normalizedName,
          path: asset.path || palettePath,
          fills: asset.content?.content?.fills || [],
          reused: true
        };
      }
    }

    const escapedName = normalizedName.replace(/'/g, "''");
    const nameFilter = encodeURIComponent(`type eq 'palette' and name eq '${escapedName}'`);
    const namedAssets = await queryPaletteAssets(nameFilter);
    let namedAsset = namedAssets?.find((entry) =>
      entry?.id && String(entry?.name || "").trim().toLowerCase() === normalizedLowerName
    );
    if (!namedAsset) {
      const allAssets = await queryPaletteAssets(encodeURIComponent("type eq 'palette'"));
      namedAsset = allAssets?.find((entry) =>
        entry?.id && String(entry?.name || "").trim().toLowerCase() === normalizedLowerName
      );
    }
    if (namedAsset) {
      return {
        id: namedAsset.id,
        name: namedAsset.name || normalizedName,
        path: namedAsset.path || null,
        fills: namedAsset.content?.content?.fills || [],
        reused: true
      };
    }
    return null;
  }

  async function createCustomPaletteAssetViaService(api, paletteName, fills) {
    const paletteService = await getPaletteService(api);
    if (!paletteService) {
      return null;
    }

    const result = await Promise.resolve(
      paletteService.createPalette({
        palette: {
          label: paletteName,
          fillType: "simple",
          fills
        }
      })
    );

    const normalized = normalizeCreatedPaletteResult(result, paletteName, fills);
    if (normalized?.id) {
      return normalized;
    }

    const createdAsset = await findExistingPaletteAsset(api, paletteName);
    if (createdAsset?.id) {
      return createdAsset;
    }

    return null;
  }

  async function createCustomPaletteAssetViaRest(api, paletteName, fills, profileInfoHint = null) {
    const profileInfo = profileInfoHint || await getCurrentProfileInfo(api);
    const payloadCandidates = [];

    if (profileInfo?.accountid && profileInfo?.tid && profileInfo?.userid) {
      payloadCandidates.push({
        custom_properties: {},
        type: "palette",
        name: paletteName,
        path: `/customizations/${profileInfo.accountid}:${profileInfo.tid}:${profileInfo.userid}`,
        content: {
          defaultName: paletteName,
          isMine: true,
          content: {
            fillType: "simple",
            label: paletteName,
            fills
          }
        },
        permission: buildPalettePermission(profileInfo.userid)
      });
    }

    // Fallback candidate when tenant profile fields are not exposed.
    payloadCandidates.push({
      custom_properties: {},
      type: "palette",
      name: paletteName,
      path: "/customizations",
      content: {
        defaultName: paletteName,
        isMine: true,
        content: {
          fillType: "simple",
          label: paletteName,
          fills
        }
      }
    });

    let lastError = null;
    for (const payload of payloadCandidates) {
      const response = await fetch("/pacontent/v1/Assets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "same-origin",
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const details = await response.text().catch(() => "");
        lastError = `Custom palette creation failed (${response.status}): ${details || response.statusText}`;
        continue;
      }

      const asset = await response.json().catch(() => null);
      if (!asset?.id) {
        lastError = "Custom palette creation succeeded but no asset id was returned.";
        continue;
      }

      return {
        id: asset.id,
        name: asset.name || paletteName,
        fills,
        reused: false
      };
    }

    if (lastError) {
      throw new Error(lastError);
    }
    return null;
  }

  async function createCustomPaletteAsset(api, themeDefinition) {
    const canonicalPaletteName = buildPaletteAssetName(themeDefinition);
    const existingPalette = await findExistingPaletteAsset(api, canonicalPaletteName);
    // The saved palette owns its colors. Theme edits must not replace or update it.
    if (existingPalette?.id) {
      return existingPalette;
    }

    const fills = buildPaletteFills(themeDefinition);
    if (!fills.length) {
      throw new Error("The selected theme does not provide any accent colors for a custom chart palette.");
    }

    try {
      const serviceResult = await createCustomPaletteAssetViaService(api, canonicalPaletteName, fills);
      if (serviceResult?.id) {
        return serviceResult;
      }
    } catch (error) {
      // Fall back to direct REST creation below.
    }

    const restResult = await createCustomPaletteAssetViaRest(api, canonicalPaletteName, fills);
    if (restResult?.id) {
      return restResult;
    }

    return {
      id: null,
      name: canonicalPaletteName,
      fills,
      reused: false,
      warning: "Could not resolve the current PAW profile for custom palette creation."
    };
  }

  function applyChartPalette(feature, paletteReference, defaultPaletteIndex = 0) {
    if (!feature || !paletteReference) {
      return;
    }

    upsertFeaturePropertyArray(feature, {
      colorPalette: paletteReference,
      defaultPaletteIndex
    });
  }

  function getFeaturePropertyValue(feature, propertyId) {
    if (!feature || !propertyId) {
      return undefined;
    }

    if (Array.isArray(feature.properties)) {
      const match = feature.properties.find((entry) => entry?.id === propertyId);
      return match?.value;
    }

    if (isObject(feature.properties)) {
      return feature.properties[propertyId];
    }

    return undefined;
  }

  function normalizeThemeChartPaletteHints(themeDefinition) {
    const rawHints = themeDefinition?.chartPaletteByWidgetId;
    if (!isObject(rawHints)) {
      return {};
    }

    const normalized = {};
    Object.entries(rawHints).forEach(([widgetId, value]) => {
      if (!widgetId || !isObject(value)) {
        return;
      }

      const colorPalette = typeof value.colorPalette === "string"
        ? value.colorPalette.trim()
        : "";

      const defaultPaletteIndexRaw = value.defaultPaletteIndex;
      const defaultPaletteIndexNumber = Number(defaultPaletteIndexRaw);
      normalized[widgetId] = {
        colorPalette: colorPalette || null,
        defaultPaletteIndex: Number.isFinite(defaultPaletteIndexNumber)
          ? defaultPaletteIndexNumber
          : undefined
      };
    });
    return normalized;
  }

  function countMatchingChartPaletteHints(spec, chartPaletteHints) {
    if (!isObject(chartPaletteHints) || !Object.keys(chartPaletteHints).length) {
      return 0;
    }

    let matched = 0;
    iterateWidgets(spec, (wrapper) => {
      const outerFeature = (wrapper.features || {}).Models_internal;
      if (!outerFeature || !isChartVisual(outerFeature.visId)) {
        return;
      }

      const wrapperId = String(wrapper?.id || "").trim();
      if (wrapperId && chartPaletteHints[wrapperId]) {
        matched += 1;
      }
    });

    return matched;
  }

  function ensurePersistedProperty(container, key, defaultValue = null) {
    if (!container[key] || !isObject(container[key]) || !("persist" in container[key])) {
      container[key] = {
        persist: true,
        value: defaultValue
      };
    }
    return container[key];
  }

  function applyMdvSectionPatch(spec, targetValue, patch, themeDefinition, applyOptions) {
    if (!patch || !isObject(patch)) {
      return targetValue;
    }

    const next = isObject(targetValue) ? targetValue : {};
    const typographyEnabled = isOptionEnabled(applyOptions, "typography");

    Object.entries(patch).forEach(([key, value]) => {
      switch (key) {
        case "fillColor":
        case "highlightFillColor":
        case "highlightBorderColor":
        case "selectionFillColor":
        case "selectionBorderColor":
        case "color":
          next[key] = buildColorDefinition(spec, themeDefinition, value);
          break;
        case "fontFamily":
          if (typographyEnabled) {
            next["font-family"] = value;
          }
          break;
        case "fontSize":
          if (typographyEnabled) {
            next["font-size"] = value;
          }
          break;
        case "textColor":
          next.color = buildColorDefinition(spec, themeDefinition, value);
          next["inherit-font-text-color"] = false;
          break;
        case "textFormat":
          if (typographyEnabled) {
            next["text-format"] = clone(value);
          }
          break;
        default:
          next[key] = clone(value);
          break;
      }
    });
    return next;
  }

  function applyMdvTheme(spec, innerFeature, themeDefinition, applyOptions) {
    const shellEnabled = isOptionEnabled(applyOptions, "cubeViewShell");
    const rowsEnabled = isOptionEnabled(applyOptions, "gridRows");
    const columnsEnabled = isOptionEnabled(applyOptions, "gridColumns");
    const dataEnabled = isOptionEnabled(applyOptions, "gridData");

    if (!shellEnabled && !rowsEnabled && !columnsEnabled && !dataEnabled) {
      return;
    }

    const widgetTokens = themeDefinition.tokens?.widgets || {};
    const mdvTheme = themeDefinition.visuals?.mdv || {};
    const preservedGenericProperties = new Set([
      "hideRowsHeader",
      "hideColsHeader"
    ]);

    if (shellEnabled && widgetTokens.grid) {
      innerFeature.fillColor = resolveColorReference(spec, themeDefinition, widgetTokens.grid.background);
      innerFeature.borderColor = resolveColorReference(spec, themeDefinition, widgetTokens.grid.borderColor);
    }

    innerFeature.data = innerFeature.data || {};
    innerFeature.data.mdvGridState = innerFeature.data.mdvGridState || {};
    innerFeature.data.mdvGridState.genericProperties = innerFeature.data.mdvGridState.genericProperties || {};

    const genericProperties = innerFeature.data.mdvGridState.genericProperties;
    if (shellEnabled) {
      const genericPatch = mdvTheme.genericProperties || {};
      Object.entries(genericPatch).forEach(([key, value]) => {
        if (preservedGenericProperties.has(key)) {
          return;
        }
        ensurePersistedProperty(genericProperties, key, null).value = clone(value);
      });
    }

    // Keep cube viewers editable by default even if an older theme captured a read-only state.
    ensurePersistedProperty(genericProperties, "isGridEditable", true).value = true;

    const sectionPatch = mdvTheme.sections || {};
    Object.entries(sectionPatch).forEach(([key, patch]) => {
      if (key === "RowHeader" && !rowsEnabled) {
        return;
      }
      if (key === "ColumnHeader" && !columnsEnabled) {
        return;
      }
      if ((key === "DataCell" || key === "Spacer") && !dataEnabled) {
        return;
      }
      const persisted = ensurePersistedProperty(genericProperties, key, {});
      persisted.value = applyMdvSectionPatch(spec, persisted.value, patch, themeDefinition, applyOptions);
    });
  }

  function applySingleCellTheme(spec, innerFeature, themeDefinition, applyOptions) {
    if (!isOptionEnabled(applyOptions, "singleCell")) {
      return;
    }

    const singleCellTheme = themeDefinition.visuals?.singleCell || {};
    if (!isObject(singleCellTheme)) {
      return;
    }

    innerFeature.data = innerFeature.data || {};
    innerFeature.data.mdvGridState = innerFeature.data.mdvGridState || {};
    innerFeature.data.mdvGridState.genericProperties = innerFeature.data.mdvGridState.genericProperties || {};

    const genericProperties = innerFeature.data.mdvGridState.genericProperties;
    const genericPatch = singleCellTheme.genericProperties || {};
    Object.entries(genericPatch).forEach(([key, value]) => {
      ensurePersistedProperty(genericProperties, key, null).value = clone(value);
    });

    const sectionPatch = singleCellTheme.sections || {};
    Object.entries(sectionPatch).forEach(([key, patch]) => {
      const persisted = ensurePersistedProperty(genericProperties, key, {});
      persisted.value = applyMdvSectionPatch(spec, persisted.value, patch, themeDefinition, applyOptions);
    });
  }

  function applySyncTileTheme(spec, innerFeature, themeDefinition, applyOptions) {
    if (!isOptionEnabled(applyOptions, "syncTiles")) {
      return;
    }

    const widgetTokens = themeDefinition.tokens?.widgets || {};
    const syncTheme = themeDefinition.visuals?.syncTile || {};

    innerFeature.fillColor = resolveColorReference(spec, themeDefinition, syncTheme.fillColor || widgetTokens.syncTile?.background || innerFeature.fillColor);
    innerFeature.borderColor = resolveColorReference(spec, themeDefinition, syncTheme.borderColor || widgetTokens.syncTile?.borderColor || innerFeature.borderColor);
    innerFeature.borderRadius = syncTheme.borderRadius ?? widgetTokens.syncTile?.borderRadius ?? innerFeature.borderRadius;

    innerFeature.data = innerFeature.data || {};
    // Never import selector data from themes, including older extracted themes.
    // It contains bindings, selected members and interaction state, not just style.

    const selectorScale = themeDefinition.tokens?.typography?.scale?.selector || {};
    const selectorColor = selectorScale.color || themeDefinition.tokens?.palette?.color3 || null;
    const selectorFontFamily = selectorScale.font || themeDefinition.tokens?.typography?.fonts?.ui || null;
    const typographyEnabled = isOptionEnabled(applyOptions, "typography");

    if (selectorColor || (typographyEnabled && selectorFontFamily)) {
      innerFeature.data.mdvGridState = innerFeature.data.mdvGridState || {};
      innerFeature.data.mdvGridState.genericProperties = innerFeature.data.mdvGridState.genericProperties || {};
      const genericProperties = innerFeature.data.mdvGridState.genericProperties;
      const rowHeader = ensurePersistedProperty(genericProperties, "RowHeader", {});
      const rowHeaderValue = isObject(rowHeader.value) ? rowHeader.value : {};

      if (selectorColor) {
        rowHeaderValue.color = buildColorDefinition(spec, themeDefinition, selectorColor);
      }

      if (typographyEnabled && selectorFontFamily) {
        rowHeaderValue["font-family"] = selectorFontFamily;
      }

      rowHeader.value = rowHeaderValue;
    }
  }

  function applyLiveVisualTheme(spec, feature, visualTheme, themeDefinition) {
    if (!feature || !visualTheme) {
      return;
    }

    if (visualTheme.borderColor) {
      feature.borderColor = resolveColorReference(spec, themeDefinition, visualTheme.borderColor);
    }
    if (visualTheme.fillColor) {
      feature.fillColor = resolveCustomColorReference(spec, themeDefinition, visualTheme.fillColor);
    }
    if (visualTheme.borderRadius !== undefined) {
      feature.borderRadius = visualTheme.borderRadius;
    }
    if (visualTheme.showTitle !== undefined) {
      feature.showTitle = visualTheme.showTitle;
    }
    if (visualTheme.titleHtml && isObject(visualTheme.titleHtml)) {
      feature.titleHtml = clone(visualTheme.titleHtml);
    }
    if (visualTheme.responsiveTitle && isObject(visualTheme.responsiveTitle)) {
      feature.responsiveTitle = clone(visualTheme.responsiveTitle);
    }
    if (visualTheme.properties) {
      upsertFeaturePropertyArray(feature, visualTheme.properties);
    }
  }

  function applyCardDefaults(spec, feature, themeDefinition, widgetTheme) {
    if (!widgetTheme) {
      return;
    }

    if (widgetTheme.background) {
      feature.fillColor = resolveCustomColorReference(spec, themeDefinition, widgetTheme.background);
    }
    if (widgetTheme.borderColor) {
      feature.borderColor = resolveColorReference(spec, themeDefinition, widgetTheme.borderColor);
    }
    if (widgetTheme.borderRadius !== undefined) {
      feature.borderRadius = widgetTheme.borderRadius;
    }
    if (widgetTheme.borderWidth !== undefined) {
      feature.borderWidth = widgetTheme.borderWidth;
    }
    if (widgetTheme.boxShadow !== undefined) {
      feature.boxShadow = widgetTheme.boxShadow;
    }
  }

  function applyWrapperCardSurface(wrapper, themeDefinition, widgetTheme) {
    if (!wrapper || !widgetTheme) {
      return;
    }

    const backgroundHex = getThemeColorHex(themeDefinition, widgetTheme.background);
    if (!backgroundHex) {
      return;
    }

    wrapper.style = wrapper.style || {};
    wrapper.style.background = backgroundHex;

    const innerItem = wrapper.items?.[0];
    if (innerItem) {
      innerItem.style = innerItem.style || {};
      innerItem.style.background = backgroundHex;
    }
  }

  function hasVisibleWidgetBorder(feature) {
    if (!feature || typeof feature.borderColor !== "string" || feature.borderColor === "transparent") {
      return false;
    }

    if (feature.borderWidth === undefined || feature.borderWidth === null) {
      return true;
    }

    const numericBorderWidth = Number(feature.borderWidth);
    return !Number.isFinite(numericBorderWidth) || numericBorderWidth > 0;
  }

  function syncWidgetPreviewBorderState(wrapper, feature) {
    if (!wrapper) {
      return;
    }

    const showBorderInPreview = hasVisibleWidgetBorder(feature);
    wrapper.properties = wrapper.properties || {};
    wrapper.properties.showBorderInPreview = showBorderInPreview;

    const innerItem = wrapper.items?.[0];
    if (innerItem) {
      innerItem.properties = innerItem.properties || {};
      innerItem.properties.showBorderInPreview = showBorderInPreview;
    }
  }

  function applyLiveWidgetFrame(spec, wrapper, feature, themeDefinition, widgetTheme) {
    if (!feature) {
      return;
    }

    // Respect an explicit transparent border on the visual theme instead of
    // backfilling the generic card frame border.
    if (!feature.borderColor && widgetTheme?.borderColor) {
      feature.borderColor = resolveColorReference(spec, themeDefinition, widgetTheme.borderColor);
    }
    if ((feature.borderWidth === undefined || feature.borderWidth === null) && widgetTheme?.borderWidth !== undefined) {
      feature.borderWidth = widgetTheme.borderWidth;
    }
    if ((feature.borderRadius === undefined || feature.borderRadius === null) && widgetTheme?.borderRadius !== undefined) {
      feature.borderRadius = widgetTheme.borderRadius;
    }

    syncWidgetPreviewBorderState(wrapper, feature);
  }

  function applyChartGlobalFormat(wrapper, visualTheme) {
    const globalFormatPatch = visualTheme?.globalFormat;
    if (!wrapper || !isObject(globalFormatPatch)) {
      return;
    }

    wrapper.features = wrapper.features || {};
    wrapper.features.PAProperties = wrapper.features.PAProperties || {};
    wrapper.features.PAProperties.globalFormat = deepMerge(
      isObject(wrapper.features.PAProperties.globalFormat)
        ? clone(wrapper.features.PAProperties.globalFormat)
        : {},
      clone(globalFormatPatch)
    );
  }

  function syncNestedWidgetTitleState(wrapper, showTitle) {
    const innerItem = wrapper?.items?.[0];
    if (!innerItem) {
      return;
    }

    innerItem.properties = innerItem.properties || {};
    innerItem.properties.showTitle = Boolean(showTitle);
    if (showTitle) {
      delete innerItem.properties.titleMode;
    } else {
      innerItem.properties.titleMode = "noTitle";
    }
  }

  function humanizeWidgetLabel(value) {
    if (typeof value !== "string") {
      return null;
    }

    const normalized = value
      .replace(/[_-]+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();

    return normalized || null;
  }

  function getChartDataItemMap(feature) {
    const dataItemMap = new Map();

    for (const view of feature?.data?.dataViews || []) {
      for (const item of view?.dataItems || []) {
        if (item?.id) {
          dataItemMap.set(item.id, item);
        }
      }
    }

    return dataItemMap;
  }

  function getChartSlotDataItem(feature, slotName) {
    if (!feature || !slotName) {
      return null;
    }

    const slot = (feature.slotmapping?.slots || []).find((entry) => entry?.name === slotName);
    if (!slot || !Array.isArray(slot.dataItems) || !slot.dataItems.length) {
      return null;
    }

    const dataItemMap = getChartDataItemMap(feature);
    for (const itemId of slot.dataItems) {
      const dataItem = dataItemMap.get(itemId);
      if (dataItem) {
        return dataItem;
      }
    }

    return null;
  }

  function getChartAxisLabel(feature) {
    const axisDataItem = getChartSlotDataItem(feature, "categories");
    if (!axisDataItem) {
      return null;
    }

    const itemLabel = typeof axisDataItem.itemLabel === "string" ? axisDataItem.itemLabel.trim() : "";
    if (itemLabel) {
      const [dimensionLabel] = itemLabel.split(":");
      const humanizedLabel = humanizeWidgetLabel(dimensionLabel);
      if (humanizedLabel) {
        return humanizedLabel;
      }
    }

    const itemId = typeof axisDataItem.itemId === "string" ? axisDataItem.itemId.trim() : "";
    const match = itemId.match(/^\[([^\]]+)\]\.\[([^\]]+)\]/);
    if (!match) {
      return null;
    }

    return humanizeWidgetLabel(match[1] || match[2] || "");
  }

  function getChartMetricLabel(wrapper) {
    const tm1ViewName = wrapper?.features?.PAProperties?.tm1?.view;
    if (typeof tm1ViewName === "string" && tm1ViewName.trim()) {
      const match = tm1ViewName.trim().match(/^(.*?)\s*-\s*by\s+/i);
      if (match?.[1]) {
        const metricLabel = humanizeWidgetLabel(match[1]);
        if (metricLabel) {
          return metricLabel;
        }
      }
    }

    return null;
  }

  function applyAutoChartTitle(wrapper, feature, applyOptions) {
    if (!feature || !isChartVisual(feature.visId) || !isOptionEnabled(applyOptions, "chartAxisTitles")) {
      return false;
    }

    const axisLabel = getChartAxisLabel(feature);
    if (!axisLabel) {
      return false;
    }
    const metricLabel = getChartMetricLabel(wrapper);

    feature.name = feature.name || {};
    feature.name.translationTable = feature.name.translationTable || {};
    feature.name.translationTable.Default = metricLabel
      ? `${metricLabel} by ${axisLabel}`
      : `By ${axisLabel}`;
    feature.showTitle = true;
    syncNestedWidgetTitleState(wrapper, true);
    return true;
  }

  function applyButtonTheme(spec, feature, themeDefinition, applyOptions) {
    if (!isOptionEnabled(applyOptions, "widgets")) {
      return;
    }

    const buttonTokens = themeDefinition.tokens?.buttons;
    const actionTheme = themeDefinition.visuals?.actionButton || {};
    if (!buttonTokens) {
      return;
    }

    const variantName = feature.properties?.themeVariant || actionTheme.variant || "primary";
    const variant = buttonTokens.variants?.[variantName] || buttonTokens.variants?.primary;
    if (!variant) {
      return;
    }

    feature.fillColor = resolveColorReference(spec, themeDefinition, variant.fill);
    feature.borderColor = resolveColorReference(spec, themeDefinition, variant.border);
    feature.borderRadius = actionTheme.borderRadius ?? buttonTokens.borderRadius ?? feature.borderRadius;
    feature.properties = feature.properties || {};
    if (isOptionEnabled(applyOptions, "typography")) {
      feature.properties.buttonFont = buttonTokens.font;
      feature.properties.buttonFontSize = buttonTokens.fontSize;
    }
    feature.properties.buttonTextColor = getThemeColorHex(themeDefinition, variant.text) || variant.text;
  }

  function replaceHtmlBorderRadius(html, borderRadius) {
    if (typeof html !== "string" || borderRadius === undefined) {
      return html;
    }
    if (/border-radius:\s*[^;"]+;/.test(html)) {
      return html.replace(/border-radius:\s*[^;"]+;/g, `border-radius: ${borderRadius}px;`);
    }
    return html;
  }

  function replaceHtmlColorClass(html, prefix, colorReference) {
    if (typeof html !== "string" || !colorReference) {
      return html;
    }
    return html.replace(
      new RegExp(`${prefix}-(color\\d+|grayShade\\d+|customColor[0-9A-Fa-f]+|transparent)`, "g"),
      `${prefix}-${colorReference}`
    );
  }

  function applyTextTheme(spec, feature, themeDefinition, applyOptions) {
    if (!isOptionEnabled(applyOptions, "widgets")) {
      return;
    }

    const textTheme = themeDefinition.visuals?.text || {};
    const textTokens = themeDefinition.tokens?.widgets?.textLabel || {};
    if (!textTheme) {
      return;
    }

    const fillReference = resolveColorReference(spec, themeDefinition, textTheme.fillColor || textTokens.background || feature.fillColor);
    const borderReference = resolveColorReference(spec, themeDefinition, textTheme.borderColor || textTokens.borderColor || feature.borderColor);
    if (fillReference) {
      feature.fillColor = fillReference;
    }
    if (borderReference) {
      feature.borderColor = borderReference;
    }

    if (textTheme.borderRadius !== undefined) {
      feature.borderRadius = textTheme.borderRadius;
    }

    const content = feature.content?.translationTable?.Default;
    if (content) {
      let nextContent = replaceHtmlBorderRadius(content, textTheme.borderRadius ?? feature.borderRadius);
      nextContent = replaceHtmlColorClass(nextContent, "fill", fillReference);
      nextContent = replaceHtmlColorClass(nextContent, "border", borderReference);
      feature.content.translationTable.Default = nextContent;
    }
  }

  function applyShapeTheme(spec, feature, themeDefinition, applyOptions) {
    if (!isOptionEnabled(applyOptions, "widgets")) {
      return;
    }

    const shapeTheme = themeDefinition.tokens?.widgets?.shape;
    if (!shapeTheme) {
      return;
    }

    feature.fillColor = resolveColorReference(spec, themeDefinition, shapeTheme.fillColor);
    feature.borderColor = resolveColorReference(spec, themeDefinition, shapeTheme.borderColor);
    feature.borderRadius = shapeTheme.borderRadius ?? feature.borderRadius;
  }

  function applyImageTheme(feature, themeDefinition, applyOptions) {
    if (!isOptionEnabled(applyOptions, "widgets")) {
      return;
    }

    const imageTheme = themeDefinition.visuals?.image || {};
    if (imageTheme.objectFit) {
      feature.ObjectFit = imageTheme.objectFit;
    }
  }

  function getThemeLogoDefinition(themeDefinition) {
    const logo = themeDefinition?.branding?.logo;
    if (!logo?.url) {
      return null;
    }
    const logoUrl = String(logo.url || "").trim();
    if (!logoUrl) {
      return null;
    }
    if (logoUrl.toLowerCase().startsWith("data:image/svg+xml") || /\.svg(\?|#|$)/i.test(logoUrl)) {
      return null;
    }

    return {
      url: logoUrl,
      width: logo.width ?? 220,
      height: logo.height ?? 100,
      top: logo.top ?? 0,
      left: logo.left ?? 0,
      objectFit: logo.objectFit || "contain"
    };
  }

  function buildThemeLogoWidget(pageId, logo) {
    const widgetId = `theme-logo-${pageId}`;
    return {
      id: widgetId,
      style: {
        top: `${logo.top}px`,
        left: `${logo.left}px`,
        width: `${logo.width}px`,
        height: `${logo.height}px`
      },
      type: "widget",
      relatedLayouts: "",
      features: {
        Models_internal: {
          id: widgetId,
          type: "image",
          visTypeLocked: true,
          imageLink: logo.url,
          name: {
            translationTable: {}
          },
          ObjectFit: logo.objectFit
        }
      }
    };
  }

  function ensureThemeLogoOnAllTabs(spec, themeDefinition, applyOptions) {
    if (!isOptionEnabled(applyOptions, "logo")) {
      return;
    }

    const logo = getThemeLogoDefinition(themeDefinition);
    if (!logo) {
      return;
    }

    for (const tab of spec.layout?.items || []) {
      for (const page of tab.items || []) {
        page.items = page.items || [];
        const widgetId = `theme-logo-${page.id}`;
        page.items = page.items.filter((item) => item?.id !== widgetId);
        page.items.push(buildThemeLogoWidget(page.id, logo));
      }
    }
  }

  function applyOuterFeatureTheme(spec, wrapper, outerFeature, themeDefinition, applyOptions) {
    if (!outerFeature) {
      return;
    }

    switch (outerFeature.type) {
      case "live": {
        const visualTheme = getVisualThemeForVisId(themeDefinition, outerFeature.visId);
        if (isChartVisual(outerFeature.visId)) {
          if (isOptionEnabled(applyOptions, "chartStyling")) {
            applyCardDefaults(spec, outerFeature, themeDefinition, themeDefinition.tokens?.widgets?.chartCard);
            applyWrapperCardSurface(wrapper, themeDefinition, themeDefinition.tokens?.widgets?.chartCard);
          }
          if (isOptionEnabled(applyOptions, "chartStyling")) {
            applyLiveVisualTheme(spec, outerFeature, visualTheme, themeDefinition);
            applyLiveWidgetFrame(spec, wrapper, outerFeature, themeDefinition, themeDefinition.tokens?.widgets?.chartCard);
            applyChartGlobalFormat(wrapper, visualTheme);
            const showTitle = visualTheme?.showTitle ?? true;
            outerFeature.showTitle = showTitle;
            syncNestedWidgetTitleState(wrapper, showTitle);
          }
          return;
        }

        if (outerFeature.visId === "pacubeviewer") {
          if (isOptionEnabled(applyOptions, "cubeViewShell")) {
            applyCardDefaults(spec, outerFeature, themeDefinition, themeDefinition.tokens?.widgets?.cubeviewerCard);
            applyWrapperCardSurface(wrapper, themeDefinition, themeDefinition.tokens?.widgets?.cubeviewerCard);
            applyLiveVisualTheme(spec, outerFeature, visualTheme, themeDefinition);
            applyLiveWidgetFrame(spec, wrapper, outerFeature, themeDefinition, themeDefinition.tokens?.widgets?.cubeviewerCard);
            const showTitle = visualTheme?.showTitle ?? true;
            outerFeature.showTitle = showTitle;
            syncNestedWidgetTitleState(wrapper, showTitle);
          }
          return;
        }

        if (outerFeature.visId === "pasinglecell") {
          if (isOptionEnabled(applyOptions, "singleCell")) {
            const singleCellCardTheme = themeDefinition.tokens?.widgets?.singleCellCard ||
              themeDefinition.tokens?.widgets?.cubeviewerCard;
            applyCardDefaults(spec, outerFeature, themeDefinition, singleCellCardTheme);
            applyWrapperCardSurface(wrapper, themeDefinition, singleCellCardTheme);
            applyLiveVisualTheme(spec, outerFeature, visualTheme, themeDefinition);
            applyLiveWidgetFrame(spec, wrapper, outerFeature, themeDefinition, singleCellCardTheme);
            const showTitle = visualTheme?.showTitle ?? false;
            outerFeature.showTitle = showTitle;
            syncNestedWidgetTitleState(wrapper, showTitle);
          }
          return;
        }

        if (isOptionEnabled(applyOptions, "widgets")) {
          applyLiveVisualTheme(spec, outerFeature, visualTheme, themeDefinition);
          applyLiveWidgetFrame(
            spec,
            wrapper,
            outerFeature,
            themeDefinition,
            themeDefinition.tokens?.widgets?.chartCard ||
              themeDefinition.tokens?.widgets?.singleCellCard ||
              themeDefinition.tokens?.widgets?.cubeviewerCard
          );
        }
        return;
      }
      case "text":
        applyTextTheme(spec, outerFeature, themeDefinition, applyOptions);
        return;
      case "shape":
        applyShapeTheme(spec, outerFeature, themeDefinition, applyOptions);
        return;
      case "image":
        applyImageTheme(outerFeature, themeDefinition, applyOptions);
        return;
      case "actionButton":
        applyButtonTheme(spec, outerFeature, themeDefinition, applyOptions);
        return;
      default:
        return;
    }
  }

  function iterateWidgets(spec, visitor) {
    for (const tab of spec.layout?.items || []) {
      for (const page of tab.items || []) {
        for (const wrapper of page.items || []) {
          visitor(wrapper);
        }
      }
    }
  }

  function parseCoordinate(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return { value, unit: "number" };
    }
    if (typeof value !== "string") {
      return null;
    }
    const match = value.trim().match(/^(-?\d+(?:\.\d+)?)(px|%)?$/i);
    if (!match) {
      return null;
    }
    return {
      value: Number.parseFloat(match[1]),
      unit: (match[2] || "px").toLowerCase()
    };
  }

  function median(values) {
    if (!Array.isArray(values) || !values.length) {
      return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  function formatTopCoordinate(value, unit) {
    const rounded = Math.round(value);
    if (unit === "number") {
      return rounded;
    }
    return `${rounded}px`;
  }

  function formatSizeCoordinate(value, unit) {
    const rounded = Math.round(value);
    if (unit === "number") {
      return rounded;
    }
    return `${rounded}px`;
  }

  function collectRowCandidatesByY(page) {
    return (page?.items || [])
      .filter((item) => item?.type === "widget" && !String(item?.id || "").startsWith("theme-logo-"))
      // Selector dimensions and placement may be essential to their controls.
      .filter((item) => item.features?.Models_internal?.visId !== "paselector" &&
        !item.items?.some((child) => child.features?.Models_internal?.type === "tm1mdvSyncTile"))
      .map((item) => {
        const top = parseCoordinate(item?.style?.top);
        const left = parseCoordinate(item?.style?.left);
        const height = parseCoordinate(item?.style?.height);
        return {
          item,
          top: top && top.unit !== "%" ? top : null,
          left: left && left.unit !== "%" ? left : { value: 0, unit: "number" },
          height: height && height.unit !== "%" ? height : null
        };
      })
      .filter((entry) => entry.top);
  }

  function clusterRowsByY(page, yThreshold = 20) {
    const candidates = collectRowCandidatesByY(page);
    if (candidates.length < 2) {
      return [];
    }

    candidates.sort((a, b) => (a.top.value - b.top.value) || (a.left.value - b.left.value));
    const clusters = [];

    for (const entry of candidates) {
      let cluster = clusters.find((group) => Math.abs(entry.top.value - group.referenceTop) <= yThreshold);
      if (!cluster) {
        cluster = {
          items: [],
          referenceTop: entry.top.value
        };
        clusters.push(cluster);
      }
      cluster.items.push(entry);
      const med = median(cluster.items.map((x) => x.top.value));
      cluster.referenceTop = med ?? cluster.referenceTop;
    }

    return clusters;
  }

  function alignPageRowsByY(page, yThreshold = 20) {
    const clusters = clusterRowsByY(page, yThreshold);
    if (!clusters.length) {
      return 0;
    }

    let alignedCount = 0;
    for (const cluster of clusters) {
      if (cluster.items.length < 2) {
        continue;
      }
      const targetTop = median(cluster.items.map((x) => x.top.value));
      if (targetTop === null) {
        continue;
      }

      for (const entry of cluster.items) {
        if (Math.abs(entry.top.value - targetTop) < 0.01) {
          continue;
        }
        entry.item.style = entry.item.style || {};
        entry.item.style.top = formatTopCoordinate(targetTop, entry.top.unit);
        alignedCount += 1;
      }
    }

    return alignedCount;
  }

  function equalizePageRowHeights(page, yThreshold = 20, heightThreshold = 20) {
    const clusters = clusterRowsByY(page, yThreshold);
    if (!clusters.length) {
      return 0;
    }

    let equalizedCount = 0;
    for (const cluster of clusters) {
      const heightEntries = cluster.items.filter((entry) => entry.height);
      if (heightEntries.length < 2) {
        continue;
      }

      const heights = heightEntries.map((entry) => entry.height.value);
      const minHeight = Math.min(...heights);
      const maxHeight = Math.max(...heights);
      if (maxHeight - minHeight > heightThreshold) {
        continue;
      }

      const targetHeight = median(heights);
      if (targetHeight === null) {
        continue;
      }

      for (const entry of heightEntries) {
        if (Math.abs(entry.height.value - targetHeight) < 0.01) {
          continue;
        }
        entry.item.style = entry.item.style || {};
        entry.item.style.height = formatSizeCoordinate(targetHeight, entry.height.unit);
        equalizedCount += 1;
      }
    }

    return equalizedCount;
  }

  function autoAlignRowsByY(spec, applyOptions) {
    if (!isOptionEnabled(applyOptions, "autoAlignRows")) {
      return 0;
    }

    let alignedCount = 0;
    for (const tab of spec.layout?.items || []) {
      for (const page of tab.items || []) {
        alignedCount += alignPageRowsByY(page, 20);
      }
    }
    return alignedCount;
  }

  function autoEqualizeRowHeights(spec, applyOptions) {
    if (!isOptionEnabled(applyOptions, "autoEqualizeHeights")) {
      return 0;
    }

    let equalizedCount = 0;
    for (const tab of spec.layout?.items || []) {
      for (const page of tab.items || []) {
        equalizedCount += equalizePageRowHeights(page, 20, 20);
      }
    }
    return equalizedCount;
  }

  function applyDashboardAndTabBackgrounds(spec, themeDefinition, applyOptions) {
    if (!isOptionEnabled(applyOptions, "canvas")) {
      return;
    }

    spec.layout = spec.layout || {};
    spec.layout.style = spec.layout.style || {};

    const canvasTokens = themeDefinition.tokens?.canvas || {};
    const dashboardBackground =
      getThemeColorHex(themeDefinition, canvasTokens.dashboardBackground) ||
      getThemeColorHex(themeDefinition, canvasTokens.background) ||
      canvasTokens.dashboardBackground ||
      canvasTokens.background;
    const tabBackground =
      getThemeColorHex(themeDefinition, canvasTokens.tabBackground) ||
      dashboardBackground ||
      canvasTokens.tabBackground;

    if (dashboardBackground) {
      spec.layout.style.background = dashboardBackground;
    }

    for (const tab of spec.layout.items || []) {
      tab.style = tab.style || {};
      if (tabBackground) {
        tab.style.background = tabBackground;
      }

      for (const page of tab.items || []) {
        page.style = page.style || {};
        if (tabBackground) {
          page.style.background = tabBackground;
        }
      }
    }
  }

  function applyBoardLayoutSettings(spec, themeDefinition, applyOptions) {
    if (!isOptionEnabled(applyOptions, "boardProperties")) {
      return;
    }

    spec.properties = spec.properties || {};
    spec.layout = spec.layout || {};

    const canvasTokens = themeDefinition.tokens?.canvas || {};
    if (canvasTokens.defaultZoom) {
      spec.properties.defaultZoom = canvasTokens.defaultZoom;
    }
    if (canvasTokens.pageSize) {
      spec.layout.pageSize = clone(canvasTokens.pageSize);
    }
    if (canvasTokens.fitPage !== undefined) {
      spec.layout.fitPage = canvasTokens.fitPage;
    }
    if (canvasTokens.layoutPositioning) {
      spec.layout.layoutPositioning = canvasTokens.layoutPositioning;
      for (const tab of spec.layout.items || []) {
        for (const page of tab.items || []) {
          page.layoutPositioning = canvasTokens.layoutPositioning;
        }
      }
    }

    const themeLayout = themeDefinition.layout || {};
    if (themeLayout.tabBackgroundColor !== undefined) {
      spec.layout.tabBackgroundColor = themeLayout.tabBackgroundColor;
    }
    if (themeLayout.tabTextColor !== undefined) {
      spec.layout.tabTextColor = themeLayout.tabTextColor;
    }
    if (themeLayout.tabSelectedLineColor !== undefined) {
      spec.layout.tabSelectedLineColor = themeLayout.tabSelectedLineColor;
    }
  }

  function buildThemePropertiesPatch(themeDefinition, applyOptions) {
    const properties = clone(themeDefinition.properties || {});
    const hasBoardProperties = isOptionEnabled(applyOptions, "boardProperties");
    const hasCustomColors = isOptionEnabled(applyOptions, "customColors");

    if (!hasBoardProperties) {
      Object.keys(properties).forEach((key) => {
        if (key !== "customColors") {
          delete properties[key];
        }
      });
    }

    if (!hasCustomColors) {
      delete properties.customColors;
    } else if (Array.isArray(properties.customColors?.colors)) {
      properties.customColors.colors = properties.customColors.colors
        .filter((color) => typeof color === "string" && /^#[0-9A-Fa-f]{6}$/.test(color));
      if (!properties.customColors.colors.length) {
        delete properties.customColors;
      }
    }

    return Object.keys(properties).length ? properties : null;
  }

  function sanitizeBracketToken(value) {
    return String(value || "")
      .trim()
      .replace(/^\[+|\]+$/g, "");
  }

  function buildHierarchyUniqueName(dimension, hierarchy) {
    const hierarchyValue = String(hierarchy || "").trim();
    if (hierarchyValue.startsWith("[")) {
      return hierarchyValue;
    }

    const dimensionToken = sanitizeBracketToken(dimension || hierarchyValue);
    const hierarchyToken = sanitizeBracketToken(hierarchyValue || dimensionToken);
    return `[${dimensionToken}].[${hierarchyToken}]`;
  }

  function buildMemberUniqueName(hierarchyUniqueName, elementValue) {
    const value = String(elementValue || "").trim();
    if (!value) {
      return null;
    }
    if (value.startsWith("[")) {
      return value;
    }
    return `${hierarchyUniqueName}.[${sanitizeBracketToken(value)}]`;
  }

  function toComparableKey(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getMdvDataSource(wrapper, innerFeature) {
    const parentStore = innerFeature?.data?.parentStore || {};
    const wrapperTm1 = wrapper?.features?.PAProperties?.tm1 || {};

    let server = parentStore.server || wrapperTm1.server || null;
    let cube = parentStore.cube || wrapperTm1.cube || null;

    if ((!server || !cube) && Array.isArray(innerFeature?.data?.path)) {
      const path = innerFeature.data.path;
      const dbIndex = path.findIndex((entry) => String(entry).toLowerCase() === "databases");
      const cubeIndex = path.findIndex((entry) => String(entry).toLowerCase() === "cubes");
      if (!server && dbIndex >= 0 && path[dbIndex + 1]) {
        server = path[dbIndex + 1];
      }
      if (!cube && cubeIndex >= 0 && path[cubeIndex + 1]) {
        cube = path[cubeIndex + 1];
      }
    }

    if (!server || !cube) {
      return null;
    }

    return {
      server: String(server),
      cube: String(cube)
    };
  }

  function collectCubeViewMdvEntries(spec) {
    const entries = [];
    iterateWidgets(spec, (wrapper) => {
      const outerFeature = wrapper?.features?.Models_internal;
      if (outerFeature?.visId !== "pacubeviewer") {
        return;
      }

      const innerFeature = wrapper?.items?.[0]?.features?.Models_internal;
      if (!innerFeature || innerFeature.type !== "tm1mdv") {
        return;
      }

      const dataSource = getMdvDataSource(wrapper, innerFeature);
      if (!dataSource) {
        return;
      }

      entries.push({
        wrapper,
        outerFeature,
        innerFeature,
        server: dataSource.server,
        cube: dataSource.cube
      });
    });
    return entries;
  }

  function normalizeConditionalFormattingRules(themeDefinition) {
    const visualTheme = themeDefinition?.visuals?.conditionalFormatting;
    if (!isObject(visualTheme)) {
      return [];
    }

    return (Array.isArray(visualTheme.rules) ? visualTheme.rules : [])
      .map((rule, index) => {
        if (!isObject(rule)) {
          return null;
        }
        if (rule.enabled === false) {
          return null;
        }
        if (!isObject(rule.style) || !Object.keys(rule.style).length) {
          return null;
        }

        const dimension = sanitizeBracketToken(rule.dimension);
        const hierarchy = sanitizeBracketToken(rule.hierarchy || rule.dimension);
        const hierarchyUniqueName = buildHierarchyUniqueName(dimension, hierarchy);
        const elements = [...new Set(
          (Array.isArray(rule.elements) ? rule.elements : [])
            .map((value) => String(value || "").trim())
            .filter(Boolean)
        )];
        if (!dimension || !hierarchy || !elements.length) {
          return null;
        }

        return {
          index,
          name: String(rule.name || "").trim(),
          dimension,
          hierarchy,
          hierarchyUniqueName,
          elements,
          comparisonOperator: rule.comparisonOperator || "=",
          operandType: rule.operandType || "memberSelector",
          style: clone(rule.style),
          targetServer: rule.targetServer || rule.server || rule.target?.server || null,
          targetCube: rule.targetCube || rule.cube || rule.target?.cube || null
        };
      })
      .filter(Boolean);
  }

  function matchesRuleTarget(targetValue, actualValue) {
    if (!targetValue || targetValue === "*") {
      return true;
    }
    return toComparableKey(targetValue) === toComparableKey(actualValue);
  }

  function buildThemeConditionalDefinitionId(ordinal, applyHexSeed = "") {
    const base = String(applyHexSeed || Date.now().toString(16))
      .replace(/[^0-9a-f]/gi, "")
      .slice(0, 13)
      .padStart(13, "0")
      .toLowerCase();
    const counter = String(Math.max(0, ordinal - 1)).padStart(8, "0");
    return `CFD${base}_${counter}`;
  }

  function applyThemeConditionalFormatting(spec, themeDefinition, applyOptions) {
    if (!isOptionEnabled(applyOptions, "conditionalFormatting")) {
      return {
        definitionCount: 0,
        referenceCount: 0
      };
    }

    const cubeViewEntries = collectCubeViewMdvEntries(spec);

    const rules = normalizeConditionalFormattingRules(themeDefinition);
    if (!cubeViewEntries.length || !rules.length) {
      return {
        definitionCount: 0,
        referenceCount: 0
      };
    }

    const cfTheme = themeDefinition?.visuals?.conditionalFormatting || {};
    const paletteId = cfTheme.paletteId || "userPaletteColor";
    const featureRefs = new Map();
    const featureTargetKeys = new Map();
    const newDefinitions = [];
    let addedReferenceCount = 0;
    let ordinal = 0;
    const applyHexSeed = `${Date.now().toString(16)}${Math.floor(Math.random() * 0xffff).toString(16)}`.slice(0, 13);

    const groupedByCube = new Map();
    cubeViewEntries.forEach((entry) => {
      const key = `${toComparableKey(entry.server)}::${toComparableKey(entry.cube)}`;
      if (!groupedByCube.has(key)) {
        groupedByCube.set(key, {
          server: entry.server,
          cube: entry.cube,
          entries: []
        });
      }
      groupedByCube.get(key).entries.push(entry);
    });

    const definitionName = cfTheme.name || rules[0]?.name || "";

    groupedByCube.forEach((group) => {
      const conditionDefinition = [];
      const groupTargetKeys = new Set();

      rules.forEach((rule) => {
        if (!matchesRuleTarget(rule.targetServer, group.server) ||
            !matchesRuleTarget(rule.targetCube, group.cube)) {
          return;
        }

        const memberUniqueNames = rule.elements
          .map((element) => buildMemberUniqueName(rule.hierarchyUniqueName, element))
          .filter(Boolean);
        if (!memberUniqueNames.length) {
          return;
        }

        groupTargetKeys.add(`${toComparableKey(group.server)}::${toComparableKey(group.cube)}::${toComparableKey(rule.hierarchyUniqueName)}`);

        memberUniqueNames.forEach((memberUniqueName) => {
          conditionDefinition.push({
            Server: group.server,
            Cube: group.cube,
            member: memberUniqueName,
            hierarchy: rule.hierarchyUniqueName,
            conditions: [
              {
                member: memberUniqueName,
                comparisonOperator: rule.comparisonOperator,
                operandType: rule.operandType,
                value: memberUniqueName,
                style: clone(rule.style)
              }
            ]
          });
        });
      });

      if (!conditionDefinition.length) {
        return;
      }

      ordinal += 1;
      const definitionId = buildThemeConditionalDefinitionId(ordinal, applyHexSeed);
      newDefinitions.push({
        id: definitionId,
        conditionDefinition,
        version: "1.0",
        name: definitionName,
        paletteId
      });

      group.entries.forEach((entry) => {
        if (!featureTargetKeys.has(entry.innerFeature)) {
          featureTargetKeys.set(entry.innerFeature, new Set());
        }
        groupTargetKeys.forEach((targetKey) => featureTargetKeys.get(entry.innerFeature).add(targetKey));

        if (!featureRefs.has(entry.innerFeature)) {
          featureRefs.set(
            entry.innerFeature,
            new Set(Array.isArray(entry.innerFeature.conditionalFormatReferences)
              ? entry.innerFeature.conditionalFormatReferences
              : [])
          );
        }
        const refsSet = featureRefs.get(entry.innerFeature);
        if (!refsSet.has(definitionId)) {
          refsSet.add(definitionId);
          addedReferenceCount += 1;
        }
      });
    });

    if (!Array.isArray(spec.mdvConditionalFormatDefinitions)) {
      spec.mdvConditionalFormatDefinitions = [];
    }
    spec.mdvConditionalFormatDefinitions.push(...newDefinitions);

    const definitionById = new Map(
      spec.mdvConditionalFormatDefinitions
        .filter((entry) => entry && typeof entry.id === "string")
        .map((entry) => [entry.id, entry])
    );
    const makeTargetKey = (server, cube, hierarchy) =>
      `${toComparableKey(server)}::${toComparableKey(cube)}::${toComparableKey(hierarchy)}`;
    const addedDefinitionIds = new Set(newDefinitions.map((entry) => entry.id));
    featureRefs.forEach((refsSet, feature) => {
      const refs = [...refsSet];
      const targetKeys = featureTargetKeys.get(feature) || new Set();
      const filteredLegacyRefs = refs.filter((id) => {
        if (addedDefinitionIds.has(id)) {
          return false;
        }
        const definition = definitionById.get(id);
        if (!definition || !Array.isArray(definition.conditionDefinition)) {
          return true;
        }
        const overlapsThemedTarget = definition.conditionDefinition.some((entry) =>
          targetKeys.has(makeTargetKey(entry?.Server, entry?.Cube, entry?.hierarchy))
        );
        return !overlapsThemedTarget;
      });
      const ordered = [
        ...refs.filter((id) => addedDefinitionIds.has(id)),
        ...filteredLegacyRefs
      ];
      feature.conditionalFormatReferences = ordered;
    });

    return {
      definitionCount: newDefinitions.length,
      referenceCount: addedReferenceCount
    };
  }

  function removeThemeConditionalFormatting(spec, applyOptions) {
    if (!applyOptions?.removeConditionalFormatting) {
      return {
        definitionCount: 0,
        referenceCount: 0
      };
    }

    let removedReferenceCount = 0;
    iterateWidgets(spec, (wrapper) => {
      const innerFeature = wrapper?.items?.[0]?.features?.Models_internal;
      if (!innerFeature || innerFeature.type !== "tm1mdv") {
        return;
      }

      if (Array.isArray(innerFeature.conditionalFormatReferences) && innerFeature.conditionalFormatReferences.length) {
        removedReferenceCount += innerFeature.conditionalFormatReferences.length;
      }
      innerFeature.conditionalFormatReferences = [];
    });

    const removedDefinitionCount = Array.isArray(spec.mdvConditionalFormatDefinitions)
      ? spec.mdvConditionalFormatDefinitions.length
      : 0;
    spec.mdvConditionalFormatDefinitions = [];

    return {
      definitionCount: removedDefinitionCount,
      referenceCount: removedReferenceCount
    };
  }

  function applyThemeDefinition(spec, themeDefinition, applyOptions = {}) {
    if (isOptionEnabled(applyOptions, "boardProperties") && themeDefinition.baseTheme) {
      spec.theme = themeDefinition.baseTheme;
    }

    spec.properties = spec.properties || {};
    spec.layout = spec.layout || {};
    spec.layout.style = spec.layout.style || {};

    const propertiesPatch = buildThemePropertiesPatch(themeDefinition, applyOptions);
    if (propertiesPatch) {
      deepMerge(spec.properties, propertiesPatch);
    }

    applyBoardLayoutSettings(spec, themeDefinition, applyOptions);
    applyDashboardAndTabBackgrounds(spec, themeDefinition, applyOptions);
    ensureThemeLogoOnAllTabs(spec, themeDefinition, applyOptions);
    let generatedChartTitleCount = 0;

    iterateWidgets(spec, (wrapper) => {
      const outerFeature = (wrapper.features || {}).Models_internal;
      applyOuterFeatureTheme(spec, wrapper, outerFeature, themeDefinition, applyOptions);
      if (applyAutoChartTitle(wrapper, outerFeature, applyOptions)) {
        generatedChartTitleCount += 1;
      }

      const innerItem = wrapper.items?.[0];
      const innerFeature = (innerItem?.features || {}).Models_internal;
      if (!innerFeature) {
        return;
      }

      if (innerFeature.type === "tm1mdv") {
        applyMdvTheme(spec, innerFeature, themeDefinition, applyOptions);
        if (outerFeature?.visId === "pasinglecell") {
          applySingleCellTheme(spec, innerFeature, themeDefinition, applyOptions);
        }
      } else if (innerFeature.type === "tm1mdvSyncTile") {
        applySyncTileTheme(spec, innerFeature, themeDefinition, applyOptions);
      }
    });

    const removedConditionalFormattingResult = removeThemeConditionalFormatting(spec, applyOptions);
    const conditionalFormattingResult = applyThemeConditionalFormatting(spec, themeDefinition, applyOptions);
    const alignedCount = autoAlignRowsByY(spec, applyOptions);
    const equalizedHeightCount = autoEqualizeRowHeights(spec, applyOptions);

    return {
      spec,
      removedConditionalFormattingResult,
      conditionalFormattingResult,
      alignedCount,
      equalizedHeightCount,
      generatedChartTitleCount
    };
  }

  function getNativeBoardSpecHost() {
    return window.__glassAppController?.currentAppView?.currentContentView || null;
  }

  function isVisibleDialogElement(element) {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0;
  }

  function findBoardSpecDialogElements() {
    const dialogRoots = [
      ...document.querySelectorAll("dialog"),
      ...document.querySelectorAll('[role="dialog"]'),
      ...document.querySelectorAll(".bx--modal")
    ];

    for (const root of dialogRoots) {
      if (!isVisibleDialogElement(root)) {
        continue;
      }

      const text = (root.textContent || "").toLowerCase();
      if (!text.includes("board specification")) {
        continue;
      }

      const textarea = root.querySelector("textarea");
      const buttons = [...root.querySelectorAll("button")];
      const updateButton = buttons.find((button) => /update/i.test(button.textContent || ""));
      const copyButton = buttons.find((button) => /copy/i.test(button.textContent || ""));

      if (textarea && updateButton) {
        return { root, textarea, updateButton, copyButton };
      }
    }

    return null;
  }

  async function waitForBoardSpecDialogElements(timeoutMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const elements = findBoardSpecDialogElements();
      if (elements) {
        return elements;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 75));
    }
    return null;
  }

  function setNativeTextareaValue(textarea, value) {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
    if (descriptor?.set) {
      descriptor.set.call(textarea, value);
    } else {
      textarea.value = value;
    }

    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function applyBoardSpecViaNativeDialog(spec) {
    const host = getNativeBoardSpecHost();
    if (typeof host?._openBoardSpecificationDialog !== "function") {
      return null;
    }

    await Promise.resolve(host._openBoardSpecificationDialog());
    const dialog = await waitForBoardSpecDialogElements();
    if (!dialog?.textarea || !dialog?.updateButton) {
      return null;
    }

    dialog.textarea.focus();
    dialog.textarea.select();
    setNativeTextareaValue(dialog.textarea, JSON.stringify(spec, null, 2));
    dialog.updateButton.click();

    return {
      ok: true,
      action: "applyBoardSpec",
      method: "nativeDialog",
      workbookName: spec.name || "(unnamed workbook)",
      widgetCount: countWidgets(spec)
    };
  }

  async function importWorkbook(payload) {
    const api = getDashboardApi();
    const spec = normalizeWorkbookSpec(payload.workbookSpec);

    api.reloadFromJSONSpec(spec);
    if (typeof api.setDirty === "function") {
      api.setDirty(true);
    }
    if (typeof api.showToast === "function") {
      api.showToast("Workbook JSON imported into the current board.");
    }

    return {
      ok: true,
      action: "importWorkbook",
      workbookName: spec.name || "(unnamed workbook)",
      widgetCount: countWidgets(spec)
    };
  }

  async function applyBoardSpec(payload) {
    const api = getDashboardApi();
    const spec = normalizeWorkbookSpec(payload.workbookSpec);

    try {
      api.reloadFromJSONSpec(spec);
      if (typeof api.setDirty === "function") {
        api.setDirty(true);
      }
      if (typeof api.showToast === "function") {
        api.showToast("Board spec applied to the current board.");
      }

      return {
        ok: true,
        action: "applyBoardSpec",
        method: "reloadFromJSONSpec",
        workbookName: spec.name || "(unnamed workbook)",
        widgetCount: countWidgets(spec)
      };
    } catch (error) {
      const nativeResult = await applyBoardSpecViaNativeDialog(spec);
      if (nativeResult) {
        return nativeResult;
      }
      throw error;
    }
  }

  async function getBoardSpecPayload() {
    const api = getDashboardApi();
    return {
      ok: true,
      action: "getBoardSpec",
      spec: clone(api.getSpec())
    };
  }

  async function applyTheme(payload) {
    const api = getDashboardApi();
    const spec = clone(api.getSpec());
    const applyOptions = payload.applyOptions || {};
    const themeDefinition = clone(payload.themeDefinition || {});
    const chartCount = countChartVisualizations(spec);
    const chartStylingEnabled = isOptionEnabled(applyOptions, "chartStyling");
    const chartPaletteHints = normalizeThemeChartPaletteHints(themeDefinition);
    const matchingChartPaletteHintCount = countMatchingChartPaletteHints(spec, chartPaletteHints);
    const shouldPreferChartPaletteHints =
      chartStylingEnabled && chartCount > 0 &&
      matchingChartPaletteHintCount > 0 &&
      matchingChartPaletteHintCount === chartCount;
    let createdPalette = null;
    let paletteWarning = null;

    if (chartStylingEnabled && chartCount > 0 && !shouldPreferChartPaletteHints) {
      try {
        createdPalette = await createCustomPaletteAsset(api, themeDefinition);
        if (createdPalette && !createdPalette.id && createdPalette.warning) {
          paletteWarning = createdPalette.warning;
          createdPalette = null;
        }
      } catch (error) {
        paletteWarning = error?.message || "Custom palette creation failed.";
      }
    }

    const applyResult = applyThemeDefinition(spec, themeDefinition, applyOptions);
    const nextSpec = applyResult?.spec || spec;
    const removedConditionalFormattingResult = applyResult?.removedConditionalFormattingResult || {
      definitionCount: 0,
      referenceCount: 0
    };
    const conditionalFormattingResult = applyResult?.conditionalFormattingResult || {
      definitionCount: 0,
      referenceCount: 0
    };
    const alignedCount = applyResult?.alignedCount || 0;
    const equalizedHeightCount = applyResult?.equalizedHeightCount || 0;
    const generatedChartTitleCount = applyResult?.generatedChartTitleCount || 0;

    if (createdPalette?.id) {
      const paletteReference = `__CM__${createdPalette.id}`;
      const defaultPaletteIndex = themeDefinition.tokens?.charts?.defaultPaletteIndex ?? 0;

      iterateWidgets(nextSpec, (wrapper) => {
        const outerFeature = (wrapper.features || {}).Models_internal;
        if (outerFeature && isChartVisual(outerFeature.visId)) {
          const wrapperId = String(wrapper?.id || "").trim();
          const chartPaletteHint = wrapperId ? chartPaletteHints[wrapperId] : null;

          if (chartPaletteHint) {
            if (!chartPaletteHint.colorPalette) {
              removeFeatureProperties(outerFeature, ["colorPalette", "defaultPaletteIndex"]);
              return;
            }

            const existingDefaultPaletteIndex = getFeaturePropertyValue(outerFeature, "defaultPaletteIndex");
            const hintedIndex = Number.isFinite(Number(chartPaletteHint.defaultPaletteIndex))
              ? Number(chartPaletteHint.defaultPaletteIndex)
              : Number.isFinite(Number(existingDefaultPaletteIndex))
                ? Number(existingDefaultPaletteIndex)
                : defaultPaletteIndex;
            applyChartPalette(outerFeature, chartPaletteHint.colorPalette, hintedIndex);
            return;
          }

          applyChartPalette(outerFeature, paletteReference, defaultPaletteIndex);
        }
      });
    } else if (shouldPreferChartPaletteHints) {
      iterateWidgets(nextSpec, (wrapper) => {
        const outerFeature = (wrapper.features || {}).Models_internal;
        if (!outerFeature || !isChartVisual(outerFeature.visId)) {
          return;
        }

        const wrapperId = String(wrapper?.id || "").trim();
        const chartPaletteHint = wrapperId ? chartPaletteHints[wrapperId] : null;
        if (!chartPaletteHint) {
          return;
        }

        if (!chartPaletteHint.colorPalette) {
          removeFeatureProperties(outerFeature, ["colorPalette", "defaultPaletteIndex"]);
          return;
        }

        const existingDefaultPaletteIndex = getFeaturePropertyValue(outerFeature, "defaultPaletteIndex");
        const hintedIndex = Number.isFinite(Number(chartPaletteHint.defaultPaletteIndex))
          ? Number(chartPaletteHint.defaultPaletteIndex)
          : Number.isFinite(Number(existingDefaultPaletteIndex))
            ? Number(existingDefaultPaletteIndex)
            : (themeDefinition.tokens?.charts?.defaultPaletteIndex ?? 0);
        applyChartPalette(outerFeature, chartPaletteHint.colorPalette, hintedIndex);
      });
    }

    api.reloadFromJSONSpec(nextSpec);
    if (typeof api.setDirty === "function") {
      api.setDirty(true);
    }
    if (typeof api.showToast === "function") {
      api.showToast(`Applied theme: ${payload.themeDefinition?.name || payload.themeId || "workspace theme"}`);
    }

    return {
      ok: true,
      action: "applyTheme",
      theme: themeDefinition?.name || payload.themeId || "workspace theme",
      applyOptions,
      widgetCount: countWidgets(nextSpec),
      chartCount,
      generatedChartTitleCount,
      alignedCount,
      equalizedHeightCount,
      removedConditionalFormattingCount: removedConditionalFormattingResult.definitionCount || 0,
      removedConditionalFormattingReferences: removedConditionalFormattingResult.referenceCount || 0,
      conditionalFormattingCount: conditionalFormattingResult.definitionCount || 0,
      conditionalFormattingReferences: conditionalFormattingResult.referenceCount || 0,
      createdPaletteId: createdPalette?.id || null,
      createdPaletteName: createdPalette?.name || null,
      reusedPalette: createdPalette?.reused || false,
      appliedChartPaletteHints: shouldPreferChartPaletteHints,
      chartPaletteHintCount: matchingChartPaletteHintCount,
      paletteWarning
    };
  }

  function countWidgets(spec) {
    let count = 0;
    iterateWidgets(spec, () => {
      count += 1;
    });
    return count;
  }

  async function handleAction(action, payload) {
    switch (action) {
      case "ping":
        return { ok: true, available: typeof window.__getDashboardAPI === "function" };
      case "extractThemeFromPage":
        return extractThemeFromDocument();
      case "getBoardSpec":
        return getBoardSpecPayload();
      case "importWorkbook":
        return importWorkbook(payload);
      case "applyBoardSpec":
        return applyBoardSpec(payload);
      case "applyTheme":
        return applyTheme(payload);
      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window) {
      return;
    }

    const message = event.data;
    if (!message || message.source !== REQUEST_PREFIX) {
      return;
    }

    try {
      const payload = await handleAction(message.action, message.payload || {});
      window.postMessage(
        {
          source: RESPONSE_PREFIX,
          requestId: message.requestId,
          ok: true,
          payload
        },
        "*"
      );
    } catch (error) {
      window.postMessage(
        {
          source: RESPONSE_PREFIX,
          requestId: message.requestId,
          ok: false,
          error: error.message
        },
        "*"
      );
    }
  });
})();
