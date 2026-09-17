// ==============================================================================================
// KHÁCH HTTP CỦA `apps/mcp` — ĐO TRÊN MỘT MÁY CHỦ THẬT, VÌ BA BẢO ĐẢM Ở ĐÂY LÀ VỀ DÂY DẪN
//
// Ba thứ không đo được bằng một `fetch` giả, và cả ba đều là đường rò cookie phiên:
//
//   ⑴ **Chuyển hướng.** `fetch` mặc định ĐI THEO 3xx. Một `apps/api` bị chiếm — hay một biến môi
//      trường trỏ nhầm — trả `302 Location: https://ke-la.example/` và thư viện gửi lại yêu cầu
//      với header `cookie` mà CHÍNH TA đã đặt bằng tay: trình duyệt có luật same-origin cho
//      cookie, một `fetch` phía máy chủ với header thủ công thì KHÔNG. `redirect: "manual"` là
//      lớp chặn, và khẳng định dưới đây đo bằng cách đếm số yêu cầu máy chủ THỨ HAI nhận được.
//   ⑵ **Trần thời gian.** Không có nó, một máy chủ treo giữ tiến trình MCP đứng vô hạn và máy
//      khách không có cách nào biết.
//   ⑶ **Thông điệp lỗi.** Chúng đi vào ngữ cảnh của một agent, tức ra khỏi máy.
// ==============================================================================================

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { docCauHinh } from "./cau-hinh.js";
import { taoGoiApi, TEN_COOKIE_PHIEN, TRAN_THAN_BYTE } from "./khach-api.js";
// Đối chiếu xuyên app, chỉ ở test: tên cookie là hợp đồng của `apps/api`, và một bản chép trong
// `apps/mcp` sẽ trôi lặng lẽ vào ngày ai đó đổi nó bên kia.
import { COOKIE_PHIEN_NGUOI_MUA } from "../../api/src/routes/auth.js";

const COOKIE = "s%3AabcDEF.0123456789";

const cacMayChu: Server[] = [];

afterEach(async () => {
  await Promise.all(
    cacMayChu.splice(0).map(
      (s) =>
        new Promise<void>((giaiQuyet) => {
          s.close(() => {
            giaiQuyet();
          });
        }),
    ),
  );
});

async function mayChu(
  xuLy: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ goc: string; nhatKy: { duongDan: string; cookie: string | undefined }[] }> {
  const nhatKy: { duongDan: string; cookie: string | undefined }[] = [];
  const s = createServer((req, res) => {
    nhatKy.push({ duongDan: req.url ?? "", cookie: req.headers.cookie });
    xuLy(req, res);
  });
  cacMayChu.push(s);
  await new Promise<void>((giaiQuyet) => {
    s.listen(0, "127.0.0.1", giaiQuyet);
  });
  const { port } = s.address() as AddressInfo;
  return { goc: `http://127.0.0.1:${String(port)}`, nhatKy };
}

const goiApiToi = (goc: string, tranMs = "5000") =>
  taoGoiApi(
    docCauHinh({
      TRUSTPROCURE_MCP_API_URL: goc,
      TRUSTPROCURE_MCP_SESSION_COOKIE: COOKIE,
      TRUSTPROCURE_MCP_TIMEOUT_MS: tranMs,
    }),
  );

