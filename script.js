/* =========================================================
   INTERNTRACK — app.js
   All logic lives here. Data is stored in localStorage
   under the key "internTrackApplications".
========================================================= */

/* ---------------------------------------------------------
   1. DATA LAYER
--------------------------------------------------------- */
const STORAGE_KEY = "internTrackApplications";
const THEME_KEY = "internTrackTheme";

const CHECKLIST_ITEMS = [
  { key: "revise",    label: "Revise JavaScript" },
  { key: "practice",  label: "Practice coding problems" },
  { key: "research",  label: "Research company" },
  { key: "intro",     label: "Prepare self-introduction" },
  { key: "questions", label: "Prepare questions" },
  { key: "review",    label: "Review projects" }
];

let applications = [];   // in-memory copy of all applications
let editingId = null;    // id currently being edited (null = adding new)
let detailId = null;     // id currently shown in the details modal
let calendarDate = new Date(); // month currently shown in the calendar

function loadApplications() {
  const raw = localStorage.getItem(STORAGE_KEY);
  applications = raw ? JSON.parse(raw) : [];
}

function saveApplications() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(applications));
}

function makeId() {
  return "app_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
}

function defaultChecklist() {
  const c = {};
  CHECKLIST_ITEMS.forEach(item => c[item.key] = false);
  return c;
}

