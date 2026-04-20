let capturing = false;
let hoveredEl = null;
let tooltip = null;
let previewPanel = null;

console.log("[Decova] Content script loaded");

// ─── Message listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  console.log("[Decova] Message received:", msg.action);
  if (msg.action === "startCapture") startCapture();
  if (msg.action === "stopCapture") stopCapture();
});

// ─── Capture mode on/off ─────────────────────────────────────────────────────

function startCapture() {
  capturing = true;
  console.log("[Decova] Capture mode started");
  document.body.classList.add("decova-active");
  createTooltip();
  document.addEventListener("mouseover", onMouseOver);
  document.addEventListener("mouseout", onMouseOut);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown);
}

function stopCapture() {
  capturing = false;
  document.body.classList.remove("decova-active");
  clearHighlight();
  removeTooltip();
  document.removeEventListener("mouseover", onMouseOver);
  document.removeEventListener("mouseout", onMouseOut);
  document.removeEventListener("click", onClick, true);
  document.removeEventListener("keydown", onKeyDown);
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

function createTooltip() {
  tooltip = document.createElement("div");
  tooltip.className = "decova-tooltip";
  tooltip.textContent = "Click to capture";
  document.body.appendChild(tooltip);
}

function removeTooltip() {
  if (tooltip) { tooltip.remove(); tooltip = null; }
}

document.addEventListener("mousemove", (e) => {
  if (!tooltip) return;
  tooltip.style.left = e.clientX + 14 + "px";
  tooltip.style.top = e.clientY + 14 + "px";
});

// ─── Hover highlight ─────────────────────────────────────────────────────────

function onMouseOver(e) {
  const el = smartSelect(e.target);
  if (!el || el === document.body || el === document.documentElement) return;
  if (hoveredEl === el) return;
  clearHighlight();
  hoveredEl = el;
  hoveredEl.classList.add("decova-highlight");
}

function onMouseOut() {
  clearHighlight();
}

function clearHighlight() {
  if (hoveredEl) {
    hoveredEl.classList.remove("decova-highlight");
    hoveredEl = null;
  }
}

// ─── Smart element selection ─────────────────────────────────────────────────
// Scores elements to find the most meaningful container to capture.

function smartSelect(el) {
  let current = el;
  for (let i = 0; i < 5; i++) {
    if (!current || current === document.body) break;
    if (isMeaningful(current)) return current;
    current = current.parentElement;
  }
  return el;
}

function isMeaningful(el) {
  const tag = el.tagName.toLowerCase();
  const meaningfulTags = ["button", "a", "nav", "header", "footer", "section",
    "article", "aside", "main", "form", "input", "select", "textarea",
    "figure", "card", "li"];

  if (meaningfulTags.includes(tag)) return true;

  const rect = el.getBoundingClientRect();
  const styles = window.getComputedStyle(el);

  // Too small → skip
  if (rect.width < 20 || rect.height < 20) return false;

  // Has visible background or border → meaningful
  const bg = styles.backgroundColor;
  const border = styles.borderWidth;
  const shadow = styles.boxShadow;
  const hasVisualStyle =
    (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") ||
    (border && border !== "0px") ||
    (shadow && shadow !== "none");

  if (hasVisualStyle) return true;

  // Has own text content (not just from children)
  if (el.childNodes.length > 0) {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) return true;
    }
  }

  return false;
}

// ─── Click to capture ────────────────────────────────────────────────────────

function onClick(e) {
  if (!capturing) return;

  // Ignore clicks on our own UI
  if (e.target.closest(".decova-panel") || e.target.closest(".decova-tooltip")) return;

  e.preventDefault();
  e.stopPropagation();

  const el = smartSelect(e.target);
  if (!el) return;

  clearHighlight();
  const data = extractStyles(el);
  captureElementScreenshot(el, (imageDataUrl) => {
    data.image = imageDataUrl;
    showPreviewPanel(el, data);
  });
}

// ─── Keyboard: Escape to exit ─────────────────────────────────────────────────

