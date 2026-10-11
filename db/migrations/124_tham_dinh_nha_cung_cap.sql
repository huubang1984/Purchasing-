-- ==============================================================================================
-- 124_tham_dinh_nha_cung_cap — [S1.293 / S3.7a2 của spec S3 · K8b · K9 cổng tám] THẨM ĐỊNH ĐẦY ĐỦ TRÊN PHIÊN BẢN PASSPORT
-- MỚI NHẤT, CHẶN CHỮ KÝ DUYỆT TRAO THẦU VÀ HÀNG `APPROVED` Ở BẬC `tham_dinh_truoc_trao`; YÊU CẦU HỒ SƠ TỰ SINH LÚC ĐỀ XUẤT
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §4.8, §5.1 (K8b, K9), §9 (S3.7). ADR-081 ⑵ ⑸,
-- ADR-159 ⑴, ADR-164. Chủ dự án chốt 2026-10-10 (bốn câu, theo đề xuất): chữ ký chụp id thẩm định và THÔI ĐẾM khi thẩm định đổi;
-- yêu cầu `AWARD_PROPOSED` dưới quyền đề xuất (`award.recommend`), link tới người liên hệ ĐƯỢC MỜI của gói; cổng K9 thứ tám tái dùng
-- `coi_chot_xac_minh` (một hàm vị từ cho xác minh và thẩm định); S3.7b (tài liệu đính kèm) là PR riêng sau a2.
--
-- THẨM ĐỊNH là cấp hai của ADR-081 ⑵: trên một phiên bản Passport do nhà cung cấp nộp, chỉ đòi khi bậc cao hơn của trao thầu
-- (`award_bac_cao_hon`) bật `tham_dinh_truoc_trao`, và luôn trỏ phiên bản MỚI NHẤT — nộp phiên bản mới thì thẩm định cũ thôi hiệu lực
-- (khuôn C-1 của `011`, như băm hồ sơ của K8a). Hiệu lực của thẩm định đòi cả xác minh K8a còn hiệu lực (lượt soi S3.7a1 lượt B — C2).
--
-- (1)  YÊU CẦU HỒ SƠ TỰ SINH: `supplier_passport_requests.ly_do` mở `AWARD_PROPOSED`, cột `rfq_id` đi kèm (bắt buộc ở lý do ấy, cấm ở
--      `MANUAL`). Trigger `passport_kiem_yeu_cau` (`118`) viết lại: `MANUAL` đòi `supplier.qualify` như cũ; `AWARD_PROPOSED` đòi
--      `award.recommend` VÀ một đề xuất `PROPOSED` còn sống của CHÍNH người yêu cầu cho nhà cung cấp ấy trên gói ấy, người liên hệ phải
--      là người được mời của gói. Hàm vị từ `passport_chot_yeu_cau` (`118`) KHÔNG đổi — K8a, kênh OTP, trần ba yêu cầu áp cho cả hai.
-- (2)  BẢNG `supplier_qualifications`, CHỈ GHI THÊM — khuôn `supplier_verifications` (`082`): `QUALIFIED` trỏ một phiên bản Passport,
--      `REVOKED` có lý do; `thu_tu` dưới khoá tư vấn theo nhà cung cấp hạt giống 7 — CÙNG hạt của xác minh và phiên bản (một hàng cho mọi
--      lần ghi về độ tin của một nhà cung cấp); `het_han_at` = lúc ghi + `tham_dinh_hieu_luc_thang` của phiên bản chính sách hiệu lực.
-- (3)  LUẬT NGƯỜI Ở TRIGGER `ncc_kiem_tham_dinh`, đọc dữ liệu thật lúc chèn (khuôn ADR-051, `082` (4)): người thẩm định giữ
--      `supplier.qualify`, KHÔNG giữ `rfq.invite` (`k8b_nguoi_moi_tham_dinh`), KHÔNG tạo hồ sơ hay người liên hệ nào của nhà cung cấp
--      (`k8b_nguoi_tao_tu_tham_dinh`), và KHÔNG là người đã ĐỀ XUẤT hay đã KÝ một đề xuất `PROPOSED` còn sống cho nhà cung cấp ấy
--      (`k8b_nguoi_trao_thau_tham_dinh` — lượt soi C1: ký trước rồi thẩm định sau lách ADR-081 ⑸). Ba vế mang TÊN RÀNG BUỘC và vào sổ
--      (K12). Vế cấu hình/dữ liệu không vào sổ (ADR-060): tổ chức chưa bật; hồ sơ không MST / không ACTIVE; chưa có xác minh K8a còn
--      hiệu lực; phiên bản không thuộc nhà cung cấp hay không phải MỚI NHẤT (`tham_dinh_phien_ban_khong_moi_nhat` — tầng gói nói *đọc
--      lại*); MST phiên bản lệch MST bản ghi (`tham_dinh_mst_lech`, ADR-081 ⑴).
-- (4)  CÂU HỎI DUY NHẤT: `ncc_tham_dinh_hien_hanh(org, ncc)` — id của thẩm định CÒN HIỆU LỰC hay NULL: hàng mới nhất là `QUALIFIED`, chưa
--      hết hạn, trỏ phiên bản Passport MỚI NHẤT, xác minh K8a còn hiệu lực, và người thẩm định không khai `CO_XUNG_DOT` với nhà cung cấp
--      (lượt soi: K9 ở thẩm định chỉ là cổng lúc ghi). `ncc_tham_dinh_con_hieu_luc` là vỏ boolean. Không SECURITY DEFINER.
-- (5)  K8b Ở TRAO THẦU — hai hàm vị từ (khuôn K7/K9/K10: tầng gói hỏi trước, trigger hỏi lại, tên ràng buộc = mã viết thường, vào
--      `CHOT_THEO_RANG_BUOC`): `award_chot_tham_dinh(org, gói, báo giá, người)` — NULL khi tổ chức chưa bật, K7 chưa qua, bậc không đòi;
--      `K8B_CHUA_THAM_DINH` khi không có thẩm định hiện hành; `K8B_NGUOI_THAM_DINH_TRONG_GOI` khi người thẩm định nằm trong tập loại trừ của
--      gói (`rfq_tap_loai_tru` — người chọn người dự thi đổi vai rồi tự thẩm định: loại theo HÀNH VI); `K8B_NGUOI_THAM_DINH_TRAO_THAU` khi
--      `người` là chính người thẩm định (ADR-081 ⑸). `award_chot_tham_dinh_duyet(org, đề xuất)` cho hàng `APPROVED`: kiểm theo TẬP —
--      người đề xuất ∪ chữ ký còn hiệu lực không chứa người thẩm định.
-- (6)  CHỮ KÝ CHỤP ID THẨM ĐỊNH: cột `rfq_award_approvals.tham_dinh_id` do trigger `award_kiem_tham_dinh_chu_ky` đặt (ngoài GRANT) khi bậc
--      đòi; `award_chu_ky_con_hieu_luc` (`115`) viết lại: ở bậc đòi, chữ ký chỉ đếm khi `tham_dinh_id` BẰNG thẩm định hiện hành — phiên bản
--      Passport mới ⇒ thẩm định cũ thôi hiệu lực ⇒ chữ ký cũ thôi đếm (như chữ ký của người có xung đột, `115`), đề xuất đứng yên ở
--      `PROPOSED`, lời trả về đánh dấu; không huỷ đề xuất. Trigger `award_kiem_tham_dinh` trên `rfq_awards`: `PROPOSED` chặn người thẩm
--      định tự đề xuất; `APPROVED` hỏi (5) theo tập.
-- (7)  `award_tap_loai_tru` (`113`) viết lại: thêm người của hàng thẩm định MỚI NHẤT của nhà cung cấp — như người xác minh, người thẩm định
--      không là chữ ký độc lập của K5b. Phần còn lại nguyên văn.
-- (8)  CỔNG K9 THỨ TÁM: trigger `coi_kiem_tham_dinh` trên bảng thẩm định hỏi `coi_chot_xac_minh` (`114`) — người khai `CO_XUNG_DOT` với
--      nhà cung cấp X không thẩm định (hay thu hồi thẩm định) X. Tập mã K9 không đổi.
--
-- THỨ MIGRATION NÀY KHÔNG LÀM: màn thẩm định ở `/nha-cung-cap`, chỉ dẫn K8b ở `/mo-thau`, `gieo:demo --s3`, kịch bản pilot (S3.7a3);
-- tài liệu đính kèm (S3.7b, ADR (c)). Mọi hàm và trigger mới hay đổi thân ghim ở `hardening.always.sql` trong CÙNG commit (S1.96).
-- ==============================================================================================

