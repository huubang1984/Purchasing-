// ==============================================================================================
// apps/mcp/src/main.ts — ĐIỂM VÀO CỦA TIẾN TRÌNH `mcp`
//
//   pnpm mcp:dev        (node --experimental-transform-types, xem package.json gốc)
//
// Ba việc, và chỉ ba: đọc `process.env` thành cấu hình (`cau-hinh.ts`), nối stdin/stdout vào vòng
// lặp giao thức (`vong-lap.ts`), nghe tín hiệu dừng. Không nghiệp vụ, không CSDL, không HTTP
// server — lời gọi ra ngoài duy nhất của cả tiến trình nằm ở `khach-api.ts`.
//
// STDOUT LÀ KÊNH GIAO THỨC. Một `console.log` ở bất kỳ đâu trong cây này chèn rác vào giữa dòng
// JSON và làm máy khách MCP ngắt kết nối. Mọi thứ con người đọc đi ra STDERR — dự án vốn chỉ cho
// phép `console.error` (eslint `no-console`), nên quy tắc ấy ở đây có thêm một lý do thứ hai.
//
// LOG KHÔNG MANG NỘI DUNG THÔNG ĐIỆP: một dòng vào có thể chứa tham số, một dòng ra có thể chứa
// dữ liệu nghiệp vụ, và cookie phiên nằm trong cấu hình. Ở đây chỉ in SỰ KIỆN.
// ==============================================================================================

import { CauHinhError, docCauHinh } from "./cau-hinh.js";
import { kiemPhamViAgent, taoGoiApi } from "./khach-api.js";
import { taoVongLap } from "./vong-lap.js";

function moTaLoi(e: unknown): string {
  if (e instanceof CauHinhError) return e.message;
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return "loi khong ro";
}

async function chinh(): Promise<void> {
  let ch;
  try {
    ch = docCauHinh(process.env);
  } catch (e) {
    console.error(`[mcp] cau hinh khong hop le — ${moTaLoi(e)}`);
    process.exitCode = 1;
    return;
  }

  // [lượt soi 69 L-2] Chốt chặn cuối. Không có hai dòng này, một lỗi ở bất kỳ đâu ngoài các nhánh
  // đã bắt sẽ giết tiến trình với một stack đầy đủ trên stderr — và stack là đúng thứ có thể mang
  // theo URL hay header của một lời gọi đang bay.
  process.on("unhandledRejection", (e: unknown) => {
    console.error(`[mcp] loi hua bi tu choi khong ai bat — ${moTaLoi(e)}`);
    process.exitCode = 1;
  });
  process.on("uncaughtException", (e: unknown) => {
    console.error(`[mcp] ngoai le khong ai bat — ${moTaLoi(e)}`);
    process.exitCode = 1;
  });

  const goiApi = taoGoiApi(ch);

  // [khoản 141 / ADR-039 — lượt soi đối kháng Đ-2] MỘT lời gọi, MỘT lần, TRƯỚC khi nghe stdin: nếu
  // chứng chỉ trong biến môi trường không phải một phiên agent thì tiến trình này KHÔNG lên. Lý do
  // đầy đủ ở khối đầu `kiemPhamViAgent`. Giá phải trả, nói thẳng: `apps/api` phải đang chạy lúc
  // khởi động — một máy chủ MCP không xác minh được chính mình thì không phải một máy chủ sẵn sàng.
  try {
    await kiemPhamViAgent(goiApi);
  } catch (e) {
    console.error(`[mcp] tu choi khoi dong — ${moTaLoi(e)}`);
    process.exitCode = 1;
    return;
  }

  const vongLap = taoVongLap({
    goiApi,
    ghi: (dong) => {
      // Giá trị trả về của `write` là tín hiệu backpressure. Ở đây không xếp hàng thêm — trần số
      // lời gọi cùng lúc của `vong-lap.ts` mới là thứ giới hạn lượng phản hồi đang bay; dòng log
      // này để một máy khách không đọc stdout không im lặng biến mất khỏi mọi dấu vết.
      if (!process.stdout.write(`${dong}\n`)) {
        console.error("[mcp] stdout day — may khach dang khong doc");
      }
    },
    ghiLog: (dong) => {
      console.error(dong);
    },
  });

  process.stdin.on("data", (chunk: Buffer) => {
    vongLap.nhan(chunk);
  });
  // Một lỗi EIO/EPIPE trên stdio là một sự kiện vận hành, không phải một ngoại lệ không ai bắt.
  process.stdin.on("error", (e: unknown) => {
    console.error(`[mcp] stdin loi — ${moTaLoi(e)}`);
  });
  process.stdout.on("error", (e: unknown) => {
    console.error(`[mcp] stdout loi — ${moTaLoi(e)}`);
  });
  process.stdin.on("end", () => {
    // `process.exit(0)` không xả bộ đệm stdout bất đồng bộ: các phản hồi đang chờ ghi bị cắt
    // (lượt soi 69 L-2). Đặt mã thoát rồi để vòng lặp sự kiện cạn tự nhiên.
    process.exitCode = 0;
  });

  // Dòng này cố ý KHÔNG nhắc tới cookie phiên, kể cả độ dài của nó.
  console.error(`[mcp] san sang tren stdio — api: ${ch.apiBaseUrl}, cong cu: CHI DOC`);

  const dungLai = (tinHieu: string): void => {
    console.error(`[mcp] nhan ${tinHieu}, dang dung...`);
    // Ngừng nhận việc mới, rồi để các phản hồi đang bay ghi xong — cùng lý do với nhánh `end`.
    process.stdin.pause();
    process.exitCode = 0;
  };
  process.once("SIGTERM", () => {
    dungLai("SIGTERM");
  });
  process.once("SIGINT", () => {
    dungLai("SIGINT");
  });
}

void chinh();
