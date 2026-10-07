-- ==============================================================================================
-- 113_trao_thau_theo_bac — [S1.280 / S3.5a của spec S3] AWARD THEO BẬC: K7 (SỐ CHỮ KÝ, VAI, TÁC GIẢ CHÍNH SÁCH), K2b (HẬU KIỂM
-- SỐ BÁO GIÁ), K5b (CHỮ KÝ TRAO THẦU ĐỘC LẬP) — CHỮ KÝ SỐNG ĐỘC LẬP VỚI HÀNG `APPROVED`
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §2.4 ⑹iv ⑺, §4.7, §5.1 (K7, K2b, K5b), §9
-- (S3.5). ADR-082 ⑽ ⒄, ADR-084 ⑷, ADR-147. Chủ dự án chốt ngày 2026-10-07, sáu câu theo đề xuất: gói không bậc ghim ở
-- tổ chức đã bật ⇒ từ chối (`K7_KHONG_BAC_GHIM`); `tham_dinh_truoc_trao` CHƯA cưỡng chế (K8b là S3.7); K5b áp thêm khi bậc trao
-- CAO HƠN bậc ước lượng; `award_vai_khac_nhau` đọc là hệ đại diện phân biệt; tập loại trừ chữ ký trao thầu thêm người điều phối mở
-- thầu và người xác minh hồ sơ nhà cung cấp thắng; S3.5 chia hai PR (S3.5a chốt, S3.5b màn).
--
-- VÌ SAO CHỮ KÝ PHẢI SỐNG ĐỘC LẬP (khoản 242 ⑴, đo ở S1.139/S1.142): `duyetTraoThau` ghi chữ ký và hàng `APPROVED` trong CÙNG
-- giao dịch, nên khi cần hai chữ ký, lần duyệt đầu bị từ chối và chữ ký của nó rơi theo giao dịch — không bao giờ duyệt được.
-- Nay tầng gói ghi chữ ký, HỎI `award_du_chu_ky`, và chỉ chèn hàng `APPROVED` khi đủ; chưa đủ thì hàng `PROPOSED` đứng yên và
-- chữ ký còn đó cho người thứ hai. Hằng `CHU_KY_CAN := 1` trong `award_kiem_mot_award_song` (`094`) GIỮ NGUYÊN làm sàn chết: `069`
-- giới hạn `award_so_chu_ky ∈ {1, 2}` nên sàn ấy không bao giờ ràng — nâng riêng nó là gãy, và khối đo S1.142 nay canh điều đó.
--
-- (1)  `award_so_tien_trao(org, phiên bản báo giá)` — số tiền và tiền tệ của báo giá được chọn, đọc qua `bid_so_tien`/`bid_currency`
--      (`020`, `070`) từ `rfq_unsealed_bids` — cùng đại lượng với ước lượng, KHÔNG phải `effective_cost` (§4.7: bậc đo chi tiêu).
-- (2)  `award_bac_cao_hon(org, gói, phiên bản báo giá)` — phần tử bậc CAO HƠN trong hai bậc: bậc ước lượng (`rfq_bac_ghim`) và bậc
--      của số tiền trao (`rfq_bac_cua` trên `rfq_budgets.policy_id` — phiên bản ghim, không phải phiên bản hiện hành). NÉM khi gói
--      không bậc ghim, báo giá không đọc được số tiền, hay tiền tệ lệch chính sách (ADR-082 ⑽: hàm theo bậc không lặng lẽ cho qua).
--      Tổ chức chưa bật ⇒ NULL. Các hàm vị từ hỏi những ca ấy TRƯỚC và trả mã; NÉM ở đây là lớp hai cho người gọi thẳng.
-- (3)  `award_so_chu_ky_can(org, đề xuất)` — khuôn `unseal_so_phe_duyet_can` (`019`): một phép tính, hai người đọc (tầng gói và
--      trigger). Chưa bật ⇒ 1; đã bật ⇒ `award_so_chu_ky` của bậc cao hơn; khoá vắng (bậc đấu thầu chính thức) ⇒ NÉM.
-- (4)  `award_vai_cua_nguoi(org, đề xuất, người)` — vai của người TẠI LÚC HỎI ∩ `award_vai` của bậc cao hơn; trigger chữ ký chụp nó
--      vào cột mới `rfq_award_approvals.vai_luc_ky` (cột ngoài GRANT INSERT, khuôn `tier_tu_so_tien` của `072`) — §4.7 đòi đọc vai
--      TẠI THỜI ĐIỂM KÝ, và S3.9 phải tái lập được bậc từ dữ liệu.
-- (5)  `award_du_chu_ky(org, đề xuất)` — K7: đủ người ký khác nhau ≥ (3); khi bậc bật `award_vai_khac_nhau` và cần 2 thì phải rút
--      được hai vai KHÁC NHAU cho hai người ký từ `vai_luc_ky` (hệ đại diện phân biệt — chủ dự án chốt). Cần ngoài {1, 2} ⇒ NÉM.
-- (6)  `award_tap_loai_tru(org, gói, phiên bản báo giá)` — tập loại trừ của chữ ký trao thầu: `rfq_tap_loai_tru` (ADR-121) ∪ tác giả
--      ngoại lệ `LOW_ACTUAL_COMPETITION` còn sống ∪ người khai phiên bản chính sách ghim (§2.4 ⑺) ∪ mọi người ĐÃ TỪNG điều phối mở
--      gói (`unseal_dispatch_history`, `unseal_requests` — cùng lý lẽ J3: chạm bản rõ trước mọi người) ∪ người làm hàng xác minh mới
--      nhất của nhà cung cấp THẮNG (lớp cho K8b tới S3.7; FINANCE giữ cả `supplier.qualify` lẫn `po.approve`).
-- (7)  `rfq_dem_nhom_loi_moi(org, gói, tập lời mời đếm)` — LÕI đếm nhóm tách từ `rfq_dem_ncc_canh_tranh` (`108`): nút là mọi lời mời
--      còn sống, cạnh là khoá nhóm (MST gốc, email, chín số cuối điện thoại của bất kỳ người liên hệ nào), đếm nhóm có ít nhất một
--      lời mời trong tập đếm. `rfq_dem_ncc_canh_tranh` nay là lời gọi với tập `rfq_loi_moi_dem_duoc` — K2 và K2b MỘT phép gộp.
-- (8)  `award_dem_nhom_bao_gia(org, gói, lượt chấm)` — K2b: số NHÓM nhà cung cấp có báo giá HỢP LỆ ở lượt chấm của đề xuất
--      (`rfq_evaluation_lines.effective_cost IS NOT NULL`) mà lời mời ĐẾM ĐƯỢC (luật K2, `rfq_loi_moi_dem_duoc` đọc hiện tại —
--      xác minh hết hạn sau lần nộp làm K2b đỏ: K2b là HẬU kiểm, ADR-147 đã ghi).
-- (9)  Bốn hàm vị từ (khuôn K1/K10a: NULL hay một mã thuộc `CHOT_VAO_SO`), đều cho qua khi tổ chức chưa bật:
--      `award_chot_bac` — gói không bậc ghim ⇒ `K7_KHONG_BAC_GHIM`; tiền tệ báo giá khác chính sách ⇒ `K7_LECH_TIEN_TE`; bậc cao hơn là
--        đấu thầu chính thức ⇒ `K7_DAU_THAU_CHINH_THUC`; báo giá không đọc được số tiền ⇒ NULL (J5 nói ở trigger `061`/`093`).
--      `award_chot_nguoi_ky` — người ký không giữ vai nào trong `award_vai` của bậc cao hơn ⇒ `K7_SAI_VAI`; người ký là người khai
--        phiên bản chính sách ghim ⇒ `K7_TAC_GIA_CHINH_SACH`.
--      `award_chot_hau_kiem` — (8) dưới `so_ncc_toi_thieu` của bậc cao hơn mà không ngoại lệ `LOW_ACTUAL_COMPETITION` còn sống ⇒
--        `K2B_THIEU_CANH_TRANH_THUC`. Hỏi ở cạnh ĐỀ XUẤT (số báo giá đã biết từ EVALUATING, nên ngoại lệ phải có TRƯỚC mọi chữ ký —
--        lượt soi hình dạng, TRUNG 2) và hỏi lại ở cạnh APPROVED làm lớp chặn cuối.
--      `award_chot_doc_lap` — K5b: khi bậc cao hơn bật `ky_danh_sach_moi`, HOẶC gói có ngoại lệ còn sống (bốn loại), HOẶC bậc trao CAO
--        HƠN bậc ước lượng (khai thấp — chủ dự án chốt), phải có ít nhất một chữ ký của người ngoài (6) ⇒ không thì
--        `K5B_THIEU_CHU_KY_DOC_LAP`. Khoá `ky_danh_sach_moi` vắng ⇒ coi như đòi.
-- (10) BA TRIGGER RIÊNG (khuôn `014` §(4) — không viết lại thân `094`): `rfq_awards_kiem_theo_bac_khi_de_xuat` (WHEN PROPOSED: bậc,
--      hậu kiểm) và `rfq_awards_kiem_theo_bac_khi_duyet` (WHEN APPROVED: READ COMMITTED ở MỌI tổ chức — khuôn `107` (4) —, bậc, đủ chữ
--      ký, hậu kiểm, độc lập), tên xếp SAU `rfq_awards_kiem_mot_award_song` nên chạy dưới khoá tư vấn theo gói; và
--      `rfq_award_approvals_kiem_vai_theo_bac` (chữ ký: bậc, vai, tác giả chính sách; đặt `vai_luc_ky`), xếp sau J3. Lời *chưa đủ chữ
--      ký* ở trigger APPROVED mang tên `k7_thieu_chu_ky` nhưng KHÔNG qua bảng tên → mã: tầng gói hỏi (5) trước nên không bao giờ
--      chạm nó; đó là lời "đi sai thứ tự", không phải lách chốt (ADR-060, khuôn K5 nhường K4b).
-- (11) `ngoai_le_kiem` (`105`) viết lại: ba loại danh sách vẫn chỉ ở DRAFT; `LOW_ACTUAL_COMPETITION` lập và rút chỉ khi gói ở
--      EVALUATING — trước đề xuất, nên mọi chữ ký ký lên một gói đã có ngoại lệ, và không rút được sau khi award đã duyệt (lượt soi,
--      TRUNG 3). Sai trạng thái ⇒ `k2b_ngoai_le_sai_trang_thai`.
--
-- THỨ MIGRATION NÀY KHÔNG LÀM: `tham_dinh_truoc_trao` (K8b, S3.7); tín hiệu `ESTIMATE_UNDERSTATED` và K10 ở chữ ký trao thầu
-- (S3.6d); K9 ở chữ ký trao thầu (S3.4); màn, `gieo:demo`, lượt đi thử (S3.5b). Bậc đấu thầu chính thức ở ƯỚC LƯỢNG đã bị K2 chặn
-- từ lúc nộp; ở đây chỉ còn ca số tiền trao rơi vào bậc ấy.
--
-- Mọi hàm và trigger mới hay đổi thân ghim ở `hardening.always.sql` trong CÙNG commit (S1.96).
-- ==============================================================================================

