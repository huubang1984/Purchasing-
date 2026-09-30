-- ==============================================================================================
-- 9501_anh_xa_hang_muc — [S1.9101 / S4.3a của spec S4] ÁNH XẠ HẠNG MỤC SANG HÀNG CHUẨN, GỢI Ý, TẬP LOẠI TRỪ
-- (spec S4 §4.4, §5.1 L1 · L2 · L3 · L13; §2.4 ⑹ ⑺; §2.5 ⒀ ⒁ ⒂)
--
-- Chủ dự án chốt ngày 2026-09-30: S4.3 chia hai PR, S4.3a là CSDL và gói (không route, không màn); tập loại trừ của L3 là MỘT
-- hàm SQL dựng trên dữ liệu đã có, đọc thêm sổ kiểm toán cho hai vế mà hàng dữ liệu chỉ giữ một lần; bộ luật chuẩn hoá bản 1
-- tối thiểu; không mở đường đọc query (E6). ADR-9201.
--
-- (1) `rfq_hang_muc_bam(org, gói, dòng)` — băm của `description`, `unit`, `quantity` HIỆN TẠI của một dòng, trên
--     `jsonb_build_array(...)::text` (spec §4.4: nối bằng `':'` là mơ hồ vì `unit` là chuỗi tự do). Ánh xạ và gợi ý chỉ có
--     hiệu lực khi băm đã lưu BẰNG băm hiện tại — khuôn C-1 của `011`: gói về DRAFT và sửa dòng thì ánh xạ cũ tự thôi.
-- (2) `rfq_tap_loai_tru(org, gói)` — TRỌN tập của ADR-082 ⑿ trên dữ liệu đã có: người tạo gói; mọi `invited_by` và mọi
--     `revoked_by` (mọi hàng, kể cả đã thu hồi); người đặt ngân sách; người nộp duyệt; người tạo bản ghi nhà cung cấp và người
--     tạo người liên hệ trên danh sách. Người nộp duyệt (`submitted_by` chỉ giữ LẦN CUỐI) và người đặt ngân sách
--     (`rfq_budgets.created_by` chỉ giữ LẦN ĐẦU — các lần sau là UPDATE tại chỗ) đọc thêm từ `audit_events`
--     (`RFQ_SUBMITTED_FOR_APPROVAL`, `RFQ_BUDGET_SET`): hàng sổ ghi cùng giao dịch với lần đổi, chỉ-ghi-thêm, `app_api` đọc
--     được trong tổ chức (chủ dự án chốt 2026-09-30). Vế *tác giả ngoại lệ* CHƯA CÓ: bảng ngoại lệ là của S3.3b, và S3.3b thêm
--     vế ấy vào CHÍNH hàm này; K5 của S3.3c gọi lại nó — một tập, một nơi.
-- (3) Hai bảng chỉ-ghi-thêm, khuôn nền L1 của `079` (`du_lieu_nen_dat_thu_tu`, `kiem_danh_tinh_theo_phien`, chỉ-ghi-thêm kể
--     cả `TRUNCATE`; `id`, `seq`, `ghi_luc`, `hang_muc_bam` ngoài GRANT):
--       `rfq_item_goi_y`     — kết quả `GOI_Y`/`CAN_DUYET` của lõi chuẩn hoá: năm ứng viên đầu kèm điểm, phiên bản bộ luật
--                              (spec §2.5 ⒂: hàng đợi cần một bảng lưu gợi ý).
--       `rfq_item_mappings`  — ánh xạ: `TU_DONG` hoặc `NGUOI_DUYET`; hàng hiệu lực của một dòng là hàng mới nhất theo `seq`
--                              có băm bằng băm hiện tại. `canonical_item_id` NULL là quyết định tường minh *"không có hàng
--                              chuẩn tương ứng"*, khác với *chưa ánh xạ*. KHÔNG khoá ngoại tới `rfq_items.id`: dòng xoá được
--                              ở DRAFT (`009`), bảng này thì không.
--     KHÔNG gắn cổng `du_lieu_nen_kiem_quyen_ghi` của `083`: `TU_DONG` trước khi có bản rõ và gợi ý do người nộp duyệt ghi —
--     lượt chuẩn hoá chạy sau lần nộp (spec §4.4) —, và người ấy giữ `rfq.create`, không giữ `item.manage`. Cổng của hai bảng
--     này là luật dưới đây.
-- (4) Luật ghi — một trigger mỗi bảng, xếp TRƯỚC khuôn nền (tên `…_bat_bien` đứng trước `…_dat_thu_tu` theo thứ tự tên):
--     ⒜ Khoá tư vấn của `item_aliases` trong tổ chức — CÙNG khoá `du_lieu_nen_dat_thu_tu` giữ khi ghi một bí danh — lấy ĐẦU
--        TIÊN: lần kiểm bí danh không đua với một lần khai hay rút bí danh chưa commit, và mọi giao dịch ghi ánh xạ, gợi ý hay
--        bí danh đều khoá bí danh TRƯỚC, nên thứ tự khoá là một và không có vòng chờ.
--     ⒝ Gói khoá `FOR SHARE` rồi mới đọc: gói phải đã rời DRAFT (hàng đợi là của gói `≥ PENDING_APPROVAL`, spec §4.4), và
--        lần mở thầu — câu `UPDATE rfq_packages` của nó giữ `FOR NO KEY UPDATE` tới commit — không chen được giữa phép kiểm
--        bản rõ và câu ghi (L13, *"đo cả ca ghi TRONG lúc giao dịch mở thầu đang chạy"*).
--     ⒞ Dòng phải tồn tại; băm do trigger đặt.
--     ⒟ L2 — `TU_DONG` chỉ khi `chuoi_sach(description)` bằng một bí danh CÒN HIỆU LỰC của đúng hàng chuẩn ấy, ghi trước hàng
--        này: bí danh mới nhất theo `seq` của chuỗi ấy, không phải hàng rút, cùng `canonical_item_id` (§2.4 ⑹). Không ngưỡng
--        độ tin cậy nào ở CSDL. *"Ghi trước"* do khoá ⒜ bảo đảm: dưới khoá ấy mọi hàng bí danh nhìn thấy đã commit. Và — lượt
--        soi của vòng này — `TU_DONG` không đè một ánh xạ hiệu lực đã có của dòng (người nộp duyệt không ghi thẳng được một hàng
--        `TU_DONG` lên trên quyết định của người duyệt), và bí danh do một người TRONG tập loại trừ của gói khai thì không tự động
--        ánh xạ được: khai bí danh cho chính chuỗi của dòng rồi chạy lượt chuẩn hoá là một đường `NGUOI_DUYET` đội lốt (L3).
--     ⒠ L3 vế hành vi — người ghi `NGUOI_DUYET` giữ `item.manage` và nằm ngoài `rfq_tap_loai_tru`. `TU_DONG` và gợi ý trên gói
--        đã có bản rõ chỉ do người giữ `item.manage` ghi (chuẩn hoá hồi tố, §2.5 ⒂).
--     ⒡ L13 — gói đã có ít nhất một hàng `rfq_unsealed_bids` thì ánh xạ đòi lý do không rỗng; `TU_DONG` ở đó mang đúng mã
--        `CHUAN_HOA_HOI_TO`. Khoá theo SỰ TỒN TẠI của hàng bản rõ, không theo `status` (§2.5 ⒀).
--     ⒢ §2.5 ⒁ — ánh xạ `NULL` đòi lý do khi dòng (đúng băm hiện tại) CHƯA qua lượt chuẩn hoá nào, hay đã từng có một gợi ý
--        `GOI_Y` — ứng viên đầu có điểm gợi ý: ánh xạ `NULL` hàng loạt là lối né *"không đo được"*. *"Đã từng"*, không phải
--        *"gợi ý mới nhất"*: người nộp duyệt ghi được gợi ý, và một hàng `CAN_DUYET` ghi sau không được xoá dấu của hàng `GOI_Y`
--        trước nó. Mã `CHUAN_HOA_HOI_TO` dành riêng cho `TU_DONG`.
--     Tầng gói khoá hàng gói TRƯỚC mọi lần ghi sổ của nó (khoản 126: khoá hàng trước, khoá sổ sau) — worker mở thầu và mọi
--     cạnh trạng thái đi đúng thứ tự ấy, nên một lần duyệt kèm khai bí danh không dựng được vòng chờ với chúng.
--     Mỗi lần từ chối mang TÊN RÀNG BUỘC để tầng gói nói câu của người dùng mà không so thông báo.
--
-- Mọi hàm và trigger mới ghim ở `hardening.always.sql` trong CÙNG commit (S1.96).
-- ==============================================================================================

