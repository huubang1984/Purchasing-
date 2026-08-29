# Kế hoạch S1 — Sealed Bid Core

> **Nguồn:** `docs/superpowers/specs/2026-08-26-trustprocure-s0-s1-design.md` §9 (phân rã 9 hạng mục),
> và `evidence/INV-matrix.md` §3 (23 mã chưa phủ) + §4 (5 mã có bảo đảm hẹp hơn mệnh đề).
> **Ngày:** 2026-08-29 · **Điểm xuất phát:** `master` tại `30d1972` (S0 đã hợp nhất).

---

## 0. Kế hoạch này được sinh ra từ đâu — và vì sao đó là điểm mạnh

S1 **không** được lập bằng cách ngồi nghĩ ra danh sách việc. Nó được lập bằng cách đọc **hai
danh sách đã tồn tại trong repo và đã được CI cưỡng chế**:

- **§3 của `evidence/INV-matrix.md`** — 23 mã chưa phủ, mỗi mã kèm **lý do đo được** vì sao
  chưa phủ. Mỗi lý do là một hạng mục công việc đã được viết sẵn.
- **§4 của cùng file** — 5 mã đang mang ô ✅ nhưng **bảo đảm thật hẹp hơn mệnh đề**. Đây
  không phải việc mới; đây là **nợ phải trả** trên thứ đã tuyên bố là xong.

Hệ quả: S1 có một **điều kiện hoàn thành đo được bằng máy** ngay từ ngày đầu, không phải một
danh sách cảm tính. Cổng `pnpm evidence` đã chạy trên CI từ S0.

**Số học của độ phủ hôm nay,** lấy từ `MOC_GHIM` trong `tools/inv-matrix/src/danh-gia.ts`:

| | Số | Ghi chú |
|---|---|---|
| Tổng mã trong sổ đăng ký | 47 | 34 nghiệp vụ (A–G) + 13 hàng rào (H) |
| Đã phủ | **24** | `MOC_GHIM.soPhuToiThieu = 24` |
| Chưa phủ | **23** | `MOC_GHIM.coDanhSachToiDa = 23` |
| ⇒ trong 24 mã đã phủ | 13 hàng rào + **11 nghiệp vụ** | cả nhóm H đã phủ trọn |

**Cả 23 mã trống đều là bất biến NGHIỆP VỤ.** Đó là chân dung chính xác của một dự án vừa
xong nền móng: hàng rào đã dựng đủ, nghiệp vụ chưa có một dòng nào.

---

## 1. Ánh xạ 23 mã trống → 9 hạng mục

Mỗi dòng: mã, mệnh đề rút gọn, **lớp cưỡng chế** (quan trọng hơn tầng test — test chỉ phát
hiện, cưỡng chế mới ngăn chặn), và hạng mục chịu trách nhiệm.

