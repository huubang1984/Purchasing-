# Ma trận bất biến — Evidence Pack

> **Sinh tự động** bởi `tools/inv-matrix`. **Không sửa tay** — `pnpm evidence:check` sinh lại
> file này và đỏ nếu bản đã commit lệch một byte.
>
> File này **cố ý tất định**: không mang commit SHA, không mang dấu thời gian. Xuất xứ của
> một lượt chạy cụ thể nằm ở `evidence/run-metadata.md` (không vào git; tải lên như artefact
> của CI). Nếu ma trận mang dấu thời gian thì nó đổi mỗi lần chạy, và phép kiểm chống-sửa-tay
> ở trên là bất khả.

## 0. Bảng này đếm cái gì

Dự án có **hai cách đếm bất biến**, cả hai đều đúng trong phạm vi của mình, và việc lẫn lộn
chúng đã sinh ra ba con số khác nhau trong ba tài liệu. Bảng này chốt cách đếm:

- **34 bất biến nghiệp vụ** (nhóm A–G): mệnh đề về hành vi của sản phẩm với
  dữ liệu của khách hàng. Đây là con số `docs/STATE.md` dùng khi nói S0 *nhắm tới* bao nhiêu.
- **16 bất biến hàng rào** (nhóm H): mệnh đề về việc một biện pháp kiểm soát của
  chính dự án — hai hook, các họ quy tắc biên giới của dependency-cruiser — có còn răng hay không.
- **Tổng 50 mã** cùng chảy vào bảng này. Tiêu chí phân nhóm là *cái này canh CÁI GÌ*.

Con số cũ **44** (34 + 10) trong bản kế hoạch S0 đã **thiu**: nhóm H có thêm H11/H12 (Task 9)
và H13 (Task 10). Sổ đăng ký `docs/TEST-PLAN.md` là nguồn sự thật duy nhất; bảng này đọc thẳng
từ đó và **ném** nếu số hàng đọc được lệch với một phép đếm độc lập.

## 1. Tổng kết

| Nhóm | Đã phủ | Tổng |
|---|---|---|
| Nghiệp vụ (A–G) | **14** | 34 |
| Hàng rào (H) | **16** | 16 |
| **Cộng** | **30** | **50** |

**20 mã chưa phủ**, tất cả đều nằm trong danh sách được phép ở §3, mỗi mã một lý do đọc được.

`docs/STATE.md` ghi S0 **nhắm tới** 13 bất biến nghiệp vụ (B3, B4, D1, D3, D5, E3, F1, F2, F3,
G1, G2, G3, G4). S0 **giao được 14**: G2 và G4 không có lớp. `docs/TEST-PLAN.md` là
nơi ghi vì sao — và §3 dưới đây là nơi ghi ra rằng chúng trống *có lý do*, không phải vì quên.

## 2. Ma trận

