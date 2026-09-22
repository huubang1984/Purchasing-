# TrustProcure V2 — Thiết kế S2: Đánh giá, BAFO, Award

> **Ngày:** 2026-09-21 · **Trạng thái:** **[S1.101] đã qua lượt soi hình dạng — tám phát hiện, ba CAO.**
> Hai quyết định CHẶN của chủ dự án đã chốt (§2.3, ADR-050); ba chỗ spec tự nói sai đã sửa tại chỗ; ba chỗ
> spec bỏ trống đã điền từ tiền lệ đo được. Chưa một dòng mã nào của S2 được viết.
> **Đóng mảnh nào:** mảnh 2 của `docs/PRODUCT.md` §11 — bước *"người mua chọn nhà cung cấp"*
> **Không đóng:** Risk Analysis (để S3), ERP PO, hợp đồng

---

## 1. Bối cảnh — vì sao bây giờ, và vì sao tài liệu này ngắn hơn bản S0+S1

Lượt đi thử S1.97 đo trọn kịch bản §11 trên bản đang chạy: **năm bước rưỡi trên bảy đi được**.
Hai bước không đi được là *tạo gói thầu và mời nhà cung cấp* (S1.98 đã dựng) và **bước này** —
*người mua chọn nhà cung cấp*. Chính giao diện hôm nay tự nói ra chỗ trống ấy, ở cuối bảng so
sánh:

> *"Giá thấp nhất không đồng nghĩa nhà cung cấp tốt nhất — xếp hạng theo tổng chi phí là việc của
> bước đánh giá, chưa có trong lát cắt này."*

Tài liệu này ngắn hơn bản S0+S1 vì phần lớn nền đã dựng: máy trạng thái RFQ, cổng bốn vế, sổ kiểm
toán nối chuỗi, chính sách theo tổ chức có phiên bản, phong bì niêm phong, biên nhận ký. **S2
không thêm một mảnh mật mã nào.** Nó thêm một lớp phán xét trên dữ liệu đã mở, và một vòng thầu
thứ hai dùng lại NGUYÊN bộ máy niêm phong của S1.

## 2. Những thứ đã chốt TRƯỚC khi có tài liệu này

Sáu ràng buộc dưới đây không phải lựa chọn của S2. Chúng là thứ S2 phải tuân, và mỗi dòng đều đọc
được ở một tài liệu có trước.

| # | Ràng buộc | Nguồn | Hệ quả cho S2 |
|---|---|---|---|
| 1 | **Lowest Price ≠ Best Supplier** — xếp hạng theo Effective Cost, không theo đơn giá | PRODUCT §4 ⑷ | Con số xếp hạng KHÔNG phải `totalAmount` |
| 2 | **Separation of Duties** — không ai kiểm soát trọn chuỗi tạo RFQ → chọn NCC → mở thầu → **award** → duyệt | PRODUCT §4 ⑴ | Người đề xuất award ≠ người duyệt, và cả hai phải đối chiếu được với người đã mở thầu |
| 3 | **Open ≠ Award** — mở thầu chỉ giải mã | PRODUCT §4 ⑶ | `UNSEALED` KHÔNG tự chuyển sang `AWARDED`; phải đi qua `EVALUATING` |
| 4 | Mọi ngưỡng chính sách, **kể cả trọng số chấm điểm**, cấu hình theo từng doanh nghiệp | PRODUCT §8 ⑸ | Công thức Effective Cost là DỮ LIỆU theo tổ chức, không phải hằng số trong mã |
| 5 | **BAFO là tuỳ chọn theo chính sách** | PRODUCT §8 ⑹ | Một RFQ đi thẳng từ `EVALUATING` sang `AWARDED` là đường HỢP LỆ, không phải ngoại lệ |
| 6 | Ứng dụng tính, CSDL lưu — **nhưng không lưu kết luận TRẦN** | **ADR-017** | Xem §2.1 |

### 2.1. ADR-017 là tiền lệ chịu lực nhất của tài liệu này

ADR-017 quyết định hình dạng của `requires_dual_approval`, và lý do nó quyết định như thế áp nguyên
vào S2:

