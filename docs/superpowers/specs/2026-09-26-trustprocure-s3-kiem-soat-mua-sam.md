# TrustProcure V2 — Thiết kế S3: Kiểm soát mua sắm (Governance · MVP2)

> **Ngày:** 2026-09-26 · **Trạng thái:** ~~**BẢN NHÁP — chưa qua lượt soi hình dạng.**~~ **[S1.136] ĐÃ QUA LƯỢT
> SOI HÌNH DẠNG — 31 phát hiện, 9 CAO, ba lời khai ĐO trên Postgres 16 thật** (`evidence/security-reviews.md` §S1.136).
> Năm quyết định của chủ dự án (§2.4) và các quyết định chốt từ tiền lệ (§2.5) ở **ADR-079**; ADR (a) và (b) của §2.3
> chốt thành **ADR-077** và **ADR-078**. Chưa một dòng mã nào của S3 được viết.
> ~~Chưa ADR nào của S3 được chốt; ba ADR phải chốt ở lượt soi, trước dòng mã đầu (§2.3).~~
> **Nguồn:** `TrustProcure_V2_Procurement_Control_Intelligence.md` (V2.1) — §32 *MVP 2 — Procurement Control*,
> §12 *Procurement Governance*, §10 *Progressive Onboarding*, §13, §24–§26, §39. Bản nguồn KHÔNG nằm trong kho,
> cùng tình trạng từ spec S0+S1.
> **Đóng:** khoản **234** (ba chốt khâu mời của ADR-058) · nợ spec S0+S1 §4.3 (*số nhà cung cấp được mời
> đạt ngưỡng chính sách*) · lỗ *khai thấp ước lượng* mà `014` §(4) gọi tên — ở cổng award, KHÔNG ở cổng mở gói
> và mở thầu (§8.4) · **[S1.136]** khoản **241** (gói dưới ngưỡng mở với 0 chữ ký) cho tổ chức đã bật S3 (ADR-077).
> **Không đóng:** Risk Score, phát hiện bất thường bằng thống kê, đồ thị quan hệ nhà cung cấp (S4); dữ liệu
> giao hàng và chất lượng từ ERP (S5).

---

## 1. Bối cảnh — S3 bắt đầu TRƯỚC khi MVP1 đóng, và cái giá của lựa chọn ấy

MVP1 chưa đóng. Bảng bốn mảnh ở `docs/PRODUCT.md` §11 còn mảnh 3 (triển khai thật — ~~chuỗi ADR-062…064 đang
chạy~~ **[S1.136]** chuỗi ADR-062…069 trên `master` và các nhánh triển khai) và mảnh 4 (khách hàng pilot). Ba tài liệu trong kho nói S3 nên đợi:

- **ADR-043** — chỉ khoản rổ A được mở vòng;
- **ADR-058 ⑷** — *"xây lúc này là dựng một phép đo trên tập rỗng"*;
- **V2.1 §39** — Governance ở tháng 4–5, SAU pilot ở tháng 3.

Chủ dự án chọn làm ngay (§2.2 ⑶). Tài liệu này không đảo lại lựa chọn ấy. Nó làm hai việc để cái giá đo được:

1. **Tách CHỐT khỏi TÍN HIỆU.** Chốt cưỡng chế trên từng gói thầu và có nghĩa từ gói thầu đầu tiên — ngưỡng
   số nhà cung cấp, ngoại lệ có lý do, chữ ký thứ hai, xung đột lợi ích, thẩm định trước trao. Tín hiệu cần
   lịch sử nhiều gói mới có nghĩa — chia nhỏ đơn, hiệu suất nhà cung cấp. Trên dữ liệu rỗng, chốt vẫn đúng;
   tín hiệu thì không, và giao diện phải nói ra điều đó thay vì hiện `0%` (§8.3).
2. **Mọi tham số mặc định mang nhãn GIẢ ĐỊNH** (§4.1) cùng điều kiện hiệu chỉnh bằng dữ liệu pilot.

Rủi ro chi phối của S3, ghi từ ngày phân rã (spec S0+S1 §1): ***cấu hình sai chính sách tạo ra kiểm soát
giả.*** Một ngưỡng không ai đọc, một ngoại lệ ai cũng ký, một khai báo ai cũng tick — cả ba trông như kiểm
soát và không kiểm soát gì. Mọi quyết định dưới đây được cân theo rủi ro ấy trước.

---

## 2. Những thứ đã chốt TRƯỚC khi có tài liệu này

| # | Ràng buộc | Nguồn | Hệ quả cho S3 |
|---|---|---|---|
| 1 | Không hard-code *"3 báo giá"*; mọi ngưỡng cấu hình được theo từng doanh nghiệp | PRODUCT §8 ⑸, V2.1 §12 11.1 | Bậc giá trị là DỮ LIỆU của phiên bản chính sách, không phải hằng số trong mã |
| 2 | Friction thấp cho nhà cung cấp; lần báo giá đầu không cần tài khoản | PRODUCT §8 ⑴⑵, V2.1 §10 | Không chốt nào của S3 thêm bước cho nhà cung cấp TRƯỚC lần nộp đầu. Passport (Level 2) chỉ kích hoạt theo sự kiện — ở S3 là *được đề xuất trao thầu*, hoặc người mua yêu cầu tay. **[S1.136]** Xác minh để được đếm vào ngưỡng (ADR-078 ⑵) là việc của BÊN MUA, không đòi nhà cung cấp làm gì |
| 3 | **Risk Signal ≠ Fraud Verdict** | PRODUCT §4 ⑸ | Chia nhỏ đơn và hiệu suất là TÍN HIỆU: không chặn, không kết luận, ngôn ngữ theo PRODUCT §5 |
| 4 | Phân tách nhiệm vụ theo **HÀNH VI đã xảy ra trên từng gói**, không theo quyền được cấp | ADR-051, ADR-058 ⑶(c) | Chữ ký thứ hai cho danh sách mời so với `invited_by` THẬT, không với một hàng mới trong ma trận quyền |
| 5 | Ứng dụng tính, CSDL lưu — **không lưu kết luận trần** | ADR-017 | Bậc áp cho một gói lưu kèm khoá ngoại tới ĐÚNG hàng bậc của ĐÚNG phiên bản chính sách |
| 6 | **Một luật, một chỗ** | `014` §(4), `procurement-policy.ts` | Phân bậc, đếm nhà cung cấp, xoay vòng, tín hiệu chia nhỏ là HÀM SQL; TypeScript không giữ bản sao |
| 7 | Người đặt thước không cầm thứ bị đo | `033` | ~~Bậc là một phần của thước, nên luật `policy.manage` ⟂ `rfq.create`/`rfq.approve` phủ luôn bậc mà không cần sửa~~ **[S1.136] SAI.** Luật `033` chỉ loại `rfq.create`/`rfq.approve`, còn `FINANCE` giữ `policy.manage` CÙNG `po.approve` — nên số chữ ký và vai duyệt award mà bậc khai là thước đo đúng việc FINANCE làm. Xử lý: §2.4 ⑺ |
| 8 | Bí mật giá lan sang số đếm và phái sinh — A4, A5, A6 | TEST-PLAN nhóm A | Chỉ số hiệu suất không đọc gói chưa `CLOSED`; chỉ số từ giá không đọc gói chưa `UNSEALED`; phiên khách không đọc được chỉ số nào |
| 9 | Không tuyên bố sản phẩm phát hiện hay ngăn được thông đồng | PRODUCT §5, ADR-058 ⑵ | Mọi màn của S3 nói *"làm việc móc nối đắt hơn và để lại dấu đọc được"*, không nói *"phát hiện"* |

### 2.1. ADR-058 là tiền lệ chịu lực nhất của tài liệu này

ADR-058 đo được rằng lõi niêm phong bảo vệ *thông tin giá trước deadline*, còn hai kịch bản *chiếm pool* và
*xoay vòng thắng thầu* **không cần biết giá của ai**. Lớp chặn khả dĩ nằm ở khâu MỜI, cưỡng chế ở CẠNH TRẠNG
THÁI chứ không ở tầng báo cáo. Ba việc của ADR-058 ⑶ — ngưỡng số nhà cung cấp, buộc có nhà cung cấp mới,
chữ ký thứ hai cho danh sách mời — là lõi của S3, và khoản **234** mang cả ba.

ADR-058 ⑸ còn xếp thứ tự cho phần PHÁT HIỆN: khoảng cách giá thắng–giá nhì, rồi ma trận tỷ lệ thắng, rồi mới
tới IP/thiết bị/metadata. Phần phát hiện nằm ngoài S3 (§10); thứ S3 để lại cho nó là **dữ liệu mô tả** ở
§4.9 — đúng hai đại lượng đứng đầu thứ tự ấy.

### 2.2. Bốn quyết định của chủ dự án, ngày 2026-09-26

| # | Câu hỏi | Quyết định | Hệ quả |
|---|---|---|---|
| ⑴ | Phạm vi | **Đủ bảy mục của V2.1 §32** — Approval Policy, Supplier Qualification, Single Source, Spend Threshold, Purchase Splitting, Conflict of Interest, Supplier Performance — cộng ba chốt khâu mời của ADR-058 | Supplier Qualification kéo theo **Supplier Passport Level 2**, và ADR-013 §4 đòi một ADR mới cho nó. Supplier Performance chỉ gồm chỉ số đọc được từ dữ liệu của chính nền tảng (§4.9). Vượt 4–6 tuần của §32 — ước lượng lại ở §9 |
| ⑵ | Kiến trúc Approval Policy | **Mở rộng cổng sẵn có.** Chính sách quyết định SỐ chữ ký và VAI theo bậc; cưỡng chế vẫn ở `rfq_approvals`, `rfq_award_approvals` và trigger của chúng. **[S1.136]** *SỐ và VAI theo bậc* chỉ đúng cho trao thầu: số chữ ký mở gói và mở thầu vẫn do `dual_approval_threshold` (§4.1), cộng sàn một chữ ký (§2.4 ⑸) | KHÔNG dựng `approval_policies/steps/instances` của V2.1 §26. **Đường mở thầu không đổi một dòng.** Vai trò giữ danh mục toàn cục (`005`); vai riêng theo tổ chức để Enterprise |
| ⑶ | Tham số phụ thuộc khách hàng | **Chốt mặc định, bắt đầu S3.0 ngay sau lượt soi hình dạng** | Mọi mặc định ở §4.1 mang nhãn GIẢ ĐỊNH. Đi ngược ADR-043 và ADR-058 ⑷ — ghi thành ADR (a) ở §2.3. **[S1.136]** Đã ghi: **ADR-077**, kèm công tắc một chiều theo tổ chức (§2.4 ⑻) |
| ⑷ | Quy trình | Viết bản nháp spec ngay | Tài liệu này |

### 2.3. ~~Ba ADR phải chốt ở lượt soi hình dạng — trước dòng mã đầu~~ [S1.136] Hai ADR chốt ở lượt soi; ADR thứ ba chốt trước S3.7b

*(**[S1.136]** Tiêu đề cũ tự cãi ô (c) ngay dưới nó: ô ấy nói (c) chỉ chặn S3.7b.)*

| ADR | Câu hỏi | Vì sao chặn |
|---|---|---|
| **(a)** | S3 mở vòng khi MVP1 chưa đóng: phạm vi của ngoại lệ đối với ADR-043 — CHỈ các hạng mục S3.x, không mở khoản rổ B nào khác — và điều kiện dừng nếu triển khai thật hay pilot cần người | ADR-043 là luật đang hiệu lực; một vòng không nói nó chạm mảnh nào của §11 là đúng lỗ khoản **237**. **[S1.136] CHỐT — ADR-077:** ngoại lệ hẹp, công tắc một chiều theo tổ chức, điều kiện dừng |
| **(b)** | Supplier Passport Level 2 là hồ sơ **THEO TỪNG TỔ CHỨC MUA**, không gộp xuyên tổ chức | ADR-013 §4 đòi đúng ADR này. Gộp xuyên tổ chức tái lập oracle MST mà ADR-013 dựng cả sổ riêng để tránh; hồ sơ theo tổ chức thì câu hỏi oracle không phát sinh. Cái giá: một nhà cung cấp khai lại hồ sơ cho mỗi tổ chức mua. **[S1.136] CHỐT — ADR-078:** cộng thẩm định hai cấp, và phiên Passport đặt CHÍNH `app.guest_session_id` |
| **(c)** | Tải tệp cho tài liệu Passport: nơi cất, giới hạn kích thước và kiểu, quét mã độc, ai đọc, thời hạn giữ | Kho chưa có đường tải tệp nào (grep `multipart`/`upload` trên `apps`, `packages`, `db`: 0 kết quả). ADR-020 đặt điều kiện xét lại tầng HTTP khi cần multipart. Chỉ chặn S3.7b, không chặn phần còn lại. **[S1.136]** Chưa chốt, và đó là đúng: chốt trước S3.7b |

### 2.4. [S1.136] Năm quyết định NỮA của chủ dự án, sau lượt soi hình dạng