function onKeyDown(e) {
  if (e.key === "Escape") {
    if (previewPanel) {
      closePreviewPanel();
    } else {
      stopCapture();
      chrome.runtime.sendMessage({ action: "captureStopped" });
    }
  }
  // Arrow up: expand selection to parent
  if (e.key === "ArrowUp" && hoveredEl && hoveredEl.parentElement) {
    e.preventDefault();
    clearHighlight();
    hoveredEl = hoveredEl.parentElement;
    hoveredEl.classList.add("decova-highlight");
  }
}

// ─── Style extraction ────────────────────────────────────────────────────────

function extractStyles(el) {
  const s = window.getComputedStyle(el);

  return {
    sourceUrl: window.location.href,
    htmlSnippet: el.outerHTML.slice(0, 2000),
    typography: {
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      textAlign: s.textAlign,
      color: s.color,
    },
    colors: {
      text: s.color,
      background: s.backgroundColor,
      border: s.borderColor,
    },
    layout: {
      padding: s.padding,
      margin: s.margin,
      width: s.width,
      height: s.height,
      display: s.display,
      flexDirection: s.flexDirection,
      alignItems: s.alignItems,
      justifyContent: s.justifyContent,
      gap: s.gap,
    },
    effects: {
      borderRadius: s.borderRadius,
      borderWidth: s.borderWidth,
      borderStyle: s.borderStyle,
      boxShadow: s.boxShadow,
      opacity: s.opacity,
    },
    tagName: el.tagName.toLowerCase(),
    classList: Array.from(el.classList).slice(0, 5),
  };
}

// ─── Screenshot capture ───────────────────────────────────────────────────────
// Sends a captureTab request to background.js, then crops the full-viewport
// PNG down to the element's bounding rect and returns a JPEG data URL.

function captureElementScreenshot(el, callback) {
  const rect = el.getBoundingClientRect();

  // Skip capture for elements too small to be useful
  if (rect.width < 4 || rect.height < 4) { callback(null); return; }

  // Temporarily hide the floating tooltip so it doesn't appear in the shot
  if (tooltip) tooltip.style.visibility = "hidden";

  chrome.runtime.sendMessage({ action: "captureTab" }, (response) => {
    if (tooltip) tooltip.style.visibility = "";

    if (chrome.runtime.lastError || !response?.dataUrl) {
      callback(null);
      return;
    }

    const img = new Image();
    img.onload = () => {
      const dpr = window.devicePixelRatio || 1;

      // Source coordinates in device pixels
      const sx = Math.round(rect.left * dpr);
      const sy = Math.round(rect.top * dpr);
      const sw = Math.round(rect.width * dpr);
      const sh = Math.round(rect.height * dpr);

      // Cap output width at 600px to keep storage lean
      const maxPx = 600;
      const scale = sw > maxPx ? maxPx / sw : 1;
      const dw = Math.max(1, Math.round(sw * scale));
      const dh = Math.max(1, Math.round(sh * scale));

      const canvas = document.createElement("canvas");
      canvas.width = dw;
      canvas.height = dh;
      canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);

      callback(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => callback(null);
    img.src = response.dataUrl;
  });
}

// ─── Preview panel ───────────────────────────────────────────────────────────

function showPreviewPanel(el, data) {
  if (previewPanel) closePreviewPanel();

  // Freeze capture while panel is open
  document.removeEventListener("mouseover", onMouseOver);
  document.removeEventListener("mouseout", onMouseOut);

  previewPanel = document.createElement("div");
  previewPanel.className = "decova-panel";
  previewPanel.innerHTML = buildPanelHTML(data);
  document.body.appendChild(previewPanel);

  // Animate in
  requestAnimationFrame(() => previewPanel.classList.add("visible"));

  // Populate collections dropdown from storage
  chrome.storage.local.get(["collections", "clips"], (result) => {
    const select = previewPanel.querySelector("#cs-collection");
    if (!select) return;

    const named = result.collections || [];
    // Also pull any collection names from existing clips that aren't in the list
    const clipCollections = (result.clips || [])
      .map((c) => c.collectionId)
      .filter((c) => c && c !== "Uncategorized");
    const all = [...new Set([...named, ...clipCollections])].sort();

    all.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });
  });

  // Close button
  previewPanel.querySelector(".cs-close").addEventListener("click", closePreviewPanel);

  // Save button
  previewPanel.querySelector(".cs-save").addEventListener("click", () => {
    saveClip(data, el);
  });

  // Cancel button
  previewPanel.querySelector(".cs-cancel").addEventListener("click", closePreviewPanel);

  // Copy CSS button
  previewPanel.querySelector(".cs-copy-css").addEventListener("click", () => {
    navigator.clipboard.writeText(generateCSS(data));
    showToast("CSS copied!");
  });

  // Copy Tailwind button
  previewPanel.querySelector(".cs-copy-tw").addEventListener("click", () => {
    navigator.clipboard.writeText(generateTailwind(data));
    showToast("Tailwind copied!");
  });
}

