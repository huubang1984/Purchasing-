-- =============================================================================================
-- 065 — [ADR-072 phần 1] VAI CỦA JOB NEO: liệt kê được MỌI tổ chức, chỉ ĐỌC được sổ kiểm toán
-- =============================================================================================
-- Job neo (`tools/neo-so-kiem-toan`, task ECS `tp-neo`) phải chạy theo lịch trên MỌI tổ chức. Tới
-- nay nó đăng nhập bằng URL của api và `SET ROLE app_api` — mà `app_api` KHÔNG liệt kê được tổ chức:
-- 052 thu hồi `public.outbox_danh_sach_to_chuc()` khỏi nó có chủ đích (ADR-040 — api là tiến trình
-- hướng internet; một lỗi ở một handler không được đọc ra danh sách mọi khách hàng của nền tảng). Nên
-- danh sách tổ chức phải do người vận hành gõ tay, và một danh sách gõ tay im lặng bỏ sót đúng tổ chức
-- ít hoạt động nhất — tổ chức ấy thì `verifyAuditChain` trả NOT_ANCHORED, mất trắng bảo đảm (ADR-026 §5).
--
-- Chủ dự án chốt (2026-09-26): một vai RIÊNG, quyền tối thiểu, thay vì nới `app_api`.
--   * `app_neo` (NOLOGIN) và role đăng nhập `app_neo_login` (tools/chay-migrate dựng, mật khẩu từ
--     secret) — role là đối tượng của CỤM nên `app_neo` được dựng ở `hardening.always.sql` BƯỚC 0,
--     cùng chỗ với app_api/app_unseal; tệp này chỉ mang GRANT.
--   * Quyền = ĐÚNG những gì hai hàm đọc của `packages/audit` chạm tới, liệt kê từng thứ dưới đây, và
--     KHÔNG GÌ KHÁC: không INSERT/UPDATE/DELETE ở đâu cả, không bảng nghiệp vụ nào (giá thầu, RFQ,
--     danh tính), không schema `app_private`.
--
-- CÁCH LY TỔ CHỨC KHÔNG CẦN DÒNG NÀO Ở ĐÂY: policy của `audit_events`/`audit_chain_anchors` (003) là
-- `TO PUBLIC USING (org_id = app_current_org_id())`, nên nó áp cho `app_neo` như cho mọi vai không
-- phải chủ bảng — FORCE ROW LEVEL SECURITY đã bật, `app_neo` NOBYPASSRLS (hardening ghim). Liệt kê được
-- MỌI tổ chức KHÔNG có nghĩa là đọc được sổ của mọi tổ chức trong cùng một giao dịch: sổ vẫn chỉ mở
-- cho tổ chức mà withTenant gắn. Đo ở `db/vai-neo.int.test.ts`.
-- =============================================================================================

-- USAGE trên schema là điều kiện cần để phân giải `public.*`; tự nó không mở đối tượng nào. Hardening
-- cấp lại ở MỌI lượt (role DROP rồi dựng lại tự lành), dòng này để 065 đứng được một mình.
GRANT USAGE ON SCHEMA public TO app_neo;

-- Policy RLS của 003 gọi hàm này, và `assertTenantBound` (packages/audit/src/tenant-guard.ts) gọi thẳng
-- nó để từ chối làm việc dưới tổ chức sai. Hardening cũng canh dòng này (mục EXECUTE trên app_current_org_id).
GRANT EXECUTE ON FUNCTION public.app_current_org_id() TO app_neo;

-- `verifyAuditChain` tính lại băm của TỪNG hàng từ mọi cột của nó, nên SELECT phải phủ cả bảng —
-- cấp theo cột ở đây chỉ là liệt kê lại toàn bộ cột và trôi mỗi lần 003 thêm một cột vào tiền ảnh băm.
-- `exportChainHead` đọc `seq`, `hash`, `org_id` — tập con của cùng quyền này.
GRANT SELECT ON audit_events TO app_neo;

-- Bảng mốc neo trong CSDL: `verifyAuditChain` chỉ đọc ba cột này (vế "mốc neo trỏ vào hàng không còn").
-- `id`, `anchored_at` không được cấp — quyền cấp "cho chắc" là một quyền không ai giải thích được (008).
GRANT SELECT (org_id, seq, hash) ON audit_chain_anchors TO app_neo;

-- `verifyAuditChain` băm lại bằng CHÍNH hàm lúc ghi. Hàm IMMUTABLE, SECURITY INVOKER, không đọc bảng
-- nào — gọi được nó không cho thêm quyền đọc gì ngoài đối số của chính người gọi.
GRANT EXECUTE ON FUNCTION public.audit_compute_hash(bytea, uuid, uuid, bigint, timestamptz,
                                                    text, uuid, text, text, uuid, jsonb, uuid,
                                                    inet, text)
  TO app_neo;

-- Hàm liệt kê tổ chức của 052: SECURITY DEFINER, chủ là `app_liet_ke_to_chuc` (NOLOGIN NOINHERIT), chỉ
-- trả `organizations.id`. Người gọi thứ hai sau `app_unseal`. `app_api` vẫn KHÔNG — hardening canh cả bốn
-- vế ("app_unseal có, app_neo có, app_api không, PUBLIC không") ở MỌI lượt migrate().
--
-- VÌ SAO MỘT KHỐI DO chứ không một câu GRANT trần: 052 cấp cho `app_unseal` TRƯỚC khi đổi chủ hàm, lúc vai
-- deploy còn là chủ. Từ đó chủ là `app_liet_ke_to_chuc`, và một vai deploy KHÔNG superuser (hồ sơ N3 —
-- CREATEROLE + chủ database, đúng hình dạng tài khoản master của RDS) không có quyền cấp tiếp: đo, câu trần
-- ném "permission denied for function outbox_danh_sach_to_chuc" và migrate() dừng ở 065. Nên vai deploy
-- MƯỢN quyền chủ hàm trong đúng giao dịch này — membership INHERIT TRUE, SET FALSE (không đổi vai được, không
-- câu đổi vai nào trong tệp — khoản 100), vai ấy tự cấp được vì CREATEROLE đã dựng `app_liet_ke_to_chuc` ở
-- BƯỚC 0 — rồi TRẢ LẠI ngay. PostgreSQL ghi người cấp là CHỦ HÀM (quyền đến qua kế thừa), nên thu hồi
-- membership không kéo theo quyền vừa cấp. Superuser thì không cần mượn.
DO $muon$
DECLARE
  da_muon boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
                  WHERE r.rolname OPERATOR(pg_catalog.=) current_user AND r.rolsuper) THEN
    EXECUTE pg_catalog.format('GRANT app_liet_ke_to_chuc TO %I WITH INHERIT TRUE, SET FALSE', current_user);
    da_muon := true;
  END IF;
  GRANT EXECUTE ON FUNCTION public.outbox_danh_sach_to_chuc() TO app_neo;
  IF da_muon THEN
    EXECUTE pg_catalog.format('REVOKE app_liet_ke_to_chuc FROM %I', current_user);
  END IF;
END
$muon$;