-- ============================================================================================
-- (1) BĂM CỦA MỘT DÒNG
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.rfq_hang_muc_bam(p_org uuid, p_rfq uuid, p_line integer) RETURNS bytea
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT pg_catalog.sha256(pg_catalog.convert_to(
           pg_catalog.jsonb_build_array(i.description, i.unit, i.quantity)::pg_catalog.text, 'UTF8'))
    FROM public.rfq_items i
   WHERE i.org_id = p_org AND i.rfq_id = p_rfq AND i.line_no = p_line
$ham$;

-- ============================================================================================
-- (2) TẬP LOẠI TRỪ CỦA MỘT GÓI (ADR-082 ⑿)
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

-- ============================================================================================
-- (3) HAI BẢNG
-- ============================================================================================
CREATE TABLE rfq_item_goi_y (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES organizations (id),
  rfq_id                  uuid NOT NULL,
  line_no                 integer NOT NULL CONSTRAINT rfq_item_goi_y_line_no_duong CHECK (line_no > 0),
  hang_muc_bam            bytea NOT NULL,
  ket_qua                 text NOT NULL CONSTRAINT rfq_item_goi_y_ket_qua_mien CHECK (ket_qua IN ('GOI_Y', 'CAN_DUYET')),
  do_tin_cay              numeric NOT NULL
                          CONSTRAINT rfq_item_goi_y_do_tin_cay_mien CHECK (do_tin_cay >= 0 AND do_tin_cay <= 1),
  phien_ban_bo_chuan_hoa  integer NOT NULL CONSTRAINT rfq_item_goi_y_phien_ban_duong CHECK (phien_ban_bo_chuan_hoa > 0),
  dau_vao                 jsonb NOT NULL CONSTRAINT rfq_item_goi_y_dau_vao_la_doi_tuong CHECK (jsonb_typeof(dau_vao) = 'object'),
  tac_gia                 uuid NOT NULL,
  session_id              uuid NOT NULL,
  seq                     bigint NOT NULL,
  ghi_luc                 timestamptz NOT NULL,
  UNIQUE (org_id, seq),
  FOREIGN KEY (org_id, rfq_id) REFERENCES rfq_packages (org_id, id),
  FOREIGN KEY (org_id, tac_gia) REFERENCES users (org_id, id)
);

