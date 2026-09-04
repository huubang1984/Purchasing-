# STATE — TrustProcure V2

> Bộ nhớ trạng thái hiện tại của dự án. Đọc trước mọi việc quan trọng, đối chiếu với mã
> nguồn thật — mã, test và hành vi runtime là bằng chứng mạnh hơn tài liệu này.
> Không bao giờ ghi "đã xong / đã test / đã sửa / đã triển khai" nếu chưa thực sự kiểm chứng.

**Cập nhật lần cuối:** 2026-08-29 (sau khi hợp nhất S0 vào `master`, lập kế hoạch S1, và chốt ba
ADR của các hạng mục sớm nhất — ADR-013/014/015)

---

## Cột mốc hiện tại

~~**Giai đoạn: S0 (Nền móng) — MÃ NGUỒN ĐÃ CÓ, mười một task đã commit. S1 chưa bắt đầu.**~~

**Giai đoạn: S0 ĐÃ HỢP NHẤT VÀO `master`** (merge commit `30d1972`, giữ nguyên 46 commit).
**S1 đã có KẾ HOẠCH ĐẦY ĐỦ, chưa viết một dòng mã nào.** ~~Hai hạng mục đầu (S1.1, S1.2) không
bị quyết định nào chặn và có thể bắt đầu ngay.~~ **Câu vừa gạch HẸP HƠN thực tế và theo hướng
nguy hiểm:** S1.1 và S1.2 không bị ADR nào *đang mở* chặn, nhưng mỗi hạng mục **mang một quyết
định kiến trúc chưa có chỗ để treo** — phạm vi sổ nhà cung cấp, và nơi cưỡng chế máy trạng thái
RFQ. Cả hai phải chốt **trước** migration `008`. Đây đúng khuôn lỗi ADR-009 đã dạy: *cái treo là
có thật; cái thiếu là một chỗ để nó treo*. **Đã đóng 2026-08-29 bằng ADR-013, ADR-014 và ADR-015**
(cho S1.3). Ba hạng mục sớm nhất nay có đủ quyết định để bắt đầu.

Đã xong:

- Thiết kế S0+S1, sáu lát cắt dọc S0–S5, ~~**chín ADR**~~ ~~**mười hai ADR**~~ ~~**mười lăm ADR**~~ ~~**mười tám ADR**~~ **mười chín ADR** (ADR-011 **chốt 2026-09-04**, hết chặn S1.4; **ADR-019 cùng ngày** — nơi cặp khoá RFQ ra đời) (bảy ở giai đoạn thiết kế,
  ADR-008 ở Task 9, ADR-009 ở vòng fix cuối, **ADR-010/011/012 ngày 2026-08-29 khi lập kế hoạch S1**,
  **ADR-013/014/015 cùng ngày cho ba hạng mục sớm nhất**, **ADR-016/017/018 ngày 2026-08-30 cho ba
  MEDIUM mà vòng sửa an ninh cố ý không đóng bằng mã**), sổ đăng ký bất biến, kiến trúc kiểm thử bảy tầng.
- **Mười một task của kế hoạch S0 đã commit** (`docs/superpowers/plans/2026-08-27-s0-foundation.md`).
- Hai hook `git-safety` / `protect-secrets` đã viết lại fail-closed và có test.
- Monorepo pnpm, CI bốn job, cổng tĩnh T0 (tsc + eslint + dependency-cruiser + gitleaks + audit).
- ~~Bảy~~ ~~Tám~~ ~~Chín~~ ~~Mười~~ **Mười bảy** migration `001`–**`017`** + `hardening.always.sql`: role, tổ chức, người
  dùng, sổ kiểm toán chuỗi hash, vai trò/quyền, phiên + MFA, outbox, **sổ nhà cung cấp (S1.1)**,
  **RFQ + hạng mục + phê duyệt + máy trạng thái (S1.2)**, **lời mời + magic link + OTP + phiên
  khách (S1.3)**, **danh tính là dẫn xuất (013/016)**, **chính sách mua sắm (014)**, **pepper OTP
  (015)**, **vật liệu khoá RFQ (017, S1.4)**.
- `KeyProvider` + adapter `local-dev` bọc khoá theo tổ chức có phiên bản, công cụ đo hiệu năng.
- **Evidence pack**: `pnpm evidence` sinh `evidence/INV-matrix.md` từ `docs/TEST-PLAN.md`.

- **S1.4 — phong bì niêm phong (2026-09-04):** migration `017` (`rfq_key_material`), gói
  `packages/sealed-envelope` với **hai cửa** đúng khuôn `packages/crypto-keys`, và **ba mã nghiệp
  vụ được lấp: C5, G2, G4** — độ phủ **30/50 → 33/50**, phần nghiệp vụ 14 → 17.

  **Con số đáng đọc nhất của hạng mục này là một dòng do chính ma trận tự sinh ra:** *"Trong 13 mã
  mục tiêu của S0, số còn chưa phủ: **không còn mã nào**"*. G2 và G4 là hai mã S0 tự đặt làm mục
  tiêu rồi không giao được; chúng đóng ở đây, bốn hạng mục sau.

  **Khoản nợ `[NỢ ADR-006]` cũng đóng, và nó đóng đúng cách nó được hẹn — bằng một lần ĐỎ.** Test
  *"app_unseal vẫn là tập con quyền của app_api"* (Task 4) tự viết cho tương lai một thông điệp:
  khi nào có bảng khoá riêng RFQ thì test này sẽ đỏ. Lượt chạy đầu sau khi `017` áp: nó **đỏ**,
  đúng như thế. Bản mới đo **mạnh hơn** — nó đòi CẢ HAI chiều (không role nào bao trùm role kia),
  mỗi chiều neo vào một khoá cụ thể.

  Ba thứ được ghi ra thay vì nuốt vào ô ✅: G1 có một vế **thu hẹp MỚI** (tiến trình `api` **có**
  chạm khoá riêng dạng rõ trong cửa sổ của đúng một hàm — ADR-019); G2 mang cờ §4 vì mệnh đề nói
  *một* cặp khoá còn hiện thực cho *hai*; G4 mang cờ §4 vì mệnh đề liệt kê **bốn** thao tác còn
  S1.4 có **ba** — vế *mở bọc* không có một dòng mã nào và nó thuộc S1.6.
