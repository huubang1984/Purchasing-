# TrustProcure V2 — Thiết kế S4: Nền dữ liệu và Trí tuệ mua sắm (Data Foundation & Intelligence · MVP3)

> **Ngày:** 2026-09-26 · **Trạng thái:** ~~**BẢN NHÁP — chưa qua lượt soi hình dạng.**~~ **[S1.159] ĐÃ QUA LƯỢT SOI HÌNH
> DẠNG — 32 phát hiện, 10 CAO, ba lời khai đo trên Postgres 16 thật** (`evidence/security-reviews.md` §S1.159). Bốn quyết
> định của chủ dự án ở §2.2, bảy quyết định nữa sau lượt soi ở §2.4, và các chốt từ tiền lệ ở §2.5. ADR (a)–(d) của §2.3
> chốt thành **ADR-093…096**; quyết định và chốt của lượt soi ở **ADR-097**; ADR (e) chờ S4b. ~~Năm ADR phải chốt, bốn
> trong số đó trước dòng mã đầu (§2.3).~~ Chưa một dòng mã nào của S4 được viết.
> **[S1.159] Đọc §2.4, §2.5, §5.1 và bảng thay đổi của §9 cùng phần gốc**: phần gốc giữ nguyên văn, chỗ sai gạch tại chỗ,
> mệnh đề chịu lực là bản đã sửa.
> **Nguồn:** `TrustProcure_V2_Procurement_Control_Intelligence.md` (V2.1) — §33 *MVP 3 — Procurement Intelligence*,
> §13 *Supplier Intelligence*, §14 *Item Master & Normalization Engine*, §15 *Price Benchmark Engine*, §16 *Total Cost /
> TCO*, §17 *Risk Engine*, §19 *Risk Score mẫu*, §20 *AI / Analytics*, §24 *Executive Experience*, §41 *Kịch bản Demo*,
> §44 *Data Quality Before AI*. Bản nguồn KHÔNG nằm trong kho. Vòng này đọc bản trên Drive của chủ dự án (sửa lần cuối
> 2026-08-26), và đối chiếu được với mọi đoạn spec S3 trích từ nó: bốn bậc ở §12 11.1, bảy mã lý do ở §12 11.2, năm trường
> tín hiệu ở §19.
> **Đóng:** phần *"toàn bộ Intelligence"* mà spec S0+S1 §10 đẩy sang S4 · ~~các mục spec S3 §10 đẩy sang S4 — Risk Score,
> phát hiện bất thường, phân tích người mua, phát hiện xoay vòng bằng thống kê (ADR-058 ⑸), cấm duyệt một chạm cho gói rủi
> ro cao (V2.1 §24)~~ **[S1.159]** cấm duyệt một chạm cho gói rủi ro cao (V2.1 §24) — ở S4b.1, sau S3.5, không chờ cổng (e)
> (§2.4 ⑼) · ADR-053 ⑶ — Effective Cost chỉ chấm được thành phần `gia` · *"giá tham chiếu bên ngoài"* mà ADR-058
> gọi tên là S4.
> **[S1.159] Nhận về, chưa đóng:** Risk Score, phát hiện bất thường, phân tích người mua, phát hiện xoay vòng bằng thống kê
> (ADR-058 ⑸). Bốn mục ấy chỉ có HÌNH DẠNG ở §4.9 và chờ cổng (e); gọi chúng là *đóng* là hứa quá (góc D⑤).
> **Không đóng:** đồ thị quan hệ nhà cung cấp (§18) và tín hiệu danh tính, kỹ thuật của §17 — MST, tài khoản ngân hàng, địa
> chỉ, IP, thiết bị, metadata tệp (§2.2 ⑴); benchmark xuyên tổ chức (§2.2 ⑷); dữ liệu giao hàng, chất lượng, khiếu nại từ
> ERP (S5). Vì vậy *Quality* và *Delivery* của Supplier Score, và *Quality Cost* của TCO, không có nguồn trong S4 (§4.8,
> §4.9). **[S1.159]** Màn *Executive* của V2.1 §24 (§10).

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
chưa lớp máy chủ nào đọc: ~~grep `lines` trên `apps` và `packages`, trừ test, chỉ ra `apps/web/trang/nop-thau.js:297`~~
**[S1.159]** grep chỗ đọc `payload.lines` trên `apps` và `packages`, trừ test, chỉ ra `apps/web/trang/nop-thau.js:297` (grep
chữ `lines` trần còn ra tên biến ở `luot-danh-gia.ts`, không đọc phong bì), tức chỗ
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
| 11 | Friction thấp cho nhà cung cấp | PRODUCT §8 ⑴ | TCO thêm ô vào form nộp thầu. ~~Mọi ô ngoài đơn giá là TUỲ CHỌN, và~~ chỉ hiện khi chính sách bật đúng thành phần ấy. **[S1.159]** Chữ *tuỳ chọn* sai: §4.8 từ chối chấm khi một mã đã bật mà ô để trống, nên ô ĐÃ HIỆN là BẮT BUỘC (góc D⑪). Friction chỉ đến từ việc tổ chức bật mã |
| 12 | Nhóm hàng của S3 KHÔNG phải item master | spec S3 §4.3 | *"Ánh xạ hạng mục sang nhóm hàng chuẩn là S4"*. S4a ánh xạ hạng mục sang HÀNG CHUẨN; hàng chuẩn gắn nhóm hàng khi S3.6 có mã (§3.4) |

### 2.1. ADR-054 và ADR-058 ⑸ là hai tiền lệ chịu lực nhất

**ADR-054** kết thúc bằng câu: *"mỗi bảng như thế phải đi kèm một dòng trong bảng trên, và dòng ấy phải khai được vai ghi
cùng cổng đọc. Không khai được thì không thêm."* Lịch sử giá theo hạng mục là đúng loại dữ liệu câu ấy nói tới. Cổng đo nó
— bước 14 của kịch bản 41 — quét giá dạng rõ trên MỌI bảng, và khẳng định tập kết quả bằng `toEqual` vét cạn. Phép đo lúc
viết tài liệu này tìm ra một chỗ hở: câu truy vấn của bước 14 chỉ lấy `c.relkind IN ('r', 'p')`. ~~**Một materialized view
(`relkind = 'm'`) chứa giá dạng rõ sẽ đi qua cổng mà không làm dòng nào đỏ.**~~ **[S1.159] Câu vừa gạch nói quá.** Mục (C)
`CAU_DOC_VONG` của `hardening.always.sql` (`:845-852`) đã từ chối MỌI materialized view không có tên ở `NGOAI_LE_DOC_VONG`,
lúc `migrate()`. Chỗ hở thật hẹp hơn: một đối tượng dựng lúc chạy, ngoài migration, và ~~năm~~ **[S1.251] bốn** bộ quét — không phải một — cùng
dùng `relkind IN ('r','p')` (`kich-ban-41-http:1328`, `kich-ban-41:591`, `unseal-worker:876`, `luot-danh-gia.int:888`~~,
`db/unique-oracle.int:92`~~). **[S1.251 / S4.4b] Đo:** `db/unique-oracle.int` đọc `relkind` để dò oracle qua chỉ mục duy nhất (H14),
không kim, không giá — không phải bộ quét giá; chủ dự án chốt 2026-10-01 để nguyên nó. Bốn bộ quét giá nay gọi MỘT bộ quét chung
(`packages/test-support/src/quet-gia.ts`) trên `relkind` ∈ {`r`, `p`, `v`, `m`}, mỗi bộ thêm một kim đơn giá — ADR-140. Và bộ quét tìm một mốc TỔNG, nên nó mù với đơn giá và với mọi giá phái sinh (§2.5 ⒅).
§2.3 (c) chốt cả hình dạng lẫn chỗ hở ấy.

**ADR-058 ⑸** xếp thứ tự cho phần PHÁT HIỆN: khoảng cách giá thắng–giá nhì, rồi ma trận tỷ lệ thắng, rồi mới tới IP, thiết
bị, metadata. S4b đi đúng thứ tự ấy và dừng trước vế thứ ba (§2.2 ⑴). ADR-058 còn nói thẳng rằng khi cả pool cùng một đội
thì so giá của họ với nhau là vô nghĩa: *"chỉ một mốc giá ngoài hệ thống mới bắt được. Mốc ấy là S4 Data Foundation."*
Mốc giá ngoài của §4.7 là thứ ấy — và §8.5 nói nó bắt được đến đâu.

### 2.2. Bốn quyết định của chủ dự án, ngày 2026-09-26

| # | Câu hỏi | Quyết định | Hệ quả |
|---|---|---|---|
| ⑴ | Phạm vi | **Đủ mười mục của V2.1 §33, chia hai nửa.** S4a *Data Foundation*: Item Master, chuẩn hoá item, UOM, lịch sử giá, benchmark giá, TCO. S4b *Intelligence*: Supplier Score, Risk Score, phát hiện bất thường, Buyer Analytics. S4b chỉ mở khi có sàn dữ liệu. **[S1.162]** Supplier Score hoãn tới S5 (ADR-100, spec S4b §2.7 Q1) | Đồ thị quan hệ (§18) và tín hiệu danh tính/kỹ thuật của §17 KHÔNG thuộc S4 — §10. Cổng dữ liệu của S4b là ADR (e) |
| ⑵ | Runtime | **Giữ TypeScript + PostgreSQL.** Không service Python, không ML | Đảo phần *Hệ quả* của ADR-001 (*"Tới S4, tách một service Python riêng"*) — ADR (b). Chuẩn hoá bằng luật tất định cộng hàng đợi duyệt tay. Không thêm extension: grep `CREATE EXTENSION` trên `db/migrations` cho 0 kết quả, và S4 giữ nguyên con số ấy (§4.4) |
| ⑶ | Thời điểm | **S4a mở vòng song song S3, ngay sau lượt soi hình dạng** | Ngoại lệ thứ hai với ADR-043, sau ADR-080 — ADR (a). S4b KHÔNG thuộc ngoại lệ này |
| ⑷ | Nguồn benchmark | **Lịch sử của chính tổ chức, cộng mốc giá ngoài do khách nhập tay kèm nguồn** | Không truy vấn xuyên tổ chức. Câu *"giữ được khả năng truy vấn xuyên khách hàng cho benchmark ở S4"* của ADR-003 vẫn là một khả năng, không phải một hạng mục |

### 2.3. ~~Năm ADR phải chốt ở lượt soi hình dạng~~ [S1.159] Bốn ADR chốt ở lượt soi; ADR (e) chốt trước S4b.2

| ADR | Câu hỏi | Vì sao chặn |
|---|---|---|
| **(a)** | S4a mở vòng khi MVP1 chưa đóng và S3 đang chạy. Ngoại lệ HẸP với ADR-043, khuôn ADR-080 ⑴: chỉ các hạng mục S4.0–S4.7, không khoản rổ B nào khác. Dòng trỏ mảnh của mỗi vòng: *"không chạm mảnh nào của `PRODUCT.md` §11; chạy song song S3 dưới ADR (a)"*. **Điều kiện dừng:** nhường một khoản rổ A hay một vòng triển khai thật/pilot (khuôn ADR-080 ⑷), **và nhường S3.x khi hai bên sửa cùng một bảng hay cùng một hàm ghim** | ADR-043 là luật đang hiệu lực. ADR-080 chỉ mở cho S3.x. Không có ADR này thì vòng S4 đầu tiên ~~đúng là lỗ khoản 237~~ **[S1.159]** không có quyền mở vòng theo ADR-043, và dòng trỏ mảnh của nó không trỏ vào đâu — hình dạng mà khoản 237 đo. **CHỐT — ADR-093**, kèm luật dừng sửa theo góc D⑨ (§2.5 ⒆) |
| **(b)** | S4 giữ TypeScript + PostgreSQL, sửa phần *Hệ quả* của ADR-001. **Điều kiện mở lại:** hàng đợi duyệt tay của một tổ chức thật giữ quá N dòng quá M ngày (GIẢ ĐỊNH), hoặc một nhu cầu mà luật tất định không diễn đạt được — ví dụ so nghĩa giữa hai mô tả không có từ chung | ADR-001 đang nói ngược lại. Không sửa nó thì một vòng sau đọc ADR-001 sẽ dựng service Python. **[S1.159] CHỐT — ADR-094** |
| **(c)** | **Lịch sử giá có phải bảng giá dạng rõ thứ ba không.** Tài liệu này đề xuất KHÔNG: lịch sử giá theo hạng mục là một **view `security_invoker`** đọc `rfq_unsealed_bids.payload` qua một bộ đọc SQL (§4.5), và kết quả benchmark chỉ lưu THAM CHIẾU tới quan sát, không lưu số (§4.6). ADR phải: ⑴ khai view ấy như một ĐƯỜNG ĐỌC giá dạng rõ trong bảng của ADR-054, kèm cổng đọc; ⑵ nới bước 14 thêm `relkind IN ('v', 'm')` — view thường phải được khai, materialized view phải làm dòng ấy đỏ; ⑶ chốt bảng mốc giá ngoài (§4.7) có thuộc phạm vi A3/A4 không. Đề xuất: KHÔNG, vì nó không chứa giá của nhà cung cấp nào trong gói nào — nhưng vẫn khai nó ở ADR-054 như *"bảng giá không phải báo giá"*, để phép quét không phải đoán | Chọn sai thì hoặc có một bảng giá dạng rõ không ai khai, hoặc có một bảng đã khai mà không cần. Cả hai đều phải sửa migration sau khi đã áp. **[S1.159] CHỐT — ADR-095, và KHÔNG theo đề xuất của bản nháp:** view phẳng không diễn đạt được luật mù (góc B①), nên lịch sử giá là một HÀM as-of `quan_sat_gia(p_moc)`, không view, không bảng (§2.5 ⑿) |
| **(d)** | Mốc giá ngoài: ai nhập; nguồn bắt buộc đến đâu (văn bản tự do, hay tên nguồn cộng ngày cộng đường dẫn); mốc ngoài có được làm cơ sở DUY NHẤT cho một nhãn lệch không; thời hạn giữ; nhập hàng loạt bằng gì | Mốc ngoài là đầu vào DUY NHẤT của S4 mà bên mua tự gõ ra, và nó quyết định một nhãn. Đó đúng là hình dạng *"người đặt thước"* của `033`. **[S1.159] CHỐT — ADR-096**, cùng nguồn thứ ba *"lịch sử mua ngoài hệ thống"* của §2.4 ⑽ |
| **(e)** | **Cổng dữ liệu của S4b** — sàn tối thiểu để mở S4b: số gói đã `UNSEALED`, tỷ lệ hạng mục có ánh xạ hiệu lực, số tháng lịch sử, ở ít nhất MỘT tổ chức THẬT. Đề xuất GIẢ ĐỊNH: ≥ 30 gói `UNSEALED`, ≥ 60% hạng mục có ánh xạ hiệu lực, ≥ 6 tháng. Cộng điều kiện: S3.5–S3.8 đã có mã, vì S4b đọc bảng của chúng và dựng trên cổng trao thầu của S3.5 | Chỉ chặn S4b, không chặn S4a. Không có cổng này thì quyết định ⑴ (*"S4b chỉ mở khi có sàn dữ liệu"*) không có trạng thái *đạt* — đúng lỗi ADR-043 ⑷ đã đo. **[S1.159]** Vẫn mở, và hẹp lại: S4b.1 không còn chờ nó (§2.4 ⑼); sàn đo THEO TỪNG tổ chức, loại ánh xạ `NULL` khỏi tỷ lệ (§2.5 ㉕). **[S1.162] CHỐT — ADR-100**: ≥ 30 gói, ≥ 60% hạng mục, ≥ 6 tháng, ở ≥ 1 tổ chức thật; điều kiện kèm còn S3.5–S3.7, vì S3.8 chỉ phục vụ Supplier Score |

**Không cần công tắc theo tổ chức như ADR-080 — ĐỀ XUẤT, lượt soi phải kiểm.** Mọi hành vi mới của S4a hoặc CỘNG THÊM (ánh
xạ, lịch sử, benchmark là thứ hiện thêm sau khi mở niêm phong), hoặc TẮT mặc định (thành phần TCO ngoài `gia`, §4.8). Một
tổ chức không khai gì thì chạy đúng hành vi hôm nay. Phép đo của lời khai ấy là cụm test hiện có: nó phải xanh NGUYÊN VĂN
sau mỗi hạng mục S4.x — cùng yêu cầu spec S3 §8.11 đặt cho nhánh *chưa bật*. Có một ngoại lệ đã biết: §3.3 ⑵ đòi lý do cho
ánh xạ ghi sau khi mở niêm phong, và đó là một lần TỪ CHỐI mới. Nhưng nó chỉ chạm bảng mới của S4, không chạm đường nào của MVP1.

**[S1.159] Đoạn trên SAI ở ba chỗ, và một chỗ do chính quyết định của lượt soi.**
- ⑴ Quyết định §2.4 ⑸ — ghim phiên bản chính sách lúc gói vào `OPEN` — đổi lượt chấm của MỌI tổ chức. Một gói chấm dưới
  phiên bản tạo sau lúc gói mở sẽ bị từ chối, trong khi hôm nay nó đi qua (`luot-danh-gia.ts:131-138`). Đây là thay đổi hành
  vi của MVP1 mà chủ dự án chọn khi biết giá. Không có công tắc nào cho nó, vì một công tắc sẽ giữ nguyên đúng lỗ góc C①
  tìm ra.
- ⑵ S4 sửa trang của các bước trong kịch bản §11: `/mo-thau` (bảng so sánh theo dòng, benchmark), `/nop-thau` (ô TCO),
  `/tao-thau` (số ngày giao). Nên dòng *"không chạm mảnh nào"* hẹp hơn thực tế (góc D⑨).
- ⑶ Chính spec lật một số ca đang có: ca biên chữ `L` của `parse.test.ts` (S4.0), bước 14 của kịch bản 41 (S4.4), ca
  `kt`/`DIEM` của `luot-danh-gia.int.test.ts` nếu đường chấm đổi chỗ từ chối.

