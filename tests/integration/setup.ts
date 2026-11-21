const connection = process.env.INTEGRATION_DATABASE_URL;
let validDatabase = false;
if (connection) {
  try {
    const url = new URL(connection);
    validDatabase =
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      decodeURIComponent(url.pathname).endsWith("_test");
  } catch {
    validDatabase = false;
  }
}

if (!validDatabase) {
  throw new Error(
    "Set INTEGRATION_DATABASE_URL to a disposable localhost PostgreSQL database whose name ends in _test.",
  );
}
