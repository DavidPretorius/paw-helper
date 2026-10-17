(function installContentBridge() {
  const BRIDGE_FLAG = "__pawWorkbookExtensionBridgeLoaded";
  const RESPONSE_PREFIX = "PAW_WORKBOOK_EXTENSION_RESPONSE";
  const REQUEST_PREFIX = "PAW_WORKBOOK_EXTENSION_REQUEST";
  let bridgeLoadPromise;

  function normalizeColor(value) {
    if (!value || value === "transparent") {
      return null;
    }

    const trimmed = value.trim();
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
    if (rgb.some((value) => Number.isNaN(value))) {
      return null;
    }

    return `#${rgb.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }

  function normalizeFontFamily(value) {
    if (!value) {
      return null;
    }
    return value
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

  function extractThemeFromPage() {
    const bodyStyle = window.getComputedStyle(document.body);
    const textColors = new Map();
    const backgroundColors = new Map();
    const accentColors = new Map();
    const borderColors = new Map();
    const bodyFonts = new Map();
    const headingFonts = new Map();
    const uiFonts = new Map();
    const buttonFonts = new Map();

    const bodyColor = normalizeColor(bodyStyle.color);
    const bodyBackground = normalizeColor(bodyStyle.backgroundColor);
    incrementCounter(textColors, bodyColor);
    incrementCounter(backgroundColors, bodyBackground);
    incrementCounter(bodyFonts, normalizeFontFamily(bodyStyle.fontFamily));

    const sampleNodes = [...document.querySelectorAll("body *")].slice(0, 350);
    for (const element of sampleNodes) {
      const style = window.getComputedStyle(element);
      if (!isVisibleElement(element, style)) {
        continue;
      }

      const tag = element.tagName.toLowerCase();
      const color = normalizeColor(style.color);
      const background = normalizeColor(style.backgroundColor);
      const border = normalizeColor(style.borderTopColor || style.borderColor);
      const fontFamily = normalizeFontFamily(style.fontFamily);

      incrementCounter(textColors, color);
      incrementCounter(backgroundColors, background);
      incrementCounter(borderColors, border);
      incrementCounter(uiFonts, fontFamily);

      if (["a", "button"].includes(tag) || element.getAttribute("role") === "button") {
        incrementCounter(accentColors, background || color || border);
        incrementCounter(buttonFonts, fontFamily);
      }

      if (/^h[1-6]$/.test(tag) || element.getAttribute("role") === "heading") {
        incrementCounter(headingFonts, fontFamily);
      }
    }

    return {
      ok: true,
      pageTitle: document.title || "",
      url: window.location.href,
      colors: {
        backgrounds: topValues(backgroundColors, 6),
        text: topValues(textColors, 6),
        accents: topValues(accentColors, 7),
        borders: topValues(borderColors, 6)
      },
      fonts: {
        body: topValues(bodyFonts, 1)[0] || null,
        heading: topValues(headingFonts, 1)[0] || null,
        ui: topValues(uiFonts, 1)[0] || null,
        button: topValues(buttonFonts, 1)[0] || null
      }
    };
  }

  function injectPageBridge() {
    if (window[BRIDGE_FLAG]) {
      return Promise.resolve();
    }
    if (bridgeLoadPromise) {
      return bridgeLoadPromise;
    }

    bridgeLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("page-bridge.js");
      script.dataset.pawWorkbookExtension = "true";
      script.onload = () => {
        window[BRIDGE_FLAG] = true;
        script.remove();
        resolve();
      };
      script.onerror = () => {
        script.remove();
        reject(new Error("Failed to inject the PAW page bridge."));
      };
      (document.head || document.documentElement).appendChild(script);
    }).catch((error) => {
      // Let Refresh retry a transient failure instead of caching it forever.
      bridgeLoadPromise = null;
      throw error;
    });

    return bridgeLoadPromise;
  }

  async function sendToPage(action, payload) {
    await injectPageBridge();

    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timeoutId = window.setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("Timed out waiting for the PAW page bridge."));
      }, 12000);

      function onMessage(event) {
        if (event.source !== window) {
          return;
        }

        const message = event.data;
        if (!message || message.source !== RESPONSE_PREFIX || message.requestId !== requestId) {
          return;
        }

        window.clearTimeout(timeoutId);
        window.removeEventListener("message", onMessage);

        if (message.ok) {
          resolve(message.payload);
        } else {
          reject(new Error(message.error || "Unknown page bridge error"));
        }
      }

      window.addEventListener("message", onMessage);
      window.postMessage(
        {
          source: REQUEST_PREFIX,
          requestId,
          action,
          payload
        },
        "*"
      );
    });
  }

  injectPageBridge().catch(() => {});

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "extractThemeFromPage") {
      try {
        sendResponse(extractThemeFromPage());
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return false;
    }

    sendToPage(message.action, message)
      .then((payload) => sendResponse(payload))
      .catch((error) => {
        if (message.action === "ping") {
          sendResponse({ ok: true, available: false, note: error.message });
          return;
        }
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  });
})();