-- ============================================================================================
-- (0) NHÀ CUNG CẤP CỦA MỘT PHIÊN BẢN BÁO GIÁ — một phép đọc, nhiều người dùng (trigger thẩm định, vị từ K8b, trigger yêu cầu)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.award_ncc_cua_bao_gia(p_org uuid, p_bid_version uuid) RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT i.supplier_id
    FROM public.vendor_bid_versions bv
    JOIN public.vendor_bids bd ON bd.org_id = bv.org_id AND bd.id = bv.bid_id
    JOIN public.rfq_invitations i ON i.org_id = bd.org_id AND i.id = bd.invitation_id
   WHERE bv.org_id = p_org AND bv.id = p_bid_version
$ham$;

-- ============================================================================================
-- (1) YÊU CẦU HỒ SƠ TỰ SINH LÚC ĐỀ XUẤT
-- ============================================================================================
ALTER TABLE supplier_passport_requests DROP CONSTRAINT supplier_passport_requests_ly_do_check;
ALTER TABLE supplier_passport_requests ADD CONSTRAINT supplier_passport_requests_ly_do_check
  CHECK (ly_do IN ('MANUAL', 'AWARD_PROPOSED'));
ALTER TABLE supplier_passport_requests ADD COLUMN rfq_id uuid;
ALTER TABLE supplier_passport_requests
  ADD CONSTRAINT supplier_passport_requests_rfq_fk FOREIGN KEY (org_id, rfq_id) REFERENCES rfq_packages (org_id, id);
