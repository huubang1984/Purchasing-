# Phương án pilot giả lập — TrustProcure V2

> **Ngày:** 2026-09-26 · **Vòng:** S1.9101 · **Quyết định:** ADR-9201 · **Công cụ:** `tools/pilot-gia-lap` (`pnpm pilot:gia-lap`)
>
> **Phạm vi chủ dự án chọn ngày 2026-09-26:** tài liệu + công cụ; hai doanh nghiệp giả lập (Sản xuất + Xây dựng); chế độ
> nhanh, có thêm chế độ chậm; dữ liệu dùng cho CẢ kiểm tính năng LẪN trình diễn.

## 0. Một đoạn

Không đơn vị nào nhận pilot một sản phẩm chưa hoàn thiện, và mảnh 4 của `docs/PRODUCT.md` §11 (*khách hàng pilot*) vì thế
đứng yên từ 2026-08-27. Phương án này KHÔNG gỡ mảnh ấy. Nó làm ba việc trong lúc chờ:

1. **Kiểm tính năng trọn vòng.** Mọi bước của kịch bản §11 chạy trên một cụm đủ bốn tiến trình (`api`, `unseal-worker`,
   `web`, `public-keys`), bằng hai doanh nghiệp giả lập, mười một gói thầu, mười bốn người mua và mười hai nhà cung cấp.
   Mọi bước đi qua API thật: đăng nhập bằng link cộng TOTP, OTP của nhà cung cấp, niêm phong ở phía nhà cung cấp, mở thầu
   bốn vế, BAFO, trao thầu và bộ bằng chứng.
2. **Để lại dữ liệu demo.** Bốn gói được cố ý dừng ở trạng thái dở, để một người trình diễn đi tiếp trên màn hình trước
   mặt khách hàng tiềm năng.
3. **Hạ giá của chữ "đồng ý".** Mục 7 đặt một thang năm bậc, cam kết của khách tăng dần từ *ngồi xem một buổi* tới *pilot
   thật*, và mỗi bậc có điều kiện vào và điều kiện ra.

## 1. Ranh giới — thứ giả lập đo được, và thứ nó không bao giờ đo được

`docs/TIEN-DE-CHUA-DO.md` viết: *"Một pilot giả lập cho ra bằng chứng giả lập"*. Phương án này nhận câu ấy làm luật, và
nó được cưỡng chế ở bốn chỗ:

- **Báo cáo** mở đầu bằng nhãn `DỮ LIỆU GIẢ LẬP — KHÔNG PHẢI PILOT` và luôn có mục *"Điều báo cáo này KHÔNG chứng minh"*.
  Có test cho cả hai (`tools/pilot-gia-lap/src/bao-cao.test.ts`).
- **Dữ liệu** tự khai là bịa:
  - tên tổ chức mở đầu bằng `[GIẢ LẬP]`, tên nhà cung cấp bằng `[GL]`;
  - email thuộc tên miền `.invalid` (RFC 2606);
  - mã số thuế mở đầu bằng bảy chữ số 0;
  - địa chỉ IP của diễn viên thuộc dải tài liệu `2001:db8::/32` (RFC 3849).
- **Không lùi ngày.** Sổ kiểm toán ép `occurred_at := clock_timestamp()` (`004`), và `verifyAuditChain` không bắt được một
  hàng nghiệp vụ lùi ngày trái với sổ. Nên mọi dữ liệu sinh theo thời gian thật. Chế độ nhanh đóng gói sớm và có ghi lý do.
- **Không hiệu chỉnh.** Không tham số GIẢ ĐỊNH nào của spec S3 được gọi là *đã hiệu chỉnh* bằng số liệu này (spec S3 §8.3).

