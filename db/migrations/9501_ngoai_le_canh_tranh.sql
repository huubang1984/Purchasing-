-- ==============================================================================================
-- 9501_ngoai_le_canh_tranh — [S1.9101 / S3.3b của spec S3] NGOẠI LỆ CẠNH TRANH: LẬP VÀ RÚT Ở DRAFT, NẰM TRONG BĂM DANH
-- SÁCH MÀ NGƯỜI DUYỆT KÝ (K4a, K4b), TÁC GIẢ VÀO TẬP LOẠI TRỪ (ADR-082 ⑿)
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §4.4, §5.1 (K4, K5, K12), §8.2, §9 (S3.3).
-- ADR-084 ⑵ ⑷, ADR-108, ADR-114. Chủ dự án chốt ngày 2026-09-29: sàn giải trình của mã `OTHER` là 100 byte; người giữ
-- `rfq.invite` lập và rút ngoại lệ, chỉ ở DRAFT; CHECK nhận đủ năm loại nhưng đường ghi chỉ mở ba loại của danh sách mời; băm
-- danh sách phủ ngoại lệ CÒN SỐNG; phép khớp loại với danh sách thật và chữ ký K5 bắt buộc để S3.3c; lần từ chối K4a mang tên
-- ràng buộc. Ngày 2026-09-30 (`089`, ADR-121): S3.3b thêm vế *tác giả ngoại lệ* vào CHÍNH `rfq_tap_loai_tru`.
--
-- (1) BẢNG `rfq_sourcing_exceptions`, CHỈ GHI THÊM KÈM HÀNG RÚT — khuôn `rfq_awards` (`061`). Hai loại hàng: `LAP` mang
--     loại, mã lý do và giải trình; `RUT` trỏ về đúng một hàng `LAP` và mang lý do rút ở cột giải trình. Một ngoại lệ còn
--     sống khi không hàng `RUT` nào trỏ về nó. `UNIQUE (org_id, ngoai_le_id)` giữ mỗi ngoại lệ một lần rút, kể cả khi hai
--     lần rút đua nhau.
-- (2) TRIGGER `ngoai_le_kiem` đọc DỮ LIỆU THẬT lúc chèn: tổ chức đã bật S3; người ghi giữ `rfq.invite` (ADR-084 ⑵ — lớp gói
--     đã hỏi trước, trigger là lớp có thẩm quyền); gói ở DRAFT — vế này mang TÊN `k4a_ngoai_le_sai_trang_thai` nên tầng gói
--     ghi `CONTROL_DENIED` (K12, khuôn ADR-114); hàng `LAP` chỉ ba loại của danh sách mời (`LOW_ACTUAL_COMPETITION` là của
--     trao thầu, S3.5; `LIST_NARROWED_BELOW_MIN` là của thu hồi ở OPEN, S3.6c); hàng `RUT` trỏ về một hàng `LAP` CHƯA RÚT của
--     CÙNG gói. Khoá hàng gói `FOR SHARE` như `rfq_invitations_kiem_danh_sach` (`076`): lần nộp duyệt cập nhật chính hàng ấy,
--     nên một ngoại lệ ghi đua với lần nộp duyệt hoặc đứng trước nó (và vào băm ở chữ ký) hoặc thấy gói đã rời DRAFT.
-- (3) BĂM DANH SÁCH (`rfq_bam_danh_sach`, `076`) PHỦ NGOẠI LỆ CÒN SỐNG: người duyệt ký lên danh sách mời CÙNG ngoại lệ của
--     nó (spec §4.4, K4). Mỗi ngoại lệ một dòng `NGOAI_LE|id|loại|mã lý do|sha256 hex của giải trình` — dòng giữ độ dài cố
--     định, đổi một chữ giải trình là đổi băm. Ngoại lệ đã rút ra khỏi băm: nếu không, một ngoại lệ ghi nhầm nằm mãi trong
--     băm. Gói không có ngoại lệ nào giữ NGUYÊN băm của `076`: dòng thêm vào chỉ sinh khi có ngoại lệ sống, nên lần deploy
--     này không làm chữ ký K4b nào đã có mất hiệu lực. CHỈ ba loại của danh sách mời vào băm: hai loại còn lại của CHECK chưa
--     có đường ghi, và khi S3.5 (trao thầu) hay S3.6c (thu hồi ở OPEN) mở chúng thì hàng của chúng ghi SAU khi gói đã mở —
--     để chúng lặng lẽ đổi băm danh sách (và băm mà K9 ghim) là một quyết định không ai đặt tên. Hạng mục ấy sửa hàm này nếu
--     muốn (lượt soi hình dạng S3.3b, T3). "Còn sống" là MỘT vị từ ở ba nơi — băm, tập loại trừ, trigger: không hàng `RUT`
--     nào trỏ về nó.
-- (4) TẬP LOẠI TRỪ (`rfq_tap_loai_tru`, `089`) THÊM TÁC GIẢ NGOẠI LỆ CÒN SỐNG, cùng ba loại ấy — ADR-082 ⑿; K5 của S3.3c gọi
--     lại chính hàm này: một tập, một nơi. Người RÚT không vào: rút một ngoại lệ chỉ siết cạnh tranh, không nới — khác người
--     thu hồi lời mời.
--
-- THỨ MIGRATION NÀY KHÔNG LÀM: K2 và K5 — gồm chữ ký K5 bắt buộc cho gói có ngoại lệ và phép khớp loại với danh sách thật
-- (S3.3c); K3 (S3.3d); màn, `gieo:demo`, kịch bản 41 (S3.3e).
--
-- Mọi hàm và trigger mới hay đổi thân ghim ở `hardening.always.sql` trong CÙNG commit (S1.96).
-- ==============================================================================================

