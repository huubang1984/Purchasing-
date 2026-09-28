// ==============================================================================================
// tools/khoi-tao-to-chuc — MỘT GIAO DỊCH: tổ chức, người dùng, vai, sổ (ADR-111)
//
// Chạy dưới vai `app_khoi_tao` (075): INSERT theo cột trên `organizations`, `users`, `user_roles`, ghi sổ qua
// `audit_append()`, và SELECT đúng các cột mà RETURNING, hai trigger vai và trigger nối chuỗi đọc. Không gì khác — nên một
// lỗi của tệp này dừng ở ranh giới của vai, không ở ranh giới của vai master.
//
// HAI ĐIỀU ĐƯỢC GIỮ BẰNG CẤU TRÚC, không bằng kỷ luật:
//   ⑴ MỌI CÂU trong MỘT `withTenant`. Tạo tổ chức: sinh UUIDv4 trước, gắn CHÍNH nó, rồi chèn `organizations (id, …)` — vế
//      WITH CHECK `id = app_current_org_id()` của `002` nhận hàng ấy và không hàng nào khác. Thêm người: gắn tổ chức đã có;
//      tổ chức không tồn tại thì khoá ngoại của `users.org_id` từ chối. Lỗi nào cũng rollback TRỌN — không tổ chức nửa vời,
//      không người dùng thiếu vai, không hàng sổ kể một việc đã không xảy ra.
//   ⑵ SỔ TỪ HÀNG ĐẦU TIÊN, KHÔNG DỮ LIỆU CÁ NHÂN. `ORG_CREATED` (payload `{slug, nguon}`), `USER_CREATED` (payload `{nguon}` —
//      email và họ tên ở bảng `users`, không vào sổ chỉ-ghi-thêm nơi chúng không xoá được), `ROLE_GRANTED` (payload
//      `{roleCode, nguon}`); `actor_type = 'SYSTEM'`, `actor_id` NULL: người chạy task là vai deploy qua environment có người
//      duyệt (ADR-067), không phải một người dùng của tổ chức.
// Vai của một người đi trong MỘT câu INSERT — cho gọn, KHÔNG phải điều kiện: D3 (`005`) và `033` là trigger AFTER ROW đọc
// `user_roles` trong CÙNG giao dịch, nên chèn từng vai một câu thì câu sau vẫn thấy vai của câu trước và vẫn bị chặn (người
// soi đo: PM rồi DIRECTOR bằng hai câu ⇒ câu thứ hai 42501 "(D3)").
//
// Không in gì. Thông điệp lỗi nêu VỊ TRÍ trong bản khai và MÃ Postgres, không nêu email hay họ tên — `index.ts` in nó ra
// CloudWatch Logs.
// ==============================================================================================

import { randomUUID } from "node:crypto";
import type pg from "pg";
import { appendAuditEvent } from "@trustprocure/audit";
import { withTenant } from "@trustprocure/tenancy";
import type { BanKhai, NguoiKhai } from "./ban-khai.js";

export class KhoiTaoError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "KhoiTaoError";
  }
}

export interface KetQuaKhoiTao {
  readonly cheDo: BanKhai["cheDo"];
  readonly orgId: string;
  readonly soNguoi: number;
  readonly soVai: number;
}

const NGUON = "tp-khoi-tao";

function maLoi(loi: unknown): string | undefined {
  return typeof loi === "object" && loi !== null && "code" in loi && typeof loi.code === "string" ? loi.code : undefined;
}

function rangBuoc(loi: unknown): string | undefined {
  return typeof loi === "object" && loi !== null && "constraint" in loi && typeof loi.constraint === "string" ? loi.constraint : undefined;
}

/** Ghi một hàng sổ; lỗi của nó cũng đi qua `loiCua` — thông điệp nêu vị trí và SQLSTATE, không nêu giá trị. */
async function ghiSo(c: pg.PoolClient, orgId: string, noi: string, ev: Parameters<typeof appendAuditEvent>[2]): Promise<void> {
  try {
    await appendAuditEvent(c, orgId, ev);
  } catch (loi) {
    throw loiCua(loi, noi);
  }
}

/** Dịch lỗi của MỘT câu thành thông điệp nêu vị trí — không nêu giá trị nào của bản khai. */
function loiCua(loi: unknown, noi: string): KhoiTaoError {
  const ma = maLoi(loi);
  const rb = rangBuoc(loi);
  if (ma === "23505" && rb === "organizations_slug_key") return new KhoiTaoError(`${noi}: slug đã có tổ chức dùng`, { cause: loi });
  if (ma === "23505" && rb === "users_org_id_email_key") return new KhoiTaoError(`${noi}: email đã có trong tổ chức`, { cause: loi });
  if (ma === "23503" && rb === "users_org_id_fkey") return new KhoiTaoError(`${noi}: tổ chức không tồn tại`, { cause: loi });
  // D3 (`005`) và `033` ném 42501 với thông điệp của chính trigger — nêu mã, không nêu người.
  if (ma === "42501") return new KhoiTaoError(`${noi}: bị từ chối (mã 42501 — tổ hợp vai trái luật D3/033, hoặc vai CSDL thiếu quyền)`, { cause: loi });
  // [lượt soi] Khoá chuỗi sổ của tổ chức bị giữ quá trần (`050`: 2 s), hay hai lần chạy khoá chéo nhau: giao dịch đã
  // rollback trọn, chạy lại được.
  if (ma === "55P03" || ma === "40P01") return new KhoiTaoError(`${noi}: lỗi tạm (mã ${ma} — khoá của CSDL), giao dịch đã rollback, chạy lại được`, { cause: loi });
  return new KhoiTaoError(`${noi}: thất bại (mã ${ma ?? "?"}${rb === undefined ? "" : `, ràng buộc ${rb}`})`, { cause: loi });
}