| Câu hỏi | Giả lập trả lời được? |
|---|---|
| Mỗi kiểm soát (D2, J3, A4, A6, cổng quyền, RLS) có bật khi bị thử sai không | **Có** — mục 3 |
| Bảng so sánh có đúng tới từng chữ số với thứ đã niêm phong không | **Có** — so từng gói, có đột biến chứng minh răng (mục 6) |
| Biên nhận có kiểm được bằng khoá công khai một mình không | **Có** |
| Bộ bằng chứng có tự đủ, kiểm được khi không có CSDL không | **Có** |
| Mỗi lần bị từ chối có để lại dấu kiểm toán không | **Có** — cột *Vào sổ* của báo cáo, và nó đã tìm ra khoản 9401 |
| Nhà cung cấp thật có chịu bấm link + OTP không; webview Zalo; tỷ lệ bỏ cuộc | **Không** |
| Ngưỡng một-con-số, dự toán trước khi mời, đủ người để tách vai có đúng với doanh nghiệp thật không | **Không** — chỉ đi được *đường mã* của B1, B2, B4 |
| Khách có chấp nhận khoá ở AWS KMS Singapore, TOTP thay SSO không | **Không** |

## 2. Hai doanh nghiệp giả lập

Hồ sơ nằm ở `tools/pilot-gia-lap/src/ho-so.ts`.

| Mã | Tổ chức | Ngành | Ngưỡng phê duyệt kép | BAFO |
|---|---|---|---|---|
| SX | [GIẢ LẬP] Công ty CP Cơ khí Chính xác Tân Phú Minh | Gia công cơ khí, chế tạo khuôn dập — ưu tiên số 1 của `PRODUCT.md` §10 | 500 triệu VND | top-2 |
| XD | [GIẢ LẬP] Công ty CP Xây dựng Hạ tầng Bắc Sơn | Nhà xưởng khu công nghiệp, hạ tầng thoát nước | 2 tỷ VND | top-3 |

Mỗi tổ chức có bảy người. Bảy là cỡ ĐỦ cho trọn danh mục — đã đo. Cỡ TỐI THIỂU thì chưa đo: công cụ chưa chạy hồ sơ nào
nhỏ hơn, nên `PRODUCT.md` §11 vẫn đúng khi ghi *"chưa đo"*. Người thứ bảy (BUYER) có mặt chủ yếu để thử một vai KHÔNG có
quyền xem giá.

| Vai | Người (SX / XD) | Làm gì trong danh mục |
|---|---|---|
| BUYER | Nhân viên mua hàng / Nhân viên cung ứng | Tạo gói, mời nhà cung cấp |
| PROCUREMENT_MANAGER ×3 | Trưởng phòng, Phó phòng, Chuyên viên (SX) / Kỹ sư vật tư (XD) | Duyệt gói (hai người khi vượt ngưỡng), mở, đóng, xin mở thầu, điều phối, chấm, BAFO, đề xuất trao thầu |
| DIRECTOR ×2 | Giám đốc, Phó giám đốc | Duyệt mở thầu (hai người khi vượt ngưỡng), duyệt trao thầu, xuất bằng chứng; ở SX-03 phó giám đốc đề xuất trao thầu rồi thử tự duyệt |
| FINANCE | Kế toán trưởng | Khai chính sách, duyệt hay huỷ trao thầu, xuất bằng chứng |

Mỗi tổ chức có sáu nhà cung cấp, mỗi nhà một người liên hệ báo giá; riêng một nhà ở XD có thêm người liên hệ thứ hai để
thử kịch bản mời nhầm người. Đơn giá thị trường là ước lượng 2026 của người viết, không phải báo giá thật. Đơn giá chào lấy
đơn giá thị trường nhân một hệ số phần nghìn, làm tròn tới 10 đồng. Mục 6 giải thích vì sao phải tròn 10 đồng mà không tròn
100 đồng.

## 3. Danh mục kịch bản

Danh mục nằm ở `tools/pilot-gia-lap/src/kich-ban.ts` và được viết bằng dữ liệu. `kiemDanhMuc` kiểm nó TRƯỚC khi chạy:
- mỗi bước giao cho một vai giữ đúng mã quyền;
- không vi phạm D2 hay J3 một cách vô ý;
- số chữ ký khớp ngưỡng;
- giá của các nhà cung cấp phân biệt được với nhau.