| INV | Mệnh đề | Cưỡng chế | Tầng test | Số test | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| A1 | Với RFQ chưa UNSEALED, không endpoint nào trả về trường giá cho bất kỳ actor nội bộ nào | Kiến trúc: không có khóa giải mã trong `api` | T2, T5 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| A2 | Giá dạng rõ không tồn tại trong `api` service tại bất kỳ thời điểm nào — kể cả bộ nhớ, log, APM trace, thông báo lỗi | Kiến trúc: mã hóa ở trình duyệt (ADR-007) | T1, T5 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| A3 | Truy vấn SQL trực tiếp vào bảng bid, kể cả bằng role quản trị, chỉ cho ra ciphertext | Lược đồ: cột chỉ chứa ciphertext | T3 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| A4 | Không trường phái sinh nào rò rỉ giá trước mở thầu: không min/max/trung bình, không "số NCC dưới ngân sách", không sắp xếp theo giá, không nhãn "giá tốt nhất", không biểu đồ | Bộ quét rò rỉ tự động | T2 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| A5 | Nhà cung cấp không biết được danh tính, sự tồn tại, số lượng hay giá của nhà cung cấp khác — kể cả gián tiếp qua ID tuần tự, số thứ tự, hay thời gian phản hồi | Ứng dụng + ID không tuần tự | T2, T5, T6 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| A6 | Số báo giá đã nhận cũng là thông tin nhạy cảm; ẩn khỏi Buyer trước CLOSED khi chính sách bật chế độ nghiêm | Ứng dụng | T2, T5 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| B1 | Mỗi lần nộp tạo version mới; không UPDATE, không DELETE | DB trigger | T3, T5 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| B2 | Mỗi lần nộp sinh biên nhận: `sha256(ciphertext)` + thời gian DB + số version + mã RFQ, có chữ ký hệ thống; nhà cung cấp kiểm chứng độc lập được | Ứng dụng + chữ ký | T1, T3, T4 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| B3 | `audit_events` là chuỗi hash; bộ kiểm chứng phát hiện được chèn, sửa, xóa, và **cắt đuôi** | Lược đồ + bộ kiểm chứng | **T1**, T3 | 33 | ✅ ĐẠT |  |
| B4 | Không đường code nào xóa/sửa audit; role ứng dụng bị REVOKE UPDATE, DELETE | Quyền DB | T3, T5 | 20 | ✅ ĐẠT |  |
| B5 | Ciphertext lưu trữ luôn khớp hash trong biên nhận tại mọi thời điểm về sau | Job kiểm tra định kỳ | T3, T6 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| C1 | Sau `deadline_at` mọi lần nộp bị từ chối; phán quyết dựa trên `now()` của Postgres trong chính transaction ghi | Ràng buộc trong transaction | **T3**, T5 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| C2 | Tính đúng đắn không phụ thuộc scheduler — job đóng RFQ chết không làm bid muộn được chấp nhận | Kiến trúc (ADR-005) | T3, T6 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| C3 | Mở thầu chỉ hợp lệ khi RFQ đã CLOSED | Cổng chính sách trong `unseal-worker` | T1, T5 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| C4 | Không rút ngắn deadline sau khi đã có báo giá; gia hạn chỉ khi đang OPEN, có lý do, có audit, có thông báo toàn bộ nhà cung cấp đã mời | Ứng dụng + audit | T1, T3 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| C5 | Cặp khóa RFQ chỉ sinh đúng lúc chuyển sang OPEN | Máy trạng thái | T1, T3 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| D1 | Mở thầu cần đồng thời: quyền hợp lệ **và** MFA còn hiệu lực trong cửa sổ ngắn **và** RFQ đã CLOSED **và** cổng chính sách thông qua | Cổng chính sách | T1, T5 | 17 | ✅ ĐẠT | **mệnh đề HỘI 4 vế — phạm vi hẹp hơn, xem §4** |
| D2 | RFQ vượt ngưỡng cần 2 phê duyệt từ 2 người khác nhau, 2 phiên khác nhau; người tạo yêu cầu không được là một trong hai | Cổng chính sách + ràng buộc DB | **T3**, T5 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| D3 | Chuỗi tạo RFQ → chọn nhà cung cấp → mở thầu → award → duyệt không nằm trọn trong tay một người (ma trận mục 25) | Policy engine | T1, T5 | 26 | ✅ ĐẠT |  |
| D4 | Break-glass đi đường riêng, bắt buộc lý do, sinh cảnh báo mức cao tức thì, không bao giờ im lặng | Ứng dụng + audit + thông báo | T1, T4 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| D5 | Lần từ chối vì thiếu quyền cũng phải audit — không chỉ audit lần thành công | Ứng dụng | T3, T5 | 4 | ✅ ĐẠT | **phạm vi hẹp hơn mệnh đề — xem §4** |
| E1 | Token ≥ 128 bit entropy từ CSPRNG, lưu dạng hash, đơn mục đích, có hạn, thu hồi được | Ứng dụng + lược đồ | **T1**, T3 | 6 | ✅ ĐẠT |  |
| E2 | Token một mình không đủ vào phiên báo giá — luôn phải qua OTP trên kênh đã đăng ký | Ứng dụng | T4, T5 | 2 | ✅ ĐẠT | **phạm vi hẹp hơn mệnh đề — xem §4** |
| E3 | OTP: giới hạn số lần thử, giới hạn tần suất, hết hạn, dùng một lần, so sánh chống tấn công thời gian | Ứng dụng | T1, T5 | 22 | ✅ ĐẠT | **phạm vi hẹp hơn mệnh đề — xem §4** |
| E4 | MST hay mã RFQ không bao giờ là credential | Thiết kế | T5 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| E5 | Link chuyển tiếp vẫn dùng được, nhưng người nhận phải qua OTP; hệ thống ghi danh tính **thực tế đã xác thực**, không phải danh tính người được mời | Ứng dụng + audit | T4, T5 | 1 | ✅ ĐẠT | **phạm vi hẹp hơn mệnh đề — xem §4** |
| E6 | Không dữ liệu nhạy cảm nào nằm trong URL — kể cả rò qua header `Referer` | Thiết kế URL + Referrer-Policy | T2, T4 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| F1 | Mọi truy vấn bị ràng buộc `org_id` ở tầng DB qua RLS, không chỉ tầng ứng dụng | Postgres RLS | **T3**, T5 | 42 | ✅ ĐẠT | **phạm vi hẹp hơn mệnh đề — xem §4** |
| F2 | Không IDOR — và quyền truy cập không bao giờ dựa vào việc ID khó đoán | Kiểm tra quyền tường minh | T2, T5 | 2 | ✅ ĐẠT |  |
| F3 | Khóa của tổ chức A không giải mã được dữ liệu tổ chức B | Phân cấp khóa theo tổ chức | T1, T3 | 1 | ✅ ĐẠT |  |
| G1 | Private key RFQ không bao giờ ở dạng rõ ngoài `unseal-worker` — không vào DB, log, biến môi trường, core dump | IAM + quyền cột DB | **T0**, T3, T5 | 18 | ✅ ĐẠT | **phạm vi hẹp hơn mệnh đề — xem §4** |
| G2 | Mỗi RFQ một cặp khóa; lộ một RFQ không lan sang RFQ khác | Thiết kế khóa | T1, T3 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| G3 | Xoay master key không làm mất khả năng giải mã báo giá cũ | Bọc khóa có phiên bản | T3, T6 | 2 | ✅ ĐẠT |  |
| G4 | Mọi thao tác khóa — sinh, bọc, mở bọc, hủy — đều sinh audit | Ứng dụng | T3, T5 | 0 | ⏳ CHƯA PHỦ | xem §3 |
| H1 | `git reset --hard` bị chặn với mã thoát 2 | Hook `git-safety` | T1 | 2 | ✅ ĐẠT |  |
| H2 | `git clean -f*` bị chặn | Hook `git-safety` | T1 | 3 | ✅ ĐẠT |  |
| H3 | Đẩy ép buộc (`--force`, `-f`, `--force-with-lease`, cờ ngắn gộp) bị chặn | Hook `git-safety` | T1 | 5 | ✅ ĐẠT |  |
| H4 | Lệnh xoá bỏ thay đổi cục bộ (`checkout -- .`, `restore .`) bị chặn | Hook `git-safety` | T1 | 2 | ✅ ĐẠT |  |
| H5 | Lệnh viết lại lịch sử (`branch -D`, `filter-branch`, `stash clear/drop`, `reflog expire`, `update-ref -d`) bị chặn | Hook `git-safety` | T1 | 7 | ✅ ĐẠT |  |
| H6 | **Không lời gọi git phá huỷ nào lọt qua bất kể toán tử shell, chuyển hướng, hay tuỳ chọn toàn cục xen giữa** (`git -C <dir>`, `git -c k=v`, `git --no-pager`, cờ bị bọc nháy, `2>&1`/`&>`/`>&2`, ...) — hook dò tín hiệu phá huỷ trên toàn bộ token của dòng lệnh, thiên về chặn, không dựa vào việc xác định đúng ranh giới lời gọi hay vị trí subcommand | Hook `git-safety` | T1 | 18 | ✅ ĐẠT |  |
| H7 | Lệnh git vô hại được cho qua — hàng rào không được cản trở công việc bình thường | Hook `git-safety` | T1 | 18 | ✅ ĐẠT |  |
| H8 | Ghi vào file bí mật bị chặn, **không phân biệt hoa thường**: `.env`, `.pem`, `.key`, `.p12`, `.pfx`, `.jks`, `.keystore`, `id_rsa`, `id_ed25519`, `credentials.json`, `secrets.y*ml`, `.npmrc`, `.pgpass`, `.netrc`, `.claude/settings*.json` | Hook `protect-secrets` | T1 | 29 | ✅ ĐẠT |  |
| H9 | File nguồn thường và `.env.example` được cho qua — khớp theo tên và phần mở rộng, không khớp chuỗi con | Hook `protect-secrets` | T1 | 8 | ✅ ĐẠT |  |
| H10 | **Đầu vào rỗng, JSON hỏng, thiếu trường, sai kiểu, hoặc thiếu phụ thuộc runtime đều CHẶN** — fail-closed | Cả hai hook | T1 | 7 | ✅ ĐẠT |  |
| H11 | **Biên giới module của `packages/identity`**: chỉ `index.ts` là cửa công khai; module mới thêm vào `src/` mặc định không với tới được từ ngoài; đường dẫn TƯƠNG ĐỐI xuyên gói cũng bị chặn; không miễn trừ nào được phép mà không đồng thời là đích hạn chế | Họ quy tắc `g2-` của dependency-cruiser | T0 | 5 | ✅ ĐẠT |  |
| H12 | **`packages/identity` KHÔNG có một cạnh phụ thuộc nào tới `packages/crypto-keys`** — cả đường BỌC lẫn đường MỞ, và họ quy tắc này không có bậc tự do nào (không `from.pathNot`, không `to.pathNot`) | Quy tắc `g3-` của dependency-cruiser | T0 | 4 | ✅ ĐẠT |  |
| H13 | **Biên giới module của `packages/outbox`**: chỉ `index.ts` là cửa công khai; module mới thêm vào `src/` mặc định không với tới được từ ngoài; đường dẫn TƯƠNG ĐỐI xuyên gói cũng bị chặn; họ quy tắc không có miễn trừ `from` nào | Họ quy tắc `g4-` của dependency-cruiser | T0 | 4 | ✅ ĐẠT |  |
| H14 | **Không một chỉ mục duy nhất nào trên bảng tenant vừa GHI ĐƯỢC bởi `app_api` vừa thiếu `org_id` ở cột đầu tiên** — phạm vi là `pg_index` (phủ cả PRIMARY KEY, UNIQUE constraint và `CREATE UNIQUE INDEX` trần), vị từ suy từ TÍNH CHẤT chứ không từ danh sách tên, và chỉ mục trên BIỂU THỨC bị báo ra thay vì bỏ qua | `db/unique-oracle.int.test.ts` | T3 | 3 | ✅ ĐẠT |  |
| H15 | **Biên giới module của `packages/supplier`**: chỉ `index.ts` là cửa công khai; module mới thêm vào `src/` mặc định không với tới được từ ngoài; đường dẫn TƯƠNG ĐỐI xuyên gói cũng bị chặn; cộng danh sách trắng khoá TẬP EXPORT ở cửa | Họ quy tắc `g5-` của dependency-cruiser + `tests/architecture/barrel-exports.test.ts` | T0 | 4 | ✅ ĐẠT |  |
| H16 | **Mọi gói trong `packages/` có một họ quy tắc biên giới đóng `src/` với `index.ts` là cửa duy nhất** — suy từ TÍNH CHẤT (đọc thư mục thật + đọc cấu hình thật), không từ danh sách các gói được bảo vệ; danh sách MIỄN TRỪ là đóng, có lý do từng dòng, và **chỉ được co lại**; cộng ba probe chạy depcruise thật cho `packages/rfq` | `tests/architecture/bien-gioi-goi.test.ts` + họ quy tắc `g6-` + `tests/architecture/barrel-exports.test.ts` | T0 | 11 | ✅ ĐẠT |  |