- **S1.3 — lời mời, magic link, OTP, phiên khách (2026-08-29):** migration `010` (`rfq_invitations`,
  `rfq_invitation_tokens`, `invitation_otp_challenges`, `otp_rate_limits`, `guest_sessions`), gói
  `packages/invitation`. **Ba mã NGHIỆP VỤ đầu tiên của S1 được lấp: E1, E2, E5.** Vế *giới hạn
  tần suất* của **E3** — vế không có một dòng mã nào trong toàn S0 — nay CÓ LỚP, nhưng chỉ trên
  đường OTP của lời mời; đường TOTP vẫn trống, và ghi chú §4 nói đúng điều đó.
- **S1.2 — RFQ, hạng mục, máy trạng thái (2026-08-29):** migration `009` (`rfq_packages`,
  `rfq_items`, `rfq_approvals`), gói `packages/rfq`, và **H16** — biên giới module SUY TỪ TÍNH
  CHẤT cho mọi gói trong `packages/`. Máy trạng thái nằm ở tầng CSDL đúng như ADR-014 chốt, và
  điều đó đã được ĐO bằng một `UPDATE` đi vòng qua ứng dụng cộng một lượt gỡ trigger.
- **S1.1 — sổ nhà cung cấp Level 0/1 (2026-08-29):** migration `008` (`suppliers`,
  `supplier_contacts`), gói `packages/supplier`, và **hai hàng rào mới vào sổ đăng ký** —
  **H14** (bộ dò oracle xuyên tổ chức qua ràng buộc duy nhất) và **H15** (biên giới module của
  `packages/supplier`, họ quy tắc `g5-` cộng danh sách trắng barrel).

Chưa xong:

- ~~Toàn bộ S1~~ ~~**S1.2–S1.9**~~ ~~**S1.3–S1.9**~~ ~~**S1.4–S1.9**~~ **S1.5–S1.9**: nộp báo giá, mở thầu, so sánh, T5, E2E.
- `apps/` **rỗng**. Không có một đường gọi sản phẩm nào tới `listOrganizations`, `start()` của
  outbox runner, hay `assertFreshMfa` — các gói đã có được test gọi, chưa có ứng dụng gọi.

## Công việc đang làm

> *** VÒNG SỬA ĐÃ XONG: 4/4 CRITICAL và 10/11 HIGH đã đóng; HIGH còn lại đã bị PHÉP ĐO BÁC BỎ. ***
> Hai migration mới — `011_rfq_hardening.sql` và `012_invitation_hardening.sql` — cộng bản viết
> lại của `packages/invitation`. Chuỗi tấn công đã đo được nay là một bộ test: từng bước từng
> THÀNH CÔNG nay bị chặn, mỗi phép chặn kèm một vế đối chứng dương, và hai phép chặn được đo bằng
> câu SQL VIẾT TAY vì đó là chỗ duy nhất chứng minh lớp nằm ở CSDL. Chi tiết:
> `evidence/security-reviews.md` §*Vòng sửa sau review*.
>
> **Ba phát hiện MEDIUM cố ý KHÔNG sửa**, vì đóng chúng là một quyết định kiến trúc chứ không
> phải một dòng mã: cổng quyền của `packages/supplier` nằm ở gói hay ở tầng API; chính sách nào
> tính `requires_dual_approval`; và pepper cho băm đích của bộ đếm hạn mức. ~~Cả ba cần một ADR.~~
> **Cả ba ĐÃ CÓ ADR ngày 2026-08-30: ADR-016, ADR-017, ADR-018.** Ba ADR ấy **quyết**, chúng
> **chưa cài** — không một dòng mã sản phẩm nào đổi trong lượt đó, và mỗi ADR để lại phần *Đo bằng
> gì* của riêng nó. Chừng nào chưa có lượt **RED thật**, ba MEDIUM này vẫn **mở**.
>
> **Một việc ADR-016 sinh ra và nó có mốc chết:** cổng quyền đặt ở tầng ứng dụng là **mặc định
> MỞ**, nên nó phải kèm một lớp máy — và lớp ấy **chưa dựng được vì `apps/` rỗng**. Điều kiện đã
> ghim: **route đầu tiên của `apps/` phải ra đời CÙNG LÚC với lớp canh ấy.** Viết route trước, lớp
> canh sau, là đúng thứ tự đã sinh ra khoản nợ 17.
>
> **Một việc ADR-017 sinh ra và nó chạm lược đồ:** `rfq_packages` cần `estimated_value` + phiên bản
> chính sách, và một bảng `org_procurement_policies`. Đây là **migration đánh số mới** — 009 không
> được đụng, nên câu *"ngưỡng D2 không lưu dưới dạng một số tiền"* ở đầu 009 được thu hẹp **ở nơi
> khác**, đúng cách đóng đã ghi cho khoản nợ 19.
>
> **Một khả năng ADR-018 mở ra và nó có thể RẺ HƠN việc cài pepper:** sau 011/012, `destination_hash`
> **gần như dư** — đích đọc từ `supplier_contacts` và `app_api` **không còn `UPDATE`** trên bảng ấy.
> Nếu pepper bị coi là đắt, câu trả lời đúng là **bỏ cột**, không phải giữ cột với băm đảo ngược được.

