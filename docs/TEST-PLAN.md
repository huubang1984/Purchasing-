# TEST-PLAN — TrustProcure V2 (S0 + S1)

> Tài liệu sống. Sổ đăng ký bất biến nghiệp vụ và kiến trúc kiểm thử.
> Nguồn gốc thiết kế: `docs/superpowers/specs/2026-08-26-trustprocure-s0-s1-design.md`

---

## 1. Nguyên tắc

Hệ thống này **không** được kiểm chứng bằng tỷ lệ dòng code được phủ. Con số đó nói rất
ít về việc lời hứa cốt lõi của sản phẩm có còn đúng hay không.

Hệ thống được kiểm chứng bằng một tập **bất biến nghiệp vụ** — những mệnh đề phải luôn
đúng, mà nếu sai thì sản phẩm mất lý do tồn tại. Mỗi bất biến có mã, có tầng cưỡng chế,
và có ít nhất một test cố tình tấn công nó.

Ba quy tắc vận hành:

1. **Thêm tính năng chạm vào một nhóm bất biến ⇒ phải bổ sung test đối kháng cho nhóm đó.**
2. **Bất biến không có test phủ ⇒ CI đỏ — trừ khi mã đó nằm trong một DANH SÁCH ĐƯỢC GHIM,
   kèm lý do đọc được.** Câu cũ ở đây là *"không có ngoại lệ tạm thời"*, và tới cuối S0 nó
   RỘNG HƠN thứ hệ thống làm: 23 trong 47 mã chưa phủ vì chủ ngữ của chúng (RFQ, phong bì
   niêm phong, luồng mở thầu) thuộc S1. Một quy tắc mà thực tế vi phạm 23 lần không phải một
   quy tắc; nó là một dòng chữ. Cách diễn đạt hiện tại giữ nguyên độ chặt và bỏ chỗ cho sự
   mơ hồ: danh sách nằm ở `MA_DUOC_PHEP_CHUA_PHU` trong `tools/inv-matrix/src/danh-gia.ts`,
   nó là **ràng buộc hai chiều** (một mã trong danh sách mà ĐÃ được phủ cũng làm CI đỏ, kèm
   lời nhắc gỡ ra), nên nó chỉ co lại. Thêm một mã vào đó là một thay đổi mã nguồn, đi qua
   review — khác hẳn một `continue-on-error` không ai nhìn thấy.
3. **Không bao giờ nới lỏng một assertion để test xanh.** Nếu test sai thì nói rõ tại sao
   và sửa test; nếu bất biến sai thì sửa bất biến ở đây trước, kèm lý do.

---

## 2. Sổ đăng ký bất biến

Cột **Cưỡng chế** cho biết lớp nào thực sự chặn hành vi sai — quan trọng hơn cột test,
vì test chỉ phát hiện, còn cưỡng chế mới ngăn chặn.

### Nhóm A — Bí mật giá

| ID | Bất biến | Cưỡng chế | Tầng test |
|---|---|---|---|
| **A1** | Với RFQ chưa UNSEALED, không endpoint nào trả về trường giá cho bất kỳ actor nội bộ nào | Kiến trúc: không có khóa giải mã trong `api` | T2, T5 |
| **A2** | Giá dạng rõ không tồn tại trong `api` service tại bất kỳ thời điểm nào — kể cả bộ nhớ, log, APM trace, thông báo lỗi | Kiến trúc: mã hóa ở trình duyệt (ADR-007) | T1, T5 |
| **A3** | Truy vấn SQL trực tiếp vào bảng bid, kể cả bằng role quản trị, chỉ cho ra ciphertext | Lược đồ: cột chỉ chứa ciphertext | T3 |
| **A4** | Không trường phái sinh nào rò rỉ giá trước mở thầu: không min/max/trung bình, không "số NCC dưới ngân sách", không sắp xếp theo giá, không nhãn "giá tốt nhất", không biểu đồ | Bộ quét rò rỉ tự động | **T2** |
| **A5** | Nhà cung cấp không biết được danh tính, sự tồn tại, số lượng hay giá của nhà cung cấp khác — kể cả gián tiếp qua ID tuần tự, số thứ tự, hay thời gian phản hồi | Ứng dụng + ID không tuần tự | T2, T5, T6 |
| **A6** | Số báo giá đã nhận cũng là thông tin nhạy cảm; ẩn khỏi Buyer trước CLOSED khi chính sách bật chế độ nghiêm | Ứng dụng | T2, T5 |