ALTER TABLE supplier_passport_requests ADD CONSTRAINT supplier_passport_requests_rfq_theo_ly_do
  CHECK ((ly_do = 'AWARD_PROPOSED') = (rfq_id IS NOT NULL));
GRANT INSERT (rfq_id) ON supplier_passport_requests TO app_api;

-- Thân `118` + nhánh lý do: `MANUAL` đòi `supplier.qualify`; `AWARD_PROPOSED` đòi `award.recommend`, một đề xuất `PROPOSED` còn sống
-- (hàng mới nhất của gói) của CHÍNH người yêu cầu cho nhà cung cấp ấy, và người liên hệ là người được mời của gói.
CREATE OR REPLACE FUNCTION public.passport_kiem_yeu_cau() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ly_do text;
  ma_quyen text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.supplier_id::pg_catalog.text, 7));
  ma_quyen := CASE WHEN NEW.ly_do = 'AWARD_PROPOSED' THEN 'award.recommend' ELSE 'supplier.qualify' END;
  IF NOT EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id AND ur.user_id = NEW.requested_by
                    AND rp.permission_code = ma_quyen) THEN
    RAISE EXCEPTION 'Nguoi yeu cau ho so Passport phai giu % (ly do %)', ma_quyen, NEW.ly_do
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.ly_do = 'AWARD_PROPOSED' THEN
    IF NOT EXISTS (SELECT 1
                     FROM public.rfq_awards a
                    WHERE a.org_id = NEW.org_id AND a.rfq_id = NEW.rfq_id AND a.status = 'PROPOSED'
                      AND a.acted_by = NEW.requested_by
                      AND public.award_ncc_cua_bao_gia(a.org_id, a.bid_version_id) = NEW.supplier_id
                      AND a.id = (SELECT x.id FROM public.rfq_awards x
                                   WHERE x.org_id = a.org_id AND x.rfq_id = a.rfq_id
                                   ORDER BY x.acted_at DESC, x.id DESC LIMIT 1)) THEN
      RAISE EXCEPTION 'Yeu cau AWARD_PROPOSED phai di cung mot de xuat trao thau con song cua chinh nguoi yeu cau cho nha cung cap ay (K8b)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.rfq_invitations i
                    WHERE i.org_id = NEW.org_id AND i.rfq_id = NEW.rfq_id
                      AND i.supplier_id = NEW.supplier_id AND i.contact_id = NEW.contact_id) THEN
      RAISE EXCEPTION 'Link Passport cua yeu cau tu sinh phai toi nguoi lien he DUOC MOI cua goi (K8b)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  ly_do := public.passport_chot_yeu_cau(NEW.org_id, NEW.supplier_id, NEW.contact_id);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Khong gui duoc yeu cau ho so Passport: %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = lower(ly_do);
  END IF;
  RETURN NEW;
END
$ham$;

-- ============================================================================================
-- (2) BẢNG THẨM ĐỊNH
-- ============================================================================================
-- Khoá đích hợp thành cho hai khoá ngoại dưới (ADR-013: org_id đứng đầu).
ALTER TABLE supplier_passport_versions ADD CONSTRAINT supplier_passport_versions_org_id_id_key UNIQUE (org_id, id);

