# Đề xuất — tạo tổ chức đầu tiên, người dùng và vai trên prod

> **Ngày:** 2026-09-27 · **Vòng:** S1.171 · **Trạng thái:** **ĐỀ XUẤT, chờ chủ dự án chọn.** Chọn xong thì quyết định
> thành một ADR, bước 8.1 của `docs/APPLY-LAN-DAU.md` trỏ về ADR ấy, và tệp này giữ lại làm hồ sơ cân nhắc.
>
> Tệp này trả lời một câu: **ngày đầu tiên trên prod, ai tạo tổ chức của khách, những người dùng của họ và vai của từng người,
> bằng đường nào?** Hôm nay không có đường nào. Mục 1 là phép đo, mục 3 là ba phương án, mục 4 là khuyến nghị, mục 6 là
> những câu chỉ chủ dự án chốt được.

---

## 1. Bài toán — đo trên `master` ngày 2026-09-27

**Không có đường nào tạo tổ chức, người dùng hay gán vai trên prod.**
- `app_api` không có INSERT trên `organizations` — cố ý. Chú thích ở `db/migrations/002_organizations_and_users.sql`
  giải thích: *"Một tổ chức không tự đẻ ra tổ chức khác; việc mở tài khoản khách hàng thuộc đường vận hành, không thuộc
  app_api."*
- `app_api` có INSERT theo cột trên `users` (`002`) và `user_roles` (`005`), nhưng không route nào dùng hai quyền ấy.
- Mã quyền `role.grant` tồn tại nhưng **cố ý chưa thuộc vai nào**: *"fail-CLOSED cho tới khi một migration đánh số MỚI
  quyết định ai được quản trị vai trò"* (`005_identity.sql`). ADR-016 cũng để ngỏ câu ấy.
- `deploy/Dockerfile` có sáu đích — `api`, `worker`, `migrate`, `web`, `public-keys`, `neo` — và không đích nào làm việc
  này. Hai công cụ chèn được tổ chức đều là công cụ DEV và không có trong ảnh nào: `tools/gieo-demo` tự khai *"KHÔNG
  PHẢI MỘT ĐƯỜNG SẢN XUẤT"* và in token dạng rõ; `tools/pilot-gia-lap` chỉ nhận CSDL cục bộ.

**Hệ quả thứ nhất — triển khai kẹt ở bước 8.** Worker giải mã từ chối khởi động khi danh sách tổ chức rỗng
(`apps/unseal-worker/src/tien-trinh.ts`: *"0 tổ chức là một cấu hình KHÔNG DÙNG ĐƯỢC"*), và ADR-066 để `desired_count = 0`
tới khi có tổ chức đầu tiên. Không tạo được tổ chức thì bước 8.2 cũng không làm được.

**Hệ quả thứ hai, đo thêm ở vòng này — người dùng đầu tiên không có đường đăng nhập qua giao diện.**
- Đăng nhập của người mua là link một lần cộng TOTP. Link được xin qua `POST /auth/link` với `{orgId, email}`
  (`apps/api/src/routes/auth.ts`). **Không trang nào trong `apps/web` gọi route này** — hôm nay chỉ công cụ giả lập gọi.
- Thư đăng nhập qua SES chứa `…/login#<token>`, **không kèm mã tổ chức** (`apps/api/src/adapters/gui-ses.ts`), dù bộ gửi
  nhận `orgId` trong thông điệp.
- Trang `/login` đòi cả hai: *"Cần cả mã tổ chức và mã đăng nhập."* (`apps/web/trang/mo-thau.js`). Người dùng phải tự gõ
  một UUID tổ chức.
- `POST /users/:userId/mfa-reset` không cứu được ngày đầu: nó đòi hai người quản lý đã đăng nhập, khác người và khác
  phiên.

**Hệ quả thứ ba — sổ kiểm toán của tổ chức mới rỗng.** Không hành động nào của việc tạo tổ chức, tạo người dùng hay gán vai
để lại hàng sổ; mã hành động cho ba việc ấy chưa tồn tại. Chuỗi sổ của một tổ chức chỉ bắt đầu ở hàng đầu tiên mà sản
phẩm ghi, và công cụ neo in `SO RONG` cho một chuỗi rỗng.

