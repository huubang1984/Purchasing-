// ==============================================================================================
// LỚP CANH TĨNH TRÊN BẢNG ROUTE — chạy ở T1, KHÔNG khởi động máy chủ, KHÔNG cần Postgres.
//
// [INV-H17] Mọi route đổi trạng thái của người mua khai một mã quyền, và `requirePermission` chỉ
//           được gọi ở `dispatch.ts`. Hai vế, hai phép đo: vế một đọc CẤU TRÚC `ROUTES`, vế hai
//           đọc MÃ NGUỒN của toàn `apps/api`.
// [INV-E6]  Không mẫu đường dẫn nào mang tham số tên credential. (Vế header của E6 đo ở
//           `api.int.test.ts` trên tiến trình thật.)
// [g9-]     `routes/**` không chạm pg / tenancy / db / node:http; `node:http` chỉ ở `server.ts`.
//           Cộng một PROBE chạy depcruise thật: viết một handler vi phạm, đòi quy tắc ĐỎ.
//
// Vị từ được tách thành hàm thuần (`timViPhamBangRoute`) để mỗi ca đo trên một bảng GIẢ, không
// phải bằng cách sửa `ROUTES` thật rồi hoàn tác — cùng khuôn `timViPham` ở cong-quyen-route.
// ==============================================================================================
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { timViPhamBangRoute, type Route } from "./route-types.js";
import { ROUTES } from "./routes.js";

const GOC = fileURLToPath(new URL("../../../", import.meta.url));

/** File nguồn (không test) của apps/api ĐÃ VÀO KHO — cùng tiêu chí "chỉ file git theo dõi". */
function quetNguonApi(): readonly string[] {
  return execFileSync("git", ["ls-files", "--", "apps/api/src"], { cwd: GOC, encoding: "utf8" })
    .split(/\r?\n/)
    .filter((d) => d.endsWith(".ts") && !d.includes(".test."))
    .map((d) => d.replace(/\\/g, "/"));
}

const khongLam = (): Promise<never> => Promise.reject(new Error("khong goi toi"));

/** Bỏ chú thích dòng và khối. Thô, đủ cho mã của chính dự án (không có `//` trong chuỗi ký tự). */
function boChuThich(ma: string): string {
  return ma.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
}

describe("[INV-H17] bảng route: mọi route ghi của người mua khai mã quyền", () => {
  it("[INV-H17] `ROUTES` thật không có vi phạm nào", () => {
    expect(timViPhamBangRoute(ROUTES)).toEqual([]);
    expect(ROUTES.length, "bảng route rỗng thì khẳng định trên rỗng ruột").toBeGreaterThan(2);
  });

  it("[INV-H17] ĐỐI CHỨNG DƯƠNG: route POST của người mua thiếu `permission` bị bắt", () => {
    // Bảng đến từ JSON sẽ không có kiểu; ép kiểu ở đây để mô phỏng đúng ca ấy.
    const xau = [
      { method: "POST", path: "/x", audience: "BUYER", mutates: true, resourceType: "X", handler: khongLam },
    ] as unknown as Route[];
    expect(timViPhamBangRoute(xau).join("\n")).toContain("[INV-H17]");
  });

  it("GET không được đổi trạng thái; POST không được trốn cổng bằng mutates:false; không khai hai lần", () => {
    const xau = [
      { method: "GET", path: "/a", audience: "BUYER", mutates: true, permission: "rfq.create", resourceType: "A", handler: khongLam },
      { method: "POST", path: "/b", audience: "BUYER", mutates: false, handler: khongLam },
      { method: "GET", path: "/c", audience: "PUBLIC", handler: khongLam },
      { method: "GET", path: "/c", audience: "PUBLIC", handler: khongLam },
      { method: "POST", path: "/d", audience: "PUBLIC", handler: khongLam },
    ] as unknown as Route[];
    const vp = timViPhamBangRoute(xau);
    expect(vp.some((v) => v.startsWith("GET /a") && v.includes("GET không được"))).toBe(true);
    expect(vp.some((v) => v.startsWith("POST /b") && v.includes("mutates:false"))).toBe(true);
    expect(vp.some((v) => v.startsWith("GET /c") && v.includes("HAI LẦN"))).toBe(true);
    expect(vp.some((v) => v.startsWith("POST /d") && v.includes("PUBLIC chỉ được là GET"))).toBe(true);
  });

  it("[INV-H17] `requirePermission` / `withTenant` / `withGuestSession` CHỈ xuất hiện ở dispatch.ts", () => {
    const tep = quetNguonApi();
    expect(tep.length, "bộ quét phải thấy mã của apps/api").toBeGreaterThan(5);
    const viPham: string[] = [];
    for (const t of tep) {
      if (t.endsWith("/dispatch.ts")) continue;
      // Đo LỜI GỌI, không đo chuỗi: chú thích của routes/buyer.ts nhắc tới `requirePermission` để
      // nói rằng nó KHÔNG gọi — một phép đếm chuỗi sẽ đọc câu ấy thành một vi phạm.
      const ma = boChuThich(readFileSync(join(GOC, t), "utf8"));
      for (const ten of ["requirePermission", "withTenant", "withGuestSession"]) {
        if (new RegExp(`\\b${ten}\\s*\\(`, "u").test(ma)) viPham.push(`${t}: ${ten}(`);
      }
    }
    expect(
      viPham,
      "Một cổng quyền / một lần gắn phiên mọc ngoài dispatch.ts. Hai nơi là hai nơi để lệch nhau.",
    ).toEqual([]);
    // Đối chứng: dispatch.ts THẬT SỰ gọi cả ba — nếu không, "chỉ ở dispatch" đúng vì không ở đâu cả.
    const dispatch = readFileSync(join(GOC, "apps/api/src/dispatch.ts"), "utf8");
    expect(dispatch).toContain("requirePermission(");
    expect(dispatch).toContain("withTenant(");
    expect(dispatch).toContain("withGuestSession(");
  });
});

