# TrustProcure V2 — Thiết kế S4: Nền dữ liệu và Trí tuệ mua sắm (Data Foundation & Intelligence · MVP3)

> **Ngày:** 2026-09-26 · **Trạng thái:** **BẢN NHÁP — chưa qua lượt soi hình dạng.** Bốn quyết định của chủ dự án ở
> §2.2. Năm ADR phải chốt, bốn trong số đó trước dòng mã đầu (§2.3). Chưa một dòng mã nào của S4 được viết.
> **Nguồn:** `TrustProcure_V2_Procurement_Control_Intelligence.md` (V2.1) — §33 *MVP 3 — Procurement Intelligence*,
> §13 *Supplier Intelligence*, §14 *Item Master & Normalization Engine*, §15 *Price Benchmark Engine*, §16 *Total Cost /
> TCO*, §17 *Risk Engine*, §19 *Risk Score mẫu*, §20 *AI / Analytics*, §24 *Executive Experience*, §41 *Kịch bản Demo*,
> §44 *Data Quality Before AI*. Bản nguồn KHÔNG nằm trong kho. Vòng này đọc bản trên Drive của chủ dự án (sửa lần cuối
> 2026-08-26), và đối chiếu được với mọi đoạn spec S3 trích từ nó: bốn bậc ở §12 11.1, bảy mã lý do ở §12 11.2, năm trường
> tín hiệu ở §19.
> **Đóng:** phần *"toàn bộ Intelligence"* mà spec S0+S1 §10 đẩy sang S4 · các mục spec S3 §10 đẩy sang S4 — Risk Score,
> phát hiện bất thường, phân tích người mua, phát hiện xoay vòng bằng thống kê (ADR-058 ⑸), cấm duyệt một chạm cho gói rủi
> ro cao (V2.1 §24) · ADR-053 ⑶ — Effective Cost chỉ chấm được thành phần `gia` · *"giá tham chiếu bên ngoài"* mà ADR-058
> gọi tên là S4.
> **Không đóng:** đồ thị quan hệ nhà cung cấp (§18) và tín hiệu danh tính, kỹ thuật của §17 — MST, tài khoản ngân hàng, địa
> chỉ, IP, thiết bị, metadata tệp (§2.2 ⑴); benchmark xuyên tổ chức (§2.2 ⑷); dữ liệu giao hàng, chất lượng, khiếu nại từ
> ERP (S5). Vì vậy *Quality* và *Delivery* của Supplier Score, và *Quality Cost* của TCO, không có nguồn trong S4 (§4.8,
> §4.9).

---

## 1. Bối cảnh — S4 mở khi MVP1 chưa đóng và S3 mới khép S3.0

Bảng bốn mảnh ở `docs/PRODUCT.md` §11 còn mảnh 3 (triển khai thật) và mảnh 4 (khách hàng pilot). S3 đã khép S3.0 ở S1.153;
S3.1 tới S3.9 chưa có mã. V2.1 §39 xếp S4 ở tháng 8–9, sau pilot và sau Governance. ADR-001 cũng tính S4 *"nằm ở tháng
8–9 theo roadmap"*.

Chủ dự án chọn cho nửa đầu của S4 chạy song song S3 (§2.2 ⑶). Tài liệu này không đảo lại lựa chọn ấy. Nó làm ba việc để
cái giá đo được:

1. **Tách NỀN khỏi SUY LUẬN.** S4a — hàng chuẩn, chuẩn hoá, đơn vị đo, lịch sử giá, benchmark, TCO — đúng hay sai trên
   TỪNG gói: một dòng ánh xạ sai, một hệ số quy đổi sai là sai ngay ở gói đầu tiên, và đo được ngay. S4b — Supplier Score,
   Risk Score, bất thường, phân tích người mua — chỉ có nghĩa trên lịch sử. Trên dữ liệu rỗng, S4b cho ra một con số trông
   chính xác mà không đo gì. Nên S4b có một cổng dữ liệu (§2.3 (e)), còn S4a thì không cần.
2. **Đặt ranh giới MÙ cho dữ liệu nền (§3.3).** Thứ quyết định một báo giá bị so với cái gì — ánh xạ hạng mục, hệ số quy
   đổi, mốc giá ngoài — phải được chốt TRƯỚC khi có người thấy giá của gói ấy. Lý do giống lý do giá được niêm phong: sau
   khi giá lộ, sửa được thước đo là chỉnh được kết quả đo.
3. **Mọi tham số mặc định mang nhãn GIẢ ĐỊNH** (§4.1), kèm điều kiện hiệu chỉnh bằng dữ liệu pilot.

Rủi ro chi phối của S4 đã được ghi từ ngày phân rã (spec S0+S1 §1): ***chất lượng dữ liệu gốc.*** V2.1 §44 nói cùng điều
bằng một câu: *"AI must not be used to compensate for fundamentally inconsistent master data."* Mọi quyết định dưới đây
được cân theo rủi ro ấy trước.

S4 còn thêm một bề mặt rò mà S1–S3 không có: **giá theo TỪNG hạng mục, gom qua nhiều gói**. Hôm nay máy chủ chỉ đọc ĐÚNG
MỘT con số của báo giá đã mở — `payload ->> 'totalAmount'` qua `public.bid_so_tien` (`020`). Mảng `lines[]` trong phong bì
chưa lớp máy chủ nào đọc: grep `lines` trên `apps` và `packages`, trừ test, chỉ ra `apps/web/trang/nop-thau.js:297`, tức chỗ
trình duyệt dựng phong bì. S4 là lát cắt đầu tiên đọc nó.

---

## 2. Những thứ đã chốt TRƯỚC khi có tài liệu này

| # | Ràng buộc | Nguồn | Hệ quả cho S4 |
|---|---|---|---|
| 1 | **Data Quality Before AI** | PRODUCT §4 ⑹; V2.1 §33 (câu in đậm), §44 | S4b không mở trước S4a. Không phép suy luận nào đọc một hạng mục chưa có ánh xạ hiệu lực |
| 2 | **Risk Signal ≠ Fraud Verdict** | PRODUCT §4 ⑸, §5; V2.1 §15, §18, §20 | Nhãn là tập ĐÓNG. Không màn nào có chữ *gian lận*. Nhãn giá theo đúng V2.1 §15: *"Price Anomaly — Investigation Recommended"*, tức *"Giá bất thường — nên xem xét"* |
| 3 | **Lowest Price ≠ Best Supplier**; J1 | PRODUCT §4 ⑷; ADR-053 | TCO chỉ cộng khoản có đơn vị `TIEN`. Điểm phi giá không vào `effective_cost` |
| 4 | Ứng dụng tính, CSDL lưu — **không lưu kết luận trần** | ADR-017 | Mọi con số của S4 — độ tin cậy ánh xạ, dải benchmark, nhãn lệch, điểm nhà cung cấp, điểm rủi ro — lưu kèm đầu vào và phiên bản phương pháp, và tái lập được theo khuôn J2 |
| 5 | Giá dạng rõ chỉ ở bảng **ĐƯỢC KHAI** | ADR-054; bước 14 của `kich-ban-41-http.int.test.ts` | Lịch sử giá theo hạng mục KHÔNG được thành bảng giá dạng rõ thứ ba nếu chưa khai. Chọn hình dạng ở §2.3 (c) |
| 6 | Bí mật giá lan sang số đếm và phái sinh | A4, A5, A6; J4 | Không quan sát giá nào đến từ gói chưa `UNSEALED` hay từ vòng BAFO chưa đóng. Phiên khách không đọc được gì. Nhà cung cấp không thấy benchmark |
| 7 | Cô lập tổ chức; không có oracle xuyên tổ chức | ADR-003, ADR-013 | Hàng chuẩn, lịch sử giá, benchmark đều theo tổ chức (§2.2 ⑷) |
| 8 | **Một luật, một chỗ** | `014` §(4); spec S3 §2.5 ⒂ | Chốt của S4 (khoá ánh xạ, nguồn quan sát) là hàm vị từ SQL mà tầng gói gọi trước. Phép tính số (chuẩn hoá, benchmark, điểm) là hàm THUẦN TypeScript kèm phép đo tái lập — khuôn `packages/danh-gia/src/chi-phi-hieu-dung.ts` + J2 |
| 9 | Người đặt thước không cầm thứ bị đo | `033`; spec S3 §2.4 ⑺ | Người sửa dữ liệu nền (ánh xạ, quy đổi, mốc ngoài) không tạo gói và không mời trên chính dữ liệu ấy |
| 10 | Mọi ngưỡng cấu hình được theo tổ chức | PRODUCT §8 ⑸; V2.1 §13, §14 | Ngưỡng tin cậy, cửa sổ benchmark, ngưỡng lệch, trọng số điểm là dữ liệu của phiên bản chính sách |
| 11 | Friction thấp cho nhà cung cấp | PRODUCT §8 ⑴ | TCO thêm ô vào form nộp thầu. Mọi ô ngoài đơn giá là TUỲ CHỌN, và chỉ hiện khi chính sách bật đúng thành phần ấy |
| 12 | Nhóm hàng của S3 KHÔNG phải item master | spec S3 §4.3 | *"Ánh xạ hạng mục sang nhóm hàng chuẩn là S4"*. S4a ánh xạ hạng mục sang HÀNG CHUẨN; hàng chuẩn gắn nhóm hàng khi S3.6 có mã (§3.4) |

### 2.1. ADR-054 và ADR-058 ⑸ là hai tiền lệ chịu lực nhất

**ADR-054** kết thúc bằng câu: *"mỗi bảng như thế phải đi kèm một dòng trong bảng trên, và dòng ấy phải khai được vai ghi
cùng cổng đọc. Không khai được thì không thêm."* Lịch sử giá theo hạng mục là đúng loại dữ liệu câu ấy nói tới. Cổng đo nó
— bước 14 của kịch bản 41 — quét giá dạng rõ trên MỌI bảng, và khẳng định tập kết quả bằng `toEqual` vét cạn. Phép đo lúc
viết tài liệu này tìm ra một chỗ hở: câu truy vấn của bước 14 chỉ lấy `c.relkind IN ('r', 'p')`. **Một materialized view
(`relkind = 'm'`) chứa giá dạng rõ sẽ đi qua cổng mà không làm dòng nào đỏ.** §2.3 (c) chốt cả hình dạng lẫn chỗ hở ấy.

**ADR-058 ⑸** xếp thứ tự cho phần PHÁT HIỆN: khoảng cách giá thắng–giá nhì, rồi ma trận tỷ lệ thắng, rồi mới tới IP, thiết
bị, metadata. S4b đi đúng thứ tự ấy và dừng trước vế thứ ba (§2.2 ⑴). ADR-058 còn nói thẳng rằng khi cả pool cùng một đội
thì so giá của họ với nhau là vô nghĩa: *"chỉ một mốc giá ngoài hệ thống mới bắt được. Mốc ấy là S4 Data Foundation."*
Mốc giá ngoài của §4.7 là thứ ấy — và §8.5 nói nó bắt được đến đâu.

### 2.2. Bốn quyết định của chủ dự án, ngày 2026-09-26