> Một `boolean` trần là một phán quyết **không kiểm toán được**: kiểm toán viên hỏi *"vì sao RFQ này
> chỉ cần một phê duyệt"* và trong dữ liệu **không có câu trả lời**.

**Một bảng xếp hạng cũng là một kết luận, và nó là kết luận đắt hơn.** Câu hỏi *"vì sao nhà cung cấp
này thắng"* phải trả lời được TỪ DỮ LIỆU, không cần hỏi ai, và không cần chạy lại ứng dụng ở phiên
bản hôm đó. Nên mọi hàng xếp hạng phải mang:

- khoá ngoại tới **đúng phiên bản chính sách** đã áp (trọng số, công thức, tham số);
- **mọi đầu vào** đã đem tính, ở dạng đọc được;
- kết quả.

Đủ để một hàm thuần tính lại và ra đúng con số ấy. Bất biến **J2** ở §5 cưỡng chế điều này.

### 2.2. Bốn quyết định của chủ dự án, ngày 2026-09-21

| # | Câu hỏi | Quyết định | Hệ quả |
|---|---|---|---|
| ⑴ | Effective Cost gồm gì | **Giá cộng các khoản quy đổi được ra TIỀN** theo công thức ghi trong chính sách. Điểm phi giá ghi được nhưng đứng RIÊNG, không trộn vào con số tiền | Con số xếp hạng có đơn vị là tiền ⇒ tái lập tuyệt đối, và không điểm chấm chủ quan nào lọt vào nó |
| ⑵ | BAFO mời ai, mấy vòng | **Top-N theo chính sách, MỘT vòng**, và báo giá BAFO **cũng niêm phong** rồi mở bằng đúng cổng bốn vế | Xem rủi ro §8.1 — đây là chỗ rò lớn nhất của S2 |
| ⑶ | Award cần mấy chữ ký | **Người đề xuất + người duyệt, khác người.** Ngưỡng giá trị quyết định cần MỘT hay HAI người duyệt, lấy từ chính sách đã có | Tái dùng khuôn D2 của mở thầu, không dựng lớp mới |
| ⑷ | Phạm vi | **Đánh giá + BAFO + Award. KHÔNG Risk Analysis** | Risk Analysis để S3 Governance — xem §10 |

### 2.3. [S1.101] Năm quyết định NỮA, sau lượt soi hình dạng — và vì sao chúng phải đứng trước dòng mã đầu

Lượt soi S1.101 chạy trên chính tài liệu này, trước khi viết mã, theo lệ *"soi TRƯỚC khi viết mã"* mà S1.75 đã
lập. Nó tìm ra tám chỗ, ba CAO. Hai chỗ CAO là quyết định của chủ dự án và đã chốt ngày 2026-09-21; ba chỗ còn
lại điền được từ tiền lệ ĐO ĐƯỢC trong kho, nên vòng soi tự chốt và ghi lý do. Đầy đủ ở **ADR-050**.

