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
| **[S1.110] "Hai người ký thì không ai trao thầu cho người quen được"** | **"Hệ thống cưỡng chế rằng người ĐỀ XUẤT trao thầu không phải người TẠO gói thầu, không phải người ĐIỀU PHỐI mở thầu ~~(của lần điều phối đang chạy)~~ **[S1.129, ghi muộn ngày 2026-09-27]** (bất kỳ ai TỪNG điều phối mở gói ấy — `064`), và không phải người DUYỆT — bốn vai, ba trigger đọc dữ liệu thật, ~~và mỗi lần từ chối để lại một dòng~~ **[S1.163]** và lần từ chối vì QUYỀN để lại một hàng sổ (đo ở pilot giả lập), lần từ chối vì TRẠNG THÁI cũng vậy (ADR-060) — ~~còn lần từ chối của CHÍNH J3 thì KHÔNG, vì trigger huỷ giao dịch (đo ở pilot giả lập trên cả ba vế: người tạo tự đề xuất, người điều phối tự đề xuất, người đề xuất giữ quyền duyệt tự duyệt — khoản 247)~~ **[S1.167 / ADR-104]** và lần từ chối của CHÍNH J3 cũng vậy — lớp gói bắt lỗi của trigger rồi ghi ~~`RFQ_AWARD_SOD_DENIED`~~ **[S1.180 / ADR-108]** `CONTROL_DENIED` mang mã chốt ở giao dịch độc lập (khoản 247 đóng)"** — và phần phải nói ra: ~~vế *điều phối* KHÔNG thấy người điều phối lần ĐẦU sau một lần điều phối lại (khoản 233), nên câu đúng là *ba trong bốn mắt xích được cưỡng chế theo hành vi, mắt thứ tư chỉ theo lần gần nhất*.~~ **[S1.129, ghi muộn ngày 2026-09-27]** khoản 233 ĐÓNG: `064` ghi mọi lần cặp người–phiên điều phối đổi vào `unseal_dispatch_history`, và vế *điều phối* của J3 hỏi *người này đã TỪNG điều phối gói này chưa* — đo: A điều phối, B điều phối lại, A đề xuất ⇒ từ chối. Cả bốn mắt xích nay cưỡng chế theo hành vi. Giới hạn còn lại chỉ ở dữ liệu cũ: một lần điều phối lại trước S1.103 không để lại người điều phối cũ ở đâu cả. Và không lớp nào của sản phẩm chặn được hai người bàn nhau ngoài hệ thống — thứ nó làm là để lại dấu vết cho một lượt kiểm toán SAU đó |
| **[S1.111] "Chống được thông đồng giữa người mua và nhà cung cấp"** | **"Làm việc móc nối đắt hơn và để lại dấu đọc được"** |
| **[S1.234] "Chuẩn hoá dữ liệu chống thao túng giá"** | **"Ánh xạ tự động chỉ khi mô tả trùng một bí danh đã khai; mọi ánh xạ khác do người quản lý dữ liệu duyệt — người ấy không thấy giá và nằm ngoài những người đã tạo, nộp, mời hay đặt ngân sách cho gói; ánh xạ sau khi mở niêm phong phải có lý do; mọi ánh xạ mang người ghi và thời điểm. Không lớp nào chặn được người quản lý dữ liệu bàn trước với người tạo gói"** |
| **[S1.281] "Kiểm soát xung đột lợi ích"** | **"Buộc người quyết định khai báo và tự rút; khai sai để lại dấu"** — ở tổ chức đã bật S3, không ai ký duyệt gói, chấm, đề xuất, duyệt hay huỷ trao thầu, xác minh nhà cung cấp hay ghi nhận tín hiệu khi chưa khai *không xung đột* với đúng danh sách mời hiện tại; một lần khai *có xung đột* là vĩnh viễn cho gói ấy và làm chữ ký đã ký thôi đếm; mỗi lời khai mang người, phiên, thời điểm và băm danh sách. Phần phải nói ra: khai báo là TỰ khai — người nói dối vẫn đi qua; hệ thống không phát hiện quan hệ, nó chỉ làm lời khai sai thành một dấu có tên (spec S3 §8.7, ADR-155) |

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