/* ---------------------------------------------------------
   2. HELPERS (dates, formatting, scoring)
--------------------------------------------------------- */
// Returns today's date as "YYYY-MM-DD" using the LOCAL date.
// IMPORTANT: we build this from getFullYear()/getMonth()/getDate() instead
// of using toISOString(), because toISOString() converts to UTC first.
// That conversion can shift the date by one day depending on the user's
// timezone (for example, for a few hours after local midnight in India,
// toISOString() still reports the previous day). Since every "is this
// today / is this upcoming" check in the app compares against this
// string, that shift was what made interviews sometimes look like they
// were on the wrong day.
function todayStr() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Converts a 24-hour "HH:MM" time (straight from the time input) into a
// friendlier 12-hour format like "10:30 AM" for display only. The saved
// value itself is never changed, only how it's shown.
function formatTime(timeStr) {
  if (!timeStr) return "";
  const parts = timeStr.split(":");
  let hour = parseInt(parts[0], 10);
  const minute = parts[1];
  const period = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minute} ${period}`;
}

function daysBetween(fromStr, toStr) {
  const a = new Date(fromStr + "T00:00:00");
  const b = new Date(toStr + "T00:00:00");
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

// Health score out of 100. Each present field is worth 20 points.
// Kept intentionally simple so it's easy to read and tweak.
function calculateHealthScore(app) {
  let score = 0;
  if (app.resumeVersion && app.resumeVersion.trim() !== "") score += 20;
  if (app.followUpDate) score += 20;
  if (app.interviewDate) score += 20;
  if (app.recruiter && app.recruiter.trim() !== "") score += 20;
  if (app.notes && app.notes.trim() !== "") score += 20;
  return score;
}

// A small fixed palette keeps avatar colors consistent with the app's
// own theme instead of generating random/clashing colors.
const AVATAR_PALETTE = ["#2F5D50", "#4C6FA5", "#B8842E", "#A9564B", "#6E766A", "#7C6FA0"];

function avatarColor(name) {
  const str = (name || "?").trim();
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function avatarInitial(name) {
  return (name || "?").trim().charAt(0).toUpperCase() || "?";
}

function avatarHtml(name, size) {
  const cls = size === "sm" ? "avatar avatar-sm" : "avatar";
  return `<div class="${cls}" style="background:${avatarColor(name)}">${avatarInitial(name)}</div>`;
}

// Short relative-time label used next to applied dates, e.g. "3d ago".
function daysAgoLabel(dateStr) {
  if (!dateStr) return "";
  const diff = daysBetween(dateStr, todayStr());
  if (diff <= 0) return "Today";
  if (diff === 1) return "1d ago";
  return `${diff}d ago`;
}

// An application only counts as having an actual interview scheduled once
// it has an interview date AND has progressed past "Applied" — otherwise a
// date entered ahead of time would show up as an interview before the
// company has even called. Offer still counts, since it means an interview
// already happened along the way.
function hasScheduledInterview(app) {
  return !!app.interviewDate && (app.status === "Interview" || app.status === "Offer");
}

// Builds a simple activity timeline directly from the fields already
// stored on the application — no separate event log needed. Dated steps
// are sorted chronologically, and "Current status" is always shown last
// since it reflects right now, not a fixed point in the past.
function getApplicationTimeline(app) {
  const steps = [];
  if (app.appliedDate) steps.push({ label: "Applied", date: app.appliedDate });
  if (app.followUpDate) steps.push({ label: "Follow-up", date: app.followUpDate });
  if (app.interviewDate) steps.push({ label: "Interview", date: app.interviewDate });
  steps.sort((a, b) => a.date.localeCompare(b.date));
  steps.push({ label: `Current status: ${app.status}`, date: null });
  return steps;
}

function statusBadgeClass(status) {
  return {
    Applied: "badge-applied",
    Interview: "badge-interview",
    Offer: "badge-offer",
    Rejected: "badge-rejected"
  }[status] || "badge-applied";
}

function statusColor(status) {
  return {
    Applied: "var(--status-applied)",
    Interview: "var(--status-interview)",
    Offer: "var(--status-offer)",
    Rejected: "var(--status-rejected)"
  }[status] || "var(--status-applied)";
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 2200);
}

/* ---------------------------------------------------------
   3. NAVIGATION (tab switching)
--------------------------------------------------------- */
function initNav() {
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach(item => {
    item.addEventListener("click", () => {
      navItems.forEach(i => i.classList.remove("active"));
      item.classList.add("active");
      const tab = item.dataset.tab;
      document.querySelectorAll(".tab-content").forEach(sec => sec.classList.remove("active"));
      document.getElementById("tab-" + tab).classList.add("active");
      renderAll(); // re-render in case data changed while on another tab
    });
  });
}

/* ---------------------------------------------------------
   4. DASHBOARD RENDERING
--------------------------------------------------------- */
function renderDashboard() {
  const total = applications.length;
  const interviews = applications.filter(a => a.status === "Interview").length;
  const offers = applications.filter(a => a.status === "Offer").length;
  const interviewRate = total > 0 ? Math.round((interviews + offers + applications.filter(a=>a.status==="Rejected" && a.interviewDate).length) / total * 100) : 0;
  const dueFollowUps = applications.filter(a => a.followUpDate && a.followUpDate <= todayStr() && a.status !== "Rejected" && a.status !== "Offer").length;
  const streak = calculateStreak();

  document.getElementById("streakLabel").textContent = streak + (streak === 1 ? " day streak" : " day streak");

  const stats = [
    { label: "Total applications", value: total, sub: "All time" },
    { label: "Interviews", value: interviews, sub: "Currently in progress" },
    { label: "Offers", value: offers, sub: "Congratulations!" },
    { label: "Interview rate", value: interviewRate + "%", sub: "Of total applications" },
    { label: "Follow-ups due", value: dueFollowUps, sub: "Need attention" },
    { label: "Application streak", value: streak, sub: "Consecutive days" }
  ];

  document.getElementById("statGrid").innerHTML = stats.map(s => `
    <div class="stat-card">
      <div class="stat-label">${s.label}</div>
      <div class="stat-value">${s.value}</div>
      <div class="stat-sub">${s.sub}</div>
    </div>
  `).join("");

  // Pipeline
  const stages = ["Applied", "Interview", "Offer", "Rejected"];
  const maxCount = Math.max(1, ...stages.map(s => applications.filter(a => a.status === s).length));
  document.getElementById("pipelineRow").innerHTML = stages.map(stage => {
    const count = applications.filter(a => a.status === stage).length;
    const pct = Math.round((count / maxCount) * 100);
    return `
      <div class="pipeline-stage">
        <div class="pipeline-bar-track"><div class="pipeline-bar-fill" style="width:${pct}%; background:${statusColor(stage)}"></div></div>
        <div class="pipeline-num">${count}</div>
        <div class="pipeline-label">${stage}</div>
      </div>`;
  }).join("");

  // Recent applications (last 5 by applied date)
  const recent = [...applications]
    .filter(a => a.appliedDate)
    .sort((a, b) => b.appliedDate.localeCompare(a.appliedDate))
    .slice(0, 5);
  document.getElementById("recentCount").textContent = applications.length;
  document.getElementById("recentList").innerHTML = recent.length ? recent.map(a => `
    <div class="mini-row">
      <div class="mini-left">
        ${avatarHtml(a.company, "sm")}
        <div class="mini-main"><strong>${escapeHtml(a.company)}</strong><span>${escapeHtml(a.role)} · <span class="days-ago">${daysAgoLabel(a.appliedDate)}</span></span></div>
      </div>
      <span class="badge ${statusBadgeClass(a.status)}">${a.status}</span>
    </div>
  `).join("") : `<div class="empty-note">No applications yet. Add your first one!</div>`;

  // Upcoming interviews (future or today, sorted)
  const upcoming = applications
    .filter(a => hasScheduledInterview(a) && a.interviewDate >= todayStr())
    .sort((a, b) => a.interviewDate.localeCompare(b.interviewDate))
    .slice(0, 5);
  document.getElementById("upcomingCount").textContent = upcoming.length;
  document.getElementById("upcomingList").innerHTML = upcoming.length ? upcoming.map(a => `
    <div class="mini-row">
      <div class="mini-left">
        ${avatarHtml(a.company, "sm")}
        <div class="mini-main"><strong>${escapeHtml(a.company)}</strong><span>${formatDate(a.interviewDate)}${a.interviewTime ? " · " + formatTime(a.interviewTime) : ""}</span></div>
      </div>
      <span class="badge badge-interview">${escapeHtml(a.role)}</span>
    </div>
  `).join("") : `<div class="empty-note">No interviews scheduled.</div>`;

  // Follow-up reminders
  const followUps = applications
    .filter(a => a.followUpDate && a.status !== "Rejected" && a.status !== "Offer")
    .sort((a, b) => a.followUpDate.localeCompare(b.followUpDate))
    .slice(0, 6);
  document.getElementById("followupCount").textContent = followUps.length;
  document.getElementById("followupList").innerHTML = followUps.length ? followUps.map(a => `
    <div class="mini-row">
      <div class="mini-left">
        ${avatarHtml(a.company, "sm")}
        <div class="mini-main"><strong>${escapeHtml(a.company)}</strong><span>${followUpMessage(a.followUpDate)}</span></div>
      </div>
      <span class="badge ${statusBadgeClass(a.status)}">${a.status}</span>
    </div>
  `).join("") : `<div class="empty-note">No follow-ups pending. Nice work!</div>`;
}

function followUpMessage(followUpDate) {
  const diff = daysBetween(todayStr(), followUpDate);
  if (diff < 0) return `Follow up overdue by ${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"}`;
  if (diff === 0) return "Follow up today";
  if (diff === 1) return "Follow up tomorrow";
  return `Follow up in ${diff} days`;
}

