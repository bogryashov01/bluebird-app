/**
 * Verifies that the development networking fixture controls are absent from a
 * production-configured API instance.
 */
process.env.NODE_ENV = "production";

async function main() {
  const { default: app } = await import("../src/app.ts");
  const { pool } = await import("@workspace/db");

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const port = server.address().port;
  let failures = 0;

  function check(name, condition, detail = "") {
    console.log(`${condition ? "PASS" : "FAIL"}  ${name}${condition ? "" : `  ${detail}`}`);
    if (!condition) failures += 1;
  }

  async function checkRoute(path, method) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method });
    return { status: response.status, json: await response.json().catch(() => null) };
  }

  try {
    const restore = await checkRoute("/api/dev/networking-test-member/restore", "POST");
    const remove = await checkRoute("/api/dev/networking-test-member", "DELETE");
    const restoreSamples = await checkRoute("/api/dev/networking-samples/restore", "POST");
    check("production hides the networking fixture restore control", restore.status === 404, JSON.stringify(restore));
    check("production hides the networking fixture delete control", remove.status === 404, JSON.stringify(remove));
    check("production hides demo networking sample restoration", restoreSamples.status === 404, JSON.stringify(restoreSamples));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }

  return failures;
}

main().then((failures) => {
  process.exitCode = failures ? 1 : 0;
});