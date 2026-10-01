-- =============================================================================================
-- `093_award_luot_cham_moi_nhat.sql` — [S1.231 / khoản 231] AWARD CHỈ TRỎ ĐƯỢC VÀO LƯỢT CHẤM MỚI NHẤT — Ở TẦNG CSDL
-- =============================================================================================
-- Khoản 231 (S1.110) đo một bất đối xứng ĐƯỢC CHỌN: `bafo_kiem_vong` (`060` mục (A)) đòi vòng BAFO trỏ vào lượt chấm mà
-- KHÔNG GÌ thay thế, còn `award_kiem_de_xuat` (`061`, thân từ `074`) chỉ đòi lượt chấm THUỘC ĐÚNG RFQ — vế *mới nhất* của
-- award sống ở đúng MỘT câu `ORDER BY e.created_at DESC` trong `deXuatTraoThau`. Lý do hôm ấy đúng: `evaluationId` không
-- phải tham số của hàm nào, nên lớp thứ hai canh một đường chưa tồn tại. Cái giá đã ghi: ngày nào có một đường ghi thứ hai
-- vào `rfq_awards`, award trỏ được vào bảng xếp hạng TRƯỚC BAFO — đúng vectơ spec S2 §8.1⑴ chặn — và không trigger nào kêu.
--
-- SỬA: thêm vào `award_kiem_de_xuat` một vế `EXISTS (lượt chấm nào của RFQ này mới hơn)`, chép nguyên khuôn `060` mục (A),
-- ngay sau vế *lượt chấm thuộc đúng RFQ*. Nhánh mới mang TÊN RÀNG BUỘC (`j5_luot_cham_khong_moi_nhat`, khuôn `074`) để một lớp
-- trên nhận ra nó bằng tên chứ không bằng thông điệp; ~~nó KHÔNG có dòng ở `CHOT_VAO_SO` — hai vế J5 vốn ngoài tập ADR-104~~
-- **[S1.231, lượt gộp]** nó CÓ dòng `J5_LUOT_CHAM_KHONG_MOI_NHAT` ở `CHOT_THEO_RANG_BUOC`/`CHOT_VAO_SO` (`packages/identity`):
-- ADR-108 đòi tên hai phía khớp nhau, và cổng hai chiều ở `packages/rfq/src/rfq.int.test.ts` đọc cả thân này. Đường sản xuất
-- không tới được nhánh này (lớp gói tự suy lượt mới nhất), nên lần từ chối ở đây là dấu hiệu của một đường ghi LẠ, không của
-- một người dùng đi tắt — và đúng vì thế nó vào sổ `CONTROL_DENIED`.
--
-- Thân TRÍCH NGUYÊN VĂN từ `074_tu_choi_co_ten.sql` bằng script rồi đổi đúng HAI chỗ: một biến `moc_cua_luot` ở DECLARE và
-- một khối vế mới trước `RETURN NEW`. Bản ghim ở `hardening.always.sql` đổi cùng commit (S1.96: migration một mình là no-op
-- vì lượt hardening ngay sau trả định nghĩa về bản ghim). Không đổi trigger: `CREATE OR REPLACE FUNCTION` giữ nguyên
-- `rfq_awards_kiem_de_xuat` trỏ vào hàm. Đo: `packages/danh-gia/src/luot-danh-gia.int.test.ts` khối `[khoản 231]` — sau một
-- chu kỳ BAFO (HAI lượt chấm), hàng trỏ lượt CŨ bị 23514 mang tên trên; cùng câu với lượt MỚI NHẤT đi qua.
-- =============================================================================================

CREATE OR REPLACE FUNCTION public.award_kiem_de_xuat() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  nguoi_tao uuid;
  gia numeric;
  moc_cua_luot timestamptz;
