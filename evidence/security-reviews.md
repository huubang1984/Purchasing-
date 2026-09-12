# Dấu vết review an ninh — S0 và S1

> **Vì sao file này tồn tại.** Điều kiện hoàn thành S0 mục 8 đòi `security-reviewer` chạy trên
> task 4–9 và mọi phát hiện CRITICAL/HIGH được xử lý. Cho tới cuối S0, toàn bộ bằng chứng cho
> điều kiện ấy nằm trong `.superpowers/sdd/2026-08-27-s0-foundation/progress.md` — một file bị
> `.gitignore` che (`git ls-files .superpowers/` trả về **rỗng**). Tức `docs/STATE.md` đang
> **trích một nguồn mà người nhận repo không mở được**: một kiểm toán viên clone kho này sẽ
> không thấy một mẩu nào cho thấy có review an ninh nào từng xảy ra.
>
> File này là dấu vết ấy, đặt **trong** kho mã. Nó **không** phải toàn văn báo cáo — nó là một
> dòng cho mỗi lượt review, có commit được review, có môi trường đo, có số phát hiện theo mức,
> và có commit đóng chúng. Mọi commit dưới đây **kiểm chứng được bằng `git log`**; số phát hiện
> thì **chép lại** từ sổ tay tiến trình và mang đúng độ tin cậy của một bản chép.

## Bảng

| Task | Nội dung | Commit được review | Môi trường đo | Phát hiện | Đóng ở commit |
|---|---|---|---|---|---|
| 3 | Bộ chạy migration SQL thuần, hạ tầng test Postgres | `8957ba7` | Reviewer **không có Bash** (chỉ Read/Grep/Glob) — tự khai rõ và không trình bày suy đoán như số liệu đã đo | **1 HIGH**, 0 CRITICAL (`S1-T3`: thuộc tính role không bao giờ được cưỡng chế; role PostgreSQL là **cluster-wide** nên `IF NOT EXISTS ... CREATE ROLE` bỏ qua toàn bộ khối trên một cluster đã có `app_api`) | `53cbad5`, `66f194c`, `6e8e22c`, `6765050`, `ed7cac1` |
| 4 | Cô lập tổ chức cưỡng chế ở tầng CSDL (RLS + FORCE) | `b009ddc` | `postgres:16-alpine` thật; migration áp **đúng thứ tự của `migrate.ts`** (always → 001 → 002 → always); role đăng nhập THẬT `app_api_login` (NOBYPASSRLS, không sở hữu bảng, không có `RESET ROLE`) | **3 CRITICAL + 3 IMPORTANT + 6 MINOR** | `926c613`, `30374ab`, `4159aa0`, `d06a951` |
| 5 | Sổ kiểm toán chỉ-ghi-thêm cưỡng chế ở tầng DB | `e8332a2` | PG16.15, hồ sơ vai **đúng**: `tp_deploy` (LOGIN + CREATEROLE + chủ sở hữu database/schema/bảng sổ/hàm chặn, **không** superuser), `app_api_login` / `app_unseal_login` (LOGIN, NOBYPASSRLS) | **4 CRITICAL + 6 IMPORTANT + 5 MINOR** | `0195dbb`, `5ae8040` |
| 6 | Chuỗi hash kiểm toán, bộ kiểm chứng, neo ngoài database | `8d92033` | PG16.15, `tp_deploy` với `rolsuper=f` **đã kiểm**, `app_api_login` NOBYPASSRLS không sở hữu gì. Cây chung **byte-identical** sau lượt review | **3 CRITICAL + 6 IMPORTANT + 3 MINOR**, kèm lời tự khai *"ít nhất 12, chưa quét hết"* và một danh sách **trục chưa quét** | `6a320bc`, `8927cc4` |
| 7 | `KeyProvider`, bọc/mở khoá theo tổ chức có phiên bản | `336f63e` | Reviewer opus, song song với review đặc tả. Controller **tự kiểm chứng lại bằng đồ thị phụ thuộc thật** và bắt được hàng rào G1 **chết mà vẫn báo sống** | **1 HIGH**, 0 CRITICAL | `c5f728a`, `ed91281`, `0f27852`, `564850d`, `4274e3b` |
| 8 | Vai trò, quyền, phân tách nhiệm vụ cưỡng chế bằng dữ liệu | `4d9b08a` | Worktree riêng `tp-rev-t8-sec`, container riêng, PG16.15. Superuser chỉ dùng để bootstrap một lần; **mọi phép đo** chạy qua login role thường `rolsuper=f rolbypassrls=f` | **1 CRITICAL + 5 IMPORTANT** (`F1` CRITICAL: D3 fail-open ở **khe giữa hai trigger**). Khuyến nghị: CHƯA ĐỦ CHÍN | `33985b8`, `080950f`, `5ce3a98` |
| 9 | Phiên đăng nhập và xác thực hai lớp TOTP | `05ea892` | Worktree riêng `rv9-audit`, **5 cụm PG16 riêng**. Reviewer tự chạy lại cổng: tsc sạch, depcruise 64 module/154 phụ thuộc, vitest 263/263 | **1 CRITICAL + 3 IMPORTANT + 2 MINOR** (`C-1` CRITICAL: `failed_attempts` **mất cập nhật dưới đồng thời** ⇒ E3 vế (1) không chặn được A6). Khuyến nghị: CHƯA ĐỦ CHÍN | `e9d46db`, `7540156` |
| 10 | Transactional outbox và job runner chạy trong ngữ cảnh tenant | `13a6e5b` | Worktree riêng `rv-t10`, container riêng `rv-t10-pg`. Hồ sơ vai đúng: `app_api` `rolsuper=false rolbypassrls=false`; `outbox_jobs` `relforcerowsecurity=true` | **0 CRITICAL**; khuyến nghị ghi *"BỐN IMPORTANT"* trong khi sổ tay liệt kê **năm mục `I1`–`I5`** — lệch một, xem ghi chú ⑵ dưới bảng. `I1` vi phạm một **lệnh cấm có tên** (CẤM LOG: `payload` đi vào log PostgreSQL) | `36fb138` |
| 11 | Evidence pack và bộ sinh ma trận bất biến | `ed88542` | Worktree riêng `AUDIT-S0-FINAL`, container riêng — **review cuối toàn nhánh**, không phải review an ninh của một task | **2 CRITICAL + 9 IMPORTANT + 6 MINOR** (văn bản/cấu hình; **không** mục nào đòi sửa mã sản phẩm) | vòng fix cuối (commit mang chính file này) |

## Ghi chú

⑴ **Task 1 và Task 2 không có trong bảng.** Điều kiện #8 liệt kê task 4–9; Task 3, 7, 10 và 11
được đưa vào diện đánh giá thêm bằng một phán quyết ghi trong sổ tay (Task 3 ở lượt dispatch của
chính nó). Task 1 (hai hook) và Task 2 (khung monorepo + CI) không qua `security-reviewer`.

⑵ **Một lệch số được giữ nguyên thay vì làm tròn.** Với Task 10, dòng khuyến nghị của reviewer
ghi *"BỐN IMPORTANT, KHÔNG CRITICAL"* nhưng thân báo cáo liệt kê `I1`–`I5`. Lệch một mục.
Không hoà giải được từ trong kho mã, nên nó được **ghi ra** chứ không bị chọn một trong hai con
số cho gọn. Không mục nào trong `I1`–`I5` là CRITICAL, nên vế quan trọng của điều kiện #8
(*mọi phát hiện CRITICAL/HIGH đã xử lý*) không phụ thuộc vào lệch này.

⑶ **Điều này chứng minh gì, và không chứng minh gì.**
**Chứng minh:** các lượt review an ninh đã xảy ra, trên những commit nêu tên, và các commit vòng
fix theo sau tồn tại trong `git log` của nhánh này.
**Không chứng minh:** rằng mỗi phát hiện cụ thể đã được đóng đúng — mối nối giữa "phát hiện thứ
k" và "dòng mã nào trong commit vòng fix" **chỉ có trong sổ tay tiến trình**, và sổ tay ấy không
vào git. Đây là một **bản chép có xuất xứ**, không phải một bản sao của hồ sơ gốc.

⑷ **Hai điều kiện hoàn thành khác cũng rơi vào đúng lỗ này**, và được ghi ở đây vì cùng một lý
do — bằng chứng của chúng là **sự kiện lịch sử** chỉ có trong sổ tay:

| # | Điều kiện | Sự kiện đã xảy ra | Bằng chứng còn lại trong kho mã |
|---|---|---|---|
| 3 | Hai hook được kiểm chứng bằng cách **thật sự bị chặn** trong một phiên Claude Code | Task 1: lệnh **không tới được `git`** — hàng rào chặn ở tầng Claude Code chứ không chỉ ở tầng script (kiểm chứng lại tại `86a54d3`) | `.claude/hooks/` + test của chúng; **bản thân sự kiện "bị chặn trong phiên" thì không** |
| 4 | Quy tắc `khong-giai-ma-ngoai-unseal-worker` được chứng minh chặn thật bằng test đối kháng | Task 2: RED thật bằng cách làm quy tắc mất tác dụng, rồi GREEN lại. Task 7 lặp lại độc lập: reviewer tự tay đổi `to.path` thành chuỗi không khớp ⇒ `× [INV-G1] chặn module ngoài unseal-worker import đường mở khoá — AssertionError` | `.dependency-cruiser.cjs` + `tests/architecture/boundaries.test.ts`; **lượt RED thì không** |

Cả hai vẫn được ghi là **ĐẠT** ở `docs/STATE.md`, và câu đúng để nói về chúng là: *đã xảy ra, đã
được ghi nhận, và bằng chứng nằm ngoài kho mã.* Cách đóng thật sự cho lớp khiếm khuyết này là
đưa lượt RED vào CI dưới dạng một job cố tình vô hiệu hoá quy tắc rồi khẳng định CI đỏ — chưa
làm, và nằm ở sổ nợ `docs/STATE.md`.

---

# Dấu vết review an ninh — S1

> **Khác S0 ở một điểm phải nói ngay:** ba lượt dưới đây chạy với reviewer **chỉ có `Read`/`Grep`/
> `Glob`, KHÔNG có Bash** — tức chúng ĐỌC mã, không chạy được Postgres để tự đo. Đây đúng hạn chế
> đã ghi cho lượt review Task 3 ở bảng trên. Vì vậy mọi phát hiện có hậu quả đều được **controller
> dựng lại thành phép đo trên container Postgres thật** trước khi phân loại, và cột *Phép đo của
> controller* dưới đây ghi kết quả ấy — kể cả khi phép đo **bác bỏ** phát hiện.

| Hạng mục | Nội dung | Commit được review | Môi trường đo | Phát hiện | Phép đo của controller |
|---|---|---|---|---|---|
| S1.1 | Sổ nhà cung cấp Level 0/1 | `ac77e3c` | Reviewer không có Bash. Controller đo lại trên `postgres:16-alpine`, role `app_api` qua `poolAs` | **0 CRITICAL, 2 HIGH, 5 MEDIUM** | **HIGH-1 BỊ BÁC BỎ ở dạng đã nêu** — xem ghi chú ⑸. HIGH-2 (email không kiểm định dạng) **xác nhận**: chuỗi mang `\n` ở giữa lưu được sạch. MEDIUM-4 (22P02 mang nguyên văn đầu vào) **xác nhận** |
| S1.2 | RFQ, hạng mục, phê duyệt, máy trạng thái | `fcd5986` | Reviewer không có Bash | **1 CRITICAL, 4 HIGH, 7 MEDIUM, 4 LOW** | Chưa dựng lại — xem *Việc còn lại* |
| S1.3 | Lời mời, magic link, OTP, phiên khách ⭐ | `bca870f` | Reviewer không có Bash. Controller dựng lại **trọn chuỗi tấn công** trên Postgres thật | **3 CRITICAL, 5 HIGH, 5 MEDIUM, 4 LOW** | **CHUỖI TẤN CÔNG CHẠY TRỌN** — xem ghi chú ⑹ |

## Ghi chú S1

⑸ **Phát hiện HIGH-1 của S1.1 bị bác bỏ, và nó bác bỏ theo một cách đáng ghi hơn nếu nó đúng.**
Reviewer lập luận rằng vi phạm `CHECK`/`UNIQUE` trên `supplier_contacts` trả về `DETAIL: Failing
row contains (...)` chứa đủ họ tên, email, số điện thoại — vì `ExecBuildSlotValueDescription` chèn
mọi cột mà role đọc được, và `app_api` có `GRANT SELECT` cả bảng. Cơ chế đúng, tiền đề đúng, kết
luận **sai**. Đo được:

```
app_api    23514 -> khong co detail   ·  23505 -> khong co detail
superuser  23514 -> detail: Failing row contains (..., Nguyen Van A, a@congty.vn, 0900 000 001, ...)
```

Thí nghiệm phân biệt, **cùng bảng, cùng role, cùng câu lệnh, chỉ khác một thứ**:

```
KHONG-RLS  code=23514  detail=Failing row contains (1, Nguyen Van A, x y).
CO-RLS     code=23514  detail=undefined
```

PostgreSQL **tự chặn `DETAIL` khi bảng có RLS còn hiệu lực với role đang gọi**. Nghĩa là lỗ PII có
thật như một lớp, và nó đang được đóng bởi `FORCE ROW LEVEL SECURITY` — **một thứ dự án bật vì lý
do khác**, và không tài liệu nào của dự án ghi rằng RLS mua thêm tính chất này. Hai hệ quả phải
ghi ra: ⑴ ngày ai đó thêm một bảng chứa dữ liệu cá nhân **không** có RLS, lỗ quay lại nguyên vẹn
và không lớp nào kêu; ⑵ trên đường **deploy** (role không chịu RLS) lỗ vẫn mở.

⑹ **Ba CRITICAL của S1.3 được dựng lại thành một chuỗi tấn công và nó chạy trọn.** Kịch bản: kẻ
tấn công chỉ có `invitationId` — không token, không chạm hộp thư của người liên hệ thật.

```
C1  phat OTP toi so tu chon ......................... THANH CONG
H1  mo phien chi bang invitationId .................. THANH CONG
C2  so kiem toan ghi danh tinh ...................... NGUOI THAT (sai su that)
C3a sau THU HOI van phat duoc OTP ................... CO
C3b sau THU HOI van mo duoc PHIEN MOI ............... CO
H3b phat lai thach thuc roi doan tiep ............... WRONG_CODE (khoa da bi reset)
```

**Hậu quả trực tiếp lên hồ sơ, và nó được xử lý TRƯỚC khi sửa mã:** commit `bca870f` khai E2 và E5
là **ĐÃ PHỦ**. Phép đo chứng minh cả hai ô ấy rộng hơn cơ chế. Ba test mang nhãn `[INV-E2]`/
`[INV-E5]` bị **gỡ nhãn** (chúng đo một tính chất thật, nhưng hẹp hơn hẳn mệnh đề — đúng lớp lỗi
đã bị bắt hai lần ở S0 với `[INV-G2]` và `[INV-B2]`), hai mã quay lại `MA_DUOC_PHEP_CHUA_PHU` kèm
lý do đo được, và `MOC_GHIM` đi **30 → 28** với `coDanhSachToiDa` **20 → 22**. Đây là lần đầu tiên
trong dự án danh sách "được phép chưa phủ" **NỞ RA**; cơ chế `MOC_GHIM` được dựng để chặn đúng
chiều đó, nên nới nó là một dòng phải sửa bằng tay, có tên, trong một file có chủ sở hữu.

⑺ **Điều kiện hoàn thành S1 mục 6 CHƯA ĐẠT.** Nó đòi *mọi phát hiện CRITICAL/HIGH đã được xử lý*.
Tổng: **4 CRITICAL + 11 HIGH** trên ba hạng mục, và **chưa một phát hiện nào được sửa** tại thời
điểm ghi dòng này. Việc duy nhất đã làm là gỡ lời khai sai khỏi `evidence/INV-matrix.md`. Ba hạng
mục S1.1–S1.3 vì vậy **KHÔNG được coi là xong**, và `docs/STATE.md` phải nói đúng điều đó.

## Vòng sửa sau review — 2026-08-29

⑻ **Ghi chú ⑺ ở trên nói *"chưa một phát hiện nào được sửa"*. Câu đó ĐÚNG tại thời điểm nó được
viết và KHÔNG còn đúng nữa.** Giữ nguyên văn, đánh dấu tại chỗ.

| Mức | Tổng | Đã đóng | Ở đâu |
|---|---|---|---|
| CRITICAL | 4 | **4** | `011_rfq_hardening.sql` (C-1 của S1.2) · `012_invitation_hardening.sql` + `packages/invitation` (C1, C2, C3 của S1.3) |
| HIGH | 11 | **10** | 011 (H-1…H-4 của S1.2) · 012 + gói (H1…H5 của S1.3) · `packages/supplier` (HIGH-2 của S1.1) |
| HIGH bị BÁC BỎ | — | 1 | HIGH-1 của S1.1 — xem ghi chú ⑸ |

**Nguyên tắc của vòng sửa, và nó giải thích mọi thay đổi:** ba CRITICAL của S1.3 có CÙNG một hình
dạng — *một sự thật an ninh được NHẬN VÀO dưới dạng tham số thay vì được ĐỌC RA từ dữ liệu*. Đích
nhận OTP là tham số; danh tính đã xác thực là tham số; quyền yêu cầu OTP chỉ cần một UUID. Cách
đóng vì vậy giống nhau ở cả ba: **thêm một cạnh DỮ LIỆU** rồi để trigger đòi các cạnh ấy nhất
quán. Sau vòng này, không hàm nào trong `packages/invitation` có thể KHAI một sự thật an ninh —
nó chỉ có thể CHỨNG MINH một cái đã có.

**Chuỗi tấn công cũ nay là một bộ test.** Từng bước từng THÀNH CÔNG nay phải BỊ CHẶN, và mỗi phép
chặn kèm một vế ĐỐI CHỨNG DƯƠNG — không có vế đó thì "chặn tất cả" cũng làm test xanh. Hai phép
chặn được đo bằng câu SQL VIẾT TAY chứ không qua gói, vì đó là chỗ duy nhất chứng minh lớp nằm ở
CSDL: một `INSERT INTO guest_sessions` khai danh tính khác, và một `INSERT INTO
invitation_otp_challenges` trỏ tới người liên hệ của nhà cung cấp khác.

**Một phát hiện KHÔNG được sửa, và lý do phải nói ra:** MEDIUM-3 của S1.1 (*không có một phép kiểm
thẩm quyền nào trong `packages/supplier`; `actor` là lời khai*). Nó đúng, nhưng đóng nó là một
quyết định kiến trúc — cổng quyền nằm ở gói hay ở tầng API — và ADR-014 mục 5 đã đặt "điều kiện
cần ngữ cảnh" ở tầng ứng dụng mà chưa nói tầng nào. Đây là một ADR phải mở, không phải một dòng
mã phải thêm. Cùng lý do cho M-6 của S1.2 (ngưỡng `requires_dual_approval` chưa có chính sách nào
tính nó) và M1 của S1.3 (băm đích cần một pepper giữ ngoài CSDL).

**Cập nhật 2026-08-30 — ba ADR ấy đã được viết: ADR-016, ADR-017, ADR-018.** Ba phát hiện này
**VẪN Ở TRẠNG THÁI MỞ** trong bảng trên, và đó là phát biểu đúng: một quyết định kiến trúc **không
phải** một lớp. Lượt viết ADR không đổi một dòng mã sản phẩm nào; mỗi ADR để lại một mục *Đo bằng
gì*, và ô "commit đóng" chỉ được điền sau khi phép đo trong mục ấy có một lượt **RED thật**. Đây
đúng lớp lỗi mà `evidence/INV-matrix.md` §6 dựng ra để chặn — *một ô ✅ chứng minh gì, và không
chứng minh gì*.

Một phát hiện phụ của lượt viết ADR-018, ghi ở đây vì nó đổi **giá** của việc đóng M1: sau vòng sửa
011/012, `invitation_otp_challenges.destination_hash` **gần như dư**. Đích nay đọc từ
`supplier_contacts` (C1) và 011 đã `REVOKE UPDATE ON supplier_contacts FROM app_api`, nên
`contact_id` + `channel` đã xác định đích. Giá trị còn lại của cột hẹp hơn nhiều so với lúc nó được
thêm, nên **bỏ cột** là một cách đóng M1 hợp lệ ngang với việc cài pepper.

### Vòng cài ba ADR — 2026-08-30

Ba phát hiện MEDIUM ở trên **nay đã có lớp, và mỗi lớp có một lượt RED thật**. Bảng dưới đây là
mối nối *"phát hiện ↔ commit đóng"* mà §*Giới hạn của bộ bằng chứng* nói là thứ file này thường
KHÔNG chứng minh được — ở đây nó có, vì cả ba lớp đều đo được từ ngoài.

| Phát hiện | ADR | Migration | Commit đóng | Lượt RED thật |
|---|---|---|---|---|
| **MEDIUM-3** (S1.1) — `actor` là lời khai | ADR-016 | `013` | `91473ea` | gỡ `suppliers_kiem_danh_tinh` → `INSERT` khai man **đi lọt**; gỡ `rfq_invitations_kiem_nguoi_thu_hoi` → `UPDATE` không ký tên **đi lọt** |
| **M-6** (S1.2) — `requires_dual_approval` không chính sách nào tính | ADR-017 | `014` | `52fc53a` | gỡ `rfq_packages_kiem_nguong_phe_duyet_kep` → cờ hạ bằng tay **đi lọt** vào `PENDING_APPROVAL` |
| **M1** (S1.3) — băm đích không có pepper | ADR-018 | `015` | (lượt này) | liệt kê 10⁴ số **TÌM RA** đích khi băm không có pepper (11 ms), **không tìm ra** khi có |

**Ba điều lượt cài tìm ra mà ba lượt review KHÔNG tìm ra**, ghi ở đây vì chúng nói về giới hạn của
chính hình thức review:

1. **`packages/rfq` mang đúng khiếm khuyết MEDIUM-3 nêu cho `packages/supplier`** — `createRfq`
   tới hôm nay vẫn nhận `actor: RfqActor` và ghi thẳng nó vào sổ. Không lượt review nào gọi tên nó,
   vì mỗi lượt chỉ nhìn một hạng mục. **Vẫn MỞ.**
2. **`invitation_otp_challenges.code_hash` cũng đảo ngược được** — mã OTP là sáu chữ số (10⁶) và
   `invitation_id` nằm cùng bản sao lưu. M1 chỉ nêu băm ĐÍCH. Đã đóng trong cùng lượt.
3. **`estimated_value` không thể bảo vệ bằng quyền theo cột** như ADR-017 mục 4 hứa: đường khách và
   đường người mua dùng **chung role `app_api`**. Câu ấy đã bị gạch bỏ tại chỗ và thay bằng bảng
   riêng.

**Điều vòng này KHÔNG đóng:** cổng quyền ở tầng ứng dụng vẫn **mặc định MỞ** — lớp canh route chưa
dựng được vì `apps/` rỗng, và ADR-016 mục 4 ghim nó vào **route đầu tiên của `apps/`**.

## S1.4 — và một dòng phải viết ra thay vì để trống

⑽ **S1.4 mang dấu ⭐ `security-reviewer` trong kế hoạch S1 §1, và lượt review ấy CHƯA XẢY RA.**

Đây là **cùng một khoảng trống** đã ghi cho S1.3 (xem ghi chú ⑺ và §11 của `Handoff.md`), không
phải một khoảng trống mới: phiên làm việc dựng S1.4 chạy dưới một ràng buộc không cho gọi
subagent trừ khi người dùng yêu cầu. Ghi ở đây vì một hạng mục ⭐ **không có dòng nào trong file
này** sẽ được người đọc sau hiểu là *đã review và sạch*, chứ không phải *chưa review*.

**Điều kiện hoàn thành S1 mục 6 vì vậy vẫn CHƯA ĐẠT**, nay vì một lý do KHÁC với lý do cũ: bốn
CRITICAL và mười HIGH của S1.1–S1.3 **đã đóng** (xem bảng ở trên), nhưng S1.4 — hạng mục chạm
thẳng vào khoá riêng — **chưa được ai đóng vai kẻ tấn công**.

**Thứ S1.4 tự làm được và đã làm, ghi ra để lượt review sau khỏi lặp lại:**

| Câu hỏi một reviewer sẽ hỏi | Đã có phép đo chưa |
|---|---|
| `app_api` đọc được khoá riêng không? | **Có** — `SELECT` bị từ chối; đối chứng dương dưới `app_unseal`; đột biến cấp thêm đúng cột ấy chứng minh quyền cột LÀ thứ đang chặn |
| Khoá của RFQ A mở được phong bì của RFQ B không? | **Có** — ba mũi, mỗi mũi một đối chứng dương |
| Sửa mã thuật toán trong phong bì có hạ cấp được không? | **Có** — hai lớp độc lập, đo riêng từng lớp |
| AAD có răng không? | **Có, và câu trả lời ĐẦU TIÊN là KHÔNG** — gỡ AAD khỏi cả hai chiều cho 16/16 vẫn xanh. Nay đã có test giải mã tay bằng AAD là đúng phần đầu phong bì |
| Sinh khoá sai lúc thì sao? | **Có** — ba trigger, ba phép đo, ba lượt đột biến |
| Khoá riêng có rời khỏi tiến trình `api` không? | **Chưa đo trực tiếp.** Lớp hiện có là KIỂU (không hàm nào trả nó) cộng `fill(0)`. Một bộ quét heap/core dump thì **không có** — và ADR-019 tự khai đúng chỗ trống ấy |
| Bên thứ ba nào import được đường mở phong bì? | **Có** — probe depcruise, cộng một đối chứng dương cho `apps/unseal-worker` (thư mục CHƯA tồn tại) |

Dòng cuối cùng của bảng là dòng đáng cho reviewer bắt đầu: nó là chỗ **duy nhất** trong S1.4 mà
một bảo đảm đứng trên KIỂU và KỶ LUẬT thay vì trên một lớp cưỡng chế.

## S1.5 — hạng mục ⭐ thứ hai không có lượt review, và một điểm reviewer nên nhắm

⑾ **S1.5 mang dấu `qa-engineer` (không phải ⭐) trong kế hoạch S1 §1, và lượt ấy CŨNG chưa xảy
ra** — cùng lý do đã ghi ở ⑽. Nhưng S1.5 chạm vào nhiều bề mặt an ninh hơn dấu của nó gợi ý, nên
nó nên được xếp cùng S1.4 trong lượt `security-reviewer` kế tiếp.

**Điểm nên nhắm trước, và nó KHÔNG phải phần mật mã:**

Phần mật mã của S1.5 có phép đo dày (chữ ký kiểm bằng khoá công khai một mình, đối chiếu với một
cài đặt khác, ba đối chứng âm, xoay khoá, tính mềm dẻo được đo ra). Chỗ mỏng nằm ở **A5**, và nó
đã được khai báo thành khoản nợ 29: phiên khách chạy dưới **cùng role và cùng `org_id`** với người
mua, nên **RLS không cô lập nhà cung cấp với nhà cung cấp**.

Câu hỏi một reviewer nên hỏi, theo thứ tự:

| Câu hỏi | Trạng thái hôm nay |
|---|---|
| Một phiên khách GHI được vào luồng báo giá của người khác không? | **Không** — trigger `bid_kiem_phien_khach` (018), có test kèm đối chứng |
| Một phiên khách ĐỌC được luồng của người khác không? | **Được, nếu tầng ứng dụng để lọt.** Không lớp CSDL nào chặn. Khoản nợ 29 |
| Một báo giá nộp sau hạn có lọt không? | **Không** — trigger dùng `now()` của chính transaction ghi, có test và có lượt đột biến |
| ... kể cả khi transaction MỞ trước hạn và COMMIT sau hạn? | **CÓ LỌT.** Phần chênh đã khai ở §4 của C1 |
| `api` bị chiếm có rút được phong bì niêm phong không? | **Không** — `app_api` không có SELECT trên `envelope`, có test kèm hai đối chứng dương |
| Biên nhận có bị làm giả bằng cách sửa `canonical_text` trong CSDL không? | **Không sửa được** — không GRANT UPDATE, cộng trigger chặn cả superuser trên đường DML |
| Ai lấy khoá công khai để kiểm chứng? | **Hỏi chính chúng ta** — đường công bố chưa tồn tại. Khoản nợ 30 |

Hai dòng in đậm ở cột phải là hai chỗ **đã biết là hở**, cả hai có khoản nợ mang số. Chúng được
viết ra ở đây để lượt review không tốn thời gian tìm lại, và để nếu reviewer tìm ra một chỗ hở
**thứ ba** thì đó là một phát hiện thật chứ không phải một thứ đã biết.


---

# S1 — bốn lượt review, một vòng sửa

> **Điều kiện #6 của kế hoạch S1** đòi *"một buổi `security-reviewer` cho mỗi hạng mục có dấu ⭐,
> ghi vào `evidence/security-reviews.md` theo đúng định dạng đã có"*. Bốn lượt dưới đây chạy
> **cùng lúc, trên cùng một commit**, mỗi lượt một phạm vi tách rời.
>
> **Khác biệt so với bảng S0, và nó quan trọng:** bốn reviewer này KHÔNG CÓ Bash, KHÔNG CÓ cơ sở
> dữ liệu, và KHÔNG chạy được một test nào — chỉ `Read`/`Grep`/`Glob`. Mọi phát hiện là **đọc mã**,
> không phải **đo**. Cả bốn đều tự khai điều đó trong báo cáo. Hệ quả đọc được ở cột "Đóng ở":
> phần lớn phát hiện được xác minh lại bằng một phép đo TRƯỚC khi sửa — và một phát hiện đã được
> xác minh là **sai một nửa** (xem ghi chú ⑵).

## Bảng

| Hạng mục | Phạm vi | Commit được review | Môi trường đo | Phát hiện | Đóng ở commit |
|---|---|---|---|---|---|
| **S1.3** ⭐ | Lời mời, magic link, OTP, phiên khách (RE-review sau vòng sửa đầu) | `388bd86` | Reviewer **không có Bash/CSDL** — tự khai; mọi kết luận là đọc mã | **1 HIGH + 5 MEDIUM + 6 LOW** (`HIGH-1`: ADR-015 mục 1 so NHÃN kênh, mà `SMS` và `ZALO_ZNS` cùng đọc `supplier_contacts.phone` ⇒ hai yếu tố tới cùng một máy) | `0f30b16` |
| **S1.4** ⭐ | Phong bì niêm phong, vòng đời khoá RFQ, WebCrypto phía NCC | `388bd86` | như trên | **2 HIGH + 2 MEDIUM + 5 LOW** (`HIGH-1`: worker ghim `algorithm = 'ECDH_P256'` trong khi `chooseKeyAgreementAlgorithm` **ưu tiên X25519** ⇒ báo giá có biên nhận đã ký bị bỏ trong im lặng) | `0f30b16` |
| **S1.6** ⭐ | Cổng chính sách bốn vế, phê duyệt kép, worker, giải mã | `388bd86` | như trên | **3 HIGH + 5 MEDIUM + 4 LOW** (`HIGH-1`: một byte `U+0000` trong bản rõ của MỘT nhà cung cấp làm cả lượt mở thầu rollback vĩnh viễn; `HIGH-2a`: break-glass tới `APPROVED` với KHÔNG nhân chứng nào; `HIGH-3`: một câu SAI về GRANT đang che một lớp có thật) | `0f30b16` |
| **S1.7 + S1.8** ⭐ | Bảng so sánh, số báo giá, job toàn vẹn B5, bộ đối kháng T5 | `388bd86` | như trên | **1 HIGH + 5 MEDIUM + 2 LOW** (`HIGH-1`: `extendRfqDeadline` HỒI SINH được một cửa sổ thầu đã hết — cạnh `CLOSED -> OPEN` mà máy trạng thái cố ý không có, đạt được bằng một đường khác) | `0f30b16` |

## Ghi chú

⑴ **Bảy phát hiện mức HIGH, cả bảy đã đóng bằng mã, và mỗi cái để lại một phép đo.** Vòng sửa
nằm trong migration `022_security_review_s1.sql` cộng bảy file mã. Không phát hiện nào được đóng
bằng một dòng chú thích.

⑵ **Một phát hiện đã được xác minh là SAI MỘT NỬA trước khi sửa, và nó được ghi ra chứ không làm
tròn.** Báo cáo S1.4 xếp `HIGH-1` (X25519) là *"latent, không live"* — đúng; nhưng nó cũng viết
rằng *"không production module nào gọi `chooseKeyAgreementAlgorithm`"*, và từ đó suy rằng lỗi chỉ
kích hoạt khi có giao diện. Vế suy luận ấy đúng, nhưng nó KHÔNG làm cho lỗi nhẹ đi: `issueRfqKeyPair`
mặc định sinh CẢ HAI cặp khoá ngay hôm nay, nên dữ liệu đã ở hình dạng nguy hiểm trước khi có
giao diện. Bản sửa vì thế đi xa hơn khuyến nghị: worker chọn khoá theo thứ **phong bì tự khai**
(`describeEnvelope`), không theo một hằng số.

⑶ **Một phát hiện đã lật ngược một câu do CHÍNH DỰ ÁN viết ba lần.** `S1.6 HIGH-3`: chú thích ở
`packages/unseal/src/gate.ts`, ở `apps/unseal-worker/src/index.ts` và §4 của D1 đều nói
*"`app_unseal` cố ý không đọc được `users`"*. `006_sessions_and_mfa.sql:232` và `:305` nói ngược
lại, và 006 ghi rõ là cấp *"vì bất biến D1"*. Ba bản sao của một câu sai đã biện minh cho việc
KHÔNG kiểm lại MFA ở đúng hành động không thu hồi được của hệ thống. Cả ba nay bị **gạch bỏ tại
chỗ, giữ nguyên văn**, và lớp bị che nay đã được cài.

⑷ **Điều này chứng minh gì, và không chứng minh gì.**
**Chứng minh:** bốn lượt review đã chạy trên commit `388bd86`; các phát hiện mức HIGH được liệt
kê ở trên đều có một phép đo tương ứng trong bộ test của nhánh này, và mỗi phép đo ấy được dựng
để ĐỎ nếu bản sửa bị gỡ đi.
**Không chứng minh:** rằng bốn báo cáo ấy đã quét hết. Cả bốn reviewer đọc mã bằng mắt, không
chạy được gì, và không lượt nào tự nhận là đã vét cạn. Các mã MEDIUM/LOW chưa đóng được ghi
thành khoản nợ có tên ở `docs/STATE.md`.


---

# S1.10 — tầng HTTP đầu tiên: lượt review thứ nhất (10.3 + 10.4), và vòng sửa

> **Cùng giới hạn với bốn lượt S1:** reviewer KHÔNG có Bash, KHÔNG có CSDL, KHÔNG chạy được test —
> chỉ `Read`/`Grep`/`Glob`, và tự khai điều đó ở dòng đầu báo cáo. Mọi phát hiện là **đọc mã**.
> Lượt này còn có một giới hạn thứ hai, do chính reviewer chỉ ra ở mục "không kết luận được" ⑴:
> khi reviewer đọc, `routes/buyer.ts` của S1.10.5 đã được viết dở trên cùng cây mã, nên reviewer
> **không chắc bản mình đọc biên dịch được** — đúng thứ đã xảy ra (commit `214a741` có một lỗi
> lint, xem STATE mục 21). Báo cáo toàn văn nằm trong sổ tay phiên làm việc (ngoài git); bảng dưới
> là bản chép có xuất xứ, cùng độ tin cậy với bảng S1.

## Bảng

| Hạng mục | Phạm vi | Commit được review | Môi trường đo | Phát hiện | Đóng ở commit |
|---|---|---|---|---|---|
| **S1.10.3** ⭐ + **S1.10.4** ⭐ | `apps/api` (dispatch, server, router, route-types, routes/anon, guest, auth), `identity/login.ts`, `identity/session-actor.ts`, `invitation.resolveGuestSessionByToken`, migration `028`, `029` | cây mã giữa `5a3dca3` và `214a741` (10.5 đang viết) | Reviewer **không có Bash/CSDL** | **0 CRITICAL · 0 HIGH · 8 MEDIUM · 8 LOW** | vòng sửa 10.7 — xem cột "Trạng thái" bảng dưới |

## Tám MEDIUM, tám LOW — và cái gì được làm với từng cái

| Mã | Tóm tắt phát hiện | Trạng thái sau vòng sửa 10.7 |
|---|---|---|
| M-1 | `/auth/link` đồng nhất THÂN nhưng không đồng nhất THỜI GIAN và mã lỗi: nhánh có người dùng làm nhiều I/O hơn (INSERT + gửi mail), và `send` ném ⇒ 500 chỉ khi người dùng tồn tại | **Đóng một nửa bằng mã** — gửi mail chuyển ra SAU COMMIT (`afterCommit`), nên lỗi của bộ gửi không còn đổi mã trạng thái; **nửa thời gian VẪN MỞ** — sổ nợ **38** |
| M-2 | Không có bucket theo NGƯỜI GỌI (IP) cho ba route `/auth/*`; ADR-020 hứa `LOGIN_DEST` trên `otp_rate_limits` mà mã không dùng | **MỞ** — sổ nợ **39**; ADR-020 §"Phần KHÔNG đóng" sửa cho đúng thứ đang có (hạn mức theo người dùng, trên bảng token) |
| M-3 | ADR-020 khai "kiểm `Origin` trên mọi POST" — **không có dòng nào** làm việc ấy | **Đóng bằng mã** — `server.ts` từ chối 403 mọi yêu cầu không-GET có `Origin`/`Sec-Fetch-Site` khác nguồn cho phép; test đối kháng kèm |
| M-4 | Trigger 029 chỉ kiểm `mfa_verified_at IS NOT NULL` — một proxy mà `startUserSession` luôn thoả; bất biến thật ("vừa có một lần TOTP đúng") chỉ do thứ tự ba dòng trong handler giữ | **Đóng bằng KIỂU, CSDL còn mở** — `startUserSession` đòi `mfaProof: MfaProof`, một lớp constructor riêng tư chỉ `verifyTotpForLogin` tạo được, kiểm đúng người/đúng tổ chức: "mở phiên mà quên TOTP" nay KHÔNG BIÊN DỊCH ĐƯỢC. Vế trigger (đòi bộ đếm TOTP gần đây) **không làm** — lý do đo được ở đầu migration `031`: bộ test lược đồ 006 chèn `sessions` dưới `app_api` để đo FK/CHECK/UNIQUE, và trigger ấy làm tám phép đo rỗng ruột. Sổ nợ **43** |
| M-5 | Ghi danh TOTP bằng MỘT yếu tố, không audit, không phân biệt hồ sơ chưa xác nhận; ai đọc được hộp thư trước lần đăng nhập đầu chiếm yếu tố thứ hai vĩnh viễn | **Đóng một phần bằng mã** — `MFA_ENROLLED` vào sổ (kèm IP); hồ sơ **chưa `confirmed_at`** được ghi danh LẠI (không khoá chết người mua thật); **đường quản trị đặt lại TOTP VẪN MỞ** — sổ nợ **40** |
| M-6 | Test `[INV-E6]` "bí mật không vào log" là phép đo RỖNG — đường 500 không chạy (thân `code: 123456` chỉ cho 422) | **Đóng** — test ép 500 THẬT bằng bộ mở bí mật TOTP ném lỗi, đòi `logLoi` KHÔNG rỗng trước khi đòi nó không chứa bí mật |
| M-7 | Bốn lời gọi I/O ra ngoài (SMS, mail, KMS bọc/mở) chạy TRONG giao dịch `withTenant`: giữ kết nối pool suốt độ trễ nhà cung cấp; `send` ném ⇒ rollback bộ đếm hạn mức | **Đóng cho SMS/mail** — `afterCommit`; **KMS bọc/mở vẫn trong giao dịch** (ghi ở sổ nợ 38, cùng dòng với timeout pool) |
| M-8 | `callerFingerprint` = IP socket, không có cấu hình proxy tin cậy — sau LB mọi client là MỘT fingerprint, bucket `CALLER` thành hạn mức toàn tổ chức | **Đóng một nửa** — `ServerOptions.remoteAddressOf` cho composition root thay nguồn; ADR-020 ghi rõ *"chưa có hook ấy thì api không được đặt sau proxy"*; hook đọc `X-Forwarded-For` theo CIDR tin cậy là sổ nợ **41** |
| L-1 | `resolveSessionByToken` không xét `users.status`: người bị đình chỉ vẫn đọc được route đọc tới hết TTL | **Đóng bằng mã** — JOIN `users.status = ACTIVE`, cùng lỗi, có test |
| L-2 | Cookie không có tiền tố `__Host-`; cookie trùng tên lấy giá trị ĐẦU | **MỞ** — sổ nợ **42** (đổi tên cookie là đổi hợp đồng client) |
| L-3 | Trộn header bằng spread phân biệt hoa thường — `Cache-Control` (hoa) của handler đứng cạnh `cache-control` mặc định | **Đóng bằng mã** — chuẩn hoá khoá về chữ thường; test |
| L-4 | Trigger 029 so tên vai `app_api` — vai thứ hai đi qua im lặng | **MỞ, có chủ đích** — ghi ở 029; đổi sang danh sách vai được miễn là quyết định vận hành |
| L-5 | Không lớp máy nào cấm handler khách `mutates:true` viết SQL tay dưới kết nối chỉ gắn tổ chức | **Đóng bằng lớp canh tĩnh** — `routes.test.ts`: route khách ghi không được chứa `.query(` |
| L-6 | Bí mật TOTP bị sao chép hai lần trước khi `fill(0)` | **Đóng bằng mã** |
| L-7 | 401 của `/auth/totp` mang `reason` chi tiết + `lockedUntil` tới giây; thân 200 mang `userId` | **Đóng bằng mã** — chỉ `WRONG_CODE`/`LOCKED_OUT`, `lockedUntil` làm tròn lên phút, bỏ `userId` |
| L-8 | Không đặt `requestTimeout`/`headersTimeout`/`keepAliveTimeout` — Slowloris thân JSON | **Đóng bằng mã** — ba con số tường minh trong `ServerOptions` |

**Một điều reviewer đúng mà lượt viết không thấy:** chú thích ở `dispatch.ts` nói `withTenant` "ném
TenantError cho một orgId không tồn tại" — sai, nó chỉ kiểm hình dạng UUID. Đã sửa chú thích trước
cả vòng sửa. **Ba điểm reviewer KHÔNG kết luận được** vì không chạy được mã: ⑴ cây mã có biên dịch
không (đúng là không — lỗi lint ở `214a741`); ⑵ độ lớn oracle thời gian M-1 và bộ gửi thật; ⑶ policy
027 lọc hai route khách không `WHERE`, và trigger 013 chấp nhận `MFA_LOCKED` không kèm phiên — cả
hai ĐÃ được đo bằng test (`guest.int.test.ts` [INV-A5], `auth.int.test.ts` [INV-E3]).

# S1.10 — lượt review thứ hai (10.5 + 10.6 + vòng sửa 10.7), và vòng sửa thứ hai

> Cùng giới hạn: reviewer chỉ `Read`/`Grep`/`Glob`, không chạy được test hay `tsc`, tự khai ở dòng
> đầu. Lượt này đọc bảng lượt thứ nhất TRƯỚC, và cố ý kiểm lại từng dòng "đóng bằng mã" của vòng
> sửa 10.7 — ba dòng bị bắt là đóng SAI (M-4, M-5/031, §4 của A2). Đó là giá trị lớn nhất của lượt
> này, hơn cả mười hai phát hiện mới.

## Bảng

| Hạng mục | Phạm vi | Commit được review | Môi trường đo | Phát hiện | Đóng ở commit |
|---|---|---|---|---|---|
| **S1.10.5** + **S1.10.6** + vòng sửa **10.7** | `routes/buyer.ts`, `dispatch.ts` (ánh xạ lỗi, afterCommit), `server.ts` (Origin), migration `030`, `031`, `kich-ban-41-http.int.test.ts` (bộ quét), `login.ts` (`MfaProof`), lớp canh `routes.test.ts` | `f40803f` (cây sạch) | Review tĩnh; CSDL/test do lượt viết chạy sau | **0 CRITICAL, 0 HIGH, 4 MEDIUM, 8 LOW** | commit vòng sửa 2 (cùng PR #4) |

## Bốn MEDIUM, tám LOW — và cái gì được làm với từng cái

| Mã | Tóm tắt phát hiện | Trạng thái sau vòng sửa 2 |
|---|---|---|
| H2-1 | 031 cấp `UPDATE (secret_wrapped, secret_key_version)` — một `app_api` bị chiếm thay được bí mật của hồ sơ ĐÃ xác nhận; 006 đã cấp `UPDATE (confirmed_at)` và không đâu cấm đưa nó về NULL; "đột biến ở tầng SQL" xanh vì câu UPDATE của test tự mang `WHERE confirmed_at IS NULL` | **Đóng bằng CSDL** — migration `032`: trigger BEFORE UPDATE, khi `OLD.confirmed_at IS NOT NULL` thì ba cột phải giữ nguyên (`check_violation`, điều kiện theo vai `app_api` cùng khuôn 029). Test viết lại: UPDATE KHÔNG mang WHERE ⇒ ném; cặp "mở khoá rồi thay" chết ở nửa đầu; gỡ trigger ⇒ 1 hàng đi lọt; khôi phục ⇒ ném; câu hợp lệ của `verifyTotpAttempt` ⇒ 1 hàng. Đầu 031 gạch câu sai; trạng thái M-5 ở bảng trên đọc kèm dòng này |
| H2-2 | 030 biện minh "người khai ước lượng không được là người đặt ngưỡng" nhưng `PROCUREMENT_MANAGER` có `rfq.create` (ước lượng) + `rfq.approve` + `policy.manage`: một PM nâng ngưỡng ⇒ D2 hạ xuống một phê duyệt | ~~**MỞ — QUYẾT ĐỊNH đang chờ, sổ nợ 44.**~~ **ĐÓNG cùng ngày, PR #5 (chốt: CẢ HAI lựa chọn)** — migration `033`: `policy.manage` sang `FINANCE`; hai trigger cấm nó đứng cùng `rfq.create`/`rfq.approve` ở một vai và ở một người; đột biến gỡ trigger ⇒ đi lọt. Câu biện minh gạch và sửa tại chỗ ở 030; ADR-017 chốt; **D2 nhận cờ §4 lần đầu** (giữ, vì tách vai không đóng vế "khai thấp") |
| H2-3 | `POST /policy` nhận `version` tuỳ ý; cột `integer`, trigger 022 đòi "lớn hơn", không UPDATE/DELETE ⇒ `2147483647` ghim tổ chức vĩnh viễn | ~~**Đóng ở tầng HTTP, vế CSDL mở — sổ nợ 45.**~~ **ĐÓNG CẢ HAI TẦNG (PR #7, migration `035`)** — route đòi `version` = hiện hành + 1; trigger 022 thay thân: `version` phải BẰNG đúng lớn nhất + 1 ở CSDL; gỡ trigger ⇒ 2147483647 đi vào |
| H2-4 | Bộ quét rò rỉ rỗng ruột ở cửa sổ nó chạy: trước mở thầu bản rõ chưa tồn tại phía máy chủ; route ghi gọi với thân `{}` ⇒ 422 trước nghiệp vụ; vế log đo trên log RỖNG (`sha256(...).length === 64` đúng cả với chuỗi rỗng); §4 A2 khai "cả đọc lẫn ghi", "kể cả 4xx/5xx" | **Đóng ba trong bốn vế bằng mã, vế thứ tư vào sổ nợ 49.** ⑴ VÒNG QUÉT THỨ HAI sau bước 11: năm phiên khách + người mua KHÔNG `bid.view` gọi mọi route đọc — không giá nào lọt, `comparison` ⇒ 403 thật; ⑵ bước 15 ép một 500 THẬT (khuôn M-6) rồi mới đòi log sạch; ⑷ §4 A2 viết lại (gạch tại chỗ, thêm giới hạn bộ dò như A3/A4). ⑶ thân hợp lệ cho route ghi — nợ 49 |
| H2-5 | `MfaProof._tao` công khai + barrel xuất lớp dạng GIÁ TRỊ ⇒ `startUserSession(..., { mfaProof: MfaProof._tao(...) })` biên dịch sạch từ `apps/api` | **Đóng bằng mã** — `export type { MfaProof }`; hàm tạo là biến module-private gán trong `static {}`; whitelist barrel bỏ tên (một lần xuất lại dạng giá trị làm test lệch). Câu ở M-4 nay đọc: "không biên dịch được, và không còn cửa `_tao`" |
| H2-6 | Test M-3 "Origin được phép ⇒ đi qua" chạy trên máy chủ KHÔNG truyền `allowedOrigins` — nhánh `includes` chưa từng chạy | **Đóng bằng test** — máy chủ thứ hai với `allowedOrigins: ["https://app.test"]`: đúng ⇒ 201; `.evil`, khác scheme, khác cổng ⇒ 403 |
| H2-7 | `afterCommit` chạy TRƯỚC khi phản hồi được ghi, không trần thời gian; bộ gửi treo ⇒ `/auth/link` treo cho email thật, về ngay cho email lạ | **Đóng bằng mã** — `afterCommitTimeoutMs` (mặc định 5 s, `Promise.race`), chỉ ghi TÊN lỗi `SauCommitQuaHan`; chỉ chạy khi `status < 400`. Test: bộ gửi treo ⇒ 200 trong trần, một dòng log đúng tên, không email. Vế outbox vẫn là nợ 38 |
| H2-8 | 23514 lộ `err.message` kể cả khi là CHECK THƯỜNG (Postgres viết: tên bảng/ràng buộc); `supplierId`/`contactId` không kiểm UUID ⇒ 22P02 ⇒ 500 + log; `version` > int4 ⇒ 22003 ⇒ 500 | **Đóng bằng mã** — chỉ lộ thông điệp khi `err.routine === "exec_stmt_raise"` (RAISE của trigger), CHECK thường ⇒ thân cố định; lớp 22 ⇒ 422 câm; `uuidBody` cho hai định danh. Test dùng route giả: CHECK `tax_code` ⇒ thân cố định không chứa "violates"/tên bảng; `'abc'::uuid` ⇒ 422 câm; không dòng log |
| H2-9 | ⑴ `/rfqs/:rfqId/invitations`, `/rfqs/:rfqId/unseal` không khai `resourceId` — `PERMISSION_DENIED` mất toạ độ; ⑵ "contact ∈ supplier" kiểm SAU `createInvitation` + phát token, CSDL không ràng | **⑴ Đóng bằng mã** — hai route khai `resourceId: rfqIdParam`; quét H17 nay đếm bản ghi có `resource_id` = đúng số route khai (16/19; ba route tạo mới không có). **⑵ Đóng nửa ứng dụng** — kiểm TRƯỚC khi tạo, test: contact của NCC khác ⇒ 422, không hàng `rfq_invitations`, bộ gửi không nhận thêm; ~~FK tổ hợp — sổ nợ 46~~ **FK tổ hợp ĐÃ CÓ (PR #7, migration `036`)**, gỡ ⇒ lời mời lệch đi vào |
| H2-10 | `expect(tt).toBeTruthy()` trên bốn chuỗi hằng mang nhãn [INV-E1]; bốn `toBe(422)` không đọc lý do | **Đóng bằng test** — vòng lặp bỏ; bốn chỗ đọc thông điệp trigger/cổng (`can 2 phe duyet`, `khong duoc la mot trong hai nguoi duyet (D2)`, `khong duoc tu phe duyet (D2, D3)`, `phải ở trạng thái APPROVED; đang ở PENDING`) |
| H2-11 | ⑴ lớp canh L-5 chỉ quét TRONG khối route — helper ở đầu file đi lọt; ⑵ `const rp = requirePermission` qua mặt regex; ⑶ quét H17 không chứng minh mã quyền ĐÚNG | **⑴ Đóng bằng test** — quét cả phần đầu `guest.ts` (và nhân tiện sửa lỗi CRLF làm CI Windows đỏ ở `f40803f`). ~~**⑵⑶ MỞ — sổ nợ 47**~~ **⑵⑶ ĐÓNG cùng ngày, PR #6:** lớp canh cấm cả ĐỊNH DANH (bí danh bị bắt); vòng quét "mỗi route ghi × mỗi mã quyền đơn lẻ" — "mọi quyền trừ một" bất khả thi vì D3/033 cấm gom quyền, phép đo đổi chiều |
| H2-12 | `resolveSessionActor` (đường gói) không xét `users.status`; đình chỉ không thu hồi phiên | ~~**MỞ — sổ nợ 48** (bộ test identity bật/tắt `SUSPENDED` trên cùng phiên; sửa test trước khi thêm trigger)~~ **ĐÓNG cùng ngày, PR #6** — migration `034` (đình chỉ ⇒ thu hồi phiên trong cùng giao dịch) + `resolveSessionActor` nối `users.status`; đột biến gỡ trigger ⇒ phiên sống nguyên. Không test nào cần sửa — dự đoán trong sổ nợ sai |

**Kiểm chứng vòng sửa 10.7 của reviewer, chép lại cho đúng:** M-3, M-6, M-7 (đường lỗi), L-1 (tầng
HTTP), L-3, L-7, L-8 — *đóng đúng*; M-4 *đóng nhưng khai rộng hơn cơ chế* (H2-5); M-5/031 *phần
"CSDL còn giữ" là SAI* (H2-1). Reviewer cũng rà 20 route ghi: mọi định danh bị đổi trạng thái đọc
từ ĐƯỜNG DẪN; `breakGlass` qua HTTP luôn 422 vì thiếu nhân chứng — đã ghi vào §4 của D4 thay vì để
route trông như đã hỗ trợ. **Ba điểm reviewer không kết luận được** vì không chạy được mã: ⑴ cây có
biên dịch không (có — T0 sạch, nhưng CI Windows của `f40803f` đỏ vì CRLF ở test L-5, sửa trong vòng
này); ⑵ Node nối `Origin` trùng lặp bằng `, ` (chưa đo; fail-closed theo cả hai cách đọc); ⑶ rollback
ở nhánh 422 của `/rfqs/:rfqId/invitations` — nay không còn cần rollback vì kiểm TRƯỚC khi tạo, và có
test "không để lại gì".

---

# S1.11 — lượt review thứ BA (tiến trình `api` chạy thật), 2026-09-06

## Bảng

| Hạng mục | Phạm vi | Commit được review | Môi trường đo | Phát hiện | Đóng ở commit |
|---|---|---|---|---|---|
| **S1.11** (ADR-021) | migration `037`, `packages/db/src/vai-tro.ts` + `pool.ts`, `test-support/postgres.ts` (poolAs dùng chung), `apps/api/src/cau-hinh.ts`, `composition.ts`, `main.ts`, `adapters/totp-local-dev.ts`, `adapters/hop-thu-dev.ts`, `.env.example` | cây chưa commit của nhánh `s1.11-tien-trinh-api` (trước lượt sửa) | Review tĩnh; reviewer không có shell — đọc thẳng tệp, không xem được diff | **0 CRITICAL, 0 HIGH sau sửa — lúc review: 1 HIGH, 2 MEDIUM, 3 LOW** | commit S1.11 (cùng PR) |

## Một HIGH, hai MEDIUM, ba LOW — và cái gì được làm với từng cái

| Mã | Tóm tắt phát hiện | Trạng thái sau vòng sửa |
|---|---|---|
| H3-1 | **HIGH.** Lớp `SET ROLE` chỉ kiểm `current_user`, không kiểm `session_user`: URL superuser / BYPASSRLS / role thành viên cả `app_unseal` đi qua mọi phép kiểm (superuser `SET ROLE` sang bất kỳ role nào); một `RESET ROLE` (bug, SQL injection) trả lại toàn quyền; đồng thời F9 của `rbac.ts` (đọc `CURRENT_USER`) bị làm mù | **Đóng bằng mã, hai lớp.** ⑴ THUỘC TÍNH: `khangDinhPhienDangNhapUngDung(client, vai)` (`@trustprocure/db`) đọc `session_user` — từ chối SUPERUSER, BYPASSRLS, CREATEROLE, và thành viên của vai ứng dụng KHÁC; `composition.batDau()` gọi cho cả hai pool TRƯỚC khi mở cổng. ⑵ TÊN: `cau-hinh.ts` đòi URL đăng nhập bằng đúng `app_api_login` (tên duy nhất CAP_HOP_LE của hardening giữ membership). Test: superuser đã `SET ROLE app_api` ⇒ ném nêu SUPERUSER; `GRANT app_unseal TO app_api_login` ⇒ ném; BYPASSRLS ⇒ ném; qua composition: `ALTER ROLE app_api_login SUPERUSER` ⇒ `batDau()` ném, không cổng nào nghe. F9 nhận một khối ghi rõ giới hạn (nó chứng minh danh tính SAU SET ROLE; danh tính phiên do composition chứng minh — không đọc `session_user` ở F9 vì `poolAs` cố ý đăng nhập bằng superuser). ADR-021 §3 ghi thêm hệ quả `RESET ROLE` |
| H3-2 | **MEDIUM.** Hộp thư dev (ghi token + OTP dạng rõ ra đĩa) chạy được ở `NODE_ENV=production`: hàng rào duy nhất là `TRUSTPROCURE_KEY_ADAPTER=local-dev`, mà `cau-hinh.ts` BẮT BUỘC đúng giá trị ấy — tức mọi cấu hình khởi động được đều mở cửa; lời khai ở đầu `hop-thu-dev.ts` rộng hơn cơ chế | **Đóng bằng mã** — `assertLocalDevAllowed` (crypto-keys): `local-dev` + `NODE_ENV ∈ {production, prod}` là MÂU THUẪN ⇒ ném, trừ khi có `TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS=1` (đường cuối, đã có). Test cũ *"lời khai DƯƠNG thắng mọi NODE_ENV"* gạch và thay bằng hai ca: thắng mọi giá trị KHÔNG phải production (staging/live/producthunt/development); production ⇒ chặn, thêm cờ ⇒ qua. Áp cho cả bốn adapter local-dev; `hop-thu-dev.test.ts` đo trực tiếp. Lời khai ở đầu file sửa cho khớp cơ chế |
| H3-3 | **MEDIUM.** `.env.example` mặc định `./.hop-thu-dev` (tương đối, trong cây repo), không có trong `.gitignore` ⇒ credential dạng rõ đi vào `git add -A`; `mkdirSync(mode)` không siết thư mục có sẵn | **Đóng bằng mã** — `cau-hinh.ts` đòi `TRUSTPROCURE_DEV_MAILBOX_DIR` là đường dẫn TUYỆT ĐỐI; `taoHopThuDev` `chmodSync(0o700)` sau mkdir (POSIX); `.hop-thu-dev/` vào `.gitignore` làm lớp hai; `.env.example` đổi ví dụ. Test: đường tương đối ⇒ ném; thư mục có sẵn 0755 ⇒ 0700 (POSIX, bỏ qua trên Windows và nói rõ) |
| H3-4 | **LOW.** `la_duong_ung_dung` là điểm đơn vô hiệu hoá hai kiểm soát nhưng hardening không canh (khác khuôn R3); GRANT cho `app_unseal` thừa; role thứ ba nhận 42501 từ trong trigger | **Đóng bằng mã** — hai dòng mới trong `hardening.always.sql` (thân đã chuẩn hoá + `provolatile`/`prosecdef`/`proconfig`/kiểu; ACL: PUBLIC không EXECUTE, app_api có), tiền điều kiện "hàm đã tồn tại" (lượt hardening trước 037 trên cụm mới không được dựng hàm — sẽ làm `CREATE FUNCTION` của 037 vỡ); test đồng bộ thân 037 ↔ hardening ↔ hậu điều kiện, và test trôi (thay thân + GRANT PUBLIC ⇒ `migrate()` khôi phục). GRANT `app_unseal` bỏ; hệ quả với role thứ ba ghi ở 037 |
| H3-5 | **LOW.** `taoTienTrinhApi(ch)` nằm ngoài `try` ở `main.ts`: lỗi ném đồng bộ (createPool, mkdir, KeyError) thành unhandled rejection kèm stack — trái quy tắc "không stack" file tự khai | **Đóng bằng mã** — vào cùng `try` với `batDau()`. Test tiến trình con: `?sslmode=disable` trong URL ⇒ mã thoát 1, stderr nêu `sslmode`, không dòng `at `, không URL, không mật khẩu |
| H3-6 | **LOW.** Lời khai ⑵ ở đầu `composition.int.test.ts` ("route giả đọc current_user") không có test tương ứng; bộ dò rò ra stderr bỏ qua giá trị < 12 ký tự nên mật khẩu `mk-api` không bị bắt; không ca nào đo URL superuser bị từ chối | **Đóng bằng test** — lời khai sửa (vế `current_user` đo ở `vai-tro.int.test.ts`); `khongRo()` tách mật khẩu khỏi URL và kiểm riêng không ngưỡng, kiểm cả URL nguyên vẹn; ca URL superuser thêm cùng H3-1 |

**Ghi chú của reviewer, giữ lại để lượt sau khỏi tìm lại:** `SET ROLE` + `SELECT current_user` chạy tuần
tự trên cùng client nên không có race; `SET ROLE ${vai}` chỉ nhận hai tên từ danh sách đóng; vế `NOT
rolsuper` của 037 đọc thuộc tính của `current_user` sau SET ROLE nên superuser đã `SET ROLE app_api`
(đường `poolAs`) vẫn bị chặn đúng; nhãn HKDF `totp-dek/v1` ≠ `org-dek/v1` cộng AAD khác định dạng nên
kể cả khi hai biến khoá bị HOÁN ĐỔI (điều `kiemKhongTrung` không bắt), adapter TOTP không mở được
phong bì RFQ; `openTotpSecret` một thông điệp cho mọi thất bại giải mã.

---

# S1.12 — lượt review thứ TƯ (bảy khoản nợ 38–43, 49), 2026-09-07

## Bảng

| Hạng mục | Phạm vi | Commit được review | Môi trường đo | Phát hiện | Đóng ở commit |
|---|---|---|---|---|---|
| **S1.12** (ADR-022) | migration `038`–`040`, `packages/identity/src/mfa-reset.ts`, `apps/api/src/{dispatch,dia-chi,co-han,outbox-api,router,composition}.ts`, `routes/auth.ts`, `routes/buyer.ts`, bộ quét `kich-ban-41-http.int.test.ts`, `hardening.always.sql` | cây nhánh `no-38-43-49` tại `af114ae` (bảy commit nợ, trước lượt sửa) | Review tĩnh; reviewer đọc thẳng tệp và diff so với master, không chạy mã | **0 CRITICAL, 0 HIGH — 4 MEDIUM, 8 LOW; sau sửa: 0 mở, ba phần chênh thành sổ nợ 51–53** | `084b4ec` (H4-1, H4-2), `40753e2` (H4-3, H4-4, H4-5, H4-9, H4-12), `077fdec` (H4-6, H4-7, H4-8, H4-10, H4-11) |

## Bốn MEDIUM, tám LOW — và cái gì được làm với từng cái

| Mã | Tóm tắt phát hiện | Trạng thái sau vòng sửa |
|---|---|---|
| H4-1 | **MEDIUM.** 040 cưỡng chế "hai người, hai phiên, danh tính theo phiên" nhưng KHÔNG cưỡng chế "hai người CÓ `user.mfa_reset`" — vế ấy chỉ ở `requirePermission`, tức tầng mà mô hình "app_api bị chiếm" giả định là mất. Với hai phiên BUYER sống bất kỳ (app_api có `SELECT ON sessions`), ba câu SQL tự dựng yêu cầu, phê duyệt, DELETE và trigger xoá cho qua; lời khai 040:143 và ADR-022 §3 không đứng | **Đóng bằng mã.** Trigger `mfa_reset_kiem_quyen` (040): BEFORE INSERT cho `requested_by`, BEFORE UPDATE khi `approved_by` được đặt, đọc `user_roles ⋈ role_permissions` như 033, vô điều kiện, `check_violation` nêu "H4-1". Test `mfa-reset.int.test.ts`: app_api với hai phiên BUYER ⇒ 23514 ở INSERT lẫn UPDATE; ĐỘT BIẾN gỡ hai trigger ⇒ đi lọt tới tận DELETE hồ sơ TOTP (RED thật). Lời khai 040 và ADR-022 §3 sửa, phần chênh ghi: hai phiên QUẢN LÝ sống + app_api bị chiếm vẫn làm được |
| H4-2 | **MEDIUM.** Yêu cầu PENDING hết hạn không bao giờ rời PENDING; chỉ mục riêng phần "một yêu cầu đang chờ" + không có đường huỷ ⇒ đường về của người ấy khoá VĨNH VIỄN sau 24 giờ, và một PM ác ý làm được cho bất kỳ ai không cần ai duyệt | **Đóng bằng mã.** `requestMfaReset` dọn yêu cầu đang chờ đã hết hạn TRƯỚC khi tạo (PENDING → CANCELLED, sổ `MFA_RESET_EXPIRED`); `cancelMfaReset` + route `POST /mfa-resets/:requestId/cancel` (sổ `MFA_RESET_CANCELLED`). Test: hết hạn ⇒ yêu cầu mới tạo được, cũ thành CANCELLED; huỷ rồi duyệt ⇒ `MfaResetError`; BUYER huỷ ⇒ 403; qua HTTP ở `buyer.int.test.ts`; bộ quét gọi route mới |
| H4-3 | **MEDIUM.** `outbox_jobs.payload = {email}` vi phạm hợp đồng payload của chính gói outbox (`enqueue.ts` cấm `email`); bảng chỉ lớn lên, app_api không xoá/sửa được ⇒ PII do người gọi VÔ DANH chọn, lưu vĩnh viễn, không kiểm dạng | **Đóng bằng mã, hai lớp.** Migration `041`: trigger BEFORE UPDATE đưa payload của `LOGIN_LINK_SEND` về `{}` khi job kết thúc (DONE/FAILED) — sửa `NEW`, không nới ACL; `/auth/link` đòi hình dạng email (`laHinhDangEmail`) trước khi enqueue. Test: sau runner không hàng nào còn email (đo toàn bảng theo giá trị); sáu chuỗi sai dạng ⇒ 422 không để lại job; ĐỘT BIẾN gỡ trigger ⇒ email nằm lại. Phần chênh ghi ở 041 và ADR-022 §1 (email sống tới khi job xong; log Postgres nếu ghi tham số bind) |
| H4-4 | **MEDIUM.** Bucket theo địa chỉ NGUYÊN VẸN: IPv6 cho kẻ tấn công 2^64 bucket miễn phí (trần 10/30 vô nghĩa); chiều ngược, một NAT IPv4 văn phòng chạm 10 link/15 phút ⇒ 429 cho cả tổ chức | **Đóng bằng mã.** `khoaNguoiGoi` (`dia-chi.ts`): IPv6 gom về /64 (mọi cách viết, đuôi IPv4, vùng `%`); IPv4 giữ nguyên; trần `/auth/link` 10 → 30 (trần chống lạm dụng hộp thư vẫn là 5/15 phút theo người dùng). Test đơn vị cho khoá; `auth.int.test.ts`: 30 địa chỉ KHÁC NHAU cùng /64 rồi lần 31 ⇒ 429, /64 khác ⇒ 200. Trần toàn tổ chức chưa có — **sổ nợ 52** |
| H4-5 | **LOW.** 429 là oracle "tổ chức có tồn tại" (tổ chức thật ⇒ 429 sau N, tổ chức lạ ⇒ 200 mãi) — trái lời khai ở dispatcher; tổ chức lạ tốn hai giao dịch lỗi mỗi lời gọi mà không bị đếm; `Retry-After` luôn 900 | **Đóng bằng lời khai đúng** (dispatch.ts, ADR-022 §2): oracle chấp nhận vì `orgId` UUIDv4 không vét cạn được; `Retry-After` cố ý là cả cửa sổ (không lộ mốc bucket). Đếm tổ chức lạ cần bucket ngoài CSDL — **sổ nợ 52** |
| H4-6 | **LOW.** 039 thiếu CẬN TRÊN cho `last_used_counter` (bộ đếm tương lai thoả mãn vĩnh viễn) — đúng bài học (2) `assertFreshMfa` đã viết; lời khai đầu 039 bỏ qua rằng app_api có `UPDATE (last_used_counter)` nên HAI câu vòng qua được | **Đóng bằng mã + lời khai.** `≤ bước hiện tại + 3` thêm vào 039; test: +4 bước và +10⁶ bước ⇒ 23514, +3 qua. Phần chênh (hai câu UPDATE rồi INSERT đi qua — cùng hạn chế 006 §(2)) viết ở đầu 039, ADR-022 §4, và có test ĐO ĐÚNG phần chênh ấy |
| H4-7 | **LOW.** Hardening không ghim thân ba hàm trigger mới; máy trạng thái 040 không đi qua `la_duong_ung_dung` nên "điểm đơn" không phủ nó; chú thích hardening nói "hai trigger" — nay bốn | **Một phần.** Chú thích hardening sửa (bốn trigger qua vị từ; kể tên thứ chưa ghim). Ghim thân + `tgenabled` cho bốn hàm (039, 040 ×2, 041) và máy trạng thái 040 — **sổ nợ 51** |
| H4-8 | **LOW.** `rfqKeyWrapper.wrap` (openRfq) là lời gọi KMS TRONG giao dịch thứ ba, không có trần (ADR nói "hai"); đường quá hạn ở `/auth/redeem` không `fill(0)` bí mật | **Đóng bằng mã.** `boiTranKms` bọc cả `rfqKeyWrapper` (test: treo ⇒ `KmsQuaHan`); `/auth/redeem` `fill(0)` trong `finally`; ADR-022 §1 và `co-han.ts` sửa "hai" → "ba" |
| H4-9 | **LOW.** `TRUSTPROCURE_TRUSTED_PROXIES` nhận `0.0.0.0/0`/`::/0` ⇒ mọi socket là proxy ⇒ XFF do khách tự đặt được tin; proxy ghi `ip:port` ⇒ mọi khách rơi về socket ⇒ cả tổ chức chung một bucket, im lặng | **Đóng bằng mã.** Tiền tố rộng hơn /8 (v4) hay /7 (v6 — `fc00::/7` ULA vẫn hợp lệ) ⇒ ném lúc khởi động (`cau-hinh.test.ts` đo qua `docCauHinh`); `chuanHoaDiaChi` bỏ cổng ở `ip:port` và `[v6]:port`, không cắt IPv6 trần. Đếm/cảnh báo header hỏng: không làm (không mang giá trị nào đáng log hơn số 0) |
| H4-10 | **LOW.** At-least-once: `send` xong rồi `CAU_XONG` chạm 0 hàng ⇒ email đã đi mang token bị rollback (link chết) rồi gửi lần hai; `send` không có trần riêng — với bộ gửi thật, mười job treo là cạn pool `api` | **Một phần.** `send` bọc `coHan` 5 s (`BoGuiQuaHan`, ngắn hơn lease 60 s). Tách gửi khỏi giao dịch của job / pool riêng cho runner — **sổ nợ 53**, làm khi có bộ gửi thật; phần chênh ghi ở ADR-022 §1 |
| H4-11 | **LOW.** Bộ dò base64 không nhận base64url (`-`,`_`) — chính dạng token/cookie của dự án; không đệ quy quá một tầng; không hex | **Đóng bằng test.** Bộ dò giải mã base64, base64url, hex, sâu hai tầng; đối chứng dương cho base64url, hex, và base64-trong-base64url. §4 của A2 (`danh-gia.ts`) sửa cho khớp |
| H4-12 | **LOW.** `docCookie` dùng `ten in ra` trên object thường ⇒ `toString`/`constructor`/`__proto__` bị coi là "trùng"; `req.cookies["constructor"]` trả về hàm | **Đóng bằng mã.** `Object.create(null)` + `Object.hasOwn`; test: ba tên ấy đọc đúng, tên không có ⇒ `undefined` |

**Cùng lượt, không phải phát hiện của reviewer:** tầng tích hợp đầy đủ (`pnpm test:int`) bắt hai
phép đo ghim ở `mfa.int.test.ts` đỏ vì `GRANT DELETE` mới của 040 (một ca "permission denied" nay là
"trigger 040", một dòng ACL mới) — sửa ở `c5cd561`, gạch tại chỗ.

**Ghi chú của reviewer, giữ lại để lượt sau khỏi tìm lại:** bucket 39 đếm trong giao dịch riêng nên
sống qua rollback; địa chỉ rỗng vào một bucket chung; XFF chỉ đọc khi socket ∈ CIDR và `BlockList`
tự khớp IPv4-mapped; savepoint `/auth/link` trả cùng thân và không nudge cho tổ chức lạ; handler
outbox không ghi email/token ra `console`; nudge qua `setImmediate` chạy SAU `res.end()`; hai runner
cùng tổ chức an toàn nhờ `FOR UPDATE SKIP LOCKED` + lease; 039 kiểm đúng `user_id`/`org_id` của NEW
nên hồ sơ người khác cùng tổ chức không dùng được; DELETE 040 chạm tối đa một hàng (UNIQUE org, user,
kind) và `consumed_at` đặt trong cùng giao dịch nên không dùng lại được; FK `(org_id, approved_by)`
ép người duyệt cùng tổ chức; `__Host-` chặn subdomain anh em ném cookie nên "bỏ tên lặp" không mở
DoS thực tế; cookie khách `Path=/` không được đọc ở route người mua.

---

# S1.13 — lượt review thứ NĂM (ba khoản nợ 51–53), 2026-09-07

## Bảng

| Hạng mục | Phạm vi | Commit được review | Môi trường đo | Phát hiện | Đóng ở commit |
|---|---|---|---|---|---|
| **S1.13** (ADR-023) | `packages/outbox/src/{runner,index}.ts`, `apps/api/src/{outbox-api,bucket-bo-nho,dispatch,route-types,co-han}.ts`, `apps/api/src/routes/{auth,anon}.ts`, `hardening.always.sql` khối [S1.13], `db/migrations/{039,040,041}` | cây nhánh `no-51-53` tại `be200c3` (ba commit nợ, trước lượt sửa) | Review tĩnh; reviewer đọc thẳng tệp, không chạy mã, không CSDL | **0 CRITICAL, 1 HIGH, 1 MEDIUM, 4 LOW; sau sửa: 0 mở, hai phần chênh thành sổ nợ 54–55** | `f346788` (H5-1, H5-3, H5-4), commit H5-2/H5-5 ngay sau, docs (H5-6) |

## Một HIGH, một MEDIUM, bốn LOW — và cái gì được làm với từng cái

| Mã | Tóm tắt phát hiện | Trạng thái sau vòng sửa |
|---|---|---|
| H5-1 | **HIGH.** Bucket TOÀN TỔ CHỨC của `/auth/link` được cộng cả khi người gọi đã vượt trần riêng, và vượt thì 429 ⇒ MỘT địa chỉ, 300 lời gọi/15 phút (30 tới handler, 270 là 429 rẻ) khoá cửa xin link của cả tổ chức, lặp mãi; `orgId` không phải bí mật (cookie của mọi NCC từng được mời). Lời khai "bịt đường xoay /64" giả định một cái giá mà mã không đòi | **Đóng bằng mã.** Bucket tổ chức chỉ cộng khi người gọi CHƯA vượt trần riêng (một địa chỉ góp tối đa `callerLimit`); vượt `orgLimit` ⇒ LÀM CHẬM `treQuaTranMs` (mặc định 2 s) rồi vẫn xử lý — không 429 (ADR-015 §5); log một dòng chỉ mang route + requestId. Test RED thật: một địa chỉ 300 lời gọi ⇒ địa chỉ sạch sau đó 200 và NHANH, bucket tổ chức = 31; 300 địa chỉ khác /64 ⇒ lần 301 vẫn 200 nhưng chậm ≥ trễ. Lời khai ở `auth.ts`, `route-types.ts`, ADR-023 §2 gạch tại chỗ. Trần "chi phí theo số người dùng" và kênh cảnh báo vận hành: chưa có kênh, ghi ở ADR-023 |
| H5-2 | **MEDIUM.** Tiền điều kiện "hàm đã tồn tại" của năm mục hardening ⇒ `DROP FUNCTION … CASCADE` (xoá cả hàm lẫn trigger) làm mục im lặng bỏ qua ở cả lượt sửa lẫn phán xét — khác `la_duong_ung_dung` (caller ném), các hàm này LÀ trigger, mất chúng là mất phép kiểm (041 ⇒ email nằm lại; 039 ⇒ phiên đã-MFA không cần TOTP; 040 ⇒ `app_api` xoá hồ sơ TOTP của bất kỳ ai) mà `migrate()` xanh mãi. Cùng ca R4 đã đo ở vòng fix 5 | **Đóng bằng mã.** Tiền điều kiện đổi sang "migration nguồn đã áp dụng": bảng `mfa_reset_requests` tồn tại cho ba mục 040 (kể cả `mfa_credentials_xoa_can_yeu_cau`), dòng `schema_migrations` cho 013/037/039/041. Hàm mất được DỰNG LẠI. Test trôi thêm hai ca `DROP … CASCADE` — chạy trên bản hardening cũ: hai hàm KHÔNG trở lại (RED thật); bản mới: trở lại kèm trigger `A`. Lời khai đầu khối sửa |
| H5-3 | **LOW.** Lời khai "oracle H4-5 đóng" sai: bucket bộ nhớ (tổ chức lạ) và bucket CSDL (tổ chức thật) là hai bộ đếm rời ⇒ mồi N lần vào UUID giả rồi gửi UUID ứng viên: 429 = lạ, 200 = thật — MỘT lời gọi thay vì N | **Đóng bằng lời khai đúng** (dispatch.ts, ADR-023 §2, STATE): chấp nhận với cùng lý do H4-5 (UUIDv4); đóng thật cần bảng bucket không khoá ngoại tới `organizations` — **sổ nợ 55** |
| H5-4 | **LOW.** `coHan`: `viec()` ném ĐỒNG BỘ ⇒ `Promise.race` không được dựng, đồng hồ không bị dọn, `het` reject không ai bắt sau `ms` ⇒ `unhandledRejection` giết tiến trình `api`; nợ 53 mở call site đầu tiên cho một adapter gửi do bên thứ ba cài | **Đóng bằng mã.** `Promise.race([Promise.resolve().then(viec), het])`. Test: adapter ném đồng bộ ⇒ reject đúng lỗi, chờ quá `ms`, `process.on("unhandledRejection")` không nhận gì |
| H5-5 | **LOW.** Danh sách ghim viết tay và còn thiếu cùng lớp: hai trigger danh tính của chính 040, thân 013 `kiem_danh_tinh_theo_phien`, 029 `sessions_kiem_mfa_khi_tao` và 032 `mfa_credentials_khoa_ho_so_da_xac_nhan` (bản 037) | **Đóng phần lớn bằng mã.** Ba mục hàm mới (013 thân-không-trigger, hai hàm 037 kèm trigger 029/032) và hai trigger danh tính 040 ghim vào mục `mfa_reset_kiem_quyen`; `HAM_51` của test đồng bộ mở rộng; test trôi DROP trigger danh tính ⇒ trở lại. 21 trigger của 013 và test "mọi hàm trigger có mặt trong danh sách" — **sổ nợ 54** |
| H5-6 | **LOW.** Bốn tệp mã viện dẫn "ADR-023" nhưng ADR chưa có lúc review (kế hoạch 13.4 mới hứa); hợp đồng đổi của gói chỉ sống trong docstring | **Đóng bằng tài liệu.** ADR-023 viết trong cùng PR, ghi rõ ba điều reviewer đòi: at-most-once là cố ý; token không gửi vẫn tiêu 1/5 hạn mức 15 phút của người dùng (khi SMTP hỏng người dùng bị "câm" không thông điệp — hệ quả của nợ 38); `AFTER_COMMIT_FAILED` chỉ tới `console.error` vì dự án chưa có kênh cảnh báo vận hành |

**Ghi chú của reviewer, giữ lại để lượt sau khỏi tìm lại:** việc sau commit chỉ chạy sau `withTenant`
trả về (commit + huỷ kết nối), nhánh `KetCucKhongGhiDuocError` `continue` trước đó ⇒ không còn cửa
sổ "email đã đi, token bị rollback"; hai runner song song: sau DONE không ai claim lại, A chậm–B claim
⇒ A không gửi, đúng một email; promise gửi bị BỎ chứ không HUỶ khi quá hạn — trách nhiệm adapter
(cần AbortSignal riêng); `AFTER_COMMIT_FAILED` không bao giờ vào `last_failure_reason`; unseal-worker
không có việc sau commit và cố ý giữ "gửi trong giao dịch" cho break-glass; khoá bộ nhớ không có orgId
nên xoay UUID lạ không mở trần; hai `INSERT … ON CONFLICT` cùng thứ tự ⇒ không deadlock; không đặt
được `remoteAddress = "to-chuc"` vì `taoDocDiaChi` chỉ trả IP hợp lệ hoặc socket; `pg_get_triggerdef`
ổn định PG11–16, nếu deparse đổi thì hậu điều kiện SAI ⇒ `migrate()` gãy ồn ào, không im lặng; `DROP
FUNCTION` có điều kiện chỉ chạy khi `prorettype <> trigger` nên không vỡ vì trigger phụ thuộc; 038 chỉ
đổi CHECK, trôi ở đó fail-closed.

---

# S1.14 — lượt review thứ SÁU (hai khoản nợ 54–55), 2026-09-07

## Bảng

| Hạng mục | Phạm vi | Commit được review | Môi trường đo | Phát hiện | Đóng ở commit |
|---|---|---|---|---|---|
| **S1.14** (ADR-024) | `db/migrations/042`, `packages/invitation/src/invitation.ts`, `apps/api/src/{dispatch,composition,dia-chi,cau-hinh}.ts`, `apps/api/src/routes/{auth,anon}.ts`, `db/migrations.int.test.ts` [S1.14], `hardening.always.sql` khối [S1.13/S1.14] | cây nhánh `no-54-55` tại `aeaf611` (hai commit nợ, trước lượt sửa) | Review tĩnh; reviewer đọc thẳng tệp, không chạy mã, không CSDL | **0 CRITICAL, 1 HIGH, 4 MEDIUM, 4 LOW; sau sửa: 0 mở, một phần chênh thành sổ nợ 57** | `7cfa9f8` (H6-1, H6-2, H6-5⑴, H6-9), `fdcad0e` (H6-3, H6-4, H6-6, H6-7, H6-8) |

## Một HIGH, bốn MEDIUM, bốn LOW — và cái gì được làm với từng cái

| Mã | Tóm tắt phát hiện | Trạng thái sau vòng sửa |
|---|---|---|
| H6-1 | **HIGH.** Bucket người gọi thành TOÀN CỤC ⇒ mọi ca "gộp địa chỉ" (proxy chưa khai — và không khai là MẶC ĐỊNH, CGNAT/NAT chung, địa chỉ rỗng) khoá cửa đăng nhập của CẢ NỀN TẢNG chứ không còn của một tổ chức: 31 lời gọi/15 phút từ một địa chỉ. Bán kính nổ này do chính vòng 55 tạo ra | **Đóng bằng mã.** BA bộ đếm, cả ba ở `caller_rate_limits` (không khoá ngoại, nên tổ chức thật và lạ đi cùng đường): `route\|ip` là trần TOÀN CỤC của một địa chỉ (`callerLimit × 10`), `route\|ip\|org` là trần THẬT theo người gọi — trả lại bán kính nổ theo TỔ CHỨC, `route\|to-chuc\|org` là trần toàn tổ chức (làm chậm). Cộng: địa chỉ không phân giải được ⇒ **503** + một dòng log (với bucket toàn cục, "một bucket chung" là fail-OPEN ở trục sẵn sàng); `TRUSTPROCURE_TRUSTED_PROXIES` nay **BẮT BUỘC** (danh sách CIDR hoặc `direct`) — quên không được phép trông giống một lựa chọn. Ba phép đo RED thật, gồm "chạm trần với tổ chức A xong, tổ chức B từ cùng địa chỉ vẫn 200" |
| H6-2 | **MEDIUM.** Oracle tồn tại tổ chức chưa đóng, chỉ đổi kênh: độ trễ 2 giây của trần toàn tổ chức chỉ xảy ra với tổ chức CÓ THẬT (tổ chức lạ nuốt 23503 nên không bao giờ chậm). ~301 lời gọi là đủ để dựng phép đo. ADR-024 khai phần chênh là "một giao dịch lỗi", trong khi phần chênh thật là một lệnh ngủ do chính dự án đặt | **Đóng bằng mã.** Trần toàn tổ chức rời `otp_rate_limits` sang `caller_rate_limits` với khoá `route\|to-chuc\|org` — không khoá ngoại nên tổ chức lạ cũng đếm và cũng bị làm chậm. Test: tổ chức LẠ vượt trần toàn tổ chức ⇒ chậm ≥ ngưỡng (RED thật trước H6-2). `tangBucketHanMuc` không còn người gọi ở dispatcher |
| H6-3 | **MEDIUM.** Tập "hardening có canh" rút bằng mọi lần `to_regprocedure('public.X()')` xuất hiện — kể cả trong tiền điều kiện của mục KHÁC. Cộng phép kiểm rời-nhau, test tự mời người sửa XOÁ một hàm khỏi danh sách loại trừ để xanh trở lại: đúng hình dạng cái mù mà nợ 54 tồn tại để đóng | **Đóng bằng mã.** Tiêu chí đổi sang HÌNH DẠNG của một mục ghim: phải có CÂU SỬA `CREATE OR REPLACE FUNCTION public.X() RETURNS trigger` VÀ một lần nhắc trong câu phán xét. Thêm khẳng định `HAM_51` không trôi ra ngoài tập ấy. Đo: thêm một dòng CHỈ nhắc tên vào hardening ⇒ test vẫn xanh và hàm ấy vẫn nằm ở danh sách loại trừ |
| H6-4 | **MEDIUM.** Ghim `tgenabled = 'O'` biến `migrate()` thành thứ HẠ một trigger đã được nâng lên `ENABLE ALWAYS`; và `'O'` là trạng thái `session_replication_role = 'replica'` bỏ qua — cùng hàm, cùng bất biến D, hai độ mạnh khác nhau giữa 040 (`'A'`) và 013–026 (`'O'`) | **Đóng bằng mã.** Migration `043` nâng cả 19 trigger danh tính lên `ENABLE ALWAYS`; bản ghim đổi sang `'A'` và câu sửa thêm `ALTER … ENABLE ALWAYS` sau `CREATE TRIGGER`. Test trôi đo đúng `'A'` |
| H6-5 | **MEDIUM.** `/guest/otp` truyền `remoteAddress` THÔ vào bucket CALLER (không qua `khoaNguoiGoi`) ⇒ IPv6 có 2^64 bucket; và mỗi địa chỉ mới là một hàng VĨNH VIỄN ở `otp_rate_limits`, bảng không có bộ dọn | **Đóng vế ⑴ bằng mã** (`khoaNguoiGoi` ở `anon.ts`, cùng phép chuẩn hoá dispatcher dùng). **Vế ⑵ thành sổ nợ 57** với lý do viết ra ở chính `invitation.ts`: `otp_rate_limits` bật RLS theo `org_id` nên một `DELETE` nền lọc hết, còn dọn từng tổ chức đòi biết tập tổ chức mà `app_api` không đọc được (cùng ràng buộc đã buộc runner outbox nhận `listOrganizations`) |
| H6-6 | **LOW.** 19 định nghĩa `$def$` không được đối chiếu với migration nguồn (`HAM_51` vẫn `trigger: []`), và không lớp nào đếm tập trigger của `kiem_danh_tinh_theo_phien` ⇒ trigger thứ 22 sẽ im lặng không được ghim | **Đóng bằng test.** 19 tên vào `HAM_51`; cửa sổ cắt của phép kiểm đổi từ một hằng số byte sang "tới mục KẾ TIẾP"; thêm một khẳng định chạy trên CSDL: tập trigger của hàm ấy phải bằng đúng 19 + 2 tên đã khai |
| H6-7 | **LOW.** `caller_rate_limits` nằm ngoài mọi lớp TỰ CHỮA (`VI_TU_BANG_TENANT` lọc theo `org_id`), nên `DISABLE ROW LEVEL SECURITY` hay `DROP POLICY` trên nó sống qua mọi lần `migrate()` — trong khi 042 viết "Nó vẫn bật RLS + FORCE" như một tính chất của lược đồ | **Đóng bằng mã.** Một mục hardening theo ĐỐI TƯỢNG cho bảng ấy (ENABLE + FORCE + policy khách, câu sửa qua `EXECUTE format` như mọi mục tự chữa RLS khác, và nói rõ vì sao không viết thẳng). Test trôi: `DISABLE RLS` + `DROP POLICY` ⇒ `migrate()` dựng lại cả ba |
| H6-8 | **LOW.** Bộ dọn là đường bịt DUY NHẤT của một bảng mà số hàng do người gọi vô danh quyết, nhưng nó hỏng trong im lặng: chỉ một dòng `console.error` mang tên lỗi | **Đóng bằng mã.** Mỗi lượt xoá nhiều hơn ngưỡng ồn ào ghi SỐ hàng; hai lượt hỏng LIÊN TIẾP ghi rõ "bảng chỉ lớn lên". Vẫn chỉ là log — dự án chưa có kênh cảnh báo vận hành, và câu ấy nằm ở ADR-024 |
| H6-9 | **LOW.** `rows[0]?.hits ?? 0` — mặc định FAIL-OPEN của một trần: không có hàng trả về thì lời gọi đi tiếp như chưa đếm gì | **Đóng bằng mã.** Ném `InvitationError` thay vì trả 0, ở cả `tangBucketNguoiGoi` lẫn `demVaTang` (bốn bucket OTP dùng chung nó) |

**Ghi chú của reviewer, giữ lại để lượt sau khỏi tìm lại:** miền băm `LOGIN_CALLER_TOAN_CUC` không va
được với `org_id ‖ kind` của bảng cũ (hai bảng, và `org_id` là UUID); policy DUY NHẤT đúng hơn cặp
`USING (true)` + RESTRICTIVE vì không có policy PERMISSIVE thứ hai để OR vào, và lớp tĩnh chặn mọi
`CREATE/ALTER POLICY` từ file khác trừ `AS RESTRICTIVE`; `app.guest_session_id` không phải UUID ⇒
22P02 ⇒ fail-closed; bộ dọn hai cửa sổ không bao giờ chạm bộ đếm sống (`window_start` làm tròn xuống
bội 900 s, ngưỡng là 1800 s); `clearInterval` chạy trước `pool.end()` nên `dung()` không ném; hai
giao dịch không có trạng thái nào để lệch; `GRANT DELETE` mở đúng thứ 042 khai và không có đường HTTP
nào tới một `DELETE` tuỳ ý; 19 chuỗi `pg_get_triggerdef` khớp deparse hôm nay và nếu deparse đổi thì
`migrate()` gãy ồn ào; danh sách 35 loại trừ không mâu thuẫn và không thiếu — nhưng nó là danh sách
CHƯA GHIM, trong đó có báo giá append-only, hạn nộp, danh tính khách, hai trigger ngưỡng D2 và toàn
bộ máy trạng thái mở thầu (sổ nợ 56).

---

# S1.15 — lượt review thứ BẢY (hai khoản nợ 56–57), 2026-09-07

## Bảng

| Hạng mục | Phạm vi | Commit được review | Môi trường đo | Phát hiện | Đóng ở commit |
|---|---|---|---|---|---|
| **S1.15** (ADR-025) | `db/migrations/044`, `045`, khối `[S1.15 / sổ nợ 56]` + dòng đầu của `NGOAI_LE_HINH_DANG` + mục policy dọn ở `hardening.always.sql`, `packages/invitation/src/invitation.ts`, `apps/api/src/composition.ts`, `db/migration-shape.test.ts`, `db/rls-coverage.int.test.ts`, `db/migrations.int.test.ts` | cây nhánh `no-56-57` tại `3d047bd` (hai commit nợ, trước lượt sửa) | Review tĩnh + ba phép đo chạy thật trên PostgreSQL 16.15 (EXPLAIN của câu dọn; hai đột biến trên file giả và trên migration tạm) | **0 CRITICAL, 0 HIGH, 3 MEDIUM, 3 LOW; sau sửa: 0 mở, một phần chênh thành sổ nợ 58** | `630613e` (H7-1..H7-6) |

## Ba MEDIUM, ba LOW — và cái gì được làm với từng cái

| Mã | Tóm tắt phát hiện | Trạng thái sau vòng sửa |
|---|---|---|
| H7-1 | **MEDIUM.** H6-6 đóng cái mù "trigger thứ 22 không ai khai" cho ĐÚNG MỘT hàm (`kiem_danh_tinh_theo_phien`). Cùng cái mù còn nguyên cho 42 hàm còn lại: mục ghim chỉ đòi các trigger ĐÃ KHAI phải tồn tại, nên gắn thêm một trigger cho một hàm đã ghim (vd. `bid_chi_ghi_them` lên một bảng mới) đi qua mọi lớp trong im lặng — và trigger ấy KHÔNG có định nghĩa `$def$` nào canh | **Đóng bằng test.** So BẰNG NHAU giữa "trigger đang chạy một hàm đã ghim" (đọc từ CSDL) và "trigger được khai trong khối ghim", cộng một khẳng định không tên nào khai ở hai mục. So theo TÊN chứ không theo *(hàm → tập trigger)*: hai trigger `mfa_reset_requests_kiem_danh_tinh*` chạy `kiem_danh_tinh_theo_phien` nhưng được ghim ở mục `mfa_reset_kiem_quyen`, và khoá theo hàm báo đỏ đúng cặp ấy vì một lý do sai (đã đo, và đó là lý do bản đầu của phép kiểm này bị viết lại). **RED thật:** migration tạm gắn `bid_chi_ghi_them` vào `organizations` ⇒ đỏ, nêu tên trigger |
| H7-3 | ~~**MEDIUM.** Chỉ số `otp_rate_limits_window_idx` mà chính `044` thêm KHÔNG BAO GIỜ được đọc, trong khi nó phải được GHI ở mọi lời gọi OTP — đường ghi nóng nhất của hệ~~ **[S1.16 / sổ nợ 58] PHÁT HIỆN NÀY SAI.** Phép đo có thật, chế độ thì không đại diện (95% hàng quá sàn — Seq Scan là tối ưu thật ở đó). Ở 1%, `BitmapOr` dùng CẢ khoá chính LẪN chỉ số ấy: 1,07 ms so với 37,96 ms. `046` dựng lại chỉ số, và `db/otp-don-ke-hoach.int.test.ts` canh kế hoạch kèm đối chứng dương | ~~**Đóng bằng mã: gỡ chỉ số.**~~ Nguyên văn phép đo cũ giữ lại vì nó vẫn đúng TRONG chế độ của nó: `EXPLAIN (ANALYZE, BUFFERS)` của đúng câu bộ dọn, 20 000 hàng (19 000 cũ), dưới `app_api` chưa gắn tổ chức: `Seq Scan`, 18 999 hàng qua bộ lọc, **9,5 ms**, `shared hit=19246`. Vế lọc là OR của HAI policy trên HAI cột nên không chỉ số nào phục vụ được — bộ lập lịch chọn Seq Scan **kể cả khi ước lượng của nó là `rows=1`**, tức nó không có phương án nào khác. Giá phải trả ghi bằng số ngay trong `044`: ~0,5 µs/hàng ⇒ 5 triệu hàng ≈ 2,4 giây mỗi năm phút (**sổ nợ 58**, kèm đường thoát) |
| H7-5 | **MEDIUM.** `NGOAI_LE_LAC_CHO` khoá (file, bảng, policy) nhưng KHÔNG khoá LỆNH, nên một `ALTER POLICY otp_rate_limits_don_cua_so_cu … USING (true)` viết ngay trong `044` cũng được dòng ngoại lệ ấy tha — đúng lớp lỗ mà vòng fix 3 đã đo được ở `NGOAI_LE_HINH_DANG` | **Đóng bằng mã.** Cửa chỉ mở cho `CREATE`, khớp với miễn trừ `AS RESTRICTIVE` ngay cạnh nó (`ALTER POLICY` không bao giờ được tha, vì sửa một policy đang có thì NỚI được). **RED thật** trên file giả: gỡ vế `CREATE` ⇒ test mới đỏ |
| H7-2 | **LOW.** Vòng kiểm "mỗi loại trừ phải có lý do" chạy 0 lần sau khi danh sách về RỖNG, tức MÃ CHẾT: bỏ nó đi không test nào đỏ | **Đóng bằng test.** Đo THẲNG quy tắc ấy trên hai bản đồ giả (một lý do thật ⇒ qua, một lý do rỗng ruột ⇒ bị bắt), cùng khuôn `[I2]` đã dùng khi `NGOAI_LE_HINH_DANG` còn rỗng |
| H7-4 | **LOW.** Lượt dọn ĐẦU TIÊN sau `044` xoá toàn bộ tồn đọng lịch sử của `otp_rate_limits` (bảng chưa từng có ai xoá), nên nó gần như chắc chắn vượt ngưỡng "ồn ào" và ghi một dòng. Dòng ấy ĐÚNG nhưng KHÔNG phải "tín hiệu tải bất thường" như câu ngay trên nó nói | **Đóng bằng ghi chú tại chỗ** ở `composition.ts`, cạnh đúng chỗ người trực đêm sẽ tìm |
| H7-6 | **LOW.** Bộ dọn giữ một kết nối của pool YÊU CẦU trong suốt một câu quét toàn bảng không có trần | **Đóng bằng mã.** Một giao dịch với `SET LOCAL statement_timeout = 60s` — một lượt dọn bệnh lý hỏng ỒN ÀO và bộ đếm "hỏng liên tiếp" của composition nhìn thấy, thay vì giữ kết nối vô hạn định. `SET LOCAL` chứ không `SET`: kết nối trả về pool không mang theo trạng thái. Trần là một CHẶN TRÊN phòng thủ, không phải một ngưỡng hiệu năng — nó rộng gấp ~6 000 lần phép đo, và cố ý thế |

**Ghi chú của reviewer, giữ lại để lượt sau khỏi tìm lại:** policy dọn là PERMISSIVE nên nó OR vào
policy cách ly — với kết nối ĐÃ gắn tổ chức, vế `IS NULL` sai nên nó không cho thêm một hàng nào, và
đó là lý do một đột biến gỡ vế ấy CHỈ đo được bằng câu `DELETE` TRẦN (bản đầu của phép đo viết
`DELETE … WHERE` và không đo được gì — mệnh đề `WHERE` kéo theo policy SELECT, và policy cách ly giấu
hàng của tổ chức kia đi); policy `otp_rate_limits_khach` là RESTRICTIVE `guest_session_id IS NULL`
nên kết nối nền đi qua nó; `rowCount` của câu trần là một con số XUYÊN TỔ CHỨC, chỉ đọc được bởi
chính tiến trình; `045` không phải thứ làm trạng thái cuối đúng (đã đo: bỏ một câu `ALTER` thì mục
ghim vẫn kéo trigger về `'A'`) mà là hình dạng của lần triển khai; hai `CONSTRAINT TRIGGER` làm một
phép kiểm cũ đỏ vì một lý do SAI (nó tìm đúng chuỗi `CREATE TRIGGER `) — đã sửa; ~1 000 dòng thân
plpgsql chép lại trong hardening là một nguồn sự thật thứ hai, chấp nhận được ĐÚNG VÌ có hai lớp canh
bản chép (đồng bộ thân, và "migration cuối cùng"); ghim thân KHÔNG bảo vệ trước một migration đánh số
mới cố ý làm hàm yếu đi — nó chỉ bảo vệ trước TRÔI SAU TRIỂN KHAI.

**Một điều KHÔNG phải phát hiện của lượt này nhưng được đo trong lượt ấy, ghi ra vì nó là một flake
thật:** `pnpm evidence` đỏ đúng một ca — `[review H5-1] … lần 201: expected 200 to be 429`
(`auth.int.test.ts:411`), chạy lại riêng tệp ấy 26/26 xanh, vòng 300 lời gọi tốn 4,6 s. Cửa sổ hạn
mức là RỜI RẠC và làm tròn theo EPOCH, nên một vòng đếm vắt qua ranh giới thấy 200 ở đúng chỗ nó chờ
429. Không phải hồi quy của vòng này (ba bộ đếm của `/auth/*` ở `caller_rate_limits`). Sửa ở
`13b418f`: `beforeEach` của hai khối có vòng đếm không bắt đầu khi cửa sổ còn dưới 45 giây.

---

# S1.16 — lượt review thứ TÁM (khoản nợ 58), 2026-09-07

## Bảng

| Hạng mục | Phạm vi | Commit được review | Môi trường đo | Phát hiện | Đóng ở commit |
|---|---|---|---|---|---|
| **S1.16** | `db/migrations/046` (một câu `CREATE INDEX`), `db/otp-don-ke-hoach.int.test.ts`, và bốn chỗ gạch lời khai sai của H7-3 | `ac7cc58` | Review tĩnh; hai phép đo kế hoạch đã chạy thật ở commit ấy | **0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW** | `fbf5cc9` |

**Bề mặt của vòng này nhỏ hơn mọi vòng trước — một chỉ số không-duy-nhất — nên bảng phát hiện ngắn là
KẾT QUẢ, không phải một lượt review qua loa.** Bốn câu hỏi đối kháng đã hỏi và trả lời:

- **Chỉ số này có tạo oracle không?** Không. Oracle của lớp chỉ số là oracle của tính DUY NHẤT: một
  `duplicate key` nói cho người gọi biết hàng của TỔ CHỨC KHÁC tồn tại — đó là thứ
  `db/unique-oracle.int.test.ts` quét, và nó đọc `pg_index` với `indisunique`. Chỉ số này không duy
  nhất, không sinh lỗi nào, nên nó nằm ngoài lớp ấy một cách ĐÚNG ĐẮN chứ không phải vì lọt lưới.
- **Nó có mở một kênh THỜI GIAN không?** Đường duy nhất chạm `otp_rate_limits` mà người gọi đo được
  độ trễ là `demVaTang` (`INSERT … ON CONFLICT`), và đường ấy đi qua KHOÁ CHÍNH — giải quyết xung đột
  chỉ dùng chỉ số duy nhất. Bộ dọn thì chạy nền. Không có truy vấn nào vừa quan sát được vừa đổi kế
  hoạch vì chỉ số này.
- **Nó có đổi thứ tự áp vế RLS không?** Không. `window_start < <mốc>` là phép so sánh btree
  **leakproof**, nên việc nó được đẩy xuống thành index condition không đưa một hàng nào ra ngoài vế
  RLS — vế ấy vẫn được áp trước mọi vế người dùng không-leakproof, đúng khuôn PostgreSQL.
- **`046` có gãy trên cụm đã có chỉ số trùng tên không?** Có, và gãy ỒN ÀO là hành vi ĐÚNG ở đây.
  Cụm duy nhất có thể ở trạng thái ấy là một CSDL test dựng từ nhánh `no-56-57` trong khoảng giữa
  `044` và H7-3 — không có cụm thật nào. `IF NOT EXISTS` sẽ nuốt luôn ca "một chỉ số KHÁC mang cùng
  tên", nên nó không được dùng.

## Một LOW

| Mã | Tóm tắt phát hiện | Trạng thái sau vòng sửa |
|---|---|---|
| H8-1 | **LOW.** Test kế hoạch khẳng định `BitmapOr` — tức nó ghim HÌNH DẠNG NÚT, không phải tính chất. Một bản PostgreSQL sau phục vụ đúng vế ấy bằng Index Scan sẽ làm test đỏ trong khi kết quả vẫn đúng: cùng lớp lỗi mà chính vòng này vừa sửa ở H7-3 (ghim một chi tiết của MỘT chế độ rồi phát biểu cho mọi chế độ) | **Đóng bằng test.** Bỏ khẳng định `BitmapOr`; giữ hai vế nói đúng tính chất — kế hoạch có nhắc `otp_rate_limits_window_idx`, và không có `Seq Scan on otp_rate_limits`. Đối chứng dương (gỡ chỉ số ⇒ Seq Scan) giữ nguyên vì nó là thứ chứng minh hai vế kia có răng |

**Ghi chú của reviewer:** một chốt chống rỗng ruột trong chính test này suýt tự làm mù mình —
`rows=2000` là TIỀN TỐ của `rows=200000`, nên khẳng định "khớp đúng 1%" sẽ xanh nhờ chính con số nó
phải phân biệt với; đã sửa thành `rows=2000\b` trong cùng commit `ac7cc58`. Giá ghi của chỉ số là
một lần chèn btree cho mỗi HÀNG MỚI; đường `ON CONFLICT DO UPDATE` chỉ đổi `hits`, mà `hits` không
nằm trong chỉ số nào nên cập nhật ấy vẫn HOT. Bộ dọn của `caller_rate_limits` KHÔNG cùng bài toán:
bảng ấy không có policy tenant để OR vào, nên câu dọn của nó có `WHERE` và dùng Index Scan thẳng
(0,94 ms trên cùng fixture 200 000 hàng) — sự bất đối xứng giữa hai bộ dọn là có lý do, không phải
một lần quên.
---

# S1.17 — lượt review thứ CHÍN (artefact neo ngoài, khoản nợ 11), 2026-09-07

## Bảng

| Hạng mục | Phạm vi | Commit được review | Môi trường đo | Phát hiện | Đóng ở commit |
|---|---|---|---|---|---|
| **S1.17** | `packages/audit/src/anchor-{text,verify,sign,store}.ts`, `verifier.ts`, `writer.ts`, `index.ts` + `package.json` của gói; `tools/neo-so-kiem-toan/`; `packages/test-support/src/neo-fixture.ts`; `.dependency-cruiser.cjs` (họ `g11-`), `vitest.config.ts`, `eslint.config.js`; toàn bộ test của vòng | **cây làm việc, TRƯỚC commit đầu tiên của vòng** — xem ghi chú dưới bảng | Review tĩnh (reviewer không có Bash, không có CSDL); mọi phép đo trong bảng do vòng sửa chạy | **0 CRITICAL, 1 HIGH, 3 MEDIUM, 6 LOW** | `0985ada` (gói `audit`: H9-1 nửa kho, H9-2, H9-3, H9-5, H9-6, H9-10) · `236a7ba` (công cụ: H9-1 nửa từ-chối-lùi, H9-7, H9-8) · `ac118a6` (H9-4) |

**MỘT KHÁC BIỆT VỚI TÁM LƯỢT TRƯỚC, PHẢI NÓI RA VÌ NÓ LÀM MẤT MỘT PHẦN TRUY NGUYÊN:** tám lượt trước
review một COMMIT đã tồn tại, nên ai cũng dựng lại được đúng trạng thái mà reviewer nhìn thấy. Lượt
này chạy trên **cây làm việc chưa commit**, nên **trạng thái trước sửa không có tên và không dựng lại
được**. Đổi lại, mọi phát hiện được đóng TRƯỚC khi lịch sử ghi lại một trạng thái có lỗ.

Hai vế ấy không thay thế nhau, và vế mất là vế thật. **Bài học cho vòng sau: commit trước, review
sau** — một lượt review không có SHA là một lượt review mà người thứ ba phải tin lời kể.

## Một HIGH

| Mã | Tóm tắt phát hiện | Trạng thái sau vòng sửa |
|---|---|---|
| H9-1 | **HIGH — LỖ FAIL-OPEN ĐẦU-CUỐI.** `append` gọi `mkdir(recursive)` rồi để `appendFile` tự tạo tệp, nên một lần XOÁ nơi cất không phải là *mất mốc neo* mà là **RESET về "chưa từng neo"**: lượt xuất theo lịch kế tiếp lấp đầy lại bằng mốc neo của cái sổ đã bị cắt, và `kiem` trả `ok=true`, `problems: []`, mã thoát 0. Đủ năm bước, không bước nào bị một dòng mã nào phản đối. Nó cũng bác một lời khai của chính vòng: *"không dòng mã nào ở đây đổi được điều đó"* — mã không ngăn được việc XOÁ, nhưng mã ngăn được việc âm thầm coi một nơi cất vừa biến mất là một nơi cất mới tinh, và bản đầu cố ý làm điều ngược lại | **Đóng bằng hai lớp.** ⑴ `append` KHÔNG tạo thư mục gốc; nơi cất vắng mặt thì NÉM với thông điệp nói ra hệ quả, và việc dựng nó là một lệnh tường minh `pnpm neo khoi-tao`. ⑵ `xuat` đọc nơi cất TRƯỚC khi ghi và **từ chối** một mốc neo có `seq` LÙI so với mốc cao nhất đã kiểm được — `audit_events.seq` chỉ đi lên, nên một đầu chuỗi thấp hơn là một vụ cắt đuôi, và bộ xuất ở đúng vị trí để nói ra điều đó vào đúng lúc. Hai đột biến, hai test ĐỎ. **Ca CÒN HỞ, ghi ra:** xoá đúng MỘT tệp `<org>.jsonl` mà giữ thư mục thì lớp ⑵ mất mốc so sánh — đóng nó đòi một trạng thái NGOÀI nơi cất, tức lại là bài toán triển khai (ADR-026 §5⑵) |

## Ba MEDIUM

| Mã | Tóm tắt phát hiện | Trạng thái sau vòng sửa |
|---|---|---|
| H9-2 | **MEDIUM — dấu đúc SAO CHÉP ĐƯỢC bằng một phép spread.** Dấu đúc là thuộc tính own **enumerable** khoá bằng symbol, và phép kiểm đọc nó qua truy cập thuộc tính. `{ ...neo, seq: 3 }` **typecheck sạch**, giữ nguyên dấu đúc, không cần `as unknown as`; `Object.create(neo)` cũng lọt vì đọc qua prototype. Tức đường lọt không phải một nỗ lực có chủ đích như tài liệu mô tả — nó là **một dòng refactor bình thường**, đúng thứ *"lọt vào một cách TÌNH CỜ"* mà lớp này sinh ra để chặn. Kèm một lời khai sai ở `verifier.ts`: *"tầng kiểu đã chặn mọi đường còn lại"* | **Đóng bằng `WeakSet`.** Bằng chứng ở tầng chạy gắn với CHÍNH THAM CHIẾU, nên spread / `Object.assign` / `Object.create` / `structuredClone` đều không mang nó theo; thuộc tính symbol giữ lại CHỈ để tầng kiểu còn hai `@ts-expect-error` làm mốc chết. Năm ca sao chép có test riêng; đột biến (trả phép kiểm về đọc thuộc tính) giết **4/5** — `structuredClone` sống sót vì nó vốn bỏ khoá symbol, và điều đó được ghi vào chính test. Lời khai ở `verifier.ts` gạch tại chỗ và viết lại |
| H9-3 | **MEDIUM — bộ ký không chứng minh hai nửa khoá là MỘT CẶP.** `docBoKy` ghép nửa riêng từ một biến môi trường với nửa công khai từ một biến khác; không nơi nào kiểm chúng khớp. Một lần xoay khoá dán nhầm cho ra một bộ xuất chạy SẠCH hàng tháng (mã thoát 0, in `seq=...` mỗi lượt), và vì `kiem` **chưa có LỊCH** thì lỗi chỉ lộ ở lần kiểm toán thật — khi ấy fail-closed đúng thiết kế, nhưng TOÀN BỘ cửa sổ đó không có một mốc neo dùng được. Fail-closed ở đường ĐỌC không cứu một lỗi cấu hình ở đường GHI; nó chỉ báo tin muộn | **Đóng bằng tự kiểm một lần.** `createLocalDevAnchorSigner` ký một văn bản mẫu rồi `verifyAnchorRecord` bằng chính nửa công khai của `kid` ấy, và NÉM ngay lúc tạo nếu không đạt — cùng khuôn "hàng rào chạy NGAY khi tạo" mà `assertLocalDevAllowed` đã đặt ở dòng trên. Đột biến ⇒ test ĐỎ |
| H9-4 | **MEDIUM — `g11-` là họ quy tắc DUY NHẤT không có probe.** Mọi họ trước (`g1-`…`g10-`) đều có test viết một file probe thật rồi chạy `depcruise` và đòi đúng tên quy tắc; `grep g11 tests/` trả về rỗng. Nó đáng có hơn các họ khác một bậc, vì `packages/audit` nằm trong danh sách MIỄN TRỪ của `[INV-H16]` (khoản nợ 17) — gói này KHÔNG có quy tắc "index là cửa duy nhất", nên `g11-` là lớp cưỡng chế DUY NHẤT giữ đường ký khỏi `apps/api`. Đột biến thủ công của vòng không phải một mốc chết: nó không chạy lại lần thứ hai | **Đóng bằng bốn probe** (import nội bộ, cửa subpath, import ngược, đối chứng dương cho `index.ts`). **Và chính chúng bắt được một lớp canh RỖNG RUỘT trong bản đầu của mình:** probe đặt ở `apps/tmp-probe-*` không có `package.json` nên specifier subpath KHÔNG resolve được, `to.path` của `g11-` không khớp gì cả và quy tắc IM LẶNG — thứ kêu là lưới đỡ `g1-khong-import-trustprocure-khong-resolve-duoc`. Đó đúng là lỗ **C1** mà `.dependency-cruiser.cjs` đã đặt tên từ S0, lần này hiện ra trong một PHÉP ĐO chứ không trong mã sản phẩm. Probe chuyển sang `packages/test-support` — gói có liên kết thật tới `@trustprocure/audit` |

## Sáu LOW

| Mã | Tóm tắt phát hiện | Trạng thái sau vòng sửa |
|---|---|---|
| H9-5 | **LOW.** `alg` được kiểm nhưng KHÔNG ràng buộc với loại khoá thật: `createVerify("sha256").verify(...)` chọn thuật toán theo **SPKI trong vòng khoá**, không theo trường `alg`. Một khoá RSA dưới `kid` ấy cho ra phép kiểm RSA-PKCS1 trong khi artefact vẫn khai `ECDSA_P256_SHA256` | **Đóng.** `createPublicKey` rồi đòi `asymmetricKeyType === "ec"` và `namedCurve === "prime256v1"`. Đột biến ⇒ ca RSA và ca Ed25519 chuyển từ "ném" sang "đạt", 3 test ĐỎ. Không khai thác được bởi tác nhân trong mô hình đe doạ (cần kiểm soát vòng khoá) — đóng vì một **artefact nói sai về chính nó** là đủ nặng cho một tài liệu dùng cho kiểm toán |
| H9-6 | **LOW.** Dữ liệu CHƯA XÁC THỰC (`kid` từ văn bản chưa kiểm chữ ký, độ dài không giới hạn) và `moTa` chưa lọc đi thẳng vào thông điệp mà kiểm toán viên ĐỌC. Một `\r` hoặc escape ANSI ở đó xoá/ghi đè những dòng đã in — tức nội dung nơi cất viết lại được phần kết luận người đọc nhìn thấy. Sản phẩm của cả cơ chế này là một BÁO CÁO, nên "dữ liệu chưa xác thực vào báo cáo" đáng đóng | **Đóng bằng `antoanChoBaoCao`:** cắt về 120 ký tự và thay MỌI ký tự lớp `\p{C}` bằng escape đọc được. Áp cho mọi nội suy giá trị chưa xác thực ở `anchor-text.ts` và `anchor-verify.ts`, và cho `moTa` ngay tại `createFileAnchorStore` — chỗ nó ra đời, không chỉ chỗ nó được đọc |
| H9-7 | **LOW.** `loadVerifiedAnchors` ném xuyên qua vòng lặp `--org`, nên một bản ghi hỏng ở tổ chức đầu biến một lượt 50 tổ chức thành một dòng lỗi duy nhất; nếu ai đó "vá" bằng cách bỏ tổ chức ấy ra khỏi danh sách thì tổ chức bị tấn công là tổ chức duy nhất không được kiểm | **Đóng.** Bọc TỪNG tổ chức ở cả `xuat` lẫn `kiem`, in `KHONG KIEM DUOC` / `KHONG XUAT DUOC` kèm lý do, chạy tiếp; mã thoát vẫn khác 0. Test int khẳng định tổ chức thứ hai VẪN được kiểm |
| H9-8 | **LOW.** Bảng "Cách dùng" in `neo-so-kiem-toan xuat …` — một lệnh không có `bin`, không có script workspace, tức **không chạy được**. Đúng lớp lỗi của khoản nợ 23 | **Đóng.** Script gốc `pnpm neo`, và `CACH_DUNG` in đúng dòng ấy. Test int khẳng định chuỗi `pnpm neo xuat` có trong output của lệnh lạ |
| H9-9 | **LOW.** *"kiểm toán viên kiểm được artefact này mà không cần một dòng mã nào của chúng ta"* rộng hơn phép đo: thứ ĐÃ đo là chữ ký kiểm được bằng `createVerify` của `node:crypto`; thứ CHƯA đo là tách `text`/`sig` khỏi dòng JSONL, đổi SPKI DER sang PEM, rồi chạy `openssl(1)` | **Đóng bằng cách HẠ PHÁT BIỂU** ở bốn chỗ (`anchor-text.ts`, `anchor-verify.ts`, `anchor-sign.ts`, ADR-026), gạch nguyên văn tại chỗ: *"ĐỊNH DẠNG là thứ OpenSSL kiểm được; CÔNG THỨC tách nó ra khỏi nơi cất thì chưa được đo"*. Đường đóng thật (một lệnh `trich` + một test int chạy `openssl`) ghi vào ADR-026 §5⑶ |
| H9-10 | **LOW.** `parseAnchorText` ở CỬA CÔNG KHAI của gói trả về các trường **chưa qua một regex nào** — đường DỰNG chạy đủ 5 phép kiểm, đường ĐỌC không chạy phép nào. `verifyAnchorRecord` an toàn nhờ vế dựng-lại-và-so-từng-byte, nhưng người gọi THỨ HAI thì không có vế ấy | **Đóng.** Tách `kiemHinhDang` và chạy nó ở CẢ hai đường. Nói rõ trong chú thích rằng nó KHÔNG thay thế vế dựng-lại (vế ấy bắt được `seq=06`, thứ mà `Number.isInteger` cho qua) — nó là lớp thứ hai cho người gọi không có vế ấy |

## Bảy câu hỏi bị chính phép đo BÁC BỎ

Ghi lại vì một mối lo bị bác bỏ có giá trị bằng một phát hiện — nó nói cho vòng sau biết chỗ nào
không cần đo lại:

- **Nhập nhằng văn bản chính tắc / chèn ký tự phân cách** — vế `buildAnchorText(truong) === text`
  giết mọi biến thể đã thử: `seq=06`, `seq=+6`, `seq= 6`, `kid=a=b`, `\r\n`, dòng thừa/thiếu,
  ` `, và cả ca lone-surrogate.
- **Lỗ kiểu `alg: none`** — `alg` KHÔNG BAO GIỜ chọn thuật toán kiểm; nó chỉ là một trường phải khớp
  hằng số, và bị vế dựng-lại ghim lần hai. (Dư lượng ngược chiều là H9-5.)
- **`kid` chưa xác thực dùng tra khoá** — tra bằng `ReadonlyMap.get`, không bằng thuộc tính object,
  nên `kid = "__proto__"` không trả về gì.
- **Malleability của chữ ký DER** — OpenSSL giải mã rồi **mã hoá lại và so từng byte**, nên DER thừa
  đuôi bị từ chối. Malleability `(r, n−s)` vốn có của ECDSA thì vô hại ở đây: nơi cất chỉ-ghi-thêm và
  bộ tải kiểm MỌI bản ghi, nên một chữ ký khác của cùng văn bản chỉ nhân đôi một phép kiểm.
- **`orgId` vào tên tệp — traversal / tên thiết bị Windows** — `UUID_PATTERN` neo `^…$` (JavaScript
  không có cờ `m` ở đây, nên `$` chỉ khớp cuối chuỗi — không có lỗ "xuống dòng cuối" kiểu Python);
  tập ký tự còn lại đúng bằng `[0-9a-f-]`, độ dài cố định 36. Cả HAI đường đi qua `duongDanCua`.
- **`loadVerifiedAnchors` fail-open** — bác bỏ Ở TẦNG HÀM (mọi lối "im lặng thiếu" đều bịt); nhưng
  ghép với bộ xuất thì tính fail-closed ấy bị chính `xuat` gỡ ⇒ đó là H9-1, không phải một ca riêng.
- **Khoá riêng rò ra thông điệp lỗi** — `batBuoc` chỉ in TÊN biến; lỗi ký bọc bằng một thông điệp cố
  định và `cause` KHÔNG được in (bộ bắt chỉ in `loi.message`); `publicKeys()` đã có test dò khoá
  riêng dưới cả ba cách mã hoá. Rủi ro còn lại là bản chất của biến môi trường, đã khai là khiếm
  khuyết đã biết cùng đường đi KMS.

**Ghi chú của reviewer, không phải phát hiện:** đặt phép kiểm dấu đúc **trước** phép lọc
`neo.orgId !== orgId` là đúng — nếu đảo lại, một mốc neo tự đúc chỉ cần mang một `orgId` lạ là rơi vào
nhánh im lặng. `readAllRaw` đọc cả tệp vào bộ nhớ không giới hạn kích thước: với nhịp neo theo ngày
thì `n` nhỏ, chỉ đáng nêu nếu nơi cất chuyển sang nhịp phút. Và CLI dùng pool role `app_api` cho cả
hai lệnh — đúng chiều: công cụ neo không chạy dưới role deploy.

---

# S1.18 — lượt review thứ MƯỜI (biên giới bốn gói S0 + danh sách trắng barrel, khoản nợ 17 và 9), 2026-09-07

## Bảng

| Hạng mục | Phạm vi | Commit được review | Môi trường đo | Phát hiện | Đóng ở commit |
|---|---|---|---|---|---|
| **S1.18** | `.dependency-cruiser.cjs` (họ `g12-`…`g15-`), `tests/architecture/boundaries.test.ts` (13 probe mới), `tests/architecture/bien-gioi-goi.test.ts` ([INV-H16], `MIEN_TRU` → RỖNG), `tests/architecture/barrel-exports.test.ts` (4 danh sách trắng + cửa `./anchor-sign` + [INV-H18]), `docs/TEST-PLAN.md`, `tools/inv-matrix/src/danh-gia.ts` | **`b47ecc1`** | Read/Grep/Glob; **không** chạy được `depcruise`/`vitest`/`tsc` (reviewer không có Bash) | **0 CRITICAL, 1 HIGH, 3 MEDIUM, 6 LOW** | `b4378cf` (H10-1, H10-2, H10-6, H10-10) · `ffafd71` (H10-4) · `02e6fc6` (H10-3, H10-5, H10-7, H10-8, H10-9) |

**LƯỢT NÀY CHẠY TRÊN MỘT COMMIT CÓ TÊN — bài học mục 32 của `docs/STATE.md` đã được áp.** S1.17
review trên cây làm việc chưa commit và vì thế mất truy nguyên. Ở đây trạng thái reviewer nhìn thấy
là `b47ecc1`, dựng lại được bằng một lệnh `git checkout`.

## Một HIGH

| Mã | Tóm tắt phát hiện | Trạng thái sau vòng sửa |
|---|---|---|
| **H10-1** | **HIGH — VỊ TỪ "GÓI" CHỈ CHUYỂN CHỖ GIẤU, KHÔNG BIẾN MẤT.** Cả [INV-H16] lẫn [INV-H18] tự nhận *"suy TỪ TÍNH CHẤT, không từ một danh sách tên"*, nhưng cả hai định nghĩa gói = *thư mục con của `packages/` **có `src/index.ts`***. Một gói là một thư mục có `package.json`. Kịch bản không cần một dòng mã xấu nào: `packages/kms/package.json` khai `"exports": { ".": "./src/main.ts" }`, không có `src/index.ts` ⇒ gói ấy rơi khỏi **cả hai** vị từ, không họ quy tắc biên giới nào bị đòi, không danh sách trắng nào bị đòi, và **hai khẳng định *"danh sách miễn RỖNG"* vẫn XANH** vì miễn trừ đúng là rỗng thật. Khoản nợ 9 và 17 mở lại **trong im lặng, ngay sau vòng tuyên bố đóng chúng**. Cùng lối: đổi tên `packages/db/src/index.ts` → `main.ts` làm `db` biến mất khỏi cả hai lớp | **ĐÓNG** `b4378cf` — vị từ chuyển sang `tests/architecture/goi-workspace.ts`, đọc `packages/*/package.json`, và **DÙNG CHUNG** cho cả hai bất biến (hai bản chép gần giống nhau là thứ sẽ trôi khỏi nhau). Cộng một khẳng định mới: mọi THƯ MỤC con của `packages/` phải là một gói có `package.json` — thư mục không có thì NÉM. Đột biến: dựng `packages/zzprobe-kms` đúng hình dạng trên ⇒ **H16 và H18 cùng ĐỎ**; dựng một thư mục không có `package.json` ⇒ khẳng định mới ĐỎ |

## Ba MEDIUM

| Mã | Tóm tắt phát hiện | Trạng thái sau vòng sửa |
|---|---|---|
| **H10-2** | **Trần *"tối đa hai cửa"* là một khoản CẤP KHÔNG.** `coQuyTacBienGioi` đòi `to.pathNot` CHỨA `index.ts` và có `length <= 2` — một con số dùng chung cho cả mười ba gói, đặt ở 2 để không đỏ oan trên `crypto-keys`. Hai gói tiêu thụ nó hợp pháp; **mười một gói còn lại được cấp sẵn một cửa thứ hai**. Sửa một dòng `pathNot: [DB_INDEX_TS, ciFile("packages/db/src/pool.ts")]` là đủ: H16 xanh (length = 2), H18 xanh (`exports` không đổi), và không probe nào đỏ vì probe của `db` nhắm `migrate.ts` | **ĐÓNG** `b4378cf` — bỏ trần, so **BẰNG TẬP**, và tập cửa hợp lệ đọc từ chính `exports` của gói. Mở một cửa thứ hai vì thế không còn là một dòng trong file cấu hình mà **buộc phải là một dòng trong `package.json`** — thứ [INV-H18] cũng nhìn thấy. Cả 13 quy tắc hiện có đã khớp đúng tập ấy nên không quy tắc nào phải sửa. Đột biến: mở cửa thứ hai cho `g14-` mà không động vào `package.json` ⇒ ĐỎ |
| **H10-3** | **Khẳng định rộng hơn phép đo.** Văn của vòng đóng khung `g14-`/`g15-` như lớp canh cho *"điểm DUY NHẤT gắn GUC `app.org_id`"*, với câu *"một đường vòng tới hàm này là một đường vòng tới quyết định phiên này thuộc tổ chức nào"*. Đo thật thì hai họ ấy **không rút một symbol nào** khỏi tầm với — mọi symbol giá trị của `with-tenant.ts` và của `test-support/src/` đều đã ở cửa | **ĐÓNG** `02e6fc6` — đếm được và ghi vào đúng chỗ: `g12-` rút **một** (`antoanChoBaoCao`), `g13-` rút **một** (`migrationChecksum`), `g14-` và `g15-` rút **không**. Thứ hai họ ấy mua là **mặc định đóng cho module tương lai**; câu cũ nói về HẬU QUẢ nếu có một đường vòng, không được đọc thành *"đang có một đường vòng bị chặn"* |
| **H10-4** | **Một cổng đã RỖNG RUỘT từ S0, và chín lượt review trước không bắt được vì nó XANH.** `khong-phu-thuoc-devdep-trong-src` không bao giờ bắn được: `options.exclude` chứa `node_modules`, mà `exclude` **gỡ hẳn** module khỏi đồ thị (khác `doNotFollow`, chỉ ngừng duyệt tiếp), trong khi `npm-dev` chỉ được gán cho cạnh resolve **vào** node_modules | **ĐÓNG** `ffafd71`, **và nó là phát hiện duy nhất của lượt này được nâng từ *nghi ngờ* lên *xác nhận* bằng một phép đo mới.** Đếm trên toàn đồ thị trước khi sửa: 264 `import`, 231 `local`, 94 `aliased`, 83 `core`, 44 `export`, 40 `unknown`, 14 `type-only`, 6 `dynamic-import` — và **KHÔNG một cạnh nào mang `npm-dev`**. Sửa: bỏ `node_modules` khỏi `exclude` (giữ `doNotFollow`), giá là 194→197 module, 758→822 phụ thuộc. Một miễn trừ duy nhất, `packages/test-support/src/`, và nó **không phải một tên trong một danh sách**: tính chất *"gói này là hạ tầng kiểm thử"* do `pham-vi-san-xuat.test.ts` vế ⑵ cưỡng chế. Đường sửa *"chuyển `pg`/`@testcontainers` sang `dependencies` của gói ấy"* đã được xét và **BÁC BỎ**: nó tái lập đúng khiếm khuyết mà khoản nợ 21 ra đời để chặn. Đột biến: trả `node_modules` về `exclude` ⇒ test chống-rỗng-ruột ĐỎ **trong khi `pnpm depcruise` vẫn XANH**; gỡ miễn trừ ⇒ 2 vi phạm THẬT |

## Sáu LOW

| Mã | Tóm tắt phát hiện | Trạng thái sau vòng sửa |
|---|---|---|
| **H10-5** | Probe thứ tư của `audit` (*"cửa THỨ HAI không bị `g12-` đóng"*) đo sự **vắng mặt** của một vi phạm, không có đối chứng đòi cạnh `tools/neo-so-kiem-toan → anchor-sign.ts` **tồn tại** ⇒ ngày công cụ thôi đi qua cửa ấy, test xanh vĩnh viễn mà không đo gì | **ĐÓNG** `02e6fc6` — thêm một đối chứng đứng TRƯỚC: đọc mã nguồn công cụ và đòi specifier `@trustprocure/audit/anchor-sign` có thật. Cùng khuôn `existsSync` mà test của `apps/unseal-worker` dùng |
| **H10-6** | `main` và `exports["."]` không bị lớp nào buộc phải trùng, trong khi `vitest.config.ts` alias `@trustprocure` → `packages` (đi vòng qua `exports` hoàn toàn) ⇒ một dòng `"main": "src/with-tenant.ts"` để lại mọi khẳng định XANH trong khi bề mặt được CHẠY khác bề mặt được ĐO | **ĐÓNG** `b4378cf` — [INV-H18] thêm một khẳng định cho cả 13 gói. Đột biến: đổi `main` của `tenancy` ⇒ ĐỎ |
| **H10-7** | Chú thích `g12-` khai *"đi lọt CẢ BA cổng (depcruise, tsc, eslint)"* trong khi vòng chỉ đo bằng `depcruise` | **ĐÓNG** `02e6fc6` — ba cổng đã chạy trên **cùng một probe**: `tsc` exit 0, `eslint` exit 0, `depcruise` exit 1. Câu ấy nay là một phép đo |
| **H10-8** | Kế hoạch mở rộng phát biểu của nợ 17 sang vector **subpath**, vốn chưa bao giờ mở: `db`/`tenancy`/`test-support` khai `exports` chỉ có `"."`, và `enhancedResolveOptions` bắt depcruise resolve qua đúng trường ấy ⇒ `@trustprocure/db/src/pool.js` chưa bao giờ resolve được; thứ bắn cho nó là lưới đỡ `g1-khong-import-trustprocure-khong-resolve-duoc` | **ĐÓNG** `02e6fc6` — thu hẹp phát biểu về đúng vector đường TƯƠNG ĐỐI. Trên vector subpath, bốn họ mới cộng thêm **0** |
| **H10-9** | [INV-H18] tạo ra một **ngoại lệ cho doctrine *"một tiến trình, một khả năng"***: khẳng định *"khớp bề mặt THẬT"* nạp cả ba cửa hạn chế trong cùng một worker vitest (`unwrap.ts`, `unseal.ts`, `anchor-sign.ts`), và dynamic import với specifier dựng từ biến làm depcruise **về nguyên lý** không thấy cạnh đó | **ĐÓNG** `02e6fc6` bằng cách GHI RA ở cả hai nơi — nơi ngoại lệ được tạo ([INV-H18]) và nơi doctrine được viết (khối `g11-`). Kèm một câu nói rõ: *"không module nào làm gì lúc nạp"* là **kiểm bằng cách ĐỌC**, chưa phải một phép đo lúc chạy |
| **H10-10** | Hàng H16 của sổ đăng ký viết *"`index.ts` là cửa duy nhất"* — chặt hơn thứ được cưỡng chế (mã chấp nhận tới hai cửa), và chính chỗ chênh ấy là cửa vào của H10-2 | **ĐÓNG** `b4378cf` — gạch tại chỗ, viết lại theo đúng thứ H10-2 dựng: *"ĐÚNG tập cửa mà `package.json` khai trong `exports`"* |

## Mười một mục reviewer ĐÃ KIỂM và KHÔNG thấy vấn đề

Ghi lại vì dự án tính *"đã kiểm, không thấy"* là một kết quả, và vì hai mục dưới đây là phần đắt
nhất của lượt review:

1. **Lỗ C1 ở 13 probe mới — KHÔNG tái diễn.** Cả 13 dùng specifier **tương đối**, nên resolve độc
   lập với `package.json` và liên kết workspace — đúng lớp lỗi S1.17 suýt vấp. Mọi probe âm khẳng
   định CẢ HAI vế (`status !== 0` **và** `output` chứa **tên quy tắc đầy đủ**), nên một quy tắc im
   lặng không thể cho ra một lượt xanh; một lần `spawnSync` hỏng cũng không, vì vế `toContain` vẫn
   phải thoả.
2. **`g11-` và `g12-` không che nhau** — bốn ca được liệt kê hết: import nội bộ tới `anchor-sign.ts`
   (`g12-` không áp, `g11-` bắn) · import từ ngoài qua cửa thứ hai (`g12-` im vì đó là cửa, `g11-`
   bắn) · import `anchor-sign.test.ts` (cả hai cùng bắn) · file trong `packages/audit/` ngoài `src/`
   (`g12-` bắn). Không cấu hình nào làm cả hai im.
3. Hoa/thường trên hệ tệp Windows — bốn họ mới dựng **mọi** mảnh đường dẫn bằng `ciFile`/`ciPrefix`,
   không một regex viết tay nào.
4. Đường qua `node_modules` không làm bốn quy tắc mới mù (symlink workspace resolve về đường thật).
5. Đường qua tsconfig `paths` không có lối vòng (wildcard một mảnh không diễn đạt được subpath lồng).
6. Nội dung bốn danh sách trắng khớp bề mặt thật; sổ đăng ký phủ đúng **16 cửa** = đúng tập `exports`
   của cả 13 gói, và nó dùng **chính** các mảng của từng khối nên không sinh ra một danh sách thứ hai
   đi lệch.
7. Một cửa `exports` mới không lọt được (hai khẳng định cùng đỏ).
8. Không bí mật/khoá/token nào được thêm.
9. Xác thực/uỷ quyền không bị nới cho test đi qua; bốn họ mới mỗi họ có **đúng một** miễn trừ `from`,
   và miễn trừ ấy đồng thời là đích hạn chế của chính quy tắc đó.
10. Không đường log mới; bộ báo rò rỉ kết nối của `test-support` vẫn cố ý không in cột `query`.
11. `MOC_GHIM` 51 → 52 nhất quán, và cơ chế hai chiều buộc lần nâng phải là một dòng có chữ ký.

## Điều đáng mang sang vòng sau

**Một quy tắc XANH trông giống hệt một quy tắc đang làm việc.** H10-4 sống qua chín lượt review và
mọi lượt CI kể từ S0, vì thứ duy nhất ai cũng nhìn là dòng *"no dependency violations found"*. Lớp
bắt được nó không phải một con mắt tinh hơn mà là một câu hỏi khác: **không phải *"có vi phạm
không"* mà là *"quy tắc này có ĐỐI TƯỢNG nào để phán xét không"***. Câu hỏi ấy nay là một test.

**Và H10-1 nói một điều khó chịu hơn về chính vòng này:** vòng S1.18 sinh ra để xoá khuôn
danh-sách-tên, rồi tự viết lại khuôn ấy dưới dạng một phép thử tồn tại tệp. *"Suy từ tính chất"* chỉ
đúng khi **tính chất được chọn đúng miền** — `src/index.ts` là một quy ước, `package.json` mới là
định nghĩa.

---

# S1.19 — lượt review thứ MƯỜI MỘT (lệnh `trich`, công thức `openssl(1)`, ADR-026 §5⑶), 2026-09-07

## Bảng

| Hạng mục | Phạm vi | Commit được review | Môi trường đo | Phát hiện | Đóng ở commit |
|---|---|---|---|---|---|
| **S1.19** | `tools/neo-so-kiem-toan/src/index.ts` (lệnh `trich`), `cong-cu.int.test.ts` (khối openssl), `packages/audit/src/anchor-{store,text,verify,sign}.ts`, `docs/DECISIONS.md` ADR-026 §5⑶ | **`2cc36bb`** | Read/Grep/Glob; **không** chạy được lệnh nào | **0 CRITICAL, 2 HIGH, 5 MEDIUM, 6 LOW** | vòng sửa cùng PR |

## Hai HIGH

| Mã | Tóm tắt phát hiện | Trạng thái sau vòng sửa |
|---|---|---|
| **H11-1** | **Byte đi vào artefact đến từ lượt đọc THỨ HAI, chưa qua kiểm chữ ký.** `trich` gọi `loadVerifiedAnchors` (fail-closed) rồi `readAllRaw` lần nữa, và ghép hai kết quả **theo chỉ số**. Lớp canh duy nhất giữa hai lượt là phép so **ĐỘ DÀI**. Một nơi cất bị thay nội dung mà GIỮ NGUYÊN SỐ DÒNG đi lọt: công cụ in *"Kết quả mong đợi: Verified OK"* cho một artefact mà OpenSSL sẽ từ chối — và thông điệp từ chối ấy không phân biệt được với thông điệp của một chữ ký giả mạo. Nặng hơn cửa sổ TOCTOU là **lời khai**: câu *"đi qua `loadVerifiedAnchors` nên không tách artefact ra khỏi một nơi cất đang hỏng"* chỉ đúng cho lượt đọc thứ nhất | **ĐÓNG** — `verifyAnchorRecord` chạy lại trên ĐÚNG đối tượng sắp ghi, cộng phép so `orgId`/`seq`/`hashHex` với mốc neo của lượt một. **KHÔNG CÓ MỐC CHẾT, và điều đó được ghi ra ở cả ba nơi** (mã, ADR §7c, mục này): đột biến gỡ vế ấy ⇒ **cả 16 test vẫn XANH**, vì dựng một lượt chạy mà nơi cất đổi giữa hai lượt đọc đòi một móc tiêm vào `readAllRaw` mà đường CLI không có |
| **H11-2** | **Ba tệp ghi bằng `flag` mặc định `"w"`** — đi theo symlink và ghi đè im lặng, không đặt `mode`. Kịch bản: kẻ tấn công cục bộ biết `--ra` và `<uuid>` (dữ liệu công khai) đặt trước một symlink `neo-<uuid>-seq4.txt → ~/.ssh/authorized_keys`; `mkdir recursive` thành công vì thư mục đã có, `writeFile` đi theo symlink và ghi đè tệp đích. Ca thứ hai: hai lượt `trich` vào cùng `--ra` trộn `.txt` của lượt này với `.sig` của lượt trước ⇒ một cặp KHÔNG khớp nhau, và OpenSSL trả lời bằng đúng câu của một vụ giả mạo. Kho đã có chuẩn ngược lại từ [review H3-3] (`apps/api/src/adapters/hop-thu-dev.ts`), `trich` không theo | **ĐÓNG** — `{ mode: 0o600, flag: "wx" }` cho cả ba tệp, `mkdir` `mode: 0o700`, và `EEXIST` ném với thông điệp nêu đúng ca TRỘN. `wx` đóng cả hai vector và không mở cửa sổ TOCTOU như một phép `existsSync` đứng trước. Đột biến: bỏ `wx` ⇒ ĐỎ |

## Năm MEDIUM

| Mã | Tóm tắt phát hiện | Trạng thái sau vòng sửa |
|---|---|---|
| **H11-3** | Hai trong ba đối chứng âm chỉ đòi mã thoát `≠ 0`. `openssl dgst` trả `≠ 0` cho MỌI thất bại — kể cả không nạp được khoá. Ca "khoá lạ" xanh được vì OpenSSL **không đọc nổi tệp khoá**, kèm đúng thông điệp tự tin *"khoá LẠ mà openssl vẫn nhận ⇒ phép đo này rỗng ruột"* | **ĐÓNG** — cả ba ca khẳng định thêm chuỗi *"verification failure"*; ca khoá lạ có một đối chứng **dương** (`openssl pkey -pubin -noout` phải exit 0); ca chữ ký có phép so độ dài tệp |
| **H11-4** | Quyết định ⑶ (*PEM là bản chép ĐÚNG BYTE*) **không có mốc chết** — đổi sang `createPublicKey(...).export(...)` thì mọi test vẫn xanh | **ĐÓNG, sau HAI lần viết.** Bản đầu của mốc chết **cũng sống sót đột biến**, vì với một SPKI hợp lệ hai đường cho ra cùng chuỗi base64. Bản thứ hai chạy trên đúng đầu vào làm chúng khác nhau — một SPKI 91 byte cộng một byte rác, thứ mà **cả `createPublicKey` lẫn `openssl pkey` đều NHẬN** — và nó ĐỎ đúng ở 91 vs 92 byte |
| **H11-5** | `readAllRaw` trả `[]` cho ENOENT, nên nó không phân biệt *"chưa từng neo"* với *"tệp `<org>.jsonl` vừa bị XOÁ"*. `trich` biến sự im lặng ấy thành một câu chỉ dẫn — *"chạy `pnpm neo xuat` trước"* — mà đó **đúng là thao tác RỬA** của ca hở ADR-026 §5⑵: không còn mốc neo cũ thì `mocNuocCao` bằng 0, lớp "từ chối neo lùi" mất mốc so sánh | **ĐÓNG phần sửa được** — thông điệp nay nêu CẢ HAI khả năng, nói thẳng hậu quả của khả năng thứ hai, và đòi đối chiếu với một bản sao ngoài trước khi chạy. Ca hở gốc **không đóng**: nó cần một trạng thái nằm NGOÀI nơi cất |
| **H11-6** | Nhiều bản ghi cùng `seq` ⇒ chọn im lặng cái ĐẦU TIÊN. Trùng `seq` là bình thường; trùng `seq` với **`chain_hash` khác nhau** là hình dạng của một vụ cắt-đuôi-rồi-neo-lại. `kiem` bắt được; đường `trich` → OpenSSL thì **giấu nó**, vì kiểm toán viên chỉ có ba tệp trước mặt | **ĐÓNG** — ném, liệt kê các `chain_hash` mâu thuẫn, và nói rõ *"lệnh này KHÔNG chọn hộ"*. Đột biến: gỡ phép kiểm ⇒ ĐỎ |
| **H11-7** | ADR khai *"đột biến ghi ra CRLF làm openssl từ chối"* như một phép đo đã chạy; test khi ấy đỏ ở khẳng định `not.toContain("\r")` **trước khi OpenSSL được hỏi một câu nào**. Và §7/§7b của ADR-026 không có mục nào của S1.19 | **ĐÓNG** — một ca THƯỜNG TRỰC dựng bản CRLF rồi hỏi OpenSSL; §7c thêm tám mục (14–21) |

## Sáu LOW

| Mã | Tóm tắt | Trạng thái |
|---|---|---|
| **H11-8** | `Buffer.from(x,"base64")` không bao giờ ném ⇒ `.sig` rỗng ghi ra không một tiếng kêu | **ĐÓNG** — chặn `length === 0` cho cả chữ ký lẫn văn bản, ngay trước khi ghi |
| **H11-9** | `anchor-store.ts` nội suy `orgId` **chưa qua phép kiểm nào** vào thông điệp mà không qua `antoanChoBaoCao` — ngoại lệ duy nhất của họ `anchor-*`, đúng thứ H9-6 sinh ra để chặn | **ĐÓNG** — bọc `antoanChoBaoCao`. Kéo theo một quyết định nhìn thấy được: `antoanChoBaoCao` **ra cửa công khai** của `packages/audit` để công cụ dùng CHUNG thay vì chép lại; [INV-H18] buộc nó vào danh sách trắng trong cùng lượt |
| **H11-10** | `--ra`/`--seq` lặp lại lấy giá trị cuối trong im lặng; giá trị mở đầu `--` được nhận (`--ra --seq` tạo thư mục tên `--seq`); `--seq 0x10` thành 16; `ts.ra` in ra không khử độc | **ĐÓNG** — cả ba cờ từ chối lặp lại, từ chối giá trị mở đầu `--`, `--seq` đọc bằng `/^[1-9][0-9]{0,15}$/`, và mọi giá trị người gõ đi qua `antoanChoBaoCao` trên đường in |
| **H11-11** | `KID_PATTERN` cho phép `:`; trên Win32 `khoa-a:b.pem` là một **alternate data stream**, nên tệp in ra không tồn tại dưới tên đã in | **ĐÓNG** — siết ở `trich` (tập con an-toàn-đường-dẫn), **KHÔNG** siết `KID_PATTERN`: nó là hằng của ĐỊNH DẠNG ĐÃ KÝ, siết nó làm mốc neo cũ không kiểm được |
| **H11-12** | Có test *"không cần `DATABASE_URL`"*, không có test *"không cần khoá RIÊNG"* — vế thứ hai mới là vế an ninh | **ĐÓNG** — xoá HẲN ba biến (không đặt rỗng) kèm vế chống rỗng ruột. Đột biến: gọi `docBoKy()` trong `trich` ⇒ ĐỎ |
| **H11-13** | Dòng lệnh được tài liệu hoá (`pnpm neo trich …`) chưa bao giờ được chạy đúng như tài liệu — đúng lớp khoản nợ 23 | **ĐÓNG** — một ca `spawn` qua script workspace thật |

## Tám mục reviewer ĐÃ KIỂM và KHÔNG thấy vấn đề

1. **Fail-open khi `openssl` vắng mặt — KHÔNG.** `spawnSync` trả `status: null` → hàm bọc quy về `-1` → `expect(-1).toBe(0)` ĐỎ. Không `skipIf`, không `try/catch` quanh phép đo.
2. **Path traversal qua tên tệp — KHÔNG**, trừ ca `kid` chứa `:` (H11-11). `parseAnchorText` chạy `kiemHinhDang` TRƯỚC khi dựng tên; `orgId` là UUID, `seq` là số nguyên dương.
3. **Ghép theo chỉ số trong MỘT lượt đọc là đúng** — `loadVerifiedAnchors` duyệt và `push` theo thứ tự, ném nếu bất kỳ bản ghi nào hỏng. Cái sai là ghép với lượt đọc THỨ HAI (H11-1).
4. **`trich` không chạm `DATABASE_URL`/`createPool`/`withTenant`/`anchor-sign`** — lần theo `main()` từng nhánh; ranh giới khả năng của ADR-026 §4 không bị nới.
5. **Rò rỉ qua thông điệp** — mọi dữ liệu chưa xác thực trong đường `trich` đi qua `antoanChoBaoCao`, trừ hai chỗ đã thành H11-9 và H11-10.
6. **Nội dung ba tệp không chứa bí mật** (org_id, seq, chain hash, dấu thời gian, chữ ký, khoá CÔNG KHAI) — nên H11-2 là vấn đề TOÀN VẸN, không phải bí mật.
7. **Không bí mật nào commit vào kho**; test sinh cặp khoá lúc chạy.
8. **Vòng này không nới một lớp cưỡng chế cũ nào** — `CO_CHE_MO_DE_GHI` vẫn `"a"`, `append` vẫn không `mkdir`, `if (dau.seq < cao)` còn nguyên, `DA_KIEM` vẫn `WeakSet`, chốt loại khoá EC/P-256 còn nguyên.

## Điều đáng mang sang vòng sau

**Một mốc chết cũng cần một phép đo.** H11-4 là ca hiếm và đắt: reviewer chỉ ra rằng một quyết định thiết kế không có mốc chết; tôi viết một mốc chết; **nó sống sót đột biến**; phải viết lại lần hai trên đúng đầu vào làm hai đường khác nhau. Bài học không phải *"viết mốc chết"* mà là: **chạy đột biến NGAY sau khi viết mốc chết, vì một mốc chết chưa từng đỏ là một mốc chết chưa được đo** — cùng câu mà `bien-gioi-goi.test.ts` đã viết cho quy tắc depcruise, nay áp cho chính test.

**Và một vế của vòng sửa KHÔNG có mốc chết** (H11-1). Nó được ghi ra ở ba nơi thay vì để người sau tự phát hiện. Một bản vá không đo được vẫn đáng có — nhưng nó phải được đọc đúng như thế.

---

# S1.20 — review lượt 12: bốn danh sách tên cuối cùng của `hardening.always.sql`

## Bảng

| Trường | Giá trị |
|---|---|
| Vòng | **S1.20** — đóng khoản nợ 3 và 16 (ADR-028, migration `047`, `[INV-H19]`) |
| Nhánh | `no-3-16-hardening-danh-sach-ten`, cắt từ `f768d3f` |
| Phạm vi | `db/migrations/hardening.always.sql`, `db/migrations/047_chi_ghi_them_chan_truncate.sql`, `db/hardening-suy-tu-tinh-chat.int.test.ts`, `db/migrations.int.test.ts`, `db/rls-coverage.int.test.ts`, `docs/DECISIONS.md` (ADR-028), `docs/STATE.md`, `docs/TEST-PLAN.md`, `Handoff.md` |
| Môi trường của reviewer | **Read/Grep/Glob. KHÔNG Bash, KHÔNG cơ sở dữ liệu.** Reviewer nói thẳng giới hạn ấy ở dòng đầu báo cáo và đánh dấu từng chỗ suy-từ-tài-liệu |
| Phát hiện | **2 HIGH, 4 MEDIUM, 5 LOW** |
| Kết quả | **2/2 HIGH và 4/4 MEDIUM đã xử lý; 5/5 LOW đã đóng.** Trong đó **một HIGH bị PHÉP ĐO BÁC BỎ một nửa** (H1), và **một MEDIUM bác bỏ một câu của chính ADR-028** (M3) |

## Hai HIGH

| Mã | Tóm tắt | Trạng thái |
|---|---|---|
| **H1** | Mục *"chốt TRUNCATE"* **chặn deploy vĩnh viễn trên một lược đồ PHÂN MẢNH hợp lệ**: trigger cấp HÀNG được nhân bản xuống lá (nên lá vào tập suy ra) trong khi trigger TRUNCATE thì không, nên mọi lá đều bị báo thiếu chốt. Reviewer đề nghị miễn trừ con-cháu theo khuôn `LA_CUA_BANG_TENANT` | **ĐÓNG, NHƯNG KHÔNG THEO CÁCH ĐƯỢC ĐỀ NGHỊ — bốn phép đo bác bỏ vế *"hợp lệ"*.** ⑴ `CREATE TRIGGER … BEFORE TRUNCATE` trên `relkind='p'` **CHẠY ĐƯỢC** (nên ca "điều kiện không thoả mãn được" không tồn tại); ⑵ trigger hàng ĐƯỢC nhân bản xuống lá; ⑶ trigger TRUNCATE **KHÔNG** được nhân bản; ⑷ **`TRUNCATE <lá>` ĐI LỌT** dù cha có chốt. Lá là một **LỖ THẬT**, nên miễn trừ nó là fail-open. Giữ nguyên phép kiểm; thông điệp nay nói thẳng *"chốt trên CHA KHÔNG phủ LÁ — mỗi phân mảnh cần chốt riêng"*; cái giá (một phân mảnh mới ngoài migration chặn deploy) ghi ở ADR-028 §6. Một ca test mới đo cả bốn sự kiện |
| **H2** | Ba mục mới **khoá cứng `nspname = 'public'`** trong khi `bang_so`/`bang_al` cố ý phủ mọi schema — tái lập đúng thứ `[CR2a]` đã GỠ. Một bảng chỉ-ghi-thêm ở `app_private` sẽ UNLOGGED được, TRUNCATE được, nhận `GRANT UPDATE` sống qua mọi deploy | **ĐÓNG** — vế schema của `VI_TU_BANG_CHI_GHI_THEM` nay là `MAU_SCHEMA_DU_AN` khai triển, và test có một khẳng định đọc thẳng hằng ấy từ file rồi so (gộp khoảng trắng) nên hai bên không trôi khỏi nhau được. `CAU_COT_NGOAI_CHUOI` **cố ý giữ** hai tên đủ điều kiện `public.…` — cùng phạm vi và cùng lý do đã ghi cho `CAU_HINH_DANG_CHINH_TAC` của S0 — và giới hạn ấy nay nằm trong khối *"Giới hạn của H19"* ở `docs/TEST-PLAN.md` |

## Bốn MEDIUM

| Mã | Tóm tắt | Trạng thái |
|---|---|---|
| **M1** | Mục ACL suy-ra **chỉ đọc `relacl`**, không đọc `attacl` — tái tạo đúng lỗ `[M1]` mà `bang_so` đã phải vá. `GRANT UPDATE (canonical_text) ON bid_receipts TO app_api` sống qua mọi deploy; `canonical_text` là **chính chuỗi được ký** của biên nhận ⇒ chạm thẳng **B2** | **ĐÓNG** — thêm nhánh `attacl` (mức cột chỉ cấm UPDATE: `attacl` không lưu được DELETE/TRUNCATE, nên `relacl` là đầy đủ cho hai quyền ấy). Đột biến mức cột vào test: trước ⇒ `MIGRATE OK`, sau ⇒ NÉM kèm tên cột |
| **M2** | Vế *"có chốt TRUNCATE"* **không hỏi `tgenabled`** và không hỏi bit BEFORE ⇒ một `DISABLE TRIGGER` cho ra mục XANH trong khi `TRUNCATE` đi lọt hoàn toàn | **ĐÓNG** — thêm `tgenabled = 'A'`, bit BEFORE (`tgtype & 34 = 34`), và `prolang = plpgsql`. Đột biến cho **hai kết quả ĐÚNG KHÁC NHAU**: trên `bid_receipts` (có TÊN trong mục ghim `047`) hardening **tự chữa**; trên một phân mảnh SUY RA hardening **NÉM**. Cả hai đều được đo |
| **M3** | **ADR-028 §2⑵ mâu thuẫn với phép đo của chính ADR ấy**: §2⑵ viết *"chỉ TỰ CHỮA thứ một migration đánh số sở hữu theo TÊN"* trong khi §7⑷ đo `migrate()` bật RLS + FORCE trên `chi_nhanh` — một bảng không migration nào sở hữu. Và vế FK không đòi cột đích là `id`, trong khi `HINH_DANG_CHUAN` ghi cứng `(id = app_current_org_id())` | **ĐÓNG, HAI PHẦN.** ⑴ Câu §2⑵ **gạch bỏ tại chỗ** và viết lại: *tự chữa được phép trên tập suy ra khi hành động ĐƠN ĐIỆU và fail-closed; bị cấm khi nó đổi ngữ nghĩa*. Câu cũ sai **cả về mã cũ** — mục (A) đã tự chữa trên một tập suy ra từ S0. Trạng thái lai (lượt `sua` COMMIT riêng) nay được ghi ra. ⑵ Vế FK thêm `confkey → 'id'` |
| **M4** | `prosrc !~* '\mRETURN\M'` là so khớp VĂN BẢN: chiều ỒN ÀO — `prosrc` của hàm `LANGUAGE internal`/`c` là tên symbol, không chứa `RETURN` ⇒ bảng bị nhận nhầm ⇒ chặn deploy; chiều IM LẶNG — một hàm canh viết kiểu khác rơi khỏi tập | **ĐÓNG NỬA, và nửa kia có tên.** Chiều ồn ào: thêm `prolang = plpgsql` (đo: `suppress_redundant_updates_trigger` có `prosrc = 'suppress_redundant_updates_trigger'`, `lanname = 'internal'`). Chiều im lặng: **khoản nợ 60**, đã mở, kèm phép đo *"hai cách đếm hôm nay TRÙNG NHAU"* |

## Năm LOW

| Mã | Tóm tắt | Trạng thái |
|---|---|---|
| **L1** | `047` khai *"hardening ghim `tgenabled='A'` cho **mọi** trigger trong `public`"* — sai phạm vi: file ghim một tập được LIỆT KÊ theo tên | **ĐÓNG** — gạch bỏ tại chỗ, viết lại lý do đúng (*"ba trigger này có TÊN trong mục ghim `bid_chi_ghi_them (047)`"*) và ghi ra bậc tự do còn lại |
| **L2** | `047` kể phép đo sai chỗ: *"`relacl` của ba bảng chỉ mang `r` và `a`"* — `a` là quyền **CỘT**, nó ở `attacl` | **ĐÓNG** — tách hai cột catalog, gọi đúng tên từng cái |
| **L3** | Phản ví dụ chịu lực của vị từ được gọi là `rfq_items_chan_truncate`; tên thật là **`rfq_items_cam_truncate`** | **ĐÓNG** — sửa ở cả ba chỗ (hardening, test, ADR). Đo: `pg_trigger` trên `rfq_items` cho ra `rfq_items_cam_truncate`, `rfq_items_chi_sua_khi_soan`, `rfq_items_kiem_danh_tinh` |
| **L4** | `db/migrations.int.test.ts` giữ một bản sao đã trôi của `VI_TU_BANG_TENANT` (`OR relname = 'organizations'`) ⇒ ngày có bảng gốc thứ hai, vòng khôi phục không dựng policy cho nó và `migrate()` gãy vì lý do không liên quan | **ĐÓNG** — truy vấn đi theo vị từ FK mới; câu khẳng định cũ gạch bỏ tại chỗ |
| **L5** | Mục ACL suy-ra chỉ phán xét ⇒ một `GRANT` của kẻ có đặc quyền là một **DoS deploy không tự gỡ**, chặn cả bản vá khẩn | **ĐÓNG BẰNG CÁCH GHI RA** — đánh đổi cố ý, nay nằm ở ADR-028 §6 thay vì nằm im |

## Năm mục reviewer ĐÃ KIỂM và KHÔNG thấy vấn đề

1. **Trình tự nâng cấp của `047` trên cụm đang chạy — AN TOÀN, và reviewer truy được từng bước.** Trên cụm có 001–046: lượt `sua` #1 chạy trước vòng đánh số, tiền điều kiện `version = '047_…'` SAI ⇒ mục **nằm im** ⇒ thân hàm **không bị lùi**. Rồi 047 áp, rồi `sua` #2, rồi `phan_xet`. Cửa sổ ấy an toàn vì thân cũ (018) vẫn NÉM vô điều kiện — mất thông điệp `TG_OP`, không mất bảo vệ.
2. **Rollback ứng dụng về bản trước trong khi CSDL đã ở 047** — hardening cũ đưa thân hàm về bản 018; ba trigger TRUNCATE vẫn tồn tại và vẫn gọi hàm ấy ⇒ vẫn NÉM. Không có trạng thái vĩnh viễn hỏng. **Ràng buộc kéo theo: `hardening.always.sql` và `047` phải luôn đi CÙNG một commit** — đã ghi ở `Handoff.md`.
3. **Mục ACL mới không báo động giả** — `018:113-121`, `018:342-343`, `019:459-465`: ba bảng chỉ được cấp SELECT và INSERT **mức cột**. Không một `GRANT UPDATE/DELETE/TRUNCATE` nào. Mục mới khoá một cánh cửa đang đóng.
4. **Trigger TRUNCATE mới không chặn đường hợp lệ nào** — quét toàn kho: không mã sản phẩm, không `packages/test-support`, không test nào TRUNCATE ba bảng ấy.
5. **Không bí mật mới, không bề mặt injection mới** — ba mục mới có câu lệnh cưỡng chế là `SELECT 1`; tên role/cột trong thông điệp đi qua `quote_ident` và chỉ vào chuỗi lỗi. Và **không bẫy bí danh kiểu `[IM2]`** trong mã mới (bí danh dùng: `b`, `c`, `n`, `t`, `p`, `a`, `vai` — không cái nào trùng biến plpgsql của khối bao ngoài).

## Điều đáng mang sang vòng sau

**Một reviewer không chạy được gì vẫn tìm ra ba khiếm khuyết THẬT trong mã — và một trong ba là một câu của chính ADR mâu thuẫn với phép đo nằm cách nó vài trăm dòng.** M3 không đòi hỏi một cơ sở dữ liệu; nó đòi hỏi **đọc §2 và §7 của cùng một tài liệu rồi so chúng với nhau**. Đây là lần thứ hai trong ba vòng thứ đắt nhất đến từ một phép so nội bộ chứ không từ một công cụ.

**Và một câu sai theo hướng DỄ CHỊU khó tự bắt hơn một câu sai theo hướng khó chịu.** §2⑵ khen `migrate()` kỷ luật hơn thực tế. Không cổng nào đỏ vì một lời khen; chỉ có một người đọc chậm mới bắt được. Cùng họ với *"mười chín ADR"* và *"16/50"* — nhưng nguy hiểm hơn, vì hai cái kia là con số còn cái này là một **quy tắc mà vòng sau sẽ dựa vào**.

---

# S1.21 — review lượt 13: một vòng RÀ SỔ, và cái sổ tự khai sai chính nó

## Bảng

| Trường | Giá trị |
|---|---|
| Vòng | **S1.21** — rà lại sổ nợ S0, `[INV-H20]`, ADR-029; đóng khoản nợ **1, 5, 6, 7**, mở khoản nợ **61** |
| Nhánh | `ra-lai-so-no-s0`, cắt từ `8605a07` |
| Phạm vi | `tests/architecture/so-no-tu-doi-chieu.test.ts`, `docs/STATE.md` (bảng sổ nợ + mục 36 + §Tham chiếu), `docs/DECISIONS.md` ADR-028/029, `docs/TEST-PLAN.md`, `tools/inv-matrix/src/{danh-gia,parse}.ts`, `packages/identity/src/{session-actor,mfa-credentials,login}.ts`, `apps/api/src/{dispatch.ts,routes/auth.ts,auth.int.test.ts,composition.ts}`, `packages/outbox/src/{enqueue,runner}.ts`, `db/migrations/029`, `Handoff.md` |
| Trạng thái được review | **CÂY LÀM VIỆC CHƯA COMMIT.** Khác mọi lượt trước — chúng trỏ được tới một SHA *"trước lượt sửa"*, lượt này thì KHÔNG có: mọi phát hiện được sửa trước commit đầu tiên của nhánh. Ghi ra để không ai đi tìm một SHA không tồn tại |
| Môi trường của reviewer | **Read/Grep/Glob. KHÔNG Bash, KHÔNG cơ sở dữ liệu.** Reviewer nói rõ giới hạn ấy và kèm phép đo bác bỏ cho những phát hiện nó tự thấy có thể sai |
| Phát hiện | **0 CRITICAL, 3 HIGH, 7 MEDIUM, 6 LOW** |
| Kết quả | **3/3 HIGH và 7/7 MEDIUM đã xử lý; 6/6 LOW đã đóng.** Một HIGH đổi hình dạng của cả vòng: nó bác bỏ dấu `[ĐÓNG]` của khoản nợ 1 và sinh ra ADR-029 §2⑹ |

## Ba HIGH

| Mã | Tóm tắt | Trạng thái |
|---|---|---|
| **H13-1** | **Khoản nợ 1 được tuyên ĐÓNG dựa trên một lớp KHÔNG CÓ GÌ GIỮ.** `callerLimit` của `/auth/totp` là toàn bộ vế E3(2) trên đường TOTP; xoá đúng dòng ấy thì **không test nào đỏ** — hai test hạn mức đã có chỉ đo `/auth/link` và `/auth/redeem`, đối chứng của chúng gỡ cờ khỏi MỌI route ANON rồi vẫn chỉ đo `/auth/redeem` | **ĐÓNG bằng HAI lớp:** test tích hợp `429 + Retry-After` trên `/auth/totp` (32 lời gọi HTTP thật, 37 s) + phép kiểm TĨNH *mọi route ANON khai `callerLimit`* trong `timViPhamBangRoute`, mũi đột biến gỡ cờ của **từng** route ANON. Nay là **ADR-029 §2⑹** |
| **H13-2** | `evidence/INV-matrix.md` chưa sinh lại ⇒ artefact đưa cho kiểm toán viên vẫn khai một biện pháp kiểm soát **KHÔNG tồn tại** (*"đường TOTP VẪN KHÔNG CÓ giới hạn tần suất nào"*), cộng ba con số lệch với mốc đã ghim | **ĐÓNG** — sinh lại trong cùng commit; cổng `evidence:check` so byte |
| **H13-3** | **Bộ đọc của chính lớp mới bỏ sót dòng TRONG IM LẶNG** — một dòng nợ thụt vào **một dấu cách** (GFM cho phép tới ba) rơi khỏi P1, P2, P4 mà P3 vẫn xanh ⇒ một khoản nợ MỞ vô hình với chính lớp canh sổ nợ | **ĐÓNG bằng P0** (mọi hàng bảng phải được bộ đọc NHẬN) + mũi đột biến khẳng định luôn *bốn phép kiểm kia KHÔNG thấy gì* |

## Bảy MEDIUM

| Mã | Tóm tắt | Trạng thái |
|---|---|---|
| **H13-4** | `docs/STATE.md` bảng *Tham chiếu* khai *"Sổ đăng ký 51 bất biến (34 + 17)"*, sổ có **54 (34 + 20)** — cách lời khai số ADR đúng MỘT hàng bảng, và P5 không đọc nó | **ĐÓNG bằng P6** (nguồn: số HÀNG của sổ đăng ký) — ĐỎ ngay lượt đầu |
| **H13-5** | Câu của khoản nợ 7 còn sống nguyên văn ở `docs/STATE.md:122` (trong đúng tệp lớp mới đọc) và `Handoff.md` §13 (*"22 khoản nợ"*, sửa một chỗ bỏ một chỗ trong cùng vòng) | **ĐÓNG** — gạch cả hai, giữ nguyên chữ |
| **H13-6** | `packages/outbox/src/runner.ts` còn khai *"`apps/` còn rỗng"* — bản sao thứ TƯ, trong mã sản xuất | **ĐÓNG** |
| **H13-7** | Trong đúng khối chú thích vòng này vừa sửa, câu THỨ HAI vẫn thiu: *"trigger ép điều đó ở tầng CSDL là S1.10.4"* — trigger `sessions_kiem_mfa_khi_tao` có từ `029` | **ĐÓNG** (chiều sai là BI QUAN — khai ít lớp hơn số lớp thật) |
| **H13-8** | `viPhamSoADR` bóc `~~…~~` trên toàn tệp: một dấu `~~` LẺ dời mọi cặp phía sau ⇒ một lời khai đang sống rơi vào khoảng bị xoá ⇒ **xanh trên đúng tệp đang sai**. Và vị từ chỉ đọc số viết bằng CHỮ | **ĐÓNG** — số dấu `~~` phải CHẴN (mũi đột biến riêng), vị từ đọc cả chữ số, và câu ở TEST-PLAN/ADR hạ xuống ĐÚNG hai hình dạng đã nêu tên |
| **H13-9** | Cửa `~~` của P4 dùng được để **làm im** một con trỏ chết: gạch nó đi là xong, cổng vẫn xanh. Đo: ô con trỏ khoản 11 sau khi bóc gạch không còn đường nào | **ĐÓNG** — ô đã gạch một con trỏ thì phải còn ít nhất một con trỏ SỐNG; ĐỎ ngay lượt đầu ở đúng dòng 11 |
| **H13-10** | Khoản nợ 5 đóng bằng một bảo đảm CÓ ĐIỀU KIỆN (RLS không áp cho phiên không chịu RLS) mà điều kiện không đi kèm | **ĐÓNG** — điều kiện ghi vào dòng nợ, kèm lớp thứ ba giữ nó (`NOBYPASSRLS` + BƯỚC 1 của hardening, đo ở S1.20) |

## Sáu LOW

| Mã | Tóm tắt | Trạng thái |
|---|---|---|
| **H13-11** | `join(GOC, "../../…")` xác thực bằng hệ thống tệp NGOÀI worktree ⇒ phép kiểm phụ thuộc máy | **ĐÓNG** — `resolve` + kiểm chứa |
| **H13-12** | `new RegExp` dựng từ chuỗi trong tài liệu: một tên bắt đầu bằng `?` NÉM `SyntaxError` giữa bộ test. (Reviewer tự bác mức cao: lượng tử duy nhất sinh ra là `.*`, chuỗi đối tượng ≤ 255 ký tự ⇒ không có ca hàm mũ) | **ĐÓNG** — `?` được thoát, và lỗi quy về một vi phạm có tên |
| **H13-13** | Số khoản không bắt buộc DUY NHẤT ⇒ hai dòng cùng số đi qua P3 sạch sẽ | **ĐÓNG** — một dòng, một mũi đột biến |
| **H13-14** | Tám câu tổng kết sai bị CHÈN một dấu vào giữa thay vì bị GẠCH — chính vòng này làm sai quy ước *"gạch tại chỗ, giữ nguyên văn"* của kho | **ĐÓNG** — gạch cả tám câu, nguyên văn |
| **H13-15** | Sổ ghi của `MOC_GHIM` dừng ở S1.18 trong khi hằng số đã nhảy hai nhịp — đúng lớp lỗi ADR-029 đặt tên, ở ngay tệp cưỡng chế mốc | **ĐÓNG** — hai dòng lý do |
| **H13-16** | Giả định *"tài liệu là dữ liệu tin cậy"* chưa được cưỡng chế: `CODEOWNERS` trỏ tới team chưa tồn tại (khoản nợ 18) ⇒ không branch protection nào bắt buộc review trên `docs/` | **ĐÓNG bằng cách NÓI RA** — ADR-029 §5 và giới hạn của H20 ở TEST-PLAN |

## Ba mục reviewer ĐÃ KIỂM và KHÔNG thấy vấn đề

- **Bộ test có ghi vào cây nguồn không (khoản nợ 59 tái diễn)?** KHÔNG. Tệp chỉ nhập `existsSync`, `readdirSync`, `readFileSync`; không `writeFileSync`, không `spawn`. Mọi đột biến là phép biến đổi trên chuỗi trong bộ nhớ, và lời tuyên bố ở khối đầu khớp với mã.
- **Các mũi đột biến có chạy đúng hàm mà phép kiểm thật chạy không?** CÓ, không có bản sao logic nào trong test; `dotBien` NÉM khi neo khớp ≠ 1, nên một mũi trượt không âm thầm thành xanh.
- **Hai chú thích sửa trong mã sản xuất có nói đúng thứ mã đang làm không?** CÓ — reviewer kiểm từng vế tới tận hằng số (`LOGIN_TOTP_MAX_PER_CALLER = 30`, cưỡng chế ở `dispatch.ts:297-313`, bảng `caller_rate_limits` của `042`, cửa sổ 900 s) và tới tận dòng (`login.ts:228`, `auth.ts:184`). Tiêu đề ADR-028 sửa đúng, nguyên văn cũ giữ lại.

## Điều đáng mang sang vòng sau

**"ĐÓNG" nghĩa là CÓ LỚP GIỮ, không phải CÓ CÀI ĐẶT** (ADR-029 §2⑹). Đây là lượt review đầu tiên
bác bỏ một dấu *đã đóng* không phải vì mã sai mà vì **không có gì giữ mã ấy đúng** — một hàng rào
thật, cưỡng chế thật, mà xoá một dòng thì bộ test vẫn xanh. Vòng rà nào cũng nên hỏi câu ấy trước
khi đánh dấu.

**Và một lớp canh mới phải bị hỏi đúng câu nó dùng để hỏi người khác.** Ba HIGH/MEDIUM của lượt
này — bộ đọc bỏ sót dòng, cửa `~~` làm im con trỏ chết, cửa `~~` bóc mất lời khai — đều là *chính
khiếm khuyết mà lớp ấy ra đời để bắt*, tái tạo bên trong lớp ấy.

---

# S1.22 — review lượt 14: khoản nợ 8, và bốn HIGH nói về chính LỚP CANH

## Bảng

| Trường | Giá trị |
|---|---|
| Vòng | **S1.22** — đóng khoản nợ 8 (ADR-030, `[INV-H21]`); mở khoản nợ 62 và 63 |
| Nhánh | `qt3-lop-may`, cắt từ `4caea39` |
| Phạm vi | `tests/architecture/qt3-{ghim-schema.test,ngu-phap.int.test,tu-vung,doc-sql}.ts`, và 13 câu SQL đã ghim ở `packages/{unseal,invitation,identity,bidding,rfq,tenancy}/src` |
| Trạng thái được review | **CÂY LÀM VIỆC CHƯA COMMIT** (như lượt 13). Không có SHA *"trước lượt sửa"* |
| Môi trường của reviewer | **Read/Grep/Glob. KHÔNG Bash, KHÔNG chạy được `git diff`, KHÔNG cơ sở dữ liệu.** Reviewer nói rõ giới hạn ấy ở dòng đầu và đánh dấu chỗ nào kết luận phụ thuộc vào bản trước |
| Phát hiện | **0 CRITICAL, 6 HIGH, 8 MEDIUM, 5 LOW** |
| Kết quả | **6/6 HIGH, 8/8 MEDIUM, 5/5 LOW đã xử lý.** Bốn HIGH nói về LỚP CANH chứ không về mã; một HIGH (H14-6) không thuộc QT3 và là phát hiện nặng nhất lượt |

## Sáu HIGH

| Mã | Tóm tắt | Trạng thái |
|---|---|---|
| **H14-1** | `khoangSet()` miễn TOÀN BỘ toán tử trong mệnh đề `SET`, không chỉ dấu `=` gán — và khi không có `WHERE` theo sau (`ON CONFLICT DO UPDATE SET …`) khoảng ấy kéo tới hết câu. Hình dạng thật đang tồn tại: bộ đếm khoá E3 (`SET failed_attempts = c.failed_attempts + 1, locked_until = CASE WHEN … >= $2 …`) sẽ đi qua **trong im lặng** ngay khi tên bảng của nó được ghim | **ĐÓNG** — chỉ dấu `=` ĐẦU TIÊN ở độ sâu ngoặc 0 của mỗi mục `SET` được miễn; hai mũi đột biến, một cho ca có `WHERE`, một cho ca không |
| **H14-2** | SQL nối bằng `+`: **chỉ mảnh ĐẦU được đọc**. Bốn ca trong mã sản xuất, hai là đường an ninh — `audit/writer.ts` (đường ghi DUY NHẤT của sổ kiểm toán: `FROM public.audit_append(…)` ở mảnh 2), `tenancy/with-tenant.ts` (cổng phiên khách: `JOIN`/`WHERE`/`expires_at` ở mảnh 2-6), `unseal/requests.ts` (vế `org_id = $4` của lần điều phối) | **ĐÓNG** — bộ đọc thành BỘ TÁCH TỪ một lượt, ghép hằng chuỗi liền kề nối `+`; kèm một test riêng đòi thấy được câu ghi sổ kiểm toán. Đóng luôn hai lỗ nhỏ hơn: chuỗi nháy đơn (M7) và `//` bên trong hằng chuỗi (L4) |
| **H14-3** | Vế `search_path` chỉ khớp `SET search_path`, bỏ lọt `SET LOCAL`, `SET SESSION`, `set_config('search_path', …)` — trong khi `SET LOCAL` và `set_config` là khuôn ĐANG DÙNG của chính kho | **ĐÓNG** — kiểm theo *"câu có nhắc `search_path` không"*, đọc SQL GỐC (tên nằm trong hằng chuỗi); đối chứng dương ba cú pháp |
| **H14-4** | `TU_KHOA` miễn `unnest`, `generate_series`, `left`, `right` — **bốn hàm THẬT** của `pg_catalog`. Mã sản xuất thì GHIM `unnest` (`vai-tro.ts`), tức lớp canh và mã nguồn nói ngược nhau | **ĐÓNG** — tách hai danh sách theo vị trí cú pháp, và cả ba nay bị `pg_proc` + `pg_get_keywords()` phán xét |
| **H14-5** | Câu trên đường ra QUYẾT ĐỊNH AN NINH còn trần **trong chính những tệp vòng này chạm**: bộ đếm khoá E3, hai câu tiêu thụ dùng-một-lần, TTL phiên khách, cổng phiên khách của đường nộp báo giá, chính sách đang hiệu lực, cạnh `PENDING → APPROVED` | **ĐÓNG** — ghim cả bảy trong vòng này, không để vào sổ nợ 62 |
| **H14-6** | **Không thuộc QT3, và nặng nhất lượt.** `UNIQUE (org_id, email)` so NGUYÊN VĂN; `issueLoginToken` tra `lower(email)` không `LIMIT`, lấy `rows[0]`, rồi trả lại **chuỗi người gọi gửi lên** — `outbox-api.ts` gửi magic link tới đúng chuỗi ấy. Với một cặp biến thể hoa-thường trong cùng tổ chức, xin link cho `alice@corp.com` có thể phát token của `Alice@corp.com` và gửi tới hộp thư của người xin | **ĐÓNG vế chiếm tài khoản** — hàm trả `u.email` đọc từ CSDL. Phần chênh còn lại (`UNIQUE (org_id, lower(email))`, một migration) là **khoản nợ 63**. Reviewer tự xếp HIGH chứ không CRITICAL vì tiền đề (hai hàng biến thể) chưa dựng được từ bên trong sản phẩm |

## Tám MEDIUM

| Mã | Tóm tắt | Trạng thái |
|---|---|---|
| **M1** | Miễn trừ `search_path` theo TỆP, và lý do chỉ được đo bằng `lyDo.length > 40` — tức mệnh đề chịu lực không được kiểm bởi bất cứ gì | **ĐÓNG** — khẳng định thẳng VĂN BẢN: mọi câu được miễn phải KHÔNG nêu `pg_catalog` |
| **M2** | `RE_HAM`/`RE_EP_KIEU` thiếu cờ `i` ⇒ `NOW()`, `$1::UUID` không bị bắt | **ĐÓNG** + test cho ca chữ hoa |
| **M3** | Trục ép kiểu bỏ sót `CAST(x AS t)`; trục toán tử thiếu `~ !~ ~* \| & ^ #` | **ĐÓNG** — thêm cả hai, kèm test |
| **M4** | `RE_BANG` bỏ sót `USING`/`ONLY`/DDL, và sẽ báo NHẦM tên CTE là bảng chưa ghim | **ĐÓNG** — thêm vị trí, thu thập tên CTE và loại chúng |
| **M5** | Bộ đọc phụ thuộc chỉ mục git (tệp chưa `git add` là vô hình), và hai sàn quá lỏng | **ĐÓNG một nửa** — sàn đóng đinh sát số đo (148/27); vế "chưa `git add`" ghi ra ở ADR-030 §4, và chính vòng này gặp nó |
| **M6** | `TRAN_TOI_DA` được chép từ số đo TRƯỚC vòng ⇒ có thể cho không một khe hở | **ĐÓNG** — đo lại trên HEAD sau lượt ghim: **80** |
| **M7** | SQL viết bằng nháy đơn không bao giờ được đọc, và không lint nào cấm nháy đơn | **ĐÓNG** — bộ tách từ đọc cả ba kiểu dấu nháy |
| **M8** | Phạm vi loại trừ `.sql` không được nói ra | **ĐÓNG** — ghi ở khối đầu tệp và ADR-030 §5, kèm lý do đo được |

## Năm LOW

| Mã | Tóm tắt | Trạng thái |
|---|---|---|
| **L1** | Số liệu trong tiêu đề (19) mâu thuẫn với brief (13) | **ĐÓNG** — 13 là số sau khi bỏ chú thích TypeScript |
| **L2** | `position` bị bác bỏ nhưng không có răng | **ĐÓNG** — vào danh sách răng |
| **L3** | Đối chứng dương dùng `String.replace` với chuỗi có thể không tồn tại | **ĐÓNG** — khẳng định neo CÓ MẶT trước khi thay |
| **L4** | `boChuThich` cắt `//` bên trong hằng chuỗi | **ĐÓNG** bởi bộ tách từ |
| **L5** | `RE_KHOA_SQL` thiếu `DROP`, `MERGE`, `COPY`, `CALL`, `LOCK`, `EXPLAIN` | **ĐÓNG** |

## Bốn mục reviewer ĐÃ KIỂM và KHÔNG thấy vấn đề

- **Ngữ nghĩa SQL có đổi không:** không tìm thấy ca nào trong 13 câu. Reviewer rà mọi chỗ có hai toán tử ghim cùng cấp và xác nhận cả sáu đã đóng ngoặc đúng; ép kiểu thêm vào không đổi kế hoạch (`db/migrations` **không có** `CREATE TYPE`/`CREATE DOMAIN` nào, nên `OPERATOR(pg_catalog.=)` có đúng một ứng viên); `pg_catalog.lower(email)` không mất chỉ mục nào — trình phân tích lưu `funcid` ĐÃ phân giải, và bảng `users` cũng không có chỉ mục biểu thức nào.
- **Tiêm SQL qua nội suy `${}`:** mọi chỗ nội suy là hằng đóng; `SET ROLE ${vai}` được chặn bằng danh sách đóng cộng một lần kiểm `current_user`.
- **Bí mật vào log:** kỷ luật nhất quán ở `withTenant`, `gate.ts`, `procurement-policy.ts`.
- **Một tính chất tôi đang dựa vào mà chú thích chưa nói:** `OPERATOR(…)` thuộc nhóm *"any other operator"*, **cao hơn** `< > = <= >= <>`, `IS`, `NOT`, `AND`, `OR` — nhờ đó các biểu thức `IS NOT NULL AND … OPERATOR(>) …` vẫn nhóm đúng. Cảnh báo ở `login.ts` chỉ đúng cho cặp hai OPERATOR() cùng cấp.

## Điều đáng mang sang vòng sau

**Một lớp canh mới là MÃ MỚI, và nó phải chịu đúng câu hỏi nó dùng để hỏi người khác.** Bốn trong
sáu HIGH của lượt này nói về lớp canh: nó không tạo được lượt ĐỎ cho ba hình dạng nó tuyên bố
canh. Theo quy ước của kho, hàng rào ở trạng thái đó phải sửa hoặc gỡ.

**Và một lớp canh đòi một cách viết thì phải kiểm rằng cách viết ấy HỢP LỆ.** `::pg_catalog.int`
không tồn tại; lớp canh đòi `::pg_catalog.<t>` mà không kiểm `pg_type` sẽ dạy người ta viết đúng
cái sai ấy — và chỉ T3 bắt được, sau khi một route đã trả 500 thay vì 401.


---

# §S1.24 — review an ninh lượt 15 (khoản nợ 62: ghim đủ bốn trục cho 63 câu còn lại)

**Phạm vi:** 12 tệp sản xuất mà bộ ghim tự động viết lại, so với `origin/master` = `764c082`.
**Chủ đề đặt cho reviewer:** năm mục hẹp — SQL hỏng cú pháp do bộ ghim, ghim sai địa chỉ, tên kiểu
không tồn tại, đổi nghĩa, và chạm đường ra quyết định an ninh.

## Bảng

| Mức | Số | Nội dung |
|---|---|---|
| **HIGH** | **20 câu SQL hỏng** | 10 gán `SET` bị ghim · 6 văn bản nhân đôi · 2 `extract` dạng ngữ pháp · 2 đổi cây phân tích |
| MEDIUM | 2 | bộ dọn `caller_rate_limits` chết (DoS nếu sửa đường ghi mà quên đường dọn); bảng so sánh sau mở thầu ném |
| LOW | 1 | chú thích `migrate.ts` nay sai: `SELECT`/`INSERT` đã ghi schema mà `CREATE TABLE` thì chưa |

**Ba mục reviewer ĐÃ KIỂM và KHÔNG thấy vấn đề:** ghim sai địa chỉ (`public.` ↔ `pg_catalog.`) —
không thấy; tên kiểu không tồn tại — không thấy (`::pg_catalog.int4` viết đúng); `IS NOT DISTINCT
FROM` bị thay bằng `=` — không thấy.

## Điều đáng mang sang vòng sau

**Một bộ sửa TỰ ĐỘNG cần một bộ kiểm ĐỘC LẬP, và "đọc lại bản đề xuất" không phải bộ kiểm ấy.**
Lượt đọc lại của tôi bắt được 3 lỗi trước khi áp và 1 sau khi áp; nó bỏ sót **20**. Cái bắt được
cả 20 trong một phép đo là `PREPARE` từng câu trên PostgreSQL thật — hạ tầng cho nó (`moiCauSql()`
+ `withMigratedDatabase`) đã nằm sẵn trong kho từ trước.

**Một lỗi lệch-một-đơn-vị trong một bộ sửa hàng loạt không hỏng một chỗ — nó hỏng mười chỗ.** Bộ
ghim quên tăng độ sâu ngoặc khi nuốt dấu `(` của một lời gọi hàm; mọi phép kiểm phụ thuộc độ sâu
tắt từ đó tới hết câu. Khi viết một bộ sửa hàng loạt, **trạng thái của nó phải có đối chứng riêng**,
không được chỉ kiểm đầu ra.

**Và một điều về thứ tự:** cả 20 lỗi đều làm đường **đóng cứng**, không fail-open. Đó là may chứ
không phải thiết kế.

# §S1.25 — review an ninh lượt 16 (khoản nợ 24, 59, 65: độ tin cậy của chính cái lưới)

**Phạm vi:** 9 tệp của `git diff origin/master...HEAD`, so với `origin/master` = `adb2f9a`.
**Chủ đề đặt cho reviewer:** ba mục hẹp — `do-lap.yml` (tiêm `$GITHUB_OUTPUT`, tiêm biểu thức
`${{ }}`, lạm dụng `issues: write`, rò rỉ bí mật qua thân issue), `khoa-depcruise.ts` (symlink,
giành trước tên, khoá cũ, tiến trình chết giữa chừng), và `migrate.int.test.ts` (vòng chờ mới có
làm YẾU khẳng định không).

## Bảng

| Mức | Số | Nội dung |
|---|---|---|
| CRITICAL / HIGH | **0** | — và ba đường nghi nhất đều SẠCH: không `${{ }}` nào nội suy thẳng vào `run:` (mọi giá trị đi qua `env:`); thân issue chỉ mang `%s` đã trích dẫn, không `eval`; trigger chỉ `schedule` + `workflow_dispatch`, nên **không có đường nào cho người ngoài chạy workflow hay nhét dữ liệu vào** |
| **MEDIUM** | **3** | **M1** vòng quay VÔ HẠN trong khoá (không hạn, không ngủ, chặn event loop) · **M2** hạn chờ 15 s vượt `idleTimeoutMillis` 10 s của pool · **M3** token `issues: write` nằm cùng job với `pnpm install` |
| LOW | 7 | L1 tiêm khoá `$GITHUB_OUTPUT` · L2 chuyển hướng issue báo động · L3 đường khoá đoán được trong `/tmp` · L4 `HAN_CHO_MS` < `HAN_KHOA_MS` · L5 log ra artifact vòng qua cơ chế che bí mật · L6 `dot_bien` che tỷ lệ đỏ THẬT · L7 `so_luot` không cận trên |
| INFO | 6 | export chết · không chống tái nhập · nội suy định danh SQL · ranh giới import mới (đã kiểm: SẠCH) · quét bí mật toàn kho (SẠCH) · thân issue không rò môi trường (SẠCH) |

**Đã xử trong vòng này: M1, M2, M3, L1, L2, L4, L5, L6, L7, và 3 mục INFO** (export chết, chống
tái nhập, `pg.escapeIdentifier`). **Còn lại thành khoản nợ 67**: tách `do-lap.yml` làm hai job để
không bước nào vừa cầm token ghi vừa chạy mã bên thứ ba — một cuộc tái cấu trúc, không phải một
dòng sửa.

## Mỗi bản vá đi kèm một lượt ĐỎ THẬT

| Vá | Mũi đột biến | Kết quả |
|---|---|---|
| M1 ném lỗi khác `EEXIST` | gỡ dòng `throw e` | **ĐỎ 1/6** — *"đường khoá KHÔNG DÙNG ĐƯỢC ⇒ NÉM NGAY"* |
| L4 + ⑶ hỏi chủ khoá còn sống | `laKhoaRac` chỉ nhìn đồng hồ | **ĐỎ 1/6** — *"tiến trình ĐÃ CHẾT bị thu hồi NGAY"* |
| ⑶ chiều âm | `laKhoaRac` luôn trả `true` | **ĐỎ 2/6** — kể cả phép nối tiếp gốc |
| nhả khoá theo PID | nhả vô điều kiện | **ĐỎ 1/6** — *"KHÔNG xoá khoá mà người khác đã giành lại"* |
| chống tái nhập | gỡ chặn | **ĐỎ 1/6** — *"gọi LỒNG không tự khoá chết chính mình"* |
| L1 dấu phân cách ngẫu nhiên | chạy lại bản `echo "khoá=giá-trị"` với `dot_bien` mang ký tự xuống dòng | bản **CŨ**: `so_do` bị ghi đè thành `0` ⇒ **bước báo động BỊ TẮT** dù tỷ lệ đỏ thật khác 0; bản **VÁ**: giá trị nằm trọn trong heredoc, `so_do` giữ nguyên |
| L6 tách số đỏ thật / giả | chạy khối lệnh báo động thật với `gh` giả, 3 tình huống | `dot_bien=true` + 0 đỏ thật ⇒ tiêu đề *"KHÔNG phải một phép đo"*; `dot_bien=true` + **2 đỏ thật** ⇒ tiêu đề **báo động thật** kèm một dòng nói rõ có mũi đo |

## Điều đáng mang sang vòng sau

**⑴ MỘT LỚP CANH DỰNG ĐỂ CHỐNG TREO MÀ BẢN THÂN NÓ TREO ĐƯỢC.** M1 là `continue` trong một `catch`
nhảy vượt **cả** kiểm tra hạn **cả** giấc ngủ. Chú thích ngay bên trên viết *"một lượt treo im lặng
còn tệ hơn một lượt đỏ, nên chỗ này NÉM"* — và có một đường đi tới đúng chỗ ấy mà không bao giờ
ném. Đường kích hoạt **không cần kẻ tấn công**: một `TMPDIR` trỏ vào thư mục đã bị dọn là đủ. Quy
tắc rút ra: **trong một vòng lặp chờ, kiểm tra hạn phải là câu lệnh ĐẦU TIÊN của mọi nhánh lỗi, và
không nhánh nào được thoát mà không đi qua giấc ngủ.**

**⑵ HẠN THEO ĐỒNG HỒ LÀ MỘT PHỎNG ĐOÁN; "CHỦ CÒN SỐNG KHÔNG" LÀ MỘT SỰ KIỆN.** Câu hỏi *"khoá này
già hơn 300 giây chưa"* sai cả hai chiều cùng lúc: nó **giết khoá đang sống** của một lượt cruise
chậm, và nó **giữ khoá đã chết** của một lượt bị `Ctrl-C` đủ lâu để đầu độc 2 phút kế tiếp.
`process.kill(pid, 0)` trả lời đúng câu hỏi cần hỏi. Đồng hồ tụt xuống làm lưới đỡ cho một khe
micro-giây, và vì thế `HAN_KHOA_MS` phải **nhỏ hơn** `HAN_CHO_MS`.

**⑶ MỘT KHẲNG ĐỊNH CÓ THỂ HỎNG VÌ MỘT CON SỐ Ở TỆP KHÁC.** M2: hạn chờ 15 s vượt
`idleTimeoutMillis` mặc định **10 s** của `pg.Pool`, nên `pg-pool` tự dọn client rảnh trước khi
vòng chờ hết hạn — khẳng định thôi đo mã dưới test và quay ra đo cơ chế thu hồi của thư viện. Cái
bẫy ấy **đã được ghi ra trong chính tệp đó**, cách 60 dòng, cho một khẳng định khác. Viết ra một
bài học không làm nó tự áp dụng cho dòng tiếp theo.

**⑷ HAI LẦN TRONG MỘT VÒNG, BỘ ĐO CỦA TÔI ĐO KHÔNG CÁI GÌ VÀ BÁO "XANH".** Lượt đột biến đầu lọc
test bằng chuỗi **không dấu** ⇒ khớp 0 test ⇒ vitest bỏ qua cả 6 và thoát 0 ⇒ 5/5 mũi báo "xanh".
Lượt đo L1 đầu có phép thay chuỗi không khớp nên **cả hai vế đều chạy bản mới**, cộng một biến môi
trường mang ký tự xuống dòng **không đi qua nổi Windows**. Cả hai lần, kết quả "an toàn" là kết
quả của một phép đo chưa chạy. Quy tắc: **mọi harness đột biến phải FAIL-CLOSED** — khai số phép đo
kỳ vọng, đối chứng bản không đột biến trước, và ném khi số thực tế lệch.

# §S1.26 — review an ninh lượt 17 (khoản nợ 2 và 66: một ngưỡng đo nhầm đại lượng)

**Phạm vi:** `git diff origin/master...HEAD` giới hạn ở `packages` + `apps`, so với `origin/master`
= `7dfd552`.
**Chủ đề đặt cho reviewer:** sáu mục hẹp trên khoản nợ 2 — đường đi vòng cổng mới, oracle ở nhánh
`rowCount = 0`, lật mã lỗi ở ca *hồ sơ đang khoá + mã sai hình dạng*, khoá hàng sống tới `COMMIT`
(deadlock và DoS), vế `locked_until` bị gỡ khỏi `CAU_DAT_KHOA`, và QT3 — cộng một câu hỏi cho
khoản 66: lớp mới có YẾU HƠN về AN NINH không.

## Bảng

| Mức | Số | Nội dung |
|---|---|---|
| CRITICAL / HIGH | **0** | Reviewer dựng thử ba đường HIGH (bỏ qua `CAU_DAT_COC`, oracle mới ở nhánh `rowCount = 0`, ghi đè khoá đang hiệu lực) và **cả ba đều đóng** |
| **MEDIUM** | **1** | **M-1** lập luận DoS thiếu hạng **HÀNG ĐỢI POOL**, và đó là hạng CHỊU LỰC |
| LOW | 5 | L-1 `CAU_DAT_KHOA` an toàn nhờ THỨ TỰ LỜI GỌI chứ không nhờ chính câu lệnh · L-2 cọc lấy theo `id` nhưng đọc lại theo `(org_id, user_id)` · L-3 nhánh `CODE_ALREADY_USED` tiêu cọc mà bỏ phép so ngưỡng · L-4 mã sai hình dạng là phép dò trạng thái khoá miễn phí (**có từ trước**, vòng này không làm tệ hơn) · L-5 `MFA_LOCKED` ghi trong cùng giao dịch giữ khoá hàng |
| INFO | 6 | không đường đi vòng cổng (`moPhongBiVaSo` có **đúng một** call site) · nhánh mới không mở oracle ở tầng HTTP · **không chu trình chờ** (đã đọc mọi trigger trên `mfa_credentials`) · QT3 đủ bốn trục và `OPERATOR()` không đổi cây phân tích · khoản 66 **không yếu hơn** về an ninh · vụn đã có tài liệu |

**Đã xử trong vòng này: M-1, L-1, L-2, L-3, và I-5.** **Còn lại thành khoản nợ 69** (rút ngắn đoạn
giữ khoá — gồm cả L-5). **L-4 không xử**: nó là một quyết định ADR (đảo `MALFORMED_CODE` lên trước
`dang_khoa` sẽ phá tính chất *"hồ sơ đang khoá chỉ trả về đúng một câu trả lời"* vốn là chủ ý), và
nó **có từ trước vòng này**.

## Hai chỗ LỜI KHAI CỦA VÒNG NÀY rộng hơn thứ đo được — và đó là phần đáng giá nhất

**⑴ M-1 — *"đứng trên ba con số đã có lớp"* bỏ sót hạng chịu lực nhất.** Ba GUC (`lock_timeout`,
`statement_timeout`, `idle_in_transaction_session_timeout`) chặn **thời gian một phiên**; không
cái nào chặn **số kết nối bị ghim**. `createPool` không đặt `connectionTimeoutMillis`, mà mặc định
của `pg-pool` là `0` — hàng đợi `pool.connect()` **vô hạn**, và `server.requestTimeout` chỉ huỷ
socket chứ không huỷ promise đang treo. Vì bản vá **tuần tự hoá** các request chồng nhau, tổng
thời gian rút cạn pool đi từ ≈ 1× độ trễ cổng lên ≈ `min(đồng thời, ngưỡng)` lần. Với `dbPoolMax`
mặc định **10**, một người dùng hợp lệ bắn 10 lượt `/auth/totp` đồng thời cho **chính hồ sơ mình**
chạm được tới người của **tổ chức khác**. Đây là **khuếch đại do vòng này tạo ra**. Đã vá:
`connectionTimeoutMillis = 20 s` (lớn hơn `lock_timeout` 15 s, để người chờ vẫn chết bằng 55P03
với thông điệp đúng của nó), và hạng thứ tư được viết vào chính khối lập luận.

**⑵ I-5 — khối chú thích của khoản 66 nói như thể vai *trần trên* đã bị gỡ khỏi cả tệp.** Nó bị gỡ
ở **hai** test có vòng lặp 300 lượt; `:546` và `:768` vẫn là ngưỡng tuyệt đối kiểu *"phải nhanh"*.
Đã ghi phạm vi chính xác.

## Điều đáng mang sang vòng sau

**⑴ MỘT BẢN VÁ ĐÚNG VẪN ĐỔI HÌNH DẠNG TẢI, VÀ LẬP LUẬN AN TOÀN PHẢI THEO KỊP.** Khoản 2 không
thêm khoá tường minh, không thêm round trip, không nới cổng nào — nhưng nó đổi **song song** thành
**tuần tự**, và một hạng vốn vô hại (hàng đợi pool) thành hạng chịu lực. Khi một bản vá đổi hình
dạng đồng thời, **danh sách các cận trên phải được liệt kê lại từ đầu**, không phải kế thừa.

**⑵ "AN TOÀN NHỜ THỨ TỰ LỜI GỌI" KHÔNG PHẢI MỘT TÍNH CHẤT CỦA CÂU LỆNH.** `CAU_DAT_KHOA` không
bao giờ gặp một `locked_until` đang hiệu lực — đúng, nhưng đúng vì một lý do nằm NGOÀI câu lệnh.
Vế phòng thủ được khôi phục **kèm lời khai rằng không mũi đột biến nào làm nó đỏ được**, nên nó
không được kể là một lớp canh. Ghi cả hai vế là cách duy nhất để nó vừa có ích vừa không nói dối.

**⑶ CẶP NGOẶC ĐẮT NHẤT CỦA VÒNG KHÔNG CÓ MỐC CHẾT NÀO CANH.** Reviewer chỉ ra: nếu vế
`(locked_until IS NULL OR ... <= clock_timestamp())` trong `WHERE` của `CAU_DAT_COC` **không** được
đóng ngoặc, `A AND B AND C OR D` phân tích thành `(A AND B AND C) OR D` — cổng mở toang cho mọi
hàng. Cặp ngoặc có mặt, và `PREPARE` không bắt được lỗi ấy vì nó hợp lệ về cú pháp. Thứ bắt được
nó là phép đo `soLanMoCong` — nhưng chỉ vì test dựng đúng ca đồng thời.

# §S1.27 — soi đối kháng lượt 18 (khoản nợ 63: `users.email` chỉ ở chữ thường)

**Phạm vi:** `db/migrations/048_email_nguoi_dung_chu_thuong.sql`, `packages/identity/src/login.ts`,
`db/unique-oracle.int.test.ts`, so với `origin/master` = `ef51f22`.
**Hình thức:** ba lăng kính độc lập chạy song song — *an ninh*, *có đóng được nợ thật không*,
*phá gì và khai rộng ở đâu*. Cả ba đều kết luận **CHƯA ĐỦ**.

## Bảng

| Mức | Số | Nội dung |
|---|---|---|
| CRITICAL / HIGH | 0 | — |
| **NẶNG** | **6** | Toàn bộ là **lời khai của chính vòng này rộng hơn phép đo**, và một trong số đó là một **lỗ MỚI do bản vá tạo ra** |
| NHẸ / INFO | 5 | `ALTER` giữ `ACCESS EXCLUSIVE` dưới `lock_timeout = 0` · các vụn đã có tài liệu |

## Phát hiện nặng nhất: bản vá đầu TẠO RA một cửa khoá câm

Bản vá đầu thêm `CHECK (email = lower(email))` rồi khai *"chữ hoa thành BẤT KHẢ"*. **Câu ấy chỉ
đúng cho ASCII**, và phần sai rơi thẳng vào đường đăng nhập:

| | đo được |
|---|---|
| `.toLowerCase()` của JS (Node 24) hạ | **1488** điểm mã |
| `lower()` của PostgreSQL trên `postgres:16-alpine` hạ | **1364** |
| trên `postgres:16` (Debian/glibc) | **1460** |
| điểm mã phân kỳ (JS hạ, máy chủ giữ nguyên) | **124** trên musl · **28** trên glibc |

Phần chênh là những điểm mã **bất động với hàm của máy chủ** — nên chúng **đi qua `CHECK`** — mà
JS vẫn hạ. Với `Ⓐlice@corp.com` (U+24B6): hàng cất được, nhưng `issueLoginToken` dựng khoá bằng
hàm **JS** trong khi hàng đã lưu là điểm bất động của hàm **PostgreSQL**, nên
`WHERE lower(email) = $1` trả **0 hàng** (đã đo trên bảng mô phỏng). Người ấy **không bao giờ nhận
được magic link**, dù gõ đúng nguyên văn địa chỉ đã đăng ký — và thiết kế *"luôn 200, cùng một
thân"* của `/auth/link` bảo đảm **không ai nhìn thấy**.

**Bản vá thật không phải siết ràng buộc mà là bỏ hẳn MỘT trong hai định nghĩa:** `login.ts` thôi
gọi `.toLowerCase()`, câu truy vấn hạ **cả hai vế** bằng `pg_catalog.lower()`. Cùng một hàm thì
không lệch được. Đo lại cùng kịch bản: **1** hàng.

## Bốn lời khai khác bị bác, và đều bác bằng phép đo

| lời khai của vòng này | đo lại |
|---|---|
| *"câu `ALTER` in ra ĐÚNG hàng vi phạm (`DETAIL: Failing row contains`)"* | **SAI** — `ALTER TABLE ADD CONSTRAINT` chỉ nói `is violated by some row`; `DETAIL` chỉ có ở `INSERT`/`UPDATE`. Đây là **trụ** của lập luận *"không cần lượt đối chiếu riêng"* |
| *"chỉ mục trên `lower()` đẻ ra một LỚP LỖI MỚI"* | **SAI** — mọi btree trên `text` đã phụ thuộc collation, `users_org_id_email_key` gồm cả; và btree **đi xuống bằng thứ tự** collation nên vế *"so byte vẫn đứng"* chỉ đúng cho phép SO SÁNH |
| *"câu này không dùng được tiền tố `(org_id, ...)`"* | **SAI** — tiền tố vẫn dùng (Bitmap Index Scan, `Index Cond: org_id = ...`); thứ mất là **cột khoá thứ hai** |
| hàng sổ nợ về đường (a) | **tự mâu thuẫn trong một câu** — vừa nói (a) *"chặn được cặp"* vừa nói bất biến *"vẫn phụ thuộc việc không ai chèn biến thể thứ hai"* |

**Tất cả đã sửa tại chỗ theo kỷ luật của kho** (gạch nguyên văn, ghi câu đúng bên cạnh).
Phần Unicode còn lại thành khoản nợ **71**.

## Điều đáng mang sang vòng sau

**⑴ KHI HAI TẦNG CÙNG CHUẨN HOÁ MỘT GIÁ TRỊ, PHẢI CÓ ĐÚNG MỘT HÀM LÀM VIỆC ẤY.** Hai hàm *"cùng
nghĩa"* ở hai tầng là một cửa khoá câm đang chờ — và nó **không hiện ra trong bất kỳ test ASCII
nào**. Đây là bài học tổng quát nhất của vòng: `.toLowerCase()`, `.trim()`, chuẩn hoá NFC, cắt
khoảng trắng — mỗi lần một phép chuẩn hoá tồn tại ở cả hai phía của một phép so sánh là một lần
phải hỏi *"hai phía có dùng CHUNG một cài đặt không"*.

**⑵ MỘT MỐC CHẾT PHỤ THUỘC MÔI TRƯỜNG PHẢI TỰ HIỆU CHUẨN, KHÔNG ĐƯỢC ĐÓNG CỨNG.** Tập điểm mã
phân kỳ khác nhau giữa musl và glibc (124 so với 28), nên một test đóng cứng `U+24B6` sẽ xanh trên
ảnh này và đỏ trên ảnh kia **vì một lý do không liên quan đến tính chất đang đo**. Test của vòng
này hỏi chính CSDL đang chạy xem điểm nào phân kỳ rồi dùng cái đầu tiên — và **ném ồn ào** nếu
không tìm được cái nào, thay vì xanh im lặng.

**⑶ MỘT LẬP LUẬN CÓ THỂ ĐÚNG KẾT LUẬN NHƯNG SAI Ở MỌI LÝ DO.** Lựa chọn `CHECK` thay cho chỉ mục
biểu thức **vẫn đúng** sau khi soi — nhưng ba trong các lý do biện minh cho nó thì sai. Một kết
luận đúng dựng trên lý do sai sẽ **đổ ở vòng sau**, khi ai đó dựa vào chính lý do ấy để quyết một
việc khác.

# §S1.28 — khoản nợ 61 (`Handoff.md` vào tầm `[INV-H20]`)

**Phạm vi:** `tests/architecture/so-no-tu-doi-chieu.test.ts`, `Handoff.md`, `docs/TEST-PLAN.md`,
`docs/DECISIONS.md` ADR-029 §4, so với `origin/master` = `0a3cc6b`.

## Điều phải nói đầu tiên: vòng này KHÔNG có lượt soi đối kháng độc lập

Ba vòng trước (§S1.25, §S1.26, §S1.27) mỗi vòng được **ba lăng kính độc lập** soi, và cả ba vòng
ấy đều bị bác ít nhất ba lời khai — §S1.27 bị bác **năm**, trong đó một lỗ là do chính bản vá tạo
ra. Vòng này **chỉ có phép tự soi của người viết**. Đó là một khác biệt về CHẤT, không phải về
mức độ kỹ lưỡng, và nó được ghi ra đây để không ai đọc gộp bốn vòng thành một hàng.

**Mặt an ninh:** bề mặt của vòng này là **0** — không đụng mã sản xuất, không đụng lược đồ, không
đụng đường xác thực. Toàn bộ thay đổi nằm ở một tệp test và bốn tệp tài liệu. Rủi ro còn lại đúng
bằng rủi ro của `[INV-H20]` đã ghi ở ADR-029 §5: lớp này **đọc tài liệu như dữ liệu tin cậy**, và
vòng này **mở rộng bề mặt ấy thêm một tệp** (`Handoff.md`) — kết luận vẫn đúng ở mức *tự gây
thương tích*, không ở mức *chống nội dung thù địch*, và giả định ấy vẫn chưa được cưỡng chế vì
`CODEOWNERS` trỏ tới một team chưa tồn tại (khoản nợ 18).

## Hai chỗ hở do chính phép tự soi tìm ra, và cả hai là chiều ĐỎ OAN

Đây là phần có giá trị nhất của lượt tự soi, vì **chiều đỏ oan đắt hơn chiều bỏ sót**: một phép
kiểm đỏ oan sẽ bị nới, và nới xong thì nó không còn nói gì.

| chỗ hở | đo được | bản vá |
|---|---|---|
| `viPhamCapGach` đếm cả dấu `~~` **nằm trong đoạn mã** | `Handoff.md` 103 dấu — số **LẺ** — mà **không** cặp nào hở, vì §15 có một `` `~~` `` trong đoạn mã đang nói về chính cửa ấy. Và `docs/STATE.md` đang xanh chỉ vì bốn dấu trong đoạn mã của nó **tình cờ CHẴN** | đếm sau khi bỏ đoạn mã (`boDoanMa`), kèm mũi đột biến HAI CHIỀU: dấu trích dẫn không được đỏ, dấu thật vẫn phải đỏ |
| bộ đọc bảng §13 lọc **mọi** dòng bắt đầu bằng `\|` trong cả mục | một bảng THỨ HAI trong cùng mục — kể cả hàng tiêu đề của nó — bị đọc như hàng dữ liệu: **3 vi phạm giả** | dừng ở dòng đầu tiên không phải hàng bảng; đo lại: **0**. Mũi giữ nó đã được xác nhận **đỏ 3/3** trên bản trước khi vá |

## Điều đáng mang sang vòng sau

**MỘT LỚP CANH TÀI LIỆU PHẢI ĐỌC NHỮNG VỊ TRÍ ĐÃ KHAI, KHÔNG PHẢI MỌI TOKEN TRÔNG GIỐNG THỨ NÓ ĐI
TÌM.** Cách đóng hiển nhiên của khoản nợ 61 — quét mọi đường dẫn trong đấu huyền như P4 — cho
**38 phát hiện, 36 trong đó không phải lỗi**. Nếu vòng này tin vào cách ấy, sản phẩm sẽ là một
danh sách miễn trừ dài bằng chính danh sách phát hiện, tức một danh sách chứ không phải một lớp.
Thứ cứu nó là đọc lại P4 và thấy nó **chưa bao giờ quét văn xuôi**.

**VÀ MỘT CON SỐ KHÔNG SUY RA ĐƯỢC THÌ ĐỪNG VIẾT.** Hai con số (*"36 mục"*, *"bốn họ quy tắc"*)
được **gỡ** khỏi tài liệu thay vì cập nhật, vì suy chúng đòi thêm mốc vào nguồn cho vừa bộ đếm.
Đó là tuân thủ ADR-029 ⑴, không phải né tránh — khác hẳn việc gạch một con trỏ chết để làm im một
cổng, thứ mà P4 đã có một mũi riêng để chặn.

# §S1.29 — khoản nợ 12 và 60 (hai vị từ suy từ hình dạng)

**Phạm vi:** `tests/architecture/nhan-bat-bien-cho-dat.test.ts` (mới),
`db/hardening-suy-tu-tinh-chat.int.test.ts`, `packages/outbox/src/nhan-bat-bien.test.ts`,
`docs/TEST-PLAN.md`, `docs/DECISIONS.md` ADR-035, so với `origin/master` = `bebeb41`.

## ~~Vòng này KHÔNG có lượt soi đối kháng độc lập — lần thứ hai liên tiếp~~ Lượt soi 19 đã chạy — xem cuối mục

§S1.25, §S1.26, §S1.27 mỗi vòng được **ba lăng kính độc lập** soi và đều bị bác ít nhất ba lời
khai. §S1.28 và vòng này chỉ có **phép tự soi của người viết**. Ghi ra để không ai đọc gộp năm
vòng thành một hàng — và để con số *"hai vòng liên tiếp không được soi"* là một thứ nhìn thấy
được, không phải một chỗ quên.

**Bề mặt an ninh:** ~~0 mã sản xuất. Thay đổi nằm ở hai tệp test, một tệp test được sửa chú thích,
và ba tệp tài liệu.~~ **[lượt soi 19 bác: diff có 11 tệp, không phải 6]** — và sau lượt soi, vòng này
đụng **một tệp sản xuất**: `db/migrations/hardening.always.sql` (vị từ bảng chỉ-ghi-thêm thêm vế khai
báo ở ba chỗ). Đó là hardening, chạy ở mọi `migrate()`; sai ở đó là sai trên mọi deploy, nên chính
test H19 giữ nó khớp nguyên văn với bản trong test. Không đụng lược đồ, không đụng đường xác thực, không thêm migration.

## Điều phép tự soi tìm ra, và cả hai đều là lỗi THẬT

| chỗ hở | đo được | bản vá |
|---|---|---|
| Lớp mới quét dòng `it(` vì tin vào mô tả *"bộ sinh gom theo tên test"* | Bộ sinh gom theo `fullName` = describe NỐI it. **22 cặp (mã, tệp) chỉ có ở dòng `describe(`** — gồm `H19`, `H20`, `H21`, ~~chín~~ **mười** mã hook (`H1`–`H10` — lượt soi 19 đếm lại) | ~~quét cả hai dạng dòng~~ lấy cặp từ CHÍNH báo cáo vitest (lượt soi 19: quét dòng vẫn mù với 8 tên test `it.each` nhiều dòng); sổ khai 114 → **137** cặp (136 tại `bebeb41`, cặp 137 là của H22). Câu tự khai của lớp outbox đã gạch |
| Mũi đột biến *"xoá lời khai ADR"* nhắm vào cụm khớp ĐẦU TIÊN | Sau S1.29 `Handoff.md` có hai cụm — một đã gạch, một sống. Mũi ấy **xanh oan**; `[INV-H20]` bắt được | nhắm vào lời khai còn sống, sau khi bỏ đoạn mã và vùng đã gạch |

Cộng một chỗ thứ ba, nhẹ hơn: một `!` trần làm test **SẬP** với *"Cannot read properties of
undefined"* dưới mũi *bộ quét mù* thay vì nói ra điều đang sai — hỏng ồn ào vẫn phải hỏng **thành
một câu**.

## Điều đáng mang sang vòng sau

**MỘT VỊ TỪ NHẬN DIỆN CHỦ THỂ BẰNG HÌNH DẠNG THÌ VẪN LÀ MỘT DANH SÁCH TÊN, CHỈ VIẾT BẰNG REGEX.**
ADR-028 đã dạy *"suy từ tính chất, đừng dùng danh sách tên"*; ADR-035 nói tiếp phần còn thiếu.
Cách thoát không phải viết vị từ chặt hơn — mọi cách nới đều lại là một hình dạng — mà là **đổi
thứ tự**: liệt kê rộng theo một tiêu chí không lách được, rồi buộc phân loại.

**VÀ MỘT DANH SÁCH ĐÓNG BĂNG PHẢI TỰ NÓI RẰNG NÓ KHÔNG PHẢI MỘT LẦN KIỂM TOÁN.** 137 cặp và 23
hàm được sinh từ trạng thái đo được, không phải từ một lượt xét từng cái. Chúng chặn cái thứ 138
và cái thứ 24; chúng không phán xét những cái đã có. Viết câu ấy vào chính tệp là rẻ; để người
đọc tự phát hiện thì đắt.

## Lượt soi đối kháng 19 — chạy SAU khi §S1.29 được viết, và nó bác hai trụ của vòng

**Hình thức:** workflow 6 lăng kính độc lập (*lời khai rộng hơn phép đo · xanh giả · đỏ oan · có
đóng được nợ thật không · phá gì · tài liệu mâu thuẫn*), mỗi phát hiện qua ba người phản bác với
mặc định *bác bỏ nếu không chắc*. Hạn phiên cắt hai lần: 56 phát hiện, **12 sống sót** (hầu hết
0/3 bác), 10 bị bác, **33 chưa được thẩm định máy** — những cái nặng trong nhóm ấy đã được tự đo
lại bằng lệnh và ghi ở đây như phát hiện đã xác nhận, không hơn.

| # | mức | phát hiện | đo được | sửa |
|---|---|---|---|---|
| 1 | CAO | `[INV-H22]` chọn ứng viên CẶP bằng hình dạng DÒNG — đúng thứ ADR-035 §2⑴ cấm | `test(`, `it.concurrent(`, tiêu đề ở dòng sau `it.each` đều nuôi ma trận mà bộ quét mù; kho có **8** tên test như thế; mũi thật: 7/7 xanh trong khi vitest báo 11 test `[INV-A1]` từ tệp chưa khai | cặp lấy từ CHÍNH báo cáo vitest, cưỡng chế ở `pnpm evidence`; H22 thành test hàm thuần |
| 2 | CAO | Tổng điều tra khoản 60 **thưởng lời khai sai, phạt lời khai đúng** | hàm canh `RAISE …; RETURN NULL` dựng trên PG thật: khai CANH ⇒ đỏ, khai KHÔNG-CANH ⇒ xanh và bảng không được H19 canh | vị từ = hình dạng ∪ khai báo, khớp nguyên văn hardening; mâu thuẫn một chiều; phép đo trên PG thật |
| 3 | CAO | Khai SAI một hàm canh có `RETURN` không lớp nào bắt | cùng probe: khai KHÔNG-CANH ⇒ cả ba khẳng định xanh | **không sửa được bằng văn bản** — khoản nợ **74** |
| 4 | NẶNG | *"chín mã hook"* | đo lại: **mười** (`H1`–`H10`), chép ra sáu chỗ | sửa tại chỗ, gạch nguyên văn |
| 5 | NHẸ | *"56 mã / 137 cặp tại `bebeb41`"* | tại đó chưa có tệp H22: 55 / 136 | sửa |
| 6 | NHẸ | biên bản khai bề mặt *"6 tệp"* | diff có 11 | sửa |
| 7 | CAO | dòng tổng của chính sổ đăng ký còn khai **21** hàng rào | bảng có 22 | sửa; đây là một lời khai `[INV-H20]` không đọc — cùng lớp khoản 61 |
| 8 | NHẸ | H21/H22 tách khỏi đầu bảng, GFM dựng thành văn bản thô | đúng — bộ đếm vẫn tính nhưng người đọc không thấy hàng | mỗi hàng có đầu bảng riêng |
| 9 | NHẸ | ADR-028 §6 còn khai nguyên văn tập hàm canh *"suy từ hình dạng"* | đúng | gạch, ghi câu S1.29 |
| 10 | NHẸ | tổng điều tra định danh hàm không gắn lược đồ | `DISTINCT proname` gộp hai hàm cùng tên khác lược đồ | định danh `lược đồ.tên` |
| 11 | INFO | vị từ bỏ qua `tgenabled` — trigger canh bị TẮT vẫn được đếm | đúng, có sẵn từ S1.20 | tổng điều tra coi trigger canh tắt là vi phạm |
| 12 | NHẸ | một mũi đột biến P7 của `[INV-H20]` chép lại nửa `conHieuLuc` | đúng | giữ, ghi ở đây; sửa ở vòng sau nếu chạm tệp ấy |

**Điều đáng mang sang vòng sau — và nó nặng hơn mọi phát hiện đơn lẻ:** cả hai trụ của vòng đều
bị bác bởi **cùng một khuôn** — *bản cài đặt đầu tiên của một quy tắc vi phạm chính quy tắc ấy*.
H22 chọn ứng viên bằng hình dạng ngay sau khi ADR-035 cấm hình dạng; tổng điều tra lấy hình dạng
làm nguồn sự thật ngay sau khi nói hình dạng không đáng tin. Thứ bắt được không phải đọc lại kỹ
hơn, mà là **một người khác dựng đúng ca phản ví dụ trên hệ thống thật**. Hai vòng trước không có
lượt soi này, và bây giờ đã rõ cái giá của việc đó.

---

# §S1.30 — khoản nợ 74: nhân chứng hành vi cho tổng điều tra hàm trigger

**Bề mặt an ninh:** 0 mã sản xuất. Diff có 6 tệp: một tệp test (`db/hardening-suy-tu-tinh-chat.int.test.ts`,
+~560 dòng), bốn tệp tài liệu (`STATE`, `DECISIONS`, `TEST-PLAN`, `Handoff`) và tệp này.
`hardening.always.sql` nguyên vẹn; không migration; không đụng đường xác thực. Lớp mới là một
phép đo ở tầng T3, cùng tầng với tổng điều tra của S1.29 — nó không đổi thứ production cưỡng chế,
nó đổi thứ CI từ chối.

## Lượt soi đối kháng 20 — chạy TRƯỚC khi §S1.30 được viết, trên bản đầu của lớp

**Hình thức:** một `security-reviewer` độc lập, không có shell (đọc trọn tệp 1143 dòng + bảy
migration + `test-support`), được giao rõ bảy hướng phá: ghi công nhầm qua đường lồng/INSERT/AFTER,
tính đúng của vế *"RAISE không được đếm"* trên PG16, `SET LOCAL ROLE` trong phiên superuser, đầu dò
canh-một-sự-kiện, xanh rỗng ruột, flaky, tài nguyên để lại. Không chạy được gì; mọi phát hiện được
người viết đo lại trên PostgreSQL 16 thật và ghi kết quả ở cột *đo được*.

| # | mức | phát hiện | đo được | sửa |
|---|---|---|---|---|
| 1 | CAO | Ghi công theo HÀM, không theo (hàm, BẢNG): thân hàm trigger đọc `TG_TABLE_NAME`/`TG_ARGV`, nên một hàm có thể canh vô điều kiện ở bảng này, có điều kiện ở bảng kia | đúng — `thu_hoi_don_dieu` gắn **5** bảng, kịch bản chạm **2**; ba bảng kia chưa hàng nào đi qua mà cặp vẫn xanh | khoá theo bộ ba (hàm, bảng, sự kiện); thêm 3 câu (`guest_sessions`, `rfq_invitation_tokens`, `user_login_tokens`); đo: bỏ nhân chứng `guest_sessions` ⇒ đỏ đúng một bộ ba |
| 2 | CAO | Kịch bản chạy dưới superuser ⇒ mọi hàm gated theo vai được ghi công miễn phí; hai hàm chạy dưới `app_api` được chọn theo TÊN viết tay | đúng — `IF la_duong_ung_dung('app_api') THEN RAISE; END IF; RETURN NEW;` là hàm canh với toàn bộ lưu lượng sản xuất, và bản đầu ghi công nó dưới owner | vai ĐO bằng `current_user` + `rolsuper`; hàm mà thân đọc vai (`nhay_vai`, vị từ văn bản chỉ chọn độ mịn) đòi nhân chứng từ vai không superuser; đo: DELETE `mfa_credentials` dưới owner ⇒ đỏ *(cần vai không superuser)* |
| 3 | NẶNG | Trigger cấp CÂU LỆNH và AFTER-ROW ném vô điều kiện vô hình với cả tổng điều tra lẫn nhân chứng | xác minh bằng đọc bitmask; đo tĩnh: kho có 0 trigger như thế trên UPDATE/DELETE | **không sửa ở vòng này** — khoản nợ **75**, cùng lớp 73 |
| 4 | NẶNG | Mũi đột biến khẳng định THỨ TỰ hàng catalog (`toEqual([[true,false],[false,true]])`) — đỏ oan sau autovacuum/đổi kế hoạch | đúng về nguyên tắc; chưa thấy xảy ra | so theo tập đã sắp |
| 5 | NẶNG | `RESET track_functions` ném ⇒ client không `release` ⇒ `pool.end()` treo ⇒ container không dừng; ở mũi đột biến, `zz_*` không được dọn | đúng theo ngữ nghĩa pg-pool + `postgres.ts` | `release(true)` trong `finally`; tạo bảng thử SAU `connect()` và trong `try`; `DROP … IF EXISTS` |
| 6 | NHẸ | Khối `giaoDich` gom nhiều câu ⇒ `calls` tăng do INSERT trong khối được gán cho câu UPDATE; đề xuất `pg_stat_xact_user_functions` — đọc được TRONG giao dịch, không cần flush | đúng, và đề xuất tốt hơn đường flush | mỗi nhân chứng = bước chuẩn bị + ĐÚNG MỘT câu, kẹp giữa hai lần đọc bộ đếm giao dịch; bỏ `pg_stat_force_next_flush()` |
| 7 | NHẸ | `pg_stat_force_next_flush()` là `nowait` — flush một phần khi entry bị khoá ⇒ đỏ oan | đúng về nguyên tắc; không có backend nào khác chạm entry | hết liên quan sau #6 |
| 8 | NHẸ | Đồng hồ host/container lệch | biên 7/14 ngày quá rộng; các hạn khác đều `now()` phía DB | không cần |
| 9 | INFO | *"RAISE không được đếm"* là ĐÚNG cho PG16: `pgstat_end_function_call` sau `PG_END_TRY`; khối `BEGIN … EXCEPTION` nuốt lỗi rồi `RETURN NULL` ⇒ được đếm nhưng `rowCount = 0` ⇒ vế ⒞ chặn | xác nhận | giữ; mũi *calls = 0* nay đo trong cùng giao dịch qua `SAVEPOINT` |
| 10 | INFO | `SET LOCAL ROLE app_api` trong phiên superuser: sound — hoàn nguyên ở cả COMMIT lẫn ROLLBACK, RLS dùng `GetUserId()`, `track_functions` là GUC phiên | xác nhận | giữ |
| 11 | INFO | Đầu dò canh-một-sự-kiện: BEFORE DELETE trên `rfq_key_material` chỉ có một trigger, RI là AFTER nên không chen được; regex `where` không neo khung ngoài cùng; biến thể UPDATE không kích hoạt được trigger `UPDATE OF <cột>` | xác nhận | giữ; ghi ở đây |
| 12 | INFO | Va chạm khoá duy nhất khi chạy hai lần: không có | xác nhận | — |

**Điều đáng mang sang vòng sau:** hai phát hiện CAO là **cùng một khuôn với lượt 19** — *bản cài
đặt đầu tiên tin một lời khai mà nó sinh ra để kiểm* (lần này: tin rằng thân hàm độc lập với bảng,
và tin hai cái tên viết tay thay cho một tính chất đo được). Ba vòng liên tiếp, cùng một khuôn,
và ba lần thứ bắt được đều là **một người khác dựng phản ví dụ**, không phải người viết đọc lại.

---

# §S1.31 — khoản nợ 73 + 75: RULE và trigger ngoài hình thức BEFORE-ROW

**Bề mặt an ninh:** **19 dòng `db/migrations/hardening.always.sql` đổi** (17 thêm, 2 bỏ) — một vế `UNION ALL` mới
trong `CAU_CHI_GHI_THEM_VAT_LY` (phán xét rule trên mọi bảng chỉ-ghi-thêm suy ra) và chú thích;
không migration đánh số mới, không đụng lược đồ hay đường xác thực. Còn lại: một tệp test
(`db/hardening-suy-tu-tinh-chat.int.test.ts`, +~190 dòng), năm tệp tài liệu và tệp này.

## Lượt soi đối kháng 21 — chạy TRƯỚC khi §S1.31 được viết, trên bản đầu của lớp

**Hình thức:** một `security-reviewer` độc lập, không có shell (đọc trọn tệp test 1382 dòng, các
vùng đổi của hardening, thân 5 hàm AFTER-ROW, hai constraint trigger, bộ đọc qt3, `startPostgres`),
được giao sáu hướng phá. Mọi phát hiện được người viết đo lại trên PostgreSQL 16 thật.

| # | mức | phát hiện | đo được | sửa |
|---|---|---|---|---|
| 1 | CAO → INFO | Rule đặt tên `"_RETURN"` trên BẢNG lách cả ba vế loại theo tên | **PostgreSQL 16 NÉM** *non-view rule for "bid_receipts" must not be named "_RETURN"* — engine giữ tên ấy cho view | ghi phép đo vào chú thích; không đổi vế |
| 2 | NẶNG | Test *rule trên bảng chỉ-ghi-thêm* không có `finally`: một assert đỏ giữa vòng để `zz_nuot` sống ⇒ mọi `migrate()` sau ném vì chính mục mới ⇒ đỏ dây chuyền | đúng theo đọc | `try/finally` gỡ `DROP RULE IF EXISTS` trên mọi bảng |
| 3 | NẶNG | Constraint trigger DEFERRED trên UPDATE/DELETE chạy ở COMMIT — sau lần đọc bộ đếm thứ hai — nên đỏ vĩnh viễn với thông điệp SAI (*"hoặc là hàm canh, hoặc thiếu nhân chứng"*) | lập luận đúng; hôm nay 0/46 ca; hai constraint trigger DEFERRED của kho (017, 018) đều `AFTER INSERT` | ~~`tgdeferrable` vào tập rộng theo bảng, thông điệp nói rõ *đổi thành NOT DEFERRABLE*; KHÔNG ép `SET CONSTRAINTS ALL IMMEDIATE` (bản đầu đã thử và 017 tự bắn)~~ **[S1.33] đảo cả hai:** `tginitdeferred` (không phải `tgdeferrable`), và CÓ ép `SET CONSTRAINTS ALL IMMEDIATE` — SAU câu nhân chứng và `hoanTat`, đọc bộ đếm lần ba — xem lượt soi 23 #4; lượt soi 25b #11 bắt dòng này chưa gạch |
| 4 | NHẸ | Tổng điều tra rule không có đối chứng chống rỗng ruột trong chính nó — bằng chứng câu truy vấn *thấy* rule chỉ nằm ở test kế | đúng | dựng một rule tạm ngay trong test và đòi thấy |
| 5 | NHẸ | RLS `USING (false)` + `FORCE` là cơ chế thứ ba làm bảng chỉ-ghi-thêm: 0 hàng, không lỗi, không trigger, không rule | plausible, đúng về ngữ nghĩa RLS; kho không có policy nào như thế | **khoản nợ 76** |
| 6 | INFO | Thứ tự mảng hardening: mục gỡ rule bảng sổ (7238) đứng TRƯỚC mục phán xét vật lý (7356) ⇒ rule trên `audit_events` được gỡ, không ném | xác nhận bằng đọc | — |
| 7 | INFO | Bit `tgtype` PG16 (ROW 1, BEFORE 2, INSERT 4, DELETE 8, UPDATE 16, TRUNCATE 32, INSTEAD 64) — `& 16`/`& 8` đúng; TRUNCATE của hai hàm canh (34) không lọt; INSTEAD OF (64\|16) vào tập nhưng kho không có | xác nhận | — |
| 8 | INFO | Luật *hàm canh phải BEFORE-ROW* không có dương tính giả: PL/pgSQL ném *control reached end of trigger procedure without RETURN* cho cả AFTER, nên hàm không `RETURN` chỉ có thể ném | xác nhận | — |
| 9 | INFO | Ba nhân chứng mới: AFTER ROW bắn cho mọi hàng khớp kể cả no-op; `AFTER UPDATE OF status` bắn khi `status` trong SET; BUYER/PM đi qua bốn hàm D2/D3 theo `RETURN NULL`; đình chỉ chỉ thu hồi phiên của người mới | xác nhận bằng đọc thân hàm | — |
| 10 | INFO | qt3 chỉ đọc `.ts` dưới `packages\|apps\|tools` + `/src/` — hai tệp ngoài phạm vi; văn bản SQL mới trong `$q$…$q$` hợp lệ, cùng khuôn với phần còn lại; không đường đỏ giả trên lược đồ hợp lệ | xác nhận | — |

**Điều đáng mang sang vòng sau:** ba vòng liền, mỗi vòng lộ thêm **một cơ chế của PostgreSQL có thể
làm một câu ghi trả 0 hàng mà không lỗi** — trigger BEFORE-ROW (S1.29), RULE và trigger khác hình
thức (S1.31), RLS `USING (false)` (76). Khoản 76 nên được đóng bằng một câu hỏi RỘNG HƠN khoản nợ
đặt ra: *liệt kê mọi cơ chế ấy một lần*, thay vì đợi lượt soi kế chỉ ra cơ chế thứ tư.

---

# §S1.32 — khoản nợ 76 bằng câu hỏi rộng: ADR-036, danh mục cơ chế làm câu ghi trả 0 hàng không lỗi

**Bề mặt an ninh:** 0 mã sản xuất. Hai tệp test (`db/rls-coverage.int.test.ts` +~230 dòng,
`db/hardening-suy-tu-tinh-chat.int.test.ts` +~90 dòng), ADR-036 mới, năm tệp tài liệu và tệp này.

## Lượt soi đối kháng 22 — chạy TRƯỚC khi §S1.32 được viết, trên bản đầu của lớp

**Hình thức:** một `security-reviewer` độc lập, không có shell (đọc hai khối test mới, hardening,
`vai-tro.ts`, migration 027/037/045, mã ứng dụng), được giao câu hỏi *"danh mục có đủ không?"* cùng
sáu hướng phá. Mọi phát hiện được người viết đo lại trên PostgreSQL 16 thật.

| # | mức | phát hiện | đo được | sửa |
|---|---|---|---|---|
| 1 | CAO | Tổng điều tra phủ lệnh MÙ với quyền cấp qua `PUBLIC`: `grantee = 0` không có hàng trong `pg_roles`, JOIN thẳng làm rớt — `GRANT UPDATE … TO PUBLIC` cấp quyền cho cả hai vai mà census xanh | đúng theo đọc; đối chứng dương mới `GRANT … TO PUBLIC` trên bảng tạm ⇒ ba bộ ba thiếu | nhân mỗi entry PUBLIC ra từng vai (`JOIN vai ON a.grantee = 0 OR a.grantee = vai.oid`) |
| 2 | CAO | Trigger BEFORE INSERT ROW trả `NULL` nuốt INSERT im lặng — ngoài mọi census (tập rộng chỉ UPDATE/DELETE); RULE census bắt `ON INSERT DO INSTEAD NOTHING` nhưng không bắt trigger | **đo:** `INSERT 0 0`, `RETURNING` rỗng, không lỗi | tập rộng mở ra bit INSERT: 27 hàm buộc phân loại (19 khai mới); nhân chứng INSERT — **khoản nợ 77**; ADR-036 hàng 15 |
| 3 | NẶNG | ROLLBACK/dọn dẹp ngoài `finally` ở năm chỗ (ba ở `rls-coverage`, hai ở `hardening`): một `expect` đỏ để giao dịch mở trên client trả về pool ⇒ `SET ROLE` kế ném trong giao dịch aborted ⇒ đỏ dây chuyền; INSERT người + CREATE POLICY ngoài `try` ⇒ rò khi đổ | đúng theo đọc | ROLLBACK vào `finally`; dọn TRƯỚC và SAU (`DROP POLICY IF EXISTS`, `DELETE … WHERE email`) |
| 4 | NẶNG | Khoá tổng điều tra `bảng.policy` thiếu lược đồ — hai bảng cùng tên khác schema đè nhau | đúng theo đọc; tác động thấp vì mã qualify `public.` | khoá `lược đồ.bảng.policy`; census phủ lệnh và ngoài tenant báo tên đủ lược đồ |
| 5 | NHẸ | Che tên: `CREATE TEMP TABLE sessions` trên kết nối pool (pg_temp trước `public`), hoặc schema `app_api` — không `REVOKE TEMP ON DATABASE`, không `DISCARD TEMP` | đúng về ngữ nghĩa; hôm nay vô hại vì mã sản xuất qualify `public.` | **khoản nợ 78**; ADR-036 hàng 16 |
| 6 | NHẸ | Khớp vai theo OID đúng tên, không xét kế thừa: policy `TO nhom` mà app_api là thành viên ⇒ đỏ dù có phủ | chiều an toàn; hardening gỡ mọi tư cách thành viên lạ nên chỉ là trạng thái tạm giữa hai deploy | ghi chú trong câu truy vấn |
| 7 | NHẸ | Biểu thức `pg_get_expr` nguyên văn phụ thuộc search_path phiên đọc và cách deparse của phiên bản PostgreSQL | đúng; chiều đỏ ồn ào, không xanh im lặng | ghi ở ADR-036 §4 |
| 8 | NHẸ | Chuỗi *phủ lệnh ↔ [CR1]* cho `FOR ALL USING (false)` PERMISSIVE: census coi là phủ, [CR1] từ chối hình dạng trên bảng tenant, census ngoài tenant bắt bảng mới | xác nhận (một phần plausible ở `caller_rate_limits`, mục 6195 ghim đúng một policy) | — |
| 9 | INFO | Vế `ENABLE ALWAYS` không thừa: hardening chỉ ghim `'A'` cho trigger có TÊN; test đòi cho MỌI trigger của MỌI hàm canh; `'A'` đúng, `'R'` phải đỏ | xác nhận | — |
| 10 | INFO | Tổng điều tra `relkind`: không `PARTITION BY` ngoài test; DDL đối chứng đều transactional; cài extension sinh view sẽ đỏ — đúng chủ đích | xác nhận | — |

**Điều đáng mang sang vòng sau:** ADR-036 sinh ra để chấm dứt chuỗi *"mỗi vòng lộ thêm một cơ chế"*
— và lượt soi 22 thêm hai cơ chế vào chính bản đầu của nó. Đó không phải thất bại của ADR; đó là
điều ADR §5 nói: danh mục không chứng minh được, nhưng mọi cái thiếu nay có một địa chỉ để đứng.
Bốn lượt soi liền (19–22) đều bác bản đầu; giá của một lượt soi rẻ hơn giá của một vòng.

# §S1.33 — khoản nợ 77: nhân chứng INSERT, và vế *hàng thật* đo ở mức bảng

**Bề mặt an ninh:** 0 mã sản xuất. Một tệp test (`db/hardening-suy-tu-tinh-chat.int.test.ts`, `[INV-H19]`
19 → 22 test: sự kiện INSERT vào `SoNhanChung`, ba mốc `pg_stat_xact_user_tables`, cửa sổ đo thứ hai sau
`SET CONSTRAINTS ALL IMMEDIATE`, `RE_NHAY_VAI` + bao đóng bậc một), ADR-036 hàng 11/15 cập nhật và hàng
17/18 mới, năm tệp tài liệu và tệp này. **[S1.35] Mục này viết BÙ ở vòng S1.35** — lượt soi 25b NẶNG-2:
lượt soi 23 từng treo dưới `# §S1.32`, không có dòng bề mặt riêng.

## Lượt soi đối kháng 23 — chạy TRƯỚC khi §S1.33 được viết, trên bản đầu của lớp

**Hình thức:** một `security-reviewer` độc lập, không có shell (đọc diff của vòng, khối nhân chứng,
ADR-036, migration 017/018/029/037/039/005/033/019), được giao sáu hướng phá: cửa sổ đo thứ hai, cơ chế
nuốt INSERT ngoài `RETURN NULL`, tác dụng phụ của `SET CONSTRAINTS ALL IMMEDIATE`, kịch bản, lời khai
văn bản còn lại, rò rỉ/lặp lại. Mọi phát hiện được người viết đo lại trên PostgreSQL 16 thật.

| # | mức | phát hiện | đo được | sửa |
|---|---|---|---|---|
| 1 | NẶNG | Vế ⒞ hỏi *câu báo ≥ 1 hàng*, không hỏi *hàng còn nằm trong bảng không*: trigger AFTER INSERT ROW `DELETE … WHERE id = NEW.id; RETURN NULL` cho `INSERT 0 1`, `RETURNING` đầy đủ, `calls` tăng ⇒ ghi công, bảng rỗng — cơ chế chưa có trong ADR-036 | **đo:** `rowCount` 1, `rows` 1, `n_tup_ins` 1, `n_tup_del` 1 | đọc `pg_stat_xact_user_tables` của bảng nhân chứng ở ba mốc: cửa sổ đầu bộ đếm đúng sự kiện = `rowCount`, hai bộ đếm kia = 0; cửa sổ sau = 0/0/0; lệch thì NÉM; đối chứng trong test đột biến; ADR-036 hàng 17 |
| 2 | NẶNG | Nuốt CÓ ĐIỀU KIỆN trong cùng câu: `rfq_items` chèn hai hàng, nuốt một ⇒ `rowCount = 1 ≥ 1` vẫn ghi công; `chenKhongId` bỏ hẳn kết quả | đúng theo đọc | `chen`/`chenKhongId` đòi số hàng mong (mặc định 1, `rfq_items` 2) bằng đúng `rowCount`; ADR-036 hàng 18 |
| 3 | NẶNG | `nhay_vai` là regex năm tên: sót `current_role`, `USER` trần, `current_setting('role')`, `has_*_privilege`, `pg_authid`, và mọi vị từ BỌC tên khác — đúng khuôn 037 đã dùng; HIGH-2 của lượt soi 20 quay lại | **đo:** 4 hàm của kho gọi `la_duong_ung_dung`, đều khớp trực tiếp; regex rộng bắt thêm `mfa_reset_kiem_quyen` qua `'user.mfa_reset'` (dương tính giả) | regex rộng hơn + bao đóng bậc một (`p.prosrc ~ '\m<q.proname>\s*\('` với `q.prosrc` khớp regex); đối chứng dương: hàm gọi vị từ bọc `current_role` phải bị THẤY, regex trực tiếp không thấy; nhân chứng `mfa_reset_requests` chạy dưới `app_api` |
| 4 | NHẸ | Cửa sổ chọn theo `tgdeferrable`, không theo `tginitdeferred`: `DEFERRABLE INITIALLY IMMEDIATE` chạy cuối câu nhưng bị phán ở cửa sổ hai ⇒ đỏ giả | **đo:** `calls` = 1 ngay sau câu | cột `hoan := tginitdeferred`; test DEFERRED có thêm ca INITIALLY IMMEDIATE (ghi công cửa sổ đầu) |
| 5 | NHẸ | Tiền đề "hàm DEFERRED gắn đúng một trigger" đếm HÀNG tập rộng: một trigger `AFTER INSERT OR UPDATE` là một hàng, hai sự kiện; `hoanTat` UPDATE chính bảng làm hàm cháy vì UPDATE mà ghi công cho INSERT | suy đoán, đúng về ngữ nghĩa; hôm nay 017/018 chỉ INSERT | tiền đề thêm `ins + upd + del = 1`; và vế cửa sổ sau = 0/0/0 (mục 1) cấm `hoanTat` chạm bảng nhân chứng |
| 6 | NHẸ | Vai tạm `roles` chèn/xoá TRẦN ngoài giao dịch nhân chứng — ném giữa chừng thì vai ở lại danh mục toàn cục | đúng theo đọc | xoá vai trong `finally` (không đưa vào `hoanTat`: CASCADE xoá `role_permissions` là `n_tup_del` trên bảng nhân chứng ở cửa sổ sau) |
| 7 | NHẸ | Hàng rào `HAM_CANH_MOT_SU_KIEN` với INSERT đứng SAU các khẳng định khác, thông điệp hứa "hàng mẫu" chưa có | đúng theo đọc | hàng rào lên đầu vòng, thông điệp nói rõ: INSERT không khai được cho tới khi có phép đo |
| 8 | INFO | Nhân chứng `sessions` dưới `app_api` đi qua ĐỦ hai vế (029 `la_duong_ung_dung` = TRUE rồi `mfa_verified_at IS NULL` = FALSE; 039 `NOT EXISTS` chạy thật trên hồ sơ TOTP); hai mốc thời gian cùng `clock_timestamp()` của CSDL, lật là NÉM | xác nhận | — |
| 9 | INFO | `SET CONSTRAINTS ALL IMMEDIATE` vô hại: kho không có khoá ngoại DEFERRABLE, chỉ hai constraint trigger 017/018, cả hai thoả theo cách dựng | xác nhận | — |
| 10 | INFO | Break-glass: `unseal_canh_bao_break_glass` chèn `outbox_jobs` trong cửa sổ đầu nhưng lọc `r.bang` không ghi công lệch; CANCELLED rồi yêu cầu thường không bỏ sót đường nào | xác nhận | — |
| 11 | INFO | `ROLLBACK` trong `catch` ném đè lỗi gốc nếu kết nối chết | đúng | bọc `try/catch` |
| 12 | INFO | Các cơ chế nuốt khác đã có lớp riêng (`INSTEAD OF`/phân mảnh ⇒ `relkind`; `RULE` ⇒ `pg_rewrite`; đổi `NEW.org_id` ⇒ hàng vẫn vào bảng) — ~~chỉ 1 và 2 còn hở~~ **[S1.35] bác — lượt soi 25a #4, ADR-036 hàng 19:** hàng vào bảng nhưng KHÔNG PHẢI hàng đã gửi | ~~xác nhận~~ | ghi cả hai vào ADR-036 §2 để bảng là NGUỒN |

**Điều đáng mang sang vòng sau:** vế ⒞ từng tin một con số — `rowCount` — mà PostgreSQL đếm TRƯỚC khi
trigger AFTER chạy. Cùng một CSDL cho một con số khác, `n_tup_*`, đếm hàng THẬT, cùng giao dịch, cùng
khuôn với bộ đếm hàm; hỏi *"con số này đếm cái gì, lúc nào"* là câu hỏi đóng luôn ba mục (1, 2, 5). Vế
`nhay_vai` là lời khai văn bản cuối cùng còn chọn độ mịn của phép đo, và nó nay có đối chứng dương như
mọi tổng điều tra khác theo ADR-036 §3⑵. Năm lượt soi liền (19–23) đều bác bản đầu.

# §S1.34 — khoản nợ 78: che tên qua `search_path` — VÒNG ĐẦU TIÊN TỪ S1.29 CHẠM MÃ SẢN XUẤT

**Bề mặt an ninh:** **141 dòng `db/migrations/hardening.always.sql`** (hằng `VAI_KET_NOI_UNG_DUNG` — thành
viên bắc cầu của `app_api`/`app_unseal` trừ superuser — và sáu mục `[S1.34 / khoản nợ 78]`: REVOKE TEMP và
CREATE ON DATABASE khỏi PUBLIC và khỏi mọi vai kết nối ứng dụng — tự chữa; schema trùng tên vai kết nối,
và quan hệ trùng tên public trong một schema vai có USAGE — phán xét) và **1 dòng mã
`packages/db/src/vai-tro.ts`** (`SET ROLE …; DISCARD TEMP` một câu ở mỗi lần giao client). Cả hai chạy ở
mọi `migrate()` / mọi lần cầm client của sản xuất; không migration đánh số, không đụng lược đồ hay đường
xác thực. Còn lại: `db/migrations.int.test.ts` (+2 test `[khoản nợ 78]`), sáu tệp tài liệu và tệp này.
**[S1.35] Mục này viết BÙ ở vòng S1.35** — lượt soi 25b NẶNG-2: lượt soi 24 từng treo dưới `# §S1.32` vốn
khai *0 mã sản xuất*, nên vòng đầu tiên chạm mã sản xuất từ S1.29 không có dòng bề mặt an ninh.

## Lượt soi đối kháng 24 — chạy TRƯỚC khi §S1.34 được viết, trên bản đầu của lớp

**Hình thức:** một `security-reviewer` độc lập, không có shell (đọc sáu mục hardening mới, hai test,
`vai-tro.ts`, `rbac.ts`, khối `[CR2-T3]`, `dungRoleTrienKhaiThuong`), được giao sáu hướng phá: đường che
tên còn lại, tác dụng phụ vận hành của `REVOKE TEMP`, cấp qua nhóm/bậc hai, dollar-quote, test, lời khai.
Mọi phát hiện được người viết đo lại trên PostgreSQL 16 thật.

| # | mức | phát hiện | đo được | sửa |
|---|---|---|---|---|
| 1 | NẶNG | Thiếu thu hồi **CREATE ON DATABASE**: tiền đề *app_api không tạo được schema* chỉ được ĐO ở ACL mặc định, không mục nào GIỮ; CREATE trôi ⇒ app_api tự `CREATE SCHEMA app_api` — che BỀN cho mọi kết nối, kéo tới deploy sau | **đo:** với CREATE, app_api dựng được schema + bảng, `sessions` trần đếm 0; migrate() chỉ phán xét, không gỡ CREATE | cặp mục CREATE cùng khuôn TEMP (PUBLIC + vai theo tính chất); test: CREATE bị thu hồi ở lượt sửa dù lượt phán xét gãy, sau đó `CREATE SCHEMA` 42501; đột biến no-op ⇒ đỏ đúng khẳng định |
| 2 | NHẸ | Bảng tạm tạo TRƯỚC lần deploy mang lớp không bị REVOKE gỡ — namespace tạm đã khởi tạo vẫn còn USAGE | **đo:** đúng — cùng kết nối, sau REVOKE, đếm 0, INSERT vẫn vào; `DISCARD TEMP` xoá; ghép được cùng SET ROLE một câu, chạy được trong giao dịch | `vai-tro.ts`: `SET ROLE …; DISCARD TEMP` một câu ở mỗi lần giao client; test: cùng `pg_backend_pid`, lấy lại đã sạch |
| 3 | NHẸ | `SET search_path` trong phiên không bị chặn/tái khẳng định; phán xét chỉ soi schema TRÙNG TÊN vai, không soi schema khác mà vai có USAGE | suy đoán đúng về ngữ nghĩa; **đo:** hôm nay không vai nào có USAGE ngoài public | mục phán xét *quan hệ trùng tên public trong schema vai có USAGE* — bản đầu *không USAGE ngoài public* bị evidence bác ngay (hai fixture hợp lệ `khac`, `gia` gãy), thu hẹp về đúng cơ chế; test: `zz_khac.khong_trung` đi qua, `zz_khac.sessions` ⇒ gãy nêu `app_api -> zz_khac.sessions` |
| 4 | NHẸ | Mục gộp ba grantee trong một REVOKE + hậu điều kiện gọi thẳng `has_database_privilege('app_unseal')`: role vắng ⇒ 42704 ở lượt sửa (PUBLIC không được thu hồi) và lỗi thô ở lượt phán xét | đúng theo đọc | PUBLIC tách riêng; vai qua vòng DO mỗi vai một REVOKE; hậu điều kiện `coalesce(bool_and(…) FROM pg_roles, true)` |
| 5 | NHẸ | Hàm SECURITY DEFINER thuộc chủ DB tạo được bảng tạm trong PHIÊN app (TEMP kiểm theo chủ hàm) | đúng về ngữ nghĩa; grep: không hàm nào dùng TEMP; `CAU_DOC_VONG` canh mọi secdef ngoài `NGOAI_LE_DOC_VONG` | ghi ở ADR-036 ⑯ là giới hạn |
| 6 | NHẸ | Tài liệu chưa đổi ở bản đầu (ADR-036 hàng 16, STATE 78) | đúng | đã viết ở vòng này; câu *"vô hại vì qualify public."* giữ như lớp 3, không còn chịu lực |
| 7 | INFO | `has_database_privilege` đếm quyền kế thừa + PUBLIC; `GRANT g TO app_api WITH INHERIT FALSE, SET TRUE` lách được hậu điều kiện — đóng bởi BƯỚC 1 (membership hai chiều), không bởi mục này; phán xét schema nên bắc cầu | xác nhận | `VAI_KET_NOI_UNG_DUNG` dùng `pg_has_role(r, g, 'MEMBER')` (bắc cầu), chú thích nêu sự tựa vào BƯỚC 1 |
| 8 | INFO | `"$user"` phân giải theo current_user: schema trùng tên role ĐĂNG NHẬP chỉ che khi kết nối không ở SET ROLE | xác nhận | một câu điều kiện vào chú thích và test |
| 9 | INFO | Vận hành: chủ DB (`trien_khai`) giữ TEMP qua `acldefault`, superuser bỏ qua, pg_dump không cần; mọi role khác của cụm mất TEMP | xác nhận | ghi ở ADR-036 ⑯ như ràng buộc thiết kế |
| 10 | INFO | Dollar-quote lồng `"$user"` trong `$q$` trong `$khoi$`, `%I` với tên DB lạ — an toàn | xác nhận | — |
| 11 | INFO | ~~Test không rò pool~~ **[S1.35] bác — lượt soi 25b #1:** client `c3` của test khoản 78 nằm ngoài `try/finally`; container riêng mỗi test; `toContain(': app_api')` khớp cả tiền tố `app_api_login` | xác nhận | assert kèm đuôi ` —` |

**Điều đáng mang sang vòng sau:** lớp đầu đóng nửa *bảng tạm* bằng cưỡng chế nhưng nửa *schema* chỉ phán
xét trong khi tiền đề đỡ nó chưa được giữ — một lớp phải nêu cả thứ nó TỰA VÀO (ADR-036 §3⑴ nay áp cho
cột *lớp canh*). Và `ganVaiChoClient` từng chỉ khẳng định VAI của một client; nay nó khẳng định cả một
phần ĐƯỜNG TÌM TÊN (`DISCARD TEMP`); vế còn lại (`search_path` của phiên) được giữ bằng tính chất *không
có quan hệ trùng tên nào để trỏ tới* thay vì bằng một câu SET mỗi lần giao client — và bản đầu của
vế ấy nói quá, evidence bác nó trước khi PR mở. Sáu lượt soi liền (19–24) đều
bác bản đầu.

# §S1.35 — lượt soi NGANG 25 trên sáu vòng đã hợp nhất (S1.29–S1.34): sổ nợ 79–82

**Bề mặt an ninh:** 0 mã sản xuất. Hai tệp test đổi CHỈ ở chuỗi và một `finally`
(`db/migrations.int.test.ts`: client `c3` vào `try/finally`; `db/hardening-suy-tu-tinh-chat.int.test.ts`:
hai tiêu đề, hai chú thích, một thông điệp đỏ). Sổ sách: `docs/STATE.md` (hàng 79–82, biên bản 50, gạch
tại chỗ hàng 77/78 và tiêu đề biên bản 49), `docs/DECISIONS.md` (ADR-035 §2⑴/§4; ADR-036 hàng 2, 13, 16
sửa, hàng 19–22 mới, §3⑶ và §5), `docs/TEST-PLAN.md` (H19), `Handoff.md`, tệp này (hai mục §S1.33/§S1.34
viết bù, lượt soi 21 #3 gạch).

## Lượt soi 25 — lượt NGANG đầu tiên, chạy trên master `0b1d41c` SAU khi sáu vòng đã hợp nhất

**Hình thức:** hai người soi độc lập, không có shell, chạy song song, không đọc kết quả của nhau.
**25a** soi năm lớp CSDL (vị từ suy ra, tổng điều tra hàm/rule/RLS/relkind, nhân chứng, hardening
S1.34, `vai-tro.ts`) với câu hỏi *"đặt sáu lớp cạnh nhau thì cái nào lách được cái nào"*; **25b** soi
nhất quán tài liệu/mã trên `git diff bebeb41..0b1d41c` (six merge) với câu hỏi *"lời khai nào rộng hơn
mã ngay dưới nó"*. Mọi phát hiện ĐO ĐƯỢC của 25a được người viết đo lại trên một PostgreSQL 16 sạch đã
`migrate()` (bản nháp `db/zz-do-soi25.int.test.ts`, đã xoá; kết quả nguyên văn ở cột *đo được*). Khác sáu
lượt trước: lượt này KHÔNG sửa lớp nào — mọi phát hiện đi vào sổ nợ hay vào chỗ gạch, và vòng vá là vòng
kế (khoản 79–82).

### 25a — lớp CSDL: 1 CAO, 4 NẶNG, 3 NHẸ, 4 INFO

| # | mức | phát hiện | đo được | xử lý |
|---|---|---|---|---|
| 1 | **CAO** | Trigger canh có `WHEN (…)` hay `UPDATE OF <cột>` giữ nguyên tên hàm: bảng SUY RA vào tập chỉ-ghi-thêm (H19: LOGGED/TRUNCATE/ACL đều xanh) mà UPDATE cột khác và mọi DELETE đi qua. Hardening chỉ đọc `tgqual`/`tgattr` cho bảng CÓ TÊN (`CTE_TRIGGER_CHAN`); vị từ (cả hai bản) và tập rộng chỉ đọc `tgtype`/`tgenabled` | **xác nhận:** `zz1` với `BEFORE UPDATE OF a`, `BEFORE DELETE … WHEN (false)`, TRUNCATE — ba trigger `bid_chi_ghi_them`, ENABLE ALWAYS: `migrate()` OK; `UPDATE … SET b` **1 hàng**; `UPDATE … SET a` 23514; `DELETE` **1 hàng**; catalog `d.tgqual` có, `u.tgattr = '2'`; vị từ mô phỏng NHẬN `zz1` | **khoản nợ 79**; ADR-036 hàng 20 |
| 2 | NẶNG | Mọi tổng điều tra lọc `lanname = 'plpgsql'` — lý do ấy đúng cho vị từ HÌNH DẠNG (prosrc của hàm C là tên symbol) nhưng được kế thừa sang tổng điều tra, nơi tiêu chí phải *không lách được bằng cách viết*; trigger gọi hàm `internal`/C/PL khác vô hình với census, vị từ, nhân chứng; bài học *ngôn ngữ đã đổi* của `audit_append` không sang census | **xác nhận:** `suppress_redundant_updates_trigger()` trên `zz2` ⇒ UPDATE cùng giá trị `rowCount` **0**, không lỗi; `lanname = 'internal'`; `migrate()` OK; hôm nay 0 trigger không-plpgsql trong dự án ngoài fixture | **khoản nợ 79**; ADR-036 hàng 21 |
| 3 | NẶNG | ADR-036 §3⑶ *"test là đủ cho 5–10"* ↔ S1.31 cho hàng 3 lớp sản xuất *"vì bảng ấy có thể tồn tại trên cụm đã deploy"* — cùng tác nhân, cùng cụm; RESTRICTIVE `USING (false)` sau deploy sống qua mọi `migrate()`; *lớp canh: tổng điều tra* chỉ đứng trong CI | **đã đo sẵn trong kho:** `[INV-F1] ĐO` ở `rls-coverage` — `migrate()` OK với `zz_chan` còn nguyên | **khoản nợ 81** (một quyết định: hardening phán xét, hay sửa §3⑶ nói thẳng); §3⑶ ghi chú cách đọc tạm |
| 4 | NẶNG | Cơ chế THIẾU trong ADR-036: trigger BEFORE ROW trả về hàng ĐÃ SỬA (`RETURN OLD`; gán lại `NEW.cột`) — cả ba vế ⒜⒝⒞ và ⒞′ của nhân chứng xanh mà giá trị không đổi; lượt soi 23 INFO-12 gạt *"hàng vẫn vào bảng"* quá nhanh | **xác nhận:** `zz_dao` `RETURN OLD` BEFORE UPDATE: `rowCount` 1, `RETURNING` `g = 'a'` (giá trị CŨ), `n_tup_upd` 1, `calls` 1, `g` sau câu vẫn `'a'` | **khoản nợ 80** (vế ⒠ so giá trị); ADR-036 hàng 19 |
| 5 | NẶNG | `nhay_vai` là danh sách ĐEN (regex + bao đóng bậc một) ⇒ mặc định của nhân chứng là superuser, chiều nguy hiểm; lách rẻ không cần bọc: `pg_stat_activity.usename`, `current_setting('is_superuser')`, `current_setting('session_authorization')`, `pg_get_userbyid(…)`, `application_name`, bọc HAI bậc — lần thứ ba (lượt 20, 23, 25) và hai lần trước chỉ nới regex | **xác nhận:** `RE_NHAY_VAI` không khớp cả bốn chuỗi thử: `SELECT a.usename FROM pg_catalog.pg_stat_activity a …`, `current_setting('is_superuser')`, `current_setting('session_authorization')`, `pg_get_userbyid(1)` (`application_name` và bọc hai bậc: theo đọc, không đo) | **khoản nợ 80** (đảo thành danh sách TRẮNG: kịch bản chạy toàn bộ dưới `app_api`, superuser chỉ cho bộ ba khai đích danh) |
| 6 | NHẸ | ADR-036 hàng 13 xếp `NO INHERIT` vào *lỗi*; `ALTER TABLE con NO INHERIT cha` thành công và từ đó câu ghi qua cha không chạm hàng ở con; không census nào đọc `pg_inherits`; kho có fixture con INHERITS (`khac`) | **xác nhận:** `UPDATE cha` trước: 1 hàng; sau `NO INHERIT`: **0 hàng**, không lỗi | hàng 13 sửa tại chỗ (tách `CHECK … NO INHERIT` khỏi `ALTER TABLE … NO INHERIT`); hàng 22 mới; lớp là **khoản nợ 82** |
| 7 | NHẸ | Mục hardening ghim `caller_rate_limits_khach` bằng `pg_get_expr(polqual) = pg_get_expr(polwithcheck)` và `LIKE '%app.guest_session_id%'` — so theo CHUỖI CON, đúng kiểu [CR1] đã bác; [CR1] không soi (ngoài tenant), census RESTRICTIVE không (permissive), phủ lệnh thấy có policy; hệ quả: bộ đếm tốc độ không tăng — fail-open | **xác nhận:** `ALTER POLICY … USING (false AND NULLIF(…) IS NULL) WITH CHECK (cùng vế)` ⇒ `migrate()` OK; policy sau migrate vẫn mang `false AND` | **khoản nợ 82** (ghim NGUYÊN VĂN như `otp_rate_limits`) |
| 8 | NHẸ → **bác** | `poolAs` của test-support đăng nhập superuser rồi `SET ROLE` ⇒ `"$user"` = `postgres`; một schema `postgres` chứa `sessions` che bảng thật cho MỌI phép đo dưới app_api trong CI, hardening *"cố ý không phán xét"* | **bác:** với schema `postgres.sessions` (USAGE + SELECT cho app_api), `current_schemas(false)` dưới `poolAs` = **`{public}`** — `"$user"` phân giải theo `current_user` (`app_api`), không theo session_user (`postgres`), nên KHÔNG che (đếm `sessions` trần ra 0 trong CSDL nháp chỉ vì bảng rỗng — không phải bằng chứng che; lượt soi 24 #8 đã nói đúng điều này); và **mục *quan hệ trùng tên* của S1.34 BẮT** cả schema ấy: `migrate()` gãy nêu *quan hệ trùng tên public trong một schema mà vai kết nối ứng dụng có USAGE* — lời khai *hardening cố ý không phán xét* cũng sai | không mở nợ; ghi ở ADR-036 §5 là *đã xét, không thêm* |
| 9 | INFO | Triage ứng viên còn lại của ADR-036: MERGE/COPY/`ON CONFLICT … WHERE`/`SKIP LOCKED`/timeout — câu lệnh hay ném (12–14); statement trigger xoá lại qua transition table — ⒞′ bắt; event trigger re-GRANT — BƯỚC 3 đọc sau BƯỚC 2; `session_replication_role` — hàng 8; `SET LOCAL row_security = off` dưới app_api — lỗi; policy gọi hàm VOLATILE — ghim nguyên văn; `INSERT … RETURNING` bị policy SELECT lọc — *cần đo*; DEFAULT partition — hàng 10 | **đo phần cần đo:** policy `FOR SELECT USING (false)` + INSERT `WITH CHECK (true)`: `INSERT … RETURNING id` dưới `app_api` ⇒ **42501** *new row violates row-level security policy* — ồn ào; không RETURNING ⇒ OK, 1 hàng | ghi vào ADR-036 §5 *đã xét, không thêm* |
| 10 | INFO | Kịch bản nhân chứng: mọi UPDATE trên `rfq_packages`/`rfq_items`/`unseal_requests` chạy dưới superuser trong khi ở sản xuất các hàm ấy SELECT bảng khác dưới RLS — *"đi đường hợp lệ"* chỉ đúng với đường owner; hai nhân chứng AFTER-ROW là UPDATE no-op `SET role_code = role_code` | xác nhận bằng đọc (`cau(...)` không SET LOCAL ROLE) | tự siết khi khoản 80 đảo mặc định vai; đo lại số bộ ba còn dưới owner khi ấy |
| 11 | INFO | Hậu điều kiện `has_database_privilege(v, db, 'TEMP'/'CREATE')` với CHỦ database luôn true: nếu một vai kết nối ứng dụng là `datdba` (cấu hình sai) thì hai mục theo vai gãy vĩnh viễn với thông điệp sai hướng — chặn deploy đúng chiều, thông điệp không | lập luận đúng về ngữ nghĩa quyền chủ sở hữu; chưa dựng ca | ghi ở ADR-036 ⑯; sửa thông điệp / mục phán xét *không vai kết nối nào là datdba* đi cùng khoản 79/82 khi tệp mở lại |
| 12 | INFO | `SET ROLE …; DISCARD TEMP` một câu đúng (chỉ `DISCARD ALL` bị cấm trong giao dịch); `DISCARD TEMP` xoá cả bảng tạm do secdef của chủ DB tạo trong phiên ấy — thu hẹp giới hạn ⑯ về *trong một lần cầm client*; không tác dụng phụ với pool/pg_dump/extension | xác nhận bằng đọc | một câu vào ADR-036 ⑯ |

**Điều 25a nói mà không thành hàng:** mọi danh sách khai (`HAM_CANH_CHI_GHI_THEM`, `HAM_KHONG_PHAI_CANH`,
`HAM_CANH_MOT_SU_KIEN`, `RULE_DA_KHAI`, `LOAI_DA_KHAI`, `POLICY_RESTRICTIVE_DA_KHAI`,
`BANG_RLS_NGOAI_TENANT`) đều có đối chứng dương và đỏ hai chiều — cách lách rẻ nhất cho từng cái quy về
ba chỗ: lách bằng NGÔN NGỮ (#2) thoát mọi danh sách hàm; lách bằng `WHEN`/`UPDATE OF` (#1) thoát vị từ;
lách bằng *trả về hàng đã sửa* (#4) thoát nhân chứng. `RE_NHAY_VAI` là lời khai duy nhất chọn CHIỀU MẶC
ĐỊNH nguy hiểm (#5).

### 25b — nhất quán tài liệu/mã: 3 NẶNG, 9 NHẸ, 4 INFO

| # | mức | phát hiện | kiểm | xử lý |
|---|---|---|---|---|
| 1 | NẶNG | `db/migrations.int.test.ts` test khoản 78 (4): client `c3` không trong `try/finally`; một `expect` đỏ ⇒ client không trả ⇒ `db.stop()` treo tới timeout — khuôn lượt soi 20 #5 đã sửa ở tệp hardening, và mâu thuẫn lượt soi 24 #11 *"test không rò pool — xác nhận"* | đúng bằng đọc | **sửa:** bọc `try/finally`, `pid` lên `let` |
| 2 | NẶNG | `evidence/security-reviews.md` không có `# §S1.33`/`# §S1.34`; lượt soi 23/24 treo dưới `# §S1.32` khai *0 mã sản xuất* trong khi S1.34 đổi 141 dòng hardening + `vai-tro.ts`; STATE §Tham chiếu mô tả tệp này là *một dòng mỗi task* — hai task không có dòng | đúng: `git diff 0b1d41c^1..0b1d41c --stat` | **sửa:** hai mục viết bù, ghi rõ *viết bù ở S1.35* |
| 3 | NẶNG | Tiêu đề biên bản 49 khai lớp *PHÁN XÉT … USAGE NGOÀI PUBLIC* — bản đầu bị evidence bác (chính ⑶⒞ của biên bản nói vậy); mã thật phán xét *quan hệ trùng tên public trong schema vai có USAGE* | đúng | **sửa:** gạch tại chỗ, thêm câu vì sao |
| 4 | NHẸ | Tiêu đề test tổng điều tra còn *BEFORE-ROW UPD/DEL* (thiu từ S1.31/S1.32); thông điệp đỏ bảo thêm *"một câu UPDATE/DELETE hợp lệ"* (thiu từ S1.33) | đúng | **sửa** cả hai chuỗi |
| 5 | NHẸ | Chú thích *"Năm hàm AFTER-ROW UPDATE vào tập rộng"* đứng đầu một khối **25** tên (20 hàm S1.29 trộn 5 hàm S1.31, sắp theo tên) | đúng | **sửa** chú thích |
| 6 | NHẸ | *"MỌI câu ghi của kịch bản là một nhân chứng"* / *"MỌI INSERT của kịch bản là nhân chứng"* rộng hơn mã: INSERT/DELETE `roles`, INSERT `mfa_credentials` cho `tt`, UPDATE `consumed_at` chạy trần ngoài `chung()` | đúng | **sửa** chú thích và biên bản 48: *mọi câu ghi trên bảng có trigger ở sự kiện ấy*; `chuaCoNhanChung` vẫn đòi đủ bộ ba nên không mất phủ |
| 7 | NHẸ | Tiêu đề *"khai THẬT thì bảng của nó ĐƯỢC canh"* rộng hơn phép đo (d): chỉ chứng minh vị từ TRONG TEST nhận bảng; hardening ghim cứng hai tên nên `migrate()` KHÔNG canh `zz_so_moi` | đúng | **sửa** tiêu đề: *VÀO TẬP của vị từ*; phép đo đột biến với hardening đã chèn tên — không làm, ghi ở đây |
| 8 | NHẸ | Hàng nợ 77/78 đã `[ĐÓNG]` nhưng tiền đề chưa gạch (*CHƯA CÓ NHÂN CHỨNG*; *Không dòng nào REVOKE TEMP…*) | đúng | **sửa:** gạch tại chỗ |
| 9 | NHẸ | ADR-035 §2⑴ vẫn nêu *"mọi hàm plpgsql gắn BEFORE … FOR EACH ROW trên UPDATE/DELETE"* làm ví dụ tiêu chí *không lách được* — khoản 75 đã lách; §4 *"27 câu nhân chứng thay cho 24"* thiu sau S1.33 | đúng | **sửa:** gạch, ghi tiêu chí hiện tại; nối với 25a #2 |
| 10 | NHẸ | ADR-036 hàng 2 thiếu INSERT (S1.32); §5 *"(hàng 16 hôm nay là một)"* chưa gạch dù câu kế nói 16 đóng | đúng | **sửa** cả hai |
| 11 | NHẸ | Lượt soi 21 #3 cột *sửa* khai hai quyết định sau bị S1.33 đảo (`tginitdeferred`; nay CÓ ép IMMEDIATE) — không gạch, không con trỏ | đúng | **sửa:** gạch, trỏ lượt 23 #4 |
| 12 | NHẸ | Hardening mục 2/4 (`has_database_privilege` đếm cả PUBLIC): nếu mục 1/3 không thu hồi được thì 2/4 cũng gãy nhưng thông điệp chỉ nói *cấp đích danh hoặc qua nhóm* — sai hướng | đúng bằng đọc | **chưa sửa** — đụng `hardening.always.sql`, đi cùng khoản 79/82; ghi ở ADR-036 ⑯ cùng 25a #11 |
| 13 | INFO | Cặp mục 1/3 và 2/4 giống hệt trừ tên quyền; mục 6 chép một câu 9 dòng ở cả hậu điều kiện lẫn mô tả — hai bản sẽ trôi | đúng | **chưa sửa** — cùng lý do #12 |
| 14 | INFO | TEST-PLAN H19 `[S1.32] … nhân chứng INSERT là khoản nợ 77` chưa gạch dù `[S1.33]` kế bên đóng nó (INV-matrix theo) | đúng | **sửa:** gạch; ma trận tái sinh |
| 15 | INFO | *"chưa khai ⇒ tổng điều tra đỏ"* chỉ kiểm `daKhai.has(tên_mới) === false` trên hằng — đúng với bất kỳ tên mới nào; vế lọc thật của tổng điều tra không chạy lại | đúng | **chưa sửa** — INFO của test, ghi ở đây |
| 16 | INFO | `db.poolAs("app_api")` gọi ba lần trong một test ⇒ ba pool; `stop()` đóng được nên chỉ lãng phí | đúng | **chưa sửa** — INFO |

**25b kiểm và thấy KHỚP** (bằng đọc và `git diff --stat`, không chạy test): `[INV-H19]` 8→11→13→17→19→22
đúng từng bước, INV-matrix H19 = 22; `rls-coverage` 21→25, F1 46→50; `migrations.int.test.ts` 94; 36 ADR ở
ba chỗ; sổ nợ 78/12 mở ở STATE và Handoff, chuỗi 13/14/14/13/14/13/12 khớp biên bản 46–49;
`HAM_KHONG_PHAI_CANH` 45 + 2 = 47 = 28 + 19; *0 mã sản xuất* S1.30/S1.32/S1.33, S1.31 17+/2− = *19 dòng*,
S1.34 141 dòng + 1 dòng mã; *đỏ cả hai chiều* có thật ở RULE, F1 RESTRICTIVE, ngoài tenant, relkind;
`RE_NHAY_VAI` khớp lượt 23 #3, `hoan = tginitdeferred` khớp #4, vai tạm trong `finally` khớp #6, hàng rào
INSERT khớp #7; vị từ ở test và ba chỗ trong hardening cùng vế `proname IN (…)`; hai fixture `khac`/`gia`
và mục 6 chỉ đếm trùng tên — khớp; `postgres:16-alpine`. Các con số KẾT QUẢ ĐO (30/35/38 bộ ba, 41/46
trigger, 87 tổ hợp, 29 policy, `calls`, `n_tup_*`) là thứ đọc không kiểm được.

**Điều đáng mang sang vòng sau:** sáu lượt soi dọc mỗi lượt bác bản đầu của một lớp mới, và không lượt nào
đối chiếu lớp mới với lớp CŨ đã biết cùng một bài học — hai kẽ nặng nhất (#1, #2) là hai bài học S0 chưa
sang được S1.29. Cái lưới nhân chứng được siết bốn lần bằng cùng một câu hỏi; câu hỏi khác (*hàng chạm có
phải hàng đã gửi không*) chỉ hiện ra khi đặt bốn lần sửa cạnh nhau. Lượt soi ngang vì thế không thay lượt
soi dọc — nó là thứ lượt soi dọc không làm được, và nên có sau mỗi năm-sáu vòng. Bảy lượt soi liền (19–25)
đều bác một lời khai của người viết.

## Lượt soi đối kháng 26 — chạy TRÊN chính bản sổ sách này, trước commit

**Hình thức:** một `security-reviewer` độc lập, không có shell (đọc mọi đoạn `[S1.35]`/`lượt soi 25` trong
bảy tệp, bộ đọc của `[INV-H20]`, khối `c3`/`c4`), được giao sáu câu: lời khai rộng hơn nguồn; nhất quán đếm;
quy ước gạch (số `~~` chẵn, không lồng); hình dạng bảng; test; mục nào của 25 chưa có địa chỉ. **Không
NẶNG** — lượt đầu tiên từ 19. Sáu NHẸ, sáu INFO; sửa mười một, chấp nhận một.

| # | mức | phát hiện | xử lý |
|---|---|---|---|
| 1 | NHẸ | Hàng nợ 77 còn nguyên *"MỌI INSERT của kịch bản là nhân chứng"* — lời khai 25b #6 bác được gạch ở biên bản 48 và chú thích test nhưng sót bản thứ ba | gạch tại chỗ |
| 2 | NHẸ | Lượt soi 24 #11 *"test không rò pool — xác nhận"* và 23 #12 *"chỉ 1 và 2 còn hở"* bị chính lượt 25 bác mà không gạch, không con trỏ — trong khi cùng vòng đã gạch 21 #3 vì đúng lý do ấy | gạch cả hai, trỏ 25b #1 và 25a #4 |
| 3 | NHẸ | Chú thích khối vị từ (`hardening-suy-tu-tinh-chat` :156) trích NGUYÊN VĂN tiêu đề test vừa đổi — con trỏ chết trong chính tệp, lặp lời khai 25b #7 đã bác | trích tiêu đề mới kèm nhãn `[sổ nợ 60] ĐO` |
| 4 | NHẸ | 25b #12 khai *ghi ở ADR-036 ⑯* nhưng ⑯ chỉ mang nguyên nhân của 25a #11/#12, không có vế PUBLIC; ba mục hẹn *đi cùng khoản 79/82* (25a #11, 25b #12, #13) không có địa chỉ trong thân hai khoản ấy | ⑯ thêm vế PUBLIC; thân hàng 82 thêm câu *kèm khi mở tệp* |
| 5 | NHẸ | ADR-036 §5 *"bốn hàng, ba có khoản nợ"* đọc như một hàng không có nợ — trái §3⑴; thực tế 20 và 21 cùng trỏ 79 | viết lại: *cả bốn chưa có lớp — 80 (19), 79 (20–21), 82 (22)* |
| 6 | NHẸ | Hàng 79 ⑵ *"không tổng điều tra nào thấy, vị từ và nhân chứng cũng không"* và hàng 80 ⑴ *"⇒ cả ba vế ghi công"* đứng sau chữ *Đo* nhưng là SUY từ đọc bộ lọc/`chung()` — chưa chạy census trên `zz2`, chưa chạy `chung()` trên `zz_dao` | tách *đo* khỏi *theo đọc* ở STATE 79/80 và ADR-036 hàng 19 |
| 7 | INFO | Hàng 81 nói *5–10* mà thân liệt kê 5, 6, 7, 10 — bỏ 8, 9 | thêm: 8/9 có phần hardening (047) nhưng phần tổng điều tra cũng test-only |
| 8 | INFO | 25b #2 trỏ sai tệp: *"một dòng mỗi task"* là câu của STATE §Tham chiếu, không phải Handoff | sửa |
| 9 | INFO | Đầu ADR-036 khai *khoản nợ liên quan: 60, 73–76* trong khi bảng nay trỏ 77–82 | thêm 77–82 với nhãn vòng |
| 10 | INFO | Biên bản 50 ⑶ nói *gạch* cho cả chuỗi test — chuỗi test là THAY | sửa chữ |
| 11 | INFO | Cột đo 25a #5 *"không khớp cả bốn chuỗi thử"* không nêu bốn chuỗi; STATE/TEST-PLAN nêu đích danh mà nguồn không tự đứng; người soi đọc `RE_NHAY_VAI` và xác nhận cả bốn đúng là không khớp | ghi bốn chuỗi vào cột đo, tách hai ứng viên chỉ đọc |
| 12 | INFO | `db/zz-do-soi25.int.test.ts` nhắc ba chỗ là bản nháp đã xoá: kết quả đo 25a không tái lập được từ kho | **chấp nhận** — đã nói rõ là nháp; khoản 79/80/82 khi đóng phải dựng `zz1`/`zz2`/`zz_dao`/`NO INHERIT` thành test thật |

**26 kiểm và thấy KHỚP:** 82 hàng mang nhãn trạng thái, 16 `[MỞ]` = {4, 10, 15, 18, 19, 30, 67–72, 79–82}
trùng dòng tổng kết; 5 + 11 = 16 đúng từng tên; Handoff hai chỗ đúng khuôn `RE_KHOAN_NO`; 36 ADR, 56 bất
biến không đổi; ADR-036 1–22 liên tục; số `~~` chẵn ở cả năm tệp sau khi bỏ trích dẫn trong đoạn mã; hàng
79–82 đúng ba cột, con trỏ giải được; `pid` dùng được ở `c4`; 27 `.connect()` khác của `migrations.int.test.ts`
đều có `try`; chuỗi tiêu đề cũ không còn ở `docs/`/`evidence/`/INV-matrix; biên bản 50 ⑴⒜ khớp
`hardening.always.sql` 1329/1404–1406/1281 và `003_audit_events.sql:302–303`; fixture `khac` ở
`migrations.int.test.ts:2847`; `zz_chan` ở `rls-coverage:1865`; `LIKE '%app.guest_session_id%'` ở
hardening 6220. Không kiểm được bằng đọc: mọi con số kết quả đo, số test, thống kê `git diff --stat`, và
việc `db.stop()` treo thật.

# §S1.36 — khoản nợ 79: trigger canh có điều kiện và trigger ngoài plpgsql — MÃ SẢN XUẤT lần thứ hai từ S1.29

**Bề mặt an ninh:** `db/migrations/hardening.always.sql` — `VI_TU_BANG_CHI_GHI_THEM` thêm một vế ở cả hai
vế đếm (`tgqual IS NULL AND tgattr = ''`, nguyên văn với test); chốt TRUNCATE trong `CAU_CHI_GHI_THEM_VAT_LY`
thêm `tgqual IS NULL`; hằng `CAU_TRIGGER_CANH_CO_DIEU_KIEN` + một mục PHÁN XÉT mới (mọi trigger của hàm canh
ở mọi bảng dự án không được có WHEN/UPDATE OF, và phải ENABLE ALWAYS — vế thứ ba do lượt soi 27); hằng `CAU_QUAN_HE_TRUNG_TEN` gộp câu chép hai lần (lượt soi
25b #13); thông điệp hai mục TEMP/CREATE theo vai (25b #12, 25a #11). Không migration đánh số, không đụng
lược đồ hay đường xác thực. Còn lại: `db/hardening-suy-tu-tinh-chat.int.test.ts` (`[INV-H19]` 22 → 25: hằng
`VE_TRIGGER_VO_DIEU_KIEN`, cột `co_when`/`co_cot`, ba test `[khoản nợ 79]`), năm tệp tài liệu và tệp này.

**Đo trước khi viết (PostgreSQL 16):** `WHEN (false)` trên trigger TRUNCATE cấp câu lệnh là hợp lệ và
TRUNCATE đi lọt (bảng về 0 hàng) — kẽ cùng cơ chế hàng 20 ở chốt TRUNCATE, chưa ai nêu; `UPDATE OF` trên
trigger cấp câu lệnh cũng hợp lệ; 85 trigger plpgsql, 0 trigger ngôn ngữ khác.

**Đỏ đo được, cô lập từng mục:** vế vô điều kiện bỏ khỏi cả hai bản ⇒ đỏ ở guard *vế phải nằm trong vị
từ*; vế có mặt nguyên văn mà vô hiệu (`OR true`) ⇒ đỏ ở *vị từ MỚI thả bảng*; mục phán xét mới no-op ⇒
đỏ ở *migrate() NÉM*; mục bỏ vế `tgenabled` ⇒ đỏ ở `tgenabled=D`; đảo hai nhánh CASE ⇒ đỏ ở regex ghép
tên với vế; tổng điều tra ngôn ngữ lọc lại plpgsql ⇒ đỏ ở đối chứng dương; chốt TRUNCATE bỏ
`tgqual` ⇒ `migrate()` vẫn ném đúng một mục (mục phán xét mới bắt cả trigger TRUNCATE có WHEN) — hai lớp
chồng nhau, test đỏ ở khẳng định thông điệp. **Evidence bác bản đầu của vế `tgenabled`:** hai fixture của
chính tệp H19 (`so_pm` phân mảnh, `zz_cau` khoản 75) tạo trigger canh ở ENABLE thường — mục mới NÉM đúng;
fixture nâng lên ALWAYS. `[evidence] vitest thoát mã 1` trong khi cổng vẫn báo 56/56 — đúng bài học S1.34.

## Lượt soi đối kháng 27 — chạy TRƯỚC khi §S1.36 được viết, trên bản đầu của lớp

**Hình thức:** một `security-reviewer` độc lập, không có shell (đọc diff hai tệp, `CTE_TRIGGER_CHAN`,
`MAU_SCHEMA_DU_AN`, các mục S1.34, `db/migrations/*.sql`), được giao bảy hướng phá: đường khác làm hàm canh
không chạy; mục phán xét mới phán sai trigger hợp lệ; lách tổng điều tra ngôn ngữ; vị từ CŨ dựng bằng
`replaceAll` có rỗng ruột không; ba test mới; lời khai rộng hơn mã; hằng gộp có đổi ngữ nghĩa không.
Mọi phát hiện đo được được người viết đo lại trên PostgreSQL 16.

| # | mức | phát hiện | đo được | sửa |
|---|---|---|---|---|
| 1 | **NẶNG** | Mục phán xét mới đọc `tgqual`/`tgattr` mà KHÔNG đọc `tgenabled`; vị từ vẫn đếm trigger canh bất kể `tgenabled`. Trên bảng SUY RA: `DISABLE TRIGGER`, `ENABLE REPLICA`, hay ENABLE thường + `session_replication_role = replica` giữ tên hàm, bảng vẫn trong tập (LOGGED/chốt TRUNCATE/ACL xanh) mà UPDATE/DELETE đi qua, `migrate()` OK — đúng chế độ *rơi trong im lặng* mà chú thích tuyên bố đã đóng cho cột bên cạnh. Lớp duy nhất hôm nay là tổng điều tra ở test (`luon_bat`), tức chính vế khoản 81 đang treo | **đo, đúng:** `zz_dk` với `u` DISABLE ⇒ `UPDATE … SET a` **1 hàng**, bảng vẫn trong tập, `migrate()` OK (bản đầu); `u` ở 'O' + `SET LOCAL session_replication_role = replica` ⇒ UPDATE **1 hàng** | vế thứ ba `OR t.tgenabled <> 'A'` vào `CAU_TRIGGER_CANH_CO_DIEU_KIEN`, nhánh CASE nêu `tgenabled=…`, tên mục đổi; vị từ cố ý KHÔNG đọc `tgenabled` (bảng ở lại tập để LOGGED/ACL vẫn được phán), chú thích nói rõ; test (f): hai biến thể + đối chứng ENABLE ALWAYS ⇒ OK; đột biến bỏ vế ⇒ đỏ ở `tgenabled=D` |
| 2 | NHẸ | Thông điệp mục mới *"vị từ chỉ-ghi-thêm đã thả bảng này"* sai khi bảng còn một trigger canh VÔ điều kiện khác cho cùng sự kiện (vị từ đếm `> 0` nên bảng vẫn trong tập): chặn đúng, lời sai | đúng theo đọc | viết lại: *vị từ không đếm trigger có WHEN/UPDATE OF (bảng chỉ còn trong tập nếu một trigger canh vô điều kiện khác cho cùng sự kiện tồn tại) và vẫn đếm trigger tắt* |
| 3 | NHẸ | Bốn `toContain("zz_dk.u")`/`("UPDATE OF")`/`("zz_dk.d")`/`("WHEN")` không buộc chuỗi nào đi với trigger nào — BƯỚC 4 gom mọi mô tả, nên đảo hai nhánh CASE vẫn xanh | **đo:** đảo CASE trước khi sửa — theo đọc vẫn xanh; sau khi sửa ⇒ đỏ ở regex `zz_dk\.u: … có UPDATE OF` | regex ghép tên với vế + phủ định (`không có mệnh đề WHEN` cho `u`, `không có UPDATE OF <cột>` cho `d`) + `không sửa được 1 mục`; bản đầu của phủ định dùng `[^;]*WHEN` và tự đỏ vì phần hướng dẫn sửa trong mô tả cũng có chữ WHEN — siết về đúng cụm của nhánh CASE |
| 4 | NHẸ | Chú thích test khoản 79 khai *"mọi vế cũ của H19 (LOGGED, chốt TRUNCATE, ACL, ALWAYS) đều xanh"* — ALWAYS không phải vế hardening cho bảng suy ra (xem #1), và test không khẳng định bốn vế ấy | đúng theo đọc | chú thích viết lại; test khẳng định *thông điệp NÉM đúng 1 mục* (ba vế hardening cũ không có gì để phán) |
| 5 | INFO | Tổng điều tra ngôn ngữ chỉ ở test, hardening không có mục `prolang` — nhất quán với ADR-036 ㉑ và cách đọc §3⑶; nhưng cùng vòng, khoản 79 đưa WHEN/UPDATE OF vào hardening với lập luận *cụm đã deploy* — vòng đứng ở phía ⒜ của khoản 81 cho một cơ chế và ⒝ cho cơ chế kề bên; cần một câu nói vì sao | — | ranh giới ghi ở chú thích test và ADR-036 ㉑: tạo hàm `internal`/C cần superuser, PL tin cậy khác (plperl, plpython) chưa cài — ngoài mô hình đe doạ của hardening (chủ bảng không superuser); cụm đã deploy chờ khoản 81 |
| 6 | INFO | Mục mới không lọc `tgtype` nên cũng phán trigger TRUNCATE có WHEN — trùng với vế `tgqual IS NULL` ở chốt TRUNCATE; test B chỉ khẳng định *chốt TRUNCATE* nên hai lớp không được đo cô lập nhau | **đo (đột biến m3):** bỏ `tgqual` ở chốt ⇒ `migrate()` vẫn ném đúng 1 mục (mục mới) — test B đỏ ở khẳng định thông điệp | trùng là cố ý, ghi ở chú thích hằng; test B đòi cả hai lớp nêu tên (`zz_tr.t: … có mệnh đề WHEN`, *không sửa được 2 mục*) |

**Khớp — người soi kiểm bằng đọc:** mọi đường khác làm hàm canh không chạy mà giữ tên hàm quy về khoản 75 (constraint trigger/AFTER/cấp câu lệnh), `RENAME` vô hại, transition table chỉ AFTER, trigger trả `NULL` là cơ chế ADR-036 khác, kế thừa là khoản 82, phân mảnh clone giữ `tgqual`/`tgattr` trên lá; FK `ON DELETE CASCADE` vẫn qua BEFORE ROW của bảng con — theo hiểu biết PostgreSQL, **chưa đo**. Mọi `WHEN (`/`UPDATE OF` của kho (013, 014, 016, 017, 019, 022, 026, 034, 040, 041) gọi hàm có RETURN trong `HAM_KHONG_PHAI_CANH` ⇒ mục mới không phán sai; `rfq_items_cam_truncate` (thân không RETURN) không có WHEN; fixture T5 đặt WHEN/UPDATE OF lên `audit_events_chan_update` vẫn OK vì BƯỚC 2 dựng lại trước BƯỚC 3 — **đã chạy:** `migrations.int.test.ts` 94/94 với hardening mới. Tổng điều tra ngôn ngữ: `SET LANGUAGE` không tồn tại, `ALTER FUNCTION` không đổi ngôn ngữ, `internal`/C cần superuser và ghim thân hàm dựng lại, hàm plpgsql bọc không gọi được hàm trigger, `tgisinternal` chỉ do FK/constraint sinh; khẳng định hai chiều + đối chứng dương `internal` + đối chứng âm tập rộng đầy đủ. `replaceAll` không rỗng ruột: hằng nội suy nguyên văn ở cả hai vế, `.gitattributes` `*.sql text eol=lf`, guard `not.toBe`. Ba test: `DROP TABLE` trong `finally`, CREATE nhiều câu là một giao dịch ngầm, test 3 `ROLLBACK` + `release`, tên `zz_dk`/`zz_tr`/`zz_srut`/`zz_dk_tap` không trùng. `CAU_QUAN_HE_TRUNG_TEN` so từng vế với hai bản chép — không đổi ngữ nghĩa, bí danh `c`/`n`/`v` giữ nguyên nên `string_agg` vẫn phân giải. Không kiểm được bằng đọc: mọi con số 1 hàng / 0 hàng, số test.

**Điều đáng mang sang vòng sau:** khoản 79 mở vì hai bài học S0 (WHEN/UPDATE OF, ngôn ngữ) không sang được vị từ suy ra; lượt soi 27 cho thấy bài học THỨ BA cùng chỗ (`tgenabled`, S1.29 và S1.32 đã canh ở test) cũng suýt không sang hardening — người viết chép hai cột từ `CTE_TRIGGER_CHAN` mà bỏ cột thứ ba đứng ngay dưới. Câu hỏi đúng cho một mục "suy từ tính chất" là *"bảng có tên được canh những CỘT nào, và bảng suy ra thiếu cột nào"*, không phải *"lượt soi vừa nêu cột nào"*. Tám lượt soi liền (19–27, trừ 26) bác bản đầu.

# §S1.37 — khoản nợ 81: ADR-036 §3⑶ quyết bằng một tiêu chí đo được; khoản 83 mở

**Bề mặt an ninh:** 0 mã sản xuất. Ba tệp tài liệu (`docs/DECISIONS.md` ADR-036 §3⑶ + hàng 5–7, 10, 21;
`docs/STATE.md` hàng 81/83, biên bản 52; `docs/TEST-PLAN.md` H19), `Handoff.md`, tệp này. Phép đo nền chạy
bằng một test nháp (`db/zz-do-81.int.test.ts`, đã xoá; kết quả nguyên văn ở biên bản 52 ⑴) dưới vai
`trien_khai` không superuser — đúng hồ sơ deploy — trên PostgreSQL 16 sạch đã `migrate()`.

**Điều được quyết:** *cơ chế nào mà chủ database không superuser tạo được trên cụm đã deploy thì PHẢI có
mục hardening; chỉ cơ chế cần superuser mới được để ở test.* Đo: 5, 6, 7, 10, 21, 9, 22 đều tạo được bởi
chủ bảng thường (`trien_khai` sở hữu `sessions` — khác N2 cho bảng bootstrap) và `migrate()` đi qua dưới cả superuser lẫn `trien_khai`; TẠO hàm `internal`/C, `file_fdw`, `session_replication_role` (mọi cửa, kể cả `ALTER ROLE` chính mình) cần superuser;
`plperl` là extension TIN CẬY (chỉ gãy vì image thiếu `libperl.so`) — vế *PL khác chưa cài* của S1.36 bị bác.

## Lượt soi đối kháng 28 — chạy trên chính QUYẾT ĐỊNH, trước commit

**Hình thức:** một `security-reviewer` độc lập, không có shell (đọc §3⑶ mới, bảng §2, hàng 81/83, biên bản 52,
`dungRoleTrienKhaiThuong`, hardening quanh `rolconfig`/`pg_rewrite`/`pg_parameter_acl`, 18 chỗ `CREATE POLICY`
của `migrations.int.test.ts`), được giao sáu câu: ranh giới của tiêu chí; phép đo có đủ không; khoản 83 có làm
được theo khuôn không; lời khai rộng hơn đo; đếm; 25a #3 / 27 INFO-5 còn gì. Mọi câu *cần đo* được người viết
đo lại trong cùng lượt (bản nháp `db/zz-do-81{,b,c}.int.test.ts`, đã xoá).

| # | mức | phát hiện | đo được | xử lý |
|---|---|---|---|---|
| 1 | **CAO** | Tiêu chí *không bỏ phiếu từng cơ chế* mà hệ quả bỏ phiếu ngầm: chủ bảng thường tạo được bằng plpgsql mọi cơ chế trigger (1, 2, 15, 17–19) và RULE trên bảng không chỉ-ghi-thêm (3 tổng quát) — không cơ chế nào cần superuser — nhưng hệ quả chỉ nêu 5, 6, 7, 10, 21 (những gì đã có census tĩnh ở test) | **đo, đúng:** chủ bảng gắn trigger plpgsql `RETURN NULL` và RULE `DO INSTEAD NOTHING` lên `sessions`; `migrate()` dưới `trien_khai` đi qua cả hai | tiêu chí thành BA vế (catalog phân biệt được ⇒ hardening; chỉ nhân chứng phân biệt được ⇒ giới hạn có địa chỉ, nói thẳng; cần superuser ⇒ test); 83 thêm ⑹ rule rỗng mọi quan hệ và ⑺ hàm canh hình dạng ngoài BEFORE-ROW; §5 ghi giới hạn |
| 2 | **NẶNG** | *"đúng hồ sơ deploy N2"* sai ở vế chủ bảng: N2 chỉ cho `trien_khai` sở hữu database, bảng bootstrap thuộc superuser; `CREATE POLICY`/`TRIGGER`/`DISABLE`/`NO INHERIT` đòi CHỦ BẢNG — phép đo đã cho `trien_khai` sở hữu `sessions`, tức đo dưới *chủ bảng không superuser*, không phải N2 | **đo, đúng:** dưới N2 nguyên bản `CREATE POLICY ON sessions` ⇒ 42501 *must be owner*, `CREATE TRIGGER` ⇒ 42501 | ⑴ viết lại: chủ DB + được cho sở hữu `sessions` (khác N2 cho bảng bootstrap, giống mọi bảng migration tạo sau); tiêu chí nói *chủ bảng hay chủ database* |
| 3 | **NẶNG** | Thiết kế 83⑴ *[CR1] hai chiều — không policy nào ngoài danh sách ghim theo TÊN trên mọi bảng RLS* đảo nguyên lý *suy từ tính chất* của chính [CR1]; ≥ 10 test tạo policy fixture rồi mong `migrate()` OK sẽ gãy; ghim `pg_get_expr` ở hardening biến rủi ro deparse thành *chặn deploy vĩnh viễn* — cái bẫy hardening tự cảnh báo | đúng theo đọc (18 chỗ `CREATE POLICY` ở `migrations.int.test.ts`) | 83⑴ viết lại theo ADR-035 ⑵: mọi policy thuộc ĐÚNG MỘT lớp (khuôn [CR1], khuôn 027, khai đích danh); giá deparse ghi ra; số fixture sửa |
| 4 | NHẸ | Ba lời khai về cùng phép đo lệch nhau (STATE 81 có *Đo thêm*, biên bản 52 ⑴ không, ADR viết *`migrate()` (superuser)*, §S1.37 không nêu vai); `ALTER ROLE app_api SET …` 42501 không phân biệt SUSET với thiếu ADMIN OPTION | **đo:** `ALTER ROLE trien_khai SET session_replication_role` (chính mình) ⇒ 42501 — ranh giới SUSET đứng bằng đo | một đoạn ⑴ dùng chung ở cả ba chỗ; *dưới superuser VÀ dưới chính `trien_khai`* |
| 5 | NHẸ | *"8 và hàm C là ranh giới superuser — test là đủ"* rộng hơn sự thật: lớp của 8 là ENABLE ALWAYS Ở HARDENING; tiền đề SUSET tựa vào `pg_parameter_acl` mà hardening không ghim (`GRANT SET ON PARAMETER … TO app_api` lúc bootstrap sống qua `migrate()`); *hàm C cần superuser* chỉ đúng vế TẠO — GẮN thì không (built-in; extension tin cậy mang hàm trigger C) | **đo:** `CREATE EXTENSION tcn` (hàm trigger C) dưới chủ DB ⇒ OK; `moddatetime` ⇒ 42501 (không tin cậy) | ⒞ viết đúng: chỉ TẠO hàm C và SUSET; 83⑻ `pg_parameter_acl`; ADR-036 hàng 21 sửa vế S1.36 |
| 6 | NHẸ | Hai con trỏ chết sau quyết định: chú thích test *PL tin cậy khác (plperl, plpython) chưa được cài … chờ khoản 81* (plpython3u KHÔNG tin cậy); §5 *chờ khoản 81* không có [S1.37] | đúng | sửa cả hai (chú thích test là chuỗi, 0 mã sản xuất) |
| 7 | NHẸ | 83⑷ *`relkind ∉ ('r','p')`* nguyên văn sẽ đỏ trên sequence/index/composite; view `security_invoker` hợp lệ của [I2] sẽ gãy nếu *khai rỗng*; 83⑸ không ghi ba bộ lọc (`NOT tgisinternal`, `pg_temp%`/`pg_toast%`, `MAU_SCHEMA_DU_AN`) | đúng theo đọc | thân 83 ghi `v/m/f`, phân loại view I2, ba bộ lọc |
| 8 | NHẸ | 83⑴ bao trùm 82⑵ (ghim `caller_rate_limits_khach`) mà hai khoản không trỏ nhau | đúng | liên kết chéo ở cả hai |
| 9 | INFO | Đầu ADR-036 *Khoản nợ liên quan* thiếu `[S1.37] 83` | đúng | thêm |
| 10 | INFO | *"chủ DB được cài plperl"* suy từ thứ tự kiểm tra của `CREATE EXTENSION` (trusted trước khi nạp `.so`) — đúng theo mã nguồn PostgreSQL nhưng là suy luận | đúng | viết: *qua kiểm tra quyền; chưa cài thành công; suy ra cài được nếu có thư viện* |
| 11 | INFO | (6)/(10) đo trên đối tượng MỚI; ca có thật trên cụm là `DROP POLICY` trên bảng đang có / thay bảng bằng view cùng tên — chưa đo | **đo:** `DROP POLICY sessions_tenant_isolation` ⇒ `migrate()` NÉM ([CR1]); đổi tên `sessions` + `CREATE VIEW sessions` ⇒ NÉM 4 mục — hardening đã bắt ca theo tên | ghi vào ⑴: lỗ nằm ở đối tượng MỚI và ở thứ thêm vào bảng có tên mà [CR1] không đếm |
| 12 | INFO | Hai chỗ trống chờ biên bản lượt soi này còn trong tệp | đúng | thay |
| 13 | INFO | Hàng 83 đứng trước hàng 82 | đúng | dời |

**28 kiểm và thấy KHỚP:** `CÒN MỞ` 15 số trùng 14 `[MỞ]` + 1 `[NỬA]`; 4 + 11 = 15 đúng từng tên; Handoff hai
chỗ; hàng 83 ba cột, năm con trỏ giải được; các cặp `~~` mới đóng; tám mục 83 đều phán xét — không mâu thuẫn
ADR-028; `prolang` không phán FK (`tgisinternal`); BƯỚC 1 `rolconfig` RESET ALL phủ cả `session_replication_role`
nếu ai đặt được; hardening :281 tự khai hồ sơ deploy khớp N2 về vai. Không kiểm được bằng đọc: mọi mã lỗi ở ⑴.

**Điều đáng mang sang vòng sau:** một tiêu chí viết để *thôi bỏ phiếu từng cơ chế* đã bỏ phiếu ngầm ngay ở bản
đầu — bằng cách chỉ liệt kê những cơ chế đã có census: cái đã đo được gọi tên, cái chưa đo được im lặng. Bản
thân phép đo cũng chọn mô hình (cho `trien_khai` sở hữu bảng) mà không ghi là đã chọn. Cả hai đều là cùng một
lỗi: lời khai rộng đúng bằng cái người viết đã nhìn. Chín lượt soi liền (19–28, trừ 26) bác bản đầu.

# §S1.38 — khoản nợ 83 nửa RLS ⑴⑵⑶ (+ 82⑵): ba mục phán xét cho ADR-036 hàng 5, 6, 7 — MÃ SẢN XUẤT

**Bề mặt an ninh:** `db/migrations/hardening.always.sql` — bốn hằng khai (`KHACH_KHONG_PHIEN_LIT`,
`POLICY_RESTRICTIVE_KHAI` 8 hàng, `POLICY_KHAC_KHAI` 1 hàng, `BANG_RLS_NGOAI_TENANT_KHAI` 1 hàng), ba câu phán
xét (`CAU_POLICY_LOP_SAI`, `CAU_PHU_LENH_SAI`, `CAU_RLS_NGOAI_TENANT_SAI`), ba mục ARRAY sau [CR1], mục
`caller_rate_limits` ghim nguyên văn thay `LIKE`. Không migration đánh số, không đụng lược đồ. Còn lại:
`db/rls-coverage.int.test.ts` (25 → 28; bộ giải hằng `docHangHardening`, ba cổng khớp, `zz_chan` lật kỳ vọng),
`db/migrations.int.test.ts` (`[I4]` lật kỳ vọng), năm tệp tài liệu và tệp này.

**Đo:** hardening mới trên CSDL sạch đi qua; trên hai tệp test hiện có, bản đầu đỏ hai test (`zz_chan`, `[I4]`
— kỳ vọng cũ mà ADR-036 hàng 5 đã bác) và, sau khi chạy trọn `migrations.int.test.ts`, thêm 13 test trên tập
migration rút gọn (lượt soi 29 CAO-1, sửa) rồi bốn fixture con/lá (NẶNG-2, đổi kỳ vọng — `[I6]` lộ ở lượt chạy trọn tệp cuối). **Đỏ đo được, cô lập từng mục (bảy đột biến, mỗi ca khôi phục bản gốc trước khi áp):** ⑴ thành no-op ⇒ đỏ ở *RESTRICTIVE chưa khai phải làm migrate() NÉM*; ⑵ no-op ⇒ đỏ ở *quyền SELECT của app_unseal không policy nào phủ*; ⑶ no-op ⇒ đỏ ở *bảng RLS ngoài tenant chưa khai*; mục `caller_rate_limits` trả về `LIKE` ⇒ `migrate()` VẪN ném (83⑴ bắt) nhưng đỏ đúng ở *thông điệp phải chứa "RLS/policy của caller_rate_limits lệch"* — hai lớp cho một ca; mục ấy bỏ vế vai/lệnh ⇒ đỏ cùng chỗ với ca `TO app_unseal`; một ký tự trong `POLICY_RESTRICTIVE_KHAI` (`rfq_id` → `rfq_idx`) ⇒ `beforeAll` `migrate()` NÉM *rfq_items_khach không thuộc lớp nào* — cả tệp đỏ; khuôn (b1) bất khả (`polcmd = 'x'`) ⇒ 21 policy chuẩn bị phán, cả tệp đỏ. Và một bài học vận hành đo được: bản chụp hardening dùng cho đột biến bị nhiễm ca `rfq_idx` (một lần `luu` chạy sau khi khôi phục hụt), hai ca chạy trên bản nhiễm cho kết quả vô nghĩa — cổng *hai bản khớp* bắt ngay khi chạy trọn tệp; bản chụp và tệp làm việc được hoàn nguyên, hai ca chạy lại.

## Lượt soi đối kháng 29 — chạy TRƯỚC khi §S1.38 được viết, trên bản đầu của lớp

**Hình thức:** một `security-reviewer` độc lập, không có shell (đọc khối hằng và ba mục mới, [CR1], `VI_TU_CAN_CO_RLS`,
`LA_CUA_BANG_TENANT`, ba test mới, `[I4]`, mọi `CREATE POLICY`/`ENABLE ROW LEVEL SECURITY` của `db/migrations/*.sql`),
được giao bảy hướng phá: lách ⑴/⑵/⑶; chiều ngược; bộ giải hằng và cổng khớp rỗng ruột; ba test ngoài giao dịch;
lời khai rộng hơn mã. Mọi phát hiện đo được được người viết đo lại trên PostgreSQL 16.

| # | mức | phát hiện | đo được | sửa |
|---|---|---|---|---|
| 1 | **CAO** | Chiều ngược *khai mà CSDL không có* của ⑴ (b2: 8 dòng, c: 1) và ⑶ (1) chạy VÔ ĐIỀU KIỆN — khác hai mục tiền lệ neo `to_regclass(...) IS NOT NULL` (`caller_rate_limits`, `otp_rate_limits`). Trên lược đồ chưa có 009/010/017/018/027/042 — chính lược đồ của mọi fixture thư mục tạm `hardening + 001 + 002 [+ 003]` — lượt phán xét ném "khai … mà CSDL không có" | **đo (trước khi người soi về):** 13 test của `migrations.int.test.ts` đỏ cùng thông điệp ấy | chiều ngược chỉ khi BẢNG tồn tại (`to_regclass('public.' \|\| g.bang) IS NOT NULL`, tương tự ⑶); 94/94 |
| 2 | **NẶNG** | ⑵ miễn `LA_CUA_BANG_TENANT`, nhưng ⑵ chỉ sinh hàng khi con CÓ GRANT trực tiếp; đọc/ghi qua cha không cần quyền trên con, nên GRANT trên con chỉ có nghĩa cho truy cập THẲNG con — đúng ca hàng 6. Vế miễn chỉ bảo vệ bốn fixture đang GRANT lên con/lá rồi mong `migrate()` OK và đọc thẳng ra `[]`; *fail-closed là thiết kế* viết cho câu hỏi RÒ | **đo:** `CREATE TABLE zz_con () INHERITS (users); GRANT SELECT … TO app_api` ⇒ ⑵ (đã bỏ miễn) thấy `public.zz_con/app_api/SELECT`; bốn fixture sau khi tách hai nửa: con không quyền ⇒ đi qua, đọc thẳng 42501; cấp quyền ⇒ NÉM ở ⑵, đọc thẳng `[]` | bỏ hai vế miễn; bốn fixture `[CR2]`/`[I6]`/`[Minor]`/`con_tt` đổi kỳ vọng như đo; chú thích ⑵ và ADR-036 hàng 6 nói rõ *con có GRANT riêng không được miễn* |
| 3 | NHẸ | (b1) so bằng `=`: `<bảng>_khach` RESTRICTIVE/ALL/PUBLIC THIẾU một vế ⇒ `NULL` ⇒ `NOT (NULL)` lọc hàng ⇒ nhận nhầm là khuôn chuẩn; hẹp hơn lời khai và yếu hơn census test | **đo:** `zz_moi2_khach … AS RESTRICTIVE WITH CHECK (…)` ⇒ sau sửa ⑴ thấy `public.zz_moi2.zz_moi2_khach` | `AND p.polqual IS NOT NULL AND p.polwithcheck IS NOT NULL`; ca vào test trong giao dịch |
| 4 | NHẸ | `vai` chỉ `app_api`/`app_unseal`: GRANT trực tiếp cho `app_api_login`/`app_unseal_login` (hai vai kết nối thật, không mục nào canh ACL trực tiếp của chúng) không được census | đúng theo đọc | bốn vai; policy áp cho vai và thành viên kế thừa (`pg_has_role(vai, o, 'USAGE')` — RLS dùng `has_privs_of_role`); hôm nay hai role đăng nhập không có GRANT nào (câu phán xét của hardening chạy trong test rỗng) |
| 5 | NHẸ | Cổng *hai bản khớp* là `toContain` trên văn bản THÔ cả tệp — bản sao thiu trong chú thích cũng thoả | đúng theo đọc | `expect(docHangHardening("POLICY_RESTRICTIVE_KHAI")).toBe(…)` — so với CHÍNH hằng; hai hằng kia cùng khuôn |
| 6 | NHẸ | Chú thích *"[CR1] vẫn phán policy này (vai_tro app_api không có trong NGOAI_LE)"* sai: `HINH_DANG_CHUAN` toàn cục, không khoá vai/lệnh; thứ chặn *thu hẹp vai của `_tenant_isolation`* là ⑵, không phải [CR1] | **đo:** `ALTER POLICY users_tenant_isolation ON users TO app_unseal` ⇒ `CAU_POLICY_SAI` không kêu về `users`; ⑵ thấy `public.users/app_api/SELECT`, `/UPDATE` | sửa chú thích ở test và ở khối (a) của hardening; ca vào test trong giao dịch |
| 7 | NHẸ | Mục `caller_rate_limits` ghim hai vế nhưng không ghim `polroles`/`polcmd`: `ALTER POLICY … TO app_unseal` đi qua chính mục (⑴(c)/⑵ vẫn bắt — không phải lỗ, nhưng mục *ghim riêng* không tự chứa) | **đo:** trước sửa `TO app_unseal` ⇒ thông điệp không có *lệch*; sau sửa ⇒ có; đột biến bỏ vế ⇒ đỏ | `AND p.polroles = '{0}'::oid[] AND p.polcmd = '*'`; ca `TO app_unseal` vào test |
| 8 | INFO | ⑴ quét MỌI policy trong lược đồ dự án kể cả trên bảng CHƯA bật RLS (policy trơ) — rộng hơn lời khai *trên bảng RLS*; chiều fail-closed | đúng theo đọc | giữ mã, sửa lời khai ở chú thích |
| 9 | INFO | `LA_CUA_BANG_TENANT` chỉ một bậc `pg_inherits` với cha là bảng tenant public: cháu ở schema ≠ public của một con cũng ở schema ≠ public không vào `VI_TU_CAN_CO_RLS` ⇒ (A) không bật RLS, ⑶ không thấy — lỗ RÒ, ngoài phạm vi 83 | chưa đo (đường: `k.c1 INHERITS (public.users)`, `k.c2 INHERITS (k.c1)`, GRANT lên `k.c2`) | **khoản nợ 84** — CTE đệ quy trên `pg_inherits` |
| 10 | INFO | Lần đầu hardening chứa literal NHIỀU DÒNG phải khớp byte với deparse (`\n   FROM vendor_bid_versions v`) — an toàn nhờ `.gitattributes` `*.sql eol=lf`, nhưng người sau có thể "gọn hoá" | đúng | chú thích ngay trên hằng |
| 11 | INFO | `docHangHardening`: cắt `pg_catalog.format(` ở `)` đầu, `%%` thay sau `%k$s`, chỉ nhận hằng thụt hai khoảng trắng, NÉM trước `--`/`CASE` — không rỗng ruột với ba câu hôm nay | đúng | đối chứng: `docHangHardening("NEO_003")` phải NÉM |

**29 kiểm và thấy KHỚP:** mọi đường lách ⑴ (PERMISSIVE `USING (false)` trên/ngoài tenant, RESTRICTIVE `FOR SELECT USING (false)`, `polroles` lạ, schema ≠ public, `_khach` PERMISSIVE) đều rơi vào một nhánh bắt; 29 policy RESTRICTIVE của kho: 21 chuẩn → (b1), 8 nới → (b2), `otp_rate_limits_don_cua_so_cu` → (a); `BIEU_THUC_VAI_TRO` và `CAU_VAI_TRO` cùng thân; search_path phiên phán xét ghim `pg_catalog, public` nên deparse `FROM vendor_bids b` trần khớp; ⑵ phủ quyền mức cột, PUBLIC, `acldefault`; ⑶ lọc `relkind` đúng, chiều ngược đúng; ba test ngoài giao dịch dọn đủ, mục `caller_rate_limits` dựng lại đúng bảy cột; mọi fixture khác gọi `migrate()` với lược đồ đầy đủ không bị ba mục mới phán sai. Không kiểm được bằng đọc: mọi kết quả đo.

**Điều đáng mang sang vòng sau:** một mục hardening có chiều ngược phải hỏi *"lược đồ nào hardening sẽ gặp"* — không chỉ lược đồ đầy đủ; hai mục tiền lệ đã trả lời bằng `to_regclass`, người viết chép câu phán xét mà không chép điều kiện. Và một vế "miễn" viết cho câu hỏi này (RÒ) được mang sang câu hỏi kia (IM LẶNG) mà không đo lại — đúng lỗi 25a #1 ở dạng khác. Mười lượt soi liền (19–29, trừ 26) bác bản đầu.

# §S1.39 — khoản nợ 83 nửa catalog ⑷⑸⑹⑺⑧: năm mục phán xét — MÃ SẢN XUẤT; khoản 83 đóng trọn

**Bề mặt an ninh:** `db/migrations/hardening.always.sql` — ba hằng khai rỗng (`QUAN_HE_KHAC_KHAI`,
`TRIGGER_NGOAI_PLPGSQL_KHAI`, `RULE_KHAI`), năm câu phán xét (`CAU_QUAN_HE_KHAC_SAI`,
`CAU_TRIGGER_NGOAI_PLPGSQL_SAI`, `CAU_RULE_SAI`, `CAU_HAM_CANH_HINH_THUC_SAI`, `CAU_PARAMETER_ACL_SAI`), năm mục
ARRAY sau ba mục nửa RLS. Không migration đánh số, không đụng lược đồ. Còn lại: `db/hardening-hang.ts` (MỚI — bộ
giải hằng và `khoiValues`, dùng chung hai tệp test), `db/hardening-suy-tu-tinh-chat.int.test.ts` (25 → 28),
`db/rls-coverage.int.test.ts` (đổi import), năm tệp tài liệu và tệp này.

**Đo:** hardening mới trên CSDL sạch đi qua; trên tệp H19 đúng hai test đỏ (`zz_rule`, `zz_cau`) — kỳ vọng cũ
*migrate() OK* mà §3⑶ đã bác. `migrations.int.test.ts` 94/94 với năm mục mới — không fixture nào của kho (view, rule trên bảng sổ, trigger, phân mảnh) bị phán sai; `rls-coverage` 28/28 với module chung. **Đỏ đo được, cô lập từng mục (năm đột biến, mỗi ca khôi phục bản gốc trước khi áp):** ⑷ thành no-op ⇒ đỏ ở *migrate() NÉM* của ca view có INSTEAD OF; ⑸ no-op ⇒ đỏ ở ca trigger `suppress_redundant_updates_trigger`; ⑹ no-op ⇒ đỏ ở test `zz_rule` (khoản 73, kỳ vọng lật); ⑺ no-op ⇒ đỏ ở test `zz_cau` (khoản 75, kỳ vọng lật); ⑧ no-op ⇒ đỏ ở ca `GRANT SET ON PARAMETER … TO app_api`. Mỗi ca đỏ đúng một khẳng định `toMatch(/^NÉM/)`, các khẳng định trước nó vẫn xanh.

## Lượt soi đối kháng 30 — chạy TRƯỚC khi §S1.39 được viết, trên bản đầu của lớp

**Hình thức:** một `security-reviewer` độc lập, không có shell (đọc năm hằng và năm mục mới, module chung, ba test
mới, hai test lật, `db/migrations/0*.sql`), được giao chín hướng phá: lách từng mục ⑷⑸⑹⑺⑧; chiều ngược với hàng
chuỗi rỗng; bộ giải hằng; fixture và lược đồ hợp lệ; lời khai rộng hơn mã. Mọi phát hiện đo được được người viết
đo lại trên PostgreSQL 16.

| # | mức | phát hiện | đo được | xử lý |
|---|---|---|---|---|
| 1 | NHẸ | Chiều ngược ⑷ không neo vào đối tượng cha tồn tại — cha của quan hệ là SCHEMA; ⑸⑹ neo `to_regclass(bảng)`, ⑷ chỉ có `IS NULL` ⇒ ngày nào khai một matview do migration 05x tạo, tập rút gọn đỏ *thiu* — cùng lớp lượt 29 CAO-1, tiềm ẩn vì danh sách rỗng | đúng theo đọc | `AND EXISTS (SELECT 1 FROM pg_namespace ns WHERE ns.nspname = q.nspname)` |
| 2 | NHẸ | Vị từ "hàm canh theo hình dạng" chép nguyên văn lần hai cho ⑺ thay vì dùng chung với mục S1.36 — đúng kiểu trôi 25b #13 | đúng theo đọc (grep: hai bản) | tách `VI_TU_HAM_CANH_HINH_DANG`; test đòi cả hai mục tham chiếu hằng và danh sách tên bằng `HAM_CANH_CHI_GHI_THEM` |
| 3 | NHẸ | ⑧ ghim bốn tên vai lần hai (thay vì `VAI_KET_NOI_UNG_DUNG`/`ROLE_CANH`) và đọc ACL thô ⇒ không thấy quyền đến qua nhóm — hôm nay BƯỚC 1 che, tức ⑧ tựa vào mục khác không nói ra | **đo:** `zz_nhom83` được `GRANT SET ON PARAMETER work_mem`, `GRANT zz_nhom83 TO app_api` ⇒ ⑧ mới thấy `work_mem`; bản sửa đầu (`has_parameter_privilege` gắn từng dòng ACL) kê cả dòng của người cấp — 4 hàng thay vì 2 ⇒ đổi sang `pg_has_role(vai, grantee, 'USAGE')` | tập vai theo tính chất, quyền qua nhóm bắc cầu, không kê dòng superuser |
| 4 | NHẸ | Mục `setrole = 0` chỉ RESET `row_security`/`search_path`; `ALTER DATABASE … SET session_replication_role = replica` (superuser) áp cho mọi phiên, sống qua `migrate()` — cùng tiền đề SUSET mà ⑧ tuyên bố đóng | **đo:** sau khi thêm mục: `ALTER DATABASE … SET …` ⇒ `migrate()` OK và `pg_db_role_setting` không còn dòng ấy (tự chữa) | mục thứ ba cùng khuôn, RESET (đơn điệu) |
| 5 | NHẸ | `to_regclass(nspname \|\| '.' \|\| relname)` không quote: dòng khai có chữ hoa/dấu chấm bị phán *thiu* vĩnh viễn (đỏ ồn ào, nhưng cửa khai không mở được); kế thừa từ S1.38 | đúng theo đọc | `to_regclass(pg_catalog.format('%I.%I', …))` ở sáu chỗ (bốn mới + hai S1.38) |
| 6 | NHẸ | Chưa có biên bản/đột biến cho ⑷–⑧; ⑹⑺ thiếu đối chứng dương trong cùng test | **đo:** năm đột biến no-op — mỗi ca đỏ đúng một `toMatch(/^NÉM/)`; đối chứng ⑹ (DROP RULE ⇒ OK), ⑺ (DROP TRIGGER ⇒ OK — dựng lại BEFORE ROW thì bảng thành chỉ-ghi-thêm thiếu chốt, NÉM ở mục khác; đo) | ghi vào §S1.39; đối chứng vào hai test |
| 7 | INFO | Nhãn ⑷ nói quá: matview không phải đích DML (INSERT ném 42809) — lý do phán thực ra là đường đọc vòng (mục C); view có trigger BEFORE/AFTER cấp câu lệnh bị dán nhãn *INSTEAD OF* | đúng theo đọc | nhánh riêng theo bit 64; matview đổi lời |
| 8 | INFO | ⑺ dán nhãn INSTEAD OF (bit 64, bit 2 = 0) là *AFTER FOR EACH ROW* — không lách, view ấy đã bị ⑷ | đúng | thêm nhánh INSTEAD OF |
| 9 | INFO | Lời ⑺ hẹp hơn mã — không nói trigger TRUNCATE của hàm canh hợp lệ | đúng | thêm vào thông điệp |
| 10 | INFO | Fixture bảng ngoài tựa `file_fdw` (contrib) — image thiếu thì đỏ ở fixture | đúng | guard `pg_available_extensions` nêu tên |
| 11 | INFO | Bộ giải hằng cắt `pg_catalog.format(` ở `)` đầu; không rỗng ruột với năm câu hôm nay | đúng | không sửa (đã ghi ở lượt 29) |
| 12 | INFO | Cổng ⑷ tách tên bằng `.` — `relname` có dấu chấm sẽ vỡ (danh sách rỗng) | đúng | ghi nhận |
| 13 | INFO | Fixture [Task 6] dựng `audit_events_chan_delete` thành CONSTRAINT TRIGGER AFTER DELETE của `chan_sua_xoa()` rồi mong `migrate()` OK — ⑺ thấy hình dạng ấy, nhưng D2 dựng lại ở lượt sửa trước khi ⑺ đọc ở lượt phán xét | **đo:** `migrations.int.test.ts` 94/94 — đúng như suy luận | ghi vào biên bản |

**30 kiểm và thấy KHỚP:** view có rule `DO INSTEAD` ⇒ ⑹ bắt; `_RETURN` kín hai chiều (bảng: PostgreSQL cấm; view: đã chiếm chỗ, chỉ mục duy nhất); view trơn không updatable ném 55000, `WITH CHECK OPTION` ném 44000; bảng phân mảnh/DEFAULT partition không im lặng; `MAU_SCHEMA_DU_AN` phủ mọi schema kể cả `app_private`; `LANGUAGE sql` không viết được hàm trigger, hàm C kiểm `CALLED_AS_TRIGGER`, event trigger cần superuser, bản sao trigger trên lá `tgisinternal = false` nên ⑸⑺ thấy cả bản sao; mặt nạ bit đúng bốn góc, constraint trigger luôn AFTER ⇒ ⑺ phán (đúng ý D2); ⑧ `grantee 0`, `paracl NULL`, N2 đọc được `pg_parameter_acl`; chiều ngược ⑸⑹ neo đúng; fixture ngoài giao dịch dọn đủ; lược đồ thật của kho không có view/rule/bảng ngoài/`GRANT ON PARAMETER`, mọi `FOR EACH STATEMENT` là TRUNCATE, mọi AFTER có RETURN; fixture ở test khác mong `migrate()` OK là view trơn hoặc rule bảng sổ (BƯỚC 2 gỡ). Không kiểm được bằng đọc: kết quả chạy — đã chạy (94/94, 28/28).

**Điều đáng mang sang vòng sau:** lần đầu từ S1.29 một bản đầu không bị bác ở mức NẶNG — nhưng cả sáu NHẸ đều là cùng ba bài học cũ (chiều ngược theo cha tồn tại — lượt 29; chép vị từ thay vì dùng chung — 25b #13; ghim tên vai thay vì tính chất — ADR-028) tái xuất ở mục mới. Bài học không tự sang mục kế; người viết phải chép chúng cùng lúc chép khuôn.

# §S1.40 — khoản nợ 84 + 82⑴ trên `pg_inherits`: `LA_CUA_BANG_TENANT` đệ quy và mục phán xét kế thừa cổ điển — MÃ SẢN XUẤT; khoản 85 mở

**Bề mặt an ninh:** `db/migrations/hardening.always.sql` — `LA_CUA_BANG_TENANT` thành bao đóng bắc cầu của
`pg_inherits` (`WITH RECURSIVE` không tương quan); `VI_TU_CAN_CO_RLS` lọc `MAU_SCHEMA_DU_AN` ở vế con cháu (loại
`pg_temp`), `MAU_SCHEMA_DU_AN` dời lên trước nó; một hằng khai rỗng (`KE_THUA_KHAI`), một câu phán xét
(`CAU_KE_THUA_SAI`), một mục ARRAY sau tám mục của khoản 83. Không migration đánh số, không đụng lược đồ. Còn lại:
`db/hardening-suy-tu-tinh-chat.int.test.ts` (28 → 30), `db/migrations.int.test.ts` (94 → 95; hai fixture INHERITS lật
kỳ vọng), `db/rls-coverage.int.test.ts` (một hạn test 30 s → 180 s, xem #11), năm tệp tài liệu và tệp này.

**Đo:** khoản 84 — đường người soi 29 viết, chạy lần đầu: cháu hai bậc ngoài public, GRANT SELECT ⇒ trước
`migrate()` app_api gắn tổ chức A đọc thẳng cháu thấy hàng của B; sau: mục (A) bật ENABLE+FORCE cả con lẫn cháu,
đọc thẳng `[]`; `public.g INHERITS (k.c1)` được [CR1] miễn policy riêng. 82⑴ — hàng 22 đo lại: 1 → 0 hàng sau
NO INHERIT, cặp biến khỏi catalog; census thấy cặp INHERITS, không thấy lá/chỉ mục phân mảnh; chiều ngược bắt cặp
đã khai bị tách; `migrate()` NÉM ngoài giao dịch, NO INHERIT ⇒ đi qua. Bảng tạm kế thừa bảng tenant (lượt 31
NHẸ-4): bản đầu — mục (A) ALTER bảng tạm phiên khác ⇒ 0A000 "cannot alter temporary tables of other sessions", BƯỚC
2 nuốt, phán xét gọi `pg_temp_3.zz_tam` là bảng tenant thiếu RLS, 82⑴ cũng kêu; phiên khác (superuser, app_api gắn
đúng tổ chức) đọc qua cha KHÔNG thấy hàng của bảng tạm ⇒ nó là của riêng phiên ⇒ lọc `pg_temp` ở hai chỗ ⇒ đi
qua (đo lại). Trọn tệp trên cây cuối: `migrations.int.test.ts` 95/95, H19 30/30, `rls-coverage` 28/28; t0 209 module /
0 vi phạm. Một lần `rls-coverage` đỏ hết hạn 30 s khi ba vitest chạy chung máy — đo thẳng `migrate()` trên ba bản
hardening (hiện tại / một bậc / tắt mục kế thừa) ≈ 600 ms cả ba: không hồi quy. **Đỏ đo được, cô lập từng mục (ba
đột biến, khôi phục bản gốc trước mỗi ca, chạy lại sau bản vá lượt 31):** m1 một bậc ⇒ đỏ ở cờ RLS của cháu; tắt
hai khẳng định đứng trước ⇒ đỏ ở `g: không có policy PERMISSIVE`; m2 chiều xuôi no-op ⇒ đỏ ở census, ở
`migrate()` NÉM (`OK`), ở hai fixture lật; m3 chiều ngược no-op ⇒ đỏ ở *cặp đã khai mà bị tách*.

## Lượt soi đối kháng 31 — chạy TRƯỚC khi §S1.40 được viết, trên bản đầu của lớp

**Hình thức:** một `security-reviewer` độc lập, không có shell (đọc diff, ba hằng chung, mọi chỗ dùng
`LA_CUA_BANG_TENANT`/`VI_TU_CAN_CO_RLS`, bộ giải hằng, ADR-036 hàng 22 và §3⑶, STATE 82/84, quét INHERITS/PARTITION
trong test và migration), được giao năm hướng: đường lách cho hàng 22 và khoản 84; đúng đắn CTE đệ quy và bí danh;
hệ quả lên fixture khác; lời vs mã; ba bài học cũ tái xuất. Mọi phát hiện đo được được người viết đo lại trên
PostgreSQL 16.

| # | mức | phát hiện | đo được | xử lý |
|---|---|---|---|---|
| 1 | NHẸ | Chiều ngược 82⑴ ghim TÊN, và tên tái tạo được: cặp đã khai — NO INHERIT → RENAME con cũ → CREATE con mới cùng tên INHERITS cha → DISABLE RLS con cũ ⇒ cả hai chiều im, [CR1] không soi ngoài public, 83⑵/⑶ im; "dấu vết duy nhất" là nói quá | đúng theo đọc; ngủ vì `KE_THUA_KHAI` rỗng | sửa lời (dấu vết *khi tên không được tái dùng*; một dòng khai INHERITS là quyết định an ninh cùng hạng `NGOAI_LE_HINH_DANG`); mở khoản 85 |
| 2 | NHẸ | Ba khẳng định `not.toContain` [CR1] trên fixture NGOÀI public (`con_khac`, `k.c1`, `k.c2`) rỗng ruột — [CR1] lọc `nspname = 'public'` nên xanh với mọi phiên bản; bằng chứng miễn policy riêng thật chỉ có `con_tt` | đúng theo đọc | bỏ khẳng định rỗng; thêm ca chịu lực `public.g INHERITS (k.c1)` — **đo:** m1 đỏ ở `g: không có policy PERMISSIVE` khi tắt hai khẳng định đứng trước; sửa lời ở hardening và test |
| 3 | NHẸ | Lời biện minh "phân mảnh không xét vì DETACH làm lá thành tenant độc lập và [CR1] bắt" chỉ đúng cho lá public; lá ngoài public: đã RLS ⇒ 83⑶, tạo-và-tách giữa hai deploy ⇒ không mục nào — cùng cơ chế hàng 22 | đúng theo đọc | ba tầng trong chú thích; ADR-036 hàng 22 ghi DETACH cùng cơ chế; tầng ba vào khoản 85 |
| 4 | NHẸ | `CREATE TEMP TABLE x () INHERITS (bảng_tenant)` hợp lệ; `VI_TU_CAN_CO_RLS` không lọc `pg_temp` nên mục (A) ALTER bảng tạm phiên khác — gãy thô hay bật được, chưa đo | **đo:** 0A000 bị BƯỚC 2 nuốt, phán xét gọi nó là bảng tenant thiếu RLS (không gãy thô); phiên khác đọc qua cha không thấy hàng của nó | lọc `MAU_SCHEMA_DU_AN` ở vế con cháu của `VI_TU_CAN_CO_RLS` và ở 82⑴ (theo con; cha không thể là bảng tạm); dời `MAU_SCHEMA_DU_AN` lên; đo lại: đi qua |
| 5 | INFO | Chưa có đột biến cô lập cho vế đệ quy; "trước S1.40 hardening PASS mà cháu vẫn rò" là suy luận đọc | **đo:** m1 ⇒ `co("c2")` `{false,false}` | ghi ⑷ |
| 6 | INFO | "S1.39 tuyên bố … hụt đúng một hàng" đúng nhưng nghiêng: §3⑶ đã đặt 22 ở khoản 82; cái phân biệt được là tiền đề | đúng | sửa lời ở hardening và DECISIONS §5 |
| 7 | INFO | Chiều ngược không lọc `relispartition`: khai một cặp phân mảnh ⇒ hai chiều im, dòng khai chết không bị gọi thiu | đúng, vô hại | thêm `NOT cc.relispartition` vào chiều ngược |
| 8 | INFO | Cổng hai bản tách bằng `.` và ` INHERITS ` — cùng lớp lượt 30 #12 | đúng | ghi nhận |
| 9 | INFO | Docs chưa theo diff (bản đầu): hàng 22, STATE 82/84, CÒN MỞ, chú thích 6970 về fixture `khac` | đúng | vòng này |
| 10 | INFO | Test ĐO 82⑴ dùng CSDL chung của tệp, dọn trong finally — cùng khuôn các test ĐO khác | đúng | không sửa |
| 11 | tự tìm | Một test `rls-coverage` hết hạn 30 s (S1.39 chạy đơn 6 s) ⇒ nghi CTE đệ quy làm `migrate()` chậm | **đo:** `migrate()` trên ba bản hardening qua thư mục tạm — ≈ 600 ms cả ba; chạy đơn 28/28 | không phải hồi quy; nguyên nhân là tải máy (lượt chạy đơn có tải: mọi test của tệp chậm 3–4 lần, kể cả test không gọi `migrate()`). Evidence lần đầu trên cây cuối đỏ cùng test ấy (30014 ms) ⇒ test ĐO sáu lần `migrate()` được đặt hạn 180 s như các test ĐO ở H19; evidence chạy lại — đo trước khi đoán |

**Kiểm và thấy KHỚP (người soi):** CTE đúng và dừng (UNION khử trùng; PostgreSQL cấm kế thừa vòng); nhiều cha
leo từng nhánh; chuỗi chỉ mục phân mảnh không lai sang chuỗi bảng và bị `relkind IN ('r','p')` loại; bí danh
`ke/tt/pc/pn` không va với `c/n/p/e/h/b` ở sáu chỗ dùng; bộ giải hằng giải được hai lần `format` và
`to_regclass(format('%I.%I'))` trong literal; `NOT relispartition` chính xác là kế thừa cổ điển vì PostgreSQL cấm mọi
phép lai phân mảnh–kế thừa; bảng ngoài làm con: 82⑴ và 83⑷ thấy, không vào (A); NO INHERIT rồi INHERIT lại/sang
cha khác ⇒ chiều xuôi hoặc chiều ngược NÉM; fixture phân mảnh của kho ([CR2], [I6], `kho.audit_events`, `so_pm_a`,
`bang_cha_quen_rls_a`) đều `relispartition`; `zz_con` ở rls-coverage trong giao dịch không gọi `migrate()`; lược đồ
thật, `tests/`, `packages/` không có INHERITS.

**Điều đáng mang sang vòng sau:** ⑴ hai lớp "danh sách khai" liên tiếp (83⑷⑸⑹, 82⑴) neo chiều ngược đúng nhưng
khai theo TÊN, và tên là thứ chủ bảng tái tạo được — bài học thứ tư bên cạnh ba bài cũ: *dòng khai theo tên chỉ
đóng băng lời khai, không đóng băng đối tượng*; ⑵ bậc tự do "bảng `org_id` ngoài public không treo dưới tenant" nay
có ba kẽ tựa vào — thành khoản 85 có địa chỉ; ⑶ khẳng định PHỦ ĐỊNH (`not.toContain`) trên fixture ngoài phạm vi
của mục là kiểu rỗng ruột mới, khác đối chứng dương lượt 21 dạy: đối chứng ÂM cũng phải chứng minh mục *có thể*
kêu ở đó; ⑷ (người viết) một số đo bất thường phải được đo cô lập trước khi đặt tên cho nó — 23,8 s hoá ra là tải
máy, không phải CTE.

# §S1.41 — khoản nợ 85: bậc tự do "bảng có `org_id` ngoài `public` không treo dưới bảng tenant" thành mục phán xét — MÃ SẢN XUẤT; khoản 86 mở

**Bề mặt an ninh:** `db/migrations/hardening.always.sql` — `MAU_VI_TU_CO_ORG_ID` (vế "có cột org_id", dùng chung với
`MAU_VI_TU_BANG_TENANT`), `VI_TU_HINH_DANG_85` (hình dạng, hai chiều cùng tham chiếu), `BANG_ORG_ID_NGOAI_PUBLIC_KHAI`
(rỗng), `CAU_ORG_ID_NGOAI_PUBLIC_SAI`, một mục ARRAY sau 83⑶. Không nới `VI_TU_BANG_TENANT`. Không migration đánh
số, không đụng lược đồ. Còn lại: `db/rls-coverage.int.test.ts` (28 → 30), `db/migrations.int.test.ts` (95 → 96; ba
fixture lật), năm tệp tài liệu và tệp này.

**Đo:** `zz_s85.t (gia, org_id)` ngoài public + GRANT ⇒ app_api gắn A đọc thấy hàng của B; `migrate()` NÉM ở 85; bật
RLS ⇒ 85 im, 83⑶ kêu; DROP ⇒ đi qua. Census trong giao dịch: thấy `zz_s.t`; không thấy bảng không org_id / bật RLS /
con INHERITS `users` / lá phân mảnh của bảng tenant; NO INHERIT + DETACH ⇒ cả hai rơi vào mục; SET SCHEMA public ⇒ ra
khỏi mục; chiều ngược qua dòng khai giả lập. Hai đường thời gian ở `migrations.int.test.ts`: tách trước `migrate()`
⇒ 85, tách sau (A) ⇒ 83⑶; chuỗi RENAME + tái dùng tên + DISABLE RLS ⇒ 85 kêu đúng con cũ. Ba fixture cũ NÉM đúng
MỘT mục, lượt sửa vẫn trọn (thông báo, trigger, INSERT còn nguyên). Trọn tệp: `migrations.int.test.ts` 96/96, H19
30/30, `rls-coverage` 30/30; t0 209 / 0. **Đỏ đo được, cô lập (hai đột biến, chạy lại sau bản vá lượt 32):** chiều
xuôi no-op ⇒ census + ĐO + ba fixture lật; chiều ngược no-op ⇒ *dòng khai thiu*.

## Lượt soi đối kháng 32 — chạy TRƯỚC khi §S1.41 được viết, trên bản đầu của lớp

**Hình thức:** một `security-reviewer` độc lập, không có shell (đọc diff, tám hằng liên quan, mục (A)/BƯỚC 2–4, bộ giải
hằng, STATE 82/84/85, §31, quét fixture `CREATE TABLE <schema>.<bảng>` có `org_id`/INHERITS/PARTITION/SET SCHEMA/NO
INHERIT/DETACH trong `db/`, `packages/`, `tests/`), giao năm hướng: đường lách; phân hoạch 85/83⑶, bí danh, bộ giải,
thứ tự hằng; fixture khác; lời vs mã; bốn bài học cũ.

| # | mức | phát hiện | đo được | xử lý |
|---|---|---|---|---|
| 1 | NẶNG | Fixture `[vòng fix 1 — IM2]` (`bao_cao.audit_events`, org_id ngoài public, không RLS) bị 85 phán mà bản đầu không lật — cùng hình dạng `kho.*` đã lật, cùng tệp, sót một | **đo:** lượt chạy trọn tệp đỏ đúng test ấy, cùng lúc người soi báo | lật như `kho.*`: NÉM đúng một mục, giữ nguyên phép đo trigger/INSERT; điều 1 mang sang: census fixture phải là cơ khí |
| 2 | NHẸ | Chiều ngược 85 không chắn sentinel `('', '')` — bốn tiền lệ đều chắn; `to_regclass('""."" ')` im trên PG 16 nhờ soft-error, 42601 trên PG ≤ 15 | đúng theo đọc | `WHERE oi.relname <> ''`; meta-test sentinel cho cả năm danh sách khai rỗng (điều 2 mang sang, làm luôn) |
| 3 | NHẸ | Vế `org_id` chép bốn bản (`MAU_VI_TU_BANG_TENANT`, hai chiều 85) và hình dạng 85 chép hai chiều — bài học lượt 30 NHẸ-2 tái xuất | đúng theo đọc | `MAU_VI_TU_CO_ORG_ID` dùng chung với vị từ tenant; `VI_TU_HINH_DANG_85` dùng ở hai chiều; test đòi hai tham chiếu và cùng vế org_id |
| 4 | INFO | Lời sửa: "treo dưới bảng tenant (rồi (A) bật RLS)" bỏ qua 82⑴ đòi khai với INHERITS; cột quyền đặt "bật RLS rồi khai 83⑶" lên đầu — chỉ chuyển lời khai, [CR1] không soi policy bảng ấy | đúng | viết lại theo thứ tự DROP / SET SCHEMA public / ATTACH PARTITION; bật RLS = chuyển lời khai |
| 5 | INFO | Chú thích nói "đo: con cũ sau NO INHERIT + RENAME" mà test chỉ NO INHERIT | đúng | thêm nửa (d): RENAME + CREATE cùng tên INHERITS + DISABLE RLS con cũ ⇒ 83⑶ rồi 85 đúng tên con cũ (đo) |
| 6 | INFO | "ĐÓNG" là đóng theo TÊN CỘT: bảng đa tổ chức đặt tên cột khác im ở mọi schema kể cả public — ranh giới sẵn có của vị từ tenant, không phải 85 mở lại | đúng theo đọc | ghi vào chú thích; **khoản 86** có địa chỉ |
| 7 | INFO | Danh sách mới chưa có câu "dòng khai là quyết định an ninh cùng hạng `NGOAI_LE_HINH_DANG`" (bài học 31 #1) | đúng | thêm vào chú thích và thông điệp |

**Kiểm và thấy KHỚP (người soi):** phân hoạch 85/83⑶ kín và không chồng (cùng ba vế nền, tách bằng `relrowsecurity`);
bảng thuộc `VI_TU_CAN_CO_RLS` chưa RLS là việc của (A), 85 không kêu nhầm lên con/cháu đang treo; bí danh không va;
bộ giải giải được (`format` một lần, `VI_TU_CAN_CO_RLS` lồng ba bậc, `%I.%I` trong literal); thứ tự khai đúng; chiều
ngược neo đối tượng tồn tại; `org_id` kiểu khác uuid vẫn bắt; DROP COLUMN rồi ADD lại bắt; bảng tạm loại; DEFAULT
partition có test; cha phân mảnh ngoài public bị bắt cùng lá; bảng ngoài ⇒ 83⑷; view ⇒ (C); schema không USAGE vẫn
phán (chặt hơn hàng 16); ba `not.toContain("(khoản 85)")` đều đứng sau khẳng định dương của chính mục trên cùng hình
dạng; fixture khác (`khac.con_khac`, `k.*`, `con_tt`, `[CR2]`, `[I6]`, `kho_toi`, `[I3]`, `doc.*`, `gia`, `ke9/ke10`)
không bị.

**Điều đáng mang sang vòng sau:** ⑴ census fixture phải là cơ khí (grep mẫu cố định trước mỗi mục phán xét mới) —
sót một ở cùng tệp là bằng chứng; ⑵ ~~khuôn sentinel cần meta-test~~ làm trong vòng; ⑶ ranh giới theo tên cột
`org_id` — khoản 86, đường tính-chất là đổi `MAU_VI_TU_BANG_TENANT`, cần vòng riêng có đo trên lược đồ thật; ⑷ cửa
sổ giữa hai lần deploy: "phát hiện ở deploy kế" là mức bảo đảm của mọi mục phán xét — ghi ở ADR-036 §5.

# §S1.42 — lượt soi NGANG 33 trên S1.35–S1.41: khoản 87–89 mở, hai NẶNG tài liệu sửa tại chỗ, lời "(đo)" của S1.40 thành test — 0 MÃ SẢN XUẤT

**Bề mặt an ninh:** không đổi một dòng `hardening.always.sql`. Đổi ở test: `db/hardening-suy-tu-tinh-chat.int.test.ts`
(fixture GUC mức database vào `try/finally`; hai dòng đo hành vi ⑷/⑧), `db/migrations.int.test.ts` (96 → 97: test bảng
tạm kế thừa; đối chứng dương [CR1] ở `con_tt`; hai tiêu đề), `db/rls-coverage.int.test.ts` (meta-test sentinel quét mọi
`*_KHAI`), năm tệp tài liệu và tệp này.

## Lượt soi 33 — lượt NGANG thứ hai, chạy trên master `3811d37` SAU khi bảy vòng đã hợp nhất

**Hình thức:** như lượt 25 — hai người soi độc lập, không shell, song song, không đọc nhau. **33a** đặt mười bốn mục
phán xét/sửa mới (S1.36–S1.41) cạnh các lớp cũ ((A), [CR1], `CTE_TRIGGER_CHAN`, vị từ chỉ-ghi-thêm, trùng tên,
TEMP/CREATE, sổ kiểm toán, nhân chứng) với câu hỏi *"cái nào lách được cái nào"*; **33b** soi lời khai vs mã và con số
vs con số trên `git diff 0b1d41c..3811d37` (bảy merge). Ba phát hiện đo được của 33a được người viết đo lại trên
PostgreSQL 16 sạch đã `migrate()` (bản nháp `db/zz-do-soi33.int.test.ts`, đã xoá). Như lượt 25: không sửa lớp nào.

### 33a — lớp CSDL: 1 CAO (đo hạ), 1 NẶNG, 5 NHẸ, 6 INFO

| # | mức | phát hiện | đo được | xử lý |
|---|---|---|---|---|
| 1 | CAO → **NHẸ (đo hạ)** | `ALTER DATABASE … SET app.org_id / app.guest_session_id` bởi chủ database không superuser: ba mục GUC mức database ghim TÊN, ranh giới tenant/khách là năm GUC `app.*` ⇒ [INV-F1] *chưa gắn ⇒ 0 hàng* lật thành *⇒ tổ chức B* ngoài `withTenant`; mọi phiên thành phiên khách ⇒ 21 policy `_khach` thu hẹp ⇒ câu ghi 0 hàng | **bác ở mức:** chủ DB `zz_chu` (không superuser) ⇒ **42501** cho cả hai GUC (PG 16: placeholder chỉ superuser đặt ở mức database); `migrate()` OK; `pg_db_role_setting` rỗng; app_api không gắn ⇒ `app_current_org_id()` NULL, `count(users)` 0; gắn A ⇒ 1 | vế ⒞ §3⑶; phần theo tính chất + `withTenant` → **khoản 87** |
| 2 | NẶNG | `CAU_PHU_LENH_SAI` (83⑵) ghim bốn tên vai — bản chép thứ ba — trong khi ⑧ đã đổi sang `VAI_KET_NOI_UNG_DUNG` vì đúng lý do này; tựa BƯỚC 1 gỡ membership mà không nói ra | đúng theo đọc | **khoản 88** |
| 3 | NHẸ | `MAU_SCHEMA_DU_AN` còn ba bản chép inline (mục (C) ×2, `VI_TU_BANG_CHI_GHI_THEM`); chú thích nói "dùng lại bộ lọc của (C)" mà (C) không dùng hằng | đúng theo đọc | khoản 88 ⑴ |
| 4 | NHẸ | Fixture `ALTER DATABASE … SET session_replication_role` trên CSDL chung của H19 không `try/finally` — một `expect` đỏ ⇒ mọi kết nối mới chạy `replica`, đỏ dây chuyền sai hướng | đúng theo đọc | **sửa:** bọc `try/finally` RESET |
| 5 | NHẸ → **NẶNG (đo)** | `BANG_CHI_GHI_THEM` khai theo TÊN: RENAME sổ + DROP bốn trigger + CREATE TABLE cùng tên cùng hình dạng + policy đúng khuôn + GRANT ⇒ D2 dựng sáu trigger lên bảng mới rỗng, lịch sử ở bảng cũ không mục nào canh | **đo:** bản đầu NÉM ở **83⑴** (`audit_events_cu.audit_events_khach` RESTRICTIVE chưa khai — chặn nhờ danh sách theo TÊN khác); thêm `DROP POLICY audit_events_khach ON audit_events_cu` ⇒ `migrate()` **OK**, bảng mới 0 hàng với 4 trigger, bảng cũ 1 hàng không trigger | **khoản 89** |
| 6 | NHẸ | Khoản 86 đường hai câu: `RENAME COLUMN org_id TO to_chuc` + `DISABLE ROW LEVEL SECURITY` trên `users` | **đo:** hai câu ⇒ NÉM ở 83⑴ (`to_chuc = …` không thuộc lớp nào); thêm `DROP POLICY` ×2 ⇒ `migrate()` **OK**, app_api gắn A đọc thấy `a@a`, `b1@b` | ghi số vào khoản 86; cùng bài học 89 |
| 7 | NHẸ | `not.toContain("con_tt: không có policy PERMISSIVE")` là bằng chứng duy nhất còn lại cho "miễn policy riêng", không có đối chứng cùng test rằng [CR1] CÓ THỂ kêu | đúng theo đọc | **sửa:** `zz_doc` ở public không policy ⇒ NÉM `zz_doc: không có policy PERMISSIVE`, `con_tt` không |
| 8 | INFO | Bộ giải hằng: tham số `format` chứa `$`, `,`, `(`, `)` cho SQL sai mà có thể vẫn chạy; hôm nay `'%2$s'` đúng vì `$s` không phải mẫu thay thế JS | đúng theo đọc | khoản 88 ⑸ |
| 9 | INFO | Meta-test sentinel ghim năm tên — danh sách thứ sáu bị làm rỗng sau này không được kiểm | đúng | **sửa:** quét mọi `*_KHAI`, đếm rỗng = 5 |
| 10 | INFO | Hai thông điệp thiếu nhãn khoản/hàng ADR (`CAU_TRIGGER_CANH_CO_DIEU_KIEN`, `CAU_HAM_CANH_HINH_THUC_SAI`) | đúng | khoản 88 ⑵ |
| 11 | INFO | 79/⑺ chỉ xanh trên bảng sổ vì D2 sửa ở BƯỚC 2 trước — biên bản có, chú thích hằng không | đúng | khoản 88 ⑶ |
| 12 | INFO | Test đo hình dạng, lời nói hành vi: ⑷ không UPDATE nào lên view INSTEAD OF; ⑧ không đo app_api đặt được `replica` | đúng | **sửa:** UPDATE ⇒ 0 hàng; `SET ROLE app_api; SET … = replica` OK sau GRANT, 42501 sau REVOKE |
| 13 | INFO | Trigger plpgsql có RETURN chép NEW sang bảng không `org_id` rồi GRANT — không mục nào kêu; vế ⒝ §3⑶ | đúng theo đọc | nối vào khoản 86 |

**33a kiểm và thấy KHỚP:** chiều ngược bảy danh sách khai neo cha tồn tại và `to_regclass(format('%I.%I'))`; lọc
`pg_temp` ở mười hai mục mới; phân hoạch 85/83⑶ kín; bí danh không va kể cả lồng ba bậc; bộ giải: `NEO_003` ném, cổng
hai bản so với chính hằng; các đường lách khác đều rơi vào một mục — `ALTER POLICY … TO` ⇒ 83⑵; RENAME policy đã khai ⇒
đỏ hai chiều; `NO FORCE` ⇒ (A) bật lại mỗi lượt; `DISABLE TRIGGER USER` ⇒ 41 trigger có tên ghim `'A'` + 79 cho hàm canh
suy ra; `ALTER FUNCTION app_current_org_id() SET search_path` ⇒ `proconfig IS NULL` và R3 dựng lại; DROP FUNCTION CASCADE
⇒ [CR1]; event trigger cần superuser; SECDEF ngoài public ⇒ (C); DETACH/ATTACH/INHERIT ⇒ 82⑴/83⑶/85; bảng tạm ⇒ loại
đúng; SET SCHEMA qua lại ⇒ 83⑶ rồi 85 rồi [CR1].

### 33b — nhất quán tài liệu/mã: 2 NẶNG, 11 NHẸ, 6 INFO

| # | mức | phát hiện | kiểm | xử lý |
|---|---|---|---|---|
| 1 | NẶNG | Sổ đăng ký F1 (TEST-PLAN:99, và INV-matrix sinh từ nó) khai *"phủ lệnh (miễn con của bảng tenant)"* — mã KHÔNG miễn (lượt 29 NẶNG-2 bỏ trước khi S1.38 hợp nhất); sống bốn vòng qua ba lượt dọc | đúng: `CAU_PHU_LENH_SAI` không có `LA_CUA_BANG_TENANT`; test `[Minor] con INHERITS` mong NÉM ở ⑵ | **sửa:** gạch + nhãn, tái sinh ma trận |
| 2 | NẶNG | Lời *"(đo)"* về bộ lọc `pg_temp` (S1.40) ở sáu tài liệu mà kho không tái lập: không test `CREATE TEMP TABLE … INHERITS`, ba đột biến S1.40 không chạm bộ lọc — gỡ hai bộ lọc thì không test nào đỏ | đúng: grep diff test | **sửa:** test thật ở `migrations.int.test.ts` + **hai đột biến đo** (bỏ lọc ở vế con cháu ⇒ (A) phán `pg_temp_N.zz_tam`; bỏ ở 82⑴ ⇒ cặp `pg_temp` chưa khai) — đỏ cả hai |
| 3 | NHẸ | S1.39 khai *"năm mục ARRAY"* — diff có SÁU (năm phán xét + mục tự chữa RESET GUC mức database) | đếm `ARRAY[` | **sửa** biên bản 54 |
| 4 | NHẸ | Câu *"§3⑶ thực hiện trọn"* (biên bản 54, ADR-036 §5) bị lượt 31 INFO-6 bác mà S1.40 chỉ viết thêm, không gạch | đúng | **sửa:** gạch + nhãn ở hai nơi |
| 5 | NHẸ | ADR-036 hàng 9 chỉ nói tổng điều tra (S1.29) dù S1.36 có lớp sản xuất (`tgenabled <> 'A'`) | đúng | **sửa** |
| 6 | NHẸ | Hàng 21 *"CHỈ Ở TEST"* chưa gạch; hàng 22 *"⇒ khoản 85"* ×2 như còn mở | đúng | **sửa** |
| 7 | NHẸ | ADR-036 §4 *"bốn danh sách khai mới"* thiu (nay tám); giá deparse chỉ nói ở test dù đã ở hardening | đúng | **sửa** |
| 8 | NHẸ | Sổ nợ 82/83/84: tiền đề đã đóng chưa gạch | đúng | **sửa** |
| 9 | NHẸ | Sổ nợ 79: hai vế bị bác chưa gạch (*CHỈ Ở TEST*; ranh giới superuser) | đúng | **sửa** vế thứ nhất; vế thứ hai đã có nhãn 81 kề bên |
| 10 | NHẸ | TEST-PLAN đoạn *Giới hạn của H19* còn *"tổng điều tra ấy chỉ ở test"* | đúng | **sửa** |
| 11 | NHẸ | STATE §Tham chiếu mô tả `security-reviews.md` là *"một dòng mỗi task"* (25b #2 đã bắt, lượt 26 chỉ sửa con trỏ) | đúng | **sửa** |
| 12 | NHẸ | Chú thích test H19 *"Vì sao CHỈ Ở TEST … Mục hardening prolang là khoản nợ 83⑸"* — cùng tệp có test 83⑸ NÉM | đúng | **sửa** |
| 13 | NHẸ | Hai chú thích *BẬC TỰ DO CÒN LẠI* cũ trong hardening chưa gạch (RESTRICTIVE no-op; bảng tenant ngoài public) | đúng | khoản 88 ⑷ — không đụng hardening ở vòng này |
| 14 | INFO | Biên bản 53 thiếu vế *"N có hình dạng mã nguồn"* | đúng | **sửa** (mười hai) |
| 15 | INFO | Tiêu đề test 84/85 nói *"trước … migrate() đi qua"* mà test không đo bản cũ (chỉ đột biến) | đúng | **sửa** tiêu đề |
| 16 | INFO | Biên bản 51/53/54 tiêu đề ⑷ lặp hai lần | đúng | **sửa** 53/54 |
| 17 | INFO | ADR-036 hàng 11 (constraint trigger DEFERRED) không nằm ở vế nào của §3⑶ | đúng | **sửa:** một câu — điều kiện đo, không phải cơ chế |
| 18 | INFO | Hai lời hẹn không địa chỉ: nhịp lượt ngang; FK CASCADE qua BEFORE ROW *chưa đo* từ lượt 27 | đúng | nhịp → Handoff; FK → khoản 88 ⑹ |
| 19 | INFO | *Chép vị từ thay vì dùng chung* chưa có lớp máy (chỉ cổng từng ca) | đúng | ghi nhận — mang sang |

**33b kiểm và thấy KHỚP:** H19 22→25→28→30 và INV-matrix 30; rls-coverage 25→28→30, F1 50→55; migrations 94→95→96;
Handoff hai dòng khớp biên bản 50–56; CÒN MỞ 14 = 13 [MỞ] + 1 [NỬA]; hai câu đếm khớp từng vòng; hàng 79–86 ba cột,
không `||` trần; mọi tên hằng ở STATE/ADR-036/§S1.3x tồn tại đúng chữ trong diff; *0 mã sản xuất* S1.35/S1.37 đúng;
36 ADR; §S1.35–§S1.41 đủ bảy; lượt 26–32 đủ *kiểm và thấy khớp*; các kỳ vọng lật đều mang gạch + nhãn; lượt 26 #12
đã được 79 và 82⑴ thi hành.

**Điều đáng mang sang vòng sau:** ⑴ *"(đo)"* phải có địa chỉ test hoặc tự khai là nháp — lần này nó lọt vào cả sổ
đăng ký bất biến; ⑵ lượt soi dọc phải nhận diff TEST-PLAN/INV-matrix trong phạm vi bắt buộc — câu sai sống bốn vòng
vì không ai đọc hàng F1; ⑶ bảng ADR-036 tự khai là NGUỒN nhưng chỉ hàng MỚI được cập nhật — meta-test rẻ: mọi
`CAU_*_SAI` phải được nhắc ở một hàng §2 và ngược lại (khuôn `[INV-H20]` P4); ⑷ con số "N mục" đếm cơ khí; ⑸ bài học
không tự quay lại mục TRƯỚC (83⑵) lẫn danh sách CŨ NHẤT (`BANG_CHI_GHI_THEM`) — và bài học thứ năm: *danh tính theo
tên hay hình dạng đều tái tạo được, chỉ `oid` là không*; ⑹ câu hỏi ngang kế: *mọi thứ policy/hàm ghim ĐỌC VÀO là gì,
và ai đặt được nó trước khi phiên bắt đầu* — GUC, `pg_db_role_setting` mọi setdatabase, `options=` trên chuỗi kết nối.

# §S1.43 — khoản nợ 89 + 86: danh tính đối tượng canh là ba kênh (ADR-037) — MÃ SẢN XUẤT; bốn bản, hai lượt soi, bộ test bác bản đầu trước người soi

**Bề mặt an ninh:** `db/migrations/hardening.always.sql` — `MAU_NEO` (chú thích `neo: <schema>.<bảng> org_id#<attnum>`),
`BANG_TENANT_KHAI` (29 tên kèm tên tệp migration khai sinh), `VI_TU_PHAI_NEO`, `CAU_NEO_SUA` (lượt sửa ghi neo, WARNING
cho tên đã khai), `CAU_NEO_SAI` (~~bảy~~ tám vế ⑴⑵⑵′⑶⑷⑷′⑸⑹ — 40b #7), một mục ARRAY. Không migration đánh số, không bảng mới, không GRANT — hồ sơ N2
giữ nguyên. Còn lại: `db/migrations.int.test.ts` (97 → 101: ba test neo + N2 nhánh 4), `db/rls-coverage.int.test.ts`
(30 → 31: hai bản khớp + câu phán xét chạy trong test), sáu tệp tài liệu và tệp này.

**Đo:** hai kịch bản 33a #5/#6 nay NÉM ở mục danh tính — kể cả sau khi xoá policy sót (83⑴ im), gỡ chú thích (⑷ còn),
đổi tên cột phụ của bản sao (bộ ba chuỗi còn); chép bảng bỏ `org_id` đè tên ⇒ ⑹; đổi tên cột rồi thêm cột `org_id` mới
DEFAULT A ⇒ ⑵′; N2 nhánh 4 (cụm cũ + vai deploy không sở hữu) ⇒ GÃY đúng ⑶, chủ bảng chạy một lần ⇒ đi qua. Trọn tệp:
`migrations.int.test.ts` 101/101, `rls-coverage` 31/31, H19 30/30, audit 22/22; t0 209 / 0. **Bản đầu** (bảng neo +
049) làm 12 test hồ sơ N2 đỏ ở lượt chạy trọn tệp — bộ test bác trước người soi. **Đỏ đo được, cô lập (bốn đột biến,
chạy lại trên bản bốn):** phán xét no-op ⇒ 89(a)/86(a)/ranh giới; lượt sửa no-op ⇒ khẳng định neo đầu; bỏ ⑹ ⇒ chép bảng;
bỏ ⑷ ⇒ 89(c) + `kho.so_chep`.

## Lượt soi đối kháng 34 — chạy TRÊN BẢN ĐẦU (bảng `app_private.neo_danh_tinh` + migration 049), bản ấy bị bỏ

**Hình thức:** một `security-reviewer` độc lập, không shell. Bản đầu đã bị 12 test N2 bác trước khi kết quả về; bảng dưới
ghi để đối chiếu điều người soi thấy bằng đọc với điều bộ test thấy bằng chạy, và điều nào SỬA QUYỀN cũng không đóng.

| # | mức | phát hiện | đo được | xử lý |
|---|---|---|---|---|
| 1 | CAO | `to_regclass('app_private.neo_danh_tinh')` ở cột điều kiện ném 42501 dưới vai deploy N2 (không USAGE `app_private`) ⇒ lượt sửa gãy trước vòng migration đánh số; 049 chạy dưới vai deploy cũng không CREATE được trong schema thuộc superuser | **đo:** 12 test đỏ, "permission denied for schema app_private" ở lượt sửa | bỏ bảng neo; kênh ① không cần quyền ngoài sở hữu bảng |
| 2 | CAO | Chìa nằm cạnh ổ khoá: bảng neo do chủ thể bị canh sở hữu — DROP/SET SCHEMA/UPDATE oid ⇒ mục im; không mục nào canh tiền đề "049 đã chạy ⇒ bảng neo tồn tại" | đúng theo đọc | không còn bảng neo; ② sống trong git |
| 3 | NẶNG | Tự gỡ dòng tenant không đơn điệu (ADR-028 §2⑵) và mở đường CHÉP bảng bỏ `org_id` đè tên — dữ liệu không mất, "DROP là mất dữ liệu nhìn thấy được" sai | **đo (bản ba/bốn):** chép bảng ⇒ ⑹ NÉM | ② tên đã khai + ⑹; lượt sửa chỉ thêm |
| 4 | NẶNG | Handoff "48 migration" và danh sách `applied` ghim tay đỏ với 049 | **đo:** hai test đỏ | không còn 049 |
| 5 | NẶNG | Khôi phục logic cấp oid mới, giữ dữ liệu bảng neo ⇒ mọi dòng neo lệch đúng lúc DR | đúng theo đọc | ① được `pg_dump` chép theo bảng; ② không phụ thuộc oid |
| 6 | NHẸ | Khoản 86 chưa đóng trọn — nửa gốc (bảng mới tên cột khác) không được neo | đúng | STATE 86: nửa đo được đóng, nửa gốc mở |
| 7 | NHẸ | CTE data-modifying: INSERT không thấy DELETE cùng câu — DROP+dựng lại trong một migration cần hai lượt sửa | đúng | không còn CTE ấy |
| 8 | NHẸ | Lớp SỬA (D2/`CTE_TRIGGER_CHAN`) vẫn theo tên | đúng | khoản 88 kèm; ADR-037 §5 |
| 9 | NHẸ | Không census qua bộ giải; không đột biến cho vế ⑶/tự gỡ; ADR-037 chưa tồn tại | đúng | census ở rls-coverage; bốn đột biến; ADR-037 viết trong vòng |
| 10 | INFO | 049 neo theo tên lúc chạy — bảng giả đã dựng trước 049 được neo | đúng | ranh giới ghi ở chú thích (lượt sửa đầu tiên cũng vậy) |
| 11 | INFO | WARNING BƯỚC 2 khi tự gỡ chưa được test khẳng định; chủ DB DoS deploy bằng bảng `org_id` lạ + RENAME | đúng | tự gỡ bỏ; WARNING ghi-lấp thêm ở bản bốn |

## Lượt soi đối kháng 35 — chạy trên BẢN BA (chú thích neo + tên đã khai + hình dạng "đủ 15 cột")

| # | mức | phát hiện | đo được | xử lý |
|---|---|---|---|---|
| 1 | CAO | Kênh ③ "đủ 15 cột" đổ bằng một `RENAME COLUMN user_agent` trên bản sổ cũ sau khi gỡ chú thích ⇒ `migrate()` OK, lịch sử ở bản cũ sửa xoá tự do; "còn lại ②③" rỗng cho sổ | **đo:** thêm bước (c2) vào test 89 — bản bốn NÉM | ③ = bộ ba chuỗi `seq/prev_hash/hash` (bỏ là hết giá trị sổ); ranh giới nói thẳng: chủ bảng phá bộ ba của bản sao |
| 2 | CAO | Cụm bootstrap trước S1.43 + vai deploy không sở hữu bảng: lượt sửa không ghi được neo ⇒ ⑶ chặn deploy đầu tiên; ba test N2 xanh chỉ vì bootstrap của chúng đã chạy hardening S1.43 bằng superuser | **đo:** test N2 nhánh 4 — gỡ mọi neo rồi migrate bằng `trien_khai` ⇒ GÃY đúng ⑶ (1 mục), chủ bảng chạy một lần ⇒ đi qua | nói ra ở ADR-037 §5, thông điệp ⑶ nêu lối ra, test ghim |
| 3 | NẶNG | `to_regclass(substr(chú thích, 6))` chạy trên chuỗi do chủ bảng bất kỳ đặt: `'neo: '`, `'neo: a b'` ⇒ 42601; schema không USAGE ⇒ 42501 — BƯỚC 3 không bọc ⇒ lỗi thô xuyên bản gom | đúng theo đọc | ⑴ đối chiếu catalog (`split_part` trên marker của chính catalog), không parse |
| 4 | NẶNG | `audit_chain_anchors` không có kênh hình dạng — đổi tên + dựng lại + gỡ chú thích ⇒ đi qua | đúng theo đọc | ⑷′ bộ ba mốc neo `seq/hash/anchored_at`; test `kho.moc_chep` |
| 5 | NẶNG | Danh tính CỘT `org_id` vẫn là cái tên: đổi tên cột rồi `ADD COLUMN org_id DEFAULT A` + policy đúng khuôn ⇒ tên ✓ tenant ✓ [CR1] ✓ ⇒ app_api gắn A đọc mọi hàng | **đo:** test 86 (e) — bản bốn NÉM ⑵′ (attnum) | ① neo attnum của `org_id`; census rls thêm ca thêm cột |
| 6 | NHẸ | Hai bảng sổ khai hai lần (BANG_TENANT_KHAI + nhánh sổ) ⇒ dòng đôi | đúng | nhánh sổ chỉ thêm tên chưa khai |
| 7 | NHẸ | ⑶ khẳng định nguyên nhân "không ghi được" cả khi oid đổi/chú thích bị gỡ; ghi-lấp im lặng là chỗ oid đổi mà không ai biết | đúng | ⑶ trung tính, nêu ba nguyên nhân + lối ra; `CAU_NEO_SUA` WARNING cho tên đã khai |
| 8 | NHẸ | ⑴ nhầm bảng thật là bản sao trong lời; `q` không lọc `MAU_SCHEMA_DU_AN` | đúng | lời "một trong hai là bản sao"; lọc schema |
| 9 | INFO | `pg_dump --no-comments`, logical replication, DR thủ công không chép chú thích | đúng | ADR-037 §5 / runbook |
| 10 | INFO | Lá phân mảnh: cổng hai bản đòi khai từng lá; lá động làm cổng đỏ | đúng | ghi ở ADR-037 (khai theo cha khi có bảng phân mảnh đầu tiên) |

**35 kiểm và thấy KHỚP:** escape LIKE trong `$khoi$` (bản bốn bỏ LIKE, khớp `=` tên tệp); nhãn `$neo$` lồng `$q$` không va;
cột điều kiện chắn `schema_migrations`; bootstrap sạch không đỏ ⑶ (lượt sửa chạy lại sau migration đánh số); bộ giải hằng
giải năm hằng mới; regex bản khai so tập, không xanh mù; SET SCHEMA + dựng cùng tên + gỡ chú thích ⇒ 83⑶/85; VIEW/FOREIGN
thay bảng ⇒ ⑸; TEMP cùng tên không rơi vào `to_regclass` (bản bốn không còn to_regclass); `objsubid ≠ 0` không đụng kênh;
tên chữ hoa/dấu chấm hai phía cùng `quote_ident`; fixture khác (`k.con2`, CR2a `toContain`, không test nào đếm
`pg_description`) không bị.

**Điều đáng mang sang vòng sau:** ⑴ danh tính theo hình dạng phải là *hình dạng không bỏ được mà còn giá trị* (bộ ba
chuỗi, attnum) — không phải "đủ N cột"; ⑵ đường NÂNG CẤP là một hồ sơ cần test riêng: mọi mục "lượt sửa ghi thứ chỉ chủ
bảng ghi được" phải có test "cụm cũ + vai deploy không sở hữu" (N2 nhánh 4 là khuôn); ⑶ BƯỚC 3 chưa có bất biến "không
gãy thô" như BƯỚC 2 — hàm catalog ném theo dữ liệu người khác kiểm soát xuyên qua bản gom; một `EXCEPTION` quanh vòng
BƯỚC 3 ghi "mục X không đánh giá được" là rẻ và đóng cả lớp (khoản 88 kèm); ⑷ ghi-lấp im lặng là chỗ oid đổi mà không ai
được báo — WARNING có chủ đích là lớp nhìn thấy rẻ nhất trước khi D2 chuyển sang danh tính; ⑸ bộ test bác bản đầu
TRƯỚC người soi — lượt chạy trọn tệp sau mỗi mục sửa mới là phép đo rẻ nhất của vòng, không phải bước cuối.

# §S1.44 — khoản nợ 88: mục 83⑵ lấy tập vai theo tính chất, sáu việc "kèm khi mở tệp hardening", BƯỚC 2/3 không gãy thô — MÃ SẢN XUẤT; khoản 90 mở

**Bề mặt an ninh:** `db/migrations/hardening.always.sql` — `CAU_PHU_LENH_SAI` (tập vai = `VAI_KET_NOI_UNG_DUNG` ∪ `ROLE_CANH`,
quyền theo kế thừa; `ROLE_CANH` dời lên trước), `VAI_KET_NOI_UNG_DUNG` (`'MEMBER'` → `'USAGE' OR 'SET'` — hồ sơ N3 đo),
`CAU_DOC_VONG` hai nhánh và `VI_TU_BANG_CHI_GHI_THEM` khai triển `MAU_SCHEMA_DU_AN` qua `format()` (hết ba bản chép inline),
hai thông điệp thêm nhãn, hai chú thích gạch, hai chú thích "D2 sửa trước", BƯỚC 2 (cột điều kiện) và BƯỚC 3 (trọn mục)
bọc `EXCEPTION WHEN OTHERS`. `db/hardening-hang.ts` — văn phạm tham số `format()`, split/join, kiểm thiếu tham số trước
khi thay, tên hằng có đệm. Test: `db/hardening-hang.test.ts` (T1, mới), `db/rls-coverage.int.test.ts` (31 → 32),
`db/hardening-suy-tu-tinh-chat.int.test.ts` (30 → 32), `db/migrations.int.test.ts` (101 → 102: hồ sơ N3). Không migration
đánh số, không GRANT, không bảng mới.

**Đo:** vai lạ thành viên app_api + GRANT DELETE trên bảng RLS chỉ có policy SELECT ⇒ bản bốn tên (dựng lại từ câu mới)
IM, tính chất kêu đúng một dòng. FK `ON DELETE CASCADE`/`SET NULL`/`TRUNCATE … CASCADE` từ cha ⇒ trigger hàng/TRUNCATE của
con NÉM, hàng còn nguyên; đối chứng không hàm canh ⇒ hàng mất; FK từ năm bảng chỉ-ghi-thêm đều NO ACTION. Hardening chép
ra thư mục tạm với ba mục tiêm ⇒ lượt sửa đi qua, một thông báo `(phan_xet)` gom ba dòng đúng ba tên với SQLSTATE 22012.
Bộ giải nghiêm bắt ngay `MAU_VI_TU_BANG_TENANT` truyền `'%2$s'` (mẫu chuyền tiếp — nay là một hình dạng được nhận) và
`COT_NEO` khai có đệm khoảng trắng (từng vô hình). Hồ sơ N3 (lượt soi 36 #3): với `'MEMBER'` lượt sửa thu hồi CREATE của
chính chủ database và 001 gãy thô; với `'USAGE' OR 'SET'` 49 migration đi qua, vai deploy ngoài tập, deploy dừng ở phán xét
với một mục có tên và lối ra. Trọn tệp: `rls-coverage` 32/32, H19 32/32, `hardening-hang` 4/4, `migrations.int.test.ts`
102/102, T1 724/724; t0 210 / 0.

**Đỏ đo được, cô lập (~~năm~~ sáu đột biến — 40b #11, khôi phục trước mỗi ca):** M1 bốn tên ⇒ đỏ test 88; M2 khoá cứng `public` ở VI_TU ⇒ đỏ
"phải BẰNG qua bộ giải"; M3 bỏ khối BƯỚC 3 ⇒ `division by zero` trần; M4 bỏ khối BƯỚC 2 ⇒ lượt SỬA gãy `(sua)`; M5 khoá cứng
`public` ở nhánh SECDEF ⇒ `[I3] SECDEF ở schema khác` lọt `migrate()`; M6 (sau lượt soi 36) `VAI_KET_NOI_UNG_DUNG` về
`'MEMBER'` ⇒ hồ sơ N3 đỏ ở 001 `permission denied for database`.

### Lượt soi đối kháng 36 (trên bản đầu của S1.44 — "chỉ tính chất"): 1 NẶNG, 4 NHẸ, 4 INFO — xử lý hết trong bản hai

| # | Mức | Phát hiện | Kiểm | Xử lý |
|---|---|---|---|---|
| 1 | NẶNG | Tập theo tính chất là TẬP CON theo membership: `REVOKE app_api FROM app_api_login` (ADMIN OPTION làm được — chính vai đã GRANT lúc dựng cụm) + `GRANT SELECT ON users TO app_api_login` ⇒ kết nối thật (INHERIT) đọc 0 hàng không lỗi (ADR-036 hàng 6); bản bốn tên kêu, bản tính chất IM; test 88 chỉ khẳng định "không mất gì" cho ba vai CÓ MẶT — hai role đăng nhập không tồn tại ở CSDL test | đúng theo đọc, **đo** | tập vai = `VAI_KET_NOI_UNG_DUNG` ∪ `ROLE_CANH` (hằng đã có, dời lên — không bản chép thứ ba); test dựng `app_api_login` không membership trong giao dịch: bản chỉ-tính-chất IM, câu hợp thấy; GRANT membership lại ⇒ dòng biến mất |
| 2 | NHẸ | ⑵ chỉ thấy grantee TRỰC TIẾP (`a.grantee = vai.oid`) trong khi 83⑧ cùng tập vai thấy bắc cầu; quyền tới `app_api` qua NHÓM ⇒ ⑵ im, lớp chịu lực vẫn là membership lạ ở BƯỚC 1/3 — và chú thích "BƯỚC 1 không gỡ được ⇒ bốn tên IM" nói quá: `CAU_MEMBERSHIP_LA` ở BƯỚC 3 đã chặn `migrate()` | đúng theo đọc, **đo** | JOIN theo `pg_has_role(vai.oid, grantee, 'USAGE')` (CASE cho PUBLIC), mô tả nêu `(qua <nhóm>)`; chú thích viết lại; test: GRANT UPDATE cho nhóm mà app_api là thành viên ⇒ ba dòng (app_api, app_api_login, zz_vai88), bản grantee-trực-tiếp IM |
| 3 | NHẸ | Vai deploy CREATEROLE tự chạy BƯỚC 0 ⇒ PostgreSQL 16 cấp membership ngầm `WITH ADMIN OPTION` (INHERIT FALSE, SET FALSE, grantor superuser bootstrap) ⇒ `pg_has_role(…, 'MEMBER')` TRUE ⇒ vai deploy ∈ tập với tư cách CHỦ bảng ⇒ ⑵ đỏ trên mọi bảng RLS — trừ khi BƯỚC 1 gỡ được (grantor không phải nó thì không); hồ sơ N2 hiện có không chạm ca này | cần đo → **đo: tệ hơn người soi đoán** — chưa tới ⑵: mục "quyền CREATE/TEMP trên database của vai ứng dụng và mọi thành viên" ở LƯỢT SỬA đã thu hồi CREATE của chính chủ database ⇒ 001 gãy `permission denied for database` (tiền tồn từ S1.34); BƯỚC 1 WARNING "has not been granted membership … by role trien_khai" | `VAI_KET_NOI_UNG_DUNG`: `'MEMBER'` → `'USAGE' OR 'SET'` (kế thừa hoặc SET ROLE được — membership chỉ-admin không phải kết nối ứng dụng); test hồ sơ N3 mới: 49 migration đi qua, vai deploy ngoài tập, ⑵ rỗng, deploy dừng ở phán xét với đúng một mục có tên (membership lạ) + lối ra (superuser REVOKE ⇒ đi qua); đột biến M6 về `'MEMBER'` ⇒ đỏ ở 001 |
| 4 | NHẸ | Bộ giải chỉ biết `%n$s` và `%%`; `%s`/`%I`/`%L`/`%` lẻ đi qua nguyên văn — `%s` cho ra SQL KHÁC PG mà vẫn hợp lệ; T1 miễn kiểm mẫu còn sót cho MỌI `MAU_*` theo tiền tố tên | đúng theo đọc | ném khi còn `%` ngoài văn phạm sau khi thay; T1 thêm `%s`, `%I`, `%` lẻ ⇒ ném; miễn mẫu tính từ chính tệp (`pg_catalog.format(NAME`), không theo tiền tố |
| 5 | NHẸ | Bất biến "BƯỚC 3 không gãy thô" chưa phủ hai EXECUTE membership đầu BƯỚC 3 | đúng theo đọc | bọc cùng khuôn, dòng gom "KHÔNG ĐÁNH GIÁ ĐƯỢC — câu kiểm ném" |
| 6 | INFO | BƯỚC 2 "điều kiện ném = chưa đủ điều kiện" đổi mục tự chữa thành mục chặn deploy dưới vai thiếu quyền — đúng chiều (ném ở lượt sửa thì ném lại ở lượt phán xét cùng vai ⇒ dòng gom ⇒ RAISE BƯỚC 4), nhưng test chỉ tiêm 22012 dưới superuser; ca thúc đẩy (42501 dưới N2) chưa có test tiêm | xác nhận chiều fail-closed | ranh giới ghi ở biên bản 59 ⑸ — tiêm 42501 dưới vai N2 là việc của một vòng có hồ sơ N2 ở tệp H19 |
| 7 | INFO | Nhãn `CAU_TRIGGER_CANH_CO_DIEU_KIEN` chỉ nêu hàng 20 trong khi vế `tgenabled <> 'A'` là hàng 8–9; hàng 2 của ⑺ đúng; chú thích ⑶ có thật (`migrations.int.test.ts` + §S1.36) | đúng theo đọc | nhãn "hàng 8–9/20" |
| 8 | INFO | Test ⑹ đo đúng câu lượt 27 hỏi, có đối chứng dương, census đo trước fixture; nhưng `Set(fk.bang) == năm bảng` đòi MỌI bảng chỉ-ghi-thêm có FK — bảng tương lai không FK làm test đỏ vì lý do lạ | xác nhận | ⊆ + không rỗng |
| 9 | INFO | Test ⑺ không để lại gì trên CSDL chung: `.always.sql` không vào `schema_migrations`, bản sao byte-giống ⇒ checksum khớp, GUC phạm vi giao dịch, lượt phán xét ROLLBACK; mốc chèn tựa LF — `.gitattributes` + khẳng định tĩnh cấm CR giữ | xác nhận | — |

**Khớp — người soi kiểm bằng đọc:** phủ policy `pg_has_role(vr, o, 'USAGE')` ≡ `has_privs_of_role` mà RLS dùng (NOINHERIT
nhất quán hai phía); PUBLIC ở cả policy lẫn GRANT; `NOT rolsuper` đúng; BYPASSRLS không superuser bị phán dư (fail-closed).
`MAU_SCHEMA_DU_AN` khai trước mọi hằng dùng nó trong một khối DO; `%%`→`%` và `\_` giữ nguyên byte; 83 hằng không trùng
tên. Văn phạm tham số `format()` chặn `)`, `,`, khoảng trắng, `$&`/`$1`; chuyền tiếp `'%2$s'` kiểm ở mức format() bọc
ngoài; `[ ]+` tìm được `COT_NEO`; `CASE` vẫn ném; 29 lời gọi `format()` trong tệp đều thuộc hai hình dạng. Khối con BƯỚC 3:
biến PL/pgSQL không rollback nhưng `loi_gom` chỉ nối sau `chi_tiet` thành công; cột 4/5 toàn SELECT; `CONTINUE WHEN` trong
khối con hợp lệ; không mục nào dùng `RAISE` ở cột 4/5 để chặn deploy — mọi mục trước đây "chặn bằng lỗi thô" nay vẫn chặn
qua BƯỚC 4; chế độ `day_du` đi cùng đường. Hai chú thích BẬC TỰ DO gạch đúng địa chỉ.

**Điều đáng mang sang vòng sau:** ⑴ "theo tính chất" chỉ đúng khi tính chất là thứ kẻ tấn công KHÔNG đổi được — membership
là thứ ADMIN OPTION đổi được, nên tập kết nối ứng dụng cần một vế neo (tên đã ghim ở `ROLE_CANH`; hoặc một mục đòi cặp
`CAP_HOP_LE` tồn tại — chiều THIẾU của danh sách trắng, chưa có); ⑵ mọi test "không mất gì so với bản chép" phải dựng cả
những chủ thể mà CSDL test CỐ Ý không có, trong giao dịch; ⑶ hồ sơ N3 là hồ sơ nâng cấp thứ hai (sau N2 nhánh 4) mà chỉ
một test dựng — mỗi mục "vai ứng dụng và mọi thành viên" phải được hỏi "thành viên KIỂU gì" (admin-only / NOINHERIT /
SET); ⑷ bộ giải hằng nay đóng — mọi `%` ngoài văn phạm ném; ⑸ D2/`CTE_TRIGGER_CHAN` theo tên — khoản 90.

# §S1.45 — khoản nợ 90: lớp SỬA D2 của sổ đòi danh tính nhất quán (ADR-037 kênh ①) — MÃ SẢN XUẤT, vòng nhỏ

**Bề mặt an ninh:** `db/migrations/hardening.always.sql` — `bang_so` trong `CTE_TRIGGER_CHAN` thêm hai vế danh tính, so PHẦN TÊN
của neo (⒜ chú thích neo của chính nó — nếu có — nêu tên hiện tại hoặc nêu tên sổ ở `public`; ⒝ không quan hệ khác mang neo
nêu tên này); `CAU_NEO_SUA` cùng vế ⒝ (không trao neo cho bản chiếm tên, WARNING); thông điệp "KHÔNG TỒN TẠI" của
`CAU_TRIGGER_CHAN_SAI` thêm nguyên nhân thứ tư; ⑵′ hết in NULL. Test: `db/migrations.int.test.ts` test 89 thêm (b) bản sao
không neo, 0 trigger, thông điệp nguyên nhân thứ tư; (c) 4 sau khi gỡ chú thích; (e) đo riêng ⒜ (chú thích lạ trên sổ thật ⇒
D2 không chữa, 3; đặt lại neo ⇒ 4). Không migration đánh số, không GRANT, không bảng mới.

**Đo:** kịch bản 89 — bản sao cùng tên KHÔNG nhận neo lẫn trigger khi bảng gốc còn giữ danh tính; chủ bảng gỡ chú thích bảng
gốc ⇒ danh tính rơi ⇒ lượt ghi neo trao neo, D2 chữa bản sao (ranh giới nói ra, kênh ③ vẫn chặn deploy); đối chứng đi qua với
4 trigger; CR2a (`SET SCHEMA` cả hai sổ) vẫn 8 trigger ở schema mới.

**Đỏ đo được, cô lập:** bỏ riêng ⒝ ⇒ test 89 (b) đỏ ở dòng "KHÔNG TỒN TẠI" (bản sao lại là `bang_so`); bỏ riêng ⒜ ⇒ (e) đỏ ở
cùng dòng; bỏ cả hai (bản đầu) ⇒ (b) đỏ "expected 4 to be 0".

### Lượt soi đối kháng 37 (trên bản đầu của S1.45): 1 CAO, 5 NHẸ, 3 INFO — xử lý hết trong bản hai

| # | Mức | Phát hiện | Kiểm | Xử lý |
|---|---|---|---|---|
| 1 | CAO | Vế ⒜ (neo bằng TÊN HIỆN TẠI) loại cả bảng sổ THẬT đã `SET SCHEMA` khỏi `bang_so` (neo `public.audit_events` theo oid ≠ `kho_toi.audit_events`), và nhánh hai của `bang_al` đòi tên ngoài danh sách nên nó ra khỏi cả hai ⇒ D2/D3/D4 và [CR1] không chạm lịch sử thật ở schema mới — đảo đánh đổi [CR2a] ("cái giá để nhìn thấy SET SCHEMA"); test CR2a đòi 8 trigger, theo đọc còn 7; không test nào đo riêng ⒜ | đúng theo đọc | ⒜ so PHẦN TÊN và nhận cả `neo: public.<sổ>` dù bảng ở schema nào (bảng mang neo ấy LÀ sổ theo oid); ⒝ vẫn loại bản sao vì bảng đã dời còn giữ neo; chạy CR2a + test 89: xanh; (e) đo riêng ⒜; đột biến bỏ riêng ⒜ ⇒ (e) đỏ |
| 2 | NHẸ | Thông điệp "KHÔNG TỒN TẠI như một BẢNG THẬT … DROP / SET SCHEMA / VIEW" nay bắn SAI nguyên nhân ở mọi ca hai vế loại bảng (bản sao chiếm tên, chú thích khác, attnum lệch, decoy) — bảng vẫn ở đó | đúng theo đọc | nguyên nhân thứ tư "[khoản 90] quan hệ đang mang tên ấy KHÔNG giữ danh tính nhất quán theo kênh ①"; test 89 (b) và (e) ghim |
| 3 | NHẸ | ⒝ mở nút bấm cho vai chỉ cần CREATE trên một schema dự án: `COMMENT ON TABLE bao_cao.x IS 'neo: public.audit_events'` ⇒ sổ thật rời `bang_so`, D2/D3/D4 và [CR1] đứng yên; lớp bắt: ⑴ kêu đúng `bao_cao.x` kèm oid sổ + vế KHÔNG TỒN TẠI ⇒ deploy chặn, phát hiện trễ chứ không mất; `pg_temp` đã bị loại | đúng theo đọc | nói ra ở chú thích `bang_so` (ai làm được, lớp nào bắt; kẻ ấy vốn chặn được deploy bằng bảng có `org_id` không policy); không thu hẹp ⒝ theo hình dạng — bảng decoy đúng hình dạng thì ⑷ bắt, không đúng thì ⑴ bắt: cùng kết quả |
| 4 | NHẸ | `CAU_NEO_SUA` vẫn TRAO neo cho bản sao khi bảng gốc còn giữ danh tính ("lớp SỬA đứng yên" nói quá); khi bảng gốc mất neo/bị DROP sau đó, bản sao đã sẵn neo hợp lệ ⇒ ⑴⑵⑶⑷ im, chuỗi hash bắt đầu lại trên sổ rỗng, dấu vết chỉ là một WARNING deploy trước | đúng theo đọc | `CAU_NEO_SUA` cùng vế ⒝: bỏ qua + WARNING nêu oid đang giữ tên; bản sao ở lại ⑶ tới quyết định có chủ ý; test 89 (b) khẳng định bản sao không neo |
| 5 | NHẸ | ⒜ so TOÀN chuỗi (kèm attnum) trong khi tài liệu nêu dạng ngắn; ⑵′ in `nullif` NULL ⇒ dòng gom trống | đúng theo đọc | ⒜ và ⒝ đều so phần tên (`split_part … ' org_id#'`), attnum để ⑵′ phán; ⑵′ `coalesce(…, '(không có)')` |
| 6 | NHẸ | STATE tự mâu thuẫn (hàng 90 còn MỞ, danh sách CÒN MỞ còn 90, hàng 89 còn "D2 theo tên") | đúng theo đọc — người soi đọc trước khi tài liệu S1.45 ghi | ba chỗ đã khớp trong cùng commit biên bản; hàng 89 gạch |
| 7 | INFO | Deploy đầu/N2/cụm cũ: mục neo đứng trước D2 trong cùng lượt sửa; `IS NULL` đi qua; phân mảnh `p` không bao giờ được neo (⑶ đỏ vĩnh viễn — tiền tồn, ngoài phạm vi); chú thích CỘT không ảnh hưởng | xác nhận | — |
| 8 | INFO | (b) "bảng gốc 0 trigger" không phân biệt với hành vi cũ — tài liệu, không phải chứng cứ; 0 trên bản sao đo "không thử" nhờ đột biến ⇒ 4 | xác nhận | ghi chú ở test |
| 9 | INFO | "sáu trigger lên bản sao" — bản sao chỉ nhận bốn; ⑶ của biên bản 60 thiếu vế ⑶/⑵′ | xác nhận | sửa số, liệt kê đủ vế |

**Khớp — người soi kiểm bằng đọc:** ⒝ so bằng đúng chuỗi, `k.oid <> c.oid`, `MAU_SCHEMA_DU_AN` cho `kn` loại `pg_temp`;
`split_part(NULL)` ⇒ NULL ⇒ `NOT EXISTS` an toàn, không hàm nào ném theo dữ liệu người khác kiểm soát; `bang_al` nhánh hai không
đổi — `kho.audit_events` phân mảnh và `bao_cao.audit_events` (không neo) vẫn trong `bang_so`, hai test ấy không đổi kỳ vọng; vế
"KHÔNG TỒN TẠI" bảo đảm mọi lần sổ `public` rơi khỏi `bang_so` đều đỏ D2 cùng lượt — "không thả trong im lặng" đứng được;
`CAU_QUYEN_BANG_SO_SAI`/`CAU_BANG_SO_VAT_LY`/D3/D4 đọc cùng CTE nên cùng lùi khỏi bảng bị loại — đúng ý với bản sao.

**Điều đáng mang sang vòng sau:** ⑴ vị từ "danh tính nhất quán" phải phân biệt *bảng thật đổi chỗ* (oid giữ neo nêu tên sổ —
vẫn là sổ, phải chữa) với *bản sao chiếm tên* (oid khác, neo của người khác nêu tên nó — không chữa) — bản đầu gộp hai ca;
⑵ lớp SỬA gồm cả lượt ghi neo — cùng vị từ, cùng ranh giới; ⑶ mọi thay đổi vào `bang_so` phải chạy trọn
`migrations.int.test.ts` (CR2a/CR2b/I3 đều đọc CTE ấy) và ghi mã thoát; ⑷ tài liệu ADR-037 nêu dạng neo ngắn — mọi vế nay so
phần tên nên hai dạng đều hợp lệ, attnum là việc riêng của ⑵′.

# §S1.46 — khoản nợ 86 nửa gốc: bảng đa tổ chức đặt tên cột khác `org_id` nhận diện theo tính chất (khoá ngoại một cột tới bảng tenant) — MÃ SẢN XUẤT, vòng nhỏ; khoản 91 mở

**Bề mặt an ninh:** `db/migrations/hardening.always.sql` — mục phán xét mới `CAU_KHOA_NGOAI_TENANT_SAI` với `VI_TU_HINH_DANG_86` (r/p,
không RLS, KHÔNG có cột `org_id`, có khoá ngoại MỘT cột — của chính bảng hay của một tổ tiên INHERITS qua CTE `to_tien` — tới một bảng
tenant theo tính chất: `CAU_KHOA_NGOAI_TOI_TENANT` khai triển `MAU_VI_TU_BANG_TENANT` với bí danh `gn`/`g`, ngoài `VI_TU_CAN_CO_RLS`),
hai chiều, lọc `MAU_SCHEMA_DU_AN`, `BANG_KHOA_NGOAI_TENANT_KHAI` rỗng; một mục `bang` ngay sau mục 85. `MAU_VI_TU_BANG_TENANT` không
đổi. Test: `db/rls-coverage.int.test.ts` describe S1.46 — hai bản khớp, đích là vị từ tenant (một hằng), fixture trong giao dịch
(k LẪN public bị thấy; khoá ngoại tới `users` bị thấy; con INHERITS bị thấy qua cha; có `org_id` ⇒ 85; RLS ⇒ 83⑶; uuid trần ⇒
không; đổi tên cột ⇒ cửa ra; chiều ngược), test ĐO (lỗ rò thật, `migrate()` NÉM cho cả hai, bật RLS ⇒ 83⑶, DROP ⇒ đi qua);
meta-test sentinel nay đòi sáu danh sách rỗng. Không migration đánh số, không GRANT, không bảng mới.

**Đo:** `(gia int, to_chuc uuid REFERENCES organizations(id))` + GRANT SELECT cho app_api ở `zz_s86` và ở `public` — app_api gắn
tổ chức A đọc thấy hàng của B ở CẢ HAI (trước S1.46: `migrate()` đi qua — đột biến M1 tái hiện); nay `migrate()` NÉM một dòng cho
mỗi bảng, nêu `(qua to_chuc -> public.organizations)`, không dòng 85; bật RLS ⇒ mục 86 im, 83⑶ đòi khai; DROP ⇒ đi qua. Lược đồ
thật: câu phán xét rỗng (khớp quy ước khoá ngoại hợp thành `(org_id, x)` của kho).

**Đỏ đo được, cô lập:** M1 bỏ mục ⇒ test ĐO đỏ "expected null not to be null"; M2 bỏ vế ¬có `org_id` ⇒ test 1 đỏ ở khẳng định văn
bản `NOT <có org_id>`; M3 bỏ vế ¬`relrowsecurity` ⇒ cả hai test đỏ (`zz_s.t_rls` lọt vào 86; "bật RLS: mục 86 im" đỏ); M4 bỏ vế tổ
tiên ⇒ test 1 đỏ (thiếu `zz_s.con86`); M5 đích chỉ `organizations` (bản đầu) ⇒ test 1 đỏ ở khẳng định "đích = vị từ tenant".

### Lượt soi đối kháng 38 (trên bản đầu của S1.46 — đích chỉ là GỐC tenant, không xét tổ tiên): 1 NẶNG, 5 NHẸ, 5 INFO — NẶNG và bốn NHẸ xử lý trong bản hai, A3 thành khoản 91

| # | Mức | Phát hiện | Kiểm | Xử lý |
|---|---|---|---|---|
| A1 | NẶNG | Khoá ngoại một cột tới bảng tenant KHÔNG phải gốc (`rfq uuid REFERENCES rfq_packages(id)`, `nguoi uuid REFERENCES users(id)`) ở bất kỳ schema, không `org_id`, không RLS ⇒ 85 im, 86 (bản đầu, đích = gốc) im, 83⑵/⑶ im, 82⑴/84 im ⇒ `migrate()` đi qua, app_api đọc mọi tổ chức; cùng lớp 86 (chuỗi khoá ngoại tới `org_id` của bảng đích, chỉ khác một bậc); `008_suppliers.sql` đã gọi hình dạng ấy là "LỖ THẬT"; test bản đầu ghim `users` là "bảng thường" — lời khai đóng băng lỗ | đúng theo đọc — fixture `t_users` trên bản đầu không bị thấy (đột biến M5 tái hiện) | đích = `format(MAU_VI_TU_BANG_TENANT, 'gn', 'g')` (tập con nghiêm ngặt của thay đổi; `VI_TU_BANG_TENANT` không nới); bỏ hằng `MAU_VI_TU_GOC_TENANT` (hết người dùng); fixture `t_users` phải bị thấy `(qua nguoi -> public.users)`; lược đồ thật vẫn rỗng; bậc kế (khoá ngoại tới bảng đã khai 85/86) nói ra là ranh giới |
| A2 | NHẸ | Con INHERITS của bảng hình dạng 86: PostgreSQL không kế thừa khoá ngoại ⇒ con thừa cột `to_chuc` mà không ràng buộc ⇒ "uuid trần" tự động, 86 im; cha bật RLS (khai 83⑶) + cặp khai 82⑴ ⇒ đọc thẳng con thấy mọi tổ chức — cần hai dòng khai nên không lặng, nhưng chú thích chưa nói | đúng theo đọc | `CAU_KHOA_NGOAI_TOI_TENANT` xét khoá ngoại của c HAY của tổ tiên (CTE `to_tien` cùng khuôn `LA_CUA_BANG_TENANT`); fixture `con86 () INHERITS (t2)` bị thấy; đột biến M4; lá phân mảnh AN TOÀN vì ràng buộc nhân bản (`conparentid`) — ghi vào chú thích |
| A3 | NHẸ | Cửa ra "bật RLS ⇒ 83⑶" mà thông điệp 86 khuyên là cửa yếu: không FORCE, chủ bảng bỏ qua RLS; view không `security_invoker` lên bảng ấy không bị (C) thấy (`CAU_DOC_VONG` chỉ neo vào vị từ tenant hoặc cột `org_id` của view) ⇒ app_api đọc mọi tổ chức qua view; tiền tồn ở 83⑶ | đúng theo đọc, chưa đo bằng test | **khoản 91** mở (DDL tái hiện ghi ở hàng 91; hai hình dạng mã: (C) thêm vế bảng đã khai 83⑶/85/86, hoặc 83⑶ đòi `relforcerowsecurity`); thông điệp 86 nói rõ "không FORCE" |
| B1 | NHẸ | Bảng phân mảnh đã khai ở 86: mỗi lá mới mang khoá ngoại nhân bản ⇒ phải khai TỪNG lá ⇒ migration "thêm phân mảnh" chặn deploy; câu hướng dẫn `RENAME COLUMN` không áp được lên lá | đúng theo đọc | GIỮ, nói ra lý do: cùng khuôn 85, và đúng vì lá có `relrowsecurity` riêng — đọc THẲNG lá theo policy của lá, khai cha không nói gì về lá; câu hướng dẫn: "trên lá phân mảnh thì đổi ở bảng gốc phân mảnh" |
| E1 | NHẸ | Chiều ngược nói "hay đã DROP" nhưng lọc `to_regclass(...) IS NOT NULL` ⇒ bảng DROP thì im, không dòng nào | đúng theo đọc | bỏ cụm ấy (khớp 85) |
| E2 | NHẸ | "RANH GIỚI NÓI THẲNG" chỉ nêu uuid trần và khoá ngoại nhiều cột, hàm ý phần còn lại đã phủ — A1/A2 ở ngoài | đúng theo đọc | A1/A2 đóng; ranh giới viết lại: uuid trần, nhiều cột, bậc kế trên đồ thị khoá ngoại, lá phân mảnh khai riêng |
| B2 | INFO | Thứ tự (A)/86 không tạo kẽ: vị từ loại `VI_TU_CAN_CO_RLS` nên dù `day_du` hay hai lượt, 86 không đọc bảng mà (A) sắp bật RLS; danh sách rỗng nên chiều ngược không kêu oan; bảng quan hệ hai tổ chức có khoá ngoại tới `organizations` sẽ phải khai — đúng thiết kế | xác nhận | một dòng chú thích |
| C1/C2 | INFO | 85 / 86 / 83⑶ rời nhau (kiểm vị từ); `org_id` đã `attisdropped` + khoá ngoại cột khác rơi đúng vào 86; **C2:** 86 độc lập đóng đường đo S1.42 (`users RENAME COLUMN org_id TO to_chuc; DISABLE RLS; DROP POLICY ×2`) — khoá ngoại `to_chuc` vẫn một cột, 27 khoá ngoại `org_id` khác giữ `organizations` là gốc ⇒ kêu kể cả khi ADR-037 ①② bị gỡ | xác nhận | C2 ghi vào chú thích, biên bản 61 và hàng 86 |
| D1 | INFO | Bộ giải hằng và PostgreSQL hiểu giống nhau ở hằng kết thúc bằng `|| pg_catalog.format(...)` (cùng tiền lệ `VI_TU_HINH_DANG_85` kết thúc bằng tên hằng); bí danh `fk` ở câu ngoài bị CHE bởi `fk` trong vế gốc lồng — hợp lệ nhưng dễ lấy nhầm về sau | xác nhận | bí danh ngoài đổi thành `kn_fk` |
| E3 | INFO | Cửa ra "ở public thành bảng tenant" còn kéo theo `BANG_TENANT_KHAI` + neo ADR-037 (cổng rls-coverage đỏ tiếp) | xác nhận | nêu trong thông điệp |
| F1 | INFO | Sáu danh sách sentinel; regex chiều ngược khớp `WHERE kt.relname <> ''`; đếm 3 / 2 đúng cấu trúc | xác nhận | — |

**Khớp — người soi kiểm bằng đọc:** khoá ngoại `NOT VALID` / `DEFERRABLE` / mọi `ON DELETE` vẫn là `contype = 'f'`; `relkind` f/v không mang
khoá ngoại; `pg_temp` bị `MAU_SCHEMA_DU_AN` loại và vế đích đòi `nspname = 'public'`; cột `attisdropped` kéo khoá ngoại rơi theo; nhiều
gốc và RENAME gốc đi theo oid (ADR-037 ⑴ canh tên đã khai); khoá ngoại nhiều cột là ranh giới đã nói; thứ tự sửa/phán xét không ảnh
hưởng.

**Điều đáng mang sang vòng sau:** ⑴ "tới gốc" là một tập con GIẢ của "tới bảng tenant" — mọi khoá ngoại tới một bảng có `org_id`
đều buộc hàng vào tổ chức, chỉ gián tiếp hơn một bậc; đường tính chất phải lấy tập lớn nhất mà lược đồ thật còn rỗng; ⑵ một
fixture "đối chứng âm" phải được đặt tên theo lý do nó âm — `t_thuong` cho `users` là lời khai sai đóng băng lỗ; ⑶ kế thừa
INHERITS mang cột mà không mang ràng buộc: mọi vị từ dựa trên `pg_constraint` phải hỏi tổ tiên; ⑷ khoản 91: cửa ra "bật RLS rồi
khai" chỉ mạnh bằng FORCE và bằng việc (C) nhìn thấy bảng đã khai.

# §S1.47 — khoản nợ 87: GUC `app.*` gắn sẵn cho phiên ứng dụng — mục phán xét năm nhánh theo tính chất; `withTenant` từ chối phục vụ khi mặc định phiên bị đầu độc — MÃ SẢN XUẤT; khoản 92 mở

**Bề mặt an ninh:** `db/migrations/hardening.always.sql` — `CAU_GUC_TUY_BIEN_GAN_SAN` (tính chất "tên GUC có dấu chấm"): ⒜ `ALTER
DATABASE … SET`; ⒝ hàng của vai kết nối ứng dụng và `ALTER ROLE ALL SET`; ⒞ chính phiên deploy — `current_setting(tên, true)` trên tập
tên suy từ prosrc hàm lược đồ dự án + biểu thức policy (`CAU_TEN_GUC_DU_AN_DOC`), khác rỗng mà không hàng catalog nào mang; ⒟
`pg_parameter_acl` với grantee không superuser; ⒠ `proconfig` hàm lược đồ dự án; danh sách trắng `GUC_TUY_BIEN_KHAI` rỗng, chiều
ngược bắt dòng khai thiu; mục `bang` phán xét, không tự RESET. `packages/tenancy/src/with-tenant.ts` — `BEGIN; SELECT` một round-trip
đọc bốn GUC trước khi đặt: có giá trị ⇒ `TenantError` trước `fn`, không huỷ kết nối; rồi đặt `app.org_id` + xoá ba GUC khách; `finally`
đọc bốn trục. Test: `db/migrations.int.test.ts` "[khoản nợ 87]" (mười vế), `packages/tenancy/src/with-tenant.int.test.ts` describe
S1.47 (hai), meta-test sentinel 7. Không migration đánh số, không GRANT, không bảng mới.

**Đo (PostgreSQL 16):** chủ database thường 42501 ở SET lẫn RESET placeholder mức database; `GRANT SET ON PARAMETER app.org_id TO
trien_khai` ⇒ vai thường SET/RESET được (REVOKE ⇒ 42501 lại); `ALTER ROLE app_api RESET ALL` dưới vai thường giữ im lặng phần tử
placeholder (rolconfig còn nguyên — hai mục cùng đỏ); placeholder KHÔNG có ở `pg_settings` kể cả sau SET (không `source`/`reset_val`),
`pg_file_settings` thấy postgresql.auto.conf nhưng chỉ superuser/pg_read_all_settings đọc; `ALTER SYSTEM SET app.org_id` (sau SET trong
phiên) + `pg_reload_conf` ⇒ kết nối mới mang giá trị, catalog sạch ⇒ ⒞ NÉM; phiên mở trong cửa sổ `ALTER DATABASE SET` giữ giá trị sau
RESET (migrate() huỷ client mỗi lượt nên lượt kế là phiên mới) ⇒ ⒞ kêu đúng, kết nối mới ⇒ qua; `pg_catalog.nullif`/`pg_catalog.coalesce`
ném 42883 (cú pháp, không phải hàm); `ALTER DATABASE SET app.guest_session_id` ⇒ câu ngoài withTenant 0 hàng không lỗi (ADR-036),
withTenant từ chối trước `fn`, pid ổn định; lượt evidence đầu đỏ hai test cũ (CR3/IM4) vì chúng để `app.org_id` phạm vi PHIÊN trên
`db.pool` rồi `migrate()` cùng pool — ⒞ phán đúng, test sửa huỷ client trước `migrate()` (kỳ vọng lật có chủ đích).

**Đỏ đo được, cô lập (9 đột biến):** M1 bỏ mục · M2 bỏ vế dấu chấm · M3 bỏ nhánh setrole 0 · M6 bỏ ⒞ · M7 bỏ ⒟ · M8 bỏ ⒠ · M5
`finally` chỉ đọc org_id · M9 bỏ từ chối — tám ca đỏ đúng khẳng định. **M4 bỏ câu xoá ba GUC khách: SỐNG** — phép từ chối đứng trước
nên câu xoá chỉ là lớp hai, không đo riêng được; ghi thẳng, không khẳng định hơn.

### Lượt soi đối kháng 39 (trên bản đầu của S1.47 — một nhánh catalog, `withTenant` chỉ xoá): 2 NẶNG, 5 NHẸ, 5 INFO — xử lý hết trong bản ba (một NHẸ thành khoản 92)

| # | Mức | Phát hiện | Kiểm | Xử lý |
|---|---|---|---|---|
| NẶNG-1 | NẶNG | Meta-test sentinel ở rls-coverage ghim `toBe(6)`; `GUC_TUY_BIEN_KHAI` là sentinel thứ bảy ⇒ cổng đỏ | đúng — rls-coverage chưa được chạy trên bản đầu | `toBe(7)`, chạy rls-coverage (xanh) |
| NẶNG-2 | NẶNG | `ALTER SYSTEM SET app.org_id` / dòng postgresql.conf: cùng tác nhân, cùng hậu quả, `pg_db_role_setting` sạch ⇒ mục mù; ranh giới chỉ nói chuỗi kết nối; đề xuất đọc `pg_settings.source` | đúng theo đọc; ĐO: đề xuất không dùng được — placeholder không có ở `pg_settings` (GUC_NO_SHOW_ALL), `pg_file_settings` chỉ superuser đọc | nhánh ⒞ đọc thẳng `current_setting` trên tập tên suy từ policy/hàm dự án (mọi vai đọc được); test (c′) đo `ALTER SYSTEM` trên PG16 (cần SET placeholder trong phiên trước); đột biến M6 |
| NHẸ-1 | NHẸ | Hàng `ALTER ROLE ALL SET` (0, 0) bị bắt nhưng `mo_ta` NULL ⇒ "SAI ()", hướng dẫn RESET sai; ba mục kề không thấy hàng ấy | đúng theo đọc | nhánh CASE riêng "mọi vai, mọi database (ALTER ROLE ALL)", test (a′); ba mục kề → **khoản 92** |
| NHẸ-2 | NHẸ | "Chỉ superuser" nói quá: `GRANT SET ON PARAMETER` (PG15+) cho vai thường SET/RESET placeholder ở mức database/vai; `CAU_PARAMETER_ACL_SAI` chỉ soi grantee PUBLIC/vai ứng dụng | ĐO: qua sau GRANT, 42501 sau REVOKE | nhánh ⒟ bất kể grantee (lọc superuser — aclexplode in cả chủ, đo); câu chữ sửa; test (d); đột biến M7 |
| NHẸ-3 | NHẸ | Non-superuser `RESET ALL` giữ im lặng phần tử placeholder ⇒ "bốn mục RESET ALL tự chữa" chỉ đúng khi superuser; chưa đo | ĐO: rolconfig còn nguyên, hai mục cùng đỏ | chú thích + cột quyền của mục 87; test (b′) |
| NHẸ-4 | NHẸ | Dưới GUC gắn sẵn, `finally` thấy giá trị mặc định sau COMMIT ⇒ huỷ kết nối MỖI lượt với chẩn đoán "fn đặt phạm vi phiên"; đề xuất phân biệt qua `pg_settings.source` | đúng theo đọc (pid đổi — đo); đề xuất không dùng được (đo) | đọc bốn GUC trong `BEGIN; SELECT` trước khi đặt ⇒ từ chối trước `fn`, cờ bỏ qua `finally`; test pid ổn định; đột biến M9 |
| NHẸ-5 | NHẸ | `proconfig` hàm dự án có `app.*` không ai canh; trigger `set_config(…, true)` ngoài tầm `finally` | đúng theo đọc | nhánh ⒠, test (e), đột biến M8; trigger — ranh giới nói ra |
| INFO-1 | INFO | Extension (pgaudit, auto_explain, pg_trgm…) ở mức DB/vai ứng dụng chặn deploy tới khi khai — trái tinh thần [I3] cho hàng xóm | xác nhận | quyết định nói ra trong chú thích và biên bản: "dấu chấm" là đại diện đo được; cửa khai có |
| INFO-2 | INFO | `app.hardening_che_do` gắn sẵn: migrate() miễn nhiễm, mục 87 bắt; chỉ `psql -f` bị | xác nhận | một dòng chú thích; nhánh ⒞ loại tên này (migrate() đặt trong phiên) |
| INFO-3 | INFO | `LIKE '%.%'` không qua `format()` ⇒ bộ giải an toàn | xác nhận | — |
| INFO-4 | INFO | Docstring nói `rfq_packages`, test đo `user_login_tokens` | xác nhận | sửa docstring |
| INFO-5 | INFO | Vai deploy bị `ALTER ROLE trien_khai SET app.org_id` (superuser) ngoài tập ⇒ backfill dưới B | xác nhận | ranh giới nói ra |

**Khớp — người soi kiểm bằng đọc:** thứ tự BƯỚC 1 / bốn mục RESET ALL (lượt sửa) trước mục 87 (phán xét) — không chồng; vai thuộc tập
qua SET không USAGE — `pg_has_role(…, 'SET')` thấy; `'' ≡ chưa gắn` ở mọi điểm đọc (NULLIF); `withGuestSession` đặt ba GUC sau câu
xoá; `concat_ws` bốn NULLIF không có âm tính giả; round-trip không tăng.

**Điều đáng mang sang vòng sau:** ⑴ `pg_settings` không phải nguồn sự thật cho GUC tuỳ biến — thứ mọi vai đọc được là chính giá trị,
trên tập tên rút từ văn bản policy/hàm; ⑵ `pg_catalog.` chỉ ghim được HÀM — `NULLIF`/`COALESCE`/`CASE` là cú pháp, ghim vào là ném
42883 và một `catch` bọc ngoài biến lỗi ấy thành phép kiểm mù; ⑶ một lớp ứng dụng "xoá rồi chạy tiếp" dưới mặc định bị đầu độc là
im lặng — từ chối trước `fn` mới ồn ào; ⑷ `migrate()` huỷ client mỗi lượt: phép đo "sau RESET" phải trên kết nối mới; ⑸ khoản 92:
ba mục kề lọc `setdatabase = <db>` nên mù với `ALTER ROLE ALL`.

## Lượt soi 40 — lượt NGANG thứ ba, chạy trên HEAD `1309379` (master + #44 khoản 86 + #45 khoản 87, chưa hợp nhất) SAU năm vòng S1.43–S1.47

**Hình thức:** như lượt 25/33 — hai người soi độc lập, không shell, song song, không đọc nhau. **40a** đặt các lớp mới của năm
vòng (ADR-037 ba kênh + `bang_so` danh tính, 88 tập vai/kế thừa/BƯỚC 2-3 bọc EXCEPTION, 86 khoá ngoại tới bảng tenant, 87 GUC
năm nhánh + `withTenant`) cạnh các lớp cũ với câu hỏi *"cái nào lách được cái nào"*; **40b** soi lời khai vs mã và con số vs con
số trên `git diff 3811d37..1309379`. Khác lượt 33: các phát hiện có hình dạng mã rẻ được SỬA ngay trong S1.48 (một vòng), đo bằng
tám đột biến; phần còn lại thành khoản 93 hoặc ghi vào hàng 92.

### 40a — lớp CSDL: 0 CAO, 1 NẶNG, 5 NHẸ, 10 INFO

| # | mức | phát hiện | đo được | xử lý |
|---|---|---|---|---|
| N1 | NẶNG | `withTenant` S1.47 từ chối "mặc định phiên" không phân biệt với RÒ PHẠM VI PHIÊN từ mã ngoài withTenant (`pool.connect` + `set_config(…, false)` + release); `tuChoiMacDinh` tắt kiểm `finally` ⇒ kết nối nhiễm TRẢ VỀ POOL (1/N yêu cầu đỏ mãi, câu trần dưới org lạ) — hồi quy I1 | **đo:** app_current_org_id() = orgB còn trên pool, pid không đổi (bản S1.47) | sau ROLLBACK: RESET bốn GUC rồi đọc lại — rỗng ⇒ rò phiên ⇒ HUỶ kết nối, thông điệp "còn sót ở phạm vi PHIÊN"; còn ⇒ mặc định thật ⇒ giữ; test hai chiều; đột biến M7 |
| H1 | NHẸ | Mục 87 phán xét ở BƯỚC 3 — SAU khi migration đánh số cùng lượt đã chạy dưới GUC gắn sẵn và ghi checksum ⇒ backfill lệch vĩnh viễn | **đo:** migration tạm `999_zz_h1.sql` — bản trước chạy và ghi dòng | `migrate()` đọc bốn GUC ngay sau `SET search_path`, từ chối trước lượt sửa; đột biến M6; test 87 chấp nhận "từ chối sớm" ở phiên thừa kế và đo ⒜/⒜′ trực tiếp |
| H2 | NHẸ | Khoản 86 miễn khoá ngoại NHIỀU cột — quy ước kho là `(org_id, x)`: `k.t (to_chuc, nguoi) REFERENCES users (org_id, id)` vô hình với mọi mục | **đo:** fixture `zz_s.t_hop` không bị thấy (bản S1.46) | bỏ `array_length = 1` ở `CAU_KHOA_NGOAI_TOI_TENANT`, mô tả `(to_chuc, nguoi) -> public.users`; đột biến M1; gạch ranh giới ở hàng 86 |
| H3 | NHẸ | `to_regclass(format('%I.%I'))` ở chiều ngược 85/86/RULE (thực đếm: MƯỜI BỐN chỗ) đòi USAGE trên schema ⇒ dưới N2 dòng khai trỏ schema không USAGE ⇒ 42501 ⇒ "KHÔNG ĐÁNH GIÁ ĐƯỢC" mãi, lối ra duy nhất là GRANT | **đo:** vai không USAGE chạy chiều ngược 85 — bản cũ 42501 | JOIN `pg_class`/`pg_namespace` ở cả 14 chỗ; đột biến M2 |
| H4 | NHẸ | `CAU_TEN_GUC_DU_AN_DOC` regex phân biệt hoa/thường, không chữ số, chỉ literal ngay sau `(`, chỉ `prosrc` (bỏ `BEGIN ATOMIC`, DEFAULT, CHECK) — GUC tương lai đặt bằng ALTER SYSTEM vô hình với ⒞ | **đo:** `CURRENT_SETTING ( 'app.rfq_v2'` không vào tập (bản S1.47) | regex `gi` + chữ số + khoảng trắng; thêm `pg_get_function_sqlbody`, `pg_attrdef`, CHECK; census literal migrations ⊆ tập; đột biến M3 |
| H5 | NHẸ | Khoản 92 chưa đủ (ALTER SYSTEM/conf/options= với GUC không dấu chấm) và có hình dạng rẻ hơn: `pg_settings.reset_val` đọc được cho GUC thường | đúng theo đọc | ghi vào hàng 92 (hình dạng `reset_val IS DISTINCT FROM boot_val`), chưa đóng |
| I1 | INFO | Ranh giới "`ALTER ROLE trien_khai SET` không bị thấy" ghi SAI CHIỀU — ⒞ thấy (sau migration; H1 đóng sớm) | đúng theo đọc | sửa lời ở chú thích và hàng 87; thông điệp ⒞ thêm nguồn |
| I2 | INFO | Lối ra "vai được GRANT SET" ở thông điệp ⒜/⒝ bị chính ⒟ phán | đúng | thông điệp: GRANT tạm — RESET — REVOKE cùng phiên |
| I3 | INFO | Hàm extension trong `public` (PostGIS) nạp tên vào tập ⒞/⒠ ⇒ chặn deploy tới khi khai — trái [I3] hàng xóm | đúng theo đọc | loại `pg_depend deptype 'e'` ở ⒞ và ⒠ như (C) |
| I4 | INFO | `CAU_NEO_SUA`: `COMMENT` khoá SUE với `lock_timeout = 0`; EXCEPTION chỉ bắt 42501 | đúng theo đọc | runbook ở ADR-037 §5 |
| I5 | INFO | `bang_so` ⒜ dạng `public.<sổ>`: decoy CÙNG TÊN ở schema khác chép nguyên neo được D2 chữa, sổ thật đứng yên (⑴⑷ chặn cùng lượt — trễ, không mất) | **đo:** test 89 (f) — bản S1.45 decoy 4 trigger | ⒝′ không quan hệ khác mang ĐÚNG chuỗi neo của mình ⇒ cả hai đứng yên (decoy 0, sổ thật 3); đột biến M4 |
| I6 | INFO | ⑷/⑷′ chỉ `relkind = 'r'` — bản sao phân mảnh (`p`) của sổ vô hình ở cha (lá vẫn bị) | **đo:** `zz_s.so_pm` | thêm `'p'`; đột biến M5 |
| I7 | INFO | ⑴ in TRỌN chú thích do chủ bảng đặt (tiêm log) | đúng | `left(…, 80)` + lọc ký tự điều khiển |
| I8 | INFO | Hình dạng kết quả `BEGIN; SELECT` được tin qua cast — pooler trả một kết quả ⇒ phép từ chối mù | đúng | đòi `length === 2`, ném nếu khác |
| I9 | INFO | Chi phí phán xét mới (regexp trên `pg_proc`, CTE đệ quy 86) không đáng kể; không khoá bảng người dùng | xác nhận | — |
| I10 | INFO | `withTenant` lồng trên cùng client: nay fail-closed với chẩn đoán "mặc định phiên" | đúng | thông điệp thêm nguồn "withTenant lồng" |

**40a kiểm và thấy KHỚP:** bảng 86 + cột `org_id` giả ⇒ 85 / (A)+[CR1] / ⑵′; đổi tên cột khoá ngoại của bảng đã neo ⇒ ⑵+⑹+86;
`organizations.id → ident` ⇒ ⑵+⑹; chép bảng mang neo ⇒ ⑴ kèm oid; sửa attnum ⇒ ⑵′; `SET SCHEMA` bảng khai ⇒ ⑴+⑸+83⑶;
`withGuestSession` không từ chối sai; `SET`/`set_config(false)` trong giao dịch bị ROLLBACK cũng hoàn; hàm catalog của mục mới
ngoài `to_regclass` không đòi quyền; membership `SET`-không-USAGE bị BƯỚC 1 gỡ; DoS `withTenant` bởi không-superuser chỉ còn rò
phiên (N1); BƯỚC 3 fail-closed với mọi SQLSTATE; `ALTER ROLE ALL IN DATABASE d` ⇒ ⒜; bộ giải hằng đối chứng trên tệp thật.

### 40b — nhất quán tài liệu/mã: 1 NẶNG, 11 NHẸ, 6 INFO

| # | mức | phát hiện | kiểm | xử lý |
|---|---|---|---|---|
| 1 | NẶNG | ADR-036 §2 tự khai là NGUỒN mà cơ chế khoản 87 không có hàng; §5 hai câu bị S1.47 bác chưa gạch ("chỉ superuser", "test là đủ"); cổng `CAU_*_SAI` ↔ §2 (33b đề xuất) vẫn chưa có — ba mục mới, ba vòng | grep §2 tới 22; grep `CAU_*_SAI` trong DECISIONS: 1 | thêm hàng 23; gạch + nhãn; cổng ⇒ **khoản 93** |
| 2 | NHẸ | "21" (STATE 87) / "11" (hardening, with-tenant) policy RESTRICTIVE `_khach` — người soi đếm CREATE POLICY: 10 + 1 PERMISSIVE | **đo catalog:** 29 RESTRICTIVE (một mỗi bảng tenant — hardening dựng theo khuôn 027) + 1 PERMISSIVE — cả ba con số đều thiu | ba chỗ sửa "29 theo catalog"; `it` đếm từ catalog bằng số bảng tenant |
| 3 | NHẸ | Hàng 87: "Còn mở, có hình dạng mã ⑴⑵⑶", "chỉ superuser", "test là đủ", "bốn GUC khách" chưa gạch | đúng | gạch kèm `[S1.47]`; ⑵ là ba GUC |
| 4 | NHẸ | Hàng 86: "Nửa gốc VẪN MỞ", "đường tính-chất khả dĩ … đổi `MAU_VI_TU_BANG_TENANT` … vòng riêng" chưa gạch (S1.46 đóng không đổi vị từ) | đúng | gạch kèm `[S1.46]` |
| 5 | NHẸ | Hàng 90: "VẪN DỰNG TRIGGER THEO TÊN", "Đường đóng: … neo khớp", "sáu trigger" chưa gạch | đúng | gạch kèm `[S1.45]`; sáu → bốn |
| 6 | NHẸ | ADR-037 §5: gạch đầu dòng D2 "vẫn theo tên" chưa gạch; ⒜ mô tả bản ĐẦU (tên hiện tại) mà lượt 37 CAO-1 bác | đúng | gạch; ⒜ viết lại đủ hai nhánh |
| 7 | NHẸ | `CAU_NEO_SAI`: "sáu vế" (ADR-037 §2, chú thích `bang`), "bảy vế" (§S1.43), mã có TÁM nhánh | đếm UNION | "tám vế ⑴⑵⑵′⑶⑷⑷′⑸⑹" ở bốn nơi |
| 8 | NHẸ | ADR-036 §4 "TÁM danh sách … năm rỗng" — nay 11 / 4 có hàng / 7 rỗng; F1 (TEST-PLAN, INV-matrix) còn "năm" | grep `_KHAI constant` = 11 | sửa §4; F1 "~~năm~~ bảy"; ma trận tái sinh |
| 9 | NHẸ | `with-tenant.ts` docstring: "chỉ đọc lại MỘT trục" chưa gạch (mã đọc bốn) | đúng | gạch kèm `[S1.47]` |
| 10 | NHẸ | `with-tenant.ts` hai chỗ "chỉ superuser" dù S1.47 đo GRANT SET ON PARAMETER | đúng | sửa |
| 11 | NHẸ | S1.44: "năm đột biến" rồi liệt kê M1–M6; §S1.44 cũng vậy | đúng | "sáu (M6 sau lượt 36)" |
| 12 | NHẸ | Dòng TRỐNG giữa hàng 83 và 84 của bảng sổ nợ ⇒ hàng 84–92 thành đoạn văn với GFM; P0 (regex) mù | **đo:** không một mà SÁU dòng trống (trước 66, 67, 68, 69, 71, 84) — bảng đứt từ hàng 66 | xoá cả sáu; P0 thêm vế "khối liền mạch" + đột biến; M8 |
| 13 | INFO | "sáu trigger" còn ở ADR-036 §5 và ADR-037 §1 | đúng | sáu → bốn |
| 14 | INFO | "(mười vế)" test 87 không đếm cơ khí được — 8 nhãn | đúng | "tám vế có nhãn" ở STATE 87 và 62 |
| 15 | INFO | "audit-append-only 22/22" — 21 `it(` theo grep | báo cáo vitest ghi 22 `assertionResults` cho tệp ấy | giữ 22 (số theo báo cáo), không sửa |
| 16 | INFO | Handoff: điều kiện "ba lần liên tiếp" đã thoả từ S1.45 mà lượt kế ghi "sau S1.47" | đúng | ghi rõ lịch thắng điều kiện, lý do gộp năm vòng |
| 17 | INFO | hardening ENABLE ALWAYS: "tham số ấy chỉ superuser đặt được" — GRANT SET cho vai thứ ba không mục nào thấy | đúng | chú thích ranh giới tại chỗ (chưa có khoản) |
| 18 | INFO | ADR-036 §5 ⑵/⑶ không nhãn đóng | đúng | thêm `[S1.43]`/`[S1.46]` |

**40b kiểm và thấy KHỚP:** CÒN MỞ ↔ nhãn (máy); chuỗi đếm 89/16 → 92/15 khớp từng nấc; số ADR 37 ba nơi; số test 103/34/32/4/18
khớp tệp; "27 khoá ngoại org_id" ✓; sentinel 7 ✓; số mức lượt soi 34–39 khớp bảng; tên hằng ở STATE/ADR/§S1.43–47 tồn tại đúng
chữ; mọi hunk mã mang nhãn `[S1.4x / khoản nợ N]` đúng số lượt soi; lời khai "(đo)" đều có test có tên; "M4 sống" ghi đủ ba nơi;
việc 33b #1/#2/#4–#7/#10–#15/#18 đã thi hành.

**Điều đáng mang sang:** ⑴ một lớp ỨNG DỤNG mới có thể là hồi quy của lớp cũ ngay cả khi test của cả hai xanh — test I1 cũ đo rò
QUA withTenant, không đo rò NGOÀI nó; lượt ngang là chỗ duy nhất đặt hai lớp cạnh nhau; ⑵ con số đếm được từ catalog/migration
phải có `it` đếm — "21", "11", "10" cùng một thứ ở bốn văn bản, catalog nói 29; ⑶ lời "(đo)" về một ranh giới cũng phải có test
(H2 "nhiều cột không tính" là ranh giới tự khai, sai); ⑷ mọi chiều ngược của tệp hardening phải chạy được dưới vai N2 — `to_regclass`
là hàm phân giải tên, không phải hàm đọc catalog; ⑸ dòng trống trong bảng GFM là lỗi vô hình với regex mà hữu hình với người đọc
suốt hai mươi vòng — cổng phải đòi thứ người đọc thấy, không chỉ thứ máy đọc; ⑹ khoản 93: §2 phải là bảng thật, có cổng.

# §S1.49 — khoản nợ 93: một cổng đòi MỌI phán xét của hardening có dòng lý do trong ADR — CỔNG + TÀI LIỆU, không mã sản xuất

**Bề mặt an ninh:** không đổi một dòng SQL sản xuất nào. Cổng mới `tests/architecture/hardening-co-ly-do.test.ts` ([INV-H19])
dựng lại mảng `bang` của `hardening.always.sql` thành 107 hàng × 6 ô, nhận diện MỤC PHÁN XÉT theo tính chất *ô câu sửa no-op*
(ADR-028 §2⑵), và đòi mỗi phán xét — kể cả hai phán xét sống ngoài `bang` — có một khoá tra cứu trong ADR-028/036/037 sau khi
bỏ mọi vùng đã gạch. Tài liệu: ADR-036 §2 hàng 24 và 25, tên hằng vào hàng 2/4/6/10/12/16, §1 nói ra phạm vi; ADR-028 §7 viết
lại theo đúng ranh giới tự chữa/phán xét; ADR-037 §4 nêu tên ba hằng của lớp danh tính.

**Đo:** trước vòng, 11 khoá tra cứu không có dòng lý do — trong đó mục *không có overload lạ của bốn hàm chuỗi kiểm toán*
CHẶN ĐƯỢC DEPLOY mà `DECISIONS.md` không có một chữ nào về nó; sau vòng, 28/28 khoá có lý do. Bản đầu của vòng khai "24/24"
là tính đầy đủ giả: mẫu số sai (lượt soi 41 CAO-1).

**Đỏ đo được, cô lập (5 đột biến):** M1 bỏ khoá TÊN MỤC · M2 bỏ vế ngoài `bang` · M3 bỏ việc loại vùng đã gạch · M4 bỏ NÉM khi
bộ đọc mù · M5 bỏ NÉM khuôn no-op lạ — mỗi đột biến làm đúng MỘT `it` đỏ.

### Lượt soi đối kháng 41 (trên bản đầu của S1.49): 2 CAO, 4 NẶNG, 4 NHẸ, 4 INFO — xử lý hết trong bản ba

| # | Mức | Phát hiện | Kiểm | Xử lý |
|---|---|---|---|---|
| CAO-1 | CAO | Bản đầu lấy trục là HÌNH DẠNG CHUỖI của ô hậu điều kiện — chỉ đổi trục của "theo tên": mù với 2 mục phán xét thật viết thẳng SQL (`schema trùng tên một vai…`, `không có overload lạ…`) và đếm dư 4 hàng TỰ CHỮA; mục "overload lạ" chặn deploy mà DECISIONS không có chữ nào ⇒ lời đo "24/24" là đầy đủ giả | đo: 22 mục phán xét theo ô câu sửa, cổng thấy 19 | trục đổi sang **ô CÂU SỬA no-op** (ADR-028 §2⑵); bộ đọc 107×6; khoá tra cứu = hằng ở vị trí QUAN HỆ, ngược lại TÊN MỤC; đột biến M1 |
| CAO-2 | CAO | `CAU_MEMBERSHIP_LA` và `CAU_ADMIN_LA` chặn deploy qua `loi_gom` ở BƯỚC 3 nhưng sống NGOÀI `bang` ⇒ chủ thể loại chúng theo cấu tạo; cả hai không có trong DECISIONS | đúng theo đọc | vế ⒟ quét khuôn `EXECUTE … || CAU_X || … INTO con_sot; … loi_gom := loi_gom`; `CAU_CAP_PHU_CHUOI` chỉ RAISE WARNING nên cố ý nằm ngoài — nói ra; đột biến M2 |
| NẶNG-1 | NẶNG | `includes` trên cả tệp là rỗng ruột: `CAU_DOC_VONG` chỉ được nhắc như một dấu ngoặc phụ; tên bỏ trong `~~…~~` hay trong §5 "Thứ ADR này KHÔNG làm" cũng qua; `includes` không biên từ | đúng — ca thật | vùng tra cứu = ba khối ADR có thẩm quyền, bỏ mọi `~~…~~`; định danh so biên từ, tên mục so nguyên văn; `CAU_DOC_VONG` có dòng lý do thật ở hàng 10; đột biến M3 |
| NẶNG-2 | NẶNG | Bốn chỗ ngữ nghĩa sai ở tài liệu, một chỗ NGƯỢC ADR-028 §2⑵: đoạn §7 gọi cả bảy mục là "phán xét" rồi khai `REVOKE` không đơn điệu; hàng 12 lật nghĩa cột "Lớp canh" và giữ Đo `n/a`; hàng 10 nhận nhầm hai hằng hình dạng cột; hàng 2 gán lớp DỰNG vào cơ chế THẤY | đúng theo đọc, đối chiếu mã | §7 viết lại (4 phán xét / 3 tự chữa, bỏ mệnh đề trái §2⑵); hàng 12 ghi rõ "lớp ĐÒI" + sửa cột Đo; hàng 25 mới cho trôi hình dạng cột; hàng 2 ghi rõ chiều ngược |
| NẶNG-3 | NẶNG | Sàn `SO_MUC_PHAN_XET = 24` ghim tay, chỉ chặn đổi khuôn TOÀN CỤC chứ không chặn "mọc thêm một mục khuôn khác" — đúng ca sinh ra khoản 93; thông điệp khi số mục GIẢM chẩn đoán ngược | đúng theo đọc | bỏ hằng; sàn suy từ chính tệp (số hàng `ARRAY[`, mỗi hàng 6 ô) và NÉM khi parse hỏng; đột biến M4 |
| NẶNG-4 | NẶNG | Đổi trục là đúng nhưng chỗ THU HẸP không khai: `CAU_QUYEN_BANG_SO_SAI` mang hậu tố `_SAI`, không có trong DECISIONS, ra ngoài cổng | đúng | nói ra ở chú thích cổng và ở thân khoản 93: chín hằng chỉ dùng ở ô CÂU SỬA không bị đòi, kèm lý do |
| NHẸ-1 | NHẸ | inv-matrix gán bất biến theo TỆP: cổng hardening↔ADR nằm trong tệp của H20 ⇒ H20 đỏ được vì một tệp SQL 9317 dòng | đúng — đọc `so-khai-nhan.ts` | tệp mới `hardening-co-ly-do.test.ts`, đăng ký vào **H19** |
| NHẸ-2 | NHẸ | Ba `it` đột biến chỉ phủ RENAME và REFORMAT toàn cục, không phủ ca "mọc thêm một mục"; một `it` dùng `replaceAll` nên không tự khẳng định trúng | đúng | `it` chèn hẳn một hàng `ARRAY[…]` phán xét mới; mọi đột biến khẳng định `not.toBe(...)` |
| NHẸ-3/4 | NHẸ | Regex quét toàn tệp chứ không neo vào ô ⇒ sàn nuôi được bằng chú thích; `includes` không biên từ | đúng | đóng luôn khi parse theo ô; so bằng biên từ |
| INFO-1..4 | INFO | Chi phí đọc 9317 dòng không đáng kể; §2 đã rộng hơn câu hỏi §1; ADR-037 §4 kết bằng câu tự quy chiếu; đã có `docHangHardening` fail-closed dùng chung | xác nhận | §1 nói ra phạm vi; bỏ câu tự quy chiếu; bộ đọc riêng vì cần Ô, không cần giải hằng — nói ra |

**Ba lỗi tự tìm khi cài bản hai, ghi để không gặp lại:** ⑴ regex `\$(\w*)\$…\$\1\$` khớp LỆCH trên thân hàm plpgsql mang
`$1` và `$than$` lồng — phải duyệt ký tự như bộ tách ô; ⑵ `String.replace` với chuỗi thay thế chứa `$'` ăn mất một ô (cùng bẫy
đã đo ở S1.44 — dùng hàm thay thế); ⑶ `'[^']*'` trong regex vấp dấu nháy của `string_agg(x, ', ')`; ⑷ `dotBien` của cổng sổ nợ dùng CHUỖI thay thế — hàng sổ nợ mới mang `$x$` làm hai đột biến P0/P1 xanh giả, sửa sang hàm thay thế.

**Điều đáng mang sang vòng sau:** ⑴ "theo tính chất" phải hỏi *tính chất NÀO của đối tượng nói lên vai trò của nó* — hình
dạng chuỗi ở một ô là một cái tên khác của "theo tên"; ⑵ một cổng tra cứu tài liệu phải nói rõ VÙNG và loại vùng đã gạch,
nếu không nó chỉ đo "chuỗi có tồn tại trong 4000 dòng"; ⑶ khi đổi trục so với hình dạng ghi ở khoản nợ, phải khai chỗ thu hẹp
ngay trong vòng ấy.

# §S1.50 — khoản nợ 91: cửa ra "bật RLS ⇒ khai 83⑶" hết yếu — mọi view/matview phải `security_invoker`, hardening FORCE mọi bảng bật RLS — MÃ SẢN XUẤT; khoản 94 mở

**Bề mặt an ninh:** `db/migrations/hardening.always.sql` — `CAU_DOC_VONG` bỏ VẾ ĐÍCH cho nhánh view/matview (đối xứng nhánh
SECDEF) và nhận đủ bộ boolean của `security_invoker`; hằng mới `VI_TU_FORCE_THIEU` + một mục TỰ CHỮA bật `FORCE ROW LEVEL
SECURITY` trên mọi bảng bật RLS của lược đồ dự án, trừ đối tượng thuộc extension. Test: `db/rls-coverage.int.test.ts`
describe S1.50, fixture dựng dưới vai chủ KHÔNG superuser.

**Đo:** chủ bảng thường + bảng chỉ ENABLE ⇒ app_api đọc `[777, 888]` qua view non-invoker, `[777]` khi đọc thẳng bảng (lỗ ở
đường view, không ở quyền); sau lượt SỬA của `migrate()` ⇒ `relforcerowsecurity` bật ⇒ view trả `[777]`. (C) thấy view thường,
view LỒNG, view ĐỌC QUA HÀM và matview; `v1` đã invoker được tha; `migrate()` NÉM nêu nguyên văn; `security_invoker = yes`
được nhận.

**Kỳ vọng LẬT có chủ đích (thấy ở lượt evidence):** `db/hardening-suy-tu-tinh-chat.int.test.ts` `[khoản nợ 83⑷⑸⑧]` khẳng định *"view trơn không bị phán"*; bỏ vế đích làm một view hằng cũng bị đòi cờ — lật kỳ vọng và ghi lý do tại chỗ, cùng lý lẽ đối xứng với nhánh SECDEF.

**Đỏ đo được, cô lập (4 đột biến):** M1 bỏ mục FORCE · M2 chủ thể FORCE quay lại danh sách khai (bản đầu) — cùng một khẳng
định đỏ, đây là bằng chứng cho CAO-1 · M3 trả lại vế đích của (C) ⇒ `[]` · M4 regex `true|on|1` ⇒ `= yes` bị kêu oan.

### Lượt soi đối kháng 42 (trên bản đầu của S1.50): 2 CAO, 4 NẶNG, 4 NHẸ, 4 INFO — xử lý hết trong bản hai

| # | Mức | Phát hiện | Kiểm | Xử lý |
|---|---|---|---|---|
| CAO-1 | CAO | Mục FORCE lấy chủ thể là `BANG_RLS_NGOAI_TENANT_KHAI` — đúng một hàng `caller_rate_limits`, bảng đã được mục S1.14 ENABLE+FORCE vô điều kiện ⇒ mục mới NO-OP, không đột biến CSDL nào làm đỏ (ADR-028 §2⑷ cấm) | đúng — đột biến M2 tái hiện | chủ thể theo TÍNH CHẤT: mọi bảng bật RLS của lược đồ dự án, trừ extension |
| CAO-2 | CAO | Fixture thuộc `postgres` (SUPERUSER): superuser bỏ qua RLS ở MỌI cấu hình ⇒ lỗ rò đo được không do thiếu FORCE; chú thích quy sai nguyên nhân; không mục nào canh chủ sở hữu quan hệ | đúng theo đọc | fixture dựng dưới vai `zz_chu91` NOSUPERUSER NOBYPASSRLS; thêm đối chứng "đọc thẳng bảng ⇒ [777]" |
| NẶNG-1 | NẶNG | Vế đích mới vẫn hụt: chuỗi view LỒNG (`pg_depend` chỉ nối tham chiếu trực tiếp) và view ĐỌC QUA HÀM; với đích là bảng RLS ngoài tenant thì nhánh "cột org_id" không bao giờ cháy | đúng — hai DDL tái hiện | bỏ hẳn vế đích cho nhánh view/matview, đối xứng nhánh SECDEF; test đo cả hai đường |
| NẶNG-2 | NẶNG | Chủ thể là danh sách tên không kèm lý do (§2⑴); bảng RLS ngoài tenant CHƯA khai không được FORCE trong cửa sổ giữa hai deploy | đúng | vị từ `VI_TU_FORCE_THIEU`; test đo đúng ca "83⑶ còn đang chặn mà lượt SỬA vẫn FORCE" |
| NẶNG-3 | NẶNG | Sau FORCE, bảng có policy chỉ `TO app_api` làm chủ bảng đọc/ghi 0 hàng im lặng (ADR-036 hàng 4/6); 83⑵ không soi vai chủ. Hôm nay chưa có ca nào | đúng — đọc policy 042/044 và hai lượt dọn | **khoản 94**; ranh giới ghi ở chú thích mục và ở hàng 91 |
| NẶNG-4 | NẶNG | Cổng khoản 93 mù với mục mới: hằng đứng sau `JOIN` ngoài regex, và hàng TỰ CHỮA không có khoá tra cứu dù hậu điều kiện chặn được deploy | đúng | nói ra (nới cổng sang mọi hàng tự chữa sẽ đòi ~80 dòng lý do — không làm trong vòng này); dòng lý do cho cơ chế FORCE viết tay vào ADR-036 hàng 7 |
| NHẸ-1 | NHẸ | Thông điệp nói "83⑶/85/86" nhưng 85/86 đòi `NOT relrowsecurity` ⇒ không bao giờ khớp | đúng | thông điệp viết lại theo phạm vi mới (không còn vế đích) |
| NHẸ-2 | NHẸ | `NGOAI_LE_DOC_VONG` là cửa ra yếu nhất tệp: một trục, chung không gian tên quan hệ/hàm (miễn mọi overload), không bản test, không chiều khai thiu, `NOT IN` gặp NULL làm cả mục im | đúng — đối chiếu bốn danh sách khai khác | chưa sửa; ghi vào "điều mang sang" của biên bản 65 ⑹ — cửa ra nay áp cho MỌI view nên phải siết ở vòng sau |
| NHẸ-3 | NHẸ | Regex chỉ nhận `true\|on\|1`; `yes/y/t` là boolean hợp lệ ⇒ chặn deploy trên view ĐÚNG (chiều hỏng ADR-028 §3) | đúng | nới regex; test đặt `= yes`; đột biến M4 |
| NHẸ-4 | NHẸ | Test không đo lớp sản xuất (`migrate()` NÉM) cho vế (C), lệch chuẩn tự đặt của tệp | đúng | thêm khẳng định `migrate()` NÉM nêu nguyên văn hai thông điệp |
| INFO-1..4 | INFO | Nhánh SECDEF không có vế đích (xác nhận — là lý lẽ cho NẶNG-1); FOREIGN TABLE sống nhờ 83⑷, `RULE … DO INSTEAD SELECT` biến thành view nên rơi vào (C), matview lồng là lỗ ngủ; đòi `security_invoker` cho view trên `caller_rate_limits` là ĐÚNG (policy khách fail-close); ca `security_invoker = true` đo đúng, không xanh vì thiếu quyền | xác nhận | ghi vào biên bản |

**Điều đáng mang sang:** ⑴ một mục hardening mới phải được thử bằng câu hỏi "đột biến CSDL nào làm nó đỏ" TRƯỚC khi viết —
mục bị một mục cũ che là mục không đo được (ADR-028 §2⑷); ⑵ mọi phép đo về RLS phải chạy dưới vai chủ KHÔNG superuser, vì
superuser bỏ qua RLS ở mọi cấu hình và làm hai trạng thái khác nhau trông giống nhau; ⑶ `pg_depend` chỉ nối một cạnh — mọi vị
từ "đối tượng này chạm dữ liệu kia" phải hoặc lấy bao đóng, hoặc bỏ hẳn vế đích.

# §S1.51 — khoản nợ 92: ba GUC vận hành gắn sẵn cho phiên từ MỌI nguồn ngoài mức database — mục phán xét ba nhánh, và `migrate()` đọc BA LẦN

**Bề mặt an ninh:** `db/migrations/hardening.always.sql` — `GUC_VAN_HANH_DOI` (ba tên kèm TÍNH CHẤT phải thoả, dạng regex),
`GUC_VAN_HANH_KHAI` (cửa ra, rỗng), `VI_TU_HANG_GUC_VAN_HANH`, `VI_TU_PHIEN_GUC_VAN_HANH_SAI`, `CAU_GUC_VAN_HANH_GAN_SAN`
ba nhánh và MỘT mục PHÁN XÉT trong `bang`; tám ô mô tả của các mục GUC mức VAI hết in giá trị. `packages/db/src/migrate.ts` —
`TU_CHOI_GUC_SOM` và `MAU_SEARCH_PATH_DUNG` xuất ra để test ghim một bản, phép đọc `search_path` TRƯỚC lúc ghim, phép TỪ CHỐI
SỚM (trước lượt sửa), và phép đọc SAU lượt sửa gồm cả ảnh chụp hàng mức database trước/sau. Test: `db/migrations.int.test.ts`
`[khoản nợ 92]`, mười bốn vế có nhãn a, a′, a″, b, c, d, e, f, g, h, i, k, l, m.

**Đo (PostgreSQL 16, lượt này):**
⑴ `ALTER ROLE ALL SET row_security = off` ⇒ kết nối mới có `source = 'global'`, `reset_val = 'off'`; hàng
`pg_db_role_setting` là `(setrole = 0, setdatabase = 0)` — ba mục kề lọc `setdatabase = <db>` nên mù.
⑵ HÀNG CHE: thêm `ALTER DATABASE d SET row_security = on` ⇒ `pg_settings` của phiên chỉ thấy `source = 'database'`,
`reset_val = 'on'` — ĐÚNG giá trị dự án đòi. Bản chỉ-`pg_settings` ĐI QUA và tàn dư `global` sống sót.
⑶ Một câu `SET x = v` trong phiên đổi `setting` và `source` (hoá `session`) mà KHÔNG đụng `reset_val`
(`session_replication_role`: `setting = replica`, `reset_val = origin`). Hai vế của nhánh ⒝ trả lời hai câu khác nhau.
⑷ `ALTER SYSTEM SET search_path` ⇒ kết nối mới có `reset_val = '"ke_gian, public"'`, `source = 'configuration file'`; SAU khi
hardening/migrate ghim `search_path` thì `source` hoá `session` còn `reset_val` GIỮ NGUYÊN giá trị độc — tới BƯỚC 3, hàng "mức
database vừa được ba mục kề chữa xong" và hàng "ALTER SYSTEM" trông HỆT nhau.
⑸ `ALTER ROLE app_api SET search_path = …` KHÔNG làm `migrate()` đỏ: bốn mục `RESET ALL` từ S0 tự chữa đúng bốn vai ứng dụng ở
lượt SỬA. Lỗ thật nằm ở hàng `ALTER ROLE ALL` — test giữ vế đối chứng trên `app_api` để lời ấy có phép đo.
⑹ `ALTER ROLE r IN DATABASE <db khác> SET row_security = off` — hàng KHÔNG phiên nào của database này nhận được — vẫn bị bản
đầu nêu ra ⇒ chặn deploy trên một cụm hợp lệ.
⑺ **Hàng che mang giá trị ĐÚNG** (lượt soi 44 CAO-1): `ALTER SYSTEM SET session_replication_role = replica` +
`ALTER DATABASE d SET session_replication_role = origin` ⇒ phiên deploy đo được `setting = origin`, `source = database`, mục 92
im **đúng như thiết kế**; lượt SỬA gỡ hàng che VÔ ĐIỀU KIỆN ⇒ kết nối mở sau đó đo được `setting = replica`,
`source = configuration file`. Tức bản đầu deploy XANH và tự tay gỡ lớp giảm nhẹ của người vận hành.
⑻ Nguồn `client` (`options=` trên chuỗi kết nối) KHÔNG đo được ở tầng test: `createPool` của dự án từ chối thẳng tham số ấy
(có khẳng định), và `pg` chỉ là import kiểu nên không dựng nổi pool ngoài `createPool`. Nói ra thay vì khẳng định suông.

**Hình dạng cuối — ba nhánh và BA phép đọc:**
⒜ CATALOG: mọi hàng `pg_db_role_setting` mang một trong ba tên, trong phạm vi `VI_TU_HANG_CAU_HINH_UNG_DUNG` (đúng tập của
khoản 87 — mức database, `ALTER ROLE ALL`, vai kết nối ứng dụng), trừ đúng hàng `(setrole = 0, db hiện tại)` mà ba mục kề sở
hữu. Không hỏi `source`, không hỏi giá trị hiệu lực ⇒ miễn nhiễm ƯU TIÊN NGUỒN lẫn tuổi kết nối, và là nhánh duy nhất phủ
`search_path`. ⒝ PHIÊN DEPLOY, hai vế `reset_val` / `setting`. ⒞ dòng khai thiu, dùng LẠI nguyên vẹn hai vị từ của ⒜ và ⒝.
Phép đọc ⑴ TRƯỚC lượt sửa — bốn GUC `app.*`, hai GUC vận hành đọc được, và `search_path` (đọc trước lúc ghim); nguồn
`database` cố ý ĐỨNG NGOÀI, vì từ chối trước lượt sửa thì `ALTER DATABASE … RESET` của ba mục kề không bao giờ chạy và ba mục
thành mã chết (ADR-028 §2⑷). Phép đọc ⑵ và ⑶ NGAY SAU lượt sửa, trước vòng migration đánh số: hàng mức database CÒN (lượt sửa
không đủ quyền ⇒ nói đúng quyền cần có) hay VỪA BỊ GỠ (⇒ đòi kết nối mới, vì giá trị thật sau khi gỡ chỉ đọc được trên phiên
mới). Cả ba nhánh từ chối đều HUỶ client thay vì trả về pool.

**Đỏ đo được, cô lập (TÁM đột biến, mỗi cái đỏ ở MỘT vế khác nhau):** M1 nhánh ⒜ mù ⇒ (a) `ALTER ROLE ALL` · M2 phép từ chối SỚM bắt cả nguồn `database` ⇒ lượt sửa không bao giờ chạy, (b) đỏ · M3 bỏ phép chụp hàng mức database trước/sau lượt sửa ⇒ (i) hàng che đỏ · M4 bỏ vế SETTING ⇒ (g) câu SET còn sót · M5 vế RESET_VAL hết so giá trị ⇒ (d) giá trị ĐÚNG bị kêu oan · M6 bỏ phép đọc `search_path` trước lúc ghim ⇒ (f) `ALTER SYSTEM SET search_path` lọt · M7 nhánh ⒜ hết thu hẹp phạm vi ⇒ (h) hàng của database KHÁC bị nêu · M8 `search_path` so nguyên văn ⇒ (k) `search_path = 'public'` bị chặn oan.

**Ranh giới NÓI RA:** ⑴ nguồn `client`/`PGOPTIONS` phía ứng dụng không có hàng catalog nào và không phiên nào của deploy thấy
— hàng rào duy nhất là `createPool` từ chối `options=`; ⑵ `proconfig` của một hàm MỚI và `pg_parameter_acl` cho ba tên không
dấu chấm vẫn chưa ai soi — **khoản 95**; ⑶ vế RESET_VAL của nhánh ⒝ chưa có đột biến nào làm nó đỏ QUA `migrate()` (phép từ
chối SỚM bao trùm nó ở mọi ca hai GUC đọc được), nó chịu lực ở ca "`SET` đúng giá trị trong phiên che một độc ở conf".

### Lượt soi đối kháng 43 (trên bản đầu của S1.51): 3 NẶNG, 5 NHẸ, 3 INFO — xử lý hết trong bản hai

| # | Mức | Phát hiện | Kiểm | Xử lý |
|---|---|---|---|---|
| NẶNG-1 | NẶNG | Bản đầu chỉ có nhánh `pg_settings`: một hàng ưu tiên CAO hơn CHE hoàn toàn hàng thấp (`file < argv < global < database < user < database user < client`), và lượt sửa xoá hàng che SAU khi `source` của phiên đã chốt ⇒ tàn dư `global` sống qua mọi lượt deploy | đúng — đo được | thêm nhánh ⒜ CATALOG, không hỏi `source`, không hỏi giá trị hiệu lực |
| NẶNG-2 | NẶNG | `search_path` không bao giờ tới được nhánh `pg_settings`: hardening tự ghim nó ở BƯỚC 0 | đúng — đo được | nhánh ⒜ phủ `search_path`; ca `ALTER SYSTEM` chặn ở `migrate()` trước lúc ghim (bản ba) |
| NẶNG-3 | NẶNG | Mục 92 chỉ hỏi ở BƯỚC 3 — SAU khi migration đánh số của cùng lượt đã chạy dưới `replica` và ghi checksum (cùng khuôn 40a H1) | đúng | `migrate()` hỏi hai GUC đọc được NGAY trước lượt sửa |
| NHẸ-1 | NHẸ | Loại `source = 'session'` cho cả ba tên là loại luôn ca một migration `SET` rồi quên `RESET` | đúng | chỉ loại cho `search_path`; bản ba thay hẳn bằng vế SETTING có phép đo |
| NHẸ-3 | NHẸ | So `reset_val` với `boot_val` là neo cổng an ninh vào mặc định BIÊN DỊCH của PostgreSQL ⇒ trôi theo bản trong im lặng | đúng | `GUC_VAN_HANH_DOI` — giá trị dự án tự khai |
| NHẸ-4 | NHẸ | Không vế nào đo "giá trị ĐÚNG thì đi qua" ⇒ vế so giá trị có thể là trang trí | đúng | vế (d): `ALTER SYSTEM SET row_security = on` ⇒ nguồn đổi, deploy vẫn qua |
| NHẸ-5 | NHẸ | Không đo nguồn `user` / `database user` — hai nguồn khả dĩ nhất đời thật | đúng | vế (a″): `ALTER ROLE … SET` và `ALTER ROLE … IN DATABASE … SET` |
| INFO-1..3 | INFO | `ALTER ROLE ALL RESET` là SUSET nên mục phải PHÁN XÉT (xác nhận); `.always` không vào `schema_migrations` nên cửa ra dùng được ngay cả sau một lượt đỏ (xác nhận); ba mục kề in nguyên `setconfig` — có thể mang `app.org_id=<uuid>` | đúng | INFO-3: ba mục kề in TÊN, không giá trị (bản ba mở rộng ra tám mục mức vai) |

### Lượt soi đối kháng 44 (trên bản HAI, tức bản đã xử lý xong lượt 43): 1 CAO, 4 NẶNG, 6 NHẸ, 5 INFO — xử lý hết trong bản ba

| # | Mức | Phát hiện | Kiểm | Xử lý |
|---|---|---|---|---|
| CAO-1 | CAO | Hàng che ở MỨC DATABASE mang GIÁ TRỊ ĐÚNG che một độc `ALTER SYSTEM`/conf: phiên deploy thấy mọi thứ đúng ⇒ cả ba nhánh và cả hai phép đọc đều im, còn lượt SỬA thì gỡ hàng che VÔ ĐIỀU KIỆN ⇒ deploy XANH và mọi phiên ứng dụng sau đó chạy dưới độc | **đúng — đã đo lại** (⑺ ở trên) | `migrate()` chụp hàng mức database TRƯỚC và SAU lượt sửa; gỡ được hàng nào thì DỪNG và đòi kết nối mới — lượt kế mở phiên sạch và phép từ chối SỚM đọc đúng nguồn còn lại. Vế (i) đo cả ba bước. **Kỳ vọng LẬT có chủ đích ở hai test cũ** — `[fix round 5] cấu hình đặt ở MỨC DATABASE` (`migrations.int.test.ts`) và `[khoản nợ 83⑷⑸⑧]` (`hardening-suy-tu-tinh-chat.int.test.ts`, vế mức database) — từng khẳng định lượt chữa xong thì đi thẳng; nay dừng một lượt rồi đi thẳng. Test thứ hai do lượt evidence bắt, không phải lượt soi |
| NẶNG-1 | NẶNG | Bốn chỗ trong test còn ghim THÔNG ĐIỆP CŨ của phép từ chối sớm: ba `toContain` đỏ, và hằng `TU_CHOI_SOM` của `bat87` thoái hoá thành no-op vì vế trái không bao giờ đúng nữa ⇒ bằng chứng của khoản 87 và 40a H1 rỗng ruột | **đúng — tệp đang ĐỎ**, em chỉ chạy `-t "khoản nợ 92"` nên không thấy | chuỗi sống MỘT bản: `TU_CHOI_GUC_SOM` xuất từ `@trustprocure/db`, bốn chỗ import nó |
| NẶNG-2 | NẶNG | Phép đọc sau lượt sửa in "lượt sửa đã gỡ …" cả khi lượt sửa ăn 42501 và KHÔNG gỡ được ⇒ chỉ người vận hành vào vòng lặp vô hạn; và `release()` trần trả chính phiên độc về pool nên "chạy lại trên kết nối mới" không thực hiện được trong cùng tiến trình | đúng | tách hai ca theo hàng catalog còn/hết, nói đúng quyền cần có; cả ba nhánh từ chối gọi `release(err)` để huỷ client |
| NẶNG-3 | NẶNG | `search_path` bị so NGUYÊN VĂN `'"$user", public'` ⇒ cụm đặt `search_path = 'public'` — cấu hình AN TOÀN HƠN, và là cách tự chữa khoản 78 — bị chặn VĨNH VIỄN, không cửa ra (migrate() không đọc `GUC_VAN_HANH_KHAI`) | đúng | xét theo TÍNH CHẤT: không schema nào ngoài `"$user"`/`pg_catalog` được đứng TRƯỚC `public`; vế (k) đo `'public'` và `'pg_catalog, public'` |
| NẶNG-4 | NẶNG | Nhánh ⒜ soi MỌI vai MỌI database trong khi mục anh em (khoản 87) thu hẹp bằng `VI_TU_HANG_CAU_HINH_UNG_DUNG` ⇒ `ALTER ROLE dba SET search_path` chặn deploy, và cửa ra chỉ theo TÊN GUC nên khai xong là mù luôn với `ALTER ROLE ALL` | đúng | dùng đúng `VI_TU_HANG_CAU_HINH_UNG_DUNG`; vế (m) đo vai thứ ba không bị chặn |
| NHẸ-3 | NHẸ | Chuẩn "chỉ TÊN, không giá trị" của chính vòng này mới áp cho ba mục; tám mục mức VAI vẫn in nguyên `rolconfig`/`setconfig`, và test 87 dựng `app.org_id = <uuid>` rồi khẳng định thông điệp chứa tên mục ⇒ UUID đi vào log CI | đúng | tám ô mô tả đổi sang `split_part(c, '=', 1)`; thêm `not.toContain(guc)` vào đúng chỗ ấy |
| NHẸ-5 | NHẸ | `session_replication_role = local` bắn ĐÚNG tập trigger như `origin` ⇒ chặn deploy vì `local` là chặn không lý do | đúng | tính chất nhận `^(origin\|local)$`; vế (l) đo |
| NHẸ-6 | NHẸ | Nhánh ⒞ chép tay vị từ của ⒝ và chép THIẾU vế SETTING ⇒ một dòng khai đang chịu lực bị báo "thiu" | đúng | hai vị từ tách thành hằng, ⒞ dùng lại nguyên vẹn |
| NHẸ-1, NHẸ-2 | NHẸ | `proconfig` của hàm MỚI (nhánh ⒠ của 87 lọc `LIKE '%.%'` nên loại ba tên không dấu chấm) và `GRANT SET ON PARAMETER session_replication_role` cho vai không superuser — hai đường lật tiền đề "chỉ superuser đặt được", không mục nào hỏi | đúng | **chưa sửa — khoản nợ 95**, kèm hình dạng mã người soi đã nêu |
| NHẸ-4 | NHẸ | Vế RESET_VAL của nhánh ⒝ không có đột biến nào làm nó đỏ QUA `migrate()`: phép từ chối SỚM bao trùm nó ở mọi ca hai GUC đọc được, còn `search_path` thì bị loại | đúng | ghi thành ranh giới ⑶ ở trên; vế (c) giữ nguyên nhưng chú thích nói đúng lớp bắt |
| INFO-1..5 | INFO | `options=`/PGOPTIONS phía ứng dụng còn ngoài tầm (ghi vào ranh giới ⑴); `SET ROLE` KHÔNG áp lại `pg_db_role_setting` nên không phải lỗ (xác nhận, trục đóng); so `search_path` là so nguyên văn nên `'$user, public'` trong conf khác chuỗi ghim (cùng lớp NẶNG-3, đã sửa cùng); `mo_ta` NULL làm `string_agg` nuốt hàng ⇒ thêm `coalesce`; test khớp tên database thô — chưa sửa, ghi ra | đúng | bốn xử lý như cột trái; INFO-5 để nguyên (tên database của fixture luôn thường) |

**Điều đáng mang sang vòng sau:** ⑴ chạy `vitest -t "<tên vế>"` là chạy MỘT test và bỏ qua 104 test còn lại — mọi vòng đổi một
chuỗi mà mã khác ghim phải chạy TRỌN tệp trước khi tin (NẶNG-1 là ca đắt nhất của bài học này); ⑵ một lượt SỬA tự chữa có thể
GỠ MẤT lớp giảm nhẹ của người vận hành — mỗi mục tự chữa phải được hỏi "cái nó xoá có đang che gì không"; ⑶ một cổng an ninh
so NGUYÊN VĂN một giá trị mặc định là một cổng chặn nhầm cụm an toàn hơn: so theo TÍNH CHẤT; ⑷ thông điệp lỗi deploy là bề mặt
rò dữ liệu — tên thì được, giá trị thì không, và chuẩn ấy phải áp cho MỌI mục cùng lớp chứ không chỉ mục của vòng đang làm.

# §S1.52 — khoản nợ 95: ba GUC vận hành qua `proconfig` của hàm và qua `pg_parameter_acl` — hai nhánh phán xét mới, và tính chất `search_path` của khoản 92 cấm `pg_catalog` đứng sau

**Bề mặt an ninh:** `db/migrations/hardening.always.sql` — `CAU_GUC_VAN_HANH_GAN_SAN` thêm nhánh ⒟ (`pg_parameter_acl`,
vị từ `VI_TU_ACL_GUC_VAN_HANH_SAI`) và nhánh ⒠ (`proconfig` của hàm trong lược đồ dự án, vị từ
`VI_TU_HAM_GUC_VAN_HANH_SAI`); nhánh dòng khai thiu dùng lại nguyên vẹn cả hai vị từ; `GUC_VAN_HANH_DOI` thêm cột `cam`;
tên và ô quyền của mục trong `bang` nay nói "(khoản 92, 95)". `packages/db/src/migrate.ts` — `searchPathDung` =
`MAU_SEARCH_PATH_DUNG` và không `CAM_SEARCH_PATH`, dùng ở phép đọc `search_path` trước lúc ghim. Test:
`db/migrations.int.test.ts` `[khoản nợ 95]`, các vế (a)…(g).

**Đo trước khi viết (PostgreSQL 16):**
⑴ Lược đồ thật chỉ có hai dạng proconfig cho ba tên: `search_path=pg_catalog, public` (42 hàm) và `search_path=pg_catalog`
(18 hàm); không hàm nào mang `row_security` hay `session_replication_role`. `pg_parameter_acl` rỗng sau `migrate()`.
⑵ Vai KHÔNG superuser tạo được hàm mang `SET search_path = 'ke_gian, public'` và `SET row_security = off`;
`SET session_replication_role = replica` thì 42501, cả khi tạo hàm lẫn khi SET trong phiên.
⑶ Sau `GRANT SET ON PARAMETER session_replication_role`: vai ấy SET được replica trong phiên và tạo được hàm mang nó.
`ALTER SYSTEM SET session_replication_role` vẫn 42501 cho tới `GRANT ALTER SYSTEM ON PARAMETER`, rồi chạy được.
`aclexplode(paracl)` in cả hai dòng của chủ tham số (`postgres`: SET và ALTER SYSTEM).
⑷ Hàm SECURITY DEFINER của superuser mang `SET session_replication_role = replica`: người gọi thường đọc ra `replica`
trong thân hàm. Bản SECURITY INVOKER: người gọi thường ăn 42501.
⑸ `pg_settings.context`: `row_security` = user, `search_path` = user, `session_replication_role` = superuser.
`GRANT SET ON PARAMETER` trên hai tham số USERSET hợp lệ nhưng không trao gì. `GRANT ALTER SYSTEM ON PARAMETER search_path`
cho vai thường ⇒ vai ấy chạy được `ALTER SYSTEM SET search_path`.
⑹ **Lỗ của chính khoản 92:** với `public.lower(text)` trả `CUOP`, `lower('ABC')` ra `abc` dưới `"$user", public`, `public`
và `pg_catalog, public`, nhưng ra `CUOP` dưới `public, pg_catalog` và `"$user", public, pg_catalog` — và cả trong thân một
hàm mang `search_path=public, pg_catalog`. Tính chất merge ở S1.51 nhận mọi thứ sau `public`, nên nhận cả hai dạng cướp.

**Hình dạng (bản hai, sau lượt soi 45):** ⒟ `pg_parameter_acl` — grantee PUBLIC hay vai không superuser; quyền `ALTER SYSTEM`
trên cả ba tên, `SET` chỉ trên tham số có `pg_settings.context = 'superuser'`. ⒠ `proconfig` của hàm trong lược đồ dự án (trừ
extension; không lọc `prokind` nên thủ tục cũng được soi) mang giá trị trái tính chất. Tính chất ở `GUC_VAN_HANH_DOI`, dùng
chung cho phiên và hàm: `search_path` khớp `mau` và không khớp `cam` (`pg_catalog` chỉ ở vị trí đầu; trước `public` chỉ
`pg_catalog` rồi `"$user"`; nhận `pg_catalog`, `""`, `pg_catalog, pg_temp`, `"$user"`, `pg_catalog, "$user"`);
`row_security` nhận mọi cách viết TRUE không phân biệt hoa/thường; `session_replication_role` nhận `origin`/`local` không
phân biệt hoa/thường. Nhánh dòng khai thiu dùng lại nguyên vẹn cả hai vị từ mới. Hai lớp (hardening và `searchPathDung`)
dùng cùng CHUỖI regex; cùng QUY TẮC chỉ trên miền ASCII không xuống dòng, ngoài miền ấy bản TypeScript nghiêm hơn.

**Đo thêm sau lượt soi 45:** ⑺ `proconfig` lưu NGUYÊN cách viết boolean: `SET row_security = true` ⇒ `row_security=true`,
cả `yes`, `1`, `t` (`TRUE` hạ thành `true`); `ALTER SYSTEM SET row_security = true` ⇒ `pg_settings.reset_val = on`.
⑻ PostgreSQL bỏ nháy thừa khi lưu: `"$user", "public"` ⇒ `"$user", public`, `"public"` ⇒ `public`, `PUBLIC` ⇒ `public`;
`"PUBLIC"` giữ nháy (schema khác); `'$user, public'` thành MỘT phần tử `"$user, public"`. ⑼ Thân hàm `set_config(…, false)`:
hàm SECURITY DEFINER của superuser đặt replica ⇒ phiên người gọi thường Ở LẠI replica sau khi trả về; có mệnh đề `SET
search_path = pg_catalog` cũng không khôi phục; hàm INVOKER của vai thường đặt `search_path` ⇒ phiên người gọi giữ nó; bản
INVOKER đặt replica thì 42501. Đây là **khoản 96**.

**Đỏ đo được, cô lập (mười đột biến):** M1 nhánh ⒟ mù ⇒ (g) · M2 nhánh ⒠ mù ⇒ (c) · M3 bỏ vế `context` ⇒ vế đối chứng
`GRANT SET` trên tham số USERSET bị nêu oan · M4 nhánh ⒠ bỏ `cam` ⇒ (d) · M5 `searchPathDung` bỏ `CAM_SEARCH_PATH` ⇒ (e) ·
M6 bỏ dạng `pg_catalog` đơn ⇒ 18 hàm thật bị nêu oan nên `migrate()` NÉM ngay lượt đầu của test, trước cả vế (a) · M7 bỏ dạng `""` ⇒ vế chuỗi rỗng · M8 bỏ dạng `pg_catalog, pg_temp`
⇒ vế pg_temp · M9 quay về ĐÒI `public` ⇒ vế `pg_catalog, "$user"` · M10 `row_security` quay về `^on$` ⇒ vế `row_security = true`.

**Ranh giới NÓI RA:** ⑴ thân hàm `set_config` / `SET` — khoản 96 (đo ⑼); `EXECUTE` động không quét được bằng văn bản, nên
lớp chịu lực còn lại là ứng dụng. ⑵ grantee là SUPERUSER trực tiếp và một vai thường là thành viên kế thừa của nó — ⒟ không
bắc cầu; ngoài mô hình vì làm thành viên một superuser đã là leo thang tối đa (lượt soi 45 INFO-3). ⑶ hàm `pg_temp` và hàm
thuộc extension đứng ngoài `MAU_SCHEMA_DU_AN` / vế `deptype 'e'` — cố ý (INFO-4). ⑷ `options=`/`PGOPTIONS` phía ứng dụng —
như S1.51.

**Tự bắt, không phải lượt soi:** ⑹ lỗ của tính chất khoản 92 (`public, pg_catalog`); và ca chặn oan `pg_catalog, pg_temp`
(sửa trước khi lượt soi trả về — người soi được báo trước để không tốn công).

### Lượt soi đối kháng 45 (trên bản đầu của S1.52): 0 CAO, 0 NẶNG, 3 NHẸ, 4 INFO — xử lý hết trong bản hai

| # | Mức | Phát hiện | Kiểm | Xử lý |
|---|---|---|---|---|
| NHẸ-1 | NHẸ | Tính chất `search_path` ĐÒI có `public` ⇒ `"$user"` đứng một mình và `pg_catalog, "$user"` bị chặn oan — nay lan sang `proconfig` | đúng — đo: PG lưu đúng hai dạng ấy | nhận cả hai; vế test `pg_catalog, "$user"`; đột biến M9 |
| NHẸ-2 | NHẸ | Thân hàm `set_config` / `SET LOCAL` là ranh giới ⒠ không thấy; bất đối xứng với máy quét ĐỌC `CAU_TEN_GUC_DU_AN_DOC` | **đúng, và nặng hơn người soi phỏng đoán** — đo ⑼: phiên người gọi Ở LẠI giá trị sau khi hàm trả về, kể cả hàm có mệnh đề SET | **chưa sửa — khoản 96**, kèm bốn phép đo và hình dạng mã |
| NHẸ-3 | NHẸ | `^on$` giả định `row_security` được chuẩn hoá; `proconfig` có thể lưu `true` ⇒ chặn oan (phỏng đoán) | **đúng — đo ⑺** | so không phân biệt hoa/thường với mọi cách viết TRUE; `session_replication_role` cũng không phân biệt hoa/thường; vế test `row_security = true` (và `= off` bị nêu); đột biến M10 |
| INFO-1 | INFO | Regex ARE ↔ JavaScript khác ở `\s` (Unicode) và `.` (xuống dòng); phân kỳ fail-closed — bản TypeScript nghiêm hơn | đúng — đọc | hạ giọng chú thích "cùng một quy tắc" ở cả hai lớp về miền ASCII |
| INFO-2 | INFO | `"public"` có nháy: PG có bỏ nháy thừa không (phỏng đoán) | đo ⑻: có bỏ; `"PUBLIC"` là schema khác | không đổi |
| INFO-3 | INFO | ⒟ xét `rolsuper` của grantee trực tiếp, không bắc cầu qua nhóm superuser | đúng — ngoài mô hình | ghi thành ranh giới ⑵ |
| INFO-4 | INFO | `pg_temp`/extension bị loại; `prokind` KHÔNG lọc nên thủ tục có SET cũng bị soi | đúng — xác nhận | ghi thành ranh giới ⑶ |

**Điều đáng mang sang vòng sau:** ⑴ một tính chất regex đặt ở hai engine phải khai MIỀN mà nó đúng — "cùng một chuỗi" không
phải "cùng một quy tắc"; ⑵ catalog lưu giá trị theo CÁCH VIẾT, không theo NGHĨA (`proconfig` giữ `true`, `pg_settings` in
`on`) — so giá trị phải so theo ngữ nghĩa kiểu; ⑶ một tính chất "chỉ quan tâm thứ đứng TRƯỚC" phải được đo bằng một phép
cướp thật, vì PostgreSQL phân giải khác nhau tuỳ `pg_catalog` có được NÊU TÊN hay không; ⑷ phỏng đoán của người soi về giới
hạn khai thác ("phiên sẽ được khôi phục") cũng phải đo — lần này nó sai theo chiều nguy hiểm.

# §S1.53 — khoản nợ 94: 83⑵ cho CHỦ BẢNG — sau khi khoản 91 FORCE mọi bảng RLS, mọi lệnh của chủ bảng phải có policy PERMISSIVE phủ

**Bề mặt an ninh:** `db/migrations/hardening.always.sql` — hằng mới `CAU_PHU_LENH_CHU_BANG_SAI` và MỘT mục PHÁN XÉT trong
`bang`, đặt ngay sau mục 83⑵. Test: `db/rls-coverage.int.test.ts` describe `[S1.53 / khoản nợ 94]`, hai `it`, fixture dựng
dưới vai chủ KHÔNG superuser (`zz_chu94`) cùng khuôn S1.50.

**Đo trước khi viết (PostgreSQL 16):**
⑴ Lược đồ thật: cả 30 bảng bật RLS thuộc `postgres` (superuser) trên cụm test, và CẢ 30 đều có policy PERMISSIVE `TO PUBLIC`
ở mọi lệnh (SELECT, INSERT, UPDATE, DELETE) — không bảng nào, không lệnh nào, thiếu. Nên mục mới không chặn cụm hợp lệ nào,
kể cả khi chủ bảng là vai deploy thường (hồ sơ sản xuất).
⑵ Chủ KHÔNG superuser, bảng có 2 hàng, ENABLE + FORCE, policy duy nhất `TO app_api USING (true) WITH CHECK (true)`: chủ bảng
`SELECT count(*)` ra 0; `UPDATE … SET id = id` báo 0 hàng; `DELETE … WHERE id > 0` báo 0 hàng — cả ba KHÔNG LỖI; `INSERT`
ném 42501 "new row violates row-level security policy".
⑶ Thêm `CREATE POLICY p_nhom … TO zz_nhom94` rồi `GRANT zz_nhom94 TO zz_chu94`: chủ bảng đọc ra 2 hàng. `pg_has_role(chủ,
nhóm, 'USAGE')` = true, `pg_has_role(chủ, app_api, 'USAGE')` = false — khớp `has_privs_of_role` mà RLS dùng.

**Hình dạng:** chủ thể theo TÍNH CHẤT — mọi bảng (r/p) bật RLS và FORCE trong lược đồ dự án, trừ đối tượng extension, tenant
hay không; chủ superuser hay BYPASSRLS đứng ngoài vì RLS không áp cho họ ở cấu hình nào. Với mỗi lệnh trong bốn lệnh, đòi
một policy PERMISSIVE có `polcmd` là lệnh ấy hoặc `*`, và danh sách vai là `PUBLIC` hoặc chứa một vai mà chủ bảng có quyền
của nó (`pg_has_role … 'USAGE'`). Vế phủ chỉ hỏi DANH SÁCH VAI, không hỏi biểu thức USING — policy tenant `TO PUBLIC USING
(org_id = …)` được tính là phủ, vì 0 hàng khi chưa gắn tổ chức là [INV-F1] fail-closed có chủ đích. PHÁN XÉT, không tự chữa.


**Đo thêm sau lượt soi 46:** ⑷ chủ bảng tự `REVOKE UPDATE, DELETE` ⇒ `has_table_privilege(chủ, bảng, 'UPDATE')` và
`has_any_column_privilege(…, 'UPDATE')` ra false, SELECT vẫn true; UPDATE của chủ ném 42501. ⑸ bảng phân vùng của chủ thường,
cha và lá cùng ENABLE + FORCE, policy `TO PUBLIC` chỉ trên cha: chủ đọc QUA CHA ra 2, đọc THẲNG lá ra 0, UPDATE thẳng lá báo 0
hàng; bản đầu của mục nêu lá đủ bốn lệnh. ⑹ bảng ngoài `public` bật RLS với policy PERMISSIVE `TO PUBLIC`: `CAU_POLICY_LOP_SAI`
(83⑴) nêu "không thuộc lớp nào" — khoản 98.

**Hình dạng (bản hai):** chủ thể = mọi bảng (r/p) bật RLS và FORCE trong lược đồ dự án, trừ extension, trừ chủ
superuser/BYPASSRLS, trừ bảng con của một cha bật RLS; với mỗi lệnh chủ bảng còn quyền (`has_any_column_privilege` cho
SELECT/INSERT/UPDATE, `has_table_privilege` cho DELETE), đòi một policy PERMISSIVE có `polcmd` là lệnh ấy hay `*` và danh sách
vai là PUBLIC hay chứa một vai chủ bảng có quyền của nó. Thông điệp đặt `TO <chủ bảng>` trước, cảnh báo `TO PUBLIC`.

**Đỏ đo được, cô lập (mười hai đột biến):** M1 mục mù ⇒ `it` thứ nhất · M2 bỏ phủ QUA NHÓM ⇒ vế nhóm · M3 bỏ vế loại chủ
superuser ⇒ vế chủ superuser — cần HAI sửa: gỡ p_api trước khi đổi chủ, VÀ chủ mới là vai SUPERUSER NOBYPASSRLS (lượt đột biến đầu của bản hai cho thấy M3 SỐNG: vai bootstrap mang cả BYPASSRLS nên vế BYPASSRLS che vế superuser — có khẳng định trong test) · M4 bỏ vế khớp LỆNH ⇒ policy `FOR SELECT` phủ oan cả
bốn lệnh · M5 gỡ mục khỏi `bang` ⇒ "migrate() NÉM nêu nguyên văn" · M6 RESTRICTIVE được tính là phủ ⇒ vế RESTRICTIVE · M7 bỏ vế
BYPASSRLS ⇒ vế chủ BYPASSRLS · M8 bỏ vế FORCE ⇒ vế NO FORCE · M9 bỏ vế `relrowsecurity` ⇒ vế tắt RLS còn cờ FORCE · M10 bỏ vế
extension ⇒ vế `ALTER EXTENSION plpgsql ADD TABLE` · M11 bỏ vế loại bảng con ⇒ vế lá phân vùng · M12 bỏ vế quyền ⇒ vế chủ đã
tự REVOKE.

**Ranh giới NÓI RA:** ⑴ DML THẲNG lên bảng con dưới chủ bảng cho 0 hàng như mọi vai (đo ⑸) — đường đúng là qua cha, và cha vẫn bị
soi. ⑵ Mức bảo đảm là trạng thái tại lượt phán xét: gỡ policy, backfill 0 hàng, dựng lại policy trong cùng một lượt thì xanh. ⑶
USING của bảng tenant khi chưa gắn tổ chức ([INV-F1] fail-closed có chủ đích); RESTRICTIVE đã khai loại chủ bảng; `OWNER TO` một
vai BYPASSRLS. ⑷ Vai chạy migration không thừa kế chủ — khoản 97. ⑸ Policy ngoài `public` không có đường khai ở 83⑴ — khoản 98.

### Lượt soi đối kháng 46 (trên bản đầu của S1.53): 1 NẶNG, 3 NHẸ, 5 INFO — xử lý trong bản hai, hai phát hiện thành khoản 97 và 98

| # | Mức | Phát hiện | Kiểm | Xử lý |
|---|---|---|---|---|
| NẶNG-1 | NẶNG | Lá phân vùng của bảng tenant bị nêu oan khi chủ không superuser — đúng hồ sơ N2/N3; dự án đã chọn khuôn "policy trên cha, lá không policy" ở ba lớp; lá ngoài `public` là ngõ cụt vì 83⑴ nêu mọi policy ngoài `public` mà không có đường khai | **đúng — đo ⑸ và ⑹** (người soi chỉ đọc mã) | loại bảng con của cha bật RLS; vế test lá phân vùng + tách lá làm đối chứng; đột biến M11; phần 83⑴ thành **khoản 98** |
| NHẸ-2 | NHẸ | Mục không xét quyền như 83⑵: đòi policy cho lệnh chủ đã tự REVOKE; thông điệp gợi `TO PUBLIC` trước — lối ra phủ luôn vai ứng dụng | **đúng — đo ⑷** | chỉ lệnh chủ còn quyền; thông điệp đặt `TO <chủ bảng>` trước; vế test REVOKE rồi GRANT lại; đột biến M12 |
| NHẸ-3 | NHẸ | "tức của mọi migration chạy dưới vai deploy" sai ở N2: vai chạy migration không phải chủ và không thừa kế chủ thì không được soi | đúng — đọc | sửa câu chữ ở thông điệp và ADR-036 hàng 27; chủ thể `current_user` là **khoản 97** |
| NHẸ-4 | NHẸ | Hai khẳng định rỗng ruột ("lược đồ thật", "chủ superuser đứng ngoài") và năm vế lọc không đối chứng (`polpermissive`, BYPASSRLS, FORCE, `relrowsecurity`, extension) | **đúng — không có các sửa này thì M3 và M6–M10 sẽ SỐNG; M3 còn sống qua lượt đột biến đầu của bản hai vì vai bootstrap mang cả BYPASSRLS (đo)** | census độc lập chủ bảng; gỡ p_api trước khi đổi chủ; `it` mới cho năm vế lọc; đột biến M6–M10 |
| INFO-5 | INFO | Thứ tự: không chặn oan, nhưng gỡ policy / backfill 0 hàng / dựng lại trong cùng một lượt thì lượt phán xét cuối không thấy | đúng — đọc `migrate.ts` | ghi mức bảo đảm vào ADR-036 hàng 27 |
| INFO-6 | INFO | Các đường 0 hàng khác của chủ bảng ngoài phạm vi mục (USING tenant, RESTRICTIVE đã khai, `OWNER TO` BYPASSRLS) | đúng | ghi vào ADR-036 hàng 27 |
| INFO-7 | INFO | Policy `TO M` với M thừa kế chủ O vẫn nêu O; bảng extension tạo lúc chạy (chunk) cùng lớp NẶNG-1 | đúng — lối ra rẻ `TO M, O`; chunk là bảng con nên đã được bản hai loại | không đổi thêm |
| INFO-8 | INFO | `pg_has_role … 'USAGE'` khớp `has_privs_of_role` của RLS; oid lạ trả false (fail-closed); lối tắt superuser là gốc NHẸ-4b | đúng | không đổi |
| INFO-9 | INFO | ADR-036 hàng 27 (và hàng 26 của S1.51) thiếu ô "Đo" — bảng §2 có năm cột | **đúng — đếm dấu `\|`: năm cột ở tiêu đề, bốn ở hai hàng ấy** | thêm ô "Đo" cho cả hai hàng |

**Điều đáng mang sang vòng sau:** ⑴ một mục phán xét mới phải được thử trên HỒ SƠ SẢN XUẤT (chủ bảng thường), không chỉ trên
cụm test nơi mọi bảng thuộc superuser — vế loại superuser làm cả lược đồ thật im và che mọi chặn oan; ⑵ một khẳng định "đứng
ngoài" phải được dựng sao cho KHÔNG vế nào khác cũng cho cùng kết quả — với superuser, `pg_has_role` luôn đúng, và vai bootstrap mang CẢ BYPASSRLS nên che luôn vế superuser (lượt đột biến bắt, không phải lượt soi); ⑶ mục kề phải
cùng chuẩn cả ở những vế không hiện lên trong tên mục — 83⑵ xét quyền đã cấp, 94 bản đầu thì không; ⑷ khi thêm hàng vào một
bảng tài liệu, đếm cột theo tiêu đề.

# §S1.54 — khoản nợ 96: mã của lược đồ dự án GHI ba GUC vận hành vào phiên người gọi — hardening quét văn bản tĩnh, `withTenant` không commit dưới replica và huỷ kết nối nhiễm

**Bề mặt an ninh:** `db/migrations/hardening.always.sql` — hằng mới `CAU_MA_GHI_GUC_VAN_HANH`, nhánh ⒡ của
`CAU_GUC_VAN_HANH_GAN_SAN` (mục phán xét nay mang tên "(khoản 92, 95, 96)") và một vế mới ở nhánh dòng khai thiu;
`packages/tenancy/src/with-tenant.ts` — câu COMMIT thành `DO …; COMMIT`, phép đọc lại ở khối `finally` thêm ba GUC. Test:
`db/migrations.int.test.ts` `[khoản nợ 96]`; `packages/tenancy/src/with-tenant.int.test.ts` describe `[S1.54 / khoản nợ 96]`
(tám `it`).

**Đo trước khi viết (PostgreSQL 16, người gọi `app_api`):**
⑴ Lược đồ thật: không đối tượng nào ngoài `pg_catalog`/`information_schema` nhắc tới ba tên ở thân hàm, BEGIN ATOMIC, policy,
DEFAULT, CHECK hay rule; không hàm dự án nào chứa `set_config`, `pg_settings` hay `SET SESSION|LOCAL`.
⑵ Hàm SECURITY DEFINER của superuser, thân `set_config('session_replication_role', 'replica', false)`: `app_api` gọi xong thì
CHÍNH phiên nó ở `replica`; trigger BEFORE INSERT (`ENABLE` thường) không chạy; khoá ngoại tới một hàng không tồn tại đi qua;
`app_api` chạy `SET session_replication_role = origin` hay `RESET` đều 42501 — không tự thoát được.
⑶ Thêm mệnh đề `SET search_path = pg_catalog` vào hàm ấy: phiên vẫn ở replica. `SET LOCAL … = replica` trong thân (không mệnh
đề): replica tới hết giao dịch rồi về origin. Hàm có mệnh đề `SET session_replication_role = origin`: `SET LOCAL` trong thân bị
khôi phục khi trả về, còn `SET` không LOCAL thì SỐNG sau khi trả về.
⑷ `EXECUTE format('SET %s = %s', 'session' || '_replication_role', 'replica')`: phiên ở lại replica — không văn bản nào mang tên.
⑸ Hàm SECURITY INVOKER của vai thường đặt `search_path = 'ke_gian, public'` bằng `set_config`, bằng `SET` trong plpgsql, và bằng
`SET` trong thân LANGUAGE sql: phiên người gọi giữ giá trị. Bản đặt replica: 42501.
⑹ Bề mặt khác, cùng hiệu ứng trên phiên `app_api`: `UPDATE pg_settings SET setting = … WHERE name = 'search_path'`; view
`SELECT set_config(…)`; DEFAULT của cột; policy USING; CHECK của bảng; thân BEGIN ATOMIC. Deparse ra
`set_config('search_path'::text, …)`. Trigger nhận `WHEN (set_config(…) IS NOT NULL)`; CHECK của domain nằm ở `pg_constraint` với
`connamespace` của domain. Biểu thức chỉ mục và cột sinh không mang được `set_config` (42P17); `set_config` không có tên tham số
(đối số có tên ném 42883). Bí danh `LANGUAGE internal AS 'set_config_by_name'`: superuser tạo được và nó ghi vào phiên
(`prosrc = set_config_by_name`); vai thường 42501.
⑺ Tên GUC không phân biệt hoa/thường, kể cả có nháy kép: `set_config('SESSION_REPLICATION_ROLE', …)`, `SET
"session_replication_role" = replica`, `SET Session_Replication_Role TO replica`, `SET "SEARCH_PATH" = …` đều có hiệu lực; `prosrc`
giữ nguyên cách viết.
⑻ `withTenant`: `app_api` có USAGE trên plpgsql, không có TEMP. Trong giao dịch có hàm đặt replica, câu nhiều lệnh `DO … RAISE
SQLSTATE 'TP096' …; COMMIT` ném TP096, câu kế báo 25P02 (COMMIT không chạy), ROLLBACK xoá hàng đã chèn VÀ đưa phiên về origin;
giao dịch sạch ⇒ `["DO","COMMIT"]` và hàng được ghi; giao dịch đã hỏng ⇒ DO ném 25P02. `current_schemas` bỏ schema chưa tồn tại
hay không có USAGE; `public, pg_catalog` ⇒ `{public,pg_catalog}`; `SET search_path = pg_temp, public` dưới vai không TEMP ⇒
`current_schemas` ném 42501.
⑼ 34 mẫu thử cho ba khuôn ARE (22 dương, 12 âm) trên PostgreSQL thật — không mẫu nào sai.

**Hình dạng (bản hai):** ⒜ HARDENING — nhánh ⒡ quét văn bản tĩnh của mọi mã lược đồ dự án (lọc `MAU_SCHEMA_DU_AN`, loại đối
tượng extension theo lớp của đối tượng chủ) trên tám bề mặt: `prosrc`, BEGIN ATOMIC, policy USING, policy WITH CHECK, DEFAULT,
CHECK của bảng và của domain, `pg_rewrite` (rule/view), WHEN của trigger; ba khuôn ARE không phân biệt hoa/thường, tên lấy từ
`GUC_VAN_HANH_DOI`: `set_config(` với tên nguyên văn là đối số đầu (viết `'…'`, `E'…'`, `U&'…'` hay dollar-quote); `SET
[SESSION|LOCAL] <tên> =|TO` và `RESET <tên>|ALL` (tên trần, có nháy hay `U&"…"`); `UPDATE [pg_catalog.]pg_settings` cùng thân với
tên nguyên văn ở bất kỳ chỗ nào sau nó. Khoảng cách giữa hai token là khoảng trắng HOẶC chú thích, kể cả chú thích lồng; không
lột gì khỏi văn bản. Tôn trọng `GUC_VAN_HANH_KHAI`; nhánh dòng khai thiu dùng lại cùng hằng. PHÁN XÉT, không tự chữa: sửa là viết
lại mã. ⒝ `withTenant` — ⑴ COMMIT đi cùng câu với một khối DO ném TP096 khi `session_replication_role` không phải origin/local ⇒
không commit dưới replica, kể cả khi kết nối nhiễm từ trước; TP096 và 25P02 đổi thành `TenantError`; ⑵ `finally` đọc lại
`session_replication_role` và `row_security` theo TÍNH CHẤT (origin/local; on), và `current_schemas(false)` so với mốc đọc trong
round-trip BEGIN (mốc thiếu cũng tính là lệch) ⇒ lệch thì huỷ kết nối; phép đọc ném thì cũng huỷ. Không thêm round-trip.

**Tự bắt, không phải lượt soi:** bản đầu của `withTenant` so `current_schemas(true)`. Đo: sau `CREATE TEMP TABLE` dưới vai có
TEMP, `true` đổi `{pg_catalog,public}` thành `{pg_temp_3,pg_catalog,public}` còn `false` giữ `{public}` ⇒ bản đầu huỷ oan kết nối
mỗi lượt `fn` tạo bảng tạm. Nay so `false`; vế đối chứng thêm bảng tạm ON COMMIT DROP; đột biến W10.

**Đo thêm sau lượt soi 47:** ⑽ PostgreSQL nhận trong thân plpgsql, và dạng nào cũng GHI vào phiên: `set_config/**/(…)`,
`set_config` + chú thích dòng + `(…)`, `SET/* a /* b */ c */search_path = …`, `RESET/**/search_path`,
`UPDATE/**/pg_catalog.pg_settings /* ; */ SET …`, tên `$x$search_path$x$`, `U&'search_path'`, `U&"search_path"`. ⑾ Khuôn bản hai
đúng cả 55 mẫu thử (34 mẫu cũ trừ một mẫu đổi có chủ đích, cộng 21 dạng lách và mẫu âm mới); thân ~100 KB với 20 000 dòng chú
thích quét ba khuôn trong 48 ms. ⑿ Test bản hai chạy trên bản đầu: test `[khoản nợ 96]` bản hai chạy với hardening của bản đầu ĐỎ ở vế `cm_khoi` ("thiếu dòng hàm zz96.cm_khoi(): ghi GUC vận hành session_replication_role bằng set_config"); vế nhiễm `row_security` từ trước chạy với `with-tenant.ts` của bản đầu ĐỎ (`expected 'off' to be 'on'` — kết nối nhiễm quay lại pool).

**Đỏ đo được, cô lập (bản hai — bốn mươi ba đột biến):** hardening — H1 nhánh ⒡ mù và H2 bỏ bề mặt `prosrc` ⇒ vế thân hàm · H3
bỏ BEGIN ATOMIC · H4 bỏ policy USING · H5 bỏ WITH CHECK · H6 bỏ DEFAULT · H7 bỏ CHECK ⇒ vế CHECK của bảng · H8 chỉ còn CHECK của
bảng ⇒ vế domain · H9 bỏ rule/view · H10 bỏ trigger WHEN · H11 bỏ khuôn set_config · H12 bỏ khuôn SET · H13 bỏ khuôn RESET · H14
bỏ `all` ở khuôn và H14b bỏ `OR w.ten = 'all'` ở nhánh ⒡ ⇒ vế RESET ALL · H15 bỏ khuôn UPDATE pg_settings · H16 bỏ cờ `i` và H18
bỏ `E` ⇒ vế `Set_Config(E'Row_Security'…)` · H17 bỏ nháy quanh tên ở SET ⇒ vế `SET "SEARCH_PATH"` · H17b bỏ nháy sau `set_config`
⇒ vế `pg_catalog."set_config"(` · H19 bỏ vế extension và H19b chỉ xét lớp `pg_proc` ⇒ vế đối chứng hàm/view extension · H20 bỏ
lọc lược đồ dự án ⇒ vế hàm `pg_temp` · H21 bỏ miễn khai ở nhánh ⒡ ⇒ vế khai miễn · H22 bỏ vế ⒡ ở nhánh dòng khai thiu ⇒ vế "không
thiu" · H23 khoảng cách không nhận chú thích ⇒ vế `cm_khoi` · H24 không nhận chú thích dòng ⇒ vế `cm_dong` · H25 chú thích không
lồng ⇒ vế `cm_long` · H26 bỏ tên dollar-quote ⇒ vế `ten_dollar` · H27 bỏ `U&'…'` và H27b bỏ `U&"…"` ⇒ vế `ten_uamp` · H28 khuôn
UPDATE dừng ở `;` như bản đầu ⇒ vế `cm_upd`. `withTenant` — W1 bỏ khối DO ⇒ vế ⑴ (không lỗi, hàng được commit) · W2 không đổi
TP096 ⇒ vế ⑴ (lỗi thô) · W3 finally bỏ `session_replication_role` ⇒ vế khuôn I1 · W4 bỏ so search path ⇒ vế search path · W5 bỏ
`row_security` ⇒ vế row_security · W6 nuốt lỗi phép đọc ⇒ vế pg_temp (kết nối nhiễm quay lại pool, câu kế trên pool ném) · W7
không đổi 25P02 ⇒ test cũ "báo lỗi khi transaction đã hỏng" · W8 DO chỉ nhận origin và W8b finally chỉ nhận origin ⇒ vế đối chứng
`local` · W9 không đọc mốc search path ⇒ vế giữ kết nối (mốc thiếu tính là lệch — lượt soi 47 INFO-2) · W10 mốc dùng
`current_schemas(true)` ⇒ vế đối chứng bảng tạm.

**Evidence bắt, không phải lượt soi:** lần đo evidence đầu trên cây của vòng này — `[evidence] vitest thoát mã 1` dù cổng báo
56/56 — đỏ hai test `[T10-L]` của `packages/outbox/src/outbox.int.test.ts`: handler của tổ chức P đặt `SET statement_timeout = 1`
ở phạm vi phiên, và câu kết thúc `DO …; COMMIT` mới bị huỷ (57014) ngay trong giao dịch của P. Đo (máy rảnh, `app_api`, 400
lượt): COMMIT trần trung vị 0,298 ms, p95 0,708 ms, tối đa 1,880 ms; `DO …; COMMIT` 0,390 / 0,862 / 1,266 ms; dạng không-plpgsql
`int4div(1, (… <> 'replica')::int4); COMMIT` 0,357 / 0,659 / 1,751 ms; dưới `statement_timeout = 1` cả ba 0/200 lượt bị huỷ. Tức
hạn 1 ms vốn thấp hơn độ trễ tối đa của chính COMMIT trần — hai test phụ thuộc thời gian từ trước, và câu DO đẩy xác suất lên khi
evidence chạy mọi tệp song song. Sửa: hạn trong hai test thành 100 ms — `pg_sleep(0.2)` của Q vẫn dài hơn hạn, nên phép đo "trạng
thái phiên của P làm hỏng việc của Q" giữ nguyên nghĩa; giữ `DO` vì `int4div` không nhanh hơn thấy rõ mà mất SQLSTATE riêng. Kỳ
vọng đổi có chủ đích, ghi ở chỗ. Cùng lần đo: cột mô tả F1 của `evidence/INV-matrix.md` do bộ sinh chép từ TEST-PLAN — bản viết
tay ngắn hơn của vòng này sai khuôn và được thay bằng bản sinh.

**Ranh giới NÓI RA:** ⑴ Tên dựng lúc chạy (đo ⑷) và cách viết khác của cùng tên — thoát ký tự trong `E'…'`/`U&'…'`, ghép chuỗi,
bí danh LANGUAGE internal (đo ⑹, cần superuser) — không quét được bằng văn bản; lớp đỡ là `withTenant`, và nó chỉ đỡ giao dịch của
chính nó: mã dùng pool ngoài `withTenant` không có lớp nào cho các cách viết ấy — **khoản 99**. ⑵ Một hàm đặt replica, ghi, rồi tự
đặt lại origin trước khi trả về thì phép kiểm ⑴ không thấy — đó là mã của chủ hàm, lớp chặn là hardening. ⑶ Search path hiệu lực
đọc qua `current_schemas(false)` vì [INV-H21] cấm nêu tên GUC ấy trong SQL ngoài migrate.ts, và so TƯƠNG ĐỐI vì giá trị hợp lệ
không bất biến: schema chưa tồn tại hay không USAGE không đổi search path hiệu lực nên không bị bắt (và cũng chưa che được tên),
và search path đã nhiễm TỪ TRƯỚC giao dịch không bị bắt. ⑷ `statement_timeout` và `SET ROLE` vẫn đi theo kết nối —
`destroyConnectionWhenDone` vẫn là hàng rào của chúng. ⑸ Chuỗi hay chú thích trùng khuôn, `SET … TO DEFAULT` và `RESET` bị nêu dù
không ghi giá trị lạ, và một thân vừa UPDATE pg_settings vừa mang tên nguyên văn ở câu khác cũng bị nêu — chiều kêu nhầm, cửa ra là
viết lại; khai tên vào `GUC_VAN_HANH_KHAI` tắt MỌI phát hiện ghi của tên ấy nên là cửa cuối.

### Lượt soi đối kháng 47 (trên bản đầu của S1.54): 1 CAO, 1 NẶNG, 3 NHẸ, 2 INFO — xử lý trong bản hai, một phát hiện thành khoản 99

| # | Mức | Phát hiện | Kiểm | Xử lý |
|---|---|---|---|---|
| CAO-1 | CAO | Ba khuôn chỉ nhận KHOẢNG TRẮNG giữa các token, trong khi `prosrc` là văn bản thô: chèn chú thích (`set_config/**/(`, `SET/**/search_path`, `RESET/**/`, `UPDATE/**/pg_settings`) làm khuôn trượt mà tên vẫn nguyên văn ⇒ deploy xanh, và đường ngoài `withTenant` không lớp nào đỡ | **đúng — đo ⑽ ⑿** (người soi chỉ đọc mã): PostgreSQL nhận mọi dạng và dạng nào cũng ghi vào phiên; test bản hai chạy trên bản đầu đỏ | khoảng cách giữa token = khoảng trắng hoặc chú thích, kể cả lồng, không lột gì; khuôn UPDATE quét tới hết thân; năm vế test; đột biến H23, H24, H25, H28; đường ngoài `withTenant` thành **khoản 99** |
| NẶNG-1 | NẶNG | Tên viết dollar-quote (`set_config($$search_path$$, …)`) thoát khuôn set_config ở `prosrc`; deparse thì chuẩn hoá nên chỉ `prosrc` thủng | **đúng — đo ⑽**, và thêm hai dạng người soi không nêu: `U&'search_path'`, `U&"search_path"` | nhận tên `'…'`/`E'…'`/`U&'…'`/dollar-quote ở set_config và UPDATE, `U&"…"` ở SET/RESET; vế test `ten_dollar`, `ten_uamp`; đột biến H26, H27, H27b |
| NHẸ-1 | NHẸ | `row_security` so TƯƠNG ĐỐI với lúc mở giao dịch ⇒ kết nối đã nhiễm `off` từ trước quay lại pool | **đúng — đo ⑿**: vế mới chạy trên bản đầu đỏ | `row_security` xét theo tính chất (`on`) như replica; vế test nhiễm-từ-trước; search path giữ tương đối — ranh giới ⑶ |
| NHẸ-2 | NHẸ | Chuỗi hay chú thích trùng khuôn bị nêu oan; cửa "khai tên" tắt mọi phát hiện ghi của tên ấy | đúng — đọc | ranh giới ⑸; chú thích hằng nói cửa ra ưu tiên là viết lại, khai tên là cửa cuối |
| NHẸ-3 | NHẸ | `[^;]*` của khuôn UPDATE bắt tên CUỐI trong câu ⇒ nhãn sai (vẫn đỏ) | đúng — đọc; bản hai quét tới hết thân nên nhãn vẫn có thể lệch | nói ra trong chú thích hằng; không đổi tính đúng của cổng |
| INFO-1 | INFO | Nhánh `tuChoiMacDinh` bỏ qua ba phép kiểm vận hành ⇒ kết nối nhiễm replica cùng mặc định `app.*` thật được giữ | đúng — đọc; không có ghi sai: mọi giao dịch kế trên kết nối ấy vẫn qua phép kiểm ⑴ trước COMMIT, và hardening cấm mặc định `app.*` ở catalog | không đổi |
| INFO-2 | INFO | Mốc search path `undefined` thì phép so bị bỏ (fail-open hẹp) | đúng — đọc | mốc thiếu tính là lệch ⇒ huỷ kết nối; đột biến W9 đỏ ở vế giữ kết nối |

**Điều đáng mang sang vòng sau:** ⑴ `prosrc` là bề mặt THÔ duy nhất trong các bề mặt quét: mọi khuôn văn bản trên thân hàm cần
cùng một định nghĩa "khoảng cách giữa token", và khuôn ĐỌC `CAU_TEN_GUC_DU_AN_DOC` của khoản 87 hôm nay vẫn chỉ nhận khoảng trắng
(đọc, chưa đo tác động); ⑵ một phép so "như lúc mở" chỉ đúng cho trục KHÔNG có giá trị an toàn bất biến — trục có giá trị bất biến
thì so theo tính chất, không thì nhiễm-từ-trước lọt; ⑶ một lớp ứng dụng được gọi là "lớp chịu lực còn lại" phải kèm danh sách
đường KHÔNG đi qua nó; ⑷ một ranh giới liệt kê bằng ví dụ ("thoát ký tự, U&, ghép chuỗi") mời người soi tìm dạng ngoài danh sách
— liệt kê bằng tính chất (tên còn nguyên văn hay không) thì mới kiểm được.

# §S1.55 — khoản nợ 98: 83⑴ có đường khai cho policy ngoài `public` — hai danh sách khai mang cột lược đồ, vai so theo OID, và dữ liệu tenant mà [CR1] không soi thì không khai được

**Bề mặt an ninh:** `db/migrations/hardening.always.sql` — `POLICY_RESTRICTIVE_KHAI` (tám hàng) và `POLICY_KHAC_KHAI` (một hàng)
thêm cột `nspname` đứng đầu; `BIEU_THUC_VAI_TRO` nhận PUBLIC theo OID 0 và vai thật qua `quote_ident`; hằng mới
`VI_TU_PERMISSIVE_CR1_SE_SOI`; mục phán xét `CAU_POLICY_LOP_SAI` (83⑴): vị từ (b2), (c) và hai nhánh dòng khai thiu khớp theo
lược đồ thay vì ghim `public`, (c) không nhận dòng khai thuộc hằng mới, thông điệp nêu `khai <lược đồ>.<bảng>.<policy>` và có nhánh
riêng cho hằng mới; chú thích của `CAU_PHU_LENH_CHU_BANG_SAI` gạch câu "ngõ cụt khoản 98". Test: `db/rls-coverage.int.test.ts` —
`CAU_VAI_TRO` theo khuôn mới; cổng HAI BẢN KHỚP dùng một bộ sinh (`khoiRestrictiveTu`, `khoiKhacTu`) soi gương vị từ (b1), sinh
được NULL, sắp theo bộ ba, và đòi biểu thức vai hai bản khớp; describe `[S1.55 / khoản nợ 98]` (bốn `it`).
`tests/adversarial/a5-co-lap-nha-cung-cap.int.test.ts` — census `<bảng>_khach` phủ mọi lược đồ dự án (hằng
`CAU_BANG_RLS_THIEU_KHACH`) và một `it` có fixture. Chú thích ở `db/migrations.int.test.ts`.

**Đo trước khi viết (PostgreSQL 16, tệp thăm dò trong worktree, đã xoá):** bảng `zz98.t` ngoài `public`, bật RLS, ba policy — `p`
PERMISSIVE `USING (true) WITH CHECK (true)`, `r` RESTRICTIVE cùng biểu thức, `t_khach` RESTRICTIVE đúng khuôn 027 (FOR ALL,
PUBLIC, hai vế "không phải phiên khách").
⑴ Chưa khai: `CAU_POLICY_LOP_SAI` nêu cả ba "không thuộc lớp nào (khoản 83⑴)" — kể cả `t_khach`, vì (b1) chỉ nhận khuôn 027 ở
`public`; `CAU_RLS_NGOAI_TENANT_SAI` nêu `zz98.t` (83⑶); `migrate()` từ chối với hai mục.
⑵ Khai `zz98.t` vào `BANG_RLS_NGOAI_TENANT_KHAI` — khoá (nspname, relname) — và khai ba policy vào hai danh sách của 83⑴ theo khuôn
CŨ: 83⑶ im, 83⑴ VẪN nêu cả ba. Ngõ cụt rộng hơn vế đọc của S1.53: không chỉ `POLICY_KHAC_KHAI` mà cả (b2) `POLICY_RESTRICTIVE_KHAI`
ghim `public`, và RESTRICTIVE khuôn 027 ngoài `public` cũng không có đường nào.
⑶ Chín dòng khai hiện có đều ở `public`; khoá của `POLICY_RESTRICTIVE_DA_KHAI` ở test vốn đã mang lược đồ — thêm cột không đổi
phán xét trên lược đồ thật.

**Hình dạng (bản hai):** ⒜ Cột `nspname` đứng đầu ở cả hai danh sách — `POLICY_RESTRICTIVE_KHAI` bảy cột, `POLICY_KHAC_KHAI` tám
cột. ⒝ Vị từ (b2), (c) khớp theo (lược đồ, bảng, policy). ⒞ Hai nhánh dòng khai thiu: bảng khai tồn tại xét ở đúng lược đồ khai,
policy tìm ở đúng lược đồ ấy; thông điệp nêu lược đồ. ⒟ (b1) giữ `public`: khuôn 027 được nhận theo tính chất ở nơi 027 dựng nó
(đọc); ngoài `public` nó đi đường khai (b2). ⒠ Gỡ ghim mà KHÔNG thêm cột thì dòng khai của lược đồ này che policy cùng tên của lược
đồ khác (đo: K1, K2 của lượt đột biến đầu). ⒡ [CAO-1] Cột vai: `CASE WHEN o.oid = 0 THEN 'PUBLIC' ELSE quote_ident(rolname) END` —
cùng khuôn `CAU_QUYEN_BANG_SO_SAI`; dòng khai hiện có không đổi. ⒢ [NẶNG-3] `VI_TU_PERMISSIVE_CR1_SE_SOI` = PERMISSIVE trên bảng
thuộc `VI_TU_CAN_CO_RLS` hay có cột org_id — đúng tập bảng mà [CR1] SẼ soi nếu nó ở `public`. (c) không nhận dòng khai của nó; 83⑴
nêu với thông điệp riêng chỉ lối ra (policy trên bảng cha — khuôn dự án, lá không policy — hay chuyển bảng về `public`).
Fail-closed như trước S1.55. Bảng chỉ có khoá ngoại tới bảng tenant không thuộc vế này: [CR1] không soi nó cả ở `public`, nên khai
kép 83⑶ + (c) là cùng chuẩn. ⒣ [NẶNG-1, NẶNG-2, NHẸ-3, INFO-2] Một bộ sinh cho hai khối khai: bộ lọc soi gương đúng vị từ (b1),
`null` sinh `NULL`, thứ tự theo bộ (lược đồ, bảng, policy), khoá phải đúng ba phần. ⒤ [INFO-5] Census `<bảng>_khach` của A5 phủ mọi
lược đồ dự án — 027 là migration đã chạy, không sửa.

**Test (bản hai):** describe `[S1.55 / khoản nợ 98]` dựng fixture trong giao dịch và chạy câu phán xét của hardening qua bộ giải
hằng, trên bản thật và trên bản có dòng khai sinh bằng bộ sinh của cổng: ⑴ đường khai — chưa khai nêu cả ba; khai kèm lược đồ thì
im; bẫy cùng tên `zz98b` sống tới hết; `zz98c.caller_rate_limits` cùng tên, cùng policy với bảng đã khai ở `public` bị nêu; gỡ `p`
và `r` thì dòng khai thiu nêu đúng lược đồ; xoá lược đồ khai thì im; ⑵ vai "PUBLIC" — `ALTER POLICY … TO "PUBLIC"` trên bảng thử và
trên `vendor_bids_khach` thật ⇒ nêu cả policy lẫn dòng khai thiu; ⑶ policy một vế — FOR SELECT và RESTRICTIVE FOR DELETE khai NULL
thì im, khai chuỗi thì nêu; ⑷ dữ liệu tenant mà [CR1] không soi — lá phân vùng ngoài `public`, con INHERITS của `organizations`, bảng
có org_id ngoài `public`, cùng khai ở (c), vẫn bị nêu với thông điệp riêng; RESTRICTIVE trên lá khai được; bỏ org_id thì dòng khai
có hiệu lực. Cổng HAI BẢN KHỚP thêm: biểu thức vai hai bản khớp, bộ sinh không phụ thuộc thứ tự đầu vào, khoá bốn phần bị từ chối.
A5: bảng RLS ngoài `public` không có `<bảng>_khach` bị census thấy, có thì thôi.

**Đo thêm sau lượt soi 48 (tệp thăm dò thứ hai, đã xoá):** M1 — PostgreSQL 16 nhận `CREATE ROLE "PUBLIC"`, từ chối `CREATE ROLE
public` ("role name "public" is reserved"); `AS RESTRICTIVE TO "PUBLIC" USING (false)` ⇒ `polroles = {17541}`, biểu thức cũ ra
`PUBLIC`, biểu thức mới ra `"PUBLIC"`, app_api đếm 3 hàng — TO PUBLIC thật thì 0; `ALTER POLICY vendor_bids_khach … TO "PUBLIC"` ⇒
83⑴ thật im, bản `quote_ident` nêu cả policy lẫn dòng khai thiu. M2 — lá `luu98.zz98pm_1` (PARTITION OF public.zz98pm) với
`USING (true)`: 83⑴ bản đầu nêu khi chưa khai, IM khi có một dòng (c); bản HEAD nêu; [CR1], 83⑵, 83⑶, 94, 85, 86, 82⑴ đều im với
bản có dòng khai; app_api gắn tổ chức A đọc thẳng lá ra 2 hàng, qua cha ra 1. M2b — bảng có org_id ngoài `public`, bật RLS, khai kép
83⑶ + (c) ⇒ 83⑴ và 83⑶ im, app_api đọc 2 hàng. M3 — FOR SELECT: `polwithcheck` NULL; dòng khai NULL ⇒ im; `''` hay `'(không có)'`
⇒ nêu. M4 — `zz98g.t` với `USING (true)`: census chỉ-public không thấy, bản phủ lược đồ dự án thấy; phiên khách đọc 2 hàng. M5 —
bảng RLS ngoài `VI_TU_BANG_TENANT` duy nhất của lược đồ thật là `public.caller_rate_limits` (không org_id, không khoá ngoại tới
tenant, không con cháu). M6 — biểu thức vai mới trên lược đồ thật cho đúng hai chuỗi cũ; 83⑴ và [CR1] rỗng. M7 — không policy
PERMISSIVE thật nào thuộc vế chặn mới. Và K11–K14 (bỏ hẳn vế lược đồ ở hai nhánh dòng khai thiu) SỐNG trên test bản đầu.

**Tự bắt, không phải lượt soi:** khi thiết kế đột biến "bỏ nhánh con cháu" của vế chặn, lá phân vùng thừa hưởng cột org_id nên một
mình nó không làm nhánh ấy chịu lực — vế test NẶNG-3 thêm con INHERITS của `organizations` (không org_id), khai ở (c).

**Evidence bắt, không phải lượt soi:** lần đo evidence đầu trên cây của vòng này — `[evidence] vitest thoát mã 1`, cổng báo
`F1` đỏ — hỏng hai test của `db/rls-coverage.int.test.ts`. Test [S1.32] "RESTRICTIVE USING (false) làm app_api ghi ra 0 hàng"
quá hạn mặc định 30 s (30019 ms; chạy riêng 9339 ms). Test [S1.38] "câu phán xét chạy trong test: hôm nay rỗng cả ba" thấy 83⑴
trả một hàng — đọc: vitest không huỷ thân test quá hạn, nên `zz_chan` của test trước còn nằm đó khi test sau đọc; test ấy xanh
khi chạy riêng. Đo trước khi sửa (cụm riêng, `migrate()` luân phiên năm lượt): hardening HEAD, bản đầu và bản hai cùng ~1,2 s mỗi
lượt, cả đường hợp lệ lẫn đường NÉM có `zz_chan` — không phải hồi quy của vòng này. Riêng câu `CAU_POLICY_LOP_SAI` đo từ client
tăng từ ~9 ms lên ~63 ms (thực thi 2,7 → 6,3 ms, lập kế hoạch 4,1 → 9,5 ms: vế chặn khai triển `VI_TU_CAN_CO_RLS` hai lần) —
không đáng kể so với một lượt `migrate()`. Sửa: test [S1.32] — test duy nhất của tệp gọi `migrate()` thật mà còn dùng hạn mặc
định (đếm theo lời gọi, không theo chữ `migrate()` trong chú thích) — nhận hạn 180 s, đúng khuôn S1.40 đã ghi cho nguyên nhân này.

**Đỏ đo được, cô lập (bản đầu — mười đột biến):** K1 bỏ vế lược đồ ở (c) và K2 ở (b2) ⇒ vế bẫy cùng tên · K3 ghim lại `public` ở
(c) và K4 ở (b2) ⇒ vế khai kèm lược đồ · K5 xét bảng khai tồn tại ở `public`, nhánh dòng khai thiu của (c), và K7 của (b2) ⇒ vế dòng
khai thiu · K6 tìm policy ở `public`, nhánh dòng khai thiu của (c), và K8 của (b2) ⇒ vế khai kèm lược đồ · K9 lược đồ của dòng khai
`caller_rate_limits_khach` ở HARDENING thành `zz_sai` ⇒ đỏ ở TẦNG SẢN XUẤT: `migrate()` của globalSetup từ chối ("Hardening không
sửa được 1 mục"), 43 test bị bỏ qua · K10 cùng thay đổi ở BẢN TEST, hardening giữ nguyên ⇒ cổng HAI BẢN KHỚP.

**Đỏ đo được, cô lập (bản hai — hai mươi lăm đột biến, gồm mười của bản đầu chạy lại trên mã bản hai):** K1 bỏ vế lược đồ ở (c)
và K2 ở (b2) ⇒ vế bẫy cùng tên · K3 ghim lại `public` ở (c) và K4 ở (b2) ⇒ vế khai kèm lược đồ (và vế đối chứng của CAO-1) · K5,
K7 xét bảng khai tồn tại ở `public`, K6, K8 tìm policy ở `public`, ở hai nhánh dòng khai thiu ⇒ vế dòng khai thiu hay vế khai kèm
lược đồ · K9 lược đồ dòng khai ở hardening lệch ⇒ `migrate()` của globalSetup từ chối · K10 lược đồ ở bản test lệch ⇒ HAI BẢN
KHỚP · K11–K14 BỎ HẲN vế lược đồ ở hai nhánh dòng khai thiu — SỐNG trên test bản đầu (NHẸ-1) — nay đỏ ở vế (d) hay (e) nhờ `zz98b`
sống tới hết · K15 biểu thức vai `coalesce` ở CẢ hardening lẫn bản test (cổng biểu thức vai xanh) ⇒ vế vai "PUBLIC" · K16 chỉ bản
test lệch ⇒ cổng biểu thức vai · K17 bỏ vế chặn ở (c) ⇒ vế NẶNG-3 im · K18 thông điệp riêng thành chung ⇒ vế thông điệp · K19 vế
chặn bỏ nhánh org_id ⇒ `luu98b.t` im · K20 vế chặn bỏ nhánh con cháu ⇒ `luu98.org_con` im · K21 bộ lọc của cổng như bản cũ ⇒ vế
khai kèm lược đồ (`zz98.t.t_khach` rơi khỏi khối sinh) · K22 `lit(null)` sinh `''` ⇒ vế policy một vế · K23 so bộ bỏ tên policy ⇒
vế thứ tự · K24 khoá bốn phần không ném ⇒ vế khoá · K25 census khách ghim lại `public` ⇒ vế A5 ngoài public.

**Ranh giới NÓI RA:** ⑴ (b1) chỉ nhận khuôn 027 theo tính chất ở `public`; ngoài `public` khuôn ấy phải khai — chiều kêu nhầm, có
cửa ra. ⑵ Khoá của lời khai là TÊN lược đồ: `ALTER SCHEMA … RENAME` làm policy mất khai ⇒ 83⑴ nêu, còn dòng khai cũ im vì bảng khai
không tồn tại; dựng lại lược đồ đúng tên thì chiếm luôn dòng khai — cùng hạng với đổi tên bảng ở `public`. ⑶ Test chạy câu phán xét
qua bộ giải hằng trong giao dịch; `migrate()` với bảng khai ngoài `public` không lặp lại ở vòng này — tầng sản xuất đọc cùng hằng
(K9 đo tầng ấy). Nhánh dòng khai thiu không lọc `MAU_SCHEMA_DU_AN`: dòng khai trỏ `pg_temp_N` lúc nêu lúc không. ⑷ PERMISSIVE trên
dữ liệu tenant mà [CR1] không soi không có lối khai nào — có chủ đích, như trước S1.55. Bảng chỉ có khoá ngoại tới bảng tenant mà
bật RLS thì khai kép 83⑶ + (c) mở đọc xuyên tổ chức, ở `public` lẫn ngoài `public`: cùng một chuẩn có từ S1.38, chưa lượt soi nào
nhìn riêng. ⑸ Khoá in ra nối bằng dấu chấm, không `%I`: tên chứa dấu chấm hay chữ hoa in thô; cổng từ chối khoá không đúng ba
phần. ⑹ 83⑴ không loại bảng thuộc extension (91 và 94 có loại): extension mang policy thì phải khai. ⑺ Bản hai chưa qua một lượt soi
đối kháng riêng; mọi thay đổi của nó có vế test và đột biến đỏ.

### Lượt soi đối kháng 48 (trên bản đầu của S1.55): 1 CAO, 3 NẶNG, 4 NHẸ, 5 INFO — xử lý trong bản hai, không mở khoản mới

| # | Mức | Phát hiện | Kiểm | Xử lý |
|---|---|---|---|---|
| CAO-1 | CAO | Cột vai của (b2), (c), hai nhánh dòng khai thiu và `NGOAI_LE_HINH_DANG` của [CR1] so bằng chuỗi `coalesce(rolname, 'PUBLIC')`: một vai THẬT tên "PUBLIC" cho ra cùng chuỗi với PUBLIC (OID 0). Chủ bảng có CREATEROLE chuyển một policy RESTRICTIVE đã khai sang vai ấy thì policy thôi áp cho app_api mà 83⑴ im; lỗ có từ S1.38, bản đầu S1.55 áp cùng phép so cho dòng khai ngoài public | **đúng — đo M1** (người soi chỉ đọc mã): PostgreSQL 16 nhận `CREATE ROLE "PUBLIC"`, chỉ `public` chữ thường là tên dành riêng; `AS RESTRICTIVE TO "PUBLIC" USING (false)` ⇒ app_api đếm 3 hàng, TO PUBLIC thật ⇒ 0; `ALTER POLICY vendor_bids_khach … TO "PUBLIC"` ⇒ `polroles = {17541}`, 83⑴ thật im, bản quote_ident nêu cả policy lẫn dòng khai thiu. Đo M6: trên lược đồ thật bản mới cho đúng hai chuỗi cũ (`PUBLIC`, `app_api`), 83⑴ và [CR1] rỗng | `BIEU_THUC_VAI_TRO` và `CAU_VAI_TRO`: `CASE WHEN o.oid = 0 THEN 'PUBLIC' ELSE quote_ident(rolname) END` — khuôn đã có ở `CAU_QUYEN_BANG_SO_SAI` và nhánh ⒟; cổng mới đòi hai bản khớp; vế test vai "PUBLIC" ở bảng thử và ở `vendor_bids_khach` thật; đột biến K15, K16 |
| NẶNG-1 | NẶNG | Lối ra "khuôn 027 ngoài public đi đường khai (b2)" không đi được: bộ lọc của cổng HAI BẢN KHỚP gạt mọi mục có hai vế KHACH_NULL bất kể lược đồ, tên, lệnh, vai, trong khi (b1) ghim public; vế (b) của test vá tay một bản sao hardening nên không qua cổng; `toBe(8)` đỏ ngay ở biến thể thứ chín | đúng — đọc (mã tất định); đột biến K21 (bộ lọc cũ) đỏ ở vế khai kèm lược đồ | `laKhuonB1` soi gương đúng vị từ (b1); bỏ số tám cứng — phép bằng với hằng ở hardening đã chống rỗng ruột; một bộ sinh (`khoiRestrictiveTu`, `khoiKhacTu`) cho cả cổng lẫn test khoản 98, test sinh dòng khai qua nó và đòi khối khai của hardening bằng bộ sinh đúng một lần |
| NẶNG-2 | NẶNG | Hardening so hai vế biểu thức bằng IS NOT DISTINCT FROM, nhưng cổng chỉ sinh chuỗi có nháy ⇒ policy một vế (FOR SELECT, FOR DELETE, FOR INSERT) không khai được qua cổng — mà ngoài public mọi policy đều phải khai | **đúng — đo M3**: FOR SELECT có `polwithcheck` NULL; dòng khai NULL ⇒ 83⑴ im; `''` hay `'(không có)'` ⇒ nêu cả policy lẫn dòng khai thiu | kiểu cho phép null ở hai vế, `lit(null)` sinh `NULL`; vế test FOR SELECT (danh sách khác) và RESTRICTIVE FOR DELETE (danh sách RESTRICTIVE) khai NULL thì im, khai chuỗi thì nêu; đột biến K22 |
| NẶNG-3 | NẶNG | Gỡ ghim public cho (c) mở một lối lách [CR1]: PERMISSIVE trên bảng mang dữ liệu tenant ngoài public khai được bằng một dòng (c), không qua `HINH_DANG_CHUAN`; trước S1.55, 83⑴ chặn cấu hình ấy | **đúng — đo M2, M2b; hồi quy do chính bản đầu**: lá `luu98.zz98pm_1` (PARTITION OF public.zz98pm) `USING (true)` cùng một dòng (c) ⇒ 83⑴ im, bảy mục kề im ([CR1], 83⑵, 83⑶, 94, 85, 86, 82⑴), app_api gắn tổ chức A đọc thẳng lá ra 2 hàng của hai tổ chức (qua cha: 1); bản HEAD nêu và không có lối khai; bảng có org_id ngoài public bật RLS, khai kép 83⑶ + (c) ⇒ cũng 2. M7: không policy thật nào thuộc vế chặn; M5: bảng RLS ngoài tập tenant duy nhất là `public.caller_rate_limits` — không org_id, không khoá ngoại tới tenant | hằng `VI_TU_PERMISSIVE_CR1_SE_SOI` — PERMISSIVE trên bảng thuộc `VI_TU_CAN_CO_RLS` hay có cột org_id: (c) không nhận dòng khai của nó, 83⑴ nêu với thông điệp riêng chỉ lối ra (policy trên bảng cha, hay chuyển bảng về public); vế test lá phân vùng, con INHERITS của `organizations` không org_id (tự bắt khi thiết kế K20 — lá thừa hưởng org_id nên một mình nó không làm vế con cháu chịu lực), bảng org_id, và đối chứng bỏ org_id; đột biến K17–K20 |
| NHẸ-1 | NHẸ | Bốn vế lược đồ ở hai nhánh dòng khai thiu không có đối chứng: `zz98b` bị xoá trước (d) và (e) | **đúng — đo**: K11–K14 (bỏ hẳn vế) SỐNG trên test bản đầu | `zz98b` sống tới hết; kỳ vọng (d), (e) gồm ba dòng của `zz98b`; K11–K14 chạy lại trên bản hai |
| NHẸ-2 | NHẸ | Câu "gỡ ghim mà không thêm cột thì dòng khai che bảng cùng tên" chưa đo; câu về 027 là đọc mà không ghi | đúng: lượt đột biến đầu K1, K2 (bỏ vế lược đồ) đỏ đúng ở vế bẫy cùng tên — chính là phép đo câu ấy; câu 027 là đọc | ghi "(đo)" và "(đọc)" ở chú thích hardening; vế rẻ `zz98c.caller_rate_limits` cùng tên, cùng policy với bảng đã khai ở public ⇒ 83⑴ nêu |
| NHẸ-3 | NHẸ | Hàm so sánh của cổng không bao giờ trả 0 và khoá thiếu tên policy — thứ tự hai biến thể trên một bảng do engine quyết | đúng — đọc | `soBo` so bộ (lược đồ, bảng, policy), trả 0 khi bằng; vế test đảo thứ tự đầu vào; đột biến K23 |
| NHẸ-4 | NHẸ | Chữ thiu: "sáu cột", "bảy cột" ở chú thích test và migrations.int.test.ts, ADR-036 hàng 5 và 27, STATE hàng 83 và 98 | đúng — đọc | sửa trong vòng; biên bản cũ giữ nguyên văn |
| INFO-1 | INFO | Hai hằng khai chỉ được đọc theo tên cột qua bí danh; không còn khuôn cột cũ | đúng — đọc | không đổi |
| INFO-2 | INFO | Tên chứa dấu chấm làm khoá `lược đồ.bảng.policy` mơ hồ và `split(".")` gán sai cột | đúng — đọc | bộ sinh ném khi khoá không đúng ba phần; vế test; đột biến K24; in khoá bằng `%I` để lại — ranh giới ⑸ |
| INFO-3 | INFO | Nhánh dòng khai thiu không lọc `MAU_SCHEMA_DU_AN`; 83⑴ không loại bảng extension; `ALTER SCHEMA … RENAME` | đúng — đọc | ranh giới ⑶, ⑹; mang sang |
| INFO-4 | INFO | RESTRICTIVE khai được ở hai danh sách ((b2), và (c) với `loai`) mà thông điệp không nói | đúng — đọc | không đổi: hai lối cùng đòi đủ cột nguyên văn, không lối nào mở thêm quyền; mang sang |
| INFO-5 | INFO | Census `<bảng>_khach` của A5 và vòng lấp của 027 đều ghim public; sau khoản 98, bảng RLS ngoài public có policy deploy được mà không lớp nào đòi policy khách | **đúng — đo M4**: `zz98g.t` với `USING (true)` — census chỉ-public không thấy, bản phủ lược đồ dự án thấy; phiên khách (app_api + `app.guest_session_id`) đọc 2 hàng | census của A5 thành hằng `CAU_BANG_RLS_THIEU_KHACH` phủ mọi lược đồ dự án; vế có fixture ngoài public; đột biến K25; 027 là migration đã chạy nên không sửa |

**Điều đáng mang sang vòng sau:** ⑴ Một phép so theo CHUỖI trên danh tính (vai, lược đồ, tên) cần một đại diện không va chạm
— OID hay `quote_ident`: PUBLIC là giá trị giả trong không gian tên vai, và một tên thật trùng chuỗi được. ⑵ Gỡ một chỗ ghim là
nới TẬP CHỦ THỂ của một lối khai: phải hỏi lại mọi lớp mà chỗ ghim ấy từng đỡ gián tiếp — [CR1] chỉ soi public, nên gỡ ghim
public ở 83⑴ lấy mất lớp chặn cuối của dữ liệu tenant ngoài public. Bản đầu tự nói "khai không cứu được" là ngõ cụt mà không
hỏi ngõ cụt ấy đang CHẶN gì. ⑶ Một cổng "hai bản khớp" phải biểu diễn được MỌI thứ vị từ phía kia nhận (NULL, khuôn ngoài
public), và test nào cần dòng khai phải đi qua chính bộ sinh ấy — vá tay một bản sao là thứ hai không ai đối chiếu. ⑷ Bảng chỉ có
khoá ngoại tới bảng tenant (khoản 86) mà bật RLS: khai kép 83⑶ + (c) mở đọc xuyên tổ chức ở public lẫn ngoài public — cùng một
chuẩn, nhưng chưa lượt soi nào nhìn riêng cặp khai ấy.

# §S1.56 — khoản nợ 97: mục 94 soi thêm vai chạy migration — gương `check_enable_rls` cho `current_user` của phiên phán xét

**Bề mặt an ninh:** `db/migrations/hardening.always.sql` — `CAU_PHU_LENH_CHU_BANG_SAI` (mục 94) thêm nhánh `UNION ALL` cho chủ thể
thứ hai là `current_user` của phiên phán xét; mô tả mục và ô "cần quyền" trong bảng hardening đổi theo; chú thích ⑷ gạch, ⑸ mới.
Test: `db/rls-coverage.int.test.ts` describe `[S1.56 / khoản nợ 97]` (ba `it`, câu phán xét dưới `SET LOCAL ROLE`);
`db/migrations.int.test.ts` một `it` hồ sơ N2 (container riêng).

**Đo trước khi viết (PostgreSQL 16, tệp thăm dò trong worktree, đã xoá):**
⑴ Chủ `zz_chu97` không superuser, bảng bật RLS và FORCE có 2 hàng, policy duy nhất `TO zz_chu97`; vai `zz_trien97` không thừa kế
chủ, được GRANT USAGE trên lược đồ và SELECT, UPDATE trên bảng: chủ đọc 2; `zz_trien97` đọc 0 và UPDATE báo 0 hàng, KHÔNG LỖI; NO
FORCE vẫn 0; mục 94 (chủ thể chủ bảng) và 83⑵ (tập vai ứng dụng) im.
⑵ Nguyên mẫu câu chủ thể thứ hai dưới `zz_trien97` nêu SELECT và UPDATE — đúng hai lệnh đã cấp; thêm policy `FOR SELECT TO PUBLIC`
⇒ chỉ còn UPDATE; vai là thành viên của chủ, hay bảng tắt RLS ⇒ im; dưới superuser im.
⑶ Hồ sơ N2 (bootstrap bằng superuser; `trien_khai` CREATEROLE, sở hữu database, GRANT ALL trên `schema_migrations`): fixture ở một
lược đồ riêng, khai ở 83⑴ và 83⑶, `trien_khai` được GRANT SELECT, UPDATE; một migration `999_zz_backfill97.sql` chạy `UPDATE
zz_s97.t SET id = id + 10`. `migrate()` dưới pool `trien_khai` ĐI QUA và ghi migration là đã áp — hàng vẫn 1, 2.
⑷ Lược đồ thật: nguyên mẫu dưới superuser và dưới một vai CREATEROLE không GRANT đều rỗng — rỗng theo cấu tạo; bảo đảm thật là census
ở rls-coverage: mọi bảng RLS thật có policy PERMISSIVE TO PUBLIC ở cả bốn lệnh (lượt soi 49 INFO-1).
⑸ `migrate.ts` không `SET ROLE`: câu phán xét chạy dưới vai của kết nối deploy (pool `trien_khai` ⇒ `current_user = trien_khai`).

**Hình dạng (bản ba):** ⒜ Chủ thể thứ hai là `current_user` của phiên phán xét khi RLS áp cho nó — gương `check_enable_rls`: không
superuser, không BYPASSRLS, không phải chính chủ, và bảng FORCE hay vai không thừa kế chủ (`pg_has_role(vai, relowner, 'USAGE')`,
thừa kế theo INHERIT). ⒝ Có USAGE trên lược đồ; lệnh SELECT, UPDATE, DELETE — INSERT không phủ thì ném nên đứng ngoài. ⒞ Cùng loại
trừ với chủ thể thứ nhất: extension, bảng con của cha bật RLS, lệnh vai ấy không có quyền (`has_table_privilege` cho DELETE,
`has_any_column_privilege` cho SELECT và UPDATE — GRANT mức cột được tính). ⒟ Phủ theo danh sách vai của policy PERMISSIVE ở lệnh ấy
hay `*`: PUBLIC, hay vai mà `pg_has_role(vai, o, 'USAGE')` — nhóm NOINHERIT không phủ; RESTRICTIVE không tính; không xét USING, cùng
chuẩn mục 94. ⒠ Khi chủ cũng thiếu phủ, thành viên thừa kế chủ trên bảng FORCE ra dòng riêng bên cạnh dòng của chủ. ⒡ Thông điệp:
RLS áp cho vai này mà không policy nào phủ; các migration đánh số của chính lượt đã chạy dưới cấu hình ấy và đã ghi checksum — kiểm và
chạy lại backfill bằng migration mới; lối ra ít quyền nhất trước, nói ai chạy: người cấp, chủ bảng hay SUPERUSER REVOKE; chạy
migration dưới chủ bảng; policy do chủ thêm là quyền đọc/ghi thường trực của vai deploy.

**Test (bản ba):** rls-coverage — ⑴ đo: chủ đọc 2, vai đọc 0, UPDATE 0 không lỗi; mục dưới vai ấy nêu đúng hai lệnh, dưới superuser
im; NO FORCE vẫn 0 và vẫn nêu. ⑵ vế lọc: FOR SELECT TO PUBLIC ⇒ chỉ UPDATE; policy cho nhóm ⇒ chỉ SELECT; RESTRICTIVE TO PUBLIC không
phủ; thành viên của chủ trên bảng FORCE khi `p_chu TO chủ` còn phủ nó ⇒ im; BYPASSRLS ⇒ im; SUPERUSER NOBYPASSRLS mà `p_chu` phủ ⇒ im;
bảng NO FORCE không policy nào phủ — thành viên INHERIT đọc 2 và mục im, thành viên NOINHERIT đọc 0 và mục nêu; bảng tắt RLS ⇒ im;
bảng thuộc extension ⇒ im; REVOKE UPDATE ⇒ chỉ SELECT; lá phân vùng của cha bật RLS ⇒ im, DETACH ⇒ nêu. ⑶ lượt soi 49: ⒜ thành viên
INHERIT của chủ BYPASSRLS trên bảng FORCE đọc 0, UPDATE 0 ⇒ nêu ba lệnh; ⒞ cùng thành viên trên bảng NO FORCE đọc 2 ⇒ im; ⒝ thành viên
INHERIT của chủ đã tự REVOKE ALL, có GRANT trực tiếp ⇒ đọc 0, UPDATE 0, nêu hai lệnh; ⒟ SUPERUSER NOBYPASSRLS trên bảng FORCE chỉ có
policy FOR SELECT ghi đủ 2 hàng ⇒ im; ⒠ chính chủ không ở chủ thể thứ hai, chủ thể thứ nhất nêu nó ở bốn lệnh; ⒡ nhóm NOINHERIT với
policy FOR UPDATE không áp ⇒ UPDATE 0 và vẫn nêu; ⒢ GRANT UPDATE (id) ⇒ nêu; ⒣ INSERT không phủ ném 42501 và không bị nêu; ⒤ thiếu
USAGE lược đồ ném 42501 và im; ⒥ ranh giới có ghim — vai có GRANT trên `suppliers` mà không EXECUTE trên `app_current_org_id()` ném
42501, policy tenant TO PUBLIC tính là phủ. migrations — hồ sơ N2: `ALTER POLICY suppliers_tenant_isolation … TO app_api` cộng `GRANT
SELECT, UPDATE ON suppliers TO trien_khai` ⇒ `migrate()` dưới `trien_khai` NÉM nêu `public.suppliers/trien_khai (vai chạy
migration)/SELECT` và `/UPDATE`, không DELETE, và nói các migration của chính lượt đã ghi checksum; REVOKE ⇒ đi qua. Trọn hai tệp: 157/157.

**Đo thêm sau lượt đột biến đầu (tệp thăm dò thứ hai, đã xoá):** vai `SUPERUSER NOBYPASSRLS` — `pg_has_role` với chủ và với nhóm đều
true, đếm 2 hàng cả NO FORCE lẫn FORCE. Thành viên INHERIT của chủ trên bảng NO FORCE mà không policy nào phủ chủ hay nó —
`pg_has_role … USAGE` true, đọc 2; cùng thành viên khi bảng FORCE — đọc 0. Thành viên NOINHERIT — USAGE false, MEMBER true, đọc 0;
nó `SET ROLE` sang chủ thì đọc 2.

**Đo thêm sau lượt soi 49 (tệp thăm dò thứ ba, đã xoá):** ⒜ chủ BYPASSRLS có thành viên INHERIT, bảng FORCE, policy chỉ TO app_api ⇒
thành viên đọc 0, UPDATE 0 không lỗi; mục bản hai im; gương nêu DELETE, SELECT, UPDATE. ⒝ chủ thường tự REVOKE ALL, thành viên INHERIT
có GRANT SELECT, UPDATE trực tiếp ⇒ đọc 0, UPDATE 0; mục bản hai im; gương nêu SELECT, UPDATE. ⒞ thành viên trên bảng NO FORCE ⇒ đọc
2, gương im. ⒟ SUPERUSER NOBYPASSRLS trên bảng FORCE có policy chỉ FOR SELECT TO app_api ⇒ đọc 2, UPDATE 2; gương có vế superuser im,
gương không vế nêu UPDATE, DELETE. ⒠ INSERT không phủ ⇒ 42501 "new row violates row-level security policy"; thiếu USAGE lược đồ ⇒
42501 "permission denied for schema", gương im. ⒡ CREATE POLICY dưới vai không phải chủ ⇒ 42501 "must be owner of table"; REVOKE do
chính vai ⇒ không lỗi, chỉ WARNING "no privileges could be revoked". ⒢ vai có SELECT, UPDATE trên `suppliers`, không EXECUTE ⇒ đọc
ném 42501 "permission denied for function app_current_org_id"; GRANT EXECUTE ⇒ đọc 0 không lỗi, mục bản hai im; `migrate()` bằng
superuser đi qua và không thu hồi EXECUTE ấy. ⒣ hồ sơ N2 với một backfill đang chờ, dưới hardening bản hai ⇒ `migrate()` NÉM ở mục 94
(vai chạy migration) nhưng hàng vẫn 1, 2 và `schema_migrations` đã ghi `999_zz_backfill97c.sql`; REVOKE rồi chạy lại ⇒ đi qua, hàng
vẫn 1, 2.

**Tự bắt, không phải lượt soi:** ⑴ Lượt đột biến đầu: bỏ vế superuser SỐNG — vai bootstrap của cụm test mang BYPASSRLS, và
`pg_has_role` của superuser với mọi vai là true — nên bản hai bỏ vế ấy vì "thừa". Lý do "thừa" dựa trên vế thừa kế chủ loại MỌI thành
viên — chính chỗ hở NẶNG-2 của lượt soi 49; bản ba đưa vế superuser trở lại, và nó chịu lực. ⑵ Bỏ vế thừa kế chủ SỐNG — vế đối chứng
cũ thử thành viên của chủ khi `p_chu TO chủ` còn phủ nó ⇒ bản hai thêm vế bảng NO FORCE không policy nào phủ, và vế NOINHERIT. ⑶ Đột
biến "phủ không tính nhóm" đỏ ở cả bản đầu lẫn lượt đầu của bản hai vì chính phép thay dư một dấu ngoặc: SQL của hardening sai cú
pháp, `migrate()` của globalSetup hỏng, 48 test bị bỏ qua — đỏ giả. Sửa phép thay, đo lại: đỏ đúng ở vế nhóm. Script đột biến nay
gắn nhãn đỏ-do-setup khi mọi test bị bỏ qua.

**Evidence bắt, không phải lượt soi:** lần đo evidence đầu trên cây của vòng này — `[evidence] vitest thoát mã 1`, cổng báo
`F1` đỏ — hỏng đúng một test: [S1.38] "câu phán xét của hardening chạy trong test: hôm nay rỗng cả ba" quá hạn mặc định 30 s (30023
ms) dưới tải song song (cùng lượt, `db/migrations.int.test.ts` chạy 874 s và test [S1.32] 54,5 s). Đo trước khi sửa: ba câu phán
xét test ấy chạy (83⑴, 83⑵, 83⑶) cùng mọi hằng chúng dùng không đổi so với HEAD `fff0a17` — thay đổi của vòng chỉ nằm ở
`CAU_PHU_LENH_CHU_BANG_SAI`, chú thích và dòng mục; chạy riêng, tệp lọc về test ấy xong trong 5,5 s. Không phải hồi quy. Rà theo thời
gian đo được trên báo cáo của chính lượt ấy: đó là test duy nhất của `rls-coverage` và `migrations` còn dùng hạn mặc định mà dưới tải
vượt 15 s — lượt rà S1.55 theo lời gọi `migrate()` không thấy nó vì nó không gọi `migrate()`. Sửa: hạn 180 s như khuôn S1.40.

**Đỏ đo được, cô lập (ba bản):** Bản đầu — mười bốn đột biến: mười một đỏ; bỏ vế superuser và bỏ vế thừa kế chủ SỐNG; "phủ không
tính nhóm" đỏ giả vì lỗi dựng (phần tự bắt). Bản hai — mười bốn đột biến đều đỏ, "phủ không tính nhóm" đo lại sau khi sửa phép thay.
**Bản ba — hai mươi mốt đột biến trên mã cuối, chạy một-một, không đột biến nào đỏ do lỗi dựng:** R1 bỏ cả nhánh chủ thể thứ hai ⇒
đỏ ở TẦNG SẢN XUẤT (hồ sơ N2: `migrate()` dưới `trien_khai` đi qua) · R1b cùng đột biến ⇒ vế đo dưới `SET LOCAL ROLE` · R2 gương bỏ
"FORCE hoặc" ⇒ vế ⒜ (thành viên thừa kế chủ trên bảng FORCE) · R3 gương chỉ còn FORCE ⇒ vế NO FORCE và vế NOINHERIT · R4 thừa kế theo
MEMBER ⇒ vế thành viên NOINHERIT của chủ · R5 bỏ vế superuser ⇒ vế ⒟ · R6 bỏ vế BYPASSRLS ⇒ vế BYPASSRLS · R7 bỏ vế chính chủ ⇒ vế ⒠
· R8 bỏ vế USAGE lược đồ ⇒ vế ⒤ · R9 bỏ vế extension ⇒ vế extension · R10 bỏ vế bảng con ⇒ vế lá phân vùng · R11 quyền luôn đúng ⇒
vế hai lệnh · R12 quyền mức bảng thay mức cột ⇒ vế ⒢ · R13 xét lại INSERT ⇒ vế ⒜ (thêm dòng INSERT) · R14 phủ bỏ qua lệnh ⇒ vế FOR
SELECT · R15 phủ không tính nhóm ⇒ vế nhóm · R16 phủ theo MEMBER ⇒ vế ⒡ · R17 RESTRICTIVE tính là phủ ⇒ vế RESTRICTIVE · R18 đổi nhãn
⇒ thông điệp ở tầng sản xuất · R19 bỏ câu checksum ⇒ vế thông điệp NẶNG-1 ở tầng sản xuất · R20 `current_user` thành `session_user` ⇒
vế đo dưới `SET LOCAL ROLE`.

**Ranh giới NÓI RA:** ⑴ Mức bảo đảm là trạng thái tại lượt phán xét, SAU vòng đánh số: khi mục đỏ, backfill 0 hàng của chính lượt
đã ghi checksum (đo ⒣) — thông điệp nói ra; lớp hỏi trước vòng, và chụp vai quanh vòng khi một migration tự `SET ROLE`, là khoản 100.
⑵ Chỉ danh sách vai, không biểu thức USING: policy tenant TO PUBLIC tính là phủ vai deploy dù `migrate()` không gắn tổ chức; hôm nay
ồn nhờ EXECUTE của hàm ngữ cảnh (đo ⒢, ghim bằng vế ⒥) — khoản 101. ⑶ CI chạy `migrate()` bằng superuser nên chủ thể này chỉ chịu lực
ở hồ sơ N2; vai sở hữu mọi bảng (hồ sơ N3) là chính chủ nên đứng ngoài. ⑷ Thành viên NOINHERIT của chủ bị nêu dù migration có thể `SET
ROLE` sang chủ trước khi backfill (đo: đọc 2) — chiều kêu nhầm, lối ra `GRANT … WITH INHERIT TRUE`, REVOKE hay policy. ⑸ Hàm SECURITY
DEFINER mà backfill gọi chạy dưới chủ hàm — phép kiểm không soi đường ấy (đọc). ⑹ Hồ sơ hạ tầng (RDS) chưa có trong DECISIONS — mang
sang (lượt soi 49 INFO-2).

### Lượt soi đối kháng 49 (trên bản đầu của S1.56): 0 CAO, 2 NẶNG, 5 NHẸ, 3 INFO — xử lý trong bản ba, hai phát hiện thành khoản 100 và 101

| # | Mức | Phát hiện | Kiểm | Xử lý |
|---|---|---|---|---|
| NẶNG-1 | NẶNG | Chủ thể thứ hai chỉ phán xét SAU vòng migration đánh số: khi mục đỏ, backfill 0 hàng của chính lượt đã COMMIT và ghi checksum, deploy sau không chạy lại — thông điệp không nói, và số đo "đi qua, hàng không đổi" là số đo trước bản vá | **đúng — đo H1–H4** (người soi chỉ đọc mã): dưới hardening bản hai, hồ sơ N2 với một backfill đang chờ ⇒ `migrate()` NÉM nhưng hàng vẫn 1, 2 và `schema_migrations` đã ghi tệp; REVOKE rồi chạy lại ⇒ đi qua, backfill không chạy lại | thông điệp nói các migration đánh số của chính lượt đã chạy dưới cấu hình ấy và đã ghi checksum, và cách chạy lại; lớp hỏi TRƯỚC vòng đánh số (khuôn khoản 87) cho phần vai chạy migration là **khoản 100** — một lớp của `migrate.ts`, cùng hình dạng cho chủ thể chủ bảng; đột biến R19 |
| NẶNG-2 | NẶNG | Hở giữa hai chủ thể: bản đầu loại mọi vai thừa kế chủ "vì thuộc chủ thể thứ nhất", nhưng chủ thể thứ nhất loại chủ superuser/BYPASSRLS và chỉ xét quyền của chính chủ, còn khoản 91 FORCE mọi bảng ⇒ thành viên thừa kế chủ chịu RLS mà không ai soi | **đúng — đo ⒜ ⒝ ⒞**: chủ BYPASSRLS có thành viên INHERIT, bảng FORCE, policy chỉ TO app_api ⇒ thành viên đọc 0, UPDATE 0 không lỗi, cả hai chủ thể im; chủ thường tự REVOKE ALL, thành viên có GRANT trực tiếp ⇒ như thế; đối chứng NO FORCE ⇒ thành viên đọc 2 | chủ thể thứ hai là gương `check_enable_rls`: không superuser, không BYPASSRLS, không phải chính chủ, và bảng FORCE hay vai không thừa kế chủ; vế superuser trở lại và nay chịu lực (đo: SUPERUSER NOBYPASSRLS trên bảng FORCE — bỏ vế thì nêu UPDATE, DELETE dù superuser ghi đủ hàng); vế test ⒜ đến ⒠; đột biến R2, R3, R5, R7 |
| NHẸ-1 | NHẸ | `current_user` lúc phán xét không bảo đảm là vai đã chạy backfill: migration `SET ROLE x` không RESET, hay `SET LOCAL ROLE x` rồi backfill; `migrate.ts` không chụp hay so vai quanh vòng | đúng — đọc; hôm nay không migration nào có `SET ROLE` thật | ranh giới nói ra; chụp vai quanh vòng thuộc **khoản 100** |
| NHẸ-2 | NHẸ | Đột biến có thể sống: bỏ vế thừa kế chủ (vế đối chứng rỗng ruột vì `p_chu` phủ luôn thành viên), bỏ vế superuser (tương đương), `USAGE` đổi thành `MEMBER`, `has_any_column_privilege` đổi thành `has_table_privilege` | **đúng — đo**: hai đột biến đầu SỐNG ở lượt đột biến bản đầu (tự bắt trước khi lượt soi về); hai đột biến sau chưa có vế nào | vế INHERIT trên bảng NO FORCE không policy phủ, vế NOINHERIT của chủ và của nhóm, vế GRANT mức cột, vế superuser trên bảng FORCE; đột biến R4, R12, R16 |
| NHẸ-3 | NHẸ | Mọi lối ra nằm ngoài tầm vai bị nêu mà thông điệp đặt policy lên đầu; REVOKE do chính vai chạy là no-op; ô "cần quyền" của mục chưa đổi | **đúng — đo**: CREATE POLICY dưới vai không phải chủ ⇒ 42501 "must be owner"; REVOKE do chính vai ⇒ không lỗi, WARNING "no privileges could be revoked" | thông điệp: REVOKE trước và nói ai chạy (người cấp, chủ bảng, SUPERUSER), rồi chạy migration dưới chủ, policy cuối cùng kèm cảnh báo quyền đọc/ghi thường trực của vai deploy và [CR1]; ô cần quyền nêu người chạy |
| NHẸ-4 | NHẸ | Policy tenant `TO PUBLIC USING (org_id = app_current_org_id())` tính là phủ vai deploy dù `migrate()` không gắn `app.org_id`; hôm nay ồn chỉ nhờ EXECUTE của hàm ấy | **đúng — đo G1–G5**: không EXECUTE ⇒ 42501; GRANT EXECUTE ⇒ 0 hàng im, mục im; `migrate()` không thu hồi EXECUTE ấy | ranh giới có ghim (vế ⒥); **khoản 101** |
| NHẸ-5 | NHẸ | Mục kêu ở những ca ỒN: INSERT (ném, rollback, không ghi checksum) và vai thiếu USAGE trên lược đồ (mọi truy cập 42501) | **đúng — đo**: INSERT không phủ ⇒ 42501; thiếu USAGE ⇒ 42501 | chủ thể thứ hai không xét INSERT và đòi USAGE lược đồ; vế ⒣ ⒤; đột biến R8, R13 |
| INFO-1 | INFO | Chú thích nói hơn mã: phép đo dưới superuser và vai CREATEROLE rỗng theo cấu tạo; vế đối chứng "thành viên của chủ ⇒ im" im vì `p_chu` phủ; mô tả mục thiếu hai vế loại; tài liệu còn ghi 97 mở | đúng — đọc | chú thích trỏ vào census; thông điệp vế đối chứng nói đúng lý do; mô tả mục nêu gương, USAGE lược đồ, extension, bảng con; tài liệu cập nhật ở commit tài liệu |
| INFO-2 | INFO | Hồ sơ hạ tầng RDS được dùng làm căn cứ mà không có trong DECISIONS; trên RDS, bảng của một vai do master tạo cho master membership chỉ-admin ⇒ master rơi vào chủ thể thứ hai nếu có quyền | đúng — đọc: tiền đề nằm ở đề bài của lượt soi, không ở mã hay tài liệu | mang sang: ghi hồ sơ hạ tầng vào DECISIONS trước khi dùng làm căn cứ ADR-028 §3; đo ca "master cộng bảng của vai do master tạo" |
| INFO-3 | INFO | Đã soi, không thấy lỗi: EXECUTE trong khối DO chạy dưới vai của phiên, một kết nối, `pg_has_role … USAGE` khớp `has_privs_of_role`, fixture N2 không che mục khác, không trùng dòng, hiệu năng không đáng kể | đúng — đọc | không đổi |

**Điều đáng mang sang vòng sau:** ⑴ Một mục canh cơ chế làm backfill im phải hỏi TRƯỚC vòng đánh số — phán xét sau vòng chỉ
báo mất, không ngăn mất (khoản 87, nay khoản 100). ⑵ Mọi vế "ai chịu RLS" phải là gương `check_enable_rls` — superuser, BYPASSRLS,
chủ hay thừa kế chủ trừ khi FORCE; tách "chủ" và "không chủ" bằng riêng `pg_has_role` để hở đúng những vai mà FORCE kéo vào. ⑶ Fixture
của describe khoản 94 cũng thiếu membership `WITH INHERIT FALSE` và GRANT mức cột: đột biến `USAGE`→`MEMBER` và
`has_any_column_privilege`→`has_table_privilege` ở chủ thể chủ bảng nhiều khả năng cũng sống (suy ra, chưa đo). ⑷ Tiền đề của một
ranh giới ("hôm nay ồn nhờ EXECUTE") phải có test ghim và có khoản — nếu không, một GRANT gỡ lỗi lặng lẽ xoá nó (khoản 101).

# §S1.57 — khoản nợ 100: mục 94 hỏi TRƯỚC vòng đánh số — lượt `truoc_vong` bỏ qua dòng tự sửa được, và vai cuối mỗi tệp so với vai mở vòng

**Bề mặt an ninh:** `packages/db/src/migrate.ts` — lượt hardening `truoc_vong` chạy khi còn tệp chưa áp (phép từ chối
`TU_CHOI_TRUOC_VONG`), phép so `current_user` cuối tệp trong giao dịch của tệp (phép từ chối `TU_CHOI_DOI_VAI`), tệp hỏng thì huỷ
kết nối; `db/migrations/hardening.always.sql` — hằng `MAU_ACL_CUA_BANG` và `CAU_PHU_LENH_VAI_CHAY_MIGRATION_SAI` (`ten`, `duong`,
`tu_sua_duoc`), `CAU_PHU_LENH_CHU_BANG_SAI` bọc chủ thể thứ hai và nói checksum ở cả hai chủ thể, khối `truoc_vong` trong thân DO,
khối "BA LƯỢT" và DECLARE `che_do`. Barrel `@trustprocure/db` xuất thêm hai hằng. Test: `db/migrations.int.test.ts` (hai `it`
khoản 100, một khẳng định thêm ở test khoản 97); `packages/db/src/migrate.int.test.ts` (ba kỳ vọng số lượt lật có chủ đích, describe
khoản 100 sáu `it`); `db/migration-shape.test.ts` (lớp tĩnh, bốn `it`); `tests/architecture/hardening-co-ly-do.test.ts` (cổng thấy
khuôn `RAISE … ERRCODE`, một `it` đột biến).

**Đo trước khi viết (bản đầu, cụm test):** ⑴ hồ sơ N2 — `trien_khai` có SELECT, UPDATE trên `suppliers`, policy tenant thu về
`TO app_api`, một nhà cung cấp thật dựng theo chuỗi danh tính, một migration `999_zz_backfill100.sql` chạy
`UPDATE public.suppliers SET legal_name = …` đang chờ ⇒ dưới bản S1.56, `migrate()` dưới `trien_khai` NÉM ở lượt phán xét nhưng
khẳng định dữ liệu đỏ đúng chỗ: `schema_migrations` đã ghi `999` (1 thay vì 0) — backfill bị tiêu. ⑵ Tệp `SET LOCAL ROLE zz_x100`
và tệp `COMMIT; SET ROLE zz_x100; BEGIN;` (vai lạ có SELECT, INSERT trên `schema_migrations`, để không bị 42501 che) ⇒ bản S1.56 đi
qua và ghi checksum dưới vai lạ; tệp `SET ROLE` phạm vi phiên không trả lại ⇒ tệp sau chạy dưới vai lạ và ném 42501. ⑶ Ba test
đếm lượt `.always.sql` đỏ đúng con số cũ (3 thay vì 4; thứ tự thiếu `truoc_vong`).

**Hình dạng (bản hai):** ⒜ Chủ thể thứ hai của mục 94 (gương `check_enable_rls`, S1.56) tách thành
`CAU_PHU_LENH_VAI_CHAY_MIGRATION_SAI`, trả `ten`, `duong` và `tu_sua_duoc`. `duong` đọc từ ACL mức bảng (ACL mặc định khi `relacl`
NULL) và mức cột: cấp thẳng, qua PUBLIC, qua nhóm, thừa kế quyền chủ bảng. `tu_sua_duoc` có ba vế: thừa kế chủ theo USAGE; ADMIN
OPTION trên một vai thừa kế chủ; một cạnh membership INHERIT trên đường tới grantee giữ quyền mà vai ấy thu hồi được, tức grantor là
vai nó thừa kế. ⒝ Mục 94 bọc hằng ấy thành `mo_ta`: nêu đường tới quyền, nói checksum, và chia lời khuyên theo `tu_sua_duoc`.
Thông điệp chủ thể thứ nhất cũng nói checksum và nói nó cố ý không được hỏi trước vòng. ⒞ Thân DO: chế độ `truoc_vong` hỏi hằng ấy
trừ dòng `tu_sua_duoc`, RAISE SQLSTATE TP100 kèm `ten (duong)`, rồi RETURN; không bọc EXCEPTION. ⒟ `migrate.ts`: sau lượt sửa đầu
và hai phép hàng mức database, đọc `schema_migrations`. Còn tệp chưa áp thì chạy `truoc_vong`: lỗi TP100 thành
`TU_CHOI_TRUOC_VONG — <dòng (đường)>` kèm lối ra ít quyền nhất trước, lỗi khác ném nguyên; rồi chụp `current_user`. Với mỗi tệp,
sau SQL của tệp và trong chính giao dịch: `current_user` lệch vai mở vòng ⇒ `TU_CHOI_DOI_VAI`, ROLLBACK, huỷ kết nối. Mọi tệp hỏng
đều huỷ kết nối. ⒠ Lớp tĩnh: mọi `.sql` không phải `.always.sql` không được viết thẳng câu đổi vai; bộ bỏ chú thích biết chuỗi,
định danh `"…"` và dollar-quote, và quét cả chuỗi lẫn thân dollar-quote.

**Đo cho bản hai (thăm dò, PostgreSQL 16.15, hai container riêng, đã xoá):** ⒜ thành viên INHERIT của chủ, trên bảng FORCE mà
policy không phủ chủ, đọc 0 hàng; `ALTER POLICY … TO PUBLIC` và `CREATE POLICY … TO <nó>` đều được, đọc lại ra 2. ⒟ Thành viên
NOINHERIT có SET: `ALTER POLICY` báo "must be owner of table". ⒝ Vai do một vai CREATEROLE tạo: `pg_auth_members` ghi admin t,
inherit f, set f, grantor là superuser bootstrap. Vai tạo ra nó tự `GRANT` cho mình rồi `ALTER POLICY` được trong cùng giao dịch.
ADMIN trên một vai trung gian (không INHERIT, không SET) thừa kế chủ cũng tự cấp được, và ADMIN có qua một nhóm mà vai thừa kế cũng
vậy. ⒞ Membership nhóm do superuser cấp kèm ADMIN OPTION: tự `REVOKE` chỉ báo WARNING "role … has not been granted membership in
role … by role …", quyền còn nguyên. Membership do chính vai tự cấp thì tự `REVOKE` được, quyền mất ngay. Vị từ theo `grantor`
cho t ở ca sau, f ở ca trước. Thêm: `acldefault('r', chủ)` thay được `relacl` NULL, và `string_agg(DISTINCT … ORDER BY …)` chạy.

**Test (bản hai):**
- **`migrations.int`, hồ sơ N2 với backfill đang chờ.** Hai khẳng định dữ liệu đứng trước thông điệp: `999` không được ghi, hàng
  giữ nguyên. Thông điệp mang `TU_CHOI_TRUOC_VONG` và nêu `…/SELECT (cấp thẳng cho vai này)` cùng `…/UPDATE`, không DELETE.
- **Đối chứng `tu_sua_duoc`.** Quyền chuyển sang một nhóm mà `trien_khai` nhận membership kèm ADMIN từ superuser: vẫn bị chặn,
  và thông điệp nêu `(qua nhóm zz_nhom100)`. Chạy dưới superuser thì backfill áp đủ hàng.
- **`migrations.int`, test nhiều pha dưới vai deploy KHÔNG superuser.** Pha ⑴: vai deploy LÀ chủ bảng. Pha ⑵: thành viên INHERIT
  của chủ thường. Pha ⑶: thành viên INHERIT của chủ BYPASSRLS. Pha ⑷: ADMIN OPTION (không INHERIT, không SET) trên chủ. Pha ⑸:
  vai tự cấp membership nhóm mang quyền.
  - Với mỗi pha, lượt không tệp chờ phải NÉM ở mục 94, không mang nhãn từ chối trước vòng. Pha ⑴ nói "cố ý KHÔNG soi chủ thể
    này" và không có dòng "(vai chạy migration)" cho chính chủ. Các pha còn lại nêu dòng sau vòng kèm đường tới quyền và "cố ý
    KHÔNG chặn nó".
  - Sau đó một migration vá lỗi chạy dưới chính `trien_khai` phải tới được đích.
- **Khoản 97.** Không tệp chờ thì thông điệp không mang nhãn từ chối trước vòng.
- **`migrate.int`, describe khoản 100.**
  - `SET LOCAL ROLE` cuối tệp: ROLLBACK, không ghi.
  - `SET ROLE` phạm vi phiên: tệp sau không chạy.
  - Tệp tự COMMIT rồi `SET ROLE` ở cuối (câu ấy được commit cùng khối ngầm): kết nối bị huỷ, và bảng dựng trước COMMIT đã được
    commit (ranh giới).
  - Tệp `COMMIT; SET ROLE; COMMIT; SELECT 1/0`: kết nối bị huỷ.
  - Ranh giới: đổi vai rồi `RESET ROLE` thì đi qua.
  - Một `.always.sql` giả ném TP999 ở lượt `truoc_vong`: tệp chờ không chạy, lỗi nổi nguyên, không mang nhãn TP100.
- **Kỳ vọng lật có chủ đích.** Bốn lượt khi còn tệp chờ, và thứ tự `sua → truoc_vong → danh_so → sua → phan_xet`; lần gọi hai
  không tệp chờ thì ba lượt.
- **`migration-shape`.**
  - Mọi tệp đánh số sạch câu đổi vai.
  - Mười bảy cách viết bị bắt, kể cả `EXECUTE 'SET ROLE x'` trong DO và câu đứng sau một chuỗi mang `--` hay `/*`.
  - Chú thích lồng và câu SET/RESET khác không bị bắt.
  - Ranh giới ghim: tên ghép lúc chạy thì bộ dò không thấy.
- **`hardening-co-ly-do`.** Gỡ tên hằng mới khỏi ADR thì cổng đỏ.

**Tự bắt, không phải lượt soi:** ⑴ Lượt đo trước khi sửa của bản đầu đỏ một vế bằng `ReferenceError`, vì test quên import
`TU_CHOI_DOI_VAI`. Đỏ ấy không phải khẳng định; import bù, và hành vi trước bản vá của vế ấy được đo lại bằng đột biến M5 trên mã cuối.
⑵ Bản hai ghim pha đối chứng bằng dạng dòng TRƯỚC vòng `ten (đường)`, trong khi pha ấy đo thông điệp SAU vòng `ten: … lệnh này
(đường) …`, nên pha ⑵ đỏ ở khẳng định. Sửa chuỗi ghim bằng một hàm dựng dòng sau vòng, rồi chạy lại cả năm pha. ⑶ Lượt đột biến bản
hai bác một câu của chính test: đột biến bỏ CẢ HAI chỗ huỷ kết nối mà vế "tệp tự COMMIT rồi SET ROLE" vẫn xanh. Tệp của vế ấy kết thúc
bằng `BEGIN`, và BEGIN biến khối ngầm của câu nhiều lệnh thành giao dịch tường minh, nên ROLLBACK gỡ luôn SET ROLE đứng trước nó — câu
"ROLLBACK không gỡ được vai" ở tên test và ở chú thích `migrate.ts` là sai. Sửa: tệp của vế dừng ngay sau SET ROLE (câu ấy được commit
cùng khối ngầm); lời từ chối đổi vai dồn về một chỗ huỷ kết nối duy nhất (khối catch cho mọi lỗi tệp); bỏ đột biến "M6b" vì không còn
chỗ huỷ thứ hai. ⑷ Sau lượt đột biến, một dấu vết của M20 (`goc?.code !== undefined`) còn nằm trong `migrate.ts` dù script có assert
khôi phục sau từng đột biến; nguyên nhân chưa xác định được. Lượt chạy `migrate.int` kế tiếp đỏ đúng vế TP999. Một phép kiểm toàn vẹn
cơ khí (với mỗi đột biến: chuỗi gốc khớp đúng một lần, chuỗi đột biến vắng) chỉ ra đúng một chỗ ấy. Đã sửa, chạy lại `migrate.int`
21/21, và script đột biến nay sao lưu byte mọi tệp đích trước lượt rồi so lại sau lượt; M5, M6, M20, M21 chạy lại trên mã cuối kèm
bước so ấy.

**Đỏ đo được, cô lập (bản hai, mã cuối, chạy một-một):**
Hai mươi ba đột biến trên mã cuối, chạy một-một, không đột biến nào đỏ do lỗi dựng. Bốn đột biến chạm `migrate.ts` (M5, M6, M20, M21) chạy lại sau hai lần sửa mã cuối (vế C, dấu vết M20), kèm bước so byte với bản sao lưu: khớp cả bốn tệp. M1 bỏ lời gọi `truoc_vong` ⇒ đỏ ở khẳng định dữ liệu của hồ sơ N2 (`999` được ghi) · M2 hỏi trước vòng cả khi không tệp chờ ⇒ đỏ ở test khoản 97 (thông điệp mất câu checksum) và ở hai test đếm lượt · M3 `truoc_vong` chặn cả dòng `tu_sua_duoc` (đúng bản đầu) ⇒ đỏ ở test nhiều pha: migration vá lỗi bị từ chối trước vòng · M3b `truoc_vong` hỏi cả chủ thể chủ bảng ⇒ đỏ ở cùng khẳng định · M4 `truoc_vong` thiếu RETURN, rơi xuống BƯỚC 3 ⇒ đỏ ở cùng khẳng định · M5 bỏ phép so vai ⇒ ba vế đổi vai đỏ · M6 tệp hỏng không huỷ kết nối ⇒ đỏ ở vế tự COMMIT rồi SET ROLE và vế ném lỗi sau khi commit SET ROLE (client kế mang vai lạ) · M7 SQLSTATE của hardening lệch ⇒ đỏ ở thông điệp hồ sơ N2 · M8 thông điệp mất danh sách ⇒ đỏ ở dòng bảng/vai/lệnh · M9 bộ dò bỏ tiền tố SESSION/LOCAL ⇒ đỏ ở `SET LOCAL ROLE x` · M10 bộ dò dùng bộ bỏ chú thích không biết chuỗi ⇒ đỏ ở `SELECT '--'; SET ROLE x` · M10b bộ dò không bỏ chú thích ⇒ đỏ ở vế chú thích và ở census tệp thật · M11 mục 94 sau vòng mất nhánh vai chạy migration ⇒ đỏ ở test khoản 97 và ba test rls-coverage · M12 bỏ vế thừa kế chủ ⇒ đỏ ở pha ⑵ · M13 bỏ vế ADMIN ⇒ đỏ ở pha ⑷ · M14 bỏ vế tự cắt đường qua nhóm ⇒ đỏ ở pha ⑸ · M15 vế tự cắt không hỏi grantor ⇒ đỏ ở pha nhóm có ADMIN do superuser cấp (`999` được ghi) · M16 nhãn đường sai ⇒ đỏ ở `(cấp thẳng cho vai này)` · M17 thông điệp chủ thể chủ bảng mất câu checksum ⇒ đỏ ở pha ⑴ · M18 cổng H19 không thấy khuôn RAISE ⇒ đỏ ở đột biến của cổng · M19 chủ thể thứ hai không loại chính chủ ⇒ đỏ ở pha ⑴ (dòng vai chạy migration cho chính chủ) · M20 mọi lỗi của lượt hỏi trước vòng mang nhãn TP100 ⇒ đỏ ở vế TP999 · M21 nuốt lỗi khác TP100 ⇒ đỏ ở vế TP999.

**Ranh giới NÓI RA:** ⑴ Dòng `tu_sua_duoc` và chủ thể chủ bảng không được hỏi trước. Backfill trên chúng vẫn có thể bị tiêu trước khi
migration vá lỗi chạy; hai thông điệp sau vòng nói checksum. ⑵ Ba vế `tu_sua_duoc` xấp xỉ về phía bỏ qua nhiều hơn (cắt một đường
khi còn đường khác; ADMIN trên một vai superuser). Chiều ấy chỉ trả dòng về lượt phán xét sau vòng, không tạo ngõ cụt. ⑶ Phép so vai
chỉ thấy trạng thái cuối tệp: tệp đổi vai rồi `RESET ROLE` thì đi qua (test ghim). Lớp tĩnh chỉ bắt cách viết thẳng trong migration
của kho; tên ghép lúc chạy, escape Unicode trong `U&'…'` và hàm SECURITY DEFINER của vai khác đều lọt; chiều đỏ oan đã biết là cột tên
`role`. ⑷ Tệp tự COMMIT: phần trước lần COMMIT cuối của nó đã được commit, tệp không được ghi checksum nên lần sau chạy lại (test ghim).
⑸ Lượt hỏi trước vòng thấy cấu hình TRƯỚC vòng; cấu hình mọc ra trong vòng chỉ lượt phán xét sau vòng thấy. ⑹ Khi còn tệp chờ,
`migrate()` đọc và chạy thêm một lượt tệp hardening. ⑺ Khoản 101 (policy tenant TO PUBLIC tính là phủ vai deploy) nằm trong chính hằng
dùng chung, nên sửa nó là sửa cả hai lớp.

### Lượt soi đối kháng 50 (trên bản đầu của S1.57): 0 CAO, 1 NẶNG, 6 NHẸ, 1 INFO — xử lý hết trong bản hai

| # | Mức | Phát hiện | Kiểm | Xử lý |
|---|---|---|---|---|
| NẶNG-1 | NẶNG | Chặn trước vòng tạo ngõ cụt ADR-028 §3 ở dòng mà một migration dưới chính vai ấy sửa được: thành viên thừa kế chủ trên bảng FORCE, vai có ADMIN OPTION trên chủ hay trên nhóm mang quyền. Test "chủ bảng không bị hỏi trước" chạy dưới superuser nên che ca ấy | **đúng một phần — đo ⒜ ⒝ ⒞ ⒟** (người soi chỉ đọc): thành viên INHERIT `ALTER POLICY` được; ADMIN trên chủ hay trên vai trung gian thì tự cấp rồi `ALTER POLICY` được; thành viên NOINHERIT có SET thì "must be owner". Riêng vế nhóm SAI một nửa: ADMIN trên nhóm do superuser cấp KHÔNG tự thu hồi được; chỉ membership do chính vai tự cấp mới được | cột `tu_sua_duoc` ba vế theo đúng các đường đo được, và lượt `truoc_vong` bỏ qua chúng. Test nhiều pha dưới vai deploy không superuser, cộng pha đối chứng: nhóm có ADMIN do superuser cấp vẫn bị chặn. Đột biến M3, M3b, M12–M15, M19 |
| NHẸ-2 | NHẸ | Lời khuyên "REVOKE khỏi vai này" vô tác dụng khi quyền đến qua PUBLIC, qua nhóm, hay do thừa kế chủ | đúng — đọc; ⒞ đo thêm vế nhóm | cột `duong` nêu mọi đường tới quyền; hai thông điệp khuyên gỡ đúng đường ấy; test ghim ba nhãn "cấp thẳng", "qua nhóm", "thừa kế quyền chủ bảng"; đột biến M16 |
| NHẸ-3 | NHẸ | Cổng [INV-H19] không thấy phán xét mới (RAISE … ERRCODE ngoài `bang`), và ADR không có dòng lý do | đúng — đọc | `RE_NGOAI_BANG` nhận thêm khuôn `RAISE EXCEPTION USING ERRCODE`; dòng lý do ở ADR-036 hàng 27 và ADR-028 §3; một `it` đột biến của cổng; đột biến M18 |
| NHẸ-4 | NHẸ | Tệp tự COMMIT: ⑴ thông điệp nói "Tệp đã ROLLBACK" trong khi phần trước COMMIT đã được commit; ⑵ tệp commit một SET ROLE rồi ném lỗi thì client về pool dưới vai lạ | ⑴ đúng — test; ⑵ **đúng — đo** bằng đột biến M6 | ⑴ thông điệp nói "phần sau lần COMMIT cuối"; test có DDL trước COMMIT. ⑵ mọi tệp hỏng đều huỷ kết nối; test tệp `COMMIT; SET ROLE; COMMIT; SELECT 1/0` |
| NHẸ-5 | NHẸ | `RE_DOI_VAI` bỏ sót: chuỗi mang `--` hay `/*`, `SET "role"`, `E''`/`U&''`/`$$`, tên ghép, SECURITY DEFINER. Phạm vi `^\d{3}_` hẹp hơn tập tệp migrate() chạy. Chú thích nói "đóng" và "fail-closed" | đúng — đọc | bộ bỏ chú thích biết chuỗi; thêm `"role"`, `E''`, `U&''`, `$$`; phạm vi mọi `.sql` không phải `.always.sql`. Chú thích thu về "thu hẹp", ranh giới nêu tên ghép, escape Unicode, SECURITY DEFINER và đỏ oan cột `role`. Test ghim ranh giới; đột biến M9, M10, M10b |
| NHẸ-6 | NHẸ | Chủ thể chủ bảng vẫn để backfill bị tiêu mà thông điệp không nói checksum; đóng khoản 100 mà không ghi ranh giới là nói quá | đúng — đọc | thông điệp chủ thể thứ nhất nói checksum và nói nó cố ý không được hỏi trước; ranh giới ghi ở biên bản, ở hàng 100 và ở ADR-036 hàng 27; đột biến M17 |
| NHẸ-7 | NHẸ | Đột biến sống: nuốt lỗi khác TP100; gắn nhãn TP100 cho mọi lỗi; "chạy dưới chủ bảng ⇒ áp đủ" thực chất là chạy dưới superuser, bỏ `v.oid <> relowner` vẫn xanh ở tầng migrate() | đúng — đọc | test `.always.sql` giả ném TP999 ở lượt `truoc_vong`; pha ⑴ chạy dưới vai deploy LÀ chủ bảng; thông điệp nói "một vai mà RLS không áp"; đột biến M19, M20, M21 |
| INFO-8 | INFO | "Ngoại lệ DUY NHẤT" sai phạm vi; ranh giới "trừ migration tự SET ROLE sang chủ" mâu thuẫn với lớp tĩnh | đúng — đọc | câu giới hạn vào các lượt của hardening; ranh giới SET ROLE thay bằng ranh giới `tu_sua_duoc` |

**Điều đáng mang sang vòng sau:** ⑴ "Mọi lối ra nằm ngoài tầm vai bị nêu" là một tính chất phải đo TỪNG ĐƯỜNG (thừa kế chủ, ADMIN,
grantor của membership), không phải một câu. Bản đầu tin câu ấy, và nó sai ở ba đường. ⑵ Test cho một lớp soi "vai chạy migration"
phải chạy `migrate()` dưới vai KHÔNG superuser: superuser đứng ngoài chủ thể nên che đúng ca cần đo. ⑶ PG16 chỉ thu hồi membership
mà chính người thu hồi đã cấp; ADMIN OPTION không đủ để tự cắt đường. Người soi suy sai vế này bằng đọc, và phép đo bác nó. ⑷ Khoản
101 sửa hằng dùng chung, nên phải đo cả hai lớp: lượt hỏi trước vòng và lượt phán xét sau vòng.

# §S1.58 — khoản nợ 101: policy phụ thuộc hàm ngữ cảnh thôi tính là phủ vai chạy migration có EXECUTE mà RLS không coi là chủ — một hướng đo và bác, lượt soi 51, khoản 102 mở

**Bề mặt an ninh:** `db/migrations/hardening.always.sql` — hằng `CAU_PHU_LENH_VAI_CHAY_MIGRATION_SAI` (bọc ngoài; vế phủ loại policy
PERMISSIVE PHỤ THUỘC `public.app_current_org_id()` qua `pg_depend` khi vai có EXECUTE trên hàm ấy và RLS không coi vai là chủ; cột
`vi_tu_loc_het`, `duong_execute`, `loi_ra_execute`; `tu_sua_duoc` tách vế quyền chủ bảng và vế cạnh membership), nhánh thứ hai của
`CAU_PHU_LENH_CHU_BANG_SAI` (thông điệp rẽ nhánh, lối ra theo từng đường, lời khuyên chung cho đường tới quyền tách cấp thẳng / qua nhóm),
chuỗi của lượt `truoc_vong` (nêu đường và lối ra), chú thích NHẸ-4 và khối `truoc_vong`. `packages/db/src/migrate.ts` — chữ của
`TU_CHOI_TRUOC_VONG` và lời khuyên của thông điệp từ chối trước vòng. Test: `db/rls-coverage.int.test.ts` (vế ⒥ lật; một `it` mười pha;
một `it` ghim ranh giới khoản 102); `db/migrations.int.test.ts` (một `it` sáu pha).

**Đo trước khi viết (thăm dò S1.58, PostgreSQL 16, cụm test đã xoá):** hồ sơ N2 — `trien_khai` CREATEROLE, sở hữu database; một nhà
cung cấp thật dựng theo chuỗi danh tính; `999_zz_backfill101.sql` (`UPDATE public.suppliers SET legal_name = …`) đang chờ.
⒜ `trien_khai` có SELECT, UPDATE mà không EXECUTE ⇒ `SELECT count(*)` ném 42501 "permission denied for function app_current_org_id",
`migrate()` ném ở `999`, không ghi. ⒝ Thêm `GRANT EXECUTE ON FUNCTION app_current_org_id() TO trien_khai` ⇒ đếm ra 0 không lỗi;
`migrate()` QUA, `999` được ghi, hàng không đổi — mục 94 im vì policy tenant `TO PUBLIC` tính là phủ. ⒞ `trien_khai` là CHỦ `suppliers`
(FORCE) có EXECUTE ⇒ y như ⒝. Ở cả ba cấu hình, `SET row_security = off` làm câu đếm ném "query would be affected by row-level security
policy for table "suppliers"" (⒞ kèm gợi ý NO FORCE).

**Hướng đầu — `row_security = off` trong vòng đánh số — đo và BÁC:** bản đầu đặt `row_security = off` ở phạm vi phiên trước BEGIN của
mỗi tệp đánh số, so ở cuối tệp, RESET sau COMMIT, kèm một lớp tĩnh cấm migration ghi GUC ấy — một cơ chế đóng cả lớp "RLS lọc im lặng
trong migration" cho mọi chủ thể, mọi vị từ. Test riêng của nó xanh (cơ chế ở migrate.int; ⒜ ⒝ ⒞ ở hồ sơ N2 ném đúng lỗi RLS), nhưng
test hồ sơ N3 sẵn có đỏ: chỉ 3 migration được áp. Thăm dò chỉ ra ⑴ `004_audit_chain_functions.sql`, `CREATE FUNCTION audit_append …
LANGUAGE sql` — kiểm thân hàm (`check_function_bodies`) phân tích và VIẾT LẠI câu dưới vai tạo, RLS áp ở bước viết lại, nên ném dù không
câu nào đọc hàng; ⑵ tắt kiểm thân hàm cho vai không bỏ qua RLS thì gãy tiếp ở `011_rfq_hardening.sql` — kiểm ban đầu của khoá ngoại
(`ALTER TABLE … ADD FOREIGN KEY`) chạy một SELECT dưới chủ bảng FORCE và ném. Migration đã áp không sửa được, nên cài mới N3 thành ngõ
cụt; migration sau này thêm khoá ngoại trên bảng FORCE mà vai deploy sở hữu cũng vậy. Bản đầu lưu thành patch ở vùng nháp, không vào
kho. Thăm dò thêm: chủ ở N3 tự thu hồi EXECUTE của mình ngay sau 001 ⇒ 011 gãy với 42501 (kiểm khoá ngoại gọi vị từ policy).

**Bản hai (mức phán xét, trước lượt soi 51):** vế phủ loại policy khớp NGUYÊN VĂN `HINH_DANG_CHUAN` khi vai có EXECUTE, áp cho mọi vai
không phải chính chủ; `tu_sua_duoc = tu_sua_bang OR (vi_tu_loc_het AND tu_cat_execute)`; một lời khuyên chung "gỡ EXECUTE khỏi đường đã
nêu". Đo cho bản ấy (thăm dò, mỗi đường một giao dịch ROLLBACK): thừa kế chủ hàm ⇒ `REVOKE EXECUTE … FROM <chủ>` dưới chính vai ấy làm nó
mất EXECUTE, `app_api` vẫn giữ; ADMIN (không INHERIT, không SET) trên chủ hàm cộng EXECUTE cấp thẳng bởi superuser (grantor ghi là chủ) ⇒
tự cấp thừa kế rồi thu hồi của chủ và của chính nó ⇒ mất EXECUTE; EXECUTE cấp thẳng bởi superuser khi chủ hàm là vai bootstrap ⇒ tự thu
hồi là no-op; membership nhóm tự cấp (cạnh superuser chỉ-admin không INHERIT) ⇒ tự cắt cạnh của mình ⇒ mất EXECUTE.

**Đo cho các phát hiện của lượt soi 51 (thăm dò, trên bản hai):** ⑴ hồ sơ N3′ — `trien_khai` thừa kế một vai NOLOGIN `zz_chu102` sở hữu
`suppliers` và `app_current_org_id()`, `999` đang chờ ⇒ `migrate()` NÉM ở lượt phán xét (dòng "(thừa kế quyền chủ bảng zz_chu102) mà policy
PERMISSIVE phủ nó theo danh sách vai chỉ là policy tenant chuẩn"), `999` được ghi, hàng không đổi; lần hai không tệp chờ vẫn NÉM. ⑵ vai
deploy là thành viên `app_api` (superuser cấp, cạnh còn nguyên sau BƯỚC 1) cộng một tệp chờ ⇒ TP100 nêu hàng loạt bảng "(qua nhóm app_api —
… : qua nhóm app_api)" dưới lời khuyên chung "gỡ EXECUTE khỏi đường ấy". ⑶ kiểm khoá ngoại ban đầu — hai bảng FORCE có policy tenant chuẩn,
một hàng con treo do superuser chèn, chủ NOLOGIN: chủ có EXECUTE ⇒ `ADD FOREIGN KEY` đi qua, `convalidated = true`, hàng treo sống sót;
chủ không EXECUTE ⇒ 42501; superuser ⇒ 23503.

**Hình dạng (bản ba):** ⒜ Vế phủ loại policy PERMISSIVE PHỤ THUỘC hàm ngữ cảnh (`pg_depend`: `pg_policy` → `pg_proc`) khi vai có EXECUTE
trên hàm ấy VÀ RLS không coi vai là chủ (`NOT pg_has_role(vai, chủ bảng, 'USAGE')`); không EXECUTE thì câu ném 42501 nên policy vẫn tính
là phủ; hàm chưa tồn tại thì vế `pg_depend` rỗng. Hằng dùng chung, nên lượt hỏi trước vòng (khoản 100) và lượt phán xét sau vòng cùng thấy
dòng mới. ⒝ Cột `vi_tu_loc_het` (có policy phủ theo danh sách vai mà dòng vẫn tới ⇒ chính policy ấy bị loại), `duong_execute` (qua PUBLIC,
quyền chủ hàm, cấp thẳng, qua nhóm) và `loi_ra_execute` — lối ra theo từng đường: cấp thẳng thì REVOKE khỏi vai này; qua PUBLIC thì
REVOKE FROM PUBLIC; qua nhóm thì gỡ membership của vai này, KHÔNG thu hồi khỏi nhóm, và nhóm thuộc `ROLE_CANH` thì nói thẳng đó là vai ứng
dụng; quyền chủ hàm thì gỡ membership vào chủ hàm, kèm cảnh báo thu hồi EXECUTE của chủ làm kiểm khoá ngoại ban đầu ném. ⒞ `tu_sua_duoc`
của dòng khoản 101 = tự cắt được EXECUTE (ba vế trên hàm ngữ cảnh) HOẶC cắt được đường tới quyền trên bảng (vế cạnh membership); hai vế
quyền chủ bảng chỉ còn tính cho dòng khoản 97. ⒟ Thông điệp: lượt `truoc_vong` nêu đường tới EXECUTE ở từng dòng và lối ra theo đường một
lần ở cuối; thông điệp sau vòng nói policy phủ theo danh sách vai phụ thuộc hàm ngữ cảnh, và nêu lối ra theo đường; lời khuyên chung cho
đường tới quyền trên bảng — ở thông điệp sau vòng và ở `migrate.ts` — tách cấp thẳng / qua nhóm; `TU_CHOI_TRUOC_VONG` đổi chữ ("không
policy PERMISSIVE nào cho nó thấy hàng").

**Test:**
- **`rls-coverage`, vế ⒥ (lật có chủ đích).** Không EXECUTE ⇒ câu ném 42501, mục im; có EXECUTE ⇒ câu đọc không lỗi, mục nêu SELECT và
  UPDATE.
- **`rls-coverage`, `it` khoản 101 (một giao dịch ROLLBACK).** ⒜ EXECUTE cấp thẳng bởi superuser ⇒ hai dòng, đường tới EXECUTE, lối ra
  REVOKE khỏi vai này, chặn trước vòng; ⒠ policy `USING (true)` vẫn phủ; ⒣ khuôn "đấu thầu kín" phụ thuộc hàm vẫn bị loại; ⒝ nhóm tự cấp,
  ⒞ thừa kế chủ hàm, ⒟ ADMIN trên chủ hàm ⇒ "cố ý KHÔNG chặn nó"; ⒢ dòng khoản 97 của vai tự cắt được EXECUTE vẫn bị chặn; ⒡ membership nhóm
  do superuser cấp ⇒ chặn, lối ra không thu hồi khỏi nhóm; ⒦ ADMIN trên vai sở hữu bảng không tha dòng khoản 101; ⒤ vai thừa kế chủ bảng
  đứng ngoài (khoản 102).
- **`rls-coverage`, ranh giới khoản 102.** Kiểm khoá ngoại ban đầu dưới chủ FORCE có EXECUTE đánh dấu ràng buộc hợp lệ, hàng con treo sống
  sót; không EXECUTE ⇒ 42501; superuser ⇒ 23503.
- **`migrations.int`, `it` khoản 101, hồ sơ N2.** ⒜ từ chối trước vòng — hai khẳng định dữ liệu đứng trước thông điệp (`999` không được
  ghi, hàng giữ nguyên), thông điệp nêu dòng kèm đường tới EXECUTE và lối ra REVOKE khỏi `trien_khai`; ⒝ gỡ EXECUTE ⇒ không chặn trước vòng,
  backfill ném 42501, không ghi; ⒝′ thành viên `app_api` ⇒ chặn trước vòng, lối ra "KHÔNG thu hồi EXECUTE khỏi app_api: đó là vai ứng
  dụng", không lời khuyên nào chứa "FROM app_api"; ⒞ EXECUTE qua nhóm tự cấp ⇒ không chặn trước vòng, `999` đang chờ bị tiêu (ranh giới
  ghim), phán xét sau vòng nêu dòng kèm "cố ý KHÔNG chặn nó", migration vá lỗi dưới chính vai deploy tới đích; ⒟⑴ chủ bảng FORCE có EXECUTE
  và ⒟⑵ hồ sơ N3′ ⇒ deploy xanh, backfill bị tiêu (ranh giới khoản 102).
- **Không đổi, chạy lại:** khoản 97, hai `it` khoản 100, hồ sơ N3, migrate.int, QT3, cổng H19.

**Tự bắt, không phải lượt soi:** ⑴ Hướng `row_security = off` bị chính test hồ sơ N3 sẵn có bác — một test không viết cho vòng này;
chỉ chạy test mới của vòng thì bản ấy đã đi tiếp. ⑵ Lượt đo trước khi viết của bản đầu chỉ tới pha ⒜, vì ⒜ vốn đã ồn (bằng 42501); tác
hại thật (⒝ ⒞) được đo bằng một thăm dò riêng ghi cả dữ liệu lẫn thông điệp. ⑶ Soạn lượt đột biến của bản hai chỉ ra ba đột biến không
khẳng định nào chạm tới — vế loại bỏ điều kiện khớp hình dạng, vế nhóm bỏ grantor, lời khuyên gỡ EXECUTE — nên thêm đối chứng ⒠ ⒡ và hai
chỗ ghim trước khi chạy. ⑷ Lượt đo trước bản vá của bản ba dừng ở chỗ ghim thông điệp đầu tiên đổi chữ; hành vi trước bản vá của các pha sâu
hơn (⒝′, ⒟⑵, ⒣, ⒦, ⒤) được đo bằng thăm dò của lượt soi 51 và bằng đột biến M3, M5, M11, M16 trên mã cuối, không bằng chính lượt ấy.

**Đỏ đo được, cô lập (mã cuối, chạy một-một):**
Hai mươi đột biến trên mã cuối, chạy một-một, không đột biến nào đỏ do lỗi dựng; bước so byte với bản sao lưu sau lượt khớp cả hai tệp đích. M1 bỏ vế loại (bản trước bản vá) ⇒ đỏ ở vế ⒥ có EXECUTE, pha ⒜ của `it` khoản 101 và pha ⒜ hồ sơ N2 (`999` đi qua) · M2 vế loại không hỏi EXECUTE ⇒ đỏ ở vế ⒥ không EXECUTE và pha ⒝ hồ sơ N2 (bị chặn trước vòng thay vì ném 42501) · M3 vế loại không trừ vai mà RLS coi là chủ (bản hai) ⇒ đỏ ở ⒤ và ở ⒟⑵ hồ sơ N3′ (phán xét sau vòng ném) · M4 vế loại không hỏi phụ thuộc ⇒ đỏ ở ⒠ (policy `USING (true)` thôi phủ) · M5 quay về khớp nguyên văn `HINH_DANG_CHUAN` (bản hai) ⇒ đỏ ở ⒣ (khuôn đấu thầu kín im) · M6 `vi_tu_loc_het` luôn false ⇒ đỏ ở thông điệp ⒜ của cả hai test · M7 bỏ vế thừa kế chủ hàm ⇒ đỏ ở ⒞ · M8 bỏ vế ADMIN trên vai thừa kế chủ hàm ⇒ đỏ ở ⒟ · M9 bỏ vế cạnh membership trên đường tới EXECUTE ⇒ đỏ ở ⒝ và ở pha ⒞ hồ sơ N2 (migration vá lỗi bị chặn trước vòng) · M10 vế cạnh không hỏi grantor ⇒ đỏ ở ⒡ và ở pha ⒝′ hồ sơ N2 (`999` bị tiêu dưới thành viên app_api) · M11 dòng khoản 101 lại tính hai vế quyền chủ bảng ⇒ đỏ ở ⒦ · M12 vế tự cắt EXECUTE tha cả dòng khoản 97 ⇒ đỏ ở ⒢ · M13 lượt `truoc_vong` không nêu đường tới EXECUTE ⇒ đỏ ở dòng ⒜ hồ sơ N2 · M14 lượt `truoc_vong` không nêu lối ra ⇒ đỏ ở chỗ ghim lối ra ⒜ · M15 thông điệp sau vòng mất nhánh khoản 101 ⇒ đỏ ở ⒜ của `it` khoản 101 và ⒞ hồ sơ N2 · M16 lối ra đường qua nhóm khuyên thu hồi khỏi nhóm ⇒ đỏ ở ⒡ và ⒝′ · M17 lối ra quên nói nhóm là vai ứng dụng ⇒ đỏ ở ⒝′ · M18 nhãn quyền chủ hàm sai ⇒ đỏ ở ⒞ · M19 thông điệp từ chối trước vòng quay về lời khuyên chung ⇒ đỏ ở ⒝′ · M20 thông điệp sau vòng mất lối ra theo đường ⇒ đỏ ở chỗ ghim lối ra ⒜.

**Ranh giới NÓI RA:** ⑴ Theo phụ thuộc: hàm bọc lấy `app_current_org_id()` lọt; policy phụ thuộc hàm mà vị từ vẫn đúng khi phiên chưa gắn
tổ chức (vd. `app_current_org_id() IS NULL AND …`) bị tính là không phủ — chiều chặn; hôm nay không policy PERMISSIVE nào như thế (dòng
ngoại lệ duy nhất đọc `current_setting` trực tiếp). ⑵ Vai mà RLS coi là chủ (chính chủ; thừa kế chủ trên bảng FORCE) đứng ngoài — khoản
102: backfill dưới N3 và N3′ vẫn bị tiêu, và kiểm khoá ngoại ban đầu dưới chủ FORCE có EXECUTE đánh dấu ràng buộc hợp lệ mà không kiểm hàng
(đo, test ghim). ⑶ Dòng tự sửa được không bị chặn trước vòng — backfill cùng lượt bị tiêu (test ghim ⒞), cùng hạng ranh giới S1.57. ⑷ Xấp
xỉ theo CẢ HAI chiều: cắt một đường khi còn đường khác (EXECUTE cấp thẳng cộng một nhóm tự cấp) tính là tự sửa được — chiều bỏ qua; ADMIN
trên một vai giữ GRANT OPTION đã cấp EXECUTE thẳng thì không đọc — chiều chặn; EXECUTE tự cấp nhờ GRANT OPTION không tính là tự cắt được.
⑸ Backfill theo tổ chức bằng `SET LOCAL app.org_id` hay `set_config` dưới vai deploy thường có EXECUTE nay bị chặn — chạy dưới vai mà RLS
không áp, với điều kiện org_id tường minh. ⑹ Lời cảnh báo "thu hồi EXECUTE của chủ hàm làm kiểm khoá ngoại ban đầu ném" lấy từ phép đo hồ sơ
N3 và phép đo ⑶ ở trên, chưa đo trên từng cấu hình chủ hàm khác.

### Lượt soi đối kháng 51 (trên bản hai): 0 CAO, 2 NẶNG, 4 NHẸ, 2 INFO — mọi phát hiện có xử lý trong bản ba; hai đề xuất không theo, lý do trong bảng

| # | Mức | Phát hiện | Kiểm | Xử lý |
|---|---|---|---|---|
| NẶNG-1 | NẶNG | Hồ sơ N3′ (vai deploy thừa kế một vai NOLOGIN sở hữu cả bảng lẫn hàm, bảng FORCE): bản hai đỏ ở mọi lần deploy mà backfill vẫn bị tiêu — vế thừa kế chủ bảng tính là tự sửa được nên không chặn trước vòng, còn lối ra được chỉ (gỡ EXECUTE của chủ; thêm policy) thì gãy hay không qua cổng migration-shape và [CR1]; ranh giới 101/102 cắt theo OID chủ, không theo cơ chế RLS | **đúng — đo ⑴** | vai mà RLS coi là chủ đứng ngoài vế loại — cùng lớp với N3, dồn vào khoản 102; với dòng khoản 101, hai vế quyền chủ bảng không tính là tự sửa được; test ⒟⑵ (migrations.int), ⒤ và ⒦ (rls-coverage); đột biến M3, M11. **Không theo đề xuất chặn N3′ trước vòng**: chặn N3′ mà để N3 im là đúng sự lệch người soi chỉ ra, còn chặn cả hai là quyết định về mô hình triển khai mà khoản 102 để ngỏ (lối ra duy nhất đã đo là chạy migrate() dưới vai BYPASSRLS) |
| NẶNG-2 | NẶNG | Vai deploy là thành viên app_api (superuser cấp): dòng "qua nhóm app_api" với lời khuyên "gỡ EXECUTE khỏi đường ấy" và "REVOKE khỏi đúng grantee ấy" dẫn tới thu hồi khỏi app_api — ứng dụng ném 42501; TP100 còn che nguyên nhân gốc (membership lạ) | **đúng — đo ⑵** | cột `loi_ra_execute` — lối ra theo từng đường, đường qua nhóm KHÔNG thu hồi khỏi nhóm, nhóm thuộc `ROLE_CANH` thì nói thẳng là vai ứng dụng và nhắc mục membership; lời khuyên chung cho đường tới quyền trên bảng tách cấp thẳng / qua nhóm ở cả `migrate.ts` và thông điệp sau vòng; test ⒝′ ghim; đột biến M16, M17, M19 |
| NHẸ-3 | NHẸ | Dòng tự sửa được qua vế EXECUTE vẫn để backfill cùng lượt bị tiêu, không test ghim; vế cạnh là xấp xỉ (EXECUTE cấp thẳng cộng một nhóm tự cấp) | đúng — đọc; ⒞ đo | ranh giới ghim: ⒞ giữ `999` đang chờ — không chặn trước vòng, `999` được ghi, hàng không đổi; chú thích nói xấp xỉ theo cả hai chiều. **Không theo đề xuất hỏi lại hằng trong giao dịch của từng tệp**: nó lật ranh giới đã chấp nhận của S1.57 (dòng tự sửa được không bị chặn) cho mọi dòng, không riêng khoản 101 — để một vòng riêng nếu cần |
| NHẸ-4 | NHẸ | Ba đột biến sống: bỏ `vi_tu_loc_het AND`; `polqual` → `polwithcheck`; vế `f.oid IS NOT NULL` không tới được (ADR-028 §2⑷) | đúng — đọc | ⒢ dòng khoản 97 của vai tự cắt được EXECUTE vẫn bị chặn (đột biến M12); vế loại nay theo `pg_depend` nên không còn so `polqual`; bỏ vế `f.oid IS NOT NULL` |
| NHẸ-5 | NHẸ | Khớp nguyên văn hỏng theo hướng IM với hình dạng ngoại lệ đã tiên liệu ("đấu thầu kín") | đúng — đọc | vế loại theo phụ thuộc `pg_depend`; ⒣ khuôn đấu thầu kín bị loại (đột biến M5); ranh giới: hàm bọc vẫn lọt |
| NHẸ-6 | NHẸ | Tách khoản 102 nói thiếu: ⒜ theo 005, N3 là "role deploy thật" nên EXECUTE và backfill rỗng là mặc định; ⒝ kiểm khoá ngoại ban đầu dưới chủ FORCE có EXECUTE quét 0 hàng và đánh dấu ràng buộc hợp lệ (cần đo); ⒞ STATE chưa có hàng 102 | ⒝ **đúng — đo ⑶** | hàng 102 nêu N3 là hồ sơ tham chiếu theo 005, gồm N3′ và kiểm khoá ngoại rỗng; test ghim ranh giới khoản 102 |
| INFO-7 | INFO | Backfill theo tổ chức với id ghi cứng nay bị chặn khi vai deploy có EXECUTE, chưa ghi giá | đúng — đọc | ghi giá ở ranh giới ⑸ và ADR-036 hàng 27 |
| INFO-8 | INFO | Không đọc `grantor` của mục ACL ⇒ có xấp xỉ về phía CHẶN, trái lời khai "ba vế đều xấp xỉ về phía bỏ qua" | phỏng đoán, ca gượng ép | sửa lời khai: xấp xỉ theo cả hai chiều (ranh giới ⑷); không thêm vế |

**Điều đáng mang sang vòng sau:** ⑴ Một cơ chế đóng "cả lớp" phải chạy qua MỌI hồ sơ triển khai đã có test trước khi tin —
`row_security = off` đúng với DML, nhưng PostgreSQL áp RLS cả ở kiểm thân hàm SQL và kiểm ban đầu của khoá ngoại, hai chỗ không đọc
hàng nào. ⑵ Một vế lọc mới trên lược đồ thật cho ra dòng ở những đường mà thông điệp và `tu_sua_duoc` chưa từng đo (nhóm app_api, vai chủ
NOLOGIN) — phải chạy vế ấy qua các hồ sơ vai deploy có thật trước khi viết lời khuyên. ⑶ Lời khuyên sửa phải rẽ theo đường: một câu chung
"REVOKE khỏi đường ấy" đúng cho đường cấp thẳng và PHÁ ứng dụng ở đường qua nhóm. ⑷ Hồ sơ N3 là role deploy thật theo 005; mọi bản vá quanh
RLS của vai deploy phải đo ở đó — khoản 102 là hệ quả trực tiếp của khoản 91 và chưa có hình dạng sửa không tạo ngõ cụt.

# §S1.59 — khoản nợ 99: lần lấy client của pool có vai từ chối kết nối không sạch, hai bộ dọn nền không commit dưới replica, census đường SQL ngoài withTenant — lượt soi 52, khoản 103 và 104 mở

**Bề mặt an ninh:** `packages/db/src/vai-tro.ts` — `ganVaiChoClient`, chạy ở MỌI lần lấy client của pool có vai qua `ganVaiTroChoPool`
(đường promise lẫn đường callback mà `pool.query` dùng): đọc `getTransactionStatus()` trước `SET ROLE`; câu kiểm `current_user` đọc thêm
`session_replication_role`, `row_security` và `current_schemas(false)`; mốc search path hiệu lực theo client ở lần lấy đầu (WeakMap);
lệch ⇒ ném `KetNoiNhiemError` và `ganVaiTroChoPool` huỷ kết nối (`release(loi)`); lớp lỗi và tiền tố `TU_CHOI_KET_NOI_NHIEM` xuất qua barrel
`@trustprocure/db`. `packages/invitation/src/invitation.ts` — `donBucketNguoiGoiCu` đổi từ một `pool.query` tự commit sang giao dịch
tường minh; cả hai bộ dọn kết thúc bằng `CAU_COMMIT_CHAN_REPLICA` (khối DO ⑴ của khoản 96, chép nguyên văn), TP096 thành `InvitationError`,
huỷ kết nối trên mọi lỗi. Test: `tests/architecture/duong-sql-ngoai-with-tenant.test.ts` (census ⒜ ⒝ ⒞ cộng đối chứng trên văn bản giả);
`packages/db/src/vai-tro.int.test.ts` (một describe tám `it`); `packages/invitation/src/invitation.int.test.ts` (một describe ba `it`);
`tests/architecture/barrel-exports.test.ts` (danh sách trắng của `@trustprocure/db` thêm hai tên).

**Đo trước khi viết (test viết trước, chạy trên mã cũ, PostgreSQL 16):** ⒜ `vai-tro.int` — pool một kết nối đăng nhập `app_api_login`, gắn
vai `app_api`: `SET row_security = off` rồi trả client ⇒ lần `pool.connect()` kế giao ra đúng client ấy; hàm SECURITY DEFINER của superuser
đặt `session_replication_role = replica` ở phạm vi phiên ⇒ lần `pool.query` kế chạy dưới replica; `SET search_path = zz99, public` ⇒ client
giao ra dưới search path lạ; `BEGIN` rồi trả client ⇒ lần lấy kế chạy `SET ROLE` bên trong giao dịch cũ và giao client ra. ⒝ `invitation.int`
— một trigger AFTER DELETE cấp câu gọi hàm SECURITY DEFINER đặt replica ⇒ `donOtpRateLimitsCu` COMMIT dưới replica và trả số hàng,
`donBucketNguoiGoiCu` (câu tự commit) cũng vậy; và kết nối pool Ở LẠI replica: `it` kế tiếp của tệp — một đột biến policy dọn chạy
`withTenant` trên cùng pool — ném TenantError của TP096. Tác hại lan sang người dùng khác của pool được đo, không suy ra. ⒞ census — ⒝
nêu COMMIT trần của `invitation.ts`, ⒞ nêu `invitation.ts` lấy 1 / câu 1 so với khai 2 / 0. ⒟ Lượt đo trước bản vá của vòng sửa sau lượt
soi 52: `it` giao dịch bỏ ngỏ đỏ ở hành vi (lời gọi không ném); ba `it` bộ dọn đỏ ở pid giữ nguyên sau lỗi và ở chữ thông điệp cũ; các chỗ
ghim lớp `KetNoiNhiemError` đỏ vì lớp chưa tồn tại — hành vi bản đầu ở vế DDL đo bằng đột biến M11, không bằng lượt ấy.

**Hình dạng:** ⒜ Lớp ⑵ ở chỗ MỌI đường của pool có vai đi qua — `ganVaiChoClient`: trạng thái giao dịch đọc từ client, không vòng đi-về,
phải là rảnh; ba GUC trong cùng câu `current_user` đã có — `session_replication_role` và `row_security` theo TÍNH CHẤT (origin hay local; on),
cùng quy tắc withTenant ⑵, kể cả ở lần lấy đầu, khi giá trị xấu chỉ có thể đến từ mặc định phiên và thông báo nói đúng nguồn ấy; search path
HIỆU LỰC (`current_schemas(false)`) so với mốc lần lấy đầu của chính kết nối — tương đối, nên mặc định phiên hợp lệ khác mặc định máy chủ
vẫn qua; đọc qua hàm chứ không qua tên GUC vì [INV-H21] (lượt soi 52 NẶNG-1). Lệch ⇒ ném `KetNoiNhiemError` (tên riêng — mọi chỗ ghi log chỉ
ghi tên lỗi), huỷ kết nối, không thử lại. ⒝ Lớp ⑴ cho mã ngoài withTenant: mọi giao dịch tường minh kết thúc bằng khối chặn; câu ghi tự commit
đổi thành giao dịch tường minh; bộ dọn huỷ kết nối trên mọi lỗi. ⒞ Census kiến trúc thay cho "hàm dùng chung" mà sổ nợ gợi ý: ⒜ mọi
`createPool(` sản xuất truyền `role` (không `role: undefined`, không đổi tên khi import), số chỗ dựng `new pg.Pool(` / `new pg.Client(` theo
tệp; ⒝ số lệnh COMMIT/END không chặn theo tệp (bộ quét SQL trái-sang-phải bỏ chú thích, hằng nháy đơn và thân dollar-quote; bỏ toán hạng
phép so command tag; `end` viết thường chỉ khi là đối số đầu của `.query(`), tệp mang khối chặn có nhánh so TP096; ⒞ số chỗ `.connect()`
và `…pool.query(` theo tệp — mọi con số khớp danh sách khai kèm lý do, miễn theo SỐ LƯỢNG, mục khai chết cũng đỏ.

**Test:**
- **`vai-tro.int`, describe khoản 99 (pool một kết nối, đo pid).** `row_security = off` ⇒ `pool.connect()` kế ném `KetNoiNhiemError` (ghim
  `name`) nêu `row_security`, kết nối mới ở `on`; replica do hàm SECURITY DEFINER ⇒ `pool.query` kế (đường callback) ném nêu
  `session_replication_role`, kết nối mới ở `origin`; search path phạm vi phiên ⇒ ném nêu search path hiệu lực, kết nối mới về đúng mốc;
  giao dịch bỏ ngỏ ⇒ ném nêu "đang mở giao dịch", kết nối bị huỷ; ĐỐI CHỨNG SET LOCAL + `local` ⇒ giữ kết nối; mặc định phiên
  `row_security = off` của vai đăng nhập ⇒ lần lấy ĐẦU ném, chẩn đoán MẶC ĐỊNH PHIÊN; mặc định phiên search path hợp lệ khác mặc định máy chủ
  ⇒ giữ kết nối; RANH GIỚI ghim — DDL (`CREATE SCHEMA app_api`, `GRANT USAGE`) đổi search path hiệu lực ⇒ lần lấy kế ném một lần, kết nối
  mới lấy mốc mới và được giữ.
- **`invitation.int`, describe khoản 99 (pool có vai một kết nối, đo pid).** Mỗi bộ dọn: trigger đặt replica giữa câu dọn ⇒ `InvitationError`
  nêu `session_replication_role` và "COMMIT không chạy", không còn chữ "đã bị bỏ qua", hàng cũ còn nguyên, kết nối bị huỷ; gỡ trigger ⇒ dọn
  bình thường. ĐỐI CHỨNG ánh xạ lỗi: constraint trigger DEFERRED ném lúc COMMIT ⇒ lỗi ấy đi ra nguyên dạng, không phải `InvitationError`,
  hàng cũ còn nguyên, kết nối bị huỷ.
- **Census** ⒜ ⒝ ⒞ trên mã sản xuất, cộng đối chứng văn bản giả cho từng vế của bộ dò.
- **Không đổi, chạy lại:** trọn `pnpm test:int` trên bản đầu (39 tệp, 862 test xanh — lớp lấy client không làm vỡ đường nào có sẵn, gồm
  tám `it` khoản 96 của withTenant); trọn `pnpm test` (bắt NẶNG-1); sau vòng sửa: census, [INV-H21], barrel, `vai-tro.int`, `invitation.int`.

**Tự bắt, không phải lượt soi:** ⑴ Lần chạy đầu của census nêu hai dương tính giả — so command tag `ketThuc?.command !== "COMMIT"` ở
`with-tenant.ts`, và chuỗi `"end"` (tên sự kiện stream) ở `apps/api/src/server.ts` ⇒ bỏ toán hạng của phép so, END viết thường chỉ tính ở
đối số `.query(`; mỗi vế có một đối chứng văn bản giả. ⑵ Lượt đo đầu sau bản vá: census ⒝ và `it` của `donOtpRateLimitsCu` vẫn đỏ — bản vá
mới đổi `donBucketNguoiGoiCu`, COMMIT trần của bộ dọn kia còn sót; và `it` của `donBucketNguoiGoiCu` nhận lỗi của lớp lấy client thay vì
`InvitationError` — replica mà bộ dọn chưa vá để lại bị lớp mới bắt ở lần lấy kế. ⑶ Đối chứng văn bản giả của census bản viết lại bắt hai
chỗ sai của chính người viết: hằng khối chặn của hai bộ dọn là MỘT (khẳng định chống rỗng ruột đòi ba), và bộ đọc chung đọc `\n` viết thoát
thành chữ `n` (ghi thành ranh giới). ⑷ Lượt đo trước vòng sửa để lại một hàng `otp_rate_limits` khi khẳng định giữa chừng đỏ, làm đỏ lây
"[sổ nợ 57] GỠ HẲN policy" (2 hàng thay vì 1) ⇒ mỗi `it` khoản 99 dọn hàng cũ ở `finally`. ⑸ Bản đầu của đột biến M16 giữ client rồi gọi
`pool.query` trên pool một kết nối — đỏ vì cạn pool, không vì hành vi; viết lại để trả thân hàm về đúng bản trước bản vá. NÓI RA: lựa chọn
"so giá trị GUC để tránh huỷ oan khi DDL" của bản đầu KHÔNG được tự bắt — nó làm [INV-H21] đỏ, và test đích cùng trọn lượt tích hợp đều
không chạy cổng ấy; chỉ lượt soi 52 thấy.

**Đỏ đo được, cô lập (mã cuối, chạy một-một):**
Hai mươi hai đột biến trên mã cuối, chạy một-một, không đột biến nào đỏ do lỗi dựng; bước so byte với bản sao lưu sau lượt khớp cả bốn tệp đích. M1 lớp lấy client không xét `session_replication_role` ⇒ đỏ ở `it` replica · M2 không nhận `local` ⇒ đỏ ở đối chứng SET LOCAL + `local` · M3 không xét `row_security` ⇒ đỏ ở `it` row_security và `it` mặc định phiên · M4 không so search path hiệu lực ⇒ đỏ ở `it` search path và ranh giới DDL · M5 so với hằng `{public}` thay vì mốc của chính kết nối (Đ1) ⇒ đỏ ở `it` mặc định phiên search path và ranh giới DDL · M6 kết nối nhiễm trả về pool ⇒ đỏ ở năm `it` (lần lấy sau gặp lại kết nối nhiễm) · M7 không kiểm trạng thái giao dịch ⇒ đỏ ở `it` giao dịch bỏ ngỏ · M8 lần lấy đầu không xét tính chất (Đ2) ⇒ đỏ ở `it` mặc định phiên row_security · M9 chẩn đoán lần lấy đầu không nói mặc định phiên ⇒ đỏ ở chỗ ghim chữ · M10 lỗi là `Error` trần ⇒ đỏ ở năm chỗ ghim lớp lỗi · M11 đọc search path qua TÊN GUC (bản đầu) ⇒ đỏ ở [INV-H21] (`vai-tro.ts:111`) và ở ranh giới DDL — phép đo hành vi của bản đầu trên vế DDL · M12 bộ dọn bỏ khối chặn ⇒ đỏ ở hai `it` replica và census ⒝ · M13 khối chặn nhận replica ⇒ đỏ ở hai `it` replica và census ⒝ · M14 TP096 không thành `InvitationError` ⇒ đỏ ở hai `it` replica và census ⒝ (tệp mang khối chặn thiếu nhánh TP096) · M15 mọi lỗi COMMIT đội tên replica (Đ3) ⇒ đỏ ở đối chứng ánh xạ lỗi · M16 `donBucketNguoiGoiCu` về đúng thân bản trước bản vá (một `pool.query` tự commit) ⇒ đỏ ở `it` của nó (câu DELETE tự commit dưới replica, bộ dọn trả số hàng) và census ⒞ — bản đầu của đột biến này giữ client rồi gọi `pool.query` trên pool một kết nối và đỏ vì cạn pool, không vì hành vi, nên đã viết lại và chạy lại · M17 `donOtpRateLimitsCu` về COMMIT trần ⇒ đỏ ở `it` của nó và census ⒝ · M18 bộ dọn trả kết nối về pool sau lỗi ⇒ đỏ ở ba chỗ đo pid · M19 thông điệp TP096 quay về câu khai hại chưa xảy ra ⇒ đỏ ở chỗ ghim chữ · M20 một `createPool` sản xuất không truyền `role` ⇒ đỏ ở census ⒜ · M21 dựng `pg.Pool` ngoài nơi đã khai ⇒ đỏ ở census ⒜ · M22 thêm một COMMIT trần vào `migrate.ts` ⇒ đỏ ở census ⒝ (3 so với 2 đã khai).

**Ranh giới NÓI RA:** ⑴ Lỗi rơi vào lần lấy KẾ TIẾP của kết nối nhiễm — có thể là một yêu cầu khác, không phải mã đã làm nhiễm; không thử
lại (lượt soi 52 NHẸ-2). ⑵ Một câu TỰ commit chạy trọn trước khi lớp lấy client thấy gì; census ⒞ biến mỗi đường như thế thành một dòng khai
— hôm nay chỉ một câu CHỈ ĐỌC ở `rbac.ts`. ⑶ Search path so TƯƠNG ĐỐI qua `current_schemas(false)`: DDL đổi search path hiệu lực làm mỗi kết
nối pool bị huỷ một lần (test ghim), cấu hình máy chủ nạp lại cũng vậy (suy luận, chưa đo), và kết nối mới nhận mốc mới kể cả khi giá trị
mới là giá trị xấu — nguồn cấu hình do hardening khoản 92 canh lúc deploy; schema chưa tồn tại hay không có USAGE không đổi search path hiệu
lực nên không bị bắt (cùng ranh giới withTenant ⑵). ⑷ Pool không vai (`migrate()`, pool superuser của test-support) đứng ngoài lớp lấy
client; hai bộ dọn huỷ kết nối trên lỗi nên không trả kết nối hỏng về một pool như thế. ⑸ Census là bộ dò cách viết — đầu tệp liệt kê điểm
mù: biến pool không mang chữ "pool", lệnh dựng lúc chạy, nội suy template, `\n` viết thoát, tệp chưa track, đếm số lượng không đếm danh tính.
⑹ Khối chặn chép ở hai tệp; census ghim văn bản và nhánh TP096, không ghim phần còn lại của xử lý lỗi (lượt soi 52 INFO-7). ⑺ GUC phiên khác
ba GUC này và trạng thái phiên ngoài GUC không được đọc — khoản 104 (đo: ba GUC thời gian IM7 đi theo kết nối); pool ứng dụng không có listener
`'error'` — khoản 103 (đo: tiến trình thoát khi kết nối rảnh bị ngắt).

**Thăm dò cho hai khoản mở (S1.59, PostgreSQL 16, pg 8.23.0, tệp thăm dò xoá ngay sau khi chạy):** ⑴ pool một kết nối mang `options` ba GUC
IM7 của `createPool`; một lần lấy `SET` cả ba về `0` ở phạm vi phiên ⇒ lần lấy kế, cùng pid, đọc `0/0/0` thay vì `15s/15s/1min`. ⑵ tiến
trình con dựng `pg.Pool` một kết nối, lấy rồi trả client; superuser `pg_terminate_backend` backend rảnh ấy ⇒ tiến trình con thoát mã 1 với
`Unhandled 'error' event`; cùng kịch bản có `pool.on('error', …)` ⇒ tiến trình sống, listener nhận 57P01. Cả hai đo trên `pg.Pool` trần cùng
tuỳ chọn, không trên tiến trình `api` thật; phần "`createPool` và composition không gắn listener" là đọc mã.

### Lượt soi đối kháng 52 (trên bản đầu): 0 CAO, 1 NẶNG, 3 NHẸ, 7 INFO — mọi phát hiện có xử lý; ba đề xuất không theo, một đề xuất ghi thành khoản mới, lý do trong bảng

| # | Mức | Phát hiện | Kiểm | Xử lý |
|---|---|---|---|---|
| NẶNG-1 | NẶNG | Câu kiểm mới đọc `pg_catalog.current_setting('search_path')` ⇒ [INV-H21] đỏ — cổng chỉ cho `migrate.ts` nêu tên ấy, và câu được miễn không được nêu `pg_catalog`. Hai lối sửa nhanh đều hỏng: bỏ `pg_catalog.` thì phép kiểm mù dưới đúng search path nhiễm; truyền tên qua tham số là lách lint bằng cách viết che tên. `pnpm t0` không thấy; test đích và lượt tích hợp đầy đủ của vòng này cũng không chạy cổng ấy | **đúng — đo** (`pnpm test`: một đỏ duy nhất, `packages/db/src/vai-tro.ts:84`) | đọc search path HIỆU LỰC qua `current_schemas(false)` — cùng cách đọc của withTenant ⑵, không nêu tên GUC; [INV-H21] xanh; đột biến M11 (đọc lại tên GUC) đỏ ở [INV-H21] và ở test ranh giới DDL. **Không theo đề xuất tách [INV-H21] thành vế đọc/vế ghi**: nới một cổng đang giữ tiền đề của cả lớp ca cướp để chứa một câu đọc, trong khi đã có cách đọc không chạm cổng; cái giá — search path hiệu lực đổi theo DDL — ghim thành ranh giới bằng test |
| NHẸ-1 | NHẸ | Mốc theo lần lấy đầu không phân biệt nguồn: cấu hình máy chủ nạp lại làm mỗi kết nối pool ném một lần kèm chẩn đoán "phạm vi phiên"; mặc định phiên xấu (`ALTER ROLE app_api_login SET row_security = off`) làm mọi lần lấy đầu ném kèm chẩn đoán sai; đề xuất phán theo `pg_settings.source`/`reset_val` | đúng — đọc; vế mặc định phiên đo | lần lấy đầu mà tính chất xấu ⇒ thông điệp nói MẶC ĐỊNH PHIÊN, chưa câu nào chạy trên kết nối (test ghim, đột biến M9); lần lấy sau thì thông điệp nêu cả nguồn DDL / cấu hình nạp lại; mặc định phiên search path hợp lệ khác mặc định máy chủ giữ kết nối (test ghim, đột biến M5). **Không theo trong vòng này đề xuất phán theo nguồn**: một lần quét `pg_show_all_settings()` ở MỖI lần lấy client chưa được đo giá, và cơ chế ấy phủ rộng hơn ba GUC — ghi thành khoản 104 |
| NHẸ-2 | NHẸ | Lỗi là `Error` trần mà mọi chỗ ghi log chỉ ghi tên lỗi ⇒ tín hiệu vô hình; không thử lại nên người gọi vô tội chịu lỗi | đúng — đọc | lớp `KetNoiNhiemError` (tên riêng, xuất qua barrel; test ghim `name`; đột biến M10). **Không theo đề xuất thử lại một lần**: lần thử lại im lặng xoá đúng tín hiệu mà lớp tồn tại để phát ra; lỗi giới hạn một lời gọi mỗi kết nối nhiễm |
| NHẸ-3 | NHẸ | Census ⒝ miễn theo TỆP cho `migrate.ts` (khuôn H14-M1); `COMMIT -- ghi chú`, `/* … */ COMMIT`, `end` viết thường lọt bộ dò | đúng — đọc | miễn theo SỐ LƯỢNG cho ⒜ và ⒝ (đột biến M22: thêm một COMMIT trần vào `migrate.ts` ⇒ đỏ); bộ quét SQL trái-sang-phải bỏ chú thích, hằng nháy đơn và thân dollar-quote; `end` viết thường tính khi hằng là đối số đầu của `.query(`; mỗi vế một đối chứng văn bản giả |
| INFO-1 | INFO | Hai bộ dọn trả kết nối về pool sau lỗi — replica đặt trước BEGIN trên pool không vai sống tiếp | đúng — đọc; bản trước đo được (pid giữ nguyên sau lỗi) | bộ dọn huỷ kết nối trên mọi lỗi (test đo pid ở cả ba `it`; đột biến M18) |
| INFO-2 | INFO | Lần lấy client không phát hiện kết nối trả về khi đang mở giao dịch — `SET ROLE` chạy bên trong giao dịch cũ | đúng — bản trước đo được (lời gọi không ném) | `getTransactionStatus()` đọc trước `SET ROLE`, không vòng đi-về (test ghim; đột biến M7) |
| INFO-3 | INFO | Lần lấy client không đọc bốn GUC `app.*` — bộ dọn `caller_rate_limits` xoá 0 hàng dưới GUC khách rò | đúng — đọc | gộp vào khoản 104: phép phân biệt mặc định phiên / rò phiên của withTenant (RESET rồi đọc lại, khoản 87) không đặt được ở lần lấy client mà không đổi hành vi ấy; withTenant bắt rò ở BEGIN kế trên cùng kết nối |
| INFO-4 | INFO | Đột biến sống: so với một hằng (Đ1); bỏ tính chất ở lần lấy đầu (Đ2); mọi lỗi COMMIT đội tên replica (Đ3); tách DO và COMMIT làm hai lời gọi (Đ4) | đúng — đọc | ba test mới giết Đ1 (M5), Đ2 (M8), Đ3 (M15). Đ4 để census canh: ở hai bộ dọn, tách DO và COMMIT làm hai lời gọi TƯƠNG ĐƯƠNG về hành vi (DO ném thì COMMIT không được gọi) — "cùng câu" chỉ chịu lực khi có mã xen giữa hai lời gọi, nên census ghim văn bản |
| INFO-5 | INFO | Điểm mù census: tệp chưa track, `role: undefined`, đổi tên import, đếm số lượng không đếm danh tính | đúng — đọc | `role: undefined` và đổi tên import nay đỏ (đối chứng văn bản giả); tệp chưa track, đếm số lượng không đếm danh tính, và hằng viết `\n` thoát ghi thành ranh giới ở đầu tệp census |
| INFO-6 | INFO | Thông điệp TP096 khai "đã bị bỏ qua" một hại chưa xảy ra | đúng — đọc | thông điệp mới; test ghim chữ cũ không còn (đột biến M19) |
| INFO-7 | INFO | Hai bản chép ⑴ và hai ngữ nghĩa ⑵ đã trôi nhau ở phần xử lý lỗi | đúng một phần — đọc | ⑵ nay cùng cách đọc search path với withTenant (NẶNG-1); census ⒝ đòi tệp mang khối chặn có nhánh so TP096 (đột biến M14 đỏ cả ở census); bộ dọn huỷ kết nối trên mọi lỗi (INFO-1). **Không theo đề xuất hàm dùng chung**: đòi một cạnh gói mới (`invitation` không phụ thuộc `tenancy`, `tenancy` không phụ thuộc `@trustprocure/db`) cho một hằng và một phép ánh xạ lỗi |

**Điều đáng mang sang vòng sau:** ⑴ `pnpm test:int` không gồm cổng kiến trúc — một câu SQL sản xuất mới phải qua trọn `pnpm test` trước
lượt soi; NẶNG-1 sống qua test đích và trọn lượt tích hợp. ⑵ Khi một lựa chọn thiết kế (so giá trị GUC để tránh huỷ oan) va một cổng có sẵn,
chọn cách đọc không chạm cổng và ghim cái giá bằng test ranh giới — không nới cổng để chứa lựa chọn. ⑶ Đột biến phải đỏ vì HÀNH VI: đọc lý do
đỏ, không chỉ đếm — một đột biến làm cạn pool một kết nối đỏ vì lý do khác. ⑷ Mục "mang sang" của lượt soi vào sổ nợ sau một thăm dò riêng:
khoản 103 và 104 mỗi khoản có một vế đo trước khi ghi.

# §S1.60 — khoản nợ 80: nhân chứng hành vi so GIÁ TRỊ (vế ⒠) và đo dưới vai ứng dụng theo danh sách trắng — lượt soi 53

**Bề mặt:** chỉ mã test — harness nhân chứng của `[INV-H19]` trong `db/hardening-suy-tu-tinh-chat.int.test.ts`; không dòng mã sản xuất, không
migration. `SoNhanChung.chung` (tiền điều kiện khai và vế ⒠ sau ⒞′), `NhanChung.khai`/`docLai`, `KHAC_NULL`/`giaTriKhop`/`jsonOnDinh`/
`hienGiaTri`, `SoNhanChung.chuaCoNhanChung` (danh sách trắng thay danh sách đen), `NHAN_CHUNG_DUOI_CHU`, `kiemDanhSachDuoiChu`,
`cauDuoiAppUnseal`, `cauDuoiPhienKhach`, `dungKichBan` (viết lại). Lớp này là cổng đo của hardening: một nhân chứng ghi công sai thì một hàm
canh khai sai là KHÔNG-CANH đi qua tổng điều tra — khoản 74 dựng nó để chặn đúng chiều ấy.

**Đo trước khi viết (test viết trước, chạy trên harness cũ, PostgreSQL 16):** trọn tệp 35 test, 4 đỏ. ⒜ `it` vế ⒠ — trigger BEFORE ROW
`RETURN OLD` trên UPDATE, dưới `app_api`, câu RETURNING `g` và khai `g = 'b'` ⇒ `chung()` KHÔNG ném (đỏ ở "bản trước bản vá: RETURN OLD cho
rowCount 1 và nhân chứng ghi công"). ⒝ `it` danh sách trắng — hàm từ chối khi `current_setting('is_superuser') <> 'on'`, vị từ `nhay_vai`
không thấy nó (tiền đề khẳng định trong test) ⇒ nhân chứng dưới superuser đi qua ngắn mạch và `chuaCoNhanChung` trả rỗng (đỏ ở "bản trước
bản vá: superuser được ghi công cho hàm lách regex"). ⒞ test nhân chứng chính và `it` tự đối chiếu đỏ vì `ReferenceError` (`VAI_UNG_DUNG`,
`NHAN_CHUNG_DUOI_CHU` chưa có) — đỏ cấu trúc, không phải hành vi; hành vi của hai vế ấy đo bằng đột biến. ⒟ Thăm dò catalog trước khi viết
kịch bản: quyền ghi theo cột của `app_api`/`app_unseal` trên 27 bảng có trigger, quyền SELECT theo cột (cột mà RETURNING chạm được), policy
khách RESTRICTIVE, và thân các hàm của tập rộng.

**Hình dạng:** ⒜ Vế ⒠ nằm TRONG `chung()`, không ở kịch bản: INSERT/UPDATE thiếu `khai` thì ném trước `BEGIN`; sau ⒞′, số hàng để so phải
bằng `rowCount`, mỗi cột khai phải có mặt trong mỗi hàng, `giaTriKhop` so từng hàng — lệch thì ném trong giao dịch, ROLLBACK, không ai được
ghi công. Hàng để so là RETURNING của câu; khi vai nhân chứng không SELECT được bảng (`app_unseal` trên `rfq_unsealed_bids`), `docLai` chạy
sau `SET LOCAL ROLE NONE` trong cùng giao dịch. `giaTriKhop` so theo kiểu `pg` đọc ra: `Buffer` so byte, `Date` so mốc, đối tượng so JSON sắp
khoá, NULL chỉ bằng NULL, `KHAC_NULL` chỉ đòi khác NULL, còn lại so chuỗi. ⒝ Danh sách TRẮNG vai: hợp lệ khi một nhân chứng có
`current_user` thuộc `VAI_UNG_DUNG` (hằng của `@trustprocure/db`, cùng nguồn với `ganVaiTroChoPool`); chủ sở hữu chỉ được cho cặp (bảng, sự
kiện) khai kèm lý do trong `NHAN_CHUNG_DUOI_CHU`, và không bao giờ cho hàm `nhay_vai` — vị từ regex thành đối chứng, không còn là cổng.
⒞ Danh sách tự kiểm hai chiều: `kiemDanhSachDuoiChu` — mỗi cặp có trigger trong tập rộng, và không vai ứng dụng nào có quyền ghi ở cặp ấy
(`has_any_column_privilege`/`has_table_privilege`, tính cả thừa kế); test nhân chứng chính — bộ ba chỉ có nhân chứng dưới chủ sở hữu thì cặp
của nó phải được khai, và mỗi cặp khai phải có bộ ba như thế. ⒟ `dungKichBan`: nhân chứng dưới `app_api` + `app.org_id` (đường `withTenant`),
dưới `app_unseal` cho bản rõ và UNSEALED (đường `unseal-worker`), dưới `app_api` + ba GUC khách cho phiên bản báo giá (đường
`withGuestSession`); cột đặt là cột vai ấy được cấp, RETURNING là cột vai ấy SELECT được; câu trên bảng không có trigger ở sự kiện ấy (tổ
chức, người dùng, luồng báo giá, việc outbox, liên kết đăng nhập, hồ sơ TOTP) và phiên của từng người (đường `app_api` đòi TOTP đã xác
nhận) là câu dựng dưới chủ sở hữu, ngoài `chung()`.

**Test (`db/hardening-suy-tu-tinh-chat.int.test.ts`, describe `[INV-H19]`):**
- **`[khoản nợ 80] VẾ ⒠`** — bảng tạm với hàm đảo (UPDATE `RETURN OLD`; INSERT gán lại `g` ở hàng id chẵn), dưới `app_api`: UPDATE ⇒ ném nêu
  "vế ⒠" và "cột g"; INSERT ⇒ ném; `luc = now()` khai `KHAC_NULL` mà `RETURN OLD` giữ NULL ⇒ ném nêu "cột luc trả về null, khai khác NULL";
  câu hai hàng mà chỉ hàng THỨ HAI bị sửa ⇒ ném; không ai được ghi công; bảng chỉ còn hàng mẫu. ĐỐI CHỨNG: hàm trả `NEW` nguyên vẹn ⇒ ghi
  công ở INSERT và UPDATE. Câu thiếu khai ⇒ "thiếu vế ⒠"; khai mà không RETURNING ⇒ nêu RETURNING; RETURNING bỏ sót một cột khai NULL ⇒
  "không RETURNING cột luc".
- **`[khoản nợ 80] vế ⒠ so theo kiểu pg`** — bảng chân trị cho `giaTriKhop`: bytea, timestamptz, jsonb không theo thứ tự khoá, numeric như
  chuỗi, NULL/undefined, `KHAC_NULL`.
- **`[khoản nợ 80] DANH SÁCH TRẮNG VAI`** — ⑴ hàm lách regex: superuser không được ghi công, dưới `app_api` chính hàm ấy từ chối (`where`);
  ⑵ hàm không đọc vai: superuser không đủ, cặp khai thì đủ, `app_api` thì đủ; ⑶ hàm nhạy vai trên cặp đã khai vẫn bị nêu.
- **`[khoản nợ 80] danh sách trắng TỰ ĐỐI CHIẾU`** — danh sách thật sạch; khai `rfq_budgets/UPDATE` (app_api ghi được),
  `rfq_unsealed_bids/INSERT` (app_unseal ghi được), `organizations/INSERT` (không trigger) ⇒ mỗi cặp đúng một dòng.
- **Test nhân chứng chính** — kịch bản mới xanh, `chuaCoNhanChung` rỗng, danh sách trắng khít hai chiều, tự đối chiếu sạch.
- **Ba test đột biến cũ** (`[sổ nợ 74] ĐỘT BIẾN`, `[khoản nợ 77]` nuốt INSERT, `[khoản nợ 77]` DEFERRED) khai vế ⒠ và, với bảng tạm, danh
  sách trắng cục bộ — chúng đo ⒞, ⒞′ và cửa sổ, không đo vai; kỳ vọng chuỗi của `[sổ nợ 74] ĐỘT BIẾN` mang hậu tố vai mới.

**Tự bắt, không phải lượt soi:** ⑴ Lượt đo đầu sau bản vá: `it` vế ⒠ đỏ ở tiền đề "RETURN OLD giữ giá trị cũ" — hàng mẫu chèn SAU khi gắn
trigger nên chính nhánh INSERT của hàm đảo đã sửa nó; mọi khẳng định vế ⒠ trước đó xanh ⇒ chèn hàng mẫu trước trigger. ⑵ Khi dựng danh sách
đột biến: bỏ kiểm cột có mặt, cho `KHAC_NULL` khớp mọi giá trị, chỉ so hàng đầu, và năm nhánh kiểu của `giaTriKhop` đều KHÔNG có test nào
bắt ⇒ thêm ba khẳng định vào `it` vế ⒠ và `it` bảng chân trị TRƯỚC khi chạy lượt đột biến (khai thiếu cột với giá trị NULL là ca `undefined`
"khớp" NULL — lỗ thật nếu không kiểm có mặt). ⑶ Kịch bản dưới vai ứng dụng xanh ở lượt đo đầu: mọi câu đặt đúng cột đã cấp và RETURNING đúng
cột SELECT được, theo bảng thăm dò.

**Đỏ đo được, cô lập (mã cuối, chạy một-một, nhóm test khoản 80 cộng test nhân chứng chính):**
Hai mươi ba đột biến trên mã cuối, chạy một-một trên nhóm test khoản 80 cộng test nhân chứng chính (lọc tên); đối chứng không đột biến xanh trước lượt; không đột biến nào đỏ do lỗi dựng; sau lượt, sha256 của tệp đích khớp bản gốc. M1 bỏ đòi khai vế ⒠ ⇒ đỏ ở `it` vế ⒠ (câu thiếu khai không ném) · M2 bỏ khối so giá trị ⇒ đỏ ở `it` vế ⒠ (`RETURN OLD` được ghi công) · M3 bỏ phép so số hàng để so ⇒ đỏ ở `it` vế ⒠ (khai mà không RETURNING vẫn qua) · M4 bỏ kiểm cột khai có mặt ⇒ đỏ ở `it` vế ⒠ (cột khai NULL mà RETURNING bỏ sót vẫn qua) · M5 `KHAC_NULL` khớp mọi giá trị ⇒ đỏ ở `it` vế ⒠ (`RETURN OLD` giữ NULL) và ở bảng chân trị · M6 chỉ so hàng đầu ⇒ đỏ ở `it` vế ⒠ (hàng thứ hai bị sửa) · M7 bytea so kiểu, không so byte · M8 bỏ nhánh Date · M9 JSON không sắp khoá · M10 bỏ so lỏng chuỗi-số · M11 NULL khớp mọi giá trị ⇒ mỗi đột biến đỏ ở đúng dòng của bảng chân trị · M12 vai nào cũng tính là vai ứng dụng ⇒ đỏ ở `it` danh sách trắng ⑴ (superuser được ghi công cho hàm lách regex) · M13 danh sách trắng miễn hàm nhạy vai ⇒ đỏ ở `it` danh sách trắng ⑶ · M14 bỏ danh sách trắng ⇒ đỏ ở test nhân chứng chính (tám bộ ba của năm cặp thiếu nhân chứng hợp lệ) và ở `it` danh sách trắng ⑵ · M15 thêm cặp `rfq_budgets/UPDATE` ⇒ đỏ ở test nhân chứng chính (mục chết) và ở `it` tự đối chiếu · M16 bỏ cặp `user_roles/UPDATE` ⇒ đỏ ở test nhân chứng chính (hai bộ ba chỉ có nhân chứng dưới chủ sở hữu) · M17 đối chiếu catalog không hỏi quyền · M18 chỉ hỏi `app_api` · M19 bỏ vế mục chết ⇒ mỗi đột biến đỏ ở đúng khẳng định của `it` tự đối chiếu · M20 nhân chứng `rfq_budgets/UPDATE` về chủ sở hữu · M21 bản rõ ghi dưới chủ sở hữu thay vì `app_unseal` ⇒ đỏ ở test nhân chứng chính (bộ ba ấy thiếu nhân chứng hợp lệ) · M22 `docLai` không trả vai về chủ sở hữu ⇒ đỏ ở test nhân chứng chính (`permission denied for table rfq_unsealed_bids`) · M23 bỏ qua `docLai` ⇒ đỏ ở test nhân chứng chính (câu báo 1 hàng, 0 hàng để so). **Đo ranh giới, không phải đột biến đỏ:** M24 — `cauDuoiPhienKhach` chỉ đặt `app.org_id`, bỏ ba GUC khách ⇒ XANH: không hàm trigger nào của `vendor_bid_versions` đọc GUC khách, và policy RESTRICTIVE khách chỉ thu hẹp; ba GUC giữ để kịch bản giống đường `withGuestSession`, không chịu lực cho phép đo.

**Đo lại INFO-10 (lượt soi 25a):** trước bản vá 72 bộ ba được ghi công, 63 chỉ dưới superuser, 9 có nhân chứng dưới `app_api`. Sau bản vá (bản sao tạm không track của tệp in sổ ghi công ngay sau khẳng định khít, chạy riêng test nhân chứng chính, xoá bản sao): vẫn 72 bộ ba được ghi công; đúng 8 chỉ dưới chủ sở hữu — `rfq_items_chi_sua_khi_soan` ở `rfq_items` UPDATE và DELETE, `kiem_tra_ma_tran_quyen` và `kiem_tra_nguong_khong_cung_tay_vai_tro` ở `role_permissions` INSERT và UPDATE, `kiem_tra_nguong_khong_cung_tay_nguoi_dung` và `kiem_tra_phan_tach_nhiem_vu` ở `user_roles` UPDATE, tức tám bộ ba của năm cặp khai; 64 có nhân chứng từ vai ứng dụng — 62 dưới `app_api`, 4 dưới `app_unseal`, hai bộ ba có cả hai.

**Ranh giới NÓI RA:** ⑴ Giá trị máy chủ sinh khai `KHAC_NULL`: bắt `RETURN OLD` giữ NULL (đo), không bắt một giá trị khác NULL bị thay bằng
giá trị khác NULL khác. ⑵ UPDATE không đổi giá trị (`SET role_code = role_code`, `SET permission_code = permission_code` — hai nhân chứng AFTER
ROW của danh sách trắng) không có gì để so; vế ⒠ ở đó chỉ nói hàng trả về là hàng câu nhắm tới. ⑶ Cột khác nhau giữa các hàng của một câu
nhiều hàng (`rfq_items` hai dòng) không khai; cột vai nhân chứng không SELECT được (`wrapped_private_key`, `envelope`) không khai. ⑷ `docLai`
đọc theo khoá kịch bản nêu, dưới chủ sở hữu. ⑸ Vế ⒠ so cột ĐÃ KHAI — một trigger sửa một cột mà câu không đặt (hay đặt mà không khai) thì vế
⒠ không nói gì về cột ấy. ⑹ Danh sách trắng dựa trên quyền catalog của hai vai ứng dụng; đường ghi qua hàm SECURITY DEFINER không hiện ở
`has_*_privilege`. ⑺ Ba GUC khách của nhân chứng phiên bản báo giá không chịu lực — đo (M24): bỏ cả ba, kịch bản vẫn xanh; chúng giữ để kịch bản giống đường `withGuestSession`.

**Lượt soi đối kháng 53** — một người soi độc lập, CHỈ ĐỌC, trên bản chụp của tệp test (bản trong worktree đang bị lượt đột biến sửa rồi
trả), cùng diff, danh sách đột biến, bảng thăm dò catalog và mã sản xuất: **0 CAO, 0 NẶNG, 3 NHẸ, 3 INFO**. Người soi không tìm được thay
đổi có hại nào mà không test nào bắt.

| Mã | Phát hiện | Xử lý |
|---|---|---|
| NHẸ-1 | Tên `it` của test nhân chứng chính còn nói "hàm đọc vai thì dưới vai không superuser" — mô tả luật danh sách đen cũ, không phải luật đang kiểm | **Sửa:** tên `it` nói nhân chứng dưới một vai ứng dụng, chủ sở hữu chỉ cho cặp khai trong danh sách trắng, hàm nhạy vai không được miễn |
| NHẸ-2 | `VaiDo.sieu` (`rolsuper`) vẫn được đo mà không dòng nào đọc; docstring ⑷ vẫn nói nhân chứng ghi lại `rolsuper` — người soi sau dễ tưởng còn một tầng theo superuser | **Sửa:** bỏ trường khỏi `VaiDo` và cột khỏi câu đo vai; gạch vế ấy ở ⑷ |
| NHẸ-3 | Chú thích "kịch bản thật vẫn ghi công đủ 21 hàm kia" thiu từ khi tập hàm mở ra INSERT (S1.32) | **Sửa:** gạch con số cứng |
| INFO-1 | Vế ⒠ không canh được cột mà một hàm KHÔNG-CANH sửa hợp lệ: `outbox_jobs_xoa_payload_dang_nhap` gán `payload := '{}'`, nên nhân chứng không khai được `payload`, và một thân hàm thôi xoá payload vẫn xanh ở test này | **Không đổi — đối chiếu độ phủ:** việc xoá payload có test riêng ở `apps/api/src/auth.int.test.ts` (job LOGIN_LINK_SEND đã xong không còn payload khác `{}`, không còn địa chỉ trong payload; gỡ trigger thì payload giữ nguyên) và `db/migrations.int.test.ts` (khôi phục trigger ⇒ payload về `{}`). `[INV-H19]` chỉ đòi phân loại KHÔNG-CANH, và phân loại ấy đúng |
| INFO-2 | Chú thích "dưới app_api, như tiến trình ghi sổ" nói quá: sản xuất ghi sổ qua hàm `audit_append()`, kịch bản INSERT thẳng | **Sửa:** chú thích nói cùng vai và cùng trigger, không cùng câu |
| INFO-3 | Vế so lỏng chuỗi-số của `giaTriKhop` — người soi xác nhận không khai thác được: kiểu do cột quyết định, và bảng chân trị ghim `"100000000.00"` khác `"100000000"` | **Không đổi** |

**Người soi đã soi mà không ra lỗ (lời của người soi, đọc mã):**
- Hàm trigger SECURITY DEFINER: không có — hardening cấm `prosecdef`, nên đòi vai ứng dụng có nghĩa (trigger chạy dưới đúng vai ghi).
- `VAI_UNG_DUNG` phủ mọi vai sản xuất: hai vai đăng nhập `SET ROLE` về `app_api`/`app_unseal`.
- `kiemDanhSachDuoiChu` tính cả quyền qua PUBLIC và qua membership.
- Mọi cột mà câu kịch bản đặt đều được khai, trừ cột do trigger dẫn xuất.
- Mọi `SET LOCAL`/`set_config(…, true)` có phạm vi giao dịch, nên GUC khách không rò sang nhân chứng sau.
- Thứ tự tiền điều kiện → ⒞′ → ⒠ → COMMIT → ghi công đúng; `chiDuoiChu` khít hai chiều.
- Vai và GUC của kịch bản khớp `unseal-worker`, `withGuestSession`, `permissions.ts`, `procurement-policy.ts`.

**Mang sang của người soi:**
- Độ phủ việc xoá payload — đã đối chiếu, xem INFO-1.
- Ba GUC khách không chịu lực — đã đo (M24), ghi ở ranh giới ⑺.

**Đo lại sau vòng sửa, trên mã cuối:** trọn tệp H19 xanh 36/36; hai mươi ba đột biến chạy lại một-một cho đúng kết quả của lượt trước vòng sửa — M1–M23 đỏ ở đúng test, M24 xanh — đối chứng không đột biến xanh, sha256 của tệp đích khớp bản gốc sau lượt.

**Điều đáng mang sang vòng sau:** ⑴ Viết danh sách đột biến TRƯỚC khi coi test là đủ: ba vế và năm nhánh kiểu lộ ra không có test nào bắt
chỉ nhờ tự hỏi "đột biến này đỏ ở đâu". ⑵ Fixture của một test về trigger phải dựng hàng mẫu trước khi gắn trigger — nếu không, tiền đề đọc
lại chính hành vi đang đo. ⑶ Thăm dò quyền cột và SELECT trước khi đổi vai kịch bản giúp kịch bản dưới vai ứng dụng xanh ngay lượt đầu.

# §S1.61 — khoản nợ 70: `supplier_contacts.email` ở chữ thường — CHECK của 048 cộng một lượt đối chiếu fail-closed, nói thật cả dưới vai deploy mà RLS áp — lượt soi 54, khoản 105 mở

**Bề mặt:** `db/migrations/049_email_lien_he_chu_thuong.sql` — một khối DO đối chiếu dữ liệu có sẵn, rồi (trong khối con bắt
`check_violation`) `ALTER TABLE public.supplier_contacts ADD CONSTRAINT supplier_contacts_email_chu_thuong CHECK (email = lower(email))`.
Không đổi dòng TypeScript sản xuất nào. Test: `db/unique-oracle.int.test.ts` (describe `[khoản nợ 70]`, sáu `it`), `db/migrations.int.test.ts`
(hàm `truoc049` và ba `it` `[khoản nợ 70]`, cộng `049_…` vào ba danh sách migration mong đợi). Đích của cột: địa chỉ nhận magic link của
người liên hệ nhà cung cấp — hai hàng biến thể hoa-thường là hai đường link hợp lệ tới cùng một hộp thư.

**Đo trước khi viết (test viết trước, kho chưa có 049, PostgreSQL 16):** ⒜ ba `it` ràng buộc đỏ theo HÀNH VI — ràng buộc không tồn tại;
`INSERT` `Solo@corp.com` đứng một mình VÀO; `Cap@corp.com` cạnh `cap@corp.com` của cùng nhà cung cấp VÀO; `it` đối chứng xanh. ⒝ `it` đối
chiếu đỏ CẤU TRÚC (chưa có `049`). ⒞ Thăm dò (tệp test tạm không track, xoá ngay) trên đúng ảnh `startPostgres()` ghim — PostgreSQL 16.15,
Alpine/musl, `en_US.utf8`; Node 24.18, ICU 78.3 — mọi điểm mã 1…0x10FFFF trừ surrogate: `lower()` máy chủ hạ 1364, `.toLowerCase()` hạ
1488; máy chủ hạ mà JS không hạ: 0; chuỗi JS hạ mà máy chủ còn hạ tiếp: 0; cùng hạ mà khác kết quả: 1 (`U+0130`, kết quả JS vẫn là điểm
bất động của máy chủ).

**Bản một và lượt soi 54.** Bản một: khối DO đếm hàng chưa ở chữ thường và hàng va khoá, RAISE với tối đa 20 id, rồi `ALTER` trần. Xanh trên
trọn `migrations.int` 112/112, `unique-oracle` 11/11, `suppliers.int` 19/19, `pnpm test` 742/742; bảy đột biến đỏ. Lượt soi 54 (bảng dưới)
tìm ra hai NẶNG trên chính bản ấy.

**Đo cho NẶNG-1 (thăm dò S1.61, tệp tạm):** bảng do vai `zz_chu70` sở hữu, `ENABLE` + `FORCE`, policy lọc hết khi không gắn `app.org_id`;
dưới `SET LOCAL ROLE zz_chu70` (`row_security_active` = true): câu đếm vi phạm ra 0 (superuser thấy 1); `ALTER … ADD CHECK` NÉM 23514
`is violated by some row`; `ADD … NOT VALID` rồi `VALIDATE CONSTRAINT` cũng NÉM 23514; khối DO bắt `check_violation` và ném lại được. Nên
lượt kiểm ràng buộc KHÔNG chịu RLS — fail-closed ở hồ sơ N3 giữ, NẶNG-1 không lên CAO — nhưng thông điệp trần không nói gì. Test N3 thật
(`dungRoleTrienKhaiThuong`, `trien_khai` là chủ `supplier_contacts` có EXECUTE trên `app_current_org_id()`) chạy trên bản một nhận đúng
thông điệp trần ấy (đỏ ở khẳng định nguyên văn của bản hai).

**Hình dạng (bản hai):** ⒜ ĐỐI CHIẾU TRƯỚC `ALTER`, cùng giao dịch tệp: hàng `email <> lower(email)`; nếu có — tối đa 20 id theo thứ tự uuid;
số NHÓM (tổ chức, nhà cung cấp, `lower(email)`) có từ hai hàng và ít nhất một hàng chưa ở chữ thường, mỗi nhóm kèm mọi id (tối đa 10 nhóm);
RAISE `check_violation` — không email, không dữ liệu cá nhân nào, và kèm lối ra: sửa tay dưới vai mà RLS không áp, mỗi thay đổi một sự kiện
kiểm toán. ⒝ KHÔNG tự hạ, kể cả hàng không va khoá: đổi đích magic link đã lưu là quyết định có người chịu. ⒞ `ALTER` trong khối con bắt đúng
`check_violation` và ném lại: vai đang chạy, số hàng vai ấy thấy, `row_security_active`, và phải chạy lại dưới vai nào — đúng ca N3 mà khối
đối chiếu đếm 0. ⒟ `CHECK` không `NOT VALID`. ⒠ `049` ghi đánh đổi phần trước `@` thành quyết định của sản phẩm (S1.3) và quy trình sửa tay.

**Test:**
- **`db/unique-oracle.int.test.ts`, describe `[khoản nợ 70]` (sáu `it`):** ràng buộc TỒN TẠI và `convalidated`; chữ hoa đứng một mình bị từ
  chối; cặp hoa-thường không dựng được, chữ thường lần hai `duplicate key`; đối chứng chữ thường và cùng địa chỉ ở nhà cung cấp khác; [lượt
  soi 54] một chữ hoa NGOÀI ASCII mà máy chủ gấp được bị từ chối — TỰ HIỆU CHUẨN; [lượt soi 54] tính chất trên CHÍNH môi trường đang chạy:
  không điểm mã nào máy chủ hạ mà JS để nguyên, không chuỗi JS đã hạ mà máy chủ còn hạ, và `lower()` máy chủ gấp được nhiều hơn ASCII.
- **`db/migrations.int.test.ts` (ba `it`, dựng qua `truoc049`):** ⑴ hai mươi hàng chữ hoa đứng một mình, một cặp hoa-thường, cùng địa chỉ chữ
  thường ở nhà cung cấp thứ hai ⇒ `migrate()` NÉM với thông báo so NGUYÊN VĂN (21 hàng, đúng 20 id đầu, một nhóm kèm hai id), `049` không
  được ghi, hàng giữ nguyên; sửa tay ⇒ đi qua, ràng buộc `convalidated`; ⑵ CHỈ một hàng chữ hoa đứng một mình cạnh một hàng chữ thường ⇒
  NÉM nguyên văn (1 hàng, 0 nhóm), địa chỉ nguyên văn, không ghi; ⑶ hồ sơ N3 ⇒ NÉM nguyên văn nêu `trien_khai`, 0 hàng, `row_security_active
  = true`, không ghi, không ràng buộc, địa chỉ nguyên văn; chạy lại dưới superuser ⇒ thông báo định danh.
- **Chạy lại trên bản hai:** trọn `db/migrations.int.test.ts` 114/114 (ba `it` khoản 70 và ba danh sách migration mong đợi), `db/unique-oracle.int.test.ts` cùng `packages/supplier/src/suppliers.int.test.ts` 32/32, trọn `pnpm test` 48 tệp / 742 test (cổng kiến trúc, hình dạng migration); eslint và tsc thoát mã 0.

**Tự bắt, không phải lượt soi:** ⑴ Script chèn test đầu tiên dừng ở mốc thứ hai (thụt 8 dấu cách so với 6) SAU khi đã ghi tệp thứ nhất —
nửa chừng; chèn phần còn lại bằng script riêng; bài học đã ghi vào bộ nhớ: kiểm mọi mốc ở mọi tệp trước khi ghi tệp nào (script bản hai làm
đúng như vậy). ⑵ Một heredoc Python dài hỏng ở bước bash dịch lệnh — đo lại, không tệp nào đổi. ⑶ Khi dựng đột biến bản một: vị từ va khoá
quên `supplier_id` sẽ SỐNG với fixture một nhà cung cấp ⇒ thêm nhà cung cấp thứ hai TRƯỚC lượt đột biến. ⑷ Bản hai lần chạy đầu NÉM
`collations are not supported by type integer`: `ORDER BY 1 COLLATE "C"` biến số thứ tự cột thành một hằng số nguyên — sắp theo
`min(id::text) COLLATE "C"`, cùng thứ tự với chuỗi nhóm. ⑸ `pnpm evidence` lần đầu ĐỎ ở `[INV-H20]` (vitest thoát mã 1): P4 giải
con trỏ sổ nợ TRONG TẬP TỆP GIT THEO DÕI, mà `049` khi ấy chưa track ⇒ ba hàng 70, 71, 105 trỏ vào khoảng không. Track xong thì P9b đỏ
tiếp: `Handoff.md` vẫn khai `48 migration đánh số` trong khi kho có 49 — bộ tài liệu S1.61 đã quên lời khai ấy. Sửa: lời khai `[S1.61] 49`,
lời cũ gạch NGOÀI mẫu `**… migration đánh số**`. Đo: gạch CẢ CỤM (`~~**[S1.28] 48 migration đánh số**~~ **[S1.61] 49 …**`) thì đột biến
P9b đỏ oan — nó lấy lời khai ĐẦU TIÊN bằng regex trần, sửa vào đoạn đã gạch, và bộ kiểm (bỏ đoạn gạch) không thấy gì. Commit feat trước
lượt evidence thứ hai.

**Đỏ đo được, cô lập (bản hai, chạy một-một):**
Mười bốn đột biến trên `049` bản hai, chạy một-một trên sáu `it` của `unique-oracle` và ba `it` của `migrations.int` (lọc tên); đối chứng không đột biến xanh (9/9); không đột biến nào đỏ do lỗi dựng; sau lượt, sha256 của tệp đích khớp bản gốc. M1 bỏ khối đối chiếu, chỉ còn `ALTER` trong khối con ⇒ đỏ ở ba `it` của `migrations.int` (thông báo chỉ còn câu của khối con — vai `postgres` thấy 21 hàng, `row_security_active = false` — không id; test N3 đỏ ở lượt chạy lại dưới superuser) · M2 thông báo in email thay vì id ⇒ đỏ ở ba `it` (địa chỉ vào log deploy) · M3 tự hạ vô điều kiện trước khối DO ⇒ đỏ ở ba `it` (câu hạ va khoá duy nhất của cặp; một hàng đứng một mình thì `049` đi qua; lượt chạy lại dưới superuser của test N3 đi qua) · M4 `CHECK … NOT VALID` ⇒ đỏ ở `it` ràng buộc đã kiểm, `it` thông báo nguyên văn và test N3 — dưới hồ sơ N3 `049` ĐI QUA, vì `NOT VALID` không quét bảng · M5 bỏ khối con `ALTER` ⇒ đỏ ở bốn `it` của `unique-oracle` (kể cả vectơ ngoài ASCII) và hai `it` của `migrations.int` · M6 nhóm va khoá quên `supplier_id` ⇒ đỏ ở `it` thông báo nguyên văn (nhóm kéo thêm hàng của nhà cung cấp thứ hai) · M7 tự hạ những hàng KHÔNG va khoá trước khối DO (lượt soi 54 NẶNG-2) ⇒ đỏ ở ba `it`; ở `it` một hàng đứng một mình, `049` đi qua · M8 nuốt `check_violation` của `ALTER` ⇒ đỏ ở test N3 (`049` đi qua dưới N3 mà không có ràng buộc) · M9 `CHECK` dưới `COLLATE "C"` ⇒ đỏ ở vectơ chữ hoa ngoài ASCII (chữ hoa ấy vào được) · M10 ngưỡng đếm `> 1` ⇒ đỏ ở `it` một hàng và ở lượt chạy lại của test N3 · M11 bỏ `LIMIT 20` ⇒ đỏ ở `it` hai mươi mốt hàng · M12 danh sách id không lọc hàng chưa ở chữ thường ⇒ đỏ ở `it` thông báo nguyên văn và `it` một hàng · M13 thông báo N3 chung chung ⇒ đỏ ở test N3 · M14 id kèm phần trước `@` của email ⇒ đỏ ở ba `it`.

**Thăm dò cho khoản 105 (S1.61, tệp tạm):** sau `migrate()` trọn kho — `DROP CONSTRAINT users_email_chu_thuong`, `DROP CONSTRAINT
supplier_contacts_email_chu_thuong`, thay `supplier_contacts_email_hinh_dang` bằng bản `NOT VALID` ⇒ `migrate()` lại ĐI QUA, không ràng buộc
nào được phục hồi hay phán xét, và một người dùng `Alice105@corp.com` VÀO.

**Ranh giới NÓI RA:** ⑴ Tập mà ràng buộc gấp là tập của `lower()` máy chủ: ctype C/POSIX chỉ gấp ASCII; 124 cặp hoa-thường trên musl mà máy
chủ không gấp là cặp THẬT — khoản 71 (ghi thêm ở S1.61). ⑵ glibc chưa đo theo phép thăm dò; test tính chất đo trên môi trường chạy nó. ⑶
`ALTER` giữ `ACCESS EXCLUSIVE` trên `supplier_contacts` lúc kiểm; `migrate.ts` đặt `lock_timeout = 0`. ⑷ Thông báo nêu tối đa 20 id và 10
nhóm. ⑸ Ràng buộc bị gỡ hay hạ `NOT VALID` sau deploy thì không lượt nào thấy — khoản 105. ⑹ Không kiểm định dạng email (011); tên miền IDN
và dấu chấm cuối — khoản 71.

**Lượt soi đối kháng 54** — một người soi độc lập, CHỈ ĐỌC, trên bản chụp bản một của `049`, diff test, log thăm dò và mã sản xuất:
**0 CAO, 2 NẶNG, 5 NHẸ, 2 INFO**. Người soi không tìm được đường nào cất chữ hoa (theo `lower()` của máy chủ) vào `supplier_contacts.email` sau
`049` mà không bỏ ràng buộc; một trụ fail-closed ở hồ sơ deploy mặc định chỉ được đọc từ mã nguồn PostgreSQL — NẶNG-1, nay đã đo.

| Mã | Phát hiện | Xử lý |
|---|---|---|
| NẶNG-1 | Ở hồ sơ N3 (vai deploy là chủ bảng FORCE có EXECUTE — mặc định theo `005`), khối đối chiếu đếm 0 vì policy tenant lọc hết; deploy chỉ dừng nhờ thông điệp trần của `ALTER`, câu đối chiếu người vận hành chạy dưới cùng vai cũng ra 0; lời khai "lượt kiểm của ALTER không chịu RLS" chưa đo — sai thì thành CAO | **Đo:** thăm dò S1.61 — dưới chủ bảng FORCE câu đếm ra 0 (superuser thấy 1), `ALTER … ADD CHECK` và `NOT VALID` + `VALIDATE CONSTRAINT` đều NÉM 23514: fail-closed giữ, không lên CAO; test N3 thật (`dungRoleTrienKhaiThuong`, chủ `supplier_contacts` có EXECUTE) trên bản một nhận đúng thông điệp trần. **Sửa:** `ALTER` vào khối con bắt đúng `check_violation`, ném lại nêu vai, số hàng vai ấy thấy, `row_security_active` và lối ra; chú thích `049` viết lại — test N3 đỏ trên bản một, xanh trên bản hai; đột biến nuốt lỗi và thông báo chung chung đỏ ở nó (đo) |
| NẶNG-2 | Khẳng định "049 không tự hạ" của T2 không thể đỏ: fixture luôn có một cặp va khoá nên khối đối chiếu luôn NÉM và ROLLBACK giữ mọi hàng; bản "tự hạ những hàng không va khoá" lọt T1, T2 và cả bảy đột biến | **Sửa:** T2b — CHỈ một hàng chữ hoa đứng một mình cạnh một hàng chữ thường: `049` phải NÉM, địa chỉ nguyên văn, `049` không được ghi; đột biến "hạ có điều kiện" đỏ ở ba `it`, trong đó `it` một hàng: `049` đi qua (đo) |
| NHẸ-1 | Chốt dữ liệu cá nhân của T2 chỉ cấm tên miền: id kèm phần trước `@` hay họ tên vẫn xanh | **Sửa:** T2, T2b, T3 so thông báo NGUYÊN VĂN; đột biến "id kèm phần trước @" đỏ ở ba `it` (đo) |
| NHẸ-2 | Không vectơ ngoài ASCII nào được ghim; lời khai Unicode dựa trên một thăm dò tạm không ghi phiên bản Node | **Sửa:** T1 thêm vectơ chữ hoa ngoài ASCII TỰ HIỆU CHUẨN (khuôn `[sổ nợ 63]`) và một test tính chất trên CHÍNH môi trường đang chạy — không điểm mã nào máy chủ hạ mà JS để nguyên, không chuỗi JS đã hạ mà máy chủ còn hạ, máy chủ gấp được ngoài ASCII; `049` ghi Node 24.18 / ICU 78.3 cho thăm dò, CI đo lại trên Node 22; đột biến `COLLATE "C"` đỏ ở vectơ ngoài ASCII (đo) |
| NHẸ-3 | Hai ranh giới không khai: ctype C/POSIX làm `lower()` chỉ gấp ASCII; các điểm mã JS hạ mà máy chủ không hạ là cặp hoa-thường THẬT, không chỉ confusable | **Sửa:** `049` khai cả hai (124 điểm mã trên musl, ví dụ `U+24B6`); test tính chất đỏ khi `lower()` của máy chủ chỉ gấp ASCII; hàng khoản 71 ghi thêm "cặp hoa-thường mà `lower()` máy chủ không gấp" |
| NHẸ-4 | "Sửa tay" không định nghĩa được cho nhóm va khoá (xoá bị khoá ngoại chặn khi đã mời, hạ thì va khoá), mọi lối sửa đều đổi đích magic link ngoài sổ kiểm toán; con số va khoá và danh sách id nói về hai tập khác nhau | **Sửa:** thông báo nêu từng NHÓM va khoá kèm MỌI id (tối đa 10 nhóm) cạnh danh sách hàng chưa ở chữ thường; chú thích `049` ghi quy trình — vai mà RLS không áp, người quản lý mua hàng chọn người liên hệ được giữ, thu hồi lời mời trước, mỗi thay đổi một sự kiện kiểm toán; sửa chú thích T2 |
| NHẸ-5 | Năm biến thể có hại khác lọt: nuốt `check_violation` của `ALTER`, ngưỡng `> 1`, bỏ `LIMIT 20`, danh sách id không lọc, con số đếm sai | **Sửa:** T3 bắt nuốt lỗi (dưới N3 `049` sẽ được ghi không ràng buộc) đỏ ở test N3 (đo); T2b bắt ngưỡng đỏ (đo); T2 dùng 21 hàng chữ hoa bắt bỏ `LIMIT` đỏ (đo); so nguyên văn bắt danh sách không lọc đỏ (đo) và mọi con số sai |
| INFO-1 | Lý do "phần trước `@` được phép phân biệt hoa-thường" tự mâu thuẫn với chính ràng buộc | **Sửa:** `049` ghi đánh đổi thành quyết định của sản phẩm (S1.3), không phải lý do kỹ thuật |
| INFO-2 | Chưa có log trọn `migrations.int`, `pnpm test`, đột biến | **Đã có sau bản chụp:** trọn `migrations.int` 112/112, `unique-oracle` 11/11, `suppliers.int` 19/19, `pnpm test` 742/742 trên bản một; bảy đột biến bản một đỏ; bản hai chạy lại trọn — trọn `migrations.int` 114/114, `unique-oracle` cộng `suppliers.int` 32/32, `pnpm test` 742/742; mười bốn đột biến bản hai đỏ |

**Mang sang của người soi:** ⑴ hộp thư trùng nhau theo cách KHÁC hoa-thường (dấu chấm cuối tên miền, IDN) — ghi vào khoản 71; ⑵ kiểm độ dài
trước khi hạ — đo bằng Node: `İ`, `Ⱥ`, `Ⱦ` tăng từ 2 lên 3 byte khi `.toLowerCase()`, trong khi `suppliers.ts:355` kiểm 320 trước khi hạ ⇒ đầu vào
sát 320 byte vấp `CHECK` độ dài của 008 thành 23514 (thân lỗi cố định) — ghi vào khoản 71; ⑶ hardening không phán xét ràng buộc `CHECK` an
ninh — thăm dò đo — gỡ hai ràng buộc chữ thường và hạ ràng buộc hình dạng về `NOT VALID` rồi `migrate()` lại vẫn đi qua ⇒ mở khoản 105; ⑷ log máy chủ PostgreSQL mang `DETAIL: Failing row contains (…)` khi vi phạm dưới vai mà RLS không áp — tiền tồn cho mọi
`CHECK` của bảng này, ngoài phạm vi, chưa đo; ⑸ khuôn cho migration sau: khối đối chiếu hay backfill đọc bảng tenant phải xét
`row_security_active` (khoản 102) — ghi ở "điều đáng mang sang"; ⑹ `CHECK` dựa trên `lower()` không di động giữa libc — ranh giới đã khai.

**Điều đáng mang sang vòng sau:** ⑴ Một migration đọc bảng tenant trong khối DO (đối chiếu, backfill) phải tính tới hồ sơ N3: dưới vai deploy
mà RLS áp, câu đọc ra 0 hàng — nói thật về điều ấy thay vì im lặng. ⑵ Một chốt dữ liệu cá nhân chỉ cấm một mẩu (tên miền) là chốt rỗng ruột:
so NGUYÊN VĂN. ⑶ Fixture luôn làm nhánh lỗi chạy thì mọi khẳng định "không tự sửa" đều không đỏ được — cần một fixture nơi chỉ vế ấy giữ kết
quả. ⑷ `ORDER BY <số> COLLATE` không phải thứ tự theo cột.

# §S1.62 — khoản nợ 67: `do-lap.yml` tách hai job — token ghi issue không nằm cùng job với mã bên thứ ba; báo động chạy cả khi `lap` chết trước khi có số đo; test GHIM thay vì dò mẫu — lượt soi 55

**Bề mặt:** `.github/workflows/do-lap.yml` và test mới `tests/architecture/hinh-dang-do-lap.test.ts`. Không đổi dòng mã sản xuất nào.
- **Workflow:** `permissions: {}`.
- **Job `lap`** (`contents: read`):
  - chạy `pnpm install --frozen-lockfile` và `pnpm test:int`, đưa bốn giá trị ra `outputs`;
  - bước đếm ghi xong outputs thì xanh;
  - bước cuối "Fail-closed" `test "${SO_DO:-x}" = "0"`.
- **Job `bao-dong`** (`needs: lap`, `issues: write`):
  - chạy khi `always()` VÀ (`needs.lap.result` khác `success` HOẶC `so_do` khác `0`);
  - không `uses:`, không checkout, không cài đặt; gọi `gh` kèm `GH_REPO`;
  - năm giá trị `*_THO` (bốn output cùng kết quả job) đi qua env và được kiểm hình dạng TRỌN CHUỖI;
  - thiếu số đo thì mở issue "KHÔNG HOÀN TẤT";
  - nhãn mũi đột biến lấy từ sự kiện;
  - bộ lọc tác giả là `app/github-actions`.

**Đo trước khi viết** (test viết trước, hai lần):
- ⒜ **Bản một của test, trên workflow CŨ:** `it` workflow thật ĐỎ với năm lỗi:
  - quyền mức workflow là `contents: read` + `issues: write`;
  - thiếu job `bao-dong`;
  - `lap` không khai quyền mức job;
  - `lap` không đưa `so_do` ra outputs;
  - `lap` không có bước fail-closed riêng.
- ⒝ **Bản hai của test, sau lượt soi 55, trên workflow bản MỘT:** hai `it` ĐỎ — thân `bao-dong` và khối outputs lệch chỗ ghim, còn `it` đột biến ném vì neo của bản hai chưa có. Chép YAML bản hai vào thì 2/2 xanh.
- ⒞ **Qua API:** `default_workflow_permissions` của kho là `read`, tức khối cũ là một lần NỚI thêm `issues: write`.

**Thăm dò trên runner GitHub** (không ghi gì):
- **Cách dựng:** workflow thăm dò riêng, commit mồ côi `666c5f3` dựng bằng plumbing với index tạm, nhánh tạm `zz-tham-do-67` không mang `ci.yml`, xoá sau khi đọc log.
- **Run 34663968157:** job `a` failure (đúng thiết kế), job `b` success.
- ⑴ **Output của một job ĐỎ tới được job `needs`:** `ket_qua_a=[failure] so_do=[2] ten_do=[…]`.
- ⑵ **Shell:** `run:` không khai `shell` chạy bash 5.2.21 với cờ `ehB`.
- ⑶ **Kiểm hình dạng:** `[[ "$v" =~ ^[0-9]{1,3}/[0-9]{1,3}$ ]]` CHẶN `2/10<xuống dòng>rac`; đối chứng `grep -Eqx` để LỌT.
- ⑷ **Lọc tên:** `tr -c 'A-Za-z0-9._/() -' '?'` biến backtick, `@` và xuống dòng thành `?`, còn `é` (2 byte) thành `??`.
- ⑸ **`gh` không checkout:** với `issues: read` và `GH_REPO`, `gh issue list` vẫn đọc được issue của kho.

**Đo bộ lọc tác giả** (API thật, chỉ đọc; lượt soi 55 INFO-4):
- Issue #22, do workflow này mở ở S1.25, mang `author.login` = `app/github-actions`.
- Bộ lọc cũ `== "github-actions"` trên 50 issue gần nhất ra `[]`; `--app github-actions` cũng ra `[]`; bộ lọc sửa ra `[22]`.
- Tức nhánh "bình luận vào issue cũ" của bản cũ KHÔNG THỂ chạy. Lỗi có từ S1.25.

**Harness hành vi:** chạy thân `run` của `bao-dong`, trích từ YAML bản hai, dưới `bash -e`, với một `gh` GIẢ đặt đầu PATH chỉ ghi lại lệnh. Bảy kịch bản, cả bảy thoát mã 0, và `bash -n` sạch:

| Kịch bản | Kết quả |
|---|---|
| Bình thường | issue "KHÁC 0", thân có dòng kết quả job |
| Vắng output, `lap` `failure` hay `cancelled` | "KHÔNG HOÀN TẤT … (job lap: failure)" / "(job lap: cancelled)" |
| Mũi đột biến, 0 lượt đỏ thật | nhãn "không phải một phép đo" |
| Mũi đột biến + 2 lượt đỏ thật | báo động thật, kèm ghi chú |
| Giá trị rác (xuống dòng, `@team`, backtick, `;id`) | "KHÔNG HOÀN TẤT … (job lap: khong hop le)"; tên tệp thành `?id? ?team?? tieu de` |
| Đã có issue #7 | `gh issue comment 7` |

**Test** (`tests/architecture/hinh-dang-do-lap.test.ts`, hai `it`, bản hai — GHIM):
- ⑴ **Cấu trúc theo tập khoá:**
  - mức cao nhất đúng {name, on, permissions, jobs} với `permissions: {}`;
  - sự kiện đúng {schedule, workflow_dispatch};
  - mọi dòng thụt 2 dưới `jobs:` là khai báo job hợp lệ, và tập job đúng `[lap, bao-dong]`.
- ⑵ **`lap`:**
  - tập khoá mức job, khối quyền, khối outputs và bước fail-closed cuối đều ghim nguyên văn;
  - checkout giữ `persist-credentials: false`;
  - không `secrets`, `github.token` hay `GITHUB_TOKEN` ở dòng nào không phải chú thích.
- ⑶ **`bao-dong`:** thân ghim NGUYÊN VĂN tới hết tệp. Hằng ghim sinh từ YAML bằng `json.dumps`, không gõ tay.
- **Cách đọc:** phần cấu trúc chỉ bỏ chú thích NGUYÊN DÒNG.
- **`it` thứ hai:** mười bảy đột biến trên CHÍNH tệp thật, mỗi đột biến đỏ đúng vế của nó; một chú thích nguyên dòng chèn vào `lap` thì không đỏ.

**Tự bắt, không phải lượt soi:**
- ⑴ **Kiểm theo dòng:** bản nháp đầu kiểm hình dạng bằng `grep -Eqx`, mà grep so THEO DÒNG → đo, đổi sang `[[ =~ ]]` và `case`.
- ⑵ **Bộ đọc `permissions` mức job** của bản một đọc `write-all` một dòng thành Map rỗng.
- ⑶ **`bao-dong`** dùng một `uses:` bên thứ ba thì lọt.
- ⑷ **Mất `always()`** không có vế nào canh.
- ⑸ **Mẫu chỉ đòi neo `^…$`,** nên `^.*$` lọt.
- ⑹ **Bộ dò chỉ đọc khối `run: |` đầu tiên.**
- Các lỗ ⑵ tới ⑹ được vá ngay ở bản một; ở bản hai, cả lối dò mẫu bị thay bằng lối ghim.
- ⑺ **eslint `no-unsafe-return`** ở `expect.stringContaining` trong `map`.
- ⑻ **Hook `git-safety`** chặn nhầm một chuỗi có `rm -f` cùng dòng với `git push`.
- ⑼ **Công cụ Write** biến escape sáu ký tự của U+0000 trong nội dung thành byte NUL thật (đo bằng `grep -a -c -P`) — đã ghi vào bộ nhớ.

**Đỏ đo được, cô lập:**
Mười hai đột biến qua vitest trên tệp thật `do-lap.yml` (bản hai), chạy một-một; đối chứng M00 xanh; mỗi đột biến làm `it` workflow thật ĐỎ (dòng `×` của chính `it` ấy); sau lượt, sha256 của tệp khớp bản gốc. M01 `env:` mức workflow mang PAT · M02 thêm sự kiện `pull_request_target` · M03 job id viết hoa chen giữa `lap` và `bao-dong` · M04 `lap` cầm `issues: write` · M05 `lap` thêm `container:` · M06 `lap` mất `so_do` ở outputs · M07 bước fail-closed đọc hằng `"0"` · M08 bỏ `persist-credentials: false` · M09 một bước của `lap` dùng `github.token` · M10 `if:` của `bao-dong` bỏ nhánh `lap` không xanh · M11 đổi một chú thích trong `bao-dong` · M12 giá trị thô cùng dòng với phép kiểm. Cộng mười bảy đột biến trong chính `it` thứ hai (mỗi đột biến đỏ đúng vế); ở bản một, hai mươi đột biến chạy qua Node trên bản YAML thử cùng hai mươi văn bản giả — lối dò mẫu ấy nay đã thay bằng lối ghim.

**Lượt soi đối kháng 55** — reviewer đọc kho, bản YAML thử và bản nháp test; đọc được tài liệu GitHub và mã nguồn runner; không chạy Node. Kết quả: **0 CAO, 6 NẶNG, 5 NHẸ, 5 INFO.** Không phát hiện nào làm bản vá sai ngay hôm nay. Chỗ yếu nằm ở ba nhóm: đường báo động chưa đo lại, lời khai về output rỗng nói quá, và test hình dạng xanh giả với cách viết hợp lệ.

| Mức | Phát hiện | Xử lý ở bản hai |
|---|---|---|
| NẶNG-1 | Đường báo động của khoản 65 đổi bốn mắt xích (output qua job đỏ, bộ che bí mật trên output của job, `gh` không `.git`, mất `contents: read`) mà chưa chạy lần nào; issue #22 không còn là chứng cứ; `so_luot` tối thiểu 5 nên phép đo kiểu #22 không gọi lại được | **ĐO một phần.** Thăm dò runner: output của job đỏ tới được job `needs`; `gh` không checkout đọc được issue qua `GH_REPO`. Harness bash với `gh` giả chạy bảy kịch bản của chính thân `bao-dong`. Bộ lọc tác giả đo trên API thật. **CHƯA ĐO:** các lệnh GHI issue dưới quyền mức job — một lượt `dot_bien=true` mở issue thật nên em không tự chạy; ghi thành ranh giới |
| NẶNG-2 | `so_do` vắng thì không báo động: quá hạn, bước đếm hỏng, hay runner mất SAU khi đếm (ca cuối là hồi quy do tách job). Chú thích lại khai ngược. Giá trị vắng ép về 0 nên `so_do != '0'` sai | `if:` đổi thành: `always()` VÀ (`needs.lap.result` khác `success` HOẶC `so_do` khác `0`). Thêm `SO_DO_THO` và `KET_QUA_LAP_THO`; thiếu hay sai hình dạng số đo thì mở issue "KHÔNG HOÀN TẤT" kèm kết quả job (harness: `failure`, `cancelled`). Chú thích sửa, lời cũ gạch |
| NẶNG-3 | Bộ tách job không fail-closed: job id viết hoa, `_`, ngoặc kép hay dấu cách cuối dòng thì tàng hình, bị gộp vào thân `lap` | Test ghim: mọi dòng thụt 2 dưới `jobs:` phải là một khai báo job hợp lệ; tập job đúng `[lap, bao-dong]` theo thứ tự. Đột biến "job id viết hoa chen giữa" và "job id có ngoặc kép" đỏ |
| NẶNG-4 | Kiểm tra output không tin chỉ áp cho job tên `bao-dong`; một job thứ ba cầm `issues: write` nội suy output thì lọt | Tập job ghim đúng hai, nên mọi job thứ ba đều đỏ |
| NẶNG-5 | `env:` mức workflow (ví dụ một PAT) lọt: kiểm tra bí mật chỉ quét thân job | Mức cao nhất ghim đúng {name, on, permissions, jobs}. Đột biến "env mức workflow mang PAT" đỏ |
| NẶNG-6 | Theo dõi output bằng chuỗi con và theo dòng: `needs['lap'].outputs[…]`, `toJSON(needs)`, giá trị thô cùng dòng với phép kiểm, bước dạng `- run:`, chú thích ` #` cắt mất phần sau | Thân `bao-dong` ghim NGUYÊN VĂN tới hết tệp, kể cả chú thích. Phần cấu trúc chỉ bỏ chú thích NGUYÊN DÒNG, không cắt giữa dòng. Đột biến `toJSON(needs)`, giá trị thô cùng dòng, và đổi chữ sau dấu `#` giữa dòng đều đỏ |
| NHẸ-1 | `if:` của `bao-dong` và env của bước fail-closed không ghim — một `SO_DO: "0"` làm job luôn xanh | `if:` nằm trong thân `bao-dong` đã ghim; bước fail-closed cuối của `lap` ghim nguyên văn. Đột biến "bỏ nhánh lap đỏ" và "fail-closed đọc hằng 0" đỏ |
| NHẸ-2 | Danh sách đen lệnh chạy mã bỏ sót `container:`, `services:`, alias YAML, `gh extension install`, `python3 -m pip`, `docker run` | Bỏ danh sách đen. `lap` được chạy mã theo thiết kế: thứ canh là quyền, tập khoá mức job (`container`, `services`, `env` đều đỏ) và bí mật. `bao-dong` ghim nguyên văn |
| NHẸ-3 | Mẫu trắng cho `tr -c` kiểm từng ký tự chứ không kiểm dải (`)-_` phủ 0x29–0x5F) | Chuỗi `tr` nằm trong thân `bao-dong` đã ghim |
| NHẸ-4 | Ranh giới chưa nói: mã bên thứ ba trong `lap` vẫn tắt được báo động (`so_do=0`, `::add-mask::`, output quá lớn cho env); nhãn "mũi đột biến" lấy từ output của `lap` | Nói ra ở khối đầu `do-lap.yml` và ở biên bản: kiểm hình dạng bảo vệ KÊNH ISSUE, không bảo vệ tính đúng của phép đo. Dưới `if:` mới, output bị che hay vắng cho ra issue "KHÔNG HOÀN TẤT"; còn `so_do=0` hay output quá lớn cho env thì vẫn tắt được. `DOT_BIEN_SU_KIEN` lấy từ `github.event.inputs.dot_bien` |
| NHẸ-5 | "`lap` KHÔNG cầm quyền ghi" nói quá: token runtime của runner vẫn ghi cache và artifact (có từ trước) | Chú thích sửa, lời cũ gạch |
| INFO-1 | Chú thích checkout vẫn nói đọc `.git/config` là cầm token ghi issue | Lời cũ gạch; ghi lại: token nay chỉ đọc, `persist-credentials: false` vẫn giữ |
| INFO-2 | Test ghi "đo trên bash thật" nhưng khi ấy mới đo Git Bash | Đã đo trên runner ubuntu (bash 5.2.21, run 34663968157); chú thích nêu cả hai |
| INFO-3 | Test đỏ có chủ đích nằm trong kho trong lúc `pnpm evidence` chạy | Không xảy ra: không lượt evidence nào chạy khi test còn đỏ; evidence của vòng chạy trên bản xanh |
| INFO-4 | Nhánh "bình luận vào issue cũ" chưa từng chạy; `.author.login == "github-actions"` có thể không bao giờ khớp | **ĐO:** `author.login` của issue #22 là `app/github-actions`; bộ lọc cũ ra rỗng trên 50 issue gần nhất; `--app github-actions` cũng rỗng; bộ lọc sửa ra `[22]`. Harness chạy tới nhánh bình luận với issue giả #7. Lỗi có từ S1.25 |
| INFO-5 | Test không ghim `on:`, nên tiền đề "chỉ `schedule` + `workflow_dispatch`" của lượt soi 16 không có gì canh | Sự kiện ghim đúng {schedule, workflow_dispatch}. Đột biến `pull_request_target` đỏ |

**Hướng reviewer đã soi mà SẠCH:**
- `FinalizeJob` đánh giá outputs bất kể kết quả job.
- `permissions: {}` cộng quyền mức job đúng với tài liệu cho `schedule` và `workflow_dispatch`.
- `GH_REPO` thay được `.git`, và `gh` có sẵn trên runner.
- Mỗi job có VM riêng, nên không có kênh hệ tệp.
- `[[ =~ ^…$ ]]` neo trọn chuỗi; `tr`/`cut` không eval.
- Không `${{ }}` nào nội suy vào thân `run`.
- Không đường nào để `lap` xanh mà `so_do` khác 0.
- Test thật sự chạy ở T1+T2 trên cả hai hệ điều hành.

**Ranh giới NÓI RA:**
- ⑴ **`so_do` do `lap` ghi, và `lap` chạy mã bên thứ ba.** Một `lap` bị chiếm vẫn TẮT được báo động: ghi `so_do=0`, hoặc làm bước báo động không khởi động được bằng một output quá lớn cho env. Khoản này đóng việc CẦM TOKEN GHI và làm kênh issue chịu được dữ liệu rác; nó không đóng việc tin kết quả đo.
- ⑵ **Chưa đo trên runner:** `gh label create`, `gh issue create --label` và `gh issue comment` dưới `issues: write` MỨC JOB, không có `contents: read`.
  - Tài liệu GitHub có ví dụ đúng tổ hợp ấy (reviewer dẫn).
  - Phép đo cần một lượt `dot_bien=true`, lượt ấy mở issue thật, nên em không tự chạy.
  - `so_luot` nhỏ nhất là 5, nên lượt ấy tốn khoảng 45 phút.
- ⑶ **`lap` quá hạn** thì mất số đỏ của các lượt đã xong; issue "KHÔNG HOÀN TẤT" vẫn được mở.
- ⑷ **Token runtime của `lap`** vẫn ghi được cache và artifact. Việc này có từ trước.
- ⑸ **Test GHIM:** sửa `bao-dong`, hay khối quyền, outputs hoặc bước fail-closed của `lap`, là phải sửa cả test — có chủ đích.

**Điều đáng mang sang vòng sau:**
- ⑴ Một đường báo động tách sang job khác phải được đo lại ĐÚNG ngữ nghĩa bị đổi — ở đây là output của một job đỏ — trên runner thật, bằng một phép đo không ghi gì.
- ⑵ Với một job nhỏ cầm quyền ghi, ghim nguyên văn mạnh hơn mọi bộ dò mẫu: mỗi bộ dò mẫu của bản một đều có một văn bản hợp lệ đi vòng.
- ⑶ Theo tài liệu biểu thức (reviewer dẫn, chưa đo), giá trị vắng bị ép về 0, nên `x != '0'` ra SAI khi `x` vắng. Một điều kiện báo động không được dựa vào sự có mặt của output.
- ⑷ Kiểm hình dạng dữ liệu không tin trong bash phải so TRỌN CHUỖI.