> **A4 là bất biến rủi ro nhất.** Nó không bị vi phạm bởi tấn công mà bởi thiện chí — một
> lập trình viên thêm nhãn "đã có 3/5 báo giá, thấp nhất dưới ngân sách" vì nghĩ đang giúp
> người dùng. Vì vậy nó được cưỡng chế bằng máy quét, không bằng review thủ công.

### Nhóm B — Bất biến & toàn vẹn

| ID | Bất biến | Cưỡng chế | Tầng test |
|---|---|---|---|
| **B1** | Mỗi lần nộp tạo version mới; không UPDATE, không DELETE | DB trigger | T3, T5 |
| **B2** | Mỗi lần nộp sinh biên nhận: `sha256(ciphertext)` + thời gian DB + số version + mã RFQ, có chữ ký hệ thống; nhà cung cấp kiểm chứng độc lập được | Ứng dụng + chữ ký | T1, T3, T4 |
| **B3** | `audit_events` là chuỗi hash; bộ kiểm chứng phát hiện được chèn, sửa, xóa, và **cắt đuôi** | Lược đồ + bộ kiểm chứng | **T1**, T3 |
| **B4** | Không đường code nào xóa/sửa audit; role ứng dụng bị REVOKE UPDATE, DELETE | Quyền DB | T3, T5 |
| **B5** | Ciphertext lưu trữ luôn khớp hash trong biên nhận tại mọi thời điểm về sau | Job kiểm tra định kỳ | T3, T6 |

### Nhóm C — Thời gian

| ID | Bất biến | Cưỡng chế | Tầng test |
|---|---|---|---|
| **C1** | Sau `deadline_at` mọi lần nộp bị từ chối; phán quyết dựa trên `now()` của Postgres trong chính transaction ghi | Ràng buộc trong transaction | **T3**, T5 |
| **C2** | Tính đúng đắn không phụ thuộc scheduler — job đóng RFQ chết không làm bid muộn được chấp nhận | Kiến trúc (ADR-005) | T3, T6 |
| **C3** | Mở thầu chỉ hợp lệ khi RFQ đã CLOSED | Cổng chính sách trong `unseal-worker` | T1, T5 |
| **C4** | Không rút ngắn deadline sau khi đã có báo giá; gia hạn chỉ khi đang OPEN, có lý do, có audit, có thông báo toàn bộ nhà cung cấp đã mời | Ứng dụng + audit | T1, T3 |
| **C5** | Cặp khóa RFQ chỉ sinh đúng lúc chuyển sang OPEN | Máy trạng thái | T1, T3 |

### Nhóm D — Thẩm quyền & phân tách nhiệm vụ

| ID | Bất biến | Cưỡng chế | Tầng test |
|---|---|---|---|
| **D1** | Mở thầu cần đồng thời: quyền hợp lệ **và** MFA còn hiệu lực trong cửa sổ ngắn **và** RFQ đã CLOSED **và** cổng chính sách thông qua | Cổng chính sách | T1, T5 |
| **D2** | RFQ vượt ngưỡng cần 2 phê duyệt từ 2 người khác nhau, 2 phiên khác nhau; người tạo yêu cầu không được là một trong hai | Cổng chính sách + ràng buộc DB | **T3**, T5 |
| **D3** | Chuỗi tạo RFQ → chọn nhà cung cấp → mở thầu → award → duyệt không nằm trọn trong tay một người (ma trận mục 25) | Policy engine | T1, T5 |
| **D4** | Break-glass đi đường riêng, bắt buộc lý do, sinh cảnh báo mức cao tức thì, không bao giờ im lặng | Ứng dụng + audit + thông báo | T1, T4 |
| **D5** | Lần từ chối vì thiếu quyền cũng phải audit — không chỉ audit lần thành công | Ứng dụng | T3, T5 |

### Nhóm E — Danh tính nhà cung cấp & Magic Link

