const KEY = "cham-cong-mobile-v1";
const defaults = { rate: 26500, break: 0.5, bonus: 30, holidayRate: 300 };
const q = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value || 0);
const number = value => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value || 0);
const dateKey = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
const today = () => dateKey(new Date());

let saved;
try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { saved = null; }
const S = saved && typeof saved === "object" ? saved : { settings: {}, rows: [] };
S.settings = { ...defaults, ...(S.settings || {}) };
S.rows = Array.isArray(S.rows) ? S.rows.filter(row => row && typeof row === "object") : [];
S.rows.forEach(row => { if (!row.id) row.id = crypto.randomUUID(); });
if ("syncUrl" in S.settings || "syncKey" in S.settings) {
  delete S.settings.syncUrl;
  delete S.settings.syncKey;
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* Keep the in-memory data usable. */ }
}

let allTime = true;
let activeFilter = "all";
let undoState = null;
let toastTimer;

function minutes(value) {
  const [hour = 0, minute = 0] = String(value || "").split(":").map(Number);
  return hour * 60 + minute;
}
function calculate(shift) {
  if (!shift.start || !shift.end) return { hours: 0, night: 0, pay: 0 };
  const start = minutes(shift.start);
  let end = minutes(shift.end);
  if (end <= start) end += 1440;
  const overlap = (from, to) => Math.max(0, Math.min(end, to) - Math.max(start, from));
  const night = (overlap(0, 120) + overlap(1320, 1440) + overlap(1440, 1560)) / 60;
  const hours = Math.max(0, (end - start) / 60 - Number(S.settings.break));
  const base = hours * Number(S.settings.rate) * (shift.holiday ? Number(S.settings.holidayRate) / 100 : 1);
  return { hours, night, pay: base + night * Number(S.settings.rate) * Number(S.settings.bonus) / 100 };
}
function isComplete(shift) {
  return Boolean(shift.date && shift.start && shift.end);
}
function validDate(value) {
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
  const rows = periodRows();
  return rows.filter(shift => {
    if (activeFilter === "holiday") return Boolean(shift.holiday);
    if (activeFilter === "night") return calculate(shift).night > 0;
    return true;
  }).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
    render();
    return true;
  } catch {
    showToast("Không lưu được. Hãy xuất bản sao lưu để giữ dữ liệu.");
    render();
    return false;
  }
}
function safe(value) {
  return String(value || "").replace(/[&"<>]/g, char => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[char]);
}
function scopeName() {
  if (allTime || !q("#month-filter").value) return "Tất cả thời gian";
  const [year, month] = q("#month-filter").value.split("-").map(Number);
  return new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}
function rowStatus(shift) {
  if (!shift.date) return "Thiếu ngày";
  if (!shift.start || !shift.end) return "Nhập giờ vào và giờ ra để tính lương";
  return "Đã tính lương";
}
function render() {
  const rows = periodRows();
  const completed = rows.filter(isComplete);
  const pending = rows.length - completed.length;
  const total = completed.reduce((sum, shift) => sum + calculate(shift).pay, 0);
  const nightTotal = completed.reduce((sum, shift) => sum + calculate(shift).night, 0);
  q("#total").textContent = money(total);
  q("#count").textContent = rows.length;
  q("#night").textContent = number(nightTotal);
  q("#scope-note").textContent = `${scopeName()} · ${completed.length} ca tính lương${pending ? ` · ${pending} ca đang nhập` : ""}`;
  q("#calc-note").textContent = `Lương ${money(Number(S.settings.rate))}/giờ · nghỉ ${number(Number(S.settings.break))} giờ/ca · giờ đêm +${number(Number(S.settings.bonus))}%`;

  q("#all-time").classList.toggle("active", allTime);
  q("#all-time").setAttribute("aria-pressed", String(allTime));
  q("#scope-title").textContent = allTime || !q("#month-filter").value ? "Tổng lương ước tính" : "Lương ước tính trong tháng";

  const holidayCount = rows.filter(shift => shift.holiday).length;
  const nightCount = rows.filter(shift => calculate(shift).night > 0).length;
  q("#all-filter-count").textContent = rows.length;
  q("#holiday-filter-count").textContent = holidayCount;
  q("#night-filter-count").textContent = nightCount;
  document.querySelectorAll("[data-filter]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.filter === activeFilter)));

  const list = q("#list");
  list.replaceChildren();
  const shown = visibleRows();
  const incompleteShown = shown.filter(shift => !isComplete(shift)).length;
  q("#view-note").textContent = shown.length ? `${shown.length} ca đang hiển thị${incompleteShown ? ` · ${incompleteShown} ca chưa đủ thông tin tính lương` : ""}` : "";
  shown.forEach(shift => {
    const result = calculate(shift);
    const complete = isComplete(shift);
    const card = document.createElement("article");
    card.className = `shift-card${complete ? "" : " is-incomplete"}`;
    card.innerHTML = `<div class="shift-top">
      <div class="shift-date"><label for="date-${safe(shift.id)}">Ngày</label><input id="date-${safe(shift.id)}" type="date" data-k="date" value="${safe(shift.date)}"></div>
      <span class="status ${complete ? "complete" : "pending"}">${complete ? "Đã tính" : "Thiếu thông tin"}</span>
      <button type="button" class="remove" aria-label="Xóa ca ngày ${safe(shift.date || "chưa chọn")}" title="Xóa ca làm"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6m4-6v6M6.5 7l.8 13h9.4l.8-13M9 7V4h6v3"/></svg></button>
    </div>
    <div class="shift-fields">
      <label>Giờ vào<input type="time" data-k="start" value="${safe(shift.start)}" aria-label="Giờ vào"></label>
      <label>Giờ ra<input type="time" data-k="end" value="${safe(shift.end)}" aria-label="Giờ ra"></label>
    </div>
    <div class="shift-foot">
      <label class="holiday"><input type="checkbox" data-k="holiday" ${shift.holiday ? "checked" : ""}> Lễ/Tết ×${number(S.settings.holidayRate)}%</label>
      <div class="shift-meta"><span>Giờ công <b>${number(result.hours)}</b></span><span>Giờ đêm <b>${number(result.night)}</b></span></div>
      <div class="shift-pay"><span>${complete ? "Tiền ca này" : rowStatus(shift)}</span><strong>${complete ? money(result.pay) : "—"}</strong></div>
    </div>`;
    card.querySelectorAll("[data-k]").forEach(input => {
      input.addEventListener("change", () => {
        shift[input.dataset.k] = input.type === "checkbox" ? input.checked : input.value;
        save();
      });
    });
    card.querySelector(".remove").addEventListener("click", () => removeShift(shift));
    list.append(card);
  });
  if (!shown.length) {
    const hasAny = rows.length > 0;
    list.innerHTML = `<div class="empty"><strong>${hasAny ? "Không có ca khớp bộ lọc" : "Chưa có ca trong kỳ này"}</strong><p>${hasAny ? "Thử đổi loại ca hoặc chọn kỳ khác." : "Thêm ca mới để bắt đầu ghi công."}</p></div>`;
  }
  const repeatButton = q("#repeat-mobile");
  const canRepeat = S.rows.some(shift => isComplete(shift));
  repeatButton.hidden = !canRepeat;
  q("#repeat").hidden = !canRepeat;
  repeatButton.title = "Tạo ca mới với giờ vào/ra của ca đã hoàn tất gần nhất";
}
function clearPeriod() {
  allTime = true;
  activeFilter = "all";
}
function addShift(copyPrevious = false) {
  const previous = copyPrevious ? S.rows.filter(isComplete).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] : null;
  const shift = {
    id: crypto.randomUUID(),
    date: today(),
    start: previous?.start || "",
    end: previous?.end || "",
    holiday: false
  };
  S.rows.unshift(shift);
  clearPeriod();
  const stored = save();
  const startInput = q(`#list [data-k="start"]`);
  startInput?.focus();
  startInput?.scrollIntoView({ behavior: "smooth", block: "center" });
  if (stored) showToast(copyPrevious && previous ? "Đã lặp giờ ca trước · kiểm tra ngày và giờ" : "Ca mới đã thêm · nhập giờ để tính lương");
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
  save();
  showToast("Đã xóa ca làm", true);
}
function undoDelete() {
  if (!undoState) return;
  S.rows.splice(Math.min(undoState.index, S.rows.length), 0, undoState.shift);
  undoState = null;
  clearTimeout(toastTimer);
  q("#toast").hidden = true;
  save();
}
function exportCSV() {
  const csvCell = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = [["Ngày", "Giờ vào", "Giờ ra", "Giờ công", "Giờ đêm", "Lễ/Tết", "Tiền lương"]];
  visibleRows().slice().reverse().forEach(shift => {
    const result = calculate(shift);
    rows.push([shift.date, shift.start, shift.end, result.hours, result.night, shift.holiday ? "Có" : "Không", isComplete(shift) ? Math.round(result.pay) : "Đang nhập"]);
  });
  downloadFile(`cham-cong-${allTime ? "tat-ca" : q("#month-filter").value}.csv`, "text/csv;charset=utf-8", "\ufeff" + rows.map(row => row.map(csvCell).join(",")).join("\r\n"));
}
function exportBackup() {
  const backup = { app: "cham-cong-mobile", version: 1, exportedAt: new Date().toISOString(), settings: S.settings, rows: S.rows };
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
      const imported = backup.rows.filter(row => row && validDate(row.date) && typeof row.holiday === "boolean")
        .map(row => ({ id: String(row.id || crypto.randomUUID()), date: row.date, start: /^([01]\d|2[0-3]):[0-5]\d$/.test(row.start || "") ? row.start : "", end: /^([01]\d|2[0-3]):[0-5]\d$/.test(row.end || "") ? row.end : "", holiday: row.holiday }));
      if (!imported.length && backup.rows.length) throw new Error("Không có ca hợp lệ");
      const ids = new Set(S.rows.map(row => row.id));
      const additions = imported.filter(row => !ids.has(row.id));
      const nextSettings = Object.fromEntries(Object.keys(defaults).map(key => [key, Number(backup.settings?.[key] ?? defaults[key])]));
      if (Object.values(nextSettings).some(value => !Number.isFinite(value) || value < 0) || nextSettings.break > 8 || nextSettings.holidayRate < 100) throw new Error("Thiết lập không hợp lệ");
      if (!confirm(`Nhập ${additions.length} ca mới vào dữ liệu hiện tại và khôi phục thiết lập lương từ bản sao lưu?`)) return;
      S.rows.push(...additions);
      S.settings = nextSettings;
      clearPeriod();
      if (save()) showToast(`Đã nhập ${additions.length} ca mới`);
    } catch {
      showToast("Không đọc được bản sao lưu này. Hãy chọn tệp JSON do ứng dụng xuất ra.");
    } finally {
      q("#restore-file").value = "";
    }
  });
  reader.addEventListener("error", () => showToast("Không đọc được tệp. Hãy thử chọn bản sao lưu JSON khác."));
  reader.readAsText(file);
}

