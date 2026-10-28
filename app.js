const KEY = "cham-cong-mobile-v1";
const defaults = { rate: 26500, break: 0.5, bonus: 30, holidayRate: 300 };
const q = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value || 0);
const number = value => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value || 0);

let saved;
try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { saved = null; }
const S = saved && typeof saved === "object" ? saved : { settings: {}, rows: [] };
S.settings = { ...defaults, ...(S.settings || {}) };
S.rows = Array.isArray(S.rows) ? S.rows : [];
if ("syncUrl" in S.settings || "syncKey" in S.settings) {
  delete S.settings.syncUrl;
  delete S.settings.syncKey;
  localStorage.setItem(KEY, JSON.stringify(S));
}

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
function save() {
  localStorage.setItem(KEY, JSON.stringify(S));
  render();
}
function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
function safe(value) {
  return String(value || "").replace(/[&"<>]/g, char => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[char]);
}
function render() {
  const list = q("#list");
  list.replaceChildren();
  let total = 0;
  let nightTotal = 0;
  S.rows.forEach(shift => {
    const result = calculate(shift);
    total += result.pay;
    nightTotal += result.night;
    const card = document.createElement("article");
    card.className = "shift-card";
    card.innerHTML = `<div class="shift-top">
      <div class="shift-date"><label>Ngày làm</label><input type="date" data-k="date" value="${safe(shift.date)}" aria-label="Ngày làm"></div>
      <button type="button" class="remove" aria-label="Xóa ca làm" title="Xóa ca làm">×</button>
    </div>
    <div class="shift-fields">
      <label>Giờ vào<input type="time" data-k="start" value="${safe(shift.start)}"></label>
      <label>Giờ ra<input type="time" data-k="end" value="${safe(shift.end)}"></label>
    </div>
    <div class="shift-foot">
      <label class="holiday"><input type="checkbox" data-k="holiday" ${shift.holiday ? "checked" : ""}> Lễ/Tết ×${number(S.settings.holidayRate)}%</label>
      <div class="shift-meta"><span>Giờ công <b>${number(result.hours)}</b></span><span>Giờ đêm <b>${number(result.night)}</b></span></div>
      <div class="shift-pay"><span>Tiền ca này</span><strong>${money(result.pay)}</strong></div>
    </div>`;
    card.querySelectorAll("[data-k]").forEach(input => {
      input.addEventListener("change", () => {
        shift[input.dataset.k] = input.type === "checkbox" ? input.checked : input.value;
        save();
      });
    });
    card.querySelector(".remove").addEventListener("click", () => {
      if (confirm("Xóa ca làm này?")) {
        S.rows = S.rows.filter(row => row !== shift);
        save();
      }
    });
    list.append(card);
  });
  if (!S.rows.length) {
    list.innerHTML = '<div class="empty"><span class="empty-icon" aria-hidden="true">＋</span><strong>Chưa có ca làm nào</strong><p>Nhấn “Thêm ca làm” để bắt đầu ghi công.</p></div>';
  }
  q("#total").textContent = money(total);
  q("#count").textContent = S.rows.length;
  q("#night").textContent = number(nightTotal);
}
function addShift() {
  S.rows.unshift({ id: crypto.randomUUID(), date: today(), start: "09:00", end: "17:00", holiday: false });
  save();
  q(".shift-card input[type=date]")?.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
q("#add").addEventListener("click", addShift);
q("#add-mobile").addEventListener("click", addShift);
q("#gear").addEventListener("click", () => {
  for (const key of Object.keys(defaults)) q("#" + key).value = S.settings[key];
  q("#dlg").showModal();
});
q("#close-settings").addEventListener("click", () => q("#dlg").close());
q("#cancel-settings").addEventListener("click", () => q("#dlg").close());
q("#save").addEventListener("click", event => {
  event.preventDefault();
  for (const key of Object.keys(defaults)) S.settings[key] = Number(q("#" + key).value);
  q("#dlg").close();
  save();
});
q("#clear").addEventListener("click", () => {
  q("#more").open = false;
  if (S.rows.length && confirm("Xóa toàn bộ ca làm đã nhập trên trình duyệt này?")) {
    S.rows = [];
    save();
  }
});
q("#csv").addEventListener("click", () => {
  q("#more").open = false;
  const rows = [["Ngày", "Giờ vào", "Giờ ra", "Giờ công", "Giờ đêm", "Lễ/Tết", "Tiền lương"]];
  S.rows.slice().reverse().forEach(shift => {
    const result = calculate(shift);
    rows.push([shift.date, shift.start, shift.end, result.hours, result.night, shift.holiday ? "Có" : "Không", Math.round(result.pay)]);
  });
  const blob = new Blob(["\ufeff" + rows.map(row => row.join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "cham-cong.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
document.addEventListener("click", event => {
  if (!q("#more").contains(event.target)) q("#more").open = false;
});
render();