## 3. Mã chưa phủ — **trạng thái đúng, không phải khoảng trống bị quên**

Mỗi mã dưới đây được **ghim** trong `tools/inv-matrix/src/danh-gia.ts`
(`MA_DUOC_PHEP_CHUA_PHU`). Danh sách này là **ràng buộc hai chiều**: một mã ngoài danh sách mà
chưa phủ làm CI **đỏ thật**, và một mã trong danh sách mà **đã được phủ** cũng làm CI đỏ, kèm
lời nhắc gỡ nó ra.

> **Bản trước của dòng này viết tiếp:** *"Nhờ chiều thứ hai, danh sách chỉ co lại — nó không
> bao giờ nở ra trong im lặng."* **Câu đó rộng hơn cơ chế, và đã được đo là sai.** Chiều thứ
> hai chỉ kích hoạt khi một mã **vừa có test vừa ở trong danh sách**, nên hai thay đổi bù trừ
> nhau trong cùng một PR đi lọt: xoá test của một mã *và* thêm mã đó vào danh sách cho cổng
> **xanh**; thêm một mã mới vào sổ đăng ký *và* vào danh sách cũng cho cổng **xanh**, danh sách
> nở ra một dòng. Giữ nguyên văn ở đây để đối chiếu, không xoá.

### 3.1 Mốc ghim — thứ THẬT SỰ giữ cho độ phủ chỉ đi lên

