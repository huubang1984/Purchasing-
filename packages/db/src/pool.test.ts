import pg from "pg";
import { describe, expect, it } from "vitest";
import { createPool } from "./pool.js";

/**
 * Đọc cấu hình ssl/host HIỆU LỰC THẬT — không phải thứ ta truyền vào (pool.options), mà thứ
 * pg.Client tự tính lại qua ConnectionParameters nội bộ. Đây chính xác là chỗ pg từng ghi đè
 * option ssl của createPool khi còn truyền kèm connectionString — nếu test chỉ đọc
 * pool.options thì mù trước lỗi đó (đã tự kiểm chứng ở vòng review trước). connectionParameters
 * không nằm trong @types/pg (thuộc chi tiết cài đặt nội bộ), nên phải đọc qua ép kiểu
 * "unknown" tường minh, không dùng "any".
 */
function docCauHinhHieuLuc(pool: pg.Pool): { host: unknown; ssl: unknown } {
  const client = new pg.Client(pool.options);
  const noiBo = client as unknown as {
    connectionParameters: { host: unknown; ssl: unknown };
  };
  return { host: noiBo.connectionParameters.host, ssl: noiBo.connectionParameters.ssl };
}

describe("createPool — bắt buộc TLS hiệu lực thật, trừ kết nối cục bộ", () => {
  it("kết nối loopback (127.0.0.1) không ép ssl — khớp cách Testcontainers kết nối", () => {
    const pool = createPool("postgres://user:pass@127.0.0.1:5432/db");
    expect(docCauHinhHieuLuc(pool)).toEqual({ host: "127.0.0.1", ssl: false });
  });

  it("kết nối localhost không ép ssl", () => {
    const pool = createPool("postgres://user:pass@localhost:5432/db");
    expect(docCauHinhHieuLuc(pool)).toEqual({ host: "localhost", ssl: false });
  });

  it("kết nối host từ xa bắt buộc ssl hiệu lực thật với rejectUnauthorized: true", () => {
    const pool = createPool("postgres://user:pass@db.example.com:5432/db");
    expect(docCauHinhHieuLuc(pool)).toEqual({
      host: "db.example.com",
      ssl: { rejectUnauthorized: true },
    });
  });

  // [fix S6] Năm đường lách sau đây đã tự kiểm chứng thật bằng pg-connection-string@2.14.0 và
  // Postgres 16 thật ở vòng review trước — mỗi cái từng cho ra đúng cấu hình bị cấm tuyệt đối
  // (ssl tắt hẳn, hoặc rejectUnauthorized:false) khi createPool còn truyền connectionString
  // thẳng cho pg.Pool. Bản vá phải từ chối thẳng, không cố "sửa" giá trị.
  it.each([
    ["uselibpqcompat=true&sslmode=prefer — cho ra rejectUnauthorized:false", "uselibpqcompat=true&sslmode=prefer"],
    ["ssl=0 — tắt hẳn TLS không qua sslmode", "ssl=0"],
    ["sslmode=disable viết hoa — so sánh không được phân biệt hoa thường", "sslmode=DISABLE"],
    ["sslmode=prefer — ngữ nghĩa phụ thuộc phiên bản thư viện, không đáng tin", "sslmode=prefer"],
    ["sslmode=allow — vẫn cho phép rơi về không mã hoá", "sslmode=allow"],
    ["sslmode=verify-ca — không xác thực hostname", "sslmode=verify-ca"],
  ])("%s", (_mo_ta, querystring) => {
    expect(() => createPool(`postgres://u:p@db.example.com:5432/db?${querystring}`)).toThrow(
      /bị cấm/,
    );
  });

  it("[fix S6] host= trong query string ghi đè host thật trong URL (host smuggling) bị từ chối thẳng", () => {
    expect(() =>
      createPool("postgres://u:p@localhost:5432/db?host=db.example.com"),
    ).toThrow(/bị cấm/);
  });

  it("[fix S6] Unix socket qua host= vẫn được phép vì giá trị là đường dẫn tuyệt đối, không phải hostname giả dạng", () => {
    const pool = createPool("postgres:///db?host=/var/run/postgresql&user=u");
    expect(docCauHinhHieuLuc(pool)).toEqual({ host: "/var/run/postgresql", ssl: false });
  });

  it("connection string không phải dạng URI thì báo lỗi rõ ràng thay vì âm thầm dùng cấu hình sai", () => {
    expect(() => createPool("host=/var/run/postgresql dbname=db user=u")).toThrow(
      /phải là dạng URI/,
    );
  });
});

/**
 * [vòng fix 1 — IM7] Hai GUC giảm nhẹ đi qua `options`, tức PGOPTIONS trong gói khởi tạo kết
 * nối. Đọc HIỆU LỰC THẬT (qua ConnectionParameters của pg) chứ không đọc pool.options — cùng
 * lý do đã ghi ở docCauHinhHieuLuc.
 */
function docOptionsHieuLuc(pool: pg.Pool): unknown {
  const client = new pg.Client(pool.options);
  const noiBo = client as unknown as { connectionParameters: { options: unknown } };
  return noiBo.connectionParameters.options;
}

describe("createPool — hai GUC giảm nhẹ của khoá tư vấn (IM7)", () => {
  it("mặc định đặt lock_timeout và idle_in_transaction_session_timeout qua PGOPTIONS", () => {
    const pool = createPool("postgres://u:p@127.0.0.1:5432/db");
    expect(docOptionsHieuLuc(pool)).toBe(
      "-c lock_timeout=15000 -c idle_in_transaction_session_timeout=60000",
    );
  });

  it("người gọi ghi đè được, và 0 nghĩa là KHÔNG giới hạn", () => {
    const pool = createPool("postgres://u:p@127.0.0.1:5432/db", 5, {
      lockTimeoutMs: 0,
      idleInTransactionTimeoutMs: 1_000,
    });
    expect(docOptionsHieuLuc(pool)).toBe(
      "-c lock_timeout=0 -c idle_in_transaction_session_timeout=1000",
    );
  });

  // Chuỗi này đi thẳng vào PGOPTIONS nên nó không được nhận bất cứ thứ gì ngoài chữ số.
  it.each([
    ["số âm", -1],
    ["số thực", 1.5],
    ["NaN", Number.NaN],
  ])("từ chối %s thay vì nội suy vào PGOPTIONS", (_mo_ta, giaTri) => {
    expect(() =>
      createPool("postgres://u:p@127.0.0.1:5432/db", 5, { lockTimeoutMs: giaTri }),
    ).toThrow(/số nguyên không âm/);
  });
});