CREATE TABLE supplier_qualifications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id),
  supplier_id           uuid NOT NULL,
  loai                  text NOT NULL CHECK (loai IN ('QUALIFIED', 'REVOKED')),
  -- Phiên bản Passport được thẩm định — bắt buộc ở `QUALIFIED`, trống ở `REVOKED`.
  passport_version_id   uuid,
  -- Lý do bắt buộc ở `REVOKED`, cấm ở `QUALIFIED`. Trần 2000 byte như lý do thu hồi xác minh.
  ly_do                 text CHECK (ly_do IS NULL OR (octet_length(btrim(ly_do)) > 0 AND octet_length(ly_do) <= 2000)),
  -- Hai cột do trigger đặt, ngoài `GRANT`: thứ tự dưới khoá và hạn hiệu lực lúc thẩm định.
  thu_tu                bigint NOT NULL,
  het_han_at            timestamptz,
  created_by            uuid NOT NULL,
  created_by_session_id uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, supplier_id) REFERENCES suppliers (org_id, id),
  FOREIGN KEY (org_id, passport_version_id) REFERENCES supplier_passport_versions (org_id, id),
  FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id),
  CONSTRAINT supplier_qualifications_ly_do_theo_loai CHECK ((loai = 'REVOKED') = (ly_do IS NOT NULL)),
  CONSTRAINT supplier_qualifications_phien_ban_theo_loai CHECK ((loai = 'QUALIFIED') = (passport_version_id IS NOT NULL)),
  CONSTRAINT supplier_qualifications_tham_dinh_du_cot CHECK (loai = 'REVOKED' OR het_han_at IS NOT NULL),
  -- org_id đứng đầu (ADR-013); chỉ mục này cũng phục vụ câu hỏi *hàng mới nhất của nhà cung cấp X*.
  UNIQUE (org_id, supplier_id, thu_tu),
  -- Khoá đích cho `rfq_award_approvals.tham_dinh_id`.
  UNIQUE (org_id, id)
);

ALTER TABLE supplier_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_qualifications FORCE ROW LEVEL SECURITY;

CREATE POLICY supplier_qualifications_tenant_isolation ON supplier_qualifications
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới SAU `027` tự mang policy khách, ĐÓNG HẲN: thẩm định là việc nội bộ bên mua — nhà cung cấp không đọc được ai
-- đã thẩm định hồ sơ mình (kể cả phiên Passport).
CREATE POLICY supplier_qualifications_khach ON supplier_qualifications AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

-- `thu_tu`, `het_han_at`, `created_at` do CSDL đặt. KHÔNG `UPDATE`, KHÔNG `DELETE`: chỉ ghi thêm. `app_unseal` không đụng bảng này.
GRANT SELECT ON supplier_qualifications TO app_api;
GRANT INSERT (org_id, supplier_id, loai, passport_version_id, ly_do, created_by, created_by_session_id) ON supplier_qualifications TO app_api;

-- [ADR-016] Người thẩm định là DẪN XUẤT từ phiên.
CREATE TRIGGER supplier_qualifications_kiem_danh_tinh
  BEFORE INSERT ON supplier_qualifications
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'created_by', 'created_by_session_id');
ALTER TABLE supplier_qualifications ENABLE ALWAYS TRIGGER supplier_qualifications_kiem_danh_tinh;

-- Chỉ ghi thêm bằng HAI lớp, khuôn `061`: không quyền UPDATE/DELETE, và trigger chặn cả vai sở hữu.
CREATE TRIGGER supplier_qualifications_chi_ghi_them
  BEFORE UPDATE OR DELETE ON supplier_qualifications
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE supplier_qualifications ENABLE ALWAYS TRIGGER supplier_qualifications_chi_ghi_them;

CREATE TRIGGER supplier_qualifications_chan_truncate
  BEFORE TRUNCATE ON supplier_qualifications
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE supplier_qualifications ENABLE ALWAYS TRIGGER supplier_qualifications_chan_truncate;