| Mã | Mệnh đề (rút gọn) | Cưỡng chế bởi | Hạng mục |
|---|---|---|---|
| **E4** | MST / mã RFQ không bao giờ là credential | Thiết kế lược đồ | **S1.1** |
| **A5** | NCC không biết danh tính/số lượng/giá NCC khác, kể cả gián tiếp qua ID tuần tự | ID không tuần tự + ứng dụng | **S1.1** + S1.9 |
| **C5** | Cặp khóa RFQ chỉ sinh đúng lúc chuyển sang OPEN | Máy trạng thái | **S1.2** |
| **C4** | Không rút ngắn deadline khi đã có báo giá; gia hạn chỉ khi OPEN, có lý do, có audit, có thông báo | Ứng dụng + audit | **S1.2** |
| **C3** | Mở thầu chỉ hợp lệ khi RFQ đã CLOSED | Cổng chính sách trong `unseal-worker` | **S1.2** (trạng thái) + S1.6 (cổng) |
| **D2** | RFQ vượt ngưỡng cần 2 phê duyệt, 2 người, 2 phiên; người tạo không được là một trong hai | Cổng chính sách + **ràng buộc DB** | **S1.2** + S1.6 |
| **A6** | Số báo giá đã nhận cũng nhạy cảm; ẩn khỏi Buyer trước CLOSED ở chế độ nghiêm | Ứng dụng | **S1.2** + S1.7 |
| **E1** | Token ≥128 bit CSPRNG, lưu dạng hash, đơn mục đích, có hạn, thu hồi được | Ứng dụng + lược đồ | **S1.3** |
| **E2** | Token một mình không đủ — luôn phải qua OTP trên kênh đã đăng ký | Ứng dụng | **S1.3** |
| **E5** | Link chuyển tiếp vẫn dùng được, nhưng ghi danh tính **thực tế đã xác thực** | Ứng dụng + audit | **S1.3** |
| **E6** | Không dữ liệu nhạy cảm trong URL, kể cả rò qua `Referer` | Thiết kế URL + Referrer-Policy | **S1.3** |
| **A2** | Giá dạng rõ không tồn tại trong `api` — kể cả bộ nhớ, log, APM trace, thông báo lỗi | **Kiến trúc**: mã hóa ở trình duyệt (ADR-007) | **S1.4** |
| **G2** | Mỗi RFQ một cặp khóa; lộ một RFQ không lan sang RFQ khác | Thiết kế khóa | **S1.4** |
| **G4** | Mọi thao tác khóa — sinh, bọc, mở bọc, hủy — đều sinh audit | Ứng dụng | **S1.4** |
| **B1** | Mỗi lần nộp tạo version mới; không UPDATE, không DELETE | **DB trigger** | **S1.5** |
| **B2** | Mỗi lần nộp sinh biên nhận có chữ ký hệ thống; NCC kiểm chứng độc lập được | Ứng dụng + chữ ký | **S1.5** |
| **C1** | Sau `deadline_at` mọi lần nộp bị từ chối; phán quyết dựa `now()` của Postgres **trong chính transaction ghi** | Ràng buộc trong transaction | **S1.5** |
| **A3** | Truy vấn SQL trực tiếp vào bảng bid, kể cả bằng role quản trị, chỉ cho ra ciphertext | Lược đồ: cột chỉ chứa ciphertext | **S1.5** |
| **A1** | Với RFQ chưa UNSEALED, không endpoint nào trả trường giá cho bất kỳ actor nội bộ nào | **Kiến trúc**: không có khóa giải mã trong `api` | **S1.6** + S1.7 |
| **A4** | Không trường phái sinh nào rò rỉ giá trước mở thầu — không min/max/tb, không đếm "dưới ngân sách", không sắp theo giá | **Bộ quét rò rỉ tự động** | **S1.7** + S1.8 |
| **C2** | Tính đúng đắn không phụ thuộc scheduler — job đóng RFQ chết không làm bid muộn được nhận | Kiến trúc (ADR-005) | **S1.8** |
| **B5** | Ciphertext lưu trữ luôn khớp hash trong biên nhận tại **mọi thời điểm về sau** | Job kiểm tra định kỳ | **S1.8** |
| **D4** | Break-glass đi đường riêng, bắt lý do, sinh cảnh báo mức cao **tức thì**, không bao giờ im lặng | Ứng dụng + audit + thông báo | **S1.8** — *chặn bởi ADR-010, xem §5* |

### 1.1 Năm mã ở §4 — nợ phải trả trên thứ đã tuyên bố xong

Năm mã này **đang mang ô ✅** và được `MA_PHAI_CO_CO_HEP` bắt buộc phải giữ ghi chú thu hẹp.
Chúng **không** nằm trong 23 mã trên và **không** làm tăng tử số — nhưng bỏ qua chúng thì cuối
S1 sẽ có 47/47 mà vẫn còn lỗ thật.

