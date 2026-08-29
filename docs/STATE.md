# STATE — TrustProcure V2

> Bộ nhớ trạng thái hiện tại của dự án. Đọc trước mọi việc quan trọng, đối chiếu với mã
> nguồn thật — mã, test và hành vi runtime là bằng chứng mạnh hơn tài liệu này.
> Không bao giờ ghi "đã xong / đã test / đã sửa / đã triển khai" nếu chưa thực sự kiểm chứng.

**Cập nhật lần cuối:** 2026-08-29 (vòng fix CI, sau lần chạy CI đầu tiên của nhánh S0)

---

## Cột mốc hiện tại

**Giai đoạn: S0 (Nền móng) — MÃ NGUỒN ĐÃ CÓ, mười một task đã commit. S1 chưa bắt đầu.**

Đã xong:

- Thiết kế S0+S1, sáu lát cắt dọc S0–S5, **chín ADR** (bảy ở giai đoạn thiết kế, ADR-008 ở Task 9,
  ADR-009 ở vòng fix cuối), sổ đăng ký bất biến, kiến trúc kiểm thử bảy tầng.
- **Mười một task của kế hoạch S0 đã commit** (`docs/superpowers/plans/2026-08-27-s0-foundation.md`).
- Hai hook `git-safety` / `protect-secrets` đã viết lại fail-closed và có test.
- Monorepo pnpm, CI bốn job, cổng tĩnh T0 (tsc + eslint + dependency-cruiser + gitleaks + audit).
- Bảy migration `001`–`007` + `hardening.always.sql`: role, tổ chức, người dùng, sổ kiểm toán
  chuỗi hash, vai trò/quyền, phiên + MFA, outbox.
- `KeyProvider` + adapter `local-dev` bọc khoá theo tổ chức có phiên bản, công cụ đo hiệu năng.
- **Evidence pack**: `pnpm evidence` sinh `evidence/INV-matrix.md` từ `docs/TEST-PLAN.md`.

Chưa xong:

- Toàn bộ S1 (Sealed Bid Core): RFQ, lời mời, phong bì niêm phong, luồng mở thầu.
- `apps/` **rỗng**. Không có một đường gọi sản phẩm nào tới `listOrganizations`, `start()` của
  outbox runner, hay `assertFreshMfa` — các gói đã có được test gọi, chưa có ứng dụng gọi.

## Công việc đang làm

Không có. Task 11 là task cuối của S0; sau đó là **một vòng fix cuối** đóng bốn việc văn bản/cấu hình của review toàn nhánh (không sửa một dòng mã sản phẩm nào), và **một vòng fix CI** đóng ba lỗi mà lần chạy CI đầu tiên phát hiện (cũng không sửa một dòng mã sản phẩm nào — hai file test, một `package.json`, một workflow, hai tài liệu).

### Điều kiện hoàn thành S0 — đối chiếu từng mục

| # | Điều kiện | Trạng thái |
|---|---|---|
| 1 | Mười một task đã commit, **mỗi task một commit riêng** | **ĐẠT PHẦN CHÍNH, vế "một commit riêng" thì KHÔNG.** 11 task, 43 commit: mỗi task có thêm 1–5 commit vòng fix, và Task 8 tách làm hai (một commit sửa lỗi tiền tồn của Task 1 + một commit cho task). Vế bị vi phạm là vế hình thức; vế thật — mỗi task một đơn vị công việc khép kín — thì giữ |
| 2 | `pnpm t0 && pnpm test && pnpm test:int` xanh tại máy và trên CI | **ĐẠT tại máy**: t0 exit 0 (78 module / 187 phụ thuộc), `test` 346, `test:int` 326. Vế **"và trên CI" NAY ĐÃ ĐƯỢC ĐO** — lần chạy đầu tiên (run `33218397033`, 2026-08-28) **ĐỎ CẢ BA JOB**, ba nguyên nhân khác hẳn nhau, **không lỗi nào phát hiện được trên máy Windows**. Cả ba đã sửa; **lần chạy thứ hai (run `33221142361`) XANH CẢ BỐN JOB**, kể cả `evidence` — lần đầu tiên nó chạy trên CI. Vế "và trên CI" nay **ĐẠT ĐỦ**. Xem khối ngay dưới bảng |
| 3 | Hai hook đã được kiểm chứng bằng cách **thật sự bị chặn** trong một phiên Claude Code | **ĐẠT** (Task 1; lệnh không tới được `git`, hàng rào chặn ở tầng Claude Code chứ không chỉ tầng script). Sự kiện này là **lịch sử** và bằng chứng của nó nằm ngoài kho mã — đã ghi nhận ở `evidence/security-reviews.md` ghi chú ⑷ |
| 4 | Quy tắc `khong-giai-ma-ngoai-unseal-worker` đã được chứng minh chặn thật bằng test đối kháng | **ĐẠT** (Task 2: RED thật bằng cách làm quy tắc mất tác dụng, rồi GREEN lại; Task 7 lặp lại độc lập). Cũng là **sự kiện lịch sử** — đã ghi nhận ở `evidence/security-reviews.md` ghi chú ⑷, kèm cách đóng thật: đưa lượt RED vào CI |
| 5 | `pnpm evidence` sinh được ma trận và báo **23/44** mã đã phủ (13 nghiệp vụ + 10 hàng rào) | **ĐẠT VỀ CƠ CHẾ, SAI VỀ CON SỐ TRONG ĐIỀU KIỆN.** Thực tế: **24/47** (11 nghiệp vụ + 13 hàng rào). Ba lệch, ba lý do đo được — xem *Trạng thái kiểm thử* |
| 6 | `pnpm bench:keys` đã chạy, con số thông lượng đã ghi vào `docs/STATE.md` | **ĐẠT** — xem *Vấn đề đã biết* mục 4 |
| 7 | `docs/STATE.md` phản ánh đúng trạng thái thật, đã đối chiếu với mã nguồn | **ĐẠT ở lần cập nhật này** |
| 8 | `security-reviewer` đã chạy trên task 4–9, mọi phát hiện CRITICAL/HIGH đã xử lý | **ĐẠT** cho **cả 4, 5, 6, 7, 8, 9** — và thêm cả 3, 10, 11. Dấu vết nằm trong kho mã ở **`evidence/security-reviews.md`**: mỗi task một dòng, có commit được review, môi trường đo, số phát hiện theo mức, và commit vòng fix đã đóng chúng. Không phát hiện CRITICAL/HIGH nào còn mở. Xem thêm ghi chú ngay dưới bảng về **lời khai sai đã được gỡ** và về **giới hạn thật của bằng chứng này** |

