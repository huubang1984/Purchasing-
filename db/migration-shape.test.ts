import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ============================================================================================
// [S7b-T3] TÍNH NGUYÊN TỬ CỦA MỘT BẢNG CÓ RLS — CƯỠNG CHẾ TĨNH, KHÔNG CẦN DATABASE
//
// Bộ chạy migration chạy MỖI FILE trong MỘT transaction riêng (packages/db/src/migrate.ts).
// Nên nếu CREATE TABLE ở file N còn ENABLE/FORCE ROW LEVEL SECURITY ở file N+1, một lần
// migrate() hỏng giữa hai file để lại production với bảng có org_id mà KHÔNG có RLS.
//
// Vì sao phép kiểm này KHÔNG THAY THẾ được bằng db/rls-coverage.int.test.ts, và ngược lại:
// test kia đọc TRẠNG THÁI CUỐI sau khi toàn bộ migration đã chạy xong, nên một lược đồ chia
// đôi qua hai file vẫn cho ra trạng thái cuối hoàn hảo và test kia vẫn xanh. Thứ nguy hiểm ở
// đây không phải trạng thái cuối mà là CỬA SỔ ở giữa — và cửa sổ đó chỉ nhìn thấy được khi
// đọc từng file riêng. Hai test canh hai thứ khác nhau; cần cả hai.
// ============================================================================================

const THU_MUC = fileURLToPath(new URL("./migrations", import.meta.url));

/** Giống danh sách trong db/rls-coverage.int.test.ts: bảng gốc của cây tenant, id LÀ tổ chức. */
const BANG_GOC_TENANT = ["organizations"];

/**
 * Bỏ chú thích dòng (-- ... hết dòng) trước khi so khớp. Không có bước này, chính các đoạn
 * bình luận giải thích khuôn RLS ở đầu 002 sẽ được đọc như câu lệnh thật và làm mọi phép kiểm
 * dưới đây xanh giả.
 */
function boChuThich(pNoiDung: string): string {
  return pNoiDung.replace(/--[^\n]*/g, "");
}

/** Cắt phần thân trong ngoặc của CREATE TABLE, đếm ngoặc cân bằng từ dấu "(" đầu tiên. */
function catThanBang(pSql: string, pViTriBatDau: number): string {
  const mo = pSql.indexOf("(", pViTriBatDau);
  if (mo === -1) return "";
  let sau = 0;
  for (let i = mo; i < pSql.length; i += 1) {
    if (pSql[i] === "(") sau += 1;
    else if (pSql[i] === ")") {
      sau -= 1;
      if (sau === 0) return pSql.slice(mo + 1, i);
    }
  }
  return "";
}

interface BangTimDuoc {
  tenBang: string;
  tenFile: string;
  chiuRangBuocTenant: boolean;
}

function docCacFile(): Map<string, string> {
  const ketQua = new Map<string, string>();
  for (const tenFile of readdirSync(THU_MUC).filter((f) => f.endsWith(".sql")).sort()) {
    ketQua.set(tenFile, boChuThich(readFileSync(`${THU_MUC}/${tenFile}`, "utf8")));
  }
  return ketQua;
}

function timCacBang(pFile: Map<string, string>): BangTimDuoc[] {
  const ketQua: BangTimDuoc[] = [];
  for (const [tenFile, sql] of pFile) {
    const bieuThuc = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi;
    for (const khop of sql.matchAll(bieuThuc)) {
      const tenBang = khop[1]!;
      const than = catThanBang(sql, khop.index + khop[0].length);
      ketQua.push({
        tenBang,
        tenFile,
        chiuRangBuocTenant: /\borg_id\b/.test(than) || BANG_GOC_TENANT.includes(tenBang),
      });
    }
  }
  return ketQua;
}