Chỗ trống câu trên để lại được lấp bằng **hai con số ghim** trong cùng file, đỏ khi lệch về
**bất kỳ chiều nào**:

- `MOC_GHIM.soPhuToiThieu = 30` — tử số của bảng §1. Tụt xuống là **hồi quy độ phủ**;
  lên thì phải **nâng mốc bằng tay**, thành một dòng có chữ ký trong diff.
- `MOC_GHIM.coDanhSachToiDa = 20` — số dòng của chính bảng dưới đây. Nở ra là **đỏ**.

Cộng thêm hai phép kiểm cùng họ: năm mã bắt buộc phải giữ ghi chú §4 (`MA_PHAI_CO_CO_HEP`),
và **mọi mệnh đề HỘI đang mang ô ✅ đều phải có ghi chú §4** — vế sau *dẫn xuất* từ chính câu
chữ ở sổ đăng ký, nên một mệnh đề hội mới của S1 tự rơi vào phạm vi ngay hôm nó được viết ra.

**Điều này vẫn KHÔNG đóng được:** một PR sửa mã, sửa danh sách, *và* sửa cả hai con số cùng
lúc vẫn xanh. Không phép đo nào chặn được điều đó. Khác biệt là lúc ấy nó là một **dòng phải
sửa, có tên, trong một file có chủ sở hữu** (`.github/CODEOWNERS`) — không phải một sự im lặng.

**Nguy hiểm không nằm ở chỗ các hàng này trống.** Nó đến khi ai đó **lấp chúng bằng nhãn thay vì
bằng lớp** — gắn `[INV-G2]` lên một test đo thứ khác. Chuyện đó đã xảy ra một lần: năm test mang
`[INV-G2]` thật ra đo quy tắc biên giới depcruise, và vòng fix 1 của Task 9 đã sửa nhãn về `[INV-H11]`.

