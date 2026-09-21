-- ==============================================================================================
-- 057 — [S1.105 / S2.3 của spec Mảnh S2]
-- LƯỢT ĐÁNH GIÁ: `rfq_evaluations` + `rfq_evaluation_lines`, VÀ VẾ CẤU TRÚC CỦA **J1**
--
-- ----------------------------------------------------------------------------------------------
-- MỘT PHÁT HIỆN PHẢI ĐỌC TRƯỚC: `056` ĐỂ HỞ ĐÚNG THỨ J1 CẦN
-- ----------------------------------------------------------------------------------------------
-- J1 (spec §5) nói *"con số xếp hạng chỉ gồm các khoản có ĐƠN VỊ TIỀN"*, và cơ chế cưỡng chế là
-- *"một trigger đọc `org_procurement_policies` để biết chính sách khai thành phần nào có đơn vị
-- tiền"*. Nhưng hình dạng `eval_components` mà S1.102 để lại — `[{"ma":"gia","he_so":"1.00"}]` —
-- **KHÔNG CÓ MỘT TRƯỜNG ĐƠN VỊ NÀO**. Trigger ấy chưa có gì để đọc.
--
-- `056` nói rõ trong chính đầu tệp rằng nó *"không khai hình dạng BÊN TRONG của `eval_components`
-- ngoài 'phải là một mảng'"*, nên đây là chỗ hình dạng ấy phải được chốt. Hệ quả nói ra: fixture
-- của `db/chinh-sach-danh-gia.int.test.ts` mang đúng hình dạng cũ và nó **ĐỎ** ở vòng này. Đó là
-- một lượt đỏ CÓ ÍCH — nó là phép đo rằng ràng buộc mới có răng.
--
-- ----------------------------------------------------------------------------------------------
-- VÌ SAO `jsonb_path_exists` CHỨ KHÔNG PHẢI MỘT TRUY VẤN CON
-- ----------------------------------------------------------------------------------------------
-- Một `CHECK` **không chứa được truy vấn con**, nên *"mọi phần tử của mảng thoả X"* phải viết
-- bằng một biểu thức không truy vấn. `jsonb_path_exists(jsonb, jsonpath)` là `IMMUTABLE`
-- (`provolatile = 'i'`, đo trên PostgreSQL 16) nên nó dùng được trong `CHECK`.
--
-- **VÀ MỘT LỖ CHỈ PHÉP ĐO TÌM RA.** Vế `@.don_vi != "TIEN" && @.don_vi != "DIEM"` một mình
-- **KHÔNG bắt** `{"don_vi": 3}`: so một SỐ với một CHUỖI trong jsonpath cho *unknown*, nên bộ lọc
-- loại phần tử ấy ra và một `don_vi` kiểu số đi lọt. Đo được ở lượt dựng vòng này, trước dòng
-- migration đầu tiên. Vế `@.don_vi.type() != "string"` đứng TRƯỚC là thứ đóng nó — và với nó, cả
-- năm kiểu sai (`"XXX"`, `3`, `null`, `true`, `["TIEN"]`) đều bị bắt.
--
-- ----------------------------------------------------------------------------------------------
-- GIỚI HẠN CÓ THẬT, nói ra thay vì để người đọc tưởng chúng được canh
-- ----------------------------------------------------------------------------------------------
-- Khoản **105** (rổ A): hardening KHÔNG canh ràng buộc `CHECK` an ninh — gỡ hay hạ về `NOT VALID`
-- thì không lớp nào kêu. Mọi `CHECK` của tệp này nằm trong đúng khoảng trống ấy. Hai TRIGGER thì
-- được ghim, ở ba chỗ mỗi cái (khoản 211).
-- ==============================================================================================

