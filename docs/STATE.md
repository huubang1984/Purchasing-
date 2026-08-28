# STATE — TrustProcure V2

> Bộ nhớ trạng thái hiện tại của dự án. Đọc trước mọi việc quan trọng, đối chiếu với mã
> nguồn thật — mã, test và hành vi runtime là bằng chứng mạnh hơn tài liệu này.
> Không bao giờ ghi "đã xong / đã test / đã sửa / đã triển khai" nếu chưa thực sự kiểm chứng.

**Cập nhật lần cuối:** 2026-08-27

---

## Cột mốc hiện tại

**Giai đoạn: THIẾT KẾ — đã hoàn tất cho S0+S1, chưa bắt đầu triển khai.**

Đã xong:

- Đọc và phân tích đặc tả TrustProcure V2.1 (45 mục).
- Phân rã toàn sản phẩm thành sáu lát cắt dọc S0–S5.
- Chốt tám quyết định nền tảng (ADR-001 … ADR-007 + điều kiện hoàn thành).
- Đặc tả thiết kế S0+S1 đầy đủ, đã được người dùng duyệt.
- Sổ đăng ký 34 bất biến nghiệp vụ và kiến trúc kiểm thử bảy tầng.
- Phân rã công việc 16 hạng mục kèm ước lượng.

Chưa xong:

- Kế hoạch triển khai chi tiết theo từng bước (đang chờ skill `writing-plans`).
- Toàn bộ mã nguồn.

## Công việc đang làm

Kế hoạch triển khai S0 đã viết xong: 11 task, 92 bước, tại
`docs/superpowers/plans/2026-08-27-s0-foundation.md`. **Task 1–10 đã xong**; còn Task 11.

S0 **nhắm tới** 13 trong 34 bất biến nghiệp vụ (B3, B4, D1, D3, D5, E3, F1, F2, F3, G1,
G2, G3, G4). 21 bất biến còn lại thuộc S1 vì chúng đòi hỏi RFQ, lời mời, phong bì niêm
phong và luồng mở thầu.

**"Nhắm tới" KHÔNG phải "đã phủ", và sáu chỗ dưới đây phải đọc kèm — dòng này là thứ người
vận hành và evidence pack đọc TRƯỚC TIÊN, nên nó không được rộng hơn thực tế:**

- **E3** — sổ đăng ký (`docs/TEST-PLAN.md:82`) định nghĩa E3 bằng **năm** vế. Vế *giới hạn
  tần suất* **không có một dòng mã nào** trong toàn S0. Bốn vế còn lại có lớp và có mốc
  chết. Xem khối đầu `packages/identity/src/mfa-credentials.ts`.
- **D1** — phép **kiểm** độ tươi (`assertFreshMfa`) đã có và đã được đo, nhưng **toàn bộ
  đường đời của `sessions` chưa tồn tại trong mã sản phẩm**: không hàm nào phát token,
  tra token, hay đặt `mfa_verified_at` (`grep token_hash` trên `packages/**/*.ts` trừ
  test → rỗng). D1 là một phép kiểm ĐÚNG chưa có ai gọi.
- **D5** — được cưỡng chế cho đường đi **qua `requirePermission`**. Một lần từ chối ở tầng
  CSDL (RLS/GRANT) không sinh bản ghi nào, và một lần thử MFA thất bại **cố ý** không ghi
  sổ (ADR-008).
- **G2** ("mỗi RFQ một cặp khoá; lộ một RFQ không lan sang RFQ khác") — **CHƯA PHỦ**, và đó
  là câu trả lời đúng chứ không phải một hồi quy. Khoá **theo RFQ** đòi RFQ, thứ thuộc S1;
  `packages/crypto-keys/src/roundtrip.test.ts:47` đã **tự ghi ra** rằng nó cố ý không gắn
  `[INV-G2]` vì lý do ấy. Số test mang `[INV-G2]` trong toàn repo hôm nay là **0** — trước
  vòng fix 1 của Task 9 có năm test mang nhãn đó, nhưng chúng đo **quy tắc biên giới
  depcruise** (nay là `[INV-H11]`), không đo G2. Cái S0 thật sự có là bọc khoá **theo tổ
  chức** có phiên bản, thứ nuôi G1/G3.
- **G4** ("mọi thao tác khoá — sinh, bọc, mở bọc, huỷ — đều sinh audit") — **CHƯA PHỦ**.
  Đo: `grep "\[INV-G4\]"` trên toàn repo (`*.ts` + `*.md`) → **0 hit**; `grep audit` trên
  `packages/crypto-keys/src/*.ts` trừ test → **0 hit**. Thứ đã có là **hạ tầng ghi**
  (`004_audit_chain_functions.sql`, nhóm B3) — không một thao tác khoá nào GỌI nó. Hàng G4
  của `evidence/INV-matrix.md` sẽ trống; nó trống vì chưa có lớp, không vì thiếu nhãn.