Thay *"xanh NGUYÊN VĂN"* bằng luật: mỗi hạng mục kê TÊN từng ca nó lật cùng lý do, mọi ca khác xanh nguyên văn; và mỗi hạng
mục chạm `/nop-thau` hay `/mo-thau` có một lượt đi thử luồng MVP1 ở khung 375×812 với tổ chức KHÔNG khai gì của S4.

### 2.4. [S1.159] Bảy quyết định NỮA của chủ dự án, sau lượt soi hình dạng

Lượt soi S1.159 tìm ra bảy chỗ là lựa chọn sản phẩm, không điền được từ tiền lệ. Chủ dự án chốt cả bảy ngày 2026-09-26,
đều theo đề xuất của lượt soi. Đầy đủ lý do ở **ADR-097**.

| # | Phát hiện | Quyết định |
|---|---|---|
| ⑸ | **Thước chính sách nằm ngoài luật mù** (CAO ①). Lượt chấm đọc phiên bản MỚI NHẤT (`luot-danh-gia.ts:131-138`) và chỉ chạy sau khi giá lộ. `FINANCE` giữ cùng lúc `policy.manage`, `bid.view`, `evaluation.perform`. Nên thấy giá rồi tạo phiên bản mới là đảo được hạng. Tệ hơn: bật một mã TCO sau khi nộp làm mọi báo giá thiếu ô bị từ chối chấm — trừ nhà cung cấp tự chèn ô ấy vào bản rõ, thứ trình duyệt của họ làm được | **Ghim phiên bản lúc gói vào `OPEN`.** Lượt chấm, TCO, benchmark và form nhà cung cấp của gói X dùng phiên bản mới nhất TẠO trước `opened_at` của X — đọc qua MỘT hàm SQL (§2.5 ⒆). Lượt chấm dưới phiên bản khác bị từ chối. Đảo lựa chọn *"đọc mới nhất"* của S2 cho MỌI tổ chức. Cái giá: gói mở trước khi tổ chức khai chính sách chấm thì không chấm được, và bị từ chối bằng một câu gọi tên |
| ⑹ | **`TU_DONG` là lối ghi CSDL không chốt được** (CAO ④). Độ tin cậy do ứng dụng khai; tác giả hàng `TU_DONG` là người tạo gói; trigger L3 phải miễn cho nó | **`TU_DONG` chỉ khi chuỗi đã làm sạch trùng CHÍNH XÁC một bí danh còn hiệu lực.** Bước làm sạch là MỘT hàm SQL, nên trigger kiểm lại được. Mọi khớp mờ, kể cả ≥ 95%, thành gợi ý chờ người quản lý dữ liệu. Ngưỡng 95/80 của V2.1 §14 rời chính sách, thành hằng GIẢ ĐỊNH của bộ luật gợi ý |
| ⑺ | **L3 đo sai đối tượng** (CAO ⑤). Thứ bị đo là quyết định TRAO THẦU, không phải việc tạo gói. Với `FINANCE`, một vai đặt mọi thước — chính sách, nhóm hàng, thẩm định, hàng chuẩn, mốc ngoài — rồi thấy giá, đề xuất và duyệt trao. Ánh xạ hồi tố lúc khởi động khi ấy luôn làm trong lúc nhìn thấy giá | **Vai mới *Quản lý dữ liệu* (`DATA_STEWARD`), mù giá.** Vai ấy giữ `item.manage` và KHÔNG giữ `bid.view`, `po.approve`, `award.recommend`, `rfq.create`, `rfq.invite`; trigger khuôn `033` cưỡng chế ở cả vai lẫn người. Cái giá: tổ chức cần thêm một người (§7.1) |
| ⑻ | **TCO thưởng người khai dối** (CAO ⑦). Mọi thành phần ngoài giá là lời tự khai. Khai phí vận chuyển 0 rồi tính bằng phụ lục là thắng | **Giữ, và lời khai thành cam kết.** Lời khai TCO của báo giá được đề xuất lưu cùng award và vào bộ bằng chứng như điều khoản cam kết. Nhãn *"theo lời khai của nhà cung cấp"*. Bảng xếp hạng hiện cả hạng theo `gia` lẫn hạng TCO; hai hạng khác nhau thì đề xuất trao phải có giải trình. Bỏ mã `thue`: thuế GTGT khấu trừ được không phải chi phí |
| ⑼ | **S4b fail-open theo độ phủ; L11 là ma sát của một người** (CAO ⑧). Yếu tố dưới sàn không góp điểm, nên tổ chức mới luôn ở mức `THAP`. Người ghi nhận yếu tố đỏ có thể chính là người duyệt. Và S4b.1 bị khoá sau cổng (e) không thời hạn | **Tách S4b.1 khỏi cổng (e), đặt sau S3.5.** Độ phủ dữ liệu dưới ngưỡng → mức `KHONG_XAC_DINH`, xử như `CAO`. Chữ ký trao ở mức ấy cần MFA trong cửa sổ, giải trình, và ghi nhận TỪNG yếu tố đỏ bởi người ngoài {người tạo gói, người gây ra yếu tố, người đề xuất, người duyệt}. Mức tính trên đầu vào ĐÓNG BĂNG tại mốc mở giá. Cái giá: tổ chức mới chịu ma sát ở mọi lần trao |
| ⑽ | **Lịch sử mua ngoài hệ thống — nguồn đầu tiên của V2.1 §15 — không có đường vào** (CAO ⑩). Tổ chức mới có 0 quan sát, nên nhiều tháng đầu pilot S4a không ra nhãn nào | **Nguồn thứ ba, hiện riêng.** Dán CSV lịch sử mua ngoài hệ thống; người quản lý dữ liệu nhập; chịu L1 và L3. Hiện thành dải RIÊNG cạnh dải nội bộ, có nhãn riêng ghi rõ nguồn; KHÔNG trộn vào dải nội bộ, KHÔNG tính cho cổng (e) |
| ⑾ | **Lịch sử tự tham chiếu** (TRUNG 1). Đếm theo QUAN SÁT thì một gói ba nhà cung cấp đã qua sàn; giá phủ của người thua không tốn gì; *"gói mồi"* mở niêm phong rồi huỷ vẫn vào lịch sử. Kết quả: giá cartel đọc là bình thường, giá thấp thật bị gắn *"thấp bất thường"* | **Theo gói, loại `CANCELLED`.** Mọi báo giá ở vị thế cuối của gói đã mở niêm phong, trừ gói `CANCELLED`. Mỗi gói một trung vị, rồi trung vị của các gói. Sàn ≥ 3 gói và ≥ 3 nhà cung cấp. Màn hiện thành phần: *n gói · m nhà cung cấp · k gói do chính người tạo gói này lập*. *"Thấp bất thường"* chỉ dẫn tới yêu cầu làm rõ, không là căn cứ loại |

### 2.5. [S1.159] Những chỗ lượt soi chốt từ tiền lệ đo được

Khuôn ADR-050: chỗ nào tiền lệ trong kho trả lời được thì lượt soi tự chốt và ghi lý do. Đầy đủ ở ADR-097.

| # | Chỗ | Chốt | Tiền lệ |
|---|---|---|---|
| ⑿ | Một VIEW không nhận mốc của gói đang xét: cột `canonical_item_id` là ánh xạ mới nhất BÂY GIỜ, không phải tại mốc của X. `quan_sat_ids uuid[]` không định danh được một dòng. `uom_aliases`, `canonical_items.don_vi_goc`/`trang_thai` và phiên bản hàng chuẩn nằm ngoài L1. Nhãn hồi tố chỉ đếm ánh xạ, nên quy đổi hồi tố cho gói cũ không để dấu (CAO ②) | Lịch sử giá là hàm `quan_sat_gia(p_moc timestamptz)` `SECURITY INVOKER STABLE`, chọn mọi hàng nền là *mới nhất theo `seq` trong số hàng có `ghi_luc` < `p_moc`*. MỌI bảng dữ liệu nền chỉ-ghi-thêm có `seq` và `ghi_luc`; danh tính hàng chuẩn bất biến, mọi thứ đổi được nằm ở bảng phiên bản. Hai nhãn tách nhau: `HOI_TO` (hàng nền ghi sau mốc của CHÍNH gói chứa quan sát) và `SAU_MOC` (ghi sau mốc của X). **[S1.235]** Câu trước tự mâu thuẫn — hàng ghi sau `p_moc` đã bị loại nên không mang nhãn được. Chủ dự án chốt 2026-09-30: `SAU_MOC` là SỐ hàng nền mới hơn mà lần đọc tại mốc đã BỎ QUA, đếm theo loại; `HOI_TO` là loại hàng nền đã dùng mà ghi sau mốc của gói chứa quan sát (ADR-136 ⑤). Nhãn tính trên MỌI hàng nền đã dùng — ánh xạ, quy đổi, bí danh, phiên bản hàng chuẩn — và đếm theo loại. Kết quả lưu ở bảng con khoá ngoại `(org_id, bid_version_id)` → `rfq_unsealed_bids` kèm `line_no`, cùng `policy_id`, ghi đúng một lần trong giao dịch tạo lượt chấm | ADR-017; C-1 của `011`; khoá ngoại `057`; khuôn `seq` của `018`/`059` |
| ⒀ | *"Mọi vòng BAFO đã ĐÓNG"* sai: ở `BAFO_CLOSED` phong bì vòng hai chưa vào `rfq_unsealed_bids`, nên *"vị thế cuối"* rơi về giá vòng một. `CANCELLED` sau mở niêm phong, gói mở với 0 phong bì đọc được, và hai danh sách *"giá đã lộ"* (TS và SQL) đều chưa được nói (CAO ③) | *"Giá đã lộ"* là MỘT hàm SQL theo DỮ LIỆU: mọi vòng của gói — vòng một và mọi vòng BAFO — đều có `unseal_requests` `EXECUTED`. Gói `CANCELLED` bị loại (⑾). `AWARDED` được tính: `COMPARISON_ALLOWED_STATUSES` đóng màn ở `AWARDED` vì luồng màn, và chính chú thích ở `comparison.ts:40-50` nói việc đóng ấy *"KHÔNG bảo vệ một bí mật nào"*. Gói không có hàng bản rõ thì không có mốc và không có quan sát. Trigger đòi lý do (§3.3 ⑵) khoá theo *"gói đã có hàng `rfq_unsealed_bids`"*, không theo `status`. Yếu tố 5 của S4b chỉ đọc gói đã mở niêm phong; §7.2 thôi viết *"sau hạn nộp"* | TRUNG 17 của §S1.139; A4, A6, J4 |
| ⒁ | Khi chỉ so tổng, `unitPrice` tách khỏi `amount`: khai đơn giá thấp cho benchmark đẹp, tiền thật nằm ở `amount`. Dòng hỏng, đơn vị lạ, ánh xạ `NULL` đều là lối né *"không đo được"*, và vắng nhãn đọc như *bình thường* (CAO ⑥) | Đơn giá của quan sát = `amount / quantity`; `unitPrice` không bao giờ được tin một mình. Phép kiểm dòng DUY NHẤT là Σ `amount` = `totalAmount` chính xác — không thêm luật làm tròn thứ hai vào SQL (ADR-050 ⑴, khoản **218**). Bộ đọc `bid_dong_tho(payload) RETURNS TABLE(...)` `IMMUTABLE`, không bao giờ `RAISE`, từ chối đúng SÁU ca của `bid_so_tien` (§5.1 L5). Độ phủ benchmark — % giá trị trên dòng đo được — hiện theo từng báo giá và từng gói ở bảng so sánh, bảng xếp hạng và màn trao. Báo giá có tổng đọc được mà dòng hỏng mang trạng thái hiển thị riêng (trình duyệt không sinh ra ca ấy: `dongTien`/`cong` luôn cho Σ = tổng) và thành một yếu tố rủi ro của S4b. Ánh xạ `NULL` khi ứng viên đầu có điểm gợi ý thì đòi lý do | ADR-050 ⑴; ADR-053 ⑶; `022:350-373` |
| ⒂ | §7.1 không chạy: không có đường chuẩn hoá hồi tố; hàng `TU_DONG` trên gói đã mở không có người ghi lý do; hàng đợi là VIEW mà không bảng nào lưu gợi ý; tập loại trừ là tập con của K5 (CAO ④, TRUNG 9) | Chuẩn hoá hồi tố do người giữ `item.manage` kích hoạt; hàng `TU_DONG` trên gói đã có bản rõ mang mã lý do cố định `CHUAN_HOA_HOI_TO`. Gợi ý lưu ở bảng chỉ-ghi-thêm `rfq_item_goi_y`. Hàng đợi có đủ năm thao tác V2.1 §14: duyệt (và tạo bí danh cho chuỗi ấy — hàng đợi *học*), bác, tạo hàng chuẩn mới, sửa thuộc tính (một phiên bản mới), khai bí danh. Người ghi `NGUOI_DUYET` nằm ngoài TRỌN tập của ADR-082 ⑿ | ADR-082 ⑿; V2.1 §14 |
| ⒃ | L8 khai nới `CHECK` và trigger J1 của `057`, nhưng không `CHECK` nào liệt kê mã, và chốt *"chỉ `gia`"* ở TypeScript lúc chấm. `he_so` là hệ số tuỳ ý cho mã `TIEN`: `he_so` "5" trên `van_chuyen` là một cần gạt thứ hạng (TRUNG 4) | Không nới `057`, không thêm `CHECK` trên bảng chính sách: tập mã có nguồn, `chat_luong`, và `he_so` của mã `TIEN` BẰNG "1" đều kiểm lúc chấm ở tầng gói, từ chối bằng một mã gọi tên — đúng chỗ ADR-053 ⑶ đặt. Tiền là tiền: V2.1 §16 là một phép CỘNG | ADR-053 ⑶; J1 |
| ⒄ | Quy đổi đơn vị có hai bản cài (TS và SQL) (TRUNG 15) | Quy đổi và làm sạch chuỗi chỉ ở SQL. Lõi TypeScript nhận giá trị đã quy đổi và chuỗi đã làm sạch | `014` §(4) |
| ⒅ | Bước 14 xanh vì phạm vi: phong bì của kịch bản 41 không có `lines`, kim quét là một TỔNG (TRUNG 3) | Kịch bản 41 thêm `lines`, hàng chuẩn và ánh xạ; quét một kim ĐƠN GIÁ; quét cả `external_price_references`, lịch sử ngoài hệ thống và bảng kết quả benchmark sau một lượt ghi thật; kê đủ ~~năm~~ **[S1.251]** bốn bộ quét (bộ thứ năm của §2.1 không phải bộ quét giá — ADR-140). **[S1.251 / S4.4b]** Vế `lines`, hàng chuẩn, ánh xạ và kim đơn giá xong ở S4.4b; vế ba bảng của S4.5/S4.6 vào bộ quét chung khi các bảng ấy ra đời. **[S1.272 / S4.6a]** Vế mốc ngoài và lịch sử ngoài xong: hai kim nhập ở bước 1, quét ở bước 14, mỗi kim chỉ ở bảng của nó. Bảng mốc ngoài và lịch sử ngoài hệ thống khai ở ADR-054 là *"bảng giá không phải báo giá"* | ADR-054; bài học khoản 224 |
| ⒆ | S4a không độc lập với S3: không có màn chính sách (S3.1 dựng); *"phiên bản hiệu lực"* chưa có mã; ba hạng mục S4 sửa `org_procurement_policies` cùng S3.1; luật dừng của ADR (a) nổ ngay hạng mục đầu; §3.4 thiếu năm chỗ đụng (CAO ⑨, TRUNG 14) | Không hạng mục S4 nào sửa `org_procurement_policies` trước khi S3.1 vào `master`. S3.1 dựng MỘT hàm ghim `chinh_sach_tai(org_id, thoi_diem)`, mọi bộ đọc của S4 gọi nó. Hạng mục không chạm chính sách đi trước (§9). Luật dừng hẹp lại thành *"cùng cột, cùng hàm ghim, cùng tệp mã"*. §3.5 thêm danh mục màn hình | ADR-080 ⑷; S1.98 (màn mới trong bản đồ `TRANG`, dưới luật ADR-044) |
| ⒇ | Bộ đọc sổ bất biến dùng `[A-HJK]\d+`: một hàng `K4a` hay `L1a` KHÔNG được đọc và KHÔNG được đếm, không ném lỗi — **đo** (M2). **[S1.185]** Khoản 246 đóng: bộ đọc nhận tối đa MỘT chữ thường sau số, và một mã lệch khuôn NÉM thay vì biến mất; quy ước *hàng L tách bằng số mới* của ADR-097 ⒇ không đổi. Mã quyền và `CONTROL_DENIED` khai là *đã có* mà chưa có dòng mã nào (TRUNG 12, 18) | Hàng L tách bằng SỐ MỚI, không bằng hậu tố (§5.1). Mã quyền vào CSDL ở hạng mục dựng hành vi của nó (ADR-084 ⑶); `CONTROL_DENIED` là từ vựng của S3 (ADR-084 ⑷), S4 dùng lại. Khoản **246** giữ lỗ của bộ đọc, vì nó chạm cả K2b/K4a/K8a của S3 | Khoản 229; ADR-084 |
| ㉑ | Giá lan qua đường không phải bảng: bộ bằng chứng của X mang đơn giá của gói khác; mốc ngoài không nói cổng đọc; dải lịch sử ở màn tạo gói cho người đang mời là một *"bến đỗ an toàn"*; khách cần tập mã TCO mà policy `_khach` của bảng chính sách là vị từ đóng (TRUNG 10) | Bộ bằng chứng mang quan sát với định danh gói và nhà cung cấp băm có muối theo từng bundle, và ADR-054 khai bundle là nơi mang giá. Mốc ngoài và lịch sử ngoài hệ thống đọc bằng `bid.view`. Màn tạo gói chỉ hiện *"đủ / chưa đủ lịch sử"*. Tập mã TCO và số ngày giao chụp vào một bảng theo GÓI lúc `OPEN`, có `_khach` hẹp đã khai, và nằm trong một băm riêng được ký. Route đọc lịch sử `agent: false` | A4; ADR-054; `027`; khuôn băm riêng của spec S3 §2.5 ⑾ |
| ㉒ | Kiểm soát giả do cấu hình: `san_quan_sat` 999, `cua_so_thang` 0, ngưỡng vừa > ngưỡng cao đều hợp lệ; jsonpath của Postgres 16 KHÔNG có `.decimal()` — **đo** (M3) (TRUNG 11) | Biên GIẢ ĐỊNH và thứ tự bằng `CHECK` dùng `.double()`: ngưỡng không phải tiền, nên số thực chấp nhận được, và điều ấy được nói ra. Màn khai chính sách hiện tác động của cấu hình trên lịch sử thật và CẢNH BÁO cấu hình rỗng ruột, không chặn | spec S3 §8.1 |
| ㉓ | L2/L7 *"tái lập được"* không có nghĩa khi luật chuẩn hoá là MỘT hằng và phiên bản chính sách không nằm trên hàng ánh xạ; hiệu năng không có ngưỡng; T5 ⑷ không có tiêu chí (TRUNG 13) | Mọi phiên bản bộ luật giữ nguyên trong mã (bảng phiên bản → bộ luật; bản cũ không sửa); hàng ánh xạ và hàng gợi ý mang phiên bản. Ngưỡng hiệu năng GIẢ ĐỊNH (p95 đọc lịch sử một hàng chuẩn < 500 ms ở 5.000 gói × 20 dòng), đo ở S4.4 trên dữ liệu gieo, có biên bản. T5 ⑷ là phép đo có biên bản, không phải test | ADR-059 (`DAC-TA.md`) |
| ㉔ | Tuyên bố hứa quá: *"thước đo được chốt trước khi giá lộ"*; `BINH_THUONG` đọc như chứng nhận; *"buyer anomaly"* gắn chữ *bất thường* cho một nhân viên có tên (TRUNG 19) | `BINH_THUONG` hiện là *"trong dải lịch sử nội bộ (n gói, m nhà cung cấp)"*. Phân tích người mua nói *"tỷ lệ lệch khỏi mặt bằng tổ chức"*. Dòng PRODUCT §5 của §8.2 viết lại (§8.2) | PRODUCT §5 |
| ㉕ | Cổng (e) không có ngày, không có công cụ, đạt được bằng ánh xạ `NULL` hàng loạt; câu hỏi pháp lý §8.7 không có chủ (TRUNG 16) | Sàn đo THEO TỪNG tổ chức, loại `NULL` khỏi tỷ lệ; công cụ đo chỉ xuất số đếm, chạy với đồng ý của khách. Câu hỏi §8.7 thuộc chủ dự án, ghi vào `docs/TIEN-DE-CHUA-DO.md` | ADR-043 ⑷; ADR-002 |

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
| Cổng `MFA_FRESH` 15 phút (`packages/unseal/src/gate.ts`, `UNSEAL_MFA_MAX_AGE_SECONDS`) | Duyệt trao thầu rủi ro cao (V2.1 §24). **[S1.159]** Gọi `gate.ts` trái ranh giới §3.2 (`tri-tue` cấm phụ thuộc `unseal`). Hàm đúng là `assertFreshMfa` ở `packages/identity/src/mfa.ts:174`; hằng 900 giây nằm ở `gate.ts:84` |
| `throwAuditedDenial`, luật `VAO_SO`, lớp `CONTROL_DENIED` (ADR-060, ADR-084) | Mọi lần từ chối của S4. **[S1.159]** `CONTROL_DENIED` CHƯA có dòng mã nào (grep trên `packages`, `apps`, `db`: 0); nó là từ vựng S3 sẽ dựng (ADR-084 ⑷), nên thuộc hàng *"Của S3, khi đã có mã"* dưới đây |
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

