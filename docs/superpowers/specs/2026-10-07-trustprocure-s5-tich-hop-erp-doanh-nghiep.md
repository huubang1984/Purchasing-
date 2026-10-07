# TrustProcure V2 — Thiết kế S5: Tích hợp ERP và Doanh nghiệp (ERP Integration & Enterprise)

> **Ngày:** 2026-10-07 · **Trạng thái:** **BẢN NHÁP — chưa qua lượt soi hình dạng.** Viết TRƯỚC khi S3 và S4 khép, trước
> pilot, trước khi có một khách hàng nào có ERP — theo yêu cầu của chủ dự án ngày 2026-10-07 (*"Chuẩn bị trước spec S5"*).
> Cùng lựa chọn với spec S4b (ADR-098): thiết kế hình dạng bây giờ, KHÔNG viết mã; mọi con số mang nhãn GIẢ ĐỊNH; không ADR,
> không migration, không khoản nợ nào của vòng này. Câu hỏi cho chủ dự án ở §2.3; các ADR phải chốt ở lượt soi hình dạng ở
> §2.4; chỗ lượt viết tự chốt từ tiền lệ ở §2.5. Vòng viết spec này mang số tạm **S1.9101** (ADR-090).
> **Nguồn:** `TrustProcure_V2_Procurement_Control_Intelligence.md` (V2.1) — §4 *Phạm vi nghiệp vụ* (Source-to-Quote →
> *ERP PO*; ERP giữ PO → GRN → Invoice → Payment), §5 *Kiến trúc* (API / Integration → SAP, Odoo, Bravo/FAST), §13
> *Supplier Intelligence*, §16 *TCO* (*Quality Cost*), §23 *Reverse Auction*, §26 (`purchase_orders`, `supplier_scores`,
> `supplier_performance`, `webhook_events`, `integration_logs`), §27 *Audit Trail* (*export phục vụ audit*), §28 *Security*
> (*SSO cho Enterprise*), §29 *API Architecture* (ba endpoint `integrations/erp/pr`, `integrations/erp/po`,
> `integrations/webhooks`), §30 *ERP Strategy*, §34 *Enterprise*, §35 *Commercial Model* (*ERP integrations*, *Integration
> Fee*), §36 *KPI* (*ERP transactions*), §39 *Roadmap* (M10 Reverse Auction, M11 ERP Integration, M12 Enterprise Release),
> §41 *Kịch bản Demo*. Bản nguồn không nằm trong kho; vòng này đọc bản trên Drive của chủ dự án (sửa lần cuối 2026-08-26 —
> cùng bản spec S4 đã đối chiếu), và mọi trích dẫn V2.1 dưới đây là từ bản ấy.
> **Đóng (ở mức hình dạng):** spec S0+S1 §10 *Tích hợp ERP — S5* và *Đa tiền tệ, đa ngôn ngữ, SSO — Enterprise*; ADR-020
> §2 ⒞ *SSO/OIDC — Enterprise (S5)*; spec S3 §4.9 và §10 *Hiệu suất từ ERP*; spec S4 §4.8 (`chat_luong` *không có nguồn tới
> S5*), §8.13 (*cam kết TCO chưa được đối chiếu*), §10 (*Supplier Performance từ ERP*); spec S4b §7 *Supplier Score* và
> §16 (ADR-100 Q1); tiền đề B6, C4, E13 của `docs/TIEN-DE-CHUA-DO.md`; kế hoạch pilot giả lập §7 bậc 2 và §9 việc 2 (*nhập
> gói từ CSV*).
> **Nhận về, đề xuất KHÔNG làm trong S5 (§10):** Reverse Auction (V2.1 §23, roadmap M10); Custom Policy Engine, đa công ty,
> đa ngôn ngữ, Data Warehouse/BI (V2.1 §34); chia sẻ Passport xuyên tổ chức (ADR-013 §4); adapter riêng cho từng ERP.
> **Không đóng:** nguồn giá thị trường tự động (spec S4 §10); đồ thị quan hệ nhà cung cấp (V2.1 §18).
> **Đọc kèm:** spec S4b §7 (thiết kế nháp Supplier Score, giữ nguyên văn làm đầu vào) và §2.5 ㊾ (bốn cần gạt).

---

## 1. Bối cảnh — một spec viết khi chưa có khách hàng nào có ERP

