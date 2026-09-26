# TrustProcure V2 — Thiết kế S4b: Trí tuệ mua sắm (Intelligence · MVP3, nửa sau)

> **Ngày:** 2026-09-26 · **Trạng thái:** ~~**BẢN NHÁP — chưa qua lượt soi hình dạng.**~~ **[S1.157] ĐÃ QUA LƯỢT SOI HÌNH
> DẠNG — 33 phát hiện, 8 CAO; sáu lời khai đo trên Postgres 16 thật, hai con số tính bằng đếm vét cạn và mô phỏng**
> (`evidence/security-reviews.md` §S1.157). Viết TRƯỚC cổng dữ liệu (e), theo lựa
> chọn của chủ dự án ngày 2026-09-26: thiết kế đầy đủ bây giờ, không viết mã; mọi con số mang nhãn GIẢ ĐỊNH; cổng (e) vẫn
> chặn mã của S4b.2 trở đi. ~~Sáu câu hỏi cho chủ dự án ở §2.3.~~ **[S1.157]** Bốn quyết định của chủ dự án sau lượt soi ở
> §2.4 (ADR-096), hai mươi mốt chốt từ tiền lệ ở §2.5 (ADR-097), ~~bảy câu còn chờ chủ dự án ở §2.6 — không câu nào chặn một
> vòng đang chạy.~~ **[S1.158]** bảy câu của §2.6 chủ dự án chốt cả bảy theo đề xuất (ADR-098), hệ quả ở §2.7 — trong đó
> **Supplier Score hoãn tới S5** và **cổng (e) có con số**. Chưa một dòng mã nào của S4b.
> **[S1.157] Đọc §2.4–§2.6, §4.1, §10.1, §11.1, §14.1 và §15.1 cùng phần gốc** — **[S1.158]** và §2.7,: phần gốc giữ nguyên văn, chỗ sai gạch tại
> chỗ, mệnh đề chịu lực là bản đã sửa.
> **Là nửa sau của:** `docs/superpowers/specs/2026-09-26-trustprocure-s4-nen-du-lieu-tri-tue.md` (spec S4, đã qua lượt soi
> S1.155). Tài liệu này thay §4.9 của spec ấy ở mức chi tiết; §4.9 chỉ giữ HÌNH DẠNG. Mọi quyết định của spec S4 — §2.2
> ⑴–⑷, §2.4 ⑸–⑾, §2.5 ⑿–㉕, ADR-091…095 — áp nguyên ở đây.
> **Nguồn:** V2.1 §13 *Supplier Intelligence*, §17 *Risk Engine*, §19 *Risk Score mẫu*, §20 *AI / Analytics*, §22 *Award
> Recommendation*, §24 *Executive Experience*, §36 *KPI*, §41 *Kịch bản Demo*. Bản nguồn không nằm trong kho; bản đọc là bản
> trên Drive của chủ dự án, cùng bản spec S4 đã đối chiếu.
> ~~**Đóng khi có mã:**~~ **[S1.157] Có mặt khi có mã, trong giới hạn §12.6:** bốn mục spec S4 ghi *"nhận về, chưa đóng"* — Risk Score, phát hiện bất thường, phân tích người mua,
> phát hiện xoay vòng bằng thống kê (ADR-058 ⑸) — cộng S4b.1 (cấm duyệt một chạm, V2.1 §24) và màn *Executive* (V2.1 §24).
> Chữ *đóng* hứa quá: S4b chỉ bắt mẫu ĐỀU ĐẶN; một nhóm chủ ý ngẫu nhiên hoá biên và thứ tự thắng không để lại tín hiệu nào
> S4b đo (góc C⑦, khuôn góc D⑤ của lượt soi S1.155).
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
   **[S1.157]** *"Từ gói đầu tiên"* của tổ chức ĐÃ BẬT S3 — S4b.1 đi theo công tắc ADR-080 (§2.4 ㉙). Và *"có nghĩa"* đòi
   S4b.1 mang theo chính lớp tái lập và bảng đầu vào mà bản nháp để ở S4b.2 và S4b.7 (§15.1).

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
| 4 | Đầu vào đóng băng tại mốc mở giá | spec S4 §2.4 ⑼, §2.5 ⑿ | ~~Mọi yếu tố là hàm as-of của mốc mở giá gói đang xét.~~ **[S1.157]** THƯỚC — chính sách, dữ liệu nền, lịch sử các gói khác — là hàm as-of của mốc mở giá gói đang xét. SỰ KIỆN VỀ CHÍNH GÓI ẤY — báo giá được đề xuất (kể cả vòng BAFO), tín hiệu S3, ánh xạ dòng của nó — đọc as-of lúc đề xuất (§2.5 ㊲). Không đọc chính sách, ánh xạ hay lịch sử hiện hành lúc ký |
| 5 | Độ phủ thấp không bao giờ đọc là *an toàn* | spec S4 §2.4 ⑼, L10, L11 | Dưới ngưỡng độ phủ → `KHONG_XAC_DINH`, xử như `CAO` |
| 6 | Bí mật giá lan sang phái sinh | A4, A5, A6, J4; spec S4 §2.5 ⒀ | Chỉ đọc gói đã mở niêm phong theo vị từ *"giá đã lộ"* của spec S4. Không đầu ra nào tới phiên khách hay màn nhà cung cấp |
| 7 | Bằng chứng không mang số tiền | ADR-054; spec S3 §2.5 ⒁ | Bằng chứng là tỷ lệ, thứ hạng, số đếm, định danh — không một số tiền nào. Nếu không, bảng yếu tố thành bảng giá dạng rõ thứ ba |
| 8 | Không ML, không runtime thứ hai | ADR-092 | Thống kê tất định: trung vị, tứ phân vị, độ lệch tuyệt đối trung vị (MAD), số đếm. Lõi thuần TypeScript trên số nguyên hoặc `numeric` dạng chuỗi |
| 9 | Không phụ thuộc lịch chạy nền | ~~ADR-005~~ **[S1.157]** Tinh thần ADR-005 (`DECISIONS.md:136`: tính đúng không phụ thuộc tiến trình nền). ADR-005 ⑵ vẫn giữ một job đóng RFQ để hiển thị (`:129`), nên ràng buộc này là lựa chọn của S4b, không phải chữ của ADR-005 | Không job định kỳ nào. Mọi phép tính chạy khi có người đọc hay khi có một sự kiện (đề xuất trao, ký) |
| 10 | Tách người theo HÀNH VI | ADR-051; spec S4 §2.4 ⑼ | Người ghi nhận yếu tố đỏ nằm ngoài ~~{người tạo gói, người gây ra yếu tố, người đề xuất, người duyệt}~~ **[S1.157]** tập của §2.5 ㉞ — bốn vai của ⑼ đọc theo hành vi thật, cộng hai người mà ADR-082 ⑺ và ADR-081 ⑸ đã loại khỏi quyết định trao |
| 11 | Effective Cost chỉ gồm tiền | J1; ADR-053 | Supplier Score và Risk Score KHÔNG vào `effective_cost` và KHÔNG đổi `rank`. Chúng hiện cạnh bảng xếp hạng |
| 12 | Phân tích người mua là dữ liệu về nhân viên | spec S4 §8.7; tiền đề E7 | S4b.5 không bắt đầu trước khi câu hỏi pháp lý có câu trả lời. **[S1.157]** F2a cũng là phân tích ấy, nên đi cùng S4b.5; mọi đường trả dữ liệu mang tên nhân viên đều để một hàng sổ (§2.4 ㉖) |

### 2.1. ADR-058 ⑸ nói về độ ỔN ĐỊNH của khoảng cách, không phải về một khoảng cách

Nguyên văn: *"Khoảng cách giữa giá thắng và giá nhì mạnh nhất — thông đồng để lại biên bọc lót ổn định bất thường, cạnh tranh
thật cho phân tán rộng."* Một khoảng cách 2% trên một gói không nói gì. Tín hiệu là khi khoảng cách ấy ĐỨNG YÊN qua nhiều gói
của cùng một nhóm nhà cung cấp, trong khi cạnh tranh thật cho khoảng cách dao động rộng. Nên yếu tố mạnh nhất của S4b (F1, §4)
là một thống kê trên CHUỖI gói, không phải một phép so trên một gói. Đó cũng là lý do nó không có nghĩa trước khi có lịch sử.

Thứ hai trong ADR-058 ⑸ là *"ma trận tỷ lệ thắng theo nhà cung cấp và theo chu kỳ"* — F2. Thứ ba, IP/thiết bị/metadata, nằm
ngoài S4. **[S1.157]** ⑸ không có trục NGƯỜI MỜI: nó ứng với F2b và F4. Trục người mời của F2a đến từ ADR-058 ⑶(b) và spec
S4 §4.9, và F2a rời Risk Score cho tới S4b.5 (§2.4 ㉖).

### 2.2. Các quyết định của chủ dự án áp cho S4b

| Nguồn | Quyết định | Áp ở đây |
|---|---|---|
| Spec S4 §2.2 ⑴ | S4b = Supplier Score, Risk Score, phát hiện bất thường, Buyer Analytics; mở khi có sàn dữ liệu | §4–§8; cổng (e) |
| Spec S4 §2.4 ⑺ | Vai `DATA_STEWARD` mù giá | Không đọc được đầu ra nào của S4b (đều là dữ liệu sau mở thầu) |
| Spec S4 §2.4 ⑼ | S4b.1 tách khỏi cổng (e), sau S3.5; `KHONG_XAC_DINH` xử như `CAO`; ghi nhận bởi người ngoài bốn vai; đầu vào đóng băng | §5 |
| Spec S4 §2.4 ⑾ | Quần thể theo gói, loại `CANCELLED`; *"thấp bất thường"* chỉ dẫn tới yêu cầu làm rõ | F3; mọi quần thể lịch sử của §4 |
| 2026-09-26 (vòng này) | Viết spec chi tiết S4b bây giờ, không viết mã | Tài liệu này |

### 2.3. Sáu câu hỏi cho chủ dự án — trả lời ở lượt soi hình dạng

**[S1.157]** Bảng dưới giữ nguyên văn. Q6 được trả lời từ vai, không còn là câu hỏi (§2.5 ㊷). Q1–Q5 sang §2.6 cùng hai
câu lượt soi thêm; Q5 trích sai đề xuất của spec S4 (dòng Q5). Lượt soi còn thấy bảng thiếu những chỗ bản nháp tự chốt mà
lẽ ra phải hỏi — trọng số và ngưỡng của Risk Score, ai đọc sổ tín hiệu (góc D⑧) — nên bốn chỗ nặng nhất đã được hỏi ngay
trong lượt soi (§2.4).

| # | Câu hỏi | Vì sao không tự chốt được |
|---|---|---|
| **Q1** | **Trọng số Supplier Score.** 40% trọng số mặc định của V2.1 §13 (Quality 20% + Delivery 20%) không có nguồn tới S5. Ba lối: ⒜ không có mặc định — tổ chức tự khai trên các thành phần có nguồn; ⒝ co giãn tỷ lệ bộ mặc định V2.1 trên các thành phần có nguồn; ⒞ hoãn Supplier Score tới S5 | Mọi lối đều là một bộ trọng số mà V2.1 không có. Spec S4 §4.9 đã từ chối tự chia lại |
| **Q2** | **Ai đọc phân tích người mua, và người bị phân tích có đọc được dòng của chính mình không.** `audit.read` do `FINANCE` và `DIRECTOR` giữ — cũng chính là người đề xuất và người duyệt, tức cũng là người bị phân tích | Lựa chọn về quản trị nhân sự, không phải kỹ thuật |
| **Q3** | **Bảo hành.** Thành phần *Warranty* của V2.1 §13 cần một ô khai `warrantyMonths` mà S4a không có. Thêm vào form nộp thầu (ma sát cho nhà cung cấp, PRODUCT §8 ⑴), hay để trống thành phần ấy | Lựa chọn giữa đủ thành phần và ma sát |
| **Q4** | **Nút *[REQUEST REVIEW]* của màn Executive (V2.1 §24).** Kho không có hành vi *"yêu cầu xem xét"*. Làm nó thành một hàng ghi nhận có người nhận, hay bỏ nút | Thêm một hành vi mới vào chuỗi trao thầu |
| **Q5** | **Số của cổng (e) — ADR (e).** Đề xuất GIẢ ĐỊNH của spec S4: ≥ 30 gói mở niêm phong, ~~≥ 60% giá trị dòng~~ **[S1.157]** ≥ 60% HẠNG MỤC (spec S4 §2.3 (e); đếm theo giá trị phải đọc giá) có ánh xạ hiệu lực (loại `NULL`), ≥ 6 tháng — theo TỪNG tổ chức | Con số chỉ hiệu chỉnh được trên dữ liệu thật; nhưng không có con số thì cổng không có trạng thái *đạt* |
| **Q6** | **Người đề xuất có thấy Risk Score trước khi đề xuất không.** Thấy thì họ tránh được nhà cung cấp rủi ro — và cũng *"mua sắm"* được một nhà cung cấp cho ra mức `THAP` | Đánh đổi giữa hỗ trợ quyết định và khả năng lách. **[S1.157] Không phải một lựa chọn:** §3.3 và §10 của chính bản nháp đã trả lời — xem §2.5 ㊷ |

### 2.4. [S1.157] Bốn quyết định của chủ dự án, sau lượt soi hình dạng

Lượt soi S1.157 tìm ra mười một chỗ là lựa chọn sản phẩm. Bốn chỗ nặng nhất được hỏi ngay; chủ dự án chốt cả bốn ngày
2026-09-26, đều theo đề xuất của lượt soi. Đánh số nối tiếp spec S4 (⑴–㉕). Đầy đủ lý do ở **ADR-096**. Bảy chỗ còn lại ở
§2.6.

