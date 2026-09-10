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
| **B3** | `audit_events` là chuỗi hash; bộ kiểm chứng phát hiện được chèn, sửa, xóa, và **cắt đuôi** **[S1.43] — và danh tính của chính bảng sổ: đổi tên rồi dựng bảng cùng tên cùng hình dạng (lịch sử rời sổ) làm `migrate()` NÉM ở mục danh tính (chú thích neo theo oid + hình dạng sổ ngoài tên sổ, ADR-037)** **[S1.45] và lớp SỬA D2 của sổ không chạm bản sao khi bảng gốc còn giữ danh tính theo kênh ① (0 trigger; chủ bảng gỡ chú thích ⇒ ranh giới nói ra — khoản 90)** | Lược đồ + bộ kiểm chứng + `db/migrations/hardening.always.sql` | **T1**, T3 |
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
| **F1** | Mọi truy vấn bị ràng buộc `org_id` ở tầng DB qua RLS, không chỉ tầng ứng dụng **[S1.32] — và RLS không được là một đường làm câu ghi trả 0 hàng im lặng (ADR-036): mọi policy RESTRICTIVE khai đủ bốn cột nguyên văn; mọi quyền SELECT/INSERT/UPDATE/DELETE đã cấp cho vai ứng dụng (đích danh hay qua PUBLIC) có policy PERMISSIVE phủ; bảng bật RLS ngoài tập tenant phải khai kèm lý do** **[S1.38] và ba tổng điều tra ấy nay có mục hardening (khoản 83⑴⑵⑶): mọi policy trên bảng RLS thuộc đúng một lớp — RESTRICTIVE ngoài khuôn 027 khai sáu cột nguyên văn ở hardening, bản test đòi khớp; phủ lệnh (~~miễn con của bảng tenant~~ **[S1.42, lượt soi 33b NẶNG-1]** KHÔNG miễn con/lá của bảng tenant — lượt soi 29 NẶNG-2 bỏ vế miễn trước khi S1.38 hợp nhất; câu sai sống bốn vòng ở sổ đăng ký và ma trận); RLS ngoài tenant khai — `migrate()` NÉM trên cụm đã deploy, và câu phán xét của hardening chạy trong chính test này** **[S1.40] con cháu MỌI BẬC của bảng tenant vào tập bật RLS (`LA_CUA_BANG_TENANT` đệ quy, khoản 84 — đo cháu hai bậc ngoài public: rò trước, fail-closed sau); bảng tạm kế thừa là của riêng phiên, không vào tập (đo)** **[S1.41] bảng có `org_id` ngoài public, ngoài tập tenant, không RLS phải khai (khoản 85 — kề với 83⑶; đo lỗ rò, NO INHERIT/DETACH hai đường thời gian, chuỗi RENAME); meta-test sentinel cho năm danh sách khai rỗng của hardening** **[S1.43] bảng tenant đã khai (`BANG_TENANT_KHAI`, 29 tên kèm migration khai sinh — bản khai phải bằng tập theo tính chất) phải còn đúng tên, còn là tenant theo tính chất, mang chú thích neo theo oid: đổi tên cột/đổi tên bảng/chép bảng đè tên ⇒ `migrate()` NÉM (ADR-037)** **[S1.44] 83⑵ lấy tập vai = TÍNH CHẤT ∪ TÊN ĐÃ GHIM (`VAI_KET_NOI_UNG_DUNG` ∪ `ROLE_CANH`) và quyền theo kế thừa: vai lạ thành viên app_api + GRANT trực tiếp ⇒ bản bốn tên im; app_api_login bị gỡ membership + GRANT ⇒ bản chỉ-tính-chất im; quyền qua nhóm ⇒ bản grantee-trực-tiếp im (khoản 88, lượt soi 36); tập vai kết nối ứng dụng theo `'USAGE' OR 'SET'` — hồ sơ N3 (cụm trống, vai deploy CREATEROLE chạy `migrate()` đầu tiên) đi qua mọi migration và dừng ở phán xét với một mục có tên** **[S1.46] bảng KHÔNG có `org_id` nhưng có khoá ngoại một cột — của nó hay của tổ tiên INHERITS — tới bảng tenant theo tính chất (đích khai triển từ `MAU_VI_TU_BANG_TENANT`: `organizations` lẫn `users`…), ngoài tập tenant, không RLS phải khai (khoản 86 nửa gốc — đo lỗ rò ở `k` LẪN `public`, `migrate()` NÉM cho cả hai; có `org_id` ⇒ 85, bật RLS ⇒ 83⑶; ranh giới nói ra: cột uuid trần, khoá ngoại nhiều cột, bậc kế trên đồ thị khoá ngoại; cửa ra 83⑶ yếu — khoản 91)** | **Postgres RLS** + `db/rls-coverage.int.test.ts` + `db/migrations/hardening.always.sql` | **T3**, T5 |
| **F2** | Không IDOR — và quyền truy cập không bao giờ dựa vào việc ID khó đoán | Kiểm tra quyền tường minh | T2, T5 |
| **F3** | Khóa của tổ chức A không giải mã được dữ liệu tổ chức B | Phân cấp khóa theo tổ chức | T1, T3 |

### Nhóm G — Vòng đời khóa

| ID | Bất biến | Cưỡng chế | Tầng test |
|---|---|---|---|
| **G1** | Private key RFQ không bao giờ ở dạng rõ ngoài `unseal-worker` — không vào DB, log, biến môi trường, core dump | IAM + quyền cột DB | **T0**, T3, T5 |
| **G2** | Mỗi RFQ một cặp khóa; lộ một RFQ không lan sang RFQ khác | Thiết kế khóa | T1, T3 |
| **G3** | Xoay master key không làm mất khả năng giải mã báo giá cũ | Bọc khóa có phiên bản | T3, T6 |
| **G4** | Mọi thao tác khóa — sinh, bọc, mở bọc, hủy — đều sinh audit | Ứng dụng | T3, T5 |

**Tổng: 34 bất biến nghiệp vụ (nhóm A–G).** Cộng thêm ~~13~~ ~~15~~ ~~16~~ ~~17~~ ~~18~~ ~~19~~ ~~20~~ ~~**21**~~ **22** bất biến hàng rào (nhóm H, §5) là ~~47~~ ~~49~~ ~~50~~ ~~51~~ ~~52~~ ~~53~~ ~~54~~ **55** mã cùng chảy vào `evidence/INV-matrix.md`.