| Mã | Phần chênh phải đóng trong S1 | Hạng mục |
|---|---|---|
| **D1** | Mệnh đề **HỘI 4 vế**, chưa từng đo một lần nào như một phép hội. Vế (1) quyền và vế (2) MFA đo RIÊNG ở 2 file; vế (3) RFQ đã CLOSED và vế (4) cổng chính sách **không có một dòng mã nào**. Phải có **một hàm hợp cả bốn vế** và một test đo phép hội đó. | **S1.6** |
| **G1** | Ô ✅ chứng minh *cánh cửa đã khoá*; **căn phòng chưa xây** — `apps/unseal-worker` và `wrapped_private_key` chưa tồn tại. Xây phòng, rồi lấy lại phép đo. Khoảng trống thứ hai: 4 gói (`audit`, `tenancy`, `db`, `test-support`) chưa có danh sách trắng barrel. | **S1.4** + **S1.6** |
| **E3** | Vế *giới hạn tần suất* **không có một dòng mã nào** trong toàn S0. Bốn vế còn lại đã có lớp. | **S1.3** |
| **D5** | Chỉ cưỡng chế cho đường qua `requirePermission`. Từ chối ở tầng DB (RLS/GRANT) không sinh bản ghi nào. | **S1.6** |
| **F1** | `assertTenantBound` tự làm mù mình bằng DANH SÁCH TÊN ở hai chỗ: `NOBYPASSRLS` chỉ ghim đúng 4 tên role; hàm plpgsql ngoài danh sách không được ghim. | **S1.2** (khi thêm bảng mới) |

### 1.2 Hai mã CỐ Ý bỏ thẻ ở S0 — không được lấp bằng nhãn

`C2` và `D4` từng có test đo *một tính chất thật* nhưng **không đo đúng mệnh đề**, và Task 10
đã **cố ý** không gắn thẻ. S1 phải lấp chúng **bằng lớp**, không bằng cách gắn nhãn lên test cũ.

> **Nguy hiểm lớn nhất của S1, chép nguyên văn từ §3 của ma trận:** *"Nguy hiểm không nằm ở
> chỗ các hàng này trống. Nó đến khi ai đó **lấp chúng bằng nhãn thay vì bằng lớp**."* Chuyện
> này **đã xảy ra một lần** ở S0 — năm test mang `[INV-G2]` thật ra đo quy tắc biên giới
> depcruise, và vòng fix 1 của Task 9 phải sửa nhãn về `[INV-H11]`.

---

## 2. Chín hạng mục — thứ tự, phụ thuộc, đường găng

Ngày công lấy từ §9 của spec, giữ nguyên, **không** điều chỉnh lạc quan.

```text
S1.1 supplier ──┐
                ├─► S1.3 invitation ──┐
S1.2 rfq ───────┤                     ├─► S1.5 bidding ──► S1.7 so sánh
                └─► S1.4 sealed-env ──┘                 │
                          │                             │
                          └─────────► S1.6 unseal ◄─────┘
                                          │
                              S1.8 T5+evidence ──► S1.9 E2E
```

| Mã | Hạng mục | Ngày | Lớp mới | Bảng DB mới | Review bắt buộc |
|---|---|---|---|---|---|
| **S1.1** | Sổ NCC Level 0/1 | 2 | `packages/supplier` | `suppliers`, `supplier_contacts` | code-reviewer |
| **S1.2** | RFQ, hạng mục, máy trạng thái đầy đủ điều kiện chuyển | 4 | `packages/rfq` | `rfq_packages`, `rfq_items` | qa-engineer |
| **S1.3** | Lời mời, magic link, OTP, phiên khách | 4 | `packages/invitation` | `rfq_invitations`, `rfq_invitation_tokens` | ⭐ **security-reviewer** |
| **S1.4** | Phong bì niêm phong: vòng đời khóa, định dạng, WebCrypto phía NCC | 5 | `packages/sealed-envelope` | `rfq_key_material` | ⭐ **security-reviewer** |
| **S1.5** | Nộp báo giá, phiên bản, biên nhận, khóa theo deadline | 4 | `packages/bidding` | `vendor_bids`, `vendor_bid_versions`, `bid_receipts` | qa-engineer |
| **S1.6** | Mở thầu: cổng chính sách, phê duyệt kép, worker, giải mã | 5 | `packages/unseal` + **`apps/unseal-worker`** | `unseal_requests`, `unseal_approvals` | ⭐ **security-reviewer** |
| **S1.7** | Bảng so sánh sau mở thầu | 2 | trong `packages/unseal` | — | code-reviewer |
| **S1.8** | Hoàn thiện bộ đối kháng T5 + evidence pack | 3 | `tests/adversarial` | — | qa + ⭐ **security-reviewer** |
| **S1.9** | E2E kịch bản mục 41 | 2 | `tests/e2e` | — | qa-engineer |
| | **Tổng** | **31 ngày công** ≈ 4 tuần | | **13 bảng** | |

