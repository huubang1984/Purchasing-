-- ==============================================================================================
-- 9501_ban_luu_benchmark — [S1.9101 / S4.5c1 của spec S4] BẢN LƯU BENCHMARK CỦA BẢNG SO SÁNH: TÍNH MỘT LẦN CHO MỖI LẦN MỞ THẦU,
-- Ở LẦN ĐỌC ĐẦU TIÊN, RỒI LƯU (spec S4 §4.6, §9 S4.5c; L6, L7, L14; ADR-142 ⑼, ADR-9201)
--
-- Chủ dự án chốt 2026-10-01 sau phép đo (ADR-9201): ADR-142 ⑼ *"tính một lần khi gói vào `UNSEALED`"* không làm được trên CẠNH ấy —
-- spec S4 §3.1–3.2 cấm thêm dòng nào vào đường `CLOSED→UNSEALED`, vai `app_unseal` không đọc được đầu vào nào của benchmark, và trong
-- chính giao dịch mở thầu gói chưa thấy giá của mình (`quan_sat_gia` so `unsealed_at < p_moc` ngặt). Nên bản lưu được TÍNH ở lần đọc
-- ĐẦU TIÊN sau mở thầu, bởi người giữ `bid.view`, dưới `app_api`, rồi GHI một lần; mọi lần đọc sau đọc bản lưu.
--
-- (1) `price_benchmark_snapshots` — MỘT hàng cho MỖI lần mở thầu đã thực thi (`unseal_requests` của vòng một hay của một vòng BAFO):
--     gói, lần mở thầu, phiên bản chính sách ghim, phương pháp, mốc mở giá (`min(unsealed_at)`). Giá của chính các dòng đọc tại
--     `ghi_luc` — đúng `now()` của giao dịch tính, cùng `mocDoc` mặc định của `tinhBenchmarkGoi`.
--     • GHI MỘT LẦN cho mỗi lần mở thầu: `UNIQUE (org_id, unseal_request_id)`. Hai người mở bảng cùng lúc thì một người ghi, người kia
--       gặp ràng buộc và đọc lại bản đã ghi (`ON CONFLICT DO NOTHING` ở tầng gói).
--     • Lần mở thầu thuộc ĐÚNG gói: khoá ngoại `(org_id, unseal_request_id, rfq_id) → unseal_requests (org_id, id, rfq_id)`.
--     • VẾ L14 CỦA BẢN LƯU Ở CSDL: khoá ngoại `(org_id, rfq_id, policy_id) → rfq_packages (org_id, id, chinh_sach_ghim_id)` — phiên bản
--       mà bản lưu đọc ngưỡng PHẢI là phiên bản gói chụp lúc mở (`102`); cột ghim nằm ngoài mọi `GRANT` ghi.
--     Giới hạn nói ra: CSDL không kiểm lần mở thầu đã `EXECUTED`, hay là lần MỚI NHẤT của gói — tầng gói chọn nó.
-- (2) `price_benchmark_snapshot_lines` — MỘT hàng cho MỖI (báo giá, dòng) của lần mở thầu ấy: cùng cột nhãn, chiều, lý do, khoá dải và
--     số đếm của `price_benchmark_results` (`103`). KHÔNG cột nào có đơn vị tiền — spec §4.6 *"Kết quả benchmark KHÔNG được lưu dưới dạng
--     số"*: trung vị của một tập lẻ LÀ một giá có thật. Số của dải (Q1, trung vị, Q3) và `SAU_MOC` tính khi người dùng bấm *Xem dải*
--     từng dòng (chủ dự án chốt 2026-10-01), bằng một lần đọc `quan_sat_gia` tại `moc_mo_gia` — không lưu.
--     • GHI CÙNG GIAO DỊCH với hàng đầu: khoá ngoại `(org_id, snapshot_id, rfq_id, policy_id, ghi_luc) → price_benchmark_snapshots (org_id,
--       id, rfq_id, policy_id, ghi_luc)`; hai `ghi_luc` đều `DEFAULT now()` và đều NGOÀI `GRANT` — khuôn `…_cua_luot_cham_fk` của `103`.
--     • Báo giá là một phong bì ĐÃ MỞ: khoá ngoại `(org_id, bid_version_id) → rfq_unsealed_bids`.
--     Không có bảng đầu vào cho bản lưu: tham chiếu quan sát của phép tính lại L7 và bộ bằng chứng là của LƯỢT CHẤM (`103`); nhãn của
--     bản lưu tái lập bằng phép đọc as-of tại `moc_mo_gia` (cùng tính chất ấy — hàng nền chỉ-ghi-thêm có `ghi_luc`, L1).
-- (3) Hai bảng chỉ-ghi-thêm BẰNG QUYỀN (khuôn `103`): `SELECT` mức bảng, `INSERT` theo cột không `id` và không `ghi_luc`; không
--     `UPDATE`, không `DELETE`. Policy khách ĐÓNG HẲN (L6: nhà cung cấp không thấy benchmark).
-- ==============================================================================================