| # | Phát hiện | Quyết định |
|---|---|---|
| ㉖ | **F2a đi vòng qua câu hỏi pháp lý E7** (CAO ①). F2a tính, cho TỪNG người mời, tỷ lệ chọn nhà cung cấp — đúng câu E7 hỏi. Bản nháp cho nó chạy từ S4b.2, tự lưu tên người vào `nguoi_gay_ra` ở mọi đề xuất, và cho đọc bằng `bid.view` — PM giữ cả `rfq.invite` lẫn `bid.view` (`005:298-301`), nên đọc được mình đã bị gắn cờ chưa. Sổ tín hiệu tính F2a mà không để dấu. F8 gắn tên người ánh xạ và ra `DO` từ MỘT dòng | **F2a rời Risk Score và sổ tín hiệu, sang S4b.5**, chờ E7 và Q2. **F8 giữ**, nhưng: không hiện tên ở cổng `bid.view`; có sàn; người viết mô tả dòng vào tập người gây ra cạnh người ghi ánh xạ. **Mọi đường trả dữ liệu mang tên nhân viên đều để một hàng sổ lượt đọc**, mang đối tượng bị xem (§2.5 ㊹). Cái giá: tới S4b.5, không yếu tố nào theo trục người mời — F1, F2b, F4 không tính theo người mời nên rải người mời không làm chúng mù, nhưng một người mời thiên vị một nhà cung cấp trên nhiều nhóm hàng thì không bị đo |
| ㉗ | **S4b.1 nổ quá hẹp, và độ phủ mua được** (CAO ②). F1 + F2b + F3 cùng `DO` = 50 điểm = `VUA` → duyệt một chạm. Càng nhiều yếu tố xanh có dữ liệu, điểm càng thấp. `KHONG_AP_DUNG` rút khỏi mẫu số: gói một báo giá đọc được (F1), tổ chức chưa bật S3 (F6), gói không nhóm hàng (F4) cho độ phủ 61,5% và mức `THAP`. F5, F7, F8 không sàn nên luôn *"có dữ liệu"* và gần như luôn xanh — chúng mua độ phủ | **S4b.1 nổ khi có ≥ 1 yếu tố `DO` hoặc mức `KHONG_XAC_DINH`. Điểm chỉ để hiển thị.** Yếu tố vắng không bao giờ làm tăng độ phủ; yếu tố không cần lịch sử không vào độ phủ (§2.5 ㉚). Thêm yếu tố **F10 — cạnh tranh thực tế**: gói chỉ một báo giá đọc được là `DO`. Cái giá: ma sát cao hơn — mọi `DO`, không chỉ mức `CAO`, đòi một người thứ hai |
| ㉘ | **Người đặt ngưỡng là người ký trao** (CAO ③). `rui_ro` nằm trên phiên bản chính sách, do người giữ `policy.manage` ghi — `FINANCE`, người cũng giữ `po.approve`. Đặt ngưỡng độ phủ 0% MỘT LẦN, trước mọi gói, là tắt chốt; ghim lúc `OPEN` không chặn được | **Ngưỡng độ phủ, ngưỡng mức, luật nổ và `KHONG_XAC_DINH` ≡ `CAO` là HẰNG của phiên bản phương pháp, không cấu hình được. Trọng số — chỉ đổi điểm hiển thị — vẫn cấu hình được, có sàn dưới.** Ngoại lệ có ghi lý do với PRODUCT §8 ⑸ và ràng buộc 10 của spec S4 (*"mọi ngưỡng cấu hình được"*): một chốt mà người bị chốt tắt được thì không phải chốt |
| ㉙ | **Phạm vi của S4b.1** (CAO ④). Bản nháp không nói. Áp cho mọi tổ chức thì mọi lần trao của kịch bản pilot (PRODUCT §11) thêm đăng nhập lại, giải trình và một người ghi nhận, suốt ít nhất 6 tháng; lật bước 12i của `kich-ban-41-http.int.test.ts:1217`, sáu lời gọi `duyetTraoThau` ở `luot-danh-gia.int.test.ts`, `bo-xuat.int.test.ts:288` và bước 7 của `mo-thau.js:451-463`; và là ngoại lệ đổi hành vi thứ hai mà ADR-091 ⑷ không ghi | **Theo công tắc ADR-080: chỉ tổ chức đã bật S3.** Tổ chức chạy MVP1 — đúng hình dạng pilot — không đổi, và không ca nào của MVP1 lật. Cái giá: tổ chức chưa bật S3 không có chốt này |

### 2.5. [S1.157] Chốt từ tiền lệ

Hai mươi mốt chỗ điền được từ tiền lệ đo được trong kho hay từ chính các quyết định trên, cùng khuôn ADR-050. Tóm ở
**ADR-097**. M1–M8 là phép đo và phép tính của biên bản §S1.157.

| # | Phát hiện | Chốt | Tiền lệ |
|---|---|---|---|
| ㉚ | **Độ phủ có ba cách đọc** (CAO ②, D①): mẫu số chín yếu tố cho 15%, mẫu số yếu tố đã cài cho 50% hay 25%, mẫu số đủ khi S3 chưa bật cho 5,6% | **Độ phủ = Σ trọng số PHƯƠNG PHÁP của yếu tố có lịch sử ở trạng thái `CO_DU_LIEU` / Σ trọng số phương pháp của MỌI yếu tố có lịch sử** trong phiên bản phương pháp — hôm nay {F1, F2b, F3, F4}, tổng 55. Yếu tố chưa có mã mang trạng thái mới `CHUA_CAI`; `CHUA_CAI`, `CHUA_DU_LICH_SU`, `KHONG_AP_DUNG` đều đếm như không có dữ liệu. Tính trên trọng số của PHƯƠNG PHÁP, không trên trọng số tổ chức khai — nếu không, ㉘ lách được bằng trọng số. **Hệ quả nói thẳng:** trước S4b.2, độ phủ tối đa 15/55 ≈ 27%, nên MỌI lần trao ở tổ chức đã bật S3 đi qua S4b.1 cho tới khi S4b.2 có mã và tổ chức vượt sàn | ⑼ (`KHONG_XAC_DINH` ≡ `CAO`); ㉗; ㉘ |
| ㉛ | **"Bản MỚI NHẤT" không có nghĩa; đề xuất không có đánh giá thì một chạm** (CAO ⑥). `rfq_awards` chỉ-ghi-thêm; huỷ rồi đề xuất lại sinh hàng mới (`061:546-554`). Một INSERT thêm hàng `muc = 'THAP'` lật cổng; không gì buộc đề xuất phải có đánh giá | **Một đánh giá cho một hàng `PROPOSED`**: `UNIQUE (org_id, award_id)`. Trigger BEFORE INSERT đòi hàng award là `PROPOSED`, `acted_at = transaction_timestamp()` — tức ghi trong CÙNG giao dịch với đề xuất —, và tác giả = `acted_by`. M6: so `xmin` với `pg_current_xact_id()` từ chối nhầm khi đề xuất nằm trong một `SAVEPOINT`; so `acted_at` đúng cả hai ca và từ chối giao dịch sau. **CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED** trên `rfq_awards`: mỗi hàng `PROPOSED` của tổ chức trong phạm vi ㉙ có đúng một đánh giá lúc COMMIT (M7). Đề xuất lại sau huỷ tính lại từ đầu; ghi nhận cũ không chuyển sang. Đề xuất `PROPOSED` còn treo lúc triển khai không ký được — huỷ rồi đề xuất lại | `017:195-197`, `018:379-381` (deferred); `014:200` (NULL là *"chưa trả lời được"*) |
| ㉜ | **Phép tổng hợp tính được ở CSDL mà bản nháp đẩy sang TypeScript** (TRUNG 13) | `moc_mo_gia`, `moc_de_xuat`, `policy_id`, `bid_version_id` ngoài GRANT, trigger đặt. `phien_ban_phuong_phap` phải thuộc tập một hàm SQL `IMMUTABLE` khai — tập mã yếu tố, trọng số, hằng của ㉘. `diem`, `do_phu`, `muc`, `co_no` ngoài GRANT, deferred trigger tính lúc COMMIT từ các hàng yếu tố; tập mã yếu tố của đánh giá phải BẰNG tập của phiên bản phương pháp. Chỉ MỨC TỪNG YẾU TỐ còn cần lõi TypeScript, nên T5 ⑷ hẹp lại: ứng dụng phải nói dối ở mức một yếu tố. Tính trên `numeric`, làm tròn nửa-ra-xa-0 — M3: `round(2.5::numeric)` = 3, `round(-2.5::numeric)` = −3, còn `round(2.5::float8)` = 2 | `011` (`approved_content_hash`); `014` §(4) và spec S4 ⒄ (một luật một chỗ); ADR-050 ⑴ |
| ㉝ | **Trigger L11 đặt sai chỗ, không khoá** (CAO ⑦). Hôm nay chữ ký và hàng `APPROVED` cùng một giao dịch (`trao-thau.ts:408-435`); S3.5 sẽ tách. Ghi nhận là việc của người khác, ở giao dịch khác, TRƯỚC chữ ký; dưới READ COMMITTED hai bên không thấy nhau | **L11 là trigger BEFORE INSERT trên `rfq_award_approvals`**, không trên hàng `APPROVED`; tên xếp sau `rfq_award_approvals_kiem_nguoi_duyet`; ENABLE ALWAYS. Ở MỖI chữ ký, tính lại từ đầu, chiều fail-closed: đánh giá tồn tại; `co_no` tính lại từ hàng yếu tố; có giải trình của chính người ký, chèn trước trong cùng giao dịch; mỗi hàng `DO` — kể cả `DO_PHU` — có ≥ 1 ghi nhận bởi người ngoài tập ㉞ tính TẠI LÚC KÝ. Trigger ghi nhận và trigger L11 lấy CÙNG khoá tư vấn `hashtextextended(rfq_id::text, 1)`. M8: không khoá thì *"D1 ghi nhận"* và *"D1 ký"* chạy song song cùng commit; có khoá thì bên sau thấy bên trước và bị từ chối. Mã lỗi và thông điệp khác lỗi *"chưa đủ chữ ký"*, để S3.5 không nuốt nhầm. Một thứ tự khoá chung với S3.5 | `061:607-610` (thứ tự tên trigger); `040:101-118` (trigger đọc vai); spec S3 ⒄ |
| ㉞ | **Tập loại trừ thực chất chỉ còn {người đề xuất, người duyệt}** (CAO ④, TRUNG 14). `po.approve` chỉ ở `FINANCE`, `DIRECTOR`; người tạo gói và người gây ra hầu như không giữ nó; *"người duyệt"* chưa biết lúc ghi nhận | **Người ghi nhận nằm ngoài:** người tạo gói; người gây ra của yếu tố (㉟); MỌI người đã đề xuất trao X, kể cả đề xuất đã huỷ; MỌI người đã ký đề xuất này, kể cả người đang ký; tác giả phiên bản chính sách X ghim; người thẩm định N. Kiểm ở CẢ đường ghi nhận lẫn đường ký, dưới khoá ㉝. Không mở rộng tới người duyệt mở thầu hay người chấm: không tiền lệ nào loại họ khỏi quyết định trao, và làm thế đòi ≥ 4 người `po.approve`. **Số người:** ngoài người đề xuất, (số chữ ký của bậc + 1) người giữ `po.approve` — ba ở bậc 2 của S3 | ⑼; ADR-082 ⑺ (tác giả phiên bản không ghi nhận tín hiệu trên gói ghim nó); ADR-081 ⑸; ADR-082 ⒁ |
| ㉟ | **`nguoi_gay_ra uuid[]` do ứng dụng khai** (TRUNG 14). Không khoá ngoại phần tử; `x = ANY(arr)` ra NULL khi mảng chứa NULL | **Bảng con `(org_id, factor_id, user_id)`**, khoá ngoại hợp thành tới `users`. Trigger SUY người từ bảng đầu vào: F6 lấy người gây ra trên hàng tín hiệu S3; F8 lấy tác giả ánh xạ và người viết mô tả dòng; F11 lấy người đề xuất và người huỷ. Ứng dụng không khai người | `061:297`, `013:124-125`; bài học NULL của spec S3 §4.7 |
| ㊱ | **"Hàng độ phủ" không có chỗ để ghi nhận** (CAO ⑤) | Mã yếu tố thuộc tập đóng, gồm hàng giả **`DO_PHU`**, do deferred trigger ㉜ sinh với mức `DO` khi độ phủ dưới hằng. Ghi nhận trỏ `(org_id, factor_id)` như mọi yếu tố | góc B③ |
| ㊲ | **As-of loại đúng những đầu vào sinh sau mốc** (CAO ⑧). Mốc = `min(unsealed_at)` = vòng một. Báo giá BAFO được trao và nhịp nộp vòng hai đều sau mốc; `ESTIMATE_UNDERSTATED` tính lúc đề xuất, `LOW_ACTUAL_COMPETITION` lúc trao — nhánh `DO` của F6 không bao giờ bắn | **Hai lớp.** THƯỚC — chính sách ghim, dữ liệu nền, nhãn và lịch sử các gói khác, nền tổ chức — đọc as-of `moc_mo_gia`. SỰ KIỆN VỀ CHÍNH X — phiên bản báo giá được đề xuất (kể cả BAFO), tín hiệu, ngoại lệ, ánh xạ dòng của X, lịch sử đề xuất–huỷ của X — đọc as-of `moc_de_xuat`. F3, F7, F9 đo phiên bản ĐƯỢC ĐỀ XUẤT so với thước tại mốc; F5 dùng hạn của vòng chứa phiên bản ấy. Tín hiệu S3 tính lúc đề xuất ghi TRƯỚC đánh giá trong cùng giao dịch. F8 đọc cả ánh xạ ghi sau mốc, gắn nhãn `SAU_MOC`. Đòi S3.6 dựng `governance_signals` theo khuôn `seq`/`ghi_luc` | Luật mù của spec S4 §3.3 sinh ra để chặn chỉnh THƯỚC sau khi thấy giá, không để giấu sự kiện; nhãn `SAU_MOC` của L7 |
| ㊳ | **Bảng đầu vào sai hạt, và quá lớn** (TRUNG 11). Khoá ngoại tới *"gói và phiên bản báo giá"* không ghim lượt chấm, hàng award, lời mời, tín hiệu hay ánh xạ đã đọc; nền P10/P25 quét gần mọi gói — cỡ 10⁴ hàng mỗi đánh giá | **`rfq_risk_factor_inputs` đa hình:** mỗi nguồn một cột khoá ngoại — `(org_id, evaluation_id, bid_version_id)` → `rfq_evaluation_lines`, → `rfq_awards`, → `rfq_invitations`, → tín hiệu, → ánh xạ, → `vendor_bid_versions` — cộng `CHECK (num_nonnulls(…) = 1)`. **Nền tổ chức** (phân vị, mẫu số) là ảnh chụp chỉ-ghi-thêm riêng theo (tổ chức, nhóm hàng, mốc), dùng chung giữa các đánh giá; bảng đầu vào chỉ giữ chuỗi của X. Người thắng đọc qua hàm của S3.5, không đọc thẳng `rfq_awards.status`. Lời mời còn sống tại mốc đọc qua `revoked_at` — thu hồi là UPDATE tại chỗ (`010`) | spec S4 ⑿ và L7 (bảng con khoá ngoại); spec S4 §3.4 |
| ㊴ | **Bằng chứng mang được tiền** (TRUNG 15, 21). Danh sách đen sáu khoá phân biệt hoa thường, lệch với danh sách của sổ, thiếu `don_gia`, `effective_cost`; bộ bằng chứng mang định danh rõ và đủ g để suy ra giá nhì của gói khác | ⑴ **Lược đồ ĐÓNG theo mã yếu tố**: mỗi mã một tập khoá cho phép. ⑵ Dây bẫy phụ: MỘT tập khoá tiền hợp — `tien`, `gia`, `so_tien`, `amount`, `unitPrice`, `totalAmount`, `don_gia`, `thanh_tien`, `price`, `total`, `effective_cost`, `estimated_value`, `gia_tri`, `freight`, `importCost` —, không phân biệt hoa thường, bắt cả khoá lồng: `$.** ? (@.type()=="object").keyvalue() ? (@.key like_regex "…" flag "i")`. M4: bắt khoá `Gia` lồng trong mảng; mảng toàn số không ném. Một phép kiểm đòi các bản của tập khoá bằng nhau. ⑶ `giai_thich` lưu (mã mẫu, tham số), không lưu câu đã điền. ⑷ Áp cho bản chụp Supplier Score và `risk_register_acks`; khai ở `CHECK_AN_NINH_KHAI`; không `silent => true`. ⑸ Lớp S4b trong bộ bằng chứng mang định danh băm có muối và thống kê cấp CHUỖI, không mang g của từng gói khác: tái lập ngoại tuyến ra đúng MỨC từ thống kê; tính lại thống kê từ dữ liệu gốc chỉ làm được trên CSDL | `003:219-225` (`audit_events_payload_khong_mang_gia`); spec S4 ㉑; ADR-054 |
| ㊵ | **`rui_ro` không có `CHECK`, và `NULL` chưa định nghĩa** (CAO ③) | `CHECK` viết ở dạng KHẲNG ĐỊNH. M5: dạng phủ định `NOT jsonb_path_exists(… != 100)` cho qua một hàng thiếu khoá; dạng khẳng định từ chối (23514). Dạng phủ định chỉ an toàn khi kèm vế `exists()` cho mọi khoá, như `057:50-62` đã làm. Trọng số là chuỗi số nguyên; mỗi trọng số ≥ sàn — một nửa mặc định của phương pháp, GIẢ ĐỊNH. `rui_ro` NULL trên phiên bản ghim ⇒ trọng số mặc định của phương pháp, không từ chối — nên phiên bản v1 của `gieo:demo` và mọi chính sách MVP1 không lật | M5; `057:50-62`; ㉘ |
| ㊶ | **Thứ tự khoá và trần thời gian** (TRUNG 16). Ghi sổ lấy khoá tư vấn THEO TỔ CHỨC, trần chờ 2 giây (`004:213`, `050:48`); lõi TypeScript chạy giữa hai câu SQL tính là idle-in-transaction, trần 60 giây (`pool.ts:141-143`) | Thứ tự trong giao dịch đề xuất: đọc → tính → ghi đánh giá → đổi trạng thái → ghi sổ CUỐI. Phép tái lập lúc ký chạy TRƯỚC câu INSERT chữ ký. Tìm chuỗi bằng hàm SQL `STABLE SECURITY INVOKER`, không kéo lời mời ra tiến trình. Phép đo hiệu năng đo cả thời gian giữ khoá sổ của tổ chức trong lúc tính — phải bằng 0 | `trao-thau.ts:318-331` (ghi sổ đứng cuối) |
| ㊷ | **Q6 không phải một lựa chọn** (CAO ⑧). `FINANCE` giữ `award.recommend`, `bid.view`, `po.approve` (`005:306-310`): một mình đề xuất, đọc mức ngay (T2 của bản nháp), huỷ — `huyTraoThau` không đòi người huỷ khác người đề xuất —, rồi đề xuất lại. Phép tính công bố ở `DAC-TA.md`. Chỉ `BUYER` mù | Người giữ `bid.view` **THẤY** đánh giá ngay sau đề xuất, như bản nháp đã viết. Không thêm bản xem trước. Thêm **F11** để vòng đề xuất–huỷ–đề xuất lại để lại dấu | `005:306-310`; T2 của bản nháp |
| ㊸ | **F6 thiếu hai loại ngoại lệ; một tín hiệu phải ghi nhận hai lần** (TRUNG 9) | F6 kể đủ năm loại ngoại lệ của S3: `SINGLE_SOURCE`, `LIMITED_COMPETITION`, `ROTATION`, `LOW_ACTUAL_COMPETITION`, `LIST_NARROWED_BELOW_MIN`. Một ghi nhận K10 hợp lệ của CÙNG tín hiệu thoả vế ghi nhận của F6 khi người ghi nhận cũng nằm ngoài tập ㉞ — một sự việc, một lần ghi nhận | spec S3 §4.4 (`:316`), §4.6 (`:365-366`); ADR-084 ⑵; PRODUCT §8 ⑴ |
| ㊹ | **Ghi sổ khi ĐỌC không có tiền lệ, và GET không ghi được** (TRUNG 7, 20; ㉖). Bộ canh route từ chối GET đổi trạng thái (`route-types.ts:414-415`) | Mọi đường trả dữ liệu mang tên nhân viên là route `POST`, `mutates: true`, có mã quyền; ghi sổ ở CUỐI handler bằng `appendAuditEvent` trong cùng `withTenant`; ghi sổ hỏng thì không trả dữ liệu. Hàng sổ mang người đọc, khung thời gian và ĐỐI TƯỢNG bị xem. `agentGoiDuoc` đã trả `false` cho route ghi có mã quyền, nên *"không qua MCP"* đạt sẵn | `route-types.ts:330-335`; `trao-thau.ts:318`; khoản 244 |
| ㊺ | **Route và màn** (TRUNG 7). *"Mỗi route mới khai `agent: false`"* sai với route GHI (`route-types.ts:430-431`). *"MFA mới"* không có luồng: kho không có đường step-up, `MfaRequiredError` trả 401 (`dispatch.ts:336`) | Route GET đọc khai `agent: false`; route POST không khai. Liệt kê đủ route ở §9.2. *"MFA mới"* là đăng nhập lại qua magic link, và màn nói luồng ấy. Màn Executive có trạng thái *"chưa mở niêm phong"*. S3, S4a, S4b đưa `apps/web` từ 3 lên khoảng 10 trang — đúng điều kiện bàn lại ADR-044 tự đặt (`DECISIONS.md:4788`); vòng S4b.1 mở lại câu ấy trước khi thêm trang | ADR-039; ADR-044 |
| ㊻ | **F1 không tính được đúng ca mạnh nhất, và thước của nó đảo chiều** (TRUNG 10, 17). `rank` là xếp hạng thi đấu 1, 1, 3; `rank` NULL khi EC NULL (`057:161`); một gói nhiều lượt chấm; sau S4.7 có hai hạng. M2: hệ số MAD/trung vị của nhóm bọc lót sát 0–0,3% là 0,415, CAO hơn cạnh tranh thật 1–15% (0,363); chỉ 7,2% chuỗi bọc lót rơi dưới P10 | Đồng hạng 1 ⇒ g = 0; EC NULL ⇒ loại dòng; lượt chấm = `rfq_awards.evaluation_id` của đề xuất trong từng gói; hạng theo `gia`, không TCO. **Đo bằng số TUYỆT ĐỐI**: trung vị g và MAD của g theo điểm phần trăm, không chia cho trung vị — trên cùng dữ liệu mô phỏng, cả hai số tuyệt đối tách hẳn hai quần thể (M2). Ngưỡng cũng tuyệt đối, không theo phân vị của chính tổ chức (§4.1). Ngưỡng vẫn GIẢ ĐỊNH, và phân phối *"cạnh tranh thật"* của phép mô phỏng cũng là GIẢ ĐỊNH | `luot-danh-gia.ts:22-26, 222-236`; ADR-058 ⑸ (*"giá thắng và giá nhì"*) |
| ㊼ | **F2b báo sai ở tỷ lệ đáng kể trên cạnh tranh thật** (TRUNG 17). M1, đếm vét cạn dưới mô hình rỗng — k nhà cung cấp ngang sức, người thắng độc lập: `VANG` ở chuỗi 6 báo sai 4,1% (k = 3) và 12,3% (k = 4); `DO` ở chuỗi 9 báo sai 0,9% và 2,6% | `VANG` ở 9–11 gói; `DO` ở ≥ 12 gói — báo sai 0,2% ở cả k = 3 và k = 4. *"Chen chân"* = có lời mời còn sống tại mốc | M1 |
| ㊽ | **Ba yếu tố mới** (CAO ②⑧, TRUNG 19) | **F9** phân bổ giá lệch giữa các dòng — *unbalanced bid*, spec S4 §10 dòng cuối đã hứa là yếu tố của S4b mà bản nháp làm rơi; **F10** cạnh tranh thực tế (㉗); **F11** đề xuất–huỷ–đề xuất lại (㊷). Định nghĩa ở §4.1 | spec S4 §10; ㉗; ㊷ |
| ㊾ | **Supplier Score là cần gạt hạ nhà cung cấp trung thực** (TRUNG 18, 21) | *Responsiveness* chỉ đếm lời mời trong nhóm hàng N khai ở Passport, và chỉ gói thoả vị từ *"giá đã lộ"* — không đọc từ `CLOSED`, vì so điểm trước và sau lúc X đóng là biết N đã nộp chưa, trước mở thầu. *Compliance* hiện người thẩm định hay thu hồi cùng lý do; nộp Passport mới không tính là thu hồi. *Risk* chỉ đếm mẫu mà N là thành viên; bằng chứng F5 ghi cặp nhà cung cấp. *Price Competitiveness* loại gói có < 3 báo giá đọc được | A5; spec S4 §2.5 ⒀ và góc C⑦ của S1.155; ADR-081 |
| ㊿ | **Sổ tín hiệu: người bị soi chọn khung, đọc không dấu, ghi nhận để khép** (TRUNG 20) | Chuỗi luôn tính trên 12 tháng tới cuối khung; khung chỉ lọc gói cuối. Mỗi lượt đọc một hàng sổ (㊹). Người ghi nhận một dòng nằm ngoài mọi người đã đề xuất, ký hay ghi nhận trao trong chuỗi. Ghi nhận không bao giờ ẩn dòng. Ai đọc: Q2 (§2.6) | ADR-051; ㊹ |