| ID | Bất biến | Cưỡng chế | Tầng test |
|---|---|---|---|
| **E1** | Token ≥ 128 bit entropy từ CSPRNG, lưu dạng hash, đơn mục đích, có hạn, thu hồi được | Ứng dụng + lược đồ | **T1**, T3 |
| **E2** | Token một mình không đủ vào phiên báo giá — luôn phải qua OTP trên kênh đã đăng ký | Ứng dụng | T4, T5 |
| **E3** | OTP: giới hạn số lần thử, giới hạn tần suất, hết hạn, dùng một lần, so sánh chống tấn công thời gian | Ứng dụng | T1, T5 |
| **E4** | MST hay mã RFQ không bao giờ là credential | Thiết kế | T5 |
| **E5** | Link chuyển tiếp vẫn dùng được, nhưng người nhận phải qua OTP; hệ thống ghi danh tính **thực tế đã xác thực**, không phải danh tính người được mời | Ứng dụng + audit | T4, T5 |
| **E6** | Không dữ liệu nhạy cảm nào nằm trong URL — kể cả rò qua header `Referer` | Thiết kế URL + Referrer-Policy | T2, T4 |

### Nhóm F — Cô lập tổ chức

| ID | Bất biến | Cưỡng chế | Tầng test |
|---|---|---|---|
| **F1** | Mọi truy vấn bị ràng buộc `org_id` ở tầng DB qua RLS, không chỉ tầng ứng dụng | **Postgres RLS** | **T3**, T5 |
| **F2** | Không IDOR — và quyền truy cập không bao giờ dựa vào việc ID khó đoán | Kiểm tra quyền tường minh | T2, T5 |
| **F3** | Khóa của tổ chức A không giải mã được dữ liệu tổ chức B | Phân cấp khóa theo tổ chức | T1, T3 |

### Nhóm G — Vòng đời khóa

| ID | Bất biến | Cưỡng chế | Tầng test |
|---|---|---|---|
| **G1** | Private key RFQ không bao giờ ở dạng rõ ngoài `unseal-worker` — không vào DB, log, biến môi trường, core dump | IAM + quyền cột DB | **T0**, T3, T5 |
| **G2** | Mỗi RFQ một cặp khóa; lộ một RFQ không lan sang RFQ khác | Thiết kế khóa | T1, T3 |
| **G3** | Xoay master key không làm mất khả năng giải mã báo giá cũ | Bọc khóa có phiên bản | T3, T6 |
| **G4** | Mọi thao tác khóa — sinh, bọc, mở bọc, hủy — đều sinh audit | Ứng dụng | T3, T5 |

**Tổng: 34 bất biến nghiệp vụ (nhóm A–G).** Cộng thêm 13 bất biến hàng rào (nhóm H, §5) là 47 mã cùng chảy vào `evidence/INV-matrix.md`.

---

## 3. Bảy tầng kiểm thử

| Tầng | Nội dung | Công cụ | Chạy khi | Chặn merge |
|---|---|---|---|---|
| **T0** | Cổng tĩnh: typecheck, lint, quét bí mật, audit phụ thuộc, kiểm tra ranh giới module | tsc, eslint, gitleaks, osv-scanner, dependency-cruiser | Mọi commit | Có |
| **T1** | Unit & property-based | Vitest, fast-check | Mọi commit | Có |
| **T2** | Contract/API + bộ quét rò rỉ | OpenAPI, Vitest | Mọi commit | Có |
| **T3** | Integration với Postgres thật | Testcontainers, Vitest | Mọi PR | Có |
| **T4** | E2E trên trình duyệt thật | Playwright | Mọi PR | Có |
| **T5** | Bộ test đối kháng | Vitest + Playwright | Mọi PR | Có |
| **T6** | Phi chức năng | k6, kịch bản DR | Hằng đêm | Không (cảnh báo) |

### T0 — Cổng tĩnh

Ngoài các cổng thông thường, có hai quy tắc kiến trúc chạy như lint:

- **Cấm `apps/api/**` import client giải mã của KMS.** Vi phạm ⇒ CI đỏ ngay tại commit,
  trước cả khi có người review. Đây là cơ chế bảo vệ **G1** và là ranh giới bảo mật quan
  trọng nhất của hệ thống.
- **Cấm import xuyên module không qua `index.ts`.** Giữ ranh giới 11 module thật sự có ý
  nghĩa thay vì chỉ là quy ước thư mục.

### T1 — Unit & property-based

| Đối tượng | Tính chất kiểm tra |
|---|---|
| Mật mã | Mã hóa → giải mã trả về nguyên bản; ciphertext không chứa chuỗi con của bản rõ; đổi một bit ciphertext làm giải mã thất bại (AEAD) |
| Sinh token | Phân phối entropy; không trùng trong 10⁶ mẫu; luôn ≥ 128 bit |
| Chuỗi hash audit | Chèn, sửa, xóa, **cắt đuôi** đều bị bộ kiểm chứng phát hiện |
| Policy engine | Vét cạn bảng quyết định: mọi tổ hợp vai trò × trạng thái × ngưỡng |
| Máy trạng thái RFQ | Vét cạn ma trận N×N: mọi chuyển hợp lệ thành công, mọi chuyển bất hợp lệ bị chặn |

