// ==============================================================================================
// ENTRY POINT CỦA MỐC NEO NGOÀI — `xuat` và `kiem`
//
// [khoản nợ 11 và 30, S1.17] Sổ nợ ghi năm thứ còn thiếu: *"không exporter, không lịch, không nơi
// cất, không chữ ký, không entry point"*. File này là **entry point** và **exporter**; nơi cất và
// chữ ký ở `packages/audit`. Cái còn thiếu sau vòng này là **LỊCH**, và nó không thiếu vì quên —
// một cái lịch là một tiến trình chạy ở một nơi đã triển khai, và dự án chưa triển khai ở đâu.
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO DANH SÁCH TỔ CHỨC PHẢI DO NGƯỜI VẬN HÀNH GÕ VÀO
// ----------------------------------------------------------------------------------------------
// Không phải vì tiện. `app_api` KHÔNG đọc được danh sách tổ chức — cùng ràng buộc đã buộc runner
// outbox nhận `listOrganizations` từ composition root (ADR-022), và bản cài đặt hôm nay của tuỳ
// chọn ấy là *"tổ chức tiến trình ĐÃ THẤY enqueue"*, một tập KHÔNG phủ hết. Một bộ xuất tự đoán
// danh sách sẽ im lặng bỏ sót đúng những tổ chức ít hoạt động nhất — và một tổ chức không được
// neo thì `verifyAuditChain` trả `NOT_ANCHORED`, tức mất trắng bảo đảm chứ không suy giảm dần.
//
// Nên danh sách là THAM SỐ, và nó là một sự thật vận hành phải viết ra ở đâu đó. Xem ADR-026 §5.
//
// ----------------------------------------------------------------------------------------------
// KHOÁ KÝ ĐỌC TỪ MÔI TRƯỜNG, VÀ ĐÓ LÀ MỘT KHIẾM KHUYẾT ĐÃ BIẾT
// ----------------------------------------------------------------------------------------------
// Bản hôm nay đọc khoá riêng từ `TRUSTPROCURE_NEO_KHOA_RIENG` (PKCS8 DER, base64) và đi qua
// `assertLocalDevAllowed`, nên nó KHÔNG chạy được ở production nếu không có cờ ghi đè tường minh.
// Môi trường thật ký bằng AWS KMS (ADR-009/ADR-026 §3), nơi khoá riêng không rời khỏi dịch vụ —
// và ở đó ràng buộc *"role deploy không ký được mốc neo"* trở thành một chính sách IAM đọc được
// thay vì một câu trong tài liệu này.
// ==============================================================================================

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { argv, env, exit, stderr, stdout } from "node:process";
import {
  createFileAnchorStore,
  exportChainHead,
  loadVerifiedAnchors,
  parseAnchorText,
  verifyAuditChain,
  type AnchorStore,
  type ExternalAnchor,
  type SignedAnchorRecord,
} from "@trustprocure/audit";
import {
  AnchorSigningKeyRing,
  createLocalDevAnchorSigner,
  type AnchorSigner,
} from "@trustprocure/audit/anchor-sign";
import { createPool } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";

// [review lượt 9 — H9-8] In ĐÚNG dòng lệnh chạy được, không in một tên lệnh không tồn tại. Bản
// đầu in `neo-so-kiem-toan xuat ...` — một lệnh không có `bin`, không có script workspace, tức
// đúng lớp lỗi của khoản nợ 23 (một entry point mà người cầm lên không chạy được). Script gốc
// `pnpm neo` là thứ đã được đo bởi `cong-cu.int.test.ts`.
const CACH_DUNG = `Cách dùng:
  pnpm neo khoi-tao
  pnpm neo xuat --org <uuid> [--org <uuid> ...]
  pnpm neo kiem --org <uuid> [--org <uuid> ...]
  pnpm neo trich --org <uuid> --ra <thu-muc> [--seq <n>]

Biến môi trường:
  DATABASE_URL                     bắt buộc
  TRUSTPROCURE_NEO_KHO             thư mục nơi cất (bắt buộc)
  TRUSTPROCURE_NEO_KID             định danh khoá ký (chỉ cần cho "xuat")
  TRUSTPROCURE_NEO_KHOA_RIENG      PKCS8 DER, base64 (chỉ cần cho "xuat")
  TRUSTPROCURE_NEO_KHOA_CONG_KHAI  SPKI DER, base64 — "<kid>=<base64>", lặp lại bằng dấu phẩy

  "trich" tách một mốc neo thành ba tệp mà openssl(1) đọc thẳng. Nó KHÔNG cần DATABASE_URL.
`;

