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

/**
 * Đặc tả phép tính, đủ để một người ngoài dự án cài lại bằng công cụ của họ.
 *
 * Xuống dòng là `\n` và văn bản ghi ra đĩa bằng byte UTF-8: kho chạy `core.autocrlf=true`, và một
 * lần dịch xuống dòng là một lần `dacTaSha256` lệch mà không ai đổi một chữ nào.
 */
export const DAC_TA = `# Đặc tả phép tính của bộ bằng chứng đánh giá — TrustProcure

Phiên bản đặc tả: **1**

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

## 6. Phép tính KHÔNG đọc đồng hồ

Không một bước nào ở trên dùng thời gian. Mọi trường thời gian trong bundle là **tin về sự kiện**,
không phải đầu vào của phép tính — nên một đồng hồ lệch không đổi được một con số nào ở đây.

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
`;