**Đường găng:** S1.2 → S1.4 → S1.6 → S1.8 → S1.9 = 19 ngày. S1.1/S1.3/S1.5/S1.7 chạy song
song quanh nó. **S1.6 là hạng mục nguy hiểm nhất**: nó vừa nằm trên đường găng, vừa bị chặn
bởi ADR-009 (KMS), vừa phải đóng phần chênh của **ba** mã ở §4 (D1, D5, G1).

### 2.1 `apps/unseal-worker` — hạng mục làm thay đổi bản chất một ô ✅ đã có

Hôm nay `apps/` chỉ có `.gitkeep`. Hàng rào `g1-khong-giai-ma-ngoai-unseal-worker` **đã có
răng và đã được chứng minh bằng test đối kháng**, nhưng nó đang canh một cánh cửa **chưa có
phòng ở sau**. S1.4 + S1.6 xây căn phòng đó. Khi `apps/unseal-worker` ra đời:

1. Quy tắc depcruise chuyển từ *"chưa ai vi phạm được vì chưa có gì để vi phạm"* sang
   *"có đúng một nơi được phép, và mọi nơi khác bị chặn"* — đây là lúc nó bắt đầu có giá trị thật.
2. Ghi chú thu hẹp của **G1** ở §4 phải được **viết lại**, không phải xoá: phần *"tài sản được
   bảo vệ chưa tồn tại"* hết hiệu lực, phần *"4 gói chưa có danh sách trắng barrel"* thì không.
3. Phải **đo lại bằng test đối kháng**: vô hiệu hoá quy tắc → CI phải ĐỎ THẬT. Đo, không suy.

---

## 3. Cưỡng chế ở tầng CSDL — bảng nào chặn cái gì

Bảng này là bản mở rộng của §4.2 trong spec, và là **hợp đồng bắt buộc** cho các migration
`008`–`0nn`. Mọi bảng mới có `org_id` phải có **cả `ENABLE` lẫn `FORCE ROW LEVEL SECURITY`**
— ràng buộc dự án, không thương lượng.

| Bảng | Cưỡng chế ở tầng DB | Chống điều gì | Mã |
|---|---|---|---|
| mọi bảng có `org_id` | RLS theo `current_setting('app.org_id')`, **ENABLE + FORCE** | Lập trình viên quên `WHERE org_id = ?` | F1 |
| `vendor_bid_versions` | Trigger `RAISE EXCEPTION` khi UPDATE/DELETE | Sửa lén báo giá đã nộp | **B1** |
| `vendor_bid_versions.ciphertext` | Cột chỉ nhận `bytea`; **không** có cột giá dạng số | Truy vấn quản trị đọc được giá | **A3** |
| `rfq_key_material` | **Quyền theo cột**: `app_api` chỉ SELECT được `public_key` | `api` tự giải mã | **G1** |
| `rfq_packages.deadline_at` | Kiểm tra **trong cùng transaction** ghi báo giá, có khóa hàng | Tranh chấp quanh giờ đóng | **C1** |
| `unseal_approvals` | `UNIQUE (unseal_request_id, approver_user_id)` + `CHECK (approver_user_id <> requester_user_id)` | Một người tự duyệt hai lần | **D2** |
| `rfq_invitation_tokens` | Lưu **hash** của token, không lưu token | Đọc được DB là chiếm được lời mời | **E1** |

> **Ghi chú về D2 — vế "hai phiên khác nhau".** Ràng buộc DB chặn được *"hai người khác nhau"*
> (UNIQUE + CHECK). Nó **không** chặn được *"hai phiên khác nhau"* — đó là thuộc tính của
> phiên, không của hàng. Vế đó phải cưỡng chế ở cổng chính sách và **phải được ghi vào §4 như
> một phần chênh**, chứ không được nuốt vào ô ✅ của D2.

---

