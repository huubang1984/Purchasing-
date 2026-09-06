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