-- ============================================================================================
-- (0) ĐÍCH CỦA CÁC KHOÁ NGOẠI MỚI
-- ============================================================================================
-- Khuôn `006` §1: mọi bộ khoá được trỏ tới bằng khoá ngoại hợp thành phải là `UNIQUE`; cả bốn dẫn đầu bằng `org_id` (INV-H14). Hai bộ
-- đầu là siêu tập của `(org_id, id)` vốn đã duy nhất — ràng buộc chỉ để khoá ngoại có đích. Không cột nào trong hai bộ ấy bị `UPDATE` ở
-- đường mở thầu (`app_unseal` chỉ đổi `status`, `executed_at`), nên cạnh `CLOSED→UNSEALED` không có thêm dòng hay phép kiểm nào.
ALTER TABLE unseal_requests
  ADD CONSTRAINT unseal_requests_org_id_id_rfq_id_key UNIQUE (org_id, id, rfq_id);
ALTER TABLE rfq_packages
  ADD CONSTRAINT rfq_packages_org_id_id_chinh_sach_ghim_id_key UNIQUE (org_id, id, chinh_sach_ghim_id);

-- ============================================================================================
-- (1) `price_benchmark_snapshots` — MỘT HÀNG MỖI LẦN MỞ THẦU
-- ============================================================================================
CREATE TABLE price_benchmark_snapshots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations (id),
  rfq_id             uuid NOT NULL,
  unseal_request_id  uuid NOT NULL,
  policy_id          uuid NOT NULL,
  phuong_phap        text NOT NULL
                     CONSTRAINT price_benchmark_snapshots_phuong_phap_mien CHECK (phuong_phap = 'TRUNG_VI_THEO_GOI_V1'),
  -- Mốc mở giá của gói — `min(unsealed_at)` qua mọi lần mở thầu, tức mốc của vòng một. Dải đọc `quan_sat_gia(moc_mo_gia, hàng chuẩn)`.
  moc_mo_gia         timestamptz NOT NULL,
  ghi_luc            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_benchmark_snapshots_moc_truoc_ghi CHECK (moc_mo_gia OPERATOR(pg_catalog.<) ghi_luc),
  CONSTRAINT price_benchmark_snapshots_cua_lan_mo_fk FOREIGN KEY (org_id, unseal_request_id, rfq_id)
    REFERENCES unseal_requests (org_id, id, rfq_id),
  CONSTRAINT price_benchmark_snapshots_phien_ban_ghim_fk FOREIGN KEY (org_id, rfq_id, policy_id)
    REFERENCES rfq_packages (org_id, id, chinh_sach_ghim_id),
  CONSTRAINT price_benchmark_snapshots_mot_lan_mo_key UNIQUE (org_id, unseal_request_id),
  -- Đích của khoá ngoại `…_cung_ban_luu_fk` ở (2).
  UNIQUE (org_id, id, rfq_id, policy_id, ghi_luc)
);

ALTER TABLE price_benchmark_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_benchmark_snapshots FORCE ROW LEVEL SECURITY;

CREATE POLICY price_benchmark_snapshots_tenant_isolation ON price_benchmark_snapshots
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới tự mang policy khách. Khách không có việc gì với benchmark (L6).
CREATE POLICY price_benchmark_snapshots_khach ON price_benchmark_snapshots AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

GRANT SELECT ON price_benchmark_snapshots TO app_api;
GRANT INSERT (org_id, rfq_id, unseal_request_id, policy_id, phuong_phap, moc_mo_gia) ON price_benchmark_snapshots TO app_api;

