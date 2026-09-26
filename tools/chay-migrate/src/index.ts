// ==============================================================================================
// tools/chay-migrate — TASK ECS `tp-migrate` (ADR-066)
//
// Hai việc, theo thứ tự, trên MỘT pool của vai chủ CSDL (tài khoản master của RDS):
//   ① `migrate()` — mọi migration đánh số cộng lớp cưỡng chế `hardening.always.sql`.
//   ② Đảm bảo hai vai ĐĂNG NHẬP mà migration cố ý KHÔNG tạo (chúng mang mật khẩu):
//        app_api_login    LOGIN, thành viên app_api
//        app_unseal_login LOGIN, thành viên app_unseal
//      Mật khẩu lấy từ CHÍNH URL mà hai tiến trình dùng (`TRUSTPROCURE_API_DATABASE_URL`,
//      `TRUSTPROCURE_WORKER_DATABASE_URL`, cùng secret Secrets Manager): một nguồn sự thật — đổi mật
//      khẩu là đổi secret rồi chạy lại task này, không có bản chép thứ hai để trôi.
//
// Vì sao ② ở đây chứ không phải một lệnh psql tay: CSDL nằm trong subnet riêng, không đường vào từ
// ngoài VPC; task này là đường DUY NHẤT tới nó lúc deploy.
//
// Không in giá trị nào của mật khẩu hay URL — chỉ tên vai và số migration đã áp.
// ==============================================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "@trustprocure/db";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

export class ChayMigrateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChayMigrateError";
  }
}

type MoiTruong = Readonly<Record<string, string | undefined>>;

function bat(env: MoiTruong, ten: string): string {
  const v = env[ten]?.trim();
  if (v === undefined || v === "") throw new ChayMigrateError(`thiếu biến môi trường ${ten}`);
  return v;
}

function docCa(duong: string): string {
  try {
    return readFileSync(duong, "utf8");
  } catch {
    throw new ChayMigrateError("TRUSTPROCURE_MIGRATE_DB_CA_FILE: không đọc được bó CA");
  }
}

export interface VaiDangNhap {
  readonly ten: string;
  readonly nhom: string;
  readonly matKhau: string;
}

/** Tách vai đăng nhập từ URL của một tiến trình; tên vai phải là đúng tên hardening chấp nhận. */
export function docVaiTuUrl(bien: string, url: string, tenMongDoi: string, nhom: string): VaiDangNhap {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ChayMigrateError(`${bien} không phải một URI postgres:// hợp lệ`);
  }
  if (u.username !== tenMongDoi) throw new ChayMigrateError(`${bien} phải đăng nhập bằng vai "${tenMongDoi}"`);
  const matKhau = decodeURIComponent(u.password);
  if (matKhau.length < 24) throw new ChayMigrateError(`${bien}: mật khẩu phải dài ít nhất 24 ký tự`);
  return { ten: tenMongDoi, nhom, matKhau };
}

export interface CauHinhChayMigrate {
  readonly chuSoHuu: pg.PoolConfig;
  readonly vai: readonly VaiDangNhap[];
}

export function docCauHinh(env: MoiTruong): CauHinhChayMigrate {
  const cong = Number(env["TRUSTPROCURE_MIGRATE_DB_PORT"]?.trim() || "5432");
  if (!Number.isInteger(cong) || cong < 1 || cong > 65535) throw new ChayMigrateError("TRUSTPROCURE_MIGRATE_DB_PORT không hợp lệ");
  return {
    chuSoHuu: {
      host: bat(env, "TRUSTPROCURE_MIGRATE_DB_HOST"),
      port: cong,
      database: bat(env, "TRUSTPROCURE_MIGRATE_DB_NAME"),
      user: bat(env, "TRUSTPROCURE_MIGRATE_DB_USER"),
      password: bat(env, "TRUSTPROCURE_MIGRATE_DB_PASSWORD"),
      // RDS bật rds.force_ssl; chứng chỉ của RDS ký bởi CA của AWS. Bó CA đi kèm image (Dockerfile tải
      // `global-bundle.pem`); thiếu tệp thì NÉM — không hạ xuống kết nối không kiểm chứng chỉ.
      ssl: { ca: docCa(bat(env, "TRUSTPROCURE_MIGRATE_DB_CA_FILE")), rejectUnauthorized: true },
      max: 2,
    },
    vai: [
      docVaiTuUrl("TRUSTPROCURE_API_DATABASE_URL", bat(env, "TRUSTPROCURE_API_DATABASE_URL"), "app_api_login", "app_api"),
      docVaiTuUrl("TRUSTPROCURE_WORKER_DATABASE_URL", bat(env, "TRUSTPROCURE_WORKER_DATABASE_URL"), "app_unseal_login", "app_unseal"),
    ],
  };
}

/** Tạo hoặc đặt lại mật khẩu cho một vai đăng nhập, rồi cấp nhóm. Một giao dịch mỗi vai. */
export async function damBaoVaiDangNhap(client: pg.ClientBase, vai: VaiDangNhap): Promise<"tao" | "cap-nhat"> {
  const ten = client.escapeIdentifier(vai.ten);
  const nhom = client.escapeIdentifier(vai.nhom);
  const mk = client.escapeLiteral(vai.matKhau);
  await client.query("BEGIN");
  try {
    const { rows } = await client.query<{ co: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname OPERATOR(pg_catalog.=) $1::pg_catalog.name) AS co", [vai.ten]);
    const co = rows[0]?.co === true;
    await client.query(`${co ? "ALTER" : "CREATE"} ROLE ${ten} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${mk}`);
    await client.query(`GRANT ${nhom} TO ${ten}`);
    await client.query("COMMIT");
    return co ? "cap-nhat" : "tao";
  } catch (loi) {
    await client.query("ROLLBACK").catch(() => undefined);
    // Thông điệp gốc của Postgres có thể trích câu lệnh — mà câu lệnh mang mật khẩu. Chỉ giữ mã.
    const ma = typeof loi === "object" && loi !== null && "code" in loi ? String(loi.code) : "?";
    throw new ChayMigrateError(`đảm bảo vai ${vai.ten} thất bại (mã ${ma})`);
  }
}

export async function chay(env: MoiTruong): Promise<void> {
  const ch = docCauHinh(env);
  const pool = new pg.Pool(ch.chuSoHuu);
  pool.on("error", () => undefined);
  try {
    const daAp = await migrate(pool, MIGRATIONS_DIR);
    console.log(`[chay-migrate] da ap ${String(daAp.length)} migration`);
    const c = await pool.connect();
    c.on("error", () => undefined);
    try {
      for (const v of ch.vai) console.log(`[chay-migrate] vai ${v.ten}: ${await damBaoVaiDangNhap(c, v)}`);
    } finally {
      c.release();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  chay(process.env).catch((loi: unknown) => {
    console.error(`[chay-migrate] ${loi instanceof Error ? `${loi.name}: ${loi instanceof ChayMigrateError ? loi.message : "(an thong diep)"}` : "loi"}`);
    process.exitCode = 1;
  });
}