| INV | Vì sao chưa phủ |
|---|---|
| **A1** | S1 — không có endpoint nào, và không có trường giá nào, trong 001–007. |
| **A2** | S1 — mã hoá phía trình duyệt (ADR-007) chưa có; `packages/crypto-keys/src/roundtrip.test.ts:31` tự ghi lý do KHÔNG gắn thẻ. |
| **A3** | S1 — bảng bid chưa tồn tại. |
| **A4** | S1 — bộ quét rò rỉ đòi OpenAPI và endpoint, cả hai chưa có. |
| **A5** | S1 — chưa có nhà cung cấp, lời mời, hay ID báo giá. |
| **A6** | S1 — chưa có báo giá để đếm. |
| **B1** | S1 — bảng `vendor_bid_versions` chưa tồn tại. |
| **B2** | S1 — biên nhận nộp thầu đòi RFQ, ciphertext báo giá và chữ ký hệ thống; không thứ nào có ở S0. |
| **B5** | S1/S6 — job kiểm tra ciphertext định kỳ chưa tồn tại. |
| **C1** | S1 — `deadline_at` và đường nộp thầu chưa tồn tại. |
| **C2** | S1 — Task 10 CỐ Ý bỏ thẻ `[INV-C2]`: chủ ngữ (RFQ, `deadline_at`, báo giá muộn) chưa có trong 001–007, nên test 'kind lạ chuyển sang FAILED chứ không treo' đo một tính chất THẬT của runner nhưng không đo C2. |
| **C3** | S1 — chưa có trạng thái RFQ nào để gác. |
| **C4** | S1 — chưa có deadline để rút ngắn hay gia hạn. |
| **C5** | S1 — khoá theo RFQ chưa tồn tại (xem G2). |
| **D2** | S1 — ngưỡng RFQ và luồng phê duyệt kép chưa tồn tại. |
| **D4** | S1 — Task 10 CỐ Ý bỏ thẻ `[INV-D4]`: D4 đòi cảnh báo *tức thì*, còn outbox là POLL và độ trễ của nó bị chặn dưới bởi `pollIntervalMs`; đường đúng là `NOTIFY`/`LISTEN` hoặc một đường đồng bộ. |
| **E4** | S1 — MST nay đã có (008) và mã RFQ nay đã có (009), nhưng E4 là một mệnh đề PHỦ ĐỊNH về ĐƯỜNG XÁC THỰC ('không bao giờ là credential'), và đường xác thực của người mua chưa có endpoint nào để đối kháng. Tầng test của nó là T5. Phần cưỡng chế được ĐÃ có: không hàm nào ở cửa `@trustprocure/supplier` hay `@trustprocure/invitation` nhận MST hay mã RFQ làm bằng chứng danh tính. |
| **E6** | S1 — VẪN chưa có URL nào. Magic link của S1.3 sinh ra một TOKEN, không sinh ra một URL: việc token đi vào đường dẫn, vào fragment, hay vào một form POST là quyết định của tầng HTTP, và `apps/` vẫn rỗng. Referrer-Policy cũng thuộc tầng đó. Đây là mã DUY NHẤT của nhóm E còn trống, và nó trống vì một lý do KIẾN TRÚC chứ không vì thiếu thời gian. |
| **G2** | S1 — khoá THEO RFQ đòi RFQ. `packages/crypto-keys/src/roundtrip.test.ts:47` tự ghi ra rằng nó CỐ Ý không gắn `[INV-G2]` vì lý do ấy. Trước vòng fix 1 của Task 9, năm test mang nhãn này thật ra đo quy tắc biên giới depcruise — nay là `[INV-H11]`. Cái S0 có là bọc khoá theo TỔ CHỨC có phiên bản, thứ nuôi G1/G3. |
| **G4** | CHƯA CÓ LỚP, không phải chưa có nhãn — `grep audit` trên `packages/crypto-keys/src/*.ts` trừ test = 0 hit. Hạ tầng ghi (`004_audit_chain_functions.sql`, nhóm B3) đã có; không một thao tác khoá nào GỌI nó. |

## 4. Mã đã phủ mà **bảo đảm thật hẹp hơn mệnh đề**

Một ô ✅ cạnh một mệnh đề rộng **là** một phát biểu rộng hơn thứ được đo, trừ khi phần chênh
được ghi ra. Đây là phần đó.

Những mệnh đề viết bằng **phép HỘI** được đánh dấu riêng ở cột *Ghi chú* (`mệnh đề HỘI n vế`),
vì chúng hỏng theo một cách khác: bộ sinh gom theo **nhãn** và **không hề biết** mệnh đề là
phép hội, nên một test đo **một** vế cũng thắp ✅ cho **cả** mệnh đề. Với những hàng đó, mục
dưới đây phải nói rõ **vế nào được đo** và **vế nào chưa có chủ ngữ**.