CREATE TABLE rfq_item_mappings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES organizations (id),
  rfq_id                  uuid NOT NULL,
  line_no                 integer NOT NULL CONSTRAINT rfq_item_mappings_line_no_duong CHECK (line_no > 0),
  hang_muc_bam            bytea NOT NULL,
  nguon                   text NOT NULL CONSTRAINT rfq_item_mappings_nguon_mien CHECK (nguon IN ('TU_DONG', 'NGUOI_DUYET')),
  canonical_item_id       uuid,
  do_tin_cay              numeric
                          CONSTRAINT rfq_item_mappings_do_tin_cay_mien
                          CHECK (do_tin_cay IS NULL OR (do_tin_cay >= 0 AND do_tin_cay <= 1)),
  phien_ban_bo_chuan_hoa  integer NOT NULL CONSTRAINT rfq_item_mappings_phien_ban_duong CHECK (phien_ban_bo_chuan_hoa > 0),
  dau_vao                 jsonb NOT NULL
                          CONSTRAINT rfq_item_mappings_dau_vao_la_doi_tuong CHECK (jsonb_typeof(dau_vao) = 'object'),
  ly_do                   text
                          CONSTRAINT rfq_item_mappings_ly_do_hinh_dang
                          CHECK (ly_do IS NULL OR (ly_do = btrim(ly_do) AND length(ly_do) BETWEEN 1 AND 1000)),
  tac_gia                 uuid NOT NULL,
  session_id              uuid NOT NULL,
  seq                     bigint NOT NULL,
  ghi_luc                 timestamptz NOT NULL,
  CONSTRAINT rfq_item_mappings_tu_dong_co_hang CHECK (nguon <> 'TU_DONG' OR canonical_item_id IS NOT NULL),
  UNIQUE (org_id, seq),
  FOREIGN KEY (org_id, rfq_id) REFERENCES rfq_packages (org_id, id),
  FOREIGN KEY (org_id, canonical_item_id) REFERENCES canonical_items (org_id, id),
  FOREIGN KEY (org_id, tac_gia) REFERENCES users (org_id, id)
);

