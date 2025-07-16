const { Client } = require("pg");

const db = new Client({
  user: "avnadmin",
  password: "AVNS_L6PcvF7OBRIZu5QDpZ4",
  host: "pg-nyneos-kanavlt885-nyneos.g.aivencloud.com",
  port: 15247,
  database: "defaultdb",
  ssl: {
    rejectUnauthorized: false,
  },
});

db.connect()
  .then(() => {
    console.log("✅ Connected to database");
    return db.query(`
      SELECT 
        ordinal_position AS "No",
        column_name AS "Column Name",
        data_type AS "Type",
        CASE 
          WHEN is_nullable = 'NO' THEN 
            CASE 
              WHEN column_name IN (
                SELECT a.attname
                FROM pg_index i
                JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                WHERE i.indrelid = 'masterentity'::regclass AND i.indisprimary
              ) THEN 'PRIMARY KEY'
              ELSE 'NOT NULL'
            END
          ELSE 'NULLABLE'
        END AS "Requirement"
      FROM information_schema.columns
      WHERE table_name = 'masterentity'
      ORDER BY ordinal_position;
    `);
  })
  .then((res) => {
    console.log("\n📋 Table: masterEntity");
    console.table(res.rows);
    db.end();
  })
  .catch((err) => {
    console.error("❌ Error:", err.stack);
    db.end();
  });
