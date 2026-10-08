-- ==============================================================================================
-- 9501_tco_tham_so_ghim — [S1.9101 / S4.7b2 của spec S4] THAM SỐ QUY ĐỔI TCO CHỤP VÀO GÓI LÚC MỞ — NHÀ CUNG CẤP THẤY CÁCH MÌNH
-- BỊ QUY ĐỔI, VÀ ĐÓ LÀ ĐÚNG THƯỚC LƯỢT CHẤM DÙNG (L16)
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s4-nen-du-lieu-tri-tue.md` §4.8, §8.6, §9 (S4.7b2). ADR-153 ⑸, ADR-156 ⑵.
-- Chủ dự án chốt 2026-10-08: nhà cung cấp thấy tập mã, số ngày giao yêu cầu VÀ tham số quy đổi của phiên bản ghim — *"trả sớm hơn kỳ
-- chuẩn 60 ngày tính chi phí vốn 12%/năm"*. Hồ sơ mời thầu nêu cách xác định giá đánh giá là thông lệ của Luật Đấu thầu.
--
-- VÌ SAO MỘT CỘT: `org_procurement_policies_khach` là vị từ ĐÓNG (`027`) — mở nó lộ ngưỡng, bậc S3, ngưỡng benchmark. `112` (4) đã
-- chụp TẬP MÃ lên hàng gói vì đúng lý do ấy; tham số đi cùng đường: cột `tco_tham_so_ghim` NGOÀI mọi `GRANT` ghi, chỉ trigger cạnh vào
-- OPEN đặt nó, từ CÙNG phiên bản ghim với tập mã. Phiên bản chính sách không sửa được (chỉ `INSERT`), nên ảnh chụp và phiên bản ghim
-- mang cùng giá trị — lượt chấm đối chiếu hai bên như với tập mã (`docChinhSach`), lệch thì không chấm.
--
-- (1) Cột và giá trị cho gói đã mở trước migration này — nhóm khoá `tco` của chính phiên bản ghim của chúng (`NULL` khi phiên bản ấy
--     không khai). Vai chạy migration có BYPASSRLS (ADR-061); câu chỉ đổi cột mới, nên không trigger cạnh nào xét gì (`112` (4)).
-- (2) `rfq_tco_khi_mo` (`112` (5)) định nghĩa lại: thêm ĐÚNG một câu chụp tham số. Phần còn lại nguyên văn.
-- ==============================================================================================

-- (1) -------------------------------------------------------------------------------------------
ALTER TABLE rfq_packages ADD COLUMN tco_tham_so_ghim jsonb;

UPDATE rfq_packages r
   SET tco_tham_so_ghim = (SELECT o.tco FROM org_procurement_policies o
                            WHERE o.org_id = r.org_id AND o.id = r.chinh_sach_ghim_id)
 WHERE r.chinh_sach_ghim_id IS NOT NULL;

-- (2) -------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rfq_tco_khi_mo() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  v_ma text[];
  v_tham_so jsonb;
  can integer;
  nen integer;
  co integer;
BEGIN
  SELECT array_agg(c.value ->> 'ma' ORDER BY c.thu_tu) INTO v_ma
    FROM public.org_procurement_policies o,
         jsonb_array_elements(o.eval_components) WITH ORDINALITY AS c(value, thu_tu)
   WHERE o.org_id = NEW.org_id AND o.id = NEW.chinh_sach_ghim_id;
  NEW.tco_ma_ghim := v_ma;
  SELECT o.tco INTO v_tham_so
    FROM public.org_procurement_policies o
   WHERE o.org_id = NEW.org_id AND o.id = NEW.chinh_sach_ghim_id;
  NEW.tco_tham_so_ghim := v_tham_so;

  IF 'chi_phi_tre' = ANY (v_ma) AND NEW.so_ngay_giao IS NULL THEN
    RAISE EXCEPTION 'Phien ban chinh sach ghim tinh chi phi tre giao nhung goi thau chua khai so ngay giao yeu cau (L16)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tco_thieu_so_ngay_giao';
  END IF;

  IF public.to_chuc_da_bat_s3(NEW.org_id) THEN
    RETURN NEW;
  END IF;
  can := CASE WHEN NEW.requires_dual_approval THEN 2 ELSE 1 END;
  SELECT count(*)::integer INTO nen
    FROM public.rfq_approvals a
   WHERE a.org_id = NEW.org_id AND a.rfq_id = NEW.id AND a.approved_content_hash = public.rfq_bam_noi_dung(NEW.id);
  IF nen < can THEN
    RETURN NEW;
  END IF;

  SELECT count(DISTINCT a.approver_user_id)::integer INTO co
    FROM public.rfq_approvals a
   WHERE a.org_id = NEW.org_id AND a.rfq_id = NEW.id
     AND a.approved_content_hash = public.rfq_bam_noi_dung(NEW.id)
     AND a.approved_delivery_hash = public.rfq_bam_giao_hang(NEW.id);
  IF co < can THEN
    RAISE EXCEPTION 'RFQ nay can % NGUOI KY TREN NOI DUNG VA SO NGAY GIAO HIEN TAI, moi co % (L16)', can, co
      USING ERRCODE = 'check_violation', CONSTRAINT = 'giao_hang_chua_ky';
  END IF;
  RETURN NEW;
END
$ham$;