-- ============================================================================================
-- (1) BẢNG
-- ============================================================================================
CREATE TABLE rfq_sourcing_exceptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id),
  rfq_id                uuid NOT NULL,
  hanh_dong             text NOT NULL CHECK (hanh_dong IN ('LAP', 'RUT')),
  -- Hàng `RUT` trỏ về hàng `LAP` nó rút; hàng `LAP` để trống.
  ngoai_le_id           uuid,
  -- Tập ĐÓNG của spec §4.4: năm loại, bảy mã lý do (V2.1 §12 11.2). Trống ở hàng `RUT`.
  loai                  text CHECK (loai IS NULL OR loai IN ('SINGLE_SOURCE', 'LIMITED_COMPETITION', 'ROTATION',
                                                             'LOW_ACTUAL_COMPETITION', 'LIST_NARROWED_BELOW_MIN')),
  ma_ly_do              text CHECK (ma_ly_do IS NULL OR ma_ly_do IN ('PROPRIETARY_TECHNOLOGY', 'EXISTING_CONTRACT', 'EMERGENCY',
                                                                     'NO_ALTERNATIVE', 'COMPATIBILITY', 'REGULATORY', 'OTHER')),
  -- Giải trình ở hàng `LAP`, lý do rút ở hàng `RUT`. Không rỗng, trần 2000 byte như lý do trả gói về soạn thảo.
  giai_trinh            text NOT NULL CHECK (octet_length(giai_trinh) > 0 AND octet_length(giai_trinh) <= 2000),
  created_by            uuid NOT NULL,
  created_by_session_id uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, rfq_id) REFERENCES rfq_packages (org_id, id),
  FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id),
  -- Tiền đề cho khoá ngoại tự trỏ của hàng `RUT`.
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, ngoai_le_id) REFERENCES rfq_sourcing_exceptions (org_id, id),
  CONSTRAINT rfq_sourcing_exceptions_hinh_dang CHECK (
    (hanh_dong = 'LAP' AND loai IS NOT NULL AND ma_ly_do IS NOT NULL AND ngoai_le_id IS NULL)
    OR (hanh_dong = 'RUT' AND loai IS NULL AND ma_ly_do IS NULL AND ngoai_le_id IS NOT NULL)),
  -- Giải trình LƯU ĐÃ CẮT: không mở đầu hay kết thúc bằng một ký tự khoảng trắng nào trong ĐÚNG tập mà `String.prototype.trim`
  -- của tầng gói cắt (WhiteSpace + LineTerminator của ECMAScript: tab, LF, VT, FF, CR, dấu cách, U+00A0, U+1680, U+2000–U+200A,
  -- U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF). `btrim` chỉ cắt dấu cách ASCII, nên một câu thô dưới `app_api` lưu được
  -- giải trình chỉ là `\n`, hay 99 byte chữ cộng khoảng trắng để vượt sàn `OTHER` (lượt soi hình dạng S3.3b, T2). Đòi văn bản
  -- đã cắt thì hai tầng đếm trên cùng một chuỗi.
  CONSTRAINT rfq_sourcing_exceptions_giai_trinh_da_cat CHECK (
    giai_trinh !~ '^[\t\n\v\f\r \xa0\x1680\x2000-\x200a\x2028\x2029\x202f\x205f\x3000\xfeff]'
    AND giai_trinh !~ '[\t\n\v\f\r \xa0\x1680\x2000-\x200a\x2028\x2029\x202f\x205f\x3000\xfeff]$'),
  -- Sàn của mã `OTHER`: 100 byte của giải trình đã cắt — chủ dự án chốt 2026-09-29. Một mã *"khác"* không kèm lời giải thích đủ
  -- dài là đúng cái nút bấm ai cũng ký mà spec §8.2 gọi là ngoại lệ thành thủ tục.
  CONSTRAINT rfq_sourcing_exceptions_san_other CHECK (ma_ly_do IS DISTINCT FROM 'OTHER' OR octet_length(giai_trinh) >= 100),
  -- Mỗi ngoại lệ rút một lần.
  UNIQUE (org_id, ngoai_le_id)
);