CREATE INDEX rfq_item_goi_y_dong_idx ON rfq_item_goi_y (org_id, rfq_id, line_no, seq DESC);
CREATE INDEX rfq_item_mappings_dong_idx ON rfq_item_mappings (org_id, rfq_id, line_no, seq DESC);

ALTER TABLE rfq_item_goi_y ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_item_goi_y FORCE ROW LEVEL SECURITY;
ALTER TABLE rfq_item_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_item_mappings FORCE ROW LEVEL SECURITY;

CREATE POLICY rfq_item_goi_y_tenant_isolation ON rfq_item_goi_y
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());
CREATE POLICY rfq_item_mappings_tenant_isolation ON rfq_item_mappings
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Policy khách ĐÓNG HẲN — khuôn `083`: nhà cung cấp không đọc được dòng của mình ánh xạ sang hàng chuẩn nào.
CREATE POLICY rfq_item_goi_y_khach ON rfq_item_goi_y AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);
CREATE POLICY rfq_item_mappings_khach ON rfq_item_mappings AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

REVOKE ALL ON rfq_item_goi_y, rfq_item_mappings FROM PUBLIC;
GRANT SELECT ON rfq_item_goi_y, rfq_item_mappings TO app_api;
GRANT INSERT (org_id, rfq_id, line_no, ket_qua, do_tin_cay, phien_ban_bo_chuan_hoa, dau_vao, tac_gia, session_id)
  ON rfq_item_goi_y TO app_api;
GRANT INSERT (org_id, rfq_id, line_no, nguon, canonical_item_id, do_tin_cay, phien_ban_bo_chuan_hoa, dau_vao, ly_do,
              tac_gia, session_id)
  ON rfq_item_mappings TO app_api;

