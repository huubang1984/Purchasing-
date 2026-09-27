// ==============================================================================================
// tools/pilot-gia-lap — KẾT NỐI ĐẶC QUYỀN, VÀ NHỮNG VIỆC DUY NHẤT NÓ ĐƯỢC LÀM
//
// Cùng lý do với `tools/gieo-demo` (ADR-044) và `tools/chay-migrate` (ADR-066): có những việc KHÔNG
// có đường ứng dụng, theo thiết kế — `app_api` không có INSERT trên `organizations`, `users`,
// `user_roles`; không vai nào giữ `role.grant`; và vai đăng nhập của `api`/`worker` là việc của
// người vận hành. Nên tệp này dựng `pg.Pool` thẳng, khai ở `duong-sql-ngoai-with-tenant.test.ts`, và
// giới hạn nó vào đúng năm việc:
//   ⑴ `migrate()`;
//   ⑵ đảm bảo hai vai đăng nhập `app_api_login` / `app_unseal_login` (cùng câu lệnh `chay-migrate`);
//   ⑶ tạo tổ chức;
//   ⑷ tạo người dùng và gán MỘT vai;
//   ⑸ BA câu ĐỌC: tổng số hàng sổ kiểm toán của một tổ chức (trước và sau mỗi lần thử sai — cột "Vào
//      sổ"); số hàng sổ theo hành động (báo cáo, và lời khai `BID_DEADLINE_DENIED`); và CSDL đã có dấu
//      kiểm vòng khoá bọc chưa, trước khi sinh bí mật cụm mới.
// Mọi thứ khác của lượt chạy — chính sách, nhà cung cấp, gói thầu, lời mời, báo giá, mở thầu, chấm,
// trao thầu, bộ bằng chứng — đi qua HTTP của `apps/api`, tức qua cổng quyền, RLS và trigger thật.
//
// Mọi câu lệnh đi qua ĐÚNG MỘT chỗ gọi (`cau`), và mọi câu ghim đủ bốn trục QT3 ([INV-H21]).
// ==============================================================================================

import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "@trustprocure/db";
import type { VaiTro } from "./ho-so.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

export class CsdlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsdlError";
  }
}

/** Chỉ nhận máy chủ CSDL CỤC BỘ: công cụ này tạo vai đăng nhập và đặt lại mật khẩu của chúng. */
export function kiemUrlCucBo(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new CsdlError("TRUSTPROCURE_SEED_DATABASE_URL không phải một URI postgres:// hợp lệ");
  }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") throw new CsdlError("TRUSTPROCURE_SEED_DATABASE_URL phải là postgres://");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) {
    throw new CsdlError(
      "TRUSTPROCURE_SEED_DATABASE_URL phải trỏ vào máy CỤC BỘ (localhost/127.0.0.1/::1) — pilot giả lập đặt lại mật khẩu " +
        "hai vai đăng nhập và thêm tổ chức; nó không bao giờ được chạm một cụm dùng chung",
    );
  }
  // Một lần soi ở vòng này: `pg` (qua `pg-connection-string`) cho MỌI tham số truy vấn ghi đè phần tương
  // ứng của URL — `…@127.0.0.1/db?host=10.0.0.5` qua được phép kiểm tên máy ở trên rồi nối tới 10.0.0.5,
  // và `?user=…&password=…` còn thay cả vai mà `urlVaiDangNhap` đặt. Cụm cục bộ không cần tham số nào.
  if (u.search !== "") {
    throw new CsdlError(
      "TRUSTPROCURE_SEED_DATABASE_URL không được mang tham số truy vấn — `?host=`, `?port=`, `?user=`… của pg ghi đè máy chủ " +
        "và vai của URL, nên phép kiểm máy cục bộ sẽ thành vô nghĩa",
    );
  }
  if (u.pathname === "/" || u.pathname === "") throw new CsdlError("TRUSTPROCURE_SEED_DATABASE_URL thiếu tên CSDL");
  return u;
}

/**
 * URL của một vai đăng nhập ứng dụng trên cùng máy chủ, CỔNG và CSDL với URL đặc quyền. URL không ghi
 * cổng thì `pg` của kết nối đặc quyền lấy `PGPORT` rồi 5432; tiến trình con không nhận `PGPORT`
 * (`moiTruongSach` bỏ mọi `PG*`), nên URL của nó phải mang đúng cổng ấy — người kiểm chứng của lượt soi
 * đối kháng đo ra lần lệch này ở chính bản sửa bỏ `PG*`.
 */
export function urlVaiDangNhap(urlDacQuyen: string, ten: string, matKhau: string, pgPort: string | undefined = process.env.PGPORT): string {
  const u = kiemUrlCucBo(urlDacQuyen);
  u.username = ten;
  u.password = matKhau;
  if (u.port === "") u.port = pgPort?.trim() || "5432";
  return u.toString();
}