-- ============================================================================================
-- (2) `price_benchmark_snapshot_lines` — MỘT HÀNG MỖI (BÁO GIÁ, DÒNG) CỦA MỘT BẢN LƯU
-- ============================================================================================
CREATE TABLE price_benchmark_snapshot_lines (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES organizations (id),
  snapshot_id            uuid NOT NULL,
  rfq_id                 uuid NOT NULL,
  policy_id              uuid NOT NULL,
  bid_version_id         uuid NOT NULL,
  line_no                integer NOT NULL,
  anh_xa_id              uuid,
  canonical_item_id      uuid,
  tien_te                text CONSTRAINT price_benchmark_snapshot_lines_tien_te_mien CHECK (tien_te IN ('VND', 'USD')),
  cua_so_tu              timestamptz,
  nhan                   text NOT NULL
                         CONSTRAINT price_benchmark_snapshot_lines_nhan_mien
                         CHECK (nhan IN ('BINH_THUONG', 'LECH_VUA', 'LECH_CAO', 'CHUA_DU_LICH_SU', 'KHONG_DO_DUOC')),
  chieu                  text CONSTRAINT price_benchmark_snapshot_lines_chieu_mien CHECK (chieu IN ('TREN', 'DUOI')),
  ly_do                  text
                         CONSTRAINT price_benchmark_snapshot_lines_ly_do_mien
                         CHECK (ly_do IN ('KHONG_DOC_DUOC', 'LECH_TONG', 'LECH_TIEN_TE', 'CHUA_ANH_XA', 'KHONG_QUY_DOI_DUOC')),
  so_quan_sat            integer,
  so_goi                 integer,
  so_ncc                 integer,
  so_goi_cung_nguoi_tao  integer,
  so_quan_sat_hoi_to     integer,
  so_loai_tien_te        integer,
  so_loai_gia_0          integer,
  hoi_to                 text[] NOT NULL
                         CONSTRAINT price_benchmark_snapshot_lines_hoi_to_mien
                         CHECK (hoi_to OPERATOR(pg_catalog.<@)
                                ARRAY['ANH_XA', 'BI_DANH_DON_VI', 'QUY_DOI', 'PHIEN_BAN_HANG_CHUAN']::pg_catalog.text[]),
  ghi_luc                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_benchmark_snapshot_lines_line_no_duong CHECK (line_no OPERATOR(pg_catalog.>) 0),
  -- Cùng ba luật của `103`: dòng không đo được mang lý do và KHÔNG mang dải; dòng đo được mang dải và đủ bộ số đếm.
  CONSTRAINT price_benchmark_snapshot_lines_do_duoc_du_bo
    CHECK ((nhan OPERATOR(pg_catalog.=) 'KHONG_DO_DUOC') = (ly_do IS NOT NULL)
           AND (nhan OPERATOR(pg_catalog.=) 'KHONG_DO_DUOC')
               = (tien_te IS NULL AND cua_so_tu IS NULL AND so_quan_sat IS NULL AND so_goi IS NULL AND so_ncc IS NULL
                  AND so_goi_cung_nguoi_tao IS NULL AND so_quan_sat_hoi_to IS NULL AND so_loai_tien_te IS NULL
                  AND so_loai_gia_0 IS NULL)
           AND (nhan OPERATOR(pg_catalog.=) 'KHONG_DO_DUOC' OR canonical_item_id IS NOT NULL)),
  CONSTRAINT price_benchmark_snapshot_lines_chieu_khi_lech
    CHECK ((chieu IS NOT NULL) = (nhan IN ('LECH_VUA', 'LECH_CAO'))),
  CONSTRAINT price_benchmark_snapshot_lines_so_dem_khong_am
    CHECK (so_quan_sat OPERATOR(pg_catalog.>=) 0 AND so_goi OPERATOR(pg_catalog.>=) 0
           AND so_ncc OPERATOR(pg_catalog.>=) 0 AND so_goi_cung_nguoi_tao OPERATOR(pg_catalog.>=) 0
           AND so_quan_sat_hoi_to OPERATOR(pg_catalog.>=) 0 AND so_loai_tien_te OPERATOR(pg_catalog.>=) 0
           AND so_loai_gia_0 OPERATOR(pg_catalog.>=) 0),
  -- (2) ở đầu tệp: cùng giao dịch với hàng đầu, cùng gói, cùng phiên bản ghim.
  CONSTRAINT price_benchmark_snapshot_lines_cung_ban_luu_fk FOREIGN KEY (org_id, snapshot_id, rfq_id, policy_id, ghi_luc)
    REFERENCES price_benchmark_snapshots (org_id, id, rfq_id, policy_id, ghi_luc),
  FOREIGN KEY (org_id, bid_version_id) REFERENCES rfq_unsealed_bids (org_id, bid_version_id),
  FOREIGN KEY (org_id, rfq_id, line_no) REFERENCES rfq_items (org_id, rfq_id, line_no),
  FOREIGN KEY (org_id, anh_xa_id) REFERENCES rfq_item_mappings (org_id, id),
  FOREIGN KEY (org_id, canonical_item_id) REFERENCES canonical_items (org_id, id),
  UNIQUE (org_id, snapshot_id, bid_version_id, line_no)
);

ALTER TABLE price_benchmark_snapshot_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_benchmark_snapshot_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY price_benchmark_snapshot_lines_tenant_isolation ON price_benchmark_snapshot_lines
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

CREATE POLICY price_benchmark_snapshot_lines_khach ON price_benchmark_snapshot_lines AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

GRANT SELECT ON price_benchmark_snapshot_lines TO app_api;
GRANT INSERT (org_id, snapshot_id, rfq_id, policy_id, bid_version_id, line_no, anh_xa_id, canonical_item_id, tien_te, cua_so_tu, nhan,
              chieu, ly_do, so_quan_sat, so_goi, so_ncc, so_goi_cung_nguoi_tao, so_quan_sat_hoi_to, so_loai_tien_te, so_loai_gia_0,
              hoi_to)
  ON price_benchmark_snapshot_lines TO app_api;