| # | Chỗ | Quyết định | Ai chốt |
|---|---|---|---|
| ⑸ | **Luật thu `effective_cost` về hai chữ số** — kho có HAI quy ước lệch nhau: `so-tien.ts` `thanhTien` CẮT CỤT (`(a*b*100n)/10000n`), còn số tiền phái sinh duy nhất hôm nay dùng `pg_catalog.round(avg(…), 2)` (`comparison.ts:287`). `quantity` là `numeric(18,4)` nên tích SINH RA chữ số thứ ba | **Làm tròn nửa-ra-xa-0, một luật duy nhất, ghim ở CẢ hai tầng** bằng một phép đo đối chiếu hàm thuần với Postgres trên bảng ca nửa xu. Hàm thuần KHÔNG được cắt cụt | chủ dự án |
| ⑹ | **Hình dạng `rfq_awards` và đường huỷ** — §4.2 khai chỉ-ghi-thêm còn J7 khai UNIQUE bộ phận; hai thứ loại trừ nhau | **Giữ chỉ-ghi-thêm.** J7 giữ nguyên MỆNH ĐỀ, đổi cột cưỡng chế: một **trigger** đọc hàng trạng thái MỚI NHẤT của `(org_id, rfq_id)` — khuôn `unseal_dieu_phoi_mot_lan` | chủ dự án |
| ⑺ | **Báo giá KHÔNG đọc được giá xếp hạng thế nào** — `bid_so_tien` (020) cố ý trả NULL thay vì ném cho bốn ca (không phải số · `NaN` · `Infinity` · số âm), và `buildComparisonTable` GIỮ hàng, đếm riêng thành `unparsed`. Ca ấy SẼ xảy ra | Hàng `rfq_evaluation_lines` vẫn SINH RA, với `effective_cost IS NULL` và `rank IS NULL` — giữ hàng, không vứt, đúng tiền lệ 020. Và **J5 siết thêm một vế**: award không trỏ được tới một báo giá không có `effective_cost` | vòng soi, từ tiền lệ 020 |
| ⑻ | **Lệch tiền tệ** — `buildComparisonTable` khai: các báo giá đọc được KHÔNG cùng đơn vị tiền ⇒ `min/max/average/belowBudget` đều `null`, vì `min(1000 USD, 2000 VND)` là con số không nghĩa | Một lượt đánh giá **bị TỪ CHỐI** bằng một câu gọi tên, không sinh bảng xếp hạng nào. Mạnh hơn bảng so sánh là cố ý: bảng so sánh trả `null` được vì nó chỉ HIỂN THỊ, còn một `rank` thì không có giá trị `null` nào có nghĩa — một award dựa trên nó là một quyết định dựa trên con số không so được | vòng soi, từ tiền lệ `comparison.ts` |
| ⑼ | ~~**Mã quyền của S2 chưa tồn tại** — hôm nay đúng tám mã `rfq.*`~~ **[S1.102] SAI — ba mã ĐÃ CÓ từ `005`**: `evaluation.perform`, `award.recommend`, `po.approve`. Lượt soi grep `"rfq\.…"` rồi đọc tập rỗng thành *không tồn tại* | **S2.0 KHÔNG thêm mã nào.** Nó nối mã sẵn có vào cổng, và dựng lớp cho **J3** — vì `PROCUREMENT_MANAGER` giữ `rfq.create` + `rfq.invite` + `rfq.unseal` + `award.recommend`, tức BỐN trên năm mắt xích, nên chuỗi D3 (chỉ chặn khi ôm TRỌN năm) KHÔNG phủ bộ ba của J3. Xem **ADR-051** | vòng soi, sửa ở S1.102 |

---

## 3. Kiến trúc

### 3.1. Thứ S2 TÁI DÙNG, không dựng lại

| Đã có | S2 dùng cho |
|---|---|
| `org_procurement_policies` — theo tổ chức, có phiên bản, bất biến | Trọng số và công thức Effective Cost, số N của BAFO |
| Cổng bốn vế `assertUnsealAllowed` + `unseal_approvals` | Mở vòng BAFO, và khuôn hai chữ ký của award |
| Phong bì niêm phong + `rfq_invitation_tokens` + phiên khách | Vòng BAFO — nhà cung cấp nộp lại y như vòng một |
| `rfq_kiem_chuyen_trang_thai` (011) | Cạnh trạng thái mới, khai ở CÙNG một danh sách |
| Sổ kiểm toán nối chuỗi + `throwAuditedDenial` | Mọi lần đề xuất, duyệt, huỷ, và mọi lần từ chối |
| `buildComparisonTable` | Đầu vào của đánh giá — nó ĐÃ trả đúng tới từng chữ số |

**S2 không thêm một đường mật mã nào.** Đó là phát biểu đáng kiểm nhất của tài liệu này: nếu bản
cài đặt sinh ra một hàm băm, một khoá, hay một định dạng phong bì mới, thì thiết kế đã trượt.

### 3.2. Thứ S2 thêm

Một gói `packages/danh-gia`, và nó **thuần tính toán** ở phần lõi: hàm tính Effective Cost nhận
đầu vào và chính sách, trả ra con số cùng bảng thành phần — **không nhận `client`, không nhận
`orgId`, không chạm CSDL**. Đó là cách duy nhất để J2 (tái lập) đo được bằng một phép gọi hàm chứ
không bằng một lượt dựng cảnh.