/** Escape một tên bảng để nhúng an toàn vào biểu thức chính quy. */
function neoTen(pTen: string): string {
  return pTen.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("hình dạng file migration", () => {
  const cacFile = docCacFile();
  const cacBang = timCacBang(cacFile);

  it("có ít nhất một bảng chịu ràng buộc tenant để kiểm — không rỗng ruột", () => {
    expect(cacBang.filter((b) => b.chiuRangBuocTenant).map((b) => b.tenBang).sort()).toEqual([
      "organizations",
      "users",
    ]);
  });

  it("[INV-F1] CREATE TABLE, ENABLE/FORCE RLS, POLICY và GRANT của một bảng nằm cùng MỘT file", () => {
    const thieu: string[] = [];

    for (const bang of cacBang) {
      if (!bang.chiuRangBuocTenant) continue;
      const sql = cacFile.get(bang.tenFile)!;
      const ten = neoTen(bang.tenBang);

      const canCo: [string, RegExp][] = [
        ["ENABLE ROW LEVEL SECURITY", new RegExp(`ALTER\\s+TABLE\\s+${ten}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i")],
        ["FORCE ROW LEVEL SECURITY", new RegExp(`ALTER\\s+TABLE\\s+${ten}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i")],
        ["CREATE POLICY", new RegExp(`CREATE\\s+POLICY\\s+[A-Za-z0-9_]+\\s+ON\\s+${ten}\\b`, "i")],
        ["GRANT", new RegExp(`GRANT\\s[^;]*\\sON\\s+(?:TABLE\\s+)?${ten}\\b[^;]*;`, "is")],
      ];

      for (const [nhan, bieuThuc] of canCo) {
        if (!bieuThuc.test(sql)) {
          thieu.push(`${bang.tenFile} tạo bảng "${bang.tenBang}" nhưng thiếu ${nhan} trong CÙNG file`);
        }
      }
    }

    expect(
      thieu,
      "Một bảng chịu ràng buộc tenant phải mang trọn CREATE TABLE + ENABLE + FORCE + POLICY + " +
        "GRANT trong cùng một file, vì mỗi file là một transaction (S7b-T3).",
    ).toEqual([]);
  });

  it("[INV-F1] không file nào bật RLS hay tạo policy cho bảng do file KHÁC tạo ra", () => {
    const fileTaoBang = new Map(cacBang.map((b) => [b.tenBang.toLowerCase(), b.tenFile]));
    const lacCho: string[] = [];

    const cacCauLenh: [string, RegExp][] = [
      ["ALTER TABLE ... ROW LEVEL SECURITY", /ALTER\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+(?:ENABLE|FORCE|DISABLE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY/gi],
      ["CREATE POLICY", /CREATE\s+POLICY\s+[A-Za-z0-9_]+\s+ON\s+([A-Za-z_][A-Za-z0-9_]*)/gi],
    ];

    for (const [tenFile, sql] of cacFile) {
      for (const [nhan, bieuThuc] of cacCauLenh) {
        for (const khop of sql.matchAll(bieuThuc)) {
          const tenBang = khop[1]!.toLowerCase();
          const fileGoc = fileTaoBang.get(tenBang);
          if (fileGoc === undefined) {
            lacCho.push(`${tenFile}: "${nhan}" trên bảng "${tenBang}" không được file nào tạo`);
          } else if (fileGoc !== tenFile) {
            lacCho.push(
              `${tenFile}: "${nhan}" trên bảng "${tenBang}" — bảng đó được tạo ở ${fileGoc}. ` +
                "Tách hai việc qua hai file để lộ cửa sổ không có RLS giữa hai transaction.",
            );
          }
        }
      }
    }

    expect(lacCho).toEqual([]);
  });

  // [S11-T3] Lớp tĩnh của cùng ba dạng bị cấm mà db/rls-coverage.int.test.ts canh ở tầng
  // catalog. Cần cả hai vì chúng bắt ở hai thời điểm khác nhau: lớp này đỏ ngay khi người viết
  // lưu file, KHÔNG cần Docker, nên nó là thứ chạy trong `pnpm test`; lớp catalog bắt cả những
  // policy tạo tay sau triển khai mà không file nào biết tới.
  it("[INV-F1] không file migration nào chứa dạng policy fail-open bị cấm", () => {
    const viPham: string[] = [];

    for (const [tenFile, sql] of cacFile) {
      for (const khop of sql.matchAll(
        /CREATE\s+POLICY\s+([A-Za-z0-9_]+)\s+ON\s+[A-Za-z_][A-Za-z0-9_]*([\s\S]*?);/gi,
      )) {
        const than = khop[2]!;
        if (/app_current_org_id\s*\(\s*\)\s+IS\s+NULL/i.test(than)) {
          viPham.push(`${tenFile}: policy "${khop[1]!}" dùng "app_current_org_id() IS NULL" — fail-open`);
        }
        if (/\bcoalesce\s*\(/i.test(than)) {
          viPham.push(`${tenFile}: policy "${khop[1]!}" dùng coalesce() trong biểu thức policy`);
        }
        if (!/\bWITH\s+CHECK\b/i.test(than)) {
          viPham.push(`${tenFile}: policy "${khop[1]!}" không viết WITH CHECK tường minh`);
        }
        if (/\bWITH\s+CHECK\s*\(\s*true\s*\)/i.test(than)) {
          viPham.push(`${tenFile}: policy "${khop[1]!}" có WITH CHECK (true) — không kiểm gì cả`);
        }
      }
    }

    expect(viPham).toEqual([]);
  });
});
