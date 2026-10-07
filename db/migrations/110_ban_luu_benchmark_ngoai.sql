-- ==============================================================================================
-- 110_ban_luu_benchmark_ngoai — [S1.276 / S4.6b của spec S4] NHÃN THEO DẢI LỊCH SỬ NGOÀI TRONG BẢN LƯU BENCHMARK: TÍNH CÙNG LẦN TÍNH
-- BẢN LƯU, KHÔNG SỐ TIỀN, TÁCH KHỎI NHÃN NỘI BỘ (spec S4 §4.6, §2.4 ⑽; L1, L6, L15; ADR-096 ⑷, ADR-143, ADR-149 ⑵; ADR-151)
--
-- Chủ dự án chốt 2026-10-06 sau phép đo (ADR-151): nhãn của mỗi báo giá theo dải lịch sử mua ngoài hệ thống TÍNH ở lần đọc đầu, cùng
-- giao dịch tính bản lưu nội bộ (`104`) — lúc ấy đơn giá quy đổi của chính các báo giá đã có trong tay; mọi lần đọc sau đọc lại nhãn ấy.
-- Đo: tính lại nhãn ngoài ở MỖI lần đọc cần đơn giá quy đổi của gói, tức đúng lần đọc as-of `quan_sat_gia` đắt mà `104` sinh ra để tránh
-- (18–19 s một gói 20 dòng ở 5.000 gói, §S1.256).
--
-- `price_benchmark_snapshot_external_lines` — MỘT hàng cho MỖI (báo giá, dòng) ĐO ĐƯỢC của một bản lưu: nhãn, chiều, cửa sổ ngày, số
-- đếm của dải ngoài. KHÔNG cột nào có đơn vị tiền — spec §4.6 *"Kết quả benchmark KHÔNG được lưu dưới dạng số"*. Số của dải (Q1, trung
-- vị, Q3), mốc ngoài và độ lệch tính khi bấm *Xem dải* một dòng, không lưu. Mốc ngoài không có cột ở đây: nó KHÔNG sinh nhãn (ADR-096
-- ⑷), và cờ *"có mốc ngoài"* ở bảng benchmark đọc tại mốc mở giá đã lưu ở mỗi lần đọc — rẻ, không cần giá.
--   • L15 — tách khỏi nhãn nội bộ: bảng riêng, không cột nào của `price_benchmark_snapshot_lines` mang nhãn ngoài, và không lượt chấm
--     hay bộ bằng chứng nào đọc bảng này (lượt chấm ghi `103`, không ghi đây). Tệp này KHÔNG nhắc tên hai bảng ngoài — luật ⑶ của
--     `tests/architecture/bang-ngoai-liet-ke.test.ts`: chỉ `109` và tệp ghim nhắc chúng; không khoá ngoại nào trỏ về đó.
--   • GHI CÙNG GIAO DỊCH với bản lưu: khoá ngoại `(org_id, snapshot_id, rfq_id, policy_id, ghi_luc) → price_benchmark_snapshots` — khuôn
--     `…_cung_ban_luu_fk` của `104`; `ghi_luc` `DEFAULT now()` NGOÀI `GRANT`.
--   • Mỗi hàng là của một dòng ĐO ĐƯỢC của chính bản lưu ấy, cùng hàng chuẩn và tiền tệ: khoá ngoại sáu cột tới
--     `price_benchmark_snapshot_lines`. Dòng `KHONG_DO_DUOC` có `tien_te` NULL (`…_do_duoc_du_bo` của `104`), nên không hàng nào ở đây
--     trỏ về nó được — hai cột ấy `NOT NULL`.
--   • Bản lưu tính TRƯỚC khi có tệp này không có hàng nào ở đây: tầng gói nói ra *"bản lưu tính trước khi có lịch sử ngoài"* khi bản
--     lưu có dòng đo được mà không hàng nào ở bảng này.
-- Chỉ-ghi-thêm BẰNG QUYỀN (khuôn `103`, `104`): `SELECT` mức bảng, `INSERT` theo cột không `id` và không `ghi_luc`; không `UPDATE`,
-- không `DELETE`. Policy khách ĐÓNG HẲN (L6).
-- ==============================================================================================

-- Đích của khoá ngoại sáu cột — siêu tập của `UNIQUE (org_id, snapshot_id, bid_version_id, line_no)` vốn đã có (khuôn `006` §1).
ALTER TABLE price_benchmark_snapshot_lines
  ADD CONSTRAINT price_benchmark_snapshot_lines_dong_do_duoc_key
  UNIQUE (org_id, snapshot_id, bid_version_id, line_no, canonical_item_id, tien_te);

