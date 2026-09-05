/**
 * Mã quyền dùng trong toàn hệ thống. Phải khớp NGUYÊN VĂN bảng `permissions` trong
 * db/migrations/005_identity.sql — có meta-test đọc cả hai và so sánh (khuôn §R3 đã dùng cho
 * thân `app_current_org_id()` và thân `noi_chuoi_kiem_toan()`).
 */
export const PERMISSIONS = {
  RFQ_CREATE: "rfq.create",
  RFQ_APPROVE: "rfq.approve",
  RFQ_INVITE: "rfq.invite",
  /**
   * [khoản nợ 31 — review an ninh S1.4 MED-2] Mở RFQ cho nhà cung cấp báo giá, và huỷ RFQ.
   *
   * HAI MÃ NÀY RA ĐỜI VÌ CÙNG MỘT KHIẾM KHUYẾT ĐO ĐƯỢC, và nó là bản sao chính xác của lớp lỗi
   * mà `ROLE_GRANT` bên dưới đã đặt tên: `openRfq` và `cancelRfq` xác lập *ai* và *tổ chức nào*
   * rồi làm việc, mà không hỏi *người ấy có được phép không* — và câu `requirePermission(...)`
   * lẽ ra phải gọi là câu **KHÔNG VIẾT ĐƯỢC**, vì danh mục này không có mã nào cho hai hành vi.
   *
   * Cái giá của khoảng trống ấy KHÔNG đối xứng, và vế nặng là vế HUỶ: `cancelRfq` thu hồi TOÀN
   * BỘ vật liệu khoá của RFQ (`rfq.ts` gọi `revokeRfqKeyMaterial`), 017 cấm bỏ dấu thu hồi, và
   * worker lọc `revoked_at IS NULL`. Tức một phiên hợp lệ BẤT KỲ của tổ chức — kể cả một vai
   * không có một quyền RFQ nào — làm cho báo giá của một RFQ **vĩnh viễn không mở được**, bằng
   * một lời gọi, và không có đường lùi.
   *
   * Khác `ROLE_GRANT` ở đúng một chỗ, và chỗ ấy đáng nói: `ROLE_GRANT` cố ý KHÔNG được gán cho
   * vai trò nào (fail-closed cho tới khi có màn hình quản trị). Hai mã này thì ĐƯỢC gán ngay ở
   * `023`, vì đường đi của chúng ĐÃ TỒN TẠI và đang chạy — để trống nghĩa là chặn cả đường hợp
   * pháp, tức đổi một lỗ hổng lấy một lần hỏng.
   */
  RFQ_OPEN: "rfq.open",
  RFQ_CANCEL: "rfq.cancel",
  /**
   * [khoản nợ 37] Gỡ khoá OTP của một lời mời.
   *
   * Khoá cấp-lời-mời của 012 là một phép sửa ĐÚNG cho một khiếm khuyết đã đo, nhưng nó để lại
   * một hệ quả không ai quyết định: ai cầm một link đã chuyển tiếp giữ được nhà cung cấp THẬT ở
   * ngoài cuộc thầu **vô hạn** — 5 lần sai, khoá 900 giây, lặp lại — và không hàm nào gỡ được.
   *
   * `BUYER` cũng giữ mã này, khác `rfq.open`/`rfq.cancel`: gỡ khoá không chạm vòng đời mật mã
   * của gói thầu, và người phát hiện một nhà cung cấp đang kêu "tôi không nhận được mã" chính là
   * người đang chạy vòng mời.
   */
  INVITATION_UNLOCK: "invitation.unlock",
  /**
   * [khoản nợ 26] Xoá vật liệu khoá ĐÃ THU HỒI của một RFQ đã huỷ.
   *
   * Đây là mã quyền duy nhất trong danh mục đứng sau một hành động **phá huỷ không đảo ngược
   * được**: sau nó, báo giá của gói thầu ấy không ai mở được nữa, kể cả chính chúng ta. Vì thế
   * nó KHÔNG đi kèm `rfq.cancel` — huỷ RFQ chỉ đặt một DẤU, còn mã này biến dấu ấy thành một sự
   * thật mật mã, và gộp hai thứ vào một lời gọi là biến một nút "huỷ" thành một nút "phá huỷ".
   *
   * Chỉ `PROCUREMENT_MANAGER`. `DIRECTOR` giữ `rfq.unseal.approve`; người phê duyệt việc MỞ
   * không nên đồng thời là người xoá được thứ cần mở — xem `026` mục (3).
   */
  RFQ_KEY_PURGE: "rfq.key.purge",
  RFQ_UNSEAL: "rfq.unseal",
  RFQ_UNSEAL_APPROVE: "rfq.unseal.approve",
  BID_VIEW: "bid.view",
  EVALUATION_PERFORM: "evaluation.perform",
  AWARD_RECOMMEND: "award.recommend",
  PO_APPROVE: "po.approve",
  SUPPLIER_MANAGE: "supplier.manage",
  AUDIT_READ: "audit.read",
  /**
   * [vòng fix 1 — A3] Gán và thu hồi vai trò cho người dùng trong tổ chức.
   *
   * Mã này tồn tại vì một khiếm khuyết ĐO ĐƯỢC chứ không phải để cho đủ bộ: trước nó, danh mục
   * PERMISSIONS KHÔNG có mã nào về quản trị vai trò, nên câu `requirePermission(...)` mà màn
   * hình gán vai trò phải gọi là câu KHÔNG VIẾT ĐƯỢC — trong khi 005_identity.sql vẫn cấp
   * `INSERT (org_id, user_id, role_code)` + `DELETE` trên `user_roles` cho app_api với lý do
   * "là việc của ứng dụng". Đo trên PostgreSQL 16.15 (xem [A3b] ở
   * db/migrations/005_identity.sql §(5) và test cùng nhãn ở rbac.int.test.ts):
   *     BUYER tự gán DIRECTOR -> 42501   (trigger D3 chặn — đối chứng, trigger không rỗng ruột)
   *     BUYER tự gán FINANCE  -> KHÔNG NÉM; quyền MỚI: po.approve, audit.read, bid.view
   *
   * CHƯA VAI TRÒ NÀO GIỮ MÃ NÀY, và đó là chủ ý fail-CLOSED: `hasPermission` trả `false` cho
   * mọi người dùng, nên một cổng gác viết bằng nó TỪ CHỐI TẤT CẢ cho tới khi một migration
   * đánh số MỚI quyết định vai trò nào được quản trị vai trò. Quyết định đó thuộc task dựng màn
   * hình quản trị người dùng, không thuộc S0 — nhưng TỪ VỰNG phải có trước, nếu không câu lệnh
   * kiểm quyền không viết được và "là việc của ứng dụng" là một lời hứa rỗng.
   */
  ROLE_GRANT: "role.grant",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Chuỗi năm bước của bất biến **D3** (docs/TEST-PLAN.md): *"Chuỗi tạo RFQ → chọn nhà cung cấp
 * → mở thầu → award → duyệt không nằm trọn trong tay một người (ma trận mục 25)"*.
 *
 * Đây KHÔNG phải một hằng số tiện dụng — nó là phát biểu máy-đọc-được của một bất biến, và nó
 * tồn tại ở BA nơi phải khớp nhau:
 *   1. đây;
 *   2. thân trigger `public.kiem_tra_phan_tach_nhiem_vu()` — db/migrations/005_identity.sql,
 *      cưỡng chế ở mức NGƯỜI DÙNG vào THỜI ĐIỂM GHI;
 *   3. mục (E2) của db/migrations/hardening.always.sql — phán xét ở mức VAI TRÒ vào THỜI ĐIỂM
 *      DEPLOY.
 * Ba bản khớp nhau là điều kiện để ba lớp nói về CÙNG MỘT bất biến; có meta-test khoá cả ba
 * (packages/identity/src/ma-tran-quyen.test.ts), vì một trong ba trôi đi là kiểu hỏng mà không
 * test hành vi nào bắt được.
 *
 * Thứ tự của mảng là thứ tự nghiệp vụ của chuỗi, không phải thứ tự bảng chữ cái — nó được đọc
 * bởi người, và thông báo lỗi của trigger nhắc lại đúng thứ tự này.
 */
export const SEPARATION_OF_DUTIES_CHAIN = [
  PERMISSIONS.RFQ_CREATE,
  PERMISSIONS.RFQ_INVITE,
  PERMISSIONS.RFQ_UNSEAL,
  PERMISSIONS.AWARD_RECOMMEND,
  PERMISSIONS.PO_APPROVE,
] as const satisfies readonly Permission[];

/**
 * [vòng fix 1 — C1] MỐC GHIM của trục thứ hai của D3: những CẶP vai trò mà HỢP của hai vai
 * trò ôm trọn `SEPARATION_OF_DUTIES_CHAIN`.
 *
 * ============================================================================
 * VÌ SAO HẰNG NÀY TỒN TẠI — MỘT KHE HỞ ĐO ĐƯỢC MÀ HAI TRIGGER KHÔNG THẤY
 * ============================================================================
 * Tập quyền HỢP của một người đổi theo HAI biến độc lập:
 *   (a) các hàng `user_roles` của người đó — trigger mức NGƯỜI DÙNG canh, ở thời điểm ghi;
 *   (b) ĐỊNH NGHĨA của các vai trò đó trong `role_permissions` — trigger mức VAI TRÒ chỉ hỏi
 *       "vai trò VỪA GHI có tự mình ôm trọn 5 bước không", KHÔNG BAO GIỜ hỏi "việc thêm quyền
 *       này có làm NGƯỜI NÀO đó ôm trọn chuỗi không".
 * Trục (b) hoàn toàn không được canh ở tầng CSDL. Hai phép đo độc lập trên PostgreSQL 16.15:
 *     [FO2] người giữ BUYER+FINANCE = 4/5 (hợp lệ hôm nay)
 *           INSERT role_permissions (FINANCE, 'rfq.unseal') -> KHÔNG NÉM
 *           sau đó người đó = 5/5; migrate() -> KHÔNG NÉM; vẫn 5/5
 *     [MR]  người giữ TECHNICAL+DIRECTOR = 3/5
 *           thêm rfq.create + rfq.invite cho TECHNICAL -> KHÔNG NÉM; người đó = 5/5
 * Cả hai đi qua ĐÚNG đường sửa mà 005 tuyên bố là an toàn: "một migration đánh số MỚI".
 *
 * ============================================================================
 * VÌ SAO LÀ MỘT MỐC GHIM CHỨ KHÔNG PHẢI MỘT QUY TẮC PHỔ QUÁT
 * ============================================================================
 * Quy tắc hấp dẫn "KHÔNG cặp vai trò nào được ôm trọn chuỗi" là quy tắc KHÔNG THOẢ ĐƯỢC ở
 * S0 — đã ĐO trên chính ma trận mục 25 bằng cách liệt kê cả 63 tổ hợp con khác rỗng của sáu
 * vai trò: 32 tổ hợp ôm trọn chuỗi, và tập tổ hợp TỐI TIỂU gồm ĐÚNG BA CẶP dưới đây (không có
 * bộ ba tối tiểu nào — mọi bộ ba ôm trọn đều CHỨA một trong ba cặp này). Giao của từng vai trò
 * với chuỗi:
 *     REQUESTER            rfq.create
 *     BUYER                rfq.create, rfq.invite, award.recommend
 *     TECHNICAL            (rỗng)
 *     PROCUREMENT_MANAGER  rfq.create, rfq.invite, rfq.unseal, award.recommend
 *     FINANCE              award.recommend, po.approve
 *     DIRECTOR             rfq.unseal, award.recommend, po.approve
 * PROCUREMENT_MANAGER+DIRECTOR ôm trọn chuỗi là điều CHÍNH 005 đã nói ra và CHÍNH trigger mức
 * người dùng sinh ra để chặn (đo đối chứng: gán cả hai cho một người -> 42501). Đòi "không cặp
 * nào ôm trọn" là đòi bỏ chính ca mà kiến trúc này được thiết kế để xử lý.
 *
 * Nên hằng này GHIM (QT2) thay vì NỚI: nó nói "hôm nay có ĐÚNG ba cặp phủ chuỗi". Một migration
 * mở rộng quyền của một vai trò theo hướng làm SINH RA CẶP THỨ TƯ sẽ làm meta-test đỏ ở CI,
 * buộc tác giả phải cập nhật danh sách này MỘT CÁCH CÓ Ý THỨC và cùng lúc rà những người đang
 * giữ sẵn cặp đó. Cả hai khai thác [FO2] và [MR] ở trên đều sinh ra một cặp mới, nên cả hai đều
 * bị chặn ở lớp này.
 *
 * GIỚI HẠN, nói ra thay vì hứa suông — ba cái, và không cái nào đóng được ở S0:
 *   1. Đây là quy tắc về CẶP. Một ma trận tương lai trong đó ba vai trò ôm trọn chuỗi mà không
 *      cặp con nào ôm trọn sẽ đi lọt. Hôm nay không có bộ ba tối tiểu nào nên phép ghim này
 *      chặt bằng phép ghim theo tổ hợp bất kỳ; ngày mai thì không nhất thiết.
 *   2. Nó là lớp TĨNH đọc VĂN BẢN migration. Một hàng chèn LÚC CHẠY (psql tay, một job) không
 *      đi qua văn bản nào — lớp thấy nó là mục (E3) của hardening.always.sql, và mục đó chỉ
 *      phát WARNING.
 *   3. Nó KHÔNG nói gì về việc AI đang giữ cặp nào. Trục "người" ở thời điểm sửa `role_permissions`
 *      không cưỡng chế được ở tầng CSDL — đã đo, xem khối dư lượng ở 005_identity.sql §(3).
 *
 * Bản thứ hai của danh sách này nằm trong `CAP_PHU_CHUOI` của db/migrations/hardening.always.sql;
 * meta-test khoá cả hai cùng với ma trận đọc từ văn bản 005 (khuôn §R3).
 */
export const CHAIN_COVERING_ROLE_PAIRS = [
  ["BUYER", "DIRECTOR"],
  ["FINANCE", "PROCUREMENT_MANAGER"],
  ["DIRECTOR", "PROCUREMENT_MANAGER"],
] as const satisfies readonly (readonly [string, string])[];