-- ============================================================================================
-- (1) SỐ TIỀN TRAO
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.award_so_tien_trao(p_org uuid, p_bid_version uuid, OUT so_tien numeric, OUT tien_te text)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT public.bid_so_tien((u.payload ->> 'totalAmount')), public.bid_currency((u.payload ->> 'currency'))
    FROM public.rfq_unsealed_bids u
   WHERE u.org_id = p_org AND u.bid_version_id = p_bid_version
$ham$;

-- ============================================================================================
-- (2) BẬC CAO HƠN TRONG HAI BẬC
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.award_bac_cao_hon(p_org uuid, p_rfq uuid, p_bid_version uuid) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  bac_ul jsonb;
  cs uuid;
  tien_te_cs text;
  tien record;
  tu_trao numeric;
  tu_cao numeric;
  bac jsonb;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN NULL;
  END IF;
  bac_ul := public.rfq_bac_ghim(p_org, p_rfq);
  IF bac_ul IS NULL THEN
    RAISE EXCEPTION 'Goi khong co bac ghim — khong phan bac trao thau duoc (K7)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k7_khong_bac_ghim';
  END IF;
  SELECT b.policy_id, p.currency INTO cs, tien_te_cs
    FROM public.rfq_budgets b
    JOIN public.org_procurement_policies p ON p.org_id = b.org_id AND p.id = b.policy_id
   WHERE b.org_id = p_org AND b.rfq_id = p_rfq;
  SELECT t.so_tien, t.tien_te INTO tien FROM public.award_so_tien_trao(p_org, p_bid_version) t;
  IF tien.so_tien IS NULL OR tien.tien_te IS NULL THEN
    RAISE EXCEPTION 'Bao gia duoc chon khong doc duoc so tien hay tien te — khong phan bac trao thau duoc (K7)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF tien.tien_te <> tien_te_cs THEN
    RAISE EXCEPTION 'Tien te cua bao gia (%) khac tien te chinh sach (%) — khong quy doi (K7)', tien.tien_te, tien_te_cs
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k7_lech_tien_te';
  END IF;
  tu_trao := public.rfq_bac_cua(cs, tien.so_tien, tien.tien_te);
  tu_cao := greatest(tu_trao, (bac_ul ->> 'tu_so_tien')::numeric);
  SELECT e INTO bac
    FROM public.org_procurement_policies p, jsonb_array_elements(p.tiers) e
   WHERE p.org_id = p_org AND p.id = cs AND (e ->> 'tu_so_tien')::numeric = tu_cao;
  IF bac IS NULL THEN
    RAISE EXCEPTION 'Bac cao hon (tu %) khong co trong phien ban chinh sach ghim — ham theo bac khong tra loi duoc (K7, ADR-082 (10))', tu_cao
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN bac;
END
$ham$;

