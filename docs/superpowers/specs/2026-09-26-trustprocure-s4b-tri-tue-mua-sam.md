# TrustProcure V2 — Thiết kế S4b: Trí tuệ mua sắm (Intelligence · MVP3, nửa sau)

> **Ngày:** 2026-09-26 · **Trạng thái:** **BẢN NHÁP — chưa qua lượt soi hình dạng.** Viết TRƯỚC cổng dữ liệu (e), theo lựa
> chọn của chủ dự án ngày 2026-09-26: thiết kế đầy đủ bây giờ, không viết mã; mọi con số mang nhãn GIẢ ĐỊNH; cổng (e) vẫn
> chặn mã của S4b.2 trở đi. Sáu câu hỏi cho chủ dự án ở §2.3. Chưa một dòng mã nào của S4b.
> **Là nửa sau của:** `docs/superpowers/specs/2026-09-26-trustprocure-s4-nen-du-lieu-tri-tue.md` (spec S4, đã qua lượt soi
> S1.9102). Tài liệu này thay §4.9 của spec ấy ở mức chi tiết; §4.9 chỉ giữ HÌNH DẠNG. Mọi quyết định của spec S4 — §2.2
> ⑴–⑷, §2.4 ⑸–⑾, §2.5 ⑿–㉕, ADR-9201…9205 — áp nguyên ở đây.
> **Nguồn:** V2.1 §13 *Supplier Intelligence*, §17 *Risk Engine*, §19 *Risk Score mẫu*, §20 *AI / Analytics*, §22 *Award
> Recommendation*, §24 *Executive Experience*, §36 *KPI*, §41 *Kịch bản Demo*. Bản nguồn không nằm trong kho; bản đọc là bản
> trên Drive của chủ dự án, cùng bản spec S4 đã đối chiếu.
> **Đóng khi có mã:** bốn mục spec S4 ghi *"nhận về, chưa đóng"* — Risk Score, phát hiện bất thường, phân tích người mua,
> phát hiện xoay vòng bằng thống kê (ADR-058 ⑸) — cộng S4b.1 (cấm duyệt một chạm, V2.1 §24) và màn *Executive* (V2.1 §24).
> **Không đóng:** tín hiệu danh tính và kỹ thuật của §17, đồ thị quan hệ §18 (spec S4 §2.2 ⑴); *Quality*, *Delivery* của
> Supplier Score (S5); *specification anomaly* của §20 (kho không lưu lịch sử sửa hạng mục ở `DRAFT`).

---

## 1. Bối cảnh — một spec cho thứ chưa được phép xây

Hôm nay, đo trên `master` `9b3cf8d`: S3 mới xong S3.0, S4a chưa có dòng mã nào, chưa có khách hàng pilot. Mọi đầu vào của
S4b đều nằm trong bảng chưa tồn tại:
- Risk Score đọc tín hiệu governance (S3.6), kết quả benchmark (S4.5) và lời khai TCO (S4.7);
- Supplier Score đọc view hiệu suất (S3.8) và bảng thẩm định (S3.7);
- S4b.1 dựng trên cổng trao thầu của S3.5.

Nên tài liệu này không mở vòng mã nào. Nó làm ba việc để khi cổng mở, người viết mã không phải đoán:

1. **Thiết kế cấu trúc, không hiệu chỉnh con số.** Mỗi yếu tố rủi ro có nguồn, phép tính tất định, sàn lịch sử, cách chia
   mức, dạng bằng chứng và *người gây ra*. Mọi ngưỡng là GIẢ ĐỊNH. Đó đúng là cái bẫy ADR-058 ⑷ gọi tên — *"dựng một phép
   đo trên tập rỗng"* — và nó được chấp nhận có ý thức: cấu trúc thì kiểm được trên dữ liệu tổng hợp, con số thì không.
2. **Mọi đầu ra là một CHỈ BÁO CẦN XEM XÉT, tính tại một mốc, và giải thích được.** Không đầu ra nào của S4b là kết luận.
   Mỗi con số đi kèm thành phần của nó và phần trọng số thật sự có dữ liệu.
3. **Tách phần cắn được trước cổng khỏi phần chờ cổng.** S4b.1 — không duyệt một chạm ở rủi ro cao — có nghĩa từ gói đầu
   tiên, vì ở tổ chức chưa đủ dữ liệu mức là `KHONG_XAC_DINH` và bị xử như `CAO` (spec S4 §2.4 ⑼). Phần còn lại chờ cổng (e).

Rủi ro chi phối của S4b, và nó khác của S4a: ***một con số đọc như một phán quyết.*** Một điểm 82/100 bên cạnh tên một nhà
cung cấp hay tên một nhân viên sẽ được đọc là *"người này gian lận"*, bất kể màn hình ghi gì bên dưới. PRODUCT §4 ⑸ và §5 cấm
đúng điều đó. Mọi quyết định dưới đây được cân theo rủi ro ấy trước.

---

## 2. Những thứ đã chốt TRƯỚC khi có tài liệu này

| # | Ràng buộc | Nguồn | Hệ quả cho S4b |
|---|---|---|---|
| 1 | **Risk Signal ≠ Fraud Verdict** | PRODUCT §4 ⑸, §5; V2.1 §18, §19, §20 | Chữ trên màn: *"điểm rủi ro — chỉ báo cần xem xét"*. Nhãn thuộc tập đóng. Không màn nào có chữ *gian lận*, *thông đồng*, *bất thường* gắn với tên một người |
| 2 | Mọi tín hiệu mang đủ năm trường | V2.1 §19; spec S3 §4.6 | Nguồn, thời điểm, bằng chứng, độ tin cậy, giải thích — trên MỖI hàng yếu tố |
| 3 | Không lưu kết luận trần; tái lập được | ADR-017; khuôn J2 | Điểm và mức lưu kèm đầu vào, phiên bản phương pháp và `policy_id`; tính lại ra đúng |
| 4 | Đầu vào đóng băng tại mốc mở giá | spec S4 §2.4 ⑼, §2.5 ⑿ | Mọi yếu tố là hàm as-of của mốc mở giá gói đang xét. Không đọc chính sách, ánh xạ hay lịch sử hiện hành lúc ký |
| 5 | Độ phủ thấp không bao giờ đọc là *an toàn* | spec S4 §2.4 ⑼, L10, L11 | Dưới ngưỡng độ phủ → `KHONG_XAC_DINH`, xử như `CAO` |
| 6 | Bí mật giá lan sang phái sinh | A4, A5, A6, J4; spec S4 §2.5 ⒀ | Chỉ đọc gói đã mở niêm phong theo vị từ *"giá đã lộ"* của spec S4. Không đầu ra nào tới phiên khách hay màn nhà cung cấp |
| 7 | Bằng chứng không mang số tiền | ADR-054; spec S3 §2.5 ⒁ | Bằng chứng là tỷ lệ, thứ hạng, số đếm, định danh — không một số tiền nào. Nếu không, bảng yếu tố thành bảng giá dạng rõ thứ ba |
| 8 | Không ML, không runtime thứ hai | ADR-9202 | Thống kê tất định: trung vị, tứ phân vị, độ lệch tuyệt đối trung vị (MAD), số đếm. Lõi thuần TypeScript trên số nguyên hoặc `numeric` dạng chuỗi |
| 9 | Không phụ thuộc lịch chạy nền | ADR-005 | Không job định kỳ nào. Mọi phép tính chạy khi có người đọc hay khi có một sự kiện (đề xuất trao, ký) |
| 10 | Tách người theo HÀNH VI | ADR-051; spec S4 §2.4 ⑼ | Người ghi nhận yếu tố đỏ nằm ngoài {người tạo gói, người gây ra yếu tố, người đề xuất, người duyệt} |
| 11 | Effective Cost chỉ gồm tiền | J1; ADR-053 | Supplier Score và Risk Score KHÔNG vào `effective_cost` và KHÔNG đổi `rank`. Chúng hiện cạnh bảng xếp hạng |
| 12 | Phân tích người mua là dữ liệu về nhân viên | spec S4 §8.7; tiền đề E7 | S4b.5 không bắt đầu trước khi câu hỏi pháp lý có câu trả lời |

