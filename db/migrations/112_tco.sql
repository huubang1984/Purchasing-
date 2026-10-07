-- ==============================================================================================
-- 112_tco — [S1.279 / S4.7a của spec S4] TCO: NHÓM KHOÁ `tco` CỦA CHÍNH SÁCH, SỐ NGÀY GIAO YÊU CẦU CỦA GÓI (CHỈ SỬA Ở DRAFT,
-- NẰM TRONG CHỮ KÝ PHÊ DUYỆT), TẬP MÃ THÀNH PHẦN GHIM Ở CẠNH VÀO OPEN, BỘ ĐỌC Ô KHAI SỐ NGÀY (L8, L16)
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s4-nen-du-lieu-tri-tue.md` §2.4 ⑸⑻, §2.5 ⒃㉑, §4.1, §4.8, §5.1 L8, §9 S4.7.
-- ADR-153. Chủ dự án chốt 2026-10-07: S4.7 tách ba phần, vế cam kết lưu cùng award (S4.7c) đi sau S3.5; chi phí trễ là TỶ LỆ của
-- giá trị báo giá mỗi ngày (`ty_le_tre_ngay`, không phải số tiền cố định — không phụ thuộc đơn vị tiền); phiên bản ghim tính chi phí
-- trễ mà gói chưa khai số ngày giao thì CHẶN Ở CẠNH MỞ; số ngày giao vào chữ ký phê duyệt ở MỌI tổ chức bằng một băm riêng và một
-- trigger riêng — không định nghĩa lại `rfq_bam_noi_dung` (CAO ⑥ của §S1.139) hay `rfq_kiem_chuyen_trang_thai`.
--
-- THỨ MIGRATION NÀY KHÔNG LÀM: không nới `057` (không `CHECK` nào của nó liệt kê mã — spec §2.5 ⒃); tập mã có nguồn, `chat_luong`,
-- `he_so` của mã `TIEN` bằng 1 và đủ tham số quy đổi đều kiểm LÚC CHẤM ở tầng gói, bằng câu gọi tên (ADR-053 ⑶). Không route, không
-- màn (S4.7b). Không lưu lời khai cùng award (S4.7c, sau S3.5).
-- ==============================================================================================

-- ============================================================================================
-- (1) NHÓM KHOÁ `tco` CỦA PHIÊN BẢN CHÍNH SÁCH
-- ============================================================================================
-- Ba khoá, mọi giá trị là CHUỖI (ADR-053 ⑴), mỗi khoá tuỳ chọn; nhóm `NULL` là *"chưa cấu hình"*. Object rỗng bị từ chối: một nhóm
-- có hai cách viết cho cùng một nghĩa là một chỗ để hai bộ đọc bất đồng.
--   `chi_phi_von_nam`        — chi phí vốn một năm, tỷ lệ (0, 1], tối đa 4 chữ số lẻ ("0.12" = 12 %/năm);
--   `ngay_thanh_toan_chuan`  — kỳ thanh toán chuẩn của tổ chức, số ngày [0, 365];
--   `ty_le_tre_ngay`         — chi phí trễ giao mỗi ngày, tỷ lệ của giá trị báo giá (0, 0.1], tối đa 6 chữ số lẻ ("0.001" = 0,1 %/ngày).
-- Hai khoá đầu CÙNG có hoặc CÙNG không: công thức chi phí thanh toán cần cả hai. Biên bằng `.double()` (spec §2.5 ㉒): đó là ngưỡng
-- và tỷ lệ, so bằng số thực chấp nhận được; PHÉP TÍNH tiền ở tầng gói đọc chính CHUỖI, chính xác. Lax mode: khoá vắng ⇒ đường
-- `$.khoa` rỗng ⇒ vế ấy qua; kiểu đã ép là chuỗi ở vế trước, nên `like_regex` không bao giờ ra *unknown* trên một số JSON.
ALTER TABLE org_procurement_policies ADD COLUMN tco jsonb;

ALTER TABLE org_procurement_policies
  ADD CONSTRAINT org_procurement_policies_tco_hinh_dang
  CHECK (tco IS NULL
         OR (pg_catalog.jsonb_typeof(tco) OPERATOR(pg_catalog.=) 'object'
             AND tco OPERATOR(pg_catalog.<>) '{}'::pg_catalog.jsonb
             AND (tco OPERATOR(pg_catalog.-) ARRAY['chi_phi_von_nam', 'ngay_thanh_toan_chuan', 'ty_le_tre_ngay']::pg_catalog.text[])
                 OPERATOR(pg_catalog.=) '{}'::pg_catalog.jsonb
             AND NOT pg_catalog.jsonb_path_exists(tco, 'strict $.* ? (@.type() != "string")')
             AND (tco OPERATOR(pg_catalog.?) 'chi_phi_von_nam') OPERATOR(pg_catalog.=) (tco OPERATOR(pg_catalog.?) 'ngay_thanh_toan_chuan')
             AND NOT pg_catalog.jsonb_path_exists(
                   tco, '$.chi_phi_von_nam ? (!(@ like_regex "^[01]([.][0-9]{1,4})?$") || @.double() <= 0 || @.double() > 1)')
             AND NOT pg_catalog.jsonb_path_exists(
                   tco, '$.ngay_thanh_toan_chuan ? (!(@ like_regex "^(0|[1-9][0-9]{0,2})$") || @.double() > 365)')
             AND NOT pg_catalog.jsonb_path_exists(
                   tco, '$.ty_le_tre_ngay ? (!(@ like_regex "^0([.][0-9]{1,6})?$") || @.double() <= 0 || @.double() > 0.1)')));

-- Cộng dồn vào tập `INSERT` theo cột. Vẫn KHÔNG `UPDATE`: đổi tham số là một phiên bản mới.
GRANT INSERT (tco) ON org_procurement_policies TO app_api;

-- ============================================================================================
-- (2) SỐ NGÀY GIAO YÊU CẦU CỦA GÓI — CHỈ SỬA Ở DRAFT
-- ============================================================================================
-- Của GÓI, không của chính sách (spec §4.8). Một cột với trigger riêng — khuôn `category_id` của `085` (5): khối *"chỉ sửa ở DRAFT"*
-- của `rfq_kiem_chuyen_trang_thai` chỉ phủ `title` và `requires_dual_approval`, và định nghĩa lại thân ấy là đụng một thân ghim của
-- S1/S3. Tuỳ chọn: gói không khai thì không có gì đổi — trừ khi phiên bản ghim lúc mở tính chi phí trễ, khi ấy cạnh mở từ chối (5).
ALTER TABLE rfq_packages ADD COLUMN so_ngay_giao integer;
ALTER TABLE rfq_packages
  ADD CONSTRAINT rfq_packages_so_ngay_giao_mien
  CHECK (so_ngay_giao IS NULL
         OR (so_ngay_giao OPERATOR(pg_catalog.>=) 1 AND so_ngay_giao OPERATOR(pg_catalog.<=) 3650));
GRANT INSERT (so_ngay_giao), UPDATE (so_ngay_giao) ON rfq_packages TO app_api;

CREATE OR REPLACE FUNCTION public.rfq_kiem_so_ngay_giao() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF NEW.so_ngay_giao IS DISTINCT FROM OLD.so_ngay_giao AND OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'So ngay giao yeu cau cua goi thau chi doi duoc o DRAFT (L16)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'so_ngay_giao_chi_doi_o_draft';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_packages_so_ngay_giao
  BEFORE UPDATE OF so_ngay_giao ON rfq_packages
  FOR EACH ROW EXECUTE FUNCTION public.rfq_kiem_so_ngay_giao();
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_so_ngay_giao;

-- ============================================================================================
-- (3) SỐ NGÀY GIAO NẰM TRONG CHỮ KÝ PHÊ DUYỆT — BĂM RIÊNG, MỌI TỔ CHỨC
-- ============================================================================================
-- Không có vế này, gói trả về DRAFT, đổi số ngày giao (đổi được nhà cung cấp nào kịp giao), rồi nộp lại: `title` và hạng mục không
-- đổi nên `approved_content_hash` không đổi, và chữ ký cũ vẫn mở được gói. Băm luôn khác NULL — gói không khai có băm của chuỗi
-- rỗng —, nên mọi chữ ký cũ (gói nào cũng chưa khai lúc migration chạy) mang đúng băm của gói nó ký.
CREATE OR REPLACE FUNCTION public.rfq_bam_giao_hang(p_rfq uuid) RETURNS bytea
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT sha256(convert_to('GIAO_HANG|' || coalesce((SELECT p.so_ngay_giao::text FROM public.rfq_packages p WHERE p.id = p_rfq), ''),
                           'UTF8'))
$ham$;

-- `DEFAULT` hằng: điền mọi hàng cũ không qua `UPDATE` (bảng chữ ký không có đường sửa), rồi bỏ — từ đây chỉ trigger dưới đặt cột.
-- Cố ý KHÔNG cấp `INSERT` hay `UPDATE` cột này — khuôn `approved_list_hash` (`076` (2)).
ALTER TABLE rfq_approvals ADD COLUMN approved_delivery_hash bytea NOT NULL
  DEFAULT pg_catalog.sha256(pg_catalog.convert_to('GIAO_HANG|', 'UTF8'));
ALTER TABLE rfq_approvals ALTER COLUMN approved_delivery_hash DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.rfq_approvals_dat_bam_giao_hang() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  NEW.approved_delivery_hash := public.rfq_bam_giao_hang(NEW.rfq_id);
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_approvals_dat_bam_giao_hang
  BEFORE INSERT ON rfq_approvals
  FOR EACH ROW EXECUTE FUNCTION public.rfq_approvals_dat_bam_giao_hang();
ALTER TABLE rfq_approvals ENABLE ALWAYS TRIGGER rfq_approvals_dat_bam_giao_hang;

-- KHÔNG đổi hai `UNIQUE` chữ ký của `087` (2b). Số ngày giao chỉ đổi ở DRAFT, và mỗi lần nộp lại tăng `lan_nop` — nên hai hàng cùng
-- người, cùng nội dung, cùng `lan_nop_da_xem` luôn cùng số ngày giao, và người đã ký ký lại được ở lần nộp mới như hôm nay.
-- [rà soát §S1.279 — CAO-1, rồi đột biến D9] Bản đầu dựng lại hai ràng buộc với băm số ngày giao — chép bộ cột của `086` nên đánh rơi
-- `lan_nop_da_xem` (người duyệt đã trả gói về không ký lại được); bản sửa thêm lại cột ấy, và đột biến bỏ băm số ngày giao khỏi
-- ràng buộc thì SỐNG: cột ấy thừa ở đó. Không đổi là bản đúng.

-- [rà soát §S1.279 — CAO-2] Chữ ký CÒN HIỆU LỰC (`107` (5)) — vị từ MỘT HÀNG mà K4b đếm và K5 đọc — cộng vế số ngày giao. Phép đếm
-- riêng của bản đầu ghép vế hiệu lực theo NGƯỜI với vế số ngày giao theo HÀNG: một người có một hàng còn hiệu lực trên số ngày cũ và
-- một hàng đã bị chính họ rút trên số ngày hiện tại được đếm như một chữ ký hợp lệ; và K5 đếm chữ ký độc lập trên số ngày cũ. Ở tổ
-- chức đã bật, đây là phép kiểm duy nhất trên số ngày giao — K4b nói lời từ chối. Thân `107` cộng đúng một dòng.
CREATE OR REPLACE FUNCTION public.rfq_chu_ky_con_hieu_luc(p_org uuid, p_rfq uuid) RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
  SELECT DISTINCT a.approver_user_id
    FROM public.rfq_approvals a
   WHERE a.org_id = p_org AND a.rfq_id = p_rfq
     AND a.approved_content_hash = public.rfq_bam_noi_dung(p_rfq)
     AND a.approved_list_hash = public.rfq_bam_danh_sach(p_rfq)
     AND a.approved_budget_hash = public.rfq_bam_ngan_sach(p_rfq)
     AND a.approved_delivery_hash = public.rfq_bam_giao_hang(p_rfq)
     AND a.lan_nop_da_xem IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.rfq_tra_ve r
                      WHERE r.org_id = a.org_id AND r.rfq_id = a.rfq_id
                        AND r.returned_by = a.approver_user_id AND r.lan_nop >= a.lan_nop_da_xem)
$ham$;

-- ============================================================================================
-- (4) TẬP MÃ THÀNH PHẦN GHIM CỦA GÓI
-- ============================================================================================
-- Nhà cung cấp phải thấy ô nào cần khai, nhưng `org_procurement_policies_khach` là vị từ ĐÓNG (`027`) — mở nó lộ ngưỡng, bậc S3,
-- ngưỡng benchmark. Nên tập mã CHỤP vào chính hàng gói ở cạnh vào OPEN, từ phiên bản ghim (`102`): nhà cung cấp đọc hàng gói của
-- mình qua route (policy giữ hàng, route giữ trường — `060`), và lượt chấm đối chiếu đúng cột ấy với phiên bản ghim. Cột NGOÀI mọi
-- `GRANT` ghi; chỉ trigger (5) đặt nó. Tập mã không vào chữ ký: nó chọn lúc OPEN, SAU mọi chữ ký — cùng hạng với trọng số hôm nay.
ALTER TABLE rfq_packages ADD COLUMN tco_ma_ghim text[];

-- Gói đã mở trước migration này: tập mã của chính phiên bản ghim của chúng. Vai chạy migration có BYPASSRLS (ADR-061); câu chỉ đổi
-- cột mới, nên không trigger cạnh nào xét gì (`102` (1) cùng khuôn).
UPDATE rfq_packages r
   SET tco_ma_ghim = (SELECT pg_catalog.array_agg(c.value OPERATOR(pg_catalog.->>) 'ma' ORDER BY c.thu_tu)
                        FROM org_procurement_policies o,
                             pg_catalog.jsonb_array_elements(o.eval_components) WITH ORDINALITY AS c(value, thu_tu)
                       WHERE o.org_id = r.org_id AND o.id = r.chinh_sach_ghim_id)
 WHERE r.chinh_sach_ghim_id IS NOT NULL;

-- ============================================================================================
-- (5) CẠNH VÀO OPEN: CHỤP TẬP MÃ, ĐÒI SỐ NGÀY GIAO KHI CẦN, ĐẾM CHỮ KÝ TRÊN SỐ NGÀY GIAO HIỆN TẠI
-- ============================================================================================
-- Tên xếp SAU `rfq_packages_ghim_chinh_sach_khi_mo` (Postgres chạy trigger cùng sự kiện theo thứ tự tên), nên `NEW.chinh_sach_ghim_id`
-- đã là phiên bản ghim, dưới khoá tư vấn chính sách trigger ấy đã lấy.
--
-- Phép đếm chữ ký ở đây chỉ chạy ở tổ chức CHƯA bật S3 — ở tổ chức đã bật, vế số ngày giao nằm trong chính chữ ký còn hiệu lực (3),
-- và K4b nói lời từ chối. Tổ chức chưa bật không có cạnh về DRAFT (`077`), nên số ngày giao không đổi được sau khi ký: phép đếm là
-- lớp thứ hai, không phải đường duy nhất. Nó không phụ thuộc thứ tự với D2 (`rfq_kiem_chuyen_trang_thai`): chỉ nói khi `count(*)`
-- của D2 trên băm nội dung đã đủ — thiếu ở đó thì D2 nói vì sao, nguyên văn như hôm nay —, và đếm NGƯỜI (`DISTINCT`) trên băm nội
-- dung cộng băm số ngày giao.
CREATE OR REPLACE FUNCTION public.rfq_tco_khi_mo() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  v_ma text[];
  can integer;
  nen integer;
  co integer;
BEGIN
  SELECT array_agg(c.value ->> 'ma' ORDER BY c.thu_tu) INTO v_ma
    FROM public.org_procurement_policies o,
         jsonb_array_elements(o.eval_components) WITH ORDINALITY AS c(value, thu_tu)
   WHERE o.org_id = NEW.org_id AND o.id = NEW.chinh_sach_ghim_id;
  NEW.tco_ma_ghim := v_ma;

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

CREATE TRIGGER rfq_packages_tco_khi_mo
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'OPEN')
  EXECUTE FUNCTION public.rfq_tco_khi_mo();
ALTER TABLE rfq_packages ENABLE ALWAYS TRIGGER rfq_packages_tco_khi_mo;

-- ============================================================================================
-- (6) BỘ ĐỌC Ô KHAI SỐ NGÀY CỦA PHONG BÌ
-- ============================================================================================
-- Khuôn `bid_so_tien` (`022` (8)): chuỗi do NHÀ CUNG CẤP viết, không bao giờ `RAISE`, ngoài miền thì `NULL`. Số nguyên thập phân không
-- dấu, không số 0 đứng đầu, [0, 3650]. Hai ô tiền mới (`freight`, `importCost`) đọc bằng chính `bid_so_tien`.
CREATE OR REPLACE FUNCTION public.bid_so_ngay(p_van text) RETURNS integer
  LANGUAGE plpgsql IMMUTABLE STRICT
  SET search_path = pg_catalog, public
AS $ham$
BEGIN
  IF p_van !~ '^(0|[1-9][0-9]{0,3})$' THEN
    RETURN NULL;
  END IF;
  IF p_van::integer > 3650 THEN
    RETURN NULL;
  END IF;
  RETURN p_van::integer;
END
$ham$;

-- ============================================================================================
-- (7) HÀNG XẾP HẠNG KHÔNG CÓ SỐ GỌI TÊN MÃ THIẾU
-- ============================================================================================
-- Spec §4.8: chính sách bật một mã mà nhà cung cấp để trống thì DÒNG ẤY từ chối chấm, gọi tên mã thiếu — không lấy `0`. Hàng vẫn có
-- (khuôn `057`: `effective_cost` và `rank` cùng `NULL`), và cột này nói mã nào không có giá trị đọc được — kể cả `gia`. `NULL` ở
-- hàng có số, và ở hàng không số ghi trước migration này.
ALTER TABLE rfq_evaluation_lines ADD COLUMN ma_thieu text[];
ALTER TABLE rfq_evaluation_lines
  ADD CONSTRAINT rfq_evaluation_lines_ma_thieu_hinh_dang
  CHECK (ma_thieu IS NULL
         OR (effective_cost IS NULL
             AND pg_catalog.cardinality(ma_thieu) OPERATOR(pg_catalog.>) 0
             AND pg_catalog.array_position(ma_thieu, NULL) IS NULL));
GRANT INSERT (ma_thieu) ON rfq_evaluation_lines TO app_api;
