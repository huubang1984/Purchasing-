# PRODUCT — TrustProcure V2

> Tài liệu sống. Bối cảnh sản phẩm cho mọi quyết định kỹ thuật.
> Nguồn: `TrustProcure_V2_Procurement_Control_Intelligence.md` (V2.1)

---

## 1. Định vị

> TrustProcure là lớp kiểm soát và trí tuệ mua sắm số giúp doanh nghiệp niêm phong báo
> giá trước thời điểm mở thầu, đánh giá tính cạnh tranh của giá, kiểm soát chính sách mua
> sắm và phát hiện các dấu hiệu bất thường trong quan hệ Buyer–Supplier.

Không phải phần mềm "3 báo giá điện tử". Không phải hệ thống "AI chống gian lận". Là
**lớp kiểm soát và trí tuệ mua sắm nằm trên ERP**.

## 2. Ba USP

1. **Blind Procurement** — người mua không nhìn thấy giá trước deadline.
2. **Procurement Intelligence** — biết giá nào bất thường và nhà cung cấp nào thực sự tối ưu.
3. **Procurement Governance** — kiểm soát giao dịch theo chính sách và tạo bằng chứng kiểm toán.

## 3. Phạm vi nghiệp vụ

TrustProcure quản **Source-to-Quote**:

```text
Demand → PR → Sourcing Strategy → Supplier Qualification → RFQ → Blind Bid
→ Technical Evaluation → Commercial Unseal → Bid Evaluation → Risk Analysis
→ Award Recommendation → Approval → ERP PO
```

ERP tiếp tục quản **Purchase-to-Pay** (PO → GRN → Invoice → Payment). TrustProcure không
cố thay thế ERP ở giai đoạn này.

## 4. Nguyên tắc thiết kế bất khả xâm phạm

| # | Nguyên tắc | Hệ quả kỹ thuật |
|---|---|---|
| 1 | **Separation of Duties** | Không cá nhân nào kiểm soát trọn chuỗi tạo RFQ → chọn NCC → mở thầu → award → duyệt |
| 2 | **Blind by Default** | Giá niêm phong mặc định, không phải tùy chọn bật thêm |
| 3 | **Open ≠ Award** | Mở thầu chỉ giải mã dữ liệu, không đồng nghĩa phê duyệt |
| 4 | **Lowest Price ≠ Best Supplier** | Xếp hạng theo Effective Cost, không theo Unit Price |
| 5 | **Risk Signal ≠ Fraud Verdict** | IP/thiết bị/metadata trùng chỉ là tín hiệu, không phải kết luận |
| 6 | **Data Quality Before AI** | Chuẩn hóa dữ liệu trước, phân tích sau. AI không bù được master data bẩn |

## 5. Những điều KHÔNG được tuyên bố

Ràng buộc này áp cho cả marketing lẫn giao diện sản phẩm. Vi phạm là lỗi sản phẩm, không
phải chuyện câu chữ.

| Không nói | Nói thay bằng |
|---|---|
| "Triệt tiêu hoàn toàn gian lận" | "Giảm khả năng can thiệp vào báo giá" |
| "IP trùng = thông đồng" | "Phát hiện dấu hiệu bất thường" |
| "Giá thấp nhất = nhà cung cấp tốt nhất" | "Hỗ trợ quyết định dựa trên tổng chi phí" |
| "AI phát hiện gian lận" | "Tạo bằng chứng kiểm toán" |
| **"Kể cả chúng tôi cũng không xem được"** | **"Mọi lần truy cập đều để lại dấu vết bất biến"** |
| ~~**[S1.108] "Vòng BAFO giữ kín giá của bạn với người mua"**~~ **[S1.109] "Vòng BAFO giữ kín giá của bạn với người mua"** | **"Giá vòng BAFO được niêm phong lại và chỉ mở qua cổng bốn vế; danh sách mời suy từ thứ hạng nên một lần mời ngoài top-N để lại dấu"** — [S1.109] nay ĐO được: một vòng quét mọi route với người mua ĐỦ QUYỀN không thấy một chữ số giá BAFO nào trước cổng, và thấy ngay sau |
| **[S1.110] "Hai người ký thì không ai trao thầu cho người quen được"** | **"Hệ thống cưỡng chế rằng người ĐỀ XUẤT trao thầu không phải người TẠO gói thầu, không phải người ĐIỀU PHỐI mở thầu (của lần điều phối đang chạy), và không phải người DUYỆT — bốn vai, ba trigger đọc dữ liệu thật, và mỗi lần từ chối để lại một dòng"** — và phần phải nói ra: vế *điều phối* KHÔNG thấy người điều phối lần ĐẦU sau một lần điều phối lại (khoản 233), nên câu đúng là *ba trong bốn mắt xích được cưỡng chế theo hành vi, mắt thứ tư chỉ theo lần gần nhất*. Và không lớp nào của sản phẩm chặn được hai người bàn nhau ngoài hệ thống — thứ nó làm là để lại dấu vết cho một lượt kiểm toán SAU đó |
| **[S1.111] "Chống được thông đồng giữa người mua và nhà cung cấp"** | **"Làm việc móc nối đắt hơn và để lại dấu đọc được"** |