Lượt soi S1.136 tìm ra năm chỗ là lựa chọn sản phẩm, không điền được từ tiền lệ. Chủ dự án chốt cả năm ngày 2026-09-26.
Đầy đủ lý do ở **ADR-079**.

| # | Phát hiện | Quyết định |
|---|---|---|
| ⑸ | Gói không có ngân sách thì không có bậc, nên thoát mọi chốt của S3. Và gói dưới ngưỡng mở được với 0 chữ ký — **đã đo**, khoản **241** | **Sàn mọi gói:** ước lượng bắt buộc để rời DRAFT; mọi gói cần ≥ 1 chữ ký của người khác người tạo mới mở được — trả nợ spec S0+S1 §4.3 |
| ⑹ | K2/K3 đếm bản ghi nhà cung cấp, mà vai mời tự tạo được: `tax_code` cho phép NULL, một email liên hệ dùng được cho mọi công ty. Nên đủ ngưỡng bằng nhà cung cấp vỏ không tốn gì | **Bốn luật cùng áp:** (i) không đếm nhà cung cấp/người liên hệ do người tạo gói hay người mời tạo; (ii) chỉ đếm nhà cung cấp có MST, mỗi MST và mỗi đích liên hệ đếm một lần; (iii) chỉ đếm nhà cung cấp có xác minh còn hiệu lực (ADR-078 ⑵); (iv) **hậu kiểm lúc trao** — số báo giá hợp lệ nhận được dưới ngưỡng của bậc cao hơn thì trao thầu cần ngoại lệ `LOW_ACTUAL_COMPETITION` có chữ ký độc lập |
| ⑺ | `FINANCE` vừa đặt thước (`policy.manage`) vừa cầm thứ bị đo (`po.approve`); một gói ở DRAFT giữ mãi phiên bản chính sách đã ghim | **Chữ ký thứ hai + luật hành vi:** phiên bản có bậc chỉ hiệu lực khi một người KHÁC giữ `policy.manage` ký; người tạo phiên bản không ký trao thầu, không xác minh hay thẩm định, không ghi nhận tín hiệu trên gói ghim phiên bản ấy; nộp duyệt đòi phiên bản ghim là phiên bản đang hiệu lực |
| ⑻ | `master` đang là nguồn triển khai thật, còn S3.1/S3.2 đổi kịch bản pilot | **Công tắc một chiều theo tổ chức** — ADR-077: S3 bật khi tổ chức có phiên bản có bậc đầu tiên đã ký, và không tắt lại được; tổ chức chưa bật chạy như MVP1 |
| ⑼ | §3.3 bản nháp muốn đúc token lúc mở gói rồi gửi qua job outbox — trái payload `007`, trái ADR-023, và đảo ADR-020 [S1.70] mà không gọi tên | **Đúc token lúc mở gói bằng phiên người mở, gửi at-most-once sau commit, KHÔNG thu hồi khi hỏng.** Lời mời mang trạng thái *chưa gửi*, phản hồi nói rõ, có lối *gửi lại*. Thay [S1.70] cho tổ chức đã bật S3 |

### 2.5. [S1.136] Những chỗ lượt soi chốt từ tiền lệ đo được

Khuôn ADR-050: chỗ nào tiền lệ trong kho trả lời được thì lượt soi tự chốt và ghi lý do. Đầy đủ ở ADR-079 ⑽–⒇.

| # | Chỗ | Chốt | Tiền lệ |
|---|---|---|---|
| ⑽ | Bảng bậc con chèn thêm được vào phiên bản cũ ⇒ K1 sai hồi tố; phép đếm gặp NULL ⇒ lặng lẽ cho qua | Bậc là `jsonb` trên hàng chính sách; bậc áp lưu bằng `tier_tu_so_tien` trên `rfq_budgets`; mọi hàm theo bậc NÉM khi NULL; trao ở bậc đấu thầu chính thức bị từ chối; mọi chốt theo bậc dùng bậc cao hơn ở trao thầu | `056`; `014` (NULL = chưa trả lời được) |
| ⑾ | Băm danh sách đổi `rfq_bam_noi_dung` ⇒ gãy mọi UPDATE của gói cấp kép (khoản **240**); người đã ký không ký lại được. **[S1.137]** Vế *gãy mọi UPDATE* hết đúng sau `067`; chốt giữ nguyên vì hai vế còn lại — đọc, chưa đo: đổi định dạng băm vẫn vô hiệu chữ ký của gói đang PENDING_APPROVAL lúc deploy, và UNIQUE vẫn chặn ký lại | Hàm băm danh sách RIÊNG + cột do trigger đặt; UNIQUE của `rfq_approvals` theo (người, băm); route cho cạnh về DRAFT; thu hồi ở OPEN giữ lại, có lý do và tín hiệu | `011` C-1; `014` §(4) |
| ⑿ | K5 thiếu đúng người bỏ tên khỏi danh sách | Loại thêm mọi `revoked_by` (đọc mọi hàng), người đặt ngân sách, người nộp duyệt, người tạo bản ghi nhà cung cấp và người liên hệ | ADR-051 |
| ⒀ | K3 "rửa" được bằng gói nháp | Chỉ đếm gói đã `opened_at`; loại gói đang xét; theo người mời | ADR-058 ⑶(b); K6 |
| ⒁ | §4.6 và K10 là hai điều kiện khác nhau; người gây ra tín hiệu tự ghi nhận được | Một điều kiện, fail-closed; tính lại ở tầng gói; neo `submitted_at`; khoá `category_id` sau DRAFT; khoá theo (tổ chức, nhóm hàng); người ghi nhận ngoài {người tạo, người gây ra}; thêm `EARLY_CLOSE`; bằng chứng không mang số tiền | `011` C-1; ADR-051; ADR-054 |
| ⒂ | K12 dựa vào lớp gói kiểm trước, mà bản nháp bỏ lớp ấy | Mỗi chốt một hàm vị từ SQL, tầng gói gọi trước mọi tác dụng phụ. Lớp từ chối thứ ba: **chưa chốt** — chủ dự án chốt ở S3.0 | ADR-060; khoản 31 |
| ⒃ | Ba hàm S3 sửa đều bị ghim nguyên văn; trigger mới trên `rfq_packages` gặp `app_unseal` | Ghim mọi hàm mới hoặc bị sửa, kể cả hàm trợ giúp; mọi trigger mới mang WHEN đúng cạnh | S1.96; S1.108 §7b |
| ⒄ | K7/K8/K9 hở ở người thẩm định và ở khai báo sau khi ký | Người thẩm định ngoài người đề xuất/ký trao; phép đếm chữ ký loại `CO_XUNG_DOT`; K9 thêm cổng ở xác minh, ghi nhận, huỷ trao; `award_vai_khac_nhau` mặc định KHÔNG | ADR-051 |
| ⒅ | View hiệu suất rò hoạt động của vòng BAFO đang mở | Phiên bản BAFO chỉ tính khi vòng đã đóng; thêm phép đo tính đúng | A6; J4; J2 |
| ⒆ | §9 đặt vế đọc bảng thẩm định trước hạng mục sinh ra nó | Xác minh nội bộ lên S3.3; hàng K vào sổ theo hạng mục đo được nó | S1.115; khoản 239 |
| ⒇ | §6 khai "bảy tầng phủ đủ" trong khi T4 chưa dựng | Nghiệm thu giao diện bằng lượt đi thử có biên bản mỗi hạng mục có màn | S1.97 |

---

## 3. Kiến trúc

### 3.1. Thứ S3 TÁI DÙNG, không dựng lại

| Đã có | S3 dùng cho |
|---|---|
| `org_procurement_policies` — theo tổ chức, có phiên bản, bất biến (`014`, `056`) | Bậc giá trị là bảng CON của một phiên bản chính sách |
| `rfq_budgets` — ước lượng kèm khoá ngoại chính sách, chỉ sửa ở `DRAFT` (`014`) | Đầu vào của phân bậc |
| `rfq_approvals` + băm nội dung `rfq_bam_noi_dung` (`009`, `011` C-1) | Chữ ký thứ hai trên danh sách mời — băm MỞ RỘNG phủ danh sách (§3.3) |
| `rfq_award_approvals` + hằng `CHU_KY_CAN` trong `award_kiem_mot_award_song` (`061`) | Số chữ ký award theo bậc — hằng thành hàm |
| `rfq_invitations.invited_by` (`013`) | Xoay vòng; phân tách nhiệm vụ trên danh sách |
| Khuôn *trigger RIÊNG chứ không sửa `rfq_kiem_chuyen_trang_thai`* (`014` §(4)) | Chốt ở `DRAFT→PENDING_APPROVAL` và `PENDING_APPROVAL→OPEN` |
| Khuôn vai + người của `033` | `supplier.qualify` ⟂ `rfq.invite` |
| `throwAuditedDenial` + luật `VAO_SO` (ADR-060) | Mọi từ chối của S3 vào sổ theo cùng luật |
| Magic link + OTP khác kênh (ADR-015), token băm (E1) | Đường Passport cho nhà cung cấp |
| Outbox bền + `NOTIFY` đánh thức (ADR-010) | Phát link mời lúc `OPEN` |
| `vendor_bid_versions`, `rfq_evaluation_lines`, `rfq_awards` | Chỉ số hiệu suất nhà cung cấp |
| Bộ xuất tự đủ `tools/bo-xuat-danh-gia` (ADR-059) | Lớp governance trong bộ bằng chứng (S3.9) |

**S3 không thêm một đường mật mã nào, không thêm trạng thái RFQ nào, và không chạm đường mở thầu** (`CLOSED→UNSEALED`).
Đó là ba phát biểu đáng kiểm nhất của tài liệu này. Nếu bản cài đặt sửa `packages/sealed-envelope`, `packages/unseal`,
`unseal_so_phe_duyet_can` hay `rfq_kiem_yeu_cau_mo_thau`, hoặc thêm một phần tử vào `CANH_HOP_LE`, thì thiết
kế đã trượt.

### 3.2. Thứ S3 thêm

Một gói `packages/kiem-soat` giữ lớp có trạng thái của bậc, ngoại lệ, khai báo xung đột, tín hiệu và hiệu suất.
Khác `packages/danh-gia`, nó gần như **không có lõi thuần**: mọi phép so nằm ở SQL (ràng buộc 6), ~~nên phần TypeScript
chỉ kiểm hình dạng NGOÀI của đầu vào rồi giao cho `CHECK`/trigger phán — đúng khuôn `trongSoJson` ở
`procurement-policy.ts`~~. **[S1.136 / §2.5 ⒂]** Câu vừa gạch làm K12 rỗng: một lần từ chối do trigger huỷ cả giao dịch
nên không ghi sổ được, và ADR-060 chỉ nhận giới hạn ấy vì *"lớp gói bắt trước ở đường thuận"*. Nên mỗi chốt là một **hàm
vị từ SQL**: tầng gói gọi CHÍNH hàm ấy trước mọi tác dụng phụ — trước `issueRfqKeyPair` ở cạnh mở gói, khoản 31 — và ném
từ chối theo `VAO_SO`; trigger gọi cùng hàm ấy làm lớp chặn cuối. Một phép so, hai người dùng — khuôn `014` và
`packages/unseal/src/requests.ts`. Một ranh giới `depcruise` mới cấm `kiem-soat` phụ thuộc `sealed-envelope`, `unseal` và
`crypto-keys` — phát biểu *không chạm đường mở thầu* của §3.1 thành một phép đo máy, cùng lối S2.7 dùng `g17-`.

Passport và thẩm định nằm ở `packages/supplier`, vì chủ thể là nhà cung cấp. Khâu mời dựng lại (§3.3) sửa
`packages/invitation` và `openRfq` của `packages/rfq`.

### 3.3. Khâu mời phải dựng lại — thay đổi hành vi lớn nhất của S3

Trong tài liệu này, *mở gói* là `PENDING_APPROVAL→OPEN` và *mở thầu* là `CLOSED→UNSEALED`, đúng nghĩa PRODUCT §4 ⑶.
Màn `/tao-thau` hôm nay gọi bước mở gói là *"Đã mở thầu"*; S3.2 sửa nhãn ấy.

**Hiện trạng, đọc trên mã `master` `40f1962`:**

- `/tao-thau` mời nhà cung cấp ở **bước 5, SAU khi mở gói ở bước 4** (nộp duyệt → duyệt → mở).
- `POST /rfqs/:rfqId/invitations` tạo lời mời, đúc token và gửi link trong CÙNG một lần gọi.
- Không lớp nào ràng lời mời theo trạng thái gói: trigger trên `rfq_invitations` (`013`, `022`) chỉ kiểm danh
  tính và tính đơn điệu của thu hồi; route cũng không kiểm.