**[S1.159] Luật dưới đây đứng, nhưng ba chỗ của nó đổi** — đọc cùng §2.5 ⑿⒀ và §2.4 ⑸: luật cài bằng hàm as-of
`quan_sat_gia(p_moc)`, không bằng view phẳng; trigger đòi lý do khoá theo *"gói đã có hàng bản rõ"*, không theo `status`;
và thước chính sách nằm TRONG luật, bằng cách ghim phiên bản lúc gói vào `OPEN`. Bảng *"ba cách chỉnh"* ở trên thiếu cách
thứ tư, và là cách mạnh nhất: **tạo một phiên bản chính sách mới sau khi thấy giá** (góc C①, D③).

**Luật:** mỗi hàng dữ liệu nền mang `ghi_luc`, do trigger đặt bằng `clock_timestamp()` — đồng hồ Postgres (ADR-005). Cột ấy
không nằm trong `GRANT` (khuôn `approved_content_hash` của `011`). Dữ liệu nền dùng cho gói X là các hàng có `ghi_luc` nhỏ
hơn mốc mở giá của X. Một ánh xạ, quy đổi hay mốc ngoài ghi sau mốc ấy vẫn được ghi — dữ liệu nền phải sửa được — nhưng:

- ⑴ nhãn `SAU_MO_GIA` được SUY RA ~~trong view~~ **[S1.159]** trong hàm as-of từ `ghi_luc` và mốc mở giá, không lưu thành
  cột — một cờ lưu tay là kết luận trần (ADR-017). **[S1.159]** Nhãn tách hai: `HOI_TO` so với mốc của gói chứa quan sát,
  `SAU_MOC` so với mốc của X (§2.5 ⑿);
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
`bid.view` thì ánh xạ hồi tố cũng mù — đó là một lý lẽ cho vai mặc định của `item.manage` ở §9 S4.0. **[S1.159] Chủ dự án
chọn đúng lý lẽ ấy — §2.4 ⑺: vai mới mù giá.** Nhãn cũng thôi chỉ đếm ánh xạ: nó đếm MỌI hàng nền đã dùng, vì quy đổi hồi
tố cho gói cũ dịch được dải mà không chạm một ánh xạ nào (góc C②). Một thiên lệch còn lại không nhãn nào thấy: *bỏ sót* —
dòng cũ giá thấp bị ánh xạ `NULL` hay sang một hàng gần trùng. §2.5 ⒁ đòi lý do cho ánh xạ `NULL` khi ứng viên đầu có điểm
gợi ý, và đó là tất cả những gì bắt được nó.

Luật này **không** chặn một người thông đồng TRƯỚC khi có giá, ánh xạ sẵn sang hàng đắt. Chặn điều ấy là việc của luật tách
người (§4.4, L3): người ghi ánh xạ không nằm trong tập người chọn của gói ấy. Không luật nào chặn được một người quản lý dữ
liệu thông đồng với người tạo gói. Thứ còn lại là dấu vết: ai ánh xạ, lúc nào, trước hay sau khi mở giá (§8.2).

### 3.4. Chạy song song S3 — chỗ nào đụng nhau

| Chỗ | S3 làm gì | S4a làm gì | Luật |
|---|---|---|---|
| `org_procurement_policies` | S3.1 thêm `tiers jsonb`, chữ ký thứ hai cho phiên bản, fail-closed phiên bản không bậc | S4.1, S4.5, S4.7 thêm khoá `chuan_hoa`, `benchmark`, `tco` | Hai migration riêng. Phiên bản mới mang CẢ HAI nhóm khoá. Ở tổ chức đã bật S3, phiên bản mới cho tham số S4 vẫn phải có bậc và chữ ký thứ hai — S4 không mở đường tắt nào quanh ADR-082 ⑺. **[S1.159]** Luật dừng của ADR (a) nổ ngay ở đây. Chốt §2.5 ⒆: không hạng mục S4 nào sửa bảng này trước khi S3.1 vào `master`, và mọi bộ đọc gọi hàm ghim `chinh_sach_tai` của S3.1. Khoá `chuan_hoa` bị bỏ (§2.4 ⑹) |
| Cạnh `DRAFT→PENDING_APPROVAL` | S3.1, S3.3, S3.6 thêm trigger riêng | S4.3 KHÔNG thêm trigger ở cạnh; chuẩn hoá chạy sau commit (§4.4) | Không va |
| `packages/danh-gia` | S3.5 dựng lại cổng trao thầu: `trao-thau.ts`, trigger của `061` | S4.7 nới tập mã thành phần: `chi-phi-hieu-dung.ts`, `luot-danh-gia.ts`, ~~`CHECK` và trigger J1 của `057`~~ **[S1.159]** không sửa `057` (§2.5 ⒃); nhưng lời khai TCO lưu cùng award (§2.4 ⑻) chạm đúng đường đề xuất trao của `trao-thau.ts` | Cùng gói, khác tệp, khác hàm ghim. Đo lại lúc làm; nếu S3.5 hóa ra sửa `057` thì S4.7 nhường. **[S1.159]** Vế cam kết của S4.7 đi SAU S3.5 |
| Bộ xuất ADR-059 | S3.9 thêm lớp governance | S4.5 thêm lớp dữ liệu nền | Hai lớp riêng trong cùng một bundle; `DAC-TA.md` có hai mục |
| Dải nhãn bất biến | S3 thêm hàng K từ S3.1 | S4.0 nới `[A-HJK]`→`[A-HJ-L]` | Nới một lần ở S4.0. Hàng K và hàng L vào sổ độc lập |
| Nhóm hàng | S3.6 dựng `procurement_categories` | `canonical_items.category_id` cho phép `NULL` | Khoá ngoại thêm ở hạng mục đầu tiên SAU khi S3.6 vào `master` — không trước. **[S1.159]** Chưa hạng mục nào của §9 mang việc ấy — thêm vào bảng thay đổi |
| **[S1.159]** `tools/gieo-demo` | S3.1 gieo lại theo bảng vai của spec S3 §7 | §7.1 cần gói cũ có `lines` thật, vai `DATA_STEWARD`, bí danh | Một lần gieo, hai phần. Hôm nay `gieo:demo` có 0 `FINANCE`, đúng MỘT gói ở `OPEN`, hạng mục theo `tam`/`cay`/`bo` (`tools/gieo-demo/src/index.ts:90-94,145-150`) |
| **[S1.159]** Kịch bản 41 | S3.2 đổi thứ tự mời | S4.4 thêm `lines` và kim đơn giá (§2.5 ⒅) | Cùng tệp. Đi sau S3.2 |
| **[S1.159]** `/tao-thau`, `/nop-thau`, `/mo-thau` | S3.2 dựng lại `/tao-thau` | S4 thêm số ngày giao, ô TCO, bảng so sánh theo dòng | Cùng tệp. Đi sau S3.2 ở `/tao-thau` |
| **[S1.159]** `rfq_awards` | S3.5 tách chữ ký khỏi hàng `APPROVED` (spec S3 §9) | `trung_thau` của §4.5 đọc hàng `APPROVED`; cam kết TCO lưu cùng award | Nghĩa của `APPROVED` có thể đổi. §4.5 đọc qua MỘT hàm của S3.5, không đọc thẳng cột |
| **[S1.159]** Danh mục vai `005` và hardening | S3 thêm `supplier.qualify`, `category.manage` | S4 thêm vai `DATA_STEWARD` và `item.manage` | Hai migration khác nhau trên cùng bảng danh mục. Mỗi hàm, mỗi trigger mới ghim cùng commit |
| **[S1.159]** Các tệp ghim dải nhãn | S3.1 thêm hàng K1 và chữ K vào phép kiểm `"ABCDEFGH"` (`tools/inv-matrix/src/danh-gia.test.ts:393`) | S4.0 nới `[A-HJK]`→`[A-HJ-L]` | Cùng mười chỗ. S4.0 đi sau S3.1, hoặc làm chung một lần |

### 3.5. [S1.159] Danh mục màn hình

Bản nháp không có danh mục màn hình, trong khi §7.1 đòi chạy *"trên giao diện"*. Hôm nay `apps/web` có đúng ba trang —
`/nop-thau`, `/mo-thau`, `/tao-thau` — trong một bản đồ đóng (`apps/web/src/phuc-vu.ts:92-110`), chạy dưới luật ADR-044: không
bước build, không script nội tuyến (CSP), mã trang không typecheck. Không có màn chính sách: chính sách chỉ ghi được qua
`POST /policy` (`apps/api/src/routes/buyer.ts:650`). S4 thêm màn theo tiền lệ S1.98 — một trang mới vào bản đồ `TRANG`,
dưới đúng luật ADR-044.

| Màn | Hạng mục | Vai | Việc |
|---|---|---|---|
| `/du-lieu` (mới) | S4.2, S4.3, S4.6 | `DATA_STEWARD` | Hàng chuẩn và phiên bản, bí danh, quy đổi riêng, hàng đợi năm thao tác, chuẩn hoá hồi tố, mốc ngoài, dán lịch sử ngoài hệ thống, ba tỷ lệ hiệu chỉnh |
| Màn chính sách của S3.1 | S4.5, S4.7 | `policy.manage` | Nhóm khoá `benchmark`, `tco`; hiện tác động và cảnh báo (§2.5 ㉒). Nới màn của S3.1, không dựng màn thứ hai |
| `/tao-thau` | S4.3, S4.7 | `rfq.create` | Trạng thái ánh xạ từng dòng, *"đủ / chưa đủ lịch sử"*, số ngày giao yêu cầu |
| `/nop-thau` | S4.7 | khách | Ô TCO theo tập mã GHIM trên gói (§2.5 ㉑), số ngày giao; khung 375×812 |
| `/mo-thau` | S4.5, S4.7 | `bid.view`, `evaluation.perform`, `award.recommend` | Bảng so sánh THEO DÒNG (bước 4 hôm nay chỉ vẽ tổng, `mo-thau.js:251-283`), dải nội bộ, dải lịch sử ngoài, mốc ngoài, độ phủ, hai hạng giá/TCO, giải trình khi lệch hạng |

Mỗi route mới khai trường `agent` (ADR-039). Route đọc lịch sử, benchmark và mốc ngoài là `agent: false`.

> **[S1.199 / S4.2b] Dựng.** `/du-lieu` vào bản đồ `TRANG` (khuôn S1.98), module thuần `apps/web/src/du-lieu.ts` phục vụ ở
> `/lib/du-lieu.js`. Ba route đọc của S4.2b — `GET /items`, `GET /items/:itemId`, `GET /uom` — cũng `agent: false`, khai lý do ở
> `ROUTE_DOC_KHONG_PHOI` của `apps/mcp`. `GET /items` không tìm ở máy chủ: `router.ts` cắt bỏ query và không đọc nó (⑵, E6), nên
> route trả tối đa 500 hàng xếp theo mã cùng cờ `conNua`, và màn lọc trên danh sách ấy. Mở một đường đọc query là quyết định về E6,
> để cho S4.3 — nơi gợi ý hàng chuẩn ở `/tao-thau` cần tìm thật.
>
> **[S1.234 / S4.3b] Dựng.** `/du-lieu` thêm bước 6 *Hàng đợi ánh xạ* (duyệt kèm khai bí danh, bác, tạo hàng chuẩn mới rồi duyệt,
> chuẩn hoá lại cả gói); `/tao-thau` thêm cột *Hàng chuẩn* chỉ đọc. Hai route đọc (`GET /mapping-queue`, `GET /rfqs/:rfqId/mappings`)
> `agent: false`. Không mở E6: `/tao-thau` chỉ HIỆN trạng thái ánh xạ, không tìm hàng chuẩn — câu *"gợi ý … cần tìm thật"* ở trên
> không thành việc của vòng này. Cột *Hàng chuẩn* ẩn ở tổ chức chưa có hàng chuẩn đang dùng (§2.3).

---

## 4. Mô hình dữ liệu

### 4.1. Chính sách — ba nhóm khoá mới trên phiên bản chính sách

Cùng lý do spec S2 §4.1 và spec S3 §4.1: người mua nghĩ về *"chính sách phiên bản 4"* như MỘT vật. Ba nhóm khoá dưới đây
là `jsonb` trên chính hàng chính sách, bất biến bằng cấu tạo, `CHECK` giữ hình dạng. Số là CHUỖI chứ không phải số JSON,
theo ADR-053 ⑴. Mỗi nhóm cho phép `NULL`; tính năng tương ứng gặp `NULL` thì hiện *"chưa cấu hình"*, không lấy mặc định
ngầm — tiền lệ fail-closed của spec S2 §4.1.

| Nhóm | Khoá | Mặc định GIẢ ĐỊNH | Nguồn của mặc định |
|---|---|---|---|
| ~~`chuan_hoa`~~ | ~~`nguong_tu_dong` · `nguong_goi_y`~~ | ~~`"0.95"` · `"0.80"`~~ | ~~V2.1 §14~~ |
| `benchmark` | `cua_so_thang` · ~~`san_quan_sat`~~ **[S1.159]** `san_goi` · `san_ncc` · `nguong_lech_cao` · `nguong_lech_vua` · `phuong_phap` | ~~`12` · `3`~~ **[S1.159]** `"12"` · `"3"` · `"3"` · `"0.10"` · `"0.05"` · ~~`"TRUNG_VI_TU_PHAN_VI_V1"`~~ **[S1.159]** `"TRUNG_VI_THEO_GOI_V1"` | Lựa chọn của tài liệu này; sàn theo §2.4 ⑾ |
| `tco` | `chi_phi_von_nam` · `ngay_thanh_toan_chuan` · `chi_phi_tre_ngay` | `NULL` · `NULL` · `NULL` | — (§4.8) |