## 2. Một tổ chức cần gì trước lần dùng thật đầu tiên

Chỉ ba thứ cần một đường vận hành. Mọi thứ khác đi qua sản phẩm, hoặc tự sinh ở lần dùng đầu:

| Thứ | Ai tạo | Ghi chú |
|---|---|---|
| Hàng `organizations` (tên, `slug` duy nhất) | **đường vận hành** | RLS FORCE: vế WITH CHECK `id = app_current_org_id()` áp cho mọi vai không SUPERUSER hay BYPASSRLS, kể cả chủ bảng |
| Hàng `users` | **đường vận hành** | Email phải viết thường (`048`); `status` mặc định `ACTIVE` |
| Hàng `user_roles` | **đường vận hành** | Hai trigger chặn cặp vai trái luật lúc chèn: D3, và `033` — không ai giữ `policy.manage` cùng `rfq.create` hay `rfq.approve` |
| Chính sách mua sắm | sản phẩm | FINANCE khai qua `POST /policy`. Chưa có chính sách thì đặt ngân sách và chấm thầu đều từ chối |
| Nhà cung cấp, liên hệ | sản phẩm | PROCUREMENT_MANAGER, qua `/suppliers` |
| Cặp khoá tổ chức | tự sinh | Ở lần mở gói thầu đầu tiên của tổ chức |
| TOTP của từng người | tự sinh | Ở lần đổi link đăng nhập đầu tiên, có hàng sổ `MFA_ENROLLED` |

**Số người.** Kịch bản §11 cần ít nhất hai người cho gói dưới ngưỡng và ba người cho gói trên ngưỡng
(`docs/PRODUCT.md`); cỡ tối thiểu cho trọn kịch bản chưa đo. Pilot giả lập dùng bảy người mỗi tổ chức — BUYER, ba
PROCUREMENT_MANAGER, hai DIRECTOR, FINANCE — và gọi đó là cỡ *đủ*. Kịch bản nghiệm thu của S3 (spec S3 §7) cũng dùng
bảy người. Bản khai của phương án A vì thế phải nhận một danh sách người tuỳ ý, không phải một bộ vai cố định.

## 3. Ba phương án

### A. Một task ECS chạy một lần — `tp-khoi-tao`, cùng khuôn `tp-migrate` và `tp-neo`

Một công cụ mới, `tools/khoi-tao-to-chuc`, đọc một bản khai — tên, `slug`, danh sách `{email, họ tên, vai}` — và trong
**một giao dịch**:
1. đặt `app.org_id` bằng một UUID sinh sẵn, rồi chèn tổ chức với đúng `id` ấy — vị từ RLS của `organizations` nhận hàng
   này, vì `id` bằng tổ chức đang gắn;
2. chèn người dùng và vai. Trigger D3 và `033` chạy như với mọi lần gán vai;
3. ghi một hàng sổ cho việc tạo tổ chức và một hàng cho mỗi lần gán vai (`actor_type` `SYSTEM`) — chuỗi sổ có hàng đầu
   tiên từ ngày đầu, và lượt neo đầu tiên có gì để neo;
4. **không** tự xếp job gửi link đăng nhập. Một job do task chèn sẽ nằm chờ mãi: tiến trình `api` chỉ quét hàng đợi
   của những tổ chức mà chính nó đã thấy xếp việc (`apps/api/src/composition.ts`, khoản 156), còn worker không nhận
   loại job này. Link đầu tiên đi bằng một lời gọi `POST /api/auth/link` `{orgId, email}` cho mỗi người, qua ALB, sau
   khi task xong — lời gọi ấy xếp việc và đánh thức bộ chạy ngay trong `api`. Cần sửa thư đăng nhập trước (mục 4, việc 2).

Công cụ đóng gói thành đích `khoi-tao` của `deploy/Dockerfile` và task definition `tp-khoi-tao` trong stack `90-ecs`,
chạy bằng `aws ecs run-task` như `tp-migrate` và `tp-neo`, dưới vai deploy và environment `prod` có người duyệt
(ADR-067). Cùng công cụ, chế độ thứ hai, thêm người vào một tổ chức đã có — cho tới ngày có màn quản trị vai.

