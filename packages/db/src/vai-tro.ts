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
 * [S1.59 / khoản nợ 99] Tiền tố của lỗi khi client lấy từ pool có vai không sạch — xuất ra để test ghim MỘT bản, cùng lý do với
 * `TU_CHOI_GUC_SOM` của migrate.ts.
 */
export const TU_CHOI_KET_NOI_NHIEM =
  "ganVaiTroChoPool: kết nối lấy từ pool không sạch — kết nối bị huỷ, không giao cho người gọi";

/**
 * [S1.59 / khoản nợ 99, lượt soi 52 NHẸ-2] Lỗi của lần lấy client gặp kết nối không sạch. Mang TÊN riêng vì ~~mọi chỗ ghi log của tiến
 * trình (`dispatch`, runner outbox, bộ dọn) chỉ ghi `name` của lỗi~~ [S1.66 / lượt soi ngang 59b-1, lượt soi 60a-7] chỗ ghi log của
 * `dispatch` chỉ ghi `name` của lỗi (cộng mã cố định của `TenantError`) — đường khách của nó từng gói lỗi này thành một 401 không log,
 * sửa ở S1.66; runner outbox chỉ in `kind`/`reason`, không in tên lỗi — khoản 118 — nên một `Error` trần thì kết nối nhiễm không phân biệt được với mọi lỗi
 * lập trình khác. Không thử lại: kết nối nhiễm đã bị huỷ, và một lần thử lại im lặng xoá đúng tín hiệu mà lớp này tồn tại để phát ra.
 */
export class KetNoiNhiemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KetNoiNhiemError";
  }
}

/**
 * [S1.59 / khoản nợ 99] Mốc search path HIỆU LỰC của từng kết nối vật lý, đọc ở lần lấy ĐẦU TIÊN. pg-pool giao lại CÙNG đối tượng
 * client cho cùng một kết nối vật lý (`release` gắn lên chính nó), nên WeakMap theo client là mốc theo kết nối — và tự dọn khi kết nối
 * bị huỷ.
 */
const mocLuocDo = new WeakMap<pg.PoolClient, string>();

