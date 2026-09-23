// ==============================================================================================
// apps/mcp/src/cong-cu.ts — BẢNG CÔNG CỤ MCP. DỮ LIỆU THUẦN, KHÔNG IMPORT MỘT DÒNG MÃ NÀO CỦA api.
//
// Mỗi công cụ MCP là MỘT route ĐỌC của `apps/api`, và không gì khác. Bảng này không import
// `ROUTES` — lý do đo được nằm ở khối đầu `cong-cu.test.ts`, nơi hai bên được đối chiếu hai chiều.
//
// BA ĐIỀU BẢNG NÀY KHÔNG LÀM, nói ra để không ai đi tìm:
//   ⑴ không mang handler, không mang mã quyền — quyền là việc của `apps/api`, và MCP không được
//      phép có một bản sao thứ hai của nó (một cổng quyền chép sang đây là một cổng sẽ trôi);
//   ⑵ không mang route GHI. Không phải "chưa mang": ADR-038 chọn bề mặt CHỈ ĐỌC, và cổng đối
//      chiếu làm một công cụ ghi không viết được;
//   ⑶ không mang ~~bốn~~ ~~[S1.98] NĂM~~ ~~[S1.106] SÁU~~ ~~[S1.109] BẢY~~ [S1.110] TÁM route đọc ở `ROUTE_DOC_KHONG_PHOI`. Mỗi dòng ở đó
//      là một lần chủ dự án nói KHÔNG, không phải một việc chưa làm.
//
// Mặt tiền của MCP (tên công cụ, mô tả, tên tham số) bằng TIẾNG ANH — nó là giao thức, người đọc
// là một máy khách MCP bất kỳ. Chú thích và tên biến nội bộ bằng tiếng Việt, theo Handoff §14.
// ==============================================================================================

/** Một công cụ MCP: đúng một route ĐỌC của `apps/api`. */
export interface CongCuMcp {
  /** Tên công cụ trong giao thức MCP — `^[a-z][a-z0-9_]*$`. */
  readonly ten: string;
  readonly method: "GET";
  /** Mẫu đường dẫn của `apps/api`, nguyên văn, kể cả `:thamSo`. */
  readonly path: string;
  /** Mô tả gửi cho máy khách MCP. */
  readonly moTa: string;
  /** SUY từ `path` — không khai tay, nên không trôi được. */
  readonly thamSo: readonly string[];
  /**
   * Route CÔNG KHAI của `apps/api` (`audience: "PUBLIC"`) — không cần chứng chỉ nào.
   *
   * [lượt soi 69 L-6] Cờ này tồn tại để cookie phiên KHÔNG được gửi kèm những lời gọi không cần
   * nó. Một bí mật chỉ đi ra khi có lý do là một bí mật ít đường rò hơn. Cổng đối chiếu buộc cờ
   * này khớp `audience` của `ROUTES`, nên nó không tự khai sai được.
   */
  readonly congKhai: boolean;
}

/**
 * Tên tham số trong một mẫu đường dẫn: `/rfqs/:rfqId/items` → `["rfqId"]`.
 *
 * Hàm THUẦN và là nguồn DUY NHẤT của danh sách tham số: một công cụ không có cách nào khai một
 * tham số mà đường dẫn không có, hay quên một tham số mà đường dẫn đòi.
 */
export function thamSoCuaDuong(pDuong: string): string[] {
  return pDuong
    .split("/")
    .filter((doan) => doan.startsWith(":"))
    .map((doan) => doan.slice(1));
}

/**
 * Route ĐỌC của `apps/api` mà MCP CỐ Ý không phơi. Mỗi dòng là một quyết định của chủ dự án, và
 * lý do phải đọc được ở đây — cổng đối chiếu đòi cả hai (route có thật, lý do không rỗng).
 *
 * Danh sách này KHÔNG phải "chưa làm". Nó là chỗ một lần "tiện tay thêm vào" phải va vào một câu
 * đã viết sẵn.
 */