> ~~*** BA HẠNG MỤC ĐẦU KHÔNG ĐƯỢC COI LÀ XONG. ***~~ Ba lượt `security-reviewer` chạy ngày
> 2026-08-29 tìm ra **4 CRITICAL + 11 HIGH**, và điều kiện hoàn thành S1 mục 6 đòi *mọi phát
> hiện CRITICAL/HIGH đã được xử lý*. **Chưa một phát hiện nào được sửa.** Việc duy nhất đã làm
> ~~là gỡ một lời khai sai~~ **đã gỡ một lời khai sai** khỏi `evidence/INV-matrix.md`: E2 và E5 từng bị khai là ĐÃ PHỦ, và
> chuỗi tấn công chứng minh điều đó sai đã được dựng lại thành phép đo. Độ phủ **30/50 → 28/50**,
> và sau vòng sửa **28/50 → 30/50** — lần này kèm một chuỗi đối chứng, và cả hai mã mang cờ §4.
> Chi tiết từng phát hiện: `evidence/security-reviews.md` §S1.

~~**S1 — ba hạng mục đầu ĐÃ XONG và đã commit (S1.1, S1.2, S1.3).**~~ Ba hạng mục đã có MÃ và
đã commit, nhưng chưa đạt điều kiện hoàn thành. ~~Hạng mục kế tiếp là **S1.4**
(phong bì niêm phong), và nó **BỊ CHẶN**: ADR-011 vẫn *Đang mở*, và ADR-011 chỉ được chốt sau khi
có kết quả đo WebCrypto trên **webview Android** (khoản nợ 23). Đây không phải một điều kiện hình
thức — sau khi đã có phong bì thật thì đổi thoả thuận khoá là một cuộc di trú, không phải sửa một
ADR.~~

**S1.4 HẾT BỊ CHẶN 2026-09-04, và cách nó hết chặn là phần đáng đọc: câu hỏi được GỠ BỎ chứ không
được trả lời.** Thế lưỡng nan *X25519 hay P-256* là do chính ADR-011 tự đặt ra dưới dạng
**hoặc/hoặc**, và phép đo Android chỉ cần thiết cho cái hoặc/hoặc ấy. ADR-011 nay chốt **cả hai**:
P-256 mặc định, X25519 cơ hội, chọn bằng chính `tools/do-webcrypto` **lúc chạy**. Phong bì đã mang
mã thuật toán tường minh từ trước — đó là thứ làm quyết định này khả thi. Khoản nợ 23 **vẫn mở**;
nó chỉ thôi chặn.

> **Một khoảng trống của S1.1 đã được ghi ra thay vì lấp bằng nhãn:** test *"người liên hệ của tổ
> chức A KHÔNG treo được vào nhà cung cấp của tổ chức B"* (`packages/supplier/src/suppliers.int.test.ts`)
> **cố ý không mang nhãn `[INV-...]`**. Nó đo một tính chất thật — ràng buộc tham chiếu phải nằm
> TRONG một tổ chức — nhưng sổ đăng ký 49 mã **không có mệnh đề nào phát biểu điều đó**: F1 nói
> về TRUY VẤN bị ràng buộc `org_id`, F2 nói về IDOR, F3 nói về khoá. Gắn một trong ba nhãn ấy lên
> đây là lấp mã bằng NHÃN thay vì bằng LỚP. Nếu mệnh đề này đáng vào sổ, nó phải vào sổ tường minh
> — và đó là một quyết định, không phải một dòng thêm vào lặng lẽ.
>
> **S1.2 thêm mệnh đề thứ hai cùng loại:** *hạng mục của một RFQ chỉ sửa được khi RFQ còn ở
> DRAFT/PENDING_APPROVAL* (trigger `rfq_items_chi_sua_khi_soan` ở 009). Nó chống một thứ thật —
> đổi đề bài sau khi nhà cung cấp đã đọc danh sách hạng mục — và sổ đăng ký 50 mã không có mệnh
> đề nào nói điều đó. C4 nói về DEADLINE, không về NỘI DUNG. Test của nó cũng không mang nhãn.
>
> **ADR-016 thêm mệnh đề thứ BA cùng loại (2026-08-30):** *danh tính ghi vào sổ kiểm toán là DẪN
> XUẤT của một phiên, không phải một lời khai của người gọi* — trigger `kiem_danh_tinh_theo_phien`
> ở `013`, cộng 14 test mới ở hai gói. Sổ đăng ký 50 mã **không có mệnh đề nào nói điều đó**: D5
> nói về *ghi sổ mỗi lần TỪ CHỐI quyền*, F2 nói về IDOR. Gắn D5 lên đây là đúng thứ ADR-016 mục 3
> cấm bằng chữ, nên **14 test ấy cố ý không mang nhãn** và độ phủ đứng yên ở **30/50** — trong khi
> số khẳng định đi từ 758 lên **772**.
>
> **Ba mệnh đề này nên được đưa vào sổ đăng ký hay không là một quyết định cần người chốt.**
> Ghi ở đây thay vì tự quyết vì thêm một mã vào sổ làm đổi mẫu số của mọi con số độ phủ.

