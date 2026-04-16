// ── State ─────────────────────────────────────────────────────────────────────

let allClips = [];
let collections = [];       // named collections array in storage
let activeCollection = "all";
let searchQuery = "";

// ── Init ──────────────────────────────────────────────────────────────────────

loadData();

// Live-update when clips or collections change (e.g. new capture in another tab)
chrome.storage.onChanged.addListener((changes) => {
  if (changes.clips || changes.collections) loadData();
});

// ── Load ──────────────────────────────────────────────────────────────────────

function loadData() {
  chrome.storage.local.get(["clips", "collections"], (result) => {
    allClips = result.clips || [];
    collections = result.collections || [];

    // Pull any collection names that exist on clips but aren't in the list yet
    allClips.forEach((clip) => {
      const cid = clip.collectionId;
      if (cid && cid !== "Uncategorized" && !collections.includes(cid)) {
        collections.push(cid);
      }
    });

    renderSidebar();
    renderGrid();
    updateSidebarTotal();
  });
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function renderSidebar() {
  const list = document.getElementById("collections-list");

  const uncatCount = allClips.filter(
    (c) => !c.collectionId || c.collectionId === "Uncategorized"
  ).length;

  const items = [
    { id: "all", name: "All Clips", count: allClips.length },
    ...(uncatCount > 0
      ? [{ id: "Uncategorized", name: "Uncategorized", count: uncatCount }]
      : []),
    ...collections.map((name) => ({
      id: name,
      name,
      count: allClips.filter((c) => c.collectionId === name).length,
    })),
  ];

  list.innerHTML = items
    .map(
      (item) => `
      <div class="collection-item ${activeCollection === item.id ? "active" : ""}"
           data-id="${escAttr(item.id)}">
        <span class="collection-name">${escHtml(item.name)}</span>
        <span class="collection-count">${item.count}</span>
      </div>`
    )
    .join("");

  list.querySelectorAll(".collection-item").forEach((el) => {
    el.addEventListener("click", () => {
      activeCollection = el.dataset.id;
      document.getElementById("page-title").textContent =
        el.querySelector(".collection-name").textContent;
      renderSidebar();
      renderGrid();
    });
  });
}

function updateSidebarTotal() {
  const el = document.getElementById("sidebar-total");
  el.textContent = `${allClips.length} clip${allClips.length !== 1 ? "s" : ""} saved`;
}

// ── New collection ────────────────────────────────────────────────────────────

document.getElementById("new-collection-btn").addEventListener("click", () => {
  const btn = document.getElementById("new-collection-btn");
  btn.style.display = "none";

  const form = document.createElement("div");
  form.className = "new-collection-form";
  form.innerHTML = `
    <input class="new-collection-input" id="nc-input" placeholder="Collection name…" />
    <button class="new-collection-confirm" id="nc-confirm">Add</button>
  `;
  btn.parentElement.appendChild(form);

  const input = form.querySelector("#nc-input");
  input.focus();

  const submit = () => {
    const name = input.value.trim();
    if (name && !collections.includes(name)) {
      collections.push(name);
      chrome.storage.local.set({ collections }, () => {
        form.remove();
        btn.style.display = "";
        renderSidebar();
      });
    } else {
      form.remove();
      btn.style.display = "";
    }
  };

  form.querySelector("#nc-confirm").addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") {
      form.remove();
      btn.style.display = "";
    }
  });
});

// ── Search ────────────────────────────────────────────────────────────────────

document.getElementById("search-input").addEventListener("input", (e) => {
  searchQuery = e.target.value.toLowerCase();
  renderGrid();
});

// ── Grid ──────────────────────────────────────────────────────────────────────