### 2.1. ADR-058 ⑸ nói về độ ỔN ĐỊNH của khoảng cách, không phải về một khoảng cách

Nguyên văn: *"Khoảng cách giữa giá thắng và giá nhì mạnh nhất — thông đồng để lại biên bọc lót ổn định bất thường, cạnh tranh
thật cho phân tán rộng."* Một khoảng cách 2% trên một gói không nói gì. Tín hiệu là khi khoảng cách ấy ĐỨNG YÊN qua nhiều gói
của cùng một nhóm nhà cung cấp, trong khi cạnh tranh thật cho khoảng cách dao động rộng. Nên yếu tố mạnh nhất của S4b (F1, §4)
là một thống kê trên CHUỖI gói, không phải một phép so trên một gói. Đó cũng là lý do nó không có nghĩa trước khi có lịch sử.

Thứ hai trong ADR-058 ⑸ là *"ma trận tỷ lệ thắng theo nhà cung cấp và theo chu kỳ"* — F2. Thứ ba, IP/thiết bị/metadata, nằm
ngoài S4.

### 2.2. Các quyết định của chủ dự án áp cho S4b

| Nguồn | Quyết định | Áp ở đây |
|---|---|---|
| Spec S4 §2.2 ⑴ | S4b = Supplier Score, Risk Score, phát hiện bất thường, Buyer Analytics; mở khi có sàn dữ liệu | §4–§8; cổng (e) |
| Spec S4 §2.4 ⑺ | Vai `DATA_STEWARD` mù giá | Không đọc được đầu ra nào của S4b (đều là dữ liệu sau mở thầu) |
| Spec S4 §2.4 ⑼ | S4b.1 tách khỏi cổng (e), sau S3.5; `KHONG_XAC_DINH` xử như `CAO`; ghi nhận bởi người ngoài bốn vai; đầu vào đóng băng | §5 |
| Spec S4 §2.4 ⑾ | Quần thể theo gói, loại `CANCELLED`; *"thấp bất thường"* chỉ dẫn tới yêu cầu làm rõ | F3; mọi quần thể lịch sử của §4 |
| 2026-09-26 (vòng này) | Viết spec chi tiết S4b bây giờ, không viết mã | Tài liệu này |

### 2.3. Sáu câu hỏi cho chủ dự án — trả lời ở lượt soi hình dạng

| # | Câu hỏi | Vì sao không tự chốt được |
|---|---|---|
| **Q1** | **Trọng số Supplier Score.** 40% trọng số mặc định của V2.1 §13 (Quality 20% + Delivery 20%) không có nguồn tới S5. Ba lối: ⒜ không có mặc định — tổ chức tự khai trên các thành phần có nguồn; ⒝ co giãn tỷ lệ bộ mặc định V2.1 trên các thành phần có nguồn; ⒞ hoãn Supplier Score tới S5 | Mọi lối đều là một bộ trọng số mà V2.1 không có. Spec S4 §4.9 đã từ chối tự chia lại |
| **Q2** | **Ai đọc phân tích người mua, và người bị phân tích có đọc được dòng của chính mình không.** `audit.read` do `FINANCE` và `DIRECTOR` giữ — cũng chính là người đề xuất và người duyệt, tức cũng là người bị phân tích | Lựa chọn về quản trị nhân sự, không phải kỹ thuật |
| **Q3** | **Bảo hành.** Thành phần *Warranty* của V2.1 §13 cần một ô khai `warrantyMonths` mà S4a không có. Thêm vào form nộp thầu (ma sát cho nhà cung cấp, PRODUCT §8 ⑴), hay để trống thành phần ấy | Lựa chọn giữa đủ thành phần và ma sát |
| **Q4** | **Nút *[REQUEST REVIEW]* của màn Executive (V2.1 §24).** Kho không có hành vi *"yêu cầu xem xét"*. Làm nó thành một hàng ghi nhận có người nhận, hay bỏ nút | Thêm một hành vi mới vào chuỗi trao thầu |
| **Q5** | **Số của cổng (e) — ADR (e).** Đề xuất GIẢ ĐỊNH của spec S4: ≥ 30 gói mở niêm phong, ≥ 60% giá trị dòng có ánh xạ hiệu lực (loại `NULL`), ≥ 6 tháng — theo TỪNG tổ chức | Con số chỉ hiệu chỉnh được trên dữ liệu thật; nhưng không có con số thì cổng không có trạng thái *đạt* |
| **Q6** | **Người đề xuất có thấy Risk Score trước khi đề xuất không.** Thấy thì họ tránh được nhà cung cấp rủi ro — và cũng *"mua sắm"* được một nhà cung cấp cho ra mức `THAP` | Đánh đổi giữa hỗ trợ quyết định và khả năng lách |

---

## 3. Kiến trúc

### 3.1. Thứ S4b tái dùng