| # | Câu hỏi | Quyết định | Hệ quả |
|---|---|---|---|
| ⑴ | Phạm vi | **Đủ mười mục của V2.1 §33, chia hai nửa.** S4a *Data Foundation*: Item Master, chuẩn hoá item, UOM, lịch sử giá, benchmark giá, TCO. S4b *Intelligence*: Supplier Score, Risk Score, phát hiện bất thường, Buyer Analytics. S4b chỉ mở khi có sàn dữ liệu | Đồ thị quan hệ (§18) và tín hiệu danh tính/kỹ thuật của §17 KHÔNG thuộc S4 — §10. Cổng dữ liệu của S4b là ADR (e) |
| ⑵ | Runtime | **Giữ TypeScript + PostgreSQL.** Không service Python, không ML | Đảo phần *Hệ quả* của ADR-001 (*"Tới S4, tách một service Python riêng"*) — ADR (b). Chuẩn hoá bằng luật tất định cộng hàng đợi duyệt tay. Không thêm extension: grep `CREATE EXTENSION` trên `db/migrations` cho 0 kết quả, và S4 giữ nguyên con số ấy (§4.4) |
| ⑶ | Thời điểm | **S4a mở vòng song song S3, ngay sau lượt soi hình dạng** | Ngoại lệ thứ hai với ADR-043, sau ADR-080 — ADR (a). S4b KHÔNG thuộc ngoại lệ này |
| ⑷ | Nguồn benchmark | **Lịch sử của chính tổ chức, cộng mốc giá ngoài do khách nhập tay kèm nguồn** | Không truy vấn xuyên tổ chức. Câu *"giữ được khả năng truy vấn xuyên khách hàng cho benchmark ở S4"* của ADR-003 vẫn là một khả năng, không phải một hạng mục |

### 2.3. Năm ADR phải chốt ở lượt soi hình dạng

| ADR | Câu hỏi | Vì sao chặn |
|---|---|---|
| **(a)** | S4a mở vòng khi MVP1 chưa đóng và S3 đang chạy. Ngoại lệ HẸP với ADR-043, khuôn ADR-080 ⑴: chỉ các hạng mục S4.0–S4.7, không khoản rổ B nào khác. Dòng trỏ mảnh của mỗi vòng: *"không chạm mảnh nào của `PRODUCT.md` §11; chạy song song S3 dưới ADR (a)"*. **Điều kiện dừng:** nhường một khoản rổ A hay một vòng triển khai thật/pilot (khuôn ADR-080 ⑷), **và nhường S3.x khi hai bên sửa cùng một bảng hay cùng một hàm ghim** | ADR-043 là luật đang hiệu lực. ADR-080 chỉ mở cho S3.x. Không có ADR này thì vòng S4 đầu tiên đúng là lỗ khoản 237 |
| **(b)** | S4 giữ TypeScript + PostgreSQL, sửa phần *Hệ quả* của ADR-001. **Điều kiện mở lại:** hàng đợi duyệt tay của một tổ chức thật giữ quá N dòng quá M ngày (GIẢ ĐỊNH), hoặc một nhu cầu mà luật tất định không diễn đạt được — ví dụ so nghĩa giữa hai mô tả không có từ chung | ADR-001 đang nói ngược lại. Không sửa nó thì một vòng sau đọc ADR-001 sẽ dựng service Python |
| **(c)** | **Lịch sử giá có phải bảng giá dạng rõ thứ ba không.** Tài liệu này đề xuất KHÔNG: lịch sử giá theo hạng mục là một **view `security_invoker`** đọc `rfq_unsealed_bids.payload` qua một bộ đọc SQL (§4.5), và kết quả benchmark chỉ lưu THAM CHIẾU tới quan sát, không lưu số (§4.6). ADR phải: ⑴ khai view ấy như một ĐƯỜNG ĐỌC giá dạng rõ trong bảng của ADR-054, kèm cổng đọc; ⑵ nới bước 14 thêm `relkind IN ('v', 'm')` — view thường phải được khai, materialized view phải làm dòng ấy đỏ; ⑶ chốt bảng mốc giá ngoài (§4.7) có thuộc phạm vi A3/A4 không. Đề xuất: KHÔNG, vì nó không chứa giá của nhà cung cấp nào trong gói nào — nhưng vẫn khai nó ở ADR-054 như *"bảng giá không phải báo giá"*, để phép quét không phải đoán | Chọn sai thì hoặc có một bảng giá dạng rõ không ai khai, hoặc có một bảng đã khai mà không cần. Cả hai đều phải sửa migration sau khi đã áp |
| **(d)** | Mốc giá ngoài: ai nhập; nguồn bắt buộc đến đâu (văn bản tự do, hay tên nguồn cộng ngày cộng đường dẫn); mốc ngoài có được làm cơ sở DUY NHẤT cho một nhãn lệch không; thời hạn giữ; nhập hàng loạt bằng gì | Mốc ngoài là đầu vào DUY NHẤT của S4 mà bên mua tự gõ ra, và nó quyết định một nhãn. Đó đúng là hình dạng *"người đặt thước"* của `033` |
| **(e)** | **Cổng dữ liệu của S4b** — sàn tối thiểu để mở S4b: số gói đã `UNSEALED`, tỷ lệ hạng mục có ánh xạ hiệu lực, số tháng lịch sử, ở ít nhất MỘT tổ chức THẬT. Đề xuất GIẢ ĐỊNH: ≥ 30 gói `UNSEALED`, ≥ 60% hạng mục có ánh xạ hiệu lực, ≥ 6 tháng. Cộng điều kiện: S3.5–S3.8 đã có mã, vì S4b đọc bảng của chúng và dựng trên cổng trao thầu của S3.5 | Chỉ chặn S4b, không chặn S4a. Không có cổng này thì quyết định ⑴ (*"S4b chỉ mở khi có sàn dữ liệu"*) không có trạng thái *đạt* — đúng lỗi ADR-043 ⑷ đã đo |

**Không cần công tắc theo tổ chức như ADR-080 — ĐỀ XUẤT, lượt soi phải kiểm.** Mọi hành vi mới của S4a hoặc CỘNG THÊM (ánh
xạ, lịch sử, benchmark là thứ hiện thêm sau khi mở niêm phong), hoặc TẮT mặc định (thành phần TCO ngoài `gia`, §4.8). Một
tổ chức không khai gì thì chạy đúng hành vi hôm nay. Phép đo của lời khai ấy là cụm test hiện có: nó phải xanh NGUYÊN VĂN
sau mỗi hạng mục S4.x — cùng yêu cầu spec S3 §8.11 đặt cho nhánh *chưa bật*. Có một ngoại lệ đã biết: §3.3 ⑵ đòi lý do cho
ánh xạ ghi sau khi mở niêm phong, và đó là một lần TỪ CHỐI mới. Nhưng nó chỉ chạm bảng mới của S4, không chạm đường nào của MVP1.

---

## 3. Kiến trúc

### 3.1. Thứ S4 TÁI DÙNG, không dựng lại

| Đã có | S4 dùng cho |
|---|---|
| `rfq_items` — `description`, `quantity numeric(18,4)`, `unit text` tự do ≤ 50 byte (`009`) | Đầu vào của chuẩn hoá. **S4 không thêm cột nào vào `rfq_items`**; ánh xạ nằm ở bảng riêng |
| `rfq_unsealed_bids.payload jsonb` (`019`) — chú thích gốc ghi *"hình dạng một báo giá là việc của sản phẩm và nó sẽ đổi"* | Nguồn đơn giá từng hạng mục: `lines[]` gồm `{lineNo, unitPrice, amount}`, do `dongTien()` ở `nop-thau.js` dựng |
| `public.bid_so_tien` (`020`) — từ chối bốn ca: không phải số, `NaN`, `Infinity`, số âm | Khuôn của bộ đọc đơn giá (§4.5) |
| `org_procurement_policies` có phiên bản, bất biến (`014`, `056`) | Tham số chuẩn hoá, benchmark, TCO, điểm là khoá mới của phiên bản — khuôn spec S2 §4.1, spec S3 §4.1 |
| `eval_components`, hàm thuần Effective Cost, J1/J2 (`056`, `057`, ADR-052, ADR-053) | TCO nới tập mã thành phần. **Không** dựng công thức thứ hai |
| `rfq_bafo_rounds`, ADR-056 | Vị thế thương mại CUỐI CÙNG của mỗi nhà cung cấp trong một gói |
| `rfq_awards` (`061`) | Giá trúng thầu |
| `vendor_bid_versions` | Thời điểm nộp, số lần sửa — tín hiệu hành vi của S4b (V2.1 §11) |
| Cổng `MFA_FRESH` 15 phút (`packages/unseal/src/gate.ts`, `UNSEAL_MFA_MAX_AGE_SECONDS`) | Duyệt trao thầu rủi ro cao (V2.1 §24) |
| `throwAuditedDenial`, luật `VAO_SO`, lớp `CONTROL_DENIED` (ADR-060, ADR-084) | Mọi lần từ chối của S4 |
| Bộ xuất tự đủ `tools/bo-xuat-danh-gia` + `DAC-TA.md` (ADR-059) | Lớp dữ liệu nền trong bộ bằng chứng |
| Của S3, khi đã có mã: `procurement_categories` (S3.6), `governance_signals` + ghi nhận (S3.6), view hiệu suất (S3.8), `supplier_qualifications` (S3.7) | CHỈ S4b đọc. S4a không phụ thuộc cái nào — đó là điều kiện để S4a chạy song song được |

**S4 không thêm đường mật mã nào, không thêm trạng thái RFQ nào, không chạm đường mở thầu, và S4a không sửa thân ghim của
`rfq_kiem_chuyen_trang_thai`.** Nếu bản cài đặt sửa `packages/sealed-envelope`, `packages/unseal`, `packages/crypto-keys`,
thêm một phần tử vào `CANH_HOP_LE`, hay định nghĩa lại một hàm có bản ghim ở `hardening.always.sql` mà S3 cũng sửa, thì
thiết kế đã trượt. Phong bì là byte mờ với `sealBid` (`packages/sealed-envelope/src/seal.ts` nhận `plaintext: Uint8Array`),
nên thêm ô TCO vào bản rõ (§4.8) là việc của `nop-thau.js`, không phải của gói mật mã.

### 3.2. Thứ S4 thêm

Hai gói, một chiều phụ thuộc:

- **`packages/du-lieu-nen`** (S4a) — lõi THUẦN của chuẩn hoá (§4.4), quy đổi đơn vị, benchmark (§4.6); tầng gói ghi ánh xạ,
  hàng chuẩn, mốc ngoài.
- **`packages/tri-tue`** (S4b) — lõi thuần của Supplier Score, Risk Score, phân tích người mua.

Ranh giới `depcruise` mới: cả hai gói không phụ thuộc `sealed-envelope`, `unseal`, `crypto-keys`; `du-lieu-nen` không phụ
thuộc `tri-tue`. Như vậy phát biểu *không chạm đường mở thầu* ở §3.1 thành một phép đo máy, cùng lối S2.7 dùng `g17-` và
spec S3 §3.2 dùng cho `kiem-soat`.

