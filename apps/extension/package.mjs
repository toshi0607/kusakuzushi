import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// バージョンは manifest.json が正。ウェブストアはアップロードのたびに
// manifest の version が前回より大きいことを要求するので、ここを読み違えると
// 「同じバージョンは受け付けない」で弾かれる。
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const zip = path.resolve(`kusakuzushi-extension-${manifest.version}.zip`);

try {
  await rm(zip, { force: true });
  // zip のルートに manifest.json が来る必要がある(dist/ を包んだ zip は拒否される)。
  // -X は macOS の拡張属性を落とすため。
  await run("zip", ["-r", "-X", "-q", zip, ".", "-x", ".*", "-x", "__MACOSX/*"], {
    cwd: "dist",
  });
  const { stdout } = await run("unzip", ["-l", zip]);
  console.log(stdout.trim());
  console.log(`\npackaged ${path.relative(process.cwd(), zip)}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