| Đã có, hoặc sẽ có trước S4b | S4b dùng cho |
|---|---|
| `rfq_evaluation_lines.rank`, `effective_cost` (`057`) | F1 khoảng cách thắng–nhì (dạng tỷ lệ); thành phần giá của Supplier Score |
| `rfq_awards` (`061`): `bid_version_id`, `status`, `acted_by` | Người thắng theo gói; người đề xuất; chuỗi thắng cho F2 |
| `rfq_award_approvals` (`061`) | Người duyệt — cho tập loại trừ và cho phân tích người mua |
| `rfq_invitations.invited_by` (`013`) | Ma trận người mời × nhà cung cấp (F2a) |
| `vendor_bid_versions.submitted_at`, `version` (`018`) | F5 thời điểm nộp và số lần sửa |
| `unseal_requests` `EXECUTED`, vị từ *"giá đã lộ"* (spec S4 §2.5 ⒀) | Quần thể mọi yếu tố |
| `quan_sat_gia(p_moc)`, kết quả benchmark (spec S4 §4.5–§4.6) | F3 độ lệch benchmark; F7 dòng hỏng |
| Lời khai TCO lưu cùng award (spec S4 §2.4 ⑻) | Thành phần *Commercial Terms* |
| `rfq_item_mappings.dau_vao` (spec S4 §4.4) | F8 ánh xạ lệch thuộc tính |
| `governance_signals`, ngoại lệ, khai báo xung đột (spec S3 §4.4–§4.6) | F6 |
| View hiệu suất (spec S3 §4.9), `supplier_qualifications` (spec S3 §4.8) | *Responsiveness*, *Compliance* |
| `assertFreshMfa` (`packages/identity/src/mfa.ts:174`) | Vế MFA của S4b.1 |
| `throwAuditedDenial`, `CONTROL_DENIED` (ADR-060, ADR-084 ⑷) | Mọi từ chối của S4b |
| Bộ xuất ADR-059 | Lớp rủi ro trong bộ bằng chứng |

**S4b không thêm đường mật mã, không thêm trạng thái RFQ, không chạm đường mở thầu, và không đổi `effective_cost` hay
`rank`.** Bản cài đặt nào làm một trong bốn điều ấy là thiết kế đã trượt.

### 3.2. Thứ S4b thêm

- **`packages/tri-tue`** — lõi thuần: chín hàm yếu tố, hàm tổng hợp Risk Score, hàm Supplier Score, hàm phân tích người mua.
  Không I/O, không đồng hồ, không ngẫu nhiên; nhận đầu vào đã đọc as-of và phiên bản phương pháp. Ranh giới `depcruise`:
  không phụ thuộc `sealed-envelope`, `unseal`, `crypto-keys` (spec S4 §3.2), và không phụ thuộc `danh-gia` theo chiều
  ngược lại — `danh-gia` không được đọc điểm để xếp hạng (ràng buộc 11).
- **Tầng gói** — đọc as-of bằng các hàm SQL của S4a và S3, gọi lõi, ghi kết quả. Mỗi chốt là một hàm vị từ SQL mà tầng gói
  gọi trước mọi tác dụng phụ, khuôn spec S3 §2.5 ⒂.

### 3.3. Tính khi nào — không có job nền

| Đầu ra | Tính lúc | Lưu? |
|---|---|---|
| Đánh giá rủi ro của một đề xuất trao | Trong giao dịch ghi đề xuất trao (`PROPOSED`) | Có — bảng `rfq_risk_assessments` + yếu tố |
| Kiểm lại lúc ký | Trong giao dịch ghi chữ ký trao | Không — tính lại từ đầu vào as-of đã lưu, so với bản lưu |
| Supplier Score | Khi có người đọc; và chụp vào đánh giá rủi ro lúc đề xuất | Chỉ bản chụp lúc đề xuất |
| Sổ tín hiệu (§6) | Khi có người đọc | Chỉ các hàng đã được ghi nhận |
| Phân tích người mua (§8) | Khi có người đọc | Không; mỗi lần đọc một hàng sổ |

Ràng buộc 9: không yếu tố nào *"bắn"* vì đồng hồ trôi. Một mẫu xoay vòng hiện ra khi có người mở sổ tín hiệu hay khi có một
đề xuất trao chạm nó — không trước.

---

## 4. Danh mục yếu tố rủi ro

Chín yếu tố — tám mã, F2 tách hai —, xếp theo sức mạnh tín hiệu của ADR-058 ⑸ trước, rồi tới thứ S4a và S3 để lại. Mỗi yếu tố của một đề xuất trao
cho gói X, nhà cung cấp N, tính as-of mốc mở giá của X, trên quần thể gói đã mở niêm phong không `CANCELLED` (spec S4 §2.4 ⑾).

**Trạng thái** của một yếu tố: `CO_DU_LIEU` · `CHUA_DU_LICH_SU` (dưới sàn) · `KHONG_AP_DUNG` (điều kiện của yếu tố vắng mặt
trên gói — xem cột *vắng*). **Mức**: `XANH` · `VANG` · `DO`. Mọi ngưỡng và sàn dưới đây là **GIẢ ĐỊNH**.

