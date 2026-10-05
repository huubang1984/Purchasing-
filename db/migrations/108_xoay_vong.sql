-- ==============================================================================================
-- 108_xoay_vong — [S1.270 / S3.3d của spec S3] K3: XOAY VÒNG NHÀ CUNG CẤP Ở CẠNH NỘP DUYỆT VÀ CẠNH MỞ GÓI; ĐÓNG KHOẢN 234
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §2.5 ⒀, §5 K3, §5.1 K3, §9 (S3.3). ADR-058 ⑶(b),
-- ADR-082 ⑹ ⒀, ADR-147, ADR-148. Khoản 234 ⒝ (⒜ là K2, ⒞ là K5 — `107`). Chủ dự án chốt ngày 2026-10-05: K3 kiểm ở CẢ hai cạnh;
-- *cùng một nhà cung cấp* theo khoá nhóm; một PR; sau lượt soi hình dạng: chỉ gói CÙNG LOẠI chiếm suất của cửa sổ, người chọn như K2,
-- chặn `opened_at` do người gọi đặt ở tổ chức đã bật (khoản 319), một mã vào sổ ở cả hai cạnh.
--
-- (1) `rfq_loi_moi_dem_duoc(org, gói)` — id các lời mời CÒN SỐNG đếm được theo sáu vế của K2 (`107`, ADR-147 ⑴ ⑵). Tách ra từ
--     `rfq_dem_ncc_canh_tranh` để K2 và K3 đọc MỘT vị từ: K3 đòi nhà cung cấp *mới* phải đếm được (ADR-082 ⑹). Rỗng khi gói có hàng
--     lời mời không rõ người mời hay người thu hồi. `rfq_dem_ncc_canh_tranh` định nghĩa lại: nhóm vẫn dựng trên MỌI lời mời còn
--     sống, chỉ phép đếm cuối lọc theo hàm này — cùng kết quả với `107`.
-- (2) `rfq_ncc_moi_xoay_vong(org, gói, N)` — số lời mời còn sống đếm được của gói mà nhà cung cấp KHÔNG chung khoá nào (id, MST gốc,
--     email hay chín số cuối điện thoại của BẤT KỲ người liên hệ nào) với một nhà cung cấp CŨ. Cũ là nhà cung cấp của mọi lời mời
--     không thu hồi trước lúc mở — kể cả mời sau khi ký — ở các gói trong cửa sổ của một *người chọn* của gói đang xét:
--       · người chọn = người tạo ∪ mọi người mời ∪ mọi người thu hồi (như K2);
--       · gói của người u = gói ĐÃ MỞ, khác gói đang xét, mà u tạo hay có lời mời TRƯỚC KHI KÝ (`moi_sau_khi_ky = false`) không
--         thu hồi trước lúc mở — lời mời thêm ở OPEN không cho u chiếm suất ở gói của đồng nghiệp (lượt soi, CAO);
--       · suất = gói của u không huỷ mà bậc ghim có `xoay_vong_n > 0`; cửa sổ của u = mọi gói của u mở từ suất thứ N gần nhất
--         (`opened_at DESC, id DESC`) trở về sau — gói không chiếm suất (bậc nhỏ, đã huỷ, thời MVP1) vẫn góp nhà cung cấp cũ khi nằm
--         trong khoảng ấy, nên gói đệm không rửa được cửa sổ; ít hơn N suất thì từ suất xa nhất; không suất nào thì u không góp gì.
-- (3) `rfq_chot_xoay_vong(org, gói)` — hàm vị từ của K3 (khuôn K1): bậc ghim `xoay_vong_n` = N > 0 đòi ít nhất một lời mời *mới*
--     hoặc một ngoại lệ `ROTATION` còn sống (vị từ của `105`). Gói không bậc ghim, bậc đấu thầu chính thức, N = 0 ⇒ cho qua (K1, K2
--     nói ở cạnh nộp; ở cạnh mở chỉ dữ liệu trước `097`). Dùng ở hai cạnh; câu hỏi của tầng gói lọc trạng thái theo cạnh.
-- (4) TRIGGER K3 ở cạnh `DRAFT→PENDING_APPROVAL`: chốt READ COMMITTED riêng (không dựa vào trigger K2 xếp trước) rồi vị từ.
-- (5) TRIGGER K3 ở cạnh `PENDING_APPROVAL→OPEN`, tổ chức đã bật: `opened_at` phải là giờ của lần mở (`now()`, đúng giá trị
--     `openRfq` đặt) — cửa sổ xếp theo nó, và `app_api` giữ `UPDATE (opened_at)` (khoản 319); chốt READ COMMITTED; khoá tư vấn
--     ĐỘC QUYỀN theo tổ chức (seed 2 — cùng khoá `102` lấy ở cạnh này, nên lấy lại là no-op; giữ ở đây để trigger không dựa vào
--     thứ tự tên) — hai lần mở trong một tổ chức xếp hàng, lần sau lấy ảnh chụp mới sau khoá và thấy gói vừa mở trong cửa sổ. Lý do
--     của cạnh mở: cửa sổ chỉ đếm gói ĐÃ MỞ, nên các gói nộp song song cùng một bộ nhà cung cấp đều qua lúc nộp.
--
-- THỨ MIGRATION NÀY KHÔNG LÀM: K2b, K5b (S3.5); màn, kịch bản 41 bản màn, lượt đi thử (S3.3e); chỉ mục cho cửa sổ (quy mô pilot —
-- ADR-148); khoản 319 ở tổ chức chưa bật.
--
-- Mọi hàm và trigger mới hay đổi thân ghim ở `hardening.always.sql` trong CÙNG commit (S1.96).
-- ==============================================================================================

