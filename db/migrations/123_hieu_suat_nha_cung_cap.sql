-- ==============================================================================================
-- 123_hieu_suat_nha_cung_cap — [S1.291 / S3.8a của spec S3] VIEW HIỆU SUẤT NHÀ CUNG CẤP — CHỈ ĐỌC GÓI ĐÃ LỘ GIÁ (K11)
--
-- Spec: `docs/superpowers/specs/2026-09-26-trustprocure-s3-kiem-soat-mua-sam.md` §4.9, §5.1 K11, §6 T2. ADR-163. Kế hoạch chuẩn bị
-- `docs/superpowers/plans/2026-10-10-chuan-bi-s3-8-s3-9.md`. Chủ dự án chốt 2026-10-10 (câu 1): ~~`≥ CLOSED`~~ — chỉ số PHẢN HỒI
-- cũng chỉ đọc gói ĐÃ LỘ GIÁ, vì đọc từ lúc đóng làm lộ *ai đã nộp, sửa mấy lần* TRƯỚC mở niêm phong: so view trước và sau lúc gói
-- đóng là biết (góc C⑦ của S1.159 — spec S4 `:755`, `:969`; spec S4b ㊾).
--
-- MỘT view `security_invoker` (hardening (C) `CAU_DOC_VONG`), mỗi hàng một (tổ chức, nhà cung cấp) có ít nhất một số đếm khác 0. Hai
-- cổng, cả hai là CHÍNH vị từ `gia_da_lo` (`096`, L5, đã ghim) — không vị từ thứ hai nào để lệch với nó:
--   · cổng VÒNG MỘT `gia_da_lo(gói, LEAST(now(), cancelled_at, lần mở BAFO đầu))`: cột phản hồi của vòng một. Mốc lùi về lần mở BAFO
--     đầu nên giá vòng một — đã lộ trước khi vòng BAFO mở — vẫn đếm khi gói đang BAFO_OPEN/BAFO_CLOSED (đối chứng dương của K11
--     *"cả lúc BAFO_OPEN"*); mốc lùi về lúc huỷ nên gói huỷ SAU mở niêm phong vẫn đếm, gói huỷ TRƯỚC thì không bao giờ.
--   · cổng GIÁ `gia_da_lo(gói, now())`: phiên bản của vòng BAFO, hạng, khoảng cách tới hạng nhất, vào BAFO, thắng. Gói có vòng BAFO
--     đang mở hay đã đóng mà chưa mở niêm phong rời khỏi mọi cột này cho tới khi vòng ấy lộ.
--
-- Định nghĩa (kế hoạch §2):
--   · lời mời ĐƯỢC ĐẾM: `revoked_at IS NULL AND status <> 'UNSENT'` — link đã đi và bên mua không rút (từ vựng ADR-128). Chỉ mục bộ
--     phận `024` giữ tối đa MỘT lời mời sống mỗi (gói, nhà cung cấp), nên các cột VÒNG MỘT (nộp, phản hồi, sửa) ghép báo giá theo ĐÚNG
--     lời mời được đếm — luồng của lời mời đã thu hồi không vào. Phiên bản BAFO, hạng, vào BAFO, thắng ghép báo giá → lời mời KHÔNG lọc:
--     chúng đọc báo giá đã mở niêm phong, mà worker chỉ mở luồng còn sống và tầng gói chặn thu hồi sau lần mở thầu đầu (ADR-128);
--   · thời gian phản hồi: phiên bản vòng một ĐẦU của lời mời được đếm trừ `greatest(opened_at, lời mời.created_at)`, theo giây (sàn);
--     mời sau khi mở thì tính từ lúc mời — lệch §4.9 có chủ đích, ADR-163;
--   · trung vị là `percentile_disc(0.5)` — phần tử giữa, số chẵn thì phần tử DƯỚI: luôn là một giá trị có thật, tính lại được chính xác;
--   · khoảng cách tới hạng nhất tính bằng PHẦN VẠN, số nguyên: `(chi phí − thấp nhất) / thấp nhất`, làm tròn nửa lên bằng `div` — không
--     qua phép chia có làm tròn trung gian; thấp nhất bằng 0 thì khoảng cách của lượt ấy là NULL (không chia cho 0); kiểu `numeric`, KHÔNG
--     ép `bigint` — giá thấp nhất 0,01 cạnh một chi phí cỡ chục nghìn tỷ cho tỷ lệ vượt `bigint`, và một lần tràn làm hỏng view của CẢ tổ
--     chức (đầu vào nằm trong tay nhà cung cấp);
--   · thắng: hàng `rfq_awards` MỚI NHẤT của gói (`acted_at DESC, id DESC`, khuôn `094`) là `APPROVED` — trạng thái gói `AWARDED` chỉ là
--     *đã đề xuất*;
--   · vào BAFO: hạng ở `evaluation_id` của vòng ≤ `top_n` (cùng vị từ trigger nộp BAFO, `059`).
-- Tỷ lệ và sàn lịch sử (GIẢ ĐỊNH 5) không nằm ở đây: view trả số đếm và trung vị, tầng gói (`packages/kiem-soat/src/hieu-suat.ts`) tính tỷ
-- lệ và giữ lại mọi tỷ lệ, mọi trung vị có mẫu dưới sàn.
--
-- VỊ TỪ KHÁCH TRONG THÂN (K11 §5.1): phiên khách của lời mời đọc được hàng của CHÍNH nó ở `rfq_invitations`, `vendor_bids`,
-- `vendor_bid_versions`, `rfq_packages`, `rfq_bafo_rounds` (`027`, `060`). View này bắt đầu từ `suppliers` — bảng ĐÓNG với khách — nên
-- hôm nay nó ra 0 hàng cho phiên khách cả khi không có vị từ; một bản viết lại bắt đầu từ `rfq_invitations` thì không. Vị từ trong thân
-- là lớp không phụ thuộc bảng nào đứng đầu, và phép đếm của `rls-coverage` đòi nó ở MỌI view `app_api` đọc được. Vị từ là nguyên văn
-- mẫu `_khach` của `027`; phiên Passport đặt CHÍNH `app.guest_session_id` (ADR-081 ⑶) nên vị từ áp cho nó — suy từ cấu tạo, không phép
-- đo hành vi riêng (mọi bảng gốc của view đã ra 0 hàng với phiên ấy).
--
-- Không số tiền nào đi ra (không `effective_cost`, không tổng), không nhắc bảng bản rõ. Đọc bằng `app_api` — cổng `bid.view` ở tầng gói;
-- chỉ một tệp TypeScript được nhắc tên view (`tests/architecture/hieu-suat-liet-ke.test.ts`). Thân view ghim ở hardening.
-- ==============================================================================================

