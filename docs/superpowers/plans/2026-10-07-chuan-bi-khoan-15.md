# Chuẩn bị khoản 15 (rổ A) — kiểm kê và câu hỏi chốt (2026-10-07)

Trạng thái: **ĐỀ XUẤT — chờ chủ dự án chốt mục 0** (câu 2 đã chốt 2026-10-09). Chưa thực thi gì ngoài tệp này.
Nguồn: sổ nợ `docs/STATE.md` khoản 15 trên `master` `c57ea67` (S1.280, 2026-10-07), `docs/APPLY-LAN-DAU.md`,
khoản 336 (stack 60 apply lại 2026-10-05), `git log e47faec..master -- infra deploy .github/workflows`.

Khoản 15 là khoản rổ A **duy nhất** còn mở: chốt KMS/hạ tầng chạy thật. Nó là việc hạ tầng và việc người, không phải
mã — kế hoạch trả nợ đợt 3 đã xếp nó *ngoài đợt* vì lý do ấy. Lần apply đầu **DỪNG trước bước 6.4** ngày 2026-10-01
theo quyết định của chủ dự án (ước ~200 USD/tháng cho hệ thống chưa có người dùng); điều kiện chạy tiếp ghi ở khoản 15:
*"chạy tiếp từ 6.3 khi có ngày pilot"*.

---

## 0. Câu hỏi cho chủ dự án — chốt trước khi làm bước nào

Mỗi câu: đề xuất đứng đầu, phương án khác sau.

| # | Câu hỏi | Đề xuất | Phương án khác |
|---|---|---|---|
| 1 | **Khi nào bật lại 6.4?** Hiện điều kiện là "có ngày pilot" — chưa có (Điểm chặn 1 của STATE vẫn mở) | **Giữ nguyên:** không apply 90 khi chưa có ngày pilot; vòng này chỉ làm mục 3 (việc không cần AWS) và khởi động mục 4 (việc tính bằng tuần) | Apply 90 một lần có hạn (vài ngày) để đo 6.5–6.7 và 7.3 rồi `destroy` — trả ~1 tuần chi phí để gỡ hai mục *chưa đo trên AWS* (`ClockDrift`, claim `sub` trên token thật) |
| 2 | **Kênh OTP thứ hai** — bắt buộc trước nhà cung cấp thật (ADR-015, ADR-069) | **ĐÃ CHỐT 2026-10-09: Zalo** — chủ dự án: *"Đã có Zalo OA"*. Phần còn lại của kênh Zalo ở mục 2b; SMS brandname không làm ở lần đầu | ~~Brandname SMS; hoặc cả hai song song~~ |
| 3 | **Người thứ hai**: KeyAdmin thứ hai (ADR-062 — chặn dữ liệu thật) và collaborator GitHub thứ hai (chặn 7.1 `prod-khoi-tao` *Prevent self-review* và 8.1) — hiện kho có đúng MỘT collaborator và người nhận cảnh báo chính là KeyAdmin duy nhất | **Chốt tên hai vai ấy trước**, dù chưa cấp quyền; ghi vào APPLY-LAN-DAU 0.2 | Để tới lúc có ngày pilot — rủi ro: 8.1 và điều kiện dữ liệu thật dồn vào cùng tuần với apply |
| 4 | **Phạm vi phía mã của vòng này** | **⒝ Lượt rà trước 6.3** trên `master` hiện tại (mục 3) — image `e47faec` mang 99 migration, `master` nay 110; S1.252 rà ở hình dạng trước 11 migration và 28 cột mốc ấy | ⒜ Chỉ tệp này; hoặc ⒞ ⒝ + chạy thử `deploy/Dockerfile` ba đích và `tools/chay-migrate` trên CSDL sạch ở CI |
| 5 | **SES production access** — case `179085388700221`, chủ dự án trả lời 2026-10-02, chưa thấy dòng nào sau đó | Kiểm `aws sesv2 get-account` (`ProductionAccessEnabled`); nếu vẫn `DENIED`/chờ thì ghi kết quả vào khoản 15 và mở case mới nếu AWS đóng case | — |

---

## 1. Kiểm kê — còn thiếu của khoản 15 (đọc trên `master` `c57ea67`)