| Mã | Tên trên màn | Nguồn | Phép tính | Sàn | Mức | Người gây ra | Vắng |
|---|---|---|---|---|---|---|---|
| **F1** | Khoảng cách thắng–nhì ổn định bất thường | `rfq_evaluation_lines` của mọi gói có CÙNG tập nhà cung cấp chen chân (≥ 2 nhà cung cấp chung) với X trong 12 tháng | Với mỗi gói: g = (EC hạng 2 − EC hạng 1) / EC hạng 1. Trên chuỗi g: hệ số phân tán = MAD / trung vị. So với hệ số phân tán của toàn tổ chức cùng nhóm hàng | ≥ 6 gói trong chuỗi; ≥ 20 gói toàn tổ chức | `DO` khi phân tán của chuỗi < P10 toàn tổ chức; `VANG` khi < P25 | Không người dùng nào (nhà cung cấp) | Gói chỉ một báo giá đọc được → `KHONG_AP_DUNG`, và F6 bắt ca ấy (một nhà cung cấp) |
| **F2a** | Tỷ lệ chọn lệch khỏi mặt bằng — người mời × nhà cung cấp | `rfq_invitations.invited_by`, `rfq_awards` | Với mỗi người mời của X: tỷ lệ N thắng trong các gói người ấy mời, so với tỷ lệ N thắng trong các gói người khác mời | ≥ 8 gói của người mời có N; ≥ 8 gói của người khác có N | `DO` khi tỷ lệ gấp ≥ 3 lần và chênh ≥ 30 điểm phần trăm; `VANG` khi gấp ≥ 2 | Người mời ấy | Không người mời nào đủ sàn → `CHUA_DU_LICH_SU` |
| **F2b** | Mẫu luân phiên thắng | `rfq_awards`, tập nhà cung cấp chen chân | Trên chuỗi gói có ≥ 3 nhà cung cấp chung với X: người thắng có luân phiên đều không — số lần mỗi nhà cung cấp thắng lệch khỏi đều ≤ 1, và không ai thắng hai gói liền nhau | ≥ 6 gói trong chuỗi | `DO` khi luân phiên đều trên ≥ 9 gói; `VANG` trên 6–8 gói | Không người dùng nào | Chuỗi < 6 → `CHUA_DU_LICH_SU` |
| **F3** | Giá thắng lệch khỏi dải nội bộ | Nhãn benchmark của S4a cho các dòng của báo giá N (spec S4 §4.6, L7) | Tỷ lệ giá trị dòng của N mang `LECH_CAO` trên tổng giá trị dòng đo được | Độ phủ benchmark của báo giá ≥ 50% giá trị | `DO` khi ≥ 30% giá trị dòng `LECH_CAO`; `VANG` khi ≥ 10% | Không người dùng nào | Độ phủ < 50% → `CHUA_DU_LICH_SU` |
| **F4** | Tập trung nhà cung cấp | `rfq_awards` theo hàng chuẩn hay nhóm hàng của các dòng của X | Tỷ phần số gói N thắng trên số gói của cùng nhóm hàng trong 12 tháng | ≥ 8 gói trong nhóm | `DO` khi ≥ 60%; `VANG` khi ≥ 40% | Không người dùng nào | Gói không có nhóm hàng → `KHONG_AP_DUNG` |
| **F5** | Nhịp nộp và sửa sát hạn | `vendor_bid_versions.submitted_at`, `version` — CHỈ của gói đã mở niêm phong | Trên X: số nhà cung cấp nộp phiên bản cuối trong 10 phút trước hạn, và số cặp nhà cung cấp có phiên bản nộp cách nhau < 60 giây | Không cần lịch sử | `DO` khi ≥ 2 cặp < 60 giây; `VANG` khi ≥ 1 cặp, hay khi N sửa ≥ 3 lần trong 10 phút cuối | Không người dùng nào | — |
| **F6** | Tín hiệu kiểm soát đã có | `governance_signals`, ngoại lệ, khai báo xung đột (S3) | Hàng có sẵn: `PURCHASE_SPLITTING`, `ESTIMATE_UNDERSTATED`, `INVITE_LIST_NARROWED`, `EARLY_CLOSE`; ngoại lệ `SINGLE_SOURCE`, `LIMITED_COMPETITION`, `LOW_ACTUAL_COMPETITION` | Không | `DO` khi có `ESTIMATE_UNDERSTATED` hay `INVITE_LIST_NARROWED`; `VANG` với các loại còn lại | Người gây ra đã ghi trên chính tín hiệu S3 | Tổ chức chưa bật S3 → `KHONG_AP_DUNG` |
| **F7** | Báo giá không đo được theo dòng | `bid_dong_tho` (spec S4 §2.5 ⒁) | Báo giá của N có tổng đọc được mà dòng hỏng (Σ `amount` ≠ `totalAmount`, hay dòng không đọc được) | Không | `DO` — trình duyệt của sản phẩm không sinh ra ca ấy | Không người dùng nào | — |
| **F8** | Ánh xạ lệch thuộc tính trích được | `rfq_item_mappings.dau_vao` của các dòng của X | Tỷ lệ dòng mà một thuộc tính trọng yếu trích được từ mô tả KHÁC thuộc tính của hàng chuẩn đã ánh xạ | Không | `DO` khi có ≥ 1 dòng như thế ghi bởi `NGUOI_DUYET`; `VANG` khi chỉ ở `TU_DONG` | Người ghi ánh xạ | Dòng chưa ánh xạ → không tính |

**Ba luật chung.**
- **Bằng chứng** (`jsonb`) mang tỷ lệ, phân vị, số đếm, và định danh các gói và phiên bản báo giá đã dùng — KHÔNG một số tiền
  nào (ràng buộc 7). *"g = 2,1%, phân tán 0,08, P10 toàn tổ chức 0,21, 9 gói"* là một bằng chứng; *"hạng 1: 1,20 tỷ"* thì
  không.
- **Độ tin cậy** không phải một xác suất. Nó là một trong ba giá trị `THAP` · `VUA` · `CAO`, suy từ độ dài chuỗi so với sàn
  (dưới 2× sàn → `THAP`). Một con số phần trăm ở đây sẽ đọc như xác suất gian lận.
- **Giải thích** là một câu mẫu có tham số, cố định theo phiên bản phương pháp, không phải văn bản sinh ra. Mẫu cho F1:
  *"Qua {n} gói có cùng {k} nhà cung cấp, khoảng cách giữa giá thắng và giá nhì dao động hẹp hơn {p}% các nhóm gói khác của
  tổ chức. Cạnh tranh thật thường cho khoảng cách dao động rộng. Đây là chỉ báo cần xem xét, không phải kết luận."*

**Vì sao F1, F2b không gắn người dùng nào.** Hai mẫu ấy nói về một NHÓM nhà cung cấp; chúng không chỉ ra người mua nào cả.
Chỉ F2a gắn với một người mời, và F8 với một người ánh xạ. Sự bất đối xứng ấy có chủ ý: yếu tố gắn tên một nhân viên là yếu
tố gây hại nhất khi sai (§12.1).

---

## 5. Risk Score và S4b.1 — không duyệt một chạm

### 5.1. Tổng hợp

Trọng số là khoá `rui_ro` (`jsonb`) trên phiên bản chính sách, ghim lúc gói vào `OPEN` (spec S4 §2.4 ⑸). Mặc định GIẢ
ĐỊNH, theo thứ tự sức mạnh tín hiệu:

| F1 | F2a | F2b | F3 | F4 | F5 | F6 | F7 | F8 |
|---|---|---|---|---|---|---|---|---|
| 20 | 10 | 15 | 15 | 5 | 10 | 10 | 5 | 10 |

- Điểm yếu tố: `XANH` 0 · `VANG` 50 · `DO` 100.
- **Độ phủ** = Σ trọng số của yếu tố `CO_DU_LIEU` / Σ trọng số của yếu tố không `KHONG_AP_DUNG`. Yếu tố `KHONG_AP_DUNG` ra
  khỏi cả tử lẫn mẫu, vì điều kiện của nó vắng trên gói và một yếu tố khác bắt đúng ca ấy (cột *vắng* ở §4).
- **Điểm** = làm tròn nửa-ra-xa-0 của Σ (trọng số × điểm yếu tố) / Σ trọng số, trên các yếu tố `CO_DU_LIEU`. Số nguyên
  0–100, tính trên `bigint` (khuôn ADR-052).