BEGIN
  -- Chỉ hàng ĐỀ XUẤT đi qua phép kiểm này; hàng `APPROVED`/`CANCELLED` do mục (6) phán xử.
  IF NEW.status IS DISTINCT FROM 'PROPOSED' THEN
    RETURN NEW;
  END IF;

  SELECT p.created_by INTO nguoi_tao
    FROM public.rfq_packages p
   WHERE p.id OPERATOR(pg_catalog.=) NEW.rfq_id
     AND p.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay RFQ % trong to chuc %', NEW.rfq_id, NEW.org_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- [J3 vế 2] Người TẠO gói thầu không được là người đề xuất trao thầu cho chính gói ấy.
  IF nguoi_tao OPERATOR(pg_catalog.=) NEW.acted_by THEN
    RAISE EXCEPTION
      'Nguoi tao goi thau khong duoc de xuat trao thau cho chinh goi ay (J3)'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'j3_nguoi_tao_de_xuat';
  END IF;

  -- [J3 vế 3] ...và người TỪNG ĐIỀU PHỐI mở thầu cũng không — mọi lần, kể cả lần đã bị điều phối
  -- lại đè lên (khoản 233, `064`). Đọc bảng lịch sử, không đọc `unseal_requests.dispatched_by`.
  IF EXISTS (SELECT 1 FROM public.unseal_dispatch_history h
              WHERE h.org_id OPERATOR(pg_catalog.=) NEW.org_id
                AND h.rfq_id OPERATOR(pg_catalog.=) NEW.rfq_id
                AND h.dispatched_by OPERATOR(pg_catalog.=) NEW.acted_by) THEN
    RAISE EXCEPTION
      'Nguoi dieu phoi mo thau khong duoc de xuat trao thau cho chinh goi ay (J3)'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'j3_nguoi_dieu_phoi_de_xuat';
  END IF;

  -- [J5 vế NỘI DUNG] Khoá ngoại hợp thành đã buộc có một HÀNG XẾP HẠNG; nó KHÔNG buộc hàng ấy
  -- đọc được giá. `057` cho một báo giá không đọc được giá vẫn có hàng, với `effective_cost` và
  -- `rank` cùng NULL (§2.3⑺) — và một award dựa trên nó là một quyết định dựa trên số không có.
  SELECT l.effective_cost INTO gia
    FROM public.rfq_evaluation_lines l
   WHERE l.org_id OPERATOR(pg_catalog.=) NEW.org_id
     AND l.evaluation_id OPERATOR(pg_catalog.=) NEW.evaluation_id
     AND l.bid_version_id OPERATOR(pg_catalog.=) NEW.bid_version_id;
  IF gia IS NULL THEN
    RAISE EXCEPTION
      'Bao gia duoc chon khong co effective_cost doc duoc o luot cham % (J5)', NEW.evaluation_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- [J5 vế RFQ] Lượt chấm được trỏ tới phải là lượt CỦA CHÍNH GÓI THẦU NÀY. Khoá ngoại hợp thành
  -- buộc `(org_id, evaluation_id, bid_version_id)` tồn tại ở `rfq_evaluation_lines`, và hàng ấy
  -- buộc `evaluation_id` tồn tại ở `rfq_evaluations` — nhưng KHÔNG chuỗi nào buộc lượt chấm ấy
  -- thuộc `NEW.rfq_id`. Cùng ca mà `059` đã gặp cho vòng BAFO.
  IF NOT EXISTS (SELECT 1 FROM public.rfq_evaluations e
                  WHERE e.id OPERATOR(pg_catalog.=) NEW.evaluation_id
                    AND e.org_id OPERATOR(pg_catalog.=) NEW.org_id
                    AND e.rfq_id OPERATOR(pg_catalog.=) NEW.rfq_id) THEN
    RAISE EXCEPTION
      'Luot cham % khong thuoc RFQ % (J5)', NEW.evaluation_id, NEW.rfq_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- [S1.231 / khoản 231 / 093] VÀ KHÔNG LƯỢT NÀO CỦA GÓI THẦU NÀY MỚI HƠN NÓ — khuôn mục (A) của `060`
  -- (`bafo_kiem_vong`). Thiếu vế này, một award trỏ được vào bảng xếp hạng TRƯỚC BAFO ngay khi có một
  -- đường ghi thứ hai vào `rfq_awards` (nhập liệu hàng loạt, bộ đồng bộ, một route nhận `evaluationId`)
  -- — và mọi lớp còn lại vẫn nhất quán với lượt đã chọn nên không chỗ nào kêu. Hôm nay `deXuatTraoThau`
  -- tự suy lượt mới nhất; từ đây hai lớp nói cùng một câu, như `060` đã làm cho vòng BAFO. Ca hoà
  -- `created_at` không tới được: hai lượt của cùng gói thầu không sinh trong cùng một giao dịch
  -- (`taoLuotDanhGia` đòi RFQ ở `UNSEALED`/`BAFO_UNSEALED` rồi lật sang `EVALUATING`).
  SELECT e.created_at INTO moc_cua_luot
    FROM public.rfq_evaluations e
   WHERE e.id OPERATOR(pg_catalog.=) NEW.evaluation_id
     AND e.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF EXISTS (SELECT 1 FROM public.rfq_evaluations e2
              WHERE e2.rfq_id OPERATOR(pg_catalog.=) NEW.rfq_id
                AND e2.org_id OPERATOR(pg_catalog.=) NEW.org_id
                AND e2.created_at OPERATOR(pg_catalog.>) moc_cua_luot) THEN
    RAISE EXCEPTION
      'Luot cham % khong phai luot moi nhat cua RFQ % — award phai dua tren bang xep hang DANG CO HIEU LUC (J5)',
      NEW.evaluation_id, NEW.rfq_id
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'j5_luot_cham_khong_moi_nhat';
  END IF;

  RETURN NEW;
END
$ham$;
