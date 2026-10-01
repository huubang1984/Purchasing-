-- ==============================================================================================
-- 9501_benchmark_gia — [S1.9101 / S4.5b của spec S4] BENCHMARK GIÁ: NHÓM KHOÁ `benchmark` CỦA CHÍNH SÁCH, BẢNG KẾT QUẢ VÀ
-- BẢNG ĐẦU VÀO (spec S4 §4.1, §4.6, §2.4 ⑾, §2.5 ⑿ ㉒; §5.1 L7, L14; ADR-9201)
--
-- Chủ dự án chốt ngày 2026-10-01 (ADR-141 ⑧ và bốn điểm của S4.5b): phương pháp `TRUNG_VI_THEO_GOI_V1` — mỗi gói một trung vị
-- trên báo giá vị thế cuối, mốc so là trung vị của các trung vị gói; nhãn trong tập ĐÓNG năm phần tử, kể cả `KHONG_DO_DUOC` cho
-- dòng không đo được; kết quả lưu NHÃN và CHIỀU, không lưu con số nào có đơn vị tiền; bảng con lưu THAM CHIẾU tới quan sát.
--
-- (1) Cột `org_procurement_policies.benchmark jsonb` — sáu khoá, mọi giá trị là CHUỖI (ADR-053 ⑴). `NULL` = phiên bản chưa cấu
--     hình benchmark: lượt chấm vẫn chạy, không hàng kết quả nào được ghi (ADR-141 ⑧). Biên GIẢ ĐỊNH của spec §4.1: `cua_so_thang`
--     trong [1, 60]; hai sàn trong [1, 50]; hai ngưỡng dương, tối đa bốn chữ số lẻ, `0 < nguong_lech_vua < nguong_lech_cao ≤ 10`.
--     So bằng `.double()` vì jsonpath của Postgres 16 không có `.decimal()` (spec §2.5 ㉒): đó là ngưỡng, không phải tiền, và hai
--     giá trị bốn chữ số lẻ khác nhau cách nhau ≥ 1e-4 — xa hơn sai số của `double` nhiều bậc. Vế HÌNH DẠNG dùng `like_regex` trên
--     CHUỖI trước, nên `.double()` không bao giờ nhận `"1e3"`, `"NaN"` hay một số JSON. Cả hai vế viết DẠNG DƯƠNG
--     (`jsonb_path_exists(... ? (điều kiện))`): dạng phủ định để lọt khoá vắng mặt (biên bản an ninh, M5 của S1.235).
-- (2) `price_benchmark_results` — MỘT hàng cho MỖI (báo giá của lượt chấm, dòng của gói). Không cột tiền: nhãn, chiều, lý do không
--     đo được, khoá dải (hàng chuẩn, tiền tệ, cửa sổ), số đếm thành phần (n gói · m nhà cung cấp · k gói cùng người tạo · h quan sát
--     hồi tố · số quan sát bị loại vì khác tiền tệ và vì đơn giá 0), cờ hồi tố của chính dòng.
-- (3) `price_benchmark_inputs` — MỘT hàng cho MỖI quan sát đã vào một dải: (báo giá, dòng) khoá ngoại tới `rfq_unsealed_bids`, kèm
--     id hàng ánh xạ đã dùng và cờ hồi tố của quan sát. Dải là của (lượt chấm, hàng chuẩn, tiền tệ) — mọi báo giá của gói X trên
--     cùng hàng chuẩn và cùng tiền tệ so với CÙNG một dải, nên đầu vào lưu một lần cho dải, không một lần cho mỗi báo giá.
--     Lệch khỏi chữ của spec §4.6 *"cùng id mọi hàng nền đã dùng"*, nói ra (ADR-9201): bí danh đơn vị toàn cục không có id, và quy
--     đổi, phiên bản hàng chuẩn tái lập được bằng phép đọc as-of tại `moc_mo_gia` — hàng nền là chỉ-ghi-thêm có `ghi_luc` (L1).
--     `quan_sat_gia` không đổi.
-- (4) GHI ĐÚNG MỘT LẦN, TRONG GIAO DỊCH TẠO LƯỢT CHẤM — cưỡng chế bằng KHOÁ NGOẠI, không trigger: `ghi_luc` của hai bảng mới và
--     `rfq_evaluations.created_at` đều `DEFAULT now()` và đều NGOÀI `GRANT INSERT`, nên chúng bằng nhau khi và chỉ khi cùng giao
--     dịch. Khoá ngoại `(org_id, evaluation_id, …, ghi_luc) → rfq_evaluations (org_id, id, …, created_at)` từ chối mọi lần ghi ở
--     giao dịch khác. Hàng kết quả còn mang `rfq_id` và `policy_id` của CHÍNH lượt chấm qua cùng khoá ngoại: phiên bản chính sách mà
--     benchmark đọc ngưỡng là phiên bản lượt chấm dùng, tức phiên bản ghim của gói (S4.5a) — vế benchmark của L14 nằm ở CSDL.
--     Giới hạn nói ra: CSDL không kiểm ĐỦ hàng (mỗi dòng × mỗi báo giá) hay ĐÚNG nhãn — phép tính lại L7 kiểm.
-- (5) Hai bảng chỉ-ghi-thêm BẰNG QUYỀN — khuôn `rfq_evaluation_lines` (`057`): `SELECT` mức bảng, `INSERT` theo cột không có `id`
--     (INV-H14) và không có `ghi_luc`; không `UPDATE`, không `DELETE`. Policy khách ĐÓNG HẲN.
-- ==============================================================================================