- **Mức**: độ phủ < 60% → `KHONG_XAC_DINH`. Ngược lại: điểm ≥ 60 → `CAO`; ≥ 30 → `VUA`; còn lại `THAP`. **Và một yếu tố `DO`
  bất kỳ đẩy mức lên tối thiểu `VUA`** — một yếu tố đỏ không được trung bình hoá cho mất.

Chữ trên màn luôn đi cùng độ phủ: *"42/100 · VỪA · trên 70% trọng số có dữ liệu · chỉ báo cần xem xét"*. Một điểm không có độ
phủ đi kèm là một lỗi hiển thị, và vòng quét route (§11) bắt nó.

### 5.2. Chốt S4b.1

Chữ ký duyệt trao thầu cho một gói mà đánh giá rủi ro của đề xuất ở mức `CAO` hay `KHONG_XAC_DINH` cần đủ bốn thứ:
1. MFA trong cửa sổ 15 phút, qua `assertFreshMfa`;
2. giải trình không rỗng của người ký;
3. một hàng ghi nhận cho MỖI yếu tố `DO`, và cho hàng *độ phủ* khi mức là `KHONG_XAC_DINH`, do một người giữ `po.approve`
   nằm ngoài {người tạo gói, người gây ra yếu tố ấy, người đề xuất, người duyệt};
4. đánh giá rủi ro là bản MỚI NHẤT của đề xuất ấy, và tính lại từ đầu vào as-of đã lưu ra đúng điểm và mức.

**Chỗ ở của từng vế.** Vế ① ở tầng gói, cùng chỗ với D1 của mở thầu: `app_api` được cấp `UPDATE (mfa_verified_at)` (`006`),
nên một kiểm ở trigger chỉ mạnh ngang ứng dụng. Vế ②③ ở một trigger RIÊNG trên bảng chữ ký trao — khuôn `014` §(4), dựng
trên cổng trao thầu của S3.5, không viết lại thân ghim. Vế ④ ở tầng gói: lõi tính điểm là TypeScript (ràng buộc 8), nên CSDL
không tính lại được. Giới hạn ấy nói ra, cùng lớp với J2: một ứng dụng hỏng ghi được mức `THAP`, và thứ bắt nó là phép tái
lập trên bộ bằng chứng, không phải một trigger.

**Hệ quả về người**, cộng vào spec S4 §7.1: một gói ở mức `CAO` hay `KHONG_XAC_DINH` cần ít nhất HAI người giữ `po.approve`
ngoài người đề xuất — một người duyệt, một người ghi nhận. Ở tổ chức mới, đó là MỌI gói. `gieo:demo` có hai `DIRECTOR`, đủ.

### 5.3. Bản chụp

Đánh giá rủi ro lưu cùng đề xuất trao: điểm, mức, độ phủ, phiên bản phương pháp, `policy_id`, mốc mở giá, và một hàng cho mỗi
yếu tố với đủ năm trường. Supplier Score của N chụp vào cùng bản ghi. Bộ bằng chứng (ADR-059) mang cả hai, cộng một đặc tả
phép tính trong `DAC-TA.md` đủ để cài lại chín yếu tố và phép tổng hợp — khuôn S2.7.

---

## 6. Sổ tín hiệu — phần *"phát hiện bất thường"*

V2.1 §20 kể sáu loại bất thường. S4b phủ bốn, qua yếu tố của §4, và nói thẳng hai loại còn lại:

| Loại của V2.1 §20 | S4b phủ bằng | Ghi chú |
|---|---|---|
| Price anomaly | F3, cộng nhãn benchmark của S4a | — |
| Supplier anomaly — thắng bất thường | F2b, F4 | — |
| Buyer anomaly | F2a, cộng §8 | Chờ câu hỏi pháp lý |
| Purchase splitting | F6 (tín hiệu S3) | S4b không tính lại |
| Specification anomaly | **Không** | Kho không lưu lịch sử sửa hạng mục ở `DRAFT` (spec S4 §10) |
| Collusion pattern | F1, F2b, F5 | Mẫu giữa các nhà cung cấp; mẫu Buyer–Supplier Network là §18, ngoài S4 |

**Sổ tín hiệu** là một màn đọc, không phải một job: người giữ `audit.read` chọn một khoảng thời gian, và hàm as-of tính các
yếu tố F1, F2a, F2b, F4 trên MỌI chuỗi gói của tổ chức trong khoảng ấy — không chỉ trên gói có đề xuất trao. Kết quả là một
danh sách *"chuỗi gói cần xem xét"*, mỗi dòng mang năm trường. Không dòng nào được lưu cho tới khi một người ghi nhận nó —
lúc ấy một hàng `risk_register_acks` ghi người, lý do và bằng chứng as-of tại lúc ghi nhận.

Lý do không lưu trước: một bảng *"các nhà cung cấp bị gắn cờ"* được lưu tự động là đúng hình dạng danh sách đen mà PRODUCT
§5 cấm — một danh sách không ai kiểm mà mọi người đọc như kết luận.

---

## 7. Supplier Score

**Thành phần có nguồn trong S4** — tám thành phần của V2.1 §13 chia theo nguồn:

| Thành phần | Nguồn | Phép tính 0–100 (GIẢ ĐỊNH) |
|---|---|---|
| Price Competitiveness | `rfq_evaluation_lines.rank` trên các gói N chen chân | Trung vị của (n − hạng) / (n − 1) × 100 trên các gói có ≥ 2 báo giá đọc được |
| Commercial Terms | Lời khai TCO (spec S4 §4.8) | Trung vị của điểm kỳ thanh toán và điểm thời gian giao so với yêu cầu của từng gói |
| Compliance | `supplier_qualifications` (S3.7) | Thẩm định đầy đủ còn hiệu lực 100 · chỉ xác minh 50 · không có hay bị thu hồi trong 12 tháng 0 |
| Responsiveness | View hiệu suất (S3.8) | Tỷ lệ nộp / được mời × 100 |
| Risk | Yếu tố F1, F2b, F5, F7 mà N có mặt | 100 − tỷ lệ gói N chen chân có một trong bốn yếu tố ở mức `DO` × 100 |
| Warranty | **Chưa có nguồn** — Q3 | — |
| Quality · Delivery | **Không có nguồn tới S5** | — |

- **Trọng số** là khoá `diem_ncc` trên phiên bản chính sách. Phiên bản khai trọng số cho một thành phần không có nguồn bị từ
  chối lúc chấm, bằng một mã gọi tên — cùng chỗ spec S4 §2.5 ⒃ đặt chốt TCO. Bộ mặc định: **Q1**.
- **Sàn**: N chen chân ≥ 5 gói đã mở niêm phong trong 12 tháng. Dưới sàn: *"chưa đủ lịch sử"*, không số.
- **Supplier Score không vào `effective_cost` và không đổi `rank`** (ràng buộc 11). Nó hiện cạnh bảng xếp hạng, ở màn nhà cung
  cấp của bên mua, và trong bản chụp lúc đề xuất trao.
