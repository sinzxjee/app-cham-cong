# Chấm công cá nhân

Ứng dụng chấm công cá nhân, tối ưu cho điện thoại. Dữ liệu và thiết lập lưu trong `localStorage` trên thiết bị hiện tại; không đồng bộ lên Google Sheets hay máy chủ.

## Tính năng

- Bấm giờ vào ca, ghi giờ nghỉ, tiếp tục và kết thúc ca.
- Thêm ca thủ công với bước chọn giờ 30 phút; danh sách xếp ngày/giờ cũ đến mới.
- Lịch tháng, bộ lọc ca Lễ/Tết và ca có giờ đêm.
- Mẫu ca, lặp giờ ca trước, hoàn tác xóa, xuất CSV, sao lưu/khôi phục JSON.
- Dashboard biểu đồ lương theo ngày trong tháng và theo tháng trong 6 tháng gần nhất; đường mục tiêu hiển thị trong biểu đồ tháng.
- Hũ mục tiêu mặc định 2.500.000 ₫, có nút chọn nhanh 1,5 / 2,5 / 5 triệu và cài đặt số tùy ý.
- Chuyển giao diện sáng/tối; lựa chọn được lưu trên trình duyệt.
- PWA cài lên màn hình chính và dùng offline sau khi tải ứng dụng lần đầu.

## Quy tắc tính hiện tại

- Ca qua nửa đêm được tính sang ngày kế tiếp.
- Giờ đêm từ 22:00 đến 02:00, phụ cấp mặc định +30% trên giờ trong khoảng này.
- Ca Lễ/Tết nhân 300% lương giờ công (tức cộng thêm 200%); phụ cấp đêm cộng riêng.
- Ca nhập tay trừ giờ nghỉ mặc định; ca bấm giờ trừ các khoảng nghỉ đã ghi.

Mức lương và mục tiêu có thể sửa trong Thiết lập. App không tự tra ngày nghỉ lễ Việt Nam. Dashboard chỉ tổng hợp ca đã nhập, kết quả là ước tính theo cấu hình cá nhân.

## Chạy cục bộ

Mở `index.html` để xem giao diện. Để cài PWA và dùng service worker, phục vụ thư mục qua HTTPS hoặc localhost.

## Ghi công hình minh họa

Hình bình trong hũ mục tiêu dựa trên hình Vecteezy do người dùng cung cấp. [Vecteezy.com](https://www.vecteezy.com/).
