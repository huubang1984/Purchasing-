-- db/migrations/014_procurement_policy.sql
-- ADR-017 biến thành câu lệnh: NGƯỠNG PHÊ DUYỆT KÉP LÀ CHÍNH SÁCH THEO TỔ CHỨC, CÓ PHIÊN BẢN,
-- VÀ PHÂN LOẠI PHẢI TÁI LẬP ĐƯỢC.
--
-- ============================================================================================
-- CÂU Ở ĐẦU 009 ĐƯỢC THU HẸP — VÀ ĐÂY LÀ CHỖ GHI VÌ SAO
-- ============================================================================================
-- 009 viết: *"NGƯỠNG của D2 KHÔNG được lưu dưới dạng một số tiền. Nó được lưu dưới dạng
-- `requires_dual_approval boolean` — một KẾT LUẬN mà ứng dụng rút ra từ chính sách của tổ chức."*
--
-- Vế thứ hai GIỮ NGUYÊN: cột quyết định vẫn là boolean, và trigger đếm phê duyệt của 011 vẫn đọc
-- đúng cột đó. Vế thứ nhất được THU HẸP: nó đúng cho GIÁ THẦU (A3/A4 — và `rfq_items` tới hôm nay
-- vẫn không có một cột giá nào), nó KHÔNG đúng cho NGÂN SÁCH CỦA BÊN MUA. Ba lý do độc lập:
--
--   ⑴ PRODUCT §8 ràng buộc 5 đòi mọi ngưỡng chính sách CẤU HÌNH ĐƯỢC theo từng doanh nghiệp;
--   ⑵ USP 3 của sản phẩm là *tạo bằng chứng kiểm toán*, và một boolean TRẦN là một phán quyết
--      không kiểm toán được — kiểm toán viên hỏi "vì sao RFQ này chỉ cần một phê duyệt" và trong
--      dữ liệu không có câu trả lời;
--   ⑶ North Star Metric là *Verified Competitive Spend*, tức một chỉ số CÓ ĐƠN VỊ LÀ TIỀN. Trước
--      award, số tiền duy nhất tồn tại là ước lượng của người mua. Không có nó, chỉ số bắc đẩu
--      của sản phẩm KHÔNG TÍNH ĐƯỢC bằng bất cứ cách nào — độc lập hoàn toàn với D2.
--
-- 009 là migration đánh số đã áp và KHÔNG được đụng (sửa chú thích cũng đổi checksum), nên phần
-- đính chính nằm ở đây — đúng cách đóng đã ghi cho khoản nợ 19.
--
-- ============================================================================================
-- VÌ SAO TIỀN NẰM Ở BẢNG RIÊNG CHỨ KHÔNG PHẢI MỘT CỘT CỦA `rfq_packages`
-- ============================================================================================
-- Dùng ĐÚNG lập luận mà 009 đã dùng để không cho `rfq_items` một cột giá: *"bảng không có cột thì
-- không có gì để nhớ."* Ngân sách dự tính là thứ TUYỆT ĐỐI không được lọt xuống nhà cung cấp —
-- công bố ngân sách cho bên dự thầu là NEO GIÁ, và nó làm hỏng chính thứ Blind Procurement mua về.
--
-- Một cột trên `rfq_packages` sẽ đi theo mọi câu `SELECT *` và mọi hàm đọc RFQ về sau; lúc ấy lớp
-- phòng thủ duy nhất là "mọi người viết truy vấn tương lai đều nhớ loại cột đó ra". Bảng riêng làm
-- việc nhớ ấy thành không cần thiết.
--
-- PHÁT BIỂU ĐÚNG MỨC, và nó sửa một câu của chính ADR-017: mục 4 của ADR nói sẽ cưỡng chế bằng
-- QUYỀN THEO CỘT "cho đường khách". Câu đó KHÔNG cài được hôm nay và lý do là cấu trúc chứ không
-- phải công sức — đường khách và đường người mua dùng CHUNG một role CSDL (`app_api`); không có
-- role thứ ba để thu hẹp quyền. Bảng riêng là thứ thay thế được, và phần còn lại là một khoản nợ
-- có tên: khi S1.5 dựng đường đọc RFQ cho phiên khách, nó phải được đo là không chạm bảng này.