-- ============================================================================================
-- (1) HÌNH DẠNG BÊN TRONG CỦA `eval_components` — thứ `056` cố ý để mở, và J1 đòi
-- ============================================================================================
-- Mỗi phần tử là một OBJECT mang đúng ba trường, cả ba là CHUỖI:
--   `ma`      mã thành phần, khớp với `ma` của đầu vào báo giá;
--   `don_vi`  `TIEN` hoặc `DIEM` — vế mà J1 treo vào;
--   `he_so`   hệ số quy đổi, chuỗi `numeric` (KHÔNG phải số JSON: `numeric` của Postgres và
--             `number` của JSON không cùng một miền, và tiền không được đi qua `double`).
--
-- Và mảng phải có ÍT NHẤT MỘT thành phần `TIEN`: một chính sách chỉ có điểm phi giá thì không
-- chấm ra được một con số tiền nào, nên nó là một chính sách khai một nửa ở một dạng khác.
ALTER TABLE org_procurement_policies
  ADD CONSTRAINT org_procurement_policies_eval_components_hinh_dang
  CHECK (eval_components IS NULL
         OR (NOT pg_catalog.jsonb_path_exists(
               eval_components,
               '$[*] ? (@.type() != "object" || !exists(@.ma) || !exists(@.don_vi) || !exists(@.he_so))')
             AND NOT pg_catalog.jsonb_path_exists(
               eval_components,
               '$[*] ? (@.ma.type() != "string" || @.he_so.type() != "string" || @.don_vi.type() != "string")')
             AND NOT pg_catalog.jsonb_path_exists(
               eval_components,
               '$[*] ? (@.don_vi != "TIEN" && @.don_vi != "DIEM")')
             AND pg_catalog.jsonb_path_exists(eval_components, '$[*] ? (@.don_vi == "TIEN")')));

-- ============================================================================================
-- (2) `rfq_evaluations` — MỘT LƯỢT CHẤM CỦA MỘT GÓI THẦU
-- ============================================================================================
-- **Vì sao `policy_id` là phiên bản HIỆN HÀNH lúc chấm, không phải `rfq_budgets.policy_id`.**
-- Spec §4.1 viết câu từ chối là *"chính sách phiên bản N chưa khai trọng số đánh giá; **tạo phiên
-- bản mới** trước khi chấm"*. Câu ấy chỉ có nghĩa nếu lượt chấm đọc phiên bản MỚI NHẤT: nếu nó bị
-- ghim vào phiên bản của ngân sách thì tạo phiên bản mới chẳng giúp gì, và mọi RFQ ra đời trước
-- S2 sẽ không bao giờ chấm được. Cột này vì thế là một BẢN GHI (lượt này đã dùng phiên bản nào),
-- không phải một phép suy.
--
-- **`currency` nằm ở đây, không suy lúc đọc.** Spec §2.3⑻: các báo giá đọc được KHÔNG cùng đơn vị
-- tiền thì cả lượt đánh giá bị TỪ CHỐI, vì `min(1000 USD, 2000 VND)` là con số không nghĩa và một
-- `rank` thì không có giá trị `null` nào có nghĩa. Ghi đơn vị đã chấm vào hàng làm lượt chấm tự
-- mô tả được, và làm câu hỏi *"vì sao ba báo giá này so được với nhau"* trả lời được từ dữ liệu.
CREATE TABLE rfq_evaluations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id),
  rfq_id                uuid NOT NULL,
  policy_id             uuid NOT NULL,
  currency              text NOT NULL CHECK (currency IN ('VND', 'USD')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  created_by_session_id uuid NOT NULL,
  FOREIGN KEY (org_id, rfq_id)     REFERENCES rfq_packages (org_id, id),
  FOREIGN KEY (org_id, policy_id)  REFERENCES org_procurement_policies (org_id, id),
  FOREIGN KEY (org_id, created_by) REFERENCES users (org_id, id)
);

-- Khuôn 006 §1: mọi bảng được trỏ tới bằng FK hợp thành phải có cặp khoá ấy là UNIQUE.
-- `rfq_evaluation_lines` dùng nó ngay dưới; `rfq_bafo_rounds` của S2.5 cũng sẽ dùng (spec §4.2).
ALTER TABLE rfq_evaluations ADD CONSTRAINT rfq_evaluations_org_id_id_key UNIQUE (org_id, id);

ALTER TABLE rfq_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_evaluations FORCE ROW LEVEL SECURITY;

