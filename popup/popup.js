const captureBtn = document.getElementById("capture-btn");
const captureLabel = document.getElementById("capture-label");
const statusDot = document.querySelector(".status-dot");
const statusText = document.getElementById("status-text");
const recentList = document.getElementById("recent-list");
const saveCount = document.getElementById("save-count");

let isCapturing = false;

// Toggle capture mode
captureBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  isCapturing = !isCapturing;

  if (isCapturing) {
    captureBtn.classList.add("active");
    captureLabel.textContent = "Stop Capturing";
    statusDot.className = "status-dot active";
    statusText.textContent = "Capture mode active";

    chrome.tabs.sendMessage(tab.id, { action: "startCapture" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error:", chrome.runtime.lastError);
        isCapturing = false;
        captureBtn.classList.remove("active");
        captureLabel.textContent = "Start Capturing";
        statusDot.className = "status-dot idle";
        statusText.textContent = "Error: Could not reach page";
        return;
      }
      console.log("Capture started successfully");
      setTimeout(() => window.close(), 200);
    });
  } else {
    captureBtn.classList.remove("active");
    captureLabel.textContent = "Start Capturing";
    statusDot.className = "status-dot idle";
    statusText.textContent = "Ready to capture";
    chrome.tabs.sendMessage(tab.id, { action: "stopCapture" }, () => void chrome.runtime.lastError);
  }
});

// Open dashboard
document.getElementById("open-dashboard").addEventListener("click", openDashboard);
document.getElementById("open-dashboard-footer").addEventListener("click", openDashboard);

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/index.html") });
}

// Load recent saves from storage
function loadRecent() {
  chrome.storage.local.get(["clips"], (result) => {
    const clips = result.clips || [];
    saveCount.textContent = clips.length;

    if (clips.length === 0) return;

    recentList.innerHTML = "";
    const recent = clips.slice(-3).reverse();

    recent.forEach((clip) => {
      const item = document.createElement("div");
      item.className = "recent-item";

      const thumb = document.createElement("img");
      thumb.className = "recent-thumb";
      thumb.src = clip.image || "";
      thumb.alt = "";

      const info = document.createElement("div");
      info.className = "recent-info";

      const title = document.createElement("div");
      title.className = "recent-title";
      title.textContent = clip.title || "Untitled Capture";

      const meta = document.createElement("div");
      meta.className = "recent-meta";
      meta.textContent = clip.collectionId || "Uncategorized";

      info.appendChild(title);
      info.appendChild(meta);
      item.appendChild(thumb);
      item.appendChild(info);
      recentList.appendChild(item);
    });
  });
}

// Sync capture state from background on open
chrome.storage.local.get(["capturing"], (result) => {
  if (result.capturing) {
    isCapturing = true;
    captureBtn.classList.add("active");
    captureLabel.textContent = "Stop Capturing";
    statusDot.className = "status-dot active";
    statusText.textContent = "Capture mode active";
  }
});

loadRecent();