// Counts the current streak of consecutive days with at least one application.
function calculateStreak() {
  const dates = new Set(applications.filter(a => a.appliedDate).map(a => a.appliedDate));
  if (dates.size === 0) return 0;
  let streak = 0;
  let cursor = new Date(todayStr() + "T00:00:00");
  // If nothing was applied today, streak counting starts from yesterday instead.
  if (!dates.has(cursor.toISOString().slice(0, 10))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (dates.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/* ---------------------------------------------------------
   5. APPLICATIONS TABLE (search + filter)
--------------------------------------------------------- */
function getFilteredApplications() {
  const query = document.getElementById("searchInput").value.trim().toLowerCase();
  const statusFilter = document.getElementById("filterStatus").value;
  const workTypeFilter = document.getElementById("filterWorkType").value;

  return applications.filter(a => {
    const matchesQuery = !query ||
      a.company.toLowerCase().includes(query) ||
      a.role.toLowerCase().includes(query) ||
      (a.location || "").toLowerCase().includes(query);
    const matchesStatus = !statusFilter || a.status === statusFilter;
    const matchesWorkType = !workTypeFilter || a.workType === workTypeFilter;
    return matchesQuery && matchesStatus && matchesWorkType;
  });
}

// Table sort state — defaults to newest applications first.
let sortField = "appliedDate";
let sortDir = "desc";

function sortApplications(list) {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const valA = (a[sortField] || "").toLowerCase ? (a[sortField] || "").toLowerCase() : a[sortField];
    const valB = (b[sortField] || "").toLowerCase ? (b[sortField] || "").toLowerCase() : b[sortField];
    if (valA < valB) return -1 * dir;
    if (valA > valB) return 1 * dir;
    return 0;
  });
}

// Builds the small "change status" dropdown used in the applications table.
// It only lists the current status plus whatever moves are allowed from
// there (see ALLOWED_NEXT_STATUSES). If no moves are allowed, the dropdown
// is disabled so the user can see the status but can't change it.
function buildStatusSelectHtml(app) {
  const allowedMoves = ALLOWED_NEXT_STATUSES[app.status];
  const optionStatuses = [app.status].concat(allowedMoves); // current status shown first
  const isLocked = allowedMoves.length === 0;

  let optionsHtml = "";
  optionStatuses.forEach(s => {
    const isSelected = s === app.status ? "selected" : "";
    optionsHtml += `<option value="${s}" ${isSelected}>${s}</option>`;
  });

  return `
    <select class="status-select ${statusBadgeClass(app.status)}" data-id="${app.id}" aria-label="Change status for ${escapeHtml(app.company)}" ${isLocked ? "disabled" : ""}>
      ${optionsHtml}
    </select>`;
}

function renderApplicationsTable() {
  const list = sortApplications(getFilteredApplications());
  const tbody = document.getElementById("appTableBody");
  const emptyNote = document.getElementById("appsEmptyNote");

  // Reflect current sort on the column headers.
  document.querySelectorAll("th.sortable").forEach(th => {
    const isActive = th.dataset.sort === sortField;
    th.classList.toggle("sorted", isActive);
    th.querySelector(".sort-arrow").textContent = isActive ? (sortDir === "asc" ? "↑" : "↓") : "↕";
  });

  if (list.length === 0) {
    tbody.innerHTML = "";
    emptyNote.style.display = "block";
    return;
  }
  emptyNote.style.display = "none";

  tbody.innerHTML = list.map(a => {
    const score = calculateHealthScore(a);
    return `
    <tr data-id="${a.id}">
      <td>
        <div class="company-cell">
          ${avatarHtml(a.company)}
          <div>
            <div class="cell-company">${escapeHtml(a.company)}</div>
            <div class="cell-sub">${escapeHtml(a.role)}</div>
          </div>
        </div>
      </td>
      <td>${escapeHtml(a.location || "—")}<div class="cell-sub">${a.workType || ""}</div></td>
      <td>${buildStatusSelectHtml(a)}</td>
      <td>${formatDate(a.appliedDate)}<div class="cell-sub days-ago">${daysAgoLabel(a.appliedDate)}</div></td>
      <td>${score}/100</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-action="view" title="View" aria-label="View ${escapeHtml(a.company)} application">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="icon-btn" data-action="edit" title="Edit" aria-label="Edit ${escapeHtml(a.company)} application">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>
          </button>
          <button class="icon-btn" data-action="delete" title="Delete" aria-label="Delete ${escapeHtml(a.company)} application">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0-1 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 6"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll("tr").forEach(row => {
    const id = row.dataset.id;
    row.querySelector('[data-action="view"]').addEventListener("click", () => openDetailModal(id));
    row.querySelector('[data-action="edit"]').addEventListener("click", () => openFormModal(id));
    row.querySelector('[data-action="delete"]').addEventListener("click", () => deleteApplication(id));
  });

  // Quick status update — changing the dropdown updates the application
  // immediately, without opening the edit form.
  tbody.querySelectorAll(".status-select").forEach(select => {
    select.addEventListener("change", () => {
      moveApplicationToStatus(select.dataset.id, select.value);
    });
  });
}

function initSortableHeaders() {
  document.querySelectorAll("th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const field = th.dataset.sort;
      if (sortField === field) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortField = field;
        sortDir = field === "appliedDate" ? "desc" : "asc";
      }
      renderApplicationsTable();
    });
  });
}

function initFilters() {
  ["searchInput", "filterStatus", "filterWorkType"].forEach(id => {
    document.getElementById(id).addEventListener("input", renderApplicationsTable);
    document.getElementById(id).addEventListener("change", renderApplicationsTable);
  });
}

/* ---------------------------------------------------------
   6. KANBAN BOARD
--------------------------------------------------------- */
const KANBAN_COLUMNS = ["Applied", "Interview", "Offer", "Rejected"];

// Which statuses an application is allowed to move to, based on its
// CURRENT status. Once an application reaches "Offer" or "Rejected" it
// is treated as final and cannot be moved anywhere else.
const ALLOWED_NEXT_STATUSES = {
  Applied: ["Interview", "Offer", "Rejected"],
  Interview: ["Offer", "Rejected"],
  Offer: [],
  Rejected: []
};

function renderKanban() {
  const board = document.getElementById("kanbanBoard");
  board.innerHTML = KANBAN_COLUMNS.map(col => {
    const cards = applications.filter(a => a.status === col);
    return `
      <div class="kanban-col" data-status="${col}">
        <div class="kanban-col-head">
          <h4>${col}</h4>
          <span class="kanban-count">${cards.length}</span>
        </div>
        <div class="kanban-cards">
          ${cards.map(a => `
            <div class="kanban-card" draggable="true" data-id="${a.id}">
              <div class="kc-head">
                ${avatarHtml(a.company, "sm")}
                <div class="kc-company">${escapeHtml(a.company)}</div>
              </div>
              <div class="kc-role">${escapeHtml(a.role)}</div>
              <div class="kc-meta">
                <span class="badge ${statusBadgeClass(a.status)}">${a.workType || ""}</span>
              </div>
              ${ALLOWED_NEXT_STATUSES[a.status].length > 0 ? `
                <select class="kc-move-select" data-id="${a.id}" aria-label="Move ${escapeHtml(a.company)} to a different status">
                  <option value="">Move to...</option>
                  ${ALLOWED_NEXT_STATUSES[a.status].map(s => `<option value="${s}">Move to ${s}</option>`).join("")}
                </select>
              ` : ""}
            </div>
          `).join("")}
        </div>
      </div>`;
  }).join("");

  // Wire up dragging on each card
  board.querySelectorAll(".kanban-card").forEach(card => {
    card.addEventListener("click", () => openDetailModal(card.dataset.id));
    card.addEventListener("dragstart", e => {
      card.classList.add("dragging");
      e.dataTransfer.setData("text/plain", card.dataset.id);
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
  });

  // The dropdown is a click-friendly alternative to dragging — useful on
  // touch screens, where the native drag-and-drop API often doesn't work.
  // It only lists moves that are actually allowed (see ALLOWED_NEXT_STATUSES),
  // so it can't be used to bypass the movement rules.
  board.querySelectorAll(".kc-move-select").forEach(select => {
    select.addEventListener("click", e => e.stopPropagation());
    select.addEventListener("change", () => {
      if (select.value) moveApplicationToStatus(select.dataset.id, select.value);
    });
  });

  // Wire up drop targets on each column
  board.querySelectorAll(".kanban-col").forEach(col => {
    col.addEventListener("dragover", e => {
      e.preventDefault();
      col.classList.add("drag-over");
    });
    col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
    col.addEventListener("drop", e => {
      e.preventDefault();
      col.classList.remove("drag-over");
      const id = e.dataTransfer.getData("text/plain");
      moveApplicationToStatus(id, col.dataset.status);
    });
  });
}

// Shared by drag-and-drop, the Kanban "Move to" dropdown, and the table's
// quick-status dropdown, so status changes always go through one place
// and the movement rules only need to be checked here, once.
function moveApplicationToStatus(id, newStatus) {
  const app = applications.find(a => a.id === id);
  if (!app || app.status === newStatus) return;

  // Only allow moves that are listed for the application's current status.
  const allowedMoves = ALLOWED_NEXT_STATUSES[app.status] || [];
  if (!allowedMoves.includes(newStatus)) {
    showToast(`${app.company} can't move from ${app.status} to ${newStatus}.`);
    renderAll(); // redraw so the dropdown/card snaps back to the real status
    return;
  }

  app.status = newStatus;
  saveApplications();
  renderAll();
  showToast(`${app.company} moved to ${newStatus}`);
}

/* ---------------------------------------------------------
   7. INTERVIEW CALENDAR
--------------------------------------------------------- */
function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  document.getElementById("calMonthLabel").textContent =
    calendarDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const eventsByDate = {};
  applications.forEach(a => {
    if (hasScheduledInterview(a)) {
      const key = a.interviewDate;
      if (!eventsByDate[key]) eventsByDate[key] = [];
      eventsByDate[key].push(a);
    }
  });

  const dowNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  let html = dowNames.map((d, i) => `<div class="cal-dow ${i === 0 || i === 6 ? "weekend" : ""}">${d}</div>`).join("");

  for (let i = 0; i < startWeekday; i++) html += `<div class="cal-cell empty"></div>`;

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const isToday = dateStr === todayStr();
    const events = eventsByDate[dateStr] || [];
    html += `
      <div class="cal-cell ${isToday ? "today" : ""}">
        <div class="cal-daynum">${day}</div>
        ${events.slice(0,2).map(e => `<div class="cal-event">${escapeHtml(e.company)}</div>`).join("")}
        ${events.length > 2 ? `<div class="cal-event">+${events.length - 2} more</div>` : ""}
      </div>`;
  }

  document.getElementById("calGrid").innerHTML = html;

  const upcoming = applications
    .filter(a => hasScheduledInterview(a) && a.interviewDate >= todayStr())
    .sort((a, b) => a.interviewDate.localeCompare(b.interviewDate));
  document.getElementById("calUpcomingCount").textContent = upcoming.length;
  document.getElementById("calUpcomingList").innerHTML = upcoming.length ? upcoming.map(a => `
    <div class="mini-row">
      <div class="mini-left">
        ${avatarHtml(a.company, "sm")}
        <div class="mini-main"><strong>${escapeHtml(a.company)}</strong><span>${escapeHtml(a.role)}</span></div>
      </div>
      <span class="badge badge-interview">${formatDate(a.interviewDate)}${a.interviewTime ? " · " + formatTime(a.interviewTime) : ""}</span>
    </div>
  `).join("") : `<div class="empty-note">No upcoming interviews.</div>`;
}

