const KEY = "cham-cong-mobile-v1";
const defaults = { rate: 26500, break: 0.5, bonus: 30, holidayRate: 300, goal: 2500000 };
const q = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value || 0);
const number = value => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value || 0);
const dateKey = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
const timeKey = date => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
function roundedClockTime(date) {
  const rounded = new Date(date);
  const minute = rounded.getMinutes();
  const nextMark = minute % 30 === 0 ? minute : Math.ceil(minute / 30) * 30;
  rounded.setSeconds(0, 0);
  rounded.setMinutes(nextMark);
  return timeKey(rounded);
}
const today = () => dateKey(new Date());
const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || "");

let saved;
try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { saved = null; }
const S = saved && typeof saved === "object" ? saved : { settings: {}, rows: [], templates: [] };
S.settings = { ...defaults, ...(S.settings || {}) };
S.preferences = { theme: "light", ...(S.preferences || {}) };
S.preferences.palette = ["cobalt", "emerald", "matcha", "monochrome"].includes(S.preferences.palette) ? S.preferences.palette : "emerald";
S.preferences.bentoOrder = Array.isArray(S.preferences.bentoOrder) ? S.preferences.bentoOrder : [];
delete S.notes;
S.rows = Array.isArray(S.rows) ? S.rows.filter(row => row && typeof row === "object") : [];
S.templates = Array.isArray(S.templates) ? S.templates.filter(template => template && typeof template === "object") : [];
S.rows.forEach(row => { if (!row.id) row.id = crypto.randomUUID(); });
if ("syncUrl" in S.settings || "syncKey" in S.settings) {
  delete S.settings.syncUrl;
  delete S.settings.syncKey;
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* Keep the in-memory data usable. */ }
}

