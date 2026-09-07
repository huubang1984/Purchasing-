# STATE — TrustProcure V2

> Bộ nhớ trạng thái hiện tại của dự án. Đọc trước mọi việc quan trọng, đối chiếu với mã
> nguồn thật — mã, test và hành vi runtime là bằng chứng mạnh hơn tài liệu này.
> Không bao giờ ghi "đã xong / đã test / đã sửa / đã triển khai" nếu chưa thực sự kiểm chứng.

**Cập nhật lần cuối:** 2026-09-07 (**S1.19 — ADR-026 §5⑶ ĐÓNG: công thức `openssl(1)` đã được CHẠY (lệnh `trich`; review lượt 11 — một mốc chết cũng cần một phép đo)** — mục 34; cùng ngày: **S1.18 — HAI KHOẢN NỢ 9 VÀ 17 ĐÓNG (ADR-027: biên giới module và bề mặt export là một TÍNH CHẤT; hai danh sách miễn trừ về RỖNG; review lượt 10 bắt một cổng đã rỗng ruột từ S0)** — mục 33; cùng ngày: **S1.17 — KHOẢN NỢ 11 ĐÓNG (ADR-026: artefact neo ngoài)** — mục 32; trước đó: **S1.16 — KHOẢN NỢ 58 ĐÓNG bằng cách BÁC BỎ tiền đề của chính nó (migration `046`)** — mục 31; cùng ngày: **S1.15 — HAI KHOẢN NỢ 56–57 ĐÓNG (ADR-025: bảng tenant dọn được mà không đọc được; danh sách loại trừ ghim về RỖNG)** — mục 30; cùng ngày: **S1.14 — HAI KHOẢN NỢ 54–55 ĐÓNG (ADR-024: bộ đếm người gọi ngoài cây tenant, danh sách ghim tự đối chiếu)** — mục 29; cùng ngày: **S1.13 — BA KHOẢN NỢ 51–53 ĐÓNG (ADR-023: việc sau commit của runner, hạn mức tổ chức + tổ chức lạ, hardening ghim thân trigger)** — mục 28; cùng ngày: **S1.12 — BẢY KHOẢN NỢ 38–43, 49 ĐÓNG cùng vòng (ADR-022, migration `038`–`040`)** — mục 27; trước đó 2026-09-06: **S1.11 — tiến trình `api` chạy thật: ADR-021, migration `037`, `main.ts`, nợ 50 mở và đóng cùng vòng** — mục 26; trước đó cùng ngày: **S1.10 ĐI HẾT BẢY HẠNG MỤC** — 10.6 kịch bản 41 qua HTTP **51/51**, 10.7 HAI lượt
review + hai vòng sửa, migration `032`, sổ nợ tới **49**, **nợ 44 đóng bằng `033`** — mục 23, **nợ 47 và 48 đóng (`034`)** — mục 24, **nợ 45 và 46 đóng (`035`, `036`)** — mục 25; xem *Hành động tiếp theo* mục 20–25; 10.5 mục 19; 10.4 mục 18; 10.3 mục 17; 10.2 mục 16; ADR-020 chốt cùng ngày; PR #2 và #3 đã merge vào `master` — `dca6dab`. Trước
đó cùng ngày: hai mốc chết của tầng T1 nổ ở CI sau commit `623458b`, đã đóng ở `83e4cba` — mục 14. Trước đó: 2026-09-05, S1.6–S1.9 đã có mã,
một vòng sửa sau BỐN lượt `security-reviewer` đóng bảy phát hiện mức HIGH, và ba vòng trả nợ)

---

## Cột mốc hiện tại

~~**Giai đoạn: S0 (Nền móng) — MÃ NGUỒN ĐÃ CÓ, mười một task đã commit. S1 chưa bắt đầu.**~~

**Giai đoạn: S0 ĐÃ HỢP NHẤT VÀO `master`** (merge commit `30d1972`, giữ nguyên 46 commit).
~~**S1 đã có KẾ HOẠCH ĐẦY ĐỦ, chưa viết một dòng mã nào.**~~

**[2026-09-05] CHÍN HẠNG MỤC CỦA S1 ĐỀU ĐÃ CÓ MÃ (S1.1–S1.9), và một vòng sửa an ninh đã chạy
sau chúng.** Đo được, không cảm tính:

| Điều kiện hoàn thành S1 (§7 của kế hoạch) | Trạng thái |
|---|---|
| 1. `pnpm t0` xanh; `apps/unseal-worker` tồn tại; `g1-` đo lại bằng đối kháng | ✅ — 124 module, 376 phụ thuộc, 0 vi phạm |
| 2. `pnpm test` + `test:int` xanh, **0** lần `unhandled`, **0** lần `57P01` | ✅ — đã đo bằng cách quét chính log của hai lượt chạy |
| 3. `pnpm evidence` xanh, độ phủ ≥ 45/47 | ✅ — **47/50** (31/34 nghiệp vụ + 16/16 hàng rào); ba mã còn trống là **A2, A5, E6**, cả ba S2+ |
| 4. Cả 5 mã ở §4 có ghi chú được cập nhật; D1 có MỘT hàm hợp bốn vế | ✅ — `assertUnsealAllowed`; G1 viết lại sau khi căn phòng đã xây |
| 5. Bộ T5 chạy trọn kịch bản mục 41, mọi test đối kháng có răng | ✅ — `tests/adversarial/` + kịch bản 15 bước; mỗi lượt đột biến đã chạy và ĐỎ THẬT |
| 6. Một buổi `security-reviewer` cho mỗi hạng mục ⭐ | ✅ — bốn lượt, ghi ở `evidence/security-reviews.md`; **7 HIGH đã đóng bằng mã** |
| 7. Không tuyên bố nào rộng hơn phép đo | ✅ trong phạm vi đã kiểm — và vòng review đã BẮT ĐƯỢC ba bản sao của một câu sai (xem nợ đã đóng) |

**Điều bảng trên KHÔNG nói:** ba mã A2/A5/E6 trống vì lý do KIẾN TRÚC (không có tiến trình `api`,
không có role `app_guest`, không có URL) — không phải vì hết thời gian. Và bốn lượt review đọc mã
bằng mắt, **không chạy được gì**; các mã MEDIUM/LOW chưa đóng nằm ở sổ nợ dưới đây. ~~Hai hạng mục đầu (S1.1, S1.2) không
bị quyết định nào chặn và có thể bắt đầu ngay.~~ **Câu vừa gạch HẸP HƠN thực tế và theo hướng
nguy hiểm:** S1.1 và S1.2 không bị ADR nào *đang mở* chặn, nhưng mỗi hạng mục **mang một quyết
định kiến trúc chưa có chỗ để treo** — phạm vi sổ nhà cung cấp, và nơi cưỡng chế máy trạng thái
RFQ. Cả hai phải chốt **trước** migration `008`. Đây đúng khuôn lỗi ADR-009 đã dạy: *cái treo là
có thật; cái thiếu là một chỗ để nó treo*. **Đã đóng 2026-08-29 bằng ADR-013, ADR-014 và ADR-015**
(cho S1.3). Ba hạng mục sớm nhất nay có đủ quyết định để bắt đầu.

Đã xong:

- Thiết kế S0+S1, sáu lát cắt dọc S0–S5, ~~**chín ADR**~~ ~~**mười hai ADR**~~ ~~**mười lăm ADR**~~ ~~**mười tám ADR**~~ **mười chín ADR** (ADR-011 **chốt TRỌN VẸN 2026-09-04**: mục 1 *P-256 mặc định, X25519 cơ hội*; mục 2 *`ECDSA P-256` + văn bản chính tắc*; mục 3 *xoay khoá ký có `kid`* — hết chặn S1.4 **và** S1.5; **ADR-019 cùng ngày** — nơi cặp khoá RFQ ra đời) (bảy ở giai đoạn thiết kế,
  ADR-008 ở Task 9, ADR-009 ở vòng fix cuối, **ADR-010/011/012 ngày 2026-08-29 khi lập kế hoạch S1**,
  **ADR-013/014/015 cùng ngày cho ba hạng mục sớm nhất**, **ADR-016/017/018 ngày 2026-08-30 cho ba
  MEDIUM mà vòng sửa an ninh cố ý không đóng bằng mã**), sổ đăng ký bất biến, kiến trúc kiểm thử bảy tầng.
- **Mười một task của kế hoạch S0 đã commit** (`docs/superpowers/plans/2026-08-27-s0-foundation.md`).
- Hai hook `git-safety` / `protect-secrets` đã viết lại fail-closed và có test.
- Monorepo pnpm, CI bốn job, cổng tĩnh T0 (tsc + eslint + dependency-cruiser + gitleaks + audit).
- ~~Bảy~~ ~~Tám~~ ~~Chín~~ ~~Mười~~ ~~Mười bảy~~ **Mười tám** migration `001`–**`018`** + `hardening.always.sql`: role, tổ chức, người
  dùng, sổ kiểm toán chuỗi hash, vai trò/quyền, phiên + MFA, outbox, **sổ nhà cung cấp (S1.1)**,
  **RFQ + hạng mục + phê duyệt + máy trạng thái (S1.2)**, **lời mời + magic link + OTP + phiên
  khách (S1.3)**, **danh tính là dẫn xuất (013/016)**, **chính sách mua sắm (014)**, **pepper OTP
  (015)**, **vật liệu khoá RFQ (017, S1.4)**, **báo giá + biên nhận đã ký (018, S1.5)**.
- `KeyProvider` + adapter `local-dev` bọc khoá theo tổ chức có phiên bản, công cụ đo hiệu năng.
- **Evidence pack**: `pnpm evidence` sinh `evidence/INV-matrix.md` từ `docs/TEST-PLAN.md`.

- **S1.5 — nộp báo giá, phiên bản, biên nhận, khoá theo deadline (2026-09-04):** migration `018`
  (`vendor_bids`, `vendor_bid_versions`, `bid_receipts`), gói `packages/bidding`, và **bốn mã
  nghiệp vụ được lấp: A3, B1, B2, C1** — độ phủ **33/50 → 37/50**, phần nghiệp vụ 17 → 21.

  **Hạng mục này mở đầu bằng việc chốt ADR-011 mục 2 và 3, và phần đáng đọc nhất là một lập luận
  bị chính phép tra cứu giết chết.** Lượt này suýt chốt bằng câu *"AWS KMS không ký được
  Ed25519"* — một câu nghe dứt khoát, kiểm chứng được, và **sai**: `ECC_NIST_EDWARDS25519` có
  thật. Giữ nguyên văn trong ADR thay vì lặng lẽ bỏ đi, vì nó đúng hình dạng của thứ đi lọt vào
  một ADR rồi nằm đó nhiều năm.

  Quyết định thật đứng trên một vế khác: đường nộp thầu **đã** đòi họ P-256 (mục 1), nên
  `ECDSA P-256` cho chữ ký nghĩa là **ai nộp được thì kiểm chứng được**. `Ed25519` sẽ tạo ra một
  hạng người dùng chưa từng tồn tại — *nộp được nhưng không kiểm chứng được trong trình duyệt* —
  và hạng ấy rơi đúng vào cái đuôi Android cũ.

  **Thứ được ký là VĂN BẢN CHÍNH TẮC, không phải JSON**, vì một JSON không có dạng byte chính tắc
  và ký nó buộc bên kiểm chứng cài lại bộ mã hoá của bên **bị** kiểm chứng.

  Một khe interop có thật đã được đóng trước khi nó cắn: WebCrypto dùng chữ ký ECDSA dạng **RAW**,
  còn `openssl`/`node`/KMS dùng **DER**; sai dạng cho ra *"chữ ký không hợp lệ"* — cùng thông điệp
  với một chữ ký bị giả mạo. Dự án lưu DER, và bộ chuyển dạng được đối chiếu với DER **thật** do
  `node:crypto` sinh ra.

  **Ba trong bốn mã mới mang cờ §4 ngay từ đầu**, và tỷ lệ ấy không phải dấu hiệu xấu — nó là dấu
  hiệu của những mệnh đề RỘNG: B2 nói về một con người thật, C1 nói về thời gian, A3 nói về *"mọi
  truy vấn SQL"*. B1 **cố ý** không mang cờ, và lý do được ghi tại chỗ.
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

- ~~Toàn bộ S1~~ ~~**S1.2–S1.9**~~ ~~**S1.3–S1.9**~~ ~~**S1.4–S1.9**~~ ~~**S1.5–S1.9**~~ **S1.6–S1.9**: mở thầu, so sánh, T5, E2E.
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
| 3 | ~~**[2026-09-06] ADR-020 (tầng HTTP của `apps/api`) ở trạng thái *Đề xuất — chờ chốt***~~ | ~~Chặn toàn bộ S1.10~~ | **ĐÃ CHỐT cùng ngày** — ADR-020 *Đã chấp nhận*, `policy.manage` → `PROCUREMENT_MANAGER`, H17 vào sổ đăng ký. S1.10.2 bắt đầu. Kế hoạch: `docs/superpowers/plans/2026-09-06-s1.10-tang-http.md` |
| 2 | ~~**Ba quyết định treo trước S1**: xử lý thư mục `Vibe Coding/`, chọn nhà cung cấp KMS (**ADR-009**, trạng thái *Đang mở*), chọn hạ tầng triển khai~~ → **còn MỘT**: xử lý thư mục `Vibe Coding/` | KMS và hạ tầng **đã chốt cùng lúc 2026-08-29: AWS KMS, `ap-southeast-1`** — đúng như dòng bên phải đã dự báo, chúng không độc lập và được quyết trong một lần. Xem ADR-009. | **Đã chốt một phần** |

> Điểm chặn cũ *"hook `git-safety.sh` và `protect-secrets.sh` đang fail-open"* đã được **gỡ**:
> Task 1 viết lại cả hai theo hướng fail-closed, và điều kiện hoàn thành S0 mục 3 đã đạt.

## Vấn đề đã biết

