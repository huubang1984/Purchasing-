import pg from "pg";

const CAC_HOST_LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/**
 * Tách host và tham số sslmode khỏi connection string, hỗ trợ cả dạng URI
 * (postgres://user:pass@host:port/db?sslmode=...) lẫn dạng key=value kiểu libpq
 * ("host=... dbname=... sslmode=...").
 */
function tachHostVaSslmode(connectionString: string): { host: string; sslmode: string | null } {
  try {
    const url = new URL(connectionString);
    return { host: url.hostname, sslmode: url.searchParams.get("sslmode") };
  } catch {
    const hostKhop = /(?:^|\s)host=([^\s]+)/.exec(connectionString);
    const sslmodeKhop = /(?:^|\s)sslmode=([^\s]+)/.exec(connectionString);
    return { host: hostKhop?.[1] ?? "", sslmode: sslmodeKhop?.[1] ?? null };
  }
}

/** Loopback (mọi kết nối localhost) hoặc Unix domain socket (host là đường dẫn file). */
function laKetNoiCucBo(host: string): boolean {
  return CAC_HOST_LOOPBACK.has(host) || host.startsWith("/");
}

/**
 * Tạo pool kết nối Postgres, bắt buộc TLS trừ khi đích là loopback/Unix socket cục bộ.
 *
 * node-postgres mặc định KHÔNG dùng SSL khi connection string thiếu sslmode — một chuỗi
 * kết nối production thiếu tham số (rất dễ xảy ra khi biến môi trường copy từ dev) sẽ khiến
 * toàn bộ lưu lượng DB đi rõ: ciphertext báo giá, token phiên, dữ liệu nhà cung cấp, và mật
 * khẩu DB ở bước xác thực. RLS lẫn tách role đều không cản được kẻ đứng giữa trên đường dây.
 */
export function createPool(connectionString: string, max = 10): pg.Pool {
  const { host, sslmode } = tachHostVaSslmode(connectionString);

  if (sslmode === "disable") {
    throw new Error(
      "createPool: sslmode=disable bị cấm — kết nối DB luôn phải mã hoá, trừ khi là " +
        "loopback/Unix socket cục bộ (không cần khai sslmode trong trường hợp đó).",
    );
  }
  if (sslmode === "require") {
    throw new Error(
      "createPool: sslmode=require bị cấm — nó chỉ mã hoá kênh, KHÔNG xác thực chứng chỉ " +
        "máy chủ, nên không chặn được kẻ đứng giữa chủ động. Dùng sslmode=verify-full, " +
        "hoặc bỏ hẳn tham số này cho kết nối loopback/Unix socket cục bộ.",
    );
  }

  // Không có tham số nào của createPool cho phép truyền ssl.rejectUnauthorized = false —
  // cấm tuyệt đối bằng cách không mở đường thoát đó ra API công khai.
  const ssl: pg.PoolConfig["ssl"] = laKetNoiCucBo(host) ? undefined : { rejectUnauthorized: true };

  return new pg.Pool({ connectionString, max, application_name: "trustprocure", ssl });
}