type Lenh = "khoi-tao" | "xuat" | "kiem" | "trich";

function batBuoc(ten: string): string {
  const gt = env[ten];
  if (gt === undefined || gt.trim() === "") throw new Error(`Thiếu biến môi trường ${ten}.`);
  return gt.trim();
}

/**
 * Đọc vòng khoá CÔNG KHAI của kiểm toán viên.
 *
 * Dạng `<kid>=<base64 SPKI DER>`, nhiều mục cách nhau bằng dấu phẩy — nhiều mục vì khoá cũ KHÔNG
 * được gỡ: một mốc neo ký năm ngoái vẫn phải kiểm được năm nay.
 */
function docKhoaCongKhai(): ReadonlyMap<string, Uint8Array> {
  const m = new Map<string, Uint8Array>();
  for (const muc of batBuoc("TRUSTPROCURE_NEO_KHOA_CONG_KHAI").split(",")) {
    const moc = muc.indexOf("=");
    if (moc <= 0) throw new Error(`Mục khoá công khai sai dạng: "${muc}" (cần <kid>=<base64>).`);
    m.set(muc.slice(0, moc).trim(), Buffer.from(muc.slice(moc + 1).trim(), "base64"));
  }
  return m;
}

function docBoKy(): AnchorSigner {
  const kid = batBuoc("TRUSTPROCURE_NEO_KID");
  const congKhai = docKhoaCongKhai().get(kid);
  if (congKhai === undefined) {
    // Bộ ký cần cả hai nửa để dựng vòng khoá, và đòi nửa công khai ở đây mua thêm một thứ: người
    // vận hành buộc phải công bố khoá công khai TRƯỚC khi ký mốc neo đầu tiên. Một artefact
    // không ai kiểm được là một artefact không có giá trị.
    throw new Error(
      `TRUSTPROCURE_NEO_KHOA_CONG_KHAI không có mục cho kid "${kid}" — công bố nửa công khai ` +
        "trước, ký sau.",
    );
  }
  const ring = new AnchorSigningKeyRing(kid, {
    [kid]: {
      privateKey: Buffer.from(batBuoc("TRUSTPROCURE_NEO_KHOA_RIENG"), "base64"),
      publicKey: congKhai,
    },
  });
  return createLocalDevAnchorSigner(ring);
}

function docDanhSachToChuc(thamSo: readonly string[]): readonly string[] {
  const org: string[] = [];
  for (let i = 0; i < thamSo.length; i += 1) {
    if (thamSo[i] === "--org") {
      const gt = thamSo[i + 1];
      if (gt === undefined) throw new Error("--org thiếu giá trị.");
      org.push(gt);
      i += 1;
      continue;
    }
    throw new Error(`Tham số lạ: "${thamSo[i]}".`);
  }
  if (org.length === 0) throw new Error("Phải nêu ít nhất một --org.");
  return org;
}

/** `seq` lớn nhất trong số các mốc neo ĐÃ KIỂM ĐƯỢC của một tổ chức; `0` nếu chưa có mốc nào. */
function mocNuocCao(neo: readonly ExternalAnchor[]): number {
  return neo.reduce((cao, n) => (n.seq > cao ? n.seq : cao), 0);
}