-- ============================================================================================
-- (3) LUẬT NGƯỜI, THỨ TỰ, PHIÊN BẢN, HẠN — một trigger, tên xếp SAU `_kiem_danh_tinh` nên `created_by` đã là người của phiên
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.ncc_kiem_tham_dinh() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  nguoi_tao_ncc uuid;
  mst text;
  trang_thai text;
  loai_cuoi text;
  thang integer;
  pb_ncc uuid;
  pb_mst text;
  pb_moi_nhat uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.supplier_id::pg_catalog.text, 7));
  SELECT s.created_by, s.tax_code, s.status INTO nguoi_tao_ncc, mst, trang_thai
    FROM public.suppliers s
   WHERE s.org_id = NEW.org_id AND s.id = NEW.supplier_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay nha cung cap de tham dinh (K8b)'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RAISE EXCEPTION 'Chi to chuc da bat S3 moi tham dinh nha cung cap (ADR-080)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id AND ur.user_id = NEW.created_by
                    AND rp.permission_code = 'supplier.qualify') THEN
    RAISE EXCEPTION 'Nguoi tham dinh phai giu supplier.qualify (K8b)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1
               FROM public.user_roles ur
               JOIN public.role_permissions rp ON rp.role_code = ur.role_code
              WHERE ur.org_id = NEW.org_id AND ur.user_id = NEW.created_by
                AND rp.permission_code = 'rfq.invite') THEN
    RAISE EXCEPTION 'Nguoi giu rfq.invite khong tham dinh nha cung cap (K8b)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k8b_nguoi_moi_tham_dinh';
  END IF;
  IF nguoi_tao_ncc = NEW.created_by
     OR EXISTS (SELECT 1 FROM public.supplier_contacts c
                 WHERE c.org_id = NEW.org_id AND c.supplier_id = NEW.supplier_id
                   AND c.created_by = NEW.created_by) THEN
    RAISE EXCEPTION 'Nguoi tao ho so nha cung cap hay nguoi lien he khong tu tham dinh (K8b)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k8b_nguoi_tao_tu_tham_dinh';
  END IF;
  -- C1: người đã ĐỀ XUẤT hay đã KÝ một đề xuất `PROPOSED` còn sống (hàng mới nhất của gói) cho nhà cung cấp này không thẩm định nó —
  -- ký trước rồi thẩm định sau là lách ADR-081 ⑸ (lượt soi S3.7a1 lượt B).
  IF EXISTS (SELECT 1
               FROM public.rfq_awards a
              WHERE a.org_id = NEW.org_id AND a.status = 'PROPOSED'
                AND public.award_ncc_cua_bao_gia(a.org_id, a.bid_version_id) = NEW.supplier_id
                AND a.id = (SELECT x.id FROM public.rfq_awards x
                             WHERE x.org_id = a.org_id AND x.rfq_id = a.rfq_id
                             ORDER BY x.acted_at DESC, x.id DESC LIMIT 1)
                AND (a.acted_by = NEW.created_by
                     OR EXISTS (SELECT 1 FROM public.rfq_award_approvals ap
                                 WHERE ap.org_id = a.org_id AND ap.award_id = a.id AND ap.approver_user_id = NEW.created_by))) THEN
    RAISE EXCEPTION 'Nguoi da de xuat hay da ky trao thau cho nha cung cap nay khong tham dinh no (K8b, ADR-081 (5))'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k8b_nguoi_trao_thau_tham_dinh';
  END IF;

  SELECT q.loai INTO loai_cuoi
    FROM public.supplier_qualifications q
   WHERE q.org_id = NEW.org_id AND q.supplier_id = NEW.supplier_id
   ORDER BY q.thu_tu DESC
   LIMIT 1;
  NEW.thu_tu := coalesce((SELECT max(q.thu_tu) FROM public.supplier_qualifications q
                           WHERE q.org_id = NEW.org_id AND q.supplier_id = NEW.supplier_id), 0) + 1;

  IF NEW.loai = 'REVOKED' THEN
    IF loai_cuoi IS DISTINCT FROM 'QUALIFIED' THEN
      RAISE EXCEPTION 'Nha cung cap chua duoc tham dinh — khong co gi de thu hoi (K8b)'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.het_han_at := NULL;
    RETURN NEW;
  END IF;

  IF mst IS NULL OR trang_thai <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Chi tham dinh nha cung cap dang ACTIVE va co MST (K8b)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.ncc_xac_minh_con_hieu_luc(NEW.org_id, NEW.supplier_id) THEN
    RAISE EXCEPTION 'Nha cung cap chua co xac minh K8a con hieu luc — tham dinh dung tren xac minh (K8b, ADR-081 (2))'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tham_dinh_chua_xac_minh';
  END IF;
  SELECT v.supplier_id, v.tax_code INTO pb_ncc, pb_mst
    FROM public.supplier_passport_versions v
   WHERE v.org_id = NEW.org_id AND v.id = NEW.passport_version_id;
  IF NOT FOUND OR pb_ncc IS DISTINCT FROM NEW.supplier_id THEN
    RAISE EXCEPTION 'Phien ban Passport khong thuoc nha cung cap nay (K8b)'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT v.id INTO pb_moi_nhat
    FROM public.supplier_passport_versions v
   WHERE v.org_id = NEW.org_id AND v.supplier_id = NEW.supplier_id
   ORDER BY v.thu_tu DESC
   LIMIT 1;
  IF pb_moi_nhat IS DISTINCT FROM NEW.passport_version_id THEN
    RAISE EXCEPTION 'Tham dinh phai tro phien ban Passport MOI NHAT — nha cung cap da nop phien ban moi (K8b, ADR-081 (2))'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tham_dinh_phien_ban_khong_moi_nhat';
  END IF;
  IF pb_mst IS DISTINCT FROM mst THEN
    RAISE EXCEPTION 'MST cua phien ban Passport lech MST ban ghi nha cung cap — tham dinh tu choi (ADR-081 (1))'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tham_dinh_mst_lech';
  END IF;
  SELECT p.tham_dinh_hieu_luc_thang INTO thang
    FROM public.org_procurement_policies p
   WHERE p.org_id = NEW.org_id AND p.id = public.chinh_sach_hieu_luc(NEW.org_id, now());
  IF thang IS NULL THEN
    RAISE EXCEPTION 'Phien ban chinh sach hieu luc khong co han hieu luc tham dinh (K8b)'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.het_han_at := now() + pg_catalog.make_interval(months => thang);
  RETURN NEW;