> **[S1.18] Dòng trên đã THIU một nhịp và không ai bắt được:** H17 vào sổ ở S1.10.2 mà hai con số này đứng yên ở 16/50, trong khi bảng §5 có 17 hàng và `evidence/INV-matrix.md` báo 51 mã. Bộ sinh đọc BẢNG chứ không đọc dòng này, nên phần chênh không làm cổng nào đỏ — đúng lớp "một câu sai sống sót vì không lớp nào đọc nó". Sửa cùng lượt thêm H18, và ghi ra thay vì lặng lẽ đổi số.

---

## 3. Bảy tầng kiểm thử

> **ĐỌC CỘT *Trạng thái S0* TRƯỚC CỘT *Chặn merge*.** Cột *Chặn merge* nói tầng ấy **sẽ** chặn
> khi nó tồn tại; nó **không** nói tầng ấy đang chạy hôm nay. Ba tầng dưới đây **chưa được
> dựng**, và điều đó đo được: `grep -E 'playwright|k6|osv-scanner'` trên `package.json` cùng mọi
> `*.yml` cho **0 hit**, và `.github/workflows/ci.yml` chỉ có bốn job — `t0`, `t1-t2`, `t3`,
> `evidence`. Cho tới khi cột *Trạng thái S0* của một hàng ghi **ĐÃ DỰNG**, mọi thứ mô tả dưới
> hàng đó là **kế hoạch**, kể cả bảng 15 kịch bản tấn công có tên ở mục T5.

| Tầng | Nội dung | Công cụ | Chạy khi | Chặn merge | **Trạng thái S0** |
|---|---|---|---|---|---|
| **T0** | Cổng tĩnh: typecheck, lint, quét bí mật, audit phụ thuộc, kiểm tra ranh giới module | tsc, eslint, gitleaks, osv-scanner, dependency-cruiser | Mọi commit | Có | **ĐÃ DỰNG một phần** — job `t0` có tsc + eslint + depcruise + gitleaks + `pnpm audit`; **`osv-scanner` chưa có** |
| **T1** | Unit & property-based | Vitest, fast-check | Mọi commit | Có | **ĐÃ DỰNG** — job `t1-t2` chạy `pnpm test` |
| **T2** | Contract/API + bộ quét rò rỉ | OpenAPI, Vitest | Mọi commit | Có | **CHƯA DỰNG — S1.** Không có OpenAPI, không có endpoint, nên **không có bộ quét rò rỉ**. Job `t1-t2` hôm nay chỉ là T1 |
| **T3** | Integration với Postgres thật | Testcontainers, Vitest | Mọi PR | Có | **ĐÃ DỰNG** — job `t3` chạy `pnpm test:int` trên Postgres thật |
| **T4** | E2E trên trình duyệt thật | Playwright | Mọi PR | Có | **CHƯA DỰNG — S1.** Playwright **không có trong `package.json`**; `apps/` rỗng |
| **T5** | Bộ test đối kháng | Vitest + Playwright | Mọi PR | Có | **CHƯA DỰNG NHƯ MỘT TẦNG RIÊNG.** Test đối kháng của S0 **có thật** nhưng sống lẫn trong T1/T3 (xem cột *Số test* của `evidence/INV-matrix.md`); **bảng 15 kịch bản dưới đây chưa có kịch bản nào chạy** |
| **T6** | Phi chức năng | k6, kịch bản DR | Hằng đêm | Không (cảnh báo) | **CHƯA DỰNG — S1+.** `k6` không có; chưa có kịch bản DR. Ngoại lệ duy nhất đã đo: `pnpm bench:keys` (hiệu năng bọc/mở khoá `local-dev`) |

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