Test đột biến ở `kich-ban.test.ts` chứng minh bộ kiểm ấy có răng.

| Mã | Tổ chức | Gói | Minh hoạ chính | Dừng ở |
|---|---|---|---|---|
| SX-01 | SX | Thép tấm, thép tròn, bu lông, dây hàn | Đường chuẩn dưới ngưỡng; A6, A4; J3 với cả người tạo lẫn người điều phối; nhân viên không có quyền xem giá | trao thầu đã duyệt + bằng chứng |
| SX-02 | SX | Vật tư tiêu hao | Nhà cung cấp sửa giá hai lần (ba phiên bản); mở thầu chỉ giải mã bản cuối; giám đốc tự duyệt mở thầu ⇒ D2 | trao thầu đã duyệt + bằng chứng |
| SX-03 | SX | Gói lớn trên ngưỡng | Hai chữ ký; người tạo tự duyệt ⇒ D2; BAFO top-2; người ngoài top nộp ⇒ 422; phó giám đốc (giữ `po.approve`) tự duyệt đề xuất của mình ⇒ J3 vế 1 | trao thầu đã duyệt + bằng chứng |
| SX-04 | SX | Vòng bi, bu lông | Gói ĐANG MỞ, hai báo giá đã nộp, số báo giá bị giấu | **để lại**: hai lời mời chờ nộp trực tiếp |
| SX-05 | SX | Khí Argon, dây hàn | Huỷ gói có lý do; khoá công khai bị thu hồi; nộp bằng khoá cũ ⇒ bị từ chối | huỷ |
| SX-06 | SX | Đá mài, sơn lót | **Chế độ chậm**: đợi hạn nộp thật; nộp trễ ⇒ 422 (C1) và đúng một hàng `BID_DEADLINE_DENIED`; đóng sau hạn | trao thầu đã duyệt + bằng chứng |
| XD-01 | XD | Xi măng, thép | Gia hạn có lý do (mỗi nhà cung cấp một thông báo); huỷ trao thầu ⇒ về EVALUATING ⇒ trao lại hạng 2 | trao thầu đã duyệt + bằng chứng |
| XD-02 | XD | Cát, đá | Mời nhầm kế toán của nhà cung cấp ⇒ thu hồi; link đã thu hồi không mở được; mời lại đúng người | trao thầu đã duyệt + bằng chứng |
| XD-03 | XD | Bê tông M300 | Yêu cầu mở thầu có 1/2 chữ ký giám đốc | **để lại**: chờ chữ ký mở thầu thứ hai |
| XD-04 | XD | Cốp pha, giàn giáo | Đề xuất trao thầu chưa ai duyệt | **để lại**: chờ Tổng Giám đốc duyệt |
| XD-05 | XD | Ống HDPE | Gói trên ngưỡng có 1/2 chữ ký duyệt gói | **để lại**: chờ chữ ký duyệt gói thứ hai |

Ngoài các kịch bản trên, công cụ còn đo ba thứ ở mỗi lượt:
- **Chuẩn bị tổ chức:** trưởng phòng mua hàng tự khai chính sách ⇒ 403, vì `policy.manage` chỉ ở FINANCE.
- **Cô lập:** người của tổ chức này đọc thẳng id gói thầu hay nhà cung cấp của tổ chức kia ⇒ 404. Mỗi lần đọc chéo đi sau
  một đối chứng dương: người của chính tổ chức đọc cùng id ⇒ 200. Không có đối chứng thì một đường đọc hỏng cho mọi người
  cũng cho 404.
- **Vào sổ:** mỗi lần thử sai được đo xem có để lại hàng `audit_events` hay không, bằng số hàng trước và sau lần thử.

## 4. Cách chạy