function initCalendarNav() {
  document.getElementById("calPrev").addEventListener("click", () => {
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    renderCalendar();
  });
  document.getElementById("calNext").addEventListener("click", () => {
    calendarDate.setMonth(calendarDate.getMonth() + 1);
    renderCalendar();
  });
  document.getElementById("calToday").addEventListener("click", () => {
    calendarDate = new Date();
    renderCalendar();
  });
}

/* ---------------------------------------------------------
   8. ANALYTICS
--------------------------------------------------------- */
function renderBarChart(containerId, dataMap, colorFn) {
  const total = Object.values(dataMap).reduce((sum, v) => sum + v, 0);
  const max = Math.max(1, ...Object.values(dataMap));
  const html = Object.entries(dataMap).map(([label, value]) => {
    const pct = Math.round((value / max) * 100);
    return `
      <div class="bar-row">
        <div class="bar-label">${label}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${colorFn(label)}"></div></div>
        <div class="bar-value">${value}</div>
      </div>`;
  }).join("");
  document.getElementById(containerId).innerHTML = html || `<div class="empty-note">No data yet.</div>`;
}

function renderAnalytics() {
  const total = applications.length;
  const interviews = applications.filter(a => a.status === "Interview" || a.interviewDate).length;
  const offers = applications.filter(a => a.status === "Offer").length;
  const rejections = applications.filter(a => a.status === "Rejected").length;
  const interviewRate = total > 0 ? Math.round((interviews / total) * 100) : 0;

  document.getElementById("kpiRow").innerHTML = `
    <div class="kpi-box"><div class="kpi-val">${total}</div><div class="kpi-lab">Total applications</div></div>
    <div class="kpi-box"><div class="kpi-val">${interviewRate}%</div><div class="kpi-lab">Interview rate</div></div>
    <div class="kpi-box"><div class="kpi-val">${offers}</div><div class="kpi-lab">Offers</div></div>
    <div class="kpi-box"><div class="kpi-val">${rejections}</div><div class="kpi-lab">Rejections</div></div>
  `;

  const statusMap = {};
  KANBAN_COLUMNS.forEach(s => statusMap[s] = applications.filter(a => a.status === s).length);
  renderBarChart("chartStatus", statusMap, statusColor);

  const sourceMap = {};
  applications.forEach(a => {
    const src = a.source && a.source.trim() ? a.source.trim() : "Not specified";
    sourceMap[src] = (sourceMap[src] || 0) + 1;
  });
  renderBarChart("chartSource", sourceMap, () => "var(--primary)");

  const outcomeMap = { Offers: offers, Rejections: rejections, "Still in progress": total - offers - rejections };
  renderBarChart("chartOutcomes", outcomeMap, label => label === "Offers" ? "var(--status-offer)" : label === "Rejections" ? "var(--status-rejected)" : "var(--status-applied)");
}

