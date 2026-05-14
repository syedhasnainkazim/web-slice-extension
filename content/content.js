let capturing = false;
let hoveredEl = null;
let tooltip = null;
let previewPanel = null;
let tooltipPreviewTimer = null;
let cachedTooltipScreenshot = null;

// Capture state
let captureElements = [];
let panelState = "none"; // "none" | "capture" | "preview"
let dragEl = null;
let dragStartX = 0, dragStartY = 0;
let isDragging = false;

console.log("[Decova] Content script loaded");

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[Decova] Message received:", msg.action);
  if (msg.action === "ping") {
    sendResponse({ success: true });
  }
  if (msg.action === "startCapture") {
    startCapture();
    chrome.runtime.sendMessage({ action: "startCapture" });
    sendResponse({ success: true });
  }
  if (msg.action === "stopCapture") {
    stopCapture();
    chrome.runtime.sendMessage({ action: "stopCapture" });
    sendResponse({ success: true });
  }
});

// ─── Capture mode on/off ──────────────────────────────────────────────────────

function startCapture() {
  try {
    capturing = true;
    console.log("[Decova] Capture mode started");
    document.body.classList.add("decova-active");

    if (!document.getElementById("decova-cursor-style")) {
      const s = document.createElement("style");
      s.id = "decova-cursor-style";
      s.textContent = "*, *::before, *::after { cursor: crosshair !important; }";
      document.head.appendChild(s);
    }

    createTooltip();
    document.addEventListener("mouseover", onMouseOver);
    document.addEventListener("mouseout", onMouseOut);
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown);
    console.log("[Decova] All event listeners attached");
  } catch (err) {
    console.error("[Decova] Error in startCapture:", err);
    capturing = false;
  }
}

