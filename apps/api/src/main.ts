// ==============================================================================================
// apps/api/src/main.ts — ĐIỂM VÀO CỦA TIẾN TRÌNH `api`
//
//   pnpm api:dev        (node --experimental-transform-types, xem package.json gốc)
//
// Ba việc, và chỉ ba: đọc `process.env` thành cấu hình (`cau-hinh.ts`), dựng tiến trình
// (`composition.ts`), nghe tín hiệu dừng. Không nghiệp vụ, không CSDL, không HTTP ở đây.
//
// LOG: dự án chỉ cho phép `console.error` (eslint `no-console`), và mọi dòng ở đây đều là THÔNG
// BÁO VẬN HÀNH — không dòng nào mang giá trị của một biến môi trường. `CauHinhError` chỉ nêu TÊN
// biến (cau-hinh.ts quy tắc ⑵); lỗi khởi động khác được in `name` và `message` (một lỗi kết nối pg
// nói "password authentication failed for user X", không nói mật khẩu) — không stack.
// ==============================================================================================

import { CauHinhError, docCauHinh } from "./cau-hinh.js";
import { taoTienTrinhApi } from "./composition.js";

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
    console.error(`[api] cau hinh khong hop le — ${moTaLoi(e)}`);
    process.exitCode = 1;
    return;
  }
  // [review H3-5] `taoTienTrinhApi` cũng nằm TRONG try: nó ném đồng bộ (createPool từ chối URL, hàng
  // rào local-dev, mkdir hộp thư) và một lỗi thoát khỏi đây thành unhandled rejection — Node in nguyên
  // object kèm stack, đi vòng qua `moTaLoi`.
  let tienTrinh;
  let diaChi;
  try {
    tienTrinh = taoTienTrinhApi(ch);
    diaChi = await tienTrinh.batDau();
  } catch (e) {
    console.error(`[api] khong khoi dong duoc — ${moTaLoi(e)}`);
    await tienTrinh?.dung();
    process.exitCode = 1;
    return;
  }
  console.error(
    `[api] dang nghe http://${diaChi.host}:${diaChi.port} — khoa: ${ch.keyAdapter}, bo gui: ${ch.senderAdapter}, ` +
      `origin duoc phep: ${ch.allowedOrigins.length}`,
  );

  const dungLai = (tinHieu: string): void => {
    console.error(`[api] nhan ${tinHieu}, dang dung...`);
    tienTrinh.dung().then(
      () => {
        console.error("[api] da dung");
        process.exit(0);
      },
      (e: unknown) => {
        console.error(`[api] dung khong sach — ${moTaLoi(e)}`);
        process.exit(1);
      },
    );
  };
  process.once("SIGTERM", () => dungLai("SIGTERM"));
  process.once("SIGINT", () => dungLai("SIGINT"));
}

void chinh();