## 4. Cơ chế mốc ghim — mỗi mã được lấp là ba dòng phải sửa bằng tay

Đây là điểm mà nhiều người sẽ vấp, nên nói rõ trước. Khi một mã chuyển từ ⏳ sang ✅,
`pnpm evidence` **đỏ** cho tới khi sửa đủ **ba** chỗ trong `tools/inv-matrix/src/danh-gia.ts`:

1. **Gỡ** mã khỏi `MA_DUOC_PHEP_CHUA_PHU` — một lý do "chưa phủ" đứng dưới một hàng đã phủ là
   một câu sai trong hồ sơ kiểm toán.
2. **Nâng** `MOC_GHIM.soPhuToiThieu` lên đúng tử số mới.
3. **Hạ** `MOC_GHIM.coDanhSachToiDa` xuống đúng cỡ danh sách mới.

Đây **không phải phiền toái, đây là thiết kế**. Trích nguyên văn §3.1 của ma trận:

> *"một PR sửa mã, sửa danh sách, và sửa cả hai con số cùng lúc vẫn xanh. Không phép đo nào
> chặn được điều đó. Khác biệt là lúc ấy nó là một **dòng phải sửa, có tên, trong một file có
> chủ sở hữu** (`.github/CODEOWNERS`) — không phải một sự im lặng."*

Quỹ đạo dự kiến nếu S1 chạy đúng kế hoạch:

| Mốc | `soPhuToiThieu` | `coDanhSachToiDa` | Tổng |
|---|---|---|---|
| Hôm nay (`30d1972`) | 24 | 23 | 24/47 |
| Sau S1.3 | 30 | 17 | 30/47 |
| Sau S1.5 | 37 | 10 | 37/47 |
| Sau S1.7 | 42 | 5 | 42/47 |
| **Mục tiêu cuối S1.8** | **45–47** | **0–2** | xem §5 |

**Không đặt mục tiêu 47/47 một cách vô điều kiện.** Ba mã có rủi ro trôi thật, có lý do đo
được, ghi ở §5. Một kế hoạch hứa 47/47 rồi cuối kỳ hạ mốc xuống là đúng thứ mà `MOC_GHIM` được
dựng để làm lộ ra.

---

## 5. Ba mã có rủi ro trôi, và điều kiện để chúng không trôi

| Mã | Vì sao có rủi ro | Điều kiện để đóng trong S1 |
|---|---|---|
| **D4** | Mệnh đề đòi cảnh báo **tức thì**. Outbox hiện tại là **POLL**, và độ trễ của nó bị **chặn dưới** bởi `pollIntervalMs` — không phải chuyện chỉnh tham số, mà là chuyện cơ chế. | Cần **ADR-010**: `NOTIFY`/`LISTEN` của Postgres, hay một đường đồng bộ riêng cho break-glass. Nên chốt **trước S1.6**, cùng lúc S1.6 dựng `unseal-worker`. |
| **B5** | Đòi ciphertext khớp hash **tại mọi thời điểm về sau** — tức một job định kỳ cộng một phép đo T6, không phải một assertion trong test. Ma trận ghi phạm vi **"S1/S6"**. | Làm được trong S1.8 nếu chấp nhận phạm vi hẹp: job chạy trên tập bid của một RFQ, đo bằng T3. Phần *"mọi thời điểm về sau"* ở quy mô production thuộc S6 — và **phần chênh đó phải vào §4**. |
| **C2** | Đòi chứng minh một **tính chất phủ định**: scheduler chết mà bid muộn vẫn bị từ chối. Phải **giết scheduler thật** rồi nộp, không phải mock. | S1.8 với Testcontainers: dừng job runner, đẩy đồng hồ DB qua deadline, nộp, đòi RED. Khả thi — S0 đã có hạ tầng Testcontainers cộng `pg` thật. |

---

## 6. Quyết định kiến trúc cần chốt trong S1