**[S1.164 / khoản 245 / ADR-102]** Vế ⑵ sai từ lúc viết tới vòng S1.164 — chỉ lần TỪ CHỐI có sổ. Nay nó đúng, và rộng hơn
chữ: mỗi lượt đọc bảng so sánh, bảng xếp hạng và mỗi lần xuất bộ bằng chứng để lại một hàng sổ trong CHÍNH giao dịch đọc; sổ
không ghi được thì giá không đi ra.

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
| S3 | Governance | MVP2 | ~~Chưa có spec~~ ~~**[S1.138] Có spec BẢN NHÁP** — `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md`, chưa qua lượt soi hình dạng~~ **[S1.139] Có spec, đã qua lượt soi hình dạng** — `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md`; ADR-080…082; chưa có mã. **[S1.142]** S3.0 chốt bảng mã quyền và lớp từ chối thứ ba của K12 (ADR-084); sàn một chữ ký rời S3.1, đã có cho mọi tổ chức (ADR-085) |
| S4 | Data Foundation & Intelligence | MVP3 | ~~Chưa có spec~~ ~~**[S1.158] Có spec BẢN NHÁP** — `docs/superpowers/specs/2026-09-26-trustprocure-s4-nen-du-lieu-tri-tue.md`, chưa qua lượt soi hình dạng~~ **[S1.159] Có spec, đã qua lượt soi hình dạng** — `docs/superpowers/specs/2026-09-26-trustprocure-s4-nen-du-lieu-tri-tue.md`; ADR-093…097; chưa có mã. Chia S4a (nền dữ liệu, chạy song song S3 sau S3.1) và S4b (trí tuệ, chờ cổng dữ liệu; riêng S4b.1 chỉ chờ S3.5). **[S1.160]** S4b có spec chi tiết ~~BẢN NHÁP~~ riêng — `docs/superpowers/specs/2026-09-26-trustprocure-s4b-tri-tue-mua-sam.md`, ~~chưa qua lượt soi hình dạng~~ **[S1.161] đã qua lượt soi hình dạng**, ADR-098, ADR-099; S4b.1 chỉ áp cho tổ chức đã bật S3; **[S1.162]** bảy câu còn lại chốt ở ADR-100 — Supplier Score hoãn tới S5, cổng dữ liệu có con số; ~~không mã~~ **[S1.192]** S4.0 + S4.1 có mã: gói `du-lieu-nen`, đơn vị đo và quy đổi SQL duy nhất (L4), khuôn nền chỉ-ghi-thêm có `seq`/`ghi_luc` do trigger đặt (L1) — `079_don_vi_do`; chưa có màn hình, chưa đường gọi từ `apps/`. **[S1.197]** S4.2a có mã: vai `DATA_STEWARD` mù giá, hàng chuẩn (danh tính bất biến, phiên bản, bí danh), quy đổi riêng theo hàng (L4 ⑵, ADR-116), cổng ghi `item.manage` ở CSDL (L3) — `083_hang_chuan`; route và màn `/du-lieu` ở S4.2b. **[S1.199]** S4.2b có mã: 11 route dữ liệu nền (tám route ghi đòi `item.manage`, ba route đọc mở cho mọi người mua của tổ chức, không cho agent) và màn `/du-lieu`; màn nói ra §8.10 — vai quản lý dữ liệu là một NGƯỜI MỚI; `gieo:demo` có người `DATA_STEWARD` và ba hàng chuẩn cho ba dòng demo. ~~Chưa có ánh xạ dòng gói sang hàng chuẩn (S4.3)~~ **[S1.204]** S4.3a có mã: ánh xạ dòng gói sang hàng chuẩn ở CSDL và tầng gói — `TU_DONG` chỉ khi mô tả trùng một bí danh còn hiệu lực (L2), người duyệt ánh xạ là người quản lý dữ liệu ngoài tập loại trừ của gói (L3), gói đã mở niêm phong thì ánh xạ cần lý do (L13); lõi gợi ý có phiên bản — `089_anh_xa_hang_muc`, ADR-121; ~~chưa có route, chưa có màn, lượt chuẩn hoá chưa chạy sau lần nộp duyệt (S4.3b)~~ **[S1.234]** S4.3b có mã: lượt chuẩn hoá chạy sau lần nộp duyệt ở tổ chức đã có hàng chuẩn đang dùng, hàng đợi ánh xạ ở `/du-lieu` (duyệt, bác, tạo hàng chuẩn mới, chuẩn hoá lại), cột hàng chuẩn chỉ đọc ở `/tao-thau`, năm route `agent: false`; `gieo:demo` có một dòng chờ duyệt. ~~Chưa có lịch sử giá (S4.4)~~ **[S1.235]** S4.4a có mã: lịch sử giá là ba hàm SQL — bộ đọc dòng của phong bì đã mở, vị từ *"giá đã lộ"* tại mốc, hàm as-of đọc mọi hàng nền tại mốc và gắn nhãn hồi tố (L5) — `096_lich_su_gia`, ADR-136; ~~chưa có route, chưa có màn, `gieo:demo` chưa có gói đã mở mang dòng (S4.4b)~~ **[S1.251]** S4.4b có mã: route `GET /items/:itemId/price-history` cho người giữ `bid.view` (không cho agent, không cho phiên khách; mỗi lần đọc một hàng sổ không giá); lịch sử không mang quan sát của gói chưa mở niêm phong hay đang có vòng BAFO chưa mở (L6, vế lịch sử); `gieo:demo` có ba gói đã mở qua worker thật; chưa có màn — màn so sánh theo dòng và benchmark ở S4.5. **[S1.253]** S4.5a có mã: gói chụp phiên bản chính sách hiệu lực lúc MỞ, và lượt chấm dùng đúng phiên bản ấy, không phiên bản khai sau đó (L14, vế lượt chấm; ADR-141) — gói mở dưới phiên bản chưa khai trọng số không chấm được; ~~benchmark ở S4.5b và S4.5c~~ **[S1.256]** S4.5b có mã: benchmark giá theo lịch sử NỘI BỘ của tổ chức — nhóm khoá `benchmark` trên phiên bản chính sách (khai ở `/chinh-sach`), nhãn mỗi dòng của mỗi báo giá ghi đúng một lần cùng lượt chấm, tái lập được, không tự so, không lưu con số nào có đơn vị tiền (L7; vế benchmark của L14; ADR-142); ~~chưa hiện ở màn — bảng so sánh theo dòng ở `/mo-thau` và bộ xuất ở S4.5c~~ **[S1.260]** S4.5c1 có mã: benchmark hiện ở `/mo-thau` — bảng so sánh theo dòng (nhãn, thành phần dải, độ phủ) và cột ở bảng xếp hạng, một bản lưu cho mỗi lần mở thầu tính ở lần đọc đầu, đóng ở vòng chào lại; số của dải chỉ khi bấm *Xem dải* (L6 vế benchmark; ADR-143); ~~bộ xuất ADR-059 ở S4.5c2~~ **[S1.262]** S4.5c2 có mã: bộ bằng chứng mang lớp dữ liệu nền — nhãn benchmark của mọi lượt chấm tính lại được khi đã ngắt CSDL, định danh gói và nhà cung cấp băm, người ánh xạ có tên (L7 vế ngoại tuyến; ADR-144). **[S1.272]** S4.6a có mã: người quản lý dữ liệu nhập mốc giá ngoài và lịch sử mua ngoài hệ thống ở `/du-lieu` — nhập tay một mốc trên trang hàng chuẩn, hay dán từ bảng tính tới 1000 dòng một lô, lô có một dòng sai thì không dòng nào vào và màn kể mọi lỗi theo số dòng; đơn vị phải quy đổi được sang đơn vị gốc của hàng; rút theo dòng hay theo lô; màn của người nhập không hiện lại đơn giá (người ấy mù giá — sửa là rút rồi nhập lại); hai bảng khai ở ADR-054 (`109_du_lieu_ngoai`, ADR-149); ~~chưa hiện ở `/mo-thau` — độ lệch so với mốc ngoài và dải lịch sử ngoài riêng ở S4.6b~~ **[S1.276]** S4.6b có mã: ở `/mo-thau`, bảng benchmark theo dòng có cột *"Lịch sử ngoài"* — nhãn của mỗi báo giá theo dải lịch sử mua ngoài hệ thống, cùng phương pháp và ngưỡng, chữ riêng ghi rõ nguồn, tính một lần cùng bản benchmark — và cờ *"có mốc ngoài"* (nguồn, ngày hiệu lực); *Xem dải* hiện số của dải ngoài, con số mốc ngoài theo đơn vị gốc và độ lệch phần trăm của từng báo giá; bảng xếp hạng vẫn chỉ nhãn nội bộ; dữ liệu ngoài nhập hay rút SAU lúc gói mở giá không đổi dải của gói ấy, chỉ được đếm (`110_ban_luu_benchmark_ngoai`, ADR-151). **[S1.279]** S4.7a có mã: lượt chấm tính TCO trên năm thành phần có nguồn — giá, phí vận chuyển và chi phí nhập khẩu nhà cung cấp khai, chi phí thanh toán (trả sớm hơn kỳ chuẩn của tổ chức, theo chi phí vốn) và chi phí trễ giao (tỷ lệ giá trị mỗi ngày giao muộn hơn số ngày gói yêu cầu) quy đổi theo tham số của phiên bản chính sách ghim; chính sách khai chất lượng, thuế, điểm phi giá hay hệ số khác 1 thì lượt chấm từ chối gọi tên; báo giá thiếu ô thì không có hạng và gọi tên ô thiếu, không lấy 0; số ngày giao yêu cầu của gói chỉ sửa khi soạn và nằm trong chữ ký phê duyệt; tập thành phần chụp lúc gói mở (L8, L16; `112_tco`, ADR-153); ~~chưa có màn — ô khai ở `/nop-thau`, số ngày giao ở `/tao-thau`, hai hạng ở `/mo-thau` là S4.7b~~ **[S1.9101] S4.7b1 có màn phía người mua:** `/chinh-sach` chọn thành phần TCO và khai tham số quy đổi (không mặc định), số ngày giao yêu cầu đặt ở `/tao-thau` khi gói đang soạn và hiện ở màn duyệt, cảnh báo trước khi gói kẹt vì thiếu số ngày giao (ADR-9201); phía nhà cung cấp — ô khai bắt buộc ở `/nop-thau`, nhà cung cấp thấy thành phần, số ngày giao và tham số — và hai hạng ở `/mo-thau` là S4.7b2; lời khai lưu cùng trao thầu — S4.7c |
| S5 | ERP Integration & Enterprise | Enterprise | Chưa có spec. **[S1.162]** Nhận Supplier Score từ S4b (ADR-100); thiết kế nháp ở spec S4b §7 |