function stopCapture() {
  capturing = false;
  clearTimeout(tooltipPreviewTimer);
  document.body.classList.remove("decova-active");
  document.getElementById("decova-cursor-style")?.remove();
  clearHighlight();
  removeTooltip();
  closeCapturePanel(false);
  if (dragEl) { dragEl.remove(); dragEl = null; }
  document.removeEventListener("mouseover", onMouseOver);
  document.removeEventListener("mouseout", onMouseOut);
  document.removeEventListener("mousedown", onMouseDown, true);
  document.removeEventListener("mousemove", onDragMove, true);
  document.removeEventListener("mouseup", onMouseUp, true);
  document.removeEventListener("keydown", onKeyDown);
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function createTooltip() {
  if (tooltip) return;
  tooltip = document.createElement("div");
  tooltip.className = "decova-tooltip";
  tooltip.innerHTML = `<span class="decova-tooltip-hint">Hover an element to preview</span>`;
  document.body.appendChild(tooltip);
}

function updateTooltip(el) {
  if (!tooltip) return;
  const s = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const tag = el.tagName.toLowerCase();
  const bg = s.backgroundColor;
  const textColor = s.color;
  const fontFamily = s.fontFamily.split(",")[0].replace(/"/g, "").trim();
  const fontSize = s.fontSize;
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  const hasBg = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";

  tooltip.innerHTML = `
    <div class="decova-tooltip-preview-wrap">
      <div class="decova-tooltip-preview-loading">Loading preview…</div>
    </div>
    <div class="decova-tooltip-row decova-tooltip-tag">&lt;${tag}&gt; &middot; ${w}&times;${h}px</div>
    <div class="decova-tooltip-row decova-tooltip-swatches">
      ${hasBg ? `<span class="decova-tooltip-swatch" style="background:${bg}"></span>` : ""}
      <span class="decova-tooltip-swatch" style="background:${textColor}"></span>
      <span class="decova-tooltip-font">${fontFamily} &middot; ${fontSize}</span>
    </div>
    <div class="decova-tooltip-hint">Click or drag to capture &middot; Esc to stop</div>
  `;

  clearTimeout(tooltipPreviewTimer);
  tooltipPreviewTimer = setTimeout(() => {
    if (!tooltip || !capturing) return;
    const freshRect = el.getBoundingClientRect();
    tooltip.style.visibility = "hidden";
    try {
      chrome.runtime.sendMessage({ action: "captureTab" }, (response) => {
        if (tooltip) tooltip.style.visibility = "";
        if (chrome.runtime.lastError || !response?.dataUrl) return;

        const dpr = window.devicePixelRatio || 1;
        const sx = Math.round(freshRect.left * dpr);
        const sy = Math.round(freshRect.top * dpr);
        const sw = Math.round(freshRect.width * dpr);
        const sh = Math.round(freshRect.height * dpr);
        if (sw < 1 || sh < 1) return;

        const maxW = 240;
        const scale = Math.min(maxW / sw, 1);
        const dw = Math.max(1, Math.round(sw * scale));
        const dh = Math.max(1, Math.round(sh * scale));

        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = dw;
          canvas.height = dh;
          canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
          cachedTooltipScreenshot = { el, dataUrl };
          if (!tooltip) return;
          const wrap = tooltip.querySelector(".decova-tooltip-preview-wrap");
          if (wrap) {
            wrap.innerHTML = `<img class="decova-tooltip-preview-img" src="${dataUrl}" style="width:${dw}px;height:${dh}px;" />`;
          }
        };
        img.src = response.dataUrl;
      });
    } catch (e) {
      if (tooltip) tooltip.style.visibility = "";
    }
  }, 200);
}

function resetTooltip() {
  clearTimeout(tooltipPreviewTimer);
  if (!tooltip) return;
  tooltip.innerHTML = `<span class="decova-tooltip-hint">Hover an element to preview</span>`;
}

function removeTooltip() {
  if (tooltip) { tooltip.remove(); tooltip = null; }
}

document.addEventListener("mousemove", (e) => {
  if (!tooltip) return;
  const tw = tooltip.offsetWidth || 260;
  const th = tooltip.offsetHeight || 200;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const x = e.clientX + 16 + tw > vw ? e.clientX - tw - 8 : e.clientX + 16;
  const y = e.clientY + 16 + th > vh ? e.clientY - th - 8 : e.clientY + 16;
  tooltip.style.left = x + "px";
  tooltip.style.top  = y + "px";
});

// ─── Hover highlight ──────────────────────────────────────────────────────────

function onMouseOver(e) {
  const el = smartSelect(e.target);
  if (!el || el === document.body || el === document.documentElement) return;
  if (hoveredEl === el) return;
  clearHighlight();
  hoveredEl = el;
  hoveredEl.classList.add("decova-highlight");
  updateTooltip(el);
}

function onMouseOut(e) {
  if (e.relatedTarget) {
    const next = smartSelect(e.relatedTarget);
    if (next && next === hoveredEl) return;
  }
  clearTimeout(tooltipPreviewTimer);
  cachedTooltipScreenshot = null;
  clearHighlight();
  resetTooltip();
}

function clearHighlight() {
  if (hoveredEl) {
    hoveredEl.classList.remove("decova-highlight");
    hoveredEl = null;
  }
}

// ─── Smart element selection ──────────────────────────────────────────────────

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

  if (rect.width < 20 || rect.height < 20) return false;

  const bg = styles.backgroundColor;
  const border = styles.borderWidth;
  const shadow = styles.boxShadow;
  const hasVisualStyle =
    (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") ||
    (border && border !== "0px") ||
    (shadow && shadow !== "none");

  if (hasVisualStyle) return true;

  if (el.childNodes.length > 0) {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) return true;
    }
  }

  return false;
}

// ─── Mouse drag / click capture ───────────────────────────────────────────────