export const ROUTE_DOC_KHONG_PHOI: Readonly<Record<string, string>> = {
  "/rfqs/:rfqId/comparison":
    "BẢNG SO SÁNH GIÁ sau mở thầu — thứ toàn bộ sản phẩm sinh ra để bảo vệ. Một công cụ MCP đưa " +
    "nó vào ngữ cảnh của một agent là đưa giá của mọi nhà cung cấp ra một nơi chủ dự án không " +
    "kiểm soát được, và không lớp nào trong hệ thống lấy lại được. Chủ dự án chọn KHÔNG phơi " +
    "ngày 2026-09-17 (ADR-038). Cần đọc giá thì đọc bằng chính giao diện người mua, dưới phiên " +
    "có MFA của một con người.",
  "/rfqs/:rfqId/bid-count":
    "SỐ HỒ SƠ THẦU ĐÃ NHẬN — cùng rổ `HAM_DOC_CO_QUYEN` với bảng so sánh giá, và rổ ấy tồn tại " +
    "vì cả hai hàm có MỤC ĐÍCH DUY NHẤT là kiểm soát tiết lộ (`tests/architecture/" +
    "cong-quyen-route.test.ts` gọi thẳng con số này là nhạy cảm — A6). Số hồ sơ nhận được TRƯỚC " +
    "lễ mở là một tín hiệu cạnh tranh thật. Bản đầu của S1.74 có công cụ này; lượt soi 69 M-6 " +
    "hỏi vì sao hai hàm cùng rổ lại đi hai hướng, và chủ dự án rút nó ngày 2026-09-17 (ADR-038).",
  "/rfqs/:rfqId/ranking":
    "BẢNG XẾP HẠNG của lượt chấm mới nhất — và nó mang NHIỀU HƠN bảng so sánh giá ở ngay trên: " +
    "cạnh `effective_cost` của từng báo giá, nó mang cả cột `components`, tức từng con số đã quy " +
    "đổi sinh ra con số ấy. Nếu lập luận của ADR-038 đủ để rút bảng so sánh thì nó đủ mạnh hơn " +
    "cho đường này; không có quyết định MỚI nào ở đây, chỉ là cùng một quyết định áp lên một bề " +
    "mặt rộng hơn. Route khai `agent: false` và dòng này khai vì sao. [S1.106 / S2.4]",
  "/suppliers/:supplierId/contacts":
    "TÊN, EMAIL, ĐIỆN THOẠI của những con người cụ thể ở một công ty khác. Bản đầu của S1.74 phơi " +
    "nó kèm câu 'business data, not credentials' — đúng về CHỨNG CHỈ và sai về DỮ LIỆU CÁ NHÂN " +
    "(lượt soi 69 M-5). Chính lập luận dùng cho bảng giá áp nguyên ở đây: đã vào ngữ cảnh một " +
    "agent thì không lấy lại được. Chủ dự án rút ngày 2026-09-17 (ADR-038).",
  "/rfqs/:rfqId/invitations":
    "DANH SÁCH AI ĐƯỢC MỜI dự một gói thầu — biết đối thủ là ai đáng giá đúng bằng biết giá của " +
    "họ, và nó đáng giá SỚM HƠN: trước lễ mở, một nhà cung cấp biết mình đang đấu với ai thì " +
    "đoán được vùng giá mà không cần thấy một con số nào. Cùng lập luận với bảng so sánh giá và " +
    "danh bạ người liên hệ: đã vào ngữ cảnh một tác tử thì không lấy lại được. Route khai " +
    "`agent: false` và dòng này khai vì sao; cổng quyền của nó là `rfq.invite`, tức AI MỜI ĐƯỢC " +
    "THÌ XEM ĐƯỢC, không rộng hơn. Đường thu hồi một lời mời gửi nhầm là việc của con người ở " +
    "giao diện người mua, không phải của một tác tử. [S1.98 / khoản 125]",
  "/rfqs/:rfqId/unseal":
    "YÊU CẦU MỞ THẦU ĐANG MỞ của một gói thầu — đường TÌM ĐƯỢC mà S1.90 mở cho người duyệt thứ " +
    "hai (ADR-045 ⑵). Nó khác ba dòng trên ở chỗ thứ nó trả về KHÔNG phải dữ liệu nhạy cảm: " +
    "trạng thái một yêu cầu, hai con số đếm, không một mức giá nào. Cái nó mở là KHẢ NĂNG TÌM — " +
    "biến một id gói thầu, thứ tác tử liệt kê được, thành id của một yêu cầu mở thầu mà đường " +
    "`/unseal/:unsealRequestId` cố ý bắt phải biết trước. Một tác tử chỉ-đọc không có việc nào " +
    "cần khả năng ấy, nên route khai `agent: false` và dòng này khai vì sao. Ngày nào có việc " +
    "cần thì đổi một dòng và viết một ADR, chứ đừng đọc ngược ra từ sự im lặng hôm nay.",
  "/rfqs/:rfqId/bafo":
    "VÒNG BAFO của một gói thầu — số vòng, top-N, hạn nộp, ai mở. Nó KHÔNG mang một mức giá nào, " +
    "nên nó không rơi vào lập luận của ADR-038; thứ nó mang là `topN`, tức MẤY NGƯỜI qua được " +
    "vòng một, và thời điểm một cửa sổ nộp lại đang mở. Hai thứ ấy cộng lại là tín hiệu cạnh " +
    "tranh cùng hạng với `/rfqs/:rfqId/invitations`: biết có bao nhiêu người còn trong cuộc, và " +
    "biết chính xác khi nào cửa đóng, là đoán được vùng giá mà không cần thấy một con số nào. " +
    "Cùng lý do thứ hai với `/rfqs/:rfqId/unseal`: nó biến một id gói thầu thành id một vòng " +
    "BAFO. Route khai `agent: false` và dòng này khai vì sao. [S1.109 / S2.5]",
  "/rfqs/:rfqId/evidence-bundle":
    "BỘ BẰNG CHỨNG ĐÁNH GIÁ — mọi hàng của MỌI lượt chấm, mỗi hàng mang `effectiveCost` và từng " +
    "thành phần đã quy đổi, cộng mọi lần trao thầu kể cả lần đã huỷ. Nó là bề mặt RỘNG NHẤT của " +
    "cả hệ thống về giá: rộng hơn bảng xếp hạng (chỉ lượt mới nhất) và rộng hơn bảng so sánh. " +
    "Mọi lập luận của ADR-038 áp nguyên, mạnh hơn. Người cần nó là một kiểm toán viên CON NGƯỜI " +
    "giữ `audit.read` + `bid.view`, tải hai tệp về và kiểm NGOÀI hệ thống bằng " +
    "`pnpm bang-chung kiem`; không việc nào của một tác tử chỉ-đọc cần nó. [mảnh 1]",
  "/rfqs/:rfqId/award":
    "ĐỀ XUẤT TRAO THẦU của một gói thầu — AI THẮNG, cộng lý do người đề xuất viết ra, cộng " +
    "chữ ký của người duyệt. Nó không mang một mức giá nào, và đó chính là chỗ dễ đọc sai: " +
    "danh tính người thắng là KẾT LUẬN của mọi thứ ADR-038 rút khỏi bề mặt này. Bảng so sánh " +
    "và bảng xếp hạng là dữ liệu để suy ra nó; dòng này LÀ nó. Rút một bề mặt rộng rồi phơi " +
    "chính kết luận của nó là phơi cả hai. Cổng quyền của route là `bid.view`, tức AI XEM " +
    "ĐƯỢC GIÁ THÌ XEM ĐƯỢC KẾT QUẢ — không rộng hơn, và một chứng chỉ `AGENT_READONLY` không " +
    "phải một con người có MFA. Route khai `agent: false` và dòng này khai vì sao. " +
    "[S1.110 / S2.6]",
};

