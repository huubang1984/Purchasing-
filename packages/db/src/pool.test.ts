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