### T2 — Contract/API và bộ quét rò rỉ

OpenAPI là nguồn sự thật; lệch giữa mã và lược đồ làm CI đỏ.

**Bộ quét rò rỉ** hoạt động như sau:

```text
1. Gieo dữ liệu với giá trị dễ nhận: 1234567891, 9876543219, ...
2. Với mỗi endpoint trong OpenAPI:
     gọi dưới danh nghĩa Buyer, Requester, Technical
     với RFQ ở mọi trạng thái TRƯỚC UNSEALED
3. Quét toàn bộ phản hồi — JSON lồng nhau, chuỗi, CSV xuất ra, payload webhook
4. Tìm thấy bất kỳ giá trị gieo nào ⇒ FAIL, in rõ endpoint và đường dẫn tới trường
```

Ưu điểm quyết định: **endpoint mới tự động nằm trong phạm vi quét.** Không phụ thuộc vào
việc lập trình viên nhớ viết test cho A1/A4.

### T3 — Integration với Postgres thật

Chạy trên Postgres thật qua Testcontainers, không dùng bản giả lập:

- Kết nối bằng role ứng dụng với `app.org_id` khác ⇒ trả về 0 hàng (F1)
- UPDATE/DELETE trên `vendor_bid_versions` và `audit_events` ⇒ ném lỗi (B1, B4)
- `app_api` SELECT `wrapped_private_key` ⇒ lỗi quyền (G1)
- N transaction đồng thời tại `deadline − 100ms` và `deadline + 100ms` ⇒ kết quả xác định (C1)
- Outbox: giao ít nhất một lần, xử lý bất biến theo idempotency key

### T4 — E2E trên trình duyệt thật

- Kịch bản mục 41: RFQ 1 tỷ, 5 nhà cung cấp, có sửa giá, đóng thầu, mở thầu, so sánh
- Kịch bản nhà cung cấp khách: nhận link → OTP → nộp → nhận biên nhận
- Kịch bản phê duyệt kép cho RFQ vượt ngưỡng
- Chạy trên trình duyệt thật để xác nhận WebCrypto hoạt động (rủi ro §8.2 của spec)

### T5 — Bộ test đối kháng

Mỗi mục là một cuộc tấn công, không phải kiểm tra tính năng chạy đúng.

| # | Tấn công | Bất biến bảo vệ |
|---|---|---|
| 1 | Buyer gọi thẳng API chi tiết báo giá trước mở thầu | A1 |
| 2 | Buyer tìm giá trong endpoint xuất dữ liệu, báo cáo, payload webhook | A1, A4 |
| 3 | Nộp báo giá với dấu thời gian trình duyệt bị giả | C1 |
| 4 | Nộp báo giá 50ms sau deadline qua retry, replay, và HTTP/2 multiplexing | C1 |
| 5 | Mở thầu khi RFQ còn OPEN | C3 |
| 6 | Hai phê duyệt kép từ cùng một người qua hai phiên | D2 |
| 7 | Sửa `audit_events` bằng SQL trực tiếp với role ứng dụng | B4 |
| 8 | Cắt đuôi chuỗi audit rồi chạy bộ kiểm chứng | B3 |
| 9 | Dùng lại magic link đã dùng, đã hết hạn, hoặc của RFQ khác | E1 |
| 10 | Vét cạn OTP | E3 |
| 11 | Truy cập RFQ của tổ chức khác bằng ID hợp lệ | F1, F2 |
| 12 | Đọc `wrapped_private_key` từ `api` service | G1 |
| 13 | Đo thời gian phản hồi để suy ra RFQ đã có báo giá hay chưa | A5 |
| 14 | Dùng MST hoặc mã RFQ làm credential | E4 |
| 15 | Suy ra danh tính nhà cung cấp khác qua ID tuần tự hoặc số thứ tự | A5 |

### T6 — Phi chức năng