TCO sửa `packages/danh-gia` (tập mã thành phần), `apps/web/trang/nop-thau.js` (ô khai) và bộ xuất ADR-059. Nó không sửa
`packages/du-lieu-nen`.

### 3.3. Ranh giới MÙ của dữ liệu nền — quyết định thiết kế lớn nhất của S4

**Hiện trạng, đo trên `master` `9b3cf8d`:** một người giữ `bid.view` thấy lịch sử giá, vì bảng so sánh của mọi gói đã mở
đều đọc được. Khi S4 có benchmark, người ấy còn thấy thêm một điều: *gói này sẽ bị so với dải nào*. Có ba cách chỉnh kết quả
so sánh mà không cần chạm vào giá:

| Cách | Làm gì | Ví dụ |
|---|---|---|
| Ánh xạ | Ánh xạ hạng mục sang một hàng chuẩn đắt hơn | Thép D10 ánh xạ sang D32 — giá thổi phồng trông như bình thường |
| Quy đổi | Khai một hệ số quy đổi riêng lệch | 1 cây = 9 kg thay vì 7,22 kg |
| Mốc ngoài | Nhập một mốc ngoài cao, ngay trước lúc mở | — |

Cả ba đều không cần biết giá của gói đang xét nếu người làm đã *thống nhất giá trước* với nhà cung cấp — đúng kịch bản
ADR-058 ⒜. Cả ba trở nên MIỄN PHÍ sau khi giá lộ: đọc giá rồi chỉnh thước cho vừa.

**Mốc mở giá của gói X** là `min(rfq_unsealed_bids.unsealed_at)` của X. `rfq_packages` không có cột thời điểm mở thầu —
`009` chỉ có `opened_at` và `closed_at` — nên mốc ấy đọc từ chính bảng giữ giá đã mở.

**Luật:** mỗi hàng dữ liệu nền mang `ghi_luc`, do trigger đặt bằng `clock_timestamp()` — đồng hồ Postgres (ADR-005). Cột ấy
không nằm trong `GRANT` (khuôn `approved_content_hash` của `011`). Dữ liệu nền dùng cho gói X là các hàng có `ghi_luc` nhỏ
hơn mốc mở giá của X. Một ánh xạ, quy đổi hay mốc ngoài ghi sau mốc ấy vẫn được ghi — dữ liệu nền phải sửa được — nhưng:

- ⑴ nhãn `SAU_MO_GIA` được SUY RA trong view từ `ghi_luc` và mốc mở giá, không lưu thành cột — một cờ lưu tay là kết luận
  trần (ADR-017);
- ⑵ ánh xạ của một hạng mục thuộc gói đã `≥ UNSEALED` đòi lý do không rỗng — trigger kiểm `rfq_packages.status` lúc ghi;
- ⑶ benchmark của CHÍNH gói X không đọc hàng mang nhãn, trừ khi hiện nhãn ấy cạnh con số;
- ⑷ bộ bằng chứng mang nhãn ấy cho từng dòng.

Luật này khác spec S3 ở một chỗ, và chỗ ấy có lý do: S3 khoá danh sách mời ở `PENDING_APPROVAL`, vì danh sách ảnh hưởng tới
AI được báo giá. Dữ liệu nền không ảnh hưởng tới ai báo giá hay báo bao nhiêu — nó chỉ ảnh hưởng tới cách giá được ĐỌC.
Nên nó mở tới đúng lúc giá còn mù, tức tới mốc mở giá. Mốc ấy nằm trên CẠNH mở thầu, mà §3.1 cấm chạm. Cách giữ cả hai:
trigger nằm trên bảng MỚI của S4, còn mốc đọc từ `rfq_unsealed_bids` đã có. Không dòng nào thêm vào đường `CLOSED→UNSEALED`.

**Sai lệch của mốc chỉ đi một chiều — lượt soi phải đo lại.** `unsealed_at` là `now()` của giao dịch mở thầu, tức lúc giao
dịch ấy BẮT ĐẦU, trước lúc giá lộ. Một hàng ghi trong lúc giao dịch mở thầu đang chạy vì vậy mang nhãn *sau* dù giá chưa
lộ — sai về phía thận trọng. Chiều ngược lại là: ghi trước mốc, giữ giao dịch mở qua lúc mở thầu, đọc giá, rồi chọn commit
hay rollback. Chiều ấy cần giữ một giao dịch CSDL sống qua nhiều request. Mọi đường ghi của `api` là một giao dịch trong một
request (`withTenant`), và `idle_in_transaction_session_timeout` 60 giây của `packages/db/src/pool.ts` đuổi giao dịch rảnh.
Người dùng qua HTTP vì vậy không làm được; người có phiên CSDL thì nằm ngoài mô hình đe doạ tầng 1+2 cho việc này (ADR-002).

**Ánh xạ hồi tố là đường duy nhất để có lịch sử, và nó cũng mang nhãn.** Một tổ chức bật S4 khi đã có gói mở niêm phong thì
mọi ánh xạ của các gói ấy đều ghi SAU mốc mở giá của chính chúng: người ánh xạ có thể đã thấy giá khi chọn. Chúng vẫn dùng
được cho benchmark của gói mới, vì chúng ghi trước mốc của gói mới. Nhưng benchmark hiện số quan sát loại ấy — *"7 quan sát,
trong đó 5 được ánh xạ sau khi giá của chính chúng đã lộ"*. Không có nhãn này thì một người vừa giữ `bid.view` vừa giữ
`item.manage` định hình được dải của gói sau, bằng cách chọn dòng cũ nào được ánh xạ vào đâu. Người ánh xạ KHÔNG giữ
`bid.view` thì ánh xạ hồi tố cũng mù — đó là một lý lẽ cho vai mặc định của `item.manage` ở §9 S4.0.

Luật này **không** chặn một người thông đồng TRƯỚC khi có giá, ánh xạ sẵn sang hàng đắt. Chặn điều ấy là việc của luật tách
người (§4.4, L3): người ghi ánh xạ không nằm trong tập người chọn của gói ấy. Không luật nào chặn được một người quản lý dữ
liệu thông đồng với người tạo gói. Thứ còn lại là dấu vết: ai ánh xạ, lúc nào, trước hay sau khi mở giá (§8.2).

### 3.4. Chạy song song S3 — chỗ nào đụng nhau

| Chỗ | S3 làm gì | S4a làm gì | Luật |
|---|---|---|---|
| `org_procurement_policies` | S3.1 thêm `tiers jsonb`, chữ ký thứ hai cho phiên bản, fail-closed phiên bản không bậc | S4.1, S4.5, S4.7 thêm khoá `chuan_hoa`, `benchmark`, `tco` | Hai migration riêng. Phiên bản mới mang CẢ HAI nhóm khoá. Ở tổ chức đã bật S3, phiên bản mới cho tham số S4 vẫn phải có bậc và chữ ký thứ hai — S4 không mở đường tắt nào quanh ADR-082 ⑺ |
| Cạnh `DRAFT→PENDING_APPROVAL` | S3.1, S3.3, S3.6 thêm trigger riêng | S4.3 KHÔNG thêm trigger ở cạnh; chuẩn hoá chạy sau commit (§4.4) | Không va |
| `packages/danh-gia` | S3.5 dựng lại cổng trao thầu: `trao-thau.ts`, trigger của `061` | S4.7 nới tập mã thành phần: `chi-phi-hieu-dung.ts`, `luot-danh-gia.ts`, `CHECK` và trigger J1 của `057` | Cùng gói, khác tệp, khác hàm ghim. Đo lại lúc làm; nếu S3.5 hóa ra sửa `057` thì S4.7 nhường |
| Bộ xuất ADR-059 | S3.9 thêm lớp governance | S4.5 thêm lớp dữ liệu nền | Hai lớp riêng trong cùng một bundle; `DAC-TA.md` có hai mục |
| Dải nhãn bất biến | S3 thêm hàng K từ S3.1 | S4.0 nới `[A-HJK]`→`[A-HJ-L]` | Nới một lần ở S4.0. Hàng K và hàng L vào sổ độc lập |
| Nhóm hàng | S3.6 dựng `procurement_categories` | `canonical_items.category_id` cho phép `NULL` | Khoá ngoại thêm ở hạng mục đầu tiên SAU khi S3.6 vào `master` — không trước |

---

## 4. Mô hình dữ liệu

### 4.1. Chính sách — ba nhóm khoá mới trên phiên bản chính sách

Cùng lý do spec S2 §4.1 và spec S3 §4.1: người mua nghĩ về *"chính sách phiên bản 4"* như MỘT vật. Ba nhóm khoá dưới đây
là `jsonb` trên chính hàng chính sách, bất biến bằng cấu tạo, `CHECK` giữ hình dạng. Số là CHUỖI chứ không phải số JSON,
theo ADR-053 ⑴. Mỗi nhóm cho phép `NULL`; tính năng tương ứng gặp `NULL` thì hiện *"chưa cấu hình"*, không lấy mặc định
ngầm — tiền lệ fail-closed của spec S2 §4.1.

| Nhóm | Khoá | Mặc định GIẢ ĐỊNH | Nguồn của mặc định |
|---|---|---|---|
| `chuan_hoa` | `nguong_tu_dong` · `nguong_goi_y` | `"0.95"` · `"0.80"` | V2.1 §14 |
| `benchmark` | `cua_so_thang` · `san_quan_sat` · `nguong_lech_cao` · `nguong_lech_vua` · `phuong_phap` | `12` · `3` · `"0.10"` · `"0.05"` · `"TRUNG_VI_TU_PHAN_VI_V1"` | Lựa chọn của tài liệu này |
| `tco` | `chi_phi_von_nam` · `ngay_thanh_toan_chuan` · `chi_phi_tre_ngay` | `NULL` · `NULL` · `NULL` | — (§4.8) |

Hai khoá của nhóm `chuan_hoa` mang ràng buộc `nguong_goi_y < nguong_tu_dong ≤ "1.00"`.

**Không migration nào tự tạo phiên bản chính sách** cho tổ chức — cùng nguyên tắc spec S3 §4.1 viện dẫn từ
`hardening.always.sql`. Mặc định là mẫu điền sẵn trên màn khai chính sách và trong `gieo:demo`. Hiệu chỉnh sau pilot bằng
ba tỷ lệ: tỷ lệ ánh xạ tự động bị người duyệt đảo lại, tỷ lệ nhãn lệch được ghi nhận là *có cơ sở*, và tỷ lệ hạng mục
*chưa đủ lịch sử*.

### 4.2. Đơn vị đo

**`uom_units`** — danh mục TOÀN CỤC, khuôn `roles` của `005`: không `org_id`, `app_api` chỉ `SELECT`, gieo bằng migration.

| Cột | Nghĩa |
|---|---|
| `code` | `kg`, `g`, `t`, `m`, `cm`, `mm`, `m2`, `m3`, `l`, `ml`, `cai`… |
| `thu_nguyen` | `KHOI_LUONG` · `CHIEU_DAI` · `DIEN_TICH` · `THE_TICH` · `DEM` |
| `he_so_ve_goc numeric` | `t` → `1000` (về `kg`) · `mm` → `0.001` (về `m`) |