let allTime = false;
let activeFilter = "all";
let selectedDate = null;
let calendarOpen = false;
let undoState = null;
let toastTimer;
let deferredInstallPrompt = null;
let activeTab = "today";
let goalWasComplete = null;
let lastGoalTotal = null;

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
function isClockActive(shift) {
  return Boolean(shift && (shift.clockState === "work" || shift.clockState === "break") && !shift.end);
}
function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
function payCycle(monthValue = q("#month-filter").value || today().slice(0, 7)) {
  const [year, month] = monthValue.split("-").map(Number);
  const end = new Date(year, month - 1, 20, 12);
  const start = new Date(year, month - 2, 21, 12);
  return { start: dateKey(start), end: dateKey(end) };
}
function cycleDates(bounds = payCycle()) {
  const dates = [];
  const cursor = new Date(`${bounds.start}T12:00:00`);
  const end = new Date(`${bounds.end}T12:00:00`);
  while (cursor <= end) { dates.push(dateKey(cursor)); cursor.setDate(cursor.getDate() + 1); }
  return dates;
}
function periodRows() {
  if (allTime) return S.rows;
  const bounds = payCycle();
  return S.rows.filter(shift => String(shift.date || "") >= bounds.start && String(shift.date || "") <= bounds.end);
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
function cycleName() {
  const { start, end } = payCycle();
  const format = value => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T12:00:00`));
  return `Kỳ ${format(start)} – ${format(end)}`;
}
function scopeName() { return allTime || !q("#month-filter").value ? "Tất cả thời gian" : cycleName(); }
function updateGoal() {
  const goal = Math.max(1, Number(S.settings.goal) || defaults.goal);
  const bounds = payCycle();
  const cycleRows = S.rows.filter(shift => String(shift.date || "") >= bounds.start && String(shift.date || "") <= bounds.end);
  const completed = cycleRows.filter(isComplete).map(calculate);
  const total = completed.reduce((sum, result) => sum + result.pay, 0);
  const completeHours = completed.reduce((sum, result) => sum + result.hours, 0);
  const ratio = Math.max(0, total / goal);
  const percent = Math.round(ratio * 100);
  const fill = Math.min(1, ratio);
  const jar = q(".goal-jar");
  const group = q("#jar-fill-group");
  const firstGoalRender = lastGoalTotal === null;
  const amountChanged = firstGoalRender ? fill > 0 : total !== lastGoalTotal;
  if (amountChanged && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    jar.classList.remove("is-sloshing");
    void jar.getBoundingClientRect();
    jar.classList.add("is-sloshing");
  }
  lastGoalTotal = total;
  if (group) {
    const waterOffset = `${(1 - fill) * 138}px`;
    if (firstGoalRender) {
      group.style.setProperty("--water-offset", "138px");
      requestAnimationFrame(() => group.style.setProperty("--water-offset", waterOffset));
    } else group.style.setProperty("--water-offset", waterOffset);
  }
  q("#goal-percent").textContent = `${percent}%`;
  q("#goal-amount").textContent = money(goal);
  const meter = q("#goal-meter");
  meter.setAttribute("aria-valuemax", String(goal));
  meter.setAttribute("aria-valuenow", String(Math.min(goal, Math.round(total))));
  meter.setAttribute("aria-valuetext", `${percent}% mục tiêu, ${money(total)} trên ${money(goal)}`);
  q("#goal-meter").dataset.complete = String(ratio >= 1);
  q("#goal-progress-fill").style.width = (fill * 100) + "%";

  const remaining = Math.max(0, goal - total);
  const hourlyAverage = completeHours > 0 ? total / completeHours : Number(S.settings.rate) || defaults.rate;
  const missingHours = Math.ceil(remaining / Math.max(1, hourlyAverage) * 2) / 2;
  const averageShiftHours = completed.length && completeHours > 0 ? completeHours / completed.length : 6.5;
  const shiftsNeeded = Math.ceil(missingHours / Math.max(1, averageShiftHours));
  const formatDate = value => new Intl.DateTimeFormat("vi-VN", { day: "numeric", month: "long" }).format(new Date(`${value}T12:00:00`));
  const todayDate = today();
  const planStart = todayDate < bounds.start ? bounds.start : todayDate;
  const remainingDays = todayDate > bounds.end ? 0 : Math.floor((new Date(`${bounds.end}T12:00:00`) - new Date(`${planStart}T12:00:00`)) / 86400000) + 1;

  q("#goal-remaining-hours").textContent = remaining
    ? `Còn thiếu ${money(remaining)} · khoảng ${number(missingHours)} giờ công`
    : `Đã đạt mục tiêu${total > goal ? ` và vượt ${money(total - goal)}` : ""} 🎉`;
  if (!remaining) {
    q("#goal-plan").textContent = `Bạn đã đạt mục tiêu kỳ ${formatDate(bounds.start)}–${formatDate(bounds.end)}.`;
  } else if (!remainingDays) {
    q("#goal-plan").textContent = `Kỳ lương đã kết thúc ngày ${formatDate(bounds.end)}; mục tiêu chưa đạt.`;
  } else if (remainingDays <= 7) {
    const paceWarning = shiftsNeeded > remainingDays ? " · mục tiêu khó kịp kỳ này" : "";
    q("#goal-plan").textContent = `Còn ${number(remainingDays)} ngày: cần khoảng ${number(missingHours)} giờ · ${number(shiftsNeeded)} ca trước ${formatDate(bounds.end)}${paceWarning}.`;
  } else {
    const weeksLeft = remainingDays / 7;
    const hoursPerWeek = Math.ceil(missingHours / weeksLeft * 2) / 2;
    const shiftsPerWeek = Math.ceil(shiftsNeeded / weeksLeft);
    q("#goal-plan").textContent = `Lộ trình đến ${formatDate(bounds.end)}: khoảng ${number(hoursPerWeek)} giờ/tuần · ${number(shiftsPerWeek)} ca/tuần. Lịch bạn gửi thường khoảng 2 ca/tuần.`;
  }
  if (goalWasComplete === false && ratio >= 1) celebrateGoal();
  goalWasComplete = ratio >= 1;
  const backWave = "M-64 31 C-56 26 -50 27 -44 30 S-30 36 -22 32 S-8 25 0 31 C8 26 14 27 20 30 S34 36 42 32 S56 25 64 31 C72 26 78 27 84 30 S98 36 106 32 S120 25 128 31 C136 26 142 27 148 30 S162 36 170 32 S184 25 192 31 L192 180 L-64 180Z";
  const frontWave = "M-64 31 C-57 36 -50 35 -44 32 S-29 26 -22 30 S-7 37 0 31 C7 27 15 26 21 30 S36 36 43 32 S57 26 64 31 C71 36 78 35 84 32 S99 26 106 30 S121 37 128 31 C135 27 143 26 149 30 S164 36 171 32 S185 26 192 31 L192 180 L-64 180Z";
  q("#jar-wave-back").setAttribute("d", backWave);
  q("#jar-wave-front").setAttribute("d", frontWave);
  q("#jar-wave-back").style.opacity = fill ? "0.9" : "0";
  q("#jar-wave-front").style.opacity = fill ? "1" : "0";
  q("#jar-liquid").style.opacity = fill ? "1" : "0";
  document.querySelectorAll("[data-goal]").forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.goal) === goal)));
}
function celebrateGoal() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const layer = q("#goal-confetti");
  layer.replaceChildren();
  for (let index = 0; index < 34; index++) {
    const piece = document.createElement("i");
    piece.style.setProperty("--x", (Math.random() * 100) + "%");
    piece.style.setProperty("--drift", Math.round(Math.random() * 120 - 60) + "px");
    piece.style.setProperty("--delay", Math.random() * 260 + "ms");
    piece.style.setProperty("--fall", (850 + Math.random() * 750) + "ms");
    layer.append(piece);
  }
  setTimeout(() => layer.replaceChildren(), 1900);
}
function currentClockShift() { return S.rows.find(row => (row.clockState === "work" || row.clockState === "break") && !row.end); }
function clockElapsed(shift, now = Date.now()) {
  const start = new Date(shift.clockStartedAt).getTime();
  if (!Number.isFinite(start)) return "00:00";
  const paused = (Array.isArray(shift.breaks) ? shift.breaks.reduce((sum, item) => sum + Math.max(0, new Date(item.end).getTime() - new Date(item.start).getTime()), 0) : 0) + (shift.breakStartedAt ? Math.max(0, now - new Date(shift.breakStartedAt).getTime()) : 0);
  const elapsed = Math.max(0, Math.floor((now - start - paused) / 60000));
  return `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
}
function renderClock() {
  const now = new Date();
  q("#clock-live-time").textContent = new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
  const active = currentClockShift();
  const track = q("#shift-slider");
  const actionLabel = active ? "Trượt để kết thúc ca" : "Trượt để vào ca";
  q("#clock-state").textContent = !active ? "Chưa vào ca" : active.clockState === "break" ? "Đang nghỉ" : "Đang làm";
  q("#clock-elapsed").textContent = active ? `Đã làm ${clockElapsed(active)}` : "Ghi ca bằng thao tác trượt";
  track.setAttribute("aria-label", actionLabel);
  q("#slide-handle").setAttribute("aria-label", actionLabel);
  q("#slide-label").textContent = actionLabel;
  q("#clock-hint").textContent = active ? `Vào ca lúc ${active.start} · kéo hết thanh để kết thúc` : "Kéo nút sang phải để xác nhận";
}
function handleClockAction() {
  const now = new Date();
  const active = currentClockShift();
  if (!active) {
    const roundedStart = roundedClockTime(now);
    const actualStart = timeKey(now);
    const shift = { id: crypto.randomUUID(), date: dateKey(now), start: roundedStart, end: "", holiday: false, clockState: "work", clockStartedAt: now.toISOString(), breakMinutes: Number(S.settings.break) * 60, breaks: [] };
    S.rows.push(shift);
    allTime = false;
    selectedDate = null;
    activeFilter = "all";
    q("#month-filter").value = dateKey(now).slice(0, 7);
    if (save()) showToast(roundedStart === actualStart ? `Đã vào ca lúc ${shift.start}` : `Đã vào ca lúc ${shift.start} · làm tròn từ ${actualStart}`);
    return;
  }
  const actualEnd = timeKey(now);
  active.end = roundedClockTime(now);
  active.clockEndedAt = now.toISOString();
  active.clockState = "done";
  if (save()) showToast(active.end === actualEnd ? `Đã kết thúc ca lúc ${active.end}` : `Đã kết ca lúc ${active.end} · làm tròn từ ${actualEnd}`);
}
function renderTodayShifts() {
  const list = q("#today-list");
  const rows = S.rows.filter(shift => shift.date === today()).slice().sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
  list.replaceChildren();
  if (!rows.length) {
    list.innerHTML = '<div class="today-empty"><span>Chưa ghi ca nào hôm nay.</span><button type="button" class="secondary" data-add-from-empty>Thêm ca thủ công</button></div>';
    list.querySelector("[data-add-from-empty]").addEventListener("click", () => addShift());
    return;
  }
  rows.forEach(shift => {
    const result = calculate(shift);
    const card = document.createElement("article");
    card.className = `today-shift${isComplete(shift) ? "" : " incomplete"}`;
    card.innerHTML = `<span class="today-shift-time">${safe(shift.start || "--:--")}–${safe(shift.end || "--:--")}</span><span class="today-shift-meta">${shift.holiday ? "Lễ/Tết · " : ""}${isComplete(shift) ? `${number(result.hours)} giờ công` : "Đang ghi ca"}</span><strong>${isComplete(shift) ? money(result.pay) : "Đang làm"}</strong>`;
    list.append(card);
  });
}
function renderStats() {
  const rows = periodRows();
  const complete = rows.filter(isComplete);
  const results = complete.map(calculate);
  const total = results.reduce((sum, item) => sum + item.pay, 0);
  const base = results.reduce((sum, item) => sum + item.basePay, 0);
  const holidayPay = results.reduce((sum, item) => sum + item.holidayExtra, 0);
  const nightPay = results.reduce((sum, item) => sum + item.nightPay, 0);
  const hours = results.reduce((sum, item) => sum + item.hours, 0);
  const nightHours = results.reduce((sum, item) => sum + item.night, 0);
  const goal = Number(S.settings.goal) || defaults.goal;
  const period = cycleName();
  const weekRows = S.rows.filter(shift => isComplete(shift) && weekRange().includes(shift.date));
  const weekPay = weekRows.reduce((sum, shift) => sum + calculate(shift).pay, 0);
  q("#snap-cycle-pay").textContent = money(total);
  q("#snap-cycle-range").textContent = period;
  q("#snap-week-pay").textContent = money(weekPay);
  q("#snap-week-hours").textContent = `${number(weekRows.reduce((sum, shift) => sum + calculate(shift).hours, 0))} giờ công`;
  q("#snap-goal-percent").textContent = `${Math.round(total / goal * 100)}%`;
  q("#snap-goal-remaining").textContent = total >= goal ? "Đã đạt mục tiêu" : `Còn ${money(goal - total)}`;
  q("#stats-count").textContent = String(rows.length);
  q("#stats-hours").textContent = number(hours);
  q("#stats-night").textContent = number(nightHours);
  q("#stats-holiday").textContent = String(rows.filter(row => row.holiday).length);
  q("#stats-base").textContent = money(base);
  q("#stats-holiday-pay").textContent = money(holidayPay);
  q("#stats-night-pay").textContent = money(nightPay);
  q("#stats-total").textContent = money(total);
}
function weekRange() {
  const cursor = new Date(`${today()}T12:00:00`);
  cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => { const date = new Date(cursor); date.setDate(cursor.getDate() + index); return dateKey(date); });
}
function renderWeekChart() {
  const dates = weekRange();
  const totals = dates.map(date => S.rows.filter(shift => isComplete(shift) && shift.date === date).reduce((sum, shift) => sum + calculate(shift).pay, 0));
  const max = Math.max(...totals, 1);
  const labels = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
  const xStart = 28, gap = 56, barWidth = 30, baseY = 105, maxHeight = 70;
  const bars = totals.map((pay, index) => {
    const height = pay ? Math.max(4, pay / max * maxHeight) : 2;
    const x = xStart + index * gap;
    const fill = dates[index] === today() ? "var(--accent)" : "var(--chart-muted)";
    return `<rect x="${x}" y="${baseY - height}" width="${barWidth}" height="${height}" rx="6" fill="${fill}"><title>${labels[index]}: ${money(pay)}</title></rect><text class="week-chart-label" x="${x + barWidth / 2}" y="128" text-anchor="middle">${labels[index]}</text>`;
  }).join("");
  const monday = dates[0].slice(8, 10) + "/" + dates[0].slice(5, 7);
  const sunday = dates[6].slice(8, 10) + "/" + dates[6].slice(5, 7);
  q("#week-range").textContent = `${monday}–${sunday}`;
  const emptyState = totals.some(pay => pay > 0) ? "" : '<text class="week-chart-empty" x="210" y="65">Chưa có ca ghi nhận trong tuần</text>';
  q("#week-chart").innerHTML = `<title id="week-chart-title">Lương theo ngày trong tuần</title>${emptyState}<line class="week-chart-baseline" x1="18" y1="106" x2="410" y2="106"/>${bars}`;
  q("#week-chart-data").replaceChildren(...dates.map((date, index) => { const item = document.createElement("li"); item.textContent = `${new Intl.DateTimeFormat("vi-VN", { dateStyle: "full" }).format(new Date(`${date}T12:00:00`))}: ${money(totals[index])}`; return item; }));
}
function renderStreak() {
  const thresholds = [1, 2, 4, 8, 12];
  const names = ["Mèo nghỉ ngơi", "Mèo tập sự", "Mèo thám hiểm", "Mèo pháp sư", "Mèo hoàng gia"];
  const artwork = ["streak-level-1.png", "streak-level-2.png", "streak-level-3.png", "streak-level-4.png", "streak-level-5.jpg"];
  const weekDates = weekRange();
  const completedWeeks = new Set(S.rows.filter(shift => isComplete(shift) && shift.date <= today()).map(shift => {
    const date = new Date(`${shift.date}T12:00:00`);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return dateKey(date);
  }));
  let cursor = weekDates[0];
  const currentWeekWorked = completedWeeks.has(cursor);
  if (!currentWeekWorked) {
    const previous = new Date(`${cursor}T12:00:00`);
    previous.setDate(previous.getDate() - 7);
    cursor = dateKey(previous);
  }
  let streak = 0;
  while (completedWeeks.has(cursor)) {
    streak++;
    const previous = new Date(`${cursor}T12:00:00`);
    previous.setDate(previous.getDate() - 7);
    cursor = dateKey(previous);
  }
  const levelIndex = thresholds.reduce((level, threshold, index) => streak >= threshold ? index : level, -1);
  const level = Math.max(0, levelIndex);
  const nextThreshold = thresholds[levelIndex + 1];
  const progress = nextThreshold ? Math.min(100, streak / nextThreshold * 100) : 100;
  const image = q("#streak-level-image");
  image.src = `./assets/${artwork[level]}`;
  image.alt = `Mèo streak cấp ${level + 1}: ${names[level]}`;
  image.parentElement.classList.toggle("is-jpg", level === 4);
  q("#streak-weeks").textContent = `${streak} ${streak === 1 ? "tuần" : "tuần"}`;
  q("#streak-level-name").textContent = `Cấp ${level + 1} · ${names[level]}`;
  const progressBar = q("#streak-progress");
  progressBar.setAttribute("aria-valuenow", String(Math.round(progress)));
  progressBar.setAttribute("aria-valuemax", "100");
  progressBar.setAttribute("aria-valuetext", nextThreshold ? `${streak} trên ${nextThreshold} tuần tới cấp tiếp theo` : "Đã đạt cấp tối đa");
  q("#streak-progress-fill").style.width = `${progress}%`;
  q("#streak-progress-note").textContent = nextThreshold ? `Còn ${Math.max(0, nextThreshold - streak)} tuần để lên cấp tiếp theo` : "Đã đạt cấp cao nhất";
  q("#streak-status").textContent = streak === 0
    ? "Ghi một ca hoàn tất trong tuần để bắt đầu. Ngày nghỉ không ảnh hưởng streak."
    : currentWeekWorked
      ? "Tuần này đã ghi ca hoàn tất — streak đang tiếp tục."
      : "Tuần này chưa ghi ca hoàn tất; chuỗi trước vẫn được giữ trong tuần đang diễn ra.";
}
function applyBentoOrder() {
  const grid = q("#bento-grid");
  const order = S.preferences.bentoOrder.map(name => name === "note" ? "message-import" : name);
  const rank = new Map(order.map((name, index) => [name, index]));
  [...grid.children].sort((a, b) => (rank.get(a.dataset.bentoCard) ?? 999) - (rank.get(b.dataset.bentoCard) ?? 999)).forEach(card => grid.append(card));
}
function saveBentoOrder() {
  S.preferences.bentoOrder = [...q("#bento-grid").querySelectorAll("[data-bento-card]")].map(card => card.dataset.bentoCard);
  persist();
}
function applyTheme() {
  const dark = S.preferences.theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.palette = S.preferences.palette;
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  const button = q("#theme-toggle");
  button.setAttribute("aria-label", dark ? "Chuyển giao diện sáng" : "Chuyển giao diện tối");
  button.title = dark ? "Chuyển giao diện sáng" : "Chuyển giao diện tối";
  button.innerHTML = dark ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.2A8.7 8.7 0 0 1 8.8 3.5 8.7 8.7 0 1 0 20.5 15.2Z"/></svg>';
  q("#theme-color-meta").content = dark ? "#141b18" : "#ffffff";
  document.querySelectorAll(".palette-option[data-palette]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.palette === S.preferences.palette)));
}
function refreshSummary() {
  const rows = periodRows();
  const completed = rows.filter(isComplete);
  const pending = rows.length - completed.length;
  const results = completed.map(calculate);
  const total = results.reduce((sum, result) => sum + result.pay, 0);
  const nightTotal = results.reduce((sum, result) => sum + result.night, 0);
  const holidayCount = rows.filter(shift => shift.holiday).length;
  q("#total").textContent = money(total);
  q("#count").textContent = rows.length;
  q("#night").textContent = number(nightTotal);
  q("#holiday-count").textContent = holidayCount;
  q("#scope-note").textContent = `${scopeName()} · ${completed.length} ca tính lương${pending ? ` · ${pending} ca đang nhập` : ""}`;
  q("#calc-note").textContent = `Lương ${money(Number(S.settings.rate))}/giờ · nghỉ tay ${number(Number(S.settings.break))} giờ/ca · giờ đêm +${number(Number(S.settings.bonus))}%`;
  q("#scope-title").textContent = allTime || !q("#month-filter").value ? "Tổng lương ước tính" : "Lương ước tính kỳ này";
  q("#all-time").classList.toggle("active", allTime);
  q("#all-time").setAttribute("aria-pressed", String(allTime));
  q("#all-filter-count").textContent = rows.length;
  q("#holiday-filter-count").textContent = holidayCount;
  q("#night-filter-count").textContent = rows.filter(shift => calculate(shift).night > 0).length;
  document.querySelectorAll("[data-filter]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.filter === activeFilter)));
  updateGoal(total);
  renderHeatmap();
  renderStats();
  renderWeekChart();
}
function rowStatus(shift) {
  if (isClockActive(shift)) return shift.clockState === "break" ? "Đang nghỉ · chưa tính lương" : "Đang làm · chưa tính lương";
  if (!shift.date) return "Thiếu ngày";
  if (!shift.start || !shift.end) return "Nhập giờ vào và giờ ra để tính lương";
  return "Đã tính lương";
}
function updateCard(card, shift) {
  const result = calculate(shift);
  const complete = isComplete(shift);
  const status = card.querySelector(".status");
  card.classList.toggle("is-incomplete", !complete);
  card.classList.toggle("is-running", isClockActive(shift));
  status.className = `status ${complete ? "complete" : "pending"}`;
  status.textContent = isClockActive(shift) ? "Đang làm" : complete ? "Đã tính" : "Thiếu thông tin";
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
  card.querySelectorAll("input[type=date],input[type=time]").forEach(input => { input.disabled = isClockActive(shift); });
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
      <span class="status ${complete ? "complete" : "pending"}">${isClockActive(shift) ? "Đang làm" : complete ? "Đã tính" : "Thiếu thông tin"}</span>
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
    list.innerHTML = `<div class="empty"><strong>${hasAny ? "Không có ca khớp bộ lọc" : "Chưa có ca trong kỳ này"}</strong><p>${hasAny ? "Thử đổi loại ca, ngày hoặc chọn kỳ khác." : "Vào tab Hôm nay để ghi ca, hoặc thêm ca thủ công."}</p></div>`;
  }
}
function renderTemplates() {
  const quickList = q("#template-list");
  quickList.replaceChildren();
  S.templates.forEach(template => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "template-chip";
    button.setAttribute("aria-label", "Ghi ca " + template.name + ", " + template.start + " đến " + template.end);
    button.innerHTML = `<span>${safe(template.name)}</span><small>${safe(template.start)}–${safe(template.end)}</small>`;
    button.addEventListener("click", () => addShift("template", template));
    quickList.append(button);
  });
  if (!S.templates.length) quickList.innerHTML = '<span class="template-empty">Tạo mẫu ca để thêm nhanh</span>';
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
  const dates = cycleDates();
  q("#calendar-title").textContent = cycleName();
  const grid = q("#calendar-grid");
  grid.replaceChildren();
  const offset = (new Date(`${dates[0]}T12:00:00`).getDay() + 6) % 7;
  for (let index = 0; index < offset; index++) { const blank = document.createElement("span"); blank.setAttribute("aria-hidden", "true"); grid.append(blank); }
  for (const dateString of dates) {
    const date = new Date(`${dateString}T12:00:00`);
    const dayRows = S.rows.filter(shift => shift.date === dateString);
    const paidRows = dayRows.filter(isComplete);
    const dayTotal = paidRows.reduce((sum, shift) => sum + calculate(shift).pay, 0);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `calendar-day${dayRows.length ? " has-shifts" : ""}${dateString === today() ? " today" : ""}${dateString === selectedDate ? " selected" : ""}`;
    button.setAttribute("aria-pressed", String(dateString === selectedDate));
    button.setAttribute("aria-label", `${new Intl.DateTimeFormat("vi-VN", { dateStyle: "full" }).format(date)}${dayRows.length ? `, ${dayRows.length} ca, ${money(dayTotal)}` : ", chưa có ca"}`);
    const hasHoliday = dayRows.some(shift => shift.holiday);
    const hasNight = dayRows.some(shift => calculate(shift).night > 0);
    button.innerHTML = `<span class="calendar-number">${date.getDate()}</span>${dayRows.length ? `<span class="calendar-count">${dayRows.length} ca</span><span class="calendar-dots">${hasHoliday ? '<i class="holiday-dot" aria-label="Lễ/Tết"></i>' : ""}${hasNight ? '<i class="night-dot" aria-label="Ca đêm"></i>' : ""}</span><span class="calendar-pay">${money(dayTotal)}</span>` : ""}`;
    button.addEventListener("click", () => {
      allTime = false;
      selectedDate = selectedDate === dateString ? null : dateString;
      render();
    });
    grid.append(button);
  }
}
function renderHeatmap() {
  const dates = cycleDates();
  q("#heatmap-period").textContent = cycleName();
  const grid = q("#salary-heatmap");
  grid.replaceChildren();
  const firstOffset = (new Date(`${dates[0]}T12:00:00`).getDay() + 6) % 7;
  const totals = new Map(dates.map(date => [date, 0]));
  S.rows.filter(shift => isComplete(shift) && totals.has(shift.date)).forEach(shift => {
    totals.set(shift.date, totals.get(shift.date) + calculate(shift).pay);
  });
  const positive = [...totals.values()].filter(value => value > 0).sort((a, b) => a - b);
  const thresholds = positive.length ? [0.25, 0.5, 0.75].map(fraction => positive[Math.min(positive.length - 1, Math.floor((positive.length - 1) * fraction))]) : [];
  for (let index = 0; index < firstOffset; index++) {
    const blank = document.createElement("span");
    blank.className = "heatmap-empty";
    blank.setAttribute("aria-hidden", "true");
    grid.append(blank);
  }
  dates.forEach((date, index) => {
    const pay = totals.get(date);
    const day = Number(date.slice(-2));
    const level = !pay ? 0 : 1 + thresholds.filter(limit => pay > limit).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `heat-day heat-level-${level}${date === selectedDate ? " selected" : ""}${date === today() ? " today" : ""}`;
    button.setAttribute("aria-pressed", String(date === selectedDate));
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
  const imported = mode === "message" ? template : null;
  const shift = {
    id: crypto.randomUUID(), date: imported?.date || today(), start: imported?.start || (mode === "message" ? "" : template?.start || previous?.start || ""), end: imported?.end || (mode === "message" ? "" : template?.end || previous?.end || ""), holiday: false
  };
  if (mode === "message" && Number.isFinite(imported?.breakMinutes)) shift.breakMinutes = Math.max(0, imported.breakMinutes);
  if (mode === "message" && imported?.template) shift.templateName = imported.template;
  if (mode === "template" && template) shift.templateName = template.name;
  S.rows.push(shift);
  if (mode === "message") return shift;
  allTime = false;
  activeFilter = "all";
  selectedDate = null;
  q("#month-filter").value = today().slice(0, 7);
  if (!save()) return;
  const card = [...q("#list").querySelectorAll(".shift-card")].find(item => item.dataset.shiftId === String(shift.id));
  const startInput = card?.querySelector('[data-k="start"]');
  if (activeTab === "history") {
    startInput?.focus();
    startInput?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  const message = template ? "Đã lưu ca " + template.name + " hôm nay · " + template.start + "–" + template.end : mode === "repeat" && previous ? "Đã lặp giờ ca trước · kiểm tra ngày và Lễ/Tết" : "Ca mới đã thêm · nhập giờ để tính lương";
  showToast(message);
}
function showToast(message, undo = false) {
  clearTimeout(toastTimer);
  q("#toast-message").textContent = message;
  q("#undo-delete").hidden = !undo;
  q("#toast").hidden = false;
  toastTimer = setTimeout(() => { q("#toast").hidden = true; undoState = null; }, undo ? 10000 : 6000);
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
  if (undoState.type === "batch") {
    const beforeRows = S.rows;
    const batch = undoState;
    const ids = new Set(undoState.ids);
    S.rows = S.rows.filter(shift => !ids.has(shift.id));
    undoState = null;
    clearTimeout(toastTimer);
    q("#toast").hidden = true;
    if (!save()) {
      S.rows = beforeRows;
      undoState = batch;
      showToast("Không thể hoàn tác vì chưa lưu được thay đổi.", true);
    }
    return;
  }
  S.rows.splice(Math.min(undoState.index, S.rows.length), 0, undoState.shift);
  undoState = null;
  clearTimeout(toastTimer);
  q("#toast").hidden = true;
  save();
}
function render() {
  applyTheme();
  applyBentoOrder();
  refreshSummary();
  renderStreak();
  renderClock();
  renderTodayShifts();
  renderTemplates();
  renderCalendar();
  renderList();
}
function activateTab(name) {
  const update = () => {
    activeTab = name;
    document.querySelectorAll("[data-tab-panel]").forEach(panel => {
      panel.hidden = panel.dataset.tabPanel !== name;
      panel.classList.toggle("active-tab-panel", !panel.hidden);
    });
    document.querySelectorAll("[data-tab]").forEach(button => {
      if (button.dataset.tab === name) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (name === "history") { renderCalendar(); renderList(); }
    if (name === "today") { renderTodayShifts(); renderClock(); }
  };
  if (activeTab === name) return;
  if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) document.startViewTransition(update);
  else update();
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
  const backup = { app: "cham-cong-mobile", version: 3, exportedAt: new Date().toISOString(), settings: S.settings, preferences: S.preferences, templates: S.templates, rows: S.rows };
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
      if (backup.preferences && typeof backup.preferences === "object") S.preferences = { ...S.preferences, ...backup.preferences };
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

let messageImportTrigger = null;
let messageImportCommitted = false;
let messageImportDrafts = [];
let messageImportGlobalWarnings = [];
const messageImportDialog = q("#message-import-dialog");
function openMessageImport(trigger, initialText = "") {
  messageImportTrigger = trigger;
  messageImportCommitted = false;
  messageImportDrafts = [];
  messageImportGlobalWarnings = [];
  q("#message-import-text").value = initialText;
  q("#message-import-input-step").hidden = false;
  q("#message-import-preview-step").hidden = true;
  q("#message-import-dialog").showModal();
  if (!initialText.trim()) requestAnimationFrame(() => q("#message-import-text").focus());
}
function showImportNotes(element, title, lines) {
  element.replaceChildren();
  element.hidden = !lines.length;
  if (!lines.length) return;
  const heading = document.createElement("strong");
  heading.textContent = title;
  const list = document.createElement("ul");
  lines.forEach(line => { const item = document.createElement("li"); item.textContent = line; list.append(item); });
  element.append(heading, list);
}
function importInterval(shift) {
  if (!isValidDate(shift.date) || !validTime(shift.start) || !validTime(shift.end)) return null;
  const [year, month, day] = shift.date.split("-").map(Number);
  const base = Date.UTC(year, month - 1, day) / 60000;
  const startMinute = minutes(shift.start);
  let endMinute = minutes(shift.end);
  if (endMinute <= startMinute) endMinute += 1440;
  return { start: base + startMinute, end: base + endMinute };
}
function importOverlaps(shift) {
  const interval = importInterval(shift);
  if (!interval) return [];
  return S.rows.filter(existing => {
    if (!isComplete(existing)) return false;
    const other = importInterval(existing);
    return other && interval.start < other.end && other.start < interval.end;
  });
}
function importWarnings(item) {
  const shift = item.shift;
  const warnings = [...item.baseWarnings];
  if (!isValidDate(shift.date)) warnings.push("Ngày không hợp lệ.");
  else {
    const [year, month, day] = shift.date.split("-").map(Number);
    const [todayYear, todayMonth, todayDay] = today().split("-").map(Number);
    const dayDistance = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(todayYear, todayMonth - 1, todayDay)) / 86400000);
    if (dayDistance < -90) warnings.push("Ngày đã qua hơn 90 ngày, hãy kiểm tra.");
    if (dayDistance > 365) warnings.push("Ngày cách hôm nay hơn một năm, hãy kiểm tra.");
  }
  const interval = importInterval(shift);
  if (interval && interval.end - interval.start > 16 * 60) warnings.push("Ca dài hơn 16 giờ, hãy kiểm tra.");
  const overlaps = importOverlaps(shift);
  if (overlaps.length) {
    const exact = overlaps.some(row => row.date === shift.date && row.start === shift.start && row.end === shift.end);
    warnings.push(exact ? "Đã có ca ngày này (trùng hoàn toàn)." : "Đã có ca ngày này; giờ làm đang chồng với ca đã lưu.");
  }
  const current = importInterval(shift);
  if (current) messageImportDrafts.forEach(otherItem => {
    if (otherItem === item) return;
    const other = importInterval(otherItem.shift);
    if (other && current.start < other.end && other.start < current.end) {
      warnings.push("Trùng giờ với ca " + otherItem.shift.date + " " + otherItem.shift.start + "–" + otherItem.shift.end + ".");
    }
  });
  return [...new Set(warnings)];
}
function updateImportSelectionCount() {
  const count = messageImportDrafts.filter(item => item.selected).length;
  q("#commit-message-import").textContent = "Thêm " + count + " ca";
  q("#commit-message-import").disabled = count === 0;
  q("#message-import-selected").textContent = "Đã chọn " + count + "/" + messageImportDrafts.length + " ca.";
}
function renderImportRows() {
  const list = q("#message-import-rows");
  list.replaceChildren();
  messageImportDrafts.forEach((item, index) => {
    const shift = item.shift;
    const warnings = importWarnings(item);
    const card = document.createElement("article");
    card.className = "import-shift" + (warnings.length ? " has-warning" : "");
    const header = document.createElement("div");
    header.className = "import-shift-head";
    const checkLabel = document.createElement("label");
    checkLabel.className = "import-select";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.selected;
    checkbox.setAttribute("aria-label", "Chọn ca " + (index + 1) + " ngày " + shift.date);
    checkbox.addEventListener("change", () => { item.selected = checkbox.checked; updateImportSelectionCount(); });
    const checkText = document.createElement("span");
    checkText.textContent = "Thêm ca " + (index + 1);
    checkLabel.append(checkbox, checkText);
    header.append(checkLabel);
    if (shift.overnight || (validTime(shift.start) && validTime(shift.end) && minutes(shift.end) <= minutes(shift.start))) {
      const overnight = document.createElement("span");
      overnight.className = "import-overnight";
      overnight.textContent = "Qua đêm";
      header.append(overnight);
    }
    const fields = document.createElement("div");
    fields.className = "import-shift-fields";
    const addField = (labelText, type, value, field, step) => {
      const label = document.createElement("label");
      label.textContent = labelText;
      const input = document.createElement("input");
      input.type = type;
      input.value = value || "";
      input.dataset.field = field;
      input.dataset.index = String(index);
      if (type === "time") input.step = String(step || 1800);
      if (type === "number") { input.min = "0"; input.max = "960"; input.step = "15"; input.inputMode = "numeric"; }
      input.setAttribute("aria-label", labelText + " ca " + (index + 1));
      input.addEventListener("change", () => {
        shift[field] = type === "number" ? Number(input.value) : input.value;
        if (field === "date" || field === "start" || field === "end") {
          if (validTime(shift.start) && validTime(shift.end)) shift.overnight = minutes(shift.end) <= minutes(shift.start);
          const overlaps = importOverlaps(shift);
          const exact = overlaps.some(row => row.date === shift.date && row.start === shift.start && row.end === shift.end);
          if (item.autoDuplicateDeselected && !exact) { item.selected = true; item.autoDuplicateDeselected = false; }
          else if (exact && !item.autoDuplicateDeselected) { item.selected = false; item.autoDuplicateDeselected = true; }
        }
        renderImportRows();
        const next = list.querySelector('[data-index="' + index + '"][data-field="' + field + '"]');
        next?.focus();
        updateImportSelectionCount();
      });
      label.append(input);
      fields.append(label);
    };
    addField("Ngày", "date", shift.date, "date");
    addField("Giờ vào", "time", shift.start, "start");
    addField("Giờ ra", "time", shift.end, "end");
    if (shift.breakMinutes !== undefined) addField("Nghỉ (phút)", "number", shift.breakMinutes, "breakMinutes", 15);
    const source = document.createElement("p");
    source.className = "import-source";
    source.textContent = "Tin nhắn: " + shift.source;
    card.append(header, fields, source);
    if (shift.template) {
      const template = document.createElement("p");
      template.className = "import-source";
      template.textContent = "Mẫu ca: " + shift.template;
      card.append(template);
    }
    if (warnings.length) {
      const warningList = document.createElement("ul");
      warningList.className = "import-shift-warnings";
      warnings.forEach(warning => { const row = document.createElement("li"); row.textContent = "⚠ " + warning; warningList.append(row); });
      card.append(warningList);
    }
    list.append(card);
  });
  updateImportSelectionCount();
}
function analyzeMessageSchedule() {
  const text = q("#message-import-text").value.trim();
  if (!text) {
    q("#message-import-preview-step").hidden = true;
    q("#message-import-input-step").hidden = false;
    q("#message-import-input-status").textContent = "Dán nội dung lịch làm trước khi phân tích.";
    q("#message-import-text").focus();
    return;
  }
  if (!window.ScheduleParser?.parseSchedule) {
    q("#message-import-input-status").textContent = "Chưa tải được bộ đọc lịch. Hãy tải lại ứng dụng.";
    return;
  }
  const result = window.ScheduleParser.parseSchedule(text, { templates: S.templates, today: today(), snapMinutes: 30 });
  messageImportGlobalWarnings = result.shifts.length > 60 ? ["Tìm thấy hơn 60 ca. Hãy rà kỹ danh sách trước khi thêm."] : [];
  messageImportDrafts = result.shifts.map(shift => {
    const exact = S.rows.some(row => row.date === shift.date && row.start === shift.start && row.end === shift.end);
    const breakMinutes = Number.isFinite(shift.breakMinutes) ? shift.breakMinutes : 30;
    return { shift: { ...shift, breakMinutes }, baseWarnings: [...shift.warnings], selected: !exact, autoDuplicateDeselected: exact };
  });
  showImportNotes(q("#message-import-assumptions"), "Giả định ngày", result.assumptions || []);
  showImportNotes(q("#message-import-off"), "Ngày nghỉ (không thêm)", (result.off || []).map(item => item.date + " · " + item.source));
  showImportNotes(q("#message-import-ignored"), "Dòng chưa hiểu", result.ignored || []);
  showImportNotes(q("#message-import-warnings"), "Lưu ý", messageImportGlobalWarnings);
  const warningCount = messageImportDrafts.filter(item => importWarnings(item).length).length;
  const summary = messageImportDrafts.length
    ? "Tìm thấy " + messageImportDrafts.length + " ca, " + warningCount + " ca có cảnh báo" + (result.off.length ? ", " + result.off.length + " ngày nghỉ" : "") + (result.ignored.length ? ", " + result.ignored.length + " dòng chưa hiểu" : "") + "."
    : "Chưa nhận ra ca nào. Hãy thử dạng “T2 14h-22h, T4 6h-14h” hoặc chọn mẫu ca đã lưu.";
  q("#message-import-status").textContent = summary;
  q("#message-import-input-step").hidden = true;
  q("#message-import-preview-step").hidden = false;
  renderImportRows();
  requestAnimationFrame(() => q("#message-import-preview-title").focus());
}
function commitMessageSchedule() {
  const selected = messageImportDrafts.filter(item => item.selected);
  if (!selected.length) return;
  if (selected.some(item => !isValidDate(item.shift.date) || !validTime(item.shift.start) || !validTime(item.shift.end))) {
    q("#message-import-status").textContent = "Hãy kiểm tra ngày và giờ của các ca đã chọn.";
    return;
  }
  const beforeRows = S.rows.slice();
  const beforeAllTime = allTime;
  const added = selected.map(item => addShift("message", item.shift));
  setPeriodToAll();
  q("#month-filter").value = selected[0].shift.date.slice(0, 7);
  if (!save()) { S.rows = beforeRows; allTime = beforeAllTime; return; }
  undoState = { type: "batch", ids: added.map(shift => shift.id) };
  messageImportCommitted = true;
  messageImportDialog.close();
  activateTab("history");
  requestAnimationFrame(() => q("#work-title").focus());
  showToast("Đã thêm " + added.length + " ca", true);
}
if (!navigator.clipboard?.readText) {
  q("#paste-schedule").hidden = true;
  q("#quick-import-paste").hidden = true;
}
messageImportDialog.addEventListener("close", () => {
  if (messageImportCommitted) { messageImportCommitted = false; return; }
  if (messageImportTrigger?.isConnected) messageImportTrigger.focus();
});
q("#add-from-message-today").addEventListener("click", event => openMessageImport(event.currentTarget));
q("#add-from-message-history").addEventListener("click", () => { q("#more").open = false; openMessageImport(q("#more summary")); });
q("#quick-import-analyze").addEventListener("click", event => {
  const text = q("#quick-import-text").value.trim();
  openMessageImport(event.currentTarget, text);
  if (text) analyzeMessageSchedule();
});
q("#quick-import-paste").addEventListener("click", async () => {
  try { q("#quick-import-text").value = await navigator.clipboard.readText(); q("#quick-import-text").focus(); }
  catch { showToast("Không đọc được clipboard. Hãy dán trực tiếp vào ô lịch."); }
});
q("#close-message-import").addEventListener("click", () => messageImportDialog.close());
q("#cancel-message-import").addEventListener("click", () => messageImportDialog.close());
q("#cancel-message-preview").addEventListener("click", () => messageImportDialog.close());
q("#edit-message-import").addEventListener("click", () => {
  q("#message-import-preview-step").hidden = true;
  q("#message-import-input-step").hidden = false;
  requestAnimationFrame(() => q("#message-import-text").focus());
});
q("#paste-schedule").addEventListener("click", async () => {
  try { q("#message-import-text").value = await navigator.clipboard.readText(); q("#message-import-text").focus(); }
  catch { showToast("Không đọc được clipboard. Hãy dán nội dung vào ô bằng thao tác Dán của điện thoại."); }
});
q("#analyze-schedule").addEventListener("click", analyzeMessageSchedule);
q("#commit-message-import").addEventListener("click", commitMessageSchedule);

document.addEventListener("click", event => { if (!q("#more").contains(event.target)) q("#more").open = false; });
document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => activateTab(button.dataset.tab)));
q("#add-today").addEventListener("click", () => addShift());
const bentoGrid = q("#bento-grid");
let bentoDragState = null;
bentoGrid.addEventListener("pointerdown", event => {
  const handle = event.target.closest("[data-drag-handle]");
  const card = handle?.closest("[data-bento-card]");
  if (!handle || !card || (event.pointerType === "mouse" && event.button !== 0)) return;
  bentoDragState = { pointerId: event.pointerId, card, order: [...bentoGrid.children] };
  card.setPointerCapture?.(event.pointerId);
  card.classList.add("dragging");
  handle.setAttribute("aria-grabbed", "true");
  event.preventDefault();
});
bentoGrid.addEventListener("pointermove", event => {
  const card = bentoDragState?.card;
  if (!card || bentoDragState.pointerId !== event.pointerId) return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-bento-card]");
  if (!target || target === card) return;
  const bounds = target.getBoundingClientRect();
  const sourceBounds = card.getBoundingClientRect();
  const sameRow = Math.abs(sourceBounds.top - bounds.top) < Math.min(sourceBounds.height, bounds.height) / 2;
  const before = sameRow ? event.clientX < bounds.left + bounds.width / 2 : event.clientY < bounds.top + bounds.height / 2;
  if (before && card.nextElementSibling === target) return;
  if (!before && target.nextElementSibling === card) return;
  target.insertAdjacentElement(before ? "beforebegin" : "afterend", card);
});
bentoGrid.addEventListener("pointerup", event => {
  const state = bentoDragState;
  if (!state || state.pointerId !== event.pointerId) return;
  const { card, order } = state;
  card.classList.remove("dragging");
  card.querySelector("[data-drag-handle]")?.setAttribute("aria-grabbed", "false");
  bentoDragState = null;
  const changed = order.some((item, index) => bentoGrid.children[index] !== item);
  if (changed) { saveBentoOrder(); showToast("Đã đổi vị trí thẻ"); }
});
bentoGrid.addEventListener("pointercancel", event => {
  const state = bentoDragState;
  if (!state || state.pointerId !== event.pointerId) return;
  state.order.forEach(card => bentoGrid.append(card));
  state.card.classList.remove("dragging");
  state.card.querySelector("[data-drag-handle]")?.setAttribute("aria-grabbed", "false");
  bentoDragState = null;
});
bentoGrid.addEventListener("keydown", event => {
  if (!event.target.closest("[data-drag-handle]") || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const card = event.target.closest("[data-bento-card]");
  const sibling = event.key === "ArrowUp" ? card.previousElementSibling : card.nextElementSibling;
  if (sibling) { q("#bento-grid").insertBefore(card, event.key === "ArrowUp" ? sibling : sibling.nextElementSibling); saveBentoOrder(); const position = [...q("#bento-grid").children].indexOf(card) + 1; showToast(`Đã chuyển ${card.querySelector("h2")?.textContent || "thẻ"} lên vị trí ${position}`); }
});
let slideProgress = 0;
let sliderPointer = null;
let suppressSliderClickUntil = 0;
const slider = q("#shift-slider");
const sliderHandle = q("#slide-handle");
function resetSlider() {
  slideProgress = 0;
  slider.style.setProperty("--slide-x", "0px");
  slider.style.setProperty("--slide-progress", "0%");
  slider.style.setProperty("--slide-fill", `${sliderHandle.offsetWidth}px`);
  slider.classList.remove("is-dragging");
  q("#slide-status").textContent = "Chưa xác nhận";
}
slider.addEventListener("pointerdown", event => {
  if (!event.target.closest("#slide-handle") || (event.pointerType === "mouse" && event.button !== 0)) return;
  sliderPointer = event.pointerId;
  slider.classList.add("is-dragging");
  slider.setPointerCapture(event.pointerId);
  event.preventDefault();
});
slider.addEventListener("pointermove", event => {
  if (event.pointerId !== sliderPointer) return;
  const rect = slider.getBoundingClientRect();
  const max = Math.max(1, rect.width - sliderHandle.offsetWidth - 10);
  const x = Math.max(0, Math.min(max, event.clientX - rect.left - sliderHandle.offsetWidth / 2 - 5));
  slideProgress = x / max;
  slider.style.setProperty("--slide-x", `${x}px`);
  slider.style.setProperty("--slide-progress", `${slideProgress * 100}%`);
  slider.style.setProperty("--slide-fill", `${x + sliderHandle.offsetWidth}px`);
  q("#slide-status").textContent = `${Math.round(slideProgress * 100)} phần trăm`;
});
slider.addEventListener("pointerup", event => {
  if (event.pointerId !== sliderPointer) return;
  const confirmed = slideProgress >= 0.82;
  sliderPointer = null;
  suppressSliderClickUntil = Date.now() + 500;
  resetSlider();
  if (confirmed) handleClockAction();
});
slider.addEventListener("pointercancel", () => { sliderPointer = null; resetSlider(); });
sliderHandle.addEventListener("click", event => {
  if (event.detail !== 0 || Date.now() < suppressSliderClickUntil) { event.preventDefault(); return; }
  handleClockAction();
});
q("#gear").addEventListener("click", () => {
  for (const key of Object.keys(defaults)) q("#" + key).value = S.settings[key];
  applyTheme();
  q("#dlg").showModal();
});
document.querySelectorAll(".palette-option[data-palette]").forEach(button => button.addEventListener("click", () => {
  S.preferences.palette = button.dataset.palette;
  if (persist()) { applyTheme(); showToast(`Đã chọn giao diện ${button.dataset.paletteName}`); }
}));
q("#theme-toggle").addEventListener("click", () => {
  const root = document.documentElement;
  root.classList.add("theme-fade");
  S.preferences.theme = S.preferences.theme === "dark" ? "light" : "dark";
  if (persist()) {
    applyTheme();
    setTimeout(() => root.classList.remove("theme-fade"), 360);
    showToast(`Đã chuyển sang giao diện ${S.preferences.theme === "dark" ? "tối" : "sáng"}`);
  } else root.classList.remove("theme-fade");
});
const gyroToggle = q("#jar-gyro-toggle");
let gyroActive = false;
let gyroReceived = false;
let gyroOffset = 0;
let gyroTilt = 0;
let gyroTimer = null;
function handleDeviceTilt(event) {
  if (!Number.isFinite(event.gamma) && !Number.isFinite(event.alpha)) return;
  gyroReceived = true;
  const gamma = Number.isFinite(event.gamma) ? event.gamma : 0;
  const alpha = Number.isFinite(event.alpha) ? ((event.alpha % 360) + 360) % 360 : 0;
  const target = (alpha / 360) * 64 - Math.max(-10, Math.min(10, gamma / 40 * 10));
  const tiltTarget = Math.max(-12, Math.min(12, -gamma / 40 * 12));
  gyroOffset += (target - gyroOffset) * 0.22;
  gyroTilt += (tiltTarget - gyroTilt) * 0.2;
  const jar = q(".goal-jar");
  jar.style.setProperty("--gyro-shift", `${gyroOffset.toFixed(2)}px`);
  jar.style.setProperty("--gyro-tilt", `${gyroTilt.toFixed(2)}deg`);
  if (gyroTimer) { clearTimeout(gyroTimer); gyroTimer = null; }
  gyroToggle.textContent = "Gyro bật";
}
function stopGyro() {
  window.removeEventListener("deviceorientation", handleDeviceTilt);
  clearTimeout(gyroTimer);
  gyroTimer = null;
  gyroActive = false;
  gyroReceived = false;
  gyroOffset = 0;
  gyroTilt = 0;
  q(".goal-jar").style.setProperty("--gyro-shift", "0px");
  q(".goal-jar").style.setProperty("--gyro-tilt", "0deg");
  gyroToggle.textContent = "Gyro";
  gyroToggle.setAttribute("aria-pressed", "false");
  gyroToggle.setAttribute("aria-label", "Bật sóng theo cảm biến nghiêng");
  gyroToggle.title = "Bật sóng theo cảm biến nghiêng";
}
gyroToggle.addEventListener("click", async () => {
  if (gyroActive) { stopGyro(); showToast("Đã tắt cảm biến nghiêng."); return; }
  if (!("DeviceOrientationEvent" in window)) { showToast("Trình duyệt này không hỗ trợ cảm biến nghiêng."); return; }
  try {
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") { showToast("Chưa được cấp quyền cảm biến nghiêng."); return; }
    }
    window.addEventListener("deviceorientation", handleDeviceTilt, { passive: true });
    gyroActive = true;
    gyroReceived = false;
    const jar = q(".goal-jar");
    const backDuration = 6 + Math.random() * 3;
    const frontDuration = 3.8 + Math.random() * 3.2;
    jar.style.setProperty("--wave-back-duration", `${backDuration.toFixed(2)}s`);
    jar.style.setProperty("--wave-front-duration", `${frontDuration.toFixed(2)}s`);
    jar.style.setProperty("--wave-back-delay", `${-(Math.random() * backDuration).toFixed(2)}s`);
    jar.style.setProperty("--wave-front-delay", `${-(Math.random() * frontDuration).toFixed(2)}s`);
    gyroToggle.textContent = "Đang chờ…";
    gyroToggle.setAttribute("aria-pressed", "true");
    gyroToggle.setAttribute("aria-label", "Đang chờ dữ liệu cảm biến nghiêng; chạm để tắt");
    gyroToggle.title = "Đang chờ dữ liệu cảm biến nghiêng";
    gyroTimer = setTimeout(() => {
      if (!gyroActive || gyroReceived) return;
      stopGyro();
      showToast("iPhone chưa gửi dữ liệu nghiêng. Hãy mở app bằng Safari và cho phép Motion & Orientation Access.");
    }, 2500);
  } catch {
    showToast("Không được cấp quyền cảm biến. Hãy cho phép Motion & Orientation trong cài đặt Safari.");
  }
});document.querySelectorAll("[data-goal]").forEach(button => button.addEventListener("click", () => {
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
applyBentoOrder();
render();
updateNetworkStatus();
setInterval(renderClock, 1000);
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => showToast("Chế độ offline chưa khả dụng trên trình duyệt này."));
}
