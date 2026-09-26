// ==============================================================================================
// apps/public-keys/src/tien-trinh.ts — DỰNG NGUỒN KHOÁ, RỒI MỚI MỞ CỔNG
//
// [S1.128 / khoản 15] Thứ tự là bảo đảm: nguồn khoá dựng XONG (mọi `kid` đã qua `GetPublicKey` và
// đã kiểm) thì mới `listen`. Một nguồn lỗi hay treo ⇒ hàm này ném và KHÔNG cổng nào được mở — một
// dịch vụ công bố nửa bộ khoá còn tệ hơn một dịch vụ không lên, vì cái sau có người thấy.
//
// Client KMS được ĐÓNG ngay sau khi chụp khoá, dù thành hay bại: tiến trình đang phục vụ không giữ
// kết nối, chứng chỉ phiên hay khả năng gọi KMS nào ngoài lúc khởi động.
//
// `KMSClient` KHÔNG được import ở đây — nó được tiêm (`taoClientKms`) từ `main.ts`, để mọi nhánh
// của tệp này đo được bằng KMS giả mà không một lời gọi mạng nào.
// ==============================================================================================

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { assertLocalDevAllowed } from "@trustprocure/crypto-keys";
import type { KmsDocKhoaCongKhai } from "@trustprocure/bidding";
import type { CauHinhPublicKeys } from "./cau-hinh.js";
import { NguonKhoaError, type NguonKhoaCongKhai } from "./nguon.js";
import { dungNguonKhoaKms } from "./nguon-kms.js";
import { buildReceiptKeyDocument, createReceiptKeyServer, type ReceiptKeyDocument } from "./index.js";

/** Mặt tối thiểu của `KMSClient` mà tiến trình này cần: đọc khoá công khai, rồi đóng. */
export interface ClientKmsCongBo extends KmsDocKhoaCongKhai {
  destroy(): void;
}

export interface PhuThuocTienTrinh {
  readonly taoClientKms: (region: string) => ClientKmsCongBo;
  /** Trần cho TOÀN BỘ lượt `GetPublicKey` lúc khởi động. Mặc định 15 s. */
  readonly hanKmsMs?: number;
  /** Chỗ mở cổng — tiêm được để test đo rằng nó KHÔNG được gọi khi nguồn lỗi. */
  readonly nghe?: (server: Server, host: string, port: number) => Promise<void>;
}

export interface TienTrinhPublicKeys {
  readonly diaChi: AddressInfo;
  readonly taiLieu: ReceiptKeyDocument;
  dung(): Promise<void>;
}

const HAN_KMS_MAC_DINH = 15_000;

function ngheMacDinh(server: Server, host: string, port: number): Promise<void> {
  return new Promise((xong, hong) => {
    server.once("error", hong);
    server.listen(port, host, () => {
      server.off("error", hong);
      xong();
    });
  });
}

async function coHan<T>(viec: Promise<T>, ms: number): Promise<T> {
  let hen: NodeJS.Timeout | undefined;
  const het = new Promise<never>((_, hong) => {
    hen = setTimeout(() => {
      hong(new NguonKhoaError(`aws-kms: GetPublicKey quá hạn ${String(ms)}ms lúc khởi động`));
    }, ms);
  });
  try {
    return await Promise.race([viec, het]);
  } finally {
    clearTimeout(hen);
  }
}

/** Nguồn khoá theo adapter. `local-dev` đi qua hàng rào `assertLocalDevAllowed` và không chạm KMS. */
export async function dungNguon(ch: CauHinhPublicKeys, phuThuoc: PhuThuocTienTrinh): Promise<NguonKhoaCongKhai> {
  if (ch.keyAdapter === "local-dev") {
    assertLocalDevAllowed();
    const { active, publicKeys } = ch.receiptKeys;
    return { activeKeyId: active, publicKeys: () => new Map([...publicKeys].map(([kid, b]) => [kid, new Uint8Array(b)])) };
  }
  const client = phuThuoc.taoClientKms(ch.kms.region);
  try {
    return await coHan(
      dungNguonKhoaKms({ client, khoa: ch.kms.khoa, activeKid: ch.kms.activeKid }),
      phuThuoc.hanKmsMs ?? HAN_KMS_MAC_DINH,
    );
  } finally {
    client.destroy();
  }
}

export async function khoiDongPublicKeys(ch: CauHinhPublicKeys, phuThuoc: PhuThuocTienTrinh): Promise<TienTrinhPublicKeys> {
  const nguon = await dungNguon(ch, phuThuoc);
  const taiLieu = buildReceiptKeyDocument(nguon);
  const server = createReceiptKeyServer(nguon);
  await (phuThuoc.nghe ?? ngheMacDinh)(server, ch.listenHost, ch.listenPort);
  return {
    diaChi: server.address() as AddressInfo,
    taiLieu,
    dung: () =>
      new Promise<void>((xong) => {
        server.close(() => {
          xong();
        });
        server.closeAllConnections();
      }),
  };
}