- **C2 / D4** — **CHƯA PHỦ**, và Task 10 (outbox) **cố ý không** làm chúng trông như đã phủ.
  Brief của task đó liệt kê C2, D4 (và B3) là "bất biến liên quan" và gắn `[INV-C2]` cho một
  test; cả ba thẻ đều bị bỏ, mỗi thẻ một phép đo. **C2**: chủ ngữ của nó — RFQ, `deadline_at`,
  báo giá muộn — chưa tồn tại trong 001–007, nên test "kind lạ chuyển sang FAILED chứ không
  treo" đo một tính chất THẬT của runner nhưng không đo C2. **D4** đòi cảnh báo *tức thì* còn
  outbox là POLL, độ trễ của nó bị chặn dưới bởi `pollIntervalMs`; đường đúng là
  `NOTIFY`/`LISTEN` hoặc một đường đồng bộ. **B3** thuộc chuỗi hash của `audit_events` và đã
  được Task 6 phủ thật; Task 10 chỉ làm cho một job neo chuỗi TƯƠNG LAI không tự khoá mình
  vĩnh viễn. Số **test** mang `[INV-C2]` và `[INV-D4]` trong toàn repo vẫn là **0** (chuỗi thẻ
  có xuất hiện trong chú thích và trong chính lớp canh — thứ được đo là thẻ nằm trên tên một
  `it(...)`, đúng thứ bộ sinh của Task 11 gom). Lớp cưỡng chế cho câu này:
  `packages/outbox/src/nhan-bat-bien.test.ts`. Bất biến DUY NHẤT mà Task 10 mở rộng là **F1** —
  `outbox_jobs` là một bảng tenant mới, cách ly bằng RLS + FORCE ở tầng CSDL, và runner của nó
  chạy dưới `app_api` chứ KHÔNG dưới một role vượt RLS.

**LỆCH SỐ CẦN TASK 11 HOÀ GIẢI, ghi ra thay vì để nó tự lộ:** dòng trên đếm 34 bất biến
nghiệp vụ, còn sổ tay tiến trình có chỗ ghi ngưỡng "23/44". Hai con số đếm hai thứ khác
nhau (34 = nhóm A–G; **47** = A–G cộng **13** bất biến hàng rào nhóm H sau khi H11/H12 rồi
H13 được đăng ký ở `docs/TEST-PLAN.md` §5). `evidence/INV-matrix.md` của Task 11 phải nói rõ
con số nào là thật và đếm cái gì — đó đúng là việc evidence pack sinh ra để làm.
**H13 (vòng fix 1 của Task 10)** đăng ký họ quy tắc `g4-` cho `packages/outbox`: một import
TƯƠNG ĐỐI xuyên gói vào `packages/outbox/src/runner.js` đi lọt cả `depcruise`, `tsc` lẫn
`eslint` — lần thứ BA cùng một lớp lỗ. Việc con số 12→13 / 46→47 đổi thêm một lần nữa KHÔNG
làm việc hoà giải khó hơn: thứ Task 11 phải quyết là CÁCH ĐẾM, còn hai con số này chỉ cần
ĐÚNG với thực tế tại thời điểm đọc.

**BA HÀNG SẼ TRỐNG TRONG `evidence/INV-matrix.md`, VÀ ĐÓ LÀ TRẠNG THÁI ĐÚNG:** `C2`, `D4`
(xem khối trên) — cộng `G2` và `G4` vẫn không có một thẻ nào. Nguy hiểm KHÔNG nằm ở chỗ chúng
trống; nó đến khi ai đó LẤP CHÚNG BẰNG NHÃN THAY VÌ BẰNG LỚP. Và lớp canh nhãn mà Task 10
dựng (`packages/outbox/src/nhan-bat-bien.test.ts`) chỉ phủ `packages/outbox/src/` — nó KHÔNG
ngăn được một task sau gắn `[INV-D4]` hay `[INV-G2]` ở một gói khác.

## Điểm chặn

| # | Điểm chặn | Ảnh hưởng | Trạng thái |
|---|---|---|---|
| 1 | **Hook `git-safety.sh` và `protect-secrets.sh` đang fail-open** — thiếu `jq` trên máy, script lỗi ở dòng 4 và trả về `exit 0` (cho qua) | Hàng rào an toàn của phương pháp Vibe Coding hiện không tồn tại trên thực tế, dù đã cài plugin | Đã xác định nguyên nhân, đã có phương án sửa, thuộc hạng mục S0.1 |
| 2 | **Chưa có khách hàng pilot** | Rủi ro xây đúng thứ theo sai thứ tự — lớn hơn mọi rủi ro kỹ thuật | Chưa xử lý. Nên tiếp cận song song ngay từ S0 |

