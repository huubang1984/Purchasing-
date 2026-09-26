// ==============================================================================================
// apps/web/src/main.ts — ĐIỂM VÀO CỦA TIẾN TRÌNH `web`
//
//   pnpm web:dev        (node --experimental-transform-types, xem package.json gốc)
//
// Cùng ba việc với `apps/api/src/main.ts`: đọc môi trường, dựng, nghe tín hiệu dừng. Không
// nghiệp vụ. Log chỉ nêu TÊN biến khi cấu hình hỏng, không nêu giá trị.
//
// Dòng log cuối cùng nói ra thứ mà người vận hành LUÔN quên và chỉ phát hiện ở màn đăng nhập của
// nhà cung cấp: origin của trang này phải nằm trong `TRUSTPROCURE_ALLOWED_ORIGINS` của `apps/api`,
// nếu không mọi yêu cầu không-GET sẽ bị api trả 403 vì phòng vệ CSRF.
// ==============================================================================================

import { CauHinhError, docCauHinh } from "./cau-hinh.js";
import { docTls, taoWebServer } from "./phuc-vu.js";

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
    console.error(`[web] cau hinh khong hop le — ${moTaLoi(e)}`);
    process.exitCode = 1;
    return;
  }

  let server;
  try {
    server = taoWebServer({
      apiOrigin: ch.apiOrigin,
      tls: ch.tls === null ? null : docTls(ch.tls.certPath, ch.tls.keyPath),
    });
  } catch (e) {
    console.error(`[web] khong khoi dong duoc — ${moTaLoi(e)}`);
    process.exitCode = 1;
    return;
  }

  server.listen(ch.listenPort, ch.listenHost, () => {
    const giaoThuc = ch.tls === null ? "http" : "https";
    const goc = `${giaoThuc}://${ch.listenHost}:${ch.listenPort}`;
    if (ch.apiOrigin === null) {
      // [ADR-068] Sau ALB: TLS và định tuyến /api/* là việc của hạ tầng, nên không có cảnh báo HTTP nào ở đây.
      console.error(`[web] dang nghe ${goc} — CHI TINH, /api/* do reverse proxy dinh tuyen`);
      return;
    }
    console.error(`[web] dang nghe ${goc} — chuyen tiep /api/* toi ${ch.apiOrigin}`);
    console.error(`[web] apps/api phai co ${goc} trong TRUSTPROCURE_ALLOWED_ORIGINS, neu khong moi POST bi 403`);
    if (ch.tls === null && ch.listenHost !== "127.0.0.1" && ch.listenHost !== "localhost") {
      // Không phải một cảnh báo trang trí: cookie phiên khách mang `Secure`, và trình duyệt vứt
      // nó ở mọi origin http: không phải localhost. Triệu chứng là "bấm xác minh xong không có
      // gì xảy ra" — mất hàng giờ nếu không ai nói trước.
      console.error("[web] CANH BAO: dang chay HTTP tren mot dia chi khong phai localhost — cookie phien khach mang Secure va se bi trinh duyet VUT");
    }
  });

  const dungLai = (tinHieu: string): void => {
    console.error(`[web] nhan ${tinHieu}, dang dung...`);
    server.close(() => {
      console.error("[web] da dung");
      process.exit(0);
    });
  };
  process.once("SIGTERM", () => dungLai("SIGTERM"));
  process.once("SIGINT", () => dungLai("SIGINT"));
}

chinh();