Dòng *"Kể cả chúng tôi cũng không xem được"* là ràng buộc bổ sung phát sinh từ ADR-002:
mô hình đe dọa đã chọn là tầng 1+2, nhà vận hành nền tảng vẫn có khả năng kỹ thuật để giải mã.
Tuyên bố zero-knowledge sẽ là tuyên bố sai sự thật. ~~Dòng cuối~~ — con trỏ ấy THIU từ S1.108,
khi hàng BAFO thành hàng đầu tiên nằm DƯỚI nó; S1.109 và S1.110 nới thêm hai hàng nữa, nên
*"dòng cuối"* trỏ vào một hàng nói về chuyện khác hẳn. Gọi TÊN hàng thì con trỏ không thiu được.

**[2026-09-21 / ADR-058] Dòng cuối chặn một tuyên bố mà chính tên sản phẩm mời gọi.** Lõi niêm phong bảo vệ *thông tin giá trước deadline*. Nó không chạm được trường hợp một người của bên mua móc nối với **cả** pool nhà cung cấp — lần nào cũng mời đúng ba tên ấy, hoặc sắp xếp để các bên lần lượt thắng — vì ở đó giá đã thống nhất xong trước khi chạm hệ thống và không ai cần đọc phong bì của ai. Ba số đo trong ADR-058: D3 chỉ nổ khi một vai giữ **cả năm** mắt xích nên `rfq.create` + `rfq.invite` nằm chung một vai là hợp lệ; cạnh `DRAFT → PENDING_APPROVAL` **không đếm lời mời** dù spec khai là có; và mọi bất biến đóng khung trong một `rfq_id` trong khi loại gian lận này chỉ lộ ra trên chuỗi nhiều gói thầu. Biện pháp — ngưỡng số nhà cung cấp tối thiểu, buộc mời NCC mới theo chu kỳ, chữ ký thứ hai cho danh sách mời — thuộc S3, và không biện pháp nào trong đó *phát hiện* được thông đồng.

**[S1.108 / S2.5 / ADR-055]** Dòng BAFO là ràng buộc phát sinh từ spec S2 §8.1, và nó là
chỗ rò lớn nhất của S2 — **rò NGHIỆP VỤ, không phải rò kỹ thuật**. Tới lúc mời BAFO, người
mua **đã biết giá vòng một của mọi người**; một câu *"anh đang đứng thứ hai, hạ 3% là
thắng"* nói bằng miệng thì không lớp mật mã nào của sản phẩm chặn được, vì thông tin đã nằm
trong đầu một con người hợp lệ. Ba thứ sản phẩm LÀM ĐƯỢC, và chỉ ba: ⑴ danh sách mời SUY từ
`rank` chứ không do người mua gõ tay, nên một lần mời ngoài top-N là một lần lệch đọc được
(cưỡng chế ở tầng CSDL từ `059`, không phải một truy vấn hiển thị); ⑵ mọi lần đọc bảng so
sánh sau mở thầu đều có hàng sổ; ⑶ giá vòng hai niêm phong LẠI, nên người mua không thấy
vòng hai trước khi nó được mở qua đúng cổng bốn vế.

## 6. Quyết định phạm vi MVP1