CREATE POLICY rfq_evaluations_tenant_isolation ON rfq_evaluations
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới SAU `027` phải TỰ mang policy khách. `027` lấp một lần cho lược đồ của
-- ngày ấy, và hardening KHÔNG dựng `_khach` cho bảng mới — nó chỉ PHÁN XÉT. Thiếu dòng này là
-- ba cổng đỏ, đã đo ở chính vòng này. Khách không có việc gì với một lượt chấm.
CREATE POLICY rfq_evaluations_khach ON rfq_evaluations AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

-- CHỈ GHI THÊM, và lớp cưỡng chế là QUYỀN chứ không phải một trigger: `app_api` không có `UPDATE`
-- lẫn `DELETE`. Chấm lại là một lượt chấm MỚI — spec §4.3 nói `BAFO_CLOSED->EVALUATING` sinh một
-- `rfq_evaluations` THỨ HAI và hàng cũ ở lại nguyên vẹn, vì *"vì sao xếp hạng đổi"* là một câu
-- hỏi kiểm toán thật. Cùng khuôn với `org_procurement_policies`.
-- **`id` (và `created_at`) KHÔNG nằm trong `GRANT INSERT`, và đó là một lớp canh chứ không khẩu vị.**
-- `INV-H14` phân loại một chỉ mục duy nhất là ORACLE xuyên tổ chức khi `app_api` GHI ĐƯỢC vào nó và
-- nó không dẫn đầu bằng `org_id` — kiểm tra duy nhất chạy dưới quyền hệ thống trên TOÀN bảng, nên
-- `duplicate key` trả lời được *"tổ chức khác có hàng này không"*. `<bảng>_pkey` ở đây là `(id)`,
-- nên một `GRANT INSERT` mức BẢNG biến nó thành đúng hình dạng ADR-013 từ chối. Khuôn `002` với
-- `users_pkey`: đóng bằng QUYỀN THEO CỘT. Bản đầu của vòng này cấp mức bảng và `test:int` đỏ.
GRANT SELECT ON rfq_evaluations TO app_api;
GRANT INSERT (org_id, rfq_id, policy_id, currency, created_by, created_by_session_id)
  ON rfq_evaluations TO app_api;
-- Cố ý KHÔNG cấp gì cho `app_unseal`: vai ấy giải mã, nó không chấm.

CREATE TRIGGER rfq_evaluations_kiem_danh_tinh
  BEFORE INSERT ON rfq_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(
    'created_by', 'created_by_session_id');
ALTER TABLE rfq_evaluations ENABLE ALWAYS TRIGGER rfq_evaluations_kiem_danh_tinh;