~~Không có.~~ Task 11 là task cuối của S0; sau đó là **một vòng fix cuối** đóng bốn việc văn bản/cấu hình của review toàn nhánh (không sửa một dòng mã sản phẩm nào), và **một vòng fix CI** đóng ba lỗi mà lần chạy CI đầu tiên phát hiện (cũng không sửa một dòng mã sản phẩm nào — hai file test, một `package.json`, một workflow, hai tài liệu).

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
| 1 | **Chưa có khách hàng pilot** | Rủi ro xây đúng thứ theo sai thứ tự — lớn hơn mọi rủi ro kỹ thuật | **VẪN CHƯA XỬ LÝ.** 2026-09-04 lập `docs/TIEN-DE-CHUA-DO.md`: **17 tiền đề** về người mua/nhà cung cấp mà mã đang cư xử như thật, mỗi dòng trỏ tới một chỗ có địa chỉ trong kho. Nó **HẠ CHI PHÍ** của buổi làm việc đầu tiên xuống một tiếng đồng hồ đi hết một danh sách — nó **KHÔNG gỡ hộ** điểm chặn này |
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
| 5 | `[M10]` flaky tiền tồn | THẤP | ~~Ghi nhận từ vòng review trước, chưa truy nguyên~~ **QUAN SÁT LẦN THỨ HAI (2026-08-29, vòng sửa sau review an ninh), và lần này có CHỮ KÝ.** Test `[fix round 5 — M10]` ở `packages/db/src/migrate.int.test.ts:540` đỏ trong một lượt `pnpm evidence` toàn bộ, **xanh khi chạy riêng file ấy**. Khẳng định đỏ là `expect(rows[0]?.n).toBe(0)` trên `SELECT count(*) FROM pg_locks WHERE locktype='advisory'` — thu được **1**, chờ **0**. Hai khẳng định ngay trước (`poolThuong.totalCount`/`idleCount` = 0) thì QUA, tức client phía Node đã bị huỷ. **GIẢ THUYẾT, chưa kiểm chứng:** đây là cùng cơ chế mà lần chạy CI đầu tiên đã đo và ghi ở mục 2 — *`await pool.end()` chỉ bảo đảm phía CLIENT*; backend phía server chưa kịp thoát nên advisory lock của nó chưa được nhả tại đúng khoảnh khắc câu đếm chạy. Nếu giả thuyết đúng thì bản vá cùng hình dạng với bản vá T3 của S0: **chờ `pg_stat_activity` hết backend rồi mới đếm**, thay vì đếm ngay. **Điểm dữ liệu thứ hai, cùng ngày:** lượt `pnpm evidence` chạy lại NGAY SAU đó, cùng cây mã, **XANH TOÀN BỘ** — 758 test, 0 file đỏ, vitest thoát mã 0. Hai lượt liên tiếp cho hai kết quả khác nhau trên cùng một cây: đây là bằng chứng FLAKY, không phải hồi quy. **Cố ý KHÔNG sửa trong vòng này**: nó là một test tiền tồn, không thuộc phạm vi review an ninh, và sửa một flake bằng một giả thuyết chưa đo là đúng thứ dự án phạt |

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
| 23 | **VẪN MỞ, nhưng THÔI CHẶN S1.4 kể từ 2026-09-04.** ADR-011 được chốt bằng cách **gỡ bỏ thế hoặc/hoặc** — hỗ trợ CẢ HAI thuật toán, chọn bằng chính máy dò lúc chạy — nên phép đo Android tụt từ **cổng chặn** xuống **con số vận hành**. Lượt tra dữ liệu công bố 2026-09-04 còn cho một **kết quả ÂM đáng ghi**: phân bố phiên bản Android System WebView **không tra được** từ dữ liệu tổng hợp miễn phí, tức câu hỏi cũ *không* trả lời được bằng cách đọc, chỉ bằng cách thuê máy thật — và ngay cả thế cũng chỉ cho một mẫu. Xem `tools/do-webcrypto/ket-qua-do.md` §3c. Nguyên văn cũ giữ lại: **Phía Android của WebCrypto chưa từng được đo, và việc đó đã được HOÃN CÓ CHỦ ĐÍCH ngày 2026-08-29** vì trong tay không có máy Android tầm trung/cũ và không có iPhone iOS cũ. Đây **không phải** rủi ro đã đóng; nó là rủi ro **được chấp nhận tạm** với hai điều kiện ghi rõ: ⑴ **phải đo trước khi CHỐT ADR-011** (S1.4), vì sau khi đã có phong bì thật thì đổi thoả thuận khoá là một cuộc di trú chứ không phải sửa cấu hình; ⑵ chừng nào ô ấy còn trống, **không tài liệu nào được viết *"đã đo trên webview"* mà không kèm `iOS 18.7`**. Giảm nhẹ đã có: ADR-011 buộc phong bì **mang mã thuật toán thoả thuận khoá**, nên đổi sang P-256 về sau là **thêm một nhánh**, không phải viết lại | `tools/do-webcrypto/ket-qua-do.md` §4 (quyết định hoãn, có ngày) |
| 24 | **HAI test FLAKY, cùng một họ, và họ ấy nay có tên.** `[M10]` (`packages/db/src/migrate.int.test.ts` — đếm advisory lock còn sót) và `[T10-L]` (`packages/outbox/src/outbox.int.test.ts` — `destroyConnectionWhenDone`) đều **đỏ trong lượt chạy đầy đủ và XANH khi chạy riêng**, cả hai quanh **vòng đời kết nối dưới tranh chấp Docker**. Chúng chưa được sửa **có chủ đích**: chưa có phép đo nào phân biệt được *"lớp bị hỏng"* với *"máy chạy chậm"*, và sửa mù bằng cách nới ngưỡng là đúng thứ biến một phép đo thành một lời khai. Cách đóng đúng: một lượt chạy lặp (`--repeat`) trên CI để đo TỶ LỆ, rồi mới quyết định | `packages/db/src/migrate.int.test.ts:540`, `packages/outbox/src/outbox.int.test.ts:1404` |
| 25 | **Vế *mở bọc* của G4 chưa có một dòng mã nào, và nó là vế một kiểm toán viên hỏi tới ĐẦU TIÊN.** S1.4 ghi sổ kiểm toán cho *sinh* (một bản ghi, vì sinh và bọc là một hành vi) và *huỷ*; *mở bọc* sống trong `apps/unseal-worker`, thứ chưa tồn tại. Đây là **phần chênh đã được khai báo** ở §4 của ma trận chứ không phải một khoảng trống bị quên — nhưng nó là khoản nợ mà **S1.6 phải trả**, không phải một ghi chú vĩnh viễn | `tools/inv-matrix/src/danh-gia.ts` (`PHAM_VI_HEP` mục `G4`) |
| 26 | **Thu hồi vật liệu khoá là một DẤU, không phải một lần XOÁ MẬT MÃ.** Khi một RFQ bị huỷ, `rfq_key_material.revoked_at` được đặt nhưng `wrapped_private_key` **vẫn nằm nguyên trong hàng**. Xoá nó đi sẽ biến *"không ai được mở báo giá của RFQ đã huỷ"* từ một quy tắc **chính sách** thành một sự thật **mật mã** — mạnh hơn hẳn — nhưng nó cũng là một hành động không đảo ngược đứng sau một nút có thể bấm nhầm. Quyết định thuộc S1.6, nơi có cổng chính sách để đặt nó vào | `db/migrations/017_rfq_key_material.sql` khối (4) |

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

