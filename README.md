# Chấm công cá nhân

Ứng dụng chấm công cá nhân tối ưu cho điện thoại. Dữ liệu và thiết lập lưu trong `localStorage` trên thiết bị hiện tại; không đồng bộ lên Google Sheets hay máy chủ.

## Tính năng

- Ba tab Hôm nay, Lịch sử và Thống kê; chuyển cảnh bằng View Transitions API, tự chuyển sang chế độ ít chuyển động theo thiết lập thiết bị.
- Dock điều hướng cố định ở cạnh dưới, tính vùng an toàn iPhone/Android.
- Thẻ Bento có thể kéo thả hoặc sắp xếp bằng phím mũi tên; thứ tự thẻ được lưu trên trình duyệt.
- Trượt để vào ca hoặc kết thúc ca; hỗ trợ cảm ứng, chuột và bàn phím.
- Biểu đồ lương tuần; thẻ thống kê tuần, kỳ lương và mục tiêu có thể vuốt ngang theo điểm dừng.
- Ghi chú theo kỳ, lưu cục bộ.
- Kỳ lương mặc định từ ngày 21 tháng trước đến hết ngày 20 của tháng được chọn. Ví dụ chọn tháng 11: kỳ 21/10–20/11.
- Lịch và heatmap theo kỳ lương; màu ô đậm dần theo lương ước tính trong ngày, chạm ô để lọc ca.
- Ca thủ công chọn giờ theo bước 30 phút; danh sách xếp ngày/giờ cũ đến mới.
- Mẫu ca, lặp giờ ca trước, hoàn tác xóa, xuất CSV và sao lưu/khôi phục JSON.
- Mục tiêu mặc định 2.500.000 ₫, chọn nhanh 1,5 / 2,5 / 5 triệu hoặc nhập mức khác; giao diện sáng/tối.
- PWA cài lên màn hình chính và dùng offline sau khi tải lần đầu.

## Quy tắc tính hiện tại

- Ca qua nửa đêm được tính sang ngày kế tiếp.
- Giờ đêm từ 22:00 đến 02:00, phụ cấp mặc định +30% trên giờ trong khoảng này.
- Ca Lễ/Tết nhân 300% lương giờ công (cộng thêm 200%); phụ cấp đêm cộng riêng.
- Ca nhập tay và ca bấm giờ trừ thời gian nghỉ mặc định trong Thiết lập.

Mức lương và mục tiêu có thể sửa trong Thiết lập. App không tự tra ngày nghỉ lễ Việt Nam; kết quả là ước tính theo cấu hình cá nhân.

## Chạy cục bộ

Mở `index.html` để xem giao diện. Để cài PWA và dùng service worker, phục vụ thư mục qua HTTPS hoặc localhost.

## Ghi công hình minh họa

Hình bình trong hũ mục tiêu dựa trên hình Vecteezy do người dùng cung cấp. [Vecteezy.com](https://www.vecteezy.com/).