- `rfq_bam_noi_dung` (`011`) băm tiêu đề, deadline và hạng mục — **không băm danh sách mời**.
- Vế đếm chữ ký của `PENDING_APPROVAL→OPEN` chỉ chạy khi `requires_dual_approval` (thân `rfq_kiem_chuyen_trang_thai`,
  `061`). Gói dưới ngưỡng mở được bằng `rfq.open` mà không cần hàng `rfq_approvals` nào — và `PROCUREMENT_MANAGER`
  giữ cả `rfq.create`, `rfq.invite` lẫn `rfq.open`.

Hệ quả: người duyệt **không bao giờ thấy** danh sách mời, nên *"chữ ký thứ hai cho danh sách mời"* (ADR-058 ⑶c)
và *"số nhà cung cấp được mời đạt ngưỡng"* ở `DRAFT→PENDING_APPROVAL` (spec S0+S1 §4.3) **không diễn đạt được**
trên luồng hiện tại. Không vá được bằng một trigger; phải đổi thứ tự.

**Luồng mới:**

| Giai đoạn | Lời mời | Chữ ký |
|---|---|---|
| `DRAFT` | Dựng danh sách tự do: thêm, bỏ. **Không đúc token, không gửi link** | — |
| `DRAFT→PENDING_APPROVAL` | Chốt K2, K3 chạy trên danh sách này | — |
| `PENDING_APPROVAL` | **Không đổi được.** Muốn đổi thì quay `PENDING_APPROVAL→DRAFT` — ~~cạnh ấy đã có và đã xoá mọi chữ ký~~ **[S1.136] SAI, và là lời khai chép từ một chú thích thiu:** cạnh ấy có trong `CANH_HOP_LE` nhưng KHÔNG xoá chữ ký nào (`011:245-251`: *"KHÔNG cần xoá hàng nào. Hàng cũ ở lại"*) và chưa đường ứng dụng nào đi nó — khoản **242**. Chữ ký cũ vô hiệu bằng băm; S3.2 thêm hàm, route và mã quyền cho cạnh ấy, và UNIQUE của `rfq_approvals` đổi theo (người, băm) để người đã ký ký lại được — §2.5 ⑾ | Chữ ký ghim băm ~~nội dung GỒM danh sách mời và ngoại lệ~~ **[S1.136]** danh sách mời và ngoại lệ còn sống bằng một hàm băm RIÊNG, trên một cột mới do trigger đặt; `rfq_bam_noi_dung` không đổi (khoản **240**) — nên chữ ký nói nó đã ký lên danh sách nào |
| `PENDING_APPROVAL→OPEN` | ~~Đúc token và xếp job gửi link cho MỌI lời mời còn sống, trong cùng giao dịch mở gói~~ **[S1.136 / §2.4 ⑼]** Phiên của người mở đúc token cho MỌI lời mời còn sống trong giao dịch mở gói; gửi at-most-once SAU commit | K5, sàn một chữ ký (§2.4 ⑸) |
| `OPEN` | **Thêm** được (tăng cạnh tranh, có sổ, gắn nhãn *mời sau khi ký*). **Thu hồi** phải có lý do và sinh tín hiệu `INVITE_LIST_NARROWED` (K10). **[S1.136]** Thu hồi làm danh sách còn dưới ngưỡng thì cần ngoại lệ có chữ ký độc lập | — |
| Từ `CLOSED` | Không đổi được | — |

~~Gửi hỏng lúc `OPEN` là một job outbox thử lại, không phải một lần thu hồi — nhánh `LINK_SEND_FAILED` của route hôm
nay (thu hồi khi bộ gửi hỏng) mất lý do tồn tại khi token không còn đúc lúc mời.~~ **[S1.136 / §2.4 ⑼] Câu vừa gạch sai ba
chỗ:** payload outbox không được mang token (`007`, E1); ADR-023 §1 đã loại hình dạng *"phát token rồi xếp job gửi"*; và
ADR-020 [S1.70] đã bác *"outbox như link đăng nhập"* vì gửi hỏng thì không đổi được phản hồi. Chủ dự án chọn: gửi hỏng thì
lời mời mang trạng thái *chưa gửi*, phản hồi nói rõ lời mời nào, và lối *gửi lại* đúc token mới. KHÔNG thu hồi — thu hồi
sẽ thu hẹp một danh sách đã ký. Hệ quả: `status DEFAULT 'SENT'` của `010` phải học trạng thái *chưa gửi*.

**[S1.136 / ADR-077] Luồng mới chỉ áp cho tổ chức đã bật S3.** Tổ chức chưa bật giữ luồng MVP1: mời sau khi mở gói, đúc
token và gửi link ngay lúc mời, và hợp đồng [S1.70].

Vì sao **thêm** được mà **bớt** thì không một mình: chiếm pool (ADR-058 ⒜) sống bằng việc LOẠI người cạnh tranh
thật, không bằng việc thêm người. Một nhà cung cấp thêm muộn vẫn phải nộp niêm phong như mọi người.

---

## 4. Mô hình dữ liệu

### 4.1. Chính sách — bậc giá trị là bảng CON của phiên bản chính sách

Cùng lý do spec S2 §4.1 mở rộng `org_procurement_policies` thay vì dựng bảng chính sách thứ hai: người mua nghĩ về
*"chính sách phiên bản 4"* như MỘT vật. ~~Bậc là nhiều hàng nên nó là bảng con khoá theo `(org_id, policy_id)`, bất
biến cùng phiên bản cha, không có dòng thời gian riêng.~~

**[S1.136 / §2.5 ⑽] Câu vừa gạch không có cơ chế nào đứng sau.** Bất biến của phiên bản chính sách ở `014` chỉ đến từ
việc không cấp UPDATE/DELETE; một bảng con thì cần INSERT, nên một bậc chèn thêm vào phiên bản 4 đang dùng làm K1 sai hồi
tố cho mọi gói đã rời DRAFT. Bậc vì vậy là một mảng **`jsonb` trên chính hàng chính sách**, đúng khuôn `eval_components`
(`056`, ADR-053): bất biến bằng cấu tạo, `CHECK` và trigger khi chèn giữ hình dạng — cận dưới tăng ngặt, có bậc 0, các
khoá đúng kiểu.

~~**`org_policy_tiers`** — mỗi bậc một hàng:~~ **[S1.136]** Các khoá của một phần tử `tiers`:

| Cột | Nghĩa |
|---|---|
| `tu_so_tien numeric(18,2)` | **Cận DƯỚI** của bậc, theo tiền tệ của chính sách. Bậc của giá trị `v` là hàng có `tu_so_tien` lớn nhất `≤ v`. Định nghĩa bằng cận dưới thì khe hở và chồng lấn **không diễn đạt được**; một phiên bản đã khai bậc phải có bậc `tu_so_tien = 0` ~~(trigger ràng buộc hoãn tới cuối giao dịch tạo phiên bản)~~ **[S1.136]** — kiểm ngay khi chèn hàng chính sách, vì mảng nằm trên chính hàng ấy |
| `so_ncc_toi_thieu smallint` | Số nhà cung cấp khác nhau, còn sống trong danh sách mời, tối thiểu |
| ~~`chi_dem_ncc_da_tham_dinh boolean`~~ | ~~Nếu bật, chỉ đếm nhà cung cấp có thẩm định còn hiệu lực~~ **[S1.136 / §2.4 ⑹iii]** Không còn là tuỳ chọn: ở tổ chức đã bật S3, chỉ nhà cung cấp có XÁC MINH còn hiệu lực mới được đếm (ADR-078 ⑵) |
| **[S1.136]** `award_vai_khac_nhau boolean` | Khi `award_so_chu_ky = 2`, hai người ký phải thuộc hai vai khác nhau |
| `ky_danh_sach_moi boolean` | Đòi chữ ký thứ hai theo HÀNH VI (K5) |
| `xoay_vong_n smallint` | `0` = tắt. `N > 0` = K3 với cửa sổ N gói |
| `award_so_chu_ky smallint CHECK (1, 2)` | Số chữ ký duyệt award |
| `award_vai text[]` | Vai được ký duyệt award ở bậc này — tập con của các vai đang giữ `po.approve` |
| `tham_dinh_truoc_trao boolean` | K8 |
| `khai_xung_dot boolean` | K9 |
| `dau_thau_chinh_thuc boolean` | Bậc không đi qua RFQ của TrustProcure (V2.1 §12 11.1 *"> 10B → Formal Tender"*) |

**Cột mức chính sách** mới trên `org_procurement_policies`: `chia_nho_cua_so_ngay`, `tham_dinh_hieu_luc_thang` —
cho phép `NULL`, kèm `CHECK` tất-cả-hoặc-không như `056`.

**Phiên bản cũ không có bậc → fail-closed**, đúng tiền lệ spec S2 §4.1: `DRAFT→PENDING_APPROVAL` dưới một phiên
bản không bậc bị từ chối bằng câu *"chính sách phiên bản N chưa khai bậc giá trị; tạo phiên bản mới trước khi nộp
duyệt"*. Không lấy mặc định âm thầm — một mặc định ở đây là đúng thứ ràng buộc 1 cấm. Cái giá: mọi tổ chức phải
tạo một phiên bản chính sách mới trước gói thầu đầu tiên sau S3.1. Hôm nay không có khách hàng thật nào (PRODUCT
§10), nên cái giá rơi vào `gieo:demo` và cụm test.

**[S1.136] Đoạn trên đổi phạm vi và thêm hai vế.**
- **Phạm vi (ADR-077):** fail-closed áp cho tổ chức ĐÃ BẬT S3. Tổ chức chưa bật chạy như MVP1, nên cụm test hiện có giữ
  nguyên. Từ lúc bật, CSDL từ chối mọi phiên bản không bậc của tổ chức ấy.
- **Câu *"tạo phiên bản mới"* là ngõ cụt nếu đứng một mình:** tạo phiên bản mới không đổi con trỏ `policy_id` của ngân
  sách (`setRfqBudget` chỉ ghim bản đang hiệu lực lúc lưu). Nên nộp duyệt đòi phiên bản ghim là phiên bản đang hiệu lực
  (§2.4 ⑺), và thông điệp từ chối nói người dùng lưu lại ngân sách.
- **Chữ ký thứ hai (§2.4 ⑺):** một phiên bản có bậc chỉ có hiệu lực khi một người KHÁC giữ `policy.manage` đã ký nó —
  một bảng chữ ký chỉ-ghi-thêm, khuôn `rfq_approvals`. Hàm *phiên bản đang hiệu lực* chỉ đọc phiên bản đã ký.

**Tiền tệ lệch → từ chối**, cùng câu của `rfq_can_phe_duyet_kep` (`014`): phân bậc không quy đổi tiền tệ; đa tiền
tệ là Enterprise.

**`dual_approval_threshold` KHÔNG bị bậc thay thế.** Nó tiếp tục quyết định `requires_dual_approval`, tức số chữ ký
mở gói (C-1) và mở thầu (D2). Để bậc quyết định cả hai sẽ phải sửa `rfq_can_phe_duyet_kep` và chạm đường mở thầu —
ngược §2.2 ⑵. Màn khai chính sách hiện ngưỡng ấy cạnh bảng bậc để người khai thấy trọn ma trận.

**Mặc định — mọi ô là GIẢ ĐỊNH** (nguồn: ví dụ ở V2.1 §12 11.1 cho cột số nhà cung cấp và bậc cuối; các cột khác
là lựa chọn của tài liệu này). Hiệu chỉnh lại sau pilot bằng tỷ lệ ngoại lệ và tỷ lệ tín hiệu được ghi nhận:

| Bậc | Từ (VND) | NCC tối thiểu | Ký danh sách | Xoay vòng N | Award | Thẩm định trước trao | Khai xung đột | Đấu thầu chính thức |
|---|---|---|---|---|---|---|---|---|
| 0 | 0 | 2 | không | 0 | 1 · FINANCE, DIRECTOR | không | có | không |
| 1 | 100.000.000 | 3 | có | 5 | 1 · FINANCE, DIRECTOR | không | có | không |
| 2 | 1.000.000.000 | 5 | có | 5 | 2 · FINANCE, DIRECTOR | có | có | không |
| 3 | 10.000.000.000 | — | — | — | — | — | — | **có** |

**[S1.136]** Mặc định bổ sung, cũng GIẢ ĐỊNH:
- `award_vai_khac_nhau` = KHÔNG ở mọi bậc — bật nó ở bậc 2 thì kịch bản §7 cần thêm một người FINANCE (§8.10).
- `dual_approval_threshold` = 1.000.000.000, trùng mốc bậc 2 và bằng giá trị `gieo:demo` đang đặt. Bản nháp không nêu
  giá trị này, nên số chữ ký mở gói ở §7 không xác định được.
- Bậc 3 chỉ mang `dau_thau_chinh_thuc`. Hàm đọc bậc NÉM thay vì trả NULL, và trao thầu rơi vào bậc ấy bị từ chối (§4.7).

