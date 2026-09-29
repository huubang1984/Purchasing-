// ==============================================================================================
// CỤM POSTGRES CỤC BỘ CHO TEST TÍCH HỢP — KHI KHÔNG CÓ DOCKER
//
// `startPostgres()` dựng mỗi tệp `*.int.test.ts` một container `postgres:16-alpine` qua
// Testcontainers. Ở môi trường không có daemon Docker (phiên đám mây, một máy chỉ cài gói
// `postgresql-16`), mọi test tích hợp đều ĐỎ ngay ở bước dựng — tức 72 tệp không đo được gì.
//
// Tệp này là đường thay thế, và nó giữ ĐÚNG hình dạng cô lập của container: MỖI lần gọi là MỘT
// cụm riêng (`initdb` vào một thư mục mới, một cổng mới), không phải một CSDL trong cụm dùng
// chung — vì migration tạo role ở mức cụm (`app_api`, `app_unseal`, …), nên hai tệp test chạy
// cùng lúc trên một cụm sẽ giẫm lên nhau ở đúng chỗ ấy.
//
// CHỈ BẬT KHI CÓ ĐỦ HAI BIẾN MÔI TRƯỜNG; thiếu một là đường container chạy như cũ:
//   TRUSTPROCURE_PG_LOCAL_BIN   thư mục chứa `initdb` và `pg_ctl` (hay shim gọi chúng dưới một
//                               người dùng không phải root — Postgres từ chối chạy dưới root)
//   TRUSTPROCURE_PG_LOCAL_DATA  thư mục cha, ghi được bởi người dùng chạy `initdb`; mỗi cụm là
//                               một thư mục con `tp-<pid>-<ngẫu nhiên>` và bị xoá ở `dung()`
//
// Cụm tắt `fsync`/`synchronous_commit`/`full_page_writes`: dữ liệu test không cần sống sót một
// lần mất điện, và ba cờ ấy là khác biệt DUY NHẤT về cấu hình so với container. Kết nối TCP xác
// thực bằng `scram-sha-256` như container (`--auth-host`), vì có test đo rằng mật khẩu CŨ của một
// vai thôi đăng nhập được sau khi đổi — dưới `trust` phép đo ấy xanh giả. Mật khẩu của `postgres`
// đi qua `--pwfile` (tệp tạm trong thư mục cha, xoá ngay sau `initdb`), không qua dòng lệnh.
// ==============================================================================================
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";

const chay = promisify(execFile);

/** Tên CSDL mà đường container cũng dùng (`withDatabase("trustprocure_test")`). */
const TEN_CSDL = "trustprocure_test";
/** Mật khẩu của `postgres` — cùng giá trị đường container dùng (`withPassword("postgres")`). */
const MAT_KHAU = "postgres";

export interface MayChuPostgres {
  readonly connectionString: string;
  /** Dừng máy chủ và dọn mọi thứ nó để lại trên đĩa. Không ném khi máy chủ đã chết. */
  dung(): Promise<void>;
}

export interface CauHinhCumCucBo {
  readonly bin: string;
  readonly thuMucCha: string;
}

/** Đọc hai biến môi trường; thiếu một là `undefined` — người gọi đi đường container. */
export function cauHinhCumCucBo(): CauHinhCumCucBo | undefined {
  const bin = process.env["TRUSTPROCURE_PG_LOCAL_BIN"];
  const thuMucCha = process.env["TRUSTPROCURE_PG_LOCAL_DATA"];
  if (bin === undefined || bin === "" || thuMucCha === undefined || thuMucCha === "") return undefined;
  return { bin, thuMucCha };
}

/** Hỏi hệ điều hành một cổng TCP đang rảnh trên loopback. */
function congRanh(): Promise<number> {
  return new Promise((giaiQuyet, tuChoi) => {
    const mayChu = createServer();
    mayChu.once("error", tuChoi);
    mayChu.listen(0, "127.0.0.1", () => {
      const diaChi = mayChu.address();
      if (diaChi === null || typeof diaChi === "string") {
        mayChu.close();
        tuChoi(new Error("cụm cục bộ: không lấy được cổng rảnh"));
        return;
      }
      const cong = diaChi.port;
      mayChu.close((loi) => (loi ? tuChoi(loi) : giaiQuyet(cong)));
    });
  });
}

export async function khoiDongCumCucBo(cauHinh: CauHinhCumCucBo): Promise<MayChuPostgres> {
  const thuMucDuLieu = join(cauHinh.thuMucCha, `tp-${process.pid}-${randomBytes(4).toString("hex")}`);
  const initdb = join(cauHinh.bin, "initdb");
  const pgCtl = join(cauHinh.bin, "pg_ctl");

  // `initdb` tự tạo thư mục dữ liệu (và là tiến trình duy nhất đủ quyền để tạo nó khi chạy qua shim).
  // Tệp mật khẩu phải đọc được bởi người dùng chạy `initdb`, có thể khác người dùng chạy test.
  const tepMatKhau = `${thuMucDuLieu}.pw`;
  await writeFile(tepMatKhau, `${MAT_KHAU}\n`, { mode: 0o644 });
  await chmod(tepMatKhau, 0o644);
  try {
    await chay(initdb, [
      "-D", thuMucDuLieu,
      "--auth-host=scram-sha-256", "--auth-local=trust", `--pwfile=${tepMatKhau}`,
      "-U", "postgres", "--no-sync", "-E", "UTF8", "--locale=C.UTF-8",
    ]);
  } finally {
    await rm(tepMatKhau, { force: true });
  }

  const cong = await congRanh();
  const tuyChon = [
    `-p ${cong}`,
    `-k ${thuMucDuLieu}`,
    "-c listen_addresses=127.0.0.1",
    "-c fsync=off",
    "-c synchronous_commit=off",
    "-c full_page_writes=off",
  ].join(" ");
  const dungMayChu = async (): Promise<void> => {
    await chay(pgCtl, ["-D", thuMucDuLieu, "-m", "immediate", "-w", "stop"]).catch(() => undefined);
    await rm(thuMucDuLieu, { recursive: true, force: true });
  };

  try {
    await chay(pgCtl, ["-D", thuMucDuLieu, "-w", "-t", "60", "-l", join(thuMucDuLieu, "postgres.log"), "-o", tuyChon, "start"]);
    const client = new pg.Client({ host: "127.0.0.1", port: cong, user: "postgres", password: MAT_KHAU, database: "postgres" });
    await client.connect();
    try {
      await client.query(`CREATE DATABASE ${TEN_CSDL}`);
    } finally {
      await client.end();
    }
  } catch (loi) {
    await dungMayChu();
    throw loi;
  }

  return {
    connectionString: `postgresql://postgres:${MAT_KHAU}@127.0.0.1:${cong}/${TEN_CSDL}`,
    dung: dungMayChu,
  };
}