describe("khách HTTP của apps/mcp", () => {
  it("tên cookie KHỚP hợp đồng của apps/api — không có bản chép nào trôi", () => {
    expect(TEN_COOKIE_PHIEN).toBe(COOKIE_PHIEN_NGUOI_MUA);
  });

  it("gửi cookie phiên tới đúng đường dẫn, và trả nguyên văn thân", async () => {
    const { goc, nhatKy } = await mayChu((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"id":"abc"}');
    });
    const kq = await goiApiToi(goc)("GET", "/rfqs/abc", true);
    expect(kq).toMatchObject({ status: 200, than: '{"id":"abc"}', quaTran: false });
    expect(kq.kieuNoiDung).toContain("application/json");
    expect(nhatKy[0]?.duongDan).toBe("/rfqs/abc");
    expect(nhatKy[0]?.cookie).toBe(`${TEN_COOKIE_PHIEN}=${COOKIE}`);
  });

  it("⑸ lời gọi CÔNG KHAI không mang cookie phiên", async () => {
    // [lượt soi 69 L-6] Một bí mật chỉ đi ra khi có lý do là một bí mật ít đường rò hơn.
    const { goc, nhatKy } = await mayChu((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    await goiApiToi(goc)("GET", "/health", false);
    expect(nhatKy[0]?.cookie).toBeUndefined();
  });

  it("mã trạng thái lỗi đi ra nguyên vẹn, không ném", async () => {
    const { goc } = await mayChu((_req, res) => {
      res.writeHead(403);
      res.end('{"error":"PERMISSION_DENIED"}');
    });
    expect((await goiApiToi(goc)("GET", "/me", true)).status).toBe(403);
  });

  it("⑴ KHÔNG đi theo 3xx — máy chủ thứ hai không nhận được một yêu cầu nào", async () => {
    const dich = await mayChu((_req, res) => {
      res.writeHead(200);
      res.end('{"da-lay-duoc-cookie":true}');
    });
    const { goc } = await mayChu((_req, res) => {
      res.writeHead(302, { location: `${dich.goc}/nuot-cookie` });
      res.end();
    });

    const kq = await goiApiToi(goc)("GET", "/me", true);
    expect(kq.status).toBe(302);
    expect(
      dich.nhatKy,
      "cookie phiên đã bị gửi tới một host khác — `redirect: \"manual\"` không còn đứng",
    ).toEqual([]);
  });

  it("⑵ máy chủ treo ⇒ ném trong trần, lỗi CÓ TÊN", async () => {
    const { goc } = await mayChu(() => {
      /* không bao giờ trả lời */
    });
    const batDau = Date.now();
    await expect(goiApiToi(goc, "300")("GET", "/me", true)).rejects.toThrow();
    expect(Date.now() - batDau).toBeLessThan(5_000);
  });

  // ============================================================================================
  // [lượt soi 69 M-2] TRẦN THÂN CHẶN TRƯỚC KHI NẠP — hai ca, vì hai đường khác nhau
  //
  // Bản đầu gọi `await phanHoi.text()` rồi mới so độ dài: một `apps/api` bị chiếm (hay một proxy
  // chen giữa) trả dòng chảy liên tục làm tiến trình nạp tới hàng trăm MB vào một chuỗi JS trước
  // khi nói "vượt trần 262144 byte". `fetch` không có trần thân; thứ duy nhất chặn là đồng hồ.
  // ============================================================================================
  it("⑶ máy chủ KHAI content-length vượt trần ⇒ không đọc một byte thân nào", async () => {
    const { goc } = await mayChu((_req, res) => {
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": String(TRAN_THAN_BYTE + 1),
      });
      res.end("x".repeat(TRAN_THAN_BYTE + 1));
    });
    const kq = await goiApiToi(goc)("GET", "/me", true);
    expect(kq.quaTran).toBe(true);
    expect(kq.than).toBe("");
  });

  it("⑶ thân KHÔNG khai độ dài, chảy quá trần ⇒ huỷ giữa chừng, không nạp trọn", async () => {
    let daGui = 0;
    const { goc } = await mayChu((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      // Chunked, không content-length: đúng hình dạng mà phép kiểm đầu không thấy được.
      const doan = "x".repeat(64 * 1024);
      const day = (): void => {
        // Dừng hẳn ở 8 MB để một lần vá HỎNG không treo bộ test — con số này là lớp an toàn của
        // TEST, không phải của mã sản xuất.
        while (daGui < 8 * 1024 * 1024) {
          daGui += doan.length;
          if (!res.write(doan)) {
            res.once("drain", day);
            return;
          }
        }
        res.end();
      };
      day();
    });
    const kq = await goiApiToi(goc)("GET", "/me", true);
    expect(kq.quaTran).toBe(true);
    expect(kq.than).toBe("");
  });

  it("⑷ đường dẫn dựng ra ngoài gốc api thì NÉM, không gửi đi", async () => {
    // [lượt soi 69 L-5] Hôm nay mọi `path` trong bảng công cụ đều bắt đầu bằng `/`, nên ca này
    // chưa xảy ra được qua đường công cụ. Nó đóng ca của một công cụ TƯƠNG LAI khai thiếu gạch
    // chéo đầu: nối chuỗi khi ấy biến `https://api.example.com` + `rfqs/x` thành một HOST KHÁC.
    const { goc, nhatKy } = await mayChu((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    await expect(goiApiToi(goc)("GET", "https://ke-la.example/nuot", true)).rejects.toThrow(
      /ngoai goc api/u,
    );
    await expect(goiApiToi(goc)("GET", "//ke-la.example/nuot", true)).rejects.toThrow(
      /ngoai goc api/u,
    );
    expect(nhatKy).toEqual([]);
  });

  it("⑶ lỗi mạng KHÔNG mang cookie trong thông điệp", async () => {
    // Cổng đóng: `fetch` ném ECONNREFUSED.
    const goiApi = taoGoiApi(
      docCauHinh({
        TRUSTPROCURE_MCP_API_URL: "http://127.0.0.1:1",
        TRUSTPROCURE_MCP_SESSION_COOKIE: COOKIE,
      }),
    );
    try {
      await goiApi("GET", "/me", true);
      expect.unreachable("phải ném");
    } catch (e) {
      const text = `${(e as Error).name}: ${(e as Error).message}\n${String((e as Error).stack)}`;
      expect(text).not.toContain(COOKIE);
    }
  });
});
