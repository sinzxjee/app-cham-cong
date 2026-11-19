const KEY = "cham-cong-mobile-v1";
const defaults = { rate: 26500, break: 0.5, bonus: 30, holidayRate: 300, goal: 2500000 };
const q = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value || 0);
const number = value => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value || 0);
const dateKey = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
const timeKey = date => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
const today = () => dateKey(new Date());
const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || "");

let saved;
try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { saved = null; }
const S = saved && typeof saved === "object" ? saved : { settings: {}, rows: [], templates: [] };
S.settings = { ...defaults, ...(S.settings || {}) };
S.preferences = { theme: "light", ...(S.preferences || {}) };
S.rows = Array.isArray(S.rows) ? S.rows.filter(row => row && typeof row === "object") : [];
S.templates = Array.isArray(S.templates) ? S.templates.filter(template => template && typeof template === "object") : [];
S.rows.forEach(row => { if (!row.id) row.id = crypto.randomUUID(); });
if ("syncUrl" in S.settings || "syncKey" in S.settings) {
  delete S.settings.syncUrl;
  delete S.settings.syncKey;
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* Keep the in-memory data usable. */ }
}

let allTime = true;
let activeFilter = "all";
let selectedDate = null;
let calendarOpen = false;
let undoState = null;
let toastTimer;
let deferredInstallPrompt = null;