/* ---------------------------------------------------------
   9. ADD / EDIT MODAL
--------------------------------------------------------- */
const formFieldIds = ["company","role","location","workType","status","appliedDate","followUpDate","interviewDate","interviewTime","source","resumeVersion","recruiter","notes"];

function openFormModal(id) {
  editingId = id || null;
  const overlay = document.getElementById("formModalOverlay");
  const title = document.getElementById("formModalTitle");

  if (editingId) {
    const app = applications.find(a => a.id === editingId);
    title.textContent = "Edit application";
    formFieldIds.forEach(key => {
      document.getElementById("f-" + key).value = app[key] || "";
    });
  } else {
    title.textContent = "Add application";
    document.getElementById("appForm").reset();
    document.getElementById("f-appliedDate").value = todayStr();
  }
  overlay.classList.add("open");
  document.getElementById("f-company").focus();
}

function closeFormModal() {
  document.getElementById("formModalOverlay").classList.remove("open");
  editingId = null;
}

function handleFormSubmit(e) {
  e.preventDefault();
  const values = {};
  formFieldIds.forEach(key => {
    values[key] = document.getElementById("f-" + key).value.trim();
  });

  if (!values.company || !values.role) {
    showToast("Company name and job role are required.");
    return;
  }

  // Simple sanity checks: follow-up and interview dates shouldn't fall
  // before the date the application was actually submitted.
  if (values.appliedDate && values.followUpDate && values.followUpDate < values.appliedDate) {
    showToast("Follow-up date can't be before the applied date.");
    return;
  }
  if (values.appliedDate && values.interviewDate && values.interviewDate < values.appliedDate) {
    showToast("Interview date can't be before the applied date.");
    return;
  }

  if (editingId) {
    const app = applications.find(a => a.id === editingId);
    Object.assign(app, values);
    showToast("Application updated");
  } else {
    applications.push({
      id: makeId(),
      ...values,
      checklist: defaultChecklist()
    });
    showToast("Application added");
  }

  saveApplications();
  closeFormModal();
  renderAll();
}