export interface DemHanhDong {
  readonly action: string;
  readonly n: number;
}

export class CsdlDacQuyen {
  private constructor(private readonly pool: pg.Pool) {}

  static mo(url: string): CsdlDacQuyen {
    kiemUrlCucBo(url);
    const pool = new pg.Pool({ connectionString: url, max: 2 });
    // Kết nối rảnh chết (Postgres khởi động lại) không được làm chết cả lượt chạy.
    pool.on("error", () => undefined);
    return new CsdlDacQuyen(pool);
  }

  private async cau<T extends pg.QueryResultRow>(sql: string, thamSo: readonly unknown[] = []): Promise<readonly T[]> {
    const { rows } = await this.pool.query<T>(sql, [...thamSo]);
    return rows;
  }

  /** ⑴ */
  async apMigration(): Promise<number> {
    return (await migrate(this.pool, MIGRATIONS_DIR)).length;
  }

  /**
   * ⑵ Tạo hoặc đặt lại mật khẩu một vai đăng nhập rồi cấp nhóm — cùng thuộc tính `chay-migrate` đặt,
   * nên `khangDinhPhienDangNhapUngDung` của tiến trình (không SUPERUSER/BYPASSRLS/CREATEROLE) qua được.
   * Không giao dịch tường minh: mỗi câu tự commit, và chạy lại cả hàm là vô hại.
   */
  async damBaoVaiDangNhap(ten: "app_api_login" | "app_unseal_login", matKhau: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{24,128}$/u.test(matKhau)) throw new CsdlError("mật khẩu vai đăng nhập phải là 24–128 ký tự base64url");
    const nhom = ten === "app_api_login" ? "app_api" : "app_unseal";
    const co = await this.cau<{ co: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname OPERATOR(pg_catalog.=) $1::pg_catalog.name) AS co",
      [ten],
    );
    const dong = co[0]?.co === true ? "ALTER" : "CREATE";
    await this.cau(
      `${dong} ROLE ${pg.escapeIdentifier(ten)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${pg.escapeLiteral(matKhau)}`,
    );
    await this.cau(`GRANT ${pg.escapeIdentifier(nhom)} TO ${pg.escapeIdentifier(ten)}`);
  }

  /** ⑶ */
  async taoToChuc(ten: string, slug: string): Promise<string> {
    const h = await this.cau<{ id: string }>("INSERT INTO public.organizations (name, slug) VALUES ($1, $2) RETURNING id", [ten, slug]);
    const id = h[0]?.id;
    if (id === undefined) throw new CsdlError("tạo tổ chức không trả về id");
    return id;
  }

  /** ⑷ */
  async taoNguoiDung(orgId: string, email: string, hoTen: string, vai: VaiTro): Promise<string> {
    const h = await this.cau<{ id: string }>(
      "INSERT INTO public.users (org_id, email, full_name) VALUES ($1, $2, $3) RETURNING id",
      [orgId, email, hoTen],
    );
    const id = h[0]?.id;
    if (id === undefined) throw new CsdlError("tạo người dùng không trả về id");
    await this.cau("INSERT INTO public.user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [orgId, id, vai]);
    return id;
  }

  /**
   * ⑸' Chỉ đọc: CSDL này đã có dấu kiểm vòng khoá bọc chưa (`062`, khoản 165). Có rồi mà thư mục
   * trạng thái lại MỚI thì vòng khoá sắp sinh sẽ lệch dấu đã ghi, và `api` từ chối khởi động — bộ giả
   * lập hỏi TRƯỚC để nói ra cách sửa thay vì để `api` chết giữa chừng.
   */
  async coDauKiemVongKhoa(): Promise<boolean> {
    const h = await this.cau<{ n: string }>("SELECT pg_catalog.count(*) AS n FROM public.master_key_check_values");
    return Number(h[0]?.n ?? "0") > 0;
  }

  /** ⑸ Chỉ đọc: tổng số hàng sổ kiểm toán của một tổ chức — đo xem một lần từ chối có vào sổ không. */
  async demTongSoKiemToan(orgId: string): Promise<number> {
    const h = await this.cau<{ n: string }>(
      "SELECT pg_catalog.count(*) AS n FROM public.audit_events e WHERE e.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid",
      [orgId],
    );
    return Number(h[0]?.n ?? "0");
  }

  /** ⑸ Chỉ đọc; số đếm theo hành động, không một cột payload nào. */
  async demSoKiemToan(orgId: string): Promise<readonly DemHanhDong[]> {
    const h = await this.cau<{ action: string; n: string }>(
      "SELECT e.action, pg_catalog.count(*) AS n FROM public.audit_events e " +
        "WHERE e.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid GROUP BY e.action ORDER BY e.action",
      [orgId],
    );
    return h.map((r) => ({ action: r.action, n: Number(r.n) }));
  }

  async dong(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }
}