Đơn vị ĐÓNG GÓI — `cây`, `cuộn`, `bao`, `thùng`, `bộ` — không có trong danh mục: chúng không có hệ số chung, chỉ có hệ số
theo mặt hàng.

**`uom_aliases`** — theo tổ chức: chuỗi đã làm sạch → `code`. Có một lượng nhỏ bí danh toàn cục cho các dạng không mơ hồ
(`kilogram`, `kgs`, `tấn`). **Dạng mơ hồ KHÔNG có bí danh toàn cục:** `MT` là *metric ton* trong V2.1 §14, nhưng trên phiếu
mua hàng ở Việt Nam nó cũng là *mét*; `T`, `M` cũng vậy. Tổ chức tự khai dạng mơ hồ; chưa khai thì dòng ấy không quy đổi
được.

**`item_uom_conversions`** — theo tổ chức, chỉ-ghi-thêm, có hàng rút: `(canonical_item_id, tu_don_vi, sang_don_vi, he_so,
tac_gia, session_id, seq, ghi_luc)`. Hàng này là thứ V2.1 §14 gọi là *"item-specific conversions require explicit
master-data configuration"*. Ví dụ: thép D10, 1 cây 11,7 m = 7,22 kg (0,617 kg/m).

Luật quy đổi, L4:

- ⑴ giữa hai đơn vị CÙNG thứ nguyên của danh mục toàn cục: tự động;
- ⑵ đơn vị đóng gói, hay khác thứ nguyên: chỉ qua `item_uom_conversions` của ĐÚNG hàng chuẩn ấy;
- ⑶ mọi cặp khác: quan sát bị LOẠI kèm mã `KHONG_QUY_DOI_DUOC` — không đoán, không lấy hệ số `1`.

Quy đổi dùng cho gói X là hàng mới nhất theo `seq` trong số các hàng có `ghi_luc` trước mốc mở giá của X (§3.3).

### 4.3. Hàng chuẩn (Item Master)

**`canonical_items`** — danh tính: `(org_id, id, ma, don_vi_goc, category_id NULL, trang_thai)`. `category_id` chỉ có khoá
ngoại sau khi S3.6 vào `master` (§3.4).

**`canonical_item_versions`** — chỉ-ghi-thêm, mỗi lần sửa một phiên bản, khuôn `vendor_bid_versions`: `ten`, `thuoc_tinh
jsonb`, `thuoc_tinh_trong_yeu text[]`, tác giả + phiên. `thuoc_tinh` mang đúng các trường V2.1 §14 kể ra: nhà sản xuất, vật
liệu, mác, kích thước, tiêu chuẩn, cộng khoá riêng của nhóm hàng. `thuoc_tinh_trong_yeu` là danh sách khoá mà nếu thiếu
hay mâu thuẫn thì bộ chuẩn hoá KHÔNG được gộp (§4.4 bước 5).

**`item_aliases`** — chỉ-ghi-thêm, có hàng rút: `(canonical_item_id, bi_danh_sach, tac_gia, session_id, seq, ghi_luc)`.
`bi_danh_sach` là chuỗi ĐÃ qua bước làm sạch, nên *"Thép Hòa Phát D10"* và *"THEP HOA PHAT D10"* là một bí danh.

Hàng chuẩn KHÔNG dùng chung giữa các tổ chức (§2.2 ⑷, ADR-013). Hai tổ chức cùng mua thép D10 có hai hàng chuẩn riêng.

**Mã quyền `item.manage`** (§9 S4.0) giữ mọi thao tác ghi ở mục này, ở §4.2, ở ánh xạ duyệt tay (§4.4) và ở mốc ngoài
(§4.7). Người đọc: mọi vai giữ `rfq.create`, vì người tạo gói cần thấy gợi ý. Hàng chuẩn không mang giá, nên đọc nó không
phải là đọc giá.

### 4.4. Chuẩn hoá và ánh xạ

**Lõi thuần** `packages/du-lieu-nen/src/chuan-hoa.ts`: `chuanHoa(moTa, donVi, tapHangChuan, phienBan) → KetQua`. Tất định,
không I/O, không ngẫu nhiên, không đồng hồ. Sáu bước theo đúng pipeline của V2.1 §14:

1. **Làm sạch.** NFC, chữ thường, tách dấu bằng NFD rồi bỏ ký tự dấu, **rồi đổi `đ`→`d` và `Đ`→`D` TƯỜNG MINH.** Phép đo
   lúc viết tài liệu này, trên Node của kho: NFD cộng bỏ `\p{M}` biến *"Đồng đỏ"* thành *"Đong đo"* — `đ` không phải chữ
   có dấu tổ hợp, NFD không tách nó. Thiếu bước này thì *"Đồng"* và *"Dong"* là hai chuỗi khác nhau. Sau đó gộp khoảng
   trắng và chuẩn hoá dấu câu; chữ số giữ nguyên.
2. **Đơn vị.** Bí danh → `code` (§4.2).
3. **Trích thuộc tính.** Tập luật CÓ PHIÊN BẢN. Ví dụ: `d ?(\d+)` và `phi ?(\d+)` → `kich_thuoc`; `(\d+) ?mm` → `kich_thuoc`;
   bí danh nhà sản xuất → `nha_san_xuat`.
4. **Khớp.** Ứng viên là hàng chuẩn của tổ chức. Điểm là tổng có trọng số của ba thứ: trùng bí danh chính xác; thuộc tính
   trùng; độ tương đồng token (Jaccard trên trigram, tính trong TypeScript, không cần `pg_trgm`).
5. **Độ tin cậy.** Một thuộc tính trọng yếu thiếu hay mâu thuẫn thì độ tin cậy bị chặn trên, dưới `nguong_tu_dong` —
   V2.1 §14 *"must not silently merge"*. Luật này nằm trong hàm, và có ca riêng trong bảng ca.
6. **Định tuyến.** `≥ nguong_tu_dong` → `TU_DONG`. Trong `[nguong_goi_y, nguong_tu_dong)` → `GOI_Y`. Dưới `nguong_goi_y`
   → `CAN_DUYET`.

**Phiên bản bộ chuẩn hoá là một HẰNG trong mã.** Mọi thay đổi luật ở bước 1, 3, 4, 5 phải tăng nó, và một bảng ca ghim theo
phiên bản đo điều ấy: đổi luật mà không đổi hằng thì bảng ca đỏ. Không có hằng này thì L2 (*tái lập được*) không có nghĩa,
vì *"cùng hàm"* không xác định được.

**`rfq_item_mappings`** — chỉ-ghi-thêm; hàng hiệu lực là hàng mới nhất theo `seq`, ghi dưới khoá tư vấn `(rfq_id, line_no)`
(khuôn `supplier_qualifications` ở spec S3 §4.8):

| Cột | Ghi chú |
|---|---|
| `rfq_id`, `line_no` | KHÔNG khoá ngoại tới `rfq_items.id`: hạng mục xoá được ở `DRAFT` (`009`), còn bảng này chỉ-ghi-thêm |
| `hang_muc_bam` | Băm của `description`, `unit`, `quantity` lúc ánh xạ. Ánh xạ chỉ hiệu lực khi băm ấy BẰNG băm hiện tại — khuôn C-1 của `011`. Gói quay về `DRAFT` và sửa hạng mục thì ánh xạ cũ tự thôi hiệu lực |
| `nguon` | `TU_DONG` · `NGUOI_DUYET` |
| `canonical_item_id` | `NULL` = quyết định tường minh *"không có hàng chuẩn tương ứng"*, khác với *chưa ánh xạ* |
| `do_tin_cay`, `phien_ban_bo_chuan_hoa`, `dau_vao jsonb` | Chuỗi đã làm sạch, thuộc tính trích được, năm ứng viên đầu kèm điểm. Đủ để tính lại (L2) |
| `tac_gia`, `session_id` | `NGUOI_DUYET` bắt buộc; `TU_DONG` ghi người đã kích hoạt lượt chuẩn hoá |
| `ghi_luc`, `ly_do` | Trigger đặt `ghi_luc` (§3.3). Ghi khi gói đã `≥ UNSEALED` thì `ly_do` không rỗng |

**Khi nào chuẩn hoá chạy.** Tầng gói gọi nó SAU KHI cạnh `DRAFT→PENDING_APPROVAL` commit, trong một giao dịch riêng, rồi ghi
hàng `TU_DONG` hoặc để dòng vào hàng đợi. Nó không ghi trong giao dịch của cạnh, vì hai lẽ: một lỗi chuẩn hoá không được
chặn việc nộp duyệt, và S4 không thêm trigger ở cạnh ấy (§3.4). Nó cũng không cần outbox: chuẩn hoá là hàm thuần, không gọi
dịch vụ ngoài, không có gì để thử lại theo lịch. Hỏng thì màn hàng đợi có nút *"chuẩn hoá lại"*.

**Hàng đợi** là một VIEW, không phải bảng: hạng mục của gói `≥ PENDING_APPROVAL` chưa có ánh xạ hiệu lực, kèm kết quả
`GOI_Y`/`CAN_DUYET` mới nhất.

**Người tạo gói KHÔNG ghi được ánh xạ hiệu lực.** Họ thấy gợi ý và trạng thái hàng đợi. Người ghi `NGUOI_DUYET` giữ
`item.manage` và nằm ngoài tập `{người tạo gói} ∪ {mọi invited_by} ∪ {mọi revoked_by}` của gói ấy, đọc trên MỌI hàng kể cả
hàng đã thu hồi — cùng tập loại trừ K5 dựng ở spec S3 §5.1.

### 4.5. Lịch sử giá — một VIEW, không phải bảng thứ ba

**Bộ đọc SQL `public.bid_don_gia(payload jsonb, line_no integer)`**, khuôn `bid_so_tien`: trả `(don_gia numeric, thanh_tien
numeric, ly_do text)`. Nó từ chối đúng bốn ca của `bid_so_tien`, cộng thêm:

- `lines` không phải mảng;
- hai phần tử cùng `lineNo`;
- `lineNo` không có trong `rfq_items` của gói;
- `payload ->> 'currency'` khác tiền tệ của phiên bản chính sách. Ô tiền tệ ở `nop-thau.js` là ô NHẬP TỰ DO của nhà cung
  cấp, và đa tiền tệ là Enterprise;
- **tổng lệch:** Σ `amount` ≠ `totalAmount`.

Phép so từng dòng (`amount` = `quantity` × `unitPrice`) phải dùng ĐÚNG luật của trình duyệt. Phép đo lúc viết tài liệu này:
`thanhTien` ở `apps/web/src/so-tien.ts` **CẮT** phần lẻ bằng phép chia `bigint` (`(a * b * 100n) / 10000n`), không làm tròn
nửa-ra-xa-0 như ADR-052. Dùng luật ADR-052 ở đây sẽ loại oan mọi dòng có số lượng lẻ. S4.4 phải chọn một trong hai: ghim
luật cắt ở cả hai tầng, hoặc chỉ dùng phép so tổng.