### 2.6. [S1.157] Bảy câu ~~còn chờ chủ dự án~~ [S1.158] chủ dự án đã chốt

Không câu nào chặn một vòng đang chạy: mọi hạng mục của S4b còn chờ S3.5, S4.5 hay cổng (e). Mỗi câu chặn đúng hạng mục ở cột
cuối, và phải có câu trả lời trước khi hạng mục ấy mở. ~~Cột giữa là đề xuất của lượt soi, CHƯA phải quyết định.~~
**[S1.158]** Chủ dự án chốt cả bảy ngày 2026-09-26, đều theo đề xuất — **ADR-098**. Cột giữa nay là quyết định; hệ quả ở §2.7.

| # | Câu hỏi | Lượt soi đề xuất | Chặn |
|---|---|---|---|
| **Q1** | Trọng số Supplier Score (⒜ tổ chức tự khai trên thành phần có nguồn · ⒝ co giãn bộ mặc định V2.1 · ⒞ hoãn tới S5) | ⒞. 40% trọng số V2.1 không có nguồn tới S5 — 45% nếu tính Warranty —, và ㊾ cho thấy mỗi thành phần có nguồn đều là một cần gạt cần vá | S4b.4 |
| **Q2** | Ai đọc phân tích người mua và sổ tín hiệu; người bị phân tích có thấy lượt đọc về mình không. `audit.read` chỉ ở `FINANCE`, `DIRECTOR` — chính người đề xuất và ký trao | Một vai kiểm toán mới giữ ĐÚNG một mã đọc hai màn ấy — mã mới đúng tiêu chí ADR-084 ⑴, vì hành vi cần TÁCH NGƯỜI. Người bị phân tích thấy danh sách lượt đọc về mình | S4b.3, S4b.5 |
| **Q3** | Bảo hành: thêm ô `warrantyMonths` vào form nộp thầu hay để trống thành phần | Để trống; không thêm ô (PRODUCT §8 ⑴). Thừa nếu Q1 = ⒞ | S4b.4 |
| **Q4** | Nút *[REQUEST REVIEW]* của màn Executive | Bỏ. Ghi nhận của S4b.1 đã là hành vi *"một người thứ hai xem xét"* | S4b.6 |
| **Q5** | Số của cổng (e) | ≥ 30 gói `UNSEALED`, ≥ 60% HẠNG MỤC có ánh xạ hiệu lực (loại `NULL`), ≥ 6 tháng. Cổng (e) là cổng DỰ ÁN cho vòng mã — đạt khi ≥ 1 tổ chức thật đạt; sàn lúc chạy theo từng tổ chức là sàn của từng yếu tố (§4.1), không phải cổng | S4b.0 |
| **Q7** | North Star của PRODUCT §9 — *"có risk assessment"* đếm gói nào | Chỉ gói có đánh giá mức khác `KHONG_XAC_DINH`. Đếm mọi gói có hàng đánh giá thì North Star tầm thường ở mọi tổ chức đã bật S3 | S4b.2 |
| **Q8** | Dữ liệu gieo có được dùng cho kịch bản demo V2.1 §41 trước pilot không | Được, mang nhãn *"dữ liệu mẫu"* trên mọi màn, và không bao giờ tính cho cổng (e) | S4b.6 |

### 2.7. [S1.158] Hệ quả của bảy quyết định