## 8. Ràng buộc sản phẩm

| # | Ràng buộc | Nguồn |
|---|---|---|
| 1 | **Friction thấp cho nhà cung cấp là điều kiện sống còn.** Lần báo giá đầu không yêu cầu tài khoản đầy đủ (Level 0 — Guest Bidder) | Mục 10 |
| 2 | Onboarding lũy tiến: Level 0 → Level 1 (Known Supplier) → Level 2 (Supplier Passport). Level 2 chỉ kích hoạt khi thắng thầu, tham gia lặp lại, ký hợp đồng, hoặc yêu cầu KYC | Mục 10 |
| 3 | Magic link không bao giờ là URL công khai không giới hạn. Luôn cần token entropy cao + hết hạn + OTP | Mục 10 |
| 4 | **Nhà cung cấp phải dùng trình duyệt có `crypto.subtle`.** Rủi ro thực tế: webview Zalo/Messenger. Phải dò tìm khả năng và hướng dẫn rõ ràng | ADR-007 |
| 5 | Mọi ngưỡng chính sách (số NCC theo giá trị, ngưỡng phê duyệt kép, trọng số chấm điểm) phải cấu hình được theo từng doanh nghiệp. Không hard-code "3 báo giá". **[S1.161 / ADR-098 ㉘] Một ngoại lệ có ghi lý do:** ngưỡng của chốt S4b.1 — độ phủ, mức, luật nổ — là hằng của phương pháp, vì người đặt ngưỡng cũng là người ký trao | Mục 12, 13, 21 |
| 6 | BAFO là tùy chọn theo chính sách, không bắt buộc mọi RFQ | Mục 9 |

