import { link, mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import pg from "pg";

import { omittedData } from "./backup/omitted-tables.mjs";

const { Client, types } = pg;
const numeric = types.builtins.NUMERIC;
const textFields = new Set([
  types.builtins.DATE,
  types.builtins.JSON,
  types.builtins.JSONB,
]);
const sourceTypes = {
  getTypeParser(oid, format) {
    return format === "text" && textFields.has(oid)
      ? (value) => value
      : types.getTypeParser(oid, format);
  },
};

function identifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value))
    throw new Error("Unexpected schema identifier.");
  return `"${value}"`;
}

function scaledInteger(value, places) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[3]?.length ?? 0) > places) {
    throw new Error("A source financial value exceeds the target precision.");
  }
  const [, sign, whole, fraction = ""] = match;
  return BigInt(`${sign}${whole}${fraction.padEnd(places, "0")}`);
}

function convert(value, field) {
  if (value === null) return null;
  switch (field.dataTypeID) {
    case numeric:
      return scaledInteger(value, field.name === "weight" ? 3 : 2);
    case types.builtins.INT8:
      return BigInt(value);
    case types.builtins.BOOL:
      return value ? 1 : 0;
    case types.builtins.TIMESTAMP:
    case types.builtins.TIMESTAMPTZ:
      return value.toISOString();
    default:
      return value;
  }
}

async function importTable(source, target, table) {
  const quoted = identifier(table);
  const columns = target
    .prepare("SELECT name FROM pragma_table_info(?)")
    .all(table)
    .map(({ name }) => name);
  const names = columns.map(identifier).join(", ");
  const insert = target.prepare(
    `INSERT INTO ${quoted} (${names}) VALUES (${columns.map(() => "?").join(", ")})`,
  );
  await source.query(
    `DECLARE import_rows NO SCROLL CURSOR FOR SELECT ${names} FROM public.${quoted}`,
  );

  let count = 0;
  let totals;
  try {
    for (;;) {
      const { fields, rows } = await source.query({
        text: "FETCH FORWARD 1000 FROM import_rows",
        rowMode: "array",
      });
      totals ??= new Map(
        fields.flatMap((field, index) =>
          field.dataTypeID === numeric ? [[index, 0n]] : [],
        ),
      );
      for (const row of rows) {
        const values = row.map((value, index) => convert(value, fields[index]));
        insert.run(...values);
        for (const [index, total] of totals)
          totals.set(index, total + (values[index] ?? 0n));
      }
      count += rows.length;
      if (rows.length === 0) break;
    }
  } finally {
    await source.query("CLOSE import_rows");
  }

  if (
    target.prepare(`SELECT count(*) AS count FROM ${quoted}`).get().count !==
    count
  ) {
    throw new Error(`The row count did not reconcile for ${table}.`);
  }
  if (totals.size) {
    const expected = Object.fromEntries(
      [...totals].map(([index, value]) => [columns[index], value]),
    );
    const actual = Object.fromEntries(
      Object.keys(expected).map((column) => [column, 0n]),
    );
    const check = target.prepare(
      `SELECT ${Object.keys(expected).map(identifier).join(", ")} FROM ${quoted}`,
    );
    check.setReadBigInts(true);
    for (const row of check.iterate()) {
      for (const column of Object.keys(expected))
        actual[column] += row[column] ?? 0n;
    }
    for (const column of Object.keys(expected)) {
      if (actual[column] !== expected[column])
        throw new Error(
          `Financial values did not reconcile for ${table}.${column}.`,
        );
    }
  }
  return count;
}

async function importDatabase(connectionString, destination) {
  const [schema, guards] = await Promise.all([
    readFile(new URL("../prisma/sqlite/schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../prisma/sqlite/guards.sql", import.meta.url), "utf8"),
  ]);
  const source = new Client({
    connectionString,
    types: sourceTypes,
    connectionTimeoutMillis: 5000,
  });
  const scratch = await mkdtemp(
    join(dirname(destination), ".khancoal-import-"),
  );
  const staged = join(scratch, "import.db");
  try {
    await source.connect();
    await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const target = new DatabaseSync(staged);
    const report = {};
    try {
      target.exec(schema);
      target.exec("BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON");
      const tables = target
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all();
      for (const { name } of tables) {
        if (!omittedData.includes(name))
          report[name] = await importTable(source, target, name);
      }
      target.exec(guards);
      if (
        target.prepare("PRAGMA foreign_key_check").get() ||
        target.prepare("PRAGMA quick_check").get()?.quick_check !== "ok"
      ) {
        throw new Error(
          "The imported SQLite database failed its integrity check.",
        );
      }
      target.exec("COMMIT");
    } finally {
      target.close();
    }
    await source.query("COMMIT");
    await link(staged, destination);
    console.log(JSON.stringify({ imported: report, excluded: omittedData }));
  } finally {
    try {
      await source.end();
    } finally {
      for (const path of [staged, `${staged}-journal`])
        await rm(path, { force: true });
      await rmdir(scratch);
    }
  }
}

const [output, ...extra] = process.argv.slice(2);
const sourceUrl = process.env.MIGRATION_SOURCE_DATABASE_URL;
if (!output?.toLowerCase().endsWith(".db") || extra.length || !sourceUrl) {
  console.error(
    "Set MIGRATION_SOURCE_DATABASE_URL and run node scripts/import-postgres-to-sqlite.mjs <new-file.db>.",
  );
  process.exitCode = 2;
} else {
  try {
    await importDatabase(sourceUrl, resolve(output));
  } catch (error) {
    const reason =
      error?.code === "EEXIST"
        ? "The destination already exists. Use a new database filename."
        : "Check source access, consistent database migrations, destination permissions and free disk space.";
    console.error(`SQLite import did not publish an output file. ${reason}`);
    process.exitCode = 1;
  }
}