- **D1** — **MỆNH ĐỀ HỘI BỐN VẾ, VÀ PHÉP HỘI CHƯA TỪNG ĐƯỢC ĐO MỘT LẦN NÀO.** 17 test mang nhãn tách làm ĐÚNG HAI cụm rời nhau, đếm từ chính báo cáo `vitest --reporter=json`: **12** test ở `packages/identity/src/mfa.int.test.ts` chỉ đo vế **(2) MFA còn hiệu lực trong cửa sổ ngắn** qua `assertFreshMfa`; **5** test ở `packages/identity/src/rbac.int.test.ts` chỉ đo vế **(1) quyền hợp lệ** qua `hasPermission`. KHÔNG test nào đo hai vế cùng lúc, và không có một hàm nào hợp hai vế lại. Vế **(3) RFQ đã CLOSED** và vế **(4) cổng chính sách thông qua** KHÔNG CÓ MỘT DÒNG MÃ NÀO: `grep` toàn repo cho `rfqs`, `wrapped_private_key`, `policyGate` cho **0 hit**, và `git ls-files apps/` cho đúng `apps/.gitkeep`. Vế (3) **CHÍNH LÀ hàng `C3`** trong bảng này, và C3 là **⏳ CHƯA PHỦ** — hai hàng cách nhau tám dòng, một hàng ✅, một hàng ⏳, cùng nói về một điều. Cuối cùng, cả hai phép kiểm ĐÃ CÓ đều **chưa có người gọi sản phẩm**: `assertFreshMfa` và `requirePermission` chỉ xuất hiện ở barrel export, ở chú thích, và ở test — toàn bộ đường đời của `sessions` (phát token, tra token, đặt `mfa_verified_at`) chưa tồn tại. Ô ✅ này chứng minh *hai vế được đo RIÊNG RẼ trên hai phép kiểm chưa có ai gọi*; nó **không** chứng minh mệnh đề ở cột kế bên.

- **D5** — Được cưỡng chế cho đường đi **qua `requirePermission`**. Một lần từ chối ở tầng CSDL (RLS/GRANT) không sinh bản ghi nào, và một lần thử MFA thất bại **cố ý** không ghi sổ (ADR-008).

- **E2** — **"Kênh đã đăng ký" ở S1 là kênh do NGƯỜI MUA KHAI khi mời**, không phải kênh nhà cung cấp tự xác nhận (`supplier_contacts.phone`, do người mua nhập). Ô ✅ chứng minh: không có đường nào từ *có token* tới *có phiên* mà không đi qua một mã OTP đã đối chiếu, và OTP không bao giờ đi cùng kênh với magic link (trigger so hai kênh ở 010). Nó **không** chứng minh người nhận mã là đúng người — chống được *link bị chuyển tiếp*, không chống được *người mua khai sai số*. Xem ADR-015.

- **E3** — Sổ đăng ký định nghĩa E3 bằng **năm** vế. ~~Vế *giới hạn tần suất* **không có một dòng mã nào** trong toàn S0.~~ **[S1.3] Vế ấy nay CÓ LỚP — nhưng CHỈ trên đường OTP của LỜI MỜI** (`otp_rate_limits`, hai hạn mức với hai loại phản ứng, ADR-015 mục 5). **Đường TOTP của `packages/identity` VẪN KHÔNG CÓ giới hạn tần suất nào** — khoản nợ 1 thu hẹp lại, không đóng. Trần loạt đầu của vế *giới hạn số lần thử*: trên đường lời mời nó nay là một hằng số cấu hình thật (`FOR UPDATE` trên thách thức mới nhất), còn trên đường TOTP nó vẫn là độ đồng thời của kẻ tấn công.

- **E5** — Phiên khách ghi `verified_contact_id` — **NGƯỜI GIỮ KÊNH đã nhận OTP**, KHÔNG phải con người đang ngồi trước màn hình. Một người chuyển tiếp cả link LẪN mã OTP vừa đọc được cho đồng nghiệp thì hệ thống ghi nhận người giữ kênh, và không cơ chế nào trong S1 phân biệt được hai ca đó. Ô ✅ chứng minh *danh tính được ghi là danh tính đã qua OTP*, không chứng minh *danh tính đó là người đang thao tác*.

- **F1** — RLS + FORCE phủ mọi bảng tenant, `outbox_jobs` gồm cả. Hàng rào `assertTenantBound` ở tầng ứng dụng là lớp thứ hai và nó tự làm mù mình bằng DANH SÁCH TÊN ở hai chỗ đã đo: `NOBYPASSRLS` chỉ ghim đúng bốn tên role, và hàm plpgsql ngoài danh sách không được ghim.