function closePreviewPanel() {
  if (!previewPanel) return;
  previewPanel.classList.remove("visible");
  setTimeout(() => {
    previewPanel?.remove();
    previewPanel = null;
  }, 200);
  // Resume hover
  if (capturing) {
    document.addEventListener("mouseover", onMouseOver);
    document.addEventListener("mouseout", onMouseOut);
  }
}

function buildPanelHTML(data) {
  const t = data.typography;
  const c = data.colors;
  const e = data.effects;
  const l = data.layout;

  const screenshotHTML = data.image
    ? `<div class="cs-screenshot"><img class="cs-screenshot-img" src="${data.image}" alt="" /></div>`
    : "";

  return `
    <div class="cs-header">
      <span class="cs-title">✦ Decova</span>
      <button class="cs-close">✕</button>
    </div>

    ${screenshotHTML}

    <div class="cs-body">
      <div class="cs-section">
        <div class="cs-section-label">Typography</div>
        <div class="cs-row"><span class="cs-key">Font</span><span class="cs-val">${sanitize(t.fontFamily.split(",")[0])}</span></div>
        <div class="cs-row"><span class="cs-key">Size</span><span class="cs-val">${sanitize(t.fontSize)}</span></div>
        <div class="cs-row"><span class="cs-key">Weight</span><span class="cs-val">${sanitize(t.fontWeight)}</span></div>
        <div class="cs-row"><span class="cs-key">Line height</span><span class="cs-val">${sanitize(t.lineHeight)}</span></div>
      </div>

      <div class="cs-section">
        <div class="cs-section-label">Colors</div>
        <div class="cs-row">
          <span class="cs-key">Text</span>
          <span class="cs-val cs-color-val">
            <span class="cs-swatch" style="background:${c.text}"></span>
            ${sanitize(rgbToHex(c.text))}
          </span>
        </div>
        <div class="cs-row">
          <span class="cs-key">Background</span>
          <span class="cs-val cs-color-val">
            <span class="cs-swatch" style="background:${c.background}"></span>
            ${sanitize(rgbToHex(c.background))}
          </span>
        </div>
      </div>

      <div class="cs-section">
        <div class="cs-section-label">Effects</div>
        <div class="cs-row"><span class="cs-key">Border radius</span><span class="cs-val">${sanitize(e.borderRadius)}</span></div>
        <div class="cs-row"><span class="cs-key">Shadow</span><span class="cs-val cs-truncate">${e.boxShadow === "none" ? "none" : sanitize(e.boxShadow.slice(0, 30)) + "…"}</span></div>
        <div class="cs-row"><span class="cs-key">Padding</span><span class="cs-val">${sanitize(l.padding)}</span></div>
      </div>

      <div class="cs-section">
        <div class="cs-section-label">Export</div>
        <div class="cs-export-row">
          <button class="cs-copy-css">Copy CSS</button>
          <button class="cs-copy-tw">Copy Tailwind</button>
        </div>
      </div>

      <div class="cs-section cs-save-section">
        <div class="cs-section-label">Save To</div>
        <input class="cs-input" id="cs-title" placeholder="Name this capture…" />
        <select class="cs-input" id="cs-collection">
          <option value="Uncategorized">Uncategorized</option>
        </select>
      </div>
    </div>

    <div class="cs-footer">
      <button class="cs-cancel">Cancel</button>
      <button class="cs-save">Save</button>
    </div>
  `;
}

