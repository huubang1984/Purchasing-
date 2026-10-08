# TrustProcure V2 — Thiết kế S5: Tích hợp ERP và Doanh nghiệp (ERP Integration & Enterprise)

> **Ngày:** 2026-10-07 · **Trạng thái:** ~~**BẢN NHÁP — chưa qua lượt soi hình dạng.**~~ **[S1.9102] ĐÃ QUA LƯỢT SOI HÌNH
> DẠNG — 55 phát hiện thô từ bốn góc cộng 11 của lượt gộp, 36 sau khử trùng, 7 CAO; mười một lời khai đo trên lược đồ THẬT
> (mọi migration + hardening) ở Postgres 16.15 cục bộ** (`evidence/security-reviews.md` §S1.9102). Phần gốc giữ nguyên văn,
> chỗ sai gạch tại chỗ kèm nhãn `[S1.9102]`; mệnh đề chịu lực là bản đã sửa — đọc §2.6 (chốt từ lượt soi), §2.7 (câu còn
> chờ chủ dự án), §4.10, §5.1 và §9.2 cùng phần gốc. **Chủ dự án chưa chốt câu nào trong vòng này**: mọi lựa chọn sản phẩm ở
> §2.7 kèm đề xuất, chưa phải quyết định. Viết TRƯỚC khi S3 và S4 khép, trước
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

- S3 còn S3.4 (K9, đang ở một nhánh khác), S3.5b, S3.6c, S3.6d, S3.7, S3.8, S3.9 chưa có mã. S4 còn S4.7b, S4.7c ~~;~~ **[S1.9102]** và S4.8 (khoá ngoại nhóm hàng — D⑭); S4b
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
| 13 | Tiền tệ của báo giá đọc qua MỘT hàm về tập đóng {`VND`, `USD`}; ~~bốn bản chép của tập khoá nhau bằng một test đọc tệp~~ **[S1.9102]** tập `('VND','USD')` nằm ở CHÍN `CHECK` có tên riêng (`014`×2, `057`, `103`×2, `104`, `109`×2, `110`), hằng `CURRENCIES`, hai `RETURN` của `070` và hai ô chọn; `packages/rfq/src/tien-te-dong-bo.test.ts` chỉ khoá bốn trong số đó, còn `tien-te-mot-cho-doc.test.ts` là INV-J8 — canh phép ĐỌC, không canh tập (A⑤); hàm theo bậc không lặng lẽ cho qua lệch tiền tệ; lượt chấm từ chối tập báo giá lệch tiền tệ | ADR-103, ADR-082 ⑽, spec S2 §2.3 ⑻ | Đa tiền tệ nghĩa là NỚI tập đóng bằng một migration, không nghĩa là quy đổi (Q5) — **[S1.9102]** và ở tổ chức đã bật S3 nới tập KHÔNG đủ: `award_chot_bac` trả `K7_LECH_TIEN_TE` khi báo giá khác tiền tệ của phiên bản chính sách ghim (`113:376`) (C⑩) |
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
| **Q4** | **SSO thay yếu tố nào.** Hôm nay đăng nhập người mua = link email + TOTP (ADR-020 §2 ⒝). ⒜ SSO thay LINK EMAIL, giữ TOTP; ⒝ SSO thay CẢ HAI khi IdP khai `amr` có MFA; ⒞ tổ chức chọn ⒜ hay ⒝ | ⒜ ⒝ ⒞ | **⒜.** Hai yếu tố ở hai kênh là nguyên tắc ADR-015 áp cho người mua ở ADR-020; trigger `sessions_kiem_totp_gan_day` (`039`) không đổi; một IdP bị chiếm — hay một quản trị IdP tạo người dùng mang email của FINANCE — không mở được phiên. Tiền đề B6 vì thế KHÔNG tắt: nhân viên vẫn cài TOTP. **[S1.9102]** Vế thêm từ lượt soi (C③), chốt ở §2.6 ㉙: ghi danh TOTP lần đầu và sau đặt lại (`040`) KHÔNG đi qua SSO, và lần ràng `sub` đầu đòi link email — kênh thứ hai —, vì hôm nay `/auth/redeem` ghi danh TOTP cho người chưa có hồ sơ (`apps/api/src/routes/auth.ts:149-160`): một quản trị IdP chiếm được mọi người CHƯA ghi danh của tổ chức | Khách mua SSO để *bớt một bước*; ⒜ chỉ bớt bước mở hộp thư. Câu trên màn phải nói đúng: *"Đăng nhập bằng tài khoản công ty, rồi mã TOTP"* |
| **Q5** | **Đa tiền tệ nghĩa là gì.** ⒜ nới tập đóng {`VND`, `USD`} thêm một danh sách ISO 4217 (GIẢ ĐỊNH: `EUR`, `JPY`, `CNY`, `KRW`, `SGD`, `THB`), giữ luật *một gói một tiền tệ* (spec S2 §2.3 ⑻) và *benchmark cùng tiền tệ*; ⒝ ⒜ cộng bảng tỷ giá theo tổ chức ghim lúc gói vào `OPEN` để xếp hạng chéo tiền tệ | ⒜ ⒝ | **⒜ ở S5; ⒝ chờ một khách cần**, khuôn ADR-132 (*"bị từ chối tới khi một khách hàng cần"*). Một tỷ giá do bên mua khai là một *người đặt thước* nữa (`033`), và nó quyết định thứ hạng — đúng hình dạng ADR-097 ⑸ vừa phải ghim. **[S1.9102] Lượt soi đổi câu hỏi** (A⑤, C⑩): ở tổ chức đã bật S3, `org_procurement_policies.currency` là một tiền tệ mỗi phiên bản (`014:62`) và `award_chot_bac` trả `K7_LECH_TIEN_TE` khi báo giá khác tiền tệ chính sách (`113:376`) — nới tập đóng KHÔNG cho tổ chức ấy mua ngoại tệ, lối ⒜ chỉ chạy ở tổ chức CHƯA bật S3. Ba lối mới: ⒜′ nới tập và nói thẳng giới hạn ấy trên màn; ⒝′ bậc theo tiền tệ — một thay đổi lược đồ của S3.1, không phải nới `CHECK`; ⒞ tỷ giá ghim lúc `OPEN`. **Đề xuất ⒜′**, cộng: ô tiền tệ của `/nop-thau` GHIM theo tiền tệ ngân sách của gói ở tổ chức đã bật (nhà cung cấp không chọn) — một cách viết sai không còn chặn cả gói | Nhà cung cấp báo `EUR` vào gói `VND` vẫn làm lượt chấm từ chối cả gói (ADR-103), nay với một danh sách dài hơn — **[S1.9102]** trừ khi ô tiền tệ được ghim theo gói |
| **Q6** | **Ai ghi dữ liệu từ ERP, và ai thấy.** GRN không mang tiền (ngày nhận, số lượng nhận, số lượng từ chối); hoá đơn mang tiền | Vai · cổng | **Người ghi là chứng chỉ máy (`erp.sync`) hoặc người giữ `integration.manage` dán lô.** GRN đọc được bởi mọi người mua của tổ chức (không giá); hoá đơn đọc bằng `bid.view` và khai ở ADR-054. Người giữ `erp.sync` không giữ mã quyền nào khác (khuôn `033`) | Hai mã quyền mới — `erp.sync` cho máy, `integration.manage` cho người cấu hình — là hai mã ADR-084 ⑴ phải thấy đủ tiêu chí *tách người*: máy không được là người có `bid.view`; người cấu hình kết nối không được là người DUYỆT trao (`po.approve`) — ~~đề xuất gán `integration.manage` cho `PROCUREMENT_MANAGER`, vai duy nhất của `005` giữ `bid.view` mà không giữ `po.approve`~~ **[S1.9102] Gộp vào Q12**: PM là *người chọn danh sách* và người đề xuất (`005:297-304`); đặt cần gạt GRN và sổ nhà cung cấp vào tay PM là đúng hình dạng *người đặt thước cầm thứ bị đo* mà L3 cấm (C②, D⑥) |
| **Q7** | **Trọng số Supplier Score** (ADR-100 Q1 để lại). ⒜ không mặc định — tổ chức khai trên các thành phần CÓ NGUỒN ở phiên bản ấy; ⒝ co giãn bộ V2.1 §13 trên thành phần có nguồn | ⒜ ⒝ | **⒜.** Spec S4 §4.9 đã từ chối tự chia lại trọng số V2.1, và ㊾ cho thấy mỗi thành phần là một cần gạt — một bộ mặc định là một bộ cần gạt không ai chọn | Tổ chức không khai `diem_ncc` thì không có Supplier Score — màn nói *"chưa khai trọng số"*, không số |
| **Q8** | **Supplier Score có chụp vào đề xuất trao thầu không.** ADR-100 Q1 bỏ cột bản chụp trên `rfq_risk_assessments` vì Supplier Score rời S4b | Có · Không | **Có, ở bảng RIÊNG theo đề xuất** (`rfq_award_supplier_score_snapshots`), để bộ bằng chứng mang đúng con số người đề xuất đã thấy (V2.1 §22: *"Historical performance tốt"* là một lý do của đề xuất) | Một bảng nữa; S4b.7 và S3.9 phải đọc nó khi dựng lớp của mình |
| **Q9** | **Nhập từ tệp cho pilot bậc 2 có đi trước phần còn lại không** (kế hoạch pilot §7: *"Bậc 2 cần nhập gói từ một tệp của khách (CSV)"*) | Có · Không | **Có — S5.0**, ngoại lệ hẹp §2.4 (a). Đây là mảnh duy nhất của S5 phục vụ pilot thay vì chờ pilot | Một vòng mã S5 trước khi có khách; bù lại nó không chạm đường mở thầu, không chạm giá, không cần chứng chỉ máy |
| **Q10** | **Ai cấp chứng chỉ máy và bật SSO cho một tổ chức.** Hôm nay không route nào gán vai; tổ chức và người dùng đi qua task `tp-khoi-tao` (ADR-111) | Task · Route | **Cấu hình SSO và người dùng đại diện kết nối: task `tp-khoi-tao` (bản khai ở Secrets Manager, có người duyệt). Chứng chỉ máy: route của người giữ `integration.manage` với TOTP tươi, khuôn `POST /auth/agent-session`** | Bật SSO cho một khách là một lần chạy workflow có người duyệt, không phải một ô trên màn — chậm, cố ý. **[S1.9102]** Vế chứng chỉ máy gộp vào Q11: *khuôn `/auth/agent-session`* không đứng được — route `self: true` không mang mã quyền và chỉ phát cho chính người gõ TOTP (A①), còn người đại diện không có TOTP không chèn được phiên nào (B①, đo M2) |
| **Q11** **[S1.9102]** | **Chứng chỉ máy gắn vào ai.** Đo trên lược đồ thật (M1, M2a, M2b): `029` buộc mọi phiên `app_api` chèn phải mang `mfa_verified_at`; `039` buộc phiên mang `mfa_verified_at` đi sau một lần TOTP của CHÍNH `user_id` ấy; `resolveSessionByToken` đòi `mfa_verified_at IS NOT NULL`. Người đại diện không có TOTP ⇒ không hàng phiên nào mint được hay dùng được | ⒜ Người đại diện + hình dạng riêng của `kind = 'INTEGRATION'`: `mfa_verified_at` NULL là hợp lệ cho `kind` ấy — một migration thay thân `029` đã ghim (chỉ nhánh `kind`), resolver rẽ theo `kind`, `039` không chạm (chỉ xét `NOT NULL`); cộng hai trigger: người giữ vai `INTEGRATION` không có hồ sơ TOTP và không có phiên `USER` (B⑬) · ⒝ Chứng chỉ của chính NGƯỜI PHÁT (khuôn agent): TOTP tươi của người ấy thoả `039`; không người đại diện, không vai `INTEGRATION`, không `erp.sync` — quyền máy chỉ bằng vị từ `kind` trên route | **⒜.** Người đại diện là lý do K2 và K8a sạch (hồ sơ nhập bởi máy không do người chọn danh sách dựng); chứng chỉ không chết theo nhân sự; sổ kể đúng *một kết nối* làm. Cái giá: thay thân `029` — một trigger của đường đăng nhập, ghim ở hardening; ADR-039 §3 đã bác *nới `039`* và (c) phải nói rõ ⒜ không chạm `039`. ⒝ rẻ hơn nhưng mọi hồ sơ, GRN, ACK máy ghi mang tên một nhân viên, và K2 loại hồ sơ ấy nếu nhân viên ấy mời | Hai lớp CSDL mới ở đường đăng nhập; mọi test của `029`/`039` lật ở nhánh `kind` — kê tên ca lật |
| **Q12** **[S1.9102]** | **Người của tích hợp là ai** — người giữ `integration.manage` (phát/thu hồi chứng chỉ, cấu hình), người DÁN lô GRN, người nhập sổ nhà cung cấp ở S5.0. Bản nháp đặt cả ba ở PM (Q6, §4.1, §4.5). K2 (`107:118-137`) không đếm hồ sơ do người chọn danh sách dựng (D⑥); GRN là một thước về nhà cung cấp trong tay người đề xuất trao (C②); `nha-cung-cap-dem-duoc.ts` của test-support đã phải dựng *người nhập riêng* vai `TECHNICAL` vì đúng lý do ấy | ⒜ Vai MỚI (`INTEGRATION_ADMIN`) giữ `integration.manage` và `supplier.import`; luật khuôn `083`: không cùng người với `rfq.create`, `rfq.invite`, `award.recommend`, `po.approve`, `supplier.manage`, `policy.manage` · ⒝ `TECHNICAL` nhận hai mã ấy — vai chỉ giữ `evaluation.perform`, chính vai test-support dùng làm người nhập · ⒞ PM như bản nháp, nói ra cái giá | **⒝**, với cùng luật người của ⒜. Không thêm người mới (B4); tiền lệ của kho. Cái giá: người chấm kỹ thuật giữ kênh ERP — hai thước về nhà cung cấp một tay, nói ra ở §8.13. Hoá đơn (mang tiền) và bản xuất PO chỉ đi qua MÁY; người dán chỉ dán GRN và PR | ⒜ là một người nữa (nhân lên từ B4, E1, E14); ⒞ làm S5.0 vô dụng ở tổ chức đã bật S3 |
| **Q13** **[S1.9102]** | **Huỷ một award ĐÃ XUẤT.** FINANCE huỷ award đã `DA_KEO` (ADR-057, `po.approve`) rồi trao lại: ERP — và chứng chỉ máy — nay giữ đơn giá của HAI báo giá cùng gói, tức một bảng so sánh hai dòng (C①). M1 đúng ở mỗi thời điểm, không đúng theo thời gian | ⒜ Huỷ award đã xuất đòi chữ ký thứ hai (khuôn K5b) và hàng sổ riêng · ⒝ Nói ra: hàng `THU_HOI` không trả dòng, F11 của S4b đọc thêm cờ *đã xuất ERP*, M12 viết đúng *"mọi báo giá ĐÃ TỪNG được trao"* | **⒝.** Người huỷ đã giữ `bid.view` và thấy mọi giá; ADR-057 chốt *cổng huỷ là của người duyệt*; cái mất là *báo giá thua được công bố ở ERP* — một hệ quả sản phẩm phải nói ra, không một đặc quyền mới | ⒜ thêm một chữ ký cho một hành vi đã có chốt; ⒝ chấp nhận rằng ERP biết giá của người thua sau một lần huỷ |

### 2.4. Bảy ADR phải chốt ở lượt soi hình dạng