**Cần:** Node 22, pnpm (`pnpm install`), và một **Postgres 16 cục bộ với một CSDL riêng**. Công cụ từ chối mọi máy chủ
không phải `localhost`/`127.0.0.1`/`::1`, và mọi URL mang tham số truy vấn (`?host=` của pg ghi đè máy chủ của URL), vì
nó chạy `migrate()`, đặt lại mật khẩu hai vai đăng nhập và thêm tổ chức. Cổng Docker ghim vào `127.0.0.1`: superuser
với mật khẩu viết trong tài liệu này không được nghe trên mạng của phòng trình diễn.

```powershell
# Windows PowerShell — Postgres trong Docker
docker run -d --name tp-pilot-gia-lap -e POSTGRES_PASSWORD=pilot-gia-lap -e POSTGRES_DB=pilot_gia_lap -p 127.0.0.1:55433:5432 postgres:16-alpine
do { Start-Sleep 1; docker exec tp-pilot-gia-lap pg_isready -h 127.0.0.1 -U postgres -d pilot_gia_lap } until ($LASTEXITCODE -eq 0)
$env:TRUSTPROCURE_SEED_DATABASE_URL = "postgres://postgres:pilot-gia-lap@127.0.0.1:55433/pilot_gia_lap"
pnpm pilot:gia-lap
```

```bash
# Linux/macOS
docker run -d --name tp-pilot-gia-lap -e POSTGRES_PASSWORD=pilot-gia-lap -e POSTGRES_DB=pilot_gia_lap -p 127.0.0.1:55433:5432 postgres:16-alpine
until docker exec tp-pilot-gia-lap pg_isready -h 127.0.0.1 -U postgres -d pilot_gia_lap; do sleep 1; done
export TRUSTPROCURE_SEED_DATABASE_URL=postgres://postgres:pilot-gia-lap@127.0.0.1:55433/pilot_gia_lap
pnpm pilot:gia-lap
```

Dòng `pg_isready` đợi Postgres nhận kết nối TCP: container mới chạy `initdb` và một máy chủ tạm chỉ nghe socket trong vài
giây đầu, và công cụ không thử lại lần nối đầu tiên. Hai khối lệnh này chưa được chạy nguyên văn — máy của vòng này không
có Docker, và các lượt đo dùng Postgres 16 cài thẳng.

Lệnh ấy làm trọn các bước sau, không một bước tay nào:
1. Sinh bí mật cụm: ba vòng khoá 32 byte đôi một khác nhau, khoá ký biên nhận P-256 và mật khẩu hai vai đăng nhập.
2. Chạy `migrate()` và đảm bảo hai vai đăng nhập.
3. Dựng `api`, `web`, `public-keys`, gieo hai tổ chức, rồi dựng `unseal-worker`. Worker phải lên SAU tổ chức đầu tiên
   (cạnh ❷ của ADR-040).
4. Chạy danh mục và ghi báo cáo.
5. **Giữ cụm chạy** cho buổi trình diễn, tới khi bấm Ctrl+C.

