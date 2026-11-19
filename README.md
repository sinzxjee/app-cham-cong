# Chấm công cá nhân

Ứng dụng chấm công cá nhân, tối ưu cho điện thoại. Dữ liệu và thiết lập được lưu trong `localStorage` của trình duyệt trên thiết bị hiện tại; ứng dụng không đồng bộ lên Google Sheets hay máy chủ.

## Tính năng

- Bấm giờ vào ca, ghi thời gian nghỉ, tiếp tục và kết thúc ca.
- Thêm ca thủ công; giờ vào/ra chọn theo bước 30 phút. Danh sách sắp xếp ngày và giờ từ cũ đến mới.
- Lịch tháng, lọc ca ngày Lễ/Tết và ca có giờ đêm.
- Mẫu ca, lặp ca trước, xuất CSV, sao lưu/khôi phục JSON và hoàn tác xóa một ca.
- Bảng lương tách lương giờ công, phần cộng Lễ/Tết và phụ cấp giờ đêm.
- Hũ mục tiêu mặc định 2.500.000 ₫; mực nước chuyển động theo phần trăm lương của kỳ đang xem. Có thể đổi mục tiêu trong Thiết lập.
- PWA cài lên màn hình chính và dùng offline sau khi tải ứng dụng lần đầu.

## Quy tắc tính hiện tại

- Ca qua nửa đêm được tính sang ngày kế tiếp.
- Giờ đêm từ 22:00 đến 02:00, phụ cấp mặc định +30% trên giờ thuộc khoảng này.
- Đánh dấu Lễ/Tết áp dụng tổng lương 300% (lương cơ bản cộng thêm 200%); phụ cấp đêm được cộng riêng.
- Ca nhập tay trừ giờ nghỉ mặc định trong Thiết lập. Ca bấm giờ trừ các khoảng nghỉ đã ghi.

Các mức có thể điều chỉnh trong Thiết lập. Kết quả là ước tính theo cấu hình cá nhân, không tự tra lịch nghỉ lễ Việt Nam.

## Chạy cục bộ

Mở `index.html` để xem giao diện. Để cài PWA và dùng service worker, phục vụ thư mục này qua HTTPS hoặc localhost.

## Ghi công hình minh họa

Hình bình trong hũ mục tiêu dựa trên hình Vecteezy do người dùng cung cấp. Trang nguồn: [Vecteezy.com](https://www.vecteezy.com/).