- **Không bao giờ tới nhà cung cấp** (A5): không route khách nào trả nó, kể cả điểm của chính nhà cung cấp ấy — một nhà cung cấp
  thấy điểm mình sẽ suy ra được thứ hạng của mình so với người khác.

---

## 8. Phân tích người mua

Chờ câu hỏi pháp lý (tiền đề E7) và Q2. Thiết kế ở đây để câu hỏi ấy có một vật cụ thể mà trả lời.

**Bốn ma trận**, mỗi ô là một tỷ lệ và một số đếm, trên gói đã mở niêm phong không `CANCELLED`, trong một khoảng thời gian:

| Ma trận | Hàng | Cột | Ô |
|---|---|---|---|
| Mời | người mời | nhà cung cấp | tỷ lệ gói người ấy mời có nhà cung cấp ấy |
| Thắng | người mời | nhà cung cấp | tỷ lệ nhà cung cấp ấy thắng trong gói người ấy mời |
| Đề xuất | người đề xuất trao | nhà cung cấp | tỷ lệ đề xuất trao cho nhà cung cấp ấy |
| Duyệt | người duyệt trao | nhà cung cấp | tỷ lệ chữ ký trao cho nhà cung cấp ấy |

Thêm một bảng thứ năm, *người đặt thước × gói*: ai là tác giả phiên bản chính sách, hàng chuẩn và ánh xạ mà mỗi gói đã dùng.
Nó trả lời câu hỏi mà bốn ma trận kia không chạm: người đặt thước có trùng lặp một cách hệ thống với người thắng không.

**Chữ trên màn** là *"tỷ lệ lệch khỏi mặt bằng tổ chức"* (spec S4 §2.5 ㉔), không *"bất thường"*. Mỗi ô lệch hiện cùng mặt
bằng tổ chức và số đếm. Ô dưới sàn — dưới 8 gói — không có số.

**Mỗi lần đọc một hàng sổ** `BUYER_ANALYTICS_READ`, mang khoảng thời gian và người đọc. Đó là cái giá ADR-060 đã đo — mỗi hàng
làm mọi lượt `verifyAuditChain` về sau chậm hơn —, và nó được trả có ý thức: dữ liệu về nhân viên mà đọc không để dấu thì
chính nó thành công cụ giám sát không ai giám sát. Khác với bảng so sánh (khoản 9402), ở đây lời khai *"mọi lần đọc có sổ"* là
một bất biến có phép đo (L19).

---

## 9. Màn hình

### 9.1. Màn Executive (V2.1 §24)

| Trường của V2.1 §24 | Nguồn | Khi không có nguồn |
|---|---|---|
| RFQ, Value | `rfq_packages`, ước lượng hay số tiền trao | — |
| Suppliers | Số lời mời còn sống | — |
| Technical qualified | Không có nguồn: S2 chấm điểm phi giá (`DIEM`) nhưng không có ngưỡng đạt | *"chưa có nguồn"* |
| Lowest Effective Cost | `rfq_evaluation_lines` hạng 1 | — |
| Recommended Supplier | Đề xuất trao đang sống | *"chưa có đề xuất"* |
| Risk Score | §5, kèm độ phủ | `KHONG_XAC_DINH` |
| Policy Compliance | Tổ chức đã bật S3: mọi chốt K của gói đã qua | Chưa bật S3: *"không áp dụng"* |
| Price Benchmark | Nhãn tổng hợp của S4a cho báo giá được đề xuất | *"chưa đủ lịch sử"* |
| [VIEW ANALYSIS] | Mở `/mo-thau` ở bước so sánh | — |
| [UNSEAL] | Đường mở thầu hiện có | — |
| [REQUEST REVIEW] | **Q4** | — |

Màn là một trang mới trong bản đồ `TRANG`, dưới luật ADR-044, cho người giữ `bid.view`. Nó chỉ ĐỌC: không hành vi nào của nó
là mới, trừ nút của Q4.

### 9.2. Các màn khác

| Màn | Hạng mục | Vai |
|---|---|---|
| `/mo-thau` bước đề xuất và duyệt trao: đánh giá rủi ro, yếu tố, ô ghi nhận, giải trình | S4b.1, S4b.2 | `award.recommend`, `po.approve` |
| `/so-tin-hieu` (mới): sổ tín hiệu | S4b.3 | `audit.read` |
| Hồ sơ nhà cung cấp phía bên mua: Supplier Score | S4b.4 | `bid.view` |
| `/phan-tich` (mới): phân tích người mua | S4b.5 | Q2 |

Mỗi route mới khai `agent: false` (ADR-039): không đầu ra nào của S4b đi qua MCP.

---

## 10. Mô hình dữ liệu

Mọi bảng theo tổ chức, chỉ-ghi-thêm, khuôn khoá tư vấn → `seq` → `ghi_luc` của spec S4 §2.5 ⑿, policy khách `RESTRICTIVE`.

| Bảng | Giữ gì |
|---|---|
| `rfq_risk_assessments` | Một hàng cho mỗi lần tính trên một đề xuất trao: `award_id`, `bid_version_id`, `policy_id`, `phien_ban_phuong_phap`, `moc_mo_gia`, `diem`, `muc`, `do_phu`, bản chụp Supplier Score, tác giả + phiên |
| `rfq_risk_factors` | Một hàng mỗi yếu tố: `ma`, `trang_thai`, `muc`, `trong_so`, `nguon`, `thoi_diem`, `bang_chung jsonb`, `do_tin_cay`, `giai_thich`, `nguoi_gay_ra uuid[]`. `CHECK`: `bang_chung` không mang khoá nào trong tập tên trường tiền đã khai (`tien`, `gia`, `so_tien`, `amount`, `unitPrice`, `totalAmount`) |
| `rfq_risk_factor_inputs` | Bảng con khoá ngoại tới mọi gói và phiên bản báo giá mà yếu tố đã đọc — để tái lập (khuôn spec S4 §2.5 ⑿) |
| `rfq_risk_acks` | Ghi nhận: `factor_id`, người + phiên, lý do không rỗng |
| `rfq_award_justifications` | Giải trình của người ký ở mức `CAO`/`KHONG_XAC_DINH`; tách khỏi `rfq_award_approvals` để không đổi hình dạng bảng của `061`, thứ S3.5 đang dựng lại |
| `risk_register_acks` | Ghi nhận một dòng của sổ tín hiệu: loại, bằng chứng as-of, người, lý do |