## Vấn đề đã biết

| # | Vấn đề | Mức | Ghi chú |
|---|---|---|---|
| 1 | Hook fail-open (xem Điểm chặn 1) | CAO | Ba lỗi độc lập: phụ thuộc `jq` không khai báo, không fail-closed, bộ pattern quá hẹp |
| 2 | `~/.claude/settings.json` chứa `ANTHROPIC_AUTH_TOKEN` dạng rõ và không nằm trong danh sách bảo vệ của `protect-secrets` | TRUNG BÌNH | Thêm vào pattern khi viết lại hook ở S0.1 |
| 3 | Thư mục `Vibe Coding/` là bản copy-paste thủ công của CLAUDE.md + 5 file SKILL, trùng lặp với plugin đã cài | THẤP | README của plugin cảnh báo sẽ gây nhầm lẫn giữa `/feature` và `/ai-eng-os:feature`. Xử lý ở S0.1 |
| 4 | Rủi ro `crypto.subtle` không khả dụng trong webview Zalo/Messenger | CAO (rủi ro sản phẩm) | Chưa đo. Cần dò tìm khả năng và hướng dẫn người dùng — xem ADR-007 |
| 5 | Hiệu năng bọc/mở khóa `local-dev` (rủi ro §8.4 của spec) | THAM KHẢO | Đo bằng `pnpm bench:keys` (Task 7, `tools/bench-keyprovider`) trên máy dev, sau fix round 1 (đã thêm AAD + validate `orgId` + rào chắn production): 10.000 lần bọc ≈ 512ms (~19.500 thao tác/giây), 10.000 lần mở ≈ 440ms (~22.700 thao tác/giây). Tham chiếu: RFQ 50 NCC × 200 hạng mục ≈ 10.000 lần mở khóa/lượt mở thầu — với tốc độ này, một lượt mở thầu tốn dưới nửa giây CPU thuần túy. Đây là mốc so sánh cho `local-dev` (mã hóa nội bộ, không qua mạng); khi có adapter KMS/Vault thật (S1.6), số liệu sẽ chậm hơn nhiều bậc vì mỗi lần bọc/mở là một lời gọi mạng — phải đo lại trước khi bắt đầu S1.6. |

## Nợ kỹ thuật

Chưa có — chưa có mã nguồn.

## Kiến trúc

Đã chốt và ghi ở `docs/ARCHITECTURE.md`. Tóm tắt: modular monolith TypeScript 11 module +
`unseal-worker` tách riêng giữ độc quyền giải mã, PostgreSQL đa tổ chức cô lập bằng RLS,
mã hóa lai thực hiện phía trình duyệt nhà cung cấp.

**Chưa có dòng mã nào hiện thực hóa kiến trúc này.**

## Trạng thái kiểm thử

Chưa có test. Kiến trúc kiểm thử đã thiết kế xong (`docs/TEST-PLAN.md`): bảy tầng T0–T6,
34 bất biến, 15 kịch bản tấn công, cộng 10 test cho chính hai hook.

`evidence/INV-matrix.md` chưa tồn tại.

## Trạng thái triển khai

Chưa triển khai. Chưa chọn hạ tầng đích, chưa chọn nhà cung cấp KMS cụ thể (quyết định ở
hạng mục S0.4).

## Hành động tiếp theo

1. Chọn cách thực thi kế hoạch S0: giao từng task cho subagent riêng, hay chạy tuần tự
   trong phiên hiện tại.
2. Bắt đầu Task 1 — **sửa hai hook và viết test chứng minh chúng chặn thật**. Đây là cổng
   chặn: không task nào khác bắt đầu trước khi việc này xong và được kiểm chứng trong một
   phiên Claude Code thật.
3. Ba quyết định cần chốt trước khi sang S1: xử lý thư mục `Vibe Coding/`, chọn nhà cung
   cấp KMS, chọn hạ tầng triển khai. Chi tiết ở cuối kế hoạch S0.

## Tham chiếu

| Tài liệu | Nội dung |
|---|---|
| `docs/PRODUCT.md` | Định vị, phạm vi, ràng buộc sản phẩm, những điều không được tuyên bố |
| `docs/ARCHITECTURE.md` | Kiến trúc hiện tại |
| `docs/DECISIONS.md` | Bảy ADR |
| `docs/TEST-PLAN.md` | 34 bất biến, bảy tầng kiểm thử, evidence pack |
| `docs/superpowers/specs/2026-08-26-trustprocure-s0-s1-design.md` | Đặc tả thiết kế S0+S1 đã duyệt |
| `docs/superpowers/plans/2026-08-27-s0-foundation.md` | Kế hoạch triển khai S0 — 11 task, 92 bước |
| `Vibe Coding/CLAUDE.md` | Phương pháp làm việc (bản copy thủ công — xem Vấn đề đã biết 3) |
