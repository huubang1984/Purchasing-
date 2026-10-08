-- ==============================================================================================
-- 115_xung_dot_chu_ky_trao_thau — [S1.283 / S3.4b của spec S3] K9 Ở PHÉP ĐẾM CHỮ KÝ TRAO THẦU: CHỮ KÝ CỦA NGƯỜI ĐÃ KHAI
-- `CO_XUNG_DOT` KHÔNG ĐẾM Ở K7 (ĐỦ CHỮ KÝ, HAI VAI KHÁC NHAU) LẪN K5b (CHỮ KÝ ĐỘC LẬP)
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §2.5 ⒄, §4.5, §4.7, §5.1 (K9, K7, K5b), §9 (S3.4).
-- ADR-082 ⒄, ADR-154, ADR-155 ⑸ ⑼. Chủ dự án: *"Làm S3.4b đi, gộp luôn mục 2"* (2026-10-08) — mục 2 là giới hạn ADR-155 ghi ở phần
-- *không nói*: `award_du_chu_ky` (`113`) đếm người ký mà không loại người có `CO_XUNG_DOT`.
--
-- VÌ SAO (spec §2.5 ⒄): khai `CO_XUNG_DOT` SAU khi đã ký thì chữ ký vẫn nằm đó; *"phép đếm chữ ký ở cạnh mở gói và ở trao thầu loại
-- người có `CO_XUNG_DOT`"*. `114` làm vế mở gói (`rfq_chu_ky_con_hieu_luc`), còn ở trao thầu chỉ đặt một sàn riêng — hàng `APPROVED`
-- đòi ít nhất MỘT chữ ký của người không xung đột — và để việc gộp cho S3.5. S3.5a (`113`) ra đời song song với `114` nên không gộp:
-- ở bậc cần hai chữ ký, một chữ ký của người đã khai xung đột vẫn đếm vào số hai. Migration này gộp.
--
-- (1)  `award_chu_ky_con_hieu_luc(org, đề xuất)` — chữ ký của đề xuất TRỪ người đã khai `CO_XUNG_DOT` trên gói của đề xuất (ở bất kỳ
--      lúc nào, kể cả sau khi ký). Khuôn `rfq_chu_ky_con_hieu_luc` (`114`): MỘT hàm, mọi phép đếm chữ ký trao thầu đọc nó. Trả người
--      ký và `vai_luc_ky` — K7 rút hai vai khác nhau từ đúng tập này. Tổ chức chưa bật không khai được (`coi_kiem_khai_bao`), nên tập
--      ấy là mọi chữ ký — hành vi y như trước.
-- (2)  `award_du_chu_ky` (`113`) viết lại: đếm người ký khác nhau và rút hai vai khác nhau trên (1). Phần còn lại nguyên văn.
-- (3)  `award_chot_doc_lap` (`113`) viết lại: chữ ký độc lập của K5b phải thuộc (1) — người ngoài tập loại trừ mà đã khai xung đột
--      không phải chữ ký độc lập. Phần còn lại nguyên văn.
-- (4)  `coi_kiem_trao_thau` (`114`) viết lại: BỎ nhánh `APPROVED`. Trigger K7 `rfq_awards_kiem_theo_bac_khi_duyet` (`113`) xếp TRƯỚC
--      `rfq_awards_kiem_xung_dot` theo tên, chạy ở MỌI hàng `APPROVED` của tổ chức đã bật, và nay đòi `award_so_chu_ky_can` (≥ 1)
--      chữ ký KHÔNG xung đột — nhánh *ít nhất một chữ ký không xung đột* của `114` không còn tới được ca nào: mã chết trong một
--      trigger an ninh là mã không phép đo nào giữ. Lời của câu chèn thô `APPROVED` thiếu chữ ký hợp lệ nay là `k7_thieu_chu_ky`
--      (không qua bảng tên → mã: tầng gói hỏi `award_du_chu_ky` trước nên không bao giờ chạm nó — `113` (10)). Hai nhánh `PROPOSED`,
--      `CANCELLED` nguyên văn.
--
-- THỨ MIGRATION NÀY KHÔNG LÀM: lời có tên cho *"đề xuất chưa đủ vì một người ký đã khai xung đột"* — ở trao thầu đó không phải một lần
-- từ chối: `duyetTraoThau` ghi chữ ký, hỏi (2), chưa đủ thì đề xuất đứng yên ở `PROPOSED`; lời trả về đánh dấu chữ ký nào không đếm
-- (tầng gói đọc (1)). Màn khai báo, `gieo:demo`, lượt đi thử T4 (cùng vòng, ngoài CSDL).
--
-- Mọi hàm mới hay đổi thân ghim ở `hardening.always.sql` trong CÙNG commit (S1.96).
-- ==============================================================================================

-- ============================================================================================
-- (1) CHỮ KÝ TRAO THẦU CÒN HIỆU LỰC
-- ============================================================================================
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
$ham$;

-- ============================================================================================
-- (2) K7 — ĐỦ CHỮ KÝ, ĐẾM TRÊN (1)
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
  SELECT count(DISTINCT k.nguoi)::integer INTO co
    FROM public.award_chu_ky_con_hieu_luc(p_org, p_award) k;
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
                   FROM public.award_chu_ky_con_hieu_luc(p_org, p_award) x
                   JOIN public.award_chu_ky_con_hieu_luc(p_org, p_award) y ON y.nguoi <> x.nguoi,
                        unnest(coalesce(x.vai, ARRAY[]::text[])) AS vx(v),
                        unnest(coalesce(y.vai, ARRAY[]::text[])) AS vy(v)
                  WHERE vx.v <> vy.v);
END
$ham$;

-- ============================================================================================
-- (3) K5b — CHỮ KÝ ĐỘC LẬP PHẢI THUỘC (1)
-- ============================================================================================
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
               FROM public.award_chu_ky_con_hieu_luc(p_org, p_award) k
              WHERE NOT EXISTS (SELECT 1 FROM public.award_tap_loai_tru(p_org, a.rfq_id, a.bid_version_id) AS t(n)
                                 WHERE t.n = k.nguoi)) THEN
    RETURN NULL;
  END IF;
  RETURN 'K5B_THIEU_CHU_KY_DOC_LAP';
END
$ham$;

-- ============================================================================================
-- (4) CỔNG K9 Ở `rfq_awards` — BỎ NHÁNH `APPROVED`
-- ============================================================================================
-- Đề xuất và huỷ trao thầu: người hành động. Hàng `APPROVED`: không ở đây nữa — (2) đòi đủ chữ ký KHÔNG xung đột ở trigger K7 xếp trước.
-- Tên xếp sau `rfq_awards_kiem_mot_award_song`, nên hàng mới nhất đã được J7 kiểm là `PROPOSED` khi tới đây.
CREATE OR REPLACE FUNCTION public.coi_kiem_trao_thau() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  ly_do text;
BEGIN
  IF NEW.status NOT IN ('PROPOSED', 'CANCELLED') THEN
    RETURN NEW;
  END IF;
  PERFORM public.coi_khoa_goi_nguoi(NEW.rfq_id, NEW.acted_by);
  ly_do := public.coi_chot_hanh_dong(NEW.org_id, NEW.rfq_id, NEW.acted_by);
  IF ly_do IS NOT NULL THEN
    RAISE EXCEPTION 'Chua % trao thau duoc (K9): %', CASE WHEN NEW.status = 'PROPOSED' THEN 'de xuat' ELSE 'huy' END, ly_do
      USING ERRCODE = 'check_violation', CONSTRAINT = lower(ly_do);
  END IF;
  RETURN NEW;
END
$ham$;