/**
 * Tái khẳng định vai trên MỘT client cụ thể ngay trước khi giao cho người gọi, và ném lỗi rõ
 * ràng nếu SET ROLE không có hiệu lực thật.
 *
 * [S1.59 / khoản nợ 99] VÀ TỪ CHỐI KẾT NỐI KHÔNG SẠCH. `withTenant` đọc lại ba GUC vận hành sau giao dịch của nó (khoản 96 ⑵); mã chạy
 * câu trên pool NGOÀI hàm ấy — hai bộ dọn nền, phép kiểm vai của auditPool, phép kiểm lúc khởi động; census ở
 * `tests/architecture/duong-sql-ngoai-with-tenant.test.ts` — thì không, và kết nối nó để nhiễm quay về pool rồi giao cho người kế tiếp:
 * dưới `replica` trigger ENABLE thường và khoá ngoại bị bỏ qua (đo S1.54), dưới `row_security = off` câu chạm bảng RLS ném thay vì lọc,
 * dưới một search path lạ tên trần phân giải sang schema khác, và trong một giao dịch còn mở thì `SET ROLE` của lần lấy này chạy bên
 * trong giao dịch của người trước. Đây là chỗ MỌI đường của pool có vai đi qua:
 *   - trạng thái giao dịch đọc từ client (`getTransactionStatus`, không vòng đi-về), TRƯỚC `SET ROLE`, phải là rảnh (lượt soi 52 INFO-2);
 *   - ba GUC đọc trong CÙNG câu với `current_user`, không thêm vòng đi-về. `session_replication_role` và `row_security` xét theo TÍNH
 *     CHẤT (origin hay local; on) — cùng quy tắc withTenant ⑵ — kể cả ở lần lấy đầu, khi giá trị xấu chỉ có thể đến từ MẶC ĐỊNH PHIÊN,
 *     và thông báo nói đúng nguồn ấy (lượt soi 52 NHẸ-1);
 *   - search path HIỆU LỰC (`current_schemas(false)`) so với mốc đọc ở lần lấy ĐẦU TIÊN của chính kết nối — tương đối, nên mặc định phiên
 *     hợp lệ khác mặc định máy chủ vẫn qua (test ghim). [S1.66 / lượt soi ngang 59a-4] Phần CẤM thì bất biến mà chưa kiểm tuyệt đối —
 *     không schema nào ngoài `"$user"`/`pg_catalog` đứng trước `public`, `pg_catalog` không đứng sau `public` — nên mặc định vai
 *     `public, pg_catalog` đặt giữa hai lần deploy đi qua lớp này (đo) — khoản 109. Đọc qua hàm chứ không qua tên GUC vì [INV-H21] chỉ cho `migrate.ts` nêu tên ấy
 *     trong SQL — bản đầu đọc tên GUC và làm cổng ấy đỏ (lượt soi 52 NẶNG-1, đo) — và đây cũng là cách đọc của withTenant ⑵.
 * Lệch ⇒ NÉM `KetNoiNhiemError`, và `ganVaiTroChoPool` huỷ kết nối (`release(loi)`) — người gọi không bao giờ nhận nó; kết nối mới mở
 * thay, nên sửa xong mặc định phiên thì pool tự lành. Chỉ TÊN GUC vào thông báo.
 * RANH GIỚI, nói ra: lỗi rơi vào lần lấy KẾ TIẾP của kết nối ấy — có thể là một yêu cầu khác, không phải mã đã làm nhiễm; DDL đổi search
 * path hiệu lực của MỌI kết nối như nhau thì mỗi kết nối pool bị huỷ một lần, mỗi lần một lời gọi ném (test ghim), rồi kết nối mới lấy
 * mốc mới — cấu hình máy chủ nạp lại cũng vậy (suy luận, lượt soi 52 NHẸ-1, chưa đo), kể cả khi giá trị mới là giá trị xấu, vì mốc là
 * tương đối ~~(nguồn cấu hình do hardening khoản 92 canh lúc deploy)~~ [S1.66 / lượt soi ngang 59a-2, 59a-4: hardening canh nguồn mức
 * database và catalog, KHÔNG canh hàng che mức vai hay mặc định vai đặt giữa hai lần deploy — đo, khoản 109]; một câu TỰ commit (`pool.query` ghi) chạy trọn trước khi lớp này thấy
 * gì — lớp chặn commit của mã ngoài withTenant là giao dịch tường minh kết thúc bằng khối DO của khoản 96 (⑴), census vế ⒝; GUC phiên
 * khác ba GUC này và trạng thái phiên ngoài GUC không được đọc ở đây.
 */