function renderGrid() {
  const grid = document.getElementById("grid");
  const emptyState = document.getElementById("empty-state");
  const pageCount = document.getElementById("page-count");

  let clips = [...allClips].reverse(); // most recent first

  if (activeCollection !== "all") {
    clips = clips.filter((c) => {
      const cid = c.collectionId || "Uncategorized";
      return cid === activeCollection;
    });
  }

  if (searchQuery) {
    clips = clips.filter(
      (c) =>
        (c.title || "").toLowerCase().includes(searchQuery) ||
        (c.collectionId || "").toLowerCase().includes(searchQuery) ||
        (c.sourceUrl || "").toLowerCase().includes(searchQuery)
    );
  }

  pageCount.textContent = clips.length;

  if (clips.length === 0) {
    grid.style.display = "none";
    emptyState.style.display = "flex";
    return;
  }

  grid.style.display = "grid";
  emptyState.style.display = "none";
  grid.innerHTML = clips.map(buildCardHTML).join("");

  grid.querySelectorAll(".card").forEach((card) => {
    const id = card.dataset.id;
    const clip = allClips.find((c) => c.id === id);

    card.addEventListener("click", (e) => {
      if (!e.target.closest(".card-btn")) openModal(clip);
    });

    card.querySelector(".card-btn.copy")?.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(generateCSS(clip.styles));
      showToast("CSS copied!");
    });

    card.querySelector(".card-btn.delete")?.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteClip(id);
    });
  });
}