> ⚠️ **BẢNG DƯỚI ĐÂY LÀ KẾ HOẠCH, KHÔNG PHẢI MỘT BỘ TEST ĐANG CHẠY.** 15 kịch bản có tên đọc
> rất giống một danh mục đã cài đặt; **không kịch bản nào trong số đó tồn tại ở S0**. Chủ ngữ của
> hầu hết chúng (RFQ, báo giá, magic link, endpoint, trình duyệt) chưa có một dòng mã nào — đối
> chiếu §3 của `evidence/INV-matrix.md`, nơi 23/47 mã còn trống kèm lý do từng mã. Ba kịch bản
> **có** lớp đối kháng thật ở S0, chỉ là chúng sống trong T1/T3 chứ không trong một tầng T5 riêng:
> **#7** (sửa `audit_events` bằng SQL trực tiếp → B4), **#8** (cắt đuôi chuỗi audit → B3), và
> **#11** phần *cô lập tổ chức* (→ F1, F2).

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
phủ của `E3`: E3 có năm vế và ~~vế *giới hạn tần suất* không có một dòng mã nào trong toàn
S0~~ **[S1.21] vế ấy nay CÓ LỚP trên cả hai đường OTP** (`otp_rate_limits` cho đường lời
mời từ S1.3; `callerLimit` 30/15 phút cho `/auth/totp` từ S1.12 — khoản nợ 39). Nhãn vế vẫn
**cố ý không** được tính là độ phủ: quy ước ấy nói về CÁCH ĐẾM, không về khoản nợ 1.

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
| **H14** | **Không một chỉ mục duy nhất nào trên bảng tenant vừa GHI ĐƯỢC bởi `app_api` vừa thiếu `org_id` ở cột đầu tiên** — phạm vi là `pg_index` (phủ cả PRIMARY KEY, UNIQUE constraint và `CREATE UNIQUE INDEX` trần), vị từ suy từ TÍNH CHẤT chứ không từ danh sách tên, và chỉ mục trên BIỂU THỨC bị báo ra thay vì bỏ qua | `db/unique-oracle.int.test.ts` | **T3** |
| **H15** | **Biên giới module của `packages/supplier`**: chỉ `index.ts` là cửa công khai; module mới thêm vào `src/` mặc định không với tới được từ ngoài; đường dẫn TƯƠNG ĐỐI xuyên gói cũng bị chặn; cộng danh sách trắng khoá TẬP EXPORT ở cửa | Họ quy tắc `g5-` của dependency-cruiser + `tests/architecture/barrel-exports.test.ts` | **T0** |
| **H16** | **Mọi gói trong `packages/` có một họ quy tắc biên giới đóng `src/` với ĐÚNG tập cửa mà `package.json` của gói khai trong `exports`** — ~~`index.ts` là cửa duy nhất~~ (câu cũ nói chặt hơn thứ được cưỡng chế: `coQuyTacBienGioi` từng chấp nhận tới HAI cửa qua một trần dùng chung, tức cấp không một cửa thứ hai cho mười một gói; sửa ở review lượt 10, H10-2) — suy từ TÍNH CHẤT (đọc thư mục thật + đọc `package.json` thật + đọc cấu hình thật; vị từ *gói* là *thư mục có `package.json`*, không phải *thư mục có `src/index.ts`* — H10-1), không từ danh sách các gói được bảo vệ; danh sách MIỄN TRỪ là đóng, có lý do từng dòng, và **chỉ được co lại**; cộng ba probe chạy depcruise thật cho `packages/rfq` | `tests/architecture/bien-gioi-goi.test.ts` + họ quy tắc `g6-` + `tests/architecture/barrel-exports.test.ts` | **T0** |
| **H17** | **Mọi route ĐỔI TRẠNG THÁI của người mua trong `apps/api` khai một mã quyền thật của danh mục trong bảng `ROUTES`; bộ điều phối là nơi DUY NHẤT gọi `requirePermission` — đo trên tiến trình HTTP thật: một phiên thiếu quyền nhận 403 kèm bản ghi `PERMISSION_DENIED`, không hàng nào được tạo** — route là DỮ LIỆU liệt kê được (ADR-020), nên vị từ đọc cấu trúc chứ không đọc chuỗi, kèm đối chứng dương trên một bảng giả | `apps/api/src/routes.ts` (`timViPhamBangRoute` + kiểu `BuyerWriteRoute`) + `apps/api/src/routes.test.ts` + `apps/api/src/api.int.test.ts` | **T1**, T3 |
| **H18** | **Mọi gói trong `packages/` có một danh sách trắng barrel, và MỌI CỬA khai trong `exports` của nó đều được canh** — suy từ TÍNH CHẤT (đọc thư mục thật, đọc `package.json` thật, import cửa thật), không từ một danh sách các gói đã được canh; sổ đăng ký *gói → cửa → danh sách trắng* phải khớp **BỀ MẶT THẬT**, nên một mục trỏ tới mảng rỗng bị bắt; danh sách MIỄN là **RỖNG** | `tests/architecture/barrel-exports.test.ts` | **T0** |
| **H19** | **Mọi bảng CHỈ-GHI-THÊM trong một schema của dự án — tập suy từ TÍNH CHẤT (mang CẢ HAI trigger BEFORE-ROW-UPDATE và BEFORE-ROW-DELETE mà hàm **plpgsql** của chúng không có `RETURN` nào), không từ một danh sách tên — đều LOGGED, đều MANG một trigger BEFORE TRUNCATE ĐANG BẬT gọi một hàm cùng loại, và không cấp UPDATE/DELETE/TRUNCATE (kể cả UPDATE mức CỘT) cho ai ngoài chủ sở hữu; cộng: bảng sổ CHÍNH TẮC không có cột nào NGOÀI chuỗi hash, và bảng gốc của cây tenant suy từ đích của khoá ngoại `org_id` một cột trỏ vào `id`. `migrate()` TỰ CHỮA thứ có TÊN, và trên tập SUY RA chỉ tự chữa thứ ĐƠN ĐIỆU — còn lại thì PHÁN XÉT (ADR-028 §2⑵) **[S1.29] Vế `RETURN` nay là HÌNH DẠNG ∪ KHAI BÁO: một hàm canh có `RETURN` vào tập bằng cách được kê tên ở `HAM_CANH_CHI_GHI_THEM`, danh sách ấy phải khớp NGUYÊN VĂN `hardening.always.sql`; và một TỔNG ĐIỀU TRA buộc mọi hàm trigger BEFORE-ROW UPDATE/DELETE phải được phân loại — thân không `RETURN` mà khai KHÔNG-CANH là đỏ, trigger canh bị TẮT là đỏ (khoản nợ 60; ADR-035)** **[S1.30] Và chiều NÓI DỐI của tổng điều tra đóng bằng NHÂN CHỨNG HÀNH VI: mỗi bộ ba (hàm, BẢNG, sự kiện) khai KHÔNG-CANH phải để một hàng thật đi qua một câu UPDATE/DELETE — đo bằng `pg_stat_xact_user_functions`, vốn chỉ đếm lời gọi TRẢ VỀ; hàm mà thân đọc vai thì nhân chứng phải đến từ một vai KHÔNG superuser — hoặc khai CANH MỘT SỰ KIỆN và đo được là NÉM từ chính hàm (khoản nợ 74)** **[S1.31] Tập ứng viên của tổng điều tra là MỌI trigger plpgsql trên UPDATE/DELETE, và một hàm canh ở hình thức khác `BEFORE … FOR EACH ROW` là đỏ (khoản nợ 75); MỌI rule `pg_rewrite` trên mọi quan hệ của dự án phải được khai (danh sách rỗng), và `migrate()` PHÁN XÉT rule trên mọi bảng chỉ-ghi-thêm suy ra — bảng sổ thì tự gỡ (khoản nợ 73)** **[S1.32] Tập ứng viên mở ra cả trigger INSERT (27 hàm phải phân loại; ~~nhân chứng INSERT là khoản nợ 77~~ [S1.33] 77 đóng); trigger canh phải `ENABLE ALWAYS`; mọi đích DML là bảng thường trừ khi khai (tổng điều tra `relkind`) — theo danh mục ADR-036** **[S1.33] Nhân chứng hành vi phủ cả INSERT (38 bộ ba của 27 hàm): hàm nuốt INSERT trả `NULL` TRẢ VỀ và ĐƯỢC đếm, nên vế *câu chạm ≥ 1 hàng* là lớp — và vế ấy nay đo ở mức BẢNG bằng `pg_stat_xact_user_tables` (trigger AFTER xoá hàng vừa chèn cũng đỏ; mỗi INSERT khai số hàng mong); constraint trigger DEFERRED đo ở cửa sổ thứ hai sau `SET CONSTRAINTS ALL IMMEDIATE`; vị từ nhạy vai có bao đóng bậc một với đối chứng dương (khoản nợ 77; ADR-036 hàng 11, 15, 17, 18)** **[S1.35] Lượt soi NGANG 25 mở bốn khoản trên chính lớp này, chưa đóng: ~~vị từ suy ra và tổng điều tra không đọc `tgqual`/`tgattr` và chỉ thấy trigger plpgsql (khoản nợ 79; ADR-036 hàng 20, 21)~~; nhân chứng không so GIÁ TRỊ và mặc định đo dưới superuser (khoản nợ 80; hàng 19); ADR-036 §3⑶ (khoản nợ 81); `NO INHERIT` và ghim chuỗi con (khoản nợ 82; hàng 22)** **[S1.36] 79 đóng: vị từ (cả hai bản) chỉ đếm trigger canh VÔ ĐIỀU KIỆN (`tgqual IS NULL AND tgattr = ''`), `migrate()` PHÁN XÉT mọi trigger của hàm canh có WHEN/UPDATE OF hay không ENABLE ALWAYS ở mọi bảng, chốt TRUNCATE cũng phải vô điều kiện (đo: `WHEN (false)` trên trigger TRUNCATE hợp lệ và TRUNCATE đi lọt); tổng điều tra NGÔN NGỮ trigger với danh sách khai rỗng và đối chứng dương `suppress_redundant_updates_trigger` — ~~chỉ ở test~~ (~~khoản nợ 81~~ [S1.37] 81 quyết: mục hardening là khoản nợ 83) [S1.39] 83 đóng: năm mục hardening nửa catalog — bảng ngoài/matview/view INSTEAD OF, trigger ngoài plpgsql, rule trên mọi quan hệ, hàm canh ngoài BEFORE-ROW, `pg_parameter_acl` — và câu phán xét của hardening chạy trong chính test này qua `db/hardening-hang.ts` **[S1.40] và khoản 82⑴: tổng điều tra kế thừa cổ điển (`pg_inherits` ngoài phân mảnh) — mục hardening `CAU_KE_THUA_SAI` với danh sách khai rỗng hai bản khớp, đối chứng NO INHERIT (1 → 0 hàng, cặp biến khỏi catalog, chiều ngược bắt cặp đã khai)** **[S1.44] và khoản 88: FK `ON DELETE CASCADE`/`SET NULL`/`TRUNCATE … CASCADE` từ bảng cha không đi vòng qua hàm canh của bảng con (đo — lời hẹn "chưa đo" của lượt 27), FK trỏ ra từ năm bảng chỉ-ghi-thêm đều NO ACTION; BƯỚC 2/3 của hardening KHÔNG GÃY THÔ — mục ném thành một dòng `KHÔNG ĐÁNH GIÁ ĐƯỢC` nêu tên, mục không được coi là đúng (hardening chép ra thư mục tạm, ba mục tiêm); vị từ chỉ-ghi-thêm đòi nguyên văn QUA BỘ GIẢI HẰNG (`MAU_SCHEMA_DU_AN` khai triển, hết bản chép inline; bộ giải có test T1 riêng `db/hardening-hang.test.ts`)** | `db/hardening-suy-tu-tinh-chat.int.test.ts` + `db/hardening-hang.test.ts` + `db/migrations/hardening.always.sql` + `047` | **T3**, T1 |
| **H20** | **Sổ nợ trong `docs/STATE.md` TỰ ĐỐI CHIẾU, bảy tính chất: mọi HÀNG BẢNG trong khối sổ nợ đều được bộ đọc NHẬN (một dòng thụt vào một dấu cách vẫn là bảng với GFM, và nó từng vô hình); mọi dòng có đúng BA cột và số khoản DUY NHẤT; mọi dòng KHAI trạng thái bằng một từ khoá đóng (`ĐÓNG`/`MỞ`/`NỬA`) đặt ở đầu thân; tập dòng khai MỞ/NỬA BẰNG dòng tổng kết — đỏ theo CẢ HAI chiều; mọi con trỏ chưa bị gạch giải được trong TẬP TỆP GIT THEO DÕI (không phải *"có trên đĩa"* — lượt CI đầu tiên bắt đúng chỗ ấy), và một ô đã gạch một con trỏ thì phải còn ít nhất một con trỏ SỐNG; số dấu `~~` của tệp là CHẴN; mọi lời khai hình dạng `**<số> ADR**` chưa bị gạch bằng số đầu mục `## ADR-` thật; mọi lời khai hình dạng `**Sổ đăng ký <n> bất biến** (<x> nghiệp vụ + <y> hàng rào` bằng số HÀNG của sổ đăng ký này; **[S1.28]** và MỌI lời khai ấy nay được đọc ở CẢ `Handoff.md`, cộng hai lời khai riêng của tệp đó (`**<n> migration đánh số**`, `**<n> gói + <m> công cụ**`) suy từ `git ls-files` và một lời khai số khoản nợ suy từ chính bảng sổ nợ; cộng CỘT TÀI LIỆU của §13 phải giải được trong tập git theo dõi, và mọi hàng của bảng ấy phải còn ít nhất một con trỏ SỐNG; và số dấu `~~` nay được đếm SAU KHI BỎ ĐOẠN MÃ — một `` `~~` `` được TRÍCH DẪN không còn làm cổng đỏ oan** | `tests/architecture/so-no-tu-doi-chieu.test.ts` | **T1** |