// ─── Save clip ────────────────────────────────────────────────────────────────

function saveClip(data, el) {
  const title = previewPanel.querySelector("#cs-title").value.trim() || "Untitled Capture";
  const collectionId = previewPanel.querySelector("#cs-collection").value || "Uncategorized";

  // Separate image from the styles payload so it isn't stored twice
  const { image, ...styles } = data;

  const clip = {
    id: Date.now().toString(),
    title,
    collectionId,
    styles,
    sourceUrl: data.sourceUrl,
    savedAt: new Date().toISOString(),
    image: image || null,
  };

  chrome.storage.local.get(["clips"], (result) => {
    const clips = result.clips || [];
    clips.push(clip);
    chrome.storage.local.set({ clips }, () => {
      closePreviewPanel();
      showToast("Saved to " + collectionId + " ✓");
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Tailwind generator ──────────────────────────────────────────────────────

// Tailwind spacing scale: px value → scale token
const TW_SPACING = {
  0: "0", 1: "px", 2: "0.5", 4: "1", 6: "1.5", 8: "2", 10: "2.5",
  12: "3", 14: "3.5", 16: "4", 20: "5", 24: "6", 28: "7", 32: "8",
  36: "9", 40: "10", 44: "11", 48: "12", 56: "14", 64: "16", 80: "20",
  96: "24", 112: "28", 128: "32", 144: "36", 160: "40", 176: "44",
  192: "48", 208: "52", 224: "56", 240: "60", 256: "64", 288: "72",
  320: "80", 384: "96",
};

function twSpacing(px) {
  const n = Math.round(parseFloat(px));
  if (isNaN(n)) return null;
  return TW_SPACING[n] !== undefined ? TW_SPACING[n] : `[${px}]`;
}

function twSides(value) {
  const p = (value || "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return null;
  if (p.length === 1) return { t: p[0], r: p[0], b: p[0], l: p[0] };
  if (p.length === 2) return { t: p[0], r: p[1], b: p[0], l: p[1] };
  if (p.length === 3) return { t: p[0], r: p[1], b: p[2], l: p[1] };
  return { t: p[0], r: p[1], b: p[2], l: p[3] };
}

function twSpacingClasses(value, pfx) {
  const s = twSides(value);
  if (!s) return [];
  if (["t","r","b","l"].every(k => parseFloat(s[k]) === 0)) return [];
  const t = twSpacing(s.t), r = twSpacing(s.r),
        b = twSpacing(s.b), l = twSpacing(s.l);
  if (t === r && r === b && b === l) return [`${pfx}-${t}`];
  if (t === b && r === l) {
    const out = [];
    if (t !== "0") out.push(`${pfx}y-${t}`);
    if (r !== "0") out.push(`${pfx}x-${r}`);
    return out;
  }
  return [
    t !== "0" ? `${pfx}t-${t}` : null,
    r !== "0" ? `${pfx}r-${r}` : null,
    b !== "0" ? `${pfx}b-${b}` : null,
    l !== "0" ? `${pfx}l-${l}` : null,
  ].filter(Boolean);
}

function twColorClass(prefix, rgb) {
  const hex = rgbToHex(rgb);
  if (!hex || hex === "transparent") return null;
  if (hex === "#ffffff") return `${prefix}-white`;
  if (hex === "#000000") return `${prefix}-black`;
  return `${prefix}-[${hex}]`;
}

function twShadow(shadow) {
  if (!shadow || shadow === "none") return null;
  const m = shadow.match(/\d+px\s+\d+px\s+(\d+)px/);
  if (!m) return `shadow-[${shadow.replace(/\s+/g,"_")}]`;
  const blur = parseInt(m[1]);
  if (blur <= 2)  return "shadow-sm";
  if (blur <= 6)  return "shadow";
  if (blur <= 10) return "shadow-md";
  if (blur <= 15) return "shadow-lg";
  if (blur <= 25) return "shadow-xl";
  return "shadow-2xl";
}

function twLineHeight(lh, fontSize) {
  if (!lh || lh === "normal") return null;
  let ratio = parseFloat(lh);
  if (lh.endsWith("px") && fontSize && fontSize.endsWith("px")) {
    ratio = parseFloat(lh) / parseFloat(fontSize);
  }
  if (isNaN(ratio)) return null;
  const r = Math.round(ratio * 1000) / 1000;
  const map = { 1: "leading-none", 1.25: "leading-tight", 1.375: "leading-snug",
                1.5: "leading-normal", 1.625: "leading-relaxed", 2: "leading-loose" };
  return map[r] || null;
}

function generateTailwind(data) {
  const t = data.typography || {};
  const c = data.colors    || {};
  const e = data.effects   || {};
  const l = data.layout    || {};
  const cls = [];

  // Display
  const displayMap = { block:"block", "inline-block":"inline-block", inline:"inline",
    flex:"flex", "inline-flex":"inline-flex", grid:"grid", "inline-grid":"inline-grid", none:"hidden" };
  if (l.display && displayMap[l.display]) cls.push(displayMap[l.display]);

  // Flex layout
  if (l.display === "flex" || l.display === "inline-flex") {
    const dirMap = { row:"flex-row", column:"flex-col",
      "row-reverse":"flex-row-reverse", "column-reverse":"flex-col-reverse" };
    if (l.flexDirection && dirMap[l.flexDirection] && l.flexDirection !== "row")
      cls.push(dirMap[l.flexDirection]);

    const alignMap = { "flex-start":"items-start", "flex-end":"items-end",
      center:"items-center", baseline:"items-baseline", stretch:"items-stretch" };
    if (l.alignItems && alignMap[l.alignItems]) cls.push(alignMap[l.alignItems]);

    const justifyMap = { "flex-start":"justify-start", "flex-end":"justify-end",
      center:"justify-center", "space-between":"justify-between",
      "space-around":"justify-around", "space-evenly":"justify-evenly" };
    if (l.justifyContent && justifyMap[l.justifyContent] && l.justifyContent !== "normal")
      cls.push(justifyMap[l.justifyContent]);
  }

  // Gap
  if (l.gap && l.gap !== "normal" && l.gap !== "0px") {
    const g = twSpacing(l.gap);
    if (g) cls.push(`gap-${g}`);
  }

  // Padding / margin
  twSpacingClasses(l.padding, "p").forEach(c => cls.push(c));
  twSpacingClasses(l.margin,  "m").forEach(c => cls.push(c));

  // Font family (generic bucket)
  const fname = (t.fontFamily || "").split(",")[0].replace(/"/g,"").trim().toLowerCase();
  if (fname.includes("mono") || fname.includes("courier") || fname.includes("consolas")) {
    cls.push("font-mono");
  } else if (fname.includes("serif") && !fname.includes("sans")) {
    cls.push("font-serif");
  } else if (fname) {
    cls.push("font-sans");
  }

  // Font size
  const sizeMap = { "12px":"text-xs", "14px":"text-sm", "16px":"text-base",
    "18px":"text-lg", "20px":"text-xl", "24px":"text-2xl", "30px":"text-3xl",
    "36px":"text-4xl", "48px":"text-5xl", "60px":"text-6xl",
    "72px":"text-7xl", "96px":"text-8xl", "128px":"text-9xl" };
  if (t.fontSize) cls.push(sizeMap[t.fontSize] || `text-[${t.fontSize}]`);

  // Font weight
  const weightMap = { "100":"font-thin", "200":"font-extralight", "300":"font-light",
    "400":"font-normal", "500":"font-medium", "600":"font-semibold",
    "700":"font-bold", "800":"font-extrabold", "900":"font-black" };
  if (t.fontWeight && weightMap[t.fontWeight] && t.fontWeight !== "400")
    cls.push(weightMap[t.fontWeight]);

  // Line height
  const lh = twLineHeight(t.lineHeight, t.fontSize);
  if (lh) cls.push(lh);

  // Letter spacing
  const trackMap = { "-0.05em":"tracking-tighter", "-0.025em":"tracking-tight",
    "0.025em":"tracking-wide", "0.05em":"tracking-wider", "0.1em":"tracking-widest" };
  if (t.letterSpacing && trackMap[t.letterSpacing]) cls.push(trackMap[t.letterSpacing]);

  // Text align
  const alignMap2 = { left:"text-left", center:"text-center", right:"text-right", justify:"text-justify" };
  if (t.textAlign && alignMap2[t.textAlign] && t.textAlign !== "left")
    cls.push(alignMap2[t.textAlign]);

  // Colors
  const textCls = twColorClass("text", c.text);
  if (textCls) cls.push(textCls);

  const isTransparentBg = !c.background ||
    c.background === "rgba(0, 0, 0, 0)" || c.background === "transparent";
  if (!isTransparentBg) {
    const bgCls = twColorClass("bg", c.background);
    if (bgCls) cls.push(bgCls);
  }

  // Border radius
  const radiusMap = { "0px":"rounded-none", "2px":"rounded-sm", "4px":"rounded",
    "6px":"rounded-md", "8px":"rounded-lg", "12px":"rounded-xl",
    "16px":"rounded-2xl", "24px":"rounded-3xl", "9999px":"rounded-full", "50%":"rounded-full" };
  if (e.borderRadius && e.borderRadius !== "0px")
    cls.push(radiusMap[e.borderRadius] || `rounded-[${e.borderRadius}]`);

  // Border width + color
  if (e.borderWidth && e.borderWidth !== "0px") {
    const bwMap = { "1px":"border", "2px":"border-2", "4px":"border-4", "8px":"border-8" };
    cls.push(bwMap[e.borderWidth] || `border-[${e.borderWidth}]`);
    const bCls = twColorClass("border", c.border);
    if (bCls) cls.push(bCls);
  }

  // Box shadow
  const sh = twShadow(e.boxShadow);
  if (sh) cls.push(sh);

  // Opacity
  if (e.opacity && e.opacity !== "1") {
    const opMap = { "0":"opacity-0","0.05":"opacity-5","0.1":"opacity-10",
      "0.2":"opacity-20","0.25":"opacity-25","0.3":"opacity-30","0.4":"opacity-40",
      "0.5":"opacity-50","0.6":"opacity-60","0.7":"opacity-70","0.75":"opacity-75",
      "0.8":"opacity-80","0.9":"opacity-90","0.95":"opacity-95" };
    cls.push(opMap[e.opacity] || `opacity-[${e.opacity}]`);
  }

  return cls.join(" ");
}

function generateCSS(data) {
  const t = data.typography;
  const c = data.colors;
  const e = data.effects;
  const l = data.layout;
  return `.element {\n` +
    `  font-family: ${t.fontFamily};\n` +
    `  font-size: ${t.fontSize};\n` +
    `  font-weight: ${t.fontWeight};\n` +
    `  color: ${rgbToHex(c.text)};\n` +
    `  background-color: ${rgbToHex(c.background)};\n` +
    `  padding: ${l.padding};\n` +
    `  border-radius: ${e.borderRadius};\n` +
    `  box-shadow: ${e.boxShadow};\n` +
    `}`;
}

function rgbToHex(rgb) {
  if (!rgb || rgb === "transparent" || rgb === "rgba(0, 0, 0, 0)") return "transparent";
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return rgb;
  return "#" + [match[1], match[2], match[3]]
    .map(n => parseInt(n).toString(16).padStart(2, "0")).join("");
}

function sanitize(str) {
  if (!str) return "—";
  return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function showToast(msg) {
  const toast = document.createElement("div");
  toast.className = "decova-toast";
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}