-- ============================================================================================
-- (3) `rfq_evaluation_lines` — MỘT HÀNG MỘT BÁO GIÁ
-- ============================================================================================
-- **FK trỏ vào `rfq_unsealed_bids (org_id, bid_version_id)`, và đó là một lựa chọn có lý do.**
-- `rfq_unsealed_bids` KHÔNG có `UNIQUE (org_id, id)` nên FK theo `id` là bất khả; nhưng nó có
-- `UNIQUE (org_id, bid_version_id)` từ `019`, và trỏ vào cặp ấy MẠNH HƠN: nó buộc mỗi hàng xếp
-- hạng phải trỏ tới một báo giá **ĐÃ MỞ**, chứ không chỉ tới một phiên bản báo giá tồn tại. Một
-- hàng xếp hạng cho một phong bì chưa mở là đúng thứ nguyên tắc ⑵ (*Open ≠ Award*) cấm.
--
-- **`effective_cost` và `rank` CÙNG có hoặc CÙNG không** — spec §2.3⑺: một báo giá mà
-- `bid_so_tien` (020) trả `NULL` (không phải số · `NaN` · `Infinity` · số âm) **vẫn có hàng**, với
-- cả hai cột `NULL`. Giữ hàng chứ không vứt, đúng tiền lệ `020`; và `J5` của S2.6 siết thêm rằng
-- award không trỏ được tới một hàng như thế.
--
-- **`components` không rỗng khi có số.** Một `effective_cost` không có thành phần nào sinh ra nó
-- là một con số không tái lập được — tức đúng thứ **J2** tồn tại để cấm.
CREATE TABLE rfq_evaluation_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id),
  evaluation_id   uuid NOT NULL,
  bid_version_id  uuid NOT NULL,
  effective_cost  numeric(18, 2),
  components      jsonb NOT NULL,
  rank            integer,
  FOREIGN KEY (org_id, evaluation_id)  REFERENCES rfq_evaluations (org_id, id),
  FOREIGN KEY (org_id, bid_version_id) REFERENCES rfq_unsealed_bids (org_id, bid_version_id),
  -- Một báo giá xuất hiện ĐÚNG MỘT LẦN trong một lượt chấm. Hai hàng cho một phong bì là hai
  -- thứ hạng, và bảng xếp hạng khi ấy không phải một thứ tự.
  UNIQUE (org_id, evaluation_id, bid_version_id),
  CONSTRAINT rfq_evaluation_lines_gia_va_hang_du_bo
    CHECK ((effective_cost IS NULL) = (rank IS NULL)),
  CONSTRAINT rfq_evaluation_lines_gia_hop_le
    CHECK (effective_cost IS NULL
           OR (effective_cost OPERATOR(pg_catalog.<>) 'NaN'::pg_catalog.numeric
               AND effective_cost OPERATOR(pg_catalog.<) 'Infinity'::pg_catalog.numeric)),
  CONSTRAINT rfq_evaluation_lines_hang_tu_mot
    CHECK (rank IS NULL OR rank OPERATOR(pg_catalog.>=) 1),
  -- VẾ CẤU TRÚC CỦA J1: `components` là một MẢNG, mọi phần tử là OBJECT mang trường `tien`, và
  -- `tien` là CHUỖI (số tiền đã quy đổi) hoặc `null` của JSON (thành phần phi giá). Vế NỘI DUNG
  -- — `tien` chỉ có ở thành phần mà chính sách khai `TIEN` — cần đọc `org_procurement_policies`
  -- nên nó là một TRIGGER, ở mục (4).
  CONSTRAINT rfq_evaluation_lines_components_hinh_dang
    CHECK (pg_catalog.jsonb_typeof(components) OPERATOR(pg_catalog.=) 'array'
           AND NOT pg_catalog.jsonb_path_exists(
                 components, '$[*] ? (@.type() != "object" || !exists(@.ma) || !exists(@.tien))')
           AND NOT pg_catalog.jsonb_path_exists(
                 components, '$[*] ? (@.ma.type() != "string")')
           AND NOT pg_catalog.jsonb_path_exists(
                 components, '$[*] ? (@.tien.type() != "string" && @.tien.type() != "null")')),
  CONSTRAINT rfq_evaluation_lines_co_so_thi_co_nguon
    CHECK (effective_cost IS NULL
           OR pg_catalog.jsonb_array_length(components) OPERATOR(pg_catalog.>) 0)
);

ALTER TABLE rfq_evaluation_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_evaluation_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY rfq_evaluation_lines_tenant_isolation ON rfq_evaluation_lines
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Cùng lý do như bảng cha ngay trên.
CREATE POLICY rfq_evaluation_lines_khach ON rfq_evaluation_lines AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

-- Cùng lý do `INV-H14` như bảng cha: `rfq_evaluation_lines_pkey` là `(id)`, nên `id` không
-- được cấp. `UNIQUE (org_id, evaluation_id, bid_version_id)` thì dẫn đầu bằng `org_id` rồi.
GRANT SELECT ON rfq_evaluation_lines TO app_api;
GRANT INSERT (org_id, evaluation_id, bid_version_id, effective_cost, components, rank)
  ON rfq_evaluation_lines TO app_api;