## 9. Chỉ số

**North Star Metric: Verified Competitive Spend** — giá trị mua sắm đã đi qua một quy
trình cạnh tranh, có audit trail và risk assessment. Tốt hơn hẳn việc chỉ đếm số RFQ.
**[S1.162 / ADR-100]** *"Có risk assessment"* nghĩa là gói có đánh giá rủi ro của S4b mức khác `KHONG_XAC_DINH`. Hệ quả:
phần ấy bằng 0 ở tổ chức chưa bật S3, và ở tổ chức đã bật S3 cho tới khi S4b.2 có mã và tổ chức vượt sàn dữ liệu.

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

**[S1.163]** Câu trên KHÔNG đổi. Có thêm một **pilot giả lập** (`pnpm pilot:gia-lap`, ADR-101): hai doanh nghiệp bịa,
danh mục kịch bản đi qua API thật, và bộ dữ liệu để lại cho buổi trình diễn. Nó không gỡ mảnh 4 của §11. Nó đi kèm một thang
năm bậc cam kết tăng dần tới pilot thật: `docs/superpowers/plans/2026-09-26-pilot-gia-lap.md` §7.

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
| 2 | **S2 — Đánh giá, BAFO, Award** | ~~§7 của chính tệp này khai *Chưa có spec*, và `docs/superpowers/specs/` có đúng một tệp, cho S0+S1~~ **[S1.103] Ô NÀY THIU HAI VÒNG, và nó thiu vì chính vòng viết spec không đọc lại nó.** `specs/` nay có **hai** tệp — S1.101 đưa spec S2 vào kho — và §7 đã sửa ở cùng vòng này. **Mảnh 2 vẫn CHƯA XONG, nhưng vì một lý do khác hẳn:** có spec không phải có mã. Đo được ngày 2026-09-21: S2.1 (chính sách đánh giá) cài xong ở S1.102 bằng `056`; ~~**S2.2–S2.7 chưa có một dòng nào**, nên bước *người mua CHỌN nhà cung cấp* của kịch bản §11 vẫn không chạy.~~ **[S1.113 / lượt soi ngang 78 — góc 1] LỜI KHAI VỪA GẠCH ĐÃ SAI TỪ S1.110, và không vòng nào đọc lại nó dù BỐN vòng trong năm vòng ấy có sửa chính tệp này.** Đo lại ngày 2026-09-22: **S2.2 · S2.3 · S2.4 · S2.5 · S2.6 đều XONG** (S1.104, S1.105, S1.106, S1.108+S1.109, S1.110 — bảng hạng mục của chính spec S2 ghi *XONG* cho từng dòng), và bước *người mua CHỌN nhà cung cấp* nay **đi được bằng chuột**: `apps/web/trang/mo-thau.js` gọi `GET/POST /rfqs/:rfqId/award`, `…/award/:awardId/approve` và ~~`…/award/cancel`~~ **[S1.261]** `…/award/:awardId/cancel` ở bước 7 của màn mở thầu. **[S1.254] Lời khai vừa rồi SAI từ S1.110 tới vòng này, đo ở diễn tập §11 trên Chromium:** bước 7 đòi gõ *id phiên bản báo giá* "lấy từ bảng xếp hạng", mà không bảng nào in id ấy — người mua thật không đề xuất được bằng chuột, và người duyệt bấm Phê duyệt mà không thấy đề xuất. Nay mỗi hàng xếp hạng có nút **Chọn**, và lần bấm Phê duyệt đầu hiện đề xuất (khoản 320, 321). ~~Phần CÒN LẠI của mảnh 2 là **S2.7** — *bộ xuất mang đủ đầu vào để tính lại* — và nó là vế cuối của điều kiện hoàn thành.~~ **[S1.114] MẢNH 2 XONG.** S2.7 cài ở `tools/bo-xuat-danh-gia` (ADR-059): `pnpm bang-chung xuat` ghi một bundle mang `components` từng hàng, bộ trọng số của ĐÚNG phiên bản chính sách đã dùng, định danh báo giá và mọi hàng trao thầu, cộng `DAC-TA.md` — một đặc tả đủ để cài lại phép tính; `pnpm bang-chung kiem` xác minh nó bằng HAI lớp và chạy được khi **đã ngắt kết nối cơ sở dữ liệu** (đo: `DATABASE_URL` xoá khỏi môi trường, `ok=true`). **Điều này KHÔNG đóng mảnh 1:** bước *xuất bộ bằng chứng* nay có một công cụ TỰ ĐỦ, nhưng nó vẫn là **CLI** — lỗ giao diện duy nhất còn lại của mảnh 1 không đổi một chữ. §S1.114 ~~Và ADR-051 ghi rằng **J3 chưa có lớp nào cưỡng chế** — lớp thật của nó nằm ở S2.6 cùng bảng `rfq_awards`~~ **[S1.113] Câu vừa gạch cũng đã thiu:** `061` giao ba trigger cưỡng chế trong đó có `award_kiem_de_xuat`, tức J3 CÓ lớp từ S1.110 — với đúng một lỗ đã đo và đã khai, khoản **233**, mà lượt soi 78 đề nghị đọc lại rổ. §S1.113 |
| 3 | **Triển khai thật** | ADR-009 chốt AWS + AWS KMS `ap-southeast-1` trên giấy; ~~chưa có tài khoản,~~ chưa có CMK, chưa có role — khoản nợ 15 **[S1.168]** Tài khoản AWS đã có từ S1.119, và mã triển khai đã có (adapter KMS, SES, SMS/ZNS, `deploy/Dockerfile`, stack `90-ecs`, `deploy.yml`); ~~còn thiếu CMK và role (stack 30/50 chưa apply),~~ **[apply lần đầu 2026-09-30]** CMK và role đã có (stack 00–60 đã apply, phép đo ⒜ đạt 18/18 — khoản nợ 15); còn stack `90-ecs` chưa apply, `deploy.yml` chưa chạy thật. Và sản phẩm chưa có đường tạo tổ chức đầu tiên trên prod — xem `docs/APPLY-LAN-DAU.md` bước 8.1 **[rà 2026-10-01]** Và chưa có kênh OTP nào ngoài thư: nhà cung cấp thật cần SMS hay Zalo (stack `85-sms-zalo`) mới nhận được OTP, vì OTP không đi cùng kênh với link (ADR-015 mục 1) — brandname tính bằng tuần, việc dài nhất trên đường tới pilot |
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