function buildCardHTML(clip) {
  const colors = clip.styles?.colors || {};
  const typography = clip.styles?.typography || {};

  const bg =
    colors.background &&
    colors.background !== "rgba(0, 0, 0, 0)" &&
    colors.background !== "transparent"
      ? colors.background
      : "#f5f5f5";

  const textColor = colors.text || "#555";
  const fontName =
    (typography.fontFamily || "")
      .split(",")[0]
      .replace(/"/g, "")
      .trim() || "sans-serif";
  const fontSize = typography.fontSize || "";

  const domain = getDomain(clip.sourceUrl);
  const timeAgo = getTimeAgo(clip.savedAt);
  const collection = clip.collectionId || "Uncategorized";
  const tagName = clip.styles?.tagName || "div";

  // Color swatches (bg + text)
  const swatches = [bg, textColor]
    .filter((c) => c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent" && c !== "#f5f5f5")
    .map(
      (c) =>
        `<span class="card-swatch" style="background:${escAttr(c)};"></span>`
    )
    .join("");

  const previewHTML = clip.image
    ? `<img class="card-screenshot" src="${escAttr(clip.image)}" alt="" />`
    : `<div class="card-preview-inner">
        <span class="card-preview-font" style="font-family:${escAttr(fontName)};">${escHtml(fontName)}</span>
        ${fontSize ? `<span class="card-preview-size">${escHtml(fontSize)}</span>` : ""}
       </div>
       ${swatches ? `<div class="card-swatches">${swatches}</div>` : ""}`;

  const previewStyle = clip.image
    ? ""
    : `style="background:${escAttr(bg)}; color:${escAttr(textColor)};"`;

  return `
    <div class="card" data-id="${escAttr(clip.id)}">
      <div class="card-preview" ${previewStyle}>
        ${previewHTML}
      </div>
      <div class="card-body">
        <div class="card-title">${escHtml(clip.title || "Untitled Capture")}</div>
        <div class="card-tags">
          <span class="tag tag-collection">${escHtml(collection)}</span>
          <span class="tag tag-element">${escHtml(tagName)}</span>
        </div>
        <div class="card-url">${escHtml(domain)}</div>
      </div>
      <div class="card-footer">
        <span class="card-time">${escHtml(timeAgo)}</span>
        <div class="card-actions">
          <button class="card-btn copy">CSS</button>
          <button class="card-btn delete">Delete</button>
        </div>
      </div>
    </div>`;
}

// ── Delete ────────────────────────────────────────────────────────────────────

function deleteClip(id) {
  chrome.storage.local.get(["clips"], (result) => {
    const clips = (result.clips || []).filter((c) => c.id !== id);
    chrome.storage.local.set({ clips }, loadData);
  });
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function openModal(clip) {
  const overlay = document.getElementById("modal-overlay");
  const modal = document.getElementById("modal");

  const s = clip.styles || {};
  const t = s.typography || {};
  const c = s.colors || {};
  const e = s.effects || {};
  const l = s.layout || {};

  const bg =
    c.background && c.background !== "rgba(0, 0, 0, 0)" && c.background !== "transparent"
      ? c.background
      : "#f5f5f5";
  const textColor = c.text || "#555";
  const fontName =
    (t.fontFamily || "").split(",")[0].replace(/"/g, "").trim() || "";

  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${escHtml(clip.title || "Untitled Capture")}</span>
      <button class="modal-close" id="modal-close">✕</button>
    </div>

    ${clip.image
      ? `<img class="modal-screenshot" src="${escAttr(clip.image)}" alt="" />`
      : `<div class="modal-preview" style="background:${escAttr(bg)}; color:${escAttr(textColor)}; font-family:${escAttr(fontName)};">${escHtml(fontName || "—")}</div>`
    }

    <div class="modal-body">

      <div>
        <div class="modal-section-label">Typography</div>
        ${mRow("Font", fontName)}
        ${mRow("Size", t.fontSize)}
        ${mRow("Weight", t.fontWeight)}
        ${mRow("Line height", t.lineHeight)}
        ${mRow("Letter spacing", t.letterSpacing)}
        ${mRow("Align", t.textAlign)}
      </div>

      <div>
        <div class="modal-section-label">Colors</div>
        ${mColorRow("Text", c.text)}
        ${mColorRow("Background", c.background)}
        ${mColorRow("Border", c.border)}
      </div>

      <div>
        <div class="modal-section-label">Layout</div>
        ${mRow("Display", l.display)}
        ${mRow("Padding", l.padding)}
        ${mRow("Margin", l.margin)}
        ${mRow("Width", l.width)}
        ${mRow("Height", l.height)}
        ${mRow("Gap", l.gap)}
        ${mRow("Flex direction", l.flexDirection)}
        ${mRow("Align items", l.alignItems)}
        ${mRow("Justify content", l.justifyContent)}
      </div>

      <div>
        <div class="modal-section-label">Effects</div>
        ${mRow("Border radius", e.borderRadius)}
        ${mRow("Border", [e.borderWidth, e.borderStyle].filter(Boolean).join(" ") || null)}
        ${mRow("Shadow", e.boxShadow === "none" ? "none" : e.boxShadow)}
        ${mRow("Opacity", e.opacity)}
      </div>

      <div>
        <div class="modal-section-label">CSS Export</div>
        <div class="modal-css">${escHtml(generateCSS(s))}</div>
      </div>

      <div>
        <div class="modal-section-label">Tailwind Export</div>
        <div class="modal-tailwind">${escHtml(generateTailwind(s))}</div>
      </div>

      <div>
        <div class="modal-section-label">Source</div>
        <div class="modal-row">
          <span class="modal-key">URL</span>
          <a class="modal-source-link" href="${escAttr(clip.sourceUrl)}" target="_blank" rel="noopener">
            ${escHtml(getDomain(clip.sourceUrl))}
          </a>
        </div>
        ${mRow("Element", s.tagName)}
        ${mRow("Collection", clip.collectionId || "Uncategorized")}
        ${mRow("Saved", clip.savedAt ? new Date(clip.savedAt).toLocaleString() : null)}
      </div>

    </div>

    <div class="modal-footer">
      <button class="btn-danger" id="modal-delete">Delete</button>
      <button class="btn-secondary" id="modal-copy-tw">Copy Tailwind</button>
      <button class="btn-primary" id="modal-copy">Copy CSS</button>
    </div>`;

  overlay.classList.add("open");

  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-copy").addEventListener("click", () => {
    navigator.clipboard.writeText(generateCSS(clip.styles));
    showToast("CSS copied!");
  });

  document.getElementById("modal-copy-tw").addEventListener("click", () => {
    navigator.clipboard.writeText(generateTailwind(clip.styles));
    showToast("Tailwind copied!");
  });
  document.getElementById("modal-delete").addEventListener("click", () => {
    deleteClip(clip.id);
    closeModal();
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
}

function closeModal() {
  document.getElementById("modal-overlay").classList.remove("open");
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

// ── Modal row builders ────────────────────────────────────────────────────────

function mRow(key, val) {
  const v = val || "—";
  return `
    <div class="modal-row">
      <span class="modal-key">${escHtml(key)}</span>
      <span class="modal-val">${escHtml(v)}</span>
    </div>`;
}

function mColorRow(key, rgb) {
  const hex = rgbToHex(rgb);
  const hasColor =
    rgb && rgb !== "rgba(0, 0, 0, 0)" && rgb !== "transparent";
  const swatch = hasColor
    ? `<span class="modal-swatch" style="background:${escAttr(rgb)};"></span>`
    : "";
  return `
    <div class="modal-row">
      <span class="modal-key">${escHtml(key)}</span>
      <span class="modal-val">
        <span class="modal-color-row">${swatch}${escHtml(hex || "—")}</span>
      </span>
    </div>`;
}

// ── Tailwind generator ────────────────────────────────────────────────────────

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
  if (!m) return `shadow-[${shadow.replace(/\s+/g, "_")}]`;
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
  twSpacingClasses(l.padding, "p").forEach(v => cls.push(v));
  twSpacingClasses(l.margin,  "m").forEach(v => cls.push(v));

  // Font family (generic bucket)
  const fname = (t.fontFamily || "").split(",")[0].replace(/"/g, "").trim().toLowerCase();
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
  const lhClass = twLineHeight(t.lineHeight, t.fontSize);
  if (lhClass) cls.push(lhClass);

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

// ── CSS generator ─────────────────────────────────────────────────────────────

function generateCSS(s) {
  if (!s) return "";
  const t = s.typography || {};
  const c = s.colors || {};
  const e = s.effects || {};
  const l = s.layout || {};

  const lines = [".element {"];
  if (t.fontFamily) lines.push(`  font-family: ${t.fontFamily};`);
  if (t.fontSize) lines.push(`  font-size: ${t.fontSize};`);
  if (t.fontWeight) lines.push(`  font-weight: ${t.fontWeight};`);
  if (t.lineHeight) lines.push(`  line-height: ${t.lineHeight};`);
  if (c.text) lines.push(`  color: ${rgbToHex(c.text)};`);
  if (c.background && c.background !== "rgba(0, 0, 0, 0)" && c.background !== "transparent")
    lines.push(`  background-color: ${rgbToHex(c.background)};`);
  if (l.padding && l.padding !== "0px") lines.push(`  padding: ${l.padding};`);
  if (l.margin && l.margin !== "0px") lines.push(`  margin: ${l.margin};`);
  if (e.borderRadius && e.borderRadius !== "0px")
    lines.push(`  border-radius: ${e.borderRadius};`);
  if (e.boxShadow && e.boxShadow !== "none")
    lines.push(`  box-shadow: ${e.boxShadow};`);
  if (e.borderWidth && e.borderWidth !== "0px")
    lines.push(`  border: ${e.borderWidth} ${e.borderStyle || "solid"} ${rgbToHex(c.border) || "currentColor"};`);
  lines.push("}");
  return lines.join("\n");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rgbToHex(rgb) {
  if (!rgb || rgb === "transparent" || rgb === "rgba(0, 0, 0, 0)") return "transparent";
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return rgb;
  return (
    "#" +
    [m[1], m[2], m[3]]
      .map((n) => parseInt(n).toString(16).padStart(2, "0"))
      .join("")
  );
}

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url || "—";
  }
}

function getTimeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function escHtml(str) {
  if (str === null || str === undefined) return "—";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escAttr(str) {
  if (!str) return "";
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function showToast(msg) {
  const existing = document.querySelector(".dash-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "dash-toast";
  toast.textContent = msg;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}