| ADR | Câu hỏi | Vì sao chặn |
|---|---|---|
| **(a)** | **Ngoại lệ HẸP thứ ba với ADR-043, cho ĐÚNG MỘT hạng mục S5.0** (nhập hạng mục gói và sổ nhà cung cấp từ văn bản dán), khuôn ADR-080 ⑴ / ADR-093 ⑴. **Cổng của phần còn lại là một KHÁCH HÀNG:** S5.1 trở đi chỉ mở khi một tổ chức thật ở bậc 2 trở lên của thang pilot (kế hoạch §7) có ERP và đồng ý tích hợp, đo bằng biên bản buổi gặp có TÊN và NGÀY (quy ước 2 của `docs/TIEN-DE-CHUA-DO.md`). Luật dừng: S5.x nhường khoản rổ A, vòng triển khai thật, pilot, và S3.x/S4.x khi sửa *cùng cột, cùng hàm ghim, cùng tệp mã* (ADR-093 ⑶). **[S1.9102]** (D③) Cổng *bậc 2* chỉ mở VÒNG MÃ S5.1–S5.3 trên ERP giả lập cộng tệp xuất THẬT của khách để chốt `v1`; dữ liệu ERP thật (GRN, hoá đơn) và lượt T4 *trên cụm thật* chỉ sau mảnh 3 (bậc 3 của thang), và quyết định ADR-062 *người thứ hai trước dữ liệu thật* phải có tên và ngày trước đó (kế hoạch pilot §7). (D②) Luật dừng áp ngay cho S5.0: `apps/web/trang/tao-thau.js` là tệp S4.7b cũng sửa — khối dán của S5.0 tách sang một module riêng, hay S5.0 chờ S4.7b | ADR-043 là luật đang hiệu lực. Không có (a) thì S5.0 không có quyền mở vòng, và dòng trỏ mảnh của nó không trỏ vào đâu — hình dạng khoản 237 đo. Không có cổng bằng khách thì S5 là lát cắt dựng trên một ERP không tồn tại |
| **(b)** | **Tầng HTTP trước tệp và bề mặt máy.** Điều kiện xét lại của ADR-020 §1 (*"khi `ROUTES` vượt 40, hoặc khi cần streaming/multipart"*) đã chạm vế đầu từ lâu (104 route, §2 ⑷) và S5 chạm vế sau. Đề xuất: GIỮ `node:http` trần và `ROUTES` — vì cả ba lớp canh *"với MỌI route"* (H17, E6, bộ quét rò rỉ) đứng trên mảng ấy; KHÔNG multipart, KHÔNG streaming ở S5.0–S5.3: tệp đi bằng DÁN VĂN BẢN và thân JSON ≤ 64 KiB theo lô (khuôn ADR-096 ⑸ / ADR-149, ≈ 500 dòng mỗi lô), bản xuất và sổ kiểm toán xuất theo TRANG; viết lại dòng *"điều kiện xét lại"* của ADR-020 thành một mốc đo được mới | Chọn sai thì hoặc S5 kéo một framework vào `apps/api` để tải tệp — mất ba lớp canh — hoặc một lần nữa nới ADR-020 mà không ai gọi tên |
| **(c)** | **Chứng chỉ tích hợp.** `sessions.kind` thêm `INTEGRATION` (migration mới: `CHECK sessions_kind_hop_le` là tập đóng); TTL trần (GIẢ ĐỊNH 90 ngày, so với 60 phút của agent); phát bởi người giữ `integration.manage` với TOTP tươi ~~(khuôn `/auth/agent-session`, `self: true`)~~ **[S1.9102]** qua một `BuyerWriteRoute` mang `permission: 'integration.manage'` — route `self: true` không có trường `permission` và chỉ được ở `/auth/*` (`route-types.ts:353`, `:526`), còn `startAgentSession` ném khi `mfaProof.userId !== input.userId` (`login.ts:510`): hàm phát là hàm MỚI, phát phiên cho người KHÁC người gọi (A①) —, chứng chỉ không tự gia hạn, không tự nhân bản (ADR-039); gắn vào một người dùng ĐẠI DIỆN của kết nối (hàng `users` do `tp-khoi-tao` tạo, vai `INTEGRATION` giữ đúng `erp.sync` — luật vai/người khuôn `033`) **[S1.9102]** — người đại diện không có hồ sơ TOTP, nên dưới `029` + `039` + `resolveSessionByToken` hôm nay KHÔNG hàng phiên nào của họ chèn được hay dùng được (đo M2a, M2b): (c) chốt theo Q11 — đề xuất ⒜: `mfa_verified_at` NULL là hình dạng hợp lệ của riêng `kind = 'INTEGRATION'` (thay thân `029` cho nhánh `kind`, resolver rẽ theo `kind`, `039` không chạm), cộng hai trigger cấm hồ sơ TOTP và phiên `USER` cho người giữ vai `INTEGRATION` (B⑬; `app_api` có `INSERT` trên `mfa_credentials`, `006:385`); ~~`actor_type = 'SERVICE'` khi ghi sổ (giá trị đã có trong `CHECK` của `003`, không nới)~~ **[S1.9102]** sổ ghi `actor_type = 'USER'` + `actor_id` người đại diện và `kind` của phiên trong payload — `SessionActor.type` là literal `"USER"` và ADR-039 ⑵ cố ý không nới (A⑨, C⑨); trường BẮT BUỘC `integration: boolean` trên ~~mọi route người mua (khuôn `agent`), vị từ duy nhất~~ **[S1.9102]** CẢ BA kiểu route người mua, kể cả `BuyerWriteRoute` — khuôn `agent` chỉ nằm trên route đọc và tự thân, và `agentGoiDuoc` đóng vô điều kiện với route ghi (A⑥; `route-types.ts:421-427`); vị từ `integrationGoiDuoc` duy nhất, cho qua route ghi khi và chỉ khi `permission === 'erp.sync'`; 403 có sổ trước `requirePermission`; trần đọc theo phiên khuôn `AGENT_DOC_TRAN_MOI_CUA_SO`, 429 trước hàng sổ (C⑫); route THU HỒI chứng chỉ dưới `integration.manage` — route ĐẦU TIÊN trong kho thu hồi phiên của người khác (C⑤); TTL trần đi theo một phép đo như `051`, không một con số tròn; tuỳ chọn ghim dải IP (GIẢ ĐỊNH); trigger mức NGƯỜI của `integration.manage` tắt mặc định — chỉ áp khi tổ chức có hàng `org_integrations` —, vì `FINANCE+PROCUREMENT_MANAGER` là một trong ba cặp hợp lệ hôm nay (`005:201`) và một migration cấm cặp ấy đổ ở tổ chức đang có người ấy (D⑫) | Không có (c) thì bề mặt máy mượn phiên người — đúng lỗ ADR-039 đo (H-1 của lượt soi 69). `sessions.kind` và `agent` đã có khuôn; làm khác khuôn là hai bản chép của cùng một ý |
| **(d)** | **Bảng mang giá của S5 vào ADR-054**: bản xuất PO (`erp_po_exports` + dòng) — vai ghi `app_api` trong giao dịch duyệt trao; cổng đọc `bid.view` (người) và `erp.sync` (máy, chỉ lô của tổ chức mình, chỉ award `APPROVED`); hoá đơn (`erp_invoice_lines`) — vai ghi `erp.sync`/`integration.manage`, cổng đọc `bid.view`. GRN không mang tiền và không vào bảng ấy; ~~`CHECK` lược đồ đóng cộng dây bẫy tập khoá tiền (khuôn spec S4b §2.5 ㊴) trên `erp_receipt_lines`~~ **[S1.9102]** dây bẫy jsonb chỉ có đối tượng ở cột jsonb — `erp_receipt_lines` và `erp_purchase_request_lines` không có cột nào như thế (B⑦); thay bằng một test lược đồ đọc `information_schema.columns` (khuôn `check-an-ninh-khai.test.ts`) đòi mọi cột `numeric` của bảng S5 ngoài hai bảng ADR-054 là số lượng, cộng bước 14. Thêm hai chỗ: payload job PUSH `outbox_jobs.payload` chỉ mang `{export_id}` — thân dựng lúc gửi dưới `app.org_id` của job, một hàng sổ — và `CHECK outbox_jobs_payload_khong_mang_gia` cùng tập khoá `003:219-225` (B⑩); `bam` KHÔNG vào payload sổ, chỉ ở hàng `erp_po_exports` sau cổng (C⑥) | Một bảng giá không khai là chỗ A3/A4 đứt mà bước 14 không thấy — bài học ADR-054 |
| **(e)** | **SSO/OIDC**: nhà cung cấp danh tính được hỗ trợ ở lượt đầu (đề xuất: mọi IdP OIDC chuẩn, đo trên Microsoft Entra ID và Google Workspace — hai tên miền JWKS khai một lần ở DNS Firewall; IdP tự host của khách là một tên miền theo khách — chi phí hạ tầng gọi tên); luật khớp danh tính (claim email hạ chữ bằng `pg_catalog.lower()` phải TRÙNG `users.email` của tổ chức đã có — KHÔNG tạo người dùng, ADR-111); `sub` ràng một lần vào `user_identities`, không đổi; cấu hình ở `org_sso_configs` ngoài `GRANT` của `app_api`, ghi bởi `tp-khoi-tao`; công tắc theo tổ chức có cờ triển khai mặc định tắt (khuôn ADR-105); link email có tắt được theo tổ chức không khi SSO bật | ADR-020 §2 ⒞ chỉ nói *"Enterprise (S5)"*. Tiền đề B6 ghi cái giá nếu phải làm lại: *"di trú bảng phiên"* — (e) phải nói trước rằng không di trú nào cần, vì phiên vẫn là hàng `sessions` `kind = 'USER'` ra đời sau TOTP |
| **(f)** | **Tập đơn vị tiền tệ**: danh sách ISO 4217 được nhận (GIẢ ĐỊNH ở Q5); ~~một migration nới `CHECK` ở `014` (`org_procurement_policies.currency`, `rfq_budgets.currency`), `057` (`rfq_evaluations.currency`), hàm `bid_currency` (`070`) và ô chọn — bốn bản chép mà `tests/architecture/tien-te-mot-cho-doc.test.ts` và test đọc tệp của ADR-103 khoá nhau~~ **[S1.9102]** liệt kê vét cạn (A⑤): chín `CHECK` có tên riêng — `014`×2, `057`, `103`×2, `104`, `109`×2, `110` —, hằng `CURRENCIES` (`packages/rfq/src/procurement-policy.ts:30`), hai `RETURN` của `bid_currency` (`070`), ô chọn `/nop-thau` và `/chinh-sach`; `tien-te-dong-bo.test.ts` mở rộng quét MỌI `db/migrations/*.sql` thay vì chỉ `057`; `tien-te-mot-cho-doc.test.ts` là INV-J8, không phải cổng của tập. Và nói thẳng giới hạn ở tổ chức đã bật S3 (C⑩, Q5 ⒜′); bí danh cho đơn vị mới (`€`, `¥`…) có hay không — đề xuất KHÔNG, chỉ mã ba chữ | Nới ở ba `CHECK` đã áp là một migration có bán kính nổ; làm thiếu một chỗ là một 422 không tên trở lại (ADR-103 ⒜) |
| **(g)** | **PUSH ra ERP (webhook)** — chỉ khi Q2 ⒞: tên miền ERP của khách là một biến hạ tầng theo khách trong danh sách DNS Firewall (ADR-076 ⑷ `che_do_dns`); job outbox `kind = 'ERP_WEBHOOK_SEND'` (migration `ALTER POLICY` theo ADR-134); thân ký HMAC bằng khoá theo kết nối ở Secrets Manager (ADR-069 ⑶); gửi SAU COMMIT; thử lại có trần (GIẢ ĐỊNH 5 lần, giãn cách nhân đôi) với khoá idempotent = id lô xuất + băm nội dung; không đi theo 3xx; không đọc thân phản hồi ngoài một mã ACK. **[S1.9102]** BA policy, không hai: `095` (`outbox_jobs_kind_app_api`, UPDATE) + `099` (`outbox_jobs_kind_xep_app_api`, INSERT — ADR-138) + union `KindOutbox` (`packages/outbox/src/enqueue.ts`) và cổng `kind-outbox-mot-cho.test.ts`; quên `099` thì `enqueueJob` NÉM 42501 ngay trong giao dịch nghiệp vụ (A⑦, B⑪). PUSH mang bất biến riêng **M11** — một hạng mục không bất biến là một hạng mục không phép đo (D⑧) | Không có (g) thì không có PUSH — và đó là một trạng thái CHẤP NHẬN ĐƯỢC. Có (g) thì `api` có một đích ra ngoài theo từng khách, tức bề mặt SSRF và bề mặt tuồn dữ liệu mà ADR-069 *Hệ quả* đã gọi tên |

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
| ⑽ | Nhà cung cấp nhập từ ERP | Là hồ sơ Level 0/1 CHƯA xác minh; người nhập là `created_by`; MST, email, điện thoại chịu đúng `CHECK` của `008`, `048`/`049`, ~~`132`, `139`~~ **[S1.9102]** `092` (ADR-132), `100` (ADR-139) — hai số kia là số ADR (A⑫) — dòng không qua thì cả lô không vào | ADR-013, ADR-152, ADR-132, ADR-139 |
| ⑾ | Mã vật tư ERP | Là một BÍ DANH của hàng chuẩn (S4.2a), do người giữ `item.manage` khai hoặc duyệt; không bảng ánh xạ riêng | spec S4 §4.3–§4.4; L2, L3 |
| ⑿ | Tiền tệ trong bảng S5 | Mọi cột tiền của S5 kèm cột tiền tệ thuộc tập đóng; không mã S5 nào quy đổi; hoá đơn khác tiền tệ với award ⇒ nhãn `LECH_TIEN_TE` ở đối chiếu, không con số | ADR-103; ADR-082 ⑽ |
| ⒀ | Một chứng chỉ một bề mặt | Chứng chỉ `INTEGRATION` không gọi được route ~~`agent: true`~~ **[S1.9102]** CHỈ khai `agent: true` và ngược lại; route khai CẢ HAI là ngoại lệ được liệt kê — hôm nay `GET /me` (`apps/api/src/routes/buyer.ts:236-241`), thứ ADR-039 lớp ⑸ cần máy khách gọi lúc khởi động (A⑪); bảng công cụ của `apps/mcp` không đổi | ADR-039 |
| ⒁ | Bước 14 | Kịch bản 41 ~~(bản HTTP)~~ **[S1.9102]** CẢ HAI bản (gói và HTTP), chỗ cắm SAU bước 12i (award) và TRƯỚC 13–14 — bước 14 không còn *"sau tất cả"* từ khi có bước 16, 17 (D⑨) — thêm bước xuất PO, kéo bằng chứng chỉ máy, nhập GRN và hoá đơn ~~có kim riêng~~ **[S1.9102]** — hoá đơn có kim riêng; bản xuất KHÔNG: đơn giá của bản xuất BẰNG đơn giá bản rõ (M7), nên hai `toEqual` vét cạn của bước 14 ở cả hai bản nới thêm `erp_po_export_lines` — một ca LẬT kê tên ở S5.2 (D⑨); bước 14 quét mọi bảng S5, kết quả `toEqual` vét cạn với danh sách ADR-054 đã nới | ADR-054; spec S4 §2.5 ⒅ |
| ⒂ | Nhãn trên màn | *Quality*, *Delivery* hiện là *"theo GRN của ERP (n dòng, từ ngày … )"*; đối chiếu TCO hiện *"lời khai … / thực tế theo ERP …"*. Không chữ *tự động*, không chữ *đồng bộ* ở nơi lớp thật là một lô người bấm | PRODUCT §5; spec S4 §2.5 ㉔ |

### 2.6. [S1.9102] Những chỗ lượt soi chốt từ tiền lệ đo được

Khuôn ADR-050 / ADR-099: chỗ nào tiền lệ trong kho — hay một phép đo trên lược đồ thật — trả lời được thì lượt soi chốt và ghi
tiền lệ; chỗ nào là lựa chọn sản phẩm thì sang §2.7. Đánh số tiếp §2.5. *Phép đo* ghi là **đo M1…M9** (số của biên bản
`evidence/security-reviews.md` §S1.9102 mục 5); *bất biến* ghi là **M1…M14** không kèm chữ *đo*. Mọi chốt dưới đây đứng
vững dù Q11–Q13 chọn lối nào, trừ chỗ ghi *"theo Q…"*.