-- ============================================================================================
-- (1) VỊ TỪ *ĐẾM ĐƯỢC* CỦA K2 — MỘT HÀM CHO K2 VÀ K3
-- ============================================================================================
-- Không SECURITY DEFINER (hardening §C): chạy dưới quyền người gọi, RLS áp.
CREATE OR REPLACE FUNCTION public.rfq_loi_moi_dem_duoc(p_org uuid, p_rfq uuid) RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  WITH goc AS (
    SELECT r.created_by AS nguoi_tao,
           (SELECT p.created_by
              FROM public.rfq_budgets b
              JOIN public.org_procurement_policies p ON p.org_id = b.org_id AND p.id = b.policy_id
             WHERE b.org_id = p_org AND b.rfq_id = p_rfq) AS tac_gia
      FROM public.rfq_packages r
     WHERE r.org_id = p_org AND r.id = p_rfq AND r.created_by IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.rfq_invitations i
                        WHERE i.org_id = p_org AND i.rfq_id = p_rfq
                          AND (i.invited_by IS NULL OR (i.revoked_at IS NOT NULL AND i.revoked_by IS NULL)))
  ),
  chon AS (
    SELECT g.nguoi_tao AS n FROM goc g
    UNION
    SELECT i.invited_by FROM public.rfq_invitations i WHERE i.org_id = p_org AND i.rfq_id = p_rfq
    UNION
    SELECT i.revoked_by FROM public.rfq_invitations i
     WHERE i.org_id = p_org AND i.rfq_id = p_rfq AND i.revoked_by IS NOT NULL
  )
  SELECT i.id
    FROM goc g
    JOIN public.rfq_invitations i ON i.org_id = p_org AND i.rfq_id = p_rfq AND i.revoked_at IS NULL
    JOIN public.suppliers s ON s.org_id = i.org_id AND s.id = i.supplier_id
    JOIN public.supplier_contacts c ON c.org_id = i.org_id AND c.id = i.contact_id
   WHERE s.created_by IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM chon WHERE chon.n = s.created_by)
     AND NOT EXISTS (SELECT 1 FROM public.supplier_contacts k
                      WHERE k.org_id = s.org_id AND k.supplier_id = s.id
                        AND (k.created_by IS NULL OR EXISTS (SELECT 1 FROM chon WHERE chon.n = k.created_by)))
     AND s.tax_code IS NOT NULL
     AND c.status = 'ACTIVE' AND c.phone IS NOT NULL
     AND public.ncc_xac_minh_con_hieu_luc(p_org, s.id)
     AND EXISTS (SELECT 1
                   FROM (SELECT v.created_by FROM public.supplier_verifications v
                          WHERE v.org_id = p_org AND v.supplier_id = s.id
                          ORDER BY v.thu_tu DESC
                          LIMIT 1) m
                  WHERE m.created_by IS NOT NULL
                    AND m.created_by IS DISTINCT FROM g.tac_gia
                    AND NOT EXISTS (SELECT 1 FROM chon WHERE chon.n = m.created_by))
$ham$;