- **Tải quanh deadline:** 200 nhà cung cấp nộp trong 60 giây cuối
- **Lệch đồng hồ:** máy chủ ứng dụng lệch ±5 phút so với DB ⇒ hành vi vẫn đúng (C2)
- **Khôi phục thảm họa:** khôi phục DB từ bản sao lưu ⇒ chuỗi audit vẫn kiểm chứng được;
  quy trình xử lý khi mất khóa KMS
- **Hiệu năng mở thầu:** RFQ 50 nhà cung cấp × 200 hạng mục — đo thời gian và chi phí KMS

---

## 4. Evidence Pack

Mỗi lần CI chạy sinh `evidence/INV-matrix.md` bằng `pnpm evidence` (Task 11,
`tools/inv-matrix`). Bộ sinh đọc **chính bảng §2 và §5 của file này** làm nguồn sự thật duy
nhất, rồi đối chiếu với nhãn `[INV-<mã>]` trong tên test của báo cáo `vitest --reporter=json`.

Hai file, hai bản chất — và sự tách đôi này là điều kiện để phép kiểm chống-sửa-tay tồn tại:

| File | Tính chất | Vào git? |
|---|---|---|
| `evidence/INV-matrix.md` | **Tất định** — không SHA, không dấu thời gian | **Có.** Lịch sử của nó là bằng chứng theo thời gian |
| `evidence/run-metadata.md` | Xuất xứ một lượt chạy: commit SHA, thời điểm, tổng số khẳng định | Không. Tải lên như artefact CI |

Nếu ma trận mang dấu thời gian thì nó đổi mỗi lần chạy, và bước CI *"ma trận đã commit phải
khớp bộ sinh"* (`git diff --exit-code` sau khi sinh lại) là bất khả — trong khi `.gitignore`
lại GIỮ file này, nên một lần sửa tay sẽ không lớp nào bắt.

Bộ sinh làm CI đỏ khi: một mã chưa phủ mà **không** nằm trong danh sách được ghim ở §1 quy tắc
2; một mã trong danh sách mà **đã** được phủ; một test mang nhãn bất biến đang đỏ hoặc bị bỏ
qua; một nhãn `[INV-…]` trỏ tới mã **không có trong sổ đăng ký này**; hoặc số hàng đọc được từ
§2/§5 **lệch với một phép đếm độc lập** — hàng biến mất trong im lặng là fail-open ở đúng nơi
không được phép fail-open.

Nhãn dạng `[INV-E3(3)]` (chỉ MỘT VẾ của một bất biến nhiều vế) **cố ý không** được tính là độ
phủ của `E3`: E3 có năm vế và vế *giới hạn tần suất* không có một dòng mã nào trong toàn S0.

Đây vừa là kỷ luật kỹ thuật vừa là tài sản thương mại: khi kiểm toán viên của khách hàng
hỏi *"làm sao chứng minh nhân viên mua hàng không xem được giá trước giờ mở?"*, câu trả
lời là bảng này kèm lịch sử chạy, thay vì một lời hứa.

---

## 5. Kiểm thử chính hàng rào Vibe Coding

Hai hook của `ai-eng-os` cũng là mã cần kiểm chứng, không phải cấu hình được tin tưởng
mặc nhiên. Chúng đã từng fail-open trên máy phát triển (spec §8.1).

Hàng rào cũng là một biện pháp kiểm soát, nên nó cũng có mã và cũng nằm trong evidence
pack. Nhóm **H** dùng chung cơ chế với 34 bất biến nghiệp vụ: test phải mang mã trong tên
theo dạng `[INV-H1]`, và mã không có test phủ sẽ làm CI đỏ.

Nhóm H KHÔNG chỉ là hai hook: **mọi hàng rào tự động của dự án đều thuộc nhóm này**, kể cả
các quy tắc biên giới module của dependency-cruiser (H11, H12, H13). Tiêu chí phân nhóm là "cái
này canh CÁI GÌ": một bất biến nghiệp vụ (A–G) nói về hành vi của sản phẩm với dữ liệu của
khách hàng; một bất biến hàng rào (H) nói về việc một biện pháp kiểm soát của chính dự án có
còn răng hay không.

