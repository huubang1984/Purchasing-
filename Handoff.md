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

**Bảy migration + một lớp cưỡng chế chạy ở mọi lần `migrate()`:**

```
db/migrations/001_roles_and_functions.sql     roles, hàm nền
             002_organizations_and_users.sql  tổ chức, người dùng
             003_audit_events.sql             sổ kiểm toán
             004_audit_chain_functions.sql    chuỗi hash
             005_identity.sql                 vai trò / quyền / phân tách nhiệm vụ
             006_sessions_and_mfa.sql         phiên + TOTP
             007_outbox.sql                   transactional outbox
             hardening.always.sql             36 mục tự-sửa hoặc phán-xét, chạy MỌI lần
```

**Bảy gói + hai công cụ:**

| Gói | Vai trò |
|---|---|
| `packages/tenancy` | `withTenant()` — **điểm DUY NHẤT** gắn `app.org_id`. Toàn bộ RLS của 002–007 treo vào nó |
| `packages/audit` | Sổ kiểm toán chuỗi hash chỉ-ghi-thêm, bộ kiểm chứng, `assertTenantBound` |
| `packages/identity` | RBAC, phân tách nhiệm vụ (D3) cưỡng chế bằng trigger `ENABLE ALWAYS`, TOTP theo RFC 6238, độ tươi MFA |
| `packages/crypto-keys` | `KeyProvider` + adapter `local-dev` bọc khoá theo tổ chức, có phiên bản |
| `packages/outbox` | Transactional outbox; runner chạy **trong** ngữ cảnh tenant dưới `app_api`, **không** dùng role vượt RLS |
| `packages/db` | Bộ chạy migration (advisory lock + checksum), pool |
| `packages/test-support` | Hạ tầng kiểm thử (Testcontainers). **Chỉ devDependencies** |
| `tools/inv-matrix` | Bộ sinh ma trận bất biến + cổng CI |
| `tools/bench-keyprovider` | Đo hiệu năng bọc/mở khoá |

**Hàng rào kiến trúc:** `dependency-cruiser` với bốn họ quy tắc (`g1-` crypto-keys, `g2-`
identity, `g3-` identity-không-có-năng-lực-mật-mã, `g4-` outbox), tất cả theo khuôn **"mặc định
đóng"** — một module MỚI trong thư mục nhạy cảm đã bị chặn sẵn, không ai phải nhớ thêm quy tắc.

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

- **`apps/` RỖNG.** Không một đường gọi sản phẩm nào tới `listOrganizations`, `start()` của
  outbox runner, hay `assertFreshMfa`. Các gói đã có **được test gọi, chưa có ứng dụng gọi**.
- **`apps/unseal-worker` CHƯA TỒN TẠI**, và `wrapped_private_key` cũng vậy. Hàng rào `g1-`
  đang canh **một cánh cửa chưa có phòng ở sau** — lớp phòng ngừa là thật và đã chứng minh có
  răng, nhưng tài sản nó bảo vệ thì chưa ra đời.
- **Ma trận báo 24/47, không phải 47/47** — và đó là câu trả lời **đúng**:
  - **23 hàng trống**, mỗi hàng một lý do được ghim trong mã (`MA_DUOC_PHEP_CHUA_PHU`). Nhóm A,
    C1–C5, E1/E2/E4–E6 và phần lớn nhóm B chờ S1 vì **chủ ngữ của chúng chưa tồn tại**.
  - **5 mã mang cờ "phạm vi hẹp hơn mệnh đề"** (D1, D5, E3, F1, G1) — ô ✅ **không** có nghĩa
    mệnh đề đã được phủ trọn vẹn. §4 của ma trận nói rõ hẹp ở đâu.
  - Cổng evidence **đỏ theo cả hai chiều**: một mã tụt về "chưa phủ" không đi lọt được bằng
    cách thêm nó vào danh sách miễn trừ, và một mã đã phủ mà còn nằm trong danh sách cũng đỏ.
- **Chưa triển khai.** Chưa chọn hạ tầng đích, chưa chọn nhà cung cấp KMS.
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

   **Cập nhật 2026-08-29: đã có MÁY DÒ, chưa có PHÉP ĐO.** `tools/do-webcrypto/index.html` chạy
   thật từng phép mật mã của đường nộp thầu và cho ra một trong bốn phán quyết; nó đã được chứng
   minh có răng bằng ba đột biến. Nhưng nó mới chỉ chạy trên **Chrome 148 desktop** — điều đó
   chứng minh **máy dò hoạt động**, không chứng minh gì về webview Việt Nam. **Rủi ro vẫn CAO và
   vẫn MỞ.** Chỗ đáng ngờ nhất là **X25519**: nó chỉ có trên Chrome 133+ và Safari 17+, mới hơn
   nhiều so với AES-GCM, và nếu nó thiếu thì ADR-011 phải đổi sang P-256 **trước** S1.4.