function onMouseDown(e) {
  if (!capturing) return;
  if (panelState !== "none") return;
  if (e.target.closest(".dcv-panel") || e.target.closest(".decova-tooltip")) return;

  e.preventDefault();
  e.stopPropagation();

  dragStartX = e.clientX;
  dragStartY = e.clientY;
  isDragging = false;

  dragEl = document.createElement("div");
  dragEl.className = "dcv-drag-rect";
  dragEl.style.left = e.clientX + "px";
  dragEl.style.top = e.clientY + "px";
  dragEl.style.width = "0px";
  dragEl.style.height = "0px";
  document.body.appendChild(dragEl);

  document.addEventListener("mousemove", onDragMove, true);
  document.addEventListener("mouseup", onMouseUp, true);
}

function onDragMove(e) {
  if (!dragEl) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  if (!isDragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) isDragging = true;
  if (!isDragging) return;
  dragEl.style.left = (dx < 0 ? e.clientX : dragStartX) + "px";
  dragEl.style.top  = (dy < 0 ? e.clientY : dragStartY) + "px";
  dragEl.style.width  = Math.abs(dx) + "px";
  dragEl.style.height = Math.abs(dy) + "px";
}

function onMouseUp(e) {
  document.removeEventListener("mousemove", onDragMove, true);
  document.removeEventListener("mouseup", onMouseUp, true);
  if (dragEl) { dragEl.remove(); dragEl = null; }

  const dx = Math.abs(e.clientX - dragStartX);
  const dy = Math.abs(e.clientY - dragStartY);

  clearTimeout(tooltipPreviewTimer);
  clearHighlight();
  removeTooltip();
  document.removeEventListener("mouseover", onMouseOver);
  document.removeEventListener("mouseout", onMouseOut);

  if (!isDragging || (dx < 5 && dy < 5)) {
    // Single click — capture element under cursor
    const el = smartSelect(e.target);
    if (!el) { resumeHover(); return; }
    const styles = extractStyles(el);
    captureElementScreenshot(el, (imgUrl) => {
      captureElements = [{ el, styles, imageDataUrl: imgUrl }];
      showCapturePanel();
    });
  } else {
    // Rect drag — detect all meaningful elements in selection
    const rx = Math.min(dragStartX, e.clientX);
    const ry = Math.min(dragStartY, e.clientY);
    if (dx < 10 || dy < 10) { resumeHover(); return; }
    const detected = detectElementsInRect(rx, ry, dx, dy);
    if (!detected.length) { resumeHover(); return; }
    takeAreaScreenshot({ x: rx, y: ry, w: dx, h: dy }, (imgUrl) => {
      captureElements = detected.map(el => ({ el, styles: extractStyles(el), imageDataUrl: imgUrl }));
      showCapturePanel();
    });
  }
}