-- Thân `107` (2): nhóm vẫn dựng trên MỌI lời mời còn sống (bắc cầu qua lời mời không đếm được chỉ làm đếm thiếu); vế *đếm được*
-- nay là (1).
CREATE OR REPLACE FUNCTION public.rfq_dem_ncc_canh_tranh(p_org uuid, p_rfq uuid) RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  so integer;
BEGIN
  WITH RECURSIVE
  dem AS (
    SELECT d AS id FROM public.rfq_loi_moi_dem_duoc(p_org, p_rfq) d
  ),
  nut AS (
    SELECT i.id, i.supplier_id, left(s.tax_code, 10) AS mst_goc,
           EXISTS (SELECT 1 FROM dem WHERE dem.id = i.id) AS dem_duoc
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

-- ============================================================================================
-- (2) SỐ LỜI MỜI *MỚI* SO VỚI CỬA SỔ CỦA NGƯỜI CHỌN
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.rfq_ncc_moi_xoay_vong(p_org uuid, p_rfq uuid, p_n integer) RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  so integer;
BEGIN
  IF p_n IS NULL OR p_n < 1 THEN
    RAISE EXCEPTION 'Cua so xoay vong phai co it nhat mot goi (K3)'
      USING ERRCODE = 'check_violation';
  END IF;
  WITH
  chon AS (
    SELECT r.created_by AS u FROM public.rfq_packages r
     WHERE r.org_id = p_org AND r.id = p_rfq AND r.created_by IS NOT NULL
    UNION
    SELECT i.invited_by FROM public.rfq_invitations i
     WHERE i.org_id = p_org AND i.rfq_id = p_rfq AND i.invited_by IS NOT NULL
    UNION
    SELECT i.revoked_by FROM public.rfq_invitations i
     WHERE i.org_id = p_org AND i.rfq_id = p_rfq AND i.revoked_by IS NOT NULL
  ),
  goi_cua AS (
    SELECT c.u, p.id, p.opened_at, p.status
      FROM chon c
      JOIN public.rfq_packages p ON p.org_id = p_org AND p.id <> p_rfq AND p.opened_at IS NOT NULL
     WHERE p.created_by = c.u
        OR EXISTS (SELECT 1 FROM public.rfq_invitations j
                    WHERE j.org_id = p.org_id AND j.rfq_id = p.id AND j.invited_by = c.u
                      AND NOT j.moi_sau_khi_ky
                      AND (j.revoked_at IS NULL OR j.revoked_at >= p.opened_at))
  ),
  suat AS (
    SELECT g.u, g.id, g.opened_at,
           row_number() OVER (PARTITION BY g.u ORDER BY g.opened_at DESC, g.id DESC) AS thu_tu
      FROM goi_cua g
     WHERE g.status <> 'CANCELLED'
       AND coalesce((public.rfq_bac_ghim(p_org, g.id) ->> 'xoay_vong_n')::integer, 0) > 0
  ),
  moc AS (
    SELECT DISTINCT ON (s.u) s.u, s.opened_at, s.id
      FROM suat s
     WHERE s.thu_tu <= p_n
     ORDER BY s.u, s.thu_tu DESC
  ),
  cua_so AS (
    SELECT DISTINCT g.id, g.opened_at
      FROM goi_cua g JOIN moc m ON m.u = g.u
     WHERE (g.opened_at, g.id) >= (m.opened_at, m.id)
  ),
  ncc_cu AS (
    SELECT DISTINCT j.supplier_id
      FROM cua_so w
      JOIN public.rfq_invitations j ON j.org_id = p_org AND j.rfq_id = w.id
     WHERE j.revoked_at IS NULL OR j.revoked_at >= w.opened_at
  ),
  ung_vien AS (
    SELECT i.id, i.supplier_id
      FROM public.rfq_invitations i
     WHERE i.org_id = p_org AND i.rfq_id = p_rfq
       AND EXISTS (SELECT 1 FROM public.rfq_loi_moi_dem_duoc(p_org, p_rfq) d WHERE d = i.id)
  ),
  xet AS (
    SELECT n.supplier_id AS ncc FROM ncc_cu n
    UNION
    SELECT v.supplier_id FROM ung_vien v
  ),
  khoa AS (
    SELECT x.ncc, 'S|' || x.ncc::text AS k FROM xet x
    UNION
    SELECT s.id, 'M|' || left(s.tax_code, 10)
      FROM xet x JOIN public.suppliers s ON s.org_id = p_org AND s.id = x.ncc
     WHERE s.tax_code IS NOT NULL
    UNION
    SELECT k.supplier_id, 'E|' || k.email
      FROM xet x JOIN public.supplier_contacts k ON k.org_id = p_org AND k.supplier_id = x.ncc
    UNION
    SELECT k.supplier_id, 'P|' || right(regexp_replace(k.phone, '[^0-9]', '', 'g'), 9)
      FROM xet x JOIN public.supplier_contacts k ON k.org_id = p_org AND k.supplier_id = x.ncc
     WHERE k.phone IS NOT NULL
  )
  SELECT count(*)::integer INTO so
    FROM ung_vien v
   WHERE NOT EXISTS (SELECT 1
                       FROM khoa a
                       JOIN khoa b ON b.k = a.k
                       JOIN ncc_cu n ON n.supplier_id = b.ncc
                      WHERE a.ncc = v.supplier_id);
  RETURN so;
END
$ham$;

-- ============================================================================================
-- (3) K3 — HÀM VỊ TỪ CỦA CHỐT
-- ============================================================================================
-- Mã trả về là TỪ VỰNG của `CHOT_VAO_SO` (`@trustprocure/identity`).
CREATE OR REPLACE FUNCTION public.rfq_chot_xoay_vong(p_org uuid, p_rfq uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  bac jsonb;
  n integer;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rfq_packages r
                  WHERE r.org_id = p_org AND r.id = p_rfq AND r.status IN ('DRAFT', 'PENDING_APPROVAL')) THEN
    RETURN NULL;
  END IF;
  bac := public.rfq_bac_ghim(p_org, p_rfq);
  IF bac IS NULL OR (bac ->> 'dau_thau_chinh_thuc')::boolean IS NOT FALSE THEN
    RETURN NULL;
  END IF;
  n := (bac ->> 'xoay_vong_n')::integer;
  IF n IS NULL THEN
    RAISE EXCEPTION 'Bac ghim thieu xoay_vong_n — ham theo bac khong tra loi duoc (K3, ADR-082 (10))'
      USING ERRCODE = 'check_violation';
  END IF;
  IF n = 0 THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.rfq_sourcing_exceptions e
              WHERE e.org_id = p_org AND e.rfq_id = p_rfq AND e.hanh_dong = 'LAP' AND e.loai = 'ROTATION'
                AND NOT EXISTS (SELECT 1 FROM public.rfq_sourcing_exceptions r
                                 WHERE r.org_id = e.org_id AND r.hanh_dong = 'RUT' AND r.ngoai_le_id = e.id)) THEN
    RETURN NULL;
  END IF;
  IF public.rfq_ncc_moi_xoay_vong(p_org, p_rfq, n) >= 1 THEN
    RETURN NULL;
  END IF;
  RETURN 'K3_KHONG_XOAY_VONG';
