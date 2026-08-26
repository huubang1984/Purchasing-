# STATE — TrustProcure V2

> Bộ nhớ trạng thái hiện tại của dự án. Đọc trước mọi việc quan trọng, đối chiếu với mã
> nguồn thật — mã, test và hành vi runtime là bằng chứng mạnh hơn tài liệu này.
> Không bao giờ ghi "đã xong / đã test / đã sửa / đã triển khai" nếu chưa thực sự kiểm chứng.

**Cập nhật lần cuối:** 2026-08-27

---

## Cột mốc hiện tại

**Giai đoạn: THIẾT KẾ — đã hoàn tất cho S0+S1, chưa bắt đầu triển khai.**

Đã xong:

- Đọc và phân tích đặc tả TrustProcure V2.1 (45 mục).
- Phân rã toàn sản phẩm thành sáu lát cắt dọc S0–S5.
- Chốt tám quyết định nền tảng (ADR-001 … ADR-007 + điều kiện hoàn thành).
- Đặc tả thiết kế S0+S1 đầy đủ, đã được người dùng duyệt.
- Sổ đăng ký 34 bất biến nghiệp vụ và kiến trúc kiểm thử bảy tầng.
- Phân rã công việc 16 hạng mục kèm ước lượng.

Chưa xong:

- Kế hoạch triển khai chi tiết theo từng bước (đang chờ skill `writing-plans`).
- Toàn bộ mã nguồn.

## Công việc đang làm

Chuyển từ giai đoạn thiết kế sang lập kế hoạch triển khai.

## Điểm chặn

| # | Điểm chặn | Ảnh hưởng | Trạng thái |
|---|---|---|---|
| 1 | **Hook `git-safety.sh` và `protect-secrets.sh` đang fail-open** — thiếu `jq` trên máy, script lỗi ở dòng 4 và trả về `exit 0` (cho qua) | Hàng rào an toàn của phương pháp Vibe Coding hiện không tồn tại trên thực tế, dù đã cài plugin | Đã xác định nguyên nhân, đã có phương án sửa, thuộc hạng mục S0.1 |
| 2 | **Chưa có khách hàng pilot** | Rủi ro xây đúng thứ theo sai thứ tự — lớn hơn mọi rủi ro kỹ thuật | Chưa xử lý. Nên tiếp cận song song ngay từ S0 |

## Vấn đề đã biết

| # | Vấn đề | Mức | Ghi chú |
|---|---|---|---|
| 1 | Hook fail-open (xem Điểm chặn 1) | CAO | Ba lỗi độc lập: phụ thuộc `jq` không khai báo, không fail-closed, bộ pattern quá hẹp |
| 2 | `~/.claude/settings.json` chứa `ANTHROPIC_AUTH_TOKEN` dạng rõ và không nằm trong danh sách bảo vệ của `protect-secrets` | TRUNG BÌNH | Thêm vào pattern khi viết lại hook ở S0.1 |
| 3 | Thư mục `Vibe Coding/` là bản copy-paste thủ công của CLAUDE.md + 5 file SKILL, trùng lặp với plugin đã cài | THẤP | README của plugin cảnh báo sẽ gây nhầm lẫn giữa `/feature` và `/ai-eng-os:feature`. Xử lý ở S0.1 |
| 4 | Rủi ro `crypto.subtle` không khả dụng trong webview Zalo/Messenger | CAO (rủi ro sản phẩm) | Chưa đo. Cần dò tìm khả năng và hướng dẫn người dùng — xem ADR-007 |

## Nợ kỹ thuật

Chưa có — chưa có mã nguồn.

## Kiến trúc

Đã chốt và ghi ở `docs/ARCHITECTURE.md`. Tóm tắt: modular monolith TypeScript 11 module +
`unseal-worker` tách riêng giữ độc quyền giải mã, PostgreSQL đa tổ chức cô lập bằng RLS,
mã hóa lai thực hiện phía trình duyệt nhà cung cấp.

**Chưa có dòng mã nào hiện thực hóa kiến trúc này.**

## Trạng thái kiểm thử

Chưa có test. Kiến trúc kiểm thử đã thiết kế xong (`docs/TEST-PLAN.md`): bảy tầng T0–T6,
34 bất biến, 15 kịch bản tấn công, cộng 10 test cho chính hai hook.

`evidence/INV-matrix.md` chưa tồn tại.

## Trạng thái triển khai

Chưa triển khai. Chưa chọn hạ tầng đích, chưa chọn nhà cung cấp KMS cụ thể (quyết định ở
hạng mục S0.4).

## Hành động tiếp theo

1. Người dùng rà soát bộ tài liệu thiết kế trong `docs/`.
2. Chạy skill `writing-plans` để lập kế hoạch triển khai chi tiết cho S0.
3. Bắt đầu S0.1 — trong đó việc đầu tiên là **sửa hai hook và viết test chứng minh chúng
   chặn thật**. Không hạng mục nghiệp vụ nào bắt đầu trước khi việc này xong.

## Tham chiếu

| Tài liệu | Nội dung |
|---|---|
| `docs/PRODUCT.md` | Định vị, phạm vi, ràng buộc sản phẩm, những điều không được tuyên bố |
| `docs/ARCHITECTURE.md` | Kiến trúc hiện tại |
| `docs/DECISIONS.md` | Bảy ADR |
| `docs/TEST-PLAN.md` | 34 bất biến, bảy tầng kiểm thử, evidence pack |
| `docs/superpowers/specs/2026-08-26-trustprocure-s0-s1-design.md` | Đặc tả thiết kế S0+S1 đã duyệt |
| `Vibe Coding/CLAUDE.md` | Phương pháp làm việc (bản copy thủ công — xem Vấn đề đã biết 3) |