| Lệnh | Việc |
|---|---|
| `pnpm pilot:gia-lap --dung-sau` | Chạy danh mục rồi dừng cụm; mã thoát 0 khi mọi kịch bản và phép cô lập ĐẠT — dùng làm kiểm hồi quy. Phép cô lập chỉ chạy khi lượt dựng cả hai tổ chức; khi nó không chạy, báo cáo và dòng tổng kết nói ra |
| `pnpm pilot:gia-lap --cham` | Thêm SX-06: đợi hạn nộp thật (~65 phút). Phần trước và sau lúc đợi của SX-06 chạy một mình; các kịch bản nhanh chạy trong lúc nó đợi |
| `pnpm pilot:gia-lap --chi "SX-01,XD-02"` | Chỉ chạy một phần danh mục (gọi tên SX-06 thì phải kèm `--cham`). Viết danh sách trong nháy: PowerShell đọc `SX-01,XD-02` không nháy thành một mảng |
| `pnpm pilot:gia-lap cum` | Dựng lại cụm từ thư mục trạng thái (cùng CSDL), giữ chạy, và in các gói lượt mới nhất để lại kèm mã gói. Hạn nộp của gói để lại tính từ LƯỢT CHẠY — SX-04 hết nhận báo giá sau ba ngày — nên buổi trình diễn cách lượt chạy hơn hai ngày cần một lượt `pnpm pilot:gia-lap` mới, không phải `cum` |
| `pnpm pilot:gia-lap dang-nhap <email> [orgId]` | Link đăng nhập mới cho một người mua giả lập, kèm mã TOTP hiện tại và URI `otpauth://`; mặc định là tổ chức của lượt chạy mới nhất có email ấy |
| `pnpm pilot:gia-lap otp <số điện thoại>` | Mã OTP mới nhất gửi tới một nhà cung cấp giả lập |
| `pnpm pilot:gia-lap lien-ket` | Link mời còn chờ nộp của các gói để lại, đánh dấu lượt mới nhất |

**Thư mục trạng thái** mặc định là `.pilot-gia-lap/` ở gốc kho và nằm trong `.gitignore`. Quyền 0700 chỉ có trên POSIX:
trên Windows, Node bỏ qua bit quyền và thư mục thừa hưởng ACL của thư mục cha — nên để kho, hay `--thu-muc`, dưới hồ sơ
người dùng, không dưới một thư mục mà người dùng khác trên máy đọc được. `--thu-muc` trỏ vào
trong kho thì phải nằm dưới một thư mục tên `.pilot-gia-lap`; ngoài kho thì chỗ nào cũng được. Nó chứa:
- `cum.json`: bí mật cụm;
- `trang-thai.json`: bí mật TOTP của người mua giả lập và token lời mời, GỘP qua các lượt chạy (lượt mới nhất trước) —
  mỗi lượt dựng tổ chức mới, và người mua của lượt cũ chỉ đăng nhập lại được nhờ bí mật giữ ở đây;
- `hop-thu/`: hộp thư dev;
- `bao-cao/<thời điểm>/bao-cao.{md,json}` và `bao-cao-moi-nhat.md`: báo cáo, KHÔNG chứa token;
- `bang-chung/`: các bộ bằng chứng đã kiểm;
- `log/`: log bốn tiến trình.

**Một thư mục trạng thái đi với MỘT CSDL.** `api` từ chối khởi động khi vòng khoá lệch dấu kiểm đã ghi (khoản 165), và
công cụ tự chặn trường hợp ấy trước khi sinh bí mật mới.

**Trình diễn trên điện thoại thật cần HTTPS.** Cookie khách mang cờ `Secure` (ADR-044), nên cụm này chỉ nghe trên
127.0.0.1. Khi trình diễn, mở `/nop-thau` trên máy người trình diễn với khung hẹp; điện thoại thật là việc của một cụm có
TLS.

## 5. Kịch bản trình diễn — 20 phút với một khách hàng tiềm năng

Chạy `pnpm pilot:gia-lap` trước buổi gặp — cùng ngày hay hôm trước, vì hạn nộp của SX-04 tính từ lượt chạy. Cụm ở lại
cùng bốn gói dở; mã gói in ở cuối lượt chạy, và lệnh `cum` in lại. *Nạp gói* nghĩa là dán mã gói ở bước 2 của trang rồi
bấm **Đọc**. Không màn nào dưới đây cần gõ SQL.