q("#add").addEventListener("click", () => addShift());
q("#add-mobile").addEventListener("click", () => addShift());
q("#repeat-mobile").addEventListener("click", () => addShift(true));
q("#repeat").addEventListener("click", () => addShift(true));
q("#gear").addEventListener("click", () => {
  for (const key of Object.keys(defaults)) q("#" + key).value = S.settings[key];
  q("#dlg").showModal();
});
q("#close-settings").addEventListener("click", () => q("#dlg").close());
q("#cancel-settings").addEventListener("click", () => q("#dlg").close());
q("#save").addEventListener("click", event => {
  event.preventDefault();
  const next = Object.fromEntries(Object.keys(defaults).map(key => [key, Number(q("#" + key).value)]));
  if (Object.values(next).some(value => !Number.isFinite(value) || value < 0) || next.break > 8 || next.holidayRate < 100) {
    showToast("Kiểm tra lại lương, giờ nghỉ và các hệ số.");
    return;
  }
  S.settings = next;
  q("#dlg").close();
  save();
});
q("#all-time").addEventListener("click", () => { allTime = true; render(); });
q("#month-filter").addEventListener("change", () => { allTime = !q("#month-filter").value; render(); });
document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => { activeFilter = button.dataset.filter; render(); }));
q("#undo-delete").addEventListener("click", undoDelete);
q("#clear").addEventListener("click", () => {
  q("#more").open = false;
  if (S.rows.length && confirm("Xóa toàn bộ ca làm đã nhập trên trình duyệt này?")) {
    S.rows = [];
    clearPeriod();
    if (save()) showToast("Đã xóa toàn bộ ca");
  }
});
q("#csv").addEventListener("click", () => { q("#more").open = false; exportCSV(); });
q("#backup").addEventListener("click", () => { q("#more").open = false; exportBackup(); });
q("#restore").addEventListener("click", () => { q("#more").open = false; q("#restore-file").click(); });
q("#restore-file").addEventListener("change", event => { if (event.target.files?.[0]) importBackup(event.target.files[0]); });
document.addEventListener("click", event => {
  if (!q("#more").contains(event.target)) q("#more").open = false;
});
q("#month-filter").value = today().slice(0, 7);
render();

