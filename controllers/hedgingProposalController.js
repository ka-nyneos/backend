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


const getHedgingProposalsAggregated = async (req, res) => {
  try {
    const query = `
      SELECT 
        business_unit, 
        po_currency, 
        type,
        ARRAY_AGG(id) AS contributing_ids,
        SUM(COALESCE(month_1, 0)) AS hedge_month1,
        SUM(COALESCE(month_2, 0)) AS hedge_month2,
        SUM(COALESCE(month_3, 0)) AS hedge_month3,
        SUM(COALESCE(month_4, 0)) AS hedge_month4,
        SUM(COALESCE(month_4_6, 0)) AS hedge_month4to6,
        SUM(COALESCE(month_6plus, 0)) AS hedge_month6plus,
        SUM(COALESCE(old_month1, 0)) AS old_hedge_month1,
        SUM(COALESCE(old_month2, 0)) AS old_hedge_month2,
        SUM(COALESCE(old_month3, 0)) AS old_hedge_month3,
        SUM(COALESCE(old_month4, 0)) AS old_hedge_month4,
        SUM(COALESCE(old_month4to6, 0)) AS old_hedge_month4to6,
        SUM(COALESCE(old_month6plus, 0)) AS old_hedge_month6plus
      FROM exposures where (status_bucketing = 'Apporved' or status_bucketing = 'approved')
      GROUP BY business_unit, po_currency, type
    `;

    const result = await pool.query(query);

    const proposals = result.rows.map((row) => ({
      id: row.contributing_ids[0], // Pick first one if needed, or:
    //   reference_ids: row.contributing_ids, // all source exposure UUIDs
      business_unit: row.business_unit,
      po_currency: row.po_currency,
      type: row.type,
      hedge_month1: Number(row.hedge_month1),
      hedge_month2: Number(row.hedge_month2),
      hedge_month3: Number(row.hedge_month3),
      hedge_month4: Number(row.hedge_month4),
      hedge_month4to6: Number(row.hedge_month4to6),
      hedge_month6plus: Number(row.hedge_month6plus),
      old_hedge_month1: Number(row.old_hedge_month1),
      old_hedge_month2: Number(row.old_hedge_month2),
      old_hedge_month3: Number(row.old_hedge_month3),
      old_hedge_month4: Number(row.old_hedge_month4),
      old_hedge_month4to6: Number(row.old_hedge_month4to6),
      old_hedge_month6plus: Number(row.old_hedge_month6plus),
      remarks: null,
      status_hedge: null,
    }));

    res.json({ success: true, proposals });
  } catch (err) {
    console.error("Error aggregating hedging proposals:", err);
    res.status(500).json({ error: "Failed to aggregate proposals" });
  }
};


module.exports = {
  getUserVars,
  getHedgingProposalsAggregated,
};
