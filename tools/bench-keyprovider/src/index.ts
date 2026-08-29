import { randomBytes, randomUUID } from "node:crypto";
import { createLocalDevWrapper, MasterKeyRing } from "@trustprocure/crypto-keys";
import { createLocalDevUnwrapper } from "@trustprocure/crypto-keys/unwrap";

const SO_LAN = Number(process.env["BENCH_ITERATIONS"] ?? 10_000);

async function main(): Promise<void> {
  const ring = new MasterKeyRing("v1", { v1: randomBytes(32) });
  const wrapper = createLocalDevWrapper(ring);
  const unwrapper = createLocalDevUnwrapper(ring);
  const orgId = randomUUID();
  const plaintext = randomBytes(32);

  const batDauBoc = performance.now();
  const envelopes = [];
  for (let i = 0; i < SO_LAN; i += 1) envelopes.push(await wrapper.wrap(orgId, plaintext));
  const msBoc = performance.now() - batDauBoc;

  const batDauMo = performance.now();
  for (const envelope of envelopes) await unwrapper.unwrap(orgId, envelope);
  const msMo = performance.now() - batDauMo;

  console.log(`Provider        : ${wrapper.name}`);
  console.log(`Số lần          : ${SO_LAN}`);
  console.log(`Bọc khóa        : ${msBoc.toFixed(0)} ms  (${(SO_LAN / (msBoc / 1000)).toFixed(0)} thao tác/giây)`);
  console.log(`Mở khóa         : ${msMo.toFixed(0)} ms  (${(SO_LAN / (msMo / 1000)).toFixed(0)} thao tác/giây)`);
  console.log("");
  console.log("Tham chiếu: RFQ 50 nhà cung cấp x 200 hạng mục = 10.000 lần mở khóa.");
  console.log("Adapter KMS thật sẽ chậm hơn nhiều bậc vì mỗi lần là một lời gọi mạng —");
  console.log("khi thêm adapter đó, chạy lại benchmark này trước khi bắt đầu S1.6.");
}

await main();
