-- ==============================================================================================
-- 096_lich_su_gia — [S1.235 / S4.4a của spec S4] LỊCH SỬ GIÁ: BỘ ĐỌC DÒNG, VỊ TỪ "GIÁ ĐÃ LỘ", HÀM AS-OF
-- (spec S4 §4.5, §3.3, §2.5 ⑿ ⒀ ⒁ ㉓, §5.1 L5; ADR-095)
--
-- Chủ dự án chốt ngày 2026-09-30: S4.4 chia hai PR, S4.4a là CSDL (không route, không màn); tiền tệ chỉ so trong CHÍNH gói
-- của quan sát; `SAU_MOC` là số hàng nền MỚI HƠN bị bỏ qua vì ghi từ `p_moc` trở đi, `HOI_TO` là hàng nền ghi sau mốc của
-- chính gói chứa quan sát; lõi quy đổi tách theo mã. ADR-136.
--
-- (1) `quy_doi_da_giai(org, hàng chuẩn, mã từ, khoá từ, mã sang, khoá sang, mốc)` — THÂN của `quy_doi_don_vi` (`083`) tách ra
--     nhận hai đầu ĐÃ GIẢI: mã (NULL khi chuỗi không quy về mã nào) và khoá (mã, hoặc chuỗi đã làm sạch — đúng dạng
--     `item_uom_conversions.tu_don_vi` được lưu). `quy_doi_don_vi` nay chỉ giải hai chuỗi qua `don_vi_tai` rồi gọi lõi: hành vi
--     y nguyên, test S4.1/S4.2a canh. Lý do tách — đo trước: đích của một quan sát là MÃ `canonical_items.don_vi_goc`, và mã
--     không bao giờ được khớp trực tiếp (`079`): `don_vi_tai(org, 't', …)` ra NULL vì `t` (tấn) và `m` (mét) mơ hồ, không có bí
--     danh chung, nên quy đổi về gốc `t` luôn ra `KHONG_QUY_DOI_DUOC`; tệ hơn, một bí danh của tổ chức cho chuỗi `"t"` trỏ mã khác
--     sẽ giải SAI gốc của hàng chuẩn. Một luật quy đổi, một chỗ (§2.5 ⒄) — không phải bản cài thứ hai.
-- (2) `bid_dong_tho(payload)` — bộ đọc dòng của một phong bì đã mở. `IMMUTABLE`, KHÔNG BAO GIỜ `RAISE` (một hàm ném trong thân
--     làm cả lượt đọc ném, góc B⑦). Mỗi `lineNo` hợp lệ ra ĐÚNG MỘT hàng; các phần tử có `lineNo` hỏng gộp thành một hàng
--     `line_no` NULL. `ly_do`: NULL là đọc được và tổng khớp; `KHONG_DOC_DUOC` là dòng (hay cả báo giá) không đọc được — sáu ca
--     của `bid_so_tien` (`022:350`, đo lại ở biên bản: `1e131071`, `10000000000000000`, `1.001`, `-1`, `NaN`, `Infinity`, cùng
--     chuỗi không phải số) trên `amount` hay `totalAmount`, `lines` không phải mảng, phần tử không phải đối tượng, `lineNo` không
--     phải số nguyên dương kiểu số JSON, hai phần tử cùng `lineNo`; `LECH_TONG` là dòng đọc được nhưng Σ `amount` của mọi phần tử
--     KHÁC `totalAmount` — đúng phép so tổng, không luật làm tròn thứ hai (ADR-050 ⑴, khoản 218) — hay có phần tử anh em không đọc
--     được (tổng khi ấy không kiểm được). `unitPrice` không được đọc: đơn giá = `amount / quantity` (§2.5 ⒁).
--     KHÔNG có `SET search_path` — cố ý, theo tiền lệ `app_current_org_id` (`001`, hardening [fix round 5 — R3]): mệnh đề SET chặn
--     nội tuyến, và đo ở biên bản cho thấy gọi hàm này như một hàm riêng cho mỗi báo giá tốn ~0,25 ms mỗi lần — quá nửa thời gian
--     đọc lịch sử. Không có SET thì thân chạy dưới `search_path` của NGƯỜI GỌI, nên mọi hàm, toán tử, phép ép kiểu trong thân ghim
--     `pg_catalog.` đủ bốn trục QT3; bảng không có (thân không đọc bảng nào); `public.bid_so_tien` ghim schema. Mục ghim hardening
--     đòi `proconfig IS NULL` và đúng thân này.
-- (3) `gia_da_lo(org, gói, mốc)` — vị từ *"giá đã lộ"* theo DỮ LIỆU, tại mốc (§2.5 ⒀): gói chưa huỷ tại mốc; vòng một có
--     `unseal_requests` `EXECUTED` trước mốc; mọi vòng BAFO MỞ trước mốc cũng vậy. Không đọc `status`: `AWARDED` được tính, gói
--     `BAFO_OPEN`/`BAFO_CLOSED` thì không (phong bì vòng hai chưa vào `rfq_unsealed_bids`, `unseal-worker/src/index.ts:518-541`),
--     `CANCELLED` bị loại từ lúc huỷ.
-- (4) `quan_sat_gia(p_moc, p_hang_chuan)` — hàm as-of, `SECURITY INVOKER STABLE` (§4.5, §2.5 ⑿). Mỗi hàng một (gói, nhà cung
--     cấp, dòng của gói) cho gói mà `gia_da_lo` tại `p_moc`; báo giá là vị thế CUỐI của NHÀ CUNG CẤP — phiên bản nộp muộn nhất
--     trong những phiên bản đã mở niêm phong trước mốc, xét trên MỌI lời mời của nhà cung cấp ấy trong gói (spec §5.1 L5: *"vị thế
--     cuối của một nhà cung cấp"*). Khác luật `DISTINCT ON (v.bid_id)` của bảng so sánh, lượt chấm và worker ở đúng một ca: nhà
--     cung cấp bị thu hồi lời mời rồi được mời lại có HAI báo giá — lượt soi đo được hai quan sát `HOP_LE` cho một người, tức một
--     cần gạt nhân đôi trọng số trong trung vị. Hàng nền là hàng mới nhất theo `seq` trong những hàng ghi TRƯỚC `p_moc`: ánh xạ hiệu lực của
--     dòng (băm bằng băm hiện tại, `089`), bí danh đơn vị (qua `don_vi_tai`), quy đổi riêng (qua lõi (1)). Ngày quan sát là mốc
--     mở giá của gói — `min(unsealed_at)` (§3.3). Tiền tệ đọc QUA `bid_currency` (`070`) và so với tiền tệ của chính sách của
--     CHÍNH gói ấy — chính sách ngân sách ghim, không có thì phiên bản hiệu lực lúc gói ra đời: đúng hai nhánh của
--     `rfq_che_do_nghiem` (`069`). So với gói X đang xét là việc của S4.5.
--     Trạng thái, một mỗi hàng, theo thứ tự ưu tiên: `KHONG_DOC_DUOC` (kể cả dòng báo giá bỏ trống, và mọi dòng của báo giá mang
--     một `lineNo` không có trong gói) · `LECH_TONG` · `LECH_TIEN_TE` · `CHUA_ANH_XA` (không hàng ánh xạ hiệu lực, hoặc ánh xạ
--     tường minh sang NULL — `anh_xa_id` phân biệt hai ca) · `KHONG_QUY_DOI_DUOC` · `HOP_LE`. `don_gia_quy_doi` chỉ có ở `HOP_LE`:
--     bộ đọc quên lọc trạng thái không lấy được một đơn giá không đo được.
--     Hai nhãn SUY RA, không lưu (§3.3 ⑴, ADR-017), trên bốn loại hàng nền — `ANH_XA` (các hàng ánh xạ của dòng), `BI_DANH_DON_VI`
--     (các hàng `uom_aliases` của chuỗi đơn vị của dòng), `QUY_DOI` (các hàng quy đổi riêng của hàng chuẩn, chỉ khi kết quả không
--     phải `CUNG_DON_VI`/`QUY_DOI_CHUNG` — hai kết quả ấy không đọc cạnh riêng nào), `PHIEN_BAN_HANG_CHUAN` (các phiên bản của hàng
--     chuẩn — thuộc tính đổi là nghĩa của hàng đổi):
--       `hoi_to text[]`  — loại có hàng ghi trong [mốc của gói, `p_moc`): hàng nền đã dùng được ghi SAU khi giá của chính gói ấy lộ.
--       `sau_moc jsonb`  — số hàng mỗi loại ghi từ `p_moc` trở đi: hàng mới hơn mà lần đọc tại mốc đã BỎ QUA.
--     Nhãn đếm theo KHOẢNG `ghi_luc` trên cùng không gian khoá mà lần đọc tại mốc dùng, không chép luật *"hàng nào được chọn"* của
--     `don_vi_tai` hay của lõi quy đổi: `seq` và `ghi_luc` cùng đặt dưới một khoá (`079`), nên hàng được chọn là hàng có `ghi_luc`
--     lớn nhất trước mốc, và *"có hàng trong khoảng"* bao trọn *"hàng được chọn nằm trong khoảng"* — thận trọng, không sót.
--     `p_hang_chuan` NULL: mọi dòng. Khác NULL: chỉ dòng mà ánh xạ hiệu lực tại mốc trỏ hàng chuẩn ấy. Hai nhánh gác bằng điều kiện
--     CHỈ trên tham số: hàm SQL không nội tuyến được (có `SET search_path`) chạy bằng kế hoạch chung, và kế hoạch ấy bỏ nhánh kia
--     lúc chạy — đường đọc lịch sử một hàng chuẩn không phân tích mọi phong bì của tổ chức (ngưỡng §2.5 ㉓, đo ở biên bản).
--     Hình dạng vì phép đo (biên bản §S1.235 §6): mỗi bước tính đúng một lần theo khoá của nó — ánh xạ và nhãn theo dòng, đơn vị
--     theo (tổ chức, chuỗi), quy đổi theo (hàng chuẩn, chuỗi), báo giá theo dòng qua chỉ mục; `bid_dong_tho` nội tuyến vào truy vấn
--     con của mỗi báo giá; `enable_hashagg = off` là tham số CỦA RIÊNG hàm này — kế hoạch chung đoán mỗi phong bì 100 phần tử, chọn
--     `HashAggregate` và dựng lại bảng băm ở mỗi báo giá, trong khi một phong bì có vài chục dòng. Đọc HẾT tổ chức (`p_hang_chuan`
--     NULL) phân tích lại một phong bì cho mỗi dòng của gói — không route nào đi đường ấy.
--     Vị từ trong thân là *"một luật một chỗ"*, KHÔNG phải ranh giới (§4.5 [S1.159]): `app_api` có `SELECT` mức bảng trên
--     `rfq_unsealed_bids` (`019:459`). Ranh giới là test kiến trúc liệt kê mọi tệp đọc bảng ấy. Phiên khách và phiên Passport ra
--     0 hàng vì policy `_khach` của `rfq_unsealed_bids` áp theo NGƯỜI GỌI (`SECURITY INVOKER`).
-- (5) Bảy chỉ mục cho các đường tra của (3) và (4).
--
-- Mọi hàm mới và thân mới ghim ở `hardening.always.sql` trong CÙNG commit (S1.96).
-- ==============================================================================================

-- ============================================================================================
-- (1) LÕI QUY ĐỔI THEO MÃ — `quy_doi_don_vi` GỌI NÓ
-- ============================================================================================
-- Thân là thân `083` với CTE `u` đọc hai đầu đã giải thay vì tự giải. Mã không có trong danh mục ra NULL (LEFT JOIN), nên một
-- bên gọi truyền mã lạ rơi về nhánh cạnh riêng theo khoá, không thành `CUNG_DON_VI`.
CREATE OR REPLACE FUNCTION public.quy_doi_da_giai(
  p_org uuid, p_hang_chuan uuid, p_tu text, p_khoa_tu text, p_sang text, p_khoa_sang text, p_moc timestamptz)
  RETURNS TABLE (he_so numeric, ma text)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  WITH u AS (
    SELECT a.code AS tu, b.code AS sang,
           p_khoa_tu AS khoa_tu,
           p_khoa_sang AS khoa_sang,
           a.thu_nguyen AS tn_tu, a.he_so_ve_goc AS hs_tu,
           b.thu_nguyen AS tn_sang, b.he_so_ve_goc AS hs_sang
      FROM (SELECT 1) d
      LEFT JOIN public.uom_units a ON a.code = p_tu
      LEFT JOIN public.uom_units b ON b.code = p_sang
  ),
  canh AS (
    SELECT DISTINCT ON (c.tu_don_vi, c.sang_don_vi) c.tu_don_vi, c.sang_don_vi, c.he_so, c.rut
      FROM public.item_uom_conversions c
     WHERE c.org_id = p_org
       AND c.canonical_item_id = p_hang_chuan
       AND c.ghi_luc < p_moc
     ORDER BY c.tu_don_vi, c.sang_don_vi, c.seq DESC
  ),
  ung_vien AS (
    SELECT (CASE WHEN c.tu_don_vi = u.khoa_tu THEN 1::numeric ELSE u.hs_tu / t.he_so_ve_goc END)
             * c.he_so * (s.he_so_ve_goc / u.hs_sang) AS he_so
      FROM u
      JOIN canh c ON NOT c.rut
      JOIN public.uom_units s ON s.code = c.sang_don_vi
      LEFT JOIN public.uom_units t ON t.code = c.tu_don_vi
     WHERE s.thu_nguyen = u.tn_sang
       AND (c.tu_don_vi = u.khoa_tu OR t.thu_nguyen = u.tn_tu)
    UNION ALL
    SELECT (u.hs_tu / s.he_so_ve_goc) / c.he_so
             * (CASE WHEN c.tu_don_vi = u.khoa_sang THEN 1::numeric ELSE t.he_so_ve_goc / u.hs_sang END)
      FROM u
      JOIN canh c ON NOT c.rut
      JOIN public.uom_units s ON s.code = c.sang_don_vi
      LEFT JOIN public.uom_units t ON t.code = c.tu_don_vi
     WHERE s.thu_nguyen = u.tn_tu
       AND (c.tu_don_vi = u.khoa_sang OR t.thu_nguyen = u.tn_sang)
  )
  SELECT CASE WHEN u.tu = u.sang THEN 1::numeric
              WHEN u.tn_tu = u.tn_sang THEN u.hs_tu / u.hs_sang
              WHEN (SELECT count(*) FROM ung_vien) = 1 THEN (SELECT v.he_so FROM ung_vien v)
              ELSE NULL END,
         CASE WHEN u.tu = u.sang THEN 'CUNG_DON_VI'
              WHEN u.tn_tu = u.tn_sang THEN 'QUY_DOI_CHUNG'
              WHEN (SELECT count(*) FROM ung_vien) = 1 THEN 'QUY_DOI_RIENG'
              ELSE 'KHONG_QUY_DOI_DUOC' END
    FROM u
$ham$;

-- Thân `083` khi ấy: giải hai chuỗi TẠI MỐC, khoá là mã hoặc chuỗi đã làm sạch — nay chuyển nguyên cho lõi.
CREATE OR REPLACE FUNCTION public.quy_doi_don_vi(
  p_org uuid, p_hang_chuan uuid, p_tu text, p_sang text, p_moc timestamptz)
  RETURNS TABLE (he_so numeric, ma text)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT k.he_so, k.ma
    FROM (SELECT public.don_vi_tai(p_org, p_tu, p_moc) AS tu,
                 public.don_vi_tai(p_org, p_sang, p_moc) AS sang) d
   CROSS JOIN LATERAL public.quy_doi_da_giai(p_org, p_hang_chuan,
                                             d.tu, coalesce(d.tu, public.chuoi_sach(p_tu)),
                                             d.sang, coalesce(d.sang, public.chuoi_sach(p_sang)),
                                             p_moc) k
$ham$;

-- ============================================================================================
-- (2) BỘ ĐỌC DÒNG CỦA MỘT PHONG BÌ ĐÃ MỞ
-- ============================================================================================
-- `->>` trên một giá trị JSON không phải đối tượng ra NULL, không ném; `jsonb_array_elements` chỉ được gọi trên một mảng.
-- Phép ép `::integer` nằm sau `THEN` của một điều kiện đã khớp khuôn tối đa chín chữ số, nên không tràn.
CREATE OR REPLACE FUNCTION public.bid_dong_tho(p_payload jsonb)
  RETURNS TABLE (line_no integer, thanh_tien numeric, ly_do text)
  LANGUAGE sql
  IMMUTABLE
AS $ham$
  SELECT g.so_dong,
         CASE WHEN g.n OPERATOR(pg_catalog.=) 1 THEN g.tien END,
         CASE WHEN g.tong IS NULL OR g.so_dong IS NULL
                   OR g.n OPERATOR(pg_catalog.<>) 1 OR g.n_tien OPERATOR(pg_catalog.<>) 1 THEN 'KHONG_DOC_DUOC'
              WHEN NOT g.sach OR coalesce(g.tong_dong OPERATOR(pg_catalog.<>) g.tong, true) THEN 'LECH_TONG'
              ELSE NULL END
    FROM (SELECT x.so_dong,
                 pg_catalog.count(*) AS n,
                 pg_catalog.count(x.tien) AS n_tien,
                 pg_catalog.max(x.tien) AS tien,
                 pg_catalog.bool_and(x.so_dong IS NOT NULL
                                     AND pg_catalog.count(*) OPERATOR(pg_catalog.=) 1
                                     AND pg_catalog.count(x.tien) OPERATOR(pg_catalog.=) 1) OVER () AS sach,
                 pg_catalog.sum(pg_catalog.max(x.tien)) OVER () AS tong_dong,
                 (SELECT public.bid_so_tien(p_payload OPERATOR(pg_catalog.->>) 'totalAmount')) AS tong
            FROM (SELECT CASE WHEN pg_catalog.jsonb_typeof(e) OPERATOR(pg_catalog.=) 'object'
                               AND pg_catalog.jsonb_typeof(e OPERATOR(pg_catalog.->) 'lineNo') OPERATOR(pg_catalog.=) 'number'
                               AND (e OPERATOR(pg_catalog.->>) 'lineNo') OPERATOR(pg_catalog.~) '^[1-9][0-9]{0,8}$'
                              THEN (e OPERATOR(pg_catalog.->>) 'lineNo')::pg_catalog.int4 END AS so_dong,
                         CASE WHEN pg_catalog.jsonb_typeof(e) OPERATOR(pg_catalog.=) 'object'
                              THEN public.bid_so_tien(e OPERATOR(pg_catalog.->>) 'amount') END AS tien
                    FROM pg_catalog.jsonb_array_elements(
                           CASE WHEN pg_catalog.jsonb_typeof(p_payload OPERATOR(pg_catalog.->) 'lines') OPERATOR(pg_catalog.=) 'array'
                                THEN p_payload OPERATOR(pg_catalog.->) 'lines'
                                ELSE '[]'::pg_catalog.jsonb END) e) x
           GROUP BY x.so_dong) g
  UNION ALL
  SELECT NULL::pg_catalog.int4, NULL::pg_catalog.numeric, 'KHONG_DOC_DUOC'
   WHERE NOT coalesce(pg_catalog.jsonb_typeof(p_payload OPERATOR(pg_catalog.->) 'lines') OPERATOR(pg_catalog.=) 'array', false)
$ham$;

-- ============================================================================================
-- (3) "GIÁ ĐÃ LỘ" TẠI MỐC
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.gia_da_lo(p_org uuid, p_rfq uuid, p_moc timestamptz) RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT EXISTS (
    SELECT 1
      FROM public.rfq_packages r
     WHERE r.org_id = p_org
       AND r.id = p_rfq
       AND (r.cancelled_at IS NULL OR r.cancelled_at >= p_moc)
       AND EXISTS (SELECT 1
                     FROM public.unseal_requests q
                    WHERE q.org_id = r.org_id
                      AND q.rfq_id = r.id
                      AND q.bafo_round_id IS NULL
                      AND q.status = 'EXECUTED'
                      AND q.executed_at < p_moc)
       AND NOT EXISTS (SELECT 1
                         FROM public.rfq_bafo_rounds v
                        WHERE v.org_id = r.org_id
                          AND v.rfq_id = r.id
                          AND v.opened_at < p_moc
                          AND NOT EXISTS (SELECT 1
                                            FROM public.unseal_requests q
                                           WHERE q.org_id = v.org_id
                                             AND q.rfq_id = v.rfq_id
                                             AND q.bafo_round_id = v.id
                                             AND q.status = 'EXECUTED'
                                             AND q.executed_at < p_moc)))
$ham$;

-- ============================================================================================
-- (4) QUAN SÁT GIÁ TẠI MỐC
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.quan_sat_gia(p_moc timestamptz, p_hang_chuan uuid DEFAULT NULL)
  RETURNS TABLE (rfq_id uuid, supplier_id uuid, bid_version_id uuid, line_no integer, ngay_quan_sat timestamptz,
                 anh_xa_id uuid, canonical_item_id uuid, thanh_tien numeric, so_luong numeric, don_vi text,
                 don_gia numeric, don_vi_goc text, he_so numeric, don_gia_quy_doi numeric, tien_te text,
                 trang_thai text, hoi_to text[], sau_moc jsonb)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
  SET enable_hashagg = off
AS $ham$
  WITH dong AS (
    SELECT i.org_id, i.rfq_id, i.line_no, i.quantity, i.unit
      FROM public.rfq_items i
     WHERE p_hang_chuan IS NULL
    UNION ALL
    SELECT i.org_id, i.rfq_id, i.line_no, i.quantity, i.unit
      FROM (SELECT DISTINCT m.org_id, m.rfq_id, m.line_no
              FROM public.rfq_item_mappings m
             WHERE p_hang_chuan IS NOT NULL
               AND m.canonical_item_id = p_hang_chuan
               AND m.ghi_luc < p_moc) c
      JOIN public.rfq_items i ON i.org_id = c.org_id AND i.rfq_id = c.rfq_id AND i.line_no = c.line_no
  ),
  goi AS MATERIALIZED (
    SELECT x.org_id, x.rfq_id, g.moc_goi, g.tien_te_goi, g.cac_dong
      FROM (SELECT DISTINCT d.org_id, d.rfq_id FROM dong d) x
     CROSS JOIN LATERAL (
       SELECT (SELECT min(u.unsealed_at)
                 FROM public.unseal_requests q
                 JOIN public.rfq_unsealed_bids u ON u.org_id = q.org_id AND u.unseal_request_id = q.id
                WHERE q.org_id = x.org_id AND q.rfq_id = x.rfq_id AND u.unsealed_at < p_moc) AS moc_goi,
              coalesce(
                (SELECT cs.currency
                   FROM public.rfq_budgets b
                   JOIN public.org_procurement_policies cs ON cs.id = b.policy_id AND cs.org_id = b.org_id
                  WHERE b.org_id = x.org_id AND b.rfq_id = x.rfq_id),
                (SELECT cs.currency
                   FROM public.rfq_packages r
                   JOIN public.org_procurement_policies cs ON cs.org_id = r.org_id
                  WHERE r.org_id = x.org_id AND r.id = x.rfq_id
                    AND cs.id = public.chinh_sach_hieu_luc(r.org_id, r.created_at))) AS tien_te_goi,
              (SELECT array_agg(i.line_no)
                 FROM public.rfq_items i
                WHERE i.org_id = x.org_id AND i.rfq_id = x.rfq_id) AS cac_dong
     ) g
     WHERE public.gia_da_lo(x.org_id, x.rfq_id, p_moc)
       AND g.moc_goi IS NOT NULL
  ),
  dong_goi AS MATERIALIZED (
    SELECT d.org_id, d.rfq_id, d.line_no, d.quantity, d.unit, g.moc_goi, g.tien_te_goi, g.cac_dong,
           ax.id AS anh_xa_id, ax.canonical_item_id
      FROM dong d
      JOIN goi g ON g.org_id = d.org_id AND g.rfq_id = d.rfq_id
      LEFT JOIN LATERAL (
        SELECT m.id, m.canonical_item_id
          FROM public.rfq_item_mappings m
         WHERE m.org_id = d.org_id AND m.rfq_id = d.rfq_id AND m.line_no = d.line_no
           AND m.ghi_luc < p_moc
           AND m.hang_muc_bam = public.rfq_hang_muc_bam(d.org_id, d.rfq_id, d.line_no)
         ORDER BY m.seq DESC
         LIMIT 1
      ) ax ON true
     WHERE p_hang_chuan IS NULL OR ax.canonical_item_id = p_hang_chuan
  ),
  don_vi AS MATERIALIZED (
    SELECT k.org_id, k.unit, public.don_vi_tai(k.org_id, k.unit, p_moc) AS ma, public.chuoi_sach(k.unit) AS khoa
      FROM (SELECT DISTINCT dg.org_id, dg.unit FROM dong_goi dg) k
  ),
  quy_doi AS MATERIALIZED (
    SELECT k.org_id, k.canonical_item_id, k.unit, ci.don_vi_goc, r.he_so, r.ma
      FROM (SELECT DISTINCT dg.org_id, dg.canonical_item_id, dg.unit FROM dong_goi dg WHERE dg.canonical_item_id IS NOT NULL) k
      JOIN public.canonical_items ci ON ci.org_id = k.org_id AND ci.id = k.canonical_item_id
      JOIN don_vi dv ON dv.org_id = k.org_id AND dv.unit = k.unit
     CROSS JOIN LATERAL public.quy_doi_da_giai(k.org_id, k.canonical_item_id, dv.ma, coalesce(dv.ma, dv.khoa),
                                               ci.don_vi_goc, ci.don_vi_goc, p_moc) r
  ),
  dong_nhan AS MATERIALIZED (
    SELECT dg.org_id, dg.rfq_id, dg.line_no, dg.quantity, dg.unit, dg.moc_goi, dg.tien_te_goi, dg.cac_dong,
           dg.anh_xa_id, dg.canonical_item_id,
           qd.don_vi_goc, qd.he_so,
           n.anh_xa_hoi_to, n.anh_xa_sau, b.bi_danh_hoi_to, b.bi_danh_sau,
           c.quy_doi_hoi_to, c.quy_doi_sau, v.phien_ban_hoi_to, v.phien_ban_sau
      FROM dong_goi dg
      JOIN don_vi dv ON dv.org_id = dg.org_id AND dv.unit = dg.unit
      LEFT JOIN quy_doi qd ON qd.org_id = dg.org_id AND qd.canonical_item_id = dg.canonical_item_id AND qd.unit = dg.unit
     CROSS JOIN LATERAL (
       SELECT count(*) FILTER (WHERE m.ghi_luc >= dg.moc_goi AND m.ghi_luc < p_moc) AS anh_xa_hoi_to,
              count(*) FILTER (WHERE m.ghi_luc >= p_moc) AS anh_xa_sau
         FROM public.rfq_item_mappings m
        WHERE m.org_id = dg.org_id AND m.rfq_id = dg.rfq_id AND m.line_no = dg.line_no
     ) n
     CROSS JOIN LATERAL (
       SELECT count(*) FILTER (WHERE a.ghi_luc >= dg.moc_goi AND a.ghi_luc < p_moc) AS bi_danh_hoi_to,
              count(*) FILTER (WHERE a.ghi_luc >= p_moc) AS bi_danh_sau
         FROM public.uom_aliases a
        WHERE a.org_id = dg.org_id AND a.bi_danh_sach = dv.khoa
     ) b
     CROSS JOIN LATERAL (
       SELECT count(*) FILTER (WHERE q.ghi_luc >= dg.moc_goi AND q.ghi_luc < p_moc) AS quy_doi_hoi_to,
              count(*) FILTER (WHERE q.ghi_luc >= p_moc) AS quy_doi_sau
         FROM public.item_uom_conversions q
        WHERE q.org_id = dg.org_id AND q.canonical_item_id = dg.canonical_item_id
          AND qd.ma NOT IN ('CUNG_DON_VI', 'QUY_DOI_CHUNG')
     ) c
     CROSS JOIN LATERAL (
       SELECT count(*) FILTER (WHERE p.ghi_luc >= dg.moc_goi AND p.ghi_luc < p_moc) AS phien_ban_hoi_to,
              count(*) FILTER (WHERE p.ghi_luc >= p_moc) AS phien_ban_sau
         FROM public.canonical_item_versions p
        WHERE p.org_id = dg.org_id AND p.canonical_item_id = dg.canonical_item_id
     ) v
  ),
  ket_qua AS (
    SELECT dg.rfq_id, f.supplier_id, f.bid_version_id, dg.line_no, dg.moc_goi,
           dg.anh_xa_id, dg.canonical_item_id, t.thanh_tien, dg.quantity, dg.unit,
           dg.don_vi_goc, dg.he_so, f.tien_te,
           CASE WHEN t.co_dong = 0 OR t.ly_do = 'KHONG_DOC_DUOC' OR t.ngoai_goi THEN 'KHONG_DOC_DUOC'
                WHEN t.ly_do = 'LECH_TONG' THEN 'LECH_TONG'
                WHEN f.tien_te IS NULL OR dg.tien_te_goi IS NULL OR f.tien_te <> dg.tien_te_goi THEN 'LECH_TIEN_TE'
                WHEN dg.canonical_item_id IS NULL THEN 'CHUA_ANH_XA'
                WHEN dg.he_so IS NULL THEN 'KHONG_QUY_DOI_DUOC'
                ELSE 'HOP_LE' END AS trang_thai,
           dg.anh_xa_hoi_to, dg.anh_xa_sau, dg.bi_danh_hoi_to, dg.bi_danh_sau,
           dg.quy_doi_hoi_to, dg.quy_doi_sau, dg.phien_ban_hoi_to, dg.phien_ban_sau
      FROM dong_nhan dg
     CROSS JOIN LATERAL (
       SELECT DISTINCT ON (i.supplier_id) v.id AS bid_version_id, i.supplier_id, u.payload,
              public.bid_currency((u.payload ->> 'currency')) AS tien_te
         FROM public.rfq_invitations i
         JOIN public.vendor_bids b ON b.org_id = i.org_id AND b.invitation_id = i.id
         JOIN public.vendor_bid_versions v ON v.org_id = b.org_id AND v.bid_id = b.id
         JOIN public.rfq_unsealed_bids u ON u.org_id = v.org_id AND u.bid_version_id = v.id
        WHERE i.org_id = dg.org_id AND i.rfq_id = dg.rfq_id
          AND u.unsealed_at < p_moc
        ORDER BY i.supplier_id, v.submitted_at DESC, v.version DESC
     ) f
     CROSS JOIN LATERAL (
       SELECT count(*) FILTER (WHERE r.line_no = dg.line_no) AS co_dong,
              max(r.thanh_tien) FILTER (WHERE r.line_no = dg.line_no) AS thanh_tien,
              max(r.ly_do) FILTER (WHERE r.line_no = dg.line_no) AS ly_do,
              coalesce(bool_or(r.line_no IS NOT NULL AND NOT (r.line_no = ANY (dg.cac_dong))), false) AS ngoai_goi
         FROM public.bid_dong_tho(f.payload) r
     ) t
  )
  SELECT k.rfq_id, k.supplier_id, k.bid_version_id, k.line_no, k.moc_goi,
         k.anh_xa_id, k.canonical_item_id, k.thanh_tien, k.quantity, k.unit,
         k.thanh_tien / k.quantity,
         k.don_vi_goc, k.he_so,
         CASE WHEN k.trang_thai = 'HOP_LE' THEN k.thanh_tien / (k.quantity * k.he_so) END,
         k.tien_te, k.trang_thai,
         array_remove(ARRAY[CASE WHEN k.anh_xa_hoi_to > 0 THEN 'ANH_XA' END,
                            CASE WHEN k.bi_danh_hoi_to > 0 THEN 'BI_DANH_DON_VI' END,
                            CASE WHEN k.quy_doi_hoi_to > 0 THEN 'QUY_DOI' END,
                            CASE WHEN k.phien_ban_hoi_to > 0 THEN 'PHIEN_BAN_HANG_CHUAN' END], NULL),
         jsonb_strip_nulls(jsonb_build_object(
           'ANH_XA', nullif(k.anh_xa_sau, 0),
           'BI_DANH_DON_VI', nullif(k.bi_danh_sau, 0),
           'QUY_DOI', nullif(k.quy_doi_sau, 0),
           'PHIEN_BAN_HANG_CHUAN', nullif(k.phien_ban_sau, 0)))
    FROM ket_qua k
$ham$;

-- ============================================================================================
-- (5) CHỈ MỤC CHO CÁC ĐƯỜNG TRA
-- ============================================================================================
-- `rfq_invitations` và `unseal_requests` chỉ có chỉ mục (org, gói) RIÊNG PHẦN (lời mời còn sống, yêu cầu đang mở) — lần tra
-- theo gói của (3) và (4) cần MỌI hàng: lời mời đã thu hồi vẫn có báo giá đã mở, yêu cầu đã chạy là thứ (3) hỏi.
CREATE INDEX rfq_invitations_goi_idx ON rfq_invitations (org_id, rfq_id);
CREATE INDEX unseal_requests_goi_idx ON unseal_requests (org_id, rfq_id);
CREATE INDEX rfq_unsealed_bids_yeu_cau_idx ON rfq_unsealed_bids (org_id, unseal_request_id);
CREATE INDEX rfq_item_mappings_hang_chuan_idx ON rfq_item_mappings (org_id, canonical_item_id);
CREATE INDEX item_uom_conversions_hang_chuan_idx ON item_uom_conversions (org_id, canonical_item_id);
CREATE INDEX canonical_item_versions_hang_chuan_idx ON canonical_item_versions (org_id, canonical_item_id);
CREATE INDEX uom_aliases_chuoi_idx ON uom_aliases (org_id, bi_danh_sach);

REVOKE ALL ON FUNCTION public.quy_doi_da_giai(uuid, uuid, text, text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bid_dong_tho(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gia_da_lo(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quan_sat_gia(timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quy_doi_da_giai(uuid, uuid, text, text, text, text, timestamptz) TO app_api;
GRANT EXECUTE ON FUNCTION public.bid_dong_tho(jsonb) TO app_api;
GRANT EXECUTE ON FUNCTION public.gia_da_lo(uuid, uuid, timestamptz) TO app_api;
GRANT EXECUTE ON FUNCTION public.quan_sat_gia(timestamptz, uuid) TO app_api;
