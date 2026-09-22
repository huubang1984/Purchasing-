-- ==============================================================================================
-- 060 — VÒNG BAFO PHẢI TRỎ VÀO LƯỢT CHẤM MỚI NHẤT, VÀ NHÀ CUNG CẤP ĐƯỢC THẤY HẠN CỦA VÒNG
--
-- [S1.109 / S2.5 tầng người dùng] Hai thay đổi, và cả hai đến từ lượt soi HÌNH DẠNG chạy trước
-- dòng mã đầu của vòng này — không từ một lượt đọc lại tài liệu.
--
-- ---------------------------------------------------------------------------------------------
-- (A) `evaluation_id` CỦA VÒNG BAFO DO NGƯỜI GỌI KHAI, VÀ `059` KHÔNG ĐÒI NÓ LÀ LƯỢT MỚI NHẤT
-- ---------------------------------------------------------------------------------------------
-- `bafo_kiem_vong` của `059` kiểm BA thứ về `evaluation_id`: lượt ấy thuộc đúng RFQ, `policy_id`
-- của vòng khớp `policy_id` của lượt, và `top_n` khớp `bafo_top_n` của chính sách ấy. Không vế
-- nào đòi nó là lượt MỚI NHẤT — và `GRANT INSERT (…, evaluation_id, …)` có cấp cột ấy cho
-- `app_api`.
--
-- Hai lượt đánh giá cùng tồn tại là trạng thái BÌNH THƯỜNG sau đúng một chu kỳ BAFO:
--
--     mở thầu → chấm (lượt A) → BAFO vòng 1 → mở thầu → chấm (lượt B)
--
-- Lúc ấy vòng BAFO THỨ HAI mở được với `evaluation_id = A`, tức mời top-N của bảng xếp hạng
-- TRƯỚC BAFO. Đó đúng là thứ spec §8.1⑴ sinh ra để chặn — *"danh sách mời BAFO suy từ `rank`,
-- không do người mua gõ tay, nên một lần mời ngoài top-N là một lần lệch ĐỌC ĐƯỢC"*. Chọn LƯỢT
-- ĐÁNH GIÁ NÀO là gõ tay danh sách ấy ở một tầng trên, và nó KHÔNG để lại vết lệch nào: mọi lớp
-- cưỡng chế đều nhất quán với lượt đã chọn, nên `bid_kiem_vong_bafo` của mục (6) vẫn cho qua.
-- Một nhà cung cấp rơi khỏi top-N ở lượt B được đưa trở lại bằng cách trỏ vòng sau vào lượt A.
--
-- Chủ dự án chốt ngày 2026-09-22: cưỡng chế ở CSDL, không chỉ ở route. Lý do là một phép đo đã
-- ghi — khoản **220**: `evaluation.perform` do NĂM trên SÁU vai giữ, nên một cổng chỉ nằm ở route
-- là lớp NÔNG. Lời hứa ở §8.1⑴ là lời hứa chống thông đồng, không phải một phép kiểm tiện nghi.
--
-- HÌNH DẠNG CỦA VẾ MỚI, và vì sao nó là *"không có lượt nào MỚI HƠN"* chứ không phải *"bằng
-- max(created_at)"*: nó phát biểu thẳng tính chất cần có — vòng trỏ vào một lượt mà KHÔNG GÌ thay
-- thế. Hai cách chỉ khác nhau ở ca HOÀ `created_at`, và ca ấy không tới được: `taoLuotDanhGia`
-- đòi RFQ ở `UNSEALED`/`BAFO_UNSEALED` rồi lật sang `EVALUATING`, nên hai lượt của cùng một gói
-- thầu không sinh ra trong cùng một giao dịch được, và `now()` của hai giao dịch thì khác nhau.
-- Ghi ra vì *"ca ấy không tới được"* là một lời khai, và lời khai thì phải đo được.
--
-- ---------------------------------------------------------------------------------------------
-- (B) `rfq_bafo_rounds_khach` ĐÓNG HẲN, VÀ HẠN DUY NHẤT NHÀ CUNG CẤP ĐỌC ĐƯỢC LÀ HẠN SAI
-- ---------------------------------------------------------------------------------------------
-- `059` đóng hẳn policy khách và ghi lý do: nới trước khi có route là nới mù, và bảng mang hai
-- trường mà một nhà cung cấp đọc được là tin cạnh tranh thật (`top_n` — mấy người qua vòng một —
-- và `opened_by`). Khoản **227⑶** giữ câu hỏi ấy mở cho vòng này.
--
-- Vòng này có route, nên câu hỏi trả lời được. Và lượt soi hình dạng đo thêm một vế mà khoản 227
-- không có: **giữ đóng KHÔNG phải một lựa chọn trung tính.** `GET /guest/rfq` trả
-- `rfq.deadlineAt = rfq_packages.deadline_at`, và suốt `BAFO_OPEN` cột ấy vẫn là hạn VÒNG MỘT —
-- đã ở quá khứ. Nó không cập nhật được: vế (b) của `rfq_kiem_chuyen_trang_thai` cấm deadline lùi
-- và vế (c) chỉ cho đổi ở `DRAFT`/`OPEN` — chính vì thế `059` tách hạn BAFO sang bảng riêng. Nên
-- giữ nguyên là để một màn hình nói một hạn ĐÃ QUA trong khi người đọc nó vẫn nộp được.
--
-- Chủ dự án chốt: nới HẸP. Vị từ theo `app.guest_rfq_id` — khuôn `rfq_items_khach` (`027 §5`) —
-- và route khách trả ĐÚNG hai trường `{roundNo, deadlineAt}`, không trả `top_n` hay `opened_by`.
-- Hai lớp, và chúng canh hai thứ KHÁC NHAU: policy canh HÀNG nào ra khỏi CSDL, route canh TRƯỜNG
-- nào ra khỏi tiến trình. Không lớp nào chép lại luật của lớp kia.
--
-- `WITH CHECK` giữ nguyên vế ĐÓNG HẲN, và đó không phải một chỗ sao chép thiếu: khuôn ấy là
-- `rfq_key_material_khach` (`027`), nơi USING nới theo `app.guest_rfq_id` còn WITH CHECK từ chối
-- mọi phiên khách. Đường khách chạy dưới vai `app_api` — cùng vai có `GRANT INSERT` trên bảng này
-- — nên vế WITH CHECK là thứ DUY NHẤT làm một lần ghi từ phiên khách bất khả, bất kể route nào
-- tồn tại hôm nay hay mai sau.
-- ==============================================================================================

