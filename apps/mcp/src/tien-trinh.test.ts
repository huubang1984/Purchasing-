// ==============================================================================================
// `main.ts` THẬT, CHẠY NHƯ `pnpm mcp:dev` — TIẾN TRÌNH CON, CÙNG LỆNH VỚI SCRIPT Ở package.json
//
// Cùng khuôn `apps/api/src/composition.int.test.ts`, và ở đây nó đo ba thứ mà không phép đo nào
// trong tiến trình đo được:
//
//   ⑴ **stdout SẠCH.** Kênh giao thức là stdout; một dòng log lọt vào giữa làm máy khách MCP ngắt
//      kết nối. Khẳng định: MỌI dòng stdout parse được thành JSON. Đây là lý do `main.ts` cấm
//      `console.log` và dự án cấm nó ở eslint — hai lớp cho cùng một hỏng hóc.
//   ⑵ **Cookie phiên không ra stderr.** Log lúc khởi động in `apiBaseUrl`, và nó KHÔNG được in
//      cookie, kể cả độ dài.
//   ⑶ **Bắt tay đầu-cuối thật**: initialize → tools/list → tools/call, trên stdio, với một
//      `apps/api` giả trả JSON. Thứ duy nhất không có ở đây là chính api — có ở `apps/api`.
// ==============================================================================================

import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CONG_CU, MO_DAU_DU_LIEU, PHIEN_BAN_MCP } from "./index.js";

const GOC_KHO = fileURLToPath(new URL("../../../", import.meta.url));
const LENH_MAIN = [
  "--experimental-transform-types",
  "--import",
  "./apps/mcp/register-ts-resolve.mjs",
  "apps/mcp/src/main.ts",
];
const COOKIE = "s%3AbiMatCuaPhienNguoiMua.0123456789";

const cacTienTrinh: ChildProcess[] = [];
const cacMayChu: Server[] = [];

afterEach(async () => {
  for (const tt of cacTienTrinh.splice(0)) tt.kill();
  await Promise.all(
    cacMayChu.splice(0).map(
      (s) =>
        new Promise<void>((xong) => {
          s.close(() => {
            xong();
          });
        }),
    ),
  );
});