async function xuat(kho: AnchorStore, org: readonly string[]): Promise<number> {
  const boKy = docBoKy();
  const khoaCongKhai = docKhoaCongKhai();
  const pool = createPool(batBuoc("DATABASE_URL"), 2, { role: "app_api" });
  let soHong = 0;
  try {
    for (const id of org) {
      // [review lượt 9 — H9-7] Bọc TỪNG tổ chức. Không có vế này, một bản ghi hỏng ở tổ chức đầu
      // biến một lượt 50 tổ chức thành một dòng lỗi duy nhất — và nếu ai đó "vá" bằng cách bỏ tổ
      // chức ấy ra khỏi danh sách thì tổ chức bị tấn công là tổ chức duy nhất không được neo.
      try {
        // [review lượt 9 — H9-1 ⑵] Đọc nơi cất TRƯỚC khi ghi. `loadVerifiedAnchors` fail-closed
        // trên mọi bản ghi hỏng, nên mốc nước cao dưới đây chỉ tính trên những mốc neo ĐÃ KIỂM.
        const daCo = await loadVerifiedAnchors(kho, id, khoaCongKhai);
        const cao = mocNuocCao(daCo);

        const dau = await withTenant(pool, id, (client) => exportChainHead(client, id));
        if (dau === null) {
          // Sổ rỗng KHÔNG phải một lỗi, nhưng nó cũng không được im: một tổ chức không bao giờ
          // được neo là một tổ chức mà `verifyAuditChain` sẽ luôn trả NOT_ANCHORED.
          stdout.write(`${id}\tSO RONG — khong xuat moc neo nao\n`);
          continue;
        }

        // ======================================================================================
        // CHUỖI KHÔNG BAO GIỜ NGẮN LẠI. MỘT LƯỢT XUẤT LÙI LÀ MỘT VỤ CẮT ĐUÔI, KHÔNG PHẢI MỘT SỰ KIỆN
        // ======================================================================================
        // `audit_events.seq` chỉ đi lên. Nên `dau.seq < cao` nghĩa là cái sổ NGẮN ĐI kể từ lần
        // neo trước — và bộ xuất là thứ ở đúng vị trí để nói ra điều đó, vào đúng thời điểm nó
        // xảy ra, thay vì để một mốc neo lùi nằm im trong nơi cất cho tới lần kiểm toán.
        //
        // Ghi tiếp KHÔNG phải là vô hại: với một nơi cất chỉ-ghi-thêm, mốc neo cũ vẫn tố cáo vụ
        // cắt (đo ở `chain.int.test.ts`); nhưng nếu nơi cất vừa bị xoá thì mốc cũ không còn, và
        // lượt ghi này là thứ RỬA vụ cắt thành một gốc tin cậy mới. Từ chối ở đây đóng ca đó.
        if (dau.seq < cao) {
          soHong += 1;
          stderr.write(
            `${id}\tTU CHOI NEO — dau chuoi seq=${dau.seq} LUI so voi moc neo da co seq=${cao}. ` +
              "So kiem toan khong bao gio ngan lai: day la mot vu CAT DUOI, hoac nguon DATABASE_URL " +
              "khong phai co so du lieu da duoc neo truoc do.\n",
          );
          continue;
        }

        await kho.append(id, boKy.sign(dau));
        stdout.write(`${id}\tseq=${dau.seq}\thash=${dau.hashHex}\n`);
      } catch (loi) {
        soHong += 1;
        stderr.write(`${id}\tKHONG XUAT DUOC\t${loi instanceof Error ? loi.message : String(loi)}\n`);
      }
    }
  } finally {
    await pool.end();
  }
  return soHong === 0 ? 0 : 1;
}

async function kiem(kho: AnchorStore, org: readonly string[]): Promise<number> {
  const khoaCongKhai = docKhoaCongKhai();
  const pool = createPool(batBuoc("DATABASE_URL"), 2, { role: "app_api" });
  let soHong = 0;
  try {
    for (const id of org) {
      // [review lượt 9 — H9-7] Một tổ chức không kiểm được KHÔNG được làm mất trạng thái của các
      // tổ chức còn lại. Mã thoát vẫn khác 0 — thứ đổi là lượng thông tin người đọc nhận được.
      try {
        // Mốc neo lấy TỪ NƠI CẤT, không từ cái sổ đang kiểm. Đó là toàn bộ điểm của công cụ này:
        // hai vế của phép đối chiếu phải đến từ hai vùng tin cậy khác nhau.
        const neo = await loadVerifiedAnchors(kho, id, khoaCongKhai);
        const kq = await withTenant(pool, id, (client) =>
          verifyAuditChain(client, id, { externalAnchors: neo }),
        );
        stdout.write(
          `${id}\tok=${String(kq.ok)}\tchecked=${kq.checked}\tneo=${neo.length}\n`,
        );
        for (const vd of kq.problems) {
          stdout.write(`  seq=${vd.seq}\t${vd.kind}\t${vd.detail}\n`);
        }
        if (!kq.ok) soHong += 1;
      } catch (loi) {
        soHong += 1;
        stdout.write(
          `${id}\tKHONG KIEM DUOC\t${loi instanceof Error ? loi.message : String(loi)}\n`,
        );
      }
    }
  } finally {
    await pool.end();
  }
  return soHong;
}