~~Hai khoá của nhóm `chuan_hoa` mang ràng buộc `nguong_goi_y < nguong_tu_dong ≤ "1.00"`.~~ **[S1.159] Nhóm `chuan_hoa` rời
chính sách** (§2.4 ⑹): `TU_DONG` không còn đọc ngưỡng, còn hai ngưỡng gợi ý thành hằng GIẢ ĐỊNH của bộ luật có phiên bản.
Nhóm `benchmark` mang biên GIẢ ĐỊNH và ràng thứ tự (`nguong_lech_vua < nguong_lech_cao`, `cua_so_thang` trong [1, 60], sàn
trong [1, 50]). `CHECK` viết bằng `.double()`, vì jsonpath của Postgres 16 KHÔNG có `.decimal()` — đo (M3). Đó là ngưỡng,
không phải tiền, nên so bằng số thực chấp nhận được, và điều ấy được nói ra ở đây (§2.5 ㉒). Mỗi `CHECK` mới vào
`CHECK_AN_NINH_KHAI` hoặc `MIEN_TRU` (`db/check-an-ninh.int.test.ts`).

**[S1.159] Phiên bản nào áp cho gói X** — thứ bản nháp không nói, và là CAO ①: phiên bản mới nhất TẠO trước `opened_at`
của X, đọc qua `chinh_sach_tai(org_id, thoi_diem)` (§2.4 ⑸, §2.5 ⒆). Phiên bản tạo sau đó không đổi được gì của X.

> **[S1.192 / S4.0 — ĐO, CHƯA CHỐT] Hàm `chinh_sach_tai` không tồn tại; thứ S3.1 dựng mang tên KHÁC và nghĩa KHÁC.**
> `069_bac_va_chu_ky_chinh_sach` dựng `chinh_sach_hieu_luc(p_org, p_luc)`: phiên bản có `version` CAO NHẤT mà
> `effective_from <= p_luc` và — khi có `tiers` — đã có chữ ký thứ hai trước `p_luc`; `rfq_che_do_nghiem` gọi nó tại
> `created_at` của gói, không tại `opened_at`. Câu trên nói *"mới nhất TẠO trước `opened_at`"* — hai luật cho hai phiên bản
> khác nhau khi một phiên bản tạo trước mà hiệu lực sau, hay chưa ký. Tên `chinh_sach_tai` còn ở §2.5 ⒆, §3.4, L14 (§5.1),
> §9 S4.5, spec S4b (hai chỗ) và ADR-093. S4.0 không đổi luật: chọn mốc (`opened_at` hay `created_at`) và luật (tạo hay
> hiệu lực + ký) là việc của S4.5, nơi bộ đọc đầu tiên gọi hàm ấy. Đến lúc đó mọi chữ `chinh_sach_tai` trong tài liệu đọc
> là *"hàm ghim phiên bản của S3.1, luật chờ S4.5"*.
>
> **[S1.253 / S4.5a — CHỐT] Luật là `chinh_sach_hieu_luc(org, opened_at)`.** Chủ dự án chốt 2026-10-01 (ADR-141): mốc là
> `opened_at` của gói, luật là *hiệu lực + ký* của S3.1 — không một hàm `chinh_sach_tai` thứ hai. `effective_from >= created_at`
> (`022`) và `created_at` ngoài `GRANT INSERT`, nên không phiên bản nào tạo sau lúc mở lọt vào; luật chữ *"mới nhất TẠO trước
> `opened_at`"* sẽ áp một phiên bản hẹn giờ chưa tới hiệu lực, hay một phiên bản có bậc chưa ký. Mọi chữ `chinh_sach_tai` trong tài
> liệu đọc là `chinh_sach_hieu_luc(org, opened_at)`. Lượt chấm đọc nó ở S4.5a, với trigger `rfq_evaluations_kiem_phien_ban_ghim`.
> **[S1.253 — sau lượt soi đối kháng]** Không tính lại hàm ấy tại `opened_at` về sau: `created_at` là lúc giao dịch tạo BẮT ĐẦU và
> `opened_at` nằm trong `GRANT UPDATE` của `app_api` — hai đường lùi mốc. Gói CHỤP kết quả của hàm vào `rfq_packages.chinh_sach_ghim_id`
> ở cạnh vào OPEN, dưới khoá tư vấn chính sách; mọi bộ đọc của S4 đọc cột ấy. Khoản 319 giữ phần `opened_at` còn lại.

**Không migration nào tự tạo phiên bản chính sách** cho tổ chức — cùng nguyên tắc spec S3 §4.1 viện dẫn từ
`hardening.always.sql`. Mặc định là mẫu điền sẵn trên màn khai chính sách và trong `gieo:demo`. Hiệu chỉnh sau pilot bằng
ba tỷ lệ: tỷ lệ ánh xạ tự động bị người duyệt đảo lại, tỷ lệ nhãn lệch được ghi nhận là *có cơ sở*, và tỷ lệ hạng mục
*chưa đủ lịch sử*.

### 4.2. Đơn vị đo

**`uom_units`** — danh mục TOÀN CỤC, khuôn `roles` của `005`: không `org_id`, `app_api` chỉ `SELECT`, gieo bằng migration.
**[S1.159]** Cài được: không phép kiểm nào đòi mọi bảng `public` có `org_id` hay RLS (`migration-shape.test.ts:418-424`
xếp `roles`, `permissions` là danh mục toàn cục). Nhưng `he_so_ve_goc` là thước: bảng chặn UPDATE bằng trigger chỉ-ghi-thêm
cộng chốt `TRUNCATE` (khuôn `047`), và hệ số đã dùng đi vào bộ xuất.

| Cột | Nghĩa |
|---|---|
| `code` | `kg`, `g`, `t`, `m`, `cm`, `mm`, `m2`, `m3`, `l`, `ml`, `cai`… |
| `thu_nguyen` | `KHOI_LUONG` · `CHIEU_DAI` · `DIEN_TICH` · `THE_TICH` · `DEM` |
| `he_so_ve_goc numeric` | `t` → `1000` (về `kg`) · `mm` → `0.001` (về `m`) |

Đơn vị ĐÓNG GÓI — `cây`, `cuộn`, `bao`, `thùng`, `bộ` — không có trong danh mục: chúng không có hệ số chung, chỉ có hệ số
theo mặt hàng.

**`uom_aliases`** — theo tổ chức: chuỗi đã làm sạch → `code`. ~~Có một lượng nhỏ bí danh toàn cục cho các dạng không mơ hồ
(`kilogram`, `kgs`, `tấn`).~~ **[S1.159]** Bí danh toàn cục (`kilogram`, `kgs`, `tấn`) nằm ở một bảng TOÀN CỤC riêng: một
hàng `org_id NULL` trong bảng tenant là vô hình dưới FORCE RLS, và policy `org_id IS NULL OR …` là dạng fail-open mà `002`
cấm (góc B⑩). `uom_aliases` của tổ chức là chỉ-ghi-thêm, có `seq`, `ghi_luc`, tác giả, hàng rút — đổi `MT` từ `t` sang `m`
là đổi thước 1000 lần, nên nó nằm TRONG L1 (góc A⑧, C②). **Dạng mơ hồ KHÔNG có bí danh toàn cục:** `MT` là *metric ton* trong V2.1 §14, nhưng trên phiếu
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

> **[S1.197 / S4.2a] Luật ghép của vế ⑵ — ADR-116.** ⑴ luôn đi trước. ⑵ dùng đúng MỘT cạnh riêng của đúng hàng chuẩn, ghép quy
> đổi chung cùng thứ nguyên ở hai đầu (*cây → kg* cho *cây → g*) và dùng được chiều ngược (`1 / hệ số`); không ghép hai cạnh riêng;
> hai cạnh cùng dùng được là mơ hồ ⇒ `KHONG_QUY_DOI_DUOC`. Mã trả về mới: `QUY_DOI_RIENG`. Đầu `tu` lưu là mã nếu chuỗi quy về một
> mã, không thì chuỗi đã làm sạch; `sang_don_vi` luôn là mã.

### 4.3. Hàng chuẩn (Item Master)

**`canonical_items`** — danh tính: `(org_id, id, ma, don_vi_goc, category_id NULL, trang_thai)`. `category_id` chỉ có khoá
ngoại sau khi S3.6 vào `master` (§3.4). **[S1.159]** Danh tính BẤT BIẾN: `don_vi_goc` không đổi được — đổi đơn vị gốc là tạo
hàng chuẩn mới — còn `trang_thai` và `category_id` chuyển xuống bảng phiên bản. Nếu không, đổi `don_vi_goc` sau khi mở giá là
đổi thẳng con số quy đổi mà không để nhãn (góc B⑨, C②).

**`canonical_item_versions`** — chỉ-ghi-thêm, mỗi lần sửa một phiên bản, khuôn `vendor_bid_versions`: `ten`, `thuoc_tinh
jsonb`, `thuoc_tinh_trong_yeu text[]`, tác giả + phiên. `thuoc_tinh` mang đúng các trường V2.1 §14 kể ra: nhà sản xuất, vật
liệu, mác, kích thước, tiêu chuẩn, cộng khoá riêng của nhóm hàng. `thuoc_tinh_trong_yeu` là danh sách khoá mà nếu thiếu
hay mâu thuẫn thì bộ chuẩn hoá KHÔNG được gộp (§4.4 bước 5).

**`item_aliases`** — chỉ-ghi-thêm, có hàng rút: `(canonical_item_id, bi_danh_sach, tac_gia, session_id, seq, ghi_luc)`.
`bi_danh_sach` là chuỗi ĐÃ qua bước làm sạch, nên *"Thép Hòa Phát D10"* và *"THEP HOA PHAT D10"* là một bí danh.

Hàng chuẩn KHÔNG dùng chung giữa các tổ chức (§2.2 ⑷, ADR-013). Hai tổ chức cùng mua thép D10 có hai hàng chuẩn riêng.

> **[S1.197 / S4.2a] Dựng — chủ dự án chốt 2026-09-29.** `don_vi_goc` là khoá ngoại tới `uom_units` — không đơn vị đóng gói.
> `category_id` CHƯA có cột: nó vào cùng nhóm hàng của S3.6 (ADR-084 ⑶), không vào trước như một cột NULL. `ma` do người quản lý
> dữ liệu nhập, viết hoa, duy nhất trong tổ chức. `trang_thai` ∈ {`DANG_DUNG`, `NGUNG_DUNG`} ở bảng phiên bản; `thuoc_tinh` là đối
> tượng phẳng khoá viết thường → chuỗi không rỗng, `thuoc_tinh_trong_yeu` phải là khoá có mặt. Người GHI mọi bảng nền phải giữ
> `item.manage` — kiểm ở CSDL (`du_lieu_nen_kiem_quyen_ghi`), dưới cổng của route (ADR-116 ⑹).

**Mã quyền `item.manage`** (§9 S4.0) giữ mọi thao tác ghi ở mục này, ở §4.2, ở ánh xạ duyệt tay (§4.4) và ở mốc ngoài
(§4.7). Người đọc: mọi vai giữ `rfq.create`, vì người tạo gói cần thấy gợi ý. Hàng chuẩn không mang giá, nên đọc nó không
phải là đọc giá. **[S1.199 / S4.2b — chủ dự án chốt 2026-09-29]** Người đọc là MỌI người mua của tổ chức, không riêng người giữ
`rfq.create`: route đọc không có chỗ khai mã quyền, và hàng chuẩn không mang giá, nên dựng một cổng đọc mới không canh gì. **[S1.159]** `item.manage` chỉ ở vai mới `DATA_STEWARD`, và vai ấy không giữ `bid.view`, `po.approve`,
`award.recommend`, `rfq.create`, `rfq.invite` — ở vai và ở người (§2.4 ⑺). Câu *"người đọc"* chỉ nói về hàng chuẩn: mốc
ngoài và lịch sử ngoài hệ thống mang giá, đọc bằng `bid.view` (§2.5 ㉑).

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
6. **Định tuyến.** ~~`≥ nguong_tu_dong` → `TU_DONG`.~~ Trong `[nguong_goi_y, nguong_tu_dong)` → `GOI_Y`. Dưới `nguong_goi_y`
   → `CAN_DUYET`.

**[S1.159] Hai bước đổi chỗ ở và đổi nghĩa** (§2.4 ⑹, §2.5 ⒄):
- Bước 1 (làm sạch) và bước 2 (đơn vị) là HÀM SQL `chuoi_sach(text)` — `normalize(…, NFD)`, `regexp_replace`, `translate` cho
  `đ`→`d`, không extension. Lõi TypeScript nhận chuỗi đã làm sạch, không cài lại. **[S1.192 / S4.1] Bản 1 dùng NFKD, không NFD**
  — đo: NFD giữ nguyên *"m²"*, bước thay ký tự lạ biến nó thành `m`, tức mã của MÉT; NFKD cho `m2`. Với chữ Việt hai dạng cho
  cùng kết quả. Mọi ký tự ngoài `[a-z0-9]` thành một khoảng trắng: *"D10-HP"* → `d10 hp` (chủ dự án chốt 2026-09-29).
- `TU_DONG` chỉ khi `chuoi_sach(description)` bằng CHÍNH XÁC một `item_aliases` còn hiệu lực. Trigger tính lại cả hai vế nên
  CSDL phán được, không tin một con số do ứng dụng khai. Mọi khớp mờ ≥ `nguong_goi_y` là `GOI_Y`, kể cả ≥ 95%.
- Ngưỡng 95/80 là hằng GIẢ ĐỊNH của bộ luật gợi ý, không nằm trên chính sách.

**Phiên bản bộ chuẩn hoá là một HẰNG trong mã.** Mọi thay đổi luật ở bước 1, 3, 4, 5 phải tăng nó, và một bảng ca ghim theo
phiên bản đo điều ấy: đổi luật mà không đổi hằng thì bảng ca đỏ. Không có hằng này thì L2 (*tái lập được*) không có nghĩa,
vì *"cùng hàm"* không xác định được.

**`rfq_item_mappings`** — chỉ-ghi-thêm; hàng hiệu lực là hàng mới nhất theo `seq`, ghi dưới khoá tư vấn `(rfq_id, line_no)`
(khuôn `supplier_qualifications` ở spec S3 §4.8) **[S1.159] — khuôn ấy là giấy: `supplier_qualifications` có 0 dòng mã.
Khuôn chạy thật là `018:262-279`, `059`, `061`: một trigger BEFORE INSERT theo đúng thứ tự lấy khoá tư vấn → `seq` = max + 1
→ `ghi_luc`, cả ba cột ngoài GRANT. KHÔNG dùng SEQUENCE hay IDENTITY: một dãy dùng chung mọi tổ chức là oracle khối lượng ghi
xuyên tổ chức (ADR-013), và thứ tự `nextval` khác thứ tự commit (góc B⑨):**

| Cột | Ghi chú |
|---|---|
| `rfq_id`, `line_no` | KHÔNG khoá ngoại tới `rfq_items.id`: hạng mục xoá được ở `DRAFT` (`009`), còn bảng này chỉ-ghi-thêm |
| `hang_muc_bam` | Băm của `description`, `unit`, `quantity` lúc ánh xạ. Ánh xạ chỉ hiệu lực khi băm ấy BẰNG băm hiện tại — khuôn C-1 của `011`. Gói quay về `DRAFT` và sửa hạng mục thì ánh xạ cũ tự thôi hiệu lực. **[S1.159]** Trigger tính, ngoài GRANT, trên `jsonb_build_array(...)::text` — nối bằng `':'` như `rfq_bam_noi_dung` là mơ hồ vì `unit` là chuỗi tự do |
| `nguon` | `TU_DONG` · `NGUOI_DUYET` |
| `canonical_item_id` | `NULL` = quyết định tường minh *"không có hàng chuẩn tương ứng"*, khác với *chưa ánh xạ* |
| `do_tin_cay`, `phien_ban_bo_chuan_hoa`, `dau_vao jsonb` | Chuỗi đã làm sạch, thuộc tính trích được, năm ứng viên đầu kèm điểm. Đủ để tính lại (L2) |
| `tac_gia`, `session_id` | `NGUOI_DUYET` bắt buộc; `TU_DONG` ghi người đã kích hoạt lượt chuẩn hoá. **[S1.159]** Với `TU_DONG` người ấy không chịu lực: CSDL kiểm trùng bí danh (§2.4 ⑹). `TU_DONG` trên gói đã có bản rõ chỉ do người giữ `item.manage` kích hoạt, mang mã lý do `CHUAN_HOA_HOI_TO` (§2.5 ⒂) |
| `ghi_luc`, `ly_do` | Trigger đặt `ghi_luc` (§3.3). Ghi khi gói đã `≥ UNSEALED` thì `ly_do` không rỗng |

**Khi nào chuẩn hoá chạy.** Tầng gói gọi nó SAU KHI cạnh `DRAFT→PENDING_APPROVAL` commit, trong một giao dịch riêng, rồi ghi
hàng `TU_DONG` hoặc để dòng vào hàng đợi. Nó không ghi trong giao dịch của cạnh, vì hai lẽ: một lỗi chuẩn hoá không được
chặn việc nộp duyệt, và S4 không thêm trigger ở cạnh ấy (§3.4). Nó cũng không cần outbox: chuẩn hoá là hàm thuần, không gọi
dịch vụ ngoài, không có gì để thử lại theo lịch. Hỏng thì màn hàng đợi có nút *"chuẩn hoá lại"*.

**Hàng đợi** là một VIEW, không phải bảng: hạng mục của gói `≥ PENDING_APPROVAL` chưa có ánh xạ hiệu lực, kèm kết quả
`GOI_Y`/`CAN_DUYET` mới nhất. **[S1.159]** Không bảng nào lưu kết quả ấy (góc A②④, B⑪⑴): thêm bảng chỉ-ghi-thêm
`rfq_item_goi_y` — năm ứng viên đầu, điểm, phiên bản bộ luật. Thao tác của hàng đợi, đủ năm của V2.1 §14: duyệt (kèm tạo bí
danh cho chuỗi ấy, để hàng đợi *học*), bác, tạo hàng chuẩn mới, sửa thuộc tính (một phiên bản mới), khai bí danh.