**Giới hạn của H20, nói ra thay vì để người đọc tự phát hiện** — cả bốn do review lượt 13 chỉ ra
hoặc buộc phải nói đúng mức:

- Nó bắt được *"hai lời khai không khớp nhau"*, **KHÔNG** bắt được *"một phán xét sai"*. Một dòng
  nợ đánh dấu `ĐÓNG` bởi một người đọc nhầm mã vẫn xanh. Vế ấy là việc của mắt người và của những
  vòng rà sổ như S1.21 — nhưng vòng rà nay chỉ phải xét NỘI DUNG, không phải đi đếm xem có bao
  nhiêu dòng bị bỏ quên.
- Hai vế *"mọi lời khai"* chỉ đúng cho **hai hình dạng ĐÃ NÊU TÊN** ở trên (`**<số> ADR**` và
  `**Sổ đăng ký <n> bất biến**`). Một con số viết theo cách khác — không đậm, hay `ADR: 29` —
  không bị đọc. Phát biểu rộng hơn thế là rộng hơn phép đo.
- Phạm vi tệp là `docs/STATE.md`, `docs/DECISIONS.md`, `docs/TEST-PLAN.md` và **[S1.28]**
  `Handoff.md`. ~~**`Handoff.md` KHÔNG được phủ** — khoản nợ 61.~~ **[S1.28] khoản nợ 61 ĐÓNG.**
  Nhưng phạm vi TRONG `Handoff.md` hẹp và cố ý hẹp: **năm lời khai có hình dạng đã nêu tên, và
  MỘT cột con trỏ (§13)**. Văn xuôi tự do của tệp — kể cả những câu khẳng định một thư mục
  RỖNG hay một tệp CHƯA TỒN TẠI, tức đúng ba câu S1.21 đo được là sai ở §6 — **vẫn ngoài
  tầm**, và đó là khoản nợ 72. Lý do là một phép đo, không phải một sở thích: quét mọi đấu
  huyền của tệp cho **36 báo nhầm trên 38 phát hiện**, vì phần lớn token trong đấu huyền ở đó
  là tên gói, đường HTTP, chuỗi phiên bản hoặc mẫu glob đang được TRÍCH — không phải con trỏ.