Lớp có trạng thái (đọc báo giá, ghi kết quả, cổng quyền) nằm ở lớp ngoài, cùng khuôn mà
`packages/unseal` đang dùng.

---

## 4. Mô hình dữ liệu

### 4.1. Chính sách — mở rộng bảng đã có, KHÔNG dựng bảng chính sách thứ hai

`org_procurement_policies` nhận thêm cột cho trọng số, công thức và `bafo_top_n`.

**Vì sao mở rộng chứ không tách bảng riêng:** một người mua nghĩ về *"chính sách mua sắm phiên bản
4"* như MỘT vật. Hai bảng chính sách đánh số độc lập buộc mọi câu hỏi kiểm toán phải đối chiếu hai
dòng thời gian, và nó tạo ra một trạng thái vô nghĩa — *phiên bản ngưỡng 4 với phiên bản trọng số
7*. Cái giá phải trả, nói thẳng: các phiên bản chính sách cũ (tạo trước S2) không có những cột này.

**Cách xử lý ca ấy, và nó phải là fail-closed:** cột mới cho phép NULL, kèm một `CHECK` đòi
**tất-cả-hoặc-không-cột-nào**. Một lượt đánh giá chạy dưới phiên bản chính sách thiếu trọng số bị
từ chối bằng một câu nói rõ — *"chính sách phiên bản N chưa khai trọng số đánh giá; tạo phiên bản
mới trước khi chấm"* — chứ không âm thầm lấy một giá trị mặc định. Một mặc định ở đây là đúng thứ
ràng buộc ⑷ cấm.

### 4.2. Bảng mới

| Bảng | Giữ gì | Ghi chú thiết kế |
|---|---|---|
| `rfq_evaluations` | Một lượt đánh giá của một RFQ: FK chính sách đã áp, người tạo + phiên, thời điểm | FK hợp thành `(org_id, policy_id)` — khuôn 006 §1, chặn ca chính sách của tổ chức khác |
| `rfq_evaluation_lines` | Mỗi báo giá một hàng: `effective_cost`, `components` (jsonb, từng khoản đã quy đổi kèm đầu vào), `rank` | `numeric(18,2)`, và phép chuyển đi qua `public.bid_so_tien` (020) chứ không qua một bộ đọc thứ hai — nó đã từ chối bốn ca: không phải số · `NaN` (mà `numeric` NHẬN, và `'NaN' > 0` là TRUE) · `Infinity` · số âm. **[S1.101 / §2.3⑺]** Báo giá không đọc được giá vẫn có hàng, với `effective_cost IS NULL` và `rank IS NULL` |
| `rfq_bafo_rounds` | Vòng BAFO: FK chính sách, **[S1.101] FK hợp thành tới `rfq_evaluations`**, `top_n` đã áp, hạn nộp, người mở + phiên | Danh sách ai được mời suy từ `rfq_evaluation_lines.rank ≤ top_n` của **đúng lượt đánh giá được trỏ tới**, KHÔNG chép lại. **FK ấy là bắt buộc, không trang trí:** `BAFO_CLOSED->EVALUATING` sinh một `rfq_evaluations` THỨ HAI, nên không có nó thì *"ai đủ điều kiện vào BAFO"* chỉ trả lời được bằng một phép suy theo `seq` — đúng hình dạng khoản 208 |
| `rfq_awards` | Đề xuất trao thầu: bid được chọn, lý do (bắt buộc), người đề xuất + phiên, trạng thái | Chỉ-ghi-thêm; huỷ là một hàng trạng thái mới, không phải `UPDATE` — **[S1.101 / §2.3⑹]** nên J7 cưỡng chế bằng TRIGGER đọc hàng mới nhất, không bằng chỉ mục UNIQUE bộ phận: hàng `PROPOSED` cũ vẫn khớp mọi vị từ bộ phận sau khi đã huỷ |
| `rfq_award_approvals` | Chữ ký duyệt: người duyệt + phiên | Khuôn `unseal_approvals`: UNIQUE một người một lần, một phiên một lần |

### 4.3. Máy trạng thái — ~~NĂM~~ **[S1.108] BẢY** cạnh mới

Danh sách `CANH_HOP_LE` ở `rfq_kiem_chuyen_trang_thai` (~~011~~ **[S1.108] 059**) nhận thêm:

```
EVALUATING->BAFO_OPEN        BAFO_OPEN->BAFO_CLOSED
BAFO_CLOSED->BAFO_UNSEALED   BAFO_UNSEALED->EVALUATING
BAFO_OPEN->CANCELLED         EVALUATING->AWARDED
EVALUATING->CANCELLED
```

*(**[S1.101]** Bản đầu của mục này khai "bốn cạnh" trong khi khối ngay trên liệt kê NĂM — cùng họ khoản 212,
ở dòng đầu của chính tài liệu này. Đã sửa.)*

*(**[S1.108 / S2.5 / ADR-055]** Khối trên vừa đổi HAI chỗ, và cả hai đến từ một lượt soi hình dạng
chạy TRƯỚC dòng mã đầu — không từ một lần đọc lại tài liệu.*

*⒜ **`BAFO_CLOSED->EVALUATING` BỊ THAY** bằng hai cạnh đi qua một trạng thái MỚI, `BAFO_UNSEALED`.
Lý do là một phép đo: cạnh `CLOSED->UNSEALED` tồn tại không phải để đẹp máy trạng thái —
`rfq_kiem_yeu_cau_mo_thau` (`019 §4`) cắm vào đúng cạnh ấy và đòi một yêu cầu mở thầu ĐÃ PHÊ
DUYỆT. Nối thẳng `BAFO_CLOSED->EVALUATING` cho một lượt chấm LẠI chạy trong khi phong bì vòng hai
còn nguyên niêm, và bảng xếp hạng khi ấy vẫn là bảng của vòng MỘT mà không lớp nào kêu. Bộ ba
`BAFO_OPEN·BAFO_CLOSED·BAFO_UNSEALED` là ẢNH của `OPEN·CLOSED·UNSEALED`, nên nó dùng lại nguyên cả
lớp canh thay vì dựng khuôn thứ hai.*

*⒝ **`BAFO_OPEN->CANCELLED` được thêm**, và nó suy ra từ chính phép ảnh ấy: `OPEN->CANCELLED` CÓ
trong bảng cạnh nên ảnh của nó cũng có. Hai cạnh KHÔNG thêm — `BAFO_CLOSED->CANCELLED` và
`BAFO_UNSEALED->CANCELLED` — là ảnh của hai cạnh mà khoản nợ **225** đang giữ câu hỏi mở, và `059`
cố ý im lặng ở cùng chỗ để ngày nào khoản ấy được quyết thì HAI cặp cùng đổi chứ không một.)*

*(**[S1.108]** `EVALUATING->AWARDED` vẫn CHƯA có: `AWARDED` chưa phải một giá trị nào trong tập
đóng của `009`, và `059` cố ý không thêm nó. S2.6.)*

`UNSEALED->EVALUATING` **đã có từ 011 và chưa ai đi qua** — đo được ở `011:147`, trong chính mảng `CANH_HOP_LE`.
S2 là thứ làm nó sống. Không có cạnh
nào từ `UNSEALED` hay `CLOSED` thẳng tới `AWARDED`: đó là cưỡng chế của nguyên tắc ⑶ *Open ≠ Award*
ở tầng CSDL, không phải một lời hứa của ứng dụng.

~~`BAFO_CLOSED->EVALUATING` là cạnh quay lại~~ **[S1.108] `BAFO_UNSEALED->EVALUATING` là cạnh quay
lại**: sau khi mở vòng hai — *và sau khi phong bì của nó đã đi qua cổng bốn vế* — bảng xếp hạng
được tính LẠI trên báo giá mới. Một `rfq_evaluations` thứ hai ra đời; hàng cũ ở lại nguyên vẹn, vì
*"vì sao xếp hạng đổi"* là một câu hỏi kiểm toán thật. Đo ở `059`: `rfq_evaluations` KHÔNG có
`UNIQUE` trên `rfq_id` nên lượt thứ hai không cần một migration nào, và `TRANG_THAI_CHAM_DUOC` của
`packages/danh-gia` thôi là một hằng CHUỖI để thành một tập hai phần tử.

