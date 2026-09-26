// [ADR-086] Canh mốc neo theo từng tổ chức — logic đo trên một bucket giả, và tệp Lambda trùng byte với nguồn gỡ kiểu.
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import type { ListObjectsV2Command, ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { coMocNeoMoi, docNguongGio, dongLog, kiemMocNeo, lietKeToChucDaNeo, type S3ChiDoc } from "./canh-moc-neo.js";

const BUCKET = "tp-neo-test";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const GIO = 3_600_000;
const BAY_GIO = Date.UTC(2026, 8, 26, 12, 0, 0);

interface DoiTuong {
  readonly key: string;
  readonly lastModified: number;
}

const khoa = (org: string, ms: number): string => `so-kiem-toan/${org}/${String(ms).padStart(15, "0")}-abcdef0123456789.json`;

/** Bucket giả theo đúng ngữ nghĩa ListObjectsV2 cần dùng: Prefix, Delimiter, StartAfter, phân trang cỡ `trang`. */
function bucketGia(ds: readonly DoiTuong[], trang = 1000): S3ChiDoc & { soLoiGoi: number } {
  const sapXep = [...ds].sort((x, y) => (x.key < y.key ? -1 : 1));
  const gia = {
    soLoiGoi: 0,
    send(lenh: ListObjectsV2Command): Promise<ListObjectsV2CommandOutput> {
      gia.soLoiGoi += 1;
      const vao = lenh.input;
      expect(vao.Bucket).toBe(BUCKET);
      const prefix = vao.Prefix ?? "";
      let khop = sapXep.filter((o) => o.key.startsWith(prefix) && (vao.StartAfter === undefined || o.key > vao.StartAfter));
      if (vao.Delimiter === "/") {
        const thuMuc = [...new Set(khop.map((o) => prefix + o.key.slice(prefix.length).split("/")[0] + "/"))];
        const batDau = Number(vao.ContinuationToken ?? "0");
        const phan = thuMuc.slice(batDau, batDau + trang);
        const con = batDau + trang < thuMuc.length;
        return Promise.resolve({
          $metadata: {},
          CommonPrefixes: phan.map((p) => ({ Prefix: p })),
          IsTruncated: con,
          NextContinuationToken: con ? String(batDau + trang) : undefined,
        });
      }
      const batDau = Number(vao.ContinuationToken ?? "0");
      khop = khop.slice(batDau);
      const phan = khop.slice(0, trang);
      const con = khop.length > trang;
      return Promise.resolve({
        $metadata: {},
        Contents: phan.map((o) => ({ Key: o.key, LastModified: new Date(o.lastModified) })),
        IsTruncated: con,
        NextContinuationToken: con ? String(batDau + trang) : undefined,
      });
    },
  };
  return gia;
}

describe("[ADR-086] canh mốc neo theo từng tổ chức", () => {
  it("không tổ chức nào ⇒ rỗng, dòng tổng 0/0", async () => {
    const kq = await kiemMocNeo(bucketGia([]), BUCKET, BAY_GIO, 36);
    expect(kq).toEqual([]);
    expect(dongLog(kq, 36)).toEqual(["canh-moc-neo: 0 to chuc, 0 thieu"]);
  });

  it("tổ chức có mốc trong 36 giờ ⇒ mới; tổ chức chỉ có mốc cũ ⇒ THIEU", async () => {
    const s3 = bucketGia([
      { key: khoa(A, BAY_GIO - 50 * GIO), lastModified: BAY_GIO - 50 * GIO },
      { key: khoa(A, BAY_GIO - 2 * GIO), lastModified: BAY_GIO - 2 * GIO },
      { key: khoa(B, BAY_GIO - 40 * GIO), lastModified: BAY_GIO - 40 * GIO },
    ]);
    const kq = await kiemMocNeo(s3, BUCKET, BAY_GIO, 36);
    expect(kq).toEqual([
      { org: A, moi: true },
      { org: B, moi: false },
    ]);
    expect(dongLog(kq, 36)).toEqual([
      `canh-moc-neo: ${B} THIEU MOC NEO trong 36 gio`,
      "canh-moc-neo: 2 to chuc, 1 thieu",
    ]);
  });

  it("tên 'tương lai' không lừa được phép đo: phán xử bằng LastModified", async () => {
    const s3 = bucketGia([{ key: khoa(A, BAY_GIO + 365 * 24 * GIO), lastModified: BAY_GIO - 100 * GIO }]);
    expect(await coMocNeoMoi(s3, BUCKET, A, BAY_GIO - 36 * GIO)).toBe(false);
  });

  it("mốc thật mới nằm TRƯỚC một tên tương lai cũ vẫn được thấy", async () => {
    const s3 = bucketGia([
      { key: khoa(A, BAY_GIO + 365 * 24 * GIO), lastModified: BAY_GIO - 100 * GIO },
      { key: khoa(A, BAY_GIO - GIO), lastModified: BAY_GIO - GIO },
    ]);
    expect(await coMocNeoMoi(s3, BUCKET, A, BAY_GIO - 36 * GIO)).toBe(true);
  });

  it("phân trang: danh sách tổ chức và đối tượng qua nhiều trang", async () => {
    const orgs = Array.from({ length: 5 }, (_, i) => `${String(i).repeat(8)}-0000-4000-8000-000000000000`);
    const ds: DoiTuong[] = [];
    for (const o of orgs) for (let i = 0; i < 4; i++) ds.push({ key: khoa(o, BAY_GIO - (60 - i) * GIO), lastModified: BAY_GIO - (60 - i) * GIO });
    ds.push({ key: khoa(orgs[4] ?? "", BAY_GIO - GIO), lastModified: BAY_GIO - GIO });
    const kq = await kiemMocNeo(bucketGia(ds, 2), BUCKET, BAY_GIO, 36);
    expect(kq.map((k) => k.moi)).toEqual([false, false, false, false, true]);
  });

  it("thư mục không phải UUID dưới so-kiem-toan/ ⇒ ném (bucket có rác là một phát hiện, không bỏ qua)", async () => {
    await expect(lietKeToChucDaNeo(bucketGia([{ key: "so-kiem-toan/khong-phai-uuid/x.json", lastModified: 0 }]), BUCKET)).rejects.toThrow(
      /khong phai UUID/u,
    );
  });

  it("NGUONG_GIO: mặc định 36, chỉ số nguyên dương", () => {
    expect(docNguongGio(undefined)).toBe(36);
    expect(docNguongGio("")).toBe(36);
    expect(docNguongGio("26")).toBe(26);
    for (const sai of ["0", "-1", "1.5", "abc", "99999"]) expect(() => docNguongGio(sai), sai).toThrow();
  });

  it("lambda/canh-moc-neo.mjs trùng byte với nguồn gỡ kiểu — chạy `pnpm neo:dong-goi-lambda` nếu đỏ", () => {
    const nguon = readFileSync(new URL("./canh-moc-neo.ts", import.meta.url), "utf8");
    const lambda = readFileSync(new URL("../lambda/canh-moc-neo.mjs", import.meta.url), "utf8");
    expect(lambda).toBe(stripTypeScriptTypes(nguon, { mode: "strip" }));
  });
});