Nhóm khoá mới trên phiên bản chính sách: `rui_ro` (trọng số, ngưỡng mức, ngưỡng độ phủ), `diem_ncc` (trọng số thành phần,
sàn). Cả hai đi dưới luật thứ tự của spec S4 §2.5 ⒆: sau S3.1, đọc qua `chinh_sach_tai`.

**Quyền.** Không mã quyền mới — nguyên tắc ADR-084 ⑴. Đọc đánh giá rủi ro, Supplier Score, màn Executive: `bid.view`. Ghi
nhận yếu tố: `po.approve`. Sổ tín hiệu: `audit.read`. Phân tích người mua: Q2.

---

## 11. Bất biến — tiếp nhóm L

Nối tiếp L1–L15 của spec S4. L9, L10, L11 của spec S4 được viết chi tiết ở đây; mệnh đề chịu lực là bản ở đây.

| Mã | Mệnh đề | Cưỡng chế | Hạng mục |
|---|---|---|---|
| **L9** | Supplier Score tính lại được từ bản chụp đầu vào + trọng số của phiên bản ghim; phiên bản khai trọng số cho thành phần không có nguồn bị từ chối; dưới sàn không có số | Lõi thuần + test tái lập; kiểm lúc tính ở tầng gói | S4b.4 |
| **L10** | Mỗi hàng yếu tố mang năm trường; điểm, mức, độ phủ tính lại được từ `rfq_risk_factor_inputs` + phiên bản ra đúng bản lưu; `KHONG_XAC_DINH` khi độ phủ dưới ngưỡng; một `DO` bất kỳ cho mức tối thiểu `VUA` | Lõi thuần; `CHECK` trên bảng yếu tố; test tái lập khuôn J2 | S4b.2 |
| **L11** | Chữ ký trao ở mức `CAO`/`KHONG_XAC_DINH` cần MFA mới, giải trình, và ghi nhận từng yếu tố `DO` (và hàng độ phủ) bởi người giữ `po.approve` ngoài bốn vai; đánh giá là bản mới nhất của đề xuất | Vế MFA ở tầng gói; vế giải trình và ghi nhận ở trigger RIÊNG; vế tái lập ở tầng gói | S4b.1 |
| **L16** | Không hàng yếu tố, không bằng chứng, không bản chụp nào của S4b mang một số tiền | `CHECK` tập khoá; bước 14 kịch bản 41 quét các bảng S4b bằng kim đơn giá và kim tổng | S4b.2 |
| **L17** | Mọi yếu tố là hàm as-of: tính lại một đánh giá sau khi có thêm gói, ánh xạ hay phiên bản chính sách mới ra đúng bản lưu | Test: ghi dữ liệu mới sau mốc rồi tính lại | S4b.2 |
| **L18** | Không route nào trả đầu ra của S4b cho phiên khách, phiên Passport, hay người không giữ cổng đọc của đầu ra ấy; không đầu ra nào hiện mà thiếu độ phủ | Vòng quét route khuôn A2/J4, có đối chứng dương | S4b.2 |
| **L19** | Mỗi lần đọc phân tích người mua để lại đúng một hàng sổ `BUYER_ANALYTICS_READ` | Test đếm hàng sổ; đột biến gỡ lần ghi | S4b.5 |
| **L20** | Không bảng nào lưu tự động một danh sách nhà cung cấp hay nhân viên bị gắn cờ: sổ tín hiệu chỉ lưu hàng đã có người ghi nhận | Test kiến trúc: không `INSERT` nào vào bảng S4b ngoài đường đề xuất trao và đường ghi nhận | S4b.3 |
| **L21** | Điểm và mức của S4b không đổi `effective_cost` và `rank` | Ranh giới `depcruise` `danh-gia` ↛ `tri-tue`; test J2 xanh nguyên văn với S4b bật | S4b.2 |

Mỗi hàng vào sổ của TEST-PLAN ở đúng hạng mục đo được nó, SAU khi đo — khuôn spec S3 §5.1 và spec S4 §5.1. Hàng tách mang số
mới, không hậu tố (khoản 9403).

---

## 12. Rủi ro

### 12.1. Báo động giả gắn tên người — rủi ro chi phối

Mọi yếu tố thống kê báo sai trên dữ liệu mỏng. Báo sai về một NHÓM nhà cung cấp (F1, F2b) tốn một lượt xem xét. Báo sai về một
NHÂN VIÊN (F2a, §8) tốn danh dự của một người có tên, và không lượt xem xét nào lấy lại được. Giảm bằng: F2a có sàn cao nhất
và cần hai điều kiện cùng lúc (gấp ≥ 3 lần VÀ chênh ≥ 30 điểm); chữ trên màn không bao giờ là *bất thường*; §8 chờ câu hỏi
pháp lý; mỗi lần đọc có sổ (L19).

### 12.2. Tổ chức nhỏ không bao giờ vượt sàn

Sàn của F1, F2a, F2b tính trên CHUỖI gói. Một tổ chức mua ít, hay mua mỗi thứ một lần, không bao giờ có chuỗi đủ dài. Với nó,
S4b mãi là `KHONG_XAC_DINH`, và S4b.1 mãi đòi ghi nhận. Đó là hệ quả trực tiếp của spec S4 §2.4 ⑼, và nó biến chốt thành thủ
tục — hình dạng spec S3 §8.2. Tỷ lệ ghi nhận theo tổ chức hiện ở màn quản trị; không ngưỡng nào ở đây được gọi là *đã hiệu
chỉnh* trước dữ liệu thật.

### 12.3. Lách bằng cách giữ yếu tố dưới sàn

Góc C⑥ của lượt soi S1.9102 đã đo đường này: rải gói qua nhiều người mời để mỗi cặp dưới sàn. F2a vì vậy không đứng một mình:
F1, F2b, F4 tính trên nhóm nhà cung cấp và nhóm hàng, không theo người mời, nên rải người mời không làm chúng mù. Và dưới sàn
là `KHONG_XAC_DINH`, không phải `THAP`.

### 12.4. Goodhart

Khi người đề xuất thấy Risk Score (Q6), điểm thành một mục tiêu: chọn nhà cung cấp cho ra `THAP`, hay tách gói để chuỗi ngắn
lại. Phần sau đã có F6 (chia nhỏ). Phần trước là câu hỏi Q6.

### 12.5. Hiệu năng

F1, F2b và sổ tín hiệu đọc chuỗi gói của cả tổ chức. Không job nền (ràng buộc 9) nghĩa là mọi phép tính chạy trong một request.
Ngưỡng GIẢ ĐỊNH: một đánh giá rủi ro < 2 giây ở 5.000 gói; sổ tín hiệu < 10 giây cho 12 tháng. Đo ở S4b.2 trên dữ liệu gieo,
có biên bản. Vượt ngưỡng thì lối thoát là một bảng tổng hợp chỉ-ghi-thêm theo gói — không mang tiền, nên không chạm ADR-054.