**Đã chốt 2026-08-27: giữ trọn phạm vi MVP1, chấp nhận 9–11 tuần.**

Đặc tả mục 31 đặt MVP1 là 6–8 tuần. Phân rã kỹ thuật cho thấy con số thực tế là 9–11 tuần
vì ước lượng gốc chưa tính chi phí của những thứ vô hình nhưng là toàn bộ giá trị sản
phẩm: chuỗi kiểm toán chống giả mạo, vòng đời khóa, phê duyệt kép, cô lập tổ chức, và bộ
test đối kháng.

Ba lát cắt thuộc MVP1: **S0** (nền móng, 2,5 tuần) + **S1** (sealed bid core, 4 tuần) +
**S2** (evaluation, BAFO, award, 3–4 tuần).

## 7. Phân rã toàn sản phẩm

| Mã | Sub-project | Giai đoạn | Trạng thái |
|---|---|---|---|
| S0 | Foundation & Control Plane | MVP1 | Đã có spec |
| S1 | Sealed Bid Core | MVP1 | Đã có spec |
| S2 | Evaluation & Award (gồm BAFO) | MVP1 | ~~Chưa có spec~~ **[S1.103] Đã có spec** (vào kho ở S1.101) |
| S3 | Governance | MVP2 | Chưa có spec |
| S4 | Data Foundation & Intelligence | MVP3 | Chưa có spec |
| S5 | ERP Integration & Enterprise | Enterprise | Chưa có spec |

## 8. Ràng buộc sản phẩm

| # | Ràng buộc | Nguồn |
|---|---|---|
| 1 | **Friction thấp cho nhà cung cấp là điều kiện sống còn.** Lần báo giá đầu không yêu cầu tài khoản đầy đủ (Level 0 — Guest Bidder) | Mục 10 |
| 2 | Onboarding lũy tiến: Level 0 → Level 1 (Known Supplier) → Level 2 (Supplier Passport). Level 2 chỉ kích hoạt khi thắng thầu, tham gia lặp lại, ký hợp đồng, hoặc yêu cầu KYC | Mục 10 |
| 3 | Magic link không bao giờ là URL công khai không giới hạn. Luôn cần token entropy cao + hết hạn + OTP | Mục 10 |
| 4 | **Nhà cung cấp phải dùng trình duyệt có `crypto.subtle`.** Rủi ro thực tế: webview Zalo/Messenger. Phải dò tìm khả năng và hướng dẫn rõ ràng | ADR-007 |
| 5 | Mọi ngưỡng chính sách (số NCC theo giá trị, ngưỡng phê duyệt kép, trọng số chấm điểm) phải cấu hình được theo từng doanh nghiệp. Không hard-code "3 báo giá" | Mục 12, 13, 21 |
| 6 | BAFO là tùy chọn theo chính sách, không bắt buộc mọi RFQ | Mục 9 |

## 9. Chỉ số

**North Star Metric: Verified Competitive Spend** — giá trị mua sắm đã đi qua một quy
trình cạnh tranh, có audit trail và risk assessment. Tốt hơn hẳn việc chỉ đếm số RFQ.

Chữ *Verified* được hiện thực hóa bằng `evidence/INV-matrix.md` (xem `docs/TEST-PLAN.md`).

Nhóm chỉ số khác: tiết kiệm chi phí, thời gian chu trình RFQ, tỷ lệ phản hồi của nhà cung
cấp, tỷ lệ tuân thủ chính sách, tỷ lệ single-source, số RFQ rủi ro cao phát hiện được, số
người mua và nhà cung cấp hoạt động.

## 10. Khách hàng mục tiêu

Ưu tiên: Manufacturing → FDI → Construction → chuỗi Retail/F&B.

Pilot tốt nhất là doanh nghiệp có: khối lượng mua sắm lớn, nhiều nhà cung cấp, đang dùng
Excel/email, đã có ERP nhưng chưa số hóa sourcing, có vấn đề kiểm soát giá, và có nhu cầu
kiểm toán.

**Chưa có khách hàng pilot.** Đây là rủi ro lớn nhất của dự án — lớn hơn mọi rủi ro kỹ
thuật. Nên tiếp cận song song ngay từ S0, không đợi có sản phẩm.

---