**View `price_observations`** (`security_invoker`, mục (C) `CAU_DOC_VONG` của hardening đòi điều đó cho mọi view), mỗi hàng
một (gói, nhà cung cấp, dòng):

| Cột | Nguồn |
|---|---|
| `rfq_id`, `supplier_id`, `line_no`, `bid_version_id` | `rfq_unsealed_bids` ⨝ `vendor_bid_versions` |
| `vi_the` | `CUOI_CUNG` — phiên bản của vòng cuối mà nhà cung cấp ấy nộp. Nếu có vòng BAFO đã đóng và nhà cung cấp nộp vòng ấy thì là bản BAFO; không thì bản vòng một |
| `trung_thau` | Hàng mới nhất của `rfq_awards` cho báo giá ấy là `APPROVED` (`061`) |
| `canonical_item_id` | Ánh xạ HIỆU LỰC của dòng. Ánh xạ ghi sau mốc mở giá thì mang nhãn `SAU_MO_GIA` (§3.3) |
| `don_gia_goc`, `don_vi_goc`, `don_gia_quy_doi`, `tien_te` | `bid_don_gia`, rồi quy đổi về `don_vi_goc` của hàng chuẩn (§4.2) |
| `ngay_quan_sat` | Mốc mở giá của gói (§3.3) |
| `trang_thai` | `HOP_LE` · `KHONG_DOC_DUOC` · `LECH_TONG` · `LECH_TIEN_TE` · `KHONG_QUY_DOI_DUOC` · `CHUA_ANH_XA` |

**Vị từ bí mật nằm TRONG thân view, không nằm ở route:** chỉ gói `≥ UNSEALED`, và chỉ khi mọi vòng BAFO của gói đã đóng. Lọc
theo trạng thái gói thôi thì chưa đủ — spec S3 §2.5 ⒅ đo được rằng phiên bản BAFO nằm chung `vendor_bid_versions` với vòng
một. Phiên khách thì bị chặn bằng vị từ khách trong thân view, cộng policy `RESTRICTIVE` trên mọi bảng mới (khoản 29).

**Cổng đọc: `bid.view`** — cùng cổng của `buildComparisonTable` và `docBangXepHang`. Lịch sử giá là giá sau mở thầu, và
cổng của dữ liệu ấy đã là `bid.view`.

Vì sao view mà không phải bảng — ADR (c):
- Một bảng sẽ là bản SAO thứ ba của giá dạng rõ, với vai ghi riêng và một đường đồng bộ riêng.
- View không sao gì. Mọi giá nó trả vẫn nằm ở `rfq_unsealed_bids`, dưới đúng vai ghi `app_unseal`.
- Cái giá: mỗi lần đọc lịch sử là một lần phân tích `jsonb` trên mọi báo giá đã mở của tổ chức. S4.4 phải đo thời gian đọc
  ở quy mô GIẢ ĐỊNH của một pilot (vài nghìn gói). Nếu vượt ngưỡng thì phương án đúng là một CHỈ MỤC biểu thức, không phải
  một materialized view — vì §2.1 đã đo được rằng bước 14 hôm nay không thấy materialized view.

### 4.6. Benchmark

**Lõi thuần** `benchmark(quanSat[], chinhSach, phienBan) → KetQuaBenchmark`. Phương pháp `TRUNG_VI_TU_PHAN_VI_V1`:

- tập đầu vào là quan sát `HOP_LE` của cùng hàng chuẩn, trong `cua_so_thang` tính ngược từ mốc mở giá của gói đang xét,
  **loại mọi quan sát của chính gói đang xét**;
- dải là [Q1, Q3], mốc so là trung vị. Trung vị và tứ phân vị chứ không phải trung bình và độ lệch chuẩn, vì một báo giá
  đầu độc (§8.4) kéo trung bình mà ít kéo trung vị;
- độ lệch = (đơn giá quy đổi − trung vị) / trung vị;
- nhãn lấy trong tập ĐÓNG: `BINH_THUONG` · `LECH_VUA` · `LECH_CAO` · `CHUA_DU_LICH_SU`. Dưới `san_quan_sat` thì không có con
  số, chỉ có `CHUA_DU_LICH_SU` — khuôn spec S3 §8.3.

Chữ hiện trên màn cho `LECH_CAO`: *"Giá bất thường — nên xem xét"*. Nhãn thấp cũng có: một giá thấp hơn trung vị quá ngưỡng
cũng là bất thường — có thể thiếu phạm vi, có thể phá giá — và nhãn nói *"thấp bất thường"*, không nói *"tốt"*.

**Mốc ngoài đứng riêng, không trộn vào tập nội bộ.** Màn hiện hai dòng: *dải nội bộ* và *mốc ngoài (nguồn: …, ngày …)*.
Trộn chúng thì một mốc ngoài nhập tay kéo được trung vị của lịch sử thật. ADR (d) chốt mốc ngoài một mình có được sinh nhãn
không; tài liệu này đề xuất KHÔNG — mốc ngoài chỉ hiện độ lệch, không sinh nhãn.

**Lưu gì.** Kết quả benchmark KHÔNG được lưu dưới dạng số. Trung vị của một tập lẻ LÀ một giá có thật, nên một cột
`trung_vi` là một bảng giá dạng rõ chưa khai. Khi cần lưu — nhãn làm đầu vào cho Risk Score ở S4b, hay bộ bằng chứng — S4
lưu `(rfq_id, line_no, supplier_id, nhan, phien_ban_phuong_phap, quan_sat_ids, moc_mo_gia)` trên bảng
`price_benchmark_results`. Bảng ấy không có cột số nào có đơn vị tiền. Tính lại từ `quan_sat_ids` phải ra đúng nhãn (L7).

**Hiện ở đâu.** Chỉ ở bảng so sánh và bảng xếp hạng SAU mở thầu, cho người giữ `bid.view`. Không có trên màn nhà cung cấp,
không có trong thông điệp mời BAFO (A5). Dải lịch sử (không có giá của gói đang xét) cũng hiện được ở màn tạo gói cho người
giữ `bid.view` — đó là giá của những gói đã mở.

### 4.7. Mốc giá ngoài

**`external_price_references`** — theo tổ chức, chỉ-ghi-thêm, có hàng rút:

| Cột | Ghi chú |
|---|---|
| `canonical_item_id`, `don_gia`, `don_vi`, `tien_te` | Đơn vị quy đổi được theo §4.2, không thì từ chối khi ghi |
| `nguon text` | `CHECK` không rỗng. Hình dạng tối thiểu (tên nguồn, đường dẫn…) do ADR (d) chốt |
| `ngay_hieu_luc` | Ngày của mức giá, không phải ngày nhập |
| `tac_gia`, `session_id`, `seq`, `ghi_luc` | Luật mù §3.3 áp nguyên |

Nhập tay trên màn, và nhập hàng loạt bằng DÁN văn bản CSV vào một ô: thân JSON, không multipart. Như vậy S4 không chờ ADR (c)
của S3 về tải tệp, và không đụng điều kiện xét lại tầng HTTP của ADR-020.

Không nguồn nào được lấy tự động, không cào web, không gọi API giá thị trường — những thứ ấy là tích hợp, tức S5.

### 4.8. TCO — nới tập thành phần của Effective Cost

ADR-053 ⑶ đã nói vì sao hôm nay chỉ chấm được `gia`: *"một báo giá hôm nay chỉ mang đúng một số tiền mà hệ thống đọc được"*.
S4 thêm nguồn, và mỗi mã thành phần mới phải có ĐÚNG MỘT nguồn đọc được:

| Mã | V2.1 §16 | Nguồn | Đơn vị |
|---|---|---|---|
| `gia` | Unit Price | `totalAmount` (`020`), như hôm nay | `TIEN` |
| `van_chuyen` | Freight | Ô nhà cung cấp khai trong phong bì: `freight` | `TIEN` |
| `thue` | Tax | Ô khai: `tax` | `TIEN` |
| `nhap_khau` | Import Cost | Ô khai: `importCost` | `TIEN` |
| `chi_phi_thanh_toan` | Payment Cost | Quy đổi: max(0, `ngay_thanh_toan_chuan` − `paymentDays` (khai)) × `chi_phi_von_nam` / 365 × `totalAmount` — chi phí vốn khi phải trả SỚM hơn kỳ chuẩn của tổ chức | `TIEN` |
| `chi_phi_tre` | Delay Cost | Quy đổi: max(0, `leadTimeDays` (khai) − số ngày giao yêu cầu của GÓI) × `chi_phi_tre_ngay` | `TIEN` |
| `chat_luong` | Quality Cost | **Không có nguồn tới S5** — cần tỷ lệ lỗi từ GRN | — |

Ba luật:

- **Ô khai là tuỳ chọn và chỉ hiện khi chính sách bật mã ấy** (ràng buộc 11). Bật mà nhà cung cấp để trống thì dòng ấy
  từ chối chấm, gọi tên mã thiếu. Không lấy `0` — ADR-053 ⑶ đã giải thích vì sao.
- **`chat_luong` không khai được.** Chính sách khai nó thì bị từ chối ngay khi TẠO phiên bản, bằng một câu gọi tên *"chưa có
  nguồn dữ liệu"*. Như vậy lỗi lộ ra ở lúc cấu hình, không ở lúc chấm.
- **Tham số quy đổi là của bên mua** và nằm trên phiên bản chính sách, nên chúng vào bộ bằng chứng cùng phiên bản (ADR-059).
  Mặc định `NULL`. Một tổ chức muốn cộng chi phí thanh toán phải tự khai chi phí vốn. Rủi ro *"khai đại cho xong"* của
  spec S2 §8.2 áp nguyên, và §8.6 bàn nó.

**Số ngày giao yêu cầu là của GÓI, không của chính sách.** `rfq_packages` không có cột ấy. S4.7 thêm một bảng riêng, chỉ sửa
ở `DRAFT` bằng trigger riêng — cùng lý do spec S3 §4.3 cho `category_id`: khối *"chỉ sửa ở DRAFT"* của thân ghim chỉ phủ
`title` và `requires_dual_approval`. Con số ấy hiện cho nhà cung cấp ở màn nộp thầu, cạnh ô `leadTimeDays`. Hai công thức
quy đổi ở bảng trên là GIẢ ĐỊNH, chốt ở S4.7.

Mọi ô khai đọc bằng bộ đọc SQL khuôn `bid_so_tien`, và `CHECK` hình dạng của `components` (`057`) nới theo tập mã. J1 và J2
giữ nguyên mệnh đề. Chỉ bảng ca và hàm đọc đổi.

### 4.9. S4b — Supplier Score, Risk Score, phân tích người mua

Phần này ở mức HÌNH DẠNG. Chi tiết chốt ở một lượt soi riêng khi cổng (e) đạt, vì các con số của nó chỉ hiệu chỉnh được trên
dữ liệu thật.

**Supplier Score (V2.1 §13).** Trọng số là khoá `diem_ncc jsonb` trên phiên bản chính sách. Tám thành phần của V2.1 §13 chia
theo nguồn:

| Thành phần | Nguồn trong S4 |
|---|---|
| Price Competitiveness | Nhãn và độ lệch benchmark (§4.6), thứ hạng Effective Cost (`rfq_evaluation_lines`) |
| Commercial Terms | Ô khai TCO (§4.8) |
| Compliance | Xác minh/thẩm định còn hiệu lực (S3.7) |
| Responsiveness | View hiệu suất (S3.8) |
| Warranty | Ô khai `warrantyMonths` — chưa có ở §4.8; lượt soi của S4b chốt có thêm không |
| Risk | Risk Score |
| Quality · Delivery | **Không có nguồn tới S5** |

Luật fail-closed của ADR-053 ⑶ áp ở mức CHÍNH SÁCH: phiên bản khai trọng số cho một thành phần không có nguồn thì bị từ
chối. Nên mặc định 25/20/20/10/10/5/5/5 của V2.1 §13 **không khai được nguyên văn trong S4** — 40% trọng số của nó
(Quality 20% + Delivery 20%) không có dữ liệu. Tài liệu này không chia lại 40% ấy cho các thành phần còn lại. Làm thế là bịa
một bộ trọng số mà V2.1 không có, và chính lượt soi của S4b phải chốt nó.

**Risk Score (V2.1 §17, §19).** Điểm 0–100 là tổng có trọng số của các YẾU TỐ. Mỗi yếu tố mang đủ năm trường V2.1 §19 đòi —
nguồn, thời điểm, bằng chứng, độ tin cậy, giải thích — đúng hình dạng `governance_signals` của spec S3 §4.6. Yếu tố của S4b,
theo thứ tự ADR-058 ⑸:

1. độ lệch benchmark của báo giá thắng (§4.6);
2. khoảng cách giá thắng–giá nhì;
3. ma trận tỷ lệ thắng: người mời × nhà cung cấp, và xoay vòng thắng thầu;
4. mức tập trung nhà cung cấp theo hàng chuẩn;
5. thời điểm nộp và số lần sửa sát hạn (V2.1 §11). Chỉ đọc gói `≥ CLOSED` (A6), và phiên bản BAFO chỉ khi vòng đã đóng;
6. tín hiệu governance của S3 — chia nhỏ, ngoại lệ, thu hẹp danh sách, đóng sớm — dùng làm đầu vào, không tính lại.

Luật trình bày:
- Yếu tố dưới sàn lịch sử hiện `CHUA_DU_LICH_SU` và KHÔNG góp điểm. Nó cũng không góp `0` — `0` sẽ đọc là *"rủi ro thấp"*.
- Điểm đi kèm tỷ lệ trọng số THỰC SỰ có dữ liệu. *"24/100 trên 35% trọng số có dữ liệu"* là một câu khác hẳn *"24/100"*.
- Mức `THAP` / `VUA` / `CAO` do ngưỡng trên phiên bản chính sách quyết định, GIẢ ĐỊNH.
- Chữ trên màn theo PRODUCT §5: *"điểm rủi ro — chỉ báo cần xem xét"*, không bao giờ là *"gian lận"*.

**Cấm duyệt một chạm cho gói rủi ro `CAO` (V2.1 §24)** — hạng mục đầu của S4b, vì spec S3 §10 đã chuyển nó sang đây. Chữ ký
duyệt trao thầu của một gói mức `CAO` cần đủ ba thứ, tính lại lúc ký theo khuôn fail-closed của K10:
- MFA trong cửa sổ `MFA_FRESH` (tái dùng `gate.ts`);
- giải trình không rỗng;
- một hàng ghi nhận cho TỪNG yếu tố mức đỏ, do người nằm ngoài `{người tạo gói, người gây ra yếu tố}`.

Phần này dựng trên cổng trao thầu mà S3.5 dựng lại, nên nó không bắt đầu trước S3.5.

**Phân tích người mua (V2.1 §20 *Buyer anomaly*).** Ma trận người mời × nhà cung cấp — tỷ lệ mời, tỷ lệ thắng, trên gói `≥
UNSEALED` — cùng xu hướng theo thời gian. Đây là dữ liệu VỀ NHÂN VIÊN. Cổng đọc là `audit.read` (`FINANCE`, `DIRECTOR`),
không phải `bid.view`, nên một PM không đọc được bảng phân tích chính mình. Nó là dữ liệu cá nhân theo nghĩa pháp luật — xem
§8.7.

---

## 5. Bất biến nghiệp vụ mới — nhóm L

Mười hai bất biến, nhãn `L`. Mỗi cái phải có một phép đo THẬT, một đối chứng DƯƠNG và một đột biến giết được nó, theo đúng
`docs/TEST-PLAN.md` §1. Hàng L vào sổ đăng ký của TEST-PLAN từng hàng, SAU KHI hàng ấy được đo, ở đúng hạng mục đo được nó
(khuôn nhóm J ở S1.115 và luật spec S3 §5.1). Hàng nào chỉ đo được một nửa ở hạng mục đầu thì tách làm hai.

| Mã | Mệnh đề | Cưỡng chế ở đâu | Hạng mục |
|---|---|---|---|
| **L1** | **Dữ liệu nền mù.** Mọi hàng ánh xạ, bí danh, quy đổi riêng, mốc ngoài mang `ghi_luc` do trigger đặt; benchmark và quy đổi của gói X chỉ đọc hàng có `ghi_luc` trước mốc mở giá của X, trừ hàng mang nhãn `SAU_MO_GIA` hiện cạnh con số; ánh xạ ghi khi gói đã `≥ UNSEALED` có lý do không rỗng; benchmark của X hiện số quan sát có ánh xạ ghi sau mốc mở giá của CHÍNH gói chứa quan sát ấy (ánh xạ hồi tố); nhãn đi tới màn hình và bộ bằng chứng | Trigger trên bốn bảng mới; `ghi_luc` ngoài `GRANT`; vị từ thời điểm trong view | S4.2–S4.6 |
| **L2** | **Không gộp lặng lẽ.** Ánh xạ `TU_DONG` chỉ tồn tại khi `do_tin_cay ≥ nguong_tu_dong` của phiên bản chính sách, và không thuộc tính trọng yếu nào thiếu hay mâu thuẫn; mọi hàng `TU_DONG` tái lập được — `chuanHoa` phiên bản đã lưu, trên `dau_vao` đã lưu, ra đúng hàng chuẩn và độ tin cậy ấy | `CHECK`/trigger cho ngưỡng; test tái lập khuôn J2 trên dữ liệu đọc từ CSDL; bảng ca ghim theo phiên bản | S4.3 |
| **L3** | **Người đặt thước không cầm thứ bị đo.** Người ghi ánh xạ `NGUOI_DUYET` giữ `item.manage` và nằm ngoài {người tạo gói, mọi `invited_by`, mọi `revoked_by`} của gói ấy; `item.manage` không đứng cùng `rfq.create` hay `rfq.invite`, ở vai và ở người | Trigger đọc dữ liệu THẬT (ADR-051); hai trigger khuôn `033` | S4.0 (vai), S4.3 (hành vi) |
| **L4** | **Quy đổi không đoán.** Quy đổi chung chỉ giữa hai đơn vị cùng thứ nguyên của `uom_units`; đơn vị đóng gói hay khác thứ nguyên chỉ qua `item_uom_conversions` của đúng hàng chuẩn; mọi cặp khác cho `KHONG_QUY_DOI_DUOC`, không bao giờ cho hệ số `1` | Hàm SQL quy đổi DUY NHẤT; bảng ca biên | S4.1 |
| **L5** | **Nguồn quan sát.** Mỗi hàng `HOP_LE` của `price_observations` là vị thế CUỐI CÙNG của một nhà cung cấp trong một gói `≥ UNSEALED` mà mọi vòng BAFO đã đóng; dòng không đọc được, lệch tổng, lệch tiền tệ, không quy đổi được hay chưa ánh xạ thì mang đúng mã lý do và không vào benchmark | `bid_don_gia` + vị từ trong thân view | S4.4 |
| **L6** | **Bí mật giá lan sang dữ liệu nền.** Không route nào trả lịch sử giá, benchmark, mốc ngoài, điểm hay phân tích cho phiên khách hay phiên Passport; không route nào trả dữ liệu từ gói `< UNSEALED` hay vòng BAFO đang mở; lịch sử và benchmark đọc bằng `bid.view`, phân tích người mua bằng `audit.read`; không màn nhà cung cấp nào mang tín hiệu benchmark | Vị từ trong view; policy khách `RESTRICTIVE` trên mọi bảng mới; vòng quét route khuôn A2/J4 **có đối chứng dương**: bộ quét phải THẤY quan sát của một gói ngay sau khi gói ấy `UNSEALED` và vòng BAFO đóng, chứ không chỉ không thấy trước đó | S4.4, S4.5 |
| **L7** | **Benchmark tái lập, không tự so.** Mọi nhãn benchmark tính lại được từ `quan_sat_ids` + phiên bản phương pháp + cửa sổ ra đúng nhãn đã lưu; tập ấy không chứa quan sát nào của chính gói đang xét; dưới `san_quan_sat` thì nhãn là `CHUA_DU_LICH_SU` và không có con số | Lõi thuần + test tái lập; `price_benchmark_results` không có cột tiền | S4.5 |
| **L8** | **TCO có nguồn.** Mỗi thành phần `TIEN` của `components` có đúng một nguồn đọc được — ô khai qua bộ đọc SQL, hoặc quy đổi từ ô khai theo tham số của phiên bản chính sách; chính sách khai một mã không có nguồn thì bị từ chối lúc tạo phiên bản; J1 và J2 giữ nguyên mệnh đề trên tập mã mới | `CHECK` phiên bản chính sách; trigger J1 nới; bảng ca J2 nới | S4.7 |
| **L9** | **Supplier Score tái lập, không bịa thành phần.** Điểm tính lại được từ đầu vào + trọng số của phiên bản; phiên bản khai trọng số cho thành phần không có nguồn bị từ chối; dưới sàn thì không có điểm | Lõi thuần; `CHECK` phiên bản | S4b |
| **L10** | **Risk Score là một tổng giải thích được.** Mỗi yếu tố mang năm trường V2.1 §19; điểm tính lại được; yếu tố dưới sàn không góp điểm; điểm luôn đi kèm tỷ lệ trọng số có dữ liệu; nhãn thuộc tập đóng | Lõi thuần; `CHECK` trên bảng yếu tố | S4b |
| **L11** | **Không duyệt một chạm ở rủi ro cao.** Chữ ký duyệt trao thầu của gói mức `CAO` cần MFA trong cửa sổ `MFA_FRESH`, giải trình không rỗng, và ghi nhận từng yếu tố đỏ bởi người ngoài {người tạo gói, người gây ra yếu tố}; mức được tính LẠI lúc ký | Trigger riêng trên chữ ký trao thầu (khuôn `014` §(4)), dựng sau S3.5 | S4b |
| **L12** | **Từ chối vào sổ.** Mọi lần từ chối QUYỀN của S4 để lại `PERMISSION_DENIED`; mọi lần từ chối vì một chốt của S4 (ánh xạ bởi người bị loại, thiếu MFA ở rủi ro cao…) để lại `CONTROL_DENIED` chỉ mang mã chốt; từ chối vì CẤU HÌNH chưa sẵn sàng (chính sách chưa khai nhóm khoá) thì không | Khuôn K12 + ADR-060 + ADR-084 ⑷ | Mỗi hạng mục từ S4.2 |

