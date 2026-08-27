import { describe, expect, it } from "vitest";
import { createPool } from "./pool.js";

describe("createPool — bắt buộc TLS trừ kết nối cục bộ", () => {
  it("kết nối loopback (127.0.0.1) không ép ssl — khớp cách Testcontainers kết nối", () => {
    const pool = createPool("postgres://user:pass@127.0.0.1:5432/db");
    expect(pool.options.ssl).toBeUndefined();
  });

  it("kết nối localhost không ép ssl", () => {
    const pool = createPool("postgres://user:pass@localhost:5432/db");
    expect(pool.options.ssl).toBeUndefined();
  });

  it("kết nối Unix domain socket (host là đường dẫn) không ép ssl", () => {
    const pool = createPool("host=/var/run/postgresql dbname=db user=u");
    expect(pool.options.ssl).toBeUndefined();
  });

  it("kết nối host từ xa bắt buộc ssl với rejectUnauthorized: true", () => {
    const pool = createPool("postgres://user:pass@db.example.com:5432/db");
    expect(pool.options.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("sslmode=disable bị cấm — ném lỗi thay vì âm thầm gửi rõ", () => {
    expect(() => createPool("postgres://user:pass@db.example.com:5432/db?sslmode=disable")).toThrow(
      /sslmode=disable/,
    );
  });

  it("sslmode=require bị cấm — không xác thực chứng chỉ nên là bẫy", () => {
    expect(() => createPool("postgres://user:pass@db.example.com:5432/db?sslmode=require")).toThrow(
      /sslmode=require/,
    );
  });
});