| # | Quyết định | Đổi gì |
|---|---|---|
| **Q1** | **Supplier Score hoãn tới S5** | §7, L9 và hạng mục S4b.4 rời S4b. Không dựng cột bản chụp Supplier Score trên `rfq_risk_assessments`, không route `/nha-cung-cap/:id/diem`. ㊾ và các cần gạt của góc C⑧ ghi lại làm đầu vào cho spec S5, cùng lúc *Quality*, *Delivery* có nguồn. Spec S4 §2.2 ⑴ — *"S4b: Supplier Score, …"* — và kịch bản §7.2 của nó đổi theo |
| **Q2** | **Vai mới `AUDITOR` giữ đúng một mã mới `analytics.review`** — đọc sổ tín hiệu, ghi nhận một dòng sổ, đọc phân tích người mua | Vai và người giữ vai ấy không giữ `rfq.create`, `rfq.invite`, `award.recommend`, `po.approve`, `bid.view`, `policy.manage`, `item.manage` — hai trigger khuôn `033`, như `DATA_STEWARD` (spec S4 L3). `FINANCE`, `DIRECTOR` vẫn giữ `audit.read` cho sổ kiểm toán, nhưng không đọc hai màn ấy. Mỗi người mua đọc được danh sách lượt đọc VỀ CHÍNH MÌNH — ai đọc, lúc nào, khung nào; không phải số liệu — qua một route tự thân. Mã mới đúng tiêu chí tách người của ADR-084 ⑴, vào CSDL ở S4b.3 (khuôn ADR-084 ⑶). Cái giá: tổ chức cần thêm một người — tiền đề E14 |
| **Q3** | **Không thêm ô bảo hành** | Không đổi form nộp thầu. Thừa sau Q1 |
| **Q4** | **Bỏ nút *[REQUEST REVIEW]*** | Màn Executive chỉ đọc, không một hành vi mới nào |
| **Q5** | **Cổng (e): ≥ 30 gói đã mở niêm phong, ≥ 60% HẠNG MỤC có ánh xạ hiệu lực (ánh xạ `NULL` không tính là hiệu lực), ≥ 6 tháng lịch sử** | Cổng của DỰ ÁN cho vòng mã từ S4b.2: đạt khi ≥ 1 tổ chức THẬT đạt đủ ba sàn, đo riêng từng tổ chức, không cộng dồn. Không tính tổ chức mang dấu dữ liệu mẫu (Q8), không tính lịch sử mua ngoài hệ thống (spec S4 ⑽). Điều kiện kèm của spec S4 (e) còn S3.5–S3.7; S3.8 phục vụ Supplier Score nên rời theo Q1. Sàn lúc chạy theo tổ chức là sàn của từng yếu tố (§4.1), không phải cổng. S4b.0 còn chờ pilot để ĐO, không còn chờ con số |
| **Q7** | **North Star: *"có risk assessment"* chỉ tính gói có đánh giá rủi ro mức khác `KHONG_XAC_DINH`** | Hệ quả nói thẳng: phần ấy của *Verified Competitive Spend* bằng 0 ở tổ chức chưa bật S3 — không có đánh giá —, và ở tổ chức đã bật S3 cho tới khi S4b.2 có mã và tổ chức vượt sàn (㉚). Chú ở PRODUCT §9 |
| **Q8** | **Dữ liệu gieo dùng được cho demo V2.1 §41, mang nhãn *"dữ liệu mẫu"*, không bao giờ tính cho cổng (e)** | Tổ chức do công cụ gieo dựng mang một dấu trên `organizations`, đặt lúc gieo, ngoài GRANT của `app_api`. Mọi màn S4b của tổ chức ấy hiện nhãn; công cụ đo cổng (e) loại nó. Bất biến L24 (§11.1) |

---

## 3. Kiến trúc

### 3.1. Thứ S4b tái dùng

| Đã có, hoặc sẽ có trước S4b | S4b dùng cho |
|---|---|
| `rfq_evaluation_lines.rank`, `effective_cost` (`057`) | F1 khoảng cách thắng–nhì (dạng tỷ lệ); thành phần giá của Supplier Score |
| `rfq_awards` (`061`): `bid_version_id`, `status`, `acted_by` | Người thắng theo gói; người đề xuất; chuỗi thắng cho F2. **[S1.157]** Người thắng đọc qua hàm của S3.5, không đọc thẳng `status` (spec S4 §3.4; §2.5 ㊳) |
| `rfq_award_approvals` (`061`) | Người duyệt — cho tập loại trừ và cho phân tích người mua |
| `rfq_invitations.invited_by` (`013`) | Ma trận người mời × nhà cung cấp (F2a). **[S1.157]** Từ S4b.5 (㉖); trước đó `rfq_invitations` chỉ cho lời mời còn sống tại mốc, đọc qua `revoked_at` (㊳) |
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
- **Tầng gói** — đọc as-of bằng các hàm SQL của S4a và S3, gọi lõi, ghi kết quả. ~~Mỗi chốt là một hàm vị từ SQL mà tầng gói
  gọi trước mọi tác dụng phụ, khuôn spec S3 §2.5 ⒂.~~ **[S1.157]** Câu vừa gạch mâu thuẫn §5.2: vế MFA (`assertFreshMfa`) và
  mức từng yếu tố là TypeScript. Chỗ ở chịu lực của từng vế là §10.1: phép tổng hợp, luật nổ, người và thứ tự ở CSDL (§2.5
  ㉜㉝); MFA và mức từng yếu tố ở tầng gói.

### 3.3. Tính khi nào — không có job nền

| Đầu ra | Tính lúc | Lưu? |
|---|---|---|
| Đánh giá rủi ro của một đề xuất trao | Trong giao dịch ghi đề xuất trao (`PROPOSED`) | Có — bảng `rfq_risk_assessments` + yếu tố |
| Kiểm lại lúc ký | Trong giao dịch ghi chữ ký trao | Không — tính lại từ đầu vào as-of đã lưu, so với bản lưu. **[S1.157]** Tái lập chạy TRƯỚC câu INSERT chữ ký; luật nổ và người do trigger L11 tính lại ở mỗi chữ ký (§2.5 ㉝㊶) |
| Supplier Score | Khi có người đọc; và chụp vào đánh giá rủi ro lúc đề xuất | Chỉ bản chụp lúc đề xuất. **[S1.158]** Hoãn tới S5 (Q1) |
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
| **F1** | Khoảng cách thắng–nhì ổn định bất thường | `rfq_evaluation_lines` của mọi gói có CÙNG tập nhà cung cấp chen chân (≥ 2 nhà cung cấp chung) với X trong 12 tháng | Với mỗi gói: g = (EC hạng 2 − EC hạng 1) / EC hạng 1. Trên chuỗi g: hệ số phân tán = MAD / trung vị. So với hệ số phân tán của toàn tổ chức cùng nhóm hàng | ≥ 6 gói trong chuỗi; ≥ 20 gói toàn tổ chức | `DO` khi phân tán của chuỗi < P10 toàn tổ chức; `VANG` khi < P25 | Không người dùng nào (nhà cung cấp) | Gói chỉ một báo giá đọc được → `KHONG_AP_DUNG`, ~~và F6 bắt ca ấy (một nhà cung cấp)~~ **[S1.157]** và F10 bắt ca ấy. F6 không bắt: nó `KHONG_AP_DUNG` khi chưa bật S3 và chỉ cho `VANG` khi đã bật (góc C①) |
| **F2a** | Tỷ lệ chọn lệch khỏi mặt bằng — người mời × nhà cung cấp | `rfq_invitations.invited_by`, `rfq_awards` | Với mỗi người mời của X: tỷ lệ N thắng trong các gói người ấy mời, so với tỷ lệ N thắng trong các gói người khác mời | ≥ 8 gói của người mời có N; ≥ 8 gói của người khác có N | `DO` khi tỷ lệ gấp ≥ 3 lần và chênh ≥ 30 điểm phần trăm; `VANG` khi gấp ≥ 2 | Người mời ấy | Không người mời nào đủ sàn → `CHUA_DU_LICH_SU` |
| **F2b** | Mẫu luân phiên thắng | `rfq_awards`, tập nhà cung cấp chen chân | Trên chuỗi gói có ≥ 3 nhà cung cấp chung với X: người thắng có luân phiên đều không — số lần mỗi nhà cung cấp thắng lệch khỏi đều ≤ 1, và không ai thắng hai gói liền nhau | ≥ 6 gói trong chuỗi | `DO` khi luân phiên đều trên ≥ 9 gói; `VANG` trên 6–8 gói | Không người dùng nào | Chuỗi < 6 → `CHUA_DU_LICH_SU` |
| **F3** | Giá thắng lệch khỏi dải nội bộ | Nhãn benchmark của S4a cho các dòng của báo giá N (spec S4 §4.6, L7) | Tỷ lệ giá trị dòng của N mang `LECH_CAO` trên tổng giá trị dòng đo được | Độ phủ benchmark của báo giá ≥ 50% giá trị | `DO` khi ≥ 30% giá trị dòng `LECH_CAO`; `VANG` khi ≥ 10% | Không người dùng nào | Độ phủ < 50% → `CHUA_DU_LICH_SU` |
| **F4** | Tập trung nhà cung cấp | `rfq_awards` theo hàng chuẩn hay nhóm hàng của các dòng của X | Tỷ phần số gói N thắng trên số gói của cùng nhóm hàng trong 12 tháng | ≥ 8 gói trong nhóm | `DO` khi ≥ 60%; `VANG` khi ≥ 40% | Không người dùng nào | Gói không có nhóm hàng → `KHONG_AP_DUNG` |
| **F5** | Nhịp nộp và sửa sát hạn | `vendor_bid_versions.submitted_at`, `version` — CHỈ của gói đã mở niêm phong | Trên X: số nhà cung cấp nộp phiên bản cuối trong 10 phút trước hạn, và số cặp nhà cung cấp có phiên bản nộp cách nhau < 60 giây | Không cần lịch sử | `DO` khi ≥ 2 cặp < 60 giây; `VANG` khi ≥ 1 cặp, hay khi N sửa ≥ 3 lần trong 10 phút cuối | Không người dùng nào | — |
| **F6** | Tín hiệu kiểm soát đã có | `governance_signals`, ngoại lệ, khai báo xung đột (S3) | Hàng có sẵn: `PURCHASE_SPLITTING`, `ESTIMATE_UNDERSTATED`, `INVITE_LIST_NARROWED`, `EARLY_CLOSE`; ngoại lệ `SINGLE_SOURCE`, `LIMITED_COMPETITION`, `LOW_ACTUAL_COMPETITION` | Không | `DO` khi có `ESTIMATE_UNDERSTATED` hay `INVITE_LIST_NARROWED`; `VANG` với các loại còn lại | Người gây ra đã ghi trên chính tín hiệu S3 | Tổ chức chưa bật S3 → `KHONG_AP_DUNG` |
| **F7** | Báo giá không đo được theo dòng | `bid_dong_tho` (spec S4 §2.5 ⒁) | Báo giá của N có tổng đọc được mà dòng hỏng (Σ `amount` ≠ `totalAmount`, hay dòng không đọc được) | Không | `DO` — trình duyệt của sản phẩm không sinh ra ca ấy | Không người dùng nào | — |
| **F8** | Ánh xạ lệch thuộc tính trích được | `rfq_item_mappings.dau_vao` của các dòng của X | Tỷ lệ dòng mà một thuộc tính trọng yếu trích được từ mô tả KHÁC thuộc tính của hàng chuẩn đã ánh xạ | Không | `DO` khi có ≥ 1 dòng như thế ghi bởi `NGUOI_DUYET`; `VANG` khi chỉ ở `TU_DONG` | Người ghi ánh xạ | Dòng chưa ánh xạ → không tính |

**[S1.157] Bảng trên giữ nguyên văn; bảng chịu lực là §4.1.**

**Ba luật chung.**
- **Bằng chứng** (`jsonb`) mang tỷ lệ, phân vị, số đếm, và định danh các gói và phiên bản báo giá đã dùng — KHÔNG một số tiền
  nào (ràng buộc 7). **[S1.157]** Định danh rõ chỉ trong CSDL, dưới RLS; bộ bằng chứng mang định danh băm có muối và thống kê
  cấp chuỗi (§2.5 ㊴ ⑸). Tập khoá của mỗi mã yếu tố là tập đóng (㊴ ⑴). *"g = 2,1%, phân tán 0,08, P10 toàn tổ chức 0,21, 9 gói"* là một bằng chứng; *"hạng 1: 1,20 tỷ"* thì
  không.
- **Độ tin cậy** không phải một xác suất. Nó là một trong ba giá trị `THAP` · `VUA` · `CAO`, suy từ độ dài chuỗi so với sàn
  (dưới 2× sàn → `THAP`). Một con số phần trăm ở đây sẽ đọc như xác suất gian lận.
- **Giải thích** là một câu mẫu có tham số, cố định theo phiên bản phương pháp, không phải văn bản sinh ra. Mẫu cho F1:
  *"Qua {n} gói có cùng {k} nhà cung cấp, khoảng cách giữa giá thắng và giá nhì dao động hẹp hơn {p}% các nhóm gói khác của
  tổ chức. Cạnh tranh thật thường cho khoảng cách dao động rộng. Đây là chỉ báo cần xem xét, không phải kết luận."*

**Vì sao F1, F2b không gắn người dùng nào.** Hai mẫu ấy nói về một NHÓM nhà cung cấp; chúng không chỉ ra người mua nào cả.
~~Chỉ F2a gắn với một người mời, và F8 với một người ánh xạ.~~ **[S1.157]** Câu vừa gạch sai: F6 cũng gắn người — người gây
ra đã ghi trên tín hiệu S3 —, và với ánh xạ `TU_DONG`, F8 gắn người kích hoạt chuẩn hoá, người mà spec S4 §4.4 nói *"không
chịu lực"* (góc A⑪). Sau §2.4 ㉖: F2a rời sang S4b.5; F6, F8, F11 gắn người qua bảng con ㉟, và không màn nào ở cổng
`bid.view` hiện tên ấy. Sự bất đối xứng ấy có chủ ý: yếu tố gắn tên một nhân viên là yếu
tố gây hại nhất khi sai (§12.1).

### 4.1. [S1.157] Danh mục yếu tố chịu lực

Phiên bản phương pháp `RUI_RO_V1` (S4b.1) và `RUI_RO_V2` (S4b.2) có CÙNG tập mã và cùng trọng số; chúng chỉ khác ở mã nào mang
`CHUA_CAI`. Đổi phép tính của một yếu tố là một phiên bản mới — nếu không, tính lại một đánh giá cũ bằng mã mới ra kết quả
khác (L10). **Trạng thái** thêm `CHUA_CAI`. Cột *Độ phủ* ghi yếu tố có vào độ phủ không (§2.5 ㉚). *Lớp* là lớp as-of của
§2.5 ㊲. Mọi ngưỡng và sàn là **GIẢ ĐỊNH**.