-- ============================================================================================
-- (1) CHÍNH SÁCH MUA SẮM THEO TỔ CHỨC — CHỈ GHI THÊM, CÓ PHIÊN BẢN
-- ============================================================================================
-- Tính CHỈ-GHI-THÊM là thứ làm cho "tái lập được" thành sự thật chứ không thành lời hứa: nếu sửa
-- được ngưỡng của một phiên bản đã dùng, thì phân loại của mọi RFQ cũ đổi theo mà không ai biết.
-- Vì vậy `app_api` KHÔNG có UPDATE và KHÔNG có DELETE ở đây. Đổi chính sách = thêm một phiên bản.
CREATE TABLE org_procurement_policies (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES organizations(id),
  -- Phiên bản do ứng dụng đặt, tăng dần trong phạm vi tổ chức. UNIQUE (org_id, version) bên dưới
  -- biến "hai người cùng tạo phiên bản 3" thành một lỗi ghi thay vì hai chính sách cùng số.
  version                 integer NOT NULL CHECK (version > 0),
  -- Ngưỡng phê duyệt kép. `numeric` chứ không `double precision`: tiền không được làm tròn nhị
  -- phân. Ba vế CHECK vì `numeric` NHẬN 'NaN' và 'Infinity', và `NaN > 0` là TRUE trong Postgres
  -- — dự án đã đo điều đó một lần ở `rfq_items.quantity` (011).
  dual_approval_threshold numeric(18, 2) NOT NULL
                          CHECK (dual_approval_threshold >= 0
                                 AND dual_approval_threshold <> 'NaN'::numeric
                                 AND dual_approval_threshold < 'Infinity'::numeric),
  currency                text NOT NULL CHECK (currency IN ('VND', 'USD')),
  effective_from          timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  -- [ADR-016] Chính sách quyết định ai phải ký một khoản mua — nó là thứ phải biết ai đặt ra.
  created_by              uuid NOT NULL,
  created_by_session_id   uuid NOT NULL,
  FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id),
  UNIQUE (org_id, version),
  -- Tiền đề cho khoá ngoại hợp thành từ `rfq_budgets`.
  UNIQUE (org_id, id)
);

ALTER TABLE org_procurement_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_procurement_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY org_procurement_policies_tenant_isolation ON org_procurement_policies
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON org_procurement_policies TO app_api;
GRANT INSERT (org_id, version, dual_approval_threshold, currency, effective_from,
              created_by, created_by_session_id)
  ON org_procurement_policies TO app_api;
-- Cố ý KHÔNG cấp UPDATE và KHÔNG cấp DELETE. Xem khối trên: đó là toàn bộ cơ chế.
-- Cố ý KHÔNG cấp gì cho `app_unseal` — runtime mở thầu không có việc gì với ngân sách bên mua.

CREATE TRIGGER org_procurement_policies_kiem_danh_tinh
  BEFORE INSERT ON org_procurement_policies
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'created_by', 'created_by_session_id');

-- ============================================================================================
-- (2) NGÂN SÁCH DỰ TÍNH CỦA MỘT RFQ — BẰNG CHỨNG CỦA PHÂN LOẠI
-- ============================================================================================
-- Một hàng ở đây là câu trả lời cho "vì sao RFQ này chỉ cần một phê duyệt": nó nói giá trị đã đem
-- so và TRỎ TỚI đúng phiên bản chính sách đã dùng.
--
-- `policy_version` CỐ Ý KHÔNG được sao chép vào đây, và đó là một thu hẹp so với ADR-017 mục 2:
-- ADR viết "phải mang phiên bản chính sách đã áp VÀ giá trị đã đem so". `policy_id` là khoá ngoại
-- tới một hàng KHÔNG SỬA ĐƯỢC, nên nó đã xác định cả phiên bản lẫn ngưỡng. Chép thêm một bản là
-- tạo ra hai nguồn sự thật có thể lệch nhau — đúng lớp lỗi mà `TAX_CODE_PATTERN` phải dựng một
-- meta-test để canh. Yêu cầu của ADR được giữ; cách giữ thì hẹp hơn và chặt hơn.
CREATE TABLE rfq_budgets (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES organizations(id),
  rfq_id                 uuid NOT NULL,
  -- Ước lượng của NGƯỜI MUA. KHÔNG BAO GIỜ là giá của nhà cung cấp — xem khối đầu file.
  estimated_value        numeric(18, 2) NOT NULL
                         CHECK (estimated_value >= 0
                                AND estimated_value <> 'NaN'::numeric
                                AND estimated_value < 'Infinity'::numeric),
  currency               text NOT NULL CHECK (currency IN ('VND', 'USD')),
  policy_id              uuid NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL,
  created_by_session_id  uuid NOT NULL,
  FOREIGN KEY (org_id, rfq_id) REFERENCES rfq_packages (org_id, id),
  FOREIGN KEY (org_id, policy_id) REFERENCES org_procurement_policies (org_id, id),
  FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id),
  -- Một RFQ có ĐÚNG MỘT ngân sách. Không có ràng buộc này, "hàng nào là bằng chứng" là một câu
  -- hỏi có nhiều câu trả lời, và trigger dưới đây sẽ phải chọn — tức sẽ chọn sai một lúc nào đó.
  UNIQUE (org_id, rfq_id)
);