async function ganVaiChoClient(client: pg.PoolClient, vai: VaiUngDung): Promise<void> {
  const trangThaiGiaoDich = client.getTransactionStatus();
  if (trangThaiGiaoDich !== "I") {
    throw new KetNoiNhiemError(
      `${TU_CHOI_KET_NOI_NHIEM} — kết nối trả về pool khi đang mở giao dịch (trạng thái ${String(trangThaiGiaoDich)}): SET ROLE ` +
        "của lần lấy này sẽ chạy bên trong giao dịch của người trước, và COMMIT kế tiếp commit cả việc dở của họ.",
    );
  }
  // [S1.34 / khoản nợ 78] `DISCARD TEMP` cùng câu với SET ROLE, không thêm vòng đi-về nào. Hardening
  // thu hồi TEMP trên database khỏi mọi vai ứng dụng, nhưng một bảng tạm tạo TRƯỚC lần deploy mang lớp
  // ấy sống hết đời kết nối pool và vẫn che tên (đo trên PostgreSQL 16: sau REVOKE, cùng kết nối,
  // `sessions` trần vẫn đếm 0). Xoá nó ở MỖI lần giao client đóng cửa sổ ấy. Không phải DISCARD ALL:
  // DISCARD ALL đụng cả vai và cấu hình phiên.
  await client.query(`SET ROLE ${vai}; DISCARD TEMP`);
  // Postgres tự hạ thường định danh không có dấu ngoặc kép, nên alias phải viết sẵn chữ thường —
  // viết hoa ở đây sẽ đọc ra "undefined" một cách âm thầm.
  const { rows } = await client.query<{
    current_role_name: string;
    vai_sao_chep: string;
    rls: string;
    luoc_do: string;
  }>(
    "SELECT current_user AS current_role_name, " +
      "pg_catalog.current_setting('session_replication_role') AS vai_sao_chep, " +
      "pg_catalog.current_setting('row_security') AS rls, " +
      "pg_catalog.current_schemas(false)::pg_catalog.text AS luoc_do",
  );
  const hang = rows[0];
  if (hang === undefined || hang.current_role_name !== vai) {
    throw new Error(
      `ganVaiTroChoPool("${vai}"): SET ROLE không có hiệu lực — current_user vẫn là ` +
        `"${hang?.current_role_name}". Không giao client này cho bất kỳ ai dùng.`,
    );
  }
  const moc = mocLuocDo.get(client);
  if (moc === undefined) mocLuocDo.set(client, hang.luoc_do);
  const lech = [
    hang.vai_sao_chep !== "origin" && hang.vai_sao_chep !== "local" ? "session_replication_role" : null,
    hang.rls !== "on" ? "row_security" : null,
    moc !== undefined && hang.luoc_do !== moc ? "search path hiệu lực" : null,
  ].filter((x): x is string => x !== null);
  if (lech.length > 0) {
    throw new KetNoiNhiemError(
      `${TU_CHOI_KET_NOI_NHIEM} — ${lech.join(", ")}. session_replication_role phải là origin hay local, row_security phải là on` +
        (moc === undefined
          ? ". Đây là lần lấy ĐẦU TIÊN của kết nối — chưa câu nào chạy trên nó — nên giá trị đến từ MẶC ĐỊNH PHIÊN (ALTER ROLE … SET, " +
            "ALTER DATABASE … SET, cấu hình máy chủ), không phải từ mã."
          : ", search path hiệu lực phải bằng lần lấy đầu tiên của chính kết nối này. Nguồn thường gặp: mã chạy trên pool NGOÀI " +
            "withTenant đã đổi chúng ở phạm vi phiên rồi trả kết nối về pool (khoản nợ 99); DDL hay cấu hình máy chủ nạp lại đổi search " +
            "path hiệu lực cũng làm mỗi kết nối pool bị huỷ một lần."),
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
 * `SET ROLE <vai>` rồi kiểm `current_user` — và [S1.59 / khoản nợ 99] ba GUC vận hành, xem `ganVaiChoClient` — trước khi giao ra.
 * Trả về chính `pool` đã bọc.
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
      // [S1.66 / lượt soi 60a-3] Client mượn khỏi pool không còn listener 'error' nào (pg-pool gỡ listener rảnh), người gọi chỉ gắn
      // listener của mình SAU lần lấy này, và `pg` phát 'error' khi kết nối kết thúc ngoài ý muốn — kể cả lúc không câu nào đang chạy.
      // Hai vòng đi-về của `ganVaiChoClient` là cửa sổ ấy: không ai nghe thì tiến trình chết (đo: `vai-ngat-ket-noi.int.test.ts`). Gắn
      // trong lúc gán vai, gỡ trước khi giao client hay huỷ nó — lỗi thật vẫn đi ra qua promise của câu lệnh.
      const boQuaLoiKetNoi = (): void => {};
      client.on("error", boQuaLoiKetNoi);
      try {
        await ganVaiChoClient(client, vaiDaXacThuc);
      } catch (loi) {
        client.off("error", boQuaLoiKetNoi);
        client.release(loi as Error);
        throw loi;
      }
      client.off("error", boQuaLoiKetNoi);
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
