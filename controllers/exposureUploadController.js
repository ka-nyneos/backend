// controllers/exposureUploadController.js
// Handles endpoints for exposure upload related logic
const globalSession = require("../globalSession");
const { pool } = require("../db");
const csv = require("csv-parser");
const path = require("path");
const fs = require("fs");

const getUserVars = async (req, res) => {
  const session = globalSession.UserSessions[0];

  if (!session) {
    return res.status(404).json({ error: "No active session found" });
  }

  const [firstName, ...restName] = session.name?.split(" ") || ["", ""];
  const secondName = restName.join(" ") || "";

  const loginDate = new Date(session.lastLoginTime || new Date());
  const dateLoggedIn = loginDate.toISOString().split("T")[0]; // "YYYY-MM-DD"
  const timeLoggedIn = loginDate.toTimeString().split(" ")[0]; // "HH:MM:SS"

  try {
    const query = "SELECT * FROM notifications WHERE user_id = $1";
    const result = await pool.query(query, [session.userId]);

    const messages = result.rows.map((row) => ({
      date: row.date,
      priority: row.priority,
      deadline: row.deadline,
      text: row.text,
    }));

    const userVars = {
      roleName: session.role,
      firstName,
      secondName,
      dateLoggedIn,
      timeLoggedIn,
      isLoggedIn: session.isLoggedIn,
      userEmailId: session.email,
      notification: {
        messages,
      },
    };

    res.json(userVars);
  } catch (err) {
    console.error("Error fetching notifications:", err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
};

const getRenderVars = async (req, res) => {
  try {
    // 1. Get current user session
    const session = globalSession.UserSessions[0];
    if (!session) {
      return res.status(404).json({ error: "No active session found" });
    }
    const userId = session.userId;

    // 2. Get user's business unit name
    const userResult = await pool.query(
      "SELECT business_unit_name FROM users WHERE id = $1",
      [userId]
    );
    if (!userResult.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }
    const userBu = userResult.rows[0].business_unit_name;
    if (!userBu) {
      return res.status(404).json({ error: "User has no business unit assigned" });
    }

    // 3. Find all descendant business units using recursive CTE
    // First, get the entity_id for the user's business unit
    const entityResult = await pool.query(
      "SELECT entity_id FROM masterEntity WHERE entity_name = $1 AND (approval_status = 'Approved' OR approval_status = 'approved') AND (is_deleted = false OR is_deleted IS NULL)",
      [userBu]
    );
    if (!entityResult.rows.length) {
      return res.status(404).json({ error: "Business unit entity not found" });
    }
    const rootEntityId = entityResult.rows[0].entity_id;

    // Recursive CTE to get all descendant entity_ids
    const descendantsResult = await pool.query(`
      WITH RECURSIVE descendants AS (
        SELECT entity_id, entity_name FROM masterEntity WHERE entity_id = $1
        UNION ALL
        SELECT me.entity_id, me.entity_name
        FROM masterEntity me
        INNER JOIN entityRelationships er ON me.entity_id = er.child_entity_id
        INNER JOIN descendants d ON er.parent_entity_id = d.entity_id
        WHERE (me.approval_status = 'Approved' OR me.approval_status = 'approved') AND (me.is_deleted = false OR me.is_deleted IS NULL)
      )
      SELECT entity_name FROM descendants
    `, [rootEntityId]);

    const buNames = descendantsResult.rows.map(r => r.entity_name);
    if (!buNames.length) {
      return res.status(404).json({ error: "No accessible business units found" });
    }

    // 4. Filter exposures by business_unit in buNames
    const exposuresResult = await pool.query(
      `SELECT * FROM exposures WHERE business_unit = ANY($1)`,
      [buNames]
    );

    // Fetch permissions for 'exposure-upload' page for this role
    const roleName = session.role;
    let exposureUploadPerms = {};
    if (roleName) {
      const roleResult = await pool.query(
        "SELECT id FROM roles WHERE name = $1",
        [roleName]
      );
      if (roleResult.rows.length > 0) {
        const role_id = roleResult.rows[0].id;
        const permResult = await pool.query(
          `SELECT p.page_name, p.tab_name, p.action, rp.allowed
           FROM role_permissions rp
           JOIN permissions p ON rp.permission_id = p.id
           WHERE rp.role_id = $1 AND (rp.status = 'Approved' OR rp.status = 'approved')`,
          [role_id]
        );
        // Build permissions structure for 'exposure-upload'
        for (const row of permResult.rows) {
          if (row.page_name !== "exposure-upload") continue;
          const tab = row.tab_name;
          const action = row.action;
          const allowed = row.allowed;
          if (!exposureUploadPerms["exposure-upload"]) exposureUploadPerms["exposure-upload"] = {};
          if (tab === null) {
            if (!exposureUploadPerms["exposure-upload"].pagePermissions) exposureUploadPerms["exposure-upload"].pagePermissions = {};
            exposureUploadPerms["exposure-upload"].pagePermissions[action] = allowed;
          } else {
            if (!exposureUploadPerms["exposure-upload"].tabs) exposureUploadPerms["exposure-upload"].tabs = {};
            if (!exposureUploadPerms["exposure-upload"].tabs[tab]) exposureUploadPerms["exposure-upload"].tabs[tab] = {};
            exposureUploadPerms["exposure-upload"].tabs[tab][action] = allowed;
          }
        }
      }
    }
    res.json({
      ...(exposureUploadPerms["exposure-upload"] ? { "exposure-upload": exposureUploadPerms["exposure-upload"] } : {}),
      buAccessible: buNames,
      pageData: exposuresResult.rows
    });
  } catch (err) {
    console.error("Error fetching exposures:", err);
    res.status(500).json({ error: "Failed to fetch exposures" });
  }
};

const getUserJourney = (req, res) => {
  res.json({
    process: "viewAllExposures",
    nextPageToCall: "exposure-Bucketing",
    actionCalledFrom: "submit",
  });
};

const getPendingApprovalVars = async (req, res) => {
  try {
    // 1. Get current user session
    const session = globalSession.UserSessions[0];
    if (!session) {
      return res.status(404).json({ error: "No active session found" });
    }
    const userId = session.userId;

    // 2. Get user's business unit name
    const userResult = await pool.query(
      "SELECT business_unit_name FROM users WHERE id = $1",
      [userId]
    );
    if (!userResult.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }
    const userBu = userResult.rows[0].business_unit_name;
    if (!userBu) {
      return res.status(404).json({ error: "User has no business unit assigned" });
    }

    // 3. Find all descendant business units using recursive CTE
    const entityResult = await pool.query(
      "SELECT entity_id FROM masterEntity WHERE entity_name = $1 AND (approval_status = 'Approved' OR approval_status = 'approved') AND (is_deleted = false OR is_deleted IS NULL)",
      [userBu]
    );
    if (!entityResult.rows.length) {
      return res.status(404).json({ error: "Business unit entity not found" });
    }
    const rootEntityId = entityResult.rows[0].entity_id;

    const descendantsResult = await pool.query(`
      WITH RECURSIVE descendants AS (
        SELECT entity_id, entity_name FROM masterEntity WHERE entity_id = $1
        UNION ALL
        SELECT me.entity_id, me.entity_name
        FROM masterEntity me
        INNER JOIN entityRelationships er ON me.entity_id = er.child_entity_id
        INNER JOIN descendants d ON er.parent_entity_id = d.entity_id
        WHERE (me.approval_status = 'Approved' OR me.approval_status = 'approved') AND (me.is_deleted = false OR me.is_deleted IS NULL)
      )
      SELECT entity_name FROM descendants
    `, [rootEntityId]);

    const buNames = descendantsResult.rows.map(r => r.entity_name);
    if (!buNames.length) {
      return res.status(404).json({ error: "No accessible business units found" });
    }

    // 4. Filter exposures by business_unit in buNames and pending status
    const pendingExposuresResult = await pool.query(
      `SELECT * FROM exposures WHERE (status = 'pending' OR status = 'Pending' OR status = 'Delete-approval' OR status = 'Delete-Approval') AND business_unit = ANY($1)`,
      [buNames]
    );

    res.json({
      isLoadable: true,
      allExposuresTab: false,
      pendingApprovalTab: true,
      uploadingTab: false,
      btnApprove: true,
      buAccessible: buNames,
      pageData: pendingExposuresResult.rows,
    });
  } catch (err) {
    console.error("Error fetching pending exposures:", err);
    res.status(500).json({ error: "Failed to fetch pending exposures" });
  }
};

const exposuresColumns = [
  "reference_no",
  "type",
  "business_unit",
  "vendor_beneficiary",
  "po_amount",
  "po_currency",
  "maturity_expiry_date",
  "linked_id",
  "status",
  "file_reference_id",
  "upload_date",
  "purchase_invoice",
  "po_date",
  "shipping_bill_date",
  "supplier_name",
  "expected_payment_date",
  "comments",
  "created_at",
  "updated_at",
  "uploaded_by",
  "po_detail",
  "inco",
  "advance",
  "month1",
  "month2",
  "month3",
  "month4",
  "month4to6",
  "month6plus",
  "old_month1",
  "old_month2",
  "old_month3",
  "old_month4",
  "old_month4to6",
  "old_month6plus",
  "hedge_month1",
  "hedge_month2",
  "hedge_month3",
  "hedge_month4",
  "hedge_month4to6",
  "hedge_month6plus",
  "old_hedge_month1",
  "old_hedge_month2",
  "old_hedge_month3",
  "old_hedge_month4",
  "old_hedge_month4to6",
  "old_hedge_month6plus",
  "status_hedge",
];

const uploadExposuresFromCSV = async (req, res) => {
  const filePath = path.join(__dirname, "../", req.file.path);
  const rows = [];
  // 1. Get current user session and allowed business units
  const session = globalSession.UserSessions[0];
  if (!session) {
    return res.status(404).json({ error: "No active session found" });
  }
  const userId = session.userId;
  // Get user's business unit name
  let buNames = [];
  try {
    const userResult = await pool.query(
      "SELECT business_unit_name FROM users WHERE id = $1",
      [userId]
    );
    if (!userResult.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }
    const userBu = userResult.rows[0].business_unit_name;
    if (!userBu) {
      return res.status(404).json({ error: "User has no business unit assigned" });
    }
    // Find all descendant business units using recursive CTE
    const entityResult = await pool.query(
      "SELECT entity_id FROM masterEntity WHERE entity_name = $1 AND (approval_status = 'Approved' OR approval_status = 'approved') AND (is_deleted = false OR is_deleted IS NULL)",
      [userBu]
    );
    if (!entityResult.rows.length) {
      return res.status(404).json({ error: "Business unit entity not found" });
    }
    const rootEntityId = entityResult.rows[0].entity_id;
    const descendantsResult = await pool.query(`
      WITH RECURSIVE descendants AS (
        SELECT entity_id, entity_name FROM masterEntity WHERE entity_id = $1
        UNION ALL
        SELECT me.entity_id, me.entity_name
        FROM masterEntity me
        INNER JOIN entityRelationships er ON me.entity_id = er.child_entity_id
        INNER JOIN descendants d ON er.parent_entity_id = d.entity_id
        WHERE (me.approval_status = 'Approved' OR me.approval_status = 'approved') AND (me.is_deleted = false OR me.is_deleted IS NULL)
      )
      SELECT entity_name FROM descendants
    `, [rootEntityId]);
    buNames = descendantsResult.rows.map(r => r.entity_name);
    if (!buNames.length) {
      return res.status(404).json({ error: "No accessible business units found" });
    }
  } catch (err) {
    console.error("Error fetching allowed business units:", err);
    return res.status(500).json({ error: "Failed to fetch allowed business units" });
  }

  fs.createReadStream(filePath)
    .pipe(csv())
    .on("data", (row) => {
      const cleanedRow = {};
      for (let key in row) {
        const normalizedKey = key.trim().toLowerCase();
        if (exposuresColumns.includes(normalizedKey)) {
          let value = row[key]?.trim() || null;
          if (value === "") value = null;
          if (/^month|amount|advance/.test(normalizedKey) && value !== null) {
            value = parseInt(value);
            if (isNaN(value)) value = null;
          }
          if (/date/.test(normalizedKey) && value !== null) {
            const dateObj = new Date(value);
            value = isNaN(dateObj.getTime())
              ? null
              : dateObj.toISOString().slice(0, 10);
          }
          cleanedRow[normalizedKey] = value;
        }
      }
      cleanedRow["status"] = "Pending";
      rows.push(cleanedRow);
    })
    .on("end", async () => {
      try {
        // Validate all rows' business_unit
        const invalidRows = rows.filter(row => !buNames.includes(row["business_unit"]))
          .map(row => row["reference_no"] || "(no reference_no)");
        if (invalidRows.length > 0) {
          fs.unlinkSync(filePath);
          return res.status(400).json({
            error: "Some rows have business_unit not allowed for this user.",
            invalidReferenceNos: invalidRows
          });
        }
        // All rows valid, insert all
        for (let row of rows) {
          const keys = Object.keys(row);
          if (keys.length === 0) continue;
          const values = keys.map((k) => row[k]);
          const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
          const query = `
            INSERT INTO exposures (${keys.join(", ")})
            VALUES (${placeholders})
          `;
          await pool.query(query, values);
        }
        fs.unlinkSync(filePath);
        res.status(200).json({ message: "All rows inserted successfully." });
      } catch (err) {
        console.error("DB Insert Error:", err);
        res.status(500).json({ error: "Failed to insert data." });
      }
    })
    .on("error", (err) => {
      console.error("CSV Parse Error:", err);
      res.status(500).json({ error: "Failed to parse CSV file." });
    });
};

const deleteExposure = async (req, res) => {
  const { id, requested_by, delete_comment } = req.body;

  if (!id || !requested_by) {
    return res
      .status(400)
      .json({ success: false, message: "id and requested_by are required" });
  }

  try {
    const ids = Array.isArray(id) ? id : [id]; // Normalize to array

    const { rowCount } = await pool.query(
      `UPDATE exposures
       SET status = 'Delete-Approval'
       WHERE id = ANY($1::uuid[])`,
      [ids]
    );

    if (rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No matching exposures found" });
    }

    res
      .status(200)
      .json({
        success: true,
        message: `${rowCount} exposure(s) marked for delete approval`,
      });
  } catch (err) {
    console.error("deleteExposure error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

const approveMultipleExposures = async (req, res) => {
  const { exposureIds, approved_by, approval_comment } = req.body;

  if (!Array.isArray(exposureIds) || exposureIds.length === 0 || !approved_by) {
    return res
      .status(400)
      .json({
        success: false,
        message: "exposureIds and approved_by are required",
      });
  }

  try {
    // Fetch current statuses
    const { rows: existingExposures } = await pool.query(
      `SELECT id, status FROM exposures WHERE id = ANY($1::uuid[])`,
      [exposureIds]
    );

    const toDelete = existingExposures
      .filter((row) => row.status === "Delete-Approval")
      .map((row) => row.id);

    const toApprove = existingExposures
      .filter((row) => row.status !== "Delete-Approval")
      .map((row) => row.id);

    const results = {
      deleted: [],
      approved: [],
    };

    // Delete exposures
    if (toDelete.length > 0) {
      const deleted = await pool.query(
        `DELETE FROM exposures WHERE id = ANY($1::uuid[]) RETURNING *`,
        [toDelete]
      );
      results.deleted = deleted.rows;
    }

    // Approve remaining exposures
    if (toApprove.length > 0) {
      const approved = await pool.query(
        `UPDATE exposures
         SET status = 'Approved'
         WHERE id = ANY($1::uuid[])
         RETURNING *`,
        [toApprove]
      );
      results.approved = approved.rows;
    }

    res.status(200).json({ success: true, ...results });
  } catch (err) {
    console.error("approveMultipleExposures error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

const rejectMultipleExposures = async (req, res) => {
  const { exposureIds, rejected_by, rejection_comment } = req.body;

  if (!Array.isArray(exposureIds) || exposureIds.length === 0 || !rejected_by) {
    return res
      .status(400)
      .json({
        success: false,
        message: "exposureIds and rejected_by are required",
      });
  }

  try {
    const result = await pool.query(
      `UPDATE exposures
       SET status = 'Rejected'
       WHERE id = ANY($1::uuid[])
       RETURNING *`,
      [exposureIds]
    );

    res.status(200).json({ success: true, rejected: result.rows });
  } catch (err) {
    console.error("rejectMultipleExposures error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

const getBuMaturityCurrencySummary = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT business_unit, po_currency, type,
              month_1, month_2, month_3, month_4, month_4_6, month_6plus
       FROM exposures`
    );

    const summary = {};
    const maturityBuckets = [
      "month_1",
      "month_2",
      "month_3",
      "month_4",
      "month_4_6",
      "month_6plus",
    ];

    const bucketLabels = {
      month_1: "1 Month",
      month_2: "2 Month",
      month_3: "3 Month",
      month_4: "4 Month",
      month_4_6: "4-6 Month",
      month_6plus: "6 Month +",
    };

    for (const row of result.rows) {
      const bu = row.business_unit || "Unknown";
      const currency = (row.po_currency || "Unknown").toUpperCase();
      const type = (row.type || "").toLowerCase();

      for (const bucket of maturityBuckets) {
        const amount = Number(row[bucket]) || 0;
        if (amount === 0) continue;

        if (!summary[bucket]) summary[bucket] = {};
        if (!summary[bucket][bu]) summary[bucket][bu] = {};
        if (!summary[bucket][bu][currency])
          summary[bucket][bu][currency] = { payable: 0, receivable: 0 };

        if (["payable", "po"].includes(type)) {
          summary[bucket][bu][currency].payable += amount;
        } else if (["receivable", "so"].includes(type)) {
          summary[bucket][bu][currency].receivable += amount;
        }
      }
    }

    const response = [];
    for (const bucket in summary) {
      const maturityLabel = bucketLabels[bucket] || bucket;
      for (const bu in summary[bucket]) {
        for (const currency in summary[bucket][bu]) {
          const { payable, receivable } = summary[bucket][bu][currency];
          response.push({
            maturity: maturityLabel,
            bu,
            currency,
            payable,
            receivable,
          });
        }
      }
    }

    res.json(response);
  } catch (err) {
    console.error("Error fetching maturity summary:", err);
    res.status(500).json({ error: "Failed to fetch summary" });
  }
};

const getTopCurrencies = async (req, res) => {
  const rates = {
    USD: 1.0,
    AUD: 0.68,
    CAD: 0.75,
    CHF: 1.1,
    CNY: 0.14,
    EUR: 1.09,
    GBP: 1.28,
    JPY: 0.0067,
    SEK: 0.095,
    INR: 0.0117,
  };
  try {
    const result = await pool.query(
      "SELECT po_amount, po_currency FROM exposures"
    );
    const currencyTotals = {};
    for (const row of result.rows) {
      const currency = (row.po_currency || "").toUpperCase();
      const amount = Number(row.po_amount) || 0;
      const usdValue = amount * (rates[currency] || 1.0);
      currencyTotals[currency] = (currencyTotals[currency] || 0) + usdValue;
    }
    // Sort currencies by value descending and take top 5
    const sorted = Object.entries(currencyTotals).sort((a, b) => b[1] - a[1]);
    const topCurrencies = sorted.slice(0, 5).map(([currency, value], idx) => ({
      currency,
      value: Number(value.toFixed(1)),
      color:
        idx === 0
          ? "bg-green-400"
          : idx === 1
          ? "bg-blue-400"
          : idx === 2
          ? "bg-yellow-400"
          : idx === 3
          ? "bg-red-400"
          : "bg-purple-400",
    }));
    res.json(topCurrencies);
  } catch (err) {
    console.error("Error fetching top currencies:", err);
    res.status(500).json({ error: "Failed to fetch top currencies" });
  }
};

const getPoAmountUsdSum = async (req, res) => {
  // Exchange rates to USD
  const rates = {
    USD: 1.0,
    AUD: 0.68,
    CAD: 0.75,
    CHF: 1.1,
    CNY: 0.14,
    EUR: 1.09,
    GBP: 1.28,
    JPY: 0.0067,
    SEK: 0.095,
    INR: 0.0117,
  };
  try {
    const result = await pool.query(
      "SELECT po_amount, po_currency FROM exposures"
    );
    let totalUsd = 0;
    for (const row of result.rows) {
      const amount = Number(row.po_amount) || 0;
      const currency = (row.po_currency || "").toUpperCase();
      const rate = rates[currency] || 1.0;
      totalUsd += amount * rate;
    }
    res.json({ totalUsd });
  } catch (err) {
    console.error("Error calculating PO amount sum in USD:", err);
    res.status(500).json({ error: "Failed to calculate PO amount sum in USD" });
  }
};

// GET /api/exposures/payables
const getPayablesByCurrency = async (req, res) => {
  const rates = {
    USD: 1.0,
    AUD: 0.68,
    CAD: 0.75,
    CHF: 1.1,
    CNY: 0.14,
    EUR: 1.09,
    GBP: 1.28,
    JPY: 0.0067,
    SEK: 0.095,
    INR: 0.0117,
  };
  try {
    const result = await pool.query(
      "SELECT po_amount, po_currency FROM exposures WHERE type = 'po' OR type = 'payable' OR type = 'PO'"
    );
    const currencyTotals = {};
    for (const row of result.rows) {
      const currency = (row.po_currency || "").toUpperCase();
      const amount = Number(row.po_amount) || 0;
      currencyTotals[currency] =
        (currencyTotals[currency] || 0) + amount * (rates[currency] || 1.0);
    }
    const payablesData = Object.entries(currencyTotals).map(
      ([currency, amount]) => ({
        currency,
        amount: `$${(amount / 1000).toFixed(1)}K`,
      })
    );
    res.json(payablesData);
  } catch (err) {
    console.error("Error fetching payables by currency:", err);
    res.status(500).json({ error: "Failed to fetch payables by currency" });
  }
};

// GET /api/exposures/receivables
const getReceivablesByCurrency = async (req, res) => {
  const rates = {
    USD: 1.0,
    AUD: 0.68,
    CAD: 0.75,
    CHF: 1.1,
    CNY: 0.14,
    EUR: 1.09,
    GBP: 1.28,
    JPY: 0.0067,
    SEK: 0.095,
    INR: 0.0117,
  };
  try {
    const result = await pool.query(
      "SELECT po_amount, po_currency FROM exposures WHERE type = 'so' OR type = 'receivable'"
    );
    const currencyTotals = {};
    for (const row of result.rows) {
      const currency = (row.po_currency || "").toUpperCase();
      const amount = Number(row.po_amount) || 0;
      currencyTotals[currency] =
        (currencyTotals[currency] || 0) + amount * (rates[currency] || 1.0);
    }
    const receivablesData = Object.entries(currencyTotals).map(
      ([currency, amount]) => ({
        currency,
        amount: `$${(amount / 1000).toFixed(1)}K`,
      })
    );
    res.json(receivablesData);
  } catch (err) {
    console.error("Error fetching receivables by currency:", err);
    res.status(500).json({ error: "Failed to fetch receivables by currency" });
  }
};

// GET /api/exposures/getpoAmountByCurrency
const getAmountByCurrency = async (req, res) => {
  const rates = {
    USD: 1.0,
    AUD: 0.68,
    CAD: 0.75,
    CHF: 1.1,
    CNY: 0.14,
    EUR: 1.09,
    GBP: 1.28,
    JPY: 0.0067,
    SEK: 0.095,
    INR: 0.0117,
  };
  try {
    const result = await pool.query(
      "SELECT po_amount, po_currency FROM exposures"
    );
    const currencyTotals = {};
    for (const row of result.rows) {
      const currency = (row.po_currency || "").toUpperCase();
      const amount = Number(row.po_amount) || 0;
      currencyTotals[currency] =
        (currencyTotals[currency] || 0) + amount * (rates[currency] || 1.0);
    }
    const payablesData = Object.entries(currencyTotals).map(
      ([currency, amount]) => ({
        currency,
        amount: `$${(amount / 1000).toFixed(1)}K`,
      })
    );

    res.json(payablesData);
  } catch (err) {
    console.error("Error fetching payables by currency:", err);
    res.status(500).json({ error: "Failed to fetch payables by currency" });
  }
};

const getBusinessUnitCurrencySummary = async (req, res) => {
  // Exchange rates to USD
  const rates = {
    USD: 1.0,
    AUD: 0.68,
    CAD: 0.75,
    CHF: 1.1,
    CNY: 0.14,
    EUR: 1.09,
    GBP: 1.28,
    JPY: 0.0067,
    SEK: 0.095,
    INR: 0.0117,
  };
  try {
    const result = await pool.query(
      "SELECT business_unit, po_currency, po_amount FROM exposures"
    );
    // Aggregate by business_unit and currency
    const buMap = {};
    for (const row of result.rows) {
      const bu = row.business_unit || "Unknown";
      const currency = (row.po_currency || "Unknown").toUpperCase();
      const amount = Number(row.po_amount) || 0;
      const usdAmount = amount * (rates[currency] || 1.0);
      if (!buMap[bu]) buMap[bu] = {};
      if (!buMap[bu][currency]) buMap[bu][currency] = 0;
      buMap[bu][currency] += usdAmount;
    }
    // Format output
    const output = Object.entries(buMap).map(([bu, currencies]) => {
      const total = Object.values(currencies).reduce((a, b) => a + b, 0);
      return {
        name: bu,
        total: `$${(total / 1000).toFixed(1)}K`,
        currencies: Object.entries(currencies).map(([code, amount]) => ({
          code,
          amount: `$${(amount / 1000).toFixed(1)}K`,
        })),
      };
    });
    res.json(output);
  } catch (err) {
    console.error("Error fetching business unit currency summary:", err);
    res
      .status(500)
      .json({ error: "Failed to fetch business unit currency summary" });
  }
};

const getMaturityExpirySummary = async (req, res) => {
  // Exchange rates to USD
  const rates = {
    USD: 1.0,
    AUD: 0.68,
    CAD: 0.75,
    CHF: 1.1,
    CNY: 0.14,
    EUR: 1.09,
    GBP: 1.28,
    JPY: 0.0067,
    SEK: 0.095,
    INR: 0.0117,
  };
  try {
    const result = await pool.query(
      "SELECT po_amount, po_currency, maturity_expiry_date FROM exposures WHERE maturity_expiry_date IS NOT NULL"
    );
    const now = new Date();
    let sum7 = 0,
      sum30 = 0,
      sumTotal = 0;
    for (const row of result.rows) {
      const amount = Number(row.po_amount) || 0;
      const currency = (row.po_currency || "USD").toUpperCase();
      const rate = rates[currency] || 1.0;
      const usdAmount = amount * rate;
      const maturityDate = new Date(row.maturity_expiry_date);
      if (isNaN(maturityDate.getTime())) continue;
      const diffDays = Math.ceil((maturityDate - now) / (1000 * 60 * 60 * 24));
      if (diffDays >= 0) {
        sumTotal += usdAmount;
        if (diffDays <= 7) sum7 += usdAmount;
        if (diffDays <= 30) sum30 += usdAmount;
      }
    }
    const output = [
      { label: "Next 7 Days", value: `$${(sum7 / 1000).toFixed(1)}K` },
      { label: "Next 30 Days", value: `$${(sum30 / 1000).toFixed(1)}K` },
      { label: "Total Upcoming", value: `$${(sumTotal / 1000).toFixed(1)}K` },
    ];
    res.json(output);
  } catch (err) {
    console.error("Error fetching maturity expiry summary:", err);
    res.status(500).json({ error: "Failed to fetch maturity expiry summary" });
  }
};
const getMaturityExpiryCount7Days = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT maturity_expiry_date FROM exposures WHERE maturity_expiry_date IS NOT NULL"
    );
    const now = new Date();
    let count7 = 0;
    for (const row of result.rows) {
      const maturityDate = new Date(row.maturity_expiry_date);
      if (isNaN(maturityDate.getTime())) continue;
      const diffDays = Math.ceil((maturityDate - now) / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays <= 7) {
        count7++;
      }
    }
    res.json({ value: count7 });
  } catch (err) {
    console.error("Error fetching maturity expiry count for 7 days:", err);
    res
      .status(500)
      .json({ error: "Failed to fetch maturity expiry count for 7 days" });
  }
};

module.exports = {
  getUserVars,
  getRenderVars,
  getUserJourney,
  getPendingApprovalVars,
  uploadExposuresFromCSV,
  deleteExposure,
  approveMultipleExposures,
  rejectMultipleExposures,
  getBuMaturityCurrencySummary,
  getTopCurrencies,
  getPoAmountUsdSum,
  getAmountByCurrency,
  getReceivablesByCurrency,
  getPayablesByCurrency,
  getBusinessUnitCurrencySummary,
  getMaturityExpirySummary,
  getMaturityExpiryCount7Days,
};
