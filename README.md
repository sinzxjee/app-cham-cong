# App Chấm Công

Web app chấm công cá nhân, tối ưu cho điện thoại. Dữ liệu được lưu trên trình duyệt và không đồng bộ lên Google Sheets.

## Quy trình ghi ca

- Thêm ca mới để nhập ngày, giờ vào, giờ ra và trạng thái Lễ/Tết.
- Ca mới để trống giờ để tránh tạo nhầm tiền lương trước khi nhập đủ thông tin.
- Có thể lặp giờ vào/ra từ ca hoàn tất gần nhất; ngày mới được đặt là hôm nay và trạng thái Lễ/Tết được bỏ chọn để người dùng xác nhận lại.
- Lọc ca theo tháng, ca Lễ/Tết hoặc ca có giờ đêm.
- Xem tổng lương theo toàn bộ dữ liệu hoặc riêng tháng được chọn.
- Xóa từng ca có thể hoàn tác trong vài giây.
- Xuất CSV theo danh sách đang xem; xuất và nhập JSON để sao lưu toàn bộ dữ liệu khi đổi thiết bị hoặc trình duyệt.

## Quy tắc tính lương mặc định

- Lương giờ: 26.500 ₫.
- Nghỉ giữa ca: 0,5 giờ.
- Phụ cấp giờ đêm: 30% cho khoảng 22:00–02:00.
- Ca Lễ/Tết: 300% tiền giờ công, cộng phụ cấp giờ đêm nếu có.
- Có thể thay đổi các giá trị trong phần Thiết lập tính lương.

Mở `index.html` hoặc triển khai bằng GitHub Pages/static hosting.