| ADR | Nội dung | Chặn hạng mục | Trạng thái |
|---|---|---|---|
| **ADR-009** | Nhà cung cấp KMS | S1.6 | ✅ **Đã chốt 2026-08-29: AWS KMS** — xem `docs/DECISIONS.md` |
| **ADR-010** | Đường thông báo tức thì cho break-glass (`NOTIFY`/`LISTEN` so với đường đồng bộ) | S1.6, S1.8 (D4) | ⏳ Phải chốt trước S1.6 |
| **ADR-011** | Định dạng phong bì niêm phong cộng thuật toán chữ ký biên nhận mà NCC **kiểm chứng độc lập được** (B2). **Phải ghim: phong bì mang một mã thuật toán thoả thuận khoá tường minh** | S1.4, S1.5 | ⏳ Phải chốt trong S1.4 — **và chỉ được chốt sau khi có kết quả đo Zalo/Android** (khoản nợ 23) |
| **ADR-012** | Chiến lược ID không tuần tự cho mọi thực thể NCC nhìn thấy được (A5) | S1.1, S1.3 | ⏳ Phải chốt trong S1.1 |

> **Ràng buộc bắt buộc của ADR-011, đến từ khoản nợ 23.** Phong bì phải **mang một mã thuật
> toán thoả thuận khoá tường minh**, cùng khuôn với `ENVELOPE_VERSION` đã có trong
> `packages/crypto-keys`. Lý do: phía **Android chưa từng được đo** và việc đo đã được hoãn có
> chủ đích. Với mã thuật toán trong phong bì, nếu Android hoá ra thiếu `X25519` thì việc phải
> làm là **thêm một nhánh P-256** — phong bì cũ vẫn mở được, đúng cơ chế mà `MasterKeyRing`
> dùng để giữ khả năng giải mã qua các lần xoay khoá (G3). Không có nó, cùng tình huống ấy là
> một cuộc di trú. Đây là cách biến một rủi ro **chưa đo** thành một rủi ro **rẻ**.

> **ADR-011 là cái dễ bị làm ẩu nhất.** "Chữ ký hệ thống" mà NCC *kiểm chứng độc lập được*
> nghĩa là khóa công khai của hệ thống phải **công bố được** và biên nhận phải **tự mô tả**.
> Một HMAC bằng secret nội bộ **không** thoả B2 — NCC không kiểm chứng được cái họ không có khóa.

---

## 7. Điều kiện hoàn thành S1 — đo được, không cảm tính

1. `pnpm t0` xanh; **`apps/unseal-worker` tồn tại** và quy tắc `g1-` được đo lại bằng test đối
   kháng (vô hiệu hoá → CI ĐỎ THẬT).
2. `pnpm test` cộng `pnpm test:int` xanh, **0 lần xuất hiện** `unhandled` hay `57P01` trong log.
3. `pnpm evidence` xanh, độ phủ **≥ 45/47**, và mọi mã còn trong `MA_DUOC_PHEP_CHUA_PHU` có lý
   do **thuộc S2+ hoặc S6**, không phải "chưa kịp làm".
4. Cả **5 mã ở §4** có ghi chú thu hẹp được **cập nhật** — đặc biệt **D1** phải có **một hàm hợp
   bốn vế** cùng một test đo phép hội, và **G1** phải được viết lại sau khi căn phòng đã xây.
5. Bộ T5 đối kháng chạy được **trọn kịch bản mục 41**, và mọi test đối kháng đều đã được chứng
   minh có răng (vô hiệu hoá lớp → RED thật), theo đúng thông lệ đã dùng ở Task 2, 7, 9.
6. Một buổi **security-reviewer** cho mỗi hạng mục có dấu ⭐ ở §2, ghi vào `evidence/security-reviews.md`
   theo đúng định dạng đã có: task, commit được review, môi trường đo, phát hiện theo mức, commit đóng.
7. **Không** một tuyên bố nào rộng hơn phép đo. Câu sai bị **gạch bỏ tại chỗ, giữ nguyên văn**,
   không xoá — quy ước này áp cho `.sql`, chú thích, tên test, và `evidence/INV-matrix.md`.

---

## 8. Rủi ro của S1, xếp theo mức độ

