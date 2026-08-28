import type pg from "pg";

interface HangGan {
  /** `IS TRUE` ở tầng SQL nên cột này KHÔNG BAO GIỜ NULL — ba trạng thái đã gộp về hai. */
  khop: boolean;
  dang_gan: string | null;
}

/**
 * [vòng fix 1 — IM3/M5] Khẳng định rằng PHIÊN hiện tại đang gắn đúng tổ chức mà người gọi định
 * kiểm/xuất. Ném nếu không.
 *
 * Vì sao đây là một khác biệt SINH TỬ chứ không phải một tiện nghi. Hai công cụ kiểm toán của
 * gói này đọc `audit_events` DƯỚI RLS, mà RLS lọc theo GUC `app.org_id` chứ không theo tham số
 * `orgId`. Nên trước bản vá này, cả hai TRẢ LỜI "KHÔNG CÓ VẤN ĐỀ" ở chỗ phải trả lời "KHÔNG
 * KIỂM ĐƯỢC". Đã đo, cả hai reviewer độc lập:
 *     số hàng THẬT của tổ chức P = 5
 *     verifyAuditChain(client gắn tenant Q, orgP) -> {"ok":true,"checked":0,"problems":[]}
 *     verifyAuditChain(client gắn tenant P, orgP) -> {"ok":false,"checked":5,...}
 *     GUC = 00000000-0000-0000-0000-000000000000, orgB -> {"ok":true,"checked":0}
 *     policy cắt đuôi (USING ... AND seq <= 3) trên sổ 6 hàng -> {"ok":true,"checked":3}
 * `exportChainHead` cùng lỗ, và ở đó hậu quả nặng hơn theo HAI chiều:
 *   (a) job xuất neo chạy sai tenant lặng lẽ KHÔNG XUẤT GÌ — và F-3 (cửa sổ giữa hai lần xuất
 *       neo) khi đó MỞ VÔ HẠN mà không ai biết;
 *   (b) [M5] dưới một policy CẮT ĐUÔI, nó xuất HEAD {"seq":3} trên một sổ 6 hàng — tức RỬA MỘT
 *       LẦN CẮT ĐUÔI THÀNH GỐC TIN CẬY nếu nơi cất neo GHI ĐÈ thay vì NỐI THÊM.
 *
 * Một round trip, câu lệnh ĐẦU TIÊN của cả hai hàm. Cố ý đặt trong SQL chứ không so sánh ở
 * tầng ứng dụng: `app_current_org_id()` là CHÍNH cái hàm mà mọi policy RLS gọi, nên phép so
 * này đo đúng thứ RLS sẽ dùng — không phải một biến song song có thể trôi khỏi nó.
 *
 * Vì sao KHÔNG dùng `=` trần: khi GUC chưa được đặt, `app_current_org_id()` trả NULL và
 * `NULL = $1` cho ra NULL, tức một `if (!khop)` ngây thơ vẫn ném — nhưng thông báo sẽ mất
 * thông tin "phiên chưa gắn tổ chức nào". Vế `dang_gan` giữ lại thông tin đó, và `IS TRUE`
 * biến ba trạng thái (true/false/NULL) về đúng hai nhánh mà người gọi cần.
 *
 * ============================================================================
 * [vòng fix 2 — MỤC A] `IS NOT DISTINCT FROM` LÀ MỘT HÀNG RÀO CƯỚP ĐƯỢC. ĐÃ ĐO.
 * ============================================================================
 * Bản trước viết `public.app_current_org_id() IS NOT DISTINCT FROM $1::uuid`, và vòng fix 1
 * còn viết THÀNH VĂN ở packages/identity/src/rbac.ts rằng hàm này "KHÔNG cần bản vá tương ứng"
 * vì `IS NOT DISTINCT FROM` "phân giải qua opclass mặc định của kiểu chứ không qua
 * `search_path`". CÂU ĐÓ SAI. PostgreSQL phân giải `IS [NOT] DISTINCT FROM` bằng cách TRA CỨU
 * TOÁN TỬ `=` THEO TÊN qua `search_path` (`make_distinct_op` gọi thẳng vào `make_op`), y hệt
 * một `=` trần. Đo lại trên PostgreSQL 16.15, đúng lược đồ của dự án, KHÔNG sửa gì khác:
 *     FIXTURE (tự chứng minh trước khi kết luận), search_path = doc, pg_catalog, public
 *       uuid IS NOT DISTINCT FROM     bị cướp = true
 *       uuid `=` trần                 bị cướp = true
 *       uuid OPERATOR(pg_catalog.=)   bị cướp = false
 *     proconfig của public.app_current_org_id() = null   (TRẠNG THÁI HÔM NAY)
 *     app_current_org_id() trong phiên gắn P            = <orgP>   (hàm vẫn ĐÚNG)
 *     assertTenantBound(phiên P, orgQ) -> QUA            <<< HÀNG RÀO BỊ VÔ HIỆU
 * Khai thác KHÔNG cần đụng tới `app_current_org_id()`: chỉ cướp toán tử của `uuid` và ĐỂ NGUYÊN
 * `text`, nên `NULLIF` bên trong hàm vẫn chạy đúng và lớp phòng thủ TÌNH CỜ mà vòng fix 1 mô tả
 * (hàm sập về NULL) KHÔNG kích hoạt.
 *
 * HẬU QUẢ ĐO ĐƯỢC, sổ của P có 3 hàng và sổ của Q có 7 hàng:
 *     verifyAuditChain(phiên của P, orgQ) -> ok=false checked=3   (sự thật: Q có 7 hàng)
 *     exportChainHead(phiên của P, orgQ)  -> {"orgId":<orgQ>, "seq":3, ...}
 * Tức `exportChainHead` ĐÚC MỘT MỐC NEO MANG NHÃN TỔ CHỨC Q TỪ SỔ CỦA TỔ CHỨC P. Nếu nơi cất
 * neo GHI ĐÈ thay vì NỐI THÊM, đó là "rửa một lần cắt đuôi thành gốc tin cậy" — NGUYÊN VĂN
 * kịch bản [M5] mà chính docblock này nói nó sinh ra để chặn.
 *
 * BẢN VÁ, VÀ VÌ SAO KHÔNG PHẢI BẢN VÁ ĐƯỢC KÊ ĐƠN. Reviewer kê
 * `pg_catalog.coalesce(<vế so>, false)`. Câu đó KHÔNG BIÊN DỊCH: `COALESCE` là một CẤU TRÚC NGỮ
 * PHÁP của SQL (`CoalesceExpr`), không phải một hàm trong `pg_catalog` — đo được,
 * `SELECT pg_catalog.coalesce(true, false)` cho `42883 function pg_catalog.coalesce(boolean,
 * boolean) does not exist`. Hệ quả tốt đi kèm: vì là cấu trúc ngữ pháp, `coalesce` TRẦN cũng
 * KHÔNG cướp được — đo được, với `doc.coalesce(boolean, boolean)` trả `true` nằm trước
 * `pg_catalog` trong `search_path`, `coalesce(false, true)` vẫn cho `false`. `IS TRUE`
 * (`BooleanTest`) cũng vậy, và nó không đi qua MỘT lần tra cứu tên nào cả — đó là lý do chọn
 * nó. Cả hai đều tái lập CHÍNH XÁC ngữ nghĩa cũ: GUC chưa gắn -> NULL -> false -> ném, và vế
 * `dang_gan` vẫn giữ thông tin "chưa gắn" (đo: `{"khop":false,"dang_gan":null}`).
 *
 * ============================================================================
 * [vòng fix 3 — MỤC 1] TRỤC TÊN KIỂU: `::pg_catalog.uuid` LÀ MỘT BẢN VÁ ĐO ĐƯỢC.
 * ============================================================================
 * CÂU CỦA VÒNG FIX 2, GIỮ NGUYÊN VĂN ĐỂ NGƯỜI ĐỌC SAU THẤY NÓ SAI Ở ĐÂU (đừng khôi phục):
 *   ┌ "TRỤC TÊN KIỂU — GHIM, KHÔNG PHẢI VÁ [...] trục tên kiểu KHÔNG cho ra dương tính giả
 *   │  trong cấu hình đo được; chỗ xấu nhất nó với tới được là một lỗi phân giải (`42883`),
 *   │  tức fail-CLOSED. Viết `::pg_catalog.uuid` ở đây là bỏ đi một bậc tự do theo QT2,
 *   └  KHÔNG phải sửa một lỗ đã đo."
 * CÂU ĐÓ SAI, VÀ NÓ SAI VÌ NÓ TỔNG QUÁT HOÁ TỪ MỘT MẪU. Vòng fix 2 đo đúng MỘT hình dạng
 * (`CREATE DOMAIN doc.uuid AS pg_catalog.uuid`) rồi kết luận cho CẢ trục. Đo lại NĂM hình dạng
 * trên PostgreSQL 16 (bốn cái đầu đúng là fail-closed, cái thứ năm KHÔNG):
 *     DOMAIN AS pg_catalog.uuid                          -> khớp = false      (fail-closed)
 *     DOMAIN ... CHECK (VALUE = app_current_org_id())    -> 23514             (fail-closed)
 *     DOMAIN AS pg_catalog.text + CREATE CAST            -> 42883             (fail-closed)
 *     TYPE ... AS (v text)  composite                    -> 22P02             (fail-closed)
 *     TYPE ... AS ENUM (<org đích>)
 *       + CREATE CAST (<gia>.uuid AS pg_catalog.uuid)
 *         WITH FUNCTION <gia>.ep AS IMPLICIT             -> LẬT ĐƯỢC PHÁN XÉT
 * Cơ chế của hình dạng thứ năm: `$1::uuid` trần phân giải thành KIỂU ENUM bóng, rồi
 * `OPERATOR(pg_catalog.=)` (đúng toán tử của `uuid`, KHÔNG bị cướp) phải ép vế phải về
 * `pg_catalog.uuid` — và phép ép đó chạy HÀM CỦA KẺ TẤN CÔNG, hàm này trả thẳng
 * `app_current_org_id()`. Hai vế thành ra bằng nhau với MỌI `$1`. ĐO ĐƯỢC, trên chính câu SQL
 * ở dưới, KHÔNG cướp một toán tử nào:
 *     `=` trần của uuid bị cướp        = false   <- không hề đụng tới toán tử
 *     tên kiểu TRẦN   (`$1::uuid`)     = true    <<< HÀNG RÀO BỊ VƯỢT
 *     tên kiểu GHIM   (`::pg_catalog.uuid`) = false
 * Tiền đề khai thác GIỐNG HỆT mô hình đe doạ mà dự án đã chấp nhận cho `CREATE OPERATOR`: cần
 * `CREATE` trên một schema nằm trên `search_path`. `CREATE CAST` chỉ đòi SỞ HỮU kiểu nguồn, mà
 * kẻ tấn công tự tạo ra kiểu đó. ENUM KHÔNG cần superuser (base type thì cần) — đã đo dưới một
 * role `LOGIN` không superuser, không `CREATEROLE`: `CREATE TYPE`/`CREATE CAST` đều thành công.
 * `app_current_org_id()` VẪN ĐÚNG suốt (thân hàm nó đã ghim `::pg_catalog.uuid` từ 001), nên
 * lớp phòng thủ TÌNH CỜ "hàm sập về NULL" lại KHÔNG kích hoạt ở đây nữa.
 *
 * ⇒ `::pg_catalog.uuid` ở câu dưới là VÁ MỘT LỖ ĐO ĐƯỢC, ngang hàng với `OPERATOR(pg_catalog.=)`,
 *   KHÔNG phải trang trí theo QT2. Ai bỏ `pg_catalog.` đi sẽ mở lại đúng kịch bản `[M5]`: đã tái
 *   lập end-to-end trên mã sản phẩm — gỡ ghim ở đây thì hàng rào KHÔNG ném, và gỡ thêm ở
 *   `exportChainHead` thì nó xuất `{"orgId":<orgQ>,"seq":3}` từ sổ 3 hàng của P.
 * Mốc chết: test `TRỤC TÊN KIỂU (2): ENUM + CAST IMPLICIT` trong `tenant-guard.int.test.ts` —
 * fixture ở đó TỰ CHỨNG MINH nó tấn công được trước khi kết luận bất cứ điều gì.
 *
 * DƯ LƯỢNG NÓI THẲNG: hôm nay KHÔNG lớp nào cưỡng chế quy ước này (không lint, không AST-check).
 * Chú thích + test là tất cả những gì đang giữ nó. Xem sổ nợ trong `task-8-report.md` §V3.5.
 *
 * `IS TRUE`: MỘT MŨI ĐỘT BIẾN TƯƠNG ĐƯƠNG, ghi ra thay vì để nó trông như một hàng rào. Gỡ
 * `IS TRUE` (giữ nguyên `OPERATOR(pg_catalog.=)`) SỐNG SÓT cả bộ test — đúng như phải thế:
 * `hang?.khop === true` ở dưới đã gộp `false` và `NULL` về cùng một nhánh ném. Nó ở đây vì lý
 * do KIỂU chứ không vì lý do an ninh: không có nó, `khop` là `boolean | null` và khai báo
 * `HangGan.khop: boolean` sẽ là một lời nói dối. Thứ CHỊU LỰC ở câu này là HAI thứ, không phải
 * một: `OPERATOR(pg_catalog.=)` (gỡ -> ba test [INV-F1] đỏ ngay) VÀ `::pg_catalog.uuid` (gỡ ->
 * test ENUM+CAST đỏ ngay). Vế `::pg_catalog.text` của `dang_gan` thì đúng là GHIM: nó chỉ vào
 * thông báo lỗi, không vào phán xét — nói đúng mức đó.
 */
export async function assertTenantBound(
  client: pg.PoolClient,
  orgId: string,
  tenHam: string,
): Promise<void> {
  const { rows } = await client.query<HangGan>(
    `SELECT (public.app_current_org_id()
             OPERATOR(pg_catalog.=) $1::pg_catalog.uuid) IS TRUE AS khop,
            public.app_current_org_id()::pg_catalog.text AS dang_gan`,
    [orgId],
  );

  const hang = rows[0];
  if (hang?.khop === true) return;

  throw new Error(
    `${tenHam}: phiên đang gắn tổ chức ${hang?.dang_gan ?? "(chưa gắn — app.org_id trống)"} ` +
      `nhưng được yêu cầu làm việc với ${orgId}. Mọi truy vấn sau đây sẽ chạy dưới RLS của tổ ` +
      "chức ĐANG GẮN, nên kết quả sẽ là 'không thấy gì' chứ không phải 'không có vấn đề'. " +
      "Gọi lại bên trong withTenant() của đúng tổ chức.",
  );
}