**Người tạo gói KHÔNG ghi được ánh xạ ~~hiệu lực~~ `NGUOI_DUYET`.** Họ thấy gợi ý và trạng thái hàng đợi. Người ghi `NGUOI_DUYET` giữ
`item.manage` và nằm ngoài tập `{người tạo gói} ∪ {mọi invited_by} ∪ {mọi revoked_by}` của gói ấy, đọc trên MỌI hàng kể cả
hàng đã thu hồi — ~~cùng tập loại trừ K5 dựng ở spec S3 §5.1~~. **[S1.159] Câu vừa gạch sai: đó là tập CON.** K5 của spec S3
§5.1 và ADR-082 ⑿ loại thêm người đặt ngân sách, người nộp duyệt, người tạo bản ghi nhà cung cấp và người liên hệ, và tác
giả ngoại lệ. S4 dùng TRỌN tập ấy (góc A⑥).

### 4.5. Lịch sử giá — ~~một VIEW~~ [S1.159] một HÀM as-of, không phải bảng thứ ba

**[S1.159] Đọc mục này cùng §2.5 ⑿⒀⒁.** Ba chỗ của bản nháp đổi:
- **View → hàm `quan_sat_gia(p_moc timestamptz) RETURNS TABLE`, `SECURITY INVOKER STABLE`.** Một view không nhận mốc của gói
  đang xét, nên không diễn đạt được luật mù (góc B①). Mục (C) chỉ bắt hàm `prosecdef`, và hàm không lưu gì.
- **`bid_don_gia(payload, line_no)` → `bid_dong_tho(payload) RETURNS TABLE(line_no, thanh_tien, ly_do)`, `IMMUTABLE`, không
  bao giờ `RAISE`.** Hai ca của bản nháp — `lineNo` ngoài `rfq_items`, tiền tệ — cần đọc bảng, nên làm ở JOIN của hàm as-of.
  Một hàm `RAISE` trong thân sẽ làm cả bước 14 ném (góc B⑦).
- **Đơn giá = `amount / quantity`**, không tin `unitPrice` (§2.5 ⒁).

**Bộ đọc SQL `public.bid_don_gia(payload jsonb, line_no integer)`**, khuôn `bid_so_tien`: trả `(don_gia numeric, thanh_tien
numeric, ly_do text)`. Nó từ chối đúng ~~bốn~~ **[S1.159] SÁU** ca của `bid_so_tien`, cộng thêm:

- `lines` không phải mảng;
- hai phần tử cùng `lineNo`;
- `lineNo` không có trong `rfq_items` của gói;
- `payload ->> 'currency'` khác tiền tệ của phiên bản chính sách. ~~Ô tiền tệ ở `nop-thau.js` là ô NHẬP TỰ DO của nhà cung
  cấp, và đa tiền tệ là Enterprise;~~ **[S1.165 / khoản 244 / ADR-103]** Đọc QUA `public.bid_currency` (`070`), không
  đọc chuỗi trần: cổng `tests/architecture/tien-te-mot-cho-doc.test.ts` đỏ với bộ đọc thứ sáu đọc trần. Ô tiền tệ nay là
  ô chọn VND/USD, nhưng một phong bì dựng ngoài trang vẫn mang chuỗi tự do; đa tiền tệ vẫn là Enterprise;
- **tổng lệch:** Σ `amount` ≠ `totalAmount`.

Phép so từng dòng (`amount` = `quantity` × `unitPrice`) phải dùng ĐÚNG luật của trình duyệt. Phép đo lúc viết tài liệu này:
`thanhTien` ở `apps/web/src/so-tien.ts` **CẮT** phần lẻ bằng phép chia `bigint` (`(a * b * 100n) / 10000n`), không làm tròn
nửa-ra-xa-0 như ~~ADR-052~~ **[S1.159]** ADR-050 ⑴. Dùng luật ấy ở đây sẽ loại oan ~~mọi dòng có số lượng lẻ~~ những dòng mà số
lượng có 3–4 chữ số lẻ. ~~S4.4 phải chọn một trong hai: ghim luật cắt ở cả hai tầng, hoặc chỉ dùng phép so tổng.~~
**[S1.159] Chốt: chỉ phép so tổng, và đơn giá tính từ `amount`** (§2.5 ⒁). Phương án *"ghim luật cắt ở cả hai tầng"* đặt một
luật làm tròn thứ hai vào SQL, trái ADR-050 ⑴, và chỗ lệch hai tầng ấy đã là khoản **218**. Phương án *"chỉ so tổng"* của bản
nháp thì tách `unitPrice` khỏi `amount`, nên chỉ đứng được khi đơn giá lấy từ `amount`.

**[S1.159] Sáu ca, không bốn — đo (M1).** Thân đang chạy của `bid_so_tien` là của `022:350-373`, không phải `020`. Hai ca
thêm của S1.7 MED-4: `n ≥ 10^16` và `n <> round(n, 2)`. Trên Postgres 16: `bid_so_tien('1e131071')`, `('10000000000000000')`,
`('1.001')` đều ra `NULL`; `('1.00')` thì không. Chữ *"bốn ca"* chép từ chú thích đã thiu ở `020:103`, `057:141` và
`luot-danh-gia.ts:329`. Một bộ đọc dựng theo *"bốn ca"* mở lại lỗ MED-4: `"1e131071"` đi vào trung vị.

**View `price_observations`** (`security_invoker`, mục (C) `CAU_DOC_VONG` của hardening đòi điều đó cho mọi view), mỗi hàng
một (gói, nhà cung cấp, dòng):

| Cột | Nguồn |
|---|---|
| `rfq_id`, `supplier_id`, `line_no`, `bid_version_id` | `rfq_unsealed_bids` ⨝ `vendor_bid_versions`. **[S1.159]** Hai bảng ấy không có `rfq_id` hay `supplier_id` (`019:436-449`, `018:85-103`); đường nối thật đi qua bốn bảng như `comparison.ts:329-333`. Định danh của một quan sát là cặp (`bid_version_id`, `line_no`) |
| `vi_the` | `CUOI_CUNG` — phiên bản của vòng cuối mà nhà cung cấp ấy nộp. Nếu có vòng BAFO đã ~~đóng~~ **[S1.159] mở niêm phong** và nhà cung cấp nộp vòng ấy thì là bản BAFO; không thì bản vòng một |
| `trung_thau` | Hàng mới nhất của `rfq_awards` cho báo giá ấy là `APPROVED` (`061`). **[S1.159]** S3.5 tách chữ ký khỏi hàng `APPROVED`; đọc qua một hàm của S3.5, không đọc thẳng cột (§3.4) |
| `canonical_item_id` | Ánh xạ HIỆU LỰC của dòng. Ánh xạ ghi sau mốc mở giá thì mang nhãn `SAU_MO_GIA` (§3.3) |
| `don_gia_goc`, `don_vi_goc`, `don_gia_quy_doi`, `tien_te` | `bid_don_gia`, rồi quy đổi về `don_vi_goc` của hàng chuẩn (§4.2) |
| `ngay_quan_sat` | Mốc mở giá của gói (§3.3) |
| `trang_thai` | `HOP_LE` · `KHONG_DOC_DUOC` · `LECH_TONG` · `LECH_TIEN_TE` · `KHONG_QUY_DOI_DUOC` · `CHUA_ANH_XA` |

**Vị từ bí mật nằm TRONG thân view, không nằm ở route:** chỉ gói `≥ UNSEALED`, và chỉ khi mọi vòng BAFO của gói đã đóng. Lọc
theo trạng thái gói thôi thì chưa đủ — spec S3 §2.5 ⒅ ~~đo được~~ **[S1.159]** đọc ra (biên bản §S1.139 ghi đó là phép đọc) rằng phiên bản BAFO nằm chung `vendor_bid_versions` với vòng
một. Phiên khách thì bị chặn bằng vị từ khách trong thân view, cộng policy `RESTRICTIVE` trên mọi bảng mới (khoản 29).

**[S1.159] Đoạn trên sai ba chỗ.**
- *"Mọi vòng BAFO đã ĐÓNG"* sai: ở `BAFO_CLOSED` phong bì vòng hai chưa vào `rfq_unsealed_bids` (`unseal-worker/src/index.ts:532-541`),
  nên *"vị thế cuối"* rơi về giá vòng một. Vị từ đúng là §2.5 ⒀: mọi vòng đều có `unseal_requests` `EXECUTED`; `CANCELLED` bị
  loại; `AWARDED` được tính.
- Vị từ trong thân hàm là *"một luật một chỗ"*, KHÔNG phải ranh giới. `app_api` có `SELECT` mức bảng trên `rfq_unsealed_bids`
  (`019:459`), nên mã chạy dưới `app_api` bỏ qua được hàm (góc B⑧). Ranh giới thật là: một test kiến trúc liệt kê mọi tệp đọc
  `rfq_unsealed_bids` — hôm nay năm tệp —, và hàm mới là tệp thứ sáu. **[S1.235]** Đo lúc dựng: năm tệp TypeScript sản xuất (bộ ghi của worker, bảng so sánh, lượt chấm, bảng xếp hạng, và `anh-xa.ts` của S4.3a — chỉ hỏi SỰ TỒN TẠI) cộng ba hàm SQL (hai trigger luật ghi của `089` và `quan_sat_gia`) — `tests/architecture/ban-ro-liet-ke.test.ts`.
- *"Vị từ khách trong thân"* là thừa. Với `security_invoker`, policy `rfq_unsealed_bids_khach` áp theo người gọi, nên phiên
  khách và phiên Passport ra 0 hàng. Nếu vẫn viết vị từ ấy thì phải theo literal của `027:235-237`. Còn *"`RESTRICTIVE` trên
  mọi bảng mới"* không áp được cho `uom_units`, vì bảng ấy không có RLS.

**Cổng đọc: `bid.view`** — cùng cổng của `buildComparisonTable` và `docBangXepHang`. Lịch sử giá là giá sau mở thầu, và
cổng của dữ liệu ấy đã là `bid.view`. **[S1.159]** Một lần đọc bảng so sánh THÀNH CÔNG hôm nay không để lại hàng sổ:
`requirePermission` trả về mà không ghi khi có quyền (`packages/identity/src/rbac.ts:537`), và `buildComparisonTable` chỉ ghi
lần TỪ CHỐI. Lời khai *"mọi lần đọc bảng so sánh sau mở thầu đều có hàng sổ"* ở `PRODUCT.md` §5 và ADR-055 vì vậy sai — khoản
**245**. Đường đọc lịch sử của S4 không được viện dẫn lời khai ấy.

Vì sao ~~view~~ **[S1.159] hàm** mà không phải bảng — ADR (c), nay ADR-095:
- Một bảng sẽ là bản SAO thứ ba của giá dạng rõ, với vai ghi riêng và một đường đồng bộ riêng.
- ~~View~~ Hàm không sao gì. Mọi giá nó trả vẫn nằm ở `rfq_unsealed_bids`, dưới đúng vai ghi `app_unseal`.
- Cái giá: mỗi lần đọc lịch sử là một lần phân tích `jsonb` trên mọi báo giá đã mở của tổ chức. S4.4 phải đo thời gian đọc
  ở quy mô GIẢ ĐỊNH của một pilot (vài nghìn gói). ~~Nếu vượt ngưỡng thì phương án đúng là một CHỈ MỤC biểu thức, không phải
  một materialized view — vì §2.1 đã đo được rằng bước 14 hôm nay không thấy materialized view.~~ **[S1.159] Lối thoát vừa
  gạch không tồn tại** (góc B⑦): một chỉ mục có đúng một mục cho mỗi hàng, còn một hàng `rfq_unsealed_bids` có N dòng. Lối
  thoát thật là một bảng lưu — tức bảng giá thứ ba — và nó chỉ được dựng sau một dòng khai mới ở ADR-054. Ngưỡng ở §2.5 ㉓.

### 4.6. Benchmark

**[S1.159] Phương pháp đổi theo §2.4 ⑾ — `TRUNG_VI_THEO_GOI_V1`.** Mỗi gói (trừ gói đang xét và gói `CANCELLED`) cho một
trung vị trên các báo giá vị thế cuối; mốc so là trung vị của các trung vị gói; dải là [Q1, Q3] trên các trung vị gói. Sàn là
≥ `san_goi` gói VÀ ≥ `san_ncc` nhà cung cấp khác nhau. Màn hiện thành phần: *n gói · m nhà cung cấp · k gói do chính người tạo
gói này lập · h quan sát ánh xạ hồi tố*. Nhãn `BINH_THUONG` hiện là *"trong dải lịch sử nội bộ (n gói, m nhà cung cấp)"*: vắng
tín hiệu không có nghĩa là sạch, và dải có thể là dải của một cartel. Bản gốc giữ để đối chiếu:

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
**[S1.159]** *"Thấp bất thường"* chỉ dẫn tới một yêu cầu làm rõ, không bao giờ là căn cứ loại một báo giá (§2.4 ⑾). Nếu không,
một dải do cartel đặt biến giá thấp thật thành cái cớ loại người trung thực (góc C⑪).

**Mốc ngoài đứng riêng, không trộn vào tập nội bộ.** Màn hiện hai dòng: *dải nội bộ* và *mốc ngoài (nguồn: …, ngày …)*.
Trộn chúng thì một mốc ngoài nhập tay kéo được trung vị của lịch sử thật. ADR (d) chốt mốc ngoài một mình có được sinh nhãn
không; tài liệu này đề xuất KHÔNG — mốc ngoài chỉ hiện độ lệch, không sinh nhãn. **[S1.159] ADR-096 chốt đúng đề xuất ấy.
Và màn có dòng THỨ BA** (§2.4 ⑽): *dải lịch sử ngoài hệ thống (nguồn: …, n dòng)*, tính cùng phương pháp trên bảng §4.7, có
nhãn RIÊNG ghi rõ nguồn, không trộn vào dải nội bộ.

**Lưu gì.** Kết quả benchmark KHÔNG được lưu dưới dạng số. Trung vị của một tập lẻ LÀ một giá có thật, nên một cột
`trung_vi` là một bảng giá dạng rõ chưa khai. Khi cần lưu — nhãn làm đầu vào cho Risk Score ở S4b, hay bộ bằng chứng — S4
lưu `(rfq_id, line_no, supplier_id, nhan, phien_ban_phuong_phap, quan_sat_ids, moc_mo_gia)` trên bảng
`price_benchmark_results`. Bảng ấy không có cột số nào có đơn vị tiền. Tính lại từ `quan_sat_ids` phải ra đúng nhãn (L7).
**[S1.159] Ba chỗ đổi** (§2.5 ⑿): *"khi cần lưu"* để người đọc chọn thời điểm, nên kết quả ghi ĐÚNG MỘT LẦN, trong giao dịch
tạo lượt chấm; `quan_sat_ids uuid[]` không định danh được một dòng, nên thay bằng bảng con khoá ngoại `(org_id,
bid_version_id)` → `rfq_unsealed_bids` kèm `line_no`, cùng id mọi hàng nền đã dùng; và hàng mang `policy_id`, vì ngưỡng và
sàn nằm trên phiên bản chính sách.

> **[S1.256 / S4.5b — CHỐT, ADR-142]** Hai bảng: `price_benchmark_results` (một hàng mỗi báo giá × dòng — nhãn, chiều, lý do, khoá
> dải, số đếm; không cột tiền) và `price_benchmark_inputs` (một hàng mỗi quan sát đã vào dải — báo giá, dòng, id ánh xạ, cờ hồi tố).
> **Lệch chữ, nói ra:** bảng con KHÔNG mang id quy đổi, bí danh hay phiên bản hàng chuẩn — `quan_sat_gia` không trả chúng và bí danh
> toàn cục không có id; các hàng ấy tái lập bằng phép đọc as-of tại mốc đã lưu (L1). `SAU_MOC` không lưu — nó đếm tới LÚC ĐỌC. Nhãn
> thứ năm `KHONG_DO_DUOC` (kèm lý do) cho dòng của X không đo được; giá của chính dòng đọc lúc tính, có cờ hồi tố. *"Ghi đúng một lần
> trong giao dịch tạo lượt chấm"* buộc bằng khoá ngoại `(…, ghi_luc) → rfq_evaluations (…, created_at)` — cả hai `now()` ngoài `GRANT`.

> **[S1.260 / S4.5c1 — CHỐT, ADR-143]** Bảng so sánh đọc một BẢN LƯU cho mỗi lần mở thầu (`price_benchmark_snapshots`, không cột tiền),
> tính ở lần đọc đầu. *"Lưu gì"* ở trên giữ nguyên chữ: Q1, trung vị, Q3 và `SAU_MOC` KHÔNG lưu — tính khi bấm *Xem dải* một dòng, một lần đọc
> `quan_sat_gia` tại `moc_mo_gia` đã lưu, có cổng và hàng sổ.

**Hiện ở đâu.** Chỉ ở bảng so sánh và bảng xếp hạng SAU mở thầu, cho người giữ `bid.view`. Không có trên màn nhà cung cấp,
không có trong thông điệp mời BAFO (A5). ~~Dải lịch sử (không có giá của gói đang xét) cũng hiện được ở màn tạo gói cho người
giữ `bid.view` — đó là giá của những gói đã mở.~~ **[S1.159] Câu vừa gạch sai hai chỗ.** Lúc gói còn `DRAFT` chưa có ánh xạ
nào để chọn dải — chuẩn hoá chạy sau cạnh nộp duyệt (góc D⑫). Và dải hiện cho PM, người đồng thời mời thầu, là một *"bến đỗ
an toàn"*: nói với người quen *"cao hơn trung vị 4,9%"* thì không bao giờ dính nhãn (góc C⑧). Màn tạo gói chỉ hiện *"đủ /
chưa đủ lịch sử"* (§2.5 ㉑).

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

**[S1.159] Cổng đọc và nguồn thứ ba** (ADR-096):
- Người ghi: `DATA_STEWARD` (`item.manage`). Người đọc: `bid.view` — mốc ngoài mang giá. Câu *"người đọc: mọi vai giữ
  `rfq.create`"* ở §4.3 chỉ nói về hàng chuẩn.