- Lớp này đọc tài liệu như DỮ LIỆU TIN CẬY (người trong kho viết, qua review). Giả định ấy hôm nay
  **chưa được cưỡng chế**: `CODEOWNERS` trỏ tới một team chưa tồn tại (khoản nợ 18), nên không
  branch protection nào bắt buộc review trên `docs/`. Kết luận về đường dẫn và biểu thức chính quy
  dựng từ tài liệu (`giaiDuoc`) đúng ở mức *tự gây thương tích*, không ở mức *chống nội dung thù
  địch*. Xem ADR-029 §5.

| Mã | Bất biến | Nơi cưỡng chế | Tầng |
|---|---|---|---|
| **H21** | **QT3 có lớp máy: ~~một câu SQL trong mã sản xuất đã ghim MỘT trục (`pg_catalog.`/`public.`)~~ [S1.24] MỌI câu SQL trong mã sản xuất phải ghim ĐỦ BỐN — tên hàm, toán tử, ép kiểu, tên bảng; ~~số câu chưa ghim trục nào không được TĂNG;~~ không mã sản xuất nào ngoài `migrate.ts` được chạm `search_path` (mọi cú pháp); và mọi danh sách miễn trừ được PostgreSQL thật phán xét — tên ngữ pháp phải KHÔNG có hàm trong `pg_catalog`, từ khoá phải có trong `pg_get_keywords()`, tên kiểu đã ghim phải có trong `pg_type`** | `tests/architecture/qt3-ghim-schema.test.ts` + `tests/architecture/qt3-ngu-phap.int.test.ts` + **[S1.24]** `tests/architecture/qt3-cu-phap.int.test.ts` (mỗi câu DML được `PREPARE` trên PostgreSQL thật — lớp canh nay HAI CHIỀU: bắt cả **thiếu ghim** lẫn **ghim sai**) **[S1.34] Và đường TÌM TÊN của phiên ứng dụng được giữ ở CSDL, không chỉ ở cách viết SQL: hardening thu hồi TEMP và CREATE ON DATABASE khỏi PUBLIC và mọi vai kết nối ứng dụng, phán xét schema trùng tên vai và quan hệ trùng tên public trong schema vai có USAGE; `vai-tro.ts` DISCARD TEMP ở mỗi lần giao client (khoản nợ 78; ADR-036 hàng 16; `db/migrations.int.test.ts` `[khoản nợ 78]` ×2)** | **T1 + T3** |

**Giới hạn của H21, nói ra thay vì để người đọc tự phát hiện:**

- ~~Chủ thể là câu **đã ghim một trục**. Một câu chưa ghim gì chỉ chịu MỐC ĐẾM (`TRAN_TOI_DA`), tức
  H21 GIỮ phần dư chứ không hạ nó — **80** câu, trong đó **39** chạm bảng nhạy cảm. Đó là khoản
  nợ 62, và nó là phần lớn hơn theo số đếm.~~ **[S1.24] Chủ thể nay là MỌI câu; mốc đã được GỠ.**
  Con số **80** khi đo lại gồm **9** chuỗi không phải SQL và **8** câu không có gì để ghim; việc
  thật là **63**, và nó đã đi hết. Giới hạn còn lại không phải phạm vi mà là **tầm nhìn của bộ
  đọc** — xem gạch đầu dòng ngay dưới.
- Bộ đọc là một BỘ TÁCH TỪ trên mã TypeScript, không phải trình phân tích SQL: nó ghép chuỗi nối
  bằng `+` nhưng không hiểu SQL dựng động kiểu khác.
- Nó đọc `git ls-files`, nên một tệp sản xuất chưa vào chỉ mục là vô hình.
- `db/migrations/*.sql` NGOÀI phạm vi, và cái giữ chúng là chính vế `search_path` của H21 —
  xem ADR-030 §5.

| Mã | Bất biến | Nơi cưỡng chế | Tầng |
|---|---|---|---|
| **H22** | **Mọi cặp (mã bất biến, tệp test) phải có trong SỔ KHAI — toàn kho.** Bộ sinh gom độ phủ bằng nhãn `[INV-XX]` trong `fullName` của báo cáo vitest, nên một nhãn gắn SAI CHỖ ghi một dòng *"passed"* vào hàng của một bất biến và làm một lỗ trống TRÔNG NHƯ ĐÃ VÁ. Trước H22, `findUnregisteredLabels` chỉ bắt nhãn trỏ tới mã KHÔNG TỒN TẠI, còn `packages/outbox/src/nhan-bat-bien.test.ts` chỉ phủ một gói. H22 đóng theo **CẢ HAI CHIỀU**: một cặp chưa khai là đỏ, và một dòng khai THIU cũng đỏ — chiều thứ hai đồng thời là ĐỐI CHỨNG DƯƠNG dựng sẵn. **[lượt soi 19]** Cặp được lấy từ CHÍNH báo cáo vitest (`testResults[].name` + `fullName`) — cùng nguồn với độ phủ — chứ KHÔNG từ dòng mã nguồn, nên không cách viết test nào (`test(`, `it.concurrent(`, `it.each` nhiều dòng) làm hai bộ đọc lệch nhau | `tools/inv-matrix/src/parse.ts` (`findMisplacedLabels`, cưỡng chế ở `pnpm evidence`) + `tools/inv-matrix/src/so-khai-nhan.ts` (sổ khai) + `tests/architecture/nhan-bat-bien-cho-dat.test.ts` (hàm thuần, fixture + đột biến) | **T1 + Evidence pack** |

