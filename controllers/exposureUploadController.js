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
    const exposuresResult = await pool.query("SELECT * FROM exposures");
    res.json({
      isLoadable: true,
      allExposuresTab: false,
      pendingApprovalTab: true,
      uploadingTab: false,
      btnApprove: false,
      buAccessible: ["Finance", "Sales"],
      pageData: exposuresResult.rows,
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
    const pendingExposuresResult = await pool.query("SELECT * FROM exposures WHERE status = 'pending' OR status = 'Pending' or status='Delete-approval' or status='Delete-Approval'");
    res.json({
      isLoadable: true,
      allExposuresTab: false,
      pendingApprovalTab: true,
      uploadingTab: false,
      btnApprove: true,
      buAccessible: ["Finance", "Sales"],
      pageData: pendingExposuresResult.rows,
    });
  } catch (err) {
    console.error("Error fetching pending exposures:", err);
    res.status(500).json({ error: "Failed to fetch pending exposures" });
  }
};


const exposuresColumns = [
  "reference_no", "type", "business_unit", "vendor_beneficiary", "po_amount", "po_currency", "maturity_expiry_date",
  "linked_id", "status", "file_reference_id", "upload_date", "purchase_invoice", "po_date", "shipping_bill_date",
  "supplier_name", "expected_payment_date", "comments", "created_at", "updated_at", "uploaded_by", "po_detail", "inco",
  "advance", "month1", "month2", "month3", "month4", "month4to6", "month6plus", "old_month1", "old_month2", "old_month3",
  "old_month4", "old_month4to6", "old_month6plus", "hedge_month1", "hedge_month2", "hedge_month3", "hedge_month4",
  "hedge_month4to6", "hedge_month6plus", "old_hedge_month1", "old_hedge_month2", "old_hedge_month3", "old_hedge_month4",
  "old_hedge_month4to6", "old_hedge_month6plus", "status_hedge"
];


const uploadExposuresFromCSV = async (req, res) => {
  const filePath = path.join(__dirname, "../", req.file.path);
  const rows = [];

  fs.createReadStream(filePath)
    .pipe(csv())
    .on("data", (row) => {
  const cleanedRow = {};

  for (let key in row) {
    const normalizedKey = key.trim().toLowerCase();

    // Include only valid columns
    if (exposuresColumns.includes(normalizedKey)) {
      let value = row[key]?.trim() || null;

      if (value === "") value = null;

      // Handle integer columns
      if (
        /^month|amount|advance/.test(normalizedKey) &&
        value !== null
      ) {
        value = parseInt(value);
        if (isNaN(value)) value = null;
      }

      // Handle date fields
      if (/date/.test(normalizedKey) && value !== null) {
        const dateObj = new Date(value);
        value = isNaN(dateObj.getTime())
          ? null
          : dateObj.toISOString().slice(0, 10);
      }

      cleanedRow[normalizedKey] = value;
    }
  }

  // Force status to "Pending"
  cleanedRow["status"] = "Pending";

  rows.push(cleanedRow);
}).on("end", async () => {
      try {
        for (let row of rows) {
          const keys = Object.keys(row);

          // Skip rows with no valid data
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
        res.status(200).json({ message: "Partial rows inserted successfully." });
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
    return res.status(400).json({ success: false, message: "id and requested_by are required" });
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
      return res.status(404).json({ success: false, message: "No matching exposures found" });
    }

    res.status(200).json({ success: true, message: `${rowCount} exposure(s) marked for delete approval` });
  } catch (err) {
    console.error("deleteExposure error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};



const approveMultipleExposures = async (req, res) => {
  const { exposureIds, approved_by, approval_comment } = req.body;

  if (!Array.isArray(exposureIds) || exposureIds.length === 0 || !approved_by) {
    return res.status(400).json({ success: false, message: "exposureIds and approved_by are required" });
  }

  try {
    // Fetch current statuses
    const { rows: existingExposures } = await pool.query(
      `SELECT id, status FROM exposures WHERE id = ANY($1::uuid[])`,
      [exposureIds]
    );

    const toDelete = existingExposures
      .filter(row => row.status === "Delete-Approval")
      .map(row => row.id);

    const toApprove = existingExposures
      .filter(row => row.status !== "Delete-Approval")
      .map(row => row.id);

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
        [ toApprove]
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
    return res.status(400).json({ success: false, message: "exposureIds and rejected_by are required" });
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
    const result = await pool.query("SELECT po_amount, po_currency FROM exposures");
    const currencyTotals = {};
    for (const row of result.rows) {
      const currency = (row.po_currency || '').toUpperCase();
      const amount = Number(row.po_amount) || 0;
      const usdValue = amount * (rates[currency] || 1.0);
      currencyTotals[currency] = (currencyTotals[currency] || 0) + usdValue;
    }
    // Sort currencies by value descending and take top 5
    const sorted = Object.entries(currencyTotals).sort((a, b) => b[1] - a[1]);
    const topCurrencies = sorted.slice(0, 5).map(([currency, value], idx) => ({
      currency,
      value: Number(value.toFixed(1)),
      color: idx === 0 ? "bg-green-400" : idx === 1 ? "bg-blue-400" : idx === 2 ? "bg-yellow-400" : idx === 3 ? "bg-red-400" : "bg-purple-400",
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
        amount: `$${(amount/1000).toFixed(1)}K`,
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
        amount: `$${(amount/1000).toFixed(1)}K`,
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
  getPayablesByCurrency
  
};