| Phút | Màn | Làm gì | Thứ khách thấy |
|---|---|---|---|
| 0–2 | `bao-cao-moi-nhat.md` | Đọc nhãn GIẢ LẬP và mục 7 của báo cáo | Dự án nói thẳng đây không phải khách hàng thật |
| 2–7 | `/nop-thau` (khung hẹp) | `lien-ket` lấy link SX-04 → **Mở lời mời** → **Gửi mã** → `otp <số>` → **Xác minh** → nhập đơn giá → **Niêm phong và nộp** | Giá mã hoá ngay trong trình duyệt; biên nhận ký số hiện ra với `kid` và `ciphertext_sha256` |
| 7–9 | `/mo-thau` | `dang-nhap hung.nv@…` → vào bằng mã TOTP → nạp gói SX-04 | *"Số báo giá đang bị giấu"* — kể cả trưởng phòng cũng không thấy **số** báo giá trước khi đóng |
| 9–13 | `/mo-thau` bước 3–4 | Gói XD-03: TRƯỚC TIÊN người xin mở thầu bấm **Phê duyệt** ở bước 3 ⇒ bị chặn; rồi Phó Tổng Giám đốc bấm **Phê duyệt** — chữ ký thứ hai; người xin mở bấm **Điều phối giải mã**; bước 4 **Đọc bảng so sánh** | Lần tự duyệt bị cổng quyền chặn (403). Worker mở phong bì; bảng so sánh khớp tới từng đồng |
| 13–17 | `/mo-thau` bước 7–8 | Gói XD-04: TRƯỚC TIÊN người đề xuất bấm **Phê duyệt** ở bước 7 ⇒ bị chặn; rồi Tổng Giám đốc bấm **Phê duyệt**; bước 8 **Tải bộ bằng chứng**; chạy `pnpm bang-chung kiem --bo <thư mục>` | Lần tự duyệt bị cổng quyền chặn (403). Bộ bằng chứng kiểm được **không cần CSDL**, tức kiểm toán viên tự kiểm |
| 17–20 | Hỏi khách | Ba câu nặng nhất của `TIEN-DE-CHUA-DO.md`: B4 → A1 → B1 | Chuyển sang bậc 1–2 của mục 7 |

Lần tự duyệt phải đi TRƯỚC lần duyệt thật: sau khi đề xuất đã duyệt, trang `/mo-thau` chặn nút **Phê duyệt** ngay trên trình
duyệt, và lần thử không bao giờ tới sản phẩm.

## 6. Kết quả đo — lượt chạy ngày 2026-09-26

Chạy trên Postgres 16.13 cục bộ. Lượt đầu chạy trên bản của commit đầu của vòng. Lượt soi đối kháng năm lăng kính (biên
bản §S1.9101 mục 9) sửa công cụ, rồi lượt nhanh chạy lại trên bản đã sửa; bảng dưới là số của lượt sau.

| Chỉ số | Kết quả |
|---|---|
| Kịch bản chế độ nhanh | **10/10 ĐẠT**; 20 giây cho cả hai tổ chức |
| Bước người dùng qua API thật (LAM + CHAN) | 268, cộng 47 bước chuẩn bị tổ chức — 4 bước gieo bằng kết nối đặc quyền, 43 bước qua API |
| Phép kiểm của bộ giả lập trên dữ liệu trả về (KIEM) | 155 — nhiều phép không gọi mạng (chữ ký biên nhận, so bảng, bộ kiểm bằng chứng) |
| Lần thử sai bị chặn đúng | **16/16**; cô lập **2/2**, mỗi lần sau một đối chứng dương (**2/2**) |
| Biên nhận kiểm bằng khoá công khai từ `/.well-known/trustprocure-receipt-keys` | **35/35** |
| Bộ bằng chứng qua `pnpm bang-chung kiem` không CSDL | **5/5** |
| Lần từ chối để lại hàng sổ kiểm toán | **8/16** — xem phát hiện ⑴. Lượt đầu cho 9/16, vì J3 vế 1 khi ấy chưa được thử |
| Chế độ chậm (SX-06) | **1/1 ĐẠT** trên bản của commit đầu, 62 phút: nộp sau hạn ⇒ 422, sổ có đúng một hàng `BID_DEADLINE_DENIED`; đóng sau hạn, trao thầu cho giá thấp nhất trong hai báo giá đúng hạn. Lượt trên bản đã sửa đang chạy |
| Đi thử trên trình duyệt thật (Chromium, khung 375×812) | Nhà cung cấp mở link SX-04, OTP lấy bằng lệnh `otp`, niêm phong và nộp trong trình duyệt, nhận biên nhận `version=1 kid=k1`; người mua đăng nhập bằng `dang-nhap` + TOTP và thấy số báo giá bị giấu |