**L1 và L3 là cặp trung tâm của S4a.** Cùng nhau, chúng biến *"dữ liệu nền không bị chỉnh để hợp thức hoá một giá"* từ một
lời hứa thành hai phép đo. L1: không ai chỉnh được thước SAU khi thấy giá mà không để lại nhãn. L3: người chọn người dự thi
không tự đặt thước TRƯỚC khi có giá. Chúng không đo được một người quản lý dữ liệu thông đồng với người tạo gói — §8.2.

---

## 6. Kiến trúc kiểm thử

Không có khuôn mới. T4 (Playwright) vẫn **chưa dựng**, đúng như spec S3 §6 đã sửa, nên vế giao diện là **lượt đi thử có biên
bản** cho mỗi hạng mục có màn (khuôn S1.97).

- **T1** — bảng ca của `chuanHoa`, ghim theo phiên bản bộ chuẩn hoá. Có ca `đ`, ca bí danh mơ hồ (`MT`), ca thuộc tính trọng
  yếu mâu thuẫn (D10 với D12), ca bốn cách viết của V2.1 §14. Bảng ca của `benchmark`: tập lẻ, tập chẵn, dưới sàn, có quan
  sát của chính gói. Bảng ca quy đổi ở biên.
- **T2** — vòng quét route cho L6, **có đối chứng dương**, cùng yêu cầu spec S2 §6 đặt cho J4. Chạy cả lúc `BAFO_OPEN`.
- **T3** — mọi trigger trên Postgres thật. L1 đo bằng ghi ánh xạ ở đúng hai phía của mốc mở giá, cộng một ca ghi TRONG lúc
  giao dịch mở thầu đang chạy — hai giao dịch xen nhau, khuôn khoản 127 — để đo chiều sai lệch §3.3 nói.
  `bid_don_gia` đo bằng một phong bì do test tự dựng với `lines` xấu: phần tử trùng, `lineNo` lạ, Σ lệch, tiền tệ lệch,
  bốn ca của `bid_so_tien`.
- **Bước 14 của kịch bản 41** — nới `relkind` theo ADR (c), và chạy SAU một lượt đọc lịch sử giá thật. Đối chứng: một
  materialized view dựng tạm trong test mang một giá phải làm dòng ấy đỏ.
- **T5 — bốn mũi đối kháng**, mỗi mũi một cách chỉnh thước ở §3.3:
  - ⑴ ánh xạ sang hàng đắt SAU khi mở giá;
  - ⑵ người tạo gói tự ánh xạ;
  - ⑶ khai hệ số quy đổi lệch sau khi mở giá;
  - ⑷ nhà cung cấp đầu độc lịch sử bằng `lines` hợp tổng mà lệch từng dòng — mũi này KHÔNG bị chặn, và đo xem trung vị giữ
    được đến đâu (§8.4).
- **Đột biến** — mỗi L một con. Ít nhất một con mỗi trigger phải đi qua lớp CSDL bằng cách tắt trigger lúc chạy, khuôn
  `db/hardening-suy-tu-tinh-chat.int.test.ts`. Đột biến sửa migration sẽ sống GIẢ, vì hardening tự chữa (bẫy S1.86).
- **Cụm test hiện có là đối chứng của lời khai *"không cần công tắc"*** (§2.3) — nó phải xanh nguyên văn sau mỗi S4.x.

---

## 7. Điều kiện hoàn thành

### 7.1. S4a

S4a xong khi câu dưới chạy được một lần, đầu tới cuối, **trên giao diện**, không bước nào cần người của dự án gõ lệnh:

> Người quản lý dữ liệu của một tổ chức khai hàng chuẩn *"Thép thanh vằn D10 CB300 — Hòa Phát"*, đơn vị gốc `kg`, kèm quy
> đổi riêng *1 cây = 7,22 kg*. Ba gói cũ đã mở niêm phong mua mặt hàng ấy dưới ba cách viết: *"Thép Hòa Phát D10"* theo `kg`,
> *"Thep HP phi 10"* theo `tấn`, *"D10-HP"* theo `cây`. Bộ chuẩn hoá ánh xạ tự động hai dòng đầu. Dòng thứ ba vào hàng đợi,
> và người quản lý dữ liệu duyệt nó TRƯỚC khi gói mới mở niêm phong.
> Một gói mới có ba hạng mục. Nhà cung cấp A báo đơn giá thấp nhất nhưng khai phí vận chuyển; B cao hơn 3% đơn giá và miễn
> vận chuyển; C báo thép cao hơn trung vị nội bộ 12%.
> Sau mở niêm phong, bảng so sánh hiện dải nội bộ của dòng thép quy về VND/kg, và dòng của C mang nhãn *"Giá bất thường — nên
> xem xét"*. Bảng xếp hạng Effective Cost đặt B trên A và hiện từng thành phần.
> Bộ bằng chứng xuất ra tính lại được, khi đã ngắt CSDL, cả nhãn benchmark lẫn Effective Cost — và trả lời được *dòng
> "D10-HP" do ai ánh xạ, lúc nào, trước hay sau khi mở giá*.

Vế cuối là điều kiện nghiệm thu thật, cùng cách spec S2 §7 và spec S3 §7 đặt: không phải *"có benchmark"* mà *"benchmark ấy
tái lập được từ dữ liệu, và thước đo của nó có dấu thời gian đối chiếu được với lúc giá lộ"*.

Vai từng bước, dưới mặc định §4.1 và bảng mã quyền đề xuất ở §9 S4.0:

| Bước | Ai | Vì sao phải là người ấy |
|---|---|---|
| Khai hàng chuẩn, quy đổi, duyệt ánh xạ | F1 (giữ `item.manage`) | Không giữ `rfq.create`/`rfq.invite` (L3) |
| Khai phiên bản chính sách có nhóm khoá S4 | F2 (`policy.manage`) | Ở tổ chức đã bật S3: cần thêm chữ ký thứ hai của một người khác F2 (ADR-082 ⑺) |
| Tạo gói, mời | P1 | — |
| Ký, mở gói | P2 (PM) | Sàn một chữ ký (ADR-085) |
| Mở niêm phong | D1, D2 | D2 |
| Đọc benchmark, chấm | P2 hay F2 | `bid.view` |

S4a không thêm người vào kịch bản của MVP1 ngoài F1. Có thể F1 là F2, tuỳ bảng mã quyền chốt ở S4.0.

### 7.2. S4b

Khi cổng (e) đạt, kịch bản là V2.1 §41, trên dữ liệu của tổ chức đã vượt sàn:

> Gói 1 tỷ, năm nhà cung cấp. Sau hạn nộp, màn tổng quan hiện giá thấp nhất, benchmark, Supplier Score, lịch sử mua, Risk
> Score kèm tỷ lệ trọng số có dữ liệu, và số lần sửa báo giá. Hệ thống đề xuất B dù A có đơn giá thấp nhất. Gói ở mức `CAO`,
> nên người duyệt trao thầu không ký được bằng một chạm: phải qua MFA, viết giải trình, và ghi nhận từng yếu tố đỏ.

V2.1 §41 còn có *supplier relationship*. Vế ấy thuộc §18, ngoài S4 (§2.2 ⑴). Kịch bản S4b không có nó, và màn tổng quan
không hiện một ô trống mang tên nó.

---

## 8. Rủi ro

### 8.1. Dữ liệu nền bẩn — rủi ro chi phối

Hàng chuẩn khai sai, bí danh gộp nhầm hai mặt hàng, quy đổi sai hệ số — S4 cưỡng chế đúng như khai, và benchmark trông có cơ
sở. Không lớp nào của S4 phán được một hàng chuẩn là *đúng*: đó là tri thức của khách hàng.

Thứ S4 làm được:
- ⑴ không gộp khi thuộc tính trọng yếu thiếu hay mâu thuẫn (L2);
- ⑵ mọi con số hiện kèm nguồn — số quan sát, cửa sổ, ai ánh xạ;
- ⑶ ba tỷ lệ hiệu chỉnh ở §4.1 hiện trên màn quản lý dữ liệu;
- ⑷ dưới sàn thì không có con số.

### 8.2. Người quản lý dữ liệu là một điểm tin cậy mới

L3 tách người quản lý dữ liệu khỏi người chọn. Nó không chặn được hai người ấy bàn nhau: người tạo gói nói trước mức giá đã
thống nhất, người quản lý dữ liệu ánh xạ sẵn sang hàng đắt — cả hai TRƯỚC khi có giá, nên L1 không thấy gì. Thứ còn lại:
- ánh xạ nào cũng có chủ thể và thời điểm;
- lượt kiểm toán sau đọc được *"ánh xạ dòng này sang D32 trong khi mô tả ghi D10"*, vì thuộc tính trích được nằm trong
  `dau_vao`;
- S4b có thể thêm một yếu tố *"ánh xạ lệch thuộc tính trích được"*.

Đây là cùng giới hạn spec S3 §8.7 nói về khai báo xung đột: **trách nhiệm, không phải phát hiện**. Khi S4.3 vào mã,
`docs/PRODUCT.md` §5 có dòng tương ứng: *"chuẩn hoá dữ liệu chống thao túng giá"* → *"thước đo được chốt trước khi giá lộ,
và mọi lần sửa thước để lại dấu"*.

### 8.3. Benchmark trên tập rỗng

Chưa có pilot (PRODUCT §10). Mọi phép đo của S4a chạy trên dữ liệu tổng hợp, và tài liệu này nói thẳng điều ấy — đúng bẫy
ADR-058 ⑷, chấp nhận có ý thức ở §2.2 ⑶. Hai hệ quả bắt buộc, khuôn spec S3 §8.3: dưới sàn thì hiện *"chưa đủ lịch sử"*
chứ không hiện số; và không tham số nào ở §4.1 được gọi là *đã hiệu chỉnh* trước khi có dữ liệu thật.

Một tổ chức mới bật S4 có ZERO quan sát, nên mọi dòng hiện *"chưa đủ lịch sử"* cho tới khi đủ số gói. Mốc ngoài (§4.7) là
thứ DUY NHẤT cho ra một phép so từ ngày đầu. Đó là lý do chủ dự án chọn nó (§2.2 ⑷), và cũng là lý do ADR (d) nặng.

### 8.4. Nhà cung cấp đầu độc lịch sử

`lines[]` là thứ nhà cung cấp tự dựng trong trình duyệt. Một phong bì hợp tổng mà dồn giá vào một dòng vẫn qua được
`bid_don_gia`, và kéo lịch sử của hạng mục ấy. Không có cách nào kiểm được *"giá từng dòng là thật"* — nó là lời khai của
nhà cung cấp, như chính tổng giá. Thứ giảm thiểu:
- ⑴ trung vị và tứ phân vị thay cho trung bình (§4.6);
- ⑵ chỉ vị thế cuối cùng được tính, nên mỗi (gói, nhà cung cấp) góp đúng một quan sát cho mỗi dòng;
- ⑶ mũi T5 ⑷ đo trung vị giữ được tới tỷ lệ đầu độc nào.