- **G1** — **TÀI SẢN ĐƯỢC BẢO VỆ CHƯA TỒN TẠI.** 18 test đo **quy tắc biên giới** của dependency-cruiser cộng danh sách trắng barrel — đó là một lớp phòng ngừa THẬT, đã được chứng minh có răng bằng test đối kháng (Task 2 và Task 7 đều vô hiệu hoá quy tắc rồi chạy lại để lấy RED thật). Nhưng mệnh đề nói về `private key RFQ`, và ở S0 **không có private key RFQ nào**: `grep wrapped_private_key` toàn repo cho **0 hit**, `git ls-files apps/` cho đúng `apps/.gitkeep` nên **không có `apps/unseal-worker`**. Ô ✅ này chứng minh *cánh cửa đã khoá*; nó chưa chứng minh gì về căn phòng, vì căn phòng chưa được xây. Khoảng trống thứ hai, độc lập: bốn gói (`audit`, `tenancy`, `db`, `test-support`) CHƯA có danh sách trắng barrel, nên một symbol mọc ra ở mặt tiền của chúng không được canh bởi lớp nào.

### 4.1 B3 và B4 — phát biểu bàn giao, trích nguyên văn

Hai phát biểu dưới đây đã được hiệu chuẩn qua hai vòng fix ở Task 6 và được **chép lại nguyên
văn** từ sổ tay tiến trình, kể cả chính tả không dấu: chúng là bằng chứng, không phải văn bản
để viết lại cho đẹp. Đây là câu trả lời đúng khi kiểm toán viên hỏi *một chuỗi hash hợp lệ
chứng minh điều gì*.

```text
B3 BAO DAM: voi so cua mot to chuc MA PHIEN HIEN TAI DOC DUOC, verifyAuditChain() phat hien moi thao tac
  XOA, CHEN, CAT DUOI, va moi thao tac SUA tren cac truong di vao bam. Tien anh v2 phu DU 13 COT DU LIEU
  cong prev_hash (vao bam dang byte) va hash (dau ra) — KHONG con cot nao cua bang so nam ngoai phep bam.
  `checked` la SO HANG DOC DUOC DUOI RLS, khong phai so hang ton tai.
TRUOC app_api/app_unseal/injection: manh — nhung CONG VIEC DO TRIGGER VA REVOKE THEO COT CUA B4 LAM,
  khong phai chuoi hash.
TRUOC CHU SO HUU BANG KHONG-SUPERUSER: chuoi KHONG CO NEO NGOAI chung minh VE CO BAN LA KHONG GI CA.
  Do duoc: 11 cot du lieu bi sua theo kieu "tinh lai duoi" cho ok:true tu chuoi; CHI NEO NGOAI bat duoc.
  Chuoi tu no chi bat KE TAN CONG LUOI.
NEU VA CHI NEU co ExternalAnchor giu o noi role deploy KHONG GHI DUOC: chuoi con phat hien so bi
  THAY THE / DUNG LAI / LAM RONG — CHO TIEN TO TOI LAN XUAT CUOI.
MOT CHUOI HASH "HOP LE" CHUNG MINH GI CHO KIEM TOAN VIEN: rang cac hang HIEN DANG DOC DUOC, TINH TOI LAN
  XUAT NEO CUOI, LA DUNG NHUNG HANG DA TON TAI O THOI DIEM DO — VA CHI KHI kem mot ExternalAnchor xuat xu
  ngoai vung ghi cua role deploy. KHONG CO NEO, NO CHUNG MINH KHONG GI CA truoc mot chu so huu bang.
NO KHONG CHUNG MINH: (1) "moi su kien da xay ra deu co mat" — lop phong thu la DANH SACH TRANG TRIGGER
  trong hardening, KHONG phai chuoi; (2) moi thu SAU lan xuat neo cuoi — NHIP NEO CHINH LA CUA SO GIA MAO;
  (3) `source` cua ExternalAnchor la NHAN XUAT XU DO NGUOI GOI VIET, khong xac thuc, khong the xac thuc o S0.
  Lop KIEU chi mua duoc MOT dieu: duong tat "tu duc neo tu chinh so dang kiem" KHONG CON VIET DUOC MOT
  CACH TINH CO. O THI CHAY KHONG CO LOP NAO CHAN; (4) ARTEFACT NEO NGOAI HIEN KHONG TON TAI — CO CHE da co,
  ARTEFACT thi chua; audit_events, audit_chain_anchors VA schema_migrations DEU CUNG VUNG TIN CAY nen
  KHONG CAI NAO trong ba duoc dung lam goc tin cay; (5) TINH TOAN VEN CUA LUOC DO — (D5) la PHAT HIEN,
  KHONG NGAN CHAN; giua luc mot cot bi doi ten va lan migrate() ke, ben ghi TU CHON DUOC seq/prev_hash/hash.
```