| # | Chỗ | Chốt | Tiền lệ / phép đo | Góc |
|---|---|---|---|---|
| ⒃ | Đường phát chứng chỉ máy | Một `BuyerWriteRoute` mang `permission: 'integration.manage'`, `integration: false`, `agent: false`; hàm phát là hàm MỚI của `packages/identity` — phát phiên cho người KHÁC người gọi, TOTP tươi của người gọi kiểm ở handler bằng `assertFreshMfa`; KHÔNG khuôn `/auth/agent-session` (route `self` không mang mã quyền, chỉ ở `/auth/*`; `startAgentSession` ném khi `mfaProof.userId !== input.userId`). `039` KHÔNG nới dù Q11 chọn lối nào — ADR-039 §3 đã bác | `route-types.ts:353`, `:526`; `login.ts:510`; `DECISIONS.md:4524` | A① · C④ |
| ⒄ | Trường `integration` | Bắt buộc trên CẢ BA kiểu route người mua, kể cả `BuyerWriteRoute` (khuôn `agent` chỉ nằm trên route đọc và tự thân, `agentGoiDuoc` đóng vô điều kiện với route ghi); một vị từ `integrationGoiDuoc`: route đọc/tự thân khai `integration: true` ⇒ qua; route ghi ⇒ qua khi và chỉ khi `integration: true` **và** `permission === 'erp.sync'`; lớp canh *"vắng ở mọi nơi khác"* (khoản 141) viết lại cho trường mới; test hình dạng route đỏ khi thiếu | `route-types.ts:421-427`, `:516-522`; ADR-039 ⑶ | A⑥ |
| ⒅ | Sổ của chứng chỉ máy | `actor_type = 'USER'`, `actor_id` = người đại diện (hay người phát, theo Q11), **`kind` của phiên trong payload mọi hàng sổ của route `integration: true`** — một hàm `payloadPhien(actor)` duy nhất, `routes.test.ts` canh; không nới `SessionActor.type` (ADR-039 ⑵ cố ý giữ literal `"USER"`, 28 chỗ rót vào `actorType`); bộ bằng chứng và sổ xuất S5.8 đọc `kind` để kể *máy kéo*, không *người đọc* | `session-actor.ts:66`; `dispatch.ts:846`; `DECISIONS.md:4480` | A⑨ · C⑨ · L6 |
| ⒆ | Thu hồi, trần, TTL | Route thu hồi chứng chỉ dưới `integration.manage`, `integration: false`, một hàng sổ — **route ĐẦU TIÊN trong kho thu hồi phiên của người khác** (hôm nay chỉ đăng xuất tự thân `auth.ts:230-242`; `034` thu hồi theo `users.status` mà không route nào đổi `status`); *"rút mọi lô do chứng chỉ X ghi từ mốc T"* là MỘT hàng rút theo lô có lý do, không UPDATE; TTL trần đi theo một phép đo như `051:45-52`, không một con số tròn (90 ngày ở §4.1 là GIẢ ĐỊNH chờ đo); trần đọc theo phiên cho `kind = 'INTEGRATION'` khuôn `AGENT_DOC_TRAN_MOI_CUA_SO` (`dispatch.ts:152`), 429 TRƯỚC hàng sổ — vì mỗi lần kéo là một lần giữ khoá chuỗi sổ của cả tổ chức (`050`, 2 s) | `051:45-52`; `dispatch.ts:141-152`, `:874-880`; ADR-102 | C⑤ · C⑫ |
| ⒇ | Trigger NGƯỜI của `integration.manage` | Tắt mặc định: chỉ áp khi tổ chức có hàng `org_integrations` (hay khi vai của Q12 được gán) — vì `FINANCE+PROCUREMENT_MANAGER` là một trong ĐÚNG BA cặp phủ chuỗi hợp lệ hôm nay (`005:201`), và một migration cấm cặp ấy đổ ở tổ chức đang có người ấy; `ma-tran-quyen.test.ts` là ca lật kê tên ở S5.1 | `005:201`; ADR-093 ⑷; §2.4 *"không khai gì chạy đúng hành vi hôm nay"* | D⑫ |
| ㉑ | Chỗ cắm bản xuất trong `duyetTraoThau` | Hàng `SAN_SANG` tối giản (`award_id`, `rfq_id`, `phien_ban_hinh_dang`, cột chụp do trigger) chèn SAU câu `INSERT … 'APPROVED'` — tức SAU hàng sổ `RFQ_AWARD_SIGNED` (`trao-thau.ts:631-634` đứng trước `:655`): không có điểm nào *"sau `APPROVED` và trước mọi hàng sổ"*, và ~~ADR-154 ⑹~~ nói về *hai PR*, không về thứ tự. Hệ quả chốt: lỗi của móc là NÉM trong CÙNG giao dịch ⇒ lần duyệt không đi — **fail-closed**, không `throwAuditedDenial` ở giao dịch độc lập (tự khoá, `DenialAuditFailedError`, `trao-thau.ts:621-623`) —, và vì thế móc chỉ được NÉM ở trạng thái KHÔNG THỂ (award không `APPROVED`, bản rõ của báo giá thắng không đọc được, tiền tệ NULL); dữ liệu VẮNG (không lời khai TCO cam kết, dòng không ánh xạ) KHÔNG là lỗi — tài liệu ghi vắng — để tổ chức MVP1 không đổi hành vi ở cạnh duyệt (ADR-093 ⑷); cái giá nói ra ở §8.14. Móc nối ở composition root của `api` và của bản gói kịch bản 41; test kiến trúc *"`duyetTraoThau` có đúng một móc; bản gói nối nó"* | `trao-thau.ts:616-668`; `DECISIONS.md:12103`; ADR-154 *Quyết định* | A③ · B③ · L2 · D⑦ |
| ㉒ | `bam` và nguồn của tài liệu | Không bảng SỬA ĐƯỢC nào trong hàm: `suppliers`, `supplier_contacts` có `GRANT UPDATE` (`008:98`, `:173`) nên *"hàm thuần của hồ sơ nhà cung cấp"* không tái lập. Hàng `SAN_SANG` mang CỘT CHỤP do trigger BEFORE INSERT chép (tên pháp lý, MST của nhà cung cấp thắng; `bid_version_id`; `phien_ban_hinh_dang`) — ngoài `GRANT INSERT` của `app_api` (khuôn `082:72`, `011:41-43`, `113:492`); `bam` = `sha256` của một CHUỖI CHUẨN HOÁ (dòng theo `line_no`, số in như Postgres in `numeric`, cột chụp, tiền tệ) dựng từ `NEW.*` ∪ `bid_dong_tho(payload)` của báo giá thắng (`rfq_unsealed_bids`, chỉ-ghi-thêm; `app_api` có `SELECT` `019:459` và `EXECUTE` `096:411`) ∪ ánh xạ hàng chuẩn hiệu lực tại lúc chèn — do hàm SQL tính ở hàng `SAN_SANG`, chép sang mọi hàng trạng thái sau; `erp_po_export_lines` do trigger AFTER INSERT chép từ cùng nguồn, ngoài `GRANT INSERT`. Lõi TS của `packages/tich-hop` tái lập ĐÚNG chuỗi ấy; một test J2 so khớp hai bản — M7 là cặp *hàm thuần + bản cài độc lập* | `TEST-PLAN.md:126` (J2); `082:72`; `019:459`; `096:411` | B② · A⑩ |
| ㉓ | Khoá của bảng trạng thái | Trigger BEFORE INSERT của MỌI hàng `erp_po_exports` lấy `pg_advisory_xact_lock(hashtextextended(rfq_id::text, 1))` — ĐÚNG khoá của `061:535` — trước khi đọc hàng mới nhất; cùng khoá với huỷ award và `THU_HOI`. Đo M5: không khoá, hai ACK song song dưới READ COMMITTED cùng COMMIT (2 hàng `DA_ACK`); có khoá, phiên hai bị từ chối (1 hàng). `erp_po_exports` mang `rfq_id`, khoá ngoại hợp thành `(org_id, rfq_id, award_id)` | `061:520-544`; đo M5 | B④ · L8 |
| ㉔ | Luật ACK và ngày nhận | ACK chỉ từ `DA_KEO`/`DA_TAI` (ACK một lô `SAN_SANG` chưa ai kéo ⇒ từ chối có tên); ĐÚNG MỘT hàng `DA_ACK` mỗi lô — đổi số PO của ERP là một hàng rút kèm lý do rồi ACK lại; `ngay_nhan ≤ clock_timestamp()` ở trigger (khuôn `NGAY_MUA_SAU_HOM_NAY`, ADR-149 ⑷) bên cạnh `ngay_nhan ≥ ngày APPROVED`; ba ca vào T1 và T3 | ADR-149 ⑷ (`DECISIONS.md:11656-11720`) | C⑧ |
| ㉕ | Chiều của *"mọi `APPROVED` có bản xuất"* | Hai vế tách: ⒜ BEFORE INSERT `erp_po_exports`: hàng mới nhất của award là `APPROVED`, và *"cùng giao dịch"* kiểm bằng `ghi_luc = transaction_timestamp()` so với `acted_at` của hàng award — KHÔNG `xmin` (§S1.161 M6 đo: `xmin` từ chối nhầm khi hàng nằm trong một `SAVEPOINT`; ADR-099 ㉛); ⒝ `CREATE CONSTRAINT TRIGGER … AFTER INSERT ON rfq_awards DEFERRABLE INITIALLY DEFERRED` khi `status = 'APPROVED'` đòi một hàng `SAN_SANG` tại COMMIT — chiều NGƯỢC mà bản nháp gọi nhầm là *"khuôn ADR-123"*; constraint trigger chỉ có AFTER, vào mục riêng của hardening và `TRIGGER_DUOC_PHEP` | `017:185-188`; `hardening:1686-1687`; ADR-099 ㉛ | B⑤ |
| ㉖ | `bam` là một đường đưa giá ra | `bam` không muối, hình dạng `v1` công khai, mô tả và số lượng của gói thì mọi người mua thấy ⇒ ai cầm `bam` quét được đơn giá (10⁵–10⁷ ứng viên) mà không qua `bid.view`, không hàng `COMPARISON_VIEWED`. Chốt: payload hàng sổ chỉ mang `export_id` (đủ nối), KHÔNG `bam`; `bam` chỉ ở hàng `erp_po_exports` sau cổng `bid.view`/`erp.sync`; ADR (d) khai `bam` là một đường đưa giá ra theo câu [S1.157] của ADR-054; sổ xuất S5.8 dưới `audit.read` (vai `AUDITOR` không giữ `bid.view`) vì thế không mang `bam`. Payload job PUSH = `{export_id}`, thân dựng lúc gửi; `CHECK outbox_jobs_payload_khong_mang_gia` cùng tập khoá `003:219-225` — chỗ DUY NHẤT dây bẫy jsonb của S5 có đối tượng | ADR-054 [S1.157] (`DECISIONS.md:5686-5790`); ADR-144 ⑸; `007:387` | C⑥ · B⑩ |
| ㉗ | *"`CHECK` lược đồ đóng + dây bẫy"* trên bảng không jsonb | Khuôn ㊴ (spec S4b) và `003` là `jsonb_path_exists` trên MỘT cột jsonb; `erp_receipt_lines`, `erp_purchase_request_lines` chỉ có cột thường — không có gì để bẫy, và `CHECK` không chặn `ALTER TABLE`. Thay bằng hai cổng đúng tầng: test lược đồ đọc `information_schema.columns` đòi mọi cột `numeric` của bảng S5 ngoài hai bảng ADR-054 nằm trong tập {`so_luong*`} (khuôn `check-an-ninh-khai.test.ts`), cộng bước 14 `toEqual` vét cạn | `003:219-220`; `kich-ban-41-http.int.test.ts:2236` | B⑦ |
| ㉘ | Idempotent của lô nhận | `erp_import_batches.khoa_idempotent` + `UNIQUE (org_id, loai, khoa_idempotent)` (NULL cho lô dán tay); `UNIQUE (org_id, export_id, line_no, ma_grn)` trên `erp_receipt_lines`, `(org_id, export_id, line_no, so_hoa_don)` trên `erp_invoice_lines`; lần gửi lại trúng khoá trả CÙNG id lô (không 409) — ERP gửi lại sau timeout là ca thường, không là tấn công; khuôn chỉ mục dedupe của outbox | `007:419` | B⑨ |
| ㉙ | Ghi danh TOTP và ràng `sub` dưới SSO | Ghi danh TOTP lần đầu và sau đặt lại (`040`) KHÔNG đi qua SSO — đi link email (kênh thứ hai) hay một người thứ hai xác nhận (khuôn `040`); lần ràng `sub` đầu đòi link email; M8 thêm vế *"ràng `sub` và ghi danh TOTP không cùng một lần đăng nhập SSO"*; §8.4 sửa — vì hôm nay `/auth/redeem` ghi danh TOTP cho người chưa có hồ sơ (`auth.ts:149-160`, `login.ts:372-384`) và `039` chỉ hỏi *"có TOTP đúng gần đây của chính người ấy"*: một quản trị IdP chiếm được mọi người CHƯA ghi danh, kể cả người duyệt mới | `auth.ts:149-160`; `039:40-51`; ADR-040 | C③ |
| ㉚ | Khoá của `user_identities` và các mã ngoài | `UNIQUE (org_id, issuer, sub)`, `UNIQUE (org_id, user_id, issuer)` — KHÔNG `UNIQUE (issuer, sub)` toàn cục (oracle ADR-013: tổ chức A dò `sub` của B qua 23505, đúng `users_pkey` mà `002:149-155` đã đóng; một người thuộc hai tổ chức dưới `accounts.google.com` là ca HỢP LỆ); `id`, `rang_luc` ngoài `GRANT INSERT`; `app_api` có `GRANT SELECT, INSERT` theo cột (không `UPDATE`/`DELETE`) — bản nháp vừa đặt bảng *"ngoài `GRANT` trừ `SELECT`"* vừa cho `app_api` chèn lần ràng đầu, hai vế loại trừ nhau; trigger `ENABLE ALWAYS` chặn hàng thứ hai; `org_sso_configs` ngoài `GRANT` trừ `SELECT`. Cùng câu cho `so_po_erp`, `ma_grn`, `so_hoa_don`: chỉ `UNIQUE` có tiền tố `org_id` | `002:149-155`; `061:319-320`; ADR-013 | B⑧ · A⑬ |
| ㉛ | `app_api` còn chèn được người và vai | Đo M3, M4a, M4b, M8, M9 trên lược đồ thật: `app_api` có `INSERT (org_id, email, full_name, status) ON users` (`002:173`), `INSERT (org_id, user_id, role_code) ON user_roles` (`005:476`), `DELETE ON user_roles` (`005:480`); chèn người + gán `FINANCE` ĐI QUA; xoá vai của một `DIRECTOR` đi qua (1 hàng); không đường sản xuất nào dùng (ADR-111 dời việc tạo người sang `app_khoi_tao`, `075:41`); đường ghi danh TOTP cho người chưa có hồ sơ (`auth.ts:149-167`) ⇒ một `app_api` bị chiếm dựng được người `FINANCE` có MFA. Đây là LỖ của mã đang chạy, không của spec: **khoản 9401** (MỞ, rổ đề xuất B) — `REVOKE INSERT ON users`, `REVOKE INSERT, DELETE ON user_roles FROM app_api`, census `rls-coverage` và dòng ADR-111 nói ngược (`DECISIONS.md:3291`). M8 nhận câu ấy làm lớp CSDL; S5.5 không mở trước khi khoản ấy đóng | `002:173`; `005:476-480`; `075:41`; đo M3, M4a, M4b, M8, M9 | B⑥ · L4 |
| ㉜ | Tiền tệ — tập và giới hạn | Tập `('VND','USD')` ở CHÍN `CHECK` có tên riêng (`014:62`, `:113`; `057:83`; `103:98`, `:180`; `104:95`; `109:65`, `:105`; `110:43`), hằng `CURRENCIES` (`procurement-policy.ts:30`), hai `RETURN` của `bid_currency` (`070`), ô chọn `/nop-thau` và `/chinh-sach`; `tien-te-dong-bo.test.ts` chỉ khoá bốn — mở rộng quét MỌI `db/migrations/*.sql`; `tien-te-mot-cho-doc.test.ts` là INV-J8 (phép ĐỌC), không là cổng của tập. Ở tổ chức đã bật S3: `org_procurement_policies.currency` một tiền tệ mỗi phiên bản, `award_chot_bac` trả `K7_LECH_TIEN_TE` (`113:371-376`) ⇒ nới tập không cho tổ chức ấy mua ngoại tệ — Q5 đổi câu hỏi | ADR-103; `113:371-376` | A⑤ · C⑩ |
| ㉝ | Tập mã thành phần TCO | Không ở `112` (tệp ấy cố ý không `CHECK` liệt kê mã — spec S4 §2.5 ⒃); nguồn là `MA_CO_NGUON` ở `packages/danh-gia/src/tco.ts:26-33`. `CHECK` trên `erp_invoice_lines.ma_thanh_phan` là bản chép SQL ĐẦU TIÊN của tập ấy ⇒ kèm một test đọc tệp khoá `CHECK` với `MA_CO_NGUON` (khuôn `tien-te-dong-bo.test.ts`); §4.3, §4.4 trỏ về `tco.ts` | `112:11`; `tco.ts:14`, `:26-33` | A⑧ |
| ㉞ | `kind` outbox mới | Hai `ALTER POLICY` — `095` `outbox_jobs_kind_app_api` (UPDATE) và `099` `outbox_jobs_kind_xep_app_api` (INSERT, ADR-138) — cộng union `KindOutbox` (`enqueue.ts`), hai dòng `POLICY_RESTRICTIVE_KHAI` + gương `rls-coverage`, cổng `kind-outbox-mot-cho.test.ts`, `composition.int.test`; policy `app_unseal` của `095` không đổi. Quên `099` thì `enqueueJob('ERP_WEBHOOK_SEND')` NÉM 42501 trong giao dịch nghiệp vụ — không *"job nằm `PENDING` im lặng"* | `095:35-41`; `099:29-36`; `hardening:2983-2987` | A⑦ · B⑪ · L5 |
| ㉟ | Khuôn `033` cho ba luật vai/người | Ba hàm MỚI khuôn `033`/`083` (không chạm thân đã ghim), ghim cùng commit, bản TypeScript khoá nguyên văn qua meta-test khuôn `POLICY_MANAGE_EXCLUDES` (`packages/identity/src/permissions.ts`); vế *"mã chỉ ở MỘT vai đích danh"* (`erp.sync` ↔ `INTEGRATION`) là hình dạng mới (`IF NEW.permission_code = 'erp.sync' AND NEW.role_code <> 'INTEGRATION'`). **CHƯA ĐO**, ghi là việc của S5.1: vế người của `033` đọc `user_roles` dưới RLS của phiên ghi, hàng `user_roles` của người đại diện do `app_khoi_tao` (NOBYPASSRLS, `075:19`) chèn — `tp-khoi-tao` phải `SET app.org_id` trước câu chèn vai, và phép đo *"không `SET` thì trigger mù"* vào T3 của S5.1 | `033:30-31`, `:48-52`; `075:19`, `:48` | B⑫ |
| ㊱ | Cổng ghim sẽ đỏ — tên thật | `sessions_kind_hop_le` không là `CHECK` MỚI mà là `CHECK` ĐỔI ĐỊNH NGHĨA: dòng ở `CHECK_AN_NINH_KHAI` (`hardening:3079`) đổi cả `mig` (migration cuối nhắc tên) lẫn deparse; `sessions_integration_ttl` vào danh sách chính (cùng hạng `sessions_agent_ttl_ngan`). ~~`MIEN_TRU`~~ không có cho `CHECK` (chỉ là bản đồ miễn trừ biên giới GÓI ở `bien-gioi-goi.test.ts:75`); `SAN_SO_TRIGGER` là sàn 85 của `db/ghim-trigger-tu-chua.int.test.ts:65` — mỗi trigger mới nâng sàn ấy | `hardening:3032`, `:3079`; `ghim-trigger-tu-chua.int.test.ts:65` | B⑭ · A⑭ |
| ㊲ | Giá trong Ô MÔ TẢ | *"Không cột tiền"* là lớp theo CỘT: một PR hay một dòng dán mang *"dự toán 15.500.000 đ/tấn"* trong `mo_ta` đi tới `rfq_items.description` ⇒ `GET /guest/rfq` trả cho mọi nhà cung cấp (`guest.ts:77`, `:120-122`) — ngân sách lộ trước hạn (A4). Chốt: nói ra lớp là theo cột; một NHÃN cảnh báo (không chặn) khi mô tả khớp mẫu tiền tệ; màn *Tạo gói từ yêu cầu ERP* và khối dán nói thẳng mô tả sẽ hiện cho nhà cung cấp; T5 thêm ca | `guest.ts:77`, `:120-122`; `TEST-PLAN.md:46` | C⑦ |
| ㊳ | Nội dung tài liệu `v1` | ADR (d) khai danh sách trường ĐÓNG của `v1`: không dữ liệu cá nhân người liên hệ (ERP là chủ vendor master — §10; ADR-038 §2 rút `/suppliers/:id/contacts` khỏi bề mặt máy vì đúng lý do ấy), không `tco_ma_ghim`/`policy_id`; *"điều khoản cam kết"* = lời khai TCO của báo giá thắng, mã và trị; bản tải cho NGƯỜI (Q2 ⒜) chịu cùng danh sách trường — M1 áp cho nội dung, chỉ khác cổng | `DECISIONS.md:4349-4459`; `111:26-50` | C⑬ |
| ㊴ | Tác giả `diem_ncc` | `policy.manage` ở `FINANCE` — vai cũng giữ `award.recommend`, `po.approve`, `bid.view`; `033` chỉ loại `rfq.create`, `rfq.approve`. Chốt theo tiền lệ `113`: tác giả phiên bản chính sách ghim bị loại khỏi NGƯỜI KÝ award chụp phiên bản ấy (`K7_TAC_GIA_CHINH_SACH`, `113:43-44`) — áp nguyên cho phiên bản mang `diem_ncc`; KHÔNG loại khỏi người đề xuất (113 không làm, và bản chụp Q8 ghim `policy_id` nên bộ bằng chứng kể đúng ai đặt thước). Nói ra ở §8.3 | `113:43-44`; `033:48-57` | C⑪ |
| ㊵ | Hình dạng S5.0 | Câu đậm §3.1 sửa: *ERP* không ghi vào bảng S1–S4; *người dán* của S5.0 ghi `rfq_items` (ở `DRAFT`, `011:341-345`), `suppliers`, `supplier_contacts` qua ĐÚNG đường gói của S1 — không bảng nhận, không `erp_import_batches` ở S5.0 (`NCC`, `HANG_MUC` của `loai` chỉ cho lô S5.1 trở đi); hai hàng sổ của S5.0 là hàng sổ thường, payload: số dòng, `rfq_id`/số hồ sơ — không tên người liên hệ. Bỏ cột *mã vật tư ERP* khỏi lô dán hạng mục (`rfq_items` không có cột đậu, `chuanHoaGoi` chỉ chạy cho gói đã rời `DRAFT`, bí danh là của `item.manage`) — nó về lô `HANG_MUC` của S5.1. `docCsvNgoai` kiểu đóng cho hai hình dạng giá ngoài (`csv-ngoai.ts:19`, `:217`): S5.0 tách lõi tách dòng/tiêu đề thành hàm nhận một bảng cột, bốn hình dạng cùng gọi — **ca lật kê tên: `csv-ngoai.test.ts` phần tên kiểu** | `009:113-114`; `008:98`; `011:341-345`; `anh-xa.ts:5`; `csv-ngoai.ts:19`, `:217` | A④ · D④ · D⑤ |
| ㊶ | K2 và người nhập sổ ở S5.0 | K2 (`107:118-137`) không đếm hồ sơ do *người chọn danh sách* dựng; `supplier.manage` chỉ ở PM, vai cũng giữ `rfq.create` + `rfq.invite` ⇒ cả sổ nhập về vô dụng cho cạnh tranh tối thiểu ở tổ chức đã bật S3 khi chính người ấy mời; `nha-cung-cap-dem-duoc.ts:1-17` đã dựng *người nhập RIÊNG* vai `TECHNICAL` vì đúng lý do ấy. Người nhập theo Q12; dù Q12 chọn lối nào: màn cảnh báo khi người dán giữ `rfq.invite`/`rfq.create`, câu nghiệm thu S5.0 thêm vế *"hồ sơ nhập ở tổ chức đã bật S3 vẫn đếm được cho K2 khi người khác mời"* | `107:118-137`; `005:297-304`; `test-support/src/nha-cung-cap-dem-duoc.ts:1-17` | D⑥ · L3 |
| ㊷ | Lịch vào sổ của nhóm M | M1 ở S5.1 chỉ đo được vế âm (mọi route ngoài tập đóng ⇒ 403) — vế dương *"award `APPROVED` ⇒ đọc được bản xuất"* cần `erp_po_exports` của S5.2 ⇒ tách: **M1** (vế âm, S5.1) và **M12** (vế dương + *mọi báo giá ĐÃ TỪNG được trao*, S5.2); **M9** chia ba: M9 (PR, phiên — S5.1), **M13** (bản xuất — S5.2), **M14** (GRN, hoá đơn — S5.3); M6 đổi phép đo: *"giết ERP"* đo một thế giới mà cạnh không thể phụ thuộc (xanh rỗng), thay bằng ĐỘT BIẾN ERP giả lập trả lỗi / băm lệch / không trả lời / dữ liệu lạ ở TỪNG route S5 với mọi khẳng định cạnh của kịch bản 41 xanh — vế GRN sang S5.3; M4 nhận idempotent (㉘); M5 cưỡng chế bằng test lược đồ (㉗); M3 nhận ca thu hồi rồi gọi và ca quá TTL; M8 nhận ㉙ và ㉛; số mới không hậu tố (khoản 246); mỗi hàng vào `docs/TEST-PLAN.md` ở hạng mục ĐO được nó | spec S4 §2.5 ⒅ (*xanh vì phạm vi*); khoản 246 | D① · D⑦ · D⑪ |
| ㊸ | Kiểm thử | Bộ quét rò rỉ chọn cookie theo audience (`kich-ban-41-http.int.test.ts:1217`) — *"chạy thêm một lượt dưới chứng chỉ máy"* là một VÒNG LẶP MỚI với kỳ vọng ngược (403 có sổ ngoài tập đóng, đối chứng dương trong tập), khuôn chưa có cả cho agent (`auth.int.test.ts:1695` chỉ bảy route cho qua); không có *"kim đơn giá xuất"* — đơn giá bản xuất BẰNG đơn giá bản rõ (M7) ⇒ hai `toEqual` vét cạn của bước 14 ở CẢ HAI bản (`:2235`, `:2246`; `kich-ban-41.int.test.ts:762`) nới `erp_po_export_lines` — ca lật kê tên ở S5.2; kim hoá đơn (S5.3) là kim riêng; T5 thêm ⑾ *thu hồi rồi gọi ⇒ 401 có sổ; quá TTL ⇒ `CHECK` ném* và ⑿ *`exp` quá, `aud` lệch, chữ ký sai*; S5.0 nhận một dòng T3 riêng (trùng MST, cột tiền, `009` ở `DRAFT`, hàng sổ không tên người liên hệ) và vào danh sách `security-reviewer` cùng S5.3; `gieo:demo` gieo ≥ 5 gói đã mở cho một nhà cung cấp để Supplier Score có đối chứng dương (hôm nay BA gói, `goi-da-mo.ts:2`); S5.5 cần một IdP giả lập OIDC trong `tools/` cho T4, tên miền khai ở DNS Firewall | `kich-ban-41-http.int.test.ts:1217`, `:2235-2246`; `goi-da-mo.ts:2` | D⑨ · D⑩ · D⑪ |
| ㊹ | Phạm vi, thứ tự, số đếm | Cột *Chờ*: S5.0 ↔ S4.7b (cùng `tao-thau.js`), S5.2 ↔ S3.5b (khối award ở `/mo-thau`) — §9.2; cổng bậc 2 chỉ mở VÒNG MÃ, dữ liệu ERP thật và T4 trên cụm thật sau mảnh 3 kèm quyết định ADR-062 có tên và ngày (§2.4 (a)); nới dải `[A-HJ-L]`→`[A-HJ-M]` là **19 dòng trong 9 tệp `.ts`** (đếm `grep -rn "A-HJ-L" --include=*.ts`: `tools/inv-matrix` ×4, `so-no-tu-doi-chieu.test.ts`, `nhan-bat-bien-cho-dat.test.ts`, `nhan-bat-bien.test.ts`, `luot-danh-gia.int.test.ts`, chú thích kịch bản 41) + ca biên *"`M` thì không"* (`parse.test.ts:140`) LẬT + một hàng mẫu M vào `TEST_PLAN_MAU`; `/login` là bí danh của `mo-thau.html` (`phuc-vu.ts:143`), `/nha-cung-cap` hôm nay là màn của `supplier.qualify` (`:128`); `132`/`139` là số ADR (migration `092`, `100`); §1 thiếu S4.8; §12 nói *"nhóm M vào sổ ở S5.0"* trái §5 — tiêu đề nhóm xuất hiện cùng hàng đầu; dòng *PRODUCT §5* (nhãn *không "tự động", "đồng bộ"*) vào S5.2; KPI tiền của §7.1 đọc dưới `bid.view` + một hàng sổ, vế *dấu dữ liệu mẫu* chờ L24 (S4b.0); nhóm F gộp bốn dòng trùng vào E6, B6, C4, D1 (33 → 37 tiền đề; ba chỗ đếm viết tay `STATE.md:1092`, `:4551`, `Handoff.md:493` sửa ở vòng này) | `parse.test.ts:140`; `phuc-vu.ts:128`, `:143`; kế hoạch pilot §7 | D② · D③ · D⑬ · D⑭ |

