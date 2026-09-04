# Dấu vết review an ninh — S0

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