```text
B4 BAO DAM: truoc app_api/app_unseal bi chiem, role dang nhap ung dung, SQL injection, va thanh vien
  pg_write_all_data — HANG DA NAM TRONG public.audit_events KHONG BI SUA, KHONG BI XOA, KHONG BI CAT DUOI.
  Lop A (trigger ENABLE ALWAYS) rang buoc ca chu so huu bang lan superuser TREN DUONG DML TRUC TIEP;
  lop B (ACL) la lop DUY NHAT con dung khi mot trigger bi tat; lop C dua trang thai ve dung hoac
  GAY ON AO o lan migrate() ke.
VONG 2 THEM DUNG BA THU, KHONG HON:
  (i) mot loi o BUOC 0/1/1b khong con giet luot sua => 004_*.sql LUON TOI DICH, tuc duong thoat QT1
      "va bang mot migration moi" nay la TINH CHAT cua CA LUOT SUA;
  (ii) viec lop C GO mot trigger/rule khoi so kiem toan khong con im lang => mac dinh-DONG tro thanh
      mot RANG BUOC BAN GIAO DOC DUOC thay vi mot cai bay;
  (iii) moi thong bao chan deploy nay NEU DUNG BANG NAO, O SCHEMA NAO.
B4 KHONG BAO DAM: "moi su kien da xay ra deu co mat trong bang", va "day van la cai so cu".
  Ba duong do duoc o 5ae8040, TAT CA deu MIGRATE OK va KHONG MOT WARNING NAO, deu trong tay
  CHU SO HUU BANG KHONG-SUPERUSER (tuc chinh role deploy):
    RENAME + CREATE TABLE (LIKE ... INCLUDING ALL) + dung lai RLS/policy/GRANT + DROP ban cu -> 4 hang -> 0
    SET SCHEMA -> sua -> tra ve -> 4 hang -> 2
    DROP ca hai + DELETE FROM schema_migrations WHERE version LIKE '003%' -> 003 chay lai, so RONG
  => GIOI HAN CAU TRUC, khong dong duoc o tang nay (can event trigger cap cum, doi SUPERUSER,
     hoac mot NEO NGOAI DATABASE).
```

## 5. Nhãn vế `[INV-XX(k)]` — cố ý **không** được tính là độ phủ

Lượt chạy này có **8 test** mang nhãn vế: `[INV-E3(3)]`, `[INV-E3(4)]`.

Chúng **không** được cộng vào ô *Số test* của mã gốc, và đó là một quyết định, không phải
một thiếu sót. E3 có **năm** vế; nếu nhãn vế được tính thì một mã có bốn vế có lớp và một vế
**không có một dòng mã nào** sẽ hiện ra y hệt một mã đã phủ trọn vẹn. Nới regex để mua một
con số đẹp chính là thứ quy tắc QT2 của dự án cấm.

## 6. Một ô ✅ chứng minh gì — và **không** chứng minh gì

**Chứng minh:** tồn tại ít nhất một test mang nhãn `[INV-<mã>]` trong tên, test đó **đã chạy**
trong lượt này (không bị bỏ qua) và **đã đạt**; và mã đó có mặt trong sổ đăng ký.

**Không chứng minh:**

1. **rằng test ấy đo đúng mệnh đề ở cột kế bên.** Bộ sinh gom theo **nhãn**, và nhãn do người
   viết đặt. Lớp phòng thủ duy nhất chống nhãn sai là đọc tên test — bộ sinh chỉ đóng được
   trường hợp nhãn trỏ vào một mã **không tồn tại**, và nó đóng chặt.
2. **rằng mệnh đề được phủ trọn vẹn.** Xem §4: một mệnh đề năm vế có thể ✅ với bốn vế (E3),
   và một mệnh đề **hội** bốn vế có thể ✅ khi chỉ hai vế được đo — **riêng rẽ, chưa từng
   cùng lúc** — còn hai vế kia không có một dòng mã nào (D1).
3. **rằng lớp cưỡng chế ở cột *Cưỡng chế* là thứ đang chặn.** Cột đó chép từ sổ đăng ký, không
   được bộ sinh kiểm chứng. Test chỉ **phát hiện**; cưỡng chế mới **ngăn chặn**.
4. **bất cứ điều gì về mã chưa phủ.** Một hàng ⏳ không nói sản phẩm sai — nó nói *chưa có bằng chứng*.

---

**Cách đo:** một bất biến được coi là phủ khi có ít nhất một test mang nhãn `[INV-<mã>]` **trần**
(không hậu tố vế) trong `fullName` của báo cáo `vitest --reporter=json`, và mọi test mang nhãn đó
đều đạt. Báo cáo phải đến từ `pnpm test:report`, chạy **cả hai tầng** (`vitest run`, không loại trừ
`*.int.test.ts`) — nếu chỉ chạy tầng đơn vị thì phần lớn B3/B4/D1/D3/F1 hiện là chưa phủ, một **đỏ giả**.