| Mã | Tên trên màn | Lớp | Phép tính | Sàn | Mức | Người gây ra (㉟) | Độ phủ | Có mã ở |
|---|---|---|---|---|---|---|---|---|
| **F1** | Khoảng cách thắng–nhì ổn định bất thường | Thước + sự kiện X | Chuỗi = gói có ≥ 2 nhà cung cấp chung với X (lời mời còn sống tại mốc) trong 12 tháng tới mốc. Mỗi gói: g = (EC hạng 2 − EC hạng 1)/EC hạng 1 theo hạng `gia`, trên lượt chấm `rfq_awards.evaluation_id`; đồng hạng 1 ⇒ g = 0. Trên chuỗi: trung vị g và MAD của g theo điểm phần trăm (㊻) | ≥ 6 gói trong chuỗi | Ngưỡng TUYỆT ĐỐI: `DO` khi trung vị g < 1% VÀ MAD < 0,5 điểm; `VANG` khi trung vị g < 2% VÀ MAD < 1 điểm. Phân vị của nền tổ chức chỉ hiện làm bối cảnh, không quyết định mức: so với chính tổ chức thì ≈ 10% chuỗi trung thực ra `DO` theo cấu tạo, và yếu tố mù khi cartel chính là quần thể (góc D⑦, C⑦) | Không ai | Có · 20 | S4b.2 |
| ~~**F2a**~~ | — | — | Rời sang S4b.5, chờ E7 và Q2 (㉖). Khi vào: phân tầng theo nhóm hàng (nghịch lý Simpson, góc C④) | — | — | Người mời | Có · 10, từ phiên bản phương pháp của S4b.5 | S4b.5 |
| **F2b** | Mẫu luân phiên thắng | Thước | Như §4, *"chen chân"* = có lời mời còn sống tại mốc | ≥ 9 gói trong chuỗi | `DO` khi luân phiên đều trên ≥ 12 gói; `VANG` trên 9–11 gói (㊼) | Không ai | Có · 15 | S4b.2 |
| **F3** | Giá thắng lệch khỏi dải nội bộ | Thước (nhãn tại mốc) · sự kiện X (phiên bản được đề xuất) | Như §4, trên phiên bản ĐƯỢC ĐỀ XUẤT, kể cả BAFO | Độ phủ benchmark ≥ 50% giá trị dòng | Như §4 | Không ai | Có · 15 | S4b.1 |
| **F4** | Tập trung nhà cung cấp | Thước | Như §4, *"chen chân"* = được mời | ≥ 8 gói trong nhóm | Như §4 | Không ai | Có · 5 | S4b.2 |
| **F5** | Nhịp nộp và sửa sát hạn | Sự kiện X | Như §4, với hạn của VÒNG chứa phiên bản được đề xuất; bằng chứng ghi cặp nhà cung cấp | Không | Như §4 | Không ai | Không · 10 | S4b.1 |
| **F6** | Tín hiệu kiểm soát đã có | Sự kiện X | Như §4, cộng đủ năm loại ngoại lệ (㊸); tín hiệu tính lúc đề xuất ghi trước đánh giá | Không | Như §4. Ghi nhận K10 hợp lệ của cùng tín hiệu thoả vế ghi nhận (㊸) | Người gây ra trên tín hiệu | Không · 10 | S4b.1 (sau S3.6) |
| **F7** | Báo giá không đo được theo dòng | Sự kiện X | Như §4, trên phiên bản được đề xuất | Không | Như §4 | Không ai | Không · 5 | S4b.1 |
| **F8** | Ánh xạ lệch thuộc tính trích được | Sự kiện X | Như §4; đọc cả ánh xạ ghi sau mốc, gắn `SAU_MOC`. Dòng thiếu thuộc tính trọng yếu mà vẫn ánh xạ `NGUOI_DUYET` → `VANG` (góc C⑨) | ≥ 2 dòng lệch, hoặc ≥ 20% số dòng | `DO` khi vượt sàn với ≥ 1 dòng `NGUOI_DUYET`; `VANG` khi chỉ `TU_DONG` hay dưới sàn | Người ghi ánh xạ; người viết mô tả dòng. KHÔNG hiện tên ở `bid.view` (㉖) | Không · 10 | S4b.1 (sau S4.3) |
| **F9** | Phân bổ giá lệch giữa các dòng | Sự kiện X | Với mỗi dòng của N: tỷ phần giá trị dòng trong tổng của N, chia cho trung vị tỷ phần của dòng ấy ở các báo giá đọc được khác của X. Bằng chứng: số dòng, số dòng có tỷ số ≥ 2 hay ≤ 0,5, tỷ số lớn nhất — không một tỷ phần nào | ≥ 3 báo giá đọc được theo dòng | `DO` khi ≥ 30% giá trị của N nằm ở dòng có tỷ số ≥ 2; `VANG` khi ≥ 10% | Không ai | Không · 10 | S4b.1 |
| **F10** | Cạnh tranh thực tế | Sự kiện X | Số báo giá đọc được / số lời mời còn sống tại hạn | Không | `DO` khi 1 báo giá đọc được; `VANG` khi 2 (㉗) | Không ai | Không · 10 | S4b.1 |
| **F11** | Đề xuất–huỷ–đề xuất lại | Sự kiện X | Số đề xuất trao của X đã huỷ trước đề xuất này; và đề xuất đã huỷ gần nhất có làm S4b.1 nổ không | Không | `DO` khi ≥ 2 lần huỷ, hoặc đề xuất trước nổ mà đề xuất này không; `VANG` khi 1 lần huỷ (㊷) | Người đề xuất và người huỷ các đề xuất ấy | Không · 5 | S4b.1 |
| **DO_PHU** | Độ phủ dữ liệu thấp | — | Hàng giả do trigger sinh khi độ phủ < 60% (㊱) | — | `DO` | Không ai | — | S4b.1 |

Tập mã của `RUI_RO_V1` và `RUI_RO_V2`: F1, F2b, F3, F4, F5, F6, F7, F8, F9, F10, F11 — mười một yếu tố; F1, F2b, F4 mang
`CHUA_CAI` ở `RUI_RO_V1`. Ở tổ chức trong phạm vi ㉙ mọi yếu tố đều áp dụng được về nguyên tắc; `KHONG_AP_DUNG` còn cho F1
(một báo giá), F4 (gói không nhóm hàng), F9 (dưới ba báo giá theo dòng) — và không bao giờ làm tăng độ phủ.

---

## 5. Risk Score và S4b.1 — không duyệt một chạm

### 5.1. Tổng hợp

Trọng số là khoá `rui_ro` (`jsonb`) trên phiên bản chính sách, ghim lúc gói vào `OPEN` (spec S4 §2.4 ⑸). Mặc định GIẢ
ĐỊNH, theo thứ tự sức mạnh tín hiệu:

| F1 | F2a | F2b | F3 | F4 | F5 | F6 | F7 | F8 |
|---|---|---|---|---|---|---|---|---|
| 20 | 10 | 15 | 15 | 5 | 10 | 10 | 5 | 10 |

**[S1.157]** Bảng trên sai ở hai chỗ: F2a rời (㉖), và thiếu F9, F10, F11 (㊽). Trọng số mặc định của phương pháp — GIẢ ĐỊNH;
không còn đòi tổng bằng 100, vì điểm là trung bình có trọng số:

| F1 | F2b | F3 | F4 | F5 | F6 | F7 | F8 | F9 | F10 | F11 |
|---|---|---|---|---|---|---|---|---|---|---|
| 20 | 15 | 15 | 5 | 10 | 10 | 5 | 10 | 10 | 10 | 5 |

- Điểm yếu tố: `XANH` 0 · `VANG` 50 · `DO` 100.
- ~~**Độ phủ** = Σ trọng số của yếu tố `CO_DU_LIEU` / Σ trọng số của yếu tố không `KHONG_AP_DUNG`. Yếu tố `KHONG_AP_DUNG` ra
  khỏi cả tử lẫn mẫu, vì điều kiện của nó vắng trên gói và một yếu tố khác bắt đúng ca ấy (cột *vắng* ở §4).~~
  **[S1.157]** Độ phủ theo §2.5 ㉚: chỉ yếu tố có lịch sử, trên trọng số của PHƯƠNG PHÁP; yếu tố vắng không bao giờ ra khỏi
  mẫu. Câu *"một yếu tố khác bắt đúng ca ấy"* chỉ đúng cho F1, và yếu tố bù được gọi tên (F6) không bắt (góc C①).