~~**672 test, xanh toàn bộ:** 346 ở `pnpm test` (T0–T2) và 326 ở `pnpm test:int` (T3, Postgres thật
qua Testcontainers). `pnpm t0` exit 0, 78 module / 187 phụ thuộc.~~

~~**Sau S1.1 (2026-08-29): 694 test** — 353 `pnpm test` / 341 `pnpm test:int`; t0 86 module / 206 phụ thuộc.~~

~~**Sau S1.2: 724 test** — 363 / 361; t0 91 module / 224 phụ thuộc.~~

~~**Sau S1.3 (2026-08-29): 747 test, xanh toàn bộ**~~ **Sau vòng cài ADR-016/017/018 (2026-08-30 → 09-03): 802 khẳng định, `pnpm evidence` thoát mã 0, 0 file đỏ, độ phủ ĐỨNG YÊN ở 30/50 — xem ba mệnh đề cố ý không mang nhãn ở trên.** Số cũ giữ nguyên văn: — 367 ở `pnpm test` (20 file) và 380 ở
`pnpm test:int` (15 file, Postgres thật qua Testcontainers). `pnpm t0` exit 0, **94 module /
234 phụ thuộc**. `pnpm evidence`: vitest thoát mã 0, 0 file đỏ, *"Cổng evidence: XANH"*. Vòng fix cuối thêm **20 test**,
tất cả ở `tools/inv-matrix/src/danh-gia.test.ts` cho cơ chế `MOC_GHIM` — xem *Lớp canh cho lần sau*.

~~**`evidence/INV-matrix.md`: 24/47 bất biến được kiểm chứng — 11/34 nghiệp vụ + 13/13 hàng rào.**~~

~~**Sau S1.1: 26/49 — 11/34 nghiệp vụ + 15/15 hàng rào.**~~

~~**Sau S1.2: 27/50 — 11/34 nghiệp vụ + 16/16 hàng rào.**~~

~~**Sau S1.3: 30/50 — 14/34 nghiệp vụ + 16/16 hàng rào.**~~ **SAU REVIEW AN NINH: 28/50 —
12/34 nghiệp vụ + 16/16 hàng rào.** Câu dưới đây giữ nguyên văn để đối chiếu, và nó đã sai ở
vế E2/E5. Đây là lần đầu trong S1 con số NGHIỆP VỤ
nhúc nhích: **E1**, **E2**, **E5**. Cả ba nằm trong MỘT hạng mục, và đó là hệ quả của việc chủ ngữ
của chúng — lời mời, token, phiên khách — cuối cùng cũng tồn tại. `MOC_GHIM`: `soPhuToiThieu` 27 →
**30**, `coDanhSachToiDa` 23 → **20** (danh sách được-phép-chưa-phủ CO LẠI đúng ba dòng).

**E2 và E5 vào sổ KÈM ghi chú §4**, và `MA_PHAI_CO_CO_HEP` đi từ năm mã lên **bảy**. Hai phần chênh:
*"kênh đã đăng ký" là kênh do NGƯỜI MUA khai*, và *`verified_contact_id` là NGƯỜI GIỮ KÊNH, không
phải con người đang ngồi trước màn hình*. Không ô ✅ nào ở đây rộng hơn thứ được đo. Hai mã mới (**H14**, **H15**) đều thuộc
nhóm HÀNG RÀO, nên **tử số và mẫu số cùng tăng 2 và số mã NGHIỆP VỤ được phủ ĐỨNG YÊN ở 11**.
Đây là điều đáng đọc kỹ hơn con số tổng: S1.1 dựng thêm hai lớp canh, nó **không** đóng thêm một
mệnh đề nghiệp vụ nào — E4 cần chủ ngữ *"mã RFQ"* của S1.2, A5 cần cả S1.9. `MOC_GHIM`:
`soPhuToiThieu` 24 → **26** → **27**, `coDanhSachToiDa` giữ nguyên **23** qua CẢ HAI hạng mục.