- Nguồn không được là một báo giá trong chính hệ thống: chép một báo giá đã mở vào làm *"mốc ngoài"* là rửa giá xuống một cổng
  khác (góc C⑧). Luật này là lời khai của người nhập, có chủ thể và thời điểm, không phải một phép kiểm máy.
- **`external_purchase_history`** (§2.4 ⑽): lịch sử mua ngoài hệ thống — `(canonical_item_id, don_gia, don_vi, tien_te,
  ngay_mua, nha_cung_cap_text, nguon, lo_nhap_id)`, cùng khuôn chỉ-ghi-thêm, `seq`, `ghi_luc`, hàng rút. Dán CSV theo lô; mỗi
  lô một hàng sổ. Chịu L1 và L3. Không vào dải nội bộ, không tính cho cổng (e).
- Cả hai bảng được khai ở ADR-054 là *"bảng giá không phải báo giá"*, kèm vai ghi và cổng đọc, và bước 14 quét chúng bằng kim
  riêng (§2.5 ⒅).

### 4.8. TCO — nới tập thành phần của Effective Cost

ADR-053 ⑶ đã nói vì sao hôm nay chỉ chấm được `gia`: *"một báo giá hôm nay chỉ mang đúng một số tiền mà hệ thống đọc được"*.
S4 thêm nguồn, và mỗi mã thành phần mới phải có ĐÚNG MỘT nguồn đọc được:

| Mã | V2.1 §16 | Nguồn | Đơn vị |
|---|---|---|---|
| `gia` | Unit Price | `totalAmount` (`020`), như hôm nay | `TIEN` |
| `van_chuyen` | Freight | Ô nhà cung cấp khai trong phong bì: `freight` | `TIEN` |
| ~~`thue`~~ | ~~Tax~~ | ~~Ô khai: `tax`~~ **[S1.159] Bỏ** (§2.4 ⑻): thuế GTGT khấu trừ được không phải chi phí, và `tax = 0` trên một tổng chưa gồm VAT là lợi 8–10% cho người khai | ~~`TIEN`~~ |
| `nhap_khau` | Import Cost | Ô khai: `importCost` | `TIEN` |
| `chi_phi_thanh_toan` | Payment Cost | Quy đổi: max(0, `ngay_thanh_toan_chuan` − `paymentDays` (khai)) × `chi_phi_von_nam` / 365 × `totalAmount` — chi phí vốn khi phải trả SỚM hơn kỳ chuẩn của tổ chức | `TIEN` |
| `chi_phi_tre` | Delay Cost | Quy đổi: max(0, `leadTimeDays` (khai) − số ngày giao yêu cầu của GÓI) × `chi_phi_tre_ngay` | `TIEN` |
| `chat_luong` | Quality Cost | **Không có nguồn tới S5** — cần tỷ lệ lỗi từ GRN | — |

Ba luật:

- **Ô khai là tuỳ chọn và chỉ hiện khi chính sách bật mã ấy** (ràng buộc 11). Bật mà nhà cung cấp để trống thì dòng ấy
  từ chối chấm, gọi tên mã thiếu. Không lấy `0` — ADR-053 ⑶ đã giải thích vì sao.
- **`chat_luong` không khai được.** Chính sách khai nó thì bị từ chối ~~ngay khi TẠO phiên bản~~ **[S1.159]** ở lượt chấm, bằng một câu gọi tên *"chưa có
  nguồn dữ liệu"*. ~~Như vậy lỗi lộ ra ở lúc cấu hình, không ở lúc chấm.~~ **[S1.159]** Màn khai chính sách CẢNH BÁO ngay lúc
  khai (§2.5 ㉒), nên lỗi vẫn lộ ở lúc cấu hình mà không cần một `CHECK` trên bảng S3.1 đang sửa.
- **Tham số quy đổi là của bên mua** và nằm trên phiên bản chính sách, nên chúng vào bộ bằng chứng cùng phiên bản (ADR-059).
  Mặc định `NULL`. Một tổ chức muốn cộng chi phí thanh toán phải tự khai chi phí vốn. Rủi ro *"khai đại cho xong"* của
  spec S2 §8.2 áp nguyên, và §8.6 bàn nó.

**Số ngày giao yêu cầu là của GÓI, không của chính sách.** `rfq_packages` không có cột ấy. S4.7 thêm một bảng riêng, chỉ sửa
ở `DRAFT` bằng trigger riêng — cùng lý do spec S3 §4.3 cho `category_id`: khối *"chỉ sửa ở DRAFT"* của thân ghim chỉ phủ
`title` và `requires_dual_approval`. Con số ấy hiện cho nhà cung cấp ở màn nộp thầu, cạnh ô `leadTimeDays`. Hai công thức
quy đổi ở bảng trên là GIẢ ĐỊNH, chốt ở S4.7.

Mọi ô khai đọc bằng bộ đọc SQL khuôn `bid_so_tien`, ~~và `CHECK` hình dạng của `components` (`057`) nới theo tập mã~~. J1 và J2
giữ nguyên mệnh đề. Chỉ bảng ca và hàm đọc đổi.

**[S1.159] Bốn chỗ đổi** (§2.4 ⑸⑻, §2.5 ⒃㉑):
- **Không nới `057`.** Không `CHECK` nào của `057` liệt kê mã (`057:50-62`, `057:168-178`), và trigger J1 chỉ so với tập mã của
  chính sách. Chốt *"mã có nguồn"*, *"không `chat_luong`"* và *"`he_so` của mã `TIEN` bằng 1"* kiểm LÚC CHẤM ở tầng gói, đúng
  chỗ ADR-053 ⑶ đặt. Câu *"bị từ chối ngay khi TẠO phiên bản"* ở trên bị gạch nghĩa: từ chối ở lượt chấm, bằng mã gọi tên.
  Như thế S4.7 không thêm một `CHECK` trên bảng S3.1 đang sửa, và ca `kt`/`DIEM` (`luot-danh-gia.int.test.ts:533-539`) vẫn
  hợp lệ.
- **Phiên bản ghim lúc `OPEN`.** Tập mã nhà cung cấp thấy lúc nộp và tập mã lượt chấm dùng là MỘT. Một phiên bản bật
  `van_chuyen` sau khi gói mở không chạm được gói ấy (CAO ①).
- **Lời khai thành cam kết.** Lời khai TCO của báo giá được đề xuất lưu cùng award, vào bộ bằng chứng như điều khoản; nhãn
  *"theo lời khai của nhà cung cấp"*. Bảng xếp hạng hiện cả hạng theo `gia` lẫn hạng TCO; hai hạng khác nhau thì đề xuất trao
  cần giải trình không rỗng.
- **Khách đọc tập mã GHIM trên gói**, không đọc bảng chính sách: policy `_khach` của `org_procurement_policies` là vị từ đóng
  (`027`), và mở nó sẽ lộ ngưỡng, bậc S3, ngưỡng benchmark. Tập mã và số ngày giao chụp vào một bảng theo gói lúc `OPEN`, có
  `_khach` hẹp đã khai ở `POLICY_RESTRICTIVE_KHAI`, và nằm trong một băm riêng được ký — không định nghĩa lại
  `rfq_bam_noi_dung`, vì CAO ⑥ của §S1.139 đã đo rằng làm thế gãy gói cấp kép.

### 4.9. S4b — Supplier Score, Risk Score, phân tích người mua

Phần này ở mức HÌNH DẠNG. Chi tiết chốt ở một lượt soi riêng khi cổng (e) đạt, vì các con số của nó chỉ hiệu chỉnh được trên
dữ liệu thật. **[S1.160]** Chủ dự án chọn viết thiết kế chi tiết TRƯỚC cổng, không viết mã:
`docs/superpowers/specs/2026-09-26-trustprocure-s4b-tri-tue-mua-sam.md`. Tài liệu ấy thay mục này ở mức chi tiết; cổng (e)
vẫn chặn mã từ S4b.2.
**[S1.161]** Lượt soi hình dạng S1.161 của tài liệu ấy đổi ba chỗ của ⑼: S4b.1 nổ khi có ≥ 1 yếu tố đỏ hoặc mức
`KHONG_XAC_DINH`, điểm chỉ để hiển thị (spec S4b §2.4 ㉗); S4b.1 chỉ áp cho tổ chức đã bật S3 (㉙); tập người ghi nhận đọc theo
hành vi thật (§2.5 ㉞). Ngưỡng của S4b.1 là hằng của phương pháp, không phải khoá chính sách — ngoại lệ với ràng buộc 10 ở trên
(㉘). Bốn chỗ ấy là ADR-098.

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
~~theo thứ tự ADR-058 ⑸~~ **[S1.159]** theo thứ tự ADR-058 ⑸ — khoảng cách giá thắng–giá nhì đứng đầu, rồi ma trận tỷ lệ thắng — cộng độ lệch benchmark của S4a, thứ ADR-058 ⑸ không có:

1. độ lệch benchmark của báo giá thắng (§4.6);
2. khoảng cách giá thắng–giá nhì;
3. ma trận tỷ lệ thắng: người mời × nhà cung cấp, và xoay vòng thắng thầu;
4. mức tập trung nhà cung cấp theo hàng chuẩn;
5. thời điểm nộp và số lần sửa sát hạn (V2.1 §11). ~~Chỉ đọc gói `≥ CLOSED` (A6), và phiên bản BAFO chỉ khi vòng đã đóng;~~
   **[S1.159]** Chỉ đọc gói đã mở niêm phong theo vị từ §2.5 ⒀ — đọc từ `CLOSED` lộ ai đã nộp và nhịp sửa TRƯỚC mở thầu (góc C⑦);
6. tín hiệu governance của S3 — chia nhỏ, ngoại lệ, thu hẹp danh sách, đóng sớm — dùng làm đầu vào, không tính lại.

Luật trình bày:
- Yếu tố dưới sàn lịch sử hiện `CHUA_DU_LICH_SU` và KHÔNG góp điểm. Nó cũng không góp `0` — `0` sẽ đọc là *"rủi ro thấp"*.
- Điểm đi kèm tỷ lệ trọng số THỰC SỰ có dữ liệu. *"24/100 trên 35% trọng số có dữ liệu"* là một câu khác hẳn *"24/100"*.
- Mức `THAP` / `VUA` / `CAO` do ngưỡng trên phiên bản chính sách quyết định, GIẢ ĐỊNH.
- Chữ trên màn theo PRODUCT §5: *"điểm rủi ro — chỉ báo cần xem xét"*, không bao giờ là *"gian lận"*.

**Cấm duyệt một chạm cho gói rủi ro `CAO` (V2.1 §24)** — hạng mục đầu của S4b, vì spec S3 §10 đã chuyển nó sang đây. Chữ ký
duyệt trao thầu của một gói mức `CAO` cần đủ ba thứ, tính lại lúc ký theo khuôn fail-closed của K10:
- MFA trong cửa sổ `MFA_FRESH` (~~tái dùng `gate.ts`~~ **[S1.159]** `assertFreshMfa` của `packages/identity`);
- giải trình không rỗng;
- một hàng ghi nhận cho TỪNG yếu tố mức đỏ, do người nằm ngoài `{người tạo gói, người gây ra yếu tố}` **[S1.159] `∪ {người đề
  xuất, người duyệt}`** — với yếu tố benchmark, *người gây ra* là nhà cung cấp, nên tập cũ để người DUYỆT tự ghi nhận rồi tự ký.

Phần này dựng trên cổng trao thầu mà S3.5 dựng lại, nên nó không bắt đầu trước S3.5.

**[S1.159] Ba chỗ đổi** (§2.4 ⑼): S4b.1 KHÔNG chờ cổng (e); độ phủ dữ liệu dưới ngưỡng cho mức `KHONG_XAC_DINH`, xử như `CAO`
— nếu không, tổ chức mới luôn ở `THAP` và chốt này không bao giờ nổ (góc C⑥); mức tính trên đầu vào ĐÓNG BĂNG tại mốc mở giá,
không đọc chính sách hay ánh xạ hiện hành lúc ký. V2.1 §24 viết *"MFA + justification HOẶC dual approval"*; chủ dự án chọn
MFA + giải trình + ghi nhận độc lập, không chọn nhánh *"hoặc"*.

**Phân tích người mua (V2.1 §20 *Buyer anomaly*).** Ma trận người mời × nhà cung cấp — tỷ lệ mời, tỷ lệ thắng, trên gói `≥
UNSEALED` — cùng xu hướng theo thời gian. Đây là dữ liệu VỀ NHÂN VIÊN. Cổng đọc là ~~`audit.read` (`FINANCE`, `DIRECTOR`)~~ **[S1.162]** `analytics.review`, chỉ vai mới `AUDITOR` giữ (ADR-100),
không phải `bid.view`, nên một PM không đọc được bảng phân tích chính mình. Nó là dữ liệu cá nhân theo nghĩa pháp luật — xem
§8.7. **[S1.159]** Chỉ phân tích NGƯỜI MỜI là phân tích sai người: người đặt thước và người duyệt đứng ngoài, và một
`FINANCE` đồng loã đọc được PM của mình đã bị gắn cờ chưa (góc C⑥). Thêm ma trận người đề xuất và người duyệt × nhà cung cấp,
và người đặt thước × gói. Chữ trên màn: *"tỷ lệ lệch khỏi mặt bằng tổ chức"*, không *"bất thường"* (§2.5 ㉔).

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

**[S1.159]** Câu vừa rồi SAI dưới bản nháp, và lượt soi đo được vì sao: thước mạnh nhất — phiên bản chính sách — nằm ngoài
cả hai (CAO ①); L1 không cài được bằng view phẳng và bỏ sót nửa số bảng nền (CAO ②); L3 miễn cho `TU_DONG` và tách người khỏi
việc tạo gói thay vì khỏi quyết định trao (CAO ④⑤). §5.1 đóng ba lỗ ấy bằng L14, L1 sửa, L2/L3 sửa. Sau §5.1, câu trên đúng
— và vẫn không đúng trước một người quản lý dữ liệu thông đồng.

### 5.1. [S1.159] Sửa sau lượt soi — mệnh đề chịu lực là bản ở đây

Hàng tách ra mang SỐ MỚI, không hậu tố: bộ đọc sổ bỏ qua hàng `L1a` mà không báo lỗi — đo (M2), khoản **246**.

| Mã | Sửa | Hạng mục | Nguồn |
|---|---|---|---|
| **L1** | Chỉ còn vế GHI: mọi bảng dữ liệu nền — bí danh đơn vị của tổ chức, danh tính và phiên bản hàng chuẩn, bí danh hàng, quy đổi riêng, ánh xạ, gợi ý, mốc ngoài, lịch sử ngoài hệ thống — chỉ-ghi-thêm có hàng rút; một trigger BEFORE INSERT lấy khoá tư vấn → `seq` = max + 1 → `ghi_luc = clock_timestamp()`, ba cột ngoài GRANT; danh tính hàng chuẩn bất biến | S4.1 (khuôn), mỗi bảng ở hạng mục dựng nó | §2.5 ⑿; góc B⑨ |
| **L2** | `TU_DONG` tồn tại khi và chỉ khi `chuoi_sach(description)` bằng một bí danh còn hiệu lực có `ghi_luc` trước hàng ánh xạ; trigger tính lại cả hai vế. Không ngưỡng độ tin cậy nào ở CSDL | S4.3 | §2.4 ⑹ |
| **L3** | `item.manage` chỉ ở vai `DATA_STEWARD`; vai và người ấy không giữ `bid.view`, `po.approve`, `award.recommend`, `rfq.create`, `rfq.invite` (hai trigger khuôn `033`). Người ghi `NGUOI_DUYET` nằm ngoài TRỌN tập của ADR-082 ⑿. `TU_DONG` trên gói đã có bản rõ chỉ do người giữ `item.manage` kích hoạt | S4.2 (vai), S4.3 (hành vi) | §2.4 ⑺; §2.5 ⒂ |
| **L4** | Quy đổi chỉ ở MỘT hàm SQL; bí danh toàn cục ở bảng toàn cục riêng; `uom_units` chỉ-ghi-thêm có chốt `TRUNCATE`; hệ số đã dùng vào bộ xuất. Vế ⑵ (quy đổi riêng) đo ở S4.2, nơi bảng ấy ra đời | S4.1, S4.2 | §2.5 ⒄; góc B⑩, D⑥ |
| **L5** | Vị từ *"giá đã lộ"* là MỘT hàm SQL theo dữ liệu (§2.5 ⒀); gói `CANCELLED` không cho quan sát; đơn giá = `amount / quantity`; phép kiểm dòng duy nhất là Σ `amount` = `totalAmount`; bộ đọc từ chối SÁU ca của `bid_so_tien`; quan sát khác tiền tệ ~~của lượt chấm gói X~~ **[S1.235]** của chính sách của CHÍNH gói chứa quan sát mang `LECH_TIEN_TE` — so với gói X là việc của benchmark (S4.5), chủ dự án chốt 2026-09-30; gói `CANCELLED` bị loại TỪ LÚC huỷ, không hồi tố (ADR-136 ③) | S4.4 → **[S1.235]** S4.4a | §2.5 ⒀⒁; M1 |
| **L6** | Đối chứng dương chạy ở CẢ `BAFO_OPEN` lẫn `BAFO_CLOSED`: bộ quét không thấy quan sát vòng hai tới khi vòng ấy mở niêm phong. **[S1.251 / S4.4b]** Đo: ở hai trạng thái ấy lịch sử không mang quan sát nào của CẢ gói (vị thế cuối của top-2 chưa biết — `gia_da_lo`, ADR-136 ③), không chỉ của vòng hai. Thêm: màn tạo gói chỉ hiện *"đủ / chưa đủ"*; mốc ngoài và lịch sử ngoài đọc bằng `bid.view`; bộ bằng chứng mang định danh băm có muối; route đọc là `agent: false`; test kiến trúc liệt kê mọi tệp đọc `rfq_unsealed_bids` | S4.4, S4.5 | §2.5 ㉑; góc B⑧, C⑦ |
| **L7** | Nhãn benchmark của X = hàm as-of tại mốc X, theo phương pháp `TRUNG_VI_THEO_GOI_V1` và sàn ≥ 3 gói, ≥ 3 nhà cung cấp; ghi ĐÚNG MỘT LẦN trong giao dịch tạo lượt chấm, kèm `policy_id` và bảng con khoá ngoại tới mọi quan sát và hàng nền đã dùng; tính lại ra đúng nhãn; hai nhãn `HOI_TO`/`SAU_MOC` đếm theo loại hàng nền. **[S1.256 / S4.5b — vào sổ]** Bảng con khoá ngoại tới mọi quan sát kèm id ánh xạ — không id quy đổi, bí danh, phiên bản hàng chuẩn (tái lập as-of); `HOI_TO` lưu theo loại trên từng quan sát và trên chính dòng, `SAU_MOC` không lưu (đếm tới lúc đọc, ADR-142); ghi một lần buộc bằng khoá ngoại tới `created_at` của lượt chấm | S4.5 → **[S1.256]** S4.5b | §2.4 ⑾; §2.5 ⑿ |
| **L8** | Kiểm LÚC CHẤM ở tầng gói, không thêm `CHECK`: mã có nguồn; không `chat_luong`, không `thue`; `he_so` của mã `TIEN` bằng "1". Lời khai TCO của báo giá được đề xuất lưu cùng award; hạng giá khác hạng TCO thì đề xuất trao cần giải trình | S4.7 | §2.4 ⑻; §2.5 ⒃ |
| **L10** | Độ phủ trọng số có dữ liệu dưới ngưỡng GIẢ ĐỊNH → mức `KHONG_XAC_DINH`; mức tính trên đầu vào đóng băng tại mốc mở giá | S4b.2 | §2.4 ⑼ |
| **L11** | Không chờ cổng (e); đứng sau S3.5. `KHONG_XAC_DINH` xử như `CAO`. Người ghi nhận nằm ngoài {người tạo gói, người gây ra, người đề xuất, người duyệt}. MFA qua `assertFreshMfa` | S4b.1 | §2.4 ⑼ |
| **L12** | `CONTROL_DENIED` là từ vựng S3 dựng (ADR-084 ⑷); S4 dùng lại, không dựng bản thứ hai | Từ S4.3 | góc A⑪ |
| **L13** — mới, tách từ L1 | Ánh xạ ghi cho một gói đã có ít nhất một hàng `rfq_unsealed_bids` đòi lý do không rỗng; trigger khoá theo SỰ TỒN TẠI của hàng bản rõ, không theo `status`. Đo cả ca ghi TRONG lúc giao dịch mở thầu đang chạy | S4.3 | §2.5 ⒀; góc B⑪⑷ |
| **L14** — mới | Lượt chấm, TCO, benchmark và form nhà cung cấp của gói X dùng đúng phiên bản `chinh_sach_tai(org_id, opened_at X)`; lượt chấm dưới phiên bản khác bị từ chối và vào sổ `CONTROL_DENIED`. **[S1.253 / S4.5a]** `chinh_sach_tai` = phiên bản `chinh_sach_hieu_luc` chụp vào gói ở cạnh vào OPEN — `rfq_packages.chinh_sach_ghim_id` (ADR-141). Vế lượt chấm vào sổ ở S4.5a; vế benchmark ở S4.5b; vế TCO và form nhà cung cấp tách số MỚI ở S4.7 | S4.5 (sau S3.1) | §2.4 ⑸ |
| **L15** — mới | Lịch sử mua ngoài hệ thống do `DATA_STEWARD` nhập, chịu L1; dải và nhãn của nó tách khỏi dải nội bộ; không một phép đếm nào của cổng (e) đọc nó | S4.6 | §2.4 ⑽ |