END
$ham$;

CREATE TRIGGER supplier_qualifications_kiem_tham_dinh
  BEFORE INSERT ON supplier_qualifications
  FOR EACH ROW EXECUTE FUNCTION public.ncc_kiem_tham_dinh();
ALTER TABLE supplier_qualifications ENABLE ALWAYS TRIGGER supplier_qualifications_kiem_tham_dinh;

-- ============================================================================================
-- (8) CỔNG K9 THỨ TÁM — tên xếp SAU `_kiem_tham_dinh`; cùng hàm vị từ với xác minh (chủ dự án chốt)
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.coi_kiem_tham_dinh() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ly_do text;
BEGIN
  ly_do := public.coi_chot_xac_minh(NEW.org_id, NEW.supplier_id, NEW.created_by);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Chua tham dinh nha cung cap duoc (K9): %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = lower(ly_do);
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER supplier_qualifications_kiem_xung_dot
  BEFORE INSERT ON supplier_qualifications
  FOR EACH ROW EXECUTE FUNCTION public.coi_kiem_tham_dinh();
ALTER TABLE supplier_qualifications ENABLE ALWAYS TRIGGER supplier_qualifications_kiem_xung_dot;

-- ============================================================================================
-- (4) CÂU HỎI DUY NHẤT: THẨM ĐỊNH HIỆN HÀNH CỦA NHÀ CUNG CẤP
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.ncc_tham_dinh_hien_hanh(p_org uuid, p_ncc uuid) RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT q.id
    FROM (SELECT x.id, x.loai, x.het_han_at, x.passport_version_id, x.created_by
            FROM public.supplier_qualifications x
           WHERE x.org_id = p_org AND x.supplier_id = p_ncc
           ORDER BY x.thu_tu DESC
           LIMIT 1) q
   WHERE q.loai = 'QUALIFIED'
     AND q.het_han_at > now()
     AND q.passport_version_id = (SELECT v.id FROM public.supplier_passport_versions v
                                   WHERE v.org_id = p_org AND v.supplier_id = p_ncc
                                   ORDER BY v.thu_tu DESC
                                   LIMIT 1)
     AND public.ncc_xac_minh_con_hieu_luc(p_org, p_ncc)
     AND NOT EXISTS (SELECT 1 FROM public.coi_declarations d
                      WHERE d.org_id = p_org AND d.user_id = q.created_by
                        AND d.trang_thai = 'CO_XUNG_DOT' AND d.supplier_id = p_ncc)
$ham$;

CREATE OR REPLACE FUNCTION public.ncc_tham_dinh_con_hieu_luc(p_org uuid, p_ncc uuid) RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT public.ncc_tham_dinh_hien_hanh(p_org, p_ncc) IS NOT NULL
$ham$;

-- ============================================================================================
-- (5) K8b Ở TRAO THẦU — bậc cao hơn đòi thẩm định không; hai hàm vị từ
-- ============================================================================================
-- `false` khi tổ chức chưa bật hay K7 chưa qua (`award_chot_bac` nói trước): hàm này không ném.
CREATE OR REPLACE FUNCTION public.award_doi_tham_dinh(p_org uuid, p_rfq uuid, p_bid_version uuid) RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF NOT public.to_chuc_da_bat_s3(p_org) THEN
    RETURN false;
  END IF;
  IF public.award_chot_bac(p_org, p_rfq, p_bid_version) IS NOT NULL THEN
    RETURN false;
  END IF;
  RETURN coalesce((public.award_bac_cao_hon(p_org, p_rfq, p_bid_version) ->> 'tham_dinh_truoc_trao')::boolean, false);
END
$ham$;