Mức chính sách: cửa sổ chia nhỏ **30 ngày**, hiệu lực thẩm định **12 tháng** — cũng GIẢ ĐỊNH. Mặc định là mẫu điền
sẵn trên màn khai chính sách và trong `gieo:demo`; **không migration nào tự tạo phiên bản chính sách** cho tổ chức —
`migrate()` tự đổi chính sách của khách hàng là đúng thứ `hardening.always.sql` [CR4] cấm. **[S1.136]** Chính xác hơn:
[CR4] gốc nói về việc hardening tự chữa bảng chỉ-ghi-thêm; chính tệp ấy áp NGUYÊN TẮC của nó cho dữ liệu chính sách
khách hàng ở mục kiểm `role_permissions` (*"migrate() tự tay đổi chính sách an ninh của khách hàng, đúng thứ [CR4] cấm"*).

### 4.2. Bậc áp cho một gói thầu

~~`rfq_budgets` nhận `tier_id` với khoá ngoại hợp thành `(org_id, policy_id, tier_id)` tới `org_policy_tiers`.~~
**[S1.136 / §2.5 ⑽]** `rfq_budgets` nhận `tier_tu_so_tien` — cận dưới của bậc áp. Cùng `policy_id` đã có, nó chỉ đúng
một phần tử của một mảng `jsonb` bất biến. Một
trigger **ĐẶT** ~~`tier_id`~~ cột ấy bằng kết quả của **`public.rfq_bac_cua(policy_id, estimated_value, currency)`** — hàm phân
bậc DUY NHẤT, mọi nơi khác gọi nó. **[S1.136 / §2.4 ⑸]** Ở tổ chức đã bật S3, ngân sách là BẮT BUỘC: gói không có
hàng `rfq_budgets` không rời DRAFT. Bản nháp để hở ca này, và cả S3 tắt được bằng cách bỏ một bước. Cột không nằm trong `GRANT INSERT`/`UPDATE`, khuôn `approved_content_hash` của
`011`: bên gọi không khai được bậc của gói mình. Ước lượng chỉ sửa được ở `DRAFT` (`014` §(3)), nên bậc cũng chỉ
đổi ở `DRAFT`.

Câu *"vì sao gói này chỉ cần ba nhà cung cấp và một chữ ký"* trả lời được từ dữ liệu, không cần hỏi ai và không cần
chạy lại ứng dụng ở phiên bản hôm đó — ADR-017 áp nguyên.

### 4.3. Nhóm hàng

**`procurement_categories`** — danh sách phẳng theo tổ chức (mã, tên, còn dùng). `rfq_packages.category_id` cho phép
`NULL` cho gói cũ; bắt buộc để rời `DRAFT` khi chính sách có `chia_nho_cua_so_ngay`. Không có nhóm hàng thì tín hiệu
chia nhỏ phải gộp MỌI gói của một người trong cửa sổ, và một người mua nhiều thứ khác nhau sẽ báo động giả liên tục.

Đây KHÔNG phải item master: ánh xạ hạng mục sang nhóm hàng chuẩn là S4.

**[S1.136]** `category_id` khoá sau DRAFT. Khối *"chỉ sửa ở DRAFT"* của thân ghim `061` chỉ phủ `title` và
`requires_dual_approval`, nên phải có trigger RIÊNG cho cột này. Không có nó, đổi nhóm hàng sau khi nộp duyệt là một lối
né tín hiệu chia nhỏ (§4.6). Mã quyền quản lý danh sách nhóm hàng chốt ở S3.0.

### 4.4. Ngoại lệ cạnh tranh

**`rfq_sourcing_exceptions`** — chỉ-ghi-thêm:

| Cột | Ghi chú |
|---|---|
| `loai` | `SINGLE_SOURCE` (một nhà cung cấp) · `LIMITED_COMPETITION` (ít hơn ngưỡng) · `ROTATION` (K3 không thoả) · **[S1.136]** `LOW_ACTUAL_COMPETITION` (hậu kiểm lúc trao thầu, §2.4 ⑹iv) · `LIST_NARROWED_BELOW_MIN` (thu hồi ở OPEN làm danh sách xuống dưới ngưỡng) |
| **[S1.136]** hàng RÚT | Chỉ-ghi-thêm kèm hàng rút, khuôn `rfq_awards` (`061`). Băm danh sách chỉ phủ ngoại lệ CÒN SỐNG — nếu không, một ngoại lệ ghi nhầm nằm mãi trong băm và mãi loại tác giả của nó khỏi người ký |
| `ma_ly_do` | Tập ĐÓNG của V2.1 §12 11.2: `PROPRIETARY_TECHNOLOGY` · `EXISTING_CONTRACT` · `EMERGENCY` · `NO_ALTERNATIVE` · `COMPATIBILITY` · `REGULATORY` · `OTHER` |
| `giai_trinh text` | `CHECK` không rỗng. `OTHER` đòi giải trình dài hơn một sàn — sàn là GIẢ ĐỊNH |
| `tac_gia` + phiên | Dẫn xuất qua `kiem_danh_tinh_theo_phien` (ADR-016) |

Ngoại lệ nằm TRONG băm nội dung (§3.3), nên người duyệt ký lên nó. **Một ngoại lệ không bao giờ tự duyệt:** gói có
ngoại lệ đòi ít nhất một chữ ký K5 kể cả ở bậc không bật `ky_danh_sach_moi`.

Tỷ lệ single-source (KPI của V2.1 §36) đếm thẳng từ bảng này.

### 4.5. Khai báo xung đột lợi ích

**`coi_declarations`** — chỉ-ghi-thêm: `(org_id, rfq_id, user_id, session_id, trang_thai, supplier_id, ghi_chu,
danh_sach_bam)`. `trang_thai ∈ {KHONG_XUNG_DOT, CO_XUNG_DOT}`; `CO_XUNG_DOT` đòi `supplier_id`.

- `danh_sach_bam` là băm của tập nhà cung cấp còn sống lúc khai. Khai báo chỉ có hiệu lực khi băm ấy BẰNG băm hiện
  tại: người khai *"không xung đột"* với một danh sách thì chưa khai gì về một nhà cung cấp thêm sau đó.
- `CO_XUNG_DOT` là **vĩnh viễn** cho gói ấy: không hàng nào sau đó gỡ được. Một khai báo gỡ được là một lối đi vòng
  — khai có xung đột khi bị hỏi, gỡ khi tới lượt ký.

Bốn cổng đòi khai báo hợp lệ của CHÍNH người hành động (K9): chữ ký mở gói (`rfq_approvals`), lượt chấm
(`rfq_evaluations`), đề xuất award, chữ ký duyệt award. **Cổng mở thầu KHÔNG đòi** — mở thầu chỉ giải mã, không
chọn ai thắng (nguyên tắc ⑶ *Open ≠ Award*), và §2.2 ⑵ giữ nguyên đường ấy.

**[S1.136 / §2.5 ⒄] Ba chỗ bản nháp hở.**
- **Thêm cổng** ở xác minh và thẩm định nhà cung cấp, ở ghi nhận tín hiệu, và ở huỷ trao thầu. Đó là những chỗ người
  hành động CÓ quyền quyết; lượt chấm thì tất định (J1/J2), nên cổng ở đó giữ lại nhưng không chịu lực.
- **Thứ tự:** khai `CO_XUNG_DOT` SAU khi đã ký thì chữ ký vẫn được đếm. Vậy phép đếm chữ ký ở cạnh mở gói và ở trao
  thầu loại người có `CO_XUNG_DOT`, và khai báo cùng chữ ký dùng chung một khoá tư vấn (gói, người) — khuôn `061`.
- **Không chốt:** khai báo theo từng nhà cung cấp ngay lúc mời. Người mời đã nằm trong tập loại trừ của K5 (§2.5 ⑿), và
  một lời khai ở đó vẫn là tự khai (§8.7).

### 4.6. Tín hiệu và ghi nhận

**`governance_signals`** — chỉ-ghi-thêm, mỗi hàng mang đủ năm thứ V2.1 §19 đòi: nguồn, thời điểm, bằng chứng
(`jsonb`), độ tin cậy, giải thích.

| Loại | Tính ở | Bằng chứng |
|---|---|---|
| `PURCHASE_SPLITTING` | `DRAFT→PENDING_APPROVAL` | Các gói cùng người tạo, cùng nhóm hàng, trong cửa sổ, mỗi gói dưới một cận bậc mà TỔNG vượt nó — V2.1 §12 11.3 dời từ PO sang ước lượng RFQ, vì PO ở ERP (S5) |
| `ESTIMATE_UNDERSTATED` | Đề xuất award | Bậc của số tiền trao cao hơn bậc của ước lượng |
| `INVITE_LIST_NARROWED` | Thu hồi lời mời sau khi danh sách đã được ký | Lời mời bị thu hồi, người thu hồi, lý do |
| **[S1.136]** `EARLY_CLOSE` | Đóng sớm một gói đã có báo giá | Hạn gốc, lúc đóng, người đóng, lý do. Vế *"phê duyệt riêng khi đã có báo giá"* mà `011` §(H-4) hoãn chưa bao giờ được làm; tín hiệu này đưa nó tới người ký trao thầu |

Mỗi loại tính bằng **một** hàm SQL. Hàng tín hiệu lưu ảnh chụp bằng chứng lúc tính; cạnh cần ghi nhận gọi lại đúng
hàm ấy và đòi một hàng **`governance_signal_acks`** — người ghi nhận khác người tạo gói, kèm lý do — trỏ tới một tín
hiệu có bằng chứng BẰNG kết quả hiện tại.

Tín hiệu **không chặn cạnh nào**. Nó chặn việc *không ai đọc nó*: `PENDING_APPROVAL→OPEN` đòi ghi nhận cho
`PURCHASE_SPLITTING`; chữ ký duyệt award đòi ghi nhận cho `ESTIMATE_UNDERSTATED` và `INVITE_LIST_NARROWED`.

**[S1.136 / §2.5 ⒁] Bản nháp khai hai điều kiện khác nhau** — §4.6 chặn khi KHÔNG có tín hiệu khớp, K10 cho qua khi
không có tín hiệu khớp. Hai cách đọc khác nhau đúng ở ca tín hiệu TRÔI: một gói anh em mới làm bằng chứng lệch, và gói
hoặc mở tự do, hoặc kẹt vĩnh viễn. Chốt:
- **Một điều kiện, fail-closed** (khuôn C-1): cạnh bị chặn khi tín hiệu tính NGAY LÚC ẤY khác tín hiệu đã ghi nhận.
  Tầng gói tính lại tín hiệu trong một giao dịch riêng — trigger BEFORE không lưu được hàng tín hiệu từ một cạnh đang bị
  từ chối.
- **Tập tất định:** cửa sổ neo vào `submitted_at` của chính gói; chỉ tính gói anh em đã rời DRAFT; khoá theo (tổ chức,
  nhóm hàng), không theo người tạo — nếu khoá theo người tạo thì để đồng nghiệp tạo gói là né được.
- **Người ghi nhận** giữ quyền của cạnh bị chặn (`rfq.approve` ở mở gói, `po.approve` ở trao thầu) và nằm ngoài {người
  tạo gói, người gây ra tín hiệu}. Bản nháp chỉ loại người tạo gói, nên người thu hồi tự ghi nhận được tín hiệu thu hẹp
  của chính mình.
- **Bằng chứng không mang số tiền:** `ESTIMATE_UNDERSTATED` lưu mốc bậc; nếu lưu số tiền trao thì `governance_signals`
  thành bảng thứ ba chứa giá dạng rõ, trái ADR-054. Tín hiệu ấy bắn cả khi số tiền trao vượt `dual_approval_threshold`
  mà ước lượng thì không — đúng lỗ `014` §(4) gọi tên, thứ bản nháp chỉ đo bằng bậc.

### 4.7. Award theo bậc

`CHU_KY_CAN` trong `award_kiem_mot_award_song` (`061`) thành hàm **`public.award_so_chu_ky_can(award_id)`** — khuôn
`unseal_so_phe_duyet_can` của `019`: một phép tính, một chỗ ở, hai người đọc. Nó trả `award_so_chu_ky` của bậc
**cao hơn** trong hai bậc: bậc của ước lượng và bậc của số tiền trao. Số tiền trao là tổng giá của báo giá được chọn,
đọc qua `bid_so_tien` (`020`) — cùng đại lượng với ước lượng, KHÔNG phải `effective_cost`, vì bậc đo *chi tiêu*
chứ không đo *chi phí hiệu dụng*.

**[S1.136 / §2.5 ⑽ và §2.4 ⑹iv, ⑺] Bốn vế bản nháp thiếu.**
- Hàm **NÉM khi gặp NULL.** Viết theo idiom sẵn có `IF so_chu_ky < CHU_KY_CAN`, một hàm trả NULL làm điều kiện ra NULL
  và không RAISE — trao thầu ở bậc 3 (mọi cột là *"—"*) sẽ lặng lẽ đi qua bằng MỘT chữ ký, đúng ca khai thấp nặng nhất.
- Trao thầu rơi vào bậc `dau_thau_chinh_thuc` bị **từ chối**. Cả hai bậc tính trên `rfq_budgets.policy_id`; lượt chấm
  của S2 đọc phiên bản HIỆN HÀNH, nên *"bậc cao hơn"* không được lấy từ đó.