L9 không đổi.

**[S1.161]** Hai hàng L10, L11 ở trên trôi khỏi thiết kế chi tiết. Bảng chịu lực của L9–L11 và L16–L23 là spec S4b §11.1: L10
tách — phần tái lập các yếu tố không phải chuỗi ở S4b.1, phần chuỗi thành **L22** ở S4b.2; L11 đặt trên `rfq_award_approvals`,
nổ khi có yếu tố đỏ hoặc `KHONG_XAC_DINH`, chỉ ở tổ chức đã bật S3; thêm **L23** (ngưỡng là hằng của phương pháp). L9 đặt ở
S4b.4 như bảng gốc — không phải S4b.3.

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

**[S1.159] Thêm các phép đo phải có:**
- **Ba phép đo của lượt soi thành test thường trực:** M1 (sáu ca của `bid_so_tien`, vào bảng ca của `bid_dong_tho` ở S4.4);
  M2 (bộ đọc sổ với hàng có hậu tố — khoản 246); M3 (`CHECK` ngưỡng bằng `.double()` trên chuỗi số, S4.5).
- **L14** đo bằng tạo phiên bản chính sách mới SAU khi gói vào `OPEN` rồi chấm: lượt chấm bị từ chối. Đối chứng: phiên bản tạo
  trước `opened_at` chấm được. Và bằng mũi T5 mới — bật `van_chuyen` sau khi nộp, một nhà cung cấp tự chèn `freight` vào bản
  rõ: lượt chấm vẫn dùng tập mã ghim, và bản rõ có ô thừa không được thưởng.
- **L2** đo bằng một hàng `TU_DONG` do `app_api` ghi với chuỗi KHÔNG trùng bí danh nào: trigger chặn. Đột biến gỡ vế tính lại
  `chuoi_sach` phải sống sót không được.
- **L7 as-of** đo bằng ghi một quy đổi hồi tố cho gói Y SAU mốc của X: nhãn của X không đổi khi tính lại, và nhãn `HOI_TO` của
  gói Z sau đó đếm đúng hàng quy đổi ấy.
- **Năm mũi T5 thêm**, mỗi mũi một đường vòng lượt soi tìm ra: tạo phiên bản chính sách sau khi thấy giá (C①); quy đổi hồi tố
  dịch dải (C②); `lines[]` lệch tổng mà tổng đọc được (C④); khai `freight = 0` (C⑤ — không chặn được, đo rằng cam kết lưu
  cùng award); rải gói để giữ yếu tố dưới sàn (C⑥ — đo rằng mức ra `KHONG_XAC_DINH`).
- **Tổng điều tra loại quan hệ** (`db/hardening-suy-tu-tinh-chat.int.test.ts:2146-2162`, `LOAI_DA_KHAI = []`), census
  `role_table_grants`, `SAN_SO_TRIGGER`, ghim ba chỗ của INV-H19 — các cổng sẽ đỏ ở hạng mục đầu thêm bảng, trigger hay hàm
  mới. Kê tên trong từng hạng mục, không phát hiện lúc CI đỏ (góc B⑫).

---

## 7. Điều kiện hoàn thành

### 7.1. S4a

**[S1.159] Câu nghiệm thu dưới đây KHÔNG chạy như đang viết** (góc A②, D④): gói cũ đã qua cạnh nộp duyệt nên không có đường
chuẩn hoá cho chúng; ánh xạ `TU_DONG` trên gói đã mở không có ai ghi lý do; mọi quan sát của nó là ánh xạ hồi tố mà câu không
nói; và `gieo:demo` không có gói nào mang `lines` thật. Câu thay thế ở cuối mục này. Bản gốc giữ để đối chiếu:

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

S4a không thêm người vào kịch bản của MVP1 ngoài F1. ~~Có thể F1 là F2, tuỳ bảng mã quyền chốt ở S4.0.~~ **[S1.159]** F1 KHÔNG
thể là F2: F1 giữ vai mới `DATA_STEWARD`, không giữ `bid.view` (§2.4 ⑺). Bước *"chấm"* ở bảng trên đi qua `evaluation.perform`
(`buyer.ts:478-483`), không qua `bid.view` — P2 và F2 giữ cả hai, nên người trong bảng vẫn đúng.

**[S1.159] Câu nghiệm thu thay thế:**

> **Tiền điều kiện, do `gieo:demo` dựng:** ba gói cũ đã mở niêm phong, mỗi gói ba nhà cung cấp, phong bì mang `lines` thật, mua
> thép D10 dưới ba cách viết — *"Thép Hòa Phát D10"* theo `kg`, *"Thep HP phi 10"* theo `tấn`, *"D10-HP"* theo `cây`.
> Người quản lý dữ liệu S — vai `DATA_STEWARD`, không thấy giá — khai hàng chuẩn *"Thép thanh vằn D10 CB300 — Hòa Phát"*, đơn vị
> gốc `kg`, quy đổi riêng *1 cây = 7,22 kg*, và hai bí danh `thep hoa phat d10`, `thep hp phi 10`. S bấm *"chuẩn hoá hồi tố"*:
> hai dòng đầu thành `TU_DONG` mang mã `CHUAN_HOA_HOI_TO`; dòng *"D10-HP"* vào hàng đợi, S duyệt nó và hàng đợi học bí danh ấy.
> Người tài chính F2 khai một phiên bản chính sách có nhóm `benchmark` và `tco` (`van_chuyen`, `chi_phi_tre`).
> Một gói mới có ba hạng mục, mở dưới phiên bản ấy. Nhà cung cấp A báo đơn giá thấp nhất và khai phí vận chuyển; B cao hơn 3%
> đơn giá và khai miễn vận chuyển; C báo thép cao hơn trung vị nội bộ 12%.
> Sau mở niêm phong, bảng so sánh theo dòng hiện dải nội bộ của dòng thép quy về VND/kg, kèm thành phần *"3 gói · 5 nhà cung
> cấp · 9 quan sát ánh xạ hồi tố"* và độ phủ của từng báo giá; dòng của C mang nhãn *"Giá bất thường — nên xem xét"*.
> Bảng xếp hạng đặt B trên A theo Effective Cost và A trên B theo giá, hiện từng thành phần kèm nhãn *"theo lời khai của nhà
> cung cấp"*. Người đề xuất trao cho B phải viết giải trình vì hai hạng khác nhau, và lời khai miễn vận chuyển của B lưu cùng
> award.
> Bộ bằng chứng xuất ra tính lại được, khi đã ngắt CSDL, cả nhãn benchmark lẫn Effective Cost — với định danh gói và nhà cung
> cấp của các quan sát được băm — và trả lời được: *phiên bản chính sách nào đã áp cho gói, dòng "D10-HP" do ai ánh xạ, lúc
> nào, trước hay sau khi giá của chính nó lộ*.

Vai, dưới mặc định §4.1 và §2.4 ⑺:

| Bước | Ai | Vì sao phải là người ấy |
|---|---|---|
| Hàng chuẩn, bí danh, quy đổi, chuẩn hoá hồi tố, duyệt hàng đợi | S (`DATA_STEWARD`) | Vai mù giá; không giữ `rfq.create`/`rfq.invite` (L3) |
| Khai phiên bản chính sách | F2 (`FINANCE`) | `policy.manage`. Ở tổ chức đã bật S3: thêm một người `FINANCE` khác ký phiên bản (ADR-082 ⑺) |
| Tạo gói, mời | P1 | — |
| Ký, mở gói | P2 (PM) | Sàn một chữ ký (ADR-085) |
| Mở niêm phong | D1, D2 | D2 |
| Chấm | P2 | `evaluation.perform` |
| Đề xuất trao | P2 | Khác người tạo gói (J3) |
| Duyệt trao | D1 | `po.approve`. Không dùng F2: ở tổ chức đã bật S3, tác giả phiên bản chính sách mà gói ghim không ký trao gói ấy (ADR-082 ⑺) |

Tối thiểu **6 người** — S, F2, P1, P2, D1, D2 — và **7** ở tổ chức đã bật S3. So với bản nháp, S là người thêm: đó là cái giá
chủ dự án chọn ở §2.4 ⑺. `gieo:demo` hôm nay có 0 `FINANCE`, 0 `DATA_STEWARD` và 0 gói có `lines` — S4.4 và S4.5 gieo lại.

### 7.2. S4b

Khi cổng (e) đạt, kịch bản là V2.1 §41, trên dữ liệu của tổ chức đã vượt sàn:

> Gói 1 tỷ, năm nhà cung cấp. ~~Sau hạn nộp~~ **[S1.159] Sau mở niêm phong** (góc C⑦: *sau hạn nộp* là trước mở thầu, trái A1/A4), màn tổng quan hiện giá thấp nhất, benchmark, ~~Supplier Score~~ **[S1.162: S5]**, lịch sử mua, Risk
> Score kèm tỷ lệ trọng số có dữ liệu, và số lần sửa báo giá. ~~Hệ thống đề xuất B~~ **[S1.159]** B xếp đầu theo Effective Cost khai
> dù A có đơn giá thấp nhất. Gói ở mức `CAO`,
> nên người duyệt trao thầu không ký được bằng một chạm: phải qua MFA, viết giải trình, và ~~ghi nhận từng yếu tố đỏ~~ **[S1.159]**
> một người khác người đề xuất và người duyệt ghi nhận từng yếu tố đỏ.

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
`docs/PRODUCT.md` §5 có dòng tương ứng: *"chuẩn hoá dữ liệu chống thao túng giá"* → ~~*"thước đo được chốt trước khi giá lộ,
và mọi lần sửa thước để lại dấu"*~~ **[S1.159]** *"thước đo của một gói — phiên bản chính sách, ánh xạ, quy đổi, mốc ngoài —
được chốt tại mốc của gói; mọi hàng ghi sau đó mang nhãn; và người đặt thước dữ liệu không thấy giá. Không lớp nào chặn
được người quản lý dữ liệu bàn trước với người tạo gói"*. Câu cũ sai dưới bản nháp, vì phiên bản chính sách nằm ngoài luật
(góc C⑫).

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

### 8.10. [S1.159] Vai mới là một người mới

§2.4 ⑺ thêm một vai và một người vào mọi tổ chức dùng S4a: 6 người tối thiểu, 7 ở tổ chức đã bật S3 (§7.1). Một tổ chức nhỏ
sẽ muốn gán `DATA_STEWARD` cho người `FINANCE` sẵn có — và hai trigger khuôn `033` sẽ từ chối đúng việc ấy. Lối thoát dễ nhất
là không dùng S4a, không phải nới luật. Màn quản trị vai phải nói ra điều ấy trước khi tổ chức bật tính năng.

**[S1.199 / S4.2b]** Chưa có màn quản trị vai: vai được gán bằng `tools/khoi-tao-to-chuc` (`docs/DE-XUAT-TAO-TO-CHUC.md`). Nên câu
ấy được nói ở ba chỗ: màn `/du-lieu` — người không giữ `item.manage` chỉ xem, và màn nói tổ chức cần một NGƯỜI MỚI khi chưa ai giữ vai
(`GET /items` trả `soNguoiQuanLy`); bảng vai của đề xuất tạo tổ chức; và `khoi-tao.int.test.ts` đo bản khai FINANCE + DATA_STEWARD hỏng
ở đúng người ấy, không hàng nào nằm lại. Công cụ không kiểm lại luật ở bản khai — trigger phán, như mọi tổ hợp vai trái luật khác.

### 8.11. [S1.159] Ghim chính sách đảo một lựa chọn của S2

`luot-danh-gia.ts:124-128` giải thích vì sao S2 đọc phiên bản MỚI NHẤT: ghim thì mọi gói ra đời trước S2 không bao giờ chấm
được. §2.4 ⑸ đảo lựa chọn ấy cho mọi tổ chức, khi biết giá: một gói mở trước khi tổ chức khai chính sách chấm thì bị từ chối
bằng một câu gọi tên. Hôm nay không có khách hàng thật (PRODUCT §10), nên cái giá rơi vào `gieo:demo` và cụm test — S4.5 kê
tên từng ca lật. Sau pilot, cái giá ấy là thật.

### 8.12. [S1.159] Fail-closed ở rủi ro cao là ma sát cho tổ chức mới

§2.4 ⑼ xử `KHONG_XAC_DINH` như `CAO`. Tổ chức mới vì vậy không duyệt trao nào bằng một chạm cho tới khi độ phủ dữ liệu vượt
ngưỡng. Đó là lựa chọn có ý thức của chủ dự án. Rủi ro đi kèm: ma sát lặp lại biến giải trình thành thủ tục — đúng hình dạng
spec S3 §8.2 đã gọi tên cho ngoại lệ. Tỷ lệ giải trình theo tổ chức là một chỉ số hiện ở màn quản trị.

### 8.13. [S1.159] Cam kết TCO chưa được đối chiếu

§2.4 ⑻ biến lời khai thành cam kết có chủ thể, lưu cùng award. Nó không làm lời khai ĐÚNG. Đối chiếu lời khai với thực tế —
phí vận chuyển trên hoá đơn, ngày giao trên GRN — cần dữ liệu ERP, tức S5. Tới lúc ấy, *"tổng chi phí"* trên màn nghĩa là
*"tổng chi phí theo lời khai"*, và chữ trên màn nói đúng như thế.

### 8.14. [S1.159] Lịch sử ngoài hệ thống do bên mua tự nhập

§2.4 ⑽ nhận một nguồn mà bên mua tự gõ. Hiện riêng và không tính cho cổng (e) giới hạn thiệt hại, không triệt nó: một dải
lịch sử ngoài được nhập có chọn lọc vẫn hiện cạnh dải nội bộ, với nhãn riêng. L1 chặn việc nhập SAU khi thấy giá của gói; L3
chặn người chọn tự nhập. Không gì chặn việc chọn dòng nào để nhập.

---

## 9. Phân rã công việc

V2.1 §33 đặt MVP3 là 6–10 tuần cho cả mười mục. Tài liệu này ước **S4a 4–6 tuần**, S4b không ước — S4b chưa có ngày bắt đầu,
vì nó chờ cổng (e). Đây là ước lượng cùng loại với spec S3 §9, không phải số đo. Số đo duy nhất trong kho vẫn là S2: ước 3–4
tuần, chạy hết khoảng 41 giờ qua 14 vòng (S1.101–S1.114).

