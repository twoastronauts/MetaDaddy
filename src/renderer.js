const state = {
  current: null,
  activeTab: "overview",
  search: ""
};

const elements = {
  appInfo: document.getElementById("appInfo"),
  selectButton: document.getElementById("selectButton"),
  exportButton: document.getElementById("exportButton"),
  revealButton: document.getElementById("revealButton"),
  dropZone: document.getElementById("dropZone"),
  workspace: document.getElementById("workspace"),
  previewStage: document.getElementById("previewStage"),
  overviewPanel: document.getElementById("overviewPanel"),
  tabs: [...document.querySelectorAll(".tab")],
  toolbar: document.querySelector(".toolbar"),
  searchInput: document.getElementById("searchInput"),
  metadataCount: document.getElementById("metadataCount"),
  tabOverview: document.getElementById("tabOverview"),
  tabExif: document.getElementById("tabExif"),
  tabFfprobe: document.getElementById("tabFfprobe"),
  tabWrite: document.getElementById("tabWrite"),
  writeForm: document.getElementById("writeForm"),
  sidecarJsonButton: document.getElementById("sidecarJsonButton"),
  sidecarXmpButton: document.getElementById("sidecarXmpButton"),
  writeCopyButton: document.getElementById("writeCopyButton"),
  toast: document.getElementById("toast")
};

window.metaDaddy.getAppInfo().then((info) => {
  elements.appInfo.textContent = `${info.version} for ${info.platform}`;
});

elements.selectButton.addEventListener("click", async () => {
  await runTask("Reading metadata", async () => {
    const result = await window.metaDaddy.selectFile();
    if (!result.canceled) setCurrent(result);
  });
});

elements.exportButton.addEventListener("click", async () => {
  if (!state.current) return;
  await runTask("Exporting JSON", async () => {
    const result = await window.metaDaddy.exportJson({
      filePath: state.current.file.path,
      metadata: buildExportPayload()
    });
    if (!result.canceled) showToast(`Exported ${result.path}`);
  });
});

elements.revealButton.addEventListener("click", () => {
  if (state.current) window.metaDaddy.revealPath(state.current.file.path);
});

elements.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    state.activeTab = tab.dataset.tab;
    renderTabs();
  });
});

elements.searchInput.addEventListener("input", () => {
  state.search = elements.searchInput.value.trim().toLowerCase();
  renderActivePanel();
});

document.addEventListener("dragenter", handleDragOver);
document.addEventListener("dragover", handleDragOver);
document.addEventListener("dragleave", (event) => {
  if (event.target === document.body || event.clientX <= 0 || event.clientY <= 0) {
    setDragging(false);
  }
});

document.addEventListener("drop", async (event) => {
  event.preventDefault();
  setDragging(false);
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;

  const filePath = window.metaDaddy.getDroppedFilePath(file) || file.path;
  if (!filePath) {
    showToast("Could not read that dropped file path. Use Select File instead.", true);
    return;
  }

  await runTask("Reading metadata", async () => {
    const result = await window.metaDaddy.analyzePath(filePath);
    setCurrent(result);
  });
});

elements.sidecarJsonButton.addEventListener("click", async () => saveSidecar("json"));
elements.sidecarXmpButton.addEventListener("click", async () => saveSidecar("xmp"));
elements.writeCopyButton.addEventListener("click", async () => {
  if (!state.current) return;
  const edits = getWriteFormValues();
  if (Object.keys(edits).length === 0) {
    showToast("Add at least one metadata value first.", true);
    return;
  }

  await runTask("Writing embedded copy", async () => {
    const result = await window.metaDaddy.writeEmbeddedCopy({
      filePath: state.current.file.path,
      edits
    });
    if (!result.canceled) showToast(`Created copy ${result.path}`);
  });
});

async function saveSidecar(format) {
  if (!state.current) return;
  const edits = getWriteFormValues();
  if (Object.keys(edits).length === 0) {
    showToast("Add at least one metadata value first.", true);
    return;
  }

  await runTask(`Creating ${format.toUpperCase()} sidecar`, async () => {
    const result = await window.metaDaddy.createSidecar({
      filePath: state.current.file.path,
      format,
      edits
    });
    showToast(`Created ${result.path}`);
  });
}

function handleDragOver(event) {
  event.preventDefault();
  setDragging(true);
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function setDragging(isDragging) {
  elements.dropZone.classList.toggle("dragging", isDragging);
  elements.workspace.classList.toggle("dragging", isDragging);
}

function setCurrent(result) {
  state.current = result;
  state.activeTab = "overview";
  state.search = "";
  elements.searchInput.value = "";
  elements.dropZone.classList.add("hidden");
  elements.workspace.classList.remove("hidden");
  elements.exportButton.disabled = false;
  elements.revealButton.disabled = false;
  renderAll();
}

function renderAll() {
  renderPreview();
  renderOverviewRail();
  renderWriteForm();
  renderTabs();
}

function renderPreview() {
  const preview = state.current?.preview;
  if (!preview?.dataUrl) {
    elements.previewStage.innerHTML = '<div class="preview-empty">No preview</div>';
    return;
  }

  const img = document.createElement("img");
  img.src = preview.dataUrl;
  img.alt = `Preview for ${state.current.file.name}`;
  elements.previewStage.replaceChildren(img);
}

function renderOverviewRail() {
  const rows = [
    ["Name", state.current.file.name],
    ["Kind", state.current.file.kind],
    ["Size", formatBytes(state.current.file.size)],
    ["Modified", formatDate(state.current.file.modifiedAt)],
    ["Path", state.current.file.path]
  ];

  elements.overviewPanel.innerHTML = rows
    .map(
      ([label, value]) => `
        <div class="overview-row">
          <div class="overview-label">${escapeHtml(label)}</div>
          <div class="overview-value">${escapeHtml(value || "Unknown")}</div>
        </div>
      `
    )
    .join("");
}

function renderTabs() {
  elements.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === state.activeTab));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));

  const panel = {
    overview: elements.tabOverview,
    exif: elements.tabExif,
    ffprobe: elements.tabFfprobe,
    write: elements.tabWrite
  }[state.activeTab];

  panel.classList.add("active");
  elements.toolbar.classList.toggle("hidden", state.activeTab === "write");
  renderActivePanel();
}