**Hardening:** mọi cạnh mới phải được ghim ở `db/migrations/hardening.always.sql` trong CÙNG commit
với migration — S1.96 đo được rằng migration một mình là no-op, vì lượt hardening ngay sau đó trả
định nghĩa về bản cũ.

---

## 5. Bất biến nghiệp vụ mới — nhóm J

Bảy bất biến. Mỗi cái phải có một phép đo THẬT và một đột biến giết được nó, theo đúng
`docs/TEST-PLAN.md`.

| Mã | Mệnh đề | Cưỡng chế ở đâu |
|---|---|---|
| **J1** | Con số xếp hạng chỉ gồm các khoản có đơn vị TIỀN. Một điểm phi giá không bao giờ đi vào `effective_cost` | Hàm thuần + **[S1.101]** một `CHECK` cho vế CẤU TRÚC (mọi phần tử của `components` mang một trường tiền) **cộng một trigger** cho vế nội dung: một `CHECK` KHÔNG tham chiếu được `org_procurement_policies` nên nó không thể biết chính sách khai thành phần nào có đơn vị tiền — bản đầu khai một cơ chế rộng hơn thứ `CHECK` làm được |
| **J2** | Mỗi hàng xếp hạng **tái lập được**: tính lại từ `components` + phiên bản chính sách ra ĐÚNG `effective_cost` đã lưu | Test gọi thẳng hàm thuần trên dữ liệu đọc từ CSDL, **[S1.101]** cộng một bảng ca NỬA XU đối chiếu hàm thuần với `pg_catalog.round(x, 2)` của Postgres — J2 không thoả được nếu luật làm tròn không được ghim ở CẢ hai tầng (§2.3⑸) |
| **J3** | Người đề xuất award ≠ mọi người duyệt award; và bộ ba *tạo RFQ · điều phối mở thầu · đề xuất award* không được là cùng một người | Trigger, khuôn `unseal_approvals` |
| **J4** | Báo giá BAFO niêm phong đúng như vòng một: không route nào trả một mức giá BAFO trước khi vòng ấy được mở qua cổng bốn vế | Vòng quét mọi route, khuôn A2 |
| **J5** | Award chỉ trỏ tới một báo giá CÒN HỢP LỆ của chính RFQ ấy, **[S1.101]** và báo giá ấy phải có `effective_cost` đọc được — một báo giá mà `bid_so_tien` trả NULL không trao thầu được | FK hợp thành + trigger |
| **J6** | Mọi lần đề xuất, duyệt, huỷ award, và mọi lần từ chối của cổng đánh giá, đều để lại một hàng sổ | Khuôn D5 |
| **J7** | Một RFQ có **tối đa một** award còn sống | **[S1.101 / §2.3⑹]** Trigger đọc hàng trạng thái MỚI NHẤT của `(org_id, rfq_id)` — khuôn `unseal_dieu_phoi_mot_lan`. KHÔNG phải chỉ mục UNIQUE bộ phận: trên một bảng chỉ-ghi-thêm, hàng `PROPOSED` cũ vẫn khớp vị từ sau khi đã huỷ |

**J2 là bất biến trung tâm của S2**, và nó là thứ biến *"chúng tôi có audit trail"* từ một câu
marketing thành một phép đo: kiểm toán viên cầm dữ liệu, chạy hàm, ra đúng con số.

---

## 6. Kiến trúc kiểm thử

Không có khuôn mới. Ba tầng đã có ở `docs/TEST-PLAN.md` phủ đủ:

- **T1/T2** — hàm thuần tính Effective Cost: bảng ca, kể cả `NaN`, `Infinity`, số âm, tiền tệ lệch,
  và ca *thiếu một thành phần đã khai trong chính sách*.
- **T3** — trạng thái, trigger, cổng quyền, sổ kiểm toán, và vòng BAFO đi trọn trên Postgres thật.
- **Đột biến** — mỗi J một con, và ít nhất một con phải **đi qua lớp CSDL** (tắt trigger lúc chạy,
  khuôn `db/hardening-suy-tu-tinh-chat.int.test.ts`).

Một phép đo phải có mà dễ quên: **đối chứng dương cho J4**. Vòng quét route chứng minh *không thấy
giá BAFO*; nó chỉ có nghĩa khi có một lượt chứng minh bộ quét THẤY giá ấy sau khi vòng BAFO mở.