CREATE TABLE price_benchmark_snapshot_external_lines (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES organizations (id),
  snapshot_id            uuid NOT NULL,
  rfq_id                 uuid NOT NULL,
  policy_id              uuid NOT NULL,
  bid_version_id         uuid NOT NULL,
  line_no                integer NOT NULL,
  canonical_item_id      uuid NOT NULL,
  tien_te                text NOT NULL
                         CONSTRAINT price_benchmark_snapshot_external_lines_tien_te_mien CHECK (tien_te IN ('VND', 'USD')),
  -- Cửa sổ NGÀY (giờ Việt Nam) của ngày mua: [ngày(mốc mở giá) − `cua_so_thang` tháng, ngày(mốc mở giá)], cả hai đầu tính vào.
  cua_so_tu              date NOT NULL,
  den_ngay               date NOT NULL,
  nhan                   text NOT NULL
                         CONSTRAINT price_benchmark_snapshot_external_lines_nhan_mien
                         CHECK (nhan IN ('BINH_THUONG', 'LECH_VUA', 'LECH_CAO', 'CHUA_DU_LICH_SU')),
  chieu                  text CONSTRAINT price_benchmark_snapshot_external_lines_chieu_mien CHECK (chieu IN ('TREN', 'DUOI')),
  -- Hàng đã vào dải; "gói" (ngày mua, nhà cung cấp đã làm sạch); nhà cung cấp khác nhau; hàng loại vì khác tiền tệ, vì đơn vị không
  -- quy đổi được tại mốc.
  so_dong                integer NOT NULL,
  so_goi                 integer NOT NULL,
  so_ncc                 integer NOT NULL,
  so_loai_tien_te        integer NOT NULL,
  so_loai_khong_quy_doi  integer NOT NULL,
  ghi_luc                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_benchmark_snapshot_external_lines_line_no_duong CHECK (line_no OPERATOR(pg_catalog.>) 0),
  CONSTRAINT price_benchmark_snapshot_external_lines_cua_so CHECK (cua_so_tu OPERATOR(pg_catalog.<=) den_ngay),
  CONSTRAINT price_benchmark_snapshot_external_lines_chieu_khi_lech
    CHECK ((chieu IS NOT NULL) = (nhan IN ('LECH_VUA', 'LECH_CAO'))),
  CONSTRAINT price_benchmark_snapshot_external_lines_so_dem
    CHECK (so_loai_tien_te OPERATOR(pg_catalog.>=) 0 AND so_loai_khong_quy_doi OPERATOR(pg_catalog.>=) 0
           AND so_ncc OPERATOR(pg_catalog.>=) 0 AND so_ncc OPERATOR(pg_catalog.<=) so_goi
           AND so_goi OPERATOR(pg_catalog.<=) so_dong),
  -- Có nhãn đo được thì có ít nhất một gói — sàn thật (`san_goi`, `san_ncc`) nằm trên phiên bản chính sách, tầng gói kiểm.
  CONSTRAINT price_benchmark_snapshot_external_lines_co_dai
    CHECK (nhan OPERATOR(pg_catalog.=) 'CHUA_DU_LICH_SU' OR so_goi OPERATOR(pg_catalog.>) 0),
  CONSTRAINT price_benchmark_snapshot_external_lines_cung_ban_luu_fk
    FOREIGN KEY (org_id, snapshot_id, rfq_id, policy_id, ghi_luc)
    REFERENCES price_benchmark_snapshots (org_id, id, rfq_id, policy_id, ghi_luc),
  CONSTRAINT price_benchmark_snapshot_external_lines_dong_do_duoc_fk
    FOREIGN KEY (org_id, snapshot_id, bid_version_id, line_no, canonical_item_id, tien_te)
    REFERENCES price_benchmark_snapshot_lines (org_id, snapshot_id, bid_version_id, line_no, canonical_item_id, tien_te),
  UNIQUE (org_id, snapshot_id, bid_version_id, line_no)
);

ALTER TABLE price_benchmark_snapshot_external_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_benchmark_snapshot_external_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY price_benchmark_snapshot_external_lines_tenant_isolation ON price_benchmark_snapshot_external_lines
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- [khoản nợ 29] Bảng mới tự mang policy khách. Khách không có việc gì với benchmark (L6).
CREATE POLICY price_benchmark_snapshot_external_lines_khach ON price_benchmark_snapshot_external_lines AS RESTRICTIVE
  USING (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL)
  WITH CHECK (NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL);

GRANT SELECT ON price_benchmark_snapshot_external_lines TO app_api;
GRANT INSERT (org_id, snapshot_id, rfq_id, policy_id, bid_version_id, line_no, canonical_item_id, tien_te, cua_so_tu, den_ngay, nhan,
              chieu, so_dong, so_goi, so_ncc, so_loai_tien_te, so_loai_khong_quy_doi)
  ON price_benchmark_snapshot_external_lines TO app_api;