**Con số đáng đọc nhất là con số KHÔNG đổi: 11/34 nghiệp vụ, sau hai hạng mục và ba bảng… năm
bảng.** Đó không phải dấu hiệu công việc chưa tới nơi — nó là hệ quả đã được §1 của kế hoạch S1
ánh xạ trước: **C4** còn thiếu vế *"có thông báo toàn bộ nhà cung cấp đã mời"* (cần lời mời,
S1.3); **C5** chưa có chủ ngữ (`rfq_key_material` là S1.4); **C3**/**D2** cần cổng chính sách của
S1.6; **E4** cần cả MST lẫn mã RFQ đi qua một đường xác thực chưa tồn tại. Độ phủ nghiệp vụ sẽ
nhảy ở S1.3, không sớm hơn — và một lần nhảy sớm hơn thế sẽ là dấu hiệu ai đó lấp mã bằng NHÃN.

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

5. ~~**Mở `tools/do-webcrypto/index.html` qua một URL https, từ bên trong Zalo và Messenger, trên
   vài điện thoại thật** — Android WebView cũ, iOS WKWebView. Phải xong **trước S1.4**.~~
   **Vế "phải xong trước S1.4" ĐÃ HẾT HIỆU LỰC 2026-09-04** — ADR-011 chốt "P-256 mặc định,
   X25519 cơ hội", nên phép đo không còn là điều kiện tiên quyết. **Việc đo thì vẫn nên làm**,
   và nó vẫn mất hai phút; cái đổi là hậu quả của việc KHÔNG làm.
6. ~~**Chốt ADR-010**, **ADR-011**, **ADR-012**.~~ **XONG HAI TRONG BA (2026-08-29):**
   **ADR-010** chốt *outbox bền cộng `NOTIFY` đánh thức* — `NOTIFY` là **bộ tăng tốc, không phải
   cơ chế**, vì nó không bền; **ADR-012** chốt *UUIDv4, cấm UUIDv7/ULID* — UUIDv7 chứa timestamp
   và sắp theo thứ tự nên **vi phạm A5**. **ADR-011** cố ý để ***Đang mở***: nó bị khoản nợ 23
   chặn, nhưng phần ghim được thì đã ghim (phong bì mang mã thuật toán thoả thuận khoá).
7. ~~**Bắt đầu S1.1 và S1.2** — hai hạng mục duy nhất không bị chặn bởi quyết định nào.~~
   **Ba quyết định chặn ba hạng mục sớm nhất đã được chốt cùng ngày:** **ADR-013** (sổ NCC là bảng
   tenant; `UNIQUE (tax_code)` toàn cục là một **oracle xuyên tổ chức** — cùng lớp lỗi đã ĐO hai
   lần ở S0, và MST tệ hơn vì nó công khai, liệt kê được), **ADR-014** (CSDL giữ cạnh và bất biến
   trên dữ liệu, ứng dụng giữ điều kiện cần ngữ cảnh), **ADR-015** (OTP không bao giờ cùng kênh
   với magic link; giới hạn tần suất trên Postgres, **không** thêm Redis).
8. ~~**Bắt đầu S1.1, S1.2 và S1.3** — ba hạng mục nay có đủ quyết định.~~ **XONG (2026-08-29),** kèm
   một vòng sửa an ninh. Mỗi ADR để lại **một phép
   đối kháng bắt buộc** (§*Đo bằng gì* của từng ADR); không có lượt RED thật thì lớp chưa được đo.

**Hành động tiếp theo, sau lượt 2026-08-30:**

9. ~~Ba MEDIUM cố ý không sửa cần một ADR.~~ **XONG — ADR-016/017/018 đã chốt.** Việc **còn lại là
   CÀI**, và nó là ba việc rời nhau, không phải một:
   - ~~**ADR-016** → `SupplierActor`/`InvitationActor` đi theo đường `createdBySessionId` mà 011 đã mở
     cho `RfqActor`; cộng lớp canh route, **đến hạn cùng route đầu tiên của `apps/`**.~~
     **ĐÃ CÀI 2026-08-30** — migration `013`, `packages/identity/src/session-actor.ts`, và hai gói
     `supplier`/`invitation` viết lại. `SupplierActor` và `InvitationActor` **đã bị xoá**; bên mua
     nhận `actorSessionId`, bên khách **không nhận actor gì cả** (danh tính đọc từ token và từ
     thách thức đã đối chiếu). 14 test mới, trong đó **hai test đột biến** (gỡ trigger → câu ghi
     khai man ĐI LỌT) và **bốn phép đo bằng SQL viết tay** không đi qua gói.

     **HAI VIỆC CÒN LẠI CỦA CHÍNH ADR-016, cả hai đều có tên:**
     ⑴ **`packages/rfq` vẫn nhận `actor: RfqActor` làm tham số** — đúng khiếm khuyết MEDIUM-3 nêu
     cho `packages/supplier`, chỉ chưa lượt review nào gọi tên. Câu trong ADR-016 mục 3 nói
     `RfqActor` "đã đi" đã bị **gạch bỏ tại chỗ** ngay khi bắt đầu cài. ⑵ **Lớp canh route** —
     mặc định MỞ cho tới khi có nó, và nó **đến hạn cùng route đầu tiên của `apps/`**.
   - ~~**ADR-017** → một migration đánh số mới: `org_procurement_policies` + `rfq_packages.estimated_value`
     + phiên bản chính sách; cộng phép đo **neo giá** trên đường phiên khách.~~
     **ĐÃ CÀI 2026-08-30** — migration `014`, `packages/rfq/src/procurement-policy.ts`, 10 test mới.
     `requiresDualApproval` **đã bị gỡ khỏi `createRfq`**: RFQ luôn ra đời ở `true`, và đường DUY
     NHẤT hạ nó xuống là `setRfqBudget` — thứ phải trỏ tới một chính sách có thật, và **CSDL tính
     phép so** (`rfq_can_phe_duyet_kep`), không phải TypeScript.

     **HAI CÂU CỦA ADR-017 BỊ LƯỢT CÀI BÁC BỎ, cả hai đã gạch bỏ tại chỗ:** ⑴ tiền **không** nằm
     trên `rfq_packages` mà ở bảng riêng `rfq_budgets` — vì "cưỡng chế bằng quyền theo cột cho
     đường khách" **không cài được**: đường khách và đường người mua dùng CHUNG role `app_api`,
     không có role thứ ba để thu hẹp; ⑵ `policy_version` **không** được chép vào bằng chứng —
     `policy_id` trỏ tới một hàng không sửa được nên đã xác định cả phiên bản lẫn ngưỡng.

     **Khoản nợ có tên và có mốc:** khi **S1.5** dựng đường đọc RFQ cho phiên khách, đường ấy phải
     được ĐO là không chạm `rfq_budgets`. Hôm nay `packages/invitation` không đọc `rfq_packages`
     một lần nào, nên chưa có gì để đo.
   - ~~**ADR-018** → HMAC + pepper có phiên bản, **hoặc** bỏ `destination_hash`. Quyết bằng phép đo ở
     §*Đo bằng gì* mục 1 (đối chứng dương: liệt kê phải TÌM RA số khi không có pepper).~~
     **ĐÃ CÀI 2026-08-30** — migration `015`, `packages/invitation/src/pepper.ts`, 7 test mới.
     **Phép đo chạy TRƯỚC khi viết một dòng mã nào**, và nó là thứ quyết định: không pepper thì
     liệt kê **TÌM RA** số (11 ms trên 10⁴), có pepper thì **không**; ngoại suy 10⁹ ≈ **18 phút**
     một luồng. Phép đảo ngược là THẬT, không phải một lo ngại trên giấy.

     **PHÉP BĂM THỨ BA ĐƯỢC TÌM RA KHI CÀI, không có trong ADR:** `code_hash` là
     `sha256(invitation_id ‖ code)` với mã OTP **sáu chữ số** — 10⁶ tiền ảnh — và `invitation_id`
     nằm ngay trong cùng bản sao lưu. Kẻ có bản sao lưu đọc ra mã của **mọi thách thức chưa tiêu
     thụ**. E1 nói CSDL chỉ giữ BĂM của mã; khi băm đảo ngược được, hai câu ấy là một.

     **Phương án "bỏ cột" KHÔNG được chọn**, và câu hỏi biến mất thay vì được cân lại:
     `otp_rate_limits.bucket_hash` bắt buộc phải có pepper (nó là khoá bộ đếm, không dư chút nào),
     nên chi phí biên của cột thứ ba là một dòng.

     **Một hệ quả vận hành phải nói ra:** `otp_rate_limits` cố ý KHÔNG mang cột phiên bản, nên
     xoay pepper **đặt lại hạn mức của mọi đích** trong đúng cửa sổ xoay. Cửa sổ ngắn nên hàng cũ
     tự già đi, nhưng xoay pepper vì vậy là một thao tác **có thời điểm**, không phải làm lúc nào
     cũng được.
10. ~~**Ba MEDIUM này KHÔNG được đánh dấu đóng khi ADR được chốt.**~~ **Cả ba nay ĐÃ CÓ LỚP và có
    lượt RED thật (2026-08-30).** Ba migration (`013`, `014`, `015`), bốn gói sửa, **31 test mới**
    — trong đó **ba test đột biến** (gỡ trigger → câu ghi khai man / cờ hạ bằng tay ĐI LỌT) và
    **năm phép đo bằng SQL viết tay** không đi qua gói.

    ~~**Nhưng ADR-016 chưa đóng hết, và phần còn lại có tên:** `packages/rfq` vẫn nhận
    `actor: RfqActor` làm tham số, và **lớp canh route vẫn chưa dựng được** vì `apps/` rỗng.~~
    **CẢ HAI ĐÃ XONG 2026-09-03** — migration `016` và
    `tests/architecture/cong-quyen-route.test.ts`. **13 test mới**; khẳng định 789 → **802**.

11. **Ba thứ lượt cài ADR-016 bước 2 tìm ra, và cả ba là hệ quả của việc ĐO chứ không của việc đọc:**
    ⑴ **`createdBy` và `approverUserId` cũng là lời khai thừa** — trigger 011 đã ép cả hai bằng
    chủ phiên, nên chúng là hai chỗ để gõ nhầm chứ không phải hai bậc tự do. Cả hai đã bị xoá.
    ⑵ **Một test ĐỔI NGHĨA thay vì hỏng:** *"mượn phiên của người khác bị chặn"* nay KHÔNG VIẾT
    RA ĐƯỢC ở tầng ứng dụng — không còn hai tham số để cho lệch nhau. Lỗ bị đóng bằng HÌNH DẠNG
    CHỮ KÝ, mạnh hơn một phép kiểm. Test được **viết lại** để đo trigger bằng SQL viết tay, không
    bị xoá — lớp CSDL vẫn phải còn răng vì nó canh MỌI đường.
    ⑶ **Một phụ thuộc THỨ TỰ ẩn trong chính bộ test** — `rfqNhap` đọc chính sách đang hiệu lực,
    nên test *"tái lập được"* của ADR-017 (tạo phiên bản 2, ngưỡng thấp hơn) làm bốn test chạy
    SAU nó đỏ. Bắt được vì chúng khẳng định TRẠNG THÁI, không chỉ khẳng định "không ném".

12a. **LƯỢT CI THỨ HAI (run `33704750680`, commit `4467ca9`): XANH CẢ BỐN JOB.** Job `evidence`
    chạy trên CI lần đầu tiên với mã S1: *vitest thoát mã 0, 803 khẳng định, 30/50, Cổng evidence
    XANH*, và bước `git diff --exit-code -- evidence/INV-matrix.md` **qua** — tức ma trận trong git
    khớp bộ sinh **từng byte** trên Linux. Đây là lần đầu điều kiện hoàn thành S0 mục 2 (*bốn cổng
    xanh tại máy VÀ trên CI*) được thoả cho mã của S1.

12b. **LẦN CHẠY CI ĐẦU TIÊN CỦA TOÀN BỘ S1 (2026-09-03, run `33703786759`): T0 XANH, T3 XANH,
    T1+T2 ĐỎ — và thứ đỏ là lớp canh route của chính vòng này, không phải mã sản phẩm.**
    T3 xanh là con số đáng đọc: **toàn bộ chín migration của S1 chạy trên Postgres của Linux CI
    lần đầu tiên** và không câu lệnh nào gãy.

    **Lỗi T1+T2 là một BẢN VÁ CỦA MỘT BẢN VÁ SAI, và nó lặp đúng bài học đắt nhất của S0.** Lớp
    canh route quét `apps/` bằng `readdirSync`; nó đỏ cục bộ vì `boundaries.test.ts` dựng fixture
    dò ở đó, và tôi vá bằng cách **loại trừ theo TÊN** (`tmp-probe-*`) — danh sách tên suy từ
    những `mkdirSync` grep được. Danh sách ấy **bỏ sót `apps/tmp-probe/src`** (không có gạch nối
    ở cuối). Máy vẫn xanh vì thời điểm chạy tình cờ không trùng; **CI bắt được**.

    Bản vá thứ hai suy từ một **TÍNH CHẤT**: chỉ file **được git theo dõi** mới là mã của kho này
    — fixture dò là file untracked, bất kể đặt tên gì. Kèm một **đối chứng dương cho chính bộ
    quét** (`quetTepTs("packages")` phải > 10 file): không có nó, một bộ quét hỏng trả mảng rỗng
    và mọi khẳng định phía trên xanh — một lớp canh rỗng ruột trông y hệt một lớp canh sạch.

13. **Một khoản nợ hạ tầng test đã đóng, và một ngưỡng đã nới:** lớp canh route quét `apps/` từng
    ĐỎ trong lượt chạy toàn bộ vì `boundaries.test.ts` giữ fixture dò ở đó — một lớp canh flaky
    sẽ bị ai đó tắt đi, tức tệ hơn không có, nên nó nay loại trừ `tmp-probe-*`/`zprobe-*` tường
    minh. Và test *"migration áp dụng sạch"* nay mang timeout 120s: số file migration đi từ 7 lên
    **16**, và ngưỡng mặc định 30s trở nên quá chật khi nhiều file test tranh nhau Docker.

> Hành động cũ *"Chạy `security-reviewer` cho Task 7, 8, 9"* đã được **gỡ**: các lượt review ấy
> đã xảy ra (xem `evidence/security-reviews.md`). Nó ra đời từ đúng lời khai sai đã gạch bỏ ở
> mục 8 của bảng điều kiện hoàn thành — một ví dụ sống cho việc một câu sai trong tài liệu trạng
> thái tự sinh ra công việc thừa.

## Tham chiếu

| Tài liệu | Nội dung |
|---|---|
| `docs/TIEN-DE-CHUA-DO.md` | **17 tiền đề về CON NGƯỜI và QUY TRÌNH mà S1 đang cư xử như thật.** Mỗi dòng trỏ tới một chỗ có địa chỉ trong kho, kèm *sai thì mất gì* và **một câu hỏi cho người mua thật**. KHÔNG thay một khách hàng pilot — nó hạ chi phí của buổi làm việc đầu tiên |
| `docs/PRODUCT.md` | Định vị, phạm vi, ràng buộc sản phẩm, những điều không được tuyên bố |
| `docs/ARCHITECTURE.md` | Kiến trúc hiện tại |
| `docs/DECISIONS.md` | ~~**Mười hai ADR**~~ ~~**Mười lăm ADR**~~ ~~**Mười tám ADR**~~ **Mười chín ADR** — 001–010 và 012–019 *Đã chấp nhận*; ~~**011** (định dạng phong bì + chữ ký biên nhận) ***Đang mở***, chặn S1.4/S1.5 và **chỉ được chốt sau khi đo Zalo/Android** (khoản nợ 23).~~ **011 chốt 2026-09-04 cho mục 1** (P-256 mặc định, X25519 cơ hội); mục 2 (thuật toán chữ ký biên nhận) và mục 3 (xoay khoá ký) còn mở nhưng **không chặn S1.4**. **019** nơi cặp khoá RFQ ra đời (S1.4). **013** phạm vi sổ NCC (S1.1), **014** nơi cưỡng chế máy trạng thái RFQ (S1.2), **015** kênh OTP + nền giới hạn tần suất (S1.3). **016** cổng quyền ở tầng ứng dụng + danh tính là dẫn xuất, **017** chính sách tính `requires_dual_approval`, **018** pepper cho băm đích — ba ADR của ba MEDIUM mà vòng sửa an ninh cố ý không đóng bằng mã |
| `docs/TEST-PLAN.md` | ~~**Sổ đăng ký 47 bất biến** (34 nghiệp vụ + 13 hàng rào)~~ **Sổ đăng ký 49 bất biến** (34 nghiệp vụ + **15** hàng rào; H14/H15 thêm ở S1.1), bảy tầng kiểm thử, evidence pack |
| `evidence/INV-matrix.md` | **Ma trận bất biến** — sinh tự động, không sửa tay |
| `evidence/security-reviews.md` | **Dấu vết review an ninh** — một dòng mỗi task, commit được review, môi trường đo, phát hiện theo mức, commit đóng |
| `docs/superpowers/specs/2026-08-26-trustprocure-s0-s1-design.md` | Đặc tả thiết kế S0+S1 đã duyệt |
| `docs/superpowers/plans/2026-08-27-s0-foundation.md` | Kế hoạch triển khai S0 — 11 task, 92 bước |
| `Vibe Coding/CLAUDE.md` | Phương pháp làm việc (bản copy thủ công — xem Vấn đề đã biết 2) |
