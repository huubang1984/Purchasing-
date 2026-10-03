// ==============================================================================================
// [S1.114 / S2.7 / ADR-059] ĐẶC TẢ PHÉP TÍNH — VĂN BẢN ĐI KÈM BUNDLE
//
// Bảng ⑶ của ADR-059: *"Không có nó thì bundle chỉ kiểm được bằng mã của chính dự án, và khi ấy
// nó chứng NHẤT QUÁN chứ không chứng ĐÚNG."* Hằng số dưới đây là văn bản ấy; `xuat` ghi nó ra
// `DAC-TA.md` bên cạnh dữ liệu, và `kiem` khẳng định tệp trong bundle băm ra đúng `dacTaSha256`
// mà bundle khai.
//
// **Vì sao đặc tả nằm trong MÃ chứ không trong `docs/`:** một bundle xuất năm nay phải đọc được
// năm sau, khi `docs/` đã đổi. Thứ đi cùng artefact phải là thứ ĐÚNG lúc artefact ra đời — cùng lý
// do `trich` bọc chính byte đã lưu thay vì mã hoá lại (ADR-026 §5⑶).
//
// **[mảnh 1 / màn xuất bằng chứng] Vì sao tệp này ở `packages/danh-gia` chứ không còn ở
// `tools/bo-xuat-danh-gia`:** từ vòng này bundle có HAI đường xuất — CLI `pnpm bang-chung xuat` và
// route `GET /rfqs/:rfqId/evidence-bundle` của `apps/api` — và cả hai phải ghi ĐÚNG cùng byte.
// `apps/` không được import `tools/`, nên văn bản xuống gói mà cả hai cùng gọi. Lớp kiểm ĐỘC LẬP
// (`tools/bo-xuat-danh-gia/src/doc-lap/`) KHÔNG đọc hằng số này — nó được viết TỪ văn bản, và `g17-`
// cấm nó với tới gói này bằng bất kỳ đường nào.
//
// Một dòng ở đây đổi nghĩa là phép tính đổi. Nếu phép tính KHÔNG đổi mà chữ đổi, `dacTaSha256` của
// các bundle cũ vẫn khớp tệp CỦA CHÍNH CHÚNG — băm nằm trong bundle, không nằm ở đây.
// ==============================================================================================

/** [S1.262 / S4.5c2] `2`: thêm §8 — lớp dữ liệu nền (benchmark giá); §6 nói rõ lớp ấy CÓ đọc mốc thời gian. */
export const DAC_TA_PHIEN_BAN = 2;

/**
 * Đặc tả phép tính, đủ để một người ngoài dự án cài lại bằng công cụ của họ.
 *
 * Xuống dòng là `\n` và văn bản ghi ra đĩa bằng byte UTF-8: kho chạy `core.autocrlf=true`, và một
 * lần dịch xuống dòng là một lần `dacTaSha256` lệch mà không ai đổi một chữ nào.
 */