| # | Hạng mục | Ra cái gì |
|---|---|---|
| **S4.0** | Nền | Chốt ADR (a)–(d). Nới dải nhãn `[A-HJK]` → `[A-HJ-L]` ở MỌI chỗ ghim — grep lúc làm; hôm nay `A-HJK` có mặt ở 8 tệp, 18 dòng — và lật ca biên `L` của `parse.test.ts` (§8.9), trước khi hàng L đầu vào sổ. Bảng mã quyền: đề xuất ĐÚNG MỘT mã mới, `item.manage`, theo nguyên tắc ADR-084 ⑴ — chỉ thêm mã khi hành vi cần TÁCH NGƯỜI; đọc lịch sử và benchmark dùng `bid.view`, phân tích người mua dùng `audit.read` (**[S1.162]** sai sau ADR-100: mã mới `analytics.review`, vai `AUDITOR`). Vai mặc định của `item.manage` là quyết định của chủ dự án: `FINANCE` (không giữ `rfq.create`, `033`, nhưng đã giữ `policy.manage`, `supplier.qualify`, `category.manage`) hay một vai mới trong danh mục toàn cục `005` KHÔNG giữ `bid.view` — vai ấy ánh xạ hồi tố mà không thấy giá (§3.3). Tạo `packages/du-lieu-nen` và ranh giới `depcruise` |
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

**[S1.159] Bảng trên giữ nguyên văn; thứ tự và nội dung chịu lực là bảng dưới.** Luật thứ tự (§2.5 ⒆): hạng mục không chạm
`org_procurement_policies` đi trước; không hạng mục nào sửa bảng ấy trước khi S3.1 vào `master`.

| # | Hạng mục | Ra cái gì | Chờ |
|---|---|---|---|
| **S4.0** | Nền | ADR-093…097 đã chốt ở lượt soi. Nới dải `[A-HJK]`→`[A-HJ-L]` ở MỌI chỗ ghim — hôm nay 8 tệp, 18 dòng trong MÃ, 13 tệp, 27 dòng tính cả tài liệu, kể cả `docs/TEST-PLAN.md:522` —, lật ca biên `L` của `parse.test.ts`, thêm một hàng mẫu L vào `TEST_PLAN_MAU` (khuôn S1.153). Không chốt hậu tố: hàng tách mang số mới (khoản 246). Gói `du-lieu-nen`, `tri-tue` và ranh giới `depcruise` | S3.1 (cùng mười chỗ ghim) |
| **S4.1** | Đơn vị đo + khuôn nền | `uom_units` chỉ-ghi-thêm, bí danh toàn cục ở bảng riêng, `uom_aliases` của tổ chức, trigger khoá → `seq` → `ghi_luc`, hàm `chuoi_sach` và hàm quy đổi SQL; **L1** (khuôn), **L4** vế chung | — |
| **S4.2** | Hàng chuẩn + vai | Vai `DATA_STEWARD`, mã `item.manage` vào CSDL (ADR-084 ⑶), hai trigger khuôn `033`; danh tính bất biến, phiên bản, bí danh, quy đổi riêng; màn `/du-lieu`; **L3** vế vai, **L4** vế riêng | — |
| ↳ **S4.2a** [S1.197] | CSDL + gói | Vai, mã, hai trigger khuôn `033`, cổng ghi CSDL; bốn bảng hàng chuẩn; vế ⑵ của `quy_doi_don_vi`; hàm gói ghi/đọc — `083_hang_chuan`, ADR-116 | — |
| ↳ **S4.2b** | API + màn | Route cho hàng chuẩn, bí danh, quy đổi riêng, bí danh đơn vị; màn `/du-lieu`; `gieo:demo` và `khoi-tao-to-chuc` gán `DATA_STEWARD`; màn nói ra §8.10. **[S1.199]** Xong: 11 route (`routes/du-lieu.ts`), bốn hàm gói (liệt kê, chi tiết, danh mục đơn vị, khai/rút bí danh đơn vị), màn `/du-lieu`; `gieo:demo` gieo người `dulieu` và ba hàng chuẩn cho ba dòng demo. Không migration, không ADR | S4.2a |
| **S4.3** | Chuẩn hoá & ánh xạ | `TU_DONG` theo bí danh, `rfq_item_goi_y`, hàng đợi năm thao tác, chuẩn hoá hồi tố; **L2**, **L3** vế hành vi, **L13**; dòng PRODUCT §5 (§8.2) | — |
| ↳ **S4.3a** [S1.204] | CSDL + gói | `rfq_item_goi_y`, `rfq_item_mappings` (khuôn L1), luật ghi ở trigger (L2, L3 vế hành vi, L13, ⒁), tập loại trừ `rfq_tap_loai_tru` (đọc thêm sổ kiểm toán), lõi `chuanHoa` bộ luật 1, lượt chuẩn hoá, duyệt/bác/tạo hàng chuẩn, hàng đợi — `089_anh_xa_hang_muc`, ADR-121. Chủ dự án chốt 2026-09-30: vế tác giả ngoại lệ vào cùng hàm ở S3.3b; không mở E6 | — |
| ↳ **S4.3b** [S1.234] | API + màn | Lượt chuẩn hoá sau commit cạnh nộp duyệt; route hàng đợi; hàng đợi ở `/du-lieu`; trạng thái ánh xạ từng dòng ở `/tao-thau` (~~đợi chuỗi #199 → #202 → #205~~ chuỗi đã merge); `gieo:demo`; dòng PRODUCT §5 (§8.2). Chủ dự án chốt 2026-09-30: một PR; lượt chuẩn hoá chỉ ở tổ chức có hàng chuẩn đang dùng; năm route `agent: false`; không E6; dòng PRODUCT §5 chỉ nói phần đã có mã — vế *"chốt tại mốc của gói"* đợi S4.4. ADR-135 | S4.3a |
| **S4.4** | Lịch sử giá | `bid_dong_tho`, hàm *"giá đã lộ"*, `quan_sat_gia(p_moc)`; kịch bản 41 có `lines` và kim đơn giá, năm bộ quét; test kiến trúc liệt kê mọi tệp đọc `rfq_unsealed_bids`; đo hiệu năng có biên bản; gieo lại `gieo:demo`; **L5**, **L6** vế lịch sử | S3.2 (kịch bản 41) |
| ↳ **S4.4a** [S1.235] | CSDL | `bid_dong_tho`, `gia_da_lo`, `quan_sat_gia(p_moc, p_hang_chuan)`; lõi quy đổi theo mã `quy_doi_da_giai` mà `quy_doi_don_vi` gọi lại; test kiến trúc liệt kê mọi tệp và hàm chạm `rfq_unsealed_bids`; đo hiệu năng có biên bản (`tools/do-lich-su-gia`); **L5** — `096_lich_su_gia`, ADR-136. Chủ dự án chốt 2026-09-30: hai PR; tiền tệ chỉ so trong chính gói; nghĩa `SAU_MOC`/`HOI_TO`; tách lõi quy đổi theo mã | — |
| ↳ **S4.4b** | Route + kịch bản | `GET /items/:itemId/price-history` (`bid.view`, `agent: false`, mỗi lần đọc một hàng sổ); kịch bản 41 có `lines` và kim đơn giá, ~~năm~~ bốn bộ quét, đối chứng dương ở `BAFO_OPEN` và `BAFO_CLOSED`; `gieo:demo` ba gói đã mở qua đường thật; **L6** vế lịch sử. **[S1.251]** Xong: bộ đọc `docLichSuGia` (cổng trong hàm, hàng sổ `PRICE_HISTORY_READ` không giá), route `agent: false`, bộ quét giá chung trên bốn loại quan hệ có kim đơn giá, kịch bản 41 qua HTTP đo L6 ở `UNSEALED`/`BAFO_OPEN`/`BAFO_CLOSED`/`BAFO_UNSEALED`, `gieo:demo` mở ba gói qua worker thật (tiến trình con). Chủ dự án chốt 2026-10-01: hình dạng phản hồi đầy đủ trạng thái, không màn, bốn bộ quét, worker thật. ADR-140 | S4.4a |
| **S4.5** | Ghim chính sách + benchmark | Gọi `chinh_sach_tai` của S3.1; nhóm khoá `benchmark`; bảng kết quả và bảng con; bảng so sánh theo dòng ở `/mo-thau`; lớp dữ liệu nền trong bộ xuất ADR-059, định danh băm; **L14**, **L7**, **L6** vế benchmark; kê tên mọi ca chấm bị lật | S3.1 |
| ↳ **S4.5a** [S1.253] | Ghim chính sách | Gói chụp `chinh_sach_hieu_luc` ở cạnh vào OPEN vào `rfq_packages.chinh_sach_ghim_id`; lượt chấm đọc cột ấy; trigger `rfq_evaluations_kiem_phien_ban_ghim` có tên, lần vi phạm qua tầng gói vào sổ `CONTROL_DENIED` (`L14_PHIEN_BAN_KHONG_GHIM`); `gieo:demo` khai trọng số ở phiên bản 1; **L14** vế lượt chấm; kê ca lật. Chủ dự án chốt 2026-10-01: luật *hiệu lực tại `opened_at`*, ba PR, benchmark ở bảng so sánh tính as-of ngay khi `UNSEALED`, năm chi tiết phương pháp — ADR-141 | — |
| ↳ **S4.5b** | CSDL + lõi benchmark | Nhóm khoá `benchmark` (`CHECK` bằng `.double()`, §2.5 ㉒) và ô ở `/chinh-sach`; lõi thuần `TRUNG_VI_THEO_GOI_V1`; `price_benchmark_results` và bảng con khoá ngoại, ghi đúng một lần trong giao dịch tạo lượt chấm; bộ đọc có cổng và hàng sổ (ADR-140 ⑦); **L7**, **L14** vế benchmark. **[S1.256] XONG** — `103_benchmark_gia`, ADR-142: chủ dự án chốt 2026-10-01 bảng con lưu tham chiếu quan sát + id ánh xạ (không sửa `quan_sat_gia`), nhãn thứ năm `KHONG_DO_DUOC` cho mọi dòng không đo được, giá của chính dòng đọc lúc tính có cờ hồi tố; ghi một lần buộc bằng khoá ngoại `ghi_luc → rfq_evaluations.created_at`; màn `/chinh-sach` có nhóm khoá, mẫu và cảnh báo tĩnh | S4.5a |
| ↳ **S4.5c** | Hiện + bộ xuất | Bảng so sánh theo dòng ở `/mo-thau` (dải nội bộ, thành phần, độ phủ), nhãn ở bảng xếp hạng; lớp dữ liệu nền trong bộ xuất ADR-059 kèm mục `DAC-TA.md`, định danh băm có muối, tính lại ngoại tuyến; `gieo:demo`; **L6** vế benchmark; đi thử 375×812 **[S1.256 — chủ dự án chốt 2026-10-01, ADR-142 ⑼]** benchmark của bảng so sánh TÍNH MỘT LẦN khi gói vào `UNSEALED` (và `BAFO_UNSEALED`) rồi lưu — không tính as-of ở mỗi lần đọc (đo: 18–19 s ở 5.000 gói × 20 dòng) **[S1.260 — chủ dự án chốt 2026-10-01 sau phép đo, ADR-143]** ~~khi gói vào~~ ở lần đọc ĐẦU sau mỗi lần mở thầu (cạnh mở thầu không mang được phép tính — §3.1–3.2, vai `app_unseal`); ĐÓNG ở `BAFO_OPEN`/`BAFO_CLOSED`; giữ UTC; số của dải và `SAU_MOC` chỉ khi bấm *Xem dải*. Tách hai PR: **S4.5c1** — bản lưu (`104_ban_luu_benchmark`), route, màn, **L6** vế benchmark, `gieo:demo`; **S4.5c2** — bộ xuất ADR-059, `DAC-TA.md`, bộ kiểm ngoại tuyến **[S1.262 — chủ dự án chốt 2026-10-02, ADR-144]** muối của định danh băm NGẪU NHIÊN mỗi lần xuất, không lưu; bộ kiểm tính lại TỪ ĐƠN GIÁ ĐÃ QUY ĐỔI (phép quy đổi đơn vị không tính lại); chỉ lớp LƯỢT CHẤM — bản lưu của bảng so sánh không vào bundle; người ánh xạ ra bằng mã + họ tên. Bundle và `DAC-TA.md` phiên bản 2 (§8 lớp dữ liệu nền, lịch UTC). Sau rà soát đối kháng: `ngay` của quan sát là ngày UTC (đủ micro giây chỉ trên ngày biên), mã băm chặn đọc ra định danh nhưng không chặn khớp (ngày, giá) với lịch sử giá của chính tổ chức; xuất qua HTTP giữ đồng bộ, trần thời gian là khoản 337 | S4.5b |
| **S4.6** | Mốc ngoài + lịch sử ngoài hệ thống | `external_price_references`, `external_purchase_history`, dán CSV, dải thứ ba; khai ở ADR-054; **L15**, **L1** vế hai bảng ấy | S4.5 |
| ↳ **S4.6a** [S1.272] | Bảng + đường ghi | `109_du_lieu_ngoai` (khuôn L1, cổng `item.manage`, đơn vị quy đổi được khi ghi, rút theo mã hàng); nhập tay ở bước 4 và dán CSV tất-cả-hoặc-không ở bước 7 của `/du-lieu` (≤ 1000 dòng, 64 KiB, lỗi theo dòng); danh sách lô và hàng KHÔNG cột giá; hai dòng ADR-054; bước 14 quét hai kim riêng; **L1**, **L3** vế hai bảng, **L15** vế ghi. Chủ dự án chốt 2026-10-06: màn của người nhập không cột giá (ADR-096 ⑵ giữ nguyên), "gói" của dải lịch sử ngoài là (ngày mua, nhà cung cấp), mốc ngoài hiện là mốc mới nhất trong cửa sổ, hai PR — ADR-149 | — |
| ↳ **S4.6b** [S1.9101] | Hiện ở `/mo-thau` | Bộ đọc giá dưới `bid.view` (một dòng có lý do ở `bang-ngoai-liet-ke.test.ts`); mốc ngoài chỉ hiện độ lệch, dải lịch sử ngoài là dải thứ ba nhãn riêng, cùng phương pháp, sàn và ngưỡng của phiên bản đã ghim; **L15** vế đọc (không một phép đếm nào của cổng (e) đọc lịch sử ngoài); kịch bản 41. **[S1.9101] XONG** — `9501_ban_luu_benchmark_ngoai`, ADR-9201: chủ dự án chốt 2026-10-06 nhãn ngoài tính cùng lần tính bản lưu và LƯU ở bảng con không cột tiền, cột riêng ở bảng benchmark theo dòng (bảng xếp hạng giữ nội bộ); mốc ngoài là CỜ ở bảng, con số và độ lệch ở *Xem dải*; L1 tại mốc mở giá (ghi/rút sau mốc chỉ đếm), quy đổi tại mốc, cửa sổ theo ngày Việt Nam; bộ đọc giá `gia-ngoai.ts` là tệp duy nhất đọc `don_gia` | S4.6a |
| **S4.7** | TCO | Tập mã ghim theo gói lúc `OPEN` với `_khach` hẹp và băm riêng; số ngày giao ở `/tao-thau`; ô khai ở `/nop-thau` (375×812); kiểm lúc chấm; hai hạng; cam kết lưu cùng award; **L8** | S4.5; S3.5 (vế cam kết); S3.2 (`/tao-thau`) |
| **S4.8** | Khoá ngoại nhóm hàng | `canonical_items`… `category_id` → `procurement_categories` (qua phiên bản hàng chuẩn) | S3.6 |
| **S4b.1** | Rủi ro cao không một chạm | **L11**; mức `KHONG_XAC_DINH` từ yếu tố đã có (độ lệch benchmark, độ phủ); không chờ cổng (e) | S3.5, S4.5 |
| **S4b.0** | Cổng dữ liệu | Công cụ chỉ xuất số đếm theo từng tổ chức, chạy với đồng ý của khách; lượt soi hình dạng riêng cho §4.9 | Pilot |
| **S4b.2–4** | Risk Score, Supplier Score, phân tích người mua | Như bảng gốc; phân tích người mua chỉ sau câu trả lời pháp lý §8.7 | Cổng (e) |

Ước lượng S4a 4–6 tuần của bảng gốc không tính việc chờ S3.1, S3.2, S3.5 — nếu có trôi thì trôi lên.

**[S1.161]** Các hàng S4b của cả hai bảng trên đã trôi khỏi thiết kế chi tiết, và bảng chịu lực là spec S4b §15.1:
S4b.3 là sổ tín hiệu — không phải Supplier Score —, S4b.4 là Supplier Score, S4b.5 là phân tích người mua cùng F2a, S4b.6 màn
Executive, S4b.7 bằng chứng. S4b.1 không chỉ có *"độ lệch benchmark, độ phủ"*: nó mang F3, F5–F11 và hàng `DO_PHU`, chờ S3.5,
S3.6, S4.3, S4.5, và mang theo lớp tái lập mà bảng dưới cùng để ở sau cổng. S4b.4 và S4b.5 cũng chờ cổng (e).

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
- **[S1.159] Màn *Executive* của V2.1 §24** — màn tổng quan cho lãnh đạo (giá trị, số nhà cung cấp, Effective Cost thấp nhất,
  đề xuất, Risk Score, tuân thủ chính sách, benchmark). Bản nháp không nhắc tới nó ở đâu. Nó cần Risk Score, nên thuộc S4b và
  chờ cổng (e); S4a hiện các thành phần của nó trên `/mo-thau`.
- **[S1.159] Nhánh *"hoặc phê duyệt kép"* của V2.1 §24** — chủ dự án chọn MFA + giải trình + ghi nhận độc lập (§2.4 ⑼).
- **[S1.159] Đo lệch phân bổ giá giữa các dòng (unbalanced bid)** — góc C④ đề xuất; là một yếu tố của S4b, không phải S4a.