-- ============================================================================================
-- (4) LUẬT GHI
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.goi_y_kiem_luat() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('item_aliases|' || NEW.org_id::pg_catalog.text, 3));
  SELECT p.status INTO trang_thai
    FROM public.rfq_packages p
   WHERE p.org_id = NEW.org_id AND p.id = NEW.rfq_id
     FOR SHARE;
  IF trang_thai IS NULL OR trang_thai = 'DRAFT' THEN
    RAISE EXCEPTION 'Chi chuan hoa hang muc cua goi da roi DRAFT (goi %)', NEW.rfq_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'anh_xa_goi_con_soan';
  END IF;
  NEW.hang_muc_bam := public.rfq_hang_muc_bam(NEW.org_id, NEW.rfq_id, NEW.line_no);
  IF NEW.hang_muc_bam IS NULL THEN
    RAISE EXCEPTION 'Goi % khong co dong %', NEW.rfq_id, NEW.line_no
      USING ERRCODE = 'check_violation', CONSTRAINT = 'anh_xa_khong_co_hang_muc';
  END IF;
  IF EXISTS (SELECT 1
               FROM public.rfq_unsealed_bids ub
               JOIN public.unseal_requests ur ON ur.org_id = ub.org_id AND ur.id = ub.unseal_request_id
              WHERE ur.org_id = NEW.org_id AND ur.rfq_id = NEW.rfq_id)
     AND NOT EXISTS (SELECT 1
                       FROM public.user_roles ur
                       JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                      WHERE ur.org_id = NEW.org_id AND ur.user_id = NEW.tac_gia
                        AND rp.permission_code = 'item.manage') THEN
    RAISE EXCEPTION 'Goi % da co ban ro: chi nguoi giu item.manage chuan hoa hoi to (L3)', NEW.rfq_id
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'anh_xa_hoi_to_can_item_manage';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE OR REPLACE FUNCTION public.anh_xa_kiem_luat() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
  mo_ta text;
  hang_bi_danh uuid;
  bi_danh_rut boolean;
  tac_gia_bi_danh uuid;
  co_ban_ro boolean;
  giu_item_manage boolean;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('item_aliases|' || NEW.org_id::pg_catalog.text, 3));
  SELECT p.status INTO trang_thai
    FROM public.rfq_packages p
   WHERE p.org_id = NEW.org_id AND p.id = NEW.rfq_id
     FOR SHARE;
  IF trang_thai IS NULL OR trang_thai = 'DRAFT' THEN
    RAISE EXCEPTION 'Chi anh xa hang muc cua goi da roi DRAFT (goi %)', NEW.rfq_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'anh_xa_goi_con_soan';
  END IF;
  SELECT i.description INTO mo_ta
    FROM public.rfq_items i
   WHERE i.org_id = NEW.org_id AND i.rfq_id = NEW.rfq_id AND i.line_no = NEW.line_no;
  IF mo_ta IS NULL THEN
    RAISE EXCEPTION 'Goi % khong co dong %', NEW.rfq_id, NEW.line_no
      USING ERRCODE = 'check_violation', CONSTRAINT = 'anh_xa_khong_co_hang_muc';
  END IF;
  NEW.hang_muc_bam := public.rfq_hang_muc_bam(NEW.org_id, NEW.rfq_id, NEW.line_no);

  SELECT EXISTS (SELECT 1
                   FROM public.user_roles ur
                   JOIN public.role_permissions rp ON rp.role_code = ur.role_code
                  WHERE ur.org_id = NEW.org_id AND ur.user_id = NEW.tac_gia
                    AND rp.permission_code = 'item.manage')
    INTO giu_item_manage;
  SELECT EXISTS (SELECT 1
                   FROM public.rfq_unsealed_bids ub
                   JOIN public.unseal_requests ur ON ur.org_id = ub.org_id AND ur.id = ub.unseal_request_id
                  WHERE ur.org_id = NEW.org_id AND ur.rfq_id = NEW.rfq_id)
    INTO co_ban_ro;

  IF NEW.nguon = 'TU_DONG' THEN
    SELECT a.canonical_item_id, a.rut, a.tac_gia INTO hang_bi_danh, bi_danh_rut, tac_gia_bi_danh
      FROM public.item_aliases a
     WHERE a.org_id = NEW.org_id
       AND a.bi_danh_sach = public.chuoi_sach(mo_ta)
     ORDER BY a.seq DESC
     LIMIT 1;
    IF NOT FOUND OR bi_danh_rut OR hang_bi_danh IS DISTINCT FROM NEW.canonical_item_id THEN
      RAISE EXCEPTION 'TU_DONG chi khi mo ta da lam sach trung mot bi danh con hieu luc cua dung hang chuan (L2): goi % dong %', NEW.rfq_id, NEW.line_no
        USING ERRCODE = 'check_violation', CONSTRAINT = 'anh_xa_tu_dong_khong_khop_bi_danh';
    END IF;
    IF tac_gia_bi_danh IN (SELECT public.rfq_tap_loai_tru(NEW.org_id, NEW.rfq_id)) THEN
      RAISE EXCEPTION 'Bi danh do nguoi trong tap loai tru cua goi % khai khong tu dong anh xa duoc (L3)', NEW.rfq_id
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'anh_xa_bi_danh_trong_tap_loai_tru';
    END IF;
    IF EXISTS (SELECT 1
                 FROM public.rfq_item_mappings m
                WHERE m.org_id = NEW.org_id AND m.rfq_id = NEW.rfq_id AND m.line_no = NEW.line_no
                  AND m.hang_muc_bam = NEW.hang_muc_bam) THEN
      RAISE EXCEPTION 'Dong % cua goi % da co anh xa hieu luc: TU_DONG khong de len', NEW.line_no, NEW.rfq_id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'anh_xa_tu_dong_da_co_anh_xa';
    END IF;
    IF co_ban_ro AND NOT giu_item_manage THEN
      RAISE EXCEPTION 'Goi % da co ban ro: chi nguoi giu item.manage chuan hoa hoi to (L3)', NEW.rfq_id
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'anh_xa_hoi_to_can_item_manage';
    END IF;
    IF co_ban_ro AND NEW.ly_do IS DISTINCT FROM 'CHUAN_HOA_HOI_TO' THEN
      RAISE EXCEPTION 'TU_DONG tren goi da co ban ro mang ma ly do CHUAN_HOA_HOI_TO (L13): goi %', NEW.rfq_id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'anh_xa_hoi_to_sai_ma_ly_do';
    END IF;
  ELSE
    IF NOT giu_item_manage THEN
      RAISE EXCEPTION 'Anh xa NGUOI_DUYET chi do nguoi giu item.manage ghi (L3): nguoi dung %', NEW.tac_gia
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'anh_xa_nguoi_duyet_can_item_manage';
    END IF;
    IF NEW.tac_gia IN (SELECT public.rfq_tap_loai_tru(NEW.org_id, NEW.rfq_id)) THEN
      RAISE EXCEPTION 'Nguoi ghi anh xa NGUOI_DUYET nam trong tap loai tru cua goi % (L3, ADR-082)', NEW.rfq_id
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'anh_xa_nguoi_duyet_trong_tap_loai_tru';
    END IF;
    IF NEW.ly_do = 'CHUAN_HOA_HOI_TO' THEN
      RAISE EXCEPTION 'Ma ly do CHUAN_HOA_HOI_TO danh rieng cho TU_DONG'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'anh_xa_ma_ly_do_danh_rieng';
    END IF;
    IF co_ban_ro AND NEW.ly_do IS NULL THEN
      RAISE EXCEPTION 'Goi % da co ban ro: anh xa can ly do (L13)', NEW.rfq_id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'anh_xa_sau_ban_ro_can_ly_do';
    END IF;
    IF NEW.canonical_item_id IS NULL AND NEW.ly_do IS NULL
       AND (NOT EXISTS (SELECT 1
                          FROM public.rfq_item_goi_y g
                         WHERE g.org_id = NEW.org_id AND g.rfq_id = NEW.rfq_id AND g.line_no = NEW.line_no
                           AND g.hang_muc_bam = NEW.hang_muc_bam)
            OR EXISTS (SELECT 1
                         FROM public.rfq_item_goi_y g
                        WHERE g.org_id = NEW.org_id AND g.rfq_id = NEW.rfq_id AND g.line_no = NEW.line_no
                          AND g.hang_muc_bam = NEW.hang_muc_bam AND g.ket_qua = 'GOI_Y')) THEN
      RAISE EXCEPTION 'Anh xa rong can ly do khi dong chua qua luot chuan hoa hay da tung co goi y: goi % dong %', NEW.rfq_id, NEW.line_no
        USING ERRCODE = 'check_violation', CONSTRAINT = 'anh_xa_bo_trong_can_ly_do';
    END IF;
  END IF;
  RETURN NEW;
