// ==============================================================================================
// [S1.11] GẮN MỘT VAI ỨNG DỤNG VÀO MỌI CLIENT CỦA MỘT POOL — MỘT BẢN, DÙNG CHUNG
//
// Cơ chế này ra đời ở `packages/test-support` (`poolAs`, [fix C1 + I3]) và sống ở đó suốt từ S0:
// mọi phép đo dưới `app_api` đều chạy qua nó. Khi composition root của `apps/api` cần ĐÚNG cơ
// chế ấy cho tiến trình thật, có hai cách lấy — chép lại, hoặc dùng chung — và dự án đã có tên
// cho cách thứ nhất: *hai bản chép của một hàng rào là một bản sẽ trôi* (`crypto-keys/moi-truong.ts`).
// Nên nó chuyển về đây, `test-support` gọi lại, và bản chép không tồn tại.
//
// VÌ SAO PHẢI GẮN Ở MỖI LẦN LẤY CLIENT, KHÔNG PHẢI MỖI LẦN MỞ KẾT NỐI: `pg-pool` chỉ chạy
// `connect` event khi mở kết nối VẬT LÝ mới (đã đọc source pg-pool@3.14.0: `_afterConnect` chỉ
// gọi khi `isNew`), không chạy lại khi tái dùng một client rảnh. Một `RESET ROLE` / `DISCARD ALL`
// bất kỳ trên client ấy sẽ đầu độc nó VĨNH VIỄN — lần lấy sau âm thầm chạy dưới quyền của role
// đăng nhập. Với test-support đó là superuser (mọi khẳng định "RLS chặn thật" xanh giả); với sản
// xuất đó là `app_api_login` — role INHERIT có TOÀN BỘ quyền của app_api nhưng `current_user`
// KHÁC tên, tức đúng khe mà migration `037` đóng ở tầng CSDL. Hai tầng, hai lý do.
//
// VÌ SAO KIỂM `current_user` SAU `SET ROLE` thay vì tin câu lệnh: `SET ROLE` tới một role không
// phải thành viên NÉM (42501), nhưng "ném" là hành vi của Postgres, không phải hợp đồng của
// file này. Hợp đồng là: client được giao ra ĐANG là vai ấy — đo bằng cách hỏi lại.
// ==============================================================================================

import type pg from "pg";

/**
 * Danh sách ĐÓNG các vai ứng dụng gắn được. Không nội suy chuỗi tuỳ ý vào `SET ROLE`: một tên
 * ngoài danh sách bị chặn ở lời gọi, trước khi chạm Postgres. Hai tên này là hai role NOLOGIN mà
 * 001 dựng và hardening canh; role ĐĂNG NHẬP (`app_api_login`) không bao giờ là đích của SET ROLE.
 */
export const VAI_UNG_DUNG = ["app_api", "app_unseal"] as const;
export type VaiUngDung = (typeof VAI_UNG_DUNG)[number];

export function laVaiUngDung(giaTri: string): giaTri is VaiUngDung {
  return (VAI_UNG_DUNG as readonly string[]).includes(giaTri);
}

/**
 * Tái khẳng định vai trên MỘT client cụ thể ngay trước khi giao cho người gọi, và ném lỗi rõ
 * ràng nếu SET ROLE không có hiệu lực thật.
 */
async function ganVaiChoClient(client: pg.PoolClient, vai: VaiUngDung): Promise<void> {
  // [S1.34 / khoản nợ 78] `DISCARD TEMP` cùng câu với SET ROLE, không thêm vòng đi-về nào. Hardening
  // thu hồi TEMP trên database khỏi mọi vai ứng dụng, nhưng một bảng tạm tạo TRƯỚC lần deploy mang lớp
  // ấy sống hết đời kết nối pool và vẫn che tên (đo trên PostgreSQL 16: sau REVOKE, cùng kết nối,
  // `sessions` trần vẫn đếm 0). Xoá nó ở MỖI lần giao client đóng cửa sổ ấy. Không phải DISCARD ALL:
  // DISCARD ALL đụng cả vai và cấu hình phiên.
  await client.query(`SET ROLE ${vai}; DISCARD TEMP`);
  // Postgres tự hạ thường định danh không có dấu ngoặc kép, nên alias phải viết sẵn chữ thường —
  // viết hoa ở đây sẽ đọc ra "undefined" một cách âm thầm.
  const { rows } = await client.query<{ current_role_name: string }>(
    "SELECT current_user AS current_role_name",
  );
  if (rows[0]?.current_role_name !== vai) {
    throw new Error(
      `ganVaiTroChoPool("${vai}"): SET ROLE không có hiệu lực — current_user vẫn là ` +
        `"${rows[0]?.current_role_name}". Không giao client này cho bất kỳ ai dùng.`,
    );
  }
}

