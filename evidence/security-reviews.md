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
| **S1.16** | `db/migrations/046` (một câu `CREATE INDEX`), `db/otp-don-ke-hoach.int.test.ts`, và bốn chỗ gạch lời khai sai của H7-3 | `ac7cc58` | Review tĩnh; hai phép đo kế hoạch đã chạy thật ở commit ấy | **0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW** | `<commit sửa>` |

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