END
$ham$;

-- Bốn trigger mỗi bảng: luật (xếp đầu), thứ tự, danh tính, chỉ-ghi-thêm (+ TRUNCATE).
CREATE TRIGGER rfq_item_goi_y_bat_bien
  BEFORE INSERT ON rfq_item_goi_y
  FOR EACH ROW EXECUTE FUNCTION public.goi_y_kiem_luat();
ALTER TABLE rfq_item_goi_y ENABLE ALWAYS TRIGGER rfq_item_goi_y_bat_bien;
CREATE TRIGGER rfq_item_goi_y_dat_thu_tu
  BEFORE INSERT ON rfq_item_goi_y
  FOR EACH ROW EXECUTE FUNCTION public.du_lieu_nen_dat_thu_tu();
ALTER TABLE rfq_item_goi_y ENABLE ALWAYS TRIGGER rfq_item_goi_y_dat_thu_tu;
CREATE TRIGGER rfq_item_goi_y_kiem_danh_tinh
  BEFORE INSERT ON rfq_item_goi_y
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('tac_gia', 'session_id');
ALTER TABLE rfq_item_goi_y ENABLE ALWAYS TRIGGER rfq_item_goi_y_kiem_danh_tinh;
CREATE TRIGGER rfq_item_goi_y_chi_ghi_them
  BEFORE UPDATE OR DELETE ON rfq_item_goi_y
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE rfq_item_goi_y ENABLE ALWAYS TRIGGER rfq_item_goi_y_chi_ghi_them;
CREATE TRIGGER rfq_item_goi_y_chan_truncate
  BEFORE TRUNCATE ON rfq_item_goi_y
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE rfq_item_goi_y ENABLE ALWAYS TRIGGER rfq_item_goi_y_chan_truncate;