**Bộ giả lập có răng.** Ba đột biến trên mã sản phẩm, mỗi đột biến khôi phục ngay sau khi chạy:
- tắt lớp giấu số báo giá (`countReceivedBids`) ⇒ 4/10 **KHÔNG ĐẠT** (SX-01, SX-02, SX-04, XD-01 — bốn gói có phép kiểm ấy).
  Lượt đầu của đột biến này chỉ chạy `--chi SX-01` (0/1); con số 4/10 là của lượt chạy lại trên cả danh mục;
- làm tròn tổng của bảng so sánh tới nghìn đồng ⇒ 6/10 **KHÔNG ĐẠT**;
- cắt hàng xu ⇒ 2/10 **KHÔNG ĐẠT**.

**Phát hiện:**
1. **Tám lần từ chối không để lại hàng sổ hay dòng log nào**:
   - J3 ×4: người tạo gói, người điều phối, người kiêm cả hai tự đề xuất trao thầu; phó giám đốc giữ `po.approve` tự
     duyệt đề xuất của mình (vế 1 — lượt đầu chưa thử vế này);
   - D2 ×1: người tạo tự duyệt gói;
   - nộp ngoài top-N của BAFO;
   - nộp sau khi gói bị huỷ;
   - mở link đã thu hồi.

   J3 và D2 là tách bạch nhiệm vụ cưỡng chế bằng trigger, và `docs/PRODUCT.md` §5 từng khai cho J3 *"mỗi lần từ chối để
   lại một dòng"* — câu ấy đã được sửa tại chỗ. Hai lần nộp thuộc vế ghi sổ của ADR-060 theo cách ADR-074 đọc nó cho bước
   nộp. Bảy lần ấy là **khoản 9401** (rổ B). Lần mở link đã thu hồi là một lần xác thực token thất bại; ADR-060 không xếp
   lớp ấy, và nó chỉ được ghi ở biên bản.
2. **Đột biến *làm tròn nghìn* SỐNG SÓT ở lần chạy đầu.** Dữ liệu khi ấy toàn số tròn nghìn: đơn giá tròn 100 đồng, số
   lượng nguyên. Dữ liệu đã sửa: đơn giá tròn 10 đồng, và mỗi gói có một dòng số lượng lẻ tới hai chữ số thập phân. Một test
   (`kich-ban.test.ts`, *ĐỘ SẮC*) giữ tính chất ấy.
3. **Ba khiếm khuyết của chính công cụ, đo ra và sửa trong vòng:**
   - worker không lên trên CSDL chưa có tổ chức;
   - tín hiệu dừng gửi giữa lượt chạy để lại bốn tiến trình con mồ côi;
   - thư mục trạng thái mới trên một CSDL cũ làm `api` chết lúc khởi động.
4. **Lượt soi đối kháng năm lăng kính** (an ninh, đúng đắn, xanh giả, cổng CI, tài liệu) tìm thêm những chỗ công cụ nói
   nhiều hơn nó đo, hay hở ra ngoài phạm vi DEV — biên bản §S1.9101 mục 9 kê từng điểm và cách sửa.

## 7. Thang bậc tới pilot thật — trả lời thẳng cho "không ai nhận pilot"

Người ta từ chối pilot vì nó đòi *dữ liệu thật + nhà cung cấp thật + quy trình thật* cùng một lúc. Thang dưới tách ba thứ
ấy ra, mỗi bậc đòi thêm đúng một thứ.