Đo trên `master` `c57ea67` (merge PR #258, S1.280) ngày 2026-10-07:

- S3 còn S3.4 (K9, đang ở một nhánh khác), S3.5b, S3.6c, S3.6d, S3.7, S3.8, S3.9 chưa có mã. S4 còn S4.7b, S4.7c; S4b
  chờ cổng (e) (ADR-100 Q5), riêng S4b.1 chờ S3.5. Chưa có khách hàng pilot (`docs/STATE.md` *Điểm chặn* 1). Stack hạ tầng
  00–60 đã apply, `90-ecs` chưa (`docs/STATE.md` *Trạng thái triển khai*).
- V2.1 §39 xếp *ERP Integration* ở tháng 11 và *Enterprise Release* ở tháng 12 — SAU pilot, Governance, Intelligence và
  Reverse Auction. ADR-043 chỉ cho khoản rổ A mở vòng; ADR-080 và ADR-093 là hai ngoại lệ hẹp, cho S3.x và S4.0–S4.8.
- Mọi đầu vào của S5 ở phía dữ liệu đều chưa tồn tại: lời khai TCO lưu cùng award (S4.7c), thẩm định đầy đủ (S3.7), view
  hiệu suất (S3.8), lớp governance trong bộ bằng chứng (S3.9). Và đầu vào quyết định nhất — **một ERP thật của một khách
  thật** — không nằm trong kho, không gieo được.

Nên tài liệu này không mở vòng mã nào ngoài một mảnh (S5.0, §2.4 (a)). Nó làm bốn việc để khi cổng mở, người viết mã không
phải đoán, và để các hạng mục S3/S4 đang chạy biết S5 sẽ đọc gì của chúng:

1. **Đặt ranh giới cho một CỬA THỨ HAI.** Mọi bề mặt tích hợp là một cửa nữa vào cùng một dữ liệu mà sản phẩm sinh ra để
   bảo vệ. ADR-038 đã trả lời câu hỏi ấy một lần cho bề mặt agent: đi đúng cửa của người, bề mặt chỉ đọc, ba đường đọc nhạy
   cảm nhất không phơi. S5 áp cùng câu trả lời và nói rõ chỗ nó KHÁC: một chứng chỉ máy sẽ đọc được giá TRÚNG THẦU — đúng
   một báo giá, sau khi award đã `APPROVED` — vì đó là chính việc tích hợp phải làm (§3.3, Q2).
2. **Tính đúng của mọi cạnh RFQ không bao giờ phụ thuộc ERP.** Cùng họ với ADR-005 (*không phụ thuộc scheduler*) và ADR-010
   (*outbox bền, `NOTIFY` chỉ là bộ tăng tốc*): ERP chết, trả lỗi, trả dữ liệu lạ hay không bao giờ trả lời thì không một
   trạng thái gói, award hay chữ ký nào đổi (§5 M6).
3. **Dữ liệu từ ERP là LỜI KHAI của một hệ ngoài về thực tế**, không phải sự thật của sản phẩm. GRN và hoá đơn do người của
   bên mua ghi ở ERP; chúng có thể sai, có thể bị sửa trước khi tới đây, và chúng nói về nhà cung cấp — tức chúng là một cần
   gạt mới cùng họ với bốn cần gạt mà spec S4b §2.5 ㊾ đã gọi tên (§8.3). Mọi con số suy từ chúng mang nhãn nguồn và không
   chặn một cạnh nào.
4. **Nói trước với S3.7, S3.8, S4.7c, S3.9 và S4b.2 S5 sẽ đọc gì của chúng** (§9.1), để mỗi hạng mục ấy không phải sửa hình
   dạng sau khi đã áp migration.

Rủi ro chi phối của S5 đã được ghi từ ngày phân rã (spec S0+S1 §1): ***phụ thuộc bên ngoài***. Nó có hai mặt, và mặt thứ
hai đắt hơn: ⒜ hệ ngoài không sẵn, không đúng, không ổn định — mặt kỹ thuật; ⒝ **mỗi ERP là một hình dạng dữ liệu khác, và
chi phí làm khớp hình dạng là chi phí lặp lại ở mỗi khách** — mặt sản phẩm. V2.1 §30 trả lời mặt ⒝ bằng một câu: *"Không tích
hợp sâu vào tất cả ERP ngay từ đầu… Phase đầu: REST API + CSV/Excel import/export."* Tài liệu này giữ đúng thứ tự ấy, và đi
xa hơn một bước: **không một adapter riêng cho ERP nào nằm trong kho cho tới khi có một khách dùng ERP ấy** (§2.5 ⑹).

---

## 2. Những thứ đã chốt TRƯỚC khi có tài liệu này

| # | Ràng buộc | Nguồn | Hệ quả cho S5 |
|---|---|---|---|
| 1 | Mô hình đe dọa tầng 1+2: chống người dùng nội bộ, không chống nhà vận hành | ADR-002 | Chứng chỉ máy là một *người dùng nội bộ* nữa — có quyền hẹp, có sổ, có thu hồi. Không hứa gì về nhà vận hành ERP |
| 2 | Cô lập tổ chức bằng RLS; mọi bảng tenant `ENABLE` + `FORCE`; không ràng buộc UNIQUE toàn cục làm oracle | ADR-003, ADR-013 | Mọi bảng S5 theo tổ chức. Mã PO của ERP, mã vật tư ERP, `sub` của IdP là DỮ LIỆU, không phải khoá toàn cục |
| 3 | Sổ nhà cung cấp theo từng tổ chức mua; MST là dữ liệu; chỉ người dựng hồ sơ thêm được người liên hệ | ADR-013, ADR-152 | Nhà cung cấp nhập từ ERP là hồ sơ của tổ chức ấy, người dựng là người nhập; CHƯA xác minh (K8a vẫn do người giữ `supplier.qualify` làm) |
| 4 | Tầng HTTP là `node:http` trần + bảng route khai báo; điều kiện xét lại khi `ROUTES` vượt 40 hay cần streaming/multipart; thân ≤ `TRAN_THAN_BYTE` = 64 KiB | ADR-020 §1; `apps/api/src/router.ts` | Đo lúc viết: `grep -c 'method: "' apps/api/src/routes/*.ts` = **104** route (87 đường dẫn) — điều kiện *"vượt 40"* đã chạm từ lâu mà chưa ADR nào trả lời; S5 là lát cắt đầu tiên cần tệp (CSV) và bề mặt máy, nên phải trả lời ở §2.4 (b) |
| 5 | Bề mặt agent là client HTTP của `apps/api`, chỉ đọc, ba đường đọc nhạy cảm không phơi; phạm vi sống ở `sessions.kind`, trường `agent` bắt buộc trên route, 403 có sổ | ADR-038, ADR-039; `051` | Khuôn cho chứng chỉ tích hợp: một `kind` mới, một trường bắt buộc mới trên route, một vế 403 có sổ. `CHECK sessions_kind_hop_le` của `051` là tập đóng ⇒ thêm `kind` là một migration |
| 6 | Giá dạng rõ chỉ ở bảng ĐƯỢC KHAI, mỗi bảng một vai ghi và một cổng đọc; bước 14 kịch bản 41 quét vét cạn | ADR-054; spec S4 §2.5 ⒅ ㉑ | Mọi bảng S5 mang số tiền (bản xuất PO, hoá đơn) vào bảng của ADR-054 cùng vai ghi và cổng đọc; bước 14 quét chúng bằng kim riêng |
| 7 | Mỗi lượt đọc giá sau mở thầu để lại một hàng sổ trong CHÍNH giao dịch đọc; sổ không ghi được thì giá không đi ra | ADR-102 | Mỗi lần xuất PO, mỗi lần ERP kéo bản xuất là một lượt đọc như thế |
| 8 | Từ chối có tên: `CONTROL_DENIED` mang mã cho từ chối kiểm soát, `PERMISSION_DENIED` cho quyền, `BID_STATE_DENIED` cho trạng thái | ADR-060, ADR-084 ⑷, ADR-108 | S5 dùng lại từ vựng, không dựng lớp từ chối thứ tư |
| 9 | Outbox bền trong cùng giao dịch, `NOTIFY` là bộ tăng tốc; gửi là việc SAU COMMIT; tập `kind` theo vai sống ở CSDL — thêm `kind` là thêm migration | ADR-010, ADR-023, ADR-113, ADR-134 | Mọi lần đẩy ra ERP (PUSH) là một job outbox với `kind` mới; mọi lần xuất là một hàng CHỈ-GHI-THÊM trong giao dịch nghiệp vụ, đẩy đi sau commit |
| 10 | `api` ra internet qua NAT, cổng 443; tên miền lọc bằng DNS Firewall danh sách ĐÓNG; mọi host `https://…` hằng trong adapter của `api` phải có trong danh sách | ADR-069, ADR-076; `tests/architecture/hinh-dang-dns.test.ts` | Mọi đường `api` GỌI RA (webhook tới ERP, JWKS của IdP) là một tên miền phải khai ở hạ tầng, theo từng khách. PULL (ERP gọi vào) không tốn gì |
| 11 | Bí mật của tích hợp ngoài ở Secrets Manager, đọc lúc chạy; CMK riêng cho từng mục đích | ADR-069 ⑶, ADR-063 | Khoá ký webhook và client secret OIDC theo khuôn ấy; không bí mật nào vào CSDL dạng rõ, không vào log |
| 12 | Tổ chức, người dùng và vai trên prod chỉ sinh ra qua task ECS `tp-khoi-tao` dưới vai CSDL hẹp; `app_api` không INSERT được `organizations`, không route nào gán vai | ADR-111 | Cấu hình SSO và người dùng đại diện cho kết nối ERP đi đường ấy — không có route *"bật SSO"* |
| 13 | Tiền tệ của báo giá đọc qua MỘT hàm về tập đóng {`VND`, `USD`}; bốn bản chép của tập khoá nhau bằng một test đọc tệp; hàm theo bậc không lặng lẽ cho qua lệch tiền tệ; lượt chấm từ chối tập báo giá lệch tiền tệ | ADR-103, ADR-082 ⑽, spec S2 §2.3 ⑻ | Đa tiền tệ nghĩa là NỚI tập đóng bằng một migration, không nghĩa là quy đổi (Q5) |
| 14 | Supplier Score hoãn tới S5; không ô bảo hành trên form nộp thầu; §7 và ㊾ của spec S4b là đầu vào | ADR-100 Q1, Q3 | §4.6 kế thừa nguyên văn, chỉ thêm hai thành phần có nguồn mới (*Quality*, *Delivery*) và nói cái giá của nguồn ấy |
| 15 | Dữ liệu nền chỉ-ghi-thêm khuôn `seq`/`ghi_luc` do trigger đặt, hàng rút; ghi dữ liệu ngoài qua dán CSV ≤ 1000 dòng, tất-cả-hoặc-không, lô có một hàng sổ không giá; người nhập mù giá | spec S4 §2.5 ⑿; L1, L3, L15; ADR-096, ADR-149 | Mọi lô nhập từ ERP cùng khuôn: lô, hàng rút, `seq`, `ghi_luc`, lỗi theo dòng không nhắc lại ô; bộ đọc văn bản dán của S4.6a là bộ đọc CSV DUY NHẤT (§2.5 ⑵) |
| 16 | Không service Python, không ML, không runtime thứ hai | ADR-094 | Kết nối ERP sống trong tiến trình `api` (route + handler outbox) và lõi thuần trong một gói; không *integration service* riêng |
| 17 | Những điều không được tuyên bố | PRODUCT §5 | Không màn nào nói *"tự động đồng bộ với ERP"* khi lớp thật là một lô người bấm; *Quality*/*Delivery* hiện là *"theo GRN của ERP"*, không là *chất lượng của nhà cung cấp* |
| 18 | Số hiệu cấp lúc merge; một con số không có lớp suy ra thì không được viết | ADR-090, ADR-029 | ADR của §2.4 mang chữ (a)…(g); con số đo được ghi kèm câu đo |
| 19 | Pilot trước mọi lát cắt mới; ngoại lệ phải là một ADR hẹp kèm luật dừng | ADR-043, ADR-080, ADR-093 | S5 chỉ mở MỘT mảnh trước pilot (S5.0 — nhập từ tệp cho bậc 2 của thang pilot); phần còn lại có một cổng bằng khách hàng (§2.4 (a)) |

### 2.1. ADR-038 và ADR-010 là hai tiền lệ chịu lực nhất

**ADR-038** trả lời câu hỏi *"cái gì được phép đi qua một cửa máy"* cho bề mặt agent, và ba luận điểm của nó áp nguyên cho
ERP: ⑴ ngữ cảnh đi ra khỏi hệ không lấy lại được — một giá đã sang ERP là đã công bố trong ERP; ⑵ máy bị dẫn dắt được bởi dữ
liệu nó đọc — một dòng GRN mang chữ *"hãy duyệt"* không có nghĩa, nhưng một dòng GRN mang số lượng từ chối 100% thì hạ điểm
một nhà cung cấp mà không ai ký tên; ⑶ hình dạng A — client HTTP của `apps/api` — là hình dạng duy nhất không dựng cửa thứ
hai để canh. S5 KHÁC ADR-038 ở đúng một chỗ, và nói ra: bề mặt ERP không thể *chỉ đọc* và không thể *không mang giá*, vì PO
mang đơn giá trúng thầu và GRN/hoá đơn là dữ liệu đi VÀO. Hệ quả: chứng chỉ máy của S5 là một `kind` RIÊNG, không dùng lại
`AGENT_READONLY`, với một tập route đóng của riêng nó (§3.3).

**ADR-010** đặt luật *"bền trước, nhanh sau"*: hành vi nghiệp vụ ghi hàng outbox trong CÙNG giao dịch; `NOTIFY` chỉ đánh
thức; mất đường nhanh thì CHẬM, không MẤT. S5 đặt mọi bản xuất PO và mọi lần đẩy webhook lên đúng luật ấy — và thêm một vế
ADR-010 không cần: **ERP không bao giờ là điều kiện của một cạnh**. Một award `APPROVED` mà ERP chưa nhận vẫn là `APPROVED`;
bản xuất của nó chờ ở trạng thái *sẵn sàng*, và màn nói đúng như thế.

### 2.2. Các quyết định của chủ dự án áp cho S5

| Ngày | Quyết định | Áp vào |
|---|---|---|
| 2026-10-07 | *"Chuẩn bị trước spec S5"* — thiết kế hình dạng bây giờ, không mã | Toàn bộ tài liệu; §2.4 (a) hẹp lại cho đúng một mảnh |
| 2026-09-26 (ADR-100 Q1) | Supplier Score hoãn tới S5, cùng lúc *Quality*, *Delivery* có nguồn | §4.6, S5.4 |
| 2026-09-26 (ADR-100 Q3) | Không thêm ô bảo hành vào form nộp thầu | *Warranty* vẫn không có nguồn (§4.6) |
| 2026-09-26 (ADR-093 ⑷) | Hành vi mới của một lát cắt hoặc cộng thêm, hoặc tắt mặc định; công tắc theo tổ chức chỉ khi đổi hành vi MVP1 | Mọi hành vi S5 cộng thêm; SSO là công tắc theo tổ chức vì nó đổi đường đăng nhập (§4.7) |
| 2026-08-27 (spec S0+S1 §1) | S5 = *REST/CSV, Odoo/SAP B1/Bravo/FAST, SSO, đa tiền tệ* | Phạm vi §2.3 Q1 |

### 2.3. Câu hỏi cho chủ dự án — trả lời ở lượt soi hình dạng

Mỗi câu kèm đề xuất và cái giá của đề xuất. Không câu nào chặn một vòng đang chạy của S3 hay S4.

| # | Câu hỏi | Lối | Đề xuất | Cái giá của đề xuất |
|---|---|---|---|---|
| **Q1** | **Phạm vi S5.** ⒜ chỉ tích hợp ERP (nhập PR/danh mục, xuất PO, nhận GRN/hoá đơn, Supplier Score); ⒝ ⒜ cộng Enterprise theo V2.1 §34 ở mức SSO và đa tiền tệ; ⒞ ⒝ cộng Reverse Auction (V2.1 §23, roadmap M10) | ⒜ ⒝ ⒞ | **⒝.** SSO và đa tiền tệ là hai thứ spec S0+S1 §1 đã xếp vào S5 và hai tiền đề B6, C4 đang đợi. Reverse Auction là một CHẾ ĐỘ MUA SẮM khác (V2.1 §9: *"BAFO and Reverse Auction are separate sourcing modes"*), chạm A4/A5 ở chỗ chưa có phép đo nào — §10 | Roadmap V2.1 §39 đặt M10 Reverse Auction TRƯỚC M11 ERP; đề xuất này đảo thứ tự ấy và đẩy Reverse Auction ra khỏi S5 — một spec riêng, sau pilot |
| **Q2** | **Giá trúng thầu đi tới ERP bằng đường nào.** ⒜ chỉ người: FINANCE tải CSV/JSON của PO từ màn, tự nhập vào ERP — không chứng chỉ máy nào đọc giá; ⒝ ⒜ cộng PULL: ERP kéo bản xuất qua một chứng chỉ máy `kind = 'INTEGRATION'`; ⒞ ⒝ cộng PUSH: `api` đẩy webhook tới ERP | ⒜ ⒝ ⒞ | **⒜ trước, ⒝ khi khách đầu tiên cần tự động hoá, ⒞ chỉ sau một ADR riêng (§2.4 (g)).** ⒜ không mở đường giá nào cho máy — đúng lập luận ADR-038 ⑶ (*"ai cần đọc giá thì đọc bằng giao diện người mua, dưới phiên có MFA của một con người"*). ⒝ là chỗ S5 cố ý KHÁC ADR-038, và cái giá nằm ở cột bên | ⒝ cho một chứng chỉ máy đọc đơn giá trúng thầu của ĐÚNG MỘT báo giá sau `APPROVED`; không bao giờ bảng so sánh, xếp hạng, báo giá thua. Một chứng chỉ bị lộ là một người lạ đọc được mọi PO của tổ chức tới khi thu hồi — M3 đặt TTL và thu hồi, không triệt được |
| **Q3** | **ERP nào đi đầu, và có adapter riêng trong kho không.** V2.1 §30 xếp Odoo, SAP Business One, Bravo, FAST sau REST + CSV | Theo khách · theo thị trường | **Không adapter nào trong kho cho tới khi có một khách dùng ERP ấy** (§2.5 ⑹). S5 chốt MỘT hình dạng CSV/JSON của TrustProcure cho PR, PO, GRN, hoá đơn, kèm tài liệu ánh xạ. Adapter đầu tiên viết theo khách pilot, là một hạng mục S5.x mới có ADR | Khách tự làm phần khớp hình dạng ở phía ERP, hoặc trả *Integration Fee* (V2.1 §35). Rủi ro: *"REST + CSV"* đọc như *"không tích hợp"* với một khách muốn bấm một nút |
| **Q4** | **SSO thay yếu tố nào.** Hôm nay đăng nhập người mua = link email + TOTP (ADR-020 §2 ⒝). ⒜ SSO thay LINK EMAIL, giữ TOTP; ⒝ SSO thay CẢ HAI khi IdP khai `amr` có MFA; ⒞ tổ chức chọn ⒜ hay ⒝ | ⒜ ⒝ ⒞ | **⒜.** Hai yếu tố ở hai kênh là nguyên tắc ADR-015 áp cho người mua ở ADR-020; trigger `sessions_kiem_totp_gan_day` (`039`) không đổi; một IdP bị chiếm — hay một quản trị IdP tạo người dùng mang email của FINANCE — không mở được phiên. Tiền đề B6 vì thế KHÔNG tắt: nhân viên vẫn cài TOTP | Khách mua SSO để *bớt một bước*; ⒜ chỉ bớt bước mở hộp thư. Câu trên màn phải nói đúng: *"Đăng nhập bằng tài khoản công ty, rồi mã TOTP"* |
| **Q5** | **Đa tiền tệ nghĩa là gì.** ⒜ nới tập đóng {`VND`, `USD`} thêm một danh sách ISO 4217 (GIẢ ĐỊNH: `EUR`, `JPY`, `CNY`, `KRW`, `SGD`, `THB`), giữ luật *một gói một tiền tệ* (spec S2 §2.3 ⑻) và *benchmark cùng tiền tệ*; ⒝ ⒜ cộng bảng tỷ giá theo tổ chức ghim lúc gói vào `OPEN` để xếp hạng chéo tiền tệ | ⒜ ⒝ | **⒜ ở S5; ⒝ chờ một khách cần**, khuôn ADR-132 (*"bị từ chối tới khi một khách hàng cần"*). Một tỷ giá do bên mua khai là một *người đặt thước* nữa (`033`), và nó quyết định thứ hạng — đúng hình dạng ADR-097 ⑸ vừa phải ghim | Nhà cung cấp báo `EUR` vào gói `VND` vẫn làm lượt chấm từ chối cả gói (ADR-103), nay với một danh sách dài hơn |
| **Q6** | **Ai ghi dữ liệu từ ERP, và ai thấy.** GRN không mang tiền (ngày nhận, số lượng nhận, số lượng từ chối); hoá đơn mang tiền | Vai · cổng | **Người ghi là chứng chỉ máy (`erp.sync`) hoặc người giữ `integration.manage` dán lô.** GRN đọc được bởi mọi người mua của tổ chức (không giá); hoá đơn đọc bằng `bid.view` và khai ở ADR-054. Người giữ `erp.sync` không giữ mã quyền nào khác (khuôn `033`) | Hai mã quyền mới — `erp.sync` cho máy, `integration.manage` cho người cấu hình — là hai mã ADR-084 ⑴ phải thấy đủ tiêu chí *tách người*: máy không được là người có `bid.view`; người cấu hình kết nối không được là người DUYỆT trao (`po.approve`) — đề xuất gán `integration.manage` cho `PROCUREMENT_MANAGER`, vai duy nhất của `005` giữ `bid.view` mà không giữ `po.approve` |
| **Q7** | **Trọng số Supplier Score** (ADR-100 Q1 để lại). ⒜ không mặc định — tổ chức khai trên các thành phần CÓ NGUỒN ở phiên bản ấy; ⒝ co giãn bộ V2.1 §13 trên thành phần có nguồn | ⒜ ⒝ | **⒜.** Spec S4 §4.9 đã từ chối tự chia lại trọng số V2.1, và ㊾ cho thấy mỗi thành phần là một cần gạt — một bộ mặc định là một bộ cần gạt không ai chọn | Tổ chức không khai `diem_ncc` thì không có Supplier Score — màn nói *"chưa khai trọng số"*, không số |
| **Q8** | **Supplier Score có chụp vào đề xuất trao thầu không.** ADR-100 Q1 bỏ cột bản chụp trên `rfq_risk_assessments` vì Supplier Score rời S4b | Có · Không | **Có, ở bảng RIÊNG theo đề xuất** (`rfq_award_supplier_score_snapshots`), để bộ bằng chứng mang đúng con số người đề xuất đã thấy (V2.1 §22: *"Historical performance tốt"* là một lý do của đề xuất) | Một bảng nữa; S4b.7 và S3.9 phải đọc nó khi dựng lớp của mình |
| **Q9** | **Nhập từ tệp cho pilot bậc 2 có đi trước phần còn lại không** (kế hoạch pilot §7: *"Bậc 2 cần nhập gói từ một tệp của khách (CSV)"*) | Có · Không | **Có — S5.0**, ngoại lệ hẹp §2.4 (a). Đây là mảnh duy nhất của S5 phục vụ pilot thay vì chờ pilot | Một vòng mã S5 trước khi có khách; bù lại nó không chạm đường mở thầu, không chạm giá, không cần chứng chỉ máy |
| **Q10** | **Ai cấp chứng chỉ máy và bật SSO cho một tổ chức.** Hôm nay không route nào gán vai; tổ chức và người dùng đi qua task `tp-khoi-tao` (ADR-111) | Task · Route | **Cấu hình SSO và người dùng đại diện kết nối: task `tp-khoi-tao` (bản khai ở Secrets Manager, có người duyệt). Chứng chỉ máy: route của người giữ `integration.manage` với TOTP tươi, khuôn `POST /auth/agent-session`** | Bật SSO cho một khách là một lần chạy workflow có người duyệt, không phải một ô trên màn — chậm, cố ý |

### 2.4. Bảy ADR phải chốt ở lượt soi hình dạng

| ADR | Câu hỏi | Vì sao chặn |
|---|---|---|
| **(a)** | **Ngoại lệ HẸP thứ ba với ADR-043, cho ĐÚNG MỘT hạng mục S5.0** (nhập hạng mục gói và sổ nhà cung cấp từ văn bản dán), khuôn ADR-080 ⑴ / ADR-093 ⑴. **Cổng của phần còn lại là một KHÁCH HÀNG:** S5.1 trở đi chỉ mở khi một tổ chức thật ở bậc 2 trở lên của thang pilot (kế hoạch §7) có ERP và đồng ý tích hợp, đo bằng biên bản buổi gặp có TÊN và NGÀY (quy ước 2 của `docs/TIEN-DE-CHUA-DO.md`). Luật dừng: S5.x nhường khoản rổ A, vòng triển khai thật, pilot, và S3.x/S4.x khi sửa *cùng cột, cùng hàm ghim, cùng tệp mã* (ADR-093 ⑶) | ADR-043 là luật đang hiệu lực. Không có (a) thì S5.0 không có quyền mở vòng, và dòng trỏ mảnh của nó không trỏ vào đâu — hình dạng khoản 237 đo. Không có cổng bằng khách thì S5 là lát cắt dựng trên một ERP không tồn tại |
| **(b)** | **Tầng HTTP trước tệp và bề mặt máy.** Điều kiện xét lại của ADR-020 §1 (*"khi `ROUTES` vượt 40, hoặc khi cần streaming/multipart"*) đã chạm vế đầu từ lâu (104 route, §2 ⑷) và S5 chạm vế sau. Đề xuất: GIỮ `node:http` trần và `ROUTES` — vì cả ba lớp canh *"với MỌI route"* (H17, E6, bộ quét rò rỉ) đứng trên mảng ấy; KHÔNG multipart, KHÔNG streaming ở S5.0–S5.3: tệp đi bằng DÁN VĂN BẢN và thân JSON ≤ 64 KiB theo lô (khuôn ADR-096 ⑸ / ADR-149, ≈ 500 dòng mỗi lô), bản xuất và sổ kiểm toán xuất theo TRANG; viết lại dòng *"điều kiện xét lại"* của ADR-020 thành một mốc đo được mới | Chọn sai thì hoặc S5 kéo một framework vào `apps/api` để tải tệp — mất ba lớp canh — hoặc một lần nữa nới ADR-020 mà không ai gọi tên |
| **(c)** | **Chứng chỉ tích hợp.** `sessions.kind` thêm `INTEGRATION` (migration mới: `CHECK sessions_kind_hop_le` là tập đóng); TTL trần (GIẢ ĐỊNH 90 ngày, so với 60 phút của agent); phát bởi người giữ `integration.manage` với TOTP tươi (khuôn `/auth/agent-session`, `self: true`), chứng chỉ không tự gia hạn, không tự nhân bản (ADR-039); gắn vào một người dùng ĐẠI DIỆN của kết nối (hàng `users` do `tp-khoi-tao` tạo, vai `INTEGRATION` giữ đúng `erp.sync` — luật vai/người khuôn `033`); `actor_type = 'SERVICE'` khi ghi sổ (giá trị đã có trong `CHECK` của `003`, không nới); trường BẮT BUỘC `integration: boolean` trên mọi route người mua (khuôn `agent`), vị từ duy nhất; 403 có sổ trước `requirePermission`; tuỳ chọn ghim dải IP (GIẢ ĐỊNH) | Không có (c) thì bề mặt máy mượn phiên người — đúng lỗ ADR-039 đo (H-1 của lượt soi 69). `sessions.kind` và `agent` đã có khuôn; làm khác khuôn là hai bản chép của cùng một ý |
| **(d)** | **Bảng mang giá của S5 vào ADR-054**: bản xuất PO (`erp_po_exports` + dòng) — vai ghi `app_api` trong giao dịch duyệt trao; cổng đọc `bid.view` (người) và `erp.sync` (máy, chỉ lô của tổ chức mình, chỉ award `APPROVED`); hoá đơn (`erp_invoice_lines`) — vai ghi `erp.sync`/`integration.manage`, cổng đọc `bid.view`. GRN không mang tiền và không vào bảng ấy; `CHECK` lược đồ đóng cộng dây bẫy tập khoá tiền (khuôn spec S4b §2.5 ㊴) trên `erp_receipt_lines` | Một bảng giá không khai là chỗ A3/A4 đứt mà bước 14 không thấy — bài học ADR-054 |
| **(e)** | **SSO/OIDC**: nhà cung cấp danh tính được hỗ trợ ở lượt đầu (đề xuất: mọi IdP OIDC chuẩn, đo trên Microsoft Entra ID và Google Workspace — hai tên miền JWKS khai một lần ở DNS Firewall; IdP tự host của khách là một tên miền theo khách — chi phí hạ tầng gọi tên); luật khớp danh tính (claim email hạ chữ bằng `pg_catalog.lower()` phải TRÙNG `users.email` của tổ chức đã có — KHÔNG tạo người dùng, ADR-111); `sub` ràng một lần vào `user_identities`, không đổi; cấu hình ở `org_sso_configs` ngoài `GRANT` của `app_api`, ghi bởi `tp-khoi-tao`; công tắc theo tổ chức có cờ triển khai mặc định tắt (khuôn ADR-105); link email có tắt được theo tổ chức không khi SSO bật | ADR-020 §2 ⒞ chỉ nói *"Enterprise (S5)"*. Tiền đề B6 ghi cái giá nếu phải làm lại: *"di trú bảng phiên"* — (e) phải nói trước rằng không di trú nào cần, vì phiên vẫn là hàng `sessions` `kind = 'USER'` ra đời sau TOTP |
| **(f)** | **Tập đơn vị tiền tệ**: danh sách ISO 4217 được nhận (GIẢ ĐỊNH ở Q5); một migration nới `CHECK` ở `014` (`org_procurement_policies.currency`, `rfq_budgets.currency`), `057` (`rfq_evaluations.currency`), hàm `bid_currency` (`070`) và ô chọn — bốn bản chép mà `tests/architecture/tien-te-mot-cho-doc.test.ts` và test đọc tệp của ADR-103 khoá nhau; bí danh cho đơn vị mới (`€`, `¥`…) có hay không — đề xuất KHÔNG, chỉ mã ba chữ | Nới ở ba `CHECK` đã áp là một migration có bán kính nổ; làm thiếu một chỗ là một 422 không tên trở lại (ADR-103 ⒜) |
| **(g)** | **PUSH ra ERP (webhook)** — chỉ khi Q2 ⒞: tên miền ERP của khách là một biến hạ tầng theo khách trong danh sách DNS Firewall (ADR-076 ⑷ `che_do_dns`); job outbox `kind = 'ERP_WEBHOOK_SEND'` (migration `ALTER POLICY` theo ADR-134); thân ký HMAC bằng khoá theo kết nối ở Secrets Manager (ADR-069 ⑶); gửi SAU COMMIT; thử lại có trần (GIẢ ĐỊNH 5 lần, giãn cách nhân đôi) với khoá idempotent = id lô xuất + băm nội dung; không đi theo 3xx; không đọc thân phản hồi ngoài một mã ACK | Không có (g) thì không có PUSH — và đó là một trạng thái CHẤP NHẬN ĐƯỢC. Có (g) thì `api` có một đích ra ngoài theo từng khách, tức bề mặt SSRF và bề mặt tuồn dữ liệu mà ADR-069 *Hệ quả* đã gọi tên |

**Không cần công tắc theo tổ chức cho phần tích hợp — ĐỀ XUẤT, lượt soi phải kiểm.** Mọi hành vi của S5.0–S5.4 hoặc CỘNG
THÊM (bảng mới, route mới dưới quyền mới, một cột trạng thái xuất trên màn award), hoặc TẮT MẶC ĐỊNH (Supplier Score không có
khi `diem_ncc` chưa khai; không chứng chỉ máy nào tồn tại khi chưa ai phát). Một tổ chức không khai gì chạy đúng hành vi hôm
nay. Ngoại lệ đã biết: **SSO** đổi đường đăng nhập của tổ chức ấy, nên nó là một công tắc theo tổ chức (§4.7); và **đa tiền
tệ** đổi một `CHECK` cho MỌI tổ chức — nhưng theo chiều nới, không tổ chức nào đang dùng `VND`/`USD` đổi hành vi.

### 2.5. Những chỗ lượt viết tự chốt từ tiền lệ đo được

Khuôn ADR-050 và spec S4 §2.5: chỗ nào tiền lệ trong kho trả lời được thì chốt và ghi lý do; lượt soi hình dạng được phép
lật từng dòng.

| # | Chỗ | Chốt | Tiền lệ |
|---|---|---|---|
| ⑴ | ERP ghi vào bảng nào | **ERP không bao giờ ghi vào bảng nghiệp vụ nào của S1–S4.** Nó ghi vào bảng NHẬN của S5 (PR, GRN, hoá đơn, ACK), và một NGƯỜI đi tiếp — tạo gói từ PR, xác minh nhà cung cấp, đọc đối chiếu. Hệ quả: `created_by` của một gói luôn là một người, nên J3, K2 (*người chọn danh sách*), K5 không đổi nghĩa | ADR-016 (danh tính dẫn xuất từ phiên), J3, ADR-147 |
| ⑵ | Bộ đọc CSV | **Một bộ đọc văn bản dán duy nhất** — bộ của S4.6a (`packages/du-lieu-nen`: tab/`;`/`,`, tiêu đề tự do, dấu chấm thập phân, ≤ 1000 dòng, lỗi theo dòng). S5 gọi nó; một bộ đọc thứ hai là thiết kế đã trượt | ADR-149; luật *"quy đổi chỉ ở SQL"* (spec S4 §2.5 ⒄) |
| ⑶ | Khuôn bảng nhận | Mọi bảng nhận của S5 chỉ-ghi-thêm theo lô: `lo_nhap_id`, hàng rút `rut_cua`, `seq`/`ghi_luc` do trigger đặt, `CHECK` có tên, RLS + `_khach` `RESTRICTIVE`, `GRANT INSERT` theo cột, `bid_chi_ghi_them` ở UPDATE/DELETE/TRUNCATE, ghim ở hardening cùng commit | L1; `109_du_lieu_ngoai`; `047`; `061:336-352` |
| ⑷ | Lỗi nhập | Lô tất-cả-hoặc-không; lỗi kể theo số dòng, không nhắc lại ô (ô hoá đơn mang tiền về màn người không giữ `bid.view` là đúng lỗ ADR-149 bắt ở lượt đối kháng) | ADR-149 |
| ⑸ | Từ chối của S5 | `CONTROL_DENIED` mang mã `M*_…` cho từ chối kiểm soát (băm ACK lệch, lô trỏ PO không có, chứng chỉ gọi route người); `PERMISSION_DENIED` cho quyền; không lớp mới | ADR-084 ⑷, ADR-108 |
| ⑹ | Adapter ERP | Không adapter nào trong kho tới khi có khách dùng ERP ấy. Kho giữ MỘT hình dạng CSV/JSON của TrustProcure, có phiên bản (`v1`), và một ERP GIẢ LẬP cho test và pilot giả lập (`tools/erp-gia-lap`, một tiến trình Node đóng vai ERP — cùng cách `tools/pilot-gia-lap` đóng vai nhà cung cấp) | V2.1 §30 *Phase đầu*; ADR-101 |
| ⑺ | Mỗi lần xuất một hàng sổ | Mỗi lần người tải bản xuất, mỗi lần máy kéo bản xuất, mỗi ACK: một hàng sổ trong CHÍNH giao dịch; payload sổ chỉ mang id lô, số dòng, băm — không số tiền (`CHECK audit_events_payload_khong_mang_gia`) | ADR-102; `003` |
| ⑻ | Bản xuất là hàm thuần | Nội dung PO = hàm thuần của (award `APPROVED`, chữ ký, dòng báo giá đã mở của báo giá thắng, lời khai TCO cam kết của S4.7c, hàng chuẩn ánh xạ của S4.3, hồ sơ nhà cung cấp); `sha256` lưu cùng lô; tính lại được ngoại tuyến như bộ bằng chứng | ADR-059; J2 |
| ⑼ | Trạng thái xuất không là trạng thái RFQ | Không thêm trạng thái vào máy trạng thái RFQ, không cạnh mới. Lô xuất có trạng thái riêng (`SAN_SANG` → `DA_KEO`/`DA_TAI` → `DA_ACK`, hay `THU_HOI` khi award huỷ — ADR-057 `AWARDED→EVALUATING`) | ADR-057; spec S4b §3.1 (*"không thêm trạng thái RFQ"*) |
| ⑽ | Nhà cung cấp nhập từ ERP | Là hồ sơ Level 0/1 CHƯA xác minh; người nhập là `created_by`; MST, email, điện thoại chịu đúng `CHECK` của `008`, `048`/`049`, `132`, `139` — dòng không qua thì cả lô không vào | ADR-013, ADR-152, ADR-132, ADR-139 |
| ⑾ | Mã vật tư ERP | Là một BÍ DANH của hàng chuẩn (S4.2a), do người giữ `item.manage` khai hoặc duyệt; không bảng ánh xạ riêng | spec S4 §4.3–§4.4; L2, L3 |
| ⑿ | Tiền tệ trong bảng S5 | Mọi cột tiền của S5 kèm cột tiền tệ thuộc tập đóng; không mã S5 nào quy đổi; hoá đơn khác tiền tệ với award ⇒ nhãn `LECH_TIEN_TE` ở đối chiếu, không con số | ADR-103; ADR-082 ⑽ |
| ⒀ | Một chứng chỉ một bề mặt | Chứng chỉ `INTEGRATION` không gọi được route `agent: true` và ngược lại; bảng công cụ của `apps/mcp` không đổi | ADR-039 |
| ⒁ | Bước 14 | Kịch bản 41 (bản HTTP) thêm bước xuất PO, kéo bằng chứng chỉ máy, nhập GRN và hoá đơn có kim riêng; bước 14 quét mọi bảng S5 bằng kim ấy, kết quả `toEqual` vét cạn với danh sách ADR-054 đã nới | ADR-054; spec S4 §2.5 ⒅ |
| ⒂ | Nhãn trên màn | *Quality*, *Delivery* hiện là *"theo GRN của ERP (n dòng, từ ngày … )"*; đối chiếu TCO hiện *"lời khai … / thực tế theo ERP …"*. Không chữ *tự động*, không chữ *đồng bộ* ở nơi lớp thật là một lô người bấm | PRODUCT §5; spec S4 §2.5 ㉔ |

---

## 3. Kiến trúc

### 3.1. Thứ S5 TÁI DÙNG, không dựng lại

| Đã có, hoặc sẽ có trước S5 | S5 dùng cho |
|---|---|
| `sessions.kind`, `agentGoiDuoc`, vế 403 có sổ ở `dispatch.ts` (`051`, ADR-039) | Khuôn cho `kind = 'INTEGRATION'` và trường `integration` trên route |
| `POST /auth/agent-session` (`self: true`, TOTP tươi) | Khuôn đường phát chứng chỉ máy |
| Trigger vai/người khuôn `033` (vai giữ đúng tập mã; người giữ mã ấy không giữ mã khác) | Vai `INTEGRATION` (`erp.sync`), ràng với `bid.view`, `po.approve`, `award.recommend`, `rfq.create`, `rfq.invite`, `policy.manage`, `item.manage` |
| `rfq_awards`, `rfq_award_approvals`, `award_du_chu_ky`, `vai_luc_ky` (`061`, `113`) | Nguồn của bản xuất PO: award `APPROVED` và người ký |
| `rfq_unsealed_bids`, `bid_dong_tho`, `bid_so_tien`, `bid_currency` (`019`, `020`, `070`, S4.4a) | Dòng và tổng của báo giá thắng trong bản xuất |
| `rfq_packages.so_ngay_giao`, `tco_ma_ghim`, lời khai TCO cam kết (S4.7a; S4.7c) | Đối chiếu lời khai với GRN và hoá đơn (§4.5) |
| `canonical_items`, bí danh, `rfq_item_mappings` (S4.2a, S4.3a) | Mã hàng trong PO; mã vật tư ERP làm bí danh |
| Bộ đọc văn bản dán, lô tất-cả-hoặc-không, hàng rút (`109`, ADR-149) | Mọi lối nhập của S5 |
| `suppliers`, `supplier_contacts`, `supplier_verifications` (`008`, `082`) | Nhập sổ nhà cung cấp; nhà cung cấp thắng trong PO; *Compliance* của Supplier Score đọc xác minh/thẩm định |
| `rfq_evaluation_lines.rank`, kết quả benchmark (S2, S4.5) | *Price Competitiveness* |
| View hiệu suất (S3.8), `supplier_qualifications` (S3.7), yếu tố rủi ro (S4b.2) | *Responsiveness*, *Compliance*, *Risk* của Supplier Score (§4.6) |
| `org_procurement_policies` có phiên bản, `chinh_sach_tai`, chữ ký thứ hai (S3.1) | Nhóm khoá `diem_ncc`; ghim phiên bản lúc tính |
| Outbox + runner của `api`, policy `kind` theo vai (`007`, `095`, ADR-134) | Job PUSH (S5.7) |
| `appendAuditEvent`, `throwAuditedDenial`, `CONTROL_DENIED` | Mọi hàng sổ và từ chối của S5 |
| Bộ xuất ADR-059 (`dungBoBangChung`, `pnpm bang-chung kiem`) | Lớp ERP trong bộ bằng chứng; bản xuất PO tính lại được ngoại tuyến |
| Task ECS `tp-khoi-tao`, bản khai ở Secrets Manager (ADR-111) | Người dùng đại diện kết nối; cấu hình SSO |
| DNS Firewall danh sách đóng, `che_do_dns` (ADR-076); Secrets Manager (ADR-069 ⑶) | Đích ra của PUSH và JWKS; khoá ký và client secret |
| `tools/pilot-gia-lap`, `gieo:demo` (ADR-101, ADR-044) | ERP giả lập cắm vào cùng cụm |

**S5 không thêm đường mật mã, không thêm trạng thái RFQ, không chạm đường mở thầu, không đổi `effective_cost` hay `rank`,
và không ghi vào bảng nào của S1–S4 ngoài hàng `rfq_award_supplier_score_snapshots` mới (Q8) và bí danh hàng chuẩn qua đường
của S4.** Một bản cài đặt làm một trong những điều ấy là thiết kế đã trượt.

### 3.2. Thứ S5 thêm

- **`packages/tich-hop`** — lõi thuần: bộ dựng tài liệu PO (`v1`), bộ đọc/kiểm hình dạng lô PR, GRN, hoá đơn, hàm đối chiếu
  TCO, hàm Supplier Score (chuyển từ thiết kế spec S4b §7). Không I/O, không đồng hồ, không ngẫu nhiên. Ranh giới `depcruise`
  (một họ quy tắc mới, H16): không phụ thuộc `sealed-envelope`, `unseal`, `crypto-keys`; `danh-gia` không phụ thuộc
  `tich-hop` (ràng buộc 11 của spec S4b: điểm không đổi hạng).
- **Tầng gói** (trong `tich-hop`): ghi lô nhận, ghi bản xuất trong giao dịch duyệt trao (gọi từ `duyetTraoThau` qua một móc
  SAU khi hàng `APPROVED` chèn và TRƯỚC các hàng sổ — cùng thứ tự ADR-154 ⑹ đo), đọc bản xuất cho người và cho máy, ACK.
- **`apps/api`**: nhóm route `ROUTES_TICH_HOP` với trường `integration` trên MỌI route người mua (bắt buộc, khuôn `agent`);
  đường phát/thu hồi chứng chỉ máy; đường đăng nhập OIDC (callback là route `ANON` có `callerLimit`); handler outbox
  `ERP_WEBHOOK_SEND` (S5.7).
- **`apps/web`**: màn `/tich-hop`; khối ở `/tao-thau`, `/nha-cung-cap`, `/mo-thau`, `/login`, `/chinh-sach` (§3.5).
- **`tools/erp-gia-lap`**: tiến trình Node đóng vai ERP — kéo bản xuất, ACK, đẩy GRN và hoá đơn theo kịch bản; cắm vào
  `pnpm pilot:gia-lap` như nhà cung cấp giả lập.
- **Migration**: `sessions.kind` nới; hai mã quyền và một vai; bảng §4; `ALTER POLICY` outbox cho `kind` mới (S5.7); nới
  `CHECK` tiền tệ (S5.6). Mọi trigger và hàm ghim ở `hardening.always.sql` cùng commit.

### 3.3. Cửa thứ hai — quyết định thiết kế lớn nhất của S5

Ba luật, mỗi luật một chỗ cưỡng chế:

1. **Máy đi đúng cửa của người.** Chứng chỉ máy là một hàng `sessions`; mọi route nó gọi là route của `apps/api` đi qua
   `dispatch.ts`, RLS, cổng quyền. Không tiến trình thứ hai, không composition root thứ hai (ADR-038 §1 B, C bị bác).
2. **Tập route của máy là tập ĐÓNG, khai bằng trường `integration: true`, và nó nhỏ.** Đề xuất (GIẢ ĐỊNH về tên đường):

   | Route | Đọc/ghi gì | Không bao giờ |
   |---|---|---|
   | `GET /integrations/erp/exports?since=` | Danh sách lô xuất PO của tổ chức, trạng thái, băm | Award `PROPOSED`, `CANCELLED`; gói chưa `AWARDED` |
   | `GET /integrations/erp/exports/:exportId` | Tài liệu PO `v1`: nhà cung cấp thắng, dòng, đơn giá, tổng, tiền tệ, điều khoản cam kết | Báo giá thua, bảng so sánh, xếp hạng, benchmark, điểm rủi ro |
   | `POST /integrations/erp/exports/:exportId/ack` | Số PO của ERP + băm đã nhận | — |
   | `POST /integrations/erp/purchase-requests` | Lô PR của ERP → bảng nhận (không tạo gói) | Tạo gói, mời, đặt ngân sách |
   | `POST /integrations/erp/receipts` | Lô GRN theo dòng PO (số lượng nhận, từ chối, ngày) — không tiền | — |
   | `POST /integrations/erp/invoices` | Lô hoá đơn theo dòng PO (số tiền, tiền tệ, ngày) | — |
   | `GET /integrations/erp/items` | Hàng chuẩn đang dùng và bí danh — KHÔNG giá | Lịch sử giá, mốc ngoài |
   | `GET /me` | `kind`, như agent | — |

   Mọi route khác trả 403 có sổ cho chứng chỉ máy — kể cả `GET /rfqs/:rfqId`, vì một gói đang `OPEN` mang danh sách hạng mục
   và hạn nộp, và máy không cần chúng. Cổng đối chiếu ở tầng test, khuôn `apps/mcp/src/cong-cu.test.ts`: một route `integration:
   true` mới ngoài danh sách khai ⇒ đỏ.
3. **Giá đi ra là giá ĐÃ TRAO, đúng một báo giá, sau `APPROVED`** — không trước, không hơn. Đây là chỗ S5 khác ADR-038 ⑶, và
   Q2 để chủ dự án chọn có mở nó cho máy hay chỉ cho người.

Và một luật thứ tư về chiều NGƯỢC: **dữ liệu máy đưa vào chỉ chạm bảng nhận** (§2.5 ⑴). Một GRN không đổi một hạng, một hoá
đơn không đổi một award, một PR không tạo một gói. Người làm những việc ấy, dưới tên mình.

### 3.4. Tính đúng không phụ thuộc ERP

| Sự kiện ở ERP | Hệ quả trong TrustProcure |
|---|---|
| ERP không kéo bản xuất | Lô ở `SAN_SANG`; màn award nói *"chưa chuyển ERP"*. Award vẫn `APPROVED` |
| ERP ACK với băm lệch | Từ chối có tên `M7_BAM_LECH`, vào sổ; lô vẫn `DA_KEO`. Không tự sinh bản xuất mới |
| ERP đẩy GRN trỏ PO không có | Cả lô bị từ chối, lỗi theo dòng; không gì đổi |
| Award bị huỷ sau khi xuất (ADR-057) | Hàng lô mới `THU_HOI` cùng giao dịch huỷ; ERP thấy ở lần kéo sau (PULL) hay một sự kiện (PUSH) |
| ERP chết giữa một lô PUSH | Job outbox thử lại có trần rồi `THAT_BAI` có tên; không cạnh RFQ nào chờ nó |

Phép đo của §6 cho mục này: *giết ERP giả lập giữa kịch bản 41, mọi cạnh của gói vẫn đi, mọi khẳng định cũ xanh nguyên văn*.

### 3.5. Danh mục màn hình

| Màn | Thêm gì | Ai |
|---|---|---|
| `/tich-hop` (mới) | Kết nối của tổ chức (loại, chế độ, phiên bản hình dạng), chứng chỉ máy (phát, thu hồi, hạn), hàng đợi bản xuất và ACK, lô nhận và lỗi theo dòng, nhật ký PUSH | `integration.manage` |
| `/tao-thau` | *Nhập hạng mục từ bảng tính* (dán, ≤ 1000 dòng, chỉ `DRAFT`); *Tạo gói từ yêu cầu ERP* (danh sách PR đã nhận) | `rfq.create` |
| `/nha-cung-cap` | *Nhập sổ nhà cung cấp từ bảng tính*; cột *nguồn* (`TAY`, `BANG_TINH`, `ERP`); hồ sơ: *Delivery*, *Quality* theo GRN, đối chiếu TCO theo award, Supplier Score kèm thành phần | `supplier.manage`; đọc điểm: `bid.view` |
| `/mo-thau` | Khối award: trạng thái bản xuất, số PO của ERP, nút *Tải PO* (Q2 ⒜) | `bid.view` |
| `/chinh-sach` | Nhóm khoá `diem_ncc` — chỉ thành phần có nguồn ở phiên bản ấy được khai (L9) | `policy.manage` |
| `/login` | Nút *Đăng nhập bằng tài khoản công ty* khi tổ chức bật SSO, rồi bước TOTP như cũ | — |

Mỗi hạng mục chạm `/nop-thau` hay `/mo-thau` có một lượt đi thử luồng MVP1 ở khung 375×812 với tổ chức không khai gì của S5
(luật spec S4 §2.3).

---

## 4. Mô hình dữ liệu

Mọi bảng theo tổ chức, khuôn §2.5 ⑶. Tên cột là đề xuất; lượt soi và migration chốt.

### 4.1. Kết nối, chứng chỉ, vai

| Bảng / cột | Giữ gì | Ghi chú |
|---|---|---|
| `org_integrations` | Một hàng mỗi PHIÊN BẢN cấu hình kết nối: `loai` (`CSV_TAY` · `PULL` · `PUSH`), `phien_ban_hinh_dang` (`v1`), `dich_webhook` (chỉ PUSH; tên miền phải nằm trong danh sách hạ tầng — kiểm ở deploy, không ở route), `tac_gia`, `seq`, `ghi_luc` | Chỉ-ghi-thêm; phiên bản mới nhất hiệu lực. Không bí mật nào ở đây |
| `sessions.kind = 'INTEGRATION'` | Chứng chỉ máy | Migration nới `CHECK`; `CHECK` TTL riêng (GIẢ ĐỊNH ≤ 90 ngày); không `GRANT UPDATE (kind)` — như `051` |
| `users` (hàng đại diện) | Một người dùng đại diện mỗi kết nối, do `tp-khoi-tao` tạo, email kỹ thuật ASCII (`132`), vai `INTEGRATION` | Không đăng nhập được bằng link email: không hồ sơ TOTP ⇒ không phiên `USER` nào ra đời (ADR-020 ⑴) |
| `roles` += `INTEGRATION`; `permissions` += `erp.sync`, `integration.manage` | Vai máy giữ đúng `erp.sync`; người cấu hình giữ `integration.manage` (đề xuất gán cho `PROCUREMENT_MANAGER` — vai đã giữ `bid.view` nên không thấy gì mới qua bản xuất, và KHÔNG giữ `po.approve`, nên người đặt kênh ERP không là người duyệt trao) | Trigger khuôn `033`: `erp.sync` chỉ ở vai `INTEGRATION`; người giữ nó không giữ mã nào khác; `integration.manage` và `po.approve` không cùng một người. ADR-084 ⑴ áp: hai mã mới vì hai hành vi cần tách người |

### 4.2. Bản xuất PO

| Bảng | Giữ gì |
|---|---|
| `erp_po_exports` | Một hàng mỗi TRẠNG THÁI của một bản xuất (chỉ-ghi-thêm, khuôn `rfq_awards`): `award_id`, `phien_ban_hinh_dang`, `trang_thai` (`SAN_SANG` · `DA_TAI` · `DA_KEO` · `DA_ACK` · `THU_HOI`), `bam` (sha256 của tài liệu `v1`), `so_po_erp` (ở hàng `DA_ACK`), `tac_gia` (người hay đại diện máy), `session_id`, `seq`, `ghi_luc` |
| `erp_po_export_lines` | Dòng của tài liệu: `line_no`, `canonical_item_id` (nếu có ánh xạ), mô tả, số lượng, đơn vị, **đơn giá, thành tiền, tiền tệ** — bảng mang giá, khai ở ADR-054 (§2.4 (d)) |

Hàng `SAN_SANG` và các dòng ghi trong CHÍNH giao dịch chèn hàng `APPROVED` của award (S3.5a `duyetTraoThau`), sau các lần hỏi
chốt và trước các hàng sổ (ADR-154 ⑹). Tài liệu là hàm thuần (§2.5 ⑻): hai lần dựng cho cùng award ra cùng `bam`. Award huỷ
(ADR-057) ⇒ hàng `THU_HOI` trong giao dịch huỷ.

### 4.3. Bảng nhận từ ERP

| Bảng | Giữ gì | Tiền? |
|---|---|---|
| `erp_import_batches` | Lô: `loai` (`PR` · `GRN` · `HOA_DON` · `NCC` · `HANG_MUC`), `nguon` (`DAN` · `MAY`), người/đại diện, số dòng, `seq`, `ghi_luc`; hàng rút `rut_cua` | Không |
| `erp_purchase_requests` + `_lines` | PR của ERP: mã PR, phòng ban (văn bản), người yêu cầu (văn bản), dòng: mã vật tư ERP, mô tả, số lượng, đơn vị, ngày cần | **Không** — PR của ERP có thể mang giá dự toán; hình dạng `v1` KHÔNG có cột ấy, dòng mang thừa cột bị từ chối |
| `erp_receipt_lines` | GRN theo dòng PO: `export_id`, `line_no`, `so_po_erp`, `ma_grn`, `ngay_nhan`, `so_luong_nhan`, `so_luong_tu_choi`, `ly_do_tu_choi` (mã đóng), `nguoi_ghi_erp` (văn bản) | **Không** — `CHECK` lược đồ đóng cộng dây bẫy khoá tiền |
| `erp_invoice_lines` | Hoá đơn theo dòng PO: `export_id`, `line_no`, `so_hoa_don`, `ngay_hoa_don`, `so_luong`, **`don_gia`, `thanh_tien`, `tien_te`**, `ma_thanh_phan` (`gia` · `van_chuyen` · `nhap_khau` — cùng tập mã TCO của `112`) | **Có** — khai ở ADR-054, cổng đọc `bid.view` |

Luật ghi chung: dòng trỏ `export_id` không thuộc tổ chức hay không ở `DA_KEO`/`DA_TAI`/`DA_ACK` ⇒ cả lô bị từ chối; GRN ghi
TRƯỚC ngày award được duyệt ⇒ từ chối có tên (thời gian là của Postgres, không của ERP — ADR-005). Rút theo lô; không sửa.

### 4.4. Đối chiếu lời khai TCO với thực tế

Spec S4 §8.13 để lại: *"tới lúc ấy, 'tổng chi phí' trên màn nghĩa là 'tổng chi phí theo lời khai'"*. S5.3 thêm vế thực tế:

| Mã TCO (`112`) | Lời khai cam kết (S4.7c) | Thực tế theo ERP | Nhãn |
|---|---|---|---|
| `chi_phi_tre` ← `leadTimeDays` | Số ngày giao cam kết | Ngày GRN cuối cùng đủ số lượng − ngày award `APPROVED` | `DUNG_HAN` · `TRE_n_NGAY` · `CHUA_GIAO` |
| `van_chuyen` ← `freight` | Số tiền khai | Σ `thanh_tien` các dòng hoá đơn `ma_thanh_phan = 'van_chuyen'` | `KHOP` · `LECH_x%` · `CHUA_CO_HOA_DON` |
| `nhap_khau` ← `importCost` | như trên | như trên với `nhap_khau` | như trên |
| `gia` | Đơn giá trúng thầu | Đơn giá hoá đơn theo dòng | `KHOP` · `LECH_x%` |
| `chat_luong` | — (không có nguồn lời khai) | `so_luong_tu_choi / so_luong_nhan` theo dòng | Tỷ lệ, không nhãn chi phí — *Quality Cost* V2.1 §16 vẫn KHÔNG tính thành tiền (§10) |

Hàm SQL as-of `tco_doi_chieu(award_id, p_moc)` đọc hàng nhận có `ghi_luc < p_moc`; kết quả không lưu — tính khi có người
đọc (khuôn spec S4b §3.3), mỗi lần đọc một hàng sổ vì nó mang tiền. Hoá đơn khác tiền tệ với award ⇒ `LECH_TIEN_TE`, không
con số. **Không nhãn nào chặn một cạnh, không nhãn nào tự đổi điểm**: nó là đầu vào có nguồn cho *Quality*/*Delivery* (§4.6)
và là một dòng trong bộ bằng chứng của award.

### 4.5. Nhập hạng mục gói và sổ nhà cung cấp (S5.0)

- **Hạng mục**: dán bảng tính vào `/tao-thau`, gói ở `DRAFT`, người giữ `rfq.create`; cột `line_no`, mô tả, số lượng, đơn vị
  (phải là đơn vị S4.1 nhận hay bí danh), tuỳ chọn mã vật tư ERP (→ gợi ý ánh xạ S4.3). KHÔNG cột giá: một dòng có cột tiền
  ⇒ cả lô bị từ chối gọi tên cột — giá dự toán của khách đi đường `external_purchase_history` của S4.6a dưới
  `DATA_STEWARD`, không đi đường này. Trigger `rfq_items_chi_sua_khi_soan` (`009`) giữ *chỉ ở DRAFT*; mỗi lô một hàng sổ.
- **Nhà cung cấp**: dán bảng tính vào `/nha-cung-cap`, người giữ `supplier.manage`; cột tên pháp lý, MST, người liên hệ (họ
  tên, email, điện thoại). Người nhập là `created_by` của mọi hồ sơ (ADR-152); hồ sơ CHƯA xác minh; MST trùng hồ sơ đã có ⇒
  dòng ấy lỗi (`UNIQUE (org_id, tax_code)` của `008` — không gộp lặng lẽ, bài học V2.1 §14).

Hai lối nhập này không cần chứng chỉ máy, không cần cấu hình kết nối, và là đủ cho bậc 2 của thang pilot.

### 4.6. Supplier Score — kế thừa spec S4b §7, thêm hai nguồn

Thiết kế spec S4b §7 giữ nguyên văn (trọng số là khoá `diem_ncc` trên phiên bản chính sách; phiên bản khai trọng số cho thành
phần không có nguồn bị từ chối LÚC GHI bằng `CHECK` dạng khẳng định — L9; sàn N chen chân ≥ 5 gói đã mở trong 12 tháng —
GIẢ ĐỊNH, tiền đề E13; không vào `effective_cost`, không đổi `rank`; không bao giờ tới nhà cung cấp — A5), cùng bốn sửa của
㊾. Bảng thành phần theo nguồn, đọc lại hôm nay:

| Thành phần (V2.1 §13) | Nguồn | Có ở hạng mục |
|---|---|---|
| Price Competitiveness | `rfq_evaluation_lines.rank`, loại gói < 3 báo giá đọc được (㊾) | S2, S4.5 — có |
| Commercial Terms | Lời khai TCO cam kết (S4.7c) | S4.7c |
| Compliance | `supplier_verifications` (S3.3a), `supplier_qualifications` (S3.7); hiện người làm (㊾) | S3.3a — có; S3.7 |
| Responsiveness | View hiệu suất (S3.8), chỉ gói *giá đã lộ*, chỉ nhóm hàng khai (㊾) | S3.8 |
| Risk | Yếu tố S4b mà N là thành viên (㊾) | S4b.2 (cổng (e)) |
| **Quality** | `erp_receipt_lines`: tỷ lệ số lượng từ chối trên số lượng nhận, theo gói đã có GRN | **S5.3** |
| **Delivery** | `erp_receipt_lines` so với `leadTimeDays` cam kết: tỷ lệ gói giao đúng hạn | **S5.3** |
| Warranty | Không có nguồn (ADR-100 Q3) | — |
| Claim rate · Contract compliance (*Supplier Performance*, V2.1 §13) | Không có nguồn: kho không có khiếu nại, không có hợp đồng | — (§10) |

**Hai nguồn mới là một cần gạt mới, và phải nói ra ngay trong thiết kế** (§8.3): GRN do người của bên mua ghi ở ERP. Một
người mua muốn hạ một nhà cung cấp chỉ cần kho ghi từ chối. Ba lớp, không lớp nào triệt được: ⑴ *Quality*, *Delivery* hiện
kèm nguồn — mã GRN, ngày, `nguoi_ghi_erp` — và số dòng; ⑵ dòng GRN có số lượng từ chối > 0 mà không có hoá đơn tương ứng,
hay có hoá đơn đủ tiền, mang nhãn *"GRN và hoá đơn không khớp"* ở màn hồ sơ; ⑶ nhà cung cấp không bao giờ thấy điểm (A5),
nên nó không thành đòn bẩy thương lượng từ phía bên mua trên giấy của hệ. Phần còn lại là việc của người kiểm toán nội bộ
(vai `AUDITOR`, ADR-100 Q2) — và tài liệu này KHÔNG hứa hơn thế.

Bản chụp lúc đề xuất (Q8): `rfq_award_supplier_score_snapshots` — `award_id`, `supplier_id`, `policy_id`, `diem`, `do_phu`,
thành phần (mỗi hàng con một mã, điểm, số dòng nguồn), tính trong giao dịch ghi hàng `PROPOSED`, as-of `moc_de_xuat`.

### 4.7. SSO/OIDC

| Bảng | Giữ gì |
|---|---|
| `org_sso_configs` | Chỉ-ghi-thêm theo phiên bản: `issuer`, `client_id`, `jwks_uri`, `email_claim` (mặc định `email`), `bat_tu`, `tat_link_email` (Q4 vế hai). Ghi bởi `tp-khoi-tao` — ngoài `GRANT` của `app_api`. Client secret ở Secrets Manager (`tp/api/sso/<slug>`), không ở đây |
| `user_identities` | `(org_id, user_id, issuer, sub)`, `rang_luc`; một `sub` ràng đúng một người, một người một `sub` mỗi `issuer`; chỉ-ghi-thêm, không đổi `sub` — đổi là một hàng rút kèm lý do bởi `tp-khoi-tao` |
| `sessions` | Không đổi hình dạng: phiên SSO là `kind = 'USER'` ra đời SAU TOTP (ADR-020 ⑴, trigger `039`) — tiền đề B6 *"di trú bảng phiên"* không xảy ra |

Đường đi: `/login` (có mã tổ chức ở fragment, ADR-107) → chuyển hướng tới IdP (Authorization Code + PKCE, `state` và
`nonce` băm lưu ở bảng tạm có hạn, khuôn `rfq_invitation_tokens`) → callback (`ANON`, `callerLimit`) kiểm `iss`, `aud`,
`nonce`, `exp`, chữ ký qua JWKS (lấy qua đường ra ngoài — tên miền phải có ở DNS Firewall) → email claim hạ chữ TRÙNG
`users.email` của đúng tổ chức → ràng `sub` lần đầu hoặc đối chiếu → bước TOTP như hôm nay → phiên. Không khớp email ⇒ một
thông điệp gộp như đường link (ADR-126), một hàng sổ `SSO_DENIED` không mang email. Không tạo người dùng, không gán vai
(ADR-111).

### 4.8. Đa tiền tệ (Q5 ⒜)

Một migration nới bốn bản chép của tập đơn vị (ADR-103 ⑴): `CHECK` ở `014` (hai bảng), `057`, hàm `bid_currency` (`070`),
ô chọn của `/nop-thau` và `/chinh-sach`. Tập mới GIẢ ĐỊNH: `VND`, `USD`, `EUR`, `JPY`, `CNY`, `KRW`, `SGD`, `THB`. Không bí
danh cho mã mới. Mọi luật cũ giữ: một gói một tiền tệ, benchmark cùng tiền tệ, hàm theo bậc NÉM khi lệch (ADR-082 ⑽).
`external_price_references` và `external_purchase_history` nhận tiền tệ mới qua cùng `CHECK`. Không bảng tỷ giá (§10).

### 4.9. Cưỡng chế ở CSDL

| Chỗ | Làm gì | Bất biến |
|---|---|---|
| `sessions` `CHECK` | `kind IN ('USER','AGENT_READONLY','INTEGRATION')`; `INTEGRATION` ⇒ `expires_at − created_at ≤ trần`; không `GRANT UPDATE (kind)` | M3 |
| Trigger vai/người khuôn `033` | `erp.sync` chỉ ở `INTEGRATION`; người giữ `erp.sync` không giữ mã khác; `integration.manage` và `po.approve` không cùng một người (ĐỀ XUẤT — với bảng vai `005`, chỉ `PROCUREMENT_MANAGER` nhận được `integration.manage`; FINANCE và DIRECTOR giữ `po.approve` nên không) | M3 |
| `erp_po_exports` BEFORE INSERT | Award `APPROVED` tại lúc chèn (hàng mới nhất); `bam` = hàm SQL tính lại từ dữ liệu, không nhận từ ứng dụng (khuôn `rfq_bam_noi_dung`); `SAN_SANG` chỉ trong giao dịch có hàng `APPROVED` mới (deferred constraint trigger khuôn ADR-123) | M7, M2 |
| `erp_po_exports` ACK | `so_po_erp` chỉ ở hàng `DA_ACK`; băm ACK ≠ `bam` ⇒ `M7_BAM_LECH`; ACK cho lô `THU_HOI` ⇒ từ chối | M7 |
| Bảng nhận BEFORE INSERT | Lô cùng tổ chức, `export_id` hợp lệ, `ngay_nhan` ≥ ngày `APPROVED`; `seq`/`ghi_luc` do trigger; `erp_receipt_lines` `CHECK` lược đồ đóng + dây bẫy khoá tiền | M4, M5 |
| `erp_purchase_requests_lines` `CHECK` | Không cột tiền; hình dạng `v1` đóng | M5 |
| `org_sso_configs`, `user_identities` | Ngoài `GRANT` của `app_api` trừ `SELECT`; `user_identities` `INSERT` bởi `app_api` chỉ ở lần ràng đầu (trigger: chưa có hàng cho `(issuer, sub)` và cho `(user_id, issuer)`) | M8 |
| `org_procurement_policies.diem_ncc` `CHECK` | Dạng khẳng định: mọi khoá là thành phần CÓ NGUỒN ở phiên bản phương pháp khai; trọng số nguyên ≥ 0, tổng 100 | L9 |
| Tiền tệ | Bốn `CHECK`/hàm cùng tập; test đọc tệp khoá nhau | M10 |

**Các cổng sẽ đỏ nếu quên** (khuôn spec S4b §10.1): `CHECK` mới vào `CHECK_AN_NINH_KHAI` hay `MIEN_TRU`; bảng chỉ-ghi-thêm
có `bid_chi_ghi_them` và trigger chặn `TRUNCATE`; `id` ngoài `GRANT INSERT`; trigger mới vào ghim và sàn `SAN_SO_TRIGGER`;
policy `_khach` `RESTRICTIVE` cho mỗi bảng; `kind` outbox mới vào hai policy `095` (ADR-134); route người mua mới không khai
`integration` thì KHÔNG BIÊN DỊCH (khuôn `agent`).

---

## 5. Bất biến nghiệp vụ mới — nhóm M

Dải nhãn của bộ đọc sổ bất biến nới `[A-HJ-L]` → `[A-HJ-M]` ở S5.0, TRƯỚC khi M1 vào sổ — bài học khoản 229, khuôn S3.0 và
S4.0; đếm chỗ ghim bằng grep lúc làm, kèm mũi thu dải. L9 giữ mã, vào sổ ở S5.4. Mỗi hàng vào `docs/TEST-PLAN.md` ở đúng
hạng mục đo được nó, SAU khi đo — khuôn spec S3 §5.1, S4 §5.1; hàng tách mang số mới, không hậu tố (khoản 246).

| Mã | Mệnh đề | Cưỡng chế | Hạng mục |
|---|---|---|---|
| **M1** | Không route nào mà chứng chỉ `INTEGRATION` gọi được trả: bảng so sánh, xếp hạng, benchmark, điểm rủi ro, báo giá thua, danh sách hạng mục hay hạn nộp của gói chưa `AWARDED`, dữ liệu cá nhân người liên hệ; đơn giá duy nhất nó đọc được là của báo giá đã trao ở award `APPROVED`. Chứng chỉ `INTEGRATION` không gọi được route `agent: true` và phiên người không gọi được route `integration: true` trừ khi route khai cả hai | Trường `integration` bắt buộc trên route (kiểu); vòng quét route khuôn A2/J4 dưới chứng chỉ máy với gói ở MỌI trạng thái, có đối chứng dương (award `APPROVED` ⇒ đọc được bản xuất); bộ quét rò rỉ T2 chạy dưới chứng chỉ máy với gói chưa mở | S5.1 |
| **M2** | Mỗi lần người tải bản xuất, mỗi lần máy kéo bản xuất, mỗi ACK, mỗi lần đọc đối chiếu TCO để lại đúng một hàng sổ trong CHÍNH giao dịch; sổ không ghi được thì dữ liệu không đi ra | Khuôn ADR-102; test đếm hàng sổ; đột biến gỡ lần ghi; ca *ghi sổ hỏng* | S5.2 (tải, kéo, ACK), S5.3 (đối chiếu) |
| **M3** | Chứng chỉ `INTEGRATION` là hàng `sessions` có TTL trần, không `UPDATE` được `kind`, chỉ phát bởi người giữ `integration.manage` với TOTP tươi, không tự gia hạn, không tự nhân bản, thu hồi được; người đại diện của nó giữ đúng `erp.sync` và không giữ mã khác | `CHECK` `051` nới; trigger `033`; route phát `self: true, agent: false, integration: false`; vòng quét: chứng chỉ máy gọi `/auth/agent-session` và route phát của chính nó ⇒ 403 có sổ | S5.1 |
| **M4** | Dữ liệu từ ERP chỉ vào bảng nhận của S5, theo lô tất-cả-hoặc-không, chỉ-ghi-thêm có hàng rút, `seq`/`ghi_luc` do trigger đặt; không câu nào của S5 UPDATE/DELETE một bảng S1–S4, không đổi trạng thái gói, award, chữ ký, hạng, điểm | Test kiến trúc: mọi câu SQL ghi trong `packages/tich-hop` liệt kê bảng đích (khuôn `bang-ngoai-liet-ke`); `bid_chi_ghi_them`; đột biến đổi một hạng từ GRN | S5.1 (PR), S5.3 (GRN, hoá đơn) |
| **M5** | Không bảng S5 nào mang một số tiền ngoài `erp_po_export_lines` và `erp_invoice_lines` — hai bảng khai ở ADR-054 với vai ghi và cổng đọc; `erp_receipt_lines` và `erp_purchase_request_lines` không nhận cột tiền | `CHECK` lược đồ đóng + dây bẫy; bước 14 kịch bản 41 quét bằng kim đơn giá xuất và kim hoá đơn, `toEqual` vét cạn | S5.2, S5.3 |
| **M6** | Tính đúng của mọi cạnh RFQ, award, chữ ký không phụ thuộc ERP: ERP không trả lời, trả lỗi, trả băm lệch, trả dữ liệu lạ, chết giữa lô — không trạng thái nào của S1–S4 đổi, mọi khẳng định cũ xanh nguyên văn | Kịch bản 41 chạy với ERP giả lập bị giết ở ba điểm; T6 | S5.2 |
| **M7** | Bản xuất PO là hàm thuần của dữ liệu đã lưu; `bam` do CSDL tính; hai lần dựng ra cùng byte; ACK mang băm lệch bị từ chối có tên; bản xuất tính lại được ngoại tuyến từ bộ bằng chứng | Trigger băm; test tái lập khuôn J2; `pnpm bang-chung kiem` mang lớp ERP; đột biến đổi một dòng | S5.2, S5.8 |
| **M8** | Phiên SSO chỉ ra đời sau TOTP (giữ ADR-020 ⑴ nguyên văn); email claim phải trùng một người đã có trong đúng tổ chức — không tạo người, không gán vai; `sub` ràng một lần; token của tổ chức khác, `nonce` sai, `alg` lạ, chữ ký sai, hết hạn đều bị từ chối có sổ không mang email; cấu hình SSO ngoài `GRANT` của `app_api` | Trigger `039` không đổi; `user_identities` trigger; bộ ca T5; đối chứng dương | S5.5 |
| **M9** | Không GRN, hoá đơn, PR hay bản xuất nào của tổ chức A đọc được hay ràng được vào award của tổ chức B; mã PO của ERP, mã PR, `sub` IdP không là khoá toàn cục | RLS + khoá ngoại hợp thành `(org_id, …)`; test F1/F2 khuôn | S5.1 |
| **M10** | Mọi cột tiền của S5 mang tiền tệ thuộc tập đóng; không mã S5 nào quy đổi; hoá đơn khác tiền tệ award ⇒ nhãn, không số; bốn bản chép tập đơn vị khoá nhau | Test đọc tệp (ADR-103); ca đối chiếu lệch tiền tệ | S5.3, S5.6 |
| **L9** | (spec S4b §11.1, nguyên văn) Supplier Score tính lại được từ bản chụp đầu vào + trọng số của phiên bản ghim; phiên bản khai trọng số cho thành phần không có nguồn bị từ chối LÚC GHI; dưới sàn không có số; không route khách nào trả nó | `CHECK` dạng khẳng định; lõi thuần + test tái lập; vòng quét route A5 | S5.4 |

Lượt soi hình dạng được phép tách hay gộp các hàng; số mới, không hậu tố.

---

## 6. Kiến trúc kiểm thử

- **T1** — lõi thuần `packages/tich-hop`: bộ dựng PO `v1` (bảng ca: award một dòng, nhiều dòng, dòng không ánh xạ, tiền tệ
  `USD`, lời khai thiếu một mã); bộ đọc lô PR/GRN/hoá đơn (thừa cột, thiếu cột, cột tiền ở GRN, ngày trước award, số âm,
  trùng dòng); hàm đối chiếu (đúng hạn, trễ, chưa giao, lệch tiền tệ, hoá đơn thiếu); Supplier Score với hai thành phần mới
  (sàn, dưới sàn, thành phần không nguồn). Test thuộc tính (`fast-check`): nhân mọi số tiền với k thì nhãn đối chiếu theo tỷ
  lệ không đổi; hoán vị dòng không đổi `bam`.
- **T2** — vòng quét route cho M1 dưới ba chứng chỉ (máy, agent, người không `bid.view`), gói ở mọi trạng thái, có đối chứng
  dương; **bộ quét rò rỉ T2 chạy thêm một lượt dưới chứng chỉ máy** với gói chưa mở — A4 cho máy.
- **T3** — Postgres thật: `CHECK` `kind`; trigger `033` cho vai mới; băm bản xuất do trigger; lô bị từ chối không để lại dòng;
  ACK băm lệch; RLS hai tổ chức (M9); `user_identities` ràng lần hai; `diem_ncc` khai thành phần không nguồn bị từ chối lúc
  ghi. Đột biến tắt trigger lúc chạy (khuôn `db/hardening-suy-tu-tinh-chat.int.test.ts`).
- **T4** — lượt đi thử có biên bản trên cụm thật với ERP giả lập (khuôn S1.97); khung 375×812 cho mọi màn chạm.
- **T5** — đối kháng, ít nhất: ⑴ chứng chỉ máy gọi `/rfqs/:rfqId/comparison`, `/rfqs/:rfqId/ranking`, `/suppliers/:id/
  contacts`, `/rfqs/:rfqId` của gói `OPEN`; ⑵ chứng chỉ máy tự phát chứng chỉ; ⑶ GRN mang khoá `amount` lồng trong mảng; ⑷
  ACK với băm của bản xuất khác cùng tổ chức; ⑸ GRN trỏ `export_id` của tổ chức khác; ⑹ id_token của tổ chức khác với
  email trùng; `alg: none`; `nonce` dùng lại; ⑺ dán hạng mục kèm cột *đơn giá dự toán*; ⑻ hoá đơn `EUR` cho award `VND`; ⑼
  webhook: đích đổi sang IP nội bộ (PUSH); ⑽ ứng dụng ghi `trang_thai = 'DA_ACK'` không qua route (trigger phải chặn vì thiếu
  băm ACK).
- **T6** — ERP giả lập bị giết ở ba điểm (trước kéo, sau kéo trước ACK, giữa lô GRN); đo rằng không cạnh nào của kịch bản 41
  chờ; đo thời gian giữ khoá hàng award trong lúc dựng bản xuất (bài học khoản 342: lượt đọc không được bỏ đói cạnh ghi).
- **Bước 14** của kịch bản 41 quét bảng S5 bằng hai kim mới (§2.5 ⒁).

---

## 7. Điều kiện hoàn thành

**S5.0 — trước pilot bậc 2:**

> **Trên giao diện**, một người mua dán 40 dòng hạng mục từ bảng tính của khách vào một gói `DRAFT`; một dòng mang cột *đơn
> giá* thì cả lô bị từ chối và màn gọi tên cột ấy; bỏ cột, lô vào, mỗi dòng có đơn vị S4 nhận. Người quản lý mua sắm dán 25
> nhà cung cấp kèm người liên hệ; hai dòng trùng MST với hồ sơ đã có thì lô kể đúng hai số dòng và không gì vào; sửa, lô vào,
> mọi hồ sơ *chưa xác minh*. Hai lô là hai hàng sổ không mang tên người liên hệ. Lượt đi thử ở 375×812 có biên bản.

**S5 trọn — ở một tổ chức có ERP (thật, hay giả lập cho demo V2.1 §41 với nhãn dữ liệu mẫu):**

> **Trên giao diện**, một gói đi trọn kịch bản 41 (hai luồng) tới award `APPROVED`. Khối award hiện *"bản xuất sẵn sàng"*;
> FINANCE tải PO (Q2 ⒜) — một hàng sổ; ERP kéo bản xuất bằng chứng chỉ máy — một hàng sổ — và ACK với số PO; cùng chứng chỉ
> gọi bảng so sánh thì 403 và một hàng sổ. ERP đẩy một lô GRN (một dòng từ chối 10%) và một lô hoá đơn (phí vận chuyển cao
> hơn lời khai 20%). Hồ sơ nhà cung cấp hiện *Delivery* đúng hạn, *Quality* 90% *"theo GRN của ERP (1 dòng)"*, đối chiếu TCO
> hiện `LECH_20%` ở `van_chuyen` kèm *"lời khai … / thực tế theo ERP …"*; Supplier Score hiện khi tổ chức đã khai `diem_ncc`
> và N có đủ sàn, kèm thành phần; nhà cung cấp không thấy gì ở phiên khách. Giết ERP giả lập giữa lô GRN: lô không vào, gói
> và award không đổi. Bộ bằng chứng của gói mang bản xuất, ACK, đối chiếu, bản chụp Supplier Score, và `pnpm bang-chung kiem`
> tính lại đúng `bam` khi đã ngắt CSDL. Một người của tổ chức đã bật SSO đăng nhập bằng tài khoản công ty rồi TOTP; một
> id_token mang email không có trong tổ chức bị từ chối bằng thông điệp gộp. Lượt đi thử ở 375×812 có biên bản.

Và như mọi lát cắt: mọi mã M vào sổ có ô ở `evidence/INV-matrix.md`; `security-reviewer` chạy trên S5.1, S5.2, S5.5, S5.7
(chứng chỉ, giá đi ra, danh tính, đường ra ngoài); `docs/STATE.md` đối chiếu với mã.

### 7.1. Cách đếm KPI của V2.1 §36 cho S5

| KPI | Đếm | Không đếm |
|---|---|---|
| *ERP transactions* (Adoption) | Lô xuất `DA_ACK` + lô nhận không bị rút, theo tổ chức, theo tháng | Lô bị từ chối; lô `THU_HOI`; lô của tổ chức mang dấu dữ liệu mẫu (ADR-100 Q8) |
| *Spend under management* | Σ thành tiền của bản xuất `DA_ACK` theo tiền tệ — KHÔNG cộng chéo tiền tệ | Award chưa ACK |
| North Star *Verified Competitive Spend* | Không đổi cách đếm (ADR-100 Q7); S5 không thêm vế | — |

---

## 8. Rủi ro

### 8.1. Phụ thuộc bên ngoài — rủi ro chi phối

Hai mặt ở §1. Mặt kỹ thuật được đóng bằng M6 và hình dạng *bền trước, nhanh sau*. Mặt sản phẩm KHÔNG đóng được bằng thiết
kế: mỗi khách là một hình dạng dữ liệu, và câu *"REST + CSV"* của V2.1 §30 chỉ chuyển chi phí ấy sang khách hay sang một
*Integration Fee* (V2.1 §35). Thứ tài liệu này làm là không cho chi phí ấy vào kho dưới dạng adapter không ai dùng (§2.5 ⑹).

### 8.2. Cửa thứ hai

Một chứng chỉ máy không có người ngồi sau nó: không MFA tươi, không ai đọc lời cảnh báo. ADR-038 tránh được bằng cách không
cho máy đọc giá; S5 không tránh được nếu Q2 ⒝. Giảm nhẹ: giá đi ra là đúng một báo giá đã trao; TTL trần; thu hồi; mọi lần
kéo một hàng sổ; ghim dải IP (GIẢ ĐỊNH). Không giảm nhẹ nào biến một chứng chỉ lộ thành vô hại trước khi bị thu hồi — và lời
trên màn `/tich-hop` phải nói đúng điều ấy.

### 8.3. GRN là lời khai của bên mua về nhà cung cấp

§4.6 đã nói: *Quality*, *Delivery* lấy từ dữ liệu người của bên mua ghi. Nó mở hai đường: hạ một nhà cung cấp trung thực
(cùng họ ㊾), và *Goodhart* — kho ghi đẹp cho nhà cung cấp quen. Lớp của sản phẩm chỉ là nhãn nguồn, nhãn lệch GRN–hoá đơn, và
A5. Điều KHÔNG hứa: không lớp nào biết GRN đúng hay sai.

### 8.4. SSO dời biên tin cậy sang IdP

Với Q4 ⒜, IdP chỉ thay hộp thư: chiếm IdP thì không mở được phiên vì còn TOTP. Với ⒝ (nếu chủ dự án chọn), một quản trị IdP
mở được phiên của bất kỳ ai trong tổ chức, kể cả hai người duyệt mở thầu — tức mô hình đe dọa ADR-002 có thêm một *người dùng
nội bộ* nằm ngoài sản phẩm. Tài liệu này đề xuất ⒜ vì lý do ấy.

### 8.5. Đường ra ngoài

PUSH và JWKS là hai đường `api` GỌI RA theo từng khách. ADR-069 *Hệ quả* đã nói `api` ra được mọi máy chủ HTTPS; ADR-076 chỉ
lọc tên miền. Một `dich_webhook` do route nhận là một bề mặt SSRF — nên nó KHÔNG do route nhận (§4.1: cấu hình ghi bởi
`tp-khoi-tao`, tên miền kiểm ở deploy). Chi phí vận hành thật: mỗi khách PUSH là một lần đổi biến hạ tầng.

### 8.6. Adapter là chi phí lặp vô hạn

Odoo (JSON-RPC), SAP Business One (Service Layer), Bravo và FAST (phần lớn qua Excel/SQL nội bộ — GIẢ ĐỊNH, chưa đối chiếu
tài liệu nhà cung cấp) là bốn hình dạng khác nhau. Luật §2.5 ⑹ giữ chúng ngoài kho tới khi có khách; cái giá là câu hỏi Q3.

### 8.7. Đa tiền tệ làm dải thưa

Mỗi đơn vị tiền mới là một quần thể benchmark riêng (cùng tiền tệ — spec S4 §4.6). Một tổ chức mua `EUR` thưa thớt sẽ mãi
*"chưa đủ lịch sử"* ở các dòng ấy. Q5 ⒝ (tỷ giá) không chữa được điều này mà đổi nó thành một *người đặt thước* nữa.

### 8.8. Spec viết khi chưa có hình dạng thật nào

Mọi tên cột của PR, GRN, hoá đơn ở §4 là GIẢ ĐỊNH về thứ một ERP Việt Nam xuất được. Hình dạng `v1` chỉ được chốt ở S5.1 trên
tệp xuất THẬT của khách đầu tiên; §11 ghi câu hỏi cho buổi gặp.

### 8.9. Reverse Auction đứng ngoài, và lý do phải nói ra

V2.1 §23 đòi *"không tiết lộ tên NCC, giá của NCC khác"* nhưng *"cung cấp tín hiệu cạnh tranh phù hợp chính sách"*. Một tín
hiệu *"bạn chưa thấp nhất"* là một trường phái sinh của giá người khác đi tới một nhà cung cấp — đúng lớp A4/A5 canh, và chưa
phép đo nào trong kho nói nó rò bao nhiêu. Đó là một spec riêng với phép đo riêng, không phải một hạng mục của lát cắt tích hợp.
Roadmap V2.1 §39 đặt nó TRƯỚC ERP; tài liệu này đề xuất đảo (Q1).

### 8.10. Chủ quyền dữ liệu

Hoá đơn và GRN là dữ liệu tài chính của khách rời ERP sang một SaaS có khoá ở Singapore (ADR-009). Tiền đề D1 đang mở; một
khách Enterprise FDI hay một yêu cầu pháp lý về nơi lưu dữ liệu có thể lật ADR-009 — điều kiện mở lại của chính ADR ấy. S5
không quyết; §11 hỏi.

### 8.11. ADR-020 đã quá điều kiện xét lại mà chưa ai gọi tên

104 route đo lúc viết, điều kiện là 40. Không phải lỗi của S5, nhưng S5 là lát cắt cần tệp và bề mặt máy nên là lúc trả lời
(§2.4 (b)). Rủi ro nếu không trả lời: một ai đó kéo multipart vào `apps/api` để *"tải CSV cho tiện"* và ba lớp canh trên
`ROUTES` mất chủ ngữ.

### 8.12. Cổng bằng khách hàng có thể không bao giờ mở

Nếu không khách nào ở bậc 2 trở lên có ERP và đồng ý tích hợp, S5.1 trở đi không mở — và đó là kết quả ĐÚNG của §2.4 (a),
không phải thất bại của spec. Phần dùng được không cần khách: S5.0.

---

## 9. Phân rã công việc

Ước lượng KHÔNG viết ở đây: spec S3 §9 đã đo rằng con số tuần trong kho này là ước lượng cùng loại với 6–8 tuần của V2.1 §31,
và số đo duy nhất (S2: 3–4 tuần ước, 41 giờ qua 14 vòng thật) không ngoại suy được sang một lát cắt phụ thuộc hệ ngoài.

| # | Hạng mục | Ra cái gì | Chờ |
|---|---|---|---|
| **S5.0** | Nền và nhập từ tệp | ADR (a), (b); nới dải `[A-HJ-L]`→`[A-HJ-M]` ở mọi chỗ ghim (grep lúc làm, mũi thu dải); gói `packages/tich-hop` + họ quy tắc `depcruise`; dán hạng mục vào gói `DRAFT`, dán sổ nhà cung cấp (§4.5); hai hàng sổ; màn | Không — ngoại lệ (a) |
| **S5.1** | Chứng chỉ máy và đường vào | ADR (c), (d); `sessions.kind` nới; vai `INTEGRATION`, `erp.sync`, `integration.manage`; trường `integration` trên route; route phát/thu hồi; bảng nhận PR + route; `GET /integrations/erp/items`; cổng đối chiếu tập route máy; **M1, M3, M4 (vế PR), M9**; màn `/tich-hop` phần chứng chỉ | Khách có ERP (a); S4.2a (bí danh) — có |
| **S5.2** | Bản xuất PO | `erp_po_exports` + dòng trong giao dịch duyệt trao; tài liệu `v1`; tải cho người (Q2 ⒜); kéo và ACK cho máy (Q2 ⒝); `THU_HOI` khi huỷ; **M2 (tải, kéo, ACK), M5 (vế xuất), M6, M7**; ERP giả lập `tools/erp-gia-lap`; kịch bản 41 bước xuất; bước 14 kim xuất | S5.1; S3.5a — có; S4.7c (lời khai cam kết trong tài liệu) |
| **S5.3** | Nhận GRN, hoá đơn; đối chiếu | Hai bảng nhận + route; `tco_doi_chieu`; hồ sơ nhà cung cấp hiện *Delivery*, *Quality*, đối chiếu; **M4, M5 (vế hoá đơn), M10 (vế đối chiếu), M2 (vế đối chiếu)**; bước 14 kim hoá đơn | S5.2; S4.7c |
| **S5.4** | Supplier Score | Thiết kế spec S4b §7 + ㊾ + hai nguồn mới; `diem_ncc` với `CHECK` khẳng định; bản chụp lúc đề xuất (Q8); hồ sơ phía bên mua; **L9** | S5.3; S3.7, S3.8; S4b.2 cho thành phần *Risk* (thiếu thì không khai được — L9, không chờ) |
| **S5.5** | SSO/OIDC | ADR (e); `org_sso_configs`, `user_identities`; đường OIDC + TOTP; cờ triển khai và công tắc theo tổ chức; `tp-khoi-tao` chế độ `sso`; tên miền JWKS ở DNS Firewall; **M8** | Khách Enterprise có IdP; độc lập với S5.1–S5.4 |
| **S5.6** | Đa tiền tệ | ADR (f); một migration nới bốn bản chép; ô chọn; **M10 (vế tập)** | Một khách mua bằng đơn vị thứ ba (tiền đề C4) |
| **S5.7** | PUSH webhook | ADR (g); `kind` outbox mới + `ALTER POLICY`; ký HMAC; thử lại có trần; biến hạ tầng theo khách; nhật ký ở `/tich-hop` | Q2 ⒞; S5.2 |
| **S5.8** | Bằng chứng và xuất sổ | Lớp ERP trong bộ xuất ADR-059 và `DAC-TA.md` (bản xuất, ACK, đối chiếu, bản chụp điểm); xuất sổ kiểm toán của tổ chức theo khoảng thời gian, theo TRANG, kiểm chuỗi hash ngoại tuyến bằng bộ kiểm của `packages/audit` (V2.1 §27, §34 *Audit Export*) dưới `audit.read`; **M7 (vế ngoại tuyến)**; lượt đi thử T4 trọn | S5.3; S3.9 (lớp governance đi trước lớp ERP trong cùng bộ) |

Mỗi hạng mục đi đúng vòng lặp của spec S0+S1 §9: đo trước khi viết, một bất biến một phép đo, đột biến, rồi tài liệu. Mọi
hàm và trigger mới ghim ở `hardening.always.sql` trong cùng commit với migration.

### 9.1. Việc S5 nhờ các hạng mục đang chạy để lại — ĐỀ XUẤT, chốt ở lượt soi

Đây là lý do *"chuẩn bị trước"*: mỗi dòng dưới là một hình dạng mà nếu hạng mục kia không để lại, S5 phải sửa một migration
đã áp.

| Hạng mục đang chạy | S5 cần gì | Vì sao |
|---|---|---|
| **S4.7c** (lời khai TCO lưu cùng award) | Lưu theo TỪNG MÃ thành phần (`van_chuyen`, `nhap_khau`, `chi_phi_thanh_toan` → `paymentDays`, `chi_phi_tre` → `leadTimeDays`), kèm `bid_version_id` và `policy_id`, không gộp thành một tổng | §4.4 đối chiếu từng mã với hoá đơn và GRN; một tổng không đối chiếu được |
| **S3.8** (view hiệu suất) | Phần tính theo nhà cung cấp là một HÀM SQL nhận `(org_id, supplier_id, p_moc)`, view chỉ gọi hàm | §4.6 *Responsiveness* đọc as-of `moc_de_xuat` cho bản chụp Q8; một view không nhận mốc (bài học spec S4 §2.5 ⑿) |
| **S3.7** (`supplier_qualifications`) | Hàng thẩm định mang người làm, hạn, và lý do thu hồi; hàm *"còn hiệu lực tại mốc"* | *Compliance* theo ㊾ hiện người và lý do; as-of |
| **S3.9** (bộ bằng chứng lớp governance) | Chỗ cắm cho một LỚP nữa trong `DAC-TA.md` và `du-lieu` (khuôn S4.5c2 đã làm cho lớp dữ liệu nền) | S5.8 thêm lớp ERP, không viết lại bộ xuất |
| **S4b.2** (yếu tố rủi ro) | Hàm *"N là thành viên của yếu tố nào ở mức nào tại mốc"* | *Risk* của Supplier Score (㊾) |
| **S3.5b** (màn `/mo-thau` phần award) | Khối award để một chỗ cho *trạng thái ngoài* (bản xuất) không chen vào luồng ký | §3.5 |

---

## 10. Ngoài phạm vi tài liệu này

- **Reverse Auction** (V2.1 §23, roadmap M10) — một chế độ mua sắm khác với phép đo rò riêng (§8.9). Đề xuất Q1: spec riêng,
  sau pilot.
- **Adapter riêng cho Odoo, SAP Business One, Bravo, FAST, S/4HANA, Dynamics, Oracle** (V2.1 §30) — theo khách, mỗi adapter
  một hạng mục có ADR (§2.5 ⑹).
- **Quy đổi tỷ giá để xếp hạng chéo tiền tệ** (Q5 ⒝) — chờ một khách cần; nếu làm, tỷ giá là thước ghim lúc `OPEN` theo khuôn
  ADR-097 ⑸.
- ***Quality Cost* thành tiền** (V2.1 §16) — §4.4 cho tỷ lệ từ chối theo GRN; biến nó thành một số tiền cần một tham số *chi
  phí của một đơn vị lỗi* do bên mua khai, tức một cần gạt thứ hạng nữa (spec S4 §8.6). Không ở S5.
- ***Claim rate*, *Contract compliance*** (V2.1 §13) — kho không có khiếu nại, không có hợp đồng.
- **Đa công ty** (V2.1 §34 *Multi-company*) — một tập đoàn là N tổ chức; hợp nhất xuyên tổ chức đụng oracle ADR-013 và cần
  ADR riêng khuôn ADR-013 §4. S5 chỉ cho mỗi tổ chức xuất dữ liệu của mình (S5.8).
- **Data Warehouse, BI** (V2.1 §34) — phía khách, trên bản xuất và sổ xuất của S5.8; không kho dữ liệu nào trong sản phẩm.
- **Custom Policy Engine, vai riêng theo tổ chức, chuỗi duyệt nhiều bước** (V2.1 §34) — spec S3 §10 đã xếp Enterprise với
  đường đi là bảng đè theo tổ chức; cần spec riêng.
- **Đa ngôn ngữ** (V2.1 §34) — không khách nào yêu cầu; giao diện tiếng Việt.
- **Chia sẻ Passport xuyên tổ chức** — ADR-013 §4, ADR riêng về oracle.
- **Nguồn giá thị trường tự động, cào web, API giá** — spec S4 §10 xếp S5; tài liệu này KHÔNG nhận: nó là một nguồn thước mới
  với rủi ro spec S4 §8.5, cần quyết định riêng khi có khách trả tiền cho nguồn ấy.
- **Tạo người dùng tự động từ IdP (JIT), SCIM, quản lý thiết bị/phiên của V2.1 §28** — ADR-111 giữ việc tạo người ở
  `tp-khoi-tao`; đổi điều ấy là một ADR riêng.
- **Viết ngược vào ERP ngoài PO** — hợp đồng, thanh toán, nhà cung cấp (ERP là chủ của vendor master; S5 chỉ ĐỌC từ ERP về).
- **Thanh toán, GRN ở trong TrustProcure** — V2.1 §4: *"TrustProcure không cố gắng thay thế ERP trong giai đoạn Purchase-to-Pay"*.
- **Phân tách nhiệm vụ cho hành vi huỷ gói sau khi giá lộ** (ADR-103 *Cái giá*) — S3, không S5.

---

## 11. Tiền đề cho `docs/TIEN-DE-CHUA-DO.md` — đề xuất, chuyển sang tệp ấy ở lượt soi

Khuôn spec S4 §2.5 ㉕ và S4b góc D⑪: tiền đề suy từ spec vào tệp tiền đề ở LƯỢT SOI, không ở bản nháp, để mỗi dòng mang
đúng con trỏ về mục spec đã chốt. Dự thảo nhóm **F — về TÍCH HỢP và DOANH NGHIỆP**:

| # | Tiền đề mã S5 sẽ cư xử như thật | Nằm ở đâu | Sai thì mất gì | Câu hỏi cho người mua thật |
|---|---|---|---|---|
| **F1** | Khách xuất được PR, PO, GRN, hoá đơn từ ERP ra bảng tính, hay ERP có API gọi ra ngoài được | §2.4 (b), §4.3 | S5.1–S5.3 không có đầu vào; chỉ S5.0 dùng được | *"Phần mềm kế toán/ERP của anh xuất được danh sách đơn mua và phiếu nhập kho ra Excel không? Có ai bên IT viết được một đoạn gọi API không?"* |
| **F2** | ERP ghi NGÀY NHẬN và SỐ LƯỢNG TỪ CHỐI theo từng dòng PO | §4.3 `erp_receipt_lines`, §4.6 *Quality*, *Delivery* | Hai thành phần mới của Supplier Score không có nguồn — Supplier Score lại hoãn | *"Khi hàng về, kho của anh ghi gì: chỉ số lượng nhận, hay cả số bị trả lại và lý do?"* |
| **F3** | ERP chấp nhận một PO có nguồn từ hệ ngoài (nhận tài liệu PO, hay ít nhất nhận *đề nghị PO* rồi tự tạo số PO) | §4.2, V2.1 §4 *ERP PO* | Bản xuất không có nơi đến; `so_po_erp` không bao giờ có | *"PO của anh tạo ở đâu — kế toán gõ tay từ bản duyệt, hay nhập từ tệp?"* |
| **F4** | Có một người ở khách giữ việc kết nối (trưởng phòng mua hàng hay IT) và người ấy không duyệt trao thầu | §4.1 `integration.manage` | Vai cấu hình rơi vào người giữ `po.approve` — một người vừa đặt kênh ERP vừa duyệt trao; trigger `033` chặn, và tổ chức nhỏ kẹt (nhân lên từ B4) | *"Ai ở công ty anh sẽ cầm việc nối hai phần mềm? Người ấy có duyệt đơn mua không?"* |
| **F5** | Công ty đã có đăng nhập một lần (Microsoft 365 / Google Workspace) và chấp nhận vẫn gõ TOTP sau SSO | §4.7, Q4; tiền đề B6 | Q4 ⒜ không bớt được ma sát nào đáng kể; hay ⒝ phải mở | *"Nhân viên anh đăng nhập máy tính công ty bằng tài khoản Microsoft/Google không? Nếu vẫn phải gõ thêm mã TOTP thì có chấp nhận không?"* |
| **F6** | Đơn vị tiền ngoài `VND`/`USD` (nếu có) là một trong tám mã của Q5 | §4.8 | Một `CHECK` nữa phải nới — một migration nữa | *"Anh có mua bằng ngoại tệ nào ngoài đô — euro, yên, nhân dân tệ?"* (nối tiền đề C4) |
| **F7** | Khách chấp nhận hoá đơn và GRN (dữ liệu tài chính) rời ERP sang một SaaS có khoá ở Singapore | §8.10; tiền đề D1 | S5.3 không mở được cho khách ấy; ADR-009 bị lật | *"Số liệu hoá đơn mua hàng của anh có được phép đưa lên một dịch vụ đám mây đặt ngoài Việt Nam không?"* |
| **F8** | Mã vật tư trong ERP của khách ổn định và là một-một với hàng chuẩn | §2.5 ⑾, §4.5 | Bí danh hàng chuẩn đổi liên tục; hàng đợi S4.3 đầy | *"Một mặt hàng trong ERP của anh có một mã cố định không, hay mỗi lần nhập một mã?"* |

Dòng nào có TÊN NGƯỜI và NGÀY thì chuyển sang `docs/DECISIONS.md` đúng quy ước 2 của tệp tiền đề, không ở lại đây.

---

## 12. Về quy trình

Quyết định *"chuẩn bị trước spec S5"* là của chủ dự án ngày 2026-10-07. Viết spec trước cổng không phạm ADR-043 hay
ADR-093, vì hai ADR ấy chặn vòng MÃ — tiền lệ S1.138, S1.158, S1.160. Vòng này không chạm mảnh nào của `docs/PRODUCT.md`
§11, không chạy song song với hạng mục S3/S4 nào, không sửa `docs/TEST-PLAN.md` (nhóm M vào sổ ở S5.0 theo hạng mục đo được),
không sửa `docs/TIEN-DE-CHUA-DO.md` (§11 chờ lượt soi). Thứ còn lại của vòng là một dòng ở `docs/PRODUCT.md` §7, một cột mốc ở
`docs/STATE.md`, và tài liệu này — `pnpm cap-so` cấp số thật cho **S1.9101** lúc merge.

**Đọc lại khi lớp nền có mã.** Spec này viết trên bảng chưa tồn tại (S4.7c, S3.7, S3.8, S3.9, S4b.2) và trên một ERP không
tồn tại. Khi mỗi lớp nền vào `master`, hạng mục kế tiếp của S5 đọc lại đúng mục tương ứng (§9.1) trước khi viết mã, và ghi
kết quả vào biên bản của vòng ấy. Khi có tệp xuất THẬT đầu tiên của một khách, §4.3 và hình dạng `v1` đọc lại trọn.