**Giới hạn của H22, nói ra thay vì để người đọc tự phát hiện:**

- Nó bảo đảm không cặp nào ra đời hay đổi chỗ trong IM LẶNG. Nó **KHÔNG** bảo đảm một cặp
  đã khai là ĐÚNG: sổ khai được SINH RA từ trạng thái đo được tại `bebeb41` rồi đóng băng,
  nên nó chặn cặp thứ 138 chứ không kiểm toán 137 cặp có sẵn. Vế *"test này có thật sự đo
  bất biến ấy không"* là một PHÁN XÉT, không cơ giới hoá được — y như vế tương ứng của H20.
- ~~Bộ quét đọc dòng `it(` **và** `describe(`~~ **[lượt soi 19] Không còn bộ quét mã nguồn nào.**
  Bản S1.29 đầu quét dòng nguồn; lượt soi đo được 22 cặp chỉ có ở `describe(` (gồm `H19`–`H21` và
  cả mười mã hook `H1`–`H10`), rồi đo tiếp: sau khi thêm `describe(`, vẫn còn **8** tên test ở
  dòng vô hình (`it.each` nhiều dòng) — tức mọi bộ quét theo dòng đều là một vị từ hình dạng, đúng
  thứ ADR-035 §2⑴ cấm. Nay cặp lấy từ báo cáo vitest, nên chủ thể của H22 BẰNG chủ thể của độ phủ
  theo cấu tạo, không theo trùng hợp.
- Vì đọc báo cáo, phép kiểm chỉ chạy khi có báo cáo: ở `pnpm evidence` (job *Evidence pack*, và
  `evidence:check` trước mỗi lần đẩy). `pnpm test` (T1) chỉ đo HÀM THUẦN bằng fixture. Một nhãn
  gắn sai chỗ vì thế được bắt ở cổng chặn merge, không ở lượt chạy test cục bộ.
- Nhãn trong CHÚ THÍCH không bị đọc, và đó là cố ý — chú thích là tài liệu, không phải bằng
  chứng; chính khối chú thích của các tệp này chứa hàng chục nhãn.


**H13 được bổ sung ngày 2026-08-29** (vòng fix 1 của Task 10), và lý do là TẦN SUẤT LẶP LẠI
chứ không phải một năng lực đang bị hở: đây là LẦN THỨ BA cùng một lớp lỗ (crypto-keys → `g1-`,
identity → `g2-`/H11, nay outbox → `g4-`). Phép đo, tái lập được ở worktree review: một file
`packages/audit/src/zz-probe-outbox-leak.ts` với `import "../../outbox/src/runner.js"` đi lọt
CẢ BA cổng — `depcruise` 0 vi phạm, `tsc` exit 0, `eslint` exit 0 — trong khi bản bare
specifier bị chặn ở cả hai lớp. Danh sách trắng barrel khoá DANH SÁCH export Ở CỬA; nó không
dựng BỨC TƯỜNG, nên nó không thay thế được hàng rào này.
**H14 và H15 được bổ sung ngày 2026-08-29** (S1.1), và hai lý do khác hẳn nhau:

**H14** ra đời từ ADR-013 và từ hai phép đo ĐÃ CÓ SẴN trong kho mã — `organizations.slug` và
`users_pkey` ở 002 — chứ không từ một lỗ mới. Cái mới là NHẬN RA rằng chúng cùng MỘT lớp, và
rằng S1 thêm 13 bảng là 13 lần rút thăm lại. Bộ dò tự chứng minh có răng bằng hai bảng dò trong
cùng một lượt chạy (chiều dương và chiều âm), và nó ĐÃ tìm ra một khiếm khuyết của chính nó ở
lượt đột biến đầu tiên: `array_agg` trên `pg_attribute.attname` trả kiểu `name[]` mà node-pg
không phân tích được, nên bộ dò NÉM thay vì BÁO. Xem khối chú thích ở đầu `db/unique-oracle.int.test.ts`.

**H15** là LẦN THỨ TƯ cùng một khuôn biên giới module (crypto-keys → `g1-`, identity → `g2-`/H11,
outbox → `g4-`/H13, nay supplier → `g5-`), và khác biệt đáng ghi: ba lần trước đều là VÁ XONG RỒI
SỬA — quy tắc được thêm SAU khi một probe import tương đối xuyên gói đã đo được là đi lọt cả ba
cổng. Lần này quy tắc ra đời CÙNG LÚC với gói. Khoản nợ 17 KHÔNG được đóng: `audit`, `db`,
`tenancy`, `test-support` vẫn chưa có gì — nó chỉ không lớn thêm.

**H16 được bổ sung ngày 2026-08-29** (S1.2), và lý do của nó là một QUAN SÁT VỀ CHÍNH DỰ ÁN chứ
không phải một lỗ mới. Tới S1.2, năm họ quy tắc biên giới đã được thêm TAY, mỗi họ cho một gói:
`g1-` (crypto-keys) · `g2-`/H11 (identity) · `g4-`/H13 (outbox) · `g5-`/H15 (supplier) · `g6-`
(rfq). Bốn lần đầu đều là VÁ XONG RỒI SỬA. Tới lần thứ năm, hình dạng hiện rõ và nó không dễ
chịu: **danh sách các gói được bảo vệ đang nằm trong đầu người viết, không nằm trong một biến
nào** — đúng KHUÔN DANH-SÁCH-TÊN mà dự án đã bắt gặp hỏng ba lần (khoản nợ 3, 16, 17), chỉ khác
ở chỗ danh sách này còn không được viết ra.