---

## 7. Điều kiện hoàn thành

S2 xong khi câu dưới chạy được một lần, đầu tới cuối, **trên giao diện**, không bước nào cần người
của dự án gõ lệnh:

> Sau khi mở thầu, người mua chấm bảng xếp hạng theo Effective Cost của chính sách tổ chức mình;
> nếu chính sách bật BAFO thì top-N được mời nộp lại **niêm phong**, mở bằng đúng cổng bốn vế, và
> bảng xếp hạng tính lại; rồi một người ĐỀ XUẤT trao thầu kèm lý do, một người KHÁC phê duyệt, và
> bộ bằng chứng kiểm toán xuất ra **tái lập được con số đã quyết định**.

Vế cuối là điều kiện nghiệm thu thật: không phải *"có bảng xếp hạng"* mà *"xếp hạng ấy tính lại
được từ dữ liệu"*.

---

## 8. Rủi ro

### 8.1. BAFO là chỗ rò lớn nhất của S2 — và nó là rò NGHIỆP VỤ, không phải rò kỹ thuật

Tới lúc mời BAFO, người mua **đã biết giá vòng một của mọi người**. Nếu họ nói riêng với một nhà
cung cấp *"anh đang đứng thứ hai, hạ 3% là thắng"* thì không một lớp mật mã nào của sản phẩm chặn
được — thông tin đã nằm trong đầu một con người hợp lệ.

Thứ S2 làm được, và phải làm: ⑴ danh sách mời BAFO **suy từ `rank`**, không do người mua gõ tay, nên
một lần mời ngoài top-N là một lần lệch đọc được; ⑵ mọi lần đọc bảng so sánh sau mở thầu đã có sổ;
⑶ giá BAFO niêm phong lại, nên người mua không thấy vòng hai trước khi mở.

Thứ nó KHÔNG làm được phải ghi vào `docs/PRODUCT.md` §5 *"Những điều KHÔNG được tuyên bố"*: sản
phẩm **không** chặn được một người mua rò tin bằng miệng.

### 8.2. Công thức Effective Cost phình ra

Quy đổi *thời gian giao hàng* và *điều khoản thanh toán* ra tiền cần tham số (chi phí vốn, chi phí
chờ) mà một doanh nghiệp vừa có thể không biết. Rủi ro là spec đòi mười tham số và pilot khai đại
cho xong — lúc ấy con số xếp hạng trông chính xác mà đầu vào là số bịa.

Giảm bằng: **mặc định là chỉ giá**, mọi thành phần khác TẮT cho tới khi tổ chức bật tường minh; và
bảng xếp hạng luôn hiện thành phần, để người đọc thấy con số nào đến từ đâu.

### 8.3. Huỷ award — **[S1.101] ĐÃ CHỐT**, và nó là một trong ba CAO của lượt soi

Bản đầu ghi *"chưa thiết kế... phải chốt trước khi viết migration"*. Lượt soi S1.101 đo được rằng nó KHÔNG
phải một rủi ro riêng: nó là **cùng một lỗ** với J7, vì §4.2 khai chỉ-ghi-thêm còn J7 khai chỉ mục UNIQUE bộ
phận, và hai thứ ấy loại trừ nhau. Một UNIQUE bộ phận không diễn đạt được *"tối đa một còn sống"* trên bảng
chỉ-ghi-thêm: khi huỷ sinh một hàng MỚI, hàng `PROPOSED` cũ vẫn khớp vị từ.

Chủ dự án chọn **giữ chỉ-ghi-thêm** (§2.3⑹): huỷ là một hàng trạng thái mới, lịch sử ở lại nguyên vẹn, và câu
*ai huỷ, lúc nào, vì sao* trả lời được từ chính bảng. Cái giá: J7 cưỡng chế bằng một **trigger** đọc hàng mới
nhất — đắt hơn một chỉ mục, và phải có đột biến riêng vì một trigger sai có thể cho hai award cùng sống.