### 2.7. [S1.9102] Câu còn chờ chủ dự án

**Không câu nào trong mười ba câu được hỏi trong vòng này.** Lượt soi chỉ sửa câu (Q4 thêm vế, Q5 đổi lối, Q6 và Q10 gộp
vào Q12/Q11) và thêm ba câu mới (Q11–Q13); mọi *Đề xuất* ở §2.3 là đề xuất của lượt viết và lượt soi, chưa là quyết định —
khuôn §S1.161 §6 / ADR-100: hỏi trong MỘT lượt sau vòng này, ghi thành một ADR của chủ dự án, hệ quả chép lại vào đúng mục.
Mỗi câu chặn đúng hạng mục ghi ở cột cuối; không câu nào chặn một vòng đang chạy của S3 hay S4.

| # | Câu | Đề xuất của lượt soi | Chặn |
|---|---|---|---|
| Q1 | Phạm vi S5 | ⒝ — ERP + SSO + đa tiền tệ; Reverse Auction là spec riêng sau pilot | S5.5, S5.6 |
| Q2 | Giá trúng thầu đi tới ERP bằng đường nào | ⒜ trước, ⒝ khi khách đầu tiên cần, ⒞ sau ADR (g) | S5.2 (⒝), S5.7 (⒞) |
| Q3 | ERP nào đi đầu; adapter trong kho | Không adapter nào tới khi có khách dùng ERP ấy | — |
| Q4 | SSO thay yếu tố nào | ⒜ thay link email, giữ TOTP — cộng vế ㉙ | S5.5 |
| Q5 | Đa tiền tệ nghĩa là gì | ⒜′ nới tập + nói giới hạn ở tổ chức bật S3 + ô tiền tệ GHIM theo gói | S5.6 |
| Q6 | Ai ghi dữ liệu từ ERP, ai thấy | Máy hoặc người của Q12 ghi; GRN mọi người mua, hoá đơn `bid.view` | S5.3 |
| Q7 | Trọng số Supplier Score | ⒜ không mặc định | S5.4 |
| Q8 | Supplier Score chụp vào đề xuất | Có, bảng riêng theo đề xuất | S5.4 |
| Q9 | Nhập từ tệp đi trước phần còn lại | Có — S5.0 qua ngoại lệ (a) | S5.0 |
| Q10 | Ai cấp chứng chỉ máy và bật SSO | Task `tp-khoi-tao` cho SSO và người đại diện; chứng chỉ máy theo Q11 | S5.1, S5.5 |
| Q11 | Chứng chỉ máy gắn vào ai | ⒜ người đại diện, `mfa_verified_at` NULL hợp lệ cho riêng `kind = 'INTEGRATION'` (thay thân `029`, resolver rẽ `kind`, `039` không chạm) + hai trigger cấm TOTP và phiên `USER` cho vai `INTEGRATION` | S5.1 |
| Q12 | Người của tích hợp là ai | ⒝ `TECHNICAL` nhận `integration.manage` + `supplier.import`, luật người khuôn `083`; hoá đơn và bản xuất chỉ qua máy | S5.0, S5.1 |
| Q13 | Huỷ một award đã xuất | ⒝ nói ra: `THU_HOI` không trả dòng, F11 đọc cờ *đã xuất ERP*, M12 viết *"đã từng được trao"* | S5.2 |

Ba câu Q11–Q13 là chỗ lượt soi ĐỔI hình dạng thiết kế (chứng chỉ, người của tích hợp, huỷ sau xuất); phần còn lại của tài
liệu viết theo ĐỀ XUẤT của chúng và gọi tên chỗ đổi nếu chủ dự án chọn lối khác (§4.1, §4.5, §4.10, §5.1).

---

## 3. Kiến trúc

### 3.1. Thứ S5 TÁI DÙNG, không dựng lại

| Đã có, hoặc sẽ có trước S5 | S5 dùng cho |
|---|---|
| `sessions.kind`, `agentGoiDuoc`, vế 403 có sổ ở `dispatch.ts` (`051`, ADR-039) | Khuôn cho `kind = 'INTEGRATION'` và trường `integration` trên route |
| `POST /auth/agent-session` (`self: true`, TOTP tươi) | ~~Khuôn đường phát chứng chỉ máy~~ **[S1.9102]** KHÔNG là khuôn đường phát (§2.6 ⒃: route `self` không mang mã quyền, `startAgentSession` chỉ phát cho chính người gõ TOTP) — chỉ là tiền lệ cho `assertFreshMfa` ở handler và cho một phiên mang `kind` |
| Trigger vai/người khuôn `033` (vai giữ đúng tập mã; người giữ mã ấy không giữ mã khác) | Vai `INTEGRATION` (`erp.sync`), ràng với `bid.view`, `po.approve`, `award.recommend`, `rfq.create`, `rfq.invite`, `policy.manage`, `item.manage` — **[S1.9102]** ba hàm MỚI theo khuôn, không chạm thân `033`/`083` đã ghim (§2.6 ㉟); trigger mức người tắt mặc định (⒇) |
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
~~và không ghi vào bảng nào của S1–S4 ngoài hàng `rfq_award_supplier_score_snapshots` mới (Q8) và bí danh hàng chuẩn qua đường
của S4.~~** **[S1.9102]** (A④, D⑤ — §2.6 ㊵) câu đậm thứ hai sai với chính S5.0: **ERP và chứng chỉ máy không ghi vào bảng nào
của S1–S4** — chỉ bảng NHẬN của S5 (§2.5 ⑴) và hàng `rfq_award_supplier_score_snapshots` mới (Q8); **người dán của S5.0** ghi
`rfq_items` (chỉ ở `DRAFT`), `suppliers`, `supplier_contacts` qua ĐÚNG đường gói của S1, dưới tên mình, và bí danh hàng chuẩn
đi đường của S4. Một bản cài đặt làm một trong những điều ấy — hay cho máy ghi một bảng S1–S4 — là thiết kế đã trượt.

### 3.2. Thứ S5 thêm

- **`packages/tich-hop`** — lõi thuần: bộ dựng tài liệu PO (`v1`), bộ đọc/kiểm hình dạng lô PR, GRN, hoá đơn, hàm đối chiếu
  TCO, hàm Supplier Score (chuyển từ thiết kế spec S4b §7). Không I/O, không đồng hồ, không ngẫu nhiên. Ranh giới `depcruise`
  (một họ quy tắc mới, H16): không phụ thuộc `sealed-envelope`, `unseal`, `crypto-keys`; `danh-gia` không phụ thuộc
  `tich-hop` (ràng buộc 11 của spec S4b: điểm không đổi hạng).
