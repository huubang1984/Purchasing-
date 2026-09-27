-- =============================================================================================
-- 9501 — [ADR-9202] VAI CỦA TASK KHỞI TẠO TỔ CHỨC: tạo tổ chức, người dùng, gán vai, ghi sổ — và KHÔNG GÌ KHÁC
-- =============================================================================================
-- Ngày đầu trên prod không có đường nào tạo tổ chức của khách, người dùng của họ hay vai của từng người
-- (`docs/DE-XUAT-TAO-TO-CHUC.md` mục 1): `app_api` cố ý không INSERT được `organizations` (002 — "một tổ
-- chức không tự đẻ ra tổ chức khác"), và không route nào gán vai. Chủ dự án chốt (2026-09-27): một task ECS
-- chạy một lần (`tools/khoi-tao-to-chuc`, task `tp-khoi-tao`) dưới một vai CSDL RIÊNG, quyền đúng việc —
-- cùng lý do dự án đã chọn cho `app_neo` (065): mỗi đường vận hành một vai, lỗi dừng ở ranh giới của vai.
--
--   * `app_khoi_tao` (NOLOGIN) và role đăng nhập `app_khoi_tao_login` (tools/chay-migrate dựng, mật khẩu từ
--     secret `tp/khoi-tao/database-url`). Role là đối tượng của CỤM nên `app_khoi_tao` được dựng ở
--     `hardening.always.sql` BƯỚC 0, cùng chỗ với ba vai kia; tệp này chỉ mang GRANT.
--   * Quyền = ĐÚNG những gì một lần tạo tổ chức chạm tới, liệt kê từng thứ dưới đây, và KHÔNG GÌ KHÁC: không
--     UPDATE hay DELETE ở đâu cả, không đọc bảng nghiệp vụ nào (giá thầu, RFQ, nhà cung cấp, khoá), không đọc
--     tên hay email của người dùng, không payload của sổ, không schema `app_private`, không hàm liệt kê tổ chức.
--
-- CÁCH LY TỔ CHỨC KHÔNG CẦN DÒNG NÀO Ở ĐÂY: policy cách ly của các bảng có RLS dưới đây không có `TO`, nên áp cho
-- PUBLIC — tức cho `app_khoi_tao` như cho mọi vai không phải chủ bảng; FORCE ROW LEVEL SECURITY đã bật và vai
-- này NOBYPASSRLS (hardening ghim). (Policy có `TO` duy nhất ở đây là `organizations_liet_ke_worker` của 052, chỉ
-- cho vai liệt kê tổ chức; `role_permissions` là danh mục chung, không RLS.) Một lần chạy chỉ chèn được hàng mang ĐÚNG tổ chức mà `withTenant` gắn: vế
-- WITH CHECK của `organizations` đòi `id = app_current_org_id()`, của ba bảng còn lại `org_id = …`. Đo ở
-- `db/vai-khoi-tao.int.test.ts`.
-- =============================================================================================

-- USAGE trên schema là điều kiện cần để phân giải `public.*`; tự nó không mở đối tượng nào. Hardening cấp
-- lại ở MỌI lượt (role DROP rồi dựng lại tự lành), dòng này để tệp đứng được một mình.
GRANT USAGE ON SCHEMA public TO app_khoi_tao;

-- Mọi policy RLS gọi hàm này, và `assertTenantBound` (packages/audit/src/tenant-guard.ts) gọi thẳng nó.
GRANT EXECUTE ON FUNCTION public.app_current_org_id() TO app_khoi_tao;

-- TỔ CHỨC. `id` ĐƯỢC cấp, khác mọi bảng khác của vai này: vế WITH CHECK của `organizations` (002) đòi
-- `id = app_current_org_id()`, nên hàng mới phải mang ĐÚNG UUID mà task vừa sinh và gắn — không có DEFAULT
-- nào thoả được điều ấy. `created_at` không cấp (DEFAULT của CSDL). Không SELECT: task không cần đọc lại.
GRANT INSERT (id, name, slug) ON organizations TO app_khoi_tao;

-- NGƯỜI DÙNG. `id` KHÔNG cấp — khuôn [vòng fix 2 — Minor] của 002: vai ghi được `id` dò được một UUID có tồn
-- tại ở tổ chức khác qua `users_pkey`. `DEFAULT gen_random_uuid()` sinh nó; task đọc lại bằng `RETURNING id`,
-- và RETURNING đòi SELECT trên ĐÚNG cột trả về — nên SELECT chỉ `(id)`: không email, không họ tên.
-- `status` không cấp (DEFAULT 'ACTIVE').
GRANT INSERT (org_id, email, full_name) ON users TO app_khoi_tao;
GRANT SELECT (id) ON users TO app_khoi_tao;

-- GÁN VAI. INSERT theo cột như `app_api` (005): `granted_at` là DEFAULT của CSDL. SELECT trên ba cột và trên
-- `role_permissions`: hai trigger chặn cặp vai trái luật — D3 `kiem_tra_phan_tach_nhiem_vu()` (005) và
-- `kiem_tra_nguong_khong_cung_tay_nguoi_dung()` (033) — là SECURITY INVOKER, đọc `user_roles` nối
-- `role_permissions` dưới quyền và RLS của NGƯỜI GHI. Thiếu SELECT thì mọi lần gán vai ném 42501.
GRANT INSERT (org_id, user_id, role_code) ON user_roles TO app_khoi_tao;
GRANT SELECT (org_id, user_id, role_code) ON user_roles TO app_khoi_tao;
GRANT SELECT (role_code, permission_code) ON role_permissions TO app_khoi_tao;

-- SỔ KIỂM TOÁN — ghi như `app_api`, qua `audit_append()` (004). INSERT theo đúng các cột 003 cấp cho hai vai
-- ứng dụng SAU lần thu hồi ba cột chuỗi của 004 (`seq`, `prev_hash`, `hash` do trigger nối chuỗi dẫn xuất).
-- SELECT chỉ những cột mà hai câu dưới quyền người ghi đọc: trigger `noi_chuoi_kiem_toan()` (SECURITY
-- INVOKER) đọc `org_id, seq, hash` của đầu chuỗi; `audit_append()` trả `id, seq, prev_hash, hash,
-- occurred_at` bằng RETURNING. Không `payload`, không `actor_id`: vai này không đọc được sổ.
GRANT INSERT (org_id, actor_type, actor_id, action, resource_type, resource_id,
              payload, request_id, ip, user_agent)
  ON audit_events TO app_khoi_tao;
GRANT SELECT (id, org_id, seq, prev_hash, hash, occurred_at) ON audit_events TO app_khoi_tao;
GRANT EXECUTE ON FUNCTION public.audit_append(uuid, text, uuid, text, text, uuid, jsonb, uuid, inet, text)
  TO app_khoi_tao;
GRANT EXECUTE ON FUNCTION public.audit_compute_hash(bytea, uuid, uuid, bigint, timestamptz,
                                                    text, uuid, text, text, uuid, jsonb, uuid,
                                                    inet, text)
  TO app_khoi_tao;