- **Được:** không mở thêm bề mặt HTTP nào; đi đúng đường tin cậy mà migrate và neo đã đi; có sổ; lặp lại được với mỗi
  khách mới; không ai gõ SQL trên prod.
- **Mất:** một đích Dockerfile, một task definition, một vai CSDL (xem mục 5), một công cụ có test tích hợp trên Postgres
  thật — cộng phần hạ tầng mà `tp-neo` đã phải có:
  - kho ECR `tp-khoi-tao` (stack 90) và tên kho ấy trong quyền đẩy ảnh của vai deploy (stack 30);
  - một task role đọc được `tp/khoi-tao/*`, có mặt trong danh sách vai mà vai deploy được chuyển cho task (stack 30 — một
    thay đổi IAM);
  - secret chứa URL CSDL của vai đăng nhập hẹp (mục 5, lựa chọn ⒝);
  - nối build, đẩy, đăng ký và chạy trong `deploy.yml` và `deploy/trien-khai.sh`;
  - một nhóm bảo mật riêng cộng luật vào CSDL, hoặc dùng lại nhóm của `tp-migrate`.

  Bản khai mang email của nhân viên khách: truyền qua `containerOverrides` thì email nằm trong CloudTrail — xem câu hỏi ②
  ở mục 6.
- **Cỡ:** vừa đến lớn — khoảng hai vòng, chưa kể một lần apply lại stack 30 và 90.

### B. Route quản trị qua HTTP

Một đối tượng xác thực mới — người vận hành — cộng route tạo tổ chức, tạo người dùng và gán vai, cộng màn hình.

- **Được:** giao diện; về lâu dài cần một màn quản trị vai **trong từng tổ chức** đằng nào cũng phải có, vì nhân viên
  khách vào ra.
- **Mất:** đây là bề mặt tấn công lớn nhất trong ba phương án — một route **xuyên tổ chức**, ngược với mô hình RLS một
  tổ chức mỗi phiên, và ngược với chính chú thích của `002` (*"một tổ chức không tự đẻ ra tổ chức khác"*). ADR-044 đã
  gạt màn quản trị người dùng ra khỏi lát cắt demo của nó. Nó còn buộc chốt ngay câu mà ADR-016 để ngỏ: ai giữ `role.grant`.
- **Cỡ:** lớn — nhiều vòng.

### C. Sổ tay SQL chạy tay

Người vận hành nối vào RDS bằng vai master rồi chạy một tệp SQL.

- **Được:** nhỏ nhất; không mã mới.
- **Mất:** RDS nằm ở subnet riêng không có tuyến ra ngoài, không mở ra internet, và chỉ nhận cổng 5432 từ nhóm bảo mật
  của các task — nên phải mở thêm một đường vào (phiên SSM, hay `ecs exec` vào một task — hôm nay chưa bật);
  gõ tay dưới vai mạnh nhất của hệ thống; không sổ, trừ khi tệp SQL tự ghi sổ đúng chuỗi băm; không lặp lại được; email
  của khách đi qua một cửa sổ terminal. ADR-067 có tiền lệ *"lần đầu vẫn tay"* cho deploy — nhưng deploy không đụng dữ
  liệu của khách.
- **Cỡ:** nhỏ, nhưng mỗi khách mới lại trả nguyên cái giá ấy.

## 4. Khuyến nghị

**Phương án A**, kèm bốn việc:
1. **Vai CSDL hẹp riêng cho task** (mục 5, lựa chọn ⒝), không dùng vai master.
2. **Sửa thư đăng nhập để kèm mã tổ chức** — `/login#<tổ chức>:<token>` thay cho `/login#<token>`. Việc này nhỏ, đứng
   riêng được, và nên làm dù chọn phương án nào: không có nó thì người dùng nào cũng phải tự gõ UUID tổ chức, ở mọi lần
   xin link về sau chứ không riêng ngày đầu.
3. **Ghi chỗ hở vào sổ nợ, rổ A theo vế ⒞** (không triển khai được), tới khi task chạy được trên prod.
4. **Một ADR** chốt bốn câu ở mục 6.