describe("[INV-E6] không credential nào có chỗ trong đường dẫn", () => {
  it("[INV-E6] `ROUTES` thật không có tham số tên token/otp/code/session", () => {
    const viPham = timViPhamBangRoute(ROUTES).filter((v) => v.includes("E6"));
    expect(viPham).toEqual([]);
  });

  it("[INV-E6] ĐỐI CHỨNG DƯƠNG: `/guest/redeem/:token` bị bắt, kể cả viết hoa hay ghép", () => {
    for (const p of ["/guest/redeem/:token", "/g/:Token", "/g/:otpCode", "/g/:sessionId"]) {
      const xau = [{ method: "GET", path: p, audience: "PUBLIC", handler: khongLam }] as unknown as Route[];
      expect(timViPhamBangRoute(xau).join("\n"), p).toContain("E6");
    }
  });
});

describe("[g9-] handler không chạm tầng vận chuyển hay tầng CSDL", () => {
  it("routes/** không import pg, tenancy, db, node:http; node:http chỉ ở server.ts", () => {
    const tep = quetNguonApi();
    const viPham: string[] = [];
    for (const t of tep) {
      const ma = readFileSync(join(GOC, t), "utf8");
      const imports = [...ma.matchAll(/^\s*import[^;]*?from\s+"([^"]+)"/gmu)].map((m) => m[1]!);
      if (t.includes("/routes/")) {
        for (const i of imports) {
          if (i === "pg" || i === "node:http" || i.startsWith("@trustprocure/tenancy") || i.startsWith("@trustprocure/db")) {
            viPham.push(`${t}: import "${i}"`);
          }
        }
      }
      if (!t.endsWith("/server.ts") && imports.includes("node:http")) {
        viPham.push(`${t}: import "node:http" ngoài server.ts`);
      }
    }
    expect(viPham).toEqual([]);
    // Đối chứng: server.ts thật sự import node:http — nếu không, "chỉ ở server.ts" rỗng ruột.
    expect(readFileSync(join(GOC, "apps/api/src/server.ts"), "utf8")).toMatch(/from "node:http"/u);
  });

  it("PROBE: một handler import @trustprocure/tenancy làm depcruise ĐỎ với quy tắc g9-", () => {
    const thuMuc = join(GOC, "apps/api/src/routes");
    const probe = join(thuMuc, "zprobe-g9.ts");
    mkdirSync(thuMuc, { recursive: true });
    writeFileSync(probe, 'import { withTenant } from "@trustprocure/tenancy";\nexport const x = withTenant;\n');
    try {
      const kq = spawnSync(
        "pnpm",
        ["exec", "depcruise", "apps/api", "--config", ".dependency-cruiser.cjs"],
        { cwd: GOC, encoding: "utf8", shell: true },
      );
      const ra = `${kq.stdout}${kq.stderr}`;
      expect(kq.status, ra).not.toBe(0);
      expect(ra).toContain("g9-api-routes-khong-cham-tenancy-va-db");
    } finally {
      rmSync(probe, { force: true });
    }
  }, 120000);
});