| Hạng mục | Bước `APPLY-LAN-DAU` | Trạng thái ghi ở STATE | Ai | Cần gì trước |
|---|---|---|---|---|
| Stack 00–60 | 1–3 | Apply trên ba tài khoản; 30 và 60 khớp `master` (mục C 2026-10-01; 60 apply lại bản #238 ngày 2026-10-05, khoản 336). Sau #238 `infra/` không đổi (git log) — **chưa plan lại để chứng minh `No changes`** | — | — |
| Phép đo ⒜ ADR-062/063 | 4 | **ĐẠT 18/18** 2026-09-30; stack 70 đã dỡ | — | — |
| Stack 80 SES | 5.1–5.2 | Apply; domain `trustprocure.jinji.vn` DKIM và MAIL FROM `SUCCESS`; **sandbox** — case đòi thêm thông tin, đã trả lời 2026-10-02 | AWS / chủ dự án | — |
| Stack 85 SMS/Zalo | 5.3, 0.3 | Mã có (ADR-069); **chưa apply**. **[2026-10-09]** Zalo OA đã có (chủ dự án); template ZNS, refresh token, secret `tp/api/zalo-oa` chưa thấy ghi — mục 2b | Chủ dự án | Mục 2b |
| Secret, `prod.tfvars`, ACM, ECR, image | 6.1–6.3 | Làm 2026-10-01 trên `e47faec` (host tạm `rds-tam.invalid`); image phải **build lại từ `master`** lúc chạy tiếp | Chủ dự án (máy vận hành) | Câu 1 |
| Stack 90 | 6.4 | Plan `162 to add` trên `e47faec`; **DỪNG** vì chi phí | Chủ dự án | Câu 1 |
| Nối CSDL, migrate, bật api | 6.5–6.6 | Chưa chạy | Chủ dự án | 6.4 |
| Neo khoá, `ClockDrift` | 6.7 | Chưa đo trên AWS; phần cục bộ đã ghim (S1.252); task `tp-migrate` lệnh ghi đè chưa đo | Chủ dự án | 6.6 |
| DNS Firewall BLOCK | 6.8 | Chưa | Chủ dự án | ≥ 1 ngày chạy + 7.3 |
| Environments GitHub | 7.1 | Chưa; `prod-khoi-tao` cần người duyệt KHÁC người bấm | Chủ dự án + người thứ hai | Câu 3 |
| Biến repo, deploy chạy thật, đo claim `sub` trên token thật | 7.2–7.3 | Chưa; `sub` mới khớp API cấu hình, chưa phải token | Chủ dự án | 6.6 |
| Tổ chức đầu tiên, worker | 8 | Chưa; 8.1 kẹt khi không có collaborator thứ hai (ADR-040, ADR-111) | Chủ dự án + người thứ hai | 7.1, câu 3 |
| KeyAdmin thứ hai; hộp cảnh báo ≠ KeyAdmin | 0.2 | Chưa | Chủ dự án | Câu 3 |

Điều kiện đóng khoản 15 (theo thân khoản và mục 9 của `APPLY-LAN-DAU`): api và worker chạy trên ECS với
`khoa: aws-kms, bo gui: ses`, một kênh OTP thật bật, deploy đi qua pipeline, người thứ hai có mặt — tức hết mục 9.

---

## 2. Đường găng

1. **Dài nhất:** kênh Zalo (mục 2b) — OA đã có; còn ba template chờ Zalo duyệt. Không phụ thuộc ngày pilot.
2. **Song song:** SES ra sandbox (câu 5); hai người thứ hai (câu 3).
3. **Khi có ngày pilot:** 6.3 (build lại từ `master`) → 6.4 → 6.5 → 6.6 → 6.7 → 7.1–7.3 → 8 → 6.8.

Ba việc ở 1–2 chạy được ngay hôm nay và không tốn AWS; không khởi động chúng thì tới ngày pilot vẫn chờ.

### 2b. Kênh Zalo — còn lại sau khi đã có OA (README `infra/terraform`, mục stack 85)

Điều kiện: OA **đã xác thực**, ứng dụng Zalo **liên kết OA** (developers.zalo.me), **số dư ZNS**. "Đã có OA" chưa nói ba điều ấy
đã xong — chủ dự án xác nhận từng mục.

| # | Việc | Ai | Ghi chú |
|---|---|---|---|
| 1 | Ba template ZNS, gửi Zalo duyệt | Chủ dự án | Tên tham số là hợp đồng với `apps/api/src/adapters/gui-zalo.ts`: OTP `otp`; lời mời `duong_dan` (giá trị `https://trustprocure.jinji.vn/i#…` — Zalo có thể đòi khai tên miền); gia hạn `han_nop`. Đây là bước chờ duyệt, bắt đầu trước |
| 2 | Cấp quyền OA cho ứng dụng (OAuth v4) ⇒ refresh token | Chủ dự án | Refresh token dùng MỘT lần — không thử tay sau khi nạp |
| 3 | Nạp secret `tp/api/zalo-oa` (prod) | Chủ dự án | Lệnh ở README stack 85 bước 3; `WriteAllText` UTF-8 không BOM (S1.252); tệp tạm ngoài kho, xoá ngay |
| 4 | `prod.tfvars`: `zalo = { template_otp, template_invitation, template_deadline }` | Chủ dự án | Đổi `[VANG] kenh_otp` của `kiem-truoc-apply` thành xanh; ba biến `TRUSTPROCURE_ZALO_TEMPLATE_*` của api sinh từ đây |
| 5 | Apply stack 85 (phần Zalo) | Chủ dự án | Trước hoặc sau 90 — stack 60 bắt theo tên; Zalo đi qua NAT và DNS Firewall (ADR-076) |
| 6 | **Gọi thật một lần trước pilot** | Kho + chủ dự án | `gui-zalo.ts` ghi rõ *"CHƯA gọi thật từ kho này"*; chưa có tool nào trong `tools/` gửi thử. Đề xuất một tool nhỏ `tools/do-zalo` chạy trên máy vận hành: đọc secret, gửi một tin `otp` tới số thật, in mã lỗi — đo adapter trước khi api lên ECS. Là việc mã (mục 3) nếu chủ dự án đồng ý |
| 7 | Kiểm sau 6.6: mời một nhà cung cấp khai kênh Zalo; log `/tp/api` không có `GuiKenhError`/`ZaloTokenMatError` | Chủ dự án | Sau 6.6 |

---

## 3. Việc không cần AWS — làm được trong kho (nếu chốt câu 4 ⒝)

Lượt rà trước 6.3, cùng khuôn S1.252, trên hình dạng `master` hiện tại:

- `deploy/Dockerfile` ba đích build được từ `master` (checksum bó CA RDS còn đúng — AWS đã thay một lần 2026-09-29).
- `tools/chay-migrate` áp **110** migration trên CSDL sạch, in đủ dòng `vai …` (`app_neo_login`, `app_khoi_tao_login`).
- `tools/kiem-truoc-apply`: `khop-stack-90.test.ts` còn khớp biến của stack 90; luật `[VANG]`/`[DO]` không lệch README.
- `.github/workflows/deploy.yml` và `khoi-tao.yml`: đối chiếu lại tên environment, biến, điều kiện người duyệt với 7.1 và 8.1.
- `tools/do-zalo` (mục 2b hàng 6) — nếu chốt.
- `docs/APPLY-LAN-DAU.md`: đánh dấu các bước đã làm (1–5 trừ 5.3, 6.1–6.3), ghi rõ *"chạy tiếp từ 6.3 — build lại image"*.
- Khoản 15 ở STATE: thêm đoạn kiểm kê ngày 2026-10-07 (bảng mục 1), không đổi trạng thái MỞ.

Mỗi phát hiện ⇒ một khoản mới (rổ theo ADR-043), vá trong cùng vòng nếu nhỏ.

## 4. Việc chỉ chủ dự án làm được (ngoài kho)

- Zalo: ba template, refresh token, secret (mục 2b hàng 1–3).
- Kiểm case SES; trả lời tiếp nếu AWS hỏi thêm (câu 5).
- Chốt và mời người thứ hai: Identity Center nhóm `tp-key-admins`, collaborator GitHub (câu 3).
- Quyết ngày pilot hay apply có hạn (câu 1).