CREATE VIEW public.supplier_performance WITH (security_invoker = true) AS
WITH goi AS MATERIALIZED (
  SELECT r.org_id,
         r.id AS rfq_id,
         r.opened_at,
         public.gia_da_lo(r.org_id, r.id,
                          LEAST(pg_catalog.now(), r.cancelled_at,
                                (SELECT min(v.opened_at)
                                   FROM public.rfq_bafo_rounds v
                                  WHERE v.org_id = r.org_id AND v.rfq_id = r.id))) AS lo_vong_mot,
         public.gia_da_lo(r.org_id, r.id, pg_catalog.now()) AS lo_gia
    FROM public.rfq_packages r
),
loi_moi AS (
  SELECT i.org_id, i.supplier_id, i.rfq_id, i.id AS invitation_id, greatest(g.opened_at, i.created_at) AS moc_bat_dau
    FROM public.rfq_invitations i
    JOIN goi g ON g.org_id = i.org_id AND g.rfq_id = i.rfq_id
   WHERE g.lo_vong_mot AND i.revoked_at IS NULL AND i.status <> 'UNSENT'
),
nop AS (
  SELECT l.org_id, l.supplier_id, l.rfq_id, min(v.submitted_at) - l.moc_bat_dau AS phan_hoi, count(*) AS so_phien_ban
    FROM loi_moi l
    JOIN public.vendor_bids b ON b.org_id = l.org_id AND b.invitation_id = l.invitation_id
    JOIN public.vendor_bid_versions v ON v.org_id = b.org_id AND v.bid_id = b.id
   WHERE v.bafo_round_id IS NULL
   GROUP BY l.org_id, l.supplier_id, l.rfq_id, l.moc_bat_dau
),
sua_bafo AS (
  SELECT i.org_id, i.supplier_id, count(*) - count(DISTINCT (v.bid_id, v.bafo_round_id)) AS so_sua
    FROM public.vendor_bid_versions v
    JOIN public.vendor_bids b ON b.org_id = v.org_id AND b.id = v.bid_id
    JOIN public.rfq_invitations i ON i.org_id = b.org_id AND i.id = b.invitation_id
    JOIN goi g ON g.org_id = i.org_id AND g.rfq_id = i.rfq_id
   WHERE v.bafo_round_id IS NOT NULL AND g.lo_gia
   GROUP BY i.org_id, i.supplier_id
),
luot AS (
  SELECT DISTINCT ON (e.org_id, e.rfq_id) e.org_id, e.rfq_id, e.id AS evaluation_id
    FROM public.rfq_evaluations e
    JOIN goi g ON g.org_id = e.org_id AND g.rfq_id = e.rfq_id
   WHERE g.lo_gia
   ORDER BY e.org_id, e.rfq_id, e.created_at DESC, e.id DESC
),
hang AS (
  SELECT l.org_id, i.supplier_id, l.rfq_id, d.rank,
         pg_catalog.div((d.effective_cost - m.thap) * 20000 + m.thap, nullif(m.thap, 0) * 2) AS phan_van
    FROM luot l
    JOIN (SELECT d2.org_id, d2.evaluation_id, min(d2.effective_cost) AS thap
            FROM public.rfq_evaluation_lines d2
           GROUP BY d2.org_id, d2.evaluation_id) m ON m.org_id = l.org_id AND m.evaluation_id = l.evaluation_id
    JOIN public.rfq_evaluation_lines d ON d.org_id = l.org_id AND d.evaluation_id = l.evaluation_id
    JOIN public.vendor_bid_versions v ON v.org_id = d.org_id AND v.id = d.bid_version_id
    JOIN public.vendor_bids b ON b.org_id = v.org_id AND b.id = v.bid_id
    JOIN public.rfq_invitations i ON i.org_id = b.org_id AND i.id = b.invitation_id
   WHERE d.effective_cost IS NOT NULL
),
bafo AS (
  SELECT r.org_id, i.supplier_id, count(DISTINCT r.id) AS so_lan
    FROM public.rfq_bafo_rounds r
    JOIN goi g ON g.org_id = r.org_id AND g.rfq_id = r.rfq_id
    JOIN public.rfq_evaluation_lines d ON d.org_id = r.org_id AND d.evaluation_id = r.evaluation_id
    JOIN public.vendor_bid_versions v ON v.org_id = d.org_id AND v.id = d.bid_version_id
    JOIN public.vendor_bids b ON b.org_id = v.org_id AND b.id = v.bid_id
    JOIN public.rfq_invitations i ON i.org_id = b.org_id AND i.id = b.invitation_id
   WHERE g.lo_gia AND d.rank <= r.top_n
   GROUP BY r.org_id, i.supplier_id
),
thang AS (
  SELECT a.org_id, i.supplier_id, count(*) AS so_lan
    FROM (SELECT DISTINCT ON (x.org_id, x.rfq_id) x.org_id, x.rfq_id, x.status, x.bid_version_id
            FROM public.rfq_awards x
           ORDER BY x.org_id, x.rfq_id, x.acted_at DESC, x.id DESC) a
    JOIN goi g ON g.org_id = a.org_id AND g.rfq_id = a.rfq_id
    JOIN public.vendor_bid_versions v ON v.org_id = a.org_id AND v.id = a.bid_version_id
    JOIN public.vendor_bids b ON b.org_id = v.org_id AND b.id = v.bid_id
    JOIN public.rfq_invitations i ON i.org_id = b.org_id AND i.id = b.invitation_id
   WHERE g.lo_gia AND a.status = 'APPROVED'
   GROUP BY a.org_id, i.supplier_id
),
moi_gom AS (
  SELECT l.org_id, l.supplier_id, count(DISTINCT l.rfq_id) AS so_goi_moi
    FROM loi_moi l
   GROUP BY l.org_id, l.supplier_id
),
nop_gom AS (
  SELECT n.org_id, n.supplier_id,
         count(*) AS so_goi_nop,
         percentile_disc(0.5) WITHIN GROUP (ORDER BY floor(EXTRACT(epoch FROM n.phan_hoi))) AS trung_vi_giay,
         sum(n.so_phien_ban - 1) AS sua_vong_mot
    FROM nop n
   GROUP BY n.org_id, n.supplier_id
),
hang_gom AS (
  SELECT h.org_id, h.supplier_id,
         count(DISTINCT h.rfq_id) AS so_goi_xep_hang,
         percentile_disc(0.5) WITHIN GROUP (ORDER BY h.rank) AS hang_trung_vi,
         percentile_disc(0.5) WITHIN GROUP (ORDER BY h.phan_van) AS khoang_cach_trung_vi
    FROM hang h
   GROUP BY h.org_id, h.supplier_id
)
SELECT s.org_id,
       s.id AS supplier_id,
       coalesce(mg.so_goi_moi, 0)::bigint AS so_goi_moi,
       coalesce(ng.so_goi_nop, 0)::bigint AS so_goi_nop,
       ng.trung_vi_giay::bigint AS trung_vi_phan_hoi_giay,
       (coalesce(ng.sua_vong_mot, 0) + coalesce(sb.so_sua, 0))::bigint AS so_lan_sua,
       coalesce(hg.so_goi_xep_hang, 0)::bigint AS so_goi_xep_hang,
       hg.hang_trung_vi,
       hg.khoang_cach_trung_vi AS khoang_cach_trung_vi_phan_van,
       coalesce(bf.so_lan, 0)::bigint AS so_lan_vao_bafo,
       coalesce(th.so_lan, 0)::bigint AS so_lan_thang
  FROM public.suppliers s
  LEFT JOIN moi_gom mg ON mg.org_id = s.org_id AND mg.supplier_id = s.id
  LEFT JOIN nop_gom ng ON ng.org_id = s.org_id AND ng.supplier_id = s.id
  LEFT JOIN sua_bafo sb ON sb.org_id = s.org_id AND sb.supplier_id = s.id
  LEFT JOIN hang_gom hg ON hg.org_id = s.org_id AND hg.supplier_id = s.id
  LEFT JOIN bafo bf ON bf.org_id = s.org_id AND bf.supplier_id = s.id
  LEFT JOIN thang th ON th.org_id = s.org_id AND th.supplier_id = s.id
 WHERE NULLIF(pg_catalog.current_setting('app.guest_session_id', true), '')::pg_catalog.uuid IS NULL
   AND (mg.so_goi_moi IS NOT NULL OR hg.so_goi_xep_hang IS NOT NULL OR sb.so_sua IS NOT NULL
        OR bf.so_lan IS NOT NULL OR th.so_lan IS NOT NULL);

REVOKE ALL ON public.supplier_performance FROM PUBLIC;
GRANT SELECT ON public.supplier_performance TO app_api;
