# HANDOFF — TrustProcure

> Bàn giao trạng thái dự án. **Ngày lập: 2026-08-29.**
>
> Tài liệu này nói *dự án đang ở đâu* và *người tiếp theo cần biết gì*. Nó **không** thay
> `docs/STATE.md` — STATE.md là sổ trạng thái chi tiết, còn đây là bản đọc trong mười phút.
> Mọi con số dưới đây đều **đã đo lại**, không chép từ trí nhớ. Chỗ nào chưa đo thì ghi là
> chưa đo.

---

## 1. Một câu

~~**Dự án đang ở cuối giai đoạn S0 (Nền móng). Mã đã viết xong, đã xanh trên CI, và đang nằm ở
một PR CHƯA MERGE. S1 (Sealed Bid Core) chưa bắt đầu một dòng nào.**~~

**Cập nhật 2026-08-29 · S0 ĐÃ HỢP NHẤT VÀO `master` (merge commit `30d1972`). S1 đã có KẾ HOẠCH
ĐẦY ĐỦ nhưng chưa viết một dòng mã nào.** Ba quyết định đã chốt trong lượt này (AWS + AWS KMS
qua ADR-009, và cách merge); ba ADR mới được nêu tên và còn treo (010, 011, 012).

TrustProcure là sàn đấu thầu kín (sealed-bid procurement): nhà cung cấp nộp báo giá được mã
hoá, không ai — kể cả nhân viên mua hàng — xem được giá trước giờ mở thầu. S0 dựng **nền tảng
và mặt phẳng điều khiển** cho việc đó, chưa dựng chính luồng đấu thầu.

---

## 2. Trạng thái mã nguồn

