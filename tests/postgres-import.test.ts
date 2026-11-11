import { describe, expect, it } from "vitest";
import { pgTypePatch, typeName } from "@/app/lib/dialect";
import { generatePostgres } from "@/app/lib/postgres";
import { appendPostgres, looksLikePostgres, parsePostgres } from "@/app/lib/postgres-import";
import { makeColumn, makeEmptySchema, makeTable, normalizeRelationships, type Column, type Schema } from "@/app/lib/schema";

const types = (schema: Schema, table: string) =>
  Object.fromEntries(schema.tables.find((item) => item.name === table)!.columns.map((column) => [column.name, typeName(column, "postgres")]));

describe("importing PostgreSQL", () => {
  it("reads a hand-written script into a PostgreSQL diagram", () => {
    const sql = `
      -- users of the shop
      CREATE TYPE order_status AS ENUM ('new', 'paid', 'shipped');
      CREATE TABLE IF NOT EXISTS public.customers (
        id bigint GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1) PRIMARY KEY,
        email character varying(200) NOT NULL UNIQUE,
        full_name text,
        is_active boolean NOT NULL DEFAULT true,
        profile jsonb,
        tags text[],
        last_ip inet,
        created_at timestamp with time zone NOT NULL DEFAULT now()
      );
      CREATE TABLE orders (
        id bigserial PRIMARY KEY,
        customer_id bigint NOT NULL REFERENCES customers (id) ON DELETE CASCADE ON UPDATE NO ACTION,
        status order_status NOT NULL DEFAULT 'new'::order_status,
        total numeric(12, 2) NOT NULL CHECK (total >= 0),
        paid_on date,
        public_id uuid DEFAULT gen_random_uuid()
      );
      CREATE INDEX IF NOT EXISTS orders_customer_i ON orders USING btree (customer_id);
      COMMENT ON TABLE customers IS 'People who buy';`;
    expect(looksLikePostgres(sql)).toBe(true);
    const { schema, errors, warnings } = parsePostgres(sql);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(schema!.dialect).toBe("postgres");
    expect(types(schema!, "CUSTOMERS")).toEqual({
      ID: "bigint", EMAIL: "varchar(200)", FULL_NAME: "text", IS_ACTIVE: "boolean", PROFILE: "jsonb",
      TAGS: "text[]", LAST_IP: "inet", CREATED_AT: "timestamptz",
    });
    expect(types(schema!, "ORDERS")).toEqual({
      ID: "bigserial", CUSTOMER_ID: "bigint", STATUS: "varchar(7)", TOTAL: "numeric(12,2)", PAID_ON: "date", PUBLIC_ID: "uuid",
    });
    const customers = schema!.tables.find((table) => table.name === "CUSTOMERS")!;
    const orders = schema!.tables.find((table) => table.name === "ORDERS")!;
    expect(customers.keyStrategy).toBe("identity");
    expect(customers.comment).toBe("People who buy");
    expect(orders.keyStrategy).toBe("none");
    expect(orders.columns.find((column) => column.name === "STATUS")!.check).toBe("status IN ('new', 'paid', 'shipped')");
    expect(orders.columns.find((column) => column.name === "STATUS")!.defaultValue).toBe("'new'");
    expect(schema!.relationships).toHaveLength(1);
    expect(schema!.relationships![0].deleteConstraint).toBe("Cascade");
    expect(orders.indexes).toHaveLength(1);
    // And its PostgreSQL script writes the same types back.
    const back = generatePostgres(schema!).sql;
    ["profile        jsonb", "tags           text[]", "last_ip        inet", "id           bigserial", "create type"].forEach((part) =>
      expect(back.replace(/ +/g, " ")).toContain(part.replace(/ +/g, " ")));
  });

  it("round-trips the PostgreSQL export of a diagram", () => {
    const col = (name: string, patch: Partial<Column>) => makeColumn({ name, ...patch });
    const parent = { ...makeTable("ACCOUNTS", 0, 0), keyStrategy: "identity" as const, comment: "Accounts",
      columns: [col("ID", { type: "NUMBER", size: "19", pk: true, notNull: true }), col("CODE", { type: "VARCHAR2", size: "20", unique: true, notNull: true }),
        col("ACTIVE", { type: "CHAR", size: "1", check: "ACTIVE IN ('Y','N')", defaultValue: "'Y'" })] };
    const child = { ...makeTable("EVENTS", 0, 0), keyStrategy: "identity" as const,
      columns: [col("ID", { type: "NUMBER", size: "19", pk: true, notNull: true }),
        col("ACCOUNT_ID", { type: "NUMBER", size: "19", notNull: true, fk: { tableId: parent.id, columnId: parent.columns[0].id } }),
        col("PAYLOAD", pgTypePatch("jsonb", { type: "CLOB", size: "" })),
        col("HAPPENED_AT", { type: "TIMESTAMP WITH TIME ZONE", size: "" }), col("AMOUNT", { type: "NUMBER", size: "12,2" })] };
    const diagram = normalizeRelationships({ ...makeEmptySchema("x", "id", "postgres"), tables: [parent, child] });
    const { schema, errors } = parsePostgres(generatePostgres(diagram).sql);
    expect(errors).toEqual([]);
    for (const table of diagram.tables) expect(types(schema!, table.name)).toEqual(types(diagram, table.name));
    expect(schema!.tables.map((table) => table.keyStrategy)).toEqual(["identity", "identity"]);
    expect(schema!.relationships).toHaveLength(1);
    expect(schema!.tables[0].comment).toBe("Accounts");
  });

  it("reads pg_dump's shape: ALTER TABLE ONLY, identity added afterwards, casts", () => {
    const sql = `
      CREATE TABLE public.items (
          id integer NOT NULL,
          name character varying(100) DEFAULT ''::character varying NOT NULL,
          price double precision
      );
      ALTER TABLE public.items ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME public.items_id_seq START WITH 1);
      ALTER TABLE ONLY public.items ADD CONSTRAINT items_pkey PRIMARY KEY (id);`;
    const { schema, errors } = parsePostgres(sql);
    expect(errors).toEqual([]);
    const items = schema!.tables[0];
    expect(types(schema!, "ITEMS")).toEqual({ ID: "integer", NAME: "varchar(100)", PRICE: "double precision" });
    expect(items.keyStrategy).toBe("identity");
    expect(items.columns[0].pk).toBe(true);
    expect(items.columns[1].defaultValue).toBe("''");
  });

  it("reports what it cannot read, and still imports the rest", () => {
    const { schema, warnings } = parsePostgres("create table t (id int primary key, shape tsrange, odd hstore, ip cidr);");
    expect(types(schema!, "T")).toEqual({ ID: "integer", SHAPE: "tsrange", ODD: "text", IP: "cidr" });
    expect(warnings.join(" ")).toMatch(/hstore is not known here; imported as text/);
  });

  it("adds a script's tables to an existing diagram", () => {
    const base = { ...makeEmptySchema("x", "id", "postgres"), tables: [{ ...makeTable("USERS", 0, 0), columns: [makeColumn({ name: "ID", type: "NUMBER", size: "19", pk: true, notNull: true })] }] };
    const result = appendPostgres(base, "create table notes (id bigint primary key, user_id bigint references users(id), body text);");
    expect(result.errors).toEqual([]);
    expect(result.added.map((table) => table.name)).toEqual(["NOTES"]);
    expect(result.schema!.relationships).toHaveLength(1);
  });

  it("tells an Oracle script from a PostgreSQL one", () => {
    expect(looksLikePostgres("CREATE TABLE T (ID NUMBER(10), NAME VARCHAR2(20));")).toBe(false);
    expect(looksLikePostgres("create table t (id serial primary key, name text);")).toBe(true);
  });
});

describe("the Oracle importer", () => {
  it("keeps TIMESTAMP WITH (LOCAL) TIME ZONE, with or without a precision", async () => {
    const { parseCreateTable } = await import("@/app/lib/parser");
    const columns = parseCreateTable("CREATE TABLE T (A TIMESTAMP WITH TIME ZONE, B TIMESTAMP(3) WITH TIME ZONE, C TIMESTAMP WITH LOCAL TIME ZONE, D TIMESTAMP(6), E TIMESTAMP);").schema!.tables[0].columns;
    expect(columns.map((column) => [column.type, column.size])).toEqual([
      ["TIMESTAMP WITH TIME ZONE", ""], ["TIMESTAMP WITH TIME ZONE", ""], ["TIMESTAMP WITH LOCAL TIME ZONE", ""], ["TIMESTAMP", "6"], ["TIMESTAMP", ""],
    ]);
  });
});