-- ============================================================================================
-- (3) SỐ CHỮ KÝ CẦN — MỘT PHÉP TÍNH, HAI NGƯỜI ĐỌC
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.award_so_chu_ky_can(p_org uuid, p_award uuid) RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  a record;
  bac jsonb;
  n integer;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN 1;
  END IF;
  SELECT x.rfq_id, x.bid_version_id INTO a FROM public.rfq_awards x WHERE x.org_id = p_org AND x.id = p_award;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay de xuat trao thau % (K7)', p_award USING ERRCODE = 'foreign_key_violation';
  END IF;
  bac := public.award_bac_cao_hon(p_org, a.rfq_id, a.bid_version_id);
  n := (bac ->> 'award_so_chu_ky')::integer;
  IF n IS NULL THEN
    RAISE EXCEPTION 'Bac cao hon khong khai award_so_chu_ky (bac dau thau chinh thuc?) — khong dem chu ky duoc (K7, ADR-082 (10))'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN n;
END
$ham$;

-- ============================================================================================
-- (4) VAI CỦA NGƯỜI KÝ THUỘC `award_vai` CỦA BẬC CAO HƠN
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.award_vai_cua_nguoi(p_org uuid, p_award uuid, p_user uuid) RETURNS text[]
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  a record;
  bac jsonb;
  vai text[];
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN NULL;
  END IF;
  SELECT x.rfq_id, x.bid_version_id INTO a FROM public.rfq_awards x WHERE x.org_id = p_org AND x.id = p_award;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay de xuat trao thau % (K7)', p_award USING ERRCODE = 'foreign_key_violation';
  END IF;
  bac := public.award_bac_cao_hon(p_org, a.rfq_id, a.bid_version_id);
  SELECT coalesce(array_agg(v ORDER BY v), ARRAY[]::text[]) INTO vai
    FROM jsonb_array_elements_text(bac -> 'award_vai') AS t(v)
   WHERE EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.org_id = p_org AND ur.user_id = p_user AND ur.role_code = t.v);
  RETURN vai;