**[S1.153 / ADR-085] KỊCH BẢN CÓ THÊM MỘT BƯỚC, VÀ BƯỚC ẤY ĐẶT MỘT ĐIỀU KIỆN LÊN TỔ CHỨC PILOT.** Từ `068`, gói nào cũng
cần một phê duyệt TRÊN NỘI DUNG HIỆN TẠI của một người khác người tạo, rồi mới mở được; trước đó gói dưới ngưỡng mở được với
0 chữ ký (khoản 241). Đo trên `master` `fa8d4ea`, ba mã quyền của đoạn tạo → mở:
- nộp duyệt cần `rfq.create`, do `REQUESTER`, `BUYER` và `PROCUREMENT_MANAGER` giữ (`005`);
- phê duyệt cần `rfq.approve`, mở cần `rfq.open` — cả hai CHỈ `PROCUREMENT_MANAGER` giữ (`005`, `023`);
- người duyệt không được là người tạo, và mỗi chữ ký một phiên riêng (D2).

Nên tổ chức pilot cần ít nhất **hai người** cho gói dưới ngưỡng — một người tạo và một PM khác người ấy, PM ấy duyệt rồi
mở — và **ba người** cho gói vượt ngưỡng: người tạo cộng hai PM khác người ấy. Một tổ chức chỉ có một PM, mà người ấy tự
tạo gói, thì không mở được gói nào. `gieo:demo` đủ: ba PM, hai `DIRECTOR`. Số người tối thiểu cho TRỌN kịch bản — cả bước
mở niêm phong (`rfq.unseal.approve` chỉ ở `DIRECTOR`) lẫn bước trao thầu — chưa đo ở vòng này.