/**
 * Dựng thư mục nơi cất — thao tác TƯỜNG MINH, và đó là toàn bộ lý do nó là một lệnh riêng.
 *
 * [review lượt 9 — H9-1 ⑴] `createFileAnchorStore` cố ý KHÔNG tự `mkdir` ở đường ghi: một nơi cất
 * vừa biến mất mà bộ xuất lặng lẽ dựng lại là một vụ cắt đuôi được rửa sạch. Nên việc dựng nó
 * phải là một hành động có người gõ, một lần, khi đã hiểu vì sao nó vắng mặt.
 */
async function khoiTao(): Promise<number> {
  const thuMuc = batBuoc("TRUSTPROCURE_NEO_KHO");
  await mkdir(thuMuc, { recursive: true });
  stdout.write(`${thuMuc}\tSAN SANG\n`);
  return 0;
}

// ==============================================================================================
// `trich` — TÁCH MỘT MỐC NEO RA KHỎI NƠI CẤT THÀNH BA TỆP MÀ `openssl(1)` ĐỌC THẲNG
//
// [ADR-026 §5⑶ / S1.19] Lượt review thứ chín (H9-9) hạ một câu rộng hơn phép đo ở bốn chỗ:
// *"kiểm toán viên kiểm được artefact này mà không cần một dòng mã nào của chúng ta"*. Thứ đã đo
// khi ấy là chữ ký kiểm được bằng `createVerify` của `node:crypto`. Thứ CHƯA đo là ba thao tác ở
// giữa — tách `text` khỏi dòng JSONL (chuỗi trong tệp mang `\n` ở dạng escape), `base64 -d` cho
// `sig`, và đổi SPKI DER sang PEM. Lệnh này là ba thao tác ấy, và `cong-cu.int.test.ts` chạy
// `openssl` THẬT trên đầu ra của nó.
//
// BA QUYẾT ĐỊNH, mỗi cái đóng một ca hỏng cụ thể:
//
// ⑴ **Không tách khi nơi cất đang hỏng.** `trich` đi qua `loadVerifiedAnchors`, nên một bản ghi
//    không kiểm được ở BẤT KỲ đâu trong tệp làm cả lượt trích ném. Một artefact tách ra từ một nơi
//    cất có bản ghi hỏng là một artefact trông sạch hơn nơi nó đến.
//
// ⑵ **KHÔNG cần `DATABASE_URL`.** Đây không phải sự tiện tay: nếu khâu tách đòi cơ sở dữ liệu thì
//    thứ gọi là "artefact độc lập" vẫn phải đi qua chính hệ thống bị kiểm. Kiểm toán viên cầm tệp
//    JSONL cộng vòng khoá công khai phải dựng lại được ba tệp ấy, và chỉ thế.
//
// ⑶ **PEM dựng bằng cách BỌC base64 chính những byte đã lưu, không đi qua `createPublicKey`.**
//    Cách kia gọn hơn nhưng nó PHÂN TÍCH rồi MÃ HOÁ LẠI, nên PEM đi ra không còn là một bản chép
//    trung thành của thứ nằm trong vòng khoá.
//
//    **PHÉP ĐO ĐÃ BÁC MỘT NỬA LẬP LUẬN BAN ĐẦU CỦA CHỖ NÀY, ghi lại vì nó đắt hơn kết luận.** Bản
//    đầu của khối này viết: *"một SPKI DER lưu sai chút ít sẽ được Node lặng lẽ sửa, còn kiểm toán
//    viên chạy `openssl pkey -pubin -inform DER` thì gãy"*. Đo thật, trên một SPKI P-256 91 byte
//    cộng MỘT byte rác ở cuối:
//      * `createPublicKey({format:"der",type:"spki"})` **NHẬN**, và `export({format:"pem"})` trả
//        về đúng 91 byte — tức nó CHUẨN HOÁ, bỏ byte thừa đi;
//      * `openssl pkey -pubin -inform DER` cũng **NHẬN**, mã thoát 0.
//    Vế *"kiểm toán viên thì gãy"* vì thế **KHÔNG được chứng minh** cho ca này. Thứ lựa chọn này
//    thật sự mua, và chỉ chừng này: **PEM đi ra là bản chép ĐÚNG BYTE của thứ nơi cất đang giữ**,
//    nên nếu một ngày nơi cất giữ thứ mà OpenSSL từ chối, đầu ra tái hiện nó thay vì che nó. Việc
//    có tồn tại một giá trị như thế hay không thì CHƯA đo.
//
// Văn bản ghi ra bằng `Buffer.from(text, "utf8")` chứ không đưa chuỗi thẳng cho `writeFile`: thứ
// được ký là một chuỗi BYTE, và mọi lớp có thể xen vào giữa chuỗi và đĩa đều phải bị loại. Kho này
// chạy với `core.autocrlf=true` — một lần dịch xuống dòng là một chữ ký hỏng, và thông điệp lỗi
// của nó ("Verification failure") giống hệt thông điệp của một chữ ký giả mạo.
// ==============================================================================================