> **Mục 8 — một lời khai sai đã được gỡ, và một khiếm khuyết nặng hơn đã được đóng.**
>
> Bản trước của ô này ghi: *** CÂU DƯỚI ĐÂY SAI. ĐÃ ĐO. GIỮ NGUYÊN VĂN ĐỂ ĐỐI CHIẾU, KHÔNG XOÁ. ***
>
> > >>> "**Task 7, 8, 9: KHÔNG tìm thấy dòng tương đương** — sổ tay có nhắc 'reviewer an ninh'
> > >>>  trong các vòng fix của Task 8/9, nhưng đó không phải cùng một bằng chứng. Ghi là
> > >>>  **CHƯA XÁC MINH**, không ghi là đạt."
>
> **Vì sao nó sai:** phép tìm chỉ dùng chuỗi tiếng Anh `SECURITY REVIEW`. Sổ tay ghi Task 8, 9
> và 10 bằng tiếng Việt — `REVIEW AN NINH XONG` — và Task 7 ghi kết quả ở một dòng khác dạng
> (`Security review: 1 HIGH, khong CRITICAL`). Các lượt review **đã xảy ra**. Sai theo hướng an
> toàn, nhưng vẫn là một câu sai trong tài liệu trạng thái, và nó sẽ đẩy người kế nhiệm đi **làm
> lại một việc đã làm**.
>
> **Khiếm khuyết nặng hơn, và đó mới là thứ được đóng ở vòng này:** ô cũ viện dẫn *"sổ tay tiến
> trình ghi…"*, tức **trích một nguồn mà người nhận repo không mở được** — `git ls-files
> .superpowers/` trả về **rỗng** (`.superpowers/sdd/.gitignore` là `*`). Một kiểm toán viên
> clone kho này sẽ không thấy một mẩu nào. `evidence/security-reviews.md` là dấu vết ấy, **đặt
> trong kho mã**.
>
> **Giới hạn của nó, nói thẳng:** file mới **chứng minh** rằng các lượt review đã xảy ra trên
> những commit nêu tên và các commit vòng fix tồn tại trong `git log`. Nó **không chứng minh**
> rằng từng phát hiện cụ thể đã được đóng đúng — mối nối "phát hiện thứ k ↔ dòng mã nào" chỉ có
> trong sổ tay, và sổ tay không vào git. Đây là một **bản chép có xuất xứ**, không phải bản sao
> hồ sơ gốc. Cùng lỗ ấy còn phủ điều kiện **#3** (hai hook bị chặn thật trong một phiên Claude
> Code) và **#4** (test đối kháng depcruise của Task 2): cả hai là **sự kiện lịch sử**, đã được
> gộp vào cùng file với ghi chú tương ứng.

> **Mục 2 — LẦN CHẠY CI ĐẦU TIÊN, và nó trả giá ngay.**
>
> Khoản nợ *"chưa từng chạy trên CI thật"* được thanh toán ngày 2026-08-28 (run `33218397033`).
> Kết quả: **T0 đỏ, T1+T2 đỏ, T3 đỏ, `evidence` bị bỏ qua**. Ba nguyên nhân thuộc **ba loại khác
> nhau**, và điểm chung mới là điều đáng ghi: **không lỗi nào có thể phát hiện trên máy Windows.**
>
> **⑴ T0 — cổng chạy đúng thiết kế, chú thích của nó mới là thứ sai.** `pnpm audit --prod
> --audit-level high` đỏ với hai advisory HIGH trên `undici@5.29.0`, qua đường
> `packages/test-support > @testcontainers/postgresql > testcontainers > undici`. Nguyên nhân gốc
> **không phải advisory** mà là một **khiếm khuyết đóng gói**: hạ tầng KIỂM THỬ được khai trong
> `dependencies` thay vì `devDependencies`. Và `ci.yml` tự viết *"Hiện S0 chưa có prod dependency
> nào nên bước này luôn sạch; sẽ có răng thật từ Task 3 khi `pg` được thêm vào"* — răng đến **sớm
> hơn** và từ **một nguồn khác**. Đây là **câu phát biểu rộng hơn thứ được đo, thứ 19**, và lần
> này nó nằm trong `ci.yml`. Đã sửa: ba mục của `packages/test-support` chuyển sang
> `devDependencies` (không package.json nào khai gói đó làm phụ thuộc — `*.int.test.ts` lấy nó qua
> alias của vitest), câu chú thích được **gạch bỏ tại chỗ, giữ nguyên văn**. Phạm vi prod thật, đo
> lại bằng `pnpm list -r --prod --depth 0`: `pg` + `pg-connection-string`.
>
> **⑵ T1+T2 — 345/346 xanh, và test đỏ là một LỚP KHIẾM KHUYẾT CHƯA TỪNG GẶP trong dự án này:
> *"một bảo đảm chỉ đúng trên MỘT hệ điều hành"*.** Test `[INV-G1]` về import sai hoa-thường ghi
> một probe trỏ tới `Local-Dev-Shared.ts`. Trên hệ thống file **không** phân biệt hoa thường
> (Windows/macOS) nó resolve ⇒ có cạnh ⇒ quy tắc bắn ⇒ xanh. Trên `ubuntu-latest` nó **không**
> resolve ⇒ không có cạnh ⇒ không có vi phạm ⇒ `expected +0 not to be +0`. Hiểm hoạ **không tồn
> tại** trên Linux; chỉ khẳng định là sai. Đây là họ hàng của QT2 ở trục **nền tảng**: bảo đảm
> phụ thuộc một tính chất của môi trường thì phải **ĐO** tính chất đó. Đã sửa bằng cách tách test
> làm hai vế — vế ⓵ *regex của chính quy tắc khớp cả cách viết sai hoa-thường*, đúng trên **mọi**
> hệ điều hành; vế ⓶ đầu-cuối qua depcruise CLI, **chỉ chạy khi hệ thống file ĐO ĐƯỢC là không
> phân biệt hoa-thường**, và khi bỏ qua thì **công bố ra log**. Không dùng `ctx.skip()`: một test
> `[INV-XX]` bị bỏ qua có thể làm cổng evidence đỏ, và vế ⓵ vẫn là phép đo thật trên Linux.
> **Đo bốn nhánh** (mũi A = giả lập FS phân biệt, mũi B = gỡ tính không-phân-biệt khỏi quy tắc):
> `R0` 29 passed · `RA` **29 passed + công bố** · `RB` **đỏ** · `RAB` **đỏ**. Nhánh `RAB` là nhánh
> quan trọng nhất: **trên một hệ thống file phân biệt hoa-thường, bảo đảm nay VẪN được đo.**
>
> **⑶ T3 — 326/326 test XANH, 11/11 file XANH, job vẫn ĐỎ.** *"Vitest caught 2 unhandled errors"*,
> cả hai là SQLSTATE `57P01` (`admin_shutdown`) trên hai database tạm. Đây là **vế thứ hai** của
> bài học ràng buộc (11): *"mọi test xanh" không đủ để kết luận job xanh* — lỗi nằm **ngoài vòng
> đời test**. Cơ chế: `await pool.end()` chỉ bảo đảm phía client; `DROP DATABASE ... WITH (FORCE)`
> gửi SIGTERM cho backend còn sót; FATAL về trên socket client vẫn đang đọc; pg-pool
> `pool.emit("error")` không ai nghe ⇒ Node ném. Đã sửa hai lớp: **chờ `pg_stat_activity` hết
> backend rồi `DROP` KHÔNG FORCE**, và **ghi lại lỗi pool để KHẲNG ĐỊNH là rỗng**. Năm nhánh đột
> biến (rò rỉ đúng một kết nối): nhánh *tắt cả hai lớp* **tái lập chính xác chữ ký của CI**
> (15 passed, exit 1, `Unhandled Errors`); nhánh *chỉ giữ lớp ghi lỗi* **đỏ bằng khẳng định** có
> tên. **Một dự đoán của tôi bị phép đo bác bỏ:** tôi chờ nhánh *rò rỉ + bản đã sửa* sẽ đỏ vì đếm
> được kết nối thừa — nó **xanh**, vì `pg.Pool` có `idleTimeoutMillis` mặc định 10 giây nên pool
> bị bỏ quên **tự** đóng client. Nói cho đúng: thứ mua được tính tất định là **vòng chờ**, còn
> khẳng định `ketNoiConLai === 0` chỉ bắt được rò rỉ **sống lâu hơn hạn 30 giây**.
>
> **LẦN CHẠY THỨ HAI (run `33221142361`) — XANH CẢ BỐN JOB.** Đọc trên log đã bóc mã màu:
> T0 ✓ (cổng **chặn** trả *"No known vulnerabilities found"*) · T1+T2 ✓ **346 passed / 17 file**,
> và vế đầu-cuối **công bố đúng như thiết kế**: *"hệ thống file ĐO ĐƯỢC là PHÂN BIỆT hoa-thường
> (platform=linux)"* · T3 ✓ **326 passed / 11 file, 0 lần `Unhandled Error`, 0 lần `57P01`, 0 lần
> "administrator command"** · `evidence` ✓ **lần đầu tiên chạy trên CI**: 672 khẳng định,
> **24/47**, *"Cổng evidence: XANH"*, và bước so byte `git diff --exit-code --
> evidence/INV-matrix.md` đã chạy và qua. Khoản nợ 22 **đóng**.
>
> **Một annotation còn lại trên T0, và nó KHÔNG phải lỗi:** *"Process completed with exit code 1"*
> thuộc bước **`Audit phu thuoc (bao cao, khong chan)`** — bước có `continue-on-error: true`, cố ý
> **log** hai advisory devDependency (`vitest` critical, `vite` high) thay vì giấu đi. Bước **chặn**
> ngay phía trên sạch. Đây đúng là hành vi đã thiết kế; ghi ra để lần sau không ai đọc nhầm
> annotation ấy thành một hồi quy.
>
> **Và một phép đo suýt bị phân loại sai ở chính vòng này:** lượt tải log job T3 **thất bại
> lặng lẽ** (`gh` chạy ngoài thư mục kho ⇒ *"failed to determine base repo"*), và file 475 byte
> chứa **thông báo lỗi** đó vẫn cho *"0 lần 57P01, 0 unhandled"* — một kết luận **XANH GIẢ**.
> Đúng ràng buộc (11): chỉ được phân loại khi có **dấu hiệu tích cực** rằng bộ test đã chạy.
> Con số ở trên là con số đọc từ bản tải lại, có dòng `Test Files 11 passed`.

## Điểm chặn

| # | Điểm chặn | Ảnh hưởng | Trạng thái |
|---|---|---|---|
| 1 | **Chưa có khách hàng pilot** | Rủi ro xây đúng thứ theo sai thứ tự — lớn hơn mọi rủi ro kỹ thuật | Chưa xử lý. Nên tiếp cận song song ngay từ S1 |
| 2 | ~~**Ba quyết định treo trước S1**: xử lý thư mục `Vibe Coding/`, chọn nhà cung cấp KMS (**ADR-009**, trạng thái *Đang mở*), chọn hạ tầng triển khai~~ → **còn MỘT**: xử lý thư mục `Vibe Coding/` | KMS và hạ tầng **đã chốt cùng lúc 2026-08-29: AWS KMS, `ap-southeast-1`** — đúng như dòng bên phải đã dự báo, chúng không độc lập và được quyết trong một lần. Xem ADR-009. | **Đã chốt một phần** |

> Điểm chặn cũ *"hook `git-safety.sh` và `protect-secrets.sh` đang fail-open"* đã được **gỡ**:
> Task 1 viết lại cả hai theo hướng fail-closed, và điều kiện hoàn thành S0 mục 3 đã đạt.

## Vấn đề đã biết

| # | Vấn đề | Mức | Ghi chú |
|---|---|---|---|
| 1 | `~/.claude/settings.json` chứa `ANTHROPIC_AUTH_TOKEN` dạng rõ | TRUNG BÌNH | `protect-secrets` nay đã phủ `.claude/settings*.json` (H8). File đã tồn tại thì hook không xoá được token khỏi nó — đó là việc của người dùng |
| 2 | Thư mục `Vibe Coding/` là bản copy-paste thủ công của CLAUDE.md + 5 file SKILL, trùng với plugin `ai-eng-os` đã cài | THẤP | README của plugin cảnh báo gây nhầm lẫn giữa `/feature` và `/ai-eng-os:feature`. Là thao tác **xoá file** nên kế hoạch cố ý không tự làm |
| 3 | Rủi ro `crypto.subtle` không khả dụng trong webview Zalo/Messenger | CAO (rủi ro sản phẩm) | ~~**Chưa đo.**~~ **Vẫn CHƯA ĐO TRÊN THIẾT BỊ THẬT**, nhưng nay đã có **máy dò**: `tools/do-webcrypto/index.html` chạy thật từng phép mật mã của đường nộp thầu và cho ra một trong **bốn** phán quyết. Máy dò đã được chứng minh có răng bằng ba đột biến (`?dot=x25519\|aes\|rnd` qua `phuc-vu-va-dot-bien.mjs`) — bốn phán quyết phân biệt được, đo trên Chrome 148 ngày 2026-08-29. **ĐÃ CÓ PHÉP ĐO TRÊN WEBVIEW THẬT (2026-08-29): Zalo iOS, WKWebView, iOS 18.7 — ĐẠT TOÀN BỘ, kể cả X25519.** Giả thuyết xấu nhất (*"webview Zalo không có `crypto.subtle`"*) **đã bị bác trên đường iOS**. Rủi ro **hẹp lại nhưng CHƯA ĐÓNG**: phía **Android vẫn trống hoàn toàn**, và kết quả iOS chỉ đúng cho **iOS 18.7** — `X25519` vào WebCrypto muộn hơn nhiều so với AES-GCM nên một WebKit cũ là chỗ nó có thể vắng. Phép đo này cũng làm lộ ra rằng trục phân loại đúng là **engine**, không phải tên ứng dụng: trên iOS, Zalo và Messenger dùng **cùng một `WKWebView`**, nên một phép đo phủ cả hai. Nhật ký: `tools/do-webcrypto/ket-qua-do.md`. Xem ADR-007 và §10 của kế hoạch S1 |
| 4 | Hiệu năng bọc/mở khoá `local-dev` (rủi ro §8.4 của spec) | THAM KHẢO | `pnpm bench:keys` trên máy dev, **đo lại 2026-08-29**: 10.000 lần **bọc** 447 ms (**≈22.400 thao tác/giây**), 10.000 lần **mở** 392 ms (**≈25.500 thao tác/giây**). Lần đo trước (sau fix round 1 của Task 7): 512 ms / 440 ms — cùng bậc. Đây là mốc của `local-dev` (mã hoá nội bộ, không qua mạng). ~~Tham chiếu: RFQ 50 NCC × 200 hạng mục ≈ 10.000 lần mở khoá/lượt mở thầu ⇒ dưới nửa giây CPU thuần. Adapter KMS/Vault thật (S1.6) sẽ chậm hơn **nhiều bậc** vì mỗi lần là một lời gọi mạng~~ — **hai câu vừa gạch đã được ĐO là sai** (2026-08-29, `tools/bench-kms/dem-loi-goi-kms.mjs`): 200 hạng mục nằm trong **cùng một phong bì** nên số phong bì là **50** chứ không phải 10.000; và một lượt mở thầu tốn **đúng 1 lời gọi KMS** bất kể số nhà cung cấp, vì chỉ data key của tổ chức đi qua KMS. Giữ nguyên văn để đối chiếu. **Câu "phải đo lại trước khi bắt đầu S1.6" thì vẫn đúng và vẫn còn hiệu lực** — phép đo trên là mô phỏng, chưa chạy qua `packages/crypto-keys`; xem ADR-009 |
| 5 | `[M10]` flaky tiền tồn | THẤP | Ghi nhận từ vòng review trước, chưa truy nguyên |

## Nợ kỹ thuật

Sổ nợ gom từ mười một task **và từ review cuối toàn nhánh**. Mỗi mục là một **khoảng trống đã
đo**, không phải một linh cảm. Mục 1–12 có từ các task; **13–19 thêm ở vòng fix cuối**;
**20–22 thêm sau LẦN CHẠY CI ĐẦU TIÊN** (run `33218397033`).

| # | Nợ | Nơi ghi chi tiết |
|---|---|---|
| 1 | **E3 vế *giới hạn tần suất* không có một dòng mã nào** trong toàn S0. Bốn vế còn lại có lớp và có mốc chết | `packages/identity/src/mfa-credentials.ts` (khối đầu); `evidence/INV-matrix.md` §4 |
| 2 | Trần loạt đầu của vế *giới hạn số lần thử* (E3) là **độ đồng thời của kẻ tấn công**, không phải hằng số cấu hình. Sau loạt đầu, hồ sơ bị khoá | `packages/identity/src/mfa.ts` |
| 3 | **Hàng rào tự làm mù mình bằng danh sách tên**, hai lỗ đã đo: `NOBYPASSRLS` chỉ ghim đúng **bốn tên role**, và một **hàm plpgsql ngoài danh sách** không được ghim | `db/rls-coverage.int.test.ts`, `task-4-report.md` |
| 4 | Hai GUC log nằm ở **tầng vận hành**, không ở tầng có thể cưỡng chế bằng test | `packages/db/src/pool.ts` |
| 5 | `enqueueJob` **không có oracle xuyên tổ chức và không test nào canh** | `packages/outbox/`, `task-10-report.md` |
| 6 | **Đường đời `sessions` chưa tồn tại**: không hàm nào phát token, tra token, hay đặt `mfa_verified_at`. D1 là một phép kiểm ĐÚNG chưa có ai gọi | `evidence/INV-matrix.md` §4 |
| 7 | `apps/` rỗng ⇒ `listOrganizations` / `start()` **chưa có đường gọi sản phẩm** | — |
| 8 | **Không lớp máy nào cưỡng chế quy ước QT3**; chú thích + test là tất cả những gì đang giữ nó | `packages/audit/src/tenant-guard.ts`, `task-8-report.md` §V3.5 |
| 9 | **Bốn gói thiếu danh sách trắng barrel**: `audit`, `tenancy`, `db`, `test-support`. Một symbol mọc ra ở mặt tiền của chúng không được canh bởi lớp nào | `tests/architecture/barrel-exports.test.ts` |
| 10 | **`.gitattributes` ghim đúng hai thứ**: `*.sql` và `evidence/INV-matrix.md`. `.ts` là **CRLF trong mọi checkout mới** trên Windows | `.gitattributes` |
| 11 | **Artefact neo ngoài của B3 vẫn không tồn tại.** Cơ chế đã có, artefact thì chưa — và không có nó, một chuỗi hash hợp lệ **không chứng minh gì** trước một chủ sở hữu bảng | `evidence/INV-matrix.md` §4.1 (trích nguyên văn) |
| 12 | Lớp canh nhãn của Task 10 (`packages/outbox/src/nhan-bat-bien.test.ts`) **chỉ phủ `packages/outbox/src/`**. Lớp canh toàn repo mà Task 11 dựng chỉ bắt được nhãn trỏ tới mã **không tồn tại** — nó **không** bắt được nhãn đúng cú pháp gắn sai chỗ | `tools/inv-matrix/src/parse.ts` |
| 13 | **`D1` là một mệnh đề HỘI bốn vế mà phép hội chưa từng được đo một lần.** 12 test đo vế *MFA còn hiệu lực*, 5 test đo vế *quyền hợp lệ*, **không test nào đo hai vế cùng lúc**; hai vế còn lại (*RFQ đã CLOSED*, *cổng chính sách*) không có một dòng mã nào. Vế thứ ba **chính là hàng `C3`**, đang ⏳ trong cùng bảng | `evidence/INV-matrix.md` §4 (mục D1) |
| 14 | **`G1` canh một cánh cửa chưa có phòng ở sau.** 18 test đo quy tắc biên giới — lớp phòng ngừa thật, đã chứng minh có răng — nhưng `wrapped_private_key` và `apps/unseal-worker` **chưa tồn tại** | `evidence/INV-matrix.md` §4 (mục G1) |
| 15 | **Không có ADR mở cho KMS dù nó chặn S1.6** — đã đóng bằng **ADR-009**; khoản nợ còn lại là *chốt nhà cung cấp*, và nó **không độc lập** với quyết định hạ tầng (ADR-006 chỉ cưỡng chế được bằng IAM của hạ tầng đích) | `docs/DECISIONS.md` ADR-009 |
| 16 | **Bốn mục hardening cùng khuôn danh-sách-tên, chưa có trong sổ nợ.** Nặng nhất: hình dạng bảng sổ chỉ **ĐẾM** `attname IN (15 tên) = 15`, **không cấm cột thừa** ⇒ thêm một cột `payload_plaintext` vào `audit_events` **không bị mục nào chạm**. Kế đó: bất đối xứng `bang_so` (2 tên viết cứng) vs `bang_al` (theo tính chất) — **bảng báo giá S1 sẽ rơi thẳng vào đó**: được kiểm trigger nhưng **không** bị kiểm UNLOGGED, **không** bị kiểm UNIQUE, **không** bị thu hồi UPDATE/DELETE/TRUNCATE. **Bất đối xứng này không có một chú thích nào giải thích.** Và `VI_TU_BANG_TENANT` giấu `OR relname IN ('organizations')` bên trong một vị từ tính-chất ⇒ bảng gốc tenant thứ hai không bị đổi RLS/FORCE, `rls-coverage.int.test.ts` cũng mù | `db/migrations/hardening.always.sql`, `db/rls-coverage.int.test.ts` |
| 17 | **Hai mặt tiền chịu lực nhất repo không có lớp nào canh đường vào.** `packages/tenancy/src/with-tenant.ts` là **điểm DUY NHẤT gắn `app.org_id`** — toàn bộ RLS của 002–007 treo vào nó — và `packages/audit/src/writer.ts` là đường ghi sổ kiểm toán. Cả hai **với tới được bằng import tương đối**: 3/7 gói có quy tắc biên giới (`crypto-keys`, `identity`, `outbox`); `audit`, `db`, `tenancy`, `test-support` **không có** | `.dependency-cruiser.cjs:77-78` (tự đặt tên cho quy luật: *"LẦN THỨ BA CÙNG MỘT LỚP LỖ"*) |
| 18 | **Bộ máy evidence nằm ngoài vòng review bắt buộc** — đã đóng ở vòng fix cuối: `/tools/inv-matrix/`, `/docs/TEST-PLAN.md`, `/docs/STATE.md`, `/evidence/` nay có trong `.github/CODEOWNERS`. Khoản nợ **còn lại**: `CODEOWNERS` trỏ tới `@trustprocure/bao-mat`, một team **chưa tồn tại**, nên tới hôm nay nó **chưa cưỡng chế gì** | `.github/CODEOWNERS` (khối cảnh báo ở đầu file) |
| 19 | **Bốn phép đo THIU trong chú thích của migration đã áp**, không sửa được tại chỗ vì `001`–`007` và `hardening.always.sql` **không được đụng** (migration đánh số chạy đúng một lần; sửa chú thích cũng đổi checksum): ⑴ `006:23` và `007:29` chép **nguyên văn giống nhau** *"~71 chỗ `::text`/`::oid`"* — đo lại bằng công cụ **nhị phân** trên `hardening.always.sql`: `::text` = **55**, `::oid` = **2**, tổng **57**; một phép đo thiu được chép sang file thứ hai **mà không đo lại**. ⑵ `hardening:863-864` (khối *DƯ LƯỢNG CÒN LẠI*, đúng đoạn có giá trị kiểm toán cao nhất) nói *"một bảng ở schema khác mang ĐÚNG **14** cột này"* trong khi danh sách có **15** tên và vị từ dòng 886 đúng là `= 15` — mô tả sai bề mặt tấn công **đi một cột**. ⑶ `005:190-191` nói mục (C) *"CẤM MỌI"* hàm SECURITY DEFINER, nhưng bản cài đặt còn loại trừ `pg_toast%`/`pg_temp%`, `NGOAI_LE_DOC_VONG`, và **hàm thuộc EXTENSION** — file viện dẫn nói **rộng hơn** file có thẩm quyền. ⑷ `hardening:73-76` nói *"4 trong 6 câu lệnh"* trong khi bảng hiện có **36 mục**. **Cách đóng đúng: một migration mới, hoặc sửa kèm lần migrate() kế tiếp có đổi lược đồ.** | `db/migrations/006_sessions_and_mfa.sql`, `007_outbox.sql`, `005_identity.sql`, `hardening.always.sql` |
| 20 | **Không lớp nào canh "bảo đảm chỉ đúng trên một hệ điều hành".** Lần chạy CI đầu tiên tìm ra **một** ca (test import sai hoa-thường) và ca đó đã sửa, nhưng cơ chế phát hiện vẫn là *"chạy trên hệ điều hành thứ hai rồi xem cái gì đỏ"*. Toàn bộ 346 test đơn vị mới chỉ được chạy trên **hai** nền tảng đúng **một** lần mỗi bên, và CI chỉ có `ubuntu-latest` — nên một bảo đảm chỉ đúng trên **Linux** thì hôm nay **không lớp nào bắt được**. Cách đóng đúng: thêm `windows-latest` vào ma trận job T1+T2 | `tests/architecture/boundaries.test.ts` (khối chú thích của test hoa-thường); `.github/workflows/ci.yml` |
| 21 | **Chỉ `pnpm audit --prod` chặn được hạ tầng kiểm thử lọt vào phạm vi sản xuất, và nó chỉ nổ khi TÌNH CỜ có advisory.** `packages/test-support` khai `@testcontainers/postgresql` trong `dependencies` suốt từ Task 3 tới lần chạy CI đầu tiên; thứ làm nó lộ ra là **hai advisory HIGH trên `undici`**, không phải một lớp canh nào. Một gói kiểm thử **không có advisory** vẫn nằm im trong đồ thị prod và **không lớp nào kêu**. Cách đóng đúng: một test đọc mọi `package.json` của workspace và khẳng định tập phụ thuộc sản xuất đúng bằng một danh sách được ghim | `packages/test-support/package.json`, `.github/workflows/ci.yml` (bước *Audit phu thuoc (cong chan)*) |
| 22 | ~~**Job `evidence` vẫn CHƯA từng chạy trên CI.**~~ **ĐÃ ĐÓNG** ở run `33221142361`: job chạy đủ, 672 khẳng định, 24/47, *"Cổng evidence: XANH"*, và bước so byte với bản đã commit đã chạy và qua. Toàn bộ khoản nợ *"chưa chạy trên CI thật"* nay đã trả hết. Giữ hàng này để đối chiếu, không xoá | `.github/workflows/ci.yml` (job `evidence`) |
| 23 | **Phía Android của WebCrypto chưa từng được đo, và việc đó đã được HOÃN CÓ CHỦ ĐÍCH ngày 2026-08-29** vì trong tay không có máy Android tầm trung/cũ và không có iPhone iOS cũ. Đây **không phải** rủi ro đã đóng; nó là rủi ro **được chấp nhận tạm** với hai điều kiện ghi rõ: ⑴ **phải đo trước khi CHỐT ADR-011** (S1.4), vì sau khi đã có phong bì thật thì đổi thoả thuận khoá là một cuộc di trú chứ không phải sửa cấu hình; ⑵ chừng nào ô ấy còn trống, **không tài liệu nào được viết *"đã đo trên webview"* mà không kèm `iOS 18.7`**. Giảm nhẹ đã có: ADR-011 buộc phong bì **mang mã thuật toán thoả thuận khoá**, nên đổi sang P-256 về sau là **thêm một nhánh**, không phải viết lại | `tools/do-webcrypto/ket-qua-do.md` §4 (quyết định hoãn, có ngày) |

## Kiến trúc

Đã chốt và ghi ở `docs/ARCHITECTURE.md`: modular monolith TypeScript, `unseal-worker` tách riêng
giữ độc quyền giải mã, PostgreSQL đa tổ chức cô lập bằng RLS, mã hoá lai thực hiện phía trình
duyệt nhà cung cấp.

**Phần đã hiện thực hoá:** nền tảng dữ liệu (RLS + FORCE trên mọi bảng tenant), sổ kiểm toán
chuỗi hash cưỡng chế ở tầng DB, danh tính/vai trò/quyền/MFA, outbox, bọc khoá theo tổ chức, và
ranh giới `unseal-worker` cưỡng chế bằng dependency-cruiser.
**Phần chưa có dòng mã nào:** toàn bộ luồng nghiệp vụ (RFQ → mời → nộp → đóng → mở thầu → award)
và toàn bộ tầng HTTP/giao diện.

## Trạng thái kiểm thử

**672 test, xanh toàn bộ:** 346 ở `pnpm test` (T0–T2) và 326 ở `pnpm test:int` (T3, Postgres thật
qua Testcontainers). `pnpm t0` exit 0, 78 module / 187 phụ thuộc. Vòng fix cuối thêm **20 test**,
tất cả ở `tools/inv-matrix/src/danh-gia.test.ts` cho cơ chế `MOC_GHIM` — xem *Lớp canh cho lần sau*.

**`evidence/INV-matrix.md`: 24/47 bất biến được kiểm chứng — 11/34 nghiệp vụ + 13/13 hàng rào.**

### Hoà giải hai cách đếm (việc Task 11 sinh ra để làm)

Dự án có **hai cách đếm**, cả hai đúng trong phạm vi của mình, và việc lẫn lộn chúng đã sinh ra
ba con số trong ba tài liệu:

- **34** = bất biến **nghiệp vụ** (nhóm A–G): hành vi của sản phẩm với dữ liệu khách hàng.
- **13** = bất biến **hàng rào** (nhóm H): một biện pháp kiểm soát của chính dự án có còn răng không.
- **47** = tổng, và **đây là mẫu số của ma trận**.

Con số **44** (34 + 10) trong kế hoạch S0 đã **thiu** — H11/H12 thêm ở Task 9, H13 ở Task 10.
Con số **23/44** ở điều kiện hoàn thành mục 5 lệch với **24/47** thật vì **ba lý do độc lập**:

1. mẫu số 44 → **47** (ba hàng rào mới);
2. tử số hàng rào 10 → **13** (cùng ba hàng rào ấy, đều đã phủ);
3. tử số nghiệp vụ 13 → **11**: **G2 và G4 không có lớp**, và một hàng thứ ba (**B2**) từng
   trông như đã phủ **chỉ vì một nhãn sai** — xem dưới.

### Bốn hàng trống, và đó là trạng thái ĐÚNG

`C2`, `D4`, `G2`, `G4` không có một test nào mang nhãn, và mỗi mã có một lý do đã đo, ghim trong
`tools/inv-matrix/src/danh-gia.ts` và in ra §3 của ma trận. **Nguy hiểm không nằm ở chỗ chúng
trống; nó đến khi ai đó lấp chúng bằng NHÃN thay vì bằng LỚP.**

Chuyện đó **đã xảy ra hai lần** và cả hai lần đều bị bắt:

- Vòng fix 1 của **Task 9**: năm test mang `[INV-G2]` thật ra đo quy tắc biên giới depcruise →
  sửa về `[INV-H11]`.
- **Task 11**: một test mang `[INV-B2]` ("nhà cung cấp kiểm chứng biên nhận độc lập được") thật
  ra đo *bộ kiểm chứng phát hiện SỬA NỘI DUNG dưới `=` bị cướp* → sửa về `[INV-B3]`. Chủ ngữ của
  B2 — báo giá, biên nhận, chữ ký — không tồn tại ở S0. Nếu để nguyên, ma trận sẽ nói với kiểm
  toán viên một câu **không có gì chống lưng**.

Cùng lượt, bốn test mang `[INV-M5]` được sửa về `[INV-F1]`: `M` không thuộc dải `[A-H]` và `M5`
không có trong sổ đăng ký — `[M5]` là **số hiệu một mũi đột biến** của vòng review Task 4/6, hai
không gian tên bị lẫn. Bộ sinh nay **báo ra** mọi nhãn `[INV-…]` trỏ tới mã không có trong sổ.

### Lớp canh cho lần sau

`pnpm evidence` **đỏ thật** (không `continue-on-error`) khi: một mã chưa phủ mà không nằm trong
danh sách được ghim; một mã **trong** danh sách mà **đã** được phủ; một test mang nhãn bất biến
đang đỏ hoặc bị bỏ qua; một nhãn trỏ tới mã không tồn tại; hoặc số hàng đọc được từ
`docs/TEST-PLAN.md` lệch với một phép đếm độc lập. Bước CI kế tiếp sinh lại ma trận và
`git diff --exit-code` — một lần sửa tay `evidence/INV-matrix.md` chết ở đó.

**Vòng fix cuối thêm bốn phép kiểm nữa, và chúng đóng một khe hở ĐO ĐƯỢC.** Câu cũ ở đây nói
*"danh sách chỉ co lại"* như thể đó là hệ quả của ràng buộc hai chiều. Không phải: ràng buộc ấy
chỉ kích hoạt khi một mã **vừa có test vừa ở trong danh sách**, nên hai thay đổi bù trừ nhau
trong cùng một PR đi lọt — đo được hai lần, cả hai cho `exit 0` và *"Cổng evidence: XANH"*:

1. xoá test của một mã **và** thêm mã đó vào danh sách ⇒ **hồi quy độ phủ đi lọt**;
2. thêm một mã mới vào **sổ đăng ký** và vào **danh sách** ⇒ danh sách **nở ra**, mẫu số nở, tử
   số đứng yên, không một dòng đỏ nào.

Cả hai nay chết ở **`MOC_GHIM`** trong `tools/inv-matrix/src/danh-gia.ts` — hai con số ghim, đỏ
khi lệch về **bất kỳ chiều nào**: `soPhuToiThieu = 24` (tử số không được tụt; tăng thì phải nâng
mốc bằng tay) và `coDanhSachToiDa = 23` (danh sách không được nở). Cộng thêm: năm mã bắt buộc
giữ ghi chú §4 (`MA_PHAI_CO_CO_HEP` — gỡ một cờ làm cả cờ lẫn mục §4 biến mất mà ma trận sinh
lại **vẫn khớp byte**), và **mọi mệnh đề HỘI mang ô ✅ đều phải có ghi chú §4**, vế sau *dẫn
xuất* từ chính câu chữ ở sổ đăng ký nên mệnh đề hội mới của S1 tự rơi vào phạm vi.

**Giới hạn còn lại, nói thẳng.** Ba lớp, ba kích cỡ khác nhau:

1. bộ sinh gom theo **nhãn**, và nhãn do người viết đặt. Nó đóng được ca "nhãn trỏ tới mã không
   tồn tại" và đóng chặt; nó **không** đóng được ca "nhãn đúng cú pháp, gắn lên một test đo thứ
   khác". Lớp phòng thủ duy nhất cho ca đó vẫn là đọc tên test;
2. một PR sửa mã, sửa danh sách **và** sửa cả hai con số ghim cùng lúc vẫn xanh. Không phép đo
   nào chặn được điều đó — khác biệt là lúc ấy nó là một **dòng phải sửa, có tên, trong một file
   có chủ sở hữu**, không phải một sự im lặng;
3. `.github/CODEOWNERS` nay phủ `/tools/inv-matrix/`, `/docs/TEST-PLAN.md`, `/docs/STATE.md` và
   `/evidence/` — nhưng nó trỏ tới `@trustprocure/bao-mat`, một team **chưa được tạo**, nên hôm
   nay nó **chưa cưỡng chế gì** (nợ 18).

**Job `evidence` chưa từng chạy trên một CI thật** (`git remote -v` rỗng) và chưa nằm trong tập
check bắt buộc của branch protection — điều kiện hoàn thành S0 mục 2, vế *"và trên CI"*, vẫn
chưa xác minh.

## Trạng thái triển khai

Chưa triển khai. ~~Chưa chọn hạ tầng đích, chưa chọn nhà cung cấp KMS (**ADR-009**, trạng thái
*Đang mở*, giữa AWS KMS, Azure Key Vault và HashiCorp Vault).~~

**Cập nhật 2026-08-29 — cả hai đã chốt: AWS, và AWS KMS ở `ap-southeast-1` (ADR-009).** Chốt
cùng lúc là bắt buộc chứ không phải tiện tay: ADR-006 (tách quyền giải mã cho `unseal-worker`)
chỉ cưỡng chế được bằng IAM của nơi compute chạy, nên **chọn hạ tầng đích là câu hỏi trước,
KMS là hệ quả** — bản đầu của ADR-009 liệt kê ba nhà cung cấp như thể đó là một câu hỏi đứng
riêng, và đó là chỗ nó đặt sai thứ tự. Vẫn **chưa triển khai**: chưa có tài khoản, chưa có
CMK, chưa có role nào được tạo.

> Hai dòng trong tài liệu này (mục *Điểm chặn* 2 và dòng trên) từng trích **ADR-004** như
> *"quyết định KMS để mở"*. **Sai:** ADR-004 là *Sổ kiểm toán chuỗi hash, chỉ ghi thêm*, đã chốt.
> Quyết định về khoá thuộc **ADR-002**, cũng đã chốt, và ADR-002 **không** để mở nhà cung cấp.
> Tức cho tới hết S0, **8/8 ADR đều "Đã chấp nhận" — không một ADR nào ở trạng thái mở — trong
> khi một quyết định đang thật sự chặn S1.6.** Cái treo là có thật; cái thiếu là một chỗ để nó
> treo. **ADR-009** được thêm để làm chỗ đó. Trích dẫn sai thứ ba nằm ở bản kế hoạch S0 (~dòng
> 4646) và đã được gạch bỏ tại chỗ.

## Hành động tiếp theo

> **Bốn hành động dưới đây đã được xử lý trong lượt 2026-08-29. Giữ nguyên văn, đánh dấu tại
> chỗ, để đối chiếu — không xoá.**

1. ~~**Lập kế hoạch S1 (Sealed Bid Core).**~~ **XONG** — `docs/superpowers/plans/2026-08-29-s1-sealed-bid-core.md`.
   23 mã chưa phủ ở §3 của `evidence/INV-matrix.md` là danh sách công việc S1 đã được sắp sẵn —
   mỗi mã một lý do, và mỗi lý do là một hạng mục. Kế hoạch ánh xạ **đủ 23 mã** vào 9 hạng mục,
   cộng **5 mã ở §4** như nợ phải trả, và ghim quỹ đạo `MOC_GHIM` cho từng mốc.
2. ~~**Chốt ba quyết định treo** (Điểm chặn 2) — KMS phải chốt trước S1.6.~~ **XONG HAI TRONG BA**:
   hạ tầng đích **AWS** và **AWS KMS** `ap-southeast-1` (ADR-009, nay *Đã chấp nhận*). Còn treo:
   xử lý thư mục `Vibe Coding/`.
3. ~~**Đo `crypto.subtle` trong webview Zalo/Messenger** (Vấn đề đã biết 3) — rủi ro sản phẩm CAO
   và vẫn chưa có một phép đo nào.~~ **CÔNG CỤ XONG, PHÉP ĐO CHƯA.** `tools/do-webcrypto/` đã có
   và đã chứng minh có răng, nhưng nó **chưa từng chạy trên một webview Việt Nam nào**. Rủi ro
   vẫn **CAO và vẫn mở** — xem Vấn đề đã biết 3.
4. Tiếp cận **khách hàng pilot** song song với S1. — **CHƯA LÀM.** Đây là việc duy nhất trong
   bốn việc không có phần kỹ thuật nào để trú, và nó vẫn là rủi ro lớn nhất của dự án.

**Hành động tiếp theo, sau lượt 2026-08-29:**

5. **Mở `tools/do-webcrypto/index.html` qua một URL https, từ bên trong Zalo và Messenger, trên
   vài điện thoại thật** — Android WebView cũ, iOS WKWebView. Phải xong **trước S1.4**.
6. **Chốt ADR-010** (đường thông báo tức thì cho break-glass) trước S1.6; **ADR-011** (định dạng
   phong bì cộng chữ ký biên nhận) trong S1.4; **ADR-012** (ID không tuần tự) trong S1.1.
7. **Bắt đầu S1.1 và S1.2** — hai hạng mục duy nhất không bị chặn bởi quyết định nào.

> Hành động cũ *"Chạy `security-reviewer` cho Task 7, 8, 9"* đã được **gỡ**: các lượt review ấy
> đã xảy ra (xem `evidence/security-reviews.md`). Nó ra đời từ đúng lời khai sai đã gạch bỏ ở
> mục 8 của bảng điều kiện hoàn thành — một ví dụ sống cho việc một câu sai trong tài liệu trạng
> thái tự sinh ra công việc thừa.

## Tham chiếu

| Tài liệu | Nội dung |
|---|---|
| `docs/PRODUCT.md` | Định vị, phạm vi, ràng buộc sản phẩm, những điều không được tuyên bố |
| `docs/ARCHITECTURE.md` | Kiến trúc hiện tại |
| `docs/DECISIONS.md` | **Chín ADR, cả chín *Đã chấp nhận*** — 009 (nhà cung cấp KMS) chốt **AWS KMS** ngày 2026-08-29, gỡ chặn S1.6 |
| `docs/TEST-PLAN.md` | **Sổ đăng ký 47 bất biến** (34 nghiệp vụ + 13 hàng rào), bảy tầng kiểm thử, evidence pack |
| `evidence/INV-matrix.md` | **Ma trận bất biến** — sinh tự động, không sửa tay |
| `evidence/security-reviews.md` | **Dấu vết review an ninh** — một dòng mỗi task, commit được review, môi trường đo, phát hiện theo mức, commit đóng |
| `docs/superpowers/specs/2026-08-26-trustprocure-s0-s1-design.md` | Đặc tả thiết kế S0+S1 đã duyệt |
| `docs/superpowers/plans/2026-08-27-s0-foundation.md` | Kế hoạch triển khai S0 — 11 task, 92 bước |
| `Vibe Coding/CLAUDE.md` | Phương pháp làm việc (bản copy thủ công — xem Vấn đề đã biết 2) |