async function chenNguoi(c: pg.PoolClient, orgId: string, n: NguoiKhai, i: number): Promise<number> {
  const noi = `người thứ ${String(i + 1)}`;
  let userId: string;
  try {
    // `pg_catalog.lower()` của CSDL, không `toLowerCase()` của JS: CHECK của `048` và đường đăng nhập (`login.ts`) cùng dùng
    // hàm của CSDL, nên email cất ở đây là đúng chuỗi mà lần xin link đầu tiên sẽ tra ra.
    const { rows } = await c.query<{ id: string }>(
      "INSERT INTO public.users (org_id, email, full_name) VALUES ($1, pg_catalog.lower($2::pg_catalog.text), $3) RETURNING id",
      [orgId, n.email, n.hoTen],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new KhoiTaoError(`${noi}: câu chèn người dùng không trả về hàng`);
    userId = id;
  } catch (loi) {
    if (loi instanceof KhoiTaoError) throw loi;
    throw loiCua(loi, noi);
  }
  await ghiSo(c, orgId, noi, { actorType: "SYSTEM", action: "USER_CREATED", resourceType: "USER", resourceId: userId, payload: { nguon: NGUON } });
  try {
    await c.query(
      "INSERT INTO public.user_roles (org_id, user_id, role_code) SELECT $1, $2, v FROM pg_catalog.unnest($3::pg_catalog.text[]) AS v",
      [orgId, userId, [...n.vai]],
    );
  } catch (loi) {
    throw loiCua(loi, noi);
  }
  for (const v of n.vai) {
    await ghiSo(c, orgId, noi, { actorType: "SYSTEM", action: "ROLE_GRANTED", resourceType: "USER", resourceId: userId, payload: { roleCode: v, nguon: NGUON } });
  }
  return n.vai.length;
}

/**
 * Chạy MỘT bản khai trong MỘT giao dịch. `pool` phải là pool của vai `app_khoi_tao` (`createPool(…, { role: "app_khoi_tao" })`).
 * Hàm KHÔNG tự kiểm vai: vai được ghim ở POOL — `SET ROLE` lúc kết nối, role đăng nhập không phải thành viên thì kết nối hỏng.
 * ~~dưới vai khác, câu đầu tiên ném 42501~~ **[lượt soi]** Dưới một vai RỘNG hơn thì không gì chặn: pool `app_api` (có INSERT
 * trên `users` và `user_roles`) chạy trọn chế độ `them-nguoi` — người soi đo.
 */
export async function khoiTao(pool: pg.Pool, bk: BanKhai, tuyChon: { readonly maToChuc?: string } = {}): Promise<KetQuaKhoiTao> {
  // [S1.9103] Chế độ `tao` nhận mã tổ chức do workflow chọn TRƯỚC lúc duyệt (`--ma-to-chuc`): người duyệt thấy nó, tóm tắt của run
  // in nó mà không cần đọc log, và COMMIT mất ACK không còn làm mất mã (ADR-111 Hệ quả). Không có thì sinh ở đây như trước.
  if (bk.cheDo === "them-nguoi" && tuyChon.maToChuc !== undefined) throw new Error("khoiTao: maToChuc chỉ dùng cho chế độ tao");
  const orgId = bk.cheDo === "tao" ? (tuyChon.maToChuc ?? randomUUID()) : bk.orgId;
  let soVai = 0;
  await withTenant(pool, orgId, async (c) => {
    if (bk.cheDo === "tao") {
      try {
        await c.query("INSERT INTO public.organizations (id, name, slug) VALUES ($1, $2, $3)", [orgId, bk.ten, bk.slug]);
      } catch (loi) {
        throw loiCua(loi, "tổ chức");
      }
      await ghiSo(c, orgId, "tổ chức", { actorType: "SYSTEM", action: "ORG_CREATED", resourceType: "ORGANIZATION", resourceId: orgId, payload: { slug: bk.slug, nguon: NGUON } });
    }
    for (const [i, n] of bk.nguoi.entries()) soVai += await chenNguoi(c, orgId, n, i);
  });
  return { cheDo: bk.cheDo, orgId, soNguoi: bk.nguoi.length, soVai };
}