CREATE OR REPLACE FUNCTION public.award_chot_tham_dinh(p_org uuid, p_rfq uuid, p_bid_version uuid, p_nguoi uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ncc uuid;
  td uuid;
  nguoi_td uuid;
BEGIN
  IF NOT public.award_doi_tham_dinh(p_org, p_rfq, p_bid_version) THEN
    RETURN NULL;
  END IF;
  ncc := public.award_ncc_cua_bao_gia(p_org, p_bid_version);
  IF ncc IS NULL THEN
    RETURN NULL;
  END IF;
  td := public.ncc_tham_dinh_hien_hanh(p_org, ncc);
  IF td IS NULL THEN
    RETURN 'K8B_CHUA_THAM_DINH';
  END IF;
  SELECT q.created_by INTO nguoi_td FROM public.supplier_qualifications q WHERE q.org_id = p_org AND q.id = td;
  IF nguoi_td IN (SELECT t.n FROM public.rfq_tap_loai_tru(p_org, p_rfq) AS t(n)) THEN
    RETURN 'K8B_NGUOI_THAM_DINH_TRONG_GOI';
  END IF;
  IF p_nguoi IS NOT NULL AND p_nguoi = nguoi_td THEN
    RETURN 'K8B_NGUOI_THAM_DINH_TRAO_THAU';
  END IF;
  RETURN NULL;
END
$ham$;

-- Hàng `APPROVED`: kiểm theo TẬP — người đề xuất ∪ chữ ký còn hiệu lực không chứa người thẩm định.
CREATE OR REPLACE FUNCTION public.award_chot_tham_dinh_duyet(p_org uuid, p_award uuid) RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  a record;
  ly_do text;
  nguoi_td uuid;
BEGIN
  SELECT x.rfq_id, x.bid_version_id, x.acted_by INTO a FROM public.rfq_awards x WHERE x.org_id = p_org AND x.id = p_award;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay de xuat trao thau % (K8b)', p_award USING ERRCODE = 'foreign_key_violation';
  END IF;
  ly_do := public.award_chot_tham_dinh(p_org, a.rfq_id, a.bid_version_id, a.acted_by);
  IF ly_do IS NOT NULL THEN
    RETURN ly_do;
  END IF;
  IF NOT public.award_doi_tham_dinh(p_org, a.rfq_id, a.bid_version_id) THEN
    RETURN NULL;
  END IF;
  SELECT q.created_by INTO nguoi_td
    FROM public.supplier_qualifications q
   WHERE q.org_id = p_org AND q.id = public.ncc_tham_dinh_hien_hanh(p_org, public.award_ncc_cua_bao_gia(p_org, a.bid_version_id));
  IF EXISTS (SELECT 1 FROM public.award_chu_ky_con_hieu_luc(p_org, p_award) k WHERE k.nguoi = nguoi_td) THEN
    RETURN 'K8B_NGUOI_THAM_DINH_TRAO_THAU';
  END IF;
  RETURN NULL;
END
$ham$;

-- ============================================================================================
-- (6) CHỮ KÝ CHỤP ID THẨM ĐỊNH; CHỮ KÝ CÒN HIỆU LỰC ĐẾM THEO THẨM ĐỊNH HIỆN HÀNH
-- ============================================================================================
ALTER TABLE rfq_award_approvals ADD COLUMN tham_dinh_id uuid;
ALTER TABLE rfq_award_approvals
  ADD CONSTRAINT rfq_award_approvals_tham_dinh_fk FOREIGN KEY (org_id, tham_dinh_id) REFERENCES supplier_qualifications (org_id, id);

-- Thân `115` + vế thẩm định: ở bậc đòi, chữ ký chỉ đếm khi `tham_dinh_id` BẰNG thẩm định hiện hành của nhà cung cấp được trao.
CREATE OR REPLACE FUNCTION public.award_chu_ky_con_hieu_luc(p_org uuid, p_award uuid) RETURNS TABLE (nguoi uuid, vai text[])
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT ap.approver_user_id, ap.vai_luc_ky
    FROM public.rfq_award_approvals ap
    JOIN public.rfq_awards a ON a.org_id = ap.org_id AND a.id = ap.award_id
   WHERE ap.org_id = p_org AND ap.award_id = p_award
     AND NOT EXISTS (SELECT 1 FROM public.coi_declarations d
                      WHERE d.org_id = ap.org_id AND d.rfq_id = a.rfq_id
                        AND d.user_id = ap.approver_user_id AND d.trang_thai = 'CO_XUNG_DOT')
     AND (NOT public.award_doi_tham_dinh(a.org_id, a.rfq_id, a.bid_version_id)
          OR ap.tham_dinh_id IS NOT DISTINCT FROM
             public.ncc_tham_dinh_hien_hanh(a.org_id, public.award_ncc_cua_bao_gia(a.org_id, a.bid_version_id)))
$ham$;

-- Trigger chữ ký: tên xếp sau `_kiem_nguoi_duyet` (J3) và trước `_kiem_tin_hieu_khai_thap`, `_kiem_vai_theo_bac`, `_kiem_xung_dot`.
-- K7 chưa qua (`award_chot_bac`) thì để trigger K7 nói; bậc không đòi thì `tham_dinh_id` NULL.
CREATE OR REPLACE FUNCTION public.award_kiem_tham_dinh_chu_ky() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  a record;
  ly_do text;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    NEW.tham_dinh_id := NULL;
    RETURN NEW;
  END IF;
  SELECT x.rfq_id, x.bid_version_id INTO a FROM public.rfq_awards x WHERE x.org_id = NEW.org_id AND x.id = NEW.award_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay de xuat trao thau % (K8b)', NEW.award_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT public.award_doi_tham_dinh(NEW.org_id, a.rfq_id, a.bid_version_id) THEN
    NEW.tham_dinh_id := NULL;
    RETURN NEW;
  END IF;
  ly_do := public.award_chot_tham_dinh(NEW.org_id, a.rfq_id, a.bid_version_id, NEW.approver_user_id);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Chu ky trao thau bi chan vi tham dinh (K8b): %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = lower(ly_do);
  END IF;
  NEW.tham_dinh_id := public.ncc_tham_dinh_hien_hanh(NEW.org_id, public.award_ncc_cua_bao_gia(NEW.org_id, a.bid_version_id));
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_award_approvals_kiem_tham_dinh
  BEFORE INSERT ON rfq_award_approvals
  FOR EACH ROW EXECUTE FUNCTION public.award_kiem_tham_dinh_chu_ky();
ALTER TABLE rfq_award_approvals ENABLE ALWAYS TRIGGER rfq_award_approvals_kiem_tham_dinh;

-- Trigger trên `rfq_awards`: `PROPOSED` — người thẩm định hiện hành không tự đề xuất (thiếu thẩm định KHÔNG chặn đề xuất: yêu cầu hồ sơ
-- tự sinh ở đây); `APPROVED` — hỏi theo tập. Tên xếp sau `rfq_awards_kiem_mot_award_song` (J7) nên hàng mới nhất đã là `PROPOSED`.
CREATE OR REPLACE FUNCTION public.award_kiem_tham_dinh() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  de_xuat uuid;
  ly_do text;
BEGIN
  IF NOT public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'PROPOSED' THEN
    ly_do := public.award_chot_tham_dinh(NEW.org_id, NEW.rfq_id, NEW.bid_version_id, NEW.acted_by);
    IF ly_do = 'K8B_NGUOI_THAM_DINH_TRAO_THAU' THEN
      RAISE EXCEPTION 'Nguoi tham dinh nha cung cap khong de xuat trao thau cho chinh nha cung cap ay (K8b, ADR-081 (5))'
        USING ERRCODE = 'check_violation', CONSTRAINT = lower(ly_do);
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status <> 'APPROVED' THEN
    RETURN NEW;
  END IF;
  SELECT a.id INTO de_xuat
    FROM public.rfq_awards a
   WHERE a.org_id = NEW.org_id AND a.rfq_id = NEW.rfq_id AND a.status = 'PROPOSED'
   ORDER BY a.acted_at DESC, a.id DESC
   LIMIT 1;
  IF de_xuat IS NULL THEN
    RETURN NEW;
  END IF;
  ly_do := public.award_chot_tham_dinh_duyet(NEW.org_id, de_xuat);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Duyet trao thau bi chan vi tham dinh (K8b): %', ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = lower(ly_do);
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_awards_kiem_tham_dinh
  BEFORE INSERT ON rfq_awards
  FOR EACH ROW
  WHEN (NEW.status IN ('PROPOSED', 'APPROVED'))
  EXECUTE FUNCTION public.award_kiem_tham_dinh();
ALTER TABLE rfq_awards ENABLE ALWAYS TRIGGER rfq_awards_kiem_tham_dinh;

-- ============================================================================================
-- (7) TẬP LOẠI TRỪ CỦA CHỮ KÝ TRAO THẦU — thân `113` + người thẩm định mới nhất
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
    UNION ALL
    SELECT q2.created_by
      FROM (SELECT q.created_by
              FROM public.supplier_qualifications q
             WHERE q.org_id = p_org
               AND q.supplier_id = public.award_ncc_cua_bao_gia(p_org, p_bid_version)
             ORDER BY q.thu_tu DESC
             LIMIT 1) q2
  ) t
  WHERE n IS NOT NULL
$ham$;