interface ThamSoTrich {
  readonly org: string;
  readonly ra: string;
  readonly seq: number | undefined;
}

function docThamSoTrich(thamSo: readonly string[]): ThamSoTrich {
  let org: string | undefined;
  let ra: string | undefined;
  let seq: number | undefined;
  for (let i = 0; i < thamSo.length; i += 1) {
    const ten = thamSo[i];
    const gt = thamSo[i + 1];
    if (ten !== "--org" && ten !== "--ra" && ten !== "--seq") {
      throw new Error(`Tham số lạ: "${String(ten)}".`);
    }
    if (gt === undefined) throw new Error(`${ten} thiếu giá trị.`);
    if (ten === "--org") {
      if (org !== undefined) throw new Error("trich nhận ĐÚNG MỘT --org: nó tách một mốc neo.");
      org = gt;
    } else if (ten === "--ra") {
      ra = gt;
    } else {
      seq = Number(gt);
      if (!Number.isInteger(seq) || seq <= 0) throw new Error(`--seq phải là số nguyên dương: "${gt}".`);
    }
    i += 1;
  }
  if (org === undefined) throw new Error("Phải nêu --org.");
  if (ra === undefined) throw new Error("Phải nêu --ra <thư mục nhận ba tệp>.");
  return { org, ra, seq };
}

function laBanGhiDaKy(gt: unknown): gt is SignedAnchorRecord {
  if (typeof gt !== "object" || gt === null) return false;
  const o = gt as { text?: unknown; sig?: unknown };
  return typeof o.text === "string" && typeof o.sig === "string";
}