CREATE INDEX rfq_sourcing_exceptions_theo_goi ON rfq_sourcing_exceptions (org_id, rfq_id);

ALTER TABLE rfq_sourcing_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_sourcing_exceptions FORCE ROW LEVEL SECURITY;

CREATE POLICY rfq_sourcing_exceptions_tenant_isolation ON rfq_sourcing_exceptions
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới SAU `027` tự mang policy khách, ĐÓNG HẲN: vì sao người mua không mời đủ nhà cung cấp là việc nội bộ.
CREATE POLICY rfq_sourcing_exceptions_khach ON rfq_sourcing_exceptions AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

-- `id` KHÔNG được cấp (INV-H14). KHÔNG `UPDATE`, KHÔNG `DELETE`: chỉ ghi thêm. `app_unseal` không đụng bảng này.
GRANT SELECT ON rfq_sourcing_exceptions TO app_api;
GRANT INSERT (org_id, rfq_id, hanh_dong, ngoai_le_id, loai, ma_ly_do, giai_trinh, created_by, created_by_session_id)
  ON rfq_sourcing_exceptions TO app_api;

-- [ADR-016] Tác giả là DẪN XUẤT từ phiên — tập loại trừ (4) đọc cột này, nên nó phải thật.
CREATE TRIGGER rfq_sourcing_exceptions_kiem_danh_tinh
  BEFORE INSERT ON rfq_sourcing_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'created_by', 'created_by_session_id');
ALTER TABLE rfq_sourcing_exceptions ENABLE ALWAYS TRIGGER rfq_sourcing_exceptions_kiem_danh_tinh;

CREATE TRIGGER rfq_sourcing_exceptions_chi_ghi_them
  BEFORE UPDATE OR DELETE ON rfq_sourcing_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE rfq_sourcing_exceptions ENABLE ALWAYS TRIGGER rfq_sourcing_exceptions_chi_ghi_them;

CREATE TRIGGER rfq_sourcing_exceptions_chan_truncate
  BEFORE TRUNCATE ON rfq_sourcing_exceptions
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE rfq_sourcing_exceptions ENABLE ALWAYS TRIGGER rfq_sourcing_exceptions_chan_truncate;

-- ============================================================================================
-- (2) LUẬT GHI — tên trigger xếp SAU `_kiem_danh_tinh` (`kiem_n` > `kiem_d`) nên `created_by` đã là người của phiên
-- ============================================================================================
-- Lần rút thứ hai nói ra bằng câu có tên (nhánh cuối); hai lần rút ĐUA nhau thì `UNIQUE (org_id, ngoai_le_id)` chặn lần sau
-- (`409` của bộ điều phối).
CREATE OR REPLACE FUNCTION public.ngoai_le_kiem() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
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
  IF trang_thai <> 'DRAFT' THEN
    RAISE EXCEPTION 'Ngoai le chi lap hay rut khi goi con o DRAFT; goi dang o % (K4a)', trang_thai
      USING ERRCODE = 'check_violation', CONSTRAINT = 'k4a_ngoai_le_sai_trang_thai';
  END IF;
  IF NEW.hanh_dong = 'LAP' THEN
    IF NEW.loai NOT IN ('SINGLE_SOURCE', 'LIMITED_COMPETITION', 'ROTATION') THEN
      RAISE EXCEPTION 'Loai ngoai le nay khong lap o danh sach moi (K4a)'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1
                   FROM public.rfq_sourcing_exceptions e
                  WHERE e.org_id = NEW.org_id AND e.id = NEW.ngoai_le_id
                    AND e.rfq_id = NEW.rfq_id AND e.hanh_dong = 'LAP') THEN
    RAISE EXCEPTION 'Hang rut phai tro ve mot ngoai le da lap cua cung goi thau (K4a)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1
               FROM public.rfq_sourcing_exceptions r
              WHERE r.org_id = NEW.org_id AND r.hanh_dong = 'RUT' AND r.ngoai_le_id = NEW.ngoai_le_id) THEN
    RAISE EXCEPTION 'Ngoai le nay da duoc rut (K4a)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_sourcing_exceptions_kiem_ngoai_le
  BEFORE INSERT ON rfq_sourcing_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.ngoai_le_kiem();