B để dành cho màn quản trị vai trong từng tổ chức, sau pilot, khi đã có người dùng thật để hỏi họ cần gì. C chỉ nên là
đường khẩn cấp, có ghi biên bản.

## 5. Vai CSDL của task — hai lựa chọn

| | ⒜ Vai master của RDS (như `tp-migrate`) | ⒝ Vai hẹp riêng (như `app_neo`, ADR-072) |
|---|---|---|
| Quyền | Mọi thứ. ADR-061 buộc vai chạy `migrate()` phải có BYPASSRLS — tức vượt mọi vị từ RLS | INSERT (id, tên, `slug`) trên `organizations`; INSERT trên `users` và `user_roles`; SELECT trên `user_roles` và `role_permissions` (trigger D3 và `033` đọc dưới quyền người ghi); EXECUTE trên `app_current_org_id()`; ghi sổ như `app_api` (hàm nối chuỗi sổ, INSERT theo cột trên `audit_events`). Không cần policy mới: policy của các bảng tenant không có `TO`, nên đã áp cho mọi vai |
| Mã mới | Không migration | Một migration chỉ mang GRANT, như `065` của `app_neo`. Phần lớn việc nằm ở `hardening.always.sql`: dựng vai, thêm cặp thứ tư vào `CAP_HOP_LE` (hôm nay đúng ba cặp: `app_api`, `app_unseal`, `app_neo`), ghim thuộc tính (NOBYPASSRLS…) và một mục canh đúng tập quyền theo tiền lệ của `app_neo`. `tools/chay-migrate` dựng vai đăng nhập từ secret |
| Khi task có lỗi | Lỗi chạy với quyền của vai mạnh nhất | Lỗi dừng ở ranh giới của vai |

**Khuyến nghị ⒝**, cùng lý do dự án đã chọn cho `app_neo` và `app_liet_ke_to_chuc`: mỗi đường vận hành một vai, quyền đúng
việc. Nếu cần gấp cho khách đầu tiên thì ⒜ chấp nhận được **một lần**, ghi thành khoản nợ có hạn.

**Chưa đo:** vai master của RDS có BYPASSRLS thật hay không — ADR-061 và ADR-066 cùng ghi đây là câu hỏi mở cho lần
migrate đầu tiên trên RDS (khoản 15). Bước 1 của phương án A không cần BYPASSRLS, vì hàng mới mang đúng tổ chức đang gắn;
phép đo cụ thể là việc của vòng làm.

## 6. Câu chỉ chủ dự án chốt được

1. **Chọn phương án** — A, B hay C — và vai CSDL ⒜ hay ⒝.
2. **Bản khai sống ở đâu.** Truyền bản khai trong `containerOverrides` thì email của nhân viên khách nằm trong CloudTrail
   của tài khoản prod. Để nó trong Secrets Manager (`tp/khoi-tao/<slug>`, task role đọc) thì CloudTrail chỉ thấy tên
   bí mật. Khuyến nghị: Secrets Manager, và xoá bí mật sau khi task xong.
3. **Ai được chạy task.** Khuyến nghị: cùng vai deploy và cùng environment `prod` có người duyệt như lần deploy
   (ADR-067) — người chạy khác người duyệt.
4. **Thêm người về sau.** Khuyến nghị: dùng chính task này, chế độ thêm người, cho tới khi có màn quản trị vai. Câu *"ai
   giữ `role.grant`"* để lại cho màn ấy.

## 7. Không thuộc tệp này

- **Màn quản trị vai trong từng tổ chức**, và câu ai giữ `role.grant`: khuyến nghị để sau pilot (mục 4). ADR-016 để ngỏ
  ai giữ `role.grant`; ADR-044 chỉ gạt màn quản trị người dùng khỏi lát cắt demo của nó.
- **Khai chính sách mua sắm và nhà cung cấp:** đã có đường qua sản phẩm (mục 2).
- **Phần còn lại của khoản 15** — CMK, role, stack 30/50/90 chưa apply, SES ra khỏi sandbox, brandname SMS và mẫu ZNS: là
  hạ tầng và thủ tục, theo `docs/APPLY-LAN-DAU.md`. Phương án A chỉ chạy được sau các bước ấy.