/** SPKI DER → PEM bằng cách BỌC, không phân tích. Xem quyết định ⑶ ở khối trên. */
function pemTuSpkiDer(der: Uint8Array): string {
  if (der.length === 0) throw new Error("Khoá công khai rỗng — không dựng được PEM.");
  const b64 = Buffer.from(der).toString("base64");
  const dong = b64.match(/.{1,64}/g);
  if (dong === null) throw new Error("Không chia được base64 của khoá công khai thành dòng.");
  return `-----BEGIN PUBLIC KEY-----\n${dong.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

async function trich(kho: AnchorStore, ts: ThamSoTrich): Promise<number> {
  const khoaCongKhai = docKhoaCongKhai();

  // Quyết định ⑴: fail-closed trên TOÀN nơi cất, không chỉ trên bản ghi sắp tách.
  const neo = await loadVerifiedAnchors(kho, ts.org, khoaCongKhai);
  const tho = await kho.readAllRaw(ts.org);
  if (tho.length !== neo.length) {
    throw new Error(
      `Nơi cất trả ${tho.length} bản ghi thô nhưng ${neo.length} mốc neo đã kiểm cho tổ chức ` +
        `${ts.org}. Hai con số này phải bằng nhau sau một lượt loadVerifiedAnchors THÀNH CÔNG; ` +
        "lệch nghĩa là nơi cất đổi giữa hai lượt đọc.",
    );
  }
  if (neo.length === 0) {
    throw new Error(
      `Tổ chức ${ts.org} chưa có mốc neo nào trong nơi cất — chạy "pnpm neo xuat" trước.`,
    );
  }

  let i: number;
  if (ts.seq === undefined) {
    i = 0;
    for (let k = 1; k < neo.length; k += 1) if (neo[k]!.seq > neo[i]!.seq) i = k;
  } else {
    const muc = ts.seq;
    i = neo.findIndex((n) => n.seq === muc);
    if (i < 0) {
      // Im lặng lấy mốc gần nhất là ca hỏng tệ nhất ở đây: người vận hành tin họ đang cầm mốc
      // neo của một thời điểm cụ thể, còn tệp trong tay lại là một thời điểm khác.
      throw new Error(
        `Nơi cất không có mốc neo seq=${muc} cho tổ chức ${ts.org}. Các seq đang có: ` +
          `${neo.map((n) => n.seq).join(", ")}.`,
      );
    }
  }

  const banGhi = tho[i];
  if (!laBanGhiDaKy(banGhi)) {
    throw new Error(`Bản ghi ${i + 1} không có hai trường text/sig dạng chuỗi.`);
  }
  const truong = parseAnchorText(banGhi.text);
  const der = khoaCongKhai.get(truong.kid);
  if (der === undefined) throw new Error(`Vòng khoá công khai không có kid "${truong.kid}".`);

  await mkdir(ts.ra, { recursive: true });
  const nen = `neo-${truong.orgId}-seq${truong.seq}`;
  const dVanBan = join(ts.ra, `${nen}.txt`);
  const dChuKy = join(ts.ra, `${nen}.sig`);
  const dKhoa = join(ts.ra, `khoa-${truong.kid}.pem`);

  await writeFile(dVanBan, Buffer.from(banGhi.text, "utf8"));
  await writeFile(dChuKy, Buffer.from(banGhi.sig, "base64"));
  await writeFile(dKhoa, Buffer.from(pemTuSpkiDer(der), "utf8"));

  stdout.write(`${dVanBan}\n${dChuKy}\n${dKhoa}\n`);
  stdout.write(
    `\nopenssl dgst -sha256 -verify "${dKhoa}" -signature "${dChuKy}" "${dVanBan}"\n` +
      "Kết quả mong đợi: Verified OK\n",
  );
  return 0;
}

function laLenh(gt: string | undefined): gt is Lenh {
  return gt === "khoi-tao" || gt === "xuat" || gt === "kiem" || gt === "trich";
}

async function main(): Promise<number> {
  const [lenh, ...thamSo] = argv.slice(2);
  if (!laLenh(lenh)) {
    stderr.write(CACH_DUNG);
    return 2;
  }
  if (lenh === "khoi-tao") return khoiTao();
  const kho = createFileAnchorStore(batBuoc("TRUSTPROCURE_NEO_KHO"));
  // `trich` KHÔNG mở pool và KHÔNG đọc DATABASE_URL — xem khối chú thích của nó, quyết định ⑵.
  if (lenh === "trich") return trich(kho, docThamSoTrich(thamSo));
  const org = docDanhSachToChuc(thamSo);
  return lenh === "xuat" ? xuat(kho, org) : kiem(kho, org);
}

main().then(
  (ma) => exit(ma),
  (loi: unknown) => {
    stderr.write(`${loi instanceof Error ? loi.message : String(loi)}\n`);
    // Mã 1, không phải 0: một lượt xuất hoặc kiểm KHÔNG chạy được không được đọc thành "sổ
    // khoẻ mạnh". Đây là cùng một luật với cổng `pnpm audit` của ci.yml.
    exit(1);
  },
);
