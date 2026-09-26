// ==============================================================================================
// tools/neo-so-kiem-toan/src/canh-moc-neo.ts — [ADR-084] CANH MỐC NEO THEO TỪNG TỔ CHỨC, CHẠY Ở TÀI KHOẢN AUDIT
//
// Lambda `tp-canh-moc-neo` (stack 60) chạy mỗi 6 giờ, CHỈ ĐỌC bucket neo: liệt kê mọi tổ chức từng được neo
// (`so-kiem-toan/<org>/`), và với mỗi tổ chức hỏi "có đối tượng nào ghi trong 36 giờ qua không". Không có ⇒ một dòng log
// `THIEU MOC NEO` — metric filter của stack 60 đếm dòng ấy, alarm gửi thư.
//
// Vì sao ở audit, không ở job `lich` (prod): job thoát 1 khi một tổ chức XUẤT hỏng (cảnh báo ⑶), và alarm ⑷ báo khi CẢ
// bucket im 36 giờ. Còn lại một ca cả hai không thấy: một tổ chức bị BỎ KHỎI danh sách mà job vẫn thoát 0 — hàm liệt kê
// ở prod bị sửa, hay một lỗi làm rơi một tổ chức. Phép đo ấy phải đứng NGOÀI prod thì prod mới không tắt được nó.
//
// Cách hỏi, một lời gọi mỗi tổ chức: khoá mốc neo là `<ms 15 chữ số>-<băm>.json` (aws.ts), nên
// `ListObjectsV2(StartAfter = so-kiem-toan/<org>/<mốc cắt 15 chữ số>)` trả đúng những đối tượng có TÊN mới hơn mốc cắt.
// Tên do người ghi đặt — một đối tượng mang tên "tương lai" sẽ luôn lọt qua mốc cắt — nên phán xử bằng `LastModified`
// (S3 đặt, người ghi không chọn được): chỉ đếm đối tượng có `LastModified` ≥ mốc cắt.
//
// Tệp này là NGUỒN; thứ chạy trên Lambda là `lambda/canh-moc-neo.mjs` = chính tệp này gỡ kiểu bằng
// `module.stripTypeScriptTypes` của Node (`pnpm neo:dong-goi-lambda`). `canh-moc-neo.test.ts` đòi hai tệp trùng byte.
// Chỉ phụ thuộc `@aws-sdk/client-s3` — có sẵn trong runtime Node.js của Lambda, không đóng gói node_modules.
// ==============================================================================================

import { ListObjectsV2Command, S3Client, type ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";

export const TIEN_TO_SO_NEO = "so-kiem-toan/";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const GIO_MS = 3_600_000;

export interface S3ChiDoc {
  send(lenh: ListObjectsV2Command): Promise<ListObjectsV2CommandOutput>;
}

export interface KetQuaToChuc {
  readonly org: string;
  /** Có ít nhất một đối tượng `LastModified` ≥ mốc cắt. */
  readonly moi: boolean;
}

/** Mọi tổ chức từng có mốc neo — thư mục con của `so-kiem-toan/`. Tên thư mục không phải UUID ⇒ ném: bucket có rác. */
export async function lietKeToChucDaNeo(s3: S3ChiDoc, bucket: string): Promise<string[]> {
  const org: string[] = [];
  let tiep: string | undefined;
  do {
    const ra = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: TIEN_TO_SO_NEO, Delimiter: "/", ContinuationToken: tiep }),
    );
    for (const p of ra.CommonPrefixes ?? []) {
      const ten = (p.Prefix ?? "").slice(TIEN_TO_SO_NEO.length).replace(/\/$/u, "");
      if (!UUID.test(ten)) throw new Error(`thu muc la duoi ${TIEN_TO_SO_NEO}: khong phai UUID`);
      org.push(ten);
    }
    tiep = ra.IsTruncated === true ? ra.NextContinuationToken : undefined;
  } while (tiep !== undefined);
  return org;
}

/** Tổ chức `org` có mốc neo ghi sau `mocCatMs` không — theo `LastModified`, không theo tên. */
export async function coMocNeoMoi(s3: S3ChiDoc, bucket: string, org: string, mocCatMs: number): Promise<boolean> {
  const tienTo = `${TIEN_TO_SO_NEO}${org}/`;
  let tiep: string | undefined;
  do {
    const ra = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: tienTo,
        StartAfter: `${tienTo}${String(Math.max(0, mocCatMs)).padStart(15, "0")}`,
        ContinuationToken: tiep,
      }),
    );
    for (const o of ra.Contents ?? []) {
      if (o.LastModified !== undefined && o.LastModified.getTime() >= mocCatMs) return true;
    }
    tiep = ra.IsTruncated === true ? ra.NextContinuationToken : undefined;
  } while (tiep !== undefined);
  return false;
}

export async function kiemMocNeo(
  s3: S3ChiDoc,
  bucket: string,
  bayGioMs: number,
  nguongGio: number,
): Promise<KetQuaToChuc[]> {
  const mocCat = bayGioMs - nguongGio * GIO_MS;
  const ketQua: KetQuaToChuc[] = [];
  for (const org of await lietKeToChucDaNeo(s3, bucket)) {
    ketQua.push({ org, moi: await coMocNeoMoi(s3, bucket, org, mocCat) });
  }
  return ketQua;
}

/** Các dòng log — hợp đồng với metric filter của stack 60 (`hinh-dang-canh-moc-neo.test.ts` so hai phía). */
export function dongLog(ketQua: readonly KetQuaToChuc[], nguongGio: number): string[] {
  const thieu = ketQua.filter((k) => !k.moi);
  return [
    ...thieu.map((k) => `canh-moc-neo: ${k.org} THIEU MOC NEO trong ${String(nguongGio)} gio`),
    `canh-moc-neo: ${String(ketQua.length)} to chuc, ${String(thieu.length)} thieu`,
  ];
}

export function docNguongGio(giaTri: string | undefined): number {
  if (giaTri === undefined || giaTri === "") return 36;
  if (!/^[1-9][0-9]{0,3}$/u.test(giaTri)) throw new Error("NGUONG_GIO phai la so nguyen duong");
  return Number(giaTri);
}

/** Điểm vào Lambda. Lỗi thì NÉM — số lần lỗi của hàm có alarm riêng ở stack 60; nuốt lỗi là một phép canh câm. */
export async function handler(): Promise<{ toChuc: number; thieu: number }> {
  const bucket = process.env["BUCKET_NEO"];
  if (bucket === undefined || bucket === "") throw new Error("thieu BUCKET_NEO");
  const nguongGio = docNguongGio(process.env["NGUONG_GIO"]);
  const ketQua = await kiemMocNeo(new S3Client({}), bucket, Date.now(), nguongGio);
  for (const d of dongLog(ketQua, nguongGio)) console.log(d);
  return { toChuc: ketQua.length, thieu: ketQua.filter((k) => !k.moi).length };
}