- **Điểm** = làm tròn nửa-ra-xa-0 của Σ (trọng số × điểm yếu tố) / Σ trọng số, trên các yếu tố `CO_DU_LIEU`. Số nguyên
  0–100, tính trên `bigint` (~~khuôn ADR-052~~ **[S1.157]** luật làm tròn là ADR-050 ⑴; ADR-052 là *"làm tròn từng thành phần
  rồi cộng"* — cùng lỗi trích mà spec S4 đã gạch). **[S1.157]** Trọng số dùng cho điểm là trọng số của phiên bản chính sách
  ghim, mỗi trọng số ≥ sàn (㊵); điểm do CSDL tính (㉜) và CHỈ để hiển thị (㉗).
- **Mức**: độ phủ < 60% → `KHONG_XAC_DINH`. Ngược lại: điểm ≥ 60 → `CAO`; ≥ 30 → `VUA`; còn lại `THAP`. **Và một yếu tố `DO`
  bất kỳ đẩy mức lên tối thiểu `VUA`** — một yếu tố đỏ không được trung bình hoá cho mất. **[S1.157]** Đẩy nhãn lên `VUA`
  không đổi CHỐT (góc C②); chốt nổ theo ㉗. 60% và 60/30 là hằng của phiên bản phương pháp (㉘), không phải khoá của
  `rui_ro`. Không có `DO` thì điểm không vượt 50, nên mức `CAO` luôn kéo theo ít nhất một `DO`.

Chữ trên màn luôn đi cùng độ phủ: *"42/100 · VỪA · trên 70% trọng số có dữ liệu · chỉ báo cần xem xét"*. Một điểm không có độ
phủ đi kèm là một lỗi hiển thị, và vòng quét route (§11) bắt nó.

### 5.2. Chốt S4b.1

Chữ ký duyệt trao thầu cho một gói mà đánh giá rủi ro của đề xuất ~~ở mức `CAO` hay `KHONG_XAC_DINH`~~ **[S1.157]** làm chốt
nổ — có ≥ 1 yếu tố `DO` hoặc mức `KHONG_XAC_DINH` (㉗), ở tổ chức đã bật S3 (㉙) — cần đủ bốn thứ:
1. MFA trong cửa sổ 15 phút, qua `assertFreshMfa`;
2. giải trình không rỗng của người ký;
3. một hàng ghi nhận cho MỖI yếu tố `DO`, và cho hàng *độ phủ* khi mức là `KHONG_XAC_DINH`, do một người giữ `po.approve`
   nằm ngoài ~~{người tạo gói, người gây ra yếu tố ấy, người đề xuất, người duyệt}~~ **[S1.157]** tập §2.5 ㉞; hàng độ phủ là
   `DO_PHU` (㊱);
4. đánh giá rủi ro là ~~bản MỚI NHẤT của đề xuất ấy~~ **[S1.157]** ĐÚNG MỘT đánh giá của hàng `PROPOSED` ấy, ghi cùng giao dịch
   (㉛), và tính lại từ đầu vào as-of đã lưu ra đúng điểm và mức.

**Chỗ ở của từng vế.** Vế ① ở tầng gói, cùng chỗ với D1 của mở thầu: `app_api` được cấp `UPDATE (mfa_verified_at)` (`006`),
nên một kiểm ở trigger chỉ mạnh ngang ứng dụng. Vế ②③ ở một trigger RIÊNG trên bảng chữ ký trao — khuôn `014` §(4), dựng
trên cổng trao thầu của S3.5, không viết lại thân ghim. ~~Vế ④ ở tầng gói: lõi tính điểm là TypeScript (ràng buộc 8), nên CSDL
không tính lại được. Giới hạn ấy nói ra, cùng lớp với J2: một ứng dụng hỏng ghi được mức `THAP`, và thứ bắt nó là phép tái
lập trên bộ bằng chứng, không phải một trigger.~~

**[S1.157] Đoạn vừa gạch đặt sai ba vế.** Trigger L11 nằm trên `rfq_award_approvals` và tính lại luật nổ, giải trình và người
ở MỖI chữ ký, dưới cùng khoá với đường ghi nhận (㉝). Phép tổng hợp — điểm, độ phủ, mức, luật nổ — tính được ở CSDL từ các
hàng yếu tố, nên CSDL tính (㉜). Chỉ MỨC TỪNG YẾU TỐ còn ở lõi TypeScript: một ứng dụng hỏng ghi được một yếu tố `XANH` thay
cho `DO`, và thứ bắt nó là phép tái lập ở tầng gói lúc ký và trên bộ bằng chứng. Một kiểm `mfa_verified_at IS NOT NULL` ở
trigger (khuôn `011` H-2) vẫn bắt được ca QUÊN gọi `assertFreshMfa` khi S3.5 dựng lại cổng trao, dù không mạnh hơn ứng dụng.

**Hệ quả về người**, cộng vào spec S4 §7.1: một gói ~~ở mức `CAO` hay `KHONG_XAC_DINH`~~ **[S1.157]** làm chốt nổ cần ít nhất
~~HAI người~~ **[S1.157]** (số chữ ký của bậc + 1) người giữ `po.approve`
ngoài người đề xuất — ~~một người duyệt, một người ghi nhận~~ người ký theo bậc, cộng một người ghi nhận. Ở tổ chức mới, đó là MỌI gói. ~~`gieo:demo` có hai `DIRECTOR`, đủ.~~
**[S1.157]** `gieo:demo` có hai `DIRECTOR`, không `FINANCE` (`tools/gieo-demo/src/index.ts:142-150`): đủ ở bậc một chữ ký,
THIẾU ở bậc 2 của S3 — nơi kịch bản V2.1 §41 (gói 1 tỷ) rơi vào. Dữ liệu gieo cho tổ chức đã bật S3 cần thêm một người giữ
`po.approve`. Theo ㉙, không tổ chức MVP1 nào chịu điều này, và **không ca nào của MVP1 lật**: bước 12i của
`kich-ban-41-http.int.test.ts:1217`, các lời gọi `duyetTraoThau` của `luot-danh-gia.int.test.ts`, `bo-xuat.int.test.ts:288` và
bước 7 của `mo-thau.js:451-463` chạy trên tổ chức chưa bật S3, và phải xanh nguyên văn khi S4b.1 đã triển khai. Ca bị lật chỉ
nằm trong bộ test của S3.5 ở tổ chức đã bật S3 — kê tên khi S3.5 có mã.

### 5.3. Bản chụp

Đánh giá rủi ro lưu cùng đề xuất trao: điểm, mức, độ phủ, phiên bản phương pháp, `policy_id`, mốc mở giá, và một hàng cho mỗi
yếu tố với đủ năm trường. Supplier Score của N chụp vào cùng bản ghi. Bộ bằng chứng (ADR-059) mang cả hai, cộng một đặc tả
phép tính trong `DAC-TA.md` đủ để cài lại chín yếu tố và phép tổng hợp — khuôn S2.7.

**[S1.157]** Ba sửa. ⑴ Cột bản chụp Supplier Score có từ S4b.1 và là `NULL` tới S4b.4. **[S1.158]** Không dựng cột ấy ở S4b (Q1). ⑵ Lõi của lớp rủi ro trong bộ bằng
chứng và mục `DAC-TA.md` cho các yếu tố đã có mã đi cùng S4b.1, không đợi S4b.7 — nếu không, từ S4b.1 tới S4b.7 không lớp nào
bắt được một yếu tố bị hạ (góc A②, D②). ⑶ Lớp ấy mang định danh băm có muối và thống kê cấp chuỗi (㊴ ⑸).

---

## 6. Sổ tín hiệu — phần *"phát hiện bất thường"*

V2.1 §20 kể sáu loại bất thường. ~~S4b phủ bốn, qua yếu tố của §4, và nói thẳng hai loại còn lại:~~ **[S1.157]** Bảng dưới có
năm loại có nguồn và một loại *"Không"*; *"phủ"* nghĩa là có một yếu tố đo MẪU ĐỀU ĐẶN của loại ấy, trong giới hạn §12.6. Buyer
anomaly chờ S4b.5 (㉖):

| Loại của V2.1 §20 | S4b phủ bằng | Ghi chú |
|---|---|---|
| Price anomaly | F3, cộng nhãn benchmark của S4a | — |
| Supplier anomaly — thắng bất thường | F2b, F4 | — |
| Buyer anomaly | F2a, cộng §8 | Chờ câu hỏi pháp lý. **[S1.157]** Cả F2a — S4b.5 |
| Purchase splitting | F6 (tín hiệu S3) | S4b không tính lại |
| Specification anomaly | **Không** | Kho không lưu lịch sử sửa hạng mục ở `DRAFT` (spec S4 §10) |
| Collusion pattern | F1, F2b, F5 | Mẫu giữa các nhà cung cấp; mẫu Buyer–Supplier Network là §18, ngoài S4. **[S1.157]** Cộng F9, F10, F11; chỉ mẫu đều đặn (§12.6) |

**Sổ tín hiệu** là một màn đọc, không phải một job: người giữ `audit.read` chọn một khoảng thời gian, và hàm as-of tính các
yếu tố F1, F2a, F2b, F4 trên MỌI chuỗi gói của tổ chức trong khoảng ấy — không chỉ trên gói có đề xuất trao. Kết quả là một
danh sách *"chuỗi gói cần xem xét"*, mỗi dòng mang năm trường. Không dòng nào được lưu cho tới khi một người ghi nhận nó —
lúc ấy một hàng `risk_register_acks` ghi người, lý do và bằng chứng as-of tại lúc ghi nhận.

**[S1.157]** Bốn sửa. ⑴ F2a rời sổ tới S4b.5 (㉖). ⑵ *"Người giữ `audit.read`"* là `FINANCE`, `DIRECTOR` — chính người đã
đề xuất và ký các trao trong chuỗi; ai đọc là Q2 (§2.6). ⑶ Khung, lượt đọc, người ghi nhận và việc dòng đã ghi nhận vẫn hiện
theo §2.5 ㊿. ⑷ Không gì buộc ai mở sổ: một chuỗi đã trao xong không bao giờ chạm S4b.1 nữa. Sổ là công cụ cho người muốn
xem, không phải một chốt.

Lý do không lưu trước: một bảng *"các nhà cung cấp bị gắn cờ"* được lưu tự động là đúng hình dạng danh sách đen mà PRODUCT
§5 cấm — một danh sách không ai kiểm mà mọi người đọc như kết luận.

---

## 7. Supplier Score

**[S1.158] Cả mục này hoãn tới S5 (Q1, ADR-098).** Giữ nguyên văn làm đầu vào cho spec S5, cùng các sửa của §2.5 ㊾.

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
  chối ~~lúc chấm~~, bằng một mã gọi tên — cùng chỗ spec S4 §2.5 ⒃ đặt chốt TCO. Bộ mặc định: **Q1**. **[S1.157]** Supplier Score
  không tính ở lượt chấm, nên *"lúc chấm"* không có nghĩa; từ chối lúc GHI phiên bản chính sách, bằng `CHECK` dạng khẳng định
  (㊵) — đúng chỗ spec S4 §5 đặt L9 (góc A⑩).
- **[S1.157] Bốn thành phần có nguồn đều là cần gạt** (góc C⑧) — sửa theo §2.5 ㊾. Q1 (§2.6) có thêm một lý do cho lối ⒞.
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
chính nó thành công cụ giám sát không ai giám sát. Khác với bảng so sánh (khoản 244), ở đây lời khai *"mọi lần đọc có sổ"* là
một bất biến có phép đo (L19).

**[S1.157]** Hàng sổ mang cả ĐỐI TƯỢNG bị xem, và được ghi theo §2.5 ㊹: route `POST`, ghi ở cuối handler, ghi hỏng thì không
trả dữ liệu — không có tiền lệ ghi sổ khi đọc thành công, và GET không được đổi trạng thái. Người đọc giữ `audit.read` cũng là
người bị phân tích ở ma trận *Duyệt*: Q2 (§2.6).

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
| [REQUEST REVIEW] | **Q4** — **[S1.158]** bỏ | — |

Màn là một trang mới trong bản đồ `TRANG`, dưới luật ADR-044, cho người giữ `bid.view`. Nó chỉ ĐỌC: không hành vi nào của nó
là mới, trừ nút của Q4.

**[S1.157] Bốn nguồn trong bảng trên sai** (góc A⑫). *Value*: ước lượng nằm ở `rfq_budgets.estimated_value` (`014:109`), không
ở `rfq_packages`. *Technical qualified*: lượt chấm từ chối mọi chính sách khác đúng một mã `gia`/`TIEN`
(`luot-danh-gia.ts:156-163`), nên S2 không chấm điểm phi giá — kết luận *"chưa có nguồn"* vẫn đúng. *Price Benchmark*: S4a chỉ
có nhãn theo dòng và độ phủ theo báo giá, không có nhãn tổng hợp; màn hiện số dòng theo từng nhãn, và không dùng chữ *NORMAL*
của V2.1 (spec S4 ㉔). *Recommended Supplier* là đề xuất của NGƯỜI, không phải V2.1 §22 *Award Recommendation* (§16). Màn có
đường dẫn `/tong-quan` và trạng thái *"chưa mở niêm phong"* cho gói trước mở thầu — khi ấy chỉ hiện RFQ, Value, Suppliers và
Policy Compliance (㊺).

### 9.2. Các màn khác

| Màn | Hạng mục | Vai |
|---|---|---|
| `/mo-thau` bước đề xuất và duyệt trao: đánh giá rủi ro, yếu tố, ô ghi nhận, giải trình | S4b.1, S4b.2 | `award.recommend`, `po.approve` |
| `/so-tin-hieu` (mới): sổ tín hiệu | S4b.3 | `audit.read` |
| Hồ sơ nhà cung cấp phía bên mua: Supplier Score | S4b.4 | `bid.view` |
| `/phan-tich` (mới): phân tích người mua | S4b.5 | Q2 |

~~Mỗi route mới khai `agent: false` (ADR-039): không đầu ra nào của S4b đi qua MCP.~~

**[S1.157]** Câu vừa gạch sai với route GHI (§2.5 ㊺). Ba sửa nữa: ⑴ người giữ `award.recommend` mà không giữ `bid.view` —
`BUYER` (`005:290-293`) — không xem được đánh giá; cổng đọc là `bid.view` như §10 và T2. ⑵ *"Hồ sơ nhà cung cấp phía bên mua"*
chưa có trong bản đồ `TRANG` (`phuc-vu.ts:92-110`) và không hạng mục nào dựng nó: S4b.4 dựng nó, hoặc gắn vào màn của S3.8 nếu
S3.8 dựng trước — đối chiếu lúc mở S4b.4. ⑶ Danh sách route:

| Route | Loại | Cổng | `agent` |
|---|---|---|---|
| GET `/rfqs/:id/rui-ro` — đánh giá của đề xuất đang sống | Đọc | `bid.view` | `false` |
| POST `/rfqs/:id/award/:awardId/rui-ro/ghi-nhan` — ghi nhận một yếu tố | Ghi | `po.approve` | không khai |
| POST `/rfqs/:id/award/:awardId/approve` — thêm giải trình vào thân yêu cầu hiện có | Ghi | `po.approve` | không khai |
| GET `/tong-quan` — màn Executive | Đọc | `bid.view` | `false` |
| POST `/so-tin-hieu/doc`, POST `/so-tin-hieu/ghi-nhan` | Ghi (đọc có sổ, ㊹) | Q2 — **[S1.158]** `analytics.review` | không khai |
| POST `/phan-tich/doc` | Ghi (đọc có sổ, ㊹) | Q2 — **[S1.158]** `analytics.review` | không khai |
| **[S1.158]** GET `/toi/luot-doc` — lượt đọc về chính mình (Q2) | Đọc, tự thân | người dùng mua đã đăng nhập | `false` |
| ~~GET `/nha-cung-cap/:id/diem`~~ **[S1.158]** bỏ — Q1 | Đọc | `bid.view` | `false` |

Đọc có tên nhân viên đi route `POST` có sổ, không GET (㊹). Trang `/mo-thau` ở bước duyệt nói rõ luồng *"đăng nhập lại để có MFA
mới"* (㊺).

---

## 10. Mô hình dữ liệu

Mọi bảng theo tổ chức, chỉ-ghi-thêm, khuôn khoá tư vấn → `seq` → `ghi_luc` của spec S4 §2.5 ⑿, policy khách `RESTRICTIVE`.

| Bảng | Giữ gì |
|---|---|
| `rfq_risk_assessments` | ~~Một hàng cho mỗi lần tính trên một đề xuất trao~~ **[S1.157]** Đúng một hàng cho một hàng `PROPOSED` (㉛): `award_id`, `bid_version_id`, `policy_id`, `phien_ban_phuong_phap`, `moc_mo_gia`, **[S1.157]** `moc_de_xuat`, `diem`, `muc`, `do_phu`, **[S1.157]** `co_no`, ~~bản chụp Supplier Score (`NULL` tới S4b.4)~~ **[S1.158]** không có bản chụp Supplier Score (Q1), tác giả + phiên |
| `rfq_risk_factors` | Một hàng mỗi yếu tố: `ma`, `trang_thai`, `muc`, `trong_so`, `nguon`, `thoi_diem`, `bang_chung jsonb`, `do_tin_cay`, `giai_thich`, ~~`nguoi_gay_ra uuid[]`~~. `CHECK`: `bang_chung` không mang khoá nào trong tập tên trường tiền đã khai (`tien`, `gia`, `so_tien`, `amount`, `unitPrice`, `totalAmount`). **[S1.157]** Người gây ra là bảng con (㉟); `CHECK` là lược đồ đóng theo mã cộng dây bẫy không phân biệt hoa thường (㊴); `giai_thich` là (mã mẫu, tham số) |
| `rfq_risk_factor_inputs` | Bảng con khoá ngoại tới mọi gói và phiên bản báo giá mà yếu tố đã đọc — để tái lập (khuôn spec S4 §2.5 ⑿). **[S1.157]** Đa hình theo nguồn, `num_nonnulls = 1` (㊳) |
| **[S1.157]** `rfq_risk_factor_causers` | Người gây ra: `(org_id, factor_id, user_id)`, khoá ngoại hợp thành tới `users`, trigger suy từ bảng đầu vào (㉟) |
| **[S1.157]** `rfq_risk_nen` | Ảnh chụp nền tổ chức theo (tổ chức, nhóm hàng, mốc): mẫu số của F4 và phân vị bối cảnh của F1; chỉ-ghi-thêm, dùng chung (㊳). S4b.2 |
| `rfq_risk_acks` | Ghi nhận: `factor_id`, người + phiên, lý do không rỗng. **[S1.157]** `factor_id` trỏ được hàng `DO_PHU` (㊱); trigger kiểm người theo ㉞ dưới khoá ㉝ |
| `rfq_award_justifications` | Giải trình của người ký ở mức `CAO`/`KHONG_XAC_DINH`; tách khỏi `rfq_award_approvals` để không đổi hình dạng bảng của `061`, thứ S3.5 đang dựng lại |
| `risk_register_acks` | Ghi nhận một dòng của sổ tín hiệu: loại, bằng chứng as-of, người, lý do |

Nhóm khoá mới trên phiên bản chính sách: `rui_ro` (trọng số, ngưỡng mức, ngưỡng độ phủ), `diem_ncc` (trọng số thành phần,
sàn). Cả hai đi dưới luật thứ tự của spec S4 §2.5 ⒆: sau S3.1, đọc qua `chinh_sach_tai`.

**Quyền.** Không mã quyền mới — nguyên tắc ADR-084 ⑴. Đọc đánh giá rủi ro, Supplier Score, màn Executive: `bid.view`. Ghi
nhận yếu tố: `po.approve`. Sổ tín hiệu: `audit.read`. Phân tích người mua: Q2. **[S1.157]** Ở cổng `bid.view` không hiện tên
người gây ra (㉖). Sổ tín hiệu: Q2 — lượt soi đề xuất một mã mới, đúng tiêu chí tách người của ADR-084 ⑴ (§2.6). **[S1.158]** Chốt: một mã mới
`analytics.review`, chỉ vai `AUDITOR` giữ, cho sổ tín hiệu và phân tích người mua (§2.7 Q2).

### 10.1. [S1.157] Cưỡng chế ở CSDL

Gom các chốt của §2.5 theo bảng. Mọi trigger mới ENABLE ALWAYS, ghim ở `hardening.always.sql` trong cùng commit với migration.

| Chỗ | Làm gì | Chốt |
|---|---|---|
| `rfq_risk_assessments` BEFORE INSERT | Hàng award là `PROPOSED`, `acted_at = transaction_timestamp()`, tác giả = `acted_by`, tổ chức trong phạm vi ㉙; đặt `moc_mo_gia`, `moc_de_xuat`, `policy_id`, `bid_version_id`; `phien_ban_phuong_phap` thuộc hàm khai | ㉙㉛㉜ |
| `rfq_risk_assessments` deferred | Tập mã yếu tố = tập của phiên bản phương pháp; tính `diem`, `do_phu`, `muc`, `co_no`; sinh hàng `DO_PHU` khi độ phủ dưới hằng | ㉚㉜㊱ |
| `rfq_awards` deferred (CONSTRAINT TRIGGER mới, không sửa thân ghim) | Mỗi hàng `PROPOSED` của tổ chức trong phạm vi có đúng một đánh giá lúc COMMIT | ㉛ |
| `rfq_risk_factor_causers` BEFORE INSERT | Người = người suy từ bảng đầu vào; ứng dụng không khai | ㉟ |
| `rfq_risk_acks` BEFORE INSERT | Khoá tư vấn `hashtextextended(rfq_id::text, 1)`; người giữ `po.approve`, còn ACTIVE, ngoài tập ㉞ tính tại lúc ấy; yếu tố ở mức `DO` | ㉝㉞ |
| `rfq_award_justifications` BEFORE INSERT | Người = người của phiên; khoá ngoại `(org_id, award_id)` | ㉝ |
| `rfq_award_approvals` BEFORE INSERT — trigger L11, tên xếp sau `rfq_award_approvals_kiem_nguoi_duyet` | Cùng khoá; đánh giá tồn tại; `co_no` tính lại từ hàng yếu tố; nổ thì đòi giải trình của người ký và ghi nhận của mọi hàng `DO` bởi người ngoài ㉞ tính TẠI LÚC KÝ; `mfa_verified_at IS NOT NULL` của phiên; mã lỗi riêng | ㉝㉞ |
| `org_procurement_policies.rui_ro` `CHECK` | Dạng khẳng định; trọng số chuỗi số nguyên ≥ sàn; NULL ⇒ mặc định của phương pháp | ㊵ |
| `bang_chung`, bản chụp Supplier Score, `risk_register_acks` `CHECK` | Lược đồ đóng theo mã; dây bẫy tập khoá tiền không phân biệt hoa thường | ㊴ |

**Các cổng sẽ đỏ nếu quên** (góc B⑫): mọi `CHECK` mới vào `CHECK_AN_NINH_KHAI` hoặc `MIEN_TRU`; mọi bảng chỉ-ghi-thêm có
`bid_chi_ghi_them` và trigger chặn `TRUNCATE` cấp câu lệnh, không `WHEN`, ENABLE ALWAYS (khuôn `047`, `061:336-352`); `id`
ngoài GRANT INSERT (`061:319-325`); trigger mới vào ghim và vào sàn `SAN_SO_TRIGGER`
(`ghim-trigger-tu-chua.int.test.ts:58`); CONSTRAINT TRIGGER đi qua mục riêng của hardening (`hardening.always.sql:1536-1541`);
mỗi bảng tự viết policy `_khach` `RESTRICTIVE` (`057:104`; mẫu `061:315-317`).

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
mới, không hậu tố (khoản 245).

### 11.1. [S1.157] Bảng bất biến chịu lực

Bảng trên giữ nguyên văn. Nó sai ở bốn chỗ (góc D⑥, A⑩): L10 và L11 dựa vào bảng đầu vào và phép tổng hợp mà bảng trên để ở
S4b.2, trong khi L11 ở S4b.1; L16, L18, L20, L21 đo được — và phải đo — từ S4b.1, vì bảng, route và `/mo-thau` có từ S4b.1;
L20 cấm mọi INSERT ngoài đường đề xuất và ghi nhận, trong khi giải trình ghi ở đường ký; L9 dời chỗ cưỡng chế khỏi `CHECK`
phiên bản mà không đánh dấu. Tách theo luật *"mỗi nửa một số"* của spec S4 §5 — số mới, không hậu tố.

| Mã | Mệnh đề | Cưỡng chế | Hạng mục |
|---|---|---|---|
| **L9** | Như bảng trên; phiên bản khai trọng số cho thành phần không có nguồn bị từ chối LÚC GHI phiên bản | `CHECK` dạng khẳng định trên phiên bản (㊵) + lõi thuần + test tái lập | ~~S4b.4~~ **[S1.158]** S5 (Q1) |
| **L10** | Mỗi đánh giá có đủ hàng yếu tố của phiên bản phương pháp, mỗi hàng năm trường; `diem`, `do_phu`, `muc`, `co_no` do CSDL tính từ hàng yếu tố; độ phủ theo ㉚; tính lại từ bảng đầu vào ra đúng bản lưu cho mọi yếu tố KHÔNG phải chuỗi (F3, F5–F11) | Deferred trigger (㉜); lõi thuần; test tái lập khuôn J2; đột biến bỏ một hàng yếu tố | S4b.1 |
| **L11** | Chữ ký trao ở đề xuất làm chốt nổ cần MFA mới, giải trình của người ký, và ghi nhận từng hàng `DO` — kể cả `DO_PHU` — bởi người giữ `po.approve` ngoài tập ㉞ tính tại lúc ký; đề xuất có đúng một đánh giá ghi cùng giao dịch; chỉ ở tổ chức đã bật S3 | Trigger trên `rfq_award_approvals` (㉝), deferred trên `rfq_awards` (㉛), vế MFA và tái lập ở tầng gói; đo cả ca song song của M8 | S4b.1 |
| **L16** | Không hàng yếu tố, không bằng chứng, không bản chụp, không bộ bằng chứng nào của S4b mang một số tiền, hay đủ để suy ra giá của gói khác | Lược đồ đóng + dây bẫy (㊴); bước 14 kịch bản 41 quét các bảng S4b bằng kim đơn giá và kim tổng, chạy sau bước 12h — trên biến thể ở tổ chức ĐÃ BẬT S3, vì theo ㉙ tổ chức MVP1 không có đánh giá nào | S4b.1 |
| **L17** | THƯỚC đọc as-of `moc_mo_gia`, SỰ KIỆN VỀ X đọc as-of `moc_de_xuat` (㊲); ghi dữ liệu sau mốc rồi tính lại ra đúng bản lưu; ĐỐI CHỨNG DƯƠNG: cùng dữ liệu ghi TRƯỚC mốc thì kết quả đổi | Test hai chiều | S4b.1 (F3, F6, F8), S4b.2 (chuỗi) |
| **L18** | Như bảng trên, cộng: không đầu ra nào của S4b trước mở thầu ngoài bốn trường của ㊺; không tên người gây ra ở cổng `bid.view` | Vòng quét route khuôn A2/J4, có đối chứng dương | S4b.1 |
| **L19** | Mọi đường trả dữ liệu mang tên nhân viên để đúng một hàng sổ mang người đọc, khung và đối tượng; ghi sổ hỏng thì không trả dữ liệu. **[S1.158]** Đối tượng đọc được mọi hàng về chính mình qua route tự thân, và không đọc được hàng về người khác (Q2) | Test đếm hàng sổ; đột biến gỡ lần ghi; ca *"ghi sổ hỏng"*; **[S1.158]** ca tự thân và ca người khác | S4b.3 (đường đầu tiên), S4b.5 |
| **L20** | Mỗi bảng S4b chỉ có hàng từ đúng một đường: đánh giá, yếu tố, đầu vào, người gây ra — đường đề xuất trao, cùng giao dịch; ghi nhận — đường ghi nhận; giải trình — đường ký; `risk_register_acks` — đường ghi nhận sổ. Sổ tín hiệu không lưu dòng nào chưa có người ghi nhận | Trigger ㉛ ở CSDL cho vế *cùng giao dịch*; test kiến trúc cho phần còn lại | S4b.1 (vế CSDL), S4b.3 (sổ) |
| **L21** | Như bảng trên | Như bảng trên | S4b.1 |
| **L22** — mới, tách từ L10 | Yếu tố chuỗi (F1, F2b, F4) tính lại từ bảng đầu vào và ảnh chụp nền `rfq_risk_nen` ra đúng bản lưu; một đánh giá < 2 giây ở 5.000 gói, thời gian giữ khoá sổ của tổ chức trong lúc tính bằng 0 | Test tái lập; đo hiệu năng có biên bản | S4b.2 |
| **L23** — mới | Ngưỡng độ phủ, ngưỡng mức, luật nổ và `KHONG_XAC_DINH` ≡ `CAO` là hằng của phiên bản phương pháp; `rui_ro` chỉ mang trọng số, mỗi trọng số ≥ sàn; `rui_ro` NULL ⇒ mặc định của phương pháp | Hàm SQL `IMMUTABLE` khai phương pháp; `CHECK` dạng khẳng định; test: phiên bản đặt trọng số dưới sàn bị từ chối, phiên bản không có `rui_ro` vẫn đề xuất được | S4b.1 |
| **L24** — mới **[S1.158]** | Tổ chức mang dấu dữ liệu mẫu không bao giờ vào phép đo cổng (e), và mọi màn S4b của nó hiện nhãn *"dữ liệu mẫu"*; `app_api` không đặt và không gỡ được dấu ấy (Q8) | Dấu ngoài GRANT; test của công cụ đo trên một tổ chức mang dấu; vòng quét màn | S4b.0 (công cụ đo), S4b.6 (màn) |
| **L25** — mới **[S1.158]** | `analytics.review` chỉ ở vai `AUDITOR`; vai và người giữ nó không giữ `rfq.create`, `rfq.invite`, `award.recommend`, `po.approve`, `bid.view`, `policy.manage`, `item.manage` (Q2) | Hai trigger khuôn `033`; vòng quét route | S4b.3 |

---

## 12. Rủi ro

### 12.1. Báo động giả gắn tên người — rủi ro chi phối

Mọi yếu tố thống kê báo sai trên dữ liệu mỏng. Báo sai về một NHÓM nhà cung cấp (F1, F2b) tốn một lượt xem xét. Báo sai về một
NHÂN VIÊN (F2a, §8) tốn danh dự của một người có tên, và không lượt xem xét nào lấy lại được. Giảm bằng: F2a có sàn cao nhất
và cần hai điều kiện cùng lúc (gấp ≥ 3 lần VÀ chênh ≥ 30 điểm); chữ trên màn không bao giờ là *bất thường*; §8 chờ câu hỏi
pháp lý; mỗi lần đọc có sổ (L19).

**[S1.157]** Hai điều bản nháp chưa tính. ⑴ Báo sai trên nhóm nhà cung cấp cũng có tỷ lệ nền đo được: F2b như bản nháp báo
sai 4,1–12,3% ở chuỗi 6 gói dưới mô hình rỗng (M1), và F1 so với phân vị của chính tổ chức gắn cờ ≈ 10% chuỗi trung thực theo
cấu tạo (góc D⑦) — cả hai đã sửa (㊻㊼). ⑵ Yếu tố gắn tên trồng được: mô tả dòng do người tạo gói viết, nên chèn một thuộc tính
mâu thuẫn là trồng được F8 lên người ánh xạ (góc C④) — vì vậy F8 có sàn, người viết mô tả vào tập người gây ra, và không màn
`bid.view` nào hiện tên (㉖). F2a không phân tầng theo nhóm hàng thì một người mua chuyên đúng nhóm hàng mà N mạnh dễ bị gắn —
điều kiện khi F2a vào ở S4b.5.

### 12.2. Tổ chức nhỏ không bao giờ vượt sàn

Sàn của F1, F2a, F2b tính trên CHUỖI gói. Một tổ chức mua ít, hay mua mỗi thứ một lần, không bao giờ có chuỗi đủ dài. Với nó,
S4b mãi là `KHONG_XAC_DINH`, và S4b.1 mãi đòi ghi nhận. Đó là hệ quả trực tiếp của spec S4 §2.4 ⑼, và nó biến chốt thành thủ
tục — hình dạng spec S3 §8.2. Tỷ lệ ghi nhận theo tổ chức hiện ở màn quản trị; không ngưỡng nào ở đây được gọi là *đã hiệu
chỉnh* trước dữ liệu thật.

**[S1.157]** Tỷ lệ ghi nhận THEO TỔ CHỨC là 100% theo cấu tạo ở tổ chức mới, nên không mang tin; màn hiện tỷ lệ theo NGƯỜI
ghi nhận (góc C⑥). Không gì chứng minh người ghi nhận đã mở bằng chứng — cùng hình dạng khoản 244 —, và giải trình *"không
rỗng"* nhận cả một dấu chấm. S4b.1 buộc một người thứ hai KÝ TÊN vào việc đã đọc; nó không chặn hai người bàn nhau. Câu ấy
vào PRODUCT §5 khi S4b.1 có mã.

### 12.3. Lách bằng cách giữ yếu tố dưới sàn

Góc C⑥ của lượt soi S1.155 đã ~~đo~~ **[S1.157]** đọc (`security-reviews.md:12428, 12532`; phép đo là một mũi T5 chưa
chạy, spec S4 §6) đường này: rải gói qua nhiều người mời để mỗi cặp dưới sàn. F2a vì vậy không đứng một mình:
F1, F2b, F4 tính trên nhóm nhà cung cấp và nhóm hàng, không theo người mời, nên rải người mời không làm chúng mù. ~~Và dưới sàn
là `KHONG_XAC_DINH`, không phải `THAP`.~~ **[S1.157]** Câu vừa gạch sai với một yếu tố lẻ: một yếu tố dưới sàn chỉ hạ độ phủ.
Nó đúng cho gói khi các yếu tố có lịch sử cùng dưới sàn đủ để độ phủ < 60% (㉚). Chọn một nhóm hàng ít dùng ở `DRAFT` làm F1
và F4 dưới sàn — 25/55 trọng số —, nên độ phủ tối đa còn 30/55 ≈ 55%, và gói ra `KHONG_XAC_DINH`.

### 12.4. Goodhart

Khi người đề xuất thấy Risk Score (Q6), điểm thành một mục tiêu: chọn nhà cung cấp cho ra `THAP`, hay tách gói để chuỗi ngắn
lại. Phần sau đã có F6 (chia nhỏ). Phần trước là câu hỏi Q6. **[S1.157]** Q6 đã trả lời *"thấy"* (㊷): dò bằng đề xuất–huỷ để
lại dấu ở F11; chọn một nhà cung cấp cho ra ít `DO` hơn thì không yếu tố nào đo.

### 12.5. Hiệu năng

F1, F2b và sổ tín hiệu đọc chuỗi gói của cả tổ chức. Không job nền (ràng buộc 9) nghĩa là mọi phép tính chạy trong một request.
Ngưỡng GIẢ ĐỊNH: một đánh giá rủi ro < 2 giây ở 5.000 gói; sổ tín hiệu < 10 giây cho 12 tháng. Đo ở S4b.2 trên dữ liệu gieo,
có biên bản. Vượt ngưỡng thì lối thoát là một bảng tổng hợp chỉ-ghi-thêm theo gói — không mang tiền, nên không chạm ADR-054.

**[S1.157]** S4b.1 đã tính rủi ro trong giao dịch đề xuất, nên đo từ S4b.1 — cùng thời gian giữ khoá sổ của tổ chức (㊶). Ảnh
chụp nền `rfq_risk_nen` là đơn vị đầu vào ngay từ S4b.2, không chỉ là lối thoát (㊳).

### 12.6. [S1.157] S4b chỉ bắt mẫu đều đặn

Mọi yếu tố chuỗi đo sự ĐỀU ĐẶN (góc C⑦). Một nhóm biết phép tính — `DAC-TA.md` công bố đủ để cài lại — né được:
- F1: ngẫu nhiên hoá biên bọc lót; không tốn gì, vì người bọc lót không định thắng. Mời thêm một nhà cung cấp đệm chen vào hạng 2.
- F2b: chia thắng theo thị phần hay tung xúc xắc thay vì vòng tròn đều.
- F5: nộp cách nhau hơn 60 giây, trước hạn hơn 10 phút.
- F3: dồn phần thổi giá vào dòng chưa có benchmark — F9 bắt một phần, khi gói có ≥ 3 báo giá theo dòng.
- Huỷ sau mở niêm phong: người giữ `rfq.cancel` xoá một gói khỏi mọi chuỗi (gói `CANCELLED` ra khỏi quần thể, ⑾), và không yếu
  tố nào đếm việc ấy theo người huỷ — đó là phân tích nhân viên, chờ S4b.5.

Yếu tố không dựa vào đều đặn — người nộp nhiều lần mà không bao giờ thắng, vắng mặt có chọn lọc — là ứng viên cho một phiên
bản phương pháp sau, không thuộc `RUI_RO_V2`. Câu *"S4b chỉ ra mẫu đều đặn; một nhóm chủ ý ngẫu nhiên hoá biên và thứ tự thắng
không để lại tín hiệu nào S4b đo"* vào PRODUCT §5 khi S4b.2 có mã.

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

**[S1.157] Bổ sung** (góc D⑦): dữ liệu tổng hợp của T1 chỉ chứng minh cách người viết dựng quần thể, và bộ ca thiếu đối chứng
dương.
- **Test thuộc tính** bằng `fast-check` (đã có trong `package.json`), seed cố định: ghim tỷ lệ nền của F2b dưới mô hình rỗng
  (M1: ≈ 0,9–2,6% `VANG` ở 9 gói, ≈ 0,2% `DO` ở 12 gói) và sự tách của F1 theo số tuyệt đối (M2) như sự thật cấu trúc.
- **Test biến đổi**: nhân mọi giá với k thì mọi mức không đổi; hoán vị thứ tự các gói NGOÀI chuỗi thì không đổi; đồng hạng 1 cho
  g = 0.
- **T3 thêm**: ca *"đủ bốn vế thì ký được"* — không có nó, đột biến đổi điều kiện thành `TRUE` sống sót; đề xuất không có đánh
  giá (M7); đánh giá ghi ở giao dịch sau (M6); ghi nhận và ký song song bởi cùng một người (M8); D2 ghi nhận rồi ký với tư
  cách người thứ hai ở bậc hai chữ ký; ghi nhận K10 hợp lệ thoả F6 (㊸); tổ chức chưa bật S3 ký một chạm (㉙). Bỏ ca *"đánh giá
  không phải bản mới nhất"*: `UNIQUE` làm nó không tồn tại (㉛).
- **L16** đo thêm bằng một khoá tên khác (`Gia` lồng trong mảng) và một khoá ngoài lược đồ đóng; giải trình tự do là văn bản,
  nên nó KHÔNG thuộc L16 và nói ra như vậy.
- **L17** có đối chứng dương: cùng dữ liệu ghi TRƯỚC mốc thì kết quả đổi. Không có nó, L17 rỗng khi F1 luôn `CHUA_DU_LICH_SU`.
- **T5 ⑷** đo mũi đã hẹp lại (㉜): ứng dụng ghi một yếu tố `XANH` thay cho `DO`; phép tái lập lúc ký và trên bộ bằng chứng bắt nó.
- Mỗi hạng mục chạm `/mo-thau` có một lượt đi thử luồng ở khung 375×812 (luật spec S4 §2.3); điều kiện hoàn thành ghi *"trên
  giao diện"* như spec S3 §7 và spec S4 §7.1.

---

## 14. Điều kiện hoàn thành

**S4b.1 — chạy được TRƯỚC cổng (e):**

> Ở một tổ chức mới dựng — 0 gói lịch sử —, một gói đi trọn kịch bản MVP1 tới đề xuất trao. Đánh giá rủi ro của đề xuất ở mức
> `KHONG_XAC_DINH` với độ phủ 15%. Người duyệt D1 không ký được bằng một chạm: hệ thống đòi MFA mới, giải trình, và một ghi
> nhận hàng độ phủ bởi một người khác. D2 ghi nhận; D1 ký. Bộ bằng chứng mang đánh giá, và tính lại ra đúng mức ấy khi đã ngắt
> CSDL.

**[S1.157] Câu trên thay bằng câu dưới.** Độ phủ 15% không ra được theo ㉚; tổ chức phải đã bật S3 (㉙); và câu cũ bỏ chữ
*"trên giao diện"*.

> **Trên giao diện**, ở một tổ chức mới dựng ĐÃ BẬT S3 — 0 gói lịch sử —, một gói bậc một chữ ký đi trọn tới đề xuất trao.
> Đánh giá rủi ro của đề xuất ở mức `KHONG_XAC_DINH`, độ phủ 0%, có hàng `DO_PHU`. Người duyệt D1 không ký được bằng một chạm:
> màn đòi đăng nhập lại để có MFA mới, giải trình, và một ghi nhận hàng `DO_PHU` bởi người ngoài tập ㉞. D2 ghi nhận; D2 thử ký
> thay D1 thì bị từ chối, vì đã ghi nhận; D1 ký. Cùng kịch bản ở một tổ chức CHƯA bật S3 ký một chạm như MVP1. Bộ bằng chứng mang đánh giá, và
> tính lại ra đúng mức ấy khi đã ngắt CSDL. Lượt đi thử ở khung 375×812 có biên bản.

**S4b trọn — khi cổng (e) đạt, trên dữ liệu của tổ chức đã vượt sàn:** kịch bản V2.1 §41 ở spec S4 §7.2, cộng:

> Sổ tín hiệu của 12 tháng hiện một chuỗi 9 gói mà ba nhà cung cấp luân phiên thắng với khoảng cách thắng–nhì ổn định. Người
> kiểm toán ghi nhận nó kèm lý do, và dòng ấy vào sổ. Không màn nào hiện chữ *gian lận*, và không bảng nào lưu chuỗi ấy trước
> khi người kiểm toán ghi nhận.

**[S1.157]** Ba sửa. ⑴ Theo ㊼, chuỗi 9 gói luân phiên ra `VANG`, không `DO`; câu nghiệm thu dùng chuỗi 12 gói. ⑵ Sản phẩm
không có vai kiểm toán: *"người kiểm toán"* là vai mà Q2 chốt. ⑶ Dữ liệu *"của tổ chức đã vượt sàn"* là dữ liệu thật; demo V2.1
§41 trên dữ liệu gieo theo Q8. **[S1.158]** Người kiểm toán là người giữ vai `AUDITOR`; demo chạy trên tổ chức mang dấu dữ liệu
mẫu, và mọi màn hiện nhãn ấy; kịch bản V2.1 §41 của spec S4 §7.2 bỏ Supplier Score (Q1).

### 14.1. [S1.157] Cách đếm KPI của V2.1 §36

Bản nháp nhắc KPI và North Star ở đầu trang mà không nói cách đếm (góc D⑨). Đếm trên đánh giá rủi ro, theo tổ chức, theo tháng:

| KPI | Đếm | Không đếm |
|---|---|---|
| *High-risk RFQ detected* | Đánh giá có ≥ 1 yếu tố `DO` thật — không tính `DO_PHU` | `KHONG_XAC_DINH` đếm RIÊNG; gộp vào thì chỉ số ở tổ chức mới ≈ 100% |
| *Price anomaly* | Đánh giá có F3 hay F9 ở `DO` | Nhãn `LECH_CAO` từng dòng của S4a — đó là chỉ số của S4a |
| *Supplier network alerts* | — | V2.1 §18, ngoài S4 (§16) |
| North Star *"có risk assessment"* (PRODUCT §9) | **Q7** (§2.6) — **[S1.158]** gói có đánh giá rủi ro mức khác `KHONG_XAC_DINH` | Gói chỉ có đánh giá `KHONG_XAC_DINH`; gói ở tổ chức chưa bật S3 |

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

### 15.1. [S1.157] Bảng hạng mục chịu lực

Bảng trên giữ nguyên văn. Nó sai ở ba chỗ (góc D②, D④, A②): S4b.1 không đạt được câu nghiệm thu của chính nó, vì lớp bằng
chứng, bảng đầu vào và phép tổng hợp nằm sau cổng; F6 cần S3.6 mà cột *Chờ* không ghi; S4b.4 và S4b.5 thiếu cổng (e), trong
khi ADR-091 ⑴ chỉ miễn cổng cho S4b.1.

| # | Hạng mục | Ra cái gì | Chờ |
|---|---|---|---|
| **S4b.0** | Cổng dữ liệu | ADR (e) với con số của Q5; công cụ đo chỉ xuất số đếm theo tổ chức, chạy với đồng ý của khách; biên bản đo; **một lượt soi hình dạng lại** trên bảng đọc lại dưới đây | Q5; pilot |
| **S4b.1** | Không duyệt một chạm | `RUI_RO_V1`: F3, F5, F6, F7, F8, F9, F10, F11 và `DO_PHU`; F1, F2b, F4 mang `CHUA_CAI`. Bốn bảng lõi, bảng người gây ra, bảng đầu vào; §10.1 trọn; lõi lớp rủi ro trong bộ bằng chứng và mục `DAC-TA.md` cho các yếu tố đã có mã; `/mo-thau` bước đề xuất và duyệt; mở lại câu hỏi ADR-044 (㊺); **L10, L11, L16, L17 (vế sự kiện), L18, L20 (vế CSDL), L21, L23** | S3.5, S3.6, S4.3, S4.5 — KHÔNG chờ cổng (e) |
| **S4b.2** | Risk Score đủ | `RUI_RO_V2`: F1, F2b, F4; `rfq_risk_nen`; hiệu năng; **L17 (vế chuỗi), L22** | Cổng (e); S4b.1; Q7 cho KPI |
| **S4b.3** | Sổ tín hiệu | `/so-tin-hieu` đọc có sổ; `risk_register_acks`; **L19** (đường đầu tiên), **L20** (vế sổ) | S4b.2; Q2 |
| **S4b.4** | Supplier Score | Năm thành phần có nguồn theo ㊾ — hoặc không làm, nếu Q1 = ⒞; **L9**; hồ sơ nhà cung cấp phía bên mua | Cổng (e); S4b.2; Q1, Q3; S3.7, S3.8; S4.7 |
| **S4b.5** | Phân tích người mua và F2a | Bốn ma trận, bảng người đặt thước; F2a vào một phiên bản phương pháp mới, phân tầng theo nhóm hàng; **L19** | Cổng (e); câu hỏi pháp lý E7; Q2 |
| **S4b.6** | Màn Executive | `/tong-quan` với trạng thái trước mở thầu; nút theo Q4; demo theo Q8 | S4b.2; Q4, Q8 |
| **S4b.7** | Bằng chứng trọn | Lớp rủi ro trong bộ xuất ADR-059 cho mọi yếu tố chuỗi; `DAC-TA.md` trọn | S4b.2 |

**[S1.158] Sau ADR-098**, mọi Q trong cột *Chờ* đã có câu trả lời. **S4b.4 rời S4b, sang S5** (Q1), và S3.8 rời điều kiện
của cổng (e). S4b.3 dựng vai `AUDITOR`, mã `analytics.review` và route tự thân của Q2 (**L25**, L19 mở rộng); S4b.0 chờ pilot để
ĐO, với con số của Q5, và dựng dấu dữ liệu mẫu cho công cụ đo (**L24**); S4b.6 không có nút *[REQUEST REVIEW]*, và hiện nhãn dữ
liệu mẫu (**L24**); S4b.2 đếm North Star theo Q7.

**Đọc lại khi lớp nền có mã.** Spec này viết trên bảng chưa tồn tại. Khi mỗi lớp nền vào `master`, hạng mục kế tiếp của S4b
đọc lại đúng mục tương ứng trước khi viết mã, và ghi kết quả vào biên bản của vòng ấy:

| Lớp nền | Đọc lại |
|---|---|
| S3.5 — `rfq_awards` và chữ ký tách khỏi `APPROVED` | §5.2, §10.1, ㉛㉝ |
| S3.6 — từ vựng tín hiệu, ngoại lệ, `seq`/`ghi_luc` | F6, ㊲㊸ |
| S4.3 — ánh xạ | F8 |
| S4.5 — bảng kết quả benchmark | F3, F9 |
| S4.7 — hai hạng giá/TCO | F1, *Price Competitiveness* |
| S3.1 — `chinh_sach_tai` | §5.1, ㊵ |
| S3.7, S3.8 — thẩm định, view hiệu suất | §7, ㊾ — **[S1.158]** S3.7 cho ㉞ (người thẩm định N); §7 và S3.8 sang S5 |

**Về quy trình.** Quyết định *"viết spec S4b trước cổng"* đã ghi ở §2.2; nay có ADR-096. Viết spec trước cổng không phạm
ADR-043 hay ADR-091, vì hai ADR ấy chặn vòng MÃ — tiền lệ S1.138, S1.154. ~~Số tạm ADR-091…097 và khoản 243–245 chỉ đúng khi spec S4, lượt soi S1.155, spec S4b và lượt soi S1.157 vào cùng một PR, vì `cap-so` cấp số theo từng lần hợp; tách PR thì số tạm trỏ sai (góc D⑫, CHƯA ĐO).~~ **[S1.158]** Cả năm vòng
S1.154–S1.158 vào cùng một PR, và `pnpm cap-so` cấp ADR-091…098, khoản 243–245 một lần cho cả nhánh; rủi ro của góc D⑫ không
xảy ra.

---

## 16. Ngoài phạm vi tài liệu này

- **Tín hiệu danh tính và kỹ thuật** (V2.1 §17) và **đồ thị quan hệ** (§18) — spec S4 §10 đã ghi thứ rẻ nhất khi tới lượt:
  trùng tài khoản ngân hàng hay địa chỉ giữa các nhà cung cấp cùng được mời vào một gói.
- **Specification anomaly** (V2.1 §20) — cần một sổ sửa hạng mục trước.
- **Quality, Delivery, Claim rate, Contract compliance** (V2.1 §13) — S5.
- **[S1.158] Supplier Score trọn** — S5 (Q1, ADR-098). §7 giữ làm đầu vào cho spec S5.
- **Học máy, mô hình dự báo** — ADR-092.
- **Chia sẻ điểm hay sổ tín hiệu xuyên tổ chức** — ADR-013; một nhà cung cấp bị gắn cờ ở tổ chức A không được theo sang tổ chức B.
- **Dùng điểm để tự động loại hay tự động trao** — V2.1 §20: *"AI chỉ đưa ra Risk / Recommendation; con người đưa ra
  Investigation / Decision"*. Không đầu ra nào của S4b chặn một cạnh, trừ vế ghi nhận của S4b.1 — và vế ấy chặn việc KHÔNG AI
  ĐỌC tín hiệu, không chặn việc trao. **[S1.157]** Câu ấy sai với bản nháp — mọi `DO` ở mức `VUA` đi qua một chạm (góc C②) —
  và chỉ đúng từ ㉗. Nó vẫn nói quá một chút: vế ghi nhận chặn việc không AI KÝ TÊN vào việc đã đọc, không chứng minh việc đọc
  (§12.2).
- **[S1.157] V2.1 §22 *Award Recommendation*** — trích làm nguồn ở đầu trang nhưng không làm: *Recommended Supplier* trên màn
  Executive là đề xuất của người.
- **[S1.157] Yếu tố không dựa vào đều đặn** (§12.6) — một phiên bản phương pháp sau.