END
$ham$;

-- ============================================================================================
-- (4) CẠNH DRAFT→PENDING_APPROVAL
-- ============================================================================================
-- `WHEN` đúng cạnh (ADR-082 ⒃). Tên xếp sau `rfq_packages_kiem_so_ncc_khi_nop` (K2).
CREATE OR REPLACE FUNCTION public.rfq_kiem_xoay_vong_khi_nop() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ly_do text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Nop duyet chi nhan duoi READ COMMITTED (giao dich dang o %): anh chup cu khong thay goi vua mo (K3)',
      pg_catalog.current_setting('transaction_isolation') USING ERRCODE = 'check_violation';
  END IF;
  ly_do := public.rfq_chot_xoay_vong(NEW.org_id, NEW.id);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Goi thau chua roi DRAFT duoc (K3): %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k3_xoay_vong';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_packages_kiem_xoay_vong_khi_nop
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (OLD.status = 'DRAFT' AND NEW.status = 'PENDING_APPROVAL')
  EXECUTE FUNCTION public.rfq_kiem_xoay_vong_khi_nop();
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_xoay_vong_khi_nop;

-- ============================================================================================
-- (5) CẠNH PENDING_APPROVAL→OPEN
-- ============================================================================================
-- `WHEN` đúng cạnh (ADR-082 ⒃): `app_unseal` sửa `rfq_packages` ở các cạnh mở thầu, và không có việc gì ở đây. Tên xếp sau
-- `rfq_packages_kiem_tin_hieu_khi_mo` (K10a) — cuối cạnh mở.
CREATE OR REPLACE FUNCTION public.rfq_kiem_xoay_vong_khi_mo() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ly_do text;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RETURN NEW;
  END IF;
  IF NEW.opened_at IS DISTINCT FROM pg_catalog.now() THEN
    RAISE EXCEPTION 'Moc mo goi phai la gio cua lan mo — cua so xoay vong xep theo no (K3, khoan 319)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Mo goi chi nhan duoi READ COMMITTED (giao dich dang o %): anh chup cu khong thay goi vua mo (K3)',
      pg_catalog.current_setting('transaction_isolation') USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.org_id::pg_catalog.text, 2));
  ly_do := public.rfq_chot_xoay_vong(NEW.org_id, NEW.id);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Goi thau chua mo duoc (K3): %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k3_xoay_vong';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_packages_kiem_xoay_vong_khi_mo
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'OPEN')
  EXECUTE FUNCTION public.rfq_kiem_xoay_vong_khi_mo();
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_kiem_xoay_vong_khi_mo;
