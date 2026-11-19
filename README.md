# Chấm công cá nhân

Ứng dụng chấm công cá nhân, tối ưu cho điện thoại. Dữ liệu và thiết lập lưu trong `localStorage` trên thiết bị hiện tại; không đồng bộ lên Google Sheets hay máy chủ.

## Tính năng

- Thêm và sửa ca thủ công; giờ chọn theo bước 30 phút, danh sách xếp ngày/giờ cũ đến mới.
- Kỳ lương mặc định tính từ ngày 21 tháng trước đến hết ngày 20 của tháng được chọn. Ví dụ chọn tháng 11: kỳ 21/10–20/11.
- Lịch kỳ lương và heatmap dạng GitHub; màu ô đậm dần theo lương ước tính trong ngày, chạm ô để lọc ca.
- Mẫu ca, lặp giờ ca trước, hoàn tác xóa, xuất CSV và sao lưu/khôi phục JSON.
- Hũ mục tiêu lương mặc định 2.500.000 ₫, chọn nhanh 1,5 / 2,5 / 5 triệu hoặc nhập mức khác.
- Giao diện sáng/tối; lựa chọn được lưu trên trình duyệt.
- PWA cài lên màn hình chính và dùng offline sau khi tải ứng dụng lần đầu.

## Quy tắc tính hiện tại

- Ca qua nửa đêm được tính sang ngày kế tiếp.
- Giờ đêm từ 22:00 đến 02:00, phụ cấp mặc định +30% trên giờ trong khoảng này.
- Ca Lễ/Tết nhân 300% lương giờ công (cộng thêm 200%); phụ cấp đêm cộng riêng.
- Ca nhập tay trừ giờ nghỉ mặc định trong Thiết lập.

Mức lương và mục tiêu có thể sửa trong Thiết lập. App không tự tra ngày nghỉ lễ Việt Nam; kết quả là ước tính theo cấu hình cá nhân.

## Chạy cục bộ

Mở `index.html` để xem giao diện. Để cài PWA và dùng service worker, phục vụ thư mục qua HTTPS hoặc localhost.

## Ghi công hình minh họa

Hình bình trong hũ mục tiêu dựa trên hình Vecteezy do người dùng cung cấp. [Vecteezy.com](https://www.vecteezy.com/).