function deleteApplication(id) {
  const app = applications.find(a => a.id === id);
  if (!app) return;
  if (!confirm(`Delete the application to ${app.company}? This can't be undone.`)) return;
  applications = applications.filter(a => a.id !== id);
  saveApplications();
  renderAll();
  showToast("Application deleted");
}

/* ---------------------------------------------------------
   10. DETAILS MODAL (+ interview prep checklist)
--------------------------------------------------------- */
function openDetailModal(id) {
  detailId = id;
  const app = applications.find(a => a.id === id);
  if (!app) return;

  document.getElementById("detailModalTitleWrap").innerHTML =
    avatarHtml(app.company) + `<h3 id="detailModalTitle">${escapeHtml(app.company)} — ${escapeHtml(app.role)}</h3>`;
  const score = calculateHealthScore(app);

  const showChecklist = app.status === "Interview" || app.status === "Offer" || !!app.interviewDate;
  if (!app.checklist) app.checklist = defaultChecklist();

  document.getElementById("detailModalBody").innerHTML = `
    <div class="score-ring">
      <div class="score-num">${score}</div>
      <div style="flex:1">
        <div class="score-track"><div class="score-fill" style="width:${score}%"></div></div>
      </div>
      <div style="font-size:12px;color:var(--text-muted);width:70px;">Health score</div>
    </div>

    <div class="detail-grid">
      <div class="detail-item"><span class="d-label">Location</span><span class="d-val">${escapeHtml(app.location || "—")}</span></div>
      <div class="detail-item"><span class="d-label">Work type</span><span class="d-val">${app.workType || "—"}</span></div>
      <div class="detail-item"><span class="d-label">Status</span><span class="d-val"><span class="badge ${statusBadgeClass(app.status)}">${app.status}</span></span></div>
      <div class="detail-item"><span class="d-label">Applied date</span><span class="d-val">${formatDate(app.appliedDate)}</span></div>
      <div class="detail-item"><span class="d-label">Follow-up date</span><span class="d-val">${formatDate(app.followUpDate)}</span></div>
      <div class="detail-item"><span class="d-label">Interview date</span><span class="d-val">${formatDate(app.interviewDate)}${app.interviewTime ? " · " + formatTime(app.interviewTime) : ""}</span></div>
      <div class="detail-item"><span class="d-label">Source</span><span class="d-val">${escapeHtml(app.source || "—")}</span></div>
      <div class="detail-item"><span class="d-label">Resume version</span><span class="d-val">${escapeHtml(app.resumeVersion || "—")}</span></div>
      <div class="detail-item"><span class="d-label">Recruiter / contact</span><span class="d-val">${escapeHtml(app.recruiter || "—")}</span></div>
    </div>

    <div class="section-divider">Activity timeline</div>
    <div class="timeline">
      ${getApplicationTimeline(app).map(step => `
        <div class="timeline-step">
          <div class="timeline-dot"></div>
          <div>
            <div class="timeline-label">${step.label}</div>
            ${step.date ? `<div class="timeline-date">${formatDate(step.date)}</div>` : ""}
          </div>
        </div>
      `).join("")}
    </div>

    <div class="section-divider">Notes</div>
    <div class="notes-block">${escapeHtml(app.notes || "No notes added yet.")}</div>

    ${showChecklist ? `
      <div class="section-divider">Interview preparation</div>
      <div class="checklist" id="checklistBox">
        ${CHECKLIST_ITEMS.map(item => `
          <label>
            <input type="checkbox" data-key="${item.key}" ${app.checklist[item.key] ? "checked" : ""}>
            ${item.label}
          </label>
        `).join("")}
      </div>
    ` : ""}
  `;

  if (showChecklist) {
    document.getElementById("checklistBox").querySelectorAll('input[type=checkbox]').forEach(box => {
      box.addEventListener("change", () => {
        app.checklist[box.dataset.key] = box.checked;
        saveApplications();
      });
    });
  }

  document.getElementById("detailModalOverlay").classList.add("open");
}