- **Mọi chốt theo bậc được kiểm lại ở bậc cao hơn** lúc trao: K2, K5 và K8 ở bậc của số tiền trao; thiếu thì cần ngoại lệ
  có chữ ký độc lập. **Hậu kiểm** (§2.4 ⑹iv): số báo giá hợp lệ nhận được dưới `so_ncc_toi_thieu` của bậc cao hơn thì
  cần ngoại lệ `LOW_ACTUAL_COMPETITION`.
- **Người tạo phiên bản chính sách** mà gói ghim không ký duyệt award của gói ấy (§2.4 ⑺). Nếu bậc bật
  `award_vai_khac_nhau`, hai chữ ký thuộc hai vai khác nhau.

**Một lời khai trong kho SAI khi con số thành hai — ~~đọc ra, chưa đo~~ [S1.136] ĐÃ ĐO, khoản 242.** Chú thích của `duyetTraoThau` ghi *"nếu ngày nào
con số ấy thành hai, câu INSERT thứ hai từ chối với thông điệp gọi tên số chữ ký đang có, và lời gọi của người duyệt thứ
hai đi qua"*, và `061` ghi *"đổi `CHU_KY_CAN` là toàn bộ việc phải làm"*. Nhưng hàm ghi chữ ký rồi ghi hàng `APPROVED`
trong CÙNG giao dịch, không có savepoint: khi câu thứ hai bị từ chối, giao dịch huỷ trọn và **chữ ký của người duyệt đầu
mất theo** — người thứ hai gặp đúng lỗi ấy, và award không bao giờ duyệt được. S3.5 phải đo điều này trước khi đổi con
số, rồi tách hai bước: hỏi một hàm SQL *đủ chữ ký chưa* thay vì đếm ở TypeScript (hai bản đếm là hai bản trôi — chính chú
thích ấy nói thế), hoặc bọc câu thứ hai trong savepoint. **[S1.136]** Đo bằng đột biến `CHU_KY_CAN := 2` trên Postgres 16:
người duyệt đầu nhận *"can 2 chu ky duyet; dang co 1"*, số chữ ký còn lại **0**; người duyệt thứ hai (khác người, khác
vai) nhận đúng lỗi ấy, số chữ ký vẫn 0. Đối chứng `CHU_KY_CAN := 1`: duyệt được. Thêm một lý do câu ở `061` sai: hardening
ghim thân `award_kiem_mot_award_song` kèm đúng dòng hằng ấy, nên một migration chỉ đổi hằng bị ghim đặt lại (§2.5 ⒃).

Người ký phải giữ một vai thuộc `award_vai` của bậc ấy — đọc vai của người TẠI THỜI ĐIỂM KÝ từ `user_roles`. J3 giữ
nguyên, kể cả phạm vi hẹp của nó (khoản **233**).

### 4.8. Supplier Passport Level 2 và thẩm định

Mọi bảng dưới đây theo tổ chức mua — ADR (b), **[S1.136]** nay là **ADR-078**.

**[S1.136 / ADR-078] Ba điều bảng dưới chưa nói.**
- **Hai cấp:** XÁC MINH là việc nội bộ bên mua, không đòi nhà cung cấp làm gì, và đủ để được đếm vào K2/K3. THẨM ĐỊNH
  ĐẦY ĐỦ trên một phiên bản Passport chỉ đòi khi trao thầu ở bậc `tham_dinh_truoc_trao`. Không tách hai cấp thì quyết
  định §2.4 ⑹iii (chỉ đếm đã thẩm định) phá `PRODUCT.md` §8 ⑴.
- **Phiên Passport đặt CHÍNH `app.guest_session_id`,** cộng một GUC dẫn xuất mới cho nhà cung cấp. Mọi policy `_khach`
  hiện có chỉ hỏi đúng literal ấy, nên một GUC Passport riêng sẽ đi qua chúng như một kết nối NGƯỜI MUA. Phiên và OTP
  của Passport là bảng RIÊNG: `guest_sessions` và `invitation_otp_challenges` mang `invitation_id NOT NULL` (`010`).
- **Thẩm định luôn trỏ tới phiên bản Passport MỚI NHẤT** — nộp phiên bản mới, chẳng hạn đổi tài khoản ngân hàng, làm thẩm
  định cũ thôi hiệu lực (khuôn C-1). Người thẩm định không đề xuất và không ký trao thầu cho chính nhà cung cấp ấy trên
  cùng gói (ADR-051).

| Bảng | Giữ gì | Ghi chú thiết kế |
|---|---|---|
| `supplier_passport_requests` | Yêu cầu hồ sơ: nhà cung cấp, người liên hệ, lý do (`AWARD_PROPOSED` · `MANUAL`), người yêu cầu + phiên | Kích hoạt tự động khi đề xuất award ở bậc `tham_dinh_truoc_trao` cho một nhà cung cấp chưa có thẩm định còn hiệu lực — V2.1 §10 *"winning an RFQ"* |
| `supplier_passport_tokens` | Token Passport: băm SHA-256, hết hạn, dùng MỘT mục đích | Khuôn `rfq_invitation_tokens`; OTP đi kênh KHÁC link (ADR-015). Không dùng chung token lời mời: token mời gắn một gói thầu, Passport gắn một nhà cung cấp |
| `supplier_passport_versions` | Tên pháp lý, MST, người đại diện, địa chỉ, tài khoản ngân hàng, chứng nhận, nhóm hàng, tham chiếu tài liệu | Chỉ-ghi-thêm, mỗi lần nộp một phiên bản — khuôn `vendor_bid_versions`. Tài khoản ngân hàng: quyền theo CỘT, không vào log, không vào bộ bằng chứng |
| `supplier_documents` | Siêu dữ liệu tệp; tệp ở nơi cất ngoài | **S3.7b, chờ ADR (c)** |
| `supplier_qualifications` | Sự kiện `QUALIFIED` · `REVOKED`: phiên bản hồ sơ được thẩm định, người thẩm định + phiên, `hieu_luc_den`, lý do | Chỉ-ghi-thêm; *còn hiệu lực* là suy diễn: hàng mới nhất là `QUALIFIED` VÀ `now() < hieu_luc_den` — đồng hồ Postgres, ADR-005. **[S1.136]** *"Hàng mới nhất"* xếp theo một cột sequence và ghi dưới khoá tư vấn, không theo `now()`: một `REVOKED` bắt đầu trước nhưng commit sau một `QUALIFIED` sẽ bị lờ. Bảng mang CẢ hai cấp (xác minh / thẩm định đầy đủ) |

~~`suppliers.level` mở `CHECK` từ `(0, 1)` thành `(0, 1, 2)`;~~ **[S1.136 / ADR-078 ⑷]** `suppliers.level` KHÔNG đổi:
`011` đã `REVOKE UPDATE ON suppliers FROM app_api`, nên không đường nào ghi được `2`, và một cột trạng thái lưu tay là kết
luận trần (ADR-017). Level 2 là suy diễn: tồn tại một phiên bản Passport. Level 2 nghĩa là *có ít nhất một phiên bản Passport*,
KHÔNG nghĩa là *đã thẩm định*.

**Mã quyền mới: `supplier.qualify`**, mặc định cho `FINANCE`. Luật vai + người theo khuôn `033`:
`supplier.qualify` không đứng cùng `rfq.invite` — người chọn người dự thi không tự thẩm định người mình chọn. **[S1.136]**
Luật ấy đúng hôm nay nhờ MA TRẬN — mọi vai giữ `rfq.invite` đều giữ `rfq.create`, mà `033` đã tách khỏi FINANCE — chưa
nhờ trigger mới. Và nó không chặn người ĐỀ XUẤT trao thầu tự thẩm định, vì FINANCE giữ `award.recommend`: vế ấy do luật
hành vi ở trên giữ. Người xác minh cũng phải khác người tạo bản ghi nhà cung cấp. Hai lớp
là bắt buộc, cùng lý do `033` đã ghi: có HAI người ghi tạo được vi phạm (người sửa định nghĩa vai, người gán vai) và
mỗi trigger chỉ thấy một.

### 4.9. Hiệu suất nhà cung cấp

Một view **`security_invoker`** — mục (C) `CAU_DOC_VONG` của hardening đòi điều đó cho MỌI view — tính theo nhà cung
cấp trong tổ chức:

| Chỉ số | Đọc từ | Chỉ trên gói |
|---|---|---|
| Số lần được mời, số lần nộp, tỷ lệ phản hồi | `rfq_invitations`, `vendor_bid_versions` | `≥ CLOSED` (A6) |
| Thời gian phản hồi trung vị (mở gói → phiên bản nộp đầu) | `rfq_packages.opened_at`, `vendor_bid_versions` | `≥ CLOSED` |
| Số lần sửa báo giá trước hạn (V2.1 §11) | `vendor_bid_versions` | `≥ CLOSED` |
| Thứ hạng theo Effective Cost, khoảng cách tới hạng nhất | `rfq_evaluation_lines` | `≥ UNSEALED` (A4) |
| Số lần vào BAFO, số lần thắng, tỷ lệ thắng | `rfq_bafo_rounds`, `rfq_awards` | `≥ UNSEALED` |

Đọc bằng `bid.view` (PM, FINANCE, DIRECTOR). `BUYER` không đọc được ~~— cái giá nói thẳng: người mời không thấy hiệu
suất khi chọn người mời. Chọn ngược sẽ đưa giá sau mở thầu tới đúng vai ADR-058 gọi tên.~~ **[S1.136] Lý do vừa gạch
sai:** `PROCUREMENT_MANAGER` giữ CẢ `rfq.invite` lẫn `bid.view` (`005`), nên người mời vẫn đọc được hiệu suất. Chọn
`bid.view` đứng được vì một lý do khác: chỉ số từ giá là dữ liệu SAU mở thầu, và cổng của dữ liệu ấy đã là `bid.view`.

**[S1.136 / §2.5 ⒅] Hai vế thêm.**
- Phiên bản báo giá của vòng BAFO nằm chung `vendor_bid_versions` (`059`), và lọc *"≥ CLOSED"* theo trạng thái gói thì
  vẫn tính gói đang `BAFO_OPEN`. Nên phiên bản BAFO chỉ được tính khi vòng ấy đã đóng — nếu không, PM đọc được ai đã nộp
  lại trong một vòng còn niêm phong.
- View có một phép đo TÍNH ĐÚNG theo khuôn J2, không chỉ phép đo bí mật: tính lại từ bảng gốc ra đúng con số của view.

Dưới **5 gói** đã đóng (GIẢ ĐỊNH), mọi tỷ lệ hiện *"chưa đủ lịch sử"*, không hiện con số.

**Không có:** giao hàng đúng hạn, tỷ lệ lỗi, khiếu nại, tuân thủ hợp đồng — dữ liệu PO/GRN ở ERP, tức S5. Không có
điểm tổng hợp và không có trọng số: *Supplier Score* của V2.1 §13 là S4.

---

## 5. Bất biến nghiệp vụ mới — nhóm K

Mười hai bất biến — **[S1.136] mỗi hàng có sửa ở §5.1; đọc hai chỗ cùng nhau, và hàng K vào sổ theo bản §5.1.** Mỗi cái phải có một phép đo THẬT, một đối chứng DƯƠNG và một đột biến giết được nó, theo đúng
`docs/TEST-PLAN.md` §1. **Nhóm K vào sổ đăng ký của TEST-PLAN từng hàng SAU KHI hàng ấy được đo** — khuôn nhóm J
(S1.115), không cùng lúc với spec này.

