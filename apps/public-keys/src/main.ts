// ==============================================================================================
// apps/public-keys/src/main.ts — ĐIỂM VÀO CỦA TIẾN TRÌNH CÔNG BỐ KHOÁ (ADR-070)
//
//   pnpm public-keys:dev   (node --experimental-transform-types, xem package.json gốc)
//
// Đọc môi trường, dựng tài liệu MỘT LẦN, nghe tín hiệu dừng. In dấu vân tay của mọi khoá lúc khởi động: người
// vận hành so chúng với bản đã neo ở bucket audit mà không phải gọi endpoint.
// ==============================================================================================

import { CauHinhError, docCauHinh } from "./cau-hinh.js";
import { RECEIPT_KEYS_PATH, buildReceiptKeyDocumentTuKhoaCongKhai, createReceiptKeyServerTuTaiLieu } from "./index.js";

function moTaLoi(e: unknown): string {
  if (e instanceof CauHinhError) return e.message;
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return "loi khong ro";
}

function chinh(): void {
  let ch;
  try {
    ch = docCauHinh(process.env);
  } catch (e) {
    console.error(`[public-keys] cau hinh khong hop le — ${moTaLoi(e)}`);
    process.exitCode = 1;
    return;
  }
  const taiLieu = buildReceiptKeyDocumentTuKhoaCongKhai(ch.activeKeyId, ch.publicKeys);
  const server = createReceiptKeyServerTuTaiLieu(taiLieu);
  server.listen(ch.listenPort, ch.listenHost, () => {
    console.error(`[public-keys] dang nghe http://${ch.listenHost}:${ch.listenPort}${RECEIPT_KEYS_PATH}`);
    for (const k of taiLieu.keys) {
      console.error(`[public-keys] kid=${k.kid}${k.kid === taiLieu.activeKeyId ? " (dang dung)" : ""} sha256=${k.fingerprint}`);
    }
  });
  const dungLai = (tinHieu: string): void => {
    console.error(`[public-keys] nhan ${tinHieu}, dang dung...`);
    server.close(() => process.exit(0));
  };
  process.once("SIGTERM", () => dungLai("SIGTERM"));
  process.once("SIGINT", () => dungLai("SIGINT"));
}

chinh();