| ID | Bất biến | Cưỡng chế | Tầng test |
|---|---|---|---|
| **H1** | `git reset --hard` bị chặn với mã thoát 2 | Hook `git-safety` | T1 |
| **H2** | `git clean -f*` bị chặn | Hook `git-safety` | T1 |
| **H3** | Đẩy ép buộc (`--force`, `-f`, `--force-with-lease`, cờ ngắn gộp) bị chặn | Hook `git-safety` | T1 |
| **H4** | Lệnh xoá bỏ thay đổi cục bộ (`checkout -- .`, `restore .`) bị chặn | Hook `git-safety` | T1 |
| **H5** | Lệnh viết lại lịch sử (`branch -D`, `filter-branch`, `stash clear/drop`, `reflog expire`, `update-ref -d`) bị chặn | Hook `git-safety` | T1 |
| **H6** | **Không lời gọi git phá huỷ nào lọt qua bất kể toán tử shell, chuyển hướng, hay tuỳ chọn toàn cục xen giữa** (`git -C <dir>`, `git -c k=v`, `git --no-pager`, cờ bị bọc nháy, `2>&1`/`&>`/`>&2`, ...) — hook dò tín hiệu phá huỷ trên toàn bộ token của dòng lệnh, thiên về chặn, không dựa vào việc xác định đúng ranh giới lời gọi hay vị trí subcommand | Hook `git-safety` | T1 |
| **H7** | Lệnh git vô hại được cho qua — hàng rào không được cản trở công việc bình thường | Hook `git-safety` | T1 |
| **H8** | Ghi vào file bí mật bị chặn, **không phân biệt hoa thường**: `.env`, `.pem`, `.key`, `.p12`, `.pfx`, `.jks`, `.keystore`, `id_rsa`, `id_ed25519`, `credentials.json`, `secrets.y*ml`, `.npmrc`, `.pgpass`, `.netrc`, `.claude/settings*.json` | Hook `protect-secrets` | T1 |
| **H9** | File nguồn thường và `.env.example` được cho qua — khớp theo tên và phần mở rộng, không khớp chuỗi con | Hook `protect-secrets` | T1 |
| **H10** | **Đầu vào rỗng, JSON hỏng, thiếu trường, sai kiểu, hoặc thiếu phụ thuộc runtime đều CHẶN** — fail-closed | Cả hai hook | T1 |
| **H11** | **Biên giới module của `packages/identity`**: chỉ `index.ts` là cửa công khai; module mới thêm vào `src/` mặc định không với tới được từ ngoài; đường dẫn TƯƠNG ĐỐI xuyên gói cũng bị chặn; không miễn trừ nào được phép mà không đồng thời là đích hạn chế | Họ quy tắc `g2-` của dependency-cruiser | **T0** |
| **H12** | **`packages/identity` KHÔNG có một cạnh phụ thuộc nào tới `packages/crypto-keys`** — cả đường BỌC lẫn đường MỞ, và họ quy tắc này không có bậc tự do nào (không `from.pathNot`, không `to.pathNot`) | Quy tắc `g3-` của dependency-cruiser | **T0** |
| **H13** | **Biên giới module của `packages/outbox`**: chỉ `index.ts` là cửa công khai; module mới thêm vào `src/` mặc định không với tới được từ ngoài; đường dẫn TƯƠNG ĐỐI xuyên gói cũng bị chặn; họ quy tắc không có miễn trừ `from` nào | Họ quy tắc `g4-` của dependency-cruiser | **T0** |

**H13 được bổ sung ngày 2026-08-29** (vòng fix 1 của Task 10), và lý do là TẦN SUẤT LẶP LẠI
chứ không phải một năng lực đang bị hở: đây là LẦN THỨ BA cùng một lớp lỗ (crypto-keys → `g1-`,
identity → `g2-`/H11, nay outbox → `g4-`). Phép đo, tái lập được ở worktree review: một file
`packages/audit/src/zz-probe-outbox-leak.ts` với `import "../../outbox/src/runner.js"` đi lọt
CẢ BA cổng — `depcruise` 0 vi phạm, `tsc` exit 0, `eslint` exit 0 — trong khi bản bare
specifier bị chặn ở cả hai lớp. Danh sách trắng barrel khoá DANH SÁCH export Ở CỬA; nó không
dựng BỨC TƯỜNG, nên nó không thay thế được hàng rào này.
Hai con số ở §2 (12 → 13 và 46 → 47) ĐƯỢC SỬA CÙNG LÚC ở đây. Việc HOÀ GIẢI hai cách đếm
("34 vs 46", nay "34 vs 47") vẫn là việc của Task 11 và KHÔNG được làm ở đây — sửa cho hai con
số ĐÚNG với thực tế là một việc khác hẳn với việc chọn cách đếm.

