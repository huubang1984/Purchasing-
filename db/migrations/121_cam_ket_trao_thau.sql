-- ==============================================================================================
-- 121_cam_ket_trao_thau — [S1.288 / S4.7c1 của spec S4] LỜI KHAI TCO THÀNH CAM KẾT LƯU CÙNG ĐỀ XUẤT TRAO THẦU; HẠNG GIÁ KHÁC
-- HẠNG CHI PHÍ THÌ ĐỀ XUẤT PHẢI GIẢI TRÌNH (L8, vế cam kết)
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s4-nen-du-lieu-tri-tue.md` §2.4 ⑻, §4.8, §8.13, §9 (S4.7c). ADR-097 ⑻,
-- ADR-153 ⑻, ADR-158 ⑸. Chủ dự án chốt 2026-10-09 (ADR-160):
--   · cam kết do CSDL TỰ CHỤP lúc đề xuất — ứng dụng không gửi gì, nên không ai sửa được lời khai ở bước đề xuất;
--   · giải trình lệch hạng là một Ô RIÊNG, CSDL chốt: báo giá được đề xuất có hạng giá khác hạng chi phí của chính nó ⇒ bắt buộc.
--
-- (1) `rfq_awards.giai_trinh_lech_hang` — văn bản của người đề xuất; chỉ ở hàng `PROPOSED`. Cột thêm vào `GRANT INSERT` theo cột.
--     Không rỗng sau khi bỏ khoảng trắng — kể cả khoảng trắng Unicode và ký tự rộng 0, thứ `btrim` mặc định để lại —, tối đa 2000 ký tự.
-- (2) `award_hang_gia` — hạng của thành phần `gia` trên ĐÚNG tập hàng CÓ hạng của lượt chấm, luật bằng nhau thi đấu (1, 1, 3). Bản
--     SQL của `xepHang` mà `docBangXepHang` dùng cho cột hạng giá (ADR-158 ⑸); `luot-danh-gia.int` đối chiếu hai bản trên cùng lượt
--     chấm. Đề xuất có trước migration này không có cam kết: không lấp ngược — cam kết là lời khai LÚC đề xuất, có từ S4.7c.
-- (3) `award_kiem_giai_trinh` — trigger BEFORE INSERT của `rfq_awards`: hàng `PROPOSED` mà hạng giá khác hạng chi phí ⇒ đòi giải
--     trình; không lệch mà có giải trình ⇒ từ chối (một câu *"vì sao lệch"* trên một đề xuất không lệch là một dòng sai trong hồ sơ);
--     hàng không phải `PROPOSED` không mang giải trình — nó thuộc về đề xuất. Trigger tên `rfq_awards_xet_giai_trinh` để xếp SAU mọi
--     trigger kiểm của hàng (J3/J5, J7, bậc, K9 — BEFORE cùng sự kiện chạy theo thứ tự tên): báo giá không hạng bị J5 từ chối trước, và
--     một đề xuất bị chặn vì lý do khác nghe lý do ấy (vào sổ) chứ không nghe lời đòi giải trình.
-- (4) `rfq_award_cam_ket` — CHỈ-GHI-THÊM, một hàng mỗi đề xuất. `app_api` chỉ được ghi `(org_id, award_id)`; trigger BEFORE INSERT
--     của chính bảng điền MỌI cột còn lại từ nguồn: hàng award, hàng chấm (hạng, chi phí, thành phần kèm `nguon` — phép tính của hai
--     mã quy đổi), bản rõ đã mở (bốn ô khai qua đúng hai bộ đọc của lượt chấm — `bid_so_tien`, `bid_so_ngay`), hàng gói (tập mã,
--     tham số, số ngày giao — ảnh chụp lúc mở, `112` (4), `117`). Trigger AFTER INSERT của `rfq_awards` ghi hàng ấy cho mỗi đề xuất.
--     Cam kết chỉ ghi được trong CHÍNH giao dịch của lần đề xuất (`acted_at` của hàng award là `now()` của giao dịch ghi nó, và
--     `app_api` không ghi được `acted_at`): một đề xuất có trước migration này, hay một hàng mà trigger chụp không chạy, không nhận được
--     một cam kết viết sau.
-- (5) `luot_cham_kiem_hang` — trigger BEFORE INSERT của `rfq_evaluation_lines` [rà soát §S1.288 TRUNG-1]: hàng chấm chỉ ghi trong CHÍNH
--     giao dịch tạo lượt, cho báo giá của ĐÚNG gói — hạng giá của (2) không bị một hàng chèn sau làm lệch.
-- ==============================================================================================

-- (1) -------------------------------------------------------------------------------------------
ALTER TABLE rfq_awards
  ADD COLUMN giai_trinh_lech_hang text CHECK (
    giai_trinh_lech_hang IS NULL
    OR (char_length(giai_trinh_lech_hang) <= 2000
        AND giai_trinh_lech_hang ~ '[^[:space:]\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]'));

GRANT INSERT (giai_trinh_lech_hang) ON rfq_awards TO app_api;

-- (2) -------------------------------------------------------------------------------------------
-- Dạng `tien` hai chữ số lẻ là dạng `vietSo` lượt chấm ghi; dạng khác (một đường ghi thứ hai — `057` chỉ đòi chuỗi) không vào hạng
-- giá, cùng luật của `docBangXepHang` (rà soát §S1.286 THẤP-7). Một hàng mang hai thành phần `gia` (cũng chỉ qua đường ghi thứ hai — J1
-- không đòi mã duy nhất) chỉ tính thành phần ĐẦU, như `find` của `docBangXepHang`.
CREATE OR REPLACE FUNCTION public.award_hang_gia(p_org uuid, p_evaluation uuid, p_bid uuid) RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  WITH dau AS (
    SELECT DISTINCT ON (l.bid_version_id) l.bid_version_id, c.value ->> 'tien' AS tien
      FROM public.rfq_evaluation_lines l,
           jsonb_array_elements(l.components) WITH ORDINALITY AS c(value, thu_tu)
     WHERE l.org_id = p_org
       AND l.evaluation_id = p_evaluation
       AND l.rank IS NOT NULL
       AND c.value ->> 'ma' = 'gia'
     ORDER BY l.bid_version_id, c.thu_tu
  ), gia AS (
    SELECT d.bid_version_id, d.tien::numeric AS tien
      FROM dau d
     WHERE d.tien ~ '^[0-9]{1,16}\.[0-9]{2}$'
  )
  SELECT CASE WHEN m.tien IS NULL THEN NULL
              ELSE 1 + (SELECT count(*) FROM gia g WHERE g.tien < m.tien)::integer
         END
    FROM (SELECT (SELECT g.tien FROM gia g WHERE g.bid_version_id = p_bid) AS tien) m
$ham$;

-- (3) -------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.award_kiem_giai_trinh() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  hang_tco integer;
  hang_gia integer;
BEGIN
  IF NEW.status <> 'PROPOSED' THEN
    IF NEW.giai_trinh_lech_hang IS NOT NULL THEN
      RAISE EXCEPTION 'Giai trinh lech hang chi thuoc ve hang de xuat trao thau (L8)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'award_giai_trinh_ngoai_de_xuat';
    END IF;
    RETURN NEW;
  END IF;
  SELECT l.rank INTO hang_tco
    FROM public.rfq_evaluation_lines l
   WHERE l.org_id = NEW.org_id AND l.evaluation_id = NEW.evaluation_id AND l.bid_version_id = NEW.bid_version_id;
  hang_gia := public.award_hang_gia(NEW.org_id, NEW.evaluation_id, NEW.bid_version_id);
  IF hang_gia IS DISTINCT FROM hang_tco THEN
    IF NEW.giai_trinh_lech_hang IS NULL THEN
      RAISE EXCEPTION 'Bao gia duoc de xuat co hang gia khac hang chi phi: de xuat trao thau can giai trinh lech hang (L8)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'award_thieu_giai_trinh_lech_hang';
    END IF;
  ELSIF NEW.giai_trinh_lech_hang IS NOT NULL THEN
    RAISE EXCEPTION 'Bao gia duoc de xuat co hang gia bang hang chi phi: khong co lech hang nao de giai trinh (L8)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'award_giai_trinh_khong_can';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_awards_xet_giai_trinh
  BEFORE INSERT ON rfq_awards
  FOR EACH ROW EXECUTE FUNCTION public.award_kiem_giai_trinh();
ALTER TABLE rfq_awards ENABLE ALWAYS TRIGGER rfq_awards_xet_giai_trinh;

-- (4) -------------------------------------------------------------------------------------------
CREATE TABLE rfq_award_cam_ket (
  org_id               uuid NOT NULL REFERENCES organizations(id),
  award_id             uuid NOT NULL,
  rfq_id               uuid NOT NULL,
  evaluation_id        uuid NOT NULL,
  bid_version_id       uuid NOT NULL,
  -- Hạng của báo giá theo chi phí hiệu dụng (`rank` của hàng chấm) và theo giá (`award_hang_gia`) LÚC đề xuất.
  hang_tco             integer NOT NULL,
  hang_gia             integer,
  effective_cost       numeric(18, 2) NOT NULL,
  -- Thành phần của hàng chấm nguyên văn — mã quy đổi mang `nguon` (cơ sở, ngày khai, ngày chuẩn hay yêu cầu, tỷ lệ).
  components           jsonb NOT NULL,
  -- Bốn ô khai của phong bì qua đúng bộ đọc của lượt chấm: `freight`, `importCost` (tiền, hai chữ số lẻ, chuỗi), `paymentDays`,
  -- `leadTimeDays` (số ngày) — `null` khi vắng hay không đọc được.
  khai                 jsonb NOT NULL,
  -- Ảnh chụp lúc gói mở: tập mã và nhóm khoá `tco` của phiên bản ghim, số ngày giao yêu cầu.
  tap_ma               text[],
  tham_so              jsonb,
  so_ngay_giao         integer,
  giai_trinh_lech_hang text,
  chup_luc             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, award_id),
  FOREIGN KEY (org_id, award_id) REFERENCES rfq_awards (org_id, id),
  FOREIGN KEY (org_id, rfq_id) REFERENCES rfq_packages (org_id, id),
  FOREIGN KEY (org_id, evaluation_id, bid_version_id)
    REFERENCES rfq_evaluation_lines (org_id, evaluation_id, bid_version_id),
  CHECK (jsonb_typeof(components) = 'array'),
  CHECK (jsonb_typeof(khai) = 'object')
);

ALTER TABLE rfq_award_cam_ket ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_award_cam_ket FORCE ROW LEVEL SECURITY;

CREATE POLICY rfq_award_cam_ket_tenant_isolation ON rfq_award_cam_ket
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- Đóng với phiên khách — cùng quyết định của `rfq_awards` (`061`): lời khai của người thắng là tin của người mua.
CREATE POLICY rfq_award_cam_ket_khach ON rfq_award_cam_ket AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

-- Hai cột khoá là MỌI THỨ `app_api` ghi được: phần còn lại do trigger dưới điền từ nguồn, và một cột ngoài `GRANT` mà lời gọi tự
-- khai là 42501 — không một giá trị nào của ứng dụng đi vào cam kết.
GRANT SELECT ON rfq_award_cam_ket TO app_api;
GRANT INSERT (org_id, award_id) ON rfq_award_cam_ket TO app_api;

CREATE OR REPLACE FUNCTION public.award_dien_cam_ket() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  aw record;
  dong record;
  goi record;
  ban_ro jsonb;
BEGIN
  SELECT a.rfq_id, a.evaluation_id, a.bid_version_id, a.status, a.giai_trinh_lech_hang, a.acted_at INTO aw
    FROM public.rfq_awards a
   WHERE a.org_id = NEW.org_id AND a.id = NEW.award_id;
  IF NOT FOUND OR aw.status <> 'PROPOSED' THEN
    RAISE EXCEPTION 'Cam ket TCO chi ghi cho mot hang de xuat trao thau (L8)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'cam_ket_chi_cho_de_xuat';
  END IF;
  IF aw.acted_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'Cam ket TCO chi ghi trong chinh giao dich de xuat trao thau (L8)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'cam_ket_ngoai_giao_dich_de_xuat';
  END IF;
  SELECT l.rank, l.effective_cost, l.components INTO dong
    FROM public.rfq_evaluation_lines l
   WHERE l.org_id = NEW.org_id AND l.evaluation_id = aw.evaluation_id AND l.bid_version_id = aw.bid_version_id;
  SELECT u.payload INTO ban_ro
    FROM public.rfq_unsealed_bids u
   WHERE u.org_id = NEW.org_id AND u.bid_version_id = aw.bid_version_id;
  SELECT r.tco_ma_ghim, r.tco_tham_so_ghim, r.so_ngay_giao INTO goi
    FROM public.rfq_packages r
   WHERE r.org_id = NEW.org_id AND r.id = aw.rfq_id;

  NEW.rfq_id := aw.rfq_id;
  NEW.evaluation_id := aw.evaluation_id;
  NEW.bid_version_id := aw.bid_version_id;
  NEW.hang_tco := dong.rank;
  NEW.hang_gia := public.award_hang_gia(NEW.org_id, aw.evaluation_id, aw.bid_version_id);
  NEW.effective_cost := dong.effective_cost;
  NEW.components := dong.components;
  NEW.khai := jsonb_build_object(
    'freight', round(public.bid_so_tien(ban_ro ->> 'freight'), 2)::text,
    'importCost', round(public.bid_so_tien(ban_ro ->> 'importCost'), 2)::text,
    'paymentDays', public.bid_so_ngay(ban_ro ->> 'paymentDays'),
    'leadTimeDays', public.bid_so_ngay(ban_ro ->> 'leadTimeDays')
  );
  NEW.tap_ma := goi.tco_ma_ghim;
  NEW.tham_so := goi.tco_tham_so_ghim;
  NEW.so_ngay_giao := goi.so_ngay_giao;
  NEW.giai_trinh_lech_hang := aw.giai_trinh_lech_hang;
  NEW.chup_luc := now();
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_award_cam_ket_dien
  BEFORE INSERT ON rfq_award_cam_ket
  FOR EACH ROW EXECUTE FUNCTION public.award_dien_cam_ket();
ALTER TABLE rfq_award_cam_ket ENABLE ALWAYS TRIGGER rfq_award_cam_ket_dien;

-- Chỉ ghi thêm, chặn cả superuser — cùng hàm của `rfq_awards` (`061`), và chốt `TRUNCATE` riêng cấp câu lệnh (khoản nợ 79).
CREATE TRIGGER rfq_award_cam_ket_chi_ghi_them
  BEFORE UPDATE OR DELETE ON rfq_award_cam_ket
  FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE rfq_award_cam_ket ENABLE ALWAYS TRIGGER rfq_award_cam_ket_chi_ghi_them;

CREATE TRIGGER rfq_award_cam_ket_chan_truncate
  BEFORE TRUNCATE ON rfq_award_cam_ket
  FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
ALTER TABLE rfq_award_cam_ket ENABLE ALWAYS TRIGGER rfq_award_cam_ket_chan_truncate;

-- Mỗi đề xuất một cam kết — trong CHÍNH giao dịch của lần đề xuất: lần ghi hỏng thì đề xuất không có.
CREATE OR REPLACE FUNCTION public.award_chup_cam_ket() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  INSERT INTO public.rfq_award_cam_ket (org_id, award_id) VALUES (NEW.org_id, NEW.id);
  RETURN NULL;
END
$ham$;

CREATE TRIGGER rfq_awards_chup_cam_ket
  AFTER INSERT ON rfq_awards
  FOR EACH ROW WHEN (NEW.status = 'PROPOSED') EXECUTE FUNCTION public.award_chup_cam_ket();
ALTER TABLE rfq_awards ENABLE ALWAYS TRIGGER rfq_awards_chup_cam_ket;

-- (5) -------------------------------------------------------------------------------------------
-- [rà soát §S1.288 — TRUNG-1] HÀNG CHẤM CHỈ GHI TRONG GIAO DỊCH TẠO LƯỢT, CHO BÁO GIÁ CỦA ĐÚNG GÓI. `057` cấp `app_api` `GRANT
-- INSERT` theo cột trên `rfq_evaluation_lines`, và trigger duy nhất của bảng (`rfq_evaluation_lines_kiem_thanh_phan`) chỉ kiểm hình dạng
-- thành phần: một câu ghi thẳng (đường ghi thứ hai) chèn được vào lượt chấm MỚI NHẤT — đã commit — một hàng có hạng với `gia` rẻ hơn
-- (phiên bản vòng 1 trước BAFO, báo giá của gói khác). Từ (2) và (3) đó là đổi được hạng giá mà lời đòi giải trình dựa vào, và cả bảng
-- xếp hạng không còn là sản phẩm của đúng một lần chấm (J1). `taoLuotDanhGia` ghi lượt và mọi hàng của nó trong CÙNG giao dịch;
-- `rfq_evaluations.created_at` là `now()` của giao dịch ấy (`057` — ngoài `GRANT INSERT`), nên `created_at = now()` là vế *"cùng giao
-- dịch"* — khuôn khoá ngoại benchmark của `103` và cam kết ở (4). Vế *"đúng gói"* đi qua lời mời của báo giá.
--
-- KHÔNG làm, nói ra: một đường ghi thứ hai dựng TRỌN một lượt chấm mới trong giao dịch của nó vẫn chọn được hàng của lượt ấy trong các
-- báo giá đã mở của gói — vế ấy là J2 (lượt chấm tái lập được từ bản rõ), đo ở bộ kiểm ngoại tuyến của bộ bằng chứng, không ở đây.
CREATE OR REPLACE FUNCTION public.luot_cham_kiem_hang() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  luot record;
BEGIN
  SELECT e.rfq_id, e.created_at INTO luot
    FROM public.rfq_evaluations e
   WHERE e.org_id = NEW.org_id AND e.id = NEW.evaluation_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF luot.created_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'Hang xep hang chi ghi trong chinh giao dich tao luot cham % (J1)', NEW.evaluation_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'hang_cham_ngoai_giao_dich_luot';
  END IF;
  IF NOT EXISTS (SELECT 1
                   FROM public.vendor_bid_versions v
                   JOIN public.vendor_bids b ON b.org_id = v.org_id AND b.id = v.bid_id
                   JOIN public.rfq_invitations i ON i.org_id = b.org_id AND i.id = b.invitation_id
                  WHERE v.org_id = NEW.org_id AND v.id = NEW.bid_version_id AND i.rfq_id = luot.rfq_id) THEN
    RAISE EXCEPTION 'Bao gia % khong thuoc goi thau cua luot cham % (J1)', NEW.bid_version_id, NEW.evaluation_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'hang_cham_bao_gia_goi_khac';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_evaluation_lines_kiem_luot
  BEFORE INSERT ON rfq_evaluation_lines
  FOR EACH ROW EXECUTE FUNCTION public.luot_cham_kiem_hang();
ALTER TABLE rfq_evaluation_lines ENABLE ALWAYS TRIGGER rfq_evaluation_lines_kiem_luot;