-- ============================================================================================
-- (4) VẾ NỘI DUNG CỦA **J1** — MỘT TRIGGER, VÌ MỘT `CHECK` KHÔNG ĐỌC ĐƯỢC BẢNG KHÁC
-- ============================================================================================
-- Mệnh đề: tập `(ma, đơn vị)` của `components` phải KHỚP NGUYÊN VĂN tập `(ma, don_vi)` mà phiên
-- bản chính sách được lượt chấm trỏ tới đã khai — kể cả số lần lặp. Đơn vị của một thành phần
-- trong `components` suy từ `tien`: `null` là `DIEM`, có giá trị là `TIEN`.
--
-- Nó chặn ĐỒNG THỜI bốn ca, và ca thứ tư là ca J1 nói tới:
--   ⑴ thiếu một thành phần chính sách đã khai;
--   ⑵ thừa một thành phần chính sách KHÔNG khai (một con số không ai giải thích được);
--   ⑶ trùng mã;
--   ⑷ **một thành phần chính sách khai `DIEM` mà hàng lại mang `tien` cho nó** — tức một điểm phi
--     giá đi vào `effective_cost`. Đó đúng là mệnh đề J1.
--
-- **KHÔNG `SECURITY DEFINER`, và đây là lý do đo được:** `org_procurement_policies` bật
-- `FORCE ROW LEVEL SECURITY`, và khoản **102** ghi rằng một hàm `SECURITY DEFINER` trên bảng
-- `FORCE RLS` trả 0 hàng ở cụm thật trong khi XANH trên CI (ở đó `migrate()` chạy bằng superuser).
-- Trigger này chạy bằng vai GỌI — `app_api` — và vai ấy đọc được chính sách của tổ chức đang gắn
-- qua policy `USING (org_id = app_current_org_id())`. Không cần quyền cao hơn, nên không lấy.
CREATE OR REPLACE FUNCTION public.kiem_thanh_phan_theo_chinh_sach() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  v_policy  uuid;
  v_cua_cs  text[];
  v_cua_hang text[];
BEGIN
  SELECT e.policy_id INTO v_policy
    FROM public.rfq_evaluations e
   WHERE e.org_id = NEW.org_id AND e.id = NEW.evaluation_id;

  IF v_policy IS NULL THEN
    -- Không với tới được qua đường công khai (FK hợp thành đã đòi hàng ấy tồn tại), nhưng một
    -- `NULL` im lặng ở đây sẽ làm phép so dưới đây thành `NULL = NULL` và trigger cho qua MỌI
    -- hàng. Fail-closed tường minh thay vì dựa vào một FK đứng ở nơi khác.
    RAISE EXCEPTION 'Khong doc duoc chinh sach cua luot danh gia (J1)'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT array_agg(x ORDER BY x) INTO v_cua_hang
    FROM (SELECT (c.value ->> 'ma')
                 || '|'
                 || CASE WHEN c.value ->> 'tien' IS NULL THEN 'DIEM' ELSE 'TIEN' END AS x
            FROM jsonb_array_elements(NEW.components) AS c(value)) AS s;

  SELECT array_agg(x ORDER BY x) INTO v_cua_cs
    FROM (SELECT (p.value ->> 'ma') || '|' || (p.value ->> 'don_vi') AS x
            FROM public.org_procurement_policies o,
                 jsonb_array_elements(o.eval_components) AS p(value)
           WHERE o.org_id = NEW.org_id AND o.id = v_policy) AS s;

  IF v_cua_cs IS NULL THEN
    RAISE EXCEPTION 'Chinh sach cua luot danh gia chua khai trong so danh gia (J1)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- `coalesce` cho mảng RỖNG: `components` rỗng hợp lệ ở hàng không đọc được giá, và khi ấy nó
  -- phải KHÁC tập của chính sách chứ không được thành `NULL` rồi cho qua.
  IF coalesce(v_cua_hang, ARRAY[]::text[]) <> v_cua_cs THEN
    RAISE EXCEPTION 'Thanh phan cua hang xep hang khong khop chinh sach da ghim (J1)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$ham$;

REVOKE ALL ON FUNCTION public.kiem_thanh_phan_theo_chinh_sach() FROM PUBLIC;

CREATE TRIGGER rfq_evaluation_lines_kiem_thanh_phan
  BEFORE INSERT ON rfq_evaluation_lines
  FOR EACH ROW
  WHEN (NEW.effective_cost IS NOT NULL)
  EXECUTE FUNCTION public.kiem_thanh_phan_theo_chinh_sach();
ALTER TABLE rfq_evaluation_lines ENABLE ALWAYS TRIGGER rfq_evaluation_lines_kiem_thanh_phan;