Thứ vẫn CHƯA chốt, và nó hẹp hơn hẳn: cạnh trạng thái của RFQ khi award bị huỷ (`AWARDED` quay lại
`EVALUATING`, hay đứng yên). Phải chốt trước **S2.6**, không phải trước migration đầu.

### 8.4. Ba khoản rổ A còn mở chạm S2

`102` (backfill bị RLS lọc), `105` (`CHECK` gỡ sau deploy), `109` (`search_path` độc) đều là rủi ro
tầng CSDL, và S2 thêm năm bảng vào đúng tầng ấy. Không khoản nào chặn việc viết spec, nhưng cả ba
phải đóng trước khi S2 chạy trên hạ tầng thật.

---

## 9. Phân rã công việc — ước lượng 3–4 tuần, theo `docs/PRODUCT.md` §6

| # | Hạng mục | Ra cái gì |
|---|---|---|
| **S2.0** | **[S1.101] Mã quyền** | Mã `rfq.evaluate` / `rfq.award.propose` / `rfq.award.approve` vào ma trận quyền, và chốt vai nào giữ mỗi mã. Hôm nay có đúng TÁM mã `rfq.*` và không mã nào cho S2; `[INV-D3]` đã có cổng cho ma trận nên việc này có phép đo sẵn. Đứng TRƯỚC S2.3 vì cổng quyền của S2.3 gọi chúng |
| S2.1 | Chính sách đánh giá | Cột mới + `CHECK` tất-cả-hoặc-không, migration + ghim hardening, ca fail-closed cho phiên bản cũ |
| S2.2 | Hàm thuần Effective Cost | `packages/danh-gia`, bảng ca T1 **kèm bảng ca NỬA XU đối chiếu với `round(x,2)` của Postgres** (§2.3⑸), **J1 + J2** |
| S2.3 | Lượt đánh giá | `rfq_evaluations` + `_lines`, cổng quyền, `UNSEALED->EVALUATING` sống, **J6** |
| S2.4 | Bảng xếp hạng trên giao diện | Màn chấm: thành phần hiện ra, không chỉ con số |
| S2.5 | BAFO | Cạnh trạng thái, vòng mời suy từ `rank`, nộp niêm phong, mở qua cổng bốn vế, **J4**. **[S1.108] CHIA HAI VÒNG theo quyết định của chủ dự án ngày 2026-09-22:** S1.108 làm tầng CSDL và máy trạng thái (`059`, `rfq_bafo_rounds`, C1/C3 học BAFO, mã quyền `rfq.bafo.open`, top-N suy từ `rank`); **S1.109** làm route, worker, màn hình và **J4** — vì J4 là một vòng quét ROUTE và quét khi chưa route nào tồn tại cho ra một cổng XANH trên tập RỖNG. Khoản **227** ghi ranh giới ấy |
| S2.6 | Award | `rfq_awards` + `_approvals`, hai chữ ký khác người, **J3 + J5 + J7** |
| S2.7 | Bằng chứng tái lập | Bộ xuất mang đủ đầu vào để tính lại; đây là vế cuối của điều kiện hoàn thành |

Mỗi hạng mục đi theo đúng vòng lặp bắt buộc ở spec S0+S1 §9: đo trước khi viết, một bất biến một
phép đo, đột biến, rồi tài liệu.

---

## 10. Ngoài phạm vi tài liệu này

- **Risk Analysis** — tín hiệu IP/thiết bị/metadata. Nguyên tắc ⑸ *Risk Signal ≠ Fraud Verdict* đòi
  một lớp trình bày riêng để một tín hiệu không bị đọc thành một kết luận, và trộn nó vào đây làm
  S2 phình gấp đôi. Để S3 Governance.
- **ERP PO, hợp đồng, thanh toán** — `docs/PRODUCT.md` §3 nói rõ TrustProcure dừng ở Source-to-Quote.
- **Chấm điểm kỹ thuật nhiều vòng, hội đồng chấm** — ghi được điểm phi giá là đủ cho MVP1; quy trình
  hội đồng là chuyện của S3.
- **Cạnh trạng thái khi huỷ award** — hình dạng bảng đã chốt ở §2.3⑹; chỉ còn cạnh của máy trạng thái RFQ. Xem §8.3. Phải chốt trước S2.6.