END
$ham$;

-- ============================================================================================
-- (5) ĐỦ CHỮ KÝ CHƯA — K7
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.award_du_chu_ky(p_org uuid, p_award uuid) RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  a record;
  can integer;
  co integer;
  bac jsonb;
BEGIN
  can := public.award_so_chu_ky_can(p_org, p_award);
  SELECT count(DISTINCT ap.approver_user_id)::integer INTO co
    FROM public.rfq_award_approvals ap
   WHERE ap.org_id = p_org AND ap.award_id = p_award;
  IF co < can THEN
    RETURN false;
  END IF;
  IF can = 1 THEN
    RETURN true;
  END IF;
  IF can <> 2 THEN
    RAISE EXCEPTION 'award_so_chu_ky_can tra % — ngoai mien {1, 2} cua 069 (K7)', can USING ERRCODE = 'check_violation';
  END IF;
  SELECT x.rfq_id, x.bid_version_id INTO a FROM public.rfq_awards x WHERE x.org_id = p_org AND x.id = p_award;
  bac := public.award_bac_cao_hon(p_org, a.rfq_id, a.bid_version_id);
  IF NOT coalesce((bac ->> 'award_vai_khac_nhau')::boolean, false) THEN
    RETURN true;
  END IF;
  RETURN EXISTS (SELECT 1
                   FROM public.rfq_award_approvals x
                   JOIN public.rfq_award_approvals y ON y.org_id = x.org_id AND y.award_id = x.award_id
                                                     AND y.approver_user_id <> x.approver_user_id,
                        unnest(coalesce(x.vai_luc_ky, ARRAY[]::text[])) AS vx(v),
                        unnest(coalesce(y.vai_luc_ky, ARRAY[]::text[])) AS vy(v)
                  WHERE x.org_id = p_org AND x.award_id = p_award AND vx.v <> vy.v);
END
$ham$;

