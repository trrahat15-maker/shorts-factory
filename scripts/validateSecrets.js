import "dotenv/config";

const checks = [
  {
    name: "YOUTUBE_CLIENT_ID",
    val: process.env.YOUTUBE_CLIENT_ID,
    want: "ends with .apps.googleusercontent.com",
    ok: (v) => /\.apps\.googleusercontent\.com$/.test(v),
  },
  {
    name: "YOUTUBE_CLIENT_SECRET",
    val: process.env.YOUTUBE_CLIENT_SECRET,
    want: "starts with GOCSPX-",
    ok: (v) => /^GOCSPX-/.test(v),
  },
  {
    name: "YOUTUBE_REFRESH_TOKEN",
    val: process.env.YOUTUBE_REFRESH_TOKEN,
    want: "starts with 1//",
    ok: (v) => /^1\//.test(v),
  },
  {
    name: "OPENAI_API_KEY",
    val: process.env.OPENAI_API_KEY,
    want: "starts with sk- or sk-or-",
    ok: (v) => /^(sk-|sk-or-)/.test(v),
  },
];

let fail = 0;
for (const c of checks) {
  const v = (c.val || "").trim();
  const set = v.length > 0;
  const ok = set && c.ok(v);
  // Only print length + a 6-char prefix (secrets are masked in full by GitHub logs).
  console.log(
    `${c.name}: ${ok ? "✅ OK" : "❌ PROBLEM"} | set=${set} | len=${v.length} | prefix=${v.slice(0, 12)} | expected: ${c.want}`
  );
  if (!ok) fail += 1;
}

const appPin = (process.env.APP_PIN || process.env.PIN || "").trim();
console.log(`APP_PIN: ${appPin.length >= 6 ? "✅ OK" : "❌ PROBLEM"} | set=${appPin.length > 0} | len=${appPin.length}`);
if (appPin.length < 6) fail += 1;

if (fail) {
  console.error(`\n❌ ${fail} secret(s) have the wrong format. Fix them in GitHub (Settings → Secrets → Actions) and re-run.`);
  process.exit(1);
}
console.log("\n✅ All secrets look correctly formatted.");
