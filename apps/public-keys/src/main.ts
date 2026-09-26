// ==============================================================================================
// apps/public-keys/src/main.ts — ĐIỂM VÀO CỦA TIẾN TRÌNH CÔNG BỐ KHOÁ CÔNG KHAI KÝ BIÊN NHẬN
//
//   pnpm public-keys:dev        (node --experimental-transform-types, xem package.json gốc)
//
// [S1.128 / khoản 15] Ba việc, và chỉ ba: đọc `process.env` thành cấu hình (`cau-hinh.ts`), dựng
// nguồn khoá rồi mở cổng (`tien-trinh.ts`), nghe tín hiệu dừng. `KMSClient` được dựng ở ĐÂY và chỉ
// ở đây — `tien-trinh.ts` nhận nó qua tiêm, nên mọi nhánh của nó đo được bằng KMS giả.
//
// LOG: dự án chỉ cho phép `console.error`. Không dòng nào mang GIÁ TRỊ của một biến môi trường —
// `CauHinhError` chỉ nêu TÊN biến; lỗi khác in `name: message`, không stack, không `cause` (một
// lỗi SDK có thể mang ARN của CMK). Dòng khởi động in `kid` và dấu vân tay: cả hai là CÔNG KHAI, và
// dấu vân tay trong log là thứ người vận hành đối chiếu với bản đã neo ra ngoài.
// ==============================================================================================

import { KMSClient } from "@aws-sdk/client-kms";
import { CauHinhError, docCauHinh } from "./cau-hinh.js";
import { khoiDongPublicKeys } from "./tien-trinh.js";

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
    console.error(`[public-keys] cau hinh khong hop le — ${moTaLoi(e)}`);
    process.exitCode = 1;
    return;
  }

  let tienTrinh;
  try {
    tienTrinh = await khoiDongPublicKeys(ch, { taoClientKms: (region) => new KMSClient({ region }) });
  } catch (e) {
    console.error(`[public-keys] khong khoi dong duoc — ${moTaLoi(e)}`);
    process.exitCode = 1;
    return;
  }

  const { diaChi, taiLieu } = tienTrinh;
  for (const k of taiLieu.keys) {
    console.error(`[public-keys] kid ${k.kid}${k.kid === taiLieu.activeKeyId ? " (dang dung)" : ""} sha256 ${k.fingerprint}`);
  }
  console.error(`[public-keys] adapter ${ch.keyAdapter}, dang nghe ${diaChi.address}:${String(diaChi.port)}`);

  const dungLai = (tinHieu: string): void => {
    console.error(`[public-keys] nhan ${tinHieu}, dang dung...`);
    tienTrinh.dung().then(
      () => {
        process.exit(0);
      },
      (e: unknown) => {
        console.error(`[public-keys] dung khong sach — ${moTaLoi(e)}`);
        process.exit(1);
      },
    );
  };
  process.once("SIGTERM", () => dungLai("SIGTERM"));
  process.once("SIGINT", () => dungLai("SIGINT"));
}

void chinh();