| # | Vấn đề | Mức | Ghi chú |
|---|---|---|---|
| 1 | `~/.claude/settings.json` chứa `ANTHROPIC_AUTH_TOKEN` dạng rõ | TRUNG BÌNH | `protect-secrets` nay đã phủ `.claude/settings*.json` (H8). File đã tồn tại thì hook không xoá được token khỏi nó — đó là việc của người dùng |
| 2 | Thư mục `Vibe Coding/` là bản copy-paste thủ công của CLAUDE.md + 5 file SKILL, trùng với plugin `ai-eng-os` đã cài | THẤP | README của plugin cảnh báo gây nhầm lẫn giữa `/feature` và `/ai-eng-os:feature`. Là thao tác **xoá file** nên kế hoạch cố ý không tự làm |
| 3 | Rủi ro `crypto.subtle` không khả dụng trong webview Zalo/Messenger | CAO (rủi ro sản phẩm) | ~~**Chưa đo.**~~ **Vẫn CHƯA ĐO TRÊN THIẾT BỊ THẬT**, nhưng nay đã có **máy dò**: `tools/do-webcrypto/index.html` chạy thật từng phép mật mã của đường nộp thầu và cho ra một trong **bốn** phán quyết. Máy dò đã được chứng minh có răng bằng ba đột biến (`?dot=x25519\|aes\|rnd` qua `phuc-vu-va-dot-bien.mjs`) — bốn phán quyết phân biệt được, đo trên Chrome 148 ngày 2026-08-29. **ĐÃ CÓ PHÉP ĐO TRÊN WEBVIEW THẬT (2026-08-29): Zalo iOS, WKWebView, iOS 18.7 — ĐẠT TOÀN BỘ, kể cả X25519.** Giả thuyết xấu nhất (*"webview Zalo không có `crypto.subtle`"*) **đã bị bác trên đường iOS**. Rủi ro **hẹp lại nhưng CHƯA ĐÓNG**: phía **Android vẫn trống hoàn toàn**, và kết quả iOS chỉ đúng cho **iOS 18.7** — `X25519` vào WebCrypto muộn hơn nhiều so với AES-GCM nên một WebKit cũ là chỗ nó có thể vắng. Phép đo này cũng làm lộ ra rằng trục phân loại đúng là **engine**, không phải tên ứng dụng: trên iOS, Zalo và Messenger dùng **cùng một `WKWebView`**, nên một phép đo phủ cả hai. Nhật ký: `tools/do-webcrypto/ket-qua-do.md`. Xem ADR-007 và §10 của kế hoạch S1. **[2026-09-05] MỘT KHIẾM KHUYẾT CỦA CHÍNH CÔNG CỤ ĐO, tìm ra bởi lớp canh của khoản nợ 20:** `tools/do-webcrypto/phuc-vu-va-dot-bien.mjs` đọc `./do-webcrypto.html`, một tên KHÔNG CÒN TỒN TẠI (trang đã đổi thành `index.html`) — nên server đột biến ném `ENOENT` ở dòng đầu và ai cầm nó lên hôm nay sẽ không chạy được một lượt nào. Đã sửa. Điều đáng ghi không phải lỗi mà là chỗ nó trốn: `tsc` không nhìn thấy đường dẫn dạng chuỗi, và không test nào gọi tới tệp `.mjs` ấy |
| 4 | Hiệu năng bọc/mở khoá `local-dev` (rủi ro §8.4 của spec) | THAM KHẢO | `pnpm bench:keys` trên máy dev, **đo lại 2026-08-29**: 10.000 lần **bọc** 447 ms (**≈22.400 thao tác/giây**), 10.000 lần **mở** 392 ms (**≈25.500 thao tác/giây**). Lần đo trước (sau fix round 1 của Task 7): 512 ms / 440 ms — cùng bậc. Đây là mốc của `local-dev` (mã hoá nội bộ, không qua mạng). ~~Tham chiếu: RFQ 50 NCC × 200 hạng mục ≈ 10.000 lần mở khoá/lượt mở thầu ⇒ dưới nửa giây CPU thuần. Adapter KMS/Vault thật (S1.6) sẽ chậm hơn **nhiều bậc** vì mỗi lần là một lời gọi mạng~~ — **hai câu vừa gạch đã được ĐO là sai** (2026-08-29, `tools/bench-kms/dem-loi-goi-kms.mjs`): 200 hạng mục nằm trong **cùng một phong bì** nên số phong bì là **50** chứ không phải 10.000; và một lượt mở thầu tốn **đúng 1 lời gọi KMS** bất kể số nhà cung cấp, vì chỉ data key của tổ chức đi qua KMS. Giữ nguyên văn để đối chiếu. **Câu "phải đo lại trước khi bắt đầu S1.6" thì vẫn đúng và vẫn còn hiệu lực** — phép đo trên là mô phỏng, chưa chạy qua `packages/crypto-keys`; xem ADR-009 |
| 5 | `[M10]` flaky tiền tồn | THẤP | ~~Ghi nhận từ vòng review trước, chưa truy nguyên~~ **QUAN SÁT LẦN THỨ HAI (2026-08-29, vòng sửa sau review an ninh), và lần này có CHỮ KÝ.** Test `[fix round 5 — M10]` ở `packages/db/src/migrate.int.test.ts:540` đỏ trong một lượt `pnpm evidence` toàn bộ, **xanh khi chạy riêng file ấy**. Khẳng định đỏ là `expect(rows[0]?.n).toBe(0)` trên `SELECT count(*) FROM pg_locks WHERE locktype='advisory'` — thu được **1**, chờ **0**. Hai khẳng định ngay trước (`poolThuong.totalCount`/`idleCount` = 0) thì QUA, tức client phía Node đã bị huỷ. **GIẢ THUYẾT, chưa kiểm chứng:** đây là cùng cơ chế mà lần chạy CI đầu tiên đã đo và ghi ở mục 2 — *`await pool.end()` chỉ bảo đảm phía CLIENT*; backend phía server chưa kịp thoát nên advisory lock của nó chưa được nhả tại đúng khoảnh khắc câu đếm chạy. Nếu giả thuyết đúng thì bản vá cùng hình dạng với bản vá T3 của S0: **chờ `pg_stat_activity` hết backend rồi mới đếm**, thay vì đếm ngay. **Điểm dữ liệu thứ hai, cùng ngày:** lượt `pnpm evidence` chạy lại NGAY SAU đó, cùng cây mã, **XANH TOÀN BỘ** — 758 test, 0 file đỏ, vitest thoát mã 0. Hai lượt liên tiếp cho hai kết quả khác nhau trên cùng một cây: đây là bằng chứng FLAKY, không phải hồi quy. **Cố ý KHÔNG sửa trong vòng này**: nó là một test tiền tồn, không thuộc phạm vi review an ninh, và sửa một flake bằng một giả thuyết chưa đo là đúng thứ dự án phạt. **[2026-09-05 — ĐÃ ĐO, xem khoản nợ 24]** 14 lượt trên máy này (1 lượt `test:int` đầy đủ, 5 lượt cặp `migrate`+`outbox`, 8 lượt tranh chấp bốn tệp cùng lúc): **0 lần đỏ, 0 lần `57P01`, 0 unhandled**. Nguồn phát ĐÃ BIẾT của `57P01` nay có phép đo riêng ở `TestDatabase.stop()` (khoản nợ 28). Vẫn CHƯA tuyên bố là hết: cùng con số ấy phải lặp lại trên phần cứng CI, và `.github/workflows/do-lap.yml` chạy lặp hằng tuần, fail-closed |

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
| 6 | **ĐÓNG NỬA ĐỌC [S1.10.2]:** `resolveSessionByToken` tra token (băm, đòi `mfa_verified_at`) và `apps/api` gọi nó ở mọi route người mua. **Nửa PHÁT vẫn mở** — không hàm sản phẩm nào INSERT `sessions`; đó là S1.10.4 (`startUserSession`). Nguyên văn cũ: ~~**Đường đời `sessions` chưa tồn tại**: không hàm nào phát token, tra token, hay đặt `mfa_verified_at`. D1 là một phép kiểm ĐÚNG chưa có ai gọi~~ | `packages/identity/src/session-actor.ts`; `evidence/INV-matrix.md` §4 |
| 7 | `apps/` rỗng ⇒ `listOrganizations` / `start()` **chưa có đường gọi sản phẩm** | — |
| 8 | **Không lớp máy nào cưỡng chế quy ước QT3**; chú thích + test là tất cả những gì đang giữ nó | `packages/audit/src/tenant-guard.ts`, `task-8-report.md` §V3.5 |
| 9 | ~~**Bốn gói thiếu danh sách trắng barrel**: `audit`, `tenancy`, `db`, `test-support`. Một symbol mọc ra ở mặt tiền của chúng không được canh bởi lớp nào~~ **ĐÓNG 2026-09-07 (S1.18, ADR-027).** Bốn danh sách trắng, cộng **[INV-H18]** — sổ đăng ký *gói → cửa → danh sách trắng* suy TỪ TÍNH CHẤT (đọc `packages/*/package.json`, đọc `exports`, import cửa thật), danh sách miễn **RỖNG**. Dựng nó tìm ra một lỗ THẬT: `sealed-envelope` khai hai cửa từ S1.4 mà cửa `./unseal` (xuất `unsealBid` — hàm MỞ phong bì giá thầu) chưa bao giờ có danh sách trắng; `g8-` canh AI, không ai canh CÁI GÌ. Cùng hình dạng với `@trustprocure/audit/anchor-sign`, và cả hai lần thứ mở cửa là MỘT DÒNG `package.json` | `tests/architecture/barrel-exports.test.ts` |
| 10 | **`.gitattributes` ghim đúng hai thứ**: `*.sql` và `evidence/INV-matrix.md`. `.ts` là **CRLF trong mọi checkout mới** trên Windows | `.gitattributes` |
| 11 | ~~**Artefact neo ngoài của B3 vẫn không tồn tại.** Cơ chế đã có, artefact thì chưa — và không có nó, một chuỗi hash hợp lệ **không chứng minh gì** trước một chủ sở hữu bảng~~ **ĐÓNG 2026-09-07 (S1.17, ADR-026).** Artefact tồn tại và nó là bốn thứ, không phải một: một **văn bản chính tắc** (`anchor-text.ts`, cùng khuôn `buildReceiptText`), một **chữ ký** ECDSA P-256 dạng DER — dạng `openssl dgst -sha256 -verify` đọc thẳng — với vòng khoá RIÊNG khác vòng khoá ký biên nhận (`anchor-sign.ts`, sau quy tắc `g11-`, không có ở `index.ts`), một **nơi cất CHỈ-GHI-THÊM** (`anchor-store.ts`, JSONL mỗi tổ chức một tệp), và một **entry point** (`tools/neo-so-kiem-toan`, hai lệnh `xuat`/`kiem`). `ExternalAnchor` nay mang một **dấu đúc** — symbol module-private, không `Symbol.for` — nên `{ ...xuat, source: "bịa" }` không còn typecheck, và một `as unknown as` bị `verifyAuditChain` bắt ở thì chạy với `ANCHOR_UNVERIFIED`. **Chữ ký và tính chỉ-ghi-thêm chặn HAI thứ khác nhau và không thay được nhau:** chữ ký chặn BỊA THÊM, chỉ-ghi-thêm chặn BỎ BỚT — đo bằng một test có ĐỐI CHỨNG (nơi cất ghi đè ⇒ kết luận kiểm toán SẠCH trên một sổ đã bị cắt mất một nửa). **Còn mở, và cả hai đều KHÔNG phải mã:** cái LỊCH (một tiến trình ở nơi đã triển khai), và tính ĐỘC LẬP của nơi cất (S3 Object Lock ở một tài khoản AWS role deploy không với tới) — xem ADR-026 §5 | ~~`evidence/INV-matrix.md` §4.1 (trích nguyên văn)~~ nay là §4.1 **cộng phụ lục đính chính** (hai câu của bản trích đã bị bác bỏ, bản trích giữ nguyên byte); ADR-026 |
| 12 | Lớp canh nhãn của Task 10 (`packages/outbox/src/nhan-bat-bien.test.ts`) **chỉ phủ `packages/outbox/src/`**. Lớp canh toàn repo mà Task 11 dựng chỉ bắt được nhãn trỏ tới mã **không tồn tại** — nó **không** bắt được nhãn đúng cú pháp gắn sai chỗ | `tools/inv-matrix/src/parse.ts` |
| 13 | **ĐÃ ĐÓNG [S1.6].** ~~**`D1` là một mệnh đề HỘI bốn vế mà phép hội chưa từng được đo một lần.**~~ `assertUnsealAllowed` hợp cả bốn vế; phép hội được đo bằng khuôn *một trạng thái chỉ sai đúng một vế*, và `C3` nay ✅ nên mâu thuẫn số học giữa hai hàng cũng hết. Nguyên văn cũ: 12 test đo vế *MFA còn hiệu lực*, 5 test đo vế *quyền hợp lệ*, **không test nào đo hai vế cùng lúc**; hai vế còn lại (*RFQ đã CLOSED*, *cổng chính sách*) không có một dòng mã nào. Vế thứ ba **chính là hàng `C3`**, đang ⏳ trong cùng bảng | `evidence/INV-matrix.md` §4 (mục D1) |
| 14 | **ĐÃ ĐÓNG [S1.6].** ~~**`G1` canh một cánh cửa chưa có phòng ở sau.**~~ `apps/unseal-worker` tồn tại và THẬT SỰ import cả hai cửa hạn chế. Nguyên văn cũ: 18 test đo quy tắc biên giới — lớp phòng ngừa thật, đã chứng minh có răng — nhưng `wrapped_private_key` và `apps/unseal-worker` **chưa tồn tại** | `evidence/INV-matrix.md` §4 (mục G1) |
| 15 | **Không có ADR mở cho KMS dù nó chặn S1.6** — đã đóng bằng **ADR-009**; khoản nợ còn lại là *chốt nhà cung cấp*, và nó **không độc lập** với quyết định hạ tầng (ADR-006 chỉ cưỡng chế được bằng IAM của hạ tầng đích) | `docs/DECISIONS.md` ADR-009 |
| 16 | **Bốn mục hardening cùng khuôn danh-sách-tên, chưa có trong sổ nợ.** Nặng nhất: hình dạng bảng sổ chỉ **ĐẾM** `attname IN (15 tên) = 15`, **không cấm cột thừa** ⇒ thêm một cột `payload_plaintext` vào `audit_events` **không bị mục nào chạm**. Kế đó: bất đối xứng `bang_so` (2 tên viết cứng) vs `bang_al` (theo tính chất) — **bảng báo giá S1 sẽ rơi thẳng vào đó**: được kiểm trigger nhưng **không** bị kiểm UNLOGGED, **không** bị kiểm UNIQUE, **không** bị thu hồi UPDATE/DELETE/TRUNCATE. **Bất đối xứng này không có một chú thích nào giải thích.** Và `VI_TU_BANG_TENANT` giấu `OR relname IN ('organizations')` bên trong một vị từ tính-chất ⇒ bảng gốc tenant thứ hai không bị đổi RLS/FORCE, `rls-coverage.int.test.ts` cũng mù | `db/migrations/hardening.always.sql`, `db/rls-coverage.int.test.ts` |
| 17 | ~~**Hai mặt tiền chịu lực nhất repo không có lớp nào canh đường vào.** `packages/tenancy/src/with-tenant.ts` là **điểm DUY NHẤT gắn `app.org_id`** — toàn bộ RLS của 002–007 treo vào nó — và `packages/audit/src/writer.ts` là đường ghi sổ kiểm toán. Cả hai **với tới được bằng import tương đối**: 3/7 gói có quy tắc biên giới (`crypto-keys`, `identity`, `outbox`); `audit`, `db`, `tenancy`, `test-support` **không có**~~ **ĐÓNG 2026-09-07 (S1.18, ADR-027).** Họ `g12-`…`g15-`; số họ quy tắc biên giới **5 → 9**; `MIEN_TRU` của [INV-H16] về **RỖNG**. Phép đo bác bỏ chính lý do miễn trừ (*"rủi ro hồi quy riêng"*): **0 chỗ import phải di trú**. Vị từ *gói* nay là *thư mục có `package.json`* và tập cửa đọc từ `exports` — cả hai sửa sau review lượt 10 (H10-1 HIGH, H10-2) | ~~`.dependency-cruiser.cjs:77-78`~~ nay là `tests/architecture/goi-workspace.ts` + ADR-027 |
| 18 | **Bộ máy evidence nằm ngoài vòng review bắt buộc** — đã đóng ở vòng fix cuối: `/tools/inv-matrix/`, `/docs/TEST-PLAN.md`, `/docs/STATE.md`, `/evidence/` nay có trong `.github/CODEOWNERS`. Khoản nợ **còn lại**: `CODEOWNERS` trỏ tới `@trustprocure/bao-mat`, một team **chưa tồn tại**, nên tới hôm nay nó **chưa cưỡng chế gì** | `.github/CODEOWNERS` (khối cảnh báo ở đầu file) |
| 19 | **Bốn phép đo THIU trong chú thích của migration đã áp**, không sửa được tại chỗ vì `001`–`007` và `hardening.always.sql` **không được đụng** (migration đánh số chạy đúng một lần; sửa chú thích cũng đổi checksum): ⑴ `006:23` và `007:29` chép **nguyên văn giống nhau** *"~71 chỗ `::text`/`::oid`"* — đo lại bằng công cụ **nhị phân** trên `hardening.always.sql`: `::text` = **55**, `::oid` = **2**, tổng **57**; một phép đo thiu được chép sang file thứ hai **mà không đo lại**. ⑵ `hardening:863-864` (khối *DƯ LƯỢNG CÒN LẠI*, đúng đoạn có giá trị kiểm toán cao nhất) nói *"một bảng ở schema khác mang ĐÚNG **14** cột này"* trong khi danh sách có **15** tên và vị từ dòng 886 đúng là `= 15` — mô tả sai bề mặt tấn công **đi một cột**. ⑶ `005:190-191` nói mục (C) *"CẤM MỌI"* hàm SECURITY DEFINER, nhưng bản cài đặt còn loại trừ `pg_toast%`/`pg_temp%`, `NGOAI_LE_DOC_VONG`, và **hàm thuộc EXTENSION** — file viện dẫn nói **rộng hơn** file có thẩm quyền. ⑷ `hardening:73-76` nói *"4 trong 6 câu lệnh"* trong khi bảng hiện có **36 mục**. **Cách đóng đúng: một migration mới, hoặc sửa kèm lần migrate() kế tiếp có đổi lược đồ.** | `db/migrations/006_sessions_and_mfa.sql`, `007_outbox.sql`, `005_identity.sql`, `hardening.always.sql` |
| 20 | **ĐÃ ĐÓNG [2026-09-05] bằng HAI lớp không thay thế nhau.** ⑴ Job T1+T2 nay chạy trên CẢ `ubuntu-latest` LẪN `windows-latest` (`fail-fast: false`); T3 cố ý ĐỨNG NGOÀI ma trận vì runner Windows không chạy được `postgres:16-alpine`, và giới hạn ấy được ghi thẳng vào `ci.yml`. ⑵ `tests/architecture/bao-dam-mot-he-dieu-hanh.test.ts` đo THẲNG tính chất, trên mọi hệ điều hành. **MỘT DỰ ĐOÁN CỦA TÔI ĐÃ BỊ PHÉP ĐO BÁC BỎ:** bản đầu của lớp ⑵ canh đường dẫn `import`, và phép đo (đổi `./comparison.js` → `./Comparison.js` ở một module chỉ có ĐÚNG MỘT nơi import) cho thấy `tsc` BẮT ĐƯỢC bằng `TS1261` — trục ấy đã có chủ, nên vế ấy bị GỠ. Thứ còn lại không có chủ là **đường dẫn dạng CHUỖI** (`new URL(..., import.meta.url)`, hơn năm mươi chỗ trong kho): `tsc` mù hoàn toàn với chúng. Lớp mới TÌM RA MỘT LỖI THẬT ngay lần chạy đầu — server đột biến của máy dò WebCrypto đọc `./do-webcrypto.html`, một tên không còn tồn tại, nên nó ném `ENOENT` ở dòng đầu và không ai biết. Nó cũng ĐỎ TRÊN CHÍNH NÓ một lần (khối lý do NHẮC TỚI một `new URL(...)` như ví dụ và phép quét đọc câu văn ấy thành lời gọi thật) — đã sửa bằng cách bỏ chú thích trước khi quét. Mũi đột biến (`db/migrations` → `db/Migrations`) ĐỎ THẬT. Nguyên văn: ~~**Không lớp nào canh "bảo đảm chỉ đúng trên một hệ điều hành".**~~ Lần chạy CI đầu tiên tìm ra **một** ca (test import sai hoa-thường) và ca đó đã sửa, nhưng cơ chế phát hiện vẫn là *"chạy trên hệ điều hành thứ hai rồi xem cái gì đỏ"*. Toàn bộ 346 test đơn vị mới chỉ được chạy trên **hai** nền tảng đúng **một** lần mỗi bên, và CI chỉ có `ubuntu-latest` — nên một bảo đảm chỉ đúng trên **Linux** thì hôm nay **không lớp nào bắt được**. Cách đóng đúng: thêm `windows-latest` vào ma trận job T1+T2 | `tests/architecture/boundaries.test.ts` (khối chú thích của test hoa-thường); `.github/workflows/ci.yml` |
| 21 | **ĐÃ ĐÓNG [2026-09-05] bằng `tests/architecture/pham-vi-san-xuat.test.ts`.** Ba vế, và vế giữa suy TỪ TÍNH CHẤT chứ không từ một danh sách tên: một gói workspace mà MỌI nơi import nó đều là tệp test thì không được nằm ở `dependencies` của bất kỳ ai — một `packages/x-support` mai sau tự rơi vào rổ ấy mà không ai phải nhớ thêm tên nó vào đâu. Hai vế kia: tập phụ thuộc NGOÀI ở phạm vi sản xuất được ghim đúng bằng `pg` + `pg-connection-string`, và phụ thuộc phát triển của gốc không được lọt vào `dependencies` của gói nào. **NÓ TÌM RA MỘT LỖ NGAY LẦN CHẠY ĐẦU:** `apps/unseal-worker` khai `@trustprocure/test-support` ở `dependencies` — tức hạ tầng Testcontainers nằm trong phạm vi sản xuất của app ấy, và `pnpm audit --prod` KHÔNG kêu một tiếng, vì sau lần sửa Task 3 gói đó không còn phụ thuộc ngoài nào để mà có advisory. Đúng cơ chế khoản nợ này mô tả, tái diễn lần thứ hai. Nguyên văn: ~~**Chỉ `pnpm audit --prod` chặn được hạ tầng kiểm thử lọt vào phạm vi sản xuất, và nó chỉ nổ khi TÌNH CỜ có advisory.**~~ và nó chỉ nổ khi TÌNH CỜ có advisory.** `packages/test-support` khai `@testcontainers/postgresql` trong `dependencies` suốt từ Task 3 tới lần chạy CI đầu tiên; thứ làm nó lộ ra là **hai advisory HIGH trên `undici`**, không phải một lớp canh nào. Một gói kiểm thử **không có advisory** vẫn nằm im trong đồ thị prod và **không lớp nào kêu**. Cách đóng đúng: một test đọc mọi `package.json` của workspace và khẳng định tập phụ thuộc sản xuất đúng bằng một danh sách được ghim | `packages/test-support/package.json`, `.github/workflows/ci.yml` (bước *Audit phu thuoc (cong chan)*) |
| 22 | ~~**Job `evidence` vẫn CHƯA từng chạy trên CI.**~~ **ĐÃ ĐÓNG** ở run `33221142361`: job chạy đủ, 672 khẳng định, 24/47, *"Cổng evidence: XANH"*, và bước so byte với bản đã commit đã chạy và qua. Toàn bộ khoản nợ *"chưa chạy trên CI thật"* nay đã trả hết. Giữ hàng này để đối chiếu, không xoá | `.github/workflows/ci.yml` (job `evidence`) |
| 23 | **VẪN MỞ, và [2026-09-05] xác nhận lại: KHÔNG mã nào đóng được nó.** Vế còn thiếu là một phép đo trên MÁY THẬT — Android tầm trung/cũ — và trong tay không có máy ấy; lượt tra dữ liệu công bố 2026-09-04 đã cho một kết quả ÂM (phân bố phiên bản Android System WebView không tra được từ dữ liệu tổng hợp miễn phí). Viết thêm một dòng mã nào ở đây cũng chỉ là viết quanh chỗ trống. Một điều CÓ sửa được thì đã sửa: server đột biến của chính máy dò (`tools/do-webcrypto/phuc-vu-va-dot-bien.mjs`) đọc một tên tệp không còn tồn tại và ném `ENOENT` ở dòng đầu — tức công cụ dùng để đo, nếu ai đó cầm lên hôm nay, sẽ KHÔNG CHẠY. Lớp canh của khoản nợ 20 tìm ra nó. Nguyên văn cũ giữ lại: **VẪN MỞ, nhưng THÔI CHẶN S1.4 kể từ 2026-09-04.** ADR-011 được chốt bằng cách **gỡ bỏ thế hoặc/hoặc** — hỗ trợ CẢ HAI thuật toán, chọn bằng chính máy dò lúc chạy — nên phép đo Android tụt từ **cổng chặn** xuống **con số vận hành**. Lượt tra dữ liệu công bố 2026-09-04 còn cho một **kết quả ÂM đáng ghi**: phân bố phiên bản Android System WebView **không tra được** từ dữ liệu tổng hợp miễn phí, tức câu hỏi cũ *không* trả lời được bằng cách đọc, chỉ bằng cách thuê máy thật — và ngay cả thế cũng chỉ cho một mẫu. Xem `tools/do-webcrypto/ket-qua-do.md` §3c. Nguyên văn cũ giữ lại: **Phía Android của WebCrypto chưa từng được đo, và việc đó đã được HOÃN CÓ CHỦ ĐÍCH ngày 2026-08-29** vì trong tay không có máy Android tầm trung/cũ và không có iPhone iOS cũ. Đây **không phải** rủi ro đã đóng; nó là rủi ro **được chấp nhận tạm** với hai điều kiện ghi rõ: ⑴ **phải đo trước khi CHỐT ADR-011** (S1.4), vì sau khi đã có phong bì thật thì đổi thoả thuận khoá là một cuộc di trú chứ không phải sửa cấu hình; ⑵ chừng nào ô ấy còn trống, **không tài liệu nào được viết *"đã đo trên webview"* mà không kèm `iOS 18.7`**. Giảm nhẹ đã có: ADR-011 buộc phong bì **mang mã thuật toán thoả thuận khoá**, nên đổi sang P-256 về sau là **thêm một nhánh**, không phải viết lại | `tools/do-webcrypto/ket-qua-do.md` §4 (quyết định hoãn, có ngày) |
| 24 | **ĐÃ ĐO [2026-09-05], VÀ CƠ CHẾ ĐO NAY CHẠY ĐỀU — nhưng chưa tuyên bố là đã sửa.** Số liệu thật trên máy phát triển (Windows 11, Docker Desktop 29.7.2): 1 lượt `pnpm test:int` đầy đủ (23/23 tệp, **0** lần `57P01`, **0** unhandled), 5 lượt cặp `migrate`+`outbox`, 8 lượt tranh chấp bốn tệp cùng lúc — **0/14 lần đỏ**. Cộng thêm: nguồn phát ĐÃ BIẾT của `57P01` nay có phép đo riêng (khoản nợ 28), và `[M10]` đã được truy nguyên từ vòng fix trước với năm nhánh B0–B4 đo thật. Thứ CÒN THIẾU đúng một điều — cùng con số ấy trên PHẦN CỨNG CỦA CI, nơi cả hai lần đỏ thật sự xảy ra — nên `.github/workflows/do-lap.yml` chạy lặp `test:int` hằng tuần và **fail-closed** khi tỷ lệ khác 0. Không nới một ngưỡng nào. Nguyên văn: ~~**HAI test FLAKY, cùng một họ, và họ ấy nay có tên.**~~ `[M10]` (`packages/db/src/migrate.int.test.ts` — đếm advisory lock còn sót) và `[T10-L]` (`packages/outbox/src/outbox.int.test.ts` — `destroyConnectionWhenDone`) đều **đỏ trong lượt chạy đầy đủ và XANH khi chạy riêng**, cả hai quanh **vòng đời kết nối dưới tranh chấp Docker**. Chúng chưa được sửa **có chủ đích**: chưa có phép đo nào phân biệt được *"lớp bị hỏng"* với *"máy chạy chậm"*, và sửa mù bằng cách nới ngưỡng là đúng thứ biến một phép đo thành một lời khai. Cách đóng đúng: một lượt chạy lặp (`--repeat`) trên CI để đo TỶ LỆ, rồi mới quyết định | `packages/db/src/migrate.int.test.ts:540`, `packages/outbox/src/outbox.int.test.ts:1404` |
| 27 | **ĐÃ ĐÓNG [2026-09-05].** Bước audit tách ra thành job riêng `t0b-audit`. Hướng fail-closed KHÔNG đổi — một lần audit không chạy được vẫn không được đọc thành *"không có lỗ hổng"*; thứ sai là GỘP, vì nó để một lần gián đoạn mạng của bên thứ ba che mất kết quả của bốn cổng tĩnh không phụ thuộc gì ngoài kho mã. Nay một lượt gián đoạn cho ra hai câu khác nhau: `T0 — cổng tĩnh` XANH, `T0b — audit` ĐỎ. `tests/architecture/hinh-dang-ci.test.ts` ghim cả hai thay đổi, và hai mũi đột biến (gỡ `windows-latest`; đưa `pnpm audit` về `t0`) đều ĐỎ THẬT. Nguyên văn: ~~**Cổng T0 ĐỎ được vì một lý do KHÔNG nằm trong kho mã, và điều đó đã xảy ra thật.**~~, và điều đó đã xảy ra thật.** Hai lượt CI ngày 2026-09-04 (`33862380751` commit `6e8c8aa`, `33862719087` commit `9b1c237`) đỏ ở bước *Audit phu thuoc (cong chan)* với `ERR_SOCKET_TIMEOUT` khi gọi `registry.npmjs.org` — `tsc`, `eslint`, `depcruise`, `gitleaks` đều xanh, và `pnpm t0` cục bộ xanh trên đúng cây ấy. Tức **cổng chặn merge phụ thuộc vào một dịch vụ ngoài còn sống**. Hướng fail-closed là ĐÚNG (một lần audit không chạy được không được đọc thành "không có lỗ hổng"), nên đây **không** phải một lỗi cần sửa vội; nó là một tính chất phải **được biết**, vì lần tới ai đó thấy T0 đỏ sẽ đi tìm lỗi trong mã của mình. Cách đóng đúng nếu nó lặp lại: tách bước audit thành một job RIÊNG, để một lượt gián đoạn mạng không che mất kết quả của bốn cổng tĩnh còn lại | `.github/workflows/ci.yml` (bước *Audit phu thuoc (cong chan)*) |
| 28 | **ĐÃ ĐÓNG [2026-09-05], và đóng bằng ĐO chứ không bằng sửa mù — đúng cách khoản nợ này đòi.** `TestDatabase.stop()` nay hỏi `pg_stat_activity` NGAY TRƯỚC `container.stop()` và ném nếu còn backend khách sống sau một cửa sổ chờ 3 giây; cửa sổ ấy không phải một ngưỡng được nới cho tới lúc hết đỏ mà là một quãng chọn DƯỚI `idleTimeoutMillis` mặc định 10 giây của `pg`, nên nó phân biệt được *"đã đóng, chưa thoát"* với *"rò rỉ thật"*. Ba quyết định được ghi tại chỗ: khẳng định KHÔNG chặn `container.stop()` (một lớp canh làm rò rỉ container thật thì tệ hơn thứ nó canh); [CẤM LOG] thông điệp KHÔNG mang cột `query`; và `withMigratedDatabase` viết lại để lỗi THÂN HÀM thắng lỗi dọn dẹp — một `finally` trần sẽ để phép đo mới che mất đúng thứ bộ test đang tìm. Có ca rò rỉ dựng sẵn chứng minh nó có răng. Đo trên cả 23 tệp tích hợp: **0 rò rỉ, 0 lần `57P01`, 0 unhandled**. Nguyên văn: ~~**Job T3 đỏ được vì một lỗi KHÔNG PHẢI một khẳng định sai.**~~ Lượt `33862719087` (commit tài liệu thuần `9b1c237`) đỏ với `terminating connection due to administrator command` (`57P01`) — một kết nối gộp còn sống khi container Postgres của test bị đóng; **không một `expect` nào đỏ**. Cùng lượt ấy trên commit TRƯỚC (`6e8c8aa`) thì T3 xanh. Đây là cùng họ với khoản nợ 24 (vòng đời kết nối dưới tranh chấp), nhưng khác chỗ: nó không gắn với một test có tên nào, nên `--repeat` một file không tái lập được. Cách đóng đúng: mỗi bộ test tích hợp phải đóng pool TRƯỚC khi dừng container, và điều đó phải được ĐO chứ không được sửa mù | `packages/test-support/src/postgres.ts` (`stop()`), `packages/audit/src/chain.int.test.ts` |
| 25 | **ĐÃ ĐÓNG [S1.6]** bằng `RFQ_KEY_MATERIAL_UNWRAPPED` ghi bởi chính worker. Nguyên văn cũ: **Vế *mở bọc* của G4 chưa có một dòng mã nào, và nó là vế một kiểm toán viên hỏi tới ĐẦU TIÊN.** S1.4 ghi sổ kiểm toán cho *sinh* (một bản ghi, vì sinh và bọc là một hành vi) và *huỷ*; *mở bọc* sống trong `apps/unseal-worker`, thứ chưa tồn tại. Đây là **phần chênh đã được khai báo** ở §4 của ma trận chứ không phải một khoảng trống bị quên — nhưng nó là khoản nợ mà **S1.6 phải trả**, không phải một ghi chú vĩnh viễn | `tools/inv-matrix/src/danh-gia.ts` (`PHAM_VI_HEP` mục `G4`) |
| 26 | **ĐÃ ĐÓNG [2026-09-05] bằng `026_xoa_mat_ma_vat_lieu_khoa.sql` — S1.6 đã xây xong cổng chính sách mà `017` khối (4) chờ.** Xoá mật mã ĐƯỢC hỗ trợ và KHÔNG BAO GIỜ là tác dụng phụ của một nút: bốn điều kiện hợp lại — ⑴ đã THU HỒI, ⑵ hết quãng ân hạn `key_purge_grace_hours` của chính sách ĐÃ GHIM, ⑶ chính sách phải BẬT (mặc định `NULL` = không bao giờ xoá; một hành động không đảo ngược được không được bật sẵn cho ai chưa nghe nói tới nó), ⑷ `wrapped_private_key` chỉ đổi được VỀ `NULL`, một lần. `app_api` nay CÓ `UPDATE` trên cột ấy — một sự nới quyền phải nói thẳng — nhưng nó vẫn KHÔNG ĐỌC được cột, và trigger từ chối mọi giá trị mới khác `NULL`: hình dạng của một nút phá huỷ, không phải một nút sửa. Mã quyền `rfq.key.purge` chỉ `PROCUREMENT_MANAGER`; người gọi phải khai đúng SỐ HÀNG mình đang phá huỷ. Bốn ca từ chối đi THẲNG bằng SQL, không qua mặt tiền; mũi đột biến bỏ vế ân hạn ĐỎ THẬT. **GIỚI HẠN ĐÃ GHI RA:** `UPDATE ... = NULL` xoá GIÁ TRỊ, không bảo đảm byte cũ biến khỏi WAL/bản sao lưu/standby — bảo đảm mật mã thật chỉ đóng khi khoá chủ ở KMS cũng bị huỷ, và đó là lý do bản ghi mang tên `RFQ_KEY_MATERIAL_PURGED` chứ không `CRYPTO_ERASED`. Nguyên văn: ~~**Thu hồi vật liệu khoá là một DẤU, không phải một lần XOÁ MẬT MÃ.**~~ Khi một RFQ bị huỷ, `rfq_key_material.revoked_at` được đặt nhưng `wrapped_private_key` **vẫn nằm nguyên trong hàng**. Xoá nó đi sẽ biến *"không ai được mở báo giá của RFQ đã huỷ"* từ một quy tắc **chính sách** thành một sự thật **mật mã** — mạnh hơn hẳn — nhưng nó cũng là một hành động không đảo ngược đứng sau một nút có thể bấm nhầm. Quyết định thuộc S1.6, nơi có cổng chính sách để đặt nó vào | `db/migrations/017_rfq_key_material.sql` khối (4) |
| 29 | **ĐÃ ĐÓNG [2026-09-05] bằng `027_phien_khach_co_lap.sql` — nhưng KHÔNG theo hình dạng khoản nợ này tự đề xuất, và sự khác ấy là một phép đo.** Sổ nợ nói *"một role `app_guest`"*. Tôi đã định làm đúng thế, rồi đọc `hardening.always.sql` và đổi ý: một role thứ ba PHẢI được file ấy cưỡng chế lại thuộc tính ở MỌI lần `migrate()` (nếu không, một `ALTER ROLE app_guest BYPASSRLS` sau triển khai sống mãi — và đó ĐÚNG NGƯỢC LẠI thứ A5 cần), mà file ấy liệt kê role theo TÊN ở ba chỗ, tức đóng bằng role sẽ kéo theo một lần sửa file 1600 dòng chịu lực nhất kho. Và một role KHÔNG mạnh hơn ở đúng trục đang bàn: cả hai thiết kế đều đứng trên *"ứng dụng chọn đúng cách nối"*; thứ THẬT SỰ cô lập là VỊ TỪ RLS. Thêm nữa, chính `hardening.always.sql` ghi *"HÌNH DẠNG THỨ TƯ — policy AS RESTRICTIVE — KHÔNG cần dòng nào"* trong danh sách ngoại lệ, tức nó đã chừa sẵn chỗ cho cách này. Nên: policy `AS RESTRICTIVE` đọc `app.guest_session_id`, cộng vào policy sẵn có bằng phép HỘI, không chạm một dòng nào của đường người mua. **MẶC ĐỊNH LÀ TỪ CHỐI** — mọi bảng có RLS đều mang một policy `<bảng>_khach`, và bảng nào không thuộc bảy bảng của mặt khách thì vị từ của nó đóng hoàn toàn; một lớp canh suy từ `pg_class.relrowsecurity` bắt bảng TIẾP THEO phải được quyết định. Đo bằng HAI nhà cung cấp trên CÙNG một RFQ, có đối chứng dương (khách đọc được của chính mình) và một mũi đột biến ĐỎ THẬT. **MỘT THIẾT KẾ CỦA TÔI ĐÃ BỊ BỘ TEST BÁC BỎ, và nó đổi hình dạng của lời giải:** bản đầu để chính vị từ policy TRA `guest_sessions` để lấy lời mời. Nó đỏ ở năm test của đường mở thầu với `permission denied for table guest_sessions` — vì Postgres kiểm quyền trên MỌI bảng trong kế hoạch, KHÔNG theo kiểu ngắn mạch của `OR`, nên mọi role đọc `vendor_bid_versions` sẽ phải có `SELECT` trên `guest_sessions`, kể cả `app_unseal` vốn không bao giờ gắn phiên khách. Ba đường ra được cân; đường đã chọn là GUC THỨ HAI (`app.guest_invitation_id`) mà `withGuestSession()` DẪN XUẤT từ chính hàng phiên — và nhân đó thêm một phép kiểm không có ở bản đầu: một phiên đã THU HỒI hay HẾT HẠN không gắn được, đo bằng `clock_timestamp()` chứ không `now()`. `withGuestSession()` gắn GUC và KHẲNG ĐỊNH nó có hiệu lực — fail-open trong im lặng là hướng hỏng duy nhất không chấp nhận được ở đây. **HAI PHẦN CHÊNH ĐÃ GHI VÀO §4 CỦA MA TRẬN:** bảo đảm chỉ đứng KHI kết nối đã gắn phiên khách (không có tầng HTTP nào để cưỡng chế việc gắn ấy), và vế *"gián tiếp qua thời gian phản hồi"* vẫn là một phép đo T6 chưa ai chạy. Role `app_guest` ở lại sổ nợ như một lớp phòng thủ chiều sâu ở tầng GRANT, với lý do đo được ở trên. Nguyên văn: Hình dạng đúng vẫn là `app_guest` + policy theo `current_setting('app.guest_session_id')`, và bản thân RLS thì rẻ hơn tưởng: **policy `AS RESTRICTIVE ... TO app_guest`** cộng vào các policy sẵn có mà KHÔNG chạm một dòng nào của `app_api`/`app_unseal` — tức *"nó chạm mọi bảng"* không còn là vế chặn. Vế chặn THẬT nằm chỗ khác, và đọc mã mới thấy: một role thứ ba phải được `hardening.always.sql` cưỡng chế lại thuộc tính ở MỌI lần `migrate()` (nếu không, một `ALTER ROLE app_guest BYPASSRLS` sau triển khai sẽ sống mãi — và một `app_guest` có `BYPASSRLS` là ĐÚNG NGƯỢC LẠI thứ A5 cần), mà file ấy liệt kê role theo TÊN ở ba chỗ: tạo role, ghim thuộc tính, và bước gỡ membership vốn hẹp xuống ĐÚNG hai cặp `app_*_login → app_*`. Sửa file 1600 dòng chịu lực nhất kho, trong cùng một lượt với sáu khoản nợ khác, là đúng thứ chính khoản nợ này cảnh báo — *"trộn vào một hạng mục sẽ làm cả hai khó xem xét"*. Nó cần một hạng mục riêng, có buổi `security-reviewer` riêng. Nguyên văn giữ lại: **A5 KHÔNG được cưỡng chế ở tầng CSDL, và khoảng trống ấy là một QUYẾT ĐỊNH bị hoãn chứ không phải một thiếu sót.** Phiên khách chạy dưới cùng role `app_api` và cùng `app.org_id` của tổ chức người mua (010), nên RLS cô lập TỔ CHỨC chứ không cô lập nhà cung cấp với nhà cung cấp. Phần CSDL làm được đã làm: một phiên khách KHÔNG GHI được vào luồng báo giá của người khác (trigger `bid_kiem_phien_khach`, 018, có test). Phần nó không làm được: chặn một câu `SELECT` đọc sang luồng khác, và khoảng trống ấy là một QUYẾT ĐỊNH bị hoãn chứ không phải một thiếu sót.** Phiên khách chạy dưới **cùng role `app_api`** và **cùng `app.org_id`** của tổ chức người mua (010), nên RLS cô lập **tổ chức** chứ không cô lập **nhà cung cấp với nhà cung cấp**. Phần CSDL làm được đã làm: một phiên khách **không GHI được** vào luồng báo giá của người khác (trigger `bid_kiem_phien_khach`, 018, có test). Phần nó **không** làm được: chặn một câu `SELECT` đọc sang luồng khác — hôm nay đó là kỷ luật của tầng ứng dụng. Hình dạng đúng để đóng: một role `app_guest` với policy theo `current_setting('app.guest_session_id')`. Không làm ở S1.5 vì nó chạm mọi bảng và trộn vào một hạng mục sẽ làm cả hai khó xem xét | `db/migrations/018_vendor_bids.sql` khối A5; `docs/TEST-PLAN.md` mã A5 |
| 30 | **ĐÃ ĐÓNG NỬA ĐƯỜNG, VÀ NỬA CÒN LẠI CÓ TÊN [2026-09-05].** `apps/public-keys` ra đời: `node:http` trần (không thêm một phụ thuộc sản xuất nào), CHỈ ĐỌC, phục vụ `/.well-known/trustprocure-receipt-keys` và tra theo `kid`. Khoản nợ nói *"thứ thiếu là ĐƯỜNG"* — đường ấy nay có, và một nhà cung cấp viết được script kiểm chữ ký mà không phải hỏi ai. Thứ nó **KHÔNG** đóng, và không được đọc thành đã đóng: **tính ĐỘC LẬP**. Một endpoint do chính chúng ta phục vụ vẫn là *"hỏi chúng ta"*, chỉ nhanh hơn — một máy chủ bị chiếm phục vụ được khoá khác và mọi biên nhận giả sẽ kiểm chứng SẠCH. Thứ đóng nốt là một NEO NGOÀI, và `fingerprint` (SHA-256 của SPKI) trong mỗi mục tồn tại đúng để đi ra khỏi hệ thống (in vào hợp đồng, đọc qua điện thoại). **Đây là cùng một khoản nợ với số 11** — ~~cơ chế có, artefact neo ngoài thì chưa~~. **[S1.17] KHOẢN NỢ 11 ĐÃ ĐÓNG, VÀ NỬA NÀY THÌ KHÔNG — hai thứ khác nhau, đừng đọc gộp.** Artefact neo ngoài cho SỔ KIỂM TOÁN đã có (ADR-026). Thứ còn thiếu ở đây là một artefact neo ngoài cho chính KHOÁ CÔNG KHAI — của biên nhận, và nay của cả mốc neo: kiểm toán viên phải lấy được vòng khoá công khai qua một đường KHÁC đường lấy artefact, nếu không thì kẻ chiếm được cả hai phục vụ một cặp khớp nhau. Không dòng mã nào sinh ra được thứ đó — nó là một `fingerprint` in vào hợp đồng, đọc qua điện thoại, đăng ở nơi ta không kiểm soát. Vòng S1.17 làm cho nó trở thành thứ DUY NHẤT còn lại của khoản nợ này. Vế chịu lực của bộ test là một vế PHỦ ĐỊNH suy từ tính chất: không phản hồi nào của bất kỳ đường nào mang một byte nào của khoá RIÊNG, dò dưới cả `base64`/`hex`/`base64url`, kèm một đối chứng chứng minh chính phép dò ấy bắt được một lần rò rỉ dựng sẵn. Nguyên văn: ~~**Khoá công khai ký biên nhận chưa được CÔNG BỐ ở đâu cả.**~~ `ReceiptSigningKeyRing.publicKeys()` trả về nửa công khai theo `kid`, và biên nhận mang `kid` trong chính văn bản đã ký — tức **cấu trúc** đã đủ. Thứ thiếu là **đường**: một endpoint HTTP trả khoá theo `kid`, và `apps/` vẫn rỗng. Hệ quả hôm nay: nhà cung cấp lấy khoá công khai bằng cách **hỏi chính chúng ta**, nên vế *"kiểm chứng độc lập"* của B2 mới đúng một nửa. Đây là phần chênh đã khai báo ở §4 của ma trận, và nó là khoản nợ mà **S1.9/T5** phải trả | `packages/bidding/src/signer.ts`; `tools/inv-matrix/src/danh-gia.ts` (`PHAM_VI_HEP` mục `B2`) |
| 31 | **ĐÃ ĐÓNG [2026-09-05] bằng `023_rfq_open_cancel_permissions.sql` cộng hai lời gọi `requirePermission`.** `rfq.open` và `rfq.cancel` nay có trong danh mục và chỉ `PROCUREMENT_MANAGER` giữ — `BUYER` soạn được và mời được nhưng không tự mở được gói thầu mình soạn, và `DIRECTOR` (vai phê duyệt mở thầu) cố ý không được cấp. Bốn phép đo mới, kèm một lượt đột biến gỡ cả hai cổng làm cả bốn ĐỎ. Hai mốc ghim của D3 phải viết lại vì chúng đọc DUY NHẤT văn bản `005` — nay đọc **mọi** `NNN_*.sql` theo tính chất, nên một migration tương lai tự rơi vào phạm vi. Nguyên văn khoản nợ: ~~**Không phép kiểm quyền nào trên `openRfq` và `cancelRfq` — và từ vựng để viết nó KHÔNG TỒN TẠI.**~~ Cả hai hàm xác lập *ai* (`resolveSessionActor`) và *tổ chức nào* (`assertTenantBound`) rồi làm việc, không hỏi *người ấy có được phép không*. Hệ quả: bất kỳ phiên hợp lệ nào của tổ chức — kể cả một vai không có một quyền RFQ nào — mở được RFQ và đúc khoá cho nó, hoặc huỷ RFQ (thứ thu hồi TOÀN BỘ vật liệu khoá của nó, không đảo ngược được: 017 cấm bỏ dấu thu hồi, và worker lọc `revoked_at IS NULL`). Tức một phiên không đặc quyền làm cho báo giá của một RFQ VĨNH VIỄN không mở được bằng một lời gọi. Đây KHÔNG phải khoảng trống *"tầng ứng dụng chưa có"*: `packages/unseal` cùng nhánh GỌI `requirePermission` bên trong gói. Thứ chặn là `permissions.ts` chỉ có `RFQ_CREATE`/`RFQ_APPROVE`/`RFQ_INVITE`/`RFQ_UNSEAL` — **không có `rfq.open`, không có `rfq.cancel`** — nên câu gọi ấy hôm nay không viết ra được. Đóng đúng: thêm hai mã quyền vào `permissions.ts` VÀ vào 005 (meta-test giữ hai bên đồng bộ), rồi gọi `requirePermission` ở đầu hai hàm — KHÔNG đặt phép kiểm bên trong `issueRfqKeyPair`/`revokeRfqKeyMaterial`, vì trigger đã buộc chúng vào cạnh chuyển trạng thái; quyền thuộc về CẠNH | `packages/rfq/src/rfq.ts` (`openRfq`, `cancelRfq`); `packages/identity/src/permissions.ts` |
| 32 | **ĐÃ ĐÓNG [2026-09-05].** Mọi `UnsealDeniedError` nay ghi `UNSEAL_DENIED` mang tên vế, ở một giao dịch ĐỘC LẬP — và có test dựng đúng ca rollback của người gọi để chứng minh bản ghi sống qua nó. Một lần THỬ vi phạm D2 ghi `UNSEAL_APPROVAL_DENIED`; phân loại theo THÔNG BÁO chứ không theo SQLSTATE, và đó là một thu hẹp đã ghi tại chỗ (hai trigger dùng chung `check_violation`). Nguyên văn: ~~**D5 chỉ đúng cho vế 1 của cổng mở thầu; ba vế còn lại từ chối trong IM LẶNG.**~~ `requirePermission` ghi `PERMISSION_DENIED` ở một giao dịch độc lập, nên vế `PERMISSION` thoả D5. `MFA_FRESH`, `RFQ_CLOSED` và cả hai nhánh `POLICY_GATE` ném `UnsealDeniedError` mà **không ghi gì**. Nặng hơn: một lần tự-phê-duyệt bị `unseal_kiem_nguoi_duyet` chặn làm ROLLBACK cả giao dịch của `approveUnseal` — **kể cả bản ghi `UNSEAL_APPROVED`** — nên một lần THỬ vi phạm D2 không để lại một dấu vết nào. Một người trong tổ chức dò *"RFQ đóng chưa / phê duyệt về chưa"* bằng cách gọi `dispatchUnseal` liên tục sinh ra **con số không** bản ghi. Đóng đúng: ghi một sự kiện từ chối ở giao dịch ĐỘC LẬP cho mỗi `UnsealDeniedError`, mang `clause`, không mang `reason`; và bắt hai lỗi trigger của D2 theo SQLSTATE rồi ghi ngoài giao dịch | `packages/unseal/src/gate.ts`, `packages/unseal/src/requests.ts` |
| 33 | **ĐÃ ĐÓNG [2026-09-05].** `CUA_GOI` nay có `unseal` và `bidding`, và bảng phân loại nở từ ba rổ lên SÁU: thêm `HAM_DOC_CO_QUYEN` (đọc mà vẫn phải có cổng), `HAM_THUAN_TUY`, `HAM_TU_LA_CONG`. Rổ thứ nhất KHÔNG phải một nhãn — một test đọc MÃ NGUỒN từng hàm và đòi thân nó thật sự gọi `requirePermission`; để phép đọc ấy thấy được, lời gọi phải nằm THẲNG trong thân hàm chứ không trong một helper dùng chung, và `comparison.ts` đã được viết lại theo đúng ràng buộc ấy. Nguyên văn: ~~**Lớp canh cổng quyền tự làm mù mình đúng ở hai gói mới nhất và nhạy nhất.**~~ `tests/architecture/cong-quyen-route.test.ts` giữ `CUA_GOI` gồm `supplier`, `rfq`, `invitation` — **không có `unseal`, không có `bidding`**. Tức `requestUnseal`/`approveUnseal`/`cancelUnseal`/`dispatchUnseal` (toàn bộ phê duyệt kép của việc lộ mọi giá trong một RFQ) cộng `buildComparisonTable`/`countReceivedBids`/`submitBid` đều **không bị lớp ấy nhìn thấy**. Một module `apps/api` tương lai gọi `approveUnseal` mà quên dòng quyền sẽ đi qua sạch sẽ. Đây đúng khuôn lỗi mà chính file ấy dựng lớp thứ hai để chặn (nợ 3 và 16), và nó tái diễn ở lần thứ ba. Đóng đúng: thêm hai gói vào `CUA_GOI`, và **không** xếp hai hàm đọc của S1.7 vào rổ `HAM_CHI_DOC` — rổ ấy biện minh bằng *"không đổi trạng thái"*, câu ấy sai với một hàm mà mục đích duy nhất là kiểm soát TIẾT LỘ | `tests/architecture/cong-quyen-route.test.ts` |
| 34 | **ĐÃ ĐÓNG [2026-09-05]** bằng `apps/unseal-worker/src/composition.ts` cộng migration `025`. Hai `kind` nay có handler; `onJobFailure` là THAM SỐ BẮT BUỘC nên một composition root không còn diễn đạt được cấu hình *"hỏng trong im lặng"*; `BreakGlassAlertSink` phải tiêm vào và KHÔNG có mặc định — một mặc định *"ghi log cho có"* là đúng thứ làm người ta tưởng cảnh báo đã tới tay ai đó. Cộng một lớp chống-mù suy từ TÍNH CHẤT: mọi `kind` được enqueue trong kho phải HOẶC có handler, HOẶC nằm trong `KIND_KHONG_NHAN` kèm lý do. Nguyên văn: ~~**Cảnh báo break-glass được PHÁT nhưng KHÔNG AI NHẬN.**~~ Không handler nào đăng ký `BREAK_GLASS_UNSEAL_ALERT` và không tiến trình nào `LISTEN` trong sản phẩm — `grep` toàn kho chỉ ra hai chỗ: chính migration 019 và một test. Tệ hơn *"chưa nối"*: `JobRunner` ghi một job không có handler thẳng sang `FAILED` với lý do `NO_HANDLER`, và `onJobFailure` **mặc định im lặng**. Nên hôm nay cảnh báo mức cao được tạo ra rồi bị đánh dấu chết, không một tiếng động. D4 nói *"không bao giờ im lặng"*; vế ấy đúng ở tầng SINH, sai ở tầng GIAO. Phải nối TRƯỚC khi đường break-glass được dùng thật | `db/migrations/019_unseal.sql` mục (5); `packages/outbox/src/runner.ts` |
| 35 | **ĐÃ ĐÓNG [2026-09-05].** Bucket đích tách làm hai: `DEST` khoá theo (LỜI MỜI, ĐÍCH) — hạn mức thật, không xuyên qua lời mời được nữa — và `DEST_ORG` theo đích toàn tổ chức, một TRẦN CHI PHÍ đặt ở 20 để ba lời gọi không vũ khí hoá được. Mọi bucket nay được tăng TRƯỚC mọi phán quyết, nên việc một lần từ chối vẫn tiêu ngân sách là một QUYẾT ĐỊNH đã ghi ra chứ không một tác dụng phụ. Test đo đúng kịch bản ADR-015 §5 đặt tên. Nguyên văn: ~~**Hạn mức OTP theo ĐÍCH đang KHOÁ chứ không LÀM CHẬM.**~~ ADR-015 §5 viết rõ *"chỉ được làm chậm, không được khoá, vì khoá theo đích cho phép một người khoá lối vào của người khác"*. Bản cài đặt từ chối thẳng (`DEST_RATE_LIMITED`), và khoá bucket là `HMAC(pepper, orgId ‖ "DEST" ‖ đích)` — **không mang lời mời, không mang RFQ**. Nên ba lần phát cho một số điện thoại ở RFQ-1 làm chính nhà cung cấp ấy không nhận được OTP cho RFQ-2 trong 15 phút. Thứ tự cũng sai: hai bucket `CALLER` và `INVITATION` được tăng TRƯỚC phép kiểm `DEST`, nên một lần bị chặn vẫn tiêu ngân sách của lời mời | `packages/invitation/src/invitation.ts` (`issueOtpChallenge`) |
| 36 | **ĐÃ ĐÓNG [2026-09-05].** ⑴ `verifyOtpAndStartSession` nay KHẲNG ĐỊNH nó đang ở trong một giao dịch — và phép đo ấy đã phải viết lại một lần: bản đầu so `statement_timestamp()` với `now()` và **đỏ giả trên một test hợp lệ**, vì hai mốc ấy trùng nhau ở độ phân giải micro giây. Bản hiện tại dùng `SET LOCAL` rồi đọc lại ở câu sau — nhị phân, không phụ thuộc đồng hồ. ⑵ Phép so `token_hash` — phép so credential chịu lực duy nhất của cả lát cắt — nay ghim `OPERATOR(pg_catalog.=)` và `::pg_catalog.bytea`, với một test đọc thẳng mã nguồn. Nguyên văn: ~~**Hai khoản nợ về cách viết SQL trong `packages/invitation`.**~~ ⑴ Cổng OTP đọc trạng thái ở MỘT câu (`FOR UPDATE`) rồi tăng bộ đếm ở câu KHÁC; nó chỉ tuần tự hoá đúng khi người gọi đang ở trong một giao dịch — điều `withTenant` hôm nay bảo đảm nhưng **không lớp nào cưỡng chế**, và chú thích tại chỗ đang nói mạnh hơn thứ mã làm được. ⑵ Gói này dùng `=` trần ở **mọi** vị từ, kể cả phép so `token_hash` — phép so chịu lực duy nhất của cả lát cắt — trong khi `audit`/`identity`/`outbox` ghim `OPERATOR(pg_catalog.=)` **127 lần** vì một lần chiếm `search_path` đã được TÁI LẬP END-TO-END và lật được một phán quyết an ninh | `packages/invitation/src/invitation.ts` |
| 37 | **ĐÃ ĐÓNG [2026-09-05].** `UNIQUE (org_id, rfq_id, supplier_id)` đổi thành chỉ mục duy nhất BỘ PHẬN `WHERE revoked_at IS NULL`, nên mời lại được sau khi thu hồi — mà vế gốc *"một nhà cung cấp được mời ĐÚNG MỘT LẦN cho mỗi RFQ"* vẫn nguyên, có test riêng. `clearOtpLockout` là đường ra của khoá cấp-lời-mời: có mã quyền `invitation.unlock`, có audit, và một trigger của `024` cấm `failed_attempts` GIẢM — gỡ khoá là một hành vi, không phải một lần xoá dấu vết. Nguyên văn: ~~**Thu hồi lời mời là VĨNH VIỄN, và khoá theo lời mời không có đường mở.**~~ `rfq_invitations` mang `UNIQUE (org_id, rfq_id, supplier_id)` **không có vị từ bộ phận loại `REVOKED`**, nên một lần bấm nhầm loại một nhà cung cấp khỏi RFQ ấy mãi mãi. Cùng lúc, khoá cấp-lời-mời của 012 chặn MỌI lần phát thách thức mới khi còn một thách thức đang khoá — nên ai cầm một link đã chuyển tiếp giữ được nhà cung cấp thật ở ngoài vô hạn (5 lần sai → khoá 900 giây → lặp), và không có hàm nào gỡ khoá. Cả hai là đường CHẶN NGƯỜI KHÁC DỰ THẦU, cùng họ với nợ 35 | `db/migrations/010_invitations.sql:52`; `db/migrations/012_invitation_hardening.sql` |
| 38 | ~~**[S1.10.7, review M-1/M-7] `/auth/link` còn ORACLE THỜI GIAN** — nhánh có người dùng làm INSERT + gửi, nhánh không thì một SELECT rồi về; gửi mail/SMS nay ở SAU COMMIT (không đổi mã trạng thái, không giữ pool) nhưng RTT hai nhánh vẫn khác. Đóng đúng cách: đặt job outbox cho MỌI email (kể cả không tồn tại) và phát token trong handler outbox. Cùng dòng: bọc/mở bí mật TOTP (KMS) vẫn chạy TRONG giao dịch; pool `app_api` chưa có `statement_timeout`/`idle_in_transaction_session_timeout`~~ **ĐÓNG 2026-09-07 (S1.12, ADR-022)** — `/auth/link` chỉ `enqueueJob(LOGIN_LINK_SEND, {email})` — MỘT INSERT cho mọi email; handler outbox (tiến trình `api`, `outbox-api.ts`) tra người dùng, phát token, gửi; đo: ba email (có/lạ/đình chỉ) để lại đúng ba job và KHÔNG token nào trước khi runner chạy. Cùng dòng: `statementTimeoutMs` ở `createPool`; trần 5 s cho hai adapter KMS (`co-han.ts`) — chúng vẫn chạy trong giao dịch (ADR-022 §1) | `apps/api/src/routes/auth.ts`, `dispatch.ts` (afterCommit) |
| 39 | ~~**[review M-2] Không có bucket theo NGƯỜI GỌI cho `/auth/link`, `/auth/redeem`, `/auth/totp`** — chỉ hạn mức theo người dùng (5 token/15 phút). ADR-020 từng hứa `LOGIN_DEST` trên `otp_rate_limits`; câu ấy đã sửa cho đúng thứ đang có. Cần bucket `CALLER` (IP) ⇒ 429 — và nó phụ thuộc nợ 41~~ **ĐÓNG 2026-09-07 (S1.12, ADR-022)** — migration `038` (`LOGIN_CALLER`); dispatcher đếm trong giao dịch RIÊNG trước handler (token sai vẫn bị đếm — đo: 30 lần 422 rồi 429), 429 + `Retry-After`; trần link 10 / redeem 30 / totp 30 mỗi 15 phút; đối chứng bảng route bỏ `callerLimit` ⇒ không bao giờ 429 | `packages/identity/src/login.ts` |
| 40 | ~~**[review M-5] Không có đường QUẢN TRỊ đặt lại TOTP** — người mất bí mật đã xác nhận không có lối vào; ghi danh lại chỉ cho hồ sơ CHƯA xác nhận. Cần một route hai người duyệt + audit~~ **ĐÓNG 2026-09-07 (S1.12, ADR-022)** — migration `040` + `user.mfa_reset` (PM, DIRECTOR) + `mfa-reset.ts` + hai route; CHECK người duyệt ≠ người yêu cầu và phiên khác; hồ sơ TOTP bị XOÁ (không sửa) chỉ khi CSDL thấy yêu cầu đã duyệt chưa tiêu thụ (trigger BEFORE DELETE); mọi phiên thu hồi; ba đột biến (gỡ trigger xoá, gỡ hai CHECK, hết hạn) đều RED thật | `apps/api/src/routes/auth.ts` |
| 41 | ~~**[review M-8] `remoteAddressOf` là một hook, chưa có cài đặt đọc `X-Forwarded-For` theo CIDR tin cậy** — chừng nào chưa có, api KHÔNG được đặt sau proxy/LB (ADR-020 ghi); nếu đặt, bucket `CALLER` của OTP thành hạn mức toàn tổ chức~~ **ĐÓNG 2026-09-07 (S1.12, ADR-022)** — `apps/api/src/dia-chi.ts` (`net.BlockList`): `X-Forwarded-For` chỉ được đọc khi socket ∈ `TRUSTPROCURE_TRUSTED_PROXIES`, đi từ phải sang trái bỏ hop proxy; header giả/hỏng ⇒ socket; đo qua `sessions.ip` | `apps/api/src/server.ts` |
| 42 | ~~**[review L-2] Cookie phiên chưa dùng tiền tố `__Host-`; cookie trùng tên lấy giá trị ĐẦU** — một subdomain anh em bị chiếm ném cookie được (login CSRF). Đổi tên cookie là đổi hợp đồng với client — làm khi có client thật~~ **ĐÓNG 2026-09-07 (S1.12, ADR-022)** — `__Host-tp_session` / `__Host-tp_guest` (Secure, `Path=/`, không `Domain`); `docCookie` gặp tên lặp thì BỎ tên ấy ⇒ 401 | `apps/api/src/routes/auth.ts`, `anon.ts`, `router.ts` |
| 43 | ~~**[review M-4] Vế CSDL của "phiên chỉ ra đời sau một lần TOTP đúng" chưa có** — trigger 029 chỉ đòi `mfa_verified_at`; bằng chứng TOTP nay là KIỂU (`MfaProof`), không phải hàng trong CSDL. Làm được bằng trigger đòi `mfa_credentials.last_used_counter` gần đây, nhưng phải đổi cách tám phép đo lược đồ 006 chèn `sessions` (dưới superuser thay vì `app_api`)~~ **ĐÓNG 2026-09-07 (S1.12, ADR-022)** — migration `039`: trigger AFTER INSERT `sessions` (đường ứng dụng, 037) đòi hồ sơ TOTP đã xác nhận có `last_used_counter` trong 3 bước 30 s — bốn phép đo 006 dưới `app_api` dùng người MỚI có hồ sơ tươi (không chuyển sang superuser); gỡ trigger ⇒ bộ đếm cũ đi lọt | `db/migrations/031_ghi_danh_lai_totp.sql` (khối đầu), `packages/identity/src/login.ts` |
| 44 | ~~**[review lượt 2, H2-2] `PROCUREMENT_MANAGER` giữ cả `policy.manage` lẫn `rfq.create`** — người đặt ngưỡng đặt được ước lượng, nên D2 hạ xuống MỘT phê duyệt bằng một PM + một người duyệt. Câu biện minh sai ở 030 đã gạch; §4 của D2 ghi phần chênh. **QUYẾT ĐỊNH ĐANG CHỜ:** tách vai, hay mở rộng trigger D3 cấm một vai giữ cả hai~~ **ĐÓNG 2026-09-06 (chốt: cả hai)** — migration `033`: `policy.manage` chuyển sang `FINANCE`; hai trigger mới cấm `policy.manage` đứng cùng `rfq.create`/`rfq.approve` ở một vai VÀ ở một người (hợp các vai); ba bản của danh sách loại trừ khoá bằng meta-test; hai đột biến gỡ trigger ⇒ đi lọt. Hệ quả: khe hở [A3b] hẹp lại (BUYER không tự gán FINANCE được nữa), ca [C1] đổi sang REQUESTER+DIRECTOR | `db/migrations/033_policy_manage_khong_cung_tay.sql`, `packages/identity/src/permissions.ts` |
| 45 | ~~**[review lượt 2, H2-3] Vế CSDL của "`version` chính sách không ghim được tổ chức"**~~ **ĐÓNG 2026-09-06 (PR #7)** — migration `035` thay thân trigger 022: `version` phải BẰNG đúng lớn nhất + 1 (giá trị kỳ vọng, không chọn được, không ghim được); test: 2147483647 / max+2 / max lặp ⇒ 23514, max+1 đi qua; gỡ trigger ⇒ 2147483647 đi vào. Nguyên văn cũ: [review lượt 2, H2-3] Vế CSDL của "`version` chính sách không ghim được tổ chức" — tầng HTTP nay đòi `version` = hiện hành + 1 (giá trị kỳ vọng, chống đua), nhưng một `app_api` bị chiếm vẫn INSERT được `version = 2147483647` và trigger 022 ("phải lớn hơn") + không UPDATE/DELETE ghim tổ chức vĩnh viễn. Đóng đúng: trigger tự gán `version = max + 1`, hoặc `CHECK (version < 1000000)` phòng hờ | `db/migrations/022_security_review_s1.sql` (khối `chinh_sach_phien_ban_tang_dan`) |
| 46 | ~~**[review lượt 2, H2-9 ⑵] Không ràng buộc CSDL nào nói `contact ∈ supplier` cho lời mời**~~ **ĐÓNG 2026-09-06 (PR #7)** — migration `036`: UNIQUE `(org_id, supplier_id, id)` trên `supplier_contacts` + khoá ngoại tổ hợp trên `rfq_invitations`; test: contact của Y dưới danh nghĩa X ⇒ 23503 nêu đúng tên ràng buộc, cặp đúng đi qua; gỡ khoá ngoại ⇒ lời mời lệch đi vào. Nguyên văn cũ: [review lượt 2, H2-9 ⑵] Không ràng buộc CSDL nào nói `contact ∈ supplier` cho lời mời — `rfq_invitations` chỉ có FK `(org_id, contact_id)`; route nay kiểm TRƯỚC khi tạo, nhưng gọi `createInvitation` từ nơi khác (job, route tương lai) với contact của NCC khác thì link tới người của Y mà đơn thầu mang danh X. Cần FK tổ hợp `(org_id, supplier_id, contact_id) → supplier_contacts (org_id, supplier_id, id)` | `db/migrations/010_invitations.sql`, `packages/invitation/src/invitation.ts` |
| 47 | ~~**[review lượt 2, H2-11 ⑵⑶] Quét H17 chứng minh "KHÔNG quyền ⇒ 403", không chứng minh mã quyền ĐÚNG**~~ **ĐÓNG 2026-09-06 (PR #6)** — vòng quét "mỗi route ghi × mỗi mã quyền ĐƠN LẺ": chỉ đúng `route.permission` qua cổng, mọi mã khác 403, đếm chéo bằng sổ kiểm toán, tự sinh từ `ROUTES` × `PERMISSIONS` ("mọi quyền trừ một" bất khả thi vì D3/033 cấm gom quyền — phép đo tương đương, trigger-an-toàn); lớp canh tĩnh nay cấm cả ĐỊNH DANH `requirePermission`/`withTenant`/`withGuestSession` ngoài dispatch.ts (bí danh cũng bị bắt). Nguyên văn cũ: [review lượt 2, H2-11 ⑵⑶] Quét H17 chứng minh "KHÔNG quyền ⇒ 403", không chứng minh mã quyền ĐÚNG — `/rfqs/:id/approve` gán nhầm `RFQ_CREATE` vẫn xanh; chỉ ba route được đo chéo ở test vòng đời. Cần vòng quét "mọi quyền TRỪ `route.permission` ⇒ 403" tự sinh từ `ROUTES`. Cùng dòng: lớp canh tĩnh `\brequirePermission\s*\(` bị `const rp = requirePermission` qua mặt (ADR-016 §4 đã tự nhận) | `apps/api/src/buyer.int.test.ts`, `routes.test.ts` |
| 48 | ~~**[review lượt 2, H2-12] `resolveSessionActor` (đường gói, trigger 013) KHÔNG xét `users.status`, và đình chỉ KHÔNG thu hồi phiên**~~ **ĐÓNG 2026-09-06 (PR #6)** — migration `034`: trigger `users_thu_hoi_phien_khi_dinh_chi` thu hồi mọi phiên còn sống trong cùng giao dịch (kích hoạt lại không mở lại; chạy được dưới `app_api` qua RLS); `resolveSessionActor` nối `users.status = 'ACTIVE'`; test `dinh-chi.int.test.ts` với đột biến gỡ trigger. Dự đoán "bộ test identity bật/tắt SUSPENDED phải sửa trước" hoá ra KHÔNG cần: không test nào dùng lại phiên sau lần đình chỉ. Nguyên văn cũ: [review lượt 2, H2-12] `resolveSessionActor` (đường gói, trigger 013) KHÔNG xét `users.status`, và đình chỉ KHÔNG thu hồi phiên — đường HTTP chặn (L-1, JOIN `users.status`); đường gói không; người bị đình chỉ rồi kích hoạt lại thì mọi phiên cũ còn TTL sống lại. Cần trigger `AFTER UPDATE OF status ON users` thu hồi phiên trong cùng giao dịch + `u.status = 'ACTIVE'` ở `resolveSessionActor` — nhưng bộ test identity bật/tắt `SUSPENDED` nhiều lần trên cùng phiên, phải sửa test trước | `packages/identity/src/session-actor.ts`, `db/migrations/006_sessions_and_mfa.sql` |
| 50 | ~~**[S1.11] Hai trigger 029/032 điều kiện theo `current_user = 'app_api'`, còn tiến trình thật đăng nhập bằng `app_api_login` (INHERIT) — quên `SET ROLE` là cả hai IM LẶNG**~~ **MỞ VÀ ĐÓNG CÙNG VÒNG (2026-09-06, ADR-021)** — đo được trước khi đóng: `app_api_login` không `SET ROLE` chèn được `sessions` thiếu MFA và thay được bí mật TOTP đã xác nhận, trong khi mọi test xanh (chúng chạy dưới `poolAs`, có `SET ROLE`). Đóng hai lớp: migration `037` (vị từ `la_duong_ung_dung('app_api')` = kế thừa quyền + không superuser, thay vào hai thân trigger) và `createPool(..., { role: "app_api" })` (`SET ROLE` + kiểm `current_user` mỗi lần lấy client — một bản dùng chung với `poolAs`). Đột biến trả vị từ về tên cũ ⇒ cả hai câu đi lọt. NOINHERIT cho role đăng nhập bị loại có lý do (ADR-021 §3c) | `db/migrations/037_vai_ung_dung_la_thanh_vien.sql`, `packages/db/src/vai-tro.ts` |
| 49 | ~~**[review lượt 2, H2-4 ⑶ + bộ dò] Bộ quét rò rỉ gọi route GHI với thân `{}`** — chúng dừng ở 422 trước nghiệp vụ, nên vòng quét chứng minh cho route đọc nhiều hơn route ghi; và bộ dò là `includes` chuỗi thập phân đã biết (giá viết `980,000,000`, `9.8e8`, base64, thứ tự xếp hạng đi lọt). Cần gọi route ghi với thân HỢP LỆ trên một RFQ hy sinh, và bộ dò theo giá trị số (mọi cách viết)~~ **ĐÓNG 2026-09-07 (S1.12, ADR-022)** — bộ quét gọi mọi route ghi với thân HỢP LỆ trên hai RFQ hy sinh (0 route dừng ở 422 hình dạng, ≥ 10 route tới 2xx); bộ dò theo GIÁ TRỊ (mọi cách viết + base64) với đối chứng dương từng dạng. Vẫn không bắt rò THỨ TỰ — §4 của A2 | `apps/unseal-worker/src/kich-ban-41-http.int.test.ts` |
| 51 | ~~**[review lượt 4, H4-7] Thân BỐN hàm trigger mới chưa được hardening ghim** — `sessions_kiem_totp_gan_day` (039), `mfa_credentials_xoa_can_yeu_cau` + `mfa_reset_kiem_quyen` (040), `outbox_jobs_xoa_payload_dang_nhap` (041), và máy trạng thái `mfa_reset_kiem_chuyen_trang_thai` (040, VÔ ĐIỀU KIỆN — không đi qua điểm đơn `la_duong_ung_dung`). Một `CREATE OR REPLACE` sau triển khai làm chúng no-op và sống qua `migrate()` — đúng ca R3 đã đo. Cần ghim thân + `tgenabled='A'` theo khuôn `user_roles_phan_tach_nhiem_vu`, và mở rộng đột biến 037↔039/040 ở `vai-tro.int.test.ts`~~ **ĐÓNG 2026-09-07 (S1.13, ADR-023)** — ~~năm~~ tám mục hardening theo khuôn `la_duong_ung_dung` với tiền điều kiện "migration nguồn đã áp dụng" [H5-2]: thân chuẩn hoá + thuộc tính hàm + `pg_get_triggerdef` + `tgenabled='A'` cho `sessions_kiem_totp_gan_day`, `mfa_reset_kiem_quyen` (2 trigger + 2 trigger danh tính [H5-5]), `mfa_reset_kiem_chuyen_trang_thai`, `mfa_credentials_xoa_can_yeu_cau`, `outbox_jobs_xoa_payload_dang_nhap`, và [H5-5] `kiem_danh_tinh_theo_phien` (013), `sessions_kiem_mfa_khi_tao`, `mfa_credentials_khoa_ho_so_da_xac_nhan` (037); test đồng bộ tám thân + test trôi kể cả `DROP … CASCADE` (đỏ thật trước khi thêm mục và với tiền điều kiện cũ) | `db/migrations/hardening.always.sql` |
| 52 | ~~**[review lượt 4, H4-4/H4-5] Hạn mức theo người gọi: chưa có trần TOÀN TỔ CHỨC cho `/auth/link`** (IPv6 gom /64 rồi vẫn xoay được /56); tổ chức LẠ không bị đếm (hai giao dịch lỗi mỗi lời gọi — cần một bucket ngoài CSDL vì không có khoá ngoại), và 429 là oracle tồn tại tổ chức (chấp nhận, nói ra: `orgId` UUIDv4); bucket theo người gọi chưa áp cho `/guest/redeem`, `/guest/otp/verify` (ADR-022 "Không hứa")~~ **ĐÓNG 2026-09-07 (S1.13, ADR-023)** — `orgLimit` (bucket `route|to-chuc`, `/auth/link` 300/15 phút); `BucketBoNho` cho tổ chức lạ (cùng trần, fail-closed khi đầy ~~⇒ oracle H4-5 đóng~~ [H5-3] oracle còn, đổi dạng — nợ 55); `callerLimit` 30 cho `/guest/redeem`, `/guest/otp/verify`. [H5-1] `orgLimit` LÀM CHẬM, không khoá, và chỉ cộng khi người gọi chưa vượt trần riêng. Vẫn theo tiến trình (nhiều instance = nhiều bộ đếm — ADR-022) | `apps/api/src/dispatch.ts`, `apps/api/src/routes/auth.ts` |
| 53 | ~~**[review lượt 4, H4-10] Bộ gửi chạy TRONG giao dịch của job `LOGIN_LINK_SEND`** — `send` xong mà kết cục không ghi được (mất lease, COMMIT hỏng) ⇒ email đã đi mang token bị rollback (link chết), rồi email thứ hai (at-least-once). Nay chỉ có trần 5 s riêng cho `send`. Khi có bộ gửi thật: tách gửi khỏi giao dịch (ghi token + commit, gửi, đánh dấu) hoặc pool riêng nhỏ cho runner~~ **ĐÓNG 2026-09-07 (S1.13, ADR-023)** — `JobHandler` trả về `SauCommit`; runner chạy nó sau khi DONE đã commit và kết nối đã huỷ, có trần; ném/treo ⇒ `AFTER_COMMIT_FAILED`, job vẫn DONE, không thử lại (at-most-once cho phần gửi — nói ra ở ADR-023 §1). Handler `LOGIN_LINK_SEND` trả về hàm gửi: token commit trước, gửi sau | `apps/api/src/outbox-api.ts` |
| 54 | ~~**[review lượt 5, H5-5] Danh sách ghim thân hàm trigger ở hardening vẫn VIẾT TAY** — 48 hàm `RETURNS trigger` trong `public`, ghim 8 (S1.13) + hai của D3 + `chan_sua_xoa`; 21 trigger của `kiem_danh_tinh_theo_phien` (013) chưa ghim định nghĩa. Cần một test "mọi hàm trigger trong `public` có mặt trong danh sách ghim (hoặc trong danh sách loại trừ có lý do)" để danh sách không tự làm mù mình lần thứ ba~~ **ĐÓNG 2026-09-07 (S1.14, ADR-024)** — test ĐẦY ĐỦ ở `db/migrations.int.test.ts`: tập hàm `RETURNS trigger` trong `public` = (hàm hardening có canh, đọc THẲNG từ `hardening.always.sql`) ∪ (35 mục loại trừ, mỗi mục một dòng nói nó canh gì), hai tập rời nhau — thêm một hàm trigger mới mà không khai là ĐỎ (đo bằng migration tạm). Ghim thêm định nghĩa 19 trigger danh tính của `kiem_danh_tinh_theo_phien` (rải bảy migration, `tgenabled='O'`). Loại trừ = CHƯA ghim, không phải không cần ghim — sổ nợ 56 | `db/migrations/hardening.always.sql`, `db/migrations.int.test.ts` |
| 55 | ~~**[review lượt 5, H5-3] Oracle tồn tại tổ chức qua 429 (H4-5) vẫn còn, đổi dạng** — bucket bộ nhớ (tổ chức lạ) và bucket CSDL (tổ chức thật) là hai bộ đếm rời: mồi N lần vào một UUID giả rồi gửi UUID ứng viên ⇒ 429 = lạ, 200 = thật, MỘT lời gọi. Chấp nhận (UUIDv4 không vét cạn được); đóng thật cần một bảng bucket người gọi KHÔNG khoá ngoại tới `organizations`, tổ chức thật hay lạ đếm cùng hàng~~ **ĐÓNG 2026-09-07 (S1.14, ADR-024)** — migration `042`: bảng `caller_rate_limits` không `org_id`, không khoá ngoại ⇒ tổ chức thật và tổ chức lạ tăng CÙNG MỘT HÀNG (429 hết là oracle); `BucketBoNho` của nợ 52 bị xoá; bộ dọn nền 5 phút xoá cửa sổ cũ hơn hai cửa sổ; policy DUY NHẤT là 'mọi hàng, trừ phiên khách'. Bucket toàn tổ chức ở lại `otp_rate_limits` — phần chênh còn lại là THỜI GIAN của một giao dịch lỗi khoá ngoại | `apps/api/src/dispatch.ts`, `apps/api/src/bucket-bo-nho.ts` |
| 56 | ~~**[S1.14 / nợ 54] 35 hàm `RETURNS trigger` còn lại CHƯA được hardening ghim thân** — danh sách có tên và có lý do ở `HAM_TRIGGER_KHONG_GHIM` (`db/migrations.int.test.ts`), và test đầy đủ của nợ 54 giữ cho nó không lớn thêm trong im lặng. Cả 35 thuộc cùng lớp trôi R3 (một `CREATE OR REPLACE FUNCTION … RETURN NEW` sau triển khai sống qua `migrate()`). Thứ tự đóng nên theo "app_api ghi được bảng nó canh không": nhóm RFQ/unseal/bid trước (máy trạng thái, D2, append-only), nhóm còn lại sau~~ **ĐÓNG 2026-09-07 (S1.15, ADR-025)** — ghim nốt 35 hàm, 41 trigger, cùng khuôn khối S1.13; `HAM_TRIGGER_KHONG_GHIM` nay **RỖNG** và phép kiểm đổi từ "hai tập phủ nhau" sang "tập ghim BẰNG tập thật" (thêm một dòng loại trừ là MỞ LẠI khoản nợ này). Không đóng theo nhóm như dự kiến — ghim cả 35 cùng lúc vì bản ghim đọc THẲNG từ CSDL nên chia nhóm chỉ thêm việc. Ba lớp mới đi kèm: ⑴ migration ghi trong mỗi mục phải là migration CUỐI CÙNG định nghĩa hàm (bảy hàm được `CREATE OR REPLACE` nhiều lần — ghim nhầm bản cũ làm `migrate()` LÙI hàm ở MỌI lần chạy, và test đồng bộ KHÔNG thấy); ⑵ `045` nâng 37 trigger còn lại lên `ENABLE ALWAYS` ⇒ 80/80 là `'A'`, có phép kiểm suy từ tính chất; ⑶ [H7-1] tập trigger của MỌI hàm đã ghim phải bằng đúng tập đã khai | `db/migrations/hardening.always.sql`, `db/migrations.int.test.ts` |
| 57 | ~~**[review lượt 6, H6-5 ⑵] `otp_rate_limits` không có bộ dọn** — bảng chỉ lớn lên: một hàng cho mỗi đích, mỗi lời mời, mỗi người gọi, mỗi cửa sổ; `GRANT DELETE` có từ 010 nhưng chưa ai gọi. Ba đường đã xét, đường nào cũng vướng~~ **ĐÓNG 2026-09-07 (S1.15, ADR-025)** — đường THỨ TƯ: migration `044` thêm một policy `FOR DELETE TO app_api` chỉ có hiệu lực trên kết nối CHƯA gắn tổ chức và chỉ trên hàng đã quá SÀN 30 phút. Ba đường cũ vẫn đúng như đã ghi; đường này không hỏi "tổ chức nào" mà hỏi "hàng này còn chặn được ai". Bộ dọn **xoá được mà KHÔNG đọc được** (`FOR DELETE`, không `FOR ALL` ⇒ `[INV-F1]` còn đúng nguyên văn), nên câu dọn KHÔNG có `WHERE`: PostgreSQL đòi policy SELECT ngay khi câu lệnh tham chiếu cột — đã đo, `WHERE` ⇒ 0 hàng, câu trần ⇒ xoá đúng hàng quá sàn. Hai cửa ngoại lệ có tên được mở (`NGOAI_LE_HINH_DANG` dòng ĐẦU TIÊN sau ba vòng rỗng, `NGOAI_LE_LAC_CHO`), mỗi cửa một meta-test | `packages/invitation/src/invitation.ts`, `apps/api/src/composition.ts` |
| 58 | ~~**[S1.15 / review H7-3] Bộ dọn `otp_rate_limits` quét TOÀN BẢNG mỗi năm phút** — và không sửa được bằng một chỉ số: vế lọc là OR của hai policy trên hai cột, nên bộ lập lịch chọn Seq Scan kể cả khi ước lượng của nó là `rows=1`~~ **ĐÓNG 2026-09-07 (S1.16, migration `046`) — bằng cách BÁC BỎ TIỀN ĐỀ CỦA CHÍNH NÓ.** Phép đo của H7-3 có thật; chế độ của nó thì không đại diện: **95% hàng đã quá sàn**, nơi Seq Scan là tối ưu THẬT, nên kết luận *"không chỉ số nào phục vụ được"* là một suy diễn quá phạm vi. Đo lại ở chế độ của một bảng ĐANG CHẠY (200 000 hàng, **1%** quá sàn): PostgreSQL dựng `BitmapOr` từ `otp_rate_limits_pkey` (vế `org_id = <GUC>`) và `otp_rate_limits_window_idx` (vế `window_start < mốc`) — **1,07 ms** so với **37,96 ms**, tức **35 lần**, và chi phí đi theo SỐ HÀNG PHẢI XOÁ chứ không theo KÍCH THƯỚC BẢNG. `046` dựng lại chỉ số mà H7-3 đã gỡ; `db/otp-don-ke-hoach.int.test.ts` canh kế hoạch, có ĐỐI CHỨNG DƯƠNG (gỡ chỉ số ⇒ quay về Seq Scan). Bài học đắt hơn bản vá: **một phép đo ở MỘT chế độ không phải một kết luận cho MỌI chế độ** — và lần này chính lớp "đo trước khi tin" của dự án lại là thứ sinh ra lời khai sai | `packages/invitation/src/invitation.ts`, `db/migrations/044_don_bucket_otp.sql` |
| 59 | **[S1.19] Khẳng định *"mã nguồn hiện tại không vi phạm quy tắc nào"* KHÔNG HERMETIC.** `apps/api/src/routes.test.ts` viết một probe thật vào `apps/api/src/routes/` rồi chạy `depcruise`; `tests/architecture/boundaries.test.ts` chạy `pnpm run depcruise` trên TOÀN kho. Hai tệp khác nhau ⇒ vitest chạy song song ⇒ lượt quét toàn kho nhìn thấy probe của tệp kia. **Quan sát được LẶP LẠI trong lượt gộp `pnpm evidence` (chạy cả hai tầng trong một tiến trình), và CHƯA LẦN NÀO trong lượt `pnpm test` đơn tầng** — chênh lệch khớp với cơ chế: lượt gộp có nhiều tệp chạy song song hơn nên cửa sổ chồng lấn rộng hơn.

> **KHÔNG ghi một tỷ lệ ở đây, và việc đó là có chủ đích.** Dòng này lần lượt mang *2/2* rồi *2/3*, và mỗi lượt đo tiếp theo lại bác con số vừa ghi — lượt thứ tư đỏ, thành *3/4*. Một tỷ lệ của một CHẠY ĐUA không phải một hằng số của kho: nó phụ thuộc số nhân công vitest, tải máy, và số tệp test đang có. Ghi nó như một hằng số là một khẳng định rộng hơn phép đo — chỉ khác ở chỗ nó tự bác mình nhanh hơn thường lệ. Thứ ổn định và đáng ghi là CƠ CHẾ, cộng hai vế định tính ở trên. — chênh lệch khớp với cơ chế: lượt gộp có nhiều tệp chạy song song hơn nên cửa sổ chồng lấn rộng hơn. Cửa sổ ấy còn rộng thêm sau S1.18 (13 probe mới). Hệ quả cho CI: job `evidence` KHÔNG đỏ vì `pnpm evidence` cố ý cho bước vitest đỏ (xem khối đầu `chay-evidence.mjs`), nhưng T1/T2 thì đỏ được — chỉ là hiếm hơn. Không phải fail-open — là ĐỎ GIẢ — nhưng một cổng đỏ ngẫu nhiên là cổng người ta học cách chạy lại thay vì đọc. Đường đóng có thể: cho mọi probe ghi vào một thư mục ngoài cây được cruise, hoặc cưỡng chế chạy tuần tự cho nhóm test chạy depcruise (`describe.sequential` / `poolOptions`), hoặc để lượt quét toàn kho đọc một cây SẠCH (`git stash`-free: cruise một bản `git archive`) | `tests/architecture/boundaries.test.ts`, `apps/api/src/routes.test.ts` |

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

~~**Sau S1.3 (2026-08-29): 747 test, xanh toàn bộ**~~ **[S1.10.2, 2026-09-06] 1092 khẳng định, 50/51 (33/34 + 17/17), `pnpm test` 491/491 — xem Hành động tiếp theo mục 16.** Số cũ giữ nguyên văn: **Sau vòng cài ADR-016/017/018 (2026-08-30 → 09-03): 802 khẳng định, `pnpm evidence` thoát mã 0, 0 file đỏ, độ phủ ĐỨNG YÊN ở 30/50 — xem ba mệnh đề cố ý không mang nhãn ở trên.** Số cũ giữ nguyên văn: — 367 ở `pnpm test` (20 file) và 380 ở
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
CMK, chưa có role nào được tạo. **[S1.11]** Nhưng nay có một tiến trình `api` khởi động được từ
biến môi trường (`pnpm api:dev`, ADR-021) với adapter dev — thứ một lần triển khai sẽ thay bằng
adapter KMS và bộ gửi thật; tiến trình từ chối khởi động khi được khai một adapter chưa có.

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

14. **[2026-09-06] Commit `623458b` (đóng khoản 29 và 30) được ĐẨY LÊN mà chưa chạy lại tầng
    T1 trên cây mã sắp đẩy — CI bắt được, và hai lớp canh nổ đúng như thiết kế.** Con số
    *"1056/1056 khẳng định, 48/50"* trong mô tả PR #2 là thật cho lượt `pnpm evidence` chạy
    **trước** khi `apps/public-keys` được thêm; nó không phải phép đo trên HEAD đã đẩy. Run
    `33978573210`: T0, T0b, T3 xanh; **T1+T2 đỏ trên cả `ubuntu-latest` lẫn `windows-latest`**;
    job `evidence` vì thế **bị bỏ qua** — tức 48/50 chưa từng được CI xác nhận cho tới `83e4cba`.

    Hai thứ đỏ, hai bản chất khác nhau:
    ⑴ `tests/architecture/cong-quyen-route.test.ts` — mốc chết *"`apps/` có app khác ngoài
    worker"* nổ vì `apps/public-keys` ra đời. Đây là **lớp canh làm đúng việc**: khẳng định ấy
    được viết ra để đỏ vào đúng ngày này. Viết lại thành phát biểu cho HAI app (worker không
    viết được `requirePermission` vì role `app_unseal`; `public-keys` chỉ đọc, không xác thực,
    không gọi hàm ghi nào — và vế *"không gọi hàm ghi"* nay là một PHÉP ĐO trên mã nguồn của nó,
    không phải một câu chú thích). Mốc chết mới: app **thứ ba** làm nó đỏ, và nếu đó là
    `apps/api` thì là ngày ADR-016 mục 4 hẹn.
    ⑵ `tests/architecture/hinh-dang-ci.test.ts` — đỏ **chỉ trên Windows**, ba khẳng định
    *"không tìm thấy job"*. Checkout mới với `core.autocrlf=true` cho `ci.yml` dạng CRLF nên
    `\n  t0:\n` không khớp; máy phát triển xanh vì worktree có sẵn file LF. **Đúng khoản nợ 10
    cắn**, và là lần thứ hai một bảo đảm chỉ đúng trên một hệ điều hành (bài học S0 §7 Handoff) —
    lần này theo chiều ngược: ma trận hai hệ điều hành của khoản 20 là thứ **bắt được** nó. Sửa:
    chuẩn hoá `\r\n` trước khi đọc, vì bảo đảm nói về HÌNH DẠNG của `ci.yml`, không về byte
    xuống dòng.

    Cả hai đo bằng đột biến trước khi commit: ép `ci.yml` sang CRLF → 3/3 vẫn xanh (trước sửa
    3/3 đỏ); thêm `apps/zz-mutant` vào chỉ mục git → test route ĐỎ với thông điệp *"app THỨ
    BA"*. `pnpm t0` 133 module / 0 vi phạm, `pnpm test` 466/466. Run **`34004571171`** trên
    `83e4cba`: **xanh cả sáu job**, kể cả `evidence`. Không một dòng mã sản phẩm nào đổi; ma
    trận không đổi vì hai test không mang nhãn INV.

    **Bài học, ghi để không lặp:** lệnh cuối trước `git push` phải là lệnh đo trên đúng HEAD
    sắp đẩy. Một lượt đo trên cây mã cũ là bằng chứng cho cây mã cũ.

15. **[2026-09-06] VÒNG TIẾP THEO ĐÃ ĐƯỢC ĐẶT TÊN VÀ LẬP KẾ HOẠCH, CHƯA VIẾT MỘT DÒNG MÃ: S1.10 —
    tầng HTTP đầu tiên (`apps/api`).** Không phải S2: S2 chưa có spec và không nên có trước khi một
    người mua thật đi hết `docs/TIEN-DE-CHUA-DO.md`. S1.10 là cây cầu — nó cho hai mã trống cuối
    (A2, E6) và ba phần chênh §4 (A5, E1, D5) một chủ ngữ.

    **Ba phát hiện của lượt đọc mã, và cả ba đổi phạm vi:** ⑴ **không hàm sản phẩm nào chèn
    `sessions`** — năm file test tự chèn; nợ 6 vẫn mở nguyên. ⑵ **`users` không có cột mật khẩu**
    (002) — tức *route người mua đầu tiên* kéo theo *đường đăng nhập đầu tiên*, không tách được.
    ⑶ ADR-008 ghi một nợ *bắt buộc trả trước endpoint đăng nhập* mà chưa ai nhắc lại từ 28/08.

    **ADR-020 (trạng thái *Đề xuất — chờ chốt*)** trả lời bốn câu: `node:http` trần + bảng route
    KHAI BÁO (loại NestJS của spec 26/08 — lý do là *route phải là dữ liệu liệt kê được* để ba
    lớp canh "với MỌI route" đo được không cần khởi động tiến trình); phiên người mua bằng magic
    link email + TOTP, **không mật khẩu**, nợ ADR-008 trả bằng phương án (ii); token vào **fragment**
    của URL, không bao giờ vào path/query; đường khách chỉ nhận `client` đã gắn phiên, cưỡng chế
    bằng `g9-`. Kế hoạch: `docs/superpowers/plans/2026-09-06-s1.10-tang-http.md` — bảy hạng mục,
    16,5 ngày công, ba migration, quỹ đạo 48/50 → 50/50 với A2 **mang cờ §4**.

    **Ba việc cần người chốt trước dòng mã đầu tiên:** ADR-020 (cả bốn mục); mã quyền
    `policy.manage` thuộc vai nào (ADR-017 để ngỏ; đề xuất `PROCUREMENT_MANAGER`); có thêm H17
    (*mọi route ghi khai quyền*) vào sổ đăng ký hay không. Và **một tiền đề mới B6** ở
    `TIEN-DE-CHUA-DO.md`: người mua có chấp nhận TOTP không — nếu không, S1.10.4 thành SSO và đó
    là một cuộc di trú bảng phiên.

16. **[2026-09-06] S1.10.2 ĐÃ CÓ MÃ — `apps/api` ra đời, và route đầu tiên ra đời CÙNG LÚC với cổng
    của nó, đúng điều kiện ADR-016 mục 4 ghim từ 2026-08-30.** Đo được, không cảm tính:

    | Phép đo | Kết quả |
    |---|---|
    | `pnpm t0` | 146 module, 473 phụ thuộc, 0 vi phạm; họ `g9-` mới có probe ĐỎ THẬT |
    | `pnpm test` | 491/491 (30 file) |
    | `apps/api/src/api.int.test.ts` — tiến trình HTTP thật, cổng thật | 11/11 |
    | `pnpm evidence` | **50/51** (33/34 nghiệp vụ + 17/17 hàng rào), 1092 khẳng định, *Cổng evidence: XANH* |
    | Đột biến ⑴ gỡ `withGuestSession` khỏi bộ điều phối | `[INV-A5]` qua HTTP **ĐỎ** — hai khách thấy phiên của nhau |
    | Đột biến ⑵ gỡ bộ header mặc định của `server.ts` | `[INV-E6]` **ĐỎ hai chỗ** |
    | Đột biến ⑶ handler import `@trustprocure/tenancy` | depcruise **ĐỎ** với `g9-api-routes-khong-cham-tenancy-va-db` |

    **Hình dạng của khung, và vì sao mỗi phần ở chỗ nó ở:** `route-types.ts` (kiểu + `timViPhamBangRoute`
    thuần), `routes.ts` (lắp `ROUTES` — DỮ LIỆU liệt kê được, điểm chịu lực của ADR-020), `routes/*.ts`
    (handler, KHÔNG có pool, KHÔNG có `withTenant`, KHÔNG có `node:http`), `dispatch.ts` (nơi DUY NHẤT
    gọi `withTenant` / `withGuestSession` / `requirePermission`; hai giai đoạn lỗi: xác thực ⇒ một 401
    duy nhất, handler ⇒ 403/422/mã của `HttpError`/500 câm), `server.ts` (file DUY NHẤT chạm
    `node:http`; ba header của E6 đặt SAU header của handler nên không ghi đè được; trần thân 64 KiB
    cưỡng chế TRONG LÚC đọc). Bốn route đủ để đo khung: `GET /health`, `GET /guest/session`, `GET /me`,
    `GET|POST /suppliers`. Hai hàm mới ở hai gói: `resolveSessionByToken` (identity — cookie → phiên
    người mua, đòi `mfa_verified_at`) và `resolveGuestSessionByToken` (invitation — cookie → phiên
    khách, chỉ tra, không gắn GUC).

    **Ba điều lượt này tìm ra bằng cách CHẠY, không bằng cách đọc:** ⑴ `routes.ts` import `routes/*`
    và `routes/*` import kiểu từ `routes.ts` là một **vòng** — `khong-phu-thuoc-vong` bắt ở lượt T0 đầu;
    kiểu tách sang `route-types.ts`. ⑵ `req.destroy()` ngay khi vượt trần làm client thấy *"other side
    closed"* thay vì **413** — đo ở lượt int đầu; nay 413 đi ra trước, socket đóng ở `finish`. ⑶ Bộ
    quét *"chỉ dispatch.ts gọi `requirePermission`"* bản đầu đếm CHUỖI và tự đỏ vì chú thích của
    `routes/buyer.ts` nhắc tới tên ấy để nói nó KHÔNG gọi; nay bỏ chú thích rồi đo LỜI GỌI.

    **Sổ đăng ký nở 50 → 51 (H17), và E6 vào ✅ KÈM CỜ §4 ngay hôm nó vào:** hai phép đo (không tham
    số tên credential trong `ROUTES`; ba header trên mọi phản hồi kể cả 404/405) — còn magic link
    dạng URL (`/i#<token>`) là S1.10.3, và cờ nói đúng thế. `MOC_GHIM`: 48 → **50**, danh sách 2 → **1**
    (còn A2, S1.10.6). Kế hoạch S1.10 §4 dự báo E6 vào ở 10.3; thực tế vào ở 10.2 vì vế đo được của nó
    thuộc KHUNG chứ không thuộc route nghiệp vụ — ghi vào kế hoạch, không sửa dự báo cũ.

    **Một lần đỏ KHÔNG thuộc thay đổi này, ghi ra thay vì nuốt:** lượt `pnpm evidence` đầu tiên có
    `vitest thoát mã 1` — `packages/db/src/migrate.int.test.ts` *"[M10] unlock bị từ chối quyền khi kết
    nối còn sống"* đỏ (`expected 1 to be +0`) trong lượt gộp, và **xanh 15/15 khi chạy riêng**. Cùng
    họ với khoản nợ 24 (tranh chấp Docker), và **cổng evidence vẫn XANH** vì test ấy không mang nhãn
    INV — tức cổng chỉ canh test có nhãn, và một test hạ tầng đỏ đi lọt qua nó; job T3 của CI mới là
    nơi bắt. Lượt evidence thứ hai chạy lại để có một phép đo sạch trước khi đẩy.

    **Còn lại của S1.10 (chưa làm):** 10.3 đường khách + `consumed_at` (028); 10.4 đăng nhập người mua
    ⭐ (029, trigger `mfa_verified_at`, `MFA_LOCKED`); 10.5 route nghiệp vụ + `policy.manage` (030);
    10.6 bộ quét rò rỉ + kịch bản 41 qua HTTP (A2 vào có cờ); 10.7 bốn lượt security-reviewer.

17. **[2026-09-06] S1.10.3 ĐÃ CÓ MÃ — đường khách đi trọn qua HTTP, và một phép đo đã ĐỔI thiết kế
    của ADR-020 mục 4 cho đường ghi.** Bảy route: ba vô danh (`POST /guest/redeem`, `/guest/otp`,
    `/guest/otp/verify` — token trong THÂN, OTP đi tới bộ gửi tiêm vào chứ không về client, phiên
    đi ra bằng `Set-Cookie` HttpOnly/Secure/Strict/`Path=/guest`) và bốn có phiên (`GET /guest/rfq`,
    `POST /guest/bids`, `GET /guest/bids`, `GET /guest/bids/:id/receipt`). Đối tượng route thứ tư
    **ANON** ra đời cho ba route đầu, với lớp canh: chỉ POST, chỉ dưới `/guest/*` hay `/auth/*`.
    `guest.int.test.ts` **8/8** trên tiến trình thật: E2 (token một mình không mở được, kể cả nhét
    vào cookie), E1 (link bị tiêu thụ — T5 #9 có lớp), E6 (mã OTP và số điện thoại không có trong
    phản hồi), B2 (biên nhận nhận qua HTTP kiểm chứng bằng khoá công khai một mình), B1 (version 2,
    version 1 còn), A5 (khách B: danh sách rỗng, biên nhận của A ⇒ 404 trùng thân "không tồn tại"),
    ADR-017 (phản hồi không có ngân sách VÀ `SELECT count(*) FROM rfq_budgets` dưới phiên khách = 0).

    **Ba thứ tìm ra bằng cách CHẠY:**
    ⑴ **Ghi chú §4 của E1 đã THIU từ vòng sửa an ninh S1.3 mà không ai sửa lại.** Nó nói
    *"`consumed_at` không bao giờ được ghi… chơi lại được cho tới khi hết hạn"*; thực tế
    `verifyOtpAndStartSession` ghi `consumed_at` từ vòng H5, `docToken` đọc nó, trigger 012 cấm tắt
    lại, và test `[H5]` đã đo. Kế hoạch S1.10 §1 chép lại câu thiu ấy và định làm migration `028`
    cho một thứ đã có. Ghi chú §4 nay gạch nguyên văn cũ và trỏ tới cả hai phép đo (gói + HTTP).
    ⑵ **`rfq_key_material` đóng với khách** — 027 liệt kê nó trong danh sách "không có lý do xuất
    hiện trước một phiên khách", đúng cho khoá riêng đã bọc, SAI cho khoá công khai. `028` thay policy
    đóng bằng policy mở đúng RFQ được mời (USING theo GUC `app.guest_rfq_id`, WITH CHECK vẫn đóng);
    có đối chứng trong test: dựng lại policy 027 ⇒ `publicKeys: []`.
    ⑶ **Nặng nhất: một kết nối đã gắn phiên khách KHÔNG BAO GIỜ được chèn vào sổ kiểm toán.**
    `submitBid` chèn audit trong cùng giao dịch; dưới `withGuestSession` ⇒ `42501` ở `audit_append`
    (vế RETURNING bị USING đóng từ chối) — đúng như 027 hẹn. Bản đầu của 028 ĐÃ VIẾT policy mở khe
    ấy, rồi bị chính lược đồ bác bỏ: trigger `noi_chuoi_kiem_toan` (004) là SECURITY INVOKER và tìm
    đầu chuỗi dưới RLS của kết nối — khách với USING đóng thấy 0 hàng và chèn một NHÁNH RẼ; mở USING
    thì khách đọc sổ của cả tổ chức. Không policy nào đúng cả hai vế. **Kết luận kiến trúc:** route
    khách `mutates: true` chạy dưới `withTenant` sau khi phiên đã xác thực; cô lập đường ghi do
    trigger `bid_kiem_phien_khach` (018) + chữ ký `submitBid` giữ. Đường ĐỌC vẫn `withGuestSession`.
    Phần chênh ghi vào §4 của A5: handler ghi của khách KHÔNG được viết SQL tay, và lớp cho ca ấy
    hôm nay là review. Đây là **một sửa đổi của ADR-020 mục 4**, ghi ở `dispatch.ts` khối [S1.10.3]
    và ở 028 — không phải một ngoại lệ lặng lẽ.

    **Số đo:** `pnpm t0` 149 module / 0 vi phạm; `pnpm test` 491/491; ba bộ tích hợp api + khách +
    lời mời 75/75; db 119/119 sau khi ba danh sách migration mong đợi nhận `028`. Độ phủ **đứng yên
    50/51** — đúng: 10.3 không lấp mã nào, nó cho E1/E2/E5/A5/B1/B2 một phép đo THỨ HAI qua HTTP.
    Còn lại: 10.4 ⭐, 10.5, 10.6, 10.7.

18. **[2026-09-06] S1.10.4 ĐÃ CÓ MÃ — đăng nhập người mua theo ADR-020 mục 2 (magic link email +
    TOTP, không mật khẩu), và HAI khoản nợ có tên đóng cùng lượt: nợ 6 (nửa PHÁT) và nợ ADR-008.**
    Migration `029`: bảng `user_login_tokens` (cùng khuôn `rfq_invitation_tokens`, có policy `_khach`
    đóng vì lớp canh ở `tests/adversarial/a5-*` đòi), `GRANT INSERT (mfa_verified_at)` cho `app_api`
    và trigger `sessions_kiem_mfa_khi_tao`: **một hàng `sessions` do `app_api` chèn phải đã MFA** —
    không có "đăng nhập nửa chừng" trong bảng. Trigger cố ý điều kiện theo `current_user`, khác
    các trigger 011/013, vì hàng thiếu MFA là trạng thái hợp lệ cho test/vận hành; điều bị cấm là
    ỨNG DỤNG tạo ra nó. `packages/identity/src/login.ts`: `issueLoginToken` (không ném khi không có
    người dùng — để route không thể lỡ tay phân biệt), `redeemLoginToken`, `verifyTotpForLogin`
    (ghi `MFA_LOCKED` khi `justLocked` — ADR-008 phương án ii), `startUserSession` (tiêu thụ token
    + chèn phiên đã MFA trong CÙNG giao dịch), `revokeSession`. Bốn route: `POST /auth/link`,
    `/auth/redeem` (ghi danh TOTP lần đầu, bí mật base32 về client ĐÚNG MỘT LẦN), `/auth/totp`
    (cookie `tp_session`), `/auth/logout` — route "tự thân" (`self: true`, không mã quyền, lớp
    canh chỉ cho phép dưới `/auth/*`).

    **Số đo:** `auth.int.test.ts` 9/9 — không liệt kê email (đúng/lạ/đình chỉ cùng một 200, token
    chỉ tới bộ gửi); hạn mức 5 token/15 phút mỗi người; E2 (token nhét cookie ⇒ 401, redeem không
    mở phiên); E6 (token và bí mật TOTP không có trong log, kể cả khi ép một 500); E1 (replay ⇒
    422, không hàng phiên nào thiếu MFA); E3 (5 lần sai ⇒ khoá, ĐÚNG MỘT `MFA_LOCKED`, lần sau
    không ghi thêm); đăng xuất; `[029]` app_api không chèn được phiên thiếu MFA, superuser chèn
    được, gỡ trigger ⇒ đi lọt. Đột biến gỡ dòng ghi `MFA_LOCKED` ⇒ [INV-E3] ĐỎ (`expected 0 to be
    1`). `pnpm t0` 152 module / 0 vi phạm; `pnpm test` 491/491; ba bộ api 28/28; db + mfa 177/177.

    **Hai câu cũ bị 029 ĐẢO NGƯỢC, gạch tại chỗ chứ không xoá:** ⑴ Task 9 (rls-coverage, mfa.int)
    ghi *"`mfa_verified_at` KHÔNG INSERT — trạng thái đã xác thực hai lớp phải tới bằng một câu
    lệnh riêng"*; ADR-020 đòi điều ngược lại và mạnh hơn (không tồn tại hàng nửa chừng), nên hai
    test đổi kỳ vọng kèm chú thích. ⑵ ADR-008 *"có nợ bắt buộc trả trước endpoint đăng nhập"* —
    trả trong cùng commit với endpoint ấy.

    **Hai thứ tìm ra bằng cách CHẠY:** ⑴ `a > b - c` viết bằng `OPERATOR(pg_catalog.x)` là
    `(a > b) - c` — mọi OPERATOR() cùng độ ưu tiên và kết hợp trái; `boolean - interval` (42883) ở
    `issueLoginToken` lượt đầu; nay có ngoặc và chú thích tại chỗ. ⑵ `LoginTokenError` chưa nằm
    trong bảng lỗi 422 của dispatcher nên replay token cho 500 thay vì 422 — thêm vào danh sách
    đóng. Phần chênh còn lại của 10.4: bí mật TOTP đi về client base32 trong MỘT phản hồi (đúng
    điều `generateTotpSecret` đòi) — ai mất bí mật chưa xác nhận thì KHÔNG có đường tự phục vụ;
    không hạn mức theo IP cho `/auth/link` (chỉ theo người dùng); adapter bọc/mở bí mật TOTP thật
    (KMS, CMK riêng — `apps/api` bị `g1-` cấm `crypto-keys/unwrap`) chưa có, test dùng AES-GCM.
    Còn lại: 10.5, 10.6, 10.7 (security-reviewer đang chạy cho 10.3 + 10.4).

19. **[2026-09-06] S1.10.5 ĐÃ CÓ MÃ — toàn bộ vòng đời phía người mua của kịch bản mục 41 qua HTTP,
    và một phép quét làm H17 thành mệnh đề "với MỌI route".** Migration `030`: mã quyền
    `policy.manage` cho `PROCUREMENT_MANAGER` (ADR-017 để ngỏ, chốt cùng ADR-020; `ma-tran-quyen.test`
    đòi TypeScript khớp nguyên văn bảng `permissions`, hai bên đổi cùng commit). `routes/buyer.ts`:
    10 route đọc (trong đó `comparison`/`bid-count` là đường đọc CÓ CỔNG — gói tự gọi
    `requirePermission(BID_VIEW)`, route chỉ đưa `auditPool`) và 18 route ghi, mỗi route một mã
    quyền, `resourceId` đọc từ ĐƯỜNG DẪN. `BuyerContext` nay có `auditPool` + `services` (khách cố
    ý không có pool nào); `ApiServices` thêm `rfqKeyWrapper` (cửa BỌC của crypto-keys — cửa MỞ thì
    `g1-` cấm) và `invitationLinkSender` (đích đọc từ `supplier_contacts`, token không về client).

    **Số đo (`buyer.int.test.ts` 4/4):** ⑴ **[INV-H17] QUÉT** — mọi route ghi trong `ROUTES`
    (18, trừ route tự thân) gọi bằng một phiên KHÔNG có vai trò ⇒ 403 tất cả, và `PERMISSION_DENIED`
    tăng ĐÚNG 18; ⑵ vòng đời: chính sách (BUYER 403) → NCC + liên hệ → RFQ 1 tỷ → hạng mục → ngân
    sách (`requiresDualApproval: true`) → nộp → duyệt: BUYER 403, PM2 200, PM2 lần hai **409**
    (UNIQUE `rfq_approvals_mot_nguoi_mot_lan`), mở với một phê duyệt 422, PM3 200 → mở: BUYER 403,
    PM 200 và **[INV-C5]** khoá xuất hiện sau, không trước → mời: token tới bộ gửi với đích
    `ban@thepviet.vn`, không trong phản hồi → gia hạn → đóng → thu hồi lời mời → **[INV-A4]** bảng
    so sánh 422 khi CLOSED chưa mở thầu → yêu cầu mở thầu (DIRECTOR) → người yêu cầu tự duyệt 422 →
    hai giám đốc khác duyệt → điều phối 200 = ĐÚNG MỘT `outbox_jobs` `UNSEAL_RFQ`, và bảng so sánh
    vẫn 422 sau điều phối (chưa UNSEALED). ⑶ huỷ: BUYER 403, thiếu lý do 422, PM 200; tham số đường
    dẫn không phải UUID ⇒ 404.

    **Một thứ tìm ra bằng cách CHẠY:** lớp CSDL nói "không" bằng SQLSTATE lớp 23 (61 chỗ
    `check_violation`, 3 `foreign_key_violation`, 1 `insufficient_privilege` trong migration) và
    bằng ràng buộc UNIQUE — bộ điều phối trước đó đọc chúng thành **500 câm**. Nay ánh xạ HẸP theo
    mã: 23514 ⇒ 422 kèm thông điệp (do migration VIẾT, không nội suy dữ liệu người dùng); 23505 ⇒
    409 thân cố định; 23503 ⇒ 422 thân cố định; 42501 ⇒ 403. Mọi mã khác vẫn 500 câm.

    **Review an ninh cho 10.3 + 10.4 đã về:** 0 CRITICAL, 0 HIGH, **8 MEDIUM, 8 LOW** — sổ nợ và
    `evidence/security-reviews.md` nhận ở 10.7. Hai thứ reviewer bắt được mà lượt viết không thấy:
    test `[INV-E6]` "bí mật không vào log" của `auth.int.test.ts` là phép đo RỖNG (đường 500 không
    chạy — ép bằng `code: 123456` chỉ cho 422); và chú thích ở `dispatch.ts` nói `withTenant` tra
    `organizations` — sai, nó chỉ kiểm hình dạng UUID (đã sửa chú thích). Còn lại: 10.6, 10.7.

20. **[2026-09-06] S1.10.6 ĐÃ CÓ MÃ — kịch bản mục 41 đi TRỌN qua HTTP, và độ phủ chạm 51/51 lần đầu.**
    `apps/unseal-worker/src/kich-ban-41-http.int.test.ts` (16 test, sống ở worker vì `g1-` cấm import
    `executeUnsealRequest` từ ngoài): năm người mua đăng nhập THẬT qua magic link + TOTP, năm nhà cung
    cấp đi trọn link → OTP → phiên → nộp phong bì → biên nhận, tất cả bằng `fetch`. Bước 11 (worker
    giải mã) CỐ Ý không qua HTTP — đó là điều A1/G1 đòi. **[INV-A1] [INV-A2] BỘ QUÉT RÒ RỈ:** năm mức
    giá thật gieo qua năm phong bì, rồi MỌI route trong `ROUTES` (bốn đối tượng, đọc lẫn ghi) gọi
    TRƯỚC khi mở thầu; quét thân + mọi header + mọi dòng `console.error` bắt được — không một chữ số
    giá nào lọt. Đối chứng dương: bộ quét bắt được chuỗi giá gieo vào thân giả, và SAU mở thầu nó
    THẤY giá ở bảng so sánh. **A2 vào ✅ KÈM CỜ §4** (đo phản hồi/header/log; KHÔNG đo heap và APM),
    vào `MA_PHAI_CO_CO_HEP` ngay hôm đó. `MOC_GHIM` 50 → **51**, danh sách được-phép-chưa-phủ **RỖNG**
    lần đầu tiên trong dự án. `pnpm evidence` 1129/1129, **51/51** (34/34 + 17/17), XANH. Bước 15 còn
    đo thêm: không token, mã OTP, bí mật nào của lượt chạy nằm trong sổ kiểm toán hay log.

    **Một lỗi của chính lượt này, ghi ra:** `214a741` (10.4 + 10.5) được đẩy với một lỗi lint —
    `pnpm t0` đã chạy TRƯỚC lần sửa cuối của `dispatch.ts`, còn `pnpm evidence` không chạy eslint.
    Cùng bài học mục 14, lần thứ hai. Sửa ở `9005a6a`.

21. **[2026-09-06] S1.10.7 — vòng sửa sau review an ninh, và lượt review thứ hai.** Lượt thứ nhất
    (10.3 + 10.4): 0 CRITICAL, 0 HIGH, **8 MEDIUM, 8 LOW** — bảng đầy đủ và trạng thái từng dòng ở
    `evidence/security-reviews.md` §S1.10. **Mười hai đóng bằng mã** trong cùng vòng: kiểm `Origin` /
    `Sec-Fetch-Site` cho mọi yêu cầu không-GET (M-3 — ADR-020 từng KHAI một lớp không tồn tại, nay
    có và có test); `MfaProof` — "mở phiên mà quên TOTP" thành câu không biên dịch được (M-4, vế
    kiểu); ghi danh lại TOTP cho hồ sơ CHƯA xác nhận + `MFA_ENROLLED` vào sổ (M-5, migration `031`
    cấp UPDATE bí mật, vế "chỉ khi chưa xác nhận" do `WHERE confirmed_at IS NULL` giữ, có đột biến);
    test `[INV-E6]` "bí mật không vào log" từng là phép đo RỖNG — nay ép 500 THẬT bằng bộ mở bí mật
    ném và đòi log không rỗng trước (M-6); gửi mail/SMS SAU COMMIT qua `afterCommit` (M-7);
    `remoteAddressOf` hook (M-8); JOIN `users.status` khi tra phiên — người bị đình chỉ ⇒ 401 ngay
    (L-1); chuẩn hoá khoá header (L-3); lớp canh tĩnh "route khách ghi không viết SQL tay" (L-5);
    bỏ hai bản sao bí mật TOTP (L-6); nén `reason` về hai giá trị, `lockedUntil` làm tròn lên phút,
    bỏ `userId` khỏi thân (L-7); ba timeout máy chủ tường minh (L-8). **Năm khoản vào sổ nợ 38–43:**
    oracle thời gian `/auth/link` (M-1), bucket theo người gọi cho `/auth/*` (M-2), đường quản trị đặt
    lại TOTP (M-5 nửa sau), cài đặt `X-Forwarded-For` theo CIDR (M-8 nửa sau), `__Host-` (L-2), vế
    CSDL của M-4. ADR-020 sửa hai câu cho đúng thứ đang có (CSRF, hạn mức đăng nhập).

22. **[2026-09-06] S1.10.7 — lượt review thứ HAI (10.5 + 10.6 + vòng sửa 10.7) và vòng sửa thứ hai.**
    0 CRITICAL, 0 HIGH, **4 MEDIUM, 8 LOW** — bảng ở `evidence/security-reviews.md` §S1.10 (lượt 2).
    **Ba chỗ vòng sửa thứ nhất đóng SAI, reviewer bắt được, đều đã sửa:** ⑴ M-5/031 — "vế chỉ khi
    chưa xác nhận có test kèm đột biến" là SAI: câu UPDATE của test tự mang `WHERE confirmed_at IS
    NULL`, và GRANT 031 cho một `app_api` bị chiếm thay bí mật của hồ sơ ĐÃ xác nhận; nay migration
    **`032`** (trigger BEFORE UPDATE khoá `secret_wrapped`/`secret_key_version`/`confirmed_at` khi đã
    xác nhận) và test viết lại: câu đột biến KHÔNG mang WHERE, đòi CSDL ném; gỡ trigger ⇒ đi lọt.
    ⑵ M-4 — "không biên dịch được" rộng hơn cơ chế: `MfaProof._tao` công khai và barrel xuất lớp
    dạng giá trị; nay `export type` + hàm tạo module-private. ⑶ §4 của A2 khai "cả đọc lẫn ghi" và
    "kể cả 4xx/5xx" — rộng hơn phép đo (route ghi dừng ở 422 với thân `{}`; 4xx không vào log; vòng
    quét chạy khi bản rõ chưa tồn tại phía máy chủ). Nay: vòng quét THỨ HAI sau mở thầu (năm phiên
    khách + người mua không `bid.view`), vế log đo trên một 500 THẬT, §4 viết lại.
    **Đóng bằng mã trong cùng vòng:** nhánh cho phép của `allowedOrigins` có test (H2-6); việc sau
    commit có TRẦN thời gian và chỉ chạy khi phản hồi < 400 (H2-7); thông điệp 23514 chỉ lộ khi đến
    từ `RAISE` của trigger (`routine = exec_stmt_raise`), CHECK thường và lớp 22 ra thân cố định,
    `uuidBody` cho định danh trong thân (H2-8); `resourceId` cho `/rfqs/:id/invitations` và
    `/rfqs/:id/unseal`, kiểm "contact ∈ supplier" TRƯỚC khi tạo (H2-9 ⑴); `version` chính sách chỉ là
    giá trị kỳ vọng = hiện hành + 1 (H2-3, vế HTTP); bốn `toBe(422)` nay đọc LÝ DO, vòng lặp
    `toBeTruthy` rỗng bị bỏ (H2-10); lớp canh L-5 quét cả phần đầu file (H2-11 ⑴). **Sáu khoản vào
    sổ nợ 44–49**, trong đó **44 là một QUYẾT ĐỊNH đang chờ** (PM giữ cả ngưỡng lẫn ước lượng —
    H2-2). D2 nhận cờ §4 lần đầu; D4 ghi "break-glass qua HTTP chưa đi được".

    **Một lỗi CI của chính vòng này, ghi ra:** `f40803f` đỏ ở job Windows — test L-5 tách `guest.ts`
    theo `\n` mà checkout Windows dùng CRLF (cùng họ `hinh-dang-ci.test.ts` ở PR #2, mục 14). Ubuntu
    xanh, nên `pnpm evidence` cục bộ (Windows, autocrlf tắt) không thấy. Sửa: chuẩn hoá CRLF và một
    đối chứng "không chuẩn hoá thì 0 route".

    **Số đo trên HEAD của vòng sửa 2:** `pnpm t0` 154 module / 0 vi phạm; `pnpm evidence` **1138/1138**,
    **51/51** (34/34 + 17/17), cổng XANH; danh sách được-phép-chưa-phủ vẫn RỖNG.

23. **[2026-09-06] Nợ 44 đóng — PR #4 đã merge (`610d510`, 9 commit, không squash), PR #5.** Chốt:
    `policy.manage` sang **`FINANCE`** (vai không có `rfq.create`, `rfq.approve`, `rfq.unseal`; `DIRECTOR`
    vẫn cố ý không được, lý do 023), và quy tắc *"người đặt ngưỡng không được là người đặt ước lượng
    hay người duyệt"* thành hai trigger ở migration **`033`**: mức vai trò (`role_permissions`) và mức
    người dùng (`user_roles`, hợp các vai). Không sửa thân hai hàm D3 của 005 (hardening ghim nguyên
    văn) — D2 là bất biến khác, có hàm riêng; danh sách loại trừ `POLICY_MANAGE_EXCLUDES` sống ở ba
    bản (TypeScript + hai thân trigger), meta-test `ma-tran-quyen.test.ts` khoá khớp nguyên văn, và
    bộ đọc ma trận tĩnh nay hiểu câu `DELETE` (033 là file đầu tiên xoá một hàng của ma trận — chỉ
    cộng INSERT thì PM vẫn "giữ" mã ấy). Mốc ghim mới `POLICY_MANAGE_CONFLICT_ROLE_PAIRS` (BUYER+FINANCE,
    FINANCE+PM, FINANCE+REQUESTER). Hai đột biến gỡ trigger ⇒ câu ghi đi lọt, khôi phục ⇒ chặn lại.
    Hai test cũ đổi ca đo vì chính lớp mới: [A3b] "BUYER tự gán FINANCE đi lọt" nay 42501 — khe hở hẹp
    lại, ca còn lọt là BUYER tự gán PROCUREMENT_MANAGER (ghi ở 005); [C1] BUYER+FINANCE đổi sang
    REQUESTER+DIRECTOR. Qua HTTP: PM tạo chính sách ⇒ 403, FINANCE ⇒ 201 (buyer.int, kịch bản 41).
    **Số đo trên HEAD:** `pnpm t0` 154 module / 0 vi phạm; `pnpm test` 497/497; `pnpm evidence` **1145/1145**,
    **51/51**, cổng XANH.

24. **[2026-09-06] Nợ 48 và 47 đóng — PR #5 đã merge (`886d812`), PR #6.** **Nợ 48:** migration **`034`**
    — đình chỉ một người (`users.status` rời `ACTIVE`) thu hồi mọi phiên còn sống của người ấy trong
    cùng giao dịch; kích hoạt lại KHÔNG mở lại phiên; trigger chạy dưới quyền phiên ghi nên `app_api`
    đình chỉ qua RLS cũng thu hồi đủ. `resolveSessionActor` (đường gói) nối `users.status = 'ACTIVE'`,
    cùng vế chịu lực của `hasPermission` — lớp đứng riêng cho phiên còn sống của người bị đình chỉ.
    Test mới `packages/identity/src/dinh-chi.int.test.ts`: bốn ca, đột biến gỡ trigger ⇒ phiên sống
    nguyên. Dự đoán ở sổ nợ "phải sửa bộ test identity trước" hoá ra sai: không test nào dùng lại một
    phiên sau khi đình chỉ. **Nợ 47:** ⑴ lớp canh tĩnh cấm cả ĐỊNH DANH `requirePermission` /
    `withTenant` / `withGuestSession` ngoài `dispatch.ts` (không chỉ lời gọi — bí danh `const rp =
    requirePermission` nay bị bắt, có đối chứng); ⑵ vòng quét "mỗi route ghi × mỗi mã quyền đơn lẻ" ở
    `buyer.int.test.ts`: một vai + một người cho MỖI mã quyền, và với mỗi route ghi chỉ đúng
    `route.permission` qua cổng, mọi mã khác 403; đếm chéo bằng sổ `PERMISSION_DENIED`. Cách reviewer
    đề nghị ("mọi quyền TRỪ một") bất khả thi theo đúng thiết kế — trigger D3 (005) và 033 cấm một
    vai/một người gom gần hết quyền — nên phép đo đổi chiều mà vẫn chứng minh cùng một điều.
    **Số đo trên HEAD:** `pnpm t0` 155 module / 0 vi phạm; `pnpm test` 497/497; `pnpm evidence` **1150/1150**,
    **51/51**, cổng XANH.

25. **[2026-09-06] Nợ 45 và 46 đóng — PR #6 đã merge (`fa111c6`), PR #7.** Hai migration ngắn, mỗi cái
    một đột biến. **`035`** (nợ 45): thân trigger `chinh_sach_phien_ban_tang_dan` của 022 thay bằng
    quy tắc "`version` phải BẰNG đúng lớn nhất + 1" — 022 chỉ chặn tụt, không chặn ghim ở trần int4;
    nay 2147483647, max+2 và max lặp đều 23514 với lý do đọc được, max+1 đi qua; gỡ trigger ⇒
    2147483647 đi vào (tổ chức bị ghim — đúng ca reviewer tả). Tầng HTTP giữ nguyên phép kiểm cùng
    nghĩa. **`036`** (nợ 46): UNIQUE `(org_id, supplier_id, id)` trên `supplier_contacts` (org_id đứng
    đầu — H14) và khoá ngoại tổ hợp `(org_id, supplier_id, contact_id)` trên `rfq_invitations`; hai
    khoá ngoại cũ giữ nguyên. Test: contact của nhà cung cấp Y dưới danh nghĩa X ⇒ 23503 nêu đúng
    tên ràng buộc, không để lại hàng; gỡ khoá ngoại ⇒ lời mời lệch danh tính đi vào. Sổ nợ còn mở
    sau vòng này: **38–43, 49** — toàn bộ là việc cần một tầng chưa có (outbox cho mail, proxy tin
    cậy, `__Host-`, đường quản trị TOTP, vế CSDL của M-4, bộ quét với thân hợp lệ).
    **Một test đổi số vì chính lớp mới:** `comparison.int` [INV-A6] chèn "chính sách ban hành SAU" bằng
    `version = 90` — dưới 035 phải là 3; lần `pnpm evidence` đầu của vòng này ĐỎ ở A6 vì thế, sửa test
    (cái nó đo là "sau", không phải "số lớn"). **Số đo trên HEAD:** `pnpm t0` 155 module / 0 vi phạm;
    `pnpm test` 497/497; `pnpm evidence` **1154/1154**, **51/51**, cổng XANH.

26. **[2026-09-06, tối] S1.11 — TIẾN TRÌNH `api` CHẠY THẬT (ADR-021, kế hoạch
    `docs/superpowers/plans/2026-09-06-s1.11-tien-trinh-api.md`).** Ba thứ mới trong `apps/api`:
    `cau-hinh.ts` (đọc môi trường thành cấu hình — bí mật không có mặc định, thông điệp chỉ nêu TÊN
    biến, adapter phải khai tên và hôm nay chỉ có `local-dev`/`dev-mailbox`, ba vòng bí mật phải đôi
    một khác nhau), `composition.ts` (hai pool `app_api` có vai, ba vòng bí mật, bộ ký, ba bộ gửi;
    `batDau()` chạm CSDL trước khi mở cổng), `main.ts` (`pnpm api:dev`; SIGTERM/SIGINT dừng sạch).
    Hai adapter dev: bọc/mở bí mật TOTP trên vòng khoá RIÊNG (AES-GCM + HKDF theo tổ chức), và hộp
    thư dev — ba bộ gửi ghi mỗi tin một tệp JSON, link ở fragment; cả hai qua `assertLocalDevAllowed()`.
    `@trustprocure/db` sang `dependencies` của `apps/api` (composition root sống trong app); phạm vi
    sản xuất ngoài vẫn hai dòng. **Khoản nợ 50 lộ ra và đóng trong cùng vòng** — xem sổ nợ: hardening
    ép `app_api_login` INHERIT, hai trigger 029/032 đọc `current_user = 'app_api'`, nên đường sản
    xuất không `SET ROLE` đi qua cả hai; migration **`037`** + `createPool({ role })`.
    Test (đếm từ báo cáo evidence): `packages/db/src/vai-tro.{test,int.test}.ts` (3 + 8), `apps/api/src/cau-hinh.test.ts` (23),
    `adapters/*.test.ts` (3 + 5), `composition.int.test.ts` (10 — gồm `main.ts` chạy như tiến trình con:
    cấu hình hỏng ⇒ mã thoát 1 nêu tên biến; đúng ⇒ `/health` 200 trên cổng in ra). Chưa có: adapter
    KMS, bộ gửi thật, bước build, `/readyz` chạm CSDL — ADR-021 §*Phần KHÔNG đóng*.
    **Lượt `security-reviewer` thứ ba (S1.11): 0 CRITICAL, 1 HIGH, 2 MEDIUM, 3 LOW — cả sáu đóng bằng mã
    trong cùng vòng** (`evidence/security-reviews.md` §S1.11). HIGH là thật và đáng đọc: lớp `SET ROLE`
    chỉ kiểm `current_user`, mà superuser `SET ROLE` sang bất kỳ role nào và `RESET ROLE` trả lại toàn
    quyền — nên URL superuser đi qua cả pool có vai lẫn vị từ 037. Nay lớp thứ ba
    `khangDinhPhienDangNhapUngDung` đọc `session_user` lúc khởi động (từ chối SUPERUSER/BYPASSRLS/
    CREATEROLE/thành viên `app_unseal`) và cấu hình đòi đúng tên `app_api_login`. MEDIUM đáng đọc:
    hộp thư dev chạy được ở `NODE_ENV=production` vì hàng rào local-dev coi lời khai dương là đủ —
    nay `local-dev` + `production` là mâu thuẫn (MED-1 sửa một luật, test cũ gạch tại chỗ). Hardening
    nhận hai dòng canh thân + ACL của `la_duong_ung_dung` (khuôn R3) kèm test đồng bộ và test trôi.
    **Số đo trên HEAD:** `pnpm t0` 169 module / 0 vi phạm; `pnpm test` 537/537; `pnpm test:int` (lượt
    đầy đủ trước lượt sửa review) 672/672, các bộ chịu ảnh hưởng chạy lại sau sửa: `vai-tro` 8/8,
    `composition` 10/10, `migrations` 87/87; `pnpm evidence` **1214/1214**, **51/51**, cổng XANH — ở lượt
    thứ BA. Hai lượt đầu đỏ cùng chỗ: hai ca hết hạn 30 s ("áp dụng sạch trên CSDL trống" của
    `migrations.int` và vòng quét H17 × mã quyền của `buyer.int`) khi cả hai tầng chạy trên cùng máy
    (đo: 5 s riêng → 21 s trong `test:int` → chạm 30 s trong evidence; lượt xanh: 19,5 s và 27,4 s). Không
    khẳng định nào sai; hai ca ấy nay có ngân sách riêng 120 s kèm số đo trong chú thích — không phải
    họ 57P01 của nợ 24. Lượt đầu còn một ca T10-M (outbox, thứ tự xoay vòng dưới tranh chấp) — đúng họ
    nợ 24, không tái hiện ở hai lượt sau; `do-lap.yml` hằng tuần là nơi đo tỷ lệ của nó.

27. **[2026-09-07] S1.12 — BẢY KHOẢN NỢ 38–43 VÀ 49 ĐÓNG, mỗi khoản một commit (ADR-022, kế hoạch
    `docs/superpowers/plans/2026-09-07-s1.12-tra-no-38-43-49.md`).** Thứ tự có lý do: 42 (cookie
    `__Host-`) → 41 (địa chỉ người gọi sau proxy khai CIDR) → 39 (bucket theo người gọi, `038`) → 43
    (trigger `039`: phiên đã-MFA cần TOTP gần đây) → 40 (đặt lại TOTP hai người, `040`) → 38 (outbox cho
    `/auth/link`, runner trong tiến trình `api`) → 49 (bộ quét với thân hợp lệ, bộ dò theo giá trị). Ba
    quyết định đáng đọc ở ADR-022: ⑴ đếm hạn mức theo người gọi NGOÀI giao dịch của handler — bên trong
    nó là đếm thành công chứ không đếm thử (bộ đếm OTP của khách hôm nay đúng như thế, ghi ra, chưa đổi);
    ⑵ đặt lại TOTP = XOÁ hồ sơ sau phê duyệt kép cưỡng chế ở CSDL, không sửa (bí mật cũ không được phép
    còn sống); ⑶ runner outbox chạy trong tiến trình `api` với `listOrganizations` = tập tổ chức đã thấy,
    vì `app_api` không đọc được danh sách tổ chức — giới hạn nhiều instance ghi ở ADR. **Lượt review an
    ninh thứ tư** (`evidence/security-reviews.md` §S1.12): 0 CRITICAL, 0 HIGH, 4 MEDIUM, 8 LOW — cả mười
    hai đóng bằng mã + test trong ba commit sửa cùng PR; ba phần chênh còn lại thành sổ nợ 51–53. Đáng nhớ
    nhất: H4-1 — 040 cưỡng chế "hai người, hai phiên" nhưng KHÔNG "hai người CÓ `user.mfa_reset`", tức
    hai phiên BUYER sống là đủ cho một `app_api` bị chiếm xoá hồ sơ TOTP của bất kỳ ai; nay trigger
    `mfa_reset_kiem_quyen` (khuôn 033) và đột biến gỡ nó đi lọt tới tận DELETE. Cùng lượt: migration
    `041` (payload email của job đăng nhập về `{}` khi job xong), bucket IPv6 theo /64, cận trên cho 039,
    route huỷ yêu cầu đặt lại TOTP. Sổ nợ mở còn: **0** trong 38–50 (23 và nửa sau của 30 vẫn mở từ S0),
    **51–53 mới mở** từ lượt review này. **Số đo trên HEAD:** `pnpm t0` 177 module / 0 vi phạm;
    `pnpm test` 548/548; `pnpm test:int` (lượt đầy đủ, trước lượt sửa review) 691/693 — hai phép đo ghim
    ở `mfa.int.test.ts` đỏ đúng vì `GRANT DELETE` mới của 040, sửa ở `c5cd561`; các bộ chịu ảnh hưởng
    chạy lại sau lượt sửa: `auth` 20/20, `migrations`+`shape`+`rls-coverage` 121/121, `kich-ban-41` 17/17,
    `composition` 10/10, `vai-tro` + `mfa` 50/50 (85/85 cả bộ), `mfa-reset` 7/7, `phien-can-totp` 5/5,
    `buyer` + `barrel` 24/24; `pnpm evidence` **1246/1246**, **51/51**, cổng XANH — ngay lượt đầu.

28. **[2026-09-07] S1.13 — BA KHOẢN NỢ 51–53 ĐÓNG, mỗi khoản một commit (ADR-023, kế hoạch
    `docs/superpowers/plans/2026-09-07-s1.13-tra-no-51-53.md`).** Thứ tự 53 → 52 → 51 vì 51 ghim THÂN
    các hàm trigger nên phải đi cuối. Quyết định đáng đọc: ⑴ `JobRunner` nhận việc SAU COMMIT từ
    handler — token commit trước, email gửi sau, và phần gửi là at-most-once có chủ đích (ném/treo ⇒
    `AFTER_COMMIT_FAILED`, job vẫn DONE, không thử lại; lý do này cố ý KHÔNG vào `last_failure_reason`);
    ⑵ tổ chức LẠ được đếm trong bộ nhớ theo `route|người gọi` cùng trần với tổ chức thật — oracle 429
    của H4-5 đóng bằng cách làm hai ca giống nhau, không bằng cách bỏ 429; bucket ấy fail-closed khi
    đầy; ⑶ trần toàn tổ chức 300/15 phút cho `/auth/link` là một DoS thu hẹp có chủ đích, rẻ hơn 300
    email rác. Nợ 51: test trôi đỏ THẬT trước khi thêm năm mục hardening (thân no-op sống qua
    `migrate()`), xanh sau. **Lượt review an ninh thứ năm**
    (`evidence/security-reviews.md` §S1.13): 0 CRITICAL, **1 HIGH**, 1 MEDIUM, 4 LOW — cả sáu đóng trong
    cùng PR; hai phần chênh thành sổ nợ 54–55. HIGH đáng nhớ: trần toàn tổ chức của nợ 52 là một VŨ KHÍ
    — `orgId` không phải bí mật, một địa chỉ 300 lời gọi khoá cửa đăng nhập cả tổ chức; nay bucket tổ
    chức LÀM CHẬM chứ không khoá (ADR-015 §5) và chỉ cộng khi người gọi chưa vượt trần riêng. MEDIUM:
    tiền điều kiện "hàm đã tồn tại" của nợ 51 làm `DROP FUNCTION … CASCADE` thành ca im lặng — đổi sang
    "migration nguồn đã áp dụng", đo bằng cách chạy test trôi trên bản hardening cũ (RED thật). **Số đo trên HEAD:** `pnpm t0` 179 module / 0 vi phạm; `pnpm test` 552/552;
    `pnpm test:int` lượt đầy đủ 705/705 tại `be200c3` (ba khoản nợ, trước lượt sửa review); sau lượt sửa
    H5, nhóm 11 tệp chịu ảnh hưởng (migrations, shape, rls, vai-tro, mfa ×3, guest, composition,
    kịch bản 41, outbox) 277/277 ở lượt chạy song song thứ hai — lượt đầu đỏ MỘT ca của bộ quét kịch
    bản 41 không tái hiện (chạy riêng 17/17; chi tiết bị bộ lọc đầu ra nuốt, ghi ra vì không đo lại
    được); `auth` 23/23, `co-han` 3/3; `pnpm evidence` **1258/1258**, **51/51**, cổng XANH ngay lượt đầu.

29. **[2026-09-07] S1.14 — HAI KHOẢN NỢ 54–55 ĐÓNG, mỗi khoản một commit (ADR-024, kế hoạch
    `docs/superpowers/plans/2026-09-07-s1.14-tra-no-54-55.md`).** Thứ tự 55 → 54 vì 54 ghim DANH SÁCH
    hàm trigger nên phải đi sau khi không còn gì đổi. Hai quyết định đáng đọc: ⑴ bộ đếm theo NGƯỜI GỌI
    rời khỏi `otp_rate_limits` sang một bảng KHÔNG có `org_id` — khoá ngoại ở đó chỉ mua một oracle,
    vì khoá của bucket là *route + địa chỉ kẻ gõ cửa*, không mang bí mật xuyên tổ chức nào; đây là
    bảng ĐẦU TIÊN ngoài cây tenant mà `app_api` ghi được, và một phép đo từng giả định "bật RLS ⇒
    thuộc cây tenant" đã phải sửa theo; ⑵ một danh sách VIẾT TAY phải có lớp đối chiếu với thực tế —
    hai lượt liền danh sách ghim của hardening thiếu đúng thứ vừa thêm mà không ai kêu, nay tập hàm
    trigger trong CSDL phải bằng đúng tập được canh ∪ tập loại trừ có lý do, và tập "được canh" đọc
    thẳng từ chính file hardening. **Sổ nợ mở còn:** 23 và nửa sau của 30 (từ S0), cộng **56 mới mở**
    (35 hàm trigger chưa ghim thân). **Lượt review an ninh thứ sáu:** 0 CRITICAL, **1 HIGH**, 4 MEDIUM, 4 LOW
    (`evidence/security-reviews.md` §S1.14) — cả chín đóng trong cùng PR, một phần chênh thành sổ nợ
    57. HIGH đáng nhớ: bỏ `org_id` khỏi khoá bucket đóng được oracle nhưng làm BÁN KÍNH NỔ của mọi ca
    "gộp địa chỉ" (proxy chưa khai, CGNAT) thành CẢ NỀN TẢNG — 31 lời gọi từ một địa chỉ khoá cửa đăng
    nhập của mọi tổ chức. Nay ba bộ đếm cùng ở bảng không khoá ngoại: `orgId` trong KHOÁ mà không có
    KHOÁ NGOẠI thì không phải oracle, và đó chính là thứ 042 mua được. MEDIUM đáng nhớ: oracle chưa
    đóng thật — nó chuyển sang độ trễ 2 giây của trần toàn tổ chức, vì tổ chức lạ không bao giờ chậm. **Số đo trên HEAD:** `pnpm t0` 177 module / 0 vi phạm; `pnpm test` 549/549;
    `pnpm test:int` **714/714** (lượt đầy đủ SAU lượt sửa review, trên HEAD sắp đẩy); `pnpm evidence`
    **1263/1263**, **51/51**, cổng XANH ngay lượt đầu. Lượt đầy đủ TRƯỚC lượt sửa (tại `aeaf611`) đỏ
    một ca: phép quét A5 đòi mọi bảng có RLS mang policy tên `<bảng>_khach`, và policy của 042 mang
    đúng vị từ ấy nhưng sai TÊN — sửa ở `aeaf611`, ghi ra vì nó là một lớp chống-mù bắt được đúng
    thứ nó tồn tại để bắt.

    **Một con số SAI trong chính merge commit của PR #2, ghi ra vì không sửa được:** thân của
    `b1a9a8b` viết *"giữ nguyên lịch sử 91 commit"*. Con số đúng là **44** — đo bằng
    `git rev-list --count b1a9a8b^1..b1a9a8b^2`, và GitHub cũng đếm 44. Số 91 đến từ phép đếm
    `master..s1-planning` trên nhánh `master` CỤC BỘ đang thiu ở `0b073d2` (trước cả merge S0),
    nên nó gộp luôn 46 commit của S0 và merge commit `30d1972`. Cùng họ lỗi với §*Trạng thái
    kiểm thử* đoạn *"hoà giải hai cách đếm"*: một con số đúng trong phạm vi của nó, đem ra khỏi
    phạm vi thì sai. Merge commit đã nằm trên `master` và sửa nó là viết lại lịch sử, nên câu
    này là bản đối chiếu, không phải bản sửa. Số commit của PR #1 (S0) là 46, của PR #2 (S1) là
    **44**; tổng lịch sử `master` sau hai lần merge: 92 commit trên `0b073d2`.

30. **[2026-09-07] S1.15 — HAI KHOẢN NỢ 56–57 ĐÓNG, mỗi khoản một commit (ADR-025).** Thứ tự 57 →
    56 vì 56 ghim DANH SÁCH hàm trigger nên phải đi sau khi lược đồ không còn gì đổi — cùng lý do
    đã dùng ở S1.14. Hai quyết định đáng đọc:

    ⑴ **Một bảng tenant DỌN ĐƯỢC MÀ KHÔNG ĐỌC ĐƯỢC.** `otp_rate_limits` chỉ lớn lên từ `010`, và ba
    đường mà sổ nợ 57 đã xét đều vướng RLS. Đường thứ tư (`044`) không hỏi *"tổ chức nào"* mà hỏi
    *"hàng này còn chặn được ai"*: một policy `FOR DELETE TO app_api` chỉ có hiệu lực trên kết nối
    CHƯA gắn tổ chức, chỉ trên hàng đã quá sàn 30 phút. Điều đắt nhất là một RÀNG BUỘC chứ không
    phải một lựa chọn — PostgreSQL đòi policy `SELECT` cho một `DELETE` ngay khi câu lệnh tham chiếu
    cột, nên bộ dọn chạy câu **TRẦN** và **không có tham số tuổi, và không thể có**. Đo trực tiếp,
    dưới `app_api` chưa gắn tổ chức, một hàng 90 phút tuổi: `DELETE … WHERE window_start < …` ⇒ **0
    hàng**; `DELETE FROM otp_rate_limits` ⇒ **1 hàng**.

    ⑵ **"Loại trừ" là một khoản nợ, không phải một hạng mục.** 35 dòng loại trừ của S1.14 canh máy
    trạng thái RFQ, D2, append-only của báo giá, tính bất biến của vật liệu khoá và tính đơn điệu của
    thu hồi — nay tất cả có mục ghim thật, `HAM_TRIGGER_KHONG_GHIM` **RỖNG**, và phép kiểm đổi sang
    *"tập ghim BẰNG tập thật"*.

    **Lớp mới đáng nhớ nhất của vòng**, và nó không phải lo xa: **bản ghim phải trỏ vào định nghĩa
    CUỐI CÙNG**. Bảy trong 35 hàm được `CREATE OR REPLACE` nhiều lần; hardening chạy TRƯỚC vòng
    migration đánh số và migration cũ không chạy lại, nên một bản ghim trỏ vào thân CŨ làm
    `migrate()` **LÙI** hàm về thân ấy ở MỌI lần triển khai, vĩnh viễn, trong im lặng — và test đồng
    bộ KHÔNG thấy, vì nó so hardening với đúng file được khai và hai bên khớp nhau hoàn hảo.

    **Sổ nợ mở còn:** 23 và nửa sau của 30 (từ S0), cộng **58 mới mở** (bộ dọn quét toàn bảng).

    **Lượt review an ninh thứ bảy:** 0 CRITICAL, 0 HIGH, **3 MEDIUM, 3 LOW**
    (`evidence/security-reviews.md` §S1.15) — cả sáu đóng trong cùng PR. MEDIUM đáng nhớ: ⑴ cùng cái
    mù mà H6-6 đóng cho MỘT hàm vẫn nguyên cho 42 hàm còn lại — gắn thêm một trigger cho một hàm đã
    ghim đi qua mọi lớp trong im lặng; ⑵ chỉ số `otp_rate_limits_window_idx` mà chính vòng này thêm
    **không bao giờ được đọc** (`EXPLAIN` cho Seq Scan kể cả khi ước lượng là `rows=1`) nhưng phải
    được ghi ở mọi lời gọi OTP — đã gỡ; ⑶ cửa `NGOAI_LE_LAC_CHO` không khoá LỆNH nên một
    `ALTER POLICY … USING (true)` trong cùng file cũng được tha.

    **MỘT FLAKE ĐƯỢC ĐO VÀ SỬA, không phải hồi quy của vòng này.** Lượt `pnpm evidence` đỏ đúng một
    ca: `[review H5-1] … lần 201: expected 200 to be 429` (`auth.int.test.ts:411`); chạy lại riêng
    tệp ấy ngay sau đó 26/26 xanh, vòng 300 lời gọi tốn 4,6 s. Chữ ký khớp một cơ chế mà chính dự án
    đã ghi ra từ trước: cửa sổ hạn mức RỜI RẠC, làm tròn theo EPOCH, nên mọi bộ đếm về 0 cùng lúc ở
    những mốc biết trước — một vòng đếm vắt qua ranh giới ấy thấy 200 ở đúng chỗ nó chờ 429. Bản vá
    không nới một ngưỡng nào: `beforeEach` của hai khối có vòng đếm không bắt đầu khi cửa sổ còn dưới
    45 giây. Ba bộ đếm của `/auth/*` nằm ở `caller_rate_limits`, không phải bảng mà `044` đụng tới.

    Và bản vá ấy CHƯA ĐỦ ở lượt đầu: lượt `pnpm test:int` đầy đủ tiếp theo (trên `f879d5c`) vẫn đỏ
    **1/723**, và danh tính ca ấy MẤT vì phép lọc đầu ra của chính lượt chạy — ghi ra thay vì im.
    Truy theo LỚP thay vì theo ca: `guest.int.test.ts` có đúng cùng hình dạng (30 + 30 lời gọi đếm
    cộng dồn), nên nó nhận cùng bản vá (`c4b453d`). Ba lượt `test:int` đầy đủ SAU đó: **723/723,
    723/723, 723/723**, và `pnpm evidence` thoát mã **0** (lượt trước thoát mã 1 dù cổng vẫn xanh).

    **Số đo trên HEAD (`c4b453d`):** `pnpm t0` 178 module / 0 vi phạm; `pnpm test` 554/554;
    `pnpm test:int` **723/723**; `pnpm evidence` **51/51**, **1277 khẳng định**, cổng XANH, vitest
    thoát mã 0.

31. **[2026-09-07] S1.16 — KHOẢN NỢ 58 ĐÓNG, và nó đóng bằng cách BÁC BỎ TIỀN ĐỀ CỦA CHÍNH NÓ.**
    Sổ nợ 58 ra đời từ phát hiện H7-3 của vòng trước: *"bộ dọn `otp_rate_limits` quét toàn bảng, và
    không chỉ số nào phục vụ được vế lọc OR của hai policy"*. Vòng này mở ra để tìm đường tối ưu, và
    việc đầu tiên là **đo lại tiền đề** thay vì đi thẳng vào đường thoát đã ghi sẵn. Tiền đề sai.

    Phép đo của H7-3 chạy trên 20 000 hàng với **19 000 (95%) đã quá sàn**. Ở tỷ lệ ấy Seq Scan là
    tối ưu THẬT — đọc tuần tự rẻ hơn đọc chỉ số rồi nhảy vào gần như mọi trang — nên bộ lập lịch
    chọn đúng, và thứ sai là câu suy ra từ đó. Đo lại ở chế độ của một bảng có bộ dọn chạy đều
    (200 000 hàng, **2 000 = 1%** quá sàn), cùng câu lệnh, cùng `app_api` chưa gắn tổ chức:

    | Phương án | Kế hoạch | Thời gian | Buffers |
    |---|---|---|---|
    | CÓ chỉ số | `BitmapOr`(`otp_rate_limits_pkey`, `otp_rate_limits_window_idx`) → Bitmap Heap Scan, `Heap Blocks: exact=25` | **1,07 ms** | `hit=25 read=3` |
    | KHÔNG chỉ số | `Seq Scan`, `Rows Removed by Filter: 198000` | **37,96 ms** | `hit=2470` |

    **35 lần**, và điều quan trọng hơn con số: có chỉ số thì chi phí đi theo SỐ HÀNG PHẢI XOÁ, không
    theo KÍCH THƯỚC BẢNG — tức toàn bộ vế *"5 triệu hàng ≈ 2,4 giây"* của sổ nợ 58 tan cùng với nó.
    Cơ chế: PostgreSQL tách `A OR B` thành hai lần quét chỉ số rồi hợp bitmap, miễn CẢ HAI vế đều có
    chỉ số; vế `org_id = <GUC>` dùng cột dẫn đầu của khoá chính, vế `window_start < mốc` cần đúng
    chỉ số đã bị gỡ. Gỡ nó đi là gỡ mất một nửa của phép hợp.

    **Không có gì khác được thêm vào, và đó là một quyết định.** Đường thoát đã ghi ở ADR-025 §3
    (một bộ dọn GẮN TỔ CHỨC cho các tổ chức đã thấy, cộng câu trần cho phần còn lại) KHÔNG được cài
    đặt: nó phức tạp hơn, chỉ phủ được một phần, và — quan trọng nhất — nó giải một bài toán không
    tồn tại. Nhịp dọn 5 phút cũng giữ nguyên: ở 1,07 ms mỗi lượt, không có gì để tối ưu.

    **Bài học, đắt hơn bản vá:** một phép đo ở MỘT chế độ không phải một kết luận cho MỌI chế độ. Lần
    này chính lớp *"đo trước khi tin"* của dự án lại là thứ sinh ra lời khai sai — vì con số thật đi
    kèm làm cho kết luận rộng quá phạm vi trông như đã được kiểm chứng. Bốn chỗ mang lời khai ấy đã
    được gạch TẠI CHỖ, giữ nguyên văn: `044`, ADR-025 (§1 và §3), `evidence/security-reviews.md`
    §S1.15 dòng H7-3, và chính dòng 58 của sổ nợ.

    **Lượt review an ninh thứ tám:** 0 CRITICAL, 0 HIGH, 0 MEDIUM, **1 LOW**
    (`evidence/security-reviews.md` §S1.16). Bề mặt của vòng là MỘT câu `CREATE INDEX`, nên bảng
    ngắn là kết quả chứ không phải một lượt review qua loa: bốn câu hỏi đối kháng được hỏi và trả
    lời (oracle của tính DUY NHẤT — chỉ số này không duy nhất nên không sinh lỗi nào; kênh thời gian
    — đường duy nhất người gọi đo được độ trễ là `ON CONFLICT`, đi qua khoá chính; thứ tự áp vế RLS
    — `window_start <` là phép so sánh **leakproof** nên đẩy xuống index condition không đưa hàng
    nào ra ngoài vế RLS; và `046` gãy ỒN ÀO trên cụm đã có chỉ số trùng tên, đó là hành vi đúng).
    LOW đóng bằng test: khẳng định `BitmapOr` ghim HÌNH DẠNG NÚT chứ không phải tính chất — đúng lớp
    lỗi vòng này vừa sửa ở H7-3 — nên nó bị bỏ, giữ lại hai vế nói đúng tính chất.

    Một chốt chống rỗng ruột trong chính test mới suýt tự làm mù mình: `rows=2000` là TIỀN TỐ của
    `rows=200000`, nên khẳng định "khớp đúng 1%" sẽ xanh nhờ chính con số nó phải phân biệt với.

    **Sổ nợ mở còn:** 23 và nửa sau của 30 (từ S0). **Không mở nợ mới.**

    **MỘT CA ĐỎ NỮA ĐƯỢC ĐO, và lần này KHÔNG mất danh tính** (vòng trước mất một ca vì phép lọc
    đầu ra — xem mục 30). Lượt `pnpm evidence` song song đỏ `composition.int.test.ts:300`:
    `expected '2' to be '0'` — đúng HAI backend, tức đúng hai pool của tiến trình, ở khoảnh khắc
    ngay sau `dung()`. Cùng họ với khoản nợ 24/28: `pool.end()` trả về khi client đã được YÊU CẦU
    đóng, backend phía Postgres thoát sau đó vài mili-giây, nên bản cũ đo *"đã đóng nhưng chưa
    thoát"* rồi gọi nó là rò rỉ. Tải song song của chính vòng này (một tệp test mới chèn 200 000
    hàng) làm cửa sổ ấy rộng ra. Bản vá không nới một ngưỡng nào — nó đổi CÁCH ĐO, từ một lần đếm
    tức thì sang một VÒNG CHỜ có hạn, dùng đúng con số 3 giây đã có lập luận ở
    `packages/test-support/src/postgres.ts` (nhỏ hơn `idleTimeoutMillis` 10 giây của `pg`, nên nó
    vẫn phân biệt được "chưa thoát" với một pool bị bỏ quên).

    **Số đo trên HEAD:** `pnpm t0` 179 module / 0 vi phạm; `pnpm test` 554/554; `pnpm test:int`
    **725/725**; `pnpm evidence` **51/51**, **1279 khẳng định**, cổng XANH, vitest thoát mã 0.

32. **[2026-09-07] S1.17 — KHOẢN NỢ 11 ĐÓNG: artefact neo ngoài tồn tại, và nó là BỐN thứ chứ không
    phải một (ADR-026).** Sổ nợ 11 ra đời từ bàn giao Task 5 của S0 và nó chưa bao giờ là một câu hỏi
    nhỏ: `verifyAuditChain` có một mệnh đề *nếu và chỉ nếu* — trước một **chủ sở hữu bảng
    không-superuser**, chuỗi hash KHÔNG có neo ngoài *"chứng minh về cơ bản là KHÔNG GÌ CẢ"*, vì tác
    nhân ấy sửa một hàng rồi tính lại đuôi bằng chính hàm băm thật. Cơ chế cho mệnh đề ấy đã có từ
    S0; artefact thì chưa, và `writer.ts` liệt kê đúng năm thứ thiếu: *không exporter, không lịch,
    không nơi cất, không chữ ký, không entry point*. Hệ quả đo được, cũng do chính dự án viết:

    > "Người gọi vẫn tự tay đúc được một neo giả (`{ ...xuat, source: "bịa" }`) — không lớp kiểu nào
    > chặn được điều đó, và nói ngược lại là nói quá."

    **Bốn thứ vòng này giao:** một **văn bản chính tắc** (`anchor-text.ts`, cùng khuôn
    `buildReceiptText`); một **chữ ký** ECDSA P-256 dạng DER, với **vòng khoá RIÊNG** khác vòng khoá
    ký biên nhận (ba lý do ở ADR-026 §1, tóm tắt: khoá ký biên nhận sống trong chính tiến trình mà
    mốc neo sinh ra để ràng buộc); một **nơi cất CHỈ-GHI-THÊM** (`anchor-store.ts`); và một **entry
    point** (`pnpm neo`, ba lệnh `khoi-tao`/`xuat`/`kiem`). Thứ thứ năm — **cái LỊCH** — không giao,
    và nó không thiếu vì quên: một cái lịch là một tiến trình ở một nơi đã triển khai.

    **Phép đo quan trọng nhất của vòng, và nó có ĐỐI CHỨNG** — sổ thật, nơi cất thật: sổ 6 hàng →
    xuất neo seq 6 → cắt đuôi còn 3 và xoá mốc neo trong DB → bộ xuất chạy lại → neo seq 3.

    | Vế | Nơi cất giữ gì | Kết luận kiểm toán |
    |---|---|---|
    | A — chỉ-ghi-thêm | neo seq **6** và neo seq **3** | `ok=false`, `ANCHOR_MISSING` tại seq 6 |
    | B — **đối chứng**, nơi cất GHI ĐÈ | chỉ neo seq **3** | `ok=true`, `problems: []` — **sạch trên một sổ đã bị cắt mất một nửa** |

    Vế B là thứ làm cho vế A có nghĩa, và nó nói ra điều dễ đọc nhầm nhất của vòng: **chữ ký và tính
    chỉ-ghi-thêm chặn HAI thứ khác nhau.** Chữ ký chặn BỊA THÊM; chỉ-ghi-thêm chặn BỎ BỚT — kẻ ghi đè
    được nơi cất không cần giả mạo gì cả, họ chỉ cần giữ lại mốc neo cũ.

    **`source` thôi là chữ của người gọi.** `ExternalAnchor` chuyển sang `anchor-verify.ts` và chỉ đúc
    được sau khi chữ ký ĐẠT. Ranh giới KHẢ NĂNG đi kèm là họ quy tắc **`g11-`**: `anchor-sign.ts`
    KHÔNG có ở `index.ts`, vì tiến trình `api` import `packages/audit` ở mọi đường ghi.

    **LƯỢT REVIEW AN NINH THỨ CHÍN: 0 CRITICAL, 1 HIGH, 3 MEDIUM, 6 LOW** — bảng đầy đủ ở
    `evidence/security-reviews.md` §S1.17. Đây là lượt review **năng suất nhất từ S1.10**, và ba phát
    hiện đáng đọc kể cả khi không ai đụng lại mã này:

    - **H9-1 (HIGH) — một lỗ FAIL-OPEN mà chính bản vá của vòng tạo ra.** `append` gọi
      `mkdir(recursive)`, nên một lần XOÁ nơi cất không phải là *mất mốc neo* mà là **RESET về "chưa
      từng neo"**: lượt xuất theo lịch kế tiếp lấp đầy lại bằng mốc neo của cái sổ đã bị cắt, và
      `kiem` trả `ok=true`, mã thoát 0. Cùng kết cục với "Vế B" ở trên, **đạt tới bằng XOÁ chứ không
      cần một nơi cất ghi đè** — tức lớp mà vòng này tự hào nhất bị đi vòng qua bằng một lệnh `rm`.
      Nó cũng bác một lời khai của chính vòng (*"không dòng mã nào ở đây đổi được điều đó"*): mã
      không ngăn được việc xoá, nhưng mã ngăn được việc **âm thầm coi một nơi cất vừa biến mất là
      một nơi cất mới tinh** — và bản đầu cố ý làm điều ngược lại. Đóng bằng hai lớp: nơi cất vắng
      mặt thì NÉM (dựng nó là lệnh tường minh `pnpm neo khoi-tao`), và `xuat` TỪ CHỐI một mốc neo có
      `seq` LÙI so với mốc cao nhất đã kiểm được — `audit_events.seq` chỉ đi lên.
    - **H9-2 (MEDIUM) — "dấu đúc" không mua được thứ nó tự nhận.** Nó là thuộc tính own *enumerable*
      khoá bằng symbol, mà spread **chép** own enumerable symbol keys: `{ ...neo, seq: 3 }` typecheck
      SẠCH, giữ nguyên dấu đúc, không cần một `as` nào. Tức đường lọt không phải một nỗ lực có chủ
      đích như tài liệu mô tả — nó là **một dòng refactor bình thường**, đúng thứ *"lọt vào một cách
      TÌNH CỜ"* mà lớp ấy sinh ra để chặn. Đóng bằng `WeakSet`: tư cách thành viên gắn với CHÍNH THAM
      CHIẾU. Đột biến giết **4/5** ca sao chép; `structuredClone` sống sót vì nó vốn bỏ khoá symbol,
      và điều đó ghi thẳng vào test thay vì để người sau đoán.
    - **H9-4 (MEDIUM) — và nó bắt được một lớp canh RỖNG RUỘT trong chính bản vá của nó.** `g11-` là
      họ quy tắc duy nhất không có probe. Bốn probe được thêm; probe đầu tiên đặt ở
      `apps/tmp-probe-*` **xanh vì một lý do sai**: thư mục ấy không có `package.json` nên specifier
      subpath không resolve được, `to.path` không khớp gì cả, quy tắc IM LẶNG, và thứ kêu là lưới đỡ
      `g1-khong-import-trustprocure-khong-resolve-duoc`. Đó đúng là lỗ **C1** mà
      `.dependency-cruiser.cjs` đặt tên từ S0 — lần này hiện ra trong một PHÉP ĐO chứ không trong mã
      sản phẩm.

    **MỘT KHÁC BIỆT VỚI TÁM LƯỢT REVIEW TRƯỚC, và nó làm mất một phần truy nguyên:** lượt này chạy
    trên **cây làm việc chưa commit**, nên trạng thái trước sửa **không có tên và không dựng lại
    được**. Đổi lại, mọi phát hiện đóng TRƯỚC khi lịch sử ghi lại một trạng thái có lỗ. Hai vế ấy
    không thay thế nhau, và vế mất là vế thật. **Bài học cho vòng sau: commit trước, review sau.**

    Ba commit của vòng, và mỗi commit đóng một phần của lượt review: `0985ada` (gói `audit`),
    `236a7ba` (công cụ), `ac118a6` (bốn probe `g11-`).

    **Sổ nợ mở còn: 23 và nửa sau của 30 — và cả hai đều KHÔNG phải việc của mã nguồn.** Nợ 23 cần
    một máy Android thật. Nửa sau của 30 từng được viết chung với nợ 11, nhưng chúng khác đối tượng:
    11 nói về artefact neo cho SỔ (đóng rồi), 30 nói về artefact neo cho **KHOÁ CÔNG KHAI** — kiểm
    toán viên phải lấy được vòng khoá qua một đường KHÁC đường lấy artefact, nếu không thì kẻ chiếm
    được cả hai phục vụ một cặp khớp nhau. Không dòng mã nào sinh ra được thứ đó. **Không mở nợ mới.**

    **Ba thứ ADR-026 §5 khai là KHÔNG đóng, ghi ở đây để không ai đọc gộp:** cái LỊCH; tính ĐỘC LẬP
    của nơi cất (S3 Object Lock ở một tài khoản AWS role deploy không với tới — cộng một ca còn hở đã
    đặt tên: xoá đúng MỘT tệp `<org>.jsonl` mà giữ thư mục thì lớp "từ chối lùi" mất mốc so sánh); và
    CÔNG THỨC kiểm bằng `openssl(1)` — định dạng đã đo là OpenSSL kiểm được, công thức tách nó ra
    khỏi JSONL thì chưa ai chạy.

    **Số đo trên HEAD:** `pnpm t0` **193 module / 756 phụ thuộc / 0 vi phạm**; `pnpm test`
    **628/628**; `pnpm test:int` **733/733**; `pnpm evidence` **51/51**, **1361 khẳng định**, cổng
    XANH, vitest thoát mã 0. **Mười đột biến của vòng, tất cả ĐỎ THẬT** — năm cho lớp gốc (chế độ mở
    tệp `"a"`→`"w"`; phép kiểm dấu đúc; dấu đúc ở tầng kiểu ⇒ `tsc` đỏ với *Unused
    `@ts-expect-error`*; đối chiếu dạng chính tắc; `index.ts` re-export bộ ký ⇒ depcruise đỏ) và năm
    cho vòng sửa (nơi cất tự dựng lại; từ chối lùi; dấu đúc lần hai 4/5; tự kiểm cặp khoá; chốt loại
    khoá 3/3).

    **Hai lỗi thật bị bắt trong lúc làm, cả hai cùng một họ với những lần trước:** ⑴ một ca thử
    *"orgId viết HOA"* dùng UUID toàn CHỮ SỐ, nên `toUpperCase()` là phép đồng nhất và ca ấy thật ra
    là ca HỢP LỆ — cùng lớp lỗi với `rows=2000` là tiền tố của `rows=200000` ở S1.16; ⑵ entry point
    ném `ERR_UNSUPPORTED_ESM_URL_SCHEME` ngay lượt chạy đầu vì `--import` không nhận một đường dẫn
    Windows tuyệt đối (`D:\...` bị đọc thành scheme `d:`) — chỉ bắt được vì test `spawn` một tiến
    trình THẬT thay vì gọi một hàm, đúng bài học của khoản nợ 23.

33. **[2026-09-07] S1.18 — HAI KHOẢN NỢ 9 VÀ 17 ĐÓNG, và vòng này đáng đọc vì thứ nó tìm ra khi
    đóng chúng chứ không vì hai khoản nợ (ADR-027).** Bốn gói của S0 — `audit`, `db`, `tenancy`,
    `test-support` — chưa bao giờ có họ quy tắc biên giới và chưa bao giờ có danh sách trắng
    barrel. Hai trong bốn là **hai mặt tiền chịu lực nhất kho**: `tenancy/src/with-tenant.ts` là
    điểm DUY NHẤT gắn GUC `app.org_id` (mọi policy RLS của `002`–`007` đọc GUC đó) và
    `audit/src/writer.ts` là đường ghi sổ kiểm toán. Nay có `g12-`…`g15-` (số họ quy tắc biên giới
    **5 → 9**), bốn danh sách trắng, và một bất biến mới **[INV-H18]** — sổ đăng ký **51 → 52**.

    **HAI DANH SÁCH MIỄN TRỪ VỀ RỖNG, và cơ chế đóng chúng là thứ đáng chép lại:** lớp [INV-H16]
    dựng ở S1.2 tự làm bốn dòng miễn trừ của mình **HẾT HẠN TỰ ĐỘNG** — thêm quy tắc xong thì khẳng
    định *"miễn trừ không chứa gói đã có quy tắc"* đỏ ngay, tức việc dọn danh sách bị ÉP xảy ra thay
    vì trông chờ ai nhớ. Đó là hình dạng mà một khoản nợ nên có.

    **PHÉP ĐO BÁC BỎ CHÍNH LÝ DO MIỄN TRỪ.** `MIEN_TRU` khai lý do là *"đóng chúng là một thay đổi
    có rủi ro hồi quy riêng"*. Quét toàn kho: **0 chỗ import phải di trú**; `pnpm depcruise` sau khi
    thêm bốn họ vẫn *"no dependency violations found"*. Rủi ro ấy, khi đem đo, **bằng KHÔNG** — và
    nó đã đứng mười bảy vòng. Bài học không phải *"lý do ấy dối"*; nó là: **một lý do miễn trừ cũng
    là một khẳng định, và khẳng định thì phải đo.**

    **LƯỢT REVIEW AN NINH THỨ MƯỜI: 0 CRITICAL, 1 HIGH, 3 MEDIUM, 6 LOW** — bảng đầy đủ ở
    `evidence/security-reviews.md` §S1.18. Lượt này chạy trên **một commit có tên** (`b47ecc1`),
    đúng bài học mục 32. Ba phát hiện đáng đọc kể cả khi không ai đụng lại mã này:

    - **H10-1 (HIGH) — vòng sinh ra để xoá khuôn danh-sách-tên đã TỰ VIẾT LẠI khuôn ấy.** Cả
      [INV-H16] lẫn [INV-H18] tự nhận *"suy từ TÍNH CHẤT"*, nhưng vị từ *"gói"* của chúng là *thư
      mục con của `packages/` **có `src/index.ts`***. Đó là một **quy ước đặt tên**, không phải một
      định nghĩa. `packages/kms/package.json` khai `"exports": { ".": "./src/main.ts" }` mà không có
      `src/index.ts` thì gói ấy rơi khỏi CẢ HAI lớp, và **hai khẳng định *"danh sách miễn RỖNG"* vẫn
      XANH** — vì miễn trừ đúng là rỗng thật. Tức nợ 9 và 17 mở lại **trong im lặng, ngay sau vòng
      tuyên bố đóng chúng**. Vị từ đúng (`package.json`) nay ở `tests/architecture/goi-workspace.ts`
      và dùng CHUNG cho cả hai bất biến. *"Suy từ tính chất"* chỉ đúng khi **tính chất được chọn
      đúng miền.**
    - **H10-4 (MEDIUM) — một cổng đã RỖNG RUỘT từ S0, sống qua CHÍN lượt review.**
      `khong-phu-thuoc-devdep-trong-src` không bao giờ bắn được: `options.exclude` chứa
      `node_modules`, mà `exclude` **gỡ hẳn** module khỏi đồ thị (khác `doNotFollow`, chỉ ngừng
      duyệt tiếp), trong khi `npm-dev` chỉ được gán cho cạnh resolve VÀO node_modules. Đếm trên toàn
      đồ thị: 264 `import`, 231 `local`, 94 `aliased`, 83 `core` — và **KHÔNG một cạnh nào mang
      `npm-dev`**. Nó sống lâu vì thứ duy nhất ai cũng nhìn là dòng *"no dependency violations
      found"*: **một quy tắc XANH trông giống hệt một quy tắc đang làm việc.** Lớp bắt được nó không
      phải một con mắt tinh hơn mà là **một câu hỏi khác** — không phải *"có vi phạm không"* mà
      *"quy tắc này có ĐỐI TƯỢNG nào để phán xét không"*, và câu hỏi ấy nay là một test đọc đồ thị
      JSON. Giá của việc sửa: 194 → **197 module**, 758 → **822 phụ thuộc**.
    - **H10-2 (MEDIUM) — trần *"tối đa hai cửa"* là một khoản CẤP KHÔNG.** `coQuyTacBienGioi` đòi
      `to.pathNot` *chứa* `index.ts` và `length <= 2` — một con số dùng chung cho mười ba gói, đặt ở
      2 để không đỏ oan trên `crypto-keys`. Hai gói tiêu thụ hợp pháp; **mười một gói còn lại được
      cấp sẵn một cửa thứ hai**, mở bằng một dòng trong file cấu hình mà không lớp nào phản đối. Nay
      so BẰNG TẬP, tập cửa đọc từ chính `exports` — mở một cửa thứ hai buộc phải là một dòng trong
      `package.json`, thứ [INV-H18] cũng nhìn thấy.

    **MỘT LỖ CÓ THẬT ĐƯỢC TÌM RA KHI DỰNG [INV-H18], và nó không phải một ca giả định:**
    `packages/sealed-envelope` khai HAI cửa từ S1.4 (`.` và `./unseal`) nhưng chỉ cửa `.` có danh
    sách trắng. Cửa `./unseal` xuất `unsealBid` — hàm MỞ phong bì giá thầu, năng lực cao nhất kho —
    và bề mặt của nó chưa từng bị khoá; `g8-` canh AI đi qua được cửa ấy, không lớp nào canh CÁI GÌ
    đi ra qua nó. Cùng hình dạng với `@trustprocure/audit/anchor-sign` (S1.17, đóng cùng vòng này),
    và **cả hai lần thứ mở một cửa công khai mới là MỘT DÒNG trong `package.json`** — thứ không quy
    tắc depcruise nào phản đối.

    **BỐN THỨ ADR-027 §5 KHAI LÀ KHÔNG ĐÓNG, ghi ở đây để không ai đọc gộp:** hai lớp khoá DANH
    SÁCH chứ không khoá HÌNH DẠNG (và `.github/CODEOWNERS` vẫn trỏ tới một team chưa tồn tại — nợ
    18); `g14-`/`g15-` rút **KHÔNG** symbol nào khỏi tầm với hôm nay (`g12-` rút một —
    `antoanChoBaoCao`; `g13-` rút một — `migrationChecksum`), thứ chúng mua là mặc định đóng cho
    module tương lai; vector **subpath** không phải thứ bốn họ mới đóng (ba gói kia khai `exports`
    chỉ có `"."`, nên thứ bắn là lưới đỡ `g1-khong-import-trustprocure-khong-resolve-duoc`); và
    [INV-H18] **tạo ra một ngoại lệ** cho doctrine *"một tiến trình, một khả năng"* — nó nạp cả ba
    cửa hạn chế trong cùng một worker vitest, và việc *"không module nào làm gì lúc nạp"* được kiểm
    **bằng cách ĐỌC**, chưa phải một phép đo lúc chạy.

    **Số đo trên HEAD:** `pnpm t0` **197 module / 822 phụ thuộc / 0 vi phạm**; `pnpm test`
    **656/656**; `pnpm test:int` **733/733**; `pnpm evidence` **52/52**, cổng XANH. **Mười lăm đột
    biến của vòng, tất cả ĐỎ THẬT** — tám cho lớp gốc (8 probe trước khi có quy tắc; `g14-` hạ
    severity; `g12-` một cửa ⇒ công cụ THẬT vi phạm; ba đột biến danh sách trắng; bốn đột biến
    [INV-H18]) và bảy cho vòng sửa (`packages/kms` ⇒ H16 và H18 cùng đỏ; thư mục không có
    `package.json`; cửa thứ hai không qua `package.json`; `main` lệch `exports`; symbol mọc ở cửa
    `./unseal`; `node_modules` về `exclude` ⇒ test chống-rỗng-ruột đỏ **trong khi depcruise vẫn
    xanh**; gỡ miễn trừ `test-support` ⇒ 2 vi phạm thật).

    **MỘT KHIẾM KHUYẾT QUY TRÌNH CỦA CHÍNH VÒNG NÀY, ghi ra vì giấu nó thì rẻ hơn nhiều:** lượt
    `pnpm test:int` ĐẦU TIÊN của vòng cho **732/733, một tệp đỏ** — và tôi **không ghi lại được tệp
    nào**, vì lượt ấy chạy mà không lưu output. Hai lượt sau: 733/733, mã thoát 0. Ba lượt trên cùng
    một cây mã, cùng một máy. Con số ghi ở trên là con số của lượt CÓ output; vế thành thật là:
    **một lượt đỏ đã xảy ra và nó không truy nguyên được**, đúng cùng lớp mất-truy-nguyên mà mục 32
    đã ghi cho lượt review S1.17. Khoản nợ **24** (bất ổn định của tầng T3, đã đo 0/14 đỏ ngày
    2026-09-05) là nơi ca này thuộc về, và nó **không được coi là đã đóng**. Quy ước rút ra, cùng họ
    với *"commit trước, review sau"*: **lượt đo dài thì ghi ra tệp trước, đọc sau.**

    **Sổ nợ mở còn: 23 và nửa sau của 30 — không đổi, và cả hai vẫn KHÔNG phải việc của mã nguồn.**
    Ba khoản có hình dạng mã nguồn còn lại đã có đường đóng viết sẵn: ADR-026 §5⑶ (lệnh `trich` +
    một test int chạy `openssl(1)` thật), nợ **3** + **16** (hardening tự làm mù mình bằng danh sách
    tên — đã đo lại: `hardening.always.sql:906` vẫn là một phép **ĐẾM**, nên thêm một cột
    `payload_plaintext` vào `audit_events` đi qua hardening mà không mục nào chạm), và một lượt rà
    lại sổ nợ S0 (ít nhất mục 7 đã thiu: *"apps/ rỗng"* sai từ S1.10). **Không mở nợ mới.**

34. **[2026-09-07] S1.19 — ADR-026 §5⑶ ĐÓNG: công thức `openssl(1)` đã được CHẠY, và vòng này để
    lại một bài học về chính cách viết mốc chết.** Lượt review thứ chín (H9-9) từng hạ một câu ở
    bốn chỗ: *"kiểm toán viên kiểm được artefact này mà không cần một dòng mã nào của chúng ta"*.
    Thứ đã đo khi ấy là chữ ký kiểm được bằng `createVerify` của `node:crypto`; thứ CHƯA đo là
    **ba thao tác ở giữa** — tách `text` khỏi dòng JSONL (chuỗi mang `\n` ở dạng escape),
    `base64 -d` cho `sig`, và đổi SPKI DER sang PEM. `pnpm neo trich --org <uuid> --ra <thư-mục>
    [--seq <n>]` là ba thao tác ấy, và `cong-cu.int.test.ts` chạy `openssl dgst -sha256 -verify`
    THẬT trên đầu ra: **Verified OK**, cộng **ba đối chứng âm** (sửa một ký tự `chain_hash`, lật
    một byte cuối chữ ký, khoá công khai lạ).

    **GIỚI HẠN PHẢI ĐỌC CÙNG, vì đây là chỗ dễ đọc rộng nhất:** `node:crypto` gọi OpenSSL bên
    dưới, nên đây **KHÔNG** phải hai cài đặt mật mã độc lập. Thứ mới là **CÔNG THỨC** — một chuỗi
    thao tác của con người, chạy trên đúng những tệp một kiểm toán viên sẽ có trong tay, bằng một
    chương trình KHÁC tiến trình đã tạo ra chúng. Và câu *"không cần một dòng mã nào của chúng
    ta"* vẫn **CHƯA** đúng: `trich` là mã của chúng ta.

    **LƯỢT REVIEW AN NINH THỨ MƯỜI MỘT: 0 CRITICAL, 2 HIGH, 5 MEDIUM, 6 LOW** — bảng đầy đủ ở
    `evidence/security-reviews.md` §S1.19. Lượt này chạy trên một commit có tên (`2cc36bb`). Bốn
    phát hiện đáng đọc kể cả khi không ai đụng lại mã này:

    - **H11-1 (HIGH) — byte đi vào artefact đến từ lượt đọc THỨ HAI, chưa qua kiểm chữ ký.**
      `trich` gọi `loadVerifiedAnchors` (fail-closed) rồi `readAllRaw` LẦN NỮA, và ghép hai kết
      quả theo CHỈ SỐ; lớp canh duy nhất giữa hai lượt là phép so **ĐỘ DÀI**. Một nơi cất bị thay
      nội dung mà GIỮ NGUYÊN SỐ DÒNG đi lọt, và công cụ in *"Kết quả mong đợi: Verified OK"* cho
      một artefact mà OpenSSL sẽ từ chối — bằng đúng câu của một vụ giả mạo. Đóng bằng một lượt
      `verifyAnchorRecord` trên ĐÚNG đối tượng sắp ghi. **Vế này KHÔNG có mốc chết** — đột biến
      gỡ nó đi thì cả 16 test vẫn XANH — và điều đó được ghi ra ở ba nơi thay vì để người sau tự
      phát hiện.
    - **H11-2 (HIGH) — ba tệp ghi bằng `flag` mặc định, tức ĐI THEO SYMLINK.** Kẻ tấn công cục bộ
      biết `--ra` và `<uuid>` (dữ liệu công khai, nằm trong tên tệp nơi cất và mọi dòng stdout của
      `xuat`) đặt trước một symlink trỏ tới một tệp người vận hành ghi được. Kho **đã có** chuẩn
      ngược lại từ [review H3-3] (`hop-thu-dev.ts`: `mode: 0o600`, `flag: "wx"`) và `trich` không
      theo. Đóng bằng đúng khuôn ấy.
    - **H11-4 (MEDIUM) — MỘT MỐC CHẾT CŨNG CẦN MỘT PHÉP ĐO, và đây là ca dạy điều đó.** Reviewer
      chỉ ra rằng quyết định *"PEM là bản chép ĐÚNG BYTE"* không có mốc chết. Tôi viết một mốc
      chết; **nó SỐNG SÓT đột biến** — vì với một SPKI hợp lệ, `pemTuSpkiDer` và
      `createPublicKey(...).export(...)` cho ra CÙNG một chuỗi base64. Phải viết lại lần hai trên
      đúng đầu vào làm hai đường khác nhau: một SPKI 91 byte cộng một byte rác, thứ mà **cả
      `createPublicKey` lẫn `openssl pkey` đều NHẬN**. Bài học: **chạy đột biến NGAY sau khi viết
      mốc chết** — cùng câu `bien-gioi-goi.test.ts` đã viết cho quy tắc depcruise, nay áp cho
      chính test.
    - **H11-5 (MEDIUM) — thông điệp của `trich` từng là một lời khuyên đi đúng bước RỬA.**
      `readAllRaw` trả `[]` cho ENOENT nên nó không phân biệt *"chưa từng neo"* với *"tệp
      `<org>.jsonl` vừa bị XOÁ"*; bản đầu biến sự im lặng ấy thành *"chạy `pnpm neo xuat` trước"*
      — đúng thao tác làm `mocNuocCao` bằng 0 và rửa một vụ cắt đuôi thành gốc tin cậy mới (ca hở
      ADR-026 §5⑵). Thông điệp nay nêu CẢ HAI khả năng; **ca hở gốc không đóng**, nó cần một
      trạng thái nằm NGOÀI nơi cất.

    **MỘT PHÉP ĐO CỦA VÒNG BÁC MỘT NỬA LẬP LUẬN CỦA CHÍNH NÓ.** Bản đầu biện minh cho việc dựng
    PEM bằng bọc base64 bằng câu *"Node lặng lẽ sửa, còn kiểm toán viên chạy `openssl pkey` thì
    gãy"*. Đo: `createPublicKey` **nhận** và chuẩn hoá; `openssl pkey -pubin -inform DER` **cũng
    nhận**, mã thoát 0. Vế *"kiểm toán viên thì gãy"* **không được chứng minh**. Thứ lựa chọn ấy
    thật sự mua chỉ chừng này: PEM đi ra là bản chép đúng byte của thứ nơi cất đang giữ.

    **`antoanChoBaoCao` RA CỬA CÔNG KHAI của `packages/audit`** (H11-9), vì công cụ cần ĐÚNG bộ
    khử độc ấy cho những giá trị người vận hành gõ vào; đường còn lại là chép nó sang công cụ, và
    một bản chép của một hàm an ninh là thứ dự án đã đặt tên nhiều lần. [INV-H18] của S1.18 buộc
    symbol mới ấy vào danh sách trắng trong cùng lượt — lớp canh dựng vòng trước làm việc ngay
    vòng sau.

    **PHẠM VI CHẠY, nói ra vì nó là một khoảng chênh thật:** toàn bộ khối openssl là
    `*.int.test.ts`, nên trong CI nó **chỉ chạy ở T3 (`ubuntu-latest`)**. Mối lo CRLF vốn là mối
    lo của Windows với `core.autocrlf=true`, và nó **không bao giờ được đo trên Windows trong CI**.

    **Số đo trên HEAD:** `pnpm t0` **197 module / 823 phụ thuộc / 0 vi phạm**; `pnpm test`
    **656/656**; `pnpm test:int` **742/742** (mã thoát 0); `pnpm evidence` **52/52**, **1398 khẳng
    định**, cổng độ phủ XANH. **Sáu đột biến của vòng sửa, năm ĐỎ THẬT và MỘT SỐNG SÓT** — sống
    sót là vế H11-1, và nó được ghi ra thay vì giấu.

    **BA LƯỢT ĐỎ KHÔNG TÁI LẬP TRONG CÙNG VÒNG, ghi ra vì con số ở trên là con số của lượt XANH:**
    ⑴ lượt `pnpm test:int` ĐẦU TIÊN cho **741/742** — `[fix round 5 — M10] unlock bị từ chối quyền
    khi kết nối còn sống` (`db/migrations.int.test.ts`) đỏ; lượt thứ hai 742/742, mã thoát 0.
    ⑵ và ⑶ lượt `pnpm evidence` (chạy CẢ HAI tầng trong một tiến trình) có **hai** test đỏ:
    `boundaries.test.ts > mã nguồn hiện tại không vi phạm quy tắc nào`, và
    `composition.int.test.ts > … pool KIỂM TOÁN của composition` (*SyntaxError: Unexpected end of
    JSON input*). Cả hai KHÔNG đỏ khi chạy từng tầng riêng.

    **Ca ⑵ có cơ chế đã đọc ra được, và nó là một khoản nợ mới — 59.** `apps/api/src/routes.test.ts`
    viết một probe THẬT vào `apps/api/src/routes/` rồi chạy `depcruise`; `boundaries.test.ts` chạy
    `pnpm run depcruise` trên TOÀN kho. Hai tệp khác nhau ⇒ vitest chạy song song ⇒ lượt quét toàn
    kho nhìn thấy probe của tệp kia và báo vi phạm. Khẳng định *"mã nguồn hiện tại không vi phạm
    quy tắc nào"* vì thế **không hermetic**, và cửa sổ ấy rộng thêm sau S1.18 (13 probe mới). Nó
    không phải fail-open — nó là đỏ GIẢ — nhưng một cổng đỏ ngẫu nhiên là cổng người ta học cách
    chạy lại thay vì đọc, và đó là đường ngắn nhất tới chỗ một lượt đỏ THẬT bị bỏ qua.

    **Đây là lần thứ HAI trong hai vòng liên tiếp một lượt đo dài cho kết quả không tái lập** (S1.18
    mục 33 ghi lượt 732/733 không truy nguyên được). Khác biệt của lần này: **mọi lượt đều được ghi
    ra tệp trước rồi mới đọc**, đúng quy ước rút ra ở mục 33 — nên lần này ba ca đỏ đều có tên, có
    tệp, có cơ chế cho một trong ba.

    **LƯỢT CI ĐẦU TIÊN CỦA VÒNG NÀY ĐỎ, VÀ NÓ TÌM RA MỘT KHIẾM KHUYẾT CÓ THẬT TRONG MỘT CỔNG AN
    NINH — không phải trong mã của vòng.** T3 đỏ ở `kich-ban-41-http.int.test.ts` với
    `GET /guest/session (200): 930000000.00`, tức bộ quét rò rỉ báo rằng một GIÁ dạng rõ đi ra
    trước khi mở thầu. Nhưng route ấy trả về đúng bốn trường — `guestSessionId`, `invitationId`,
    `rfqId`, `verifiedChannel` — **không một trường giá nào**. Con số ấy do chính bộ quét tổng hợp.

    **Cơ chế, tất định và tái lập được bằng một dòng:** `rutSo` có một nhánh ký hiệu khoa học
    `/\d+(?:[.,]\d+)?[eE][+-]?\d+/` **không có biên**, nên nó khớp `98e7` **bên trong một chuỗi
    hex** — và `Number("98e7")` = **980 000 000**, đúng một giá của kịch bản. `14e8` cho
    1 400 000 000, cũng đúng một giá. Một UUID bất kỳ chứa `98e7` hay `14e8` làm cổng ấy kêu.

    **Tỷ lệ đã đo:** trên **300 000** thân giả lập của `GET /guest/session` (5 phiên, 15 UUID mỗi
    thân), bản cũ báo rò rỉ **1381 lần — 0,46%**. Với hơn bốn mươi route mỗi lượt quét và hai lượt
    quét mỗi lần chạy, một lượt CI đỏ vì lý do này là chuyện **thường gặp**, không hiếm. Sau khi
    thêm hai vế biên (chặn cả chữ-số-chữ-cái lẫn dấu `-`, vì một mảnh UUID có thể ĐÚNG BẰNG
    `98e7`): **0/300 000**.

    **Vì sao một ĐỎ GIẢ ở đây là khiếm khuyết nặng, chứ không phải một phiền toái:** đây là cổng
    canh bất biến A1/A2 — *"không một chữ số giá nào ở thân, header, hay log"*. Một cổng an ninh
    kêu sai định kỳ dạy người ta **chạy lại thay vì đọc**; ngày nó kêu ĐÚNG, phản xạ đã được huấn
    luyện sẵn là bấm *re-run*. Đó là cùng một câu `docs/TEST-PLAN.md` §5 đã viết cho hàng rào
    hỏng, và cùng lớp lý do khoản nợ 59 được mở ở trên.

    **Ba đối chứng mới, và một đối chứng dương đi kèm:** ba ca UUID chứa `98e7`/`14e8` (trong hex,
    và như một mảnh UUID trọn vẹn giữa hai gạch nối) phải SẠCH; cộng một thân `GET /guest/session`
    năm phiên mang một giá THẬT vẫn phải bị BẮT — để hai vế biên vừa thêm không làm bộ quét mất
    răng. Đột biến gỡ hai vế biên ⇒ **ĐỎ** (`98e7 trong hex: expected ['980000000.00'] to deeply
    equal []`).

    **Và một câu về quy trình:** khiếm khuyết này sống qua **mười một lượt review an ninh** và mọi
    lượt CI trước, vì nó chỉ hiện ra khi một UUID ngẫu nhiên rơi trúng. Nó không được tìm ra bằng
    cách đọc mã — nó được tìm ra vì **CI chạy trên dữ liệu khác máy phát triển**. Đây là lần thứ
    hai trong ba vòng liên tiếp thứ đắt nhất đến từ một phép đo chứ không từ một lượt đọc.

    **Sổ nợ mở còn: 23, nửa sau của 30, 24 — và MỘT KHOẢN MỚI, 59** (khẳng định *"mã nguồn hiện
    tại không vi phạm quy tắc nào"* không hermetic; xem đoạn trên). Vòng này **CÓ mở nợ mới**, và
    nó mở vì một lượt đo chỉ ra cơ chế chứ không vì một linh cảm. Hai khoản có hình dạng mã nguồn
    còn lại từ trước: nợ **3** + **16** (hardening tự làm mù mình bằng danh sách tên), và một lượt
    rà lại sổ nợ S0.

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
| `docs/DECISIONS.md` | ~~**Mười hai ADR**~~ ~~**Mười lăm ADR**~~ ~~**Mười tám ADR**~~ ~~**Mười chín ADR**~~ ~~**Hai mươi ADR**~~ ~~**HAI MƯƠI LĂM ADR**~~ ~~**HAI MƯƠI SÁU ADR**~~ **HAI MƯƠI BẢY ADR** (**026** artefact neo ngoài, **027** biên giới module là một tính chất) — dòng này đã thiu qua bốn vòng (021–024 ra đời mà con số không đổi; [S1.15] đối chiếu và sửa): 001–010 và 012–019 *Đã chấp nhận*; **021** (vai ứng dụng là thành viên), **022** (`/auth/link` chỉ xếp hàng), **023** (việc SAU COMMIT của runner), **024** (bộ đếm người gọi ngoài cây tenant), **025** (bảng tenant dọn được mà không đọc được) *Đã chấp nhận*; **020** (tầng HTTP của `apps/api`) *Đã chấp nhận* 2026-09-06, mở S1.10; ~~**011** (định dạng phong bì + chữ ký biên nhận) ***Đang mở***, chặn S1.4/S1.5 và **chỉ được chốt sau khi đo Zalo/Android** (khoản nợ 23).~~ **011 chốt 2026-09-04 cho mục 1** (P-256 mặc định, X25519 cơ hội); mục 2 (thuật toán chữ ký biên nhận) và mục 3 (xoay khoá ký) còn mở nhưng **không chặn S1.4**. **019** nơi cặp khoá RFQ ra đời (S1.4). **013** phạm vi sổ NCC (S1.1), **014** nơi cưỡng chế máy trạng thái RFQ (S1.2), **015** kênh OTP + nền giới hạn tần suất (S1.3). **016** cổng quyền ở tầng ứng dụng + danh tính là dẫn xuất, **017** chính sách tính `requires_dual_approval`, **018** pepper cho băm đích — ba ADR của ba MEDIUM mà vòng sửa an ninh cố ý không đóng bằng mã |
| `docs/TEST-PLAN.md` | ~~**Sổ đăng ký 47 bất biến** (34 nghiệp vụ + 13 hàng rào)~~ ~~**Sổ đăng ký 49 bất biến** (34 nghiệp vụ + **15** hàng rào; H14/H15 thêm ở S1.1)~~ **Sổ đăng ký 51 bất biến** (34 nghiệp vụ + **17** hàng rào; H16 ở S1.2, **H17 ở S1.10.2** — mọi route ghi của `apps/api` khai mã quyền), bảy tầng kiểm thử, evidence pack |
| `evidence/INV-matrix.md` | **Ma trận bất biến** — sinh tự động, không sửa tay |
| `evidence/security-reviews.md` | **Dấu vết review an ninh** — một dòng mỗi task, commit được review, môi trường đo, phát hiện theo mức, commit đóng |
| `docs/superpowers/specs/2026-08-26-trustprocure-s0-s1-design.md` | Đặc tả thiết kế S0+S1 đã duyệt |
| `docs/superpowers/plans/2026-08-27-s0-foundation.md` | Kế hoạch triển khai S0 — 11 task, 92 bước |
| `Vibe Coding/CLAUDE.md` | Phương pháp làm việc (bản copy thủ công — xem Vấn đề đã biết 2) |