ALTER TABLE rfq_sourcing_exceptions ENABLE ALWAYS TRIGGER rfq_sourcing_exceptions_kiem_ngoai_le;

-- ============================================================================================
-- (3) BĂM DANH SÁCH PHỦ NGOẠI LỆ CÒN SỐNG
-- ============================================================================================
-- Không SECURITY DEFINER (hardening §C): chạy dưới quyền người gọi, RLS áp — như bản `076`.
CREATE OR REPLACE FUNCTION public.rfq_bam_danh_sach(p_rfq uuid) RETURNS bytea
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT sha256(convert_to(
    coalesce((SELECT string_agg(d.dong, E'\n' ORDER BY d.dong COLLATE "C")
                FROM (SELECT 'MOI|' || i.supplier_id::text || '|' || i.contact_id::text || '|' || i.link_channel AS dong
                        FROM public.rfq_invitations i
                       WHERE i.rfq_id = p_rfq AND i.revoked_at IS NULL
                      UNION ALL
                      SELECT 'NGOAI_LE|' || e.id::text || '|' || e.loai || '|' || e.ma_ly_do || '|'
                             || encode(sha256(convert_to(e.giai_trinh, 'UTF8')), 'hex') AS dong
                        FROM public.rfq_sourcing_exceptions e
                       WHERE e.rfq_id = p_rfq AND e.hanh_dong = 'LAP'
                         AND e.loai IN ('SINGLE_SOURCE', 'LIMITED_COMPETITION', 'ROTATION')
                         AND NOT EXISTS (SELECT 1 FROM public.rfq_sourcing_exceptions r
                                          WHERE r.org_id = e.org_id AND r.hanh_dong = 'RUT' AND r.ngoai_le_id = e.id)) d), ''),
    'UTF8'))
$ham$;

-- ============================================================================================
-- (4) TẬP LOẠI TRỪ CỦA MỘT GÓI (ADR-082 ⑿) — THÊM TÁC GIẢ NGOẠI LỆ CÒN SỐNG
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.rfq_tap_loai_tru(p_org uuid, p_rfq uuid) RETURNS SETOF uuid
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT DISTINCT n FROM (
    SELECT p.created_by AS n FROM public.rfq_packages p WHERE p.org_id = p_org AND p.id = p_rfq
    UNION ALL
    SELECT p.submitted_by FROM public.rfq_packages p WHERE p.org_id = p_org AND p.id = p_rfq
    UNION ALL
    SELECT i.invited_by FROM public.rfq_invitations i WHERE i.org_id = p_org AND i.rfq_id = p_rfq
    UNION ALL
    SELECT i.revoked_by FROM public.rfq_invitations i WHERE i.org_id = p_org AND i.rfq_id = p_rfq
    UNION ALL
    SELECT b.created_by FROM public.rfq_budgets b WHERE b.org_id = p_org AND b.rfq_id = p_rfq
    UNION ALL
    SELECT s.created_by
      FROM public.rfq_invitations i
      JOIN public.suppliers s ON s.org_id = i.org_id AND s.id = i.supplier_id
     WHERE i.org_id = p_org AND i.rfq_id = p_rfq
    UNION ALL
    SELECT c.created_by
      FROM public.rfq_invitations i
      JOIN public.supplier_contacts c ON c.org_id = i.org_id AND c.id = i.contact_id
     WHERE i.org_id = p_org AND i.rfq_id = p_rfq
    UNION ALL
    SELECT e.created_by
      FROM public.rfq_sourcing_exceptions e
     WHERE e.org_id = p_org AND e.rfq_id = p_rfq AND e.hanh_dong = 'LAP'
       AND e.loai IN ('SINGLE_SOURCE', 'LIMITED_COMPETITION', 'ROTATION')
       AND NOT EXISTS (SELECT 1 FROM public.rfq_sourcing_exceptions r
                        WHERE r.org_id = e.org_id AND r.hanh_dong = 'RUT' AND r.ngoai_le_id = e.id)
    UNION ALL
    SELECT a.actor_id
      FROM public.audit_events a
     WHERE a.org_id = p_org
       AND a.resource_type = 'rfq_package'
       AND a.resource_id = p_rfq
       AND a.actor_type = 'USER'
       AND a.action IN ('RFQ_SUBMITTED_FOR_APPROVAL', 'RFQ_BUDGET_SET')
  ) t
  WHERE n IS NOT NULL
$ham$;