-- ============================================================================================
-- (6) TẬP LOẠI TRỪ CỦA CHỮ KÝ TRAO THẦU
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.award_tap_loai_tru(p_org uuid, p_rfq uuid, p_bid_version uuid) RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT DISTINCT n FROM (
    SELECT t.n FROM public.rfq_tap_loai_tru(p_org, p_rfq) AS t(n)
    UNION ALL
    SELECT e.created_by
      FROM public.rfq_sourcing_exceptions e
     WHERE e.org_id = p_org AND e.rfq_id = p_rfq AND e.hanh_dong = 'LAP' AND e.loai = 'LOW_ACTUAL_COMPETITION'
       AND NOT EXISTS (SELECT 1 FROM public.rfq_sourcing_exceptions r
                        WHERE r.org_id = e.org_id AND r.hanh_dong = 'RUT' AND r.ngoai_le_id = e.id)
    UNION ALL
    SELECT p.created_by
      FROM public.rfq_budgets b
      JOIN public.org_procurement_policies p ON p.org_id = b.org_id AND p.id = b.policy_id
     WHERE b.org_id = p_org AND b.rfq_id = p_rfq
    UNION ALL
    SELECT h.dispatched_by FROM public.unseal_dispatch_history h WHERE h.org_id = p_org AND h.rfq_id = p_rfq
    UNION ALL
    SELECT r.dispatched_by FROM public.unseal_requests r WHERE r.org_id = p_org AND r.rfq_id = p_rfq
    UNION ALL
    SELECT m.created_by
      FROM (SELECT v.created_by
              FROM public.supplier_verifications v
             WHERE v.org_id = p_org
               AND v.supplier_id = (SELECT i.supplier_id
                                      FROM public.vendor_bid_versions bv
                                      JOIN public.vendor_bids bd ON bd.org_id = bv.org_id AND bd.id = bv.bid_id
                                      JOIN public.rfq_invitations i ON i.org_id = bd.org_id AND i.id = bd.invitation_id
                                     WHERE bv.org_id = p_org AND bv.id = p_bid_version)
             ORDER BY v.thu_tu DESC
             LIMIT 1) m
  ) t
  WHERE n IS NOT NULL
$ham$;

-- ============================================================================================
-- (7) LÕI ĐẾM NHÓM — K2 VÀ K2b MỘT PHÉP GỘP
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.rfq_dem_nhom_loi_moi(p_org uuid, p_rfq uuid, p_dem uuid[]) RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  so integer;
BEGIN
  WITH RECURSIVE
  nut AS (
    SELECT i.id, i.supplier_id, left(s.tax_code, 10) AS mst_goc,
           (i.id = ANY (p_dem)) AS dem_duoc
      FROM public.rfq_invitations i
      JOIN public.suppliers s ON s.org_id = i.org_id AND s.id = i.supplier_id
     WHERE i.org_id = p_org AND i.rfq_id = p_rfq AND i.revoked_at IS NULL
  ),
  dich AS (
    SELECT n.id, 'M|' || n.mst_goc AS d FROM nut n WHERE n.mst_goc IS NOT NULL
    UNION
    SELECT n.id, 'E|' || k.email
      FROM nut n JOIN public.supplier_contacts k ON k.org_id = p_org AND k.supplier_id = n.supplier_id
    UNION
    SELECT n.id, 'P|' || right(regexp_replace(k.phone, '[^0-9]', '', 'g'), 9)
      FROM nut n JOIN public.supplier_contacts k ON k.org_id = p_org AND k.supplier_id = n.supplier_id
     WHERE k.phone IS NOT NULL
  ),
  canh AS (
    SELECT DISTINCT a.id AS tu, b.id AS den FROM dich a JOIN dich b ON b.d = a.d
  ),
  toi (goc, nut) AS (
    SELECT n.id, n.id FROM nut n
    UNION
    SELECT t.goc, c.den FROM toi t JOIN canh c ON c.tu = t.nut
  ),
  nhom AS (
    SELECT t.nut, min(t.goc::text) AS dai_dien FROM toi t GROUP BY t.nut
  )
  SELECT count(DISTINCT g.dai_dien)::integer INTO so
    FROM nhom g JOIN nut n ON n.id = g.nut
   WHERE n.dem_duoc;
  RETURN so;
END
$ham$;

CREATE OR REPLACE FUNCTION public.rfq_dem_ncc_canh_tranh(p_org uuid, p_rfq uuid) RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT public.rfq_dem_nhom_loi_moi(p_org, p_rfq, ARRAY(SELECT d FROM public.rfq_loi_moi_dem_duoc(p_org, p_rfq) AS t(d)))
$ham$;

