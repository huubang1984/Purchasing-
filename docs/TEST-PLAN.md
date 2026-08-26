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
2. **Bất biến không có test phủ ⇒ CI đỏ.** Không có ngoại lệ tạm thời.
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

**Tổng: 34 bất biến.**

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

Mỗi lần CI chạy sinh `evidence/INV-matrix.md`:

```text
| INV | Mệnh đề | Cưỡng chế | Test phủ | Kết quả | Commit | Thời điểm |
|-----|---------|-----------|----------|---------|--------|-----------|
| A1  | ...     | Kiến trúc | 4 test   | PASS    | a1b2c3 | ...       |
| A4  | ...     | Máy quét  | 1 test   | PASS    | a1b2c3 | ...       |
```

Bất biến ở trạng thái `CHƯA PHỦ` làm CI đỏ.

Đây vừa là kỷ luật kỹ thuật vừa là tài sản thương mại: khi kiểm toán viên của khách hàng
hỏi *"làm sao chứng minh nhân viên mua hàng không xem được giá trước giờ mở?"*, câu trả
lời là bảng này kèm lịch sử chạy, thay vì một lời hứa.

---

## 5. Kiểm thử chính hàng rào Vibe Coding

Hai hook của `ai-eng-os` cũng là mã cần kiểm chứng, không phải cấu hình được tin tưởng
mặc nhiên. Chúng đã từng fail-open trên máy phát triển (spec §8.1).

| # | Test | Kỳ vọng |
|---|---|---|
| 1 | `git reset --hard HEAD~1` | CHẶN, mã thoát 2 |
| 2 | `git clean -fd` | CHẶN |
| 3 | `git push --force origin main` | CHẶN |
| 4 | `git checkout -- .` | CHẶN |
| 5 | `git branch -D feature` | CHẶN |
| 6 | `git status` | CHO QUA |
| 7 | Ghi vào `.env`, `.pem`, `.key`, `id_rsa`, `id_ed25519`, `.p12`, `.pfx`, `.jks`, `.npmrc`, `.pgpass` | CHẶN |
| 8 | Ghi vào `src/index.ts` | CHO QUA |
| 9 | **Đầu vào JSON hỏng hoặc rỗng** | **CHẶN** — fail-closed |
| 10 | **Thiếu phụ thuộc runtime** | **CHẶN** — fail-closed |

Mục 9 và 10 là bài học rút ra từ sự cố `jq`: một biện pháp kiểm soát thất bại phải thất
bại theo hướng an toàn. Đúng bài học mà chính TrustProcure bán cho khách hàng.