function closeDetailModal() {
  document.getElementById("detailModalOverlay").classList.remove("open");
  detailId = null;
}

/* ---------------------------------------------------------
   11. THEME (light / dark mode)
--------------------------------------------------------- */
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || "light";
  applyTheme(saved);
  document.getElementById("themeToggleBtn").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  });
}

function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
    document.getElementById("themeLabel").textContent = "Dark mode";
  } else {
    document.documentElement.removeAttribute("data-theme");
    document.getElementById("themeLabel").textContent = "Light mode";
  }
}

/* ---------------------------------------------------------
   12. DATA EXPORT
--------------------------------------------------------- */
function exportData() {
  const blob = new Blob([JSON.stringify(applications, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "interntrack-applications.json";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast("Data exported");
}

/* ---------------------------------------------------------
   13. MISC HELPERS
--------------------------------------------------------- */
function escapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------------------------------------------------------
   14. MASTER RENDER + INIT
--------------------------------------------------------- */
function renderAll() {
  renderDashboard();
  renderApplicationsTable();
  renderKanban();
  renderCalendar();
  renderAnalytics();
}

function initEventListeners() {
  document.getElementById("addBtnDash").addEventListener("click", () => openFormModal());
  document.getElementById("addBtnApps").addEventListener("click", () => openFormModal());
  document.getElementById("exportBtnDash").addEventListener("click", exportData);

  document.getElementById("appForm").addEventListener("submit", handleFormSubmit);
  document.getElementById("formCancelBtn").addEventListener("click", closeFormModal);
  document.getElementById("formModalClose").addEventListener("click", closeFormModal);
  document.getElementById("formModalOverlay").addEventListener("click", e => {
    if (e.target.id === "formModalOverlay") closeFormModal();
  });

  document.getElementById("detailModalClose").addEventListener("click", closeDetailModal);
  document.getElementById("detailModalOverlay").addEventListener("click", e => {
    if (e.target.id === "detailModalOverlay") closeDetailModal();
  });
  document.getElementById("detailEditBtn").addEventListener("click", () => {
    const id = detailId;
    closeDetailModal();
    openFormModal(id);
  });
  document.getElementById("detailDeleteBtn").addEventListener("click", () => {
    const id = detailId;
    closeDetailModal();
    deleteApplication(id);
  });
}

// A couple of light keyboard shortcuts for people who prefer the keyboard:
// "/" jumps to search (and switches to the Applications tab), "Escape" closes
// whichever modal is open. Both are ignored while typing in a text field so
// they never interfere with normal typing.
function initKeyboardShortcuts() {
  document.addEventListener("keydown", e => {
    const isTyping = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);

    if (e.key === "Escape") {
      closeFormModal();
      closeDetailModal();
      return;
    }

    if (e.key === "/" && !isTyping) {
      e.preventDefault();
      document.querySelector('.nav-item[data-tab="applications"]').click();
      document.getElementById("searchInput").focus();
    }
  });
}

function init() {
  loadApplications();
  initTheme();
  initNav();
  initFilters();
  initSortableHeaders();
  initCalendarNav();
  initEventListeners();
  initKeyboardShortcuts();
  renderAll();
}

document.addEventListener("DOMContentLoaded", init);