-- ============================================================================================
-- (A) VÒNG BAFO CHỈ TRỎ ĐƯỢC VÀO LƯỢT CHẤM MÀ KHÔNG GÌ THAY THẾ
-- ============================================================================================
-- Toàn bộ thân được chép lại (`CREATE OR REPLACE` không vá được một phần), và phần đổi là ĐÚNG
-- một khối: `moc_cua_luot` được lấy thêm ở câu đọc lượt đánh giá, rồi một vế `EXISTS` ngay sau
-- vế *"lượt ấy thuộc đúng RFQ"*. Bản ghim ở `hardening.always.sql` đổi cùng commit — `S1.96` đo
-- được rằng migration một mình là no-op, vì lượt hardening ngay sau đó trả định nghĩa về bản cũ.
CREATE OR REPLACE FUNCTION public.bafo_kiem_vong() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  CUA_SO_TOI_THIEU constant interval := interval '1 hour';
  trang_thai text;
  rfq_cua_luot uuid;
  cs_cua_luot uuid;
  moc_cua_luot timestamptz;
  top_n_chinh_sach integer;
  so_cu integer;
BEGIN
  IF TG_OP OPERATOR(pg_catalog.=) 'DELETE' THEN
    RAISE EXCEPTION 'Khong duoc xoa mot vong BAFO: no la mot su that kiem toan'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP OPERATOR(pg_catalog.=) 'UPDATE' THEN
    -- Chỉ `closed_at` đổi được, và chỉ MỘT CHIỀU: `NULL` -> một giá trị. Quyền đã chặn mọi cột
    -- khác (`GRANT UPDATE (closed_at)`), nhưng quyền không chặn chủ sở hữu bảng và superuser —
    -- cùng lập luận đã dựng lớp chỉ-ghi-thêm cho `audit_events` ở `003`.
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.org_id IS DISTINCT FROM OLD.org_id
       OR NEW.rfq_id IS DISTINCT FROM OLD.rfq_id
       OR NEW.evaluation_id IS DISTINCT FROM OLD.evaluation_id
       OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
       OR NEW.top_n IS DISTINCT FROM OLD.top_n
       OR NEW.round_no IS DISTINCT FROM OLD.round_no
       OR NEW.deadline_at IS DISTINCT FROM OLD.deadline_at
       OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
       OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
       OR NEW.opened_by_session_id IS DISTINCT FROM OLD.opened_by_session_id THEN
      RAISE EXCEPTION 'Chi sua duoc closed_at cua mot vong BAFO'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Gỡ `closed_at` về NULL là MỞ LẠI một vòng đã đóng, và mục (5) đọc đúng cột ấy để quyết
    -- định có nhận báo giá hay không. Một vòng mở lại được là một hạn nộp mở lại được.
    IF OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
      RAISE EXCEPTION 'Mot vong BAFO da dong thi khong mo lai duoc'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- ---- INSERT -------------------------------------------------------------------------------
  -- `FOR NO KEY UPDATE` tuần tự hoá việc mở vòng với việc chuyển trạng thái RFQ. Khuôn [M-4] của
  -- `rfq_items_chi_sua_khi_soan`: không có nó, dưới READ COMMITTED một giao dịch mở vòng BAFO
  -- (đọc thấy `EVALUATING`) chạy song song với một giao dịch huỷ RFQ cho ra một vòng BAFO đang mở
  -- trên một gói thầu đã huỷ.
  SELECT p.status INTO trang_thai
    FROM public.rfq_packages p
   WHERE p.id OPERATOR(pg_catalog.=) NEW.rfq_id
     AND p.org_id OPERATOR(pg_catalog.=) NEW.org_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay RFQ % trong to chuc %', NEW.rfq_id, NEW.org_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  -- `EVALUATING` là trạng thái DUY NHẤT mở được một vòng BAFO — cạnh `EVALUATING->BAFO_OPEN` là
  -- cạnh duy nhất đi vào `BAFO_OPEN`. Kiểm ở đây chứ không chỉ ở cạnh: một vòng BAFO cho một gói
  -- thầu chưa chấm là một hàng không được phép TỒN TẠI, không phải một hàng sẽ bị bỏ qua.
  IF trang_thai IS DISTINCT FROM 'EVALUATING' THEN
    RAISE EXCEPTION 'Chi mo duoc vong BAFO khi RFQ dang o EVALUATING; dang o %', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;

  -- Lượt đánh giá được trỏ tới phải là lượt CỦA CHÍNH GÓI THẦU NÀY. Khoá ngoại hợp thành đã buộc
  -- nó cùng tổ chức; nó KHÔNG buộc cùng RFQ, và một `evaluation_id` của gói thầu khác sẽ làm
  -- danh sách mời ở mục (6) suy từ một bảng xếp hạng không liên quan.
  SELECT e.rfq_id, e.policy_id, e.created_at INTO rfq_cua_luot, cs_cua_luot, moc_cua_luot
    FROM public.rfq_evaluations e
   WHERE e.id OPERATOR(pg_catalog.=) NEW.evaluation_id
     AND e.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF rfq_cua_luot IS DISTINCT FROM NEW.rfq_id THEN
    RAISE EXCEPTION 'Luot danh gia % khong thuoc RFQ % (vong BAFO suy danh sach moi tu no)',
      NEW.evaluation_id, NEW.rfq_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- [S1.109] VÀ KHÔNG LƯỢT NÀO CỦA GÓI THẦU NÀY MỚI HƠN NÓ. Xem khối (A) ở đầu tệp: thiếu vế
  -- này, vòng BAFO thứ hai mời được top-N của bảng xếp hạng TRƯỚC BAFO, tức người mua chọn được
  -- danh sách mời bằng cách chọn lượt chấm — và mọi lớp cưỡng chế còn lại vẫn nhất quán với lượt
  -- đã chọn nên không chỗ nào kêu. `FOR NO KEY UPDATE` ở trên đã tuần tự hoá theo gói thầu, và
  -- một lượt chấm mới đòi RFQ rời `EVALUATING`, nên phép đọc này không đua với ai.
  IF EXISTS (SELECT 1
               FROM public.rfq_evaluations e2
              WHERE e2.rfq_id OPERATOR(pg_catalog.=) NEW.rfq_id
                AND e2.org_id OPERATOR(pg_catalog.=) NEW.org_id
                AND e2.created_at OPERATOR(pg_catalog.>) moc_cua_luot) THEN
    RAISE EXCEPTION
      'Luot danh gia % khong phai luot moi nhat cua RFQ % — vong BAFO phai suy danh sach moi tu bang xep hang DANG CO HIEU LUC (§8.1)',
      NEW.evaluation_id, NEW.rfq_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Và phiên bản chính sách của VÒNG phải là phiên bản mà LƯỢT ĐÁNH GIÁ đã tính dưới. Không có
  -- vế này, `top_n` khớp một chính sách mà người gọi CHỌN: chính sách có phiên bản liên tục
  -- (`035`), nên một tổ chức có nhiều phiên bản thì cũng có nhiều giá trị `bafo_top_n`, và vế
  -- khớp ngay dưới trở thành một phép khớp với con số vừa ý chứ với con số ĐÃ ÁP. Đây là ca mà
  -- khoá ngoại hợp thành không thấy: `(org_id, policy_id)` của cả hai đều hợp lệ.
  IF cs_cua_luot IS DISTINCT FROM NEW.policy_id THEN
    RAISE EXCEPTION
      'Chinh sach cua vong BAFO (%) khac chinh sach ma luot danh gia % da tinh duoi (%)',
      NEW.policy_id, NEW.evaluation_id, cs_cua_luot
      USING ERRCODE = 'check_violation';
  END IF;

  -- `top_n` phải KHỚP `bafo_top_n` của chính phiên bản chính sách được trỏ tới. Nó là giá trị ĐÃ
  -- ÁP, nên nó phải khớp lúc áp; sau đó chính sách đổi bao nhiêu lần cũng không đổi vòng này.
  SELECT p.bafo_top_n INTO top_n_chinh_sach
    FROM public.org_procurement_policies p
   WHERE p.id OPERATOR(pg_catalog.=) NEW.policy_id
     AND p.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  IF top_n_chinh_sach IS NULL THEN
    RAISE EXCEPTION 'Chinh sach % chua khai bafo_top_n — khong mo duoc vong BAFO', NEW.policy_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF top_n_chinh_sach IS DISTINCT FROM NEW.top_n THEN
    RAISE EXCEPTION 'top_n cua vong (%) khac bafo_top_n cua chinh sach (%)',
      NEW.top_n, top_n_chinh_sach
      USING ERRCODE = 'check_violation';
  END IF;

  -- [M-5] Cùng sàn với cạnh `PENDING_APPROVAL->OPEN` của vòng một: một vòng mở với hạn đã ở quá
  -- khứ là một trạng thái hỏng TRÊN DỮ LIỆU, và nhà cung cấp không kịp làm gì với nó.
  IF NEW.deadline_at < now() + CUA_SO_TOI_THIEU THEN
    RAISE EXCEPTION 'Cua so BAFO phai con it nhat % ke tu bay gio', CUA_SO_TOI_THIEU
      USING ERRCODE = 'check_violation';
  END IF;

  -- Số vòng là DẪN XUẤT. Khoá tư vấn theo phạm vi giao dịch, khuôn `bid_dat_so_phien_ban` (018):
  -- `app_api` không có `UPDATE` trên mọi cột của bảng này nên một khoá HÀNG là bất khả, và
  -- `SECURITY DEFINER` thì mục (C) của hardening cấm. Phạm vi khoá là TỪNG GÓI THẦU.
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.rfq_id::pg_catalog.text, 0));
  SELECT max(r.round_no) INTO so_cu
    FROM public.rfq_bafo_rounds r
   WHERE r.rfq_id OPERATOR(pg_catalog.=) NEW.rfq_id
     AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id;
  NEW.round_no := coalesce(so_cu, 0) OPERATOR(pg_catalog.+) 1;

  RETURN NEW;
END
$ham$;

-- ============================================================================================
-- (B) NHÀ CUNG CẤP ĐƯỢC THẤY VÒNG BAFO CỦA ĐÚNG GÓI THẦU MÌNH ĐƯỢC MỜI
-- ============================================================================================
-- `DROP` rồi `CREATE` chứ không `ALTER POLICY`: `ALTER POLICY … USING (…)` đổi được vị từ nhưng
-- `hardening.always.sql` ghim NGUYÊN VĂN `pg_get_expr` của cả hai vế, nên một lệnh đổi đúng một
-- vế là đúng cái hình dạng mà bản ghim tồn tại để bắt. Viết cả hai vế ra, cùng một chỗ.
DROP POLICY rfq_bafo_rounds_khach ON rfq_bafo_rounds;

CREATE POLICY rfq_bafo_rounds_khach ON rfq_bafo_rounds AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL OR rfq_id OPERATOR(pg_catalog.=) NULLIF(pg_catalog.current_setting('app.guest_rfq_id', true), '')::pg_catalog.uuid)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);