| # | Rủi ro | Vì sao thật | Giảm nhẹ |
|---|---|---|---|
| 1 | **Chưa có khách hàng pilot** | Rủi ro lớn nhất dự án, lớn hơn mọi rủi ro kỹ thuật (PRODUCT.md §10). S1 xây 4 tuần cho một nghiệp vụ **chưa ai xác nhận** là đúng với quy trình mua sắm thật. | Tiếp cận **song song**, không đợi xong S1. Kịch bản mục 41 nên được một người mua thật đọc qua trước S1.9. |
| 2 | **`crypto.subtle` trong webview Zalo/Messenger** | A2 và toàn bộ S1.4 đứng trên giả định NCC có `crypto.subtle`. Nếu webview Zalo không có, **toàn bộ đường nộp thầu của thị trường VN gãy**. Chưa có phép đo nào **trên thiết bị thật**. | Đo **TRƯỚC S1.4**, không phải sau. Máy dò đã dựng: `tools/do-webcrypto/index.html` — xem §10. |
| 3 | **Lấp mã bằng nhãn thay vì bằng lớp** | Đã xảy ra một lần ở S0 (5 test `[INV-G2]` thật ra đo depcruise). Áp lực "cho ô xanh" ở S1 cao hơn nhiều vì có 23 ô trống. | Mỗi mã được lấp phải kèm **test đối kháng**: vô hiệu hoá lớp → RED thật. Không có RED thật thì không được gỡ khỏi `MA_DUOC_PHEP_CHUA_PHU`. |
| 4 | **Hiệu năng KMS** | ADR-009 từng nêu như một trục chặn. | **Đã đo và đã đóng** — 1 lời gọi KMS mỗi lượt mở thầu, xem ADR-009. |
| 5 | **D1 vẫn ở dạng 4 vế rời** | S1.6 rất dễ viết 4 phép kiểm rời rồi gọi lần lượt. Đúng chức năng, nhưng **không** đo được phép hội, và ô ✅ lại rộng hơn phép đo. | Một hàm hợp cả bốn vế, và test đo chính hàm đó — vô hiệu hoá **từng** vế một → RED thật cho từng vế. |
| 6 | **13 bảng mới nhân RLS** | Mỗi bảng quên `FORCE` là một lỗ cô lập tổ chức im lặng. `assertTenantBound` **tự làm mù mình bằng danh sách tên** (§4, F1). | `hardening.always.sql` đã cưỡng chế 36 mục **mọi lần `migrate()`**. Mở rộng nó cho 13 bảng mới **trong cùng migration**, không để sang sau. |

---

## 9. Vòng lặp bắt buộc cho từng hạng mục

Giữ nguyên từ §9 của spec, cộng một bước mà S0 đã chứng minh là **không thể bỏ**:

```text
đọc docs/STATE.md, đối chiếu với code THẬT (không tin tài liệu)
   → /ai-eng-os:feature  (hoặc /architecture-decision nếu chạm kiến trúc)
   → viết test cho bất biến liên quan TRƯỚC
   → implement
   → ĐO BẰNG ĐỘT BIẾN: vô hiệu hoá lớp vừa viết → đòi RED THẬT   ◄── S0 dạy: bỏ bước
                                                                      này là tự lừa mình
   → qa-engineer      : chạy và bổ sung test còn thiếu
   → security-reviewer: BẮT BUỘC nếu chạm mật mã, xác thực, PII, cô lập tổ chức
   → code-reviewer
   → cập nhật MOC_GHIM (3 dòng, §4) cộng ghi chú §4 nếu bảo đảm hẹp hơn mệnh đề
   → cập nhật docs/STATE.md
   → MỘT COMMIT cho mỗi task
```

**Ba bài học S0 phải mang sang S1:**

1. **Tất cả test xanh không đồng nghĩa job xanh.** Hai lần ở S0 job đỏ trong khi 326/326 test
   xanh, vì hỏng nằm **ngoài vòng đời test** (kết nối rò rỉ lúc teardown; cổng audit phụ thuộc).
2. **Một bảo đảm phụ thuộc môi trường thì phải ĐO môi trường đó, không SUY từ `process.platform`.**
   Test phân biệt hoa-thường ở S0 xanh trên Windows và đỏ trên Linux vì đúng lỗi này.