ALTER TABLE rfq_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_budgets FORCE ROW LEVEL SECURITY;

CREATE POLICY rfq_budgets_tenant_isolation ON rfq_budgets
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON rfq_budgets TO app_api;
GRANT INSERT (org_id, rfq_id, estimated_value, currency, policy_id,
              created_by, created_by_session_id)
  ON rfq_budgets TO app_api;
-- Sửa được ước lượng là nhu cầu thật khi RFQ còn đang soạn. Nó bị giới hạn bằng trigger dưới đây,
-- cùng khuôn `rfq_items_chi_sua_khi_soan` của 011.
GRANT UPDATE (estimated_value, currency, policy_id) ON rfq_budgets TO app_api;
-- Cố ý KHÔNG cấp gì cho `app_unseal`.

CREATE TRIGGER rfq_budgets_kiem_danh_tinh
  BEFORE INSERT ON rfq_budgets
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'created_by', 'created_by_session_id');

-- ============================================================================================
-- (3) NGÂN SÁCH CHỈ SỬA ĐƯỢC KHI RFQ CÒN Ở DRAFT
-- ============================================================================================
-- Không có phép kiểm này, "bằng chứng của phân loại" sửa được SAU khi người duyệt đã ký — tức
-- bằng chứng nói một đằng còn quyết định đã ra một nẻo. Cùng lập luận `rfq_items_chi_sua_khi_soan`.
CREATE OR REPLACE FUNCTION public.rfq_budgets_chi_sua_khi_soan() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  trang_thai text;
BEGIN
  SELECT r.status INTO trang_thai
    FROM public.rfq_packages r
   WHERE r.id OPERATOR(pg_catalog.=) NEW.rfq_id
     AND r.org_id OPERATOR(pg_catalog.=) NEW.org_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay RFQ cua ngan sach nay' USING ERRCODE = 'check_violation';
  END IF;
  IF trang_thai <> 'DRAFT' THEN
    RAISE EXCEPTION 'Chi dat hoac sua duoc ngan sach khi RFQ con o DRAFT (dang %)', trang_thai
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$ham$;

CREATE TRIGGER rfq_budgets_chi_sua_khi_soan
  BEFORE INSERT OR UPDATE ON rfq_budgets
  FOR EACH ROW EXECUTE FUNCTION public.rfq_budgets_chi_sua_khi_soan();