/** Bảng gốc: tên công cụ, đường dẫn, mô tả. `thamSo` được SUY ở dưới. */
const BANG: readonly {
  readonly ten: string;
  readonly path: string;
  readonly moTa: string;
  readonly congKhai?: true;
}[] = [
  {
    ten: "health",
    path: "/health",
    moTa: "Liveness probe of the TrustProcure API. Takes no arguments.",
    congKhai: true,
  },
  {
    ten: "me",
    path: "/me",
    moTa: "The buyer session behind the configured credential: organisation, user and session id.",
  },
  {
    ten: "list_suppliers",
    path: "/suppliers",
    moTa: "List suppliers of the caller's organisation.",
  },
  {
    ten: "get_supplier",
    path: "/suppliers/:supplierId",
    moTa: "One supplier of the caller's organisation, by id. Contact people are not included.",
  },
  {
    ten: "get_policy",
    path: "/policy",
    moTa: "Procurement policy of the organisation: approval thresholds and dual-approval rules.",
  },
  {
    ten: "get_rfq",
    path: "/rfqs/:rfqId",
    moTa: "One RFQ: state, deadline, budget visibility and metadata. Never bid prices.",
  },
  {
    ten: "list_rfq_items",
    path: "/rfqs/:rfqId/items",
    moTa: "Line items of one RFQ: what is being bought, in what quantity.",
  },
  {
    ten: "get_unseal_request",
    path: "/unseal/:unsealRequestId",
    moTa: "State of one unseal request: who asked, who approved, whether it has been dispatched.",
  },
];

/** Bảng công cụ MCP. `thamSo` suy từ `path` tại chỗ — không có bản chép thứ hai để trôi. */
export const CONG_CU: readonly CongCuMcp[] = BANG.map((d) => ({
  ten: d.ten,
  method: "GET" as const,
  path: d.path,
  moTa: d.moTa,
  thamSo: thamSoCuaDuong(d.path),
  congKhai: d.congKhai === true,
}));
