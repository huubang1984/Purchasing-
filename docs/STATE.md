# STATE — TrustProcure V2

> Bộ nhớ trạng thái hiện tại của dự án. Đọc trước mọi việc quan trọng, đối chiếu với mã
> nguồn thật — mã, test và hành vi runtime là bằng chứng mạnh hơn tài liệu này.
> Không bao giờ ghi "đã xong / đã test / đã sửa / đã triển khai" nếu chưa thực sự kiểm chứng.

**Cập nhật lần cuối:** 2026-09-08 (**S1.22 — KHOẢN NỢ 8 ĐÓNG: QT3 có lớp máy, chủ thể suy từ nội dung câu SQL — *ghim thì phải ghim ĐỦ* (ADR-030, `[INV-H21]`); 20 câu SQL được ghim, trong đó cổng chính sách mở thầu và bộ đếm khoá OTP; review lượt 14 — bốn HIGH nói về chính lớp canh**) — mục 37; cùng ngày: **S1.21 — RÀ LẠI SỔ NỢ S0: câu tổng kết *"Sổ nợ mở còn"* SAI ở cả tám lần được viết ra — nó khai 5 khoản, bảng cho 14, phán xét lại từng dòng cho 13; bốn dòng thiu, ba khiếm khuyết hình dạng bảng, `[INV-H20]` để hai cách đếm không lệch được nữa**) — mục 36; cùng ngày: **S1.20 — HAI KHOẢN NỢ 3 VÀ 16 ĐÓNG: hardening thôi tự làm mù bằng danh sách tên (ADR-028, migration `047`, H19 vào sổ đăng ký); ba bảng chỉ-ghi-thêm của S1 TRUNCATE được — lỗ mà sổ nợ 16 không nêu**) — mục 35; cùng ngày: **S1.19 — ADR-026 §5⑶ ĐÓNG: công thức `openssl(1)` đã được CHẠY (lệnh `trich`; review lượt 11 — một mốc chết cũng cần một phép đo)** — mục 34; cùng ngày: **S1.18 — HAI KHOẢN NỢ 9 VÀ 17 ĐÓNG (ADR-027: biên giới module và bề mặt export là một TÍNH CHẤT; hai danh sách miễn trừ về RỖNG; review lượt 10 bắt một cổng đã rỗng ruột từ S0)** — mục 33; cùng ngày: **S1.17 — KHOẢN NỢ 11 ĐÓNG (ADR-026: artefact neo ngoài)** — mục 32; trước đó: **S1.16 — KHOẢN NỢ 58 ĐÓNG bằng cách BÁC BỎ tiền đề của chính nó (migration `046`)** — mục 31; cùng ngày: **S1.15 — HAI KHOẢN NỢ 56–57 ĐÓNG (ADR-025: bảng tenant dọn được mà không đọc được; danh sách loại trừ ghim về RỖNG)** — mục 30; cùng ngày: **S1.14 — HAI KHOẢN NỢ 54–55 ĐÓNG (ADR-024: bộ đếm người gọi ngoài cây tenant, danh sách ghim tự đối chiếu)** — mục 29; cùng ngày: **S1.13 — BA KHOẢN NỢ 51–53 ĐÓNG (ADR-023: việc sau commit của runner, hạn mức tổ chức + tổ chức lạ, hardening ghim thân trigger)** — mục 28; cùng ngày: **S1.12 — BẢY KHOẢN NỢ 38–43, 49 ĐÓNG cùng vòng (ADR-022, migration `038`–`040`)** — mục 27; trước đó 2026-09-06: **S1.11 — tiến trình `api` chạy thật: ADR-021, migration `037`, `main.ts`, nợ 50 mở và đóng cùng vòng** — mục 26; trước đó cùng ngày: **S1.10 ĐI HẾT BẢY HẠNG MỤC** — 10.6 kịch bản 41 qua HTTP **51/51**, 10.7 HAI lượt
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

- Thiết kế S0+S1, sáu lát cắt dọc S0–S5, ~~**chín ADR**~~ ~~**mười hai ADR**~~ ~~**mười lăm ADR**~~ ~~**mười tám ADR**~~ ~~**mười chín ADR**~~ ~~**hai mươi tám ADR**~~ ~~**hai mươi chín ADR**~~ ~~**ba mươi ADR**~~ ~~**ba mươi mốt ADR**~~ ~~**ba mươi hai ADR**~~ ~~**ba mươi ba ADR**~~ ~~**ba mươi bốn ADR**~~ ~~**ba mươi lăm ADR**~~ ~~**ba mươi sáu ADR**~~ **ba mươi bảy ADR** (ADR-011 **chốt TRỌN VẸN 2026-09-04**: mục 1 *P-256 mặc định, X25519 cơ hội*; mục 2 *`ECDSA P-256` + văn bản chính tắc*; mục 3 *xoay khoá ký có `kid`* — hết chặn S1.4 **và** S1.5; **ADR-019 cùng ngày** — nơi cặp khoá RFQ ra đời) (bảy ở giai đoạn thiết kế,
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
- ~~`apps/` **rỗng**. Không có một đường gọi sản phẩm nào tới `listOrganizations`, `start()` của
  outbox runner, hay `assertFreshMfa` — các gói đã có được test gọi, chưa có ứng dụng gọi.~~
  **[S1.21, review lượt 13 H13-5] SAI TỪ S1.10** — bản sao THỨ BA của câu ở khoản nợ 7, và nó
  nằm trong đúng tệp mà `[INV-H20]` đọc. Ba tiến trình trong `apps/`;
  `apps/api/src/composition.ts:96` tiêm `listOrganizations` thật.

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
| 3 | Rủi ro `crypto.subtle` không khả dụng trong webview Zalo/Messenger | ~~CAO~~ **TRUNG BÌNH** (rủi ro sản phẩm) | ~~**Chưa đo.**~~ ~~**Vẫn CHƯA ĐO TRÊN THIẾT BỊ THẬT**~~, nhưng nay đã có **máy dò**: `tools/do-webcrypto/index.html` chạy thật từng phép mật mã của đường nộp thầu và cho ra một trong **bốn** phán quyết. Máy dò đã được chứng minh có răng bằng ba đột biến (`?dot=x25519\|aes\|rnd` qua `phuc-vu-va-dot-bien.mjs`) — bốn phán quyết phân biệt được, đo trên Chrome 148 ngày 2026-08-29. **ĐÃ CÓ PHÉP ĐO TRÊN WEBVIEW THẬT (2026-08-29): Zalo iOS, WKWebView, iOS 18.7 — ĐẠT TOÀN BỘ, kể cả X25519.** Giả thuyết xấu nhất (*"webview Zalo không có `crypto.subtle`"*) **đã bị bác trên đường iOS**. Rủi ro ~~**hẹp lại nhưng CHƯA ĐÓNG**: phía **Android vẫn trống hoàn toàn**~~, và kết quả iOS chỉ đúng cho **iOS 18.7** — `X25519` vào WebCrypto muộn hơn nhiều so với AES-GCM nên một WebKit cũ là chỗ nó có thể vắng. Phép đo này cũng làm lộ ra rằng trục phân loại đúng là **engine**, không phải tên ứng dụng: trên iOS, Zalo và Messenger dùng **cùng một `WKWebView`**, nên một phép đo phủ cả hai. Nhật ký: `tools/do-webcrypto/ket-qua-do.md`. Xem ADR-007 và §10 của kế hoạch S1. **[2026-09-05] MỘT KHIẾM KHUYẾT CỦA CHÍNH CÔNG CỤ ĐO, tìm ra bởi lớp canh của khoản nợ 20:** `tools/do-webcrypto/phuc-vu-va-dot-bien.mjs` đọc `./do-webcrypto.html`, một tên KHÔNG CÒN TỒN TẠI (trang đã đổi thành `index.html`) — nên server đột biến ném `ENOENT` ở dòng đầu và ai cầm nó lên hôm nay sẽ không chạy được một lượt nào. Đã sửa. Điều đáng ghi không phải lỗi mà là chỗ nó trốn: `tsc` không nhìn thấy đường dẫn dạng chuỗi, và không test nào gọi tới tệp `.mjs` ấy. **[2026-09-08, S1.23] ĐÃ ĐO TRÊN ANDROID THẬT — MỨC XUỐNG TRUNG BÌNH, KHÔNG XUỐNG ĐÓNG.** Zalo và Messenger trên **Galaxy A02s / Android 12** (máy phổ thông giá rẻ): **ĐẠT toàn bộ, kể cả `X25519`**, cả hai cùng build `Chrome/151.0.7922.200`. Ba engine đã đo nay là **Chromium 151 (Android WebView)**, **WKWebView iOS 18.7** và **26.6.1** — đường nộp thầu chạy trên cả ba. **Vì sao KHÔNG xuống ĐÓNG:** máy đo có WebView **mới**, nên chế độ mà rủi ro này thật sự sợ — một **WebView tụt lại nhiều phiên bản**, hoặc **iOS ≤ 16** — vẫn không có mẫu; và phân bố phiên bản System WebView **không tra được** từ dữ liệu công bố (§3c của nhật ký đo, một kết quả ÂM). Thứ đưa mức này lên lại là **một dòng ĐỎ mới trong nhật ký đo**, không phải một suy đoán. Thứ hạ nó nốt là **mã của S1.4/S1.5**: chạy phép dò trước khi cho nộp, chuyển hướng sang trình duyệt ngoài khi phán quyết không phải *"Nộp thầu được"* — ADR-031 §3⑶ |
| 4 | Hiệu năng bọc/mở khoá `local-dev` (rủi ro §8.4 của spec) | THAM KHẢO | `pnpm bench:keys` trên máy dev, **đo lại 2026-08-29**: 10.000 lần **bọc** 447 ms (**≈22.400 thao tác/giây**), 10.000 lần **mở** 392 ms (**≈25.500 thao tác/giây**). Lần đo trước (sau fix round 1 của Task 7): 512 ms / 440 ms — cùng bậc. Đây là mốc của `local-dev` (mã hoá nội bộ, không qua mạng). ~~Tham chiếu: RFQ 50 NCC × 200 hạng mục ≈ 10.000 lần mở khoá/lượt mở thầu ⇒ dưới nửa giây CPU thuần. Adapter KMS/Vault thật (S1.6) sẽ chậm hơn **nhiều bậc** vì mỗi lần là một lời gọi mạng~~ — **hai câu vừa gạch đã được ĐO là sai** (2026-08-29, `tools/bench-kms/dem-loi-goi-kms.mjs`): 200 hạng mục nằm trong **cùng một phong bì** nên số phong bì là **50** chứ không phải 10.000; và một lượt mở thầu tốn **đúng 1 lời gọi KMS** bất kể số nhà cung cấp, vì chỉ data key của tổ chức đi qua KMS. Giữ nguyên văn để đối chiếu. **Câu "phải đo lại trước khi bắt đầu S1.6" thì vẫn đúng và vẫn còn hiệu lực** — phép đo trên là mô phỏng, chưa chạy qua `packages/crypto-keys`; xem ADR-009 |
| 5 | `[M10]` flaky tiền tồn | THẤP | ~~Ghi nhận từ vòng review trước, chưa truy nguyên~~ **QUAN SÁT LẦN THỨ HAI (2026-08-29, vòng sửa sau review an ninh), và lần này có CHỮ KÝ.** Test `[fix round 5 — M10]` ở `packages/db/src/migrate.int.test.ts:540` đỏ trong một lượt `pnpm evidence` toàn bộ, **xanh khi chạy riêng file ấy**. Khẳng định đỏ là `expect(rows[0]?.n).toBe(0)` trên `SELECT count(*) FROM pg_locks WHERE locktype='advisory'` — thu được **1**, chờ **0**. Hai khẳng định ngay trước (`poolThuong.totalCount`/`idleCount` = 0) thì QUA, tức client phía Node đã bị huỷ. **GIẢ THUYẾT, chưa kiểm chứng:** đây là cùng cơ chế mà lần chạy CI đầu tiên đã đo và ghi ở mục 2 — *`await pool.end()` chỉ bảo đảm phía CLIENT*; backend phía server chưa kịp thoát nên advisory lock của nó chưa được nhả tại đúng khoảnh khắc câu đếm chạy. Nếu giả thuyết đúng thì bản vá cùng hình dạng với bản vá T3 của S0: **chờ `pg_stat_activity` hết backend rồi mới đếm**, thay vì đếm ngay. **Điểm dữ liệu thứ hai, cùng ngày:** lượt `pnpm evidence` chạy lại NGAY SAU đó, cùng cây mã, **XANH TOÀN BỘ** — 758 test, 0 file đỏ, vitest thoát mã 0. Hai lượt liên tiếp cho hai kết quả khác nhau trên cùng một cây: đây là bằng chứng FLAKY, không phải hồi quy. **Cố ý KHÔNG sửa trong vòng này**: nó là một test tiền tồn, không thuộc phạm vi review an ninh, và sửa một flake bằng một giả thuyết chưa đo là đúng thứ dự án phạt. **[2026-09-05 — ĐÃ ĐO, xem khoản nợ 24]** 14 lượt trên máy này (1 lượt `test:int` đầy đủ, 5 lượt cặp `migrate`+`outbox`, 8 lượt tranh chấp bốn tệp cùng lúc): **0 lần đỏ, 0 lần `57P01`, 0 unhandled**. Nguồn phát ĐÃ BIẾT của `57P01` nay có phép đo riêng ở `TestDatabase.stop()` (khoản nợ 28). Vẫn CHƯA tuyên bố là hết: cùng con số ấy phải lặp lại trên phần cứng CI, và `.github/workflows/do-lap.yml` chạy lặp hằng tuần, fail-closed |

## Nợ kỹ thuật

Sổ nợ gom từ mười một task **và từ review cuối toàn nhánh**. Mỗi mục là một **khoảng trống đã
đo**, không phải một linh cảm. Mục 1–12 có từ các task; **13–19 thêm ở vòng fix cuối**;
**20–22 thêm sau LẦN CHẠY CI ĐẦU TIÊN** (run `33218397033`).

| # | Nợ | Nơi ghi chi tiết |
|---|---|---|
| 1 | **[ĐÓNG]** ~~**E3 vế *giới hạn tần suất* không có một dòng mã nào** trong toàn S0. Bốn vế còn lại có lớp và có mốc chết~~ **[S1.21] ĐÓNG — VÀ NÓ ĐÃ ĐÓNG TỪ S1.12, BỞI MỘT KHOẢN NỢ KHÁC.** Hai đường OTP, hai lớp. Đường LỜI MỜI có `otp_rate_limits` từ S1.3 (ADR-015 §5, hai hạn mức hai kiểu phản ứng) — `evidence/INV-matrix.md` §4 ghi ngay lúc ấy và THU HẸP dòng này còn *"đường TOTP vẫn không có"*, nhưng chính dòng này thì không ai sửa. Đường TOTP nay có `callerLimit: LOGIN_TOTP_MAX_PER_CALLER = 30` mỗi 15 phút trên `/auth/totp` (`apps/api/src/routes/auth.ts:166`), đếm ở `caller_rate_limits` (migration `042`). Lớp ấy ra đời để trả **khoản nợ 39**, không phải khoản nợ này, và không ai nối nó về đây — nên dòng này thiu **chín vòng** trong khi vế nó tố cáo đã có lớp. **[review lượt 13, H13-1] Và nó CHƯA được đóng cho tới vòng sửa của chính vòng này:** dòng `callerLimit` ấy không có lớp nào giữ — xoá nó thì không test nào đỏ. Hai lớp thêm vào mới làm dấu `[ĐÓNG]` đứng được: một test tích hợp đo `429 + Retry-After` trên `/auth/totp` (`apps/api/src/auth.int.test.ts`), và một phép kiểm TĨNH *mọi route ANON phải khai `callerLimit`* trong `timViPhamBangRoute` (`apps/api/src/route-types.ts`), với danh sách miễn đúng MỘT dòng có lý do đo được. Phần dư *"trần là độ đồng thời của kẻ tấn công"* thuộc khoản nợ 2, không thuộc dòng này | `apps/api/src/routes/auth.ts`; `packages/identity/src/mfa-credentials.ts` (khối đầu); `evidence/INV-matrix.md` §4 |
| 2 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-09, S1.26] — VÀ THỨ SỬA ĐƯỢC NÓ LÀ MỘT DÒNG ĐỔI CHỖ, KHÔNG PHẢI MỘT CƠ CHẾ MỚI.** Bản vá **không** thêm khoá tường minh và **không** thêm round trip nào ở đường thất bại: nó đưa CỔNG vào mệnh đề `WHERE` của một câu `UPDATE` và chuyển câu ấy lên **TRƯỚC** lời gọi cổng mở bí mật. N request chồng nhau khi ấy xếp hàng ở khoá hàng của chính câu UPDATE, được thả TUẦN TỰ, và request thứ `ngưỡng + 1` đọc được `locked_until` mà request thứ `ngưỡng` vừa đặt. Một câu tách làm hai: `CAU_DAT_COC` thu tiền trước (không `RETURNING` — trả bộ đếm ra cho JS so ngưỡng thì phép so có HAI chỗ và một trong hai không bao giờ đỏ được), `CAU_DAT_KHOA` chỉ chạy khi cổng đã phán *"mã sai"*, nên `justLocked` bắn **đúng một lần mỗi lần chuyển trạng thái** — trả nốt phát biểu tần suất của ADR-008 §(ii) mà bản cũ đang phá trong im lặng (loạt 24/ngưỡng 5 sinh **20** bản ghi `MFA_LOCKED`). **PHẦN ĐẮT NHẤT KHÔNG PHẢI BẢN VÁ MÀ LÀ ĐẠI LƯỢNG ĐƯỢC ĐO.** Phép đo cũ đếm *lý do trả về* (`WRONG_CODE`), và nó **không phân biệt được bản đã vá với chính khoản nợ này**: dời `CAU_DAT_COC` xuống sau cổng thì cả 24 request vẫn mở cổng, rồi vẫn xếp hàng, và số `WRONG_CODE` vẫn là 5 — test vẫn XANH. Đại lượng đúng là **NGÂN SÁCH CỦA KẺ TẤN CÔNG: số lần cổng mở bí mật ĐƯỢC MỞ**. Đo dưới đồng thời ép tất định 24: **5, không phải 24**. **Năm mũi đột biến, năm lượt đỏ đúng chỗ** (đối chứng 50/50 xanh trước mỗi mũi) — và mũi thứ hai đầu tiên bị **BỎ** vì nó đỏ bằng một lỗi CÚ PHÁP (`$3` thành tham số thừa), một mũi đỏ vì lý do sai không phải một mũi. **BẢN VÁ GIẾT MỘT KỸ THUẬT TEST, và đó là chi phí thật:** *"treo A trong cổng rồi cho B chạy trọn"* đứng trên tiền đề *cổng được gọi khi chưa ai giữ khoá hàng* — đo được **27/50 đỏ, TẤT CẢ bằng hết giờ**, một lỗi gốc kéo 26 lỗi dây chuyền; đã thay bằng kỹ thuật khoá-ngoài, sau đó **50/50 trong 20,6 giây** (trước: 1217 giây). **CÁI GIÁ, ghim bằng số:** kẻ thua một cuộc đua đã đặt cọc trước khi biết mình thua và cọc KHÔNG được hoàn, nên một người dùng bấm gửi hai lần tiêu mất 1 trong 5 lần thử — test khẳng định `failed_attempts === 1` ở đúng chỗ ấy. **ĐÁNH ĐỔI DoS đứng trên ba con số ĐÃ CÓ LỚP**, không trên lời hứa: `idle_in_transaction_session_timeout = 60 s` (cận CẤU TRÚC cho người GIỮ), `lock_timeout` = `statement_timeout` = 15 s (người CHỜ chết chứ không treo), `MAX_TOTP_WINDOW = 10` ⇒ ≤ 21 lần HMAC chặn TRƯỚC cổng. Trần 5 s của `boiTranKms` là cận CHẶT HƠN nhưng **có điều kiện** (phụ thuộc composition root) nên không được kể là tính chất cấu trúc. Xem ADR-034. Nguyên văn: ~~Trần loạt đầu của vế *giới hạn số lần thử* (E3) là **độ đồng thời của kẻ tấn công**, không phải hằng số cấu hình. Sau loạt đầu, hồ sơ bị khoá. **[S1.21] Đo lại: VẪN MỞ, và nay THU HẸP.** `packages/identity` không có một `FOR UPDATE` nào (0 chỗ), nên `failed_attempts` vẫn là một lượt đọc-rồi-ghi; thứ đổi là ở TRƯỚC nó nay có một trần theo người gọi (30 mỗi 15 phút cho `/auth/totp`, khoản nợ 39), tức trần loạt đầu là *độ đồng thời của kẻ tấn công CHIA cho số địa chỉ nó có* thay vì độ đồng thời trần trụi. Con trỏ cũ cũng THIU: hai cột `failed_attempts`/`locked_until` được đọc-ghi ở `mfa-credentials.ts`, `mfa.ts` không chạm tới chúng~~ | ~~`packages/identity/src/mfa.ts`~~ `packages/identity/src/mfa-credentials.ts` |
| 3 | **[ĐÓNG]** **ĐÃ ĐÓNG — CẢ HAI NỬA, VÀ KHÔNG NỬA NÀO ĐÓNG BẰNG MỘT LỚP MỚI.** ~~**Hàng rào tự làm mù mình bằng danh sách tên**, hai lỗ đã đo: `NOBYPASSRLS` chỉ ghim đúng **bốn tên role**, và một **hàm plpgsql ngoài danh sách** không được ghim~~ ⑴ Nửa *bốn tên role* **[S1.20] bị PHÉP ĐO BÁC BỎ**: BƯỚC 1 thu hồi mọi tư cách thành viên lạ, nên cây role LUÔN BẰNG tập bốn tên đã ghim (`CREATE ROLE ke_gian BYPASSRLS; GRANT app_api TO ke_gian;` → sau `migrate()` ke_gian RỜI cây). Mục canh viết cho nó đã bị GỠ theo ADR-028 §2⑷; thứ có thể trôi được canh ở `db/hardening-suy-tu-tinh-chat.int.test.ts`. ⑵ Nửa *hàm plpgsql ngoài danh sách* **đóng từ S1.14/S1.15** (nợ 54, 56 — danh sách loại trừ RỖNG), và dòng nợ này THIU bốn vòng vì không ai sửa nó | `db/hardening-suy-tu-tinh-chat.int.test.ts`, `docs/DECISIONS.md` ADR-028 §5⑶ |
| 4 | **[MỞ]** Hai GUC log nằm ở **tầng vận hành**, không ở tầng có thể cưỡng chế bằng test. **[S1.21] Đo lại: VẪN MỞ, nhưng phát biểu cũ RỘNG HƠN sự thật theo hướng bi quan.** Có hai test đứng sau chúng: `packages/db/src/pool.test.ts:95` (cấu hình pool đặt GUC qua PGOPTIONS) và `packages/db/src/pool.test.ts:57` (một `options=` trong chuỗi kết nối bị TỪ CHỐI, nên không ai ghi đè được từ biến môi trường). Thứ không lớp nào cưỡng chế được vẫn nguyên và mở BẰNG CẤU TẠO: rằng tiến trình đã triển khai thật sự nối qua `taoPool` — hardening không ghim hộ được vì chính nó phát `ALTER ROLE … RESET ALL` mỗi deploy (`pool.ts:92`). Cùng lớp với khoản nợ 19: một khoản không đóng được bằng mã trong kho này. Ghi thêm một chỗ thiu nhỏ tìm ra khi đo: `pool.ts:185` đặt BA GUC, khối *Giá trị mặc định và lý do* ở `pool.ts:99` chỉ kể HAI (`statement_timeout` của khoản nợ 38 vào sau, không ai thêm dòng) | `packages/db/src/pool.ts` |
| 5 | **[ĐÓNG]** ~~`enqueueJob` **không có oracle xuyên tổ chức và không test nào canh**~~ **[S1.21] ĐÓNG — và như nửa đầu khoản nợ 3, nó đóng bằng một lớp KHÁC lớp mà khoản nợ chỉ tên.** Vế thứ nhất vẫn ĐÚNG NGUYÊN VĂN và cố ý: `packages/outbox/src/enqueue.ts:121` nói thẳng *"không có phép kiểm nào ở đây"*. Vế thứ hai thì SAI, và sai ngay ngày nó được viết: `RLS WITH CHECK` là oracle, và test đo nó — `withTenant(apiPool, orgKhac, …) => enqueueJob(client, orgId, …)` bị từ chối `row-level security` — nằm ở `packages/outbox/src/outbox.int.test.ts:252`, trong `[INV-F1] job của tổ chức A vô hình với tổ chức B, và không ai chèn hộ ai`, và nó ra đời trong **chính commit tạo ra outbox** (`13a6e5b`, 2026-08-28) — tức trước khi dòng nợ này được viết. **[review lượt 13, H13-10] Điều kiện của bảo đảm ấy, nói ra vì `[ĐÓNG]` trần thì rộng hơn phép đo:** RLS không áp cho một phiên KHÔNG chịu RLS (superuser, hoặc role có `BYPASSRLS`) — chính `packages/outbox/src/enqueue.ts:122` ghi điều đó. Thứ giữ cho vế ấy đứng là một lớp KHÁC nữa: hardening ghim `NOBYPASSRLS` cho cây role và BƯỚC 1 thu hồi mọi thành viên lạ, nên cây role LUÔN BẰNG bốn tên đã ghim (đo ở S1.20 — xem khoản nợ 3). Ba lớp cho một khoản nợ, và không lớp nào là lớp mà khoản nợ chỉ tên. Một khoản nợ tố cáo *"không test nào canh"* trong khi test ấy đã có nhãn `[INV-F1]` và đang được ma trận đếm | `packages/outbox/src/enqueue.ts`, `packages/outbox/src/outbox.int.test.ts`; ~~`task-10-report.md`~~ — báo cáo Task 10 nằm NGOÀI kho: cả cây báo cáo SDD bị một `.gitignore` phủ toàn bộ, nên nó chưa bao giờ là một con trỏ giải được |
| 6 | **[ĐÓNG]** **ĐÓNG NỬA ĐỌC [S1.10.2]:** `resolveSessionByToken` tra token (băm, đòi `mfa_verified_at`) và `apps/api` gọi nó ở mọi route người mua. ~~**Nửa PHÁT vẫn mở** — không hàm sản phẩm nào INSERT `sessions`; đó là S1.10.4 (`startUserSession`).~~ **[S1.21] NỬA PHÁT CŨNG ĐÓNG, từ S1.10.4:** `startUserSession` tồn tại (`packages/identity/src/login.ts:228`) và `/auth/totp` gọi nó (`apps/api/src/routes/auth.ts:184`). Bản sao THỨ HAI của lời khai thiu này nằm trong mã sản xuất — `packages/identity/src/session-actor.ts:90` vẫn viết *"nửa PHÁT … là S1.10.4"* ở thì tương lai (đã sửa trong vòng này). Nguyên văn cũ: ~~**Đường đời `sessions` chưa tồn tại**: không hàm nào phát token, tra token, hay đặt `mfa_verified_at`. D1 là một phép kiểm ĐÚNG chưa có ai gọi~~ | `packages/identity/src/session-actor.ts`; `evidence/INV-matrix.md` §4 |
| 7 | **[ĐÓNG]** ~~`apps/` rỗng ⇒ `listOrganizations` / `start()` **chưa có đường gọi sản phẩm**~~ **[S1.21] ĐÓNG từ S1.10 — và dòng này đã được GỌI TÊN là thiu ở mục 33 (S1.18) rồi lần nữa ở mục 35 (S1.20) mà vẫn không ai sửa.** Đó là bằng chứng gọn nhất của cả vòng này: **ghi một dòng thiu vào LỊCH SỬ không phải một lớp.** `apps/` có ba tiến trình (`api`, `public-keys`, `unseal-worker`) và `listOrganizations` có đường gọi sản phẩm ở `apps/api/src/composition.ts:96` | `apps/api/src/composition.ts` |
| 8 | **[ĐÓNG]** ~~**Không lớp máy nào cưỡng chế quy ước QT3**; chú thích + test là tất cả những gì đang giữ nó. **[S1.21] Đo lại: VẪN MỞ, và nay nó là khoản nợ S0 NẶNG NHẤT còn lại.** Bốn lần `QT3` xuất hiện dưới `tests/` và `tools/` đều là chú thích hoặc dữ liệu test, không một phép kiểm nào; 15 tệp sản xuất viết `OPERATOR(pg_catalog.=)` bằng tay và không lớp nào bắt tệp thứ 16 quên. Hình dạng lời giải đã rõ và cùng khuôn ADR-027: một vị từ suy từ TÍNH CHẤT trên chuỗi SQL trong mã sản xuất. Cố ý KHÔNG làm trong vòng này — nó là một bộ phân tích SQL, cần review riêng (đúng lời cảnh báo của khoản nợ 29 về việc trộn hai hạng mục)~~ **[S1.22] ĐÓNG bằng `[INV-H21]` + ADR-030.** Lớp máy là `tests/architecture/qt3-ghim-schema.test.ts`, và CHỦ THỂ của nó suy từ chính nội dung câu SQL: **một câu đã ghim MỘT trục phải ghim ĐỦ BỐN**. Lý do chọn chủ thể ấy là một phép đo, không phải một sở thích — một câu ghim KHÔNG GÌ trông đúng như nó là, còn một câu ghim NỬA VỜI **đọc như đã được bảo vệ**. Đo trước vòng: **13** câu ghim nửa vời, trong đó `unseal/gate.ts` (cổng chính sách mở thầu) đếm phê duyệt bằng năm `=` trần trong khi vẫn ghim `public.unseal_so_phe_duyet_can`. Vế thứ hai đóng ĐIỀU KIỆN TIÊN QUYẾT của mọi ca cướp đã đo: không mã sản xuất nào ngoài `migrate.ts` được chạm `search_path` (mọi cú pháp — `SET`, `SET LOCAL`, `set_config`). Review lượt 14 buộc ghim thêm **7 câu** trên đường ra quyết định an ninh (bộ đếm khoá E3, hai câu tiêu thụ dùng-một-lần, TTL phiên khách, cổng phiên khách của đường nộp báo giá, chính sách đang hiệu lực, cạnh `PENDING → APPROVED`). **Phần dư có tên và có mốc: khoản nợ 62** | `tests/architecture/qt3-ghim-schema.test.ts`, `tests/architecture/qt3-ngu-phap.int.test.ts`, `packages/audit/src/tenant-guard.ts`; ~~`task-8-report.md` §V3.5~~ — ngoài kho, xem dòng 5 |
| 9 | **[ĐÓNG]** ~~**Bốn gói thiếu danh sách trắng barrel**: `audit`, `tenancy`, `db`, `test-support`. Một symbol mọc ra ở mặt tiền của chúng không được canh bởi lớp nào~~ **ĐÓNG 2026-09-07 (S1.18, ADR-027).** Bốn danh sách trắng, cộng **[INV-H18]** — sổ đăng ký *gói → cửa → danh sách trắng* suy TỪ TÍNH CHẤT (đọc `packages/*/package.json`, đọc `exports`, import cửa thật), danh sách miễn **RỖNG**. Dựng nó tìm ra một lỗ THẬT: `sealed-envelope` khai hai cửa từ S1.4 mà cửa `./unseal` (xuất `unsealBid` — hàm MỞ phong bì giá thầu) chưa bao giờ có danh sách trắng; `g8-` canh AI, không ai canh CÁI GÌ. Cùng hình dạng với `@trustprocure/audit/anchor-sign`, và cả hai lần thứ mở cửa là MỘT DÒNG `package.json` | `tests/architecture/barrel-exports.test.ts` |
| 10 | **[ĐÓNG]** **`.gitattributes` ghim đúng hai thứ**: `*.sql` và `evidence/INV-matrix.md`. `.ts` là **CRLF trong mọi checkout mới** trên Windows. **[S1.21] Đo lại: VẪN MỞ, không đổi một chữ** — `.gitattributes` vẫn đúng HAI dòng không phải chú thích **[S1.63] ĐÓNG — `*.ts text eol=lf`, và tệp mang byte NUL thô trở lại là văn bản (bản hai, sau lượt soi 56).** Đo trước khi viết: clone MỚI với `core.autocrlf=true` tại `1934d61` ⇒ 181 `.ts` là `i/lf w/crlf` và 1 là `i/-text w/-text` — `apps/unseal-worker/src/index.ts` mang MỘT byte NUL thô trong regex gỡ U+0000, nên phép dò xuống dòng của Git báo `-text` và ripgrep quét theo thư mục bỏ qua nó; test kiến trúc mới (viết trước) ĐỎ ở vế thuộc tính (183 tệp) và vế nhị phân (đúng `index.ts`); không test nào đi qua đường gỡ U+0000 trước vòng này. Thử bản vá trên clone: `git add --renormalize` không đổi blob nào, `git status` không có sửa đổi giả. **Sửa:** `.gitattributes` thêm đúng `*.ts text eol=lf` kèm khối lý do — làm byte của checkout TẤT ĐỊNH, không phải một lần đỏ đã đo (run 33978573210 là ca `ci.yml`); vẫn KHÔNG `* text=auto`; byte NUL trong regex thành escape `\u0000`, sau khi hai `it` hành vi mới (U+0000 thô trong chuỗi của bản rõ JSON và trong bản rõ không phải JSON bị gỡ, lượt mở thầu không hỏng, ký tự xuống dòng còn nguyên) được đo XANH trên mã cũ; chú thích `thanhJson` gạch hai lời hứa quá. Sau bản vá: test kiến trúc bốn vế cục bộ xanh (vế chỉ chạy trên CI bỏ qua; với `CI=true` cục bộ nó đỏ đúng 19 tệp CRLF của worktree sẵn có); hai `it` hành vi xanh; `pnpm test` 50 tệp / 748 test + 1 bỏ qua (vế chỉ chạy trên CI), thoát mã 0; clone mới sau bản vá: clone `core.autocrlf=true` tại `5dda180` ⇒ 184 tệp TypeScript đều `i/lf w/lf`, tổng 0 byte CR (đếm theo byte); `index.ts` mang `text=set eol=lf`, 0 byte NUL. **Lượt soi đối kháng 56** (1 CAO, 2 NẶNG, 4 NHẸ, 3 INFO): CAO-1 — khoản 106 khai hẹp; ĐO: escape surrogate đơn lẻ ⇒ `22P02`, escape U+0000 trong khoá ⇒ `22P05` ⇒ hàng 106 viết lại, hình dạng đóng cũ bị bác; NẶNG-2 — ĐO: mảng lồng 5 000 tầng ⇒ `RangeError` khoá lượt mở thầu ⇒ vào 106; NẶNG-1 — chứng cứ dẫn cho `.ts` là ca `ci.yml` ⇒ chú thích sửa; NHẸ-1 — vế phạm vi đọc cả `text`, bắt `* text=auto` ở đầu tệp; NHẸ-2 và NHẸ-4 — lời khai về hiệu lực của `eol` và về phép dò nhị phân sửa; NHẸ-3 — vế chỉ chạy trên CI đo byte của checkout mới; INFO-1 — pathspec gồm `.mts`, `.cts`, `.tsx`; INFO-2 — ca raw ghim chỉ U+0000 bị gỡ, chú thích `thanhJson` sửa; INFO-3 — cả bốn tệp cùng commit. Test: `tests/architecture/xuong-dong-ts.test.ts` (năm `it`: bộ đọc; thuộc tính của `.ts`, `.mts`, `.cts`, `.tsx`; blob và cây làm việc không nhị phân; phạm vi hẹp gồm `text` của `.md` và `.yml`; vế chỉ chạy trên CI đòi byte LF ở cây làm việc) và hai `it` `[khoản nợ 10]` ở `apps/unseal-worker/src/unseal-worker.int.test.ts`; mười lăm đột biến đỏ cô lập ~~(biên bản 78)~~ ([S1.66] §S1.63). **Ranh giới nói ra:** `eol` có hiệu lực khi Git GHI tệp — cây làm việc CRLF có sẵn giữ nguyên byte, test cục bộ không phán xét nó; vế byte cây làm việc chỉ đo trên CI; `.md`, `.json`, `.yml`, `.mjs` không ghim. Mang sang ⇒ khoản 106 (đo: bốn loại bản rõ JSON hợp lệ khoá lượt mở thầu). | `.gitattributes`, `tests/architecture/xuong-dong-ts.test.ts`, `apps/unseal-worker/src/index.ts`, `apps/unseal-worker/src/unseal-worker.int.test.ts` |
| 11 | **[ĐÓNG]** ~~**Artefact neo ngoài của B3 vẫn không tồn tại.** Cơ chế đã có, artefact thì chưa — và không có nó, một chuỗi hash hợp lệ **không chứng minh gì** trước một chủ sở hữu bảng~~ **ĐÓNG 2026-09-07 (S1.17, ADR-026).** Artefact tồn tại và nó là bốn thứ, không phải một: một **văn bản chính tắc** (`anchor-text.ts`, cùng khuôn `buildReceiptText`), một **chữ ký** ECDSA P-256 dạng DER — dạng `openssl dgst -sha256 -verify` đọc thẳng — với vòng khoá RIÊNG khác vòng khoá ký biên nhận (`anchor-sign.ts`, sau quy tắc `g11-`, không có ở `index.ts`), một **nơi cất CHỈ-GHI-THÊM** (`anchor-store.ts`, JSONL mỗi tổ chức một tệp), và một **entry point** (`tools/neo-so-kiem-toan`, hai lệnh `xuat`/`kiem`). `ExternalAnchor` nay mang một **dấu đúc** — symbol module-private, không `Symbol.for` — nên `{ ...xuat, source: "bịa" }` không còn typecheck, và một `as unknown as` bị `verifyAuditChain` bắt ở thì chạy với `ANCHOR_UNVERIFIED`. **Chữ ký và tính chỉ-ghi-thêm chặn HAI thứ khác nhau và không thay được nhau:** chữ ký chặn BỊA THÊM, chỉ-ghi-thêm chặn BỎ BỚT — đo bằng một test có ĐỐI CHỨNG (nơi cất ghi đè ⇒ kết luận kiểm toán SẠCH trên một sổ đã bị cắt mất một nửa). **Còn mở, và cả hai đều KHÔNG phải mã:** cái LỊCH (một tiến trình ở nơi đã triển khai), và tính ĐỘC LẬP của nơi cất (S3 Object Lock ở một tài khoản AWS role deploy không với tới) — xem ADR-026 §5 | ~~`evidence/INV-matrix.md` §4.1 (trích nguyên văn)~~ nay là `evidence/INV-matrix.md` §4.1 **cộng phụ lục đính chính** (hai câu của bản trích đã bị bác bỏ, bản trích giữ nguyên byte); ADR-026 |
| 12 | **[ĐÓNG]** Lớp canh nhãn của Task 10 (`packages/outbox/src/nhan-bat-bien.test.ts`) **chỉ phủ `packages/outbox/src/`**. Lớp canh toàn repo mà Task 11 dựng chỉ bắt được nhãn trỏ tới mã **không tồn tại** — nó **không** bắt được nhãn đúng cú pháp gắn sai chỗ. **[S1.21] Đo lại: VẪN MỞ.** `packages/outbox/src/nhan-bat-bien.test.ts:26` vẫn tự khai phạm vi *"chỉ canh `packages/outbox/src/`"*, và `tools/inv-matrix/src/parse.ts` điểm danh nhãn chứ không xét CHỖ ĐẶT — một nhãn `[INV-B2]` gắn lên một test không đo B2 vẫn được tính là độ phủ. **[S1.29] ĐÓNG bằng `[INV-H22]`, và KHÔNG bằng cách xét ngữ nghĩa — vì ngữ nghĩa không cơ giới hoá được.** Đường hiển nhiên là dùng cột *nơi cưỡng chế* của sổ đăng ký làm nguồn khai chỗ đặt; **đo trước khi chọn thì nó trượt**: cột ấy nêu tên tệp cho **7/13** cặp mã `H` và **0/101** cặp mã `A–G` (nó là VĂN XUÔI cho các hàng nghiệp vụ), nên dùng nó sẽ đỏ 101 lần ở lượt đầu **mà không có khiếm khuyết nào**. Bản đóng: một **SỔ KHAI** (mã ⇒ tệp) sinh từ trạng thái đo được rồi đóng băng, và cổng đỏ theo **CẢ HAI CHIỀU** — cặp chưa khai là đỏ, dòng khai THIU cũng đỏ, và chiều thứ hai đồng thời là **đối chứng dương dựng sẵn** (bộ quét mù ⇒ đỏ ở cả 137 cặp, đã đo). **Và phép đo bắt được một lỗ trong chính bản vá trước khi nó ra đời:** bộ sinh gom nhãn theo `fullName` = tên `describe` NỐI tên `it`, nên **22 cặp chỉ tồn tại trên dòng `describe(`** — gồm `H19`, `H20`, `H21` và cả ~~chín~~ **mười** mã hook (`H1`–`H10` — lượt soi 19 đếm lại); một bộ quét chỉ đọc `it(` mù với chúng. Cùng phép đo ấy bác câu tự khai *"đúng thứ bộ sinh gom"* của `packages/outbox/src/nhan-bat-bien.test.ts`, đã sửa tại chỗ. **RỒI LƯỢT SOI ĐỐI KHÁNG 19 BÁC CHÍNH BẢN VÁ ẤY, LẦN THỨ HAI TRONG CÙNG VÒNG:** bộ quét theo *dòng nguồn* — kể cả khi đọc cả `it(` lẫn `describe(` — vẫn là một vị từ HÌNH DẠNG (đúng thứ ADR-035 §2⑴ cấm), và bộ sinh gom theo `fullName` LÚC CHẠY nên `test(`, `it.concurrent(`, tiêu đề ở dòng sau của `it.each([...])(` đều nuôi ma trận mà bộ quét mù; kho **đang có 8 tên test như thế**, chỉ "được khai" nhờ trùng hợp có một dòng `it(` khác cùng mã cùng tệp. Mũi thật: đổi tên một `it.each` ở `crypto-keys/src/roundtrip.test.ts` thành `[INV-A1]…` ⇒ bản vá vẫn 7/7 xanh trong khi vitest báo **11** tên test mang `[INV-A1]`. **Bản đóng cuối:** phép kiểm dời vào `tools/inv-matrix/src/parse.ts` (`findMisplacedLabels`) và đọc CHÍNH báo cáo vitest — cùng nguồn với `collectCoverage` — cưỡng chế ở cổng `pnpm evidence` (đo: gắn `[INV-C1]` vào một tệp chưa khai ⇒ **CHẶN MERGE**); sổ khai ở `tools/inv-matrix/src/so-khai-nhan.ts`, sinh từ báo cáo (trùng khớp 137 cặp, 0 lệch với bản quét dòng); `[INV-H22]` thành test T1 cho hàm thuần với fixture. **Thứ KHÔNG đóng, đừng đọc gộp:** sổ khai chặn cặp thứ 138 đi vào lặng lẽ, nó **không kiểm toán 137 cặp có sẵn**; vế *"test này có thật sự đo bất biến ấy không"* vẫn là một phán xét của mắt người | `tools/inv-matrix/src/parse.ts`, `tools/inv-matrix/src/so-khai-nhan.ts`, `tests/architecture/nhan-bat-bien-cho-dat.test.ts`, `packages/outbox/src/nhan-bat-bien.test.ts` |
| 13 | **[ĐÓNG]** **ĐÃ ĐÓNG [S1.6].** ~~**`D1` là một mệnh đề HỘI bốn vế mà phép hội chưa từng được đo một lần.**~~ `assertUnsealAllowed` hợp cả bốn vế; phép hội được đo bằng khuôn *một trạng thái chỉ sai đúng một vế*, và `C3` nay ✅ nên mâu thuẫn số học giữa hai hàng cũng hết. Nguyên văn cũ: 12 test đo vế *MFA còn hiệu lực*, 5 test đo vế *quyền hợp lệ*, **không test nào đo hai vế cùng lúc**; hai vế còn lại (*RFQ đã CLOSED*, *cổng chính sách*) không có một dòng mã nào. Vế thứ ba **chính là hàng `C3`**, đang ⏳ trong cùng bảng | `evidence/INV-matrix.md` §4 (mục D1) |
| 14 | **[ĐÓNG]** **ĐÃ ĐÓNG [S1.6].** ~~**`G1` canh một cánh cửa chưa có phòng ở sau.**~~ `apps/unseal-worker` tồn tại và THẬT SỰ import cả hai cửa hạn chế. Nguyên văn cũ: 18 test đo quy tắc biên giới — lớp phòng ngừa thật, đã chứng minh có răng — nhưng `wrapped_private_key` và `apps/unseal-worker` **chưa tồn tại** | `evidence/INV-matrix.md` §4 (mục G1) |
| 15 | **[MỞ]** **Không có ADR mở cho KMS dù nó chặn S1.6** — đã đóng bằng **ADR-009**; khoản nợ còn lại là *chốt nhà cung cấp*, và nó **không độc lập** với quyết định hạ tầng (ADR-006 chỉ cưỡng chế được bằng IAM của hạ tầng đích). **[S1.21] Đo lại: VẪN MỞ, và KHÔNG phải việc của mã nguồn** — chốt nhà cung cấp là một quyết định hạ tầng, không một dòng mã nào trong kho này đóng được nó | `docs/DECISIONS.md` ADR-009 |
| 16 | **[ĐÓNG]** **ĐÃ ĐÓNG [S1.20] bằng ADR-028 + migration `047` + H19.** Tập bảng chỉ-ghi-thêm nay SUY TỪ TÍNH CHẤT (mang cả hai trigger BEFORE-ROW-UPDATE và BEFORE-ROW-DELETE mà hàm không có `RETURN`), và ba mục mới canh LOGGED · chốt TRUNCATE · ACL trên tập ấy. Bảng sổ nay bị cấm cột NGOÀI chuỗi hash. `VI_TU_BANG_TENANT` thôi giấu `OR relname IN ('organizations')` — gốc tenant suy từ đích của khoá ngoại `org_id` MỘT CỘT. `UNIQUE (org_id, seq)` VẪN chỉ áp cho hai bảng sổ, nay KÈM lý do (nó gắn với chuỗi hash, không với tính chỉ-ghi-thêm). **Và khoản nợ này bỏ sót lỗ nặng nhất của chính nó: `TRUNCATE` đi qua ba bảng S1** — đo được `TRUNCATE bid_receipts` → OK | `docs/DECISIONS.md` ADR-028, `db/migrations/047_*.sql` |
| 17 | **[ĐÓNG]** ~~**Hai mặt tiền chịu lực nhất repo không có lớp nào canh đường vào.** `packages/tenancy/src/with-tenant.ts` là **điểm DUY NHẤT gắn `app.org_id`** — toàn bộ RLS của 002–007 treo vào nó — và `packages/audit/src/writer.ts` là đường ghi sổ kiểm toán. Cả hai **với tới được bằng import tương đối**: 3/7 gói có quy tắc biên giới (`crypto-keys`, `identity`, `outbox`); `audit`, `db`, `tenancy`, `test-support` **không có**~~ **ĐÓNG 2026-09-07 (S1.18, ADR-027).** Họ `g12-`…`g15-`; số họ quy tắc biên giới **5 → 9**; `MIEN_TRU` của [INV-H16] về **RỖNG**. Phép đo bác bỏ chính lý do miễn trừ (*"rủi ro hồi quy riêng"*): **0 chỗ import phải di trú**. Vị từ *gói* nay là *thư mục có `package.json`* và tập cửa đọc từ `exports` — cả hai sửa sau review lượt 10 (H10-1 HIGH, H10-2) | ~~`.dependency-cruiser.cjs:77-78`~~ nay là `tests/architecture/goi-workspace.ts` + ADR-027 |
| 18 | **[MỞ]** **Bộ máy evidence nằm ngoài vòng review bắt buộc** — đã đóng ở vòng fix cuối: `/tools/inv-matrix/`, `/docs/TEST-PLAN.md`, `/docs/STATE.md`, `/evidence/` nay có trong `.github/CODEOWNERS`. Khoản nợ **còn lại**: `CODEOWNERS` trỏ tới `@trustprocure/bao-mat`, một team **chưa tồn tại**, nên tới hôm nay nó **chưa cưỡng chế gì**. **[S1.21] Đo lại: VẪN MỞ** — 15 dòng của `.github/CODEOWNERS` vẫn trỏ tới `@trustprocure/bao-mat`; đóng nó là ba bước cấu hình trên GitHub (tạo team, bật branch protection, thay tên), không một dòng mã nào | `.github/CODEOWNERS` (khối cảnh báo ở đầu file) |
| 19 | **[MỞ]** **[S1.21] MỞ BẰNG CẤU TẠO — không đóng được, và cũng không xoá được.** Văn bản sai nằm trong chú thích của migration ĐÃ ÁP, mà sửa chú thích cũng đổi checksum; nó ở lại sổ như một GIỚI HẠN ĐÃ BIẾT chứ không phải một việc đang chờ. Nguyên văn: **Bốn phép đo THIU trong chú thích của migration đã áp**, không sửa được tại chỗ vì `001`–`007` và `hardening.always.sql` **không được đụng** (migration đánh số chạy đúng một lần; sửa chú thích cũng đổi checksum): ⑴ `006:23` và `007:29` chép **nguyên văn giống nhau** *"~71 chỗ `::text`/`::oid`"* — đo lại bằng công cụ **nhị phân** trên `hardening.always.sql`: `::text` = **55**, `::oid` = **2**, tổng **57**; một phép đo thiu được chép sang file thứ hai **mà không đo lại**. ⑵ `hardening:863-864` (khối *DƯ LƯỢNG CÒN LẠI*, đúng đoạn có giá trị kiểm toán cao nhất) nói *"một bảng ở schema khác mang ĐÚNG **14** cột này"* trong khi danh sách có **15** tên và vị từ dòng 886 đúng là `= 15` — mô tả sai bề mặt tấn công **đi một cột**. ⑶ `005:190-191` nói mục (C) *"CẤM MỌI"* hàm SECURITY DEFINER, nhưng bản cài đặt còn loại trừ `pg_toast%`/`pg_temp%`, `NGOAI_LE_DOC_VONG`, và **hàm thuộc EXTENSION** — file viện dẫn nói **rộng hơn** file có thẩm quyền. ⑷ `hardening:73-76` nói *"4 trong 6 câu lệnh"* trong khi bảng hiện có **36 mục**. **Cách đóng đúng: một migration mới, hoặc sửa kèm lần migrate() kế tiếp có đổi lược đồ.** | `db/migrations/006_sessions_and_mfa.sql`, `db/migrations/007_outbox.sql`, `db/migrations/005_identity.sql`, `db/migrations/hardening.always.sql` |
| 20 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-05] bằng HAI lớp không thay thế nhau.** ⑴ Job T1+T2 nay chạy trên CẢ `ubuntu-latest` LẪN `windows-latest` (`fail-fast: false`); T3 cố ý ĐỨNG NGOÀI ma trận vì runner Windows không chạy được `postgres:16-alpine`, và giới hạn ấy được ghi thẳng vào `ci.yml`. ⑵ `tests/architecture/bao-dam-mot-he-dieu-hanh.test.ts` đo THẲNG tính chất, trên mọi hệ điều hành. **MỘT DỰ ĐOÁN CỦA TÔI ĐÃ BỊ PHÉP ĐO BÁC BỎ:** bản đầu của lớp ⑵ canh đường dẫn `import`, và phép đo (đổi `./comparison.js` → `./Comparison.js` ở một module chỉ có ĐÚNG MỘT nơi import) cho thấy `tsc` BẮT ĐƯỢC bằng `TS1261` — trục ấy đã có chủ, nên vế ấy bị GỠ. Thứ còn lại không có chủ là **đường dẫn dạng CHUỖI** (`new URL(..., import.meta.url)`, hơn năm mươi chỗ trong kho): `tsc` mù hoàn toàn với chúng. Lớp mới TÌM RA MỘT LỖI THẬT ngay lần chạy đầu — server đột biến của máy dò WebCrypto đọc `./do-webcrypto.html`, một tên không còn tồn tại, nên nó ném `ENOENT` ở dòng đầu và không ai biết. Nó cũng ĐỎ TRÊN CHÍNH NÓ một lần (khối lý do NHẮC TỚI một `new URL(...)` như ví dụ và phép quét đọc câu văn ấy thành lời gọi thật) — đã sửa bằng cách bỏ chú thích trước khi quét. Mũi đột biến (`db/migrations` → `db/Migrations`) ĐỎ THẬT. Nguyên văn: ~~**Không lớp nào canh "bảo đảm chỉ đúng trên một hệ điều hành".**~~ Lần chạy CI đầu tiên tìm ra **một** ca (test import sai hoa-thường) và ca đó đã sửa, nhưng cơ chế phát hiện vẫn là *"chạy trên hệ điều hành thứ hai rồi xem cái gì đỏ"*. Toàn bộ 346 test đơn vị mới chỉ được chạy trên **hai** nền tảng đúng **một** lần mỗi bên, và CI chỉ có `ubuntu-latest` — nên một bảo đảm chỉ đúng trên **Linux** thì hôm nay **không lớp nào bắt được**. Cách đóng đúng: thêm `windows-latest` vào ma trận job T1+T2 | `tests/architecture/boundaries.test.ts` (khối chú thích của test hoa-thường); `.github/workflows/ci.yml` |
| 21 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-05] bằng `tests/architecture/pham-vi-san-xuat.test.ts`.** Ba vế, và vế giữa suy TỪ TÍNH CHẤT chứ không từ một danh sách tên: một gói workspace mà MỌI nơi import nó đều là tệp test thì không được nằm ở `dependencies` của bất kỳ ai — một `packages/x-support` mai sau tự rơi vào rổ ấy mà không ai phải nhớ thêm tên nó vào đâu. Hai vế kia: tập phụ thuộc NGOÀI ở phạm vi sản xuất được ghim đúng bằng `pg` + `pg-connection-string`, và phụ thuộc phát triển của gốc không được lọt vào `dependencies` của gói nào. **NÓ TÌM RA MỘT LỖ NGAY LẦN CHẠY ĐẦU:** `apps/unseal-worker` khai `@trustprocure/test-support` ở `dependencies` — tức hạ tầng Testcontainers nằm trong phạm vi sản xuất của app ấy, và `pnpm audit --prod` KHÔNG kêu một tiếng, vì sau lần sửa Task 3 gói đó không còn phụ thuộc ngoài nào để mà có advisory. Đúng cơ chế khoản nợ này mô tả, tái diễn lần thứ hai. Nguyên văn: ~~**Chỉ `pnpm audit --prod` chặn được hạ tầng kiểm thử lọt vào phạm vi sản xuất, và nó chỉ nổ khi TÌNH CỜ có advisory.**~~ và nó chỉ nổ khi TÌNH CỜ có advisory.** `packages/test-support` khai `@testcontainers/postgresql` trong `dependencies` suốt từ Task 3 tới lần chạy CI đầu tiên; thứ làm nó lộ ra là **hai advisory HIGH trên `undici`**, không phải một lớp canh nào. Một gói kiểm thử **không có advisory** vẫn nằm im trong đồ thị prod và **không lớp nào kêu**. Cách đóng đúng: một test đọc mọi `package.json` của workspace và khẳng định tập phụ thuộc sản xuất đúng bằng một danh sách được ghim | `packages/test-support/package.json`, `.github/workflows/ci.yml` (bước *Audit phu thuoc (cong chan)*) |
| 22 | **[ĐÓNG]** ~~**Job `evidence` vẫn CHƯA từng chạy trên CI.**~~ **ĐÃ ĐÓNG** ở run `33221142361`: job chạy đủ, 672 khẳng định, 24/47, *"Cổng evidence: XANH"*, và bước so byte với bản đã commit đã chạy và qua. Toàn bộ khoản nợ *"chưa chạy trên CI thật"* nay đã trả hết. Giữ hàng này để đối chiếu, không xoá | `.github/workflows/ci.yml` (job `evidence`) |
| 23 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-08] — BA PHÉP ĐO TRÊN MÁY THẬT, CỘNG MỘT QUYẾT ĐỊNH TƯỜNG MINH CHO PHẦN KHÔNG ĐO (ADR-031).** Dòng **5** và **6** của `tools/do-webcrypto/ket-qua-do.md`: **Zalo** và **Messenger** trên **Galaxy A02s / Android 12** — máy phổ thông giá rẻ, đúng phân khúc mà ô ưu tiên 1 mô tả — **ĐẠT toàn bộ, kể cả `X25519`**; dòng **4** thêm **iOS 26.6.1**. Hai dòng Android báo **cùng một build `Chrome/151.0.7922.200`**, tức Messenger **mượn chính Android System WebView**: điều nghi đã sinh ra ô ưu tiên 3 bị **bác bằng phép đo**. **Lý do đóng KHÔNG phải *"đã đo hết"*** — hai chế độ cố ý không đo và được gọi tên ở ADR-031 §3⑵: một máy có **WebView tụt lại nhiều phiên bản** (máy đo có WebView 151, tức mới) và **iOS ≤ 16**. Đóng được là vì phần chưa đo **không còn quyết định gì**: ADR-011 đã gỡ thế hoặc/hoặc từ 2026-09-04, nên thiếu `X25519` là **tụt xuống P-256 chứ không gãy**, còn thiếu cả hai thì gãy ở `crypto.subtle` — đã nằm trong đường thoát của ADR-007. Việc còn lại **không phải một khoản nợ mà là một yêu cầu giao diện của S1.4/S1.5** (ADR-031 §3⑶): đường nộp báo giá phải chạy chính phép dò này và chuyển hướng sang trình duyệt ngoài khi phán quyết không phải *"Nộp thầu được"*. Nguyên văn: ~~**VẪN MỞ, và [2026-09-05] xác nhận lại: KHÔNG mã nào đóng được nó.** Vế còn thiếu là một phép đo trên MÁY THẬT — Android tầm trung/cũ — và trong tay không có máy ấy;~~ lượt tra dữ liệu công bố 2026-09-04 đã cho một kết quả ÂM (phân bố phiên bản Android System WebView không tra được từ dữ liệu tổng hợp miễn phí). Viết thêm một dòng mã nào ở đây cũng chỉ là viết quanh chỗ trống. Một điều CÓ sửa được thì đã sửa: server đột biến của chính máy dò (`tools/do-webcrypto/phuc-vu-va-dot-bien.mjs`) đọc một tên tệp không còn tồn tại và ném `ENOENT` ở dòng đầu — tức công cụ dùng để đo, nếu ai đó cầm lên hôm nay, sẽ KHÔNG CHẠY. Lớp canh của khoản nợ 20 tìm ra nó. Nguyên văn cũ giữ lại: **VẪN MỞ, nhưng THÔI CHẶN S1.4 kể từ 2026-09-04.** ADR-011 được chốt bằng cách **gỡ bỏ thế hoặc/hoặc** — hỗ trợ CẢ HAI thuật toán, chọn bằng chính máy dò lúc chạy — nên phép đo Android tụt từ **cổng chặn** xuống **con số vận hành**. Lượt tra dữ liệu công bố 2026-09-04 còn cho một **kết quả ÂM đáng ghi**: phân bố phiên bản Android System WebView **không tra được** từ dữ liệu tổng hợp miễn phí, tức câu hỏi cũ *không* trả lời được bằng cách đọc, chỉ bằng cách thuê máy thật — và ngay cả thế cũng chỉ cho một mẫu. Xem `tools/do-webcrypto/ket-qua-do.md` §3c. Nguyên văn cũ giữ lại: **Phía Android của WebCrypto chưa từng được đo, và việc đó đã được HOÃN CÓ CHỦ ĐÍCH ngày 2026-08-29** vì trong tay không có máy Android tầm trung/cũ và không có iPhone iOS cũ. Đây **không phải** rủi ro đã đóng; nó là rủi ro **được chấp nhận tạm** với hai điều kiện ghi rõ: ⑴ **phải đo trước khi CHỐT ADR-011** (S1.4), vì sau khi đã có phong bì thật thì đổi thoả thuận khoá là một cuộc di trú chứ không phải sửa cấu hình; ⑵ chừng nào ô ấy còn trống, **không tài liệu nào được viết *"đã đo trên webview"* mà không kèm `iOS 18.7`**. Giảm nhẹ đã có: ADR-011 buộc phong bì **mang mã thuật toán thoả thuận khoá**, nên đổi sang P-256 về sau là **thêm một nhánh**, không phải viết lại | `tools/do-webcrypto/ket-qua-do.md` §4 (quyết định hoãn, có ngày) |
| 24 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-08, S1.25] BẰNG ĐÚNG PHÉP ĐO MÀ CHÍNH KHOẢN NỢ NÀY TỰ ĐẶT RA — và con số ấy YẾU HƠN vẻ ngoài của nó, nên phải nói ra trước.** Lượt `workflow_dispatch` **34225703897** trên nhánh ĐÃ VÁ (`33af790`), 10 lượt `pnpm test:int` trên phần cứng CI, 87 phút: **`TỶ LỆ ĐỎ: 0 / 10`** — mười lượt xanh cả mười (trước vòng: 2/10 trên master, trong đó **một** thuộc khoản này). **Giới hạn của con số, TÍNH ra chứ không cảm thấy:** với tỷ lệ nền 1/10, xác suất thấy 0 đỏ trong 10 lượt **ngay cả khi không sửa gì** là `0,9¹⁰ ≈ 35%`. Tức một lượt 10 sạch **không tự nó** phân biệt *"đã sửa"* với *"gặp may"*, và lời đóng này **không đứng trên tỷ lệ**. Nó đứng trên ba chân, tỷ lệ là chân thứ ba: ⓐ **cơ chế đã gọi được tên** — `pool.end()` là thao tác CỤC BỘ của Node (đóng socket), backend PostgreSQL giữ advisory lock chỉ chết SAU đó và BẤT ĐỒNG BỘ, nên một phép đếm tức thì đo sai THỜI ĐIỂM chứ không đo sai tính chất; ⓑ **bản vá không nới một ngưỡng nào** — vòng chờ có hạn 15 giây, một khoá KẸT THẬT vẫn ở lại tới hết hạn và test vẫn đỏ với ĐÚNG con số cũ, tức lớp canh giữ nguyên răng; ⓒ 0/10 làm chứng cho hai chân kia. **Nửa còn lại của khoản này đóng vì một lý do KHÁC HẲN, và phải ghi khác:** `[T10-L]` (`outbox.int.test.ts`) **không phát lần nào trong 10 lượt và KHÔNG được sửa gì cả** — nó rời sổ vì *không quan sát được*, không vì *đã chữa*. Thứ giữ cho vế ấy khỏi rơi vào im lặng là lượt đo **hằng tuần cộng đường báo động bằng issue**: **khoản nợ 65 đóng TRƯỚC chính là điều kiện để khoản 24 đóng được**. Nếu `[T10-L]` hay `[M10]` trở lại, một issue mang con số sẽ mở — và đó là một PHÉP ĐO MỚI, không phải khoản nợ này mở lại. Xem mục 40. Nguyên văn: ~~**ĐÃ ĐO [2026-09-05], VÀ CƠ CHẾ ĐO NAY CHẠY ĐỀU — nhưng chưa tuyên bố là đã sửa.**~~ Số liệu thật trên máy phát triển (Windows 11, Docker Desktop 29.7.2): 1 lượt `pnpm test:int` đầy đủ (23/23 tệp, **0** lần `57P01`, **0** unhandled), 5 lượt cặp `migrate`+`outbox`, 8 lượt tranh chấp bốn tệp cùng lúc — **0/14 lần đỏ**. Cộng thêm: nguồn phát ĐÃ BIẾT của `57P01` nay có phép đo riêng (khoản nợ 28), và `[M10]` đã được truy nguyên từ vòng fix trước với năm nhánh B0–B4 đo thật. ~~Thứ CÒN THIẾU đúng một điều — cùng con số ấy trên PHẦN CỨNG CỦA CI, nơi cả hai lần đỏ thật sự xảy ra~~ — nên `.github/workflows/do-lap.yml` chạy lặp `test:int` hằng tuần và **fail-closed** khi tỷ lệ khác 0. Không nới một ngưỡng nào. **[2026-09-08, S1.24] SỐ ĐO ẤY ĐÃ CÓ TỪ 2026-09-07 VÀ KHÔNG AI ĐỌC: `TỶ LỆ ĐỎ: 2 / 10`** trên phần cứng CI (lượt `schedule` 34164851323, trên master `4caea39`). Hai lượt đỏ **khác nhau**, và chỉ một là khoản nợ này: lượt 5 là `[M10]` của `migrate.int.test.ts` — đúng test mà khoản nợ gọi tên; lượt 7 là `composition.int.test.ts`, tức **đua tranh ghi hộp thư dev mà S1.22 đã sửa** ở `58f6d22`, và lượt đo chạy trên master TRƯỚC bản sửa ấy. Nên tỷ lệ hôm nay **suy ra** là 1/10 — nhưng suy ra không phải đo được, và việc còn lại của khoản nợ này là **một lượt `workflow_dispatch` trên master hiện tại**. Việc *"không ai đọc"* là khoản nợ **65**, khoản nợ riêng. **[S1.24, thêm một điểm dữ liệu] Lượt CI ĐẦU của PR #21 đỏ đúng `[M10]`, đúng khẳng định `expected 1 to be +0`; lượt chạy lại XANH 6/6, và máy phát triển chạy cùng HEAD ấy 759/759.** Hai vế phải nói cùng lúc: đua tranh này **có tên từ trước và không do vòng S1.24 tạo ra**, nhưng vòng ấy thêm **một** tệp int khởi động container (31 → **32**), tức nó **làm nợ 24 dễ phát hơn** — cùng khuôn với S1.22, nơi tệp container thứ 39 làm một đua tranh có sẵn phát ra. Ghi một vế mà bỏ vế kia là ghi một nửa sự thật theo hướng tiện cho mình. Nguyên văn: ~~**HAI test FLAKY, cùng một họ, và họ ấy nay có tên.**~~ `[M10]` (`packages/db/src/migrate.int.test.ts` — đếm advisory lock còn sót) và `[T10-L]` (`packages/outbox/src/outbox.int.test.ts` — `destroyConnectionWhenDone`) đều **đỏ trong lượt chạy đầy đủ và XANH khi chạy riêng**, cả hai quanh **vòng đời kết nối dưới tranh chấp Docker**. Chúng chưa được sửa **có chủ đích**: chưa có phép đo nào phân biệt được *"lớp bị hỏng"* với *"máy chạy chậm"*, và sửa mù bằng cách nới ngưỡng là đúng thứ biến một phép đo thành một lời khai. Cách đóng đúng: một lượt chạy lặp (`--repeat`) trên CI để đo TỶ LỆ, rồi mới quyết định | `packages/db/src/migrate.int.test.ts:540`, `packages/outbox/src/outbox.int.test.ts:1404` |
| 27 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-05].** Bước audit tách ra thành job riêng `t0b-audit`. Hướng fail-closed KHÔNG đổi — một lần audit không chạy được vẫn không được đọc thành *"không có lỗ hổng"*; thứ sai là GỘP, vì nó để một lần gián đoạn mạng của bên thứ ba che mất kết quả của bốn cổng tĩnh không phụ thuộc gì ngoài kho mã. Nay một lượt gián đoạn cho ra hai câu khác nhau: `T0 — cổng tĩnh` XANH, `T0b — audit` ĐỎ. `tests/architecture/hinh-dang-ci.test.ts` ghim cả hai thay đổi, và hai mũi đột biến (gỡ `windows-latest`; đưa `pnpm audit` về `t0`) đều ĐỎ THẬT. Nguyên văn: ~~**Cổng T0 ĐỎ được vì một lý do KHÔNG nằm trong kho mã, và điều đó đã xảy ra thật.**~~, và điều đó đã xảy ra thật.** Hai lượt CI ngày 2026-09-04 (`33862380751` commit `6e8c8aa`, `33862719087` commit `9b1c237`) đỏ ở bước *Audit phu thuoc (cong chan)* với `ERR_SOCKET_TIMEOUT` khi gọi `registry.npmjs.org` — `tsc`, `eslint`, `depcruise`, `gitleaks` đều xanh, và `pnpm t0` cục bộ xanh trên đúng cây ấy. Tức **cổng chặn merge phụ thuộc vào một dịch vụ ngoài còn sống**. Hướng fail-closed là ĐÚNG (một lần audit không chạy được không được đọc thành "không có lỗ hổng"), nên đây **không** phải một lỗi cần sửa vội; nó là một tính chất phải **được biết**, vì lần tới ai đó thấy T0 đỏ sẽ đi tìm lỗi trong mã của mình. Cách đóng đúng nếu nó lặp lại: tách bước audit thành một job RIÊNG, để một lượt gián đoạn mạng không che mất kết quả của bốn cổng tĩnh còn lại | `.github/workflows/ci.yml` (bước *Audit phu thuoc (cong chan)*) |
| 28 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-05], và đóng bằng ĐO chứ không bằng sửa mù — đúng cách khoản nợ này đòi.** `TestDatabase.stop()` nay hỏi `pg_stat_activity` NGAY TRƯỚC `container.stop()` và ném nếu còn backend khách sống sau một cửa sổ chờ 3 giây; cửa sổ ấy không phải một ngưỡng được nới cho tới lúc hết đỏ mà là một quãng chọn DƯỚI `idleTimeoutMillis` mặc định 10 giây của `pg`, nên nó phân biệt được *"đã đóng, chưa thoát"* với *"rò rỉ thật"*. Ba quyết định được ghi tại chỗ: khẳng định KHÔNG chặn `container.stop()` (một lớp canh làm rò rỉ container thật thì tệ hơn thứ nó canh); [CẤM LOG] thông điệp KHÔNG mang cột `query`; và `withMigratedDatabase` viết lại để lỗi THÂN HÀM thắng lỗi dọn dẹp — một `finally` trần sẽ để phép đo mới che mất đúng thứ bộ test đang tìm. Có ca rò rỉ dựng sẵn chứng minh nó có răng. Đo trên cả 23 tệp tích hợp: **0 rò rỉ, 0 lần `57P01`, 0 unhandled**. Nguyên văn: ~~**Job T3 đỏ được vì một lỗi KHÔNG PHẢI một khẳng định sai.**~~ Lượt `33862719087` (commit tài liệu thuần `9b1c237`) đỏ với `terminating connection due to administrator command` (`57P01`) — một kết nối gộp còn sống khi container Postgres của test bị đóng; **không một `expect` nào đỏ**. Cùng lượt ấy trên commit TRƯỚC (`6e8c8aa`) thì T3 xanh. Đây là cùng họ với khoản nợ 24 (vòng đời kết nối dưới tranh chấp), nhưng khác chỗ: nó không gắn với một test có tên nào, nên `--repeat` một file không tái lập được. Cách đóng đúng: mỗi bộ test tích hợp phải đóng pool TRƯỚC khi dừng container, và điều đó phải được ĐO chứ không được sửa mù | `packages/test-support/src/postgres.ts` (`stop()`), `packages/audit/src/chain.int.test.ts` |
| 25 | **[ĐÓNG]** **ĐÃ ĐÓNG [S1.6]** bằng `RFQ_KEY_MATERIAL_UNWRAPPED` ghi bởi chính worker. Nguyên văn cũ: **Vế *mở bọc* của G4 chưa có một dòng mã nào, và nó là vế một kiểm toán viên hỏi tới ĐẦU TIÊN.** S1.4 ghi sổ kiểm toán cho *sinh* (một bản ghi, vì sinh và bọc là một hành vi) và *huỷ*; *mở bọc* sống trong `apps/unseal-worker`, thứ chưa tồn tại. Đây là **phần chênh đã được khai báo** ở §4 của ma trận chứ không phải một khoảng trống bị quên — nhưng nó là khoản nợ mà **S1.6 phải trả**, không phải một ghi chú vĩnh viễn | `tools/inv-matrix/src/danh-gia.ts` (`PHAM_VI_HEP` mục `G4`) |
| 26 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-05] bằng `026_xoa_mat_ma_vat_lieu_khoa.sql` — S1.6 đã xây xong cổng chính sách mà `017` khối (4) chờ.** Xoá mật mã ĐƯỢC hỗ trợ và KHÔNG BAO GIỜ là tác dụng phụ của một nút: bốn điều kiện hợp lại — ⑴ đã THU HỒI, ⑵ hết quãng ân hạn `key_purge_grace_hours` của chính sách ĐÃ GHIM, ⑶ chính sách phải BẬT (mặc định `NULL` = không bao giờ xoá; một hành động không đảo ngược được không được bật sẵn cho ai chưa nghe nói tới nó), ⑷ `wrapped_private_key` chỉ đổi được VỀ `NULL`, một lần. `app_api` nay CÓ `UPDATE` trên cột ấy — một sự nới quyền phải nói thẳng — nhưng nó vẫn KHÔNG ĐỌC được cột, và trigger từ chối mọi giá trị mới khác `NULL`: hình dạng của một nút phá huỷ, không phải một nút sửa. Mã quyền `rfq.key.purge` chỉ `PROCUREMENT_MANAGER`; người gọi phải khai đúng SỐ HÀNG mình đang phá huỷ. Bốn ca từ chối đi THẲNG bằng SQL, không qua mặt tiền; mũi đột biến bỏ vế ân hạn ĐỎ THẬT. **GIỚI HẠN ĐÃ GHI RA:** `UPDATE ... = NULL` xoá GIÁ TRỊ, không bảo đảm byte cũ biến khỏi WAL/bản sao lưu/standby — bảo đảm mật mã thật chỉ đóng khi khoá chủ ở KMS cũng bị huỷ, và đó là lý do bản ghi mang tên `RFQ_KEY_MATERIAL_PURGED` chứ không `CRYPTO_ERASED`. Nguyên văn: ~~**Thu hồi vật liệu khoá là một DẤU, không phải một lần XOÁ MẬT MÃ.**~~ Khi một RFQ bị huỷ, `rfq_key_material.revoked_at` được đặt nhưng `wrapped_private_key` **vẫn nằm nguyên trong hàng**. Xoá nó đi sẽ biến *"không ai được mở báo giá của RFQ đã huỷ"* từ một quy tắc **chính sách** thành một sự thật **mật mã** — mạnh hơn hẳn — nhưng nó cũng là một hành động không đảo ngược đứng sau một nút có thể bấm nhầm. Quyết định thuộc S1.6, nơi có cổng chính sách để đặt nó vào | `db/migrations/017_rfq_key_material.sql` khối (4) |
| 29 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-05] bằng `027_phien_khach_co_lap.sql` — nhưng KHÔNG theo hình dạng khoản nợ này tự đề xuất, và sự khác ấy là một phép đo.** Sổ nợ nói *"một role `app_guest`"*. Tôi đã định làm đúng thế, rồi đọc `hardening.always.sql` và đổi ý: một role thứ ba PHẢI được file ấy cưỡng chế lại thuộc tính ở MỌI lần `migrate()` (nếu không, một `ALTER ROLE app_guest BYPASSRLS` sau triển khai sống mãi — và đó ĐÚNG NGƯỢC LẠI thứ A5 cần), mà file ấy liệt kê role theo TÊN ở ba chỗ, tức đóng bằng role sẽ kéo theo một lần sửa file 1600 dòng chịu lực nhất kho. Và một role KHÔNG mạnh hơn ở đúng trục đang bàn: cả hai thiết kế đều đứng trên *"ứng dụng chọn đúng cách nối"*; thứ THẬT SỰ cô lập là VỊ TỪ RLS. Thêm nữa, chính `hardening.always.sql` ghi *"HÌNH DẠNG THỨ TƯ — policy AS RESTRICTIVE — KHÔNG cần dòng nào"* trong danh sách ngoại lệ, tức nó đã chừa sẵn chỗ cho cách này. Nên: policy `AS RESTRICTIVE` đọc `app.guest_session_id`, cộng vào policy sẵn có bằng phép HỘI, không chạm một dòng nào của đường người mua. **MẶC ĐỊNH LÀ TỪ CHỐI** — mọi bảng có RLS đều mang một policy `<bảng>_khach`, và bảng nào không thuộc bảy bảng của mặt khách thì vị từ của nó đóng hoàn toàn; một lớp canh suy từ `pg_class.relrowsecurity` bắt bảng TIẾP THEO phải được quyết định. Đo bằng HAI nhà cung cấp trên CÙNG một RFQ, có đối chứng dương (khách đọc được của chính mình) và một mũi đột biến ĐỎ THẬT. **MỘT THIẾT KẾ CỦA TÔI ĐÃ BỊ BỘ TEST BÁC BỎ, và nó đổi hình dạng của lời giải:** bản đầu để chính vị từ policy TRA `guest_sessions` để lấy lời mời. Nó đỏ ở năm test của đường mở thầu với `permission denied for table guest_sessions` — vì Postgres kiểm quyền trên MỌI bảng trong kế hoạch, KHÔNG theo kiểu ngắn mạch của `OR`, nên mọi role đọc `vendor_bid_versions` sẽ phải có `SELECT` trên `guest_sessions`, kể cả `app_unseal` vốn không bao giờ gắn phiên khách. Ba đường ra được cân; đường đã chọn là GUC THỨ HAI (`app.guest_invitation_id`) mà `withGuestSession()` DẪN XUẤT từ chính hàng phiên — và nhân đó thêm một phép kiểm không có ở bản đầu: một phiên đã THU HỒI hay HẾT HẠN không gắn được, đo bằng `clock_timestamp()` chứ không `now()`. `withGuestSession()` gắn GUC và KHẲNG ĐỊNH nó có hiệu lực — fail-open trong im lặng là hướng hỏng duy nhất không chấp nhận được ở đây. **HAI PHẦN CHÊNH ĐÃ GHI VÀO §4 CỦA MA TRẬN:** bảo đảm chỉ đứng KHI kết nối đã gắn phiên khách (không có tầng HTTP nào để cưỡng chế việc gắn ấy), và vế *"gián tiếp qua thời gian phản hồi"* vẫn là một phép đo T6 chưa ai chạy. Role `app_guest` ở lại sổ nợ như một lớp phòng thủ chiều sâu ở tầng GRANT, với lý do đo được ở trên. Nguyên văn: Hình dạng đúng vẫn là `app_guest` + policy theo `current_setting('app.guest_session_id')`, và bản thân RLS thì rẻ hơn tưởng: **policy `AS RESTRICTIVE ... TO app_guest`** cộng vào các policy sẵn có mà KHÔNG chạm một dòng nào của `app_api`/`app_unseal` — tức *"nó chạm mọi bảng"* không còn là vế chặn. Vế chặn THẬT nằm chỗ khác, và đọc mã mới thấy: một role thứ ba phải được `hardening.always.sql` cưỡng chế lại thuộc tính ở MỌI lần `migrate()` (nếu không, một `ALTER ROLE app_guest BYPASSRLS` sau triển khai sẽ sống mãi — và một `app_guest` có `BYPASSRLS` là ĐÚNG NGƯỢC LẠI thứ A5 cần), mà file ấy liệt kê role theo TÊN ở ba chỗ: tạo role, ghim thuộc tính, và bước gỡ membership vốn hẹp xuống ĐÚNG hai cặp `app_*_login → app_*`. Sửa file 1600 dòng chịu lực nhất kho, trong cùng một lượt với sáu khoản nợ khác, là đúng thứ chính khoản nợ này cảnh báo — *"trộn vào một hạng mục sẽ làm cả hai khó xem xét"*. Nó cần một hạng mục riêng, có buổi `security-reviewer` riêng. Nguyên văn giữ lại: **A5 KHÔNG được cưỡng chế ở tầng CSDL, và khoảng trống ấy là một QUYẾT ĐỊNH bị hoãn chứ không phải một thiếu sót.** Phiên khách chạy dưới cùng role `app_api` và cùng `app.org_id` của tổ chức người mua (010), nên RLS cô lập TỔ CHỨC chứ không cô lập nhà cung cấp với nhà cung cấp. Phần CSDL làm được đã làm: một phiên khách KHÔNG GHI được vào luồng báo giá của người khác (trigger `bid_kiem_phien_khach`, 018, có test). Phần nó không làm được: chặn một câu `SELECT` đọc sang luồng khác, và khoảng trống ấy là một QUYẾT ĐỊNH bị hoãn chứ không phải một thiếu sót.** Phiên khách chạy dưới **cùng role `app_api`** và **cùng `app.org_id`** của tổ chức người mua (010), nên RLS cô lập **tổ chức** chứ không cô lập **nhà cung cấp với nhà cung cấp**. Phần CSDL làm được đã làm: một phiên khách **không GHI được** vào luồng báo giá của người khác (trigger `bid_kiem_phien_khach`, 018, có test). Phần nó **không** làm được: chặn một câu `SELECT` đọc sang luồng khác — hôm nay đó là kỷ luật của tầng ứng dụng. Hình dạng đúng để đóng: một role `app_guest` với policy theo `current_setting('app.guest_session_id')`. Không làm ở S1.5 vì nó chạm mọi bảng và trộn vào một hạng mục sẽ làm cả hai khó xem xét | `db/migrations/018_vendor_bids.sql` khối A5; `docs/TEST-PLAN.md` mã A5 |
| 30 | **[NỬA]** **ĐÃ ĐÓNG NỬA ĐƯỜNG, VÀ NỬA CÒN LẠI CÓ TÊN [2026-09-05].** `apps/public-keys` ra đời: `node:http` trần (không thêm một phụ thuộc sản xuất nào), CHỈ ĐỌC, phục vụ `/.well-known/trustprocure-receipt-keys` và tra theo `kid`. Khoản nợ nói *"thứ thiếu là ĐƯỜNG"* — đường ấy nay có, và một nhà cung cấp viết được script kiểm chữ ký mà không phải hỏi ai. Thứ nó **KHÔNG** đóng, và không được đọc thành đã đóng: **tính ĐỘC LẬP**. Một endpoint do chính chúng ta phục vụ vẫn là *"hỏi chúng ta"*, chỉ nhanh hơn — một máy chủ bị chiếm phục vụ được khoá khác và mọi biên nhận giả sẽ kiểm chứng SẠCH. Thứ đóng nốt là một NEO NGOÀI, và `fingerprint` (SHA-256 của SPKI) trong mỗi mục tồn tại đúng để đi ra khỏi hệ thống (in vào hợp đồng, đọc qua điện thoại). **Đây là cùng một khoản nợ với số 11** — ~~cơ chế có, artefact neo ngoài thì chưa~~. **[S1.17] KHOẢN NỢ 11 ĐÃ ĐÓNG, VÀ NỬA NÀY THÌ KHÔNG — hai thứ khác nhau, đừng đọc gộp.** Artefact neo ngoài cho SỔ KIỂM TOÁN đã có (ADR-026). Thứ còn thiếu ở đây là một artefact neo ngoài cho chính KHOÁ CÔNG KHAI — của biên nhận, và nay của cả mốc neo: kiểm toán viên phải lấy được vòng khoá công khai qua một đường KHÁC đường lấy artefact, nếu không thì kẻ chiếm được cả hai phục vụ một cặp khớp nhau. Không dòng mã nào sinh ra được thứ đó — nó là một `fingerprint` in vào hợp đồng, đọc qua điện thoại, đăng ở nơi ta không kiểm soát. Vòng S1.17 làm cho nó trở thành thứ DUY NHẤT còn lại của khoản nợ này. Vế chịu lực của bộ test là một vế PHỦ ĐỊNH suy từ tính chất: không phản hồi nào của bất kỳ đường nào mang một byte nào của khoá RIÊNG, dò dưới cả `base64`/`hex`/`base64url`, kèm một đối chứng chứng minh chính phép dò ấy bắt được một lần rò rỉ dựng sẵn. Nguyên văn: ~~**Khoá công khai ký biên nhận chưa được CÔNG BỐ ở đâu cả.**~~ `ReceiptSigningKeyRing.publicKeys()` trả về nửa công khai theo `kid`, và biên nhận mang `kid` trong chính văn bản đã ký — tức **cấu trúc** đã đủ. Thứ thiếu là **đường**: một endpoint HTTP trả khoá theo `kid`, và `apps/` vẫn rỗng. Hệ quả hôm nay: nhà cung cấp lấy khoá công khai bằng cách **hỏi chính chúng ta**, nên vế *"kiểm chứng độc lập"* của B2 mới đúng một nửa. Đây là phần chênh đã khai báo ở §4 của ma trận, và nó là khoản nợ mà **S1.9/T5** phải trả | `packages/bidding/src/signer.ts`; `tools/inv-matrix/src/danh-gia.ts` (`PHAM_VI_HEP` mục `B2`) |
| 31 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-05] bằng `023_rfq_open_cancel_permissions.sql` cộng hai lời gọi `requirePermission`.** `rfq.open` và `rfq.cancel` nay có trong danh mục và chỉ `PROCUREMENT_MANAGER` giữ — `BUYER` soạn được và mời được nhưng không tự mở được gói thầu mình soạn, và `DIRECTOR` (vai phê duyệt mở thầu) cố ý không được cấp. Bốn phép đo mới, kèm một lượt đột biến gỡ cả hai cổng làm cả bốn ĐỎ. Hai mốc ghim của D3 phải viết lại vì chúng đọc DUY NHẤT văn bản `005` — nay đọc **mọi** `NNN_*.sql` theo tính chất, nên một migration tương lai tự rơi vào phạm vi. Nguyên văn khoản nợ: ~~**Không phép kiểm quyền nào trên `openRfq` và `cancelRfq` — và từ vựng để viết nó KHÔNG TỒN TẠI.**~~ Cả hai hàm xác lập *ai* (`resolveSessionActor`) và *tổ chức nào* (`assertTenantBound`) rồi làm việc, không hỏi *người ấy có được phép không*. Hệ quả: bất kỳ phiên hợp lệ nào của tổ chức — kể cả một vai không có một quyền RFQ nào — mở được RFQ và đúc khoá cho nó, hoặc huỷ RFQ (thứ thu hồi TOÀN BỘ vật liệu khoá của nó, không đảo ngược được: 017 cấm bỏ dấu thu hồi, và worker lọc `revoked_at IS NULL`). Tức một phiên không đặc quyền làm cho báo giá của một RFQ VĨNH VIỄN không mở được bằng một lời gọi. Đây KHÔNG phải khoảng trống *"tầng ứng dụng chưa có"*: `packages/unseal` cùng nhánh GỌI `requirePermission` bên trong gói. Thứ chặn là `permissions.ts` chỉ có `RFQ_CREATE`/`RFQ_APPROVE`/`RFQ_INVITE`/`RFQ_UNSEAL` — **không có `rfq.open`, không có `rfq.cancel`** — nên câu gọi ấy hôm nay không viết ra được. Đóng đúng: thêm hai mã quyền vào `permissions.ts` VÀ vào 005 (meta-test giữ hai bên đồng bộ), rồi gọi `requirePermission` ở đầu hai hàm — KHÔNG đặt phép kiểm bên trong `issueRfqKeyPair`/`revokeRfqKeyMaterial`, vì trigger đã buộc chúng vào cạnh chuyển trạng thái; quyền thuộc về CẠNH | `packages/rfq/src/rfq.ts` (`openRfq`, `cancelRfq`); `packages/identity/src/permissions.ts` |
| 32 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-05].** Mọi `UnsealDeniedError` nay ghi `UNSEAL_DENIED` mang tên vế, ở một giao dịch ĐỘC LẬP — và có test dựng đúng ca rollback của người gọi để chứng minh bản ghi sống qua nó. Một lần THỬ vi phạm D2 ghi `UNSEAL_APPROVAL_DENIED`; phân loại theo THÔNG BÁO chứ không theo SQLSTATE, và đó là một thu hẹp đã ghi tại chỗ (hai trigger dùng chung `check_violation`). Nguyên văn: ~~**D5 chỉ đúng cho vế 1 của cổng mở thầu; ba vế còn lại từ chối trong IM LẶNG.**~~ `requirePermission` ghi `PERMISSION_DENIED` ở một giao dịch độc lập, nên vế `PERMISSION` thoả D5. `MFA_FRESH`, `RFQ_CLOSED` và cả hai nhánh `POLICY_GATE` ném `UnsealDeniedError` mà **không ghi gì**. Nặng hơn: một lần tự-phê-duyệt bị `unseal_kiem_nguoi_duyet` chặn làm ROLLBACK cả giao dịch của `approveUnseal` — **kể cả bản ghi `UNSEAL_APPROVED`** — nên một lần THỬ vi phạm D2 không để lại một dấu vết nào. Một người trong tổ chức dò *"RFQ đóng chưa / phê duyệt về chưa"* bằng cách gọi `dispatchUnseal` liên tục sinh ra **con số không** bản ghi. Đóng đúng: ghi một sự kiện từ chối ở giao dịch ĐỘC LẬP cho mỗi `UnsealDeniedError`, mang `clause`, không mang `reason`; và bắt hai lỗi trigger của D2 theo SQLSTATE rồi ghi ngoài giao dịch | `packages/unseal/src/gate.ts`, `packages/unseal/src/requests.ts` |
| 33 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-05].** `CUA_GOI` nay có `unseal` và `bidding`, và bảng phân loại nở từ ba rổ lên SÁU: thêm `HAM_DOC_CO_QUYEN` (đọc mà vẫn phải có cổng), `HAM_THUAN_TUY`, `HAM_TU_LA_CONG`. Rổ thứ nhất KHÔNG phải một nhãn — một test đọc MÃ NGUỒN từng hàm và đòi thân nó thật sự gọi `requirePermission`; để phép đọc ấy thấy được, lời gọi phải nằm THẲNG trong thân hàm chứ không trong một helper dùng chung, và `comparison.ts` đã được viết lại theo đúng ràng buộc ấy. Nguyên văn: ~~**Lớp canh cổng quyền tự làm mù mình đúng ở hai gói mới nhất và nhạy nhất.**~~ `tests/architecture/cong-quyen-route.test.ts` giữ `CUA_GOI` gồm `supplier`, `rfq`, `invitation` — **không có `unseal`, không có `bidding`**. Tức `requestUnseal`/`approveUnseal`/`cancelUnseal`/`dispatchUnseal` (toàn bộ phê duyệt kép của việc lộ mọi giá trong một RFQ) cộng `buildComparisonTable`/`countReceivedBids`/`submitBid` đều **không bị lớp ấy nhìn thấy**. Một module `apps/api` tương lai gọi `approveUnseal` mà quên dòng quyền sẽ đi qua sạch sẽ. Đây đúng khuôn lỗi mà chính file ấy dựng lớp thứ hai để chặn (nợ 3 và 16), và nó tái diễn ở lần thứ ba. Đóng đúng: thêm hai gói vào `CUA_GOI`, và **không** xếp hai hàm đọc của S1.7 vào rổ `HAM_CHI_DOC` — rổ ấy biện minh bằng *"không đổi trạng thái"*, câu ấy sai với một hàm mà mục đích duy nhất là kiểm soát TIẾT LỘ | `tests/architecture/cong-quyen-route.test.ts` |
| 34 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-05]** bằng `apps/unseal-worker/src/composition.ts` cộng migration `025`. Hai `kind` nay có handler; `onJobFailure` là THAM SỐ BẮT BUỘC nên một composition root không còn diễn đạt được cấu hình *"hỏng trong im lặng"*; `BreakGlassAlertSink` phải tiêm vào và KHÔNG có mặc định — một mặc định *"ghi log cho có"* là đúng thứ làm người ta tưởng cảnh báo đã tới tay ai đó. Cộng một lớp chống-mù suy từ TÍNH CHẤT: mọi `kind` được enqueue trong kho phải HOẶC có handler, HOẶC nằm trong `KIND_KHONG_NHAN` kèm lý do. Nguyên văn: ~~**Cảnh báo break-glass được PHÁT nhưng KHÔNG AI NHẬN.**~~ Không handler nào đăng ký `BREAK_GLASS_UNSEAL_ALERT` và không tiến trình nào `LISTEN` trong sản phẩm — `grep` toàn kho chỉ ra hai chỗ: chính migration 019 và một test. Tệ hơn *"chưa nối"*: `JobRunner` ghi một job không có handler thẳng sang `FAILED` với lý do `NO_HANDLER`, và `onJobFailure` **mặc định im lặng**. Nên hôm nay cảnh báo mức cao được tạo ra rồi bị đánh dấu chết, không một tiếng động. D4 nói *"không bao giờ im lặng"*; vế ấy đúng ở tầng SINH, sai ở tầng GIAO. Phải nối TRƯỚC khi đường break-glass được dùng thật | `db/migrations/019_unseal.sql` mục (5); `packages/outbox/src/runner.ts` |
| 35 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-05].** Bucket đích tách làm hai: `DEST` khoá theo (LỜI MỜI, ĐÍCH) — hạn mức thật, không xuyên qua lời mời được nữa — và `DEST_ORG` theo đích toàn tổ chức, một TRẦN CHI PHÍ đặt ở 20 để ba lời gọi không vũ khí hoá được. Mọi bucket nay được tăng TRƯỚC mọi phán quyết, nên việc một lần từ chối vẫn tiêu ngân sách là một QUYẾT ĐỊNH đã ghi ra chứ không một tác dụng phụ. Test đo đúng kịch bản ADR-015 §5 đặt tên. Nguyên văn: ~~**Hạn mức OTP theo ĐÍCH đang KHOÁ chứ không LÀM CHẬM.**~~ ADR-015 §5 viết rõ *"chỉ được làm chậm, không được khoá, vì khoá theo đích cho phép một người khoá lối vào của người khác"*. Bản cài đặt từ chối thẳng (`DEST_RATE_LIMITED`), và khoá bucket là `HMAC(pepper, orgId ‖ "DEST" ‖ đích)` — **không mang lời mời, không mang RFQ**. Nên ba lần phát cho một số điện thoại ở RFQ-1 làm chính nhà cung cấp ấy không nhận được OTP cho RFQ-2 trong 15 phút. Thứ tự cũng sai: hai bucket `CALLER` và `INVITATION` được tăng TRƯỚC phép kiểm `DEST`, nên một lần bị chặn vẫn tiêu ngân sách của lời mời | `packages/invitation/src/invitation.ts` (`issueOtpChallenge`) |
| 36 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-05].** ⑴ `verifyOtpAndStartSession` nay KHẲNG ĐỊNH nó đang ở trong một giao dịch — và phép đo ấy đã phải viết lại một lần: bản đầu so `statement_timestamp()` với `now()` và **đỏ giả trên một test hợp lệ**, vì hai mốc ấy trùng nhau ở độ phân giải micro giây. Bản hiện tại dùng `SET LOCAL` rồi đọc lại ở câu sau — nhị phân, không phụ thuộc đồng hồ. ⑵ Phép so `token_hash` — phép so credential chịu lực duy nhất của cả lát cắt — nay ghim `OPERATOR(pg_catalog.=)` và `::pg_catalog.bytea`, với một test đọc thẳng mã nguồn. Nguyên văn: ~~**Hai khoản nợ về cách viết SQL trong `packages/invitation`.**~~ ⑴ Cổng OTP đọc trạng thái ở MỘT câu (`FOR UPDATE`) rồi tăng bộ đếm ở câu KHÁC; nó chỉ tuần tự hoá đúng khi người gọi đang ở trong một giao dịch — điều `withTenant` hôm nay bảo đảm nhưng **không lớp nào cưỡng chế**, và chú thích tại chỗ đang nói mạnh hơn thứ mã làm được. ⑵ Gói này dùng `=` trần ở **mọi** vị từ, kể cả phép so `token_hash` — phép so chịu lực duy nhất của cả lát cắt — trong khi `audit`/`identity`/`outbox` ghim `OPERATOR(pg_catalog.=)` **127 lần** vì một lần chiếm `search_path` đã được TÁI LẬP END-TO-END và lật được một phán quyết an ninh | `packages/invitation/src/invitation.ts` |
| 37 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-05].** `UNIQUE (org_id, rfq_id, supplier_id)` đổi thành chỉ mục duy nhất BỘ PHẬN `WHERE revoked_at IS NULL`, nên mời lại được sau khi thu hồi — mà vế gốc *"một nhà cung cấp được mời ĐÚNG MỘT LẦN cho mỗi RFQ"* vẫn nguyên, có test riêng. `clearOtpLockout` là đường ra của khoá cấp-lời-mời: có mã quyền `invitation.unlock`, có audit, và một trigger của `024` cấm `failed_attempts` GIẢM — gỡ khoá là một hành vi, không phải một lần xoá dấu vết. Nguyên văn: ~~**Thu hồi lời mời là VĨNH VIỄN, và khoá theo lời mời không có đường mở.**~~ `rfq_invitations` mang `UNIQUE (org_id, rfq_id, supplier_id)` **không có vị từ bộ phận loại `REVOKED`**, nên một lần bấm nhầm loại một nhà cung cấp khỏi RFQ ấy mãi mãi. Cùng lúc, khoá cấp-lời-mời của 012 chặn MỌI lần phát thách thức mới khi còn một thách thức đang khoá — nên ai cầm một link đã chuyển tiếp giữ được nhà cung cấp thật ở ngoài vô hạn (5 lần sai → khoá 900 giây → lặp), và không có hàm nào gỡ khoá. Cả hai là đường CHẶN NGƯỜI KHÁC DỰ THẦU, cùng họ với nợ 35 | `db/migrations/010_invitations.sql:52`; `db/migrations/012_invitation_hardening.sql` |
| 38 | **[ĐÓNG]** ~~**[S1.10.7, review M-1/M-7] `/auth/link` còn ORACLE THỜI GIAN** — nhánh có người dùng làm INSERT + gửi, nhánh không thì một SELECT rồi về; gửi mail/SMS nay ở SAU COMMIT (không đổi mã trạng thái, không giữ pool) nhưng RTT hai nhánh vẫn khác. Đóng đúng cách: đặt job outbox cho MỌI email (kể cả không tồn tại) và phát token trong handler outbox. Cùng dòng: bọc/mở bí mật TOTP (KMS) vẫn chạy TRONG giao dịch; pool `app_api` chưa có `statement_timeout`/`idle_in_transaction_session_timeout`~~ **ĐÓNG 2026-09-07 (S1.12, ADR-022)** — `/auth/link` chỉ `enqueueJob(LOGIN_LINK_SEND, {email})` — MỘT INSERT cho mọi email; handler outbox (tiến trình `api`, `outbox-api.ts`) tra người dùng, phát token, gửi; đo: ba email (có/lạ/đình chỉ) để lại đúng ba job và KHÔNG token nào trước khi runner chạy. Cùng dòng: `statementTimeoutMs` ở `createPool`; trần 5 s cho hai adapter KMS (`co-han.ts`) — chúng vẫn chạy trong giao dịch (ADR-022 §1) | `apps/api/src/routes/auth.ts`, `apps/api/src/dispatch.ts` (afterCommit) |
| 39 | **[ĐÓNG]** ~~**[review M-2] Không có bucket theo NGƯỜI GỌI cho `/auth/link`, `/auth/redeem`, `/auth/totp`** — chỉ hạn mức theo người dùng (5 token/15 phút). ADR-020 từng hứa `LOGIN_DEST` trên `otp_rate_limits`; câu ấy đã sửa cho đúng thứ đang có. Cần bucket `CALLER` (IP) ⇒ 429 — và nó phụ thuộc nợ 41~~ **ĐÓNG 2026-09-07 (S1.12, ADR-022)** — migration `038` (`LOGIN_CALLER`); dispatcher đếm trong giao dịch RIÊNG trước handler (token sai vẫn bị đếm — đo: 30 lần 422 rồi 429), 429 + `Retry-After`; trần link 10 / redeem 30 / totp 30 mỗi 15 phút; đối chứng bảng route bỏ `callerLimit` ⇒ không bao giờ 429 | `packages/identity/src/login.ts` |
| 40 | **[ĐÓNG]** ~~**[review M-5] Không có đường QUẢN TRỊ đặt lại TOTP** — người mất bí mật đã xác nhận không có lối vào; ghi danh lại chỉ cho hồ sơ CHƯA xác nhận. Cần một route hai người duyệt + audit~~ **ĐÓNG 2026-09-07 (S1.12, ADR-022)** — migration `040` + `user.mfa_reset` (PM, DIRECTOR) + `mfa-reset.ts` + hai route; CHECK người duyệt ≠ người yêu cầu và phiên khác; hồ sơ TOTP bị XOÁ (không sửa) chỉ khi CSDL thấy yêu cầu đã duyệt chưa tiêu thụ (trigger BEFORE DELETE); mọi phiên thu hồi; ba đột biến (gỡ trigger xoá, gỡ hai CHECK, hết hạn) đều RED thật | `apps/api/src/routes/auth.ts` |
| 41 | **[ĐÓNG]** ~~**[review M-8] `remoteAddressOf` là một hook, chưa có cài đặt đọc `X-Forwarded-For` theo CIDR tin cậy** — chừng nào chưa có, api KHÔNG được đặt sau proxy/LB (ADR-020 ghi); nếu đặt, bucket `CALLER` của OTP thành hạn mức toàn tổ chức~~ **ĐÓNG 2026-09-07 (S1.12, ADR-022)** — `apps/api/src/dia-chi.ts` (`net.BlockList`): `X-Forwarded-For` chỉ được đọc khi socket ∈ `TRUSTPROCURE_TRUSTED_PROXIES`, đi từ phải sang trái bỏ hop proxy; header giả/hỏng ⇒ socket; đo qua `sessions.ip` | `apps/api/src/server.ts` |
| 42 | **[ĐÓNG]** ~~**[review L-2] Cookie phiên chưa dùng tiền tố `__Host-`; cookie trùng tên lấy giá trị ĐẦU** — một subdomain anh em bị chiếm ném cookie được (login CSRF). Đổi tên cookie là đổi hợp đồng với client — làm khi có client thật~~ **ĐÓNG 2026-09-07 (S1.12, ADR-022)** — `__Host-tp_session` / `__Host-tp_guest` (Secure, `Path=/`, không `Domain`); `docCookie` gặp tên lặp thì BỎ tên ấy ⇒ 401 | `apps/api/src/routes/auth.ts`, `apps/api/src/routes/anon.ts`, `apps/api/src/router.ts` |
| 43 | **[ĐÓNG]** ~~**[review M-4] Vế CSDL của "phiên chỉ ra đời sau một lần TOTP đúng" chưa có** — trigger 029 chỉ đòi `mfa_verified_at`; bằng chứng TOTP nay là KIỂU (`MfaProof`), không phải hàng trong CSDL. Làm được bằng trigger đòi `mfa_credentials.last_used_counter` gần đây, nhưng phải đổi cách tám phép đo lược đồ 006 chèn `sessions` (dưới superuser thay vì `app_api`)~~ **ĐÓNG 2026-09-07 (S1.12, ADR-022)** — migration `039`: trigger AFTER INSERT `sessions` (đường ứng dụng, 037) đòi hồ sơ TOTP đã xác nhận có `last_used_counter` trong 3 bước 30 s — bốn phép đo 006 dưới `app_api` dùng người MỚI có hồ sơ tươi (không chuyển sang superuser); gỡ trigger ⇒ bộ đếm cũ đi lọt | `db/migrations/031_ghi_danh_lai_totp.sql` (khối đầu), `packages/identity/src/login.ts` |
| 44 | **[ĐÓNG]** ~~**[review lượt 2, H2-2] `PROCUREMENT_MANAGER` giữ cả `policy.manage` lẫn `rfq.create`** — người đặt ngưỡng đặt được ước lượng, nên D2 hạ xuống MỘT phê duyệt bằng một PM + một người duyệt. Câu biện minh sai ở 030 đã gạch; §4 của D2 ghi phần chênh. **QUYẾT ĐỊNH ĐANG CHỜ:** tách vai, hay mở rộng trigger D3 cấm một vai giữ cả hai~~ **ĐÓNG 2026-09-06 (chốt: cả hai)** — migration `033`: `policy.manage` chuyển sang `FINANCE`; hai trigger mới cấm `policy.manage` đứng cùng `rfq.create`/`rfq.approve` ở một vai VÀ ở một người (hợp các vai); ba bản của danh sách loại trừ khoá bằng meta-test; hai đột biến gỡ trigger ⇒ đi lọt. Hệ quả: khe hở [A3b] hẹp lại (BUYER không tự gán FINANCE được nữa), ca [C1] đổi sang REQUESTER+DIRECTOR | `db/migrations/033_policy_manage_khong_cung_tay.sql`, `packages/identity/src/permissions.ts` |
| 45 | **[ĐÓNG]** ~~**[review lượt 2, H2-3] Vế CSDL của "`version` chính sách không ghim được tổ chức"**~~ **ĐÓNG 2026-09-06 (PR #7)** — migration `035` thay thân trigger 022: `version` phải BẰNG đúng lớn nhất + 1 (giá trị kỳ vọng, không chọn được, không ghim được); test: 2147483647 / max+2 / max lặp ⇒ 23514, max+1 đi qua; gỡ trigger ⇒ 2147483647 đi vào. Nguyên văn cũ: [review lượt 2, H2-3] Vế CSDL của "`version` chính sách không ghim được tổ chức" — tầng HTTP nay đòi `version` = hiện hành + 1 (giá trị kỳ vọng, chống đua), nhưng một `app_api` bị chiếm vẫn INSERT được `version = 2147483647` và trigger 022 ("phải lớn hơn") + không UPDATE/DELETE ghim tổ chức vĩnh viễn. Đóng đúng: trigger tự gán `version = max + 1`, hoặc `CHECK (version < 1000000)` phòng hờ | `db/migrations/022_security_review_s1.sql` (khối `chinh_sach_phien_ban_tang_dan`) |
| 46 | **[ĐÓNG]** ~~**[review lượt 2, H2-9 ⑵] Không ràng buộc CSDL nào nói `contact ∈ supplier` cho lời mời**~~ **ĐÓNG 2026-09-06 (PR #7)** — migration `036`: UNIQUE `(org_id, supplier_id, id)` trên `supplier_contacts` + khoá ngoại tổ hợp trên `rfq_invitations`; test: contact của Y dưới danh nghĩa X ⇒ 23503 nêu đúng tên ràng buộc, cặp đúng đi qua; gỡ khoá ngoại ⇒ lời mời lệch đi vào. Nguyên văn cũ: [review lượt 2, H2-9 ⑵] Không ràng buộc CSDL nào nói `contact ∈ supplier` cho lời mời — `rfq_invitations` chỉ có FK `(org_id, contact_id)`; route nay kiểm TRƯỚC khi tạo, nhưng gọi `createInvitation` từ nơi khác (job, route tương lai) với contact của NCC khác thì link tới người của Y mà đơn thầu mang danh X. Cần FK tổ hợp `(org_id, supplier_id, contact_id) → supplier_contacts (org_id, supplier_id, id)` | `db/migrations/010_invitations.sql`, `packages/invitation/src/invitation.ts` |
| 47 | **[ĐÓNG]** ~~**[review lượt 2, H2-11 ⑵⑶] Quét H17 chứng minh "KHÔNG quyền ⇒ 403", không chứng minh mã quyền ĐÚNG**~~ **ĐÓNG 2026-09-06 (PR #6)** — vòng quét "mỗi route ghi × mỗi mã quyền ĐƠN LẺ": chỉ đúng `route.permission` qua cổng, mọi mã khác 403, đếm chéo bằng sổ kiểm toán, tự sinh từ `ROUTES` × `PERMISSIONS` ("mọi quyền trừ một" bất khả thi vì D3/033 cấm gom quyền — phép đo tương đương, trigger-an-toàn); lớp canh tĩnh nay cấm cả ĐỊNH DANH `requirePermission`/`withTenant`/`withGuestSession` ngoài dispatch.ts (bí danh cũng bị bắt). Nguyên văn cũ: [review lượt 2, H2-11 ⑵⑶] Quét H17 chứng minh "KHÔNG quyền ⇒ 403", không chứng minh mã quyền ĐÚNG — `/rfqs/:id/approve` gán nhầm `RFQ_CREATE` vẫn xanh; chỉ ba route được đo chéo ở test vòng đời. Cần vòng quét "mọi quyền TRỪ `route.permission` ⇒ 403" tự sinh từ `ROUTES`. Cùng dòng: lớp canh tĩnh `\brequirePermission\s*\(` bị `const rp = requirePermission` qua mặt (ADR-016 §4 đã tự nhận) | `apps/api/src/buyer.int.test.ts`, `apps/api/src/routes.test.ts` |
| 48 | **[ĐÓNG]** ~~**[review lượt 2, H2-12] `resolveSessionActor` (đường gói, trigger 013) KHÔNG xét `users.status`, và đình chỉ KHÔNG thu hồi phiên**~~ **ĐÓNG 2026-09-06 (PR #6)** — migration `034`: trigger `users_thu_hoi_phien_khi_dinh_chi` thu hồi mọi phiên còn sống trong cùng giao dịch (kích hoạt lại không mở lại; chạy được dưới `app_api` qua RLS); `resolveSessionActor` nối `users.status = 'ACTIVE'`; test `dinh-chi.int.test.ts` với đột biến gỡ trigger. Dự đoán "bộ test identity bật/tắt SUSPENDED phải sửa trước" hoá ra KHÔNG cần: không test nào dùng lại phiên sau lần đình chỉ. Nguyên văn cũ: [review lượt 2, H2-12] `resolveSessionActor` (đường gói, trigger 013) KHÔNG xét `users.status`, và đình chỉ KHÔNG thu hồi phiên — đường HTTP chặn (L-1, JOIN `users.status`); đường gói không; người bị đình chỉ rồi kích hoạt lại thì mọi phiên cũ còn TTL sống lại. Cần trigger `AFTER UPDATE OF status ON users` thu hồi phiên trong cùng giao dịch + `u.status = 'ACTIVE'` ở `resolveSessionActor` — nhưng bộ test identity bật/tắt `SUSPENDED` nhiều lần trên cùng phiên, phải sửa test trước | `packages/identity/src/session-actor.ts`, `db/migrations/006_sessions_and_mfa.sql` |
| 50 | **[ĐÓNG]** ~~**[S1.11] Hai trigger 029/032 điều kiện theo `current_user = 'app_api'`, còn tiến trình thật đăng nhập bằng `app_api_login` (INHERIT) — quên `SET ROLE` là cả hai IM LẶNG**~~ **MỞ VÀ ĐÓNG CÙNG VÒNG (2026-09-06, ADR-021)** — đo được trước khi đóng: `app_api_login` không `SET ROLE` chèn được `sessions` thiếu MFA và thay được bí mật TOTP đã xác nhận, trong khi mọi test xanh (chúng chạy dưới `poolAs`, có `SET ROLE`). Đóng hai lớp: migration `037` (vị từ `la_duong_ung_dung('app_api')` = kế thừa quyền + không superuser, thay vào hai thân trigger) và `createPool(..., { role: "app_api" })` (`SET ROLE` + kiểm `current_user` mỗi lần lấy client — một bản dùng chung với `poolAs`). Đột biến trả vị từ về tên cũ ⇒ cả hai câu đi lọt. NOINHERIT cho role đăng nhập bị loại có lý do (ADR-021 §3c) | `db/migrations/037_vai_ung_dung_la_thanh_vien.sql`, `packages/db/src/vai-tro.ts` |
| 49 | **[ĐÓNG]** ~~**[review lượt 2, H2-4 ⑶ + bộ dò] Bộ quét rò rỉ gọi route GHI với thân `{}`** — chúng dừng ở 422 trước nghiệp vụ, nên vòng quét chứng minh cho route đọc nhiều hơn route ghi; và bộ dò là `includes` chuỗi thập phân đã biết (giá viết `980,000,000`, `9.8e8`, base64, thứ tự xếp hạng đi lọt). Cần gọi route ghi với thân HỢP LỆ trên một RFQ hy sinh, và bộ dò theo giá trị số (mọi cách viết)~~ **ĐÓNG 2026-09-07 (S1.12, ADR-022)** — bộ quét gọi mọi route ghi với thân HỢP LỆ trên hai RFQ hy sinh (0 route dừng ở 422 hình dạng, ≥ 10 route tới 2xx); bộ dò theo GIÁ TRỊ (mọi cách viết + base64) với đối chứng dương từng dạng. Vẫn không bắt rò THỨ TỰ — §4 của A2 | `apps/unseal-worker/src/kich-ban-41-http.int.test.ts` |
| 51 | **[ĐÓNG]** ~~**[review lượt 4, H4-7] Thân BỐN hàm trigger mới chưa được hardening ghim** — `sessions_kiem_totp_gan_day` (039), `mfa_credentials_xoa_can_yeu_cau` + `mfa_reset_kiem_quyen` (040), `outbox_jobs_xoa_payload_dang_nhap` (041), và máy trạng thái `mfa_reset_kiem_chuyen_trang_thai` (040, VÔ ĐIỀU KIỆN — không đi qua điểm đơn `la_duong_ung_dung`). Một `CREATE OR REPLACE` sau triển khai làm chúng no-op và sống qua `migrate()` — đúng ca R3 đã đo. Cần ghim thân + `tgenabled='A'` theo khuôn `user_roles_phan_tach_nhiem_vu`, và mở rộng đột biến 037↔039/040 ở `vai-tro.int.test.ts`~~ **ĐÓNG 2026-09-07 (S1.13, ADR-023)** — ~~năm~~ tám mục hardening theo khuôn `la_duong_ung_dung` với tiền điều kiện "migration nguồn đã áp dụng" [H5-2]: thân chuẩn hoá + thuộc tính hàm + `pg_get_triggerdef` + `tgenabled='A'` cho `sessions_kiem_totp_gan_day`, `mfa_reset_kiem_quyen` (2 trigger + 2 trigger danh tính [H5-5]), `mfa_reset_kiem_chuyen_trang_thai`, `mfa_credentials_xoa_can_yeu_cau`, `outbox_jobs_xoa_payload_dang_nhap`, và [H5-5] `kiem_danh_tinh_theo_phien` (013), `sessions_kiem_mfa_khi_tao`, `mfa_credentials_khoa_ho_so_da_xac_nhan` (037); test đồng bộ tám thân + test trôi kể cả `DROP … CASCADE` (đỏ thật trước khi thêm mục và với tiền điều kiện cũ) | `db/migrations/hardening.always.sql` |
| 52 | **[ĐÓNG]** ~~**[review lượt 4, H4-4/H4-5] Hạn mức theo người gọi: chưa có trần TOÀN TỔ CHỨC cho `/auth/link`** (IPv6 gom /64 rồi vẫn xoay được /56); tổ chức LẠ không bị đếm (hai giao dịch lỗi mỗi lời gọi — cần một bucket ngoài CSDL vì không có khoá ngoại), và 429 là oracle tồn tại tổ chức (chấp nhận, nói ra: `orgId` UUIDv4); bucket theo người gọi chưa áp cho `/guest/redeem`, `/guest/otp/verify` (ADR-022 "Không hứa")~~ **ĐÓNG 2026-09-07 (S1.13, ADR-023)** — `orgLimit` (bucket `route\|to-chuc`, `/auth/link` 300/15 phút); `BucketBoNho` cho tổ chức lạ (cùng trần, fail-closed khi đầy ~~⇒ oracle H4-5 đóng~~ [H5-3] oracle còn, đổi dạng — nợ 55); `callerLimit` 30 cho `/guest/redeem`, `/guest/otp/verify`. [H5-1] `orgLimit` LÀM CHẬM, không khoá, và chỉ cộng khi người gọi chưa vượt trần riêng. Vẫn theo tiến trình (nhiều instance = nhiều bộ đếm — ADR-022) | `apps/api/src/dispatch.ts`, `apps/api/src/routes/auth.ts` |
| 53 | **[ĐÓNG]** ~~**[review lượt 4, H4-10] Bộ gửi chạy TRONG giao dịch của job `LOGIN_LINK_SEND`** — `send` xong mà kết cục không ghi được (mất lease, COMMIT hỏng) ⇒ email đã đi mang token bị rollback (link chết), rồi email thứ hai (at-least-once). Nay chỉ có trần 5 s riêng cho `send`. Khi có bộ gửi thật: tách gửi khỏi giao dịch (ghi token + commit, gửi, đánh dấu) hoặc pool riêng nhỏ cho runner~~ **ĐÓNG 2026-09-07 (S1.13, ADR-023)** — `JobHandler` trả về `SauCommit`; runner chạy nó sau khi DONE đã commit và kết nối đã huỷ, có trần; ném/treo ⇒ `AFTER_COMMIT_FAILED`, job vẫn DONE, không thử lại (at-most-once cho phần gửi — nói ra ở ADR-023 §1). Handler `LOGIN_LINK_SEND` trả về hàm gửi: token commit trước, gửi sau | `apps/api/src/outbox-api.ts` |
| 54 | **[ĐÓNG]** ~~**[review lượt 5, H5-5] Danh sách ghim thân hàm trigger ở hardening vẫn VIẾT TAY** — 48 hàm `RETURNS trigger` trong `public`, ghim 8 (S1.13) + hai của D3 + `chan_sua_xoa`; 21 trigger của `kiem_danh_tinh_theo_phien` (013) chưa ghim định nghĩa. Cần một test "mọi hàm trigger trong `public` có mặt trong danh sách ghim (hoặc trong danh sách loại trừ có lý do)" để danh sách không tự làm mù mình lần thứ ba~~ **ĐÓNG 2026-09-07 (S1.14, ADR-024)** — test ĐẦY ĐỦ ở `db/migrations.int.test.ts`: tập hàm `RETURNS trigger` trong `public` = (hàm hardening có canh, đọc THẲNG từ `hardening.always.sql`) ∪ (35 mục loại trừ, mỗi mục một dòng nói nó canh gì), hai tập rời nhau — thêm một hàm trigger mới mà không khai là ĐỎ (đo bằng migration tạm). Ghim thêm định nghĩa 19 trigger danh tính của `kiem_danh_tinh_theo_phien` (rải bảy migration, `tgenabled='O'`). Loại trừ = CHƯA ghim, không phải không cần ghim — sổ nợ 56 | `db/migrations/hardening.always.sql`, `db/migrations.int.test.ts` |
| 55 | **[ĐÓNG]** ~~**[review lượt 5, H5-3] Oracle tồn tại tổ chức qua 429 (H4-5) vẫn còn, đổi dạng** — bucket bộ nhớ (tổ chức lạ) và bucket CSDL (tổ chức thật) là hai bộ đếm rời: mồi N lần vào một UUID giả rồi gửi UUID ứng viên ⇒ 429 = lạ, 200 = thật, MỘT lời gọi. Chấp nhận (UUIDv4 không vét cạn được); đóng thật cần một bảng bucket người gọi KHÔNG khoá ngoại tới `organizations`, tổ chức thật hay lạ đếm cùng hàng~~ **ĐÓNG 2026-09-07 (S1.14, ADR-024)** — migration `042`: bảng `caller_rate_limits` không `org_id`, không khoá ngoại ⇒ tổ chức thật và tổ chức lạ tăng CÙNG MỘT HÀNG (429 hết là oracle); `BucketBoNho` của nợ 52 bị xoá; bộ dọn nền 5 phút xoá cửa sổ cũ hơn hai cửa sổ; policy DUY NHẤT là 'mọi hàng, trừ phiên khách'. Bucket toàn tổ chức ở lại `otp_rate_limits` — phần chênh còn lại là THỜI GIAN của một giao dịch lỗi khoá ngoại | `apps/api/src/dispatch.ts`, ~~`apps/api/src/bucket-bo-nho.ts`~~ (tệp ấy bị XOÁ trong chính vòng S1.14 mà dòng này ghi là đã đóng — con trỏ chết từ ngày nó được viết) |
| 56 | **[ĐÓNG]** ~~**[S1.14 / nợ 54] 35 hàm `RETURNS trigger` còn lại CHƯA được hardening ghim thân** — danh sách có tên và có lý do ở `HAM_TRIGGER_KHONG_GHIM` (`db/migrations.int.test.ts`), và test đầy đủ của nợ 54 giữ cho nó không lớn thêm trong im lặng. Cả 35 thuộc cùng lớp trôi R3 (một `CREATE OR REPLACE FUNCTION … RETURN NEW` sau triển khai sống qua `migrate()`). Thứ tự đóng nên theo "app_api ghi được bảng nó canh không": nhóm RFQ/unseal/bid trước (máy trạng thái, D2, append-only), nhóm còn lại sau~~ **ĐÓNG 2026-09-07 (S1.15, ADR-025)** — ghim nốt 35 hàm, 41 trigger, cùng khuôn khối S1.13; `HAM_TRIGGER_KHONG_GHIM` nay **RỖNG** và phép kiểm đổi từ "hai tập phủ nhau" sang "tập ghim BẰNG tập thật" (thêm một dòng loại trừ là MỞ LẠI khoản nợ này). Không đóng theo nhóm như dự kiến — ghim cả 35 cùng lúc vì bản ghim đọc THẲNG từ CSDL nên chia nhóm chỉ thêm việc. Ba lớp mới đi kèm: ⑴ migration ghi trong mỗi mục phải là migration CUỐI CÙNG định nghĩa hàm (bảy hàm được `CREATE OR REPLACE` nhiều lần — ghim nhầm bản cũ làm `migrate()` LÙI hàm ở MỌI lần chạy, và test đồng bộ KHÔNG thấy); ⑵ `045` nâng 37 trigger còn lại lên `ENABLE ALWAYS` ⇒ 80/80 là `'A'`, có phép kiểm suy từ tính chất; ⑶ [H7-1] tập trigger của MỌI hàm đã ghim phải bằng đúng tập đã khai | `db/migrations/hardening.always.sql`, `db/migrations.int.test.ts` |
| 57 | **[ĐÓNG]** ~~**[review lượt 6, H6-5 ⑵] `otp_rate_limits` không có bộ dọn** — bảng chỉ lớn lên: một hàng cho mỗi đích, mỗi lời mời, mỗi người gọi, mỗi cửa sổ; `GRANT DELETE` có từ 010 nhưng chưa ai gọi. Ba đường đã xét, đường nào cũng vướng~~ **ĐÓNG 2026-09-07 (S1.15, ADR-025)** — đường THỨ TƯ: migration `044` thêm một policy `FOR DELETE TO app_api` chỉ có hiệu lực trên kết nối CHƯA gắn tổ chức và chỉ trên hàng đã quá SÀN 30 phút. Ba đường cũ vẫn đúng như đã ghi; đường này không hỏi "tổ chức nào" mà hỏi "hàng này còn chặn được ai". Bộ dọn **xoá được mà KHÔNG đọc được** (`FOR DELETE`, không `FOR ALL` ⇒ `[INV-F1]` còn đúng nguyên văn), nên câu dọn KHÔNG có `WHERE`: PostgreSQL đòi policy SELECT ngay khi câu lệnh tham chiếu cột — đã đo, `WHERE` ⇒ 0 hàng, câu trần ⇒ xoá đúng hàng quá sàn. Hai cửa ngoại lệ có tên được mở (`NGOAI_LE_HINH_DANG` dòng ĐẦU TIÊN sau ba vòng rỗng, `NGOAI_LE_LAC_CHO`), mỗi cửa một meta-test | `packages/invitation/src/invitation.ts`, `apps/api/src/composition.ts` |
| 58 | **[ĐÓNG]** ~~**[S1.15 / review H7-3] Bộ dọn `otp_rate_limits` quét TOÀN BẢNG mỗi năm phút** — và không sửa được bằng một chỉ số: vế lọc là OR của hai policy trên hai cột, nên bộ lập lịch chọn Seq Scan kể cả khi ước lượng của nó là `rows=1`~~ **ĐÓNG 2026-09-07 (S1.16, migration `046`) — bằng cách BÁC BỎ TIỀN ĐỀ CỦA CHÍNH NÓ.** Phép đo của H7-3 có thật; chế độ của nó thì không đại diện: **95% hàng đã quá sàn**, nơi Seq Scan là tối ưu THẬT, nên kết luận *"không chỉ số nào phục vụ được"* là một suy diễn quá phạm vi. Đo lại ở chế độ của một bảng ĐANG CHẠY (200 000 hàng, **1%** quá sàn): PostgreSQL dựng `BitmapOr` từ `otp_rate_limits_pkey` (vế `org_id = <GUC>`) và `otp_rate_limits_window_idx` (vế `window_start < mốc`) — **1,07 ms** so với **37,96 ms**, tức **35 lần**, và chi phí đi theo SỐ HÀNG PHẢI XOÁ chứ không theo KÍCH THƯỚC BẢNG. `046` dựng lại chỉ số mà H7-3 đã gỡ; `db/otp-don-ke-hoach.int.test.ts` canh kế hoạch, có ĐỐI CHỨNG DƯƠNG (gỡ chỉ số ⇒ quay về Seq Scan). Bài học đắt hơn bản vá: **một phép đo ở MỘT chế độ không phải một kết luận cho MỌI chế độ** — và lần này chính lớp "đo trước khi tin" của dự án lại là thứ sinh ra lời khai sai | `packages/invitation/src/invitation.ts`, `db/migrations/044_don_bucket_otp.sql` |
| 59 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-08, S1.25] bằng một KHOÁ LIÊN TIẾN TRÌNH.** Mọi lời gọi `depcruise` đọc cây nguồn đi qua `tests/architecture/khoa-depcruise.ts`, và ở `routes.test.ts` khoá bao **trọn vòng đời của probe** (tạo → quét → xoá) chứ không chỉ bao lượt quét: probe nằm trên đĩa thật, nên chỉ cần nó TỒN TẠI trong lúc lượt quét toàn kho chạy là đủ. **Không chọn đường loại trừ theo tên** (`zprobe-*`): nó đóng được đua tranh nhưng đổi lại cổng sản xuất thôi nhìn một lớp tệp mà chỉ một quy ước đặt tên giữ cho trống — ADR-033 §2⑴. **Hai phép đo, không một lời khai:** ⓐ mũi đo dùng **hai tiến trình thật**, vế *"không khoá"* chạy TRƯỚC (không chồng lấn ở vế ấy nghĩa là máy không dựng nổi đua tranh và vế kia rỗng ruột) — kết quả: không khoá ⇒ chồng lấn, có khoá ⇒ không, tổng ≥ 2× thời gian giữ; ⓑ chạy lại **đúng bối cảnh từng đỏ** (lượt gộp `pnpm evidence`) và `boundaries.test.ts` XANH. **Cái này KHÔNG đóng câu *"lượt gộp hết đỏ"*** — chính lượt ấy còn một test khác đỏ vì một cơ chế khác hẳn: khoản nợ **66**. Nguyên văn: ~~**[S1.19] Khẳng định *"mã nguồn hiện tại không vi phạm quy tắc nào"* KHÔNG HERMETIC.**~~ `apps/api/src/routes.test.ts` viết một probe thật vào `apps/api/src/routes/` rồi chạy `depcruise`; `tests/architecture/boundaries.test.ts` chạy `pnpm run depcruise` trên TOÀN kho. Hai tệp khác nhau ⇒ vitest chạy song song ⇒ lượt quét toàn kho nhìn thấy probe của tệp kia. **Quan sát được LẶP LẠI trong lượt gộp `pnpm evidence` (chạy cả hai tầng trong một tiến trình), và CHƯA LẦN NÀO trong lượt `pnpm test` đơn tầng** — chênh lệch khớp với cơ chế: lượt gộp có nhiều tệp chạy song song hơn nên cửa sổ chồng lấn rộng hơn. | `apps/api/src/routes.test.ts`, `tests/architecture/boundaries.test.ts` |
| 60 | **[ĐÓNG]** **[S1.20] Tập hàm canh chỉ-ghi-thêm suy từ HÌNH DẠNG THÂN HÀM, không từ ngữ nghĩa.** Vị từ của H19 hỏi *`prosrc` có chứa `RETURN` không* — một phép so khớp VĂN BẢN trên thân hàm. Nó chặt hơn một danh sách tên và có một phản ví dụ thật giữ cho nó không lỏng (`rfq_items_chan_truncate` cùng hình dạng thân nhưng là trigger TRUNCATE cấp câu lệnh, nên vế *cả UPDATE lẫn DELETE, cấp HÀNG* loại nó ra). Nhưng một hàm canh viết theo kiểu khác — ví dụ `IF … THEN RAISE … END IF; RETURN NULL;` — sẽ **rơi khỏi tập** và bảng của nó thôi được canh, trong im lặng. Hôm nay hai cách đếm TRÙNG NHAU — đã đo: vị từ hình dạng và phép liệt kê theo TÊN HAI HÀM canh (`chan_sua_xoa`, `bid_chi_ghi_them`) cho ra CÙNG năm bảng. Nên đây là một khoảng trống đã ĐO chứ chưa phải một lỗ đang mở. **[S1.29] ĐÓNG, và không bằng cách NỚI vị từ — nới thế nào cũng lại là một hình dạng.** Đo trên PostgreSQL 16: tập RỘNG (mọi hàm `plpgsql` trả `trigger`, gắn `BEFORE … FOR EACH ROW` trên `UPDATE` hoặc `DELETE`) có **23 hàm**; vị từ hình dạng nhận **2**, tức **21 hàm đi qua nó mà không lớp nào nói gì**. Bản vá là một **TỔNG ĐIỀU TRA**: mỗi hàm trong tập rộng phải nằm trong ĐÚNG MỘT trong hai danh sách (`HAM_CANH_CHI_GHI_THEM` / `HAM_KHONG_PHAI_CANH`). Một hàm canh mới viết theo BẤT KỲ kiểu nào rơi ra ngoài cả hai ⇒ đỏ, và cách duy nhất làm nó xanh là trả lời câu *"đây có phải hàm canh chỉ-ghi-thêm không"* thành một dòng nhìn thấy được. ~~**Cổng đóng cả chiều ngược:** … và ngược lại.~~ **[lượt soi 19 bác, bác đúng — và đây là lỗi nặng nhất của vòng]:** bản đầu lấy vị từ HÌNH DẠNG làm nguồn sự thật, nên một hàm canh kiểu `IF … RAISE … END IF; RETURN NULL;` — chính kiểu khoản nợ này nêu tên — khai THẬT vào `HAM_CANH` thì **đỏ** (mâu thuẫn với hình dạng), khai SAI vào `KHONG_PHAI_CANH` thì **xanh** và bảng của nó **không được H19 canh**: cổng thưởng lời khai sai. Đo trên PostgreSQL thật, 1/3 và 0/3 người phản bác bác được. **Bản đóng cuối:** vị từ bảng chỉ-ghi-thêm = **hình dạng ∪ khai báo** (`p.prosrc` không `RETURN` HOẶC `p.proname` có trong `HAM_CANH_CHI_GHI_THEM`), dựng từ danh sách TS và phải khớp NGUYÊN VĂN `hardening.always.sql` ở cả ba chỗ (vị từ, và chốt TRUNCATE) nên **sản xuất** canh nó chứ không chỉ test; kiểm mâu thuẫn chỉ còn **một chiều** (không-`RETURN` ⇒ phải là CANH — hướng suy được); tổng điều tra định danh theo `lược đồ.tên` và coi trigger canh **bị TẮT** là vi phạm. Phép đo mới trên PostgreSQL thật: hàm `RETURN NULL` vào tập rộng với `khong_tra_ve=false`, UPDATE/DELETE đều NÉM (nó LÀ hàm canh), chưa khai ⇒ bảng ngoài tập, khai ⇒ bảng **vào tập** — thân hàm giữ nguyên. **Thứ KHÔNG đóng:** ⑴ tổng điều tra chỉ phủ đường TRIGGER — khoản nợ **73**; ⑵ khai SAI một hàm canh có `RETURN` là KHÔNG-CANH thì không phép kiểm văn bản nào bắt — khoản nợ **74** | `db/hardening-suy-tu-tinh-chat.int.test.ts`, `db/migrations/hardening.always.sql`, `docs/DECISIONS.md` ADR-028 §6, ADR-035 |
| 61 | **[ĐÓNG]** **[S1.21] `Handoff.md` KHÔNG được `[INV-H20]` phủ — và nó là tệp ĐẦU TIÊN người tiếp theo đọc.** Đo ở vòng này: §10 khai *"22 khoản"* trong khi sổ có **61**; danh sách *"năm khoản nặng nhất"* có **BỐN** đã đóng (nợ 11, 1, 17, 16) và hai dòng *"còn mở từ vòng CI"* cũng đã đóng; §6 *"Cái CHƯA có"* — mục tự mở đầu bằng *"đây là phần dễ hiểu sai nhất"* — có **BA** gạch đầu dòng đầu tiên đều sai (*"`apps/` RỖNG"*, *"`apps/unseal-worker` CHƯA TỒN TẠI"*, *"ma trận báo 24/47"*). Tất cả đã sửa **BẰNG TAY** ở vòng này, tức chúng sẽ trôi lại. ~~Chưa phủ vì tệp ấy là VĂN XUÔI CÓ ĐÁNH SỐ, không phải bảng — ép một hình dạng máy đọc được lên nó là một vòng riêng~~ **[S1.28] ĐÓNG, và KHÔNG bằng cách ép hình dạng lên tệp.** Vòng này bắt đầu bằng cách hiển nhiên — quét mọi đường dẫn trong đấu huyền như P4 làm — và **đo được rằng cách ấy SAI**: 121 con trỏ chưa gạch, 38 *"không giải được"*, và **36 trong 38 không phải lỗi** (tên gói và tên team như `@trustprocure/bao-mat` — một team mà chính câu ấy nói CHƯA TỒN TẠI; đường HTTP `/auth/link`; chuỗi phiên bản `Chrome/151.0.7922.200`; một mẫu glob đang được TRÍCH; một QUY ƯỚC ĐẶT TÊN `src/index.ts`; và một tệp mà câu văn nói thẳng là **không vào git**). Một phép kiểm sai 36 lần ở lượt chạy đầu không phải một phép kiểm: cách duy nhất làm nó xanh là một danh sách miễn trừ dài bằng chính danh sách phát hiện. **Đọc lại P4 thì thấy nó chưa bao giờ quét văn xuôi — nó đọc CỘT CON TRỎ của bảng sổ nợ, một VỊ TRÍ ĐÃ KHAI.** Nên bản đóng là: ⑴ ba lời khai của `Handoff.md` vốn là **bản sao của ba con số `[INV-H20]` ĐÃ suy ra được** nay được đọc bằng CHÍNH các hàm ấy (chỉ tham số hoá cái nhãn, không viết lại phép kiểm); ⑵ hai lời khai riêng của tệp — số migration đánh số, số gói + số công cụ — suy từ `git ls-files`; ⑶ cột tài liệu của §13, vị trí đã khai duy nhất, chịu đúng phép kiểm của P4. **Đo trên `Handoff.md` nguyên bản ở `0a3cc6b`: 6 vi phạm** — ADR khai 18 / thật 34; bất biến khai 47 (34+13) / thật 55 (34+21); nợ khai 61 khoản 14 mở / thật 71 khoản 14 mở; **hai lời khai VẮNG MẶT** (fail-closed bắt được cả sự vắng mặt); và con trỏ `docs/superpowers/specs/2026-08-26-…-design.md` chết vì một dấu lược `…`. Phần văn xuôi khẳng định TỒN TẠI/VẮNG MẶT thì vẫn ngoài tầm — khoản nợ **72**, đọc ở đó, đừng đọc gộp vào đây | `Handoff.md`, `tests/architecture/so-no-tu-doi-chieu.test.ts`, `docs/DECISIONS.md` ADR-029 §4 |
| 62 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-08, S1.24] — VÀ CON SỐ 80 VỠ RA LÀM BA KHI ĐO LẠI.** **9** trong 80 **không phải SQL** (thông báo lỗi tiếng Việt mở đầu bằng `INSERT`; bộ đọc chỉ đòi chuỗi *bắt đầu* bằng một từ khoá), **8** câu **không có gì để ghim** (`SET lock_timeout = 0`, `SET ROLE $1`, `SELECT current_user`), việc thật là **63** câu trên 12 tệp — tất cả đã ghim đủ bốn trục. Con số *"39 chạm bảng nhạy cảm"* cũng đếm trên tập 80 ấy, nên nó cũng rộng hơn thực tế. Cả ba con số do CHÍNH lớp canh sinh ra ở S1.22 rồi được chép vào đây mà không ai đo lại — đúng hình dạng ADR-029, lần này ở một chỗ đắt hơn: một khoản nợ định nghĩa quy mô của một vòng chưa làm. `[INV-H21]` nay **gỡ** phép lọc `daGhim` và mốc `TRAN_TOI_DA`: chủ thể là **MỌI câu**. Chín thông báo được sửa ở CHỖ GỌI chứ không nới bộ đọc (ADR-032 §3⑵). Xem ADR-032. Nguyên văn: ~~**[S1.22] 80 câu SQL trong mã sản xuất chưa ghim MỘT TRỤC NÀO, và `[INV-H21]` chỉ GIỮ con số ấy chứ không hạ nó.**~~ Chủ thể của H21 là câu ĐÃ ghim một trục; câu chưa ghim gì thì chỉ có một mốc `TRAN_TOI_DA` để cái lỗ không lớn thêm — một câu SQL mới viết trần làm test ĐỎ. Đo được: trong 80 câu ấy, **39 chạm bảng nhạy cảm** (xác thực, phân quyền, RLS, mở thầu). Bảy câu nặng nhất đã được ghim ngay trong vòng này theo review lượt 14 (H14-5); phần còn lại cần một cuộc di trú có nhịp, và nó là một vòng riêng chứ không phải một dòng thêm vào vòng này (khoản nợ 29: *"trộn vào một hạng mục sẽ làm cả hai khó xem xét"*) | `tests/architecture/qt3-ghim-schema.test.ts` (`TRAN_TOI_DA`), `docs/DECISIONS.md` ADR-030 §5 |
| 63 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-09, S1.27] — VÀ KHÔNG BẰNG CÁCH MÀ CHÍNH KHOẢN NỢ NÀY ĐỀ RA.** Sổ nợ viết cách đóng là `UNIQUE (org_id, lower(email))`. Đo cạnh nhau hai đường trên PostgreSQL 16 cho thấy đường ấy **YẾU HƠN**: nó chặn được **cặp** `Alice@corp.com` + `alice@corp.com`, nhưng `Alice@corp.com` **đứng một mình thì vẫn vào** (đo được: `INSERT 0 1`) — tức chữ hoa vẫn cất được. ~~và bất biến *"một email một người dùng"* vẫn phụ thuộc vào việc không ai chèn biến thể thứ hai~~ **[lượt soi đối kháng bác câu vừa gạch, và bác đúng: dưới (a), chèn biến thể thứ hai CHÍNH LÀ thứ bị từ chối]**. `048` dùng **`CHECK (email = lower(email))`** cộng `UNIQUE (org_id, email)` SẴN CÓ: chữ hoa **ASCII** thành **bất khả**, nên cặp ASCII ấy không dựng lên được nữa và ca đứng-một-mình đóng theo. **NHƯNG BẢN ĐẦU CỦA VÒNG NÀY KHAI LÀ *"chữ hoa bất khả"*, VÀ LƯỢT SOI ĐỐI KHÁNG BÁC CÂU ẤY BẰNG MỘT PHÉP ĐO — CÂU ẤY SAI, VÀ SAI VÀO ĐÚNG ĐƯỜNG ĐĂNG NHẬP.** `.toLowerCase()` của JS hạ **1488** điểm mã; `lower()` của PostgreSQL trên `postgres:16-alpine` (đúng ảnh `startPostgres()` ghim) hạ **1364**. Phần chênh là những điểm mã **bất động với hàm của máy chủ** — nên chúng ĐI QUA `CHECK` — mà JS vẫn hạ (đo được: `U+24B6` Ⓐ, `U+1C8A` Ᲊ). Với một địa chỉ như thế, `issueLoginToken` dựng khoá bằng hàm JS còn hàng đã lưu là điểm bất động của hàm PostgreSQL ⇒ `WHERE lower(email) = $1` trả **0 hàng**, người ấy **không bao giờ nhận được magic link** dù gõ đúng nguyên văn địa chỉ — và `/auth/link` luôn trả cùng một 200 nên **không ai nhìn thấy**. Một cửa khoá câm vĩnh viễn, và nó là thứ bản vá đầu TẠO RA chứ không phải thứ nó thừa hưởng. **Thứ đóng được điều đó không phải siết `CHECK`, mà là bỏ hẳn MỘT trong hai định nghĩa:** `login.ts` thôi gọi `.toLowerCase()`, và câu truy vấn hạ chữ thường **cả hai vế** bằng `pg_catalog.lower()`. Khi ấy vị từ tương đương `email = lower($1)` và `UNIQUE (org_id, email)` bảo đảm **nhiều nhất MỘT hàng khớp** — tức đúng tính chất khoản nợ này gọi tên (*"`rows[0]` là hàng nào thì KHÔNG XÁC ĐỊNH"*). Đo hai chiều: cách cũ ⇒ **0** hàng, cách này ⇒ **1**. **Dư lượng, nói thẳng:** hai địa chỉ TRÔNG GIỐNG NHAU vẫn cùng tồn tại được nếu cả hai là điểm bất động của hàm máy chủ (đo được: `ασ@corp.com` và `ας@corp.com` vào chung một tổ chức) — phép TRA vẫn tất định nên lỗ của khoản này đã đóng, phần còn lại là khoản nợ **71**. **Ba lý do nữa, xếp theo sức nặng:** ⑴ ~~chỉ mục trên `lower()` phụ thuộc **collation** — một lần nâng ICU/glibc là chỉ mục hỏng ÂM THẦM~~ **[soi lại: lớp lỗi ấy KHÔNG mới — mọi btree trên `text` của lược đồ này đã phụ thuộc collation, `users_org_id_email_key` gồm cả; và btree ĐI XUỐNG bằng thứ tự collation nên vế *"so byte vẫn đứng"* cũng chỉ đúng cho phép SO SÁNH, không cho phép TRA. Phát biểu đúng mức: (a) thêm MỘT chỉ mục nữa vào tập đã phụ thuộc ấy, và là chỉ mục nằm TRÊN đường tra cứu — một khác biệt về ĐỘ, không phải về LOẠI]**; ⑵ đường kia tạo **chỉ mục BIỂU THỨC đầu tiên của kho**, làm `[INV-H14]` đỏ **đúng thiết kế** (*"ngày có cái đầu tiên, test này đỏ và người viết nó phải quyết định tại chỗ"*) — tức nó kéo theo một vòng sửa bộ dò, còn `CHECK` thì thêm **0 chỉ mục**; ⑶ nó biến một điều đang được **hy vọng** thành một điều được **cưỡng chế** — `packages/supplier` hạ chữ thường trước khi ghi và tự viết ra lý do, nhưng đó là quy ước của MÃ, và `users` thì **không có đường ghi nào** trong `packages/*/src` để gắn bước ấy vào. Câu `ALTER` quét toàn bảng ngay nên nó TRẢ LỜI được *"có hàng nào vi phạm không"*; cố ý **không** `NOT VALID` — một ràng buộc chưa kiểm là một ràng buộc nói dối về quá khứ. ~~**Câu `ALTER` CHÍNH LÀ lượt đối chiếu dữ liệu** mà khoản nợ đòi … hoặc ĐỔ và in ra đúng hàng vi phạm~~ **[đo lại: SAI]** — `ALTER TABLE ADD CONSTRAINT` chỉ in `is violated by some row`, **không** có `DETAIL` và **không** gọi tên hàng; dòng `DETAIL: Failing row contains (...)` chỉ có ở `INSERT`/`UPDATE` (đã đo cạnh nhau). Nên nó **không thay được** lượt đối chiếu: người vận hành vẫn phải tự chạy `SELECT ... WHERE email <> lower(email)`. **Bốn mũi đột biến, bốn lượt đỏ đúng chỗ** (đối chứng 7/7 xanh trước mỗi mũi): migration rỗng ⇒ đỏ 3/7; `CHECK` rỗng ruột (`email = email`) ⇒ đỏ 3/7; `NOT VALID` ⇒ đỏ **đúng 1/7** ở khẳng định `convalidated`; và `UNIQUE` toàn cục thay cho theo-tổ-chức ⇒ đỏ 2/7, một ở chiều âm của khoản này và một ở **`[INV-H14]` có sẵn** — tức bộ dò oracle của ADR-013 bắt được độc lập. Nguyên văn: ~~**[S1.22, review lượt 14 H14-6] `users` không có ràng buộc duy nhất trên `lower(email)`, nên một tổ chức MANG ĐƯỢC đồng thời `Alice@corp.com` và `alice@corp.com`.** `UNIQUE (org_id, email)` so NGUYÊN VĂN (`db/migrations/002_organizations_and_users.sql`), còn `issueLoginToken` tra bằng `lower(email)` không `LIMIT` rồi lấy `rows[0]` — tức với một cặp biến thể, hàng nào được chọn là KHÔNG XÁC ĐỊNH. Vế chiếm tài khoản đã đóng trong vòng này: hàm nay trả `u.email` ĐỌC TỪ CSDL thay vì chuỗi người gọi gửi lên, nên magic link luôn đi tới địa chỉ đã đăng ký của chính chủ token. Phần chênh CÒN LẠI: một lời xin có thể trả link cho hàng biến thể khác. Đóng nó cần `UNIQUE (org_id, lower(email))` — một migration cộng một lượt đối chiếu dữ liệu đang có, tức một vòng riêng. **Tiền đề chưa được chứng minh:** không đường cấp phát `users` nào tồn tại trong `packages/*/src`, nên cặp biến thể ấy hôm nay chỉ dựng được từ ngoài sản phẩm~~ | `packages/identity/src/login.ts`, ~~`db/migrations/002_organizations_and_users.sql`~~ `db/migrations/048_email_nguoi_dung_chu_thuong.sql`, `db/unique-oracle.int.test.ts` |

**BA CÁCH ĐẾM, BA CON SỐ — ĐO NGÀY 2026-09-07, TRƯỚC VÒNG NÀY.** Bảng trên là một cách đếm; câu
*"Sổ nợ mở còn…"* ở cuối mỗi mục *Hành động tiếp theo* là cách thứ hai; phán xét lại từng dòng là
cách thứ ba. Từ mục 27 (S1.12) tới mục 35 (S1.20) câu ấy được viết **tám lần** và khai **năm**
khoản mở; đếm bảng theo DẤU VĂN BẢN cho **mười bốn** dòng không mang dấu đã-đóng; phán xét lại
từng dòng bằng phép đo hôm nay cho **mười ba** (nay **mười bốn** — khoản 61 mở ở chính vòng này).
Không lớp nào bắt được, vì không lớp nào đọc hai khẳng định ấy cùng lúc. Dòng dưới đây là lời khai
DUY NHẤT được `[INV-H20]` đối chiếu với cột trạng thái của bảng, theo **cả hai chiều** (khai thiếu
ĐỎ, khai thừa cũng ĐỎ):

| 64 | **[ĐÓNG]** **[S1.24] `ci.yml` kích hoạt trên `push: branches: [main]`, mà kho KHÔNG CÓ nhánh `main`** (`git ls-remote --heads origin main` trả 0 dòng; nhánh mặc định là `master`). Nên trigger ấy **chưa bao giờ khớp một lần đẩy nào**: toàn bộ CI của kho đến từ `pull_request`, và **không lượt nào từng chạy trên một commit merge**. Vì sao không vô hại dù mọi PR đều được chặn: **commit merge KHÁC đầu nhánh** — hai PR xanh không đụng cùng một dòng vẫn phá nhau được (một hàm đổi chữ ký ở PR A, một chỗ gọi mới ở PR B), và không có lượt chạy trên thân thì không ai bắt được lớp ấy. Phát hiện bằng một con số 0 ở chỗ lẽ ra phải có sáu job: sau khi merge PR #20, `gh api .../actions/runs?head_sha=764c082` trả `total_count 0`. **ĐÃ SỬA cùng vòng** (`branches: [master]`) | `.github/workflows/ci.yml` |
| 65 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-08, S1.25].** Khi tỷ lệ khác 0, `do-lap.yml` mở (hoặc bình luận vào) một **issue** mang con số, **tên tệp đỏ** và link lượt chạy — issue là chỗ rẻ nhất có sẵn trong kho mà một người thật sẽ thấy mà không phải nhớ. Kèm `workflow_dispatch` input **`dot_bien`**: một đường báo động không được kiểm là một đường báo động không tồn tại, nên mũi ấy cộng một lượt đỏ GIẢ để bắt đường báo động chạy khi kho đang xanh. **Đã chạy thật:** `dot_bien=true, so_luot=1` trên nhánh ⇒ lượt CI đỏ ⇒ **issue #22** được mở, mang `Tỷ lệ đỏ: 1/1`, tên tệp tự khai `(mui-dot-bien-khong-phai-test-that)`, link lượt chạy và commit; issue đã được đóng kèm giải thích. Tức cả **quyền `issues: write`** lẫn đường API đều đã chạy một lần thật, không phải suy. Xem ADR-033 §2⑶⑷. Nguyên văn: ~~**[S1.24] MỘT JOB `schedule` FAIL-CLOSED ĐỎ TỪ 2026-09-07 VÀ KHÔNG TỚI TAY AI.**~~ `do-lap.yml` chạy hằng tuần để đo tỷ lệ flaky của tầng tích hợp và **cố ý đỏ** khi tỷ lệ khác 0 — chính tệp ấy viết: *"một job xanh-nhưng-thực-ra-đỏ không sinh chú thích nào và không ai mở log của một job đã xanh"*. Nó đã làm đúng phần của mình: `TỶ LỆ ĐỎ: 2 / 10`. Thứ thiếu là **đường đi của kết quả**: một lượt `schedule` đỏ không gắn với PR nào, không hiện trên trang nào ai mở hằng ngày, và GitHub chỉ gửi thư cho người sở hữu lịch — nên phép đo mà khoản nợ 24 chờ **đã nằm sẵn 22 giờ** trước khi có người tình cờ đọc tới. Fail-closed mà không có người đọc thì chỉ là fail-lặng. Đường đóng có thể: cho job mở một issue khi đỏ, hoặc cho một job của CI đọc kết quả lượt `schedule` gần nhất và đỏ theo, hoặc gửi thông báo ra ngoài | `.github/workflows/do-lap.yml` |
| 66 | **[ĐÓNG]** **ĐÃ ĐÓNG [2026-09-09, S1.26] — VẤN ĐỀ KHÔNG ĐỐI XỨNG NÊN BẢN VÁ CŨNG KHÔNG ĐỐI XỨNG.** Vai *SÀN DƯỚI* của `TRE_TEST_MS` đặt trên một request bị làm chậm CỐ Ý, nên tải chỉ làm nó **lớn hơn** — nó không đỏ oan được bao giờ và nó **ở lại nguyên vẹn**. Chỉ vai *TRẦN TRÊN* bị gỡ. **VÀ KHÔNG THAY BẰNG MỘT NGƯỠNG TƯƠNG ĐỐI:** phản biện đối kháng đo được rằng một hiệu tương đối (`t₃₀₁ − trung vị`) vừa **yếu hơn** sàn tuyệt đối vừa **đỏ oan được**, và biên đỏ oan thật là **80 ms** chứ không phải 720 — vì `BIÊN + đệm = D` theo định nghĩa; một ngưỡng như thế **dựng lại chính khoản nợ 66 ở một chỗ mới, chỉ khó thấy hơn**. Thay vào đó **bỏ đồng hồ đi**: tính chất cần chứng minh cho 300 lượt đầu là *"KHÔNG đi vào nhánh làm chậm"* — một câu hỏi **PHẠM TRÙ**, và nhánh ấy để lại dấu vết trực tiếp (`dispatch.ts`, `console.error(... "qua tran to chuc" ...)`) mà `logLoi` đã bắt sẵn. Đếm dấu vết thì không đỏ oan được, **mạnh hơn** phép đo cũ (bắt cả một throttle bắn với độ trễ **0 ms**, thứ đồng hồ mù hoàn toàn), và đỏ **ngay lượt đầu** với thông điệp gọi tên đúng lượt. **TỰ CHỐNG RỖNG RUỘT:** một khẳng định ÂM sẽ xanh oan nếu ai đổi chuỗi log, nên mỗi test mang một **ĐỐI CHỨNG DƯƠNG trong cùng lượt chạy** — sau vòng lặp, số ấy phải thành ĐÚNG 1. **Bốn mũi đột biến, đối chứng 27/27 xanh trước mỗi mũi:** xoá `console.error` ⇒ ĐỎ ở đúng đối chứng dương; `>` thành `>=` ⇒ ĐỎ *"lần 300"*; xoá `setTimeout` ⇒ ĐỎ ở SÀN. **Mũi thứ tư là cái giá, và nó được ghi ra:** đưa `setTimeout` ra ngoài khối `if` vẫn ĐỎ 4/27 nhưng **bằng HẾT GIỜ** (514 giây thay vì 45) thay vì bằng một thông điệp trong ~1 giây. **Không vá nó bằng một trần TÍCH LUỸ**: 300 lượt dưới đúng lượt tải từng cho ra 1090 ms sẽ chạm bất kỳ trần tích luỹ nào đủ chặt để bắt mũi ấy — tức lại dựng khoản nợ 66 ở chỗ mới. Xem ADR-034 §3. Nguyên văn: ~~**[S1.25] MỘT KHẲNG ĐỊNH THỜI GIAN TUYỆT ĐỐI LÀ MỘT CỔNG ĐỎ GIẢ ĐANG CHỜ.**~~ `apps/api/src/auth.int.test.ts` phân biệt *"được phục vụ ngay"* với *"bị làm chậm"* bằng một hằng số: `TRE_TEST_MS = 800`, và khẳng định mỗi lượt trong 300 lượt đầu phải nhanh hơn ngưỡng ấy. Dưới tải — đúng lượt gộp `pnpm evidence` — một lượt bình thường mất **1090 ms** và cổng đỏ **mà không có gì hỏng**: *"lần 61 phải nhanh: expected 1090 to be less than 800"*. Đây là cùng HỌ với khoản nợ 24 (test nhạy với tải) nhưng KHÁC CƠ CHẾ: không phải vòng đời kết nối dưới tranh chấp Docker, mà là một ngưỡng tuyệt đối đo một tính chất TƯƠNG ĐỐI. Hình dạng đóng đã thấy được: đo lượt bị làm chậm **so với trung vị của chính các lượt nhanh trong cùng lượt chạy** — tính chất cần chứng minh là *"lượt thứ N+1 CHẬM HƠN HẲN"*, không phải *"lượt thứ i nhanh hơn 800 ms"*. Chưa làm: nó là một vòng riêng, và trộn vào vòng của khoản 59 sẽ làm cả hai khó xem xét (khoản nợ 29) | `apps/api/src/auth.int.test.ts:45` (`TRE_TEST_MS`), `:421` |
| 67 | **[ĐÓNG]** **[S1.25, review an ninh lượt 16 M3] `do-lap.yml` để một token mang `issues: write` NẰM CÙNG JOB với `pnpm install` và cả tầng tích hợp.** `permissions:` khai ở mức workflow nên áp cho mọi bước; job chạy `pnpm install --frozen-lockfile` (script vòng đời của CẢ cây phụ thuộc) rồi `pnpm test:int` (23 tệp, container thật). Một phụ thuộc bắc cầu bị chiếm hoặc một `postinstall` typosquat chỉ cần đọc `.git/config` là cầm được một token ghi issue: mở issue mạo danh kho, **sửa bình luận có sẵn trên cả issue lẫn pull request** (API issue comments phục vụ cả PR), đóng issue an ninh đang mở. `contents: read` chặn đường ghi MÃ, nên thiệt hại giới hạn ở **kênh giao tiếp** — nhưng đó đúng là kênh mà cả đội tin, và cũng đúng thứ khoản nợ 65 vừa mua. **Vế rẻ đã làm trong vòng này:** `persist-credentials: false` cho `actions/checkout@v4`, nên token không còn được ghi vào `.git/config`. **Vế còn lại là một cuộc TÁI CẤU TRÚC, nên nó là một vòng riêng:** tách làm hai job — `lap` giữ `permissions: {contents: read}` và chạy mã của kho; `bao-dong` với `needs: lap`, `permissions: {issues: write}`, **không** checkout, **không** `pnpm install`, chỉ gọi `gh` — và khai `permissions` ở mức JOB thay vì mức workflow. Khi ấy không bước nào vừa cầm token ghi vừa chạy mã bên thứ ba. **Chưa đo được từ trong cây nguồn:** mặc định `permissions` của kho — nếu trước đây workflow không có khối ấy thì khối mới có thể là một lần THU HẸP chứ không phải một lần leo thang; đây là rủi ro còn lại, không phải một hồi quy **[S1.62] ĐÓNG — tách hai job, quyền mức job, báo động chạy cả khi `lap` chết trước khi có số đo; test GHIM (bản hai, sau lượt soi 55).** Đo trước khi viết (test viết trước): trên workflow cũ, test hình dạng ĐỎ năm lỗi — quyền mức workflow `contents: read` + `issues: write`; thiếu job `bao-dong`; `lap` không khai quyền mức job, không đưa `so_do` ra outputs, không có bước fail-closed riêng; bản hai của test ĐỎ trên workflow bản một. Câu *chưa đo được từ trong cây nguồn* ở trên nay ĐÃ ĐO qua API: mặc định quyền workflow của kho là `read`, nên khối cũ là một lần NỚI thêm `issues: write`. **Sửa:** `permissions: {}` mức workflow; `lap` chỉ `contents: read`, bước đếm ghi outputs rồi xanh, bước cuối fail-closed làm job ĐỎ; `bao-dong` với `needs: lap`, chạy khi `always()` VÀ (`needs.lap.result` khác `success` HOẶC `so_do` khác `0`), chỉ `issues: write`, không `uses:`, không checkout, không cài đặt, gọi `gh` kèm `GH_REPO`, nhận năm giá trị `*_THO` qua env và kiểm hình dạng TRỌN CHUỖI trước khi dựng thân issue — thiếu số đo thì mở issue KHÔNG HOÀN TẤT; nhãn mũi đột biến lấy từ sự kiện; bộ lọc tác giả `app/github-actions`. **Đo trên runner** (workflow thăm dò riêng, nhánh tạm, không ghi gì — run 34663968157): output của một job ĐỎ tới được job `needs`; `[[ =~ ]]` chặn giá trị nhiều dòng còn `grep -Eqx` để lọt; `gh` không checkout đọc được issue qua `GH_REPO`. **Đo trên API** (chỉ đọc): `author.login` của issue do workflow mở là `app/github-actions`, nên bộ lọc cũ `github-actions` không bao giờ khớp — nhánh bình luận của bản cũ không thể chạy. **Harness** (thân `bao-dong` trên bash thật, `gh` giả): bảy kịch bản ra đúng tiêu đề và nhánh. **Lượt soi đối kháng 55** (0 CAO, 6 NẶNG, 5 NHẸ, 5 INFO): NẶNG-2 — `so_do` vắng thì không báo động (quá hạn, bước đếm hỏng, runner mất sau khi đếm — ca cuối là hồi quy của việc tách) ⇒ `if:` mới cộng nhánh `needs.lap.result` và issue KHÔNG HOÀN TẤT; NẶNG-3 tới NẶNG-6, NHẸ-1 tới NHẸ-3 — test dò mẫu có văn bản hợp lệ đi vòng (job id viết hoa, `env:` mức workflow, `toJSON(needs)`, giá trị thô cùng dòng, bước `- run:`, chú thích giữa dòng) ⇒ bản hai GHIM; NHẸ-4 — nhãn mũi đột biến lấy từ sự kiện, ranh giới nói ra; NHẸ-5, INFO-1, INFO-2 — chú thích sửa; INFO-4 — ĐO bộ lọc tác giả, sửa; INFO-5 — sự kiện ghim; NẶNG-1 — đo một phần (runner, API, harness), lệnh GHI issue dưới quyền mức job chưa đo. Test: `tests/architecture/hinh-dang-do-lap.test.ts` (hai `it`: workflow thật theo lối GHIM — tập khoá, tập sự kiện, tập job, khối quyền, outputs và bước fail-closed của `lap`, nguyên văn thân `bao-dong`; mười bảy đột biến trên chính tệp thật); mười hai đột biến đỏ cô lập qua vitest trên tệp thật ~~(biên bản 77)~~ ([S1.66] §S1.62). **Ranh giới nói ra:** `so_do` do `lap` ghi nên một `lap` bị chiếm vẫn tắt được báo động — khoản này đóng việc CẦM TOKEN GHI, không đóng việc tin kết quả đo; `gh label create`, `gh issue create` và `gh issue comment` dưới `issues: write` mức job chưa đo trên runner — một lượt `dot_bien=true` sẽ đo và mở một issue thật; `lap` quá hạn thì mất số đỏ của các lượt đã xong; token runtime của `lap` vẫn ghi được cache và artifact (có từ trước). | `.github/workflows/do-lap.yml`, `tests/architecture/hinh-dang-do-lap.test.ts` |
| 68 | **[MỞ]** **[S1.26] `pnpm evidence:check` ĐÓNG DẤU XANH CHO 32 019 KÝ TỰ VĂN XUÔI VIẾT TAY MÀ KHÔNG PHÉP ĐO NÀO CHẠM TỚI.** `package.json` định nghĩa `evidence:check` = `pnpm evidence && git diff --exit-code -- evidence/INV-matrix.md`. Phép kiểm ấy chứng minh **bộ sinh là TẤT ĐỊNH** — nó **không** chứng minh các lời khai trong ma trận là ĐÚNG. Đo được: **25** ghi chú (`A1`…`G4`, tổng **32 019** ký tự) là **chuỗi ký tự viết tay** trong `tools/inv-matrix/src/danh-gia.ts`, chép **byte-cho-byte** sang tệp sinh ra. Ô ✅/❌ thì suy từ mã; **văn xuôi thì không** — và văn xuôi mới là chỗ người đọc lấy kết luận. Dự án đã gặp triệu chứng mà chưa gọi tên bệnh: chính ghi chú E3 tự khai *"câu vừa gạch sống thiu chín vòng"*. **Phát hiện trong lúc đóng khoản nợ 2**, và nó suýt làm hỏng chính lượt ấy: nếu tin câu *"chạy `pnpm evidence` là xong"* thì một lời khai đã bị bản vá bác bỏ sẽ đi vào kho **dưới một dấu kiểm màu xanh**. Con trỏ phải sửa là **nguồn sinh**, không phải tệp sinh ra. **Đường đóng có thể:** cho mỗi ghi chú một mốc *đã đối chiếu ở vòng nào* và bắt `[INV-H20]` đọc nó; hoặc rút các lời khai có SỐ ra khỏi văn xuôi và sinh chúng từ phép đo; hoặc chấp nhận và **đổi tên** `evidence:check` thành một cái tên không hứa nhiều hơn thứ nó kiểm | `package.json`, `tools/inv-matrix/src/danh-gia.ts`, `evidence/INV-matrix.md` |
| 69 | **[MỞ]** **[S1.26, review an ninh lượt 17 M-1 + L-5] ĐOẠN GIỮ KHOÁ HÀNG BAO TRỌN MỘT ROUND TRIP MẬT MÃ VÀ MỘT LƯỢT GHI SỔ KIỂM TOÁN.** Bản vá khoản nợ 2 giành khoá hàng ở `CAU_DAT_COC` rồi giữ nó qua `moPhongBiVaSo` **và** qua `appendAuditEvent` tới tận `COMMIT` (vì `withTenant` giữ một giao dịch cho trọn handler). Hai hệ quả đo được: ⑴ mỗi người chờ **ghim một kết nối pool** trong lúc xếp hàng, và vì các request nay TUẦN TỰ HOÁ thay vì chạy song song, thời gian rút cạn pool đi từ ≈ 1× lên ≈ `min(đồng thời, ngưỡng)` lần độ trễ cổng — vòng này chặn trên nó bằng `connectionTimeoutMillis = 20 s` chứ **không bỏ** nó; ⑵ `appendAuditEvent` lấy **khoá advisory theo TỔ CHỨC** bên trong đoạn ấy, nên đoạn giữ khoá hàng dài thêm đúng bằng thời gian chờ chuỗi kiểm toán của cả tổ chức, và nếu nó ném (55P03 / 57014) thì `ROLLBACK` làm **rơi cả bộ đếm, cả khoá, cả bản ghi `MFA_LOCKED`** — kẻ tấn công cũng không nhận được phán quyết nên đây **không** phải đường bỏ qua E3, cái mất là **khả năng quan sát của người vận hành**. **Đường đóng:** commit cọc trong một giao dịch NGẮN riêng (một kết nối thứ hai, đúng khuôn `auditPool` đã có), và ghi `MFA_LOCKED` qua pool kiểm toán độc lập — đúng khuôn `PERMISSION_DENIED` và `MFA_RESET_APPROVAL_DENIED` đang dùng. Cọc vẫn thu TRƯỚC, cổng vẫn có thẩm quyền, trần loạt đầu vẫn là hằng số; chỉ khoá hàng được nhả trước KMS. **Đây là một cuộc tái cấu trúc đường xác thực, nên nó là một vòng riêng** — và nó đổi ngữ nghĩa nguyên tử của sổ kiểm toán, tức cần một quyết định nhìn thấy được | `packages/identity/src/mfa-credentials.ts`, `packages/identity/src/login.ts`, `packages/tenancy/src/with-tenant.ts` |
| 70 | **[ĐÓNG]** **[S1.27] `supplier_contacts.email` CHỈ ĐƯỢC MỘT QUY ƯỚC Ở TẦNG MÃ GIỮ — cùng hình dạng với khoản nợ 63 vừa đóng, ở một bảng khác.** `addSupplierContact` hạ chữ thường TRƯỚC KHI GHI và tự viết ra lý do (*"Không có bước này, `A@x.vn` và `a@x.vn` là HAI hàng khác nhau dưới `UNIQUE (org_id, supplier_id, email)`"*), nhưng lược đồ **không cưỡng chế gì**: một câu `INSERT` viết tay, một đường ghi thứ hai trong tương lai, hay một lần refactor quên bước ấy là đủ. Đo được: hôm nay `addSupplierContact` là đường ghi **DUY NHẤT** trong `packages` và `apps` ngoài tệp test, nên lỗ này **chưa mở ra được từ sản phẩm** — đó là lý do nó là khoản nợ chứ không phải một lỗi. **Khác khoản 63 ở một chỗ quyết định phạm vi:** bảng này CÓ dữ liệu và CÓ đường ghi, nên `ADD CONSTRAINT ... CHECK` ở đây cần một lượt đối chiếu THẬT (và có thể một lượt `UPDATE ... SET email = lower(email)` đi trước), chứ không phải một câu `ALTER` trần như `048`. **Hệ quả nếu để mở:** hai người liên hệ hợp lệ cho cùng một hộp thư ⇒ hai magic link hợp lệ tới cùng địa chỉ (đúng hậu quả mà chú thích ở `suppliers.ts` đã gọi tên ở S1.3) **[S1.61] ĐÓNG — migration, bản hai (sau lượt soi 54).** Đo trước khi viết (test viết trước, PostgreSQL 16): `INSERT` người liên hệ `Solo@corp.com` đứng một mình và `Cap@corp.com` cạnh `cap@corp.com` của cùng nhà cung cấp đều VÀO — lược đồ không chặn gì; thăm dò (Node 24.18, PostgreSQL 16.15 musl, mọi điểm mã): điểm mã máy chủ hạ mà `.toLowerCase()` của JS không hạ 0, chuỗi JS hạ mà máy chủ còn hạ tiếp 0 — `addSupplierContact` không đổi. **Sửa:** `049` — khối DO ĐỐI CHIẾU trước (048 đã đo lượt kiểm của `ALTER … ADD CHECK` chỉ nói CÓ vi phạm, không nói Ở ĐÂU): số hàng chưa ở chữ thường kèm tối đa 20 id, số nhóm sẽ va `UNIQUE (org_id, supplier_id, email)` nếu hạ kèm mọi id của từng nhóm (tối đa 10 nhóm), không in email, KHÔNG tự hạ (đổi đích magic link là quyết định có người chịu và có sự kiện kiểm toán); rồi `CHECK (email = lower(email))` đã kiểm, trong một khối con bắt `check_violation`. **Lượt soi đối kháng 54** (0 CAO, 2 NẶNG, 5 NHẸ, 2 INFO): NẶNG-1 — ở hồ sơ N3 (chủ bảng FORCE có EXECUTE, khoản 102) khối đối chiếu đếm 0; ĐO: lượt kiểm của `ALTER`/`VALIDATE CONSTRAINT` không chịu RLS và vẫn ném 23514 — fail-closed giữ — và test N3 thật trên bản một nhận đúng thông điệp trần ⇒ bản hai ném lại thông báo nêu vai, số hàng vai ấy thấy, `row_security_active` và lối ra; NẶNG-2 — fixture luôn có một cặp va khoá nên bản 'tự hạ hàng không va khoá' lọt ⇒ thêm `it` chỉ một hàng chữ hoa đứng một mình; NHẸ-1, NHẸ-4, NHẸ-5 — thông báo so NGUYÊN VĂN, nhóm va khoá kèm mọi id, quy trình sửa tay ghi ở `049`, 21 hàng ghim giới hạn 20 id; NHẸ-2, NHẸ-3 — vectơ chữ hoa ngoài ASCII tự hiệu chuẩn, test tính chất JS và máy chủ trên CHÍNH môi trường đang chạy (CI chạy Node 22), ranh giới ctype C/POSIX và cặp hoa-thường mà máy chủ không gấp; INFO-1 — đánh đổi phần trước `@` ghi thành quyết định; mang sang ⑶ ⇒ khoản 105 (đo). Test: `db/unique-oracle.int.test.ts` describe `[khoản nợ 70]` (sáu `it`), `db/migrations.int.test.ts` ba `it` `[khoản nợ 70]` (thông báo nguyên văn và sửa tay, một hàng đứng một mình, hồ sơ N3); mười bốn đột biến đỏ cô lập trên bản hai ~~(biên bản 76)~~ ([S1.66] §S1.61). **Ranh giới nói ra:** tập mà ràng buộc gấp là tập của `lower()` máy chủ — ctype C/POSIX chỉ ASCII, 124 cặp hoa-thường trên musl không gấp (khoản 71); glibc chưa đo theo phép thăm dò (test tính chất đo trên môi trường đang chạy); khoá `ACCESS EXCLUSIVE` lúc kiểm; ràng buộc bị gỡ sau deploy thì không lượt nào thấy — khoản 105. | `db/migrations/049_email_lien_he_chu_thuong.sql`, `db/unique-oracle.int.test.ts`, `db/migrations.int.test.ts`, `packages/supplier/src/suppliers.ts` |
| 71 | **[MỞ]** **[S1.27] HAI ĐỊA CHỈ TRÔNG GIỐNG HỆT NHAU VẪN CÙNG TỒN TẠI ĐƯỢC TRONG MỘT TỔ CHỨC** — phần Unicode của kịch bản mà khoản nợ 63 mô tả, tách ra vì nó là một bài toán khác hẳn. `048` làm chữ hoa **ASCII** bất khả, nhưng mọi điểm mã là **điểm bất động của `lower()` trên máy chủ** đều đi qua: đo được, `ασ@corp.com` (U+03C3) và `ας@corp.com` (U+03C2, sigma cuối từ) cùng vào được một tổ chức, và `i̇@corp.com` (U+0069 U+0307) sống cạnh `i@corp.com`. **Thứ ĐÃ đóng và đừng đọc gộp:** phép TRA nay tất định (cả hai vế cùng một hàm + `UNIQUE`), nên `rows[0]` không còn mơ hồ — lỗ của khoản 63 hết. **Thứ CÒN LẠI:** hai NGƯỜI DÙNG khác nhau mang hai địa chỉ mà mắt người không phân biệt được, tức một mặt tấn công lừa đảo nội bộ. **Kèm một ranh giới đo được:** tập giá trị mà cột chấp nhận **phụ thuộc libc của ảnh nền** — `Ⓐlice@corp.com` qua được trên `postgres:16-alpine` (musl) và **bị từ chối** trên `postgres:16` (glibc); 124 điểm mã phân kỳ trên musl, 28 trên glibc. Tính đúng đắn thì không phụ thuộc (hai vế cùng hàm), nhưng *cái gì cất được* thì có. **Đường đóng có thể:** thu hẹp miền giá trị về một tập ký tự mà mọi hàm hạ chữ thường đồng ý (ví dụ ASCII in được) — nó từ chối địa chỉ quốc tế hoá, nên là một **quyết định nhìn thấy được**, tức một ADR chứ không phải một dòng thêm vào; hoặc chuẩn hoá NFC/NFKC trước khi ghi; hoặc chấp nhận và ghi vào mô hình đe doạ **[S1.61, lượt soi 54 NHẸ-3, mang sang ⑴ ⑵] Cùng lớp, nay trên `supplier_contacts` (049):** ⑴ các điểm mã `.toLowerCase()` của JS hạ mà `lower()` của máy chủ KHÔNG hạ (124 trên musl, ví dụ `U+24B6`) là những CẶP HOA-THƯỜNG THẬT mà `CHECK` không gấp — `Ⓐn@x.vn` viết tay qua được cạnh `ⓐn@x.vn` do sản phẩm ghi, không chỉ là confusable; dưới `datctype` C/POSIX `lower()` chỉ gấp ASCII (test tính chất của `[khoản nợ 70]` đỏ khi ấy); ⑵ hộp thư trùng nhau theo cách KHÁC hoa-thường — dấu chấm cuối tên miền, tên miền IDN (đọc, chưa đo); ⑶ `addSupplierContact` kiểm độ dài 320 TRƯỚC khi hạ, mà `.toLowerCase()` làm `İ`, `Ⱥ`, `Ⱦ` tăng từ 2 lên 3 byte (đo bằng Node) — đầu vào sát 320 byte vấp CHECK độ dài của 008 thành lỗi 23514, thân lỗi cố định. | `db/migrations/048_email_nguoi_dung_chu_thuong.sql`, `packages/identity/src/login.ts`, `db/migrations/049_email_lien_he_chu_thuong.sql`, `packages/supplier/src/suppliers.ts` |
| 72 | **[MỞ]** **[S1.28] `Handoff.md` ĐƯỢC PHỦ Ở LỜI KHAI ĐẾM ĐƯỢC, KHÔNG Ở CÂU KHẲNG ĐỊNH SỰ TỒN TẠI** — phần khoản nợ 61 không đóng, tách ra vì nó cần một cơ chế KHÁC chứ không phải một mẫu rộng hơn. `[INV-H20]` nay đọc năm lời khai đếm được và một cột con trỏ của tệp ấy. Nó **không** đọc những câu như *"`apps/` RỖNG"* hay *"`apps/unseal-worker` CHƯA TỒN TẠI"* — đúng ba câu mà S1.21 đo được là SAI ở §6, mục tự mở đầu bằng *"đây là phần dễ hiểu sai nhất"*. Chúng suy ra được (`git ls-files apps/` trả lời cả hai), nhưng chúng là **khẳng định PHỦ ĐỊNH trong văn xuôi tự do**, không phải một lời khai có hình dạng. **Ranh giới đã đo, đừng đoán lại:** quét mọi đấu huyền của tệp cho ra **36 báo nhầm trên 38 phát hiện** — nên đường đóng KHÔNG phải nới mẫu, mà là ⑴ một cú pháp tự khai cho những câu muốn được canh (ví dụ một chú thích HTML mang tên phép đo), hoặc ⑵ dời các câu ấy vào một BẢNG như §13. Cả hai đều đổi cách viết tệp, nên là một quyết định nhìn thấy được | `Handoff.md`, `tests/architecture/so-no-tu-doi-chieu.test.ts` |
| 73 | **[ĐÓNG]** **[S1.29] MỘT BẢNG CÓ THỂ THÀNH CHỈ-GHI-THÊM MÀ KHÔNG QUA MỘT TRIGGER NÀO, VÀ TỔNG ĐIỀU TRA CỦA KHOẢN 60 KHÔNG THẤY ĐƯỜNG ẤY.** Tập rộng của `[INV-H19]` khoá theo `pg_trigger` — mọi hàm `plpgsql` gắn `BEFORE … FOR EACH ROW` trên `UPDATE`/`DELETE`. Một `CREATE RULE … AS ON UPDATE TO t DO INSTEAD NOTHING` cho cùng hiệu lực mà **không tạo trigger nào**, nên bảng ấy không bao giờ vào tổng điều tra. **Đã có một phần lớp, và ranh giới của nó đo được:** `hardening.always.sql` [CR1] canh rule — nhưng **chỉ trên hai bảng sổ** (*"trên bảng sổ, chỉ sáu trigger được phép và không rule nào được phép"*); ba bảng chỉ-ghi-thêm của S1 (`bid_receipts`, `rfq_unsealed_bids`, `vendor_bid_versions`) chỉ được PHÁN XÉT chứ không tự chữa, và **vòng này KHÔNG đo xem lớp rule có với tới chúng không** — đừng đọc câu này rộng hơn thế. **Đo được tĩnh:** kho hiện có **0** câu `CREATE RULE` trong `db/migrations/` (hai lần khớp đều nằm trong chú thích bàn về chính đường tấn công này), nên đây là một khoảng trống, chưa phải một lỗ. **Đường đóng:** đưa `pg_rewrite` vào cùng tổng điều tra, hoặc mở rộng vế *"không rule nào"* từ hai bảng sổ ra mọi bảng chỉ-ghi-thêm. **[S1.31] ĐÓNG BẰNG CẢ HAI ĐƯỜNG, sau khi đo cả hai chiều của lỗ.** Đo trên PostgreSQL 16: `CREATE RULE … ON UPDATE TO t DO INSTEAD NOTHING` làm bảng chỉ-ghi-thêm mà UPDATE/DELETE trả **0 hàng, không lỗi**, hàng còn nguyên, `migrate()` OK, bảng ngoài `VI_TU_BANG_CHI_GHI_THEM`; và chiều ngược — vế *"vòng này KHÔNG đo xem lớp rule có với tới chúng không"* — đo xong thì **không với tới**: rule trên `bid_receipts` SỐNG QUA `migrate()`, trên `audit_events` thì bị [CR1] tự gỡ. ⑴ **Sản xuất:** mục *trạng thái vật lý của bảng chỉ-ghi-thêm* của `hardening.always.sql` thêm vế RULE — mọi `pg_rewrite` (trừ `_RETURN`) trên mọi bảng trong `VI_TU_BANG_CHI_GHI_THEM` là PHÁN XÉT (ném kèm hướng sửa); hai bảng sổ vẫn TỰ GỠ vì mục [CR1] đứng trước trong mảng — đo cả năm bảng, hai kết quả đúng khác nhau, cùng ranh giới ADR-028 §2⑵ với LOGGED. Mũi đột biến: vô hiệu vế mới ⇒ rule trên `bid_receipts` lại sống qua `migrate()` ⇒ test đỏ. ⑵ **Test:** tổng điều tra `pg_rewrite` — MỌI rule trên MỌI quan hệ của dự án phải nằm trong `RULE_DA_KHAI`, danh sách RỖNG và rỗng là một lời khai (*dự án không dùng RULE*); đỏ cả hai chiều; đối chứng chống rỗng ruột dựng ngay trong test (một rule tạm phải được THẤY). Phép đo dựng rule trên bảng thường: 0 hàng / không lỗi / ngoài tập rộng / ngoài H19 / `migrate()` OK — và tổng điều tra là lớp DUY NHẤT thấy nó, ở đúng hai tên. **Lượt soi 21 hỏi:** rule đặt tên `"_RETURN"` trên bảng có lách vế loại theo tên không? Đo: PostgreSQL 16 NÉM *non-view rule … must not be named "_RETURN"* — chính engine giữ tên ấy cho view. **Thứ KHÔNG đóng:** RLS `USING (false)` là cơ chế thứ ba làm bảng chỉ-ghi-thêm không trigger không rule — khoản nợ **76** | `db/hardening-suy-tu-tinh-chat.int.test.ts` (tổng điều tra RULE, test rule trên bảng chỉ-ghi-thêm), `db/migrations/hardening.always.sql` (`CAU_CHI_GHI_THEM_VAT_LY`), `db/migrations/003_audit_events.sql` |
| 74 | **[ĐÓNG]** **[S1.29] MỘT HÀM CANH CÓ `RETURN` BỊ KHAI SAI LÀ KHÔNG-CANH THÌ KHÔNG PHÉP KIỂM VĂN BẢN NÀO BẮT ĐƯỢC.** Tổng điều tra của `[INV-H19]` buộc mọi hàm trigger BEFORE-ROW UPDATE/DELETE phải được phân loại, và bắt được chiều *thân không có `RETURN` mà khai KHÔNG-CANH* (một hàm không bao giờ trả về chỉ có thể từ chối vô điều kiện). Chiều ngược thì không: một hàm canh viết `IF … THEN RAISE … END IF; RETURN NULL;` — đúng kiểu khoản nợ 60 nêu tên — nếu bị ghi vào `HAM_KHONG_PHAI_CANH` thì cả ba khẳng định của khối tổng điều tra đều xanh, và bảng của nó nằm ngoài tập chỉ-ghi-thêm. Lượt soi đối kháng 19 dựng đúng ca ấy trên PostgreSQL thật và đo được: khai sai ⇒ **xanh**, không lớp nào bắt. **Thứ ĐÃ đóng, đừng đọc gộp:** khai THẬT nay là đường xanh và bảng ĐƯỢC canh (vị từ = hình dạng ∪ khai báo, đo trên PostgreSQL thật); một hàm mới không rơi khỏi tập trong im lặng. **Thứ còn lại:** phân biệt *canh thật* với *khai sai* đòi một phép đo HÀNH VI — thử UPDATE/DELETE trên một hàng của từng bảng mang hàm trong tập rộng — chứ không phải đối chiếu hai lời khai văn bản. Giá của đường ấy: cần một hàng hợp lệ trên mỗi bảng, tức một bộ sinh dữ liệu theo lược đồ, hoặc chạy trong giao dịch rồi hoàn tác. **[S1.30] ĐÓNG bằng một phép đo HÀNH VI, đúng đường sổ nợ đã chỉ — và giá của nó là thứ đã trả, không phải thứ tránh được.** Bật `track_functions = 'pl'` trên một kết nối, chạy **24 câu UPDATE/DELETE hợp lệ** viết tay trải trên **13 bảng** (một đời RFQ soạn → nộp → mở → gia hạn → mời → đóng → yêu cầu mở thầu → duyệt → điều phối → mở thầu; một RFQ huỷ để thu hồi vật liệu khoá; một việc outbox; một liên kết đăng nhập; một lượt đặt lại TOTP hai người), mỗi câu kẹp giữa hai lần đọc `pg_stat_xact_user_functions` trong CÙNG giao dịch. **Vế chịu lực, đo trên PostgreSQL 16: `calls` chỉ tăng khi hàm TRẢ VỀ** — `ExecCallTriggerFunc` gọi `pgstat_end_function_call` SAU khối `PG_TRY`, nên một `RAISE` nhảy qua nó; hàm canh kiểu `RETURN NULL` dựng thật: hai câu đều ném từ chính nó, `calls` đứng ở 0 đo trong cùng giao dịch quanh lời gọi ném. Một BỘ BA (hàm, bảng, sự kiện) chỉ được GHI CÔNG khi ⒜ hàm có trigger BEFORE-ROW ở đúng (bảng, sự kiện) theo tập rộng, ⒝ `calls` tăng trong lúc câu chạy, ⒞ câu chạm ≥ 1 hàng; vai của mỗi nhân chứng được ĐO bằng `current_user`, và hàm mà thân đọc vai (`la_duong_ung_dung`, `current_user`, `pg_has_role`, …) đòi nhân chứng từ một vai KHÔNG superuser — mọi bộ ba tập rộng THẤY cho một hàm khai KHÔNG-CANH phải được ghi công hợp lệ: **30 bộ ba** hôm nay, 29 có nhân chứng, 1 khai CANH MỘT SỰ KIỆN. **Phép đo lộ ra một loại hàm mà hai danh sách không tả được:** `rfq_key_material_bat_bien` từ chối DELETE VÔ ĐIỀU KIỆN nhưng cho UPDATE có điều kiện — nay khai ở `HAM_CANH_MOT_SU_KIEN`, và lời khai ấy phải ĐO được: sự kiện nêu tên không được có nhân chứng, và một câu DELETE trên hàng thật phải ném từ chính hàm ấy (`where` của lỗi PostgreSQL). **Lượt soi đối kháng 20 bác bản đầu ở hai chỗ, bác đúng:** ⒜ ghi công theo HÀM bỏ sót hàm rẽ nhánh theo `TG_TABLE_NAME`/`TG_ARGV` — `thu_hoi_don_dieu` gắn 5 bảng mà kịch bản chạm 2, ba bảng kia chưa hàng nào đi qua mà cặp vẫn xanh; ⒝ nhân chứng dưới superuser ngắn mạch mọi hàm gated theo vai, và cách chọn hai hàm chạy dưới `app_api` là theo TÊN viết tay. Cả hai đóng như trên, và cả hai đo đỏ thật sau khi đóng: bỏ nhân chứng `guest_sessions` ⇒ đỏ đúng `thu_hoi_don_dieu/guest_sessions/UPDATE`; chạy DELETE `mfa_credentials` dưới owner ⇒ đỏ `(cần vai không superuser)`. Bốn mũi đột biến ĐỎ THẬT tổng cộng (hàm canh có `RETURN` khai sai ⇒ đỏ đúng hai bộ ba của nó, 21 hàm kia vẫn xanh — mũi thường trực; xoá một nhân chứng; hai mũi của lượt soi). **Thứ KHÔNG đóng, đừng đọc gộp:** ⑴ ghi công theo (hàm, bảng), không theo TRIGGER — `kiem_danh_tinh_theo_phien` gắn 4 trigger UPDATE trên `rfq_packages` với `WHEN` khác nhau, một lần đi qua là đủ, vì thân hàm là một; ⑵ kịch bản là một lời khai về ĐƯỜNG HỢP LỆ của từng bảng, do người viết chứ không tự sinh — nhưng nó không nói dối được: câu không đi qua thì ném, câu 0 hàng thì không ghi công; ⑶ phép đo nói *"có một đường trả về"*, không nói *"mọi điều kiện của hàm đều đúng"* — việc ấy thuộc test từng gói; ⑷ tập rộng khoá theo trigger BEFORE cấp HÀNG — trigger cấp CÂU LỆNH hay AFTER-ROW ném vô điều kiện không vào tổng điều tra lẫn nhân chứng: khoản nợ **75**; ⑸ khoản 73 (RULE) vẫn mở | `db/hardening-suy-tu-tinh-chat.int.test.ts` (khối NHÂN CHỨNG HÀNH VI), `docs/DECISIONS.md` ADR-035 §2⑷ |
| 75 | **[ĐÓNG]** **[S1.30] MỘT TRIGGER CẤP CÂU LỆNH HAY AFTER-ROW NÉM VÔ ĐIỀU KIỆN LÀM BẢNG CHỈ-GHI-THÊM MÀ KHÔNG VÀO TỔNG ĐIỀU TRA LẪN NHÂN CHỨNG.** Tập rộng của `[INV-H19]` nhận trigger `BEFORE … FOR EACH ROW` (`tgtype & 19 = 19` / `& 11 = 11`) trên UPDATE/DELETE — vế *cấp HÀNG* được thêm để loại `rfq_items_cam_truncate` (TRUNCATE cấp câu), nhưng nó loại luôn `CREATE TRIGGER … BEFORE UPDATE OR DELETE FOR EACH STATEMENT EXECUTE FUNCTION canh()` với thân `RAISE`: hàm ấy chặn MỌI câu, kể cả 0 hàng, là hàm canh chỉ-ghi-thêm hoàn hảo, mà không cần khai, không cần nhân chứng, và bảng không vào `VI_TU_BANG_CHI_GHI_THEM` nên hardening không canh UNLOGGED/GRANT/TRUNCATE cho nó. AFTER-ROW ném vô điều kiện cũng vậy (câu bị huỷ). Lượt soi đối kháng 20 chỉ ra (MEDIUM-1), xác minh bằng đọc bitmask, **chưa dựng ca đo**. Cùng lớp với khoản 73: chiều IM LẶNG của tập ứng viên, không phải chiều nói dối. **Đo được tĩnh:** kho hiện có **0** trigger cấp câu trên UPDATE/DELETE trong `db/migrations/` (mọi `FOR EACH STATEMENT` đều là TRUNCATE), và **5** trigger AFTER-ROW trên UPDATE (D3 trên `role_permissions`/`user_roles` ở 005/033, `users.status` ở 034) — năm hàm ấy nằm ngoài cả hai lớp và vòng này KHÔNG đọc thân chúng để phân loại; theo mục đích thiết kế chúng từ chối CÓ ĐIỀU KIỆN, nhưng đó là một lời khai, không phải phép đo. **Đường đóng:** tổng điều tra liệt kê thêm trigger UPDATE/DELETE cấp câu và AFTER-ROW (bit 16/8 bật, bất kể bit 1/2) và buộc phân loại; ít nhất ĐỎ nếu hàm của chúng có thân không `RETURN`. **[S1.31] ĐÓNG — tập rộng thôi khoá theo hình thức.** Tiêu chí ứng viên nay là *mọi trigger plpgsql trên UPDATE hoặc DELETE* (bit 16/8 của `tgtype`, không xét bit ROW/BEFORE): **28 hàm / 46 trigger / 15 bảng** (thêm 5 hàm AFTER-ROW UPDATE của D3 và đình chỉ). Luật mới của tổng điều tra: một hàm canh — theo hình dạng HAY theo khai báo — gắn ở bất kỳ trigger nào KHÔNG phải `BEFORE … FOR EACH ROW` là ĐỎ, vì đó là hình thức DUY NHẤT `VI_TU_BANG_CHI_GHI_THEM` nhận. Phép đo dựng hàm canh cấp câu lệnh (`RAISE` không `RETURN`, `BEFORE UPDATE OR DELETE FOR EACH STATEMENT`): mọi UPDATE/DELETE ném kể cả câu 0 hàng, bảng ngoài H19, `migrate()` OK, `TRUNCATE` OK — tập rộng mới THẤY nó (`khong_tra_ve = true`, `chi_truoc_hang = false`) và tổng điều tra đỏ ở CẢ HAI lời khai có thể có (khai CANH ⇒ luật BEFORE-ROW; khai KHÔNG-CANH ⇒ mâu thuẫn một chiều). Năm hàm AFTER-ROW vào `HAM_KHONG_PHAI_CANH` và có nhân chứng như mọi hàm khác (no-op UPDATE `user_roles`/`role_permissions`, đình chỉ một người dùng) — đo: bỏ nhân chứng `users` ⇒ đỏ đúng `users_thu_hoi_phien_khi_dinh_chi/users/UPDATE`. Lượt soi 21 xác nhận luật không có dương tính giả: PL/pgSQL ném *control reached end of trigger procedure without RETURN* cho cả AFTER, nên hàm không `RETURN` chỉ có thể ném. **Một lời khai của bản đầu bị chính phép đo bác:** *"kho không có trigger deferred"* — `SET CONSTRAINTS ALL IMMEDIATE` thêm vào nhân chứng làm 017 tự bắn (constraint trigger DEFERRED trên INSERT `rfq_key_material` đòi RFQ mở trong cùng giao dịch); gỡ, và ghi đúng: 0/46 trigger UPDATE/DELETE là deferrable, một trigger như thế sẽ không được ghi công ⇒ đỏ nhìn thấy được, thông điệp nói rõ | `db/hardening-suy-tu-tinh-chat.int.test.ts` (`TU_TAP_RONG`, `chi_truoc_hang`), `docs/DECISIONS.md` ADR-035 §4 |
| 76 | **[ĐÓNG]** **[S1.31] RLS `USING (false)` LÀ CƠ CHẾ THỨ BA LÀM BẢNG CHỈ-GHI-THÊM MÀ KHÔNG TRIGGER, KHÔNG RULE.** `CREATE POLICY p ON t FOR UPDATE USING (false)` + `FORCE ROW LEVEL SECURITY`: UPDATE/DELETE trả 0 hàng, không lỗi, không trigger nào chạy, không rule nào tồn tại — chỉ superuser đi qua. Bảng CÓ hàm khai KHÔNG-CANH thì nhân chứng hành vi bắt được (0 hàng ⇒ không ghi công ⇒ đỏ); bảng KHÔNG có trigger nào thì không tổng điều tra nào thấy, và bảng đứng ngoài LOGGED / chốt TRUNCATE / ACL của H19. Lượt soi đối kháng 21 chỉ ra (LOW-2), **chưa dựng ca đo**. Cùng lớp với 73 (RULE) và 75 (trigger ngoài BEFORE-ROW): chiều IM LẶNG của tập ứng viên, mỗi vòng lộ thêm một cơ chế của PostgreSQL có thể chặn ghi. **Đo được tĩnh:** 47 câu `CREATE POLICY` trong `db/migrations/`, không câu nào mang `USING (false)` hay `WITH CHECK (false)` — mọi vị từ đều tham chiếu một thiết lập phiên (`app.org_id` hoặc `app.guest_session_id`); khoảng trống, chưa phải lỗ. **Đường đóng:** tổng điều tra `pg_policy` — policy mà `qual`/`with_check` là hằng `false` (hay không tham chiếu cột nào) phải được khai; hoặc một câu hỏi rộng hơn — *liệt kê MỌI cơ chế PostgreSQL có thể làm một câu ghi trả 0 hàng không lỗi* — và trả lời một lần cho cả ba. **[S1.32] ĐÓNG BẰNG CÂU HỎI RỘNG — ADR-036 là danh mục.** Đo trước: 30 bảng RLS, **29 policy RESTRICTIVE** (027, guest) mà lớp hình dạng [CR1] cố ý KHÔNG soi — `CREATE POLICY … AS RESTRICTIVE FOR UPDATE USING (false)` trên `users` sống qua `migrate()`, và app_api trong tenant đọc được hàng nhưng UPDATE ra **0 hàng, không lỗi**; phủ lệnh 87/87 tổ hợp (bảng, vai, quyền) có policy PERMISSIVE; 2 bảng RLS ngoài tenant (gốc và `caller_rate_limits`); 0 view. Ba tổng điều tra mới ở `rls-coverage` [INV-F1]: ⑴ **policy RESTRICTIVE** — khai đủ bốn cột nguyên văn `pg_get_expr`, khoá `lược đồ.bảng.policy`, 29 dòng, đỏ cả hai chiều; ⑵ **phủ lệnh** — mọi quyền SELECT/INSERT/UPDATE/DELETE đã cấp cho `app_api`/`app_unseal` (mức bảng hay cột, đích danh hay qua PUBLIC) phải có policy PERMISSIVE phủ (lệnh, vai) — mặc-định-từ-chối của RLS là 0 hàng không lỗi; ⑶ **bảng RLS ngoài tenant** phải khai kèm lý do. Hai vế ở `hardening` test [INV-H19]: ⑷ trigger canh phải `ENABLE ALWAYS` (`session_replication_role = replica` bỏ qua trigger `O` — fail-open); ⑸ **tổng điều tra `relkind`** — mọi đích DML là bảng thường trừ khi khai (view/`INSTEAD OF`, bảng ngoài, phân mảnh). Mỗi tổng điều tra mang đối chứng dương của riêng nó (một đối tượng tạm phải được THẤY), bài học lượt soi 21. **Lượt soi 22 thêm hai hàng vào chính danh mục ngay trong vòng viết nó:** trigger BEFORE INSERT ROW trả `NULL` nuốt INSERT im lặng (đo: `INSERT 0 0`) — tập rộng mở ra bit INSERT, 27 hàm trigger INSERT buộc phân loại (19 khai mới), nhân chứng INSERT là khoản **77**; che tên bằng bảng tạm/schema trùng tên vai — khoản **78**. Và một CAO trong chính bản đầu: tổng điều tra phủ lệnh **mù với quyền cấp qua PUBLIC** (grantee 0 không có hàng trong `pg_roles`) — sửa, đối chứng dương `GRANT … TO PUBLIC` nay phải ra ba bộ ba. **Thứ KHÔNG đóng:** 77, 78; và ADR-036 §5 nói rõ danh mục là lời khai về tính đầy đủ, không chứng minh được — lượt soi 22 chứng minh đúng điều ấy | `db/rls-coverage.int.test.ts` (khối `[S1.32 / khoản nợ 76]`), `db/hardening-suy-tu-tinh-chat.int.test.ts` (`luon_bat`, tổng điều tra `relkind`), `docs/DECISIONS.md` ADR-036 |
| 77 | **[ĐÓNG]** **[S1.32] TRIGGER BEFORE INSERT ROW TRẢ `NULL` NUỐT INSERT IM LẶNG — ĐÃ CÓ TỔNG ĐIỀU TRA, ~~CHƯA CÓ NHÂN CHỨNG~~ [S1.33] NHÂN CHỨNG ĐÃ CÓ.** Đo trên PostgreSQL 16: `BEGIN RETURN NULL; END` gắn `BEFORE INSERT … FOR EACH ROW` ⇒ `INSERT 0 0`, `RETURNING` rỗng, không lỗi. Với `outbox_jobs` đó là *việc không bao giờ vào hàng đợi*; với `audit_chain_anchors` là gãy chuỗi im lặng. Lượt soi đối kháng 22 chỉ ra (H2). Vòng này mở tập rộng của tổng điều tra ra bit INSERT — 27 hàm trigger INSERT phải nằm trong danh sách, một hàm mới chặn cổng — nhưng phân loại là lời khai văn bản; thứ phân biệt *có điều kiện* với *nuốt vô điều kiện* là một NHÂN CHỨNG INSERT (câu chèn chạm ≥ 1 hàng và `calls` tăng), đúng khuôn S1.30 cho UPDATE/DELETE. **Đo được tĩnh:** cả 27 hàm INSERT hôm nay có `RETURN`; kịch bản nhân chứng đã CHÈN qua phần lớn chúng (org, người, phiên, RFQ, hạng mục, ngân sách, khoá, mời, token, OTP, phiên khách, yêu cầu mở thầu, phê duyệt, outbox, TOTP) mà chưa GHI CÔNG cho sự kiện INSERT. **Đường đóng:** `chung()` nhận thêm sự kiện `INSERT`; `chuaCoNhanChung` đòi bộ ba (hàm, bảng, INSERT) cho hàm có trigger INSERT; kịch bản gói các INSERT sẵn có thành nhân chứng. **[S1.33] ĐÓNG — ĐÚNG ĐƯỜNG ĐÃ VIẾT, VÀ LỘ RA RẰNG INSERT KHÔNG NUỐT GIỐNG UPDATE/DELETE.** Đo trước khi viết: hàm canh UPDATE/DELETE từ chối bằng `RAISE` (PostgreSQL KHÔNG đếm), còn hàm nuốt INSERT trả `NULL` (ĐƯỢC đếm: `calls` +1, `INSERT 0 0`) — nếu phép đo chỉ dựa bộ đếm hàm thì lời khai sai XANH; vế ⒞ *câu chạm ≥ 1 hàng* là toàn bộ lớp cho cơ chế 15. Tập sự kiện mở ra INSERT: **38 bộ ba** (hàm, bảng, INSERT) của 27 hàm, ~~MỌI INSERT của kịch bản là nhân chứng~~ [S1.35, lượt soi 25b #6] mọi INSERT trên bảng có trigger INSERT là nhân chứng (thêm sổ kiểm toán + mốc neo, phê duyệt RFQ, luồng báo giá + phiên bản + biên nhận cùng giao dịch, bản rõ, vai tạm nhận một quyền, yêu cầu break-glass, phiên dưới `app_api` sau một TOTP đúng — hai hàm nhạy vai của `sessions`). Hai constraint trigger DEFERRED của kho (017, 018) — lượt soi 21 từng nói *ngoài phép đo* — nay ĐO ĐƯỢC: `chung()` ép `SET CONSTRAINTS ALL IMMEDIATE` SAU câu nhân chứng và sau `hoanTat` (câu làm điều kiện thoả), đọc bộ đếm lần thứ ba, hàm DEFERRED chỉ ghi công ở cửa sổ ấy. Đo chiều đỏ: xoá nhân chứng mốc neo + chạy nhân chứng `sessions` dưới superuser ⇒ đỏ đúng ba bộ ba. **Lượt soi 23 bác bản đầu ở ba chỗ NẶNG, cả ba đã sửa:** ⒜ `rowCount` là con số đếm TRƯỚC khi trigger AFTER chạy — một `AFTER INSERT` xoá hàng vừa vào cho `INSERT 0 1`, `RETURNING` đầy đủ, `calls` tăng, bảng rỗng (đo: `n_tup_ins` 1, `n_tup_del` 1) ⇒ vế "hàng thật" nay đo ở mức BẢNG bằng `pg_stat_xact_user_tables` ở ba mốc (ADR-036 hàng 17); ⒝ nuốt MỘT trong nhiều hàng cho `rowCount ≥ 1` ⇒ mỗi INSERT của kịch bản khai số hàng mong (hàng 18); ⒞ vị từ `nhay_vai` lách được bằng vị từ bọc tên khác (khuôn 037) ⇒ regex rộng hơn + bao đóng bậc một, đối chứng dương. **Thứ KHÔNG đóng:** giới hạn ⒞ ⒟ của khối nhân chứng giữ nguyên — nuốt theo dữ liệu NGOÀI câu (một `org_id` thuộc tập cố định) vẫn ngoài tầm; INSERT chưa khai được canh-một-sự-kiện (chưa có phép đo lời từ chối) — hàng rào đứng đầu vòng | `db/hardening-suy-tu-tinh-chat.int.test.ts` (`TU_TAP_RONG` bit 4, `SoNhanChung`, `demHangTrongGiaoDich`), `docs/DECISIONS.md` ADR-036 ⑮ ⑰ ⑱ |
| 78 | **[ĐÓNG]** **[S1.32] CHE TÊN: BẢNG TẠM HAY SCHEMA TRÙNG TÊN VAI ĐỨNG TRƯỚC `public` TRONG `search_path` CỦA VAI ỨNG DỤNG.** Hardening đặt `rolconfig` của `app_api` về NULL ⇒ `search_path` mặc định `"$user", public`, và `pg_temp` ngầm đứng trước. ~~Không dòng nào `REVOKE TEMP ON DATABASE`, và `vai-tro.ts` không `DISCARD TEMP` khi lấy kết nối từ pool~~ **[S1.34] nay có cả hai** — cơ chế đo được trước khi vá: một `CREATE TEMP TABLE sessions (…)` trên một kết nối pool sống hết đời kết nối và che `sessions` cho MỌI request sau trên kết nối ấy; một `CREATE SCHEMA app_api` (cần chủ DB) cộng `app_api.users` cũng che — tổng điều tra `relkind` thấy một bảng thường hợp lệ, [CR1] chỉ soi `public`. Lượt soi đối kháng 22 chỉ ra (L1), **chưa dựng ca đo**. **Đo được tĩnh:** mã sản xuất qualify `public.` và dùng `OPERATOR(pg_catalog.=)` (qt3 giữ), nên hôm nay vô hại; test thì viết trần. **Đường đóng:** một mục hardening `REVOKE TEMP ON DATABASE <db> FROM PUBLIC, app_api, app_unseal`; một khẳng định *không schema nào trùng tên vai ứng dụng*; và ghi rõ vì sao tổng điều tra `relkind` loại `pg_temp`. **[S1.34] ĐÓNG — LẦN ĐẦU TIÊN TỪ S1.29 MỘT KHOẢN NỢ ĐÓNG BẰNG MÃ SẢN XUẤT, VÀ LƯỢT SOI 24 ĐÒI GIỮ CẢ TIỀN ĐỀ CỦA LỚP.** Đo trước khi vá (PostgreSQL 16): `app_api` có TEMP qua PUBLIC (`datacl` NULL); `CREATE TEMP TABLE sessions` ⇒ `sessions` trần đếm **0** khi `public.sessions` có 1 hàng, UPDATE trần **0 hàng không lỗi**; `CREATE SCHEMA app_api` + `app_api.sessions` ⇒ cùng thế; `migrate()` đi qua cả hai. Lớp ở `hardening.always.sql`, sáu mục, ba cặp: ⑴ **TEMP — tự chữa** (`REVOKE TEMP ON DATABASE` khỏi PUBLIC, hậu điều kiện đọc qua `acldefault` nên thấy cả trạng thái chưa vật chất hoá; và khỏi mọi vai kết nối ứng dụng theo TÍNH CHẤT — thành viên bắc cầu của `app_api`/`app_unseal` trừ superuser, `VAI_KET_NOI_UNG_DUNG`); đo: sau REVOKE, CREATE TEMP TABLE/VIEW/SEQUENCE đều 42501; ⑵ **CREATE ON DATABASE — tự chữa**, cùng khuôn (lượt soi 24, NẶNG-1: tiền đề *app_api không tạo được schema* từng chỉ được ĐO, chưa được GIỮ — CREATE trôi ⇒ app_api tự dựng schema trùng tên, che BỀN cho mọi kết nối; đo được, và nay `migrate()` thu hồi ngay ở lượt sửa dù lượt phán xét gãy); ⑶ **schema trùng tên vai kết nối — phán xét**, cố ý không DROP; ⑷ **quan hệ trùng tên public trong một schema mà vai có USAGE — phán xét** (đường `SET search_path` trong phiên chỉ che được tên khi có quan hệ như thế để trỏ tới; bản đầu phán xét *không USAGE ngoài public* và đo được là quá rộng — gãy hai fixture hợp lệ của chính `migrations.int.test.ts`, schema `khac` và `gia` — nên thu hẹp về đúng cơ chế). **Dư lượng đo được và đóng ở tầng app:** bảng tạm tạo TRƯỚC lần deploy mang lớp này SỐNG qua REVOKE trên cùng kết nối pool (đo: vẫn đếm 0, INSERT vẫn vào) ⇒ `vai-tro.ts` `DISCARD TEMP` cùng câu với `SET ROLE` ở mỗi lần giao client, không thêm vòng đi-về; test đo bằng `pg_backend_pid` rằng cùng kết nối vật lý lấy lại đã sạch. Hai test ở `migrations.int.test.ts` đo CẢ cơ chế lẫn lớp trên cùng CSDL; chiều đỏ đo bằng đột biến (REVOKE thành no-op, `true OR` vào hậu điều kiện schema, thu hồi CREATE thành no-op — mỗi cái đỏ đúng một khẳng định, cô lập). **Thứ KHÔNG đóng, ghi ở ADR-036 ⑯:** hàm SECURITY DEFINER thuộc chủ DB có thể tạo bảng tạm trong phiên app (hôm nay không hàm nào dùng TEMP — đo bằng grep; `CAU_DOC_VONG` canh mọi secdef ngoài danh sách ngoại lệ); mọi role khác của cụm (giám sát, BI) mất TEMP — ràng buộc thiết kế, cấp đích danh nếu cần | `db/migrations/hardening.always.sql` (`VAI_KET_NOI_UNG_DUNG`, sáu mục `[S1.34 / khoản nợ 78]`), `packages/db/src/vai-tro.ts`, `db/migrations.int.test.ts` (`[khoản nợ 78]` ×2), `docs/DECISIONS.md` ADR-036 ⑯ |
| 79 | **[ĐÓNG]** **[S1.35, lượt soi 25a #1 CAO + #2 NẶNG] TẬP SUY RA CỦA H19 VÀ TỔNG ĐIỀU TRA KHÔNG ĐỌC `tgqual`/`tgattr`, VÀ CHỈ THẤY TRIGGER `plpgsql`.** Hai bài học S0 đã có cho bảng CÓ TÊN (hardening soi `WHEN`/`UPDATE OF` qua `tgqual`/`tgattr` ở `CTE_TRIGGER_CHAN`; bài học "ngôn ngữ đã đổi" ở `audit_append`) không sang được vị từ suy ra lẫn tổng điều tra của S1.29–S1.33 — sáu lượt soi dọc không thấy vì không lượt nào đối chiếu lớp mới với lớp cũ. Đo (PostgreSQL 16, bản nháp `db/zz-do-soi25.int.test.ts` đã xoá): ⑴ bảng `zz1` mang `BEFORE UPDATE OF a … bid_chi_ghi_them()` + `BEFORE DELETE … WHEN (false) … bid_chi_ghi_them()` + TRUNCATE, cả ba ENABLE ALWAYS ⇒ `migrate()` OK; `UPDATE … SET b` **1 hàng**, `UPDATE … SET a` 23514, `DELETE` **1 hàng**; catalog: `d` có `tgqual`, `u` có `tgattr = '2'`; vị từ mô phỏng (`tgtype & 19 = 19` / `& 11 = 11` + tên hàm) NHẬN `zz1` ⇒ một bảng "chỉ-ghi-thêm" theo H19 mà UPDATE cột khác và mọi DELETE đi qua. ⑵ `suppress_redundant_updates_trigger()` (lanname `internal`) trên `zz2` ⇒ UPDATE cùng giá trị **0 hàng, không lỗi**; `migrate()` OK; theo ĐỌC bộ lọc (chưa chạy trên `zz2`): không tổng điều tra nào thấy (mọi census lọc `lanname = 'plpgsql'`), vị từ và nhân chứng cũng không; hôm nay 0 trigger không-plpgsql trong dự án ngoài fixture. **Đường đóng, một sửa cho cả hai:** cột `co_when`/`co_cot` vào `CAU_TAP_RONG`, khẳng định = false cho mọi trigger của hàm canh (như vế `luon_bat`) kèm đối chứng dương; `VI_TU_BANG_CHI_GHI_THEM` — CẢ HAI bản, test và hardening — chỉ ĐẾM trigger canh khi `tgqual IS NULL AND tgattr = ''`, để bảng có trigger canh điều kiện rơi khỏi tập và tổng điều tra đỏ; tổng điều tra thứ hai "mọi trigger của dự án gọi hàm `prolang = plpgsql` trừ khai (`TRIGGER_NGOAI_PLPGSQL_DA_KHAI`, rỗng)" với đối chứng dương là chính hàm built-in ấy. Hardening đổi vị từ ⇒ có mã sản xuất; đột biến đỏ cô lập từng vế. ADR-036 hàng 20, 21. **[S1.36] ĐÓNG — MỘT SỬA CHO CẢ HAI, VÀ PHÉP ĐO LỘ THÊM MỘT KẼ CÙNG CƠ CHẾ Ở CHỐT TRUNCATE.** Đo trước khi viết (PostgreSQL 16): `WHEN (false)` trên trigger TRUNCATE cấp câu lệnh là HỢP LỆ và `TRUNCATE` đi lọt (bảng về 0 hàng) — chốt TRUNCATE của hardening cùng kẽ với hàng 20; `UPDATE OF` trên trigger cấp câu lệnh cũng hợp lệ; kho có 85 trigger plpgsql, 0 trigger ngôn ngữ khác. Lớp: ⑴ `VI_TU_BANG_CHI_GHI_THEM` (cả hai bản, nguyên văn) chỉ đếm trigger canh khi `tgqual IS NULL AND tgattr = ''` — bảng có trigger canh điều kiện RƠI KHỎI tập, đúng vì nó không chỉ-ghi-thêm; ⑵ để nó không rơi TRONG IM LẶNG, mục phán xét mới `CAU_TRIGGER_CANH_CO_DIEU_KIEN`: mọi trigger của hàm canh (hình dạng ∪ khai báo, plpgsql) ở mọi bảng dự án có WHEN/UPDATE OF — hay, sau lượt soi 27, không ở ENABLE ALWAYS — ⇒ `migrate()` NÉM nêu tên trigger và vế; vị từ cố ý KHÔNG đọc `tgenabled` (bảng có trigger canh tắt ở lại tập để LOGGED/ACL vẫn được phán); ⑶ chốt TRUNCATE trong `CAU_CHI_GHI_THEM_VAT_LY` đòi `tgqual IS NULL`; ⑷ tập rộng mang `co_when`/`co_cot`, tổng điều tra đòi hàm canh vô điều kiện, đối chứng dương hoàn tác; ⑸ tổng điều tra NGÔN NGỮ trigger — mọi trigger dự án gọi hàm plpgsql trừ `TRIGGER_NGOAI_PLPGSQL_DA_KHAI` (rỗng), đối chứng dương là chính `suppress_redundant_updates_trigger` (đo trong test: UPDATE cùng giá trị 0 hàng không lỗi; tập rộng không thấy nó) — ~~CHỈ Ở TEST, theo cách đọc ADR-036 §3⑶ cho tới khi khoản 81 quyết~~ [S1.37 quyết, S1.39 đóng: `CAU_TRIGGER_NGOAI_PLPGSQL_SAI`]; vế plpgsql ở vị từ giữ nguyên. Ba test `[khoản nợ 79]`, H19 22 → 25; `migrations.int.test.ts` 94/94 với hardening mới. **Đột biến đỏ, cô lập từng mục:** vế vô điều kiện bỏ khỏi CẢ HAI bản ⇒ đỏ ở guard *vế phải nằm trong vị từ*; vế có mặt mà VÔ HIỆU (`OR true`, cả hai bản) ⇒ đỏ ở *vị từ MỚI thả bảng*; mục phán xét no-op ⇒ đỏ ở *migrate() NÉM*; mục bỏ vế `tgenabled` ⇒ đỏ ở `tgenabled=D`; đảo hai nhánh CASE ⇒ đỏ ở regex ghép tên–vế; tổng điều tra ngôn ngữ lọc lại plpgsql ⇒ đỏ ở đối chứng dương; chốt TRUNCATE bỏ `tgqual` ⇒ `migrate()` VẪN ném — đúng một mục, là mục phán xét mới (nó bắt cả trigger TRUNCATE có WHEN) — hai lớp chồng nhau cho ca ấy, test đỏ ở khẳng định thông điệp *chốt TRUNCATE*. Kèm 25b #12/#13: thông điệp hai mục TEMP/CREATE theo vai nêu đường PUBLIC và chủ DB; `CAU_QUAN_HE_TRUNG_TEN` một bản. **Lượt soi đối kháng 27 — một NẶNG, ba NHẸ, hai INFO; cả sáu xử lý trong vòng.** ⒜ NẶNG: mục phán xét mới đọc `tgqual`/`tgattr` mà KHÔNG đọc `tgenabled` — trên bảng SUY RA, `DISABLE TRIGGER` hay ENABLE thường + `session_replication_role = replica` giữ bảng trong tập (vị từ cố ý không đọc cột ấy) mà UPDATE đi qua và `migrate()` OK; lớp duy nhất là tổng điều tra ở test, tức chính vế khoản 81 đang treo. Đo đúng: UPDATE 1 hàng ở cả hai biến thể. Sửa: vế thứ ba `tgenabled <> 'A'` vào cùng mục, nhánh CASE nêu `tgenabled=…`; test (f) đo cả hai biến thể, đối chứng ENABLE ALWAYS ⇒ `migrate()` OK; đột biến bỏ vế ⇒ đỏ ở `tgenabled=D`. ⒝ NHẸ: thông điệp *vị từ đã thả bảng này* sai khi bảng còn một trigger canh vô điều kiện khác cho cùng sự kiện — viết lại đúng ngữ nghĩa đếm; bốn `toContain` không ghép tên trigger với vế (đảo hai nhánh CASE vẫn xanh) — nay regex ghép tên với vế, đột biến đảo CASE ⇒ đỏ; chú thích *ALWAYS là vế H19* rộng hơn mã — sửa, và đo *thông điệp NÉM đúng 1 mục*. ⒞ INFO: tổng điều tra ngôn ngữ chỉ ở test trong khi WHEN/UPDATE OF/`tgenabled` cùng vòng vào hardening — ghi ranh giới (hàm `internal`/C cần superuser, PL tin cậy khác chưa cài; ngoài mô hình đe doạ của hardening) ở chú thích test và ADR-036 hàng 21; mục mới phủ cả trigger TRUNCATE nên trùng cố ý với vế chốt TRUNCATE — test B nay đòi cả hai lớp nêu tên (*không sửa được 2 mục*). Khớp, người soi kiểm bằng đọc: mọi `WHEN (`/`UPDATE OF` của kho (013–041) gọi hàm có RETURN trong `HAM_KHONG_PHAI_CANH` nên mục mới không phán sai; fixture T5 đặt WHEN/UPDATE OF lên `audit_events_chan_update` vẫn OK vì BƯỚC 2 dựng lại trước BƯỚC 3 (đã chạy: 94/94); `replaceAll` không rỗng ruột (`.gitattributes` `*.sql eol=lf`, guard `not.toBe`); ba test không rò client; `CAU_QUAN_HE_TRUNG_TEN` không đổi ngữ nghĩa (so từng vế với bản chép); FK `ON DELETE CASCADE` vẫn qua BEFORE ROW của bảng con — theo hiểu biết PostgreSQL, chưa đo. | `db/hardening-suy-tu-tinh-chat.int.test.ts` (`VE_TRIGGER_VO_DIEU_KIEN`, `CAU_TAP_RONG`, `[khoản nợ 79]` ×3), `db/migrations/hardening.always.sql` (`VI_TU_BANG_CHI_GHI_THEM`, `CAU_TRIGGER_CANH_CO_DIEU_KIEN`, `CAU_CHI_GHI_THEM_VAT_LY`, `CAU_QUAN_HE_TRUNG_TEN`), `docs/DECISIONS.md` ADR-036 hàng 20–21 |
| 80 | **[ĐÓNG]** **[S1.35, lượt soi 25a #4 + #5, NẶNG] NHÂN CHỨNG HÀNH VI HỎI "CÂU CÓ CHẠM HÀNG KHÔNG" MÀ CHƯA HỎI "HÀNG CHẠM CÓ PHẢI HÀNG ĐÃ GỬI KHÔNG", VÀ MẶC ĐỊNH ĐO DƯỚI SUPERUSER.** ⑴ Trigger BEFORE ROW trả về hàng ĐÃ SỬA (`RETURN OLD` trên UPDATE; `NEW.cột := OLD.cột` hay `NULL`): đo — `rowCount` 1, `n_tup_upd` 1, `calls` +1, `RETURNING` có hàng, **giá trị không đổi** — theo ĐỌC `chung()` (chưa chạy trên `zz_dao`), bốn con số ấy đúng là những gì ba vế ⒜⒝⒞ và ⒞′ so, nên nhân chứng ghi công; cơ chế thiếu trong ADR-036, nay hàng 19. Lượt soi 23 INFO-12 gạt "đổi `NEW.org_id` ⇒ hàng vẫn vào bảng" quá nhanh: hàng vào bảng nhưng không phải hàng đã gửi; ghim thân ở hardening chỉ đóng băng lời khai, không phán hành vi. ⑵ `nhay_vai` là danh sách ĐEN (regex + bao đóng bậc một) nên mặc định của nhân chứng là superuser — chiều nguy hiểm, bị bác ba lần (lượt 20, 23, 25) mà hai lần trước chỉ nới regex; đo: `RE_NHAY_VAI` bỏ sót `pg_stat_activity.usename`, `current_setting('is_superuser')`, `current_setting('session_authorization')`, `pg_get_userbyid(…)`; bọc HAI bậc cũng thoát bao đóng bậc một. **Đường đóng:** vế ⒠ — mỗi INSERT/UPDATE của kịch bản khai cặp (cột, giá trị) đã SET và `RETURNING` chúng, `chung()` so bằng, lệch thì NÉM (không phải "thiếu nhân chứng"); đảo mặc định vai thành danh sách TRẮNG — kịch bản chạy TOÀN BỘ dưới `app_api` trong tenant (đường sản xuất thật), chỉ bộ ba khai đích danh kèm lý do (bảng không cấp quyền ghi cho app) mới được superuser, `nhay_vai` giữ làm đối chứng (hàm khớp regex mà nằm trong danh sách trắng ⇒ đỏ); rồi đo lại bao nhiêu bộ ba còn ghi công dưới owner (lượt soi 25a INFO-10: hai nhân chứng AFTER-ROW là UPDATE no-op `SET role_code = role_code` sẽ tự lộ). 0 mã sản xuất; giá: mỗi câu nhân chứng dài thêm một `RETURNING` **[S1.60] ĐÓNG — chỉ mã test (harness nhân chứng), bản hai (sau lượt soi 53).** Đo trước khi viết (test viết trước, chạy trên harness cũ, PostgreSQL 16): trigger BEFORE ROW `RETURN OLD` trên UPDATE và gán lại `NEW.g` trên INSERT ⇒ `chung()` không ném và ghi công; hàm đọc vai qua `current_setting('is_superuser')` — regex `nhay_vai` không thấy — ⇒ nhân chứng dưới superuser được ghi công. **Sửa:** ⑴ vế ⒠ — mỗi câu INSERT/UPDATE khai cặp (cột, giá trị) đã đặt và RETURNING chúng (bảng mà vai nhân chứng không SELECT được thì `docLai` đọc lại trong cùng giao dịch dưới chủ sở hữu); `chung()` ném trước khi chạy nếu thiếu khai, và sau ⒞′ so MỌI hàng — lệch thì ném nêu cột và hai giá trị, ROLLBACK, không ai được ghi công; giá trị máy chủ sinh khai `KHAC_NULL`; `giaTriKhop` so theo kiểu `pg` đọc ra. ⑵ danh sách TRẮNG vai — nhân chứng hợp lệ khi `current_user` thuộc `VAI_UNG_DUNG`; chủ sở hữu chỉ được cho năm cặp khai kèm lý do trong `NHAN_CHUNG_DUOI_CHU` (`rfq_items` UPDATE/DELETE, `role_permissions` INSERT/UPDATE, `user_roles` UPDATE — không vai ứng dụng nào có quyền ghi), `kiemDanhSachDuoiChu` đối chiếu từng cặp với catalog, test nhân chứng đòi danh sách khít; hàm nhạy vai không được miễn, `nhay_vai` thành đối chứng. ⑶ `dungKichBan` chạy mọi nhân chứng dưới vai và GUC của đường ghi: `app_api` trong tenant, `app_unseal` cho bản rõ và lần chuyển UNSEALED, `app_api` cùng ba GUC khách cho phiên bản báo giá; câu trên bảng không có trigger ở sự kiện ấy về câu dựng. **Đo lại INFO-10 (lượt soi 25a):** trước bản vá 72 bộ ba được ghi công, 63 chỉ dưới superuser; sau bản vá vẫn 72, đúng 8 chỉ dưới chủ sở hữu — tám bộ ba của năm cặp khai — và 64 có nhân chứng từ vai ứng dụng (62 dưới `app_api`, 4 dưới `app_unseal`, hai bộ ba có cả hai). **Lượt soi đối kháng 53** (0 CAO, 0 NẶNG, 3 NHẸ, 3 INFO; không thay đổi có hại nào lọt mà không test nào bắt): NHẸ-1 tên `it` chính còn tả luật danh sách đen cũ — sửa; NHẸ-2 `rolsuper` được đo mà không ai đọc — bỏ; NHẸ-3 và INFO-2 chú thích thiu hay nói quá — sửa; INFO-1 vế ⒠ không canh được cột mà hàm KHÔNG-CANH sửa hợp lệ (xoá payload đăng nhập) — đã có test riêng ở `apps/api/src/auth.int.test.ts`; INFO-3 không đổi. Test: `db/hardening-suy-tu-tinh-chat.int.test.ts` — bốn `it` mới (vế ⒠, danh sách trắng vai, tự đối chiếu catalog, `giaTriKhop`), test nhân chứng chính thêm vế khít, ba test đột biến cũ khai vế ⒠; hai mươi ba đột biến đỏ cô lập ~~(biên bản 75)~~ ([S1.66] §S1.60). **Ranh giới nói ra:** giá trị máy chủ sinh chỉ khai `KHAC_NULL` (bắt `RETURN OLD` giữ NULL, không bắt một giá trị khác NULL bị thay bằng giá trị khác NULL khác); UPDATE không đổi giá trị không so được; cột không khai — khác nhau giữa các hàng của một câu, vai nhân chứng không SELECT được, hay câu không đặt — không được so; `docLai` đọc theo khoá kịch bản nêu; danh sách trắng dựa trên quyền catalog của hai vai ứng dụng; ba GUC khách của nhân chứng phiên bản báo giá không chịu lực (đo: bỏ cả ba, kịch bản vẫn xanh). | `db/hardening-suy-tu-tinh-chat.int.test.ts` (`SoNhanChung.chung`, `chuaCoNhanChung`, `NHAN_CHUNG_DUOI_CHU`, `kiemDanhSachDuoiChu`, `giaTriKhop`, `dungKichBan`), `docs/DECISIONS.md` ADR-036 hàng 19 |
| 81 | **[ĐÓNG]** **[S1.35, lượt soi 25a #3, NẶNG — MỘT QUYẾT ĐỊNH, KHÔNG PHẢI MÃ] ADR-036 §3⑶ NÓI "TEST LÀ ĐỦ CHO CƠ CHẾ 5–10" NGAY SAU KHI S1.31 LẬP LUẬN NGƯỢC LẠI CHO CƠ CHẾ 3.** Hàng 3 (RULE trên bảng chỉ-ghi-thêm) có lớp sản xuất vì "bảng ấy có thể tồn tại trên cụm đã deploy"; hàng 5, 6, 7, 10 (RESTRICTIVE `USING (false)`, thiếu phủ lệnh, RLS ngoài tenant, VIEW/FDW/matview) là test-only — 8 và 9 có phần hardening (047 ghim `ENABLE ALWAYS` cho bảng có tên) nhưng phần tổng điều tra cũng chỉ ở test — với lý do ngược lại "migration là đường duy nhất". Cùng tác nhân, cùng cụm: `CREATE POLICY … AS RESTRICTIVE FOR UPDATE USING (false)` trên `sessions` sau deploy sống qua mọi `migrate()` — chính `[INV-F1] ĐO` ở `rls-coverage` đã đo `migrate()` OK với `zz_chan` còn nguyên. Danh mục ghi "lớp canh: tổng điều tra" nhưng lớp ấy chỉ đứng trong CI; hai vòng liền nhau (S1.31, S1.32) kết luận trái nhau về cùng câu "cụm đã deploy có lớp không", và lượt soi 22 chỉ soi cái mới. **Hai đường, chọn một TRƯỚC khi thêm mã:** ⒜ hardening PHÁN XÉT (ADR-028 §2⑵) — policy RESTRICTIVE ngoài khuôn 027 (tên policy là tên bảng cộng `_khach`, `USING` chứa vế `app.guest_session_id`, không hằng `false`), bảng `relrowsecurity` có quyền cấp cho vai ứng dụng mà không policy PERMISSIVE phủ lệnh (câu `CAU_PHU_LENH` chép nguyên văn), `relkind ∉ ('r','p')` trong lược đồ dự án ngoài khai; ⒝ sửa §3⑶ nói thẳng "trên cụm đã deploy, 5–10 không có lớp" và để đó là một giới hạn có địa chỉ. Khoản này ĐÓNG bằng một quyết định ghi ở ADR-036; mã (nếu ⒜) là một khoản kế, mở khi quyết. **[S1.37] ĐÓNG — QUYẾT BẰNG MỘT TIÊU CHÍ ĐO ĐƯỢC, KHÔNG BỎ PHIẾU TỪNG CƠ CHẾ.** ADR-036 §3⑶ nay: *cơ chế nào mà chủ database không superuser tạo được trên cụm đã deploy thì PHẢI có mục hardening; chỉ cơ chế cần superuser mới được để ở test.* Đo trên PostgreSQL 16 dưới `trien_khai` — chủ database, `rolsuper = false`, CREATEROLE — theo hồ sơ [fix round 4 N2] cộng một điều N2 không có: được cho sở hữu `sessions`. Vì sao: dưới N2 nguyên bản bảng bootstrap thuộc superuser và `CREATE POLICY`/`CREATE TRIGGER` trên `sessions` là **42501** (đo) — nhưng mọi bảng do migration tạo SAU bootstrap thuộc vai deploy, nên mô hình đe doạ đúng là *chủ bảng không superuser* (lượt soi 28 NẶNG-2). Chủ bảng tạo được: policy RESTRICTIVE `USING (false)` trên `sessions` (5); bảng mới bật RLS + FORCE, GRANT `app_api`, không policy ⇒ UPDATE dưới `app_api` **0 hàng** (6); RLS trên bảng ngoài tenant (7); VIEW, MATERIALIZED VIEW, bảng phân mảnh (10); trigger gọi hàm built-in `suppress_redundant_updates_trigger()` — không cần tạo hàm (21); extension TIN CẬY `tcn` (mang hàm trigger C) cài được, `moddatetime` không tin cậy (42501); trigger plpgsql `RETURN NULL` trên `sessions` (1/15); RULE `DO INSTEAD NOTHING` trên `sessions` (3); `DISABLE TRIGGER` (9); `NO INHERIT` (22). `migrate()` — dưới superuser VÀ dưới chính `trien_khai` — đi qua với tất cả những thứ ấy còn nguyên. Cần superuser, đo ở mọi cửa: `CREATE FUNCTION … LANGUAGE internal` (42501); extension không tin cậy `file_fdw` (42501); `session_replication_role` — `SET`, `ALTER ROLE app_api SET`, `ALTER ROLE trien_khai SET` (chính mình, không vướng ADMIN OPTION), `ALTER DATABASE … SET`, `ALTER SYSTEM`, `GRANT SET ON PARAMETER` đều 42501; `trien_khai` không thuộc `pg_write_all_data`/`pg_signal_backend`/`pg_read_server_files`. `CREATE EXTENSION plperl` qua được kiểm tra quyền (không 42501 — extension tin cậy) và gãy 58P01 vì image thiếu `libperl.so`: chưa cài thành công, suy ra cài được trên image có thư viện. Ngôn ngữ có sẵn: `c`, `internal` (không tin cậy), `plpgsql`, `sql` (tin cậy). Ca thay-thế-theo-tên trên bảng CÓ TÊN thì hardening hôm nay ĐÃ bắt: `DROP POLICY sessions_tenant_isolation` ⇒ `migrate()` NÉM ([CR1]: *không có policy PERMISSIVE nào*); đổi tên `sessions` rồi `CREATE VIEW sessions` ⇒ NÉM 4 mục (ghim hàm/trigger có tên). Lỗ nằm ở đối tượng MỚI và ở thứ thêm vào bảng có tên mà [CR1] không đếm (policy thừa, rule, trigger lạ). Hệ quả: **khoản nợ 83** — tám mục phán xét phân loại theo tính chất (lượt soi 28 CAO-1 bắt bản đầu chỉ nêu 5, 6, 7, 10, 21 — bỏ phiếu ngầm; NẶNG-3 bắt thiết kế *ghim mọi policy theo tên*); tiêu chí ba vế: catalog phân biệt được ⇒ hardening; chỉ nhân chứng phân biệt được (1, 15, 17–19) ⇒ giới hạn có địa chỉ; cần superuser (tạo hàm C, SUSET) ⇒ test là đủ; vế *PL khác chưa cài* ở hàng 21 (S1.36) bị phép đo này bác — `plperl`, `tcn` là extension tin cậy. Đường ⒝ bị loại: *"cụm đã deploy không có lớp cho 5–10"* là mô tả một lỗ, không phải một quyết định, khi lỗ ấy đóng được bằng năm mục cùng khuôn với những mục đã có | `docs/DECISIONS.md` ADR-036 §3⑶, `db/migrations/hardening.always.sql`, `db/rls-coverage.int.test.ts` |
| 82 | **[ĐÓNG]** **[S1.35, lượt soi 25a #6 + #7, NHẸ] HAI KẼ NHỎ: `ALTER TABLE … NO INHERIT` LÀM CÂU GHI QUA BẢNG CHA CHẠM 0 HÀNG, VÀ `caller_rate_limits_khach` GHIM BẰNG CHUỖI CON.** ⑴ ADR-036 hàng 13 xếp `NO INHERIT` vào "lỗi, không im lặng" — sai ngữ nghĩa PostgreSQL: đo — `UPDATE cha` trước: 1 hàng; sau `ALTER TABLE con NO INHERIT cha`: **0 hàng, không lỗi**; không census nào đọc `pg_inherits` (con là `relkind 'r'` hợp lệ); kho có fixture con INHERITS ở schema `khac` nên kế thừa là ca có thật. Hàng 13 đã sửa ở vòng này (tách `CHECK … NO INHERIT` — lỗi — khỏi `ALTER TABLE … NO INHERIT` — im lặng), hàng 22 ghi cơ chế; lớp còn thiếu: tổng điều tra `pg_inherits` (cặp cha–con KHÔNG phải phân mảnh) với danh sách khai rỗng + đối chứng dương. ⑵ Mục hardening ghim policy `caller_rate_limits_khach` bằng `pg_get_expr(polqual) = pg_get_expr(polwithcheck)` và `LIKE '%app.guest_session_id%'` — so theo CHUỖI CON, đúng kiểu [CR1] đã bác ("chỉ đòi biểu thức NHẮC TỚI…"); đo: `ALTER POLICY … USING (false AND NULLIF(current_setting('app.guest_session_id', true), '') IS NULL) WITH CHECK (cùng vế)` sống qua `migrate()`; [CR1] không soi (ngoài tenant), census RESTRICTIVE không (permissive), phủ lệnh thấy có policy; hệ quả cho bảng đếm tốc độ: UPDATE bộ đếm 0 hàng ⇒ giới hạn không tăng — fail-open. Đường đóng: ghim NGUYÊN VĂN `pg_get_expr` như mục `otp_rate_limits` đã làm — **[S1.37]** đây là ca riêng của khoản 83⑴ (policy thuộc đúng một lớp), đóng cùng lúc. Hardening đổi ⇒ có mã sản xuất; đột biến đỏ cô lập từng vế. **[S1.38] ⑵ ĐÓNG:** mục `caller_rate_limits` ghim `= KHACH_KHONG_PHIEN_LIT` thay `LIKE`; đo: `ALTER POLICY … USING (false AND …)` ⇒ `migrate()` NÉM ở hai lớp (mục riêng + 83⑴), `DROP POLICY` + `migrate()` dựng lại bản chuẩn. ~~Còn ⑴ (`pg_inherits`).~~ **[S1.40] ⑴ ĐÓNG — mã sản xuất:** mục phán xét `CAU_KE_THUA_SAI` + danh sách `KE_THUA_KHAI` (rỗng) ở hardening: mọi cặp `pg_inherits` KHÔNG phân mảnh có con trong lược đồ dự án phải khai (loại `pg_temp`: bảng tạm kế thừa bảng thật là của riêng phiên — đo: phiên khác, kể cả app_api gắn đúng tổ chức, đọc qua cha không thấy hàng của nó); chiều ngược khi CẢ HAI bảng còn; canh TIỀN ĐỀ, cùng khuôn 83⑧. Bản test `KE_THUA_DA_KHAI` + cổng hai bản khớp; census chạy trong test với đối chứng: cặp INHERITS thấy, lá và chỉ mục phân mảnh không; NO INHERIT ⇒ UPDATE qua cha 1 → 0 hàng không lỗi, cặp biến khỏi catalog, chiều ngược bắt cặp ĐÃ KHAI; `migrate()` NÉM ngoài giao dịch, NO INHERIT ⇒ đi qua (giới hạn nói thẳng: mục canh tiền đề, không canh cú tách). Hai fixture INHERITS cũ (`con_khac`, `con_tt`) lật kỳ vọng sang NÉM ở mục này — miễn policy riêng còn nguyên (đo ở `con_tt` và `public.g`). Đột biến đỏ cô lập: chiều xuôi no-op ⇒ census + ĐO + hai fixture lật; chiều ngược no-op ⇒ khẳng định *cặp đã khai mà bị tách*. Giới hạn (lượt soi 31 NHẸ-1): khai theo TÊN — tên tái dùng được ⇒ khoản 85. ~~**Kèm khi mở tệp `hardening.always.sql` (ở khoản này hay 79, cái nào trước):** thông điệp hai mục TEMP/CREATE theo vai — nêu cả đường PUBLIC và đường chủ DB (lượt soi 25a #11, 25b #12); gộp câu 9 dòng chép hai lần ở mục quan hệ trùng tên thành một hằng (25b #13)~~ **[S1.36] cả hai đã làm ở khoản 79** | `db/migrations/hardening.always.sql` (mục `caller_rate_limits`), `db/hardening-suy-tu-tinh-chat.int.test.ts` (tổng điều tra `relkind`), `docs/DECISIONS.md` ADR-036 hàng 13, 22 |
| 83 | **[ĐÓNG]** **[S1.37, khoản 81 quyết] TÁM MỤC PHÁN XÉT CHO CÁC CƠ CHẾ ADR-036 MÀ CHỦ BẢNG THƯỜNG TẠO ĐƯỢC VÀ CATALOG PHÂN BIỆT ĐƯỢC — 3 (TỔNG QUÁT), 2 (HÌNH THỨC), 5, 6, 7, 10, 21 — VÀ TIỀN ĐỀ SUSET CỦA 8.** Tiêu chí §3⑶ mới đòi mục hardening cho mọi cơ chế mà chủ bảng thường tạo được và catalog phân biệt được tĩnh; hôm nay chúng chỉ có tổng điều tra ở test (`rls-coverage`: `POLICY_RESTRICTIVE_DA_KHAI` 29 dòng, `CAU_PHU_LENH`, `BANG_RLS_NGOAI_TENANT`; `hardening-suy-tu-tinh-chat`: `LOAI_DA_KHAI`, `TRIGGER_NGOAI_PLPGSQL_DA_KHAI`, `RULE_DA_KHAI`, luật BEFORE-ROW cho hàm canh). Đo (chủ bảng `trien_khai`, PG16): policy RESTRICTIVE, bảng RLS không policy (UPDATE 0 hàng), RLS ngoài tenant, view/matview/phân mảnh, trigger built-in, extension tin cậy `tcn`, RULE `DO INSTEAD NOTHING` trên `sessions`, trigger plpgsql `RETURN NULL` trên `sessions` — tất cả tạo được và `migrate()` dưới chính `trien_khai` đi qua. **Đường đóng — tám mục, PHÂN LOẠI theo tính chất chứ không ghim tên (ADR-035 §2; lượt soi 28 NẶNG-3: ghim mọi policy theo tên đảo nguyên lý [CR1] và gãy ≥ 10 test đang tạo policy fixture rồi mong `migrate()` OK), phán xét không tự chữa (ADR-028 §2⑵):** ⑴ policy — mọi policy trên bảng RLS của dự án thuộc ĐÚNG MỘT lớp: khuôn [CR1] (`<bảng>_tenant_isolation`, hình dạng đã ghim), khuôn 027 (`<bảng>_khach`, đã ghim), hoặc danh sách khai đích danh ở hardening (RESTRICTIVE; `caller_rate_limits` — khoản 82⑵ là ca riêng của mục này, đóng cùng lúc); giá: biểu thức khai nguyên văn ở hardening ⇒ đổi phiên bản PostgreSQL có thể chặn deploy tới khi chép lại (ADR-036 §4 hôm nay chỉ nhận giá ấy ở test); ⑵ phủ lệnh — bảng bật RLS có quyền cấp cho vai ứng dụng mà không policy PERMISSIVE phủ (lệnh, vai) ⇒ NÉM (`CAU_PHU_LENH` chép nguyên văn, cổng khớp); ⑶ RLS trên bảng ngoài tập tenant trừ khai; **[S1.38] ⑴⑵⑶ ĐÓNG — NỬA RLS, MÃ SẢN XUẤT.** Lớp ở `hardening.always.sql`, ba mục PHÁN XÉT sau mục [CR1]: ⑴ `CAU_POLICY_LOP_SAI` — mọi policy trên bảng RLS của dự án thuộc ĐÚNG MỘT lớp: (a) PERMISSIVE trên bảng tenant ([CR1] soi hình dạng, không soi lại); (b1) RESTRICTIVE khuôn 027 — `<bảng>_khach`, ALL, PUBLIC, hai vế = *không phải phiên khách* — nhận theo TÍNH CHẤT, không cần khai; (b2) RESTRICTIVE khác — `POLICY_RESTRICTIVE_KHAI` ~~sáu~~ **[S1.55]** bảy cột nguyên văn, có lược đồ, (tám biến thể của 027 nới theo cột); (c) khác — `POLICY_KHAC_KHAI` ~~bảy~~ **[S1.55]** tám cột (`caller_rate_limits_khach`); đỏ cả hai chiều. ⑵ `CAU_PHU_LENH_SAI` — mỗi (bảng RLS, vai ứng dụng, quyền SELECT/INSERT/UPDATE/DELETE đã cấp — mức bảng hay cột, đích danh hay PUBLIC — bốn vai kết nối kể cả hai role đăng nhập, policy áp cho vai và thành viên kế thừa) phải có policy PERMISSIVE phủ (lệnh, vai); KHÔNG miễn con của bảng tenant — con có GRANT riêng mà không policy là đúng ca hàng 6 (lượt soi 29 NẶNG-2; bản đầu miễn `LA_CUA_BANG_TENANT`). ⑶ `CAU_RLS_NGOAI_TENANT_SAI` — bảng bật RLS ngoài `VI_TU_CAN_CO_RLS` phải ở `BANG_RLS_NGOAI_TENANT_KHAI`. Kèm 82⑵: mục `caller_rate_limits` ghim `= KHACH_KHONG_PHIEN_LIT` thay `LIKE` chuỗi con, và ghim cả vai lẫn lệnh. Test (`rls-coverage` 25 → 28): `docHangHardening()` giải hằng của hardening (literal `$q$…$q$`, tên hằng khác, `pg_catalog.format(…)` nối chuỗi) thành SQL và chạy CHÍNH ba câu phán xét trong test — hôm nay rỗng; với fixture trong giao dịch chúng thấy đúng những gì ba tổng điều tra S1.32 thấy (cùng `zz_rong`/`zz_ngoai`, `<bảng>_khach` mới đúng khuôn KHÔNG bị phán); ba cổng *hai bản khớp* — VALUES sinh từ `POLICY_RESTRICTIVE_DA_KHAI` phải xuất hiện NGUYÊN VĂN trong hardening; `migrate()` NÉM với fixture ngoài giao dịch cho ⑵ (`zz_rong83`: app_unseal có SELECT, policy chỉ TO app_api), ⑶ (`zz_ngoai83`), 82⑵ (`false AND …` ⇒ NÉM ở CẢ HAI lớp: mục riêng và 83⑴; `TO app_unseal` ⇒ mục riêng tự bắt), đối chứng đi qua sau khi sửa; bốn fixture con/lá-của-bảng-tenant ở `migrations.int.test.ts` (`[CR2]`, `[I6]`, `[Minor]`, `con_tt`) tách hai nửa (con không quyền riêng ⇒ đi qua, đọc thẳng 42501; cấp quyền ⇒ NÉM ở ⑵, đọc thẳng 0 hàng). Kỳ vọng lật có chủ đích ở hai test cũ: `zz_chan` (S1.32) và `[I4]` bảy RESTRICTIVE lạ trên `users` (`migrations.int.test.ts`) — `migrate()` nay NÉM ở mục ⑴, thông điệp KHÔNG có *thiếu vế* (ý gốc giữ: [CR1] không chặn RESTRICTIVE). **Đỏ đo được, cô lập từng mục (bảy đột biến, mỗi ca khôi phục bản gốc trước khi áp):** ⑴ thành no-op ⇒ đỏ ở *RESTRICTIVE chưa khai phải làm migrate() NÉM*; ⑵ no-op ⇒ đỏ ở *quyền SELECT của app_unseal không policy nào phủ*; ⑶ no-op ⇒ đỏ ở *bảng RLS ngoài tenant chưa khai*; mục `caller_rate_limits` trả về `LIKE` ⇒ `migrate()` VẪN ném (83⑴ bắt) nhưng đỏ đúng ở *thông điệp phải chứa "RLS/policy của caller_rate_limits lệch"* — hai lớp cho một ca; mục ấy bỏ vế vai/lệnh ⇒ đỏ cùng chỗ với ca `TO app_unseal`; một ký tự trong `POLICY_RESTRICTIVE_KHAI` (`rfq_id` → `rfq_idx`) ⇒ `beforeAll` `migrate()` NÉM *rfq_items_khach không thuộc lớp nào* — cả tệp đỏ; khuôn (b1) bất khả (`polcmd = 'x'`) ⇒ 21 policy chuẩn bị phán, cả tệp đỏ. Và một bài học vận hành đo được: bản chụp hardening dùng cho đột biến bị nhiễm ca `rfq_idx` (một lần `luu` chạy sau khi khôi phục hụt), hai ca chạy trên bản nhiễm cho kết quả vô nghĩa — cổng *hai bản khớp* bắt ngay khi chạy trọn tệp; bản chụp và tệp làm việc được hoàn nguyên, hai ca chạy lại. **LƯỢT SOI ĐỐI KHÁNG 29 — MỘT CAO, MỘT NẶNG, NĂM NHẸ, BỐN INFO; cả 11 xử lý trong vòng, mọi câu *cần đo* đã đo.** ⒜ CAO: chiều ngược *khai mà CSDL không có* chạy vô điều kiện, khác hai mục tiền lệ neo `to_regclass(...) IS NOT NULL` — trên tập migration RÚT GỌN của `migrations.int.test.ts` (tới 003…) hardening kêu về 027/042 chưa có. Đo trước khi người soi về: 13 test đỏ; sửa: chiều ngược chỉ khi BẢNG tồn tại — 94/94. ⒝ NẶNG: vế miễn con-của-bảng-tenant ở ⑵ không bảo vệ gì ngoài ba — hoá ra bốn — fixture — đọc/ghi qua cha không cần quyền trên con, nên một GRANT trực tiếp lên con không policy chỉ có nghĩa cho truy cập THẲNG con: đúng ca 0-hàng-không-lỗi của hàng 6; lý do *fail-closed là thiết kế* viết cho câu hỏi RÒ (mục A), không cho câu hỏi IM LẶNG. Sửa: bỏ vế miễn; bốn fixture (`[CR2]` lá phân mảnh, `[I6]` lá ATTACH sau deploy, `[Minor]` `khac.con_khac`, `con_tt`) tách hai nửa — con KHÔNG quyền riêng ⇒ `migrate()` đi qua và đọc thẳng ồn ào (42501); cấp quyền lên con ⇒ NÉM ở ⑵ và đọc thẳng là 0 hàng (đo). ⒞ NHẸ: (b1) so `=` nên `_khach` thiếu một vế ra NULL và bị nhận nhầm — đòi hai vế `IS NOT NULL`, ca `WITH CHECK`-only vào test; ⑵ chỉ hai vai — thêm hai role đăng nhập và tư cách thành viên (`pg_has_role … 'USAGE'`); cổng *hai bản khớp* so văn bản THÔ cả tệp — chuyển sang so với chính hằng qua bộ giải; chú thích *[CR1] khoá vai* sai — [CR1] không khoá vai/lệnh, thứ bắt `ALTER POLICY … TO app_unseal` trên `users` là ⑵ (đo, thêm ca); mục `caller_rate_limits` không ghim vai/lệnh — thêm, ca `TO app_unseal` vào test và đột biến. ⒟ INFO: ⑴ quét cả policy trơ trên bảng chưa bật RLS — giữ mã, sửa lời; cháu hai bậc ở schema khác của một con INHERITS không vào `VI_TU_CAN_CO_RLS` — lỗ RÒ ngoài 83, mở **khoản nợ 84**; literal nhiều dòng phải khớp byte `pg_get_expr` — chú thích; bộ giải hằng không rỗng ruột với ba câu hôm nay, thêm đối chứng `NEO_003` phải NÉM. ~~Còn ⑷–⑻ (nửa catalog).~~ [S1.39 đóng] ⑷ `relkind IN ('v','m','f')` trong `MAU_SCHEMA_DU_AN` trừ khai — view `security_invoker` hợp lệ của [I2] phải được PHÂN LOẠI, không đỏ; ⑸ mọi trigger `NOT tgisinternal` trong `MAU_SCHEMA_DU_AN` (loại `pg_temp%`/`pg_toast%`; FK `RI_FKey_*` là nội bộ) gọi hàm plpgsql trừ khai; ⑹ RULE — không rule nào trên mọi quan hệ của dự án trừ `_RETURN` của view (hôm nay hardening chỉ join rule với bảng sổ và bảng chỉ-ghi-thêm suy ra); ⑺ hàm canh theo hình dạng (thân không `RETURN`) gắn ở hình thức ngoài `BEFORE … FOR EACH ROW` ⇒ NÉM (hàng 2, khoản 75 — hôm nay chỉ ở test); ⑻ `pg_parameter_acl` — không vai ứng dụng nào được `GRANT SET`/`ALTER SYSTEM` trên tham số nào (tiền đề SUSET của hàng 8; hardening chưa ghim). Mỗi mục một đột biến đỏ cô lập ở `migrations.int.test.ts`; MỌI test đang tạo policy/rule/trigger/view fixture rồi mong `migrate()` OK phải rà trước (18 chỗ `CREATE POLICY` ở `migrations.int.test.ts` theo lượt soi 28; `zz_chan`/`zz_ngoai`/`zz_v` ở H19/F1) — để evidence không bác bản đầu lần thứ ba. Có mã sản xuất; hơn một vòng — tách được: ⑴⑵⑶ (RLS) và ⑷⑸⑥⑦⑧ (catalog khác). **[S1.39] ⑷⑸⑹⑺⑧ ĐÓNG — NỬA CATALOG, MÃ SẢN XUẤT; KHOẢN 83 ĐÓNG TRỌN.** Lớp ở `hardening.always.sql`, năm mục PHÁN XÉT sau ba mục nửa RLS: ⑷ `CAU_QUAN_HE_KHAC_SAI` — bảng ngoài, matview, và view CÓ trigger INSTEAD OF trong `MAU_SCHEMA_DU_AN` phải khai ở `QUAN_HE_KHAC_KHAI` (rỗng); view trơn (kể cả `security_invoker` của [I2]) và bảng phân mảnh cố ý không bị phán — DML qua view trơn đi thẳng bảng gốc, lá phân mảnh do H19 canh **[S1.66 / lượt soi ngang 59c INFO-18]** (câu này đúng trong phạm vi mục ⑷; từ S1.50 mục (C) đòi MỌI view của lược đồ dự án `security_invoker` — khoản 91); ⑸ `CAU_TRIGGER_NGOAI_PLPGSQL_SAI` — trigger không nội bộ gọi hàm `lanname <> 'plpgsql'` phải khai ở `TRIGGER_NGOAI_PLPGSQL_KHAI` (rỗng); ⑹ `CAU_RULE_SAI` — rule ngoài `_RETURN` trên MỌI quan hệ của dự án phải khai ở `RULE_KHAI` (rỗng) — hàng 3 tổng quát, không chỉ bảng sổ/bảng chỉ-ghi-thêm suy ra; ⑺ `CAU_HAM_CANH_HINH_THUC_SAI` — trigger của hàm canh (hình dạng ∪ khai tên) có bit INSERT/UPDATE/DELETE mà không phải BEFORE … FOR EACH ROW ⇒ NÉM (trigger TRUNCATE của hàm canh là chốt, hợp lệ); ⑧ `CAU_PARAMETER_ACL_SAI` — `pg_parameter_acl` cấp cho PUBLIC hay bốn vai ứng dụng ⇒ NÉM, không danh sách khai. Chiều ngược của ⑷⑸⑹ chỉ khi đối tượng cha tồn tại (bài học lượt soi 29). Bộ giải hằng tách thành `db/hardening-hang.ts` (`docHangHardening`, `khoiValues`) dùng chung cho hai tệp test. Test (`[INV-H19]` 25 → 28): cổng *hai bản khớp* cho ba danh sách qua bộ giải; năm câu phán xét của hardening chạy trong test — hôm nay rỗng; fixture trong giao dịch: view `security_invoker` và bảng phân mảnh KHÔNG bị phán, view INSTEAD OF / matview / bảng ngoài (`file_fdw`) bị; `suppress_redundant_updates_trigger`; rule trên `sessions`; hàm canh AFTER ROW và cấp câu lệnh bị, trigger TRUNCATE và BEFORE INSERT ROW của nó không; `GRANT SET … TO app_api` và `GRANT ALTER SYSTEM … TO PUBLIC`; `migrate()` NÉM ngoài giao dịch cho ⑷⑸⑧ với đối chứng; hai kỳ vọng cũ lật có chủ đích: `zz_rule` (khoản 73) và `zz_cau` (khoản 75) nay NÉM ở ⑹/⑺. **Đỏ đo được, cô lập từng mục (năm đột biến, mỗi ca khôi phục bản gốc trước khi áp):** ⑷ thành no-op ⇒ đỏ ở *migrate() NÉM* của ca view có INSTEAD OF; ⑸ no-op ⇒ đỏ ở ca trigger `suppress_redundant_updates_trigger`; ⑹ no-op ⇒ đỏ ở test `zz_rule` (khoản 73, kỳ vọng lật); ⑺ no-op ⇒ đỏ ở test `zz_cau` (khoản 75, kỳ vọng lật); ⑧ no-op ⇒ đỏ ở ca `GRANT SET ON PARAMETER … TO app_api`. Mỗi ca đỏ đúng một khẳng định `toMatch(/^NÉM/)`, các khẳng định trước nó vẫn xanh. **LƯỢT SOI ĐỐI KHÁNG 30 — KHÔNG CAO, KHÔNG NẶNG; SÁU NHẸ, BẢY INFO; mười xử lý trong vòng, ba ghi nhận.** Người soi không tìm được đường lách nào bằng đọc cho ⑷⑸⑹⑺⑧ trong phạm vi §3⑶; các phát hiện là trôi tiềm ẩn, nhãn sai, thứ cần đo. ⒜ NHẸ, sửa: chiều ngược ⑷ không neo vào "cha" tồn tại (schema) — cùng lớp lượt 29 CAO-1, tiềm ẩn vì danh sách rỗng — thêm `EXISTS pg_namespace`; vị từ hàm canh chép nguyên văn lần hai cho ⑺ — tách `VI_TU_HAM_CANH_HINH_DANG` dùng chung với mục S1.36, test đòi cả hai mục tham chiếu và danh sách tên bằng `HAM_CANH_CHI_GHI_THEM`; ⑧ ghim bốn tên vai lần hai và đọc ACL thô nên không thấy quyền qua nhóm (BƯỚC 1 che, không nói ra) — nay `VAI_KET_NOI_UNG_DUNG` + `pg_has_role` bắc cầu trên grantee (bản đầu sửa bằng `has_parameter_privilege` gắn vào từng dòng ACL kê cả dòng của người cấp — đo, đổi); `ALTER DATABASE … SET session_replication_role` (superuser) sống qua `migrate()` trong khi ⑧ tuyên bố đóng tiền đề SUSET — thêm mục thứ ba `pg_db_role_setting` RESET, tự chữa, đo; `to_regclass` nối chuỗi không quote — tên chữ hoa bị phán *thiu* vĩnh viễn — `format('%I.%I')` ở sáu chỗ kể cả hai chỗ S1.38; chưa có đối chứng dương cho ⑹⑺ — thêm (gỡ rule/trigger ⇒ đi qua; bản đầu của đối chứng ⑺ dựng lại BEFORE ROW làm bảng thành chỉ-ghi-thêm thiếu chốt — đo, đổi thành DROP). ⒝ INFO, sửa: nhãn ⑷ gọi matview là *đích DML* và gọi view có trigger cấp câu lệnh là *INSTEAD OF* — tách nhánh; nhãn ⑺ gọi INSTEAD OF là *AFTER* — thêm nhánh; thông điệp ⑺ không nói chốt TRUNCATE hợp lệ — thêm; fixture bảng ngoài tựa `file_fdw` — guard nêu tên. ⒞ Ghi nhận, không sửa: bộ giải hằng cắt ở `)` đầu (đã nói ở lượt 29); cổng ⑷ tách tên bằng `.` (danh sách rỗng); fixture [Task 6] constraint trigger AFTER DELETE của `chan_sua_xoa` — ⑺ thấy hình dạng ấy nhưng D2 dựng lại ở lượt sửa trước khi ⑺ đọc (chạy trọn `migrations.int.test.ts`: 94/94 — đúng như người soi suy). Khớp: `_RETURN` kín hai chiều; view trơn không updatable ném 55000; mặt nạ bit đúng bốn góc; `LANGUAGE sql` không viết được hàm trigger; hàm C kiểm `CALLED_AS_TRIGGER`; lược đồ thật của kho không có view/rule/bảng ngoài/`GRANT ON PARAMETER`, mọi `FOR EACH STATEMENT` là TRUNCATE, mọi AFTER có RETURN. | `db/migrations/hardening.always.sql`, `db/rls-coverage.int.test.ts`, `db/hardening-suy-tu-tinh-chat.int.test.ts`, `db/migrations.int.test.ts`, `docs/DECISIONS.md` ADR-036 §3⑶ |
| 84 | **[ĐÓNG]** **[S1.38, lượt soi 29 INFO-9] `LA_CUA_BANG_TENANT` CHỈ MỘT BẬC `pg_inherits`: CHÁU CỦA BẢNG TENANT Ở SCHEMA KHÁC KHÔNG VÀO `VI_TU_CAN_CO_RLS`.** Vế "con của bảng tenant" (vòng fix 3 — Minor) chỉ nhìn cặp cha–con trực tiếp với cha là bảng tenant ở `public`. Một cháu `k.c2 INHERITS (k.c1)` với `k.c1 INHERITS (public.users)`, cả hai ở schema khác `public`: mục (A) không bật RLS trên `k.c2`, ⑶ không thấy (RLS chưa bật), ⑵ không thấy (không RLS) — `GRANT SELECT ON k.c2 TO app_api` ⇒ đọc thẳng cháu thấy hàng mọi tổ chức. Đây là lỗ RÒ (không phải 0-hàng-im-lặng), cùng họ *bậc tự do còn lại* đã ghi ở chú thích `VI_TU_CAN_CO_RLS`; ~~**chưa đo** — người soi viết đường đo, chưa ai chạy~~ [S1.40 đo]. Đường đóng: `LA_CUA_BANG_TENANT` thành CTE đệ quy trên `pg_inherits` (mọi hậu duệ), kèm ca đo hai bậc ở `migrations.int.test.ts` và đột biến. Tiền điều kiện là DDL + GRANT tường minh do người dự án viết — nói ra. **[S1.40] ĐÓNG — mã sản xuất:** `LA_CUA_BANG_TENANT` là bao đóng bắc cầu của `pg_inherits` (`WITH RECURSIVE` không tương quan). Đo đúng đường người soi 29 viết: `k.c2 INHERITS k.c1 INHERITS public.bao_gia`, `GRANT SELECT ON k.c2 TO app_api` — TRƯỚC: đọc thẳng cháu thấy 777 của tổ chức khác (lỗ RÒ thật); SAU `migrate()`: mục (A) bật ENABLE+FORCE trên cả con lẫn cháu, đọc thẳng `[]`, 83⑵ kêu đúng `k.c2`; `public.g INHERITS (k.c1)` được [CR1] miễn policy riêng (trước S1.40 bị NÉM vì cha trực tiếp không phải bảng tenant public). Đột biến một bậc đỏ ở cờ của cháu, và ở `g` khi tắt hai khẳng định đứng trước. `migrate()` ≈ 600 ms ở cả ba bản hardening (đo) — không hồi quy. Kèm (lượt soi 31 NHẸ-4): vế con cháu lọc `MAU_SCHEMA_DU_AN` (loại `pg_temp`) — bảng tạm kế thừa bảng tenant từng làm mục (A) ALTER bảng tạm của phiên khác (0A000, BƯỚC 2 nuốt) rồi phán sai nó là bảng tenant thiếu RLS (đo); `MAU_SCHEMA_DU_AN` dời lên trước `VI_TU_CAN_CO_RLS`. | `db/migrations/hardening.always.sql` (`LA_CUA_BANG_TENANT`, `VI_TU_CAN_CO_RLS`), `db/migrations.int.test.ts` |
| 85 | **[ĐÓNG]** **[S1.40, lượt soi 31 — điều 2 mang sang vòng sau] BẬC TỰ DO "BẢNG CÓ `org_id` NGOÀI `public` KHÔNG TREO DƯỚI BẢNG TENANT" NAY CÓ BA KẼ TỰA VÀO.** Ghi ở chú thích `VI_TU_CAN_CO_RLS` từ vòng fix 3 là *nói ra thay vì hứa suông*; S1.40 đọc ra ba đường cùng đổ về đó: ⑴ (31 NHẸ-1) cặp `KE_THUA_KHAI` đã khai bị NO INHERIT rồi TÁI DÙNG TÊN — chủ bảng RENAME con cũ, dựng con mới cùng tên rỗng kế thừa cha, DISABLE RLS trên con cũ: cả hai chiều của 82⑴ im, hàng cũ nằm ở con cũ ngoài mọi mục; ⑵ (31 NHẸ-3) lá phân mảnh ngoài public tạo-và-DETACH giữa hai lần deploy — cùng cơ chế ADR-036 hàng 22 ở vị trí khác; ⑶ (31 NHẸ-4, nửa) bảng ngoài public chỉ được nhận diện là tenant qua `pg_inherits`. Cả ba NGỦ hôm nay: `KE_THUA_KHAI` rỗng, lược đồ thật không có bảng `org_id` ngoài public. Bài học ghi thêm vào ba bài cũ: *dòng khai theo tên chỉ đóng băng lời khai, không đóng băng đối tượng*. Đường đóng: mục phán xét "bảng có cột `org_id` trong `MAU_SCHEMA_DU_AN` mà ngoài `VI_TU_CAN_CO_RLS` và không RLS ⇒ phải khai" — bán kính nổ toàn repo đã ghi ở chú thích ấy (kéo theo nguồn (i)/(ii) và mục (C)); đo trên fixture `khac`/`k` trước khi viết. **[S1.41] ĐÓNG — mã sản xuất:** KHÔNG nới `VI_TU_BANG_TENANT` (bán kính nổ), mà một mục PHÁN XÉT: bảng (r/p) trong `MAU_SCHEMA_DU_AN` có cột `org_id`, ngoài `VI_TU_CAN_CO_RLS`, KHÔNG bật RLS ⇒ phải khai ở `BANG_ORG_ID_NGOAI_PUBLIC_KHAI` (rỗng); bật RLS thì mục im và 83⑶ đòi khai — hai mục kề nhau phủ kín, không chồng (`NOT relrowsecurity` / `relrowsecurity`). Hình dạng là MỘT hằng `VI_TU_HINH_DANG_85` dùng ở hai chiều, vế `org_id` là `MAU_VI_TU_CO_ORG_ID` dùng chung với vị từ tenant (lượt soi 32). Đo: bảng `zz_s85.t` ngoài public, GRANT cho app_api ⇒ tổ chức A đọc thấy hàng của B (lỗ RÒ), `migrate()` NÉM ở 85; ba kẽ: con NO INHERIT và lá DETACH trước khi `migrate()` chạm ⇒ 85, sau khi (A) đã bật RLS ⇒ 83⑶; chuỗi RENAME + tái dùng tên + DISABLE RLS con cũ ⇒ 85 kêu đúng con cũ. Ba fixture cũ lật kỳ vọng có chủ đích (`kho.cha`/`kho.audit_events`, `bao_cao.audit_events` — cùng hình dạng, NÉM đúng một mục, lượt sửa vẫn trọn). Đột biến đỏ cô lập: chiều xuôi no-op ⇒ census + ĐO + ba fixture; chiều ngược no-op ⇒ *dòng khai thiu*. Ranh giới còn lại có địa chỉ: khoản 86. | `db/migrations/hardening.always.sql` (`VI_TU_CAN_CO_RLS`, `KE_THUA_KHAI`, `CAU_ORG_ID_NGOAI_PUBLIC_SAI`), `db/rls-coverage.int.test.ts`, `db/migrations.int.test.ts` |
| 86 | **[ĐÓNG]** **[S1.41, lượt soi 32 INFO-6 + điều 3 mang sang] RANH GIỚI THEO TÊN CỘT `org_id` — BẢNG ĐA TỔ CHỨC ĐẶT TÊN CỘT KHÁC, Ở MỌI SCHEMA KỂ CẢ `public`, KHÔNG THUỘC VỊ TỪ NÀO.** `CREATE TABLE k.t (gia int, to_chuc uuid REFERENCES public.organizations(id)); GRANT … TO app_api` ⇒ 85 im (không cột tên `org_id`), 83⑵/⑶ im (không RLS), 82⑴ im, hàng 16 im, (A)/[CR1]/(C) im — và `public.t` cùng hình dạng cũng im y hệt: đây là ranh giới sẵn có của `MAU_VI_TU_BANG_TENANT` (vế cột tên `org_id`; vế khoá ngoại chỉ nhận ĐÍCH `id` ở public), không phải bậc tự do 85 mở lại. Đã nói ở chú thích 85 và ở `[M1 / S1.20]`; nay có địa chỉ. ~~Đường tính-chất khả dĩ: *có khoá ngoại một cột trỏ tới `organizations(id)` từ bất kỳ schema, bất kỳ tên cột* — nhưng đó là đổi `MAU_VI_TU_BANG_TENANT`, đúng bán kính nổ mà 85 cố ý tránh (nguồn (i)/(ii), mục (C), khuôn policy `org_id = app_current_org_id()` ghim tên cột); cần một vòng riêng, đo trên lược đồ thật trước.~~ **[S1.46]** đóng bằng một mục phán xét riêng, KHÔNG đổi `MAU_VI_TU_BANG_TENANT` (lượt soi ngang 40b #4 gạch). Tiền điều kiện là DDL do người dự án viết cố ý đặt tên khác quy ước. **[S1.42, lượt soi 33a #6 — ĐO]** Đường hai câu cộng hai DROP POLICY trên `users`: `RENAME COLUMN org_id TO to_chuc; DISABLE ROW LEVEL SECURITY; DROP POLICY users_tenant_isolation; DROP POLICY users_khach` ⇒ `migrate()` **đi qua**, app_api gắn A đọc thấy hàng của B. Bản không xoá policy thì 83⑴ bắt (biểu thức `to_chuc = …` không thuộc lớp nào) — tức thứ chặn hôm nay là policy SÓT, không phải danh tính bảng. Cùng bài học với khoản 89: danh tính đối tượng neo theo TÊN/HÌNH DẠNG, không theo `oid`; lớp "bảng có policy mà RLS tắt phải khai" không đủ (policy đã xoá). **[S1.43] NỬA ĐO ĐƯỢC ĐÓNG (ADR-037):** bảng tenant ĐÃ KHAI rời tập theo hình dạng nay bị bắt — đổi tên cột ⇒ ⑵+⑹, đổi tên bảng ⇒ ⑴+⑸, đổi tên cột rồi thêm cột `org_id` mới DEFAULT A ⇒ ⑵′ (attnum, lượt soi 35 NẶNG-5), CHÉP bảng bỏ cột `org_id` đè lên tên cũ (dữ liệu không mất — lượt soi 34 NẶNG-3) ⇒ ⑹; đo trên `users`. ~~**Nửa gốc VẪN MỞ:** bảng đa tổ chức MỚI đặt tên cột khác `org_id` không thuộc vị từ nào nên không bao giờ được khai hay neo — vẫn cần đường tính-chất (khoá ngoại tới `organizations(id)` từ bất kỳ cột/schema).~~ **[S1.46]** đóng (dưới). Lượt 33a #13 (trigger plpgsql có RETURN chép NEW sang bảng không `org_id` rồi GRANT) cùng lớp — vế ⒝ của §3⑶, nhân chứng chỉ ở CI. **[S1.46] NỬA GỐC ĐÓNG bằng đường TÍNH CHẤT, không nới vị từ tenant:** mục phán xét `CAU_KHOA_NGOAI_TENANT_SAI` — bảng (r/p) trong lược đồ dự án, KHÔNG có cột `org_id`, có khoá ngoại MỘT cột — của chính nó hay của một TỔ TIÊN INHERITS (PostgreSQL không kế thừa khoá ngoại, lượt soi 38 A2) — trỏ tới một BẢNG TENANT theo tính chất (`MAU_VI_TU_BANG_TENANT` khai triển với bí danh riêng: `organizations` LẪN `users`, `rfq_packages`… — lượt soi 38 A1 bác bản đầu chỉ nhận gốc: `rfq uuid REFERENCES rfq_packages(id)` buộc hàng vào tổ chức gián tiếp, cùng lớp; `008_suppliers.sql` đã gọi khoá ngoại một cột tới `suppliers(id)` là "LỖ THẬT", mọi khoá ngoại thật của kho là hợp thành `(org_id, x)`), ngoài tập tenant, không RLS ⇒ phải khai (`BANG_KHOA_NGOAI_TENANT_KHAI`, rỗng — lược đồ thật không có bảng như thế, cổng ở rls-coverage đo). Đo ở `db/rls-coverage.int.test.ts`: `zz_s86.t` LẪN `public.zz_t86` cùng hình dạng `(gia int, to_chuc uuid REFERENCES organizations(id))` + GRANT — app_api gắn A đọc thấy hàng của B (lỗ rò thật ở CẢ HAI schema), `migrate()` NÉM một dòng cho mỗi bảng nêu `(qua to_chuc -> public.organizations)`; khoá ngoại tới `users(id)` ⇒ thấy `(qua nguoi -> public.users)`; con INHERITS thừa cột không thừa khoá ngoại ⇒ thấy qua tổ tiên; có `org_id` ⇒ 85 không 86; bật RLS ⇒ 86 im, 83⑶ kêu; cột uuid trần ⇒ không; đổi tên cột thành `org_id` là cửa ra (ngoài public sang 85, ở public thành bảng tenant theo tính chất); chiều ngược bắt dòng khai thiu. Ba mục 85 / 86 / 83⑶ rời nhau theo (có `org_id`, có khoá ngoại tới bảng tenant, `relrowsecurity`). Năm đột biến đỏ cô lập (biên bản 61 ⑷). Mục này cũng ĐỘC LẬP đóng đường đo S1.42 trên `users` (khoá ngoại `to_chuc -> organizations` vẫn một cột ⇒ kêu kể cả khi ADR-037 ①② bị gỡ — lượt soi 38 C2). **Ranh giới nói ra:** cột uuid TRẦN (không khoá ngoại) ~~và khoá ngoại NHIỀU cột~~ **[S1.48, lượt soi ngang 40a H2]** khoá ngoại NHIỀU cột tới bảng tenant NAY TÍNH — `(to_chuc, nguoi) REFERENCES users (org_id, id)` là chính quy ước khoá ngoại của kho, bản S1.46 gọi là ranh giới là sai (đo: `zz_s.t_hop` bị thấy `(qua (to_chuc, nguoi) -> public.users)`, đột biến trả lại `array_length = 1` đỏ) — không tính chất catalog nào nhận diện cột uuid trần, là DDL cố ý bỏ ràng buộc tham chiếu; lượt 33a #13 thuộc lớp ấy (vế ⒝ §3⑶, nhân chứng chỉ ở CI). Khoá ngoại tới một bảng ĐÃ KHAI ở 85/86 (bậc kế trên đồ thị khoá ngoại) không tính — bao đóng đồ thị là vòng khác. Lá phân mảnh: ràng buộc nhân bản xuống lá nên TỪNG LÁ phải khai — cùng khuôn 85, đúng vì lá có `relrowsecurity` riêng (38 B1: giữ, nói ra). Cửa ra "bật RLS ⇒ 83⑶" là cửa yếu (không FORCE, view không `security_invoker` lên bảng ấy vô hình với (C)) — **khoản 91** (38 A3). | `db/migrations/hardening.always.sql` (`CAU_KHOA_NGOAI_TOI_TENANT`, `VI_TU_HINH_DANG_86`, `CAU_KHOA_NGOAI_TENANT_SAI`, `BANG_KHOA_NGOAI_TENANT_KHAI`), `db/rls-coverage.int.test.ts` |
| 87 | **[ĐÓNG]** **[S1.42, lượt soi ngang 33a #1 — CAO bị ĐO hạ] GUC `app.*` Ở MỨC DATABASE: BA MỤC GHIM TÊN, VÀ `withTenant` KHÔNG ĐẶT LẠI GUC KHÁCH Ở PHIÊN THƯỜNG.** Người soi chỉ ra: toàn bộ ranh giới tenant/khách từ 027/042/044 là năm GUC `app.*`, ba mục GUC mức database của hardening chỉ ghim `row_security`/`session_replication_role`/`search_path`, chú thích tự khai "GUC khác không được canh"; `ALTER DATABASE … SET app.org_id = B` sẽ lật [INV-F1] *chưa gắn ⇒ 0 hàng* thành *⇒ tổ chức B* cho mọi câu ngoài `withTenant`, và `SET app.guest_session_id` biến mọi phiên thành phiên khách ⇒ ~~21~~ **[S1.48 / 40b #2]** 29 (theo catalog — một mỗi bảng tenant, khuôn 027 do hardening dựng) policy RESTRICTIVE `_khach` thu hẹp ⇒ câu ghi của người mua 0 hàng không lỗi. **Đo (S1.42):** chủ database KHÔNG superuser bị **42501** khi `ALTER DATABASE … SET app.org_id` trên PostgreSQL 16 ~~(placeholder GUC chỉ superuser đặt được ở mức database) ⇒ vế ⒞ của §3⑶: test là đủ, không mức CAO~~ **[S1.47]** vai được `GRANT SET ON PARAMETER` cũng đặt được (đo), và có mục sản xuất. ~~Còn mở, có hình dạng mã: ⑴ mục hardening theo TÍNH CHẤT — mọi phần tử `setconfig` ở `pg_db_role_setting` (setrole = 0 hay vai ứng dụng, mọi setdatabase) phải nằm trong danh sách trắng GUC vận hành, đặc biệt không `app.%`; phán xét, không tự RESET; ⑵ `withTenant` đặt tường minh bốn GUC khách về rỗng trong MỌI giao dịch (lớp ứng dụng); ⑶ test đối chứng: chủ DB thường bị 42501 (đo nháp S1.42, chưa có test).~~ **[S1.47]** ba vế đóng (dưới; ⑵ là BA GUC khách, không phải bốn). Câu hỏi ngang kế: *mọi thứ policy/hàm ghim ĐỌC VÀO là gì, ai đặt được trước khi phiên bắt đầu* (GUC, `options=` trên chuỗi kết nối). **[S1.47] ĐÓNG cả ba vế, theo TÍNH CHẤT.** ⑴ Mục phán xét `CAU_GUC_TUY_BIEN_GAN_SAN` — GUC tuỳ biến (tên có dấu chấm — placeholder, thứ duy nhất policy/hàm dự án đọc vào) không được gắn sẵn cho phiên ứng dụng, NĂM nhánh cùng danh sách trắng `GUC_TUY_BIEN_KHAI` (rỗng): ⒜ `ALTER DATABASE … SET` (setrole 0); ⒝ hàng của vai kết nối ứng dụng (`VAI_KET_NOI_UNG_DUNG` ∪ `ROLE_CANH`, toàn cụm/IN DATABASE) và hàng `ALTER ROLE ALL SET` (0, 0 — lượt soi 39 NHẸ-1); ⒞ CHÍNH phiên deploy: `current_setting(tên, true)` trên tập tên suy từ văn bản policy/hàm dự án (`CAU_TEN_GUC_DU_AN_DOC`) khác rỗng mà không hàng catalog nào mang — `ALTER SYSTEM`/postgresql.conf/dòng lệnh/`options=` của chuỗi kết nối deploy, hay phiên mở trong cửa sổ SET đã RESET (lượt soi 39 NẶNG-2; ĐO: placeholder KHÔNG BAO GIỜ có ở `pg_settings`, `pg_file_settings` chỉ superuser đọc — nên đọc thẳng giá trị); ⒟ `pg_parameter_acl` cho tham số có dấu chấm với grantee không superuser (`GRANT SET ON PARAMETER app.org_id TO vai` — ĐO: vai thường SET/RESET được placeholder ở mức database sau GRANT, 42501 sau REVOKE; lượt soi 39 NHẸ-2); ⒠ `proconfig` của hàm trong lược đồ dự án (lượt soi 39 NHẸ-5). Không tự RESET — ĐO: chủ database thường bị 42501 ở SET lẫn RESET placeholder, và `ALTER ROLE … RESET ALL` dưới vai thường GIỮ IM LẶNG phần tử placeholder (bốn mục RESET ALL chỉ tự chữa trọn khi superuser — cùng đỏ với mục 87, lượt soi 39 NHẸ-3). GUC vận hành không dấu chấm cố ý ngoài mục ([I3]); GUC extension có dấu chấm ở mức database/vai ứng dụng bị bắt tới khi khai (quyết định nói ra, INFO-1). Không in giá trị. ⑵ `withTenant`: BEGIN và đọc bốn GUC trong CÙNG round-trip — đã có giá trị lúc mở giao dịch là mặc định phiên ⇒ TỪ CHỐI phục vụ trước `fn` (TenantError nêu tên, không huỷ kết nối — pid ổn định; lượt soi 39 NHẸ-4: bản đầu huỷ kết nối mỗi lượt với chẩn đoán sai); rồi một câu đặt `app.org_id` VÀ xoá ba GUC khách về '' (lớp hai — đột biến bỏ riêng nó SỐNG vì phép từ chối đứng trước, nói ra); `finally` đọc cả bốn trục (NULLIF trần — `pg_catalog.nullif`/`pg_catalog.coalesce` không tồn tại, lỗi bị nuốt ⇒ mù, đo). ⑶ Test `migrations.int.test.ts` "[khoản nợ 87]" (~~mười vế~~ tám vế có nhãn a, b, a′, e, c′, c, b′, d — 40b #14) và `with-tenant.int.test.ts` describe S1.47 (hai). Tám đột biến đỏ cô lập. **[S1.48 / 40a NẶNG-1]** bản S1.47 gộp "rò phạm vi phiên từ mã ngoài withTenant" vào "mặc định phiên" và trả kết nối nhiễm về pool (hồi quy I1) ⇒ sau ROLLBACK, `withTenant` RESET bốn GUC rồi đọc lại: rỗng ⇒ rò phiên ⇒ HUỶ kết nối, thông điệp đúng nguồn; còn ⇒ mặc định thật ⇒ giữ (đo cả hai chiều). **Ranh giới nói ra:** `options=` trên chuỗi kết nối của PHIÊN ỨNG DỤNG (withTenant từ chối, câu ngoài withTenant thì không ai thấy); ~~vai deploy bị `ALTER ROLE trien_khai SET` (ngoài tập, INFO-5)~~ **[S1.48 / 40a I1]** sai chiều: hàng ấy không thuộc ⒝ nên nhánh ⒞ THẤY — nhưng chỉ ở BƯỚC 3, SAU khi migration đánh số cùng lượt đã chạy dưới B và ghi checksum (40a H1) ⇒ `migrate()` nay đọc bốn GUC và **từ chối trước lượt sửa** (đo: migration tạm không chạy, không dòng `schema_migrations`); trigger `set_config` giữa giao dịch; tên có dấu chấm KHÔNG được policy/hàm nào đọc thì nhánh ⒞ không hỏi. Ba mục kề (row_security/session_replication_role/search_path mức database) không thấy hàng `ALTER ROLE ALL` — **khoản 92**. | `db/migrations/hardening.always.sql` (`CAU_TEN_GUC_DU_AN_DOC`, `VI_TU_HANG_CAU_HINH_UNG_DUNG`, `CAU_GUC_TUY_BIEN_GAN_SAN`, `GUC_TUY_BIEN_KHAI`), `packages/tenancy/src/with-tenant.ts`, `db/migrations.int.test.ts`, `packages/tenancy/src/with-tenant.int.test.ts` |
| 88 | **[ĐÓNG]** **[S1.42, lượt soi 33a #2 NẶNG; kèm #3, #8, #10, #11 và 33b #13] MỤC 83⑵ GHIM BỐN TÊN VAI — BẢN CHÉP THỨ BA CỦA DANH SÁCH TÊN — VÀ CÁC VIỆC "KÈM KHI MỞ TỆP HARDENING".** `CAU_PHU_LENH_SAI` khai `('app_api','app_unseal','app_api_login','app_unseal_login')` trong khi ⑧ cùng vòng sau đã đổi sang `VAI_KET_NOI_UNG_DUNG` vì đúng lý do này (lượt 30 NHẸ-3); tập bốn tên chỉ bằng tập thật nhờ BƯỚC 1 gỡ membership — tựa mục khác không nói ra. Kèm: ⑴ `MAU_SCHEMA_DU_AN` còn ba bản chép inline (mục (C) hai chỗ view/SECDEF, `VI_TU_BANG_CHI_GHI_THEM` — test đòi nguyên văn nên đổi test dựng qua bộ giải); ⑵ thông điệp `CAU_TRIGGER_CANH_CO_DIEU_KIEN` thiếu nhãn khoản 79/hàng 20, `CAU_HAM_CANH_HINH_THUC_SAI` thiếu hàng 2; ⑶ chú thích 79/⑺ nói ra rằng trên bảng có tên D2 sửa trước, mục chỉ chịu lực cho bảng suy ra; ⑷ hai chú thích "BẬC TỰ DO CÒN LẠI" cũ chưa gạch (RESTRICTIVE no-op nay phải khai ở 83⑴; bảng tenant ngoài public nay 83⑶/85); ⑸ bộ giải hằng ném khi tham số `format` chứa `$`, `,`, `(`, `)` (33a #8); ⑹ FK `ON DELETE CASCADE` qua BEFORE ROW của bảng con — lượt 27 ghi *chưa đo* qua sáu vòng (33b #18). Hardening đổi ⇒ mã sản xuất, đột biến đỏ cô lập cho ⑴ chính. **[S1.44] ĐÓNG — mã sản xuất:** `CAU_PHU_LENH_SAI` lấy tập vai từ `VAI_KET_NOI_UNG_DUNG` (thành viên bắc cầu của app_api/app_unseal, trừ superuser), hết bản chép thứ ba — đo trong một test, một fixture: vai lạ thành viên app_api + GRANT DELETE trên bảng RLS chỉ có policy SELECT ⇒ bản bốn tên (dựng lại từ chính câu mới) **IM**, tính chất kêu đúng `public.zz_t88/zz_vai88/DELETE`; đột biến trả hằng về bốn tên ⇒ đỏ. ⑴ hết ba bản chép inline: (C) view/matview, (C) SECDEF, `VI_TU_BANG_CHI_GHI_THEM` đều `format(MAU_SCHEMA_DU_AN, 'n')`; test đòi nguyên văn QUA BỘ GIẢI (`docHangHardening("VI_TU_BANG_CHI_GHI_THEM")` = bản sinh ở test, vế schema đọc từ chính hằng); đột biến khoá cứng `public` ở VI_TU ⇒ đỏ ở khẳng định ấy, ở nhánh SECDEF ⇒ `[I3] SECDEF ở schema khác` lọt `migrate()` (đỏ). ⑵ hai nhãn (khoản 79 / ADR-036 hàng 20; hàng 2). ⑶ chú thích "trên bảng có tên D2 sửa trước, mục chịu lực cho bảng suy ra" ở cả hai mục. ⑷ hai chú thích gạch, kèm địa chỉ mục thay thế (83⑴ / 84·83⑶·85). ⑸ bộ giải: văn phạm tham số `format()` chỉ nhận bí danh đơn hoặc mẫu `%n$s` CHUYỀN TIẾP (hình dạng thật của `MAU_VI_TU_BANG_TENANT` → `MAU_VI_TU_CO_ORG_ID`, chính ca 33a #8 — bộ giải nghiêm bắt được ngay); split/join thay `replaceAll`; kiểm thiếu tham số TRƯỚC khi thay; tên hằng có đệm khoảng trắng (`COT_NEO` từng vô hình). Test T1 mới `db/hardening-hang.test.ts` (4 ca, kể cả đối chứng trên tệp thật: mọi hằng dùng `format()` giải được, không còn `%n$s` ngoài `MAU_*`). Cùng bẫy ấy cắn ngay bản đầu của test ⑺: `String.replace` hiểu `$'` trong `$q$'x'$q$` là "phần sau chỗ khớp" ⇒ syntax error giữa tệp — đổi split/join, ghi ở chú thích. ⑹ ĐO (lượt 27 "chưa đo"): FK `ON DELETE CASCADE` ⇒ BEFORE DELETE ROW của con NÉM từ chính hàm canh; `SET NULL` ⇒ BEFORE UPDATE ROW NÉM; `TRUNCATE … CASCADE` ⇒ trigger TRUNCATE của con NÉM; hàng cha lẫn con còn nguyên (3/1/1/1); đối chứng con không hàm canh ⇒ hàng mất; tổng điều tra: FK trỏ ra từ năm bảng chỉ-ghi-thêm đều NO ACTION. ⑺ (mang sang từ lượt soi 35 ⑶, cùng lớp "khi mở tệp hardening") BƯỚC 2 cột điều kiện và BƯỚC 3 trọn mục bọc `EXCEPTION WHEN OTHERS`: ném ⇒ WARNING + không sửa / một dòng `KHÔNG ĐÁNH GIÁ ĐƯỢC` nêu tên mục, SQLSTATE, SQLERRM vào bản gom (mục không được coi là đúng), vòng đi tiếp. Đo bằng hardening chép ra thư mục tạm với ba mục tiêm (điều kiện 1/0; hậu điều kiện 1/0; hậu điều kiện sai) ⇒ một thông báo `(phan_xet)` gom ba dòng đúng ba tên; kho thật đi qua sau đó. Đột biến bỏ khối BƯỚC 3 ⇒ `division by zero` TRẦN không tên mục; bỏ khối BƯỚC 2 ⇒ lượt SỬA gãy `(sua)` — đúng ngõ cụt bản đầu S1.43 (12 test N2). KHÔNG làm: D2/`CTE_TRIGGER_CHAN` theo tên — tách thành **khoản 90**. **Lượt soi 36 (1 NẶNG, 4 NHẸ, 4 INFO) bác bản "chỉ tính chất":** NẶNG-1 — membership là thứ ADMIN OPTION đổi được: `REVOKE app_api FROM app_api_login` + GRANT trực tiếp ⇒ kết nối thật đọc 0 hàng không lỗi mà tập theo membership không còn chứa nó, bản bốn tên lại thấy ⇒ tập vai = TÍNH CHẤT ∪ `ROLE_CANH` (hằng dời lên trước, một bản — đo: app_api_login dựng trong giao dịch, bản chỉ-tính-chất IM); NHẸ-2 quyền xét theo KẾ THỪA như 83⑧ (`pg_has_role … 'USAGE'`), mô tả nêu `(qua nhóm)` — đo: GRANT cho nhóm mà app_api là thành viên, bản grantee-trực-tiếp IM; NHẸ-3 **ĐO hồ sơ N3** (cụm trống, vai deploy CREATEROLE chạy `migrate()` đầu tiên): PostgreSQL 16 cấp cho vai tạo role membership ngầm chỉ-admin (INHERIT FALSE, SET FALSE, grantor superuser bootstrap) ⇒ với `'MEMBER'` vai deploy lọt `VAI_KET_NOI_UNG_DUNG` ⇒ mục "quyền CREATE/TEMP trên database của vai ứng dụng và mọi thành viên" THU HỒI CREATE của chính chủ database ⇒ 001 gãy thô — tiền tồn từ S1.34; sửa `'MEMBER'` → `'USAGE' OR 'SET'` (kết nối ứng dụng = kế thừa hoặc SET ROLE được), N3 nay đi qua 49 migration, vai deploy ngoài tập, ⑵ rỗng, và dừng ở phán xét với đúng MỘT mục có tên (membership lạ vai deploy không tự gỡ được) + lối ra (superuser REVOKE một lần ⇒ đi qua) — `migrations.int.test.ts` 101 → 102; NHẸ-4 bộ giải ĐÓNG (`%s`/`%I`/`%` lẻ ⇒ ném; miễn mẫu tính từ chính tệp, không theo tiền tố tên); NHẸ-5 hai câu membership đầu BƯỚC 3 cùng khuôn không gãy thô; INFO-6 (tiêm 42501 dưới N2) ghi ranh giới; INFO-7 nhãn hàng 8–9/20; INFO-8 FK census ⊆; INFO-9 xác nhận test ⑺ không để lại gì. | `db/migrations/hardening.always.sql` (`CAU_PHU_LENH_SAI`, `VAI_KET_NOI_UNG_DUNG`, `ROLE_CANH`, `MAU_SCHEMA_DU_AN`, mục (C), `VI_TU_BANG_CHI_GHI_THEM`, BƯỚC 2/3), `db/hardening-hang.ts`, `db/hardening-hang.test.ts`, `db/hardening-suy-tu-tinh-chat.int.test.ts`, `db/rls-coverage.int.test.ts`, `db/migrations.int.test.ts` (N3) |
| 89 | **[ĐÓNG]** **[S1.42, lượt soi ngang 33a #5 — NẶNG, ĐO] SỔ KIỂM TOÁN KHAI THEO TÊN: ĐỔI TÊN BẢNG SỔ RỒI DỰNG BẢNG CÙNG TÊN CÙNG HÌNH DẠNG ⇒ `migrate()` ĐI QUA, LỊCH SỬ NẰM Ở BẢNG KHÔNG MỤC NÀO CANH.** Đo trên PostgreSQL 16 sạch: `ALTER TABLE audit_events RENAME TO audit_events_cu; DROP TRIGGER` bốn trigger; `CREATE TABLE audit_events (LIKE audit_events_cu INCLUDING ALL)` + RLS/FORCE + policy đúng khuôn + GRANT + `DROP POLICY audit_events_khach ON audit_events_cu` ⇒ `migrate()` **OK**; D2 dựng sáu trigger lên bảng MỚI rỗng (`chan_delete/chan_truncate/chan_update/noi_chuoi`), bảng cũ giữ 1 hàng lịch sử, không trigger, không mục nào canh; chuỗi hash "bắt đầu lại". Bản không xoá policy sót thì 83⑴ bắt — nhờ `POLICY_RESTRICTIVE_KHAI` khai theo TÊN bảng, tức thứ chặn là một danh sách tên khác, không phải danh tính sổ. Lượt 28 INFO-11 chỉ đo RENAME + CREATE VIEW cùng tên (NÉM 4 mục); RENAME + CREATE TABLE cùng hình dạng chưa từng đo. Đường đóng: neo DANH TÍNH ngoài tên — ghim `oid` (hay `relfilenode`) của hai bảng sổ và của tập bảng tenant đã biết vào một bảng neo lúc 003 chạy (hoặc vào `schema_migrations`), hardening đòi khớp; hoặc mục phán xét *không quan hệ nào ngoài `public.audit_events` mang hình dạng sổ `MAU_HINH_DANG_SO`*. Bài học thứ năm bên cạnh bốn bài cũ: *danh tính theo tên hay hình dạng đều tái tạo được; chỉ `oid` là không*. Cùng lớp với đường đo mới của khoản 86. **[S1.43] ĐÓNG — mã sản xuất (ADR-037):** danh tính là BA KÊNH — ① chú thích bảng `neo: <schema>.<bảng>` sống theo oid (lượt sửa ghi, chủ bảng); ② `BANG_TENANT_KHAI` 29 tên kèm migration khai sinh + `BANG_CHI_GHI_THEM`; ③ hình dạng KHÔNG BỎ ĐƯỢC — bộ ba chuỗi `seq/prev_hash/hash` ngoài `public.audit_events`, bộ ba mốc neo ngoài `public.audit_chain_anchors` (bản "đủ 15 cột" bị lượt soi 35 CAO-1 lách bằng một RENAME cột phụ). Kênh ① neo cả attnum cột `org_id` (lượt soi 35 NẶNG-5: đổi tên cột rồi thêm cột mới DEFAULT A đi qua mọi vế). Bảy vế phán xét. Đo đúng kịch bản 33a #5: NÉM ở ⑴ (nêu tên cũ và oid bảng lạ) và ⑷ — kể cả sau khi xoá policy sót (83⑴ im) và sau khi gỡ chú thích (⑷ còn). ~~Đường đóng: ghim `oid` vào một bảng neo lúc 003 chạy~~ — bản đầu đúng như thế (bảng `app_private.neo_danh_tinh` + migration 049) và bị bác hai lần: 12 test hồ sơ N2 đỏ (vai deploy không USAGE `app_private` ⇒ 42501 ở cột điều kiện, lượt sửa gãy), rồi lượt soi 34 (chìa cạnh ổ khoá; khôi phục logic đổi oid; tự gỡ mở đường chép bảng); bản ba bị lượt soi 35 bác ở ba chỗ (hình dạng "đủ 15 cột"; cột `org_id` chưa neo; cụm cũ + vai deploy không sở hữu chặn deploy đầu — nay nói ra và ghim bằng test N2 nhánh 4). Đột biến đỏ cô lập ×4. Ranh giới: ① mạnh bằng quyền sở hữu (gỡ chú thích ⇒ ghi-lấp kèm WARNING; còn ②③); ~~D2 vẫn dựng trigger theo tên (khoản 88 kèm)~~ [S1.45] khoản 90 đóng — lớp SỬA đòi danh tính nhất quán. | `db/migrations/hardening.always.sql` (`MAU_NEO`, `BANG_TENANT_KHAI`, `CAU_NEO_SUA`, `CAU_NEO_SAI`), `db/migrations.int.test.ts`, `db/rls-coverage.int.test.ts` |
| 90 | **[ĐÓNG]** **[S1.44, tách từ khoản 88 "kèm" — lượt soi 34 #8, ADR-037 §5] LỚP SỬA D2/`CTE_TRIGGER_CHAN` ~~VẪN DỰNG TRIGGER THEO TÊN~~ **[S1.45]** đòi danh tính (dưới).** ~~`bang_so` nhận bảng sổ bằng `relname IN BANG_CHI_GHI_THEM` (trong `MAU_SCHEMA_DU_AN`)~~, nên ở kịch bản khoản 89 (đổi tên sổ, dựng bảng cùng tên) D2 dựng ~~sáu~~ bốn (lượt soi 37 INFO-9; 40b #5 gạch tại chỗ) trigger lên bảng GIẢ ở BƯỚC 2 trước khi lớp phán xét ADR-037 (⑴⑷) chặn deploy ở BƯỚC 3 — chặn được, nhưng lớp SỬA đã chạm một bảng không phải sổ và bảng thật không được sửa gì. ~~Đường đóng: `bang_so` đòi thêm chú thích neo khớp `MAU_NEO` (kênh ①) hoặc bộ ba chuỗi (kênh ③)~~ **[S1.45]** không đi đường này — đòi neo KHỚP làm sổ thật chưa neo rơi khỏi `bang_so` (40b #5 gạch tại chỗ); phải cân deploy đầu tiên (chưa có neo — lượt sửa ghi neo và D2 chạy cùng lượt, thứ tự trong `bang` quyết định) và cụm N2 bảng thuộc superuser (D2 vốn 42501 ở đó, ADR-037 §5). Không khẩn: lớp phán xét đã chặn; đây là ranh giới nói ra của ADR-037 §5. **[S1.45] ĐÓNG — mã sản xuất, vòng nhỏ:** `bang_so` = tên đã khai ∧ ⒜ chú thích neo của chính nó — nếu có — bằng tên hiện tại (`MAU_NEO` dời lên trước) ∧ ⒝ không quan hệ KHÁC trong lược đồ dự án mang neo nêu đúng tên này (bảng gốc RENAME/SET SCHEMA giữ chú thích theo oid ⇒ giữ danh tính, bảng cùng tên dựng sau là bản sao). Đo trên kịch bản 89: (b) bản sao **0 trigger**, bảng gốc 0 — lớp SỬA đứng yên, lớp PHÁN XÉT (⑴⑷) chặn; đột biến bỏ hai vế ⇒ 4 trigger (hành vi cũ). Ranh giới nói ra: (c) chủ bảng gỡ chú thích bảng gốc ⇒ danh tính rơi ⇒ D2 lại chữa bản sao (4) — kênh ① mạnh bằng quyền sở hữu ở CẢ HAI lớp, kênh ③ vẫn chặn deploy. Chưa có chú thích (deploy đầu; N2 bảng thuộc superuser) ⇒ ⒜ đi qua; `bang_al` không đổi. Không phải "đường đóng" ghi ở trên (đòi neo khớp) — đòi neo khớp làm bảng thật rơi khỏi `bang_so` ở deploy đầu; hai vế ⒜⒝ chỉ loại thứ danh tính KHÔNG NHẤT QUÁN, và mọi ca loại đều trùng một vế của `CAU_NEO_SAI` (⑴ neo lệch tên; ⑵′ attnum; ⑶ chú thích chiếm chỗ; ⑷ bản sao hình dạng) hoặc vế "KHÔNG TỒN TẠI" của D2 chặn cùng lượt. **Lượt soi 37 (1 CAO, 5 NHẸ, 3 INFO):** CAO-1 — bản đầu của ⒜ đòi neo bằng TÊN HIỆN TẠI nên bảng sổ thật bị `SET SCHEMA` (giữ neo `public.audit_events` theo oid) rơi khỏi `bang_so`: đảo đánh đổi [CR2a], lịch sử thật ở schema mới không được chữa (test CR2a đỏ theo đọc) ⇒ ⒜ so PHẦN TÊN và nhận cả neo nêu sổ ở `public` dù bảng ở schema nào — CR2a giữ 8 trigger, bản sao vẫn bị ⒝ loại; NHẸ-2 thông điệp "KHÔNG TỒN TẠI như một BẢNG THẬT" thêm nguyên nhân thứ tư (bản sao chiếm tên / chú thích khác) — test 89 (b) ghim; NHẸ-3 nút bấm decoy (chủ bảng lạ đặt `COMMENT … 'neo: public.audit_events'` làm sổ thật rời `bang_so`) — nói ra ở chú thích: lớp SỬA đứng yên nhưng ⑴ nêu đúng bảng lạ kèm oid sổ và vế KHÔNG TỒN TẠI đỏ cùng lượt; NHẸ-4 `CAU_NEO_SUA` cùng vế ⒝: KHÔNG trao neo cho bản chiếm tên (WARNING nêu oid giữ tên; bản sao ở lại ⑶) — nếu trao, bảng gốc mất neo sau đó là bản sao đi qua mọi vế; NHẸ-5 ⑵′ hết in NULL; NHẸ-6 (STATE tự mâu thuẫn — người soi đọc trước khi tài liệu ghi) đã khớp; INFO-8 (b) "bảng gốc 0" là tài liệu, không phải chứng cứ; INFO-9 "bốn trigger" không phải sáu. Test 89 thêm (e) đo riêng ⒜: chú thích lạ trên sổ thật + gỡ một trigger ⇒ D2 không chữa (3), NÉM nêu nguyên nhân thứ tư; đặt lại neo ⇒ chữa (4). | `db/migrations/hardening.always.sql` (`CTE_TRIGGER_CHAN`, `CAU_TRIGGER_CHAN_SAI`, `CAU_NEO_SUA`, `CAU_NEO_SAI` ⑵′), `db/migrations.int.test.ts` (test 89, CR2a) |
| 91 | **[ĐÓNG]** **[S1.46, lượt soi 38 A3 — đọc, chưa đo bằng test] CỬA RA "BẬT RLS ⇒ KHAI 83⑶" LÀ CỬA YẾU: BẢNG KHAI Ở 83⑶ (VÀ CỬA RA CỦA 85/86) KHÔNG BỊ ĐÒI FORCE RLS, VÀ VIEW KHÔNG `security_invoker` LÊN NÓ VÔ HÌNH VỚI MỤC (C).** DDL: `CREATE TABLE k.t (gia int, to_chuc uuid REFERENCES organizations(id)); ALTER TABLE k.t ENABLE ROW LEVEL SECURITY; CREATE POLICY p ON k.t USING (to_chuc = app_current_org_id()); CREATE VIEW k.v AS SELECT * FROM k.t; GRANT USAGE ON SCHEMA k TO app_api; GRANT SELECT ON k.v TO app_api` ⇒ 86 im (RLS bật), 83⑶ đòi khai `k.t` (một dòng, hợp lệ); `CAU_DOC_VONG` (mục (C)) chỉ neo view vào `MAU_VI_TU_BANG_TENANT` hoặc cột `org_id` của chính view ⇒ `k.v` vô hình; view chạy dưới quyền chủ bảng, bảng không FORCE ⇒ policy bị bỏ qua ⇒ app_api đọc mọi tổ chức qua `k.v`. Tiền tồn từ 83⑶ (S1.38); thông điệp 85 và 86 chủ động dẫn người sửa vào cửa ấy (86 nay nói "không FORCE"). Hình dạng mã: ⑴ (C) thêm vế "bảng đích thuộc `BANG_RLS_NGOAI_TENANT_KHAI` ∪ 85-khai ∪ 86-khai" — view/matview/SECDEF đọc bảng đã khai cũng phải khai; hoặc/và ⑵ 83⑶ đòi `relforcerowsecurity` với bảng đã khai (mục (A) chỉ FORCE tập tenant). Tiền điều kiện là chủ bảng tạo view — cùng hạng 85/86. Đo trước bằng DDL trên. **[S1.50] ĐÓNG cả hai vế, và cả hai đều RỘNG HƠN hình dạng ghi ở trên.** ⑴ Mục (C) KHÔNG CÒN VẾ ĐÍCH: ~~thêm vế "bảng đích thuộc `BANG_RLS_NGOAI_TENANT_KHAI` ∪ 85-khai ∪ 86-khai"~~ — lượt soi 42 NẶNG-1 dựng hai đường mà mọi vế đích đều hụt (CHUỖI VIEW LỒNG: `v2` không invoker trên `v1` invoker trên bảng — `pg_depend` chỉ nối view với quan hệ tham chiếu TRỰC TIẾP; VIEW ĐỌC QUA HÀM: rule phụ thuộc `pg_proc`, và nhánh "cột org_id của chính view" im khi view không chiếu cột ấy). Nay MỌI view/matview trong lược đồ dự án phải `security_invoker` (matview thì khai) — ĐỐI XỨNG với nhánh SECDEF vốn không có vế đích từ S0. ⑵ Mục TỰ CHỮA `VI_TU_FORCE_THIEU`: FORCE trên MỌI bảng bật RLS của lược đồ dự án (trừ đối tượng extension), không phải ~~bảng đã khai ở 83⑶~~ — bản đầu lấy chủ thể là danh sách khai và bị lượt soi 42 CAO-1 bác: danh sách ấy có đúng `public.caller_rate_limits`, bảng đã được mục S1.14 ENABLE+FORCE vô điều kiện, nên mục mới là NO-OP mà không đột biến CSDL nào làm đỏ được (ADR-028 §2⑷ cấm). **Đo dưới CHỦ BẢNG KHÔNG SUPERUSER** (lượt soi 42 CAO-2 bác fixture cũ: superuser bỏ qua RLS ở mọi cấu hình nên không phân biệt được ENABLE với FORCE): bảng chỉ ENABLE ⇒ app_api đọc thấy hàng của CẢ HAI tổ chức qua view non-invoker trong khi đọc THẲNG bảng chỉ thấy hàng của mình; `migrate()` FORCE ở lượt SỬA (kể cả khi 83⑶ còn đang chặn ở lượt phán xét) ⇒ cùng view hết rò. Mục (C) thấy cả bốn ca (view thường, view lồng, view qua hàm, matview) và `migrate()` NÉM nêu nguyên văn; `security_invoker = yes` — boolean hợp lệ của PostgreSQL — nay được nhận (lượt soi 42 NHẸ-3: regex cũ chặn deploy trên view ĐÚNG). Bốn đột biến đỏ cô lập (biên bản 65 ⑷). **Kỳ vọng LẬT có chủ đích:** test H19 `[khoản nợ 83⑷⑸⑧]` từng khẳng định *"view trơn không bị phán"* — nay một view hằng (`SELECT 1`, không chạm bảng nào) cũng phải đặt cờ, đúng cách nhánh SECURITY DEFINER cấm mọi hàm SECDEF kể cả hàm không chạm dữ liệu (phát hiện ở lượt evidence, không phải ở lượt soi). **Ranh giới nói ra:** sau FORCE, CHỦ BẢNG chịu RLS — một bảng có policy chỉ áp cho vai ứng dụng làm chủ bảng đọc/ghi 0 hàng KHÔNG LỖI (ADR-036 hàng 4/6), và 83⑵ không soi vai chủ: **khoản 94**. Cổng khoản 93 không phủ mục TỰ CHỮA mới (nó chỉ đòi khoá tra cứu cho mục PHÁN XÉT) — nói ra, và dòng lý do vẫn được viết tay vào ADR-036 hàng 7. | `db/migrations/hardening.always.sql` (`CAU_DOC_VONG`, mục 83⑶ `CAU_RLS_NGOAI_TENANT_SAI`) |
| 92 | **[ĐÓNG]** **[S1.47, lượt soi 39 NHẸ-1 — đọc, một vế đo] BA MỤC "ĐẶT Ở MỨC DATABASE" (row_security / session_replication_role / search_path) LỌC `setdatabase = <db hiện tại>` NÊN KHÔNG THẤY HÀNG `ALTER ROLE ALL SET` (setrole 0, setdatabase 0).** `ALTER ROLE ALL SET row_security = off` (superuser) áp cho mọi vai mọi database kể cả app_api ⇒ ba mục im, `migrate()` đi qua; hậu quả với vai thường là lỗi "query would be affected by row-level security" ở mọi câu chạm bảng RLS (sự cố sẵn sàng, đã ghi ở [fix round 4]); `search_path` thì là che tên (khoản 78). Câu sửa của ba mục là `ALTER DATABASE … RESET` — không đụng hàng (0, 0); hàng ấy chỉ `ALTER ROLE ALL RESET` bởi superuser. Mục 87 đã nhận diện hàng (0, 0) cho GUC có dấu chấm (đo: thông điệp "mọi vai, mọi database (ALTER ROLE ALL)"), ba mục kề chưa. Hình dạng mã: nới vị từ ba mục sang `setdatabase IN (0, <db>)` với `setrole = 0`, câu sửa thêm `ALTER ROLE ALL RESET` (SUSET — vai deploy thường không làm được ⇒ hậu điều kiện không bao giờ đúng ⇒ chặn vĩnh viễn; nên tách thành vế PHÁN XÉT như 87). Chưa đo bằng test. **[S1.48, lượt soi ngang 40a H5] Hình dạng rẻ hơn và đủ hơn:** với GUC KHÔNG dấu chấm, chính phiên deploy đọc được `pg_settings.reset_val` (thứ placeholder không có) — một vế phán xét `reset_val IS DISTINCT FROM boot_val` cho ba tên (search_path so với `"$user", public`) gộp cả `ALTER ROLE ALL`, `ALTER SYSTEM`, postgresql.conf, `options=`; `migrate()` tự `SET search_path` không nhiễu vì so `reset_val`, không so `setting`. Hậu quả đã cân: `row_security=off` ⇒ lỗi "query would be affected" (sẵn sàng), `replica` ⇒ trigger `A` vẫn chạy (ALWAYS), `search_path` ⇒ che tên (khoản 78 — `CAU_QUAN_HE_TRUNG_TEN` chỉ soi quan hệ, không soi hàm cùng tên). **[S1.51] ĐÓNG — mã sản xuất, và trục RỘNG HƠN cả hai hình dạng ghi ở trên.** ~~nới vị từ ba mục sang `setdatabase IN (0, <db>)`~~ và ~~một vế phán xét `reset_val IS DISTINCT FROM boot_val` cho ba tên~~ — cả hai đều hụt, lượt soi 43 NẶNG-1 dựng ca bác bản chỉ-`pg_settings`: PostgreSQL xếp ƯU TIÊN NGUỒN (`file < argv < global < database < user < database user < client`) nên một hàng ưu tiên CAO CHE hoàn toàn hàng thấp — `ALTER DATABASE d SET row_security = on` (đúng giá trị) che `ALTER ROLE ALL SET row_security = off`, phiên deploy thấy `on`, lượt SỬA xoá hàng che SAU khi `source` của phiên đã chốt ⇒ mục im và tàn dư `global` sống qua MỌI lượt deploy. Nay `CAU_GUC_VAN_HANH_GAN_SAN` có BA nhánh: ⒜ CATALOG — mọi hàng `pg_db_role_setting` mang một trong ba tên, TRỪ đúng hàng `(setrole = 0, setdatabase = <db hiện tại>)` mà ba mục kề sở hữu; không hỏi `source`, không hỏi giá trị hiệu lực nên miễn nhiễm cả ưu tiên nguồn lẫn tuổi kết nối, và là nhánh DUY NHẤT phủ `search_path` (NẶNG-2). ⒝ PHIÊN DEPLOY `pg_settings`, HAI VẾ vì `reset_val` và `setting` trả lời hai câu khác nhau — ĐO (S1.51): một câu `SET x = v` trong phiên đổi `setting` và `source` (hoá `session`) mà KHÔNG đụng `reset_val`; vế RESET_VAL bắt nguồn không để lại hàng catalog (postgresql.conf / `ALTER SYSTEM` / dòng lệnh / biến môi trường / `options=`), vế SETTING bắt câu `SET` CÒN SÓT trong chính phiên deploy (`source = 'session'`, hai tên không phải `search_path`) — ca một migration đánh số chạy `SET session_replication_role = replica` rồi quên `RESET`, và lượt phán xét cuối chạy sau nó cùng phiên. So với GIÁ TRỊ DỰ ÁN ĐÒI (`GUC_VAN_HANH_DOI`), KHÔNG so `boot_val`: neo cổng an ninh vào mặc định biên dịch của PostgreSQL là để nó trôi theo bản trong im lặng (NHẸ-3). ⒞ dòng khai thiu của `GUC_VAN_HANH_KHAI` (rỗng). PHÁN XÉT, không tự chữa: `ALTER ROLE ALL RESET` / `ALTER SYSTEM RESET` là SUSET (T10-E4). **Và hai phép đọc ở `migrate()`, không phải một** (NẶNG-3): ⑴ TRƯỚC lượt sửa — bốn GUC `app.*` cộng hai GUC vận hành đọc được, cộng `search_path`; nguồn `database` cố ý ĐỨNG NGOÀI phép đọc này, vì từ chối trước lượt sửa thì `ALTER DATABASE … RESET` của ba mục kề KHÔNG BAO GIỜ chạy, ba mục thành mã chết (ADR-028 §2⑷) và một cụm dính `ALTER DATABASE … SET` không lượt deploy nào gỡ được nữa; ⑵ NGAY SAU lượt sửa, TRƯỚC vòng migration đánh số — hàng mức database vừa được chữa nhưng giá trị ấy dính vào phiên lúc MỞ KẾT NỐI và `RESET` không đổi phiên đang chạy (đo), nên lượt này dừng với thông điệp "chạy lại trên KẾT NỐI MỚI" và lượt kế đi thẳng — đo cả ba: chữa xong, chặn đúng lượt ấy, lượt sau qua. **Ranh giới ĐO ĐƯỢC, nói ra:** `search_path` sau khi `migrate()` và BƯỚC 0 ghim nó thì `source` hoá `session` trong khi `reset_val` GIỮ giá trị độc (đo) ⇒ tới BƯỚC 3 hàng "mức database vừa chữa xong" và hàng "ALTER SYSTEM" trông HỆT nhau, không phân biệt được; nên ca `ALTER SYSTEM SET search_path` chặn ở phép đọc TRƯỚC LÚC GHIM trong `migrate()` — bản đầu loại nó bằng một vế `NOT (source = 'session' AND name = 'search_path')` và đó là một LỖ, không phải một carve-out. Nguồn `client` (`options=`) không đo được ở tầng test: `createPool` của dự án TỪ CHỐI thẳng tham số ấy (có khẳng định), và `pg` chỉ là import kiểu nên không dựng nổi pool ngoài `createPool`. **Phạm vi của nhánh ⒜, đo trong vòng:** bản đầu không có vế `setdatabase IN (0, <db hiện tại>)` nên `ALTER ROLE r IN DATABASE <db khác> SET row_security = off` — một hàng KHÔNG phiên nào của database này nhận được — vẫn bị nêu ⇒ chặn deploy trên một cụm hợp lệ (ADR-028 §3, chiều hỏng); nhánh ⒞ nhận cùng vế để một hàng ở database khác không làm dòng khai "hết thiu". Vế (a″) đo trên VAI ỨNG DỤNG: nhánh catalog THẤY hàng ấy còn bốn mục `RESET ALL` từ S0 thì CHỮA nó ở lượt SỬA — mục 92 là lớp cho hàng `ALTER ROLE ALL` mà bốn mục kia không với tới, không phải lớp duy nhất. **Bản BA, sau lượt soi 44 (1 CAO, 4 NẶNG, 6 NHẸ):** ⑴ **CAO-1 — hàng che mang GIÁ TRỊ ĐÚNG.** `ALTER SYSTEM SET session_replication_role = replica` cộng `ALTER DATABASE d SET … = origin` (một biện pháp giảm nhẹ HỢP LỆ của người vận hành): phiên deploy đo được `setting = origin, source = database` ⇒ mục 92 im ĐÚNG như thiết kế, còn lượt SỬA thì gỡ hàng che VÔ ĐIỀU KIỆN ⇒ deploy XANH và mọi phiên ứng dụng mở sau đó chạy dưới `replica` (đo cả ba bước). Lớp chặn không thể là mục 92 — nó nằm ở `migrate()`: CHỤP hàng mức database của ba tên TRƯỚC và SAU lượt sửa, gỡ được hàng nào thì DỪNG và đòi kết nối mới, vì giá trị THẬT sau khi hàng che biến mất chỉ đọc được trên một phiên mới. **Kỳ vọng LẬT có chủ đích, ở HAI test cũ:** `[fix round 5] cấu hình đặt ở MỨC DATABASE` (`migrations.int.test.ts`) và `[khoản nợ 83⑷⑸⑧]` (`hardening-suy-tu-tinh-chat.int.test.ts`, vế mức database) cùng khẳng định lượt ấy chữa xong rồi ĐI THẲNG — nay nó chữa xong rồi DỪNG, và lượt sau mới đi thẳng; vế "chữa được" vẫn được đo nguyên ở cả hai (lượt evidence bắt test thứ hai, không phải lượt soi). ⑵ **NẶNG-1 — bằng chứng của khoản 87 rỗng ruột:** bốn chỗ trong test còn ghim THÔNG ĐIỆP CŨ của phép từ chối sớm; ba `toContain` đỏ và một hằng của `bat87` thoái hoá thành no-op. Chuỗi nay sống MỘT bản (`TU_CHOI_GUC_SOM` xuất từ `@trustprocure/db`). ⑶ **NẶNG-2 —** thông điệp sau lượt sửa nói "đã gỡ" cả khi lượt sửa ăn 42501 và không gỡ được ⇒ tách hai ca theo hàng catalog còn/hết; và cả ba nhánh từ chối nay `release(err)` để HUỶ client, vì lời khuyên "chạy lại trên kết nối mới" không thực hiện được nếu chính phiên độc quay lại pool. ⑷ **NẶNG-3 —** `search_path` bị so NGUYÊN VĂN `'"$user", public'` ⇒ cụm đặt `search_path = 'public'` (AN TOÀN HƠN, và là cách tự chữa khoản 78) bị chặn VĨNH VIỄN, không cửa ra. Nay xét theo TÍNH CHẤT: không schema nào ngoài `"$user"`/`pg_catalog` được đứng TRƯỚC `public`; ~~thứ đứng SAU không thuộc tính chất ấy.~~ **[S1.52 / khoản 95]** SAI: `pg_catalog` nêu SAU là tiền đề cướp (đo: `lower('ABC')` ra `CUOP`) — nay `pg_catalog` chỉ được ở vị trí đầu. `session_replication_role` nhận cả `local` (NHẸ-5 — `local` bắn đúng tập trigger như `origin`). ⑸ **NẶNG-4 —** nhánh ⒜ soi MỌI vai MỌI database trong khi mục anh em (khoản 87) thu hẹp bằng `VI_TU_HANG_CAU_HINH_UNG_DUNG` ⇒ `ALTER ROLE dba SET search_path` chặn deploy oan, và cửa ra chỉ theo TÊN GUC nên khai xong là mù luôn với `ALTER ROLE ALL`. Nay dùng ĐÚNG tập ấy. ⑹ **NHẸ-3 —** tám ô mô tả của các mục GUC mức VAI vẫn in nguyên `rolconfig`/`setconfig` KÈM GIÁ TRỊ, và test 87 dựng `app.org_id = <uuid>` rồi đọc thông điệp ⇒ định danh tổ chức đi vào log CI; tám ô đổi sang chỉ in TÊN, kèm một khẳng định `not.toContain` giữ chỗ. ⑺ NHẸ-6 nhánh ⒞ chép thiếu vế SETTING; INFO-4 `coalesce` chắn `mo_ta` NULL. **Phạm vi CỐ Ý ĐỨNG NGOÀI, có hai test cũ ghim:** `rolconfig` của vai DEPLOY — `[CR1]` và `[Minor]` khẳng định `migrate()` chạy được dưới `search_path` thù địch đặt bằng `ALTER ROLE <vai deploy> SET`, và chính tệp gọi vùng ấy là "chặn 0%"; nên phép đọc `search_path` của `migrate()` chỉ bắt bốn nguồn áp cho MỌI phiên (conf, ALTER SYSTEM, dòng lệnh, biến môi trường, `ALTER ROLE ALL`). Test `[khoản nợ 92]` nay MƯỜI BỐN vế (a, a′, a″, b, c, d, e, f, g, h, i, k, l, m); **tám đột biến đỏ cô lập, mỗi cái đỏ ở một vế khác nhau** ~~(biên bản 66 ⑷)~~ ([S1.66] §S1.51). **Còn mở, nói ra: khoản 95.** | `db/migrations/hardening.always.sql` (`GUC_VAN_HANH_DOI`, `GUC_VAN_HANH_KHAI`, `CAU_GUC_VAN_HANH_GAN_SAN`), `packages/db/src/migrate.ts`, `db/migrations.int.test.ts` |
| 93 | **[ĐÓNG]** **[S1.48, lượt soi ngang 40b #1 — lặp lại "điều đáng mang sang" ⑶ của 33b] ADR-036 §2 TỰ KHAI LÀ NGUỒN CỦA MỌI CƠ CHẾ 0-HÀNG, NHƯNG BA MỤC PHÁN XÉT MỚI (khoản 86, 87, 89/86 danh tính) KHÔNG CÓ HÀNG NÀO Ở §2; KHÔNG CỔNG NÀO ĐÒI `CAU_*_SAI` ↔ HÀNG §2.** Lượt 33b đề xuất meta-test "mọi `CAU_*_SAI` của hardening phải xuất hiện ở một hàng §2 (hoặc ở ADR-037)"; ba vòng sau, ba mục mới và vẫn không hàng — S1.48 thêm hàng 23 cho khoản 87 bằng tay, nhưng cơ chế của 86 (khoá ngoại tới bảng tenant không `org_id`) và của 89/86 (danh tính neo) chỉ sống trong văn xuôi §5/ADR-037. Hình dạng mã: một `it` T1 ở `tests/architecture` (khuôn P4 của H20) quét `^  (CAU_[A-Z_0-9]+_SAI) constant text :=` trong hardening và đòi mỗi tên có mặt trong DECISIONS.md — hôm nay sẽ ĐỎ với hầu hết mục cũ (chỉ `CAU_ORG_ID_NGOAI_PUBLIC_SAI` được nhắc), nên vòng đóng phải kèm bảng §2 đủ hàng, hoặc cột "tên hằng" cho từng hàng. **[S1.49] ĐÓNG bằng một cổng theo TÍNH CHẤT, và trục KHÔNG phải hình dạng mã ghi ở trên:** ~~quét `^  (CAU_[A-Z_0-9]+_SAI) constant text :=`~~ — lọc theo TÊN mù ngay với `CAU_BANG_SO_VAT_LY`, `CAU_QUYEN_BANG_SO_MO_TA`, `CAU_GUC_TUY_BIEN_GAN_SAN` (ba mục phán xét thật không mang hậu tố ấy) và đòi nhầm `CAU_QUYEN_BANG_SO_SAI` (chỉ dùng ở ô CÂU SỬA). Cổng `tests/architecture/hardening-co-ly-do.test.ts` ([INV-H19]) dựng lại mảng `bang` thành **107 hàng × 6 ô** (bộ tách ô tôn trọng dollar-quote lồng và chú thích `--`; parse hỏng ⇒ NÉM, vế chống mù SUY TỪ CHÍNH TỆP chứ không ghim tay), gọi **mục PHÁN XÉT** là hàng có ô CÂU SỬA no-op (`SELECT 1`, `DO $x$ BEGIN END $x$` — khuôn no-op lạ ⇒ NÉM) theo đúng ranh giới ADR-028 §2⑵, và đòi mỗi phán xét có một KHOÁ TRA CỨU trong ADR-028/036/037 sau khi bỏ mọi vùng đã gạch: tên hằng ở ô hậu điều kiện nếu có, ngược lại TÊN MỤC. Phủ cả **hai phán xét sống NGOÀI `bang`** (`CAU_MEMBERSHIP_LA`, `CAU_ADMIN_LA` — BƯỚC 3 đẩy thẳng vào `loi_gom`; vế `loi_gom` là bắt buộc nên `CAU_CAP_PHU_CHUOI` chỉ RAISE WARNING cố ý nằm ngoài). Tài liệu: ADR-036 §2 thêm **hàng 24** (khoản 86) và **hàng 25** (bảng sổ trôi hình dạng cột), tên hằng vào hàng 2/4/6/10/12/16, §1 nói ra phạm vi đã rộng hơn câu hỏi gốc; ADR-028 §7 gọi đúng tên loại bảy mục canh sổ (bốn phán xét, ba tự chữa) và bỏ mệnh đề trái §2⑵; ADR-037 §4 nêu `CAU_NEO_SUA`/`CAU_NEO_SAI`/`VI_TU_PHAI_NEO`. **Chỗ thu hẹp nói ra:** chín hằng `CAU_*` chỉ dùng ở ô CÂU SỬA hay làm câu phụ trợ không bị đòi — một hằng chỉ để SỬA không chặn deploy của ai. Năm đột biến đỏ cô lập (biên bản 64 ⑷). | `docs/DECISIONS.md` ADR-036 §2 (hàng 24, 25), ADR-028 §7, ADR-037 §4, `tests/architecture/hardening-co-ly-do.test.ts` |
| 94 | **[ĐÓNG]** **[S1.50, lượt soi 42 NẶNG-3 — đọc, chưa có ca thật] SAU KHI HARDENING FORCE MỌI BẢNG RLS, MỘT BẢNG CÓ POLICY CHỈ ÁP CHO VAI ỨNG DỤNG LÀM CHỦ BẢNG ĐỌC/GHI 0 HÀNG KHÔNG LỖI — VÀ 83⑵ KHÔNG SOI VAI CHỦ.** `CAU_PHU_LENH_SAI` (83⑵) lấy tập vai là `VAI_KET_NOI_UNG_DUNG ∪ ROLE_CANH` — không có vai deploy/chủ bảng. Nên một bảng bật RLS với `CREATE POLICY … TO app_api USING (…)` là hợp lệ với mọi mục hôm nay, và sau khi khoản 91 FORCE nó, mọi `SELECT/UPDATE/DELETE` của chủ bảng trả 0 hàng im lặng (đúng ADR-036 hàng 4/6), `INSERT` thì ném. Hôm nay KHÔNG có ca nào: policy duy nhất của `caller_rate_limits` là PERMISSIVE `TO PUBLIC`, hai lượt dọn cửa sổ cũ chạy dưới `app_api`, và bảng tenant đã FORCE từ S0 nên hiện trạng không đổi. Hình dạng mã: mỗi bảng bật RLS ngoài tập tenant phải có ít nhất một policy PERMISSIVE phủ chủ bảng (hoặc `PUBLIC`) ở mọi lệnh — phán xét, để cái giá của FORCE thành ĐỎ ồn ào ở lượt phán xét thay vì 0 hàng im lặng. Đo trước bằng một bảng khai có policy chỉ `TO app_api`. **[S1.53] ĐÓNG — mã sản xuất, đúng hình dạng ghi ở trên và RỘNG hơn ở chủ thể.** Mục phán xét `CAU_PHU_LENH_CHU_BANG_SAI`: mọi bảng (r/p) bật RLS và FORCE trong lược đồ dự án — tenant hay không, chứ không chỉ "ngoài tập tenant" như hình dạng trên, vì vế phủ chỉ hỏi DANH SÁCH VAI của policy chứ không hỏi biểu thức USING (policy tenant `TO PUBLIC USING (org_id = …)` được tính là phủ; 0 hàng khi chưa gắn tổ chức là [INV-F1] fail-closed có chủ đích) — trừ đối tượng extension và trừ chủ superuser/BYPASSRLS (RLS không áp cho họ ở cấu hình nào), phải có với MỖI lệnh SELECT/INSERT/UPDATE/DELETE một policy PERMISSIVE (`polcmd` là lệnh ấy hay `*`) mà danh sách vai là PUBLIC hoặc chứa một vai chủ bảng có quyền của nó (`pg_has_role … 'USAGE'`, khớp `has_privs_of_role` mà RLS dùng). **Đo (PostgreSQL 16):** chủ KHÔNG superuser, bảng FORCE có 2 hàng, policy duy nhất `TO app_api` ⇒ chủ bảng SELECT ra 0, UPDATE và DELETE báo 0 hàng không lỗi, INSERT ném 42501; policy `FOR SELECT` cấp cho một nhóm mà chủ là thành viên ⇒ SELECT được phủ (đọc ra 2) còn ba lệnh kia vẫn bị nêu; thêm policy `TO PUBLIC` ⇒ hết; đổi chủ sang superuser ⇒ hết. Lược đồ thật: cả 30 bảng RLS có policy PERMISSIVE `TO PUBLIC` ở mọi lệnh ⇒ ~~mục không chặn cụm hợp lệ nào (ADR-028 §3)~~ **[lượt soi 46 NẶNG-1]** SAI với bảng con phân vùng dưới chủ thường — bản hai loại bảng con của cha bật RLS. Test `db/rls-coverage.int.test.ts` describe `[S1.53 / khoản nợ 94]` (bốn `it`, chủ bảng `zz_chu94` KHÔNG superuser). **Bản hai, sau lượt soi 46 (1 NẶNG, 3 NHẸ, 5 INFO):** ⑴ **NẶNG-1** — bản đầu nêu oan mọi lá phân vùng của bảng tenant dưới chủ thường, đúng hồ sơ sản xuất N2/N3, trong khi dự án đã chọn khuôn "policy đặt trên cha, lá không policy" ở ba lớp; lá ngoài `public` còn thành ngõ cụt vì 83⑴ nêu mọi policy ngoài `public` mà không có đường khai. Nay bảng CON (phân vùng hay INHERITS) của một cha bật RLS đứng ngoài — đo: chủ đọc QUA CHA ra 2, đọc THẲNG lá ra 0 và UPDATE thẳng lá báo 0 hàng (ranh giới nói ra; cha vẫn bị soi); tách lá thành bảng riêng thì bị nêu đủ bốn lệnh. ⑵ **NHẸ-2** — chỉ lệnh chủ bảng CÒN QUYỀN, cùng chuẩn 83⑵: đo, chủ tự `REVOKE UPDATE, DELETE` ⇒ `has_table_privilege` ra false và UPDATE ném 42501, ồn chứ không im; thông điệp nay đặt `TO <chủ bảng>` trước và cảnh báo `TO PUBLIC` phủ luôn mọi vai ứng dụng. ⑶ **NHẸ-3** — câu "tức của mọi migration chạy dưới vai deploy" sai ở hồ sơ N2; nay nói "chủ bảng và mọi vai thừa kế quyền chủ bảng"; vai chạy migration không thừa kế chủ là **khoản 97**. ⑷ **NHẸ-4** — hai khẳng định rỗng ruột ("lược đồ thật" — mọi bảng thuộc superuser nên mục im vô điều kiện; "chủ superuser đứng ngoài" — p_api vẫn phủ vì `pg_has_role(superuser, …)` luôn đúng) và năm vế lọc không có đối chứng: thay bằng census độc lập chủ bảng, gỡ p_api trước khi đổi chủ và đổi chủ sang một vai SUPERUSER NOBYPASSRLS (vai bootstrap mang cả BYPASSRLS nên che vế superuser — lượt đột biến bắt, có khẳng định), và thêm đối chứng cho RESTRICTIVE, BYPASSRLS, NO FORCE, tắt RLS, extension. **Mười hai đột biến đỏ cô lập** ~~(biên bản 68 ⑷)~~ ([S1.66] §S1.53). Mức bảo đảm là trạng thái tại lượt phán xét (INFO-5). **Còn mở: khoản 97, 98.** | `db/migrations/hardening.always.sql` (`CAU_PHU_LENH_CHU_BANG_SAI`, `CAU_PHU_LENH_SAI`), `db/rls-coverage.int.test.ts` |
| 95 | **[ĐÓNG]** **[S1.51, lượt soi 44 NHẸ-1 + NHẸ-2 — đọc, chưa đo bằng test] BA GUC VẬN HÀNH ĐẶT QUA `proconfig` CỦA MỘT HÀM MỚI, HAY QUA `GRANT SET ON PARAMETER`, KHÔNG MỤC NÀO SOI.** Hai đường, cùng một lỗ hình dạng: ⑴ nhánh ⒠ của mục khoản 87 có soi `pg_proc.proconfig` nhưng lọc `LIKE '%.%'` (nó sinh ra để canh GUC TUỲ BIẾN) ⇒ ba tên KHÔNG dấu chấm rơi ra ngoài — `CREATE FUNCTION public.f() … SET search_path = 'ke_gian, public'` không mục nào thấy; giảm nhẹ đang có, đo được từ mã: ~40 mục ghim `proconfig` NGUYÊN VĂN cho các hàm ĐÃ CÓ nên chỉ hàm MỚI lọt. ⑵ nhánh ⒟ của 87 và `CAU_PARAMETER_ACL_SAI` cùng bỏ qua ba tên ấy ⇒ `GRANT SET ON PARAMETER session_replication_role TO <vai>` cho một vai không superuser LẬT tiền đề "chỉ superuser đặt được `session_replication_role`" — tiền đề mà lớp `ENABLE ALWAYS` của ADR-036 hàng 8 đang tựa vào, và chính tệp đã tự khai là tiền tồn chưa có khoản. Hình dạng mã: bỏ vế `LIKE '%.%'` cho ba tên ở nhánh ⒠/⒟, hoặc thêm hai nhánh `proconfig` và `pg_parameter_acl` vào `CAU_GUC_VAN_HANH_GAN_SAN` với `split_part(c, '=', 1) IN (SELECT gd.ten FROM GUC_VAN_HANH_DOI)` và grantee không superuser — cùng khuôn nhánh ⒟ của 87. Đo trước bằng hai DDL trên. **Ranh giới cùng hạng, KHÔNG đóng được bằng catalog:** `options=`/`PGOPTIONS` phía ỨNG DỤNG không để lại hàng nào và không phiên deploy nào thấy — hàng rào duy nhất là `createPool` từ chối `options=` trong chuỗi kết nối (có khẳng định). **[S1.52] ĐÓNG — mã sản xuất, cả hai đường, và vòng này vá luôn một lỗ của CHÍNH khoản 92.** `CAU_GUC_VAN_HANH_GAN_SAN` thêm hai nhánh: ⒟ `pg_parameter_acl` — dòng ACL của ba tên có grantee PUBLIC hay vai không superuser, với quyền `ALTER SYSTEM` (cả ba tên — đo: vai được GRANT ALTER SYSTEM ON PARAMETER search_path chạy được `ALTER SYSTEM SET search_path`) hoặc `SET` trên tham số có `pg_settings.context = 'superuser'` (đo: chỉ `session_replication_role`; GRANT SET trên hai tham số USERSET hợp lệ mà không trao gì — không nêu, có vế đối chứng); ⒠ `proconfig` của hàm trong lược đồ dự án (trừ extension; thủ tục cũng được soi) mang giá trị trái tính chất — đo: vai KHÔNG superuser tạo được hàm mang `search_path='ke_gian, public'` hay `row_security=off`, và hàm SECURITY DEFINER của superuser mang replica trao replica cho người gọi thường. Nhánh dòng khai thiu dùng lại NGUYÊN VẸN hai vị từ mới (`VI_TU_ACL_GUC_VAN_HANH_SAI`, `VI_TU_HAM_GUC_VAN_HANH_SAI`). **Lỗ của khoản 92, tự bắt trong lúc đo:** tính chất `search_path` merge ở S1.51 nhận MỌI thứ sau `public`, kể cả `public, pg_catalog` — đo: với `public.lower(text)` trả `CUOP`, `lower('ABC')` ra `CUOP` dưới `public, pg_catalog` và `"$user", public, pg_catalog`, và trong thân hàm mang `search_path=public, pg_catalog` (đúng tiền đề mà [INV-H21] canh ở mã TypeScript). Nay `GUC_VAN_HANH_DOI` có thêm cột `cam` cấm `pg_catalog` ở mọi vị trí trừ vị trí ĐẦU, ở cả hai lớp (hardening và `searchPathDung` của `migrate.ts`). **Ba ca chặn OAN đóng trong vòng (ADR-028 §3):** `pg_catalog, pg_temp` — khuyến nghị của tài liệu PostgreSQL cho SECURITY DEFINER (tự bắt trước lượt soi); `"$user"` đứng một mình và `pg_catalog, "$user"` (lượt soi 45 NHẸ-1 — bản đầu ĐÒI có `public`); `row_security = true` trên hàm (lượt soi 45 NHẸ-3 — đo: `proconfig` lưu NGUYÊN cách viết `true`/`yes`/`1`/`t`, còn `pg_settings` chuẩn hoá về `on`, nên `^on$` chặn oan một hàm đang BẬT row_security; nay so không phân biệt hoa/thường với mọi cách viết TRUE). Đo thêm để gỡ phỏng đoán: PostgreSQL bỏ nháy thừa (`"public"` ⇒ `public`), còn `"PUBLIC"` là schema khác và bị loại đúng. Test `db/migrations.int.test.ts` `[khoản nợ 95]` các vế (a)…(g) cộng các vế chặn-oan; **mười đột biến đỏ cô lập** ~~(biên bản 67 ⑷)~~ ([S1.66] §S1.52). **Ranh giới nói ra: khoản 96** (thân hàm `set_config` ghi vào phiên người gọi). | `db/migrations/hardening.always.sql` (`CAU_GUC_VAN_HANH_GAN_SAN` nhánh ⒟/⒠, `VI_TU_ACL_GUC_VAN_HANH_SAI`, `VI_TU_HAM_GUC_VAN_HANH_SAI`, `GUC_VAN_HANH_DOI`), `packages/db/src/migrate.ts`, `db/migrations.int.test.ts` |
| 96 | **[ĐÓNG]** **[S1.52, lượt soi 45 NHẸ-2 — ĐO] THÂN HÀM GHI BA GUC VẬN HÀNH VÀO PHIÊN NGƯỜI GỌI BẰNG `set_config(…, false)`, VÀ PHIÊN GIỮ NGUYÊN SAU KHI HÀM TRẢ VỀ — KHÔNG MỤC NÀO SOI.** Nhánh ⒠ của khoản 95 chỉ đọc `proconfig`, không đọc thân hàm. **Đo (PostgreSQL 16):** ⑴ hàm SECURITY DEFINER của superuser, thân chạy `set_config('session_replication_role', 'replica', false)` ⇒ vai thường gọi xong thì phiên của CHÍNH nó đang ở `replica` — trigger `ENABLE` thường bị bỏ qua cho mọi câu sau đó trên kết nối ấy, và pool giữ kết nối; ⑵ thêm mệnh đề `SET search_path = pg_catalog` vào hàm ấy KHÔNG khôi phục replica — PostgreSQL chỉ khôi phục đúng biến được nêu ở mệnh đề SET; ⑶ hàm SECURITY INVOKER của vai thường, thân đặt `search_path = 'ke_gian, public'` ⇒ phiên người gọi mang search_path ấy sau khi trả về (che tên trên kết nối pool); ⑷ bản INVOKER của vai thường đặt replica thì 42501. Tiền điều kiện: hàm do migration dựng — cùng mô hình đe doạ với ⒠ — và riêng replica cần hàm của superuser hay vai được GRANT SET ON PARAMETER (nhánh ⒟ đã bắt vế sau). **Hình dạng mã:** quét `prosrc`/`prosqlbody` của hàm lược đồ dự án tìm `set_config('<ba tên>'` và `SET [SESSION] <ba tên>` — cùng khuôn `CAU_TEN_GUC_DU_AN_DOC` (quét ĐỌC `current_setting`) nhưng cho GHI; ranh giới nói trước: `EXECUTE` động không quét được bằng văn bản, nên lớp chịu lực còn lại là ứng dụng — `withTenant` vốn đọc lại bốn GUC `app.*` sau mỗi giao dịch (S1.48), mở rộng cho `session_replication_role` và `search_path` rồi huỷ kết nối nhiễm. Đo trước bằng bốn DDL trên. **[S1.54] ĐÓNG — hai lớp mã sản xuất, bề mặt rộng hơn hình dạng ghi ở trên.** ⑴ Hardening: nhánh ⒡ của `CAU_GUC_VAN_HANH_GAN_SAN` (hằng `CAU_MA_GHI_GUC_VAN_HANH`; mục phán xét nay "(khoản 92, 95, 96)") quét văn bản tĩnh của mọi mã lược đồ dự án trên tám bề mặt — thân hàm (`prosrc`), BEGIN ATOMIC, policy USING và WITH CHECK, DEFAULT, CHECK của bảng và của domain, rule/view, WHEN của trigger — vì đo S1.54 cho thấy view, DEFAULT, policy, CHECK, BEGIN ATOMIC và `UPDATE pg_settings` dưới `app_api` cũng ghi vào phiên người gọi. Ba khuôn: `set_config(` với tên nguyên văn (`'…'`, `E'…'`, `U&'…'`, dollar-quote); `SET [SESSION hay LOCAL] <tên>`, `RESET <tên>` và `RESET ALL` — RESET cũng là ghi, nó gỡ search_path mà migrate() ghim; `UPDATE pg_settings` cùng thân với tên nguyên văn. Không phân biệt hoa/thường, nhận tên có nháy; khoảng cách giữa token là khoảng trắng HOẶC chú thích, kể cả lồng (**lượt soi 47 CAO-1 + NẶNG-1** — đo: chú thích giữa token và tên dollar-quote/U& đều được PostgreSQL nhận và đều ghi vào phiên, mà bản đầu không thấy); trừ extension và pg_temp; tôn trọng `GUC_VAN_HANH_KHAI`, nhánh dòng khai thiu dùng lại cùng hằng. ⑵ `withTenant`: khối DO trong CÙNG câu với COMMIT ném TP096 khi `session_replication_role` không phải origin/local ⇒ COMMIT không chạy, và ROLLBACK gỡ luôn replica đặt trong giao dịch (đo); TP096 và 25P02 đổi thành `TenantError`; khối `finally` huỷ kết nối khi `session_replication_role` hay `row_security` sai theo tính chất (lượt soi 47 NHẸ-1), khi search path hiệu lực (`current_schemas(false)` — [INV-H21] cấm nêu tên GUC ấy trong SQL ngoài migrate.ts; `false` vì bảng tạm của vai có TEMP làm `true` lệch, đo, tự bắt) khác lúc mở giao dịch, hay khi chính phép đọc ném. Không thêm round-trip; câu kết thúc có trung vị 0,39 ms thay vì 0,30 ms (đo), và evidence bắt hai test `[T10-L]` mang hạn 1 ms — thấp hơn độ trễ tối đa của chính COMMIT trần — nay 100 ms ~~(biên bản 69)~~ ([S1.66] §S1.54). Test `db/migrations.int.test.ts` `[khoản nợ 96]` và `packages/tenancy/src/with-tenant.int.test.ts` describe `[S1.54 / khoản nợ 96]` (tám `it`); **bốn mươi ba đột biến đỏ cô lập** ~~(biên bản 69 ⑷)~~ ([S1.66] §S1.54). **Ranh giới nói ra:** tên dựng lúc chạy và cách viết khác của cùng tên (đo: `EXECUTE format` với tên ghép; bí danh LANGUAGE internal tới set_config_by_name — cần superuser); hàm tự đặt lại origin trước khi trả về; search path nhiễm từ trước giao dịch; `statement_timeout`/`SET ROLE`. **Còn mở: khoản 99** (đường SQL vai ứng dụng ngoài `withTenant`). | `db/migrations/hardening.always.sql` (`CAU_MA_GHI_GUC_VAN_HANH`, `CAU_GUC_VAN_HANH_GAN_SAN` nhánh ⒡), `packages/tenancy/src/with-tenant.ts`, `db/migrations.int.test.ts`, `packages/tenancy/src/with-tenant.int.test.ts` |
| 97 | **[ĐÓNG]** **[S1.53, lượt soi 46 NHẸ-3 — đọc, chưa đo] VAI CHẠY MIGRATION MÀ KHÔNG PHẢI CHỦ BẢNG VÀ KHÔNG THỪA KẾ CHỦ ĐỌC/GHI 0 HÀNG IM LẶNG TRÊN BẢNG RLS MÀ POLICY KHÔNG PHỦ NÓ — MỤC 94 CHỈ SOI CHỦ BẢNG.** RLS áp cho mọi vai không được coi là chủ (`has_privs_of_role(vai, relowner)` sai) bất kể FORCE. Ở hồ sơ N2, bảng bootstrap thuộc superuser và `trien_khai` chạy migration mà không phải chủ. Hôm nay vô hại: `trien_khai` không có GRANT trên bảng bootstrap (thiếu quyền là 42501 ồn) và mọi policy đều `TO PUBLIC`. Hình dạng mã: thêm chủ thể thứ hai là `current_user` của phiên phán xét — chính phiên đã chạy vòng migration đánh số — khi vai ấy không superuser/BYPASSRLS, không thừa kế chủ, và có quyền của lệnh đang xét; với chủ thể này bỏ vế FORCE. Đo trước bằng: vai `zz_trien` được `GRANT SELECT, UPDATE` trên một bảng mà policy chỉ `TO <chủ>` ⇒ `UPDATE` 0 hàng không lỗi. **[S1.56] ĐÓNG — mã sản xuất, sau ba bản.** Đo trước khi viết: chủ không superuser, bảng bật RLS có 2 hàng, policy duy nhất TO chủ; vai không thừa kế chủ được GRANT SELECT, UPDATE ⇒ đọc 0 và UPDATE 0 hàng không lỗi, cả khi NO FORCE; mục 94 và 83⑵ im; hồ sơ N2 — `migrate()` dưới `trien_khai` áp một migration backfill rồi đi qua mà hàng không đổi. **Sửa:** `CAU_PHU_LENH_CHU_BANG_SAI` thêm chủ thể thứ hai là `current_user` của phiên phán xét khi RLS áp cho vai ấy theo gương `check_enable_rls` — không superuser, không BYPASSRLS, không phải chính chủ, và bảng FORCE hay vai không thừa kế chủ (theo USAGE: thành viên NOINHERIT vẫn bị soi) — có USAGE lược đồ, ở SELECT, UPDATE, DELETE (INSERT ném nên đứng ngoài), cùng loại trừ extension và bảng con của cha bật RLS; phủ theo danh sách vai của policy PERMISSIVE. Thông điệp đặt REVOKE — do người cấp, chủ bảng hay SUPERUSER — lên đầu, và nói các migration đánh số của chính lượt đã ghi checksum. **Lượt soi đối kháng 49** (0 CAO, 2 NẶNG, 5 NHẸ, 3 INFO), mọi phát hiện chịu lực đo lại: NẶNG-2 — bản hai loại mọi vai thừa kế chủ, nên thành viên của chủ BYPASSRLS hay của chủ đã tự REVOKE trên bảng FORCE đọc 0 mà cả hai chủ thể im (đo) — sửa bằng gương; NHẸ-3 và NHẸ-5 sửa; NẶNG-1 và NHẸ-1 thành khoản 100, NHẸ-4 thành khoản 101. Tự bắt ở lượt đột biến: vế superuser và vế thừa kế chủ từng SỐNG, và một đột biến đỏ giả vì chính nó làm SQL sai cú pháp. Test: `db/rls-coverage.int.test.ts` describe `[S1.56 / khoản nợ 97]` (ba `it`, câu phán xét dưới `SET LOCAL ROLE`), `db/migrations.int.test.ts` một `it` hồ sơ N2; mọi đột biến cô lập đỏ ~~(biên bản 71)~~ ([S1.66] §S1.56). **Ranh giới nói ra:** mục phán xét sau vòng đánh số (khoản 100); policy tenant TO PUBLIC tính là phủ vai deploy, ồn chỉ nhờ EXECUTE của hàm ngữ cảnh (khoản 101); thành viên NOINHERIT của chủ bị nêu dù migration có thể SET ROLE sang chủ. | `db/migrations/hardening.always.sql` (`CAU_PHU_LENH_CHU_BANG_SAI`), `db/rls-coverage.int.test.ts`, `db/migrations.int.test.ts` |
| 98 | **[ĐÓNG]** **[S1.53, lượt soi 46 NẶNG-1 — một vế ĐO, một vế đọc] POLICY PERMISSIVE TRÊN BẢNG RLS NGOÀI `public` LUÔN BỊ 83⑴ NÊU MÀ KHÔNG CÓ ĐƯỜNG KHAI.** **Đo (S1.53):** bảng `zz46x.t` ngoài `public`, bật RLS, policy PERMISSIVE `TO PUBLIC USING (true)` ⇒ `CAU_POLICY_LOP_SAI` nêu "policy PERMISSIVE không thuộc lớp nào (khoản 83⑴)"; cùng lúc 83⑶ đòi khai bảng. **Đọc:** `POLICY_KHAC_KHAI` khai theo (bảng, tên policy, …) không có cột schema, và vị từ của 83⑴ ghim `nspname = 'public'` ⇒ khai không cứu được. Hệ quả: một bảng RLS hợp lệ ngoài `public` có policy thì không deploy được — ngõ cụt đúng loại ADR-028 §3 cảnh báo; hôm nay không có ca (mọi bảng RLS thật ở `public`), và mục 94 bản hai đã bỏ ca lá phân vùng dẫn vào ngõ cụt này. Hình dạng mã: thêm cột `nspname` cho `POLICY_KHAC_KHAI`, bỏ ghim `public` ở vị từ, kèm bản ở `db/rls-coverage.int.test.ts`. **[S1.55] ĐÓNG — mã sản xuất, rộng hơn hình dạng ghi ở trên.** Đo trước khi viết: bảng `zz98.t` ngoài `public`, bật RLS, ba policy — PERMISSIVE, RESTRICTIVE, và RESTRICTIVE đúng khuôn 027 — chưa khai thì 83⑴ nêu cả ba, 83⑶ nêu bảng, `migrate()` từ chối; khai bảng vào `BANG_RLS_NGOAI_TENANT_KHAI` thì 83⑶ im, nhưng khai ba policy theo khuôn cũ thì 83⑴ VẪN nêu cả ba. Ngõ cụt rộng hơn vế đọc: (b2) `POLICY_RESTRICTIVE_KHAI` cũng ghim `public`, và (b1) chỉ nhận khuôn 027 ở `public`. **Sửa:** cột `nspname` đứng đầu ở CẢ HAI danh sách (`POLICY_RESTRICTIVE_KHAI` bảy cột, `POLICY_KHAC_KHAI` tám cột); vị từ (b2), (c) và hai nhánh dòng khai thiu khớp theo (lược đồ, bảng, policy), thông điệp nêu lược đồ; (b1) giữ `public` có chủ đích — ngoài `public` khuôn 027 đi đường khai (b2). Gỡ ghim mà không thêm cột thì dòng khai của lược đồ này che policy cùng tên của lược đồ khác (đo). **Lượt soi đối kháng 48** (1 CAO, 3 NẶNG, 4 NHẸ, 5 INFO), xử lý hết trong bản hai, không mở khoản mới: vai so theo OID 0 và `quote_ident` — vai thật tên PUBLIC viết hoa không còn giả được PUBLIC (đo); PERMISSIVE trên dữ liệu tenant mà [CR1] không soi — con cháu bảng tenant, bảng có org_id — KHÔNG khai được ở (c), vì bản đầu mở đúng lối lách ấy (đo: lá phân vùng ngoài public khai một dòng thì app_api đọc thẳng lá ra hàng của hai tổ chức); cổng HAI BẢN KHỚP soi gương vị từ (b1) và sinh được NULL, test khoản 98 sinh dòng khai qua chính bộ sinh ấy; census `<bảng>_khach` của A5 phủ mọi lược đồ dự án. Test: `db/rls-coverage.int.test.ts` describe `[S1.55 / khoản nợ 98]` (bốn `it`) chạy câu phán xét của hardening qua bộ giải hằng; `tests/adversarial/a5-co-lap-nha-cung-cap.int.test.ts` census khách; ~~**ba mươi lăm đột biến đỏ cô lập (mười ở bản đầu, hai mươi lăm ở bản hai)**~~ **[S1.66 / lượt soi ngang 59c NHẸ-7] hai mươi lăm đột biến đỏ cô lập, ba mươi lăm lượt chạy — mười đột biến của bản đầu chạy lại trên mã bản hai** ~~(biên bản 70)~~ ([S1.66] §S1.55). **Ranh giới nói ra:** ngoài `public` khuôn 027 phải khai; PERMISSIVE trên dữ liệu tenant mà [CR1] không soi không có lối khai — lối ra là policy trên bảng cha hay chuyển bảng về `public`; bảng chỉ có khoá ngoại tới bảng tenant mà bật RLS vẫn khai kép như ở `public`; khoá của lời khai là tên lược đồ. | `db/migrations/hardening.always.sql` (`CAU_POLICY_LOP_SAI`, `POLICY_RESTRICTIVE_KHAI`, `POLICY_KHAC_KHAI`, `BIEU_THUC_VAI_TRO`, `VI_TU_PERMISSIVE_CR1_SE_SOI`), `db/rls-coverage.int.test.ts`, `tests/adversarial/a5-co-lap-nha-cung-cap.int.test.ts` |
| 99 | **[ĐÓNG]** **[S1.54, lượt soi 47 CAO-1 và "mang sang" ⑶ — một vế ĐO, một vế đọc] MÃ CHẠY SQL DƯỚI VAI ỨNG DỤNG NGOÀI `withTenant` KHÔNG CÓ LỚP ĐỌC LẠI BA GUC VẬN HÀNH.** Khoản 96 đặt lớp ứng dụng ở `withTenant` (không commit dưới replica, huỷ kết nối nhiễm); đường không qua nó chỉ còn hardening quét văn bản tĩnh, và cách viết che tên thì văn bản không mang tên. **Đo (S1.54):** hàm SECURITY DEFINER của superuser chạy `EXECUTE format(…)` với tên GUC ghép từ hai chuỗi lúc chạy ⇒ phiên người gọi ở lại replica — trigger `ENABLE` thường và khoá ngoại bị bỏ qua cho mọi câu sau đó trên kết nối ấy — và nhánh ⒡ không thấy (vế ranh giới có test). **Đọc:** `packages/invitation/src/invitation.ts` có hai bộ dọn nền chạy trên pool NGOÀI `withTenant` (`donBucketNguoiGoiCu` qua `pool.query`, `donOtpRateLimitsCu` qua `pool.connect()` + BEGIN/COMMIT); chưa có census đủ mọi đường. Tiền điều kiện: một hàm lược đồ dự án ghi GUC vận hành bằng cách viết che tên, do migration dựng (superuser, hay vai được GRANT SET ON PARAMETER — nhánh ⒟ bắt vế sau). Hình dạng mã: một census kiến trúc liệt kê mọi chỗ mã sản xuất chạy câu trên pool ứng dụng ngoài `withTenant`, và tách phép kiểm ⑴⑵ của `withTenant` thành một hàm dùng chung cho các đường ấy — hoặc thu hẹp đường thô. **[S1.59] ĐÓNG — mã sản xuất, bản hai (sau lượt soi 52).** Đo trước khi viết (test viết trước, chạy trên mã cũ, PostgreSQL 16): pool một kết nối đăng nhập `app_api_login` gắn vai `app_api` — `SET row_security = off`, hàm SECURITY DEFINER đặt replica, `SET search_path` phạm vi phiên và một giao dịch bỏ ngỏ đều đi theo kết nối sang lần lấy kế, client được giao ra; trigger AFTER DELETE đặt replica giữa câu dọn ⇒ `donOtpRateLimitsCu` COMMIT dưới replica và `donBucketNguoiGoiCu` (câu tự commit) cũng vậy, kết nối pool ở lại replica và một `withTenant` kế tiếp trên cùng pool ném TP096. **Sửa:** ⑴ `ganVaiChoClient` (mọi lần lấy client của pool có vai) từ chối kết nối còn mở giao dịch (`getTransactionStatus`, không vòng đi-về) và, trong CÙNG câu `current_user`, đọc `session_replication_role`/`row_security` theo tính chất cùng search path hiệu lực (`current_schemas(false)`) so với mốc lần lấy đầu của chính kết nối — lệch thì huỷ kết nối, ném `KetNoiNhiemError` (tên riêng để log thấy; lần lấy đầu nói mặc định phiên); ⑵ hai bộ dọn nền là giao dịch tường minh kết thúc bằng khối DO của khoản 96, TP096 thành `InvitationError`, huỷ kết nối trên mọi lỗi; ⑶ census `tests/architecture/duong-sql-ngoai-with-tenant.test.ts` — mọi `createPool` sản xuất có `role`, và số chỗ dựng `pg.Pool`/`pg.Client`, số lệnh COMMIT không chặn, số chỗ lấy client và chạy câu trên pool của từng tệp khớp danh sách khai kèm lý do; tệp mang khối chặn có nhánh TP096. **Lượt soi đối kháng 52** (0 CAO, 1 NẶNG, 3 NHẸ, 7 INFO; mọi phát hiện có xử lý, ba đề xuất không theo, một ghi thành khoản 104, lý do ở biên bản): NẶNG-1 — bản đầu đọc `current_setting('search_path')` và làm [INV-H21] đỏ (đo: `pnpm test`, một đỏ duy nhất) ⇒ đọc search path hiệu lực như withTenant, không nới cổng; NHẸ-1 — chẩn đoán mặc định phiên ở lần lấy đầu; NHẸ-3 — census miễn theo số lượng; INFO-1, INFO-2 — huỷ kết nối trên lỗi, từ chối giao dịch bỏ ngỏ. Test: `packages/db/src/vai-tro.int.test.ts` (tám `it`), `packages/invitation/src/invitation.int.test.ts` (ba `it`), census (năm `it`); hai mươi hai đột biến đỏ cô lập ~~(biên bản 74)~~ ([S1.66] §S1.59). **Ranh giới nói ra:** lỗi rơi vào lần lấy kế tiếp của kết nối nhiễm — có thể là một yêu cầu khác; câu tự commit chạy trọn trước khi lớp lấy client thấy (census khai mỗi đường như thế); DDL (test ghim) hay cấu hình máy chủ nạp lại (suy luận) đổi search path hiệu lực làm mỗi kết nối pool bị huỷ một lần; census là bộ dò cách viết; GUC phiên khác và trạng thái phiên ngoài GUC — khoản 104; pool ứng dụng không có listener `'error'` — khoản 103. | `packages/db/src/vai-tro.ts`, `packages/invitation/src/invitation.ts`, `packages/db/src/vai-tro.int.test.ts`, `packages/invitation/src/invitation.int.test.ts`, `tests/architecture/duong-sql-ngoai-with-tenant.test.ts` |
| 100 | **[ĐÓNG]** **[S1.56, lượt soi 49 NẶNG-1 và NHẸ-1 — một vế ĐO, một vế đọc] MỤC 94 (CẢ HAI CHỦ THỂ) PHÁN XÉT SAU VÒNG MIGRATION ĐÁNH SỐ: KHI MỤC ĐỎ, BACKFILL 0 HÀNG CỦA CHÍNH LƯỢT ĐÃ COMMIT VÀ GHI CHECKSUM, DEPLOY SAU KHÔNG CHẠY LẠI.** **Đo (S1.56):** hồ sơ N2, chủ `zz_chuh` không superuser với policy chỉ TO chủ, `trien_khai` có SELECT, UPDATE, một migration `999_…` chạy `UPDATE zz_sh.t SET id = id + 10` đang chờ ⇒ `migrate()` dưới `trien_khai` NÉM ở mục 94 (vai chạy migration) nhưng hàng vẫn 1, 2 và `schema_migrations` đã ghi tệp ấy; REVOKE rồi chạy lại ⇒ đi qua, backfill không chạy lại — dữ liệu sai vĩnh viễn, không còn tín hiệu. Chủ thể chủ bảng (khoản 94) cùng hình dạng. Tiền lệ khoản 87: `migrate.ts` hỏi bốn GUC `app.*` TRƯỚC lượt sửa vì đúng lý do ấy. **Đọc (NHẸ-1):** `current_user` lúc phán xét không bảo đảm là vai đã chạy backfill — một migration `SET ROLE x` không RESET làm lượt phán xét soi x (client về pool vẫn mang x); `SET LOCAL ROLE x` rồi `UPDATE …` làm backfill chạy dưới x mà lượt phán xét soi vai đăng nhập; hôm nay không migration nào có `SET ROLE` thật. Hình dạng mã: một phép hỏi TRƯỚC vòng đánh số, chỉ khi còn tệp chưa áp, cho phần "vai chạy migration" — mọi lối ra của phần này nằm ngoài tầm vai bị nêu nên chặn sớm gần như không mất lối ra — từ chối, huỷ phiên, nói rõ không migration nào chạy; chụp `current_user` trước vòng, so sau mỗi tệp, lệch thì từ chối và huỷ client. Không tiền-phán-xét chủ thể chủ bảng: lối ra của nó là chính một migration (ADR-028 §3). **[S1.57] ĐÓNG — mã sản xuất, sau hai bản.** Đo trước khi viết: hồ sơ N2 với một nhà cung cấp thật và `999_zz_backfill100.sql` đang chờ ⇒ bản S1.56 ghi tệp là đã áp, hàng không đổi; tệp `SET LOCAL ROLE` hay `COMMIT; SET ROLE …; BEGIN;` dưới một vai có INSERT trên `schema_migrations` ⇒ đi qua và ghi checksum dưới vai lạ. **Sửa:** chủ thể thứ hai của mục 94 tách thành `CAU_PHU_LENH_VAI_CHAY_MIGRATION_SAI` (một bản, trả `ten`, `duong` — đường tới quyền — và `tu_sua_duoc`); khi còn tệp chưa áp, `migrate()` chạy lượt hardening `truoc_vong` sau lượt sửa đầu — hằng ấy trừ dòng `tu_sua_duoc`, RAISE SQLSTATE TP100 — và từ chối trước khi tệp nào chạy (`TU_CHOI_TRUOC_VONG`); chụp `current_user` trước vòng, so trong giao dịch của mỗi tệp trước khi ghi checksum, lệch thì ROLLBACK, từ chối (`TU_CHOI_DOI_VAI`) và huỷ kết nối; mọi tệp hỏng đều huỷ kết nối; lớp tĩnh cấm cách viết thẳng của câu đổi vai trong migration của kho. **Lượt soi đối kháng 50** (0 CAO, 1 NẶNG, 6 NHẸ, 1 INFO), mọi phát hiện chịu lực đo lại: NẶNG-1 — bản đầu chặn cả dòng mà một migration dưới chính vai ấy sửa được (thành viên thừa kế chủ, vai có ADMIN trên một vai thừa kế chủ, vai tự cấp membership nhóm mang quyền), một ngõ cụt ADR-028 §3, và test chủ bảng của bản đầu chạy dưới superuser nên che ca ấy — sửa bằng `tu_sua_duoc` ba vế theo bốn phép đo trên PostgreSQL 16 và một test nhiều pha dưới vai deploy không superuser (membership nhóm do superuser cấp kèm ADMIN thì KHÔNG tự thu hồi được — đo — nên vẫn bị chặn); NHẸ-2 đến NHẸ-7 và INFO-8 sửa. Test: `db/migrations.int.test.ts` (hai `it` khoản 100, một khẳng định thêm ở test khoản 97), `packages/db/src/migrate.int.test.ts` (describe khoản 100 sáu `it`; ba kỳ vọng số lượt lật có chủ đích), `db/migration-shape.test.ts` (bốn `it`), `tests/architecture/hardening-co-ly-do.test.ts` (một `it`); hai mươi ba đột biến đỏ cô lập ~~(biên bản 72)~~ ([S1.66] §S1.57). **Ranh giới nói ra:** dòng `tu_sua_duoc` và chủ thể chủ bảng không được hỏi trước — backfill trên chúng vẫn có thể bị tiêu, hai thông điệp sau vòng nói checksum; phép so vai chỉ thấy trạng thái cuối tệp (đổi vai rồi RESET ROLE thì đi qua); lớp tĩnh chỉ bắt cách viết thẳng; cấu hình mọc ra trong vòng chỉ lượt phán xét sau vòng thấy. | `packages/db/src/migrate.ts`, `db/migrations/hardening.always.sql` (`CAU_PHU_LENH_CHU_BANG_SAI`, `CAU_PHU_LENH_VAI_CHAY_MIGRATION_SAI`), `db/migrations.int.test.ts`, `packages/db/src/migrate.int.test.ts`, `db/migration-shape.test.ts` |
| 101 | **[ĐÓNG]** **[S1.56, lượt soi 49 NHẸ-4 — ĐO] VỚI VAI CHẠY MIGRATION, POLICY TENANT CHUẨN `TO PUBLIC USING (org_id = app_current_org_id())` ĐƯỢC TÍNH LÀ PHỦ DÙ `migrate()` KHÔNG GẮN `app.org_id` — HÔM NAY ỒN CHỈ NHỜ EXECUTE CỦA HÀM NGỮ CẢNH.** **Đo (S1.56):** vai `zz_tk` có SELECT, UPDATE trên `suppliers`, không EXECUTE trên `app_current_org_id()` ⇒ đọc bảng ném 42501 (ồn); `GRANT EXECUTE ON FUNCTION app_current_org_id() TO zz_tk` ⇒ đọc ra 0 hàng KHÔNG LỖI, mục 94 (chủ thể vai chạy migration) im vì policy TO PUBLIC tính là phủ; `migrate()` sau đó KHÔNG thu hồi EXECUTE ấy — hardening chỉ thu hồi khỏi PUBLIC và đảm bảo app_api, app_unseal có. Hệ quả: người vận hành gỡ lỗi 42501 bằng GRANT EXECUTE cho vai deploy biến backfill trên bảng tenant thành no-op im lặng. Ranh giới có ghim ở `db/rls-coverage.int.test.ts` (it lượt soi 49, vế ⒥). Hình dạng mã, chọn một: mục theo tính chất — ngoài app_api, app_unseal, chủ hàm và superuser, không vai nào có EXECUTE trên hàm ngữ cảnh tenant; hoặc với chủ thể vai chạy migration, policy thuộc HINH_DANG_CHUAN không tính là phủ (cân nhắc migration tự `SET LOCAL app.org_id` để backfill theo tổ chức). **[S1.58] ĐÓNG — mã sản xuất, bản ba (một hướng đo và bác, lượt soi 51).** Đo trước khi viết (thăm dò S1.58, hồ sơ N2 với một nhà cung cấp thật, PostgreSQL 16): vai deploy có SELECT, UPDATE trên `suppliers` mà không EXECUTE ⇒ đếm và backfill ném 42501; thêm `GRANT EXECUTE ON FUNCTION app_current_org_id()` ⇒ đếm ra 0 không lỗi, `migrate()` ghi `999_zz_backfill101.sql` là đã áp mà hàng không đổi. **Hướng đo và bác:** `row_security = off` cho mỗi tệp đánh số — hồ sơ N3 gãy ở 004 (kiểm thân hàm SQL viết lại câu dưới RLS) rồi ở 011 (kiểm ban đầu của khoá ngoại dưới chủ bảng FORCE); migration đã áp không sửa được ⇒ ngõ cụt. **Sửa:** trong `CAU_PHU_LENH_VAI_CHAY_MIGRATION_SAI`, policy PERMISSIVE PHỤ THUỘC `app_current_org_id()` (`pg_depend`) thôi tính là phủ vai chạy migration có EXECUTE trên hàm ấy mà RLS không coi là chủ — hằng dùng chung nên cả lượt hỏi trước vòng (khoản 100) lẫn lượt phán xét sau vòng thấy dòng ấy; cột `vi_tu_loc_het`, `duong_execute`, `loi_ra_execute` (lối ra theo từng đường — đường qua nhóm KHÔNG thu hồi khỏi nhóm, nhóm là vai ứng dụng thì nói thẳng); `tu_sua_duoc` của dòng ấy = tự cắt được EXECUTE (thừa kế chủ hàm, ADMIN trên vai thừa kế chủ hàm, membership nhóm tự cấp — đo từng đường) hay cắt được đường tới quyền trên bảng, hai vế quyền chủ bảng không tính. **Lượt soi đối kháng 51** (0 CAO, 2 NẶNG, 4 NHẸ, 2 INFO; mọi phát hiện có xử lý, hai đề xuất không theo, lý do ở biên bản): NẶNG-1 — hồ sơ N3′ (vai deploy thừa kế vai NOLOGIN sở hữu bảng và hàm) với bản hai đỏ ở mọi lần deploy mà backfill vẫn bị tiêu (đo) ⇒ vai mà RLS coi là chủ đứng ngoài, dồn vào khoản 102; NẶNG-2 — vai deploy là thành viên app_api: lời khuyên chung dẫn tới thu hồi khỏi app_api (đo) ⇒ lối ra theo đường; NHẸ-5 — khớp nguyên văn `HINH_DANG_CHUAN` im với hình dạng ngoại lệ ⇒ `pg_depend`. Test: `db/migrations.int.test.ts` (một `it`, sáu pha), `db/rls-coverage.int.test.ts` (vế ⒥ lật; một `it` mười pha; một `it` ghim ranh giới khoản 102); hai mươi đột biến đỏ cô lập ~~(biên bản 73)~~ ([S1.66] §S1.58). **Ranh giới nói ra:** hàm bọc lấy hàm ngữ cảnh lọt; policy phụ thuộc hàm mà vị từ đúng khi chưa gắn tổ chức bị tính là không phủ (chiều chặn, hôm nay không có); dòng tự sửa được không bị chặn trước vòng — backfill cùng lượt bị tiêu (test ghim); xấp xỉ theo cả hai chiều; backfill theo tổ chức bằng `SET LOCAL app.org_id` dưới vai deploy thường có EXECUTE nay bị chặn; vai mà RLS coi là chủ — khoản 102. | `db/migrations/hardening.always.sql` (`CAU_PHU_LENH_VAI_CHAY_MIGRATION_SAI`, `CAU_PHU_LENH_CHU_BANG_SAI`), `packages/db/src/migrate.ts`, `db/migrations.int.test.ts`, `db/rls-coverage.int.test.ts` |
| 102 | **[MỞ]** **[S1.58, đo] VAI CHẠY MIGRATION MÀ RLS COI LÀ CHỦ BẢNG FORCE (HỒ SƠ N3: CHÍNH CHỦ; N3′: THỪA KẾ MỘT VAI NOLOGIN SỞ HỮU BẢNG VÀ HÀM) VÀ CÓ EXECUTE TRÊN HÀM NGỮ CẢNH: POLICY TENANT `TO PUBLIC` TÍNH LÀ PHỦ, CÂU CHẠM BẢNG TENANT LỌC HẾT KHÔNG LỖI — BACKFILL BỊ TIÊU, VÀ KIỂM KHOÁ NGOẠI BAN ĐẦU ĐÁNH DẤU RÀNG BUỘC HỢP LỆ MÀ KHÔNG KIỂM HÀNG.** Theo `005_identity.sql`, hình dạng này là role deploy thật của dự án (vai thường sở hữu bảng, có EXECUTE, FORCE) — tức MẶC ĐỊNH, không phải một góc hiếm; khoản 91 FORCE mọi bảng RLS nên RLS áp cho chủ. **Đo (thăm dò S1.58, PostgreSQL 16):** ⑴ `trien_khai` là chủ `suppliers` (FORCE) có EXECUTE, một backfill đang chờ ⇒ `migrate()` QUA, tệp được ghi, hàng không đổi; ⑵ N3′ ⇒ y như thế; ⑶ chủ có EXECUTE chạy `ADD FOREIGN KEY` trên hai bảng FORCE có một hàng con treo ⇒ đi qua, `convalidated = true`, hàng treo sống sót; chủ không EXECUTE ⇒ 42501; superuser ⇒ 23503. Test khoản 101 pha ⒟ và test ranh giới ở rls-coverage ghim ba điều ấy. Khoản 101 cố ý để vai mà RLS coi là chủ đứng ngoài vế loại (lượt soi 51 NẶNG-1: bản áp cho N3′ đỏ ở mọi lần deploy mà backfill vẫn bị tiêu). **Hai hướng đã đo và bác:** ⑴ `migrate()` đặt `row_security = off` cho mỗi tệp đánh số ⇒ cài mới N3 gãy ở 004 (`CREATE FUNCTION audit_append … LANGUAGE sql`: kiểm thân hàm viết lại câu dưới RLS và ném) và, khi tắt `check_function_bodies`, ở 011 (kiểm ban đầu của khoá ngoại dưới chủ bảng FORCE ném) — migration đã áp không sửa được; ⑵ chủ tự thu hồi EXECUTE của mình ngay sau 001 ⇒ 011 gãy với 42501. Áp khuôn khoản 101 cho vai giống chủ thì, theo định nghĩa (chưa đo), N3 bị chặn ở mọi bảng tenant với lối ra duy nhất đã đo là chạy `migrate()` dưới một vai BYPASSRLS — một quyết định về mô hình triển khai, không phải một bản vá. Hình dạng còn để ngỏ: migration của N3 chạy dưới một vai không sở hữu bảng; backfill và thêm khoá ngoại trên N3 đi qua một cửa sổ `NO FORCE` có canh; hay tuyên bố N3 phải deploy dưới vai BYPASSRLS. **[S1.66 / lượt soi ngang 59a, mang sang — đọc, chưa đo]** Ưu tiên tăng: một migration kiểu "chép sang bảng mới rồi DROP bảng cũ" dưới N3 chép ra 0 hàng không lỗi rồi xoá bảng cũ — mất dữ liệu, không chỉ một backfill rỗng. | `db/migrations/hardening.always.sql` (`CAU_PHU_LENH_CHU_BANG_SAI`, `CAU_PHU_LENH_VAI_CHAY_MIGRATION_SAI`), `db/migrations.int.test.ts`, `db/rls-coverage.int.test.ts` |
| 103 | **[MỞ]** **[S1.59, lượt soi 52 mang sang ⑴ — ĐO] POOL ỨNG DỤNG KHÔNG GẮN LISTENER `'error'`: MỘT KẾT NỐI RẢNH BỊ MÁY CHỦ NGẮT LÀM SẬP TIẾN TRÌNH.** pg-pool phát sự kiện `'error'` trên chính pool khi một client RẢNH gặp lỗi kết nối, và một EventEmitter không có listener thì ném. **Đo (thăm dò S1.59, PostgreSQL 16, pg 8.23.0):** tiến trình con dựng `pg.Pool` một kết nối (cùng `options` của `createPool`), lấy rồi trả client; superuser `pg_terminate_backend` backend rảnh ấy ⇒ tiến trình con thoát mã 1 với `Unhandled 'error' event`; cùng kịch bản có `pool.on('error', …)` ⇒ tiến trình sống, listener nhận 57P01. Thăm dò đo trên `pg.Pool` trần, không trên tiến trình `api` thật. **Đọc:** `createPool` và `ganVaiTroChoPool` không gắn listener; `apps/api/src/composition.ts` (pool và auditPool) và `tools/neo-so-kiem-toan` không gắn; không mã sản xuất nào nghe `uncaughtException` — chỉ client ĐANG MƯỢN có listener (`withTenant`, `migrate()`). Nguồn kích hoạt: CSDL khởi động lại hay chuyển dự phòng, `pg_terminate_backend` của người vận hành, `idle_session_timeout` (khoản 104). Hình dạng còn để ngỏ: `createPool` gắn một listener chỉ ghi TÊN lỗi, không giá trị; test tích hợp ngắt một backend rảnh của pool do `createPool` dựng trong một tiến trình con và đòi tiến trình sống. **[S1.66 / lượt soi ngang 59b-2, lượt soi 60a-3 — ĐO]** Hình dạng đóng "listener trên POOL" của hàng này không phủ client ĐANG MƯỢN, và câu "chỉ client đang mượn có listener" từng che một hồi quy: S1.59 chuyển bộ dọn sang `pool.connect()` không listener. S1.66 đóng nửa client đang mượn — hai bộ dọn, vòng kiểm lúc khởi động, và hai vòng đi-về của bộ bọc vai ở MỌI lần lấy client của pool có vai (đo: `packages/invitation/src/bo-don-ngat-ket-noi.int.test.ts`, `packages/db/src/vai-ngat-ket-noi.int.test.ts` — trước bản vá, tiến trình con chết với `Unhandled 'error' event`), cộng vế ⒟ của census đếm cả tên gán từ `.connect.bind`. Nửa pool — client RẢNH — còn mở. | `packages/db/src/pool.ts`, `apps/api/src/composition.ts`, `tools/neo-so-kiem-toan/src/index.ts`, `packages/db/src/vai-tro.ts` |
| 104 | **[MỞ]** **[S1.59, lượt soi 52 NHẸ-1, INFO-3, mang sang ⑵–⑥ — một vế ĐO, còn lại đọc] TRẠNG THÁI PHIÊN NGOÀI BA GUC VẬN HÀNH ĐI THEO KẾT NỐI POOL SANG NGƯỜI DÙNG KẾ TIẾP.** Khoản 99 đọc ba GUC ở mỗi lần lấy client; mọi GUC phiên khác và mọi trạng thái phiên ngoài GUC thì không. **Đo (thăm dò S1.59, PostgreSQL 16):** pool một kết nối mang `options -c lock_timeout=15000 -c statement_timeout=15000 -c idle_in_transaction_session_timeout=60000` (đúng ba GUC IM7 mà `createPool` đặt); một lần lấy `SET` cả ba về `0` ở phạm vi phiên rồi trả client ⇒ lần lấy kế, cùng pid, đọc `0/0/0` thay vì `15s/15s/1min` — biện pháp IM7 (nạn nhân không kẹt vô hạn sau khoá tư vấn ghi sổ, giao dịch treo bị giết) bị gỡ cho người dùng kế tiếp của kết nối, trên mọi đường kể cả `withTenant`. **Đọc (lượt soi 52):** `idle_session_timeout` (kết nối rảnh bị máy chủ ngắt — xem khoản 103), `client_encoding`, `synchronous_commit`; bốn GUC `app.*` ở lần lấy client (bộ dọn `caller_rate_limits` xoá 0 hàng dưới GUC khách rò; withTenant bắt rò ở BEGIN kế); trạng thái ngoài GUC mà `DISCARD TEMP` không dọn — cursor `WITH HOLD`, `PREPARE`, `LISTEN`, advisory lock phạm vi phiên. Hai hướng, cả hai chưa đo: phán theo nguồn (`pg_settings.source = 'session'` hay `setting` khác `reset_val`) trong cùng câu lấy client — giá của một lần quét `pg_show_all_settings()` ở mỗi lần lấy phải đo; hay dọn thay vì phán (`RESET ALL`, `CLOSE ALL`, `DEALLOCATE ALL`, `UNLISTEN *`, `pg_advisory_unlock_all()` ghép vào câu SET ROLE) — cách ấy xoá tín hiệu và đụng phép phân biệt RESET của withTenant (khoản 87), nên nếu chọn thì đọc trước, dọn sau. **[S1.66 / lượt soi 60a-5, 60b]** Cùng lớp ở `migrate()`: kết nối giữ khoá của vòng đánh số không `DISCARD TEMP` giữa các tệp. S1.66 thêm trục "đối tượng tạm" vào phép chụp cuối tệp cùng bảy trục kia (test ghim); GUC phiên khác các trục ấy mà một tệp đặt vẫn đi theo sang tệp sau và các lượt hardening sau vòng (đọc, chưa đo). Hai vế nữa, đọc, chưa đo: phép chụp đứng trước INSERT vào `schema_migrations` và COMMIT của tệp, nên trigger trên bảng ấy hay constraint trigger hoãn do một tệp trước dựng đổi được trạng thái phiên SAU phép so (đối kháng); lỗi của lượt hardening sau vòng không đặt `phaiHuyPhien`, nên kết nối mang trạng thái ấy quay về pool. | `packages/db/src/vai-tro.ts`, `packages/db/src/pool.ts`, `packages/tenancy/src/with-tenant.ts`, `packages/db/src/migrate.ts` |
| 105 | **[MỞ]** **[S1.61, lượt soi 54 mang sang ⑶ — ĐO] HARDENING KHÔNG CANH RÀNG BUỘC `CHECK` AN NINH: GỠ HAY HẠ VỀ `NOT VALID` SAU DEPLOY THÌ `migrate()` KẾ TIẾP KHÔNG THẤY.** `hardening.always.sql` tái lập trigger ở mỗi deploy (ví dụ `supplier_contacts_kiem_danh_tinh`) nhưng không phán xét sự tồn tại hay `convalidated` của `CHECK` nào. **Đo (thăm dò S1.61, PostgreSQL 16):** sau `migrate()` trọn kho, `DROP CONSTRAINT users_email_chu_thuong`, `DROP CONSTRAINT supplier_contacts_email_chu_thuong` và thay `supplier_contacts_email_hinh_dang` bằng bản `NOT VALID` ⇒ `migrate()` lại ĐI QUA (không tệp chờ), không ràng buộc nào được phục hồi hay phán xét, và `INSERT` người dùng `Alice105@corp.com` VÀO. Ba ràng buộc ấy là lớp duy nhất ở tầng lược đồ của khoản 63, khoản 70 và hình dạng email (011). Hình dạng còn để ngỏ: tự chữa (thêm lại khi thiếu — không đơn điệu vì dữ liệu có thể đã vi phạm, nên theo ADR-028 §2⑵ là phán xét) hay phán xét sự tồn tại, định nghĩa và `convalidated` của một danh sách `CHECK` khai theo tên; câu hỏi phạm vi: mọi `CHECK` của bảng tenant hay chỉ `CHECK` mang ý nghĩa an ninh. | `db/migrations/hardening.always.sql`, `db/migrations/048_email_nguoi_dung_chu_thuong.sql`, `db/migrations/049_email_lien_he_chu_thuong.sql`, `db/migrations/011_rfq_hardening.sql` |
| 106 | **[ĐÓNG]** **[S1.63, thăm dò S1.62 và lượt soi 56 — ĐO] MỘT BẢN RÕ JSON HỢP LỆ MÀ `jsonb` HAY `JSON.stringify` KHÔNG NHẬN CHẶN CẢ LƯỢT MỞ THẦU — [S1.6 H1] MỚI ĐÓNG NỬA ĐƯỜNG.** `thanhJson` gỡ U+0000 THÔ trên văn bản TRƯỚC `JSON.parse`, rồi `executeUnsealRequest` ghi `JSON.stringify(thanhJson(banRo))` vào `jsonb` NGOÀI mọi `catch`. Bốn loại đầu vào đi qua bước gỡ và làm CẢ giao dịch rollback: ⑴ escape `\u0000` trong một CHUỖI ⇒ `22P05 unsupported Unicode escape sequence`; ⑵ escape ấy trong một KHOÁ ⇒ `22P05`; ⑶ escape surrogate đơn lẻ `\ud800` trong một chuỗi ⇒ `22P02 invalid input syntax for type json`; ⑷ mảng lồng 5 000 tầng (10 KB) hay 20 000 tầng (40 KB) ⇒ `RangeError: Maximum call stack size exceeded` ném ra khỏi `executeUnsealRequest` — tức SAU `thanhJson`, vì `catch` của nó bắt mọi lỗi của `JSON.parse`; nhiều khả năng từ `JSON.stringify` (suy luận). **Đo (PostgreSQL thật dưới `app_unseal`, `it` tạm, không commit):** mỗi ca một RFQ với một báo giá sạch và một báo giá xấu, thử hai lần ⇒ cả hai lần đều NÉM, `rfq_unsealed_bids` 0 hàng, yêu cầu vẫn `APPROVED`. Báo giá sạch cũng không mở được: một nhà cung cấp khoá cả cuộc thầu ở mọi lần thử lại, và không cần ác ý — một client cắt chuỗi giữa một cặp surrogate cũng sinh ca ⑶ (suy luận). Đường `{ raw: … }` không dính: văn bản đã gỡ NUL, `TextDecoder` thay byte hỏng bằng U+FFFD, và `JSON.stringify` thoát dấu gạch chéo ngược. ~~**Hình dạng đóng còn để ngỏ**~~ **[S1.64] Hình dạng đóng đã áp dụng** (lượt soi 56 C1 bác hình dạng cũ): KHÔNG gỡ U+0000 khỏi khoá sau `JSON.parse` — gộp hai khoá làm mất một giá trị âm thầm. Thay vào đó, sau `JSON.parse` đi cây bằng vòng lặp; gặp chuỗi hay khoá chứa U+0000, chuỗi không well-formed (`isWellFormed`), hay độ sâu vượt ngưỡng, thì cất `{ raw: van }`. Kèm test cho cả bốn ca, không ghim mã lỗi. Chú thích của `thanhJson` hứa quá — đã gạch ở S1.63. **[S1.64] ĐÓNG — `thanhJson` phân tích văn bản GỐC rồi đi cây bằng vòng lặp (`jsonbNhanDuoc`): bản rõ không phải JSON hợp lệ (kể cả khi mang U+0000 THÔ), chuỗi hay KHOÁ mang escape U+0000 hoặc surrogate đơn lẻ, hay độ sâu vượt 64, thì cất `{ raw }` đã gỡ U+0000, và lượt mở thầu chạy trọn (bản hai, sau lượt soi 57).** Đo trước khi viết: chín `it` `[khoản nợ 106]` viết trước (PostgreSQL 16 thật dưới `app_unseal`; mỗi `it` một RFQ có một báo giá sạch, mở thầu MỘT lần, đòi chạy trọn, không ghim mã lỗi). Bản một, trên mã cũ: sáu ĐỎ — ⑴ và ⑵ `unsupported Unicode escape sequence`, ⑶ và ca soi hết cây `invalid input syntax for type json`, ⑷ `RangeError`, ca ngưỡng đỏ ở assertion — còn `it` đối chứng XANH. Bản hai, trên mã bản một: `it` U+0000 thô và `it` JSON của khoản 10 (kỳ vọng LẬT có chủ đích) ĐỎ ở assertion; `it` đối tượng lồng XANH, là lưới giữ có đột biến. Node 24.18 cục bộ: `/\p{Surrogate}/u` tách đúng surrogate đơn lẻ với cặp hợp lệ; `JSON.stringify` ném từ 4 744 tầng ở ngăn xếp nông; `JSON.parse` ném với U+0000 thô ở cả sáu vị trí thử. **Sửa:** `DO_SAU_JSON_TOI_DA = 64` là biên an toàn (báo giá thật lồng vài tầng); escape U+0000 trong khoá KHÔNG bị gỡ (lượt soi 56 C1); U+0000 thô chỉ gỡ khỏi `raw`; chú thích `thanhJson` gạch câu "rollback ở mọi lần thử" và ghi lập luận đường `{ raw }` luôn cất được kèm ranh giới. Sau bản vá: trọn `unseal-worker.int.test.ts` 21/21 xanh; trọn bốn tệp tích hợp của `apps/unseal-worker` 57/57 xanh; `pnpm test` 50 tệp / 748 test + 1 bỏ qua; mười lăm đột biến đỏ cô lập, mỗi cái đúng tập test dự kiến ~~(biên bản 79)~~ ([S1.66] §S1.64). **Lượt soi đối kháng 57** (0 CAO, 1 NẶNG, 4 NHẸ, 3 INFO; reviewer không tìm được bản rõ nào còn chặn lượt mở thầu trong ranh giới đã nêu): NẶNG-1 — U+0000 THÔ gỡ TRƯỚC `JSON.parse` biến văn bản không hợp lệ thành JSON khác (`{"a␀":1,"a":2}` ⇒ `{"a":2}`, `1␀5` ⇒ `15`) ⇒ phân tích văn bản GỐC, gỡ chỉ trên `raw`, kỳ vọng `it` JSON của khoản 10 LẬT có chủ đích; NHẸ — độ sâu tính cả đối tượng lồng (test 64, 65, 5 000 tầng), ca trộn U+0000 thô với escape, bốn câu chú thích nói quá được sửa, surrogate đơn lẻ trong một GIÁ TRỊ đẩy cả báo giá sang `raw` — giữ hình dạng đóng và nói ra hệ quả; INFO — số tiền qua `double` ⇒ khoản 107 (đo), ba ranh giới của đường `raw` vào chú thích, hai đường ghi `jsonb` khác chỉ hỏng yêu cầu của chính người gọi ⇒ chỉ nêu. **Ranh giới nói ra:** cụm mã hoá UTF8; phong bì tối đa 8 MiB (018) nên giới hạn kích thước của `jsonb` không chạm tới; ngưỡng stack của bộ phân tích JSON PostgreSQL chưa đo (64 tầng đo được là nhận); báo giá hợp lệ sâu hơn 64 tầng thành `{ raw }` nên bảng so sánh đọc số tiền `null`; U+0000 THÔ bị gỡ khỏi `raw` không để lại dấu. Còn: `client_encoding` của phiên phải là UTF8 (một `SET` phạm vi phiên đi theo kết nối trong pool — khoản 104); trần 8 MiB là một `CHECK` (lớp của khoản 105); `JSON.parse` dựng trọn cây trước phép đi cây (hết bộ nhớ chưa đo); một surrogate đơn lẻ hay escape U+0000 trong một GIÁ TRỊ đẩy CẢ báo giá sang `raw`, nên bảng so sánh đếm nó là `unparsed` và bỏ nó ra khỏi min, max, trung bình (quyết định có chủ ý). Mang sang ⇒ khoản 107 (đo: số tiền kiểu số JSON bị làm tròn qua `double`). | `apps/unseal-worker/src/index.ts`, `apps/unseal-worker/src/unseal-worker.int.test.ts` |
| 107 | **[ĐÓNG]** **[S1.64, lượt soi 57 INFO-1 — ĐO trên Node 24.18] SỐ TIỀN KIỂU SỐ JSON TRONG BẢN RÕ ĐI QUA `double` TRƯỚC KHI VÀO `jsonb` — BẢNG SO SÁNH CÓ THỂ ĐỌC MỘT CON SỐ KHÁC CON SỐ ĐÃ NIÊM PHONG, KHÔNG MỘT DẤU NÀO.** `thanhJson` cất đối tượng mà `JSON.parse` dựng ra, nên mọi SỐ JSON đi qua `double` của JavaScript rồi được `JSON.stringify` viết lại ở dạng ngắn nhất. Đo (`JSON.parse` rồi `JSON.stringify` giá trị `totalAmount`): `99999999999999.99` ⇒ `99999999999999.98`; `9007199254740993` ⇒ `9007199254740992`; `12345678901234567890` ⇒ `12345678901234567000`; `123456789012.345678` ⇒ `123456789012.34567`; `1e400` ⇒ `null`; `-0` ⇒ `0`; `1234567.10` ⇒ `1234567.1`. `bid_so_tien` (022) nhận `payload->>'totalAmount'` trong miền `numeric(18, 2)` — dưới 10^16, tối đa hai chữ số thập phân — nên HAI ca đầu vào bảng so sánh và các phép tổng hợp với con số đã đổi; `12345678901234567890`, `123456789012.345678` và `1e400` ra NULL dù có khứ hồi hay không; `-0` và `1234567.10` giữ giá trị. Số tiền gửi dạng CHUỖI thập phân không đi qua `double`, nên không bị đổi. Số có tối đa 15 chữ số có nghĩa khứ hồi nguyên giá trị (suy luận IEEE-754). Có từ S1.6. ~~**Hình dạng đóng đề xuất:**~~ **[S1.65] Hai hình dạng đề xuất dưới đây KHÔNG được chọn — xem đoạn ĐÓNG:** đọc số từ văn bản nguồn — reviver của `JSON.parse` với `context.source` (Node 24.18 có, đo; Node 22 của CI chưa đo) — hoặc đòi `totalAmount` là chuỗi thập phân; kèm test cho các ca trên. **[S1.65] ĐÓNG — `thanhJson` trả VĂN BẢN để ghi: văn bản GỐC khi đủ ba vế, `{ raw }` khi không; `jsonb` tự phân tích văn bản gốc, nên mọi số giữ nguyên GIÁ TRỊ (`numeric` chính xác).** Ba vế: ⑴ `JSON.parse` ra một đối tượng mà `demKhoaJsonbNhan` (tên mới của `jsonbNhanDuoc`) thấy mọi chuỗi, khoá và độ sâu trong miền `jsonb` — khoản 106; ⑵ số token khoá do `demKhoaVanBan` quét trên văn bản BẰNG số khoá của cây, tức không khoá trùng; ⑶ văn bản của mọi số dài tối đa 1 000 ký tự và trị tuyệt đối của số mũ tối đa 324. Đo trước khi viết (PostgreSQL 16.15 thật, Node 24.18): reviver `context.source` kèm `JSON.rawJSON` giữ đúng văn bản số, nhưng bản rõ 8 MiB gồm 4,19 triệu số `0` tốn 2 941 ms và 604 MiB RSS (không reviver: 29 ms, 84 MiB) ⇒ loại; `numeric` nhận số nguyên 131 072 chữ số, `1e131071`, `0.` cùng 16 383 chữ số và ném `22003` ngay sau các mốc ấy, còn `1e131071` đọc lại là 131 072 ký tự ⇒ vế ⑶; giá trị BỊ GHI ĐÈ của khoá trùng mang escape surrogate đơn lẻ hay escape U+0000 làm `jsonb` ném `22P02`, `22P05` dù `JSON.parse` chỉ giữ giá trị sau ⇒ vế ⑵; mảng lồng đứng riêng 5 000 tầng nhận, 20 000 tầng ném `54001`; `pg` đọc `{"a":99999999999999.99}` ra `…98`. Test viết trước: bảy `it` `[khoản nợ 107]`, so `payload` với bản rõ bằng `jsonb =` của PostgreSQL chứ không qua `pg`; trên mã cũ sáu ĐỎ ở assertion (số tiền `…98`, cây số, biên, trần `numeric`, khoá trùng, bảng so sánh), còn `it` đối chứng của phép quét XANH. Sau bản vá: `unseal-worker.int.test.ts` 28/28; bốn tệp tích hợp của `apps/unseal-worker` 64/64; `pnpm test` 50 tệp / 748 test + 1 bỏ qua; hai mươi lăm đột biến đỏ cô lập ở lượt ba, sau lượt soi 58, mỗi cái đúng tập test dự kiến hay tập chứa đã ghi trước — lượt một bắt M10 sống sót nhờ hai lỗi đếm bù nhau, và ca khoá trùng lần theo nó làm `jsonb` ném `22P02` dưới đột biến ~~(biên bản 80)~~ ([S1.66] §S1.65). Nguyên mẫu đo ngoài worker trên cùng bốn ca 8 MiB: khoảng 90 ms và 96 MiB RSS. Lượt soi đối kháng 58 (0 CAO, 0 NẶNG, 4 NHẸ, 4 INFO; fuzz vi sai khoảng 3,7 triệu đầu vào không ra bản rõ nào làm lượt mở thầu hỏng hay đổi thầm một giá trị): NHẸ-1 số vượt `numeric` nằm trong MẢNG và NHẸ-2 CR hay LF giữa khoá và dấu hai chấm — mỗi lỗ để một đột biến sống sót mà dưới nó một bản rõ làm cả lượt mở thầu rollback — ⇒ thêm ca vào `it` trần `numeric`, `it` khoá trùng và `it` đối chứng, đột biến M20–M22 đỏ; NHẸ-3 câu chú thích về `RangeError` của phép đi cây đệ quy nói quá ⇒ sửa theo số đo 5 000 và 20 000 tầng; NHẸ-4 ký tự không-phải-ký-tự U+FFFE, U+FFFF, U+FDD0 chưa đo ⇒ ĐO qua worker: `jsonb` nhận, payload giữ nguyên hình dạng; INFO — khoản 108 xác nhận, độ phình khi đọc hơn đường cũ khoảng 5% chứ không bằng, tài nguyên đường mới không thua đường cũ, số mũ 325 tới 16 383 vào `raw` dù `jsonb` nhận (bảo thủ có chủ đích). Thay đổi hành vi nói ra: bản rõ có khoá trùng, hay có một số ngoài biên, nay cất dưới `{ raw }` — trước là có cấu trúc với giá trị cuối, `null`, `0` hay số đã làm tròn — nên bảng so sánh đếm nó `unparsed`. Ranh giới nói ra: số giữ giá trị chứ không giữ chữ viết (`1E2` đọc lại `100`, `-0` là `0`); `demKhoaVanBan` chỉ đúng với văn bản `JSON.parse` vừa nhận; với biên 324, độ phình khi đọc gần đường cũ — `1e324` đọc lại 325 ký tự (đo), và ở ca xấu nhất hơn đường cũ khoảng 5% (lượt soi 58, tính, chưa đo) — còn một bản rõ 8 MiB toàn số như thế chưa đo ở phía đọc; bộ nhớ đo ngoài worker. Mang sang ⇒ khoản 108 (đo: payload phía đọc lại qua `double`). | `apps/unseal-worker/src/index.ts`, `packages/unseal/src/comparison.ts`, `apps/unseal-worker/src/unseal-worker.int.test.ts` |
| 108 | **[MỞ]** **[S1.65, khoản 107 mang sang — ĐO] PAYLOAD CỦA BẢNG SO SÁNH LẠI ĐI QUA `double` Ở PHÍA ĐỌC — `pg` PHÂN TÍCH CỘT `jsonb` BẰNG `JSON.parse`.** Sau khoản 107, `rfq_unsealed_bids.payload` giữ đúng giá trị số đã niêm phong, và `ComparisonRow.totalAmount` cùng các phép tổng hợp đọc bằng SQL nên đúng (đo: `buildComparisonTable` trả `99999999999999.99` và `9007199254740993`). Nhưng `payload` mà `buildComparisonTable` trả là đối tượng do `pg` phân tích: đo trên PostgreSQL 16.15, `'{"a":99999999999999.99}'::jsonb` đọc qua `pg` ra `a` = `99999999999999.98`. `GET /rfqs/:rfqId/comparison` rồi viết thân bằng `JSON.stringify` (`apps/api/src/server.ts`, đọc mã). Người mua xem một trường số khác `totalAmount` trong payload — đơn giá hay số lượng quá 15 chữ số có nghĩa — thấy con số đã làm tròn, không một dấu nào. Một client JavaScript phân tích thân bằng `JSON.parse` làm tròn thêm lần nữa, nên sửa riêng phía máy chủ chưa đủ. Hình dạng đóng còn để ngỏ, và là một quyết định về hợp đồng API: trả `payload` dạng văn bản `jsonb` để client tự phân tích; hay xuất số ngoài miền chính xác của `double` thành chuỗi thập phân; hay giữ nguyên và ghi vào hợp đồng rằng số tiền chuẩn là `totalAmount` dạng chuỗi. | `packages/unseal/src/comparison.ts`, `apps/api/src/server.ts` |
| 109 | **[MỞ]** **[S1.66, lượt soi ngang 59a-2 + 59a-4 — ĐO] SEARCH PATH CỦA PHIÊN ỨNG DỤNG CHỈ ĐƯỢC SO TƯƠNG ĐỐI, VÀ LƯỢT SỬA GỠ HÀNG CHE MỨC VAI MÀ KHÔNG DỪNG — MỘT `search_path` ĐỘC Ở CỤM HAY Ở MẶC ĐỊNH VAI ĐI QUA DEPLOY XANH, VÀ PHIÊN ỨNG DỤNG CHẠY DƯỚI NÓ.** Hai phép đo trên PostgreSQL 16, lược đồ thật. ⑴ (59a-2) `ALTER SYSTEM SET search_path = ke_gian, public` rồi reload, `ke_gian` cấp USAGE cho app_api; hàng che mang giá trị ĐÚNG (`"$user", public`) ở `app_api_login` và ở vai deploy ⇒ `migrate()` đi qua không lỗi, lượt sửa gỡ hàng của `app_api_login`, và một pool ứng dụng mới dưới `app_api_login` lấy client không lỗi với `current_schemas(false)` = `{ke_gian,public}` — lần lấy client của S1.59 so TƯƠNG ĐỐI với mốc của chính kết nối nên không thấy. ⑵ (59a-4) một vai đăng nhập thành viên app_api mang mặc định `search_path = public, pg_catalog`, và `public.lower(text)` trả `CUOP` có EXECUTE cho app_api ⇒ lấy client không ném, `current_schemas(false)` = `{public,pg_catalog}`, `SELECT lower('ABC')` ra `CUOP` cả ngoài lẫn trong `withTenant`. Deploy kế đóng cửa sổ ấy — vai ngoài danh sách vai đăng nhập ứng dụng bị gỡ membership (lấy client sau đó ném `permission denied to set role "app_api"`), `app_api_login` bị `RESET ALL` xoá mặc định — nên cửa sổ nằm GIỮA hai lần deploy. Phần cấm của khoản 92/95 (ngoài `"$user"` và `pg_catalog`, không schema nào đứng trước `public`; `pg_catalog` không đứng sau `public`) là bất biến đọc được từ `current_schemas(false)`, nên lời khai "so TƯƠNG ĐỐI vì giá trị hợp lệ không bất biến" (S1.54, S1.59) đúng một nửa. Người đặt được độc: superuser, CREATEROLE cùng ADMIN, hay chính vai đăng nhập tự `ALTER ROLE` (đọc, chưa đo). Hình dạng còn để ngỏ: phép kiểm TUYỆT ĐỐI trên mảng `current_schemas(false)` ở lần lấy client và ở `withTenant` (không nêu tên GUC — [INV-H21]), giữ so tương đối phần còn lại; và chụp trước, sau lượt sửa đầu các hàng mức VAI của vai canh và vai kết nối ứng dụng cho ba GUC vận hành — gỡ được hàng nào thì DỪNG như nhánh mức database. **[lượt soi 60b]** Ba điều thêm, đọc, chưa đo. ⑶ `ALTER SYSTEM` đặt độc mà CHƯA nạp lại lúc deploy rồi nạp lại sau thì phiên deploy không thấy gì, không cần hàng che nào — nửa "chụp hàng mức vai … DỪNG" không đóng vế này, chỉ phép kiểm tuyệt đối ở lớp ứng dụng đóng. ⑷ Kịch bản ⑵ còn cần CREATE trên `public` để dựng `public.lower(text)` (bản nháp dùng superuser); và [INV-H21] ghim `pg_catalog.` cho mọi câu SQL của mã sản xuất, nên câu `lower('ABC')` trần chỉ là câu thăm dò — mặt tấn công thật là tên trần trong thân hàm của lược đồ dự án. ⑸ Người soi 59a còn đề xuất tách `GUC_VAN_HANH_KHAI` theo nhánh (khai `session_replication_role` vào đó là lối ra duy nhất của nhánh ⒟ ngoài REVOKE, nhưng tắt luôn nhánh ⒝) và đọc `pg_file_settings` khi phiên đọc được — chưa làm: cả hai đổi hình dạng đóng của khoản này, nên để vòng đóng khoản cân cùng hai vế ⑴ ⑵; `pg_file_settings` theo tài liệu PostgreSQL mặc định chỉ superuser đọc được (đọc tài liệu, chưa đo dưới vai deploy). | `packages/db/src/migrate.ts`, `packages/db/src/vai-tro.ts`, `packages/tenancy/src/with-tenant.ts`, `db/migrations/hardening.always.sql` |
| 110 | **[MỞ]** **[S1.66, lượt soi ngang 59a-3 — ĐO] MỤC TỰ CHỮA FORCE CỦA KHOẢN 91 CHẠM BẢNG RLS NGOÀI DỰ ÁN CỦA CÙNG DATABASE Ở LƯỢT SỬA ĐẦU, TRƯỚC KHI 83⑶ PHÁN XÉT — FORCE ĐƯỢC COMMIT DÙ LƯỢT PHÁN XÉT NÉM, VÀ CHỦ BẢNG LÁNG GIỀNG ĐỌC 0 HÀNG KHÔNG LỖI.** Đo trên PostgreSQL 16, lược đồ thật: lược đồ `zz_bt` của vai thường `zz_bt_chu`, bảng 2 hàng, ENABLE RLS không FORCE, policy duy nhất `TO zz_bt_app` — chủ đọc 2 hàng. `migrate()` dưới superuser NÉM ở lượt phán xét (3 mục, mục đầu là 83⑴), nhưng sau lượt ấy `relforcerowsecurity` = true và chủ đọc 0 hàng không lỗi. Chủ thể của mục (bảng bật RLS chưa FORCE trong `MAU_SCHEMA_DU_AN`, trừ đối tượng thuộc extension) thực chất là MỌI lược đồ không hệ thống của database, và lối ra mà TP100 và 049 khuyên — chạy `migrate()` dưới superuser — là đúng đường làm việc ấy. Hình dạng còn để ngỏ, và phụ thuộc một hồ sơ hạ tầng mà DECISIONS chưa có (database riêng hay dùng chung — lượt soi 49 INFO-2): giới hạn chủ thể FORCE vào bảng tenant, bảng RLS ngoài tenant đã khai và bảng do vai deploy sở hữu; hay một danh sách miễn có khai; và ghi phạm vi vào ADR-036 hàng 7. | `db/migrations/hardening.always.sql`, `docs/DECISIONS.md` |
| 111 | **[MỞ]** **[S1.66, lượt soi ngang 59a-5 / 59c NHẸ-16 — ĐO] KHUÔN ĐỌC `CAU_TEN_GUC_DU_AN_DOC` (KHOẢN 87) KHÔNG CÙNG ĐỊNH NGHĨA TOKEN VỚI KHUÔN GHI CỦA KHOẢN 96 — TÊN GUC ĐỌC QUA MỘT CHÚ THÍCH GIỮA HAI TOKEN, HAY VIẾT BẰNG DOLLAR-QUOTE, KHÔNG VÀO TẬP TÊN MÀ NHÁNH ⒞ CỦA 87 CANH.** Đo trên PostgreSQL 16, lược đồ thật: thân `RETURN current_setting/**/('app.zz_a', true)` ⇒ `app.zz_a` KHÔNG vào tập; `current_setting($d$app.zz_b$d$, true)` ⇒ KHÔNG vào tập; đối chứng `current_setting('app.zz_c', true)` ⇒ vào tập. Mang sang ⑴ của lượt soi 47 (S1.54: "đọc, chưa đo tác động") không thành khoản từ S1.54 tới S1.65. Nhánh ⒞ của 87 là lớp duy nhất cho conf, `ALTER SYSTEM` và `options=` của mọi GUC tuỳ biến ngoài bốn tên ghim cứng, nên một tên không vào tập là một tên đặt được ở tầng ấy mà không mục nào nêu — suy từ đọc; `ALTER SYSTEM SET app.zz_a` chưa đo. Khuôn ĐỌC còn (đọc): không nhận tên hàm có nháy kép; lớp ký tự tên bỏ `$` và byte từ 0x80; sáu bề mặt, không rule/view, không WHEN của trigger — khuôn GHI có cả hai. Hình dạng: dựng khuôn đọc từ cùng định nghĩa khoảng cách token (khoảng trắng hoặc chú thích) và cùng cách viết tên (`'…'`, `E'…'`, `U&'…'`, dollar-quote) của khuôn ghi; thêm `pg_rewrite` và WHEN của trigger. | `db/migrations/hardening.always.sql`, `db/rls-coverage.int.test.ts` |
| 112 | **[MỞ]** **[S1.66, lượt soi ngang 59c NHẸ-14 — biểu thức ĐO, hệ quả đọc] `NGOAI_LE_DOC_VONG` — CỬA RA CỦA MỌI VIEW, MATVIEW VÀ HÀM SECURITY DEFINER Ở MỤC (C) — VẪN LÀ MỘT TRỤC TÊN SO BẰNG `NOT IN`: CHƯA SIẾT NHƯ BỐN DANH SÁCH KHAI KHÁC, VÀ MỘT DÒNG NULL LÀM CẢ HAI NHÁNH IM.** Mục nhật ký 65 ⑹ (S1.50) hẹn siết "vòng sau", và lượt soi 42 NHẸ-2 gọi nó là cửa ra yếu nhất tệp; không vòng nào từ S1.51 tới S1.65 làm, và nó không thành khoản. HEAD: hằng là `VALUES ('')`, và hai vị từ so tên ghép lược đồ và tên bằng `NOT IN (SELECT ten FROM …)` — nhánh view/matview và nhánh SECURITY DEFINER. Đo trên PostgreSQL 16: `'public.v' NOT IN (SELECT ten FROM (VALUES (NULL::text)) AS x(ten))` ra NULL; hệ quả cho mục đọc từ vị từ: một dòng NULL làm điều kiện không bao giờ đúng, tức mục (C) im với mọi view và mọi hàm SECURITY DEFINER. Hình dạng: khoá `(loại, lược đồ, tên, lý do)`, hàm ghim bằng `regprocedure`, `NOT EXISTS` thay `NOT IN`, chiều khai thiu, và bản đối chiếu ở test — như bốn danh sách khai khác. | `db/migrations/hardening.always.sql`, `db/rls-coverage.int.test.ts` |
| 113 | **[MỞ]** **[S1.66, lượt soi ngang 59c NẶNG-3 — CHƯA ĐO] CHIỀU CHẶN CỦA `tu_sua_duoc` — LƯỢT `truoc_vong` CÓ THỂ CHẶN TRƯỚC VÒNG MỘT DÒNG MÀ MIGRATION DƯỚI CHÍNH VAI DEPLOY SỬA ĐƯỢC, ĐÚNG LOẠI NGÕ CỤT MÀ ĐIỀU KIỆN CỦA NGOẠI LỆ S1.57 CẤM.** ADR-028 §3 (khoản 100) cho phép chặn trước vòng với điều kiện ngoại lệ "không lấy mất lối ra nào". S1.58 ghi `tu_sua_duoc` xấp xỉ theo CẢ HAI chiều (ranh giới ⑷, lượt soi 51 INFO-8): vế EXECUTE không đọc `grantor` của mục ACL, nên ADMIN trên một vai giữ GRANT OPTION đã cấp EXECUTE thẳng cho vai deploy không được tính là một đường tự cắt — cùng điểm mù với vế bảng. Ba lời khai tuyệt đối (ADR-028 §3, chú thích ở `migrate.ts`, §S1.57 ranh giới ⑵) không nói chiều ấy, và cả ba được gạch ở S1.66. CHƯA ĐO: vai R giữ GRANT OPTION cấp EXECUTE (hay quyền bảng) thẳng cho vai deploy D, D có ADMIN trên R — một migration dưới D tự cắt được đường ấy không, và `truoc_vong` có chặn dòng ấy không. Hình dạng tuỳ phép đo: thêm vế `grantor` vào `tu_sua_duoc`, hay ghi ranh giới kèm lối ra. | `db/migrations/hardening.always.sql`, `packages/db/src/migrate.ts`, `docs/DECISIONS.md` |
| 114 | **[MỞ]** **[S1.66, lượt soi ngang 59b-3 — ĐO] PHÍA ĐỌC CỦA BẢNG SO SÁNH KHÔNG ĐỨNG CẠNH BIÊN SỐ CỦA S1.65 — `->>` TRÊN MỘT `totalAmount` KHÔNG VÔ HƯỚNG DỰNG CẢ CÂY THÀNH VĂN BẢN, NÊN MỘT NHÀ CUNG CẤP LÀM PHÌNH MỖI LẦN ĐỌC BẢNG SO SÁNH CỦA CẢ RFQ.** `comparison.ts` gọi `bid_so_tien(payload->>'totalAmount')` BẢY lần trong hai câu (đọc mã, lượt soi 60b): hai ở câu hàng (danh sách chọn, ORDER BY), năm ở câu tổng hợp (min, max, trung bình, vế dưới ngân sách, điều kiện IS NOT NULL) — mỗi lần dựng bảng khai triển `->>` khoảng bảy lần cho mỗi báo giá; câu hàng còn trả nguyên `payload` về tiến trình api. `bid_so_tien` bắt lỗi ép kiểu và trả NULL. Đo trên PostgreSQL 16.15 (bảng nháp, không qua worker), `totalAmount` là một mảng N phần tử `1e324`: N = 10 000 — lưu 2 768 byte, văn bản vào tính bằng 6 × N = 60 000 ký tự (không đo), `->>` ra 3 270 000 ký tự (khoảng 54,5 lần văn bản tính), `bid_so_tien` ra NULL trong 22 ms; N = 100 000 — lưu 27 146 byte, vào tính 600 000, ra 32 700 000 (khoảng 54,5 lần), 183 ms; `jsonb_typeof` ra `array` trong 2 ms. Người soi tính cho bản rõ 8 MiB: khoảng 436 MiB mỗi lần `->>` — tính, chưa đo ở kích thước ấy — nhân với bảy lần gọi mỗi báo giá. Hôm nay trần thân HTTP 64 KiB chặn trước (đọc `apps/api/src/router.ts`), trong khi lời khai của 106/107 tính theo trần 8 MiB của 018. Hình dạng: tính số tiền MỘT lần cho mỗi báo giá, chỉ khi `jsonb_typeof` là `number` hay `string`, và dùng chung cho cả hai câu; ngân sách độ dài khai triển số ở `thanhJson`; nâng trần thân HTTP thì đo lại. | `packages/unseal/src/comparison.ts`, `apps/unseal-worker/src/index.ts`, `apps/api/src/router.ts` |
| 115 | **[MỞ]** **[S1.66, lượt soi ngang 59b-4 — ĐỌC, cộng một phép đo thiết lập kho] BÀI HỌC KHOẢN 67 CHƯA ÁP CHO `ci.yml` — WORKFLOW KHÔNG KHAI `permissions`, `checkout` GIỮ THÔNG TIN XÁC THỰC, VÀ `pnpm install` (SCRIPT VÒNG ĐỜI CỦA PHỤ THUỘC) CHẠY CÙNG JOB VỚI BƯỚC NHẬN `secrets.GITHUB_TOKEN`.** Đọc: `ci.yml` chạy khi push master, không khối `permissions`; `actions/checkout` với `persist-credentials` mặc định; job t0 chạy `pnpm install` rồi đưa `secrets.GITHUB_TOKEN` cho bước gitleaks; `tests/architecture/hinh-dang-ci.test.ts` không khẳng định quyền; cache pnpm mà job `lap` của `do-lap.yml` ghi được thì các job này khôi phục (chưa kiểm xác minh toàn vẹn). Đo (S1.66, API thiết lập Actions của kho): `default_workflow_permissions` = `read` — hôm nay token mặc định chỉ đọc, nên mức là NHẸ; đổi thiết lập kho sang ghi thì thành NẶNG mà không một dòng mã nào đổi. Hình dạng: `permissions: contents: read` mức workflow; `persist-credentials: false`; tách gitleaks sang một job không `pnpm install`; mở rộng test GHIM sang `ci.yml`. | `.github/workflows/ci.yml`, `tests/architecture/hinh-dang-ci.test.ts` |
| 116 | **[MỞ]** **[S1.66, lượt soi ngang 59b-6 — ĐỌC] ĐƯỜNG CHẠY SẢN XUẤT CỦA WORKER MỞ THẦU CHƯA TỒN TẠI — `apps/unseal-worker` CÓ COMPOSITION NHƯNG KHÔNG CÓ ĐIỂM VÀO TIẾN TRÌNH, NÊN PHÉP ĐO CỦA 106/107 CHẠY TRÊN MỘT ĐƯỜNG KHÁC ĐƯỜNG SẼ CHẠY.** Đọc: `apps/unseal-worker/package.json` khai `main` và `exports` tới `src/index.ts`, và `src/composition.ts` có `createUnsealWorkerRunner` (lượt soi 60b bác bản đầu của hàng này) — cái thiếu là một điểm vào TIẾN TRÌNH dựng pool `app_unseal` rồi chạy runner; `createUnsealWorkerRunner` nhận pool từ người gọi; test 106/107 chạy `withTenant` trên pool `app_unseal` của test-support — không IM7, không `statement_timeout` LOCAL 60 s và `Promise.race` 60 s của `JobRunner`. "Lượt mở thầu chạy trọn" đúng cho đường đã đo, chưa đúng cho đường sẽ chạy. Hình dạng: dựng điểm vào tiến trình của worker (`createPool` với vai `app_unseal` rồi `createUnsealWorkerRunner`), đo lại 106/107 trên đường ấy ở trần thân HTTP và ở 8 MiB, và đo thời hạn của handler. | `apps/unseal-worker/package.json`, `apps/unseal-worker/src/composition.ts`, `apps/unseal-worker/src/index.ts`, `packages/outbox/src/runner.ts` |
| 117 | **[MỞ]** **[S1.66, lượt soi ngang 59a-8 mở rộng — ĐO] THÔNG ĐIỆP CỦA CÁC MỤC CANH THÂN HÀM IN NGUYÊN `prosrc` VÀ `proconfig` — CẢ GIÁ TRỊ GUC — CÙNG `pg_get_triggerdef`, KỂ CẢ Ở WARNING CỦA LƯỢT SỬA KHI DEPLOY DƯỚI SUPERUSER TỰ CHỮA THÀNH CÔNG.** S1.66 vá bốn mục canh policy in biểu thức (83⑴, [CR1], 042, 044 — `db/thong-diep-khong-gia-tri.int.test.ts`). Cùng lớp, đếm dòng trên `hardening.always.sql` ở S1.66: 52 chỗ nối thân hàm đã chuẩn hoá khoảng trắng vào ô mô tả, 52 chỗ nối `proconfig`, 43 chỗ nối `pg_get_triggerdef`. Đo trên PostgreSQL 16, lược đồ thật: ⑴ `ALTER FUNCTION public.app_current_org_id() SET app.org_id = '<uuid>'` rồi `migrate()` dưới superuser ⇒ đi qua (tự chữa: `proconfig` về NULL), nhưng lượt sửa phát WARNING mang `config=app.org_id=<uuid>`; ⑵ thân hàm thay bằng một thân mang hằng UUID ⇒ WARNING mang nguyên thân cùng UUID; ⑶ như ⑴ dưới một vai deploy không sở hữu hàm ⇒ `migrate()` NÉM, thông điệp mang `config=app.org_id=<uuid>`. `db/migrations.int.test.ts` (vòng fix 1 — IM5) ghim "prosrc hiện tại" trong WARNING như chẩn đoán người vận hành cần, nên đây là một quyết định giữa chẩn đoán và chuẩn S1.51 ⑷ ("tên thì được, giá trị thì không"), không phải một bản vá cơ khí. Hình dạng còn để ngỏ, hai nhánh loại trừ nhau (lượt soi 60b): ⑴ in dấu vân tay thay cho thân hàm và định nghĩa trigger, `proconfig` chỉ in tên GUC — kèm một cổng T1 cấm nối `prosrc`, giá trị của `proconfig`, định nghĩa đối tượng và `pg_get_expr` vào ô mô tả; ⑵ ghi rõ thân hàm của dự án là mã chứ không phải giá trị, giữ chẩn đoán IM5 — khi ấy cổng miễn `prosrc` của hàm dự án có khai, và `proconfig` vẫn chỉ in tên. Cùng lớp, chưa kiểm (lượt soi 60a mang sang): WARNING "không đánh giá được ĐIỀU KIỆN của mục" in `SQLERRM`, mà thông điệp của một lỗi ép kiểu mang giá trị. | `db/migrations/hardening.always.sql`, `db/migrations.int.test.ts`, `db/thong-diep-khong-gia-tri.int.test.ts` |
| 118 | **[MỞ]** **[S1.66, lượt soi 60a-1, 60a-2 cùng nửa ⑶⑷ của lượt soi ngang 59b-1 — ĐO] LỖI GIAO THỨC KHÔNG MANG TÊN RIÊNG VẪN THÀNH MỘT 401 HAY 403 CÂM — `dispatch` PHÂN LOẠI LỖI CỦA GIAI ĐOẠN XÁC THỰC THEO TÊN LỖI, KHÔNG THEO NGUỒN.** S1.66 tách `TenantError` theo mã và cho `KetNoiNhiemError` đi 500 có log. Nhưng lỗi Postgres (tên `error`, mang SQLSTATE) ném ra ở lần lấy client hay ở câu của `withTenant` thì rơi vào bảng ánh xạ của giai đoạn handler, và nhánh người mua còn gói MỌI lỗi của `resolveSessionByToken` thành lỗi xác thực. Đo trên PostgreSQL 16 qua HTTP thật (bản nháp của lượt soi 60): ⑴ vai đăng nhập của pool có vai mất membership `app_api` giữa hai lần deploy ⇒ lần lấy client ném 42501 ở `SET ROLE` ⇒ `/me` và `/guest/session` đều ra 403 `khong co quyen`, 0 dòng log (đối chứng trước khi thu hồi: 200 và 200) — đường khách trước S1.66 gói mọi lỗi thành 401 (đọc), nay 403; ⑵ EXECUTE trên `app_current_org_id()` bị thu hồi khỏi PUBLIC và `app_api` ⇒ `/me` ra 401 `phien khong hop le`, `/guest/session` ra 403, 0 dòng log. Cùng lớp, đọc, chưa đo: phép kiểm sau giao dịch của `withTenant` (`SESSION_STATE_LEFT`) huỷ kết nối sau một giao dịch ĐÃ commit mà không log; runner outbox chỉ in `kind`/`reason`, không in tên lỗi; dòng log 500 của một lỗi Postgres chỉ mang `error`, không mang SQLSTATE. Hình dạng còn để ngỏ, và là một thay đổi hợp đồng lỗi: đánh dấu lỗi của handler (bọc `route.handler` bên trong callback của `withTenant`) để mọi lỗi khác lỗi xác thực và lỗi handler đi 500 kèm một dòng log mang tên và SQLSTATE — lỗi ràng buộc hoãn lúc COMMIT vẫn phải tính là lỗi handler; nhánh người mua chỉ gói `SessionInvalidError`; runner in tên lỗi; test ghim ca 42501 lúc lấy client. | `apps/api/src/dispatch.ts`, `packages/tenancy/src/with-tenant.ts`, `packages/outbox/src/runner.ts`, `packages/db/src/vai-tro.ts` |
**CÒN MỞ TÍNH TỚI HEAD:** 4 · 15 · 18 · 19 · 30 · 68 · 69 · 71 · 72 · 102 · 103 · 104 · 105 · 108 · 109 · 110 · 111 · 112 · 113 · 114 · 115 · 116 · 117 · 118

Trong ~~mười lăm~~ ~~**mười bốn**~~ ~~**mười ba**~~ ~~**mười hai**~~ ~~**mười ba**~~ ~~**mười bốn**~~ ~~**mười ba**~~ ~~**mười bốn**~~ ~~**mười ba**~~ ~~**mười bốn**~~ ~~**mười ba**~~ ~~**mười bốn**~~ ~~**mười ba**~~ ~~**mười hai**~~ ~~**mười sáu**~~ ~~**mười lăm**~~ ~~**mười sáu**~~ ~~**mười lăm**~~ ~~**mười bốn**~~ ~~**mười bảy**~~ ~~**mười sáu**~~ ~~**mười lăm**~~ ~~**mười sáu**~~ ~~**mười lăm**~~ ~~**mười bốn**~~ **hai mươi tư** khoản ấy, ~~**năm**~~ ~~**bốn**~~ ~~**năm**~~ **bốn** không phải việc của mã nguồn (15 chốt
nhà cung cấp KMS · 18 tạo team GitHub · 19 chú thích migration đã áp, không sửa được tại chỗ ·
~~23 máy Android thật ·~~ nửa sau của 30 neo ngoài cho khoá công khai · ~~[S1.35] 81 một quyết định ở ADR-036 §3⑶~~ [S1.37] 81 đã quyết), và ~~**mười**~~ ~~**chín**~~ ~~**tám**~~ ~~**chín**~~ ~~**mười**~~ ~~**chín**~~ ~~**mười**~~ ~~**chín**~~ ~~**mười**~~ ~~**chín**~~ ~~**mười**~~ ~~**chín**~~ ~~**tám**~~ ~~**mười một**~~ ~~**mười**~~ ~~**mười một**~~ ~~**mười hai**~~ ~~**mười một**~~ ~~**mười**~~ ~~**mười ba**~~ ~~**mười hai**~~ ~~**mười một**~~ ~~**mười hai**~~ ~~**mười một**~~ ~~**mười**~~ **hai mươi** thì có
hình dạng mã nguồn. **[2026-09-08] Khoản 23 rời khỏi danh sách này bằng một máy thật, không bằng một
lần viết lại định nghĩa** — xem mục 38 và ADR-031.


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
    route huỷ yêu cầu đặt lại TOTP. ~~Sổ nợ mở còn: **0** trong 38–50 (23 và nửa sau của 30 vẫn mở từ S0),
    **51–53 mới mở** từ lượt review này.~~ **[S1.21: câu vừa gạch SAI — xem mục 36]** **Số đo trên HEAD:** `pnpm t0` 177 module / 0 vi phạm;
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
    thẳng từ chính file hardening. ~~**Sổ nợ mở còn:** 23 và nửa sau của 30 (từ S0), cộng **56 mới mở**
    (35 hàm trigger chưa ghim thân).~~ **[S1.21: câu vừa gạch SAI — xem mục 36]** **Lượt review an ninh thứ sáu:** 0 CRITICAL, **1 HIGH**, 4 MEDIUM, 4 LOW
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

    ~~**Sổ nợ mở còn:** 23 và nửa sau của 30 (từ S0), cộng **58 mới mở** (bộ dọn quét toàn bảng).~~ **[S1.21: câu vừa gạch SAI — xem mục 36]**

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

    ~~**Sổ nợ mở còn:** 23 và nửa sau của 30 (từ S0).~~ **[S1.21: câu vừa gạch SAI — xem mục 36]** **Không mở nợ mới.**

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

    ~~**Sổ nợ mở còn: 23 và nửa sau của 30 — và cả hai đều KHÔNG phải việc của mã nguồn.**~~ **[S1.21: câu vừa gạch SAI — xem mục 36]** Nợ 23 cần
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

    ~~**Sổ nợ mở còn: 23 và nửa sau của 30 — không đổi, và cả hai vẫn KHÔNG phải việc của mã nguồn.**~~ **[S1.21: câu vừa gạch SAI — xem mục 36]**
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

    ~~**Sổ nợ mở còn: 23, nửa sau của 30, 24 — và MỘT KHOẢN MỚI, 59**~~ **[S1.21: câu vừa gạch SAI — xem mục 36]** (khẳng định *"mã nguồn hiện
    tại không vi phạm quy tắc nào"* không hermetic; xem đoạn trên). Vòng này **CÓ mở nợ mới**, và
    nó mở vì một lượt đo chỉ ra cơ chế chứ không vì một linh cảm. Hai khoản có hình dạng mã nguồn
    còn lại từ trước: nợ **3** + **16** (hardening tự làm mù mình bằng danh sách tên), và một lượt
    rà lại sổ nợ S0.

> Hành động cũ *"Chạy `security-reviewer` cho Task 7, 8, 9"* đã được **gỡ**: các lượt review ấy
> đã xảy ra (xem `evidence/security-reviews.md`). Nó ra đời từ đúng lời khai sai đã gạch bỏ ở
> mục 8 của bảng điều kiện hoàn thành — một ví dụ sống cho việc một câu sai trong tài liệu trạng
> thái tự sinh ra công việc thừa.

35. **[2026-09-07] S1.20 — HAI KHOẢN NỢ 3 VÀ 16 ĐÓNG, và vòng này tìm ra một lỗ mà KHÔNG khoản nợ
    nào nêu.** Khoản nợ 16 viết ở vòng fix cuối của S0 tố cáo một bất đối xứng trong
    `hardening.always.sql` — `bang_so` nhận bảng theo **hai tên viết cứng** trong khi `bang_al`
    nhận bảng lạ theo **tính chất** — và kèm một dự báo: *"bảng báo giá S1 sẽ rơi thẳng vào đó"*.

    **DỰ BÁO ĐÚNG, VÀ NÓ ĐÚNG THEO MỘT CÁCH NẶNG HƠN CHÍNH NÓ MÔ TẢ.** S1 dựng một hàm canh
    chỉ-ghi-thêm **thứ hai** — `bid_chi_ghi_them()` (018) — cắm trên **ba** bảng: `bid_receipts`,
    `rfq_unsealed_bids`, `vendor_bid_versions`. Cả ba nằm ngoài `bang_so` (không có tên trong danh
    sách hai tên) VÀ ngoài `bang_al` (vế bảng-lạ khoá theo OID của `chan_sua_xoa`). Bốn phép đo
    trên PostgreSQL 16, mỗi lần `migrate()` trả `applied=[]` và KHÔNG một lỗi nào:

    | Đột biến | Trước S1.20 |
    |---|---|
    | `ALTER TABLE bid_receipts SET UNLOGGED` | `MIGRATE OK`, `relpersistence` còn `'u'` |
    | `GRANT UPDATE, DELETE ON bid_receipts TO app_api` | `MIGRATE OK`, acl còn `app_api=rwd` |
    | **`TRUNCATE public.bid_receipts`** | **OK** (`TRUNCATE public.audit_events` thì NÉM) |
    | `ALTER TABLE audit_events ADD COLUMN payload_plaintext text` | `MIGRATE OK`, không mục nào chạm |

    **HÀNG THỨ BA LÀ LỖ SỔ NỢ 16 KHÔNG NÊU, và nó nặng nhất vòng.** Khoản nợ đoán UNLOGGED, UNIQUE
    và REVOKE. Thứ nó bỏ sót là cấu trúc: ba trigger của 018/019 là `BEFORE DELETE OR UPDATE FOR
    EACH ROW`, và **một trigger cấp HÀNG không bao giờ chạy cho `TRUNCATE`** — TRUNCATE là thao tác
    cấp CÂU LỆNH. Bảng sổ có một trigger TRUNCATE riêng từ 003 vì đúng lý do ấy; ba bảng của S1 ra
    đời sau và không ai chép vế thứ ba sang. **Một câu lệnh xoá sạch mọi biên nhận nộp thầu (B2),
    mọi phiên bản báo giá (B1) và mọi giá đã mở** — trong khi `evidence/INV-matrix.md` ghi cả hai
    mã ✅ với 10 và 25 khẳng định. Đóng bằng migration `047`.

    **Hàng thứ tư là HAI CÂU HỎI BỊ NHẬP LÀM MỘT.** `MAU_HINH_DANG_SO` đếm `attname IN (15 tên) =
    15`, và chú thích của chính nó viết *"THÊM cột thì an toàn"*. Câu ấy **đúng** cho câu hỏi mà vị
    từ ấy trả lời (*"thân trigger dereference đủ 15 trường chứ?"*). Câu hỏi thứ hai — *"sổ có chứa
    gì mà chuỗi hash KHÔNG phủ không?"* — chưa từng có ai hỏi. Một cột thứ 16 là nội dung sống
    trong sổ kiểm toán mà sửa nó **không làm chuỗi gãy**, và B3 nói về HÀNG nên mệnh đề ấy không
    với tới. Cái tên `payload_plaintext` không phải ví dụ ngẫu nhiên — nó là đúng hình dạng của
    **A2**.

    **THỨ ĐÁNG MANG SANG VÒNG SAU KHÔNG PHẢI BỐN LỖ, MÀ LÀ RANH GIỚI GIỮA TỰ CHỮA VÀ PHÁN XÉT.**
    `[CR4]` của S0 cấm `migrate()` tự tay đổi ngữ nghĩa một bảng nó SUY RA, và quy tắc ấy đã sống
    **bốn vòng trong một khối chú thích, không có ADR nào**. Vòng này suýt vi phạm nó ở bước thứ
    hai: cách sửa hiển nhiên cho lỗ TRUNCATE là dùng `chan_sua_xoa()` — hàm có sẵn thông điệp theo
    `TG_OP` và đã được ghim. Nhưng `bang_al` nhận bảng lạ theo **OID của chính hàm ấy**, nên cắm nó
    lên ba bảng này đưa chúng vào `can_co`, nơi hardening đòi đủ bộ ba trigger mang tên KHÁC — tức
    **`migrate()` báo lỗi trên một lược đồ HỢP LỆ**, đúng ngõ cụt `QT1`. **ADR-028** viết quy tắc ấy
    ra ở dạng khẳng định: *tự chữa chỉ trên thứ một migration đánh số sở hữu theo TÊN; thứ SUY RA
    thì chỉ phán xét.* Và H19 đo CẢ HAI chiều: cùng một đột biến `SET UNLOGGED` cho hai kết quả
    ĐÚNG KHÁC NHAU — bảng có tên thì `migrate()` OK và bảng về LOGGED, bảng suy ra thì `migrate()`
    NÉM.

    **NỬA ĐẦU KHOẢN NỢ 3 KHÔNG ĐÓNG BẰNG MỘT LỚP MỚI — NÓ BỊ PHÉP ĐO BÁC BỎ.** Khoản nợ viết
    *"`NOBYPASSRLS` chỉ ghim đúng BỐN TÊN ROLE"*. Vòng này **đã viết** mục thứ năm suy từ tính
    chất, **đã chạy nó**, rồi đo: `CREATE ROLE ke_gian BYPASSRLS; GRANT app_api TO ke_gian;` →
    `migrate()` OK → **`ke_gian` KHÔNG còn trong cây**. BƯỚC 1 thu hồi mọi tư cách thành viên lạ,
    nên tập *"role trong cây dự án"* LUÔN BẰNG tập bốn tên đã ghim. Cửa có thật và **đã đóng — bởi
    một lớp KHÁC với lớp mà khoản nợ chỉ tên**. Mục mới **đã bị GỠ**: không đột biến nào làm nó đỏ
    được, và một cổng an ninh không bao giờ đỏ được là đúng thứ dự án đã bắt hai mươi lần. Đây là
    lần thứ HAI một khoản nợ đóng bằng cách bác bỏ tiền đề của chính nó (lần đầu: khoản 58, S1.16).

    **VÀ NỬA SAU KHOẢN NỢ 3 ĐÃ THIU BỐN VÒNG:** vế *"một hàm plpgsql ngoài danh sách không được
    ghim"* đóng từ **S1.14/S1.15** (nợ 54 và 56, danh sách loại trừ RỖNG), mà dòng nợ 3 không ai
    sửa. Cùng lớp với mục 7 (*"apps/ rỗng"*) — và là bằng chứng thứ hai cho vòng **rà lại sổ nợ S0**
    đang xếp hàng.

    **MỘT KHIẾM KHUYẾT CỦA CHÍNH VÒNG NÀY, tìm ra bằng cách CHẠY chứ không bằng cách đọc:** bí danh
    `r` trong một câu SQL nhúng bị plpgsql thay bằng biến vòng lặp **trước khi** PostgreSQL phân
    giải bí danh — vị từ trả về TẬP RỖNG và mục canh **luôn XANH**. `[IM2]` đã ghi nguyên văn cảnh
    báo này ở vòng fix 1 của S0 (*"bí danh pg_roles viết là `vai`, KHÔNG phải `r`"*), và vòng này
    vẫn vấp. Khác một điểm quan trọng: ca của `[IM2]` ném 55000 — ồn ào; ca này **im lặng**.

    **VÒNG SỬA SAU REVIEW LƯỢT 12 — HAI HIGH, BỐN MEDIUM, NĂM LOW, và ba trong số đó là khiếm
    khuyết THẬT trong mã vòng này viết ra.** ⑴ Vị từ mới **khoá cứng `nspname = 'public'`** trong
    khi `bang_so`/`bang_al` cố ý phủ mọi schema — tức tái lập đúng thứ `[CR2a]` đã GỠ; một bảng
    chỉ-ghi-thêm ở `app_private` sẽ rơi ngoài cả ba mục mới. ⑵ Mục ACL **chỉ đọc `relacl`**, nên
    `GRANT UPDATE (canonical_text) ON bid_receipts TO app_api` — quyền mức CỘT, vô hình với
    `relacl` — sống qua mọi deploy; `canonical_text` là **chính chuỗi được ký** của biên nhận, tức
    nó chạm thẳng **B2**. ⑶ Vế *"có chốt TRUNCATE"* **không hỏi `tgenabled`**, nên một
    `DISABLE TRIGGER` cho ra mục XANH trong khi `TRUNCATE` đi lọt hoàn toàn — đúng lớp "xanh giả"
    mà cả vòng này tồn tại để đóng, lần này do chính vòng này tạo ra.

    **VÀ MỘT CÂU CỦA ADR-028 BỊ PHÉP ĐO CỦA CHÍNH NÓ BÁC BỎ.** §2⑵ viết *"`migrate()` chỉ TỰ CHỮA
    những đối tượng mà một migration đánh số sở hữu theo TÊN"*, trong khi §7⑷ của cùng ADR đo rằng
    `migrate()` bật RLS + FORCE trên `chi_nhanh` — một bảng không migration nào sở hữu. Câu ấy sai
    **về cả mã cũ**: mục (A) đã tự chữa trên một tập SUY RA từ S0 (*"bảng có cột `org_id`"* là một
    tính chất). Phát biểu đúng nay là: **tự chữa được phép trên tập suy ra khi hành động ĐƠN ĐIỆU
    và fail-closed** (bật RLS, `SET LOGGED`), bị cấm khi nó đổi ngữ nghĩa (cắm trigger, đổi thân
    hàm, xoá cột). Đây là một câu **rộng hơn phép đo theo hướng DỄ CHỊU** — nó khen mã nhiều hơn mã
    đáng được khen — và đó là hướng khó tự bắt nhất.

    **MỘT PHẢN BÁC ĐƯỢC KIỂM VÀ BỊ BÁC LẠI, ghi vì lập luận mới là thứ đáng giữ:** reviewer nêu ca
    bảng chỉ-ghi-thêm PHÂN MẢNH như một khả năng *chặn deploy trên lược đồ HỢP LỆ*. Bốn phép đo bác
    vế *"hợp lệ"*: trigger TRUNCATE **cắm được** trên `relkind='p'`; trigger cấp HÀNG **được** nhân
    bản xuống lá (nên lá vào tập suy ra); trigger TRUNCATE thì **không**; và `TRUNCATE <lá>` **đi
    lọt** dù cha có chốt. Lá là một LỖ THẬT, nên đòi chốt trên từng lá là ĐÚNG. Cái giá — một phân
    mảnh mới tạo ngoài migration sẽ chặn deploy — là có thật và nằm ở ADR-028 §6.

    **MỘT DÒNG THIU THỨ HAI, tìm ra khi đi sửa dòng đầu:** §*Cột mốc hiện tại* của chính file này
    khai **"mười chín ADR"**. Con số ấy đứng yên từ 2026-09-04 trong khi sổ quyết định đi tới
    **28** — chín ADR, chín vòng. Không cổng nào đỏ vì không lớp nào đọc dòng ấy, đúng nguyên văn
    lớp khiếm khuyết mà S1.18 đã bắt ở `docs/TEST-PLAN.md` (*"16/50"* trong khi bảng §5 có 17
    hàng). Hai lần trong ba vòng, cùng một hình dạng: **một con số tóm tắt không có ai đọc nó**.

    ~~**Sổ nợ mở còn: 23, nửa sau của 30, 24, 59 — và MỘT KHOẢN MỚI, 60.**~~ **[S1.21: câu vừa gạch SAI — xem mục 36]**

36. **[2026-09-08] S1.21 — RÀ LẠI SỔ NỢ S0, và thứ tìm ra là chính câu mà tám vòng gần nhất
    dùng để kết thúc.** Vòng này không đóng một khoản nợ nào bằng mã mới. Nó đi hỏi một câu chưa
    ai hỏi — *"sổ nợ đang khai đúng chính nó không?"* — và câu trả lời là KHÔNG, theo một cách
    có thể đo được.

    **PHÉP ĐO MỞ MÀN.** `docs/STATE.md` mang hai cách đếm nợ mở: **bảng** sổ nợ, và **câu tổng
    kết** cuối mỗi mục *Hành động tiếp theo*. Từ mục 27 (S1.12) tới mục 35 (S1.20) câu ấy khai
    NĂM khoản (*"23 và nửa sau của 30"*, rồi *"23, nửa sau của 30, 24, 59, 60"*). Bảng thì cho
    **hai** con số khác, và sự khác ấy chính là lý do P2 tồn tại: đếm theo DẤU VĂN BẢN được
    **mười bốn** dòng không mang dấu đã-đóng (trong đó **50 đã đóng thật** — nó viết *"MỞ VÀ
    ĐÓNG CÙNG VÒNG"*, một cách viết thứ năm — và **59 thì VÔ HÌNH** vì thiếu cột), còn phán
    xét lại từng dòng bằng phép đo hôm nay được **mười ba**. Sai theo hướng **DỄ CHỊU** — nó khai ít
    nợ hơn số nợ thật — và đó là hướng khó tự bắt nhất, đúng như vòng sửa của S1.20 đã ghi.

    **PHÁN XÉT TỪNG DÒNG 1–22, MỖI DÒNG MỘT PHÉP ĐO HÔM NAY.** Kết quả: **bốn dòng đã THIU**
    (1, 5, 6, 7 — đóng từ lâu mà không ai đánh dấu), **tám dòng CÒN MỞ THẬT** (2, 4, 8, 10, 12,
    15, 18, 19), và **một dòng mở BẰNG CẤU TẠO** (19 — văn bản sai nằm trong chú thích của
    migration đã áp, sửa chú thích cũng đổi checksum).

    **HAI DÒNG THIU ĐÁNG ĐỌC, vì chúng đóng bởi một lớp KHÁC lớp mà khoản nợ chỉ tên** — cùng
    hình dạng với nửa đầu khoản nợ 3 ở S1.20:
    ⑴ **Khoản nợ 1** (*"E3 vế giới hạn tần suất không có một dòng mã nào"*) đóng từ **S1.12**,
    bởi lớp trả cho **khoản nợ 39**: `/auth/totp` nay có `callerLimit = 30` mỗi 15 phút đếm ở
    `caller_rate_limits`. Không ai nối lớp ấy về dòng 1, nên **BẢY chỗ** cùng khai một lỗ đã lấp:
    dòng nợ 1 · `docs/TEST-PLAN.md` §*nhãn vế* · `tools/inv-matrix/src/danh-gia.ts` (và qua
    nó là `evidence/INV-matrix.md` §4) · `Handoff.md` §10 mục 2 · `tools/inv-matrix/src/parse.ts`
    · `tools/inv-matrix/src/parse.test.ts` · và một khối chú thích trong **mã sản xuất**
    (`packages/identity/src/mfa-credentials.ts:17`, *"KHÔNG CÓ LỚP NÀO TRONG S0"*). Bảy bản
    sao của một câu, và không bản nào biết sáu bản kia tồn tại — đó là hình dạng đầy đủ của
    thứ ADR-029 đặt tên.
    ⑵ **Khoản nợ 5** (*"`enqueueJob` không có oracle xuyên tổ chức và không test nào canh"*) —
    vế đầu vẫn đúng nguyên văn và cố ý, vế sau thì **sai ngay ngày nó được viết**: test
    `[INV-F1] job của tổ chức A vô hình với tổ chức B, và không ai chèn hộ ai` ra đời trong
    **chính commit tạo ra outbox** (`13a6e5b`, 2026-08-28) và đo đúng điều dòng nợ nói không ai
    đo. Oracle không nằm trong hàm mà ở `RLS WITH CHECK`.

    **VÀ MỘT BẰNG CHỨNG GỌN NHẤT CHO CẢ VÒNG: khoản nợ 7** (*"`apps/` rỗng"*) đã được **gọi tên
    là thiu** ở mục 33 (S1.18), rồi **gọi tên lần nữa** ở mục 35 (S1.20), và vẫn không ai sửa
    dòng ấy. Ghi một dòng thiu vào LỊCH SỬ không phải một lớp.

    **BA KHIẾM KHUYẾT HÌNH DẠNG mà mắt người không thấy được và mọi bộ đọc thì bỏ qua trong im
    lặng:** dòng **59** của bảng có **MỘT** ô nội dung (thiếu hẳn cột con trỏ, nên nó vô hình với
    mọi phép quét theo cột); dòng **52** có **BỐN** (một `|` trần bên trong đoạn mã
    `` `route|to-chuc` `` cắt ô làm đôi); và **mười con trỏ không giải được**, trong đó dòng 55
    trỏ tới `apps/api/src/bucket-bo-nho.ts` — tệp mà THÂN CỦA CHÍNH DÒNG ẤY nói đã bị xoá, tức
    con trỏ chết từ ngày nó được viết.

    **VÀ SỔ NỢ KHÔNG PHẢI CHỖ DUY NHẤT.** Đi kiểm hai mục tóm tắt của `Handoff.md` — tệp đầu tiên
    người tiếp theo đọc — cho ra cùng một hình dạng, nặng hơn:
    ⑴ **§10 *Nợ kỹ thuật*** khai *"22 khoản"* (số thật: **60**, trong đó 13 mở) và liệt kê *"năm
    khoản nặng nhất"*, trong đó **BỐN đã đóng** — nợ 11 (S1.17), nợ 1 (S1.12), nợ 17 (S1.18), nợ
    16 (S1.20). Còn mở đúng một: **nợ 8**. Cộng hai dòng *"còn mở từ vòng CI"* (20 và 21) cũng đã
    đóng từ 2026-09-05.
    ⑵ **§6 *Cái CHƯA có*** — mục mà chính nó mở đầu bằng *"đây là phần dễ hiểu sai nhất"* — có
    **ba gạch đầu dòng đầu tiên đều sai**: *"`apps/` RỖNG"* (sai từ S1.10), *"`apps/unseal-worker`
    CHƯA TỒN TẠI"* (sai từ S1.6), *"ma trận báo 24/47"* (sổ đăng ký nay 54 hàng). Một mục *"cái
    chưa có"* không được đối chiếu sẽ mô tả một dự án đã không còn tồn tại — và nó là thứ người
    tiếp theo đọc TRƯỚC khi đọc mã.
    Cả hai đã sửa tại chỗ, giữ nguyên chữ. `[INV-H20]` **KHÔNG** phủ `Handoff.md`; đó là một
    khoảng trống đã biết, ghi ở ADR-029 §4.

    **LỚP MÁY: `[INV-H20]` — `tests/architecture/so-no-tu-doi-chieu.test.ts`, năm tính chất, mỗi
    tính chất một mũi đột biến.** P1 ba cột · P2 mọi dòng KHAI trạng thái bằng một từ khoá đóng
    (`ĐÓNG`/`MỞ`/`NỬA`) · P3 tập dòng khai MỞ **bằng** dòng tổng kết, ĐỎ theo **cả hai chiều** ·
    P4 mọi con trỏ chưa bị gạch phải giải được trên đĩa · P5 mọi lời khai *"n ADR"* chưa bị gạch
    phải bằng số đầu mục `## ADR-` thật.

    **LƯỢT CHẠY ĐẦU CỦA P5 TÌM RA MỘT LỖ MÀ THIẾT KẾ ĐẦU CỦA CHÍNH NÓ SẼ BỎ QUA.** Bản đầu đòi
    *"đúng MỘT lời khai"*; chạy lên thì có **HAI** — mục *Cột mốc* khai **28**, bảng *Tham chiếu*
    khai **27** — tức hai lời khai của cùng một tệp còn không khớp NHAU, và dòng bảng *Tham
    chiếu* thiu **lần thứ hai** (chính nó mang sẵn câu *"dòng này đã thiu qua bốn vòng"*). Phép
    kiểm đổi thành *"MỌI lời khai"*: một phép kiểm chỉ đọc lời khai đầu tiên sẽ XANH trên đúng
    tệp đang sai.

    **MỘT TIÊU ĐỀ MANG CÂU ĐÃ BỊ CHÍNH THÂN NÓ BÁC BỎ.** Tiêu đề ADR-028 vẫn đọc *"tự chữa chỉ
    thứ có TÊN"* — đúng câu mà §2⑵ của cùng ADR ấy đã GẠCH ở vòng sửa sau review lượt 12, cùng
    tệp, cách hai mươi hai dòng, cùng ngày. Đã sửa thành *"tự chữa chỉ thứ ĐƠN ĐIỆU"*, giữ nguyên
    văn cũ ngay dưới.

    **REVIEW AN NINH LƯỢT 13 — 3 HIGH, 7 MEDIUM, 6 LOW, và cả ba HIGH đều đúng.**

    ⑴ **HIGH-1: khoản nợ 1 suýt được tuyên ĐÓNG dựa trên một lớp KHÔNG CÓ GÌ GIỮ.**
    `callerLimit: LOGIN_TOTP_MAX_PER_CALLER` ở `apps/api/src/routes/auth.ts:166` là toàn bộ vế
    E3(2) trên đường TOTP — cưỡng chế thật ở dispatcher, nhưng **xoá đúng dòng ấy thì không một
    test nào đỏ**: hai test hạn mức đã có chỉ đo `/auth/link` và `/auth/redeem`, và đối chứng của
    chúng gỡ cờ khỏi MỌI route ANON rồi vẫn chỉ đo `/auth/redeem`. Đây là *xanh giả ở chiều
    ngược*: hàng rào có thật, không có gì giữ nó. Đóng bằng HAI lớp mới — một test tích hợp đo
    `429 + Retry-After` trên `/auth/totp` (32 lời gọi HTTP thật), và một phép kiểm TĨNH *mọi route
    `ANON` phải khai `callerLimit`* trong `timViPhamBangRoute`, mũi đột biến gỡ cờ của **từng**
    route ANON một. Nay là **ADR-029 §2⑹**: *"ĐÓNG" nghĩa là CÓ LỚP GIỮ, không phải CÓ CÀI ĐẶT.*
    Phép kiểm tĩnh ấy tìm ra ngay một ca chưa ai xét: `/guest/otp` là route ANON **không** khai
    `callerLimit` — hợp lệ, vì trần của nó nằm trong `issueOtpChallenge` và CHẶT HƠN (4 bucket),
    nên nó thành dòng DUY NHẤT của `MIEN_TRAN_NGUOI_GOI`, có lý do chỉ tới tận tên hằng số.

    ⑵ **HIGH-3: bộ đọc của chính lớp mới bỏ sót dòng TRONG IM LẶNG** — đúng khiếm khuyết mà P1
    tuyên bố ra đời để bắt. `docCacDong` nhận dòng bằng `^\|\s*\d+\s*\|`, nên một dòng nợ thụt
    vào **một dấu cách** (GFM cho phép tới ba, bảng vẫn dựng) rơi khỏi P1, P2 VÀ P4 mà không một
    thông điệp nào, rồi P3 cũng xanh vì số của nó không có ở dòng tổng kết. Đóng bằng **P0** — mọi
    hàng bảng trong khối phải được bộ đọc NHẬN — và mũi đột biến của nó khẳng định luôn cả điều
    làm nó đắt: bốn phép kiểm kia KHÔNG thấy gì cả.

    ⑶ **HIGH-2: `evidence/INV-matrix.md` chưa sinh lại** — nên artefact đưa cho kiểm toán viên vẫn
    khai một biện pháp kiểm soát KHÔNG tồn tại (*"đường TOTP VẪN KHÔNG CÓ giới hạn tần suất nào"*)
    trong khi vòng này vừa đo rằng nó có. Sinh lại trong cùng commit.

    **BỐN MEDIUM là bốn BẢN SAO NỮA mà vòng rà đã bỏ sót** — và việc chúng tồn tại là bằng chứng
    mạnh nhất cho ADR-029: `docs/STATE.md:122` (*"`apps/` rỗng"*, bản sao thứ BA, nằm trong đúng
    tệp mà lớp mới đọc), `Handoff.md` §13 (*"22 khoản nợ"*, sửa một chỗ bỏ một chỗ trong cùng
    vòng), `packages/outbox/src/runner.ts` (*"`apps/` còn rỗng"*, trong mã sản xuất), và
    `packages/identity/src/session-actor.ts:97` (*"trigger … là S1.10.4"* — câu THỨ HAI trong đúng
    khối chú thích vòng này vừa sửa câu thứ nhất). Cộng `docs/STATE.md` bảng *Tham chiếu* khai
    *"Sổ đăng ký 51 bất biến (34 + 17)"* trong khi sổ có **54 (34 + 20)** — cách lời khai số ADR
    đúng MỘT hàng bảng, và P5 không đọc nó. Đóng bằng **P6**.

    **BA CỬA CỦA CHÍNH LỚP MỚI BỊ LẠM DỤNG ĐƯỢC, đã bịt:** gạch một con trỏ chết là cách "sửa" rẻ
    nhất và cổng vẫn xanh (nay: ô đã gạch một con trỏ thì phải còn ít nhất một con trỏ SỐNG — và
    phép kiểm ấy ĐỎ ngay lượt đầu ở dòng 11); một dấu `~~` LẺ dời mọi cặp phía sau và một lời khai
    đang sống rơi vào khoảng bị xoá (nay: số dấu `~~` phải CHẴN); và `join(GOC, "../../…")` xác
    thực bằng hệ thống tệp NGOÀI kho (nay: mọi đường phải nằm trong worktree). Cộng ba LOW đã sửa:
    số khoản phải DUY NHẤT, `new RegExp` dựng từ tài liệu phải hỏng thành một vi phạm có tên, và
    tám câu tổng kết sai nay được **GẠCH cả câu** thay vì bị chèn một dấu vào giữa — quy ước của
    kho là giữ nguyên chữ, và bản trước đã làm sai chính quy ước ấy.

    **LƯỢT CI ĐẦU TIÊN ĐỎ, VÀ NÓ ĐỎ VÌ ĐÚNG THỨ VÒNG NÀY NÓI VỀ.** `pnpm t0` xanh, bộ test đơn vị
    xanh, `pnpm evidence:check` **54/54 · 1428 khẳng định · byte khớp** — tất cả trên máy phát
    triển. Trên CI thì **T1+T2 đỏ ở CẢ HAI runner** với đúng hai dòng:

    ```text
    khoản 5: con trỏ không giải được — .superpowers/sdd/2026-08-27-s0-foundation/task-10-report.md
    khoản 8: con trỏ không giải được — .superpowers/sdd/2026-08-27-s0-foundation/task-8-report.md
    ```

    Hai con trỏ ấy do **chính vòng này** vừa "sửa" — từ tên tệp trần thành đường đầy đủ — và chúng
    trỏ tới hai tệp **có thật trên đĩa của tôi mà KHÔNG có trong kho**: cả cây báo cáo SDD bị một
    `.gitignore` phủ toàn bộ (`git ls-files .superpowers` cho **0** tệp). Tức P4 khi ấy đang đo
    **cái đĩa của người chạy nó**, không đo cái kho — một lớp canh phụ thuộc máy, và nó xanh trên
    đúng máy đã viết nó.

    Review lượt 13 đã nêu đúng lớp lỗi này ở dạng nhẹ hơn (H13-11, thoát thư mục: *"xanh trên máy
    dev, đỏ trên CI, hoặc ngược lại"*) và tôi sửa bằng một phép kiểm CHỨA. Sửa ấy đúng nhưng
    **hẹp hơn khiếm khuyết**: đường vẫn nằm trong worktree, nó chỉ không nằm trong KHO. Bản đúng
    là đổi NGUỒN: `git ls-files`. Nó bịt luôn hai thứ khác — không còn `readdirSync` nào chạy trên
    một tên lấy từ tài liệu, và lối thoát thư mục thôi tồn tại vì mọi đường trong tập đều là đường
    tương đối trong kho.

    Bài học tái dùng được, và nó rẻ: **một phép kiểm đọc ĐĨA đo cái đĩa của người chạy nó.** Nếu
    khẳng định là về CÁI KHO thì nguồn phải là cái kho.

    **Sổ nợ mở còn: 14 khoản, và lần này con số ấy được một lớp đọc** — 2, 4, 8, 10, 12, 15, 18,
    19, 23, 24, 30 (nửa sau), 59, 60, **61 mới mở**. Trong đó **năm** không phải việc của mã
    nguồn (15, 18, 19, 23, nửa sau của 30) và **chín** có hình dạng mã nguồn. **Khoản nợ 61 mở
    ở chính vòng này và mở một cách CỐ Ý:** `Handoff.md` được sửa BẰNG TAY, không lớp nào phủ
    nó, nên nó sẽ trôi lại — ghi ra là cách duy nhất để lần trôi sau có địa chỉ. Việc kế tiếp
    có hình dạng rõ nhất vẫn là **khoản nợ 8** — QT3 không có lớp máy, nay là khoản nợ S0 nặng
    nhất còn lại.

37. **[2026-09-08] S1.22 — KHOẢN NỢ 8 ĐÓNG: QT3 có lớp máy, và chủ thể của lớp ấy suy từ chính
    NỘI DUNG câu SQL (ADR-030, `[INV-H21]`).** Khoản nợ 8 là khoản S0 nặng nhất còn lại sau
    S1.21, và nó nặng vì cả bốn trục của QT3 — tên hàm, toán tử, ép kiểu, tên bảng — đều đã được
    **tái lập end-to-end** trên chính kho này từ S0.

    **PHÉP ĐO QUYẾT ĐỊNH HÌNH DẠNG VÒNG.** Trên toàn bộ mã sản xuất có SQL: **62** câu ghim ít
    nhất một trục, **80** câu chưa ghim gì, và **13** câu ghim NỬA VỜI. Chủ thể của lớp canh là
    nhóm thứ ba, và lý do không phải số học: một câu ghim KHÔNG GÌ **trông đúng như nó là**, còn
    một câu ghim NỬA VỜI **đọc như đã được bảo vệ** — nó mang `OPERATOR(pg_catalog.=)` ở ba chỗ và
    một `=` trần ở chỗ thứ tư. Cùng hình dạng với *"xanh giả"*: thứ tệ hơn một lỗ hổng là một lỗ
    hổng trông như đã được vá.

    **BA CHỖ ĐÁNG KỂ NHẤT TRONG 13:** `packages/unseal/src/gate.ts` — **cổng chính sách mở thầu**
    — đếm phê duyệt bằng NĂM `=` trần và ba tên bảng trần trong khi vẫn ghim
    `public.unseal_so_phe_duyet_can`; `packages/invitation/src/invitation.ts` để
    `(expires_at <= now())` và `locked_until > now()` trần trong một câu mà toàn bộ `WHERE` đã
    ghim — hai biểu thức quyết định một OTP đã hết hạn hay đang bị khoá; và
    `packages/identity/src/session-actor.ts` ghim bốn toán tử rồi để một `now()` trần ở đúng vế
    hạn phiên.

    **VẾ THỨ HAI ĐÓNG ĐIỀU KIỆN TIÊN QUYẾT, VÀ NÓ RẺ.** Cả ba ca cướp đều cần `search_path` NÊU
    TÊN `pg_catalog` ở vị trí sau. Ba đường đưa tiền đề ấy vào: `rolconfig` (hardening canh),
    `options` của chuỗi kết nối (`createPool` canh), và **một câu do chính mã ứng dụng phát** —
    đường thứ ba không có lớp nào. Nay có, và nó kiểm theo *"câu này có nhắc `search_path` không"*
    chứ không theo cú pháp: `SET LOCAL` và `set_config` là khuôn ĐANG DÙNG của kho cho những GUC
    khác, nên một phép kiểm chỉ khớp `SET search_path` sẽ mời người viết dòng sau đi vòng qua nó
    mà không biết.

    **MỌI DANH SÁCH MIỄN TRỪ ĐƯỢC POSTGRESQL PHÁN XÉT.** `pg_proc` cho danh sách *"cấu trúc ngữ
    pháp"* (một tên có hàm thật thì nó GHIM ĐƯỢC, tức phải bị ghim), `pg_get_keywords()` cho hai
    danh sách từ khoá, `pg_type` cho tên kiểu đã ghim. Phép đo ấy bác **năm** dòng bản đầu tôi
    viết theo trí nhớ (`extract`, `substring`, `overlay`, `position`, `normalize`) và **bốn** dòng
    nữa sau review (`unnest`, `generate_series`, `left`, `right`) — trong đó `unnest` là ca đắt
    nhất: **mã sản xuất đã GHIM nó từ trước** (`packages/db/src/vai-tro.ts`), tức lớp canh và mã
    nguồn nói ngược nhau, cách nhau vài trăm dòng.

    **REVIEW AN NINH LƯỢT 14 — 6 HIGH, 8 MEDIUM, 5 LOW, và BỐN HIGH nói về chính LỚP CANH chứ
    không về mã.** ⑴ `khoangSet` miễn cả một KHOẢNG nên mọi toán tử ở vế phải phép gán đi lọt —
    và hình dạng ấy chính là bộ đếm khoá E3 (`SET failed_attempts = c.failed_attempts + 1,
    locked_until = CASE WHEN … >= $2 …`), nên nó sẽ đi qua trong im lặng ngay khi tên bảng được
    ghim. ⑵ SQL nối bằng `+` chỉ đọc mảnh ĐẦU, nên `FROM public.audit_append(…)` — đường ghi DUY
    NHẤT của sổ kiểm toán — nằm ngoài tầm nhìn. ⑶ `SET LOCAL` và `set_config` đi lọt vế hai.
    ⑷ Danh sách từ khoá không được đo bằng gì cả. Cả bốn đã sửa, mỗi cái kèm một mũi đột biến.

    **VÀ MỘT HIGH KHÔNG THUỘC QT3, nặng nhất lượt: `issueLoginToken` gửi magic link tới ĐỊA CHỈ
    NGƯỜI GỌI GỬI LÊN.** `UNIQUE (org_id, email)` so NGUYÊN VĂN, hàm tra bằng `lower(email)` không
    `LIMIT` rồi lấy `rows[0]`, và trả lại chuỗi người gọi. Với một cặp biến thể hoa-thường trong
    cùng tổ chức, xin link cho `alice@corp.com` có thể phát token của `Alice@corp.com` **và gửi
    tới hộp thư của người xin**. Đã đóng vế chiếm tài khoản: hàm nay trả `u.email` đọc từ CSDL.
    Phần chênh còn lại cần `UNIQUE (org_id, lower(email))` — khoản nợ **63**.

    **MỘT LẦN ĐỎ CỦA CHÍNH VÒNG SỬA, và nó dạy một quy tắc.** Bản ghim đầu viết
    `$2::pg_catalog.int`; `int` là ĐƯỜNG CÚ PHÁP, không phải tên kiểu trong catalog (`int4` mới
    là). Câu ném 42704, `/guest/otp/verify` trả **500 thay vì 401**, và chỉ T3 bắt được. Hình dạng
    của lỗi đáng nhớ hơn bản thân lỗi: **một lớp canh đòi `::pg_catalog.<t>` cho mọi `::<t>` sẽ
    DẠY người ta viết `::pg_catalog.int`** — nên vế *"tên kiểu ghim phải TỒN TẠI"* thuộc về chính
    lớp ấy. Nay có, với `int` làm răng.

    **CI ĐỎ HAI LƯỢT LIÊN TIẾP Ở HAI CHỖ KHÁC NHAU, VÀ CHÍNH SỰ KHÁC NHAU ẤY LÀ MANH MỐI.** Lượt
    một: `postgres.int.test.ts` timeout 30 s. Lượt hai: `composition.int.test.ts` ném
    `SyntaxError: Unexpected end of JSON input`. Hai chỗ khác nhau là chữ ký của TẢI, không phải
    của một lỗi logic — nhưng "flake" là một kết luận, không phải một phép đo, nên phải đọc log.

    Nguyên nhân thật: `apps/api/src/adapters/hop-thu-dev.ts` ghi bằng
    `writeFile(tệp, json, { flag: "wx" })`. Cờ `wx` **TẠO tệp trước rồi mới ghi nội dung**, nên có
    một cửa sổ mà tệp TỒN TẠI và RỖNG. Người đọc của test poll cả thư mục mỗi 50 ms và
    `JSON.parse` MỌI tệp — nó rơi đúng vào cửa sổ ấy. Lỗi thứ hai trong cùng tệp
    (`needsEnrollment` mong `false`, nhận `true`) là **hệ quả dây chuyền**: test trước thất bại nên
    hồ sơ TOTP chưa được ghi danh.

    **Hai sự thật, và cả hai đều phải nói:** đua tranh ấy **không do vòng này tạo ra** — nó nằm sẵn
    trong cách ghi tệp từ S1.11; nhưng vòng này **làm nó phát**, vì thêm một tệp int khởi động
    container (39 thay vì 38) và T3 trên runner CI đi từ **409 s** lên **511 s**. Máy phát triển
    chạy cả bộ T3 xanh (757/757) ở cùng lúc ấy.

    Sửa: ghi vào tên `.tmp` rồi `rename` sang `.json` — đổi tên trong cùng thư mục là NGUYÊN TỬ,
    nên người đọc hoặc không thấy tệp, hoặc thấy nó ĐẦY ĐỦ; người đọc lọc `.json`. Sau bản sửa,
    CI **6/6 xanh** (T3 552 s).

    Đáng ghi: chính khối chú thích của hàm ghi ấy đã mang dấu vết một lần đỏ ngẫu nhiên TRƯỚC —
    thứ tự tin khi hai tin rơi cùng mili-giây, lượt CI đầu của S1.12. **Cùng một hàm, lần thứ hai,
    một trục khác.** Một hàm đã đỏ ngẫu nhiên một lần đáng được đọc lại toàn bộ, không chỉ vá đúng
    trục vừa đỏ.

    **Số đo:** 20 câu SQL được ghim trong vòng; `pnpm t0` 203 module / 845 phụ thuộc / 0 vi phạm;
    **687** test đơn vị và **757** test tích hợp xanh; sổ đăng ký 54 → **55** bất biến.

    **Sổ nợ mở còn: 15 khoản** — 2, 4, 10, 12, 15, 18, 19, 23, 24, 30 (nửa sau), 59, 60, 61, và
    **62, 63 mới mở**. Trong đó năm khoản không phải việc của mã nguồn. **Khoản nợ 62 là phần lớn
    hơn theo số đếm** (80 câu chưa ghim gì, 39 trong số đó chạm bảng nhạy cảm) và nó là vòng kế
    tiếp có hình dạng rõ nhất.

38. **[2026-09-08] S1.23 — KHOẢN NỢ 23 ĐÓNG BẰNG MỘT MÁY THẬT, và vòng này gần như không có mã.**
    Khoản nợ 23 là một trong **năm** khoản mà sổ nợ tự khai *"không phải việc của mã nguồn"*. Nó
    đóng khi ông có một máy Android và chạy máy dò `tools/do-webcrypto/index.html` trong **Zalo**,
    **Messenger** và **Chrome** trên cùng máy ấy — **Galaxy A02s, Android 12**, máy phổ thông giá
    rẻ, đúng phân khúc mà ô ưu tiên 1 của nhật ký đo mô tả. **Cả ba ĐẠT toàn bộ, kể cả `X25519`.**

    **Thứ đắt nhất vòng không phải kết quả xanh, mà là bốn thứ phép đo LÀM LỘ RA.**

    ⑴ **Phép đo lấp ô ưu tiên 1 KHÔNG đo được điều ô ấy nghi.** Ô ấy nghi *"máy tầm trung cũ
    thường tụt lại nhiều phiên bản WebView"*. Máy đo đúng là máy rẻ đời cũ — nhưng `UA:` cho thấy
    System WebView của nó là **Chromium 151**, tức **mới**. Nên phép đo bác được *"webview Zalo
    Android thiếu `crypto.subtle`/`X25519`"* **ở WebView 151**, và **không** có mẫu nào ở chế độ
    tụt lại. Cùng hình dạng bài học của khoản nợ 58 (S1.16): **một phép đo ở MỘT chế độ không
    phải một kết luận cho MỌI chế độ.** Nó cũng bác một suy diễn dễ mắc theo hướng ngược lại:
    *"máy rẻ đời cũ thì Android tự khắc là đường yếu"* — sai, vì thứ quyết định là **bản WebView**
    (đi theo Play Store), không phải tuổi máy.

    ⑵ **Ô ưu tiên 3 bị bác bởi chính giả định đã sinh ra nó.** Ô ấy tồn tại vì nghi *"Messenger có
    thể nhúng webview riêng"*. Dòng 5 và 6 báo **cùng một chuỗi build** `Chrome/151.0.7922.200`
    trên cùng máy ⇒ hai ứng dụng mượn **cùng một** System WebView. Đây là lần **thứ hai** bảng đo
    thu hai ô về một phép đo (lần đầu: Zalo và Messenger trên iOS cùng `WKWebView`), và nó xác
    nhận bằng phép đo cái trục mà §2 của nhật ký đã chọn: **engine, không phải tên ứng dụng.**

    ⑶ **Một khối kết quả đã suýt bị ghi vào sai dòng, và thứ chặn lại là `UA:`.** Kết quả đầu
    tiên đến kèm **ảnh chụp một máy Android**, trong khi khối văn bản dán về mang `UA:` của một
    **iPhone** (`CriOS`, `iPhone OS 26_6_1`) — clipboard đồng bộ giữa hai máy là đủ để hai thứ
    lệch nhau mà không ai cố ý. Nó vẫn là một phép đo thật và đã thành **dòng 4**, chỉ là của
    engine khác. Quy tắc rút ra, đã ghi vào §5 của nhật ký: **một dòng chỉ được điền từ khối văn
    bản, engine đọc từ `UA:`, kể cả khi người gửi đã nói rõ mình cầm máy nào.** Ảnh chụp thẻ phán
    quyết **không định danh engine**.

    ⑷ **Token `wv` không dùng để nhận dạng WebView được.** UA của Messenger có `wv`; UA của Zalo
    **không**, dù cùng là WebView và **cùng build**. Ứng dụng sửa được chuỗi UA của webview mình
    nhúng. Thứ đáng tin là **chuỗi build Chromium** cộng **token định danh ứng dụng**.

    **Trước khi đo, máy dò được vá — và bản vá ấy nói về chính nó.** Ngoài ngữ cảnh bảo mật
    `crypto.subtle` **không tồn tại** dù engine hỗ trợ đầy đủ, và bản cũ phán *"KHÔNG nộp thầu
    được trên trình duyệt này"*: một câu về **cái link**, mang hình dạng một câu về **cái máy** —
    nếu chép vào nhật ký thì thành một lời khai sai đặt đúng chỗ đang cần sự thật, không ai kiểm
    lại được vì thiết bị đã đi. Nay có **phán quyết thứ năm** *"PHÉP ĐO HỎNG — link này không
    phải https"*, và mũi đột biến thứ tư `?dot=ngucanh` chứng minh nó phân biệt được. **Đây là
    cùng một hình dạng với bốn HIGH của review lượt 14:** một lớp đo không được lẫn **lỗi của
    chính nó** với **kết luận về đối tượng**.

    **Vì sao ĐÓNG được, nói cho rõ vì nó dễ đọc nhầm:** không phải *"đã đo hết"*. Hai chế độ cố ý
    không đo — **WebView tụt lại** và **iOS ≤ 16** — được gọi tên ở **ADR-031 §3⑵**. Đóng được là
    vì phần chưa đo **không còn quyết định gì**: ADR-011 đã gỡ thế hoặc/hoặc từ 2026-09-04, nên
    thiếu `X25519` là **tụt xuống P-256 chứ không gãy**; thiếu cả hai thì gãy ở `crypto.subtle`,
    đã nằm trong đường thoát của ADR-007. Phần việc thật sự còn lại **đổi hình từ khoản nợ thành
    một yêu cầu giao diện của S1.4/S1.5**: đường nộp báo giá phải chạy chính phép dò này trước khi
    cho nộp và chuyển hướng sang trình duyệt ngoài khi phán quyết không phải *"Nộp thầu được"*.

    **Số đo:** 6 dòng trong nhật ký đo (3 mới) · 5 phán quyết · 4 mũi đột biến · máy dò được phục
    vụ tại `https://huubang1984.github.io/do-webcrypto/` (repo phụ, chỉ chứa một tệp, xoá được
    sau khi đo). Vòng này **không chạy review an ninh** và không được đọc như đã chạy: diff không
    chạm một dòng mã sản xuất nào — chỉ một trang dò dùng thủ công, ba tệp tài liệu và một ADR.


39. **[2026-09-08] S1.24 — KHOẢN NỢ 62 ĐÓNG, VÀ CON SỐ CỦA CHÍNH NÓ SAI THEO BA HƯỚNG.**
    Sổ nợ khai **80** câu SQL chưa ghim trục nào, **39** chạm bảng nhạy cảm. Đo lại trước khi làm:
    **9** trong 80 **không phải SQL** — thông báo lỗi tiếng Việt mở đầu bằng `INSERT`, và bộ đọc
    chỉ đòi chuỗi *bắt đầu* bằng một từ khoá SQL; **8** câu **không có gì để ghim** (`SET ROLE $1`,
    `SELECT current_user`, `SET lock_timeout = 0`). Việc thật: **63** câu trên **12** tệp. Con số
    39 cũng đếm trên tập 80 ấy nên cũng rộng hơn thực tế.

    **Chỗ đắt không phải sai số mà là nguồn của nó:** cả ba con số do CHÍNH lớp canh sinh ra ở
    S1.22, rồi được chép vào sổ nợ và không ai đo lại — đúng hình dạng ADR-029, lần này ở chỗ một
    lời khai **định nghĩa quy mô của một vòng chưa làm**. Một khoản nợ cũng là một lời khai.

    ⑴ **Chín thông báo được sửa Ở CHỖ GỌI, không nới bộ đọc.** Một hàng rào an ninh thà kêu nhầm
    còn hơn bỏ sót; giá của lần kêu nhầm này là chín câu văn (`"Câu INSERT … không trả về hàng
    nào"`), và khuôn ấy đã có sẵn trong `login.ts`. Hệ quả phải nói ra: từ nay một thông báo lỗi
    không được mở đầu bằng một động từ SQL.

    ⑵ **63 câu ghim bằng một BỘ GHIM TỰ ĐỘNG. Lượt ĐỌC LẠI bắt được bốn lỗi — và bỏ sót HAI
    MƯƠI.** Đọc mệnh đề này trọn vẹn trước khi đọc danh sách bên dưới: đọc lại một bản đề xuất tự
    động là **cần**, và nó **không đủ**. Review an ninh lượt 15 đọc cả 12 tệp và tìm ra 20 câu SQL
    hỏng, **18 câu chắc chắn ném lúc chạy**: **10** chỗ dấu `=` của phép GÁN trong `SET` bị ghim
    (ngữ pháp `set_clause` chỉ nhận `=` trần ⇒ 42601), **6** chỗ văn bản câu lệnh bị nhân đôi,
    **2** chỗ `extract` dạng ngữ pháp, **2** chỗ đổi cây phân tích. Cả 10 chỗ `SET` có **một**
    nguyên nhân gốc: bộ ghim nuốt dấu `(` của một lời gọi hàm mà **không tăng độ sâu ngoặc**, nên
    dấu `)` kế tiếp đưa độ sâu về **−1** và mọi phép kiểm `độ sâu === 0` tắt vĩnh viễn — kể cả
    phép kiểm *"dấu `=` đầu tiên của mỗi mục `SET` là ngữ pháp"*. **Một biến đếm lệch một đơn vị,
    mười đường ra quyết định an ninh đóng cứng:** thu hồi lời mời (C3) chết hẳn, phê duyệt kép mở
    thầu không gom nổi hai chữ ký vì người thứ NHẤT luôn rollback, toàn bộ hạn mức OTP ném, bộ dọn
    `caller_rate_limits` ném 42883. Cả 20 đều **đóng cứng**, không fail-open — may, không phải
    thiết kế. Bốn lỗi lượt đọc lại **có** bắt được: `pg_stat_activity` suýt bị ghim thành
    `public.pg_stat_activity` (nó là khung nhìn của **catalog**); `bid_so_tien` suýt thành
    `pg_catalog.bid_so_tien` (nó là hàm của **dự án**) — **cùng hình dạng với `::pg_catalog.int`
    mà S1.22 đã trả giá: lớp canh dạy người ta viết một cái tên không tồn tại**; `u.payload->>'x'`
    mất khoảng trắng thành `u.payloadOPERATOR(…)`, một định danh khác hẳn; và `make_interval(secs
    => $4)` bị tách `=>` thành `=` rồi `>` ở ba chỗ. Nay địa chỉ của một cái tên được **suy từ
    `db/migrations/*.sql`**, không gõ tay, và `=>` có một mũi đo riêng trong H21.

    ⑶ **LỚP CANH NAY HAI CHIỀU, và đó là thứ đáng giá nhất vòng.** `qt3-ghim-schema` bắt
    **thiếu ghim**; không lớp nào bắt **ghim sai**, nên 18 lỗi cú pháp đi qua `tsc`, `eslint`,
    `depcruise` và cả chính H21. `tests/architecture/qt3-cu-phap.int.test.ts` đưa **từng câu DML**
    cho PostgreSQL `PREPARE` trên một CSDL đã migrate — phân giải tên bảng, tên hàm, toán tử và
    kiểu, tức đúng bốn trục QT3, mà không thực thi gì. Nó mang hai mũi răng viết nguyên dạng hai
    trong 20 lỗi của chính vòng này. Hạ tầng cho nó (`moiCauSql()` + `withMigratedDatabase`) đã
    nằm sẵn trong kho từ trước — thứ thiếu chỉ là **ý định đưa câu SQL cho thứ duy nhất đọc được
    nó**. Viết thành một câu: *một lớp canh đòi một cách viết mà không chạy thử cách viết ấy thì
    không phải hàng rào, nó là một cái khuôn.*

    ⑷ **Mốc `TRAN_TOI_DA` bị GỠ, không phải hạ về 0.** Một mốc chỉ-đi-xuống là hàng rào của một
    cuộc di trú ĐANG chạy; giữ nó sau khi số về 0 chỉ còn tác dụng cho phép quay lui. Luật mới
    không có tham số: **mọi câu, đủ bốn trục**. Sàn `SO_CAU_TOI_THIEU` 148 → **139** — nó đi xuống
    **hợp lệ** vì tập chủ thể đúng lên, không vì bộ đọc mù đi; một cái sàn tụt vì bộ đọc mù đi là
    một cái sàn hỏng, và phân biệt hai thứ ấy là việc của người viết chứ không của con số.

    **Hai thứ tìm được ngoài phạm vi, và cả hai nói về chính lưới an toàn:**

    ⓐ **`ci.yml` kích hoạt trên `push: branches: [main]` — kho không có nhánh `main`.** Trigger ấy
    chưa bao giờ khớp: toàn bộ CI đến từ `pull_request`, và **không lượt nào từng chạy trên một
    commit merge**. Phát hiện bằng một con số 0 ở chỗ lẽ ra có sáu job. Đã sửa cùng vòng — khoản
    nợ **64**.

    ⓑ **Một job `schedule` fail-closed đã ĐỎ từ 2026-09-07 và không tới tay ai**, mang đúng con số
    khoản nợ 24 đang chờ: **`TỶ LỆ ĐỎ: 2 / 10`** trên phần cứng CI. Hai lượt đỏ khác nhau: một là
    `[M10]` thật, một là **đua tranh hộp thư dev mà S1.22 đã sửa** — lượt đo chạy trên master
    trước bản sửa. Fail-closed mà không có người đọc thì chỉ là **fail-lặng**: khoản nợ **65**.

    **Số đo:** 139 câu / 27 tệp · **0** câu còn vi phạm (trước vòng: 63) · 63 câu viết lại, 758
    test tích hợp chạy qua chúng trên PostgreSQL thật.


40. **[2026-09-08] S1.25 — BA KHOẢN NỢ 24, 59, 65 HOÁ RA LÀ MỘT CHỦ ĐỀ: ĐỘ TIN CẬY CỦA CHÍNH
    CÁI LƯỚI.** Chúng vào sổ như ba việc rời — một tỷ lệ chưa đo, một cổng đỏ giả, một kết quả
    không tới ai. Làm chung mới thấy chúng là ba mặt của cùng một hỏng hóc: người đọc mất khả
    năng phân biệt *"cổng này đang nói một điều"* với *"cổng này lại thế thôi"*. Và thứ tự đóng
    KHÔNG tuỳ ý — **65 phải đóng trước 24**, vì lời đóng của 24 dựa vào một phép đo còn chạy tiếp
    sau khi vòng này kết thúc, mà một phép đo không ai đọc thì không phải một phép đo.

    ⑴ **ĐÓNG MỘT ĐỎ GIẢ BẰNG KHOÁ, ĐỪNG ĐÓNG BẰNG LOẠI TRỪ.** Đường dễ là cho `depcruise` bỏ qua
    mọi tệp `zprobe-*`. Nó đóng được đua tranh, nhưng đổi lại **cổng sản xuất thôi nhìn một lớp
    tệp** mà chỉ một quy ước đặt tên giữ cho trống — mua sự yên tĩnh bằng một cái lỗ. Khoá không
    đổi thứ gì được đo. Và khoá phải bao **trọn vòng đời của probe**, không chỉ bao lượt quét:
    probe nằm trên đĩa thật, nên chỉ cần nó TỒN TẠI trong lúc lượt quét toàn kho chạy là đủ.
    Mũi đo dùng **hai tiến trình thật**, và vế *"không khoá"* chạy TRƯỚC — không chồng lấn ở vế
    ấy nghĩa là máy không dựng nổi đua tranh, tức vế kia rỗng ruột. Xem ADR-033 §2⑴.

    ⑵ **MỘT ĐƯỜNG BÁO ĐỘNG KHÔNG ĐƯỢC KIỂM LÀ MỘT ĐƯỜNG BÁO ĐỘNG KHÔNG TỒN TẠI.** `do-lap.yml`
    nay mở (hoặc bình luận vào) một issue khi tỷ lệ khác 0, và có input `dot_bien` để bắt đường
    ấy chạy lúc kho đang xanh. Mũi ấy **đã chạy thật**: issue #22, mang tỷ lệ + tên tệp + link +
    commit, tự khai mình là mũi đo, rồi được đóng. Không có nó thì lần đầu tiên đường báo động
    cần chạy cũng là lần đầu tiên nó hỏng — và lần ấy sẽ là lần người ta cần nó nhất.

    ⑶ **"TEST FLAKY" LÀ MỘT CÁI TÊN, KHÔNG PHẢI MỘT CƠ CHẾ — VÀ CÁI TÊN ẤY CHE MẤT BẢN VÁ.** Đo
    được 1/10 trên CI, đọc log ra `[M10]`, đọc `[M10]` ra một điều CỤ THỂ: `pool.end()` đóng
    socket ở phía Node, còn backend giữ advisory lock chết SAU đó và bất đồng bộ. **Phép đếm tức
    thì đo sai THỜI ĐIỂM, không đo sai tính chất.** Khuôn đúng — vòng chờ — đã nằm sẵn TRONG CHÍNH
    TỆP ẤY cho một ca khác, và chú thích đầu tệp còn viết ra thành câu; phép đếm advisory lock bị
    bỏ lại ở dạng tức thì. Trước khi gọi một test là flaky, hãy hỏi *cái gì đổi trạng thái, và
    phép đo đứng ở đâu so với nó*.

    ⑷ **ĐÓNG ĐÚNG THỨ MÌNH NÓI, ĐỪNG ĐÓNG THÊM — VÀ ĐIỀU ĐÓ ÁP CẢ VÀO CON SỐ CỦA CHÍNH MÌNH.**
    Khoản 59 đóng **đua tranh `depcruise`**, và chính lượt chứng minh điều đó lại đỏ một test
    KHÁC — một ngưỡng thời gian tuyệt đối (`TRE_TEST_MS = 800`) dùng để đo một tính chất TƯƠNG
    ĐỐI. Nó thành khoản nợ **66**, không gộp vào 59. Cùng kỷ luật ấy áp lên lời đóng của 24: 0/10
    nghe như một chứng minh, nhưng `0,9¹⁰ ≈ 35%` — **một phần ba số lần, một kho KHÔNG SỬA GÌ vẫn
    cho ra 0/10**. Nên hàng sổ của 24 ghi con số 35% ấy ra, và nói rõ lời đóng đứng trên **cơ
    chế** cộng **một bản vá không nới ngưỡng nào**, với tỷ lệ chỉ là chân thứ ba. Vế `[T10-L]` thì
    ghi thẳng là *không quan sát được*, không phải *đã chữa*.

    ⑸ **VÀ RỒI REVIEW AN NINH LƯỢT 16 TÌM RA RẰNG CHÍNH CÁI KHOÁ ẤY TREO ĐƯỢC.** Ba mức MEDIUM,
    bảy mức LOW, không CRITICAL/HIGH. Nặng nhất: một `continue` trong `catch` **nhảy vượt cả
    kiểm tra hạn cả giấc ngủ** ⇒ quay 100% CPU vĩnh viễn, và vì hàm đồng bộ nên `timeout` của
    `it()` cũng không cứu được — kích hoạt được bằng một `TMPDIR` hỏng, **không cần kẻ tấn
    công**. Tức lớp canh dựng để chống treo tự nó treo được, ngay dưới một chú thích viết
    *"chỗ này NÉM"*. Cùng họ: hạn khoá 300 s **dài hơn** hạn chờ 180 s nên một lần `Ctrl-C`
    đầu độc 2 phút kế tiếp; và hạn chờ 15 s của khoản 24 **vượt** `idleTimeoutMillis` mặc định
    10 s của `pg.Pool` — cái bẫy mà CHÍNH tệp ấy đã ghi ra cách đó 60 dòng cho một khẳng định
    khác. Tất cả đã vá, mỗi vá kèm một lượt đỏ thật (bảng ở `evidence/security-reviews.md`
    §S1.25). Phần tái cấu trúc `do-lap.yml` thành khoản nợ **67**.

    ⑹ **HAI LẦN TRONG VÒNG NÀY, BỘ ĐO CỦA CHÍNH TÔI ĐO KHÔNG CÁI GÌ VÀ BÁO "XANH".** Lượt
    đột biến đầu lọc test bằng chuỗi **không dấu** ⇒ khớp 0 test ⇒ vitest bỏ qua cả 6 rồi thoát
    0 ⇒ 5/5 mũi báo *"xanh"*. Lượt đo tiêm `$GITHUB_OUTPUT` đầu có phép thay chuỗi không khớp
    nên **cả hai vế đều chạy bản mới**, cộng một biến môi trường mang ký tự xuống dòng không đi
    qua nổi Windows. Cả hai lần, *"an toàn"* là kết quả của một phép đo **chưa chạy** — cùng
    đúng một hình dạng mà cả vòng này đi bắt, chỉ khác là ở bộ đo chứ không ở bộ được đo. Luật
    rút ra và đã áp: **mọi harness đột biến phải FAIL-CLOSED** — khai số phép đo kỳ vọng, chạy
    đối chứng KHÔNG đột biến trước, và ném khi số thực tế lệch.

    **Số đo:** `TỶ LỆ ĐỎ: 0 / 10` trên phần cứng CI (lượt 34225703897, 87 phút, nhánh
    `33af790`) · khoá liên tiến trình đo bằng **2 tiến trình thật**, hai chiều · **5 mũi đột
    biến** trên lớp khoá, cả 5 ĐỎ đúng chỗ · tiêm `$GITHUB_OUTPUT` đo hai chiều (bản cũ: bước
    báo động **bị tắt**; bản vá: không) · đường báo động đo bằng **1 issue thật** (#22) đã mở
    và đã đóng · `[INV-H20]` **19/19**.

41. **[2026-09-09] S1.26 — HAI KHOẢN NỢ 2 VÀ 66 LÀ CÙNG MỘT HÌNH DẠNG: MỘT NGƯỠNG KHÔNG ĐO ĐƯỢC
    ĐẠI LƯỢNG NÓ MANG TÊN.** Chúng vào sổ như một lỗ xác thực và một test nhạy tải. Làm chung mới
    thấy chúng là một: khoản 2 có một bộ đếm ĐÚNG nhưng thứ nó chặn hoá ra bằng **độ đồng thời
    của kẻ tấn công**; khoản 66 có một hằng số ĐÚNG nhưng nó phán xét một tính chất **tương đối**
    bằng một đại lượng **tuyệt đối**. Quy tắc rút ra và đã ghi thành ADR-034: **khi một ngưỡng
    không đo được đại lượng nó mang tên, hãy ĐỔI ĐẠI LƯỢNG — đừng nới ngưỡng, và cũng đừng thay
    nó bằng một ngưỡng thứ hai cùng loại.**

    ⑴ **PHẦN ĐẮT NHẤT CỦA KHOẢN 2 KHÔNG PHẢI BẢN VÁ MÀ LÀ PHÉP ĐO.** Bản vá chỉ là một dòng đổi
    chỗ: đưa cổng vào mệnh đề `WHERE` của câu đếm rồi chuyển câu ấy lên TRƯỚC lời gọi cổng mở bí
    mật. Nhưng phép đo cũ — đếm **lý do trả về** — **không phân biệt được bản đã vá với chính
    khoản nợ**: dời câu đặt cọc xuống sau cổng thì cả 24 request vẫn mở cổng, rồi vẫn xếp hàng, và
    số `WRONG_CODE` vẫn là 5. Test vẫn XANH. Đại lượng đúng là thứ khoản nợ GỌI TÊN — **ngân sách
    của kẻ tấn công = số lần cổng mở bí mật được mở**. Đo được: **5, không phải 24**.

    ⑵ **VẤN ĐỀ KHÔNG ĐỐI XỨNG THÌ BẢN VÁ CŨNG KHÔNG ĐƯỢC ĐỐI XỨNG.** Ở khoản 66, một **SÀN** đặt
    trên request bị làm chậm cố ý **không đỏ oan được bao giờ** — tải chỉ làm nó lớn hơn — nên nó
    ở lại nguyên vẹn. Chỉ vai *trần trên* bị gỡ, và **không thay bằng ngưỡng nào**: phản biện đối
    kháng đo được rằng một hiệu tương đối vừa **yếu hơn** vừa **đỏ oan được**, với biên đỏ oan
    thật là **80 ms** chứ không phải 720 — vì `BIÊN + đệm = D` theo định nghĩa. Thay vào đó **bỏ
    đồng hồ**: đếm dấu vết của nhánh làm chậm là một quan sát **phạm trù**, và nó **mạnh hơn** —
    bắt cả một throttle bắn với độ trễ **0 ms**, thứ đồng hồ mù hoàn toàn.

    ⑶ **MỘT BẢN VÁ ĐÚNG VẪN GIẾT ĐƯỢC MỘT KỸ THUẬT TEST, và chi phí ấy phải ĐO chứ không ước
    lượng.** Kỹ thuật *"treo A trong cổng rồi cho B chạy trọn"* đứng trên tiền đề *cổng được gọi
    khi chưa ai giữ khoá hàng* — khoản 2 xoá tiền đề ấy. Đo được: **27/50 đỏ, TẤT CẢ bằng hết
    giờ**, một lỗi gốc kéo 26 lỗi dây chuyền. Đó là hiện vật của TEST, không của sản xuất. Sau khi
    thay bằng khuôn khoá-ngoài: **50/50 trong 20,6 giây** (trước: 1217 giây).

    ⑷ **MỘT BẢN VÁ ĐÚNG CŨNG ĐỔI HÌNH DẠNG TẢI, VÀ LẬP LUẬN AN TOÀN PHẢI ĐƯỢC LIỆT KÊ LẠI TỪ
    ĐẦU.** Review an ninh lượt 17 bắt được rằng câu *"đứng trên ba con số đã có lớp"* của chính
    vòng này **bỏ sót hạng chịu lực nhất**: ba GUC ấy chặn THỜI GIAN MỘT PHIÊN, không cái nào
    chặn SỐ KẾT NỐI BỊ GHIM — và `pool.connect()` khi ấy **không có mốc chết nào**. Vì bản vá
    tuần tự hoá các request, thời gian rút cạn pool đi từ ≈ 1× lên ≈ 5× độ trễ cổng, tức một
    người dùng hợp lệ chạm được tới người của **tổ chức khác**. Đã vá bằng
    `connectionTimeoutMillis = 20 s` và viết hạng thứ tư vào chính khối lập luận; phần bỏ hẳn
    hạng ấy là khoản nợ **69**.

    ⑸ **VÀ MỘT KHOẢN TRỐNG LỚN HƠN CẢ HAI, tìm được trong lúc đóng khoản 2.** `pnpm evidence:check`
    = `pnpm evidence && git diff --exit-code`. Nó chứng minh **bộ sinh là TẤT ĐỊNH**; nó **không**
    chứng minh các lời khai đúng. Đo được: **25 ghi chú, 32 019 ký tự** văn xuôi **viết tay** nằm
    trong nguồn của chính bộ sinh và được chép byte-cho-byte sang tệp sinh ra. Ô ✅/❌ suy từ mã;
    **văn xuôi thì không** — mà văn xuôi mới là chỗ người đọc lấy kết luận. Suýt nữa vòng này giao
    một lời khai đã bị chính bản vá bác bỏ **dưới một dấu kiểm màu xanh**. Khoản nợ **68**.

    **Số đo:** cổng mở bí mật **5/24** dưới đồng thời ép tất định · **5 mũi đột biến** cho khoản 2
    và **4** cho khoản 66, tất cả đỏ đúng chỗ (một mũi bị BỎ vì nó đỏ bằng lỗi CÚ PHÁP) · `pnpm
    t0` 206 module / 858 phụ thuộc / **0** vi phạm · `pnpm test` **695/695** · int 6 tệp
    **113/113** · QT3 ghim bốn trục **12/12** và lớp `PREPARE` XANH · `[INV-H20]` **19/19** ·
    ma trận bằng chứng **55/55 bất biến, 1454 khẳng định**.

42. **[2026-09-09] S1.27 — KHOẢN NỢ 63 ĐÓNG, VÀ BẢN VÁ ĐẦU CỦA CHÍNH VÒNG NÀY LÀ MỘT CỬA KHOÁ
    CÂM.** Vòng này đáng ghi không phải vì cái nó sửa, mà vì **năm lời khai của nó bị bác bằng
    phép đo** — và một trong năm cái ấy là một **lỗ MỚI do chính bản vá tạo ra**.

    ⑴ **CHỌN CÁCH ĐÓNG KHÁC THỨ SỔ NỢ ĐOÁN, VÀ ĐO CẠNH NHAU TRƯỚC KHI CHỌN.** Sổ nợ đề ra
    `UNIQUE (org_id, lower(email))`. Đo trên PostgreSQL 16: đường ấy chặn được **cặp**, nhưng
    `Alice@corp.com` đứng một mình vẫn vào (`INSERT 0 1`), và nó tạo **chỉ mục biểu thức đầu tiên
    của kho** — tức làm `[INV-H14]` đỏ đúng thiết kế và kéo theo một vòng sửa bộ dò. `048` chọn
    `CHECK (email = lower(email))`: thêm **0** chỉ mục, và làm chữ hoa ASCII bất khả.

    ⑵ **RỒI LƯỢT SOI ĐỐI KHÁNG TÌM RA RẰNG CÂU *"CHỮ HOA BẤT KHẢ"* CHỈ ĐÚNG CHO ASCII — VÀ PHẦN
    SAI RƠI THẲNG VÀO ĐƯỜNG ĐĂNG NHẬP.** `.toLowerCase()` của JS hạ **1488** điểm mã; `lower()`
    của PostgreSQL trên `postgres:16-alpine` hạ **1364**. Phần chênh là điểm **bất động với hàm
    máy chủ** — nên qua được `CHECK` — mà JS vẫn hạ. Với một địa chỉ như `Ⓐlice@corp.com`,
    `issueLoginToken` dựng khoá bằng hàm JS còn hàng đã lưu là điểm bất động của hàm PostgreSQL ⇒
    `WHERE lower(email) = $1` trả **0 hàng**. Người ấy **không bao giờ nhận được magic link**, dù
    gõ đúng nguyên văn địa chỉ đã đăng ký — và `/auth/link` luôn trả cùng một 200 nên **không ai
    nhìn thấy**. Một cửa khoá câm vĩnh viễn, **do bản vá TẠO RA**.

    ⑶ **THỨ ĐÓNG ĐƯỢC KHÔNG PHẢI SIẾT RÀNG BUỘC, MÀ LÀ BỎ HẲN MỘT TRONG HAI ĐỊNH NGHĨA.** Hai
    tầng từng mỗi tầng mang một hàm hạ chữ thường riêng. Nay `login.ts` thôi gọi `.toLowerCase()`
    và câu truy vấn hạ **cả hai vế** bằng `pg_catalog.lower()` — cùng một hàm thì không lệch được,
    bất kể libc của máy chủ là gì. Cộng `CHECK`, vị từ tương đương `email = lower($1)`, và
    `UNIQUE (org_id, email)` bảo đảm **nhiều nhất MỘT hàng khớp**: `rows[0]` tất định — đúng thứ
    khoản nợ 63 gọi tên. Mốc chết **tự hiệu chuẩn**: nó hỏi chính CSDL đang chạy xem điểm mã nào
    phân kỳ rồi dùng cái đầu tiên, thay vì đóng cứng một điểm mã vốn phụ thuộc ảnh nền.

    ⑷ **BỐN LỜI KHAI KHÁC CŨNG BỊ BÁC, VÀ ĐỀU BÁC BẰNG PHÉP ĐO.** ⒜ *"câu `ALTER` in ra ĐÚNG hàng
    vi phạm"* — SAI: `ALTER TABLE ADD CONSTRAINT` chỉ nói `is violated by some row`; dòng
    `DETAIL: Failing row contains` chỉ có ở `INSERT`/`UPDATE`. Vế ấy là **trụ** của lập luận
    *"không cần một lượt đối chiếu riêng"*, nên lập luận ấy đổ theo. ⒝ *"chỉ mục trên `lower()`
    đẻ ra một LỚP LỖI MỚI"* — SAI: mọi btree trên `text` đã phụ thuộc collation, kể cả
    `users_org_id_email_key`; khác biệt là về ĐỘ, không về LOẠI. ⒞ *"câu này không dùng được tiền
    tố `(org_id, ...)`"* — SAI: tiền tố VẪN dùng (Bitmap Index Scan, `Index Cond: org_id = ...`);
    thứ mất là **cột khoá THỨ HAI**. ⒟ hàng sổ nợ tự mâu thuẫn về đường (a) trong đúng một câu.

    ⑸ **VÀ LỚP CANH CỦA KHO BẮT ĐƯỢC BỐN LỖI THỦ CÔNG trong một lượt sửa sổ:** một dòng trống làm
    vỡ bảng GFM, một dấu `|` lạc trong một tên đường dẫn, một cặp `~~` lẻ (*"329 dấu `~~` — số LẺ"*),
    và một con trỏ trỏ vào tệp **chưa được git theo dõi**. Cộng một lỗi thứ năm do harness đột
    biến **fail-closed** bắt: test mới của vòng phát một token vào `orgA` và làm đỏ một test khác
    vốn khẳng định `user_login_tokens` của `orgA` bằng 0 — đã cô lập sang một tổ chức riêng.

    **Bài học, viết thành một câu:** *khi hai tầng cùng chuẩn hoá một giá trị, phải có ĐÚNG MỘT
    hàm làm việc ấy.* Hai hàm "cùng nghĩa" ở hai tầng là một cửa khoá câm đang chờ, và nó không
    hiện ra trong bất kỳ test ASCII nào.

    **Số đo:** 4 mũi đột biến cho ràng buộc (migration rỗng ⇒ 3/7; `CHECK` rỗng ruột ⇒ 3/7;
    `NOT VALID` ⇒ **đúng 1/7**; `UNIQUE` toàn cục ⇒ 2/7, một ở `[INV-H14]` có sẵn) · **3 mũi cho
    đường tra cứu, cả ba ĐỎ** (trả lại cả hai vế; chỉ vế JS; chỉ vế SQL) · `pnpm t0` 206 module /
    858 phụ thuộc / **0** vi phạm · `[INV-H20]` **19/19**.

43. **[2026-09-09] S1.28 — KHOẢN NỢ 61 ĐÓNG, VÀ CÁCH ĐÓNG HIỂN NHIÊN BỊ CHÍNH PHÉP ĐO BÁC.**
    Sổ nợ và ADR-029 §4 cùng nói lý do chưa phủ `Handoff.md` là *"tệp ấy chưa có hình dạng máy đọc
    được, ép một hình dạng lên nó là một vòng riêng"*. Vòng riêng ấy chạy, và **tiền đề của câu
    trên sai**.

    ⑴ **CÁCH HIỂN NHIÊN ĐƯỢC ĐO TRƯỚC KHI ĐƯỢC CHỌN, VÀ NÓ TRƯỢT.** Quét mọi đường dẫn trong đấu
    huyền của `Handoff.md` như P4 làm: **121 con trỏ chưa gạch, 38 "không giải được", và 36 trong
    38 KHÔNG PHẢI LỖI** — tên gói và tên team (`@trustprocure/bao-mat`, một team mà chính câu ấy
    nói CHƯA TỒN TẠI), đường HTTP (`/auth/link`), chuỗi phiên bản (`Chrome/151.0.7922.200`), một
    mẫu glob đang được TRÍCH (`*.sql` trong câu về `.gitattributes`), một QUY ƯỚC ĐẶT TÊN
    (`src/index.ts`), và một tệp mà câu văn **nói thẳng là không vào git**. Một phép kiểm sai 36
    lần ở lượt chạy đầu không phải một phép kiểm: cách duy nhất làm nó xanh là một danh sách miễn
    trừ dài bằng chính danh sách phát hiện, và khi ấy nó là một DANH SÁCH, không phải một LỚP.

    ⑵ **ĐỌC LẠI P4 MỚI THẤY NÓ CHƯA BAO GIỜ QUÉT VĂN XUÔI.** Nó đọc **cột con trỏ của bảng sổ
    nợ** — một **vị trí đã khai**. Nên "chuyển P4 sang `Handoff.md`" nghĩa là tìm vị trí đã khai
    tương đương, không phải quét cả tệp. Có đúng một: bảng §13 *Đọc gì, theo thứ tự*.
    **Quy tắc rút ra, rộng hơn tệp này: một lớp canh tài liệu phải đọc những VỊ TRÍ ĐÃ KHAI,
    không phải mọi token trông giống thứ nó đi tìm.**

    ⑶ **BA TRONG NĂM LỜI KHAI ĐƯỢC PHỦ HOÁ RA KHÔNG CẦN CƠ CHẾ MỚI** — chúng là **bản sao của ba
    con số `[INV-H20]` ĐÃ suy ra được** cho `docs/STATE.md`. Việc phải làm là tham số hoá cái
    NHÃN, không phải viết lại phép kiểm. Đó chính là vế ⑷ của ADR-029 đọc theo chiều TỆP thay vì
    chiều CÂU: *mọi nơi lời khai xuất hiện, không phải nơi đầu tiên.*

    ⑷ **ĐO TRÊN `Handoff.md` NGUYÊN BẢN Ở `0a3cc6b`: SÁU VI PHẠM.** ADR khai **18** / thật **34**;
    bất biến khai **47** (34+13) / thật **55** (34+21); nợ khai **61 khoản, 14 mở** / thật **71
    khoản, 14 mở**; **HAI lời khai VẮNG MẶT** (`**<n> migration đánh số**` và `**<n> gói + <m>
    công cụ**` — vế fail-closed bắt được cả sự vắng mặt, tức xoá câu đi không làm im được cổng);
    và con trỏ `docs/superpowers/specs/2026-08-26-…-design.md` chết vì một dấu lược `…`. §3 khi ấy
    khai *"Bảy migration"* trong khi có **48**, và *"Bảy gói + hai công cụ"* trong khi có **13**
    gói + **5** công cụ.

    ⑸ **HAI CON SỐ ĐƯỢC GỠ KHỎI TÀI LIỆU THAY VÌ ĐƯỢC CẬP NHẬT, và đó là tuân thủ chứ không phải
    né tránh.** *"36 mục"* của `hardening.always.sql` và *"bốn họ quy tắc"* của `dependency-cruiser`
    không có mốc cấu trúc nào suy ra được — suy chúng đòi **thêm mốc vào nguồn cho vừa bộ đếm**,
    tức uốn nguồn theo bộ kiểm. ADR-029 ⑴ nói một lời khai tóm tắt chỉ được tồn tại nếu có lớp suy
    ra nó; **không suy được thì không viết**. Riêng số họ quy tắc còn là **hệ quả của số gói**, vì
    `[INV-H16]` đã cưỡng chế *mỗi gói một họ* — chép nó vào đây là dựng thêm một bản sao thứ hai
    để trôi.

    ⑹ **VÀ VÒNG NÀY TỰ SOI RA HAI CHỖ HỞ TRONG CHÍNH LỚP NÓ VỪA DỰNG, cả hai đều là chiều ĐỎ
    OAN — chiều đắt hơn, vì một phép kiểm đỏ oan sẽ bị nới, và nới xong thì nó không còn nói gì.**
    ⒜ `viPhamCapGach` đếm cả dấu `~~` **nằm trong đoạn mã**: `Handoff.md` có 103 dấu (số **LẺ**)
    mà **không** có cặp nào hở, vì §15 chứa một `` `~~` `` trong một đoạn mã đang NÓI VỀ chính cửa
    ấy; và `docs/STATE.md` khi ấy đang xanh chỉ vì số dấu trong đoạn mã của nó **tình cờ CHẴN**
    (bốn dấu). Nay đếm sau khi bỏ đoạn mã. ⒝ bộ đọc bảng §13 lọc **mọi** dòng bắt đầu bằng `|`
    trong cả mục, nên một bảng THỨ HAI — kể cả hàng tiêu đề của nó — bị đọc như hàng dữ liệu:
    **đo được 3 vi phạm giả**, và bản vá *dừng ở cuối bảng thứ nhất* đưa về **0**. Cả hai chỗ đều
    có mũi đột biến giữ.

    **Số đo:** `[INV-H20]` **19 → 36 test** · 6 vi phạm trên tệp nguyên bản, 0 sau khi sửa ·
    mũi *"bảng thứ hai"* đỏ **3/3** trên bản trước khi vá. Phần văn xuôi khẳng định sự TỒN TẠI —
    đúng ba câu S1.21 đo được là sai ở §6 — **vẫn ngoài tầm**, và là khoản nợ **72**.

44. **[2026-09-09] S1.29 — HAI KHOẢN NỢ RỜI HOÁ RA LÀ MỘT HÌNH DẠNG HỎNG, VÀ CẢ HAI ĐÓNG BẰNG
    CÙNG MỘT KHUÔN.** Khoản **12** (nhãn `[INV-XX]` gắn sai chỗ vẫn tính là độ phủ) và khoản
    **60** (tập hàm canh suy từ hình dạng thân hàm) vào sổ như hai việc khác hẳn nhau — một ở
    TypeScript, một ở PostgreSQL. Làm chung mới thấy: **một vị từ nhận diện chủ thể bằng HÌNH
    DẠNG, nên thứ không mang hình dạng ấy rơi khỏi tập TRONG IM LẶNG.** Khuôn đóng chung, thành
    ADR-035: *liệt kê RỘNG theo một tiêu chí không lách được bằng cách viết khác, rồi BUỘC PHÂN
    LOẠI; rơi ra ngoài mọi danh sách là ĐỎ.*

    ⑴ **ĐO CÁCH HIỂN NHIÊN TRƯỚC KHI CHỌN NÓ — và với khoản 12 nó trượt.** Đường hiển nhiên là
    dùng cột *nơi cưỡng chế* của sổ đăng ký làm nguồn khai chỗ đặt. Đo: cột ấy nêu tên tệp cho
    **7/13** cặp mã `H` và **0/101** cặp mã `A–G` — nó là VĂN XUÔI cho các hàng nghiệp vụ. Dùng
    nó sẽ đỏ 101 lần ở lượt đầu **mà không có khiếm khuyết nào**, đúng cái bẫy khoản nợ 61 đã đo
    được ở `Handoff.md` một vòng trước. Nên nguồn khai phải là một **SỔ KHAI** riêng.

    ⑵ **KHOẢN 60: TẬP RỘNG LỚN HƠN TẬP ĐƯỢC CANH MƯỜI MỘT LẦN.** Đo trên PostgreSQL 16: mọi hàm
    `plpgsql` trả `trigger` gắn `BEFORE … FOR EACH ROW` trên `UPDATE`/`DELETE` — **23 hàm**; vị
    từ hình dạng (`prosrc` không chứa `RETURN`) nhận **2**. Hai mươi mốt hàm đi qua nó mà không
    lớp nào nói gì. Bản vá **không nới vị từ** — nới thế nào cũng lại là một hình dạng — mà bắt
    mỗi hàm phải nằm trong đúng một trong hai danh sách. **Và nó đóng cả chiều ngược:** một hàm
    khai KHÔNG-CANH bị viết lại thành không-bao-giờ-trả-về sẽ lọt vào tập hình dạng ⇒ hai lời
    khai mâu thuẫn ⇒ đỏ.

    ⑶ **PHÉP ĐO BẮT ĐƯỢC MỘT LỖ TRONG CHÍNH BẢN VÁ TRƯỚC KHI NÓ RA ĐỜI.** Bản đầu của lớp mới
    quét dòng `it(`, vì mô tả cũ nói bộ sinh *"gom theo tên test"*. Đo lại: bộ sinh gom theo
    `fullName` = tên `describe` **NỐI** tên `it`, và **22 cặp (mã, tệp) chỉ tồn tại trên dòng
    `describe(`** — gồm `[INV-H19]`, `[INV-H20]`, `[INV-H21]` và cả ~~chín~~ **mười** mã hook (`H1`–`H10` — lượt soi 19 đếm lại). Lớp mới suýt
    ra đời với **đúng cái lỗ nó sinh ra để bịt**. Cùng phép đo ấy bác câu tự khai *"đúng thứ bộ
    sinh gom"* của `packages/outbox/src/nhan-bat-bien.test.ts` — câu ấy rộng hơn thứ được đo, đã
    gạch tại chỗ.

    ⑷ **VÀ MỘT MŨI ĐỘT BIẾN CỦA CHÍNH VÒNG NÀY XANH OAN, DO `[INV-H20]` BẮT.** Sau khi `Handoff.md`
    mang hai cụm `**[S…] n ADR**` — một đã gạch, một còn sống — mũi *"xoá lời khai để làm im cổng"*
    nhắm vào cụm khớp ĐẦU TIÊN, tức cụm đã chết, nên nó xanh trong khi đáng lẽ phải đỏ. Lớp canh
    sổ nợ dựng ở vòng trước bắt được đúng chỗ ấy. Đã sửa để mũi nhắm vào lời khai còn sống.

    ⑸ **NÓI CHO ĐÚNG MỨC — ĐÓNG BĂNG KHÔNG PHẢI KIỂM TOÁN.** Cả hai danh sách (137 cặp nhãn, 23
    hàm trigger) sinh từ trạng thái đo được rồi đóng băng. Chúng chặn thành viên **tiếp theo** đi
    vào lặng lẽ; chúng **không** phán xét thành viên có sẵn. Vế *"test này có thật sự đo bất biến
    ấy không"* là một PHÁN XÉT, không cơ giới hoá được. Một lượt soi bằng mắt đã chạy trên bốn
    cặp đáng ngờ nhất (`barrel-exports.test.ts` nhận `B2`, `D1`, `D5`, `E3`) và **cả bốn đứng
    vững** — một test mặt tiền export LÀ lớp cưỡng chế thật cho các bất biến ấy.

    ⑹ **RỒI LƯỢT SOI ĐỐI KHÁNG 19 BÁC HAI TRỤ CỦA CHÍNH VÒNG NÀY.** 6 lăng kính, 56 phát hiện, 12
    sống sót qua ba người phản bác (hạn phiên cắt hai lần; 33 phát hiện chưa được thẩm định máy,
    những cái nặng đã tự đo lại bằng tay). ⒜ Bộ quét của H22 — kể cả sau khi thêm `describe(` —
    **vẫn là một vị từ hình dạng**, đúng thứ ADR-035 §2⑴ cấm: `test(`, `it.concurrent(`, tiêu đề
    ở dòng sau của `it.each` đều nuôi ma trận mà bộ quét mù, kho đang có **8** tên test như thế;
    mũi thật cho 7/7 xanh trong khi vitest báo 11 test `[INV-A1]` từ tệp chưa khai. Bản đóng cuối
    đọc CHÍNH báo cáo vitest ở cổng evidence. ⒝ Tổng điều tra của khoản 60 lấy hình dạng làm nguồn
    sự thật nên **thưởng lời khai sai, phạt lời khai đúng**: hàm canh kiểu `RETURN NULL` khai thật
    ⇒ đỏ, khai sai ⇒ xanh và bảng không được canh — đúng lỗ khoản 60. Bản đóng cuối: vị từ =
    hình dạng ∪ khai báo, khớp nguyên văn `hardening.always.sql`, mâu thuẫn một chiều, và một
    phép đo trên PostgreSQL thật cho đúng ca ấy. ⒞ Bốn con số sai: *"chín mã hook"* (đo lại:
    mười), *"56 mã / 137 cặp tại `bebeb41`"* (tại đó là 55/136; cặp 137 là của chính H22),
    biên bản khai *"6 tệp"* trong khi diff có 11, và dòng tổng của chính sổ đăng ký còn khai 21
    hàng rào. Cộng: hai hàng H21/H22 tách khỏi đầu bảng nên GFM dựng thành văn bản thô, ADR-028 §6
    còn khai nguyên văn tập hàm canh *"suy từ hình dạng"*, và tổng điều tra định danh hàm không
    gắn lược đồ.

    **Số đo:** `[INV-H22]` **8 test** hàm thuần + cưỡng chế ở `pnpm evidence` (mũi thật: gắn
    `[INV-C1]` vào tệp chưa khai ⇒ CHẶN MERGE) · `[INV-H19]` 8 → **11 test**, gồm phép đo hàm
    canh `RETURN NULL` trên PostgreSQL thật · đối chứng không đột biến xanh trước mỗi lượt. Khoản
    nợ **73** (RULE không qua trigger) và **74** (khai sai một hàm canh có `RETURN` không bắt được
    bằng văn bản) mở cố ý.

45. **[2026-09-09] S1.30 — KHOẢN NỢ 74 ĐÓNG BẰNG PHÉP ĐO HÀNH VI; PHÉP ĐO LỘ RA MỘT LOẠI HÀM
    MÀ HAI DANH SÁCH KHÔNG TẢ ĐƯỢC; VÀ LƯỢT SOI 20 BÁC BẢN ĐẦU Ở HAI CHỖ, BÁC ĐÚNG.** ADR-035 tự
    vạch ranh giới ở §2⑷: *liệt kê rộng rồi buộc phân loại đóng chiều IM LẶNG, không đóng chiều
    NÓI DỐI* — một hàm canh có `RETURN` khai SAI là KHÔNG-CANH thì cả ba khẳng định của tổng điều
    tra đều xanh. Sổ nợ chỉ đúng đường: một phép đo hành vi, giá là một hàng hợp lệ trên mỗi
    bảng. Vòng này trả đúng giá ấy.

    ⑴ **PHÉP ĐO KHÔNG PHẢI LỜI KHAI THỨ BA, VÀ VẾ CHỊU LỰC ĐÃ ĐƯỢC ĐO.** `track_functions = 'pl'`
    rồi đọc `pg_stat_xact_user_functions` — bộ đếm CỤC BỘ của backend cho giao dịch hiện tại, đọc
    được ngay, không cần chờ đẩy ra vùng chung. PostgreSQL chỉ cộng `calls` khi hàm TRẢ VỀ, vì
    `ExecCallTriggerFunc` gọi `pgstat_end_function_call` SAU `PG_TRY` nên một `RAISE` nhảy qua
    nó. Dựng đúng hàm canh kiểu `IF … RAISE … END IF; RETURN NULL;` của lượt soi 19: UPDATE và
    DELETE đều ném từ chính nó, `calls` đứng ở **0** — đo trong cùng giao dịch, quanh chính lời
    gọi ném, qua một `SAVEPOINT`. Vậy *"calls tăng"* = *"hàm có một đường trả về và đường ấy vừa
    được đi trên một hàng thật"* — thứ không lời khai văn bản nào cho được.

    ⑵ **GHI CÔNG THEO BỘ BA (HÀM, BẢNG, SỰ KIỆN), VÀ BA VẾ CỦA NÓ ĐỀU CÓ LÝ DO.** Một câu
    UPDATE/DELETE ghi công cho bộ ba khi ⒜ hàm có trigger BEFORE-ROW ở đúng (bảng, sự kiện) theo
    TẬP RỘNG — vì nhiều hàm ở đây cũng gắn BEFORE INSERT, và một lời gọi qua INSERT không nói gì
    về UPDATE; ⒝ `calls` tăng trong lúc ĐÚNG MỘT câu chạy — bước chuẩn bị (chèn vật liệu khoá, đổi
    vai) đứng trước lần đọc đầu; ⒞ câu chạm ≥ 1 hàng — vì một hàm `RETURN NULL` bỏ hàng là
    canh-bằng-im-lặng: nó trả về mà không hàng nào đổi. Mọi bộ ba tập rộng THẤY cho một hàm khai
    KHÔNG-CANH phải được ghi công: **30 bộ ba**, 29 có nhân chứng, 1 khai canh một sự kiện.

    ⑶ **KỊCH BẢN LÀ 24 CÂU TRÊN 13 BẢNG, VIẾT TAY, VÀ ĐÓ LÀ CÁI GIÁ CHỨ KHÔNG PHẢI LỖ.** Trọn một
    đời RFQ (soạn → nộp → mở → gia hạn → mời → đóng → yêu cầu mở thầu → duyệt → điều phối → mở
    thầu), một RFQ huỷ để thu hồi vật liệu khoá, một việc outbox, một liên kết đăng nhập, một lượt
    đặt lại TOTP hai người. Kịch bản không tự sinh, nhưng nó không nói dối được: câu không đi qua
    thì ném, câu 0 hàng thì không ghi công.

    ⑷ **PHÉP ĐO LỘ RA MỘT THỨ TRƯỚC KHI NÓ ĐƯỢC VIẾT XONG.** `rfq_key_material_bat_bien` từ chối
    DELETE **vô điều kiện** (`IF TG_OP = 'DELETE' THEN RAISE`) nhưng cho UPDATE có điều kiện
    (bốn cột thu hồi, ba cột xoá). Hai danh sách của tổng điều tra không tả được nó: không phải
    hàm canh chỉ-ghi-thêm (bảng vẫn sửa được), mà cũng không có nhân chứng DELETE nào lấy được.
    Bản đóng: một lời khai riêng `HAM_CANH_MOT_SU_KIEN`, và lời khai ấy phải ĐO được — sự kiện
    nêu tên không được có nhân chứng, và một câu DELETE trên hàng thật phải ném **từ chính hàm
    ấy** (`where` của lỗi PostgreSQL, không phải một ràng buộc khác tình cờ chặn).

    ⑸ **LƯỢT SOI ĐỐI KHÁNG 20 BÁC BẢN ĐẦU Ở HAI CHỖ, VÀ CẢ HAI LÀ CÙNG MỘT KHUÔN VỚI LƯỢT 19:**
    *bản cài đặt đầu tiên lại tin một lời khai mà nó sinh ra để kiểm.* ⒜ Bản đầu ghi công theo
    HÀM — nhưng thân hàm trigger đọc `TG_TABLE_NAME`/`TG_ARGV`, nên một hàm có thể canh vô điều
    kiện ở bảng này mà có điều kiện ở bảng kia; `thu_hoi_don_dieu` gắn **5** bảng, kịch bản chạm
    **2**, ba bảng kia chưa hàng nào đi qua mà cặp vẫn xanh. ⒝ Kịch bản chạy dưới superuser, nên
    mọi hàm gated theo vai (`IF la_duong_ung_dung('app_api') THEN RAISE; END IF; RETURN NEW;` —
    một hàm canh với toàn bộ lưu lượng sản xuất) được ghi công miễn phí; hai hàm được chuyển sang
    `app_api` là chọn theo TÊN viết tay. Bản đóng cuối: khoá theo bộ ba; vai ĐO bằng `current_user`
    và hàm mà thân đọc vai đòi nhân chứng từ vai không superuser (vế văn bản chỉ chọn ĐỘ MỊN của
    phép đo, không phân loại ai). Đo sau khi đóng: bỏ nhân chứng `guest_sessions` ⇒ đỏ đúng
    `thu_hoi_don_dieu/guest_sessions/UPDATE`; DELETE `mfa_credentials` dưới owner ⇒ đỏ *(cần vai
    không superuser)*. Lượt soi còn đưa `pg_stat_xact_user_functions` thay cho đường flush (đã
    lấy), một so sánh phụ thuộc thứ tự catalog và một `release()` có thể treo `pool.end()` (đã
    sửa), và MEDIUM-1 — trigger cấp câu/AFTER-ROW vô hình với cả tổng điều tra lẫn nhân chứng —
    thành khoản nợ **75**, đo tĩnh: kho có 0 trigger như thế trên UPDATE/DELETE.

    ⑹ **VÀ MỘT DÒNG THIU BẮT ĐƯỢC TRONG LÚC ĐỐI CHIẾU.** `docs/TEST-PLAN.md` mục *"Giới hạn của
    H19"* còn khai chiều im lặng *"vẫn mở, và là khoản nợ 60"* — 60 đã đóng từ S1.29; gạch tại
    chỗ.

    **Số đo:** `[INV-H19]` 11 → **13 test**; tập rộng 23 hàm / 41 trigger / 13 bảng; 30 bộ ba cần
    nhân chứng, 29 ghi công + 1 canh một sự kiện; 24 câu nhân chứng; **4 mũi đột biến đỏ thật** (1
    thường trực, 3 đo tay rồi hoàn lại); 0 mã sản xuất đổi (`hardening.always.sql` nguyên vẹn —
    lớp này là test, cùng tầng với tổng điều tra). Khoản nợ **73** vẫn mở cố ý; **75** mở mới.

46. **[2026-09-09] S1.31 — KHOẢN 73 VÀ 75 ĐÓNG CHUNG: TẬP ỨNG VIÊN CỦA H19 THÔI KHOÁ THEO HÌNH
    THỨC, VÀ MỖI VÒNG LẠI LỘ THÊM MỘT CƠ CHẾ CỦA POSTGRESQL CÓ THỂ CHẶN GHI.** Hai khoản nợ là
    hai đường làm một bảng chỉ-ghi-thêm mà tổng điều tra không thấy: một `RULE` (không trigger
    nào) và một trigger cấp CÂU LỆNH hay AFTER-ROW (trigger, nhưng không phải hình thức tập rộng
    nhận). Cùng lớp, đóng chung.

    ⑴ **ĐO CẢ HAI CHIỀU CỦA KHOẢN 73 TRƯỚC KHI CHỌN.** Chiều xuôi: `CREATE RULE … DO INSTEAD
    NOTHING` ⇒ UPDATE/DELETE trả **0 hàng, không lỗi**, hàng còn nguyên, `migrate()` OK, bảng
    ngoài `VI_TU_BANG_CHI_GHI_THEM`. Chiều ngược — vế sổ nợ tự nhận *"chưa đo"* — đo xong thì
    hở thật: rule trên `bid_receipts` **sống qua `migrate()`**; [CR1] chỉ với tới hai bảng sổ.
    Bản đóng đi cả hai đường: sản xuất PHÁN XÉT rule trên mọi bảng chỉ-ghi-thêm suy ra (mục
    *trạng thái vật lý*, bảng sổ vẫn tự gỡ vì đứng trước trong mảng — đo đủ năm bảng), và một
    tổng điều tra `pg_rewrite` với danh sách RỖNG — rỗng là một lời khai. Mũi đột biến: vô
    hiệu vế mới ⇒ rule trên `bid_receipts` lại sống ⇒ đỏ.

    ⑵ **KHOẢN 75: TẬP RỘNG LÀ MỌI TRIGGER TRÊN UPDATE/DELETE, KHÔNG CÒN XÉT BIT ROW/BEFORE.**
    28 hàm / 46 trigger / 15 bảng (thêm 5 hàm AFTER-ROW của D3 và đình chỉ). Luật mới: hàm canh
    — theo hình dạng hay khai báo — ở bất kỳ hình thức nào khác `BEFORE … FOR EACH ROW` là ĐỎ,
    vì đó là hình thức duy nhất H19 nhận. Dựng hàm canh cấp câu lệnh: ném cả câu 0 hàng, ngoài
    H19, `migrate()` OK, `TRUNCATE` OK — tập rộng mới thấy nó, và tổng điều tra đỏ ở CẢ HAI lời
    khai có thể có. Năm hàm AFTER-ROW có nhân chứng như mọi hàm khác; bỏ một ⇒ đỏ đúng bộ ba.

    ⑶ **PHÉP ĐO BÁC MỘT LỜI KHAI CỦA CHÍNH BẢN ĐẦU.** Bản đầu thêm `SET CONSTRAINTS ALL
    IMMEDIATE` vào nhân chứng với chú thích *"kho không có trigger deferred"*. Kịch bản gãy ngay
    ở bước mở thầu: 017 CÓ một constraint trigger DEFERRED trên INSERT `rfq_key_material`, đòi
    RFQ được mở TRONG CÙNG giao dịch. Gỡ, và viết đúng: 0/46 trigger UPDATE/DELETE là
    deferrable; một trigger như thế sẽ không được ghi công ⇒ đỏ nhìn thấy được, và thông điệp
    nay nói rõ vì sao.

    ⑷ **LƯỢT SOI ĐỐI KHÁNG 21 — MỘT CAO, HAI NẶNG, HAI NHẸ; CAO hạ xuống INFO bằng phép đo.**
    ⒜ *Rule đặt tên `"_RETURN"` trên bảng lách vế loại theo tên?* Đo: PostgreSQL 16 NÉM
    *non-view rule … must not be named "_RETURN"* — engine giữ tên ấy cho view; ghi vào chú
    thích, không đổi vế. ⒝ Test rule trên bảng chỉ-ghi-thêm không có `finally` — một assert đỏ
    giữa vòng để rule sống ⇒ mọi `migrate()` sau ném vì chính mục mới ⇒ đỏ dây chuyền; sửa.
    ⒞ Trigger DEFERRED trên UPDATE/DELETE đỏ vĩnh viễn với thông điệp SAI; sửa thông điệp, đưa
    `tgdeferrable` vào tập rộng theo bảng. ⒟ Tổng điều tra rule thiếu đối chứng chống rỗng ruột
    trong chính nó; thêm. ⒠ RLS `USING (false)` là cơ chế thứ ba — khoản nợ **76**. Lượt soi
    xác nhận: thứ tự mảng hardening (gỡ rule bảng sổ TRƯỚC phán xét), bit `tgtype` PG16, AFTER
    ROW bắn cho no-op UPDATE, luật BEFORE-ROW không dương tính giả, qt3 không đọc hai tệp này.

    **Số đo:** `[INV-H19]` 13 → **17 test**; tập rộng 28 hàm / 46 trigger / 15 bảng; 35 bộ ba
    cần nhân chứng, 34 ghi công + 1 canh một sự kiện; 27 câu nhân chứng; **3 mũi đột biến đỏ
    thật** (vế RULE của hardening; nhân chứng `users`; hàm canh cấp câu lệnh — thường trực);
    **19 dòng `hardening.always.sql` đổi** (17 thêm, 2 bỏ: một vế UNION phán xét, chú thích), không migration
    mới. Khoản nợ **76** mở mới; danh sách còn mở: 13.

47. **[2026-09-09] S1.32 — KHOẢN 76 ĐÓNG BẰNG CÂU HỎI RỘNG HƠN NÓ: ADR-036 LIỆT KÊ MỌI CƠ CHẾ
    LÀM MỘT CÂU GHI TRẢ 0 HÀNG KHÔNG LỖI — VÀ LƯỢT SOI 22 THÊM HAI HÀNG VÀO DANH MỤC NGAY
    TRONG VÒNG VIẾT NÓ.** Ba vòng liền, mỗi vòng lộ thêm một cơ chế (trigger BEFORE-ROW, RULE,
    trigger khác hình thức, RLS). Vòng này không đóng cơ chế thứ tư như một cơ chế; nó trả lời
    câu hỏi mà bốn khoản nợ kia là bốn câu trả lời rời: *với một câu INSERT/UPDATE/DELETE do vai
    ứng dụng gửi, PostgreSQL 16 có những cơ chế nào làm nó chạm 0 hàng mà không ném lỗi?*

    ⑴ **ĐO TRƯỚC KHI LIỆT KÊ.** 30 bảng RLS; **29 policy RESTRICTIVE** (027, cô lập phiên khách)
    mà lớp hình dạng [CR1] cố ý không soi — đúng cho câu hỏi RÒ (restrictive chỉ thu hẹp), sai
    cho câu hỏi IM LẶNG: `AS RESTRICTIVE FOR UPDATE USING (false)` trên `users` sống qua
    `migrate()`, app_api đọc được hàng nhưng UPDATE ra **0 hàng, không lỗi**. Phủ lệnh: 87/87 tổ
    hợp (bảng, vai, quyền) có policy PERMISSIVE. 2 bảng RLS ngoài tenant. 0 view.

    ⑵ **NĂM LỚP MỚI, MỖI LỚP MANG ĐỐI CHỨNG DƯƠNG CỦA RIÊNG NÓ** (bài học lượt soi 21): tổng điều
    tra policy RESTRICTIVE (29 dòng khai, bốn cột nguyên văn `pg_get_expr`); tổng điều tra phủ
    lệnh (quyền đã cấp — mức bảng hay cột, đích danh hay qua PUBLIC — phải có policy PERMISSIVE
    phủ); tổng điều tra bảng RLS ngoài tenant; trigger canh phải `ENABLE ALWAYS` (không chỉ
    "không tắt": `session_replication_role = replica` bỏ qua trigger `O` — fail-open, chiều ngược
    với cả danh mục); tổng điều tra `relkind` (mọi đích DML là bảng thường trừ khi khai). Không
    mã sản xuất đổi: migration là đường duy nhất tạo policy/trigger/rule và CI chặn merge.

    ⑶ **ADR-036 LÀ NGUỒN, KHÔNG PHẢI TÓM TẮT.** 16 hàng: mỗi cơ chế có cột *lớp canh* và cột
    *đo*; một cơ chế mới phải vào bảng TRƯỚC khi có lớp, với cột lớp canh ghi *"chưa có — khoản
    nợ N"*. Bảng không được có hàng nào để trống cột ấy.

    ⑷ **LƯỢT SOI ĐỐI KHÁNG 22 — HAI CAO, HAI NẶNG, BỐN NHẸ; và hai CAO đều là HÀNG THIẾU TRONG
    DANH MỤC.** ⒜ Tổng điều tra phủ lệnh **mù với quyền cấp qua PUBLIC**: `grantee = 0` không có
    hàng trong `pg_roles` nên JOIN thẳng làm rớt nó — `GRANT UPDATE … TO PUBLIC` cấp quyền cho
    cả hai vai mà census không thấy; chính tệp này đã biết bài ấy ở `CAU_VAI_TRO` mà không áp
    lại cho ACL. Sửa: nhân mỗi entry PUBLIC ra từng vai; đối chứng dương nay là `GRANT … TO
    PUBLIC` ⇒ ba bộ ba. ⒝ **Trigger BEFORE INSERT ROW trả `NULL`** nuốt INSERT im lặng — ngoài
    mọi tổng điều tra vì tập rộng chỉ có bit UPDATE/DELETE. Sửa: mở bit INSERT, 27 hàm buộc phân
    loại (19 khai mới); nhân chứng INSERT là khoản **77**. ⒞ ROLLBACK/dọn dẹp nằm ngoài
    `finally` ở năm chỗ — một `expect` đỏ để giao dịch mở trên client trả về pool ⇒ đỏ dây
    chuyền; sửa cả năm. ⒟ Khoá tổng điều tra thiếu lược đồ; sửa. ⒠ Che tên bằng bảng tạm/schema
    trùng tên vai — khoản **78**. Xác nhận: `'A'` đúng và test không thừa (hardening chỉ ghim
    ALWAYS cho trigger có TÊN); khớp vai theo OID là chiều an toàn; `pg_get_expr` nguyên văn là
    đỏ ồn ào chứ không xanh im lặng khi PostgreSQL đổi cách deparse.

    ⑸ **NÓI CHO ĐÚNG MỨC.** ADR-036 §5: danh mục là một lời khai về tính đầy đủ và không chứng
    minh được — lượt soi 22 chứng minh đúng điều ấy khi thêm hai hàng vào bản 14 hàng. Thứ ADR
    mua được không phải *"đã đủ"*, mà là *"cái thiếu có một địa chỉ để đứng"*.

    **Số đo:** `[INV-H19]` 17 → **19 test**; `[INV-F1]` +4 test (`rls-coverage` 21 → 25); tập
    rộng của tổng điều tra hàm trigger: 47 hàm (28 + 19 INSERT); 29 policy RESTRICTIVE khai; 87 tổ
    hợp phủ lệnh; 0 mã sản xuất đổi; ADR **036**. Khoản nợ 76 đóng; **77**, **78** mở mới; danh
    sách còn mở: 14.

48. **[2026-09-10] S1.33 — KHOẢN 77 ĐÓNG: NHÂN CHỨNG HÀNH VI PHỦ CẢ INSERT, VÀ CƠ CHẾ NUỐT CỦA
    INSERT KHÁC HẲN HAI SỰ KIỆN KIA.** Đường đóng viết sẵn ở khoản 77 đi được trọn: `chung()` nhận
    sự kiện INSERT, `chuaCoNhanChung` đòi bộ ba (hàm, bảng, INSERT), và ~~MỌI INSERT của kịch bản là
    nhân chứng~~ mọi INSERT của kịch bản trên một bảng có trigger INSERT là nhân chứng (lượt soi 25b #6: vài
    câu dựng dữ liệu chạy trần, không ai được ghi công vì chúng). Nhưng thứ đáng ghi là điều phép đo lộ ra trước khi viết.

    ⑴ **ĐO TRƯỚC KHI VIẾT.** Hàm canh UPDATE/DELETE từ chối bằng `RAISE` — PostgreSQL KHÔNG đếm
    một lời gọi kết thúc bằng ném — nên *"calls tăng"* là bằng chứng có một đường trả về đã được đi.
    Hàm nuốt INSERT thì trả `NULL`: nó TRẢ VỀ, `calls` +1, và câu cho `INSERT 0 0`. Bộ đếm hàm một
    mình sẽ ghi công cho lời khai sai. Vế ⒞ *"câu chạm ≥ 1 hàng"* — viết ở S1.30 như một vế phụ —
    là toàn bộ lớp cho cơ chế 15 của ADR-036. Test đột biến mới đo đúng điều ấy.

    ⑵ **HAI TRIGGER DEFERRED CỦA KHO VÀO TẬP, VÀ CHÚNG PHẢI ĐO ĐƯỢC.** Lượt soi 21 từng ghi hàm
    DEFERRABLE *"ngoài phép đo"*; S1.31 ép `SET CONSTRAINTS ALL IMMEDIATE` TRƯỚC câu chèn khoá và
    tự bắn vào chân. Nay ép SAU câu nhân chứng và sau `hoanTat` (câu làm điều kiện thoả: mở RFQ,
    phát biên nhận), rồi đọc bộ đếm lần thứ ba: hàm DEFERRED chỉ ghi công ở cửa sổ ấy, hàm thường
    chỉ ở cửa sổ đầu. Thứ tự là toàn bộ khác biệt. Cột phân loại là `tginitdeferred`, không phải
    `tgdeferrable` — `DEFERRABLE INITIALLY IMMEDIATE` chạy cuối câu (đo).

    ⑶ **KỊCH BẢN LÀ MỘT ĐỜI DỮ LIỆU THẬT HƠN.** Thêm sổ kiểm toán + mốc neo, phê duyệt RFQ (D2),
    luồng báo giá + phiên bản + biên nhận cùng giao dịch (B2), bản rõ dưới yêu cầu đã duyệt (A1),
    vai tạm nhận một quyền (D3), yêu cầu mở thầu break-glass có nhân chứng rồi huỷ (D4), và một
    phiên mở dưới `app_api` sau một lần TOTP đúng — hai hàm nhạy vai của `sessions` (029, 039)
    đi qua CẢ HAI vế có điều kiện, không ngắn mạch (lượt soi 23 xác nhận). RFQ 1 chèn khoá là câu
    đo, RFQ 2 mở là câu đo: `rfq_kiem_khoa_khi_mo` chỉ chạy ở lần mở. Đỏ đo được: xoá nhân chứng
    mốc neo + chạy nhân chứng `sessions` dưới superuser ⇒ đỏ đúng ba bộ ba.

    ⑷ **LƯỢT SOI ĐỐI KHÁNG 23 — BA NẶNG, BỐN NHẸ, NĂM INFO; cả ba NẶNG đã sửa và hai trong ba là
    HÀNG MỚI CỦA ADR-036.** ⒜ `rowCount` là con số PostgreSQL đếm TRƯỚC khi trigger AFTER chạy:
    một `AFTER INSERT ROW` xoá đúng hàng vừa vào cho `INSERT 0 1`, `RETURNING` đầy đủ, `calls`
    tăng — ba vế ⒜⒝⒞ đều xanh và bảng rỗng. Đo: `n_tup_ins` 1, `n_tup_del` 1. Sửa: vế *"hàng
    thật"* đo thêm ở mức BẢNG bằng `pg_stat_xact_user_tables` ở ba mốc — bộ đếm của đúng sự kiện
    bằng `rowCount`, hai bộ đếm kia bằng 0, cửa sổ sau không chạm bảng nhân chứng; lệch thì NÉM
    (hàng 17). ⒝ Nuốt MỘT trong nhiều hàng cho `rowCount ≥ 1`: mỗi INSERT của kịch bản khai số hàng
    nó mong (hàng 18). ⒞ Vị từ `nhay_vai` là năm cái tên, lách được bằng đúng khuôn 037 — bọc
    `pg_has_role` vào một hàm tên khác — và bỏ sót `current_role`, `USER`, `current_setting('role')`,
    `has_*_privilege`, `pg_authid`: regex rộng hơn + bao đóng bậc một, đối chứng dương (một hàm gọi
    vị từ bọc phải bị THẤY); `\muser\M` bắt thêm `mfa_reset_kiem_quyen` qua chuỗi `'user.mfa_reset'`
    — dương tính giả, chiều an toàn, nhân chứng ấy nay chạy dưới `app_api`. Bốn NHẸ đã sửa:
    `tginitdeferred`; tiền đề hàm DEFERRED mang đúng một sự kiện; vai tạm trong `finally`; hàng rào
    INSERT canh-một-sự-kiện đứng đầu vòng. Xác nhận: `SET CONSTRAINTS ALL IMMEDIATE` vô hại (kho
    không có khoá ngoại DEFERRABLE); break-glass không bỏ sót đường nào; kịch bản lặp lại được.

    ⑸ **NÓI CHO ĐÚNG MỨC.** Lớp nhân chứng nay tin ba bộ đếm của PostgreSQL (hàm, bảng, `rowCount`)
    thay vì một; giới hạn ⒞ ⒟ của khối vẫn đứng — nó nói *có một đường trả về đã được đi trên một
    hàng thật*, không nói *mọi điều kiện của hàm đều đúng*, và nuốt theo dữ liệu NGOÀI câu (một
    `org_id` thuộc tập cố định) vẫn ngoài tầm. INSERT chưa khai được canh-một-sự-kiện.

    **Số đo:** `[INV-H19]` 19 → **22 test**; nhân chứng: 38 bộ ba INSERT mới (hai qua trigger DEFERRED)
    cộng các bộ ba UPDATE/DELETE đã có; vị từ nhạy vai: 5 hàm trực tiếp + 4 qua bao đóng (trùng) + 1 dương tính giả; 0 mã
    sản xuất đổi; ADR-036 thêm hàng 17, 18. Khoản nợ 77 đóng; danh sách còn mở: 13.

49. **[2026-09-10] S1.34 — KHOẢN 78 ĐÓNG BẰNG MÃ SẢN XUẤT: HARDENING THU HỒI TEMP VÀ CREATE
    TRÊN DATABASE, PHÁN XÉT SCHEMA TRÙNG TÊN VAI VÀ ~~USAGE NGOÀI PUBLIC~~ QUAN HỆ TRÙNG TÊN PUBLIC
    TRONG SCHEMA VAI CÓ USAGE; `vai-tro.ts` DISCARD TEMP.** (Tiêu đề từng khai bản đầu của mục phán xét —
    chính ⑶⒞ dưới đây nói evidence đã bác nó; lượt soi 25b NẶNG-3 bắt được, gạch tại chỗ.)
    Lần đầu từ S1.29 một khoản nợ đóng bằng mã chạy ở mọi `migrate()`, và lượt soi 24 chỉ ra
    rằng lớp đầu chỉ ĐO tiền đề của mình chứ chưa GIỮ nó.

    ⑴ **ĐO TRƯỚC KHI VÁ.** `rolconfig` về NULL ⇒ search_path `"$user", public`, `pg_temp` ngầm
    đứng trước. `app_api` có TEMP qua PUBLIC (`datacl` NULL): `CREATE TEMP TABLE sessions` ⇒
    `sessions` trần đếm 0 khi `public.sessions` có 1 hàng, UPDATE trần 0 hàng không lỗi; bảng tạm
    sống hết đời KẾT NỐI pool nên che cho mọi request sau. `CREATE SCHEMA app_api` +
    `app_api.sessions` ⇒ cùng thế, cho MỌI kết nối. `migrate()` đi qua cả hai. Mã sản xuất qualify
    `public.` (QT3/H21) nên hôm nay vô hại — lớp này đóng đường ấy ở CSDL để bảo đảm không phụ
    thuộc việc mọi câu SQL tương lai nhớ qualify.

    ⑵ **SÁU MỤC, BA CẶP, MỘT TẬP VAI THEO TÍNH CHẤT.** `VAI_KET_NOI_UNG_DUNG` = thành viên bắc cầu
    của `app_api`/`app_unseal` trừ superuser (`pg_has_role(r, g, 'MEMBER')`), không theo tên đăng
    nhập. TEMP và CREATE ON DATABASE: tự chữa (thu hồi là đơn điệu, ADR-028 §2⑵) — một mục cho
    PUBLIC (hậu điều kiện đọc qua `acldefault` để thấy cả `datacl` chưa vật chất hoá) và một mục
    cho tập vai (vòng DO, mỗi vai một REVOKE — không gộp, vì một role vắng làm cả câu ném 42704).
    Schema trùng tên vai, và quan hệ trùng tên public trong schema vai có USAGE: phán xét, cố ý
    không tự DROP/REVOKE.
    Đo: sau REVOKE, CREATE TEMP TABLE/VIEW/SEQUENCE đều 42501 *permission denied for schema
    pg_temp_N*; app_api mất CREATE thì `CREATE SCHEMA app_api` là 42501.

    ⑶ **LƯỢT SOI ĐỐI KHÁNG 24 — MỘT NẶNG, NĂM NHẸ, NĂM INFO.** ⒜ NẶNG: bản đầu chỉ có TEMP và
    phán xét schema — tiền đề *app_api không tạo được schema* chỉ được đo ở ACL mặc định, không
    mục nào giữ; CREATE trôi ⇒ app_api tự dựng schema che BỀN, kéo tới deploy sau rồi phải sửa tay.
    Sửa: cặp mục CREATE, cùng khuôn TEMP. ⒝ Bảng tạm tạo TRƯỚC deploy sống qua REVOKE — đo đúng
    (cùng kết nối, vẫn đếm 0, INSERT vẫn vào) ⇒ `vai-tro.ts` `DISCARD TEMP` cùng câu `SET ROLE`,
    không thêm vòng đi-về; test đo bằng `pg_backend_pid` rằng kết nối vật lý lấy lại đã sạch.
    ⒞ `SET search_path` trong phiên không bị chặn — chỉ che được khi vai có USAGE ở schema khác
    chứa quan hệ trùng tên; hôm nay không có (đo) ⇒ mục phán xét giữ đúng điều ấy. Bản đầu của mục
    phán xét *không USAGE ngoài public* và evidence bắt ngay: hai fixture hợp lệ (`khac` — con
    INHERITS ở schema khác; `gia` — hàm giả cho [CR1]) gãy; thu hẹp về đúng cơ chế: quan hệ
    (r/p/v/m/f) trùng tên, hàm trùng tên không thuộc hàng 16. ⒟ Mục gộp ba grantee gãy khi thiếu role ⇒ tách PUBLIC riêng, vai theo vòng DO, hậu điều
    kiện qua `pg_roles` (`bool_and`). ⒠ Hàm SECURITY DEFINER thuộc chủ DB tạo được bảng tạm trong
    phiên app — không hàm nào dùng TEMP hôm nay (grep), `CAU_DOC_VONG` canh mọi secdef ngoài danh
    sách ngoại lệ; ghi ở ADR-036 ⑯ là giới hạn. Xác nhận: dollar-quote lồng và `%I` an toàn;
    `"$user"` phân giải theo current_user nên schema trùng tên role ĐĂNG NHẬP chỉ che khi kết nối
    không ở SET ROLE — phòng thủ chiều sâu, đã ghi vào chú thích; mọi role khác của cụm mất TEMP —
    ràng buộc thiết kế.

    ⑷ **ĐỎ ĐO ĐƯỢC, CÔ LẬP TỪNG MỤC.** REVOKE TEMP thành no-op ⇒ test 1 đỏ (lượt phán xét bắt);
    `true OR` vào hậu điều kiện schema ⇒ test 2 đỏ (`migrate()` đi qua khi phải gãy); thu hồi CREATE
    thành no-op ⇒ test 2 đỏ ở đúng khẳng định *CREATE bị thu hồi*. Cả tệp `migrations.int.test.ts`
    94/94 xanh với lớp mới; `packages/db` xanh với `DISCARD TEMP`.

    **Số đo:** 6 mục hardening mới + 1 hằng; `migrations.int.test.ts` 92 → **94 test**; 1 dòng mã
    sản xuất ở `vai-tro.ts`; ADR-036 hàng 16 đóng. Khoản nợ 78 đóng; danh sách còn mở: **12**, tám
    có hình dạng mã nguồn.

50. **[2026-09-10] S1.35 — LƯỢT SOI NGANG 25 TRÊN SÁU VÒNG ĐÃ HỢP NHẤT (S1.29–S1.34): BỐN KHOẢN
    NỢ MỚI 79–82, ADR-036 THÊM BỐN HÀNG, SỔ SÁCH SỬA TẠI CHỖ. 0 MÃ SẢN XUẤT.** Sáu lượt soi 19–24
    đều nhìn DỌC — mỗi lượt đứng trong vòng của nó và hỏi *"lớp mới này có đủ không"*. Vòng này đặt
    hai người soi độc lập nhìn NGANG trên master `0b1d41c`: một soi năm lớp CSDL (25a, 12 mục), một
    soi nhất quán tài liệu/mã (25b, 16 mục). Mọi phát hiện đo được của 25a được người viết đo lại
    trên PostgreSQL 16 sạch (bản nháp `db/zz-do-soi25.int.test.ts`, đã xoá, kết quả chép vào biên
    bản lượt soi).

    ⑴ **ĐIỀU SÁU LƯỢT SOI DỌC KHÔNG THẤY.** ⒜ Hardening đã canh `WHEN`/`UPDATE OF` (`tgqual`/`tgattr`)
    và ngôn ngữ hàm từ S0 cho bảng CÓ TÊN; vị từ suy ra và tổng điều tra của S1.29–S1.33 được viết
    như thể hai bài học ấy chưa từng có — **khoản 79** (CAO: bảng suy ra "chỉ-ghi-thêm" mà UPDATE
    cột khác và DELETE đi qua với 1 hàng; NẶNG: trigger `internal` vô hình với mọi tổng điều tra).
    ⒝ Nhân chứng bị siết bốn vòng bằng câu *"câu có chạm hàng không"* — mỗi lượt soi bác một con số
    (`calls`, `rowCount`, `n_tup_*`) — mà chưa lượt nào hỏi *"hàng chạm có phải hàng đã gửi không"*:
    `RETURN OLD` được ghi công trọn vẹn; và `nhay_vai` bị bác ba lần mà chỉ nới regex thay vì đảo
    mặc định — **khoản 80**. ⒞ S1.32 quyết *"test là đủ cho 5–10"* ngay sau khi S1.31 lập luận ngược
    lại cho cơ chế 3 — hai vòng liền, hai kết luận trái nhau về cùng câu *"cụm đã deploy có lớp
    không"* — **khoản 81**, một quyết định trước khi thêm mã. ⒟ Hai NHẸ: `NO INHERIT` (hàng 13 sai ngữ
    nghĩa) và ghim chuỗi con ở `caller_rate_limits` — **khoản 82**.

    ⑵ **PHÉP ĐO BÁC VÀ LÀM RÕ.** 25a #8 (schema trùng tên superuser che tên cho `poolAs` của test):
    `"$user"` phân giải theo `current_user` — `current_schemas(false)` = `{public}` sau SET ROLE — và
    mục *quan hệ trùng tên* của S1.34 bắt đúng schema ấy: `migrate()` gãy nêu tên; người soi cho rằng
    hardening không phán xét — sai. 25a #9: `INSERT … RETURNING` dưới policy `FOR SELECT USING
    (false)` ⇒ 42501 ồn ào, không phải 0 hàng — ghi vào ADR-036 §5 là *đã xét, không thêm*. 25a #11
    (nếu một vai kết nối là CHỦ database thì `has_database_privilege` luôn true, hai mục theo vai gãy
    mãi với thông điệp sai hướng) và #12 (`DISCARD TEMP` xoá cả bảng tạm của secdef trong một lần cầm
    client) ghi vào ADR-036 ⑯.

    ⑶ **BA NẶNG TÀI LIỆU CỦA 25b, SỬA TẠI CHỖ.** ⒜ Client `c3` ở test khoản 78 nằm ngoài
    `try/finally` — trái lời khai *"không rò pool"* của lượt soi 24 #11 — bọc lại (đổi test, không đổi
    phép đo). ⒝ `security-reviews.md` không có `# §S1.33`/`# §S1.34`: lượt soi 23/24 treo dưới
    `# §S1.32` vốn khai *0 mã sản xuất*, trong khi S1.34 đổi 141 dòng hardening + `vai-tro.ts` — vòng
    đầu tiên chạm mã sản xuất từ S1.29 không có dòng bề mặt an ninh; viết bù hai mục, ghi rõ là viết
    bù. ⒞ Tiêu đề biên bản 49 khai lớp *USAGE NGOÀI PUBLIC* — bản đầu đã bị evidence bác — gạch tại
    chỗ. Và văn bản thiu gạch (tài liệu) hay thay (chuỗi test) cùng lượt: hàng nợ 77/78 (tiền đề chưa gạch), ADR-035 §2⑴ (ví dụ tiêu
    chí *không lách được* đã bị khoản 75 lách) và §4 (*27 câu*), ADR-036 hàng 2 (thiếu INSERT) và §5
    (*hàng 16 hôm nay là một*), lượt soi 21 #3 (hai quyết định bị S1.33 đảo), TEST-PLAN H19 (*nhân
    chứng INSERT là khoản nợ 77*), bốn chú thích/tiêu đề test rộng hơn mã ngay dưới nó (*BEFORE-ROW
    UPD/DEL*, *Năm hàm AFTER-ROW* trên 25 tên, *MỌI câu ghi là nhân chứng*, *bảng của nó ĐƯỢC canh*).

    ⑷ **CHƯA SỬA, NÓI RÕ.** 25b #12 (thông điệp mục TEMP/CREATE theo vai không nhắc PUBLIC), #13
    (một câu 9 dòng chép hai lần ở mục 6) đụng `hardening.always.sql` — đi cùng khoản 79 hay 82 khi
    tệp ấy mở lại; #15 (`daKhai.has` là khẳng định yếu) và #16 (ba `poolAs` trong một test) là INFO
    của test, chưa đụng. 25b xác nhận KHỚP bằng đọc và `git diff --stat`: số test H19 (22) và F1,
    36 ADR, 78 khoản/12 mở, chuỗi 13/14/14/13/14/13/12 ở Handoff, *0 mã sản xuất* từng vòng, 19 dòng
    S1.31, 141 dòng S1.34; các con số kết quả đo (bộ ba, `calls`, `n_tup_*`) là thứ đọc không kiểm được.

    ⑸ **LƯỢT SOI ĐỐI KHÁNG 26 — TRÊN CHÍNH BẢN SỔ SÁCH NÀY, TRƯỚC COMMIT: KHÔNG NẶNG, SÁU NHẸ, SÁU
    INFO; sửa mười một.** Ba lời khai bị lượt 25 bác còn SỐNG chưa gạch (hàng nợ 77 *MỌI INSERT*;
    lượt soi 24 #11 *không rò pool*; lượt soi 23 #12 *chỉ 1 và 2 còn hở*) — gạch; chú thích ở khối vị
    từ trích nguyên văn tiêu đề test vừa đổi — sửa; hai vế SUY từ đọc đứng sau chữ *đo* ở hàng 79/80
    (*census không thấy `zz2`*, *ba vế ghi công `zz_dao`* — chưa chạy census/`chung()` trên fixture)
    — tách *đo* khỏi *theo đọc*; ba mục hẹn *đi cùng khoản 79/82* không có địa chỉ trong hai khoản
    ấy — ghi vào thân hàng 82; ADR-036 §5 đọc như một hàng mới không có nợ — viết lại; hàng 81 bỏ
    8/9 — thêm; 25b #2 trỏ sai tệp (*một dòng mỗi task* là câu của STATE §Tham chiếu, không phải
    Handoff); đầu ADR-036 khai *khoản nợ liên quan* dừng ở 76; *gạch* nói cho cả chuỗi test — là
    *thay*; cột đo 25a #5 không nêu bốn chuỗi. Chấp nhận, không sửa: kết quả đo 25a không tái lập
    được từ kho (bản nháp đã xoá) — khoản 79/80/82 khi đóng phải dựng `zz1`/`zz2`/`zz_dao`/`NO INHERIT`
    thành test thật. 26 kiểm KHỚP: 82 hàng, 16 `[MỞ]` trùng dòng tổng kết, 5 + 11 = 16, số `~~` chẵn ở
    năm tệp, ba cột ở 79–82, con trỏ giải được, `pid` dùng được ở `c4`, 27 `.connect()` khác đều có
    `try`. Bảy lượt soi liền (19–25) bác một lời khai của bản đầu; lượt 26 là lượt đầu KHÔNG có NẶNG.

    **Số đo:** sổ nợ 78 → **82 khoản, 16 còn mở** (mười một có hình dạng mã nguồn); ADR-036 18 →
    **22 hàng** (19: trả về hàng đã sửa; 20: `WHEN`/`UPDATE OF`; 21: trigger ngoài plpgsql; 22:
    `ALTER TABLE … NO INHERIT`), hàng 13 sửa; 0 mã sản xuất; hai tệp test đổi chỉ ở chuỗi và một
    `finally`. Biên bản lượt soi 25 (28 mục, mỗi mục kèm phép đo hay lý do không đo) ở
    `evidence/security-reviews.md` §S1.35.

51. **[2026-09-10] S1.36 — KHOẢN 79 ĐÓNG BẰNG MÃ SẢN XUẤT: VỊ TỪ CHỈ ĐẾM TRIGGER CANH VÔ ĐIỀU KIỆN,
    MỘT MỤC PHÁN XÉT MỚI CHO TRIGGER CANH CÓ WHEN/UPDATE OF, CHỐT TRUNCATE PHẢI VÔ ĐIỀU KIỆN, VÀ TỔNG
    ĐIỀU TRA NGÔN NGỮ TRIGGER.** Khoản CAO đầu tiên từ lượt soi ngang, và lần thứ hai từ S1.29 một khoản
    đóng bằng mã chạy ở mọi `migrate()`.

    ⑴ **ĐO TRƯỚC KHI VIẾT.** Ngoài ca lượt soi 25a đã đo (UPDATE cột khác 1 hàng, DELETE 1 hàng qua
    trigger canh có `UPDATE OF`/`WHEN (false)`), phép đo mới: PostgreSQL 16 NHẬN `WHEN (false)` trên
    trigger TRUNCATE cấp câu lệnh và `TRUNCATE` đi lọt (bảng về 0 hàng) — chốt TRUNCATE mà hardening đòi
    từ S1.20 cùng kẽ với hàng 20 của ADR-036, chưa ai nêu; `UPDATE OF` trên trigger cấp câu lệnh cũng
    hợp lệ. Kho có 85 trigger plpgsql, 0 trigger ngôn ngữ khác.

    ⑵ **LỚP, MỘT SỬA CHO HAI KẼ VÀ MỘT KẼ MỚI.** `VI_TU_BANG_CHI_GHI_THEM` — cả hai bản, nguyên văn —
    chỉ đếm trigger canh khi `tgqual IS NULL AND tgattr = ''`: bảng có trigger canh điều kiện RƠI KHỎI
    tập chỉ-ghi-thêm, và thế là đúng (nó không chỉ-ghi-thêm). Để việc rơi không xảy ra trong im lặng —
    chế độ hỏng ADR-035 §2⑴ gọi tên — mục phán xét mới `CAU_TRIGGER_CANH_CO_DIEU_KIEN` chặn deploy khi
    một trigger của hàm canh (hình dạng ∪ khai báo, plpgsql) ở BẤT KỲ bảng nào của dự án mang WHEN hay
    UPDATE OF — hay KHÔNG ở ENABLE ALWAYS (cột thứ ba, lượt soi 27 NẶNG-1); thông điệp nêu tên trigger và
    vế. Vị từ cố ý KHÔNG đọc `tgenabled`: bảng có trigger canh tắt ở lại tập để LOGGED/ACL vẫn được phán,
    cột ấy chặn deploy qua mục phán xét. Chốt TRUNCATE trong `CAU_CHI_GHI_THEM_VAT_LY` đòi
    `tgqual IS NULL`. Tập rộng mang `co_when`/`co_cot`, tổng điều tra đòi hàm canh vô điều kiện với
    đối chứng dương hoàn tác. Tổng điều tra NGÔN NGỮ trigger: mọi trigger của dự án gọi hàm plpgsql trừ
    `TRIGGER_NGOAI_PLPGSQL_DA_KHAI` (rỗng), đối chứng dương là chính `suppress_redundant_updates_trigger`
    — đo trong test: UPDATE cùng giá trị 0 hàng không lỗi, tập rộng không thấy nó. Tổng điều tra ấy
    CHỈ Ở TEST: theo cách đọc ADR-036 §3⑶ đã ghi ở S1.35, cụm đã deploy chưa có lớp cho nó cho tới khi
    khoản 81 quyết — nói ra, không giấu. Vế plpgsql ở vị từ giữ nguyên (lý do đo được của review lượt
    12 M4 vẫn đúng). Kèm hai mục lượt soi 25b hẹn ở khoản 82: thông điệp TEMP/CREATE theo vai nêu đường
    PUBLIC và chủ DB; `CAU_QUAN_HE_TRUNG_TEN` một bản dùng ở cả hậu điều kiện lẫn mô tả.

    ⑶ **ĐỎ ĐO ĐƯỢC, CÔ LẬP TỪNG MỤC.** Vế vô điều kiện bỏ khỏi CẢ HAI bản (cổng nguyên văn vẫn xanh) ⇒
    đỏ ở guard *vế phải nằm trong vị từ*; vế có mặt nguyên văn mà VÔ HIỆU (`OR true`, cả hai bản) ⇒ đỏ
    đúng ở *vị từ MỚI thả bảng* — vế ấy là thứ chịu lực; mục phán xét mới thành no-op ⇒ đỏ ở *migrate()
    NÉM*; mục bỏ vế `tgenabled` ⇒ đỏ ở `tgenabled=D`; đảo hai nhánh CASE ⇒ đỏ ở regex ghép tên với vế;
    tổng điều tra ngôn ngữ lọc lại plpgsql ⇒ đỏ ở đối chứng dương. Chốt TRUNCATE bỏ `tgqual` ⇒
    `migrate()` VẪN ném, đúng một mục — mục phán xét mới, vì nó bắt cả trigger TRUNCATE có WHEN: hai lớp
    chồng nhau cho ca ấy, test đỏ ở khẳng định thông điệp *chốt TRUNCATE*. Ghi thẳng: vế `tgqual` ở
    chốt TRUNCATE là lớp thứ hai cho cùng ca, không phải lớp duy nhất. **Và evidence bác bản đầu của vế
    `tgenabled`:** hai fixture của chính tệp H19 (bảng phân mảnh `so_pm` của review lượt 12 H1, và `zz_cau`
    của khoản 75) tạo trigger canh ở ENABLE thường — mục mới NÉM đúng, vì lược đồ ấy đi qua dưới
    `session_replication_role = replica`; hai fixture nâng lên ALWAYS như 047 làm cho bảng có tên. Đây là
    lần thứ hai (sau S1.34) một mục hardening mới bị chính evidence sửa trước khi PR mở — và lần này mục
    ĐÚNG, fixture sai.

    ⑷ **LƯỢT SOI ĐỐI KHÁNG 27 — MỘT NẶNG, BA NHẸ, HAI INFO; cả sáu xử lý trong vòng.** **Lượt soi đối kháng 27 — một NẶNG, ba NHẸ, hai INFO; cả sáu xử lý trong vòng.** ⒜ NẶNG: mục phán xét mới đọc `tgqual`/`tgattr` mà KHÔNG đọc `tgenabled` — trên bảng SUY RA, `DISABLE TRIGGER` hay ENABLE thường + `session_replication_role = replica` giữ bảng trong tập (vị từ cố ý không đọc cột ấy) mà UPDATE đi qua và `migrate()` OK; lớp duy nhất là tổng điều tra ở test, tức chính vế khoản 81 đang treo. Đo đúng: UPDATE 1 hàng ở cả hai biến thể. Sửa: vế thứ ba `tgenabled <> 'A'` vào cùng mục, nhánh CASE nêu `tgenabled=…`; test (f) đo cả hai biến thể, đối chứng ENABLE ALWAYS ⇒ `migrate()` OK; đột biến bỏ vế ⇒ đỏ ở `tgenabled=D`. ⒝ NHẸ: thông điệp *vị từ đã thả bảng này* sai khi bảng còn một trigger canh vô điều kiện khác cho cùng sự kiện — viết lại đúng ngữ nghĩa đếm; bốn `toContain` không ghép tên trigger với vế (đảo hai nhánh CASE vẫn xanh) — nay regex ghép tên với vế, đột biến đảo CASE ⇒ đỏ; chú thích *ALWAYS là vế H19* rộng hơn mã — sửa, và đo *thông điệp NÉM đúng 1 mục*. ⒞ INFO: tổng điều tra ngôn ngữ chỉ ở test trong khi WHEN/UPDATE OF/`tgenabled` cùng vòng vào hardening — ghi ranh giới (hàm `internal`/C cần superuser, PL tin cậy khác chưa cài; ngoài mô hình đe doạ của hardening) ở chú thích test và ADR-036 hàng 21; mục mới phủ cả trigger TRUNCATE nên trùng cố ý với vế chốt TRUNCATE — test B nay đòi cả hai lớp nêu tên (*không sửa được 2 mục*). Khớp, người soi kiểm bằng đọc: mọi `WHEN (`/`UPDATE OF` của kho (013–041) gọi hàm có RETURN trong `HAM_KHONG_PHAI_CANH` nên mục mới không phán sai; fixture T5 đặt WHEN/UPDATE OF lên `audit_events_chan_update` vẫn OK vì BƯỚC 2 dựng lại trước BƯỚC 3 (đã chạy: 94/94); `replaceAll` không rỗng ruột (`.gitattributes` `*.sql eol=lf`, guard `not.toBe`); ba test không rò client; `CAU_QUAN_HE_TRUNG_TEN` không đổi ngữ nghĩa (so từng vế với bản chép); FK `ON DELETE CASCADE` vẫn qua BEFORE ROW của bảng con — theo hiểu biết PostgreSQL, chưa đo.

    **Số đo:** `[INV-H19]` 22 → **25 test**; `migrations.int.test.ts` 94/94 với hardening mới; hardening:
    vị từ +2 dòng, chốt TRUNCATE +1 vế, một hằng + một mục phán xét mới, một hằng gộp, hai thông điệp;
    ADR-036 hàng 20, 21 đóng (hàng 21 với giới hạn *chỉ ở test*). Khoản nợ 79 đóng; danh sách còn mở:
    **15**, mười có hình dạng mã nguồn.

52. **[2026-09-10] S1.37 — KHOẢN 81 ĐÓNG BẰNG MỘT QUYẾT ĐỊNH ĐO ĐƯỢC: ADR-036 §3⑶ LÀ MỘT TIÊU CHÍ
    (CHỦ DB THƯỜNG TẠO ĐƯỢC ⇒ PHẢI CÓ MỤC HARDENING), KHOẢN 83 MỞ. 0 MÃ SẢN XUẤT.** Lượt soi 25a #3
    chỉ ra hai vòng liền nhau (S1.31, S1.32) kết luận trái nhau về cùng câu *"cụm đã deploy có lớp
    không"*; S1.36 lại tự đứng ở hai phía cho hai cơ chế kề nhau (WHEN/UPDATE OF vào hardening, `prolang`
    ở test — lượt soi 27 INFO-5). Vòng này không chọn một phía: nó đo cái làm hai phía khác nhau.

    ⑴ **ĐO TRƯỚC KHI QUYẾT.** Đo trên PostgreSQL 16 dưới `trien_khai` — chủ database, `rolsuper = false`, CREATEROLE — theo hồ sơ [fix round 4 N2] cộng một điều N2 không có: được cho sở hữu `sessions`. Vì sao: dưới N2 nguyên bản bảng bootstrap thuộc superuser và `CREATE POLICY`/`CREATE TRIGGER` trên `sessions` là **42501** (đo) — nhưng mọi bảng do migration tạo SAU bootstrap thuộc vai deploy, nên mô hình đe doạ đúng là *chủ bảng không superuser* (lượt soi 28 NẶNG-2). Chủ bảng tạo được: policy RESTRICTIVE `USING (false)` trên `sessions` (5); bảng mới bật RLS + FORCE, GRANT `app_api`, không policy ⇒ UPDATE dưới `app_api` **0 hàng** (6); RLS trên bảng ngoài tenant (7); VIEW, MATERIALIZED VIEW, bảng phân mảnh (10); trigger gọi hàm built-in `suppress_redundant_updates_trigger()` — không cần tạo hàm (21); extension TIN CẬY `tcn` (mang hàm trigger C) cài được, `moddatetime` không tin cậy (42501); trigger plpgsql `RETURN NULL` trên `sessions` (1/15); RULE `DO INSTEAD NOTHING` trên `sessions` (3); `DISABLE TRIGGER` (9); `NO INHERIT` (22). `migrate()` — dưới superuser VÀ dưới chính `trien_khai` — đi qua với tất cả những thứ ấy còn nguyên. Cần superuser, đo ở mọi cửa: `CREATE FUNCTION … LANGUAGE internal` (42501); extension không tin cậy `file_fdw` (42501); `session_replication_role` — `SET`, `ALTER ROLE app_api SET`, `ALTER ROLE trien_khai SET` (chính mình, không vướng ADMIN OPTION), `ALTER DATABASE … SET`, `ALTER SYSTEM`, `GRANT SET ON PARAMETER` đều 42501; `trien_khai` không thuộc `pg_write_all_data`/`pg_signal_backend`/`pg_read_server_files`. `CREATE EXTENSION plperl` qua được kiểm tra quyền (không 42501 — extension tin cậy) và gãy 58P01 vì image thiếu `libperl.so`: chưa cài thành công, suy ra cài được trên image có thư viện. Ngôn ngữ có sẵn: `c`, `internal` (không tin cậy), `plpgsql`, `sql` (tin cậy). Ca thay-thế-theo-tên trên bảng CÓ TÊN thì hardening hôm nay ĐÃ bắt: `DROP POLICY sessions_tenant_isolation` ⇒ `migrate()` NÉM ([CR1]: *không có policy PERMISSIVE nào*); đổi tên `sessions` rồi `CREATE VIEW sessions` ⇒ NÉM 4 mục (ghim hàm/trigger có tên). Lỗ nằm ở đối tượng MỚI và ở thứ thêm vào bảng có tên mà [CR1] không đếm (policy thừa, rule, trigger lạ).

    ⑵ **QUYẾT.** §3⑶: *cơ chế nào mà chủ database không superuser tạo được trên cụm đã deploy thì PHẢI
    có mục hardening (phán xét); chỉ cơ chế cần superuser mới được để ở test.* Lý do là lý do S1.31 đã
    dùng cho hàng 3, S1.34 cho hàng 16, S1.36 cho hàng 20 — hardening là lớp duy nhất chạy trên cụm đã
    deploy, mô hình đe doạ của nó là chủ bảng không superuser; *"migration là đường duy nhất"* chỉ đúng
    trong CI. Đường ⒝ (*nói thẳng không có lớp*) bị loại: một lỗ đóng được bằng năm mục cùng khuôn với
    những mục đã có thì mô tả nó không phải một quyết định. Tiêu chí có BA vế: ⒜ chủ bảng thường tạo
    được VÀ catalog phân biệt được tĩnh ⇒ mục hardening; ⒝ chỉ nhân chứng hành vi phân biệt được (1, 15,
    17–19: thân hàm nuốt/sửa hàng) ⇒ không có mục hardening — giới hạn có địa chỉ ở §5, đo: chủ bảng gắn
    trigger plpgsql `RETURN NULL` lên `sessions`, `migrate()` đi qua; ⒞ cần superuser (tạo hàm C, tham
    số SUSET) ⇒ test là đủ. Hệ quả: **khoản nợ 83** — TÁM mục phán xét phân loại theo tính chất (policy
    thuộc đúng một lớp; phủ lệnh; RLS ngoài tenant; relkind v/m/f; prolang; rule rỗng mọi quan hệ — hàng 3
    tổng quát, đo: RULE trên `sessions` sống qua `migrate()`; hàm canh hình dạng ngoài BEFORE-ROW — hàng
    2; `pg_parameter_acl` — tiền đề SUSET của hàng 8). 9 đã có mục từ S1.36; 22 ở khoản 82; 8 có lớp ENABLE
    ALWAYS ở hardening. Phép đo cũng bác một vế mới viết ở S1.36: *PL khác chưa cài* ở hàng 21 — `plperl`
    và `tcn` là extension TIN CẬY, chủ DB cài được (tcn cài thành công; plperl qua kiểm tra quyền, gãy vì
    image thiếu `libperl.so`). Một lớp không được tựa vào cái image thiếu gì.

    ⑶ **GIÁ, NÓI RA.** Danh sách khai NGUYÊN VĂN sẽ sống ở hardening và test phải đòi hai bản khớp — một
    policy mới là BA thay đổi; biểu thức ghim nguyên văn ở hardening biến rủi ro deparse đổi theo phiên bản
    PostgreSQL thành *chặn deploy tới khi chép lại* (§4 hôm nay chỉ nhận giá ấy ở test); và không chỉ ba
    fixture `zz_chan`/`zz_ngoai`/`zz_v` mà mọi test đang tạo policy/rule/trigger/view fixture rồi mong
    `migrate()` OK (18 chỗ `CREATE POLICY` ở `migrations.int.test.ts`) phải rà trước. Khoản 83 ghi rõ để
    evidence không phải bác bản đầu lần thứ ba.

    ⑷ **LƯỢT SOI ĐỐI KHÁNG 28 — TRÊN CHÍNH QUYẾT ĐỊNH: MỘT CAO, HAI NẶNG, NĂM NHẸ, NĂM INFO; cả 13 xử
    lý trong vòng.** CAO: tiêu chí *không bỏ phiếu từng cơ chế* mà hệ quả bỏ phiếu ngầm — chỉ nêu cơ chế
    đã có census tĩnh, im lặng về 1, 2, 3 tổng quát, 15, 17–19 mà chủ bảng thường cũng tạo được; đo đúng
    (trigger nuốt và RULE trên `sessions` sống qua `migrate()`); sửa: tiêu chí ba vế, 83 thêm ⑹⑺, ⒝ nói
    thẳng giới hạn. NẶNG: *"đúng hồ sơ N2"* rộng hơn phép đo — phép đo đã cho `trien_khai` sở hữu
    `sessions`, dưới N2 nguyên bản `CREATE POLICY` là 42501 (đo) — sửa lời khai và tiêu chí (*chủ bảng*);
    thiết kế 83⑴ ghim mọi policy theo tên đảo nguyên lý [CR1] và gãy ≥ 10 test — viết lại thành phân loại.
    NHẸ: ba lời khai về cùng phép đo lệch nhau (`migrate()` dưới vai nào) — thống nhất, đo thêm `ALTER ROLE`
    chính mình để ranh giới SUSET đứng bằng đo (42501); *"8 ở test"* sai — lớp là ENABLE ALWAYS ở hardening,
    tiền đề SUSET chưa ghim ⇒ 83⑻; *"hàm C cần superuser"* chỉ đúng vế TẠO — GẮN thì không (built-in; `tcn`
    cài được, `moddatetime` không tin cậy — đo); hai con trỏ chết sau quyết định (chú thích test, §5) —
    sửa; 83⑷⑸ thiếu bộ lọc — ghi; 82⑵ ⊂ 83⑴ — liên kết chéo. INFO: đầu ADR-036 thêm 83; *"chủ DB được cài
    plperl"* là suy luận từ mã lỗi — viết đúng mức; ca thay-thế-theo-tên chưa đo — đo: `DROP POLICY` và
    view thay bảng có tên đều bị hardening bắt; placeholder; thứ tự hàng 83 sau 82. Khớp: 83 khoản / 15 mở
    ở ba chỗ, 4 + 11 = 15, hàng 83 ba cột, con trỏ giải được, ADR-028 không mâu thuẫn, `prolang` không
    phán FK, BƯỚC 1 reset `rolconfig` phủ cả `session_replication_role` nếu ai đặt được.

    **Số đo:** 0 mã sản xuất; ADR-036 §3⑶ viết lại, hàng 5, 6, 7, 10, 21 thêm địa chỉ; sổ nợ 82 → **83
    khoản, 15 còn mở** (đóng 81, mở 83; mười một có hình dạng mã nguồn).

53. **[2026-09-10] S1.38 — KHOẢN 83 NỬA RLS ⑴⑵⑶ ĐÓNG BẰNG MÃ SẢN XUẤT: BA MỤC PHÁN XÉT CHO ADR-036
    HÀNG 5, 6, 7 TRÊN CỤM ĐÃ DEPLOY; KÈM 82⑵. KHÔNG KHOẢN NÀO ĐÓNG TRỌN — 83 và 82 còn nửa kia.**
    Lần thứ ba từ S1.29 một vòng đổi `hardening.always.sql`, và lần đầu tiên câu phán xét của hardening
    được CHẠY TRONG TEST thay vì chỉ so văn bản.

    ⑴ **ĐO TRƯỚC KHI VIẾT** (S1.37 đã đo, chép lại chỗ chịu lực): chủ bảng thường tạo được policy
    RESTRICTIVE `USING (false)` trên `sessions`, bảng bật RLS không policy (UPDATE dưới app_api 0 hàng),
    RLS trên bảng ngoài tenant; `migrate()` đi qua cả ba. Trong vòng: bản hardening mới trên CSDL sạch
    đi qua (0 vi phạm hôm nay); trên hai tệp test HIỆN CÓ, đúng hai test đỏ — `zz_chan` và `[I4]` — cả
    hai là kỳ vọng cũ *RESTRICTIVE lạ sống qua migrate()* mà ADR-036 hàng 5 đã bác từ S1.32; không
    fixture hợp lệ nào gãy (18 chỗ `CREATE POLICY` của `migrations.int.test.ts` đều là PERMISSIVE trên
    bảng tenant — lớp (a) — hoặc là ca cố ý đỏ của chính [CR1]). Rồi lượt soi 29 bác hai thứ của chính
    phép đo ấy: (i) trên tập migration RÚT GỌN của `migrations.int.test.ts` chiều ngược *khai mà không có*
    kêu về 027/042 chưa tồn tại — 13 test đỏ; (ii) bốn fixture con/lá-của-bảng-tenant đi qua CHỈ NHỜ vế miễn
    mà vế miễn ấy là một lỗ.

    ⑵ **LỚP.** Lớp ở `hardening.always.sql`, ba mục PHÁN XÉT sau mục [CR1]: ⑴ `CAU_POLICY_LOP_SAI` — mọi policy trên bảng RLS của dự án thuộc ĐÚNG MỘT lớp: (a) PERMISSIVE trên bảng tenant ([CR1] soi hình dạng, không soi lại); (b1) RESTRICTIVE khuôn 027 — `<bảng>_khach`, ALL, PUBLIC, hai vế = *không phải phiên khách* — nhận theo TÍNH CHẤT, không cần khai; (b2) RESTRICTIVE khác — `POLICY_RESTRICTIVE_KHAI` sáu cột nguyên văn (tám biến thể của 027 nới theo cột); (c) khác — `POLICY_KHAC_KHAI` bảy cột (`caller_rate_limits_khach`); đỏ cả hai chiều. ⑵ `CAU_PHU_LENH_SAI` — mỗi (bảng RLS, vai ứng dụng, quyền SELECT/INSERT/UPDATE/DELETE đã cấp — mức bảng hay cột, đích danh hay PUBLIC — bốn vai kết nối kể cả hai role đăng nhập, policy áp cho vai và thành viên kế thừa) phải có policy PERMISSIVE phủ (lệnh, vai); KHÔNG miễn con của bảng tenant — con có GRANT riêng mà không policy là đúng ca hàng 6 (lượt soi 29 NẶNG-2; bản đầu miễn `LA_CUA_BANG_TENANT`). ⑶ `CAU_RLS_NGOAI_TENANT_SAI` — bảng bật RLS ngoài `VI_TU_CAN_CO_RLS` phải ở `BANG_RLS_NGOAI_TENANT_KHAI`. Kèm 82⑵: mục `caller_rate_limits` ghim `= KHACH_KHONG_PHIEN_LIT` thay `LIKE` chuỗi con, và ghim cả vai lẫn lệnh. Test (`rls-coverage` 25 → 28): `docHangHardening()` giải hằng của hardening (literal `$q$…$q$`, tên hằng khác, `pg_catalog.format(…)` nối chuỗi) thành SQL và chạy CHÍNH ba câu phán xét trong test — hôm nay rỗng; với fixture trong giao dịch chúng thấy đúng những gì ba tổng điều tra S1.32 thấy (cùng `zz_rong`/`zz_ngoai`, `<bảng>_khach` mới đúng khuôn KHÔNG bị phán); ba cổng *hai bản khớp* — VALUES sinh từ `POLICY_RESTRICTIVE_DA_KHAI` phải xuất hiện NGUYÊN VĂN trong hardening; `migrate()` NÉM với fixture ngoài giao dịch cho ⑵ (`zz_rong83`: app_unseal có SELECT, policy chỉ TO app_api), ⑶ (`zz_ngoai83`), 82⑵ (`false AND …` ⇒ NÉM ở CẢ HAI lớp: mục riêng và 83⑴; `TO app_unseal` ⇒ mục riêng tự bắt), đối chứng đi qua sau khi sửa; bốn fixture con/lá-của-bảng-tenant ở `migrations.int.test.ts` (`[CR2]`, `[I6]`, `[Minor]`, `con_tt`) tách hai nửa (con không quyền riêng ⇒ đi qua, đọc thẳng 42501; cấp quyền ⇒ NÉM ở ⑵, đọc thẳng 0 hàng). Kỳ vọng lật có chủ đích ở hai test cũ: `zz_chan` (S1.32) và `[I4]` bảy RESTRICTIVE lạ trên `users` (`migrations.int.test.ts`) — `migrate()` nay NÉM ở mục ⑴, thông điệp KHÔNG có *thiếu vế* (ý gốc giữ: [CR1] không chặn RESTRICTIVE).

    ⑶ **THIẾT KẾ, VÀ CÁI GIÁ.** Phân loại theo tính chất chứ không ghim tên (lượt soi 28 NẶNG-3): một bảng
    tenant mới với `<bảng>_tenant_isolation` đúng khuôn và `<bảng>_khach` đúng khuôn 027 đi qua mà không
    cần khai ở đâu — đo trong test. Chỉ tám biến thể nới theo cột phải khai, và khai NGUYÊN VĂN
    `pg_get_expr` ở hardening: đổi phiên bản PostgreSQL có thể chặn deploy tới khi chép lại (§4 hôm nay
    chỉ nhận giá ấy ở test — nay nhận ở cả hardening, nói ra). Bản test sinh khối VALUES bằng CÙNG công
    thức và đòi nó xuất hiện nguyên văn — hai bản không trôi khỏi nhau được.

    ⑷ **ĐỎ ĐO ĐƯỢC, CÔ LẬP TỪNG MỤC (bảy đột biến, mỗi ca khôi phục bản gốc trước khi áp):** ⑴ thành no-op ⇒ đỏ ở *RESTRICTIVE chưa khai phải làm migrate() NÉM*; ⑵ no-op ⇒ đỏ ở *quyền SELECT của app_unseal không policy nào phủ*; ⑶ no-op ⇒ đỏ ở *bảng RLS ngoài tenant chưa khai*; mục `caller_rate_limits` trả về `LIKE` ⇒ `migrate()` VẪN ném (83⑴ bắt) nhưng đỏ đúng ở *thông điệp phải chứa "RLS/policy của caller_rate_limits lệch"* — hai lớp cho một ca; mục ấy bỏ vế vai/lệnh ⇒ đỏ cùng chỗ với ca `TO app_unseal`; một ký tự trong `POLICY_RESTRICTIVE_KHAI` (`rfq_id` → `rfq_idx`) ⇒ `beforeAll` `migrate()` NÉM *rfq_items_khach không thuộc lớp nào* — cả tệp đỏ; khuôn (b1) bất khả (`polcmd = 'x'`) ⇒ 21 policy chuẩn bị phán, cả tệp đỏ. Và một bài học vận hành đo được: bản chụp hardening dùng cho đột biến bị nhiễm ca `rfq_idx` (một lần `luu` chạy sau khi khôi phục hụt), hai ca chạy trên bản nhiễm cho kết quả vô nghĩa — cổng *hai bản khớp* bắt ngay khi chạy trọn tệp; bản chụp và tệp làm việc được hoàn nguyên, hai ca chạy lại.

    ⑸ **LƯỢT SOI ĐỐI KHÁNG 29 — MỘT CAO, MỘT NẶNG, NĂM NHẸ, BỐN INFO; cả 11 xử lý trong vòng, mọi câu *cần đo* đã đo.** ⒜ CAO: chiều ngược *khai mà CSDL không có* chạy vô điều kiện, khác hai mục tiền lệ neo `to_regclass(...) IS NOT NULL` — trên tập migration RÚT GỌN của `migrations.int.test.ts` (tới 003…) hardening kêu về 027/042 chưa có. Đo trước khi người soi về: 13 test đỏ; sửa: chiều ngược chỉ khi BẢNG tồn tại — 94/94. ⒝ NẶNG: vế miễn con-của-bảng-tenant ở ⑵ không bảo vệ gì ngoài ba — hoá ra bốn — fixture — đọc/ghi qua cha không cần quyền trên con, nên một GRANT trực tiếp lên con không policy chỉ có nghĩa cho truy cập THẲNG con: đúng ca 0-hàng-không-lỗi của hàng 6; lý do *fail-closed là thiết kế* viết cho câu hỏi RÒ (mục A), không cho câu hỏi IM LẶNG. Sửa: bỏ vế miễn; bốn fixture (`[CR2]` lá phân mảnh, `[I6]` lá ATTACH sau deploy, `[Minor]` `khac.con_khac`, `con_tt`) tách hai nửa — con KHÔNG quyền riêng ⇒ `migrate()` đi qua và đọc thẳng ồn ào (42501); cấp quyền lên con ⇒ NÉM ở ⑵ và đọc thẳng là 0 hàng (đo). ⒞ NHẸ: (b1) so `=` nên `_khach` thiếu một vế ra NULL và bị nhận nhầm — đòi hai vế `IS NOT NULL`, ca `WITH CHECK`-only vào test; ⑵ chỉ hai vai — thêm hai role đăng nhập và tư cách thành viên (`pg_has_role … 'USAGE'`); cổng *hai bản khớp* so văn bản THÔ cả tệp — chuyển sang so với chính hằng qua bộ giải; chú thích *[CR1] khoá vai* sai — [CR1] không khoá vai/lệnh, thứ bắt `ALTER POLICY … TO app_unseal` trên `users` là ⑵ (đo, thêm ca); mục `caller_rate_limits` không ghim vai/lệnh — thêm, ca `TO app_unseal` vào test và đột biến. ⒟ INFO: ⑴ quét cả policy trơ trên bảng chưa bật RLS — giữ mã, sửa lời; cháu hai bậc ở schema khác của một con INHERITS không vào `VI_TU_CAN_CO_RLS` — lỗ RÒ ngoài 83, mở **khoản nợ 84**; literal nhiều dòng phải khớp byte `pg_get_expr` — chú thích; bộ giải hằng không rỗng ruột với ba câu hôm nay, thêm đối chứng `NEO_003` phải NÉM.

    **Số đo:** `rls-coverage` 25 → **28 test**; `migrations.int.test.ts` 94/94 (bốn fixture đổi kỳ vọng) — evidence vitest thoát mã 0, 1510 khẳng định, 56/56; hardening: bốn hằng khai +
    ba câu phán xét + ba mục + một vế ghim đổi; ADR-036 hàng 5, 6, 7 có lớp sản xuất. Sổ nợ: **84 khoản, 16
    còn mở** — 83 còn ⑷–⑻, 82 còn ⑴, và 84 mở (lượt soi 29 INFO-9: cháu hai bậc của bảng tenant ở schema
    khác ngoài `VI_TU_CAN_CO_RLS` — lỗ rò, ngoài 83); mười hai có hình dạng mã nguồn [S1.42 bổ].

54. **[2026-09-10] S1.39 — KHOẢN 83 ĐÓNG TRỌN: NĂM MỤC PHÁN XÉT NỬA CATALOG CHO ADR-036 HÀNG 10, 21, 3
    (TỔNG QUÁT), 2/75, VÀ TIỀN ĐỀ SUSET CỦA HÀNG 8. MÃ SẢN XUẤT.** Tám mục của khoản 83 nay đủ: mọi cơ
    chế ADR-036 mà chủ bảng thường tạo được và catalog phân biệt được đều có mục hardening — tiêu chí §3⑶
    ~~(S1.37) được thực hiện trọn, không còn cơ chế nào "chỉ ở test" trừ 1, 15, 17–19 (nhân chứng)~~ **[S1.42, lượt soi 31 INFO-6 / 33b #4]** khi ấy hàng 22 còn ở khoản 82 (đóng S1.40) và cửa sổ tạo-và-tách ở khoản 85 (đóng S1.41); câu "trọn" đúng từ S1.41.

    ⑴ **ĐO TRƯỚC KHI VIẾT** (S1.37 đã đo, chép chỗ chịu lực): chủ bảng thường tạo được view/matview/bảng
    phân mảnh, gắn được trigger gọi hàm built-in `suppress_redundant_updates_trigger`, cài được extension
    tin cậy `tcn`, tạo được RULE `DO INSTEAD NOTHING` trên `sessions`; `migrate()` đi qua tất cả. Trong
    vòng: bản hardening mới trên CSDL sạch đi qua (0 vi phạm); trên tệp H19 đúng hai test đỏ — `zz_rule`
    và `zz_cau` — cả hai là kỳ vọng cũ *migrate() OK* của khoản 73/75 mà ADR-036 §3⑶ đã bác; `migrations.int.test.ts` 94/94 với năm mục mới — không fixture nào của kho (view, rule trên bảng sổ, trigger, phân mảnh) bị phán sai; `rls-coverage` 28/28 với module chung.

    ⑵ **LỚP.** Lớp ở `hardening.always.sql`, năm mục PHÁN XÉT sau ba mục nửa RLS (cộng một mục TỰ CHỮA — RESET `session_replication_role` mức database, lượt soi 30 NHẸ-4 — **[S1.42, 33b #3]** đếm cơ khí: sáu ARRAY, không phải năm): ⑷ `CAU_QUAN_HE_KHAC_SAI` — bảng ngoài, matview, và view CÓ trigger INSTEAD OF trong `MAU_SCHEMA_DU_AN` phải khai ở `QUAN_HE_KHAC_KHAI` (rỗng); view trơn (kể cả `security_invoker` của [I2]) và bảng phân mảnh cố ý không bị phán — DML qua view trơn đi thẳng bảng gốc, lá phân mảnh do H19 canh; ⑸ `CAU_TRIGGER_NGOAI_PLPGSQL_SAI` — trigger không nội bộ gọi hàm `lanname <> 'plpgsql'` phải khai ở `TRIGGER_NGOAI_PLPGSQL_KHAI` (rỗng); ⑹ `CAU_RULE_SAI` — rule ngoài `_RETURN` trên MỌI quan hệ của dự án phải khai ở `RULE_KHAI` (rỗng) — hàng 3 tổng quát, không chỉ bảng sổ/bảng chỉ-ghi-thêm suy ra; ⑺ `CAU_HAM_CANH_HINH_THUC_SAI` — trigger của hàm canh (hình dạng ∪ khai tên) có bit INSERT/UPDATE/DELETE mà không phải BEFORE … FOR EACH ROW ⇒ NÉM (trigger TRUNCATE của hàm canh là chốt, hợp lệ); ⑧ `CAU_PARAMETER_ACL_SAI` — `pg_parameter_acl` cấp cho PUBLIC hay bốn vai ứng dụng ⇒ NÉM, không danh sách khai. Chiều ngược của ⑷⑸⑹ chỉ khi đối tượng cha tồn tại (bài học lượt soi 29). Bộ giải hằng tách thành `db/hardening-hang.ts` (`docHangHardening`, `khoiValues`) dùng chung cho hai tệp test. Test (`[INV-H19]` 25 → 28): cổng *hai bản khớp* cho ba danh sách qua bộ giải; năm câu phán xét của hardening chạy trong test — hôm nay rỗng; fixture trong giao dịch: view `security_invoker` và bảng phân mảnh KHÔNG bị phán, view INSTEAD OF / matview / bảng ngoài (`file_fdw`) bị; `suppress_redundant_updates_trigger`; rule trên `sessions`; hàm canh AFTER ROW và cấp câu lệnh bị, trigger TRUNCATE và BEFORE INSERT ROW của nó không; `GRANT SET … TO app_api` và `GRANT ALTER SYSTEM … TO PUBLIC`; `migrate()` NÉM ngoài giao dịch cho ⑷⑸⑧ với đối chứng; hai kỳ vọng cũ lật có chủ đích: `zz_rule` (khoản 73) và `zz_cau` (khoản 75) nay NÉM ở ⑹/⑺.

    ⑶ **RANH GIỚI NÓI RA.** ⑷ cố ý hẹp hơn census `LOAI_DA_KHAI` ở test (vốn đếm cả view trơn và bảng phân
    mảnh): view không có trigger INSTEAD OF không phải cơ chế 0-hàng — DML đi thẳng bảng gốc dưới RLS của
    người gọi (view `security_invoker` hợp lệ của [I2] đi qua; view `security_definer` trên bảng tenant do
    [I2] bắt — câu hỏi RÒ); bảng phân mảnh là khuôn PostgreSQL chuẩn mà H19 canh từng lá. ⑥ chồng lên vế
    rule của `CAU_CHI_GHI_THEM_VAT_LY` (bảng chỉ-ghi-thêm suy ra) và mục tự gỡ rule bảng sổ — cố ý: hai
    lớp cho một ca đã có, một lớp cho mọi bảng khác. ⑺ chồng lên `CAU_TRIGGER_CANH_CO_DIEU_KIEN` (S1.36)
    ở tập hàm — cùng vị từ hàm canh, khác cột (`tgtype` thay `tgqual`/`tgattr`/`tgenabled`): bốn cột của
    `pg_trigger` mà một trigger canh có thể "giữ tên hàm mà không canh" nay đều có mục.

    ⑷ **ĐỎ ĐO ĐƯỢC, CÔ LẬP TỪNG MỤC (năm đột biến, mỗi ca khôi phục bản gốc trước khi áp):** ⑷ thành no-op ⇒ đỏ ở *migrate() NÉM* của ca view có INSTEAD OF; ⑸ no-op ⇒ đỏ ở ca trigger `suppress_redundant_updates_trigger`; ⑹ no-op ⇒ đỏ ở test `zz_rule` (khoản 73, kỳ vọng lật); ⑺ no-op ⇒ đỏ ở test `zz_cau` (khoản 75, kỳ vọng lật); ⑧ no-op ⇒ đỏ ở ca `GRANT SET ON PARAMETER … TO app_api`. Mỗi ca đỏ đúng một khẳng định `toMatch(/^NÉM/)`, các khẳng định trước nó vẫn xanh.

    ⑸ **LƯỢT SOI ĐỐI KHÁNG 30 — KHÔNG CAO, KHÔNG NẶNG; SÁU NHẸ, BẢY INFO; mười xử lý trong vòng, ba ghi nhận.** Người soi không tìm được đường lách nào bằng đọc cho ⑷⑸⑹⑺⑧ trong phạm vi §3⑶; các phát hiện là trôi tiềm ẩn, nhãn sai, thứ cần đo. ⒜ NHẸ, sửa: chiều ngược ⑷ không neo vào "cha" tồn tại (schema) — cùng lớp lượt 29 CAO-1, tiềm ẩn vì danh sách rỗng — thêm `EXISTS pg_namespace`; vị từ hàm canh chép nguyên văn lần hai cho ⑺ — tách `VI_TU_HAM_CANH_HINH_DANG` dùng chung với mục S1.36, test đòi cả hai mục tham chiếu và danh sách tên bằng `HAM_CANH_CHI_GHI_THEM`; ⑧ ghim bốn tên vai lần hai và đọc ACL thô nên không thấy quyền qua nhóm (BƯỚC 1 che, không nói ra) — nay `VAI_KET_NOI_UNG_DUNG` + `pg_has_role` bắc cầu trên grantee (bản đầu sửa bằng `has_parameter_privilege` gắn vào từng dòng ACL kê cả dòng của người cấp — đo, đổi); `ALTER DATABASE … SET session_replication_role` (superuser) sống qua `migrate()` trong khi ⑧ tuyên bố đóng tiền đề SUSET — thêm mục thứ ba `pg_db_role_setting` RESET, tự chữa, đo; `to_regclass` nối chuỗi không quote — tên chữ hoa bị phán *thiu* vĩnh viễn — `format('%I.%I')` ở sáu chỗ kể cả hai chỗ S1.38; chưa có đối chứng dương cho ⑹⑺ — thêm (gỡ rule/trigger ⇒ đi qua; bản đầu của đối chứng ⑺ dựng lại BEFORE ROW làm bảng thành chỉ-ghi-thêm thiếu chốt — đo, đổi thành DROP). ⒝ INFO, sửa: nhãn ⑷ gọi matview là *đích DML* và gọi view có trigger cấp câu lệnh là *INSTEAD OF* — tách nhánh; nhãn ⑺ gọi INSTEAD OF là *AFTER* — thêm nhánh; thông điệp ⑺ không nói chốt TRUNCATE hợp lệ — thêm; fixture bảng ngoài tựa `file_fdw` — guard nêu tên. ⒞ Ghi nhận, không sửa: bộ giải hằng cắt ở `)` đầu (đã nói ở lượt 29); cổng ⑷ tách tên bằng `.` (danh sách rỗng); fixture [Task 6] constraint trigger AFTER DELETE của `chan_sua_xoa` — ⑺ thấy hình dạng ấy nhưng D2 dựng lại ở lượt sửa trước khi ⑺ đọc (chạy trọn `migrations.int.test.ts`: 94/94 — đúng như người soi suy). Khớp: `_RETURN` kín hai chiều; view trơn không updatable ném 55000; mặt nạ bit đúng bốn góc; `LANGUAGE sql` không viết được hàm trigger; hàm C kiểm `CALLED_AS_TRIGGER`; lược đồ thật của kho không có view/rule/bảng ngoài/`GRANT ON PARAMETER`, mọi `FOR EACH STATEMENT` là TRUNCATE, mọi AFTER có RETURN.

    **Số đo:** `[INV-H19]` 25 → **28 test**; `rls-coverage` 28/28 với module chung; hardening: ba hằng
    khai + năm câu phán xét + năm mục; module mới `db/hardening-hang.ts`; ADR-036 hàng 10, 21 đóng, hàng 2,
    3, 8 thêm lớp. Sổ nợ **84 khoản, 15 còn mở** — đóng 83; mười một có hình dạng mã nguồn.

55. **[2026-09-10] S1.40 — KHOẢN 84 VÀ 82⑴ ĐÓNG TRÊN `pg_inherits`: `LA_CUA_BANG_TENANT` ĐỆ QUY (LỖ RÒ
    CHÁU HAI BẬC NGOÀI `public`) VÀ MỤC PHÁN XÉT KẾ THỪA CỔ ĐIỂN CHO ADR-036 HÀNG 22. MÃ SẢN XUẤT. KHOẢN 85 MỞ.**
    Vòng nhỏ, một tệp hardening, hai cơ chế cùng bảng catalog.

    ⑴ **ĐO TRƯỚC KHI VIẾT.** Khoản 84: người soi 29 viết đường đo, chưa ai chạy — chạy: `k.c2 INHERITS k.c1
    INHERITS public.bao_gia`, `GRANT SELECT ON k.c2 TO app_api` ⇒ `migrate()` không bật RLS trên `k.c2`, app_api
    gắn tổ chức A đọc thẳng cháu thấy hàng 777 của tổ chức B — lỗ RÒ thật, không phải 0-hàng. Khoản 82⑴: đo
    lại hàng 22 tại chỗ — UPDATE qua cha 1 hàng, sau `NO INHERIT` 0 hàng không lỗi, cặp biến khỏi catalog.
    Trong vòng: bản hardening mới trên CSDL sạch đi qua; `migrations.int.test.ts` 95/95 — đúng hai fixture
    INHERITS cũ lật kỳ vọng (cố ý), không fixture phân mảnh nào ([CR2], [I6], `so_pm`, `kho.audit_events`) bị
    phán; H19 30/30; `rls-coverage` 28/28. Một lần `rls-coverage` đỏ do hết hạn 30 s khi ba tiến trình vitest
    chạy chung máy — đo thẳng `migrate()` trên ba bản hardening (hiện tại / một bậc / tắt mục kế thừa): ≈ 600 ms
    cả ba, không hồi quy; chạy đơn 28/28. Evidence lần đầu trên cây cuối: cổng 56/56 nhưng vitest thoát mã 1 — đúng test
    ấy hết hạn 30 s (30014 ms) dưới tải song song; trong lượt chạy đơn có tải, MỌI test của tệp chậm 3–4 lần kể cả
    test S1.32 không gọi `migrate()` (657 → 2553 ms) — tải máy, không phải hardening. Sửa đúng chỗ: test ĐO ấy gọi
    `migrate()` sáu lần mà dùng hạn mặc định, nay 180 s như các test ĐO cùng loại ở H19; evidence chạy lại trên HEAD.

    ⑵ **LỚP.** Khoản 84: `LA_CUA_BANG_TENANT` thành bao đóng bắc cầu của `pg_inherits` (`WITH RECURSIVE` không
    tương quan, lọc theo `c.oid` sau) — một tổ tiên bất kỳ là bảng tenant ở public thì bảng này là con cháu; áp
    cho mục (A) (bật ENABLE+FORCE) và [CR1] (miễn policy riêng). Khoản 82⑴: mục PHÁN XÉT thứ sáu sau tám mục của
    khoản 83 — `CAU_KE_THUA_SAI`: mọi cặp `pg_inherits` KHÔNG phân mảnh (`NOT relispartition` — loại cả lá lẫn chỉ
    mục phân mảnh) có con trong `MAU_SCHEMA_DU_AN` phải khai ở `KE_THUA_KHAI` (rỗng — dự án không dùng INHERITS);
    chiều ngược khi CẢ HAI bảng còn, đối xứng `relispartition`. Cùng khuôn 83⑧: canh TIỀN ĐỀ, vì sau cú tách
    catalog không còn dấu vết. Test (`[INV-H19]` 28 → 30): `KE_THUA_DA_KHAI` + cổng hai bản khớp qua bộ giải
    (bốn danh sách, sáu câu); census chạy trong test — rỗng hôm nay; fixture trong giao dịch: cặp INHERITS thấy,
    lá và chỉ mục phân mảnh không; giả lập dòng khai bằng `replaceAll` khối VALUES ở cả hai chiều; NO INHERIT ⇒
    1 → 0 hàng, chiều xuôi im, chiều ngược bắt cặp đã khai; `migrate()` NÉM ngoài giao dịch, NO INHERIT ⇒ đi qua.
    `migrations.int.test.ts` (94 → 95): test khoản 84 hai bậc (đo cả lỗ trước và fail-closed sau; `public.g
    INHERITS (k.c1)` là ca chịu lực của vế đệ quy ở nguồn (i) của [CR1]); `con_khac` và `con_tt` lật sang NÉM ở
    82⑴ — [CR1] không kêu về `con_tt`, tức miễn policy riêng còn nguyên; `con_tt` DROP trước nửa DETACH.

    ⑶ **RANH GIỚI NÓI RA.** 82⑴ canh tiền đề, không canh cú tách: cặp CHƯA KHAI bị tách thì mục im — lớp cho
    ca ấy là chính việc cặp chưa khai đã chặn deploy từ trước. Khai theo TÊN chỉ đóng băng lời khai (lượt soi 31
    NHẸ-1): cặp đã khai bị tách rồi tái dùng tên thì cả hai chiều im — kẽ ngủ chừng nào `KE_THUA_KHAI` rỗng, và
    một dòng khai INHERITS là quyết định an ninh cùng hạng `NGOAI_LE_HINH_DANG`. DETACH PARTITION là cùng cơ chế
    hàng 22 ở vị trí khác, ba tầng: lá public ⇒ [CR1]; lá ngoài public đã RLS ⇒ 83⑶; tạo-và-tách giữa hai deploy
    ⇒ bậc tự do. Bảng TẠM kế thừa bảng thật là của riêng phiên — PostgreSQL loại bảng tạm của phiên khác khỏi
    khai triển kế thừa (đo: superuser và app_api đọc qua cha không thấy) — nên loại `pg_temp` khỏi cả vế đệ quy
    của mục (A) lẫn 82⑴ (bản đầu: mục (A) ALTER bảng tạm phiên khác ⇒ 0A000 bị BƯỚC 2 nuốt ⇒ phán sai; đo);
    `MAU_SCHEMA_DU_AN` dời lên trước `VI_TU_CAN_CO_RLS`. Câu "S1.39 thực hiện trọn §3⑶" nói khi 82 còn mở —
    hàng 22 đã được §3⑶ đặt ở khoản 82, và cái phân biệt được ở đó là tiền đề, không phải cơ chế. Ba kẽ (31
    NHẸ-1, NHẸ-3, nửa NHẸ-4) cùng đổ về bậc tự do "bảng `org_id` ngoài public không treo dưới tenant" ⇒ **khoản
    85** mở thay vì tiếp tục "nói ra".

    ⑷ **ĐỎ ĐO ĐƯỢC, CÔ LẬP TỪNG MỤC (ba đột biến, mỗi ca khôi phục bản gốc trước khi áp; chạy lại trên cây sau
    bản vá lượt soi 31):** m1 `LA_CUA_BANG_TENANT` về một bậc ⇒ đỏ ở *cờ RLS của cháu k.c2* (`{false,false}`);
    tắt hai khẳng định đứng trước ⇒ đỏ ở *`g: không có policy PERMISSIVE`* — vế đệ quy ở nguồn (i) có bằng chứng
    thật; m2 chiều xuôi 82⑴ no-op ⇒ đỏ ở census (cặp không thấy), ở *migrate() NÉM* (`OK`), và ở cả hai fixture
    lật; m3 chiều ngược no-op ⇒ đỏ đúng ở *cặp đã khai mà bị tách*. Mỗi ca đỏ đúng khẳng định mong đợi, các
    khẳng định trước nó xanh.

    ⑸ **LƯỢT SOI ĐỐI KHÁNG 31 — KHÔNG CAO, KHÔNG NẶNG; BỐN NHẸ, SÁU INFO; cộng một phát hiện tự tìm bằng đo.**
    Người soi không tìm được đường lách bằng đọc cho cả hai khoản trong phạm vi §3⑶; bốn NHẸ là ba kẽ về cùng
    một bậc tự do cộng một ca bảng tạm cần đo. ⒜ NHẸ, xử lý: tái dùng tên trên cặp đã khai — sửa lời "dấu vết
    duy nhất", ghi khoản 85; ba khẳng định `not.toContain` [CR1] trên fixture ngoài public là rỗng ruột ([CR1]
    lọc `nspname = 'public'`) — bỏ, thay bằng ca chịu lực `public.g INHERITS (k.c1)` và ghi rõ bằng chứng là
    `con_tt`; lời biện minh DETACH chỉ đúng cho lá public — ba tầng; bảng tạm kế thừa bảng tenant — đo, lọc
    `pg_temp` ở hai chỗ, đo lại đi qua. ⒝ INFO: đột biến cho vế đệ quy — chạy (m1); "hụt đúng một hàng" nghiêng —
    sửa lời; chiều ngược không đối xứng `relispartition` — thêm; cổng hai bản tách bằng `.`/` INHERITS ` — ghi
    nhận; docs theo diff — vòng này; test ĐO dùng CSDL chung — không sửa. ⒞ Tự tìm: một test `rls-coverage` hết
    hạn 30 s khi ba tiến trình chạy chung — nghi hồi quy hiệu năng của CTE đệ quy; đo thẳng `migrate()` ba bản
    ≈ 600 ms — không phải; ghi để lần sau đo trước khi đoán. Bảng đủ ở `evidence/security-reviews.md` §S1.40.

    **Số đo:** `[INV-H19]` 28 → **30 test**; `migrations.int.test.ts` 94 → **95**; `rls-coverage` 28/28;
    hardening: `LA_CUA_BANG_TENANT` đệ quy, `VI_TU_CAN_CO_RLS` lọc `pg_temp`, `MAU_SCHEMA_DU_AN` dời lên, một
    hằng khai + một câu phán xét + một mục; t0 209 module / 0 vi phạm; ADR-036 hàng 22 có lớp. Sổ nợ **85
    khoản, 14 còn mở** — đóng 82 (trọn) và 84, mở 85; mười có hình dạng mã nguồn.

56. **[2026-09-10] S1.41 — KHOẢN 85 ĐÓNG: BẬC TỰ DO "BẢNG CÓ `org_id` NGOÀI `public` KHÔNG TREO DƯỚI BẢNG
    TENANT" THÀNH MỘT MỤC PHÁN XÉT. MÃ SẢN XUẤT. KHOẢN 86 MỞ (RANH GIỚI THEO TÊN CỘT).**

    ⑴ **ĐO TRƯỚC KHI VIẾT.** Bảng `zz_s85.t (gia, org_id)` ngoài public, `GRANT USAGE/SELECT` cho app_api: app_api
    gắn tổ chức A đọc thẳng thấy hàng 777 của B — không mục nào chạm (không pg_inherits, không RLS, ngoài
    public). Ba kẽ của lượt soi 31 đo trên hai đường thời gian: con INHERITS bị NO INHERIT và lá phân mảnh bị
    DETACH *trước* khi `migrate()` nào chạm ⇒ không RLS, rò; *sau* khi (A) đã bật RLS ⇒ là bảng RLS ngoài tenant.
    Trong vòng: bản hardening mới trên CSDL sạch đi qua; lược đồ thật không có bảng `org_id` ngoài public (census
    rỗng); `migrations.int.test.ts` 96/96 — đúng ba fixture cũ lật kỳ vọng (cùng hình dạng 85: `kho.cha` +
    `kho.audit_events`, `bao_cao.audit_events`); H19 30/30; `rls-coverage` 30/30; identity `doc.*` không gọi
    `migrate()` sau khi dựng — không bị.

    ⑵ **LỚP.** `CAU_ORG_ID_NGOAI_PUBLIC_SAI` + `BANG_ORG_ID_NGOAI_PUBLIC_KHAI` (rỗng): bảng (r/p) trong
    `MAU_SCHEMA_DU_AN`, có cột `org_id`, KHÔNG thuộc `VI_TU_CAN_CO_RLS`, KHÔNG bật RLS ⇒ phải khai; chiều ngược
    khi bảng còn mà không còn hình dạng ấy, chắn sentinel. Cố ý KHÔNG nới `VI_TU_BANG_TENANT` — đổi định nghĩa
    "bảng tenant" kéo theo nguồn (i)/(ii) và mục (C); mục này chỉ bắt hình dạng phải KHAI, đủ đóng ba kẽ. Bật RLS
    lên bảng ấy thì mục im và 83⑶ đòi khai: hai mục kề nhau phủ kín (`NOT relrowsecurity` / `relrowsecurity`), không
    chồng. Hình dạng là MỘT hằng `VI_TU_HINH_DANG_85` (hai chiều cùng tham chiếu); vế "có cột org_id" tách thành
    `MAU_VI_TU_CO_ORG_ID` dùng chung với `MAU_VI_TU_BANG_TENANT` — nới một nơi thì nơi kia đi theo. Test
    (`rls-coverage` 28 → 30): hai bản khớp; census trong giao dịch (bảng org_id ngoài public bị thấy; không org_id /
    bật RLS (sang 83⑶) / treo dưới tenant / lá phân mảnh thì không; NO INHERIT và DETACH làm bảng rơi vào mục; SET
    SCHEMA public và ENABLE RLS là hai cửa ra; chiều ngược qua dòng khai giả lập); ĐO lỗ rò + `migrate()` NÉM +
    biến thể RLS ⇒ 83⑶; meta-test sentinel cho cả năm danh sách khai rỗng của tệp hardening; cổng "một hằng, hai
    tham chiếu". `migrations.int.test.ts` (95 → 96): test kẽ ⑴⑵ hai đường thời gian, kể cả chuỗi RENAME + tái dùng
    tên + DISABLE RLS con cũ (lượt soi 32 INFO-5: đo, không suy).

    ⑶ **RANH GIỚI NÓI RA.** Mục chỉ nhận cột TÊN `org_id`: bảng đa tổ chức đặt tên cột khác không thuộc mục này —
    và cũng không thuộc vị từ tenant ở public; đó là ranh giới sẵn có của `MAU_VI_TU_BANG_TENANT` ở mọi schema,
    không phải bậc tự do 85 mở lại (lượt soi 32 INFO-6) ⇒ **khoản 86** có địa chỉ. Khai theo TÊN chỉ đóng băng lời
    khai (DROP rồi CREATE lại cùng tên đi qua) — mỗi dòng khai là một GRANT đọc xuyên tổ chức có điều kiện, cùng
    hạng `NGOAI_LE_HINH_DANG`. Mục phán xét ở `migrate()`: cửa sổ giữa hai lần deploy vẫn mở cho cả ba kẽ — mức
    bảo đảm là "phát hiện ở deploy kế". Treo lại bằng INHERITS thì 82⑴ đòi khai; chỉ ATTACH PARTITION là đường
    không cần khai (lượt soi 32 INFO-4 — lời sửa trong thông điệp viết theo thứ tự ấy).

    ⑷ **ĐỎ ĐO ĐƯỢC, CÔ LẬP TỪNG MỤC (hai đột biến, khôi phục bản gốc trước mỗi ca, chạy trên cây sau bản vá
    lượt 32):** chiều xuôi no-op ⇒ đỏ ở census (`zz_s.t` không thấy), ở ĐO (`migrate()` đi qua), và ở cả ba fixture
    lật; chiều ngược no-op ⇒ đỏ đúng ở *dòng khai thiu*.

    ⑸ **LƯỢT SOI ĐỐI KHÁNG 32 — KHÔNG CAO; MỘT NẶNG, HAI NHẸ, BỐN INFO.** NẶNG-1: fixture `[vòng fix 1 — IM2]`
    (`bao_cao.audit_events`) cùng hình dạng `kho.*` mà bản đầu sót — lượt chạy trọn tệp và người soi bắt cùng lúc;
    lật như `kho.*`. NHẸ-2: chiều ngược 85 không chắn sentinel `('', '')` — xanh nhờ đường soft-error của PG 16, không
    nhờ mã ⇒ chắn, và meta-test cho cả năm danh sách. NHẸ-3: vế `org_id` chép bốn bản, hình dạng 85 chép hai
    chiều ⇒ `MAU_VI_TU_CO_ORG_ID` + `VI_TU_HINH_DANG_85`, test đòi. INFO: lời sửa "treo dưới tenant" bỏ qua 82⑴
    và đặt "bật RLS + khai 83⑶" lên đầu — viết lại; chú thích nói "đo chuỗi RENAME" mà test chưa đo — thêm nửa (d);
    ranh giới theo tên cột phải có địa chỉ — khoản 86; câu "dòng khai là quyết định an ninh" chưa có ở danh sách mới
    — thêm. Bảng đủ ở `evidence/security-reviews.md` §S1.41.

    **Số đo:** `rls-coverage` 28 → **30**; `migrations.int.test.ts` 95 → **96**; H19 30/30; hardening: hai hằng
    dùng chung + một hằng khai + một câu phán xét + một mục; t0 209 module / 0 vi phạm. Sổ nợ **86 khoản, 14 còn
    mở** — đóng 85, mở 86; mười có hình dạng mã nguồn.

57. **[2026-09-10] S1.42 — LƯỢT SOI NGANG 33 TRÊN BẢY VÒNG ĐÃ HỢP NHẤT (S1.35–S1.41): BA KHOẢN NỢ MỚI
    87–89, HAI NẶNG TÀI LIỆU SỬA TẠI CHỖ, LỜI "(ĐO)" CỦA S1.40 THÀNH TEST THẬT. 0 MÃ SẢN XUẤT.** Lượt ngang
    đầu (25, S1.35) tự dặn "sau mỗi năm-sáu vòng"; lượt này chạy ở vòng thứ bảy, cùng hình thức: hai người soi
    độc lập, không shell, không đọc nhau — **33a** đặt mười bốn mục mới cạnh các lớp cũ (13 mục), **33b** soi
    lời khai vs mã và con số vs con số trên diff `0b1d41c..3811d37` (19 mục). Ba phát hiện đo được của 33a
    được đo lại trên PostgreSQL 16 sạch (bản nháp `db/zz-do-soi33.int.test.ts`, đã xoá, kết quả ở biên bản
    lượt soi). Như S1.35, vòng này KHÔNG đổi lớp nào: phát hiện mã đi vào sổ nợ, phát hiện sổ sách và test
    sửa tại chỗ.

    ⑴ **ĐIỀU BẢY LƯỢT SOI DỌC KHÔNG THẤY (33a).** ⒜ Bảy vòng đóng mười bốn cơ chế ở tầng CATALOG BẢNG,
    trong khi ranh giới thật của dự án đã dời sang tầng GUC `app.*` từ 027/042/044 — ba mục GUC mức
    database vẫn là ba cái TÊN viết ở vòng fix 5. Mức CAO người soi đặt bị **đo hạ**: chủ database không
    superuser bị 42501 khi `ALTER DATABASE … SET app.org_id` (PostgreSQL 16) ⇒ vế ⒞ của §3⑶; phần còn
    lại (mục theo tính chất, `withTenant` đặt lại GUC khách) — **khoản 87**. ⒝ Bài học "ghim tính chất thay
    vì tên vai" đã áp cho ⑧ nhưng chưa quay lại 83⑵ một vòng trước nó: bản chép thứ ba của bốn tên vai —
    **khoản 88** (kèm mọi việc "khi mở tệp hardening"). ⒞ Bài học "khai theo tên chỉ đóng băng lời khai"
    (lượt 31) chưa áp ngược cho danh sách tên CŨ NHẤT của tệp: `BANG_CHI_GHI_THEM`. **Đo:** đổi tên bảng sổ,
    gỡ bốn trigger, dựng bảng cùng tên cùng hình dạng, policy đúng khuôn, xoá policy sót ⇒ `migrate()` đi
    qua, D2 dựng sáu trigger lên bảng mới rỗng, lịch sử ở bảng cũ không mục nào canh — **khoản 89**. ⒟
    Khoản 86 có số: đổi tên cột `org_id` + tắt RLS + xoá hai policy trên `users` ⇒ `migrate()` đi qua, app_api
    gắn A đọc thấy B. Hai phép đo ⒞⒟ là một bài học thứ năm: *danh tính neo theo tên/hình dạng đều tái tạo
    được, chỉ `oid` là không*.

    ⑵ **PHÉP ĐO BÁC VÀ LÀM RÕ.** 33a #1 bác ở mức (42501). 33a #5 và #6 bản đầu (không xoá policy sót) đều bị
    **83⑴** bắt — nhưng bắt nhờ một danh sách khai theo tên khác, không nhờ danh tính đối tượng; thêm một
    `DROP POLICY` là đi qua. Ghi cả ba vào ADR-036 §5.

    ⑶ **HAI NẶNG TÀI LIỆU CỦA 33b, SỬA TẠI CHỖ.** ⒜ Sổ đăng ký F1 (TEST-PLAN, và ma trận sinh từ nó) khai
    *"phủ lệnh (miễn con của bảng tenant)"* — vế miễn đã bị lượt soi 29 NẶNG-2 bỏ trước khi S1.38 hợp nhất;
    câu sai sống bốn vòng qua ba lượt soi dọc vì không lượt nào đọc diff TEST-PLAN — gạch, tái sinh ma trận.
    ⒝ Lời *"(đo)"* về bộ lọc `pg_temp` (S1.40) đứng ở sáu tài liệu mà kho không tái lập được: không test nào
    dựng `CREATE TEMP TABLE … INHERITS`, ba đột biến của S1.40 không chạm bộ lọc — nay là test thật ở
    `migrations.int.test.ts` (phiên khác và app_api không thấy hàng của bảng tạm qua cha; `migrate()` đi qua,
    không phán bảng tạm) và **hai đột biến ĐO** (bỏ lọc ở vế con cháu ⇒ (A) phán `pg_temp_N.zz_tam`; bỏ ở
    82⑴ ⇒ cặp `pg_temp` chưa khai) — đỏ cả hai. Và văn bản thiu gạch tại chỗ: câu *"§3⑶ thực hiện trọn"*
    ở biên bản 54 và ADR-036 §5 (lượt 31 INFO-6 chỉ ra, S1.40 viết thêm mà không gạch); ADR-036 hàng 9
    (lớp sản xuất S1.36), hàng 21 (*CHỈ Ở TEST*), hàng 22 (*⇒ khoản 85* ×2), §4 (*bốn danh sách khai* → tám,
    giá deparse nay ở hardening), §3⑶ (hàng 11 ngoài ba vế); sổ nợ 79 (*CHỈ Ở TEST*), 82/83/84 (tiền đề đã
    đóng chưa gạch); biên bản 53 (thiếu vế hình dạng mã) và 51/53/54 (tiêu đề ⑷ lặp); TEST-PLAN đoạn giới hạn
    H19; STATE §Tham chiếu mô tả `security-reviews.md`; chú thích *CHỈ Ở TEST* ở test H19; Handoff ghi nhịp
    lượt ngang; đếm mục S1.39: sáu ARRAY (năm phán xét + một tự chữa), không phải năm.

    ⑷ **TEST SỬA THEO 33a/33b (không đổi phép đo, chỉ thêm).** Fixture `ALTER DATABASE … SET
    session_replication_role` trên CSDL chung của H19 vào `try/finally` (33a #4 — cùng khuôn 25b NẶNG-1 ở
    trục GUC); đối chứng DƯƠNG cho khẳng định phủ định duy nhất còn chịu lực của "miễn policy riêng"
    (`zz_doc` ở public không policy ⇒ [CR1] kêu, `con_tt` không — 33a #7); hai dòng đo HÀNH VI đứng trước
    hình dạng: UPDATE qua view INSTEAD OF ⇒ 0 hàng, app_api đặt được `replica` sau GRANT và 42501 sau
    REVOKE (33a #12); meta-test sentinel quét MỌI hằng `*_KHAI` thay vì ghim năm tên (33a #9); hai tiêu đề
    test rộng hơn phép đo (33b #15).

    ⑸ **LƯỢT SOI 33 — 33a: 1 CAO (đo hạ), 1 NẶNG, 5 NHẸ, 6 INFO; 33b: 2 NẶNG, 11 NHẸ, 6 INFO.** Bảng đủ ở
    `evidence/security-reviews.md`. Điều đáng mang sang: *"(đo)"* phải có địa chỉ test hoặc tự khai là nháp;
    lượt soi dọc phải nhận diff TEST-PLAN/INV-matrix như diff mã; con số "N mục" đếm cơ khí; bài học không
    tự quay lại mục TRƯỚC; và câu hỏi ngang kế — *mọi thứ policy/hàm ghim ĐỌC VÀO là gì, ai đặt được
    trước khi phiên bắt đầu*.

    **Số đo:** `migrations.int.test.ts` 96 → **97**; `rls-coverage` 30/30; `[INV-H19]` 30/30; t0 209 module /
    0 vi phạm; hardening không đổi một dòng. Sổ nợ **89 khoản, 17 còn mở** — mở 87, 88, 89; mười ba có hình
    dạng mã nguồn.

58. **[2026-09-10] S1.43 — KHOẢN 89 ĐÓNG, KHOẢN 86 ĐÓNG NỬA ĐO ĐƯỢC: DANH TÍNH ĐỐI TƯỢNG CANH LÀ BA KÊNH (ADR-037),
    KHÔNG PHẢI TÊN HAY HÌNH DẠNG. MÃ SẢN XUẤT. BỐN BẢN, HAI LƯỢT SOI, MỘT LẦN BỘ TEST BÁC TRƯỚC NGƯỜI SOI.**

    ⑴ **ĐO TRƯỚC KHI VIẾT.** Hai kịch bản của lượt soi ngang 33 (đổi tên sổ + dựng lại cùng tên + xoá policy sót;
    đổi tên cột `org_id` + tắt RLS + xoá policy) đi qua `migrate()` trên PostgreSQL 16 sạch — chép vào chỗ chịu lực.
    Trong vòng: bản đầu (bảng `app_private.neo_danh_tinh` + migration 049, đúng như sổ nợ 89 tự đề ra) làm **12 test
    đỏ** ở lượt chạy trọn tệp — toàn bộ là hồ sơ N2 (bootstrap superuser, vai deploy không superuser, không GRANT
    thêm): `to_regclass('app_private.…')` ở cột điều kiện ném 42501 vì vai deploy không có USAGE trên `app_private`,
    cả lượt sửa gãy TRƯỚC vòng migration đánh số — đúng ngõ cụt QT1 mà 003 từng đo với `to_regprocedure`. Bộ test bác
    bản đầu trước cả người soi. Lượt soi 34 (trên bản đầu) bác tiếp ba điều mà sửa quyền cũng không đóng: bảng neo do
    chính chủ thể bị canh sở hữu (DROP nó là mục im); khôi phục logic cấp oid mới cho mọi bảng đúng lúc DR; tự gỡ
    dòng tenant không đơn điệu và mở đường CHÉP bảng (`CREATE TABLE users_moi AS SELECT … org_id AS to_chuc …; DROP;
    RENAME` — dữ liệu không mất). Bản hai (chú thích bảng) đóng ba lỗi ấy nhưng vẫn hở đường chép; bản ba thêm tên
    đã khai; bản bốn theo lượt soi 35.

    ⑵ **LỚP (ADR-037).** Ba kênh, mỗi kênh chịu một đường: ① chú thích bảng `neo: <schema>.<bảng> org_id#<attnum>`
    — danh tính theo oid của bảng VÀ attnum của cột `org_id`, sống qua RENAME/SET SCHEMA/RENAME COLUMN, mất khi DROP,
    `LIKE … INCLUDING ALL` không chép, `pg_dump` chép theo bảng; lượt sửa ghi khi bảng chưa có chú thích (kèm WARNING
    khi tên đã khai nhận neo mới); ② `BANG_TENANT_KHAI` — 29 tên bảng tenant đã biết kèm **tên tệp** migration khai
    sinh (khớp tiền tố ba chữ số bị test viết migration tạm `003_policy_…` bác — đo), chỉ phán khi đúng tệp ấy đã áp;
    cổng ở `rls-coverage` đòi bản khai bằng tập `VI_TU_BANG_TENANT` trên lược đồ thật và mỗi dòng trỏ đúng `CREATE
    TABLE`; ③ hình dạng KHÔNG BỎ ĐƯỢC — bộ ba chuỗi `seq/prev_hash/hash` ngoài `public.audit_events`, bộ ba mốc neo
    ngoài `public.audit_chain_anchors`. Bảy vế phán xét: ⑴ neo mà tên lệch (đối chiếu catalog, không parse chuỗi do
    chủ bảng đặt); ⑵ neo mà hết là tenant; ⑵′ cột `org_id` hiện tại không phải cột đã neo; ⑶ tên đã khai/sổ chưa mang
    neo (lời trung tính, nêu lối ra); ⑷ ⑷′ bản sao sổ/mốc neo; ⑸ tên đã khai không còn phân giải; ⑹ tên đã khai hết
    là tenant (kể cả bảng chép đè). Không migration đánh số, không bảng mới, không GRANT — hồ sơ N2 giữ nguyên.

    ⑶ **RANH GIỚI NÓI RA.** ① mạnh bằng quyền sở hữu bảng: gỡ chú thích ⇒ lượt sửa ghi-lấp dưới tên hiện tại (WARNING)
    và ⑴⑵⑵′ im — còn ②③; ③ giữ tới khi chủ bảng phá chính bộ ba chuỗi của bản sao. Cụm đã bootstrap trước S1.43 dưới
    N2 (bảng thuộc superuser): lượt sửa không ghi được neo ⇒ ⑶ chặn deploy đầu tiên với lối ra trong thông điệp —
    ghim bằng test N2 nhánh 4, không để tự lộ ở sản xuất. Bảng tenant không khai (fixture) DROP rồi dựng lại cùng tên đi
    qua. D2/`CTE_TRIGGER_CHAN` vẫn dựng trigger theo tên (khoản 88 kèm). Khoản 86 **nửa gốc còn mở** (bảng mới đặt tên
    cột khác). Chú thích bảng tenant/sổ là kênh dành riêng; đổi có chủ ý ⇒ cùng migration sửa dòng khai và đặt lại chú
    thích.

    ⑷ **ĐỎ ĐO ĐƯỢC, CÔ LẬP TỪNG MỤC (bốn đột biến, khôi phục bản gốc trước mỗi ca, chạy lại trên bản bốn):** phán xét
    no-op ⇒ đỏ ở test 89 (a), 86 (a), ranh giới (chú thích chiếm chỗ); lượt sửa no-op ⇒ đỏ ở khẳng định neo đầu tiên;
    bỏ ⑹ ⇒ đỏ ở 86 (chép bảng); bỏ ⑷ ⇒ đỏ ở 89 (c) và ở bản sao `kho.so_chep`.

    ⑸ **LƯỢT SOI 34 (bản đầu): 2 CAO, 3 NẶNG, 4 NHẸ, 2 INFO — bản đầu bỏ. LƯỢT SOI 35 (bản ba): 2 CAO, 3 NẶNG, 3 NHẸ,
    2 INFO — xử lý hết trong bản bốn.** 35 CAO-1: "đủ 15 cột" thoát bằng đổi tên một cột phụ ⇒ bộ ba chuỗi; CAO-2: cụm cũ
    + vai deploy không sở hữu chặn deploy đầu ⇒ nói ra + test N2 nhánh 4; NẶNG-3: `to_regclass(substr(chú thích))` ném
    42601/42501 thô qua bản gom ⇒ đối chiếu catalog; NẶNG-4: anchors chưa có kênh hình dạng ⇒ ⑷′; NẶNG-5: đổi tên cột +
    thêm cột `org_id` mới ⇒ neo attnum, ⑵′; NHẸ: khai trùng hai bảng sổ (bỏ trùng), lời ⑶ trung tính + WARNING ghi-lấp,
    lọc `MAU_SCHEMA_DU_AN` cho `q` và lời ⑴; INFO: `pg_dump --no-comments`/logical replication (runbook), lá phân mảnh khai
    theo cha (ghi ở ADR-037). Bảng đủ ở `evidence/security-reviews.md`.

    **Số đo:** `migrations.int.test.ts` 97 → **101**; `rls-coverage` 30 → **31**; H19 30/30; audit-append-only 22/22;
    t0 209 module / 0 vi phạm; hardening: `MAU_NEO`, `BANG_TENANT_KHAI`, `VI_TU_PHAI_NEO`, `CAU_NEO_SUA`, `CAU_NEO_SAI`
    + một mục; **37 ADR**. Sổ nợ **89 khoản, 16 còn mở** — đóng 89, đóng nửa 86; mười hai có hình dạng mã nguồn.

    **Ghi chú CI (sau khi mở PR #41):** job T0 đỏ ở bước `gitleaks` — hai dòng khai `rfq_key_material` và
    `user_login_tokens` trong `BANG_TENANT_KHAI` bị luật `generic-api-key` đọc tên tệp migration kề bên
    (`017_rfq_key_material`, `029_dang_nhap_nguoi_mua`) thành bí mật; `pnpm t0` cục bộ không chạy gitleaks nên
    xanh cục bộ không nói gì về bước này. Sửa ở cấu hình, không sửa SQL: `.gitleaks.toml` giữ toàn bộ luật mặc
    định, chỉ miễn phần-bị-coi-là-bí-mật khớp đúng hình dạng tên tệp migration (`^\d{3}_[a-z0-9_]{1,60}$`) —
    không miễn tệp, không miễn luật. Không đo được tại chỗ; đo bằng chính lượt CI.

59. **[2026-09-10] S1.44 — KHOẢN 88 ĐÓNG: MỤC 83⑵ LẤY TẬP VAI THEO TÍNH CHẤT, SÁU VIỆC "KÈM KHI MỞ TỆP HARDENING",
    VÀ MỘT VIỆC MANG SANG TỪ LƯỢT SOI 35 (BƯỚC 2/3 KHÔNG GÃY THÔ). MÃ SẢN XUẤT. KHOẢN 90 MỞ (D2 THEO TÊN).**

    ⑴ **MỤC CHÍNH.** `CAU_PHU_LENH_SAI` (83⑵) từng ghim bốn tên vai — bản chép THỨ BA của danh sách tên — trong khi
    83⑧ cùng vòng đã đổi sang `VAI_KET_NOI_UNG_DUNG` vì đúng lý do ấy; bốn tên chỉ bằng tập thật NHỜ BƯỚC 1 gỡ
    membership lạ mà không nói ra. Nay ⑵ lấy tập vai theo tính chất (thành viên bắc cầu của app_api/app_unseal, trừ
    superuser). Đo trong một test, một fixture: `zz_vai88` thành viên app_api, `GRANT SELECT, DELETE` trên bảng RLS
    chỉ có policy SELECT ⇒ bản bốn tên (dựng lại từ chính câu mới bằng cách thay vế tính chất) **IM**, tính chất kêu
    đúng một dòng `public.zz_t88/zz_vai88/DELETE`. Hai vai đăng nhập không tồn tại ở CSDL test (hardening cố ý không
    tạo) — test kiểm hai vai ứng dụng và vai lạ nằm trong tập.

    ⑵ **SÁU VIỆC KÈM + MỘT VIỆC MANG SANG.** ⑴ ba bản chép inline của `MAU_SCHEMA_DU_AN` hết ((C) view/matview, (C)
    SECDEF, `VI_TU_BANG_CHI_GHI_THEM`); test đổi từ `HARDENING.includes(nguyên văn)` sang *vị từ ĐÃ GIẢI bằng bản sinh
    ở test* — nguyên văn vẫn được đòi, qua bộ giải. ⑵ hai nhãn khoản/hàng ADR. ⑶ chú thích nói ra chỗ chịu lực của
    79/⑺ (trên bảng có tên D2 sửa trước). ⑷ hai chú thích *BẬC TỰ DO CÒN LẠI* gạch kèm địa chỉ mục thay thế. ⑸ bộ
    giải hằng: văn phạm tham số `format()` chặt (bí danh đơn hoặc mẫu `%n$s` chuyền tiếp — bộ giải nghiêm bắt ngay
    `MAU_VI_TU_BANG_TENANT` truyền `'%2$s'`, chính ca 33a #8), split/join thay `replaceAll` (vế thay có `$`), kiểm thiếu
    tham số TRƯỚC khi thay, tên hằng có đệm khoảng trắng (`COT_NEO` từng vô hình với bộ giải); test T1 mới
    `db/hardening-hang.test.ts`. Cùng bẫy `$` cắn bản đầu của test ⑺ (`String.replace` với `$q$'x'$q$` ⇒ `$'` = phần
    sau chỗ khớp ⇒ syntax error giữa tệp) — ghi ở chú thích test. ⑹ đo lời hẹn sáu vòng của lượt 27: FK
    `ON DELETE CASCADE`/`SET NULL`/`TRUNCATE … CASCADE` từ cha KHÔNG đi vòng qua hàm canh của con — trigger hàng/TRUNCATE
    của con chạy và NÉM, hàng cha lẫn con còn nguyên; đối chứng con không hàm canh ⇒ hàng mất; FK trỏ ra từ năm bảng
    chỉ-ghi-thêm hôm nay đều NO ACTION. ⑺ (lượt soi 35 "mang sang" ⑶) BƯỚC 2 cột điều kiện và BƯỚC 3 trọn mục bọc
    `EXCEPTION WHEN OTHERS`: ném ⇒ WARNING + không sửa (BƯỚC 2) / một dòng `KHÔNG ĐÁNH GIÁ ĐƯỢC` nêu tên mục, SQLSTATE,
    SQLERRM vào bản gom (BƯỚC 3), mục không được coi là đúng, vòng đi tiếp. Đo bằng hardening chép ra thư mục tạm với ba
    mục tiêm ⇒ một thông báo `(phan_xet)` gom ba dòng đúng ba tên, lượt SỬA đi qua; kho thật đi qua sau đó.

    ⑶ **RANH GIỚI NÓI RA.** Tập vai theo tính chất trừ superuser — đúng, superuser không chịu RLS và không phải kết nối
    ứng dụng. BƯỚC 2 coi "điều kiện ném" là "chưa đủ điều kiện": không sửa im lặng — WARNING tại chỗ và BƯỚC 3 gom
    "không đánh giá được" cho chính mục ấy, deploy vẫn chặn. Khối con BƯỚC 3 là subtransaction quanh ba câu ĐỌC catalog,
    không đổi gì. D2/`CTE_TRIGGER_CHAN` vẫn theo tên — **khoản 90** (không khẩn: lớp phán xét ADR-037 đã chặn).

    ⑷ **ĐỎ ĐO ĐƯỢC, CÔ LẬP TỪNG MỤC (~~năm~~ sáu đột biến — M6 sau lượt 36; 40b #11 — khôi phục bản gốc trước mỗi ca, mỗi ca chạy đúng một test):** M1
    trả `CAU_PHU_LENH_SAI` về bốn tên ⇒ đỏ ở test 88 (khẳng định không ghim tên); M2 khoá cứng `nspname = 'public'` ở
    `VI_TU_BANG_CHI_GHI_THEM` ⇒ đỏ "vị từ hardening (qua bộ giải) phải BẰNG"; M3 bỏ khối BƯỚC 3 ⇒ `division by zero`
    TRẦN không tên mục; M4 bỏ khối cột điều kiện BƯỚC 2 ⇒ lượt SỬA gãy `(sua) thất bại: division by zero` — đúng ngõ cụt
    bản đầu S1.43; M5 khoá cứng `public` ở nhánh SECDEF của (C) ⇒ `[I3] hàm SECURITY DEFINER ở schema khác` lọt
    `migrate()`. M6 (sau lượt soi 36) trả `VAI_KET_NOI_UNG_DUNG` về `'MEMBER'` ⇒ hồ sơ N3 đỏ ở 001 `permission denied for
    database` — đúng lỗi thô tiền tồn.

    ⑸ **LƯỢT SOI 36: 1 NẶNG, 4 NHẸ, 4 INFO — bác bản "chỉ tính chất" của mục chính.** NẶNG-1: "theo tính chất" chỉ đúng
    khi tính chất là thứ kẻ tấn công KHÔNG đổi được — membership thì ADMIN OPTION đổi được (`REVOKE app_api FROM
    app_api_login` + GRANT trực tiếp ⇒ kết nối thật 0 hàng, tập theo membership im, bốn tên thấy) ⇒ tập vai của ⑵ =
    TÍNH CHẤT ∪ `ROLE_CANH` (cùng bài học ADR-037 áp cho VAI; hằng dời lên trước, một bản). NHẸ-2: quyền xét theo kế thừa
    như 83⑧, mô tả nêu đường `(qua nhóm)`. NHẸ-3 **đo ra một lỗi tiền tồn từ S1.34**: hồ sơ N3 (cụm trống, vai deploy
    CREATEROLE chạy `migrate()` đầu tiên) — membership ngầm chỉ-admin của vai tạo role làm vai deploy lọt tập theo
    `'MEMBER'`, hardening thu hồi CREATE của chính chủ database, 001 gãy thô; nay tập theo `'USAGE' OR 'SET'`, N3 đi qua
    49 migration và dừng ở phán xét với một mục có tên và lối ra (superuser REVOKE một lần). NHẸ-4: bộ giải đóng. NHẸ-5:
    hai câu membership BƯỚC 3 cùng khuôn. INFO-6: tiêm 42501 dưới vai N2 chưa có test — ranh giới ghi ở đây. INFO-7/8/9:
    nhãn hàng 8–9/20, FK census ⊆, test ⑺ không để lại gì (xác nhận bằng đọc `migrate.ts`). Bảng đủ ở
    `evidence/security-reviews.md`.

    **Số đo:** `rls-coverage` 31 → **32**; H19 (`hardening-suy-tu-tinh-chat`) 30 → **32**; `migrations.int.test.ts` 101 →
    **102** (hồ sơ N3); T1 mới `hardening-hang.test.ts` 4/4, T1 trọn tầng 724/724; t0 210 module / 0 vi phạm; sáu đột biến
    đỏ cô lập; hardening: `CAU_PHU_LENH_SAI`, `VAI_KET_NOI_UNG_DUNG`, `ROLE_CANH` (dời), `CAU_DOC_VONG`, `VI_TU_BANG_CHI_GHI_THEM`,
    BƯỚC 2/3; không migration đánh số, không GRANT, không bảng mới; **37 ADR** (không ADR mới — ADR-036 hàng 6 và ADR-037 §5
    ghi thêm). Sổ nợ **90 khoản, 16 còn mở** — đóng 88, mở 90 (D2 theo tên); mười hai có hình dạng mã nguồn.

60. **[2026-09-10] S1.45 — KHOẢN 90 ĐÓNG: LỚP SỬA D2 CỦA SỔ ĐÒI DANH TÍNH NHẤT QUÁN (ADR-037 KÊNH ①), KHÔNG CHỈ TÊN.
    MÃ SẢN XUẤT, VÒNG NHỎ.**

    ⑴ **LỚP.** `bang_so` của `CTE_TRIGGER_CHAN` (D2 dựng lại trigger; D-mục dùng chung: trigger lạ, rule, ACL sổ) từng nhận
    bảng sổ bằng TÊN trong `BANG_CHI_GHI_THEM`; ở kịch bản khoản 89 D2 dựng bốn trigger lên bản sao cùng tên TRƯỚC khi lớp
    phán xét chặn. Nay thêm hai vế, cả hai so PHẦN TÊN của neo (attnum là việc của ⑵′): ⒜ chú thích neo của chính bảng —
    nếu có — nêu tên hiện tại HOẶC nêu tên sổ ở `public` (bảng sổ thật bị `SET SCHEMA` vẫn là sổ theo oid, vẫn được chữa —
    giữ đánh đổi [CR2a]); ⒝ không quan hệ KHÁC trong lược đồ dự án mang neo nêu đúng tên này. Cùng vế ⒝ ở `CAU_NEO_SUA`:
    lượt ghi neo KHÔNG trao neo cho bản chiếm tên (WARNING nêu oid giữ tên). Thông điệp "KHÔNG TỒN TẠI" của D2 thêm nguyên
    nhân thứ tư. `bang_al` (bảng lạ mang trigger canh) không đổi.

    ⑵ **ĐO (test 89 + CR2a).** (b) sau RENAME + dựng cùng tên: bản sao **không nhận neo, 0 trigger** — lớp SỬA đứng yên ở cả
    hai mục; lớp PHÁN XÉT ⑴⑶⑷ chặn, thông điệp D2 nêu nguyên nhân thứ tư. (c) chủ bảng gỡ chú thích bảng gốc ⇒ lượt sửa
    ghi-lấp neo dưới tên mới ⇒ không ai giữ tên ⇒ bản sao nhận neo, LÀ `bang_so` ⇒ D2 dựng 4 trigger — ranh giới nói ra.
    (d) đối chứng: danh tính về đúng chỗ ⇒ đi qua, 4 trigger. (e) chú thích lạ trên sổ THẬT + gỡ một trigger ⇒ D2 không
    chữa (3), NÉM; đặt lại neo ⇒ chữa (4). CR2a: `SET SCHEMA` cả hai sổ ⇒ vẫn 8 trigger ở schema mới (vế ⒜ nhận neo
    `public.` dù bảng ở đâu).

    ⑶ **RANH GIỚI NÓI RA.** Kênh ① mạnh bằng quyền sở hữu ở CẢ HAI lớp (chủ bảng gỡ chú thích ⇒ D2 chữa bản sao; kênh ③
    hình dạng vẫn chặn deploy). Chưa có chú thích (deploy đầu — mục neo đứng trước D2 trong `bang`; cụm N2 bảng thuộc
    superuser) ⇒ ⒜ đi qua. Không đi theo "đường đóng" ghi ở hàng 90 (đòi neo KHỚP): đòi khớp làm bảng thật rơi khỏi
    `bang_so` khi chưa có neo. Mọi ca hai vế loại một bảng đều trùng một vế của `CAU_NEO_SAI` (⑴ neo lệch tên; ⑷ bản sao
    hình dạng; ⑵′ attnum; ⑶ chú thích chiếm chỗ) hoặc vế "KHÔNG TỒN TẠI" của D2 chặn cùng lượt — không thả trong im lặng.
    Nút bấm decoy (lượt soi 37 NHẸ-3): chủ một bảng lạ trong schema dự án đặt chú thích `neo: public.audit_events` làm sổ
    thật rời `bang_so` — lớp SỬA đứng yên nhưng ⑴ nêu đúng bảng lạ kèm oid sổ, deploy chặn; kẻ ấy vốn đã chặn được deploy
    bằng một bảng có `org_id` không policy. **[S1.48 / 40a I5]** decoy CÙNG TÊN ở schema khác chép NGUYÊN chuỗi neo đi qua
    ⒜ (dạng `public.<sổ>`) và ⒝ ⇒ bản S1.45 D2 chữa decoy trong khi sổ thật đứng yên (⑴⑷ chặn cùng lượt — trễ, không mất);
    nay ⒝′ (không quan hệ khác mang ĐÚNG chuỗi neo của mình) ⇒ cả hai đứng yên (đo: test 89 (f), decoy 0 trigger, sổ thật 3).

    ⑷ **ĐỎ ĐO ĐƯỢC, CÔ LẬP (khôi phục bản gốc trước mỗi ca):** bỏ riêng ⒝ ⇒ test 89 (b) đỏ ngay ở dòng "KHÔNG TỒN TẠI"
    (bản sao lại là `bang_so`, D2 không còn gì để nói); bỏ riêng ⒜ ⇒ (e) đỏ ở cùng dòng (sổ mang chú thích lạ vẫn được chữa).
    Bỏ cả hai ⇒ (b) đỏ "4 thay vì 0" (bản đầu, trước lượt soi 37).

    ⑸ **LƯỢT SOI 37 (trên bản đầu): 1 CAO, 5 NHẸ, 3 INFO — xử lý hết ở bản hai.** CAO-1: ⒜ đòi neo bằng tên hiện tại làm
    bảng sổ thật bị `SET SCHEMA` rơi khỏi `bang_so` — đảo [CR2a], test CR2a đỏ theo đọc ⇒ ⒜ so phần tên và nhận neo nêu sổ
    ở `public`. NHẸ-2 thông điệp D2 sai nguyên nhân ⇒ nguyên nhân thứ tư. NHẸ-3 decoy — nói ra. NHẸ-4 `CAU_NEO_SUA` trao neo
    cho bản sao ⇒ cùng vế ⒝. NHẸ-5 ⑵′ in NULL ⇒ `coalesce`. NHẸ-6 STATE tự mâu thuẫn (đọc trước khi ghi) — khớp. INFO-7
    thứ tự mục neo/D2 và N2 xác nhận; INFO-8 (b) "bảng gốc 0" là tài liệu; INFO-9 "sáu" → "bốn". Bảng đủ ở
    `evidence/security-reviews.md`.

    **Số đo:** `migrations.int.test.ts` 102/102 (test 89 thêm (b)/(c)/(e), CR2a giữ 8 trigger); t0 210 module / 0 vi phạm;
    ba đột biến đỏ cô lập; hardening: `CTE_TRIGGER_CHAN` (`bang_so`), `CAU_TRIGGER_CHAN_SAI`, `CAU_NEO_SUA`, `CAU_NEO_SAI` ⑵′;
    không migration đánh số, không GRANT, không bảng mới; **37 ADR** (ADR-037 §5 ghi thêm). Sổ nợ **90 khoản, 15 còn mở**
    — đóng 90; mười một có hình dạng mã nguồn.

61. **[2026-09-10] S1.46 — KHOẢN 86 NỬA GỐC ĐÓNG: BẢNG ĐA TỔ CHỨC ĐẶT TÊN CỘT KHÁC `org_id` BỊ NHẬN DIỆN THEO TÍNH CHẤT
    (KHOÁ NGOẠI MỘT CỘT TỚI BẢNG TENANT — CỦA NÓ HAY CỦA TỔ TIÊN), Ở MỌI SCHEMA KỂ CẢ `public`. KHOẢN 91 MỞ. MÃ SẢN XUẤT, VÒNG NHỎ.**

    ⑴ **LỚP.** Mục phán xét mới, cùng cấu trúc khoản 85: `VI_TU_HINH_DANG_86` = r/p ∧ ¬`relrowsecurity` ∧ ¬có cột `org_id` ∧
    ∃ khoá ngoại MỘT cột tới một bảng tenant theo tính chất (`CAU_KHOA_NGOAI_TOI_TENANT` — câu tương quan dùng ở cả vị từ lẫn mô
    tả; đích khai triển từ `MAU_VI_TU_BANG_TENANT` với bí danh `gn`/`g`, nới định nghĩa "bảng tenant" thì đích đi theo; xét khoá
    ngoại của chính bảng HAY của một tổ tiên INHERITS qua CTE `to_tien`; cột đích nào cũng tính) ∧ ¬`VI_TU_CAN_CO_RLS`;
    `CAU_KHOA_NGOAI_TENANT_SAI` hai chiều (chưa khai / dòng khai thiu, sentinel chắn `<> ''`), lọc `MAU_SCHEMA_DU_AN`;
    `BANG_KHOA_NGOAI_TENANT_KHAI` rỗng. KHÔNG nới vị từ tenant (bán kính nổ ghi ở chú thích `VI_TU_CAN_CO_RLS`): mục bắt hình
    dạng phải KHAI; cửa ra hợp lệ là đổi tên cột thành `org_id` (kéo theo [CR1], `BANG_TENANT_KHAI`, neo), DROP, bật RLS (83⑶ —
    cửa yếu, khoản 91), hay khai kèm lý do. Bản đầu tách vế gốc thành `MAU_VI_TU_GOC_TENANT` và chỉ nhận đích là GỐC — bị lượt
    soi 38 A1 bác (dưới); bản hai bỏ hằng ấy, `MAU_VI_TU_BANG_TENANT` không đổi một ký tự.

    ⑵ **ĐO (`db/rls-coverage.int.test.ts`, describe S1.46).** Câu phán xét rỗng trên lược đồ thật (không bảng nào thiếu `org_id`
    mà có khoá ngoại một cột tới bảng tenant — khớp quy ước khoá ngoại hợp thành của kho). Fixture trong giao dịch: `zz_s.t` VÀ
    `public.zz_t86` cùng hình dạng đều bị thấy — vị từ tenant không nhận nên public không phải ngoại lệ; `zz_s.t_users (nguoi
    uuid REFERENCES users(id))` bị thấy `(qua nguoi -> public.users)`; `zz_s.con86 () INHERITS (zz_s.t2)` bị thấy qua khoá ngoại
    của cha; có `org_id` ⇒ 85; bật RLS ⇒ 83⑶; uuid trần ⇒ không; đổi tên cột thành `org_id` ⇒ ngoài public sang 85, ở public
    thành bảng tenant theo tính chất; khai `t2` ⇒ hết dòng `t2` (con86 là đối tượng riêng, vẫn phải khai); `DROP CONSTRAINT` ⇒
    dòng khai thiu, `t2` và `con86` rơi về uuid trần — không mục nào thấy nữa (ranh giới). Test ĐO: app_api gắn A đọc thấy
    777/778 của B ở cả hai bảng (lỗ RÒ thật), `migrate()` NÉM một dòng cho mỗi bảng nêu `(qua to_chuc -> public.organizations)`,
    không dòng 85; bật RLS ⇒ 86 im, 83⑶ kêu; DROP ⇒ đi qua.

    ⑶ **RANH GIỚI NÓI RA.** Cột uuid TRẦN (không khoá ngoại) và khoá ngoại NHIỀU cột — không tính chất catalog nào nhận diện;
    đó là DDL cố ý bỏ ràng buộc tham chiếu, vế ⒝ của ADR-036 §3⑶, nhân chứng chỉ ở CI (33a #13 cùng lớp). Khoá ngoại tới một
    bảng ĐÃ KHAI ở 85/86 (bậc kế trên đồ thị khoá ngoại) không tính — bao đóng đồ thị là vòng khác. Lá phân mảnh: ràng buộc
    nhân bản xuống lá (`conparentid`) nên từng lá phải khai riêng — cùng khuôn 85, đúng vì lá có `relrowsecurity` riêng
    (38 B1: giữ, nói ra; thông điệp hướng dẫn đổi tên cột ở bảng gốc phân mảnh). Thứ tự (A)/86 không tạo kẽ (vị từ loại
    `VI_TU_CAN_CO_RLS`, 38 B2). Mức bảo đảm "phát hiện ở deploy kế" như mọi mục phán xét. Cửa ra "bật RLS ⇒ 83⑶" không FORCE và
    view không `security_invoker` lên bảng ấy vô hình với (C) — tiền tồn từ 83⑶, nay có địa chỉ: **khoản 91** (38 A3).

    ⑷ **ĐỎ ĐO ĐƯỢC, CÔ LẬP (khôi phục bản gốc trước mỗi ca):** M1 bỏ mục 86 khỏi `bang` ⇒ test ĐO đỏ "phải bị khoản 86 bắt:
    expected null not to be null"; M2 bỏ vế ¬có `org_id` ⇒ test 1 đỏ ở khẳng định văn bản `NOT <có org_id>` (khẳng định hành vi
    `zz_s.t_org` ⇒ 85-không-86 đứng sau trong cùng test); M3 bỏ vế ¬`relrowsecurity` ⇒ cả hai test đỏ (`zz_s.t_rls` lọt vào 86;
    "bật RLS: mục 86 im" đỏ); M4 bỏ vế tổ tiên (`SELECT c.oid` trần) ⇒ test 1 đỏ ở danh sách fixture (thiếu `zz_s.con86`); M5 đích
    chỉ là `organizations` (bản đầu) ⇒ test 1 đỏ ở khẳng định văn bản "đích = vị từ tenant" (khẳng định hành vi `zz_s.t_users`
    đứng sau).

    ⑸ **LƯỢT SOI 38 (trên bản đầu): 1 NẶNG, 5 NHẸ, 5 INFO — NẶNG và bốn NHẸ xử lý trong bản hai, một NHẸ thành khoản 91.** NẶNG A1:
    khoá ngoại một cột tới bảng tenant KHÔNG phải gốc (`users`, `rfq_packages`…) không thuộc mục nào, cùng lớp 86, và test bản
    đầu ghim `users` là "bảng thường" — lời khai đóng băng lỗ ⇒ đích nới sang `MAU_VI_TU_BANG_TENANT` (tập con nghiêm ngặt của
    thay đổi, không nới `VI_TU_BANG_TENANT`), fixture `t_users` phải bị thấy, đột biến M5. NHẸ A2 con INHERITS mất khoá ngoại ⇒
    xét tổ tiên qua `to_tien`, fixture `con86`, đột biến M4. NHẸ A3 cửa ra 83⑶ yếu ⇒ khoản 91. NHẸ B1 lá phân mảnh khai từng lá ⇒
    giữ, nói ra lý do, sửa câu hướng dẫn. NHẸ E1 "hay đã DROP" trong chiều ngược nói quá (bảng DROP thì im) ⇒ bỏ. NHẸ E2 ranh giới
    thiếu A1/A2 ⇒ A1/A2 đóng, ranh giới viết lại. INFO B2 thứ tự (A)/86, C1 ba mục rời nhau, C2 86 tự đóng đường S1.42, D1 bí danh
    `fk` bị che ⇒ `kn_fk`, E3 cửa ra "thành bảng tenant" kéo theo khai/neo ⇒ nêu trong thông điệp, F1 số học khớp. Bảng đủ ở
    `evidence/security-reviews.md` §S1.46.

    **Số đo:** `rls-coverage.int.test.ts` 34/34 (hai test S1.46; meta-test sentinel nay đòi SÁU danh sách rỗng);
    `migrations.int.test.ts` 102/102 và `hardening-suy-tu-tinh-chat.int.test.ts` xanh; t0 210 module / 0 vi phạm; năm đột biến
    đỏ cô lập; hardening: `BANG_KHOA_NGOAI_TENANT_KHAI`, `CAU_KHOA_NGOAI_TOI_TENANT`, `VI_TU_HINH_DANG_86`, `CAU_KHOA_NGOAI_TENANT_SAI`,
    một mục `bang`; không migration đánh số, không GRANT, không bảng mới; **37 ADR** (ADR-037 §5 ghi thêm). Sổ nợ **91 khoản,
    15 còn mở** — đóng 86, mở 91; mười một có hình dạng mã nguồn.

62. **[2026-09-11] S1.47 — KHOẢN 87 ĐÓNG: GUC `app.*` GẮN SẴN CHO PHIÊN ỨNG DỤNG BỊ PHÁN XÉT THEO TÍNH CHẤT (NĂM NHÁNH), VÀ
    `withTenant` TỪ CHỐI PHỤC VỤ KHI MẶC ĐỊNH PHIÊN BỊ ĐẦU ĐỘC. KHOẢN 92 MỞ. MÃ SẢN XUẤT (hardening + tenancy).**

    ⑴ **LỚP CSDL.** Mục phán xét `CAU_GUC_TUY_BIEN_GAN_SAN`, tính chất "tên GUC có dấu chấm" (placeholder — thứ duy nhất
    policy/hàm dự án đọc vào; GUC vận hành không dấu chấm ngoài mục, [I3]); danh sách trắng `GUC_TUY_BIEN_KHAI` rỗng, chiều
    ngược bắt dòng khai thiu trên cả năm nguồn. ⒜ `ALTER DATABASE … SET`; ⒝ hàng của vai kết nối ứng dụng (tính chất ∪ tên
    ghim) và hàng `ALTER ROLE ALL SET` (0, 0) — tên riêng trong thông điệp; ⒞ CHÍNH phiên deploy hỏi `current_setting(tên,
    true)` trên tập tên suy từ văn bản (`CAU_TEN_GUC_DU_AN_DOC`: regex `current_setting('x.y'` trên prosrc hàm lược đồ dự án
    và `pg_get_expr` của mọi policy), trừ `app.hardening_che_do`, khác rỗng mà không hàng catalog nào mang ⇒ `ALTER
    SYSTEM`/postgresql.conf/dòng lệnh/`options=` của chuỗi kết nối deploy, hay phiên mở trong cửa sổ SET đã RESET; ⒟
    `pg_parameter_acl` với grantee không superuser (aclexplode in cả quyền của chủ — lọc, đo); ⒠ `proconfig` của hàm trong
    lược đồ dự án. KHÔNG tự RESET, vì ĐO: chủ database thường 42501 ở SET lẫn RESET placeholder ở mức database; `ALTER ROLE
    app_api RESET ALL` dưới vai thường giữ im lặng phần tử placeholder (bốn mục RESET ALL và mục 87 cùng đỏ, rolconfig còn
    nguyên); `GRANT SET ON PARAMETER` cho vai thường SET/RESET được ⇒ ⒟. Không in giá trị. `coalesce`/`NULLIF` viết trần
    (cú pháp, không phải hàm — `pg_catalog.coalesce` ném 42883, đo giữa vòng).

    ⑵ **LỚP ỨNG DỤNG (`withTenant`).** `BEGIN; SELECT` một round-trip đọc bốn GUC TRƯỚC khi hàm đặt gì: có giá trị lúc mở
    giao dịch là MẶC ĐỊNH PHIÊN ⇒ `TenantError` nêu tên (không giá trị) trước `fn`, ROLLBACK, KHÔNG huỷ kết nối (kết nối kế
    mang cùng mặc định — pid ổn định, đo). Vì sao đọc thẳng giá trị: placeholder không có ở `pg_settings` (không `source`,
    không `reset_val`; thăm dò S1.47). Rồi một câu đặt `app.org_id` và xoá ba GUC khách về '' (lớp hai); `finally` đọc cả
    bốn trục, chỉ khi không từ chối. Không thêm round-trip so với trước S1.47.

    ⑶ **ĐO.** `migrations.int.test.ts` "[khoản nợ 87]" (tám vế có nhãn — 40b #14): (a) SET mức database ⇒ NÉM, GUC còn nguyên, không in giá trị, RESET ⇒
    qua; (b) `ALTER ROLE app_api SET/IN DATABASE SET` ⇒ superuser RESET ALL tự chữa, mục im; câu phán xét thấy hàng vai; DateStyle
    không bị; (a′) `ALTER ROLE ALL SET` ⇒ NÉM "mọi vai, mọi database"; (e) hàm `SET app.org_id` ⇒ NÉM, DROP ⇒ qua; (c′) `SET` +
    `ALTER SYSTEM SET` + `pg_reload_conf` ⇒ kết nối mới thấy giá trị, `pg_settings` không có hàng, catalog sạch, NÉM ⒞;
    RESET ⇒ kết nối mới qua; (c) vai deploy thường 42501 SET/RESET placeholder, NÉM ở 87 không gãy thô, GUC thường đặt được;
    phiên mở trong cửa sổ SET vẫn mang giá trị sau RESET ⇒ ⒞ kêu (đúng), kết nối mới ⇒ qua; (b′) RESET ALL dưới vai thường im
    lặng ⇒ hai mục cùng đỏ, rolconfig còn; (d) GRANT SET ON PARAMETER ⇒ NÉM ⒟, vai thường SET/RESET được, REVOKE ⇒ 42501.
    `with-tenant.int.test.ts` S1.47: mức database `app.guest_session_id` ⇒ kết nối mới là phiên khách (câu ngoài withTenant 0
    hàng không lỗi — nói ra), withTenant từ chối trước `fn`, pid giữ; RESET ⇒ phục vụ, ba GUC khách rỗng trong giao dịch, 1
    hàng; `fn` đặt GUC khách phạm vi PHIÊN ⇒ kết nối huỷ. Meta-test sentinel: bảy danh sách rỗng. Lượt evidence đầu của vòng
    đỏ HAI test cũ (CR3 `audit_append`, IM4 `chot_moc_neo`): chúng đặt `app.org_id` phạm vi PHIÊN trên chính `db.pool` rồi
    `migrate()` cùng pool ⇒ phiên deploy mang giá trị ⇒ ⒞ phán — đúng thiết kế (deploy thật không đặt GUC ấy); test sửa dùng
    client riêng và huỷ trước `migrate()`. Kỳ vọng lật có chủ đích, nói ra.

    ⑷ **ĐỎ ĐO ĐƯỢC, CÔ LẬP (9 đột biến, khôi phục trước mỗi ca):** M1 bỏ mục ⇒ (a) đỏ; M2 bỏ vế dấu chấm ⇒ DateStyle bị bắt;
    M3 bỏ nhánh setrole 0 ⇒ (a) đỏ; M6 bỏ ⒞ ⇒ (c′) đỏ; M7 bỏ ⒟ ⇒ (d) đỏ; M8 bỏ ⒠ ⇒ (e) đỏ; M5 `finally` chỉ đọc org_id ⇒ [I1]
    khách đỏ; M9 bỏ từ chối ⇒ ĐO đỏ. **M4 bỏ câu xoá ba GUC khách: SỐNG** — phép từ chối đứng trước nên câu xoá không đo
    riêng được; giữ làm lớp hai và nói ra, không khẳng định hơn.

    ⑸ **LƯỢT SOI 39 (trên bản đầu): 2 NẶNG, 5 NHẸ, 5 INFO.** NẶNG-1 meta-test sentinel `toBe(6)` ⇒ 7. NẶNG-2 `ALTER SYSTEM` mù
    ⇒ nhánh ⒞ (đề xuất đọc `pg_settings.source` không dùng được — đo — thay bằng đọc thẳng giá trị trên tập tên theo tính chất).
    NHẸ-1 `ALTER ROLE ALL` ⇒ tên riêng + khoản 92 cho ba mục kề. NHẸ-2 GRANT SET ON PARAMETER ⇒ đo (qua) + nhánh ⒟, câu "chỉ
    superuser" sửa. NHẸ-3 RESET ALL im lặng dưới vai thường ⇒ đo (b′), chú thích/cột quyền. NHẸ-4 `finally` huỷ kết nối với
    chẩn đoán sai ⇒ từ chối trước `fn` (đề xuất `pg_settings.source` cũng không dùng được), cờ bỏ qua `finally`. NHẸ-5
    proconfig ⇒ nhánh ⒠. INFO-1 extension ⇒ quyết định nói ra; INFO-2 `app.hardening_che_do` ⇒ chú thích; INFO-3 bộ giải;
    INFO-4 docstring `rfq_packages` ⇒ `user_login_tokens`; INFO-5 vai deploy bị đầu độc ⇒ ranh giới. Bảng đủ ở
    `evidence/security-reviews.md` §S1.47.

    **Số đo:** `migrations.int.test.ts` 103/103 (một test mới, mười vế); `with-tenant.int.test.ts` 18/18 (hai mới);
    `rls-coverage.int.test.ts` sentinel 7; t0 210 module / 0 vi phạm; 8/9 đột biến đỏ (M4 sống, nói ra); hardening:
    `GUC_TUY_BIEN_KHAI`, `VI_TU_HANG_CAU_HINH_UNG_DUNG`, `CAU_TEN_GUC_DU_AN_DOC`, `CAU_GUC_TUY_BIEN_GAN_SAN`, một mục `bang`;
    tenancy: `withTenant` (từ chối + xoá + `finally` bốn trục); không migration đánh số, không GRANT, không bảng mới; **37 ADR**
    (ADR-036 ghi thêm). Sổ nợ **92 khoản, 15 còn mở** — đóng 87, mở 92; mười một có hình dạng mã nguồn.

63. **[2026-09-11] S1.48 — LƯỢT SOI NGANG 40 (lớp CSDL 40a; tài liệu/mã 40b) TRÊN S1.43–S1.47: MỘT HỒI QUY I1 CỦA CHÍNH S1.47 SỬA,
    NĂM KẼ HẸP ĐÓNG, MƯỜI TÁM LỜI KHAI THIU GẠCH, KHOẢN 93 MỞ. MÃ SẢN XUẤT (hardening, tenancy, migrate) + tài liệu.**

    ⑴ **HÌNH THỨC.** Như lượt 33: hai người soi độc lập, không shell, song song, không đọc nhau — 40a đặt các lớp mới S1.43–S1.47
    cạnh lớp cũ ("cái nào lách được cái nào"), 40b soi lời khai vs mã và con số vs con số trên `git diff 3811d37..1309379`. Chạy
    trên HEAD có cả #44/#45 (chưa hợp nhất) — nhánh này xếp tiếp trên `khoan-87-guc-db`.

    ⑵ **40a — 0 CAO, 1 NẶNG, 5 NHẸ, 10 INFO; sửa trong vòng:** NẶNG-1 `withTenant` bản S1.47 gộp "rò phạm vi phiên từ mã ngoài
    withTenant" vào "mặc định phiên", tắt kiểm `finally` và TRẢ KẾT NỐI NHIỄM VỀ POOL — hồi quy so với I1 ⇒ sau ROLLBACK, RESET bốn
    GUC rồi đọc lại: rỗng ⇒ rò phiên ⇒ huỷ kết nối, thông điệp đúng nguồn; còn ⇒ mặc định thật ⇒ giữ (đo cả hai chiều, pid). H1 mục
    87 phán xét SAU khi migration cùng lượt đã chạy dưới GUC gắn sẵn và ghi checksum ⇒ `migrate()` đọc bốn GUC và **từ chối trước
    lượt sửa** (đo: migration tạm không chạy, không dòng `schema_migrations`; với bốn tên lõi, lớp bắt nay là phép từ chối sớm hay
    mục 87 tuỳ phiên có thừa kế — ⒜/⒜′ đo bằng câu phán xét chạy trực tiếp). H2 khoản 86 miễn khoá ngoại nhiều cột trong khi quy
    ước kho là `(org_id, x)` ⇒ bỏ `array_length = 1` ở `CAU_KHOA_NGOAI_TOI_TENANT` (giữ ở vị từ gốc), mô tả in `(to_chuc, nguoi)`.
    H3 `to_regclass(format('%I.%I'))` ở MƯỜI BỐN chỗ (mọi chiều ngược) đòi USAGE trên schema ⇒ dưới N2 một dòng khai trỏ schema
    không USAGE làm mục "KHÔNG ĐÁNH GIÁ ĐƯỢC" mãi ⇒ thay bằng JOIN `pg_class`/`pg_namespace` (đo: vai không USAGE chạy chiều
    ngược). H4 tập tên ⒞ hẹp (hoa/thường, chữ số, chỉ prosrc) ⇒ regex `gi` + chữ số, thêm `prosqlbody`, DEFAULT cột, CHECK; loại hàm
    extension (I3); census: mọi literal trong migrations ⊆ tập trên lược đồ thật. H5 khoản 92 có hình dạng rẻ hơn (`reset_val`) —
    ghi vào hàng 92. INFO: I1 ranh giới `ALTER ROLE <vai deploy> SET` ghi SAI CHIỀU (⒞ thấy) — sửa lời; I2 lối ra "GRANT SET" bị ⒟
    phán — thông điệp nói GRANT tạm/RESET/REVOKE; I5 decoy cùng tên khác schema chép nguyên neo được D2 chữa ⇒ ⒝′ (đo test 89
    (f)); I6 ⑷/⑷′ thêm relkind `p` (đo); I7 ⑴ in trọn chú thích chủ bảng ⇒ `left(80)` + lọc ký tự điều khiển; I8 hình dạng kết
    quả `BEGIN; SELECT` được đòi; I4 (COMMENT khoá SUE với `lock_timeout = 0` ở deploy đầu) và I9/I10 ghi ADR-037 §5.

    ⑶ **40b — 1 NẶNG, 11 NHẸ, 6 INFO; sửa trong vòng:** NẶNG-1 ADR-036 §2 không có hàng cho cơ chế khoản 87 (thêm hàng 23), hai
    câu ở §5 bị S1.47 bác chưa gạch (gạch); cổng `CAU_*_SAI` ↔ §2 vẫn chưa có ⇒ **khoản 93**. #2 "21/11 policy RESTRICTIVE
    `_khach`": catalog đếm **29** (một mỗi bảng tenant — hardening dựng theo khuôn 027; "10" của người soi là số CREATE POLICY trong
    migration) — ba chỗ sửa, một `it` đếm từ catalog theo số bảng tenant. #3/#4/#5/#6 câu bị bác ở hàng 87/86/90 và ADR-037 §5
    gạch kèm nhãn. #7 `CAU_NEO_SAI` là **tám** vế (⑴⑵⑵′⑶⑷⑷′⑸⑹) — bốn nơi. #8 ADR-036 §4: 11 danh sách, 4 có hàng, 7 rỗng; F1
    "năm" → bảy. #9/#10 docstring `with-tenant.ts`. #11 S1.44 "năm" → sáu đột biến. #12 dòng TRỐNG trong bảng sổ nợ: không phải
    một (trước hàng 84) mà SÁU (trước 66, 67, 68, 69, 71, 84) — bảng đứt từ hàng 66 qua hơn hai mươi vòng, bộ đọc regex mù; xoá
    cả sáu, P0 nay đòi khối liền mạch (đột biến chen dòng trống ⇒ đỏ). #13 "sáu trigger" → bốn ở ADR-036/037. #14 "mười vế" →
    tám vế có nhãn. #15 `audit-append-only` 22 = số `it` báo cáo vitest ghi — giữ. #16 nhịp lượt ngang: lịch thắng điều kiện, ghi
    rõ. #17 ranh giới `GRANT SET ON PARAMETER session_replication_role` — chú thích tại chỗ. #18 nhãn đóng ở ADR-036 §5 ⑵⑶.

    ⑷ **ĐỎ ĐO ĐƯỢC, CÔ LẬP (8 đột biến):** M1 trả lại `array_length = 1` ⇒ `t_hop` không bị thấy; M2 trả lại `to_regclass` ở chiều
    ngược 85 ⇒ 42501 dưới vai không USAGE; M3 regex bản S1.47 ⇒ `app.rfq_v2`/`CURRENT_SETTING (` thiếu; M4 bỏ ⒝′ ⇒ decoy được D2
    chữa (4 thay vì 0); M5 ⑷ chỉ `'r'` ⇒ bản phân mảnh vô hình; M6 `migrate()` không từ chối sớm ⇒ migration tạm chạy; M7 bỏ nhánh
    RESET-đọc-lại ⇒ kết nối nhiễm còn trong pool; M8 P0 bỏ vế dòng trống ⇒ đột biến chen dòng trống xanh.

    **Số đo:** `migrations.int.test.ts` 104/104 (H1 mới, test 89 thêm (f), test 87 đo ⒜ trực tiếp); `rls-coverage.int.test.ts`
    36/36 (`t_hop`, vai không USAGE, ⑷ relkind p, đếm `_khach`, census tên GUC); `with-tenant.int.test.ts` 19/19 (rò phiên);
    `so-no-tu-doi-chieu.test.ts` 37/37; t0 210 module / 0 vi phạm; tám đột biến đỏ cô lập; hardening: `CAU_KHOA_NGOAI_TOI_TENANT`,
    14 chỗ JOIN catalog, `CAU_TEN_GUC_DU_AN_DOC`, ⒝′ trong `bang_so`, ⑷ relkind, ⑴ thông điệp; tenancy: `withTenant` nhánh RESET-đọc
    -lại + đòi hình dạng kết quả; db: `migrate()` từ chối sớm; không migration đánh số, không GRANT, không bảng mới; **37 ADR**
    (ADR-036 §2 hàng 23, §4, §5; ADR-037 §5 ghi thêm). Sổ nợ **93 khoản, 16 còn mở** — mở 93; mười hai có hình dạng mã nguồn.

64. **[2026-09-11] S1.49 — KHOẢN 93 ĐÓNG: MỘT CỔNG ĐÒI MỌI PHÁN XÉT CỦA HARDENING CÓ DÒNG LÝ DO TRONG ADR, VÀ TRỤC CỦA NÓ LÀ
    TÍNH CHẤT *Ô CÂU SỬA NO-OP*, KHÔNG PHẢI TÊN LẪN HÌNH DẠNG CHUỖI. CỔNG + TÀI LIỆU, KHÔNG MÃ SẢN XUẤT.**

    ⑴ **LỚP.** `tests/architecture/hardening-co-ly-do.test.ts` ([INV-H19], tệp mới — inv-matrix gán bất biến theo TỆP nên
    cổng về hardening không được ở tệp sổ nợ của H20, lượt soi 41 NHẸ-1). Bốn vế: ⒜ dựng lại `bang` thành 107 hàng × 6 ô
    (bộ tách ô tôn trọng `$q$`, `$than$`, `$fn56$` lồng và chú thích `--`; số hàng < 100, hàng không đủ 6 ô, ô đầu không đọc
    được tên ⇒ **NÉM** — vế chống mù suy từ chính tệp); ⒝ mục PHÁN XÉT := ô câu sửa là literal no-op đóng (`SELECT 1`,
    `DO $x$ BEGIN END $x$`), literal ngắn không mang từ khoá DDL ⇒ NÉM "khuôn LẠ"; ⒞ khoá tra cứu = hằng đứng ở ô hậu điều
    kiện **ở vị trí một QUAN HỆ** (`FROM ($q$ || X || $q$)`), ngược lại TÊN MỤC — phân biệt với hằng ở vị trí GIÁ TRỊ SO SÁNH
    (`prosrc = $q$ || THAN_PHAN_TACH || $q$`: mười hằng `THAN_*`/`CHU_KY_*` là văn bản chuẩn, không phải cơ chế); ⒟ hai phán
    xét NGOÀI `bang` (`CAU_MEMBERSHIP_LA`, `CAU_ADMIN_LA` đẩy thẳng vào `loi_gom` ở BƯỚC 3). Vùng tra cứu là ba khối ADR-028
    / ADR-036 / ADR-037 SAU KHI bỏ mọi `~~…~~`; định danh so bằng biên từ, tên mục so nguyên văn.

    ⑵ **TÀI LIỆU.** ADR-036 §2: hàng **24** (khoản 86 — bảng đa tổ chức không cột `org_id`, khoá ngoại tới bảng tenant),
    hàng **25** (bảng sổ trôi hình dạng cột — tách khỏi hàng 10 vì cơ chế khác: mất lớp tự chữa trigger nối chuỗi trong im
    lặng), tên hằng vào hàng 2 (ghi rõ đây là chiều NGƯỢC: giữ cho trigger ném CỦA TA sống), 4, 6, 10 (thêm `CAU_DOC_VONG`),
    12 (ghi rõ cột đổi nghĩa thành "lớp ĐÒI cơ chế phải có", sửa cột Đo từ `n/a`), 16 (thêm tên mục viết thẳng SQL); §1 nói ra
    phạm vi danh mục đã rộng hơn câu hỏi gốc. ADR-028 §7: gọi đúng tên loại bảy mục canh sổ — BỐN phán xét, BA tự chữa — và
    bỏ mệnh đề "thu hồi quyền đã cấp thì không đơn điệu" vì nó ngược §2⑵ và ngược mã (`REVOKE … CASCADE` chạy ở lượt sửa).
    ADR-037 §4: `CAU_NEO_SUA` / `CAU_NEO_SAI` (tám vế) / `VI_TU_PHAI_NEO`.

    ⑶ **ĐO.** 107 hàng × 6 ô; 22 mục phán xét (21 câu sửa `SELECT 1` + 1 `DO $hd$ BEGIN END $hd$`); 24 hằng ở vị trí quan hệ
    + 2 tên mục + 2 hằng ngoài `bang` = 28 khoá tra cứu, tất cả có dòng lý do sau vòng này. Trước vòng: 11 khoá thiếu, trong
    đó mục *không có overload lạ của bốn hàm chuỗi kiểm toán* — một mục CHẶN ĐƯỢC DEPLOY mà `DECISIONS.md` không có một chữ.

    ⑷ **ĐỎ ĐO ĐƯỢC, CÔ LẬP (5 đột biến, khôi phục trước mỗi ca):** M1 bỏ khoá "TÊN MỤC" ⇒ ca "hardening mọc thêm một mục
    phán xét viết thẳng SQL" xanh giả; M2 bỏ vế ngoài `bang` ⇒ mất `CAU_MEMBERSHIP_LA`; M3 bỏ việc loại vùng đã gạch ⇒ một
    dòng lý do bị `~~gạch~~` vẫn xanh; M4 bỏ NÉM khi bộ đọc thấy 0 hàng ⇒ đổi khuôn `bang` là cổng xanh trên tập rỗng;
    M5 bỏ NÉM khuôn no-op lạ ⇒ `SELECT 2` lặng lẽ xếp vào tự chữa.

    ⑸ **LƯỢT SOI 41 (trên bản đầu): 2 CAO, 4 NẶNG, 4 NHẸ, 4 INFO — xử lý hết ở bản ba.** CAO-1 bản đầu lấy trục là hình dạng
    chuỗi ô hậu điều kiện ⇒ mù với hai mục phán xét thật và đếm dư bốn hàng tự chữa; lời đo "24/24" là **tính đầy đủ giả** vì
    mẫu số sai. CAO-2 hai phán xét ngoài `bang`. NẶNG-1 `includes` trên cả tệp là rỗng ruột (`CAU_DOC_VONG` chỉ được nhắc như
    một dấu ngoặc phụ). NẶNG-2 bốn chỗ ngữ nghĩa sai ở tài liệu, một chỗ ngược §2⑵. NẶNG-3 sàn `= 24` ghim tay và thông điệp
    chẩn đoán ngược. NẶNG-4 chỗ thu hẹp không khai. NHẸ-1 cổng hardening đếm vào H20. NHẸ-2 đột biến chỉ phủ RENAME. NHẸ-3/4
    regex không neo vào ô, `includes` không biên từ. Ba lỗi tự tìm khi cài bản hai, ghi để không ai gặp lại: một regex
    `\$(\w*)\$…\$\1\$` khớp LỆCH trên thân hàm plpgsql mang `$1`/`$than$`; `String.replace` với chuỗi thay thế chứa `$'`
    ăn mất một ô (cùng bẫy đã đo ở S1.44); `[^']*` trong regex vấp dấu nháy của `string_agg(x, ', ')`; và `dotBien` của cổng sổ nợ (H20) dùng CHUỖI thay thế nên khi hàng 93 mới
    mang `$x$ BEGIN END $x$`, hai đột biến P0/P1 lặng lẽ XANH — sửa sang hàm thay thế, một dòng, cùng bài học.

    **Số đo:** `hardening-co-ly-do.test.ts` 7/7; `so-no-tu-doi-chieu.test.ts` 37/37 (P11 chuyển đi); t0 **211 module** / 0 vi
    phạm; năm đột biến đỏ cô lập; không mã sản xuất, không migration, không GRANT; **37 ADR** (ADR-028 §7, ADR-036 §1/§2,
    ADR-037 §4 ghi thêm). Sổ nợ **93 khoản, 15 còn mở** — đóng 93; mười một có hình dạng mã nguồn.

65. **[2026-09-11] S1.50 — KHOẢN 91 ĐÓNG: CỬA RA "BẬT RLS ⇒ KHAI 83⑶" HẾT YẾU — MỌI VIEW/MATVIEW PHẢI `security_invoker`, VÀ
    HARDENING FORCE MỌI BẢNG BẬT RLS. KHOẢN 94 MỞ. MÃ SẢN XUẤT, VÒNG NHỎ.**

    ⑴ **LỚP.** ⒜ Mục (C) `CAU_DOC_VONG` bỏ VẾ ĐÍCH cho nhánh view/matview: mọi view/matview trong lược đồ dự án phải
    `security_invoker` (matview thì khai `NGOAI_LE_DOC_VONG`), đối xứng với nhánh SECDEF vốn không có vế đích từ S0.
    ⒝ Mục TỰ CHỮA mới với hằng `VI_TU_FORCE_THIEU`: `relkind IN ('r','p') AND relrowsecurity AND NOT relforcerowsecurity`
    trong `MAU_SCHEMA_DU_AN`, trừ đối tượng thuộc extension — hardening chạy `ALTER TABLE … FORCE ROW LEVEL SECURITY` ở
    lượt SỬA. ⒞ Regex `security_invoker` nhận đủ bộ boolean của PostgreSQL (`t|tr|tru|true|y|ye|yes|on|1`).

    ⑵ **ĐO (`db/rls-coverage.int.test.ts`, describe S1.50).** Fixture dựng dưới một vai chủ KHÔNG superuser (`zz_chu91`):
    bảng chỉ ENABLE ⇒ app_api đọc thấy `[777, 888]` qua view non-invoker nhưng chỉ `[777]` khi đọc THẲNG bảng — lỗ nằm ở
    đường view, không ở quyền; `migrate()` (ném ở 83⑶ vì bảng chưa khai, nhưng lượt SỬA đã COMMIT) ⇒ `relforcerowsecurity`
    bật ⇒ cùng view trả `[777]`. Mục (C) thấy đúng bốn đối tượng — view thường, **view lồng** (`v2` trên `v1` đã invoker),
    **view đọc qua hàm** (`v3` trên `zz_s91.f()`, không chiếu `org_id`), matview — và `v1` được tha; `migrate()` NÉM nêu
    nguyên văn thông điệp; đặt cờ (`= yes` cho một view) ⇒ mục im.

    ⑶ **RANH GIỚI NÓI RA.** Sau FORCE, chủ bảng chịu RLS ⇒ bảng có policy chỉ áp cho vai ứng dụng làm chủ bảng đọc/ghi
    0 hàng không lỗi — **khoản 94**; hôm nay không ca nào (policy của `caller_rate_limits` là PERMISSIVE `TO PUBLIC`, hai
    lượt dọn chạy dưới `app_api`). Cổng khoản 93 chỉ đòi khoá tra cứu cho mục PHÁN XÉT nên mục TỰ CHỮA mới nằm ngoài tầm
    (lượt soi 42 NẶNG-4) — dòng lý do viết tay vào ADR-036 hàng 7. Bảng SAO CHÉP dữ liệu tenant không `org_id` và không
    khoá ngoại vẫn ngoài mọi vị từ (ranh giới cũ của khoản 86, không phải hồi quy của vòng này).

    ⑷ **ĐỎ ĐO ĐƯỢC, CÔ LẬP (4 đột biến):** M1 bỏ mục FORCE ⇒ "lượt SỬA phải FORCE" đỏ; M2 chủ thể FORCE quay lại danh
    sách khai (bản đầu) ⇒ cùng khẳng định đỏ — đây chính là bằng chứng CAO-1: bản đầu KHÔNG có đột biến nào làm nó đỏ;
    M3 trả lại vế đích của (C) (bản S1.46) ⇒ "(C) phải thấy cả bốn" đỏ với `[]`; M4 regex chỉ `true|on|1` ⇒ `= yes` bị
    kêu oan.

    ⑸ **LƯỢT SOI 42 (trên bản đầu): 2 CAO, 4 NẶNG, 4 NHẸ, 4 INFO — xử lý hết ở bản hai.** CAO-1 mục FORCE bị mục S1.14 che
    hoàn toàn ⇒ no-op, vi phạm ADR-028 §2⑷ ⇒ chủ thể đổi sang tính chất. CAO-2 fixture thuộc superuser ⇒ lỗ rò đo được
    KHÔNG do thiếu FORCE (superuser bỏ qua RLS ở mọi cấu hình) ⇒ dựng vai chủ thường. NẶNG-1 vế đích hụt hai đường ⇒ bỏ vế
    đích. NẶNG-2 chủ thể là danh sách tên không kèm lý do (§2⑴). NẶNG-3 ⇒ khoản 94. NẶNG-4 cổng 93 mù với mục tự chữa ⇒ nói
    ra. NHẸ-1 thông điệp nói "83⑶/85/86" trong khi 85/86 đòi `NOT relrowsecurity` ⇒ viết lại. NHẸ-2 `NGOAI_LE_DOC_VONG` là
    cửa ra yếu nhất tệp (một trục, không bản test, không chiều khai thiu, `NOT IN` gặp NULL làm cả mục im) — chưa sửa,
    ghi vào ⑹. NHẸ-3 regex boolean. NHẸ-4 thiếu khẳng định lớp sản xuất ⇒ thêm `migrate()` NÉM.

    ⑹ **ĐIỀU MANG SANG:** `NGOAI_LE_DOC_VONG` nay là cửa ra của MỌI view/matview nên nó phải được siết như bốn danh sách
    khai khác (khoá theo `(loại, schema, tên, lý do)`, hàm ghim `regprocedure`, `NOT EXISTS` thay `NOT IN`, chiều khai thiu,
    bản đối chiếu ở test) — vòng sau.

    **Số đo:** `rls-coverage.int.test.ts` 38/38; t0 211 module / 0 vi phạm; bốn đột biến đỏ cô lập; hardening:
    `VI_TU_FORCE_THIEU` + một mục `bang`, `CAU_DOC_VONG` (bỏ vế đích, regex boolean, hai thông điệp); không migration đánh
    số, không GRANT, không bảng mới; **37 ADR** (ADR-036 hàng 7 và hàng 10 ghi thêm). Sổ nợ **94 khoản, 15 còn mở** — đóng
    91, mở 94; mười một có hình dạng mã nguồn.

> **[S1.66 / lượt soi ngang 59c NẶNG-1] Nhật ký đánh số dừng ở mục 65 (S1.50).** Biên bản của S1.51–S1.65 chỉ nằm ở
> `evidence/security-reviews.md`, đầu mục `# §S1.51` tới `# §S1.65`. Mười lăm hàng sổ nợ (10, 67, 70, 80, 92, 94–101, 106, 107)
> từng dẫn tới những mục 66 tới 80 chưa bao giờ được viết ở đây; S1.66 gạch cả mười sáu con trỏ ấy, trỏ sang §S1.xx, và
> `[INV-H20]` P11 nay đòi mọi con trỏ mục nhật ký hay §S1.xx chưa gạch trong thân sổ nợ trỏ tới một mục có thật.

## Tham chiếu

| Tài liệu | Nội dung |
|---|---|
| `docs/TIEN-DE-CHUA-DO.md` | **17 tiền đề về CON NGƯỜI và QUY TRÌNH mà S1 đang cư xử như thật.** Mỗi dòng trỏ tới một chỗ có địa chỉ trong kho, kèm *sai thì mất gì* và **một câu hỏi cho người mua thật**. KHÔNG thay một khách hàng pilot — nó hạ chi phí của buổi làm việc đầu tiên |
| `docs/PRODUCT.md` | Định vị, phạm vi, ràng buộc sản phẩm, những điều không được tuyên bố |
| `docs/ARCHITECTURE.md` | Kiến trúc hiện tại |
| `docs/DECISIONS.md` | ~~**Mười hai ADR**~~ ~~**Mười lăm ADR**~~ ~~**Mười tám ADR**~~ ~~**Mười chín ADR**~~ ~~**Hai mươi ADR**~~ ~~**HAI MƯƠI LĂM ADR**~~ ~~**HAI MƯƠI SÁU ADR**~~ ~~**HAI MƯƠI BẢY ADR**~~ ~~**HAI MƯƠI TÁM ADR**~~ ~~**HAI MƯƠI CHÍN ADR**~~ ~~**BA MƯƠI ADR**~~ ~~**BA MƯƠI MỐT ADR**~~ ~~**BA MƯƠI HAI ADR**~~ ~~**BA MƯƠI BA ADR**~~ ~~**BA MƯƠI BỐN ADR**~~ ~~**BA MƯƠI LĂM ADR**~~ ~~**BA MƯƠI SÁU ADR**~~ **BA MƯƠI BẢY ADR** (**026** artefact neo ngoài, **027** biên giới module là một tính chất, **028** ranh giới tự chữa/phán xét của hardening) — và lần thiu này là lần **thứ hai** của cùng một dòng: S1.20 thêm ADR-028 mà không sửa con số, đúng như dòng cảnh báo ngay sau đây đã tự nói về chính nó. `[INV-H20]` P5 nay đọc **mọi** lời khai chưa bị gạch trong tệp này, nên hai lời khai lệch nhau (mục *Cột mốc* khai 28, dòng này khai 27) là ĐỎ — dòng này đã thiu qua bốn vòng (021–024 ra đời mà con số không đổi; [S1.15] đối chiếu và sửa): 001–010 và 012–019 *Đã chấp nhận*; **021** (vai ứng dụng là thành viên), **022** (`/auth/link` chỉ xếp hàng), **023** (việc SAU COMMIT của runner), **024** (bộ đếm người gọi ngoài cây tenant), **025** (bảng tenant dọn được mà không đọc được) *Đã chấp nhận*; **020** (tầng HTTP của `apps/api`) *Đã chấp nhận* 2026-09-06, mở S1.10; ~~**011** (định dạng phong bì + chữ ký biên nhận) ***Đang mở***, chặn S1.4/S1.5 và **chỉ được chốt sau khi đo Zalo/Android** (khoản nợ 23).~~ **011 chốt 2026-09-04 cho mục 1** (P-256 mặc định, X25519 cơ hội); mục 2 (thuật toán chữ ký biên nhận) và mục 3 (xoay khoá ký) còn mở nhưng **không chặn S1.4**. **019** nơi cặp khoá RFQ ra đời (S1.4). **013** phạm vi sổ NCC (S1.1), **014** nơi cưỡng chế máy trạng thái RFQ (S1.2), **015** kênh OTP + nền giới hạn tần suất (S1.3). **016** cổng quyền ở tầng ứng dụng + danh tính là dẫn xuất, **017** chính sách tính `requires_dual_approval`, **018** pepper cho băm đích — ba ADR của ba MEDIUM mà vòng sửa an ninh cố ý không đóng bằng mã |
| `docs/TEST-PLAN.md` | ~~**Sổ đăng ký 47 bất biến** (34 nghiệp vụ + 13 hàng rào)~~ ~~**Sổ đăng ký 49 bất biến** (34 nghiệp vụ + **15** hàng rào; H14/H15 thêm ở S1.1)~~ ~~**Sổ đăng ký 51 bất biến** (34 nghiệp vụ + **17** hàng rào~~ ~~[S1.21] **Sổ đăng ký 54 bất biến** (34 nghiệp vụ + **20** hàng rào~~ ~~**Sổ đăng ký 55 bất biến** (34 nghiệp vụ + **21** hàng rào)~~ **Sổ đăng ký 56 bất biến** (34 nghiệp vụ + **22** hàng rào; H19 ở S1.20, H20 ở S1.21 — và dòng này thiu BA đơn vị ở cả hai con số cho tới khi review lượt 13 bắt được, cách lời khai số ADR đúng MỘT hàng bảng. `[INV-H20]` P6 nay đọc nó, nguồn là số HÀNG của sổ đăng ký; H16 ở S1.2, **H17 ở S1.10.2** — mọi route ghi của `apps/api` khai mã quyền), bảy tầng kiểm thử, evidence pack |
| `evidence/INV-matrix.md` | **Ma trận bất biến** — sinh tự động, không sửa tay |
| `evidence/security-reviews.md` | **Dấu vết review an ninh** — ~~một dòng mỗi task, commit được review, môi trường đo, phát hiện theo mức, commit đóng~~ **[S1.42, 33b #11]** một mục `# §S1.x` cho mỗi vòng có bề mặt an ninh (bề mặt, đo, đỏ đo được) và một bảng *Lượt soi đối kháng N* cho mỗi lượt soi (dọc và ngang), mỗi hàng: mức, phát hiện, đo được, xử lý |
| `docs/superpowers/specs/2026-08-26-trustprocure-s0-s1-design.md` | Đặc tả thiết kế S0+S1 đã duyệt |
| `docs/superpowers/plans/2026-08-27-s0-foundation.md` | Kế hoạch triển khai S0 — 11 task, 92 bước |
| `Vibe Coding/CLAUDE.md` | Phương pháp làm việc (bản copy thủ công — xem Vấn đề đã biết 2) |