-- ============================================================================================
-- (4) BỎ PHÊ DUYỆT KÉP PHẢI CÓ BẰNG CHỨNG — ĐÂY LÀ CÂU LỆNH CHỊU LỰC CỦA CẢ FILE
-- ============================================================================================
-- Trước file này, `requires_dual_approval = false` là một thứ người gọi ĐẶT. Sau file này, nó là
-- một thứ phải CHỨNG MINH: phải có một hàng `rfq_budgets` trỏ tới một chính sách có thật, và giá
-- trị ước lượng phải THẬT SỰ dưới ngưỡng của chính sách ấy.
--
-- Hướng ngược lại KHÔNG bị chặn: `true` luôn hợp lệ, kể cả dưới ngưỡng. Nghiêm hơn chính sách là
-- một quyền của người mua; lỏng hơn thì không.
--
-- Trigger RIÊNG chứ không sửa `rfq_kiem_chuyen_trang_thai`: hàm ấy là một khối 120 dòng mà 011 đã
-- phải viết lại trọn vẹn một lần: chép nó lần nữa để chèn tám dòng là nhân bản một luật.
--
-- ĐIỀU NÓ KHÔNG ĐÓNG, và nó là lỗ lớn nhất của mọi kiểm soát theo ngưỡng: người mua KHAI ƯỚC
-- LƯỢNG THẤP để đi dưới ngưỡng. Cùng họ với chia nhỏ đơn hàng. Thứ bắt được nó là so ước lượng
-- với GIÁ TRÚNG sau mở thầu, và phát hiện chia nhỏ — cả hai thuộc S2/S3, không thuộc S1.
-- MỘT nơi giữ phép so, hai nơi dùng nó — cùng khuôn `rfq_bam_noi_dung` của 011. Nếu ứng dụng tự
-- tính phép so ở TypeScript và trigger tính lại ở SQL, đó là HAI BẢN SAO của một luật, đúng thứ
-- đã hỏng hai lần ở 002. Và bản TypeScript sẽ sai theo một cách riêng: số tiền trong JS là
-- `double`, nên `0.1 + 0.2 >= 0.3` là một câu hỏi không có câu trả lời đáng tin.
--
-- Trả về NULL khi CHƯA CÓ BẰNG CHỨNG (không có ngân sách, hoặc ngân sách chưa trỏ chính sách nào).
-- NULL ở đây không phải "false" — nó là "chưa trả lời được", và mọi nơi dùng phải xử lý riêng.
CREATE OR REPLACE FUNCTION public.rfq_can_phe_duyet_kep(p_rfq uuid) RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  gia_tri     numeric;
  tien_te_ns  text;
  nguong      numeric;
  tien_te_cs  text;
BEGIN
  SELECT b.estimated_value, b.currency, p.dual_approval_threshold, p.currency
    INTO gia_tri, tien_te_ns, nguong, tien_te_cs
    FROM public.rfq_budgets b
    JOIN public.org_procurement_policies p
      ON p.id OPERATOR(pg_catalog.=) b.policy_id
     AND p.org_id OPERATOR(pg_catalog.=) b.org_id
   WHERE b.rfq_id OPERATOR(pg_catalog.=) p_rfq;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- So hai số khác đơn vị tiền tệ là một phép so vô nghĩa cho ra một phán quyết trông có nghĩa.
  IF tien_te_ns <> tien_te_cs THEN
    RAISE EXCEPTION 'Don vi tien te cua ngan sach (%) khac cua chinh sach (%)',
      tien_te_ns, tien_te_cs
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN gia_tri >= nguong;
END
$ham$;

CREATE OR REPLACE FUNCTION public.rfq_kiem_nguong_phe_duyet_kep() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  can_kep boolean;
BEGIN
  -- Nghiêm hơn thì luôn được. Chỉ đường NỚI mới phải chứng minh.
  IF NEW.requires_dual_approval THEN
    RETURN NEW;
  END IF;

  can_kep := public.rfq_can_phe_duyet_kep(NEW.id);

  IF can_kep IS NULL THEN
    RAISE EXCEPTION
      'Bo phe duyet kep phai co bang chung: chua co ngan sach va chinh sach cho RFQ nay (D2)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF can_kep THEN
    RAISE EXCEPTION 'Uoc luong dat hoac vuot nguong chinh sach — RFQ nay phai can hai phe duyet (D2)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$ham$;

-- Kiểm ở CẢ HAI cạnh đi vào vòng phê duyệt và vòng mở, cùng khuôn mục (g) của 011. `requires_dual_approval`
-- chỉ sửa được khi còn DRAFT (011 mục (d)), nên sau cạnh này nó không lật lại được.
CREATE TRIGGER rfq_packages_kiem_nguong_phe_duyet_kep
  BEFORE UPDATE ON rfq_packages
  FOR EACH ROW
  WHEN (NEW.status IN ('PENDING_APPROVAL', 'OPEN') AND NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.rfq_kiem_nguong_phe_duyet_kep();