export const DAC_TA = `# Đặc tả phép tính của bộ bằng chứng đánh giá — TrustProcure

Phiên bản đặc tả: **2**

Văn bản này đủ để tính lại mọi con số trong \`bo-bang-chung.json\` **mà không cần một dòng mã nào
của TrustProcure** và **không cần truy cập cơ sở dữ liệu của nó**. Nếu một chỗ nào dưới đây không
đủ rõ để anh cài lại, đó là một khiếm khuyết của văn bản này, không phải của người đọc.

## 1. Mọi con số là CHUỖI thập phân, không phải số dấu phẩy động

Mọi giá trị tiền và hệ số trong bundle là chuỗi (\`"100.00"\`, \`"1.2500"\`). Đọc chúng bằng một
kiểu số nguyên chính xác tuỳ ý hay bằng số học thập phân; **không** đọc bằng \`double\`/\`float\`.
\`0.1 + 0.2 !== 0.3\` là đủ để đảo thứ tự hai báo giá cách nhau một xu, và thứ tự ấy quyết ai được
trao thầu.

## 2. Số chữ số thập phân

* Tiền (\`giaTri\`, \`tien\`, \`effectiveCost\`): **đúng 2** chữ số thập phân.
* Hệ số (\`he_so\` của chính sách): **tối đa 4** chữ số thập phân.

## 3. Chi phí hiệu dụng của một hàng

Đầu vào của một hàng gồm hai thứ, cả hai nằm trong bundle:

* \`chinhSachThanhPhan\` — mảng \`{ ma, don_vi, he_so }\` của phiên bản chính sách ĐÃ DÙNG cho
  lượt chấm ấy;
* \`components[].giaTri\` của hàng — giá trị báo giá khai cho từng mã.

Thuật toán:

1. Nếu hai thành phần chính sách trùng \`ma\`, hay một \`ma\` của hàng không có trong chính sách,
   hay một \`ma\` của chính sách không có trong hàng, hay chính sách không có thành phần
   \`don_vi = "TIEN"\` nào: hàng **không tính lại được**. Đó là một kết luận, không phải một lỗi.
2. Với mỗi thành phần của **chính sách**, theo đúng thứ tự chính sách khai:
   * \`don_vi = "DIEM"\` ⇒ \`tien = null\`. Thành phần ấy **không** cộng vào tổng. Nó vẫn có mặt
     trong bảng, vì bỏ nó đi là nói dối về thứ chính sách đã khai.
   * \`don_vi = "TIEN"\` ⇒ \`tien = LÀM_TRÒN(giaTri × he_so, 2)\`.
   * \`don_vi\` khác hai giá trị trên ⇒ hàng không tính lại được.
3. \`effectiveCost\` = **tổng ĐÚNG** của mọi \`tien\` không null. Tổng **không** được làm tròn
   thêm một lần nữa.

**Làm tròn ở đâu là một quyết định, và nó được nói ra:** làm tròn TỪNG thành phần rồi cộng, chứ
không cộng rồi làm tròn một lần. Hai cách cho kết quả khác nhau — đo trên 200 000 bộ 2–6 thành
phần: khác ở **38,5 %** số bộ, lệch lớn nhất gặp được **0,03**. Cách ở đây được chọn để phép kiểm
của người ngoài là một phép CỘNG, tức công cụ yếu nhất có thể.

## 4. Luật làm tròn: NỬA-RA-XA-0

\`LÀM_TRÒN(x, 2)\` giữ 2 chữ số thập phân; phần bị cắt bằng đúng một nửa thì làm tròn **ra xa số
không**:

| x | LÀM_TRÒN(x, 2) |
|---|---|
| \`0.005\` | \`0.01\` |
| \`-0.005\` | \`-0.01\` |
| \`0.004999\` | \`0.00\` |
| \`-0.004999\` | \`0.00\` |

Đây là luật của \`round(x, 2)\` trong PostgreSQL, **không** phải luật mặc định của nhiều thư viện
(\`nửa-lên\`, hay \`nửa-về-số-chẵn\` của IEEE 754). Hai luật \`nửa-lên\` và \`nửa-ra-xa-0\` chỉ
khác nhau ở **số âm** — một bảng ca toàn số dương không phân biệt được chúng.

Kết quả \`-0.00\` viết là \`0.00\`: bảng xếp hạng không có hai số không.

## 5. Xếp hạng

1. Bỏ ra ngoài mọi hàng không có \`effectiveCost\`.
2. Sắp các hàng còn lại theo \`effectiveCost\` **tăng dần** (rẻ nhất hạng 1).
3. Hạng của hàng ở vị trí thứ \`k\` (đếm từ 1) là \`k\`, **trừ khi** \`effectiveCost\` của nó bằng
   đúng hàng liền trước — khi ấy nó nhận CÙNG hạng với hàng liền trước.
   Ví dụ bốn giá \`10, 20, 20, 30\` cho hạng \`1, 2, 2, 4\`.
4. Hàng không có \`effectiveCost\` nhận hạng \`null\`. Nó **không** lên đầu bảng và **không**
   chiếm một hạng.

## 6. Chi phí hiệu dụng và xếp hạng KHÔNG đọc đồng hồ

Không một bước nào ở §3–§5 dùng thời gian. Mọi trường thời gian của lớp chấm thầu là **tin về sự
kiện**, không phải đầu vào của phép tính — nên một đồng hồ lệch không đổi được một con số nào ở đó.

Lớp dữ liệu nền ở §8 thì **CÓ**: cửa sổ lịch sử và thứ tự "trước hay sau mốc" là đầu vào của nhãn.
Mọi mốc ở lớp ấy đến từ CÙNG đồng hồ của cơ sở dữ liệu, nên nhãn tính lại đúng **tương đối với các
mốc trong bundle** — không với thời gian thực.

Điều ấy được nói ra vì hệ thống sinh ra bundle này **có** một khiếm khuyết đồng hồ đã đo và đã
ghi: mọi mốc thời gian dưới đây đến từ đồng hồ của cơ sở dữ liệu lúc ghi, và **nguồn thời gian ấy
chưa được chứng thực**. Mỗi trường thời gian trong bundle vì thế đi kèm trường \`nguon\` nói đúng
điều đó. Đừng dùng chúng để phán xử *đúng hạn hay quá hạn*; chúng đủ để đối chiếu THỨ TỰ các sự
kiện trong cùng một bundle, và chỉ chừng ấy.

## 7. Thứ đặc tả này KHÔNG nói

Nó không nói ai được trao thầu là **đúng**. Trao thầu cho hàng hạng 1 không phải một luật của sản
phẩm: một bên mua có thể trao cho hàng hạng khác và ghi lý do. Bundle mang \`traoThau[]\` cùng hạng
của báo giá được chọn để người đọc **thấy** điều đó, không phải để một bộ kiểm phán xử nó.

Nó cũng không nói chuỗi sổ kiểm toán có bị sửa hay không — câu hỏi ấy do mốc neo ngoài trả lời
(\`pnpm neo\`), một artefact khác, ký bằng một khoá khác.

## 8. Lớp dữ liệu nền — benchmark giá \`TRUNG_VI_THEO_GOI_V1\`

Trường \`duLieuNen\` của \`bo-bang-chung.json\`. Lớp phải mang **mọi** lượt chấm có
\`luotCham[].coBenchmark = true\` (phiên bản chính sách của lượt ấy cấu hình nhóm \`benchmark\`) và
**không** mang lượt nào có \`coBenchmark = false\`. \`null\` chỉ hợp lệ khi không lượt chấm nào có
\`coBenchmark = true\`; một lớp \`null\` trong khi có lượt cần nó là bundle **sai**, không phải
"không có gì để kiểm". Mục này đủ để tính lại **nhãn, chiều, lý do và mọi số đếm** của từng dòng của
từng báo giá trong từng lượt chấm, từ đơn giá đã quy đổi mang trong bundle.

### 8.1 Định danh băm

\`goi\` và \`ncc\` của một quan sát là định danh gói thầu và nhà cung cấp, **băm với một muối
ngẫu nhiên sinh cho riêng lần xuất này rồi vứt** (HMAC-SHA256, muối 32 byte, giữ 128 bit đầu).
Muối không nằm trong bundle. Hai mã bằng nhau ⇔ cùng một gói (hay một nhà cung cấp) **trong bundle
này**. \`goiX\` là mã của chính gói thầu của bundle, cùng muối.

Phép băm chặn **đọc ra** định danh thật từ mã. Nó **không** chặn hai thứ, và đặc tả nói ra:
* **khớp** (\`ngay\`, \`gia\`, \`tienTe\`) của một quan sát với lịch sử giá của chính tổ chức — người
  đã đọc được lịch sử ấy trong hệ thống nhận ra gói nào đứng sau một mã;
* **nối** hai bundle của cùng tổ chức qua các quan sát chung — mã khác nhau nhưng (\`ngay\`,
  \`gia\`) trùng.

Để giảm phép khớp, \`ngay\` chỉ là ngày (§8.2) và thứ tự quan sát trong bảng theo **nội dung**
(\`ngay\`, \`gia\`, \`tienTe\`, …), không theo định danh. Bundle là một nơi mang giá; chia sẻ nó
là chia sẻ giá.

### 8.2 Thời điểm

Mọi mốc của lớp này — \`mocMoGia\`, \`docLuc\`, \`tuNgay\`, \`cuaSoTu\`, \`ghiLuc\` — là chuỗi
ISO 8601 UTC với **đúng sáu** chữ số lẻ của giây: \`2026-03-31T09:15:00.123456Z\`. Mọi mốc cùng
dạng, nên **so hai chuỗi theo thứ tự từ điển là so hai thời điểm**.

Riêng \`ngay\` của một quan sát có **hai** dạng:
* **ngày UTC trơn** \`2026-03-01\` — dạng thường;
* **mốc đủ micro giây** như trên — khi ngày UTC của nó là một **ngày biên**: ngày của
  \`mocMoGia\`, hay ngày của \`cuaSoTu\` của một lượt chấm dùng bảng ấy.

Ngoài ngày biên, ngày trơn đủ để phán xử cửa sổ bằng chính phép so chuỗi của §8.5: khi mốc \`M\`
không rơi vào ngày \`D\`, \`D\` đứng trước \`M\` theo thứ tự từ điển ⇔ mọi thời điểm của ngày
\`D\` đứng trước \`M\`. Một ngày trơn **trên** ngày biên của dòng đang tính là bundle **sai** —
bộ kiểm báo lỗi, không xếp quan sát ấy vào hay ra.

### 8.3 Cửa sổ

\`cuaSoTu\` = \`mocMoGia\` lùi \`cua_so_thang\` tháng **theo lịch UTC**: lùi (năm, tháng) đi
\`cua_so_thang\` tháng; giữ ngày, nhưng nếu tháng đích ngắn hơn thì **kẹp về ngày cuối của tháng
đích**; giữ nguyên giờ, phút, giây và micro giây. Năm nhuận: chia hết cho 4 và (không chia hết cho
100 hoặc chia hết cho 400).

| \`mocMoGia\` | \`cua_so_thang\` | \`cuaSoTu\` |
|---|---|---|
| \`2026-03-31T09:15:00.123456Z\` | 1 | \`2026-02-28T09:15:00.123456Z\` |
| \`2024-03-31T00:00:00.000000Z\` | 1 | \`2024-02-29T00:00:00.000000Z\` |
| \`2026-01-15T23:59:59.999999Z\` | 12 | \`2025-01-15T23:59:59.999999Z\` |

Đây là lịch **UTC**, không phải giờ Việt Nam: một mốc trong bảy giờ quanh nửa đêm cuối tháng có thể
ra cửa sổ khác với phép tính theo +07:00. Đó là quyết định đã đo, không phải sơ suất.

### 8.4 Đầu vào

* \`chinhSachBenchmark\` của lượt chấm — \`cua_so_thang\`, \`san_goi\`, \`san_ncc\` (số nguyên),
  \`nguong_lech_vua\`, \`nguong_lech_cao\` (chuỗi thập phân), \`phuong_phap\`.
  Ràng buộc (bundle ngoài ràng buộc là bundle sai): \`cua_so_thang\` nguyên 1–60; \`san_goi\`,
  \`san_ncc\` nguyên 1–50; \`0 < nguong_lech_vua < nguong_lech_cao ≤ 10\`, tối đa bốn chữ số lẻ;
  \`phuong_phap = "TRUNG_VI_THEO_GOI_V1"\` (và \`duLieuNen.phuongPhap\` cũng vậy).
* \`bangQuanSat[]\` — với mỗi (\`mocMoGia\`, \`hangChuan\`): mọi quan sát hợp lệ có \`ngay\` từ
  \`tuNgay\` (biên cửa sổ **rộng nhất** trong các lượt chấm dùng bảng — không lề) tới trước
  \`mocMoGia\`. Mỗi quan sát: \`goi\`, \`ncc\`, \`ngay\` (mốc mở giá của gói chứa nó, §8.2),
  \`gia\` (đơn giá đã quy đổi về đơn vị gốc của hàng chuẩn), \`tienTe\`, \`cungNguoiTao\`,
  \`hoiTo\`.
* \`dong[].giaDong\` — giá của CHÍNH dòng ấy tại \`docLuc\` (lúc chấm): \`trangThai\`, \`gia\`,
  \`tienTe\`, \`hangChuan\`, \`hoiTo\`, \`anhXaId\` (hàng ánh xạ hiệu lực); \`null\` khi lúc ấy không ánh xạ hiệu lực nào trỏ dòng về
  một hàng chuẩn.

### 8.5 Một dòng

**Đủ dòng:** với mỗi lượt chấm của lớp, mỗi cặp (báo giá có hạng ở lớp chấm thầu, dòng của
\`hangMuc[]\`) có **đúng một** hàng ở \`dong[]\` — không thiếu, không trùng; và không hàng nào của
\`dong[]\` thuộc một báo giá không có hạng.

1. \`giaDong = null\` ⇒ nhãn \`KHONG_DO_DUOC\`, \`lyDo = "CHUA_ANH_XA"\`.
2. \`giaDong.trangThai ≠ "HOP_LE"\` ⇒ nhãn \`KHONG_DO_DUOC\`, \`lyDo = giaDong.trangThai\`.
   Ở cả hai trường hợp, \`tienTe\`, \`cuaSoTu\` và bảy số đếm là \`null\`. Ở trường hợp 1, dòng
   **không** có \`anhXa\`, \`hangChuan = null\` và \`hoiTo = []\`.
3. Còn lại: \`p = giaDong.gia\`, \`T = giaDong.tienTe\`. Lấy bảng quan sát của (\`mocMoGia\`,
   \`giaDong.hangChuan\`). Duyệt từng quan sát:
   * \`goi = goiX\` ⇒ bỏ (không quan sát nào của chính gói này);
   * \`ngay ≥ mocMoGia\` hay \`ngay < cuaSoTu\` ⇒ bỏ;
   * \`tienTe ≠ T\` ⇒ bỏ, **đếm** vào \`soLoaiTienTe\`;
   * \`gia = 0\` ⇒ bỏ, **đếm** vào \`soLoaiGia0\`;
   * còn lại: vào **dải**.
4. Số đếm trên dải: \`soQuanSat\` = số quan sát; \`soGoi\` = số \`goi\` khác nhau; \`soNcc\` = số
   \`ncc\` khác nhau; \`soGoiCungNguoiTao\` = số \`goi\` khác nhau có \`cungNguoiTao = true\`;
   \`soQuanSatHoiTo\` = số quan sát có \`hoiTo\` khác rỗng.
5. **Sàn:** \`soGoi ≥ san_goi\` **và** \`soNcc ≥ san_ncc\`. Không đạt ⇒ nhãn
   \`CHUA_DU_LICH_SU\`, \`chieu = null\` (số đếm vẫn báo).
6. **Mốc so:** với mỗi \`goi\`, trung vị các \`gia\` của nó; \`m\` = trung vị của các trung vị gói.
   "Trung vị" và "tứ phân vị" ở đây là phân vị **nội suy tuyến tính**: sắp tăng \`x[0..n-1]\`, vị
   trí \`h = (n − 1) · k / 4\` (\`k = 2\` cho trung vị, \`1\`/\`3\` cho Q1/Q3), giá trị
   \`x[⌊h⌋] + (h − ⌊h⌋) · (x[⌊h⌋+1] − x[⌊h⌋])\` — cùng nghĩa \`percentile_cont\` của PostgreSQL. Phép
   tính là **thập phân chính xác**: \`h − ⌊h⌋\` chỉ là \`0\`, \`0,25\`, \`0,5\` hay \`0,75\`.
   (Q1 và Q3 là dải màn hình hiện; chúng không lưu và không đổi nhãn.)
7. **Nhãn:** \`d = |p − m|\`.
   * \`d ≤ nguong_lech_vua · m\` ⇒ \`BINH_THUONG\`, \`chieu = null\`;
   * ngược lại \`chieu = "TREN"\` nếu \`p > m\`, \`"DUOI"\` nếu \`p < m\`; rồi
     \`d ≤ nguong_lech_cao · m\` ⇒ \`LECH_VUA\`, không thì \`LECH_CAO\`.
   So bằng phép nhân, không chia. Biên tính về phía nhẹ hơn: \`d\` bằng đúng ngưỡng là chưa vượt.
8. \`cuaSoTu\` của dòng đo được (kể cả \`CHUA_DU_LICH_SU\`) là cửa sổ ở §8.3; \`tienTe = T\`;
   \`hoiTo\` của dòng là \`giaDong.hoiTo\`.

### 8.6 Đầu vào đã lưu

\`dauVao[]\` của lượt chấm liệt kê, cho mỗi (\`hangChuan\`, \`tienTe\`), mã các quan sát mà lượt chấm
ĐÃ đưa vào dải lúc chấm. Tập ấy phải **bằng** tập ở bước 3 của §8.5. \`dauVaoThieu > 0\` nghĩa là có
đầu vào đã lưu không còn trong bảng quan sát đọc lại — dữ liệu đã đổi ngoài luật chỉ-ghi-thêm, và
lượt chấm ấy không tái lập được.

### 8.7 Ánh xạ

\`dong[].anhXa\` là hàng ánh xạ mà dòng dùng: \`anhXaId\`, \`hangChuan\`, \`tacGia\` (mã người
dùng và họ tên), \`ghiLuc\`, \`nguon\`, \`lyDo\`. Khi \`giaDong ≠ null\`: \`anhXa.anhXaId\` phải
**bằng** \`giaDong.anhXaId\` (hàng hiệu lực tại \`docLuc\`), và \`dong.hangChuan\`,
\`anhXa.hangChuan\`, \`giaDong.hangChuan\` bằng nhau — câu "do ai ánh xạ" đứng trên đúng hàng mà
phép tính đã dùng. *"Dòng ấy do ai ánh xạ, lúc nào, trước hay sau khi giá của chính nó lộ"* là
\`tacGia\`, \`ghiLuc\`, và \`ghiLuc\` so với \`mocMoGia\`. \`tacGia.hoTen\` là họ tên **hiện tại**
của người dùng lúc xuất, không phải lúc ghi; \`tacGia.userId\` là thứ không đổi. \`hangMuc[]\` mang mô tả, đơn vị, số
lượng của từng dòng của gói. Đây là thông tin, không phải đầu vào của phép tính.

### 8.8 Thứ lớp này KHÔNG tính lại

* **Phép quy đổi đơn vị:** \`gia\` của một quan sát (thành tiền chia cho số lượng nhân hệ số quy
  đổi, qua bí danh đơn vị và phiên bản hàng chuẩn) là dữ liệu của hệ thống, không tính lại ở đây.
* **Cờ \`hoiTo\`** — hàng nền nào được ghi sau khi giá của gói chứa quan sát đã lộ — là dữ liệu.
* **Tính đầy đủ của bảng quan sát:** bundle cho thấy thứ đã vào dải; nó không chứng được rằng một
  quan sát nào đó KHÔNG bị bỏ sót — ngoài phép so với đầu vào đã lưu ở §8.6.
* **Bản lưu benchmark của bảng so sánh** (thứ màn mở thầu hiện) không nằm trong bundle; bundle mang
  hồ sơ benchmark của **lượt chấm**.
`;