- **Tầng gói** (trong `tich-hop`): ghi lô nhận, ghi bản xuất trong giao dịch duyệt trao (gọi từ `duyetTraoThau` qua một móc
  SAU khi hàng `APPROVED` chèn ~~và TRƯỚC các hàng sổ — cùng thứ tự ADR-154 ⑹ đo~~ **[S1.9102]** — tức SAU hàng sổ
  `RFQ_AWARD_SIGNED`, không có điểm nào *"trước mọi hàng sổ"* và ADR-154 ⑹ nói về *hai PR* (A③, B③, L2 — §2.6 ㉑); móc nối
  ở composition root của `api` VÀ của bản gói kịch bản 41, một test kiến trúc *"`duyetTraoThau` có đúng một móc; bản gói nối
  nó"*; lỗi của móc NÉM trong cùng giao dịch — fail-closed, §8.14), đọc bản xuất cho người và cho máy, ACK.
- **`apps/api`**: nhóm route `ROUTES_TICH_HOP` với trường `integration` trên MỌI route người mua (bắt buộc, ~~khuôn `agent`~~
  **[S1.9102]** trên CẢ BA kiểu route kể cả `BuyerWriteRoute` — khuôn `agent` chỉ nằm trên route đọc và tự thân, §2.6 ⒄);
  đường phát/thu hồi chứng chỉ máy (**[S1.9102]** hai `BuyerWriteRoute` dưới `integration.manage`, hàm phát MỚI — ⒃, ⒆);
  đường đăng nhập OIDC (callback là route `ANON` có `callerLimit`); handler outbox `ERP_WEBHOOK_SEND` (S5.7).
- **`apps/web`**: màn `/tich-hop`; khối ở `/tao-thau`, `/nha-cung-cap`, `/mo-thau`, `/login`, `/chinh-sach` (§3.5).
- **`tools/erp-gia-lap`**: tiến trình Node đóng vai ERP — kéo bản xuất, ACK, đẩy GRN và hoá đơn theo kịch bản; cắm vào
  `pnpm pilot:gia-lap` như nhà cung cấp giả lập.
- **Migration**: `sessions.kind` nới; ~~hai~~ **[S1.9102]** ba mã quyền (`erp.sync`, `integration.manage`, `supplier.import`
  — Q12) và một vai; bảng §4; ~~`ALTER POLICY` outbox cho `kind` mới (S5.7)~~ **[S1.9102]** hai `ALTER POLICY` (`095`, `099`)
  + union `KindOutbox` (㉞); ~~nới `CHECK` tiền tệ (S5.6)~~ **[S1.9102]** chín `CHECK` tiền tệ + `CURRENCIES` + `070` (㉜);
  **[S1.9102]** theo Q11 ⒜: thay thân `029` cho nhánh `kind` và hai trigger cấm TOTP/phiên `USER` cho vai `INTEGRATION`
  (S5.1); `REVOKE` của khoản 9401 (㉛) — trước S5.5. Mọi trigger và hàm ghim ở `hardening.always.sql` cùng commit.

### 3.3. Cửa thứ hai — quyết định thiết kế lớn nhất của S5

Ba luật, mỗi luật một chỗ cưỡng chế:

1. **Máy đi đúng cửa của người.** Chứng chỉ máy là một hàng `sessions`; mọi route nó gọi là route của `apps/api` đi qua
   `dispatch.ts`, RLS, cổng quyền. Không tiến trình thứ hai, không composition root thứ hai (ADR-038 §1 B, C bị bác).
2. **Tập route của máy là tập ĐÓNG, khai bằng trường `integration: true`, và nó nhỏ.** Đề xuất (GIẢ ĐỊNH về tên đường):

   | Route | Đọc/ghi gì | Không bao giờ |
   |---|---|---|
   | `GET /integrations/erp/exports?since=` | Danh sách lô xuất PO của tổ chức, trạng thái, băm | Award `PROPOSED`, `CANCELLED`; gói chưa `AWARDED` |
   | `GET /integrations/erp/exports/:exportId` | Tài liệu PO `v1`: nhà cung cấp thắng, dòng, đơn giá, tổng, tiền tệ, điều khoản cam kết (**[S1.9102]** = mã và trị lời khai TCO của báo giá thắng; danh sách trường ĐÓNG ở ADR (d) — §2.6 ㊳) | Báo giá thua, bảng so sánh, xếp hạng, benchmark, điểm rủi ro; **[S1.9102]** dữ liệu cá nhân người liên hệ, `tco_ma_ghim`, `policy_id` (㊳); hàng `THU_HOI` không trả dòng (Q13 ⒝) |
   | `POST /integrations/erp/exports/:exportId/ack` | Số PO của ERP + băm đã nhận | — |
   | `POST /integrations/erp/purchase-requests` | Lô PR của ERP → bảng nhận (không tạo gói) | Tạo gói, mời, đặt ngân sách |
   | `POST /integrations/erp/receipts` | Lô GRN theo dòng PO (số lượng nhận, từ chối, ngày) — không tiền | — |
   | `POST /integrations/erp/invoices` | Lô hoá đơn theo dòng PO (số tiền, tiền tệ, ngày) | — |
   | `GET /integrations/erp/items` | Hàng chuẩn đang dùng và bí danh — KHÔNG giá | Lịch sử giá, mốc ngoài |
   | `GET /me` | `kind`, như agent — **[S1.9102]** route DUY NHẤT hôm nay khai cả `agent: true` và `integration: true` (ngoại lệ liệt kê của §2.5 ⒀) | — |

   Mọi route khác trả 403 có sổ cho chứng chỉ máy — kể cả `GET /rfqs/:rfqId`, vì một gói đang `OPEN` mang danh sách hạng mục
   và hạn nộp, và máy không cần chúng. Cổng đối chiếu ở tầng test, khuôn `apps/mcp/src/cong-cu.test.ts`: một route `integration:
   true` mới ngoài danh sách khai ⇒ đỏ.
3. **Giá đi ra là giá ĐÃ TRAO, đúng một báo giá, sau `APPROVED`** — không trước, không hơn. Đây là chỗ S5 khác ADR-038 ⑶, và
   Q2 để chủ dự án chọn có mở nó cho máy hay chỉ cho người. **[S1.9102]** (C①) Câu ấy đúng ở MỖI THỜI ĐIỂM, không đúng theo
   THỜI GIAN: sau một lần huỷ award đã kéo rồi trao lại (ADR-057, cổng của người giữ `po.approve`), ERP — và chứng chỉ máy — giữ
   đơn giá của HAI báo giá cùng gói. Luật viết đúng là *"đơn giá của mọi báo giá ĐÃ TỪNG được trao ở một award `APPROVED` của
   gói"* (M12); cái mất nói ra ở Q13.

Và một luật thứ tư về chiều NGƯỢC: **dữ liệu máy đưa vào chỉ chạm bảng nhận** (§2.5 ⑴). Một GRN không đổi một hạng, một hoá
đơn không đổi một award, một PR không tạo một gói. Người làm những việc ấy, dưới tên mình.

### 3.4. Tính đúng không phụ thuộc ERP

| Sự kiện ở ERP | Hệ quả trong TrustProcure |
|---|---|
| ERP không kéo bản xuất | Lô ở `SAN_SANG`; màn award nói *"chưa chuyển ERP"*. Award vẫn `APPROVED` |
| ERP ACK với băm lệch | Từ chối có tên `M7_BAM_LECH`, vào sổ; lô vẫn `DA_KEO`. Không tự sinh bản xuất mới. **[S1.9102]** ACK cho lô `SAN_SANG` chưa ai kéo, ACK thứ hai cho một lô, GRN có `ngay_nhan` ở tương lai: từ chối có tên (§2.6 ㉔) |
| ERP đẩy GRN trỏ PO không có | Cả lô bị từ chối, lỗi theo dòng; không gì đổi |
| Award bị huỷ sau khi xuất (ADR-057) | Hàng lô mới `THU_HOI` cùng giao dịch huỷ; ERP thấy ở lần kéo sau (PULL) hay một sự kiện (PUSH). **[S1.9102]** Hàng `THU_HOI` không trả dòng; giá đã kéo thì đã công bố ở ERP — Q13 ⒝, M12 |
| ERP chết giữa một lô PUSH | Job outbox thử lại có trần rồi `THAT_BAI` có tên; không cạnh RFQ nào chờ nó |

Phép đo của §6 cho mục này: ~~*giết ERP giả lập giữa kịch bản 41, mọi cạnh của gói vẫn đi, mọi khẳng định cũ xanh nguyên văn*~~
**[S1.9102]** (D⑦ — §2.6 ㊷) *giết ERP* đo một thế giới mà cạnh không thể phụ thuộc — `api` không bao giờ chờ ERP dưới Q2 ⒜/⒝, nên
phép đo ấy xanh rỗng ruột. Phép đo thật là ĐỘT BIẾN ERP giả lập: trả lỗi, trả băm lệch, không trả lời, trả dữ liệu lạ ở TỪNG route
S5 — mọi khẳng định cạnh của kịch bản 41 xanh nguyên văn; vế GRN đo ở S5.3.

### 3.5. Danh mục màn hình

| Màn | Thêm gì | Ai |
|---|---|---|
| `/tich-hop` (mới) | Kết nối của tổ chức (loại, chế độ, phiên bản hình dạng), chứng chỉ máy (phát, thu hồi, hạn), hàng đợi bản xuất và ACK, lô nhận và lỗi theo dòng, nhật ký PUSH | `integration.manage` |
| `/tao-thau` | *Nhập hạng mục từ bảng tính* (dán, ≤ 1000 dòng, chỉ `DRAFT`; **[S1.9102]** không cột mã vật tư ERP — §2.6 ㊵; nhãn cảnh báo khi mô tả mang mẫu tiền và câu *"mô tả sẽ hiện cho nhà cung cấp"* — ㊲; khối dán là một module riêng vì S4.7b cũng sửa `tao-thau.js` — §2.4 (a)); *Tạo gói từ yêu cầu ERP* (danh sách PR đã nhận) | `rfq.create` |
| `/nha-cung-cap` | *Nhập sổ nhà cung cấp từ bảng tính*; cột *nguồn* (`TAY`, `BANG_TINH`, `ERP`); hồ sơ: *Delivery*, *Quality* theo GRN, đối chiếu TCO theo award, Supplier Score kèm thành phần | ~~`supplier.manage`~~ **[S1.9102]** màn hôm nay là của `supplier.qualify` (`apps/web/src/phuc-vu.ts:128` — D⑭); khối dán: người của Q12 (`supplier.import`, đề xuất `TECHNICAL`), kèm cảnh báo khi người dán giữ `rfq.invite`/`rfq.create` (㊶); đọc điểm: `bid.view` |
| `/mo-thau` | Khối award: trạng thái bản xuất, số PO của ERP, nút *Tải PO* (Q2 ⒜) | `bid.view` |
| `/chinh-sach` | Nhóm khoá `diem_ncc` — chỉ thành phần có nguồn ở phiên bản ấy được khai (L9) | `policy.manage` |
| `/login` | Nút *Đăng nhập bằng tài khoản công ty* khi tổ chức bật SSO, rồi bước TOTP như cũ. **[S1.9102]** `/login` không là màn riêng — bí danh của `mo-thau.html` (`phuc-vu.ts:143`, module `dang-nhap.ts`); người chưa ghi danh TOTP đi SSO nhận thông điệp gộp, không bước ghi danh (㉙) | — |

Mỗi hạng mục chạm `/nop-thau` hay `/mo-thau` có một lượt đi thử luồng MVP1 ở khung 375×812 với tổ chức không khai gì của S5
(luật spec S4 §2.3).

---

## 4. Mô hình dữ liệu

Mọi bảng theo tổ chức, khuôn §2.5 ⑶. Tên cột là đề xuất; lượt soi và migration chốt.

### 4.1. Kết nối, chứng chỉ, vai

| Bảng / cột | Giữ gì | Ghi chú |
|---|---|---|
| `org_integrations` | Một hàng mỗi PHIÊN BẢN cấu hình kết nối: `loai` (`CSV_TAY` · `PULL` · `PUSH`), `phien_ban_hinh_dang` (`v1`), `dich_webhook` (chỉ PUSH; tên miền phải nằm trong danh sách hạ tầng — kiểm ở deploy, không ở route), `tac_gia`, `seq`, `ghi_luc` | Chỉ-ghi-thêm; phiên bản mới nhất hiệu lực. Không bí mật nào ở đây |
| `sessions.kind = 'INTEGRATION'` | Chứng chỉ máy | Migration nới `CHECK`; `CHECK` TTL riêng (GIẢ ĐỊNH ≤ 90 ngày — **[S1.9102]** con số đi theo một phép đo như `051:45-52`, §2.6 ⒆); không `GRANT UPDATE (kind)` — như `051`. **[S1.9102]** Theo Q11 ⒜: `mfa_verified_at` NULL là hình dạng hợp lệ của RIÊNG `kind` này — thân `029` thay cho nhánh `kind` (ghim lại), `resolveSessionByToken` rẽ theo `kind`, `039` không chạm; dòng `sessions_kind_hop_le` ở `CHECK_AN_NINH_KHAI` đổi `mig` + deparse, `sessions_integration_ttl` vào danh sách chính (㊱) |
| `users` (hàng đại diện) | Một người dùng đại diện mỗi kết nối, do `tp-khoi-tao` tạo, email kỹ thuật ASCII (~~`132`~~ **[S1.9102]** `092`, ADR-132), vai `INTEGRATION` | ~~Không đăng nhập được bằng link email: không hồ sơ TOTP ⇒ không phiên `USER` nào ra đời (ADR-020 ⑴)~~ **[S1.9102]** (B⑬) câu ấy là TRẠNG THÁI, không bất biến: `app_api` có `INSERT` trên `mfa_credentials` cho mọi `user_id` của tổ chức (`006:385`) và link email ghi danh TOTP lần đầu — ai đọc được hộp thư kỹ thuật cài được TOTP cho người đại diện rồi mở một phiên `USER` giữ `erp.sync`. Theo Q11 ⒜, hai trigger `ENABLE ALWAYS`: `mfa_credentials` BEFORE INSERT từ chối `(org_id, user_id)` giữ vai `INTEGRATION` (đọc `user_roles` dưới RLS, khuôn `083:129-141`); `sessions` BEFORE INSERT từ chối `kind = 'USER'` cho người ấy. Và chính người đại diện không có TOTP là lý do hình dạng phiên của hàng trên phải đổi (đo M2a, M2b) |
| `roles` += `INTEGRATION`; `permissions` += `erp.sync`, `integration.manage`, **[S1.9102]** `supplier.import` | Vai máy giữ đúng `erp.sync`; người cấu hình giữ `integration.manage` ~~(đề xuất gán cho `PROCUREMENT_MANAGER` — vai đã giữ `bid.view` nên không thấy gì mới qua bản xuất, và KHÔNG giữ `po.approve`, nên người đặt kênh ERP không là người duyệt trao)~~ **[S1.9102]** (C②, D⑥, L3 — Q12) PM là *người chọn danh sách* và người đề xuất: GRN trong tay PM là *người đặt thước cầm thứ bị đo* (L3), và hồ sơ PM nhập không đếm được ở K2. Đề xuất Q12 ⒝: `TECHNICAL` nhận `integration.manage` + `supplier.import` (vai chỉ giữ `evaluation.perform`, chính vai test-support dùng làm người nhập); hoá đơn và bản xuất chỉ đi qua MÁY | Trigger khuôn `033` (**[S1.9102]** ba hàm MỚI — ㉟): `erp.sync` chỉ ở vai `INTEGRATION`; người giữ nó không giữ mã nào khác; `integration.manage` ~~và `po.approve` không cùng một người~~ **[S1.9102]** và `supplier.import` không cùng người với `rfq.create`, `rfq.invite`, `award.recommend`, `po.approve`, `supplier.manage`, `policy.manage` — trigger mức người TẮT MẶC ĐỊNH, chỉ áp khi tổ chức có hàng `org_integrations` (⒇). ADR-084 ⑴ áp: ~~hai~~ ba mã mới vì ba hành vi cần tách người |

### 4.2. Bản xuất PO

| Bảng | Giữ gì |
|---|---|
| `erp_po_exports` | Một hàng mỗi TRẠNG THÁI của một bản xuất (chỉ-ghi-thêm, khuôn `rfq_awards`): `award_id`, **[S1.9102]** `rfq_id` (khoá ngoại hợp thành `(org_id, rfq_id, award_id)` — khoá tư vấn ㉓), `phien_ban_hinh_dang`, `trang_thai` (`SAN_SANG` · `DA_TAI` · `DA_KEO` · `DA_ACK` · `THU_HOI`), `bam` (~~sha256 của tài liệu `v1`~~ **[S1.9102]** sha256 của CHUỖI CHUẨN HOÁ — ㉒), `so_po_erp` (ở hàng `DA_ACK`, **[S1.9102]** đúng một hàng; đổi số là hàng rút rồi ACK lại — ㉔), `tac_gia` (người hay đại diện máy), `session_id`, `seq`, `ghi_luc`; **[S1.9102]** CỘT CHỤP do trigger chép ở hàng `SAN_SANG`, ngoài `GRANT INSERT`: `ncc_ten_phap_ly`, `ncc_ma_so_thue`, `bid_version_id` (㉒) |
| `erp_po_export_lines` | Dòng của tài liệu: `line_no`, `canonical_item_id` (nếu có ánh xạ), mô tả, số lượng, đơn vị, **đơn giá, thành tiền, tiền tệ** — bảng mang giá, khai ở ADR-054 (§2.4 (d)). **[S1.9102]** Do trigger AFTER INSERT của hàng `SAN_SANG` chép từ `bid_dong_tho(payload)` của báo giá thắng và ánh xạ hiệu lực — NGOÀI `GRANT INSERT` của `app_api` (khuôn `082:72`); ứng dụng không viết dòng nào (㉒) |

Hàng `SAN_SANG` và các dòng ghi trong CHÍNH giao dịch chèn hàng `APPROVED` của award (S3.5a `duyetTraoThau`), ~~sau các lần hỏi
chốt và trước các hàng sổ (ADR-154 ⑹)~~ **[S1.9102]** SAU câu `INSERT … 'APPROVED'` — tức sau hàng sổ `RFQ_AWARD_SIGNED`
(`trao-thau.ts:631-634` đứng trước `:655`); không có điểm nào *"sau `APPROVED` và trước mọi hàng sổ"*, và ADR-154 ⑹ là *hai PR*
(§2.6 ㉑). Hệ quả: lỗi của bộ dựng NÉM trong cùng giao dịch ⇒ lần duyệt không đi — fail-closed, không `throwAuditedDenial` ở giao dịch
độc lập vì khoá chuỗi sổ đã bị giữ (`trao-thau.ts:621-623`) —, nên bộ dựng chỉ NÉM ở trạng thái KHÔNG THỂ (award không
`APPROVED`, bản rõ không đọc được, tiền tệ NULL); dữ liệu VẮNG (không lời khai TCO cam kết, dòng không ánh xạ) không là lỗi,
tài liệu ghi vắng (ADR-093 ⑷); cái giá ở §8.14. Tài liệu là hàm thuần (§2.5 ⑻): hai lần dựng cho cùng award ra cùng `bam` — **[S1.9102]** đúng chỉ khi KHÔNG
bảng sửa được nào trong hàm: `suppliers`, `supplier_contacts` có `GRANT UPDATE` (`008:98`, `:173`), nên hàng `SAN_SANG` CHỤP tên
pháp lý và MST vào cột do trigger đặt, và `bam` = `sha256` của chuỗi chuẩn hoá (dòng theo `line_no`, số in như Postgres in
`numeric`, cột chụp, tiền tệ) dựng từ `NEW.*` ∪ `bid_dong_tho(payload)` ∪ ánh xạ hiệu lực — hàm SQL tính ở hàng `SAN_SANG`,
chép sang mọi hàng trạng thái sau; lõi TS tái lập đúng chuỗi ấy và một test J2 so khớp hai bản (㉒). `bam` không vào payload
hàng sổ (chỉ `export_id` — ㉖). Award huỷ (ADR-057) ⇒ hàng `THU_HOI` trong giao dịch huỷ, dưới cùng khoá tư vấn (㉓); hàng
`THU_HOI` không trả dòng (Q13 ⒝).

### 4.3. Bảng nhận từ ERP

| Bảng | Giữ gì | Tiền? |
|---|---|---|
| `erp_import_batches` | Lô: `loai` (`PR` · `GRN` · `HOA_DON` · `NCC` · `HANG_MUC` — **[S1.9102]** hai mã sau chỉ cho lô S5.1 trở đi, S5.0 không dựng bảng này — ㊵), `nguon` (`DAN` · `MAY`), người/đại diện, số dòng, `seq`, `ghi_luc`; hàng rút `rut_cua`; **[S1.9102]** `khoa_idempotent` + `UNIQUE (org_id, loai, khoa_idempotent)` (NULL cho lô dán tay) — lần gửi lại trúng khoá trả CÙNG id lô (㉘) | Không |
| `erp_purchase_requests` + `_lines` | PR của ERP: mã PR, phòng ban (văn bản), người yêu cầu (văn bản), dòng: mã vật tư ERP, mô tả, số lượng, đơn vị, ngày cần | **Không** — PR của ERP có thể mang giá dự toán; hình dạng `v1` KHÔNG có cột ấy, dòng mang thừa cột bị từ chối |
| `erp_receipt_lines` | GRN theo dòng PO: `export_id`, `line_no`, `so_po_erp`, `ma_grn`, `ngay_nhan`, `so_luong_nhan`, `so_luong_tu_choi`, `ly_do_tu_choi` (mã đóng), `nguoi_ghi_erp` (văn bản); **[S1.9102]** `UNIQUE (org_id, export_id, line_no, ma_grn)` (㉘) | **Không** — ~~`CHECK` lược đồ đóng cộng dây bẫy khoá tiền~~ **[S1.9102]** không có cột jsonb để bẫy: cổng là test lược đồ `information_schema.columns` + bước 14 (㉗) |
| `erp_invoice_lines` | Hoá đơn theo dòng PO: `export_id`, `line_no`, `so_hoa_don`, `ngay_hoa_don`, `so_luong`, **`don_gia`, `thanh_tien`, `tien_te`**, `ma_thanh_phan` (`gia` · `van_chuyen` · `nhap_khau` — cùng tập mã TCO ~~của `112`~~ **[S1.9102]** `MA_CO_NGUON` của `packages/danh-gia/src/tco.ts`; `CHECK` ở đây là bản chép SQL đầu tiên của tập ấy, kèm test đọc tệp khoá hai bản — ㉝); **[S1.9102]** `UNIQUE (org_id, export_id, line_no, so_hoa_don)` (㉘) | **Có** — khai ở ADR-054, cổng đọc `bid.view` |

Luật ghi chung: dòng trỏ `export_id` không thuộc tổ chức hay không ở `DA_KEO`/`DA_TAI`/`DA_ACK` ⇒ cả lô bị từ chối; GRN ghi
TRƯỚC ngày award được duyệt ⇒ từ chối có tên ~~(thời gian là của Postgres, không của ERP — ADR-005)~~ **[S1.9102]** (L7) —
`ngay_nhan` là NGÀY CỦA ERP, một lời khai; `ghi_luc` là của Postgres (ADR-005); trigger đòi `ngay_nhan` ≥ ngày `APPROVED` **và**
`ngay_nhan ≤ clock_timestamp()` — GRN ở tương lai làm *Delivery* `DUNG_HAN` cho lô chưa giao (㉔). Rút theo lô; không sửa.

### 4.4. Đối chiếu lời khai TCO với thực tế

Spec S4 §8.13 để lại: *"tới lúc ấy, 'tổng chi phí' trên màn nghĩa là 'tổng chi phí theo lời khai'"*. S5.3 thêm vế thực tế:

| Mã TCO (~~`112`~~ **[S1.9102]** `tco.ts` `MA_CO_NGUON` — ㉝) | Lời khai cam kết (S4.7c) | Thực tế theo ERP | Nhãn |
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
  (phải là đơn vị S4.1 nhận hay bí danh), ~~tuỳ chọn mã vật tư ERP (→ gợi ý ánh xạ S4.3)~~ **[S1.9102]** không cột mã vật tư
  ERP — `rfq_items` không có cột đậu, `chuanHoaGoi` chỉ chạy cho gói đã rời `DRAFT`, bí danh là của `item.manage`; cột ấy về
  lô `HANG_MUC` của S5.1 (D⑤ — §2.6 ㊵). KHÔNG cột giá: một dòng có cột tiền
  ⇒ cả lô bị từ chối gọi tên cột — giá dự toán của khách đi đường `external_purchase_history` của S4.6a dưới
  `DATA_STEWARD`, không đi đường này. **[S1.9102]** Lớp ấy là theo CỘT: mô tả mang mẫu tiền tệ nhận một NHÃN cảnh báo (không
  chặn) và khối nói thẳng mô tả sẽ hiện cho nhà cung cấp (C⑦ — ㊲). Trigger `rfq_items_chi_sua_khi_soan` (`009`, thân hiện
  hành `011:341-345`) giữ *chỉ ở DRAFT*; mỗi lô một hàng sổ. **[S1.9102]** Bộ đọc: `docCsvNgoai` kiểu đóng cho hai hình dạng giá
  ngoài (`csv-ngoai.ts:19`, `:217`) — S5.0 tách lõi tách dòng/tiêu đề thành một hàm nhận bảng cột, bốn hình dạng cùng gọi; ca
  lật kê tên: `csv-ngoai.test.ts` phần tên kiểu (D④ — ㊵).
- **Nhà cung cấp**: dán bảng tính vào `/nha-cung-cap`, ~~người giữ `supplier.manage`~~ **[S1.9102]** người của Q12 (mã mới
  `supplier.import`, đề xuất `TECHNICAL`) — `supplier.manage` chỉ ở PM, vai cũng giữ `rfq.create` + `rfq.invite`, nên ở tổ chức
  đã bật S3 mọi hồ sơ PM nhập KHÔNG đếm được ở K2 khi PM mời (`107:118-137`; D⑥, L3 — ㊶); màn cảnh báo khi người dán giữ
  `rfq.invite`/`rfq.create`; cột tên pháp lý, MST, người liên hệ (họ
  tên, email, điện thoại). Người nhập là `created_by` của mọi hồ sơ (ADR-152); hồ sơ CHƯA xác minh; MST trùng hồ sơ đã có ⇒
  dòng ấy lỗi (`UNIQUE (org_id, tax_code)` của `008` — không gộp lặng lẽ, bài học V2.1 §14).

Hai lối nhập này không cần chứng chỉ máy, không cần cấu hình kết nối, và là đủ cho bậc 2 của thang pilot. **[S1.9102]** Hai
lối ghi `rfq_items`, `suppliers`, `supplier_contacts` qua ĐÚNG đường gói của S1 — không bảng nhận, không `erp_import_batches`;
hai hàng sổ của S5.0 là hàng sổ thường (payload: số dòng, `rfq_id` hay số hồ sơ — không tên người liên hệ) (A④ — ㊵).

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

**[S1.9102]** Hai điều lượt soi thêm. ⑴ (C⑪ — §2.6 ㊴) Người đặt thước `diem_ncc` là người giữ `policy.manage` — `FINANCE`, vai
cũng giữ `award.recommend`, `po.approve`, `bid.view`; `033` chỉ loại `rfq.create`, `rfq.approve`. Tiền lệ `113` áp nguyên:
tác giả phiên bản chính sách ghim bị loại khỏi NGƯỜI KÝ award chụp phiên bản ấy (`K7_TAC_GIA_CHINH_SACH`); KHÔNG loại khỏi
người đề xuất — bản chụp ghim `policy_id`, nên bộ bằng chứng kể đúng ai đặt thước. Nói ra ở §8.3. ⑵ (C② — Q12) Người dán lô
GRN không là người chọn danh sách hay đề xuất; bản chụp gắn cờ dòng GRN có tác giả thuộc tập loại trừ của gói, và bộ bằng
chứng của award nêu lô GRN đã RÚT sau mốc đề xuất. ⑶ (D⑩ — ㊸) `gieo:demo` hôm nay gieo BA gói đã mở (`goi-da-mo.ts:2`) — dưới
sàn ≥ 5, nên câu nghiệm thu *"Supplier Score hiện khi N có đủ sàn"* xanh dù điểm không bao giờ hiện; S5.4 gieo ≥ 5 gói đã mở
cho một nhà cung cấp và câu nghiệm thu bỏ chữ *khi*.

### 4.7. SSO/OIDC

| Bảng | Giữ gì |
|---|---|
| `org_sso_configs` | Chỉ-ghi-thêm theo phiên bản: `issuer`, `client_id`, `jwks_uri`, `email_claim` (mặc định `email`), `bat_tu`, `tat_link_email` (Q4 vế hai). Ghi bởi `tp-khoi-tao` — ngoài `GRANT` của `app_api`. Client secret ở Secrets Manager (`tp/api/sso/<slug>`), không ở đây |
| `user_identities` | `(org_id, user_id, issuer, sub)`, `rang_luc`; một `sub` ràng đúng một người, một người một `sub` mỗi `issuer` — **[S1.9102]** TRONG MỘT TỔ CHỨC: `UNIQUE (org_id, issuer, sub)`, `UNIQUE (org_id, user_id, issuer)`, không `UNIQUE (issuer, sub)` toàn cục (oracle ADR-013, `002:149-155`; một người thuộc hai tổ chức dưới `accounts.google.com` là ca hợp lệ — B⑧, §2.6 ㉚); `id`, `rang_luc` ngoài `GRANT INSERT`; `app_api` có `GRANT SELECT, INSERT` theo cột, không `UPDATE`/`DELETE`; chỉ-ghi-thêm, không đổi `sub` — đổi là một hàng rút kèm lý do bởi `tp-khoi-tao` |
| `sessions` | Không đổi hình dạng: phiên SSO là `kind = 'USER'` ra đời SAU TOTP (ADR-020 ⑴, trigger `039`) — tiền đề B6 *"di trú bảng phiên"* không xảy ra |

Đường đi: `/login` (có mã tổ chức ở fragment, ADR-107) → chuyển hướng tới IdP (Authorization Code + PKCE, `state` và
`nonce` băm lưu ở bảng tạm có hạn, khuôn `rfq_invitation_tokens`) → callback (`ANON`, `callerLimit`) kiểm `iss`, `aud`,
`nonce`, `exp`, chữ ký qua JWKS (lấy qua đường ra ngoài — tên miền phải có ở DNS Firewall) → email claim hạ chữ TRÙNG
`users.email` của đúng tổ chức → ràng `sub` lần đầu hoặc đối chiếu → bước TOTP như hôm nay → phiên. Không khớp email ⇒ một
thông điệp gộp như đường link (ADR-126), một hàng sổ `SSO_DENIED` không mang email. Không tạo người dùng, không gán vai
(ADR-111). **[S1.9102]** (C③ — §2.6 ㉙) *"bước TOTP như hôm nay"* hôm nay GHI DANH TOTP cho người chưa có hồ sơ (`auth.ts:149-160`),
nên một quản trị IdP đăng nhập bằng email của người vừa được tạo hay vừa đặt lại TOTP (`040`) sẽ ràng `sub` của mình vào người
ấy rồi cài TOTP của mình — phiên `USER` đầy đủ của người ấy. Chốt: ghi danh TOTP lần đầu và sau đặt lại KHÔNG đi qua SSO (đi
link email, hay người thứ hai xác nhận — khuôn `040`); lần ràng `sub` đầu đòi link email; người chưa có hồ sơ TOTP đi SSO nhận
thông điệp gộp và một hàng sổ. **[S1.9102]** (B⑥, L4 — ㉛) *"không tạo người dùng, không gán vai"* hôm nay KHÔNG có lớp CSDL:
`app_api` còn `INSERT` trên `users` (`002:173`) và `INSERT`/`DELETE` trên `user_roles` (`005:476-480`) — đo M4a, M4b, M9 trên
lược đồ thật; khoản 9401 (`REVOKE`) đóng trước S5.5, và M8 nhận câu ấy.

### 4.8. Đa tiền tệ (Q5 ~~⒜~~ **[S1.9102]** ⒜′)

Một migration nới ~~bốn bản chép của tập đơn vị (ADR-103 ⑴): `CHECK` ở `014` (hai bảng), `057`, hàm `bid_currency` (`070`),
ô chọn của `/nop-thau` và `/chinh-sach`~~ **[S1.9102]** (A⑤ — §2.6 ㉜) CHÍN `CHECK` có tên riêng — `014:62`, `:113`; `057:83`;
`103:98`, `:180`; `104:95`; `109:65`, `:105`; `110:43` —, hằng `CURRENCIES` (`procurement-policy.ts:30`), hai `RETURN` của
`bid_currency` (`070`), ô chọn `/nop-thau` và `/chinh-sach`; `tien-te-dong-bo.test.ts` mở rộng quét MỌI `db/migrations/*.sql`
(hôm nay chỉ `057`); `tien-te-mot-cho-doc.test.ts` là INV-J8, không là cổng của tập. Tập mới GIẢ ĐỊNH: `VND`, `USD`, `EUR`,
`JPY`, `CNY`, `KRW`, `SGD`, `THB`. Không bí danh cho mã mới. Mọi luật cũ giữ: một gói một tiền tệ, benchmark cùng tiền tệ, hàm
theo bậc NÉM khi lệch (ADR-082 ⑽). `external_price_references` và `external_purchase_history` nhận tiền tệ mới qua ~~cùng
`CHECK`~~ **[S1.9102]** `CHECK` RIÊNG của `109` (hai trong chín). Không bảng tỷ giá (§10). **[S1.9102]** (C⑩) Ở tổ chức đã bật
S3: `org_procurement_policies.currency` là một tiền tệ mỗi phiên bản (`014:62`) và `award_chot_bac` trả `K7_LECH_TIEN_TE` khi
báo giá khác tiền tệ của phiên bản ghim (`113:371-376`) — nới tập KHÔNG cho tổ chức ấy mua ngoại tệ; màn nói thẳng *"gói phải
cùng tiền tệ của chính sách; đổi tiền tệ là một phiên bản chính sách mới có chữ ký"*; ô tiền tệ của `/nop-thau` GHIM theo tiền tệ
ngân sách của gói ở tổ chức đã bật (nhà cung cấp không chọn) — một cách viết sai không còn chặn cả gói (Q5 ⒜′).

### 4.9. Cưỡng chế ở CSDL

| Chỗ | Làm gì | Bất biến |
|---|---|---|
| `sessions` `CHECK` | `kind IN ('USER','AGENT_READONLY','INTEGRATION')`; `INTEGRATION` ⇒ `expires_at − created_at ≤ trần`; không `GRANT UPDATE (kind)`. **[S1.9102]** Theo Q11 ⒜: thân `029` thay cho nhánh `kind` (`mfa_verified_at` NULL hợp lệ riêng `INTEGRATION`), resolver rẽ `kind`, `039` không chạm; hai trigger B⑬ trên `mfa_credentials` và `sessions` (§4.1) | M3 |
| Trigger vai/người khuôn `033` | `erp.sync` chỉ ở `INTEGRATION`; người giữ `erp.sync` không giữ mã khác; `integration.manage` ~~và `po.approve` không cùng một người (ĐỀ XUẤT — với bảng vai `005`, chỉ `PROCUREMENT_MANAGER` nhận được `integration.manage`; FINANCE và DIRECTOR giữ `po.approve` nên không)~~ **[S1.9102]** và `supplier.import` không cùng người với `rfq.create`, `rfq.invite`, `award.recommend`, `po.approve`, `supplier.manage`, `policy.manage` (Q12); ba hàm MỚI khuôn `033` (㉟); trigger mức người tắt mặc định (⒇) | M3 |
| `erp_po_exports` BEFORE INSERT | **[S1.9102]** `pg_advisory_xact_lock(hashtextextended(rfq_id::text, 1))` TRƯỚC khi đọc hàng mới nhất — đo M5 (㉓); Award `APPROVED` tại lúc chèn (hàng mới nhất); ~~`bam` = hàm SQL tính lại từ dữ liệu, không nhận từ ứng dụng (khuôn `rfq_bam_noi_dung`)~~ **[S1.9102]** `bam` = sha256 của chuỗi chuẩn hoá từ cột chụp ∪ `bid_dong_tho(payload)` ∪ ánh xạ — không bảng sửa được nào (㉒); ~~`SAN_SANG` chỉ trong giao dịch có hàng `APPROVED` mới (deferred constraint trigger khuôn ADR-123)~~ **[S1.9102]** *cùng giao dịch* bằng `ghi_luc = transaction_timestamp()` so với `acted_at` của hàng award, KHÔNG `xmin`; chiều ngược *mọi `APPROVED` có `SAN_SANG` tại COMMIT* bằng constraint trigger hoãn trên `rfq_awards` (㉕) | M7, M2, **M13** |
| `erp_po_exports` ACK | `so_po_erp` chỉ ở hàng `DA_ACK`; băm ACK ≠ `bam` ⇒ `M7_BAM_LECH`; ACK cho lô `THU_HOI` ⇒ từ chối. **[S1.9102]** ACK chỉ từ `DA_KEO`/`DA_TAI`; đúng một `DA_ACK` mỗi lô; đổi số PO = hàng rút có lý do rồi ACK lại (㉔) | M7 |
| Bảng nhận BEFORE INSERT | Lô cùng tổ chức, `export_id` hợp lệ, `ngay_nhan` ≥ ngày `APPROVED` **[S1.9102]** và `≤ clock_timestamp()` (㉔); `seq`/`ghi_luc` do trigger; ~~`erp_receipt_lines` `CHECK` lược đồ đóng + dây bẫy khoá tiền~~ **[S1.9102]** không có cột jsonb để bẫy — cổng là test lược đồ `information_schema.columns` + bước 14 (㉗); `UNIQUE` idempotent theo lô và theo dòng (㉘) | M4, M5 |
| `erp_purchase_requests_lines` `CHECK` | Không cột tiền; hình dạng `v1` đóng — **[S1.9102]** *không cột tiền* là lời khai về LƯỢC ĐỒ, cổng là test lược đồ, không một `CHECK` (㉗); giá trong ô mô tả là lớp khác (㊲) | M5 |
| `org_sso_configs`, `user_identities` | ~~Ngoài `GRANT` của `app_api` trừ `SELECT`; `user_identities` `INSERT` bởi `app_api` chỉ ở lần ràng đầu (trigger: chưa có hàng cho `(issuer, sub)` và cho `(user_id, issuer)`)~~ **[S1.9102]** hai vế loại trừ nhau (A⑬). Tách: `org_sso_configs` ngoài `GRANT` trừ `SELECT`; `user_identities` `GRANT SELECT, INSERT` theo cột cho `app_api`, `UNIQUE (org_id, issuer, sub)`, `UNIQUE (org_id, user_id, issuer)`, trigger `ENABLE ALWAYS` chặn hàng thứ hai, `id`/`rang_luc` ngoài `GRANT INSERT` (㉚); cộng `REVOKE INSERT ON users`, `REVOKE INSERT, DELETE ON user_roles FROM app_api` — khoản 9401 (㉛) | M8 |
| `org_procurement_policies.diem_ncc` `CHECK` | Dạng khẳng định: mọi khoá là thành phần CÓ NGUỒN ở phiên bản phương pháp khai; trọng số nguyên ≥ 0, tổng 100 | L9 |
| Tiền tệ | ~~Bốn `CHECK`/hàm cùng tập; test đọc tệp khoá nhau~~ **[S1.9102]** chín `CHECK` + `CURRENCIES` + hai `RETURN` của `070` + hai ô chọn; `tien-te-dong-bo.test.ts` quét mọi migration (㉜) | M10 |

**Các cổng sẽ đỏ nếu quên** (khuôn spec S4b §10.1): `CHECK` mới vào `CHECK_AN_NINH_KHAI` ~~hay `MIEN_TRU`~~ **[S1.9102]** —
`MIEN_TRU` không có cho `CHECK` (chỉ là bản đồ miễn trừ biên giới GÓI, `bien-gioi-goi.test.ts:75`); `sessions_kind_hop_le` là
`CHECK` ĐỔI ĐỊNH NGHĨA: dòng ở `hardening:3079` đổi cả `mig` lẫn deparse (㊱); bảng chỉ-ghi-thêm
có `bid_chi_ghi_them` và trigger chặn `TRUNCATE`; `id` ngoài `GRANT INSERT`; trigger mới vào ghim và sàn `SAN_SO_TRIGGER`
(**[S1.9102]** sàn 85 ở `db/ghim-trigger-tu-chua.int.test.ts:65` — mỗi trigger mới nâng nó);
policy `_khach` `RESTRICTIVE` cho mỗi bảng; `kind` outbox mới vào ~~hai policy `095` (ADR-134)~~ **[S1.9102]** `095`
`outbox_jobs_kind_app_api` VÀ `099` `outbox_jobs_kind_xep_app_api` (ADR-138) + union `KindOutbox` + hai dòng
`POLICY_RESTRICTIVE_KHAI` + gương (㉞); route người mua mới không khai
`integration` thì KHÔNG BIÊN DỊCH (~~khuôn `agent`~~ **[S1.9102]** trên CẢ BA kiểu route — ⒄); **[S1.9102]** `CHECK
outbox_jobs_payload_khong_mang_gia` (㉖); test lược đồ cột `numeric` của bảng S5 (㉗); `tien-te-dong-bo.test.ts` quét mọi
migration (㉜); ba `CHECK`/`UNIQUE` có tiền tố `org_id` cho `so_po_erp`, `ma_grn`, `so_hoa_don` (㉚).

### 4.10. [S1.9102] Cưỡng chế ở CSDL — bản chịu lực

§4.9 giữ nguyên văn với các chỗ gạch; bảng dưới là bản đọc để viết migration. Tên trigger và hàm là ĐỀ XUẤT (migration chốt);
mọi trigger `ENABLE ALWAYS`, ghim ở `hardening.always.sql` cùng commit, nâng sàn `SAN_SO_TRIGGER`; mọi `CHECK` an ninh vào
`CHECK_AN_NINH_KHAI`; mọi bảng mới có policy `_khach` `RESTRICTIVE`, `bid_chi_ghi_them`, chốt `TRUNCATE`, `id` ngoài `GRANT INSERT`.

| Đối tượng | Ràng buộc | Vị từ | Chốt | Bất biến |
|---|---|---|---|---|
| `sessions` | `sessions_kind_hop_le` (ĐỔI định nghĩa — đổi `mig` + deparse ở `CHECK_AN_NINH_KHAI`); `sessions_integration_ttl` (mới, danh sách chính); thân `sessions_kiem_mfa_khi_tao` (`029`) THAY cho nhánh `kind = 'INTEGRATION'` — `mfa_verified_at` NULL hợp lệ riêng `kind` ấy, ghim lại; `sessions_kiem_totp_gan_day` (`039`) KHÔNG chạm; trigger mới `sessions_kiem_khong_phai_dai_dien`: `kind = 'USER'` cho `(org_id, user_id)` giữ vai `INTEGRATION` ⇒ từ chối | theo Q11 ⒜ | ⒃ ⒆ ㊱; đo M1, M2a, M2b | M3 |
| `mfa_credentials` | BEFORE INSERT `mfa_kiem_khong_phai_dai_dien`: `(org_id, user_id)` giữ vai `INTEGRATION` ⇒ từ chối (đọc `user_roles` dưới RLS, khuôn `083:129-141`) | theo Q11 ⒜ | B⑬ | M3 |
| `role_permissions`, `user_roles` | Ba hàm MỚI khuôn `033`/`083`, không chạm thân đã ghim: `erp_sync_chi_o_vai_integration` (mã ↔ một vai); `erp_sync_khong_cung_tay` (người giữ `erp.sync` không giữ mã khác); `tich_hop_khong_cung_tay` (`integration.manage`, `supplier.import` ∉ cùng người với `rfq.create`, `rfq.invite`, `award.recommend`, `po.approve`, `supplier.manage`, `policy.manage`) — hàm thứ ba TẮT MẶC ĐỊNH: chỉ áp khi tổ chức có hàng `org_integrations`; bản TypeScript khoá qua meta-test khuôn `POLICY_MANAGE_EXCLUDES` | — | ⒇ ㉟ (CHƯA ĐO vế `app_khoi_tao` không `SET app.org_id`) | M3 |
| `erp_po_exports` | BEFORE INSERT `xuat_po_kiem`: `pg_advisory_xact_lock(hashtextextended(rfq_id::text, 1))`; hàng mới nhất của award là `APPROVED`; `SAN_SANG` đòi `ghi_luc = transaction_timestamp()` bằng `acted_at` của hàng `APPROVED` (không `xmin`); chụp `ncc_ten_phap_ly`, `ncc_ma_so_thue`, `bid_version_id`; `bam` = `sha256(chuoi_chuan_hoa(...))` từ `NEW.*` ∪ `bid_dong_tho(payload)` ∪ ánh xạ hiệu lực; hàng sau chép `bam`; `DA_ACK` chỉ sau `DA_KEO`/`DA_TAI`, đúng một, `so_po_erp` chỉ ở đó, băm ACK ≠ `bam` ⇒ `M7_BAM_LECH`; ACK/kéo cho `THU_HOI` ⇒ từ chối; AFTER INSERT `xuat_po_chep_dong` chép `erp_po_export_lines` (ngoài `GRANT INSERT`) | — | ㉑ ㉒ ㉓ ㉔ ㉕; đo M5 | M2 M7 M12 M13 |
| `rfq_awards` | `CREATE CONSTRAINT TRIGGER award_approved_co_ban_xuat AFTER INSERT … DEFERRABLE INITIALLY DEFERRED`: `status = 'APPROVED'` ⇒ tồn tại hàng `SAN_SANG` cùng `award_id` tại COMMIT — mục constraint-trigger của hardening, `TRIGGER_DUOC_PHEP` | S5.2 trở đi, mọi tổ chức (hành vi cộng thêm — móc không NÉM cho dữ liệu vắng) | ㉕ | M13 |
| `erp_import_batches`, `erp_receipt_lines`, `erp_invoice_lines`, `erp_purchase_request_lines` | Khuôn `109`: `seq`/`ghi_luc` do trigger, hàng rút `rut_cua`, `UNIQUE (org_id, rut_cua)`; BEFORE INSERT `lo_nhan_kiem`: lô cùng tổ chức, `export_id` ở `DA_KEO`/`DA_TAI`/`DA_ACK`, `ngay_nhan` ∈ [ngày `APPROVED`, `clock_timestamp()`]; `UNIQUE (org_id, loai, khoa_idempotent)`, `UNIQUE (org_id, export_id, line_no, ma_grn)`, `UNIQUE (org_id, export_id, line_no, so_hoa_don)`; `CHECK erp_invoice_lines_ma_thanh_phan` ⊆ `MA_CO_NGUON` kèm test đọc tệp; KHÔNG dây bẫy jsonb (không cột jsonb) | — | ㉔ ㉗ ㉘ ㉝ | M4 M14 |
| `outbox_jobs` | `ALTER POLICY outbox_jobs_kind_app_api` (`095`) và `outbox_jobs_kind_xep_app_api` (`099`) nhận `ERP_WEBHOOK_SEND`; `CHECK outbox_jobs_payload_khong_mang_gia` cùng tập khoá `003:219-225`; payload = `{export_id}` | Q2 ⒞ | ㉖ ㉞ | M11 |
| `org_sso_configs`, `user_identities` | `org_sso_configs` ngoài `GRANT` của `app_api` trừ `SELECT`; `user_identities` `GRANT SELECT, INSERT (org_id, user_id, issuer, sub)` cho `app_api`, `UNIQUE (org_id, issuer, sub)`, `UNIQUE (org_id, user_id, issuer)`, trigger `danh_tinh_rang_mot_lan` chặn hàng thứ hai, `id`/`rang_luc` ngoài `GRANT INSERT`, `bid_chi_ghi_them` | Q4 | ㉙ ㉚ | M8 |
| `users`, `user_roles` | `REVOKE INSERT ON users FROM app_api`; `REVOKE INSERT, DELETE ON user_roles FROM app_api` (giữ `UPDATE (email, full_name, status)` của `users`); census `rls-coverage` đổi; dòng ADR-111 (`DECISIONS.md:3291`) sửa — **khoản 9401**, không chờ S5 | trước S5.5 | ㉛; đo M3, M4a, M4b, M8, M9 | M8 |
| `org_procurement_policies` | `CHECK` dạng KHẲNG ĐỊNH trên nhóm khoá `diem_ncc` (mọi khoá là thành phần có nguồn ở phiên bản phương pháp; trọng số nguyên ≥ 0, tổng 100) — khuôn ADR-099 ㊵; tác giả phiên bản chịu `K7_TAC_GIA_CHINH_SACH` (`113`) ở chữ ký | Q7 ⒜ | ㊴ | L9 |
| Tiền tệ | Chín `CHECK` + `CURRENCIES` + hai `RETURN` của `070` + hai ô chọn nới trong MỘT migration; `tien-te-dong-bo.test.ts` quét mọi `db/migrations/*.sql` | Q5 ⒜′ | ㉜ | M10 |
| Tầng test (không CSDL) | Test lược đồ `information_schema.columns`: cột `numeric` của bảng S5 ngoài hai bảng ADR-054 ⊆ {`so_luong*`}; test hình dạng route: `integration` trên cả ba kiểu; test kiến trúc *đúng một móc*; test J2 so khớp `bam` SQL/TS; vòng quét route dưới chứng chỉ máy; bước 14 cả hai bản nới `erp_po_export_lines` | — | ⒄ ㉑ ㉒ ㉗ ㊸ | M1 M5 M7 M12 |

---

## 5. Bất biến nghiệp vụ mới — nhóm M

Dải nhãn của bộ đọc sổ bất biến nới `[A-HJ-L]` → `[A-HJ-M]` ở S5.0, TRƯỚC khi M1 vào sổ — bài học khoản 229, khuôn S3.0 và
S4.0; đếm chỗ ghim bằng grep lúc làm, kèm mũi thu dải **[S1.9102]** — đếm ngày 2026-10-08: 19 dòng trong 9 tệp `.ts`, cộng
ca biên *"`M` thì không"* (`parse.test.ts:140`) phải LẬT và một hàng mẫu M vào `TEST_PLAN_MAU` (D⑭ — §2.6 ㊹). L9 giữ mã, vào sổ ở S5.4. Mỗi hàng vào `docs/TEST-PLAN.md` ở đúng
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
| **M10** | Mọi cột tiền của S5 mang tiền tệ thuộc tập đóng; không mã S5 nào quy đổi; hoá đơn khác tiền tệ award ⇒ nhãn, không số; ~~bốn bản chép tập đơn vị khoá nhau~~ **[S1.9102]** mọi bản chép — chín `CHECK`, `CURRENCIES`, `070`, ô chọn — khoá nhau (§2.6 ㉜; §5.1) | Test đọc tệp (ADR-103 — **[S1.9102]** `tien-te-dong-bo.test.ts` quét mọi migration); ca đối chiếu lệch tiền tệ | S5.3, S5.6 |
| **L9** | (spec S4b §11.1, nguyên văn) Supplier Score tính lại được từ bản chụp đầu vào + trọng số của phiên bản ghim; phiên bản khai trọng số cho thành phần không có nguồn bị từ chối LÚC GHI; dưới sàn không có số; không route khách nào trả nó | `CHECK` dạng khẳng định; lõi thuần + test tái lập; vòng quét route A5 | S5.4 |

Lượt soi hình dạng được phép tách hay gộp các hàng; số mới, không hậu tố. **[S1.9102]** Đã tách — §5.1.

### 5.1. [S1.9102] Bảng bất biến chịu lực

Bảng §5 giữ nguyên văn; bảng này là bản đã sửa theo §2.6 ㊷ — hàng tách mang số mới, không hậu tố (khoản 246); mỗi hàng vào
`docs/TEST-PLAN.md` ở hạng mục ĐO được nó, tiêu đề nhóm M xuất hiện cùng hàng đầu (S5.1). Số M11–M14 là số đề xuất, không
hậu tố; L9 giữ mã.

| Mã | Mệnh đề (bản sửa) | Cưỡng chế | Hạng mục |
|---|---|---|---|
| **M1** | Vế ÂM: không route nào ngoài tập đóng `integration: true` trả gì cho chứng chỉ `INTEGRATION` — 403 có sổ TRƯỚC `requirePermission`; không bảng so sánh, xếp hạng, benchmark, điểm rủi ro, báo giá thua, hạng mục hay hạn nộp của gói chưa `AWARDED`, dữ liệu cá nhân người liên hệ; chứng chỉ `INTEGRATION` không gọi được route CHỈ khai `agent: true`, phiên người không gọi được route CHỈ khai `integration: true` (`GET /me` khai cả hai) | Trường `integration` bắt buộc trên cả ba kiểu route (⒄); VÒNG LẶP MỚI quét mọi route dưới chứng chỉ máy với gói ở mọi trạng thái (㊸); bộ quét rò rỉ T2 dưới chứng chỉ máy với gói chưa mở | S5.1 |
| **M2** | Mỗi lần người tải bản xuất, mỗi lần máy kéo bản xuất (KỂ CẢ lần kéo lặp cùng lô, cùng trạng thái), mỗi ACK, mỗi lần đọc đối chiếu TCO, mỗi lần đọc *Spend under management* để lại đúng một hàng sổ trong CHÍNH giao dịch; sổ không ghi được thì dữ liệu không đi ra; trần đọc theo phiên cắt 429 TRƯỚC hàng sổ | Khuôn ADR-102; test đếm hàng sổ; đột biến gỡ lần ghi; ca *ghi sổ hỏng*; trần khuôn `AGENT_DOC_TRAN_MOI_CUA_SO` (⒆) | S5.2 (tải, kéo, ACK), S5.3 (đối chiếu) |
| **M3** | Chứng chỉ `INTEGRATION` là hàng `sessions` có TTL trần theo phép đo, không `UPDATE` được `kind`, chỉ phát qua `BuyerWriteRoute` dưới `integration.manage` với TOTP tươi của người phát, không tự gia hạn, không tự nhân bản, thu hồi được qua route dưới `integration.manage` — thu hồi rồi gọi ⇒ 401 có sổ, quá TTL ⇒ `CHECK` ném; người đại diện giữ đúng `erp.sync`, không hồ sơ TOTP, không phiên `USER` (Q11 ⒜); `erp.sync` chỉ ở vai `INTEGRATION`; `integration.manage`/`supplier.import` không cùng người với tập Q12 (trigger người tắt mặc định) | `CHECK` `051` nới; thân `029` nhánh `kind`; hai trigger B⑬; ba hàm khuôn `033`; vòng quét: chứng chỉ máy gọi `/auth/agent-session`, route phát và route thu hồi ⇒ 403 có sổ; T5 ⑵ ⑾ | S5.1 |
| **M4** | Dữ liệu từ ERP chỉ vào bảng nhận của S5, theo lô tất-cả-hoặc-không, chỉ-ghi-thêm có hàng rút, `seq`/`ghi_luc` do trigger; lô gửi lại nguyên văn không nhân đôi (khoá idempotent theo lô và theo dòng); không câu nào của S5 UPDATE/DELETE một bảng S1–S4, không đổi trạng thái gói, award, chữ ký, hạng, điểm | Test kiến trúc liệt kê bảng đích (khuôn `bang-ngoai-liet-ke`); `bid_chi_ghi_them`; `UNIQUE` (㉘); đột biến đổi một hạng từ GRN; T5 ⒃ | S5.1 (PR), S5.3 (GRN, hoá đơn) |
| **M5** | Không bảng S5 nào mang một số tiền ngoài `erp_po_export_lines` và `erp_invoice_lines` — hai bảng khai ở ADR-054; mọi cột `numeric` khác của bảng S5 là số lượng; `bam` không vào payload sổ; payload job PUSH không mang giá | Test lược đồ `information_schema.columns` (㉗); `CHECK outbox_jobs_payload_khong_mang_gia` (㉖); bước 14 kịch bản 41 CẢ HAI bản: hai `toEqual` vét cạn nới `erp_po_export_lines`, kim hoá đơn riêng (㊸) | S5.2, S5.3 |
| **M6** | Tính đúng của mọi cạnh RFQ, award, chữ ký không phụ thuộc ERP: ERP trả lỗi, trả băm lệch, trả dữ liệu lạ, không trả lời, gửi lại — không trạng thái nào của S1–S4 đổi, mọi khẳng định cũ xanh nguyên văn | ĐỘT BIẾN ERP giả lập ở từng route S5 trong kịch bản 41 (㊷); T6 | S5.2 (xuất, kéo, ACK), S5.3 (GRN, hoá đơn) |
| **M7** | Bản xuất PO là hàm thuần của nguồn CHỈ-GHI-THÊM và cột chụp; `bam` = sha256 của chuỗi chuẩn hoá do CSDL tính ở hàng `SAN_SANG`; lõi TS tái lập đúng chuỗi ấy (cặp J2); hai lần dựng ra cùng byte dù `suppliers` đổi tên sau đó; ACK mang băm lệch bị từ chối có tên; tính lại được ngoại tuyến từ bộ bằng chứng | Trigger băm (㉒); test J2 so khớp SQL/TS; đột biến đổi một dòng, đổi tên nhà cung cấp sau xuất; `pnpm bang-chung kiem` mang lớp ERP | S5.2, S5.8 |
| **M8** | Phiên SSO chỉ ra đời sau TOTP (ADR-020 ⑴ nguyên văn); email claim phải trùng một người đã có trong đúng tổ chức — không tạo người, không gán vai, và `app_api` KHÔNG CÒN quyền làm hai việc ấy (khoản 9401); ghi danh TOTP lần đầu/sau đặt lại và lần ràng `sub` đầu không đi qua SSO (㉙); `sub` ràng một lần trong tổ chức; token của tổ chức khác, `nonce` sai, `alg` lạ, chữ ký sai, `exp` quá, `aud` lệch đều bị từ chối có sổ không mang email; cấu hình SSO ngoài `GRANT` của `app_api` | `039` không đổi; `REVOKE` (㉛); `UNIQUE` + trigger `user_identities` (㉚); bộ ca T5 ⑹ ⑿ ⒀; đối chứng dương | S5.5 (khoản 9401 đóng trước) |
| **M9** | Vế PR và phiên: không PR, chứng chỉ, lô nhận nào của tổ chức A đọc được từ B; mã PR của ERP không là khoá toàn cục | RLS + khoá ngoại hợp thành `(org_id, …)`; test F1/F2 khuôn | S5.1 |
| **M10** | Mọi cột tiền của S5 mang tiền tệ thuộc tập đóng; không mã S5 nào quy đổi; hoá đơn khác tiền tệ award ⇒ nhãn, không số; MỌI bản chép của tập (chín `CHECK`, `CURRENCIES`, `070`, ô chọn) khoá nhau | `tien-te-dong-bo.test.ts` quét mọi migration (㉜); ca đối chiếu lệch tiền tệ | S5.3 (đối chiếu), S5.6 (tập) |
| **M11** | Mọi đích PUSH là một tên miền trong danh sách hạ tầng theo khách; `api` không theo 3xx, không đọc thân phản hồi ngoài một mã ACK; thân ký HMAC bằng khoá theo kết nối; payload job chỉ `{export_id}`; thử lại có trần rồi `THAT_BAI` có tên; không cạnh RFQ nào chờ job | Bộ kiểm ở `tp-khoi-tao`/deploy đọc `org_integrations.dich_webhook` đối chiếu danh sách DNS Firewall; `hinh-dang-dns.test.ts` nới cho đích theo khách; T5 ⑼; `CHECK outbox_jobs_payload_khong_mang_gia` | S5.7 |
| **M12** | Vế DƯƠNG và THEO THỜI GIAN của M1: award `APPROVED` ⇒ chứng chỉ máy và người giữ `bid.view` đọc được bản xuất; đơn giá duy nhất đi ra là của báo giá ĐÃ TỪNG được trao ở một award `APPROVED` của gói; hàng `THU_HOI` không trả dòng; bản tải cho người cùng danh sách trường đóng của `v1` (㊳) | Vòng quét route với đối chứng dương; ca huỷ–trao lại: lần kéo sau trả dòng của award mới, hàng `THU_HOI` không dòng; test danh sách trường `v1` đóng | S5.2 |
| **M13** | Vế bản xuất của M9 và chiều ngược của ㉕: không bản xuất của tổ chức A đọc, ACK hay rút được từ B; mọi award `APPROVED` có hàng `SAN_SANG` tại COMMIT; hàng `SAN_SANG` cùng giao dịch với hàng `APPROVED` | Constraint trigger hoãn trên `rfq_awards`; `transaction_timestamp()`; RLS + khoá ngoại `(org_id, rfq_id, award_id)`; đột biến chèn `SAN_SANG` ở giao dịch sau | S5.2 |
| **M14** | Vế GRN và hoá đơn của M9: không GRN hay hoá đơn của tổ chức A ràng được vào award của B; `so_po_erp`, `ma_grn`, `so_hoa_don` không là khoá toàn cục (chỉ `UNIQUE` có tiền tố `org_id`) | RLS + khoá ngoại hợp thành; test F1/F2 khuôn; T5 ⑸ | S5.3 |
| **L9** | (spec S4b §11.1, nguyên văn) Supplier Score tính lại được từ bản chụp đầu vào + trọng số của phiên bản ghim; phiên bản khai trọng số cho thành phần không có nguồn bị từ chối LÚC GHI; dưới sàn không có số; không route khách nào trả nó; **[S1.9102]** tác giả phiên bản chịu `K7_TAC_GIA_CHINH_SACH` ở chữ ký (㊴) | `CHECK` dạng khẳng định; lõi thuần + test tái lập; vòng quét route A5; đối chứng dương với ≥ 5 gói gieo (㊸) | S5.4 |

---

## 6. Kiến trúc kiểm thử

- **T1** — lõi thuần `packages/tich-hop`: bộ dựng PO `v1` (bảng ca: award một dòng, nhiều dòng, dòng không ánh xạ, tiền tệ
  `USD`, lời khai thiếu một mã); bộ đọc lô PR/GRN/hoá đơn (thừa cột, thiếu cột, cột tiền ở GRN, ngày trước award, số âm,
  trùng dòng); hàm đối chiếu (đúng hạn, trễ, chưa giao, lệch tiền tệ, hoá đơn thiếu); Supplier Score với hai thành phần mới
  (sàn, dưới sàn, thành phần không nguồn). Test thuộc tính (`fast-check`): nhân mọi số tiền với k thì nhãn đối chiếu theo tỷ
  lệ không đổi; hoán vị dòng không đổi `bam`. **[S1.9102]** Thêm: chuỗi chuẩn hoá của `bam` so khớp bản SQL trên cùng đầu vào
  (cặp J2 — §2.6 ㉒); lõi tách dòng/tiêu đề dùng chung cho bốn hình dạng (㊵); ba ca ACK và `ngay_nhan` (㉔); dữ liệu VẮNG
  (không lời khai cam kết, dòng không ánh xạ) ra tài liệu ghi vắng, không lỗi (㉑).
- **T2** — vòng quét route cho M1 dưới ba chứng chỉ (máy, agent, người không `bid.view`), gói ở mọi trạng thái, có đối chứng
  dương; **bộ quét rò rỉ T2 chạy thêm một lượt dưới chứng chỉ máy** với gói chưa mở — A4 cho máy. **[S1.9102]** (D⑨ — ㊸)
  *chạy thêm một lượt* là một VÒNG LẶP MỚI: bộ quét chọn cookie theo audience (`kich-ban-41-http.int.test.ts:1217`), kỳ vọng
  ngược — 403 có sổ ngoài tập đóng, đối chứng dương trong tập; S5.1 kê nó là việc, không là một tham số.
- **T3** — Postgres thật: `CHECK` `kind`; trigger `033` cho vai mới; băm bản xuất do trigger; lô bị từ chối không để lại dòng;
  ACK băm lệch; RLS hai tổ chức (M9); `user_identities` ràng lần hai; `diem_ncc` khai thành phần không nguồn bị từ chối lúc
  ghi. Đột biến tắt trigger lúc chạy (khuôn `db/hardening-suy-tu-tinh-chat.int.test.ts`). **[S1.9102]** Thêm: hai ACK song
  song có và không khoá tư vấn (đo M5 thành test thường trực — ㉓); ACK trước kéo, ACK thứ hai, `ngay_nhan` tương lai (㉔);
  `SAN_SANG` ở giao dịch sau bị constraint trigger hoãn từ chối, và `SAVEPOINT` quanh hàng award không làm từ chối nhầm (㉕);
  người giữ vai `INTEGRATION` cài TOTP hay mở phiên `USER` bị từ chối (B⑬); `app_khoi_tao` chèn vai không `SET app.org_id`
  (㉟, CHƯA ĐO); test lược đồ cột `numeric` (㉗); đổi tên nhà cung cấp sau xuất không đổi `bam` (㉒). **S5.0 có một dòng T3
  riêng** (D⑪): trùng MST, cột tiền, `rfq_items_chi_sua_khi_soan` ở `DRAFT`, hàng sổ không tên người liên hệ, K2 đếm hồ sơ
  người khác nhập.
- **T4** — lượt đi thử có biên bản trên cụm thật với ERP giả lập (khuôn S1.97); khung 375×812 cho mọi màn chạm.
- **T5** — đối kháng, ít nhất: ⑴ chứng chỉ máy gọi `/rfqs/:rfqId/comparison`, `/rfqs/:rfqId/ranking`, `/suppliers/:id/
  contacts`, `/rfqs/:rfqId` của gói `OPEN`; ⑵ chứng chỉ máy tự phát chứng chỉ; ⑶ GRN mang khoá `amount` lồng trong mảng; ⑷
  ACK với băm của bản xuất khác cùng tổ chức; ⑸ GRN trỏ `export_id` của tổ chức khác; ⑹ id_token của tổ chức khác với
  email trùng; `alg: none`; `nonce` dùng lại; ⑺ dán hạng mục kèm cột *đơn giá dự toán*; ⑻ hoá đơn `EUR` cho award `VND`; ⑼
  webhook: đích đổi sang IP nội bộ (PUSH); ⑽ ứng dụng ghi `trang_thai = 'DA_ACK'` không qua route (trigger phải chặn vì thiếu
  băm ACK). **[S1.9102]** (D⑪, C③, C⑦, B⑥, B⑨) ⑾ chứng chỉ bị thu hồi rồi gọi ⇒ 401 có sổ; chứng chỉ quá TTL ⇒ `CHECK` ném;
  ⑿ id_token `exp` quá, `aud` lệch, chữ ký sai; ⒀ quản trị IdP đăng nhập bằng email của người CHƯA ghi danh TOTP ⇒ thông điệp
  gộp, không bước ghi danh (㉙); ⒁ mô tả PR mang *"dự toán 15.500.000 đ/tấn"* ⇒ nhãn cảnh báo, và câu nghiệm thu nói mô tả
  hiện cho nhà cung cấp (㊲); ⒂ `app_api` chèn `users`/`user_roles` bằng câu thô ⇒ 42501 sau khoản 9401 (㉛); ⒃ ERP gửi lại
  nguyên văn một lô đã commit ⇒ cùng id lô, không hàng mới (㉘); ⒄ người đọc sổ không `bid.view` cầm `bam` quét đơn giá —
  `bam` không có trong payload sổ để quét (㉖).
- **T6** — ~~ERP giả lập bị giết ở ba điểm (trước kéo, sau kéo trước ACK, giữa lô GRN)~~ **[S1.9102]** ĐỘT BIẾN ERP giả lập —
  trả lỗi, trả băm lệch, không trả lời, trả dữ liệu lạ, gửi lại — ở từng route S5 (D⑦ — ㊷); đo rằng không cạnh nào của kịch bản 41
  chờ; đo thời gian giữ khoá hàng award trong lúc dựng bản xuất (bài học khoản 342: lượt đọc không được bỏ đói cạnh ghi);
  **[S1.9102]** đo thời gian giữ khoá chuỗi sổ của tổ chức (`050`, `lock_timeout` 2 s) khi máy kéo liên tục, trước và sau trần
  đọc theo phiên (C⑫ — ⒆).
- **Bước 14** của kịch bản 41 quét bảng S5 bằng ~~hai kim mới~~ **[S1.9102]** MỘT kim mới (hoá đơn, S5.3) và hai `toEqual` vét
  cạn nới `erp_po_export_lines` ở CẢ HAI bản (S5.2) — không có *kim đơn giá xuất*, vì đơn giá bản xuất bằng đơn giá bản rõ (§2.5 ⒁, ㊸).

---

## 7. Điều kiện hoàn thành

**S5.0 — trước pilot bậc 2:**

> **Trên giao diện**, một người mua dán 40 dòng hạng mục từ bảng tính của khách vào một gói `DRAFT`; một dòng mang cột *đơn
> giá* thì cả lô bị từ chối và màn gọi tên cột ấy; bỏ cột, lô vào, mỗi dòng có đơn vị S4 nhận. ~~Người quản lý mua sắm~~
> **[S1.9102]** Người của Q12 (đề xuất: người giữ `TECHNICAL`, mã `supplier.import`) dán 25
> nhà cung cấp kèm người liên hệ; hai dòng trùng MST với hồ sơ đã có thì lô kể đúng hai số dòng và không gì vào; sửa, lô vào,
> mọi hồ sơ *chưa xác minh*. Hai lô là hai hàng sổ không mang tên người liên hệ. Lượt đi thử ở 375×812 có biên bản.
> **[S1.9102]** Ở một tổ chức đã bật S3, một PM mời ba hồ sơ vừa nhập: K2 đếm cả ba (㊶). Một dòng hạng mục có mô tả mang
> *"dự toán 15.500.000 đ"* vào kèm nhãn cảnh báo, và khối nói mô tả sẽ hiện cho nhà cung cấp (㊲). `pnpm t0` xanh với `tao-thau.js`
> không đổi — khối dán là một module riêng (§2.4 (a)).

**S5 trọn — ở một tổ chức có ERP (thật, hay giả lập cho demo V2.1 §41 với nhãn dữ liệu mẫu):**

> **Trên giao diện**, một gói đi trọn kịch bản 41 (hai luồng) tới award `APPROVED`. Khối award hiện *"bản xuất sẵn sàng"*;
> FINANCE tải PO (Q2 ⒜) — một hàng sổ; ERP kéo bản xuất bằng chứng chỉ máy — một hàng sổ — và ACK với số PO; cùng chứng chỉ
> gọi bảng so sánh thì 403 và một hàng sổ. **[S1.9102]** ACK một lô chưa kéo, ACK lần hai, và chứng chỉ đã thu hồi gọi lại: ba
> từ chối có tên, ba hàng sổ (㉔, ⒆). ERP đẩy một lô GRN (một dòng từ chối 10%) và một lô hoá đơn (phí vận chuyển cao
> hơn lời khai 20%). Hồ sơ nhà cung cấp hiện *Delivery* đúng hạn, *Quality* 90% *"theo GRN của ERP (1 dòng)"*, đối chiếu TCO
> hiện `LECH_20%` ở `van_chuyen` kèm *"lời khai … / thực tế theo ERP …"*; Supplier Score ~~hiện khi tổ chức đã khai `diem_ncc`
> và N có đủ sàn~~ **[S1.9102]** HIỆN cho N — tổ chức đã khai `diem_ncc` và `gieo:demo` gieo ≥ 5 gói đã mở cho N (D⑩ — ㊸) —,
> kèm thành phần; nhà cung cấp không thấy gì ở phiên khách. ~~Giết ERP giả lập giữa lô GRN~~ **[S1.9102]** ERP giả lập trả băm
> lệch, trả lỗi, gửi lại lô GRN nguyên văn, gửi GRN ngày tương lai: lô không vào hay không nhân đôi, gói
> và award không đổi (㊷). Bộ bằng chứng của gói mang bản xuất, ACK, đối chiếu, bản chụp Supplier Score, và `pnpm bang-chung kiem`
> tính lại đúng `bam` khi đã ngắt CSDL. Một người của tổ chức đã bật SSO đăng nhập bằng tài khoản công ty rồi TOTP; một
> id_token mang email không có trong tổ chức bị từ chối bằng thông điệp gộp. **[S1.9102]** IdP là một IdP giả lập OIDC trong
> `tools/` (㊸); một người chưa ghi danh TOTP đi SSO nhận cùng thông điệp gộp, không bước ghi danh (㉙). Lượt đi thử ở 375×812 có biên bản.

Và như mọi lát cắt: mọi mã M vào sổ có ô ở `evidence/INV-matrix.md`; `security-reviewer` chạy trên S5.1, S5.2, S5.5, S5.7
(chứng chỉ, giá đi ra, danh tính, đường ra ngoài) **[S1.9102]** và trên S5.0 (dán dữ liệu cá nhân người liên hệ hàng loạt),
S5.3 (hoá đơn mang tiền) (D⑪); `docs/STATE.md` đối chiếu với mã.

### 7.1. Cách đếm KPI của V2.1 §36 cho S5

| KPI | Đếm | Không đếm |
|---|---|---|
| *ERP transactions* (Adoption) | Lô xuất `DA_ACK` + lô nhận không bị rút, theo tổ chức, theo tháng | Lô bị từ chối; lô `THU_HOI`; lô của tổ chức mang dấu dữ liệu mẫu (ADR-100 Q8 — **[S1.9102]** cần L24 của S4b.0, chờ pilot; tới đó vế này không đếm được — D⑭) |
| *Spend under management* | Σ thành tiền của bản xuất `DA_ACK` theo tiền tệ — KHÔNG cộng chéo tiền tệ. **[S1.9102]** Là một lượt đọc giá: dưới `bid.view`, một hàng sổ (M2, ADR-102), không ở màn nào khác (L10, D⑭) | Award chưa ACK |
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
trên màn `/tich-hop` phải nói đúng điều ấy. **[S1.9102]** (C⑤) Đoạn trên chỉ nói vế ĐỌC. Kẻ cầm chứng chỉ còn ĐẨY: lô GRN và hoá
đơn giả đổi *Quality*, *Delivery*, nhãn `LECH_x%` và bản chụp Supplier Score của mọi đề xuất sau — chữ ký duy nhất là *người
đại diện*; và ACK giả. Lớp: route thu hồi (route ĐẦU TIÊN trong kho thu hồi phiên của người khác), một hàng rút *"mọi lô do
chứng chỉ X ghi từ mốc T"*, trần đọc theo phiên, TTL theo phép đo (§2.6 ⒆). Không lớp nào triệt — màn nói cả hai vế.

### 8.3. GRN là lời khai của bên mua về nhà cung cấp

§4.6 đã nói: *Quality*, *Delivery* lấy từ dữ liệu người của bên mua ghi. Nó mở hai đường: hạ một nhà cung cấp trung thực
(cùng họ ㊾), và *Goodhart* — kho ghi đẹp cho nhà cung cấp quen. Lớp của sản phẩm chỉ là nhãn nguồn, nhãn lệch GRN–hoá đơn, và
A5. Điều KHÔNG hứa: không lớp nào biết GRN đúng hay sai. **[S1.9102]** Hai điều lượt soi thêm: (C②, Q12) người DÁN lô GRN không
được là người chọn danh sách hay đề xuất — một người vừa viết lời khai về nhà cung cấp vừa đề xuất là hình dạng L3 cấm; (C⑪ —
§2.6 ㊴) người đặt trọng số `diem_ncc` là `FINANCE`, cũng là người đề xuất và duyệt; `113` loại tác giả phiên bản khỏi NGƯỜI KÝ
award chụp phiên bản ấy, không khỏi người đề xuất — tài liệu này nói ra điều ấy thay vì hứa tách.

### 8.4. SSO dời biên tin cậy sang IdP

Với Q4 ⒜, IdP chỉ thay hộp thư: chiếm IdP thì không mở được phiên vì còn TOTP **[S1.9102]** — đúng cho người ĐÃ ghi danh TOTP,
sai ở cửa sổ ghi danh lần đầu và sau đặt lại (`040`): hôm nay `/auth/redeem` ghi danh TOTP cho người chưa có hồ sơ
(`auth.ts:149-160`), nên một quản trị IdP chiếm được mọi người CHƯA ghi danh của tổ chức, kể cả người duyệt mới (C③); §2.6 ㉙
đóng cửa sổ ấy bằng kênh thứ hai. Với ⒝ (nếu chủ dự án chọn), một quản trị IdP
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

### 8.13. [S1.9102] Người chấm kỹ thuật giữ kênh ERP (Q12 ⒝)

Đề xuất Q12 ⒝ đặt `integration.manage` và `supplier.import` lên `TECHNICAL` vì vai ấy không chọn danh sách, không đề xuất, không
duyệt, không xem giá — và vì B4 (tổ chức nhỏ) không chịu thêm một người nữa. Cái giá: người chấm kỹ thuật (`evaluation.perform`)
giữ hai thước về nhà cung cấp trong một tay — điểm kỹ thuật của báo giá và lô GRN/sổ nhà cung cấp nhập về. Lớp: hoá đơn (mang
tiền) và bản xuất PO chỉ đi qua MÁY, người dán chỉ dán GRN và PR; bản chụp Supplier Score gắn cờ dòng GRN có tác giả thuộc tập
loại trừ của gói; `/nha-cung-cap` hiện người dán từng lô. Nếu chủ dự án chọn ⒜ (vai mới), cái giá đổi sang E1/E14: thêm một
người không ai có.

### 8.14. [S1.9102] Hai lớp CSDL mới ở đường đăng nhập, và móc fail-closed ở cạnh duyệt trao

Q11 ⒜ thay thân `029` — một trigger của đường đăng nhập, ghim ở hardening — cho một nhánh `kind`, và thêm hai trigger quanh
người đại diện. Bán kính nổ: mọi test của `029`/`039` lật ở nhánh `kind` (kê tên ở S5.1); một lỗi ở nhánh ấy là một phiên không
MFA cho `kind` sai. Lớp bù: `039` không chạm; `sessions_integration_ttl` và hai trigger B⑬ vào `CHECK_AN_NINH_KHAI`/ghim; vòng
quét route dưới chứng chỉ máy là phép đo độc lập với trigger. Móc bản xuất trong `duyetTraoThau` NÉM trong cùng giao dịch
(§2.6 ㉑): một lỗi của bộ dựng làm lần duyệt không đi — đúng ý (không award nào `APPROVED` mà không có bản xuất), và vì thế bộ
dựng chỉ được NÉM ở trạng thái không thể; dữ liệu vắng ra tài liệu ghi vắng, để tổ chức MVP1 không đổi hành vi ở cạnh duyệt
(ADR-093 ⑷). Phép đo của cái giá này: kịch bản 41 luồng MVP1 nguyên văn xanh sau S5.2, với award không lời khai cam kết và dòng
không ánh xạ.

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
| **S5.6** | Đa tiền tệ | ADR (f); một migration nới ~~bốn bản chép~~ **[S1.9102]** chín `CHECK` + `CURRENCIES` + `070` (§2.6 ㉜); ô chọn; **M10 (vế tập)** | Một khách mua bằng đơn vị thứ ba (tiền đề C4) |
| **S5.7** | PUSH webhook | ADR (g); `kind` outbox mới + `ALTER POLICY`; ký HMAC; thử lại có trần; biến hạ tầng theo khách; nhật ký ở `/tich-hop` | Q2 ⒞; S5.2 |
| **S5.8** | Bằng chứng và xuất sổ | Lớp ERP trong bộ xuất ADR-059 và `DAC-TA.md` (bản xuất, ACK, đối chiếu, bản chụp điểm); xuất sổ kiểm toán của tổ chức theo khoảng thời gian, theo TRANG, kiểm chuỗi hash ngoại tuyến bằng bộ kiểm của `packages/audit` (V2.1 §27, §34 *Audit Export*) dưới `audit.read`; **M7 (vế ngoại tuyến)**; lượt đi thử T4 trọn | S5.3; S3.9 (lớp governance đi trước lớp ERP trong cùng bộ) |

Mỗi hạng mục đi đúng vòng lặp của spec S0+S1 §9: đo trước khi viết, một bất biến một phép đo, đột biến, rồi tài liệu. Mọi
hàm và trigger mới ghim ở `hardening.always.sql` trong cùng commit với migration. **[S1.9102]** Bảng trên giữ nguyên văn; cột
*Ra cái gì*, *bất biến* và *Chờ* chịu lực là §9.2 (cột *Chờ* sai ở S5.0 và S5.2 — D②; M1/M9 sai hạng mục — D①).

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

### 9.2. [S1.9102] Bảng hạng mục chịu lực

Bảng §9 giữ nguyên văn; bảng này là bản đã sửa theo §2.6 (D①, D②, D③, D④, D⑨, D⑩, D⑪, D⑭). *Ra cái gì* chỉ ghi phần ĐỔI
so với §9; cột *Chờ* là bản đầy đủ.

| # | Đổi so với §9 | Bất biến vào sổ | Chờ |
|---|---|---|---|
| **S5.0** | Không bảng nhận, không `erp_import_batches`; hai hàng sổ thường (㊵); không cột mã vật tư ERP; tách lõi tách dòng/tiêu đề của `csv-ngoai.ts` — ca lật `csv-ngoai.test.ts`; người nhập sổ theo Q12 + cảnh báo K2 (㊶); nhãn cảnh báo mô tả mang tiền (㊲); nới dải `[A-HJ-M]`: 19 dòng/9 tệp + ca biên M lật + hàng mẫu M; khối dán là module riêng; một dòng T3 riêng; `security-reviewer` | — (không bất biến; T3 riêng) | ~~Không~~ **S4.7b** (cùng `apps/web/trang/tao-thau.js`) hay tách module — luật dừng ADR (a); Q12 cho người nhập sổ |
| **S5.1** | Route phát/thu hồi là hai `BuyerWriteRoute` (⒃ ⒆); `integration` trên cả ba kiểu route (⒄); theo Q11 ⒜: thân `029` nhánh `kind`, resolver rẽ `kind`, hai trigger B⑬ — kê tên ca lật của `029`/`039`; ba hàm khuôn `033` (㉟) + `ma-tran-quyen.test.ts` lật (⒇); trần đọc theo phiên; vòng quét route dưới chứng chỉ máy — vòng lặp mới (㊸); `sessions_kind_hop_le` đổi `mig`; lô `HANG_MUC` nhận mã vật tư ERP; nhóm M vào `TEST-PLAN.md` cùng hàng đầu | **M1** (vế âm), **M3**, **M4** (vế PR), **M9** (vế PR, phiên) | Khách có ERP (a) — bậc 2 mở VÒNG MÃ trên ERP giả lập + tệp xuất thật; Q11, Q12; S4.2a — có |
| **S5.2** | `erp_po_exports` với `rfq_id`, cột chụp, `bam` chuỗi chuẩn hoá (㉒), khoá tư vấn (㉓), luật ACK (㉔), constraint trigger hoãn trên `rfq_awards` (㉕); dòng do trigger chép; móc SAU hàng `APPROVED`, fail-closed ở trạng thái không thể (㉑); composition root nối móc + test *một móc*; `THU_HOI` không trả dòng (Q13); danh sách trường `v1` đóng (㊳); bước 14 CẢ HAI bản nới `erp_po_export_lines` — ca lật kê tên; đột biến ERP giả lập (㊷); dòng PRODUCT §5 (nhãn *không "tự động", "đồng bộ"*); `bam` không vào payload sổ (㉖) | **M2** (tải, kéo, ACK), **M5** (vế xuất), **M6** (xuất, kéo, ACK), **M7**, **M12**, **M13** | S5.1; S3.5a — có; **S3.5b** (khối award ở `/mo-thau`); S4.7c (lời khai cam kết trong tài liệu — vắng thì tài liệu ghi vắng); Q2, Q13 |
| **S5.3** | Hai bảng nhận với khoá idempotent (㉘), `ngay_nhan ≤ clock_timestamp()` (㉔), `CHECK ma_thanh_phan` + test đọc tệp khoá `MA_CO_NGUON` (㉝); test lược đồ cột `numeric` (㉗); kim hoá đơn ở bước 14; `security-reviewer`; *Spend under management* dưới `bid.view` + hàng sổ | **M4** (GRN, hoá đơn), **M5** (vế hoá đơn), **M6** (GRN, hoá đơn), **M10** (vế đối chiếu), **M2** (vế đối chiếu), **M14** | S5.2; S4.7c; Q6 |
| **S5.4** | `gieo:demo` gieo ≥ 5 gói đã mở cho một nhà cung cấp — đối chứng dương (㊸); `diem_ncc` chịu `K7_TAC_GIA_CHINH_SACH` ở chữ ký (㊴); bản chụp gắn cờ GRN của tác giả trong tập loại trừ | **L9** | S5.3; S3.7, S3.8; S4b.2 cho *Risk* (thiếu thì không khai được — không chờ); Q7, Q8 |
| **S5.5** | `user_identities` `UNIQUE` có `org_id`, `GRANT INSERT` theo cột (㉚); ghi danh TOTP và ràng `sub` lần đầu không qua SSO (㉙); IdP giả lập OIDC trong `tools/` cho T4 (㊸); T5 ⑿ ⒀; **khoản 9401 đóng TRƯỚC** (㉛) | **M8** | Khách Enterprise có IdP; khoản 9401; Q4; độc lập với S5.1–S5.4 |
| **S5.6** | Một migration nới CHÍN `CHECK` + `CURRENCIES` + `070` + hai ô chọn (㉜); `tien-te-dong-bo.test.ts` quét mọi migration; màn nói giới hạn ở tổ chức bật S3; ô tiền tệ ghim theo gói (Q5 ⒜′) | **M10** (vế tập) | Một khách mua bằng đơn vị thứ ba (tiền đề C4); Q5 |
| **S5.7** | Hai `ALTER POLICY` (`095`, `099`) + union `KindOutbox` + hai dòng khai + gương (㉞); payload `{export_id}` + `CHECK outbox_jobs_payload_khong_mang_gia` (㉖); bộ kiểm đích ở `tp-khoi-tao`/deploy; `hinh-dang-dns.test.ts` nới cho đích theo khách | **M11** | Q2 ⒞; S5.2 |
| **S5.8** | Sổ xuất dưới `audit.read` không mang `bam` (㉖); bộ bằng chứng kể `kind` của phiên (⒅) và lô GRN đã rút sau mốc đề xuất | **M7** (vế ngoại tuyến) | S5.3; S3.9 |

Ngoài S5: **khoản 9401** (`REVOKE` của ㉛) là việc của mã đang chạy, rổ đề xuất B — không chờ cổng (a).

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

**[S1.9102]** (D⑬ — §2.6 ㊹) Bốn dòng dưới TRÙNG dòng đã có — F1 lặp E6 (lịch sử PO xuất Excel/ERP), F5 lặp B6 (B6 đã hỏi *"hay
công ty đã có đăng nhập một lần (SSO)?"*), F6 lặp C4 (ngoại tệ ngoài đô), F7 lặp D1 (dữ liệu ngoài Việt Nam) — nên chúng KHÔNG mở
hàng mới: câu hỏi S5 chép vào E6, B6, C4, D1 tại chỗ. Bốn dòng còn lại vào tệp tiền đề thành nhóm F với số mới: F2 → **F1**,
F3 → **F2**, F4 → **F3**, F8 → **F4**. 33 → **37** tiền đề; ba chỗ đếm viết tay (`STATE.md:1092`, `:4551`, `Handoff.md:493`)
sửa ở vòng này.

| # | Tiền đề mã S5 sẽ cư xử như thật | Nằm ở đâu | Sai thì mất gì | Câu hỏi cho người mua thật |
|---|---|---|---|---|
| **F1** | Khách xuất được PR, PO, GRN, hoá đơn từ ERP ra bảng tính, hay ERP có API gọi ra ngoài được | §2.4 (b), §4.3 | S5.1–S5.3 không có đầu vào; chỉ S5.0 dùng được | *"Phần mềm kế toán/ERP của anh xuất được danh sách đơn mua và phiếu nhập kho ra Excel không? Có ai bên IT viết được một đoạn gọi API không?"* |
| **F2** | ERP ghi NGÀY NHẬN và SỐ LƯỢNG TỪ CHỐI theo từng dòng PO | §4.3 `erp_receipt_lines`, §4.6 *Quality*, *Delivery* | Hai thành phần mới của Supplier Score không có nguồn — Supplier Score lại hoãn | *"Khi hàng về, kho của anh ghi gì: chỉ số lượng nhận, hay cả số bị trả lại và lý do?"* |
| **F3** | ERP chấp nhận một PO có nguồn từ hệ ngoài (nhận tài liệu PO, hay ít nhất nhận *đề nghị PO* rồi tự tạo số PO) | §4.2, V2.1 §4 *ERP PO* | Bản xuất không có nơi đến; `so_po_erp` không bao giờ có | *"PO của anh tạo ở đâu — kế toán gõ tay từ bản duyệt, hay nhập từ tệp?"* |
| **F4** | Có một người ở khách giữ việc kết nối (trưởng phòng mua hàng hay IT) và người ấy không duyệt trao thầu **[S1.9102]** — và không chọn danh sách, không đề xuất, không nhập sổ nhà cung cấp cho gói mình mời (Q12) | §4.1 `integration.manage`, `supplier.import` | Vai cấu hình rơi vào người giữ `po.approve` — một người vừa đặt kênh ERP vừa duyệt trao; trigger `033` chặn, và tổ chức nhỏ kẹt (nhân lên từ B4) | *"Ai ở công ty anh sẽ cầm việc nối hai phần mềm? Người ấy có duyệt đơn mua không?"* |
| **F5** | Công ty đã có đăng nhập một lần (Microsoft 365 / Google Workspace) và chấp nhận vẫn gõ TOTP sau SSO | §4.7, Q4; tiền đề B6 | Q4 ⒜ không bớt được ma sát nào đáng kể; hay ⒝ phải mở | *"Nhân viên anh đăng nhập máy tính công ty bằng tài khoản Microsoft/Google không? Nếu vẫn phải gõ thêm mã TOTP thì có chấp nhận không?"* |
| **F6** | Đơn vị tiền ngoài `VND`/`USD` (nếu có) là một trong tám mã của Q5 | §4.8 | Một `CHECK` nữa phải nới — một migration nữa | *"Anh có mua bằng ngoại tệ nào ngoài đô — euro, yên, nhân dân tệ?"* (nối tiền đề C4) |
| **F7** | Khách chấp nhận hoá đơn và GRN (dữ liệu tài chính) rời ERP sang một SaaS có khoá ở Singapore | §8.10; tiền đề D1 | S5.3 không mở được cho khách ấy; ADR-009 bị lật | *"Số liệu hoá đơn mua hàng của anh có được phép đưa lên một dịch vụ đám mây đặt ngoài Việt Nam không?"* |
| **F8** | Mã vật tư trong ERP của khách ổn định và là một-một với hàng chuẩn | §2.5 ⑾, §4.5 | Bí danh hàng chuẩn đổi liên tục; hàng đợi S4.3 đầy | *"Một mặt hàng trong ERP của anh có một mã cố định không, hay mỗi lần nhập một mã?"* |

Dòng nào có TÊN NGƯỜI và NGÀY thì chuyển sang `docs/DECISIONS.md` đúng quy ước 2 của tệp tiền đề, không ở lại đây.

---

## 12. Về quy trình

Quyết định *"chuẩn bị trước spec S5"* là của chủ dự án ngày 2026-10-07. Viết spec trước cổng không phạm ADR-043 hay
ADR-093, vì hai ADR ấy chặn vòng MÃ — tiền lệ S1.138, S1.158, S1.160. Vòng này không chạm mảnh nào của `docs/PRODUCT.md`
§11, không chạy song song với hạng mục S3/S4 nào, không sửa `docs/TEST-PLAN.md` (nhóm M vào sổ ~~ở S5.0~~ **[S1.9102]** ở hạng mục ĐO được từng hàng — tiêu đề nhóm xuất hiện cùng hàng đầu, S5.1 (D⑭)),
không sửa `docs/TIEN-DE-CHUA-DO.md` (§11 chờ lượt soi). Thứ còn lại của vòng là một dòng ở `docs/PRODUCT.md` §7, một cột mốc ở
`docs/STATE.md`, và tài liệu này — `pnpm cap-so` cấp số thật cho **S1.9101** lúc merge **[S1.9102]** (câu này tự thiu sau
`cap-so` — đọc là *số tạm của vòng viết*; lượt soi mang số tạm **S1.9102**, **ADR-9201**, **khoản 9401**, cùng dải của ADR-090 — D⑭).

**Đọc lại khi lớp nền có mã.** Spec này viết trên bảng chưa tồn tại (S4.7c, S3.7, S3.8, S3.9, S4b.2) và trên một ERP không
tồn tại. Khi mỗi lớp nền vào `master`, hạng mục kế tiếp của S5 đọc lại đúng mục tương ứng (§9.1) trước khi viết mã, và ghi
kết quả vào biên bản của vòng ấy. Khi có tệp xuất THẬT đầu tiên của một khách, §4.3 và hình dạng `v1` đọc lại trọn.

**[S1.9102] Lượt soi hình dạng, 2026-10-08.** Chủ dự án: *"Chạy lượt soi hình dạng spec S5"*. Khuôn S1.139, S1.159, S1.161:
bốn góc độc lập (A lời khai đối chiếu mã, B khả thi cưỡng chế CSDL, C đối kháng, D phạm vi–thứ tự–kiểm thử–quy trình), 55 phát
hiện thô cộng 11 của lượt gộp, 36 sau khử trùng (7 CAO, 21 TRUNG, 8 THẤP); mười một lời khai đo trên lược đồ THẬT (mọi
migration + hardening) ở một cụm Postgres 16.15 cục bộ — biên bản `evidence/security-reviews.md` §S1.9102. Lượt soi để lại:
tài liệu này sửa tại chỗ (§2.3 Q4–Q6, Q10 sửa; Q11–Q13 mới; §2.6, §2.7, §4.10, §5.1, §8.13, §8.14, §9.2 mới; các chỗ gạch
mang nhãn); ADR-9201 (chốt từ tiền lệ); khoản 9401 — lỗ của mã đang chạy, không của spec; nhóm F ở `docs/TIEN-DE-CHUA-DO.md`
(bốn dòng, bốn dòng gộp vào E6, B6, C4, D1); một dòng ở `docs/PRODUCT.md` §7 và một cột mốc ở `docs/STATE.md`. **Không câu
nào trong mười ba câu được hỏi ở vòng này** (§2.7). Không mã, không migration, không sửa `docs/TEST-PLAN.md`.