/**
 * [S1.11 / review H3-1] Khẳng định PHIÊN đăng nhập (`session_user`) của một client là một role ứng
 * dụng an toàn — đo theo THUỘC TÍNH, không theo tên.
 *
 * `SET ROLE` không phải một phép giảm quyền không đảo ngược: superuser `SET ROLE` sang bất kỳ role
 * nào, và một `RESET ROLE` (bug, hay SQL injection ở một handler) trả kết nối về đúng phiên đăng
 * nhập. Nên `current_user = app_api` sau SET ROLE chứng minh ĐANG là app_api, không chứng minh
 * phiên ấy KHÔNG MẠNH HƠN app_api. Bốn thứ bị từ chối: SUPERUSER, BYPASSRLS, CREATEROLE, và thành
 * viên của một vai ứng dụng KHÁC (`app_api_login` mà lỡ được GRANT `app_unseal` — hardening chỉ gỡ
 * lúc `migrate()`, còn tiến trình thì khởi động giữa hai lần deploy). Gọi ở composition root lúc
 * khởi động, TRƯỚC khi mở cổng; KHÔNG gọi trong `ganVaiTroChoPool`, vì `poolAs` của test-support cố
 * ý đăng nhập bằng superuser rồi SET ROLE.
 */
export async function khangDinhPhienDangNhapUngDung(client: pg.PoolClient, vai: VaiUngDung): Promise<void> {
  const vaiKhac = VAI_UNG_DUNG.filter((v) => v !== vai);
  const { rows } = await client.query<{
    phien: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreaterole: boolean;
    vai_khac: boolean;
  }>(
    `SELECT session_user AS phien, r.rolsuper, r.rolbypassrls, r.rolcreaterole,
            EXISTS (SELECT 1 FROM pg_catalog.unnest($1::pg_catalog.name[]) AS k(ten)
                     WHERE pg_catalog.pg_has_role(session_user, k.ten, 'MEMBER')) AS vai_khac
       FROM pg_catalog.pg_roles r WHERE r.rolname OPERATOR(pg_catalog.=) session_user`,
    [vaiKhac],
  );
  const h = rows[0];
  if (h === undefined) throw new Error("khangDinhPhienDangNhapUngDung: không đọc được session_user.");
  const loi = [
    h.rolsuper ? "SUPERUSER" : null,
    h.rolbypassrls ? "BYPASSRLS" : null,
    h.rolcreaterole ? "CREATEROLE" : null,
    h.vai_khac ? `thành viên của ${vaiKhac.join("/")}` : null,
  ].filter((x): x is string => x !== null);
  if (loi.length > 0) {
    throw new Error(
      `Phiên đăng nhập "${h.phien}" mạnh hơn vai "${vai}": ${loi.join(", ")}. SET ROLE không giấu được ` +
        "điều đó (một RESET ROLE trả lại toàn quyền). Đăng nhập bằng đúng role thành viên của vai ấy.",
    );
  }
}

/**
 * Bọc `pool.connect()` để MỌI lần lấy client — kết nối mới hay client rảnh được tái dùng — đều
 * `SET ROLE <vai>` rồi kiểm `current_user` trước khi giao ra. Trả về chính `pool` đã bọc.
 *
 * `pool.query()` gọi `connect()` nội bộ ở dạng CALLBACK (đã đọc source pg-pool:
 * `query(text, values, cb) { ... this.connect((err, client) => {...}) }`), nên bản bọc phải hỗ
 * trợ cả hai kiểu gọi — chặn thẳng kiểu callback làm chính `pool.query()` vỡ (đã tự vấp ở S0).
 */
export function ganVaiTroChoPool(pool: pg.Pool, vai: VaiUngDung): pg.Pool {
  if (!laVaiUngDung(vai)) {
    throw new Error(
      `ganVaiTroChoPool: vai không hợp lệ "${String(vai)}" — chỉ chấp nhận ${VAI_UNG_DUNG.join(" hoặc ")}.`,
    );
  }
  const vaiDaXacThuc: VaiUngDung = vai;
  const connectGoc = pool.connect.bind(pool);

  function layVaGanVai(): Promise<pg.PoolClient> {
    return connectGoc().then(async (client) => {
      try {
        await ganVaiChoClient(client, vaiDaXacThuc);
      } catch (loi) {
        client.release(loi as Error);
        throw loi;
      }
      return client;
    });
  }

  pool.connect = ((
    goiLai?: (
      loi: Error | undefined,
      client: pg.PoolClient | undefined,
      xongViec: (giaiPhong?: Error | boolean) => void,
    ) => void,
  ) => {
    if (!goiLai) return layVaGanVai();
    layVaGanVai().then(
      (client) => goiLai(undefined, client, client.release.bind(client)),
      (loi: Error) => goiLai(loi, undefined, () => {}),
    );
    return undefined;
  }) as typeof pool.connect;

  return pool;
}