-- ============================================================================================
-- (1) NHÓM KHOÁ `benchmark` CỦA PHIÊN BẢN CHÍNH SÁCH
-- ============================================================================================
ALTER TABLE org_procurement_policies ADD COLUMN benchmark jsonb;

ALTER TABLE org_procurement_policies
  ADD CONSTRAINT org_procurement_policies_benchmark_hinh_dang
  CHECK (benchmark IS NULL
         OR (pg_catalog.jsonb_typeof(benchmark) OPERATOR(pg_catalog.=) 'object'
             AND (benchmark OPERATOR(pg_catalog.-) ARRAY['cua_so_thang', 'san_goi', 'san_ncc', 'nguong_lech_vua',
                                                         'nguong_lech_cao', 'phuong_phap']::pg_catalog.text[])
                 OPERATOR(pg_catalog.=) '{}'::pg_catalog.jsonb
             AND pg_catalog.jsonb_path_exists(
                   benchmark,
                   '$ ? (@.cua_so_thang like_regex "^[1-9][0-9]?$" && @.san_goi like_regex "^[1-9][0-9]?$"
                         && @.san_ncc like_regex "^[1-9][0-9]?$"
                         && @.nguong_lech_vua like_regex "^(0|[1-9][0-9]?)([.][0-9]{1,4})?$"
                         && @.nguong_lech_cao like_regex "^(0|[1-9][0-9]?)([.][0-9]{1,4})?$"
                         && @.phuong_phap == "TRUNG_VI_THEO_GOI_V1")')
             AND pg_catalog.jsonb_path_exists(
                   benchmark,
                   '$ ? (@.cua_so_thang.double() <= 60 && @.san_goi.double() <= 50 && @.san_ncc.double() <= 50
                         && @.nguong_lech_vua.double() > 0
                         && @.nguong_lech_vua.double() < @.nguong_lech_cao.double()
                         && @.nguong_lech_cao.double() <= 10)')));

-- Cộng dồn vào tập `INSERT` theo cột của `014`/`020`/`056`/`069`. Vẫn KHÔNG `UPDATE`: đổi ngưỡng là một phiên bản mới.
GRANT INSERT (benchmark) ON org_procurement_policies TO app_api;

-- ============================================================================================
-- (2) ĐÍCH CỦA CÁC KHOÁ NGOẠI MỚI
-- ============================================================================================
-- Khuôn `006` §1: mọi cặp khoá được trỏ tới bằng khoá ngoại hợp thành phải là `UNIQUE`. Cả ba dẫn đầu bằng `org_id` (INV-H14).
-- Hai ràng buộc của `rfq_evaluations` mang `created_at` — vế *"cùng giao dịch"* của mục (4) ở đầu tệp.
ALTER TABLE rfq_evaluations
  ADD CONSTRAINT rfq_evaluations_luot_chinh_sach_luc_key UNIQUE (org_id, id, rfq_id, policy_id, created_at);
ALTER TABLE rfq_evaluations
  ADD CONSTRAINT rfq_evaluations_luot_luc_key UNIQUE (org_id, id, created_at);
ALTER TABLE rfq_item_mappings
  ADD CONSTRAINT rfq_item_mappings_org_id_id_key UNIQUE (org_id, id);

-- ============================================================================================
-- (3) `price_benchmark_results` — MỘT HÀNG MỖI (BÁO GIÁ, DÒNG) CỦA MỘT LƯỢT CHẤM
-- ============================================================================================
CREATE TABLE price_benchmark_results (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES organizations (id),
  evaluation_id          uuid NOT NULL,
  rfq_id                 uuid NOT NULL,
  policy_id              uuid NOT NULL,
  bid_version_id         uuid NOT NULL,
  line_no                integer NOT NULL,
  phuong_phap            text NOT NULL
                         CONSTRAINT price_benchmark_results_phuong_phap_mien CHECK (phuong_phap = 'TRUNG_VI_THEO_GOI_V1'),
  -- Mốc mở giá của gói X — `min(unsealed_at)`. Dải đọc `quan_sat_gia(moc_mo_gia, hàng chuẩn)`.
  moc_mo_gia             timestamptz NOT NULL,
  -- Hàng ánh xạ của CHÍNH dòng (đọc tại `ghi_luc`), khi có.
  anh_xa_id              uuid,
  canonical_item_id      uuid,
  -- Khoá dải: tiền tệ của báo giá đang xét và mốc đầu cửa sổ (`moc_mo_gia − cua_so_thang` tháng).
  tien_te                text CONSTRAINT price_benchmark_results_tien_te_mien CHECK (tien_te IN ('VND', 'USD')),
  cua_so_tu              timestamptz,
  nhan                   text NOT NULL
                         CONSTRAINT price_benchmark_results_nhan_mien
                         CHECK (nhan IN ('BINH_THUONG', 'LECH_VUA', 'LECH_CAO', 'CHUA_DU_LICH_SU', 'KHONG_DO_DUOC')),
  chieu                  text CONSTRAINT price_benchmark_results_chieu_mien CHECK (chieu IN ('TREN', 'DUOI')),
  -- Trạng thái `quan_sat_gia` của chính dòng khi nó không `HOP_LE`; `CHUA_ANH_XA` cả khi dòng không có ánh xạ hiệu lực nào.
  ly_do                  text
                         CONSTRAINT price_benchmark_results_ly_do_mien
                         CHECK (ly_do IN ('KHONG_DOC_DUOC', 'LECH_TONG', 'LECH_TIEN_TE', 'CHUA_ANH_XA', 'KHONG_QUY_DOI_DUOC')),
  so_quan_sat            integer,
  so_goi                 integer,
  so_ncc                 integer,
  so_goi_cung_nguoi_tao  integer,
  so_quan_sat_hoi_to     integer,
  so_loai_tien_te        integer,
  so_loai_gia_0          integer,
  -- Loại hàng nền của CHÍNH dòng ghi sau `moc_mo_gia` (L1 `SAU_MO_GIA`) — tập của `quan_sat_gia.hoi_to`.
  hoi_to                 text[] NOT NULL
                         CONSTRAINT price_benchmark_results_hoi_to_mien
                         CHECK (hoi_to OPERATOR(pg_catalog.<@)
                                ARRAY['ANH_XA', 'BI_DANH_DON_VI', 'QUY_DOI', 'PHIEN_BAN_HANG_CHUAN']::pg_catalog.text[]),
  ghi_luc                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_benchmark_results_line_no_duong CHECK (line_no OPERATOR(pg_catalog.>) 0),
  -- Dòng không đo được mang lý do và KHÔNG mang dải; dòng đo được mang dải và đủ bộ số đếm.
  CONSTRAINT price_benchmark_results_do_duoc_du_bo
    CHECK ((nhan OPERATOR(pg_catalog.=) 'KHONG_DO_DUOC') = (ly_do IS NOT NULL)
           AND (nhan OPERATOR(pg_catalog.=) 'KHONG_DO_DUOC')
               = (tien_te IS NULL AND cua_so_tu IS NULL AND so_quan_sat IS NULL AND so_goi IS NULL AND so_ncc IS NULL
                  AND so_goi_cung_nguoi_tao IS NULL AND so_quan_sat_hoi_to IS NULL AND so_loai_tien_te IS NULL
                  AND so_loai_gia_0 IS NULL)
           AND (nhan OPERATOR(pg_catalog.=) 'KHONG_DO_DUOC' OR canonical_item_id IS NOT NULL)),
  -- Chiều chỉ có ở nhãn LỆCH: `BINH_THUONG` không có chiều, `CHUA_DU_LICH_SU` không có con số để so.
  CONSTRAINT price_benchmark_results_chieu_khi_lech
    CHECK ((chieu IS NOT NULL) = (nhan IN ('LECH_VUA', 'LECH_CAO'))),
  CONSTRAINT price_benchmark_results_so_dem_khong_am
    CHECK (so_quan_sat OPERATOR(pg_catalog.>=) 0 AND so_goi OPERATOR(pg_catalog.>=) 0
           AND so_ncc OPERATOR(pg_catalog.>=) 0 AND so_goi_cung_nguoi_tao OPERATOR(pg_catalog.>=) 0
           AND so_quan_sat_hoi_to OPERATOR(pg_catalog.>=) 0 AND so_loai_tien_te OPERATOR(pg_catalog.>=) 0
           AND so_loai_gia_0 OPERATOR(pg_catalog.>=) 0),
  -- Cửa sổ nằm TRƯỚC mốc mở giá.
  CONSTRAINT price_benchmark_results_cua_so_truoc_moc
    CHECK (cua_so_tu IS NULL OR cua_so_tu OPERATOR(pg_catalog.<) moc_mo_gia),
  -- (4) ở đầu tệp: cùng giao dịch với lượt chấm, cùng gói, cùng phiên bản chính sách.
  CONSTRAINT price_benchmark_results_cua_luot_cham_fk FOREIGN KEY (org_id, evaluation_id, rfq_id, policy_id, ghi_luc)
    REFERENCES rfq_evaluations (org_id, id, rfq_id, policy_id, created_at),
  -- Báo giá là một hàng của lượt chấm ấy — tức một phong bì ĐÃ MỞ (`057`).
  FOREIGN KEY (org_id, evaluation_id, bid_version_id)
    REFERENCES rfq_evaluation_lines (org_id, evaluation_id, bid_version_id),
  FOREIGN KEY (org_id, rfq_id, line_no) REFERENCES rfq_items (org_id, rfq_id, line_no),
  FOREIGN KEY (org_id, policy_id) REFERENCES org_procurement_policies (org_id, id),
  FOREIGN KEY (org_id, anh_xa_id) REFERENCES rfq_item_mappings (org_id, id),
  FOREIGN KEY (org_id, canonical_item_id) REFERENCES canonical_items (org_id, id),
  UNIQUE (org_id, evaluation_id, bid_version_id, line_no)
);

ALTER TABLE price_benchmark_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_benchmark_results FORCE ROW LEVEL SECURITY;

CREATE POLICY price_benchmark_results_tenant_isolation ON price_benchmark_results
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới tự mang policy khách. Khách không có việc gì với benchmark (L6).
CREATE POLICY price_benchmark_results_khach ON price_benchmark_results AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

GRANT SELECT ON price_benchmark_results TO app_api;
GRANT INSERT (org_id, evaluation_id, rfq_id, policy_id, bid_version_id, line_no, phuong_phap, moc_mo_gia, anh_xa_id,
              canonical_item_id, tien_te, cua_so_tu, nhan, chieu, ly_do, so_quan_sat, so_goi, so_ncc, so_goi_cung_nguoi_tao,
              so_quan_sat_hoi_to, so_loai_tien_te, so_loai_gia_0, hoi_to)
  ON price_benchmark_results TO app_api;

-- ============================================================================================
-- (4) `price_benchmark_inputs` — MỘT HÀNG MỖI QUAN SÁT ĐÃ VÀO MỘT DẢI
-- ============================================================================================
CREATE TABLE price_benchmark_inputs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations (id),
  evaluation_id      uuid NOT NULL,
  canonical_item_id  uuid NOT NULL,
  tien_te            text NOT NULL CONSTRAINT price_benchmark_inputs_tien_te_mien CHECK (tien_te IN ('VND', 'USD')),
  bid_version_id     uuid NOT NULL,
  line_no            integer NOT NULL CONSTRAINT price_benchmark_inputs_line_no_duong CHECK (line_no OPERATOR(pg_catalog.>) 0),
  anh_xa_id          uuid NOT NULL,
  hoi_to             text[] NOT NULL
                     CONSTRAINT price_benchmark_inputs_hoi_to_mien
                     CHECK (hoi_to OPERATOR(pg_catalog.<@)
                            ARRAY['ANH_XA', 'BI_DANH_DON_VI', 'QUY_DOI', 'PHIEN_BAN_HANG_CHUAN']::pg_catalog.text[]),
  ghi_luc            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_benchmark_inputs_cua_luot_cham_fk FOREIGN KEY (org_id, evaluation_id, ghi_luc)
    REFERENCES rfq_evaluations (org_id, id, created_at),
  FOREIGN KEY (org_id, canonical_item_id) REFERENCES canonical_items (org_id, id),
  FOREIGN KEY (org_id, bid_version_id) REFERENCES rfq_unsealed_bids (org_id, bid_version_id),
  FOREIGN KEY (org_id, anh_xa_id) REFERENCES rfq_item_mappings (org_id, id),
  -- Một quan sát có MỘT ánh xạ hiệu lực tại mốc và MỘT tiền tệ, nên thuộc đúng một dải của lượt chấm.
  UNIQUE (org_id, evaluation_id, bid_version_id, line_no)
);

ALTER TABLE price_benchmark_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_benchmark_inputs FORCE ROW LEVEL SECURITY;

CREATE POLICY price_benchmark_inputs_tenant_isolation ON price_benchmark_inputs
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

CREATE POLICY price_benchmark_inputs_khach ON price_benchmark_inputs AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

GRANT SELECT ON price_benchmark_inputs TO app_api;
GRANT INSERT (org_id, evaluation_id, canonical_item_id, tien_te, bid_version_id, line_no, anh_xa_id, hoi_to)
  ON price_benchmark_inputs TO app_api;