function minutes(value) {
  const [hour = 0, minute = 0] = String(value || "").split(":").map(Number);
  return hour * 60 + minute;
}
function nightMinutesBetween(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  let total = 0;
  const day = new Date(startMs);
  day.setHours(0, 0, 0, 0);
  while (day.getTime() < endMs) {
    for (const [fromHour, toHour] of [[0, 2], [22, 24]]) {
      const from = new Date(day);
      from.setHours(fromHour, 0, 0, 0);
      const to = new Date(day);
      if (toHour === 24) { to.setDate(to.getDate() + 1); to.setHours(0, 0, 0, 0); }
      else to.setHours(toHour, 0, 0, 0);
      total += Math.max(0, Math.min(endMs, to.getTime()) - Math.max(startMs, from.getTime()));
    }
    day.setDate(day.getDate() + 1);
  }
  return total / 60000;
}
function calculate(shift) {
  if (!shift.start || !shift.end) return { hours: 0, night: 0, basePay: 0, holidayExtra: 0, nightPay: 0, pay: 0, breakHours: 0 };
  const start = minutes(shift.start);
  let end = minutes(shift.end);
  if (end <= start) end += 1440;
  const overlap = (from, to) => Math.max(0, Math.min(end, to) - Math.max(start, from));
  let nightMinutes = overlap(0, 120) + overlap(1320, 1440) + overlap(1440, 1560);
  const breakHours = Number.isFinite(Number(shift.breakMinutes)) ? Math.max(0, Number(shift.breakMinutes)) / 60 : Number(S.settings.break);
  if (Array.isArray(shift.breaks) && shift.breaks.length && shift.date) {
    const startAt = new Date(`${shift.date}T${shift.start}:00`).getTime();
    const endAt = end > minutes(shift.end) ? startAt + (end - start) * 60000 : new Date(`${shift.date}T${shift.end}:00`).getTime();
    if (Number.isFinite(startAt) && Number.isFinite(endAt)) {
      nightMinutes = nightMinutesBetween(startAt, endAt);
      for (const pause of shift.breaks) {
        const pauseStart = new Date(pause.start).getTime();
        const pauseEnd = new Date(pause.end).getTime();
        if (Number.isFinite(pauseStart) && Number.isFinite(pauseEnd)) nightMinutes -= nightMinutesBetween(pauseStart, pauseEnd);
      }
    }
  }
  const night = Math.max(0, nightMinutes) / 60;
  const hours = Math.max(0, (end - start) / 60 - breakHours);
  const basePay = hours * Number(S.settings.rate);
  const holidayExtra = shift.holiday ? basePay * (Number(S.settings.holidayRate) / 100 - 1) : 0;
  const nightPay = night * Number(S.settings.rate) * Number(S.settings.bonus) / 100;
  return { hours, night, basePay, holidayExtra, nightPay, pay: basePay + holidayExtra + nightPay, breakHours };
}
function isComplete(shift) {
  return Boolean(shift.date && shift.start && shift.end);
}
function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
function periodRows() {
  if (allTime) return S.rows;
  const month = q("#month-filter").value;
  return month ? S.rows.filter(shift => String(shift.date || "").startsWith(month)) : S.rows;
}
function visibleRows() {
  let rows = periodRows();
  if (selectedDate) rows = rows.filter(shift => shift.date === selectedDate);
  return rows.filter(shift => {
    if (activeFilter === "holiday") return Boolean(shift.holiday);
    if (activeFilter === "night") return calculate(shift).night > 0;
    return true;
  }).slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.start || "").localeCompare(String(b.start || "")));
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
    return true;
  } catch {
    showToast("Không lưu được. Hãy xuất bản sao lưu để giữ dữ liệu.");
    return false;
  }
}
function save() {
  if (!persist()) return false;
  render();
  return true;
}
function safe(value) {
  return String(value || "").replace(/[&"<>]/g, char => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[char]);
}
function scopeName() {
  if (allTime || !q("#month-filter").value) return "Tất cả thời gian";
  const [year, month] = q("#month-filter").value.split("-").map(Number);
  return new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}
function updateGoal(total) {
  const goal = Math.max(1, Number(S.settings.goal) || defaults.goal);
  const ratio = Math.max(0, total / goal);
  const percent = Math.round(ratio * 100);
  const fill = Math.min(1, ratio);
  const group = q("#jar-fill-group");
  if (group) group.style.setProperty("--fill-scale", String(fill));
  q("#goal-percent").textContent = `${percent}%`;
  q("#goal-amount").textContent = money(goal);
  const meter = q("#goal-meter");
  meter.setAttribute("aria-valuemax", String(goal));
  meter.setAttribute("aria-valuenow", String(Math.min(goal, Math.round(total))));
  meter.setAttribute("aria-valuetext", `${percent}% mục tiêu, ${money(total)} trên ${money(goal)}`);
  q("#goal-meter").dataset.complete = String(ratio >= 1);
  q("#jar-wave").setAttribute("d", "M18 36 C31 31 44 40 59 35 S86 31 102 36 V45 C88 41 73 41 59 45 S32 43 18 45Z");
  q("#jar-wave").style.opacity = fill ? "1" : "0";
  q("#jar-liquid").style.opacity = fill ? "1" : "0";
  document.querySelectorAll("[data-goal]").forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.goal) === goal)));
}
function applyTheme() {
  const dark = S.preferences.theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const button = q("#theme-toggle");
  button.setAttribute("aria-label", dark ? "Chuyển giao diện sáng" : "Chuyển giao diện tối");
  button.title = dark ? "Chuyển giao diện sáng" : "Chuyển giao diện tối";
  button.innerHTML = dark ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.2A8.7 8.7 0 0 1 8.8 3.5 8.7 8.7 0 1 0 20.5 15.2Z"/></svg>';
  q("#theme-color-meta").content = dark ? "#141b18" : "#f7f8f6";
}
function refreshSummary() {
  const rows = periodRows();
  const completed = rows.filter(isComplete);
  const pending = rows.length - completed.length;
  const results = completed.map(calculate);
  const total = results.reduce((sum, result) => sum + result.pay, 0);
  const base = results.reduce((sum, result) => sum + result.basePay, 0);
  const holidayExtra = results.reduce((sum, result) => sum + result.holidayExtra, 0);
  const nightTotal = results.reduce((sum, result) => sum + result.night, 0);
  const nightPay = results.reduce((sum, result) => sum + result.nightPay, 0);
  const holidayCount = rows.filter(shift => shift.holiday).length;
  q("#total").textContent = money(total);
  q("#count").textContent = rows.length;
  q("#night").textContent = number(nightTotal);
  q("#holiday-count").textContent = holidayCount;
  q("#scope-note").textContent = `${scopeName()} · ${completed.length} ca tính lương${pending ? ` · ${pending} ca đang nhập` : ""}`;
  q("#calc-note").textContent = `Lương ${money(Number(S.settings.rate))}/giờ · nghỉ tay ${number(Number(S.settings.break))} giờ/ca · giờ đêm +${number(Number(S.settings.bonus))}%`;
  q("#scope-title").textContent = allTime || !q("#month-filter").value ? "Tổng lương ước tính" : "Lương ước tính trong tháng";
  q("#all-time").classList.toggle("active", allTime);
  q("#all-time").setAttribute("aria-pressed", String(allTime));
  q("#all-filter-count").textContent = rows.length;
  q("#holiday-filter-count").textContent = holidayCount;
  q("#night-filter-count").textContent = rows.filter(shift => calculate(shift).night > 0).length;
  document.querySelectorAll("[data-filter]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.filter === activeFilter)));
  updateGoal(total);
  renderHeatmap();
}
function rowStatus(shift) {
  if (!shift.date) return "Thiếu ngày";
  if (!shift.start || !shift.end) return "Nhập giờ vào và giờ ra để tính lương";
  return "Đã tính lương";
}
function updateCard(card, shift) {
  const result = calculate(shift);
  const complete = isComplete(shift);
  const status = card.querySelector(".status");
  card.classList.toggle("is-incomplete", !complete);
  status.className = `status ${complete ? "complete" : "pending"}`;
  status.textContent = complete ? "Đã tính" : "Thiếu thông tin";
  card.querySelector(".remove").setAttribute("aria-label", `Xóa ca ngày ${shift.date || "chưa chọn"}`);
  card.querySelector(".shift-pay-label").textContent = complete ? "Tiền ca này" : rowStatus(shift);
  card.querySelector(".shift-pay strong").textContent = complete ? money(result.pay) : "—";
  card.querySelector("[data-value=hours]").textContent = number(result.hours);
  card.querySelector("[data-value=night]").textContent = number(result.night);
  card.querySelector("[data-value=break]").textContent = `${number(result.breakHours)} giờ`;
  card.querySelector("[data-pay=base]").textContent = money(result.basePay);
  card.querySelector("[data-pay=holiday]").textContent = money(result.holidayExtra);
  card.querySelector("[data-pay=night]").textContent = money(result.nightPay);
  card.querySelector(".pay-details").hidden = !complete;
}
function renderList() {
  const list = q("#list");
  list.replaceChildren();
  const shown = visibleRows();
  q("#repeat").hidden = !S.rows.some(isComplete);
  const incompleteShown = shown.filter(shift => !isComplete(shift)).length;
  q("#view-note").textContent = selectedDate ? `${new Intl.DateTimeFormat("vi-VN", { dateStyle: "long" }).format(new Date(`${selectedDate}T12:00:00`))} · ${shown.length} ca${incompleteShown ? ` · ${incompleteShown} ca chưa đủ thông tin tính lương` : ""}` : shown.length ? `${shown.length} ca đang hiển thị${incompleteShown ? ` · ${incompleteShown} ca chưa đủ thông tin tính lương` : ""}` : "";
  shown.forEach(shift => {
    const result = calculate(shift);
    const complete = isComplete(shift);
    const card = document.createElement("article");
    card.className = `shift-card${complete ? "" : " is-incomplete"}`;
    card.dataset.shiftId = String(shift.id);
    card.dataset.date = String(shift.date || "");
    card.dataset.start = String(shift.start || "");
    card.innerHTML = `<div class="shift-top">
      <div class="shift-date"><label for="date-${safe(shift.id)}">Ngày</label><input id="date-${safe(shift.id)}" type="date" data-k="date" value="${safe(shift.date)}"></div>
      <span class="status ${complete ? "complete" : "pending"}">${complete ? "Đã tính" : "Thiếu thông tin"}</span>
      <button type="button" class="remove" aria-label="Xóa ca ngày ${safe(shift.date || "chưa chọn")}" title="Xóa ca làm"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6m4-6v6M6.5 7l.8 13h9.4l.8-13M9 7V4h6v3"/></svg></button>
    </div>
    <div class="shift-fields">
      <label>Giờ vào<input type="time" step="1800" data-k="start" value="${safe(shift.start)}" aria-label="Giờ vào"></label>
      <label>Giờ ra<input type="time" step="1800" data-k="end" value="${safe(shift.end)}" aria-label="Giờ ra"></label>
    </div>
    <div class="shift-foot">
      <label class="holiday"><input type="checkbox" data-k="holiday" ${shift.holiday ? "checked" : ""}> Lễ/Tết ×${number(S.settings.holidayRate)}%</label>
      <div class="shift-meta"><span>Giờ công <b data-value="hours">${number(result.hours)}</b></span><span>Giờ đêm <b data-value="night">${number(result.night)}</b></span><span>Nghỉ <b data-value="break">${number(result.breakHours)} giờ</b></span></div>
      <div class="shift-pay"><span class="shift-pay-label">${complete ? "Tiền ca này" : rowStatus(shift)}</span><strong>${complete ? money(result.pay) : "—"}</strong></div>
      <details class="pay-details" ${complete ? "" : "hidden"}><summary>Tách tiền ca</summary><div><span>Lương giờ công</span><b data-pay="base">${money(result.basePay)}</b><span>Phần cộng Lễ/Tết</span><b data-pay="holiday">${money(result.holidayExtra)}</b><span>Phụ cấp giờ đêm</span><b data-pay="night">${money(result.nightPay)}</b></div></details>
    </div>`;
    card.querySelectorAll("[data-k]").forEach(input => {
      const key = input.dataset.k;
      input.addEventListener("change", () => {
        shift[key] = input.type === "checkbox" ? input.checked : input.value;
        card.dataset.date = String(shift.date || "");
        card.dataset.start = String(shift.start || "");
        const stored = persist();
        if (stored) { refreshSummary(); updateCard(card, shift); }
      });
      if (key === "date") input.addEventListener("blur", () => { if (!input.disabled) { renderList(); if (calendarOpen) renderCalendar(); } });
    });
    card.querySelector(".remove").addEventListener("click", () => removeShift(shift));
    list.append(card);
    updateCard(card, shift);
  });
  if (!shown.length) {
    const hasAny = periodRows().length > 0;
    list.innerHTML = `<div class="empty"><strong>${hasAny ? "Không có ca khớp bộ lọc" : "Chưa có ca trong kỳ này"}</strong><p>${hasAny ? "Thử đổi loại ca, ngày hoặc chọn kỳ khác." : "Bấm “Vào ca” hoặc thêm ca thủ công để bắt đầu."}</p></div>`;
  }
}
function renderTemplates() {
  const quickList = q("#template-list");
  quickList.replaceChildren();
  S.templates.forEach(template => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "template-chip";
    button.textContent = `${template.name} · ${template.start}–${template.end}`;
    button.addEventListener("click", () => addShift("template", template));
    quickList.append(button);
  });
  const list = q("#saved-templates");
  list.replaceChildren();
  if (!S.templates.length) {
    list.innerHTML = '<p class="template-empty">Chưa có mẫu. Lưu giờ vào/ra thường dùng để thêm ca nhanh hơn.</p>';
    return;
  }
  S.templates.forEach(template => {
    const row = document.createElement("div");
    row.className = "saved-template";
    row.innerHTML = `<span><strong>${safe(template.name)}</strong><small>${safe(template.start)}–${safe(template.end)}</small></span><button type="button" class="template-use">Dùng mẫu</button><button type="button" class="template-remove" aria-label="Xóa mẫu ${safe(template.name)}">Xóa</button>`;
    row.querySelector(".template-use").addEventListener("click", () => { q("#template-dialog").close(); addShift("template", template); });
    row.querySelector(".template-remove").addEventListener("click", () => {
      if (confirm(`Xóa mẫu “${template.name}”?`)) { S.templates = S.templates.filter(item => item.id !== template.id); save(); renderTemplates(); }
    });
    list.append(row);
  });
}
function renderCalendar() {
  const shell = q("#calendar-shell");
  shell.hidden = !calendarOpen;
  q("#calendar-toggle").setAttribute("aria-expanded", String(calendarOpen));
  q("#calendar-toggle span").textContent = calendarOpen ? "Đóng lịch" : "Lịch tháng";
  q("#clear-day").hidden = !selectedDate;
  if (!calendarOpen) return;
  let monthValue = q("#month-filter").value;
  if (!monthValue) { monthValue = today().slice(0, 7); q("#month-filter").value = monthValue; }
  const [year, month] = monthValue.split("-").map(Number);
  q("#calendar-title").textContent = new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
  const grid = q("#calendar-grid");
  grid.replaceChildren();
  const firstDay = new Date(year, month - 1, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const cellCount = Math.ceil((offset + daysInMonth) / 7) * 7;
  const monthRows = S.rows.filter(shift => String(shift.date || "").startsWith(monthValue));
  for (let index = 0; index < cellCount; index++) {
    const date = new Date(year, month - 1, index - offset + 1);
    const dateString = dateKey(date);
    const dayRows = monthRows.filter(shift => shift.date === dateString);
    const paidRows = dayRows.filter(isComplete);
    const dayTotal = paidRows.reduce((sum, shift) => sum + calculate(shift).pay, 0);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `calendar-day${date.getMonth() === month - 1 ? "" : " outside"}${dayRows.length ? " has-shifts" : ""}${dateString === today() ? " today" : ""}${dateString === selectedDate ? " selected" : ""}`;
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-selected", String(dateString === selectedDate));
    button.setAttribute("aria-label", `${new Intl.DateTimeFormat("vi-VN", { dateStyle: "full" }).format(date)}${dayRows.length ? `, ${dayRows.length} ca, ${money(dayTotal)}` : ", chưa có ca"}`);
    const hasHoliday = dayRows.some(shift => shift.holiday);
    const hasNight = dayRows.some(shift => calculate(shift).night > 0);
    button.innerHTML = `<span class="calendar-number">${date.getDate()}</span>${dayRows.length ? `<span class="calendar-count">${dayRows.length} ca</span><span class="calendar-dots">${hasHoliday ? '<i class="holiday-dot" aria-label="Lễ/Tết"></i>' : ""}${hasNight ? '<i class="night-dot" aria-label="Ca đêm"></i>' : ""}</span><span class="calendar-pay">${money(dayTotal)}</span>` : ""}`;
    button.addEventListener("click", () => {
      if (date.getMonth() !== month - 1) q("#month-filter").value = dateString.slice(0, 7);
      allTime = false;
      selectedDate = selectedDate === dateString ? null : dateString;
      render();
    });
    grid.append(button);
  }
}
function renderHeatmap() {
  const monthValue = q("#month-filter").value || today().slice(0, 7);
  const [year, month] = monthValue.split("-").map(Number);
  const monthName = new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
  q("#heatmap-period").textContent = monthName;
  const grid = q("#salary-heatmap");
  grid.replaceChildren();
  const firstOffset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const count = new Date(year, month, 0).getDate();
  const totals = Array.from({ length: count }, () => 0);
  S.rows.filter(shift => isComplete(shift) && String(shift.date).startsWith(monthValue)).forEach(shift => {
    totals[Number(shift.date.slice(-2)) - 1] += calculate(shift).pay;
  });
  const positive = totals.filter(value => value > 0).sort((a, b) => a - b);
  const thresholds = positive.length ? [0.25, 0.5, 0.75].map(fraction => positive[Math.min(positive.length - 1, Math.floor((positive.length - 1) * fraction))]) : [];
  for (let index = 0; index < firstOffset; index++) {
    const blank = document.createElement("span");
    blank.className = "heatmap-empty";
    blank.setAttribute("aria-hidden", "true");
    grid.append(blank);
  }
  totals.forEach((pay, index) => {
    const day = index + 1;
    const date = `${monthValue}-${String(day).padStart(2, "0")}`;
    const level = !pay ? 0 : 1 + thresholds.filter(limit => pay > limit).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `heat-day heat-level-${level}${date === selectedDate ? " selected" : ""}${date === today() ? " today" : ""}`;
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-selected", String(date === selectedDate));
    button.setAttribute("aria-label", `${new Intl.DateTimeFormat("vi-VN", { dateStyle: "full" }).format(new Date(`${date}T12:00:00`))}: ${money(pay)}`);
    button.title = `${day} · ${money(pay)} · chạm để lọc ca`;
    button.textContent = String(day);
    button.addEventListener("click", () => {
      allTime = false;
      selectedDate = selectedDate === date ? null : date;
      render();
      q("#list").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    grid.append(button);
  });
}
function setPeriodToAll() {
  allTime = true;
  selectedDate = null;
  activeFilter = "all";
}
function addShift(mode = "blank", template = null) {
  let previous = null;
  if (mode === "repeat") previous = S.rows.filter(isComplete).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.start).localeCompare(String(a.start)))[0];
  const shift = {
    id: crypto.randomUUID(), date: today(), start: template?.start || previous?.start || "", end: template?.end || previous?.end || "", holiday: false
  };
  if (template) shift.templateName = template.name;
  S.rows.push(shift);
  setPeriodToAll();
  if (!save()) return;
  const card = [...q("#list").querySelectorAll(".shift-card")].find(item => item.dataset.shiftId === String(shift.id));
  const startInput = card?.querySelector('[data-k="start"]');
  startInput?.focus();
  startInput?.scrollIntoView({ behavior: "smooth", block: "center" });
  const message = template ? `Đã thêm ca theo mẫu “${template.name}” · kiểm tra ngày và Lễ/Tết` : mode === "repeat" && previous ? "Đã lặp giờ ca trước · kiểm tra ngày và Lễ/Tết" : "Ca mới đã thêm · nhập giờ để tính lương";
  showToast(message);
}
function showToast(message, undo = false) {
  clearTimeout(toastTimer);
  q("#toast-message").textContent = message;
  q("#undo-delete").hidden = !undo;
  q("#toast").hidden = false;
  toastTimer = setTimeout(() => { q("#toast").hidden = true; undoState = null; }, 6000);
}
function removeShift(shift) {
  const index = S.rows.indexOf(shift);
  if (index < 0) return;
  S.rows.splice(index, 1);
  undoState = { shift, index };
  if (save()) showToast("Đã xóa ca làm", true);
}
function undoDelete() {
  if (!undoState) return;
  S.rows.splice(Math.min(undoState.index, S.rows.length), 0, undoState.shift);
  undoState = null;
  clearTimeout(toastTimer);
  q("#toast").hidden = true;
  save();
}
function render() {
  applyTheme();
  refreshSummary();
  renderTemplates();
  renderCalendar();
  renderList();
}
function openTemplates() {
  renderTemplates();
  q("#template-dialog").showModal();
}
function saveTemplate(event) {
  event.preventDefault();
  const name = q("#template-name").value.trim();
  const start = q("#template-start").value;
  const end = q("#template-end").value;
  if (!name || !validTime(start) || !validTime(end)) { showToast("Nhập tên mẫu và giờ vào/ra hợp lệ."); return; }
  S.templates.push({ id: crypto.randomUUID(), name, start, end });
  if (!save()) return;
  q("#template-name").value = "";
  q("#template-start").value = "";
  q("#template-end").value = "";
  renderTemplates();
  showToast("Đã lưu mẫu ca");
}
function exportCSV() {
  const csvCell = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = [["Ngày", "Giờ vào", "Giờ ra", "Giờ nghỉ", "Giờ công", "Giờ đêm", "Lễ/Tết", "Lương giờ công", "Cộng Lễ/Tết", "Phụ cấp đêm", "Tổng lương"]];
  visibleRows().forEach(shift => {
    const result = calculate(shift);
    rows.push([shift.date, shift.start, shift.end, result.breakHours, result.hours, result.night, shift.holiday ? "Có" : "Không", Math.round(result.basePay), Math.round(result.holidayExtra), Math.round(result.nightPay), isComplete(shift) ? Math.round(result.pay) : "Đang nhập"]);
  });
  downloadFile(`cham-cong-${allTime ? "tat-ca" : q("#month-filter").value}.csv`, "text/csv;charset=utf-8", "\ufeff" + rows.map(row => row.map(csvCell).join(",")).join("\r\n"));
}
function exportBackup() {
  const backup = { app: "cham-cong-mobile", version: 2, exportedAt: new Date().toISOString(), settings: S.settings, templates: S.templates, rows: S.rows };
  downloadFile(`sao-luu-cham-cong-${today()}.json`, "application/json;charset=utf-8", JSON.stringify(backup, null, 2));
  showToast("Đã tạo bản sao lưu toàn bộ dữ liệu");
}
function downloadFile(name, type, contents) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([contents], { type }));
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function importBackup(file) {
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const backup = JSON.parse(String(reader.result));
      if (backup?.app !== "cham-cong-mobile" || !Array.isArray(backup.rows)) throw new Error("Sai định dạng");
      const imported = backup.rows.filter(row => row && isValidDate(row.date) && typeof row.holiday === "boolean")
        .map(row => ({
          ...row,
          id: String(row.id || crypto.randomUUID()),
          date: row.date,
          start: validTime(row.start) ? row.start : "",
          end: validTime(row.end) ? row.end : "",
          holiday: row.holiday,
          breakMinutes: Number.isFinite(Number(row.breakMinutes)) ? Math.max(0, Number(row.breakMinutes)) : undefined,
          clockState: ["work", "break", "done"].includes(row.clockState) ? row.clockState : undefined,
          breaks: Array.isArray(row.breaks) ? row.breaks.filter(item => item && Number.isFinite(new Date(item.start).getTime()) && Number.isFinite(new Date(item.end).getTime())) : []
        }));
      if (!imported.length && backup.rows.length) throw new Error("Không có ca hợp lệ");
      const ids = new Set(S.rows.map(row => row.id));
      const additions = imported.filter(row => !ids.has(row.id));
      const incomingTemplates = Array.isArray(backup.templates) ? backup.templates.filter(item => item && item.id && item.name && validTime(item.start) && validTime(item.end)) : [];
      const templateIds = new Set(S.templates.map(template => template.id));
      const newTemplates = incomingTemplates.filter(template => !templateIds.has(template.id));
      const nextSettings = Object.fromEntries(Object.keys(defaults).map(key => [key, Number(backup.settings?.[key] ?? defaults[key])]));
      if (Object.values(nextSettings).some(value => !Number.isFinite(value) || value < 0) || nextSettings.break > 8 || nextSettings.holidayRate < 100 || nextSettings.goal < 1) throw new Error("Thiết lập không hợp lệ");
      if (!confirm(`Nhập ${additions.length} ca và ${newTemplates.length} mẫu mới; khôi phục thiết lập lương từ bản sao lưu?`)) return;
      S.rows.push(...additions);
      S.templates.push(...newTemplates);
      S.settings = nextSettings;
      setPeriodToAll();
      if (save()) showToast(`Đã nhập ${additions.length} ca và ${newTemplates.length} mẫu`);
    } catch {
      showToast("Không đọc được bản sao lưu này. Hãy chọn tệp JSON do ứng dụng xuất ra.");
    } finally {
      q("#restore-file").value = "";
    }
  });
  reader.addEventListener("error", () => showToast("Không đọc được tệp. Hãy thử chọn bản sao lưu JSON khác."));
  reader.readAsText(file);
}
function changeMonth(amount) {
  const [year, month] = (q("#month-filter").value || today().slice(0, 7)).split("-").map(Number);
  const date = new Date(year, month - 1 + amount, 1);
  q("#month-filter").value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  allTime = false;
  selectedDate = null;
  render();
}
function updateNetworkStatus() {
  const status = q("#network-status");
  status.hidden = navigator.onLine;
  status.textContent = navigator.onLine ? "" : "Ngoại tuyến · dữ liệu vẫn lưu trên máy này";
}
function installApp() {
  if (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone) { showToast("Ứng dụng đã được cài trên thiết bị này."); return; }
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.finally(() => { deferredInstallPrompt = null; });
    return;
  }
  q("#install-dialog").showModal();
}