---

## 13. Kiểm thử

- **T1** — bảng ca cho mỗi yếu tố: đúng sàn, dưới sàn một gói, `KHONG_AP_DUNG`, biên của từng ngưỡng mức. F1 có một bộ dữ liệu
  tổng hợp *"ba nhà cung cấp luân phiên với biên 2% ± 0,1%"* phải ra `DO`, và một bộ *"cạnh tranh thật"* với biên phân tán rộng
  phải ra `XANH`. Bảng ca cho phép tổng hợp: một `DO` duy nhất với điểm 10 phải ra `VUA`.
- **T2** — vòng quét route cho L18 dưới phiên khách, phiên `BUYER` (không `bid.view`), phiên `DATA_STEWARD`; đối chứng dương:
  người giữ `bid.view` THẤY đánh giá ngay sau đề xuất trao.
- **T3** — trigger L11 trên Postgres thật: ký mà thiếu ghi nhận; ghi nhận bởi người đề xuất; ghi nhận bởi người gây ra F2a;
  đánh giá không phải bản mới nhất. Đột biến tắt trigger lúc chạy (khuôn `db/hardening-suy-tu-tinh-chat.int.test.ts`).
- **L16** đo bằng một bằng chứng có khoá `amount`: `CHECK` chặn. Và bước 14 của kịch bản 41 chạy sau một đề xuất trao thật.
- **L17** đo bằng thêm một gói mới cùng nhóm nhà cung cấp sau mốc của X, rồi tính lại đánh giá của X: không đổi.
- **T5** — bốn mũi: ⑴ rải gói qua nhiều người mời (§12.3); ⑵ tách gói để chuỗi ngắn; ⑶ người duyệt tự ghi nhận; ⑷ ứng dụng
  ghi mức `THAP` cho một đánh giá thật ra `CAO` — mũi này KHÔNG bị trigger chặn, và đo rằng phép tái lập trên bộ bằng chứng bắt
  được nó.
- T4 vẫn chưa dựng: màn hình nghiệm thu bằng lượt đi thử có biên bản (khuôn S1.97).

---

## 14. Điều kiện hoàn thành

**S4b.1 — chạy được TRƯỚC cổng (e):**

> Ở một tổ chức mới dựng — 0 gói lịch sử —, một gói đi trọn kịch bản MVP1 tới đề xuất trao. Đánh giá rủi ro của đề xuất ở mức
> `KHONG_XAC_DINH` với độ phủ 15%. Người duyệt D1 không ký được bằng một chạm: hệ thống đòi MFA mới, giải trình, và một ghi
> nhận hàng độ phủ bởi một người khác. D2 ghi nhận; D1 ký. Bộ bằng chứng mang đánh giá, và tính lại ra đúng mức ấy khi đã ngắt
> CSDL.

**S4b trọn — khi cổng (e) đạt, trên dữ liệu của tổ chức đã vượt sàn:** kịch bản V2.1 §41 ở spec S4 §7.2, cộng:

> Sổ tín hiệu của 12 tháng hiện một chuỗi 9 gói mà ba nhà cung cấp luân phiên thắng với khoảng cách thắng–nhì ổn định. Người
> kiểm toán ghi nhận nó kèm lý do, và dòng ấy vào sổ. Không màn nào hiện chữ *gian lận*, và không bảng nào lưu chuỗi ấy trước
> khi người kiểm toán ghi nhận.

---

## 15. Phân rã công việc

| # | Hạng mục | Ra cái gì | Chờ |
|---|---|---|---|
| **S4b.0** | Cổng dữ liệu | ADR (e) với con số của Q5; công cụ đo chỉ xuất số đếm theo tổ chức, chạy với đồng ý của khách; biên bản đo | Q5; pilot |
| **S4b.1** | Không duyệt một chạm | Chỉ các yếu tố có nguồn lúc ấy (F3, F6, F7, độ phủ); `rfq_risk_assessments` tối thiểu; trigger L11; `rfq_award_justifications`, `rfq_risk_acks` | S3.5, S4.5 — KHÔNG chờ cổng (e) |
| **S4b.2** | Risk Score đủ chín yếu tố | F1, F2a, F2b, F4, F5, F8; tổng hợp; bảng đầu vào; **L10, L16, L17, L18, L21**; đo hiệu năng | Cổng (e); S3.6 |
| **S4b.3** | Sổ tín hiệu | `/so-tin-hieu`; `risk_register_acks`; **L20** | S4b.2 |
| **S4b.4** | Supplier Score | Năm thành phần có nguồn; **L9**; hồ sơ nhà cung cấp phía bên mua | Q1, Q3; S3.7, S3.8 |
| **S4b.5** | Phân tích người mua | Bốn ma trận và bảng người đặt thước; **L19**; `/phan-tich` | Câu hỏi pháp lý E7; Q2 |
| **S4b.6** | Màn Executive | Trang đọc; nút Q4 | S4b.2; Q4 |
| **S4b.7** | Bằng chứng | Lớp rủi ro trong bộ xuất ADR-059 và `DAC-TA.md` | S4b.2 |

Mỗi hạng mục đi đúng vòng lặp của spec S0+S1 §9: đo trước khi viết, một bất biến một phép đo, đột biến, rồi tài liệu. Mọi
hàm và trigger mới ghim ở `hardening.always.sql` trong cùng commit với migration.

---

## 16. Ngoài phạm vi tài liệu này

- **Tín hiệu danh tính và kỹ thuật** (V2.1 §17) và **đồ thị quan hệ** (§18) — spec S4 §10 đã ghi thứ rẻ nhất khi tới lượt:
  trùng tài khoản ngân hàng hay địa chỉ giữa các nhà cung cấp cùng được mời vào một gói.
- **Specification anomaly** (V2.1 §20) — cần một sổ sửa hạng mục trước.
- **Quality, Delivery, Claim rate, Contract compliance** (V2.1 §13) — S5.
- **Học máy, mô hình dự báo** — ADR-9202.
- **Chia sẻ điểm hay sổ tín hiệu xuyên tổ chức** — ADR-013; một nhà cung cấp bị gắn cờ ở tổ chức A không được theo sang tổ chức B.
- **Dùng điểm để tự động loại hay tự động trao** — V2.1 §20: *"AI chỉ đưa ra Risk / Recommendation; con người đưa ra
  Investigation / Decision"*. Không đầu ra nào của S4b chặn một cạnh, trừ vế ghi nhận của S4b.1 — và vế ấy chặn việc KHÔNG AI
  ĐỌC tín hiệu, không chặn việc trao.