H16 đảo chiều: nó **không** liệt kê gói ĐƯỢC bảo vệ, nó liệt kê gói ĐƯỢC MIỄN — bốn gói của S0
(`audit`, `db`, `tenancy`, `test-support`), mỗi dòng một lý do, và danh sách **chỉ được co lại**;
một gói vừa có quy tắc vừa nằm trong danh sách miễn làm test ĐỎ. Hệ quả: gói thứ sáu không đòi ai
phải nhớ gì. Đo bằng đột biến (2026-08-29): nới `to.pathNot` của họ `g6-` từ một cửa thành ba →
**ĐỎ THẬT**, gọi tên đúng `rfq`.

**Giới hạn của H19, nói ra thay vì để người đọc tự phát hiện** — cả ba do vòng review lượt 12 chỉ ra:

- Vế *"chặn TRUNCATE"* được cưỡng chế bằng **sự tồn tại của một trigger đúng hình dạng và đang
  BẬT**, không bằng một phép thử `TRUNCATE` thật ở deploy-time. Phép thử thật nằm ở tầng T3.
- Vế *"cột ngoài chuỗi hash"* chỉ soi **hai cái tên đủ điều kiện** `public.audit_events` và
  `public.audit_chain_anchors` — cùng phạm vi và cùng lý do với `CAU_HINH_DANG_CHINH_TAC` của S0:
  nó khẳng định về BẢNG CHÍNH TẮC, không đi tìm mọi bảng sổ có thể có ở mọi schema.
- ~~Tập hàm canh suy từ **hình dạng thân hàm** (`prosrc` không chứa `RETURN`), tức một phép so khớp
  VĂN BẢN. Chiều ồn ào đã đóng bằng `prolang = plpgsql`; chiều IM LẶNG — một hàm canh viết kiểu
  khác rơi khỏi tập — vẫn mở, và là **khoản nợ 60**.~~ **[S1.30] Dòng này thiu từ S1.29** (60 đóng
  bằng tổng điều tra, chiều im lặng đóng ở đó) và không ai gạch. Nay cả chiều NÓI DỐI cũng đóng
  (khoản nợ 74, nhân chứng hành vi). Giới hạn CÒN LẠI của H19 ở vế này: tập ứng viên khoá theo
  ~~`pg_trigger` BEFORE cấp HÀNG — một `RULE` cho cùng hiệu lực mà không vào tổng điều tra (**khoản
  nợ 73**), một trigger cấp CÂU LỆNH hay AFTER-ROW ném vô điều kiện cũng vậy (**khoản nợ 75**)~~
  **[S1.31] cả hai đóng** — tập ứng viên là mọi trigger UPDATE/DELETE cộng một tổng điều tra
  `pg_rewrite`; ~~cơ chế thứ ba còn ngoài tầm là RLS `USING (false)` (**khoản nợ 76**)~~ **[S1.32]
  76 đóng bằng ADR-036, dòng này thiu một vòng**; và nhân chứng ghi công theo (hàm, bảng) chứ không
  theo TRIGGER. **[S1.33]** Nhân chứng phủ cả INSERT; giới hạn còn lại của nó là giới hạn ⒞ ⒟ đã
  khai ở khối: nó chứng minh *có một đường trả về đã được đi trên một hàng thật*, không chứng minh
  *mọi điều kiện của hàm đều đúng*; nuốt theo dữ liệu NGOÀI câu vẫn ngoài tầm.
- **[S1.35] Bốn giới hạn lượt soi ngang 25 ĐO ĐƯỢC, chưa đóng** (khoản nợ ~~79,~~ 80): ~~một trigger canh
  mang `WHEN (…)` hay `UPDATE OF <cột>` giữ bảng trong tập suy ra trong khi UPDATE cột khác và DELETE
  đi qua — vị từ và tổng điều tra không đọc `tgqual`/`tgattr` (hardening chỉ đọc cho bảng CÓ TÊN);
  một trigger gọi hàm ngoài plpgsql (`suppress_redundant_updates_trigger`: `UPDATE 0` không lỗi) vô
  hình với mọi tổng điều tra;~~ **[S1.36] hai giới hạn ấy đóng (khoản 79) — giới hạn còn lại của vế ngôn
  ngữ: tổng điều tra ấy chỉ ở test, cụm đã deploy chờ ~~khoản 81~~ [S1.37] khoản 83 (81 quyết: chủ DB thường gắn được trigger built-in — đo); [S1.39, ghi ở S1.42] giới hạn ấy hết: mục hardening `CAU_TRIGGER_NGOAI_PLPGSQL_SAI` (83⑸);** nhân chứng ghi công cho `RETURN OLD` — *hàng chạm* không phải *hàng đã
  gửi*; `nhay_vai` là danh sách ĐEN nên mặc định của nhân chứng là superuser (regex bỏ sót
  `pg_stat_activity.usename`, `is_superuser`, `session_authorization`, `pg_get_userbyid`).

**H19 được bổ sung ngày 2026-09-07** (S1.20), và nó là lần thứ BA cùng một khuôn — sau H16 (biên
giới gói) và H18 (bề mặt export) — nhưng lần này ở tầng CSDL, trong `hardening.always.sql`: file
chạy **mọi lần `migrate()`**, kể cả trên production đã có dữ liệu.

**Nó ra đời từ một dự báo của chính sổ nợ, và dự báo ấy đã đúng.** Khoản nợ 16 (viết ở vòng fix
cuối của S0) tố cáo bất đối xứng *"`bang_so` nhận bảng theo HAI TÊN VIẾT CỨNG trong khi `bang_al`
nhận bảng lạ theo TÍNH CHẤT"* và viết: *"bảng báo giá S1 sẽ rơi thẳng vào đó"*. S1 dựng một hàm
canh chỉ-ghi-thêm THỨ HAI (`bid_chi_ghi_them()`, migration 018) cắm trên BA bảng —
`bid_receipts`, `rfq_unsealed_bids`, `vendor_bid_versions` — và cả ba nằm ngoài cả hai vế.