| Mã | Mệnh đề | Cưỡng chế ở đâu |
|---|---|---|
| **K1** | Mọi gói rời `DRAFT` dưới chính sách có bậc mang khoá ngoại tới ĐÚNG hàng bậc mà `rfq_bac_cua` trả cho ước lượng của nó. Chính sách không bậc thì không gói nào rời `DRAFT` | Khoá ngoại hợp thành + trigger trên `rfq_budgets` và ở cạnh **[S1.136] → §5.1** |
| **K2** | `DRAFT→PENDING_APPROVAL` chỉ đi qua khi số nhà cung cấp khác nhau còn sống ≥ `so_ncc_toi_thieu` (chỉ đếm đã thẩm định nếu bậc đòi), hoặc có ngoại lệ đúng loại mang mã thuộc tập đóng cùng giải trình không rỗng. Bậc `dau_thau_chinh_thuc` không bao giờ đi qua | Trigger riêng ở cạnh — khuôn `014` §(4) **[S1.136] → §5.1** |
| **K3** | Khi `xoay_vong_n > 0`: danh sách có ít nhất một nhà cung cấp mà KHÔNG người mời nào của gói đã mời trong N gói gần nhất của chính người ấy, hoặc có ngoại lệ `ROTATION` | Hàm SQL trên `invited_by` + `supplier_id` + `created_at` (`013`) — không cần cột mới **[S1.136] → §5.1** |
| **K4** | Danh sách được ký là danh sách được mời: lời mời và ngoại lệ chỉ đổi được ở `DRAFT` (và THÊM lời mời ở `OPEN`); băm nội dung mà `rfq_approvals` ghim phủ danh sách mời còn sống và các ngoại lệ, nên một chữ ký nói nó đã ký lên danh sách nào | Trigger trên `rfq_invitations` và `rfq_sourcing_exceptions` theo khuôn `rfq_items_chi_sua_khi_soan` (`009`); `rfq_bam_noi_dung` mở rộng — khuôn C-1 của `011` **[S1.136] → §5.1** |
| **K5** | Khi bậc bật `ky_danh_sach_moi`, hoặc gói có ngoại lệ: `PENDING_APPROVAL→OPEN` cần ít nhất một chữ ký trên nội dung HIỆN TẠI từ một người KHÔNG thuộc {người tạo} ∪ {mọi `invited_by` của gói} ∪ {mọi tác giả ngoại lệ} | Trigger đọc dữ liệu THẬT, khuôn ADR-051 **[S1.136] → §5.1** |
| **K6** | Không token mời nào được đúc cho một gói chưa `OPEN`; lời mời tạo khi gói đã `OPEN` mang nhãn *mời sau khi ký*, và nhãn ấy đi vào bộ bằng chứng | Trigger trên `rfq_invitation_tokens` + trên `rfq_invitations` **[S1.136] → §5.1** |
| **K7** | Award được duyệt khi và chỉ khi đủ `award_so_chu_ky_can` chữ ký từ người khác nhau, mỗi người giữ một vai thuộc `award_vai` của bậc cao hơn trong hai bậc (ước lượng, số tiền trao) | `award_so_chu_ky_can` + trigger `061` dựng lại, ghim ở hardening **[S1.136] → §5.1** |
| **K8** | Khi bậc đòi, award chỉ duyệt được cho nhà cung cấp có thẩm định CÒN HIỆU LỰC tại thời điểm duyệt; người thẩm định không giữ `rfq.invite` — ở vai và ở người | Trigger đọc `supplier_qualifications` với `now()`; hai trigger khuôn `033` **[S1.136] → §5.1** |
| **K9** | Khi bậc bật `khai_xung_dot`: không ai ghi được chữ ký mở gói, lượt chấm, đề xuất hay chữ ký award của một gói khi không có khai báo `KHONG_XUNG_DOT` của CHÍNH mình với `danh_sach_bam` bằng băm hiện tại; một `CO_XUNG_DOT` chặn người ấy trên gói ấy vĩnh viễn, ở mọi bậc | Trigger ở bốn bảng. KHÔNG ở `unseal_approvals` — §4.5 **[S1.136] → §5.1** |
| **K10** | Tín hiệu không chặn cạnh nào, nhưng cạnh cần ghi nhận không đi qua khi một tín hiệu có bằng chứng BẰNG kết quả hiện tại chưa được một người khác người tạo gói ghi nhận | Hàm tín hiệu + trigger ở `PENDING_APPROVAL→OPEN` và ở chữ ký award **[S1.136] → §5.1** |
| **K11** | Không chỉ số hiệu suất nào đọc gói chưa `CLOSED`; không chỉ số từ giá nào đọc gói chưa `UNSEALED`; không phiên khách hay phiên Passport nào đọc được view hiệu suất, tín hiệu, ngoại lệ hay khai báo xung đột; một phiên Passport chỉ thấy hồ sơ của CHÍNH nhà cung cấp mình | Vị từ trong view; policy khách `RESTRICTIVE` trên mọi bảng mới (khoản 29); phiên Passport cô lập theo khuôn `027`; vòng quét route khuôn A2/J4 **[S1.136] → §5.1** |
| **K12** | Mọi lần từ chối QUYỀN của S3 để lại `PERMISSION_DENIED`; mọi lần từ chối nói người dùng đi SAI THỨ TỰ để lại `RFQ_STATE_DENIED`; từ chối nói CẤU HÌNH chưa sẵn sàng (chính sách không bậc) thì KHÔNG | Khuôn J6 + luật ADR-060. Giới hạn còn lại, nói ra: từ chối do TRIGGER huỷ giao dịch nên không lối nào ghi được — cùng giới hạn J6 **[S1.136] → §5.1** |

**K2 và K5 là cặp trung tâm của S3.** Cùng nhau, chúng biến ADR-058 ⑶ từ một đoạn văn thành hai phép đo: không ai
một mình chọn được người dự thi của một gói vượt ngưỡng, và không ai đi được dưới ngưỡng cạnh tranh mà không để lại
một lý do có người thứ hai ký.

**[S1.136]** Câu vừa rồi SAI dưới bản nháp, và lượt soi đo được vì sao: K2 đếm bản ghi nhà cung cấp mà chính vai mời tự
tạo được, K5 bỏ sót người bỏ tên khỏi danh sách, và cả hai được tính trên ước lượng do người chọn tự khai. §5.1 đóng ba lỗ
ấy. Sau §5.1, câu trên đúng với tổ chức đã bật S3 — và vẫn không đúng trước ba pháp nhân thật cùng một chủ (ADR-058).

### 5.1. [S1.136] Sửa sau lượt soi — mệnh đề chịu lực là bản ở đây

| Mã | Sửa | Nguồn |
|---|---|---|
| **K1** | Mọi gói rời DRAFT ở tổ chức đã bật S3 **có ngân sách** và mang `tier_tu_so_tien` bằng kết quả `rfq_bac_cua` trên `rfq_budgets.policy_id`. Phiên bản ấy phải đã có chữ ký thứ hai và phải là phiên bản đang hiệu lực lúc nộp duyệt. Đo bằng BẢNG CA BIÊN HẰNG SỐ (đúng 100 triệu, đúng 1 tỷ…), không bằng so với chính `rfq_bac_cua` — so thế là trùng ngôn, và đột biến `≤`→`<` ở biên sống sót | §2.4 ⑸⑺; §2.5 ⑽ |
| **K2** | Đếm theo bốn luật (§2.4 ⑹): không đếm nhà cung cấp/người liên hệ do người tạo gói hay người mời tạo; chỉ đếm nhà cung cấp có MST và xác minh còn hiệu lực; mỗi MST, mỗi đích liên hệ một lần. **K2b** (vào sổ ở S3.5): hậu kiểm lúc trao | §2.4 ⑹ |
| **K3** | Cửa sổ chỉ gồm gói đã `opened_at`, xếp `opened_at DESC, id DESC`, loại chính gói đang xét, và chỉ tính lời mời không bị thu hồi trước `opened_at` | §2.5 ⒀ |
| **K4** | Tách hai: **K4a** — lời mời và ngoại lệ chỉ đổi được ở DRAFT; ở OPEN chỉ THÊM, hoặc THU HỒI có lý do kèm tín hiệu. **K4b** — hàm băm danh sách RIÊNG ghim trên cột mới của `rfq_approvals`; UNIQUE theo (người, băm). Đo K4b bằng đổi danh sách GIỮA hai chữ ký, và bằng hai lần gia hạn một gói cấp kép (khoản **240**) | §2.5 ⑾ |
| **K5** | Sàn một chữ ký cho MỌI gói (người khác người tạo). Khi bậc bật `ky_danh_sach_moi` hoặc gói có ngoại lệ, tập loại trừ gồm: người tạo; mọi `invited_by` và mọi `revoked_by` (đọc mọi hàng, kể cả đã thu hồi); người đặt ngân sách; người nộp duyệt; người tạo bản ghi nhà cung cấp và người liên hệ trên danh sách; tác giả ngoại lệ. Kiểm lại ở bậc cao hơn lúc trao | §2.4 ⑸; §2.5 ⑿ |
| **K6** | Thêm: lời mời mang trạng thái *chưa gửi* khi gửi hỏng; lối *gửi lại* đúc token mới và thu hồi token cũ, không thu hồi lời mời. Vế *"nhãn vào bộ bằng chứng"* vào sổ ở S3.9, không ở S3.2 | §2.4 ⑼; §2.5 ⒆ |
| **K7** | Hàm số chữ ký NÉM khi NULL; trao ở bậc đấu thầu chính thức bị từ chối; người tạo phiên bản chính sách không ký; vai khác nhau khi bậc đòi. Cổng trao thầu là các trigger RIÊNG theo khuôn `014` §(4), không viết lại một thân nhiều lần | §2.4 ⑺; §2.5 ⑽⒆ |
| **K8** | Tách hai: **K8a** (S3.3) — xác minh cho K2, do người khác người tạo bản ghi, không giữ `rfq.invite`. **K8b** (S3.7) — thẩm định đầy đủ trên phiên bản Passport MỚI NHẤT, ở bậc cao hơn. Người thẩm định không đề xuất và không ký trao thầu cho chính nhà cung cấp ấy | ADR-078; §2.5 ⒄ |
| **K9** | Thêm cổng ở xác minh và thẩm định, ở ghi nhận tín hiệu, ở huỷ trao thầu. Phép đếm chữ ký loại người có `CO_XUNG_DOT`. Khai báo và chữ ký dùng chung khoá tư vấn (gói, người) | §2.5 ⒄ |
| **K10** | Một điều kiện, fail-closed; tính lại ở tầng gói; cửa sổ neo `submitted_at`; khoá (tổ chức, nhóm hàng); người ghi nhận ngoài {người tạo, người gây ra} và giữ quyền của cạnh bị chặn; thêm `EARLY_CLOSE` | §2.5 ⒁ |
| **K11** | Phiên bản BAFO chỉ tính khi vòng đã đóng; đối chứng dương T2 chạy CẢ lúc `BAFO_OPEN`. Phiên Passport đặt `app.guest_session_id` (ADR-078 ⑶). View mang vị từ khách trong thân | §2.5 ⒅; ADR-078 |
| **K12** | Mỗi chốt một hàm vị từ SQL, tầng gói gọi TRƯỚC mọi tác dụng phụ và ném theo `VAO_SO`. Lớp từ chối thứ ba (*vi phạm chốt kiểm soát*): chủ dự án chốt ở S3.0. Đo theo từng hạng mục từ S3.1, không dồn về S3.9 | §2.5 ⒂ |

**[S1.136] Hàng K vào sổ đăng ký của TEST-PLAN ở đúng hạng mục đo được nó.** Hàng nào chỉ đo được một nửa ở hạng mục đầu
thì tách làm hai (K2/K2b, K4a/K4b, K8a/K8b) — một ô mở cho một bất biến cưỡng chế nửa là đúng thứ khoản 239 đã đo.

---

## 6. Kiến trúc kiểm thử

~~Không có khuôn mới. Bảy tầng của `docs/TEST-PLAN.md` phủ đủ:~~ **[S1.136 / §2.5 ⒇] SAI:** T4 (Playwright) **CHƯA DỰNG** —
`TEST-PLAN.md` ghi thế, và Playwright không có trong `package.json`. Vế T4 dưới đây vì vậy là **lượt đi thử có biên bản**
cho mỗi hạng mục có màn (khuôn S1.97), không phải một bộ test. Và T5 không trả lời *"câu hỏi của `TIEN-DE-CHUA-DO.md`"*:
tệp ấy hỏi người mua thật, chỉ kịch bản ⑶ có hàng tương ứng (B3). Năm mũi đối kháng giữ nguyên, bỏ cái khung ấy.
Bản gốc:

- **T1** — hình dạng ngoài của đầu vào chính sách và ngoại lệ; lời giải thích bậc.
- **T2** — vòng quét route cho K11 dưới một phiên có `bid.view`, **có đối chứng dương**: bộ quét phải THẤY chỉ số của
  một gói ngay sau khi gói ấy `CLOSED`, không chỉ không thấy trước đó — cùng yêu cầu spec S2 §6 đặt cho J4.
- **T3** — mọi trigger và cạnh trên Postgres thật; K8 với đồng hồ Postgres qua ranh giới hết hạn.
- **T4** — `/tao-thau` luồng mới; màn khai chính sách; form Passport ở khung **375×812**, vì nhà cung cấp mở nó trên
  điện thoại như link mời.
- **T5** — năm kịch bản đối kháng, mỗi kịch bản là một câu hỏi của `docs/TIEN-DE-CHUA-DO.md` được trả lời bằng máy:
  ⑴ chiếm pool — một người mời đúng ba tên ấy ở sáu gói liên tiếp (ADR-058 ⒜); ⑵ chia nhỏ — ba gói 480/470/490 triệu
  cùng nhóm hàng trong mười ngày (V2.1 §12 11.3); ⑶ khai thấp ước lượng rồi trao ở giá thật (`014` §(4)); ⑷ tự thẩm
  định nhà cung cấp mình mời; ⑸ khai *có xung đột* rồi tìm đường ký.
- **Đột biến** — mỗi K một con; ít nhất một con mỗi trigger phải đi qua lớp CSDL bằng cách tắt trigger lúc chạy (khuôn
  `db/hardening-suy-tu-tinh-chat.int.test.ts`).