CREATE TRIGGER rfq_item_mappings_bat_bien
  BEFORE INSERT ON rfq_item_mappings
  FOR EACH ROW EXECUTE FUNCTION public.anh_xa_kiem_luat();
ALTER TABLE rfq_item_mappings ENABLE ALWAYS TRIGGER rfq_item_mappings_bat_bien;
CREATE TRIGGER rfq_item_mappings_dat_thu_tu
  BEFORE INSERT ON rfq_item_mappings
  FOR EACH ROW EXECUTE FUNCTION public.du_lieu_nen_dat_thu_tu();
ALTER TABLE rfq_item_mappings ENABLE ALWAYS TRIGGER rfq_item_mappings_dat_thu_tu;
CREATE TRIGGER rfq_item_mappings_kiem_danh_tinh
  BEFORE INSERT ON rfq_item_mappings
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien('tac_gia', 'session_id');
ALTER TABLE rfq_item_mappings ENABLE ALWAYS TRIGGER rfq_item_mappings_kiem_danh_tinh;
CREATE TRIGGER rfq_item_mappings_chi_ghi_them
  BEFORE UPDATE OR DELETE ON rfq_item_mappings
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE rfq_item_mappings ENABLE ALWAYS TRIGGER rfq_item_mappings_chi_ghi_them;
CREATE TRIGGER rfq_item_mappings_chan_truncate
  BEFORE TRUNCATE ON rfq_item_mappings
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE rfq_item_mappings ENABLE ALWAYS TRIGGER rfq_item_mappings_chan_truncate;

REVOKE ALL ON FUNCTION public.rfq_hang_muc_bam(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rfq_tap_loai_tru(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.goi_y_kiem_luat() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.anh_xa_kiem_luat() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rfq_hang_muc_bam(uuid, uuid, integer) TO app_api;
GRANT EXECUTE ON FUNCTION public.rfq_tap_loai_tru(uuid, uuid) TO app_api;