function renderActivePanel() {
  if (!state.current) return;

  if (state.activeTab === "overview") {
    const rows = Object.entries(state.current.overview).map(([key, value]) => ({
      group: "Summary",
      key: formatLabel(key),
      value: displayValue(value)
    }));
    renderMetadataTable(elements.tabOverview, rows);
    return;
  }

  if (state.activeTab === "exif") {
    renderMetadataTable(elements.tabExif, flattenMetadata(state.current.exif));
    return;
  }

  if (state.activeTab === "ffprobe") {
    renderMetadataTable(elements.tabFfprobe, flattenMetadata(state.current.ffprobe || { note: "No stream metadata found." }));
  }
}

function renderWriteForm() {
  const fields = state.current.writableFields || [];
  elements.writeForm.innerHTML = fields
    .map(
      (field) => `
      <div class="field-card">
        <label for="field-${field.key}">
          <span>${escapeHtml(field.label)}</span>
          ${field.isEmpty ? '<span class="field-status">Empty</span>' : ""}
        </label>
        <textarea id="field-${field.key}" data-key="${field.key}" placeholder="${field.list ? "Comma-separated values" : ""}">${escapeHtml(field.value)}</textarea>
      </div>
    `
    )
    .join("");

  elements.sidecarJsonButton.disabled = false;
  elements.sidecarXmpButton.disabled = false;
  elements.writeCopyButton.disabled = false;
}

function renderMetadataTable(container, rows) {
  const filteredRows = filterRows(rows);
  elements.metadataCount.textContent = `${filteredRows.length} field${filteredRows.length === 1 ? "" : "s"}`;

  if (filteredRows.length === 0) {
    container.innerHTML = '<div class="empty-state">No matching metadata</div>';
    return;
  }

  container.innerHTML = `
    <table class="metadata-table">
      <thead>
        <tr>
          <th class="group-cell">Group</th>
          <th class="key-cell">Field</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        ${filteredRows
          .map(
            (row) => `
            <tr>
              <td class="group-cell">${escapeHtml(row.group)}</td>
              <td class="key-cell">${escapeHtml(row.key)}</td>
              <td class="value-cell">${escapeHtml(row.value)}</td>
            </tr>
          `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function flattenMetadata(input, prefix = "", group = "Root") {
  if (input == null) return [];

  if (Array.isArray(input)) {
    return input.flatMap((item, index) => flattenMetadata(item, `${prefix}[${index}]`, group));
  }

  if (typeof input === "object") {
    return Object.entries(input).flatMap(([key, value]) => {
      const parsed = parseGroupedKey(key);
      const nextGroup = parsed.group || group;
      const nextKey = prefix ? `${prefix}.${parsed.key}` : parsed.key;

      if (value && typeof value === "object" && !(value instanceof Date)) {
        return flattenMetadata(value, nextKey, nextGroup);
      }

      return [
        {
          group: nextGroup,
          key: nextKey,
          value: displayValue(value)
        }
      ];
    });
  }

  return [{ group, key: prefix || "Value", value: displayValue(input) }];
}

function parseGroupedKey(key) {
  const match = String(key).match(/^([^:]{2,40}):(.+)$/);
  if (!match) return { group: "", key };
  return { group: match[1], key: match[2] };
}

function filterRows(rows) {
  if (!state.search) return rows;
  return rows.filter((row) => `${row.group} ${row.key} ${row.value}`.toLowerCase().includes(state.search));
}

function getWriteFormValues() {
  return [...elements.writeForm.querySelectorAll("textarea")].reduce((edits, input) => {
    const value = input.value.trim();
    if (value) edits[input.dataset.key] = value;
    return edits;
  }, {});
}

function buildExportPayload() {
  return {
    exportedAt: new Date().toISOString(),
    file: state.current.file,
    overview: state.current.overview,
    exif: state.current.exif,
    ffprobe: state.current.ffprobe
  };
}

async function runTask(label, task) {
  const previousLabel = elements.selectButton.textContent;
  elements.selectButton.disabled = true;
  elements.selectButton.textContent = label;

  try {
    await task();
  } catch (error) {
    showToast(error.message || String(error), true);
  } finally {
    elements.selectButton.disabled = false;
    elements.selectButton.textContent = previousLabel;
  }
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("visible"), 4200);
}

function displayValue(value) {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "Unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatLabel(value) {
  return String(value)
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase())
    .trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