Một phép đo phải có mà dễ quên: **K4 đo bằng thay đổi danh sách GIỮA hai chữ ký**, không bằng thay đổi trước chữ ký
đầu. Đó chính là kịch bản reviewer đã dựng để tìm ra C-1 ở `011`, chỉ đổi *hạng mục* thành *lời mời*.

**[S1.136] Thêm các phép đo phải có:**
- **Ba ca đã đo ở lượt soi thành test T3 thường trực:**
  - đột biến `CHU_KY_CAN := 2` — khoản 242, S3.5;
  - gia hạn hai lần một gói cấp kép — khoản 240; **[S1.137]** đã vào kho cùng bản sửa (`067`, khối `[INV-D2] [S1.137 / khoản 240]` của `packages/rfq/src/rfq.int.test.ts`);
  - mở gói dưới ngưỡng với 0 chữ ký — khoản 241, S3.1.
  
  Cả ba đã chạy trên Postgres 16 bằng một bộ dựng cụm cục bộ thay testcontainers (biên bản §S1.136); đưa vào kho là việc
  của hạng mục tương ứng.
- **Năm mũi T5 thêm, mỗi mũi cho một đường vòng lượt soi tìm ra:**
  - dựng nhà cung cấp vỏ để đủ ngưỡng K2;
  - rửa cửa sổ K3 bằng gói nháp;
  - thu hồi ở DRAFT rồi tự ký K5;
  - gây ra tín hiệu rồi tự ghi nhận K10;
  - FINANCE tự hạ thước trao thầu (§2.4 ⑺).
- **Công tắc ADR-077 được đo cả hai chiều:** tổ chức chưa bật chạy nguyên hành vi MVP1 — cụm test hiện có là đối chứng;
  tổ chức đã bật thì không tạo được phiên bản không bậc.

---

## 7. Điều kiện hoàn thành

S3 xong khi câu dưới chạy được một lần, đầu tới cuối, **trên giao diện**, không bước nào cần người của dự án gõ lệnh:

> Người tài chính của một tổ chức khai một phiên bản chính sách có bốn bậc giá trị. Một người mua tạo gói 1,2 tỷ —
> bậc cần năm nhà cung cấp — nhưng chỉ tìm được bốn; hệ thống đòi một ngoại lệ có mã lý do, và những người duyệt —
> không ai trong số họ tạo gói hay mời ai — khai không xung đột rồi ký danh sách cùng ngoại lệ. Gói mở, nộp và mở
> niêm phong như MVP1.
> Người mua đề xuất trao cho nhà cung cấp B; B nhận link Passport trên điện thoại và nộp hồ sơ; người tài chính thẩm
> định; hai người thuộc đúng vai của bậc ký duyệt. Ba gói 480, 470 và 490 triệu cùng nhóm hàng của một người trong
> ba mươi ngày hiện tín hiệu *"có thể chia nhỏ"* mà người duyệt phải ghi nhận trước khi gói thứ ba mở. Bộ bằng chứng
> xuất ra trả lời được, từ dữ liệu, **vì sao gói 1,2 tỷ cần bấy nhiêu nhà cung cấp và bấy nhiêu chữ ký**.

Vế cuối là điều kiện nghiệm thu thật — cùng cách spec S2 §7 đặt: không phải *"có bậc"* mà *"bậc ấy tái lập được từ
dữ liệu"*.

**[S1.136] Kịch bản trên chạy được dưới mặc định §4.1, nhưng chỉ khi có ĐỦ NGƯỜI, và bản nháp không nói điều đó.**

Hai chỗ trong bản nháp phải sửa:
- Câu *"người mua tạo gói… người mua đề xuất trao"*: nếu là cùng một người thì J3 chặn.
- Số chữ ký mở gói không xác định được khi `dual_approval_threshold` không có mặc định.

Vai từng bước, với ngưỡng kép 1 tỷ (§4.1):

| Bước | Ai | Vì sao phải là người ấy |
|---|---|---|
| Khai phiên bản chính sách | F1 (FINANCE) | `policy.manage` |
| Ký phiên bản chính sách | F2 (FINANCE), khác F1 | §2.4 ⑺ |
| Tạo gói, mời, lập ngoại lệ | P1 (BUYER hay PM) | — |
| Xác minh nhà cung cấp mới | F2 | `supplier.qualify`, khác người tạo bản ghi, không giữ `rfq.invite` |
| Ký danh sách và mở gói | P2, P3 (PM) | 1,2 tỷ ≥ ngưỡng kép ⇒ hai chữ ký (C-1); cả hai ngoài tập loại trừ K5 |
| Mở niêm phong | D1, D2 (DIRECTOR) | D2 |
| Đề xuất trao thầu | P2 | Khác người tạo gói và người điều phối (J3) |
| Thẩm định đầy đủ B | F2 | — |
| Ký duyệt trao thầu | D1, D2 | Hai chữ ký ở bậc 2. F1 bị loại (tác giả chính sách), F2 bị loại (đã thẩm định B) |

Tối thiểu **7 người**: F1, F2, P1, P2, P3, D1, D2. Thêm vào đó: ít nhất năm nhà cung cấp đã xác minh, và danh mục nhóm hàng.
`gieo:demo` hôm nay có 3 PM, 2 DIRECTOR, 0 FINANCE, 3 nhà cung cấp và một chính sách không bậc — hạng mục S3.1 phải gieo
lại theo bảng này.

---

## 8. Rủi ro

### 8.1. Kiểm soát giả do cấu hình — rủi ro chi phối

Một bậc đặt *"tối thiểu 1 nhà cung cấp"*, một ngưỡng chữ ký thứ hai đặt ở 100 tỷ — S3 cưỡng chế chúng đúng như khai,
và sản phẩm trông như có kiểm soát. Không lớp nào của S3 phán được một chính sách là *đủ chặt*: đó là quyết định của
khách hàng.

Thứ S3 làm được: ⑴ người khai chính sách không cầm thứ bị đo (`033`); ⑵ màn khai chính sách hiện trọn ma trận, gồm cả
`dual_approval_threshold`, và CẢNH BÁO — không chặn — những cấu hình rỗng ruột: bậc cao với `so_ncc_toi_thieu = 1`;
một bậc LỎNG hơn bậc dưới nó (số nhà cung cấp hay số chữ ký giảm khi giá trị tăng); `ky_danh_sach_moi` tắt ở mọi bậc;
⑶ mọi phiên bản chính sách xuất được, nên kiểm toán viên đọc được chính sách lúc gói ấy chạy.

### 8.2. Ngoại lệ thành thủ tục

Nếu ngưỡng cao hơn thị trường của nhóm hàng, MỌI gói đều cần ngoại lệ, và ngoại lệ thành một nút bấm ai cũng ký —
đúng kiểm soát giả ở §8.1, sinh ra từ phía ngược lại. Giảm bằng: tỷ lệ ngoại lệ theo bậc và theo nhóm hàng là một chỉ
số hiện ở màn chính sách; ngưỡng cảnh báo cho tỷ lệ ấy là GIẢ ĐỊNH chờ pilot.

**[S1.136]** Quyết định §2.4 ⑹iii — chỉ đếm nhà cung cấp đã xác minh — làm rủi ro này cao nhất đúng lúc tổ chức vừa
bật S3: 0 nhà cung cấp đã xác minh thì mọi gói cần ngoại lệ, cho tới khi bên mua xác minh dần. Chủ dự án chọn điều đó
khi biết giá. Cách giảm: màn nhà cung cấp cho xác minh HÀNG LOẠT trước ngày bật — việc của người giữ `supplier.qualify`,
không phải của nhà cung cấp.

### 8.3. Tín hiệu trên tập rỗng

Chia nhỏ và hiệu suất cần lịch sử. Trước pilot, cả hai chỉ được đo trên dữ liệu tổng hợp, và tài liệu này nói thẳng
điều ấy — đúng cái bẫy ADR-058 ⑷ gọi tên, được chấp nhận có ý thức ở §2.2 ⑶. Hai hệ quả bắt buộc: dưới sàn lịch sử,
giao diện hiện *"chưa đủ lịch sử"* thay vì một con số; và không tham số nào của hai tín hiệu này được gọi là *đã hiệu
chỉnh* trước khi có dữ liệu thật.

### 8.4. Khai thấp ước lượng chỉ bị bắt ở một trong ba cổng

S3 bắt khai thấp ở **award**: bậc nâng theo số tiền trao (§4.7) và tín hiệu `ESTIMATE_UNDERSTATED` phải được ghi nhận.
Nó **không** bắt ở mở gói và mở thầu: `requires_dual_approval` vẫn tính trên ước lượng, trước khi có giá. Một người khai
thấp vẫn tránh được chữ ký thứ hai của mở gói và mở thầu; thứ họ không tránh được nữa là số chữ ký của quyết định tiền
— và một dấu vết đọc được. Đóng hai cổng kia cần biết giá trước mở thầu, tức phá A1.

**[S1.136] Đoạn trên đếm thiếu một cổng, và là cổng nặng nhất.** Khai thấp ước lượng còn né được cặp trung tâm K2+K5 ở
cạnh `DRAFT→PENDING_APPROVAL`: một gói mua 900 triệu khai 99 triệu rơi xuống bậc 0, nên chỉ cần 2 nhà cung cấp và không
cần ký danh sách. Lượt soi đóng phần đóng được, cũng ở trao thầu (§4.7):
- K2, K5 và K8 được kiểm lại ở bậc của số tiền trao;
- hậu kiểm số báo giá nhận được;
- tín hiệu `ESTIMATE_UNDERSTATED` bắn cả khi vượt ngưỡng kép.

Phần không đóng được vẫn như trên: trước khi mở thầu không ai biết giá.

### 8.5. Luồng mời đổi thứ tự

§3.3 đổi thứ tự của `/tao-thau`, của `gieo:demo`, và của kịch bản 41 (`apps/unseal-worker/src/kich-ban-41*.int.test.ts`).
Kịch bản §11 của PRODUCT vẫn chạy, nhưng các bước đổi chỗ — nên sau S3.2 phải chạy lại lượt đi thử kiểu S1.97 trên
trình duyệt thật, không chỉ cụm test.

**[S1.136] Đo lại quy mô, và công tắc ADR-077 đổi nó.**
- Có 19 tệp test tích hợp đi tới `PENDING_APPROVAL` và 8 tệp tạo lời mời. `packages/invitation/src/invitation.int.test.ts`
  đúc token cho gói còn ở DRAFT — K6 sẽ chặn đúng thao tác ấy.
- Dưới công tắc một chiều, mọi tệp ấy chạy với tổ chức CHƯA bật nên giữ nguyên hành vi MVP1. Chúng trở thành đối chứng
  cho nhánh *chưa bật*, không phải thứ phải viết lại.
- Test của S3 dựng tổ chức ĐÃ bật bằng fixture riêng.
- Kịch bản 41 đặt ngân sách đúng 1 tỷ — với định nghĩa cận dưới, đúng mốc ấy là bậc 2. Nó chỉ đổi hành vi nếu tổ chức của
  nó được bật.

### 8.6. Passport mang dữ liệu nhạy cảm và tệp

Tài khoản ngân hàng và người đại diện là dữ liệu cá nhân và tài chính; tệp tải lên là bề mặt tấn công mà kho chưa có.
Cả hai đi qua ADR (b)(c) và một lượt `security-reviewer` riêng. Friction chỉ rơi vào nhà cung cấp được đề xuất trao
thầu, đúng V2.1 §10 — nhưng nó rơi vào ĐÚNG nhà cung cấp người mua đang muốn giữ.

### 8.7. Khai báo xung đột là tự khai

Người nói dối vẫn đi qua K9. Thứ K9 tạo ra là **trách nhiệm**, không phải **phát hiện**: một khai báo sai là một lời khai
có chủ thể, có thời điểm, có phiên. Khi S3.4 vào mã, `docs/PRODUCT.md` §5 phải có dòng tương ứng — *"kiểm soát xung đột
lợi ích"* → *"buộc người quyết định khai báo và tự rút; khai sai để lại dấu"*.

### 8.8. Chỉ một vai giữ `rfq.approve` — **[S1.136]** xem thêm §8.10

Đọc trên mọi câu ghi `role_permissions` từ `005` tới `059`, kể cả câu `DELETE` của `033`: `rfq.approve` chỉ nằm ở
`PROCUREMENT_MANAGER`, và vai ấy cũng giữ `rfq.invite`.
K5 vì thế buộc một điều về tổ chức: ở bậc bật `ky_danh_sach_moi`, người mời và người ký danh sách phải là hai người —
hoặc `BUYER` mời và một PM ký, hoặc hai PM. Một tổ chức chỉ có một PM tự mời thì không mở được gói ở bậc ấy. Đó là
đúng thứ ADR-058 ⑶(c) muốn, nhưng pilot nhỏ sẽ gặp nó ở gói đầu tiên, nên màn khai chính sách phải nói ra trước.

### 8.9. Phạm vi và các nhánh song song