---

## 10. Nợ kỹ thuật

**22 khoản**, đầy đủ ở `docs/STATE.md` §*Nợ kỹ thuật*. Mỗi khoản là một **khoảng trống đã đo**,
không phải linh cảm. Năm khoản nặng nhất:

1. **Artefact neo ngoài của B3 chưa tồn tại.** Cơ chế đã có, artefact thì chưa — không có nó,
   một chuỗi hash hợp lệ **không chứng minh gì** trước một chủ sở hữu bảng.
2. **Vế *giới hạn tần suất* của E3 không có một dòng mã nào** trong toàn S0.
3. **Không lớp máy nào cưỡng chế quy ước `OPERATOR(pg_catalog.=)`** — chú thích + test là tất
   cả những gì đang giữ nó.
4. **Hai mặt tiền chịu lực nhất repo không có lớp nào canh đường vào**: `with-tenant.ts` (điểm
   duy nhất gắn `app.org_id`) và `audit/writer.ts`. Chỉ 3/7 gói có quy tắc biên giới.
5. **Bốn mục hardening theo khuôn danh-sách-tên**, nặng nhất: hình dạng bảng sổ chỉ **ĐẾM** cột,
   **không cấm cột thừa** ⇒ thêm một cột `payload_plaintext` vào `audit_events` **không bị mục
   nào chạm**.

Còn mở từ vòng CI: **(20)** không lớp nào canh "bảo đảm chỉ đúng trên một hệ điều hành";
**(21)** chỉ `pnpm audit --prod` chặn được hạ tầng kiểm thử lọt vào phạm vi sản xuất, và nó chỉ
nổ khi *tình cờ* có advisory. **(22) đã đóng** — job `evidence` nay đã chạy trên CI.

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
4. ~~**Đo `crypto.subtle` trong webview Zalo/Messenger.**~~ **CÔNG CỤ XONG, PHÉP ĐO CHƯA** —
   `tools/do-webcrypto/`. Rủi ro **vẫn CAO và vẫn mở** cho tới khi có kết quả từ điện thoại thật.
5. **Tiếp cận khách hàng pilot** song song với S1. — **chưa làm**, và vẫn là rủi ro lớn nhất.
6. Hai việc cấu hình nhỏ, không chặn: **tạo team `@trustprocure/bao-mat`** trên GitHub để
   CODEOWNERS có răng; cân nhắc **thêm `windows-latest`** vào ma trận job T1+T2 (khoản nợ 20).
7. **Mới:** chốt **ADR-010** trước S1.6, **ADR-011** trong S1.4, **ADR-012** trong S1.1 — xem §6
   của kế hoạch S1.
8. **Mới:** bắt đầu **S1.1** và **S1.2** — hai hạng mục duy nhất không bị chặn bởi quyết định nào.

---

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
| `docs/STATE.md` | **Đọc đầu tiên.** Sổ trạng thái đầy đủ: điều kiện hoàn thành, điểm chặn, 22 khoản nợ |
| `docs/PRODUCT.md` | Định vị, phạm vi, **những điều không được tuyên bố** |
| `docs/ARCHITECTURE.md` | Kiến trúc: modular monolith, `unseal-worker` giữ độc quyền giải mã, RLS đa tổ chức |
| `docs/DECISIONS.md` | **Chín ADR** — 001–008 *Đã chấp nhận*, **009 (KMS) *Đang mở*, chặn S1.6** |
| `docs/TEST-PLAN.md` | **Sổ đăng ký 47 bất biến** (34 nghiệp vụ + 13 hàng rào) — nguồn sự thật duy nhất |
| `evidence/INV-matrix.md` | Ma trận bất biến; **§3 = danh sách việc của S1**, §4 = phạm vi hẹp |
| `evidence/security-reviews.md` | Dấu vết review an ninh, kèm giới hạn của chính nó |
| `db/migrations/hardening.always.sql` | 36 mục cưỡng chế chạy ở **mọi** lần `migrate()` |
| `docs/superpowers/specs/2026-08-26-…-design.md` | Đặc tả thiết kế S0+S1 đã duyệt |

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
