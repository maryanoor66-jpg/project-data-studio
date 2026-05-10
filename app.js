const STORAGE_KEY = "project-data-studio.datasets";

const sampleCsv = `Project,Task,Owner,Status,Priority,Due Date,Progress
Apollo CRM,  finalize stakeholder map , maya, in progress, high, 2026/05/18, 55%
Apollo CRM,Finalize stakeholder map,Maya,progress,HIGH,18-05-2026,55
Apollo CRM,Data migration checklist, Arjun, blocked, urgent, 2026-05-12, 35%
Apollo CRM,QA handoff, Lena, Done, low, May 22 2026, 100
Nimbus Portal, sprint backlog grooming, noa, not started, medium, 2026-05-30, 0
Nimbus Portal,Vendor API contract, Leo, waiting, high, 2026-05-08, 20%
Field Ops,Training deck update, Sam, completed, medium, 2026-05-20, 100
Field Ops,Risk review, Priya, at risk, high, 2026-05-14, 45`;

let records = [];
let activeDatasetName = "Sample PM Dataset";
let lastFixes = [];

const el = {
  rawInput: document.querySelector("#rawInput"),
  fileInput: document.querySelector("#fileInput"),
  cleanBtn: document.querySelector("#cleanBtn"),
  saveBtn: document.querySelector("#saveBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  loadSampleBtn: document.querySelector("#loadSampleBtn"),
  searchInput: document.querySelector("#searchInput"),
  statusFilter: document.querySelector("#statusFilter"),
  cleaningLog: document.querySelector("#cleaningLog"),
  recordsBody: document.querySelector("#recordsBody"),
  statusChart: document.querySelector("#statusChart"),
  riskList: document.querySelector("#riskList"),
  riskNote: document.querySelector("#riskNote"),
  chartTotal: document.querySelector("#chartTotal"),
  activeDatasetName: document.querySelector("#activeDatasetName"),
  savedCount: document.querySelector("#savedCount"),
  savedList: document.querySelector("#savedList"),
  toast: document.querySelector("#toast"),
  metricTotal: document.querySelector("#metricTotal"),
  metricRowsNote: document.querySelector("#metricRowsNote"),
  metricRisk: document.querySelector("#metricRisk"),
  metricProgress: document.querySelector("#metricProgress"),
  metricQuality: document.querySelector("#metricQuality"),
  metricFixes: document.querySelector("#metricFixes"),
};

const fieldAliases = {
  project: ["project", "project name", "portfolio", "program"],
  task: ["task", "task name", "item", "deliverable", "activity"],
  owner: ["owner", "assignee", "assigned to", "lead", "responsible"],
  status: ["status", "state", "stage"],
  priority: ["priority", "prio", "severity"],
  dueDate: ["due date", "due", "deadline", "target date", "finish date"],
  progress: ["progress", "% complete", "percent complete", "completion", "done %"],
};

const statusMap = new Map([
  ["todo", "Not Started"],
  ["to do", "Not Started"],
  ["new", "Not Started"],
  ["not started", "Not Started"],
  ["open", "Not Started"],
  ["doing", "In Progress"],
  ["progress", "In Progress"],
  ["in progress", "In Progress"],
  ["working", "In Progress"],
  ["wip", "In Progress"],
  ["waiting", "Blocked"],
  ["blocked", "Blocked"],
  ["at risk", "Blocked"],
  ["risk", "Blocked"],
  ["done", "Done"],
  ["complete", "Done"],
  ["completed", "Done"],
  ["closed", "Done"],
]);

const priorityMap = new Map([
  ["urgent", "High"],
  ["critical", "High"],
  ["high", "High"],
  ["h", "High"],
  ["medium", "Medium"],
  ["med", "Medium"],
  ["m", "Medium"],
  ["low", "Low"],
  ["l", "Low"],
]);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function titleCase(value) {
  const trimmed = String(value || "").trim().replace(/\s+/g, " ");
  return trimmed
    ? trimmed.replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    : "";
}

function buildHeaderMap(headers) {
  const normalizedHeaders = headers.map(normalizeKey);
  const map = {};

  Object.entries(fieldAliases).forEach(([field, aliases]) => {
    const index = normalizedHeaders.findIndex((header) => aliases.includes(header));
    map[field] = index;
  });

  return map;
}

function readField(row, headerMap, field) {
  const index = headerMap[field];
  return index >= 0 ? row[index] || "" : "";
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const isoMatch = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  const euMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  let date;

  if (isoMatch) {
    date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  } else if (euMatch) {
    date = new Date(Number(euMatch[3]), Number(euMatch[2]) - 1, Number(euMatch[1]));
  } else {
    date = new Date(raw);
  }

  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeProgress(value, status) {
  const raw = String(value || "").replace("%", "").trim();
  const number = Number.parseFloat(raw);

  if (Number.isNaN(number)) return status === "Done" ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function cleanData(text) {
  const fixes = [];
  const rows = parseCsv(text);
  if (rows.length < 2) return { cleaned: [], fixes: ["Add a header row and at least one data row."] };

  const headerMap = buildHeaderMap(rows[0]);
  const seen = new Set();
  const cleaned = [];
  let duplicates = 0;
  let normalizedValues = 0;
  let repairedDates = 0;

  rows.slice(1).forEach((row) => {
    const rawProject = readField(row, headerMap, "project");
    const rawTask = readField(row, headerMap, "task");
    const rawOwner = readField(row, headerMap, "owner");
    if (!rawProject && !rawTask) return;

    const statusRaw = normalizeKey(readField(row, headerMap, "status"));
    const priorityRaw = normalizeKey(readField(row, headerMap, "priority"));
    const dueRaw = readField(row, headerMap, "dueDate");
    const status = statusMap.get(statusRaw) || "Not Started";
    const priority = priorityMap.get(priorityRaw) || "Medium";
    const dueDate = normalizeDate(dueRaw);
    const progress = normalizeProgress(readField(row, headerMap, "progress"), status);
    const project = titleCase(rawProject) || "Unassigned Project";
    const task = titleCase(rawTask) || "Untitled Task";
    const owner = titleCase(rawOwner) || "Unassigned";
    const key = `${normalizeKey(project)}|${normalizeKey(task)}|${normalizeKey(owner)}`;

    if (seen.has(key)) {
      duplicates += 1;
      return;
    }

    if (statusRaw && status !== readField(row, headerMap, "status").trim()) normalizedValues += 1;
    if (priorityRaw && priority !== readField(row, headerMap, "priority").trim()) normalizedValues += 1;
    if (dueRaw && dueDate !== dueRaw.trim()) repairedDates += 1;

    seen.add(key);
    cleaned.push({
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${cleaned.length}`,
      project,
      task,
      owner,
      status,
      priority,
      dueDate,
      progress,
    });
  });

  fixes.push(`${cleaned.length} usable records`);
  fixes.push(`${duplicates} duplicates removed`);
  fixes.push(`${normalizedValues} statuses/priorities normalized`);
  fixes.push(`${repairedDates} dates standardized`);

  return { cleaned, fixes };
}

function getFilteredRecords() {
  const query = normalizeKey(el.searchInput.value);
  const status = el.statusFilter.value;

  return records.filter((record) => {
    const haystack = normalizeKey(`${record.project} ${record.task} ${record.owner} ${record.priority}`);
    const matchesQuery = !query || haystack.includes(query);
    const matchesStatus = status === "all" || record.status === status;
    return matchesQuery && matchesStatus;
  });
}

function daysUntil(dateString) {
  if (!dateString) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateString}T00:00:00`);
  return Math.ceil((target - today) / 86400000);
}

function getRiskRecords(source = records) {
  return source
    .filter((record) => {
      const dueIn = daysUntil(record.dueDate);
      return record.status === "Blocked" || record.priority === "High" || (dueIn !== null && dueIn < 0 && record.status !== "Done");
    })
    .sort((a, b) => (daysUntil(a.dueDate) ?? 9999) - (daysUntil(b.dueDate) ?? 9999));
}

function qualityScore() {
  if (!records.length) return 0;
  const fields = ["project", "task", "owner", "status", "priority", "dueDate"];
  const complete = records.reduce((count, record) => count + fields.filter((field) => record[field]).length, 0);
  return Math.round((complete / (records.length * fields.length)) * 100);
}

function statusClass(status) {
  if (status === "Done") return "done";
  if (status === "Blocked") return "blocked";
  if (status === "In Progress") return "progress";
  return "";
}

function render() {
  const filtered = getFilteredRecords();
  const risks = getRiskRecords(records);
  const avgProgress = records.length
    ? Math.round(records.reduce((sum, record) => sum + record.progress, 0) / records.length)
    : 0;

  el.activeDatasetName.textContent = activeDatasetName;
  el.metricTotal.textContent = records.length;
  el.metricRowsNote.textContent = `${filtered.length} visible records`;
  el.metricRisk.textContent = risks.length;
  el.metricProgress.textContent = `${avgProgress}%`;
  el.metricQuality.textContent = `${qualityScore()}%`;
  el.metricFixes.textContent = `${lastFixes.length ? lastFixes.slice(1).join(", ") : "0 fixes applied"}`;
  el.chartTotal.textContent = `${filtered.length} tasks`;

  renderCleaningLog();
  renderTable(filtered);
  renderChart(filtered);
  renderRisks(risks);
  renderSavedDatasets();
}

function renderCleaningLog() {
  el.cleaningLog.innerHTML = "";
  lastFixes.forEach((fix) => {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = fix;
    el.cleaningLog.appendChild(pill);
  });
}

function renderTable(source) {
  el.recordsBody.innerHTML = "";
  if (!source.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="7">No records match the current view.</td>`;
    el.recordsBody.appendChild(row);
    return;
  }

  source.forEach((record) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(record.project)}</td>
      <td>${escapeHtml(record.task)}</td>
      <td>${escapeHtml(record.owner)}</td>
      <td><span class="status ${statusClass(record.status)}">${record.status}</span></td>
      <td class="priority-${record.priority.toLowerCase()}">${record.priority}</td>
      <td>${record.dueDate || "No date"}</td>
      <td>${record.progress}%</td>
    `;
    el.recordsBody.appendChild(row);
  });
}

function renderChart(source) {
  const statuses = ["Not Started", "In Progress", "Blocked", "Done"];
  const total = Math.max(1, source.length);
  el.statusChart.innerHTML = "";

  statuses.forEach((status) => {
    const count = source.filter((record) => record.status === status).length;
    const percent = Math.round((count / total) * 100);
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <span>${status}</span>
      <div class="track"><div class="fill" style="width: ${percent}%"></div></div>
      <strong>${count}</strong>
    `;
    el.statusChart.appendChild(row);
  });
}

function renderRisks(risks) {
  el.riskList.innerHTML = "";
  el.riskNote.textContent = risks.length ? `${risks.length} signals need attention` : "No risks found";

  if (!risks.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Your cleaned data has no immediate risk signals.";
    el.riskList.appendChild(empty);
    return;
  }

  risks.slice(0, 5).forEach((record) => {
    const dueIn = daysUntil(record.dueDate);
    const dueText = dueIn === null ? "No due date" : dueIn < 0 ? `${Math.abs(dueIn)} days overdue` : `due in ${dueIn} days`;
    const item = document.createElement("div");
    item.className = "risk-item";
    item.innerHTML = `
      <strong>${escapeHtml(record.task)}</strong>
      <span>${escapeHtml(record.project)} · ${escapeHtml(record.owner)} · ${record.priority} · ${dueText}</span>
    `;
    el.riskList.appendChild(item);
  });
}

function getSavedDatasets() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function setSavedDatasets(datasets) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(datasets));
}

function renderSavedDatasets() {
  const datasets = getSavedDatasets();
  el.savedCount.textContent = `${datasets.length} saved dataset${datasets.length === 1 ? "" : "s"}`;
  el.savedList.innerHTML = "";

  if (!datasets.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Save a cleaned dataset and it will appear here.";
    el.savedList.appendChild(empty);
    return;
  }

  datasets.forEach((dataset) => {
    const card = document.createElement("article");
    card.className = "saved-card";
    card.innerHTML = `
      <strong>${escapeHtml(dataset.name)}</strong>
      <span>${dataset.records.length} records · ${new Date(dataset.createdAt).toLocaleDateString()}</span>
      <div class="button-row">
        <button class="primary" type="button" data-load="${dataset.id}">Load</button>
        <button class="ghost danger" type="button" data-delete="${dataset.id}">Delete</button>
      </div>
    `;
    el.savedList.appendChild(card);
  });
}

function saveDataset() {
  if (!records.length) {
    showToast("Clean data before saving.");
    return;
  }

  const datasets = getSavedDatasets();
  const name = prompt("Dataset name", activeDatasetName || "Clean PM Dataset");
  if (!name) return;

  datasets.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
    name: name.trim(),
    records,
    createdAt: new Date().toISOString(),
  });
  setSavedDatasets(datasets.slice(0, 12));
  activeDatasetName = name.trim();
  showToast("Dataset saved locally.");
  render();
}

function loadDataset(id) {
  const dataset = getSavedDatasets().find((item) => item.id === id);
  if (!dataset) return;
  records = dataset.records;
  activeDatasetName = dataset.name;
  lastFixes = [`${records.length} records loaded from storage`];
  render();
  showToast("Dataset loaded.");
}

function deleteDataset(id) {
  setSavedDatasets(getSavedDatasets().filter((dataset) => dataset.id !== id));
  render();
  showToast("Dataset deleted.");
}

function exportCsv() {
  if (!records.length) {
    showToast("There is no cleaned data to export.");
    return;
  }

  const headers = ["Project", "Task", "Owner", "Status", "Priority", "Due Date", "Progress"];
  const lines = records.map((record) =>
    [record.project, record.task, record.owner, record.status, record.priority, record.dueDate, `${record.progress}%`]
      .map(csvCell)
      .join(",")
  );
  const blob = new Blob([[headers.join(","), ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${activeDatasetName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "clean-project-data"}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => el.toast.classList.remove("show"), 2200);
}

function runClean() {
  const { cleaned, fixes } = cleanData(el.rawInput.value);
  records = cleaned;
  lastFixes = fixes;
  activeDatasetName = "Cleaned Project Data";
  render();
  showToast(cleaned.length ? "Data cleaned and dashboard refreshed." : "No clean records found.");
}

el.cleanBtn.addEventListener("click", runClean);
el.saveBtn.addEventListener("click", saveDataset);
el.exportBtn.addEventListener("click", exportCsv);
el.searchInput.addEventListener("input", render);
el.statusFilter.addEventListener("change", render);
el.clearBtn.addEventListener("click", () => {
  el.rawInput.value = "";
  records = [];
  lastFixes = [];
  activeDatasetName = "No active dataset";
  render();
});
el.loadSampleBtn.addEventListener("click", () => {
  el.rawInput.value = sampleCsv;
  activeDatasetName = "Sample PM Dataset";
  runClean();
});
el.fileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  el.rawInput.value = await file.text();
  activeDatasetName = file.name.replace(/\.csv$/i, "");
  runClean();
});
el.savedList.addEventListener("click", (event) => {
  const loadId = event.target.dataset.load;
  const deleteId = event.target.dataset.delete;
  if (loadId) loadDataset(loadId);
  if (deleteId) deleteDataset(deleteId);
});

el.rawInput.value = sampleCsv;
runClean();