function detectElementsInRect(rx, ry, rw, rh) {
  const results = [];
  document.querySelectorAll("*").forEach(el => {
    if (el.closest(".dcv-panel") || el.closest(".decova-tooltip")) return;
    if (!isMeaningful(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return;
    const ox = Math.max(0, Math.min(rx + rw, r.right) - Math.max(rx, r.left));
    const oy = Math.max(0, Math.min(ry + rh, r.bottom) - Math.max(ry, r.top));
    const overlap = ox * oy;
    if (r.width * r.height > 0 && overlap / (r.width * r.height) >= 0.35) results.push(el);
  });
  // Keep only leaf elements (remove ancestors whose descendants are also selected)
  return results
    .filter(el => !results.some(other => other !== el && el.contains(other)))
    .slice(0, 6);
}

function takeAreaScreenshot(rect, callback) {
  try {
    chrome.runtime.sendMessage({ action: "captureTab" }, (response) => {
      if (chrome.runtime.lastError || !response?.dataUrl) { callback(null); return; }
      const img = new Image();
      img.onload = () => {
        const dpr = window.devicePixelRatio || 1;
        const sx = Math.round(rect.x * dpr);
        const sy = Math.round(rect.y * dpr);
        const sw = Math.round(rect.w * dpr);
        const sh = Math.round(rect.h * dpr);
        if (sw < 1 || sh < 1) { callback(null); return; }
        const maxW = 600;
        const scale = sw > maxW ? maxW / sw : 1;
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
  } catch (e) { callback(null); }
}

// ─── Keyboard ─────────────────────────────────────────────────────────────────

function onKeyDown(e) {
  if (e.key === "Escape") {
    if (previewPanel) {
      closeCapturePanel(true);
    } else {
      stopCapture();
      try { chrome.runtime.sendMessage({ action: "captureStopped" }); } catch (err) {}
    }
  }
  if (e.key === "ArrowUp" && hoveredEl && hoveredEl.parentElement) {
    e.preventDefault();
    clearHighlight();
    hoveredEl = hoveredEl.parentElement;
    hoveredEl.classList.add("decova-highlight");
    updateTooltip(hoveredEl);
  }
}

// ─── Resume hover after panel closed ─────────────────────────────────────────

function resumeHover() {
  if (!capturing) return;
  document.addEventListener("mouseover", onMouseOver);
  document.addEventListener("mouseout", onMouseOut);
  createTooltip();
}

// ─── Capture panel — CAPTURE state ───────────────────────────────────────────

function showCapturePanel() {
  panelState = "capture";

  const img = captureElements.length > 0 ? captureElements[0].imageDataUrl : null;
  const imgHtml = img
    ? `<img class="dcv-screenshot-img" src="${img}" alt="" />`
    : `<div style="height:100px;display:flex;align-items:center;justify-content:center;color:#888;font-size:11px;font-family:inherit;">No preview</div>`;

  const badges = captureElements.map((item, i) => {
    const b = getElBadge(item.styles.tagName);
    return `<div class="dcv-el-badge" style="top:${6 + i * 22}px;left:6px;background:${b.color};">&lt;${b.label}&gt;</div>`;
  }).join("");

  const countText = captureElements.length === 1
    ? "1 element captured"
    : `${captureElements.length} elements captured`;

  const html = `
    <div class="dcv-header">
      <span class="dcv-header-title">✦ DECOVA</span>
      <div class="dcv-header-icons">
        <button class="dcv-icon-btn" id="dcv-close">✕</button>
      </div>
    </div>
    <div class="dcv-screenshot-wrap">
      <div class="dcv-screenshot-inner">
        ${imgHtml}
        ${badges}
      </div>
    </div>
    <div class="dcv-count-bar">
      <span class="dcv-count-text">${countText}</span>
      <div class="dcv-capture-btns">
        <button class="dcv-btn-secondary" id="dcv-redrag">Re-drag</button>
        <button class="dcv-btn-primary" id="dcv-confirm-capture">Confirm →</button>
      </div>
    </div>
  `;

  if (!previewPanel) {
    previewPanel = document.createElement("div");
    previewPanel.className = "dcv-panel";
    previewPanel.innerHTML = html;
    document.body.appendChild(previewPanel);
    requestAnimationFrame(() => previewPanel.classList.add("visible"));
  } else {
    previewPanel.innerHTML = html;
  }
  setupPanelDrag(previewPanel);

  previewPanel.querySelector("#dcv-close").addEventListener("click", () => closeCapturePanel(true));
  previewPanel.querySelector("#dcv-redrag").addEventListener("click", () => {
    closeCapturePanel(false);
    resumeHover();
  });
  previewPanel.querySelector("#dcv-confirm-capture").addEventListener("click", transitionToPreview);
}

// ─── Capture panel — PREVIEW state ───────────────────────────────────────────

function transitionToPreview() {
  if (!previewPanel) return;
  panelState = "preview";

  const count = captureElements.length;
  const elRows = captureElements.map((item, i) => {
    const b = getElBadge(item.styles.tagName);
    const codeBlock = buildCSSCodeBlock(item.styles);
    return `
      <div class="dcv-el-row" data-idx="${i}">
        <div class="dcv-el-row-header">
          <input type="checkbox" class="dcv-el-check" checked data-idx="${i}" />
          <span class="dcv-el-expand">›</span>
          <span class="dcv-el-spacer"></span>
          <span class="dcv-tag-badge" style="background:${b.color}">${b.label}</span>
        </div>
        <div class="dcv-el-details">${codeBlock}</div>
      </div>
    `;
  }).join("");

  previewPanel.innerHTML = `
    <div class="dcv-header">
      <button class="dcv-back-btn" id="dcv-back">&lt; PREVIEW</button>
      <div class="dcv-header-icons">
        <button class="dcv-icon-btn" id="dcv-settings" title="Settings">⚙</button>
        <button class="dcv-icon-btn" id="dcv-close">✕</button>
      </div>
    </div>
    <div class="dcv-detected-count">${count} Item(s) Detected</div>
    <div class="dcv-body">
      <div class="dcv-element-list">${elRows}</div>
      <div class="dcv-section">
        <div class="dcv-section-label">Save Options</div>
        <div class="dcv-save-option" data-mode="individual">
          <input type="radio" name="dcv-save-mode" value="individual" />
          <div>
            <div class="dcv-option-title">Save as individual(s)</div>
            <div class="dcv-option-desc">Individual reusable component(s)</div>
          </div>
        </div>
        <div class="dcv-save-option active" data-mode="group">
          <input type="radio" name="dcv-save-mode" value="group" checked />
          <div>
            <div class="dcv-option-title">Save as group</div>
            <div class="dcv-option-desc">One clip with all elements linked together</div>
          </div>
        </div>
      </div>
      <div class="dcv-section">
        <div class="dcv-section-label">Save To</div>
        <button class="dcv-coll-trigger" id="dcv-coll-trigger">
          <span id="dcv-coll-label">Select Collection</span>
          <span class="dcv-coll-arrow">▾</span>
        </button>
        <div class="dcv-coll-dropdown" id="dcv-coll-dropdown"></div>
      </div>
    </div>
    <div class="dcv-footer">
      <button class="dcv-confirm-btn ready" id="dcv-save-btn">Confirm</button>
    </div>
  `;

  setupPanelDrag(previewPanel);
  previewPanel.querySelector("#dcv-close").addEventListener("click", () => closeCapturePanel(true));

  previewPanel.querySelector("#dcv-back").addEventListener("click", () => {
    panelState = "capture";
    showCapturePanel();
  });

  previewPanel.querySelectorAll(".dcv-el-row-header").forEach(header => {
    header.addEventListener("click", e => {
      if (e.target.classList.contains("dcv-el-check")) return;
      header.closest(".dcv-el-row").classList.toggle("expanded");
    });
  });

  previewPanel.querySelectorAll(".dcv-save-option").forEach(opt => {
    opt.addEventListener("click", () => {
      previewPanel.querySelectorAll(".dcv-save-option").forEach(o => o.classList.remove("active"));
      opt.classList.add("active");
      opt.querySelector("input[type=radio]").checked = true;
    });
  });

  populateCollectionDropdown();

  const trigger = previewPanel.querySelector("#dcv-coll-trigger");
  const dropdown = previewPanel.querySelector("#dcv-coll-dropdown");
  trigger.addEventListener("click", () => {
    const open = dropdown.classList.toggle("open");
    trigger.classList.toggle("open", open);
  });

  previewPanel.querySelector("#dcv-save-btn").addEventListener("click", doSave);
}

function populateCollectionDropdown() {
  try {
    chrome.storage.local.get(["collections", "clips", "lastCollection"], (result) => {
      if (!previewPanel) return;
      const dropdown = previewPanel.querySelector("#dcv-coll-dropdown");
      const trigger = previewPanel.querySelector("#dcv-coll-trigger");
      const label = previewPanel.querySelector("#dcv-coll-label");
      if (!dropdown || !trigger || !label) return;

      const clips = result.clips || [];
      const named = result.collections || [];
      const collIds = clips.map(c => c.collectionId).filter(c => c && c !== "Uncategorized");
      const all = [...new Set([...named, ...collIds])].sort();
      const defaultId = result.lastCollection || (all.length > 0 ? all[0] : "Uncategorized");

      const items = [
        { id: "Uncategorized", name: "Uncategorized" },
        ...all.map(name => ({ id: name, name })),
      ];

      dropdown.innerHTML =
        `<div class="dcv-coll-item create-new" data-id="__new__">
          <input type="checkbox" />
          <span class="dcv-coll-item-name">Create New Collection...</span>
        </div>` +
        items.map(item => {
          const checked = item.id === defaultId ? " checked" : "";
          return `<div class="dcv-coll-item${item.id === defaultId ? " selected" : ""}" data-id="${item.id.replace(/"/g, "&quot;")}">
            <input type="checkbox"${checked} />
            <span class="dcv-coll-item-name">${sanitize(item.name)}</span>
          </div>`;
        }).join("");

      const def = items.find(i => i.id === defaultId) || items[0];
      if (def) {
        label.textContent = def.name;
        trigger.classList.add("selected");
        trigger.dataset.selected = def.id;
      }

      dropdown.querySelectorAll(".dcv-coll-item").forEach(item => {
        item.addEventListener("click", () => {
          const id = item.dataset.id;
          if (id === "__new__") {
            const inp = document.createElement("input");
            inp.className = "dcv-new-coll-input";
            inp.placeholder = "Collection name…";
            dropdown.appendChild(inp);
            inp.focus();
            inp.addEventListener("keydown", ev => {
              if (ev.key === "Enter") {
                const val = inp.value.trim();
                if (!val) return;
                inp.remove();
                const newItem = document.createElement("div");
                newItem.className = "dcv-coll-item";
                newItem.dataset.id = val;
                newItem.innerHTML = `<input type="checkbox" /><span class="dcv-coll-item-name">${sanitize(val)}</span>`;
                dropdown.insertBefore(newItem, item.nextSibling);
                selectCollection(newItem, val, label, trigger, dropdown);
                newItem.addEventListener("click", () => selectCollection(newItem, val, label, trigger, dropdown));
              }
              if (ev.key === "Escape") { inp.remove(); }
            });
            return;
          }
          selectCollection(item, id, label, trigger, dropdown);
        });
      });
    });
  } catch (e) {}
}

function selectCollection(item, id, label, trigger, dropdown) {
  dropdown.querySelectorAll(".dcv-coll-item").forEach(i => {
    i.classList.remove("selected");
    const cb = i.querySelector("input[type=checkbox]");
    if (cb) cb.checked = false;
  });
  item.classList.add("selected");
  const cb = item.querySelector("input[type=checkbox]");
  if (cb) cb.checked = true;
  label.textContent = item.querySelector(".dcv-coll-item-name").textContent;
  trigger.dataset.selected = id;
  trigger.classList.add("selected");
  dropdown.classList.remove("open");
  trigger.classList.remove("open");
}

function doSave() {
  if (!previewPanel) return;
  const trigger = previewPanel.querySelector("#dcv-coll-trigger");
  const collectionId = trigger?.dataset.selected || "Uncategorized";
  const saveMode = previewPanel.querySelector(".dcv-save-option.active")?.dataset.mode || "individual";

  const checkedIdxs = new Set();
  previewPanel.querySelectorAll(".dcv-el-check").forEach(cb => {
    if (cb.checked) checkedIdxs.add(parseInt(cb.dataset.idx));
  });

  const toSave = captureElements.filter((_, i) => checkedIdxs.has(i));
  if (!toSave.length) { showToast("No elements selected"); return; }

  try {
    chrome.storage.local.get(["clips", "collections"], (result) => {
      const clips = result.clips || [];
      const collections = result.collections || [];
      if (collectionId !== "Uncategorized" && !collections.includes(collectionId)) {
        collections.push(collectionId);
      }

      if (saveMode === "group") {
        const first = toSave[0];
        const { image, ...styles } = first.styles;
        clips.push({
          id: Date.now().toString(),
          title: "Captured group",
          collectionId,
          styles: { ...styles, tagNames: toSave.flatMap(i => i.styles.tagNames || [i.styles.tagName]) },
          sourceUrl: window.location.href,
          savedAt: new Date().toISOString(),
          image: first.imageDataUrl || null,
        });
      } else {
        toSave.forEach((item, idx) => {
          const { image, ...styles } = item.styles;
          clips.push({
            id: (Date.now() + idx).toString(),
            title: `<${item.styles.tagName}>`,
            collectionId,
            styles,
            sourceUrl: window.location.href,
            savedAt: new Date().toISOString(),
            image: item.imageDataUrl || null,
          });
        });
      }

      try {
        chrome.storage.local.set({ clips, collections, lastCollection: collectionId }, () => {
          const n = saveMode === "group" ? 1 : toSave.length;
          stopCapture();
          try { chrome.runtime.sendMessage({ action: "captureStopped" }); } catch (err) {}
          showToast(n === 1 ? `Saved to ${collectionId} ✓` : `${n} clips saved to ${collectionId} ✓`);
        });
      } catch (e) { stopCapture(); try { chrome.runtime.sendMessage({ action: "captureStopped" }); } catch (err) {} }
    });
  } catch (e) { stopCapture(); try { chrome.runtime.sendMessage({ action: "captureStopped" }); } catch (err) {} }
}

function closeCapturePanel(resume) {
  if (!previewPanel) {
    if (resume) resumeHover();
    return;
  }
  previewPanel._cleanupDrag?.();
  previewPanel.classList.remove("visible");
  const panel = previewPanel;
  previewPanel = null;
  panelState = "none";
  setTimeout(() => {
    panel?.remove();
    if (resume) resumeHover();
  }, 200);
}

function setupPanelDrag(panel) {
  panel._cleanupDrag?.();
  let panelDragging = false;
  let offX = 0, offY = 0;
  const header = panel.querySelector(".dcv-header");
  if (!header) return;

  function onStart(e) {
    if (e.target.closest(".dcv-icon-btn") || e.target.closest(".dcv-back-btn")) return;
    e.preventDefault();
    e.stopPropagation();
    const r = panel.getBoundingClientRect();
    panel.style.transition = "none";
    panel.style.top = r.top + "px";
    panel.style.right = "auto";
    panel.style.left = r.left + "px";
    panel.style.transform = "none";
    offX = e.clientX - r.left;
    offY = e.clientY - r.top;
    panelDragging = true;
    header.style.cursor = "grabbing";
  }

  function onMove(e) {
    if (!panelDragging) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    panel.style.left = Math.max(0, Math.min(vw - pw, e.clientX - offX)) + "px";
    panel.style.top  = Math.max(0, Math.min(vh - ph, e.clientY - offY)) + "px";
  }

  function onEnd() {
    if (!panelDragging) return;
    panelDragging = false;
    header.style.cursor = "grab";
  }

  header.addEventListener("mousedown", onStart);
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onEnd);
  panel._cleanupDrag = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onEnd);
  };
}

// ─── Element helpers ──────────────────────────────────────────────────────────

function getElBadge(tagName) {
  const t = (tagName || "").toLowerCase();
  if (/^h[1-6]$/.test(t)) return { label: t.toUpperCase(), color: "#22c55e" };
  if (t === "p" || t === "span" || t === "div") return { label: t, color: "#60a5fa" };
  if (t === "section" || t === "article" || t === "nav" || t === "header" || t === "footer")
    return { label: t, color: "#60a5fa" };
  if (t === "button" || t === "input" || t === "form" || t === "select" || t === "textarea")
    return { label: t, color: "#fb923c" };
  if (t === "a") return { label: "a", color: "#a78bfa" };
  if (t === "img" || t === "picture" || t === "svg") return { label: t, color: "#34d399" };
  return { label: t || "tag", color: "#fb923c" };
}


function buildCSSCodeBlock(styles) {
  const t = styles.typography || {};
  const c = styles.colors || {};
  const e = styles.effects || {};
  const l = styles.layout || {};

  function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  const all = [
    t.fontSize        && ["font-size",        t.fontSize],
    t.fontFamily      && ["font-family",       t.fontFamily.split(",")[0].trim().replace(/"/g,"'")],
    t.fontWeight      && ["font-weight",       t.fontWeight],
    t.lineHeight && t.lineHeight !== "normal" && ["line-height", t.lineHeight],
    t.letterSpacing && t.letterSpacing !== "normal" && ["letter-spacing", t.letterSpacing],
    c.text            && ["color",             rgbToHex(c.text)],
    c.background && c.background !== "rgba(0, 0, 0, 0)" && ["background-color", rgbToHex(c.background)],
    l.display && l.display !== "block"        && ["display",           l.display],
    l.padding && l.padding !== "0px"          && ["padding",           l.padding],
    l.gap && l.gap !== "normal" && l.gap !== "0px" && ["gap",          l.gap],
    e.borderRadius && e.borderRadius !== "0px" && ["border-radius",    e.borderRadius],
    e.borderWidth && e.borderWidth !== "0px"  && ["border-width",      e.borderWidth],
    e.boxShadow && e.boxShadow !== "none"     && ["box-shadow",        e.boxShadow.slice(0, 80)],
  ].filter(Boolean);

  if (!all.length) return `<pre class="dcv-code-pre" style="color:#555;">/* no styles */</pre>`;

  // Group into blocks of 3-4 props each
  const tag = styles.tagName || "el";
  const blocks = [];
  for (let i = 0; i < all.length; i += 3) blocks.push(all.slice(i, i + 3));

  return blocks.map((group, bi) => {
    const lines = group.map(([name, val]) =>
      `  <span style="color:#f472b6">${esc(name)}</span><span style="color:#777">:</span> <span style="color:#a3e635">${esc(val)}</span><span style="color:#777">;</span>`
    ).join("\n");
    return `<pre class="dcv-code-pre"><span style="color:#60a5fa">.${esc(tag)}-${bi + 1}</span> <span style="color:#777">{</span>\n${lines}\n<span style="color:#777">}</span></pre>`;
  }).join("\n");
}

// ─── Style extraction ─────────────────────────────────────────────────────────

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
    tagNames: [
      el.tagName.toLowerCase(),
      ...[...new Set(Array.from(el.children).map(c => c.tagName.toLowerCase()))]
        .filter(t => t !== el.tagName.toLowerCase())
        .slice(0, 4),
    ],
    classList: Array.from(el.classList).slice(0, 5),
  };
}

// ─── Screenshot capture ───────────────────────────────────────────────────────

function captureElementScreenshot(el, callback) {
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) { callback(null); return; }
  if (cachedTooltipScreenshot && cachedTooltipScreenshot.el === el) {
    callback(cachedTooltipScreenshot.dataUrl);
    return;
  }
  if (tooltip) tooltip.style.visibility = "hidden";
  try {
    chrome.runtime.sendMessage({ action: "captureTab" }, (response) => {
      if (tooltip) tooltip.style.visibility = "";
      if (chrome.runtime.lastError || !response?.dataUrl) { callback(null); return; }
      const img = new Image();
      img.onload = () => {
        const dpr = window.devicePixelRatio || 1;
        const sx = Math.round(rect.left * dpr);
        const sy = Math.round(rect.top * dpr);
        const sw = Math.round(rect.width * dpr);
        const sh = Math.round(rect.height * dpr);
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
  } catch (e) {
    if (tooltip) tooltip.style.visibility = "";
    callback(null);
  }
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
  return String(str).replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
