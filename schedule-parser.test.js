const assert = require('assert');
const { parseSchedule } = require('./schedule-parser');
const TODAY = '2026-11-20'; // thứ Sáu
const run = (t, o) => parseSchedule(t, Object.assign({ today: TODAY }, o));
const brief = r => r.shifts.map(s => `${s.date} ${s.start}-${s.end}${s.overnight ? '*' : ''}`);
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('liệt kê nhiều ngày + ngày nghỉ', () => {
  const r = run('T2 14h-22h, T4 6h-14h, CN nghỉ');
  assert.deepStrictEqual(brief(r), ['2026-11-23 14:00-22:00', '2026-11-25 06:00-14:00']);
  assert.deepStrictEqual(r.off.map(o => o.date), ['2026-11-22']);
});
ok('tiêu đề tuần + ca qua nửa đêm', () => {
  const r = run('Lịch tuần 23/11 - 29/11\nT2: 14:00-22:00\nT3: 6h-14h\nT7 22h-6h');
  assert.deepStrictEqual(brief(r), ['2026-11-23 14:00-22:00', '2026-11-24 06:00-14:00', '2026-11-28 22:00-06:00*']);
  assert.strictEqual(r.ignored.length, 0);
});
ok('nhiều thứ dùng chung một giờ', () => {
  assert.deepStrictEqual(brief(run('T2, T3, T5 14h-22h')), ['2026-11-23 14:00-22:00', '2026-11-24 14:00-22:00', '2026-11-26 14:00-22:00']);
});
ok('khoảng thứ T2-T6', () => {
  const r = run('T2-T6 8h-17h');
  assert.strictEqual(r.shifts.length, 5);
  assert.strictEqual(r.shifts[0].date, '2026-11-23'); assert.strictEqual(r.shifts[4].date, '2026-11-27');
});
ok('"thứ hai đến thứ sáu"', () => {
  assert.strictEqual(run('thứ hai đến thứ sáu 8h-17h').shifts.length, 5);
});
ok('ngày mai, hôm nay', () => {
  assert.deepStrictEqual(brief(run('mai 8h-17h')), ['2026-11-21 08:00-17:00']);
  assert.deepStrictEqual(brief(run('hôm nay 14h-22h')), ['2026-11-20 14:00-22:00']);
});
ok('ngày cụ thể, phút lẻ và giờ nghỉ', () => {
  const r = run('20/11 14h30-22h nghỉ 30p');
  assert.deepStrictEqual(brief(r), ['2026-11-20 14:30-22:00']);
  assert.strictEqual(r.shifts[0].breakMinutes, 30);
});
ok('"nghỉ" trong ca không bị hiểu thành ngày nghỉ', () => {
  const r = run('T2 8h-17h nghỉ 1h');
  assert.strictEqual(r.shifts.length, 1); assert.strictEqual(r.off.length, 0); assert.strictEqual(r.shifts[0].breakMinutes, 60);
});
ok('dùng mẫu ca', () => {
  const r = run('T3 ca sáng, T5 ca đêm');
  assert.deepStrictEqual(brief(r), ['2026-11-24 06:00-14:00', '2026-11-26 22:00-06:00*']);
  assert.strictEqual(r.shifts[0].template, 'Ca sáng');
});
ok('mẫu ca của người dùng', () => {
  const r = run('T2 ca A', { templates: [{ name: 'Ca A', start: '07:30', end: '15:30' }] });
  assert.deepStrictEqual(brief(r), ['2026-11-23 07:30-15:30']);
});
ok('chưa có mẫu thì báo, không đoán', () => {
  const r = run('T2 ca tối', { templates: [{ name: 'Ca sáng', start: '06:00', end: '14:00' }] });
  assert.strictEqual(r.shifts.length, 0); assert.ok(r.ignored[0].includes('chưa có mẫu'));
});
ok('giờ kèm chiều/tối/sáng', () => {
  assert.deepStrictEqual(brief(run('hôm nay 2h chiều - 10h tối')), ['2026-11-20 14:00-22:00']);
  assert.deepStrictEqual(brief(run('hôm nay 2pm-10pm')), ['2026-11-20 14:00-22:00']);
  assert.deepStrictEqual(brief(run('hôm nay 10h đêm - 6h sáng')), ['2026-11-20 22:00-06:00*']);
});
ok('giờ không có "h" bị cảnh báo', () => {
  const r = run('T2 8-17');
  assert.deepStrictEqual(brief(r), ['2026-11-23 08:00-17:00']); assert.ok(r.shifts[0].warnings.length === 1);
});
ok('làm tròn 30 phút có cảnh báo', () => {
  const r = run('T2 14h10-22h');
  assert.strictEqual(r.shifts[0].start, '14:00'); assert.ok(r.shifts[0].warnings[0].includes('làm tròn'));
});
ok('báo trùng giờ', () => {
  const r = run('T2 8h-17h, T2 16h-22h');
  assert.ok(r.shifts.every(s => s.warnings.some(w => w.includes('Trùng giờ'))));
});
ok('tuần sau / tuần này', () => {
  assert.deepStrictEqual(brief(run('tuần sau T2 14h-22h')), ['2026-11-23 14:00-22:00']);
  assert.deepStrictEqual(brief(run('tuần này T2 14h-22h')), ['2026-11-16 14:00-22:00']);
});
ok('ngày có năm và ISO', () => {
  assert.deepStrictEqual(brief(run('25/12/2026 22h-6h')), ['2026-12-25 22:00-06:00*']);
  assert.deepStrictEqual(brief(run('2026-12-01 8h-17h')), ['2026-12-01 08:00-17:00']);
});
ok('ngày không hợp lệ', () => {
  const r = run('31/11 8h-17h'); assert.strictEqual(r.shifts.length, 0);
});
ok('chuỗi không liên quan', () => {
  const r = run('Chào em, tuần này lịch như sau nhé'); assert.strictEqual(r.shifts.length, 0); assert.ok(r.ignored.length > 0);
});
ok('bỏ gạch đầu dòng', () => {
  assert.strictEqual(run('- T2 8h-17h\n- T3 8h-17h').shifts.length, 2);
});
ok('không đoán Ca sáng nếu chưa lưu mẫu', () => {
  const r = run('T3 ca sáng', { templates: [] });
  assert.strictEqual(r.shifts.length, 0);
  assert.ok(r.ignored[0].includes('chưa có mẫu'));
});
ok('ca dài hơn 16 giờ có cảnh báo', () => {
  const r = run('T2 0h-17h');
  assert.ok(r.shifts[0].warnings.some(w => w.includes('dài hơn 16 giờ')));
});
ok('trên 60 ca vẫn trả đủ để xem trước', () => {
  const text = Array(61).fill('2026-11-20 8h-17h').join(', ');
  assert.strictEqual(run(text).shifts.length, 61);
});
console.log('\n' + n + ' kiểm thử đạt');