document.addEventListener("click", event => { if (!q("#more").contains(event.target)) q("#more").open = false; });
q("#gear").addEventListener("click", () => {
  for (const key of Object.keys(defaults)) q("#" + key).value = S.settings[key];
  q("#dlg").showModal();
});
q("#theme-toggle").addEventListener("click", () => {
  S.preferences.theme = S.preferences.theme === "dark" ? "light" : "dark";
  if (persist()) { applyTheme(); showToast(`Đã chuyển sang giao diện ${S.preferences.theme === "dark" ? "tối" : "sáng"}`); }
});
document.querySelectorAll("[data-goal]").forEach(button => button.addEventListener("click", () => {
  S.settings.goal = Number(button.dataset.goal);
  save();
  showToast(`Mục tiêu kỳ này: ${money(S.settings.goal)}`);
}));
q("#close-settings").addEventListener("click", () => q("#dlg").close());
q("#cancel-settings").addEventListener("click", () => q("#dlg").close());
q("#save").addEventListener("click", event => {
  event.preventDefault();
  const next = Object.fromEntries(Object.keys(defaults).map(key => [key, Number(q("#" + key).value)]));
  if (Object.values(next).some(value => !Number.isFinite(value) || value < 0) || next.break > 8 || next.holidayRate < 100 || next.goal < 1) { showToast("Kiểm tra lại lương, giờ nghỉ, hệ số và mục tiêu."); return; }
  S.settings = next;
  q("#dlg").close();
  save();
});
q("#all-time").addEventListener("click", () => { setPeriodToAll(); render(); });
q("#repeat").addEventListener("click", () => addShift("repeat"));
q("#month-filter").addEventListener("change", () => { allTime = !q("#month-filter").value; selectedDate = null; render(); });
document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => { activeFilter = button.dataset.filter; renderList(); refreshSummary(); }));
q("#undo-delete").addEventListener("click", undoDelete);
q("#clear").addEventListener("click", () => {
  q("#more").open = false;
  if (S.rows.length && confirm("Xóa toàn bộ ca làm đã nhập trên trình duyệt này?")) {
    S.rows = [];
    setPeriodToAll();
    if (save()) showToast("Đã xóa toàn bộ ca");
  }
});
q("#csv").addEventListener("click", () => { q("#more").open = false; exportCSV(); });
q("#backup").addEventListener("click", () => { q("#more").open = false; exportBackup(); });
q("#restore").addEventListener("click", () => { q("#more").open = false; q("#restore-file").click(); });
q("#restore-file").addEventListener("change", event => { if (event.target.files?.[0]) importBackup(event.target.files[0]); });
q("#calendar-toggle").addEventListener("click", () => {
  calendarOpen = !calendarOpen;
  if (calendarOpen && allTime) { allTime = false; q("#month-filter").value ||= today().slice(0, 7); }
  render();
});
q("#prev-month").addEventListener("click", () => changeMonth(-1));
q("#next-month").addEventListener("click", () => changeMonth(1));
q("#clear-day").addEventListener("click", () => { selectedDate = null; render(); });
q("#template-add").addEventListener("click", openTemplates);
q("#templates-open").addEventListener("click", () => { q("#more").open = false; openTemplates(); });
q("#template-form").addEventListener("submit", saveTemplate);
q("#close-templates").addEventListener("click", () => q("#template-dialog").close());
q("#install-open").addEventListener("click", () => { q("#more").open = false; installApp(); });
q("#close-install").addEventListener("click", () => q("#install-dialog").close());
window.addEventListener("online", updateNetworkStatus);
window.addEventListener("offline", updateNetworkStatus);
window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); deferredInstallPrompt = event; });
window.addEventListener("appinstalled", () => { deferredInstallPrompt = null; showToast("Đã cài ứng dụng."); });
q("#month-filter").value = today().slice(0, 7);
render();
updateNetworkStatus();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => showToast("Chế độ offline chưa khả dụng trên trình duyệt này."));
}