## 11. Định nghĩa hoàn thành MVP1 — bằng hành vi, không bằng số đếm

> **[2026-09-19] Mục này ra đời vì dự án đi 24 ngày mà không có một câu nào nói KHI NÀO thì xong.**
> Điều kiện hoàn thành của S0 và của S1 đều phát biểu bằng số đếm của chính dự án: độ phủ bất
> biến, số khoản nợ, số lượt soi. Không con số nào trong đó nói một người mua thật đã làm được
> gì. Hệ quả đo được: sáu điều kiện đầu của S1 đạt từ 2026-09-05, và 78 vòng tiếp theo vẫn chạy
> vì không có mốc nào để dừng. Xem ADR-043.

**MVP1 xong khi câu dưới đây chạy được một lần, đầu tới cuối, trên hạ tầng thật, không một bước
nào cần người của dự án can thiệp bằng tay:**

> Một người mua của một doanh nghiệp thật tạo một RFQ có ít nhất ba hạng mục và mời ba nhà cung
> cấp thật. Ba nhà cung cấp mở link mời **trên điện thoại của họ**, nộp báo giá niêm phong, và
> nhận biên nhận kiểm chứng được. Quá hạn nộp, hai người của bên mua phê duyệt mở thầu. Bảng so
> sánh hiện ra với giá đúng tới từng chữ số. Người mua chọn nhà cung cấp và xuất được bộ bằng
> chứng kiểm toán của trọn chuỗi ấy.

Câu ấy chạm cả ba USP ở §2, và nó **chưa chạy được** vì bốn mảnh dưới đây — đo trên `master`
`1a1a060` ngày 2026-09-19:

| # | Mảnh còn thiếu | Đo được |
|---|---|---|
| 1 | ~~**Giao diện** — nhà cung cấp không có chỗ nào để nộp thầu~~ ~~**[S1.97] LỜI KHAI NÀY ĐÃ SAI. Mảnh 1 nay là:** *người mua không có chỗ nào để TẠO gói thầu và MỜI nhà cung cấp; và không có chỗ nào để xuất bộ bằng chứng*~~ ~~**[S1.98] Mảnh 1 nay còn ĐÚNG MỘT lỗ:** *không có chỗ nào để xuất bộ bằng chứng* — `/tao-thau` đã làm trọn nửa kia~~ **[S1.117] MẢNH 1 XONG.** Bước 8 của `/mo-thau` tải hai tệp của bộ bằng chứng đánh giá (S2.7) qua `GET /rfqs/:rfqId/evidence-bundle`, cổng `audit.read` + `bid.view`. Đo: kịch bản 41 qua HTTP bước 12j — hai tệp tải qua HTTP đi qua `pnpm bang-chung kiem` chạy KHÔNG có `DATABASE_URL` (`ok=true`), và bằng từng byte với CLI trừ dòng `xuatLuc`. **Giới hạn nói thẳng:** mốc neo của sổ kiểm toán (`pnpm neo`) vẫn chỉ có CLI — khoá ký bị `g11-` giữ trong `tools/neo-so-kiem-toan`, và đưa nó ra HTTP là một quyết định riêng, chưa trình | **[S1.97 — ĐI THỬ TRÊN TRÌNH DUYỆT THẬT, khung 375×812]** `apps/web/trang/nop-thau.html` và `mo-thau.html` có thật, và bảy bước của kịch bản đi được năm bước rưỡi: nhà cung cấp mở link, OTP qua kênh KHÁC, nộp báo giá niêm phong trong trình duyệt, nhận biên nhận ký ECDSA P-256 — chạy; đóng thầu, xin mở, HAI người duyệt, điều phối, bảng so sánh đúng tới từng chữ số — chạy; xuất bằng chứng `ok=true checked=27` — chạy nhưng bằng CLI. Hai bước KHÔNG có giao diện: tạo gói thầu và mời nhà cung cấp (bộ gieo làm qua API), và chọn nhà cung cấp (thuộc mảnh 2). ~~Số cũ giữ để đối chiếu: `git ls-files` một tệp `.html`~~ — nay **ba**, trong đó hai là trang sản phẩm |
| 2 | **S2 — Đánh giá, BAFO, Award** | ~~§7 của chính tệp này khai *Chưa có spec*, và `docs/superpowers/specs/` có đúng một tệp, cho S0+S1~~ **[S1.103] Ô NÀY THIU HAI VÒNG, và nó thiu vì chính vòng viết spec không đọc lại nó.** `specs/` nay có **hai** tệp — S1.101 đưa spec S2 vào kho — và §7 đã sửa ở cùng vòng này. **Mảnh 2 vẫn CHƯA XONG, nhưng vì một lý do khác hẳn:** có spec không phải có mã. Đo được ngày 2026-09-21: S2.1 (chính sách đánh giá) cài xong ở S1.102 bằng `056`; ~~**S2.2–S2.7 chưa có một dòng nào**, nên bước *người mua CHỌN nhà cung cấp* của kịch bản §11 vẫn không chạy.~~ **[S1.113 / lượt soi ngang 78 — góc 1] LỜI KHAI VỪA GẠCH ĐÃ SAI TỪ S1.110, và không vòng nào đọc lại nó dù BỐN vòng trong năm vòng ấy có sửa chính tệp này.** Đo lại ngày 2026-09-22: **S2.2 · S2.3 · S2.4 · S2.5 · S2.6 đều XONG** (S1.104, S1.105, S1.106, S1.108+S1.109, S1.110 — bảng hạng mục của chính spec S2 ghi *XONG* cho từng dòng), và bước *người mua CHỌN nhà cung cấp* nay **đi được bằng chuột**: `apps/web/trang/mo-thau.js` gọi `GET/POST /rfqs/:rfqId/award`, `…/award/:awardId/approve` và `…/award/cancel` ở bước 7 của màn mở thầu. ~~Phần CÒN LẠI của mảnh 2 là **S2.7** — *bộ xuất mang đủ đầu vào để tính lại* — và nó là vế cuối của điều kiện hoàn thành.~~ **[S1.114] MẢNH 2 XONG.** S2.7 cài ở `tools/bo-xuat-danh-gia` (ADR-059): `pnpm bang-chung xuat` ghi một bundle mang `components` từng hàng, bộ trọng số của ĐÚNG phiên bản chính sách đã dùng, định danh báo giá và mọi hàng trao thầu, cộng `DAC-TA.md` — một đặc tả đủ để cài lại phép tính; `pnpm bang-chung kiem` xác minh nó bằng HAI lớp và chạy được khi **đã ngắt kết nối cơ sở dữ liệu** (đo: `DATABASE_URL` xoá khỏi môi trường, `ok=true`). **Điều này KHÔNG đóng mảnh 1:** bước *xuất bộ bằng chứng* nay có một công cụ TỰ ĐỦ, nhưng nó vẫn là **CLI** — lỗ giao diện duy nhất còn lại của mảnh 1 không đổi một chữ. §S1.114 ~~Và ADR-051 ghi rằng **J3 chưa có lớp nào cưỡng chế** — lớp thật của nó nằm ở S2.6 cùng bảng `rfq_awards`~~ **[S1.113] Câu vừa gạch cũng đã thiu:** `061` giao ba trigger cưỡng chế trong đó có `award_kiem_de_xuat`, tức J3 CÓ lớp từ S1.110 — với đúng một lỗ đã đo và đã khai, khoản **233**, mà lượt soi 78 đề nghị đọc lại rổ. §S1.113 |
| 3 | **Triển khai thật** | ADR-009 chốt AWS + AWS KMS `ap-southeast-1` trên giấy; chưa có tài khoản, chưa có CMK, chưa có role — khoản nợ 15 |
| 4 | **Khách hàng pilot** | §10 ghi *Chưa có khách hàng pilot* từ 2026-08-27, và dòng ấy chưa đổi một chữ |


**[2026-09-20 / S1.97] BẢNG TRÊN ĐƯỢC ĐO LẠI SAU TÁM VÒNG KHÔNG AI ĐỤNG TỚI, VÀ HÀNG 1 SAI.**
Bảng này chốt ngày 2026-09-19 (S1.88). Từ đó tới S1.96 là tám vòng, mỗi vòng đo lại sổ nợ và không vòng nào đo lại ĐÍCH — đúng
hình dạng mà ADR-043 gọi tên: sổ nợ là một máy phát, còn kịch bản §11 thì đứng yên. Lượt đi thử S1.97 chạy trọn kịch bản trên
bản `f6865bb`, bằng trình duyệt ở khung hình điện thoại cho phần nhà cung cấp, và kết quả là:

| bước của kịch bản §11 | đo được 2026-09-20 |
|---|---|
| người mua tạo RFQ ≥3 hạng mục, mời 3 nhà cung cấp | **không có giao diện** — `pnpm gieo:demo` làm qua API |
| ba nhà cung cấp mở link **trên điện thoại**, nộp báo giá niêm phong | **chạy** — 375×812, ba bản nộp, giá niêm phong trong trình duyệt |
| nhận biên nhận kiểm chứng được | **chạy** — văn bản chính tắc ký ECDSA P-256, kiểm bằng `/.well-known/trustprocure-receipt-keys` |
| quá hạn nộp | **chạy** — đóng sớm có lý do, `OPEN` → `CLOSED` |
| hai người của bên mua phê duyệt mở thầu | **chạy** — hai người khác nhau, hai phiên, người soạn không tự duyệt được |
| bảng so sánh hiện ra với giá đúng tới từng chữ số | **chạy** — ba tổng khớp từng chữ số, 3 đọc được / 0 không đọc được |
| người mua CHỌN nhà cung cấp | **không có** — thuộc S2, và giao diện tự nói *chưa có trong lát cắt này* |
| xuất bộ bằng chứng kiểm toán của trọn chuỗi | **chạy, nhưng bằng CLI** — `pnpm neo xuat` rồi `kiem` trả `ok=true checked=27 neo=1` |

**[S1.113 / lượt soi ngang 78] Bảng ngay trên là một ẢNH CHỤP ngày 2026-09-20 và nó ở lại nguyên văn; hai hàng của nó nay đã khác, ghi ra ở đây thay vì sửa vào ảnh chụp:** hàng *người mua tạo RFQ ≥3 hạng mục, mời 3 nhà cung cấp* — **S1.98** dựng `/tao-thau`, đi trọn bằng chuột; hàng *người mua CHỌN nhà cung cấp* — **S1.110** dựng bước 7 của `/mo-thau`, và câu *“giao diện tự nói chưa có trong lát cắt này”* mà hàng ấy viện dẫn nay **không còn tồn tại** ở `apps/web/trang/` (grep toàn thư mục: 0 kết quả). Hai hàng còn *không chạy* thì vẫn đúng: **xuất bằng chứng chỉ có CLI**, và đó là lỗ duy nhất còn lại của mảnh 1. **[S1.117]** Câu vừa rồi hết đúng: bước 8 của `/mo-thau` xuất bộ bằng chứng đánh giá bằng chuột. Mốc neo sổ kiểm toán vẫn là CLI — xem hàng 1 của bảng bốn mảnh.

**Nghĩa là mảnh 1 không còn là *nhà cung cấp không nộp được*.** Nó là hai lỗ cụ thể hơn: không có màn tạo gói thầu và mời, và
không có màn xuất bằng chứng. Mảnh 2, 3, 4 không đổi một chữ — và **hai trong bốn mảnh không phải việc của mã**: mảnh 3 cần một
tài khoản hạ tầng, mảnh 4 cần một khách hàng. Không vòng vá lỗi nào chạm được hai mảnh ấy.

**Ba mảnh đầu là việc của dự án. Mảnh thứ tư thì không, và nó chặn nhiều nhất** — §10 đã gọi nó
là rủi ro lớn nhất, lớn hơn mọi rủi ro kỹ thuật, từ ngày đầu tiên.

**Điều mục này KHÔNG nói:** nó không nói phần đã xây là thừa. Lõi niêm phong ~~có 56/56 bất biến~~ ~~**[S1.115] cùng lớp đánh giá nay có 62/62 bất biến**~~ **[S1.116] 63/63**
được cưỡng chế và đo bằng đột biến; đó là thứ khó nhất của sản phẩm và nó đã xong. Mục này chỉ
nói rằng *đo bằng bất biến* và *đo bằng người mua* là hai trục khác nhau, và dự án tới hôm nay
chỉ có trục thứ nhất.