function chayMain(env: Readonly<Record<string, string>>): ChildProcess {
  const tt = spawn(process.execPath, LENH_MAIN, {
    cwd: GOC_KHO,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  cacTienTrinh.push(tt);
  return tt;
}

async function apiGia(kindCuaMe = "AGENT_READONLY"): Promise<{ goc: string; nhatKy: string[] }> {
  const nhatKy: string[] = [];
  const s = createServer((req, res) => {
    nhatKy.push(req.url ?? "");
    res.writeHead(200, { "content-type": "application/json" });
    // [khoản 141 / ADR-039] Tiến trình gọi `GET /me` MỘT lần lúc khởi động và ném nếu `kind` không
    // phải `AGENT_READONLY` — nên mọi phép đo dưới đây phải phục vụ được lời gọi ấy trước đã.
    if (req.url === "/me") {
      res.end(JSON.stringify({ userId: "u", sessionId: "s", orgId: "o", kind: kindCuaMe }));
      return;
    }
    res.end(JSON.stringify({ duongDan: req.url }));
  });
  cacMayChu.push(s);
  await new Promise<void>((xong) => {
    s.listen(0, "127.0.0.1", xong);
  });
  return { goc: `http://127.0.0.1:${String((s.address() as AddressInfo).port)}`, nhatKy };
}

function doiDong(tt: ChildProcess, kenh: "stdout" | "stderr", mau: RegExp, hanMs: number): Promise<string> {
  return new Promise((xong, hong) => {
    let gom = "";
    const dongHo = setTimeout(() => {
      hong(new Error(`het ${String(hanMs)}ms, ${kenh}: ${gom}`));
    }, hanMs);
    tt[kenh]?.on("data", (d: Buffer) => {
      gom += d.toString("utf8");
      if (mau.test(gom)) {
        clearTimeout(dongHo);
        xong(gom);
      }
    });
    tt.once("exit", () => {
      clearTimeout(dongHo);
      if (!mau.test(gom)) hong(new Error(`tien trinh thoat truoc khi thay mau, ${kenh}: ${gom}`));
    });
  });
}

const gui = (tt: ChildProcess, yeuCau: object): void => {
  tt.stdin?.write(`${JSON.stringify(yeuCau)}\n`);
};

describe("tiến trình mcp thật", () => {
  it("cấu hình hỏng ⇒ thoát mã 1, stderr nêu TÊN biến và KHÔNG nêu cookie", async () => {
    const tt = chayMain({ TRUSTPROCURE_MCP_API_URL: "", TRUSTPROCURE_MCP_SESSION_COOKIE: COOKIE });
    const loi = await doiDong(tt, "stderr", /cau hinh khong hop le/u, 60_000);
    const ma = await new Promise<number | null>((xong) => {
      tt.once("exit", (m) => {
        xong(m);
      });
    });
    expect(ma).toBe(1);
    expect(loi).toContain("TRUSTPROCURE_MCP_API_URL");
    expect(loi).not.toContain(COOKIE);
  }, 90_000);

  it("⑶ bắt tay đầu-cuối trên stdio, và ⑴ stdout chỉ có JSON, ⑵ stderr không có cookie", async () => {
    const api = await apiGia();
    const tt = chayMain({
      TRUSTPROCURE_MCP_API_URL: api.goc,
      TRUSTPROCURE_MCP_SESSION_COOKIE: COOKIE,
    });
    const sanSang = await doiDong(tt, "stderr", /san sang tren stdio/u, 60_000);
    expect(sanSang, "dòng khởi động mang cookie phiên").not.toContain(COOKIE);

    gui(tt, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PHIEN_BAN_MCP } });
    gui(tt, { jsonrpc: "2.0", method: "notifications/initialized" });
    gui(tt, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    gui(tt, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_rfq", arguments: { rfqId: "abc" } },
    });

    // Chờ phản hồi của id 3 — nó tới sau cùng vì phải đi một vòng HTTP.
    const raw = await doiDong(tt, "stdout", /"id":3/u, 60_000);
    const dong = raw.split("\n").filter((d) => d.trim().length > 0);

    // ⑴ MỌI dòng stdout là JSON — không một dòng log nào lọt vào kênh giao thức.
    const phanHoi = dong.map((d) => JSON.parse(d) as { id?: unknown; result?: unknown });
    expect(phanHoi.length).toBe(3); // notification KHÔNG được trả lời

    const theoId = new Map(phanHoi.map((p) => [p.id, p]));
    expect(theoId.get(1)).toMatchObject({ result: { protocolVersion: PHIEN_BAN_MCP } });
    expect(
      (theoId.get(2) as { result: { tools: { name: string }[] } }).result.tools.length,
    ).toBe(CONG_CU.length);
    const thanMongDoi = `${MO_DAU_DU_LIEU}\n${JSON.stringify({ duongDan: "/rfqs/abc" })}`;
    expect(theoId.get(3)).toMatchObject({
      result: { content: [{ type: "text", text: thanMongDoi }] },
    });

    // Tiến trình gọi api THẬT đúng hai lần: `/me` lúc khởi động (lớp phạm vi), rồi đúng đường dẫn
    // của công cụ. Không lời gọi thứ ba — một công cụ không được lặng lẽ dò thêm đường nào.
    expect(api.nhatKy).toEqual(["/me", "/rfqs/abc"]);
  }, 90_000);

  // ============================================================================================
  // [khoản 141 / ADR-039 — lượt soi đối kháng Đ-2] LỚP DUY NHẤT TRẢ LỜI CÂU "PHIÊN NÀO CHO TIẾN
  // TRÌNH NÀO"
  //
  // Bốn lớp của khoản 141 canh HÀNG PHIÊN. Không lớp nào ngăn người vận hành cắm một cookie NGƯỜI
  // vào biến môi trường — và làm thế thì tiến trình này mạnh y hệt trước vòng 141. Hai khẳng định
  // dưới đây là phép đo của lớp bù ở phía máy khách, và chúng đo trên TIẾN TRÌNH THẬT vì đó là
  // chỗ duy nhất "không khởi động" có nghĩa.
  // ============================================================================================
  it.each([
    { ten: "phiên NGƯỜI", kind: "USER" },
    { ten: "giá trị lạ", kind: "SOMETHING_ELSE" },
  ])("cầm $ten ⇒ TỪ CHỐI khởi động, thoát mã 1, không nêu cookie", async ({ kind }) => {
    const api = await apiGia(kind);
    const tt = chayMain({
      TRUSTPROCURE_MCP_API_URL: api.goc,
      TRUSTPROCURE_MCP_SESSION_COOKIE: COOKIE,
    });
    const loi = await doiDong(tt, "stderr", /tu choi khoi dong/u, 60_000);
    const ma = await new Promise<number | null>((xong) => {
      tt.once("exit", (m) => {
        xong(m);
      });
    });
    expect(ma).toBe(1);
    expect(loi).toContain("PhamViSaiError");
    expect(loi).toContain("AGENT_READONLY");
    expect(loi, "thông điệp từ chối mang cookie phiên").not.toContain(COOKIE);
    // Và nó dừng TRƯỚC khi nghe stdio: không một dòng "san sang" nào.
    expect(loi).not.toContain("san sang tren stdio");
    // Đúng một lời gọi api: `/me`. Không công cụ nào chạy được.
    expect(api.nhatKy).toEqual(["/me"]);
  }, 90_000);

  it("dòng rác trên stdin ⇒ -32700, tiến trình KHÔNG chết", async () => {
    const api = await apiGia();
    const tt = chayMain({
      TRUSTPROCURE_MCP_API_URL: api.goc,
      TRUSTPROCURE_MCP_SESSION_COOKIE: COOKIE,
    });
    await doiDong(tt, "stderr", /san sang tren stdio/u, 60_000);

    tt.stdin?.write("khong phai JSON\n");
    gui(tt, { jsonrpc: "2.0", id: 9, method: "ping" });

    const raw = await doiDong(tt, "stdout", /"id":9/u, 60_000);
    const phanHoi = raw
      .split("\n")
      .filter((d) => d.trim().length > 0)
      .map((d) => JSON.parse(d) as { id: unknown; error?: { code: number } });
    expect(phanHoi[0]).toMatchObject({ id: null, error: { code: -32700 } });
    expect(phanHoi[1]).toMatchObject({ id: 9 });
    expect(tt.exitCode, "một dòng rác không được làm chết phiên").toBeNull();
  }, 90_000);
});