Không có ngưỡng nào ở đây được khai là *an toàn*.

### 8.5. Mốc giá ngoài chỉ chặn được đến đâu

ADR-058 nói *"chỉ một mốc giá ngoài hệ thống mới bắt được"* khi cả pool cùng một đội. Mốc ngoài của §4.7 do chính bên mua
nhập. Một người mua muốn hợp thức hoá giá của cả pool sẽ nhập một mốc cao, hoặc không nhập gì. L1 chặn việc nhập mốc SAU
khi thấy giá. L3 — nếu ADR (d) chốt mốc ngoài dưới `item.manage` — chặn người chọn tự nhập. Không gì chặn việc KHÔNG nhập.
Vì vậy câu của ADR-058 vẫn đúng: mốc ngoài của S4 là một điều kiện cần, và nó chỉ đủ khi người nhập nó độc lập với người
chọn.

### 8.6. TCO: tham số bịa trông như số đo

Spec S2 §8.2 đã gọi tên rủi ro này, và §4.8 trả lời bằng đúng cách của nó: mặc định chỉ có `gia`, mọi tham số `NULL`,
thành phần nào cũng hiện trên bảng xếp hạng. S4 thêm một điều: tham số quy đổi hiện NGAY CẠNH con số nó sinh ra — *"chi phí
thanh toán = (kỳ chuẩn 60 ngày − 15 ngày khai) × 12%/năm × tổng giá (chính sách v7)"* — để người đọc thấy phần nào là số đo, phần nào là số khai.

### 8.7. Phân tích người mua là giám sát nhân viên

Ma trận người mời × nhà cung cấp là dữ liệu về hành vi của một người có tên. Việc thu thập và xử lý nó, theo pháp luật về bảo
vệ dữ liệu cá nhân của Việt Nam, có thể cần căn cứ và thông báo cho người lao động. Tài liệu này KHÔNG trả lời câu hỏi pháp
lý ấy, và không hạng mục S4b nào về phân tích người mua bắt đầu khi nó chưa được trả lời. Ghi vào `docs/TIEN-DE-CHUA-DO.md`
như một tiền đề, cùng câu hỏi cho người mua thật: *"Nhân viên mua hàng của anh có biết và đồng ý việc phân tích tỷ lệ chọn
nhà cung cấp của từng người không?"*

### 8.8. Hai lát cắt song song trên một lược đồ

§3.4 liệt kê chỗ đụng. ADR-090 gỡ phần đổi số: số vòng, ADR, khoản nợ và migration do `pnpm cap-so` cấp lúc merge. Nhưng
ADR-090 không gỡ được xung đột NGỮ NGHĨA — hai migration cùng thêm khoá vào `org_procurement_policies`, hai lớp cùng thêm
vào bộ xuất. Luật nhường của ADR (a) — S4 nhường S3 khi đụng cùng bảng hay cùng hàm ghim — là để chặn điều đó, và cái giá
của nó là S4a chậm lại đúng ở những chỗ ấy.

### 8.9. Nới dải nhãn lật một phép đo đang đúng

`tools/inv-matrix/src/parse.test.ts` hôm nay có một ca khẳng định *"không nhóm nào mang chữ `L`"*: dải nới quá tay thành
`[A-HJ-L]` phải làm ca ấy đỏ. S4.0 nới đúng thành `[A-HJ-L]`, nên nó phải LẬT ca ấy thành biên mới (`M`) trong cùng commit.
Nếu không, bộ đọc sẽ lờ hàng L1 và L1 vào sổ mà không có ô — đúng lỗi khoản **229**. Chữ `L1`…`L4` cũng đang được dùng làm
nhãn phát hiện trong một biên bản của `evidence/security-reviews.md`. Bộ đọc chỉ đọc `docs/TEST-PLAN.md`, nên hai thứ không
va nhau; S4.0 đo lại điều ấy thay vì tin nó.

---

## 9. Phân rã công việc

V2.1 §33 đặt MVP3 là 6–10 tuần cho cả mười mục. Tài liệu này ước **S4a 4–6 tuần**, S4b không ước — S4b chưa có ngày bắt đầu,
vì nó chờ cổng (e). Đây là ước lượng cùng loại với spec S3 §9, không phải số đo. Số đo duy nhất trong kho vẫn là S2: ước 3–4
tuần, chạy hết khoảng 41 giờ qua 14 vòng (S1.101–S1.114).

| # | Hạng mục | Ra cái gì |
|---|---|---|
| **S4.0** | Nền | Chốt ADR (a)–(d). Nới dải nhãn `[A-HJK]` → `[A-HJ-L]` ở MỌI chỗ ghim — grep lúc làm; hôm nay `A-HJK` có mặt ở 8 tệp, 18 dòng — và lật ca biên `L` của `parse.test.ts` (§8.9), trước khi hàng L đầu vào sổ. Bảng mã quyền: đề xuất ĐÚNG MỘT mã mới, `item.manage`, theo nguyên tắc ADR-084 ⑴ — chỉ thêm mã khi hành vi cần TÁCH NGƯỜI; đọc lịch sử và benchmark dùng `bid.view`, phân tích người mua dùng `audit.read`. Vai mặc định của `item.manage` là quyết định của chủ dự án: `FINANCE` (không giữ `rfq.create`, `033`, nhưng đã giữ `policy.manage`, `supplier.qualify`, `category.manage`) hay một vai mới trong danh mục toàn cục `005` KHÔNG giữ `bid.view` — vai ấy ánh xạ hồi tố mà không thấy giá (§3.3). Tạo `packages/du-lieu-nen` và ranh giới `depcruise` |
| **S4.1** | Đơn vị đo | `uom_units` gieo sẵn, `uom_aliases`, hàm quy đổi SQL duy nhất; nhóm khoá `chuan_hoa` trên chính sách; **L4** |
| **S4.2** | Hàng chuẩn | `canonical_items` + phiên bản + bí danh + `item_uom_conversions`; màn quản lý dữ liệu cho `item.manage`; **L1** vế bí danh và quy đổi |
| **S4.3** | Chuẩn hoá | Lõi thuần `chuanHoa` + bảng ca theo phiên bản; `rfq_item_mappings`; hàng đợi; chuẩn hoá sau commit cạnh nộp duyệt; **L2**, **L3**, **L1** vế ánh xạ; dòng PRODUCT §5 (§8.2) |
| **S4.4** | Lịch sử giá | `bid_don_gia`, chốt luật cắt hay luật tổng (§4.5), view `price_observations`; ADR (c) vào mã: dòng khai ở ADR-054, bước 14 nới `relkind` kèm đối chứng materialized view; đo thời gian đọc ở quy mô pilot; **L5**, **L6** vế lịch sử |
| **S4.5** | Benchmark | Lõi thuần `benchmark`, nhóm khoá `benchmark`, `price_benchmark_results`, hiện ở bảng so sánh và bảng xếp hạng; lớp dữ liệu nền trong bộ xuất ADR-059 kèm mục `DAC-TA.md`; **L7**, **L6** vế benchmark |
| **S4.6** | Mốc giá ngoài | `external_price_references`, nhập tay và dán CSV, hiện riêng cạnh dải nội bộ; theo ADR (d); **L1** vế mốc ngoài |
| **S4.7** | TCO | Ô khai trong `nop-thau.js` (tuỳ chọn, theo chính sách, khung 375×812), bộ đọc SQL cho từng ô, tập mã thành phần mới, nhóm khoá `tco`; từ chối `chat_luong`; **L8**. Đối chiếu với S3.5 trước khi sửa `057` (§3.4) |
| **S4b.0** | Cổng dữ liệu | Đo cổng (e) trên tổ chức thật; lượt soi hình dạng riêng cho §4.9 |
| **S4b.1** | Rủi ro cao không một chạm | **L11** — hạng mục S4b đầu tiên: nó chỉ cần mức `CAO`, và mức ấy tính được từ những yếu tố đã có dữ liệu, kèm tỷ lệ trọng số (L10) |
| **S4b.2** | Risk Score | Bảng yếu tố, lõi thuần, sáu yếu tố theo thứ tự ADR-058 ⑸; **L10** |
| **S4b.3** | Supplier Score | **L9** |
| **S4b.4** | Phân tích người mua | Chỉ sau khi câu hỏi pháp lý §8.7 có câu trả lời |

Mỗi hạng mục đi đúng vòng lặp bắt buộc ở spec S0+S1 §9: đo trước khi viết, một bất biến một phép đo, đột biến, rồi tài liệu.
Mọi trigger và hàm mới ghim ở `db/migrations/hardening.always.sql` trong CÙNG commit với migration — S1.96 đo được rằng
migration một mình là no-op.

---

## 10. Ngoài phạm vi tài liệu này

- **Đồ thị quan hệ nhà cung cấp** (V2.1 §18) và **tín hiệu danh tính** của §17 — trùng MST, tài khoản ngân hàng, người đại
  diện, địa chỉ, điện thoại, tên miền email. Chủ dự án không chọn phạm vi này (§2.2 ⑴). Khi tới lượt, thứ rẻ nhất và chịu
  lực nhất là tín hiệu trùng tài khoản ngân hàng hay địa chỉ giữa các nhà cung cấp CÙNG ĐƯỢC MỜI vào một gói. Nó đọc
  Passport của S3.7, trong một tổ chức, và nhắm thẳng vào kịch bản *"ba pháp nhân cùng một chủ"* mà ADR-058 nói không lớp
  nào của sản phẩm thấy.
- **Tín hiệu kỹ thuật** của §17 — IP, thiết bị, trình duyệt, metadata tệp. Cần thu dữ liệu mới từ phiên khách, và PRODUCT §5
  cấm đọc chúng thành kết luận. Thứ tự ADR-058 ⑸ đặt chúng sau cùng.
- **Benchmark xuyên tổ chức** (ADR-003) — cần thoả thuận dữ liệu và một ADR riêng về rò xuyên tổ chức, khuôn ADR-013.
- **Nguồn giá thị trường tự động** — API, cào web, sàn giao dịch. Là tích hợp, S5.
- **Supplier Performance từ ERP**, *Quality Cost* thực tế — S5.
- **Specification anomaly** (V2.1 §20) — *"specification thay đổi bất thường trước RFQ"*. Kho không lưu lịch sử sửa hạng mục
  ở `DRAFT`: `009` cho `DELETE` ở mức bảng. Muốn có tín hiệu này phải thêm một sổ sửa hạng mục trước.
- **Reverse Auction** (V2.1 §23) — spec S0+S1 §10 xếp S5.
- **ML, embedding, so nghĩa mô tả** — ADR (b), điều kiện mở lại.
- **Item master dùng chung, mã hàng chuẩn quốc gia/quốc tế (UNSPSC, HS)** — không phải một mục của §33. Nếu cần, nó là một
  cột tham chiếu trên `canonical_items`, không phải một danh mục toàn cục.