| Bậc | Khách cam kết gì | Điều kiện vào | Đo được gì | Điều kiện ra |
|---|---|---|---|---|
| **0 — Giả lập** (xong ở vòng này) | Không gì | — | Tính năng chạy trọn; dữ liệu demo | Có một buổi gặp |
| **1 — Buổi đi thử có hướng dẫn** | 60 phút của một trưởng phòng mua hàng | Cụm giả lập chạy trên máy người trình diễn | Câu trả lời có TÊN và NGÀY cho B4, A1, B1 — chuyển vào `DECISIONS.md` đúng quy ước 2 của `TIEN-DE-CHUA-DO.md` | Khách đồng ý đưa 3–5 gói đã đóng |
| **2 — Pilot bóng** | 3–5 gói ĐÃ ĐÓNG của chính họ, đã ẩn tên nhà cung cấp, trong hai tuần | Thoả thuận bảo mật; dữ liệu chỉ ở máy dự án, xoá khi xong | Hình dạng mua sắm thật: số hạng mục, số nhà cung cấp, ngưỡng, số người — những thứ mã đang *đoán* | Khách thấy bảng so sánh và bộ bằng chứng trên chính gói của họ |
| **3 — Chạy song song** | Một gói THẬT mỗi tháng, song song với email/Excel đang dùng | **Mảnh 3 xong** (triển khai thật); người thứ hai của `tp-key-admin` (ADR-062) | Tỷ lệ nhà cung cấp mở link, bỏ ở bước OTP, trình duyệt — A1, A3, A4 | Quy trình thật chạy qua sản phẩm mà không ai của dự án can thiệp |
| **4 — Pilot** | Kịch bản §11 | Bậc 3 đạt | Mảnh 4 | MVP1 xong |

**Hai điều chưa có mã, nói ra:**
- Bậc 2 cần nhập gói từ một tệp của khách (CSV). Công cụ hôm nay chỉ chạy hồ sơ dựng sẵn.
- Dữ liệu của khách ở bậc 2 là **dữ liệu khách hàng thật**. Luật *"người thứ hai trước dữ liệu thật"* của ADR-062 nói về
  prod; áp nó cho một máy dev là việc chủ dự án phải quyết TRƯỚC buổi gặp bậc 2, không sau.

## 8. Giới hạn, nói thẳng

- Nhà cung cấp là một tiến trình Node niêm phong bằng CÙNG mã với trang `/nop-thau` (`sealBid`). Đó không phải một người
  trên điện thoại.
- Một máy, một CSDL, khoá local-dev, hộp thư dev. Mảnh 3 không đổi.
- Chế độ nhanh nén thời gian bằng cách đóng sớm. *Thời gian chu trình* trong báo cáo là thời gian máy.
- Kết nối đặc quyền vẫn gieo tổ chức, người dùng và vai, vì không có đường ứng dụng nào cho ba việc ấy — cùng lý do với
  `tools/gieo-demo` (ADR-044).
- Đơn giá là ước lượng của người viết. Con số *giá trị trao thầu trên dự toán* trong báo cáo nói về danh mục, không nói về
  thị trường.
- `tools/gieo-demo` giữ nguyên. Hai công cụ khác mục đích: `gieo-demo` gieo MỘT gói bằng SQL thô cho một lượt đi tay,
  còn công cụ này chạy danh mục qua API.

## 9. Việc tiếp theo — đề xuất, chưa làm

1. Chủ dự án chọn: có mở bậc 1 của mục 7 với một doanh nghiệp cụ thể không.
2. Nhập gói từ CSV cho bậc 2.
3. Khoản 9401: có đưa J3 (cả ba vế), D2 duyệt gói và hai lần từ chối nộp của nhà cung cấp qua lớp gói để lần từ chối vào
   sổ (khuôn `nemTuChoi`, hay savepoint như `BID_DEADLINE_DENIED` của ADR-074), hay giữ giới hạn và khai nó. Đây là một
   quyết định, không phải một lỗi đánh máy.
4. Một cụm TLS để trình diễn trên điện thoại thật.