| | |
|---|---|
| Nhánh | ~~`worktree-s0-foundation`~~ → **đã hợp nhất**; công việc mới đi từ `master` |
| HEAD của `master` | **`30d1972`** (merge commit, 2026-08-29) — 49 commit |
| Nhánh gốc | `master` |
| Số commit trên nhánh S0 | **46** (giữ nguyên trong lịch sử, **không** squash) |
| Thay đổi so với `master` trước merge | 105 file, +36 375 / −88 |
| Pull request (S1) | [#2](https://github.com/huubang1984/Purchasing-/pull/2) — **MỞ**, 15 commit, XANH cả bốn job ở run `33704750680`. Tiêu đề và mô tả đã được viết lại 2026-09-03: bản cũ nói "kế hoạch S1" trong khi PR chứa trọn S1.1–S1.3, sáu ADR và chín migration |
| Pull request | [#1](https://github.com/huubang1984/Purchasing-/pull/1) — **MERGED** 2026-08-29, merge commit `30d1972`. Nhánh `worktree-s0-foundation` **không xoá** |
| Kho | `https://github.com/huubang1984/Purchasing-` |
| Thư mục làm việc | `D:\Claude\TrustProcure\.claude\worktrees\s0-foundation` (git worktree, **cố ý giữ lại**) |

**Lịch sử CI của nhánh** (`gh run list`):

| Lượt | Commit | Kết quả |
|---|---|---|
| `33218397033` | `5e76a7f` | **ĐỎ cả ba job**, `evidence` bị bỏ qua |
| `33221142361` | `885e58f` | **XANH cả bốn job** |
| `33221919239` | `c4fde9c` | **XANH cả bốn job** |
| `33230092811` | `5b72143` | **XANH cả bốn job** |

~~Hai lượt xanh liên tiếp.~~ **Ba lượt xanh liên tiếp** — lượt thứ ba là điều kiện để merge.
Lượt đỏ đầu tiên là lượt **có giá trị nhất** của cả dự án — xem §7.

---

## 3. Trong mã có gì

~~**Bảy migration** + một lớp cưỡng chế chạy ở mọi lần `migrate()`:~~
**[S1.61] 49 migration đánh số** (~~**[S1.28] 48**~~) + một lớp cưỡng chế chạy ở mọi lần `migrate()`. Con số ấy
nay do `[INV-H20]` **suy ra từ `git ls-files`**, không còn chép tay — khoản nợ 61. Bảy tệp
đầu là nền của S0:

```
db/migrations/001_roles_and_functions.sql     roles, hàm nền
             002_organizations_and_users.sql  tổ chức, người dùng
             003_audit_events.sql             sổ kiểm toán
             004_audit_chain_functions.sql    chuỗi hash
             005_identity.sql                 vai trò / quyền / phân tách nhiệm vụ
             006_sessions_and_mfa.sql         phiên + TOTP
             007_outbox.sql                   transactional outbox
             008 … 048                        S1 — xem db/migrations/
             hardening.always.sql             tự-sửa hoặc phán-xét, chạy MỌI lần
```

~~**Bảy gói + hai công cụ:**~~ **[S1.28] 13 gói + 5 công cụ** — cũng suy từ `git ls-files`:

| Gói | Vai trò |
|---|---|
| `packages/tenancy` | `withTenant()` — **điểm DUY NHẤT** gắn `app.org_id`. Toàn bộ RLS của 002–007 treo vào nó |
| `packages/audit` | Sổ kiểm toán chuỗi hash chỉ-ghi-thêm, bộ kiểm chứng, `assertTenantBound` |
| `packages/identity` | RBAC, phân tách nhiệm vụ (D3) cưỡng chế bằng trigger `ENABLE ALWAYS`, TOTP theo RFC 6238, độ tươi MFA |
| `packages/crypto-keys` | `KeyProvider` + adapter `local-dev` bọc khoá theo tổ chức, có phiên bản |
| `packages/outbox` | Transactional outbox; runner chạy **trong** ngữ cảnh tenant dưới `app_api`, **không** dùng role vượt RLS |
| `packages/db` | Bộ chạy migration (advisory lock + checksum), pool |
| `packages/test-support` | Hạ tầng kiểm thử (Testcontainers). **Chỉ devDependencies** |
| `packages/supplier` | Sổ nhà cung cấp (S1.1) |
| `packages/invitation` | Lời mời + OTP cho khách (S1.3) |
| `packages/rfq` | Máy trạng thái RFQ (S1.2) |
| `packages/sealed-envelope` | Phong bì niêm phong — **hai cửa**, chỉ `index.ts` an toàn cho mọi service; cửa `unseal` tách riêng |
| `packages/bidding` | Nộp báo giá vào phong bì niêm phong |
| `packages/unseal` | Cổng chính sách D1 — `assertUnsealAllowed` chỉ có MỘT hình dạng ra ngoài, và nó là hình dạng NÉM |
| `tools/inv-matrix` | Bộ sinh ma trận bất biến + cổng CI |
| `tools/bench-keyprovider` | Đo hiệu năng bọc/mở khoá |
| `tools/bench-kms` | Đếm **số lời gọi mạng tới KMS** trong một lượt mở thầu — trục 3 của ADR-009. Mô phỏng, **không** ở CI |
| `tools/do-webcrypto` | Trang đo `crypto.subtle` trong webview thật, kèm server đột biến để chính trang đo bị thử |
| `tools/neo-so-kiem-toan` | Ký mốc neo ngoài cho sổ kiểm toán (ADR-026) |

**Hàng rào kiến trúc:** `dependency-cruiser`, tất cả theo khuôn **"mặc định đóng"** — một module
MỚI trong thư mục nhạy cảm đã bị chặn sẵn, không ai phải nhớ thêm quy tắc.
~~với bốn họ quy tắc (`g1-` crypto-keys, `g2-` identity, `g3-`
identity-không-có-năng-lực-mật-mã, `g4-` outbox)~~ **[S1.28] con số ấy đã bị GỠ khỏi đây thay vì
được cập nhật, và đó là một quyết định:** `[INV-H16]` đã cưỡng chế *mỗi gói trong `packages/` có
MỘT họ quy tắc biên giới*, nên số họ là **hệ quả của số gói** — chép nó vào đây là dựng thêm một
bản sao thứ hai để trôi. Theo ADR-029 ⑴, một con số không có lớp suy ra thì không được viết.

---

## 4. Bốn cổng — số đo tại `c4fde9c`

| Cổng | Lệnh | Kết quả (máy) | Kết quả (CI) |
|---|---|---|---|
| T0 — tĩnh | `pnpm t0` | exit 0 — 78 module / 187 phụ thuộc | ✓ 45s |
| T1+T2 — đơn vị & hợp đồng | `pnpm test` | **346 passed** / 17 file | ✓ 346 passed |
| T3 — tích hợp Postgres thật | `pnpm test:int` | **326 passed** / 11 file, 0 `Unhandled Error`, 0 `57P01` | ✓ 326 passed |
| Evidence pack | `pnpm evidence` | exit 0 — 672 khẳng định, **24/47**, ma trận khớp bộ sinh **từng byte** | ✓ (lần đầu chạy CI ở run `33221142361`) |

`pnpm test:int` **cần Docker Desktop đang chạy** (Testcontainers dựng PostgreSQL 16 thật).

---

## 5. Điều kiện hoàn thành S0 — đối chiếu thật

| # | Điều kiện | Trạng thái |
|---|---|---|
| 1 | 11 task, mỗi task một commit riêng | **ĐẠT phần chính**, vế "một commit riêng" **KHÔNG**: 11 task / 45 commit (mỗi task thêm 1–5 commit vòng fix) |
| 2 | Bốn cổng xanh tại máy **và trên CI** | **ĐẠT ĐỦ** — hai lượt CI xanh liên tiếp |
| 3 | Hai hook được kiểm chứng bằng cách **thật sự bị chặn** | **ĐẠT** (Task 1) — sự kiện lịch sử, dấu vết ở `evidence/security-reviews.md` |
| 4 | Quy tắc `khong-giai-ma-ngoai-unseal-worker` chặn thật, chứng minh bằng test đối kháng | **ĐẠT** (Task 2, Task 7 lặp lại độc lập) |
| 5 | `pnpm evidence` báo 23/44 | **ĐẠT VỀ CƠ CHẾ, SAI VỀ CON SỐ TRONG ĐIỀU KIỆN.** Thực tế **24/47** — cách đếm đã được hoà giải ở Task 11 |
| 6 | `pnpm bench:keys` đã chạy, số liệu đã ghi | **ĐẠT** |
| 7 | `docs/STATE.md` phản ánh đúng trạng thái thật | **ĐẠT ở lần cập nhật gần nhất** |
| 8 | `security-reviewer` chạy trên task 4–9, mọi CRITICAL/HIGH đã xử lý | **ĐẠT** cho 3–11. Dấu vết ở `evidence/security-reviews.md` — **có giới hạn, đọc §8 dưới đây** |

---

## 6. Cái CHƯA có — đọc kỹ phần này

Đây là phần dễ hiểu sai nhất nếu chỉ nhìn "S0 đã xong".

> **[S1.21] BA GẠCH ĐẦU DÒNG ĐẦU TIÊN CỦA MỤC NÀY ĐÃ THIU** — đo lại ngày 2026-09-07. Giữ
> nguyên chữ, gạch tại chỗ. Cùng lớp với `docs/STATE.md` mục 36: một mục *"cái CHƯA có"* mà
> không ai đối chiếu sẽ mô tả một dự án đã không còn tồn tại.

- ~~**`apps/` RỖNG.** Không một đường gọi sản phẩm nào tới `listOrganizations`, `start()` của
  outbox runner, hay `assertFreshMfa`. Các gói đã có **được test gọi, chưa có ứng dụng gọi**.~~
  **[S1.21] SAI TỪ S1.10** — `apps/` có ba tiến trình (`api`, `public-keys`, `unseal-worker`);
  `listOrganizations` được gọi ở `apps/api/src/composition.ts:96`. Khoản nợ 7.
- ~~**`apps/unseal-worker` CHƯA TỒN TẠI**, và `wrapped_private_key` cũng vậy. Hàng rào `g1-`
  đang canh **một cánh cửa chưa có phòng ở sau** — lớp phòng ngừa là thật và đã chứng minh có
  răng, nhưng tài sản nó bảo vệ thì chưa ra đời.~~ **[S1.21] SAI TỪ S1.6** — cả hai đã tồn tại;
  khoản nợ 14 đóng từ đó, và `apps/unseal-worker` THẬT SỰ import cả hai cửa hạn chế.
- ~~**Ma trận báo 24/47, không phải 47/47**~~ **[S1.21] con số ấy đã thiu; sổ đăng ký nay có
  **54** bất biến (34 nghiệp vụ + 20 hàng rào) và tỉ lệ phủ nằm ở chính `evidence/INV-matrix.md`.
  Cố ý KHÔNG chép một con số mới vào đây: chép là tạo bản sao thứ hai, và ADR-029 nói mọi bản
  sao không được đối chiếu đều trôi — đúng cách con số cũ đã trôi.** Lập luận dưới đây thì
  KHÔNG đổi, và nó vẫn là câu trả lời **đúng**:
  - **23 hàng trống**, mỗi hàng một lý do được ghim trong mã (`MA_DUOC_PHEP_CHUA_PHU`). Nhóm A,
    C1–C5, E1/E2/E4–E6 và phần lớn nhóm B chờ S1 vì **chủ ngữ của chúng chưa tồn tại**.
  - **5 mã mang cờ "phạm vi hẹp hơn mệnh đề"** (D1, D5, E3, F1, G1) — ô ✅ **không** có nghĩa
    mệnh đề đã được phủ trọn vẹn. §4 của ma trận nói rõ hẹp ở đâu.
  - Cổng evidence **đỏ theo cả hai chiều**: một mã tụt về "chưa phủ" không đi lọt được bằng
    cách thêm nó vào danh sách miễn trừ, và một mã đã phủ mà còn nằm trong danh sách cũng đỏ.
- **Chưa triển khai.** ~~Chưa chọn hạ tầng đích, chưa chọn nhà cung cấp KMS.~~ Hạ tầng và KMS
  **đã chốt** (AWS, AWS KMS `ap-southeast-1` — ADR-009), nhưng **chưa có tài khoản, chưa có CMK,
  chưa có role nào được tạo**. Chốt trên giấy không phải triển khai.
- **Chưa có khách hàng pilot.**

---

## 7. Bài học đắt nhất của giai đoạn này

**Lần chạy CI đầu tiên đỏ cả ba job, và không lỗi nào phát hiện được trên máy Windows.**

| | Lỗi | Bản chất |
|---|---|---|
| T0 | `pnpm audit --prod` đỏ vì `undici` HIGH qua `@testcontainers/postgresql` | **Khiếm khuyết đóng gói** — hạ tầng kiểm thử khai trong `dependencies`. Cổng chạy đúng thiết kế; chú thích của nó mới là thứ sai |
| T1 | Test import sai hoa-thường: `expected +0 not to be +0` | **Lớp khiếm khuyết mới: "một bảo đảm chỉ đúng trên MỘT hệ điều hành."** Trên Linux, import sai hoa-thường không resolve ⇒ không có vi phạm ⇒ *"không có vi phạm"* là kết quả **đúng**, chỉ khẳng định là sai |
| T3 | **326/326 test xanh, job vẫn đỏ** — 2 `Unhandled Error`, SQLSTATE `57P01` | Lỗi nằm **ngoài vòng đời test**. `pool.end()` không đợi backend thoát; `DROP DATABASE WITH (FORCE)` SIGTERM nó |

Cả ba đã sửa và **đã đo bằng đột biến**, không sửa mù. Nhánh đáng nhớ nhất: tắt cả hai lớp sửa
của T3 **tái lập chính xác chữ ký của CI** (15 test passed, exit 1, `Unhandled Errors`) — tức
chẩn đoán được kiểm chứng đầu-cuối chứ không suy diễn từ log.

Điểm phương pháp còn giá trị cho S1: **"mọi test xanh" không đủ để kết luận job xanh**, và
**"không thấy lỗi" không bao giờ đủ** — một lượt chạy chỉ được phân loại khi có **dấu hiệu tích
cực** rằng bộ test đã thật sự chạy. Chính ở vòng sửa này, một lượt tải log CI thất bại lặng lẽ
và file 475 byte chứa thông báo lỗi vẫn cho kết luận *"0 lỗi"* — một kết luận **xanh giả** suýt
đi vào tài liệu.

---

## 8. Giới hạn của bộ bằng chứng — nói thẳng

- `evidence/security-reviews.md` **chứng minh** các lượt review an ninh đã xảy ra trên những
  commit nêu tên, và các commit vòng fix tồn tại trong `git log`. Nó **không chứng minh** từng
  phát hiện cụ thể đã được đóng đúng — mối nối *"phát hiện thứ k ↔ dòng mã nào"* chỉ có trong
  sổ tiến trình, và **sổ tiến trình không vào git** (`.superpowers/sdd/.gitignore` là `*`).
  Đây là một **bản chép có xuất xứ**, không phải bản sao hồ sơ gốc.
- `.github/CODEOWNERS` trỏ tới team `@trustprocure/bao-mat` — **team này chưa được tạo**, nên
  tới hôm nay nó **chưa cưỡng chế được gì**. Đây là một bước cấu hình thủ công còn lại.
- CI chỉ có `ubuntu-latest`. Một bảo đảm chỉ đúng trên **Linux** thì hôm nay **không lớp nào
  bắt được**.

---

## 9. Điểm chặn và quyết định treo

1. **Chưa có khách hàng pilot** — rủi ro xây đúng thứ theo sai thứ tự, lớn hơn mọi rủi ro kỹ thuật.
2. ~~**Ba quyết định treo trước S1**: xử lý thư mục `Vibe Coding/`; **chọn nhà cung cấp KMS**
   (**ADR-009**, trạng thái *Đang mở*, giữa AWS KMS / Azure Key Vault / HashiCorp Vault);
   chọn hạ tầng triển khai.~~ **KMS và hạ tầng KHÔNG độc lập** — ADR-006 (tách quyền giải mã)
   chỉ cưỡng chế được bằng IAM của hạ tầng đích. ~~**KMS phải chốt trước S1.6.**~~

   **Đã chốt 2026-08-29 (ADR-009): AWS KMS, `ap-southeast-1`, theo mô hình envelope encryption.**
   Còn treo **một** quyết định: xử lý thư mục `Vibe Coding/`. Trục hiệu năng — thứ ADR-009 bản
   đầu nêu như một trục chặn — **đã được đo và đã đóng**: một lượt mở thầu tốn **đúng 1 lời gọi
   KMS**, không phụ thuộc số nhà cung cấp (`tools/bench-kms/dem-loi-goi-kms.mjs`). Trong lúc đo,
   một câu của chính ADR-009 bị chứng minh là sai và đã bị gạch bỏ tại chỗ, giữ nguyên văn.
3. ~~**`crypto.subtle` trong webview Zalo/Messenger chưa có một phép đo nào**~~ — rủi ro sản phẩm
   CAO, vì mã hoá được thực hiện phía trình duyệt nhà cung cấp.

   **Cập nhật 2026-08-29 — ĐÃ CÓ PHÉP ĐO TRÊN WEBVIEW THẬT.** `tools/do-webcrypto/` (máy dò đã
   chứng minh có răng bằng ba đột biến) chạy trong **Zalo iOS, WKWebView, iOS 18.7**: **ĐẠT
   toàn bộ, kể cả X25519.** Giả thuyết xấu nhất — *"webview Zalo không có `crypto.subtle`, toàn
   bộ đường nộp thầu của thị trường VN gãy"* — **đã bị bác trên đường iOS**.

   ~~**Rủi ro hẹp lại, nhưng CHƯA ĐÓNG**, và hai lý do đều cụ thể: **(a)** toàn bộ phía **Android
   còn trống** — Android System WebView cập nhật rời qua Play Store và trên máy tầm trung cũ hay
   tụt lại nhiều phiên bản; **(b)** kết quả iOS chỉ đúng cho **iOS 18.7**, không cho iPhone chạy
   iOS cũ.~~ Chưa được ghi ở đâu rằng *"đã đo trên webview Zalo"* mà không kèm hai chữ **iOS 18.7**.

   **[2026-09-08, S1.23] VẾ (a) ĐÃ ĐÓNG BẰNG MÁY THẬT, VẾ (b) ĐƯỢC CHẤP NHẬN TƯỜNG MINH —
   ADR-031.** Zalo và Messenger trên **Galaxy A02s / Android 12** (máy phổ thông giá rẻ): **ĐẠT
   toàn bộ, kể cả `X25519`**, và cả hai báo **cùng build `Chrome/151.0.7922.200`** — tức Messenger
   mượn chính System WebView, một ô nữa của bảng đo bị thu về cùng một phép đo. Nhưng đọc cho
   đúng: máy ấy có WebView **151**, tức **mới**, nên chế độ mà vế (a) thật sự nghi — **WebView tụt
   lại nhiều phiên bản** — vẫn **không có mẫu nào**. Cùng luật cũ, đổi tên: đừng ghi *"Android:
   ĐẠT"* mà không kèm **WebView 151**.

   Phép đo này còn sửa một lỗi phân loại trong chính tài liệu trước đó: trục đúng là **engine**,
   không phải tên ứng dụng. Trên iOS, Zalo và Messenger mượn **cùng một `WKWebView`** — nên một
   phép đo phủ cả hai, và hai ô đó chưa bao giờ độc lập. Nhật ký: `tools/do-webcrypto/ket-qua-do.md`.

   **HOÃN CÓ CHỦ ĐÍCH 2026-08-29** (khoản nợ 23): không có máy Android tầm trung/cũ và không có
   iPhone iOS cũ trong tay, nên phần còn lại được **chấp nhận tạm** để đi tiếp S1. Hoãn này
   **không chặn** S1.1–S1.3 (~10 ngày công), nhưng **chặn việc CHỐT ADR-011** ở S1.4 — trước
   mốc đó đổi thoả thuận khoá là sửa một ADR, sau mốc đó là một cuộc di trú.

   **Giảm nhẹ đã ghim, và đây là phần làm việc hoãn trở nên rẻ:** ADR-011 buộc phong bì **mang
   một mã thuật toán thoả thuận khoá tường minh**, cùng khuôn với `ENVELOPE_VERSION` đã có. Nếu
   Android hoá ra thiếu `X25519`, việc phải làm là **thêm một nhánh P-256** và phong bì cũ vẫn
   mở được — đúng cơ chế `MasterKeyRing` dùng để sống sót qua các lần xoay khoá (G3).

---

## 10. Nợ kỹ thuật

~~**22 khoản**~~ ~~**[S1.21] 61 khoản, trong đó 14 còn mở**~~ ~~**[S1.23] 63 khoản, trong đó 14 còn mở**~~ ~~**[S1.24] 65 khoản, trong đó 14 còn mở**~~ ~~**[S1.25] 67 khoản, trong đó 13 còn mở**~~ ~~**[S1.26] 69 khoản, trong đó 13 còn mở**~~ ~~**[S1.27] 71 khoản, trong đó 14 còn mở**~~ ~~**[S1.28] 72 khoản, trong đó 14 còn mở**~~ ~~**[S1.29] 73 khoản, trong đó 13 còn mở**~~ ~~**[S1.29] 74 khoản, trong đó 14 còn mở**~~ ~~**[S1.30] 75 khoản, trong đó 14 còn mở**~~ ~~**[S1.31] 76 khoản, trong đó 13 còn mở**~~ ~~**[S1.32] 78 khoản, trong đó 14 còn mở**~~ ~~**[S1.33] 78 khoản, trong đó 13 còn mở**~~ ~~**[S1.34] 78 khoản, trong đó 12 còn mở**~~ ~~**[S1.35] 82 khoản, trong đó 16 còn mở**~~ ~~**[S1.36] 82 khoản, trong đó 15 còn mở**~~ ~~**[S1.37] 83 khoản, trong đó 15 còn mở**~~ ~~**[S1.38] 84 khoản, trong đó 16 còn mở**~~ ~~**[S1.39] 84 khoản, trong đó 15 còn mở**~~ ~~**[S1.40] 85 khoản, trong đó 14 còn mở**~~ ~~**[S1.41] 86 khoản, trong đó 14 còn mở**~~ ~~**[S1.42] 89 khoản, trong đó 17 còn mở**~~ ~~**[S1.43] 89 khoản, trong đó 16 còn mở**~~ ~~**[S1.44] 90 khoản, trong đó 16 còn mở**~~ ~~**[S1.45] 90 khoản, trong đó 15 còn mở**~~ ~~**[S1.46] 91 khoản, trong đó 15 còn mở**~~ ~~**[S1.47] 92 khoản, trong đó 15 còn mở**~~ ~~**[S1.48] 93 khoản, trong đó 16 còn mở**~~ ~~**[S1.49] 93 khoản, trong đó 15 còn mở**~~ ~~**[S1.50] 94 khoản, trong đó 15 còn mở**~~ ~~**[S1.51] 95 khoản, trong đó 15 còn mở**~~ ~~**[S1.52] 96 khoản, trong đó 15 còn mở**~~ ~~**[S1.53] 98 khoản, trong đó 16 còn mở**~~ ~~**[S1.54] 99 khoản, trong đó 16 còn mở**~~ ~~**[S1.55] 99 khoản, trong đó 15 còn mở**~~ ~~**[S1.56] 101 khoản, trong đó 16 còn mở**~~ ~~**[S1.57] 101 khoản, trong đó 15 còn mở**~~ ~~**[S1.58] 102 khoản, trong đó 15 còn mở**~~ ~~**[S1.59] 104 khoản, trong đó 16 còn mở**~~ ~~**[S1.60] 104 khoản, trong đó 15 còn mở**~~ ~~**[S1.61] 105 khoản, trong đó 15 còn mở**~~ **[S1.62] 105 khoản, trong đó 14 còn mở** — đầy đủ ở `docs/STATE.md` §*Nợ kỹ
thuật*, và dòng `**CÒN MỞ TÍNH TỚI HEAD:**` ở đó là lời khai DUY NHẤT được `[INV-H20]` đối
chiếu với bảng. Mỗi khoản là một **khoảng trống đã đo**, không phải linh cảm.

**Năm khoản nặng nhất — viết ở cuối S0, và [S1.21] rà lại thì BỐN trong năm đã đóng.** Danh
sách này giữ nguyên chữ để đối chiếu; nó là ví dụ gọn nhất của thứ ADR-029 nói: một bản sao
không được đối chiếu thì trôi, và ở đây nó trôi **bốn phần năm**.

1. ~~**Artefact neo ngoài của B3 chưa tồn tại.** Cơ chế đã có, artefact thì chưa — không có nó,
   một chuỗi hash hợp lệ **không chứng minh gì** trước một chủ sở hữu bảng.~~ **[S1.21] ĐÓNG từ
   S1.17 (ADR-026)** — khoản nợ 11.
2. ~~**Vế *giới hạn tần suất* của E3 không có một dòng mã nào** trong toàn S0.~~ **[S1.21]
   ĐÓNG** — `otp_rate_limits` (S1.3) cho đường lời mời, `callerLimit` 30/15 phút cho
   `/auth/totp` (S1.12, khoản nợ 39). Đây là **một trong bảy** bản sao của cùng lời khai
   đã thiu; xem `docs/STATE.md` mục 36.
3. **Không lớp máy nào cưỡng chế quy ước `OPERATOR(pg_catalog.=)`** — chú thích + test là tất
   cả những gì đang giữ nó. **[S1.21] VẪN MỞ (khoản nợ 8), và nay là khoản nợ S0 nặng nhất còn
   lại** — 15 tệp sản xuất giữ quy ước ấy bằng tay, không lớp nào bắt tệp thứ 16 quên.
4. ~~**Hai mặt tiền chịu lực nhất repo không có lớp nào canh đường vào**: `with-tenant.ts` (điểm
   duy nhất gắn `app.org_id`) và `audit/writer.ts`. Chỉ 3/7 gói có quy tắc biên giới.~~ **[S1.21]
   ĐÓNG từ S1.18 (ADR-027)** — khoản nợ 17; số họ quy tắc biên giới 5 → 9, `MIEN_TRU` về RỖNG.
5. ~~**Bốn mục hardening theo khuôn danh-sách-tên**, nặng nhất: hình dạng bảng sổ chỉ **ĐẾM** cột,
   **không cấm cột thừa** ⇒ thêm một cột `payload_plaintext` vào `audit_events` **không bị mục
   nào chạm**.~~ **[S1.21] ĐÓNG từ S1.20 (ADR-028, migration `047`)** — khoản nợ 16; và ca
   `payload_plaintext` được đóng đúng bằng `CAU_COT_NGOAI_CHUOI`.

~~Còn mở từ vòng CI: **(20)** không lớp nào canh "bảo đảm chỉ đúng trên một hệ điều hành";
**(21)** chỉ `pnpm audit --prod` chặn được hạ tầng kiểm thử lọt vào phạm vi sản xuất, và nó chỉ
nổ khi *tình cờ* có advisory.~~ **[S1.21] cả (20) lẫn (21) ĐÃ ĐÓNG từ 2026-09-05** —
`tests/architecture/bao-dam-mot-he-dieu-hanh.test.ts` và
`tests/architecture/pham-vi-san-xuat.test.ts`. **(22) đã đóng** — job `evidence` nay đã chạy
trên CI.

---

## 11. Việc kế tiếp

> **Bốn việc đầu đã được xử lý ngày 2026-08-29. Giữ nguyên văn, đánh dấu tại chỗ.**

1. ~~**Quyết định merge PR #1.** Nhánh xanh, `MERGEABLE`, chưa merge.~~ **ĐÃ MERGE** —
   merge commit `30d1972`, giữ nguyên 46 commit (**không** squash: `evidence/security-reviews.md`
   trỏ tới từng SHA, squash sẽ làm mọi con trỏ đó chết). Nhánh `worktree-s0-foundation`
   **không xoá**; worktree vẫn được giữ lại có chủ đích.
2. ~~**Lập kế hoạch S1 (Sealed Bid Core).**~~ **XONG** —
   `docs/superpowers/plans/2026-08-29-s1-sealed-bid-core.md`, 10 mục.
3. ~~**Chốt ba quyết định treo** — KMS trước S1.6.~~ **XONG HAI TRONG BA** — AWS + AWS KMS
   `ap-southeast-1` (ADR-009). Còn treo: xử lý thư mục `Vibe Coding/`.
4. ~~**Đo `crypto.subtle` trong webview Zalo/Messenger.**~~ ~~**CÔNG CỤ XONG, PHÉP ĐO CHƯA** —
   `tools/do-webcrypto/`. Rủi ro **vẫn CAO và vẫn mở** cho tới khi có kết quả từ điện thoại thật.~~
   **[2026-09-08, S1.23] PHÉP ĐO XONG** — sáu dòng trong `tools/do-webcrypto/ket-qua-do.md`, ba
   dòng mới trên máy thật (Zalo/Android, Messenger/Android, Chrome iOS). Rủi ro sản phẩm số 3
   xuống **TRUNG BÌNH**; khoản nợ 23 **ĐÓNG** (ADR-031). Việc còn lại không phải một phép đo nữa
   mà là **mã của S1.4/S1.5**: chạy phép dò trước khi cho nộp, chuyển hướng sang trình duyệt ngoài
   khi phán quyết không phải *"Nộp thầu được"*.
5. **Tiếp cận khách hàng pilot** song song với S1. — **chưa làm**, và vẫn là rủi ro lớn nhất.
6. Hai việc cấu hình nhỏ, không chặn: **tạo team `@trustprocure/bao-mat`** trên GitHub để
   CODEOWNERS có răng; cân nhắc **thêm `windows-latest`** vào ma trận job T1+T2 (khoản nợ 20).
7. ~~**Mới:** chốt **ADR-010** trước S1.6, **ADR-011** trong S1.4, **ADR-012** trong S1.1~~ —
   **ADR-010 và ADR-012 đã chốt** ngày 2026-08-29. **ADR-011** để ***Đang mở*** có chủ đích:
   nó bị khoản nợ 23 chặn, và phần ghim được thì đã ghim.
8. ~~**Mới:** bắt đầu **S1.1** và **S1.2** — hai hạng mục duy nhất không bị chặn bởi quyết định nào.~~
   **Câu vừa gạch hẹp hơn thực tế:** không bị ADR *đang mở* chặn không có nghĩa là không có quyết
   định phải ra. S1.1 mang câu hỏi **phạm vi sổ nhà cung cấp**, S1.2 mang câu hỏi **máy trạng thái
   cưỡng chế ở đâu**, S1.3 mang câu hỏi **kênh OTP** — cả ba phải chốt trước migration `008`.
   **Đã chốt 2026-08-29: ADR-013, ADR-014, ADR-015.**
9. ~~**Mới:** bắt đầu **S1.1**, **S1.2**, **S1.3**.~~ **XONG CẢ BA (2026-08-29)** — ba commit,
   ba migration (`008`, `009`, `010`), ba gói (`supplier`, `rfq`, `invitation`), độ phủ
   24/47 → **30/50**. Chi tiết ở `docs/STATE.md`.

10. ~~**MỘT BƯỚC BẮT BUỘC CỦA VÒNG LẶP ĐÃ KHÔNG CHẠY.**~~ **ĐÃ CHẠY (2026-08-29)** — ba lượt,
    một cho mỗi hạng mục, kết quả ở `evidence/security-reviews.md` §S1. Tổng **4 CRITICAL +
    11 HIGH**; **4/4 CRITICAL và 10/11 HIGH đã đóng** ở `011_rfq_hardening.sql`,
    `012_invitation_hardening.sql` và ba gói. HIGH còn lại **bị phép đo bác bỏ**.

    **Ba MEDIUM cố ý không sửa** vì mỗi cái là một quyết định kiến trúc: cổng quyền của
    `packages/supplier` nằm ở gói hay ở tầng API; chính sách nào tính `requires_dual_approval`;
    pepper cho băm đích của bộ đếm hạn mức. ~~Cả ba cần một ADR — đây là việc kế tiếp có tên.~~
    **ĐÃ CHỐT 2026-08-30: ADR-016, ADR-017, ADR-018.**

    **Ba ADR ấy QUYẾT, chúng CHƯA CÀI** — lượt đó không đổi một dòng mã sản phẩm nào. Ba MEDIUM
    vẫn **mở** cho tới khi mỗi ADR có lượt **RED thật** theo §*Đo bằng gì* của nó. Ba việc rời:
    ADR-016 buộc `SupplierActor`/`InvitationActor` đi theo đường `createdBySessionId` mà 011 đã mở
    cho `RfqActor`, cộng một lớp canh route **đến hạn cùng route đầu tiên của `apps/`**; ADR-017 là
    một migration đánh số mới (`org_procurement_policies` + `rfq_packages.estimated_value`);
    ADR-018 là HMAC + pepper có phiên bản **hoặc** bỏ hẳn `destination_hash` — cột ấy **gần như dư**
    sau khi 011 thu hồi `UPDATE` trên `supplier_contacts`.

    **ĐÃ CÀI CẢ BA (2026-08-30)** — ba migration (`013`, `014`, `015`), bốn gói sửa, **31 test mới**,
    trong đó **ba test đột biến** và **năm phép đo bằng SQL viết tay**. `pnpm evidence` thoát mã 0,
    **789 khẳng định**, độ phủ **đứng yên ở 30/50** — và đó là phát biểu đúng: sổ đăng ký không có
    mệnh đề nào nói "danh tính là dẫn xuất".

    **Lượt cài tìm ra BA thứ mà ba lượt review KHÔNG tìm ra**, và cả ba nói về giới hạn của hình
    thức review theo từng hạng mục: ⑴ `packages/rfq` mang **đúng** khiếm khuyết MEDIUM-3 nêu cho
    `packages/supplier` — **vẫn MỞ**; ⑵ `code_hash` của OTP cũng đảo ngược được (sáu chữ số, 10⁶),
    đã đóng cùng lượt; ⑶ `estimated_value` **không** bảo vệ được bằng quyền theo cột như ADR-017
    hứa, vì đường khách và đường người mua dùng **chung role `app_api`**.

10b. **Nguyên văn cũ, giữ để đối chiếu:**
    §9 của kế hoạch S1 đòi **`security-reviewer`** cho mọi hạng mục có dấu ⭐, và **S1.3 có dấu
    đó** (lời mời, magic link, OTP, phiên khách — chạm xác thực và PII). Lượt review ấy **chưa
    xảy ra**: phiên làm việc này chạy dưới một ràng buộc không cho gọi subagent trừ khi người
    dùng yêu cầu. Đây **không** phải một khoản nợ kỹ thuật; nó là một **điều kiện hoàn thành S1
    chưa đạt** (mục 6 của §7 kế hoạch S1), và `evidence/security-reviews.md` chưa có dòng nào cho
    S1.1–S1.3. Ai tiếp tục việc này phải chạy `security-reviewer` cho S1.3 (và nên chạy cho cả
    S1.1/S1.2) rồi ghi vào file đó theo đúng định dạng đã có.

11. ~~**Hạng mục kế tiếp là S1.4 và nó BỊ CHẶN.**~~ ~~**HẾT CHẶN 2026-09-04.**~~ **S1.4 ĐÃ XONG
    PHẦN MÃ 2026-09-04** — `packages/sealed-envelope`, migration `017`, ADR-019. Ba mã nghiệp vụ
    được lấp (C5, G2, G4), độ phủ **33/50**, và **13 mã mục tiêu của S0 nay không còn mã nào
    trống**. Hai khoản nợ có tên cũng đóng cùng lượt: `[NỢ ADR-006]` (hai role DB nay thật sự
    không role nào bao trùm role kia) và vế *"tài sản được bảo vệ chưa tồn tại"* của ghi chú §4
    cho G1. Đổi lại, G1 có một vế **thu hẹp MỚI** — xem ADR-019. Nguyên văn cũ: ADR-011 chốt
    **"P-256 mặc định, X25519 cơ hội"** — câu hỏi được **gỡ bỏ** chứ không được trả lời: thế
    hoặc/hoặc là do chính ADR tự đặt ra, và hỗ trợ cả hai thuật toán (chọn bằng máy dò lúc chạy)
    xoá hẳn phụ thuộc vào phép đo Android. ~~Khoản nợ 23 **vẫn mở**, chỉ thôi chặn.~~ **[S1.23]
    Khoản nợ 23 ĐÓNG — ADR-031.** Nguyên văn cũ: ADR-011 vẫn *Đang mở*, và nó chỉ được chốt sau
    khi có kết quả đo WebCrypto trên **webview Android** (khoản nợ 23). Sau khi đã có phong bì
    thật thì đổi thoả thuận khoá là một cuộc di trú, không phải sửa một ADR.

---

**[S1.42] Nhịp lượt soi NGANG (lượt 25 ở S1.35, lượt 33 ở S1.42):** sau mỗi năm–sáu vòng dọc, hoặc sớm hơn khi
`hardening.always.sql` đổi ba lần liên tiếp — lượt ngang hỏi "đặt các lớp cạnh nhau thì cái nào lách được cái nào"
và "lời khai nào rộng hơn mã"; hai lượt đầu đều tìm ra thứ bảy lượt dọc trước đó không thấy. ~~Lượt kế: sau S1.47.~~ **[S1.48]** Lượt 40 chạy sau S1.47 (S1.43–S1.47 đổi hardening NĂM lần liên tiếp — điều kiện "ba lần" đã thoả từ S1.45; năm vòng cố ý gộp vì cùng chủ đề danh tính/GUC, lịch thắng điều kiện — 40b #16); lượt 40 tìm ra một hồi quy I1 do chính S1.47 tạo. Lượt kế: sau ba vòng đổi hardening nữa, hay chậm nhất S1.52.

## 12. Bắt đầu lại từ đầu như thế nào

```bash
pnpm install
pnpm t0          # tsc + eslint + dependency-cruiser
pnpm test        # 346, không cần Docker
pnpm test:int    # 326, CẦN Docker Desktop đang chạy
pnpm evidence    # sinh lại ma trận + cổng evidence
```

**Hai điều dễ vấp:**

- **Checkout mới trên Windows: mọi file `.ts` sẽ là CRLF.** `.gitattributes` chỉ ghim `*.sql`
  và `evidence/INV-matrix.md`. Đây không phải lỗi, nhưng mọi công cụ đo byte phải dùng **công
  cụ nhị phân** (node / `tr -cd`), **không** dùng `grep`/`sed`/`cat -A` của MSYS — chúng mở file
  ở text mode và **giấu CR**.
- **`evidence/INV-matrix.md` là artefact được commit và KHÔNG được sửa tay.** CI sinh lại rồi
  so **byte** với bản trong git. Một lần sửa tay — kể cả chỉ để bảng đẹp hơn — sẽ làm CI đỏ.

---

## 13. Đọc gì, theo thứ tự

| Tài liệu | Vì sao |
|---|---|
| `docs/STATE.md` | **Đọc đầu tiên.** Sổ trạng thái đầy đủ: điều kiện hoàn thành, điểm chặn, ~~22 khoản nợ~~ ~~**[S1.21] 61 khoản nợ, 14 còn mở**~~ ~~**[S1.27] 71 khoản, trong đó 14 còn mở**~~ ~~**[S1.28] 72 khoản, trong đó 14 còn mở**~~ ~~**[S1.29] 73 khoản, trong đó 13 còn mở**~~ ~~**[S1.29] 74 khoản, trong đó 14 còn mở**~~ ~~**[S1.30] 75 khoản, trong đó 14 còn mở**~~ ~~**[S1.31] 76 khoản, trong đó 13 còn mở**~~ ~~**[S1.32] 78 khoản, trong đó 14 còn mở**~~ ~~**[S1.33] 78 khoản, trong đó 13 còn mở**~~ ~~**[S1.34] 78 khoản, trong đó 12 còn mở**~~ ~~**[S1.35] 82 khoản, trong đó 16 còn mở**~~ ~~**[S1.36] 82 khoản, trong đó 15 còn mở**~~ ~~**[S1.37] 83 khoản, trong đó 15 còn mở**~~ ~~**[S1.38] 84 khoản, trong đó 16 còn mở**~~ ~~**[S1.39] 84 khoản, trong đó 15 còn mở**~~ ~~**[S1.40] 85 khoản, trong đó 14 còn mở**~~ ~~**[S1.41] 86 khoản, trong đó 14 còn mở**~~ ~~**[S1.42] 89 khoản, trong đó 17 còn mở**~~ ~~**[S1.43] 89 khoản, trong đó 16 còn mở**~~ ~~**[S1.44] 90 khoản, trong đó 16 còn mở**~~ ~~**[S1.45] 90 khoản, trong đó 15 còn mở**~~ ~~**[S1.46] 91 khoản, trong đó 15 còn mở**~~ ~~**[S1.47] 92 khoản, trong đó 15 còn mở**~~ ~~**[S1.48] 93 khoản, trong đó 16 còn mở**~~ ~~**[S1.49] 93 khoản, trong đó 15 còn mở**~~ ~~**[S1.50] 94 khoản, trong đó 15 còn mở**~~ ~~**[S1.51] 95 khoản, trong đó 15 còn mở**~~ ~~**[S1.52] 96 khoản, trong đó 15 còn mở**~~ ~~**[S1.53] 98 khoản, trong đó 16 còn mở**~~ ~~**[S1.54] 99 khoản, trong đó 16 còn mở**~~ ~~**[S1.55] 99 khoản, trong đó 15 còn mở**~~ ~~**[S1.56] 101 khoản, trong đó 16 còn mở**~~ ~~**[S1.57] 101 khoản, trong đó 15 còn mở**~~ ~~**[S1.58] 102 khoản, trong đó 15 còn mở**~~ ~~**[S1.59] 104 khoản, trong đó 16 còn mở**~~ ~~**[S1.60] 104 khoản, trong đó 15 còn mở**~~ ~~**[S1.61] 105 khoản, trong đó 15 còn mở**~~ **[S1.62] 105 khoản, trong đó 14 còn mở** |
| `docs/PRODUCT.md` | Định vị, phạm vi, **những điều không được tuyên bố** |
| `docs/TIEN-DE-CHUA-DO.md` | **17 tiền đề về con người và quy trình mà S1 đang cư xử như thật** — mỗi dòng một địa chỉ trong kho và một câu hỏi cho người mua thật. Không thay pilot; nó hạ chi phí buổi đầu |
| `docs/ARCHITECTURE.md` | Kiến trúc: modular monolith, `unseal-worker` giữ độc quyền giải mã, RLS đa tổ chức |
| `docs/DECISIONS.md` | ~~**Chín ADR** — 001–008 *Đã chấp nhận*, **009 (KMS) *Đang mở*, chặn S1.6**~~ → ~~**Mười hai ADR**~~ ~~**Mười lăm ADR**~~ ~~**Mười tám ADR**~~ ~~**[S1.28] 34 ADR**~~ ~~**[S1.29] 35 ADR**~~ ~~**[S1.32] 36 ADR**~~ **[S1.43] 37 ADR**: 001–010 và 012–018 *Đã chấp nhận* (009 chốt **AWS KMS**); **011** ***Đang mở***, chặn S1.4/S1.5. **013/014/015** là ba quyết định của ba hạng mục sớm nhất: phạm vi sổ NCC, nơi cưỡng chế máy trạng thái RFQ, kênh OTP + nền giới hạn tần suất. **016/017/018** là ba quyết định của ba MEDIUM mà vòng sửa an ninh cố ý không đóng bằng mã: cổng quyền ở tầng ứng dụng + danh tính là dẫn xuất, chính sách tính `requires_dual_approval`, pepper cho băm đích |
| `docs/TEST-PLAN.md` | ~~**Sổ đăng ký 47 bất biến** (34 nghiệp vụ + 13 hàng rào)~~ ~~**[S1.28] Sổ đăng ký 55 bất biến** (34 nghiệp vụ + 21 hàng rào)~~ **[S1.29] Sổ đăng ký 56 bất biến** (34 nghiệp vụ + 22 hàng rào) — nguồn sự thật duy nhất |
| `evidence/INV-matrix.md` | Ma trận bất biến; **§3 = danh sách việc của S1**, §4 = phạm vi hẹp |
| `evidence/security-reviews.md` | Dấu vết review an ninh, kèm giới hạn của chính nó |
| `db/migrations/hardening.always.sql` | ~~36 mục~~ **[S1.28] các mục** cưỡng chế chạy ở **mọi** lần `migrate()` — số mục không có lớp nào suy ra được, nên nó không được viết ra đây |
| `docs/superpowers/specs/2026-08-26-trustprocure-s0-s1-design.md` | Đặc tả thiết kế S0+S1 đã duyệt |

---

## 14. Quy ước bắt buộc — người tiếp theo phải giữ

- **Không module nào ngoài `apps/unseal-worker/**` được import `@trustprocure/crypto-keys/unwrap`.**
- **Không bao giờ ghi log:** giá, mật khẩu, token, mã OTP, khoá, bí mật TOTP.
- **Hai DB role `app_api` / `app_unseal`**, không role nào bao role kia; không role nào có
  UPDATE/DELETE/TRUNCATE trên `audit_events`.
- **Mọi bảng có `org_id` phải có CẢ `ENABLE` LẪN `FORCE ROW LEVEL SECURITY`.**
- TypeScript strict, không `any` tường minh, không `@ts-ignore` không giải thích.
- **Ngôn ngữ:** mặt tiền công khai (tên export, kiểu, trường interface, mã quyền, tên
  bảng/cột/hàm SQL) bằng **tiếng Anh**; biến cục bộ, tên test, chú thích, thông điệp commit
  bằng **tiếng Việt**.
- Test kiểm chứng bất biến mang nhãn `[INV-XX]`.
- **`.sql`, chú thích, tên test và `evidence/INV-matrix.md` là BẰNG CHỨNG KIỂM TOÁN.** Một câu
  phát biểu rộng hơn thứ được đo là **một khiếm khuyết thật**. Trong S0 đã có **19 câu như vậy
  bị bắt và hạ xuống đúng mức** — và quy ước là **gạch bỏ tại chỗ, giữ nguyên văn**, không xoá.

---

## 15. [2026-09-05] S1 ĐÃ ĐI HẾT CHÍN HẠNG MỤC — và người tiếp theo phải đọc bốn dòng này trước

1. **Bốn lượt `security-reviewer` đã chạy và tìm ra BẢY mức HIGH; cả bảy đã đóng bằng mã**
   (`db/migrations/022_security_review_s1.sql` cộng bảy file). Bảng ở
   `evidence/security-reviews.md`. **Đừng đọc bảng ấy như một chứng chỉ**: cả bốn reviewer
   không có Bash và không có CSDL — họ đọc mã, không đo. ~~Mã MEDIUM/LOW chưa đóng nằm ở sổ nợ
   `docs/STATE.md` khoản **31–37**, và khoản **31** là khoản nặng nhất còn mở.~~ **Câu vừa gạch
   đã thiu ngay trong ngày nó được viết:** cả bảy khoản **31–37** đã đóng bằng mã cùng ngày
   2026-09-05 (`06ef869` cho 31, `c9ab088` cho 32–37 — xem sổ nợ `docs/STATE.md`). ~~Hai khoản
   còn mở của toàn bộ sổ nợ 20–37 là **23** (Android WebCrypto — cần một máy thật) và nửa sau
   của **30** (neo ngoài — cùng khoản với 11).~~ **[2026-09-07, S1.17] Khoản 11 ĐÃ ĐÓNG** (artefact
   neo ngoài cho sổ kiểm toán: mốc neo ĐƯỢC KÝ + nơi cất CHỈ-GHI-THÊM + entry point — ADR-026), và
   **nửa sau của 30 thì KHÔNG**, dù hai khoản này từng được viết như một. Chúng khác nhau về đối
   tượng: 11 nói về artefact neo cho SỔ, 30 nói về artefact neo cho KHOÁ CÔNG KHAI. Cái thứ hai
   không có đường nào đóng bằng mã — nó là một `fingerprint` đi ra khỏi hệ thống (in vào hợp đồng,
   đọc qua điện thoại). Hai khoản còn mở nay là **23** và nửa sau của **30**, và **cả hai đều không
   phải việc của mã nguồn**. Đọc mục 5 dưới đây trước khi tin bất kỳ con số
   "đã đóng" nào.

2. **Một câu SAI do chính dự án viết đã đứng ở BA chỗ và biện minh cho việc bỏ một lớp.**
   *"`app_unseal` cố ý không đọc được `users`"* — `006:232` và `006:305` nói ngược lại, và 006
   ghi rõ là cấp *"vì bất biến D1"*. Ba bản sao nay bị gạch bỏ tại chỗ. Bài học có thể tái dùng:
   **một câu nói về GRANT phải được đối chiếu với chính file migration, không với trí nhớ** —
   và một câu sai được chép ba lần thì khó bắt hơn một câu sai đứng một mình.

3. ~~**Ba mã bất biến còn trống, và cả ba trống vì KIẾN TRÚC:** `A2` (đòi một tiến trình `api`
   đang chạy để gắn APM vào), `A5` (đòi role `app_guest` — nợ 29), `E6` (đòi một URL).~~ **Còn
   HAI** sau khi khoản 29 đóng `A5` ở `623458b` (bằng policy `AS RESTRICTIVE`, KHÔNG bằng role
   `app_guest` — sổ nợ ghi vì sao): `A2` và `E6`, cả hai đòi một tiến trình `api` có URL. Không mã
   nào trống vì thiếu thời gian, và §3 của ma trận nói ra từng lý do. Độ phủ **48/50**.

4. **Hai thứ CHƯA CÓ NGƯỜI TIÊU THỤ, và cả hai là ý định chứ chưa là hành động:**
   `BREAK_GLASS_UNSEAL_ALERT` (nợ 34) và `RFQ_DEADLINE_EXTENDED_NOTICE`. Một job không có
   handler bị `JobRunner` ghi thẳng `FAILED` **trong im lặng** — nên phải nối handler TRƯỚC khi
   đường break-glass được dùng thật, không phải sau. **[Cùng ngày] Khoản 34 đã đóng** ở
   `c9ab088` (`apps/unseal-worker/src/composition.ts` + migration `025`): cả hai `kind` có
   handler, và `onJobFailure` là tham số BẮT BUỘC nên cấu hình *"hỏng trong im lặng"* không còn
   diễn đạt được. Giữ nguyên văn ở trên vì lý do *"nối handler trước khi dùng thật"* vẫn đúng.

5. **[2026-09-06] Commit `623458b` được ĐẨY LÊN mà chưa chạy lại tầng T1 — và CI đã bắt.**
   Mô tả PR #2 khai *"1056/1056 khẳng định xanh"* cho commit ấy; con số ấy là thật cho lượt
   `pnpm evidence` **trước** khi `apps/public-keys` được thêm vào, không phải cho cây mã đã đẩy.
   Run `33978573210` đỏ T1+T2 trên cả hai hệ điều hành: lớp canh route
   (`tests/architecture/cong-quyen-route.test.ts`) nổ đúng mốc chết *"apps/ có app khác ngoài
   worker"*, và trên Windows thêm ba khẳng định của `hinh-dang-ci.test.ts` đỏ vì `ci.yml` dạng
   CRLF ở checkout mới (khoản nợ 10). Job `evidence` vì thế bị **bỏ qua**, tức con số 48/50 của
   commit ấy **chưa từng được CI xác nhận** cho tới `83e4cba`. Cả hai đã sửa ở `83e4cba` — chỉ
   hai file test, không một dòng mã sản phẩm — và run `34004571171` xanh cả sáu job.

   Bài học, cùng họ với §7: **một lượt đo trên cây mã CŨ không phải bằng chứng cho cây mã ĐẨY
   LÊN.** Lệnh cuối trước `git push` phải là lệnh đo trên đúng HEAD sắp đẩy, và hai mốc chết ở
   đây nổ đúng như thiết kế — đó là điều đáng ghi, không phải điều đáng giấu.

6. **[2026-09-06] VÒNG S1.10 ĐÃ BẮT ĐẦU, và hạng mục 10.2 đã có mã.** ADR-020 (tầng HTTP: `node:http`
   trần + bảng route KHAI BÁO, phiên người mua bằng magic link email + TOTP, token vào fragment,
   đường khách chỉ nhận `client` đã gắn phiên) chốt cùng ngày; kế hoạch bảy hạng mục ở
   `docs/superpowers/plans/2026-09-06-s1.10-tang-http.md`. `apps/api` ra đời với bốn route đo khung,
   lớp canh `g9-`, sổ đăng ký nở lên **51** (H17), độ phủ **50/51**. Chi tiết và ba thứ tìm ra bằng
   cách chạy: `docs/STATE.md` §*Hành động tiếp theo* mục 15–16. Người tiếp theo bắt đầu ở **S1.10.3**
   (đường khách) hoặc **S1.10.4** (đăng nhập người mua ⭐) — hai hạng mục ấy độc lập nhau.

7. **[2026-09-06, cuối ngày] S1.10 ĐÃ ĐI HẾT BẢY HẠNG MỤC.** Độ phủ **51/51** — danh sách được-phép-
   chưa-phủ RỖNG lần đầu; kịch bản mục 41 chạy trọn **qua HTTP** với năm lần đăng nhập TOTP thật và
   năm phiên khách thật; hai lượt security-reviewer (10.3+10.4; 10.5+10.6+vòng sửa) ở
   `evidence/security-reviews.md`. Sổ nợ nhận ~~**38–43**~~ **38–49** (lượt 2 thêm 44–49; ~~**44 là một
   QUYẾT ĐỊNH đang chờ**: PM giữ cả `policy.manage` lẫn `rfq.create`~~ **44 đóng cùng ngày bằng `033`,
   PR #5**: `policy.manage` sang FINANCE + hai trigger) — toàn bộ là phần chênh review
   chỉ ra và được viết thành tên. Lượt 2 bắt được BA chỗ vòng sửa 1 đóng sai (M-4, M-5/031, §4 A2)
   — đã sửa, migration `032`. Ba thứ đọc trước khi tin con số 51/51: A2 mang cờ §4 (heap/APM chưa đo); E6
   mang cờ (trang `/i#<token>` là tầng web chưa có); đường ghi của khách chạy dưới `withTenant`
   không GUC (lý do đo được ở 028). Chi tiết: `docs/STATE.md` mục 16–21.

8. **[2026-09-06, tối] S1.11 — `apps/api` có `main`.** `pnpm api:dev` khởi động tiến trình từ biến
   môi trường (`apps/api/.env.example` liệt kê đủ), kết nối bằng role đăng nhập `app_api_login` và
   `SET ROLE app_api` ở mỗi kết nối. Đọc ADR-021 trước khi chạm `composition.ts`. Một khe hở lộ ra
   khi nối dây và đã đóng (nợ 50, migration `037`): hai trigger 029/032 từng chỉ nhìn thấy cái TÊN
   `app_api`, không nhìn thấy role đăng nhập kế thừa nó — bài học: **một vị từ theo TÊN role chỉ
   đúng trên đường có `SET ROLE`; đường sản xuất phải được đo với role đăng nhập THẬT** (nay
   `vai-tro.int.test.ts` và `composition.int.test.ts` đều tạo `app_api_login` thật).

9. **[2026-09-07] S1.12 — sổ nợ 38–50 KHÔNG còn khoản nào mở.** Bảy khoản trả trong một PR, mỗi khoản
   một commit và một đột biến RED thật. Ba thứ người tiếp theo phải biết trước khi chạm tầng đăng nhập:
   ⑴ `/auth/link` KHÔNG tra người dùng — nó enqueue; link ra đời khi runner chạy (test gọi
   `outboxTest(...).chay(orgId)` tường minh, tiến trình thật tự đánh thức sau commit); ⑵ hạn mức theo
   người gọi đếm ở DISPATCHER trong giao dịch riêng — thêm một route `/auth/*` là khai `callerLimit`;
   ⑶ một phiên đã-MFA do `app_api` chèn phải đi sau một `verifyTotpAttempt` thành công trong 90 giây
   (039) — fixture chèn phiên dưới `app_api` phải gieo hồ sơ TOTP tươi, còn superuser thì không.
   ADR-022 ghi bốn quyết định; `evidence/security-reviews.md` §S1.12 ghi lượt review thứ tư (0 CRITICAL/HIGH,
   4 MEDIUM, 8 LOW — cả mười hai đóng trong cùng PR; sổ nợ mới 51–53 là ba phần chênh). Bài học của lượt ấy
   cho người tiếp theo: "CSDL cưỡng chế" phải cưỡng chế ĐÚNG VẾ — 040 cưỡng chế "hai người, hai phiên" mà
   không "hai người CÓ QUYỀN", và vế thiếu ấy là vế duy nhất còn nghĩa khi `app_api` bị chiếm (H4-1).

10. **[2026-09-07] S1.13 — sổ nợ 51–53 (ba phần chênh của review lượt 4) ĐÓNG cùng ngày, ADR-023.** Hai
    thứ đổi HỢP ĐỒNG mà người tiếp theo phải biết: ⑴ `JobHandler` của `@trustprocure/outbox` nay được
    trả về một hàm — runner gọi nó SAU khi job đã DONE và commit, ngoài giao dịch, có trần; hàm ấy
    ném thì job KHÔNG chạy lại (`AFTER_COMMIT_FAILED` chỉ tới `onJobFailure`). Đặt vào đó đúng những
    tác dụng phụ không rollback được (gửi mail/SMS), không đặt việc ghi CSDL; ⑵ mọi route ANON có
    credential trong thân nay có `callerLimit`, `/auth/link` có thêm `orgLimit`, và tổ chức lạ bị đếm
    trong bộ nhớ — thêm một route ANON là khai hai trần ấy. Thân hàm trigger của 039/040/041 nay được
    hardening ghim: sửa một thân là sửa Ở HAI CHỖ (migration mới + mục hardening), và test đồng bộ sẽ
    đỏ nếu quên. `evidence/security-reviews.md` §S1.13 ghi lượt review thứ năm (1 HIGH, 1 MEDIUM, 4 LOW —
    cả sáu đóng cùng PR; nợ mới 54–55). Bài học của lượt ấy: một TRẦN CHẶN theo tổ chức trên đường xác thực
    là vũ khí khoá cửa cho bất kỳ ai biết `orgId` — và `orgId` nằm trong cookie của mọi NCC; hạn mức theo
    đích chỉ được làm chậm (ADR-015 §5). Và: tiền điều kiện "đối tượng đã tồn tại" ở hardening là ca im lặng
    khi đối tượng bị xoá — dùng "migration nguồn đã áp dụng".

11. **[2026-09-07] S1.14 — sổ nợ 54–55 đóng, ADR-024.** Hai thứ người tiếp theo phải biết: ⑴ có một
    bảng CSDL nằm NGOÀI cây tenant mà `app_api` ghi được — `caller_rate_limits` (042). Mọi lớp canh
    "bảng tenant" của dự án đọc theo cột `org_id`, nên bảng ấy không nằm trong chúng; nếu bạn thêm một
    bảng như thế nữa, hãy đọc ADR-024 §1 trước và nhớ rằng một phép đo từng giả định "bật RLS ⇒ thuộc
    cây tenant" (ca R3 ở `db/migrations.int.test.ts`); ⑵ thêm một hàm `RETURNS trigger` vào bất kỳ
    migration nào SẼ làm test "[S1.14 / nợ 54]" đỏ cho tới khi bạn hoặc ghim nó ở
    `hardening.always.sql`, hoặc khai nó vào `HAM_TRIGGER_KHONG_GHIM` kèm một dòng nói nó canh gì.
    Đó là cố ý: hai lượt trước danh sách ghim thiếu đúng thứ vừa thêm mà không lớp nào kêu.

12. **[2026-09-07] S1.15 — sổ nợ 56–57 đóng, ADR-025.** Ba thứ người tiếp theo phải biết:

    ⑴ **`HAM_TRIGGER_KHONG_GHIM` nay RỖNG.** Thêm một hàm `RETURNS trigger` vào bất kỳ migration nào
    làm test đầy đủ đỏ, và đường đi đúng nay CHỈ CÒN MỘT: ghim thân nó ở `hardening.always.sql` theo
    khuôn của khối `[S1.15 / sổ nợ 56]`, và khai nó vào `HAM_56` ở `db/migrations.int.test.ts`. Khai
    vào danh sách loại trừ vẫn viết được, nhưng nó sẽ làm một khẳng định KHÁC đỏ — đó là MỞ LẠI sổ nợ
    56 và phải được ghi ra ở STATE, không lặng lẽ thành một dòng trong một map.

    ⑵ **Nếu bạn `CREATE OR REPLACE` một hàm trigger ĐÃ ĐƯỢC GHIM trong một migration mới, bạn PHẢI
    cập nhật bản ghim và trường `migration` của nó.** Không phải để cho đẹp: hardening chạy TRƯỚC
    vòng migration đánh số, và migration cũ đã có dòng trong `schema_migrations` nên không chạy lại —
    nên bản ghim cũ sẽ LÙI hàm của bạn về thân cũ ở MỌI lần `migrate()`, vĩnh viễn. Có hai test canh
    (đồng bộ thân, và "migration cuối cùng"), nhưng hãy biết cơ chế thay vì chỉ biết test.

    ⑶ **`otp_rate_limits` nay có bộ dọn, và câu dọn của nó KHÔNG có `WHERE` — đừng "sửa" nó.**
    PostgreSQL đòi policy `SELECT` cho một `DELETE` ngay khi câu lệnh tham chiếu cột; bảng này cố ý
    không cấp đường đọc nào cho kết nối nền (`FOR DELETE`, không `FOR ALL`), nên thêm một `WHERE` sẽ
    làm bộ dọn xoá đúng 0 hàng. Mốc tuổi nằm trong policy `044` chứ không ở phía gọi, và đổi nó là
    đổi ở HAI chỗ (migration `044` + bản ghim hardening) — có test đọc thẳng cả hai file.

13. **[2026-09-07] S1.16 — sổ nợ 58 đóng bằng cách bác bỏ tiền đề của chính nó (`046`).** Một điều
    người tiếp theo nên mang theo, và nó không phải chuyện của cái chỉ số:

    **Một phép đo ở MỘT chế độ không phải một kết luận cho MỌI chế độ.** H7-3 đo `EXPLAIN (ANALYZE)`
    thật, in ra số thật, rồi phát biểu *"không chỉ số nào phục vụ được vế lọc này"* — trong khi phép
    đo ấy chạy ở tỷ lệ 95% hàng khớp, nơi Seq Scan là tối ưu THẬT. Con số thật đi kèm làm cho một
    kết luận rộng quá phạm vi trông như đã được kiểm chứng, và nó sống qua một vòng review, một PR,
    một sổ nợ. Khi bạn đọc một dòng "đã đo" trong repo này, hãy hỏi thêm một câu: **đo ở chế độ
    nào?** Với kế hoạch truy vấn, chế độ là tỷ lệ chọn lọc; với hạn mức, là vị trí trong cửa sổ; với
    tranh chấp, là số tiến trình.

    Cụ thể ở đây: bộ dọn `otp_rate_limits` DÙNG ĐƯỢC chỉ số — `BitmapOr` hợp hai vế của phép OR do
    RLS sinh ra, miễn cả hai vế đều có chỉ số. `046` dựng lại `otp_rate_limits_window_idx`, và
    `db/otp-don-ke-hoach.int.test.ts` canh kế hoạch ở đúng chế độ 1% kèm đối chứng dương. Nếu bạn
    thấy test ấy đỏ, đừng nới nó: hoặc chỉ số đã mất, hoặc hình dạng policy đã đổi thành thứ không
    hợp bitmap được nữa — cả hai đều là thứ phải biết.

14. **[2026-09-07] S1.17 và S1.18 — hai vòng, và cả hai để lại một bài học về CHÍNH CÁCH ĐO.**
    S1.17 đóng nợ 11 (artefact neo ngoài, ADR-026); S1.18 đóng nợ 9 và 17 (biên giới module +
    danh sách trắng barrel cho bốn gói S0 cuối cùng, ADR-027). Bốn thứ người tiếp theo phải biết
    trước khi chạm bất kỳ lớp canh nào:

    ⑴ **Thêm một gói vào `packages/` nay đòi BA thứ, và hai lớp sẽ đỏ cho tới khi có đủ:** một họ
    quy tắc biên giới trong `.dependency-cruiser.cjs` đóng `src/` với ĐÚNG tập cửa mà `package.json`
    khai trong `exports`; ba probe trong `boundaries.test.ts` (quy tắc chưa từng đỏ thật là quy tắc
    chưa được đo); và một danh sách trắng barrel cộng một dòng trong `DANH_SACH_TRANG_THEO_CUA`.
    Hai danh sách miễn trừ (`MIEN_TRU`, `GOI_MIEN_DANH_SACH_TRANG`) nay **RỖNG** và có khẳng định
    riêng giữ chúng rỗng — viết thêm một dòng vào đó vẫn ĐƯỢC, nhưng nó là hành vi **mở lại nợ 9
    hoặc 17** và phải ghi ra ở `docs/STATE.md`.

    ⑵ **Một dòng trong `package.json` là một cửa công khai mới.** Đó là cách
    `@trustprocure/audit/anchor-sign` (S1.17) và `@trustprocure/sealed-envelope/unseal` (S1.4) ra
    đời, và cửa thứ hai của `sealed-envelope` — xuất `unsealBid`, hàm MỞ phong bì giá thầu — **chưa
    bao giờ có danh sách trắng** cho tới S1.18. Ba lớp chia việc và không thay nhau: họ `gN-` canh
    *không ai đi vòng QUA tường*; một quy tắc riêng canh *AI* được đi qua cửa hạn chế; danh sách
    trắng canh *CÁI GÌ* đi ra qua nó.

    ⑶ **Một quy tắc XANH trông giống hệt một quy tắc đang làm việc.**
    `khong-phu-thuoc-devdep-trong-src` **không bao giờ bắn được** từ S0 tới S1.18 — `options.exclude`
    chứa `node_modules` nên không cạnh nào trong đồ thị mang `npm-dev`. Nó sống qua chín lượt review
    vì thứ duy nhất ai cũng nhìn là dòng *"no dependency violations found"*. Khi bạn thêm một quy tắc
    depcruise, hãy hỏi thêm câu thứ hai: **quy tắc này có ĐỐI TƯỢNG nào để phán xét không** — và
    viết câu ấy thành một test, đừng để nó là một niềm tin.

    ⑷ **"Suy từ tính chất" chỉ đúng khi tính chất được chọn ĐÚNG MIỀN.** Vòng S1.18 sinh ra để xoá
    khuôn danh-sách-tên, rồi tự viết lại khuôn ấy: vị từ *"gói"* của cả [INV-H16] lẫn [INV-H18] là
    *thư mục có `src/index.ts`* — một **quy ước đặt tên**, không phải định nghĩa. Một gói khai
    `"exports": { ".": "./src/main.ts" }` rơi khỏi cả hai lớp trong im lặng, và hai khẳng định
    *"miễn trừ RỖNG"* vẫn xanh. Vị từ đúng nay ở `tests/architecture/goi-workspace.ts` và **dùng
    chung** cho cả hai bất biến — hai bản chép gần giống nhau của cùng một vị từ là thứ sẽ trôi khỏi
    nhau.

15. **[2026-09-07] S1.20 — HAI KHOẢN NỢ 3 VÀ 16 ĐÓNG, và bốn dòng dưới đây là thứ đắt nhất vòng.**

    ⑴ **Một khoản nợ có thể chỉ ĐÚNG MỘT NỬA lỗ của chính nó.** Khoản 16 dự báo *"bảng báo giá S1
    sẽ rơi thẳng vào đó"* và liệt kê ba hậu quả: UNLOGGED, UNIQUE, REVOKE. Thứ nó bỏ sót là thứ
    nặng nhất: `TRUNCATE`. Ba trigger chỉ-ghi-thêm của 018/019 là `BEFORE DELETE OR UPDATE FOR EACH
    ROW`, và **một trigger cấp HÀNG không bao giờ chạy cho một thao tác cấp CÂU LỆNH**. Đo được:
    `TRUNCATE public.bid_receipts` → **OK**, trong khi `TRUNCATE public.audit_events` → NÉM. Bài
    học tái dùng được: **đọc một khoản nợ như một GIẢ THUYẾT phải đo lại, không như một danh sách
    việc phải làm.**

    ⑵ **Một khoản nợ có thể ĐÃ ĐÓNG mà không ai biết — theo hai kiểu khác nhau, cùng lúc.** Nửa sau
    của khoản 3 (*"hàm plpgsql ngoài danh sách không được ghim"*) đóng từ **S1.14/S1.15** và nằm
    thiu bốn vòng. Nửa đầu (*"`NOBYPASSRLS` chỉ ghim bốn tên role"*) thì **chưa bao giờ là một lỗ**:
    BƯỚC 1 của hardening thu hồi mọi tư cách thành viên lạ, nên cây role LUÔN BẰNG bốn tên ấy — đo
    được, `ke_gian` rời cây sau `migrate()`. Mục canh đã viết cho nó **bị GỠ**, vì không đột biến
    nào làm nó đỏ được. Cùng lớp với mục 7 của sổ nợ S0 (*"apps/ rỗng"*): **sổ nợ cũng trôi, và nó
    trôi theo cả hai chiều.**

    ⑶ **`hardening.always.sql` có một quy tắc mà vi phạm nó KHÔNG làm test nào đỏ — nó làm DEPLOY
    gãy.** Quy tắc: *tự chữa chỉ trên thứ một migration đánh số sở hữu theo TÊN; thứ SUY RA thì chỉ
    phán xét* (`[CR4]`, nay là **ADR-028**). Vòng này suýt vi phạm ở bước thứ hai — cách sửa hiển
    nhiên cho lỗ TRUNCATE là mượn `chan_sua_xoa()`, và vì `bang_al` nhận bảng lạ theo **OID của
    chính hàm ấy**, ba bảng của S1 sẽ rơi vào `can_co` và `migrate()` sẽ **báo lỗi trên một lược đồ
    HỢP LỆ**. Trước khi thêm bất cứ gì vào file ấy, hỏi: *mục này có thể chặn một lược đồ ĐÚNG
    không?* — và viết một đối chứng dương cho câu trả lời.

    ⑸ **`hardening.always.sql` và migration đánh số mà nó ghim phải đi CÙNG MỘT COMMIT.** Mục
    ghim khai tiền điều kiện là *migration ấy đã nằm trong `schema_migrations`*, nên tách hai file
    ra hai commit tạo một cửa sổ mà mục phán xét đã kêu trong khi mục ghim còn nằm im — tức deploy
    bị chặn mà không có gì tự dựng lại. Reviewer lượt 12 truy được trình tự này và nó AN TOÀN khi
    hai file đi cùng nhau; đừng tách chúng.

    ⑷ **Bí danh SQL trong một câu nhúng vào plpgsql là một cái bẫy IM LẶNG.** plpgsql thay tên biến
    **trước khi** PostgreSQL phân giải bí danh, nên `FROM pg_roles r … WHERE r.rolbypassrls` đọc
    biến vòng lặp `r` chứ không đọc bảng — và vị từ trả về **TẬP RỖNG**, tức mục canh **luôn XANH**.
    `[IM2]` đã ghi cảnh báo này ở vòng fix 1 của S0 và vòng này **vẫn vấp**. Ca của `[IM2]` ném
    55000 (ồn ào); ca này im lặng. Dùng bí danh không trùng tên biến (`vai`, `bg`, …), và đừng tin
    một mục canh chưa từng đỏ.

16. **[2026-09-08] S1.21 — RÀ LẠI SỔ NỢ S0, và thứ vòng này tìm ra là chính câu mà tám vòng gần
    nhất dùng để kết thúc.**

    ⑴ **Câu *"Sổ nợ mở còn: 23 và nửa sau của 30"* SAI, và nó sai ở cả tám lần được viết ra.** Nó
    khai NĂM khoản; đếm bảng theo dấu văn bản ra **mười bốn**; phán xét lại từng dòng ra **mười
    ba**. Ba cách đếm, ba con số. Không cổng nào đỏ vì hai khẳng định — bảng và
    câu tổng kết — nằm ở hai chỗ mà **không thao tác nào chạm cả hai**. Sai theo hướng DỄ CHỊU, và
    cái giá không phải thẩm mỹ: câu ấy là thứ quyết định vòng sau làm gì, nên tám khoản nợ chưa bao
    giờ được xếp lịch. Bài học tái dùng được: **một lời khai tóm tắt là một BẢN SAO, và mọi bản sao
    không được đối chiếu đều trôi** (ADR-029).

    ⑵ **Ghi một dòng thiu vào LỊCH SỬ không phải một lớp.** Khoản nợ 7 (*"`apps/` rỗng"*) được gọi
    tên là thiu ở mục 33 (S1.18), rồi gọi tên **lần nữa** ở mục 35 (S1.20), và tới vòng này dòng ấy
    vẫn nguyên văn trong khi `apps/` có ba tiến trình. Hai lần ghi, không lần nào thành một lần
    sửa. Nếu bạn thấy một dòng thiu: **sửa nó ngay tại chỗ**, đừng chỉ ghi ra rằng nó thiu.
    Và chính tệp này là ví dụ nặng nhất: §10 khai *"22 khoản"* trong khi sổ có 60, liệt kê
    *"năm khoản nặng nhất"* mà **bốn** đã đóng; §6 *"Cái CHƯA có"* có **ba** gạch đầu dòng đầu
    tiên đều sai. Cả hai đã sửa ở vòng này — nhưng `[INV-H20]` KHÔNG phủ tệp này, nên nó sẽ
    trôi lại nếu không ai đối chiếu.

    ⑶ **Một khoản nợ có thể đóng bởi một lớp KHÁC lớp mà nó chỉ tên — và đó là ca thường, không
    phải ca lạ.** Khoản 1 (*"E3 không có giới hạn tần suất"*) đóng bởi lớp trả cho **khoản 39**;
    khoản 5 (*"không test nào canh"*) đóng bởi `RLS WITH CHECK` với một test có từ **chính commit
    tạo ra outbox**, tức vế ấy sai ngay ngày nó được viết. Cộng nửa đầu khoản 3 ở S1.20: **ba lần
    trong hai vòng.** Trước khi mở một vòng để đóng một khoản nợ, hãy ĐO xem nó còn mở không.

    ⑷ **Markdown giấu được khiếm khuyết hình dạng, và bộ đọc thì bỏ qua chúng trong IM LẶNG.** Dòng
    59 của bảng sổ nợ có **một** ô nội dung (thiếu hẳn cột con trỏ); dòng 52 có **bốn** (một `|`
    trần bên trong `` `route|to-chuc` `` cắt ô làm đôi — trong bảng Markdown phải viết `\|`). Cả hai
    vẫn dựng thành bảng, nên mắt người không thấy. Khi một tài liệu trở thành ĐẦU VÀO của một lớp
    canh, hình dạng của nó là một hợp đồng — và phép kiểm đầu tiên phải là *"mọi dòng có đúng số ô"*.

    ⑸ **"ĐÓNG" nghĩa là CÓ LỚP GIỮ, không phải CÓ CÀI ĐẶT** (review lượt 13, ADR-029 §2⑹). Vòng
    này suýt tuyên khoản nợ 1 đóng dựa trên `callerLimit` của `/auth/totp` — một dòng cấu hình
    THẬT, cưỡng chế THẬT, mà **xoá nó thì không test nào đỏ**. Hàng rào có thật, không có gì giữ
    nó. Trước khi đánh dấu một khoản nợ là đóng, hỏi: *xoá lớp ấy đi thì cái gì đỏ?* — nếu câu trả
    lời là "không gì cả" thì đó là THU HẸP, không phải ĐÓNG.

    ⑹ **Một lớp canh mới phải bị hỏi đúng câu nó dùng để hỏi người khác.** Ba phát hiện nặng nhất
    của review lượt 13 đều là *chính khiếm khuyết mà lớp ấy ra đời để bắt*, tái tạo bên trong lớp
    ấy: bộ đọc bỏ sót một dòng trong im lặng (một dấu cách đầu dòng là đủ), và cửa `~~` — thứ tồn
    tại để tôn trọng quy ước "giữ nguyên văn" — dùng được để LÀM IM một con trỏ chết và để bóc mất
    một lời khai đang sống.

    ⑺ **Một phép kiểm đọc ĐĨA đo cái đĩa của người chạy nó.** Lượt CI đầu tiên của vòng này
    đỏ ở CẢ HAI runner trong khi `pnpm t0`, bộ test đơn vị và `pnpm evidence:check` đều xanh
    trên máy phát triển: hai con trỏ vừa được *sửa* trỏ tới tệp có thật trên đĩa của tôi mà
    KHÔNG có trong kho (cây báo cáo SDD bị `.gitignore` phủ). Nếu khẳng định là về CÁI KHO
    thì nguồn phải là `git ls-files`, không phải `existsSync`.

    ⑻ **Một phép kiểm dừng ở lời khai ĐẦU TIÊN sẽ xanh trên đúng tệp đang sai.** Bản đầu của P5 đòi
    *"đúng MỘT lời khai `n ADR`"*; chạy lên thì có HAI, ở hai mục của cùng một tệp, khai **28** và
    **27**. Đổi thành *"MỌI lời khai"*. Cùng khuôn với `MIEN_TRU` phải RỖNG của ADR-027: **đừng
    thiết kế phép kiểm quanh số lượng bạn tưởng là có.**

17. **[2026-09-08] S1.22 — KHOẢN NỢ 8 ĐÓNG, và năm dòng dưới đây là thứ đắt nhất vòng.**

    ⑴ **Chọn CHỦ THỂ của một lớp canh là một quyết định an ninh, và nó phải dựa trên một phép
    đo.** Ba nhóm câu SQL: ghim đủ, ghim không gì, ghim NỬA VỜI. Nhóm thứ hai đông nhất (80 câu)
    nhưng nhóm thứ ba (13 câu) đắt nhất — vì một câu ghim không gì **trông đúng như nó là**, còn
    một câu ghim nửa vời **đọc như đã được bảo vệ**. Chọn nhóm ba làm chủ thể, đếm nhóm hai bằng
    một mốc chỉ-đi-xuống, và nói ra cả hai.

    ⑵ **Một lớp canh đòi ghi tên đủ schema sẽ DẠY người ta viết một cái tên không tồn tại.**
    `::int` là đường cú pháp; `::pg_catalog.int` ném 42704 (tên thật là `int4`). Vòng sửa viết
    đúng cái sai ấy, `/guest/otp/verify` trả 500 thay vì 401, và chỉ T3 bắt được. Nếu lớp canh đòi
    một cách viết thì nó cũng phải kiểm rằng cách viết ấy HỢP LỆ — nay `pg_type` làm việc đó.

    ⑶ **Một mặt nạ phải là thứ bộ dò KHÔNG đọc được.** Che phần đã ghim bằng `#`, rồi thêm `#` vào
    bảng toán tử ⇒ 44 câu ĐỎ vì chính cái mặt nạ. Và che bằng dấu cách thì `FROM public.t s` thành
    `FROM   s`, tức bộ dò đi kết tội BÍ DANH. Cách đúng: chỉ che đúng trục cần che, và để ba trục
    kia tự loại phần đã ghim bằng hình dạng của chúng.

    ⑷ **Danh sách miễn trừ nên để CSDL phán xét, không để người viết.** `pg_proc`,
    `pg_get_keywords()`, `pg_type` bác chín dòng tôi viết theo trí nhớ — trong đó `unnest` là ca
    đắt nhất: mã sản xuất đã GHIM nó từ trước, tức lớp canh và mã nguồn nói ngược nhau.


    ⑹ **"Đỏ ngẫu nhiên" là một KẾT LUẬN, không phải một phép đo.** CI của vòng này đỏ hai lượt ở
    hai chỗ khác nhau — chữ ký của tải. Nhưng đọc log ra một nguyên nhân THẬT và sửa được:
    `writeFile(..., { flag: "wx" })` tạo tệp trước khi ghi nội dung, nên một người đọc poll thư mục
    bắt được tệp rỗng. Trước khi đổ cho nợ 24, hãy đọc dòng lỗi đầu tiên và hỏi *cái gì đọc, cái gì
    ghi, và giữa hai việc ấy có cửa sổ nào không*.

    ⑸ **Bốn trong sáu HIGH của review lượt 14 nói về LỚP CANH, không về mã.** Một lớp canh mới là
    mã mới, và nó phải chịu đúng câu hỏi nó dùng để hỏi người khác: *xoá một dòng thì cái gì đỏ?*
    Ba lỗ nặng nhất — miễn cả khoảng `SET`, chỉ đọc mảnh đầu của SQL nối chuỗi, chỉ khớp một cú
    pháp `search_path` — đều là *"hàng rào không tạo được lượt ĐỎ cho đúng hình dạng nó tuyên bố
    canh"*.

18. **[2026-09-08] S1.23 — KHOẢN NỢ 23 ĐÓNG BẰNG MỘT MÁY THẬT, và bốn dòng dưới đây là thứ đắt
    nhất vòng.** Vòng này gần như không có mã: một máy Android xuất hiện, máy dò
    `tools/do-webcrypto/index.html` chạy trong **Zalo**, **Messenger**, **Chrome** trên cùng máy
    (**Galaxy A02s / Android 12**), cả ba **ĐẠT toàn bộ kể cả `X25519`**.

    ⑴ **Phép đo lấp một ô KHÔNG có nghĩa là nó đo được điều ô ấy nghi.** Ô ưu tiên 1 nghi *"máy
    tầm trung cũ hay tụt lại nhiều phiên bản WebView"*. Máy đo đúng phân khúc, nhưng WebView của
    nó là **151** — mới. Ô được điền; **chế độ tụt lại vẫn không có mẫu nào**. Trước khi ghi một
    ô là xong, hỏi: *phép đo này có rơi vào chế độ mà ô ấy sợ không?*

    ⑵ **`UA:` là thứ phân xử, không phải ảnh chụp và cũng không phải lời người gửi.** Một khối
    kết quả đến kèm ảnh chụp máy Android nhưng mang `UA:` của iPhone — clipboard đồng bộ giữa hai
    máy là đủ. Nó vẫn là phép đo thật, chỉ là của engine khác, và thành dòng 4. **Ảnh chụp thẻ
    phán quyết không định danh engine.**

    ⑶ **Đừng nhận dạng WebView bằng token `wv`.** UA của Zalo không có `wv` dù là WebView cùng
    build với Messenger. Ứng dụng sửa được UA của webview mình nhúng. Nhận dạng bằng **chuỗi build
    Chromium** cộng **token ứng dụng**.

    ⑷ **Một lớp ĐO cũng không được lẫn lỗi của chính nó với kết luận về đối tượng** — cùng hình
    dạng với bốn HIGH của review lượt 14 (S1.22), nhưng lần này ở một công cụ thủ công. Ngoài ngữ
    cảnh bảo mật `crypto.subtle` không tồn tại **dù engine đủ tốt**, và bản cũ phán *"KHÔNG nộp
    thầu được trên trình duyệt này"* — một câu về CÁI LINK mang hình dạng một câu về CÁI MÁY. Nay
    có phán quyết thứ năm *"PHÉP ĐO HỎNG — link này không phải https"*, mũi `?dot=ngucanh` chứng
    minh nó phân biệt được.

    **Và một điều về chính chữ "đóng":** nợ 23 đóng **không phải vì đã đo hết**. Hai chế độ cố ý
    không đo (WebView tụt lại; iOS ≤ 16) được gọi tên ở ADR-031 §3⑵. Đóng được vì phần chưa đo
    **không còn quyết định gì** — ADR-011 đã gỡ thế hoặc/hoặc từ 2026-09-04. Phần việc thật sự
    còn lại **đổi hình từ một khoản nợ thành một yêu cầu giao diện của S1.4/S1.5**. Khi một khoản
    nợ đóng theo kiểu ấy, phải viết ra **cái gì đi đâu**, nếu không nó chỉ là một dòng bị xoá.

19. **[2026-09-08] S1.24 — KHOẢN NỢ 62 ĐÓNG, và bốn dòng dưới đây là thứ đắt nhất vòng.**

    ⑴ **Một khoản nợ cũng là một lời khai, và lời khai thì thiu.** Nợ 62 khai **80** câu SQL chưa
    ghim; đo lại thì **9** không phải SQL và **8** không có gì để ghim — việc thật là **63**. Cả
    ba con số do chính lớp canh sinh ra ở vòng trước rồi được chép vào sổ. **Đo lại phạm vi TRƯỚC
    khi lập kế hoạch cho một vòng**, kể cả khi con số ấy do chính mình viết ra.

    ⑵ **Một bộ sửa tự động cần một bộ KIỂM ĐỘC LẬP, và "đọc lại bản đề xuất" KHÔNG phải bộ
    kiểm ấy.** Lượt đọc lại bắt được **bốn** lỗi (ghim `pg_stat_activity` — khung nhìn catalog —
    vào `public.`; ghim `bid_so_tien` — hàm của dự án — vào `pg_catalog.`; mất khoảng trắng quanh
    `->>`; tách `=>` thành hai toán tử) và **bỏ sót HAI MƯƠI**: 10 chỗ dấu `=` của phép gán trong
    `SET` bị ghim, 6 chỗ văn bản nhân đôi, 2 chỗ `extract` dạng ngữ pháp, 2 chỗ đổi cây phân tích.
    Review an ninh lượt 15 đọc tay ra cả 20. **Không lỗi nào bị trình biên dịch bắt** — chúng là
    SQL, và SQL là chuỗi.

    ⑵b **Một lỗi lệch-một-đơn-vị trong một bộ sửa hàng loạt không hỏng một chỗ, nó hỏng mười.**
    Cả 10 chỗ `SET` có cùng nguyên nhân: bộ ghim nuốt dấu `(` của lời gọi hàm mà không tăng độ sâu
    ngoặc ⇒ độ sâu về −1 ⇒ mọi phép kiểm `độ sâu === 0` tắt tới hết câu. **Trạng thái của một bộ
    sửa hàng loạt phải có đối chứng riêng, không được chỉ kiểm đầu ra.**

    ⑵c **Thứ bắt được cả 20 trong MỘT phép đo: `PREPARE` từng câu trên PostgreSQL thật.**
    `tests/architecture/qt3-cu-phap.int.test.ts`. Hạ tầng đã nằm sẵn trong kho; thứ thiếu chỉ là ý
    định đưa câu SQL cho thứ duy nhất đọc được nó. **Một lớp canh đòi một cách viết mà không chạy
    thử cách viết ấy thì không phải hàng rào, nó là một cái khuôn.**

    ⑶ **Gỡ một cái mốc, đừng hạ nó về 0.** `TRAN_TOI_DA` là hàng rào của một cuộc di trú đang
    chạy. Khi số về 0, giữ nó lại chỉ còn một tác dụng: cho phép quay lui.

    ⑷ **Một cái sàn đi xuống có thể HỢP LỆ.** `SO_CAU_TOI_THIEU` 148 → 139 vì chín chuỗi rời khỏi
    tập chủ thể — chúng chưa bao giờ là SQL. Một cái sàn tụt vì bộ đọc mù đi thì hỏng; cái này tụt
    vì tập chủ thể đúng lên. Phân biệt hai thứ ấy là việc của người viết, không của con số.

    **Và hai thứ tìm được ngoài phạm vi, cả hai về chính lưới an toàn:** `ci.yml` kích hoạt trên
    một nhánh **không tồn tại** nên **không lượt CI nào từng chạy trên commit merge** (khoản nợ 64,
    đã sửa); và một job `schedule` **fail-closed** đã đỏ từ hôm trước với đúng con số khoản nợ 24
    đang chờ — `TỶ LỆ ĐỎ: 2 / 10` — mà không tới tay ai (khoản nợ 65). **Fail-closed mà không có
    người đọc thì chỉ là fail-lặng.**

20. **[2026-09-08] S1.25 — BA KHOẢN NỢ 24, 59, 65 LÀ MỘT CHỦ ĐỀ: ĐỘ TIN CẬY CỦA CHÍNH CÁI LƯỚI.**
    Chúng nhìn như ba việc rời — một tỷ lệ chưa đo, một cổng đỏ giả, một kết quả không tới ai —
    nhưng cả ba đều làm người đọc mất khả năng phân biệt *"cổng này nói gì"* với *"cổng này lại
    thế thôi"*. Bốn dòng dưới đây là thứ đắt nhất vòng.

    ⑴ **Đóng một đỏ giả bằng KHOÁ, đừng đóng bằng LOẠI TRỪ.** Đường dễ là cho `pnpm run depcruise`
    bỏ qua mọi tệp `zprobe-*`. Nó đóng được đua tranh, nhưng đổi lại cổng sản xuất **thôi nhìn một
    lớp tệp** mà chỉ một quy ước đặt tên giữ cho trống — mua sự yên tĩnh bằng một lỗ. Khoá không
    đổi thứ gì được đo. Và khoá phải bao **trọn vòng đời của probe**, không chỉ bao lượt quét:
    probe nằm trên đĩa thật, nên chỉ cần nó TỒN TẠI là đủ.

    ⑵ **Một đường báo động không được kiểm là một đường báo động không tồn tại.** `do-lap.yml` nay
    mở issue khi tỷ lệ khác 0, và có input `dot_bien` để bắt đường ấy chạy lúc kho đang xanh. Mũi
    ấy đã chạy thật: issue #22, mang tỷ lệ + link + commit, tự khai mình là mũi đo, rồi được đóng.
    **Không có mũi ấy thì lần đầu tiên đường báo động cần chạy cũng là lần đầu tiên nó hỏng.**

    ⑶ **"Test flaky" là một cái tên, không phải một cơ chế — và cái tên ấy che mất bản vá.** Đo
    được 1/10 trên CI, đọc log ra `[M10]`, đọc `[M10]` ra một điều cụ thể: `pool.end()` là thao
    tác CỤC BỘ của Node (đóng socket), còn backend PostgreSQL giữ advisory lock chỉ chết SAU đó,
    bất đồng bộ. **Phép đếm tức thì đo sai THỜI ĐIỂM, không đo sai tính chất.** Khuôn đúng — vòng
    chờ — đã nằm sẵn trong chính tệp ấy cho một ca khác, và chú thích đầu tệp còn viết ra thành
    câu. Trước khi gọi một test là flaky, hãy hỏi *cái gì thay đổi trạng thái, và phép đo đứng ở
    đâu so với nó*.

    ⑷ **Đóng đúng thứ mình nói, đừng đóng thêm.** Khoản 59 đóng **đua tranh `depcruise`** — và
    chính lượt chứng minh điều đó lại đỏ một test KHÁC: một ngưỡng thời gian tuyệt đối
    (`TRE_TEST_MS = 800`) dùng để đo một tính chất TƯƠNG ĐỐI (*"lượt N+1 chậm hơn hẳn"*). Nó thành
    khoản nợ **66**, không gộp vào 59. Ghi *"lượt gộp hết đỏ"* lúc ấy sẽ là một câu rộng hơn phép
    đo — và là đúng lỗi mà ADR-029 cấm.