Bảy mục cộng khâu mời dựng lại cộng Passport có tệp là nhiều hơn 4–6 tuần của §32 (§9). ~~Và ngày viết tài liệu này, bốn
nhánh triển khai đang sống đã cấp **ADR-065…068** và vòng **S1.122…S1.125** mà `master` chưa có:~~ ~~số ADR, số khoản nợ và
số migration của S3 phải lấy max trên MỌI nhánh đang sống — đúng bài học đổi số của ADR-058.~~

**[S1.136] Các con số vừa gạch thiu trong vài giờ.** Tới lượt soi, `master` đã có ADR-065/066; nhánh `…-sms` đã cấp
ADR-069 và vòng S1.126 — chính vòng viết spec này đụng số S1.126 và phải đổi sang S1.127 (khuôn S1.111); nhánh
`…-khoan-233` đã cấp migration `064`. Nên thay con số bằng một LUẬT: *mỗi vòng đo max của số ADR, số vòng, số khoản nợ và
số migration trên mọi nhánh đang sống ngay trước khi commit*.

Luật ấy bắt được chính lượt soi, hai lần. Lần đo đầu trước commit:
- `…-public-keys` đã vào `master` với vòng S1.127 và ADR-070;
- `…-neo-ecs` đã cấp S1.128 và ADR-071, rồi vào `master` qua PR #140;
- `…-lich-neo` đang dùng ADR-072.

Lần đo thứ hai, ngay trước commit: `…-khoan-233` vừa đổi nhãn sang S1.129. Nên vòng viết spec đổi lần hai thành
**S1.130**, lượt soi thành **S1.131**, và ba ADR của lượt soi thành **ADR-073…075**.

Lần đo thứ ba, lúc mở PR: `master` đã nhận S1.130–S1.132, ADR-072…074 và migration `065`, `066` từ các nhánh neo và khoản
196; `…-hsts` giữ S1.133 và ADR-075, rồi `…-dns-egress` giữ S1.134 và ADR-076. Nên vòng viết spec thành **S1.135**, lượt soi thành **S1.136**, vòng sửa khoản 240
thành **S1.137**, ba ADR thành **ADR-078…079**, và migration của khoản 240 thành **`067`**.

Nhánh `…-khoan-233` còn định nghĩa lại `award_kiem_de_xuat` và đóng khoản 233. Khi nhánh ấy merge, câu *"J3 giữ nguyên,
kể cả phạm vi hẹp của nó (khoản 233)"* ở §4.7 thiu, và S3.4, S3.5 phải dựng trên thân hàm của `064`.

### 8.10. [S1.136] Số người tối thiểu

Dưới mặc định, một gói bậc 2 cần **7 người khác nhau** (§7). Ba luật cộng lại tạo ra con số ấy: sàn một chữ ký cộng tập
loại trừ K5; chữ ký thứ hai cho chính sách; người thẩm định và tác giả chính sách không được ký trao thầu. Một tổ chức
nhỏ sẽ gặp điều này ở gói lớn đầu tiên — và khi thiếu người, lối thoát dễ nhất là nới chính sách, tức đúng kiểm soát
giả ở §8.1. Màn khai chính sách phải cho thấy số người tối thiểu mà một cấu hình đòi, trước khi tổ chức bật S3.

### 8.11. [S1.136] Hai luồng sống song song dưới công tắc

ADR-077 giữ `master` triển khai được, và trả bằng hai luồng mời cùng hai tập luật tới ngày mọi tổ chức đã bật. Một trigger
S3 quên rẽ nhánh theo hàm *đã bật* sẽ đổi hành vi của tổ chức chưa bật trong im lặng. Cụm test hiện có là đối chứng của
nhánh ấy, nên nó phải xanh NGUYÊN VĂN sau mỗi hạng mục S3.x.

---

## 9. Phân rã công việc — ước lượng 7–9 tuần

V2.1 §32 đặt MVP2 là 4–6 tuần cho bảy mục. Phạm vi ở §2.2 ⑴ thêm khâu mời dựng lại (§3.3) và Passport có tệp. ~~MVP1 đặt
6–8 tuần và đo ra 9–11 (PRODUCT §6).~~ **[S1.136] Trích sai:** PRODUCT §6 nói 9–11 tuần là ước lượng từ phân rã kỹ thuật,
không phải số đo. Số đo duy nhất trong kho: S2 ước 3–4 tuần, còn thực tế chạy từ S1.101 tới S1.114 hết khoảng 41 giờ qua
14 vòng. Con số 7–9 tuần ở đầu mục là một ước lượng cùng loại, không hơn. Lượt soi còn thêm việc — công tắc, xác minh,
chữ ký chính sách — nên nếu có trôi thì trôi lên.

**[S1.136] Bảng dưới giữ nguyên văn; thay đổi của lượt soi nằm ở bảng ngay sau nó.**

| # | Hạng mục | Ra cái gì |
|---|---|---|
| **S3.0** | Nền | Ba ADR của §2.3; dải mã bất biến `[A-HJ]` nới thành `[A-HJK]` ở MỌI chỗ ghim **trước** hạng mục đầu — bài học khoản **229**, khi J4 có đủ phép đo mà không có ô; mã `supplier.qualify` + luật vai/người khuôn `033`; gói `packages/kiem-soat` + ranh giới `depcruise` |
| S3.1 | Bậc giá trị | `org_policy_tiers`, cột mức chính sách, `rfq_bac_cua`, `tier_id` trên `rfq_budgets`, fail-closed, **K1**; màn khai chính sách cho `policy.manage` |
| S3.2 | Khâu mời dựng lại | Mời ở `DRAFT`, đúc token và gửi link lúc `OPEN` qua outbox, `rfq_bam_noi_dung` phủ danh sách, **K4 + K6**; `/tao-thau`, `gieo:demo`, kịch bản 41 theo thứ tự mới |
| S3.3 | Cạnh tranh tối thiểu | Ngoại lệ, đấu thầu chính thức, xoay vòng, chữ ký thứ hai theo hành vi — **K2 + K3 + K5**. **Khoản 234 đóng ở đây** |
| S3.4 | Xung đột lợi ích | `coi_declarations`, cổng ở bốn chỗ, **K9**; dòng PRODUCT §5 |
| S3.5 | Award theo bậc | `award_so_chu_ky_can`, vai theo bậc, nâng bậc khi khai thấp — **K7** |
| S3.6 | Tín hiệu | Nhóm hàng, `governance_signals` + ghi nhận, ba loại tín hiệu — **K10** |
| S3.7 | Passport + thẩm định | Đường nhà cung cấp, dữ liệu có cấu trúc, `supplier_qualifications`, **K8**. **S3.7b** — tài liệu đính kèm, chờ ADR (c) |
| S3.8 | Hiệu suất nhà cung cấp | View, màn, vòng quét route có đối chứng dương — **K11** |
| S3.9 | Bằng chứng | Bộ xuất ADR-059 mang lớp governance — bậc, ngoại lệ, khai báo, tín hiệu và ghi nhận, thẩm định; **K12** đối chiếu trên toàn bộ từ chối của S3 |

**[S1.136] Thay đổi theo hạng mục:**

| # | Thêm hoặc đổi |
|---|---|
| **S3.0** | ADR-077/071 đã chốt ở lượt soi. Việc còn lại: **bảng mã quyền** cho hành vi mới (lập ngoại lệ, ghi nhận tín hiệu, quản lý nhóm hàng, xác minh, cạnh về DRAFT, gửi lại link) và **lớp từ chối thứ ba** của K12 — cả hai do chủ dự án chốt. Nới dải `[A-HJ]`→`[A-HJK]` ở mọi chỗ ghim đếm bằng grep lúc làm (hôm nay 10 chỗ trong mã, cộng mẫu của `parse.test.ts`), kèm một hàng K mẫu và ca giết mũi thu dải. Phép kiểm `"ABCDEFGH"` ở `tools/inv-matrix/src/danh-gia.test.ts` chỉ thêm K khi K1 đã vào sổ, tức S3.1 |
| **S3.1** | Bậc `jsonb` trên hàng chính sách; chữ ký thứ hai cho phiên bản; hàm *đã bật* của công tắc ADR-077; ngân sách bắt buộc; sàn một chữ ký; K1; gieo lại `gieo:demo` theo bảng vai của §7 |
| **S3.2** | Băm danh sách RIÊNG + UNIQUE (người, băm); hàm, route và mã quyền cho cạnh về DRAFT; đúc token lúc mở gói; trạng thái *chưa gửi* và lối *gửi lại*; K4a/K4b, K6; ~~sửa khoản 240 nếu nó chưa được sửa ở vòng riêng~~ **[S1.137]** khoản 240 đã sửa ở vòng riêng (`067`) |
| **S3.3** | **Xác minh nội bộ lên đây** (K8a) — K2 cần nó; bốn luật đếm; ngoại lệ có hàng rút; K3 theo định nghĩa §5.1; tập loại trừ K5 mở rộng |
| **S3.5** | Hàm số chữ ký NÉM khi NULL; từ chối bậc đấu thầu chính thức; kiểm lại K2/K5/K8 ở bậc cao hơn; hậu kiểm (K2b); tác giả chính sách bị loại; cổng trao thầu thành các trigger RIÊNG; đóng khoản 242 ⑴ |
| **S3.6** | Một điều kiện fail-closed; `EARLY_CLOSE`; khoá `category_id` sau DRAFT |
| **S3.7** | Thẩm định đầy đủ (K8b) trên phiên bản Passport mới nhất; phiên Passport theo ADR-078 ⑶ — cả khối GUC, policy khai, `withTenant` |
| **S3.8** | Phiên bản BAFO chỉ tính khi vòng đã đóng; phép đo tính đúng |
| **S3.9** | Bộ xuất mang cả số tiền trao, để tái lập được bậc của trao thầu, cộng một bộ kiểm bậc ĐỘC LẬP (khuôn ADR-059) |

Mỗi hạng mục đi đúng vòng lặp bắt buộc ở spec S0+S1 §9: đo trước khi viết, một bất biến một phép đo, đột biến, rồi tài
liệu. Mọi trigger và hàm mới ghim ở `db/migrations/hardening.always.sql` trong CÙNG commit với migration — S1.96 đo được
rằng migration một mình là no-op.

---

## 10. Ngoài phạm vi tài liệu này

- **Risk Score 0–100, phát hiện bất thường, tín hiệu IP/thiết bị/metadata, đồ thị quan hệ nhà cung cấp, phân tích thiên
  vị người mua** — V2.1 §17–§20 và §33 xếp vào MVP3, tức S4. Spec S2 §10 đã đẩy *Risk Analysis* sang S3; tài liệu này
  đẩy tiếp sang S4 theo phạm vi ở §2.2 ⑴ — bảy mục của §32 không có nó — và theo chính V2.1.
- **Phát hiện xoay vòng bằng thống kê** (ADR-058 ⑸) — S4. S3 chỉ để lại dữ liệu mô tả ở §4.9.
- **Hiệu suất từ ERP** — giao hàng, chất lượng, khiếu nại, tuân thủ hợp đồng — S5.
- **Vai riêng theo tổ chức, chuỗi duyệt nhiều bước, `approval_policies/steps/instances`** — Enterprise (V2.1 §34
  *Custom Policy Engine*). Khi tới lượt, đường đi là bảng ĐÈ theo tổ chức như `005` đã ghi, và khoá ngoại
  `role_code REFERENCES roles(code)` là chi phí đã được gọi tên.
- **Chia sẻ Passport xuyên tổ chức** — Enterprise, cần ADR riêng về oracle (ADR-013 §4).
- **Quy trình hội đồng chấm** (spec S2 §10) — không thuộc §32. Khai báo xung đột (K9) phủ người chấm.
- **Negotiation Exception sau BAFO** (V2.1 §9) — không thuộc §32.
- **Cấm duyệt một chạm cho gói rủi ro cao** (V2.1 §24) — cần Risk Score, tức S4.
- **Purchase Request / Demand, phòng ban** (V2.1 §4, §26) — không thuộc §32.
- **Cạnh trạng thái khi huỷ gói sau `CLOSED`** — khoản **225** giữ nguyên; S3 không thêm cạnh (§3.1).
- **[S1.136] Khai báo xung đột theo từng nhà cung cấp lúc mời** — không chốt (§4.5).
- **[S1.136] Lớp từ chối thứ ba của K12** — chờ chủ dự án ở S3.0.
- **[S1.136] Ba hàm trợ giúp của MVP1 chưa được ghim** (`rfq_bam_noi_dung`, `rfq_can_phe_duyet_kep`,
  `unseal_so_phe_duyet_can`) — ngoài S3. Lượt soi đọc ra chúng nhưng chưa đối chiếu với danh mục ADR-028/036 xem đã là
  giới hạn đã biết chưa.
- **[S1.136] Tổ chức chưa bật S3** — giữ nguyên hành vi và các lỗ đã đo của MVP1 (khoản 241, nhà cung cấp vỏ); ADR-077 ⑶.