-- ============================================================================================
-- (8) SỐ NHÓM CÓ BÁO GIÁ HỢP LỆ — K2b
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.award_dem_nhom_bao_gia(p_org uuid, p_rfq uuid, p_evaluation uuid) RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT public.rfq_dem_nhom_loi_moi(p_org, p_rfq, ARRAY(
    SELECT d
      FROM public.rfq_loi_moi_dem_duoc(p_org, p_rfq) AS t(d)
     WHERE EXISTS (SELECT 1
                     FROM public.rfq_evaluation_lines l
                     JOIN public.vendor_bid_versions bv ON bv.org_id = l.org_id AND bv.id = l.bid_version_id
                     JOIN public.vendor_bids bd ON bd.org_id = bv.org_id AND bd.id = bv.bid_id
                    WHERE l.org_id = p_org AND l.evaluation_id = p_evaluation AND l.effective_cost IS NOT NULL
                      AND bd.invitation_id = t.d)))
$ham$;

-- ============================================================================================
-- (9) BỐN HÀM VỊ TỪ
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.award_chot_bac(p_org uuid, p_rfq uuid, p_bid_version uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  tien record;
  tien_te_cs text;
  bac jsonb;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN NULL;
  END IF;
  IF public.rfq_bac_ghim(p_org, p_rfq) IS NULL THEN
    RETURN 'K7_KHONG_BAC_GHIM';
  END IF;
  SELECT t.so_tien, t.tien_te INTO tien FROM public.award_so_tien_trao(p_org, p_bid_version) t;
  IF tien.so_tien IS NULL OR tien.tien_te IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT p.currency INTO tien_te_cs
    FROM public.rfq_budgets b
    JOIN public.org_procurement_policies p ON p.org_id = b.org_id AND p.id = b.policy_id
   WHERE b.org_id = p_org AND b.rfq_id = p_rfq;
  IF tien.tien_te <> tien_te_cs THEN
    RETURN 'K7_LECH_TIEN_TE';
  END IF;
  bac := public.award_bac_cao_hon(p_org, p_rfq, p_bid_version);
  IF (bac ->> 'dau_thau_chinh_thuc')::boolean IS NOT FALSE THEN
    RETURN 'K7_DAU_THAU_CHINH_THUC';
  END IF;
  RETURN NULL;
END
$ham$;

CREATE OR REPLACE FUNCTION public.award_chot_nguoi_ky(p_org uuid, p_award uuid, p_user uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  vai text[];
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN NULL;
  END IF;
  vai := public.award_vai_cua_nguoi(p_org, p_award, p_user);
  IF cardinality(vai) = 0 THEN
    RETURN 'K7_SAI_VAI';
  END IF;
  IF EXISTS (SELECT 1
               FROM public.rfq_awards a
               JOIN public.rfq_budgets b ON b.org_id = a.org_id AND b.rfq_id = a.rfq_id
               JOIN public.org_procurement_policies p ON p.org_id = b.org_id AND p.id = b.policy_id
              WHERE a.org_id = p_org AND a.id = p_award AND p.created_by = p_user) THEN
    RETURN 'K7_TAC_GIA_CHINH_SACH';
  END IF;
  RETURN NULL;
END
$ham$;

CREATE OR REPLACE FUNCTION public.award_chot_hau_kiem(p_org uuid, p_rfq uuid, p_evaluation uuid, p_bid_version uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  bac jsonb;
  nguong integer;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN NULL;
  END IF;
  IF public.award_chot_bac(p_org, p_rfq, p_bid_version) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  bac := public.award_bac_cao_hon(p_org, p_rfq, p_bid_version);
  nguong := (bac ->> 'so_ncc_toi_thieu')::integer;
  IF nguong IS NULL THEN
    RAISE EXCEPTION 'Bac cao hon thieu so_ncc_toi_thieu — ham theo bac khong tra loi duoc (K2b, ADR-082 (10))'
      USING ERRCODE = 'check_violation';
  END IF;
  IF public.award_dem_nhom_bao_gia(p_org, p_rfq, p_evaluation) >= nguong THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.rfq_sourcing_exceptions e
              WHERE e.org_id = p_org AND e.rfq_id = p_rfq AND e.hanh_dong = 'LAP' AND e.loai = 'LOW_ACTUAL_COMPETITION'
                AND NOT EXISTS (SELECT 1 FROM public.rfq_sourcing_exceptions r
                                 WHERE r.org_id = e.org_id AND r.hanh_dong = 'RUT' AND r.ngoai_le_id = e.id)) THEN
    RETURN NULL;
  END IF;
  RETURN 'K2B_THIEU_CANH_TRANH_THUC';
END
$ham$;

CREATE OR REPLACE FUNCTION public.award_chot_doc_lap(p_org uuid, p_award uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  a record;
  bac_ul jsonb;
  bac jsonb;
  doi boolean;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN NULL;
  END IF;
  SELECT x.rfq_id, x.bid_version_id INTO a FROM public.rfq_awards x WHERE x.org_id = p_org AND x.id = p_award;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay de xuat trao thau % (K5b)', p_award USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF public.award_chot_bac(p_org, a.rfq_id, a.bid_version_id) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  bac_ul := public.rfq_bac_ghim(p_org, a.rfq_id);
  bac := public.award_bac_cao_hon(p_org, a.rfq_id, a.bid_version_id);
  doi := coalesce((bac ->> 'ky_danh_sach_moi')::boolean, true)
         OR (bac ->> 'tu_so_tien')::numeric > (bac_ul ->> 'tu_so_tien')::numeric
         OR EXISTS (SELECT 1 FROM public.rfq_sourcing_exceptions e
                     WHERE e.org_id = p_org AND e.rfq_id = a.rfq_id AND e.hanh_dong = 'LAP'
                       AND NOT EXISTS (SELECT 1 FROM public.rfq_sourcing_exceptions r
                                        WHERE r.org_id = e.org_id AND r.hanh_dong = 'RUT' AND r.ngoai_le_id = e.id));
  IF NOT doi THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1
               FROM public.rfq_award_approvals ap
              WHERE ap.org_id = p_org AND ap.award_id = p_award
                AND NOT EXISTS (SELECT 1 FROM public.award_tap_loai_tru(p_org, a.rfq_id, a.bid_version_id) AS t(n)
                                 WHERE t.n = ap.approver_user_id)) THEN
    RETURN NULL;
  END IF;
  RETURN 'K5B_THIEU_CHU_KY_DOC_LAP';
END
$ham$;

-- ============================================================================================
-- (10) CỘT `vai_luc_ky` VÀ BA TRIGGER RIÊNG
-- ============================================================================================
ALTER TABLE rfq_award_approvals ADD COLUMN vai_luc_ky text[];

CREATE OR REPLACE FUNCTION public.award_kiem_theo_bac_khi_de_xuat() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ly_do text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'De xuat trao thau chi nhan duoi READ COMMITTED (giao dich dang o %): anh chup cu khong thay lan rut ngoai le hay lan bat S3 vua commit (K7)',
      pg_catalog.current_setting('transaction_isolation') USING ERRCODE = 'check_violation';
  END IF;
  ly_do := public.award_chot_bac(NEW.org_id, NEW.rfq_id, NEW.bid_version_id);
  IF ly_do IS NULL THEN
    ly_do := public.award_chot_hau_kiem(NEW.org_id, NEW.rfq_id, NEW.evaluation_id, NEW.bid_version_id);
  END IF;
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'De xuat trao thau bi chan theo bac: %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = lower(ly_do);
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_awards_kiem_theo_bac_khi_de_xuat
  BEFORE INSERT ON rfq_awards
  FOR EACH ROW
  WHEN (NEW.status = 'PROPOSED')
  EXECUTE FUNCTION public.award_kiem_theo_bac_khi_de_xuat();
ALTER TABLE rfq_awards ENABLE ALWAYS TRIGGER rfq_awards_kiem_theo_bac_khi_de_xuat;

CREATE OR REPLACE FUNCTION public.award_kiem_theo_bac_khi_duyet() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  de_xuat uuid;
  ly_do text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Duyet trao thau chi nhan duoi READ COMMITTED (giao dich dang o %): anh chup cu khong thay chu ky, ngoai le hay lan bat S3 vua commit (K7)',
      pg_catalog.current_setting('transaction_isolation') USING ERRCODE = 'check_violation';
  END IF;
  SELECT a.id INTO de_xuat
    FROM public.rfq_awards a
   WHERE a.org_id = NEW.org_id AND a.rfq_id = NEW.rfq_id AND a.status = 'PROPOSED'
   ORDER BY a.acted_at DESC, a.id DESC
   LIMIT 1;
  ly_do := public.award_chot_bac(NEW.org_id, NEW.rfq_id, NEW.bid_version_id);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Duyet trao thau bi chan theo bac: %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = lower(ly_do);
  END IF;
  IF de_xuat IS NULL OR NOT public.award_du_chu_ky(NEW.org_id, de_xuat) THEN
    RAISE EXCEPTION 'De xuat trao thau can % chu ky duyet hop le theo bac; chua du (K7)',
      coalesce(public.award_so_chu_ky_can(NEW.org_id, de_xuat), 1)
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k7_thieu_chu_ky';
  END IF;
  ly_do := public.award_chot_hau_kiem(NEW.org_id, NEW.rfq_id, NEW.evaluation_id, NEW.bid_version_id);
  IF ly_do IS NULL THEN
    ly_do := public.award_chot_doc_lap(NEW.org_id, de_xuat);
  END IF;
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Duyet trao thau bi chan theo bac: %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = lower(ly_do);
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_awards_kiem_theo_bac_khi_duyet
  BEFORE INSERT ON rfq_awards
  FOR EACH ROW
  WHEN (NEW.status = 'APPROVED')
  EXECUTE FUNCTION public.award_kiem_theo_bac_khi_duyet();
ALTER TABLE rfq_awards ENABLE ALWAYS TRIGGER rfq_awards_kiem_theo_bac_khi_duyet;

CREATE OR REPLACE FUNCTION public.award_kiem_vai_theo_bac() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  a record;
  ly_do text;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    NEW.vai_luc_ky := NULL;
    RETURN NEW;
  END IF;
  SELECT x.rfq_id, x.bid_version_id INTO a FROM public.rfq_awards x WHERE x.org_id = NEW.org_id AND x.id = NEW.award_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay de xuat trao thau % (K7)', NEW.award_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  ly_do := public.award_chot_bac(NEW.org_id, a.rfq_id, a.bid_version_id);
  IF ly_do IS NULL THEN
    ly_do := public.award_chot_nguoi_ky(NEW.org_id, NEW.award_id, NEW.approver_user_id);
  END IF;
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Chu ky trao thau bi chan theo bac: %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = lower(ly_do);
  END IF;
  NEW.vai_luc_ky := public.award_vai_cua_nguoi(NEW.org_id, NEW.award_id, NEW.approver_user_id);
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_award_approvals_kiem_vai_theo_bac
  BEFORE INSERT ON rfq_award_approvals
  FOR EACH ROW EXECUTE FUNCTION public.award_kiem_vai_theo_bac();
ALTER TABLE rfq_award_approvals ENABLE ALWAYS TRIGGER rfq_award_approvals_kiem_vai_theo_bac;

-- ============================================================================================
-- (11) NGOẠI LỆ HẬU KIỂM LẬP VÀ RÚT Ở EVALUATING
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.ngoai_le_kiem() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
  loai_goc text;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RAISE EXCEPTION 'Chi to chuc da bat S3 moi lap hay rut ngoai le canh tranh (ADR-080)'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT p.status INTO trang_thai
    FROM public.rfq_packages p
   WHERE p.org_id = NEW.org_id AND p.id = NEW.rfq_id
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay goi thau cua ngoai le (K4a)'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id AND ur.user_id = NEW.created_by
                    AND rp.permission_code = 'rfq.invite') THEN
    RAISE EXCEPTION 'Nguoi lap hay rut ngoai le phai giu rfq.invite (ADR-084)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.hanh_dong = 'LAP' THEN
    loai_goc := NEW.loai;
  ELSE
    SELECT e.loai INTO loai_goc
      FROM public.rfq_sourcing_exceptions e
     WHERE e.org_id = NEW.org_id AND e.id = NEW.ngoai_le_id
       AND e.rfq_id = NEW.rfq_id AND e.hanh_dong = 'LAP';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Hang rut phai tro ve mot ngoai le da lap cua cung goi thau (K4a)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1
                 FROM public.rfq_sourcing_exceptions r
                WHERE r.org_id = NEW.org_id AND r.hanh_dong = 'RUT' AND r.ngoai_le_id = NEW.ngoai_le_id) THEN
      RAISE EXCEPTION 'Ngoai le nay da duoc rut (K4a)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF loai_goc IN ('SINGLE_SOURCE', 'LIMITED_COMPETITION', 'ROTATION') THEN
    IF trang_thai <> 'DRAFT' THEN
      RAISE EXCEPTION 'Ngoai le chi lap hay rut khi goi con o DRAFT; goi dang o % (K4a)', trang_thai
        USING ERRCODE = 'check_violation', CONSTRAINT = 'k4a_ngoai_le_sai_trang_thai';
    END IF;
    RETURN NEW;
  END IF;
  IF loai_goc = 'LOW_ACTUAL_COMPETITION' THEN
    IF trang_thai <> 'EVALUATING' THEN
      RAISE EXCEPTION 'Ngoai le hau kiem chi lap hay rut khi goi o EVALUATING, truoc de xuat trao thau; goi dang o % (K2b)', trang_thai
        USING ERRCODE = 'check_violation', CONSTRAINT = 'k2b_ngoai_le_sai_trang_thai';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Loai ngoai le nay khong lap o danh sach moi (K4a)'
    USING ERRCODE = 'check_violation';
END
$ham$;