**Lỗ nặng nhất KHÔNG phải lỗ mà khoản nợ nêu.** Khoản nợ đoán UNLOGGED, UNIQUE và REVOKE. Phép đo
tìm ra vế thứ tư mà nó không nghĩ tới: ba trigger của 018/019 là `BEFORE DELETE OR UPDATE FOR EACH
ROW`, và **một trigger cấp HÀNG không bao giờ chạy cho `TRUNCATE`**. Đo trên PostgreSQL 16:
`TRUNCATE public.bid_receipts` → **OK**, trong khi `TRUNCATE public.audit_events` → NÉM. Một câu
lệnh xoá sạch mọi biên nhận nộp thầu (**B2**), mọi phiên bản báo giá (**B1**) và mọi giá đã mở —
trong khi hai mã ấy đang ✅ với 10 và 25 khẳng định. Đóng ở `047`.

**Vế KHÔNG tổng quát hoá được, và nó phải được nói ra:** `UNIQUE (org_id, seq)` gắn với CHUỖI HASH
chứ không với tính chỉ-ghi-thêm — `bid_receipts` không có cột `seq`, và một RFQ có nhiều báo giá
song song nên không có thứ tự toàn cục nào để đánh số. Ràng buộc ấy VẪN chỉ áp cho hai bảng sổ.
Khoản nợ 16 buộc tội *"bất đối xứng này không có một chú thích nào giải thích"*; nay nó có.

**Ranh giới TỰ CHỮA / PHÁN XÉT là một phần của mệnh đề, không phải chi tiết cài đặt.** [CR4] của S0
cấm `migrate()` tự tay đổi ngữ nghĩa một bảng mà nó SUY RA — và bẫy ấy có thật: cắm
`chan_sua_xoa()` lên ba bảng của S1 sẽ đưa chúng vào `can_co`, nơi hardening đòi đủ bộ ba trigger
mang tên khác, tức **chặn deploy trên một lược đồ hợp lệ**. H19 vì thế đo CẢ HAI chiều: bảng có
TÊN thì `migrate()` tự chữa và trả OK; bảng SUY RA thì `migrate()` NÉM kèm hướng dẫn.

**H18 được bổ sung ngày 2026-09-07** (S1.18), và nó là VẾ THỨ HAI của chính khoản nợ mà H16 tự
đặt tên khi ra đời: *"nó KHÔNG phủ danh sách trắng barrel (khoản nợ 9) … 'có' ấy vẫn là một hằng
viết tay, không phải một tính chất"*. Quan hệ giữa hai mã đọc thẳng được: **H16 canh BỨC TƯỜNG
(không ai đi vòng qua cửa), H18 canh CÁI CỬA (không gì lạ đi ra qua nó)** — và cả hai nay đều suy
từ tính chất, cả hai đều có danh sách miễn trừ RỖNG.

**Việc dựng H18 tìm ra một lỗ có thật, ghi ra vì nó là lý do lớp này đáng có:**
`packages/sealed-envelope` khai HAI cửa từ S1.4 (`.` và `./unseal`) nhưng chỉ cửa `.` có danh sách
trắng. Cửa `./unseal` xuất `unsealBid` — hàm MỞ phong bì giá thầu — và bề mặt của nó chưa từng bị
khoá; `g8-khong-mo-phong-bi-ngoai-unseal-worker` canh AI đi qua được cửa ấy, không canh CÁI GÌ đi
ra qua nó. Cùng hình dạng với `@trustprocure/audit/anchor-sign` (S1.17, đóng cùng vòng này), và cả
hai lần thứ mở một cửa công khai mới là **một dòng trong `package.json`** — thứ mà không quy tắc
depcruise nào phản đối, vì cạnh tới file sau cửa mới là hợp pháp với chính cửa đó.

**Giới hạn của H18, cùng giới hạn đã ghi cho H11/H15/H16:** nó khoá DANH SÁCH, không khoá HÌNH
DẠNG. Một hàm mới thêm vào danh sách trắng kèm một dòng lý do vẫn đi lọt, và lớp cuối là người
đọc (`.github/CODEOWNERS`).

**H16 KHÔNG thay thế H11/H13/H15 và cũng không thay ba probe của mỗi họ.** Nó đòi quy tắc TỒN TẠI
và có HÌNH DẠNG đúng; nó **không chạy depcruise** nên không chứng minh quy tắc CHẶN THẬT. Nó cũng
**không** phủ danh sách trắng barrel — khoản nợ 9 còn nguyên: hai gói S1 có danh sách trắng, nhưng
"có" ấy vẫn là một hằng viết tay, không phải một tính chất.

Hai con số ở §2 (12 → 13 và 46 → 47, rồi 13 → 15 và 47 → 49, nay 15 → 16 và 49 → 50) ĐƯỢC SỬA CÙNG LÚC ở đây. Việc HOÀ GIẢI hai cách đếm
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

**Một test `[INV-G1]` có VẾ PHỤ THUỘC HỆ THỐNG FILE, và điều đó phải nói ra ở đây** (lần chạy CI
đầu tiên, 2026-08-28). Test *"quy tắc chặn `local-dev-shared.ts` không phân biệt hoa-thường"*
mang **hai** vế: vế **regex của chính quy tắc khớp cả cách viết sai hoa-thường** chạy trên **mọi**
hệ điều hành; vế **đầu-cuối qua depcruise CLI** chỉ chạy khi hệ thống file **đo được** là không
phân biệt hoa-thường, và khi không chạy thì **công bố ra log**. Lý do: trên hệ thống file phân
biệt hoa-thường (Linux của CI), một import sai hoa-thường **không resolve được**, nên không có
cạnh phụ thuộc nào để quy tắc bắn — *"không có vi phạm"* ở đó là kết quả **đúng**, và hiểm hoạ
chỉ tồn tại trên máy phát triển Windows/macOS. Vì vậy ô ✅ của **G1** phải đọc là: bảo đảm
*"regex không phân biệt hoa-thường"* được đo ở **mọi** lượt chạy; bảo đảm *"đường đi thật bị
chặn"* được đo ở lượt chạy **trên máy không phân biệt hoa-thường**. Cùng tinh thần với ghi chú
"phạm vi hẹp hơn mệnh đề" ở §4 của ma trận: ô xanh **không** có nghĩa mọi vế đều được đo ở mọi
môi trường.

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