3. **Chỉ được phân loại một lượt chạy khi output mang bằng chứng DƯƠNG rằng bộ test đã chạy** —
   và phải đòi bằng chứng dương **ở cả bước thu log**, không chỉ ở bước đọc kết quả. Một file
   log rỗng cũng "không chứa lỗi nào".

---

## 10. Máy dò WebCrypto — biến rủi ro số 2 từ "chưa đo" thành "đo trong hai phút"

`tools/do-webcrypto/index.html` là một trang tự chứa, **chạy thật** từng phép mật mã mà đường
nộp báo giá cần, ngay trên thiết bị mở nó. Nó **không hỏi** user-agent; nó bắt trình duyệt làm
việc rồi xem kết quả — cùng một nguyên tắc "đo, không suy" đã dùng khắp S0.

**Cách dùng:** mở trang bằng một URL **https** (WebCrypto không tồn tại ngoài ngữ cảnh bảo mật),
gửi link đó vào một cuộc trò chuyện Zalo hoặc Messenger, rồi **mở từ bên trong ứng dụng đó** để
webview thật là thứ được đo. Trang có nút chép kết quả dạng văn bản để dán ngược lại vào chat.

**Bốn phán quyết nó phân biệt được**, và mỗi phán quyết là một hành động khác nhau:

| Phán quyết | Nghĩa | Việc phải làm |
|---|---|---|
| Nộp thầu được | Cả đường bắt buộc lẫn X25519 chạy | §3.2 giữ nguyên |
| **Nộp được, nhưng phải đổi sang P-256** | X25519 không chạy, ECDH P-256 chạy | **Đổi ADR-011 và §3.2 TRƯỚC S1.4** |
| Đường bắt buộc gãy | `crypto.subtle` có, nhưng AES/SHA/HKDF hỏng | Hướng dẫn mở bằng trình duyệt ngoài |
| Không nộp được | Thiếu ngay điều kiện tiên quyết | Hướng dẫn mở bằng trình duyệt ngoài |

**Máy dò đã được chứng minh có răng.** `tools/do-webcrypto/phuc-vu-va-dot-bien.mjs` phục vụ trang
kèm ba đột biến (`?dot=x25519`, `?dot=aes`, `?dot=rnd`), mỗi đột biến chặn một khả năng trước khi
script chính chạy. Đo ngày 2026-08-29 trên Chrome 148:

| Đột biến | Phán quyết thu được |
|---|---|
| *(không)* | Nộp thầu được — thiết kế hiện tại chạy nguyên vẹn |
| `x25519` | **Nộp được, nhưng phải đổi sang P-256** |
| `aes` | KHÔNG nộp thầu được — đường bắt buộc gãy |
| `rnd` | KHÔNG nộp thầu được trên trình duyệt này |

Bốn phán quyết phân biệt. Một máy dò luôn báo "đạt" thì vô dụng, và đây là phép đo chứng minh
nó không phải loại đó.

> **Giới hạn, nói thẳng:** phép đo trên chạy trên **Chrome 148 desktop**, không phải trên webview
> Zalo hay Messenger. Nó chứng minh **máy dò hoạt động**; nó **không** chứng minh gì về webview
> Việt Nam. Rủi ro số 2 vẫn **đang mở** cho tới khi có ảnh chụp kết quả từ một điện thoại thật —
> lý tưởng là vài máy: Android WebView cũ, iOS WKWebView, và cả hai ứng dụng. **X25519 là chỗ
> đáng ngờ nhất**: nó chỉ có trên Chrome 133+ và Safari 17+, mới hơn nhiều so với AES-GCM.

**Việc còn lại thuộc mã sản phẩm, không thuộc máy dò này.** Ràng buộc sản phẩm số 4 (PRODUCT.md)
đòi hệ thống **tự dò khả năng và hướng dẫn rõ ràng** cho nhà cung cấp. Đó là một hạng mục của
**S1.3** (phiên khách) và **S1.4** (phong bì): cùng phép dò, nhưng chạy trong luồng nộp thầu và
dẫn người dùng sang trình duyệt ngoài khi thiếu — không phải một trang rời để kỹ sư mở tay.