**H11 và H12 được bổ sung ngày 2026-08-28** (vòng fix 1 của Task 9), và lý do là một lớp
khiếm khuyết chứ không phải một chỗ trống: `tests/architecture/boundaries.test.ts` đang gán
`[INV-G2]` cho năm test và `[INV-G3]` cho bốn test đo QUY TẮC BIÊN GIỚI MODULE — trong khi sổ
đăng ký §2 định nghĩa G2 = "mỗi RFQ một cặp khoá" và G3 = "xoay master key không làm mất khả
năng giải mã báo giá cũ". Bộ sinh ma trận gom theo MÃ, nên chín dòng "passed" sẽ rơi vào hai
hàng nghiệp vụ mà chúng không đo — và vì test G2/G3 đúng nghĩa VẪN tồn tại song song, va chạm
đó là vô hình nếu không đọc tên. Đây là "mốc chết giả đã dịch chỗ: nó không còn ở TEST, nó ở
NHÃN". Một quy tắc biên giới depcruise LÀ một hàng rào, đúng hạng với hai hook ở trên, nên nó
thuộc nhóm H — và nhóm H đã khớp sẵn regex `[A-H]\d+` của bộ sinh, không cần đụng bộ sinh.
Mười test `[INV-G1]` trong cùng file thì GIỮ NGUYÊN: quy tắc `g1-` cưỡng chế đúng bất biến G1
("private key RFQ không bao giờ ở dạng rõ ngoài `unseal-worker`"), tức ở đó nhãn khớp thứ được
đo. Tên các quy tắc depcruise (`g1-`/`g2-`/`g3-`) không đổi — vấn đề nằm ở nhãn test.

**H10 là bài học rút ra từ sự cố `jq`**: một biện pháp kiểm soát thất bại phải thất bại
theo hướng an toàn. Không có hàng rào thì người ta còn cẩn thận; có hàng rào hỏng thì
người ta thôi cẩn thận. Đúng bài học mà chính TrustProcure bán cho khách hàng.

**H6 và H8 được bổ sung ngày 2026-08-27** sau khi vòng review Task 1 tìm ra hai lỗ hổng
đã kiểm chứng: `git -C . reset --hard` lọt qua cả mười quy tắc, và `.ENV` / `ID_RSA` lọt
qua trên hệ thống tệp không phân biệt hoa thường của Windows. Cả hai đều là "hàng rào
tồn tại trên giấy" — đúng loại lỗi mà chính nhóm H này sinh ra để bắt.

**H6 đổi thiết kế ngày 2026-08-27 (vòng review thứ hai, cùng ngày)**: bản vá đầu cho H6
vẫn giữ khái niệm "ranh giới lời gọi git" (tách theo toán tử shell `&& || ; | &` và
xuống dòng) rồi bóc tuỳ chọn toàn cục `-C`/`-c` đứng trước subcommand. Chính bản vá đó
lại bị bắn nhầm bởi cú pháp nhân bản mô tả tệp — `2>&1`, `&>`, `>&2`: ký tự `&` trần
trong các cú pháp này bị hiểu nhầm là toán tử chạy nền, cắt đứt việc thu thập token của
lời gọi git ngay giữa chừng, khiến `git 2>&1 reset --hard HEAD~1` lọt qua. Sau hai vòng
vá liên tiếp, mô hình hoá chính xác ngữ pháp shell (toán tử nào là ranh giới, cờ nào ăn
thêm token) chứng minh là một trò chơi vá lỗ không hồi kết. Hook đổi hẳn triết lý: bỏ
việc xác định "token nào thuộc lời gọi git nào" và "đâu là subcommand", chỉ hỏi dòng
lệnh có chứa đồng thời các dấu hiệu của MỘT thao tác git phá huỷ hay không, bất kể
chúng nằm ở đâu, thuộc lời gọi nào, hay bị chuyển hướng/toán tử gì xen vào — thiên về
chặn, đúng bản chất một hàng rào an toàn (chặn nhầm mất mười giây; cho qua sai mất
việc). Đánh đổi chủ động chấp nhận: `git -C . restore foo.txt` (giá trị `.` của `-C`
trùng dấu hiệu `restore .`) và một số lệnh ghép hiếm gặp có tín hiệu rải trên hai lời
gọi git tách biệt trong cùng chuỗi có thể bị chặn oan — xem `task-1-report.md`, mục
"Fix round 2", để biết danh sách đầy đủ và lý do từng trường hợp được chấp nhận.
